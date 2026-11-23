/**
 * 新引擎的球场（docs/pes2d-migration-plan.md，路线 C）：直接画 pes2d 的物理比赛。
 *
 * 和旧的 v3 画法最大的区别：
 *   - 不再有“动作队列 + 10 Hz 圆点追目标”。球员和球的位置就是物理比赛每一步（1/60 秒）算出来的，
 *     球员有加速度、转向、体力，球有滚动、飞行高度和落地弹跳，画面每帧直接读它们；
 *   - 友谊赛：画面循环按“速度档”推进比赛，本地引擎就是画面引擎；
 *   - 联赛：浏览器里另有一份画面引擎，从权威存档复制出来，按现实时钟追赶比赛时间（看不到未来的事件）。
 *     教练换人 / 改战术、断线重连这些让两份引擎对不上的时候，画面引擎重新从权威存档复制一份。
 *
 * 这里不判定任何比赛结果；只读状态、画图、推进到“该播到的时刻”。
 */
import { displayClock, LEAGUE_REALTIME_SECONDS } from '../game/match/time.ts'
import { SHOUT_META, SHOUT_MOOD_META } from '../game/match/shouts.ts'
import { convexHull } from '../game/match/visualization.ts'
import { PesEngine, type GameEngine } from '../game/pes/engine.ts'
import type { PesMatch } from '../game/pes/sim.ts'
import type { PesPlayer, PitchSpec, RestartType } from '../game/pes/spec.ts'
import { leagueMatchClock } from '../game/realtime.ts'
import type { MatchLogEntry } from '../game/types.ts'
import { inkOn } from './components.ts'
import { clockText, shortName } from './format.ts'
import { game, ui } from './state.ts'

const fonts = 'Bahnschrift, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
const GOALKEEPER_FILL = '#f4f6f8'

export interface PesViewHooks {
  /** 整页重绘：比分、文字直播、数据条都在 HTML 里 */
  refresh(): void
  /** 友谊赛踢完了，该进入赛后页 */
  finished(): void
  /** 友谊赛进行中定期存档（受伤记录、断线续赛） */
  save(engine: GameEngine): void
}

let hooks: PesViewHooks | null = null

export function setPesViewHooks(next: PesViewHooks): void {
  hooks = next
}

/** 友谊赛播放速度：每现实秒推进多少模拟秒。三档对应以前一场约 14 / 9 / 5 分钟（含死球时间）。 */
const FRIENDLY_RATE: Record<number, number> = { 4000: 1.15, 2700: 1.7, 1350: 3.4 }
/** 一帧里最多推进多少个物理步，防止切回标签页后一次算太久。 */
const MAX_STEPS_PER_FRAME = 600
/** 联赛画面落后现实时钟超过这么多模拟秒（比如标签页挂在后台），直接复制权威存档，不逐帧追。 */
const RESYNC_LAG = 20
const BANNER_MS = 2600

const RESTART_LABEL: Record<RestartType, string> = {
  kickoff: '开球',
  throwin: '界外球',
  corner: '角球',
  goalkick: '球门球',
  fk: '任意球',
  penalty: '点球',
}

interface Banner {
  text: string
  tone: 'goal' | 'yellow' | 'red' | 'whistle' | 'shout'
  since: number
  until: number
}

interface ShoutBubble {
  playerId: string
  icon: string
  label: string
  color: string
  since: number
  until: number
}

interface PitchFx {
  x: number
  y: number
  color: string
  r0: number
  r1: number
  alpha: number
  width: number
  since: number
  dur: number
}

const pv = {
  key: '',
  /** 画面推进、绘制的那份引擎：友谊赛 = ui.matchEngine 本身，联赛 = 私有副本 */
  sim: null as PesEngine | null,
  owned: false,
  /** 上一次和哪份权威存档核对过（引擎对象 + 指令数 + 事件数），没变就不用再核对 */
  authRef: null as PesEngine | null,
  authSig: '',
  liveShoutsSig: '',
  frame: null as number | null,
  last: 0,
  /** 不足一个物理步的零头 */
  acc: 0,
  logSeen: 0,
  eventSeen: 0,
  scoreKey: '',
  refreshAt: 0,
  saveAt: 0,
  paintAt: 0,
  endAt: 0,
  banner: null as Banner | null,
  bubbles: [] as ShoutBubble[],
  fx: [] as PitchFx[],
  trail: [] as { x: number; y: number; at: number }[],
  ground: null as HTMLCanvasElement | null,
  groundKey: '',
  kits: { home: '#4f9dff', away: '#ff5a5f' },
  frames: 0,
}

export function isPesEngine(engine: GameEngine | null | undefined): engine is PesEngine {
  return !!engine && engine.ruleSet === 'pes'
}

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/** 比赛正在走：联赛一直走，友谊赛没暂停就走。 */
function isLive(): boolean {
  return ui.screen === 'match' && (!!game.activeMatch?.context.isLeague || !!game.activeMatch?.preplayed || ui.matchPlaying)
}

function keyOf(engine: PesEngine): string {
  return `${game.activeMatch?.startedAt}|${engine.state.seed}|${engine.state.teams.map((team) => team.id).join('|')}`
}

function clearView(): void {
  if (pv.frame !== null) window.cancelAnimationFrame(pv.frame)
  pv.frame = null
  pv.sim = null
  pv.owned = false
  pv.authRef = null
  pv.authSig = ''
  pv.liveShoutsSig = ''
  pv.last = 0
  pv.acc = 0
  pv.logSeen = 0
  pv.eventSeen = 0
  pv.scoreKey = ''
  pv.refreshAt = 0
  pv.saveAt = 0
  pv.endAt = 0
  pv.banner = null
  pv.bubbles = []
  pv.fx = []
  pv.trail = []
}

/** 离开比赛或换一场时清空。 */
export function resetPesView(): void {
  clearView()
  pv.key = ''
}

/**
 * 比赛页 HTML 应该读哪份引擎：联赛里取画面引擎和权威存档中“事件较少”的那份——
 * 比分和文字直播既不会比球场上的动作早到（画面引擎落后时读它），也不会出现还没被权威存档确认的事件（画面引擎领先时读权威存档）。
 */
export function pesViewEngine(engine: GameEngine): GameEngine {
  if (!isPesEngine(engine) || !pv.owned || !pv.sim || pv.key !== keyOf(engine)) return engine
  // 服务器预先算好的直播回放：权威存档永远停在开球那一刻，画面引擎本来就不会比现实时钟快，直接读它。
  if (game.activeMatch?.preplayed) return pv.sim
  return pv.sim.game.match.events.length <= engine.game.match.events.length ? pv.sim : engine
}

/** 球场正在推进 / 绘制的那份引擎（排查和测试用）。 */
export function pesDisplayEngine(): PesEngine | null {
  return pv.sim
}

/** 教练的手动指令数；自动换人、比赛计划阶段与 AI 教练调整都由比赛时钟/比分确定性触发，画面引擎自己会走到同一刻，不算。 */
function commandCount(engine: PesEngine): number {
  return engine.state.instructions.filter((item) => !item.autoReason).length
}

/**
 * 画面引擎和权威存档在“已经发生的部分”必须一致：指令数相同，事件流的末尾几条（类型、时刻、球员）逐条相同。
 * 不一致就是教练刚做了调整、断线重连，或者浏览器和服务器的浮点实现不同导致比赛分叉——这时重新从权威存档复制。
 */
function inSync(view: PesEngine, auth: PesEngine): boolean {
  if (commandCount(view) !== commandCount(auth)) return false
  const a = view.game.match.events
  const b = auth.game.match.events
  const n = Math.min(a.length, b.length)
  for (let index = Math.max(0, n - 4); index < n; index++) {
    if (a[index].type !== b[index].type || a[index].t !== b[index].t || a[index].actors.join() !== b[index].actors.join()) return false
  }
  return true
}

function copyOf(engine: PesEngine): PesEngine {
  const copy = PesEngine.restore(engine.serialize())
  const liveShouts = game.activeMatch?.liveShouts
  if (game.activeMatch?.preplayed && liveShouts?.length) {
    copy.scheduleShouts(liveShouts)
    pv.liveShoutsSig = liveShouts.map((item) => item.id).join(',')
  } else {
    pv.liveShoutsSig = ''
  }
  pv.logSeen = copy.state.log.length
  pv.eventSeen = copy.game.match.events.length
  pv.bubbles = []
  pv.fx = []
  pv.acc = 0
  return copy
}

/** 取得这一帧要画的引擎。 */
function prepare(engine: PesEngine): PesEngine {
  const key = keyOf(engine)
  if (pv.key !== key) {
    clearView()
    pv.key = key
  }
  if (!game.activeMatch?.context.isLeague && !game.activeMatch?.preplayed) {
    // 第一次接手这场比赛：已有的文字直播不再弹横幅
    if (!pv.sim) {
      pv.logSeen = engine.state.log.length
      pv.eventSeen = engine.game.match.events.length
    }
    pv.sim = engine
    pv.owned = false
    return engine
  }
  if (game.activeMatch?.preplayed) {
    // 联机预模拟直播：engine 始终是开球初始快照，不能拿 commandCount 跟已推进的 pv.sim 比较，否则每次 SSE 都会重置画面。
    if (!pv.sim || !pv.owned) {
      pv.sim = copyOf(engine)
      pv.owned = true
    } else {
      // 联机直播中途收到新喊话：若生效时钟尚未越过当前画面时刻，直接无缝注入，不倒带不跳帧。
      const liveShouts = game.activeMatch.liveShouts ?? []
      const nextSig = liveShouts.map((item) => item.id).join(',')
      if (nextSig !== pv.liveShoutsSig) {
        const known = new Set((pv.sim.state.scheduledShouts ?? []).map((item) => item.id))
        const added = liveShouts.filter((item) => !known.has(item.id))
        const nowClock = Math.floor(pv.sim.game.match.time)
        if (added.every((item) => item.atClock >= nowClock)) {
          pv.sim.scheduleShouts(liveShouts)
          pv.liveShoutsSig = nextSig
        } else {
          const resumeTo = pv.sim.game.match.time
          pv.sim = copyOf(engine)
          pv.sim.advanceTo(resumeTo)
          pv.logSeen = pv.sim.state.log.length
          pv.eventSeen = pv.sim.game.match.events.length
        }
      }
    }
    pv.authRef = engine
    pv.authSig = pv.liveShoutsSig
    return pv.sim!
  }
  const sig = `${commandCount(engine)}:${engine.game.match.events.length}`
  if (!pv.sim || !pv.owned || ((pv.authRef !== engine || pv.authSig !== sig) && !inSync(pv.sim, engine))) {
    pv.sim = copyOf(engine)
    pv.owned = true
  }
  pv.authRef = engine
  pv.authSig = sig
  return pv.sim!
}

/** 友谊赛：按速度档推进。 */
function advanceFriendly(sim: PesEngine, dt: number): void {
  const g = sim.game
  const rate = FRIENDLY_RATE[ui.matchSpeed] ?? 1.7
  pv.acc += (dt * rate) / g.match.spec.DT
  let steps = Math.floor(pv.acc)
  pv.acc -= steps
  if (steps > MAX_STEPS_PER_FRAME) steps = MAX_STEPS_PER_FRAME
  for (let index = 0; index < steps && !g.finished; index++) g.step()
}

/**
 * 联赛：追现实时钟对应的比赛时刻，绝不超过它。
 * 死球（界外、角球、中圈开球）期间比赛时钟不走，球员却要走到位，所以落后的时候适当加快，
 * 这样画面不会越落越远；追上之后回到正常速度。
 */
function advanceLeague(sim: PesEngine, dt: number): void {
  const active = game.activeMatch
  if (!active) return
  const g = sim.game
  const m = g.match
  const target = leagueMatchClock(active)
  const lag = target - m.time
  // 预先算好的回放：中途打开页面、切回标签页时落后很多，一口气算到现在这一刻（整场约 1 秒），
  // 不再用 5 倍速在画面上快进；已经发生的进球、红黄牌也不再弹横幅。
  if (active.preplayed && lag > RESYNC_LAG) {
    sim.advanceTo(target)
    pv.acc = 0
    pv.logSeen = sim.state.log.length
    pv.eventSeen = sim.game.match.events.length
    pv.fx = []
    return
  }
  // 落后太多且权威存档确实走在前面：直接复制。权威存档也落后（断线、没更新）时复制没有意义，照常加速追
  const auth = ui.matchEngine
  if (lag > RESYNC_LAG && isPesEngine(auth) && auth.game.match.time > m.time + RESYNC_LAG / 2) {
    pv.sim = copyOf(auth)
    return
  }
  chase(sim, dt, target)
}

/**
 * 把画面引擎追到比赛时刻 target，绝不超过它；speed 是回放倍速（联赛直播固定 1）。
 * 死球期间比赛时钟不走，球员却要走到位，所以落后时适当加快，追上之后回到正常速度。
 */
function chase(sim: PesEngine, dt: number, target: number, speed = 1): void {
  const g = sim.game
  const m = g.match
  const lag = target - m.time
  const base = (sim.state.durationSeconds / LEAGUE_REALTIME_SECONDS) * speed
  const boost = Math.min(5, (m.phase === 'play' ? 1 : 1.35) * (1 + 0.25 * Math.max(0, Math.min(8, lag))))
  pv.acc += (dt * base * boost) / m.spec.DT
  let steps = Math.floor(pv.acc)
  pv.acc -= steps
  if (steps > MAX_STEPS_PER_FRAME) steps = MAX_STEPS_PER_FRAME
  for (let index = 0; index < steps && !g.finished; index++) {
    // The clock stays capped while a pre-whistle shot finishes. Keep animating
    // that flight at the cap, but never advance into play beyond the wall clock.
    const closingHalf = target >= m.time && m.time >= m.spec.HALF * m.half
    if (m.phase === 'play' && m.time >= target && !closingHalf) break
    g.step()
  }
}

function bannerOf(entry: MatchLogEntry): Pick<Banner, 'text' | 'tone'> | null {
  switch (entry.type) {
    case 'goal': return { text: `⚽ ${entry.text}`, tone: 'goal' }
    case 'foul': return entry.card ? { text: entry.text, tone: entry.card === 'yellow' ? 'yellow' : 'red' } : null
    case 'shout': {
      const label = entry.shout ? SHOUT_META[entry.shout.kind]?.label : '喊话'
      const who = entry.shout?.targetName ? `→ ${entry.shout.targetName}` : '全队'
      return { text: `📢 场边喊话「${label}」（${who}）`, tone: 'shout' }
    }
    case 'half':
    case 'full': return { text: entry.text, tone: 'whistle' }
    default: return null
  }
}

/** 看一眼新出现的文字直播与动作事件，决定弹横幅和球场视觉反馈；返回文字直播有没有新条目。 */
function noteEvents(sim: PesEngine, now: number): boolean {
  const log = sim.state.log
  const grew = log.length > pv.logSeen
  for (; pv.logSeen < log.length; pv.logSeen++) {
    const entry = log[pv.logSeen]
    const banner = bannerOf(entry)
    if (banner) pv.banner = { ...banner, since: now, until: now + BANNER_MS }
    if (entry.type === 'shout' && entry.shout?.reactions?.length) {
      for (const reaction of entry.shout.reactions) {
        const meta = SHOUT_MOOD_META[reaction.mood]
        pv.bubbles = pv.bubbles.filter((item) => item.playerId !== reaction.playerId)
        pv.bubbles.push({
          playerId: reaction.playerId,
          icon: meta.icon,
          label: meta.shortLabel,
          color: meta.bubbleColor,
          since: now,
          until: now + 3800,
        })
      }
    }
  }
  const m = sim.game.match
  const evs = m.events
  if (evs.length < pv.eventSeen) {
    pv.eventSeen = evs.length
    pv.fx = []
  } else if (evs.length - pv.eventSeen > 12) {
    pv.eventSeen = evs.length
  } else {
    for (; pv.eventSeen < evs.length; pv.eventSeen++) {
      const ev = evs[pv.eventSeen]
      const a0 = ev.actors[0] !== undefined ? m.players[ev.actors[0]] : undefined
      const a1 = ev.actors[1] !== undefined ? m.players[ev.actors[1]] : undefined
      if (ev.type === 'shot') {
        const isBlock = ev.meta?.result === 'block'
        const blk = isBlock && typeof ev.meta?.blocker === 'number' ? m.players[ev.meta.blocker] : undefined
        const pt = blk?.pos ?? a0?.pos ?? m.ball
        pv.fx.push(isBlock
          ? { x: pt.x, y: pt.y, color: '#ffae42', r0: 0.5, r1: 2.4, alpha: 0.78, width: 2.2, since: now, dur: 340 }
          : { x: pt.x, y: pt.y, color: '#ffe894', r0: 0.5, r1: 2.2, alpha: 0.72, width: 2.0, since: now, dur: 280 })
      } else if (ev.type === 'save') {
        const pt = a0?.pos ?? m.ball
        pv.fx.push({ x: pt.x, y: pt.y, color: '#78e3ff', r0: 0.7, r1: 3.3, alpha: 0.85, width: 2.4, since: now, dur: 420 })
      } else if (ev.type === 'tackle') {
        const x = a0 && a1 ? (a0.pos.x + a1.pos.x) / 2 : (a0?.pos.x ?? m.ball.x)
        const y = a0 && a1 ? (a0.pos.y + a1.pos.y) / 2 : (a0?.pos.y ?? m.ball.y)
        pv.fx.push({ x, y, color: '#ffd166', r0: 0.45, r1: 2.3, alpha: 0.75, width: 2.0, since: now, dur: 320 })
      } else if (ev.type === 'foul') {
        const x = typeof ev.meta?.x === 'number' ? ev.meta.x : (a1?.pos.x ?? a0?.pos.x ?? m.ball.x)
        const y = typeof ev.meta?.y === 'number' ? ev.meta.y : (a1?.pos.y ?? a0?.pos.y ?? m.ball.y)
        pv.fx.push({ x, y, color: '#f26d6a', r0: 0.6, r1: 3.0, alpha: 0.82, width: 2.2, since: now, dur: 460 })
      } else if (ev.type === 'pass' && a0) {
        pv.fx.push({ x: a0.pos.x, y: a0.pos.y, color: '#ffffff', r0: 0.4, r1: 1.45, alpha: 0.30, width: 1.3, since: now, dur: 200 })
      }
    }
    if (pv.fx.length > 24) pv.fx.splice(0, pv.fx.length - 24)
  }
  return grew
}

/* ------------------------------ 绘制 ------------------------------ */

function drawGround(ctx: CanvasRenderingContext2D, w: number, h: number, P: PitchSpec, s: number): void {
  const X = (x: number) => w / 2 + x * s
  const Y = (y: number) => h / 2 + y * s
  const grass = ctx.createLinearGradient(0, 0, 0, h)
  grass.addColorStop(0, '#15502f')
  grass.addColorStop(1, '#0d3a26')
  ctx.fillStyle = grass
  ctx.fillRect(0, 0, w, h)
  const stripes = 10
  ctx.fillStyle = 'rgba(255,255,255,0.032)'
  for (let index = 0; index < stripes; index += 2) ctx.fillRect(X(-P.HL + (index * P.L) / stripes), Y(-P.HW), (P.L / stripes) * s, P.W * s)

  ctx.strokeStyle = 'rgba(255,255,255,0.66)'
  ctx.fillStyle = 'rgba(255,255,255,0.66)'
  ctx.lineWidth = Math.max(1.6, s * 0.12)
  ctx.strokeRect(X(-P.HL), Y(-P.HW), P.L * s, P.W * s)
  ctx.beginPath(); ctx.moveTo(X(0), Y(-P.HW)); ctx.lineTo(X(0), Y(P.HW)); ctx.stroke()
  ctx.beginPath(); ctx.arc(X(0), Y(0), P.CIRCLE * s, 0, Math.PI * 2); ctx.stroke()
  ctx.beginPath(); ctx.arc(X(0), Y(0), Math.max(2, s * 0.2), 0, Math.PI * 2); ctx.fill()

  const box6 = P.PEN_D * (5.5 / 16.5)
  const wide6 = P.PEN_W * (18.32 / 40.32)
  const spotDepth = P.PEN_D * (11 / 16.5)
  const arc = Math.acos(Math.min(1, Math.max(-1, (P.PEN_D - spotDepth) / P.CIRCLE)))
  for (const side of [-1, 1]) {
    const gx = side * P.HL
    ctx.strokeRect(X(side > 0 ? gx - P.PEN_D : gx), Y(-P.PEN_W / 2), P.PEN_D * s, P.PEN_W * s)
    ctx.strokeRect(X(side > 0 ? gx - box6 : gx), Y(-wide6 / 2), box6 * s, wide6 * s)
    const spot = gx - side * spotDepth
    ctx.beginPath(); ctx.arc(X(spot), Y(0), Math.max(2, s * 0.18), 0, Math.PI * 2); ctx.fill()
    const mid = side > 0 ? Math.PI : 0
    ctx.beginPath(); ctx.arc(X(spot), Y(0), P.CIRCLE * s, mid - arc, mid + arc); ctx.stroke()
    // 球网在场外，球门线加粗
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'
    ctx.lineWidth = 1
    const depth = 1.7 * s
    for (let index = 0; index <= 6; index++) {
      const yy = Y(-P.GOAL_HALF + (index * P.GOAL_HALF * 2) / 6)
      ctx.beginPath(); ctx.moveTo(X(gx), yy); ctx.lineTo(X(gx) + side * depth, yy); ctx.stroke()
    }
    ctx.beginPath(); ctx.moveTo(X(gx) + side * depth, Y(-P.GOAL_HALF)); ctx.lineTo(X(gx) + side * depth, Y(P.GOAL_HALF)); ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'
    ctx.lineWidth = Math.max(3, s * 0.24)
    ctx.beginPath(); ctx.moveTo(X(gx), Y(-P.GOAL_HALF)); ctx.lineTo(X(gx), Y(P.GOAL_HALF)); ctx.stroke()
    ctx.restore()
    // 球门口的微光，让进攻方向一眼看得出
    const glow = ctx.createRadialGradient(X(gx), Y(0), 2, X(gx), Y(0), s * 8)
    glow.addColorStop(0, 'rgba(255,255,255,0.10)')
    glow.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = glow
    ctx.fillRect(X(gx) - s * 8, Y(0) - s * 8, s * 16, s * 16)
    ctx.fillStyle = 'rgba(255,255,255,0.66)'
  }
  const corner = Math.max(1, s * 0.9)
  for (const [cx, cy, start] of [[-P.HL, -P.HW, 0], [P.HL, -P.HW, Math.PI / 2], [P.HL, P.HW, Math.PI], [-P.HL, P.HW, Math.PI * 1.5]] as [number, number, number][]) {
    ctx.beginPath(); ctx.arc(X(cx), Y(cy), corner, start, start + Math.PI / 2); ctx.stroke()
  }
}

function paintPlayer(
  ctx: CanvasRenderingContext2D,
  p: PesPlayer,
  owner: number,
  px: number,
  py: number,
  face: { x: number; y: number },
  unit: number,
  showNames: boolean,
  diveAngle: number | null = null,
): void {
  const kit = p.ti === 0 ? pv.kits.home : pv.kits.away
  const isGk = p.role === 'GK'
  const fill = isGk ? GOALKEEPER_FILL : kit
  const radius = 12 * unit
  ctx.beginPath()
  if (diveAngle !== null) {
    ctx.ellipse(px, py + radius * 0.75, radius * 1.45, radius * 0.42, diveAngle, 0, Math.PI * 2)
  } else {
    ctx.ellipse(px, py + radius * 0.9, radius * 0.9, radius * 0.34, 0, 0, Math.PI * 2)
  }
  ctx.fillStyle = 'rgba(0,0,0,.3)'
  ctx.fill()
  if (p.pid === owner) {
    ctx.beginPath()
    ctx.arc(px, py, radius + 6 * unit, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,235,120,.92)'
    ctx.lineWidth = 1.8 * unit
    ctx.stroke()
  }
  ctx.beginPath()
  if (diveAngle !== null) {
    ctx.ellipse(px, py, radius * 1.42, radius * 0.80, diveAngle, 0, Math.PI * 2)
  } else {
    ctx.arc(px, py, radius, 0, Math.PI * 2)
  }
  ctx.fillStyle = fill
  ctx.fill()
  ctx.lineWidth = (isGk ? 2 : 1.2) * unit
  ctx.strokeStyle = isGk ? kit : 'rgba(10,14,18,.75)'
  ctx.stroke()
  // 朝向：圆边上的一小段
  const fl = Math.hypot(face.x, face.y)
  if (fl > 0.01) {
    const ux = face.x / fl
    const uy = face.y / fl
    ctx.beginPath()
    ctx.moveTo(px + ux * radius * 0.72, py + uy * radius * 0.72)
    ctx.lineTo(px + ux * (radius + 4 * unit), py + uy * (radius + 4 * unit))
    ctx.strokeStyle = 'rgba(255,255,255,.82)'
    ctx.lineWidth = 2.2 * unit
    ctx.lineCap = 'round'
    ctx.stroke()
    ctx.lineCap = 'butt'
  }
  const stamina = Math.max(0, Math.min(100, p.stamina * 100))
  ctx.beginPath()
  ctx.arc(px, py, radius + 3 * unit, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * stamina) / 100)
  ctx.strokeStyle = stamina > 55 ? 'rgba(160,240,190,.9)' : stamina > 30 ? 'rgba(242,184,75,.95)' : 'rgba(242,112,106,.95)'
  ctx.lineWidth = 1.8 * unit
  ctx.stroke()
  const number = Number.isFinite(p.num) && p.num > 0 ? p.num : p.slot + 1
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
    const label = shortName(p.name)
    ctx.strokeText(label, px, labelY)
    ctx.fillStyle = '#f2f5f7'
    ctx.fillText(label, px, labelY)
  }
}

function drawBanner(ctx: CanvasRenderingContext2D, w: number, unit: number, now: number): void {
  const banner = pv.banner
  if (!banner) return
  if (now >= banner.until) {
    pv.banner = null
    return
  }
  const alpha = Math.min(1, (now - banner.since) / 140, (banner.until - now) / 420)
  const tone = { goal: '#f2b84b', yellow: '#e8c53a', red: '#e5534b', whistle: '#9fb4c7', shout: '#36c97f' }[banner.tone]
  ctx.save()
  ctx.globalAlpha = Math.max(0, alpha)
  ctx.font = `700 ${19 * unit}px ${fonts}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const text = banner.text.length > 44 ? `${banner.text.slice(0, 43)}…` : banner.text
  const width = Math.min(w - 40 * unit, ctx.measureText(text).width + 40 * unit)
  const height = 38 * unit
  const x = w / 2 - width / 2
  const y = 22 * unit
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, 10 * unit)
  ctx.fillStyle = 'rgba(8,14,10,.82)'
  ctx.fill()
  ctx.lineWidth = 2 * unit
  ctx.strokeStyle = tone
  ctx.stroke()
  ctx.fillStyle = '#f6f8fa'
  ctx.fillText(text, w / 2, y + height / 2 + 1)
  ctx.restore()
}

function paint(canvas: HTMLCanvasElement, sim: PesEngine, now: number): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const m: PesMatch = sim.game.match
  const P = m.spec
  const w = canvas.width
  const h = canvas.height
  const pad = 30
  const s = Math.min((w - pad * 2) / P.L, (h - pad * 2) / P.W)
  // 下半场两队换边；画面里主队始终从左往右攻，和比赛里的坐标换算（settle.ts 的 toGame）一致
  const flip = m.teams[0].dir < 0
  const X = (x: number) => w / 2 + (flip ? -x : x) * s
  const Y = (y: number) => h / 2 + (flip ? -y : y) * s
  const unit = canvas.clientWidth > 0 ? w / canvas.clientWidth : 1
  const showNames = canvas.clientWidth >= 520

  const groundKey = `${w}x${h}|${P.L}x${P.W}`
  if (!pv.ground || pv.groundKey !== groundKey) {
    pv.ground = document.createElement('canvas')
    pv.ground.width = w
    pv.ground.height = h
    const layer = pv.ground.getContext('2d')
    if (layer) drawGround(layer, w, h, P, s)
    pv.groundKey = groundKey
  }
  ctx.drawImage(pv.ground, 0, 0)

  // 死球：标出球会在哪里重新开出
  if ((m.phase === 'restart' || m.phase === 'kickoff') && m.restart) {
    const rx = X(m.restart.x)
    const ry = Y(m.restart.y)
    const pulse = 1 + 0.12 * Math.sin(now / 170)
    ctx.beginPath()
    ctx.arc(rx, ry, 11 * unit * pulse, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,235,120,.8)'
    ctx.lineWidth = 2 * unit
    ctx.stroke()
    ctx.font = `600 ${11.5 * unit}px ${fonts}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 3 * unit
    ctx.strokeStyle = 'rgba(8,14,10,.85)'
    const label = RESTART_LABEL[m.restart.type]
    ctx.strokeText(label, rx, ry - 20 * unit)
    ctx.fillStyle = '#ffe98a'
    ctx.fillText(label, rx, ry - 20 * unit)
  }

  if (ui.pitchView === 'tracking') {
    // 战术轨迹：阵型包络 + 速度箭头，只解释已经算好的跑位
    for (const team of m.teams) {
      const color = team.side === 'home' ? pv.kits.home : pv.kits.away
      const hull = convexHull(team.players.filter((p) => p.role !== 'GK').map((p) => ({ x: X(p.pos.x), y: Y(p.pos.y) })))
      if (hull.length < 3) continue
      ctx.beginPath()
      hull.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)))
      ctx.closePath()
      ctx.fillStyle = color
      ctx.globalAlpha = 0.12
      ctx.fill()
      ctx.globalAlpha = 0.45
      ctx.strokeStyle = color
      ctx.lineWidth = 1.2 * unit
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    ctx.strokeStyle = 'rgba(255,255,255,.7)'
    ctx.lineWidth = 1.3 * unit
    for (const team of m.teams) {
      for (const p of team.players) {
        const speed = Math.hypot(p.vel.x, p.vel.y)
        if (speed < 0.8) continue
        const sign = flip ? -1 : 1
        const px = X(p.pos.x)
        const py = Y(p.pos.y)
        const tx = px + sign * p.vel.x * s * 0.42
        const ty = py + sign * p.vel.y * s * 0.42
        const angle = Math.atan2(ty - py, tx - px)
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(tx, ty)
        ctx.moveTo(tx - Math.cos(angle - 0.5) * 5 * unit, ty - Math.sin(angle - 0.5) * 5 * unit)
        ctx.lineTo(tx, ty)
        ctx.lineTo(tx - Math.cos(angle + 0.5) * 5 * unit, ty - Math.sin(angle + 0.5) * 5 * unit)
        ctx.stroke()
      }
    }
  }

  // 动作视觉反馈（传球/射门/扑救/抢断/封堵/犯规涟漪，纯画面演出）
  if (pv.fx.length) {
    pv.fx = pv.fx.filter((fx) => now - fx.since < fx.dur)
    for (const fx of pv.fx) {
      const progress = Math.max(0, Math.min(1, (now - fx.since) / fx.dur))
      const r = (fx.r0 + (fx.r1 - fx.r0) * (1 - (1 - progress) * (1 - progress))) * s
      ctx.save()
      ctx.globalAlpha = fx.alpha * (1 - progress)
      ctx.beginPath()
      ctx.arc(X(fx.x), Y(fx.y), Math.max(2, r), 0, Math.PI * 2)
      ctx.strokeStyle = fx.color
      ctx.lineWidth = fx.width * unit
      ctx.stroke()
      ctx.restore()
    }
  }

  // 球员：按真实物理坐标直接绘制（允许人物自然重叠），先画远端（y 小）再画近端，重叠时靠下的盖在上面
  const sign = flip ? -1 : 1
  const shotFlying = m.ball.meta?.type === 'shot' && !m.ball.frozen && m.ball.owner < 0
  const everyone = m.teams.flatMap((team) => team.players).sort((a, b) => (flip ? -a.pos.y : a.pos.y) - (flip ? -b.pos.y : b.pos.y))
  for (const p of everyone) {
    const gkDive = shotFlying && p.role === 'GK' && Math.hypot(p.vel.x, p.vel.y) > 2.2
      ? Math.atan2(sign * p.vel.y, sign * p.vel.x)
      : null
    paintPlayer(ctx, p, m.ball.owner, X(p.pos.x), Y(p.pos.y), { x: sign * p.facing.x, y: sign * p.facing.y }, unit, showNames, gkDive)
  }

  // 球：落地影子 + 离地高度；快球拖一段尾迹；带球时加轻微推球律动（仅视觉）
  const b = m.ball
  let bwx = b.x
  let bwy = b.y
  if (b.owner >= 0 && !b.frozen) {
    const carrier = m.players[b.owner]
    if (carrier) {
      const bob = Math.hypot(carrier.vel.x, carrier.vel.y) > 0.6
        ? 0.48 + 0.14 * Math.sin(carrier.distance * 3.2)
        : 0.5
      bwx = carrier.pos.x + carrier.facing.x * bob
      bwy = carrier.pos.y + carrier.facing.y * bob
    }
  }
  const bx = X(bwx)
  const lift = Math.min(18 * unit, b.z * s * 0.55)
  const by = Y(bwy)
  const radius = 4.6 * unit * (1 + Math.min(0.5, b.z * 0.08))
  const speed = Math.hypot(b.vx, b.vy)
  if (speed > 5 && !b.frozen) pv.trail.push({ x: bx, y: by - lift, at: now })
  while (pv.trail.length && (now - pv.trail[0].at > 260 || pv.trail.length > 18)) pv.trail.shift()
  if (pv.trail.length > 1) {
    for (let index = 1; index < pv.trail.length; index++) {
      const age = 1 - (now - pv.trail[index].at) / 260
      ctx.beginPath()
      ctx.moveTo(pv.trail[index - 1].x, pv.trail[index - 1].y)
      ctx.lineTo(pv.trail[index].x, pv.trail[index].y)
      ctx.strokeStyle = `rgba(255,255,255,${Math.max(0, age * 0.5)})`
      ctx.lineWidth = radius * 0.9
      ctx.lineCap = 'round'
      ctx.stroke()
    }
    ctx.lineCap = 'butt'
  }
  ctx.beginPath()
  ctx.ellipse(bx, by + radius * 0.55, radius * 0.95, radius * 0.4, 0, 0, Math.PI * 2)
  ctx.fillStyle = `rgba(0,0,0,${Math.max(0.18, 0.4 - b.z * 0.05)})`
  ctx.fill()
  ctx.beginPath()
  ctx.arc(bx, by - lift, radius, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.strokeStyle = '#10141a'
  ctx.lineWidth = 1.4 * unit
  ctx.stroke()

  // 场边喊话头顶情绪气泡（3.8 秒平滑浮起淡出）
  if (pv.bubbles.length) {
    pv.bubbles = pv.bubbles.filter((bubble) => now < bubble.until)
    if (pv.bubbles.length) {
      const byRef = new Map(everyone.map((p) => [p.ref, p]))
      ctx.save()
      ctx.font = `700 ${11 * unit}px ${fonts}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const bubble of pv.bubbles) {
        const p = byRef.get(bubble.playerId)
        if (!p) continue
        const age = now - bubble.since
        const remain = bubble.until - now
        const alpha = Math.min(1, age / 180, remain / 550)
        const rise = Math.min(12 * unit, (age / 3800) * 14 * unit)
        const bxPos = X(p.pos.x)
        const byPos = Y(p.pos.y) - 24 * unit - rise
        const text = `${bubble.icon} ${bubble.label}`
        const bw = ctx.measureText(text).width + 12 * unit
        const bh = 20 * unit
        ctx.globalAlpha = Math.max(0, alpha)
        ctx.beginPath()
        ctx.roundRect(bxPos - bw / 2, byPos - bh / 2, bw, bh, 9 * unit)
        ctx.fillStyle = 'rgba(10,16,20,.88)'
        ctx.fill()
        ctx.lineWidth = 1.5 * unit
        ctx.strokeStyle = bubble.color
        ctx.stroke()
        ctx.fillStyle = '#f5f8fa'
        ctx.fillText(text, bxPos, byPos + 0.5)
      }
      ctx.restore()
    }
  }

  drawBanner(ctx, w, unit, now)
  pv.frames++
}

/* ------------------------------ 循环 ------------------------------ */

function frame(now: number): void {
  pv.frame = null
  const canvas = document.getElementById('pitch') as HTMLCanvasElement | null
  const engine = ui.matchEngine
  if (!canvas || !isPesEngine(engine) || ui.screen !== 'match') {
    pv.last = 0
    return
  }
  const isLeague = !!game.activeMatch?.context.isLeague || !!game.activeMatch?.preplayed
  let sim = prepare(engine)
  const dt = pv.last ? Math.min(0.1, Math.max(0, (now - pv.last) / 1000)) : 0
  pv.last = now
  const live = isLive()
  if (live && !sim.state.finished) {
    if (isLeague) advanceLeague(sim, dt)
    else advanceFriendly(sim, dt)
    sim = pv.sim ?? sim
  }
  const grew = noteEvents(sim, now)
  // 减少动态效果：画面降到 4 帧每秒，比赛仍照常推进
  if (!reducedMotion() || now - pv.paintAt > 250) {
    pv.paintAt = now
    paint(canvas, sim, now)
  }

  const clock = document.querySelector<HTMLElement>('[data-pes-clock]')
  if (clock) clock.textContent = clockText(displayClock(sim.game.match.time, sim.state.durationSeconds))

  if (!isLeague && hooks) {
    const scoreKey = `${sim.state.score.home}:${sim.state.score.away}`
    const changed = grew || scoreKey !== pv.scoreKey
    pv.scoreKey = scoreKey
    if (!pv.saveAt) pv.saveAt = now
    if (live && now - pv.saveAt > 4000) {
      pv.saveAt = now
      hooks.save(sim)
    }
    if (sim.state.finished) {
      if (!pv.endAt) pv.endAt = now
      if (now - pv.endAt > 1800 && !ui.completing) {
        ui.matchPlaying = false
        hooks.finished()
        return
      }
    }
    if ((changed && now - pv.refreshAt > 450) || now - pv.refreshAt > 2000) {
      pv.refreshAt = now
      hooks.refresh()
    }
  } else if (isLeague && hooks && grew && now - pv.refreshAt > 600) {
    pv.refreshAt = now
    hooks.refresh()
  }
  if (pv.frame === null && (isLive() || pv.banner || pv.bubbles.length > 0)) pv.frame = window.requestAnimationFrame(frame)
}

/** 画一帧；比赛在走的话顺带保证循环在跑。 */
export function drawPesPitch(canvas: HTMLCanvasElement, engine: PesEngine, kits: { home: string; away: string }): void {
  pv.kits = kits
  const sim = prepare(engine)
  paint(canvas, sim, performance.now())
  if (pv.frame === null && (isLive() || pv.banner)) pv.frame = window.requestAnimationFrame(frame)
}

/** 当前画面里每名球员的位置与速度，给冒烟测试和排查用。 */
export function pesMotionSnapshot(): { id: string; x: number; y: number; speed: number }[] {
  const m = pv.sim?.game.match
  if (!m) return []
  return m.teams.flatMap((team) => team.players.map((p) => ({ id: p.ref || String(p.pid), x: p.pos.x, y: p.pos.y, speed: Math.hypot(p.vel.x, p.vel.y) })))
}

/** 已经画了多少帧。 */
export function pesFrameCount(): number {
  return pv.frames
}

/* ------------------------------ 赛后 2D 重看 ------------------------------ */

/**
 * 复盘页的 2D 重看用自己的一份引擎，画面状态（球迹、进球横幅）借用同一套；
 * 复盘页和比赛页不会同时出现，进出时都会重置。
 */
export function chaseReplayClock(sim: PesEngine, dt: number, target: number, speed: number): void {
  chase(sim, dt, target, speed)
}

export function paintReplay(canvas: HTMLCanvasElement, sim: PesEngine, kits: { home: string; away: string }, now: number): void {
  pv.kits = kits
  noteEvents(sim, now)
  paint(canvas, sim, now)
}

/** 换了引擎或跳转之后：已经发生的进球不再弹横幅，球迹清空。 */
export function resetReplayPaint(sim: PesEngine | null): void {
  clearView()
  pv.key = ''
  pv.logSeen = sim?.state.log.length ?? 0
  pv.eventSeen = sim?.game.match.events.length ?? 0
}

/** 当前横幅还在显示吗（循环要等它消失才停）。 */
export function replayBannerActive(now: number): boolean {
  return !!pv.banner && now < pv.banner.until
}
