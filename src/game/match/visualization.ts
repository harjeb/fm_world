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

/** 根据相邻已算出的动作编排跑位；不重新判定传射、碰撞、球权和比分。 */
export function samplePlaybackFrame(frame: MatchPlaybackFrame, progress: number, previous?: MatchPlaybackFrame, next?: MatchPlaybackFrame): PlaybackSample {
  const t = clamp01(progress)
  const duration = span(frame)
  const starts = new Map(frame.from.players.map((player) => [player.id, player]))
  const prevStarts = new Map(previous?.from.players.map((player) => [player.id, player]))
  const prevEnds = new Map(previous?.to.players.map((player) => [player.id, player]))
  const nextStarts = new Map(next?.from.players.map((player) => [player.id, player]))
  const nextEnds = new Map(next?.to.players.map((player) => [player.id, player]))

  function playerAt(id: string, at: number): PlaybackPlayer | undefined {
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
      result[axis] = curve(start[axis], end[axis], incoming * duration, outgoing * duration, at)
    }
    return result
  }

  const players = frame.to.players.map((player) => playerAt(player.id, t)!)
  const positions = new Map(players.map((player) => [player.id, player]))
  const motion = frame.motion
  const sourceId = frame.from.ball.ownerId
  const receiverId = frame.to.ball.ownerId
  const source = sourceId ? positions.get(sourceId) : undefined
  const receiver = receiverId ? positions.get(receiverId) : undefined
  const controlled = sourceId && sourceId === receiverId && (!motion || motion.kind === 'dribble' || motion.kind === 'loose')
  let ball: PlaybackSample['ball']
  let airborne = false

  if (controlled && receiver) {
    ball = { x: receiver.x, y: receiver.y, ownerId: receiverId, height: 0 }
  } else if (!motion) {
    ball = {
      x: frame.from.ball.x + (frame.to.ball.x - frame.from.ball.x) * t,
      y: frame.from.ball.y + (frame.to.ball.y - frame.from.ball.y) * t,
      ownerId: t >= 1 ? receiverId : sourceId,
      height: 0,
    }
  } else {
    // 先处理球，再出脚；球速独立于球员跑动速度，接球后一直随接球人移动。
    const distance = Math.hypot(motion.to.x - motion.from.x, motion.to.y - motion.from.y)
    const arrival = motion.via ? 0.94 : 0.9
    const flight = Math.max(0.2, Math.min(motion.via ? 0.78 : 0.65, distance / (motion.kind === 'shot' ? 32 : 23) / duration))
    const release = arrival - flight
    const launch = !frame.restart && sourceId ? playerAt(sourceId, release) ?? motion.from : motion.from
    const landing = receiverId && !frame.goal ? playerAt(receiverId, arrival) ?? motion.to : motion.to
    const fly = clamp01((t - release) / flight)
    if (t < release) {
      const waiting = !frame.restart && source ? source : motion.from
      ball = { x: waiting.x, y: waiting.y, ownerId: frame.restart ? null : sourceId, height: 0 }
    } else if (t >= arrival) {
      const landed = receiver && !frame.goal ? receiver : motion.to
      ball = { x: landed.x, y: landed.y, ownerId: receiverId, height: 0 }
    } else {
      const firstLeg = !!motion.via && fly < 0.65
      const start = motion.via && !firstLeg ? motion.via : launch
      const end = motion.via && firstLeg ? motion.via : landing
      const part = motion.via ? firstLeg ? fly / 0.65 : (fly - 0.65) / 0.35 : fly
      const high = (motion.kind === 'pass' && distance > 22) || firstLeg
      ball = {
        x: start.x + (end.x - start.x) * part,
        y: start.y + (end.y - start.y) * part,
        ownerId: null,
        // 高球用离地高度表现，而不是把平面落点画歪。
        height: high ? Math.sin(Math.PI * part) * Math.min(5, distance * 0.08) : 0,
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
  private acceptedStep: number

  constructor(pose: MatchPlaybackPose, step = 0, now = 0) {
    this.lastTime = now
    this.lastSample = stationary(pose, step)
    this.acceptedStep = step
  }

  /** 友谊赛可使用完整预演做下一段跑位切线；联赛绝不输入未确认的未来。 */
  setPlan(frames: MatchPlaybackFrame[]): void {
    this.lookahead = new Map(frames.map((frame) => [frame.step, frame]))
  }

  setPlaying(playing: boolean, now: number): void {
    this.sample(now)
    this.playing = playing
  }

  enqueue(frames: MatchPlaybackFrame[], durationMs: (frame: MatchPlaybackFrame) => number, now: number): void {
    this.sample(now)
    for (const frame of frames) {
      if (frame.step <= this.acceptedStep) continue
      if (frame.step > this.acceptedStep + 1) {
        // 长时间挂后台或旧存档没有轨迹：就地切入，不能把缺掉的几十米画成一次飞球。
        this.clips = []
        this.elapsed = 0
        this.previous = undefined
        this.lastSample = stationary(frame.from, frame.step - 1)
      }
      this.clips.push({ frame, duration: Math.max(16, durationMs(frame)) })
      this.acceptedStep = frame.step
    }
  }

  sample(now: number): PlaybackSample {
    const delta = Math.max(0, now - this.lastTime)
    this.lastTime = now
    if (this.playing && this.clips.length) this.elapsed += delta
    while (this.clips.length && this.elapsed >= this.clips[0].duration) {
      const clip = this.clips.shift()!
      this.elapsed -= clip.duration
      const next = clip.started ? clip.next : this.clips[0]?.frame ?? this.lookahead.get(clip.frame.step + 1)
      this.lastSample = samplePlaybackFrame(clip.frame, 1, this.previous, next)
      this.previous = clip.frame
    }
    const clip = this.clips[0]
    if (clip) {
      if (!clip.started) {
        // 开始播放后锁定曲线。网络补来下一步或教练重算未来，不能让同一时刻的位置跳变。
        clip.next = this.clips[1]?.frame ?? this.lookahead.get(clip.frame.step + 1)
        clip.started = true
      }
      this.lastSample = samplePlaybackFrame(clip.frame, this.elapsed / clip.duration, this.previous, clip.next)
    } else {
      // 新动作稍晚到达时保持落点，不回到引擎已重置的中圈，也不累积空等时间。
      this.elapsed = 0
    }
    return this.lastSample
  }

  get pending(): boolean { return this.clips.length > 0 }
}
