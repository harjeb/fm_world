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
