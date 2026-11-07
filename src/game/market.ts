import { type AITeam, type GameState, type Player } from './types.ts'
import { economyOf } from './economy.ts'
import { caOf } from './ca.ts'
import { playerMarketValue } from './pricing.ts'
export { VALUE_AT_CA_205, VALUE_GROWTH_PER_CA, VALUE_CAP, playerMarketValue } from './pricing.ts'
import { autoFillLineup, repairLineup, validateLineup } from './squad.ts'
import { wageForPlayer } from './world.ts'
import { derivedRng, splitSeed } from './rng.ts'
import { closeFinishedTraining, playerCards } from './cards.ts'
import { negotiationDemands, negotiationFailure, negotiationRoll, negotiationTerms, type NegotiationAnswers, type NegotiationDemands } from './negotiation.ts'
import { isOnMarketToday, nextMarketDayLabel } from './market-window.ts'

type Market = NonNullable<GameState['market']>
type Listing = Market['listings'][number]
export type MarketOutcome = { ok: boolean; error?: string }

/** 从 AI 球队买人的默认溢价倍数（谈判的底价就是它）。 */
export const CLUB_BUYOUT_RATIO = 1.5

/**
 * 这名球员的市场估值：按他身上的属性和他所有球员卡里最好的一套算。
 * 挂牌和买回用同一个数，所以换一张弱卡挂牌、再低价买回不会多赚钱。
 */
export function bestMarketValue(game: Pick<GameState, 'cards'>, player: Player): number {
  return playerCards(game, player.id).reduce((best, card) => Math.max(best, playerMarketValue(card)), playerMarketValue(player))
}

/** 本地 NPC 买家的预算上限：一轮最多花这么多，避免无脑倒卖把游戏刷成印钞机。 */
export const NPC_ROUND_BUDGET = 3_000_000
/** 一轮最多成交几笔（再多也没人接盘）。 */
export const NPC_MAX_DEALS = 3
/** 买家一口价最高出到估值的九成：卖人就是折价，倒卖不产生利润。 */
export const NPC_BID_RATIO = 0.9
/** 挂牌价上限 = 估值。高于估值的要价直接拒收，没有等待成交的可能。 */
export const MAX_LISTING_RATIO = 1

/** 建议挂牌价：按这个价挂等于买家一口价，必定成交。 */
export function suggestedPrice(game: Pick<GameState, 'cards'>, player: Player): number {
  return Math.max(1, Math.round(bestMarketValue(game, player) * NPC_BID_RATIO))
}

/**
 * 挂牌成交概率。
 *
 * 买方只按估值折价收购：要价不高于 `NPC_BID_RATIO`（九成）必定成交；
 * 越接近估值越难卖（0.95 倍约五成）；挂到估值或更高就没人要。
 * 因为成交价永远不高于估值，而买入自由球员正是按估值付钱，
 * 「买入 → 加价挂牌 → NPC 接盘 → 回自由市场 → 再买回」的套利环被从根上堵死。
 */
export function saleChance(price: number, value: number): number {
  if (!positive(value) || !positive(price)) return 0
  const ratio = price / value
  if (ratio <= NPC_BID_RATIO) return 1
  if (ratio >= MAX_LISTING_RATIO) return 0
  return (MAX_LISTING_RATIO - ratio) / (MAX_LISTING_RATIO - NPC_BID_RATIO)
}

const fail = (error: string): MarketOutcome => ({ ok: false, error })
const validBalance = (balance: number) => Number.isSafeInteger(balance) && balance >= 0
const positive = (n: number) => Number.isSafeInteger(n) && n > 0
export const SQUAD_LIMIT = 25

export function transferWindowOpen(game: GameState): boolean {
  if (!game.world) return true
  const round = game.season?.round ?? 1
  return round <= 10 || (round >= 20 && round <= 30)
}

function assignContract(game: GameState, player: Player): void {
  player.contract = { clubId: 'player', wage: wageForPlayer(player), expiresSeason: game.season.index + 3 }
}

/** 球员加入阵容并签合同。联机竞拍结算也走这里。 */
export function joinRoster(game: GameState, player: Player): void {
  game.roster.push(player)
  assignContract(game, player)
}

// Validate the entire escrow before reading or changing any of it. Old saves have
// no listedRound; those listings are eligible on the next unsettled round.
function validMarket(market: Market | undefined): boolean {
  if (market === undefined) return true
  if (!market || !Array.isArray(market.listings) || !validBalance(market.lastSettledRound)) return false
  const ids = new Set<string>()
  for (const listing of market.listings) {
    if (!listing || !listing.player || typeof listing.player.id !== 'string' || !listing.player.id ||
        !positive(listing.price) || !playerMarketValue(listing.player) ||
        (listing.listedRound !== undefined && !positive(listing.listedRound)) || ids.has(listing.player.id)) return false
    ids.add(listing.player.id)
  }
  return true
}

function uniquePlayers(game: GameState, market: Market | undefined): boolean {
  const ids = new Set<string>()
  for (const player of [...game.roster, ...game.freeStars, ...(market?.listings.map(l => l.player) ?? [])]) {
    if (!player || typeof player.id !== 'string' || !player.id || ids.has(player.id)) return false
    ids.add(player.id)
  }
  return true
}

/** 自由球员的底价就是估值。 */
export function freeAgentAsking(game: Pick<GameState, 'cards'>, player: Player): number {
  return bestMarketValue(game, player)
}

/** 从 AI 球队买人的底价：估值 1.5 倍。 */
export function clubAsking(game: Pick<GameState, 'cards'>, player: Player): number {
  return Math.round(bestMarketValue(game, player) * CLUB_BUYOUT_RATIO)
}

/** 阵容上限：签人不拦，开赛前必须裁到 25 人以内。 */
export function squadLimitError(game: Pick<GameState, 'roster'>): string | null {
  if (game.roster.length <= SQUAD_LIMIT) return null
  return `阵容有 ${game.roster.length} 人，超过 ${SQUAD_LIMIT} 人上限：请先裁掉 ${game.roster.length - SQUAD_LIMIT} 人才能进入比赛`
}

export type NegotiationOutcome = MarketOutcome & {
  chance?: number
  reasons?: string[]
  asks?: { value: number; asking: number; demands: NegotiationDemands }
}

export type { NegotiationAnswers, NegotiationDemands } from './negotiation.ts'

function completeSigning(game: GameState, player: Player, fee: number): void {
  const economy = economyOf(game)
  economy.balance -= fee
  game.roster.push(player)
  assignContract(game, player)
}

function negotiate(
  game: GameState,
  player: Player,
  offer: number,
  answers: NegotiationAnswers,
  asking: number,
  demandSeed: number,
): NegotiationOutcome {
  const value = bestMarketValue(game, player)
  if (!positive(asking) || !positive(value)) return fail('球员数据无效')
  if (!Number.isSafeInteger(offer) || offer <= 0) return fail('报价必须是正整数')
  const economy = economyOf(game)
  if (!economy || !validBalance(economy.balance)) return fail('余额数据无效')
  const demands = negotiationDemands({ seed: game.seed, world: game.world, season: game.season }, player)
  const clubTier = game.season?.tier ?? 'division2'
  const terms = negotiationTerms({ demands, value, asking, offer, answers, clubTier, clubId: 'player' })
  const asks = { value, asking, demands }
  if (terms.chance <= 0) return { ok: false, error: terms.reasons[0] ?? '对方不感兴趣', chance: 0, reasons: terms.reasons, asks }
  if (!negotiationRoll(demandSeed, player, offer, answers, terms.chance)) {
    return {
      ok: false,
      error: negotiationFailure({ demands, value, asking, offer, answers, clubTier, clubId: 'player' }, terms),
      chance: terms.chance,
      reasons: terms.reasons,
      asks,
    }
  }
  if (economy.balance < offer) return { ok: false, error: '余额不足，谈成了也付不起', chance: terms.chance, reasons: terms.reasons, asks }
  return { ok: true, chance: terms.chance, reasons: terms.reasons, asks }
}

/**
 * 单机/联机通用：谈判签下自由球员。报价可以高于底价，给的钱越多成功率越高；
 * 但球员自己想去别的队、或要求更高的联赛级别时，光加钱未必够。
 */
export function signFreeAgent(
  game: GameState,
  playerId: string,
  offer: number,
  answers: NegotiationAnswers,
): NegotiationOutcome {
  if (game.activeMatch) return fail('比赛进行中不能交易')
  const market = game.market
  if (!validMarket(market) || !uniquePlayers(game, market)) return fail('市场数据无效或球员重复')
  const player = game.freeStars.find(p => p.id === playerId)
  if (!player) return fail('球员不存在')
  if (!transferWindowOpen(game)) return fail('转会窗口已关闭')
  if (!isOnMarketToday(game, player)) return fail(`${player.name} 这个月不在市场，${nextMarketDayLabel(game, player)}再来看看`)
  const asking = freeAgentAsking(game, player)
  const result = negotiate(game, player, offer, answers, asking, game.seed)
  if (!result.ok) return result
  if (!positive(asking)) return fail('无效的价格')
  completeSigning(game, player, offer)
  game.freeStars = game.freeStars.filter(p => p.id !== playerId)
  return result
}

/** 单机/联机通用：向 AI 球队谈判买人。 */
export function signClubPlayer(
  game: GameState,
  clubId: string,
  playerId: string,
  offer: number,
  answers: NegotiationAnswers,
): NegotiationOutcome {
  if (game.activeMatch) return fail('比赛进行中不能交易')
  if (!transferWindowOpen(game)) return fail('转会窗口已关闭')
  const team = game.aiTeams.find((item) => item.id === clubId)
  const player = team?.players.find((item) => item.id === playerId)
  if (!team || !player) return fail('球员不在该球队')
  const asking = clubAsking(game, player)
  const result = negotiate(game, player, offer, answers, asking, game.seed)
  if (!result.ok) return result
  completeSigning(game, player, offer)
  team.players = team.players.filter((item) => item.id !== playerId)
  team.starPlayerIds = team.starPlayerIds.filter((id) => id !== playerId)
  team.playerNames = team.playerNames.filter((name) => name !== player.name)
  const worldClub = game.world?.clubs.find((club) => club.id === clubId)
  if (worldClub) worldClub.starPlayerIds = worldClub.starPlayerIds.filter((id) => id !== playerId)
  const repaired = repairLineup(team.players, team.lineup)
  if (validateLineup(team.players, repaired.lineup).valid) team.lineup = repaired.lineup
  return result
}

/** 直接按底价成交（跳过谈判）：AI 和内部流程用。 */
export function buyFreeAgent(game: GameState, playerId: string): MarketOutcome {
  if (game.activeMatch) return fail('比赛进行中不能交易')
  const market = game.market
  if (!validMarket(market) || !uniquePlayers(game, market)) return fail('市场数据无效或球员重复')
  const player = game.freeStars.find(p => p.id === playerId)
  if (!player) return fail('球员不存在')
  const price = bestMarketValue(game, player)
  if (!positive(price)) return fail('无效的价格')
  if (!transferWindowOpen(game)) return fail('转会窗口已关闭')
  const economy = economyOf(game)
  if (!economy || !validBalance(economy.balance)) return fail('余额数据无效')
  if (economy.balance < price) return fail('余额不足')
  completeSigning(game, player, price)
  game.freeStars = game.freeStars.filter(p => p.id !== playerId)
  return { ok: true }
}

export function listPlayer(game: GameState, playerId: string, price: number): MarketOutcome {
  if (!positive(price)) return fail('无效的价格')
  if (!transferWindowOpen(game)) return fail('转会窗口已关闭')
  if (game.activeMatch) return fail('比赛进行中不能交易')
  if (game.season.finished) return fail('赛季已结束，无法挂牌')
  const market = game.market
  if (!validMarket(market) || !uniquePlayers(game, market)) return fail('市场数据无效或球员重复')
  const session = game.training[playerId]
  if (session && !session.completed) return fail('该球员正在培养')
  if (market?.listings.some(l => l.player.id === playerId)) return fail('球员已挂牌')
  const player = game.roster.find(p => p.id === playerId)
  if (!player) return fail('球员不存在')
  const value = bestMarketValue(game, player)
  if (!positive(value)) return fail('球员数据无效')
  if (price > value * MAX_LISTING_RATIO) {
    return fail(`要价不能高于估值 ${value.toLocaleString()}：买家只按估值折价收购，倒卖不会赚钱`)
  }
  const round = game.season?.round ?? 1
  if (!positive(round)) return fail('赛季轮次无效')
  const roster = game.roster.filter(p => p.id !== playerId)
  if (roster.length < 10) return fail('阵容必须保留至少 10 人')
  const repaired = repairLineup(roster, game.lineup)
  if (!validateLineup(roster, repaired.lineup).valid) return fail('挂牌后无法组成合法阵容')
  // 培养刚结束的新卡已在库存；他的卡都留在库存，离队期间不能装备，回队后可以继续用。
  closeFinishedTraining(game, playerId)
  game.roster = roster
  game.lineup = repaired.lineup
  if (game.autoSubs && (repaired.changed || game.autoSubs.timed.some(s => s.outId === playerId || s.inId === playerId))) delete game.autoSubs
  const escrow = market ?? (game.market = { listings: [], lastSettledRound: 0 })
  escrow.listings.push({ player, price, listedRound: round })
  return { ok: true }
}

export function cancelListing(game: GameState, playerId: string): MarketOutcome {
  if (game.activeMatch) return fail('比赛进行中不能交易')
  const market = game.market
  if (!validMarket(market) || !uniquePlayers(game, market)) return fail('市场数据无效或球员重复')
  const index = market?.listings.findIndex(l => l.player.id === playerId) ?? -1
  if (!market || index < 0) return fail('挂牌不存在')
  const [listing] = market.listings.splice(index, 1)
  assignContract(game, listing.player)
  game.roster.push(listing.player)
  return { ok: true }
}

/** Settle each increasing round once; returns total proceeds. */
export function settleMarket(game: GameState, round: number): number {
  const market = game.market
  if (!market || !validMarket(market) || !uniquePlayers(game, market) || !positive(round) || round <= market.lastSettledRound) return 0
  const economy = economyOf(game)
  if (!economy || !validBalance(economy.balance)) return 0
  let proceeds = 0
  let spent = 0
  let deals = 0
  const sold: Listing[] = []
  const soldIds = new Set<string>()
  for (const listing of market.listings) {
    if ((listing.listedRound ?? 1) > round) continue
    if (deals >= NPC_MAX_DEALS) break
    const value = bestMarketValue(game, listing.player)
    const chance = saleChance(listing.price, value)
    if (chance <= 0) continue
    // 预算按轮共享；第一笔不受预算限制，免得贵球员永远卖不掉。
    if (deals > 0 && spent + listing.price > NPC_ROUND_BUDGET) continue
    if (chance < 1 && !derivedRng(game.seed, 'market', round, listing.player.id).chance(chance)) continue
    if (!Number.isSafeInteger(proceeds + listing.price) || !Number.isSafeInteger(economy.balance + proceeds + listing.price)) return 0
    proceeds += listing.price
    spent += listing.price
    deals += 1
    sold.push(listing)
    soldIds.add(listing.player.id)
  }
  economy.balance += proceeds
  for (const listing of sold) listing.player.contract = undefined
  game.freeStars.push(...sold.map(l => l.player))
  market.listings = market.listings.filter(l => !soldIds.has(l.player.id))
  market.lastSettledRound = round
  return proceeds
}


/** 直接按底价成交（跳过谈判）：AI 和内部流程用。 */
export function buyFromClub(game: GameState, clubId: string, playerId: string): MarketOutcome {
  if (game.activeMatch) return fail('比赛进行中不能交易')
  if (!transferWindowOpen(game)) return fail('转会窗口已关闭')
  const team = game.aiTeams.find((item) => item.id === clubId)
  const player = team?.players.find((item) => item.id === playerId)
  if (!team || !player) return fail('球员不在该球队')
  const price = clubAsking(game, player)
  const economy = economyOf(game)
  if (!validBalance(economy.balance) || economy.balance < price) return fail('余额不足')
  completeSigning(game, player, price)
  team.players = team.players.filter((item) => item.id !== playerId)
  team.starPlayerIds = team.starPlayerIds.filter((id) => id !== playerId)
  team.playerNames = team.playerNames.filter((name) => name !== player.name)
  // 下赛季 AI 球队按世界名单重建，这里不清掉他就会再出现一个。
  const worldClub = game.world?.clubs.find((club) => club.id === clubId)
  if (worldClub) worldClub.starPlayerIds = worldClub.starPlayerIds.filter((id) => id !== playerId)
  const repaired = repairLineup(team.players, team.lineup)
  if (validateLineup(team.players, repaired.lineup).valid) team.lineup = repaired.lineup
  return { ok: true }
}

/**
 * 各队的随机球员也会进入市场：每轮从 AI 阵容里挑 1-3 名边缘球员挂牌，
 * 自由市场里的普通球员保持在 24 人以内，免得把真球星挤没。
 */
export function refreshClubMarket(game: GameState, round: number): number {
  if (!game.world || !game.aiTeams?.length) return 0
  const listed = game.freeStars.filter((player) => !player.starKey).length
  if (listed >= 24) return 0
  const rng = derivedRng(splitSeed(game.seed, 'club-market'), round)
  const candidates: { team: AITeam; player: Player; ca: number }[] = []
  for (const team of game.aiTeams) {
    if (team.players.length <= 16) continue
    for (const player of team.players) {
      if (player.starKey) continue
      candidates.push({ team, player, ca: caOf(player.attrs, player.positions.GK > 0) })
    }
  }
  if (!candidates.length) return 0
  // 边缘球员先上：CA 低的更容易被摆上货架。
  candidates.sort((a, b) => a.ca - b.ca || a.player.id.localeCompare(b.player.id))
  const pool = candidates.slice(0, Math.max(6, Math.ceil(candidates.length * 0.35)))
  const want = Math.min(1 + rng.int(3), 24 - listed)
  let moved = 0
  for (let guard = 0; guard < 12 && moved < want; guard++) {
    const pick = pool.splice(rng.int(pool.length), 1)[0]
    if (!pick) break
    if (game.freeStars.some((item) => item.id === pick.player.id)) continue
    pick.team.players = pick.team.players.filter((item) => item.id !== pick.player.id)
    pick.player.contract = undefined
    game.freeStars.push(pick.player)
    const repaired = repairLineup(pick.team.players, pick.team.lineup)
    if (validateLineup(pick.team.players, repaired.lineup).valid) pick.team.lineup = repaired.lineup
    moved += 1
  }
  return moved
}

export function renewContract(game: GameState, playerId: string, years = 2): MarketOutcome {
  if (!Number.isSafeInteger(years) || years < 1 || years > 5) return fail('合同年限需为 1-5 年')
  if (game.activeMatch) return fail('比赛进行中不能续约')
  const player = game.roster.find((item) => item.id === playerId)
  if (!player) return fail('球员不在你的阵容')
  player.contract = {
    clubId: 'player',
    wage: Math.max(player.contract?.wage ?? 0, Math.round(wageForPlayer(player) * 1.1)),
    expiresSeason: Math.max((player.contract?.expiresSeason ?? game.season.index) + years, game.season.index + years),
  }
  return { ok: true }
}

export function releasePlayer(game: GameState, playerId: string): MarketOutcome {
  if (game.activeMatch) return fail('比赛进行中不能解约')
  if (game.roster.length <= 10) return fail('阵容必须保留至少 10 人')
  const player = game.roster.find((item) => item.id === playerId)
  if (!player) return fail('球员不在你的阵容')
  const roster = game.roster.filter((item) => item.id !== playerId)
  const repaired = repairLineup(roster, game.lineup)
  if (!validateLineup(roster, repaired.lineup).valid) return fail('解约后无法组成合法阵容')
  game.roster = roster
  game.lineup = repaired.lineup
  player.contract = undefined
  game.freeStars.push(player)
  return { ok: true }
}

export function aiTeamSalary(team: { players: Player[] }): number {
  return team.players.reduce((sum, player) => sum + wageForPlayer(player), 0)
}
