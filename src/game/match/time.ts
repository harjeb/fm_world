/** 比赛显示为 90 分钟；引擎内部时钟与现实联赛推进各自独立。 */
export const MATCH_DISPLAY_SECONDS = 5400
export const LEAGUE_REALTIME_SECONDS = 600
export const MATCH_RULES_VERSION = 2
/** 逻辑比赛时长；90 分钟是显示口径，不是这个字段。 */
export const LOGIC_MATCH_SECONDS = 900

export function clampMatchClock(clock: number, durationSeconds: number): number {
  return Math.max(0, Math.min(durationSeconds, clock))
}

export function displayClock(clock: number, durationSeconds = LOGIC_MATCH_SECONDS): number {
  if (!(durationSeconds > 0)) return 0
  return Math.round((clampMatchClock(clock, durationSeconds) / durationSeconds) * MATCH_DISPLAY_SECONDS * 10) / 10
}

export function logicClock(displaySeconds: number, durationSeconds = LOGIC_MATCH_SECONDS): number {
  if (!(durationSeconds > 0)) return 0
  return Math.max(0, Math.min(durationSeconds, (displaySeconds / MATCH_DISPLAY_SECONDS) * durationSeconds))
}

export function displayMinuteLabel(clock: number, durationSeconds = LOGIC_MATCH_SECONDS): string {
  const seconds = displayClock(clock, durationSeconds)
  const minute = Math.floor(seconds / 60)
  const second = Math.floor(seconds % 60)
  return `${minute}:${String(second).padStart(2, '0')}`
}

export function matchRealSeconds(clock: number, durationSeconds = LOGIC_MATCH_SECONDS): number {
  if (!(durationSeconds > 0)) return 0
  return (clampMatchClock(clock, durationSeconds) / durationSeconds) * LEAGUE_REALTIME_SECONDS
}
