/**
 * 我们的 22 个属性（0–100 评分）→ pes2d 运动层的 9 个合成能力（0–1）。计划 4.2。
 *
 * 换算：先把每个属性线性映射到 0–1（典型球员落在 0.65 附近），再按 4.2 的公式加权合成。
 * `abilityOf` 保留纯属性校准入口；游戏层用 `MotionRatings.abilities` 加入位置、伤病和特性。
 * 运动能力不再扣体力（物理层已处理疲劳）；接触点技能和成败仍由结算内核处理。
 *
 * 运动层只负责“跑得多快、拿球多稳”这类演出；传球 / 射门 / 抢断的**成败**由结算内核按原始属性裁决（计划 3、4）。
 */
import type { TraitCondition } from '../data/star-traits.ts'
import { MatchRatings } from '../match/ratings.ts'
import { legendMultiplier } from '../legend-bonus.ts'
import { progressOf, wideZone } from '../match/pitch.ts'
import type { MatchEventContext, MatchPlayerState } from '../match/types.ts'
import { ALL_ATTRIBUTES, type AttrKey } from '../types.ts'
import type { Abilities } from './spec.ts'

/** Shared effective ratings, without applying the physics layer's fatigue penalty twice. */
export class MotionRatings extends MatchRatings {
  private readonly livePlayers = new WeakMap<MatchPlayerState, MatchPlayerState>()

  abilities(player: MatchPlayerState, ctx: MatchEventContext = {}): Abilities {
    const rested = { ...player, stamina: player.maxStamina }
    this.livePlayers.set(rested, player)
    const attrs: AttrRecord = {}
    for (const key of ALL_ATTRIBUTES) attrs[key] = this.eff(rested, key, ctx)
    const abilities = abilityOf(attrs)
    let stamina = abilities.stamina
    if (player.skills.includes('lg_marathon')) stamina += 0.08 * legendMultiplier(player, 'lg_marathon')
    if (player.skills.includes('lg_second_half_legs') && this.matchProgress() >= 0.5) stamina += 0.15 * legendMultiplier(player, 'lg_second_half_legs')
    if (player.position === 'GK' && player.skills.includes('lg_gk_economy')) stamina += 0.08 * legendMultiplier(player, 'lg_gk_economy')
    if (player.skills.includes('lg_defensive_economy') && progressOf(player.side, player.x) < 0.5) stamina += 0.2 * legendMultiplier(player, 'lg_defensive_economy')
    if (player.skills.includes('lg_off_ball_economy') && !ctx.inBox) stamina += 0.15 * legendMultiplier(player, 'lg_off_ball_economy')
    if (player.skills.includes('lg_press_machine')) stamina += 0.15 * legendMultiplier(player, 'lg_press_machine')
    if (player.skills.includes('lg_wing_engine') && wideZone(player)) stamina += 0.2 * legendMultiplier(player, 'lg_wing_engine')
    if (player.skills.includes('lg_stamina_regen')) stamina += 0.1 * legendMultiplier(player, 'lg_stamina_regen')
    abilities.stamina = clamp01(stamina)
    return abilities
  }

  override traitConditionMet(player: MatchPlayerState, when: TraitCondition, ctx: MatchEventContext = {}): boolean {
    // Only effectiveAttr sees full stamina. Fresh/tired traits still see the live player;
    // aura carriers (which aren't the temporary copy) retain their own conditions too.
    return super.traitConditionMet(this.livePlayers.get(player) ?? player, when, ctx)
  }
}

export type AttrRecord = Partial<Record<AttrKey, number>>

export interface AbilityCalibration {
  /** 典型球员的评分均值，换算后为 0.65 */
  anchor: number
  /** 每点评分对应的能力变化 */
  slope: number
  /** 速度类（speed / acceleration / agility）单独的斜率，阶段 4 用来防止“速度为王” */
  motionSlope: number
  /** 逐属性的影响权重（阶段 4 / 5 的校准结果放这里），缺省为 1 */
  weights: Partial<Record<AttrKey, number>>
  /** 全局灵敏度，缺省为 1 */
  global: number
}

export const DEFAULT_ABILITY_CALIBRATION: AbilityCalibration = {
  anchor: 38.3,
  slope: 0.009,
  motionSlope: 0.009,
  weights: {},
  global: 1,
}

const MOTION_KEYS: ReadonlySet<string> = new Set(['speed', 'acceleration', 'agility'])

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value)

/** 单个属性 → 0–1 能力。 */
export function skillOf(key: AttrKey, rating: number, calib: AbilityCalibration = DEFAULT_ABILITY_CALIBRATION): number {
  const slope = MOTION_KEYS.has(key) ? calib.motionSlope : calib.slope
  return clamp01(0.65 + (rating - calib.anchor) * slope * (calib.weights[key] ?? 1) * calib.global)
}

export function abilityOf(attrs: AttrRecord, calib: AbilityCalibration = DEFAULT_ABILITY_CALIBRATION): Abilities {
  const s = (key: AttrKey): number => skillOf(key, attrs[key] ?? calib.anchor, calib)
  return {
    pace: clamp01(s('speed') * 0.85 + s('acceleration') * 0.15),
    accel: clamp01(s('acceleration') * 0.7 + s('agility') * 0.3),
    stamina: s('endurance'),
    control: clamp01(s('firstTouch') * 0.4 + s('dribbling') * 0.35 + s('agility') * 0.15 + s('composure') * 0.1),
    passing: s('passing'),
    shooting: s('shooting'),
    tackling: s('tackling'),
    positioning: clamp01(s('defPos') * 0.35 + s('anticipation') * 0.25 + s('decisions') * 0.25 + s('teamwork') * 0.15),
    handling: clamp01(s('reflexes') * 0.5 + s('handling') * 0.3 + s('rushing') * 0.2),
    air: clamp01(s('heading') * 0.7 + s('strength') * 0.3),
  }
}
