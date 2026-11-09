import { describe, expect, it } from 'vitest'
import {
  BEIJING_SCHEDULE,
  DAILY_SCHEDULE,
  GAME_DAY_MS,
  KICKOFF_UTC_HOURS,
  ROUND_GAME_DAYS,
  ROUND_MS,
  SEASON_GAME_DAYS,
  averageRoundGameDays,
  elapsedGameDays,
  gameDayOfRound,
  kickoffAtForRound,
  postseasonStartAt,
  roundGapGameDays,
  roundsKickedOff,
  seasonEndAt,
  seasonStartAt,
  seasonStartForRound,
} from '../src/game/calendar.ts'
import { createOwnerlessWorld, createWorldGame } from '../src/game/world.ts'
import { createSeason, dueRound, matchdayCountdown, nextMatchdayAt, roundKickoffAt, seasonDay } from '../src/game/season.ts'
import { KICKOFF_SCHEDULE, migrateGameSchedule, migrateWorldSchedule, rescheduledStart } from '../src/game/schedule.ts'

const HOUR = 60 * 60 * 1000
const B = BEIJING_SCHEDULE
/** 北京时间（UTC+8）的小时。 */
const beijingHour = (at: number) => (new Date(at).getUTCHours() + 8) % 24
/** 2026-11-09 00:00 北京时间（= 11-08 16:00 UTC）。 */
const MIDNIGHT_BEIJING = Date.UTC(2026, 10, 8, 16)

describe('单机赛程：一天一轮', () => {
  it('一轮 = 4 个游戏日 = 现实 24 小时，第 1 轮在赛季开始那一刻', () => {
    const start = MIDNIGHT_BEIJING + 5 * HOUR
    expect(ROUND_GAME_DAYS).toBe(4)
    expect(ROUND_MS).toBe(24 * HOUR)
    expect(averageRoundGameDays()).toBe(4)
    expect(kickoffAtForRound(start, 1)).toBe(start)
    expect(kickoffAtForRound(start, 5)).toBe(start + 4 * 24 * HOUR)
    expect(roundsKickedOff(start, start - 1)).toBe(0)
    expect(roundsKickedOff(start, start)).toBe(1)
    expect(roundsKickedOff(start, start + 3 * 24 * HOUR)).toBe(4)
    expect(roundGapGameDays(start, 7)).toBe(4)
    expect(seasonStartForRound(start + 9 * 24 * HOUR, 10)).toBe(start)
    expect(seasonEndAt(start) - start).toBe(SEASON_GAME_DAYS * GAME_DAY_MS)
  })

  it('单机世界存档用一天一轮', () => {
    const startedAt = MIDNIGHT_BEIJING + 5 * HOUR
    const game = createWorldGame(1, undefined, '测试队', startedAt)
    expect(game.world!.kickoffSchedule).toBe(DAILY_SCHEDULE)
    expect(game.season.kickoffSchedule).toBe(DAILY_SCHEDULE)
    expect(game.season.roundGameDays).toBe(4)
    for (const fixture of game.season.fixtures) expect(fixture.kickoffAt).toBe(startedAt + (fixture.round - 1) * ROUND_MS)
    expect(nextMatchdayAt(game)).toBe(startedAt + 24 * HOUR)
  })

  it('单联赛存档也是一天一轮', () => {
    const startedAt = MIDNIGHT_BEIJING
    const teams = [1, 2, 3, 4].map((index) => ({
      id: `ai${index}`, name: `AI${index}`, short: `A${index}`, color: '#000', accent: '#fff', style: 'balanced',
      formationId: '4-4-2' as const,
      tactics: { attack: 'balanced', passing: 'mixed', tempo: 'normal', line: 'mid', press: 'mid' } as const,
      strength: 3, playerNames: [], lineup: {}, players: [], starPlayerIds: [],
    }))
    const solo = createSeason(7, teams as never, '测试队', startedAt)
    expect(solo.kickoffSchedule).toBe(DAILY_SCHEDULE)
    expect(solo.fixtures[0].kickoffAt).toBe(startedAt)
    expect(solo.fixtures.find((fixture) => fixture.round === 3)!.kickoffAt).toBe(startedAt + 2 * ROUND_MS)
  })
})

describe('联机赛程：每天北京时间 12:00、20:00 各一轮', () => {
  it('开赛时间点是北京时间 12:00 和 20:00；游戏日仍是现实 6 小时', () => {
    expect(KICKOFF_UTC_HOURS).toEqual([4, 12])
    expect(GAME_DAY_MS).toBe(6 * HOUR)
    expect(averageRoundGameDays(B)).toBe(2)
    const kickoffs = Array.from({ length: 6 }, (_, index) => kickoffAtForRound(MIDNIGHT_BEIJING, index + 1, B))
    expect(kickoffs.map(beijingHour)).toEqual([12, 20, 12, 20, 12, 20])
    expect(kickoffs[0]).toBe(MIDNIGHT_BEIJING + 12 * HOUR)
    // 相邻两轮隔 8 小时、16 小时交替
    expect(kickoffs.slice(1).map((at, index) => (at - kickoffs[index]) / HOUR)).toEqual([8, 16, 8, 16, 8])
    expect(roundGapGameDays(MIDNIGHT_BEIJING, 1, B)).toBeCloseTo(8 / 6, 10)
    expect(roundGapGameDays(MIDNIGHT_BEIJING, 2, B)).toBeCloseTo(16 / 6, 10)
  })

  it('赛季正好在开赛时间点开始时，第 1 轮就在那一刻；中途开始的赛季从下一个时间点踢', () => {
    const atSlot = MIDNIGHT_BEIJING + 20 * HOUR
    expect(kickoffAtForRound(atSlot, 1, B)).toBe(atSlot)
    expect(kickoffAtForRound(atSlot, 2, B)).toBe(atSlot + 16 * HOUR)
    expect(kickoffAtForRound(atSlot + 1, 1, B)).toBe(atSlot + 16 * HOUR)
  })

  it('已开球的轮数、反推赛季开始时间', () => {
    const start = MIDNIGHT_BEIJING
    expect(roundsKickedOff(start, start, B)).toBe(0)
    expect(roundsKickedOff(start, kickoffAtForRound(start, 1, B), B)).toBe(1)
    expect(roundsKickedOff(start, kickoffAtForRound(start, 2, B) - 1, B)).toBe(1)
    expect(roundsKickedOff(start, kickoffAtForRound(start, 10, B), B)).toBe(10)
    expect(roundsKickedOff(start, start + 100 * 24 * HOUR, B)).toBe(39)
    const now = MIDNIGHT_BEIJING + 30 * 24 * HOUR + 15 * HOUR
    const anchored = seasonStartForRound(now, 7, B)
    expect(roundsKickedOff(anchored, now, B)).toBe(7)
    expect(kickoffAtForRound(anchored, 7, B)).toBeLessThanOrEqual(now)
    expect(kickoffAtForRound(anchored, 8, B)).toBeGreaterThan(now)
  })

  it('38 轮踢 19 天；之后进入 12 个游戏日（3 天）的休整，下一赛季接着开始', () => {
    const start = MIDNIGHT_BEIJING + 12 * HOUR
    expect(kickoffAtForRound(start, 38, B) - start).toBe(18 * 24 * HOUR + 8 * HOUR)
    expect(postseasonStartAt(start, B)).toBe(kickoffAtForRound(start, 39, B))
    expect(seasonEndAt(start, B) - postseasonStartAt(start, B)).toBe(12 * GAME_DAY_MS)
    expect(seasonStartAt(start, 1, B)).toBe(start)
    expect(seasonStartAt(start, 2, B)).toBe(seasonEndAt(start, B))
    expect(seasonStartAt(start, 3, B)).toBe(seasonEndAt(seasonEndAt(start, B), B))
    // 下一赛季的第 1 轮也在 12:00 或 20:00
    expect([12, 20]).toContain(beijingHour(kickoffAtForRound(seasonStartAt(start, 2, B), 1, B)))
  })

  it('服务器共享世界用联机赛程，赛程的 gameDay 与 kickoffAt 都由日历推出', () => {
    const startedAt = 1_700_000_000_000
    const { world } = createOwnerlessWorld(1, startedAt)
    expect(world.kickoffSchedule).toBe(KICKOFF_SCHEDULE)
    for (const division of world.divisions) {
      expect(division.kickoffSchedule).toBe(KICKOFF_SCHEDULE)
      expect(division.roundGameDays).toBe(2)
      for (const fixture of division.fixtures) {
        expect(fixture.gameDay).toBe(gameDayOfRound(startedAt, fixture.round, B))
        expect(fixture.kickoffAt).toBe(kickoffAtForRound(startedAt, fixture.round, B))
        expect([12, 20]).toContain(beijingHour(fixture.kickoffAt!))
      }
    }
    const game = { season: world.divisions[0] } as never
    expect(roundKickoffAt(game, 4)).toBe(kickoffAtForRound(startedAt, 4, B))
    expect(seasonDay(game, startedAt + 3 * GAME_DAY_MS)).toBe(4)
    expect(elapsedGameDays(1000, 500)).toBe(0)
  })

  it('倒计时指向下一轮开赛（也就是本轮自动结算）的时间', () => {
    const startedAt = MIDNIGHT_BEIJING + 12 * HOUR
    const game = createWorldGame(1, undefined, '测试队', startedAt)
    migrateGameSchedule(game, startedAt)
    expect(nextMatchdayAt(game)).toBe(startedAt + 8 * HOUR)
    expect(matchdayCountdown(game, startedAt)).toBe('8 小时 0 分')
    expect(dueRound(game, nextMatchdayAt(game) - 1)).toBe(1)
    expect(dueRound(game, nextMatchdayAt(game))).toBe(2)
  })
})

describe('联机账号和共享世界：旧赛程（一天一轮）迁移', () => {
  it('进行中的赛季保持当前该踢的轮次，开赛时间对齐到最近的 12:00 / 20:00', () => {
    const now = MIDNIGHT_BEIJING + 15 * HOUR
    const game = createWorldGame(5, undefined, '测试队', now - 9.5 * 24 * HOUR)
    // 造一个旧存档：一天一轮，没有赛程标记
    delete game.world!.kickoffSchedule
    for (const division of game.world!.divisions) delete division.kickoffSchedule
    delete game.season.kickoffSchedule
    const legacyDue = 1 + Math.floor((now - game.world!.seasonStartedAt) / (24 * HOUR))
    expect(legacyDue).toBe(10)
    expect(migrateGameSchedule(game, now)).toBe(true)
    expect(dueRound(game, now)).toBe(10)
    expect(kickoffAtForRound(game.season.startedAt, 10, B)).toBeLessThanOrEqual(now)
    expect(kickoffAtForRound(game.season.startedAt, 11, B)).toBeGreaterThan(now)
    expect(game.season.kickoffSchedule).toBe(B)
    expect(game.season.roundGameDays).toBe(2)
    for (const division of game.world!.divisions) {
      expect(division.startedAt).toBe(game.world!.seasonStartedAt)
      for (const fixture of division.fixtures) expect(fixture.kickoffAt).toBe(kickoffAtForRound(division.startedAt, fixture.round, B))
    }
    // 只迁移一次
    expect(migrateGameSchedule(game, now + 24 * HOUR)).toBe(false)
    expect(migrateWorldSchedule(game.world!, now + 24 * HOUR)).toBe(false)
  })

  it('还没开始的赛季只重算赛程时间，不挪开始时间', () => {
    const now = MIDNIGHT_BEIJING
    expect(rescheduledStart(now + 5 * HOUR, now)).toBe(now + 5 * HOUR)
  })
})
