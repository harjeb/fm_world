/**
 * 赛程迁移：一天一轮（每 24 小时）→ 一天两轮（北京时间 12:00、20:00）。单机存档、联机账号和服务器共享世界都用。
 *
 * 进行中的赛季保持“现在该踢第几轮”不变：把那一轮的开赛时间对齐到最近的一个开赛时间点，
 * 赛季开始时间和存档里每场比赛的开赛时间跟着重算，不会一上线就连着补算好几轮。
 * 还没开始的赛季只重算赛程时间。用 kickoffSchedule 标记，迁移过一次之后什么都不做。
 */
import type { GameState, SeasonState, WorldState } from './types.ts'
import { AVERAGE_ROUND_GAME_DAYS, KICKOFF_SCHEDULE, gameDayOfRound, kickoffAtForRound, seasonStartForRound, SEASON_ROUNDS } from './calendar.ts'

export { KICKOFF_SCHEDULE }
const LEGACY_ROUND_MS = 24 * 60 * 60 * 1000

/** 旧日历下现在该踢第几轮（39 = 常规赛已经踢完）。 */
function legacyDueRound(startedAt: number, now: number): number {
  return Math.min(SEASON_ROUNDS + 1, 1 + Math.floor(Math.max(0, now - startedAt) / LEGACY_ROUND_MS))
}

/** 旧赛季按新日历重新定开始时间：还没开始的不动，进行中的让当前轮落在最近的开赛时间点。 */
export function rescheduledStart(startedAt: number, now: number): number {
  if (now < startedAt) return startedAt
  return seasonStartForRound(now, legacyDueRound(startedAt, now))
}

/** 把一个联赛分区的赛季挪到新的开始时间：每场比赛的开赛时间和游戏日一起重算。 */
export function reanchorSeason(season: SeasonState, startedAt: number): void {
  season.startedAt = startedAt
  season.roundGameDays = AVERAGE_ROUND_GAME_DAYS
  season.kickoffSchedule = KICKOFF_SCHEDULE
  // 旧存档跳过的时间已经算进 startedAt，新赛程从现实时间重新对齐。
  delete season.clockShift
  for (const fixture of season.fixtures ?? []) {
    fixture.kickoffAt = kickoffAtForRound(startedAt, fixture.round)
    fixture.gameDay = gameDayOfRound(startedAt, fixture.round)
  }
}

/** 共享世界 / 存档里的世界：所有分区一起挪。 */
export function migrateWorldSchedule(world: WorldState, now: number): boolean {
  if (world.kickoffSchedule === KICKOFF_SCHEDULE) return false
  const start = rescheduledStart(world.seasonStartedAt, now)
  world.seasonStartedAt = start
  for (const division of world.divisions ?? []) reanchorSeason(division, start)
  world.kickoffSchedule = KICKOFF_SCHEDULE
  delete world.clockShift
  return true
}

/** 存档迁移：有世界的跟着世界走，老的单联赛存档按自己的赛季挪。 */
export function migrateGameSchedule(game: GameState, now: number): boolean {
  let changed = false
  if (game.world) changed = migrateWorldSchedule(game.world, now) || changed
  if (game.season && game.season.kickoffSchedule !== KICKOFF_SCHEDULE) {
    const start = game.world ? game.world.seasonStartedAt : rescheduledStart(game.season.startedAt, now)
    reanchorSeason(game.season, start)
    changed = true
  }
  return changed
}
