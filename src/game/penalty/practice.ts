// Training & challenge set-piece simulation. Metres, seconds since contact; +z points toward the spot.
import { environmentPhysics, isStandardEnvironment, type PitchEnvironment } from './environment.ts'

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
export function band(k: Kick, a: Ability, env?: PitchEnvironment) {
  const center = KICKS[k].sweet + (k === 'drive' ? 0.05 * a.strength : 0)
  let green = (0.045 + 0.085 * a.shooting) * (k === 'drive' ? 0.78 : 1)
  let cycle = 1.45 + 1.2 * a.composure
  if (env && !isStandardEnvironment(env)) {
    const ep = environmentPhysics(env)
    if (k === 'drive') green *= ep.driveGreenScale
    if (k === 'chip') green *= ep.chipGreenScale
    cycle *= ep.cycleScale + (1 - ep.cycleScale) * 0.45 * a.composure
  }
  return { center, green, yellow: 0.045 + 0.04 * a.shooting, cycle }
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
export function makeShot(
  k: Kick,
  outside: boolean,
  aim: Point,
  power: number,
  a: Ability,
  seed: number,
  env?: PitchEnvironment,
): Shot {
  const b = band(k, a, env),
    p = clamp(power),
    delta = p - b.center,
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

  // Realistic power consequences:
  // - '合适': crisp speed & pinpoint placement
  // - '稍轻' / '欠力': sluggish ground-collapsing scuff that loses corner angle (easy prey for GK)
  // - '稍重' / '过力': rising & scattering blast; '过力' skies over the bar or smashes woodwork
  let speedScale = 1
  let targetX = aim.x
  let targetY = aim.y
  let arc = KICKS[k].arc

  if (delta < 0 && excess > 0) {
    if (zone === '稍轻') {
      const u = excess / Math.max(0.02, b.yellow)
      speedScale = 0.84 - 0.16 * u
      targetX = aim.x * (1 - 0.18 * u) + signed * excess * 2.4
      targetY = Math.max(R, aim.y * (1 - 0.25 * u) - 1.5 * excess)
      arc *= 1 - 0.2 * u
    } else {
      const underSpan = Math.max(0.12, b.center - b.green - b.yellow)
      const underRed = clamp((excess - b.yellow) / underSpan)
      speedScale = 0.56 - 0.28 * underRed
      // Weak scuffed kick loses corner placement and collapses onto the grass
      targetX = aim.x * (0.62 - 0.36 * underRed) + signed * (0.28 + 0.55 * underRed)
      targetY = Math.max(R, aim.y * (0.38 - 0.3 * underRed))
      arc *= 0.28 * (1 - 0.6 * underRed)
    }
  } else if (delta > 0 && excess > 0) {
    if (zone === '稍重') {
      const u = excess / Math.max(0.02, b.yellow)
      speedScale = 1.04 + 0.14 * u
      targetX = aim.x + signed * excess * 6.4
      targetY = aim.y + excess * 9.6
    } else {
      const overSpan = Math.max(0.04, 1 - (b.center + b.green + b.yellow))
      const overRed = clamp((excess - b.yellow) / overSpan)
      speedScale = 1.18 + 0.26 * overRed
      targetX = aim.x + signed * (excess * 7.5 + overRed * 1.45)
      // Over-hit penalties sky dramatically above the 2.44m crossbar even if aimed low
      targetY = aim.y + excess * 8.5 + 1.52 + 1.95 * overRed
      arc *= 1.18 + 0.25 * overRed
    }
  }

  let speed = KICKS[k].speed * (0.77 + 0.4 * a.strength) * speedScale
  let curve = outside && k === 'snap' ? -0.65 * (zone === '欠力' ? 0.35 : 1) : 0
  if (env && !isStandardEnvironment(env)) {
    const ep = environmentPhysics(env)
    // Low skimming shots interact with surface (snow accelerates skids; mud/sand bog down grounders)
    const isLow = targetY <= 0.48 && k !== 'chip'
    if (isLow) {
      speed *= ep.groundSpeedScale
      if (env.surface === 'snow') arc *= 0.65
      if (env.surface === 'mud' || env.surface === 'sand') arc *= 0.8
    }
    // Muddy slip increases vertical scatter on overhit power drives
    if (env.surface === 'mud' && k === 'drive' && delta > b.green) {
      targetY += excess * 2.1
    }
    // Longitudinal wind: tailwind (-windZ) boosts flight speed & slight lift; headwind (+windZ) slows & presses down
    const loftFactor = k === 'chip' ? 1.38 : 0.85 + arc * 0.45
    speed = Math.max(5.5, speed - ep.windZ * 0.24 * loftFactor)
    const flightTime = SPOT / speed
    // Lateral wind drift = 0.5 * a_wind * t^2; exact parabolic curve shift -driftX/4 keeps ballAt & netImpact continuous
    const driftX = 0.21 * ep.windX * loftFactor * flightTime * flightTime
    const driftY = -0.045 * ep.windZ * loftFactor * flightTime * flightTime
    targetX += driftX
    targetY = Math.max(R, targetY + driftY)
    curve -= driftX * 0.25
    return { target: { x: targetX, y: targetY }, time: flightTime, arc, curve, zone }
  }
  return {
    target: { x: targetX, y: targetY },
    time: SPOT / speed,
    arc,
    curve,
    zone,
  }
}
export function ballAt(s: Shot, t: number) {
  const u = clamp(t / s.time),
    hump = 4 * u * (1 - u)
  return { x: s.target.x * u + s.curve * hump, y: R + (s.target.y - R) * u + s.arc * hump, z: SPOT * (1 - u) }
}
export type Dive = { at: number; dir: Point; maxReach?: number; target?: Point }
// Keeper camera faces +z: screen-right is world-left. Angle, not drag distance, matters.
export function fromKeeperPad(right: number, up: number): Point {
  const length = Math.hypot(right, up) || 1
  return { x: -right / length, y: up / length }
}
export function keeperAt(dive: Dive | null, a: Ability, t: number, env?: PitchEnvironment) {
  const accelScale = env && !isStandardEnvironment(env) ? environmentPhysics(env).keeperAccelScale : 1
  const rawReach = dive
    ? Math.max(0, (t - dive.at - (0.19 - 0.13 * a.reflexes)) * (4.3 + 2.8 * a.acceleration) * accelScale)
    : 0
  if (dive?.target) {
    const goalX = clamp(dive.target.x, -2.85, 2.85)
    const goalY = clamp(dive.target.y, 0.24, 2.24)
    const dist = Math.hypot(goalX, goalY - 1.06)
    const u = dist < 1e-4 ? (t >= dive.at ? 1 : 0) : clamp(rawReach / dist, 0, 1)
    const x = goalX * u
    const y = 1.06 + (goalY - 1.06) * u
    const handY = 1.21 + (clamp(dive.target.y, R, 2.34) - 1.21) * u
    const spread = 0.41 * (1 - 0.68 * u)
    return {
      body: { x, y },
      left: { x: x - spread, y: handY },
      right: { x: x + spread, y: handY },
    }
  }
  const dir = dive?.dir ?? { x: 0, y: 0 }
  const reach = clamp(rawReach, 0, dive?.maxReach ?? 2.95)
  const lowDive = dir.y < -0.15 ? dir.y : 0
  const x = dir.x * reach,
    y = clamp(1.06 + dir.y * reach, lowDive < 0 ? 0.24 : 0.32, 2.2),
    handOffset = 0.15 + 0.28 * lowDive
  return { body: { x, y }, left: { x: x - 0.41, y: y + handOffset }, right: { x: x + 0.41, y: y + handOffset } }
}

export function planPenaltyKeeperDive(
  s: Shot,
  kick: Kick,
  goalie: Ability,
  rnd: () => number,
  env?: PitchEnvironment,
  keeperBias?: 'left' | 'right' | 'early' | 'mixed',
): Dive | null {
  const atGlove = s.time * (1 - GLOVE_Z / SPOT)
  const ballGlove = ballAt(s, atGlove)
  const mkTargetDive = (at: number, tx: number, ty: number): Dive => {
    const dx = tx
    const dy = ty - 1.06
    const len = Math.hypot(dx, dy) || 1
    return { at, dir: { x: dx / len, y: dy / len }, target: { x: tx, y: ty } }
  }

  // 1. Slow / under-powered scuffed shots: keeper watches the ball off the boot, steps over & scoops it cleanly!
  if (s.zone === '欠力' || (s.time >= 0.78 && kick !== 'chip')) {
    const reactDelay = 0.06 + (1 - goalie.reflexes) * 0.09
    return mkTargetDive(reactDelay, ballGlove.x, ballGlove.y)
  }

  // 2. Stage-specific keeper habits (for puzzle challenges on real-paced shots)
  if (keeperBias === 'left') {
    return mkTargetDive(-0.06, 2.35, 0.85 + rnd() * 0.45)
  }
  if (keeperBias === 'right') {
    return mkTargetDive(-0.06, -2.35, 0.85 + rnd() * 0.45)
  }
  if (keeperBias === 'early') {
    const side = rnd() < 0.5 ? -1 : 1
    return mkTargetDive(-0.14, side * 2.4, 0.9 + rnd() * 0.4)
  }

  // 3. Panenka / chip: if under-hit or if keeper holds central, keeper plucks it easily; if keeper commits early to a corner, chip scores!
  if (kick === 'chip') {
    const holdChance = (s.zone === '稍轻' ? 0.82 : 0.42) + 0.2 * goalie.reflexes
    if (rnd() < holdChance) {
      return mkTargetDive(0.12 + (1 - goalie.reflexes) * 0.08, ballGlove.x, ballGlove.y)
    }
    const wrongSide = Math.abs(ballGlove.x) > 0.6 ? -Math.sign(ballGlove.x) : rnd() < 0.5 ? -1 : 1
    return mkTargetDive(-0.05, wrongSide * 2.35, 0.75)
  }

  // 4. Slightly weak ('稍轻'): slower pace lets the keeper read & adjust after contact most of the time
  if (s.zone === '稍轻') {
    if (rnd() < 0.76 + 0.18 * goalie.reflexes) {
      return mkTargetDive(0.03 + (1 - goalie.reflexes) * 0.06, ballGlove.x, ballGlove.y)
    }
  }

  // 5. Central / near-body shots even with good power: keeper stands strong and tracks the ball
  if (Math.abs(ballGlove.x) < 0.92) {
    if (rnd() < 0.7 + 0.2 * goalie.reflexes) {
      return mkTargetDive(0.01 + (1 - goalie.reflexes) * 0.06, ballGlove.x, ballGlove.y)
    }
  }

  // 6. Full-speed corner duel: keeper reads striker's hips ~58-72% of the time; well-placed Green corner shots still beat his reach!
  const readProb = 0.48 + 0.24 * goalie.reflexes
  if (rnd() < readProb) {
    const startAt = -0.04 + (1 - goalie.reflexes) * 0.1 + rnd() * 0.06
    return mkTargetDive(startAt, ballGlove.x, ballGlove.y)
  }
  const wrongX = -(Math.sign(ballGlove.x) || (rnd() < 0.5 ? 1 : -1)) * (1.95 + rnd() * 0.65)
  return mkTargetDive(-0.05 + rnd() * 0.1, wrongX, 0.65 + rnd() * 0.85)
}

/** Visual post-outcome goalkeeper landing & recovery so the keeper never freezes in mid-air. */
export function postKeeperPose(
  dive: Dive | null,
  a: Ability,
  stopAt: number,
  afterSec: number,
  caught: boolean,
  env?: PitchEnvironment,
): ReturnType<typeof keeperAt> & { landed: number } {
  const peak = keeperAt(dive, a, stopAt, env)
  if (afterSec <= 0) return { ...peak, landed: 0 }

  const dived = Boolean(dive) && (Math.abs(peak.body.x) > 0.2 || Math.abs(peak.body.y - 1.06) > 0.22)
  if (dived) {
    const dropDur = clamp(0.28 + Math.max(0, peak.body.y - 0.26) * 0.22, 0.28, 0.58)
    const uDrop = clamp(afterSec / dropDur)
    const slideSign = Math.sign(peak.body.x || dive!.dir.x || 1)
    const slide = (1 - Math.exp(-3.4 * afterSec)) * 0.28 * slideSign
    const bx = clamp(peak.body.x + slide, -HALF + 0.35, HALF - 0.35)
    const bounce =
      afterSec > dropDur && afterSec - dropDur < 0.22
        ? Math.sin(((afterSec - dropDur) / 0.22) * Math.PI) * 0.038
        : 0
    const by = uDrop < 1 ? peak.body.y + (0.26 - peak.body.y) * (uDrop * uDrop) : 0.26 + bounce

    if (caught) {
      const tuck = clamp(afterSec / 0.26)
      const cx = bx + slideSign * 0.2
      const cy = Math.max(R + 0.04, by + 0.05)
      return {
        body: { x: bx, y: by },
        left: { x: peak.left.x + (cx - 0.11 - peak.left.x) * tuck, y: Math.max(R, peak.left.y + (cy - peak.left.y) * tuck) },
        right: { x: peak.right.x + (cx + 0.11 - peak.right.x) * tuck, y: Math.max(R, peak.right.y + (cy - peak.right.y) * tuck) },
        landed: uDrop,
      }
    }
    const armSettle = clamp(afterSec / (dropDur + 0.22))
    const groundHandX = bx + slideSign * 0.46
    return {
      body: { x: bx, y: by },
      left: {
        x: peak.left.x + (groundHandX - 0.18 - peak.left.x) * armSettle,
        y: Math.max(0.13, peak.left.y + (by - 0.04 - peak.left.y) * (uDrop * uDrop)),
      },
      right: {
        x: peak.right.x + (groundHandX + 0.18 - peak.right.x) * armSettle,
        y: Math.max(0.13, peak.right.y + (by + 0.08 - peak.right.y) * (uDrop * uDrop)),
      },
      landed: uDrop,
    }
  }

  // Standing / near-central goalkeeper recovery
  const relax = clamp(afterSec / 0.42)
  const bx = peak.body.x * (1 - 0.22 * relax)
  const by = peak.body.y + (1.06 - peak.body.y) * relax
  if (caught) {
    const tuck = clamp(afterSec / 0.24)
    return {
      body: { x: bx, y: by },
      left: { x: peak.left.x + (bx - 0.12 - peak.left.x) * tuck, y: peak.left.y + (1.02 - peak.left.y) * tuck },
      right: { x: peak.right.x + (bx + 0.12 - peak.right.x) * tuck, y: peak.right.y + (1.02 - peak.right.y) * tuck },
      landed: 0,
    }
  }
  return {
    body: { x: bx, y: by },
    left: { x: peak.left.x + (bx - 0.34 - peak.left.x) * relax, y: peak.left.y + (0.95 - peak.left.y) * relax },
    right: { x: peak.right.x + (bx + 0.34 - peak.right.x) * relax, y: peak.right.y + (0.95 - peak.right.y) * relax },
    landed: 0,
  }
}
export type Result = '进球' | '偏出' | '击中门框' | '抱住' | '挡出' | '碰到仍进'
export interface ResolveOptions {
  keeperless?: boolean
  env?: PitchEnvironment
}
// Sample exact event times (rather than rendered frames): reach goalkeeper plane before goal plane.
export function resolve(
  s: Shot,
  dive: Dive | null,
  a: Ability,
  options?: ResolveOptions,
): { result: Result; at: number } {
  const edge = Math.min(HALF - Math.abs(s.target.x), HEIGHT - s.target.y)
  if (options?.keeperless) {
    return {
      result: edge < -R - 0.08 ? '偏出' : edge <= R ? '击中门框' : '进球',
      at: s.time,
    }
  }
  const env = options?.env
  const wetPenalty = env && !isStandardEnvironment(env) ? environmentPhysics(env).wetGlovePenalty : 0
  const effHandling = clamp(a.handling - wetPenalty)
  const at = s.time * (1 - GLOVE_Z / SPOT),
    ball = ballAt(s, at),
    pose = keeperAt(dive, a, at, env)
  const gap = (p: Point) => Math.hypot(p.x - ball.x, p.y - ball.y)
  const hand = Math.min(gap(pose.left), gap(pose.right))
  const bodyHit = Math.hypot((pose.body.x - ball.x) / 0.35, (pose.body.y - ball.y) / 0.77) <= 1
  if (bodyHit || hand <= 0.19 + 0.15 * effHandling)
    return { result: hand < 0.13 + 0.11 * effHandling && wetPenalty < 0.2 ? '抱住' : hand < 0.10 + 0.10 * effHandling ? '抱住' : '挡出', at }
  return {
    result: edge < -R - 0.08 ? '偏出' : edge <= R ? '击中门框' : hand <= 0.34 ? '碰到仍进' : '进球',
    at: s.time,
  }
}
