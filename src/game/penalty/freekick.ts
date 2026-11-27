// Pure-TS 3D Free Kick Lab simulation: wall clearance/under-wall/lie-down, wind & surface physics, and back-post header combinations.
import {
  clamp,
  fromKeeperPad,
  GLOVE_Z,
  HALF,
  HEIGHT,
  keeperAt,
  R,
  type Ability,
  type Dive,
  type Point,
  type Zone,
} from './practice.ts'
import { environmentPhysics, isStandardEnvironment, type PitchEnvironment } from './environment.ts'

export interface FreeKickSpot {
  id: 'arc_center' | 'right_channel' | 'left_channel' | 'far_flank'
  label: string
  x: number
  z: number
  wallCount: number
  /** Default x-center of the defensive wall at z = spot.z - 9.15. */
  wallBaseX: number
  /** Back-post teammate target zone when running set-piece header combinations. */
  headerTarget: { x: number; y: number; z: number }
}

export const FREEKICK_SPOTS: Record<FreeKickSpot['id'], FreeKickSpot> = {
  arc_center: {
    id: 'arc_center',
    label: '弧顶正中 · 20m',
    x: 0,
    z: 20,
    wallCount: 4,
    wallBaseX: -0.95,
    headerTarget: { x: 2.05, y: 1.88, z: 4.8 },
  },
  right_channel: {
    id: 'right_channel',
    label: '右肋偏侧 · 21.5m',
    x: 4.8,
    z: 21.5,
    wallCount: 4,
    wallBaseX: 2.35,
    headerTarget: { x: -1.9, y: 1.9, z: 4.8 },
  },
  left_channel: {
    id: 'left_channel',
    label: '左肋偏侧 · 21.5m',
    x: -4.8,
    z: 21.5,
    wallCount: 4,
    wallBaseX: -2.35,
    headerTarget: { x: 1.9, y: 1.9, z: 4.8 },
  },
  far_flank: {
    id: 'far_flank',
    label: '远端配合位 · 24.5m',
    x: 6.6,
    z: 24.5,
    wallCount: 3,
    wallBaseX: 3.35,
    headerTarget: { x: -1.85, y: 1.95, z: 4.6 },
  },
}

export const FREEKICK_SPOT_LIST: readonly FreeKickSpot[] = Object.values(FREEKICK_SPOTS)

export const FREEKICK_STYLES = {
  curl: { label: '内脚背弧线球', sweet: 0.73, speed: 23.5, arc: 1.58, defaultCurve: 'left_big' },
  knuckle: { label: '正脚背电梯球', sweet: 0.81, speed: 29.0, arc: 1.86, defaultCurve: 'straight' },
  trivela: { label: '外脚背外旋抽射', sweet: 0.78, speed: 26.2, arc: 1.24, defaultCurve: 'right_big' },
  low_drive: { label: '贴地冷射（钻墙底）', sweet: 0.71, speed: 24.2, arc: 0.12, defaultCurve: 'straight' },
  loft_pass: { label: '挑传后点（头球配合）', sweet: 0.67, speed: 18.2, arc: 2.55, defaultCurve: 'left_mid' },
} as const

export type FreeKickStyle = keyof typeof FREEKICK_STYLES

export const CURVE_OPTIONS = {
  left_big: { label: '左旋大弧', bend: -2.35 },
  left_mid: { label: '左旋微弧', bend: -1.15 },
  straight: { label: '直球不加旋', bend: 0 },
  right_mid: { label: '右旋微弧', bend: 1.15 },
  right_big: { label: '右旋大弧', bend: 2.35 },
} as const

export type CurveOption = keyof typeof CURVE_OPTIONS
export type WallAction = 'jump' | 'stand' | 'lie'
export type WallShift = -1 | 0 | 1

export const WALL_ACTIONS: Record<WallAction, string> = {
  jump: '人墙起跳（封高球，露脚底）',
  stand: '人墙站立（稳封低平球）',
  lie: '起跳 + 卧草（上下兼防）',
}

export interface FreeKickAbility extends Ability {
  passing: number
  vision: number
  teammateOffBall: number
  teammateHeading: number
  teammateStrength: number
}

export const STANDARD_FK_ABILITY: FreeKickAbility = {
  shooting: 0.58,
  passing: 0.58,
  strength: 0.56,
  vision: 0.56,
  composure: 0.56,
  reflexes: 0.55,
  acceleration: 0.55,
  handling: 0.55,
  teammateOffBall: 0.58,
  teammateHeading: 0.58,
  teammateStrength: 0.56,
}

export function fkBand(style: FreeKickStyle, a: FreeKickAbility, env?: PitchEnvironment) {
  const skill = style === 'loft_pass' ? 0.65 * a.passing + 0.35 * a.vision : 0.7 * a.shooting + 0.3 * a.passing
  const center = FREEKICK_STYLES[style].sweet + (style === 'knuckle' ? 0.04 * a.strength : 0)
  let green = (0.044 + 0.082 * skill) * (style === 'knuckle' ? 0.8 : 1)
  let cycle = 1.48 + 1.18 * a.composure
  if (env && !isStandardEnvironment(env)) {
    const ep = environmentPhysics(env)
    if (style === 'knuckle') green *= ep.driveGreenScale
    if (style === 'loft_pass') green *= ep.chipGreenScale
    cycle *= ep.cycleScale + (1 - ep.cycleScale) * 0.45 * a.composure
  }
  return { center, green, yellow: 0.045 + 0.04 * skill, cycle }
}

export interface FreeKickShot {
  spot: FreeKickSpot
  style: FreeKickStyle
  curveOption: CurveOption
  /** Target point at z = 0 (or at z = headerZ prior to header redirect). */
  target: Point
  time: number
  arc: number
  /** Mid-flight lateral offset at u = 0.5 (combines spin curve & wind parabolic drift). */
  curve: number
  knuckleDrop: number
  zone: Zone
  deliveryAccuracy: number
}

export function makeFreeKickShot(
  spot: FreeKickSpot,
  style: FreeKickStyle,
  curveOption: CurveOption,
  aim: Point,
  power: number,
  a: FreeKickAbility,
  seed: number,
  env?: PitchEnvironment,
): FreeKickShot {
  const b = fkBand(style, a, env),
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

  const dist = Math.hypot(spot.x, spot.z)
  let speedScale = 1
  let arc = FREEKICK_STYLES[style].arc
  const baseX = style === 'loft_pass' ? spot.headerTarget.x + aim.x * 0.38 : aim.x
  const baseY =
    style === 'low_drive'
      ? clamp(0.18 + Math.max(0, delta) * 0.8, R, 0.42)
      : style === 'loft_pass'
        ? clamp(spot.headerTarget.y + (aim.y - 1.2) * 0.32, 1.25, 2.45)
        : aim.y
  let targetX = baseX
  let targetY = baseY

  if (delta < 0 && excess > 0) {
    if (zone === '稍轻') {
      const u = excess / Math.max(0.02, b.yellow)
      speedScale = 0.83 - 0.15 * u
      targetX = baseX * (1 - 0.15 * u) + signed * excess * 2.8
      targetY = Math.max(R, baseY * (1 - 0.24 * u) - 0.22 * u)
      arc *= 1 - 0.24 * u
    } else {
      const underSpan = Math.max(0.12, b.center - b.green - b.yellow)
      const underRed = clamp((excess - b.yellow) / underSpan)
      speedScale = 0.55 - 0.24 * underRed
      // Scuffed free kick loses lift (hits wall or rolls weakly to keeper; loft_pass falls short)
      targetX = baseX * (0.65 - 0.32 * underRed) + signed * (0.35 + 0.65 * underRed)
      targetY = style === 'loft_pass' ? clamp(0.95 - 0.55 * underRed, R, 1.05) : Math.max(R, baseY * (0.35 - 0.26 * underRed))
      arc *= 0.32 * (1 - 0.55 * underRed)
    }
  } else if (delta > 0 && excess > 0) {
    if (zone === '稍重') {
      const u = excess / Math.max(0.02, b.yellow)
      speedScale = 1.05 + 0.12 * u
      targetX = baseX + signed * excess * 6.2
      targetY = style === 'low_drive' ? clamp(baseY + 0.42 * u, R, 0.92) : baseY + excess * 9.4
    } else {
      const overSpan = Math.max(0.04, 1 - (b.center + b.green + b.yellow))
      const overRed = clamp((excess - b.yellow) / overSpan)
      speedScale = 1.16 + 0.25 * overRed
      targetX = baseX + signed * (excess * 7.4 + overRed * 1.65)
      targetY =
        style === 'low_drive'
          ? 1.15 + 1.85 * overRed
          : style === 'loft_pass'
            ? 2.95 + 1.35 * overRed
            : baseY + excess * 8.2 + 1.55 + 1.95 * overRed
      arc *= 1.18 + 0.25 * overRed
    }
  }

  let speed = FREEKICK_STYLES[style].speed * (0.78 + 0.38 * a.strength) * speedScale
  const spinControl = (0.72 + 0.35 * (0.5 * a.passing + 0.5 * a.vision)) * (zone === '欠力' ? 0.42 : 1)
  let curve = CURVE_OPTIONS[curveOption].bend * spinControl * 0.48
  const knuckleDrop = style === 'knuckle' && zone !== '欠力' && zone !== '过力' ? 0.55 + 0.35 * a.shooting : 0

  if (env && !isStandardEnvironment(env)) {
    const ep = environmentPhysics(env)
    if (style === 'low_drive' || targetY <= 0.45) {
      speed *= ep.groundSpeedScale
      if (env.surface === 'snow') arc *= 0.6
    }
    if (env.surface === 'mud' && style === 'knuckle' && delta > b.green) {
      targetY += excess * 2.2
    }
    const loftFactor = style === 'loft_pass' ? 1.35 : style === 'low_drive' ? 0.45 : 0.88 + arc * 0.28
    speed = Math.max(6.5, speed - ep.windZ * 0.26 * loftFactor)
    const endZ = style === 'loft_pass' ? spot.headerTarget.z : 0
    const travelZ = Math.max(8, spot.z - endZ)
    const flightTime = (dist * (travelZ / spot.z)) / speed
    const driftX = 0.22 * ep.windX * loftFactor * flightTime * flightTime
    const driftY = -0.05 * ep.windZ * loftFactor * flightTime * flightTime
    targetX += driftX
    targetY = Math.max(R, targetY + driftY)
    curve -= driftX * 0.25
    return {
      spot,
      style,
      curveOption,
      target: { x: targetX, y: targetY },
      time: flightTime,
      arc,
      curve,
      knuckleDrop,
      zone,
      deliveryAccuracy: clamp(1 - excess * 3.2),
    }
  }

  const endZ = style === 'loft_pass' ? spot.headerTarget.z : 0
  const travelZ = Math.max(8, spot.z - endZ)
  return {
    spot,
    style,
    curveOption,
    target: { x: targetX, y: targetY },
    time: (dist * (travelZ / spot.z)) / speed,
    arc,
    curve,
    knuckleDrop,
    zone,
    deliveryAccuracy: clamp(1 - excess * 3.2),
  }
}

export function fkPrimaryBallAt(s: FreeKickShot, t: number): { x: number; y: number; z: number } {
  const endZ = s.style === 'loft_pass' ? s.spot.headerTarget.z : 0
  const u = clamp(t / s.time)
  const hump = 4 * u * (1 - u)
  // Knuckleball stays higher past the wall (u ~ 0.45) then dips sharply in the final third (u > 0.65)
  const knuckleProfile = s.knuckleDrop > 0 ? Math.sin(Math.PI * Math.pow(u, 0.72)) * s.knuckleDrop * 0.42 : 0
  return {
    x: s.spot.x + (s.target.x - s.spot.x) * u + s.curve * hump,
    y: Math.max(R, R + (s.target.y - R) * u + s.arc * hump + knuckleProfile),
    z: s.spot.z + (endZ - s.spot.z) * u,
  }
}

export function wallGeometry(spot: FreeKickSpot, shift: WallShift) {
  const wallZ = Math.max(7.2, spot.z - 9.15)
  const centerX = spot.wallBaseX + shift * 0.56
  const halfSpan = spot.wallCount * 0.27
  return {
    z: wallZ,
    centerX,
    left: centerX - halfSpan,
    right: centerX + halfSpan,
    count: spot.wallCount,
  }
}

export type FreeKickResult =
  | '进球'
  | '配合破门'
  | '人墙挡出'
  | '卧草封出'
  | '抱住'
  | '挡出'
  | '碰到仍进'
  | '击中门框'
  | '偏出'
  | '头球被扑'
  | '头球偏出'
  | '传中偏出'

export interface FreeKickOutcome {
  result: FreeKickResult
  at: number
  totalTime: number
  goalCrossPoint: Point
  underWall: boolean
  headerContact?: { at: number; point: { x: number; y: number; z: number }; goalTarget: Point }
  ballAtTime(t: number): { x: number; y: number; z: number }
}

export function resolveFreeKick(
  s: FreeKickShot,
  dive: Dive | null,
  a: FreeKickAbility,
  options: {
    wallless?: boolean
    keeperless?: boolean
    wallAction?: WallAction
    wallShift?: WallShift
    env?: PitchEnvironment
    seed?: number
  } = {},
): FreeKickOutcome {
  const wallAction = options.wallAction ?? 'jump'
  const wallShift = options.wallShift ?? 0
  const wall = wallGeometry(s.spot, wallShift)
  const endZ = s.style === 'loft_pass' ? s.spot.headerTarget.z : 0
  let underWall = false

  // 1. Check defensive wall plane intersection
  if (!options.wallless && s.spot.z > wall.z && endZ < wall.z) {
    const uWall = (s.spot.z - wall.z) / (s.spot.z - endZ)
    const tWall = s.time * uWall
    const pWall = fkPrimaryBallAt(s, tWall)
    if (pWall.x >= wall.left - R && pWall.x <= wall.right + R) {
      if (wallAction === 'stand') {
        if (pWall.y <= 1.85 + R) {
          return {
            result: '人墙挡出',
            at: tWall,
            totalTime: tWall,
            goalCrossPoint: { x: pWall.x, y: pWall.y },
            underWall: false,
            ballAtTime: (t) => fkPrimaryBallAt(s, Math.min(t, tWall)),
          }
        }
      } else if (wallAction === 'jump') {
        if (pWall.y < 0.43) {
          underWall = true
        } else if (pWall.y <= 2.32 + R) {
          return {
            result: '人墙挡出',
            at: tWall,
            totalTime: tWall,
            goalCrossPoint: { x: pWall.x, y: pWall.y },
            underWall: false,
            ballAtTime: (t) => fkPrimaryBallAt(s, Math.min(t, tWall)),
          }
        }
      } else {
        // 'lie': jumping wall + lying draft-stopper seals 0 .. 2.32m!
        if (pWall.y < 0.45) {
          return {
            result: '卧草封出',
            at: tWall,
            totalTime: tWall,
            goalCrossPoint: { x: pWall.x, y: pWall.y },
            underWall: false,
            ballAtTime: (t) => fkPrimaryBallAt(s, Math.min(t, tWall)),
          }
        }
        if (pWall.y <= 2.32 + R) {
          return {
            result: '人墙挡出',
            at: tWall,
            totalTime: tWall,
            goalCrossPoint: { x: pWall.x, y: pWall.y },
            underWall: false,
            ballAtTime: (t) => fkPrimaryBallAt(s, Math.min(t, tWall)),
          }
        }
      }
    }
  }

  // 2. Back-post tactical lofted pass + teammate header combination
  if (s.style === 'loft_pass') {
    const arrive = fkPrimaryBallAt(s, s.time)
    const ht = s.spot.headerTarget
    const dx = Math.abs(arrive.x - ht.x)
    const dy = Math.abs(arrive.y - ht.y)
    if (dx > 1.55 || arrive.y < 1.15 || arrive.y > 2.75) {
      return {
        result: '传中偏出',
        at: s.time,
        totalTime: s.time,
        goalCrossPoint: { x: arrive.x, y: arrive.y },
        underWall,
        ballAtTime: (t) => fkPrimaryBallAt(s, Math.min(t, s.time)),
      }
    }
    const headerPower = 0.4 * a.teammateOffBall + 0.38 * a.teammateHeading + 0.22 * a.teammateStrength
    const quality = clamp(headerPower * 0.72 + s.deliveryAccuracy * 0.42 - (dx * 0.18 + dy * 0.22))
    const jitter = ((((Math.imul(options.seed ?? 77, 1103515245) + 12345) >>> 0) / 0xffffffff) - 0.5) * 0.9
    const goalTarget: Point = {
      x: clamp(ht.x * 0.92 + jitter * (1.05 - quality), -HALF - 0.55, HALF + 0.55),
      y: clamp(1.18 + (quality - 0.5) * 0.55 + Math.abs(jitter) * (0.95 - quality), 0.25, HEIGHT + 0.45),
    }
    const headerDuration = 0.31
    const totalTime = s.time + headerDuration
    const ballFn = (t: number) => {
      if (t <= s.time) return fkPrimaryBallAt(s, t)
      const uh = clamp((t - s.time) / headerDuration)
      return {
        x: arrive.x + (goalTarget.x - arrive.x) * uh,
        y: Math.max(R, arrive.y + (goalTarget.y - arrive.y) * uh + 0.14 * 4 * uh * (1 - uh)),
        z: arrive.z * (1 - uh),
      }
    }
    const edge = Math.min(HALF - Math.abs(goalTarget.x), HEIGHT - goalTarget.y)
    if (!options.keeperless) {
      const tGlove = s.time + headerDuration * (1 - GLOVE_Z / arrive.z)
      const pGlove = ballFn(tGlove)
      const pose = keeperAt(dive, a, tGlove, options.env)
      const hand = Math.min(
        Math.hypot(pose.left.x - pGlove.x, pose.left.y - pGlove.y),
        Math.hypot(pose.right.x - pGlove.x, pose.right.y - pGlove.y),
      )
      const bodyHit = Math.hypot((pose.body.x - pGlove.x) / 0.35, (pose.body.y - pGlove.y) / 0.77) <= 1
      if (bodyHit || hand <= 0.22 + 0.14 * a.handling) {
        return {
          result: '头球被扑',
          at: tGlove,
          totalTime,
          goalCrossPoint: goalTarget,
          underWall,
          headerContact: { at: s.time, point: arrive, goalTarget },
          ballAtTime: (t) => ballFn(Math.min(t, tGlove)),
        }
      }
    }
    const res: FreeKickResult = edge < -R - 0.06 ? '头球偏出' : edge <= R ? '击中门框' : '配合破门'
    return {
      result: res,
      at: totalTime,
      totalTime,
      goalCrossPoint: goalTarget,
      underWall,
      headerContact: { at: s.time, point: arrive, goalTarget },
      ballAtTime: (t) => ballFn(Math.min(t, totalTime)),
    }
  }

  // 3. Direct shot goalkeeper & goal frame resolution
  const edge = Math.min(HALF - Math.abs(s.target.x), HEIGHT - s.target.y)
  if (!options.keeperless) {
    const env = options.env
    const wetPenalty = env && !isStandardEnvironment(env) ? environmentPhysics(env).wetGlovePenalty : 0
    const effHandling = clamp(a.handling - wetPenalty)
    const atGlove = s.time * (1 - GLOVE_Z / s.spot.z)
    const pGlove = fkPrimaryBallAt(s, atGlove)
    const pose = keeperAt(dive, a, atGlove, env)
    const hand = Math.min(
      Math.hypot(pose.left.x - pGlove.x, pose.left.y - pGlove.y),
      Math.hypot(pose.right.x - pGlove.x, pose.right.y - pGlove.y),
    )
    const bodyHit = Math.hypot((pose.body.x - pGlove.x) / 0.35, (pose.body.y - pGlove.y) / 0.77) <= 1
    if (bodyHit || hand <= 0.19 + 0.15 * effHandling) {
      const cleanCatch = hand < 0.12 + 0.1 * effHandling && wetPenalty < 0.2
      return {
        result: cleanCatch ? '抱住' : '挡出',
        at: atGlove,
        totalTime: atGlove,
        goalCrossPoint: s.target,
        underWall,
        ballAtTime: (t) => fkPrimaryBallAt(s, Math.min(t, atGlove)),
      }
    }
    if (edge > R && hand <= 0.34) {
      return {
        result: '碰到仍进',
        at: s.time,
        totalTime: s.time,
        goalCrossPoint: s.target,
        underWall,
        ballAtTime: (t) => fkPrimaryBallAt(s, Math.min(t, s.time)),
      }
    }
  }

  const finalRes: FreeKickResult = edge < -R - 0.08 ? '偏出' : edge <= R ? '击中门框' : '进球'
  return {
    result: finalRes,
    at: s.time,
    totalTime: s.time,
    goalCrossPoint: s.target,
    underWall,
    ballAtTime: (t) => fkPrimaryBallAt(s, Math.min(t, s.time)),
  }
}

export function makeOpponentFreeKick(
  spot: FreeKickSpot,
  shooter: FreeKickAbility,
  seed: number,
  env?: PitchEnvironment,
): FreeKickShot {
  const s1 = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  const s2 = (Math.imul(s1, 1664525) + 1013904223) >>> 0
  const r1 = s1 / 0xffffffff
  const r2 = s2 / 0xffffffff
  const styles: FreeKickStyle[] = ['curl', 'knuckle', 'trivela', 'low_drive']
  const style = styles[s1 % styles.length]
  const b = fkBand(style, shooter, env)
  const curveOpt: CurveOption =
    style === 'curl' ? (spot.x >= 0 ? 'left_big' : 'right_big') : style === 'trivela' ? 'right_mid' : 'straight'
  const aim: Point =
    style === 'low_drive'
      ? { x: spot.wallBaseX + (r1 - 0.5) * 1.1, y: 0.24 }
      : { x: (r1 < 0.5 ? -1 : 1) * (1.2 + r2 * 1.9), y: 1.15 + r1 * 0.95 }
  return makeFreeKickShot(spot, style, curveOpt, aim, b.center + (r2 - 0.5) * 0.14, shooter, s2, env)
}

export function planFreeKickKeeperDive(
  s: FreeKickShot,
  a: FreeKickAbility,
  rnd: () => number,
): Dive | null {
  const mkTargetDive = (at: number, tx: number, ty: number): Dive => {
    const dx = tx
    const dy = ty - 1.06
    const len = Math.hypot(dx, dy) || 1
    return { at, dir: { x: dx / len, y: dy / len }, target: { x: tx, y: ty } }
  }

  if (s.style === 'loft_pass') {
    const ht = s.spot.headerTarget
    // Keeper tracks the cross and reacts to the back-post header redirect
    const startAt = s.time - 0.04 + (1 - a.reflexes) * 0.14 + rnd() * 0.05
    return mkTargetDive(startAt, ht.x * 0.86, 1.24)
  }

  const atGlove = s.time * (1 - GLOVE_Z / s.spot.z)
  const pGlove = fkPrimaryBallAt(s, atGlove)

  // Slow / under-powered shots: plenty of flight time from 20m+, keeper tracks & catches cleanly
  if (s.zone === '欠力' || s.zone === '稍轻' || s.time >= 1.08) {
    return mkTargetDive(0.12 + (1 - a.reflexes) * 0.1, pGlove.x, pGlove.y)
  }

  // Central shots within goalkeeper's natural patrol zone
  if (Math.abs(pGlove.x) < 1.28) {
    return mkTargetDive(0.14 + (1 - a.reflexes) * 0.08, pGlove.x, pGlove.y)
  }

  // Fast Green/Yellow shots toward the corners: wall screens initial vision (~0.24-0.38s delay)
  // Well-placed Green curlers/knuckleballs into the top/side corner beat his dive; poorly placed ones are saved!
  const screenDelay = 0.23 + (1 - a.reflexes) * 0.15 + rnd() * 0.08
  return mkTargetDive(screenDelay, pGlove.x, pGlove.y)
}

export { fromKeeperPad }
