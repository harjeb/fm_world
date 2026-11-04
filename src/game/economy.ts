import type { EconomyState, FacilityId, GameState } from './types.ts'
export type { EconomyState, FacilityId } from './types.ts'

export const MAX_FACILITY_LEVEL = 5
export const FACILITIES: Record<FacilityId, { label: string; baseCost: number; incomePerLevel: number }> = {
  stadium: { label: '球场', baseCost: 200000, incomePerLevel: 5000 },
  academy: { label: '青训学院', baseCost: 25000, incomePerLevel: 0 },
  medical: { label: '医疗中心', baseCost: 20000, incomePerLevel: 0 },
  shop: { label: '球迷商店', baseCost: 20000, incomePerLevel: 3000 },
  sponsor: { label: '赞助商', baseCost: 25000, incomePerLevel: 4000 },
}
export const BASE_ROUND_INCOME = 10000
export const LEAGUE_WIN_BONUS = 10000

const ids = Object.keys(FACILITIES) as FacilityId[]
const validId = (id: unknown): id is FacilityId => typeof id === 'string' && Object.hasOwn(FACILITIES, id)
const whole = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
const validEconomy = (e: EconomyState): boolean =>
  whole(e.balance, 0, Number.MAX_SAFE_INTEGER) && whole(e.lastIncomeRound, 0, Number.MAX_SAFE_INTEGER) &&
  ids.every(id => whole(e[id], 1, MAX_FACILITY_LEVEL))

/** Returns the live economy, creating defaults for a save without one. */
export function economyOf(game: GameState): EconomyState {
  if (game.economy == null) {
    let completed = 0
    while (true) {
      const fixtures = game.season.fixtures.filter(fixture => fixture.round === completed + 1)
      if (!fixtures.length || fixtures.some(fixture => !fixture.played)) break
      completed++
    }
    game.economy = { balance: 100000, stadium: 1, academy: 1, medical: 1, shop: 1, sponsor: 1, lastIncomeRound: completed }
  }
  return game.economy
}

/** Cost to upgrade from the current level; null for an invalid ID/level or max level. */
export function facilityUpgradeCost(id: FacilityId, level: number): number | null {
  if (!validId(id) || !whole(level, 1, MAX_FACILITY_LEVEL - 1)) return null
  return FACILITIES[id].baseCost * level
}

export function upgradeFacility(game: GameState, id: FacilityId): { ok: boolean; error?: string } {
  const economy = economyOf(game)
  if (!validId(id)) return { ok: false, error: '无效的设施' }
  if (!economy || typeof economy !== 'object' || !validEconomy(economy)) return { ok: false, error: '经济数据无效' }
  const cost = facilityUpgradeCost(id, economy[id])
  if (cost === null) return { ok: false, error: '设施已达到最高等级' }
  if (economy.balance < cost) return { ok: false, error: '余额不足' }
  economy.balance -= cost
  economy[id]++
  return { ok: true }
}

/** Call once for each completed round, in increasing order. Skipped rounds are not paid retroactively. */
export function awardRoundIncome(game: GameState, round: number): number {
  const economy = economyOf(game)
  if (!economy || typeof economy !== 'object' || !validEconomy(economy) ||
      !whole(round, 1, Number.MAX_SAFE_INTEGER) || round <= economy.lastIncomeRound) return 0
  const won = game.season.fixtures.some(fixture => {
    if (fixture.round !== round || fixture.isPlayer !== true || fixture.played !== true) return false
    const home = fixture.homeId === 'player'
    const away = fixture.awayId === 'player'
    const score = fixture.score
    if (home === away || !score || !whole(score.home, 0, Number.MAX_SAFE_INTEGER) ||
        !whole(score.away, 0, Number.MAX_SAFE_INTEGER)) return false
    return home ? score.home > score.away : score.away > score.home
  })
  const income = BASE_ROUND_INCOME + ids.reduce((sum, id) => sum + FACILITIES[id].incomePerLevel * economy[id], 0) +
    (won ? LEAGUE_WIN_BONUS : 0)
  if (!Number.isSafeInteger(economy.balance + income)) return 0
  economy.balance += income
  economy.lastIncomeRound = round
  return income
}
