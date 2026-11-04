import type { AttrKey } from './types.ts'

/** 存档中的主属性 0-1500，隐藏属性 0-20。 */
export const MAIN_FIELD_ATTRS = ['passing', 'shooting', 'dribbling', 'tackling', 'strength', 'speed'] as const
export const MAIN_GK_ATTRS = ['reflexes', 'handling', 'rushing', 'oneOnOne', 'passing', 'composure'] as const

export const MAIN_ATTR_SCALE = 15
export const HIDDEN_ATTR_SCALE = 5
export const MAIN_ATTR_MAX = 1500
export const HIDDEN_ATTR_MAX = 20
export const CA_MAX = 1500

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
