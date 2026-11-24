// Training-only simulation. Metres, seconds since contact; +z points toward the spot.
export const HALF = 3.66,
  HEIGHT = 2.44,
  R = 0.11,
  SPOT = 11,
  GLOVE_Z = 0.55
export const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n))
export type Point = { x: number; y: number }
export type Ability = {
  shooting: number
  strength: number
  composure: number
  reflexes: number
  acceleration: number
  handling: number
} // normalized 0..1
export const STANDARD: Ability = {
  shooting: 0.55,
  strength: 0.55,
  composure: 0.55,
  reflexes: 0.55,
  acceleration: 0.55,
  handling: 0.55,
}
export const KICKS = {
  push: { label: '推射', feet: ['脚内侧'], sweet: 0.74, speed: 20, arc: 0.24 },
  drive: { label: '大力射门', feet: ['正脚背'], sweet: 0.81, speed: 29, arc: 0.35 },
  snap: { label: '抽射', feet: ['正脚背', '外脚背'], sweet: 0.78, speed: 25, arc: 0.15 },
  chip: { label: '勺子点球', feet: ['脚尖'], sweet: 0.62, speed: 14, arc: 1.28 },
} as const
export type Kick = keyof typeof KICKS
export function band(k: Kick, a: Ability) {
  const center = KICKS[k].sweet + (k === 'drive' ? 0.05 * a.strength : 0)
  const green = (0.045 + 0.085 * a.shooting) * (k === 'drive' ? 0.78 : 1)
  return { center, green, yellow: 0.045 + 0.04 * a.shooting, cycle: 1.45 + 1.2 * a.composure }
}
export function meter(seconds: number, cycle: number) {
  return 1 - Math.abs(1 - (2 * (seconds % cycle)) / cycle)
}
export type Zone = '欠力' | '稍轻' | '合适' | '稍重' | '过力'
export interface Shot {
  target: Point
  time: number
  arc: number
  curve: number
  zone: Zone
}
export function makeShot(k: Kick, outside: boolean, aim: Point, power: number, a: Ability, seed: number): Shot {
  const b = band(k, a),
    delta = clamp(power) - b.center,
    excess = Math.max(0, Math.abs(delta) - b.green)
  const signed = (((Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0xffffffff) * 2 - 1
  const zone: Zone = !excess
    ? '合适'
    : delta < 0
      ? excess <= b.yellow
        ? '稍轻'
        : '欠力'
      : excess <= b.yellow
        ? '稍重'
        : '过力'
  const speed = KICKS[k].speed * (0.77 + 0.4 * a.strength) * clamp(1 + delta * 1.55, 0.32, 1.5)
  return {
    target: { x: aim.x + signed * excess * 4, y: Math.max(R, aim.y + (delta < 0 ? -1.4 : 6.4) * excess) },
    time: SPOT / speed,
    arc: KICKS[k].arc,
    curve: outside && k === 'snap' ? -0.65 : 0,
    zone,
  }
}
export function ballAt(s: Shot, t: number) {
  const u = clamp(t / s.time),
    hump = 4 * u * (1 - u)
  return { x: s.target.x * u + s.curve * hump, y: R + (s.target.y - R) * u + s.arc * hump, z: SPOT * (1 - u) }
}
export type Dive = { at: number; dir: Point }
// Keeper camera faces +z: screen-right is world-left. Angle, not drag distance, matters.
export function fromKeeperPad(right: number, up: number): Point {
  const length = Math.hypot(right, up) || 1
  return { x: -right / length, y: up / length }
}
export function keeperAt(dive: Dive | null, a: Ability, t: number) {
  const dir = dive?.dir ?? { x: 0, y: 0 }
  const reach = dive
    ? clamp((t - dive.at - (0.19 - 0.13 * a.reflexes)) * (4.3 + 2.8 * a.acceleration), 0, 2.95)
    : 0
  const x = dir.x * reach,
    y = clamp(1.06 + dir.y * reach, 0.32, 2.2)
  return { body: { x, y }, left: { x: x - 0.41, y: y + 0.15 }, right: { x: x + 0.41, y: y + 0.15 } }
}
export type Result = '进球' | '偏出' | '击中门框' | '抱住' | '挡出' | '碰到仍进'
// Sample exact event times (rather than rendered frames): reach goalkeeper plane before goal plane.
export function resolve(s: Shot, dive: Dive | null, a: Ability): { result: Result; at: number } {
  const at = s.time * (1 - GLOVE_Z / SPOT),
    ball = ballAt(s, at),
    pose = keeperAt(dive, a, at)
  const gap = (p: Point) => Math.hypot(p.x - ball.x, p.y - ball.y)
  const hand = Math.min(gap(pose.left), gap(pose.right))
  const bodyHit = Math.hypot((pose.body.x - ball.x) / 0.35, (pose.body.y - ball.y) / 0.77) <= 1
  if (bodyHit || hand <= 0.19 + 0.15 * a.handling)
    return { result: hand < 0.13 + 0.11 * a.handling ? '抱住' : '挡出', at }
  const edge = Math.min(HALF - Math.abs(s.target.x), HEIGHT - s.target.y)
  return {
    result: edge < -R - 0.08 ? '偏出' : edge <= R ? '击中门框' : hand <= 0.34 ? '碰到仍进' : '进球',
    at: s.time,
  }
}
