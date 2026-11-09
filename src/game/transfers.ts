/**
 * AI 俱乐部的转会行为：互相挖人、向玩家球队报价，以及玩家回复报价。
 *
 * - 买进名额：AI 每赛季最多买进 5 人（竞拍、签自由球员、挖人都算，见 transfer-rules.ts）。
 * - 挖人：AI 按需（缺位置 / 同位置明显更强 / 人手不够，沿用 aiBidFor 的判断）向同级或更低级别的
 *   AI 球队报价；卖方按主力 / 年龄 / 最近出场 / 溢价决定放不放人。
 * - 给玩家报价：同样按需挑人、按这名球员在玩家队里的地位出价，4 个游戏日（现实 24 小时）内不回复算拒绝。
 *   拒绝高价报价（不低于身价 1.3 倍）球员会不满，之后 8 个游戏日精力恢复只剩一成。
 * 这里不碰存档的读写方式：单机传 game 里的球队和账本，服务器传共享名册和共享账本。
 */
import type { AIClubState, AITeam, GameState, Player, TierId, TransferOffer } from './types.ts'
import { AI_SQUAD_LIMIT, aiBidFor, aiTierProfile, recordAISigning } from './ai-club.ts'
import { playerMarketValue } from './pricing.ts'
import { MIN_SQUAD, refreshAILineup, repairLineup, validateLineup } from './squad.ts'
import { sellerSquadError, transferWindowOpen } from './market.ts'
import { validateAutoSubPlan } from './match/management.ts'
import { derivedRng, splitSeed } from './rng.ts'
import { GAME_DAY_MS } from './calendar.ts'
import { economyOf } from './economy.ts'
import {
  HIGH_OFFER_RATIO,
  OFFER_RESPONSE_GAME_DAYS,
  aiBuysLeft,
  assessRelease,
  makeUnhappy,
  noteAIBuy,
  releaseChance,
  releaseRoll,
} from './transfer-rules.ts'

/** 参与转会的一家 AI 俱乐部：名单 + 账本。 */
export type MarketClub = { id: string; name: string; tier: TierId; team: AITeam; state: AIClubState }

const TIER_RANK: Record<TierId, number> = { division2: 1, division1: 2, champions: 3 }
const roundPrice = (value: number): number => Math.round(value / 1000) * 1000
const caOfPlayer = (player: Player): number => playerMarketValue(player)

function repairTeam(team: AITeam): void {
  const repaired = repairLineup(team.players, team.lineup)
  if (validateLineup(team.players, repaired.lineup).valid) team.lineup = repaired.lineup
}

/** 一名球员进 AI 球队：名单、阵容、账本（扣钱、记进签约名单、占一个买进名额）。 */
export function joinAIClub(buyer: MarketClub, player: Player, amount: number, season: number): void {
  delete player.contract
  delete player.unhappy
  buyer.team.players = [...buyer.team.players.filter((item) => item.id !== player.id), player]
  // 新援要能进首发：只修“不合法”的阵容会让他一直坐在名单外。
  refreshAILineup(buyer.team)
  recordAISigning(buyer.state, player, amount)
  noteAIBuy(buyer.state, season)
}

/** 一名球员离开 AI 球队：名单、阵容、招牌球星、还没并进名单的签约。 */
export function leaveAIClub(seller: MarketClub, player: Player, amount: number): void {
  seller.team.players = seller.team.players.filter((item) => item.id !== player.id)
  seller.team.starPlayerIds = seller.team.starPlayerIds.filter((id) => id !== player.id)
  seller.team.playerNames = seller.team.playerNames.filter((name) => name !== player.name)
  seller.state.signings = seller.state.signings.filter((item) => item.id !== player.id)
  seller.state.economy.balance += amount
  repairTeam(seller.team)
}

export type PoachMove = { buyerId: string; sellerId: string; playerId: string; playerName: string; amount: number }

/**
 * AI 之间挖人（转会窗口内每轮调用一次）。每家有名额、有需要的 AI 有一定概率出手，
 * 只挖同级或更低级别球队的人；卖方按放人规则掷骰。一轮最多 maxMoves 笔。
 */
export function aiPoachRound(input: {
  clubs: MarketClub[]
  season: number
  round: number
  seed: number
  appearances?: Record<string, number[]>
  maxMoves?: number
  onMove?: (move: PoachMove, player: Player) => void
}): PoachMove[] {
  const { clubs, season, round } = input
  const maxMoves = input.maxMoves ?? 2
  const rng = derivedRng(splitSeed(input.seed, 'ai-poach-clubs'), season, round)
  const moves: PoachMove[] = []
  const buyers = [...clubs].sort((a, b) => a.id.localeCompare(b.id))
  for (let index = buyers.length - 1; index > 0; index--) {
    const swap = rng.int(index + 1)
    ;[buyers[index], buyers[swap]] = [buyers[swap], buyers[index]]
  }
  for (const buyer of buyers) {
    if (moves.length >= maxMoves) break
    if (!rng.chance(0.25)) continue
    const buysLeft = aiBuysLeft(buyer.state, season)
    if (buysLeft <= 0 || buyer.team.players.length >= AI_SQUAD_LIMIT) continue
    // 候选：同级或更低级别球队里、卖方肯谈的人，按 CA 从高到低看前 40 个。
    const candidates = clubs
      .filter((seller) => seller.id !== buyer.id && TIER_RANK[seller.tier] <= TIER_RANK[buyer.tier])
      .flatMap((seller) => seller.team.players.map((player) => ({ seller, player })))
      .sort((a, b) => caOfPlayer(b.player) - caOfPlayer(a.player))
      .slice(0, 40)
    for (const { seller, player } of candidates) {
      if (sellerSquadError(seller.team, player)) continue
      const value = playerMarketValue(player)
      const terms = assessRelease({ player, lineup: seller.team.lineup, minutes: input.appearances?.[player.id], value })
      if (terms.asking === null) continue
      const amount = aiBidFor({ state: buyer.state, tier: buyer.tier, player, squad: buyer.team.players, value, minimum: terms.asking, buysLeft })
      if (amount === null) continue
      const chance = releaseChance(terms, amount)
      if (!releaseRoll(splitSeed(input.seed, `poach-${season}-${round}-${buyer.id}`), player.id, amount, chance)) break
      leaveAIClub(seller, player, amount)
      joinAIClub(buyer, player, amount, season)
      const move = { buyerId: buyer.id, sellerId: seller.id, playerId: player.id, playerName: player.name, amount }
      moves.push(move)
      input.onMove?.(move, player)
      break
    }
  }
  return moves
}

/* ---------- 给玩家球队的报价 ---------- */

/** 玩家队里这名球员的地位和俱乐部要价（AI 出价时参考）。 */
export function humanSaleTerms(game: Pick<GameState, 'lineup' | 'appearances'>, player: Player) {
  return assessRelease({ player, lineup: game.lineup, minutes: game.appearances?.[player.id], value: playerMarketValue(player) })
}

export function pendingOffers(game: Pick<GameState, 'transferOffers'>): TransferOffer[] {
  return (game.transferOffers ?? []).filter((offer) => offer.status === 'pending')
}

/** 收件箱只留最近 30 条已处理的报价，免得存档越滚越大。 */
function trimOffers(game: GameState): void {
  const offers = game.transferOffers ?? []
  const pending = offers.filter((offer) => offer.status === 'pending')
  const done = offers.filter((offer) => offer.status !== 'pending').sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0)).slice(0, 30)
  game.transferOffers = [...pending, ...done]
}

/**
 * AI 给玩家球队报价（转会窗口内每轮调用一次）：约四成概率来一份新报价，同时最多 3 份待回复。
 * 出价 = 身价 × (1 + 玩家队里这名球员的要价溢价 + 0–20% 的诚意)，年轻主力按 60% 起出；钱不够就不报。
 */
export function generateAIOffers(input: { game: GameState; clubs: MarketClub[]; season: number; round: number; now: number; seed: number }): TransferOffer | null {
  const { game, clubs, season, round, now } = input
  if (!transferWindowOpen(game) || game.activeMatch) return null
  const pending = pendingOffers(game)
  if (pending.length >= 3 || game.roster.length <= MIN_SQUAD) return null
  const rng = derivedRng(splitSeed(input.seed, 'ai-offers'), season, round)
  if (!rng.chance(0.4)) return null
  const busy = new Set(pending.map((offer) => offer.playerId))
  const targets = game.roster
    .filter((player) => !busy.has(player.id) && !(game.training[player.id] && !game.training[player.id].completed))
    .sort((a, b) => caOfPlayer(b) - caOfPlayer(a))
  const buyers = [...clubs].sort((a, b) => a.id.localeCompare(b.id))
  const start = rng.int(Math.max(1, buyers.length))
  for (let step = 0; step < buyers.length; step++) {
    const buyer = buyers[(start + step) % buyers.length]
    const inFlight = pending.filter((offer) => offer.clubId === buyer.id).length
    const buysLeft = aiBuysLeft(buyer.state, season, inFlight)
    if (buysLeft <= 0 || buyer.team.players.length >= AI_SQUAD_LIMIT) continue
    const spendable = buyer.state.economy.balance - aiTierProfile(buyer.tier).reserve
    for (const player of targets) {
      const value = playerMarketValue(player)
      // 先看这支 AI 需不需要他（缺位置、同位置明显更强或人手不够）。
      if (aiBidFor({ state: buyer.state, tier: buyer.tier, player, squad: buyer.team.players, value, minimum: value, buysLeft }) === null) continue
      const terms = humanSaleTerms(game, player)
      const premium = (terms.requiredPremium ?? 0.6) + rng.float() * 0.2
      let amount = roundPrice(value * (1 + premium))
      if (amount > spendable * 0.6) amount = roundPrice(spendable * 0.6)
      if (amount < value * 1.05) continue
      const offer: TransferOffer = {
        id: `offer-${season}-${round}-${buyer.id}-${player.id}`,
        clubId: buyer.id,
        clubName: buyer.name,
        tier: buyer.tier,
        playerId: player.id,
        playerName: player.name,
        amount,
        value,
        createdAt: now,
        expiresAt: now + OFFER_RESPONSE_GAME_DAYS * GAME_DAY_MS,
        status: 'pending',
      }
      game.transferOffers = [...(game.transferOffers ?? []), offer]
      trimOffers(game)
      return offer
    }
  }
  return null
}

export const isHighOffer = (offer: Pick<TransferOffer, 'amount' | 'value'>): boolean => offer.amount >= offer.value * HIGH_OFFER_RATIO

/** 拒绝（或过期）：高价报价会让球员不满。 */
function declineOffer(game: GameState, offer: TransferOffer, status: 'rejected' | 'expired', at: number): boolean {
  offer.status = status
  offer.resolvedAt = at
  if (!isHighOffer(offer)) return false
  const player = game.roster.find((item) => item.id === offer.playerId)
  if (!player) return false
  makeUnhappy(player, `${offer.clubName} 出价 ${offer.amount.toLocaleString()} 被拒绝`, at)
  offer.note = `${player.name} 不满：8 个游戏日内精力恢复只剩一成`
  return true
}

/** 过期 / 窗口关闭 / 球员已经不在队里的报价收掉；过期的高价报价同样会让球员不满。 */
export function expireOffers(game: GameState, now: number): boolean {
  let changed = false
  const windowOpen = transferWindowOpen(game)
  for (const offer of pendingOffers(game)) {
    if (!game.roster.some((player) => player.id === offer.playerId)) {
      offer.status = 'withdrawn'
      offer.resolvedAt = now
      offer.note = '球员已经不在队里'
      changed = true
    } else if (offer.expiresAt <= now) {
      declineOffer(game, offer, 'expired', offer.expiresAt)
      changed = true
    } else if (!windowOpen) {
      offer.status = 'withdrawn'
      offer.resolvedAt = now
      offer.note = '转会窗口关闭，对方撤回了报价'
      changed = true
    }
  }
  if (changed) trimOffers(game)
  return changed
}

export type OfferResponse = { ok: boolean; error?: string; offer?: TransferOffer; unhappy?: boolean }

/**
 * 玩家回复报价。接受：球员转去对方（对方扣钱、占一个买进名额），我方收钱；拒绝：高价报价会让球员不满。
 * buyer 是对方俱乐部的名单和账本（单机在 game 里，联机是服务器的共享名册）。
 */
export function respondToOffer(game: GameState, offerId: string, accept: boolean, now: number, buyer: MarketClub | undefined, season: number): OfferResponse {
  expireOffers(game, now)
  const offer = (game.transferOffers ?? []).find((item) => item.id === offerId)
  if (!offer) return { ok: false, error: '找不到这份报价' }
  if (offer.status !== 'pending') return { ok: false, error: offer.status === 'expired' ? '报价已经过期' : '报价已经处理过了', offer }
  if (!accept) {
    const unhappy = declineOffer(game, offer, 'rejected', now)
    trimOffers(game)
    return { ok: true, offer, unhappy }
  }
  if (game.activeMatch) return { ok: false, error: '比赛进行中不能转会' }
  if (!transferWindowOpen(game)) return { ok: false, error: '转会窗口已关闭' }
  const player = game.roster.find((item) => item.id === offer.playerId)
  if (!player) return { ok: false, error: '球员已经不在队里' }
  if (game.training[player.id] && !game.training[player.id].completed) return { ok: false, error: `${player.name} 正在培养，培养结束后才能转会` }
  if (!buyer) return { ok: false, error: '对方球队不存在' }
  if (aiBuysLeft(buyer.state, season) <= 0) return { ok: false, error: `${buyer.name} 本赛季的买人名额已经用完` }
  if (buyer.state.economy.balance < offer.amount) return { ok: false, error: `${buyer.name} 现在付不起这笔钱了` }
  if (buyer.team.players.length >= AI_SQUAD_LIMIT) return { ok: false, error: `${buyer.name} 阵容已满` }
  const roster = game.roster.filter((item) => item.id !== player.id)
  if (roster.length < MIN_SQUAD) return { ok: false, error: `阵容必须保留至少 ${MIN_SQUAD} 人` }
  const repaired = repairLineup(roster, game.lineup)
  if (!validateLineup(roster, repaired.lineup).valid) return { ok: false, error: '卖掉他之后无法组成合法阵容' }
  game.roster = roster
  game.lineup = repaired.lineup
  if (game.autoSubs && validateAutoSubPlan(game.roster, game.lineup, game.autoSubs).length) delete game.autoSubs
  economyOf(game).balance += offer.amount
  joinAIClub(buyer, player, offer.amount, season)
  offer.status = 'accepted'
  offer.resolvedAt = now
  for (const other of pendingOffers(game)) {
    if (other.playerId !== player.id) continue
    other.status = 'withdrawn'
    other.resolvedAt = now
    other.note = '球员已经转走'
  }
  trimOffers(game)
  return { ok: true, offer }
}

/** 单机：本联赛的 AI 球队 + 存档里的账本。 */
export function localMarketClubs(game: GameState): MarketClub[] {
  if (!game.world || !game.aiClubs) return []
  return game.aiTeams.flatMap((team) => {
    const state = game.aiClubs?.[team.id]
    const club = game.world?.clubs.find((item) => item.id === team.id)
    return state ? [{ id: team.id, name: team.name, tier: club?.tier ?? team.tier ?? 'division2', team, state }] : []
  })
}

/**
 * 单机每轮结束后：AI 互相挖人（本联赛内）、给玩家报价、收掉过期报价。
 * 挖走的招牌球星同时从世界球队的招牌名单里拿掉。
 */
export function runLocalTransfers(game: GameState, round: number, now: number): void {
  expireOffers(game, now)
  if (!transferWindowOpen(game)) return
  const clubs = localMarketClubs(game)
  if (!clubs.length) return
  const season = game.season.index
  aiPoachRound({
    clubs, season, round, seed: game.seed, appearances: game.appearances, maxMoves: 1,
    onMove: (move) => {
      const seller = game.world?.clubs.find((club) => club.id === move.sellerId)
      if (seller) seller.starPlayerIds = seller.starPlayerIds.filter((id) => id !== move.playerId)
    },
  })
  generateAIOffers({ game, clubs, season, round, now, seed: game.seed })
}
