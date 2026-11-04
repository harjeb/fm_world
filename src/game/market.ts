import { ALL_ATTRIBUTES, type GameState, type Player } from './types.ts'
import { economyOf } from './economy.ts'
import { attrMax, attrRating } from './scale.ts'
import { autoFillLineup, repairLineup, validateLineup } from './squad.ts'
import { wageForPlayer } from './world.ts'

type Market = NonNullable<GameState['market']>
type Listing = Market['listings'][number]
export type MarketOutcome = { ok: boolean; error?: string }

/** A deterministic local NPC price based on the player's current attributes. */
export function playerMarketValue(player: Player): number {
  if (!player || !player.positions || !player.attrs) return 0
  const gk = player.positions.GK > 0
  if (ALL_ATTRIBUTES.some(key => !Number.isFinite(player.attrs[key]) || player.attrs[key] < 0 || player.attrs[key] > attrMax(key, gk))) return 0
  const values = ALL_ATTRIBUTES.map(key => attrRating(key, player.attrs[key], gk))
  return Math.max(1, Math.round(values.reduce((a, b) => a + b, 0) / values.length * 1000))
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

export function buyFreeAgent(game: GameState, playerId: string): MarketOutcome {
  if (game.activeMatch) return fail('比赛进行中不能交易')
  const market = game.market
  if (!validMarket(market) || !uniquePlayers(game, market)) return fail('市场数据无效或球员重复')
  const player = game.freeStars.find(p => p.id === playerId)
  if (!player) return fail('球员不存在')
  const price = playerMarketValue(player)
  if (!positive(price)) return fail('无效的价格')
  if (!transferWindowOpen(game)) return fail('转会窗口已关闭')
  if (game.world && game.roster.length >= SQUAD_LIMIT) return fail('阵容已满（最多 25 人）')
  const economy = economyOf(game)
  if (!economy || !validBalance(economy.balance)) return fail('余额数据无效')
  if (economy.balance < price) return fail('余额不足')
  economy.balance -= price
  game.freeStars = game.freeStars.filter(p => p.id !== playerId)
  game.roster.push(player)
  assignContract(game, player)
  return { ok: true }
}

export function listPlayer(game: GameState, playerId: string, price: number): MarketOutcome {
  if (!positive(price)) return fail('无效的价格')
  if (!transferWindowOpen(game)) return fail('转会窗口已关闭')
  if (game.activeMatch) return fail('比赛进行中不能交易')
  if (game.season.finished) return fail('赛季已结束，无法挂牌')
  const market = game.market
  if (!validMarket(market) || !uniquePlayers(game, market)) return fail('市场数据无效或球员重复')
  if (game.training[playerId] || game.candidates[playerId]) return fail('该球员正在培养或有待确认候选')
  if (market?.listings.some(l => l.player.id === playerId)) return fail('球员已挂牌')
  const player = game.roster.find(p => p.id === playerId)
  if (!player) return fail('球员不存在')
  if (!positive(playerMarketValue(player))) return fail('球员数据无效')
  const round = game.season?.round ?? 1
  if (!positive(round)) return fail('赛季轮次无效')
  const roster = game.roster.filter(p => p.id !== playerId)
  if (roster.length < 10) return fail('阵容必须保留至少 10 人')
  const repaired = repairLineup(roster, game.lineup)
  if (!validateLineup(roster, repaired.lineup).valid) return fail('挂牌后无法组成合法阵容')
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
  const remaining: Listing[] = [], sold: Listing[] = []
  for (const listing of market.listings) {
    const value = playerMarketValue(listing.player)
    if ((listing.listedRound ?? 1) <= round && listing.price <= 2 * value) {
      if (!Number.isSafeInteger(proceeds + listing.price) || !Number.isSafeInteger(economy.balance + proceeds + listing.price)) return 0
      proceeds += listing.price
      sold.push(listing)
    } else remaining.push(listing)
  }
  economy.balance += proceeds
  for (const listing of sold) listing.player.contract = undefined
  game.freeStars.push(...sold.map(l => l.player))
  market.listings = remaining
  market.lastSettledRound = round
  return proceeds
}


export function buyFromClub(game: GameState, clubId: string, playerId: string): MarketOutcome {
  if (game.activeMatch) return fail('比赛进行中不能交易')
  if (!transferWindowOpen(game)) return fail('转会窗口已关闭')
  if (game.world && game.roster.length >= SQUAD_LIMIT) return fail('阵容已满（最多 25 人）')
  const team = game.aiTeams.find((item) => item.id === clubId)
  const player = team?.players.find((item) => item.id === playerId)
  if (!team || !player) return fail('球员不在该球队')
  const price = Math.round(playerMarketValue(player) * 1.5)
  const economy = economyOf(game)
  if (!validBalance(economy.balance) || economy.balance < price) return fail('余额不足')
  economy.balance -= price
  team.players = team.players.filter((item) => item.id !== playerId)
  team.starPlayerIds = team.starPlayerIds.filter((id) => id !== playerId)
  team.playerNames = team.playerNames.filter((name) => name !== player.name)
  const repaired = repairLineup(team.players, team.lineup)
  if (validateLineup(team.players, repaired.lineup).valid) team.lineup = repaired.lineup
  game.roster.push(player)
  assignContract(game, player)
  return { ok: true }
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
