import { describe, expect, it } from 'vitest'
import type { ContactModel, DuelVerdict, PassVerdict, ShotRequest, ShotVerdict } from './contact.ts'
import { fixtureTeam } from './fixtures.ts'
import { PesMatch } from './sim.ts'
import { GAME_RULES, makePitch7, type BallMeta, type PesPlayer, type PesTeam } from './spec.ts'

class Scripted implements ContactModel {
  duelCalls = 0
  duelVerdict: DuelVerdict = { outcome: 'foul', card: 'yellow', second: false, injured: -1, recoveryDays: 0, p: 0.5 }
  attach(): void {}
  onEvent(): void {}
  pass(): PassVerdict { return { result: 'ok', interceptor: -1, p: 1 } }
  shot(): ShotVerdict { return { result: 'miss', blocker: -1, xg: 0.3, hold: false, meta: {} } }
  duel(): DuelVerdict { this.duelCalls++; return this.duelVerdict }
  tacticalFoul() { return null }
  aerial() { return -1 }
  loose(_m: PesMatch, players: PesPlayer[]) { return players[0].pid }
  beatsOffside() { return false }
  toJSON() { return {} }
}
type Internals = {
  secondLastLx(team: PesTeam, opponents: PesTeam): number
  isOffside(team: PesTeam, player: PesPlayer): boolean
  tryTackles(): void
  resolvePossession(): void
  execShot(player: PesPlayer, press: number, request?: ShotRequest): void
  updateBall(dt: number): void
  checkRules(): void
}
const internal = (m: PesMatch) => m as unknown as Internals
function place(m: PesMatch, pid: number, x: number, y: number) {
  const q = m.players[pid]
  q.pos = { x, y }; q.target = { x, y }; q.vel = { x: 0, y: 0 }
  q.noClaim = q.stun = q.urgency = 0
  q.decideT = 1e9
  return q
}
function setup() {
  const contact = new Scripted()
  const m = new PesMatch({ seed: 3, spec: makePitch7(900), home: fixtureTeam('1-2-3-1', { seed: 1 }), away: fixtureTeam('1-2-3-1', { seed: 2 }), rules: GAME_RULES, contact })
  m.restart = null; m.phase = 'play'; m.ball.frozen = false
  for (const q of m.players) place(m, q.pid, -24 + q.pid * 0.2, -15)
  return { m, contact }
}
function loose(m: PesMatch, meta: BallMeta, age = 2.1) {
  Object.assign(m.ball, { owner: -1, x: 10, y: 0, z: 0, vx: 0, vy: 0, vz: 0, looseT: age, meta })
}
function incoming(m: PesMatch, pid: number) {
  const q = m.players[pid]
  return m.substitute(pid, { name: 'SUB', abilities: { ...q.ab }, ref: 'sub' })
}

describe('offside uses the second-last opponent, including the keeper', () => {
  it.each([1, -1] as const)('keeps a receiver behind the last outfielder onside (direction %i)', dir => {
    const { m } = setup()
    m.teams[0].dir = dir; m.teams[1].dir = dir === 1 ? -1 : 1
    for (const q of m.teams[1].players) place(m, q.pid, -24 * dir, -15)
    place(m, 7, 29 * dir, 0); place(m, 8, 20 * dir, 4); place(m, 9, 15 * dir, -4)
    const receiver = place(m, 6, 18 * dir, 0)
    m.ball.x = 5 * dir
    expect(internal(m).secondLastLx(m.teams[0], m.teams[1])).toBe(20)
    expect(internal(m).isOffside(m.teams[0], receiver)).toBe(false)
    receiver.pos.x = 21 * dir
    expect(internal(m).isOffside(m.teams[0], receiver)).toBe(true)
    m.ball.x = 22 * dir
    expect(internal(m).isOffside(m.teams[0], receiver)).toBe(false)
  })

  it('sorts by position when the keeper rushes out or is absent, not by role', () => {
    const { m } = setup()
    place(m, 7, 10, 0); place(m, 8, 20, 4); place(m, 9, 15, -4)
    expect(internal(m).secondLastLx(m.teams[0], m.teams[1])).toBe(15)
    m.teams[1].players = m.teams[1].players.filter(q => q.pid !== 7)
    expect(internal(m).secondLastLx(m.teams[0], m.teams[1])).toBe(15)
    m.teams[1].players = [m.players[8]]
    expect(internal(m).secondLastLx(m.teams[0], m.teams[1])).toBe(-m.spec.HL)
  })
})

describe('one contest cannot continue after a dead ball or possession change', () => {
  it.each(['foul', 'tackle', 'loose'] as const)('stops after the first %s with two close defenders', outcome => {
    const { m, contact } = setup()
    const att = place(m, 6, 0, 0)
    place(m, 8, 0.5, 0); place(m, 9, -0.5, 0)
    Object.assign(m.ball, { owner: att.pid, x: 0, y: 0, z: 0 })
    contact.duelVerdict.outcome = outcome
    contact.duelVerdict.card = outcome === 'foul' ? 'yellow' : null
    internal(m).tryTackles()
    expect(contact.duelCalls).toBe(1)
    if (outcome === 'foul') {
      expect(m.events.filter(e => e.type === 'foul')).toHaveLength(1)
      expect(m.events.filter(e => e.type === 'card')).toHaveLength(1)
      expect(m.teams[1].stats.fouls).toBe(1)
      expect(m.ball.frozen).toBe(true)
      internal(m).tryTackles()
      expect(contact.duelCalls).toBe(1)
    } else expect(m.ball.owner).toBe(-1)
  })

  it('does not tackle the former attacker after a goalkeeper claim', () => {
    const { m, contact } = setup()
    const att = place(m, 6, 27, 0)
    place(m, 7, 28, 0); place(m, 8, 27.5, 0)
    Object.assign(m.ball, { owner: att.pid, x: 27, y: 0, z: 0 })
    m.rng.float = () => 0
    internal(m).tryTackles()
    expect(m.ball.owner).toBe(7)
    expect(contact.duelCalls).toBe(0)
    expect(m.events.filter(e => e.type === 'save')).toHaveLength(1)
  })
})

describe('substitutions update live ball/restart responsibilities, not history', () => {
  it.each(['ok', 'icpt'] as const)('lets the replacement receive the already-decided %s ball', result => {
    const { m } = setup()
    const pid = result === 'ok' ? 6 : 8
    place(m, pid, 10, 0)
    loose(m, { type: 'pass', from: 3, intended: 6, icpt: 8, result }, 0.5)
    m.ball.lastTouch = 3
    const inc = incoming(m, pid)
    expect(result === 'ok' ? m.ball.meta?.intended : m.ball.meta?.icpt).toBe(inc.pid)
    expect(m.ball.meta?.from).toBe(3)
    expect(m.ball.lastTouch).toBe(3)
    const restored = PesMatch.restore(JSON.parse(JSON.stringify(m.serialize())), { contact: new Scripted() })
    for (const match of [m, restored]) {
      internal(match).resolvePossession()
      expect(match.ball.owner).toBe(inc.pid)
      expect(match.teams[0].stats.passesOk).toBe(result === 'ok' ? 1 : 0)
    }
    expect(restored.serialize()).toEqual(m.serialize())
  })

  it('transfers owner, restart and active set-piece taker without changing the last touch or shot author', () => {
    const { m } = setup()
    m.ball.owner = 6; m.ball.lastTouch = 6
    m.ball.meta = { type: 'shot', from: 6, result: 'goal' }
    m.restart = { type: 'fk', ti: 0, taker: 6, x: 10, y: 0, t: 0 }
    m.setPiece = { type: 'fk', taker: 6, until: 4 }
    const inc = incoming(m, 6)
    expect(m.ball.owner).toBe(inc.pid)
    expect(m.restart.taker).toBe(inc.pid)
    expect(m.setPiece.taker).toBe(inc.pid)
    expect(m.ball.lastTouch).toBe(6)
    expect(m.ball.meta.from).toBe(6)
  })
})

describe('anti-stall claims honor the same protection as normal claims', () => {
  it.each([
    ['miss', 6, 0], ['ok', 8, 0], ['icpt', 6, 0], ['out', 6, 0],
    ['ok', 6, 1], ['goal', 6, 0], ['save', 6, 0],
  ] as const)('cannot claim protected %s with pid %i and noClaim %i at 2.1 seconds', (result, pid, noClaim) => {
    const { m } = setup()
    const p = place(m, pid, 10, 0)
    p.noClaim = noClaim
    loose(m, { type: result === 'goal' || result === 'save' ? 'shot' : 'pass', from: 3, intended: 6, icpt: 8, result })
    internal(m).resolvePossession()
    expect(m.ball.owner).toBe(-1)
    expect(m.teams[0].stats.passesOk).toBe(0)
  })

  it.each(['ok', 'icpt'] as const)('allows only the chosen %s claimant in the fallback range', result => {
    const { m } = setup()
    const pid = result === 'ok' ? 6 : 8
    place(m, pid, 12.5, 0) // Outside normal reach but within 3.2m fallback.
    place(m, result === 'ok' ? 8 : 6, 10, 0)
    loose(m, { type: 'pass', from: 3, intended: 6, icpt: 8, result })
    internal(m).resolvePossession()
    expect(m.ball.owner).toBe(pid)
  })

  it('releases the temporary miss protection after three seconds to prevent stuck balls', () => {
    const { m } = setup()
    place(m, 6, 10, 0)
    loose(m, { type: 'pass', from: 3, intended: 6, result: 'miss' }, 3.1)
    internal(m).resolvePossession()
    expect(m.ball.owner).toBe(6)
  })
})

describe('a declared miss must visibly miss the goal frame', () => {
  const cases = [0, 16, 22, 28, 29.4, 29.9, 30].flatMap(x =>
    [-19, 0, 19].flatMap(y =>
      [false, true].flatMap(header =>
        [0.25, 0.75].flatMap(roll =>
          [1, -1].map(dir => ({ x, y, header, roll, dir })),
        ),
      ),
    ),
  )
  it.each(cases)('miss at x=$x, y=$y, header=$header, RNG=$roll, direction=$dir crosses outside the frame', ({ x, y, header, roll, dir }) => {
    const { m } = setup()
    m.teams[0].dir = dir as 1 | -1; m.teams[1].dir = -dir as 1 | -1
    const shooter = place(m, 6, x * dir, y)
    shooter.ab.shooting = 1
    m.ball.owner = shooter.pid
    m.rng.float = () => roll
    internal(m).execShot(shooter, 0, { header, penalty: false, freeKick: false })
    expect([m.ball.x, m.ball.y, m.ball.z, m.ball.vx, m.ball.vy, m.ball.vz].every(Number.isFinite)).toBe(true)
    let crossed = false
    for (let i = 0; i < 1_000; i++) {
      internal(m).updateBall(m.spec.DT)
      if (m.ball.x * dir > m.spec.HL - 0.1) {
        crossed = true
        expect(Math.abs(m.ball.y) > m.spec.GOAL_HALF || m.ball.z >= m.spec.GOAL_H).toBe(true)
        internal(m).checkRules()
        break
      }
    }
    expect(crossed).toBe(true)
    expect(m.teams[0].stats.shotsOn).toBe(0)
    expect(m.teams[0].score).toBe(0)
    expect(m.events.filter(e => e.type === 'goal')).toHaveLength(0)
  })
})
