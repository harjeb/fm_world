import { describe, expect, it, vi } from 'vitest'
import { baselineTeams } from './baseline.ts'
import type { PassKind, PassVerdict } from './contact.ts'
import { PesGame } from './game.ts'

function setup() {
  const teams = baselineTeams(1)
  const g = new PesGame({ seed: 3, home: teams.home, away: teams.away })
  const m = g.match
  const place = (pid: number, x: number, y: number) => {
    const q = m.players[pid]
    q.pos = { x, y }
    q.target = { x, y }
    q.vel = { x: 0, y: 0 }
    return q
  }
  const passer = place(m.teams[0].players[3].pid, 0, 0)
  const receiver = place(m.teams[0].players[6].pid, 10, 0)
  for (const q of m.teams[1].players) place(q.pid, -25, -15)
  const interceptor = place(m.teams[1].players[1].pid, 5, 0)
  return { g, m, passer, receiver, interceptor, kernel: g.settlement.settlementKernel }
}

const kinds: PassKind[] = ['short', 'long', 'through', 'cross']
const boundaries: [number, PassVerdict['result']][] = [
  [0, 'ok'],
  [0.5 - Number.EPSILON, 'ok'],
  [0.5, 'icpt'],
  [0.75 - Number.EPSILON, 'icpt'],
  [0.75, 'out'],
  [0.875 - Number.EPSILON, 'out'],
  [0.875, 'miss'],
  [0.99999, 'miss'],
]

describe.each(kinds)('pass outcome intervals (%s)', (kind) => {
  it.each(boundaries)('roll %s selects %s, not merely an available interceptor', (roll, result) => {
    const { g, m, passer, receiver, interceptor, kernel } = setup()
    const passModel = kernel.passModel.bind(kernel)
    vi.spyOn(kernel, 'passModel').mockImplementation((...args) => ({
      ...passModel(...args), interceptor: g.settlement.gamePlayer(interceptor.pid),
    }))
    // Binary fractions make all three cutoffs exact, with a nonzero loose interval.
    vi.spyOn(kernel, 'passOdds').mockReturnValue({ p: 0.5, intercepted: 0.25, out: 0.125, loose: 0.125, deviation: 0 })
    const random = vi.spyOn(m.rng, 'float').mockReturnValue(roll)

    expect(g.settlement.pass(m, passer, receiver, receiver.pos, kind)).toEqual({
      result, interceptor: result === 'icpt' ? interceptor.pid : -1, p: 0.5,
    })
    expect(random).toHaveBeenCalledTimes(1)
  })
})

describe('pass outcome without an interceptor', () => {
  it.each(boundaries)('roll %s preserves the sampled interval with a missing interceptor', (roll, sampled) => {
    const { g, m, passer, receiver, kernel } = setup()
    const passModel = kernel.passModel.bind(kernel)
    vi.spyOn(kernel, 'passModel').mockImplementation((...args) => ({ ...passModel(...args), interceptor: null }))
    // Defensive fallback: unavailable interception becomes a loose ball, not out.
    vi.spyOn(kernel, 'passOdds').mockReturnValue({ p: 0.5, intercepted: 0.25, out: 0.125, loose: 0.125, deviation: 0 })
    vi.spyOn(m.rng, 'float').mockReturnValue(roll)

    expect(g.settlement.pass(m, passer, receiver, receiver.pos, 'short')).toEqual({
      result: sampled === 'icpt' ? 'miss' : sampled, interceptor: -1, p: 0.5,
    })
  })

  it.each<[number, PassVerdict['result']]>([
    [0.5 - Number.EPSILON, 'ok'],
    [0.5, 'out'],
    [0.625 - Number.EPSILON, 'out'],
    [0.625, 'miss'],
    [0.99999, 'miss'],
  ])('zero interception probability: roll %s selects %s', (roll, result) => {
    const { g, m, passer, receiver, kernel } = setup()
    const passModel = kernel.passModel.bind(kernel)
    vi.spyOn(kernel, 'passModel').mockImplementation((...args) => ({ ...passModel(...args), interceptor: null }))
    vi.spyOn(kernel, 'passOdds').mockReturnValue({ p: 0.5, intercepted: 0, out: 0.125, loose: 0.375, deviation: 0 })
    vi.spyOn(m.rng, 'float').mockReturnValue(roll)

    expect(g.settlement.pass(m, passer, receiver, receiver.pos, 'short')).toEqual({ result, interceptor: -1, p: 0.5 })
  })
})

it('real kernel: roll .99999 remains out with a defender on the pass lane', () => {
  const { g, m, passer, receiver, interceptor, kernel } = setup()
  const modelSpy = vi.spyOn(kernel, 'passModel')
  const oddsSpy = vi.spyOn(kernel, 'passOdds')
  vi.spyOn(m.rng, 'float').mockReturnValue(0.99999)

  const verdict = g.settlement.pass(m, passer, receiver, receiver.pos, 'short')
  const model = modelSpy.mock.results[0].value!
  const odds = oddsSpy.mock.results[0].value!
  expect(model.interceptor?.id).toBe(g.settlement.gamePlayer(interceptor.pid).id)
  expect(odds.out).toBeGreaterThan(0)
  expect(0.99999).toBeGreaterThan(odds.p + odds.intercepted)
  expect(0.99999).toBeLessThan(odds.p + odds.intercepted + odds.out)
  expect(verdict).toEqual({ result: 'out', interceptor: -1, p: odds.p })
})
