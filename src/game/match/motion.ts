/**
 * 连续运动层：把“已经判好的比赛动作”铺成 10 Hz 的跑动轨迹。
 *
 * 这一层不参与任何比赛判定：比分、随机数、球权、事件都不经过这里。
 * 它只做一件事 —— 让每个圆点按真实的速度、加速度和转向速率去追引擎给出的位置，
 * 于是慢球员会掉队、急转会甩出去一点，而不是所有人在两步之间做匀速直线滑行。
 *
 * 参数取自 FM24 的 `physical_constraints.jsb`（见 docs/2d-animation-research.md）：
 *   速度档位 0.45–12.27 m/s、加速度 0.25–8.94 m/s²、减速 1.5–4.47 m/s²、
 *   转向速率 192 / 104 / 53 °/s（步行 / 慢跑 / 全速跑）。
 */
import type { PitchPoint } from './types.ts'

/** 与 FM 的 tick 一致：位置 10 Hz，渲染再插值到屏幕刷新率。 */
export const MOTION_TICK_HZ = 10
export const MOTION_TICK_SECONDS = 1 / MOTION_TICK_HZ

/** 落后超过这个距离就不再“追”，直接对齐（引擎发生了瞬移）。 */
export const SNAP_DISTANCE = 10

/** FM24 `physical_constraints.jsb` 的关键取值，单位 m/s、m/s²、°/s。 */
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

export type MotionPose = PitchPoint & { speed: number }

/**
 * 一个球员的连续状态。位置、速度都保留下来，下一步只做“朝目标加速 + 限速转向”，
 * 所以同一份输入永远得到同一份输出（没有随机数）。
 */
export class MotionAgent {
  x: number
  y: number
  vx = 0
  vy = 0
  heading = 0
  private profile: MotionProfile

  constructor(profile: MotionProfile, start: PitchPoint) {
    this.profile = profile
    this.x = start.x
    this.y = start.y
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy)
  }

  setProfile(profile: MotionProfile): void {
    this.profile = profile
  }

  teleport(point: PitchPoint): void {
    this.x = point.x
    this.y = point.y
    this.vx = 0
    this.vy = 0
  }

  /**
   * 朝目标推进一个固定 tick。target 是“这一帧引擎希望他到达的位置”，
   * targetSpeed 是这个目标本身的速度（引擎路径的导数）——跟跑时要保持同速，
   * 否则每 tick 都会“追上→停下→再追”，画面抖成筛子。
   */
  step(target: PitchPoint, dt = MOTION_TICK_SECONDS, targetSpeed = 0): void {
    const dx = target.x - this.x
    const dy = target.y - this.y
    const distance = Math.hypot(dx, dy)
    const current = this.speed
    // 距离近但目标在移动时不能收油：用目标速度做前馈，再补上距离修正。
    const chase = targetSpeed > 0.05 ? Math.max(targetSpeed, distance / 0.45) : distance / 0.25
    // 只有目标自己被“挪”走（引擎改写接球点、定位球站位）才允许冲刺追赶，
    // 上限 1.5 倍；普通跑位永远不超过属性对应的最高速度。
    const jumpy = targetSpeed > this.profile.maxSpeed * 1.2
    const catchUp = jumpy && distance > 3 ? 1 + Math.min(0.5, (distance - 3) / 10) : 1
    const wantedSpeed = distance < 0.04 && targetSpeed < 0.05 ? 0 : Math.min(this.profile.maxSpeed * catchUp, chase)
    const nextSpeed = wantedSpeed > current
      ? Math.min(wantedSpeed, current + this.profile.acceleration * dt)
      : Math.max(wantedSpeed, current - this.profile.deceleration * dt)
    if (distance > 1e-4) {
      const wantedHeading = Math.atan2(dy, dx)
      const limit = turnRateAt(this.profile, current) * (Math.PI / 180) * dt
      const delta = wrapAngle(wantedHeading - this.heading)
      // 静止时直接朝向目标，不需要先转身。
      this.heading = current < 0.2 ? wantedHeading : this.heading + clamp(delta, -limit, limit)
    }
    this.vx = Math.cos(this.heading) * nextSpeed
    this.vy = Math.sin(this.heading) * nextSpeed
    this.x += this.vx * dt
    this.y += this.vy * dt
    // 球场边界（留 0.4 米，别把点画到线上）。
    this.x = clamp(this.x, 0.4, 104.6)
    this.y = clamp(this.y, 0.4, 63.6)
    if (nextSpeed === 0) {
      this.vx = 0
      this.vy = 0
    }
  }
}

/**
 * 一队球员的运动场：固定 10 Hz 推进，渲染时在相邻两个 tick 之间插值。
 * `sample()` 返回的画面位置就是“已经跑出来的位置”，不是又一次插值。
 */
export class MotionField {
  private agents = new Map<string, MotionAgent>()
  private previous = new Map<string, PitchPoint>()
  private current = new Map<string, PitchPoint>()
  private profiles: Map<string, MotionProfile>
  private lastTargets = new Map<string, PitchPoint>()
  ticks = 0
  snaps = 0

  constructor(profiles: Map<string, MotionProfile>, start: { id: string; x: number; y: number }[]) {
    this.profiles = profiles
    for (const player of start) this.ensure(profiles, player)
  }

  /** 替补上场等新出现的球员在这里补一个起点，不做补间。 */
  ensure(profiles: Map<string, MotionProfile>, player: { id: string; x: number; y: number }): void {
    if (this.agents.has(player.id)) return
    const profile = profiles.get(player.id)
    if (!profile) return
    this.agents.set(player.id, new MotionAgent(profile, player))
    this.previous.set(player.id, { x: player.x, y: player.y })
    this.current.set(player.id, { x: player.x, y: player.y })
  }

  has(id: string): boolean {
    return this.agents.has(id)
  }

  setProfiles(profiles: Map<string, MotionProfile>): void {
    this.profiles = profiles
    for (const [id, agent] of this.agents) {
      const profile = profiles.get(id)
      if (profile) agent.setProfile(profile)
    }
  }

  /** 断线/换人/开球重置时直接对齐，不做过渡。 */
  reset(pose: { id: string; x: number; y: number }[]): void {
    this.lastTargets.clear()
    for (const player of pose) {
      const agent = this.agents.get(player.id)
      if (!agent) continue
      agent.teleport(player)
      this.previous.set(player.id, { x: player.x, y: player.y })
      this.current.set(player.id, { x: player.x, y: player.y })
    }
  }

  /** 推进一个 10 Hz tick；targets 是引擎在这一 tick 期望的位置。 */
  tick(targets: Map<string, PitchPoint>, dt = MOTION_TICK_SECONDS): void {
    for (const [id, agent] of this.agents) {
      const target = targets.get(id)
      if (!target) continue
      const last = this.lastTargets.get(id)
      const targetSpeed = last ? Math.hypot(target.x - last.x, target.y - last.y) / dt : 0
      this.lastTargets.set(id, { x: target.x, y: target.y })
      // 引擎把某个人直接挪走（定位球站位、换人、开球）时，单人对齐；
      // 只挪一个人，比全队一起跳自然得多。
      if (Math.hypot(target.x - agent.x, target.y - agent.y) > SNAP_DISTANCE) {
        agent.teleport(target)
        this.snaps++
        this.previous.set(id, { x: target.x, y: target.y })
        this.current.set(id, { x: target.x, y: target.y })
        continue
      }
      this.previous.set(id, { x: agent.x, y: agent.y })
      agent.step(target, dt, targetSpeed)
      this.current.set(id, { x: agent.x, y: agent.y })
    }
    this.ticks++
  }

  /** 两个 tick 之间按时间插值，给 60 fps 渲染用。 */
  sample(alpha: number): { id: string; x: number; y: number; speed: number }[] {
    const t = clamp(alpha, 0, 1)
    const out: { id: string; x: number; y: number; speed: number }[] = []
    for (const [id, agent] of this.agents) {
      const from = this.previous.get(id) ?? { x: agent.x, y: agent.y }
      const to = this.current.get(id) ?? { x: agent.x, y: agent.y }
      out.push({ id, x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, speed: agent.speed })
    }
    return out
  }
}

/** 一场比赛按 10 Hz 铺满会有多少 tick：用于对比“加判定回合”和“加运动层”。 */
export function motionTicksForFrames(frames: { from: { clock: number }; to: { clock: number } }[]): number {
  let ticks = 0
  for (const frame of frames) ticks += Math.max(1, Math.round((frame.to.clock - frame.from.clock) * MOTION_TICK_HZ))
  return ticks
}

/* ---------- 球：解析轨迹（踢出瞬间就把整条曲线算完） ---------- */

export type BallFlight = {
  from: PitchPoint
  to: PitchPoint
  /** 出脚到落地的时间（秒）。 */
  duration: number
  /** 最高离地高度（米）。 */
  apex: number
  launch: number
  landing: number
}

/**
 * 按 FM 的踢球速度档位算飞行时间：短传 9 m/s、中距离 17、传中 21、射门 25–33。
 * 高球用抛物线，落地时间由水平速度决定，画面只是把弧线画出来。
 */
export function planBallFlight(input: {
  from: PitchPoint
  to: PitchPoint
  kind: 'pass' | 'shot' | 'dribble' | 'loose'
  duration: number
  via?: PitchPoint
}): BallFlight {
  const distance = Math.hypot(input.to.x - input.from.x, input.to.y - input.from.y)
  const kick = input.kind === 'shot'
    ? 25 + Math.min(8, distance * 0.18)
    : input.kind === 'pass'
      ? (distance > 22 ? 17 : 9) + Math.min(4, distance * 0.08)
      : 7
  // 飞行时间取“球速”和“这一段动作时长”的较小值：动作本身要留出处理球的时间。
  const flight = clamp(distance / kick, 0.18, Math.max(0.2, input.duration * 0.82))
  const lofted = input.kind === 'pass' && distance > 22
  const apex = lofted ? Math.min(6.5, Math.max(1.2, distance * 0.12)) : 0
  return { from: { ...input.from }, to: { ...input.to }, duration: flight, apex, launch: 0, landing: 0 }
}

/** 在整段动作时长里定位球的“出脚 / 到达”时刻，再给出 t 时刻的位置与高度。 */
export function sampleBallFlight(flight: BallFlight, progress: number): { point: PitchPoint; height: number; airborne: boolean } {
  const t = clamp(progress, 0, 1)
  const { launch, landing } = flight
  if (t <= launch) return { point: { ...flight.from }, height: 0, airborne: false }
  if (t >= landing) return { point: { ...flight.to }, height: 0, airborne: false }
  const leg = (t - launch) / Math.max(1e-6, landing - launch)
  return {
    point: {
      x: flight.from.x + (flight.to.x - flight.from.x) * leg,
      y: flight.from.y + (flight.to.y - flight.from.y) * leg,
    },
    height: flight.apex > 0 ? Math.sin(Math.PI * leg) * flight.apex : 0,
    airborne: true,
  }
}
