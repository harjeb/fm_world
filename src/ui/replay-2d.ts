/**
 * 复盘页的 2D 重看（联机联赛 + 本次会话离线比赛内存缓存）。
 *
 * 服务器留着每场有教练比赛开球时的引擎初始状态；这里取回来，在浏览器里从头回放整场：
 * 同一份种子和输入，比分和公布的结果一致。回放支持暂停、调速、拖进度条、高光时间轴一键跳看，
 * 以及「精彩集锦」自动连播关键镜头。这里不判定任何结果，只推进和绘制。
 */
import type { CommentaryEntry, MatchRecord } from '../game/types.ts'
import type { MatchState } from '../game/match/types.ts'
import { isPesState, PesEngine } from '../game/pes/engine.ts'
import { displayClock, LEAGUE_REALTIME_SECONDS, LOGIC_MATCH_SECONDS, MATCH_DISPLAY_SECONDS } from '../game/match/time.ts'
import { buildHighlightWindows, extractMatchHighlights, type HighlightWindow, type MatchHighlight } from '../game/review.ts'
import { PLAYER_TEAM_ID } from '../game/season.ts'
import { fetchMatchReplay } from '../online.ts'
import { chaseReplayClock, paintReplay, replayBannerActive, resetReplayPaint } from './pes-pitch.ts'
import { clubLook, crest, distinctKit, icon, ownName, panel } from './components.ts'
import { clockText, esc } from './format.ts'
import { game, ui } from './state.ts'

export const REPLAY_SPEEDS = [1, 2, 4, 8] as const
/** 文字直播里同时显示最近几条。 */
const FEED_LINES = 8
/** 离线比赛仅在当前会话内存中保留最近几场的开球状态，不落盘不占存档。 */
const LOCAL_REPLAY_LIMIT = 8
const localReplays = new Map<string, { engineState: MatchState; durationSeconds: number }>()

export function cacheLocalReplay2D(id: string, engineState: unknown, durationSeconds = LOGIC_MATCH_SECONDS): void {
  if (!id || !isPesState(engineState) || engineState.clock > 0.05) return
  if (localReplays.has(id)) localReplays.delete(id)
  localReplays.set(id, { engineState: structuredClone(engineState), durationSeconds })
  while (localReplays.size > LOCAL_REPLAY_LIMIT) {
    const oldest = localReplays.keys().next().value
    if (oldest) localReplays.delete(oldest)
    else break
  }
}

export function hasReplay2D(record: MatchRecord | undefined | null): boolean {
  return !!record && (!!record.hasReplay || localReplays.has(record.id))
}

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
  /** 是否开启「精彩集锦」自动跳播关键镜头。 */
  highlightsOnly: false,
  /** 是否展开「关键镜头速跳」抽屉（未播完前默认收起防剧透）。 */
  drawerOpen: false,
  highlights: [] as MatchHighlight[],
  windows: [] as HighlightWindow[],
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
  replay2d.highlightsOnly = false
  replay2d.drawerOpen = false
  replay2d.highlights = []
  replay2d.windows = []
  replay2d.target = 0
  replay2d.scrubbing = false
  replay2d.feedCount = -1
  resetReplayPaint(null)
}

function syncHighlightsForRecord(record: MatchRecord): void {
  if (record.detailDeferred) return
  replay2d.highlights = extractMatchHighlights(record)
  replay2d.windows = buildHighlightWindows(replay2d.highlights, replay2d.duration)
}

/** 复盘页打开某场战报时调用：有 2D 回放就去取，没有就清掉上一场的。 */
export function ensureReplay2D(record: MatchRecord | undefined): void {
  if (!hasReplay2D(record) || (record && replayExpired(record))) {
    if (replay2d.id) resetReplay2D()
    return
  }
  if (!record) return
  if (replay2d.id === record.id) {
    if (replay2d.status === 'ready' && replay2d.highlights.length === 0 && !record.detailDeferred) {
      syncHighlightsForRecord(record)
    }
    return
  }
  resetReplay2D()
  replay2d.id = record.id
  const cached = localReplays.get(record.id)
  if (cached) {
    replay2d.initial = structuredClone(cached.engineState)
    replay2d.duration = cached.durationSeconds
    replay2d.sim = PesEngine.restore(replay2d.initial)
    replay2d.kits = kitsOf(record)
    replay2d.status = 'ready'
    syncHighlightsForRecord(record)
    resetReplayPaint(replay2d.sim)
    queueMicrotask(() => hooks?.refresh())
    return
  }
  replay2d.status = 'loading'
  const id = record.id
  fetchMatchReplay(id).then((data) => {
    if (replay2d.id !== id) return
    replay2d.initial = data.engineState as MatchState
    replay2d.duration = data.durationSeconds
    replay2d.sim = PesEngine.restore(replay2d.initial)
    replay2d.kits = kitsOf(record)
    replay2d.status = 'ready'
    syncHighlightsForRecord(record)
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

function activeWindowAt(clock: number): HighlightWindow | undefined {
  return replay2d.windows.find((w) => clock <= w.end + 0.05)
}

/** 只更新会随播放变化的几处：比分、时钟、进度条、集锦计数、文字直播。整页重绘留给点按钮的时候。 */
function syncDom(sim: PesEngine): void {
  const score = document.querySelector<HTMLElement>('[data-rp-score]')
  if (score) score.textContent = `${sim.state.score.home} : ${sim.state.score.away}`
  const clock = document.querySelector<HTMLElement>('[data-rp-clock]')
  if (clock) clock.textContent = clockText(displayOf(sim))
  const seek = document.querySelector<HTMLInputElement>('[data-rp-seek]')
  if (seek && !replay2d.scrubbing) seek.value = String(Math.round((sim.game.match.time / replay2d.duration) * 1000))
  const hlStep = document.querySelector<HTMLElement>('[data-rp-hl-step]')
  if (hlStep && replay2d.highlightsOnly && replay2d.windows.length > 0) {
    const cur = activeWindowAt(sim.game.match.time) ?? replay2d.windows.at(-1)!
    hlStep.textContent = `${cur.index + 1}/${replay2d.windows.length}`
  }
  const commentary = sim.state.commentary ?? []
  if (commentary.length !== replay2d.feedCount) {
    replay2d.feedCount = commentary.length
    const feed = document.querySelector<HTMLElement>('[data-rp-feed]')
    if (feed && hooks) feed.innerHTML = hooks.feed(commentary.slice(-FEED_LINES).reverse(), replay2d.duration)
  }
}

function advanceSimTo(targetClock: number): PesEngine | null {
  const sim = replay2d.sim
  if (!sim || !replay2d.initial) return null
  const clamped = Math.max(0, Math.min(replay2d.duration, targetClock))
  let next = sim
  if (clamped < sim.game.match.time - 0.5) next = PesEngine.restore(replay2d.initial)
  next.advanceTo(clamped)
  replay2d.sim = next
  replay2d.target = clamped
  replay2d.feedCount = -1
  resetReplayPaint(next)
  return next
}

function loop(now: number): void {
  replay2d.frame = null
  const canvas = document.getElementById('replay-pitch') as HTMLCanvasElement | null
  let sim = replay2d.sim
  if (!canvas || !sim || replay2d.status !== 'ready') {
    replay2d.last = 0
    return
  }
  const dt = replay2d.last ? Math.min(0.1, Math.max(0, (now - replay2d.last) / 1000)) : 0
  replay2d.last = now
  if (replay2d.playing && !sim.state.finished) {
    if (replay2d.highlightsOnly && replay2d.windows.length > 0) {
      const win = activeWindowAt(sim.game.match.time)
      if (!win) {
        replay2d.playing = false
        paintReplay(canvas, sim, replay2d.kits, now)
        syncDom(sim)
        hooks?.refresh()
        return
      }
      if (sim.game.match.time < win.start - 0.3) {
        sim = advanceSimTo(win.start) ?? sim
      } else {
        replay2d.target = Math.min(win.end, replay2d.target + dt * (replay2d.duration / LEAGUE_REALTIME_SECONDS) * replay2d.speed)
        chaseReplayClock(sim, dt, replay2d.target, replay2d.speed)
        if (sim.game.match.time >= win.end - 0.02) {
          const nextWin = replay2d.windows[win.index + 1]
          if (nextWin) {
            sim = advanceSimTo(nextWin.start) ?? sim
          } else {
            replay2d.playing = false
            paintReplay(canvas, sim, replay2d.kits, now)
            syncDom(sim)
            hooks?.refresh()
            return
          }
        }
      }
    } else {
      replay2d.target = Math.min(replay2d.duration, replay2d.target + dt * (replay2d.duration / LEAGUE_REALTIME_SECONDS) * replay2d.speed)
      chaseReplayClock(sim, dt, replay2d.target, replay2d.speed)
    }
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
    const pastAllHighlights =
      replay2d.highlightsOnly &&
      replay2d.windows.length > 0 &&
      replay2d.sim.game.match.time >= replay2d.windows.at(-1)!.end - 0.1
    if (replay2d.sim.state.finished || pastAllHighlights) {
      restartReplay2D(false)
      if (replay2d.highlightsOnly && replay2d.windows.length > 0) {
        advanceSimTo(replay2d.windows[0].start)
      }
    }
    replay2d.playing = true
    replay2d.last = 0
    startLoop()
  }
  hooks?.refresh()
}

/** 切换「精彩集锦」模式：开启后立即跳到当前或首个高光片段并自动连播。 */
export function toggleReplay2DHighlights(): void {
  if (replay2d.status !== 'ready' || !replay2d.sim) return
  replay2d.highlightsOnly = !replay2d.highlightsOnly
  if (replay2d.highlightsOnly && replay2d.windows.length > 0) {
    const nextWin = activeWindowAt(replay2d.sim.game.match.time) ?? replay2d.windows[0]
    if (replay2d.sim.game.match.time < nextWin.start - 0.3 || replay2d.sim.game.match.time > nextWin.end) {
      advanceSimTo(nextWin.start)
    }
    replay2d.playing = true
    replay2d.last = 0
    startLoop()
  }
  drawReplay2D()
  hooks?.refresh()
}

/** 一键跳到指定逻辑秒前约 7.5 秒（保留进攻配合发起过程）并开始播放。 */
export function jumpReplay2DToClock(clock: number): void {
  if (replay2d.status !== 'ready' || !replay2d.sim || !Number.isFinite(clock)) return
  const preRoll = 7.5 * (replay2d.duration / LEAGUE_REALTIME_SECONDS)
  const target = Math.max(0, Math.min(replay2d.duration, clock - preRoll))
  // 若跳往非集锦窗事件（如变阵节点），自动切回完整播放以免瞬间被跳走
  if (replay2d.highlightsOnly && replay2d.windows.length > 0) {
    const inAnyWin = replay2d.windows.some((w) => clock >= w.start && clock <= w.end + 0.5)
    if (!inAnyWin) replay2d.highlightsOnly = false
  }
  advanceSimTo(target)
  replay2d.scrubbing = false
  replay2d.playing = true
  replay2d.last = 0
  startLoop()
  drawReplay2D()
  hooks?.refresh()
}

/** 跳到当前进度之后的下一个关键高光镜头（到底则循环回第 1 个）。 */
export function nextReplay2DHighlight(): void {
  if (replay2d.status !== 'ready' || !replay2d.sim || replay2d.highlights.length === 0) return
  const lead = 2 * (replay2d.duration / LEAGUE_REALTIME_SECONDS)
  const cur = replay2d.sim.game.match.time
  const next = replay2d.highlights.find((h) => h.clock > cur + lead) ?? replay2d.highlights[0]
  jumpReplay2DToClock(next.clock)
}

export function toggleReplay2DDrawer(): void {
  replay2d.drawerOpen = !replay2d.drawerOpen
  hooks?.refresh()
}

/** 回到开球。play = true 时马上开始播。 */
export function restartReplay2D(play = true): void {
  if (!replay2d.initial) return
  replay2d.sim = PesEngine.restore(replay2d.initial)
  replay2d.target = replay2d.highlightsOnly && replay2d.windows.length > 0 ? replay2d.windows[0].start : 0
  if (replay2d.target > 0) replay2d.sim.advanceTo(replay2d.target)
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
  advanceSimTo(target)
  replay2d.scrubbing = false
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

function replayExpired(record: MatchRecord): boolean {
  return !!game?.shared && record.seasonIndex !== undefined && record.seasonIndex < game.season.index
}

/** 复盘页上的 2D 面板；没有回放的战报（旧战报）不显示。 */
export function renderReplay2D(record: MatchRecord): string {
  if (!hasReplay2D(record)) return ''
  const title = '2D 重看'
  if (replayExpired(record)) {
    return panel(
      title,
      `<p class="muted pad">2D 全场回放仅保留本赛季；仍可查看历史文字战报，或按射门坐标合成半场 3D 高光重演。</p><div class="btn-row pad"><button type="button" class="btn small hl3d-entry-btn" data-action="open-highlight-3d" data-record="${esc(record.id)}">🎬 打开 3D 高光剧场</button></div>`,
    )
  }
  if (replay2d.id !== record.id || replay2d.status === 'loading') return panel(title, '<p class="muted pad">正在载入 2D 回放…</p>', { className: 'replay2d-panel' })
  if (replay2d.status === 'error' || !replay2d.sim) return panel(title, `<p class="muted pad">${esc(replay2d.error || '回放暂时不可用')}</p>`, { className: 'replay2d-panel' })
  if (replay2d.highlights.length === 0 && !record.detailDeferred) syncHighlightsForRecord(record)

  const sim = replay2d.sim
  const finished = sim.state.finished
  const duration = replay2d.duration
  const highlights = replay2d.highlights
  const windows = replay2d.windows
  const curWin = replay2d.highlightsOnly && windows.length > 0 ? (activeWindowAt(sim.game.match.time) ?? windows.at(-1)!) : null
  const drawerShown = replay2d.drawerOpen || finished
  const feed = (sim.state.commentary ?? []).slice(-FEED_LINES).reverse()

  const windowSpans = replay2d.highlightsOnly
    ? windows.map((w) => {
        const left = (Math.min(duration, w.start) / duration) * 100
        const width = Math.max(1.2, ((Math.min(duration, w.end) - Math.min(duration, w.start)) / duration) * 100)
        return `<i class="rp-window" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" aria-hidden="true"></i>`
      }).join('')
    : ''

  const markers = highlights.map((h) => {
    const left = (Math.min(duration, h.clock) / duration) * 100
    return `<button type="button" class="rp-marker kind-${h.kind} ${h.isOwn ? 'is-own' : 'is-opp'}" style="left:${left.toFixed(2)}%" data-action="replay2d-jump" data-clock="${h.clock}" title="跳看 ${esc(h.badge)} · ${esc(h.minuteLabel)}" aria-label="跳看 ${esc(h.badge)} ${esc(h.minuteLabel)}"></button>`
  }).join('')

  const chipsHtml = highlights.length > 0
    ? `<div class="rp-hl-section">
        <div class="rp-hl-head">
          <button type="button" class="btn small ghost rp-hl-toggle" data-action="replay2d-drawer" aria-expanded="${drawerShown}">
            <span>${drawerShown ? '收起关键镜头' : `关键镜头速跳 (${highlights.length})`}</span>
          </button>
          <span class="rp-hl-legend muted small">
            <span><i class="rp-dot kind-goal"></i>进球</span>
            <span><i class="rp-dot kind-chance"></i>良机</span>
            <span><i class="rp-dot kind-red"></i>红牌</span>
            <span><i class="rp-dot kind-tactic"></i>变阵</span>
            <span class="hide-sm">· 点击进度条锚点或胶囊回看前 8 秒配合</span>
          </span>
        </div>
        ${drawerShown ? `<div class="rp-hl-chips" role="list" aria-label="关键镜头列表">${highlights.map((h) => `<button type="button" class="hl-chip kind-${h.kind} ${h.isOwn ? 'is-own' : 'is-opp'}" data-action="replay2d-jump" data-clock="${h.clock}" title="${esc(h.detail)}"><span class="hl-chip-badge">${esc(h.badge)}</span><span>${esc(h.shortLabel)}</span></button>`).join('')}</div>` : ''}
      </div>`
    : ''

  return panel(title, `
    <div class="replay-score">
      <span class="replay-team">${crest(clubLook(record.homeId), 30)}<b>${ownName(record.homeName, record.homeId === PLAYER_TEAM_ID)}</b></span>
      <span class="rp-digits"><b class="replay-digits" data-rp-score>${sim.state.score.home} : ${sim.state.score.away}</b><small><span data-rp-clock>${clockText(displayOf(sim))}</span> / ${clockText(MATCH_DISPLAY_SECONDS)}</small></span>
      <span class="replay-team away"><b>${ownName(record.awayName, record.awayId === PLAYER_TEAM_ID)}</b>${crest(clubLook(record.awayId), 30)}</span>
    </div>
    <div class="pitch-wrap"><canvas id="replay-pitch" width="1200" height="768"></canvas></div>
    <div class="replay-controls rp-controls">
      <button class="btn primary" data-action="replay2d-toggle">${replay2d.playing ? `${icon('pause', 14)}暂停` : finished ? `${icon('play', 14)}再看一遍` : `${icon('play', 14)}${sim.game.match.time > 0 ? '继续' : '播放'}`}</button>
      ${windows.length > 0 ? `<button class="btn ${replay2d.highlightsOnly ? 'active hl-mode-btn' : ''}" data-action="replay2d-highlights" title="只连播进球、红牌与绝佳机会片段">精彩集锦${curWin ? ` <small data-rp-hl-step>${curWin.index + 1}/${windows.length}</small>` : ''}</button>` : ''}
      <button class="btn hl3d-entry-btn" data-action="open-highlight-3d" data-record="${esc(record.id)}" title="弹出半场禁区 3D 进球与神扑特写剧场">🎬 3D 特写剧场</button>
      ${highlights.length > 0 ? `<button class="btn" data-action="replay2d-next-highlight" title="跳到下一个关键镜头前 8 秒">下一镜头 ${icon('right', 12)}</button>` : ''}
      <button class="btn" data-action="replay2d-restart">重新开始</button>
      <button class="btn" data-action="replay2d-speed" title="播放速度">${replay2d.speed}×</button>
      <div class="seg" role="group" aria-label="球场视图"><button class="${ui.pitchView === 'match' ? 'active' : ''}" data-pitch-view="match">比赛</button><button class="${ui.pitchView === 'tracking' ? 'active' : ''}" data-pitch-view="tracking">战术轨迹</button></div>
      <div class="rp-track">
        ${windowSpans}
        <input type="range" min="0" max="1000" step="1" value="${Math.round((sim.game.match.time / duration) * 1000)}" data-rp-seek aria-label="比赛进度" />
        ${markers}
      </div>
    </div>
    ${chipsHtml}
    <div class="event-log commentary-log rp-feed" data-rp-feed>${hooks ? hooks.feed(feed, duration) : ''}</div>
  `, { className: 'replay2d-panel', aside: `<span class="muted small">${record.hasReplay ? '服务器保存的开球状态' : '本场开球快照'} · 与公布的比分一致</span>` })
}
