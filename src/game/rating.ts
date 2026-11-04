import type { AttrKey, Player } from './types.ts'
import { caOf } from './ca.ts'
import { mainAttrsFor } from './scale.ts'

export { MAIN_FIELD_ATTRS, MAIN_GK_ATTRS, MAIN_ATTR_SCALE, HIDDEN_ATTR_SCALE, MAIN_ATTR_MAX, HIDDEN_ATTR_MAX, CA_MAX, mainAttrsFor, isMainAttr, attrMax, attrRating, attrStorage, authoredGain, scaleAuthoredGains } from './scale.ts'
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

/** 初始 CA 用原型初始属性计算，不随训练变化。 */
export function initialDisplayCA(player: Player): number {
  return caOf(player.baseAttrs, player.positions.GK > 0)
}

export { mainAttrsFor as visibleMainAttrs }
