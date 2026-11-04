import { describe, expect, it } from 'vitest'
import { LOGIC_MATCH_SECONDS } from '../src/game/match/time.ts'
import { createInitialGame } from '../src/game/state.ts'
import { simulateAIvsAIState } from '../src/game/match/setup.ts'
import { caOf } from '../src/game/ca.ts'
import { createTrainingSession, performTrainingAction, resolveTrainingEvent } from '../src/game/training.ts'
import { eventById } from '../src/game/data/events.ts'

describe('体验与平衡验证', () => {
  it('AI 对局比分、射门与主客场分布处于可玩区间', () => {
    const game = createInitialGame(20260418)
    const teams = game.aiTeams
    let goals = 0
    let shots = 0
    let homeWins = 0
    let draws = 0
    let matches = 0
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        for (let leg = 0; leg < 2; leg++) {
          const home = leg === 0 ? teams[i] : teams[j]
          const away = leg === 0 ? teams[j] : teams[i]
          const state = simulateAIvsAIState(home, away, 1000 + i * 100 + j * 2 + leg, LOGIC_MATCH_SECONDS)
          goals += state.score.home + state.score.away
          shots += state.stats.home.shots + state.stats.away.shots
          if (state.score.home > state.score.away) homeWins++
          else if (state.score.home === state.score.away) draws++
          matches++
        }
      }
    }
    const avgGoals = goals / matches
    const avgShots = shots / matches
    const homeWinPct = (homeWins / matches) * 100
    const drawPct = (draws / matches) * 100
    expect(avgGoals).toBeGreaterThan(2)
    expect(avgGoals).toBeLessThan(5)
    expect(avgShots).toBeGreaterThan(18)
    expect(avgShots).toBeLessThan(30)
    expect(homeWinPct).toBeGreaterThan(15)
    expect(homeWinPct).toBeLessThan(55)
    expect(drawPct).toBeGreaterThan(10)
    expect(drawPct).toBeLessThan(75)
    const cas = teams.flatMap((team) => team.players).map((player) => caOf(player.attrs, player.positions.GK > 0))
    expect(Math.min(...cas)).toBeGreaterThan(0)
    expect(Math.max(...cas)).toBeLessThanOrEqual(1500)
    expect(cas.reduce((a, b) => a + b, 0) / cas.length).toBeGreaterThanOrEqual(200)
    expect(cas.reduce((a, b) => a + b, 0) / cas.length).toBeLessThanOrEqual(300)
  }, 30000)

  it('一次完整培养的主属性收益合理且不超过 1500', () => {
    const game = createInitialGame(20260419)
    const player = game.roster.find((item) => item.positions.GK === 0)!
    const session = createTrainingSession(player, 99)
    delete session.scheduleVersion // Exercise the pre-calendar route's balance.
    const startCa = caOf(session.candidate.attrs, false)
    expect(session.actionsTotal).toBe(30)
    for (let action = 0; action < session.actionsTotal!; action++) {
      if (session.pendingEventId) {
        resolveTrainingEvent(session, eventById(session.pendingEventId)!.options[0].id)
        continue
      }
      const result = performTrainingAction(session, session.fatigue + 12 > 100
        ? { kind: 'rest' }
        : { kind: 'drill', attr: action % 2 === 0 ? 'passing' : 'shooting' })
      expect(result.ok).toBe(true)
      if (session.pendingEventId) resolveTrainingEvent(session, eventById(session.pendingEventId)!.options[0].id)
    }
    const endCa = caOf(session.candidate.attrs, false)
    expect(session.completed).toBe(true)
    expect(endCa - startCa).toBeGreaterThan(30)
    expect(endCa - startCa).toBeLessThan(550)
    expect(endCa).toBeLessThanOrEqual(1500 + 1e-6)
    expect(session.candidate.attrs.passing).toBeLessThanOrEqual(1500)
    expect(session.candidate.attrs.firstTouch).toBeLessThanOrEqual(20)
  })
})
