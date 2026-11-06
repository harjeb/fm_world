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
import { MOTION_TICK_HZ, MOTION_TICK_SECONDS, motionProfileOf, stepMotion, turnRateAt } from './kinematics.ts'
import type { MotionProfile } from './kinematics.ts'

export { MOTION_TICK_HZ, MOTION_TICK_SECONDS, PHYSICAL, motionProfileOf, turnRateAt } from './kinematics.ts'
export type { MotionProfile } from './kinematics.ts'

/** 落后超过这个距离就不再“追”，直接对齐（引擎发生了瞬移）。 */
export const SNAP_DISTANCE = 10

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))


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
    stepMotion(this, this.profile, target, dt, targetSpeed)
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

/**
 * 运动层的时钟：把“现实时间 × 播放倍速”折算成比赛里的 10 Hz tick。
 *
 * 这一点很关键：慢放的 1 秒现实时间可能等于 1.1 秒比赛时间，快放则等于 4 秒以上。
 * 如果按现实 10 Hz 推进，一次 4 秒的动作只摊到 3 个 tick，球员就只能在一步里瞬移。
 */
export class MotionClock {
  private remainder = 0
  private rate = 1

  /** 累加现实时间，返回这一帧应该推进几个 tick；`rate` 是“比赛秒 / 现实秒”。 */
  add(dtWall: number, rate: number, maxTicks = 240): number {
    this.rate = rate
    if (!(dtWall > 0) || !(rate > 0)) return 0
    this.remainder += dtWall * rate
    let ticks = Math.floor(this.remainder / MOTION_TICK_SECONDS)
    if (ticks > maxTicks) {
      // 切后台回来时不能一次补上千个 tick，直接对齐到当前目标。
      ticks = maxTicks
      this.remainder = 0
    } else {
      this.remainder -= ticks * MOTION_TICK_SECONDS
    }
    return ticks
  }

  /** 两个 tick 之间的插值比例。 */
  get alpha(): number {
    return Math.max(0, Math.min(1, this.remainder / MOTION_TICK_SECONDS))
  }

  /** 当前按比赛时间算的 tick 频率（现实每秒几个 tick）。 */
  get ticksPerSecond(): number {
    return MOTION_TICK_HZ * this.rate
  }

  reset(): void {
    this.remainder = 0
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
