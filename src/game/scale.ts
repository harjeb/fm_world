import { GK_ATTRIBUTES, type AttrKey } from './types.ts'

/** 存档中的主属性基础 0-1500（奖励可叠加到 2000），隐藏属性 0-20。 */
export const MAIN_FIELD_ATTRS = ['passing', 'shooting', 'dribbling', 'tackling', 'strength', 'speed', 'acceleration'] as const
export const MAIN_GK_ATTRS = ['reflexes', 'handling', 'rushing', 'oneOnOne', 'passing', 'composure'] as const

export const MAIN_ATTR_SCALE = 15
export const HIDDEN_ATTR_SCALE = 5
export const MAIN_ATTR_MAX = 1500
export const MAIN_ATTR_HARD_MAX = 2000
export const HIDDEN_ATTR_MAX = 20
export const CA_MAX = 2000
export const MAX_ATTR_RATING = 100 * MAIN_ATTR_HARD_MAX / MAIN_ATTR_MAX

export type MainAttr = (typeof MAIN_FIELD_ATTRS)[number] | (typeof MAIN_GK_ATTRS)[number]

export function mainAttrsFor(gk: boolean): readonly AttrKey[] {
  return gk ? MAIN_GK_ATTRS : MAIN_FIELD_ATTRS
}

export function isMainAttr(key: AttrKey, gk: boolean): boolean {
  return (mainAttrsFor(gk) as readonly string[]).includes(key)
}

export function attrMax(key: AttrKey, gk: boolean): number {
  return isMainAttr(key, gk) ? MAIN_ATTR_MAX : HIDDEN_ATTR_MAX
}

/**
 * 该属性对这名球员的**可用**上限。
 *
 * 与 `attrMax` 的区别只在一种情况：外场球员的门将属性（反应/手控球/出击/一对一）
 * 根本用不上，上限记 0。`normalizeCeilings` 会把 0 当成「缺失」抬到绝对上限，
 * 所以凡是「把 0 也当合法值」的调用方（生成球员、旧存档回填）都该用这个。
 */
export function attrLimit(key: AttrKey, gk: boolean): number {
  return !gk && (GK_ATTRIBUTES as readonly string[]).includes(key) ? 0 : attrMax(key, gk)
}

/** 道具/技能叠加后的硬上限；基础生成仍用 attrLimit。 */
export function attrHardLimit(key: AttrKey, gk: boolean): number {
  if (!gk && (GK_ATTRIBUTES as readonly string[]).includes(key)) return 0
  return isMainAttr(key, gk) ? MAIN_ATTR_HARD_MAX : HIDDEN_ATTR_MAX
}

/** 把存档值换成 0-100 的比赛/角色评分。 */
export function attrRating(key: AttrKey, value: number, gk: boolean): number {
  return isMainAttr(key, gk) ? value / MAIN_ATTR_SCALE : value * HIDDEN_ATTR_SCALE
}

/** 把 0-100 的生成值换成存档值。 */
export function attrStorage(key: AttrKey, rating: number, gk: boolean): number {
  return isMainAttr(key, gk) ? rating * MAIN_ATTR_SCALE : rating / HIDDEN_ATTR_SCALE
}

/** 事件/训练文本里的 +1/+2 是“点数”：主属性 ×15，隐藏属性原样。 */
export function authoredGain(key: AttrKey, points: number, gk: boolean): number {
  return isMainAttr(key, gk) ? points * MAIN_ATTR_SCALE : points
}

export function scaleAuthoredGains(gains: Partial<Record<AttrKey, number>>, gk: boolean): Partial<Record<AttrKey, number>> {
  const out: Partial<Record<AttrKey, number>> = {}
  for (const [key, value] of Object.entries(gains) as [AttrKey, number][]) {
    out[key] = authoredGain(key, value, gk)
  }
  return out
}
