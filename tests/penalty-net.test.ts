import { describe, expect, it } from 'vitest'
import { finishBall, netImpact, NET_DEPTH, ripple, SETTLE, settleNonGoalBall } from '../src/game/penalty/net.ts'
import { HALF, HEIGHT, R, type Result, type Shot } from '../src/game/penalty/practice.ts'
const shot: Shot = { target: { x: 0.4, y: 1.1 }, time: 0.58, zone: '合适', arc: 0.24, curve: 0 }
describe('post-goal presentation', () => {
  it.each(['抱住', '挡出', '偏出', '击中门框'] as Result[])('no goal ripple on %s', (r) =>
    expect(netImpact(shot, r)).toBeNull(),
  )
  it.each(['碰到仍进', '进球'] as Result[])('continues %s to contact before deforming the rear net', (r) => {
    const hit = netImpact(shot, r)!
    expect(hit.point.z).toBeCloseTo(-NET_DEPTH)
    expect(hit.delay).toBeGreaterThan(0)
    expect(finishBall(shot, hit, 0)).toEqual({ ...shot.target, z: 0 })
    expect(finishBall(shot, hit, hit.delay).z).toBeCloseTo(-NET_DEPTH + R)
    expect(finishBall(shot, hit, hit.delay + 0.055).z).toBeLessThan(-NET_DEPTH)
    expect(finishBall(shot, hit, 2).y).toBe(R)
  })
  it('hits the first panel (side/roof) rather than the back behind it', () => {
    const side = netImpact({ ...shot, target: { x: HALF - 0.12, y: 1 } }, '进球')!,
      roof = netImpact({ ...shot, target: { x: 1, y: HEIGHT - 0.12 }, arc: 0 }, '进球')!
    expect(side.normal.x).toBe(1)
    expect(side.point.x).toBeCloseTo(HALF)
    expect(roof.normal.y).toBe(1)
    expect(roof.point.y).toBeCloseTo(HEIGHT)
  })
  it('propagates outwards from the impact, with speed-dependent amplitude and a finite tail', () => {
    expect(ripple(0, 0, 20)).toBe(0)
    expect(ripple(1, 0.08, 20)).toBe(0)
    expect(ripple(0, 0.06, 28)).toBeGreaterThan(ripple(0, 0.06, 14))
    expect(ripple(0, 0.21, 20)).toBeLessThan(0)
    expect(ripple(0, SETTLE, 20)).toBe(0)
  })
  it('settles non-goal rebounds onto the turf and locks catches into the gloves', () => {
    const caught = settleNonGoalBall({ x: 1.2, y: 1.1, z: 0.55 }, { x: 2, y: 0, z: -18 }, 'catch', 0.4, {
      x: 1.35,
      y: 0.3,
      z: 0.58,
    })
    expect(caught).toEqual({ x: 1.35, y: 0.3, z: 0.58 })
    const parried = settleNonGoalBall({ x: 1.4, y: 1.3, z: 0.55 }, { x: 3, y: 1, z: -20 }, 'parry', 2.0)
    expect(parried.y).toBe(R)
    expect(parried.x).toBeGreaterThan(1.4)
  })
})
