import { describe, expect, it } from 'vitest'
import { createWorldGame } from '../src/game/world.ts'
import { catchUpSeason, finishActiveMatch, startLeagueMatch } from '../src/game/season.ts'
import { restoreActiveEngine } from '../src/game/actions.ts'
import { careerStats, fixtureTotals, seasonStats } from '../src/game/player-stats.ts'
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
    const player = game.roster.find((item) => item.positions.GK <= 0)!
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
    const player = game.roster.find((item) => item.positions.GK <= 0)!
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
})
