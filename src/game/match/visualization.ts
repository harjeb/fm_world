import type { MatchPlaybackFrame, MatchPlaybackPose, PitchPoint } from './types.ts'

export type PlaybackPlayer = PitchPoint & { id: string; dx: number; dy: number }
export type PlaybackSample = {
  step: number
  progress: number
  clock: number
  players: PlaybackPlayer[]
  ball: PitchPoint & { ownerId: string | null; height: number }
  airborne: boolean
  /** 这一步是定位球/开球/进球后的重置：画面可以直接对齐，不用从旧位置跑过去。 */
  restart?: string
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
const span = (frame: MatchPlaybackFrame) => Math.max(0.01, frame.to.clock - frame.from.clock)
const near = (a: PitchPoint, b: PitchPoint) => Math.hypot(a.x - b.x, a.y - b.y) < 0.01

/** 单调三次插值的共享切线：转身时先刹车，同向跑动不会每个判定回合都停一下。 */
function tangent(a: number, b: number): number {
  return a * b > 0 ? 2 * a * b / (a + b) : 0
}

function curve(a: number, b: number, before: number, after: number, t: number): number {
  if (a === b || t <= 0) return a
  if (t >= 1) return b
  const t2 = t * t
  const t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + t) * before
    + (-2 * t3 + 3 * t2) * b + (t3 - t2) * after
}

/** 画面里的球员位置可以由运动层覆盖：球必须贴在“画出来的那个圆点”脚下。 */
export type PoseResolver = (id: string, fallback: PitchPoint) => PitchPoint

export type PlaybackTimelineSegment = {
  kind: 'prepare' | 'flight' | 'contact' | 'settle' | 'carry'
  /** 相对 frame.from.clock 的逻辑秒。 */
  start: number
  end: number
  actorId?: string
  targetId?: string
}

export type PlaybackTimeline = {
  version: 1
  kind: 'pass' | 'shot' | 'dribble' | 'loose'
  /** 出脚：相对 frame.from.clock 的逻辑秒。短传不再等到片段末尾才离开脚下。 */
  release: number
  /** 球抵达落点或被接球人控制的时刻。 */
  arrival: number
  /** release → arrival 的飞行时长。 */
  flight: number
  /** 球路平均速度，米/秒。 */
  speed: number
  /** via（传中/头球）在整段飞行中的比例；没有 via 时为 0。 */
  viaAt: number
  /** 接球人在片段结束前到不了落点，只能落在其当前位置。 */
  fallback: boolean
  segments: PlaybackTimelineSegment[]
}

type PlayerPath = (id: string, t: number) => PlaybackPlayer | undefined

/** 相邻已确认动作之间共享速度切线，只改画面，不重新判定传射、碰撞或比分。 */
function playerPathOf(frame: MatchPlaybackFrame, previous?: MatchPlaybackFrame, next?: MatchPlaybackFrame): PlayerPath {
  const duration = span(frame)
  const starts = new Map(frame.from.players.map((player) => [player.id, player]))
  const prevStarts = new Map(previous?.from.players.map((player) => [player.id, player]))
  const prevEnds = new Map(previous?.to.players.map((player) => [player.id, player]))
  const nextStarts = new Map(next?.from.players.map((player) => [player.id, player]))
  const nextEnds = new Map(next?.to.players.map((player) => [player.id, player]))
  return (id: string, at: number) => {
    const t = clamp01(at)
    const end = frame.to.players.find((player) => player.id === id)
    if (!end) return undefined
    const start = starts.get(id) ?? end
    const prevStart = prevStarts.get(id)
    const prevEnd = prevEnds.get(id)
    const nextStart = nextStarts.get(id)
    const nextEnd = nextEnds.get(id)
    const joinsPrevious = previous && !frame.restart && !previous.goal && prevStart && prevEnd && near(prevEnd, start)
    const joinsNext = next && !next.restart && !frame.goal && nextStart && nextEnd && near(nextStart, end)
    const result: PlaybackPlayer = { id, x: 0, y: 0, dx: end.x - start.x, dy: end.y - start.y }
    for (const axis of ['x', 'y'] as const) {
      const slope = (end[axis] - start[axis]) / duration
      const incoming = joinsPrevious ? tangent((prevEnd[axis] - prevStart[axis]) / span(previous), slope) : slope
      const outgoing = joinsNext ? tangent(slope, (nextEnd[axis] - nextStart[axis]) / span(next)) : slope
      // 单调切线避免曲线穿过边线或在接球点附近绕圈。
      result[axis] = curve(start[axis], end[axis], incoming * duration, outgoing * duration, t)
    }
    return result
  }
}

const BALL_SPEED = { pass: 22, longPass: 19, shot: 30, loose: 12 } as const

/** 一个动作里球速对应的飞行秒数；距离太近也给一个最短处理时间。 */
function flightTime(distance: number, speed: number): number {
  return Math.max(0.18, distance / Math.max(1, speed))
}

const timelineCache = new WeakMap<MatchPlaybackFrame, { key: string; timeline: PlaybackTimeline }>()

/**
 * 依据已确认的位置脚本编排“处理—出脚—飞行—接球”。
 *
 * 这一步只在画面上发生：比分、随机数、球权和事件都不在这里改。
 * 旧存档的 frame 不带时间线，也走同一套推导，所以新旧录像的节奏一致。
 */
export function playbackTimeline(
  frame: MatchPlaybackFrame,
  previous?: MatchPlaybackFrame,
  next?: MatchPlaybackFrame,
  path?: PlayerPath,
): PlaybackTimeline {
  const key = `${previous?.step ?? -1}|${next?.step ?? -1}`
  if (!path) {
    const cached = timelineCache.get(frame)
    if (cached && cached.key === key) return cached.timeline
  }
  const timeline = computeTimeline(frame, previous, next, path ?? playerPathOf(frame, previous, next))
  if (!path) timelineCache.set(frame, { key, timeline })
  return timeline
}

function computeTimeline(
  frame: MatchPlaybackFrame,
  previous: MatchPlaybackFrame | undefined,
  next: MatchPlaybackFrame | undefined,
  path: PlayerPath,
): PlaybackTimeline {
  const duration = span(frame)
  const motion = frame.motion
  if (!motion) {
    return {
      version: 1, kind: 'loose', release: 0, arrival: duration, flight: duration, speed: 0, viaAt: 0, fallback: false,
      segments: [{ kind: 'settle', start: 0, end: duration }],
    }
  }
  const kind = motion.kind
  const controlled = frame.from.ball.ownerId && frame.from.ball.ownerId === frame.to.ball.ownerId && (kind === 'dribble' || kind === 'loose')
  if (kind === 'dribble' || controlled) {
    return {
      version: 1, kind, release: 0, arrival: duration, flight: 0, speed: 0, viaAt: 0, fallback: false,
      segments: [{ kind: 'carry', start: 0, end: duration, actorId: frame.from.ball.ownerId ?? undefined }],
    }
  }

  const openPlay = !frame.restart
  // 定位球需要列阵，等待是比赛的一部分；开放比赛的处理球只占开头一小段。
  const release = frame.restart
    ? clamp01((frame.restart === 'corner' ? Math.max(1.2, duration * 0.55)
      : frame.restart === 'free_kick' ? Math.max(0.9, duration * 0.45)
        : frame.restart === 'penalty' ? 1
          : Math.max(0.8, duration * 0.2)) / duration) * duration
    : Math.min(duration * 0.5, Math.max(0.28, Math.min(0.9, duration * 0.12)))

  const sourceId = frame.from.ball.ownerId
  const launch = (sourceId ? path(sourceId, release / duration) : undefined) ?? { x: motion.from.x, y: motion.from.y }
  const targetId = frame.to.ball.ownerId && path(frame.to.ball.ownerId, 1) ? frame.to.ball.ownerId : null
  const via = motion.via
  const distance = Math.hypot(motion.to.x - launch.x, motion.to.y - launch.y)
  const speed = kind === 'shot'
    ? BALL_SPEED.shot
    : kind === 'loose'
      ? BALL_SPEED.loose
      : distance > 25 ? BALL_SPEED.longPass : BALL_SPEED.pass
  const legLength = (from: PitchPoint, to: PitchPoint) => Math.hypot(to.x - from.x, to.y - from.y)
  const firstLeg = via ? legLength(launch, via) : 0
  const secondLegAt = (at: number) => {
    if (!via) return motion.to
    if (targetId) return path(targetId, clamp01(at / duration)) ?? motion.to
    return motion.to
  }

  // 球要落在“跑动中的接球人”脚下：迭代解出飞行时间，而不是固定 90%。
  let arrival = release + flightTime(firstLeg + legLength(via ?? launch, secondLegAt(release)), speed)
  for (let index = 0; index < 4; index++) {
    const landing = secondLegAt(arrival)
    const nextArrival = release + flightTime(firstLeg + legLength(via ?? launch, landing), speed)
    if (Math.abs(nextArrival - arrival) < 0.01) {
      arrival = nextArrival
      break
    }
    arrival = nextArrival
  }
  let fallback = false
  if (arrival > duration) {
    arrival = duration
    fallback = true
  }
  if (arrival < release + 0.18) arrival = Math.min(duration, release + 0.18)
  const firstFlight = (via ? firstLeg : distance) / speed
  const totalFlight = Math.max(0.01, arrival - release)
  const viaAt = via ? Math.max(0.05, Math.min(0.95, firstFlight / totalFlight)) : 0
  const segments: PlaybackTimelineSegment[] = []
  if (release > 0) segments.push({ kind: 'prepare', start: 0, end: release, actorId: sourceId ?? undefined })
  if (via) {
    segments.push({ kind: 'flight', start: release, end: release + totalFlight * viaAt, actorId: sourceId ?? undefined, targetId: targetId ?? undefined })
    segments.push({ kind: 'contact', start: release + totalFlight * viaAt, end: arrival })
  } else {
    segments.push({ kind: 'flight', start: release, end: arrival, actorId: sourceId ?? undefined, targetId: targetId ?? undefined })
  }
  if (arrival < duration) segments.push({ kind: 'settle', start: arrival, end: duration, targetId: targetId ?? undefined })
  return {
    version: 1, kind, release, arrival, flight: Math.max(0, arrival - release), speed,
    viaAt, fallback, segments,
  }
}

/** 根据相邻已算出的动作编排跑位；不重新判定传射、碰撞、球权和比分。 */
export function samplePlaybackFrame(
  frame: MatchPlaybackFrame,
  progress: number,
  previous?: MatchPlaybackFrame,
  next?: MatchPlaybackFrame,
  resolve?: PoseResolver,
): PlaybackSample {
  const t = clamp01(progress)
  const duration = span(frame)
  const path = playerPathOf(frame, previous, next)
  const players = frame.to.players.map((player) => path(player.id, t)!)
  const positions = new Map(players.map((player) => [player.id, player]))
  const motion = frame.motion
  const sourceId = frame.from.ball.ownerId
  const receiverId = frame.to.ball.ownerId
  const source = sourceId ? positions.get(sourceId) : undefined
  const receiver = receiverId ? positions.get(receiverId) : undefined

  // v3 权威子帧：引擎已经把球放在每 0.1 秒的真实位置，展示层只做插值。
  // 不能再套用动作级的“准备—出脚—飞行”，否则每个 0.2 秒片段都会重新等一次出脚。
  if (frame.substep) {
    if (frame.restart) {
      // 死球重启：球已经摆在新位置，直接硬切；球员仍然连续跑位。
      const ball = { x: frame.to.ball.x, y: frame.to.ball.y, ownerId: frame.to.ball.ownerId, height: 0 }
      return { step: frame.step, progress: t, clock: frame.from.clock + (frame.to.clock - frame.from.clock) * t, players, ball, airborne: false, restart: frame.restart }
    }
    const sameOwner = sourceId && sourceId === receiverId ? source : undefined
    const ball = sameOwner
      ? { x: sameOwner.x, y: sameOwner.y, ownerId: sourceId!, height: 0 }
      : {
          x: frame.from.ball.x + (frame.to.ball.x - frame.from.ball.x) * t,
          y: frame.from.ball.y + (frame.to.ball.y - frame.from.ball.y) * t,
          ownerId: t >= 1 ? receiverId : t <= 0 ? sourceId : null,
          height: 0,
        }
    return { step: frame.step, progress: t, clock: frame.from.clock + (frame.to.clock - frame.from.clock) * t, players, ball, airborne: false, restart: frame.restart }
  }

  const controlled = sourceId && sourceId === receiverId && (!motion || motion.kind === 'dribble' || motion.kind === 'loose')
  let ball: PlaybackSample['ball']
  let airborne = false

  const onPitch = (id: string | null | undefined, fallback: PitchPoint): PitchPoint =>
    id && resolve ? resolve(id, fallback) : fallback

  if (controlled && receiver) {
    const at = onPitch(receiverId, receiver)
    ball = { x: at.x, y: at.y, ownerId: receiverId, height: 0 }
  } else if (!motion) {
    ball = {
      x: frame.from.ball.x + (frame.to.ball.x - frame.from.ball.x) * t,
      y: frame.from.ball.y + (frame.to.ball.y - frame.from.ball.y) * t,
      ownerId: t >= 1 ? receiverId : sourceId,
      height: 0,
    }
  } else {
    const plan = playbackTimeline(frame, previous, next, path)
    const now = t * duration
    const launch = (sourceId ? path(sourceId, plan.release / duration) : undefined) ?? motion.from
    if (now < plan.release) {
      // 处理球阶段：球留在出球人脚下，不跟着引擎里已经移动的坐标跑。
      const waiting = !frame.restart && source ? source : launch
      const at = onPitch(frame.restart ? null : sourceId, waiting)
      ball = { x: at.x, y: at.y, ownerId: frame.restart ? null : sourceId, height: 0 }
    } else if (now >= plan.arrival) {
      // 接球之后：球贴着接球人，而不是停在引擎的落点等下一次重置。
      const landed = receiver && !frame.goal ? receiver : motion.to
      const at = onPitch(frame.goal ? null : receiverId, landed)
      ball = { x: at.x, y: at.y, ownerId: receiverId, height: 0 }
    } else {
      const flight = Math.max(0.001, plan.flight)
      const progressInFlight = clamp01((now - plan.release) / flight)
      const via = motion.via
      const firstLeg = !!via && progressInFlight < plan.viaAt
      const legProgress = via
        ? progressInFlight < plan.viaAt
          ? progressInFlight / Math.max(0.001, plan.viaAt)
          : (progressInFlight - plan.viaAt) / Math.max(0.001, 1 - plan.viaAt)
        : progressInFlight
      const start = via && !firstLeg ? via : launch
      const end = via
        ? firstLeg ? via : path(receiverId ?? '', plan.arrival / duration) ?? motion.to
        : (receiver ? path(receiverId!, plan.arrival / duration) ?? motion.to : motion.to)
      const high = (motion.kind === 'pass' && Math.hypot(motion.to.x - launch.x, motion.to.y - launch.y) > 22) || firstLeg
      // 飞行末段把落点拉向“画出来的接球人”，避免球落地后突然出现在脚边。
      const landAt = onPitch(via ? null : receiverId, end)
      const target = { x: end.x + (landAt.x - end.x) * legProgress * legProgress, y: end.y + (landAt.y - end.y) * legProgress * legProgress }
      ball = {
        x: start.x + (target.x - start.x) * legProgress,
        y: start.y + (target.y - start.y) * legProgress,
        ownerId: null,
        // 高球用离地高度表现，而不是把平面落点画歪。
        height: high ? Math.sin(Math.PI * legProgress) * Math.min(5, Math.hypot(end.x - start.x, end.y - start.y) * 0.08) : 0,
      }
      airborne = true
    }
  }
  return { step: frame.step, progress: t, clock: frame.from.clock + (frame.to.clock - frame.from.clock) * t, players, ball, airborne, restart: frame.restart }
}

function stationary(pose: MatchPlaybackPose, step: number): PlaybackSample {
  return {
    step, progress: 1, clock: pose.clock,
    players: pose.players.map((player) => ({ ...player, dx: 0, dy: 0 })),
    ball: { x: pose.ball.x, y: pose.ball.y, ownerId: pose.ball.ownerId, height: 0 },
    airborne: false,
  }
}

/** 战术轨迹视图的阵型包络，独立的 monotone-chain 实现。 */
export function convexHull(points: PitchPoint[]): PitchPoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (sorted.length < 3) return sorted
  const cross = (a: PitchPoint, b: PitchPoint, c: PitchPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const half = (items: PitchPoint[]) => {
    const hull: PitchPoint[] = []
    for (const point of items) {
      while (hull.length >= 2 && cross(hull.at(-2)!, hull.at(-1)!, point) <= 0) hull.pop()
      hull.push(point)
    }
    return hull.slice(0, -1)
  }
  return [...half(sorted), ...half([...sorted].reverse())]
}

type Clip = { frame: MatchPlaybackFrame; duration: number; started?: boolean; next?: MatchPlaybackFrame }

/**
 * 一个播放时钟消费已确认的动作队列，RAF 只按时间采样。
 * 重绘不重启动画；网络一次补来多步也不丢掉中间传球。
 */
export class MatchPlayback {
  private clips: Clip[] = []
  private previous?: MatchPlaybackFrame
  private lookahead = new Map<number, MatchPlaybackFrame>()
  private elapsed = 0
  private lastTime: number
  private playing = true
  private lastSample: PlaybackSample
  private acceptedKey: number

  constructor(pose: MatchPlaybackPose, step = 0, now = 0) {
    this.lastTime = now
    this.lastSample = stationary(pose, step)
    this.acceptedKey = step
  }

  /** 友谊赛可使用完整预演做下一段跑位切线；联赛绝不输入未确认的未来。 */
  setPlan(frames: MatchPlaybackFrame[]): void {
    this.lookahead = new Map(frames.map((frame) => [frame.seq ?? frame.step, frame]))
  }

  setPlaying(playing: boolean, now: number): void {
    this.sample(now)
    this.playing = playing
  }

  enqueue(frames: MatchPlaybackFrame[], durationMs: (frame: MatchPlaybackFrame) => number, now: number): void {
    this.sample(now)
    for (const frame of frames) {
      const key = frame.seq ?? frame.step
      if (key <= this.acceptedKey) continue
      if (key > this.acceptedKey + 1) {
        // 长时间挂后台或旧存档没有轨迹：就地切入，不能把缺掉的几十米画成一次飞球。
        this.clips = []
        this.elapsed = 0
        this.previous = undefined
        this.lastSample = stationary(frame.from, key - 1)
      }
      this.clips.push({ frame, duration: Math.max(16, durationMs(frame)) })
      this.acceptedKey = key
    }
  }

  /** 消费一段现实时间，返回消费后那一时刻的画面；播放器时钟不依赖调用次数。 */
  advance(dtWall: number, resolve?: PoseResolver): PlaybackSample {
    if (this.playing && this.clips.length) this.elapsed += Math.max(0, dtWall)
    while (this.clips.length && this.elapsed >= this.clips[0].duration) {
      const clip = this.clips.shift()!
      this.elapsed -= clip.duration
      const next = clip.started ? clip.next : this.clips[0]?.frame ?? this.lookahead.get((clip.frame.seq ?? clip.frame.step) + 1)
      this.lastSample = samplePlaybackFrame(clip.frame, 1, this.previous, next, resolve)
      this.previous = clip.frame
    }
    const clip = this.clips[0]
    if (clip) {
      if (!clip.started) {
        // 开始播放后锁定曲线。网络补来下一步或教练重算未来，不能让同一时刻的位置跳变。
        clip.next = this.clips[1]?.frame ?? this.lookahead.get((clip.frame.seq ?? clip.frame.step) + 1)
        clip.started = true
      }
      this.lastSample = samplePlaybackFrame(clip.frame, this.elapsed / clip.duration, this.previous, clip.next, resolve)
    } else {
      // 新动作稍晚到达时保持落点，不回到引擎已重置的中圈，也不累积空等时间。
      this.elapsed = 0
    }
    return this.lastSample
  }

  /** 按绝对现实时刻推进；只用于外部调用者，渲染层用 advanceBy 才能逐 tick 采样。 */
  sample(now: number, resolve?: PoseResolver): PlaybackSample {
    const delta = Math.max(0, now - this.lastTime)
    this.lastTime = now
    return this.advance(delta, resolve)
  }

  /** 以固定步长推进；与 lastTime 一起前移，渲染层一帧补多个 tick 时每个 tick 都能拿到自己的目标。 */
  advanceBy(dtWall: number, resolve?: PoseResolver): PlaybackSample {
    this.lastTime += Math.max(0, dtWall)
    return this.advance(dtWall, resolve)
  }

  /** 在不重新消费队列的前提下，用当前游标重算一次画面（例如球要贴到画出来的球员脚下）。 */
  recompute(resolve?: PoseResolver): PlaybackSample {
    const clip = this.clips[0]
    if (!clip) return this.lastSample
    this.lastSample = samplePlaybackFrame(clip.frame, this.elapsed / clip.duration, this.previous, clip.next, resolve)
    return this.lastSample
  }

  get pending(): boolean { return this.clips.length > 0 }

  /**
   * 当前这一段动作的播放倍速：比赛秒 / 现实秒。
   * 运动层用它换算出“这一帧应该推进几个 10 Hz tick”。
   */
  rate(): number {
    const clip = this.clips[0]
    if (!clip || !this.playing) return 0
    const logical = Math.max(0.01, clip.frame.to.clock - clip.frame.from.clock)
    return logical / Math.max(0.016, clip.duration / 1000)
  }
}
