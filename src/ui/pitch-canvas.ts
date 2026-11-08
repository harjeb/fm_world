import { shortName } from './format.ts'
import type { GameEngine } from '../game/pes/engine.ts'
import { drawPesPitch, isPesEngine, pesFrameCount, pesMotionSnapshot, pesViewEngine, resetPesView } from './pes-pitch.ts'
import { PITCH_LENGTH, PITCH_WIDTH } from '../game/match/team.ts'
import { game, ui } from './state.ts'
import { inkOn } from './components.ts'
import { friendlyStepMs, leagueTweenMs } from './match-timing.ts'
import { capturePlaybackPose } from '../game/match/playback.ts'
import { planMatchReplay } from '../game/match/replay.ts'
import type { MatchPlaybackFrame, MatchPlaybackPose, MatchPlayerState } from '../game/match/types.ts'
import { convexHull, MatchPlayback, type PlaybackSample, type PoseResolver } from '../game/match/visualization.ts'
import { MotionClock, MotionField, motionProfileOf, type MotionProfile } from '../game/match/motion.ts'
import { drawFootball2dBase } from './football2d-field.ts'
import { matchKits } from './screens/match.ts'

const fonts = 'Bahnschrift, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
const LINE = 'rgba(255,255,255,.62)'
const GOALKEEPER_FILL = '#f4f6f8'

/** 赛果引擎只提交动作；展示层有独立时钟、动作队列与逐帧跑位。 */
const view = {
  playback: null as MatchPlayback | null,
  pose: null as MatchPlaybackPose | null,
  roster: new Map<string, MatchPlayerState>(),
  key: '',
  planKey: '',
  step: -1,
  /** 已入队的最新轨迹序号（v3 一个动作有多帧，不能再用 step 去重）。 */
  seq: 0,
  frame: null as number | null,
  ground: null as HTMLCanvasElement | null,
  /** 10 Hz 连续运动层：圆点按各自的速度/加速度/转向速率追引擎给的位置。 */
  motion: null as MotionField | null,
  motionAt: 0,
  clock: new MotionClock(),
  motionRestart: '',
  /** 当前播放倍速（比赛秒/现实秒），由 MatchPlayback 提供。 */
  playbackRate: 1,
}

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/** 比赛正在走：联赛一直走，友谊赛没暂停就走。这时画面持续刷新。 */
function isLive(_engine: GameEngine): boolean {
  if (reducedMotion()) return false
  return !!game.activeMatch?.context.isLeague || ui.matchPlaying
}

/** 属性评分 + 当前体能 → 这名球员这一帧的运动能力。 */
function motionProfiles(roster: Map<string, MatchPlayerState>): Map<string, MotionProfile> {
  const profiles = new Map<string, MotionProfile>()
  for (const [id, player] of roster) {
    profiles.set(id, motionProfileOf({
      speed: player.attrs.speed,
      acceleration: player.attrs.acceleration,
      agility: player.attrs.agility,
      stamina: player.stamina / Math.max(1, player.maxStamina),
    }))
  }
  return profiles
}

function drawGround(ctx: CanvasRenderingContext2D, w: number, h: number, pad: number, x: (value: number) => number, y: (value: number) => number, sx: number, sy: number): void {
  drawFootball2dBase(ctx, { x: pad, y: pad, width: w - pad, height: h - pad })
  ctx.strokeStyle = LINE
  ctx.fillStyle = LINE
  ctx.lineWidth = 2.5
  ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2)
  const boxW = 18 * sx
  const boxH = 30 * sy
  ctx.strokeRect(pad, y(32) - boxH / 2, boxW, boxH)
  ctx.strokeRect(w - pad - boxW, y(32) - boxH / 2, boxW, boxH)
  for (const spot of [11, PITCH_LENGTH - 11]) {
    ctx.beginPath(); ctx.arc(x(spot), y(32), 3.5, 0, Math.PI * 2); ctx.fill()
  }
  const cornerRadius = 1.6 * sx
  for (const [cx, cy, start] of [[pad, pad, 0], [w - pad, pad, Math.PI / 2], [w - pad, h - pad, Math.PI], [pad, h - pad, Math.PI * 1.5]] as [number, number, number][]) {
    ctx.beginPath(); ctx.arc(cx, cy, cornerRadius, start, start + Math.PI / 2); ctx.stroke()
  }
  const goalH = 12 * sy
  ctx.fillStyle = 'rgba(255,255,255,.14)'
  ctx.fillRect(pad - 10, y(32) - goalH / 2, 10, goalH)
  ctx.fillRect(w - pad, y(32) - goalH / 2, 10, goalH)
  ctx.strokeRect(pad - 10, y(32) - goalH / 2, 10, goalH)
  ctx.strokeRect(w - pad, y(32) - goalH / 2, 10, goalH)
}

function drawFrame(canvas: HTMLCanvasElement, engine: GameEngine, sample: PlaybackSample): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  const pad = 34
  const sx = (w - pad * 2) / PITCH_LENGTH
  const sy = (h - pad * 2) / PITCH_WIDTH
  const x = (value: number) => pad + value * sx
  const y = (value: number) => pad + value * sy
  // canvas 被 CSS 缩放，球员标记和文字按屏幕像素定尺寸，宽窄屏上都一样大。
  const unit = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1
  const showNames = canvas.clientWidth >= 520
  // 球场不会每帧变化；缓存 football2d 的静态图层，RAF 只画活动对象。
  if (!view.ground || view.ground.width !== w || view.ground.height !== h) {
    view.ground = document.createElement('canvas')
    view.ground.width = w
    view.ground.height = h
    const ground = view.ground.getContext('2d')
    if (ground) drawGround(ground, w, h, pad, x, y, sx, sy)
  }
  ctx.drawImage(view.ground, 0, 0)
  const ball = sample.ball
  const kits = matchKits(engine)
  const ownerId = ball.ownerId

  if (ui.pitchView === 'tracking') {
    // soccerAnimate 风格的全员轨迹/阵型包络；只解释已算好的跑位，不参与比赛判定。
    for (const side of ['home', 'away'] as const) {
      const hull = convexHull(sample.players.filter((point) => {
        const player = view.roster.get(point.id)
        return player?.side === side && player.position !== 'GK'
      }))
      if (hull.length < 3) continue
      ctx.beginPath()
      hull.forEach((point, index) => index ? ctx.lineTo(x(point.x), y(point.y)) : ctx.moveTo(x(point.x), y(point.y)))
      ctx.closePath()
      ctx.fillStyle = kits[side]
      ctx.globalAlpha = 0.12
      ctx.fill()
      ctx.globalAlpha = 0.42
      ctx.strokeStyle = kits[side]
      ctx.lineWidth = 1.2 * unit
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }

  for (const position of sample.players) {
    const player = view.roster.get(position.id)
    if (!player) continue
    const px = x(position.x)
    const py = y(position.y)
    const kit = player.side === 'home' ? kits.home : kits.away
    const isGk = player.position === 'GK'
    const fill = isGk ? GOALKEEPER_FILL : kit

    const radius = 12 * unit
    if (ui.pitchView === 'tracking' && Math.hypot(position.dx, position.dy) > 0.2) {
      const angle = Math.atan2(position.dy * sy, position.dx * sx)
      const length = (21 + Math.min(12, Math.hypot(position.dx, position.dy))) * unit
      const tipX = px + Math.cos(angle) * length
      const tipY = py + Math.sin(angle) * length
      ctx.strokeStyle = 'rgba(255,255,255,.7)'
      ctx.lineWidth = 1.2 * unit
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(tipX, tipY)
      ctx.moveTo(tipX - Math.cos(angle - 0.5) * 5 * unit, tipY - Math.sin(angle - 0.5) * 5 * unit)
      ctx.lineTo(tipX, tipY)
      ctx.lineTo(tipX - Math.cos(angle + 0.5) * 5 * unit, tipY - Math.sin(angle + 0.5) * 5 * unit)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.ellipse(px, py + radius, radius * 0.85, radius * 0.32, 0, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0,0,0,.28)'
    ctx.fill()

    if (player.id === ownerId) {
      ctx.beginPath()
      ctx.arc(px, py, radius + 6 * unit, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255,255,255,.85)'
      ctx.lineWidth = 1.5 * unit
      ctx.stroke()
    }

    ctx.beginPath()
    ctx.arc(px, py, radius, 0, Math.PI * 2)
    ctx.fillStyle = fill
    ctx.fill()
    ctx.lineWidth = (isGk ? 2 : 1.2) * unit
    ctx.strokeStyle = isGk ? kit : 'rgba(10,14,18,.75)'
    ctx.stroke()

    const stamina = Math.max(0, Math.min(100, player.stamina / Math.max(1, player.maxStamina) * 100))
    ctx.beginPath()
    ctx.arc(px, py, radius + 3 * unit, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * stamina) / 100)
    ctx.strokeStyle = stamina > 55 ? 'rgba(160,240,190,.9)' : stamina > 30 ? 'rgba(242,184,75,.95)' : 'rgba(242,112,106,.95)'
    ctx.lineWidth = 1.8 * unit
    ctx.stroke()

    const number = Number.isFinite(player.number) ? player.number : 0
    ctx.fillStyle = inkOn(fill)
    ctx.font = `700 ${12 * unit}px ${fonts}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(number), px, py + 1)

    if (showNames) {
      const labelY = py + radius + 11 * unit
      ctx.font = `500 ${11.5 * unit}px ${fonts}`
      ctx.lineWidth = 2.5 * unit
      ctx.lineJoin = 'round'
      ctx.strokeStyle = 'rgba(8,14,10,.8)'
      const label = shortName(player.name)
      ctx.strokeText(label, px, labelY)
      ctx.fillStyle = '#f2f5f7'
      ctx.fillText(label, px, labelY)
    }
  }

  // 脚下球往跑动方向挪一点，别被圆点盖住。
  let ballX = ball.x
  let ballY = ball.y
  if (ball.ownerId) {
    const owner = sample.players.find((player) => player.id === ball.ownerId)
    if (owner) {
      const length = Math.hypot(owner.dx, owner.dy)
      if (length > 0.2) {
        ballX += (owner.dx / length) * 0.9
        ballY += (owner.dy / length) * 0.9
      }
    }
  }
  ctx.beginPath()
  ctx.ellipse(x(ballX), y(ballY) + 5 * unit, 5 * unit, 2 * unit, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(0,0,0,.35)'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(x(ballX), y(ballY) - ball.height * 4 * unit, (4.5 + ball.height * 0.15) * unit, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.strokeStyle = '#10141a'
  ctx.lineWidth = 1.4 * unit
  ctx.stroke()
}

/**
 * 把“已判好的位置”交给 10 Hz 运动层：每 0.1 秒推进一次，两次 tick 之间插值给屏幕刷新率。
 * 圆点的速度上限、加速度、转向速率都来自球员属性；这里仍然不判定任何比赛结果。
 */
function advanceMotion(now: number, first: boolean): PlaybackSample {
  // 用上一帧画出来的位置解析球权：球必须贴在圆点脚下，而不是引擎坐标。
  const dotsAt = () => view.motion
    ? new Map(view.motion.sample(view.clock.alpha).map((player) => [player.id, player]))
    : null
  const resolverAt = (): PoseResolver | undefined => {
    const dots = dotsAt()
    return dots ? (id, fallback) => dots.get(id) ?? fallback : undefined
  }
  // 先读当前游标，不消费这一帧的时间：下面按 tick 逐步推进，每个 tick 都有自己的目标。
  const sample = view.playback!.recompute(resolverAt())
  const profiles = motionProfiles(view.roster)
  if (!view.motion || first) {
    view.motion = new MotionField(profiles, sample.players)
    view.motionAt = now
    view.clock.reset()
    return view.playback!.sample(now, resolverAt())
  }
  view.motion.setProfiles(profiles)
  for (const player of sample.players) view.motion.ensure(profiles, player)
  // 只有开球/中场这种真正的“切镜头”才对齐；角球、任意球、界外球现在会跑过去。
  const restartKey = sample.restart === 'kickoff' ? `${sample.step}:${sample.restart}` : ''
  if (restartKey && restartKey !== view.motionRestart) {
    view.motionRestart = restartKey
    view.motion.reset(sample.players)
    view.clock.reset()
    const synced = view.playback!.sample(now, resolverAt())
    return { ...synced, players: synced.players }
  }
  if (!sample.restart) view.motionRestart = ''
  // 断线补帧或换人后位置可能整体跳变：差距太大就地对齐，别让圆点横穿球场追过去。
  const current = new Map(view.motion.sample(1).map((player) => [player.id, player]))
  const drift = sample.players.reduce((max, player) => {
    const point = current.get(player.id)
    return point ? Math.max(max, Math.hypot(point.x - player.x, point.y - player.y)) : max
  }, 0)
  if (drift > 12) {
    view.motion.reset(sample.players)
    view.clock.reset()
    const synced = view.playback!.sample(now, resolverAt())
    return { ...synced, players: synced.players }
  }
  const dt = Math.max(0, Math.min(0.5, (now - view.motionAt) / 1000))
  view.motionAt = now
  const live = ui.matchEngine ? isLive(ui.matchEngine) : false
  // 按“比赛时间”推进：播放倍速越高，一帧里要走的 tick 越多，球员才不会一步瞬移。
  view.playbackRate = view.playback?.rate() ?? 0
  const rate = live ? view.playbackRate : 0
  const ticks = live ? view.clock.add(dt, rate) : 0
  let last = sample
  if (ticks > 0) {
    // 一个渲染帧里补多个 tick 时，必须每个 tick 重新采样目标；
    // 重复喂同一个坐标会用同一段位移估算目标速度，跑起来一顿一顿。
    const stepMs = (dt * 1000) / ticks
    for (let index = 0; index < ticks; index++) {
      last = view.playback!.advanceBy(stepMs)
      view.motion.tick(new Map(last.players.map((player) => [player.id, player])))
    }
    last = view.playback!.recompute(resolverAt())
  } else {
    last = view.playback!.sample(now)
  }
  const alpha = view.clock.alpha
  const moved = new Map(view.motion.sample(alpha).map((player) => [player.id, player]))
  return {
    ...last,
    players: last.players.map((player) => {
      const point = moved.get(player.id)
      return point ? { ...player, x: point.x, y: point.y } : player
    }),
  }
}

function loop(): void {
  view.frame = null
  const canvas = document.getElementById('pitch') as HTMLCanvasElement | null
  const engine = ui.matchEngine
  if (!canvas || !engine || isPesEngine(engine) || !view.playback) return
  drawFrame(canvas, engine, advanceMotion(performance.now(), false))
  if (isLive(engine) && view.playback.pending) view.frame = window.requestAnimationFrame(loop)
}

/**
 * 友谊赛先在隔离副本上算出剩余赛程，展示层据此编排跑位；教练调整后废弃旧预演。
 * 联赛只接收服务器提交的轨迹，不在浏览器预演、暴露未来赛果。
 * 新数据入队，绝不从“上一帧画到一半的位置”重启飞球。
 */
export function drawPitch(): void {
  const canvas = document.getElementById('pitch') as HTMLCanvasElement | null
  const engine = ui.matchEngine
  if (!canvas || !engine) return
  // 新引擎（pes2d 物理比赛）有自己的画法：连续运动、球的高度，不走下面的动作队列
  if (isPesEngine(engine)) {
    drawPesPitch(canvas, engine, matchKits(pesViewEngine(engine)))
    return
  }
  const now = performance.now()
  const state = engine.state
  const key = `${game.activeMatch?.startedAt}|${state.seed}|${state.teams.map((team) => team.id).join('|')}`
  const isLeague = !!game.activeMatch?.context.isLeague
  const planKey = JSON.stringify([state.instructions, state.teams.map((team) => [team.mentality, team.tactics])])
  const first = key !== view.key || !view.playback || state.step < view.step
  // 教练只改变未来计划。已确认的传射仍须播完，不能因同一步调整而跳到引擎终点。
  if (first || reducedMotion()) {
    resetPitchView()
    view.key = key
    view.playback = new MatchPlayback(capturePlaybackPose(state), state.step, now)
    // 重新进入比赛时只播之后确认的轨迹，不把缓冲区里的旧帧重放一遍。
    view.seq = state.playbackFrames?.at(-1)?.seq ?? state.step
  }
  view.roster = new Map(state.teams.flatMap((team) => [...team.players, ...team.bench].map((player, index) => [player.id, {
    ...player, number: Number.isFinite(player.number) && player.number > 0 ? player.number : index + 1,
  }] as const)))
  if (!isLeague && !reducedMotion() && (first || view.planKey !== planKey)) {
    // 仅预计算位置脚本；原引擎的随机数、事件、体能和统计均不改变。
    view.playback!.setPlan(planMatchReplay(engine).frames)
  }
  view.planKey = planKey
  view.playback!.setPlaying(isLive(engine), now)
  if (!first && !reducedMotion()) {
    const keyOf = (frame: MatchPlaybackFrame) => frame.seq ?? frame.step
    const recorded = state.playbackFrames ?? []
    const frames = recorded.filter((frame) => keyOf(frame) > view.seq)
    if (frames.length) {
      view.playback!.enqueue(frames, (frame) => {
        const seconds = Math.max(0, frame.to.clock - frame.from.clock)
        if (isLeague) return leagueTweenMs(seconds, state.durationSeconds)
        // v3 子帧是动作内部的 0.2 秒片段，不能套“一步至少 0.3×倍速”的下限。
        if (frame.substep) return Math.max(20, (seconds / 4.1) * ui.matchSpeed)
        return friendlyStepMs(seconds, ui.matchSpeed)
      }, now)
      view.seq = Math.max(view.seq, ...frames.map(keyOf))
    } else if (!recorded.length && state.step > view.step) {
      // 没开轨迹的旧存档/录像：仍按一步一帧兜底。
      const frame: MatchPlaybackFrame = {
        step: state.step,
        from: view.pose ?? capturePlaybackPose(state),
        to: capturePlaybackPose(state),
        motion: state.ballMotion,
      }
      view.playback!.enqueue([frame], (item) => friendlyStepMs(item.to.clock - item.from.clock, ui.matchSpeed), now)
      view.seq = state.step
    }
  }
  view.step = state.step
  view.pose = capturePlaybackPose(state)
  drawFrame(canvas, engine, advanceMotion(now, first))
  if (view.frame === null && isLive(engine) && view.playback!.pending) view.frame = window.requestAnimationFrame(loop)
}

/** 当前运动层的画面状态（位置与速度），给冒烟测试和排查用。 */
export function pitchMotionSnapshot(): { id: string; x: number; y: number; speed: number }[] {
  return isPesEngine(ui.matchEngine) ? pesMotionSnapshot() : view.motion?.sample(1) ?? []
}

/** 已经推进了多少个 10 Hz 运动 tick；给冒烟测试和性能检查用。 */
export function pitchMotionTicks(): number {
  return isPesEngine(ui.matchEngine) ? pesFrameCount() : view.motion?.ticks ?? 0
}

/** 最后一次射门/终场动作播完后再进入赛后页。 */
export function pitchPlaybackPending(): boolean {
  return view.playback?.pending ?? false
}

/** 离开比赛或换一场时清空，避免下一场从上一场的位置滑入。 */
export function resetPitchView(): void {
  resetPesView()
  if (view.frame !== null) window.cancelAnimationFrame(view.frame)
  view.frame = null
  view.playback = null
  view.pose = null
  view.key = ''
  view.planKey = ''
  view.step = -1
  view.seq = 0
  view.motion = null
  view.motionAt = 0
  view.clock.reset()
  view.motionRestart = ''
  view.roster.clear()
}
