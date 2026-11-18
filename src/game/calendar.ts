/**
 * 赛季赛程与时间基准（单机、联机共用）：
 *
 * - 取消“游戏日”概念，统一按现实时间与联赛轮次推进。
 * - 联赛每天固定 6 轮：北京时间（UTC+8）02:00、06:00、10:00、14:00、18:00、22:00（每 4 小时一轮，绝不顺延）。
 * - 38 轮常规赛（6 天 8 小时）结束后，在下一个轮次时间点进入 16 小时赛后休整（升级附加赛与友谊赛窗口），
 *   整个赛季正好 168 小时 = 严格 7 天（一周一赛季，每周同一时刻开新赛季）。
 * - `shift`（毫秒）：单机“跳至下一轮”把存档时钟往前拨，存档时钟 = 现实时间 + shift。联机恒为 0。
 */
export const HOUR_MS = 60 * 60 * 1000
export const DAY_MS = 24 * HOUR_MS
export const BEIJING_OFFSET_MS = 8 * HOUR_MS

/** 相邻两轮联赛的固定间隔：现实 4 小时。 */
export const ROUND_INTERVAL_MS = 4 * HOUR_MS

/**
 * 内部时间缩放基准（现实 2 小时 = 半轮间隔）：
 * 仅用于底层连续恢复/伤病档位与测试加速倍率（season.gameDayMs），界面与规则不再暴露“游戏日”。
 */
export const GAME_DAY_MS = 2 * HOUR_MS

/** 存档里的赛程标记：6 = 每天固定 6 轮（02/06/10/14/18/22 北京时间）。 */
export const KICKOFF_SCHEDULE = 6

/** 每天的联赛开赛时间（UTC 小时，升序）：对应北京时间 10:00、14:00、18:00、22:00、次日 02:00、06:00。 */
export const KICKOFF_UTC_HOURS = [2, 6, 10, 14, 18, 22] as const
/** 一个赛季 38 轮。 */
export const SEASON_ROUNDS = 38
/** AI 每轮培养进度折算系数（保持 38 轮总培养量不变）。 */
export const AVERAGE_ROUND_GAME_DAYS = 2

/** 赛后休整时长：现实 16 小时（38 轮 × 4h + 4h 结算尾槽 + 16h 休整 = 168h = 整 7 天）。 */
export const POSTSEASON_HOURS = 16
export const POSTSEASON_MS = POSTSEASON_HOURS * HOUR_MS
/** 兼容旧常量引用（8 × 2h = 16h）。 */
export const POSTSEASON_GAME_DAYS = POSTSEASON_MS / GAME_DAY_MS

/** 北京时间自然日编号（从 1970-01-01 北京时间 00:00 起算，每天 00:00 递增）。 */
export function beijingDayIndex(at: number): number {
  return Math.floor((at + BEIJING_OFFSET_MS) / DAY_MS)
}

/** 下一个北京时间 00:00 的 Unix 毫秒时间戳。 */
export function nextBeijingMidnight(at: number): number {
  return (beijingDayIndex(at) + 1) * DAY_MS - BEIJING_OFFSET_MS
}

/** 第 slot 个开赛时间点（从 1970-01-01 起编号，按存档时钟）。 */
function slotTime(slot: number): number {
  const per = KICKOFF_UTC_HOURS.length
  return Math.floor(slot / per) * DAY_MS + KICKOFF_UTC_HOURS[((slot % per) + per) % per] * HOUR_MS
}

/** at 时刻或之后的第一个开赛时间点的编号。 */
function slotAtOrAfter(at: number): number {
  const day = Math.floor(at / DAY_MS)
  for (let offset = -1; offset < 3; offset++) {
    for (let index = 0; index < KICKOFF_UTC_HOURS.length; index++) {
      const slot = (day + offset) * KICKOFF_UTC_HOURS.length + index
      if (slotTime(slot) >= at) return slot
    }
  }
  return (day + 3) * KICKOFF_UTC_HOURS.length
}

/** at 时刻或之前的最后一个开赛时间点的编号。 */
function slotAtOrBefore(at: number): number {
  const next = slotAtOrAfter(at)
  return slotTime(next) === at ? next : next - 1
}

/** 第 round 轮的开赛（结算）时间点。 */
export function kickoffAtForRound(startedAt: number, round: number, shift = 0): number {
  const index = Math.max(0, Math.round(round) - 1)
  return slotTime(slotAtOrAfter(startedAt + shift) + index) - shift
}

/** 到 now 为止已经开过球的轮数（0 到 cap）。 */
export function roundsKickedOff(startedAt: number, now: number, shift = 0, cap = SEASON_ROUNDS + 1): number {
  const first = slotAtOrAfter(startedAt + shift)
  if (now + shift < slotTime(first)) return 0
  return Math.min(cap, slotAtOrBefore(now + shift) - first + 1)
}

/** 第 round 轮和下一轮之间隔了几个基准单位（固定 4h / 2h = 2）。 */
export function roundGapGameDays(startedAt: number, round: number, shift = 0): number {
  return (kickoffAtForRound(startedAt, round + 1, shift) - kickoffAtForRound(startedAt, round, shift)) / GAME_DAY_MS
}

/** 给定“现在是第 round 轮刚开球”，反推赛季开始时间。 */
export function seasonStartForRound(now: number, round: number, shift = 0): number {
  const index = Math.max(0, Math.round(round) - 1)
  return slotTime(slotAtOrBefore(now + shift) - index) - shift
}

/** now 之前（含）最近的一个开赛时间点：新存档 / 新世界从这里开始，第 1 轮马上就能踢。 */
export function latestKickoffAt(now: number, shift = 0): number {
  return seasonStartForRound(now, 1, shift)
}

/** 常规赛结束、进入赛后休整的时间点：第 38 轮之后的下一个开赛时刻。 */
export function postseasonStartAt(seasonStartedAt: number, shift = 0): number {
  return kickoffAtForRound(seasonStartedAt, SEASON_ROUNDS + 1, shift)
}

/** 赛后休整结束、下一赛季开始的时间点（整周 168 小时闭环）。 */
export function seasonEndAt(seasonStartedAt: number, shift = 0): number {
  return postseasonStartAt(seasonStartedAt, shift) + POSTSEASON_MS
}

/** 第 index 赛季（1 起）开始时的真实时间：赛季首尾相接。 */
export function seasonStartAt(calendarStartAt: number, index: number, shift = 0): number {
  let start = calendarStartAt
  for (let season = 1; season < index; season++) start = seasonEndAt(start, shift)
  return start
}

export function seasonGameDays(seasonStartedAt: number, shift = 0): number {
  return (seasonEndAt(seasonStartedAt, shift) - seasonStartedAt) / GAME_DAY_MS
}

/* ---------- 旧版日历字段兼容（仅保留函数签名供旧存档迁移与兼容使用） ---------- */
export const CALENDAR_START_YEAR = 2026
export const CALENDAR_START_MONTH_INDEX = 10
export const CALENDAR_START = Date.UTC(CALENDAR_START_YEAR, CALENDAR_START_MONTH_INDEX, 1)
export const CALENDAR_DAY_MS = 24 * 60 * 60 * 1000

export function seasonCalendarStartDay(seasonIndex: number): number {
  const year = CALENDAR_START_YEAR + Math.max(0, Math.floor(seasonIndex) - 1)
  const seasonDate = Date.UTC(year, CALENDAR_START_MONTH_INDEX, 1)
  return Math.max(0, Math.round((seasonDate - CALENDAR_START) / CALENDAR_DAY_MS))
}

export function calendarStartForSeason(seasonStartedAt: number, seasonIndex: number): number {
  return seasonStartedAt - seasonCalendarStartDay(seasonIndex) * GAME_DAY_MS
}

export function gameDayIndex(calendarStartAt: number, now: number): number {
  return Math.max(0, Math.floor((now - calendarStartAt) / GAME_DAY_MS))
}

export type GameDate = { year: number; month: number; day: number; label: string; gameDay: number }

export function gameDateOf(calendarStartAt: number, now = Date.now()): GameDate {
  const gameDay = gameDayIndex(calendarStartAt, now)
  const date = new Date(CALENDAR_START + gameDay * CALENDAR_DAY_MS)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + 1
  const day = date.getUTCDate()
  return { year, month, day, gameDay, label: `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}` }
}

export function gameDayOfRound(startedAt: number, round: number, shift = 0): number {
  return Math.max(0, Math.floor((kickoffAtForRound(startedAt, round, shift) - startedAt) / GAME_DAY_MS))
}

export function elapsedGameDays(startedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - startedAt) / GAME_DAY_MS))
}
