import { describe, expect, it } from 'vitest'
import { formOf, matchRating, recentAnalysis, squadForm } from '../src/game/form.ts'
import { createInitialGame } from '../src/game/state.ts'
import { PLAYER_TEAM_ID } from '../src/game/season.ts'
import type { GameState, MatchRecord, MatchTeamStats, PlayerMatchStats } from '../src/game/types.ts'

const teamStats = (overrides: Partial<MatchTeamStats> = {}): MatchTeamStats => ({
  possession: 50, passes: 40, passesCompleted: 30, shots: 8, shotsOnTarget: 3, goals: 1, interceptions: 6, tackles: 1, fouls: 0, corners: 1, xg: 1, distance: 5000, yellowCards: 0, redCards: 0, ...overrides,
})

const stat = (playerId: string, overrides: Partial<PlayerMatchStats> = {}): PlayerMatchStats => ({
  playerId: `home:${playerId}`, sourceId: playerId, name: playerId, side: 'home', minutes: 90, passes: 0, passesCompleted: 0, shots: 0, goals: 0, tackles: 0, interceptions: 0, distance: 0, staminaLeft: 60, touches: 0, ...overrides,
})

function record(round: number, playerStats: PlayerMatchStats[], options: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id: `m-${round}`, seed: round, createdAt: Date.now() + round, isLeague: true, round, homeId: PLAYER_TEAM_ID, awayId: 'ai', homeName: 'a', awayName: 'b', score: { home: 1, away: 1 }, result: 'draw',
    stats: { home: teamStats(), away: teamStats() }, playerStats, skillStats: [], failureStats: [], keyEvents: [], instructions: [], lineup: {} as MatchRecord['lineup'], opponentId: 'ai', ...options,
  }
}

function gameWith(records: MatchRecord[]): GameState {
  const game = createInitialGame(31)
  game.season.startedAt = 0
  game.matchHistory = records
  return game
}

describe('表现分', () => {
  it('无贡献的满场约 6.2，进球和拦截加分，红牌减分，范围在 3–10', () => {
    const plain = record(1, [])
    expect(matchRating(stat('x'), plain, false)).toBe(6.2)
    expect(matchRating(stat('x', { goals: 1, shots: 1 }), plain, false)).toBe(7.3)
    expect(matchRating(stat('x', { interceptions: 5 }), plain, false)).toBe(6.8)
    expect(matchRating(stat('x', { passes: 10, passesCompleted: 4 }), plain, false)).toBe(6)
    expect(matchRating(stat('x', { redCards: 1 }), plain, false)).toBe(4.7)
    expect(matchRating(stat('x', { goals: 9 }), plain, false)).toBe(10)
    expect(matchRating(stat('x', { redCards: 3 }), plain, false)).toBe(3)
  })

  it('胜负有小幅修正；门将按扑救和失球算', () => {
    expect(matchRating(stat('x'), record(1, [], { result: 'win' }), false)).toBe(6.5)
    expect(matchRating(stat('x'), record(1, [], { result: 'loss' }), false)).toBe(5.9)
    const stats = { home: teamStats(), away: teamStats({ shotsOnTarget: 5, goals: 1 }) }
    // 4 次扑救 +1.0，失 1 球 -0.35
    expect(matchRating(stat('k'), record(1, [], { stats }), true)).toBe(6.9)
    const clean = { home: teamStats(), away: teamStats({ shotsOnTarget: 2, goals: 0 }) }
    expect(matchRating(stat('k'), record(1, [], { stats: clean }), true)).toBe(7.2)
  })

  it('客场记录按客队数据算对手', () => {
    const stats = { home: teamStats({ shotsOnTarget: 3, goals: 0 }), away: teamStats({ shotsOnTarget: 9, goals: 9 }) }
    const away = record(1, [], { homeId: 'ai', awayId: PLAYER_TEAM_ID, stats })
    // 对手是主队：3 次扑救 +0.75，零封 +0.5
    expect(matchRating(stat('k', { side: 'away' }), away, true)).toBe(7.5)
  })
})

describe('球员近况', () => {
  it('取最近 5 场，从旧到新，平均分和累计都对', () => {
    const game = createInitialGame(31)
    const id = game.roster.find((player) => player.positions.GK <= 0)!.id
    const records = [6, 5, 4, 3, 2, 1].map((round) => record(round, [stat(id, { goals: round === 6 ? 2 : 0 })], { result: round === 6 ? 'win' : 'draw' }))
    game.season.startedAt = 0
    game.matchHistory = records
    const form = formOf(squadForm(game), id)
    // 最新一场：6.2 + 两球 2.2 + 胜场 0.3
    expect(form.ratings).toEqual([6.2, 6.2, 6.2, 6.2, 8.7])
    expect(form.average).toBeCloseTo(6.7)
    expect(form.apps).toBe(6)
    expect(form.goals).toBe(2)
    expect(form.wins).toBe(1)
    expect(form.recentMinutes).toBe(450)
  })

  it('对手、不在名单的球员和没上场的不计入', () => {
    const game = createInitialGame(32)
    const id = game.roster[0].id
    game.season.startedAt = 0
    game.matchHistory = [record(1, [stat(id, { minutes: 0 }), stat('nobody'), stat(id, { side: 'away', goals: 5 })])]
    expect(formOf(squadForm(game), id).apps).toBe(0)
    expect(formOf(squadForm(game), id).average).toBeNull()
    expect(squadForm(game).has('nobody')).toBe(false)
  })

  it('累计只算本赛季，近况仍看最近几场；友谊赛不计', () => {
    const game = createInitialGame(33)
    const id = game.roster[0].id
    game.season.startedAt = 1000
    game.matchHistory = [
      record(2, [stat(id)], { createdAt: 2000 }),
      record(1, [stat(id, { goals: 3 })], { createdAt: 500 }),
      record(9, [stat(id, { goals: 9 })], { createdAt: 3000, isLeague: false }),
    ]
    const form = formOf(squadForm(game), id)
    expect(form.ratings).toHaveLength(2)
    expect(form.apps).toBe(1)
    expect(form.goals).toBe(0)
  })
})

describe('近期比赛分析', () => {
  it('没有比赛时为空', () => {
    expect(recentAnalysis(gameWith([]))).toEqual({ matches: 0, positives: [], negatives: [] })
  })

  it('差距够大才列出，优势和劣势分开，并写上双方数字', () => {
    const stats = {
      home: teamStats({ possession: 62, shots: 14, shotsOnTarget: 6, goals: 1, xg: 2.2, passes: 50, passesCompleted: 45 }),
      away: teamStats({ possession: 38, shots: 6, shotsOnTarget: 2, goals: 2, xg: 0.7, passes: 40, passesCompleted: 24 }),
    }
    const analysis = recentAnalysis(gameWith([record(1, [], { stats })]))
    const positive = analysis.positives.map((item) => item.label)
    const negative = analysis.negatives.map((item) => item.label)
    expect(positive).toContain('控球率')
    expect(positive).toContain('传球成功率')
    expect(negative).toContain('把握机会')
    expect(negative).toContain('场均进球')
    expect(analysis.positives.find((item) => item.label === '控球率')?.detail).toBe('62% : 38%')
    expect(analysis.matches).toBe(1)
    expect(analysis.positives.length).toBeLessThanOrEqual(5)
  })

  it('客场时不把对手的数据当成自己的', () => {
    const stats = { home: teamStats({ possession: 70 }), away: teamStats({ possession: 30 }) }
    const analysis = recentAnalysis(gameWith([record(1, [], { homeId: 'ai', awayId: PLAYER_TEAM_ID, stats })]))
    expect(analysis.negatives.map((item) => item.label)).toContain('控球率')
    expect(analysis.negatives.find((item) => item.label === '控球率')?.detail).toBe('30% : 70%')
  })

  it('双方差不多时不硬凑结论', () => {
    const analysis = recentAnalysis(gameWith([record(1, [])]))
    expect(analysis.positives).toEqual([])
    expect(analysis.negatives).toEqual([])
  })
})
