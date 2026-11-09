import { describe, expect, it } from 'vitest'
import {
  AVERAGE_ROUND_GAME_DAYS,
  GAME_DAY_MS,
  KICKOFF_SCHEDULE,
  KICKOFF_UTC_HOURS,
  elapsedGameDays,
  gameDayOfRound,
  kickoffAtForRound,
  latestKickoffAt,
  postseasonStartAt,
  roundGapGameDays,
  roundsKickedOff,
  seasonEndAt,
  seasonStartAt,
  seasonStartForRound,
} from '../src/game/calendar.ts'
import { createOwnerlessWorld, createWorldGame } from '../src/game/world.ts'
import { createSeason, dueRound, matchdayCountdown, nextMatchdayAt, roundKickoffAt, seasonDay } from '../src/game/season.ts'
import { migrateGameSchedule, migrateWorldSchedule, rescheduledStart } from '../src/game/schedule.ts'

const HOUR = 60 * 60 * 1000
/** 北京时间（UTC+8）的小时。 */
const beijingHour = (at: number) => (new Date(at).getUTCHours() + 8) % 24
/** 2026-11-09 00:00 北京时间（= 11-08 16:00 UTC）。 */
const MIDNIGHT_BEIJING = Date.UTC(2026, 10, 8, 16)

describe('赛季日历：每天北京时间 12:00、20:00 各一轮（单机、联机一样）', () => {
  it('开赛时间点是北京时间 12:00 和 20:00；游戏日仍是现实 6 小时', () => {
    expect(KICKOFF_UTC_HOURS).toEqual([4, 12])
    expect(GAME_DAY_MS).toBe(6 * HOUR)
    expect(AVERAGE_ROUND_GAME_DAYS).toBe(2)
    const kickoffs = Array.from({ length: 6 }, (_, index) => kickoffAtForRound(MIDNIGHT_BEIJING, index + 1))
    expect(kickoffs.map(beijingHour)).toEqual([12, 20, 12, 20, 12, 20])
    expect(kickoffs[0]).toBe(MIDNIGHT_BEIJING + 12 * HOUR)
    // 相邻两轮隔 8 小时、16 小时交替
    expect(kickoffs.slice(1).map((at, index) => (at - kickoffs[index]) / HOUR)).toEqual([8, 16, 8, 16, 8])
    expect(roundGapGameDays(MIDNIGHT_BEIJING, 1)).toBeCloseTo(8 / 6, 10)
    expect(roundGapGameDays(MIDNIGHT_BEIJING, 2)).toBeCloseTo(16 / 6, 10)
  })

  it('赛季正好在开赛时间点开始时，第 1 轮就在那一刻；中途开始的赛季从下一个时间点踢', () => {
    const atSlot = MIDNIGHT_BEIJING + 20 * HOUR
    expect(kickoffAtForRound(atSlot, 1)).toBe(atSlot)
    expect(kickoffAtForRound(atSlot, 2)).toBe(atSlot + 16 * HOUR)
    expect(kickoffAtForRound(atSlot + 1, 1)).toBe(atSlot + 16 * HOUR)
    // 新存档 / 新世界从最近一个已过的开赛时间点开始
    expect(latestKickoffAt(atSlot + 3 * HOUR)).toBe(atSlot)
    expect(latestKickoffAt(atSlot)).toBe(atSlot)
    expect(latestKickoffAt(atSlot - 1)).toBe(atSlot - 8 * HOUR)
  })

  it('已开球的轮数、反推赛季开始时间', () => {
    const start = MIDNIGHT_BEIJING
    expect(roundsKickedOff(start, start)).toBe(0)
    expect(roundsKickedOff(start, kickoffAtForRound(start, 1))).toBe(1)
    expect(roundsKickedOff(start, kickoffAtForRound(start, 2) - 1)).toBe(1)
    expect(roundsKickedOff(start, kickoffAtForRound(start, 10))).toBe(10)
    expect(roundsKickedOff(start, start + 100 * 24 * HOUR)).toBe(39)
    const now = MIDNIGHT_BEIJING + 30 * 24 * HOUR + 15 * HOUR
    const anchored = seasonStartForRound(now, 7)
    expect(roundsKickedOff(anchored, now)).toBe(7)
    expect(kickoffAtForRound(anchored, 7)).toBeLessThanOrEqual(now)
    expect(kickoffAtForRound(anchored, 8)).toBeGreaterThan(now)
  })

  it('38 轮踢 19 天；之后进入 12 个游戏日（3 天）的休整，下一赛季接着开始', () => {
    const start = MIDNIGHT_BEIJING + 12 * HOUR
    expect(kickoffAtForRound(start, 38) - start).toBe(18 * 24 * HOUR + 8 * HOUR)
    expect(postseasonStartAt(start)).toBe(kickoffAtForRound(start, 39))
    expect(seasonEndAt(start) - postseasonStartAt(start)).toBe(12 * GAME_DAY_MS)
    expect(seasonStartAt(start, 1)).toBe(start)
    expect(seasonStartAt(start, 2)).toBe(seasonEndAt(start))
    expect(seasonStartAt(start, 3)).toBe(seasonEndAt(seasonEndAt(start)))
    // 下一赛季正好从 12:00 或 20:00 开始，第 1 轮就在那一刻
    expect([12, 20]).toContain(beijingHour(seasonStartAt(start, 2)))
    expect(kickoffAtForRound(seasonStartAt(start, 2), 1)).toBe(seasonStartAt(start, 2))
  })

  it('存档时钟领先现实（单机跳过时间）时，开赛时间点按存档时钟的 12:00 / 20:00 算', () => {
    const shift = 5 * HOUR + 17 * 60_000
    const start = MIDNIGHT_BEIJING + 12 * HOUR - shift
    for (let round = 1; round <= 6; round++) {
      const kickoff = kickoffAtForRound(start, round, shift)
      expect([12, 20]).toContain(beijingHour(kickoff + shift))
      expect(kickoff).toBe(kickoffAtForRound(start + shift, round) - shift)
    }
    expect(kickoffAtForRound(start, 1, shift)).toBe(start)
    expect(roundsKickedOff(start, kickoffAtForRound(start, 3, shift), shift)).toBe(3)
    expect(seasonStartForRound(kickoffAtForRound(start, 3, shift), 3, shift)).toBe(start)
    expect(seasonEndAt(start, shift)).toBe(seasonEndAt(start + shift) - shift)
  })
})

describe('存档和世界都用同一套赛程', () => {
  it('服务器共享世界：赛程的 gameDay 与 kickoffAt 都由日历推出', () => {
    const startedAt = 1_700_000_000_000
    const { world } = createOwnerlessWorld(1, startedAt)
    expect(world.kickoffSchedule).toBe(KICKOFF_SCHEDULE)
    for (const division of world.divisions) {
      expect(division.kickoffSchedule).toBe(KICKOFF_SCHEDULE)
      expect(division.roundGameDays).toBe(2)
      for (const fixture of division.fixtures) {
        expect(fixture.gameDay).toBe(gameDayOfRound(startedAt, fixture.round))
        expect(fixture.kickoffAt).toBe(kickoffAtForRound(startedAt, fixture.round))
        expect([12, 20]).toContain(beijingHour(fixture.kickoffAt!))
      }
    }
    const game = { season: world.divisions[0] } as never
    expect(roundKickoffAt(game, 4)).toBe(kickoffAtForRound(startedAt, 4))
    expect(seasonDay(game, startedAt + 3 * GAME_DAY_MS)).toBe(4)
    expect(elapsedGameDays(1000, 500)).toBe(0)
  })

  it('单机世界存档：从最近一个开赛时间点开始，第 1 轮马上能踢', () => {
    const now = MIDNIGHT_BEIJING + 15 * HOUR
    const game = createWorldGame(1, undefined, '测试队', latestKickoffAt(now))
    expect(game.world!.kickoffSchedule).toBe(KICKOFF_SCHEDULE)
    expect(game.season.kickoffSchedule).toBe(KICKOFF_SCHEDULE)
    expect(game.season.startedAt).toBe(MIDNIGHT_BEIJING + 12 * HOUR)
    expect(playerKickoff(game, 1)).toBe(game.season.startedAt)
    expect(dueRound(game, now)).toBe(1)
    for (const fixture of game.season.fixtures) expect([12, 20]).toContain(beijingHour(fixture.kickoffAt!))
  })

  it('倒计时指向下一轮开赛（也就是本轮自动结算）的时间', () => {
    const startedAt = MIDNIGHT_BEIJING + 12 * HOUR
    const game = createWorldGame(1, undefined, '测试队', startedAt)
    expect(nextMatchdayAt(game)).toBe(startedAt + 8 * HOUR)
    expect(matchdayCountdown(game, startedAt)).toBe('8 小时 0 分')
    expect(dueRound(game, nextMatchdayAt(game) - 1)).toBe(1)
    expect(dueRound(game, nextMatchdayAt(game))).toBe(2)
  })

  it('老的单联赛存档也一样', () => {
    const startedAt = MIDNIGHT_BEIJING + 20 * HOUR
    const teams = [1, 2, 3, 4].map((index) => ({
      id: `ai${index}`, name: `AI${index}`, short: `A${index}`, color: '#000', accent: '#fff', style: 'balanced',
      formationId: '4-4-2' as const,
      tactics: { attack: 'balanced', passing: 'mixed', tempo: 'normal', line: 'mid', press: 'mid' } as const,
      strength: 3, playerNames: [], lineup: {}, players: [], starPlayerIds: [],
    }))
    const solo = createSeason(7, teams as never, '测试队', startedAt)
    expect(solo.kickoffSchedule).toBe(KICKOFF_SCHEDULE)
    expect(solo.fixtures[0].kickoffAt).toBe(startedAt)
    expect(solo.fixtures.find((fixture) => fixture.round === 2)!.kickoffAt).toBe(startedAt + 16 * HOUR)
  })
})

describe('旧赛程（一天一轮）迁移：单机存档、联机账号、共享世界', () => {
  it('进行中的赛季保持当前该踢的轮次，开赛时间对齐到最近的 12:00 / 20:00', () => {
    const now = MIDNIGHT_BEIJING + 15 * HOUR
    const game = createWorldGame(5, undefined, '测试队', now - 9.5 * 24 * HOUR)
    // 造一个旧存档：一天一轮，没有赛程标记，之前还跳过时间
    delete game.world!.kickoffSchedule
    for (const division of game.world!.divisions) delete division.kickoffSchedule
    delete game.season.kickoffSchedule
    game.season.clockShift = 3 * HOUR
    const legacyDue = 1 + Math.floor((now - game.world!.seasonStartedAt) / (24 * HOUR))
    expect(legacyDue).toBe(10)
    expect(migrateGameSchedule(game, now)).toBe(true)
    expect(dueRound(game, now)).toBe(10)
    expect(game.season.clockShift).toBeUndefined()
    expect(kickoffAtForRound(game.season.startedAt, 10)).toBeLessThanOrEqual(now)
    expect(kickoffAtForRound(game.season.startedAt, 11)).toBeGreaterThan(now)
    expect(game.season.kickoffSchedule).toBe(KICKOFF_SCHEDULE)
    expect(game.season.roundGameDays).toBe(2)
    for (const division of game.world!.divisions) {
      expect(division.startedAt).toBe(game.world!.seasonStartedAt)
      for (const fixture of division.fixtures) expect(fixture.kickoffAt).toBe(kickoffAtForRound(division.startedAt, fixture.round))
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

function playerKickoff(game: ReturnType<typeof createWorldGame>, round: number): number | undefined {
  return game.season.fixtures.find((fixture) => fixture.isPlayer && fixture.round === round)?.kickoffAt
}
