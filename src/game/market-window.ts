import type { GameState, Player } from './types.ts'
import { derivedRng } from './rng.ts'
import { beijingDayIndex } from './calendar.ts'

/**
 * 真实球星不是每天都在市场：以 28 个自然日为一个轮换周期，每名球星每周期有 4–5 个自然日挂牌（满 24 小时），
 * 具体日期由 starKey 稳定散列得到，避免只出现在凌晨短窗口。普通（随机）球员不受限制。
 */
export function starMarketDays(player: Pick<Player, 'id' | 'starKey'>): number[] | null {
  if (!player.starKey) return null
  const rng = derivedRng(0, 'star-market-days', player.starKey)
  const count = 4 + rng.int(2)
  const days = new Set<number>()
  for (let guard = 0; days.size < count && guard < 60; guard++) days.add(1 + rng.int(28))
  return [...days].sort((a, b) => a - b)
}

type MarketClockAnchor = Pick<GameState, 'world' | 'createdAt'> & Partial<Pick<GameState, 'season'>>

/** 今天落在 28 天轮换周期的第几天（1–28，按北京时间 00:00 切换）。 */
export function marketDayOfMonth(game: MarketClockAnchor, now = Date.now()): number {
  const shift = game.season?.clockShift ?? game.world?.clockShift ?? 0
  const idx = beijingDayIndex(now + shift)
  return (((idx % 28) + 28) % 28) + 1
}

export function isOnMarketToday(
  game: MarketClockAnchor,
  player: Pick<Player, 'id' | 'starKey' | 'releasedToMarket'>,
  now = Date.now(),
): boolean {
  if (player.releasedToMarket) return true
  const days = starMarketDays(player)
  if (!days) return true
  return days.includes(marketDayOfMonth(game, now))
}
