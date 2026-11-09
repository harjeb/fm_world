import { economyOf } from './economy.ts'
import { bestMarketValue, joinRoster, playerMarketValue, transferWindowOpen } from './market.ts'
import type { GameState, Player } from './types.ts'

/**
 * 联机的自由球员市场：全服共用一个球员池，靠竞拍签人。
 * 第一个出价开始 1 小时倒计时，时间到时最高价者得；最后 AUCTION_EXTEND_MS（10 分钟）以内有人跟价，
 * 倒计时重新回到 10 分钟，不会被人卡在最后一秒抢走；离结束还早时跟价不改倒计时。跟价要先交一笔不退还的手续费（开拍那一口不收）。
 * 这里只有规则，存储和广播在 server/app.ts。
 */
export const AUCTION_DURATION_MS = 60 * 60_000
export const AUCTION_EXTEND_MS = 10 * 60_000
/** 跟价手续费：出价的 2%，至少 1,000；无论最后有没有拍到都不退还。 */
export const AUCTION_RAISE_FEE_RATE = 0.02
export const AUCTION_RAISE_FEE_MIN = 1_000
/** 每次至少加价 5%。 */
export const AUCTION_MIN_RAISE = 0.05
const LOG_SIZE = 30
/** 电脑球队的出价用这个前缀标记，结算时走 AI 那条路。 */
export const AI_BID_PREFIX = 'ai:'
export const isAIBid = (accountId: string): boolean => accountId.startsWith(AI_BID_PREFIX)
export const aiClubIdOf = (accountId: string): string | null => (isAIBid(accountId) ? accountId.slice(AI_BID_PREFIX.length) : null)
/** 同一支电脑球队对同一个人最多抬几次，避免自己跟自己把价抬上天。 */
export const AI_MAX_BIDS = 2

export type AuctionBid = { accountId: string; club: string; amount: number; at: number }

export type Auction = {
  playerId: string
  playerName: string
  startedAt: number
  endsAt: number
  /** 按时间顺序，最后一个是当前最高价。 */
  bids: AuctionBid[]
}

export type AuctionResult = { playerId: string; playerName: string; club: string | null; amount: number; at: number }

export type FreeMarket = {
  pool: Player[]
  auctions: Auction[]
  log: AuctionResult[]
  /** 球员池每变一次加一，客户端看到变了才重新拉名单。 */
  version: number
}

export type BidResult = { ok: true; auction: Auction; outbid: string | null; /** 这口价交的跟价手续费，开拍为 0。 */ fee: number } | { ok: false; error: string }

const fail = (error: string): BidResult => ({ ok: false, error })

export const leadingBid = (auction: Auction): AuctionBid => auction.bids[auction.bids.length - 1]

/** 跟价（这名球员已经有人出过价）要交的手续费；开拍的第一口不收。 */
export function auctionRaiseFee(amount: number): number {
  return Math.max(AUCTION_RAISE_FEE_MIN, Math.ceil(amount * AUCTION_RAISE_FEE_RATE))
}

/** 跟价：记下这口价；最后 10 分钟以内跟价，倒计时重新回到 10 分钟。 */
function raise(auction: Auction, bid: AuctionBid): void {
  auction.bids.push(bid)
  auction.endsAt = Math.max(auction.endsAt, bid.at + AUCTION_EXTEND_MS)
}

/** 下一口至少出多少：还没人出价时是估值，之后在当前价上加 5%，至少多 1。 */
export function minimumBid(player: Player, auction?: Auction | null): number {
  const value = playerMarketValue(player)
  if (!auction?.bids.length) return value
  const current = leadingBid(auction).amount
  return Math.max(value, Math.ceil(current * (1 + AUCTION_MIN_RAISE)), current + 1)
}

/** 这个账号正领先的出价一共占了多少钱；一笔钱不能同时拿去竞拍两个人。 */
export function committedFunds(auctions: Auction[], accountId: string, except?: string): number {
  return auctions.reduce((sum, auction) => {
    if (auction.playerId === except || !auction.bids.length) return sum
    const lead = leadingBid(auction)
    return lead.accountId === accountId ? sum + lead.amount : sum
  }, 0)
}

const leadingCount = (auctions: Auction[], accountId: string, except?: string) =>
  auctions.filter((auction) => auction.playerId !== except && auction.bids.length > 0 && leadingBid(auction).accountId === accountId).length

/** 电脑球队出价：没有账号，只有俱乐部和钱，规则和玩家一样（必须够最低价、不能自己压自己）。 */
export function placeAIBid(market: FreeMarket, club: { id: string; name: string }, playerId: string, amount: number, now: number): BidResult {
  const accountId = `${AI_BID_PREFIX}${club.id}`
  const player = market.pool.find((item) => item.id === playerId)
  if (!player) return fail('这名球员已经不在自由市场了')
  if (!Number.isSafeInteger(amount) || amount <= 0) return fail('出价必须是正整数')
  const auction = market.auctions.find((item) => item.playerId === playerId)
  if (auction && leadingBid(auction).accountId === accountId) return fail('已经是最高出价')
  if (auction && auction.bids.filter((bid) => bid.accountId === accountId).length >= AI_MAX_BIDS) return fail('这支球队已经放弃这名球员')
  const minimum = minimumBid(player, auction)
  if (amount < minimum) return fail(`出价至少 ${minimum.toLocaleString()}`)
  const bid: AuctionBid = { accountId, club: club.name, amount, at: now }
  if (!auction) {
    const created: Auction = { playerId, playerName: player.name, startedAt: now, endsAt: now + AUCTION_DURATION_MS, bids: [bid] }
    market.auctions.push(created)
    return { ok: true, auction: created, outbid: null, fee: 0 }
  }
  const outbid = leadingBid(auction).accountId
  raise(auction, bid)
  // 手续费由调用方从电脑球队的账上扣（这里没有它的经济数据）。
  return { ok: true, auction, outbid, fee: auctionRaiseFee(amount) }
}

export function placeBid(market: FreeMarket, game: GameState, accountId: string, playerId: string, amount: number, now: number): BidResult {
  const player = market.pool.find((item) => item.id === playerId)
  if (!player) return fail('这名球员已经不在自由市场了')
  if (!Number.isSafeInteger(amount) || amount <= 0) return fail('出价必须是正整数')
  if (!transferWindowOpen(game)) return fail('转会窗口已关闭')
  if (game.roster.some((item) => item.id === playerId)) return fail('他已经在你的阵容里')
  const auction = market.auctions.find((item) => item.playerId === playerId)
  if (auction && leadingBid(auction).accountId === accountId) return fail('你已经是最高出价')
  // 自己练过这名球员时估值按最好的卡算，免得低价卖掉再低价竞拍回来。
  const minimum = Math.max(minimumBid(player, auction), bestMarketValue(game, player))
  if (amount < minimum) return fail(`出价至少 ${minimum.toLocaleString()}`)
  const economy = economyOf(game)
  const committed = committedFunds(market.auctions, accountId, playerId)
  const fee = auction ? auctionRaiseFee(amount) : 0
  if (economy.balance - committed < amount + fee) {
    const need = fee ? `（含跟价手续费 ${fee.toLocaleString()}）` : ''
    return fail(committed > 0 ? `余额不足${need}：其他领先的竞拍占用了 ${committed.toLocaleString()}` : `余额不足${need}`)
  }
  const bid: AuctionBid = { accountId, club: game.clubName, amount, at: now }
  if (!auction) {
    const created: Auction = { playerId, playerName: player.name, startedAt: now, endsAt: now + AUCTION_DURATION_MS, bids: [bid] }
    market.auctions.push(created)
    return { ok: true, auction: created, outbid: null, fee: 0 }
  }
  const outbid = leadingBid(auction).accountId
  // 手续费当场扣掉，不管最后有没有拍到都不退。
  economy.balance -= fee
  raise(auction, bid)
  return { ok: true, auction, outbid, fee }
}

export type Settlement = { result: AuctionResult; winnerId: string | null }

/** 结算时电脑球队要做的三件事：有多少钱、还能不能收人、收下之后钱和人都怎么记。 */
export type AIBidder = {
  balance: (clubId: string) => number
  canSign: (clubId: string) => boolean
  sign: (clubId: string, player: Player, amount: number) => void
}

/**
 * 结算到期的竞拍。最高价者买不起（钱花掉了）或阵容满了，就顺延给下一个出价的人；
 * 都不行就回到市场。正在踢由客户端推进的比赛（友谊赛）的人先等一等，比赛结束再结算。
 */
export function settleAuctions(market: FreeMarket, gameOf: (accountId: string) => GameState | undefined, now: number, ai?: AIBidder): Settlement[] {
  const settled: Settlement[] = []
  for (const auction of [...market.auctions]) {
    if (auction.endsAt > now) continue
    const seen = new Set<string>()
    const contenders = [...auction.bids].reverse().filter((bid) => {
      if (seen.has(bid.accountId)) return false
      seen.add(bid.accountId)
      return true
    })
    const eligible = contenders.find((bid) => {
      const clubId = aiClubIdOf(bid.accountId)
      if (clubId) return !!ai && ai.balance(clubId) >= bid.amount && ai.canSign(clubId)
      const game = gameOf(bid.accountId)
      return !!game && economyOf(game).balance >= bid.amount
    })
    const busy = eligible && !isAIBid(eligible.accountId) ? gameOf(eligible.accountId)?.activeMatch : undefined
    if (busy && !busy.context.isLeague) continue
    const player = market.pool.find((item) => item.id === auction.playerId)
    market.auctions = market.auctions.filter((item) => item !== auction)
    let result: AuctionResult
    if (eligible && player) {
      const clubId = aiClubIdOf(eligible.accountId)
      if (clubId) {
        ai!.sign(clubId, player, eligible.amount)
      } else {
        const game = gameOf(eligible.accountId)!
        economyOf(game).balance -= eligible.amount
        joinRoster(game, player)
      }
      market.pool = market.pool.filter((item) => item.id !== player.id)
      market.version += 1
      result = { playerId: auction.playerId, playerName: auction.playerName, club: eligible.club, amount: eligible.amount, at: now }
      settled.push({ result, winnerId: eligible.accountId })
    } else {
      result = { playerId: auction.playerId, playerName: auction.playerName, club: null, amount: 0, at: now }
      settled.push({ result, winnerId: null })
    }
    market.log = [result, ...market.log].slice(0, LOG_SIZE)
  }
  return settled
}

/**
 * 账号里新放出来的自由球员（解约、卖给 NPC、合同到期、下一代球星）进入全服市场。
 * 已经在市场或别人阵容里的不重复加。返回有没有变化。
 */
export function absorbFreeAgents(market: FreeMarket, game: GameState, isTaken: (playerId: string) => boolean): boolean {
  if (!game.freeStars?.length) return false
  const known = new Set(market.pool.map((player) => player.id))
  let poolChanged = false
  for (const player of game.freeStars) {
    if (known.has(player.id) || isTaken(player.id)) continue
    market.pool.push(player)
    known.add(player.id)
    poolChanged = true
  }
  game.freeStars = []
  if (poolChanged) market.version += 1
  return true
}
