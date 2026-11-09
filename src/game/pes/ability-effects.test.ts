import { describe, expect, it } from 'vitest'
import { effectiveAttr } from '../ca.ts'
import { FORMATIONS } from '../data/formations.ts'
import { MatchRatings } from '../match/ratings.ts'
import type { MatchPlayerState } from '../match/types.ts'
import { attrStorage } from '../scale.ts'
import { ALL_ATTRIBUTES } from '../types.ts'
import { abilityOf, MotionRatings } from './ability.ts'
import { baselineTeams } from './baseline.ts'
import { PesGame, type PesGameOptions } from './game.ts'
import type { PesMatchSnapshot, PesPlayer } from './spec.ts'

function options(): PesGameOptions {
  const inputs = structuredClone(baselineTeams(1))
  for (const team of [inputs.home, inputs.away]) {
    team.autoSubs = { timed: [], staminaBelow: null, onInjury: false }
    for (const player of [...team.starters.map(s => s.player), ...team.bench]) {
      const gk = player.positions.GK > 0
      for (const key of ALL_ATTRIBUTES) player.attrs[key] = attrStorage(key, 38.3, gk)
      player.traitId = 'engine' // No effective-attribute bonus.
      player.condition = 100
    }
    for (const starter of team.starters) {
      const position = FORMATIONS[team.formationId].slots.find(s => s.id === starter.slotId)!.position
      starter.player.positions[position] = 100
    }
  }
  return { seed: 314, ...inputs, now: 0, durationSeconds: 20 }
}

function selected(g: PesGame) {
  const q = g.match.teams[0].players[3]
  return { q, p: g.settlement.gamePlayer(q.pid) }
}

function expected(p: MatchPlayerState) {
  const attrs = { ...p.attrs }
  for (const key of ALL_ATTRIBUTES) {
    attrs[key] = effectiveAttr(p.attrs, 1, p.positions[p.position], key, p.position === 'GK') * (p.injured ? 0.7 : 1)
  }
  return abilityOf(attrs)
}

function injure(g: PesGame, q: PesPlayer) {
  g.settlement.onEvent(g.match, { t: g.match.time, type: 'injury', ti: q.ti, actors: [q.pid], meta: { days: 3 } })
}

function roundTrip(g: PesGame): PesGame {
  return PesGame.restore(JSON.parse(JSON.stringify(g.serialize())) as PesMatchSnapshot)
}

describe('effective PES motion abilities', () => {
  it('preserves raw calibration for a healthy, proficient player', () => {
    const g = new PesGame(options())
    const { q, p } = selected(g)
    expect(q.ab).toEqual(abilityOf(p.attrs))
    g.advance(1.1)
    expect(q.ab).toEqual(abilityOf(p.attrs))
  })

  it('applies initial injury independently of position proficiency', () => {
    const init = options()
    const healthy = new PesGame(init)
    const { q: hq, p: hp } = selected(healthy)
    init.injuries = { [hp.personId ?? hp.sourceId]: 86_400_000 }
    const injured = new PesGame(init)
    const { q, p } = selected(injured)
    expect(p.injured).toBe(true)
    expect(q.ab).toEqual(expected(p))
    expect(q.ab.pace).toBeLessThan(hq.ab.pace)
    expect(q.ab.control).toBeLessThan(hq.ab.control)
    expect(q.ab.handling).toBeLessThan(hq.ab.handling)
  })

  it('applies poor proficiency without requiring an injury', () => {
    const init = options()
    const healthy = new PesGame(init)
    const { q: hq, p: hp } = selected(healthy)
    init.home.starters.find(s => s.player.id === hp.sourceId)!.player.positions[hp.position] = 0
    const poor = new PesGame(init)
    const { q, p } = selected(poor)
    expect(p.injured).not.toBe(true)
    expect(q.ab).toEqual(expected(p))
    expect(q.ab.pace).toBeLessThan(hq.ab.pace)
    expect(q.ab.positioning).toBeLessThan(hq.ab.positioning)
  })

  it('refreshes all matching on-pitch cards immediately on an injury event, including after restore', () => {
    const g = new PesGame(options())
    g.advance(0.25) // Not an integer-second refresh boundary.
    const restored = roundTrip(g)
    const { q, p } = selected(g)
    const before = { ...q.ab }
    injure(g, q)
    injure(restored, restored.match.players[q.pid])
    const samePerson = g.match.players.filter(other => {
      const card = g.settlement.gamePlayer(other.pid)
      return (card.personId ?? card.sourceId) === (p.personId ?? p.sourceId)
    })
    expect(samePerson.length).toBeGreaterThan(1)
    for (const other of samePerson) expect(other.ab).toEqual(expected(g.settlement.gamePlayer(other.pid)))
    expect(q.ab.pace).toBeLessThan(before.pace)
    expect(restored.serialize()).toEqual(g.serialize())
    const afterInjury = roundTrip(g)
    expect(afterInjury.serialize()).toEqual(g.serialize())
    g.run()
    restored.run()
    afterInjury.run()
    expect(restored.serialize()).toEqual(g.serialize())
    expect(afterInjury.serialize()).toEqual(g.serialize())
  })

  it('keeps fatigue in physics, not in the ability conversion or periodic refresh', () => {
    const fresh = new PesGame(options())
    const init = options()
    for (const starter of init.home.starters) starter.player.condition = 20
    const tired = new PesGame(init)
    const { q: fq } = selected(fresh)
    const { q, p } = selected(tired)
    expect(q.stamina).toBeCloseTo(0.2)
    expect(q.ab).toEqual(fq.ab)
    const physics = tired.match as unknown as { maxSpeed(player: PesPlayer): number }
    expect(physics.maxSpeed(q)).toBeCloseTo((5 + q.ab.pace * 3.6) * (0.78 + 0.22 * q.stamina))
    const ratings = new MatchRatings(() => tired.state, () => tired.state.durationSeconds)
    expect(ratings.eff(p, 'speed')).toBeLessThan(p.attrs.speed) // Settlement still uses fatigue.
    tired.advance(1.1)
    expect(q.ab).toEqual(abilityOf(p.attrs))
  })

  it('retains live fresh/tired trait conditions when removing the numeric fatigue penalty', () => {
    const g = new PesGame(options())
    const { p } = selected(g)
    p.traitId = 'star_p313' // Guaranteed fresh-only dribbling bonus.
    const ratings = new MotionRatings(() => g.state, () => g.state.durationSeconds)
    const fresh = ratings.abilities(p)
    p.stamina = p.maxStamina * 0.2
    expect(ratings.abilities(p)).toEqual(abilityOf(p.attrs))
    expect(fresh.control).toBeGreaterThan(ratings.abilities(p).control)
  })

  it('refreshes spatial context from physical coordinates and normalizes second-half orientation', () => {
    const g = new PesGame(options())
    const { q, p } = selected(g)
    p.traitId = 'overlap'
    const refresh = () => g.settlement.onEvent(g.match, { t: g.match.time, type: 'injury', ti: q.ti, actors: [q.pid], meta: { days: 1 } })
    q.pos.y = 0
    refresh()
    const central = q.ab.accel
    q.pos.y = -g.match.spec.HW + 2
    refresh()
    expect(q.ab.accel).toBeGreaterThan(central)
    const wide = { ...q.ab }
    g.match.teams[0].dir = -1
    g.match.teams[1].dir = 1
    q.pos.x *= -1
    q.pos.y *= -1
    refresh()
    expect(q.ab).toEqual(wide)
  })

  it('invalidates active-team auras on substitution without needing a new settlement step', () => {
    const init = options()
    const probe = new PesGame(init)
    const { p: out } = selected(probe)
    init.home.starters.find(s => s.player.id === out.sourceId)!.player.traitId = 'star_p059' // Acceleration aura.
    const g = new PesGame(init)
    const teammate = g.match.teams[0].players[1]
    const player = g.settlement.gamePlayer(teammate.pid)
    expect(teammate.ab.accel).toBeGreaterThan(abilityOf(player.attrs).accel)
    const bench = g.availableBench('home').find(p => p.positions.GK === 0)!
    const step = g.state.step
    expect(g.substitute(out.id, bench.id).ok).toBe(true)
    expect(g.state.step).toBe(step)
    expect(teammate.ab).toEqual(abilityOf(player.attrs))
  })

  it('uses incoming slot proficiency/injury/substitute context and restores deterministically', () => {
    const g = new PesGame(options())
    g.advance(0.25)
    const { p: out } = selected(g)
    const bench = g.availableBench('home').find(p => p.positions.GK === 0)!
    bench.positions[out.position] = 0
    bench.injured = true
    bench.traitId = 'star_p477' // Guaranteed speed bonus only after coming on.
    const before = roundTrip(g)
    for (const match of [g, before]) expect(match.substitute(out.id, bench.id).ok).toBe(true)
    const pid = g.settlement.pidFor(bench.id)
    const incoming = g.settlement.gamePlayer(pid)
    const ratings = new MotionRatings(() => g.state, () => g.state.durationSeconds)
    expect(incoming).toMatchObject({ position: out.position, injured: true, subbedOn: true })
    expect(g.match.players[pid].ab).toEqual(ratings.abilities(incoming))
    expect(g.match.players[pid].ab.pace).toBeGreaterThan(expected(incoming).pace)
    expect(before.serialize()).toEqual(g.serialize())
    const after = roundTrip(g)
    g.run()
    before.run()
    after.run()
    expect(before.serialize()).toEqual(g.serialize())
    expect(after.serialize()).toEqual(g.serialize())
  })
})
