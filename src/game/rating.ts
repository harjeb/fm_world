import type { AttrKey, Player } from './types.ts'
import { caOf } from './ca.ts'
import { mainAttrsFor } from './scale.ts'

export { MAIN_FIELD_ATTRS, MAIN_GK_ATTRS, MAIN_ATTR_SCALE, HIDDEN_ATTR_SCALE, MAIN_ATTR_MAX, MAIN_ATTR_HARD_MAX, HIDDEN_ATTR_MAX, CA_MAX, MAX_ATTR_RATING, attrHardLimit, mainAttrsFor, isMainAttr, attrLimit, attrMax, attrRating, attrStorage, authoredGain, scaleAuthoredGains } from './scale.ts'
export type { MainAttr } from './scale.ts'

/** Display attributes and gains in their stored units, not the match rating scale. */
export function displayMainAttr(value: number): number {
  return value
}

export function displayHiddenAttr(value: number): number {
  return value
}

export function displayAttr(_key: AttrKey, value: number, _gk: boolean): number {
  return value
}

export function displayGain(_key: AttrKey, value: number, _gk: boolean): number {
  return value
}

export function displayCA(value: number): number {
  return value
}

export function displayPA(value: number): number {
  return value
}

export function playerDisplayCA(player: Player): number {
  return caOf(player.attrs, player.positions.GK > 0)
}

/** 原始 CA 使用原始属性和原始位置计算，不受装备卡、培养或转会影响；兼容缺少原始字段的旧数据。 */
export function initialDisplayCA(player: Player): number {
  return caOf(player.baseAttrs ?? player.attrs, (player.basePositions ?? player.positions).GK > 0)
}

export { mainAttrsFor as visibleMainAttrs }
