import { describe, expect, it } from 'vitest'
import {
  AVERAGE_ROUND_GAME_DAYS,
  GAME_DAY_MS,
  KICKOFF_SCHEDULE,
  KICKOFF_UTC_HOURS,
  POSTSEASON_MS,
  ROUND_INTERVAL_MS,
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
import { DEFAULT_PRE_MATCH_STAMINA_BELOW, DEFAULT_STAMINA_BELOW } from '../src/game/match/management.ts'

const HOUR = 60 * 60 * 1000
const beijingHour = (at: number) => (new Date(at).getUTCHours() + 8) % 24
/** 2026-11-09 00:00 北京时间（= 11-08 16:00 UTC）。 */
const MIDNIGHT_BEIJING = Date.UTC(2026, 10, 8, 16)
const BJT_SLOTS = [2, 6, 10, 14, 18, 22]

describe('赛季日历：每天北京时间 02/06/10/14/18/22 固定 6 轮（一周一赛季）', () => {
  it('开赛时间点每 4 小时一轮，内部基准时长为 2 小时', () => {
    expect(KICKOFF_UTC_HOURS).toEqual([2, 6, 10, 14, 18, 22])
    expect(ROUND_INTERVAL_MS).toBe(4 * HOUR)
    expect(GAME_DAY_MS).toBe(2 * HOUR)
    expect(AVERAGE_ROUND_GAME_DAYS).toBe(2)
    const kickoffs = Array.from({ length: 7 }, (_, index) => kickoffAtForRound(MIDNIGHT_BEIJING, index + 1))
    expect(kickoffs.map(beijingHour)).toEqual([2, 6, 10, 14, 18, 22, 2])
    expect(kickoffs[0]).toBe(MIDNIGHT_BEIJING + 2 * HOUR)
    expect(kickoffs.slice(1).map((at, index) => (at - kickoffs[index]) / HOUR)).toEqual([4, 4, 4, 4, 4, 4])
    expect(roundGapGameDays(MIDNIGHT_BEIJING, 1)).toBe(2)
  })

  it('赛季正好在开赛时间点开始时，第 1 轮就在那一刻；中途开始的赛季从下一个时间点踢', () => {
    const atSlot = MIDNIGHT_BEIJING + 10 * HOUR
    expect(kickoffAtForRound(atSlot, 1)).toBe(atSlot)
    expect(kickoffAtForRound(atSlot, 2)).toBe(atSlot + 4 * HOUR)
    expect(kickoffAtForRound(atSlot + 1, 1)).toBe(atSlot + 4 * HOUR)
    expect(latestKickoffAt(atSlot + 3 * HOUR)).toBe(atSlot)
    expect(latestKickoffAt(atSlot)).toBe(atSlot)
    expect(latestKickoffAt(atSlot - 1)).toBe(atSlot - 4 * HOUR)
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

  it('38 轮常规赛 + 16 小时休整 = 整 7 天（168 小时），下一赛季同一时刻开赛', () => {
    const start = MIDNIGHT_BEIJING + 10 * HOUR
    expect(kickoffAtForRound(start, 38) - start).toBe(37 * 4 * HOUR)
    expect(postseasonStartAt(start)).toBe(kickoffAtForRound(start, 39))
    expect(seasonEndAt(start) - postseasonStartAt(start)).toBe(POSTSEASON_MS)
    expect(seasonEndAt(start) - start).toBe(7 * 24 * HOUR)
    expect(seasonStartAt(start, 1)).toBe(start)
    expect(seasonStartAt(start, 2)).toBe(seasonEndAt(start))
    expect(seasonStartAt(start, 3)).toBe(seasonEndAt(seasonEndAt(start)))
    expect(beijingHour(seasonStartAt(start, 2))).toBe(10)
    expect(kickoffAtForRound(seasonStartAt(start, 2), 1)).toBe(seasonStartAt(start, 2))
  })

  it('存档时钟领先现实（单机跳过时间）时，开赛时间点按存档时钟计算', () => {
    const shift = 5 * HOUR + 17 * 60_000
    const start = MIDNIGHT_BEIJING + 10 * HOUR - shift
    for (let round = 1; round <= 6; round++) {
      const kickoff = kickoffAtForRound(start, round, shift)
      expect(BJT_SLOTS).toContain(beijingHour(kickoff + shift))
      expect(kickoff).toBe(kickoffAtForRound(start + shift, round) - shift)
    }
    expect(kickoffAtForRound(start, 1, shift)).toBe(start)
    expect(roundsKickedOff(start, kickoffAtForRound(start, 3, shift), shift)).toBe(3)
    expect(seasonStartForRound(kickoffAtForRound(start, 3, shift), 3, shift)).toBe(start)
    expect(seasonEndAt(start, shift)).toBe(seasonEndAt(start + shift) - shift)
  })
})

describe('存档和世界都用同一套赛程', () => {
  it('服务器共享世界：赛程的 kickoffAt 都落在每天 6 轮时刻表上', () => {
    const startedAt = 1_700_000_000_000
    const { world } = createOwnerlessWorld(1, startedAt)
    expect(world.kickoffSchedule).toBe(KICKOFF_SCHEDULE)
    for (const division of world.divisions) {
      expect(division.kickoffSchedule).toBe(KICKOFF_SCHEDULE)
      expect(division.roundGameDays).toBe(2)
      for (const fixture of division.fixtures) {
        expect(fixture.gameDay).toBe(gameDayOfRound(startedAt, fixture.round))
        expect(fixture.kickoffAt).toBe(kickoffAtForRound(startedAt, fixture.round))
        expect(BJT_SLOTS).toContain(beijingHour(fixture.kickoffAt!))
      }
    }
    const game = { season: world.divisions[0] } as never
    expect(roundKickoffAt(game, 4)).toBe(kickoffAtForRound(startedAt, 4))
    expect(seasonDay(game, startedAt + 3 * GAME_DAY_MS)).toBe(4)
    expect(elapsedGameDays(1000, 500)).toBe(0)
  })

  it('单机世界存档：从最近一个开赛时间点开始，且默认开启没体力自动换人', () => {
    const now = MIDNIGHT_BEIJING + 11 * HOUR
    const game = createWorldGame(1, undefined, '测试队', latestKickoffAt(now))
    expect(game.world!.kickoffSchedule).toBe(KICKOFF_SCHEDULE)
    expect(game.season.kickoffSchedule).toBe(KICKOFF_SCHEDULE)
    expect(game.season.startedAt).toBe(MIDNIGHT_BEIJING + 10 * HOUR)
    expect(playerKickoff(game, 1)).toBe(game.season.startedAt)
    expect(dueRound(game, now)).toBe(1)
    expect(game.autoSubs?.staminaBelow).toBe(DEFAULT_STAMINA_BELOW)
    expect(game.autoSubs?.preMatchStaminaBelow).toBe(DEFAULT_PRE_MATCH_STAMINA_BELOW)
    expect(game.autoSubs?.onInjury).toBe(true)
    for (const fixture of game.season.fixtures) expect(BJT_SLOTS).toContain(beijingHour(fixture.kickoffAt!))
  })

  it('倒计时指向下一轮开赛（4 小时后）的时间', () => {
    const startedAt = MIDNIGHT_BEIJING + 10 * HOUR
    const game = createWorldGame(1, undefined, '测试队', startedAt)
    expect(nextMatchdayAt(game)).toBe(startedAt + 4 * HOUR)
    expect(matchdayCountdown(game, startedAt)).toBe('4 小时 0 分')
    expect(dueRound(game, nextMatchdayAt(game) - 1)).toBe(1)
    expect(dueRound(game, nextMatchdayAt(game))).toBe(2)
  })

  it('老的单联赛存档也一样', () => {
    const startedAt = MIDNIGHT_BEIJING + 18 * HOUR
    const teams = [1, 2, 3, 4].map((index) => ({
      id: `ai${index}`, name: `AI${index}`, short: `A${index}`, color: '#000', accent: '#fff', style: 'balanced',
      formationId: '4-4-2' as const,
      tactics: { attack: 'balanced', passing: 'mixed', tempo: 'normal', line: 'mid', press: 'mid' } as const,
      strength: 3, playerNames: [], lineup: {}, players: [], starPlayerIds: [],
    }))
    const solo = createSeason(7, teams as never, '测试队', startedAt)
    expect(solo.kickoffSchedule).toBe(KICKOFF_SCHEDULE)
    expect(solo.fixtures[0].kickoffAt).toBe(startedAt)
    expect(solo.fixtures.find((fixture) => fixture.round === 2)!.kickoffAt).toBe(startedAt + 4 * HOUR)
  })
})

describe('旧赛程（一天一轮 / 一天两轮）迁移：单机存档、联机账号、共享世界', () => {
  it('一天一轮旧存档迁移保持当前该踢的轮次，并补齐默认自动换人', () => {
    const now = MIDNIGHT_BEIJING + 15 * HOUR
    const game = createWorldGame(5, undefined, '测试队', now - 9.5 * 24 * HOUR)
    delete game.world!.kickoffSchedule
    for (const division of game.world!.divisions) delete division.kickoffSchedule
    delete game.season.kickoffSchedule
    game.autoSubs = { timed: [], staminaBelow: null, onInjury: false }
    game.season.clockShift = 3 * HOUR
    const legacyDue = 1 + Math.floor((now - game.world!.seasonStartedAt) / (24 * HOUR))
    expect(legacyDue).toBe(10)
    expect(migrateGameSchedule(game, now)).toBe(true)
    expect(dueRound(game, now)).toBe(10)
    expect(game.season.clockShift).toBeUndefined()
    expect(kickoffAtForRound(game.season.startedAt, 10)).toBeLessThanOrEqual(now)
    expect(kickoffAtForRound(game.season.startedAt, 11)).toBeGreaterThan(now)
    expect(game.season.kickoffSchedule).toBe(KICKOFF_SCHEDULE)
    expect(game.season.gameDayMs).toBe(GAME_DAY_MS)
    expect(game.autoSubs.staminaBelow).toBe(DEFAULT_STAMINA_BELOW)
    expect(game.autoSubs.preMatchStaminaBelow).toBe(DEFAULT_PRE_MATCH_STAMINA_BELOW)
    expect(game.autoSubs.onInjury).toBe(true)
    for (const division of game.world!.divisions) {
      expect(division.startedAt).toBe(game.world!.seasonStartedAt)
      for (const fixture of division.fixtures) expect(fixture.kickoffAt).toBe(kickoffAtForRound(division.startedAt, fixture.round))
    }
    expect(migrateGameSchedule(game, now + 24 * HOUR)).toBe(false)
    expect(migrateWorldSchedule(game.world!, now + 24 * HOUR)).toBe(false)
  })

  it('一天两轮进行中世界（含第 15 轮已赛）无缝迁移到下一场 10:00 开赛', () => {
    const now = MIDNIGHT_BEIJING + 8.5 * HOUR // 08:30 北京时间
    const game = createWorldGame(9, undefined, '测试队', MIDNIGHT_BEIJING - 7 * 24 * HOUR)
    game.world!.kickoffSchedule = 2
    for (const division of game.world!.divisions) {
      division.kickoffSchedule = 2
      division.gameDayMs = 6 * HOUR
      for (const fixture of division.fixtures) {
        if (fixture.round <= 15) {
          fixture.played = true
          fixture.score = { home: 1, away: 0 }
          fixture.kickoffAt = MIDNIGHT_BEIJING - 2 * HOUR
        } else {
          fixture.kickoffAt = MIDNIGHT_BEIJING + 12 * HOUR + (fixture.round - 16) * 12 * HOUR
        }
      }
    }
    game.season.kickoffSchedule = 2
    game.season.gameDayMs = 6 * HOUR
    expect(migrateGameSchedule(game, now)).toBe(true)
    expect(dueRound(game, now)).toBe(15)
    expect(playerKickoff(game, 16)).toBe(MIDNIGHT_BEIJING + 10 * HOUR)
    expect(playerKickoff(game, 17)).toBe(MIDNIGHT_BEIJING + 14 * HOUR)
    expect(game.season.gameDayMs).toBe(GAME_DAY_MS)
  })

  it('还没开始的赛季只重算赛程时间，不挪开始时间', () => {
    const now = MIDNIGHT_BEIJING
    expect(rescheduledStart(now + 5 * HOUR, now)).toBe(now + 5 * HOUR)
  })
})

function playerKickoff(game: ReturnType<typeof createWorldGame>, round: number): number | undefined {
  return game.season.fixtures.find((fixture) => fixture.isPlayer && fixture.round === round)?.kickoffAt
}
