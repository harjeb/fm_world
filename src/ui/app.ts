import type { AttrKey, GameState, Lineup, MatchMentality, Player, Position, RoleId, SkillId, Tactics } from '../game/types.ts'
import { clearSave, saveGame, setTeamPickPending, teamPickPending, upgradeLegacySignatures } from '../game/state.ts'
import { createWorldGame, previewD2Clubs } from '../game/world.ts'
import { friendlyStepMs } from './match-timing.ts'
import {
  autoTrainingConfig,
  autoTrainingRunnable,
  defaultAutoPriority,
  autoTrainingStep,
  changeMatchTactics,
  confirmTraining,
  discardTraining,
  equipPlayerCard,
  finishMatch,
  keepTraining,
  makeSubstitution,
  removePlayerCard,
  restoreActiveEngine,
  setAutoTrainingConfig,
  setLineup,
  simulateSeasonRound,
  startLeague,
  startLeagueOnMatchday,
  startTrainingWithSupport,
  startNextSeasonAction,
  startChallengeWithOpponent,
  startSingleChallenge,
  startWorldChallenge,
  startTraining,
  syncActiveEngine,
  trainingAction,
  trainingEventChoice,
  reserveCoachPause,
} from '../game/actions.ts'
import type { TrainingActionId } from '../game/training.ts'
import type { TrainingActivityId } from '../game/training-calendar.ts'
import { autoAssignLineup, autoFillLineup, clearStarter, movePlayer, type LineupTarget } from '../game/squad.ts'
import { seasonStats } from '../game/player-stats.ts'
import { injuryUntil } from '../game/injury.ts'
import { ensureCards, playerCards } from '../game/cards.ts'
import { upgradeBurstAttr, upgradeNames, upgradeStarTraits } from '../game/names.ts'
import { catchUpSeason, skipToPostseasonEnd } from '../game/season.ts'
import { fetchFriendlyTeam, isOnlineMode } from '../online.ts'
import { advanceLeagueRealtime, leagueDisplayClock } from '../game/realtime.ts'
import { displayClock } from '../game/match/time.ts'
import { emptyAutoSubs } from '../game/match/management.ts'
import { upgradeFacility, type FacilityId } from '../game/economy.ts'
import { leadingBid, type Auction, type AuctionResult } from '../game/auction.ts'
import { bestMarketValue, cancelListing, clubAsking, freeAgentAsking, listPlayer, playerMarketValue, refreshClubMarket, releasePlayer, renewContract, signClubPlayer, signFreeAgent } from '../game/market.ts'
import { minimumBid } from '../game/auction.ts'
import { SEASON_GOAL_LABELS, SQUAD_ROLE_LABELS, type SeasonGoal, type SquadRole } from '../game/negotiation.ts'
import { bidOnline, createAgentTokenOnline, hasOnlineSession, initOnline, leagueActionOnline, loadPublicConfig, loginOnline, logoutOnline, marketState, nextWorldSeasonOnline, onlineState, publicConfig, refreshPublicWorld, registerOnline, revokeAgentTokenOnline, serverNow, setRemoteGameHandler, subscribeMarket, subscribeOnline } from '../online.ts'
import { cardName } from './components.ts'
import { clockText, countdownText, esc, pct } from './format.ts'
import { icon } from './icons.ts'
import { morph } from './morph.ts'
import { installTooltips, syncTooltip } from './tooltip.ts'
import { drawPitch, pitchPlaybackPending, resetPitchView } from './pitch-canvas.ts'
import { isPesEngine, setPesViewHooks } from './pes-pitch.ts'
import { game, replay, resetReplay, setGame, stopReplay, ui, type ClubTab, type Screen, type SquadSortKey, type TransferTab } from './state.ts'
import { renderAcademy } from './screens/academy.ts'
import { renderChallenge } from './screens/challenge.ts'
import { renderClub } from './screens/club.ts'
import { renderTransfer } from './screens/transfer.ts'
import { renderHome } from './screens/home.ts'
import { renderInventory } from './screens/inventory.ts'
import { parseLineupTarget, renderLineup, selectedSlotTarget } from './screens/lineup.ts'
import { renderMatch } from './screens/match.ts'
import { renderAccountOverlay, renderDetailOverlay, renderNegotiationOverlay, renderNewGameOverlay } from './screens/overlays.ts'
import { renderClubOverlay } from './club-view.ts'
import { renderReview } from './screens/review.ts'
import { renderSeason } from './screens/season.ts'
import { renderSidebar, renderTopbar } from './screens/shell.ts'
import { buildTrainingRequest, renderAutoStrategyOverlay, renderTraining } from './screens/training.ts'
import { renderWorld } from './screens/world.ts'

const app = document.getElementById('app')!

function persist(): void {
  if (ui.screen) game.ui = { screen: ui.screen }
  if (!saveGame(game)) ui.notice = '存档保存失败（可能已达浏览器容量上限），请勿刷新或关闭页面。'
}

/** 竞拍有动静时提示一下：被人超过、签下了、有人开了新的竞拍。比赛中不打扰。 */
function announceMarket(previous: Auction[], previousLog: AuctionResult[]): void {
  // 自己放出去的人已经进了全服市场，存档里不用再留一份。
  if (game.freeStars.length && marketState.pool.length) game.freeStars = game.freeStars.filter((player) => !marketState.pool.some((item) => item.id === player.id))
  if (!previous.length && !marketState.auctions.length) return
  const me = onlineState.user?.id
  const before = new Map(previous.map((auction) => [auction.playerId, auction]))
  for (const auction of marketState.auctions) {
    const lead = leadingBid(auction)
    const old = before.get(auction.playerId)
    if (old && leadingBid(old).accountId === me && lead.accountId !== me) {
      ui.notice = `你对 ${auction.playerName} 的出价被 ${lead.club} 超过了，现价 ${lead.amount.toLocaleString()}。`
    } else if (!old && lead.accountId !== me && ui.screen !== 'match') {
      ui.notice = `${lead.club} 对 ${auction.playerName} 出价 ${lead.amount.toLocaleString()}，竞拍开始。`
    }
  }
  const known = new Set(previousLog.map((item) => `${item.playerId}|${item.at}`))
  for (const item of marketState.log) {
    if (known.has(`${item.playerId}|${item.at}`) || !before.has(item.playerId)) continue
    const old = before.get(item.playerId)!
    if (old.bids.some((bid) => bid.accountId === me)) {
      ui.notice = item.club === game.clubName ? `你以 ${item.amount.toLocaleString()} 签下了 ${item.playerName}。` : item.club ? `${item.playerName} 被 ${item.club} 以 ${item.amount.toLocaleString()} 签下。` : `${item.playerName} 的竞拍流拍了。`
    }
  }
}

/** 开始一场友谊赛：切到比赛页并自动播放。 */
function openFriendly(result: { ok: boolean; error?: string }): void {
  if (!result.ok) {
    showNotice(result.error ?? '无法开始挑战')
    return
  }
  ui.screen = 'match'
  ui.matchEngine = restoreActiveEngine(game)
  ui.matchPlaying = true
  ui.coachPanel = false
  ui.completing = false
  persist()
  render()
}

function showNotice(text: string): void {
  ui.notice = text
  render()
}

function go(screen: Screen): void {
  stopReplay()
  if (screen === 'match' && !game.activeMatch) {
    showNotice('当前没有进行中的比赛。')
    return
  }
  stopTimer()
  ui.matchPlaying = false
  ui.coachPanel = false
  ui.detailPlayerId = null
  ui.lineupSlot = null
  ui.screen = screen
  if (screen === 'season') ui.seasonRound = null
  if (screen === 'world') void refreshPublicWorld()
  if (screen === 'lineup') {
    ui.lineupDraft = structuredClone(game.lineup)
    ui.autoSubsDraft = structuredClone(game.autoSubs ?? emptyAutoSubs())
  }
  if (screen === 'match') {
    ui.matchEngine = restoreActiveEngine(game)
    ui.matchPlaying = !!ui.matchEngine && !ui.matchEngine.state.finished && !game.activeMatch?.context.isLeague
    ui.completing = false
  }
  persist()
  render()
}

function renderScreen(): string {
  switch (ui.screen) {
    case 'club':
      return renderClub()
    case 'transfer':
      return renderTransfer()
    case 'home':
      return renderHome()
    case 'academy':
      return renderAcademy()
    case 'inventory':
      return renderInventory()
    case 'training':
      return renderTraining()
    case 'lineup':
      return renderLineup()
    case 'season':
      return renderSeason()
    case 'world':
      return renderWorld()
    case 'challenge':
      return renderChallenge()
    case 'review':
      return renderReview()
    case 'match':
      return renderMatch()
  }
}

let lastPageKey = ''
let lastNotice = ''
let noticeTimer: number | null = null

/** 普通提示几秒后自动消失；令牌和存档失败要留到用户手动关闭。 */
function syncNoticeTimer(): void {
  if (ui.notice === lastNotice) return
  lastNotice = ui.notice
  if (noticeTimer !== null) window.clearTimeout(noticeTimer)
  noticeTimer = null
  if (!ui.notice || /令牌已复制|存档保存失败/.test(ui.notice)) return
  noticeTimer = window.setTimeout(() => {
    ui.notice = ''
    render()
  }, 6000)
}

function render(): void {
  if (ui.screen === 'lineup' && !ui.lineupDraft) ui.lineupDraft = structuredClone(game.lineup)
  if (ui.screen === 'lineup' && !ui.autoSubsDraft) ui.autoSubsDraft = structuredClone(game.autoSubs ?? emptyAutoSubs())
  const selections = new Map([...document.querySelectorAll<HTMLSelectElement>('#match-mentality, #match-out, #match-in')].map((select) => [select.id, select.value]))
  const pageKey = `${ui.screen}|${ui.clubTab}|${ui.transferTab}|${ui.reviewId ?? ''}|${ui.trainingPlayerId ?? ''}`
  const pageChanged = pageKey !== lastPageKey
  if (pageChanged && ui.screen === 'match') resetPitchView()
  morph(app, `
    <div class="app-shell">
      ${renderSidebar()}
      <div class="workspace">
        ${renderTopbar()}
        <main class="content ${ui.screen === 'lineup' ? 'wide' : ''}">${renderScreen()}</main>
        <footer class="footer">真实球星和俱乐部名称仅用于原型玩法测试；正式发行需取得相应授权。固定 PCG32 随机；同种子同输入可复现。<span class="muted"> · 构建 ${BUILD_ID}</span></footer>
      </div>
    </div>
    ${renderBootGate()}
    ${renderDetailOverlay()}
    ${renderNegotiationOverlay()}
    ${renderClubOverlay()}
    ${renderAccountOverlay()}
    ${renderAutoStrategyOverlay()}
    ${renderNewGameOverlay()}
    ${ui.notice ? `<div class="toast" data-action="dismiss-notice" role="status">${icon('info', 15)}<span class="toast-text">${esc(ui.notice)}</span><span class="toast-close">${icon('close', 13)}</span></div>` : ''}
  `)
  for (const select of document.querySelectorAll<HTMLSelectElement>('#match-mentality, #match-out, #match-in')) {
    const value = selections.get(select.id)
    if (value !== undefined && [...select.options].some((option) => option.value === value)) select.value = value
  }
  if (pageChanged) {
    lastPageKey = pageKey
    window.scrollTo(0, 0)
  }
  syncNoticeTimer()
  syncTooltip()
  syncAutoTraining()
  if (ui.screen === 'match') {
    drawPitch()
    ensureTimer()
    if (!game.activeMatch?.context.isLeague && ui.matchEngine?.state.finished && !ui.matchPlaying && !pitchPlaybackPending() && !ui.completing) {
      window.setTimeout(() => completeMatch(), 0)
    }
  } else {
    stopTimer()
  }
  if (ui.screen === 'review') scheduleReplay()
  else stopReplay()
  mountTurnstile()
}

/** vite.config.ts 在构建时注入的时间戳；开发模式下是启动时间。 */
const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string
  reset: (widgetId?: string) => void
}

let turnstileLoader: Promise<TurnstileApi | null> | null = null

function loadTurnstile(): Promise<TurnstileApi | null> {
  const loaded = (window as unknown as { turnstile?: TurnstileApi }).turnstile
  if (loaded) return Promise.resolve(loaded)
  if (turnstileLoader) return turnstileLoader
  turnstileLoader = new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.onload = () => resolve((window as unknown as { turnstile?: TurnstileApi }).turnstile ?? null)
    script.onerror = () => resolve(null)
    document.head.appendChild(script)
  })
  return turnstileLoader
}

/** 插槽带 data-morph-skip，重绘不会打断验证；提交失败时 submitAccount 清空它以换取新 token。 */
function mountTurnstile(): void {
  if (!ui.accountOpen || ui.authMode !== 'register') return
  if (!publicConfig.turnstileSiteKey) return
  const slot = document.getElementById('turnstile-slot')
  if (!slot || slot.childElementCount > 0) return
  void loadTurnstile().then((api) => {
    if (!api || slot.childElementCount > 0) return
    api.render(slot, {
      sitekey: publicConfig.turnstileSiteKey,
      theme: 'dark',
      callback: (token: string) => { ui.turnstileToken = token },
      'expired-callback': () => { ui.turnstileToken = '' },
      'error-callback': () => { ui.turnstileToken = '' },
    })
  })
}

function openFinishedLeague(previous: NonNullable<GameState['activeMatch']>): void {
  const record = game.matchHistory.find((item) => item.round === previous.context.round)
  if (ui.screen !== 'match' || !record) return
  resetReplay(record.id)
  replay.index = (record.commentary ?? record.keyEvents).length
  ui.reviewId = record.id
  ui.screen = 'review'
  ui.matchEngine = null
  ui.coachPanel = false
  // 单机：联赛比赛按现实时间走完，同样把这一轮的市场补充做掉。
  if (record.isLeague && !isOnlineMode()) refreshClubMarket(game, record.round ?? game.season.round)
  ui.notice = '联赛比赛已结束。'
}

function applyOnlineGame(next: GameState, notice?: string): void {
  const previous = game.activeMatch
  const wasMatch = ui.screen === 'match'
  setGame(next)
  upgradeLegacySignatures(game)
  ensureCards(game)
  upgradeNames(game)
  upgradeStarTraits(game)
  upgradeBurstAttr(game)
  if (wasMatch && game.activeMatch) ui.matchEngine = restoreActiveEngine(game)
  else if (previous?.context.isLeague && !game.activeMatch) openFinishedLeague(previous)
  if (notice) ui.notice = notice
  render()
}

async function submitAccount(): Promise<void> {
  const username = (document.getElementById('account-username') as HTMLInputElement | null)?.value.trim() ?? ''
  const password = (document.getElementById('account-password') as HTMLInputElement | null)?.value ?? ''
  if (!username || !password) {
    ui.notice = '请填写用户名和密码。'
    render()
    return
  }
  try {
    if (ui.authMode === 'register') {
      const mode = publicConfig.registration
      if (mode === 'closed') {
        ui.notice = '本服务器已关闭注册。'
        render()
        return
      }
      if (mode === 'unknown') {
        ui.notice = '服务器不可达，无法注册新账号。'
        render()
        return
      }
      const inviteCode = (document.getElementById('account-invite') as HTMLInputElement | null)?.value.trim() ?? ''
      if (mode === 'invite' && !inviteCode) {
        ui.notice = '请填写邀请码。'
        render()
        return
      }
      if (publicConfig.turnstileSiteKey && !ui.turnstileToken) {
        ui.notice = '请先完成人机验证。'
        render()
        return
      }
      const data = await registerOnline(username, password, { inviteCode, turnstileToken: ui.turnstileToken })
      ui.accountOpen = false
      ui.bootGate = false
      ui.turnstileToken = ''
      applyOnlineGame(data.game, `已注册并登录 ${data.user.username}，存档已同步。`)
      return
    }
    const data = await loginOnline(username, password)
    ui.accountOpen = false
    ui.bootGate = false
    applyOnlineGame(data.game, `已登录 ${data.user.username}，存档已同步。`)
  } catch (error) {
    /* Turnstile token 一次性有效，失败后清空插槽，render() 会重新挂载控件取新 token。 */
    ui.turnstileToken = ''
    document.getElementById('turnstile-slot')?.replaceChildren()
    ui.notice = error instanceof Error ? error.message : '登录失败'
    render()
  }
}

/**
 * 启动页：每次打开页面都先问一次「登录 / 离线」。
 * 不写进存档，也不记住选择——刷新页面会再问。
 */
function renderBootGate(): string {
  if (!ui.bootGate) return ''
  const online = hasOnlineSession()
  const name = onlineState.user ? esc(onlineState.user.username) : ''
  return `<div class="overlay boot-gate">
    <div class="modal boot-modal" data-stop="true" role="dialog" aria-modal="true" aria-label="选择游戏模式">
      <div class="kicker">FM 世界</div>
      <h1>选择游戏模式</h1>
      <p class="hint">登录后进入全服共享世界：所有账号看到同一批球队、同一个赛季、同一个日期。</p>
      <p class="hint">离线模式只玩这台设备上的本地存档，时间和赛季都按本地时间自己走。</p>
      <div class="btn-row">
        <button class="btn primary" data-action="boot-online">${online ? (name ? `继续联机（${name}）` : '继续联机') : '登录 / 注册'}</button>
        <button class="btn ghost" data-action="boot-offline">离线模式</button>
      </div>
      <p class="hint">${online ? '离线模式下本次不连接服务器，令牌会保留，下次打开还会再问。' : '离线存档只保存在这个浏览器里，换设备不会同步。'}</p>
    </div>
  </div>`
}

function bootOnline(): void {
  setRemoteGameHandler((next) => applyOnlineGame(next))
  subscribeOnline(() => render())
  subscribeMarket((previous, previousLog) => announceMarket(previous, previousLog))
  void loadPublicConfig().then(() => render())
}

/** 启动页选了「登录 / 继续联机」才去连服务器；离线模式完全不建立在线会话。 */
function joinOnline(): void {
  void initOnline().then((remote) => {
    if (remote) applyOnlineGame(remote, '已从服务器载入最新存档。')
    else render()
  })
}

function scheduleReplay(): void {
  if (!replay.playing || replay.timer !== null) return
  const record = [...game.matchHistory, ...game.challengeHistory].find((item) => item.id === ui.reviewId)
  if (!record) { stopReplay(); return }
  const entries = record.commentary ?? record.keyEvents
  if (replay.index >= entries.length) { stopReplay(); return }
  const previous = replay.index ? displayClock(entries[replay.index - 1].clock, record.durationSeconds ?? 600) : 0
  const delay = Math.max(250, Math.min(3000, Math.max(0, displayClock(entries[replay.index].clock, record.durationSeconds ?? 600) - previous) * 100)) / replay.speed
  replay.timer = window.setTimeout(() => {
    replay.timer = null
    if (!replay.playing || ui.screen !== 'review' || ui.reviewId !== record.id) return
    replay.index++
    if (replay.index >= entries.length) stopReplay()
    render()
  }, delay)
}

function ensureTimer(): void {
  // 新引擎由球场的画面循环按帧推进（pes-pitch.ts），不用这个按步计时的定时器
  if (ui.screen !== 'match' || !ui.matchPlaying || !ui.matchEngine || !game.activeMatch || game.activeMatch.context.isLeague || isPesEngine(ui.matchEngine)) {
    stopTimer()
    return
  }
  if (ui.matchTimer !== null) return
  // 每一步等的时间不同，所以不用固定间隔；下一次在 tickMatch 之后的 render 里排上。
  ui.matchTimer = window.setTimeout(() => {
    ui.matchTimer = null
    tickMatch()
  }, ui.matchStepMs)
}

function stopTimer(): void {
  if (ui.matchTimer !== null) {
    window.clearTimeout(ui.matchTimer)
    ui.matchTimer = null
  }
}

function tickMatch(): void {
  const engine = ui.matchEngine
  if (!engine || !game.activeMatch || !ui.matchPlaying) return
  if (engine.state.finished) {
    drawPitch()
    if (pitchPlaybackPending()) {
      ui.matchTimer = window.setTimeout(() => { ui.matchTimer = null; tickMatch() }, 16)
      return
    }
    completeMatch()
    return
  }
  const logLength = engine.state.log.length
  const clockBefore = engine.state.clock
  engine.step()
  ui.matchStepMs = friendlyStepMs(engine.state.clock - clockBefore, ui.matchSpeed)
  if (engine.state.step % 5 === 0 || engine.state.log.slice(logLength).some((entry) => entry.injury)) syncActiveEngine(game, engine)
  // 终场也先让最后一个动作播完；下一次 tick 再结算并进入赛后页。
  render()
}

function completeMatch(): void {
  if (ui.completing || !ui.matchEngine) return
  ui.completing = true
  stopTimer()
  ui.matchPlaying = false
  const engine = ui.matchEngine
  const record = finishMatch(game, engine)
  ui.coachPanel = false
  if (record) {
    // 单机：一轮结束后，各队的边缘球员会进入自由市场（联机市场由服务器维护）。
    if (record.isLeague && !isOnlineMode()) refreshClubMarket(game, record.round ?? game.season.round)
    resetReplay(record.id)
    replay.index = (record.commentary ?? record.keyEvents).length
    ui.reviewId = record.id
    ui.screen = 'review'
    ui.notice = '比赛结束，文字回放已就绪。'
  } else {
    ui.notice = '比赛尚未结束，无法记录。'
    ui.screen = 'match'
  }
  ui.completing = false
  persist()
  render()
}

function openTraining(playerId: string): void {
  ui.trainingPlayerId = playerId
  ui.trainingTeammateIds = []
  ui.trainingKind = 'drill'
  ui.trainingAttr = 'passing'
  ui.coachPanel = false
  ui.screen = 'training'
  ui.detailPlayerId = null
  stopTimer()
  persist()
  render()
}

function startTrainingFor(playerId: string): void {
  // 每轮都由系统自动挑 6 名陪练（含门将），不消耗他们的精力。
  const result = startTrainingWithSupport(game, playerId)
  if (!result.ok) {
    showNotice(result.error ?? '无法开始培养')
    return
  }
  openTraining(playerId)
}

/** 手游式的品质提示：在屏幕中央弹出一个大字，约 2 秒后淡出（不进 render，不会被重绘打断）。 */
const QUALITY_POPUP_CLASS: Record<string, string> = { 完美成功: 'perfect', 大成功: 'great', 成功: 'ok', 一般: 'plain', 失败: 'fail' }
function showQualityPopup(label: string): void {
  document.querySelector('.quality-popup')?.remove()
  const el = document.createElement('div')
  el.className = `quality-popup q-${QUALITY_POPUP_CLASS[label] ?? 'ok'}`
  el.setAttribute('role', 'status')
  el.textContent = label
  document.body.append(el)
  window.setTimeout(() => el.remove(), 2000)
}

/** 从刚写入的培养日志里读出这一次行动的品质并弹出提示；休息等没有品质的行动不弹。 */
function popupQualityOf(playerId: string, actionNumber: number): void {
  const entry = game.training[playerId]?.log.find((item) => item.kind === 'action' && item.action === actionNumber)
  const quality = entry ? /（([^（）]+)）$/.exec(entry.title)?.[1] : undefined
  if (quality && quality in QUALITY_POPUP_CLASS) showQualityPopup(quality)
}

/** 打开选队弹窗；required 表示第一次进离线模式，必须选完才能继续。 */
function openNewGamePicker(required: boolean): void {
  const seed = Math.floor(Math.random() * 0x7fffffff)
  const clubs = previewD2Clubs(seed)
  ui.newGamePreview = { seed, clubs }
  ui.newGameClubId = clubs[0]?.id ?? null
  ui.newGameRequired = required
  ui.newGameOpen = true
}

function executeTraining(): void {
  if (!ui.trainingPlayerId) return
  const playerId = ui.trainingPlayerId
  const actionNumber = (game.training[playerId]?.action ?? 0) + 1
  const result = trainingAction(game, playerId, buildTrainingRequest())
  if (!result.ok) showNotice(result.error ?? '行动失败')
  else {
    // 品质只在执行后揭晓。
    popupQualityOf(playerId, actionNumber)
    ui.trainingTeammateIds = []
    ui.notice = result.exchange ? `交流赛：${result.exchange.homeScore}:${result.exchange.awayScore} 对 ${result.exchange.opponentName} · ${{ win: '胜', draw: '平', loss: '负' }[result.exchange.result]}` : result.event ? `触发事件：${result.event.title}` : '行动完成。'
  }
  render()
}

/* ---------- 自动培养：开关打开后，培养页每隔一会儿自动走一步 ---------- */

const AUTO_TRAIN_STEP_MS = 1600
let autoTrainTimer: number | null = null

/**
 * 只在培养页、选中的球员开着“自动培养”且有一轮没结束的培养时才推进；
 * 离开培养页就暂停，回来继续。不会自己开新一轮（开始新一轮要消耗精力，也要先处理新卡）。
 */
function syncAutoTraining(): void {
  const id = ui.trainingPlayerId
  const active = ui.screen === 'training' && !!id && autoTrainingConfig(game, id).autopilot === true && autoTrainingRunnable(game, id)
  if (!active) {
    if (autoTrainTimer !== null) window.clearTimeout(autoTrainTimer)
    autoTrainTimer = null
    return
  }
  if (autoTrainTimer !== null) return
  autoTrainTimer = window.setTimeout(() => {
    autoTrainTimer = null
    tickAutoTraining()
  }, AUTO_TRAIN_STEP_MS)
}

function tickAutoTraining(): void {
  const id = ui.trainingPlayerId
  if (!id || ui.screen !== 'training' || !autoTrainingConfig(game, id).autopilot || !autoTrainingRunnable(game, id)) {
    syncAutoTraining()
    return
  }
  const actionNumber = (game.training[id]?.action ?? 0) + 1
  const step = autoTrainingStep(game, id)
  if (!step.ok) {
    // 走不下去（比如体力、精力或阵容问题）就把开关关掉，免得一直重试。
    setAutoTrainingConfig(game, id, { autopilot: false })
    ui.notice = `自动培养已暂停：${step.error ?? '无法继续'}`
  } else {
    if (step.kind === 'action') popupQualityOf(id, actionNumber)
    ui.notice = `自动培养：${step.label ?? '完成一步'}${step.completed ? ' · 本轮已完成' : ''}`
  }
  persist()
  render()
}

function chooseEvent(optionId: string): void {
  if (!ui.trainingPlayerId) return
  const result = trainingEventChoice(game, ui.trainingPlayerId, optionId)
  if (!result.ok) {
    showNotice(result.error ?? '事件结算失败')
    return
  }
  const outcome = result.success === undefined ? '' : result.success ? `成功（${pct(result.probability ?? 0, 0)}）` : `失败（${pct(result.probability ?? 0, 0)}）`
  ui.notice = `${result.event?.title ?? '事件'}：${outcome}${result.completed ? ' · 培养完成' : ''}`
  render()
}

function updateLineupDraft(mutator: (draft: Lineup) => void): void {
  if (!ui.lineupDraft) ui.lineupDraft = structuredClone(game.lineup)
  mutator(ui.lineupDraft)
  render()
}

/** 把球员移到阵容里的某个去处（只改草稿，保存后才生效）。 */
function moveInDraft(playerId: string, target: LineupTarget): void {
  updateLineupDraft((draft) => {
    const error = movePlayer(game.roster, draft, playerId, target)
    if (error) ui.notice = error
  })
}

function equipFromUI(playerId: string, cardId: string | null): void {
  const result = equipPlayerCard(game, playerId, cardId)
  const player = game.roster.find((item) => item.id === playerId)
  if (result.ok) {
    const card = cardId ? playerCards(game, playerId).find((item) => item.id === cardId) : undefined
    ui.notice = `${player?.name ?? ''} 换上了${card ? cardName(card) : '原始属性'}，体能和精力不变。`
  } else ui.notice = `换卡失败：${result.error ?? '未知错误'}`
  render()
}

function applyLineup(): void {
  if (!ui.lineupDraft) return
  const result = setLineup(game, ui.lineupDraft, ui.autoSubsDraft ?? emptyAutoSubs())
  if (!result.ok) {
    showNotice(`阵容不合法：${result.errors[0]}`)
    return
  }
  ui.lineupDraft = structuredClone(game.lineup)
  ui.autoSubsDraft = structuredClone(game.autoSubs ?? emptyAutoSubs())
  ui.notice = '阵容与自动换人规则已保存。'
  render()
}

/** 打开谈判弹窗：底价、估值和默认报价都在这里算好。 */
function openNegotiation(kind: 'free' | 'club' | 'bid', playerId: string, clubId?: string): void {
  const player = kind === 'bid'
    ? marketState.pool.find((item) => item.id === playerId)
    : kind === 'free'
      ? game.freeStars.find((item) => item.id === playerId)
      : game.aiTeams.find((team) => team.id === clubId)?.players.find((item) => item.id === playerId)
  if (!player) {
    showNotice('找不到这名球员。')
    return
  }
  const value = Math.max(1, Math.round(playerMarketValue(player)))
  const auction = kind === 'bid' ? marketState.auctions.find((item) => item.playerId === playerId) : undefined
  const asking = kind === 'free'
    ? freeAgentAsking(game, player)
    : kind === 'club'
      ? clubAsking(game, player)
      : Math.max(askingFloor(player, auction), value)
  ui.negotiation = {
    kind,
    playerId,
    clubId,
    asking,
    value,
    offer: asking,
    goal: 'promotion',
    role: 'first-team',
  }
  render()
}

function askingFloor(player: Player, auction: ReturnType<typeof marketState.auctions.find>): number {
  if (!auction) return bestMarketValue(game, player)
  return minimumBid(player, auction)
}

/** 战术页自动填充：按 CA、位置熟练度和体能分配；部分轮换/全部轮换还会参考体力和本赛季出场时间。 */
function autoFillLineupDraft(): Lineup {
  const base = ui.lineupDraft ?? game.lineup
  const minutes = new Map(game.roster.map((player) => [player.id, seasonStats(game, player.id).minutes]))
  const now = Date.now()
  const lineup = autoAssignLineup(game.roster, base.formationId, base.tactics, undefined, ui.lineupAutoMode, {
    condition: (player) => player.condition ?? 100,
    minutes: (player) => minutes.get(player.id) ?? 0,
    suspended: (player) => !!game.suspensions?.[player.id],
    injured: (player) => injuryUntil(game, player, now) !== null,
  })
  return structuredClone(lineup)
}

document.addEventListener('click', async (event) => {
  const target = event.target as HTMLElement
  // 模态框内的点击不能冒泡成遮罩层的“关闭”动作。
  const stopped = target.closest<HTMLElement>('[data-stop="true"]')
  const insideStop = (element: Element | null) => !stopped || (element !== null && stopped.contains(element))
  const nav = target.closest<HTMLElement>('[data-nav]')
  if (nav?.dataset.nav && insideStop(nav)) {
    go(nav.dataset.nav as Screen)
    return
  }
  const transferTab = target.closest<HTMLElement>('[data-transfer-tab]')
  if (transferTab?.dataset.transferTab) {
    ui.transferTab = transferTab.dataset.transferTab as TransferTab
    ui.clubPage = 0
    render()
    return
  }
  const clubTab = target.closest<HTMLElement>('[data-club-tab]')
  if (clubTab?.dataset.clubTab) {
    ui.clubTab = clubTab.dataset.clubTab as ClubTab
    render()
    return
  }
  const challengeDiv = target.closest<HTMLElement>('[data-challenge-div]')
  if (challengeDiv?.dataset.challengeDiv) {
    ui.challengeDivision = challengeDiv.dataset.challengeDiv
    render()
    return
  }
  const worldDivision = target.closest<HTMLElement>('[data-world-div]')
  if (worldDivision?.dataset.worldDiv) {
    ui.worldDivision = worldDivision.dataset.worldDiv
    ui.worldClubId = null
    ui.worldPlayerId = null
    render()
    return
  }
  // 任何界面的球队名都能点开名单：世界页就地展开，其它界面用弹层。
  const clubOpen = target.closest<HTMLElement>('[data-club-open]')
  if (clubOpen?.dataset.clubOpen) {
    if (ui.screen === 'world') {
      ui.worldClubId = clubOpen.dataset.clubOpen
      ui.worldPlayerId = null
      ui.clubViewId = null
      render()
      document.getElementById('world-roster')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      ui.clubViewId = clubOpen.dataset.clubOpen
      ui.clubViewPlayerId = null
      render()
    }
    return
  }
  const clubPlayer = target.closest<HTMLElement>('[data-club-player]')
  if (clubPlayer?.dataset.clubPlayer) {
    if (ui.screen === 'world' && ui.clubViewId === null) {
      ui.worldPlayerId = clubPlayer.dataset.clubPlayer
      render()
      document.getElementById('world-player-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      ui.clubViewId = clubPlayer.dataset.club ?? ui.clubViewId
      ui.clubViewPlayerId = clubPlayer.dataset.clubPlayer
      render()
    }
    return
  }
  const statsTab = target.closest<HTMLElement>('[data-player-stats-tab]')
  if (statsTab?.dataset.playerStatsTab) {
    ui.playerStatsTab = statsTab.dataset.playerStatsTab === 'career' ? 'career' : 'season'
    render()
    return
  }
  const sort = target.closest<HTMLElement>('[data-sort]')
  if (sort?.dataset.sort) {
    const key = sort.dataset.sort as SquadSortKey
    if (ui.squadSort === key) ui.squadSortDir = ui.squadSortDir === 1 ? -1 : 1
    else {
      ui.squadSort = key
      ui.squadSortDir = key === 'name' || key === 'pos' ? 1 : -1
    }
    render()
    return
  }
  const inventoryPos = target.closest<HTMLElement>('[data-inventory-pos]')
  if (inventoryPos?.dataset.inventoryPos) {
    ui.inventoryPos = inventoryPos.dataset.inventoryPos as Position | 'ALL'
    render()
    return
  }
  const posFilter = target.closest<HTMLElement>('[data-filter-pos]')
  if (posFilter?.dataset.filterPos) {
    ui.academyPos = posFilter.dataset.filterPos as Position | 'ALL'
    render()
    return
  }
  const activity = target.closest<HTMLElement>('[data-training-activity]')
  if (activity?.dataset.trainingActivity) {
    ui.trainingActivity = activity.dataset.trainingActivity as TrainingActivityId
    ui.trainingTeammateIds = []
    render()
    return
  }
  const trainingKind = target.closest<HTMLElement>('[data-training-kind]')
  if (trainingKind?.dataset.trainingKind) {
    ui.trainingTeammateIds = []
    ui.trainingKind = trainingKind.dataset.trainingKind as TrainingActionId
    if (ui.trainingKind === 'position' && ui.trainingPlayerId) {
      const session = game.training[ui.trainingPlayerId]
      if (session?.candidate.positions.GK) ui.trainingPosition = 'GK'
      else if (ui.trainingPosition === 'GK') ui.trainingPosition = 'CM'
    }
    render()
    return
  }
  const attr = target.closest<HTMLElement>('[data-training-attr]')
  if (attr?.dataset.trainingAttr) {
    ui.trainingAttr = attr.dataset.trainingAttr as AttrKey
    render()
    return
  }
  const combo = target.closest<HTMLElement>('[data-training-combo]')
  if (combo?.dataset.trainingCombo) {
    ui.trainingCombo = combo.dataset.trainingCombo as 'attack' | 'defense'
    render()
    return
  }
  const pitchView = target.closest<HTMLElement>('[data-pitch-view]')
  if (pitchView?.dataset.pitchView === 'match' || pitchView?.dataset.pitchView === 'tracking') {
    ui.pitchView = pitchView.dataset.pitchView
    render()
    return
  }
  const speed = target.closest<HTMLElement>('[data-speed]')
  if (speed?.dataset.speed) {
    if (game.activeMatch?.context.isLeague) return
    ui.matchSpeed = Number(speed.dataset.speed)
    ui.matchStepMs = ui.matchSpeed
    stopTimer()
    render()
    return
  }
  const actionEl = target.closest<HTMLElement>('[data-action]')
  if (!actionEl || !insideStop(actionEl) || actionEl.matches(':disabled')) return
  // 整行可点的表格里还有下拉框和输入框：操作控件时不触发行动作。
  const control = target.closest('select, input, label')
  if (control && actionEl !== control && actionEl.contains(control)) return
  const action = actionEl.dataset.action
  if (!action) return
  const playerId = actionEl.dataset.player
  const recordId = actionEl.dataset.record
  switch (action) {
    case 'club-search':
      ui.clubSearch = (document.getElementById('club-search') as HTMLInputElement | null)?.value ?? ''
      ui.clubPage = 0
      render()
      break
    case 'club-prev':
    case 'club-next':
      ui.clubPage = Math.max(0, ui.clubPage + (action === 'club-next' ? 1 : -1))
      render()
      break
    case 'club-upgrade': {
      const result = upgradeFacility(game, actionEl.dataset.facility as FacilityId)
      if (result.ok) persist()
      showNotice(result.ok ? '设施已升级。' : `升级失败：${result.error ?? '未知错误'}`)
      break
    }
    case 'auction-bid': {
      if (!playerId) break
      openNegotiation('bid', playerId)
      break
    }
    case 'nego-goal':
      if (!ui.negotiation) break
      ui.negotiation.goal = (actionEl.dataset.goal as SeasonGoal) ?? ui.negotiation.goal
      ui.negotiation.message = undefined
      render()
      break
    case 'nego-role':
      if (!ui.negotiation) break
      ui.negotiation.role = (actionEl.dataset.role as SquadRole) ?? ui.negotiation.role
      ui.negotiation.message = undefined
      render()
      break
    case 'nego-cancel':
      ui.negotiation = null
      render()
      break
    case 'nego-confirm': {
      const draft = ui.negotiation
      if (!draft) break
      const player = [...game.roster, ...game.freeStars, ...game.aiTeams.flatMap((team) => team.players), ...marketState.pool].find((item) => item.id === draft.playerId)
      if (!player) { ui.negotiation = null; render(); break }
      if (draft.kind === 'bid') {
        try {
          await bidOnline(draft.playerId, draft.offer)
          ui.negotiation = null
          showNotice(`出价 ${draft.offer.toLocaleString()} 成功。`)
        } catch (error) {
          draft.message = error instanceof Error ? error.message : '出价失败'
          render()
        }
        break
      }
      const result = draft.kind === 'free'
        ? signFreeAgent(game, draft.playerId, draft.offer, { goal: draft.goal, role: draft.role })
        : signClubPlayer(game, draft.clubId ?? '', draft.playerId, draft.offer, { goal: draft.goal, role: draft.role })
      if (result.ok) {
        ui.negotiation = null
        ui.lineupDraft = null
        ui.autoSubsDraft = null
        persist()
        showNotice(`谈成了：${player.name} 加盟，花费 ${draft.offer.toLocaleString()}。`)
      } else {
        draft.message = result.error ?? '谈判失败'
        draft.lastChance = result.chance
        render()
      }
      break
    }
    case 'open-auctions':
      ui.transferTab = 'free'
      go('transfer')
      break
    case 'club-list':
    case 'club-cancel':
    case 'club-list':
    case 'club-cancel': {
      if (!playerId) break
      const input = actionEl.parentElement?.querySelector<HTMLInputElement>('[data-club-price]')
      const price = input?.valueAsNumber ?? NaN
      const result = action === 'club-list' ? listPlayer(game, playerId, price) : cancelListing(game, playerId)
      if (result.ok) persist()
      showNotice(result.ok ? (action === 'club-list' ? '已挂牌，等待下一轮结算。' : '已取消挂牌。') : `交易失败：${result.error ?? '未知错误'}`)
      break
    }
    case 'club-buy':
      if (playerId) openNegotiation('free', playerId)
      break
    case 'club-buy-ai':
      if (playerId) openNegotiation('club', playerId, actionEl.dataset.team ?? '')
      break
    case 'contract-renew': {
      if (!playerId) break
      const result = renewContract(game, playerId, 2)
      if (result.ok) persist()
      showNotice(result.ok ? '已续约 2 年。' : `续约失败：${result.error ?? '未知错误'}`)
      break
    }
    case 'contract-release': {
      if (!playerId) break
      const result = releasePlayer(game, playerId)
      if (result.ok) persist()
      showNotice(result.ok ? '已解约，球员进入自由市场。' : `解约失败：${result.error ?? '未知错误'}`)
      break
    }
    case 'go-club':
      ui.clubTab = (actionEl.dataset.tab as ClubTab | undefined) ?? 'facilities'
      go('club')
      break
    case 'go-transfer':
      ui.transferTab = (actionEl.dataset.tab as TransferTab | undefined) ?? 'market'
      go('transfer')
      break
    case 'account-open':
      ui.accountOpen = true
      ui.authMode = 'login'
      render()
      break
    case 'account-close':
      ui.accountOpen = false
      render()
      break
    case 'account-mode': {
      const mode = publicConfig.registration
      if (mode !== 'open' && mode !== 'invite') {
        showNotice(mode === 'closed' ? '本服务器已关闭注册。' : '服务器不可达，无法注册。')
        break
      }
      ui.authMode = ui.authMode === 'login' ? 'register' : 'login'
      ui.turnstileToken = ''
      render()
      break
    }
    case 'account-submit':
      void submitAccount()
      break
    case 'agent-token':
      void createAgentTokenOnline().then(async (token) => {
        try { await navigator.clipboard.writeText(token) } catch { /* 剪贴板不可用时直接显示令牌。 */ }
        ui.notice = `Agent 令牌已复制：${token}`
        render()
      }).catch((error) => { ui.notice = error instanceof Error ? error.message : '生成失败'; render() })
      break
    case 'agent-revoke':
      if (!window.confirm('重置后旧 Agent 令牌立即失效，确定吗？')) break
      void revokeAgentTokenOnline().then(() => { ui.notice = 'Agent 令牌已重置，请重新复制给 AI。'; render() }).catch((error) => { ui.notice = error instanceof Error ? error.message : '重置失败'; render() })
      break
    case 'account-logout':
      void logoutOnline().then(() => {
        ui.notice = '已退出联机账号，继续使用本地存档。'
        render()
      })
      break
    case 'new-game':
      if (onlineState.status === 'online') { showNotice('联机账号不能重开个人世界；请先退出账号再创建本地存档。'); break }
      if (game.activeMatch?.context.isLeague) { showNotice('联赛进行中不能开始新游戏。'); break }
      openNewGamePicker(false)
      render()
      break
    case 'newgame-close':
      if (ui.newGameRequired) break
      ui.newGameOpen = false
      render()
      break
    case 'newgame-pick':
      ui.newGameClubId = actionEl.dataset.club ?? null
      render()
      break
    case 'newgame-confirm':
      if (onlineState.status === 'online') { showNotice('联机账号不能重开个人世界。'); break }
      stopTimer()
      clearSave()
      setGame(createWorldGame(ui.newGamePreview?.seed, ui.newGameClubId ?? undefined))
      ui.newGameOpen = false
      ui.newGamePreview = null
      saveGame(game)
      setTeamPickPending(false)
      ui.newGameRequired = false
      Object.assign(ui, { screen: 'home', trainingPlayerId: null, trainingTeammateIds: [], detailPlayerId: null, reviewId: null, lineupDraft: null, lineupSlot: null, autoSubsDraft: null, notice: '新游戏已创建。', matchEngine: null, matchPlaying: false, completing: false, coachPanel: false, seasonRound: null, worldDivision: null, worldClubId: null, worldPlayerId: null, newGameOpen: false, newGameClubId: null })
      render()
      break
    case 'detail':
      if (playerId && ui.lineupSlot && ui.screen === 'lineup') {
        // 正在选人时点名字就是换人：和横幅上「点击下面的球员替换」一致，不再弹详情。
        const target = selectedSlotTarget(ui.lineupSlot)
        ui.lineupSlot = null
        moveInDraft(playerId, target)
        break
      }
      if (playerId) {
        ui.detailPlayerId = playerId
        render()
      }
      break
    case 'close-detail':
      ui.detailPlayerId = null
      render()
      break
    case 'close-club-view':
      ui.clubViewId = null
      ui.clubViewPlayerId = null
      render()
      break
    case 'start-training':
      if (playerId) startTrainingFor(playerId)
      break
    case 'open-training':
      if (playerId) openTraining(playerId)
      break
    case 'training-execute':
      executeTraining()
      break
    case 'event-option':
      if (actionEl.dataset.option) chooseEvent(actionEl.dataset.option)
      break
    case 'training-auto-mode': {
      const id = playerId ?? ui.trainingPlayerId
      if (!id) break
      const mode = actionEl.dataset.mode === 'targets' || actionEl.dataset.mode === 'max' ? actionEl.dataset.mode : 'priority'
      setAutoTrainingConfig(game, id, { mode })
      persist()
      ui.notice = mode === 'targets' ? '自动培养改为：把主属性补到最低目标。' : mode === 'max' ? '自动培养改为：每次选属性成长最多的那一项。' : '自动培养改为：按属性优先级依次练满。'
      render()
      break
    }
    case 'training-auto-priority': {
      const id = playerId ?? ui.trainingPlayerId
      if (!id) break
      const attr = actionEl.dataset.attr as AttrKey | undefined
      const config = autoTrainingConfig(game, id)
      const index = attr ? config.priority.indexOf(attr) : -1
      const to = actionEl.dataset.dir === 'up' ? index - 1 : index + 1
      if (index >= 0 && to >= 0 && to < config.priority.length) {
        const priority = [...config.priority]
        ;[priority[index], priority[to]] = [priority[to], priority[index]]
        setAutoTrainingConfig(game, id, { priority })
        persist()
      }
      render()
      break
    }
    case 'training-auto-reset': {
      const id = playerId ?? ui.trainingPlayerId
      const player = id ? game.roster.find((item) => item.id === id) : undefined
      if (!id || !player) break
      setAutoTrainingConfig(game, id, { priority: defaultAutoPriority(player) })
      persist()
      ui.notice = '已恢复默认优先级：先练这名球员自己的 2 个主要属性。'
      render()
      break
    }
    case 'training-auto-save': {
      const id = playerId ?? ui.trainingPlayerId
      if (!id) break
      const targets: Partial<Record<AttrKey, number>> = { ...autoTrainingConfig(game, id).targets }
      document.querySelectorAll<HTMLInputElement>('input[data-auto-target]').forEach((input) => {
        const key = input.dataset.autoTarget as AttrKey | undefined
        if (!key) return
        const value = Number(input.value)
        targets[key] = Number.isFinite(value) ? Math.round(Math.max(0, Math.min(1500, value))) : 0
      })
      setAutoTrainingConfig(game, id, { targets })
      persist()
      ui.notice = '自动培养设置已保存。'
      render()
      break
    }
    case 'training-auto-toggle': {
      const id = playerId ?? ui.trainingPlayerId
      if (!id) break
      const on = !autoTrainingConfig(game, id).autopilot
      setAutoTrainingConfig(game, id, { autopilot: on })
      persist()
      ui.notice = on ? '已开启自动培养：后续回合会自动进行。' : '已关闭自动培养。'
      render()
      break
    }
    case 'auto-strategy-open':
      if (playerId) ui.trainingPlayerId = playerId
      ui.autoStrategyOpen = true
      render()
      break
    case 'auto-strategy-close':
      ui.autoStrategyOpen = false
      render()
      break
    case 'confirm-candidate':
      if (playerId) {
        const result = confirmTraining(game, playerId)
        ui.notice = result.ok ? `${result.replacedName ?? ''} 换上了新卡，体能和精力不变。` : result.error ?? '换卡失败'
        if (result.ok) {
          ui.trainingPlayerId = playerId
          ui.lineupDraft = null
          ui.autoSubsDraft = null
        }
        render()
      }
      break
    case 'keep-candidate':
      if (playerId) {
        const result = keepTraining(game, playerId)
        ui.notice = result.ok ? '新卡留在库存，球员继续用原来的卡。' : result.error ?? '操作失败'
        render()
      }
      break
    case 'discard-candidate':
      if (playerId) {
        const result = discardTraining(game, playerId)
        ui.notice = result.ok ? '已丢弃这张卡，球员继续用原来的卡。' : result.error ?? '操作失败'
        render()
      }
      break
    case 'card-equip':
      if (playerId) equipFromUI(playerId, actionEl.dataset.card || null)
      break
    case 'card-delete':
      ui.cardDeleteId = actionEl.dataset.card ?? null
      render()
      break
    case 'card-delete-cancel':
      ui.cardDeleteId = null
      render()
      break
    case 'card-delete-confirm': {
      const result = removePlayerCard(game, actionEl.dataset.card ?? '')
      ui.cardDeleteId = null
      ui.notice = result.ok ? '已从库存删除这张卡。' : `删除失败：${result.error ?? '未知错误'}`
      render()
      break
    }
    case 'lineup-auto':
      ui.lineupDraft = autoFillLineupDraft()
      ui.notice = `${{ best: '已按 CA 和熟练度排出最强阵容', half: '已部分轮换：体力差的约一半主力换成体力好的替补', full: '已全部轮换：换上本赛季上场最少的一批人' }[ui.lineupAutoMode]}，记得保存。`
      render()
      break
    case 'lineup-save':
      applyLineup()
      break
    case 'lineup-slot':
      ui.lineupSlot = ui.lineupSlot === actionEl.dataset.slot ? null : actionEl.dataset.slot ?? null
      render()
      break
    case 'lineup-assign':
      if (playerId && ui.lineupSlot) {
        const target = selectedSlotTarget(ui.lineupSlot)
        ui.lineupSlot = null
        moveInDraft(playerId, target)
      }
      break
    case 'lineup-formation':
      if (ui.lineupDraft && actionEl.dataset.formation && actionEl.dataset.formation !== ui.lineupDraft.formationId) {
        ui.lineupDraft = structuredClone(autoFillLineup(game.roster, actionEl.dataset.formation as Lineup['formationId'], ui.lineupDraft.tactics))
        ui.lineupSlot = null
        render()
      }
      break
    case 'lineup-tactic': {
      const tactic = actionEl.dataset.tactic as keyof Tactics | undefined
      if (tactic && actionEl.dataset.value) updateLineupDraft((draft) => { (draft.tactics as unknown as Record<string, string>)[tactic] = actionEl.dataset.value! })
      break
    }
    case 'auto-sub-add':
      if (ui.autoSubsDraft && ui.autoSubsDraft.timed.length < 3) {
        ui.autoSubsDraft.timed.push({ atMinute: 5, outId: '', inId: '' })
        render()
      }
      break
    case 'auto-sub-remove':
      if (ui.autoSubsDraft) {
        ui.autoSubsDraft.timed.splice(Number(actionEl.dataset.index), 1)
        render()
      }
      break
    case 'start-league': {
      if (ui.completing) break
      ui.completing = true
      try {
        if (isOnlineMode()) await leagueActionOnline({ action: 'start_league' })
        else {
          const result = startLeagueOnMatchday(game)
          if (!result.ok) throw new Error(result.error ?? '无法开始比赛')
          if (result.gameDays > 0) {
            ui.notice = `已跳至第 ${game.season.round} 轮比赛日（前进 ${Math.round(result.gameDays * 10) / 10} 个游戏日），全队体能已按时间恢复。`
          }
          advanceLeagueRealtime(game)
        }
        ui.screen = 'match'
        ui.matchEngine = restoreActiveEngine(game)
        ui.matchPlaying = false
        ui.coachPanel = false
        if (!isOnlineMode()) persist()
        render()
      } catch (error) {
        showNotice(error instanceof Error ? error.message : '无法开始比赛')
      } finally {
        ui.completing = false
      }
      break
    }
    case 'skip-postseason': {
      if (isOnlineMode()) break
      const jump = skipToPostseasonEnd(game)
      if (!jump.ok) {
        showNotice(jump.error ?? '无法跳过赛后休整')
        break
      }
      const next = startNextSeasonAction(game)
      ui.notice = next.ok
        ? `已跳至新赛季：第 ${game.season.index} 赛季开始（前进 ${Math.round(jump.gameDays * 10) / 10} 个游戏日）。`
        : next.error ?? '休整已结束，可以开始下一赛季'
      persist()
      render()
      break
    }
    case 'next-season': {
      if (isOnlineMode()) {
        try {
          await nextWorldSeasonOnline()
          ui.notice = '全服已同步进入新赛季；升降级、年龄与合同已结算。'
        } catch (error) { ui.notice = error instanceof Error ? error.message : '全服赛季尚未结束' }
      } else {
        const result = startNextSeasonAction(game)
        ui.notice = result.ok ? '新赛季已开始；升级附加赛、升降级、年龄与合同已结算。' : result.error ?? '无法开始下一赛季'
        if (result.ok) persist()
      }
      render()
      break
    }
    case 'sim-round': {
      const result = simulateSeasonRound(game)
      ui.notice = result.ok ? '本轮 AI 比赛已模拟。' : result.error ?? '无法模拟'
      render()
      break
    }
    case 'season-round': {
      const delta = Number(actionEl.dataset.delta)
      ui.seasonRound = delta === 0 ? null : (ui.seasonRound ?? game.season.round) + delta
      render()
      break
    }
    case 'start-world-challenge': {
      const teamId = actionEl.dataset.team
      if (!teamId) break
      if (isOnlineMode()) {
        void (async () => {
          const fetched = await fetchFriendlyTeam(teamId)
          if ('error' in fetched) { showNotice(fetched.error); return }
          openFriendly(startChallengeWithOpponent(game, fetched.team))
        })()
      } else {
        openFriendly(startWorldChallenge(game, teamId))
      }
      break
    }
    case 'start-challenge': {
      const teamId = actionEl.dataset.team
      if (!teamId) break
      openFriendly(startSingleChallenge(game, teamId))
      break
    }
    case 'match-toggle':
      if (!ui.matchEngine || game.activeMatch?.context.isLeague) break
      if (ui.matchEngine.state.finished) completeMatch()
      else {
        ui.matchPlaying = !ui.matchPlaying
        if (!ui.matchPlaying) stopTimer()
        render()
      }
      break
    case 'match-skip':
      if (!ui.matchEngine || game.activeMatch?.context.isLeague) break
      ui.matchEngine.simulate()
      completeMatch()
      break
    case 'boot-online':
      ui.bootGate = false
      if (hasOnlineSession()) {
        joinOnline()
        render()
      } else {
        ui.accountOpen = true
        render()
      }
      break
    case 'boot-offline':
      // 保留令牌，但这次不连服务器：不会建立 remote saver，存档只留在本机。
      ui.bootGate = false
      ui.notice = '离线模式：本次不会连接服务器。'
      // 本地存档是系统自动建的、还没自己选过球队：先让玩家挑一支。
      if (teamPickPending()) openNewGamePicker(true)
      render()
      break
    case 'match-coach':
      if (game.activeMatch?.context.isLeague) {
        ui.coachPanel = !ui.coachPanel
        render()
        break
      }
      // 打开/收起面板都不消耗暂停次数，只有真正做出调整才扣（见 match-tactics-apply / match-sub）。
      if (ui.coachPanel) {
        ui.coachPanel = false
        ui.coachPauseUsed = false
        if (ui.matchEngine && !ui.matchEngine.state.finished) ui.matchPlaying = true
        render()
        break
      }
      if ((game.activeMatch?.coachPausesLeft ?? 0) <= 0) {
        showNotice('教练暂停已用完。')
        break
      }
      ui.matchPlaying = false
      stopTimer()
      ui.coachPanel = true
      ui.coachPauseUsed = false
      render()
      break
    case 'match-tactics-apply':
      if (ui.matchEngine) {
        const mentality = (document.getElementById('match-mentality') as HTMLSelectElement | null)?.value as MatchMentality
        if (game.activeMatch?.context.isLeague && isOnlineMode()) {
          try {
            await leagueActionOnline({ action: 'set_match_tactics', mentality })
            ui.notice = '战术已更新。'
          } catch (error) { ui.notice = error instanceof Error ? error.message : '更新失败' }
        } else {
          if (game.activeMatch?.context.isLeague) tickRealtimeLeague()
          if (!ui.matchEngine || !game.activeMatch) break
          // 友谊赛：同一次暂停里的第一次调整扣 1 次，之后不再重复扣。
          if (!game.activeMatch.context.isLeague) {
            const pause = reserveCoachPause(game, ui.coachPauseUsed)
            if (!pause.ok) { ui.notice = pause.error ?? '无法暂停'; render(); break }
            ui.coachPauseUsed = pause.used
          }
          const result = changeMatchTactics(game, ui.matchEngine, mentality)
          ui.notice = result.ok ? '战术已更新。' : result.error ?? '更新失败'
        }
        render()
      }
      break
    case 'match-sub': {
      if (!ui.matchEngine) break
      const out = (document.getElementById('match-out') as HTMLSelectElement | null)?.value
      const input = (document.getElementById('match-in') as HTMLSelectElement | null)?.value
      if (!out || !input) break
      if (game.activeMatch?.context.isLeague && isOnlineMode()) {
        try {
          await leagueActionOnline({ action: 'substitute', outId: out, inId: input })
          ui.notice = '换人完成。'
        } catch (error) { ui.notice = error instanceof Error ? error.message : '换人失败' }
      } else {
        if (game.activeMatch?.context.isLeague) tickRealtimeLeague()
        if (!ui.matchEngine || !game.activeMatch) break
        if (!game.activeMatch.context.isLeague) {
          const pause = reserveCoachPause(game, ui.coachPauseUsed)
          if (!pause.ok) { ui.notice = pause.error ?? '无法暂停'; render(); break }
          ui.coachPauseUsed = pause.used
        }
        const result = makeSubstitution(game, ui.matchEngine, out, input)
        ui.notice = result.ok ? '换人完成。' : result.error ?? '换人失败'
      }
      render()
      break
    }
    case 'open-review':
      if (recordId) {
        resetReplay(recordId)
        ui.reviewId = recordId
        ui.screen = 'review'
        persist()
        render()
      }
      break
    case 'replay-toggle':
      if (replay.playing) stopReplay()
      else {
        const record = [...game.matchHistory, ...game.challengeHistory].find((item) => item.id === ui.reviewId)
        if (record && replay.index < (record.commentary ?? record.keyEvents).length) replay.playing = true
      }
      render()
      break
    case 'replay-reset':
      resetReplay(ui.reviewId ?? '')
      render()
      break
    case 'replay-speed':
      replay.speed = replay.speed === 1 ? 2 : replay.speed === 2 ? 4 : 1
      if (replay.timer !== null) { window.clearTimeout(replay.timer); replay.timer = null }
      render()
      break
    case 'back-review':
      stopReplay()
      ui.reviewId = null
      render()
      break
    case 'go-home':
      go('home')
      break
    case 'dismiss-notice':
      ui.notice = ''
      render()
      break
  }
})

document.addEventListener('change', (event) => {
  const target = event.target as HTMLSelectElement | HTMLInputElement
  if (target.id === 'lineup-auto-mode') {
    ui.lineupAutoMode = target.value === 'half' || target.value === 'full' ? target.value : 'best'
    render()
    return
  }
  if (target.id === 'academy-era') {
    ui.academyEra = target.value
    persist()
    render()
    return
  }
  if (target.id === 'inventory-sort') {
    ui.inventorySort = target.value as typeof ui.inventorySort
    render()
    return
  }
  if (target.dataset.cardPlayer) {
    equipFromUI(target.dataset.cardPlayer, target.value || null)
    return
  }
  if (target.dataset.negoOffer !== undefined && ui.negotiation) {
    const raw = (target as HTMLInputElement).valueAsNumber
    const offer = Math.max(ui.negotiation.asking, Number.isFinite(raw) ? Math.round(raw) : ui.negotiation.asking)
    ui.negotiation.offer = offer
    ui.negotiation.message = undefined
    render()
    return
  }
  if (target.dataset.movePlayer) {
    const destination = parseLineupTarget(target.value)
    if (destination) moveInDraft(target.dataset.movePlayer, destination)
    return
  }
  if (target.dataset.slotPlayer) {
    const slotId = target.dataset.slotPlayer
    if (target.value) moveInDraft(target.value, { slotId })
    else updateLineupDraft((draft) => clearStarter(draft, slotId))
    return
  }
  if (target.dataset.benchPlayer !== undefined) {
    const index = Number(target.dataset.benchPlayer)
    if (target.value) moveInDraft(target.value, { benchIndex: index })
    else updateLineupDraft((draft) => { draft.bench.splice(index, 1) })
    return
  }
  if (target.dataset.trainingTeammate !== undefined) {
    const id = target.dataset.trainingTeammate
    ui.trainingTeammateIds = (target as HTMLInputElement).checked ? [...new Set([...ui.trainingTeammateIds, id])] : ui.trainingTeammateIds.filter((item) => item !== id)
    render()
    return
  }
  if (target.id === 'training-player-select') {
    ui.trainingTeammateIds = []
    ui.trainingPlayerId = target.value || null
    ui.trainingKind = 'drill'
    ui.trainingAttr = 'passing'
    render()
    return
  }
  if (target.id === 'training-protection') {
    ui.trainingProtection = target.value as 'prevention' | 'resilience'
    render()
    return
  }
  if (target.id === 'training-mentor') {
    ui.trainingMentorId = target.value
    ui.trainingSkill = null
    render()
    return
  }
  if (target.id === 'training-skill') {
    ui.trainingSkill = target.value as SkillId
    render()
    return
  }
  if (target.id === 'training-position') {
    ui.trainingPosition = target.value as Position
    render()
    return
  }
  if (target.id === 'auto-sub-stamina' && ui.autoSubsDraft) {
    ui.autoSubsDraft.staminaBelow = target.value ? Number(target.value) : null
    render()
    return
  }
  if (target.id === 'auto-sub-injury' && ui.autoSubsDraft) {
    ui.autoSubsDraft.onInjury = (target as HTMLInputElement).checked
    render()
    return
  }
  if (ui.autoSubsDraft) {
    const time = target.dataset.autoSubTime
    const out = target.dataset.autoSubOut
    const input = target.dataset.autoSubIn
    if (time !== undefined || out !== undefined || input !== undefined) {
      const index = Number(time ?? out ?? input)
      const rule = ui.autoSubsDraft.timed[index]
      if (rule) {
        if (time !== undefined) {
          rule.atMinute = Math.round(Number(target.value) * 10) / 10
          delete rule.atSeconds
        }
        if (out !== undefined) rule.outId = target.value
        if (input !== undefined) rule.inId = target.value
      }
      render()
      return
    }
  }
  const roleSlot = target.dataset.lineupRole
  if (roleSlot && ui.lineupDraft) {
    updateLineupDraft((draft) => {
      const starter = draft.starters.find((item) => item.slotId === roleSlot)
      if (starter) starter.role = target.value as RoleId
    })
  }
})

document.addEventListener('input', (event) => {
  const target = event.target as HTMLInputElement
  if (target.id === 'academy-search') {
    ui.academySearch = target.value
    render()
  }
  if (target.id === 'inventory-search') {
    ui.inventorySearch = target.value
    render()
  }
})

/* 战术页拖放：把球员拖到球场位置、替补位或未入选分组。触屏用下拉框。 */
let dragPlayerId: string | null = null
let dropZone: HTMLElement | null = null

function setDropZone(zone: HTMLElement | null): void {
  if (zone === dropZone) return
  dropZone?.classList.remove('drop-over')
  zone?.classList.add('drop-over')
  dropZone = zone
}

document.addEventListener('dragstart', (event) => {
  const source = (event.target as HTMLElement).closest?.<HTMLElement>('[data-drag-player]')
  if (!source?.dataset.dragPlayer) return
  dragPlayerId = source.dataset.dragPlayer
  event.dataTransfer?.setData('text/plain', dragPlayerId)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
})

document.addEventListener('dragover', (event) => {
  if (!dragPlayerId) return
  const zone = (event.target as HTMLElement).closest?.<HTMLElement>('[data-drop]') ?? null
  setDropZone(zone)
  if (zone) event.preventDefault()
})

document.addEventListener('drop', (event) => {
  if (!dragPlayerId) return
  const zone = (event.target as HTMLElement).closest?.<HTMLElement>('[data-drop]')
  const destination = zone?.dataset.drop ? parseLineupTarget(zone.dataset.drop) : null
  const playerId = dragPlayerId
  dragPlayerId = null
  setDropZone(null)
  if (!destination) return
  event.preventDefault()
  ui.lineupSlot = null
  moveInDraft(playerId, destination)
})

document.addEventListener('dragend', () => {
  dragPlayerId = null
  setDropZone(null)
})

document.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement
  if (event.key === 'Escape') {
    if (ui.newGameOpen) {
      if (ui.newGameRequired) return
      ui.newGameOpen = false
    } else if (ui.autoStrategyOpen) ui.autoStrategyOpen = false
    else if (ui.accountOpen) ui.accountOpen = false
    else if (ui.detailPlayerId) ui.detailPlayerId = null
    else return
    render()
    return
  }
  if (event.key === 'Enter' && target.id === 'club-search') {
    ui.clubSearch = (target as HTMLInputElement).value
    ui.clubPage = 0
    render()
    return
  }
  if (event.key === 'Enter' && (target.id === 'account-username' || target.id === 'account-password' || target.id === 'account-invite')) {
    void submitAccount()
    return
  }
  // 整行可点的表格行也要能用键盘操作。
  if ((event.key === 'Enter' || event.key === ' ') && target.matches('tr[data-action], [role="button"][data-action]')) {
    event.preventDefault()
    target.click()
  }
})

function autoAdvanceSeason(): void {
  if (isOnlineMode() || game.activeMatch || game.season.finished) return
  const result = catchUpSeason(game)
  if (result.advanced <= 0) return
  refreshClubMarket(game, Math.max(1, game.season.round - 1))
  ui.notice = `已自动结算 ${result.advanced} 轮比赛。`
  persist()
  render()
}

function tickRealtimeLeague(): void {
  const active = game.activeMatch
  if (!active?.context.isLeague) return
  if (!isOnlineMode() && advanceLeagueRealtime(game)) {
    if (game.activeMatch && ui.screen === 'match') ui.matchEngine = restoreActiveEngine(game)
    else if (!game.activeMatch) openFinishedLeague(active)
    persist()
    render()
  }
  if (ui.screen === 'match' && game.activeMatch?.context.isLeague) {
    const clock = document.querySelector<HTMLElement>('[data-league-clock]')
    if (clock) clock.textContent = clockText(leagueDisplayClock(game.activeMatch))
    drawPitch()
  }
}

window.addEventListener('beforeunload', () => {
  if (ui.screen) game.ui = { screen: ui.screen }
  if (ui.screen === 'match' && ui.matchEngine && game.activeMatch && !game.activeMatch.context.isLeague) game.activeMatch.engineState = ui.matchEngine.serialize()
  saveGame(game)
})

setPesViewHooks({
  refresh: () => render(),
  finished: () => completeMatch(),
  save: (engine) => syncActiveEngine(game, engine),
})
window.setInterval(tickRealtimeLeague, 1000)
// 竞拍倒计时每秒走，不用整页重绘。
window.setInterval(() => {
  for (const element of document.querySelectorAll<HTMLElement>('[data-countdown-end]')) {
    const left = Number(element.dataset.countdownEnd) - serverNow()
    element.textContent = countdownText(left)
    element.classList.toggle('urgent', left < 60_000)
  }
}, 1000)
window.setInterval(autoAdvanceSeason, 30_000)
window.setInterval(() => { if (ui.screen !== 'match') render() }, 30_000)
window.setInterval(() => { if (ui.screen === 'world') void refreshPublicWorld() }, 120_000)
installTooltips()
autoAdvanceSeason()
render()
bootOnline()
