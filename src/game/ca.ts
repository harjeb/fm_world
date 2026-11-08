import type { AttrKey, Attributes, Player } from './types.ts'
import { FIELD_ATTRIBUTES, GK_ATTRIBUTES } from './types.ts'
import { attrMax, attrRating } from './scale.ts'

export const CA_SCALE = 1500
export const POSITION_FLOOR = 0.6
/** 位置熟练度达到这个数才算“可踢”这个位置；低于它不算（自动分配优先用可踢的人）。 */
export const PLAYABLE_PROFICIENCY = 80

export function isGoalkeeper(attrsOrPositions: Pick<Player, 'positions'> | { GK?: number }): boolean {
  if ('positions' in attrsOrPositions) return attrsOrPositions.positions.GK > 0
  return (attrsOrPositions.GK ?? 0) > 0
}

export function costAttrs(isGk: boolean): readonly AttrKey[] {
  return isGk ? [...FIELD_ATTRIBUTES, ...GK_ATTRIBUTES] : FIELD_ATTRIBUTES
}

export function caOf(attrs: Attributes, isGk: boolean): number {
  const keys = costAttrs(isGk)
  let sum = 0
  for (const key of keys) sum += (attrRating(key, attrs[key], isGk) / 100) ** 2
  return (CA_SCALE * sum) / keys.length
}

export function caCeilingOf(ceilings: Attributes, isGk: boolean): number {
  return caOf(ceilings, isGk)
}

export function paRoom(player: Pick<Player, 'attrs' | 'pa' | 'positions'>): number {
  return Math.max(0, player.pa - caOf(player.attrs, isGoalkeeper(player)))
}

export type GainResult = {
  attrs: Attributes
  actual: Partial<Record<AttrKey, number>>
  requested: Partial<Record<AttrKey, number>>
  caBefore: number
  caAfter: number
  scale: number
  cappedByCeiling: boolean
  cappedByPa: boolean
}

/**
 * 按给定参数截断成长；当前培养按属性类型使用 1500 或 20 上限和最大 CA，不使用球员 PA。
 * 内部保留小数，显示层再取整；预览与正式应用共用。
 */
export function applyGains(
  attrs: Attributes,
  ceilings: Attributes,
  pa: number,
  gains: Partial<Record<AttrKey, number>>,
  isGk: boolean,
): GainResult {
  const before = { ...attrs }
  const caBefore = caOf(before, isGk)
  const clipped: Partial<Record<AttrKey, number>> = {}
  let cappedByCeiling = false
  for (const [key, raw] of Object.entries(gains) as [AttrKey, number][]) {
    if (!raw || raw <= 0) continue
    const room = Math.max(0, ceilings[key] - before[key])
    const amount = Math.min(raw, room)
    if (amount < raw - 1e-9) cappedByCeiling = true
    if (amount > 0) clipped[key] = amount
  }
  const caAfterFull = caOf(addAttrs(before, clipped, isGk), isGk)
  if (caAfterFull <= pa + 1e-9) {
    const result = addAttrs(before, clipped, isGk)
    return {
      attrs: result,
      actual: clipped,
      requested: gains,
      caBefore,
      caAfter: caAfterFull,
      scale: 1,
      cappedByCeiling,
      cappedByPa: false,
    }
  }

  let lo = 0
  let hi = 1
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    const ca = caOf(addAttrs(before, scaleGains(clipped, mid), isGk), isGk)
    if (ca <= pa) lo = mid
    else hi = mid
  }
  const scale = Math.max(0, lo * (1 - 1e-12))
  const actual = scaleGains(clipped, scale)
  const result = addAttrs(before, actual, isGk)
  return {
    attrs: result,
    actual,
    requested: gains,
    caBefore,
    caAfter: caOf(result, isGk),
    scale,
    cappedByCeiling,
    cappedByPa: true,
  }
}

function scaleGains(gains: Partial<Record<AttrKey, number>>, scale: number): Partial<Record<AttrKey, number>> {
  const out: Partial<Record<AttrKey, number>> = {}
  for (const [key, value] of Object.entries(gains) as [AttrKey, number][]) {
    if (value) out[key] = value * scale
  }
  return out
}

function addAttrs(attrs: Attributes, gains: Partial<Record<AttrKey, number>>, isGk: boolean): Attributes {
  const out = { ...attrs }
  for (const [key, value] of Object.entries(gains) as [AttrKey, number][]) {
    if (value) out[key] = Math.max(0, Math.min(attrMax(key, isGk), out[key] + value))
  }
  return out
}

export function positionMultiplier(proficiency: number): number {
  const r = Math.max(0, Math.min(100, proficiency)) / 100
  return POSITION_FLOOR + (1 - POSITION_FLOOR) * r
}

export function effectiveAttr(
  attrs: Attributes,
  staminaRatio: number,
  proficiency: number,
  key: AttrKey,
  isGk: boolean,
): number {
  const k = key === 'endurance' ? 0 : isPhysical(key) ? 0.75 : 0.5
  const fatigue = 1 - k * (1 - Math.max(0, Math.min(1, staminaRatio)))
  const m = positionMultiplier(proficiency)
  return Math.max(1, Math.min(100, attrs[key] * fatigue * m))
}

export function isPhysical(key: AttrKey): boolean {
  return key === 'acceleration' || key === 'speed' || key === 'agility' || key === 'strength'
}

export function attrText(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(value % 1 === 0 ? 0 : 1)
}

export function caText(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1)
}
