/**
 * 复盘页的 2D 重看（联机联赛）。
 *
 * 服务器留着每场有教练比赛开球时的引擎初始状态；这里取回来，在浏览器里从头回放整场：
 * 同一份种子和输入，比分和公布的结果一致。回放可以暂停、调速、拖进度条（往回拖就从头重算到那一刻，
 * 整场约 1 秒）、重新开始。这里不判定任何结果，只推进和绘制。
 */
import type { CommentaryEntry, MatchRecord } from '../game/types.ts'
import type { MatchState } from '../game/match/types.ts'
import { PesEngine } from '../game/pes/engine.ts'
import { displayClock, LEAGUE_REALTIME_SECONDS, MATCH_DISPLAY_SECONDS } from '../game/match/time.ts'
import { PLAYER_TEAM_ID } from '../game/season.ts'
import { fetchMatchReplay } from '../online.ts'
import { chaseReplayClock, paintReplay, replayBannerActive, resetReplayPaint } from './pes-pitch.ts'
import { clubLook, crest, distinctKit, icon, panel } from './components.ts'
import { clockText, esc } from './format.ts'
import { ui } from './state.ts'

export const REPLAY_SPEEDS = [1, 2, 4, 8] as const
/** 文字直播里同时显示最近几条。 */
const FEED_LINES = 8

type ReplayHooks = {
  /** 整页重绘（按钮文字、载入完成）。 */
  refresh(): void
  /** 把最近的文字直播渲染成 HTML（复用复盘页的行样式）。 */
  feed(entries: CommentaryEntry[], durationSeconds: number): string
}
let hooks: ReplayHooks | null = null
export function setReplay2DHooks(next: ReplayHooks): void {
  hooks = next
}

export const replay2d = {
  /** 正在看的战报 id；空表示没有打开。 */
  id: '',
  status: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
  error: '',
  initial: null as MatchState | null,
  sim: null as PesEngine | null,
  duration: 900,
  playing: false,
  speed: 1 as number,
  /** 回放要追到的比赛时刻（逻辑秒）。 */
  target: 0,
  frame: null as number | null,
  last: 0,
  /** 正在拖进度条：别用播放进度覆盖滑块。 */
  scrubbing: false,
  kits: { home: '#4f9dff', away: '#ff5a5f' },
  feedCount: -1,
}

function kitsOf(record: MatchRecord): { home: string; away: string } {
  const home = clubLook(record.homeId).color
  const away = clubLook(record.awayId).color
  // 自己的球队用俱乐部主色，对手撞色时换备用色（和比赛页一致）。
  return record.homeId === PLAYER_TEAM_ID ? { home, away: distinctKit(away, home) } : { home: distinctKit(home, away), away }
}

function stopLoop(): void {
  if (replay2d.frame !== null) window.cancelAnimationFrame(replay2d.frame)
  replay2d.frame = null
  replay2d.last = 0
}

/** 离开复盘页或换了一场：丢掉引擎，停掉循环。 */
export function resetReplay2D(): void {
  stopLoop()
  replay2d.id = ''
  replay2d.status = 'idle'
  replay2d.error = ''
  replay2d.initial = null
  replay2d.sim = null
  replay2d.playing = false
  replay2d.target = 0
  replay2d.scrubbing = false
  replay2d.feedCount = -1
  resetReplayPaint(null)
}

/** 复盘页打开某场战报时调用：有 2D 回放就去取，没有就清掉上一场的。 */
export function ensureReplay2D(record: MatchRecord | undefined): void {
  if (!record?.hasReplay) {
    if (replay2d.id) resetReplay2D()
    return
  }
  if (replay2d.id === record.id) return
  resetReplay2D()
  replay2d.id = record.id
  replay2d.status = 'loading'
  const id = record.id
  fetchMatchReplay(id).then((data) => {
    if (replay2d.id !== id) return
    replay2d.initial = data.engineState as MatchState
    replay2d.duration = data.durationSeconds
    replay2d.sim = PesEngine.restore(replay2d.initial)
    replay2d.kits = kitsOf(record)
    replay2d.status = 'ready'
    resetReplayPaint(replay2d.sim)
    hooks?.refresh()
  }).catch((error) => {
    if (replay2d.id !== id) return
    replay2d.status = 'error'
    replay2d.error = error instanceof Error ? error.message : '载入失败'
    hooks?.refresh()
  })
}

const displayOf = (sim: PesEngine): number => displayClock(sim.game.match.time, replay2d.duration)

/** 只更新会随播放变化的几处：比分、时钟、进度条、文字直播。整页重绘留给点按钮的时候。 */
function syncDom(sim: PesEngine): void {
  const score = document.querySelector<HTMLElement>('[data-rp-score]')
  if (score) score.textContent = `${sim.state.score.home} : ${sim.state.score.away}`
  const clock = document.querySelector<HTMLElement>('[data-rp-clock]')
  if (clock) clock.textContent = clockText(displayOf(sim))
  const seek = document.querySelector<HTMLInputElement>('[data-rp-seek]')
  if (seek && !replay2d.scrubbing) seek.value = String(Math.round((sim.game.match.time / replay2d.duration) * 1000))
  const commentary = sim.state.commentary ?? []
  if (commentary.length !== replay2d.feedCount) {
    replay2d.feedCount = commentary.length
    const feed = document.querySelector<HTMLElement>('[data-rp-feed]')
    if (feed && hooks) feed.innerHTML = hooks.feed(commentary.slice(-FEED_LINES).reverse(), replay2d.duration)
  }
}

function loop(now: number): void {
  replay2d.frame = null
  const canvas = document.getElementById('replay-pitch') as HTMLCanvasElement | null
  const sim = replay2d.sim
  if (!canvas || !sim || replay2d.status !== 'ready') {
    replay2d.last = 0
    return
  }
  const dt = replay2d.last ? Math.min(0.1, Math.max(0, (now - replay2d.last) / 1000)) : 0
  replay2d.last = now
  if (replay2d.playing && !sim.state.finished) {
    replay2d.target = Math.min(replay2d.duration, replay2d.target + dt * (replay2d.duration / LEAGUE_REALTIME_SECONDS) * replay2d.speed)
    chaseReplayClock(sim, dt, replay2d.target, replay2d.speed)
  }
  paintReplay(canvas, sim, replay2d.kits, now)
  syncDom(sim)
  if (replay2d.playing && sim.state.finished) {
    replay2d.playing = false
    hooks?.refresh()
  }
  if (replay2d.playing || replayBannerActive(now)) replay2d.frame = window.requestAnimationFrame(loop)
}

function startLoop(): void {
  if (replay2d.frame === null) replay2d.frame = window.requestAnimationFrame(loop)
}

/** 整页重绘之后：把当前这一帧画到新的 canvas 上；正在播放就接着跑循环。 */
export function drawReplay2D(): void {
  const canvas = document.getElementById('replay-pitch') as HTMLCanvasElement | null
  const sim = replay2d.sim
  if (!canvas || !sim || replay2d.status !== 'ready') return
  paintReplay(canvas, sim, replay2d.kits, performance.now())
  syncDom(sim)
  if (replay2d.playing) startLoop()
}

export function toggleReplay2D(): void {
  if (replay2d.status !== 'ready' || !replay2d.sim) return
  if (replay2d.playing) {
    replay2d.playing = false
  } else {
    // 播完了再点：从头再看一遍。
    if (replay2d.sim.state.finished) restartReplay2D(false)
    replay2d.playing = true
    replay2d.last = 0
    startLoop()
  }
  hooks?.refresh()
}

/** 回到开球。play = true 时马上开始播。 */
export function restartReplay2D(play = true): void {
  if (!replay2d.initial) return
  replay2d.sim = PesEngine.restore(replay2d.initial)
  replay2d.target = 0
  replay2d.feedCount = -1
  resetReplayPaint(replay2d.sim)
  replay2d.playing = play
  replay2d.last = 0
  if (play) startLoop()
  hooks?.refresh()
}

export function cycleReplay2DSpeed(): void {
  const index = REPLAY_SPEEDS.indexOf(replay2d.speed as (typeof REPLAY_SPEEDS)[number])
  replay2d.speed = REPLAY_SPEEDS[(index + 1) % REPLAY_SPEEDS.length]
  hooks?.refresh()
}

/** 拖进度条：往后就接着算，往前就从开球重新算到那一刻（同步，最长约 1 秒）。 */
export function seekReplay2D(fraction: number): void {
  const sim = replay2d.sim
  if (replay2d.status !== 'ready' || !sim || !replay2d.initial) return
  const target = Math.max(0, Math.min(1, fraction)) * replay2d.duration
  let next = sim
  if (target < sim.game.match.time - 0.5) next = PesEngine.restore(replay2d.initial)
  next.advanceTo(target)
  replay2d.sim = next
  replay2d.target = target
  replay2d.scrubbing = false
  replay2d.feedCount = -1
  resetReplayPaint(next)
  replay2d.last = 0
  if (replay2d.playing) startLoop()
  drawReplay2D()
  hooks?.refresh()
}

/** 拖动过程中只预览时间，松手才真正跳转。 */
export function previewReplay2DSeek(fraction: number): void {
  replay2d.scrubbing = true
  const clock = document.querySelector<HTMLElement>('[data-rp-clock]')
  if (clock) clock.textContent = clockText(Math.round(Math.max(0, Math.min(1, fraction)) * MATCH_DISPLAY_SECONDS * 10) / 10)
}

/** 复盘页上的 2D 面板；没有回放的战报（友谊赛、旧战报）不显示。 */
export function renderReplay2D(record: MatchRecord): string {
  if (!record.hasReplay) return ''
  const title = '2D 重看'
  if (replay2d.id !== record.id || replay2d.status === 'loading') return panel(title, '<p class="muted pad">正在载入 2D 回放…</p>', { className: 'replay2d-panel' })
  if (replay2d.status === 'error' || !replay2d.sim) return panel(title, `<p class="muted pad">${esc(replay2d.error || '回放暂时不可用')}</p>`, { className: 'replay2d-panel' })
  const sim = replay2d.sim
  const finished = sim.state.finished
  const duration = replay2d.duration
  const goals = (record.commentary ?? record.keyEvents).filter((entry) => entry.type === 'goal')
  const feed = (sim.state.commentary ?? []).slice(-FEED_LINES).reverse()
  return panel(title, `
    <div class="replay-score">
      <span class="replay-team">${crest(clubLook(record.homeId), 30)}<b>${esc(record.homeName)}</b></span>
      <span class="rp-digits"><b class="replay-digits" data-rp-score>${sim.state.score.home} : ${sim.state.score.away}</b><small><span data-rp-clock>${clockText(displayOf(sim))}</span> / ${clockText(MATCH_DISPLAY_SECONDS)}</small></span>
      <span class="replay-team away"><b>${esc(record.awayName)}</b>${crest(clubLook(record.awayId), 30)}</span>
    </div>
    <div class="pitch-wrap"><canvas id="replay-pitch" width="1200" height="768"></canvas></div>
    <div class="replay-controls rp-controls">
      <button class="btn primary" data-action="replay2d-toggle">${replay2d.playing ? `${icon('pause', 14)}暂停` : finished ? `${icon('play', 14)}再看一遍` : `${icon('play', 14)}${sim.game.match.time > 0 ? '继续' : '播放'}`}</button>
      <button class="btn" data-action="replay2d-restart">重新开始</button>
      <button class="btn" data-action="replay2d-speed" title="播放速度">${replay2d.speed}×</button>
      <div class="seg" role="group" aria-label="球场视图"><button class="${ui.pitchView === 'match' ? 'active' : ''}" data-pitch-view="match">比赛</button><button class="${ui.pitchView === 'tracking' ? 'active' : ''}" data-pitch-view="tracking">战术轨迹</button></div>
      <div class="rp-track">
        <input type="range" min="0" max="1000" step="1" value="${Math.round((sim.game.match.time / duration) * 1000)}" data-rp-seek aria-label="比赛进度" />
        ${goals.map((goal) => `<i class="rp-goal" style="left:${(Math.min(duration, goal.clock) / duration) * 100}%" title="进球 ${clockText(displayClock(goal.clock, duration))}"></i>`).join('')}
      </div>
    </div>
    <div class="event-log commentary-log rp-feed" data-rp-feed>${hooks ? hooks.feed(feed, duration) : ''}</div>
  `, { className: 'replay2d-panel', aside: '<span class="muted small">服务器保存的开球状态 · 与公布的比分一致</span>' })
}
