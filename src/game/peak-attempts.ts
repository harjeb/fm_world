import { GAME_DAY_MS, gameDayIndex } from './calendar.ts'
import { splitSeed } from './rng.ts'
import type { GameState } from './types.ts'

/** 所有关卡共用，每开始一场就消耗一次（无论胜负）。 */
export const PEAK_DAILY_LIMIT = 3

type PeakGame = Pick<GameState, 'world' | 'createdAt' | 'pve' | 'seed'>

/** 与顶栏日历使用同一锚点；离线跳日与换赛季也随游戏日历走。 */
export function peakDailyStatus(game: PeakGame, now = Date.now()): { day: number; used: number; remaining: number; resetAt: number } {
  const anchor = game.world?.calendarStartAt ?? game.createdAt
  const currentDay = gameDayIndex(anchor, now)
  const saved = game.pve?.peak.dailyAttempts
  const savedValid = saved && Number.isSafeInteger(saved.day) && saved.day >= 0 && Number.isSafeInteger(saved.count) && saved.count >= 0
  // 本机时钟回退不能重置当天次数；正常跳到下一个游戏日才刷新。
  const day = savedValid ? Math.max(currentDay, saved.day) : currentDay
  const used = savedValid && saved.day === day ? Math.min(PEAK_DAILY_LIMIT, saved.count) : 0
  return { day, used, remaining: PEAK_DAILY_LIMIT - used, resetAt: anchor + (day + 1) * GAME_DAY_MS }
}

/** 序号不按天重置，未完成或已清理的旧战报也不会让比赛种子重用。 */
export function nextPeakAttempt(game: PeakGame): { number: number; seed: number; recordKey: string } {
  const old = game.pve?.peak.attemptCounter
  const number = Number.isSafeInteger(old) && old! >= 0 ? old! + 1 : 1
  const seed = (splitSeed(game.seed, 'peak-match-v2') + number) >>> 0
  return { number, seed, recordKey: `peak-v2-${number}` }
}

/** 只有比赛确实开赛成功才消耗次数。 */
export function recordPeakAttempt(game: GameState, now: number, attemptNumber: number): void {
  const status = peakDailyStatus(game, now)
  const peak = game.pve!.peak
  peak.dailyAttempts = { day: status.day, count: status.used + 1 }
  peak.attemptCounter = attemptNumber
}
