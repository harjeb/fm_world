import type { Player } from './types.ts'
import { ALL_ATTRIBUTES } from './types.ts'
import { attrHardLimit, attrMax } from './scale.ts'
import { caOf } from './ca.ts'

/**
 * 身价曲线：按 CA 的指数定价，越往上越贵。
 * 真实球星：CA 205 ≈ 15 万、230 ≈ 55 万、250 ≈ 150 万、270 ≈ 430 万、290 ≈ 1200 万（封顶 2000 万）。
 * 随机球员（不含真实球星与青训苗子）另按 0.75× 折价，配合 175–230 基础 CA 拉开与球星的身价层级。
 * 估值、挂牌、竞拍底价和电脑球队的出价都用这一份，别再各写一套。
 */
export const VALUE_AT_CA_205 = 150_000
export const VALUE_GROWTH_PER_CA = 1.0529
export const VALUE_CAP = 20_000_000
export const RANDOM_PLAYER_VALUE_SCALE = 0.75

type ValuationPlayer = Pick<Player, 'attrs' | 'positions'> & Partial<Pick<Player, 'era' | 'starKey' | 'youthOrigin'>>

function isRandomValuationPlayer(player: ValuationPlayer): boolean {
  return player.era === 'random' && !player.starKey && !player.youthOrigin
}

export function playerMarketValue(player: ValuationPlayer): number {
  if (!player || !player.positions || !player.attrs) return 0
  const gk = player.positions.GK > 0
  if (ALL_ATTRIBUTES.some(key => !Number.isFinite(player.attrs[key]) || player.attrs[key] < 0 || player.attrs[key] > Math.max(attrMax(key, gk), attrHardLimit(key, gk)))) return 0
  const ca = caOf(player.attrs, gk)
  const scale = isRandomValuationPlayer(player) ? RANDOM_PLAYER_VALUE_SCALE : 1
  const raw = VALUE_AT_CA_205 * Math.pow(VALUE_GROWTH_PER_CA, ca - 205) * scale
  return Math.max(1_000, Math.min(VALUE_CAP, Math.round(raw / 1_000) * 1_000))
}

/** 转会不带培养卡：估值只看原始属性，但仍拒绝当前属性非法的球员。 */
export function basePlayerMarketValue(player: Player): number {
  if (!playerMarketValue(player)) return 0
  return playerMarketValue({
    attrs: player.baseAttrs ?? player.attrs,
    positions: player.basePositions ?? player.positions,
    era: player.era,
    starKey: player.starKey,
    youthOrigin: player.youthOrigin,
  })
}
