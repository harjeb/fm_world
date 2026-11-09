/**
 * 赛季日历。
 *
 * 两种赛程：
 * - 单机（schedule 1，默认）：一轮 = 4 个游戏日 = 现实 24 小时，第 1 轮在赛季开始那一刻；可以“跳至比赛日”平移日历。
 * - 联机（schedule 2）：每天北京时间（UTC+8）12:00 和 20:00 各踢一轮，相邻两轮隔 8 / 16 小时；
 *   第 n 轮 = 赛季开始那一刻（含）之后的第 n 个开赛时间点。
 * 38 轮之后的下一个开赛时刻进入赛后休整，休整 12 个游戏日（现实 3 天）后下一赛季开始。
 * 游戏日始终是现实 6 小时（日期、伤病、精力按游戏日走）。
 * 个人存档（season.ts）与服务器共享世界（world.ts）共用这一份，别在别处复制常量。
 */
export const GAME_DAY_MS = 6 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** 赛程类型：1 = 单机一天一轮（默认），2 = 联机每天北京时间 12:00、20:00 各一轮。 */
export type KickoffSchedule = number
export const DAILY_SCHEDULE = 1
export const BEIJING_SCHEDULE = 2

/** 联机每天的开赛时间（UTC 小时）：北京时间 12:00、20:00。 */
export const KICKOFF_UTC_HOURS = [4, 12] as const
/** 一个赛季 38 轮。 */
export const SEASON_ROUNDS = 38
/** 单机一轮 = 4 个游戏日 = 现实 24 小时。 */
export const ROUND_GAME_DAYS = 4
export const ROUND_MS = GAME_DAY_MS * ROUND_GAME_DAYS

/** 游戏日历的第一天：2026/11/01（UTC）。 */
export const CALENDAR_START = Date.UTC(2026, 10, 1)
/** 赛后休整（升级附加赛和友谊赛）占 12 个游戏日。 */
export const POSTSEASON_GAME_DAYS = 12

const isBeijing = (schedule: KickoffSchedule | undefined): boolean => schedule === BEIJING_SCHEDULE

/** 平均一轮多少个游戏日（AI 培养、收入按轮折算时用）：单机 4，联机一天两轮 → 2。 */
export function averageRoundGameDays(schedule: KickoffSchedule = DAILY_SCHEDULE): number {
  return isBeijing(schedule) ? 2 : ROUND_GAME_DAYS
}

/** 第 slot 个联机开赛时间点（从 1970-01-01 起编号）。 */
function slotTime(slot: number): number {
  const per = KICKOFF_UTC_HOURS.length
  return Math.floor(slot / per) * DAY_MS + KICKOFF_UTC_HOURS[((slot % per) + per) % per] * HOUR_MS
}

/** at 时刻或之后的第一个联机开赛时间点的编号。 */
function slotAtOrAfter(at: number): number {
  const day = Math.floor(at / DAY_MS)
  for (let offset = 0; offset < 3; offset++) {
    for (let index = 0; index < KICKOFF_UTC_HOURS.length; index++) {
      const slot = (day + offset) * KICKOFF_UTC_HOURS.length + index
      if (slotTime(slot) >= at) return slot
    }
  }
  return (day + 3) * KICKOFF_UTC_HOURS.length
}

/** at 时刻或之前的最后一个联机开赛时间点的编号。 */
function slotAtOrBefore(at: number): number {
  const next = slotAtOrAfter(at)
  return slotTime(next) === at ? next : next - 1
}

/** 第 round 轮的开赛（结算）时间点。 */
export function kickoffAtForRound(startedAt: number, round: number, schedule: KickoffSchedule = DAILY_SCHEDULE): number {
  const index = Math.max(0, Math.round(round) - 1)
  if (!isBeijing(schedule)) return startedAt + index * ROUND_MS
  return slotTime(slotAtOrAfter(startedAt) + index)
}

/** 到 now 为止已经开过球的轮数（0 到 cap）。 */
export function roundsKickedOff(startedAt: number, now: number, schedule: KickoffSchedule = DAILY_SCHEDULE, cap = SEASON_ROUNDS + 1): number {
  if (!isBeijing(schedule)) return now < startedAt ? 0 : Math.min(cap, 1 + Math.floor((now - startedAt) / ROUND_MS))
  const first = slotAtOrAfter(startedAt)
  if (now < slotTime(first)) return 0
  return Math.min(cap, slotAtOrBefore(now) - first + 1)
}

/** 第 round 轮和下一轮之间隔了几个游戏日（单机 4；联机 8 / 16 小时 → 1⅓ 或 2⅔）。 */
export function roundGapGameDays(startedAt: number, round: number, schedule: KickoffSchedule = DAILY_SCHEDULE): number {
  return (kickoffAtForRound(startedAt, round + 1, schedule) - kickoffAtForRound(startedAt, round, schedule)) / GAME_DAY_MS
}

/**
 * 给定“现在是第 round 轮刚开球”，反推赛季开始时间：第 round 轮落在 now 之前（含）最近的开赛时间点。
 * 旧的一天一轮赛季换到联机赛程、测试里造“已经踢到第几轮”的赛季都用它。
 */
export function seasonStartForRound(now: number, round: number, schedule: KickoffSchedule = DAILY_SCHEDULE): number {
  const index = Math.max(0, Math.round(round) - 1)
  if (!isBeijing(schedule)) return now - index * ROUND_MS
  return slotTime(slotAtOrBefore(now) - index)
}

/** 常规赛结束、进入赛后休整的时间点：第 38 轮之后的下一个开赛时刻。 */
export function postseasonStartAt(seasonStartedAt: number, schedule: KickoffSchedule = DAILY_SCHEDULE): number {
  return kickoffAtForRound(seasonStartedAt, SEASON_ROUNDS + 1, schedule)
}

/** 赛后休整结束、下一赛季开始的时间点。 */
export function seasonEndAt(seasonStartedAt: number, schedule: KickoffSchedule = DAILY_SCHEDULE): number {
  return postseasonStartAt(seasonStartedAt, schedule) + POSTSEASON_GAME_DAYS * GAME_DAY_MS
}

/** 第 index 赛季（1 起）开始时的真实时间：赛季首尾相接，从游戏第一天起一个接一个排。 */
export function seasonStartAt(calendarStartAt: number, index: number, schedule: KickoffSchedule = DAILY_SCHEDULE): number {
  let start = calendarStartAt
  for (let season = 1; season < index; season++) start = seasonEndAt(start, schedule)
  return start
}

/** 一个赛季（从开始到下一赛季开始）跨多少个游戏日：单机 164；联机约 89。 */
export function seasonGameDays(seasonStartedAt: number, schedule: KickoffSchedule = DAILY_SCHEDULE): number {
  return (seasonEndAt(seasonStartedAt, schedule) - seasonStartedAt) / GAME_DAY_MS
}

/** 单机一个赛季的游戏日数（常规赛 152 + 休整 12）。 */
export const SEASON_GAME_DAYS = SEASON_ROUNDS * ROUND_GAME_DAYS + POSTSEASON_GAME_DAYS
export const REGULAR_SEASON_GAME_DAYS = SEASON_ROUNDS * ROUND_GAME_DAYS

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

/** 某一轮落在赛季的第几个游戏日（从 0 起算）。 */
export function gameDayOfRound(startedAt: number, round: number, schedule: KickoffSchedule = DAILY_SCHEDULE): number {
  return Math.max(0, Math.floor((kickoffAtForRound(startedAt, round, schedule) - startedAt) / GAME_DAY_MS))
}

/** 从赛季开始到现在度过的完整游戏日数。 */
export function elapsedGameDays(startedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - startedAt) / GAME_DAY_MS))
}
