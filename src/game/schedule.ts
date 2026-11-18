/**
 * 赛程迁移：旧赛程（一天一轮 / 一天两轮）→ 一天固定 6 轮（北京时间 02/06/10/14/18/22，每 4 小时一轮）。
 * 单机存档、联机账号和服务器共享世界共用。
 *
 * 进行中的赛季保持“当前已踢到第几轮”不变：已完赛轮次保留历史赛果与时间，未赛轮次与进行中的赛季杯赛
 * 从当前时间往后按新时刻表排期；同时为旧存档补齐默认的赛前体能轮换与赛中体力换人保护。
 */
import type { GameState, SeasonState, WorldState } from './types.ts'
import {
  AVERAGE_ROUND_GAME_DAYS,
  DAY_MS,
  GAME_DAY_MS,
  KICKOFF_SCHEDULE,
  SEASON_ROUNDS,
  gameDayOfRound,
  kickoffAtForRound,
  seasonStartForRound,
} from './calendar.ts'
import { rescheduleActiveSeasonCups } from './season-cups.ts'
import { DEFAULT_PRE_MATCH_STAMINA_BELOW, DEFAULT_STAMINA_BELOW, emptyAutoSubs, sanitizeAutoSubPlan } from './match/management.ts'

export { KICKOFF_SCHEDULE }

/** 旧一天一轮日历下现在该踢第几轮（39 = 常规赛已经踢完）。 */
function legacy1DueRound(startedAt: number, now: number): number {
  return Math.min(SEASON_ROUNDS + 1, 1 + Math.floor(Math.max(0, now - startedAt) / DAY_MS))
}

/** 旧一天两轮日历（已持久化每场 kickoffAt）下当前所处轮次。 */
function legacySeasonDueRound(season: SeasonState | undefined, fallbackStartedAt: number, now: number): number {
  if (!season || season.kickoffSchedule === undefined) return legacy1DueRound(fallbackStartedAt, now)
  if (season.finished) return SEASON_ROUNDS + 1
  const rounds = new Map<number, { kickoffAt?: number; played: boolean }>()
  for (const fixture of season.fixtures ?? []) {
    const prev = rounds.get(fixture.round)
    rounds.set(fixture.round, {
      kickoffAt: prev?.kickoffAt ?? fixture.kickoffAt,
      played: (prev?.played ?? true) && fixture.played,
    })
  }
  let due = 0
  for (let r = 1; r <= SEASON_ROUNDS; r++) {
    const info = rounds.get(r)
    if (!info) break
    if (info.played || (typeof info.kickoffAt === 'number' && info.kickoffAt <= now)) due = r
    else break
  }
  return Math.min(SEASON_ROUNDS + 1, Math.max(1, due))
}

/** 旧赛季按新日历重新定开始时间：还没开始的不动，进行中的让当前轮落在最近的开赛时间点。 */
export function rescheduledStart(startedAt: number, now: number, season?: SeasonState): number {
  if (now < startedAt) return startedAt
  return seasonStartForRound(now, legacySeasonDueRound(season, startedAt, now))
}

/** 把一个联赛分区的赛季挪到新的开始时间：未赛场次的开赛时间与基准时长一起更新。 */
export function reanchorSeason(season: SeasonState, startedAt: number): void {
  season.startedAt = startedAt
  season.gameDayMs = GAME_DAY_MS
  season.roundGameDays = AVERAGE_ROUND_GAME_DAYS
  season.kickoffSchedule = KICKOFF_SCHEDULE
  delete season.clockShift
  for (const fixture of season.fixtures ?? []) {
    if (!fixture.played || !Number.isFinite(fixture.kickoffAt)) {
      fixture.kickoffAt = kickoffAtForRound(startedAt, fixture.round)
    }
    fixture.gameDay = gameDayOfRound(startedAt, fixture.round)
  }
}

/** 共享世界 / 存档里的世界：所有分区与进行中的赛季杯赛一起挪。 */
export function migrateWorldSchedule(world: WorldState, now: number): boolean {
  if (world.kickoffSchedule === KICKOFF_SCHEDULE && world.divisions.every(d => d.gameDayMs === GAME_DAY_MS)) return false
  const start = rescheduledStart(world.seasonStartedAt, now, world.divisions[0])
  world.seasonStartedAt = start
  for (const division of world.divisions ?? []) reanchorSeason(division, start)
  world.kickoffSchedule = KICKOFF_SCHEDULE
  delete world.clockShift
  rescheduleActiveSeasonCups(world, now)
  return true
}

function ensureDefaultAutoSubsOnMigrate(game: GameState): boolean {
  if (!Array.isArray(game.roster) || !game.lineup) return false
  if (!game.autoSubs) {
    game.autoSubs = emptyAutoSubs()
    return true
  }
  let changed = false
  if (game.autoSubs.staminaBelow == null) {
    game.autoSubs.staminaBelow = DEFAULT_STAMINA_BELOW
    game.autoSubs.onInjury = true
    changed = true
  }
  if (game.autoSubs.preMatchStaminaBelow == null) {
    game.autoSubs.preMatchStaminaBelow = DEFAULT_PRE_MATCH_STAMINA_BELOW
    changed = true
  }
  if (changed) game.autoSubs = sanitizeAutoSubPlan(game.roster, game.lineup, game.autoSubs)
  return changed
}

/** 存档迁移：有世界的跟着世界走，老的单联赛存档按自己的赛季挪，并补齐默认没体力自动换人。 */
export function migrateGameSchedule(game: GameState, now: number): boolean {
  let changed = false
  if (game.world) changed = migrateWorldSchedule(game.world, now) || changed
  if (game.season && (game.season.kickoffSchedule !== KICKOFF_SCHEDULE || game.season.gameDayMs !== GAME_DAY_MS)) {
    const start = game.world ? game.world.seasonStartedAt : rescheduledStart(game.season.startedAt, now, game.season)
    reanchorSeason(game.season, start)
    changed = true
  }
  if (changed) ensureDefaultAutoSubsOnMigrate(game)
  return changed
}
