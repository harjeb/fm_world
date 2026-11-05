/**
 * 赛季日历常量。
 *
 * 一轮 = 4 个游戏日 = 现实 24 小时（游戏日按 4 倍速走）。
 * 个人存档（season.ts）与服务器共享世界（world.ts）共用这一份，
 * 别再在别处复制常量——两边各写一份，时间线迟早会漂。
 */
export const GAME_DAY_MS = 6 * 60 * 60 * 1000
export const ROUND_GAME_DAYS = 4
export const ROUND_MS = GAME_DAY_MS * ROUND_GAME_DAYS

/** 游戏日历的第一天：2026/11/01（UTC）。 */
export const CALENDAR_START = Date.UTC(2026, 10, 1)
/** 常规赛 38 轮占 152 个游戏日，结束后留 12 个游戏日给升级附加赛和友谊赛。 */
export const REGULAR_SEASON_GAME_DAYS = (38 - 1) * ROUND_GAME_DAYS + ROUND_GAME_DAYS
export const POSTSEASON_GAME_DAYS = 12
export const SEASON_GAME_DAYS = REGULAR_SEASON_GAME_DAYS + POSTSEASON_GAME_DAYS

/** 第 index 赛季（1 起）开始时的真实时间。 */
export function seasonStartAt(calendarStartAt: number, index: number): number {
  return calendarStartAt + Math.max(0, index - 1) * SEASON_GAME_DAYS * GAME_DAY_MS
}

/** 常规赛结束、进入赛后休整的时间点。 */
export function postseasonStartAt(seasonStartedAt: number): number {
  return seasonStartedAt + REGULAR_SEASON_GAME_DAYS * GAME_DAY_MS
}

/** 赛后休整结束、下一赛季开始的时间点。 */
export function seasonEndAt(seasonStartedAt: number): number {
  return seasonStartedAt + SEASON_GAME_DAYS * GAME_DAY_MS
}

/** 日历上的一天（用于日期显示）；游戏日只有 6 小时现实时间，日期仍然一天一天走。 */
export const CALENDAR_DAY_MS = 24 * 60 * 60 * 1000

/** 从游戏第一天起算的第几个游戏日（0 起）。 */
export function gameDayIndex(calendarStartAt: number, now: number): number {
  return Math.max(0, Math.floor((now - calendarStartAt) / GAME_DAY_MS))
}

export type GameDate = { year: number; month: number; day: number; label: string; gameDay: number }

/** 游戏内日期：从 2026/11/01 起，每个真实 6 小时过一天。 */
export function gameDateOf(calendarStartAt: number, now: number): GameDate {
  const gameDay = gameDayIndex(calendarStartAt, now)
  const date = new Date(CALENDAR_START + gameDay * CALENDAR_DAY_MS)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + 1
  const day = date.getUTCDate()
  return { year, month, day, gameDay, label: `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}` }
}

/** 某一轮落在第几个游戏日（从 0 起算）。 */
export function gameDayOfRound(round: number): number {
  return Math.max(0, Math.round(round) - 1) * ROUND_GAME_DAYS
}

/** 某一轮的开球 / 结算时间点。 */
export function kickoffAtForRound(startedAt: number, round: number): number {
  return startedAt + gameDayOfRound(round) * GAME_DAY_MS
}

/** 从赛季开始到现在度过的完整游戏日数。 */
export function elapsedGameDays(startedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - startedAt) / GAME_DAY_MS))
}
