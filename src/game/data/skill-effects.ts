import type { BaseTraitId, SkillId, SkillTier, TraitEffect, TraitId } from '../types.ts'
import { MAIN_ATTR_SCALE } from '../scale.ts'
import { TRAITS } from './skills.ts'
import { LEGEND_SKILLS } from './legend-skills.ts'
import { PEAK_SKILLS } from './peak-skills.ts'
import { starTraitOf, starTraitText } from './star-traits.ts'

/**
 * 给玩家看的技能和特性效果说明。
 * 数字来自 match/engine.ts 和 match/team.ts 里的实际结算，改那边的数值时这里要跟着改。
 * “成功率约 +x%” 是按常见局面（成功率 60%–75%）估算的，实际随局面变化。
 */

const TIER_MULTIPLIER: Record<SkillTier, number> = { silver: 1, gold: 1.2, rainbow: 1.4 }

/** 去掉浮点误差和多余的 0：4.800000000000001 → 4.8。 */
const num = (value: number) => String(Math.round(value * 10) / 10)

const SKILL_EFFECTS: Partial<Record<SkillId, (m: number) => string>> = {
  through_ball: (m) => `直塞时：传球评分 +${num(5 * m)}，成功率约 +${num(3.5 * m)}%。`,
  safe_pass: (m) => `受压时短传：传球评分 +${num(4 * m)}，成功率约 +${num(2.5 * m)}%。`,
  one_touch: (m) => `身边没人逼抢、接球后直接传：处理时间缩短 ${num(m)} 秒。`,
  box_hunter: (m) => `在禁区内起脚：射正率 +${num(4 * m)}%，进球率 +${num(3 * m)}%。`,
  long_shot: (m) => `在禁区外起脚：射正率 +${num(3.5 * m)}%，进球率 +${num(2 * m)}%。`,
  weak_foot: (m) => `更敢用逆足（使用机会 +${num(12 * m)}%）。逆足射门射正率 +${num(2 * m)}%，逆足传球成功率约 +${num(2 * m)}%，逆足惩罚减轻。`,
  sweeper: (m) => `亲自拦截或抢断时：防守评分 +${num(3 * m)} 到 +${num(4 * m)}，对手成功率约 -${num(2.5 * m)}%。`,
  iron_lung: (m) => `跑动时的体力消耗 -${num(5 + (m - 1) * 25)}%。`,
  aerial: (m) => `争顶高空球时：争顶评分 +${num(5 * m)}。`,
  wing_runner: (m) => `在边路盘带：盘带评分 +${num(5 * m)}，成功率约 +${num(3 * m)}%。`,
  gk_sweeper: (m) => `防守时门将会上前出击，最远离门线约 ${num(24 * m)} 米。`,
  gk_reflexes: (m) => `面对射门：扑救评分 +${num(5 * m)}，对手进球率约 -${num(1.5 * m)}%。`,
  injury_prevention: (m) => `比赛中的受伤风险 -${num(30 * m)}%。`,
  injury_resilience: (m) => `受伤后的恢复时间 -${num(30 * m)}%。`,
  penalty_specialist: (m) => `主罚点球：射正率 +${num(5 * m)}%，进球率 +${num(4 * m)}%；点球大战命中率 +${num(6 * m)}%。`,
}

export function skillEffectText(id: SkillId, tier: SkillTier = 'silver'): string {
  const fn = SKILL_EFFECTS[id]
  if (fn) return fn(TIER_MULTIPLIER[tier])
  const legend = LEGEND_SKILLS[id as keyof typeof LEGEND_SKILLS] as { effect?: string } | undefined
  const peak = PEAK_SKILLS[id as keyof typeof PEAK_SKILLS] as { effect?: string } | undefined
  const effect = legend?.effect ?? peak?.effect
  if (!effect) return ''
  const text = effect.replace(/(\d+\.\d{2,})/g, (_match, value: string) => String(Math.round(Number(value) * 10) / 10))
  return `${text}（金 ×1 / 彩 ×1.4）`
}

/** 铁肺不是按倍数算的，单独说明。 */
export function skillTierNote(id: SkillId): string {
  return id === 'iron_lung' ? '等级效果：银 5% / 金 10% / 彩虹 15%' : '等级效果：银 ×1 / 金 ×1.2 / 彩虹 ×1.4'
}

/** Describe the attribute effect and value without exposing engine-scale labels. */
const main = (value: number) => `+${num(value * MAIN_ATTR_SCALE)}`
const hidden = (value: number) => `+${num(value)}`

const TRAIT_EFFECTS: Record<TraitEffect, (value: number) => string> = {
  vision: (v) => `传球或进入前场时：视野 ${hidden(v)}。`,
  finishing: (v) => `在禁区内射门时：射术 ${main(v)}。`,
  dribbling: (v) => `盘带 ${main(v)}。`,
  tackling: (v) => `抢断 ${main(v)}。`,
  aerial: (v) => `争顶时：力量 ${main(v)}，头球 ${hidden(v)}。`,
  pace: (v) => `加速 ${hidden(v * 0.5)}。`,
  stamina: (v) => `跑动时的体力消耗 -${num(v)}%。`,
  gkWall: (v) => `扑救反应 ${main(v)}。`,
  gkSweep: (v) => `出击 ${main(v)}。`,
  cross: (v) => `传中时：传球 ${main(v)}。`,
  link: (v) => `在前场接球时：第一脚触球 ${hidden(v)}。`,
  overlap: (v) => `在边路时：无球跑位和加速 ${hidden(v)}。`,
}

export function traitEffectText(id: TraitId): string {
  const star = starTraitOf(id)
  if (star) return starTraitText(star)
  const trait = TRAITS[id as BaseTraitId]
  return trait ? TRAIT_EFFECTS[trait.effect](trait.value) : ''
}
