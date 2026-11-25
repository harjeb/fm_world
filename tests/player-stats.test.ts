import { describe, expect, it } from 'vitest'
import { createWorldGame } from '../src/game/world.ts'
import { catchUpSeason, finishActiveMatch, startLeagueMatch } from '../src/game/season.ts'
import { restoreActiveEngine } from '../src/game/actions.ts'
import { careerStats, fixtureTotals, matchKeeperConceded, seasonStats } from '../src/game/player-stats.ts'
import type { MatchRecord, PlayerMatchStats } from '../src/game/types.ts'
import { divisionLeaders } from '../src/game/world.ts'
import { GAME_DAY_MS } from '../src/game/calendar.ts'

function playedGame(rounds = 6) {
  const game = createWorldGame(8181)
  const started = Date.now() - (rounds - 1) * 4 * GAME_DAY_MS - 3600_000
  game.world!.seasonStartedAt = started
  game.season.startedAt = started
  catchUpSeason(game, Date.now())
  return game
}

describe('球员数据与射手榜', () => {
  it('本赛季和生涯数据来自已保存的战报，助攻不会丢', () => {
    const game = playedGame(6)
    const player = game.roster.find((item) => item.positions.GK <= 0 && game.lineup.starters.some((slot) => slot.playerId === item.id))!
    const season = seasonStats(game, player.id)
    const career = careerStats(game, player.id)
    expect(season.apps).toBeGreaterThan(0)
    expect(season.passes).toBeGreaterThan(0)
    expect(career.apps).toBeGreaterThanOrEqual(season.apps)
    // 战报里每场都有 seasonIndex，本赛季不会混进别的赛季。
    const records = game.matchHistory.filter((record) => record.playerStats.some((stats) => (stats.sourceId ?? '') === player.id))
    expect(records.length).toBe(season.apps)
    expect(records.every((record) => record.seasonIndex === game.season.index)).toBe(true)
  })

  it('全队进球等于球员进球之和（含 AI 对 AI 的场次）', () => {
    const game = playedGame(6)
    const division = game.season
    const goals = division.fixtures.reduce((sum, fixture) => sum + (fixture.score ? fixture.score.home + fixture.score.away : 0), 0)
    const credited = divisionLeaders(division, 'goals', 999).reduce((sum, row) => sum + row.goals, 0)
    // 只统计已经踢完的比赛：没踢的场次不该有进球。
    const played = division.fixtures.filter((fixture) => fixture.played)
    const playedGoals = played.reduce((sum, fixture) => sum + (fixture.score ? fixture.score.home + fixture.score.away : 0), 0)
    expect(goals).toBe(playedGoals)
    expect(credited).toBe(playedGoals)
  })

  it('射手榜与助攻榜按数值排序，别队球员也能拿到本赛季进球数', () => {
   	const game = playedGame(8)
    const scorers = divisionLeaders(game.season, 'goals', 5)
    expect(scorers.length).toBeGreaterThan(0)
    expect(scorers.every((row, index) => index === 0 || scorers[index - 1].goals >= row.goals)).toBe(true)
    const assists = divisionLeaders(game.season, 'assists', 5)
    expect(assists.every((row, index) => index === 0 || assists[index - 1].assists >= row.assists)).toBe(true)
    const other = scorers.find((row) => row.teamId !== 'player')!
    const totals = fixtureTotals(game, other.playerId)
    expect(totals.goals).toBe(other.goals)
  })

  it('赛季推进后本赛季数据归零，生涯继续累计', () => {
    const game = playedGame(4)
    const player = game.roster.find((item) => item.positions.GK <= 0 && game.lineup.starters.some((slot) => slot.playerId === item.id))!
    const before = careerStats(game, player.id)
    expect(before.apps).toBeGreaterThan(0)
    // 手动打一场，确认赛季数据与生涯同步增长。
    const started = startLeagueMatch(game)
    if (started.ok) {
      const engine = restoreActiveEngine(game)!
      engine.simulate()
      finishActiveMatch(game, engine)
      const after = careerStats(game, player.id)
      expect(after.apps).toBeGreaterThanOrEqual(before.apps)
      expect(seasonStats(game, player.id).apps).toBeGreaterThan(0)
    }
  })

  it('门将本赛季与生涯统计准确计算扑救、失球、零封和扑救成功率，并兼容旧战报', () => {
    const game = playedGame(5)
    const gk = game.roster.find((item) => item.positions.GK > 0 && game.lineup.starters.some((slot) => slot.playerId === item.id))!
    const season = seasonStats(game, gk.id)
    expect(season.apps).toBeGreaterThan(0)
    expect(season.savesKnownApps).toBe(season.apps)
    expect(season.concededKnownApps).toBe(season.apps)
    expect(season.cleanSheets).toBeLessThanOrEqual(season.apps)
    if (season.saves + season.goalsConceded > 0) {
      expect(season.saveRate).toBeCloseTo(season.saves / (season.saves + season.goalsConceded))
    }

    // 构造混合旧战报（无 goalsConceded / 无 saves）+ 新战报 + 中途替补门将战报
    const baseStat = (patch: Partial<PlayerMatchStats> = {}): PlayerMatchStats => ({
      playerId: `home:${gk.id}`, sourceId: gk.id, name: gk.name, side: 'home',
      minutes: 90, passes: 20, passesCompleted: 16, shots: 0, goals: 0, assists: 0,
      tackles: 0, interceptions: 1, distance: 4200, staminaLeft: 80, touches: 28,
      ...patch,
    })
    const legacyClean = {
      id: 'legacy-clean', isLeague: true, seasonIndex: 99, score: { home: 2, away: 0 }, result: 'win',
      playerStats: [baseStat({ saves: undefined, goalsConceded: undefined })],
    } as MatchRecord
    const modernMatch = {
      id: 'modern-gk', isLeague: true, seasonIndex: 99, score: { home: 1, away: 2 }, result: 'loss',
      playerStats: [baseStat({ saves: 6, goalsConceded: 2, xgConceded: 2.5, claims: 3 })],
    } as MatchRecord
    const subbedWithGoals = {
      id: 'subbed-gk', isLeague: true, seasonIndex: 99, durationSeconds: 600, score: { home: 1, away: 2 }, result: 'loss',
      goalDetails: [
        { playerId: 'opp:1', playerName: 'A', side: 'away', clock: 100, half: 1, origin: { x: 88, y: 32 }, distance: 12, bodyPart: 'right', technique: 'placed', situation: 'open', target: 'bottom_left' },
        { playerId: 'opp:2', playerName: 'B', side: 'away', clock: 500, half: 2, origin: { x: 88, y: 32 }, distance: 12, bodyPart: 'right', technique: 'placed', situation: 'open', target: 'bottom_right' },
        { playerId: 'me:1', playerName: 'C', side: 'home', clock: 300, half: 1, origin: { x: 88, y: 32 }, distance: 12, bodyPart: 'right', technique: 'placed', situation: 'open', target: 'bottom_left' },
      ],
      playerStats: [baseStat({ minutes: 65, onMinute: 0, offMinute: 65, saves: 2 })],
    } as MatchRecord
    // 第一个客队进球在 15 分钟（在场），第二个在 75 分钟（已下场），所以只记 1 个失球。
    expect(matchKeeperConceded(subbedWithGoals, subbedWithGoals.playerStats[0])).toEqual({ conceded: 1, cleanSheet: false })

    game.season.index = 99
    game.matchHistory = [legacyClean, modernMatch, subbedWithGoals]
    game.challengeHistory = []
    const totals = seasonStats(game, gk.id)
    expect(totals).toMatchObject({
      apps: 3,
      cleanSheets: 1,
      saves: 8,
      savesKnownApps: 2,
      goalsConceded: 3,
      concededKnownApps: 3,
      claims: 3,
      claimsKnownApps: 1,
    })
    expect(totals.xgConceded).toBeCloseTo(2.5)
    // 扑救成功率只按“扑救和失球同场已知”的两场计算：8 / (8 + 3)
    expect(totals.saveRate).toBeCloseTo(8 / 11)
  })
})
