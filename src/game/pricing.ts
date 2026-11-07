import type { Player } from './types.ts'
import { ALL_ATTRIBUTES } from './types.ts'
import { attrMax } from './scale.ts'
import { caOf } from './ca.ts'

/**
 * 身价曲线：按 CA 的指数定价，越往上越贵。
 * CA 205 ≈ 15 万、230 ≈ 55 万、250 ≈ 150 万、270 ≈ 430 万、290 ≈ 1200 万（封顶 2000 万）。
 * 估值、挂牌、竞拍底价和电脑球队的出价都用这一份，别再各写一套。
 */
export const VALUE_AT_CA_205 = 150_000
export const VALUE_GROWTH_PER_CA = 1.0529
export const VALUE_CAP = 20_000_000

export function playerMarketValue(player: Pick<Player, 'attrs' | 'positions'>): number {
  if (!player || !player.positions || !player.attrs) return 0
  const gk = player.positions.GK > 0
  if (ALL_ATTRIBUTES.some(key => !Number.isFinite(player.attrs[key]) || player.attrs[key] < 0 || player.attrs[key] > attrMax(key, gk))) return 0
  const ca = caOf(player.attrs, gk)
  const raw = VALUE_AT_CA_205 * Math.pow(VALUE_GROWTH_PER_CA, ca - 205)
  return Math.max(1_000, Math.min(VALUE_CAP, Math.round(raw / 1_000) * 1_000))
}
