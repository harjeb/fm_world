import { clamp, HALF, HEIGHT, R, SPOT, type Result, type Shot } from './practice.ts'

// Presentation only. The simulation settles the result at the goal line, never on the animated net.
export const NET_DEPTH = 1.48,
  SETTLE = 1.18
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
  return {
    x: contact.x + n.x * (k * (1 - release) - 0.19 * release),
    y: Math.max(R, contact.y + n.y * k * (1 - release) - 4.9 * t * t),
    z: contact.z + n.z * (k * (1 - release) - 0.19 * release),
  }
}
