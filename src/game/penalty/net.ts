import { clamp, HALF, HEIGHT, R, SPOT, type Result, type Shot } from './practice.ts'

// Presentation only. The simulation settles the result at the goal line, never on the animated net.
export const NET_DEPTH = 1.48,
  SETTLE = 1.18,
  POST_DURATION = 1.75
export type Vec3 = { x: number; y: number; z: number }
export type Impact = { point: Vec3; normal: Vec3; speed: number; delay: number }
export function netImpact(s: Shot, result: Result): Impact | null {
  if (result !== '进球' && result !== '碰到仍进') return null
  const vx = (s.target.x - 4 * s.curve) / s.time,
    vy = (s.target.y - R - 4 * s.arc) / s.time,
    vz = -SPOT / s.time
  let delay = (NET_DEPTH - R) / -vz,
    normal = { x: 0, y: 0, z: -1 }
  if (Math.abs(vx) > 1e-6) {
    const side = (Math.sign(vx) * (HALF - R) - s.target.x) / vx
    if (side >= 0 && side < delay) {
      delay = side
      normal = { x: Math.sign(vx), y: 0, z: 0 }
    }
  }
  if (vy > 0) {
    const roof = (HEIGHT - R - s.target.y) / vy
    if (roof >= 0 && roof < delay) {
      delay = roof
      normal = { x: 0, y: 1, z: 0 }
    }
  }
  const center = { x: s.target.x + vx * delay, y: Math.max(R, s.target.y + vy * delay), z: vz * delay }
  return {
    point: { x: center.x + normal.x * R, y: center.y + normal.y * R, z: center.z + normal.z * R },
    normal,
    speed: Math.hypot(vx, vy, vz),
    delay,
  }
}
export function impulse(speed: number) {
  return clamp(speed * 0.021, 0.19, 0.65)
}
export function ripple(distance: number, time: number, speed: number) {
  const local = time - distance / 6.7
  if (local <= 0 || time >= SETTLE) return 0
  return (
    impulse(speed) * Math.exp(-2.1 * distance - 5.6 * local) * Math.sin(local * 21) * clamp((SETTLE - time) * 8)
  )
}
export function finishBall(s: Shot, hit: Impact, elapsed: number): Vec3 {
  const { point: p, normal: n } = hit,
    contact = { x: p.x - n.x * R, y: p.y - n.y * R, z: p.z - n.z * R }
  if (elapsed <= 0) return { ...s.target, z: 0 }
  const u = clamp(elapsed / hit.delay)
  if (u < 1)
    return {
      x: s.target.x + (contact.x - s.target.x) * u,
      y: s.target.y + (contact.y - s.target.y) * u,
      z: contact.z * u,
    }
  const t = elapsed - hit.delay,
    k = ripple(0, t, hit.speed),
    release = clamp((t - 0.085) / 0.4)
  const dropHeight = Math.max(0, contact.y - R)
  const tGround = Math.sqrt(dropHeight / 4.9)
  let yBall: number
  if (t <= tGround) {
    yBall = Math.max(R, contact.y + n.y * k * (1 - release) - 4.9 * t * t)
  } else {
    const tb = t - tGround
    const bounceDur = clamp(0.18 + dropHeight * 0.11, 0.16, 0.42)
    // Damped single grass bounce inside the net that settles cleanly to R well before elapsed = 2s
    const bounce = tb < bounceDur ? Math.sin((tb / bounceDur) * Math.PI) * Math.min(0.28, dropHeight * 0.24) : 0
    yBall = R + bounce
  }
  const roll = clamp((t - tGround) / 0.85) * 0.26
  const rawX = contact.x + n.x * (k * (1 - release) - (0.19 + roll * 0.4) * release)
  const rawZ = contact.z + n.z * (k * (1 - release) - (0.19 + roll) * release)
  return {
    x: release >= 1 ? clamp(rawX, -HALF + R + 0.02, HALF - R - 0.02) : rawX,
    y: yBall,
    z: Math.min(-R * 0.4, rawZ),
  }
}

/** Smooth ballistic bounce & turf roll for non-goal outcomes (parry, wall block, woodwork ricochet, miss, catch). */
export function settleNonGoalBall(
  origin: Vec3,
  vel: Vec3,
  kind: 'catch' | 'parry' | 'wall' | 'frame' | 'miss',
  afterSec: number,
  glovesMid?: Vec3,
): Vec3 {
  if (afterSec <= 0) return origin
  if (kind === 'catch' && glovesMid) {
    const blend = clamp(afterSec / 0.12)
    if (blend >= 1) return { x: glovesMid.x, y: Math.max(R, glovesMid.y), z: glovesMid.z }
    return {
      x: origin.x + (glovesMid.x - origin.x) * blend,
      y: Math.max(R, origin.y + (glovesMid.y - origin.y) * blend),
      z: origin.z + (glovesMid.z - origin.z) * blend,
    }
  }
  let rx = vel.x,
    ry = vel.y,
    rz = vel.z
  if (kind === 'parry') {
    const side = Math.sign(origin.x) || 1
    rx = side * (4.4 + Math.abs(vel.x) * 0.32)
    ry = Math.max(1.6, vel.y * 0.35 + 1.8)
    rz = 2.8
  } else if (kind === 'wall') {
    const side = Math.sign(origin.x) || -1
    rx = side * 3.1 + vel.x * 0.25
    ry = 2.4
    rz = 5.4
  } else if (kind === 'frame') {
    const hitTop = origin.y >= HEIGHT - R * 2.2
    const side = Math.sign(origin.x) || 1
    rx = hitTop ? vel.x * 0.55 : side * (4.6 + Math.abs(vel.x) * 0.25)
    ry = hitTop ? 3.1 : Math.max(0.8, vel.y * 0.35)
    rz = 6.1
  }

  // Integrate damped projectile with up to 2 turf bounces + rolling drag
  const dt = Math.min(afterSec, 2.4)
  const drag = (1 - Math.exp(-0.85 * dt)) / 0.85
  const x = origin.x + rx * drag
  const z = clamp(origin.z + rz * drag, -6.2, 28)

  let y = origin.y
  let vy = ry
  let rem = dt
  const g = 9.81
  for (let b = 0; b < 3 && rem > 1e-4; b++) {
    // Solve y + vy*t - 0.5*g*t^2 = R
    const h0 = Math.max(0, y - R)
    const disc = vy * vy + 2 * g * h0
    const tHit = (vy + Math.sqrt(disc)) / g
    if (rem <= tHit) {
      y = Math.max(R, y + vy * rem - 0.5 * g * rem * rem)
      rem = 0
      break
    }
    rem -= tHit
    const vImpact = Math.abs(vy - g * tHit)
    y = R
    vy = vImpact * 0.48
    if (vy < 0.45) {
      y = R
      break
    }
  }
  return { x, y: Math.max(R, y), z }
}
