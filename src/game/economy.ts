import type { EconomyState, FacilityId, GameState } from './types.ts'
export type { EconomyState, FacilityId } from './types.ts'

/** 每个等级拆成 5 个阶段，所以五个等级一共 25 个阶段。 */
export const STAGES_PER_LEVEL = 5
export const MAX_FACILITY_LEVEL = 5
export const MAX_FACILITY_STAGE = STAGES_PER_LEVEL * MAX_FACILITY_LEVEL
/** 存档里的设施数值从“等级”改成“阶段”的版本号；3 加了心理/战术两座设施。 */
export const FACILITY_STAGE_VERSION = 3

export const STARTING_FANS = 1200
export const MAX_FANS = 150000
export const BASE_ROUND_INCOME = 1500
export const LEAGUE_WIN_BONUS = 1000
export const GOAL_INCOME_BONUS = 500

export const FACILITIES: Record<FacilityId, { label: string; baseCost: number; incomePerLevel: number }> = {
  stadium: { label: '球场', baseCost: 18000, incomePerLevel: 5000 },
  academy: { label: '青训学院', baseCost: 11000, incomePerLevel: 0 },
  medical: { label: '医疗中心', baseCost: 9000, incomePerLevel: 0 },
  // 球迷商店和赞助商只提收收入（余额），不再提供属性成长。
  shop: { label: '球迷商店', baseCost: 11000, incomePerLevel: 3000 },
  sponsor: { label: '赞助商', baseCost: 13000, incomePerLevel: 4000 },
  // 取代它们原来培养加成的两座设施：同样消耗余额，但只影响培养。
  psychology: { label: '心理辅导室', baseCost: 11000, incomePerLevel: 0 },
  tactics: { label: '战术研究室', baseCost: 12000, incomePerLevel: 0 },
}

/** 阶段在等级内的费用倍率：第 5 阶段会升到下个等级，所以明显更贵。 */
const STAGE_COST_MULTIPLIER = [1, 1.3, 1.7, 2.2, 3.4]

/**
 * 每个等级第 1 阶段的触发概率；同名次阶段按等级递增，避免升级后概率倒挂。
 * 等级内概率从该下限线性升到第 5 阶段的 100%。
 */
const LEVEL_CHANCE_FLOOR = [0.2, 0.5, 0.7, 0.8, 0.85]

/** 未升级过的设施从第 1 阶段（1 级第 1 阶段）开始。 */
export const STARTING_FACILITY_STAGE = 1

const ids = Object.keys(FACILITIES) as FacilityId[]
const validId = (id: unknown): id is FacilityId => typeof id === 'string' && Object.hasOwn(FACILITIES, id)
const whole = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max

const clampStage = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(MAX_FACILITY_STAGE, Math.max(1, Math.round(value))) : 1

/** 阶段对应的等级（LV1–LV5）。 */
export function facilityLevel(stage: number): number {
  return Math.ceil(clampStage(stage) / STAGES_PER_LEVEL)
}

/** 当前等级内的第几个阶段（1–5）。 */
export function facilityStageInLevel(stage: number): number {
  return ((clampStage(stage) - 1) % STAGES_PER_LEVEL) + 1
}

/**
 * 该阶段每次培养/事件触发属性成长的概率。
 * 每个等级的第 5 阶段必定触发；等级内其余阶段从该等级的下限线性上升，
 * 且下限随等级提高，所以升级不会让期望成长倒退。
 */
export function facilityStageChance(stage: number): number {
  const level = facilityLevel(stage)
  const step = facilityStageInLevel(stage)
  if (step === STAGES_PER_LEVEL) return 1
  const floor = LEVEL_CHANCE_FLOOR[level - 1]
  return floor + (1 - floor) * (step - 1) / (STAGES_PER_LEVEL - 1)
}

export const validEconomy = (e: EconomyState): boolean =>
  !!e && typeof e === 'object' && whole(e.balance, 0, Number.MAX_SAFE_INTEGER) &&
  whole(e.fans, 0, MAX_FANS) && whole(e.lastIncomeRound, 0, Number.MAX_SAFE_INTEGER) &&
  ids.every(id => whole(e[id], 1, MAX_FACILITY_STAGE))

/** 旧存档的迁移：1–5 级换成阶段；旧的商店/赞助商阶段同步给新的心理/战术设施。 */
function migrateStages(e: EconomyState): boolean {
  if (e.stageVersion === FACILITY_STAGE_VERSION) return false
  const fromLevels = e.stageVersion !== 2
  for (const id of ids) {
    if (id === 'psychology' || id === 'tactics') continue
    const value = e[id]
    e[id] = fromLevels
      ? (whole(value, 1, MAX_FACILITY_LEVEL) ? value : 1) * STAGES_PER_LEVEL
      : clampStage(value)
  }
  // v2 存档里商店/赞助商同时管收入和培养；拆出来以后由新设施接管培养部分。
  e.psychology = clampStage(e.shop)
  e.tactics = clampStage(e.sponsor)
  e.stageVersion = FACILITY_STAGE_VERSION
  return true
}

/** Returns the live economy, creating defaults for a save without one. */
export function economyOf(game: GameState): EconomyState {
  if (game.economy == null) {
    let completed = 0
    while (true) {
      const fixtures = game.season.fixtures.filter(fixture => fixture.round === completed + 1)
      if (!fixtures.length || fixtures.some(fixture => !fixture.played)) break
      completed++
    }
    game.economy = {
      balance: 100000,
      fans: STARTING_FANS,
      stageVersion: FACILITY_STAGE_VERSION,
      stadium: STARTING_FACILITY_STAGE,
      academy: STARTING_FACILITY_STAGE,
      medical: STARTING_FACILITY_STAGE,
      shop: STARTING_FACILITY_STAGE,
      sponsor: STARTING_FACILITY_STAGE,
      psychology: STARTING_FACILITY_STAGE,
      tactics: STARTING_FACILITY_STAGE,
      lastIncomeRound: completed,
    }
  } else {
    migrateStages(game.economy)
    if (game.economy.fans === undefined) {
      // 旧存档没有球迷字段：按已完成的赛季/轮数给予温和起始规模，不倒补旧收入。
      const rounds = Math.max(0, (Math.max(1, game.season?.index ?? 1) - 1) * 38 + game.economy.lastIncomeRound)
      game.economy.fans = Math.min(MAX_FANS, Math.round(STARTING_FANS * 1.04 ** Math.min(120, rounds)))
    }
  }
  return game.economy
}

/** 从当前阶段升到下一阶段的费用；已满级或数据无效时返回 null。 */
export function facilityUpgradeCost(id: FacilityId, stage: number): number | null {
  if (!validId(id) || !whole(stage, 1, MAX_FACILITY_STAGE - 1)) return null
  const level = facilityLevel(stage)
  const multiplier = STAGE_COST_MULTIPLIER[facilityStageInLevel(stage) - 1]
  return Math.round(FACILITIES[id].baseCost * level ** 1.8 * multiplier)
}

/** 当前球迷规模下该设施每轮提供的收入；阶段越高收入越高，球迷越多倍率越大。 */
export function facilityRoundIncome(economy: EconomyState, id: FacilityId): number {
  if (!validId(id)) return 0
  const stage = clampStage(economy[id])
  return Math.round(FACILITIES[id].incomePerLevel * stage / STAGES_PER_LEVEL * Math.min(4, economy.fans / 5000))
}

/** 尚未踢本轮比赛时的预计收入；进球及赢球奖金结算时另加。 */
export function projectedRoundIncome(economy: EconomyState): number {
  return Math.round(BASE_ROUND_INCOME + economy.fans * 2) + ids.reduce((sum, id) => sum + facilityRoundIncome(economy, id), 0)
}

/** 真实联赛赛果决定球迷变化，进球多/赢得多涨得更快；不让异常大比分刷爆经济。 */
export function fansAfterResult(fans: number, scored: number, conceded: number): number {
  const goals = Math.min(8, scored)
  const against = Math.min(8, conceded)
  const resultBonus = scored > conceded ? 100 : scored === conceded ? 40 : 0
  const gain = 40 + Math.floor(fans * 0.035) + goals * 40 + (goals - against) * 30 + resultBonus
  return Math.max(200, Math.min(MAX_FANS, Math.round(fans + gain)))
}

export function upgradeFacility(game: GameState, id: FacilityId): { ok: boolean; error?: string } {
  const economy = economyOf(game)
  if (!validId(id)) return { ok: false, error: '无效的设施' }
  if (!validEconomy(economy)) return { ok: false, error: '经济数据无效' }
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
  if (!validEconomy(economy) || !whole(round, 1, Number.MAX_SAFE_INTEGER) || round <= economy.lastIncomeRound) return 0
  const fixture = game.season.fixtures.find(item => item.round === round && item.isPlayer === true && item.played === true &&
    (item.homeId === 'player') !== (item.awayId === 'player') && item.score &&
    whole(item.score.home, 0, Number.MAX_SAFE_INTEGER) && whole(item.score.away, 0, Number.MAX_SAFE_INTEGER))
  const scored = fixture ? (fixture.homeId === 'player' ? fixture.score!.home : fixture.score!.away) : 0
  const conceded = fixture ? (fixture.homeId === 'player' ? fixture.score!.away : fixture.score!.home) : 0
  const oldFans = economy.fans
  const nextFans = fixture ? fansAfterResult(oldFans, scored, conceded) : oldFans
  const won = !!fixture && scored > conceded
  const income = projectedRoundIncome({ ...economy, fans: nextFans }) + Math.min(8, scored) * GOAL_INCOME_BONUS +
    (won ? LEAGUE_WIN_BONUS + Math.floor(nextFans * 0.35) : 0)
  if (!Number.isSafeInteger(economy.balance + income)) return 0
  economy.balance += income
  economy.fans = nextFans
  economy.lastFanChange = nextFans - oldFans
  economy.lastRoundIncome = income
  economy.lastIncomeRound = round
  return income
}
