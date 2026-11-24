import { describe, expect, it } from 'vitest'
import {
  ballAt,
  band,
  fromKeeperPad,
  GLOVE_Z,
  HALF,
  HEIGHT,
  keeperAt,
  makeShot,
  meter,
  R,
  resolve,
  SPOT,
  STANDARD,
  type Shot,
} from '../src/game/penalty/practice.ts'
const a = STANDARD,
  b = band('push', a),
  aim = { x: 2.8, y: 1.8 },
  base = makeShot('push', false, aim, b.center, a, 42)
describe('3D penalty practice', () => {
  it('green hits the intended spot, but excess power can clear the bar', () => {
    expect(base.target).toEqual(aim)
    expect(base.zone).toBe('合适')
    expect(ballAt(base, 0)).toEqual({ x: 0, y: R, z: SPOT })
    expect(ballAt(base, base.time)).toEqual({ ...aim, z: 0 })
    const over = makeShot('push', false, aim, 1, a, 42),
      under = makeShot('push', false, aim, 0, a, 42)
    expect(over.target.y).toBeGreaterThan(HEIGHT)
    expect(over.time).toBeLessThan(base.time)
    expect(under.time).toBeGreaterThan(base.time)
    expect(under.zone).toBe('欠力')
  })
  it('uses visible differences between kicks and players', () => {
    const expert = { ...a, shooting: 1, strength: 1, composure: 1 }
    expect(band('drive', expert).center).toBeGreaterThan(band('drive', a).center)
    expect(band('push', expert).green).toBeGreaterThan(b.green)
    expect(band('push', expert).yellow).toBeGreaterThan(b.yellow)
    expect(band('push', expert).cycle).toBeGreaterThan(b.cycle)
    expect(band('chip', a).center).toBeLessThan(band('push', a).center)
    expect([0, b.cycle / 2, b.cycle].map((t) => meter(t, b.cycle))).toEqual([0, 1, 0])
    const snap = makeShot('snap', true, aim, band('snap', a).center, a, 42),
      straight = { ...snap, curve: 0 }
    expect(ballAt(snap, snap.time / 2).x).toBeLessThan(ballAt(straight, snap.time / 2).x)
  })
  it('maps keeper screen-right/up to world-left/up and ignores swipe length', () => {
    expect(fromKeeperPad(3, 4)).toEqual({ x: -0.6, y: 0.8 })
    expect(fromKeeperPad(6, 8)).toEqual(fromKeeperPad(3, 4))
    const dive = { at: 0, dir: fromKeeperPad(-1, 0) }
    expect(keeperAt(dive, { ...a, reflexes: 1 }, 0.1).body.x).toBeGreaterThan(
      keeperAt(dive, { ...a, reflexes: 0 }, 0.1).body.x,
    )
    expect(keeperAt(dive, { ...a, acceleration: 1 }, 0.3).body.x).toBeGreaterThan(
      keeperAt(dive, { ...a, acceleration: 0 }, 0.3).body.x,
    )
  })
  it('resolves the hand before the line and never rescues a wrong or late dive', () => {
    const s: Shot = { ...base, arc: 0, time: 0.5, target: { x: 3, y: 1.25 } },
      at = s.time * (1 - GLOVE_Z / SPOT),
      dir = fromKeeperPad(-1, 0)
    const t = at - (0.19 - 0.13 * a.reflexes) - (ballAt(s, at).x - 0.41) / (4.3 + 2.8 * a.acceleration)
    expect(resolve(s, { at: t, dir }, a)).toEqual({ result: '抱住', at })
    expect(resolve(s, { at: at + 0.01, dir }, a).result).toBe('进球')
    expect(resolve(s, { at: t, dir: fromKeeperPad(1, 0) }, a).result).toBe('进球')
  })
  it('handling affects a grazing glove, not just direction', () => {
    const u = 1 - GLOVE_Z / SPOT,
      s = { ...base, arc: 0, target: { x: (0.41 + 0.27) / u, y: R + (1.21 - R) / u } }
    expect(resolve(s, null, { ...a, handling: 0 }).result).toBe('碰到仍进')
    expect(resolve(s, null, { ...a, handling: 1 }).result).toBe('挡出')
  })
  it('separates clear, frame and outside shots on both axes', () => {
    for (const [x, y, result] of [
      [HALF - 0.3, 1, '进球'],
      [-HALF, 1, '击中门框'],
      [2, HEIGHT, '击中门框'],
      [2, HEIGHT + 0.5, '偏出'],
    ] as const)
      expect(resolve({ ...base, target: { x, y } }, null, a).result).toBe(result)
  })
  it('replays from inputs without depending on drawing cadence', () => {
    const play = (fps: number) => {
      const s = makeShot('push', false, aim, 0.72, a, 999)
      for (let t = 0; t < s.time; t += 1 / fps) ballAt(s, t)
      return [ballAt(s, s.time), resolve(s, null, a)]
    }
    expect(play(15)).toEqual(play(120))
  })
})
