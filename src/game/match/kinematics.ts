/**
 * 确定性的连续运动学：权威仿真和浏览器运动层共用同一套限速、加速度和转向规则。
 *
 * 参数取自 FM24 的 `physical_constraints.jsb`（见 docs/2d-animation-research.md）：
 *   速度档位 0.45–12.27 m/s、加速度 0.25–8.94 m/s²、减速 1.5–4.47 m/s²、
 *   转向速率 192 / 104 / 53 °/s（步行 / 慢跑 / 全速跑）。
 */
import type { PitchPoint } from './types.ts'

/** 与 FM 的 tick 一致：位置 10 Hz，渲染再插值到屏幕刷新率。 */
export const MOTION_TICK_HZ = 10
export const MOTION_TICK_SECONDS = 1 / MOTION_TICK_HZ

export const PHYSICAL = {
  /** 走 / 慢走 / 跑 / 冲刺 / 最高速。 */
  walkSpeed: 1.341,
  jogSpeed: 2.682,
  runSpeed: 4.47,
  sprintSpeed: 6.706,
  topSpeed: 8.941,
  /** 理论最大加速度与减速。 */
  maxAcceleration: 8.941,
  minAcceleration: 0.25,
  maxDeceleration: 4.47,
  minDeceleration: 1.5,
  /** 转向速率：低于 2.7 m/s 时 192°/s，低于 5.0 m/s 时 104°/s，全速 53°/s。 */
  turnRateWalk: 192,
  turnRateJog: 104,
  turnRateRun: 53,
} as const

export type MotionProfile = {
  /** 本场最高速度（米/秒），由速度属性与剩余体能决定。 */
  maxSpeed: number
  /** 起步加速度（米/秒²）。 */
  acceleration: number
  /** 刹车减速度（米/秒²）。 */
  deceleration: number
  /** 低速时的转向速率（度/秒），高速时按 PHYSICAL 表衰减。 */
  turnRate: number
}

/** 属性评分（0–100）与体能比例 → 运动参数。 */
export function motionProfileOf(input: {
  speed: number
  acceleration: number
  agility: number
  /** 当前体力 / 满体力，0–1。 */
  stamina: number
}): MotionProfile {
  const speed = Math.max(0, Math.min(100, input.speed)) / 100
  const accel = Math.max(0, Math.min(100, input.acceleration)) / 100
  const agility = Math.max(0, Math.min(100, input.agility)) / 100
  // 体能低于 55% 之后明显掉速；和引擎里体力对跑动的影响方向一致。
  const stamina = Math.max(0, Math.min(1, input.stamina))
  const fatigue = 0.62 + 0.38 * Math.min(1, stamina / 0.75)
  return {
    maxSpeed: (5.4 + 3.2 * speed) * fatigue,
    acceleration: PHYSICAL.minAcceleration + (PHYSICAL.maxAcceleration - PHYSICAL.minAcceleration) * accel,
    deceleration: PHYSICAL.minDeceleration + (PHYSICAL.maxDeceleration - PHYSICAL.minDeceleration) * accel,
    turnRate: PHYSICAL.turnRateWalk * (0.75 + 0.45 * agility),
  }
}

/** 当前速度下的最大转向速率（度/秒）。 */
export function turnRateAt(profile: MotionProfile, speed: number): number {
  if (speed < PHYSICAL.jogSpeed) return profile.turnRate
  if (speed < PHYSICAL.runSpeed) return PHYSICAL.turnRateJog * (profile.turnRate / PHYSICAL.turnRateWalk)
  return PHYSICAL.turnRateRun * (profile.turnRate / PHYSICAL.turnRateWalk)
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function wrapAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2
  while (angle < -Math.PI) angle += Math.PI * 2
  return angle
}

export type MotionState = {
  x: number
  y: number
  vx: number
  vy: number
  heading: number
}

export function motionStateAt(point: PitchPoint): MotionState {
  return { x: point.x, y: point.y, vx: 0, vy: 0, heading: 0 }
}

export function speedOf(state: MotionState): number {
  return Math.hypot(state.vx, state.vy)
}

/**
 * 朝目标推进一个固定 tick，原地修改 state。
 * targetSpeed 是目标本身的速度（引擎路径的导数）——跟跑时保持同速，
 * 否则每个 tick 都会“追上→停下→再追”，画面抖成筛子。
 */
export function stepMotion(
  state: MotionState,
  profile: MotionProfile,
  target: PitchPoint,
  dt = MOTION_TICK_SECONDS,
  targetSpeed = 0,
): void {
  const dx = target.x - state.x
  const dy = target.y - state.y
  const distance = Math.hypot(dx, dy)
  const current = speedOf(state)
  // 距离近但目标在移动时不能收油：用目标速度做前馈，再补上距离修正。
  // 目标在身后时先减速再转身：真实球员不会全速画大弧线，低速下转向速率也更高。
  const behind = distance > 0.5 ? Math.abs(wrapAngle(Math.atan2(dy, dx) - state.heading)) : 0
  const turnFactor = behind > 2.1 ? 0.25 : behind > 1.05 ? 0.5 : 1
  const chase = (targetSpeed > 0.05 ? Math.max(targetSpeed, distance / 0.45) : distance / 0.25) * turnFactor
  const jumpy = targetSpeed > profile.maxSpeed * 1.2
  // 只有目标明显超过个人上限时才允许短暂追赶；正常跟跑严格不超过属性上限。
  const catchUp = jumpy && distance > 3 ? 1 + Math.min(0.5, (distance - 3) / 10) : 1
  const wantedSpeed = distance < 0.04 && targetSpeed < 0.05 ? 0 : Math.min(profile.maxSpeed * catchUp, chase)
  const nextSpeed = wantedSpeed > current
    ? Math.min(wantedSpeed, current + profile.acceleration * dt)
    : Math.max(wantedSpeed, current - profile.deceleration * dt)
  if (distance > 1e-4) {
    const wantedHeading = Math.atan2(dy, dx)
    const limit = turnRateAt(profile, current) * (Math.PI / 180) * dt
    const delta = wrapAngle(wantedHeading - state.heading)
    // 静止时直接朝向目标，不需要先转身。
    state.heading = current < 0.2 ? wantedHeading : state.heading + clamp(delta, -limit, limit)
  }
  state.vx = Math.cos(state.heading) * nextSpeed
  state.vy = Math.sin(state.heading) * nextSpeed
  state.x += state.vx * dt
  state.y += state.vy * dt
  // 球场边界（留 0.4 米，别把点画到线上）。
  state.x = clamp(state.x, 0.4, 104.6)
  state.y = clamp(state.y, 0.4, 63.6)
  if (nextSpeed === 0) {
    state.vx = 0
    state.vy = 0
  }
}
