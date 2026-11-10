import type { AttrKey, LegendSkillId, PeakSkillId } from '../types.ts'

export type { PeakSkillId }

export type PeakSkillDef = {
  id: PeakSkillId
  name: string
  desc: string
  condition: string
  cost: '低' | '中' | '高'
  scope: 'field' | 'gk'
  /** 学会时直接提升的两项主属性。 */
  pair: [AttrKey, AttrKey]
  current: number
  ceiling: number
  requires: { attr: AttrKey; gold: number; rainbow: number }[]
  effect: string
}

const peak = (
  id: PeakSkillId,
  name: string,
  scope: 'field' | 'gk',
  pair: [AttrKey, AttrKey],
  desc: string,
): PeakSkillDef => ({
  id, name, scope, pair,
  desc,
  condition: '在培养中成功学会',
  cost: '高',
  current: 100,
  ceiling: 50,
  requires: pair.map((attr) => ({ attr, gold: 900, rainbow: 900 })),
  effect: `学会时 ${pair[0]} / ${pair[1]} 当前 +100，上限 +50（当前夹到新上限）。`,
})

export const PEAK_SKILLS: Record<PeakSkillId, PeakSkillDef> = {
  lg_peak_striker: peak('lg_peak_striker', '射手直觉', 'field', ['shooting', 'dribbling'], '射门与盘带同时突破，直接获得 +100 当前属性。'),
  lg_peak_engine: peak('lg_peak_engine', '中场引擎', 'field', ['passing', 'acceleration'], '传球与加速同时突破，直接获得 +100 当前属性。'),
  lg_peak_wall: peak('lg_peak_wall', '铁壁', 'field', ['tackling', 'strength'], '抢断与力量同时突破，直接获得 +100 当前属性。'),
  lg_peak_wing: peak('lg_peak_wing', '边路爆点', 'field', ['speed', 'acceleration'], '速度与加速同时突破，直接获得 +100 当前属性。'),
  lg_peak_keeper: peak('lg_peak_keeper', '门神', 'gk', ['reflexes', 'handling'], '反应与手控球同时突破，直接获得 +100 当前属性。'),
}

/** 从第 80 关起每 5 关一本，共 5 本；每本固定。 */
export const PEAK_SKILL_STAGES: Record<number, PeakSkillId> = {
  80: 'lg_peak_striker',
  85: 'lg_peak_engine',
  90: 'lg_peak_wall',
  95: 'lg_peak_wing',
  100: 'lg_peak_keeper',
}

export const PEAK_SKILL_IDS = Object.keys(PEAK_SKILLS) as PeakSkillId[]

export function peakSkillForStage(stage: number): PeakSkillDef | undefined {
  const id = PEAK_SKILL_STAGES[stage]
  return id ? PEAK_SKILLS[id] : undefined
}

/** 给学习事件/书名用的联合定义。 */
export function bookDefFor(id: LegendSkillId | PeakSkillId) {
  return (PEAK_SKILLS as Record<string, PeakSkillDef | undefined>)[id] ?? undefined
}
