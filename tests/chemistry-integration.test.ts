import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialGame, loadGame, saveGame } from '../src/game/state.ts'
import { startTrainingWithSupport, trainingAction, previewTraining } from '../src/game/actions.ts'
import { chemistryKey, chemistryOf, chemistrySnapshot, recordMatchChemistry, recordTrainingChemistry } from '../src/game/chemistry.ts'
import { teamInputFromAI, teamInputFromLineup, withChemistry } from '../src/game/match/setup.ts'
import { PesEngine } from '../src/game/pes/engine.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { finishActiveMatch } from '../src/game/season.ts'
import { EVENTS } from '../src/game/data/events.ts'
import { partnerAssignment } from '../src/game/training-calendar.ts'
import { GAME_DAY_MS } from '../src/game/calendar.ts'

const now = Date.UTC(2026, 10, 10)
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('chemistry integration', () => {
  it('grows only for partners assigned to the chosen training activity, never for previews or failures', () => {
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const game = createInitialGame(777)
    const player = game.roster.find(p => !p.positions.GK)!
    expect(startTrainingWithSupport(game, player.id, 11).ok).toBe(true)
    const session = game.training[player.id]
    session.action = 8
    session.flags = EVENTS.map(e => e.id)
    session.lastEventAction = Object.fromEntries(EVENTS.map(e => [e.id, 1000]))
    session.eventCounts = Object.fromEntries(EVENTS.map(e => [e.id, 1000]))
    const partners = partnerAssignment(session).match
    expect(partners).toHaveLength(6)
    const request = { kind: 'activity', activityId: 'match' } as const
    expect(previewTraining(game, player.id, request).error).toBeUndefined()
    expect(game.chemistry).toBeUndefined()
    expect(trainingAction(game, player.id, request, now).ok).toBe(true)
    expect(Object.keys(game.chemistry!)).toHaveLength(6)
    for (const id of partners) expect(chemistryOf(game.chemistry, player.id, id, now)).toBeGreaterThan(0)
    expect(chemistryOf(game.chemistry, partners[0], partners[1], now)).toBe(0)
    const before = structuredClone(game.chemistry)
    expect(trainingAction(game, 'missing', request, now).ok).toBe(false)
    expect(game.chemistry).toEqual(before)
  })

  it.each(['pes', 'v2'] as const)('tracks disjoint substitutes correctly in %s and preserves snapshots on restore', kind => {
    const game = createInitialGame(11)
    const home = teamInputFromLineup(game.roster, game.lineup, { id: 'player', name: 'Home', color: '#fff', accent: '#000' })
    const away = teamInputFromAI(game.aiTeams[0])
    const outgoing = home.starters.find(p => !p.player.positions.GK)!
    const incoming = home.bench.find(p => !p.positions.GK)!
    recordTrainingChemistry(game, [[outgoing.player.id, incoming.id]], now)
    withChemistry(home, game.chemistry, now)
    const options = { seed: 11, home, away, knockout: false, durationSeconds: 60 }
    let engine = kind === 'pes' ? new PesEngine(options) : new MatchEngine({ ...options, rulesVersion: 2 })
    if (kind === 'pes') engine.advanceTo(30)
    else while (engine.state.clock < 30 && !engine.state.finished) engine.step()
    expect(engine.substitute(`home:${outgoing.player.id}`, `home:${incoming.id}`).ok).toBe(true)
    const saved = engine.serialize()
    engine = kind === 'pes' ? PesEngine.restore(saved) : MatchEngine.restore(saved, false)
    expect(engine.state.teams[0].chemistry).toEqual(home.chemistry)
    const state = engine.simulate()
    const stats = state.teams.flatMap(t => [...t.players, ...t.bench].map(p => p.stats))
    const out = stats.find(p => p.sourceId === outgoing.player.id)!
    const sub = stats.find(p => p.sourceId === incoming.id)!
    expect(out.offMinute).toBeLessThanOrEqual(sub.onMinute! + 0.001)
    const owner = {}
    recordMatchChemistry(owner, stats, now)
    expect(chemistrySnapshot((owner as typeof game).chemistry, [out.sourceId!, sub.sourceId!], now)).toEqual({})
  })

  it('settles completed matches once and round-trips relationships through local saves', () => {
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) })
    const game = createInitialGame(31)
    const home = teamInputFromLineup(game.roster, game.lineup, { id: 'player', name: 'Home', color: '#fff', accent: '#000' })
    const engine = new MatchEngine({ seed: 31, home, away: teamInputFromAI(game.aiTeams[0]), knockout: false, durationSeconds: 60, rulesVersion: 2 })
    const context = { isLeague: false, seed: 31, homeAway: 'home', opponentId: game.aiTeams[0].id, opponentName: 'Away' } as const
    game.activeMatch = { context, engineState: engine.serialize(), lineup: game.lineup, startedAt: now, instructions: [], coachPausesLeft: 3 }
    engine.simulate()
    expect(finishActiveMatch(game, engine, now)).not.toBeNull()
    const before = structuredClone(game.chemistry)
    expect(Object.keys(before!)).not.toHaveLength(0)
    expect(finishActiveMatch(game, engine, now)).toBeNull()
    expect(game.chemistry).toEqual(before)
    expect(saveGame(game)).toBe(true)
    expect(loadGame()!.chemistry).toEqual(before)
    vi.spyOn(Date, 'now').mockReturnValue(now + 180 * GAME_DAY_MS + 1)
    expect(loadGame()!.chemistry).toEqual({})
  })
})
