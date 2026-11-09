import { describe, expect, it, vi } from 'vitest'
import { attrStorage, mainAttrsFor } from '../scale.ts'
import { baselineTeams } from './baseline.ts'
import type { ContactModel, DuelVerdict, PassVerdict, ShotVerdict } from './contact.ts'
import { PesEngine } from './engine.ts'
import { fixtureTeam } from './fixtures.ts'
import { PesGame } from './game.ts'
import { PesMatch } from './sim.ts'
import { GAME_RULES, makePitch7, type PesPlayer } from './spec.ts'

class ScriptedShot implements ContactModel {
  constructor(readonly result: ShotVerdict['result'] = 'goal', readonly hold = true) {}
  attach(): void {}
  onEvent(): void {}
  pass(): PassVerdict { return { result: 'ok', interceptor: -1, p: 1 } }
  shot(): ShotVerdict { return { result: this.result, blocker: -1, xg: 0.3, hold: this.hold, meta: {} } }
  duel(): DuelVerdict { throw new Error('No duel is allowed while closing a half') }
  tacticalFoul() { return null }
  aerial() { return -1 }
  loose(_m: PesMatch, players: PesPlayer[]) { return players[0].pid }
  beatsOffside() { return false }
  toJSON() { return {} }
}

type Internals = {
  execShot(player: PesPlayer, press: number): void
  decide(player: PesPlayer): void
  tryTackles(): void
  resolvePossession(): void
  updateRestart(dt: number): void
}
const internal = (m: PesMatch) => m as unknown as Internals

function prepare(m: PesMatch, half: 1 | 2) {
  m.half = half
  m.teams[0].dir = half === 1 ? 1 : -1
  m.teams[1].dir = half === 1 ? -1 : 1
  m.time = m.spec.HALF * half - m.spec.DT / 2
  m.phase = 'play'
  m.restart = null
  m.setPiece = null
  for (const q of m.players) {
    q.pos = { x: -24 + q.pid * 0.2, y: -15 }
    q.target = { ...q.pos }
    q.vel = { x: 0, y: 0 }
    q.noClaim = q.stun = 0
    q.decideT = 1e9
    q.urgency = 0
  }
  const shooter = m.teams[0].players[6]
  shooter.pos = { x: m.teams[0].dir * 22, y: 0 }
  shooter.target = { ...shooter.pos }
  Object.assign(m.ball, {
    frozen: false, owner: shooter.pid, x: shooter.pos.x, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0, lastTouch: shooter.pid, meta: null,
  })
  return shooter
}

function pending(half: 1 | 2, result: ShotVerdict['result'] = 'goal', hold = true) {
  const m = new PesMatch({
    seed: 3, spec: makePitch7(900),
    home: fixtureTeam('1-2-3-1', { seed: 1 }),
    away: fixtureTeam('1-2-3-1', { seed: 2 }),
    rules: GAME_RULES, contact: new ScriptedShot(result, hold),
  })
  internal(m).execShot(prepare(m, half), 0)
  return m
}

function finishHalf(m: PesMatch, half: 1 | 2) {
  let steps = 0
  while (!m.finished && m.half === half && steps < 2_000) {
    m.step()
    steps++
    expect(m.time).toBe(m.spec.HALF * half)
  }
  expect(steps).toBeLessThan(2_000)
  expect(half === 1 ? m.half === 2 : m.finished).toBe(true)
  return steps
}

function assertGoal(m: PesMatch, half: 1 | 2) {
  expect(m.events.filter(e => e.type === 'shot' && e.meta?.result === 'goal')).toHaveLength(1)
  const goals = m.events.filter(e => e.type === 'goal')
  expect(goals).toHaveLength(1)
  expect(goals[0]).toMatchObject({ t: m.spec.HALF * half, ti: 0 })
  expect(m.events.slice(-2).map(e => e.type)).toEqual(['goal', half === 1 ? 'half' : 'end'])
  expect(m.teams[0].score).toBe(1)
  expect(m.teams[0].stats).toMatchObject({ shots: 1, shotsOn: 1, goals: 1 })
  expect(m.teams[1].score).toBe(0)
}

describe('settled shots at the half/full whistle', () => {
  it.each([1, 2] as const)('finishes the committed goal before the half %i reset/end, without new play', half => {
    const m = pending(half)
    m.step()
    expect(m.time).toBe(450 * half)
    expect(m.half).toBe(half)
    expect(m.finished).toBe(false)
    expect(m.ball.meta?.result).toBe('goal')
    const spies = ['decide', 'tryTackles', 'resolvePossession', 'updateRestart'].map(key =>
      vi.spyOn(internal(m), key as keyof Internals),
    )
    for (const p of m.players) p.decideT = 0
    const shots = m.events.filter(e => e.type === 'shot').length
    expect(finishHalf(m, half)).toBeGreaterThan(1)
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    expect(m.events.filter(e => e.type === 'shot')).toHaveLength(shots)
    assertGoal(m, half)
    const ended = m.serialize()
    if (half === 2) {
      m.advance(1)
      expect(m.serialize()).toEqual(ended)
    }
  })

  it.each([1, 2] as const)('JSON-restores the capped pending flight in half %i deterministically', half => {
    const m = pending(half)
    m.recordHz = 60
    m.step()
    m.step()
    const frameStart = m.frames.length
    const resumed = PesMatch.restore(JSON.parse(JSON.stringify(m.serialize())), { contact: new ScriptedShot() })
    finishHalf(m, half)
    finishHalf(resumed, half)
    assertGoal(resumed, half)
    expect(resumed.serialize()).toEqual(m.serialize())
    expect(resumed.frames).toEqual(m.frames.slice(frameStart))
    expect(resumed.frames.every(frame => frame.t === m.spec.HALF * half)).toBe(true)
  })

  it.each([
    [1, 'miss', true], [2, 'miss', true],
    [1, 'save', true], [2, 'save', true], [1, 'save', false], [2, 'save', false],
  ] as const)('resolves half %i final-frame %s (hold=%s), without a rebound shot', (half, result, hold) => {
    const m = pending(half, result, hold)
    finishHalf(m, half)
    expect(m.teams.map(t => t.score)).toEqual([0, 0])
    expect(m.events.filter(e => e.type === 'shot')).toHaveLength(1)
    expect(m.events.filter(e => e.type === 'goal')).toHaveLength(0)
    expect(m.events.filter(e => e.type === 'save')).toHaveLength(result === 'save' ? 1 : 0)
    expect(m.events.at(-1)?.type).toBe(half === 1 ? 'half' : 'end')
    expect(m.teams[0].stats.shotsOn).toBe(result === 'save' ? 1 : 0)
    expect(m.teams[1].stats.saves).toBe(result === 'save' ? 1 : 0)
  })

  it.each(['goal', 'save', 'miss'] as const)('bounds a stalled %s flight without losing the committed outcome', result => {
    const m = pending(2, result)
    Object.assign(m.ball, { vx: 0, vy: 0, vz: 0, z: 0 })
    m.step()
    const restored = PesMatch.restore(JSON.parse(JSON.stringify(m.serialize())), { contact: new ScriptedShot(result) })
    const steps = finishHalf(m, 2)
    expect(steps).toBeGreaterThan(400)
    expect(steps).toBeLessThan(600)
    finishHalf(restored, 2)
    expect(restored.serialize()).toEqual(m.serialize())
    if (result === 'goal') assertGoal(m, 2)
    else {
      expect(m.teams[0].score).toBe(0)
      expect(m.events.filter(e => e.type === 'save')).toHaveLength(result === 'save' ? 1 : 0)
    }
  })

  it('leaves native no-contact whistle timing unchanged', () => {
    const m = new PesMatch({ seed: 3, home: fixtureTeam('1-2-3-1'), away: fixtureTeam('1-2-3-1') })
    const shooter = prepare(m, 2)
    internal(m).execShot(shooter, 0)
    m.step()
    expect(m.finished).toBe(true)
    expect(m.time).toBe(900 + m.spec.DT / 2)
  })
})

function gameWithFinalShot(half: 1 | 2 = 2) {
  const { home, away } = baselineTeams(1)
  const game = new PesGame({ seed: 3, home, away, now: 0 })
  const shooter = prepare(game.match, half)
  vi.spyOn(game.settlement, 'shot').mockReturnValue({ result: 'goal', blocker: -1, xg: 0.3, hold: true, meta: {} })
  internal(game.match).execShot(shooter, 0)
  return game
}

describe('PesEngine advances through capped-clock closing', () => {
  it('advanceTo(duration) resolves the goal and full-time stats, even when called at the cap after JSON restore', () => {
    const game = gameWithFinalShot()
    const engine = new PesEngine(game)
    game.step()
    expect(engine.state.finished).toBe(false)
    expect(engine.state.clock).toBe(900)
    const resumed = PesEngine.restore(JSON.parse(JSON.stringify(engine.serialize())))
    for (const e of [engine, resumed]) {
      const result = e.advanceTo(900)
      expect(result.changed).toBe(true)
      expect(result.entries.filter(entry => entry.type === 'goal')).toHaveLength(1)
      expect(e.state.finished).toBe(true)
      expect(e.state.clock).toBe(900)
      expect(e.state.score).toEqual({ home: 1, away: 0 })
      expect(e.state.stats.home).toMatchObject({ shots: 1, shotsOnTarget: 1, goals: 1 })
      expect(e.state.teams[0].players.reduce((n, p) => n + p.stats.goals, 0)).toBe(1)
      expect(e.state.log.filter(entry => entry.type === 'goal')).toHaveLength(1)
      expect(e.state.log.at(-1)?.type).toBe('full')
      expect(e.state.log.every(entry => entry.clock <= 900)).toBe(true)
      expect(e.advanceTo(900)).toEqual({ changed: false, entries: [] })
    }
    expect(resumed.serialize()).toEqual(engine.serialize())
  })

  it('advanceTo(duration) also finishes a stationary committed goal, rather than hanging at the cap', () => {
    const game = gameWithFinalShot()
    Object.assign(game.match.ball, { vx: 0, vy: 0, vz: 0, z: 0 })
    const engine = new PesEngine(game)
    engine.advanceTo(900)
    expect(engine.state.finished).toBe(true)
    expect(engine.state.score.home).toBe(1)
    expect(engine.game.match.time).toBe(900)
  })

  it('advanceTo(halftime) completes the pending flight but does not start second-half play', () => {
    const game = gameWithFinalShot(1)
    const engine = new PesEngine(game)
    engine.advanceTo(450)
    expect(game.match.half).toBe(2)
    expect(game.match.phase).toBe('kickoff')
    expect(game.match.time).toBe(450)
    expect(game.state.score).toEqual({ home: 1, away: 0 })
    expect(game.state.finished).toBe(false)
    expect(game.match.events.at(-1)?.type).toBe('half')
  })

  it('keeps naturally settled goals consistent for the seed50016 audit fixture', () => {
    const { home } = baselineTeams(1)
    const away = structuredClone(home)
    for (const [input, rating] of [[home, 70], [away, 45]] as const) {
      for (const p of [...input.starters.map(s => s.player), ...input.bench]) {
        const gk = p.positions.GK > 0
        for (const key of mainAttrsFor(gk)) p.attrs[key] = attrStorage(key, rating, gk)
        p.condition = 100
      }
      input.autoSubs = { timed: [], staminaBelow: null, onInjury: true }
    }
    const game = new PesGame({ seed: 50016, home, away, now: 0 })
    const engine = new PesEngine(game)
    engine.advanceTo(900)
    expect(game.finished).toBe(true)
    const committed = game.match.events.filter(e => e.type === 'shot' && e.meta?.result === 'goal')
    const goals = game.match.events.filter(e => e.type === 'goal')
    expect(goals).toHaveLength(committed.length)
    expect(game.state.score.home + game.state.score.away).toBe(goals.length)
    expect(game.state.stats.home.goals + game.state.stats.away.goals).toBe(goals.length)
    expect(game.state.log.filter(e => e.type === 'goal')).toHaveLength(goals.length)
    expect(game.match.events.every(e => e.t <= 900)).toBe(true)
  })
})
