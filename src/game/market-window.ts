import type { GameState, Player } from './types.ts'
import { derivedRng } from './rng.ts'
import { gameDateOf } from './calendar.ts'

/**
 * 真实球星不是每天都在市场：每名球星每个月只有 3–5 天挂牌，
 * 具体日期由 starKey 稳定散列得到，存档重开、换设备都一样。
 * 普通（随机）球员不受限制。
 */
export function starMarketDays(player: Pick<Player, 'id' | 'starKey'>): number[] | null {
  if (!player.starKey) return null
  const rng = derivedRng(0, 'star-market-days', player.starKey)
  const count = 3 + rng.int(3)
  const days = new Set<number>()
  for (let guard = 0; days.size < count && guard < 60; guard++) days.add(1 + rng.int(28))
  return [...days].sort((a, b) => a - b)
}

function calendarAnchor(game: Pick<GameState, 'world' | 'createdAt'>): number {
  return game.world?.calendarStartAt ?? game.createdAt ?? Date.now()
}

/** 今天是游戏内几号（1–31）。 */
export function marketDayOfMonth(game: Pick<GameState, 'world' | 'createdAt'>, now = Date.now()): number {
  return gameDateOf(calendarAnchor(game), now).day
}

export function isOnMarketToday(
  game: Pick<GameState, 'world' | 'createdAt'>,
  player: Pick<Player, 'id' | 'starKey'>,
  now = Date.now(),
): boolean {
  const days = starMarketDays(player)
  if (!days) return true
  // 只排到 28 号：29–31 号沿用 28 号的窗口，避免大小月和赛季日历错位。
  return days.includes(Math.min(28, marketDayOfMonth(game, now)))
}

/** 下一次出现在市场是什么时候，给界面用。 */
export function nextMarketDayLabel(
  game: Pick<GameState, 'world' | 'createdAt'>,
  player: Pick<Player, 'id' | 'starKey'>,
  now = Date.now(),
): string {
  const days = starMarketDays(player)
  if (!days) return '随时'
  const today = marketDayOfMonth(game, now)
  const next = days.find((day) => day > today)
  return next ? `本月 ${next} 号` : `下月 ${days[0]} 号`
}

/** 市场窗口的说明文字。 */
export function marketWindowLabel(player: Pick<Player, 'id' | 'starKey'>): string {
  const days = starMarketDays(player)
  return days ? `每月 ${days.join('、')} 号挂牌` : '长期在售'
}
