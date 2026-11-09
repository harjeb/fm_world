/**
 * 赛季日历（单机、联机一样）。
 *
 * 每天北京时间（UTC+8）12:00 和 20:00 各踢一轮，相邻两轮隔 8 / 16 小时；
 * 第 n 轮 = 赛季开始那一刻（含）之后的第 n 个开赛时间点。
 * 38 轮之后的下一个开赛时刻进入赛后休整，休整 12 个游戏日（现实 3 天）后下一赛季开始。
 * 游戏日始终是现实 6 小时（日期、伤病、精力按游戏日走）。
 *
 * `shift`（毫秒）：单机“跳至比赛日”会把存档时钟往前拨，存档时钟 = 现实时间 + shift，
 * 开赛时间点按存档时钟的 12:00 / 20:00 算。联机和没跳过时间的单机存档都是 0。
 * 个人存档（season.ts）与服务器共享世界（world.ts）共用这一份，别在别处复制常量。
 */
export const GAME_DAY_MS = 6 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** 存档里的赛程标记：2 = 每天北京时间 12:00、20:00 各一轮（没有标记的是旧的一天一轮）。 */
export const KICKOFF_SCHEDULE = 2

/** 每天的开赛时间（UTC 小时）：北京时间 12:00、20:00。 */
export const KICKOFF_UTC_HOURS = [4, 12] as const
/** 一个赛季 38 轮。 */
export const SEASON_ROUNDS = 38
/** 平均一轮多少个游戏日（一天两轮 → 2）；AI 培养按轮折算训练天数时用。 */
export const AVERAGE_ROUND_GAME_DAYS = 2

/** 游戏日历的第一天：2026/11/01（UTC）。 */
export const CALENDAR_START = Date.UTC(2026, 10, 1)
/** 赛后休整（升级附加赛和友谊赛）占 12 个游戏日。 */
export const POSTSEASON_GAME_DAYS = 12

/** 第 slot 个开赛时间点（从 1970-01-01 起编号，按存档时钟）。 */
function slotTime(slot: number): number {
  const per = KICKOFF_UTC_HOURS.length
  return Math.floor(slot / per) * DAY_MS + KICKOFF_UTC_HOURS[((slot % per) + per) % per] * HOUR_MS
}

/** at 时刻或之后的第一个开赛时间点的编号。 */
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

/** 第 round 轮和下一轮之间隔了几个游戏日（8 / 16 小时 → 1⅓ 或 2⅔）。 */
export function roundGapGameDays(startedAt: number, round: number, shift = 0): number {
  return (kickoffAtForRound(startedAt, round + 1, shift) - kickoffAtForRound(startedAt, round, shift)) / GAME_DAY_MS
}

/**
 * 给定“现在是第 round 轮刚开球”，反推赛季开始时间：第 round 轮落在 now 之前（含）最近的开赛时间点。
 * 旧的一天一轮赛季换到新赛程、测试里造“已经踢到第几轮”的赛季都用它。
 */
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

/** 赛后休整结束、下一赛季开始的时间点。 */
export function seasonEndAt(seasonStartedAt: number, shift = 0): number {
  return postseasonStartAt(seasonStartedAt, shift) + POSTSEASON_GAME_DAYS * GAME_DAY_MS
}

/** 第 index 赛季（1 起）开始时的真实时间：赛季首尾相接，从游戏第一天起一个接一个排。 */
export function seasonStartAt(calendarStartAt: number, index: number, shift = 0): number {
  let start = calendarStartAt
  for (let season = 1; season < index; season++) start = seasonEndAt(start, shift)
  return start
}

/** 一个赛季（从开始到下一赛季开始）跨多少个游戏日：约 89（19 天常规赛 + 3 天休整）。 */
export function seasonGameDays(seasonStartedAt: number, shift = 0): number {
  return (seasonEndAt(seasonStartedAt, shift) - seasonStartedAt) / GAME_DAY_MS
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

/** 某一轮落在赛季的第几个游戏日（从 0 起算）。 */
export function gameDayOfRound(startedAt: number, round: number, shift = 0): number {
  return Math.max(0, Math.floor((kickoffAtForRound(startedAt, round, shift) - startedAt) / GAME_DAY_MS))
}

/** 从赛季开始到现在度过的完整游戏日数。 */
export function elapsedGameDays(startedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - startedAt) / GAME_DAY_MS))
}
