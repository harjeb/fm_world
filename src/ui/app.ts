import type { AttrKey, AutoTrainingPresetId, DetailedPosition, GameState, Lineup, MatchMentality, MatchRecord, Player, Position, RoleId, SkillId, Tactics } from '../game/types.ts'
import { cacheGameLocally, cacheOnlineGame, loadGame, saveGame, setTeamPickPending, teamPickPending, upgradeLegacySignatures } from '../game/state.ts'
import { createWorldGame, previewD2Clubs, worldTransferTeams } from '../game/world.ts'
import { previewContractRenewal } from '../game/wages.ts'
import { friendlyStepMs } from './match-timing.ts'
import { filterTrainingBookIds, trainingBookLoadout } from './training-books.ts'
import {
  applyAutoTrainingPreset,
  autoPresetLabel,
  autoTrainingConfig,
  autoTrainingRunnable,
  defaultAutoPriority,
  autoTrainingStep,
  changeMatchAutoSubs,
  changeMatchTactics,
  confirmTraining,
  discardTraining,
  equipPlayerCard,
  finishMatch,
  issueMatchShout,
  keepTraining,
  makeSubstitution,
  maxTrainingBooks,
  removePlayerCard,
  restoreActiveEngine,
  setAutoTrainingConfig,
  setTrainingBookLoadout,
  setLineup,
  simulateSeasonRound,
  startLeague,
  startLeagueOnMatchday,
  startTrainingWithSupport,
  startNextSeasonAction,
  startChallengeWithOpponent,
  startSingleChallenge,
  startLegendChallenge,
  startPeakChallenge,
  enterCupAction,
  startCupMatch,
  startWorldChallenge,
  startTraining,
  syncActiveEngine,
  trainingAction,
  trainingEventChoice,
  reserveCoachPause,
} from '../game/actions.ts'
import { TRAINING_POINT_TIERS, type TrainingActionId } from '../game/training.ts'
import type { TrainingActivityId } from '../game/training-calendar.ts'
import { autoAssignLineup, autoFillLineup, clearStarter, movePlayer, type LineupTarget } from '../game/squad.ts'
import {
  cloneInstructions,
  instructionsFromLegacyTactics,
  isStyleId,
  legacyTacticsFromInstructions,
  setInstructionField,
  styleByRevision,
  type InstructionFieldId,
} from '../game/pes/tactics.ts'
import { isMatchPlanId } from '../game/pes/match-plan.ts'
import { seasonStats } from '../game/player-stats.ts'
import { injuryUntil } from '../game/injury.ts'
import { mainAttrsFor } from '../game/rating.ts'
import { attrLabel } from '../game/data/attributes.ts'
import { claimPeakReward } from '../game/peak-reward.ts'
import { applyPeakBreakthrough } from '../game/peak-milestones.ts'
import { cardDisplayName, cardsOf, ensureCards, playerCards, recyclePlayerCards, setCardRecycleLock, untrainedPlayer } from '../game/cards.ts'
import { SCOUT_LEVELS, startScouting, deleteScoutReport, type ScoutLevel, type ScoutSource } from '../game/scouting.ts'
import { aiTransferOffers } from '../game/market.ts'
import { isLocalFreeAgentAvailable } from '../game/free-market.ts'
import { upgradeBurstAttr, upgradeNames, upgradeStarTraits } from '../game/names.ts'
import { PLAYER_TEAM_ID, catchUpSeason, lineupLockState, settleGameConditions, skipToPostseasonEnd } from '../game/season.ts'
import { fetchFriendlyTeam, flushOnlineNow, isOnlineMode } from '../online.ts'
import { advanceLeagueRealtime, leagueDisplayClock, setLeagueClock } from '../game/realtime.ts'
import { displayClock } from '../game/match/time.ts'
import { hasSeenLatestChangelog, markChangelogSeen } from '../game/changelog.ts'
import { emptyAutoSubs } from '../game/match/management.ts'
import { SHOUT_META, isShoutKind } from '../game/match/shouts.ts'
import { economyOf, payWageArrears, upgradeFacility, type FacilityId } from '../game/economy.ts'
import { BOARD_AMBITION_META, BOARD_WAGE_SLIDER_ROUNDS, adjustBoardBudgetSlider, chooseBoardAmbition, isBoardAmbition, isBoardTier } from '../game/board.ts'
import { leadingBid, type Auction, type AuctionResult } from '../game/auction.ts'
import { bestMarketValue, cancelListing, clubSaleTerms, freeAgentAsking, listPlayer, releasePlayer, renewContract, signWorldClubPlayer, signFreeAgent } from '../game/market.ts'
import { minimumBid } from '../game/auction.ts'
import { SEASON_GOAL_LABELS, SQUAD_ROLE_LABELS, type SeasonGoal, type SquadRole } from '../game/negotiation.ts'
import { clubNameError, normalizeClubName } from '../game/club-name.ts'
import { adjustBoardBudgetOnline, aiTransferMarket, bidOnline, buyFromAIClubOnline, buyShopBookOnline, chatState, chooseBoardAmbitionOnline, claimAchievementOnline, claimPeakRewardOnline, createAgentTokenOnline, hasOnlineSession, initOnline, leagueActionOnline, loadPublicConfig, loginOnline, logoutOnline, markChatSeen, marketState, nextWorldSeasonOnline, onlineState, publicConfig, publicWorld, recycleCardsOnline, refreshAITransferMarket, refreshChatOnline, refreshGameOnline, refreshPublicWorld, refreshRegistrationClubs, registerOnline, renameClubOnline, respondOfferOnline, revokeAgentTokenOnline, sendChatOnline, serverNow, setCardRecycleLockOnline, startLegendOnline, startPeakOnline, startScoutingOnline, deleteScoutingOnline, startTrainingOnline, setRemoteGameHandler, subscribeChat, subscribeMarket, subscribeOnline, updateAccountCredentialsOnline, upgradeFacilityOnline } from '../online.ts'
import { agentHandoffText } from './agent-handoff.ts'
import { isHighOffer, localMarketClubs, respondToOffer } from '../game/transfers.ts'
import { UNHAPPY_HOURS } from '../game/transfer-rules.ts'
import { assetUrl, cardName, clubLook, findAnyPlayer } from './components.ts'
import { clockText, countdownText, esc, pct, playerCA } from './format.ts'
import { icon } from './icons.ts'
import { morph } from './morph.ts'
import { installTooltips, syncTooltip } from './tooltip.ts'
import { drawPitch, pitchPlaybackPending, resetPitchView } from './pitch-canvas.ts'
import { isPesEngine, setPesViewHooks } from './pes-pitch.ts'
import { game, replay, resetReplay, restoreSavedScreen, setGame, startOfflineGame, stopReplay, ui, type AchievementFilter, type AiTransferSortKey, type ClubTab, type FreeTransferSortKey, type InventoryTab, type Screen, type SellTransferSortKey, type SquadSortKey, type TransferTab } from './state.ts'
import { renderAcademy } from './screens/academy.ts'
import { renderYouth } from './screens/youth.ts'
import { ensureYouth, settleYouth, type YouthPlan } from '../game/youth.ts'
import { applyYouthAction, type YouthAction } from '../game/youth-actions.ts'
import { applyLoadedCupSeason, applyLoadedMatchRecords, loadCupSeasonOnline, loadMatchRecordOnline, refreshPublicClub, seasonEventActionOnline, youthActionOnline } from '../online.ts'
import { renderChallenge } from './screens/challenge.ts'
import { renderSeasonEvents } from './screens/events.ts'
import {
  applySeasonEventAction,
  buildFreeKickStageController,
  buildPenaltyStageController,
  currentSeasonEnvironment,
  isSeasonEventModeEnabled,
  isSeasonEventsOpen,
  type SeasonEventActionBody,
  type SeasonEventMode,
} from '../game/events/season-events.ts'
import type { CupId } from '../game/data/cup-config.ts'
import { loadPveContent } from '../game/pve-content.ts'
import { renderClub } from './screens/club.ts'
import { renderAchievements } from './screens/achievements.ts'
import { achievementCeilingBonus, claimAchievement, claimAllAchievements } from '../game/achievements.ts'
import { renderShop } from './screens/shop.ts'
import { buyShopBook } from '../game/shop.ts'
import { SKILLS } from '../game/data/skills.ts'
import { renderChatDrawer, renderChatShareModal } from './screens/chat.ts'
import { renderTransfer } from './screens/transfer.ts'
import { renderHome } from './screens/home.ts'
import { recyclableCards, renderInventory, selectedRecycleCards } from './screens/inventory.ts'
import { parseLineupTarget, renderLineup, selectedSlotTarget } from './screens/lineup.ts'
import { applyAutoSubAction, applyAutoSubFieldChange, type AutoSubScope } from './auto-sub-editor.ts'
import { renderMatch } from './screens/match.ts'
import { renderAccountOverlay, renderChangelogOverlay, renderDetailOverlay, renderNegotiationOverlay, renderNewGameOverlay } from './screens/overlays.ts'
import { comparisonCandidates } from './screens/player-comparison.ts'
import { ownerlessTeamsNow, renderClubOverlay } from './club-view.ts'
import { renderCommentary, renderReview } from './screens/review.ts'
import { cacheLocalReplay2D, cycleReplay2DSpeed, drawReplay2D, ensureReplay2D, jumpReplay2DToClock, nextReplay2DHighlight, previewReplay2DSeek, replay2d, resetReplay2D, restartReplay2D, seekReplay2D, setReplay2DHooks, toggleReplay2D, toggleReplay2DDrawer, toggleReplay2DHighlights } from './replay-2d.ts'
import { renderSeason } from './screens/season.ts'
import { renderMarketTicker, renderMobileNavSheet, renderSidebar, renderTopbar } from './screens/shell.ts'
import { buildTrainingRequest, renderAutoStrategyOverlay, renderTraining } from './screens/training.ts'
import { renderWorld } from './screens/world.ts'
import { renderSeasonCups } from './season-cup-view.ts'
import { returnToChallengeAfterWin } from './match-completion.ts'
import { latestPlayedRound } from '../game/standings-history.ts'
import { currentTheme, initTheme, isLightTheme, toggleTheme } from './theme.ts'

initTheme()
const app = document.getElementById('app')!
const SAVE_FAILURE_NOTICE = '存档保存失败：浏览器未能写入本地存档。请勿刷新或关闭页面。'

function persist(): void {
  if (ui.screen) game.ui = { screen: ui.screen }
  if (!saveGame(game)) ui.notice = SAVE_FAILURE_NOTICE
  else if (ui.notice === SAVE_FAILURE_NOTICE) ui.notice = ''
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
      ui.notice = `全服通告：${lead.club} 对 ${auction.playerName} 出价 ${lead.amount.toLocaleString()}，竞拍开始，1 小时后落槌。`
    }
  }
  const known = new Set(previousLog.map((item) => `${item.playerId}|${item.at}`))
  for (const item of marketState.log) {
    if (known.has(`${item.playerId}|${item.at}`) || !before.has(item.playerId)) continue
    const old = before.get(item.playerId)!
    if (old.bids.some((bid) => bid.accountId === me)) {
      ui.notice = item.club === game.clubName ? `你以 ${item.amount.toLocaleString()} 签下了 ${item.playerName}。` : item.club ? `${item.playerName} 被 ${item.club} 以 ${item.amount.toLocaleString()} 签下。` : `${item.playerName} 的竞拍流拍了。`
    } else if (item.club && ui.screen !== 'match') {
      // 竞拍落槌全服通告：没参与的人也能看到谁签下了谁。
      ui.notice = `全服通告：${item.club} 以 ${item.amount.toLocaleString()} 签下了 ${item.playerName}。`
    }
  }
}

/** 首次进入当前版本时自动弹出一次更新说明；启动引导或选队弹窗打开期间暂缓弹出。 */
function maybeOpenChangelog(): void {
  if (ui.bootGate || ui.accountOpen || ui.newGameOpen) return
  if (!hasSeenLatestChangelog()) {
    ui.changelogOpen = true
    markChangelogSeen()
  }
}

function getAutoSubDraft(scope: AutoSubScope) {
  if (scope === 'match') {
    if (!ui.matchAutoSubsDraft && ui.matchEngine && game.activeMatch) {
      const side = game.activeMatch.context.homeAway
      ui.matchAutoSubsDraft = structuredClone(ui.matchEngine.getTeam(side).autoSubs ?? emptyAutoSubs())
    }
    return ui.matchAutoSubsDraft
  }
  if (!ui.autoSubsDraft) ui.autoSubsDraft = structuredClone(game.autoSubs ?? emptyAutoSubs())
  return ui.autoSubsDraft
}

function pruneLiveAutoSubDraft(): void {
  if (!ui.matchAutoSubsDraft || !ui.matchEngine || !game.activeMatch) return
  const side = game.activeMatch.context.homeAway
  const team = ui.matchEngine.getTeam(side)
  const onPitchIds = new Set(team.players.filter((p) => p.onPitch).map((p) => p.sourceId))
  const benchIds = new Set(ui.matchEngine.availableBench(side).map((p) => p.sourceId))
  ui.matchAutoSubsDraft.timed = ui.matchAutoSubsDraft.timed.filter(
    (r) => (!r.outId || onPitchIds.has(r.outId)) && (!r.inId || benchIds.has(r.inId)),
  )
  if (ui.matchAutoSubsDraft.conditionRules) {
    ui.matchAutoSubsDraft.conditionRules = ui.matchAutoSubsDraft.conditionRules.filter(
      (r) => r.targetKind !== 'player' || !r.targetValue || onPitchIds.has(r.targetValue),
    )
    for (const r of ui.matchAutoSubsDraft.conditionRules) {
      if (r.inId && !benchIds.has(r.inId)) delete r.inId
    }
    if (ui.matchAutoSubsDraft.conditionRules.length === 0) delete ui.matchAutoSubsDraft.conditionRules
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
  ui.matchAutoSubsDraft = null
  ui.completing = false
  persist()
  render()
}

function showNotice(text: string): void {
  ui.notice = text
  render()
}

/** 每次打开新球员先回到档案，避免上一个人的筛选泄漏到新详情。 */
function openPlayerDetail(id: string): void {
  ui.detailPlayerId = id
  ui.playerDetailView = 'profile'
  ui.playerCompareId = null
  ui.playerCompareTab = 'overview'
  ui.playerPerformancePeriod = 'season'
  ui.playerPerformanceCompetition = 'all'
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
  ui.matchAutoSubsDraft = null
  ui.changelogOpen = false
  ui.mobileNavOpen = false
  ui.detailPlayerId = null
  ui.lineupSlot = null
  ui.screen = screen
  if (screen === 'youth' && !isOnlineMode() && !sharedActionUnavailable()) settleYouth(game, Date.now())
  if (screen === 'home') ui.newsDivision = null
  if (screen === 'season') ui.seasonRound = null
  if (screen === 'world' || screen === 'cups') void refreshPublicWorld()
  if (screen === 'world' && ui.worldClubId) loadClubRoster(ui.worldClubId)
  if (screen === 'challenge') void loadChallengeOpponents()
  if (screen === 'transfer' && ui.transferTab === 'ai' && isOnlineMode()) void refreshAITransferMarket()
  if (screen === 'lineup') {
    ui.lineupDraft = structuredClone(game.lineup)
    ui.autoSubsDraft = structuredClone(game.autoSubs ?? emptyAutoSubs())
  }
  if (screen === 'match') {
    ui.matchEngine = restoreActiveEngine(game)
    ui.matchPlaying = !!ui.matchEngine && !ui.matchEngine.state.finished && !game.activeMatch?.context.isLeague && !game.activeMatch?.preplayed
    ui.completing = false
  }
  persist()
  render()
}

function renderScreen(): string {
  switch (ui.screen) {
    case 'youth':
      return renderYouth()
    case 'club':
      return renderClub()
    case 'achievements':
      return renderAchievements()
    case 'shop':
      return renderShop()
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
    case 'cups':
      return renderSeasonCups(game, ui.seasonCupTab)
    case 'events':
      return renderSeasonEvents()
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
  if (!ui.notice || /令牌已复制|存档保存失败|正在提交青训操作/.test(ui.notice)) return
  noticeTimer = window.setTimeout(() => {
    ui.notice = ''
    render()
  }, 6000)
}

function renderNotice(): string {
  return ui.notice ? `<div class="toast" data-action="dismiss-notice" role="status">${icon('info', 15)}<span class="toast-text">${esc(ui.notice)}</span><span class="toast-close">${icon('close', 13)}</span></div>` : ''
}

let restoringGame = false
function render(): void {
  if (ui.bootGate) {
    morph(app, `${ui.accountOpen ? renderAccountOverlay() : renderBootGate()}${renderNotice()}`)
    syncNoticeTimer()
    mountTurnstile()
    return
  }
  // 服务器确认写入前锁住交互，避免其它操作用旧状态提交存档。
  app.toggleAttribute('inert', trainingStartPending || cardActionPending)
  app.setAttribute('aria-busy', String(trainingStartPending || cardActionPending))
  if (ui.screen === 'lineup' && !ui.lineupDraft) ui.lineupDraft = structuredClone(game.lineup)
  if (ui.screen === 'lineup' && !ui.autoSubsDraft) ui.autoSubsDraft = structuredClone(game.autoSubs ?? emptyAutoSubs())
  const matchSelects = '#match-mentality, #match-out, #match-in'
  const youthSelects = '[data-youth-position], [data-youth-focus], #youth-recruit-position'
  const selections = new Map([...document.querySelectorAll<HTMLSelectElement>(matchSelects)].map(select => [select.id, select.value]))
  // 只保留尚未提交的选择；不要用上一次渲染的已保存值覆盖服务器更新。
  for (const select of document.querySelectorAll<HTMLSelectElement>(youthSelects)) {
    if (select.value !== select.querySelector<HTMLOptionElement>('option[selected]')?.value) selections.set(select.id, select.value)
  }
  const pageKey = `${ui.screen}|${ui.clubTab}|${ui.transferTab}|${ui.reviewId ?? ''}|${ui.trainingPlayerId ?? ''}`
  const pageChanged = pageKey !== lastPageKey
  if (pageChanged && ui.screen === 'match') resetPitchView()
  morph(app, `
    <div class="app-shell">
      ${renderSidebar()}
      <div class="workspace">
        ${renderTopbar()}
        ${renderMarketTicker()}
        <main class="content ${ui.screen === 'lineup' ? 'wide' : ''}">${renderScreen()}</main>
        <footer class="footer">真实球星和俱乐部名称仅用于原型玩法测试；正式发行需取得相应授权。固定 PCG32 随机；同种子同输入可复现。<span class="muted"> · 构建 ${BUILD_ID}</span></footer>
      </div>
    </div>
    ${renderMobileNavSheet()}
    ${renderChatDrawer()}
    ${renderChatShareModal()}
    ${renderDetailOverlay()}
    ${renderNegotiationOverlay()}
    ${renderClubOverlay()}
    ${renderAccountOverlay()}
    ${renderAutoStrategyOverlay()}
    ${renderNewGameOverlay()}
    ${renderChangelogOverlay()}
    ${renderNotice()}
  `)
  for (const select of document.querySelectorAll<HTMLSelectElement>(`${matchSelects}, ${youthSelects}`)) {
    const value = selections.get(select.id)
    if (value !== undefined && [...select.options].some((option) => option.value === value)) select.value = value
  }
  if (pageChanged) {
    lastPageKey = pageKey
    window.scrollTo(0, 0)
    document.querySelector<HTMLElement>('.side-nav .nav-item.active')?.scrollIntoView?.({ inline: 'center', block: 'nearest' })
  }
  syncNoticeTimer()
  syncTooltip()
  syncAutoTraining()
  syncKickoffSnapshot()
  if (ui.screen === 'match') {
    drawPitch()
    ensureTimer()
    if (!game.activeMatch?.context.isLeague && !game.activeMatch?.preplayed && ui.matchEngine?.state.finished && !ui.matchPlaying && !pitchPlaybackPending() && !ui.completing) {
      window.setTimeout(() => completeMatch(), 0)
    }
  } else {
    stopTimer()
  }
  if (ui.screen === 'review') {
    scheduleReplay()
    // 联机联赛的战报可以 2D 重看，复盘明细（解说/关键事件/技能统计）按需拉取。
    const reviewRecord = [...game.matchHistory, ...game.challengeHistory].find((item) => item.id === ui.reviewId)
    ensureMatchRecordDetail(reviewRecord)
    ensureReplay2D(reviewRecord)
    drawReplay2D()
  } else {
    stopReplay()
    if (replay2d.id) resetReplay2D()
  }
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
      theme: currentTheme(),
      callback: (token: string) => { ui.turnstileToken = token },
      'expired-callback': () => { ui.turnstileToken = '' },
      'error-callback': () => { ui.turnstileToken = '' },
    })
  })
}

let autoExpandReviewId: string | null = null
const failedMatchRecords = new Set<string>()

function ensureMatchRecordDetail(record: GameState['matchHistory'][number] | undefined): void {
  if (!record?.detailDeferred || !isOnlineMode() || failedMatchRecords.has(record.id)) return
  const targetId = record.id
  void loadMatchRecordOnline(targetId).then((full) => {
    failedMatchRecords.delete(targetId)
    applyLoadedMatchRecords(game)
    if (ui.reviewId === targetId && autoExpandReviewId === targetId) {
      autoExpandReviewId = null
      replay.index = (full.commentary ?? full.keyEvents).length
    }
    if (ui.screen === 'review' && ui.reviewId === targetId) render()
  }).catch(() => {
    failedMatchRecords.add(targetId)
  })
}

let activeKickoffSnapshot: { startedAt: number; seed: number; state: unknown; manualUsed: boolean } | null = null

function syncKickoffSnapshot(): void {
  const active = game?.activeMatch
  if (!active || active.preplayed) return
  const stateClock = (active.engineState as { clock?: number } | undefined)?.clock
  if (!activeKickoffSnapshot || activeKickoffSnapshot.startedAt !== active.startedAt || activeKickoffSnapshot.seed !== active.context.seed) {
    if (typeof stateClock === 'number' && stateClock <= 0.05) {
      activeKickoffSnapshot = {
        startedAt: active.startedAt,
        seed: active.context.seed,
        state: structuredClone(active.engineState),
        manualUsed: (active.instructions?.length ?? 0) > 0,
      }
    } else {
      activeKickoffSnapshot = null
    }
    return
  }
  if ((active.instructions?.length ?? 0) > 0) activeKickoffSnapshot.manualUsed = true
}

function maybeCacheFinishedReplay(record: { id: string; seed: number; durationSeconds?: number; hasReplay?: boolean }, previous?: GameState['activeMatch']): void {
  if (record.hasReplay || !activeKickoffSnapshot || activeKickoffSnapshot.seed !== record.seed) return
  if (activeKickoffSnapshot.manualUsed || (previous?.instructions?.length ?? 0) > 0) return
  cacheLocalReplay2D(record.id, activeKickoffSnapshot.state, record.durationSeconds)
}

function openFinishedLeague(previous: NonNullable<GameState['activeMatch']>): void {
  const record = previous.preplayed && previous.context.mode === 'cup'
    ? game.challengeHistory.find(item => item.cupFixtureId === previous.context.cupFixtureId)
    : game.matchHistory.find(item => item.round === previous.context.round)
  if (ui.screen !== 'match') return
  // 直播已经结束但战报还没到（极端情况下公布晚了）：别停在空的比赛页，回首页等公布。
  if (!record) {
    if (previous.preplayed) { ui.screen = 'home'; ui.matchEngine = null; ui.coachPanel = false }
    return
  }
  maybeCacheFinishedReplay(record, previous)
  resetReplay(record.id)
  if (record.detailDeferred) autoExpandReviewId = record.id
  replay.index = (record.commentary ?? record.keyEvents).length
  ui.reviewId = record.id
  ui.reviewAutoOpen = true
  ui.screen = 'review'
  ui.matchEngine = null
  ui.coachPanel = false
  ui.notice = previous.context.mode === 'cup' ? '杯赛比赛已结束。' : '联赛比赛已结束。'
}

let lastOnlineCacheAt = 0

/** 新来的报价弹一条提示（转会页“收到的报价”里回复，4 个游戏日内不回复算拒绝）。 */
function announceNewOffers(before: ReadonlySet<string>): void {
  const fresh = (game.transferOffers ?? []).filter((offer) => offer.status === 'pending' && !before.has(offer.id))
  if (!fresh.length) return
  const offer = fresh[0]
  ui.notice = `${offer.clubName} 出价 ${offer.amount.toLocaleString()} 求购 ${offer.playerName}（身价 ${offer.value.toLocaleString()}），到转会页「收到的报价」里回复，现实 24 小时内有效。`
}

const pendingOfferIds = (): Set<string> => new Set((game.transferOffers ?? []).filter((offer) => offer.status === 'pending').map((offer) => offer.id))

function applyOnlineGame(next: GameState, notice?: string): void {
  applyLoadedCupSeason(next)
  applyLoadedMatchRecords(next)
  const firstLoad = ui.bootGate
  const offersBefore = firstLoad ? new Set<string>() : pendingOfferIds()
  const previous = game?.activeMatch
  const wasMatch = ui.screen === 'match'
  const clubChanged = firstLoad || next.clubName !== game.clubName || next.season.index !== game.season.index
  if (clubChanged) {
    ui.recycleSelectedIds = []
    ui.recycleConfirm = false
    ui.trainingPointSpend = 0
  }
  if (ui.trainingPointSpend > (next.trainingPoints ?? 0)) ui.trainingPointSpend = 0
  setGame(next)
  if (firstLoad) {
    restoreSavedScreen()
    ui.bootGate = false
  } else announceNewOffers(offersBefore)
  // 联机缓存与离线进度分开；推送频繁，缓存每隔 10 秒再更新，换队或换季例外。
  const stamp = Date.now()
  if (clubChanged || stamp - lastOnlineCacheAt > 10_000) {
    lastOnlineCacheAt = stamp
    cacheOnlineGame(next)
  }
  upgradeLegacySignatures(game)
  ensureCards(game)
  upgradeNames(game)
  upgradeStarTraits(game)
  upgradeBurstAttr(game)
  if (wasMatch && game.activeMatch) ui.matchEngine = restoreActiveEngine(game)
  else if ((previous?.context.isLeague || previous?.preplayed) && !game.activeMatch) openFinishedLeague(previous!)
  if (notice) ui.notice = notice
  maybeOpenChangelog()
  render()
  if (ui.screen === 'challenge' && ui.challengeMode === 'cup' && clubChanged) void loadChallengeOpponents()
  if (clubChanged) {
    const viewed = ui.clubViewId ?? (ui.screen === 'world' ? ui.worldClubId : null)
    if (viewed) loadClubRoster(viewed)
  }
  if ((ui.screen === 'world' || ui.screen === 'cups') && !publicWorld) void refreshPublicWorld()
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
      const clubId = ui.registrationClubId
      if (!clubId) {
        showNotice('请先选择要执教的球队；注册后不能更换。')
        return
      }
      const data = await registerOnline(username, password, { inviteCode, turnstileToken: ui.turnstileToken, clubId })
      ui.accountOpen = false
      ui.turnstileToken = ''
      ui.registrationClubId = ''
      ui.recycleSelectedIds = []
      ui.recycleConfirm = false
      ui.trainingPointSpend = 0
      applyOnlineGame(data.game, `已注册并接管 ${data.game.clubName}，注册后不能换队。`)
      return
    }
    const data = await loginOnline(username, password)
    ui.accountOpen = false
    ui.recycleSelectedIds = []
    ui.recycleConfirm = false
    ui.trainingPointSpend = 0
    applyOnlineGame(data.game, `已登录 ${data.user.username}，存档已同步。`)
  } catch (error) {
    /* Turnstile token 一次性有效，失败后清空插槽，render() 会重新挂载控件取新 token。 */
    ui.turnstileToken = ''
    document.getElementById('turnstile-slot')?.replaceChildren()
    ui.notice = error instanceof Error ? error.message : '登录失败'
    if (ui.authMode === 'register') void refreshRegistrationClubs().catch(() => {})
    render()
  }
}

async function submitAccountCredentials(): Promise<void> {
  if (ui.accountEditBusy) return
  if (!isOnlineMode()) {
    ui.accountEditError = '当前未登录联机账号。'
    render()
    return
  }
  const currentPassword = (document.getElementById('account-current-password') as HTMLInputElement | null)?.value ?? ''
  const newUsername = (document.getElementById('account-new-username') as HTMLInputElement | null)?.value.trim() ?? ''
  const newPassword = (document.getElementById('account-new-password') as HTMLInputElement | null)?.value ?? ''
  const confirmPassword = (document.getElementById('account-confirm-password') as HTMLInputElement | null)?.value ?? ''
  if (!currentPassword) {
    ui.accountEditError = '请输入当前密码。'
    render()
    return
  }
  const wantsUsername = newUsername.length > 0 && newUsername !== (onlineState.user?.username ?? '')
  const wantsPassword = newPassword.length > 0 || confirmPassword.length > 0
  if (!wantsUsername && !wantsPassword) {
    ui.accountEditError = '请输入新的用户名或新密码。'
    render()
    return
  }
  if (wantsUsername && !/^[\p{L}\p{N}_-]{2,24}$/u.test(newUsername)) {
    ui.accountEditError = '用户名需为 2-24 位字母、数字、中文、_ 或 -。'
    render()
    return
  }
  if (wantsPassword) {
    if (newPassword.length < 6) {
      ui.accountEditError = '新密码至少 6 位。'
      render()
      return
    }
    if (newPassword.length > 128) {
      ui.accountEditError = '新密码不能超过 128 位。'
      render()
      return
    }
    if (newPassword !== confirmPassword) {
      ui.accountEditError = '两次输入的新密码不一致。'
      render()
      return
    }
    if (newPassword === currentPassword) {
      ui.accountEditError = '新密码不能与当前密码相同。'
      render()
      return
    }
  }
  ui.accountEditBusy = true
  ui.accountEditError = ''
  render()
  try {
    const data = await updateAccountCredentialsOnline({
      currentPassword,
      ...(wantsUsername ? { username: newUsername } : {}),
      ...(wantsPassword ? { newPassword } : {}),
    })
    ui.accountEditNonce++
    ui.accountEditError = ''
    ui.notice = data.usernameChanged && data.passwordChanged
      ? `账号已修改为 ${data.user.username}，密码已更新（其他设备需重新登录）。`
      : data.usernameChanged
        ? `用户名已修改为 ${data.user.username}。`
        : '密码已修改，其他设备的登录已失效。'
  } catch (error) {
    ui.accountEditError = error instanceof Error ? error.message : '修改失败，请重试'
  } finally {
    ui.accountEditBusy = false
    render()
  }
}

/**
 * 启动页：每次打开页面都先问一次「登录 / 离线」。
 * 不写进存档，也不记住选择——刷新页面会再问。
 */
function renderBootGate(): string {
  const bootBgImg = `<img class="boot-gate-bg" src="${esc(assetUrl('assets/banners/bg-welcome-mode.webp'))}" alt="" aria-hidden="true">`
  if (restoringGame) return `<div class="overlay boot-gate">${bootBgImg}<div class="modal boot-modal" role="status"><h1>正在读取联机存档…</h1><p class="hint">正在向服务器获取最新进度。</p></div></div>`
  const online = hasOnlineSession()
  const name = onlineState.user ? esc(onlineState.user.username) : ''
  const light = isLightTheme()
  return `<div class="overlay boot-gate">${bootBgImg}
    <div class="modal boot-modal" data-stop="true" role="dialog" aria-modal="true" aria-label="选择游戏模式">
      <div class="boot-head">
        <div class="kicker">FM 世界</div>
        <button type="button" class="btn ghost small" data-action="theme-toggle" title="${light ? '切换到深色模式' : '切换到浅色模式'}">${icon(light ? 'moon' : 'sun', 14)}<span>${light ? '深色模式' : '浅色模式'}</span></button>
      </div>
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

function scrollChatToBottom(force = false): void {
  const el = document.getElementById('chat-messages')
  if (!el) return
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 72
  if (force || nearBottom) el.scrollTop = el.scrollHeight
}

function openChatWithShare(share: NonNullable<typeof ui.chatPendingShare>): void {
  ui.chatPendingShare = share
  ui.chatOpen = true
  ui.chatError = ''
  if (isOnlineMode()) {
    markChatSeen()
    if (!chatState.messages.length) void refreshChatOnline()
  }
  render()
  scrollChatToBottom(true)
  if (!window.matchMedia?.('(pointer: coarse)').matches) {
    ;(document.getElementById('chat-input') as HTMLInputElement | null)?.focus()
  }
}

function shareGoalFromRecord(rec: MatchRecord, goalIndex: number): void {
  const goal = rec.goalDetails?.[goalIndex]
  if (!goal) return
  const minute = displayClock(goal.clock, rec.durationSeconds ?? 600)
  openChatWithShare({
    kind: 'goal',
    recordId: rec.id,
    goalIndex,
    label: `${minute} ${goal.playerName} · ${rec.homeName} ${rec.score.home}:${rec.score.away} ${rec.awayName}`,
  })
}

async function submitChat(): Promise<void> {
  if (!isOnlineMode()) {
    ui.chatError = '请先登录联机账号后再发送消息。'
    render()
    return
  }
  const input = document.getElementById('chat-input') as HTMLInputElement | null
  const text = input?.value.trim() ?? ''
  const pending = ui.chatPendingShare
  if (!text && !pending) return
  const reqShare = pending
    ? pending.kind === 'card'
      ? { kind: 'card' as const, cardId: pending.cardId }
      : pending.kind === 'goal'
        ? { kind: 'goal' as const, recordId: pending.recordId, goalIndex: pending.goalIndex }
        : { kind: 'match' as const, recordId: pending.recordId }
    : undefined
  ui.chatError = ''
  render()
  try {
    await sendChatOnline(text, reqShare)
    ui.chatPendingShare = null
    const after = document.getElementById('chat-input') as HTMLInputElement | null
    if (after) after.value = ''
    markChatSeen()
    render()
    scrollChatToBottom(true)
    ;(document.getElementById('chat-input') as HTMLInputElement | null)?.focus()
  } catch (error) {
    ui.chatError = error instanceof Error ? error.message : '发送失败'
    render()
    ;(document.getElementById('chat-input') as HTMLInputElement | null)?.focus()
  }
}

function bootOnline(): void {
  setRemoteGameHandler((next) => applyOnlineGame(next))
  subscribeOnline(() => render())
  subscribeMarket((previous, previousLog) => announceMarket(previous, previousLog))
  subscribeChat((event) => {
    if (ui.chatOpen) {
      const box = document.getElementById('chat-messages')
      const stick = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 72 || event.added?.accountId === onlineState.user?.id
      markChatSeen()
      render()
      if (stick) scrollChatToBottom(true)
    } else {
      render()
    }
  })
  void loadPublicConfig().then(() => render())
}

/** 启动页选了「登录 / 继续联机」才去连服务器；离线模式完全不建立在线会话。 */
async function joinOnline(): Promise<void> {
  restoringGame = true
  ui.notice = ''
  render()
  try {
    const remote = await initOnline()
    if (remote) applyOnlineGame(remote, '已从服务器载入最新存档。')
    else {
      ui.notice = onlineState.error || '未能读取联机存档，请重试。'
      ui.accountOpen = !hasOnlineSession()
    }
  } finally {
    restoringGame = false
    if (ui.bootGate) render()
  }
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
  const previousActive = game.activeMatch
  const record = finishMatch(game, engine)
  ui.coachPanel = false
  ui.matchAutoSubsDraft = null
  if (record) {
    maybeCacheFinishedReplay(record, previousActive)
    if (!returnToChallengeAfterWin(ui, record)) {
      resetReplay(record.id)
      replay.index = (record.commentary ?? record.keyEvents).length
      ui.reviewId = record.id
      ui.reviewAutoOpen = true
      ui.screen = 'review'
      ui.notice = '比赛结束，赛后复盘已就绪。'
    }
  } else {
    ui.notice = '比赛尚未结束，无法记录。'
    ui.screen = 'match'
  }
  ui.completing = false
  persist()
  render()
}

function openTraining(playerId: string): void {
  if (ui.trainingPlayerId !== playerId) ui.trainingPointSpend = 0
  ui.trainingPlayerId = playerId
  ui.trainingTeammateIds = []
  ui.trainingEventReplacements = {}
  ui.trainingBookIds = trainingBookLoadout(game, playerId)
  ui.trainingKind = 'drill'
  ui.trainingAttr = 'passing'
  ui.coachPanel = false
  ui.screen = 'training'
  ui.detailPlayerId = null
  stopTimer()
  persist()
  render()
}

let trainingStartPending = false
let cardActionPending = false
let onlineSessionRequested = false
let recyclePreviewSnapshot = ''
let recyclePreviewRevision: number | null = null
let lastScoutRefreshAttempt = 0
let scoutRefreshPending = false

/** 联机回收和扣点必须等待服务器；明确选择离线模式才允许离线使用缓存存档。 */
function sharedActionUnavailable(): boolean {
  return !!game.shared && (onlineSessionRequested || !!onlineState.user) && !isOnlineMode()
}

/** 离线事务只写一次存档；无法落盘时撤销内存改动，不能显示成功。 */
function commitOfflineTransaction(action: () => { ok: boolean; error?: string }): { ok: boolean; error?: string } {
  const before = structuredClone(game)
  try {
    const result = action()
    if (!result.ok) { setGame(before); return result }
    if (saveGame(game)) return result
    setGame(before)
    return { ok: false, error: '存档保存失败，操作已撤销；请先检查浏览器存储空间。' }
  } catch (error) {
    setGame(before)
    throw error
  }
}

async function beginTraining(playerId: string): Promise<{ ok: boolean; error?: string }> {
  if (trainingStartPending) return { ok: false, error: '正在开始培养，请稍候' }
  if (sharedActionUnavailable()) return { ok: false, error: '联机连接已断开，请先重新连接服务器' }
  const points = ui.trainingPointSpend
  const player = game.roster.find((item) => item.id === playerId)
  const books = player ? filterTrainingBookIds(player, ui.trainingBookIds) : [...ui.trainingBookIds]
  if (books.length !== ui.trainingBookIds.length) {
    ui.trainingBookIds = books
    return { ok: false, error: '已移除本位置基础技能池中的技能卡，请检查配置后重新开始培养。' }
  }
  trainingStartPending = true
  syncAutoTraining()
  try {
    if (isOnlineMode()) {
      ui.notice = '服务器正在确认培养，请稍候…'
      render()
      await startTrainingOnline(playerId, books, points)
    } else {
      const result = commitOfflineTransaction(() => startTrainingWithSupport(game, playerId, undefined, books, points, false))
      if (!result.ok) return result
    }
    ui.trainingPointSpend = 0
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '无法开始培养' }
  } finally {
    trainingStartPending = false
    syncAutoTraining()
  }
}

function trainingTargetDraft(playerId: string): Partial<Record<AttrKey, number>> | undefined {
  const inputs = document.querySelectorAll<HTMLInputElement>('input[data-auto-target]')
  if (!inputs.length) return undefined
  const targets: Partial<Record<AttrKey, number>> = { ...autoTrainingConfig(game, playerId).targets }
  inputs.forEach((input) => {
    const key = input.dataset.autoTarget as AttrKey | undefined
    if (!key) return
    const value = Number(input.value)
    targets[key] = Number.isFinite(value) ? Math.round(Math.max(0, Math.min(2000, value))) : 0
  })
  return targets
}

async function startTrainingFor(playerId: string): Promise<void> {
  // 每轮都由系统自动挑 6 名陪练（含门将），不消耗他们的精力。
  const result = await beginTraining(playerId)
  if (!result.ok) {
    showNotice(result.error ?? '无法开始培养')
    return
  }
  ui.notice = '培养已开始，点数加成仅对本轮生效。'
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
  const result = trainingAction(game, playerId, buildTrainingRequest(), serverNow())
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
  const active = !trainingStartPending && !cardActionPending && ui.screen === 'training' && !!id && autoTrainingConfig(game, id).autopilot === true && autoTrainingRunnable(game, id)
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
  const replacement = [...document.querySelectorAll<HTMLSelectElement>('[data-event-replace]')].find((element) => element.dataset.eventReplace === optionId)?.value as SkillId | undefined
  const result = trainingEventChoice(game, ui.trainingPlayerId, optionId, replacement || undefined)
  if (!result.ok) {
    showNotice(result.error ?? '事件结算失败')
    return
  }
  ui.trainingEventReplacements = {}
  const outcome = result.success === undefined ? '' : result.success ? `成功（${pct(result.probability ?? 0, 0)}）` : `失败（${pct(result.probability ?? 0, 0)}）`
  ui.notice = `${result.event?.title ?? '事件'}：${outcome}${result.completed ? ' · 培养完成' : ''}`
  render()
}

function lineupLockedNow(): boolean {
  return isOnlineMode() && lineupLockState(game).locked
}

function updateLineupDraft(mutator: (draft: Lineup) => void): void {
  // 联机开赛前 30 分钟锁阵容：锁了之后不能再改首发 / 替补 / 职责 / 战术 / 自动换人。
  if (lineupLockedNow()) {
    showNotice('阵容已锁定：开赛前 30 分钟内不能修改，比赛由服务器自动结算。')
    return
  }
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
  if (lineupLockedNow()) {
    showNotice('阵容已锁定：开赛前 30 分钟内不能修改，比赛由服务器自动结算。')
    return
  }
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
  if (kind === 'club' && isOnlineMode()) {
    const quote = aiTransferMarket.offers.find((item) => item.teamId === clubId && item.player.id === playerId)
    if (!quote || quote.asking === null || quote.blocked) { showNotice(quote?.blocked ?? '球员已不在转会名单，请刷新。'); return }
    ui.negotiation = { kind, playerId, clubId, asking: quote.asking, value: quote.terms.value, offer: quote.asking, goal: 'promotion', role: 'first-team' }
    render()
    return
  }
  const player = kind === 'bid'
    ? marketState.pool.find((item) => item.id === playerId)
    : kind === 'free'
      ? game.freeStars.find((item) => item.id === playerId)
      : worldTransferTeams(game).find((team) => team.id === clubId)?.players.find((item) => item.id === playerId)
  if (!player) {
    showNotice('找不到这名球员。')
    return
  }
  const value = bestMarketValue(game, player)
  if (value <= 0) { showNotice('球员估值无效'); return }
  const auction = kind === 'bid' ? marketState.auctions.find((item) => item.playerId === playerId) : undefined
  const team = kind === 'club' ? worldTransferTeams(game).find((item) => item.id === clubId) : undefined
  const clubTerms = team ? clubSaleTerms(game, team, player) : undefined
  if (kind === 'club' && clubTerms?.asking == null) {
    showNotice(`${player.name} 是非卖品：${clubTerms?.reasons[0] ?? '俱乐部不卖'}`)
    return
  }
  const asking = kind === 'free'
    ? freeAgentAsking(game, player)
    : kind === 'club'
      ? clubTerms!.asking!
      : minimumBid(player, auction)
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

/** 战术页自动填充：轮换先排除伤停、再看体能和能力；部分轮换基于当前草稿，而不是重新洗掉首发。 */
function autoFillLineupDraft(): Lineup {
  const base = ui.lineupDraft ?? game.lineup
  const minutes = new Map(game.roster.map((player) => [player.id, seasonStats(game, player.id).minutes]))
  const now = Date.now()
  const lineup = autoAssignLineup(game.roster, base.formationId, base.tactics, base, ui.lineupAutoMode, {
    condition: (player) => player.condition ?? 100,
    minutes: (player) => minutes.get(player.id) ?? 0,
    suspended: (player) => !!game.suspensions?.[player.id],
    injured: (player) => injuryUntil(game, player, now) !== null,
  })
  return structuredClone(lineup)
}

function loadClubRoster(id: string): void {
  if (!isOnlineMode()) return
  void refreshPublicClub(id).catch(error => {
    if (ui.clubViewId === id || (ui.screen === 'world' && ui.worldClubId === id)) {
      showNotice(error instanceof Error ? error.message : '球队名单加载失败，可重新点击球队重试。')
    }
  })
}

async function loadChallengeOpponents(): Promise<void> {
  const mode = ui.challengeMode
  const season = game.season.index
  try {
    if (mode === 'cup') {
      if (game.world?.seasonCupMode === 1 || !game.pve?.cupSeasonDeferred || game.pve.cupSeason) return
      await loadCupSeasonOnline(season)
      if (game.season.index === season) applyLoadedCupSeason(game)
    } else if (mode === 'legend' || mode === 'peak') await loadPveContent()
    else return
    if (ui.screen === 'challenge' && ui.challengeMode === mode) render()
  } catch (error) {
    if (ui.screen === 'challenge' && ui.challengeMode === mode) showNotice(`对手加载失败，请重新点击挑战模式重试：${error instanceof Error ? error.message : String(error)}`)
  }
}

document.addEventListener('click', async (event) => {
  if (trainingStartPending || cardActionPending) return
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
    if (ui.transferTab === 'ai' && isOnlineMode()) void refreshAITransferMarket()
    render()
    return
  }
  const clubTab = target.closest<HTMLElement>('[data-club-tab]')
  if (clubTab?.dataset.clubTab) {
    ui.clubTab = clubTab.dataset.clubTab as ClubTab
    render()
    return
  }
  const achFilter = target.closest<HTMLElement>('[data-ach-filter]')
  if (achFilter?.dataset.achFilter) {
    ui.achievementFilter = achFilter.dataset.achFilter as AchievementFilter
    render()
    return
  }
  const seasonCupTab = target.closest<HTMLElement>('[data-season-cup-tab]')
  if (seasonCupTab?.dataset.seasonCupTab) {
    const id = seasonCupTab.dataset.seasonCupTab
    if (id === 'community' || id === 'league' || id === 'champions' || id === 'cross' || id === 'legend' || id === 'promotion') ui.seasonCupTab = id
    render()
    return
  }
  const challengeMode = target.closest<HTMLElement>('[data-challenge-mode]')
  if (challengeMode?.dataset.challengeMode) {
    ui.challengeMode = challengeMode.dataset.challengeMode as typeof ui.challengeMode
    ui.cupPreviewId = null
    ui.cupHistorySeason = null
    ui.pveTeamId = null
    ui.peakPreviewStage = null
    render()
    void loadChallengeOpponents()
    return
  }
  const pveTeam = target.closest<HTMLElement>('[data-pve-team]')
  if (pveTeam) {
    ui.pveTeamId = ui.pveTeamId === pveTeam.dataset.pveTeam ? null : pveTeam.dataset.pveTeam || null
    render()
    if (ui.pveTeamId) document.getElementById('pve-team-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  const peakStage = target.closest<HTMLElement>('[data-peak-preview]')
  if (peakStage) {
    ui.peakPreviewStage = Number(peakStage.dataset.peakPreview)
    ui.pveTeamId = null
    render()
    return
  }
  const cupHistory = target.closest<HTMLElement>('[data-cup-history]')
  if (cupHistory) {
    ui.cupPreviewId = cupHistory.dataset.cupHistory ?? null
    ui.cupHistorySeason = Number(cupHistory.dataset.season)
    render()
    return
  }
  const legendTier = target.closest<HTMLElement>('[data-legend-tier]')
  if (legendTier?.dataset.legendTier) {
    ui.legendTier = legendTier.dataset.legendTier as typeof ui.legendTier
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
    ui.worldRound = null
    ui.worldFixtureClubId = 'ALL'
    ui.worldClubId = null
    ui.worldPlayerId = null
    render()
    return
  }
  // 任何界面的球队名都能点开名单：世界页（非弹层/聊天抽屉内）就地展开，其它情况用弹层。
  const clubOpen = target.closest<HTMLElement>('[data-club-open]')
  if (clubOpen?.dataset.clubOpen) {
    if (ui.screen === 'world' && !clubOpen.closest('.chat-drawer')) {
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
    loadClubRoster(clubOpen.dataset.clubOpen)
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
  const detailView = target.closest<HTMLElement>('[data-player-detail-view]')
  if (detailView?.dataset.playerDetailView && ui.detailPlayerId) {
    const view = detailView.dataset.playerDetailView
    if (view === 'profile' || view === 'performance' || view === 'compare') {
      if (view === 'compare' && !game.roster.some(player => player.id === ui.detailPlayerId)) return
      if (view === 'compare' && !ui.playerCompareId) {
        const candidates = comparisonCandidates()
        const player = candidates.find((item) => item.id === ui.detailPlayerId)
        const others = candidates.filter((item) => item.id !== ui.detailPlayerId)
        ui.playerCompareId = (others.find((item) => !!item.positions.GK === !!player?.positions.GK) ?? others[0])?.id ?? null
      }
      ui.playerDetailView = view
      render()
    }
    return
  }
  const compareTab = target.closest<HTMLElement>('[data-player-compare-tab]')
  if (compareTab?.dataset.playerCompareTab) {
    const tab = compareTab.dataset.playerCompareTab
    if (tab === 'overview' || tab === 'attributes' || tab === 'stats' || tab === 'positions') ui.playerCompareTab = tab
    render()
    return
  }
  const performancePeriod = target.closest<HTMLElement>('[data-performance-period]')
  if (performancePeriod?.dataset.performancePeriod) {
    ui.playerPerformancePeriod = performancePeriod.dataset.performancePeriod === 'career' ? 'career' : 'season'
    render()
    return
  }
  const competition = target.closest<HTMLElement>('[data-performance-competition]')
  if (competition?.dataset.performanceCompetition) {
    const value = competition.dataset.performanceCompetition
    if (value === 'all' || value === 'league' || value === 'cup') ui.playerPerformanceCompetition = value
    render()
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
  const clubPos = target.closest<HTMLElement>('[data-club-pos]')
  if (clubPos?.dataset.clubPos) {
    ui.clubPos = clubPos.dataset.clubPos as Position | 'ALL'
    ui.clubPage = 0
    render()
    return
  }
  const clubSort = target.closest<HTMLElement>('[data-club-sort]')
  if (clubSort?.dataset.clubSort) {
    const key = clubSort.dataset.clubSort as FreeTransferSortKey
    if (ui.clubSort === key) ui.clubSortDir = ui.clubSortDir === 1 ? -1 : 1
    else {
      ui.clubSort = key
      ui.clubSortDir = key === 'ca' ? -1 : 1
    }
    ui.clubPage = 0
    render()
    return
  }
  const aiSort = target.closest<HTMLElement>('[data-ai-sort]')
  if (aiSort?.dataset.aiSort) {
    const key = aiSort.dataset.aiSort as AiTransferSortKey
    if (ui.aiBuySort === key) ui.aiBuySortDir = ui.aiBuySortDir === 1 ? -1 : 1
    else {
      ui.aiBuySort = key
      ui.aiBuySortDir = key === 'ca' || key === 'value' || key === 'minutes' ? -1 : 1
    }
    ui.aiBuyPage = 0
    render()
    return
  }
  const sellPos = target.closest<HTMLElement>('[data-sell-pos]')
  if (sellPos?.dataset.sellPos) {
    ui.sellPos = sellPos.dataset.sellPos as Position | 'ALL'
    render()
    return
  }
  const sellSort = target.closest<HTMLElement>('[data-sell-sort]')
  if (sellSort?.dataset.sellSort) {
    const key = sellSort.dataset.sellSort as SellTransferSortKey
    if (ui.sellSort === key) ui.sellSortDir = ui.sellSortDir === 1 ? -1 : 1
    else {
      ui.sellSort = key
      ui.sellSortDir = key === 'name' || key === 'pos' ? 1 : -1
    }
    render()
    return
  }
  const inventoryTab = target.closest<HTMLElement>('[data-inventory-tab]')
  if (inventoryTab?.dataset.inventoryTab) {
    ui.inventoryTab = inventoryTab.dataset.inventoryTab as InventoryTab
    render()
    return
  }
  const inventoryPos = target.closest<HTMLElement>('[data-inventory-pos]')
  if (inventoryPos?.dataset.inventoryPos) {
    ui.inventoryPos = inventoryPos.dataset.inventoryPos as Position | 'ALL'
    render()
    return
  }
  const bookTier = target.closest<HTMLElement>('[data-inventory-book-tier]')
  if (bookTier?.dataset.inventoryBookTier) {
    ui.inventoryBookTier = bookTier.dataset.inventoryBookTier as typeof ui.inventoryBookTier
    render()
    return
  }
  const bookCat = target.closest<HTMLElement>('[data-inventory-book-cat]')
  if (bookCat?.dataset.inventoryBookCat) {
    ui.inventoryBookCat = bookCat.dataset.inventoryBookCat as typeof ui.inventoryBookCat
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
  if (actionEl.dataset.asScope !== 'match' && action.startsWith('auto-sub-') && lineupLockedNow()) {
    showNotice('阵容已锁定：开赛前 30 分钟内不能修改，比赛由服务器自动结算。')
    return
  }
  const autoSubScope = applyAutoSubAction(action, actionEl, getAutoSubDraft)
  if (autoSubScope !== null) {
    render()
    return
  }
  const playerId = actionEl.dataset.player
  const recordId = actionEl.dataset.record
  switch (action) {
    case 'youth-plan':
    case 'youth-recruit_position':
    case 'youth-sign':
    case 'youth-call_up':
    case 'youth-return':
    case 'youth-promote':
    case 'youth-release': {
      if (sharedActionUnavailable()) { showNotice('联机连接已断开，请先重新连接服务器'); break }
      const kind = action.slice('youth-'.length) as YouthAction['action']
      const card = actionEl.closest('[data-youth-member]')
      const body: YouthAction = { action: kind, playerId }
      if (kind === 'plan') body.plan = {
        position: (card?.querySelector<HTMLSelectElement>('[data-youth-position]')?.value ?? '') as YouthPlan['position'],
        focus: (card?.querySelector<HTMLSelectElement>('[data-youth-focus]')?.value ?? '') as YouthPlan['focus'],
      }
      if (kind === 'recruit_position') body.position = (document.querySelector<HTMLSelectElement>('#youth-recruit-position')?.value ?? '') as YouthAction['position']
      if (kind === 'promote' && !window.confirm('正式提拔后，基础属性永久定型，不可退回青训。将开放球员卡培养，并签订低薪合同。确定提拔？')) break
      if (kind === 'release' && !window.confirm('解约不返金币、材料或球员卡，也不会补发新人。确定放弃这名青年？')) break
      const messages: Record<YouthAction['action'], string> = { plan: '培养方向已保存，下个周期生效。', recruit_position: '下期招募方向已保存。', sign: '青年已免费加入青训营。', call_up: '已临时征召，可到战术页安排上场。', return: '已返回青训营，体能和伤停保留。', promote: '已正式提拔，可以开始培养角色卡。', release: '已解约。' }
      cardActionPending = true
      try {
        if (isOnlineMode()) {
          ui.notice = '正在提交青训操作，请稍候…'
          render()
          await youthActionOnline(body)
        } else {
          const result = commitOfflineTransaction(() => applyYouthAction(game, body, Date.now()))
          if (!result.ok) throw new Error(result.error)
        }
        if (kind === 'call_up' || kind === 'return' || kind === 'promote' || kind === 'release') {
          ui.lineupDraft = null
          ui.autoSubsDraft = null
        }
        ui.notice = messages[kind]
      } catch (error) {
        ui.notice = error instanceof Error ? error.message : '青训操作失败，请刷新检查'
      } finally {
        cardActionPending = false
        render()
      }
      break
    }
    case 'buy-shop-book': {
      const skillId = actionEl.dataset.skill ?? ''
      if (!skillId) break
      if (sharedActionUnavailable()) { showNotice('联机连接已断开，请先重新连接服务器'); break }
      cardActionPending = true
      try {
        if (isOnlineMode()) {
          ui.notice = '正在兑换技能书，请稍候…'
          render()
          await buyShopBookOnline(skillId)
        } else {
          const result = commitOfflineTransaction(() => buyShopBook(game, skillId))
          if (!result.ok) throw new Error(result.error)
        }
        const name = SKILLS[skillId as SkillId]?.name ?? skillId
        ui.notice = `已兑换技能书《${name}》，可前往培养页配置。`
      } catch (error) {
        ui.notice = error instanceof Error ? error.message : '技能书兑换失败'
      } finally {
        cardActionPending = false
        render()
      }
      break
    }
    case 'claim-achievement':
    case 'claim-achievement-all': {
      const achievementId = action === 'claim-achievement' ? (actionEl.dataset.achievement ?? '') : ''
      if (action === 'claim-achievement' && !achievementId) break
      if (sharedActionUnavailable()) { showNotice('联机连接已断开，请先重新连接服务器'); break }
      cardActionPending = true
      try {
        const beforeBalance = economyOf(game).balance
        const beforeFans = economyOf(game).fans
        const beforePoints = game.shop?.points ?? 0
        const beforeCeiling = achievementCeilingBonus(game)
        if (isOnlineMode()) {
          ui.notice = '正在领取成就奖励，请稍候…'
          render()
          await claimAchievementOnline(achievementId || undefined)
        } else {
          const result = commitOfflineTransaction(() => achievementId ? claimAchievement(game, achievementId) : claimAllAchievements(game))
          if (!result.ok) throw new Error(result.error)
        }
        const gotMoney = Math.max(0, economyOf(game).balance - beforeBalance)
        const gotPoints = Math.max(0, (game.shop?.points ?? 0) - beforePoints)
        const gotFans = Math.max(0, economyOf(game).fans - beforeFans)
        const gotCeiling = Math.max(0, achievementCeilingBonus(game) - beforeCeiling)
        const parts: string[] = []
        if (gotMoney > 0) parts.push(`金币 +${gotMoney.toLocaleString()}`)
        if (gotPoints > 0) parts.push(`商店点券 +${gotPoints}`)
        if (gotFans > 0) parts.push(`球迷 +${gotFans.toLocaleString()}`)
        if (gotCeiling > 0) parts.push(`主属性上限 +${gotCeiling}`)
        ui.notice = parts.length ? `成就奖励已领取：${parts.join('，')}。` : '成就奖励已领取。'
      } catch (error) {
        ui.notice = error instanceof Error ? error.message : '领取成就奖励失败'
      } finally {
        cardActionPending = false
        render()
      }
      break
    }
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
    case 'ai-buy-refresh':
      if (isOnlineMode()) void refreshAITransferMarket()
      break
    case 'ai-buy-prev':
    case 'ai-buy-next':
      ui.aiBuyPage = Math.max(0, ui.aiBuyPage + (action === 'ai-buy-next' ? 1 : -1))
      render()
      break
    case 'offer-accept':
    case 'offer-reject': {
      const offerId = actionEl.dataset.offer
      const offer = game.transferOffers?.find((item) => item.id === offerId)
      if (!offerId || !offer) break
      const accept = action === 'offer-accept'
      if (accept && !window.confirm(`以 ${offer.amount.toLocaleString()} 把 ${offer.playerName} 卖给 ${offer.clubName}？`)) break
      if (!accept && isHighOffer(offer) && !window.confirm(`这是高价报价（身价的 ${(offer.amount / offer.value).toFixed(2)} 倍）。拒绝后 ${offer.playerName} 会不满 ${UNHAPPY_HOURS} 小时，精力恢复只剩一成。确定拒绝？`)) break
      try {
        if (isOnlineMode()) {
          const next = await respondOfferOnline(offerId, accept)
          applyOnlineGame(next, accept ? `${offer.playerName} 以 ${offer.amount.toLocaleString()} 转会 ${offer.clubName}。` : `已拒绝 ${offer.clubName} 的报价。`)
        } else {
          const buyer = localMarketClubs(game).find((club) => club.id === offer.clubId)
          const result = respondToOffer(game, offerId, accept, Date.now(), buyer, game.season.index)
          if (!result.ok) { showNotice(result.error ?? '操作失败'); break }
          ui.lineupDraft = null
          ui.autoSubsDraft = null
          persist()
          showNotice(accept ? `${offer.playerName} 以 ${offer.amount.toLocaleString()} 转会 ${offer.clubName}。` : result.unhappy ? `已拒绝。${offer.playerName} 对此不满，接下来 ${UNHAPPY_HOURS} 小时精力恢复很慢。` : `已拒绝 ${offer.clubName} 的报价。`)
        }
      } catch (error) {
        showNotice(error instanceof Error ? error.message : '操作失败')
      }
      break
    }
    case 'club-rename': {
      const input = document.querySelector<HTMLInputElement>('[data-club-name-input]')
      const name = normalizeClubName(input?.value)
      if (name === game.clubName) { showNotice('名字没有变化。'); break }
      // 先在本地查字数和格式；重名只有服务器知道全服名单，交给服务器判断。
      const error = clubNameError(name, [])
      if (error) { showNotice(error); break }
      try {
        const next = await renameClubOnline(name)
        applyOnlineGame(next, `俱乐部已改名为「${next.clubName}」。`)
      } catch (failure) {
        showNotice(failure instanceof Error ? failure.message : '改名失败')
      }
      break
    }
    case 'club-upgrade': {
      const facilityId = actionEl.dataset.facility as FacilityId
      if (isOnlineMode()) {
        try {
          const next = await upgradeFacilityOnline(facilityId)
          applyOnlineGame(next, '设施已升级。')
        } catch (failure) {
          showNotice(failure instanceof Error ? `升级失败：${failure.message}` : '升级失败')
        }
        break
      }
      const result = upgradeFacility(game, facilityId)
      if (result.ok) persist()
      showNotice(result.ok ? '设施已升级。' : `升级失败：${result.error ?? '未知错误'}`)
      break
    }
    case 'board-choose': {
      const ambition = actionEl.dataset.ambition
      if (!isBoardAmbition(ambition)) break
      const scope: 'offseason' | 'current' | undefined = actionEl.dataset.scope === 'offseason' || actionEl.dataset.scope === 'current'
        ? actionEl.dataset.scope
        : undefined
      const tier = isBoardTier(actionEl.dataset.tier) ? actionEl.dataset.tier : undefined
      const lock = actionEl.dataset.lock === '1'
      const label = BOARD_AMBITION_META[ambition].label
      const tierPrefix = tier === 'division1' ? '（若升入精英）' : tier === 'division2' ? '（若留在先锋）' : ''
      const successText = scope === 'offseason'
        ? `已预选下赛季目标${tierPrefix}：${label}（换季按实际级别生效）。`
        : lock
          ? `已确认并锁定本赛季目标：${label}。`
          : `已切换本赛季目标为「${label}」，预算与余额已同步更新。`
      const chooseOpts = { ...(scope ? { scope } : {}), ...(tier ? { tier } : {}), ...(lock ? { lock: true } : {}) }
      if (isOnlineMode()) {
        try {
          const next = await chooseBoardAmbitionOnline(ambition, chooseOpts)
          ui.boardSliderDraft = 0
          applyOnlineGame(next, successText)
        } catch (failure) {
          showNotice(failure instanceof Error ? failure.message : '董事会操作失败')
        }
        break
      }
      const result = chooseBoardAmbition(game, ambition, chooseOpts)
      if (result.ok) {
        ui.boardSliderDraft = 0
        persist()
      }
      showNotice(result.ok ? successText : (result.error ?? '董事会操作失败'))
      break
    }
    case 'board-slider-apply': {
      const delta = ui.boardSliderDraft
      if (!delta) break
      if (isOnlineMode()) {
        try {
          const next = await adjustBoardBudgetOnline(delta)
          ui.boardSliderDraft = 0
          applyOnlineGame(next, '董事会转会预算与工资帽已按滑块更新。')
        } catch (failure) {
          showNotice(failure instanceof Error ? failure.message : '预算调整失败')
        }
        break
      }
      const result = adjustBoardBudgetSlider(game, delta)
      if (result.ok) {
        ui.boardSliderDraft = 0
        persist()
      }
      showNotice(result.ok ? '董事会转会预算与工资帽已按滑块更新。' : (result.error ?? '预算调整失败'))
      break
    }
    case 'board-slider-reset':
      ui.boardSliderDraft = 0
      render()
      break
    case 'pay-wage-arrears': {
      const result = payWageArrears(game)
      if (result.ok) persist()
      showNotice(result.ok ? `已补发欠薪 ${result.paid!.toLocaleString()}，球员恢复正常发挥。` : `补发失败：${result.error ?? '未知错误'}`)
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
      const player = findAnyPlayer(draft.playerId) ?? aiTransferMarket.offers.find((item) => item.teamId === draft.clubId && item.player.id === draft.playerId)?.player
      if (!player) { ui.negotiation = null; showNotice('球员已不在转会名单，请刷新。'); break }
      if (draft.kind === 'club' && sharedActionUnavailable()) { draft.message = '联机连接已断开，请先重新连接服务器。'; render(); break }
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
      if (draft.kind === 'club' && isOnlineMode()) {
        // 联机向 AI 球队买人由服务器判定（俱乐部放人规则 + 球员诉求），成交后共享名册同步。
        try {
          const next = await buyFromAIClubOnline({ teamId: draft.clubId ?? '', playerId: draft.playerId, offer: draft.offer, goal: draft.goal, role: draft.role })
          ui.negotiation = null
          ui.lineupDraft = null
          ui.autoSubsDraft = null
          applyOnlineGame(next, `谈成了：${player.name} 加盟，花费 ${draft.offer.toLocaleString()}。`)
          void refreshAITransferMarket()
        } catch (error) {
          draft.message = error instanceof Error ? error.message : '谈判失败'
          render()
        }
        break
      }
      const result = draft.kind === 'free'
        ? signFreeAgent(game, draft.playerId, draft.offer, { goal: draft.goal, role: draft.role })
        : signWorldClubPlayer(game, draft.clubId ?? '', draft.playerId, draft.offer, { goal: draft.goal, role: draft.role })
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
    case 'registration-clubs-refresh':
      void refreshRegistrationClubs().catch((error) => showNotice(error instanceof Error ? error.message : '球队列表加载失败'))
      break
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
      const rawYears = Number(actionEl.dataset.years ?? ui.renewYearsByPlayer[playerId])
      const years = Number.isSafeInteger(rawYears) && rawYears > 0 ? rawYears : undefined
      const targetPlayer = game.roster.find((item) => item.id === playerId)
      const preview = targetPlayer ? previewContractRenewal(game, targetPlayer, years) : null
      const result = renewContract(game, playerId, years)
      if (result.ok) {
        delete ui.renewYearsByPlayer[playerId]
        persist()
        const contract = targetPlayer?.contract
        const label = preview?.isEarlyRenewal ? '已提前续约' : '已续约'
        const raiseText = preview && preview.raiseAmount > 0 ? `（+${preview.raiseAmount.toLocaleString()}）` : ''
        showNotice(`${label} ${preview?.years ?? years ?? ''} 年（至第 ${contract?.expiresSeason ?? '?'} 赛季），新工资 ${contract?.wage.toLocaleString() ?? '—'}/轮${raiseText}。`)
      } else {
        showNotice(`续约失败：${result.error ?? '未知错误'}`)
      }
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
    case 'go-cup': {
      const id = actionEl.dataset.cup
      if (id === 'community' || id === 'league' || id === 'champions' || id === 'cross' || id === 'legend' || id === 'promotion') ui.seasonCupTab = id
      go('cups')
      break
    }
    case 'changelog-open':
      ui.changelogOpen = true
      markChangelogSeen()
      render()
      break
    case 'changelog-close':
      ui.changelogOpen = false
      markChangelogSeen()
      render()
      break
    case 'account-open':
      ui.accountOpen = true
      ui.accountEditError = ''
      ui.accountEditBusy = false
      ui.authMode = 'login'
      render()
      break
    case 'account-open-credentials':
      ui.accountOpen = true
      ui.accountEditError = ''
      ui.accountEditBusy = false
      render()
      ;(document.getElementById('account-current-password') as HTMLInputElement | null)?.focus()
      break
    case 'account-close':
      ui.accountOpen = false
      ui.accountEditError = ''
      ui.accountEditBusy = false
      render()
      break
    case 'account-credentials-submit':
      void submitAccountCredentials()
      break
    case 'account-mode': {
      const mode = publicConfig.registration
      if (mode !== 'open' && mode !== 'invite') {
        showNotice(mode === 'closed' ? '本服务器已关闭注册。' : '服务器不可达，无法注册。')
        break
      }
      ui.authMode = ui.authMode === 'login' ? 'register' : 'login'
      ui.turnstileToken = ''
      ui.registrationClubId = ''
      render()
      if (ui.authMode === 'register') {
        void refreshRegistrationClubs().catch((error) => showNotice(error instanceof Error ? error.message : '球队列表加载失败'))
      }
      break
    }
    case 'account-submit':
      void submitAccount()
      break
    case 'agent-token':
      void createAgentTokenOnline().then(async (token) => {
        // 复制的是一整段接入说明：令牌 + 文档链接 + 游戏简介，粘贴给 Agent 就能直接上手。
        const text = agentHandoffText({ token, origin: window.location.origin, clubName: game.clubName })
        let copied = false
        try { await navigator.clipboard.writeText(text); copied = true } catch { /* 剪贴板不可用时直接显示令牌和文档地址。 */ }
        ui.notice = copied
          ? '已复制 Agent 接入说明（令牌 + API 文档链接 + 游戏简介），直接粘贴给 AI 即可。'
          : `剪贴板不可用，请手动复制：令牌 ${token} · 文档 ${window.location.origin}/api/agent/docs`
        render()
      }).catch((error) => { ui.notice = error instanceof Error ? error.message : '生成失败'; render() })
      break
    case 'agent-revoke':
      if (!window.confirm('重置后旧 Agent 令牌立即失效，确定吗？')) break
      void revokeAgentTokenOnline().then(() => { ui.notice = 'Agent 令牌已重置，请重新复制给 AI。'; render() }).catch((error) => { ui.notice = error instanceof Error ? error.message : '重置失败'; render() })
      break
    case 'account-logout':
      void logoutOnline().then(() => {
        onlineSessionRequested = false
        // 联机缓存只用于联机会话，不替换独立的离线档。
        const local = loadGame()
        setGame(local ?? createWorldGame())
        if (!local) setTeamPickPending(true)
        stopTimer()
        stopReplay()
        Object.assign(ui, { screen: 'home', accountOpen: false, accountEditError: '', accountEditBusy: false, matchEngine: null, matchPlaying: false, completing: false, lineupDraft: null, autoSubsDraft: null, detailPlayerId: null, clubViewId: null, trainingPlayerId: null, reviewId: null })
        if (teamPickPending()) openNewGamePicker(true)
        ui.recycleSelectedIds = []
        ui.recycleConfirm = false
        ui.trainingPointSpend = 0
        ui.notice = '已退出联机账号，继续使用本地存档。'
        render()
      })
      break
    case 'theme-toggle':
      toggleTheme()
      render()
      break
    case 'new-game':
      if (isOnlineMode() || sharedActionUnavailable()) { showNotice('联机账号不能重开个人世界；请先退出账号再创建本地存档。'); break }
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
    case 'newgame-confirm': {
      if (isOnlineMode() || sharedActionUnavailable()) { showNotice('联机账号不能重开个人世界。'); break }
      const next = createWorldGame(ui.newGamePreview?.seed, ui.newGameClubId ?? undefined)
      ensureYouth(next)
      // 新档写入成功后再切换，不先清空旧存档。
      if (!cacheGameLocally(next)) { showNotice('存档保存失败：新游戏未创建，原有存档未改动。请检查浏览器存储设置和空间。'); break }
      stopTimer()
      setGame(next)
      ui.newGameOpen = false
      ui.newGamePreview = null
      setTeamPickPending(false)
      ui.newGameRequired = false
      Object.assign(ui, { screen: 'home', trainingPlayerId: null, trainingPointSpend: 0, recycleSelectedIds: [], recycleConfirm: false, trainingBookIds: [], trainingTeammateIds: [], peakCardPlayerId: null, peakCardAttr: null, detailPlayerId: null, reviewId: null, lineupDraft: null, lineupSlot: null, autoSubsDraft: null, matchAutoSubsDraft: null, notice: '新游戏已创建。', matchEngine: null, matchPlaying: false, completing: false, coachPanel: false, seasonRound: null, newsDivision: null, worldDivision: null, worldRound: null, worldFixtureClubId: 'ALL', worldClubId: null, worldPlayerId: null, newGameOpen: false, newGameClubId: null })
      maybeOpenChangelog()
      render()
      break
    }
    case 'chemistry-detail':
      if (playerId) {
        openPlayerDetail(playerId)
        render()
      }
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
        openPlayerDetail(playerId)
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
      if (playerId) await startTrainingFor(playerId)
      break
    case 'training-points-select': {
      const points = Number(actionEl.dataset.points)
      if (playerId && playerId === ui.trainingPlayerId && TRAINING_POINT_TIERS.some((tier) => tier.points === points) && points <= (game.trainingPoints ?? 0)) {
        // 切换档位会重绘弹窗，先保留细调页尚未提交的目标值。
        const targets = trainingTargetDraft(playerId)
        if (targets) setAutoTrainingConfig(game, playerId, { targets, preset: 'custom' })
        ui.trainingPointSpend = points as 0 | 10 | 20 | 30
        render()
      }
      break
    }
    case 'open-training':
      if (playerId) openTraining(playerId)
      break
    case 'training-books-save': {
      const id = playerId ?? ui.trainingPlayerId
      if (!id) break
      const player = game.roster.find((item) => item.id === id)
      if (player) ui.trainingBookIds = filterTrainingBookIds(player, ui.trainingBookIds)
      const result = setTrainingBookLoadout(game, id, ui.trainingBookIds)
      if (!result.ok) { showNotice(result.error ?? '无法保存技能卡配置'); break }
      ui.notice = '技能卡配置已保存，下次培养也会使用。'
      persist()
      render()
      break
    }
    case 'training-execute':
      executeTraining()
      break
    case 'event-option':
      if (actionEl.dataset.option) chooseEvent(actionEl.dataset.option)
      break
    case 'training-auto-preset': {
      const id = playerId ?? ui.trainingPlayerId
      const preset = actionEl.dataset.preset as Exclude<AutoTrainingPresetId, 'custom'> | undefined
      if (!id || !preset) break
      const next = applyAutoTrainingPreset(game, id, preset)
      if (next) {
        persist()
        const player = game.roster.find((item) => item.id === id)
        if (player) ui.notice = `已选预设：${autoPresetLabel(player, next)}`
      }
      render()
      break
    }
    case 'training-auto-mode': {
      const id = playerId ?? ui.trainingPlayerId
      if (!id) break
      const mode = actionEl.dataset.mode === 'targets' || actionEl.dataset.mode === 'max' ? actionEl.dataset.mode : 'priority'
      setAutoTrainingConfig(game, id, { mode, preset: mode === 'max' ? 'max' : mode === 'targets' ? 'custom' : undefined })
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
        setAutoTrainingConfig(game, id, { priority, preset: 'custom' })
        persist()
      }
      render()
      break
    }
    case 'training-auto-reset': {
      const id = playerId ?? ui.trainingPlayerId
      const player = id ? game.roster.find((item) => item.id === id) : undefined
      if (!id || !player) break
      setAutoTrainingConfig(game, id, { preset: 'signature', mode: 'priority', priority: defaultAutoPriority(player) })
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
        targets[key] = Number.isFinite(value) ? Math.round(Math.max(0, Math.min(2000, value))) : 0
      })
      setAutoTrainingConfig(game, id, { targets, preset: 'custom' })
      persist()
      ui.notice = '最低目标设置已保存。'
      render()
      break
    }
    case 'training-auto-confirm': {
      const id = playerId ?? ui.trainingPlayerId
      if (!id) break
      const targets = trainingTargetDraft(id)
      if (!game.training[id] && !game.candidates[id]) {
        const started = await beginTraining(id)
        if (!started.ok) {
          showNotice(started.error ?? '无法开始培养')
          break
        }
        ui.trainingBookIds = []
        ui.trainingTeammateIds = []
        ui.trainingPlayerId = id
        ui.screen = 'training'
      }
      setAutoTrainingConfig(game, id, { ...(targets ? { targets, preset: 'custom' as const } : {}), autopilot: true })
      ui.autoStrategyOpen = false
      ui.autoStrategyDetail = false
      persist()
      const player = game.roster.find((item) => item.id === id)
      const label = player ? autoPresetLabel(player, autoTrainingConfig(game, id)) : ''
      ui.notice = `已开启自动培养${label ? `（${label}）` : ''}：后续回合将自动进行。`
      render()
      break
    }
    case 'training-auto-toggle': {
      const id = playerId ?? ui.trainingPlayerId
      if (!id) break
      if (autoTrainingConfig(game, id).autopilot) {
        setAutoTrainingConfig(game, id, { autopilot: false })
        persist()
        ui.notice = '已暂停自动培养。'
        render()
        break
      }
      if (ui.trainingPlayerId !== id) {
        ui.trainingPointSpend = 0
        ui.trainingBookIds = trainingBookLoadout(game, id)
      }
      ui.trainingPlayerId = id
      ui.autoStrategyOpen = true
      ui.autoStrategyDetail = false
      render()
      break
    }
    case 'auto-strategy-open':
      if (playerId && ui.trainingPlayerId !== playerId) {
        ui.trainingPlayerId = playerId
        ui.trainingPointSpend = 0
        ui.trainingBookIds = trainingBookLoadout(game, playerId)
      }
      ui.autoStrategyOpen = true
      ui.autoStrategyDetail = false
      render()
      break
    case 'auto-strategy-detail-open':
      ui.autoStrategyDetail = true
      render()
      break
    case 'auto-strategy-detail-back':
      ui.autoStrategyDetail = false
      render()
      break
    case 'auto-strategy-close':
      ui.autoStrategyOpen = false
      ui.autoStrategyDetail = false
      render()
      break
    case 'confirm-candidate':
      if (playerId) {
        const result = confirmTraining(game, playerId)
        ui.notice = result.ok ? `${result.replacedName ?? ''} 换上了新卡，体能和精力不变。` : result.error ?? '换卡失败'
        if (result.ok) {
          ui.trainingPlayerId = playerId
          ui.trainingBookIds = trainingBookLoadout(game, playerId)
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
        if (result.ok) ui.trainingBookIds = trainingBookLoadout(game, playerId)
        render()
      }
      break
    case 'discard-candidate':
      if (playerId) {
        const result = discardTraining(game, playerId)
        ui.notice = result.ok ? '已丢弃这张卡，球员继续用原来的卡。' : result.error ?? '操作失败'
        if (result.ok) ui.trainingBookIds = trainingBookLoadout(game, playerId)
        render()
      }
      break
    case 'card-equip':
      if (playerId) equipFromUI(playerId, actionEl.dataset.card || null)
      break
    case 'scout-start': {
      const source = actionEl.dataset.source
      const clubId = actionEl.dataset.club
      const level = Number(actionEl.closest('.scout-controls')?.querySelector<HTMLSelectElement>('[data-scout-level]')?.value)
      if (!playerId || (source !== 'club' && source !== 'transfer' && source !== 'market') ||
          !SCOUT_LEVELS.some(item => item.level === level) || (source !== 'market' && !clubId)) break
      if (sharedActionUnavailable()) { showNotice('联机连接已断开，请先重新连接服务器'); break }
      cardActionPending = true
      syncAutoTraining()
      try {
        if (isOnlineMode()) {
          ui.notice = '服务器正在确认球探委托，请稍候…'
          render()
          await startScoutingOnline(playerId, source as ScoutSource, level as ScoutLevel, clubId)
        } else {
          const result = commitOfflineTransaction(() => {
            let target: Player | undefined
            if (source === 'market') {
              const player = game.freeStars.find(item => item.id === playerId)
              if (player && isLocalFreeAgentAvailable(game, player, Date.now())) target = untrainedPlayer(player)
            } else if (source === 'transfer') {
              const offer = aiTransferOffers({ ...game, aiTeams: worldTransferTeams(game) }).find(item => item.team.id === clubId && item.player.id === playerId)
              if (offer) target = untrainedPlayer(offer.player)
            } else {
              const team = game.aiTeams.find(item => item.id === clubId) ?? (game.world && clubId ? ownerlessTeamsNow(game.world)[clubId] : undefined)
              target = team?.players.find(item => item.id === playerId)
            }
            return target ? startScouting(game, target, { source, ...(clubId ? { clubId } : {}) }, level, Date.now()) : { ok: false, error: '球员已不在指定球队或市场，请刷新后重试。' }
          })
          if (!result.ok) throw new Error(result.error ?? '球探委托失败')
        }
        ui.notice = '球探已出发，报告到期后可在转会页查看。'
      } catch (error) {
        ui.notice = error instanceof Error ? error.message : '球探委托失败'
      } finally {
        cardActionPending = false
      }
      render()
      break
    }
    case 'scout-delete': {
      const reportId = actionEl.dataset.report
      if (!reportId || !window.confirm('确定删除这份球探报告？删除不返费，可能结束该报告的市场暂留。')) break
      if (sharedActionUnavailable()) { showNotice('联机连接已断开，请先重新连接服务器'); break }
      cardActionPending = true
      syncAutoTraining()
      try {
        if (isOnlineMode()) await deleteScoutingOnline(reportId)
        else {
          const result = commitOfflineTransaction(() => deleteScoutReport(game, reportId, Date.now()))
          if (!result.ok) throw new Error(result.error ?? '删除失败')
        }
        ui.notice = '球探报告已删除，费用不退还。'
      } catch (error) { ui.notice = error instanceof Error ? error.message : '删除失败' }
      finally { cardActionPending = false }
      render()
      break
    }
    case 'scout-refresh': {
      if (sharedActionUnavailable()) { showNotice('联机连接已断开，请先重新连接服务器'); break }
      if (isOnlineMode() && !scoutRefreshPending) {
        scoutRefreshPending = true
        try { if (await refreshGameOnline(() => game)) ui.notice = '球探报告已刷新。' }
        catch (error) { ui.notice = error instanceof Error ? error.message : '报告刷新失败' }
        finally { scoutRefreshPending = false }
      }
      render()
      break
    }
    case 'card-recycle-select-all': {
      const ids = [...document.querySelectorAll<HTMLInputElement>('input[data-recycle-card]:not(:disabled)')]
        .map((input) => input.dataset.recycleCard).filter((id): id is string => !!id)
      ui.recycleSelectedIds = [...new Set([...ui.recycleSelectedIds, ...ids])]
      ui.recycleConfirm = false
      render()
      break
    }
    case 'card-recycle-all':
    case 'card-recycle-open': {
      if (sharedActionUnavailable()) { showNotice('联机连接已断开，请先重新连接服务器'); break }
      ui.recycleConfirm = false
      if (isOnlineMode()) {
        cardActionPending = true
        syncAutoTraining()
        ui.notice = '正在同步球员卡，请稍候…'
        render()
        try {
          await flushOnlineNow()
          if (!isOnlineMode() || onlineState.error) throw new Error(onlineState.error || '请先连接服务器')
        } catch (error) {
          cardActionPending = false
          showNotice(error instanceof Error ? error.message : '同步失败，请重试')
          break
        }
        cardActionPending = false
      }
      // 联机同步后再确定全库存清单；后续确认只提交预览过的卡。
      const cards = action === 'card-recycle-all' ? recyclableCards() : selectedRecycleCards()
      ui.recycleSelectedIds = cards.map((card) => card.id)
      if (!cards.length) { showNotice(action === 'card-recycle-all' ? '没有可回收的球员卡。' : '请先选择可回收的球员卡。'); break }
      recyclePreviewSnapshot = JSON.stringify(cards)
      recyclePreviewRevision = isOnlineMode() ? onlineState.revision : null
      ui.recycleConfirm = true
      ui.notice = '请核对回收预览；确认后无法恢复。'
      render()
      document.getElementById('recycle-preview-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      break
    }
    case 'card-recycle-cancel':
      ui.recycleConfirm = false
      render()
      break
    case 'card-recycle-lock': {
      const id = actionEl.dataset.card
      const locked = actionEl.dataset.locked === 'true'
      if (!id) break
      if (sharedActionUnavailable()) { showNotice('联机连接已断开，请先重新连接服务器'); break }
      cardActionPending = true
      syncAutoTraining()
      try {
        if (isOnlineMode()) {
          ui.notice = '服务器正在确认锁定状态，请稍候…'
          render()
          await setCardRecycleLockOnline(id, locked)
        }
        else {
          const result = commitOfflineTransaction(() => setCardRecycleLock(game, id, locked))
          if (!result.ok) throw new Error(result.error ?? '操作失败')
        }
        if (locked) ui.recycleSelectedIds = ui.recycleSelectedIds.filter((item) => item !== id)
        ui.recycleConfirm = false
        ui.notice = locked ? '球员卡已锁定，不能回收或手动删除；挂牌出售成交仍会销毁。' : '球员卡已解锁。'
      } catch (error) {
        ui.notice = error instanceof Error ? error.message : '锁定操作失败'
      } finally {
        cardActionPending = false
      }
      render()
      break
    }
    case 'card-recycle-confirm': {
      if (!ui.recycleConfirm) break
      const cards = selectedRecycleCards()
      const ids = cards.map((card) => card.id)
      if (!ids.length || JSON.stringify(cards) !== recyclePreviewSnapshot || (isOnlineMode() && recyclePreviewRevision !== onlineState.revision)) {
        ui.recycleConfirm = false
        showNotice('球员卡或存档状态已变化，请重新预览后确认。')
        break
      }
      if (sharedActionUnavailable()) { showNotice('联机连接已断开，请先重新连接服务器'); break }
      cardActionPending = true
      syncAutoTraining()
      try {
        if (isOnlineMode()) {
          ui.notice = '服务器正在确认回收，请稍候…'
          render()
          if (recyclePreviewRevision === null) throw new Error('回收预览已失效，请重新预览。')
          await recycleCardsOnline(ids, recyclePreviewRevision)
        } else {
          const result = commitOfflineTransaction(() => recyclePlayerCards(game, ids))
          if (!result.ok) throw new Error(result.error ?? '回收失败')
        }
        ui.recycleSelectedIds = []
        ui.recycleConfirm = false
        ui.notice = `已回收 ${ids.length} 张球员卡，共享培养点余额 ${game.trainingPoints ?? 0}。`
      } catch (error) {
        ui.recycleConfirm = false
        ui.notice = error instanceof Error ? error.message : '回收失败'
      } finally {
        cardActionPending = false
      }
      render()
      break
    }
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
      if (lineupLockedNow()) {
        showNotice('阵容已锁定：开赛前 30 分钟内不能修改，比赛由服务器自动结算。')
        break
      }
      ui.lineupDraft = autoFillLineupDraft()
      ui.notice = `${{ best: '已按 CA 和熟练度排出最强阵容（排除伤停）', half: '已部分轮换：保留健康首发，优先替换疲劳球员，体能相同时再看能力', full: '已全部轮换：健康、体能优先，体能相同时再看 CA 和位置适配' }[ui.lineupAutoMode]}，记得保存。`
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
      if (lineupLockedNow()) {
        showNotice('阵容已锁定：开赛前 30 分钟内不能修改，比赛由服务器自动结算。')
        break
      }
      if (ui.lineupDraft && actionEl.dataset.formation && actionEl.dataset.formation !== ui.lineupDraft.formationId) {
        const available = game.roster.filter((player) => injuryUntil(game, player) === null)
        ui.lineupDraft = structuredClone(
          autoFillLineup(available, actionEl.dataset.formation as Lineup['formationId'], ui.lineupDraft.tactics, ui.lineupDraft),
        )
        ui.lineupSlot = null
        render()
      }
      break
    case 'lineup-instruction': {
      const field = actionEl.dataset.field as InstructionFieldId | undefined
      const value = actionEl.dataset.value
      if (field && value) {
        updateLineupDraft((draft) => {
          const base = draft.tacticalInstructions ?? instructionsFromLegacyTactics(draft.tactics)
          const next = setInstructionField(base, field, value)
          draft.tacticalInstructions = next
          draft.tactics = legacyTacticsFromInstructions(next)
        })
      }
      break
    }
    case 'lineup-style-reset': {
      updateLineupDraft((draft) => {
        const styleId = draft.tacticalStyle && isStyleId(draft.tacticalStyle) ? draft.tacticalStyle : 'blank'
        const tpl = styleByRevision(styleId, 3)
        draft.tacticalStyle = styleId
        draft.tacticalInstructions = cloneInstructions(tpl.instructions)
        draft.tactics = legacyTacticsFromInstructions(tpl.instructions)
      })
      break
    }
    case 'lineup-plan-reset': {
      updateLineupDraft((draft) => {
        delete draft.matchPlan
      })
      break
    }
    case 'lineup-tactic': {
      const tactic = actionEl.dataset.tactic as keyof Tactics | undefined
      if (tactic && actionEl.dataset.value) {
        updateLineupDraft((draft) => {
          ;(draft.tactics as unknown as Record<string, string>)[tactic] = actionEl.dataset.value!
          if (draft.tacticalInstructions) {
            draft.tacticalInstructions = instructionsFromLegacyTactics(draft.tactics, draft.tacticalInstructions)
          }
        })
      }
      break
    }
    case 'start-league': {
      if (ui.completing) break
      ui.completing = true
      try {
        if (isOnlineMode()) await leagueActionOnline({ action: 'start_league' })
        else {
          const result = startLeagueOnMatchday(game)
          if (!result.ok) throw new Error(result.error ?? '无法开始比赛')
          if (result.gameDays > 0) {
            ui.notice = `已跳至第 ${game.season.round} 轮开赛时间，全队体能与精力已按时间恢复。`
          }
          advanceLeagueRealtime(game)
        }
        ui.screen = 'match'
        ui.matchEngine = restoreActiveEngine(game)
        ui.matchPlaying = false
        ui.coachPanel = false
        ui.matchAutoSubsDraft = null
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
        ? `已跳至新赛季：第 ${game.season.index} 赛季开始。`
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
        ui.notice = result.ok ? `第 ${game.season.index} 赛季已开始；升级附加赛、升降级、年龄与合同已结算。` : result.error ?? '无法开始下一赛季'
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
    case 'world-round': {
      const delta = Number(actionEl.dataset.delta)
      if (delta === 0) {
        ui.worldRound = null
      } else {
        const divId = ui.worldDivision ?? game.world?.playerDivisionId ?? 'champions'
        const snapshot = onlineState.status === 'online' ? publicWorld : null
        const divFixtures = snapshot?.divisions.find((d) => d.id === divId)?.fixtures
          ?? game.world?.divisions.find((d) => d.divisionId === divId)?.fixtures
          ?? []
        const lastRound = divFixtures.reduce((m, item) => Math.max(m, item.round), 1)
        const base = ui.worldRound ?? latestPlayedRound(divFixtures, 1)
        ui.worldRound = Math.max(1, Math.min(lastRound, base + delta))
      }
      render()
      break
    }
    case 'world-filter-club': {
      ui.worldFixtureClubId = actionEl.dataset.club || 'ALL'
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
    case 'penalty-training': {
      if (!isSeasonEventsOpen(game)) { showNotice('点球活动与训练场将于第 3 赛季（S3）开放'); return }
      try {
        const { openPenaltyTraining } = await import('./penalty/training.ts')
        if (ui.screen === 'challenge' || ui.screen === 'events') await openPenaltyTraining(game.roster, clubLook(PLAYER_TEAM_ID))
      } catch {
        showNotice('3D 点球训练场加载失败，请稍后重试。')
      }
      return
    }
    case 'freekick-training': {
      if (!isSeasonEventsOpen(game) || !isSeasonEventModeEnabled('freekick')) { showNotice('当前仅开放点球活动「十二码之夜」'); return }
      try {
        const { openFreeKickLab } = await import('./penalty/freekick.ts')
        if (ui.screen === 'challenge' || ui.screen === 'events') await openFreeKickLab(game.roster, clubLook(PLAYER_TEAM_ID))
      } catch {
        showNotice('3D 任意球实验室加载失败，请稍后重试。')
      }
      return
    }
    case 'switch-event-mode': {
      const m = actionEl.dataset.eventMode as SeasonEventMode | undefined
      if (m && isSeasonEventModeEnabled(m)) {
        ui.seasonEventMode = m
        ui.draftSwapPlayerId = null
        render()
      }
      return
    }
    case 'event-start-stage': {
      const mode = actionEl.dataset.eventMode as 'penalty' | 'freekick'
      const stage = Number(actionEl.dataset.stage)
      if (!stage || (mode !== 'penalty' && mode !== 'freekick')) break
      const runBody: SeasonEventActionBody = { action: 'start_stage', mode, stage }
      try {
        if (isOnlineMode()) await seasonEventActionOnline(runBody)
        else {
          const r = commitOfflineTransaction(() => applySeasonEventAction(game, runBody, Date.now()))
          if (!r.ok) throw new Error(r.error)
        }
      } catch (err) {
        showNotice(err instanceof Error ? err.message : '无法开启关卡')
        return
      }
      render()
      const env = currentSeasonEnvironment(game)
      const onCleared = () => {
        const clearBody: SeasonEventActionBody = { action: 'clear_stage', mode, stage }
        if (isOnlineMode()) {
          void seasonEventActionOnline(clearBody).then(() => render()).catch(() => {})
        } else {
          let bonusCoins = 0
          const out = commitOfflineTransaction(() => {
            const res = applySeasonEventAction(game, clearBody, Date.now())
            bonusCoins = res.autoCoins ?? 0
            return res
          })
          if (out.ok && bonusCoins > 0) {
            ui.notice = `恭喜通关第 ${stage} 关！阶段首通奖金 ${bonusCoins.toLocaleString()} 金币已自动发放！`
          } else {
            ui.notice = `恭喜通关第 ${stage} 关！`
          }
          render()
        }
      }
      try {
        if (mode === 'penalty') {
          const { openPenaltyTraining } = await import('./penalty/training.ts')
          await openPenaltyTraining(game.roster, clubLook(PLAYER_TEAM_ID), buildPenaltyStageController(stage, env, onCleared))
        } else {
          const { openFreeKickLab } = await import('./penalty/freekick.ts')
          await openFreeKickLab(game.roster, clubLook(PLAYER_TEAM_ID), buildFreeKickStageController(stage, env, onCleared))
        }
      } catch {
        showNotice('3D 场景加载失败，请稍后重试。')
      }
      render()
      return
    }
    case 'event-claim-book': {
      const mode = actionEl.dataset.eventMode as 'penalty' | 'freekick'
      const bookId = actionEl.dataset.book as import('../game/types.ts').SkillBookId
      if (!bookId || (mode !== 'penalty' && mode !== 'freekick')) break
      const body: SeasonEventActionBody = { action: 'claim_book', mode, bookId }
      try {
        if (isOnlineMode()) await seasonEventActionOnline(body)
        else {
          const r = commitOfflineTransaction(() => applySeasonEventAction(game, body, Date.now()))
          if (!r.ok) throw new Error(r.error)
        }
        ui.notice = '主题彩色技能书奖励已成功入库！'
      } catch (err) {
        ui.notice = err instanceof Error ? err.message : '领取失败'
      }
      render()
      return
    }
    case 'draft-start-new': {
      const selectEl = document.querySelector<HTMLSelectElement>('#draft-theme-select')
      const themeId = (selectEl?.value ?? ui.draftThemePreview ?? undefined) as import('../game/events/draft-cup.ts').DraftPoolThemeId | undefined
      const body: SeasonEventActionBody = { action: 'draft_start', themeId }
      try {
        if (isOnlineMode()) await seasonEventActionOnline(body)
        else {
          const r = commitOfflineTransaction(() => applySeasonEventAction(game, body, Date.now()))
          if (!r.ok) throw new Error(r.error)
        }
        ui.draftSwapPlayerId = null
        ui.notice = '八人同桌轮抽已开启！请从首包 12 名成品卡中挑走第 1 人。'
      } catch (err) {
        ui.notice = err instanceof Error ? err.message : '开启轮抽失败'
      }
      render()
      return
    }
    case 'draft-pick-card': {
      const cardId = actionEl.dataset.card ?? ''
      if (!cardId) break
      const body: SeasonEventActionBody = { action: 'draft_pick', cardId }
      try {
        if (isOnlineMode()) await seasonEventActionOnline(body)
        else {
          const r = commitOfflineTransaction(() => applySeasonEventAction(game, body, Date.now()))
          if (!r.ok) throw new Error(r.error)
        }
        if (game.seasonEvents?.draft?.phase === 'swiss') {
          ui.notice = '20 人轮抽组建完毕！已自动排出最强首发并生成瑞士轮第 1 轮对阵。'
        }
      } catch (err) {
        ui.notice = err instanceof Error ? err.message : '选牌失败'
      }
      render()
      return
    }
    case 'draft-set-formation': {
      const formationId = actionEl.dataset.formation as import('../game/types.ts').ElevenFormationId | undefined
      if (!formationId) break
      const body: SeasonEventActionBody = { action: 'draft_lineup', formationId }
      try {
        if (isOnlineMode()) await seasonEventActionOnline(body)
        else {
          const r = commitOfflineTransaction(() => applySeasonEventAction(game, body, Date.now()))
          if (!r.ok) throw new Error(r.error)
        }
        ui.draftSwapPlayerId = null
      } catch (err) {
        ui.notice = err instanceof Error ? err.message : '切换阵型失败'
      }
      render()
      return
    }
    case 'draft-auto-best': {
      const body: SeasonEventActionBody = { action: 'draft_lineup', autoBest: true }
      try {
        if (isOnlineMode()) await seasonEventActionOnline(body)
        else {
          const r = commitOfflineTransaction(() => applySeasonEventAction(game, body, Date.now()))
          if (!r.ok) throw new Error(r.error)
        }
        ui.draftSwapPlayerId = null
        ui.notice = '已按位置匹配度与成品 CA 重排最强 11 人首发。'
      } catch (err) {
        ui.notice = err instanceof Error ? err.message : '重排失败'
      }
      render()
      return
    }
    case 'draft-swap-pick': {
      const pid = actionEl.dataset.player ?? ''
      if (!pid) break
      if (!ui.draftSwapPlayerId) {
        ui.draftSwapPlayerId = pid
        render()
        return
      }
      if (ui.draftSwapPlayerId === pid) {
        ui.draftSwapPlayerId = null
        render()
        return
      }
      const pair: [string, string] = [ui.draftSwapPlayerId, pid]
      ui.draftSwapPlayerId = null
      const body: SeasonEventActionBody = { action: 'draft_lineup', swapPlayerIds: pair }
      try {
        if (isOnlineMode()) await seasonEventActionOnline(body)
        else {
          const r = commitOfflineTransaction(() => applySeasonEventAction(game, body, Date.now()))
          if (!r.ok) throw new Error(r.error)
        }
      } catch (err) {
        ui.notice = err instanceof Error ? err.message : '无法互换这两名球员的位置'
      }
      render()
      return
    }
    case 'draft-sim-round': {
      const body: SeasonEventActionBody = { action: 'draft_sim_round' }
      try {
        if (isOnlineMode()) await seasonEventActionOnline(body)
        else {
          const r = commitOfflineTransaction(() => applySeasonEventAction(game, body, Date.now()))
          if (!r.ok) throw new Error(r.error)
        }
        ui.notice =
          game.seasonEvents?.draft?.phase === 'finished'
            ? '4 轮瑞士轮全部完赛！请查看最终排名并领取奖励。'
            : '本轮瑞士轮比赛已结算，可点开战报观看完整 2D 录像回放！'
      } catch (err) {
        ui.notice = err instanceof Error ? err.message : '模拟失败'
      }
      render()
      return
    }
    case 'draft-play-live': {
      const body: SeasonEventActionBody = { action: 'draft_live_start' }
      try {
        if (isOnlineMode()) await seasonEventActionOnline(body)
        else {
          const r = commitOfflineTransaction(() => applySeasonEventAction(game, body, Date.now()))
          if (!r.ok) throw new Error(r.error)
        }
        openFriendly({ ok: true })
      } catch (err) {
        ui.notice = err instanceof Error ? err.message : '无法进入 2D 直播球场'
        render()
      }
      return
    }
    case 'draft-claim-reward': {
      const bookSel = document.querySelector<HTMLSelectElement>('#draft-reward-book')
      const bookId = (bookSel?.value ?? ui.draftChosenBookId ?? undefined) as import('../game/types.ts').SkillBookId | undefined
      const body: SeasonEventActionBody = { action: 'draft_claim_reward', bookId }
      try {
        if (isOnlineMode()) await seasonEventActionOnline(body)
        else {
          const r = commitOfflineTransaction(() => applySeasonEventAction(game, body, Date.now()))
          if (!r.ok) throw new Error(r.error)
        }
        ui.notice = '星秀轮抽杯瑞士轮排名奖励已发放至俱乐部账户！'
      } catch (err) {
        ui.notice = err instanceof Error ? err.message : '领奖失败'
      }
      render()
      return
    }
    case 'start-legend-challenge': {
      const teamId = actionEl.dataset.team
      if (!teamId || ui.completing) break
      if (!isOnlineMode()) {
        openFriendly(startLegendChallenge(game, teamId))
        break
      }
      ui.completing = true
      render()
      try {
        await startLegendOnline(teamId)
        openFriendly({ ok: true })
      } catch (error) {
        showNotice(error instanceof Error ? error.message : '无法开始传奇挑战')
      } finally {
        ui.completing = false
        render()
      }
      break
    }
    case 'start-peak-stage': {
      const stage = Number(actionEl.dataset.stage)
      if (!Number.isFinite(stage) || ui.completing) break
      if (!isOnlineMode()) {
        openFriendly(startPeakChallenge(game, stage))
        break
      }
      ui.completing = true
      render()
      try {
        await startPeakOnline(stage)
        openFriendly({ ok: true })
      } catch (error) {
        showNotice(error instanceof Error ? error.message : '无法开始巅峰挑战')
      } finally {
        ui.completing = false
        render()
      }
      break
    }
    case 'use-peak-card': {
      if (!ui.peakCardPlayerId || !ui.peakCardAttr) break
      const result = applyPeakBreakthrough(game, ui.peakCardPlayerId, ui.peakCardAttr)
      if (!result.ok) { showNotice(result.error); break }
      persist()
      showNotice(`${result.playerName} 的${attrLabel(result.attr)}上限 +${result.amount}。`)
      render()
      break
    }
    case 'claim-peak-reward': {
      const templateId = actionEl.dataset.player
      if (!templateId) break
      if (!isOnlineMode()) {
        const result = claimPeakReward(game, templateId)
        if (!result.ok) { showNotice(result.error); break }
        persist()
        showNotice(`${result.player.name} 已加入阵容。`)
        ui.peakPreviewStage = 50
        render()
        break
      }
      if (ui.completing) break
      ui.completing = true
      render()
      try {
        const updated = await claimPeakRewardOnline(templateId)
        const claimedName = updated.pve?.peak.reward50?.name
        showNotice(`${claimedName ? `${claimedName} ` : ''}已加入阵容。`)
        ui.peakPreviewStage = 50
      } catch (error) {
        showNotice(error instanceof Error ? error.message : '领取奖励失败')
      } finally {
        ui.completing = false
        render()
      }
      break
    }
    case 'cup-preview': {
      const cupId = actionEl.dataset.cup
      if (!cupId) break
      ui.cupPreviewId = ui.cupPreviewId === cupId && ui.cupHistorySeason === null ? null : cupId
      ui.cupHistorySeason = null
      render()
      break
    }
    case 'enter-cup': {
      const cupId = actionEl.dataset.cup as CupId | undefined
      if (!cupId) break
      const result = enterCupAction(game, cupId)
      if (!result.ok) { showNotice(result.error ?? '无法报名杯赛'); break }
      ui.cupPreviewId = cupId
      ui.cupHistorySeason = null
      render()
      break
    }
    case 'start-cup-match': {
      const cupId = actionEl.dataset.cup as CupId | undefined
      if (!cupId) break
      openFriendly(startCupMatch(game, cupId))
      break
    }
    case 'match-toggle':
      if (!ui.matchEngine || game.activeMatch?.context.isLeague || game.activeMatch?.preplayed) break
      if (ui.matchEngine.state.finished) completeMatch()
      else {
        ui.matchPlaying = !ui.matchPlaying
        if (!ui.matchPlaying) stopTimer()
        render()
      }
      break
    case 'match-skip':
      if (!ui.matchEngine || game.activeMatch?.context.isLeague || game.activeMatch?.preplayed) break
      ui.matchEngine.simulate()
      completeMatch()
      break
    case 'boot-online':
      onlineSessionRequested = true
      if (hasOnlineSession()) void joinOnline()
      else {
        ui.accountOpen = true
        render()
      }
      break
    case 'boot-offline':
      // 保留令牌，但这次不连服务器：不会建立 remote saver，存档只留在本机。
      onlineSessionRequested = false
      startOfflineGame()
      ui.bootGate = false
      ui.notice = '离线模式：本次不会连接服务器。'
      // 本地存档是系统自动建的、还没自己选过球队：先让玩家挑一支。
      if (teamPickPending()) openNewGamePicker(true)
      else {
        autoAdvanceSeason()
        if (ensureYouth(game)) persist()
        maybeOpenChangelog()
      }
      render()
      break
    case 'match-coach':
      if (game.activeMatch?.preplayed) break
      if (game.activeMatch?.context.isLeague) {
        ui.coachPanel = !ui.coachPanel
        ui.matchAutoSubsDraft = ui.coachPanel && ui.matchEngine
          ? structuredClone(ui.matchEngine.getTeam(game.activeMatch.context.homeAway).autoSubs ?? emptyAutoSubs())
          : null
        render()
        break
      }
      // 打开/收起面板都不消耗暂停次数，只有真正做出调整才扣（见 match-tactics-apply / match-sub / match-autosubs-apply）。
      if (ui.coachPanel) {
        ui.coachPanel = false
        ui.coachPauseUsed = false
        ui.matchAutoSubsDraft = null
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
      ui.matchAutoSubsDraft = ui.matchEngine && game.activeMatch
        ? structuredClone(ui.matchEngine.getTeam(game.activeMatch.context.homeAway).autoSubs ?? emptyAutoSubs())
        : null
      render()
      break
    case 'match-shout': {
      const kind = actionEl.dataset.shout
      if (!isShoutKind(kind) || !game.activeMatch || ui.matchShoutPending) break
      const targetPlayerId = ui.matchShoutTarget ? ui.matchShoutTarget : undefined
      if (game.activeMatch.preplayed || (game.activeMatch.context.isLeague && isOnlineMode())) {
        if (sharedActionUnavailable()) { showNotice('联机连接已断开，请先重新连接服务器'); break }
        ui.matchShoutPending = true
        render()
        try {
          await leagueActionOnline({
            action: 'match_shout',
            kind,
            ...(targetPlayerId ? { targetPlayerId } : {}),
          })
          ui.notice = `已发出场边喊话「${SHOUT_META[kind].label}」，直播时间线已同步并重算后半场。`
        } catch (error) {
          ui.notice = error instanceof Error ? error.message : '场边喊话失败'
        } finally {
          ui.matchShoutPending = false
          render()
        }
        break
      }
      if (!ui.matchEngine) break
      if (game.activeMatch.context.isLeague) tickRealtimeLeague()
      if (!ui.matchEngine || !game.activeMatch) break
      const result = issueMatchShout(game, ui.matchEngine, kind, targetPlayerId)
      ui.notice = result.ok ? result.record.dugoutFeedback : result.error
      render()
      break
    }
    case 'match-tactics-apply':
      if (game.activeMatch?.preplayed) break
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
      if (game.activeMatch?.preplayed) break
      if (!ui.matchEngine) break
      const out = (document.getElementById('match-out') as HTMLSelectElement | null)?.value
      const input = (document.getElementById('match-in') as HTMLSelectElement | null)?.value
      if (!out || !input) break
      if (game.activeMatch?.context.isLeague && isOnlineMode()) {
        try {
          await leagueActionOnline({ action: 'substitute', outId: out, inId: input })
          pruneLiveAutoSubDraft()
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
        if (result.ok) pruneLiveAutoSubDraft()
        ui.notice = result.ok ? '换人完成。' : result.error ?? '换人失败'
      }
      render()
      break
    }
    case 'match-autosubs-apply': {
      if (game.activeMatch?.preplayed) break
      if (!ui.matchEngine || !game.activeMatch) break
      const draft = getAutoSubDraft('match')
      if (!draft) break
      const syncDefault = ui.matchAutoSubsSyncDefault && (!isOnlineMode() || !lineupLockState(game).locked)
      if (game.activeMatch.context.isLeague && isOnlineMode()) {
        try {
          await leagueActionOnline({ action: 'set_match_auto_subs', plan: draft, syncDefault })
          ui.matchAutoSubsDraft = structuredClone(draft)
          ui.notice = syncDefault ? '本场自动换人已更新，并同步保存为默认设置。' : '本场自动换人设置已生效。'
        } catch (error) {
          ui.notice = error instanceof Error ? error.message : '自动换人更新失败'
        }
      } else {
        if (game.activeMatch.context.isLeague) tickRealtimeLeague()
        if (!ui.matchEngine || !game.activeMatch) break
        if (!game.activeMatch.context.isLeague) {
          const pause = reserveCoachPause(game, ui.coachPauseUsed)
          if (!pause.ok) { ui.notice = pause.error ?? '无法暂停'; render(); break }
          ui.coachPauseUsed = pause.used
        }
        const result = changeMatchAutoSubs(game, ui.matchEngine, draft, syncDefault)
        if (result.ok) {
          if (syncDefault) ui.autoSubsDraft = structuredClone(game.autoSubs ?? emptyAutoSubs())
          ui.notice = syncDefault ? '本场自动换人已更新，并同步保存为默认设置。' : '本场自动换人设置已生效。'
        } else {
          ui.notice = result.error ?? '自动换人设置无效'
        }
      }
      render()
      break
    }
    case 'open-review':
      if (recordId) {
        failedMatchRecords.delete(recordId)
        resetReplay(recordId)
        ui.reviewId = recordId
        ui.reviewAutoOpen = false
        ui.screen = 'review'
        persist()
        render()
      }
      break
    case 'replay2d-toggle':
      toggleReplay2D()
      break
    case 'replay2d-highlights':
      toggleReplay2DHighlights()
      break
    case 'replay2d-next-highlight':
      nextReplay2DHighlight()
      break
    case 'replay2d-jump':
      jumpReplay2DToClock(Number(actionEl.dataset.clock))
      break
    case 'replay2d-drawer':
      toggleReplay2DDrawer()
      break
    case 'replay2d-restart':
      restartReplay2D()
      break
    case 'replay2d-speed':
      cycleReplay2DSpeed()
      break
    case 'replay-toggle':
      if (replay.playing) stopReplay()
      else {
        const record = [...game.matchHistory, ...game.challengeHistory].find((item) => item.id === ui.reviewId)
        if (record && replay.index < (record.commentary ?? record.keyEvents).length) replay.playing = true
      }
      render()
      break
    case 'replay-highlights':
      replay.highlightsOnly = !replay.highlightsOnly
      render()
      break
    case 'replay-drawer':
      replay.drawerOpen = !replay.drawerOpen
      render()
      break
    case 'replay-jump': {
      const targetClock = Number(actionEl.dataset.clock)
      const record = [...game.matchHistory, ...game.challengeHistory].find((item) => item.id === ui.reviewId)
      if (record && Number.isFinite(targetClock)) {
        stopReplay()
        const entries = record.commentary ?? record.keyEvents
        const idx = entries.findIndex((e) => e.clock >= targetClock - 0.05)
        replay.index = idx < 0 ? entries.length : Math.min(entries.length, idx + 2)
      }
      render()
      break
    }
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
      ui.reviewAutoOpen = false
      render()
      break
    case 'mobile-nav-toggle':
      ui.mobileNavOpen = !ui.mobileNavOpen
      render()
      break
    case 'mobile-nav-close':
      ui.mobileNavOpen = false
      render()
      break
    case 'mobile-nav-go': {
      const targetScreen = actionEl.dataset.screen as Screen | undefined
      ui.mobileNavOpen = false
      if (targetScreen) go(targetScreen)
      else render()
      break
    }
    case 'chat-toggle':
      ui.chatOpen = !ui.chatOpen
      ui.chatError = ''
      if (ui.chatOpen) {
        markChatSeen()
        if (isOnlineMode() && !chatState.messages.length) void refreshChatOnline()
      }
      render()
      if (ui.chatOpen) {
        scrollChatToBottom(true)
        if (!window.matchMedia?.('(pointer: coarse)').matches) {
          ;(document.getElementById('chat-input') as HTMLInputElement | null)?.focus()
        }
      }
      break
    case 'chat-close':
      ui.chatOpen = false
      ui.chatError = ''
      render()
      break
    case 'chat-send':
      void submitChat()
      break
    case 'chat-share-card': {
      const targetCardId = actionEl.dataset.card ?? ''
      const card = cardsOf(game).find((item) => item.id === targetCardId)
      if (card) {
        openChatWithShare({
          kind: 'card',
          cardId: card.id,
          label: `${card.playerName} · ${cardDisplayName(card)}（CA ${Math.round(playerCA(card))}）`,
        })
      }
      break
    }
    case 'chat-share-match': {
      const targetRecordId = actionEl.dataset.record ?? ''
      const rec = [...game.matchHistory, ...game.challengeHistory].find((item) => item.id === targetRecordId)
      if (rec) {
        openChatWithShare({
          kind: 'match',
          recordId: rec.id,
          label: `${rec.homeName} ${rec.score.home}:${rec.score.away} ${rec.awayName}`,
        })
      }
      break
    }
    case 'chat-share-goal': {
      const targetRecordId = actionEl.dataset.record || ui.reviewId || ''
      let rec = [...game.matchHistory, ...game.challengeHistory].find((item) => item.id === targetRecordId)
      if (!rec) break
      const goalIdx = Number(actionEl.dataset.goalIndex)
      if (!Number.isInteger(goalIdx) || goalIdx < 0) break
      try {
        if (rec.detailDeferred && isOnlineMode()) {
          rec = await loadMatchRecordOnline(rec.id)
          applyLoadedMatchRecords(game)
          render()
        }
        shareGoalFromRecord(rec, goalIdx)
      } catch (err) {
        showNotice(`载入进球详情失败：${err instanceof Error ? err.message : String(err)}`)
      }
      break
    }
    case 'chat-pick-best-card': {
      const best = [...cardsOf(game)].sort((a, b) => playerCA(b) - playerCA(a))[0]
      if (best) {
        openChatWithShare({
          kind: 'card',
          cardId: best.id,
          label: `${best.playerName} · ${cardDisplayName(best)}（CA ${Math.round(playerCA(best))}）`,
        })
      }
      break
    }
    case 'chat-pick-last-match': {
      const latest = [...game.matchHistory, ...game.challengeHistory].sort((a, b) => b.createdAt - a.createdAt)[0]
      if (latest) {
        openChatWithShare({
          kind: 'match',
          recordId: latest.id,
          label: `${latest.homeName} ${latest.score.home}:${latest.score.away} ${latest.awayName}`,
        })
      }
      break
    }
    case 'chat-clear-share':
      ui.chatPendingShare = null
      render()
      ;(document.getElementById('chat-input') as HTMLInputElement | null)?.focus()
      break
    case 'chat-preview-msg':
      ui.chatPreviewMsgId = actionEl.dataset.msgId ?? null
      render()
      break
    case 'chat-preview-close':
      ui.chatPreviewMsgId = null
      render()
      break
    case 'open-highlight-3d': {
      const targetRecordId = actionEl.dataset.record || ui.reviewId || ''
      let rec = [...game.matchHistory, ...game.challengeHistory].find((item) => item.id === targetRecordId)
      if (!rec) break
      const rawGoalIdx = actionEl.dataset.goalIndex
      const goalIdx = rawGoalIdx !== undefined ? Number(rawGoalIdx) : undefined
      if (replay2d.playing) toggleReplay2D()
      if (replay.playing) stopReplay()
      try {
        if (rec.detailDeferred && isOnlineMode()) {
          rec = await loadMatchRecordOnline(rec.id)
          applyLoadedMatchRecords(game)
          render()
        }
        const { openRecordHighlight3D } = await import('./highlight-3d.ts')
        await openRecordHighlight3D(rec, Number.isFinite(goalIdx) ? goalIdx : undefined, {
          onShareGoal: (clip) => {
            if (clip.goalIndex !== undefined) shareGoalFromRecord(rec!, clip.goalIndex)
          },
        })
      } catch (err) {
        showNotice(`打开 3D 高光剧场失败：${err instanceof Error ? err.message : String(err)}`)
      }
      break
    }
    case 'chat-highlight-3d': {
      const msgId = actionEl.dataset.msgId || ui.chatPreviewMsgId || ''
      const msg = chatState.messages.find((m) => m.id === msgId)
      if (!msg || msg.share?.kind !== 'match') break
      const rawGoalIdx = actionEl.dataset.goalIndex
      const goalIdx = rawGoalIdx !== undefined ? Number(rawGoalIdx) : undefined
      if (replay2d.playing) toggleReplay2D()
      try {
        const { openSharedMatchHighlight3D } = await import('./highlight-3d.ts')
        await openSharedMatchHighlight3D(msg.share, Number.isFinite(goalIdx) ? goalIdx : undefined)
      } catch (err) {
        showNotice(`打开 3D 进球剧场失败：${err instanceof Error ? err.message : String(err)}`)
      }
      break
    }
    case 'chat-highlight-3d-goal': {
      const msgId = actionEl.dataset.msgId || ''
      const msg = chatState.messages.find((m) => m.id === msgId)
      if (!msg || msg.share?.kind !== 'goal') break
      if (replay2d.playing) toggleReplay2D()
      try {
        const { openSharedGoalHighlight3D } = await import('./highlight-3d.ts')
        await openSharedGoalHighlight3D(msg.share)
      } catch (err) {
        showNotice(`播放 3D 进球动画失败：${err instanceof Error ? err.message : String(err)}`)
      }
      break
    }
    case 'chat-open-own-review':
      if (recordId) {
        ui.chatPreviewMsgId = null
        ui.chatOpen = false
        failedMatchRecords.delete(recordId)
        resetReplay(recordId)
        ui.reviewId = recordId
        ui.reviewAutoOpen = false
        ui.screen = 'review'
        persist()
        render()
      }
      break
    case 'chat-login':
      ui.chatOpen = false
      ui.chatError = ''
      ui.accountOpen = true
      ui.authMode = 'login'
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
  if (trainingStartPending || cardActionPending) return
  const target = event.target as HTMLSelectElement | HTMLInputElement
  if (target.dataset.renewYears !== undefined) {
    const id = target.dataset.renewYears
    const years = Number(target.value)
    if (id && Number.isSafeInteger(years)) {
      ui.renewYearsByPlayer[id] = years
      render()
    }
    return
  }
  if (target.dataset.recycleCard !== undefined) {
    const id = target.dataset.recycleCard
    if (!id || (target as HTMLInputElement).disabled) return
    ui.recycleSelectedIds = (target as HTMLInputElement).checked
      ? [...new Set([...ui.recycleSelectedIds, id])]
      : ui.recycleSelectedIds.filter((item) => item !== id)
    ui.recycleConfirm = false
    render()
    return
  }
  if (target.dataset.playerCompareBase !== undefined) {
    if (comparisonCandidates().some((player) => player.id === target.value)) {
      const previous = ui.detailPlayerId
      ui.detailPlayerId = target.value
      if (ui.playerCompareId === target.value) ui.playerCompareId = previous
      render()
    }
    return
  }
  if (target.dataset.playerCompareSelect !== undefined) {
    if (!target.value || comparisonCandidates().some((player) => player.id === target.value)) {
      ui.playerCompareId = target.value || null
      render()
    }
    return
  }
  if (target.dataset.newsDivision !== undefined) {
    ui.newsDivision = target.value || null
    render()
    return
  }
  if (target.dataset.worldRound !== undefined) {
    ui.worldRound = Math.max(1, Number(target.value) || 1)
    render()
    return
  }
  if (target.dataset.worldFxClub !== undefined) {
    ui.worldFixtureClubId = target.value || 'ALL'
    render()
    return
  }
  if (target.dataset.peakCardPlayer !== undefined) {
    ui.peakCardPlayerId = target.value || null
    const player = game.roster.find((item) => item.id === ui.peakCardPlayerId)
    if (player) {
      const allowed = mainAttrsFor(player.positions.GK > 0)
      if (!ui.peakCardAttr || !allowed.includes(ui.peakCardAttr)) ui.peakCardAttr = allowed[0]
    }
    render()
    return
  }
  if (target.dataset.peakCardAttr !== undefined) {
    ui.peakCardAttr = target.value as AttrKey
    render()
    return
  }
  if (target.dataset.eventReplace) {
    ui.trainingEventReplacements[target.dataset.eventReplace] = target.value as SkillId
    return
  }
  if (target.dataset.trainingBook) {
    const key = target.dataset.trainingBook
    const checked = (target as HTMLInputElement).checked
    const maxBooks = maxTrainingBooks(game)
    ui.trainingBookIds = checked ? [...new Set([...ui.trainingBookIds, key])].slice(0, maxBooks) : ui.trainingBookIds.filter((item) => item !== key)
    render()
    return
  }
  if (target.id === 'legend-era') { ui.legendEra = target.value; render(); return }
  if (target.id === 'legend-country') { ui.legendCountry = target.value; render(); return }
  if (target instanceof HTMLInputElement && target.matches('[data-rp-seek]')) {
    seekReplay2D(Number(target.value) / 1000)
    return
  }
  if (target.id === 'account-club') {
    ui.registrationClubId = target.value
    render()
    return
  }
  if (target.id === 'lineup-auto-mode') {
    ui.lineupAutoMode = target.value === 'half' || target.value === 'full' ? target.value : 'best'
    render()
    return
  }
  if (target.dataset.tacticalStyle !== undefined) {
    const value = target.value
    if (isStyleId(value)) {
      updateLineupDraft((draft) => {
        const tpl = styleByRevision(value, 3)
        draft.tacticalStyle = value
        draft.tacticalInstructions = cloneInstructions(tpl.instructions)
        draft.tactics = legacyTacticsFromInstructions(tpl.instructions)
      })
    }
    return
  }
  if (target.dataset.matchPlan !== undefined) {
    const value = target.value
    if (isMatchPlanId(value)) {
      updateLineupDraft((draft) => {
        if (value === 'standard') delete draft.matchPlan
        else draft.matchPlan = value
      })
    }
    return
  }
  if (target.dataset.autoShout !== undefined) {
    const checked = (target as HTMLInputElement).checked
    updateLineupDraft((draft) => {
      if (checked) draft.autoShout = true
      else delete draft.autoShout
    })
    return
  }
  if (target.id === 'match-shout-target') {
    ui.matchShoutTarget = target.value
    render()
    return
  }
  if (target.id === 'draft-theme-select') {
    ui.draftThemePreview = target.value as import('../game/events/draft-cup.ts').DraftPoolThemeId
    render()
    return
  }
  if (target.id === 'draft-reward-book') {
    ui.draftChosenBookId = target.value as import('../game/types.ts').SkillBookId
    render()
    return
  }
  if (target.id === 'academy-era') {
    ui.academyEra = target.value
    persist()
    render()
    return
  }
  if (target.id === 'ai-buy-team' || target.id === 'ai-buy-pos') {
    if (target.id === 'ai-buy-team') ui.aiBuyTeam = target.value || 'ALL'
    else ui.aiBuyPos = target.value || 'ALL'
    ui.aiBuyPage = 0
    render()
    return
  }
  if (target.id === 'club-sort') {
    const [key, dir] = target.value.split(':')
    if (key) ui.clubSort = key as FreeTransferSortKey
    ui.clubSortDir = dir === 'asc' ? 1 : -1
    ui.clubPage = 0
    render()
    return
  }
  if (target.id === 'ai-buy-sort') {
    const [key, dir] = target.value.split(':')
    if (key) ui.aiBuySort = key as AiTransferSortKey
    ui.aiBuySortDir = dir === 'asc' ? 1 : -1
    ui.aiBuyPage = 0
    render()
    return
  }
  if (target.id === 'ai-buy-available') {
    ui.aiBuyOnlyAvailable = (target as HTMLInputElement).checked
    ui.aiBuyPage = 0
    render()
    return
  }
  if (target.id === 'sell-sort') {
    const [key, dir] = target.value.split(':')
    if (key) ui.sellSort = key as SellTransferSortKey
    ui.sellSortDir = dir === 'asc' ? 1 : -1
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
    ui.trainingPointSpend = 0
    ui.trainingTeammateIds = []
    ui.trainingEventReplacements = {}
    ui.trainingPlayerId = target.value || null
    ui.trainingBookIds = ui.trainingPlayerId ? trainingBookLoadout(game, ui.trainingPlayerId) : []
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
  if (target.id === 'training-position') {
    ui.trainingPosition = target.value as DetailedPosition
    render()
    return
  }
  if (target.id === 'match-autosubs-sync') {
    ui.matchAutoSubsSyncDefault = (target as HTMLInputElement).checked
    render()
    return
  }
  const autoSubChangedScope = applyAutoSubFieldChange(target, getAutoSubDraft)
  if (autoSubChangedScope !== null) {
    render()
    return
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
  if (trainingStartPending || cardActionPending) return
  const target = event.target as HTMLInputElement
  if (target.id === 'board-budget-slider') {
    const raw = Math.trunc(Number(target.value) || 0)
    const wageDelta = raw === 0
      ? 0
      : raw > 0
        ? -Math.floor(raw / BOARD_WAGE_SLIDER_ROUNDS)
        : Math.floor((-raw) / BOARD_WAGE_SLIDER_ROUNDS)
    const appliedTransfer = -wageDelta * BOARD_WAGE_SLIDER_ROUNDS
    ui.boardSliderDraft = appliedTransfer
    const box = document.querySelector<HTMLElement>('[data-board-slider-preview]')
    if (box) {
      const baseTransfer = Number(box.dataset.baseTransfer ?? 0)
      const baseWage = Number(box.dataset.baseWage ?? 0)
      const commercial = Number(box.dataset.commercial ?? 0)
      const tEl = box.querySelector<HTMLElement>('[data-board-preview-transfer]')
      const tdEl = box.querySelector<HTMLElement>('[data-board-preview-tdelta]')
      const wEl = box.querySelector<HTMLElement>('[data-board-preview-wage]')
      const wdEl = box.querySelector<HTMLElement>('[data-board-preview-wdelta]')
      if (tEl) tEl.textContent = (baseTransfer + appliedTransfer).toLocaleString()
      if (tdEl) {
        tdEl.textContent = appliedTransfer === 0 ? '未变动' : `${appliedTransfer > 0 ? '+' : ''}${appliedTransfer.toLocaleString()}`
        tdEl.className = appliedTransfer > 0 ? 'up' : appliedTransfer < 0 ? 'down' : 'muted'
      }
      if (wEl) wEl.textContent = (baseWage + wageDelta + commercial).toLocaleString()
      if (wdEl) {
        wdEl.textContent = wageDelta === 0
          ? `基础 ${baseWage.toLocaleString()} + 商业 ${commercial.toLocaleString()}`
          : `${wageDelta > 0 ? '+' : ''}${wageDelta.toLocaleString()}/轮（基础 ${(baseWage + wageDelta).toLocaleString()}）`
        wdEl.className = wageDelta > 0 ? 'up' : wageDelta < 0 ? 'down' : 'muted'
      }
    }
    const applyBtn = document.querySelector<HTMLButtonElement>('[data-board-slider-apply]')
    const resetBtn = document.querySelector<HTMLButtonElement>('[data-board-slider-reset]')
    if (applyBtn) applyBtn.disabled = appliedTransfer === 0
    if (resetBtn) resetBtn.disabled = appliedTransfer === 0
    return
  }
  if (target.id === 'legend-search') { ui.legendSearch = target.value; render(); return }
  if (target.matches?.('[data-rp-seek]')) {
    previewReplay2DSeek(Number(target.value) / 1000)
    return
  }
  if (target.id === 'academy-search') {
    ui.academySearch = target.value
    render()
  }
  if (target.id === 'inventory-search') {
    ui.inventorySearch = target.value
    render()
  }
  if (target.id === 'inventory-book-search') {
    ui.inventoryBookSearch = target.value
    render()
  }
  if (target.id === 'club-search') {
    ui.clubSearch = target.value
    ui.clubPage = 0
    render()
  }
  if (target.id === 'ai-buy-search') {
    ui.aiBuySearch = target.value
    ui.aiBuyPage = 0
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
    } else if (ui.changelogOpen) {
      ui.changelogOpen = false
      markChangelogSeen()
    } else if (ui.autoStrategyOpen) {
      if (ui.autoStrategyDetail) ui.autoStrategyDetail = false
      else ui.autoStrategyOpen = false
    }
    else if (ui.accountOpen) ui.accountOpen = false
    else if (ui.clubViewId) { ui.clubViewId = null; ui.clubViewPlayerId = null }
    else if (ui.detailPlayerId) ui.detailPlayerId = null
    else if (ui.chatPreviewMsgId) ui.chatPreviewMsgId = null
    else if (ui.chatOpen) { ui.chatOpen = false; ui.chatError = '' }
    else if (ui.mobileNavOpen) ui.mobileNavOpen = false
    else return
    render()
    return
  }
  if (event.key === 'Enter' && !event.isComposing && target.id === 'chat-input') {
    event.preventDefault()
    void submitChat()
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
  if (event.key === 'Enter' && (target.id === 'account-current-password' || target.id === 'account-new-username' || target.id === 'account-new-password' || target.id === 'account-confirm-password')) {
    void submitAccountCredentials()
    return
  }
  // 整行可点的表格行也要能用键盘操作。
  if ((event.key === 'Enter' || event.key === ' ') && target.matches('tr[data-action], [role="button"][data-action]')) {
    event.preventDefault()
    target.click()
  }
})

/** 等玩家选择离线模式，不能在等登录时用缓存档推进。 */
function offlineProgressAllowed(): boolean {
  return !ui.bootGate && !ui.newGameRequired && !onlineSessionRequested && !onlineState.user && !isOnlineMode()
}

function autoAdvanceSeason(): void {
  if (!offlineProgressAllowed()) return
  // 体能每小时按比例恢复一次：比赛进行中、赛季结束后也照常结算（联机由服务器结算）。
  if (game.activeMatch || game.season.finished) {
    if (settleGameConditions(game, Date.now())) persist()
    return
  }
  const offersBefore = pendingOfferIds()
  const result = catchUpSeason(game)
  if (result.advanced <= 0) {
    if (result.rested) persist()
    return
  }
  ui.notice = `已自动结算 ${result.advanced} 轮比赛。`
  announceNewOffers(offersBefore)
  persist()
  render()
}

function tickRealtimeLeague(): void {
  if (ui.bootGate) return
  const active = game.activeMatch
  if (!active || (!active.context.isLeague && !active.preplayed)) return
  // 服务器预先算好的回放：浏览器自己按时钟追，比分、数据条和文字直播每秒跟着画面刷新一次。
  if (active.preplayed) {
    if (ui.screen === 'match') render()
    return
  }
  if (offlineProgressAllowed() && advanceLeagueRealtime(game)) {
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
  if (ui.bootGate || (!isOnlineMode() && !offlineProgressAllowed())) return
  if (ui.screen) game.ui = { screen: ui.screen }
  if (ui.screen === 'match' && ui.matchEngine && game.activeMatch && !game.activeMatch.context.isLeague && !game.activeMatch.preplayed) game.activeMatch.engineState = ui.matchEngine.serialize()
  saveGame(game)
})

// 联赛回放按服务器时钟走（本机时钟快慢不影响开球和终场）。
setLeagueClock(serverNow)
setReplay2DHooks({
  refresh: () => render(),
  feed: (entries, durationSeconds) => entries.map((entry) => renderCommentary(entry, durationSeconds)).join(''),
})
setPesViewHooks({
  refresh: () => render(),
  finished: () => completeMatch(),
  save: (engine) => syncActiveEngine(game, engine),
})
window.setInterval(tickRealtimeLeague, 1000)
// 竞拍倒计时每秒走，不用整页重绘。
window.setInterval(() => {
  if (ui.bootGate) return
  // 联机待办只在服务器持有估计值，到期后自动拉取一次；失败后限频，仍可手动刷新。
  const at = serverNow()
  if (isOnlineMode() && !scoutRefreshPending && !cardActionPending && !trainingStartPending && at - lastScoutRefreshAttempt >= 30_000 &&
      (game.scoutReports ?? []).some(report => report.readyAt <= at && !report.estimatedAttrs)) {
    lastScoutRefreshAttempt = at
    // 只合并报告的后台读取不能冻结青训或其它页面。
    scoutRefreshPending = true
    void refreshGameOnline(() => game).catch(() => { /* 可通过报告面板手动重试 */ }).finally(() => { scoutRefreshPending = false })
  }
  for (const element of document.querySelectorAll<HTMLElement>('[data-countdown-end]')) {
    const clock = element.closest('[data-peak-reset-at], [data-legend-reset-at]') && !isOnlineMode() ? Date.now() : serverNow()
    const left = Number(element.dataset.countdownEnd) - clock
    element.textContent = countdownText(left)
    element.classList.toggle('urgent', left < 60_000)
  }
  const pveReset = document.querySelector<HTMLElement>('[data-peak-reset-at], [data-legend-reset-at]')
  const pveResetAt = Number(pveReset?.dataset.peakResetAt ?? pveReset?.dataset.legendResetAt)
  if (ui.screen === 'challenge' && pveReset && Number.isFinite(pveResetAt) && pveResetAt <= (isOnlineMode() ? serverNow() : Date.now())) render()
}, 1000)
window.setInterval(autoAdvanceSeason, 30_000)
window.setInterval(() => { if (ui.screen !== 'match') render() }, 30_000)
window.setInterval(() => { if (ui.screen === 'world' || ui.screen === 'cups') void refreshPublicWorld() }, 120_000)
installTooltips()
render()
bootOnline()
