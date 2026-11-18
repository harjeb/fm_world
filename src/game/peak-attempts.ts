import { beijingDayIndex, nextBeijingMidnight } from './calendar.ts'
import { splitSeed } from './rng.ts'
import type { GameState } from './types.ts'

/** 所有关卡共用，每个自然日（北京时间 00:00 重置）最多挑战 10 次；开赛即消耗（无论胜负）。 */
export const PEAK_DAILY_LIMIT = 10

type PeakGame = Pick<GameState, 'world' | 'createdAt' | 'pve' | 'seed'> & Partial<Pick<GameState, 'season'>>

/** 按北京时间自然日重置；单机跳轮次（clockShift）也随存档时钟跨越 00:00 正常刷新。 */
export function peakDailyStatus(game: PeakGame, now = Date.now()): { day: number; used: number; remaining: number; resetAt: number } {
  const shift = game.season?.clockShift ?? game.world?.clockShift ?? 0
  const effectiveNow = now + shift
  const currentDay = beijingDayIndex(effectiveNow)
  const saved = game.pve?.peak.dailyAttempts
  const savedValid = saved && Number.isSafeInteger(saved.day) && saved.day >= 0 && Number.isSafeInteger(saved.count) && saved.count >= 0
  // 本机时钟回退不能重置当天次数；正常进入下一个自然日才刷新。
  const day = savedValid ? Math.max(currentDay, saved.day) : currentDay
  const used = savedValid && saved.day === day ? Math.min(PEAK_DAILY_LIMIT, saved.count) : 0
  const resetDay = Math.max(currentDay, day)
  const resetAt = nextBeijingMidnight(effectiveNow) + (resetDay - currentDay) * 86_400_000 - shift
  return { day, used, remaining: PEAK_DAILY_LIMIT - used, resetAt }
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
