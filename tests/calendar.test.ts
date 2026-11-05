import { describe, expect, it } from 'vitest'
import { GAME_DAY_MS, ROUND_GAME_DAYS, ROUND_MS, elapsedGameDays, gameDayOfRound, kickoffAtForRound } from '../src/game/calendar.ts'
import { createWorldGame } from '../src/game/world.ts'
import { createSeason, dueRound, matchdayCountdown, nextMatchdayAt, roundKickoffAt, seasonDay } from '../src/game/season.ts'

describe('赛季日历', () => {
  it('一轮 = 4 个游戏日 = 现实 24 小时', () => {
    expect(ROUND_GAME_DAYS).toBe(4)
    expect(GAME_DAY_MS).toBe(6 * 60 * 60 * 1000)
    expect(ROUND_MS).toBe(24 * 60 * 60 * 1000)
  })

  it('轮次换算：游戏日与开球时间都按 4 个游戏日推进', () => {
    expect(gameDayOfRound(1)).toBe(0)
    expect(gameDayOfRound(2)).toBe(ROUND_GAME_DAYS)
    expect(gameDayOfRound(38)).toBe(37 * ROUND_GAME_DAYS)
    expect(kickoffAtForRound(1000, 3)).toBe(1000 + 2 * ROUND_MS)
    expect(elapsedGameDays(1000, 1000 + 2.9 * GAME_DAY_MS)).toBe(2)
    expect(elapsedGameDays(1000, 500)).toBe(0) // 起点之前不算负数
  })

  it('赛程的 gameDay 与 kickoffAt 完全由日历常量推出', () => {
    const startedAt = 1_700_000_000_000
    const game = createWorldGame(1, undefined, '测试队', startedAt)
    for (const fixture of game.season.fixtures) {
      expect(fixture.gameDay).toBe(gameDayOfRound(fixture.round))
      expect(fixture.kickoffAt).toBe(kickoffAtForRound(startedAt, fixture.round))
    }
    // 相邻两轮间隔正好一天
    const kickoffs = [...new Set<number>(game.season.fixtures.flatMap((fixture) => (typeof fixture.kickoffAt === 'number' ? [fixture.kickoffAt] : [])))].sort((a, b) => a - b)
    for (let i = 1; i < kickoffs.length; i++) expect(kickoffs[i]! - kickoffs[i - 1]!).toBe(ROUND_MS)
  })

  it('赛季状态里记录的时间字段与常量一致，赛季日历与共享世界不漂移', () => {
    const startedAt = 1_700_000_000_000
    const game = createWorldGame(1, undefined, '测试队', startedAt)
    expect(game.season.gameDayMs).toBe(GAME_DAY_MS)
    expect(game.season.roundGameDays).toBe(ROUND_GAME_DAYS)
    for (const division of game.world?.divisions ?? []) {
      expect(division.gameDayMs).toBe(GAME_DAY_MS)
      expect(division.roundGameDays).toBe(ROUND_GAME_DAYS)
    }
    expect(roundKickoffAt(game, 4)).toBe(kickoffAtForRound(startedAt, 4))
    expect(seasonDay(game, startedAt + 3 * GAME_DAY_MS)).toBe(4)
  })

  it('倒计时指向当前轮的结算时刻，也就是自动结算真正发生的时间', () => {
    const startedAt = 1_700_000_000_000
    const game = createWorldGame(1, undefined, '测试队', startedAt)
    expect(game.season.round).toBe(1)
    expect(nextMatchdayAt(game)).toBe(startedAt + ROUND_MS)
    expect(matchdayCountdown(game, startedAt)).toBe('24 小时 0 分')
    expect(matchdayCountdown(game, startedAt + ROUND_MS - 90 * 60 * 1000)).toBe('1 小时 30 分')
    expect(dueRound(game, nextMatchdayAt(game) - 1)).toBe(1)
    expect(dueRound(game, nextMatchdayAt(game))).toBe(2)
  })

  it('单人赛季与共享世界用同一套轮次节奏', () => {
    const startedAt = 1_700_000_000_000
    const teams = [1, 2, 3, 4].map((index) => ({
      id: `ai${index}`,
      name: `AI${index}`,
      short: `A${index}`,
      color: '#000',
      accent: '#fff',
      style: 'balanced',
      formationId: '4-4-2' as const,
      tactics: { attack: 'balanced', passing: 'mixed', tempo: 'normal', line: 'mid', press: 'mid' } as const,
      strength: 3,
      playerNames: [],
      lineup: {},
      players: [],
      starPlayerIds: [],
    }))
    const solo = createSeason(7, teams as never, '测试队', startedAt)
    expect(solo.roundGameDays).toBe(ROUND_GAME_DAYS)
    expect(solo.fixtures[0].kickoffAt).toBe(startedAt)
    expect([...new Set(solo.fixtures.map((fixture) => fixture.gameDay))][1]).toBe(ROUND_GAME_DAYS)
  })
})
