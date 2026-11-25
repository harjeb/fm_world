import { beijingDayIndex, nextBeijingMidnight } from './calendar.ts'
import { splitSeed } from './rng.ts'
import type { GameState } from './types.ts'

/** 所有传奇球队共用，每个现实自然日（北京时间 00:00 重置）最多挑战 20 次；开赛即消耗（无论胜负平）。 */
export const LEGEND_DAILY_LIMIT = 20

type LegendGame = Pick<GameState, 'pve' | 'seed'>

/** 按现实自然日（北京时间 UTC+8 00:00）重置；不受单机跳轮次 clockShift 影响。 */
export function legendDailyStatus(game: LegendGame, now = Date.now()): { day: number; used: number; remaining: number; resetAt: number } {
  const currentDay = beijingDayIndex(now)
  const saved = game.pve?.legendDailyAttempts
  const savedValid = saved && Number.isSafeInteger(saved.day) && saved.day >= 0 && Number.isSafeInteger(saved.count) && saved.count >= 0
  // 本机时钟回退不能重置当天次数；正常进入下一个现实自然日才刷新。
  const day = savedValid ? Math.max(currentDay, saved.day) : currentDay
  const used = savedValid && saved.day === day ? Math.min(LEGEND_DAILY_LIMIT, saved.count) : 0
  const resetDay = Math.max(currentDay, day)
  const resetAt = nextBeijingMidnight(now) + (resetDay - currentDay) * 86_400_000
  return { day, used, remaining: LEGEND_DAILY_LIMIT - used, resetAt }
}

/** 序号不按天重置，未完成或已清理的旧战报也不会让比赛种子或战报 ID 重用。 */
export function nextLegendAttempt(game: LegendGame, legendId: string): { number: number; seed: number; recordKey: string } {
  const old = game.pve?.legendAttemptCounter
  const number = Number.isSafeInteger(old) && old! >= 0 ? old! + 1 : 1
  const seed = splitSeed(game.seed, `legend-${legendId}-a${number}`)
  return { number, seed, recordKey: `legend-v2-${number}` }
}

/** 只有比赛确实开赛成功才消耗次数。 */
export function recordLegendAttempt(game: GameState, now: number, attemptNumber: number): void {
  const status = legendDailyStatus(game, now)
  const pve = game.pve!
  pve.legendDailyAttempts = { day: status.day, count: status.used + 1 }
  pve.legendAttemptCounter = attemptNumber
}
