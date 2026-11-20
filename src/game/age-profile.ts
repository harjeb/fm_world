import type { Lineup, Player, Tactics } from './types.ts'
import type { TacticalInstructionsV2 } from './pes/tactics.ts'
import { FORMATIONS } from './data/formations.ts'

export type AgeStageId = 'rookie' | 'rising' | 'emerging' | 'prime' | 'mature' | 'veteran' | 'elder'

export interface AgeProfile {
  age: number | null
  effectiveAge: number
  isGoalkeeper: boolean
  stageId: AgeStageId
  stageLabel: string
  /** 个体战术执行度（familiarity）基础修正。 */
  tacticalFamiliarityDelta: number
  /** 高强度逼抢/反抢/快节奏指令下的额外执行度修正（门将恒为 0）。 */
  highIntensityFamiliarityDelta: number
  /** 常规传球成功率修正（百分点，0.02 = +2%）。 */
  passDelta: number
  /** 受压出球成功率修正。 */
  pressuredPassDelta: number
  /** 1v1 盘带过人成功率修正。 */
  dribbleDelta: number
  /** 1v1 贴身抢断对抗（防守方）成功率修正。 */
  tackleDelta: number
  /** 常规射门终结 / 门将常规扑救判断修正。 */
  shotDelta: number
  /** 关键球（单刀 / 点球 / 75 分钟后）终结或门将扑救修正。 */
  clutchShotDelta: number
  /** 犯规后吃牌概率倍率（1 = 基准，>1 更容易吃牌，<1 更老练克制）。 */
  cardScale: number
  /** 低体力时的动作稳定性修正（满额，随体力低于阈值后线性生效）。 */
  lowStaminaDelta: number
  /** 常规低体力生效阈值（体能比例）；外场 32+ 老将在高强度战术下提前到 0.55。 */
  lowStaminaThreshold: number
  /** 简洁中文说明，供界面与 Agent API 展示。 */
  summary: string
}

export interface LineupAgeAnalysis {
  averageAge: number
  youngCount: number
  primeCount: number
  veteranCount: number
  highIntensity: boolean
  tips: string[]
}

type CurvePoint = readonly [number, number]

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000

function interpolate(x: number, points: readonly CurvePoint[]): number {
  if (x <= points[0][0]) return points[0][1]
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]
    if (x <= x1) {
      const [x0, y0] = points[i - 1]
      const t = (x - x0) / Math.max(1e-9, x1 - x0)
      return y0 + (y1 - y0) * t
    }
  }
  return points[points.length - 1][1]
}

const FAMILIARITY_CURVE: readonly CurvePoint[] = [
  [16, -0.08],
  [19, -0.05],
  [21, -0.03],
  [23, -0.01],
  [24, 0],
  [29, 0],
  [31, 0.03],
  [34, 0.05],
  [36, 0.06],
]

const HIGH_INTENSITY_CURVE: readonly CurvePoint[] = [
  [16, 0.04],
  [21, 0.04],
  [23, 0.03],
  [24, 0],
  [30, 0],
  [31, -0.02],
  [32, -0.05],
  [34, -0.07],
  [35, -0.10],
  [37, -0.11],
]

const PASS_CURVE: readonly CurvePoint[] = [
  [16, -0.025],
  [19, -0.025],
  [21, -0.010],
  [23, 0],
  [29, 0],
  [31, 0.015],
  [34, 0.025],
  [36, 0.030],
]

const PRESSURED_PASS_CURVE: readonly CurvePoint[] = [
  [16, -0.035],
  [19, -0.035],
  [21, -0.015],
  [23, 0],
  [29, 0],
  [31, 0.020],
  [34, 0.030],
  [36, 0.035],
]

const DRIBBLE_CURVE: readonly CurvePoint[] = [
  [16, 0.020],
  [19, 0.020],
  [21, 0.015],
  [23, 0.010],
  [24, 0],
  [29, 0],
  [31, -0.010],
  [34, -0.030],
  [36, -0.050],
]

const TACKLE_CURVE: readonly CurvePoint[] = [
  [16, 0.010],
  [19, 0.010],
  [21, 0.005],
  [23, 0.005],
  [24, 0],
  [29, 0],
  [31, -0.005],
  [34, -0.020],
  [36, -0.040],
]

const SHOT_CURVE: readonly CurvePoint[] = [
  [16, -0.025],
  [19, -0.025],
  [21, -0.010],
  [23, 0],
  [29, 0],
  [31, 0.015],
  [34, 0.020],
  [36, 0.020],
]

const CLUTCH_SHOT_CURVE: readonly CurvePoint[] = [
  [16, -0.035],
  [19, -0.035],
  [21, -0.015],
  [23, 0],
  [29, 0],
  [31, 0.020],
  [34, 0.030],
  [36, 0.035],
]

const CARD_SCALE_CURVE: readonly CurvePoint[] = [
  [16, 1.15],
  [19, 1.15],
  [21, 1.08],
  [23, 1.00],
  [29, 1.00],
  [31, 0.92],
  [34, 0.86],
  [36, 0.82],
]

const LOW_STAMINA_CURVE: readonly CurvePoint[] = [
  [16, 0.010],
  [19, 0.010],
  [21, 0.005],
  [23, 0],
  [29, 0],
  [31, -0.010],
  [34, -0.025],
  [36, -0.045],
]

const NEUTRAL_PROFILE: AgeProfile = {
  age: null,
  effectiveAge: 25,
  isGoalkeeper: false,
  stageId: 'prime',
  stageLabel: '黄金巅峰',
  tacticalFamiliarityDelta: 0,
  highIntensityFamiliarityDelta: 0,
  passDelta: 0,
  pressuredPassDelta: 0,
  dribbleDelta: 0,
  tackleDelta: 0,
  shotDelta: 0,
  clutchShotDelta: 0,
  cardScale: 1,
  lowStaminaDelta: 0,
  lowStaminaThreshold: 0.45,
  summary: '黄金巅峰：战术执行与各项动作成功率均衡稳定。',
}

function stageFor(effectiveAge: number): { id: AgeStageId; label: string } {
  if (effectiveAge <= 19) return { id: 'rookie', label: '青涩新星' }
  if (effectiveAge <= 21) return { id: 'rising', label: '活力新锐' }
  if (effectiveAge <= 23) return { id: 'emerging', label: '上升期' }
  if (effectiveAge <= 29) return { id: 'prime', label: '黄金巅峰' }
  if (effectiveAge <= 31) return { id: 'mature', label: '成熟核心' }
  if (effectiveAge <= 34) return { id: 'veteran', label: '经验老将' }
  return { id: 'elder', label: '高龄名宿' }
}

const fmtPct = (v: number): string => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1).replace(/\.0$/, '')}%`

function buildSummary(profile: Omit<AgeProfile, 'summary'>): string {
  switch (profile.stageId) {
    case 'rookie':
    case 'rising':
      return profile.isGoalkeeper
        ? `${profile.stageLabel}：门将经验偏浅，战术协同 ${fmtPct(profile.tacticalFamiliarityDelta)}，高压出球与关键扑救 ${fmtPct(profile.clutchShotDelta)}。`
        : `${profile.stageLabel}：有冲劲（过人 ${fmtPct(profile.dribbleDelta)} / 高压逼抢 ${fmtPct(profile.highIntensityFamiliarityDelta)}），但战术执行 ${fmtPct(profile.tacticalFamiliarityDelta)}，关键球与吃牌控制偏青涩。`
    case 'emerging':
      return profile.isGoalkeeper
        ? `${profile.stageLabel}：已接近门将黄金期，整体执行稳定。`
        : `${profile.stageLabel}：活力充沛（过人 ${fmtPct(profile.dribbleDelta)} / 高压逼抢 ${fmtPct(profile.highIntensityFamiliarityDelta)}），战术执行接近基准。`
    case 'prime':
      return `${profile.stageLabel}：战术执行与各项动作成功率均衡稳定。`
    case 'mature':
      return profile.isGoalkeeper
        ? `${profile.stageLabel}：战术协同 ${fmtPct(profile.tacticalFamiliarityDelta)}，受压出球与关键扑救 ${fmtPct(profile.clutchShotDelta)}。`
        : `${profile.stageLabel}：战术执行 ${fmtPct(profile.tacticalFamiliarityDelta)}，传球/关键球 ${fmtPct(profile.clutchShotDelta)}，1v1 过人略降（${fmtPct(profile.dribbleDelta)}）。`
    case 'veteran':
    case 'elder':
      return profile.isGoalkeeper
        ? `${profile.stageLabel}：战术协同 ${fmtPct(profile.tacticalFamiliarityDelta)}，出球与关键扑救 ${fmtPct(profile.clutchShotDelta)}，低体力稳定性 ${fmtPct(profile.lowStaminaDelta)}。`
        : `${profile.stageLabel}：战术执行 ${fmtPct(profile.tacticalFamiliarityDelta)}，受压传球/关键球 ${fmtPct(profile.clutchShotDelta)}；1v1 过人 ${fmtPct(profile.dribbleDelta)}、对抗 ${fmtPct(profile.tackleDelta)}，高压逼抢与低体力稳定性衰减。`
  }
}

/** 球队是否启用了高强度压迫/反抢/快节奏战术。 */
export function isHighIntensityTactics(tactics?: Tactics | null, instructions?: TacticalInstructionsV2 | null): boolean {
  if (instructions) {
    return instructions.defense.intensity === 'high'
      || instructions.transition.onLoss === 'counterpress'
      || instructions.possession.tempo === 'fast'
  }
  if (!tactics) return false
  return tactics.press === 'high' || tactics.tempo === 'fast'
}

/**
 * 计算球员的年龄战术与动作成功率修正曲线（方案 A）：
 * - 不修改任何面板属性，仅作用于战术执行度与动作成功率；
 * - 门将等效年龄延后 3 岁；
 * - 旧存档缺失 age 时返回零修正基准，确保历史回放完全兼容。
 */
export function ageProfileOf(age: number | undefined, isGk = false): AgeProfile {
  if (typeof age !== 'number' || !Number.isFinite(age)) {
    return isGk ? { ...NEUTRAL_PROFILE, isGoalkeeper: true } : NEUTRAL_PROFILE
  }
  const effectiveAge = isGk ? Math.max(16, age - 3) : Math.max(16, age)
  const stage = stageFor(effectiveAge)
  const core: Omit<AgeProfile, 'summary'> = {
    age,
    effectiveAge,
    isGoalkeeper: isGk,
    stageId: stage.id,
    stageLabel: stage.label,
    tacticalFamiliarityDelta: round4(interpolate(effectiveAge, FAMILIARITY_CURVE)),
    highIntensityFamiliarityDelta: isGk ? 0 : round4(interpolate(effectiveAge, HIGH_INTENSITY_CURVE)),
    passDelta: round4(interpolate(effectiveAge, PASS_CURVE)),
    pressuredPassDelta: round4(interpolate(effectiveAge, PRESSURED_PASS_CURVE)),
    dribbleDelta: round4(interpolate(effectiveAge, DRIBBLE_CURVE)),
    tackleDelta: round4(interpolate(effectiveAge, TACKLE_CURVE)),
    shotDelta: round4(interpolate(effectiveAge, SHOT_CURVE)),
    clutchShotDelta: round4(interpolate(effectiveAge, CLUTCH_SHOT_CURVE)),
    cardScale: round4(interpolate(effectiveAge, CARD_SCALE_CURVE)),
    lowStaminaDelta: round4(interpolate(effectiveAge, LOW_STAMINA_CURVE)),
    lowStaminaThreshold: 0.45,
  }
  return { ...core, summary: buildSummary(core) }
}

/** 个体战术执行度（在球队基础熟悉度上叠加年龄与高强度战术适配，钳制到 [0.45, 1.00]）。 */
export function effectivePlayerFamiliarity(
  baseFamiliarity: number,
  age: number | undefined,
  isGk: boolean,
  highIntensity: boolean,
): number {
  if (typeof age !== 'number' || !Number.isFinite(age)) return baseFamiliarity
  const profile = ageProfileOf(age, isGk)
  const delta = profile.tacticalFamiliarityDelta + (highIntensity ? profile.highIntensityFamiliarityDelta : 0)
  return Math.round(clamp(baseFamiliarity + delta, 0.45, 1) * 1000) / 1000
}

/** 低体力下的动作稳定性修正：体力低于阈值后线性生效，外场 32+ 老将在高强度战术下提前至 55% 触发。 */
export function lowStaminaStabilityDelta(
  age: number | undefined,
  isGk: boolean,
  staminaRatio: number,
  highIntensity: boolean,
): number {
  if (typeof age !== 'number' || !Number.isFinite(age)) return 0
  const profile = ageProfileOf(age, isGk)
  if (profile.lowStaminaDelta === 0) return 0
  const threshold = !isGk && age >= 32 && highIntensity ? 0.55 : profile.lowStaminaThreshold
  if (staminaRatio >= threshold) return 0
  const severity = clamp((threshold - staminaRatio) / Math.max(0.05, threshold - 0.15), 0, 1)
  return round4(profile.lowStaminaDelta * severity)
}

/** 阵容年龄结构分析与教练建议（用于战术页与 Agent API 透出）。 */
export function lineupAgeAnalysis(roster: Player[], lineup: Lineup): LineupAgeAnalysis {
  const byId = new Map(roster.map((player) => [player.id, player]))
  const formation = FORMATIONS[lineup.formationId]
  const highIntensity = isHighIntensityTactics(lineup.tactics, lineup.tacticalInstructions)
  const ages: number[] = []
  let youngCount = 0
  let primeCount = 0
  let veteranCount = 0
  let outfieldVeteranCount = 0
  for (const starter of lineup.starters) {
    const player = byId.get(starter.playerId)
    if (!player) continue
    const slot = formation?.slots.find((item) => item.id === starter.slotId)
    const isGk = slot ? slot.position === 'GK' : player.positions.GK > 0
    const age = player.age ?? 24
    ages.push(age)
    const profile = ageProfileOf(age, isGk)
    if (profile.stageId === 'rookie' || profile.stageId === 'rising') youngCount++
    else if (profile.stageId === 'veteran' || profile.stageId === 'elder') {
      veteranCount++
      if (!isGk) outfieldVeteranCount++
    } else primeCount++
  }
  const averageAge = ages.length ? Math.round((ages.reduce((sum, v) => sum + v, 0) / ages.length) * 10) / 10 : 24
  const tips: string[] = []
  if (highIntensity && outfieldVeteranCount >= 3) {
    tips.push(`首发含 ${outfieldVeteranCount} 名 32 岁以上外场老将且启用了高压/快节奏战术，下半场体力降到 55% 以下时动作稳定性衰减更快，建议调稳节奏或设置自动换人。`)
  }
  if (youngCount >= 4 && lineup.tacticalInstructions) {
    tips.push(`首发含 ${youngCount} 名 21 岁以下年轻球员，复杂战术执行度与关键球稳定性偏青涩，可搭配 1–2 名经验球员稳住中轴。`)
  }
  return { averageAge, youngCount, primeCount, veteranCount, highIntensity, tips }
}
