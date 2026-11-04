import type {
  AttrKey,
  AutoSubPlan,
  GameState,
  Lineup,
  MatchMentality,
  MatchLogEntry,
  CommentaryEntry,
  MatchRecord,
  Player,
  Position,
  RoleId,
  SkillId,
  Tactics,
  TrainingSession,
} from '../game/types.ts'
import { createInitialGame, clearSave, loadGame, saveGame, upgradeLegacySignatures } from '../game/state.ts'
import { createWorldGame, d2ClubChoices, wageForPlayer, worldDivisionLabel, worldTierLabel } from '../game/world.ts'
import {
  autoLineup,
  changeMatchTactics,
  confirmTraining,
  discardTraining,
  finishMatch,
  makeSubstitution,
  restoreActiveEngine,
  setLineup,
  simulateSeasonRound,
  startLeague,
  startNextSeasonAction,
  startSingleChallenge,
  startTraining,
  syncActiveEngine,
  trainingAction,
  previewTraining,
  trainingEventChoice,
  useCoachPause,
} from '../game/actions.ts'
import { planTraining, trainingActionsTotal, eventGrowthScale, TRAINING_ACTION_INFO, TRAINING_ENERGY_COST, weekOfAction, type TrainingActionId, type TrainingRequest } from '../game/training.ts'
import { trainingDate, trainingOptions, type TrainingActivityId } from '../game/training-calendar.ts'
import { branchProbability, eventChance } from '../game/training.ts'
import { eventById, ROUTE_LABELS } from '../game/data/events.ts'
import { FORMATIONS, FORMATION_LIST, TACTIC_LABELS } from '../game/data/formations.ts'
import { ROLES, ROLES_BY_POSITION, roleFit } from '../game/data/roles.ts'
import { ATTR_GROUPS, POSITION_LABELS } from '../game/data/attributes.ts'
import { attrRating, displayAttr, displayCA, initialDisplayCA, mainAttrsFor } from '../game/rating.ts'
import { SKILLS, TRAITS, skillCategory, skillCapacity } from '../game/data/skills.ts'
import { getSkillTier, inheritanceChances, validateInheritance } from '../game/inheritance.ts'
import { POSITIONS } from '../game/types.ts'
import { caOf } from '../game/ca.ts'
import { positionMultiplier } from '../game/ca.ts'
import { autoFillLineup, validateLineup } from '../game/squad.ts'
import { PLAYER_TEAM_ID, catchUpSeason, currentRoundFixtures, matchdayCountdown, playerFixture, seasonRoundLabel, teamName } from '../game/season.ts'
import { buildReview } from '../game/review.ts'
import { advanceLeagueRealtime, leagueDisplayClock, leagueElapsed } from '../game/realtime.ts'
import { displayClock, MATCH_DISPLAY_SECONDS } from '../game/match/time.ts'
import { createAgentTokenOnline, hasOnlineSession, initOnline, leagueActionOnline, loadPublicConfig, loginOnline, logoutOnline, onlineState, publicConfig, registerOnline, revokeAgentTokenOnline, setRemoteGameHandler, subscribeOnline } from '../online.ts'
import { MatchEngine } from '../game/match/engine.ts'
import { PITCH_LENGTH, PITCH_WIDTH } from '../game/match/team.ts'
import { shotPositionText } from '../game/match/shooting.ts'
import { autoSubDisplaySeconds, emptyAutoSubs, MATCH_MENTALITY_LABELS, validateAutoSubPlan } from '../game/match/management.ts'
import { injuryUntil } from '../game/injury.ts'
import { economyOf, FACILITIES, facilityUpgradeCost, upgradeFacility, LEAGUE_WIN_BONUS, type FacilityId } from '../game/economy.ts'
import { buyFreeAgent, listPlayer, cancelListing, playerMarketValue, renewContract, releasePlayer, transferWindowOpen, buyFromClub } from '../game/market.ts'
import {
  attrLabel,
  caDelta,
  clockText,
  esc,
  gainText,
  pct,
  attrValue,
  playerCA,
  positionClass,
  positionLabel,
  skillName,
  tacticText,
  traitName,
  displayEventHint,
  trainingLogText,
} from './format.ts'

type Screen = 'club' | 'home' | 'academy' | 'training' | 'lineup' | 'season' | 'world' | 'challenge' | 'review' | 'match'

type UIState = {
  screen: Screen
  clubSearch: string
  clubPage: number
  academySearch: string
  academyPos: Position | 'ALL'
  academyEra: string
  academyPage: number
  trainingPlayerId: string | null
  trainingKind: TrainingActionId
  trainingActivity: TrainingActivityId | null
  trainingTeammateIds: string[]
  trainingAttr: AttrKey
  trainingCombo: 'attack' | 'defense'
  trainingPosition: Position
  trainingProtection: 'prevention' | 'resilience'
  trainingMentorId: string
  trainingSkill: SkillId | null
  detailPlayerId: string | null
  reviewId: string | null
  notice: string
  matchPlaying: boolean
  matchSpeed: number
  matchEngine: MatchEngine | null
  matchTimer: number | null
  coachPanel: boolean
  lineupDraft: Lineup | null
  autoSubsDraft: AutoSubPlan | null
  completing: boolean
  accountOpen: boolean
  authMode: 'login' | 'register'
  turnstileToken: string
}

let replay = { id: '', index: 0, playing: false, speed: 1, timer: null as number | null }

const app = document.getElementById('app')!
const SAVE_SCREEN: Screen[] = ['club', 'home', 'academy', 'training', 'lineup', 'season', 'world', 'challenge', 'review', 'match']

const saved = loadGame()
let game: GameState = saved ?? createWorldGame()
if (!saved) saveGame(game)

let ui: UIState = {
  screen: 'home',
  clubSearch: '',
  clubPage: 0,
  academySearch: '',
  academyPos: 'ALL',
  academyEra: 'ALL',
  academyPage: 0,
  trainingPlayerId: null,
  trainingKind: 'drill',
  trainingActivity: null,
  trainingTeammateIds: [],
  trainingAttr: 'passing',
  trainingProtection: 'prevention',
  trainingMentorId: '',
  trainingSkill: null,
  trainingCombo: 'attack',
  trainingPosition: 'CM',
  detailPlayerId: null,
  reviewId: null,
  notice: '',
  matchPlaying: false,
  matchSpeed: 300,
  matchEngine: null,
  matchTimer: null,
  coachPanel: false,
  lineupDraft: null,
  autoSubsDraft: null,
  completing: false,
  accountOpen: false,
  authMode: 'login',
  turnstileToken: '',
}

const initialScreen = game.ui?.screen as Screen | undefined
if (initialScreen && SAVE_SCREEN.includes(initialScreen)) ui.screen = initialScreen
if (ui.screen === 'match' && !game.activeMatch) ui.screen = 'home'
if (ui.screen === 'match') {
  ui.matchEngine = restoreActiveEngine(game)
}

const navItems: { id: Screen; label: string }[] = [
  { id: 'home', label: '总览' },
  { id: 'club', label: '俱乐部' },
  { id: 'academy', label: '青训' },
  { id: 'training', label: '培养' },
  { id: 'lineup', label: '阵容' },
  { id: 'season', label: '赛季' },
  { id: 'world', label: '世界' },
  { id: 'challenge', label: '挑战' },
  { id: 'review', label: '复盘' },
]

function persist(): void {
  if (ui.screen) game.ui = { screen: ui.screen }
  if (!saveGame(game)) ui.notice = '存档保存失败（可能已达浏览器容量上限），请勿刷新或关闭页面。'
}

function showNotice(text: string): void {
  ui.notice = text
  render()
}

function stopReplay(): void {
  if (replay.timer !== null) window.clearTimeout(replay.timer)
  replay.timer = null
  replay.playing = false
}

function resetReplay(id: string): void {
  stopReplay()
  replay = { id, index: 0, playing: false, speed: replay.speed, timer: null }
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
  ui.screen = screen
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

function render(): void {
  if (ui.screen === 'lineup' && !ui.lineupDraft) ui.lineupDraft = structuredClone(game.lineup)
  if (ui.screen === 'lineup' && !ui.autoSubsDraft) ui.autoSubsDraft = structuredClone(game.autoSubs ?? emptyAutoSubs())
  const selections = new Map([...document.querySelectorAll<HTMLSelectElement>('#match-mentality, #match-out, #match-in')].map((select) => [select.id, select.value]))
  const scroll = window.scrollY
  app.innerHTML = `
    <div class="shell">
      ${renderHeader()}
      <main class="content">${renderScreen()}</main>
      <footer class="footer">真实球星姓名仅用于原型玩法测试；正式发行需取得姓名与肖像授权。固定 PCG32 随机；同种子同输入可复现。</footer>
    </div>
    ${renderDetailOverlay()}
    ${renderAccountOverlay()}
    ${ui.notice ? `<div class="notice" data-action="dismiss-notice">${esc(ui.notice)}<span>×</span></div>` : ''}
  `
  for (const select of document.querySelectorAll<HTMLSelectElement>('#match-mentality, #match-out, #match-in')) {
    const value = selections.get(select.id)
    if (value !== undefined && [...select.options].some((option) => option.value === value)) select.value = value
  }
  window.scrollTo(0, scroll)
  if (ui.screen === 'match') {
    drawPitch()
    ensureTimer()
    if (!game.activeMatch?.context.isLeague && ui.matchEngine?.state.finished && !ui.completing) {
      window.setTimeout(() => completeMatch(), 0)
    }
  } else {
    stopTimer()
  }
  if (ui.screen === 'review') scheduleReplay()
  else stopReplay()
  mountTurnstile()
}

function renderHeader(): string {
  const active = game.activeMatch ? '<span class="live-dot">比赛进行中</span>' : ''
  return `
    <header class="topbar">
      <div class="brand" data-action="go-home">
        <div class="brand-mark">7</div>
        <div>
          <div class="brand-title">七人 · 青训经理</div>
          <div class="brand-sub">${esc(game.clubName)} · 种子 ${game.seed}</div>
        </div>
      </div>
      <nav class="nav">
        ${navItems.map((item) => `<button class="nav-btn ${ui.screen === item.id ? 'active' : ''}" data-nav="${item.id}">${item.label}</button>`).join('')}
      </nav>
      <div class="top-meta">
        ${active}
        <span>青训 ${game.roster.length} 人</span>
        <span>联赛 ${game.aiTeams.length + 1} 队</span>
        <button class="btn ghost small" data-action="account-open">${onlineState.user ? `账号 ${esc(onlineState.user.username)}` : '登录 / 注册'}${onlineState.status === 'online' ? (onlineState.connected ? ' · 已同步' : ' · 连接中') : ''}</button>
        <button class="btn ghost small" data-action="new-game">新游戏</button>
      </div>
    </header>
  `
}

function renderScreen(): string {
  switch (ui.screen) {
    case 'club':
      return renderClub()
    case 'home':
      return renderHome()
    case 'academy':
      return renderAcademy()
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

function renderClub(): string {
  const economy = economyOf(game)
  const market = game.market
  const query = ui.clubSearch.trim().toLowerCase()
  const agents = game.freeStars.filter((player) => `${player.name} ${player.enName} ${player.country}`.toLowerCase().includes(query))
  const pages = Math.max(1, Math.ceil(agents.length / 20))
  ui.clubPage = Math.min(ui.clubPage, pages - 1)
  const labels: Record<FacilityId, string> = { stadium: '球场', academy: '青训设施', medical: '医疗设施', shop: '球迷商店', sponsor: '赞助商' }
  return `
    <div class="page-head"><div><div class="eyebrow">俱乐部</div><h1>设施与转会市场</h1><p>余额：<b>${economy.balance.toLocaleString()}</b></p></div></div>
    <div class="panel"><div class="panel-head"><h2>俱乐部设施</h2></div>
      <p class="muted small">每完成一轮获得基础收入；球场、商店和赞助商提供额外收入。青训设施提升训练效果，医疗设施缩短新伤病的恢复时间。</p>
      <p class="muted small">设施提供额外成长，每项主属性各有自己的上限（由球员画像决定，通常不到 1500）。球场对各属性生效；医疗对应身体，青训对应技术，商店对应决断、团队合作和镇定，赞助商对应视野、预判、无球跑动和防守站位。每次行动或事件中，仅对基础成长为正的属性加成：球场每级 +2，对应设施每级 +5；例如医疗 3 级为每项符合条件的身体主属性额外 +15，球场另计。隐藏属性加成按 20/1500 缩放；休息、位置训练及无成长不加成，上限截断成长但不降低现有属性。设施等级在开始培养时锁定，升级从下一次培养生效；旧培养若无设施快照则没有建筑加成。</p>
      <p class="muted small">培养免费，仅消耗 30 精力；联赛获胜在本轮额外收入 ${LEAGUE_WIN_BONUS.toLocaleString()}，友谊赛没有胜场奖金。</p>
      ${(Object.keys(FACILITIES) as FacilityId[]).map((id) => {
        const cost = facilityUpgradeCost(id, economy[id])
        return `<div class="row"><span>${labels[id]} · 等级 ${economy[id]}${FACILITIES[id].incomePerLevel ? ` · 每轮收入 ${FACILITIES[id].incomePerLevel * economy[id]}` : ''}</span><button class="btn small" data-action="club-upgrade" data-facility="${id}" ${cost === null || economy.balance < cost ? 'disabled' : ''}>${cost === null ? '已满级' : `升级 · ${cost.toLocaleString()}`}</button></div>`
      }).join('')}
    </div>
    <div class="panel"><div class="panel-head"><h2>合同与工资</h2><span>每轮工资 ${game.roster.reduce((sum, player) => sum + (player.contract?.wage ?? 0), 0).toLocaleString()}</span></div>
      <p class="muted small">合同到期赛季结束后，球员进入自由市场；阵容不足 13 人时自动续约。工资每轮从俱乐部余额扣除。</p>
      ${game.roster.map((player) => `<div class="row"><span>${esc(player.name)} · ${player.age ?? 24} 岁 · 合同至第 ${player.contract?.expiresSeason ?? '—'} 赛季 · 周薪 ${player.contract?.wage?.toLocaleString() ?? '—'}</span><span><button class="btn small" data-action="contract-renew" data-player="${esc(player.id)}">续约 2 年</button><button class="btn small ghost" data-action="contract-release" data-player="${esc(player.id)}">解约</button></span></div>`).join('')}
    </div>
    <div class="panel"><div class="panel-head"><h2>本地 NPC 转会市场</h2><span class="muted">${game.world ? (transferWindowOpen(game) ? '转会窗口开放' : '转会窗口关闭') : '开放'}</span></div><p class="muted small">仅与本地 NPC 交易，并非玩家之间的市场。挂牌后球员离开阵容；下一轮结算时，报价不超过估值两倍的挂牌可成交，否则继续挂牌。挂牌须保留至少 10 人和合法阵容；培养中或待确认的球员不能挂牌，比赛中不能交易，赛季结束后不能新挂牌。${game.world ? '转会窗口：第 1-10 轮、20-30 轮。' : ''}</p>
      <h3>已挂牌</h3>${market?.listings.length ? market.listings.map(({ player, price }) => `<div class="row"><span>${esc(player.name)} · 报价 ${price.toLocaleString()} · 估值 ${playerMarketValue(player).toLocaleString()}</span><button class="btn small" data-action="club-cancel" data-player="${esc(player.id)}">取消挂牌</button></div>`).join('') : '<p class="muted">暂无挂牌。</p>'}
      <h3>出售球员</h3>${game.roster.map((player) => `<div class="row"><span>${esc(player.name)} · 估值 ${playerMarketValue(player).toLocaleString()}</span><span><input type="number" min="1" max="9007199254740991" step="1" value="${playerMarketValue(player)}" aria-label="${esc(player.name)} 的要价" data-club-price="${esc(player.id)}"><button class="btn small" data-action="club-list" data-player="${esc(player.id)}">挂牌</button></span></div>`).join('')}
      <h3>从 AI 球队买人</h3>
      ${game.aiTeams.slice(0, 6).map((team) => `<div class="round-box"><h4>${esc(team.name)}</h4>${team.players.slice(0, 3).map((player) => `<div class="row"><span>${esc(player.name)} · CA ${playerCA(player).toFixed(1)} · ${Math.round(playerMarketValue(player) * 1.5).toLocaleString()}</span><button class="btn small" data-action="club-buy-ai" data-team="${team.id}" data-player="${esc(player.id)}" ${!transferWindowOpen(game) || game.roster.length >= 25 || economy.balance < Math.round(playerMarketValue(player) * 1.5) ? 'disabled' : ''}>买入</button></div>`).join('')}</div>`).join('')}
    </div>
    <div class="panel"><div class="panel-head"><h2>自由球员</h2><span>${agents.length} 人</span></div>
      <div class="searchbox"><input id="club-search" placeholder="搜索姓名 / 国家 / 英文名" value="${esc(ui.clubSearch)}"><button class="btn small" data-action="club-search">搜索</button></div>
      ${agents.slice(ui.clubPage * 20, ui.clubPage * 20 + 20).map((player) => { const price = playerMarketValue(player); return `<div class="row"><span>${esc(player.name)} · ${esc(player.enName)} · ${esc(player.country)} · CA ${playerCA(player).toFixed(1)} · ${price.toLocaleString()}</span><button class="btn small" data-action="club-buy" data-player="${esc(player.id)}" ${game.activeMatch || price <= 0 || economy.balance < price || !transferWindowOpen(game) || game.roster.length >= 25 ? 'disabled' : ''}>签入</button></div>` }).join('') || '<p class="muted">没有匹配的自由球员。</p>'}
      <div class="pager"><button class="btn small" data-action="club-prev" ${ui.clubPage === 0 ? 'disabled' : ''}>上一页</button><span>${ui.clubPage + 1} / ${pages}</span><button class="btn small" data-action="club-next" ${ui.clubPage >= pages - 1 ? 'disabled' : ''}>下一页</button></div>
    </div>`
}

function renderHome(): string {
  const fixture = playerFixture(game)
  const isHome = fixture?.homeId === 'player'
  const opponent = fixture ? teamName(game, isHome ? fixture.awayId : fixture.homeId) : ''
  const next = fixture
    ? `<div class="match-next"><div class="eyebrow">本轮对手</div><h2>${esc(opponent)}</h2><p>${seasonRoundLabel(game)} · ${isHome ? '主场' : '客场'} · 20 队双循环</p><button class="btn primary" data-action="start-league">开始本轮比赛</button></div>`
    : `<div class="match-next"><div class="eyebrow">本轮</div><h2>等待赛程</h2><p>本轮没有可进行的比赛。</p></div>`
  const sessions = Object.values(game.training).filter((session) => !session.completed).length
  const candidates = Object.keys(game.candidates).length
  const active = game.activeMatch
    ? `<div class="callout"><b>有进行中的比赛</b><span>${esc(game.activeMatch.context.opponentName)} · 种子 ${game.activeMatch.context.seed}</span><button class="btn primary" data-nav="match">继续比赛</button></div>`
    : ''
  return `
    <section class="hero">
      <div>
        <div class="eyebrow">1990 — 现在 · 500 名真实球星 · 三级世界</div>
        <h1>把名字放进你的青训营。</h1>
        <p class="lede">冠军 / 一级 / 二级南北区，最多 80 支球队。二级球队从零开始，靠升级附加赛打进一级；30 次行动决定一名球员的成品，训练消耗精力，比赛消耗体力。</p>
        <div class="btn-row">
          <button class="btn primary" data-nav="training">进入培养</button>
          <button class="btn" data-nav="lineup">调整阵容</button>
          <button class="btn ghost" data-nav="academy">浏览青训</button>
        </div>
      </div>
      <div class="hero-stats">
        <div><b>${game.roster.length}</b><span>本队球员</span></div>
        <div><b>${game.world?.clubs.length ?? game.aiTeams.length + 1}</b><span>世界球队</span></div>
        <div><b>${game.season.finished ? '完赛' : `第 ${game.season.round} 轮`}</b><span>赛季进度</span></div>
        <div><b>${sessions}</b><span>培养中</span></div>
      </div>
    </section>
    ${active}
    ${ui.notice ? `<div class="callout notice-inline">${esc(ui.notice)}</div>` : ''}
    <div class="grid two">
      ${next}
      <div class="panel">
        <div class="panel-head"><h2>积分榜</h2><button class="link" data-nav="season">赛季页 →</button></div>
        ${renderTableMini()}
      </div>
    </div>
    <div class="grid two">
      <div class="panel">
        <div class="panel-head"><h2>培养提醒</h2><button class="link" data-nav="training">培养页 →</button></div>
        ${sessions === 0 && candidates === 0 ? '<p class="muted">还没有进行中的培养。选一名球员，完成 30 次行动。</p>' : ''}
        ${sessions > 0 ? `<p>进行中：${sessions} 人</p>` : ''}
        ${candidates > 0 ? `<p class="warn-text">待确认候选：${candidates} 人</p>` : ''}
        ${Object.values(game.training).slice(0, 3).map((session) => {
          const player = game.roster.find((item) => item.id === session.playerId)
          return player ? `<div class="row"><span>${esc(player.name)} · ${session.action}/${trainingActionsTotal(session)}</span><button class="link" data-action="open-training" data-player="${player.id}">继续 →</button></div>` : ''
        }).join('')}
      </div>
      <div class="panel">
        <div class="panel-head"><h2>最近比赛</h2><button class="link" data-nav="review">全部复盘 →</button></div>
        ${game.matchHistory.length === 0 ? '<p class="muted">还没有比赛记录。</p>' : game.matchHistory.slice(0, 4).map((record) => `
          <div class="row">
            <span>${esc(record.homeName)} ${record.score.home}:${record.score.away} ${esc(record.awayName)}${record.shootout ? `（点球 ${record.shootout.home}:${record.shootout.away}）` : ''}</span>
            <button class="link" data-action="open-review" data-record="${record.id}">复盘 →</button>
          </div>`).join('')}
      </div>
    </div>
  `
}

function renderTableMini(): string {
  return `
    <table class="table mini">
      <thead><tr><th>#</th><th>球队</th><th>场</th><th>净胜</th><th>分</th></tr></thead>
      <tbody>${game.season.table.map((row, index) => `
        <tr class="${row.teamId === 'player' ? 'me' : ''}">
          <td>${index + 1}</td>
          <td>${esc(teamName(game, row.teamId))}</td>
          <td>${row.played}</td>
          <td>${row.gf - row.ga > 0 ? '+' : ''}${row.gf - row.ga}</td>
          <td><b>${row.points}</b></td>
        </tr>`).join('')}</tbody>
    </table>
  `
}

function filteredRoster(): Player[] {
  const query = ui.academySearch.trim().toLowerCase()
  return game.roster
    .filter((player) => {
      if (ui.academyPos !== 'ALL' && player.positions[ui.academyPos] <= 0) return false
      if (ui.academyEra !== 'ALL' && player.era !== ui.academyEra) return false
      if (!query) return true
      return `${player.name} ${player.enName} ${player.country}`.toLowerCase().includes(query)
    })
    .sort((a, b) => playerCA(b) - playerCA(a))
}

function renderAcademy(): string {
  const all = filteredRoster()
  const pageSize = 24
  const pageCount = Math.max(1, Math.ceil(all.length / pageSize))
  ui.academyPage = Math.min(ui.academyPage, pageCount - 1)
  const page = all.slice(ui.academyPage * pageSize, ui.academyPage * pageSize + pageSize)
  const eras = [...new Set(game.roster.map((player) => player.era))]
  return `
    <div class="page-head">
      <div><div class="eyebrow">青训名单</div><h1>${game.roster.length} 名可培养球员</h1><p class="muted">搜索姓名、英文名或国家；点击卡片查看属性与培养历史。</p></div>
      <div class="searchbox">
        <input id="academy-search" placeholder="搜索球员 / 国家 / 英文名" value="${esc(ui.academySearch)}" />
        <select id="academy-era">
          <option value="ALL">全部年代</option>
          ${eras.map((era) => `<option value="${era}" ${ui.academyEra === era ? 'selected' : ''}>${esc(era)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="filter-row">
      <button class="chip ${ui.academyPos === 'ALL' ? 'active' : ''}" data-filter-pos="ALL">全部</button>
      ${POSITIONS.map((pos) => `<button class="chip ${ui.academyPos === pos ? 'active' : ''}" data-filter-pos="${pos}">${positionLabel(pos)}</button>`).join('')}
      <span class="muted">${all.length} 人 · 第 ${ui.academyPage + 1}/${pageCount} 页</span>
    </div>
    <div id="academy-results" class="card-grid">
      ${page.map((player) => renderPlayerCard(player)).join('')}
    </div>
    ${pageCount > 1 ? `<div class="pager"><button class="btn small" data-action="academy-prev" ${ui.academyPage === 0 ? 'disabled' : ''}>上一页</button><span>${ui.academyPage + 1} / ${pageCount}</span><button class="btn small" data-action="academy-next" ${ui.academyPage >= pageCount - 1 ? 'disabled' : ''}>下一页</button></div>` : ''}
  `
}

function injuryLabel(player: Player): string {
  const until = injuryUntil(game, player)
  if (until === null) return ''
  const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60_000))
  return `受伤 · 约 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分后恢复`
}

function renderPlayerCard(player: Player): string {
  const session = game.training[player.id]
  const candidate = game.candidates[player.id]
  const primary = POSITIONS.filter((pos) => player.positions[pos] > 0).sort((a, b) => player.positions[b] - player.positions[a])[0] ?? 'CM'
  return `
    <button class="player-card" data-action="detail" data-player="${player.id}">
      <div class="card-top">
        <span class="pos ${positionClass(primary)}">${positionLabel(primary)}</span>
        <span class="muted small">${esc(player.era)} · ${esc(player.country)}</span>
      </div>
      <div class="player-name">${esc(player.name)}</div>
      <div class="player-en">${esc(player.enName)}</div>
      <div class="card-bars">
        <div><span>CA</span><b>${playerCA(player).toFixed(1)}</b></div>
        <div><span>年龄</span><b>${player.version === 0 ? '原型' : `成品 v${player.version}`}</b></div>
      </div>
      <div class="card-tags">
        ${player.skills.slice(0, 3).map((skill) => `<span class="tag">${skillName(skill)}</span>`).join('')}
        ${injuryLabel(player) ? '<span class="tag candidate">受伤</span>' : ''}
        ${session && !session.completed ? '<span class="tag training">培养中</span>' : ''}
        ${candidate || session?.completed ? '<span class="tag candidate">待确认</span>' : ''}
      </div>
    </button>
  `
}

function renderAccountOverlay(): string {
  if (!ui.accountOpen) return ''
  const online = onlineState.status === 'online'
  const mode = publicConfig.registration
  const canRegister = mode === 'open' || mode === 'invite'
  const registering = ui.authMode === 'register' && canRegister
  const registrationHint = mode === 'closed'
    ? '<p class="muted small">本服务器已关闭注册，仅限已有账号登录。</p>'
    : mode === 'unknown'
      ? '<p class="muted small">当前离线或服务器不可达，无法注册新账号；本地存档仍可正常游玩。</p>'
      : ''
  return `
    <div class="overlay" data-action="account-close">
      <div class="modal account-modal" data-stop="true">
        <button class="modal-close" data-action="account-close">×</button>
        <div class="eyebrow">联机账号</div>
        <h1>${online ? '已连接服务器' : registering ? '注册账号' : '登录账号'}</h1>
        ${online ? `
          <p>当前账号：<b>${esc(onlineState.user?.username ?? '')}</b> · 第 ${onlineState.revision} 版存档${onlineState.connected ? ' · SSE 已连接' : ' · SSE 重连中'}</p>
          <p class="muted small">另一台设备保存后会自动同步到这里。冲突时服务器版本优先。</p>
          <div class="btn-row"><button class="btn primary" data-action="agent-token">生成 / 复制 Agent 令牌</button><button class="btn ghost" data-action="agent-revoke">重置令牌</button></div>
          <p class="muted small">把 fm_... 令牌交给 Claude / Cursor 的 MCP 配置；不需要给账号密码。令牌可随时重置。</p>
          <div class="btn-row"><button class="btn ghost" data-action="account-logout">退出登录</button><button class="btn" data-action="account-close">关闭</button></div>
        ` : `
          <p class="muted">登录后存档保存到服务器，并用 SSE 在多个页面/设备间同步。离线时仍可玩本地存档。</p>
          <div class="form-row"><label>用户名</label><input id="account-username" autocomplete="username" placeholder="2-24 位" /></div>
          <div class="form-row"><label>密码</label><input id="account-password" type="password" autocomplete="${registering ? 'new-password' : 'current-password'}" placeholder="至少 6 位" /></div>
          ${registering && mode === 'invite' ? '<div class="form-row"><label>邀请码</label><input id="account-invite" autocomplete="off" placeholder="向管理员索取" /></div>' : ''}
          ${registering && publicConfig.turnstileSiteKey ? '<div class="turnstile-slot" id="turnstile-slot"></div>' : ''}
          ${registrationHint}
          ${onlineState.error ? `<p class="warn-text">${esc(onlineState.error)}</p>` : ''}
          <div class="btn-row">
            <button class="btn primary" data-action="account-submit">${registering ? '注册并进入' : '登录'}</button>
            ${canRegister ? `<button class="btn" data-action="account-mode">${registering ? '已有账号，去登录' : '没有账号，去注册'}</button>` : ''}
          </div>
        `}
      </div>
    </div>
  `
}

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

/** render() 会重建 DOM，验证码控件在每次重建后重新挂载。 */
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
  ui.notice = '联赛比赛已结束。'
}

function applyOnlineGame(next: GameState, notice?: string): void {
  const previous = game.activeMatch
  const wasMatch = ui.screen === 'match'
  game = next
  upgradeLegacySignatures(game)
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
      ui.turnstileToken = ''
      applyOnlineGame(data.game, `已注册并登录 ${data.user.username}，存档已同步。`)
      return
    }
    const data = await loginOnline(username, password)
    ui.accountOpen = false
    applyOnlineGame(data.game, `已登录 ${data.user.username}，存档已同步。`)
  } catch (error) {
    /* Turnstile token 一次性有效，失败后 render() 会重新挂载控件取新 token。 */
    ui.turnstileToken = ''
    ui.notice = error instanceof Error ? error.message : '登录失败'
    render()
  }
}

function bootOnline(): void {
  setRemoteGameHandler((next) => applyOnlineGame(next))
  subscribeOnline(() => render())
  void loadPublicConfig().then(() => render())
  void initOnline().then((remote) => {
    if (remote) applyOnlineGame(remote, '已从服务器载入最新存档。')
  })
}

function renderDetailOverlay(): string {
  if (!ui.detailPlayerId) return ''
  const player = game.roster.find((item) => item.id === ui.detailPlayerId)
  if (!player) return ''
  const gk = player.positions.GK > 0
  const session = game.training[player.id]
  const candidate = game.candidates[player.id]
  return `
    <div class="overlay" data-action="close-detail">
      <div class="modal" data-stop="true">
        <button class="modal-close" data-action="close-detail">×</button>
        <div class="modal-head">
          <div>
            <div class="eyebrow">球员详情 · ${esc(player.country)} · ${esc(player.era)}</div>
            <h1>${esc(player.name)} <small>${esc(player.enName)}</small></h1>
            <p>${esc(traitName(player.traitId))} · ${gk ? '门将' : '外场'} · ${player.age ?? 24} 岁 · 惯用脚 ${player.foot} · ${player.height}cm${player.contract ? ` · 合同至第 ${player.contract.expiresSeason} 赛季 · 周薪 ${player.contract.wage.toLocaleString()}` : ''}</p>
            ${injuryLabel(player) ? `<p class="warn-text">${injuryLabel(player)}；带伤比赛能力下降 30%，不影响精力或培养。</p>` : ''}
          </div>
          <div class="big-ca"><b>${playerCA(player).toFixed(1)}</b><span>CA</span><span>初始 CA ${initialDisplayCA(player).toFixed(1)}</span></div>
        </div>
        <div class="grid two">
          <div>
            <h3>主属性（0–1500）</h3>
            ${ATTR_GROUPS.filter((group) => gk || group.name !== '门将').map((group) => {
              const keys = group.attrs.filter((key) => mainAttrsFor(gk).includes(key))
              return keys.length === 0 ? '' : `
              <div class="attr-group"><div class="attr-group-title">${group.name}</div>
                ${keys.map((key) => `<div class="attr-row"><span>${attrLabel(key)}</span><div class="bar"><i style="width:${attrRating(key, player.attrs[key], gk)}%"></i></div><b>${attrValue(player, key).toFixed(1)}</b></div>`).join('')}
              </div>`
            }).join('')}
            <p class="muted small">隐藏属性不公开数值，只通过事件、配合或测验成长。</p>
          </div>
          <div>
            <h3>位置熟练度</h3>
            ${POSITIONS.filter((pos) => gk ? pos === 'GK' : pos !== 'GK').map((pos) => `<div class="attr-row"><span>${positionLabel(pos)}</span><div class="bar"><i style="width:${player.positions[pos]}%"></i></div><b>${Math.round(player.positions[pos])}</b></div>`).join('')}
            <h3>特性与技能</h3>
            <p><span class="tag gold">${esc(traitName(player.traitId))}</span></p>
            ${renderSkillGroups(player)}
            <h3>性格</h3>
            <p class="muted">职业素养 ${player.personality.professionalism} · 进取心 ${player.personality.ambition} · 适应力 ${player.personality.adaptability}</p>
            ${session || candidate ? `<div class="callout"><b>${candidate || session?.completed ? '有待确认的候选成品' : '正在培养'}</b><button class="btn primary small" data-action="open-training" data-player="${player.id}">查看培养</button></div>` : `<button class="btn primary" data-action="start-training" data-player="${player.id}">开始 30 次培养</button>`}
            ${player.history?.length ? `<h3>上一轮记录</h3><div class="log compact">${player.history.slice(-8).reverse().map((entry) => `<div class="log-row"><b>${esc(entry.title)}</b><span>${esc(trainingLogText(entry, gk))}</span></div>`).join('')}</div>` : ''}
          </div>
        </div>
      </div>
    </div>
  `
}

function renderSkillGroups(player: Player): string {
  return (['main', 'auxiliary'] as const).map((category) => {
    const skills = player.skills.filter((skill) => skillCategory(skill) === category)
    return `<p><b>${category === 'main' ? '主技能' : '辅助技能'} ${skills.length}/${skillCapacity(category)}</b> · ${skills.map((skill) => `<span class="tag">${skillName(skill)} · ${skillTierLabel(player, skill)}</span>`).join(' ') || '无'}</p>`
  }).join('')
}

function skillTierLabel(player: Player, skill: SkillId): string {
  return { silver: '银', gold: '金', rainbow: '彩' }[getSkillTier(player, skill)]
}

function renderTraining(): string {
  const selected = ui.trainingPlayerId ? game.roster.find((player) => player.id === ui.trainingPlayerId) : null
  const sessions = Object.values(game.training)
  return `
    <div class="page-head">
      <div><div class="eyebrow">培养</div><h1>新培养 30 个时段，15 天</h1><p class="muted">每天上午、下午各一个时段；每周一上午交流赛，周五上午队内比赛、下午休息。旧课程保留原有规则。成长逐轮累积，确认前不会替换旧成品。</p></div>
      <div class="training-select">
        <label>选择球员</label>
        <select id="training-player-select">
          <option value="">— 选择 —</option>
          ${game.roster.map((player) => `<option value="${player.id}" ${ui.trainingPlayerId === player.id ? 'selected' : ''}>${esc(player.name)} · ${POSITION_LABELS[primaryPosition(player)]} · CA ${playerCA(player).toFixed(1)}</option>`).join('')}
        </select>
      </div>
    </div>
    ${sessions.length > 0 ? `<div class="filter-row">${sessions.map((session) => {
      const player = game.roster.find((item) => item.id === session.playerId)
      return player ? `<button class="chip ${ui.trainingPlayerId === player.id ? 'active' : ''}" data-action="open-training" data-player="${player.id}">${esc(player.name)} · ${session.action}/${trainingActionsTotal(session)} ${session.pendingEventId ? '· 待处理事件' : session.completed ? '✓' : ''}</button>` : ''
    }).join('')}</div>` : ''}
    ${!selected ? `<div class="empty">先选择一名球员，或从青训卡片进入。</div>` : renderTrainingPlayer(selected)}
  `
}

function primaryPosition(player: Player): Position {
  return POSITIONS.filter((pos) => player.positions[pos] > 0).sort((a, b) => player.positions[b] - player.positions[a])[0] ?? 'CM'
}

function renderTrainingPlayer(player: Player): string {
  const session = game.training[player.id]
  const candidate = game.candidates[player.id]
  if (!session && !candidate) {
    return `
      <div class="panel training-start">
        <div class="panel-head"><h2>${esc(player.name)}</h2><span class="muted">当前 CA ${playerCA(player).toFixed(1)} · 初始 CA ${initialDisplayCA(player).toFixed(1)}</span></div>
        <p>本轮从当前成品继续培养。</p>
        <p class="muted">培养不消耗金币；开始一轮消耗 <b>${TRAINING_ENERGY_COST}</b> 点精力，当前精力 <b>${Math.round(player.energy ?? 100)}</b>，比赛日推进时恢复。设施提供额外成长，主属性最高 1500；设施等级在开始时锁定，升级从下一次培养生效。</p>
        <button class="btn primary" data-action="start-training" data-player="${player.id}" ${(player.energy ?? 100) < TRAINING_ENERGY_COST ? 'disabled' : ''}>${(player.energy ?? 100) < TRAINING_ENERGY_COST ? '精力不足，等待恢复' : '开始培养'}</button>
      </div>
      ${renderPlayerMini(player)}
    `
  }
  const currentSession = session!
  const current = player
  const cand = candidate ?? currentSession.candidate
  const pendingEvent = currentSession.pendingEventId ? eventById(currentSession.pendingEventId) : null
  return `
    ${renderTrainingHeader(current, currentSession, cand)}
    ${pendingEvent ? renderEventPanel(currentSession, pendingEvent) : ''}
    ${currentSession.completed || candidate ? renderCandidatePanel(current, cand, currentSession) : ''}
    ${currentSession.scheduleVersion === 1 && currentSession.exchangeMatches?.length ? `<div class="panel"><h2>交流赛记录</h2>${currentSession.exchangeMatches.map((match) => `<div class="row"><span>第 ${match.week} 周 · ${esc(match.opponentName)} · ${match.homeScore}:${match.awayScore} · ${{ win: '胜', draw: '平', loss: '负' }[match.result]}</span></div>`).join('')}</div>` : ''}
    ${!pendingEvent && !currentSession.completed && !candidate ? (currentSession.scheduleVersion === 1 ? renderCalendarActionPanel(currentSession) : renderActionPanel(currentSession)) : ''}
    <div class="grid two">
      <div class="panel">
        <div class="panel-head"><h2>行动日志</h2><span class="muted">${currentSession.log.length} 条</span></div>
        <div class="log">${currentSession.log.slice(-24).reverse().map((entry) => `
          <div class="log-row ${entry.kind}">
            <div class="log-head"><b>${esc(entry.title)}</b><span>行动 ${entry.action} · 第 ${entry.week} 周 ${entry.fatigue ? `· 训练体力 ${entry.fatigue > 0 ? '-' : '+'}${Math.abs(entry.fatigue)}` : ''}</span></div>
            <p>${esc(trainingLogText(entry, player.positions.GK > 0))}</p>
            ${entry.gains ? `<div class="gains">${gainText(entry.gains, player.positions.GK > 0)}</div>` : ''}
          </div>`).join('')}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>当前成品</h2><span class="muted">v${current.version}</span></div>
        ${renderPlayerMini(current)}
        <div class="divider"></div>
        <h3>候选预览</h3>
        ${renderPlayerMini(cand, current)}
      </div>
    </div>
  `
}

function renderTrainingHeader(current: Player, session: TrainingSession, cand: Player): string {
  const fatigue = Math.round(session.fatigue)
  const stamina = 100 - fatigue
  const total = trainingActionsTotal(session)
  const route = session.routeId ? `${ROUTE_LABELS[session.routeId]} · ${session.routePoints}/2` : '未选择路线'
  const eventP = eventChance(session, session.action + 1)
  return `
    <div class="training-header">
      <div>
        <div class="eyebrow">${session.scheduleVersion === 1 ? (() => { const date = trainingDate(Math.min(total, session.action + 1)); return `第 ${date.week} 周 · ${date.dayLabel} ${date.slot}` })() : `第 ${weekOfAction(Math.max(1, session.action))} 周`} · 行动 ${session.action}/${total}</div>
        <h1>${esc(current.name)} <small>${esc(current.enName)}</small></h1>
        <p>${esc(traitName(current.traitId))} · ${route} · ${session.candidate.skills.map((skill) => skillName(skill)).join('、') || '尚无学习技能'}</p>
        <p class="muted small">设施加成按本轮开始时的快照计算；升级从下一次培养生效；已有快照的课程下一行动使用新规则，旧培养若无设施快照则没有建筑加成。每项主属性有各自上限，练到该属性的上限即停。CA 是综合能力参考值（0–1500），不是培养上限；比赛使用各项属性。</p>
      </div>
      <div class="stat-strip">
        <div><span>当前 CA</span><b>${playerCA(current).toFixed(1)}</b></div>
        <div><span>候选 CA</span><b>${playerCA(cand).toFixed(1)}</b></div>
        <div><span>训练体力</span><b class="${stamina < 35 ? 'warn-text' : ''}">${stamina}</b></div>
        <div><span>剩余精力</span><b>${Math.round(current.energy ?? 100)}</b></div>
        <div><span>下次事件</span><b>${session.action >= total ? '—' : pct(eventP)}</b></div>
      </div>
    </div>
    <div class="progress"><i style="width:${(session.action / total) * 100}%"></i><em style="width:${fatigue}%"></em></div>
  `
}

function renderCalendarActionPanel(session: TrainingSession): string {
  const options = trainingOptions(session)
  const selected = options.find((item) => item.id === ui.trainingActivity) ?? options[0]
  if (!selected) return '<div class="panel">当前没有可用行动。</div>'
  ui.trainingActivity = selected.id as TrainingActivityId
  const isGk = session.candidate.positions.GK > 0
  if (selected.parameters === 'position') {
    if (isGk) ui.trainingPosition = 'GK'
    else if (ui.trainingPosition === 'GK') ui.trainingPosition = 'CM'
  }
  const mentors = game.roster.filter((player) => player.id !== session.playerId && player.skills.length > 0)
  const mentor = mentors.find((player) => player.id === ui.trainingMentorId) ?? mentors[0]
  ui.trainingMentorId = mentor?.id ?? ''
  if (!mentor?.skills.includes(ui.trainingSkill as SkillId)) ui.trainingSkill = mentor?.skills[0] ?? null
  const request = buildTrainingRequest()
  const preview = previewTraining(game, session.playerId, request)
  const plan = preview.plan
  const date = trainingDate(session.action + 1)
  const lowMood = date.day <= 3 && (session.lowMoodWeeks ?? []).includes(date.week)
  const teammates = eligibleTrainingTeammates(session)
  return `<div class="panel action-panel">
    <div class="panel-head"><h2>第 ${date.week} 周 · ${date.dayLabel} ${date.slot}</h2><span>行动 ${session.action + 1}/${trainingActionsTotal(session)}</span></div>
    ${lowMood ? '<p class="warn-text">低落情绪：本周一至周三成长 -50%。</p>' : ''}
    <div class="tabs">${options.map((item) => `<button class="tab ${item.id === selected.id ? 'active' : ''}" data-training-activity="${esc(item.id)}">${esc(item.label)}<small>${esc(item.stamina)}</small></button>`).join('')}</div>
    <p class="action-desc">${esc(selected.desc)} · 训练体力 ${esc(selected.stamina)}</p>
    ${selected.parameters === 'position' ? `<div class="form-row"><label for="training-position">位置</label><select id="training-position">${(isGk ? ['GK'] : ['CB', 'W', 'CM', 'ST']).map((pos) => `<option value="${pos}" ${ui.trainingPosition === pos ? 'selected' : ''}>${positionLabel(pos as Position)} · 当前 ${Math.round(session.candidate.positions[pos as Position])}</option>`).join('')}</select></div>` : ''}
    ${selected.parameters === 'inherit' ? (mentor && ui.trainingSkill ? `<div class="form-row"><label for="training-mentor">导师</label><select id="training-mentor">${mentors.map((item) => `<option value="${esc(item.id)}" ${mentor.id === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></div><div class="form-row"><label for="training-skill">技能</label><select id="training-skill">${mentor.skills.map((skill) => `<option value="${esc(skill)}" ${ui.trainingSkill === skill ? 'selected' : ''}>${esc(skillName(skill))} · ${skillTierLabel(mentor, skill)}</option>`).join('')}</select></div>${(() => { const chances = inheritanceChances(session, mentor, ui.trainingSkill!); const error = validateInheritance(session, mentor, ui.trainingSkill!); return `<p>导师技能：${skillTierLabel(mentor, ui.trainingSkill!)} · 成功率 ${pct(chances.success)}；成功后：银 ${pct(1 - chances.gold - chances.rainbow)} / 金 ${pct(chances.gold)} / 彩 ${pct(chances.rainbow)}</p><p class="${error ? 'warn-text' : 'muted'}">${error ? esc(error) : '符合传承条件'}</p>` })()}` : '<p class="muted">阵容中没有拥有技能的可用导师。</p>') : ''}
    ${selected.group ? `<div class="training-teammates"><h3>共同训练队友</h3>${teammates.map((mate) => `<label><input type="checkbox" data-training-teammate="${esc(mate.id)}" value="${esc(mate.id)}" ${ui.trainingTeammateIds.includes(mate.id) ? 'checked' : ''}> ${esc(mate.name)} · 训练体力 ${Math.round(100 - game.training[mate.id].fatigue)}</label>`).join(' ') || '<p class="muted">暂无可选队友。</p>'}</div>` : ''}
    ${selected.group ? '<p class="muted small">可选择同进度且无待处理事件的培养队友；每名其他队友使正成长主属性额外 +2，隐藏属性按比例缩放，设施加成另计。</p>' : ''}
    <p class="muted small">属性课程品质：一般 50% ×0.7 / 成功 30% ×1 / 大成功 15% ×1.3 / 完美成功 5% ×1.6；品质在同一行动固定，不因切换项目重抽。</p>
    ${plan ? `<div class="preview"><div class="preview-title">预览</div><div class="preview-grid"><div><span>属性成长</span><b>${gainText(plan.gains, isGk) || '—'}</b></div><div><span>CA</span><b>${displayCA(plan.caBefore).toFixed(1)} → ${displayCA(plan.caAfter).toFixed(1)}</b></div><div class="training-stamina-preview"><span>训练体力</span><b>${100 - session.fatigue} → ${100 - Math.max(0, Math.min(100, session.fatigue + plan.fatigue))}</b></div>${plan.quality ? `<div class="training-quality"><span>品质</span><b>${esc(plan.quality.label)} ×${plan.quality.multiplier}</b></div>` : ''}</div>${plan.note ? `<p class="muted small">${esc(plan.note)}</p>` : ''}</div>` : ''}
    ${preview.error ? `<p class="warn-text training-error" role="alert">${esc(preview.error)}</p>` : ''}
    <button class="btn primary wide" data-action="training-execute" ${preview.error || !plan ? 'disabled' : ''}>${preview.error || !plan ? '无法执行' : '执行行动'}</button>
  </div>`
}

function renderActionPanel(session: TrainingSession): string {
  const isGk = session.candidate.positions.GK > 0
  if (ui.trainingKind === 'drill') {
    const validAttrs = mainAttrsFor(isGk)
    if (!validAttrs.includes(ui.trainingAttr)) ui.trainingAttr = 'passing'
  }
  const mentors = game.roster.filter((player) => player.id !== session.playerId && player.skills.length > 0)
  let mentor = mentors.find((player) => player.id === ui.trainingMentorId)
  if (!mentor) mentor = mentors[0]
  ui.trainingMentorId = mentor?.id ?? ''
  if (!mentor?.skills.includes(ui.trainingSkill as SkillId)) ui.trainingSkill = mentor?.skills[0] ?? null
  if (ui.trainingKind === 'position') {
    if (isGk) ui.trainingPosition = 'GK'
    else if (ui.trainingPosition === 'GK') ui.trainingPosition = 'CM'
  }
  const request = buildTrainingRequest()
  const inheritanceError = ui.trainingKind === 'inherit' ? (!mentor || !ui.trainingSkill ? '没有可用的导师或技能' : validateInheritance(session, mentor, ui.trainingSkill)) : null
  const preview = previewTraining(game, session.playerId, request)
  const plan = preview.plan ?? planTraining(session, request, mentor)
  const error = preview.error
  const invalid = !!error
  const teammates = eligibleTrainingTeammates(session)
  const groupAction = ui.trainingKind === 'drill' || ui.trainingKind === 'combo' || ui.trainingKind === 'match'
  return `
    <div class="panel action-panel">
      <div class="panel-head"><h2>本次行动</h2><span class="muted">行动 ${session.action + 1}/${trainingActionsTotal(session)}</span></div>
      <div class="tabs">
        ${TRAINING_ACTION_INFO.map((item) => `<button class="tab ${ui.trainingKind === item.id ? 'active' : ''}" data-training-kind="${item.id}">${item.label}<small>训练体力 ${item.id === 'rest' ? '+30' : item.id === 'mentor' ? '+5' : `-${item.id === 'drill' ? 12 : item.id === 'combo' ? 16 : item.id === 'match' ? 25 : 8}`}</small></button>`).join('')}
      </div>
      <p class="action-desc">${esc(TRAINING_ACTION_INFO.find((item) => item.id === ui.trainingKind)?.desc ?? '')} 培养不消耗金币；开始时扣除 30 精力。训练体力与精力、比赛体能不同。设施加成额外计入，主属性最高 1500。</p>
      ${ui.trainingKind === 'drill' ? `
        <div class="attr-picker">
          ${mainAttrsFor(isGk).map((key) => `<button class="attr-chip ${ui.trainingAttr === key ? 'active' : ''}" data-training-attr="${key}">${attrLabel(key)}<small>${attrValue(session.candidate, key).toFixed(0)}</small></button>`).join('')}
        </div>` : ''}
      ${ui.trainingKind === 'combo' ? `<div class="btn-row"><button class="btn ${ui.trainingCombo === 'attack' ? 'primary' : ''}" data-training-combo="attack">进攻配合</button><button class="btn ${ui.trainingCombo === 'defense' ? 'primary' : ''}" data-training-combo="defense">防守配合</button></div>` : ''}
      ${ui.trainingKind === 'position' ? `<div class="form-row"><label>位置</label><select id="training-position">${(isGk ? ['GK'] : ['CB', 'W', 'CM', 'ST']).map((pos) => `<option value="${pos}" ${ui.trainingPosition === pos ? 'selected' : ''}>${positionLabel(pos as Position)} · 当前 ${Math.round(session.candidate.positions[pos as Position])}</option>`).join('')}</select></div>` : ''}
      ${ui.trainingKind === 'protection' ? `<div class="form-row"><label for="training-protection">防护方向</label><select id="training-protection"><option value="prevention" ${ui.trainingProtection === 'prevention' ? 'selected' : ''}>伤病预防</option><option value="resilience" ${ui.trainingProtection === 'resilience' ? 'selected' : ''}>伤病韧性</option></select></div>` : ''}
      ${ui.trainingKind === 'inherit' ? (mentor && ui.trainingSkill ? `
        <div class="form-row"><label for="training-mentor">导师</label><select id="training-mentor">${mentors.map((item) => `<option value="${esc(item.id)}" ${mentor.id === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></div>
        <div class="form-row"><label for="training-skill">技能</label><select id="training-skill">${mentor.skills.map((skill) => `<option value="${esc(skill)}" ${ui.trainingSkill === skill ? 'selected' : ''}>${esc(skillName(skill))} · ${skillTierLabel(mentor, skill)}</option>`).join('')}</select></div>
        ${(() => { const chances = inheritanceChances(session, mentor, ui.trainingSkill!); return `<p>导师技能：${skillTierLabel(mentor!, ui.trainingSkill!)} · 成功率 ${pct(chances.success)}；成功后：银 ${pct(1 - chances.gold - chances.rainbow)} / 金 ${pct(chances.gold)} / 彩 ${pct(chances.rainbow)}</p>` })()}
        <p class="${inheritanceError ? 'warn-text' : 'muted'}">${inheritanceError ? esc(inheritanceError) : '符合传承条件'}</p>` : '<p class="muted">阵容中没有拥有技能的可用导师。</p>') : ''}
      ${groupAction ? `<div class="training-teammates"><h3>共同训练队友</h3><p class="muted small">仅显示同一行动进度且没有待处理事件的培养中球员。所有人执行相同训练，各自消耗训练体力、获得成长并独立触发事件；须分别处理待处理事件。每名其他队友使本次正成长的主属性额外 +2，隐藏属性按比例缩放。</p>${teammates.map((mate) => `<label><input type="checkbox" data-training-teammate="${esc(mate.id)}" value="${esc(mate.id)}" ${ui.trainingTeammateIds.includes(mate.id) ? 'checked' : ''}> ${esc(mate.name)} · 训练体力 ${Math.round(100 - game.training[mate.id].fatigue)}</label>`).join(' ') || '<p class="muted">暂无可选队友。</p>'}</div>` : ''}
      <p class="muted small training-quality-probabilities">专项、配合、队内比赛品质：一般 50% ×0.7 / 成功 30% ×1 / 大成功 15% ×1.3 / 完美成功 5% ×1.6；仅影响基础成长。同一课程行动的品质固定，切换选择不能重抽。</p>
      <div class="preview">
        <div class="preview-title">预览 <span class="muted">与执行使用同一规则</span></div>
        <div class="preview-grid">
          <div><span>属性成长</span><b>${gainText(plan.gains, isGk) || '—'}</b></div>
          <div><span>CA</span><b>${displayCA(plan.caBefore).toFixed(1)} → ${displayCA(plan.caAfter).toFixed(1)}</b></div>
          <div class="training-stamina-preview"><span>训练体力</span><b>${100 - session.fatigue} → ${100 - Math.max(0, Math.min(100, session.fatigue + plan.fatigue))}</b></div>
          ${plan.quality ? `<div class="training-quality"><span>品质</span><b>${esc(plan.quality.label)} ×${plan.quality.multiplier}</b></div>` : ''}
        </div>
        ${plan.note ? `<p class="muted small">${esc(plan.note)}</p>` : ''}
      </div>
      ${error ? `<p class="warn-text training-error" role="alert">${esc(error)}</p>` : ''}
      <button class="btn primary wide" data-action="training-execute" ${invalid ? 'disabled' : ''}>${invalid ? '无法执行' : '执行行动'}</button>
    </div>
  `
}

function eligibleTrainingTeammates(session: TrainingSession): Player[] {
  return game.roster.filter((player) => {
    const other = game.training[player.id]
    return player.id !== session.playerId && !!other && !other.completed && !game.candidates[player.id] && !other.pendingEventId && other.action === session.action && other.scheduleVersion === session.scheduleVersion && (session.scheduleVersion !== 1 || other.scheduleSeed === session.scheduleSeed) && other.action < trainingActionsTotal(other)
  })
}

function buildTrainingRequest(): TrainingRequest {
  const session = ui.trainingPlayerId ? game.training[ui.trainingPlayerId] : undefined
  const eligible = session ? new Set(eligibleTrainingTeammates(session).map((player) => player.id)) : new Set<string>()
  ui.trainingTeammateIds = ui.trainingTeammateIds.filter((id) => eligible.has(id))
  const teammateIds = ui.trainingTeammateIds
  if (session?.scheduleVersion === 1) {
    const options = trainingOptions(session)
    const activity = options.find((option) => option.id === ui.trainingActivity) ?? options[0]
    if (activity) {
      ui.trainingActivity = activity.id as TrainingActivityId
      return { kind: 'activity', activityId: ui.trainingActivity, ...(activity.group ? { teammateIds } : {}), ...(activity.parameters === 'position' ? { position: ui.trainingPosition } : {}), ...(activity.parameters === 'inherit' ? { mentorId: ui.trainingMentorId, skill: ui.trainingSkill ?? 'injury_prevention' } : {}) }
    }
  }
  if (ui.trainingKind === 'drill') return { kind: 'drill', attr: ui.trainingAttr, teammateIds }
  if (ui.trainingKind === 'combo') return { kind: 'combo', focus: ui.trainingCombo, teammateIds }
  if (ui.trainingKind === 'match') return { kind: 'match', teammateIds }
  if (ui.trainingKind === 'position') return { kind: 'position', position: ui.trainingPosition }
  if (ui.trainingKind === 'rest') return { kind: 'rest' }
  if (ui.trainingKind === 'protection') return { kind: 'protection', focus: ui.trainingProtection }
  if (ui.trainingKind === 'inherit') return { kind: 'inherit', mentorId: ui.trainingMentorId, skill: ui.trainingSkill ?? 'injury_prevention' }
  return { kind: 'mentor' }
}

function renderEventPanel(session: TrainingSession, event: NonNullable<ReturnType<typeof eventById>>): string {
  const isGk = session.candidate.positions.GK > 0
  return `
    <div class="panel event-panel">
      <div class="panel-head"><h2>${esc(event.title)}</h2><span class="tag ${event.mainline ? 'gold' : ''}">${event.mainline ? '主线' : event.category === 'chain' ? `事件链 ${event.stage}/3` : '训练事件'}</span></div>
      <p class="event-text">${esc(event.text)}</p>
      <div class="options">
        ${event.options.map((option) => {
          const p = option.branch ? branchProbability(session, option.branch.check, option.branch.p) : undefined
          return `<button class="option" data-action="event-option" data-option="${option.id}">
            <div class="option-head"><b>${esc(option.label)}</b>${p !== undefined ? `<span class="prob">${option.branch?.chanceText ?? '成功率'} ${pct(p, 0)}</span>` : ''}</div>
            <p>${esc(displayEventHint(option.hint, isGk, eventGrowthScale(session)))}</p>
            ${option.branch ? `<div class="branch-preview"><span class="ok">成功：${esc(option.branch.success.text ?? '')}</span><span class="bad">失败：${esc(option.branch.failure.text ?? '')}</span></div>` : ''}
          </button>`
        }).join('')}
      </div>
      <p class="muted small">选项列出的属性成长为基础值，不含设施加成；${session.scheduleVersion === 1 && (session.lowMoodWeeks ?? []).includes(trainingDate(session.pendingEventAction ?? session.action).week) && trainingDate(session.pendingEventAction ?? session.action).day <= 3 ? '低落情绪会使属性成长减少 50%；' : ''}接近各自上限时实际成长可能较少。随机结果展示概率并立即保存。</p>
    </div>
  `
}

function renderCandidatePanel(current: Player, cand: Player, session: TrainingSession): string {
  return `
    <div class="panel candidate-panel">
      <div class="panel-head"><h2>候选成品</h2><span class="tag candidate">确认前不替换</span></div>
      <p>${trainingActionsTotal(session)} 次行动已结束。旧成品仍可使用；确认后才会替换，并自动修复阵容。隐藏属性的变化不在表中公开。</p>
      <table class="table compare">
        <thead><tr><th>属性</th><th>当前 v${current.version}</th><th>候选 v${cand.version}</th><th>变化</th></tr></thead>
        <tbody>
          ${mainAttrsFor(current.positions.GK > 0).map((key) => {
            const delta = displayAttr(key, cand.attrs[key] - current.attrs[key], current.positions.GK > 0)
            return `<tr><td>${attrLabel(key)}</td><td>${attrValue(current, key).toFixed(1)}</td><td>${attrValue(cand, key).toFixed(1)}</td><td class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '+' : ''}${delta.toFixed(1)}</td></tr>`
          }).join('')}
        </tbody>
      </table>
      <div class="compare-footer">
        <div><span>CA</span><b>${playerCA(current).toFixed(1)} → ${playerCA(cand).toFixed(1)} (${caDelta(current, cand)})</b></div>
        <div><span>技能</span>${renderSkillGroups(cand)}</div>
        <div><span>路线</span><b>${session.routeId ? ROUTE_LABELS[session.routeId] : '未选择'}</b></div>
      </div>
      <div class="btn-row">
        <button class="btn primary" data-action="confirm-candidate" data-player="${current.id}">确认替换</button>
        <button class="btn ghost" data-action="discard-candidate" data-player="${current.id}">放弃候选</button>
      </div>
    </div>
  `
}

function renderPlayerMini(player: Player, compare?: Player): string {
  const gk = player.positions.GK > 0
  return `
    <div class="mini-player">
      <div class="mini-title"><b>${esc(player.name)}</b><span>${gk ? 'GK' : positionLabel(primaryPosition(player))} · CA ${playerCA(player).toFixed(1)}</span></div>
      ${ATTR_GROUPS.filter((group) => gk || group.name !== '门将').map((group) => {
        const keys = group.attrs.filter((key) => mainAttrsFor(gk).includes(key))
        return keys.length === 0 ? '' : `
        <div class="mini-group"><span>${group.name}</span>
          ${keys.map((key) => {
            const delta = compare ? displayAttr(key, player.attrs[key] - compare.attrs[key], gk) : 0
            return `<div class="mini-attr"><em>${attrLabel(key)}</em><i style="width:${attrRating(key, player.attrs[key], gk)}%"></i><b>${attrValue(player, key).toFixed(1)}</b>${compare ? `<small class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '+' : ''}${delta.toFixed(1)}</small>` : ''}</div>`
          }).join('')}
        </div>`
      }).join('')}
    </div>
  `
}

function renderLineup(): string {
  const draft = ui.lineupDraft ?? structuredClone(game.lineup)
  ui.lineupDraft = draft
  const formation = FORMATIONS[draft.formationId]
  const check = validateLineup(game.roster, draft)
  const autoSubs = ui.autoSubsDraft ?? emptyAutoSubs()
  const autoErrors = validateAutoSubPlan(game.roster, draft, autoSubs)
  return `
    <div class="page-head">
      <div><div class="eyebrow">阵容</div><h1>7 首发 + 3 替补</h1><p class="muted">位置熟练度会以 m=0.6+0.4×熟练度/100 折损属性，只应用一次。职责与位置必须匹配。</p></div>
      <div class="btn-row"><button class="btn" data-action="lineup-auto">自动填充</button><button class="btn primary" data-action="lineup-save">保存阵容</button><button class="btn ghost" data-action="world-toggle-offside">越位：${game.settings?.offside ?? true ? '开' : '关'}</button></div>
    </div>
    <div class="grid two">
      <div class="panel">
        <div class="panel-head"><h2>阵型与战术</h2></div>
        <div class="form-row"><label>阵型</label><select id="lineup-formation">${FORMATION_LIST.map((item) => `<option value="${item.id}" ${draft.formationId === item.id ? 'selected' : ''}>${item.label} · ${item.desc.slice(0, 26)}…</option>`).join('')}</select></div>
        ${(Object.keys(TACTIC_LABELS) as (keyof Tactics)[]).map((key) => `<div class="form-row"><label>${TACTIC_LABELS[key].label}</label><select data-tactic="${key}">${Object.entries(TACTIC_LABELS[key].options).map(([value, label]) => `<option value="${value}" ${draft.tactics[key] === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>`).join('')}
        <p class="muted small">${formation.desc}</p>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>教练检查</h2></div>
        ${check.valid ? '<p class="ok">阵容合法，可以开始比赛。</p>' : `<ul class="errors">${check.errors.map((error) => `<li>${esc(error)}</li>`).join('')}</ul>`}
        ${check.warnings.length ? `<ul class="warnings">${check.warnings.map((warning) => `<li>${esc(warning)}</li>`).join('')}</ul>` : ''}
        ${autoErrors.length ? `<ul class="errors">${autoErrors.map((error) => `<li>${esc(error)}</li>`).join('')}</ul>` : ''}
        ${game.roster.filter((player) => (draft.starters.some((starter) => starter.playerId === player.id) || draft.bench.includes(player.id)) && injuryUntil(game, player)).map((player) => `<p class="warn-text">${esc(player.name)}：${injuryLabel(player)}</p>`).join('')}
        <div class="lineup-summary">${lineupSummary(draft)}</div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>首发</h2><span class="muted">位置折损会直接体现在“有效”评分</span></div>
      <div class="lineup-list">
        ${formation.slots.map((slot) => {
          const starter = draft.starters.find((item) => item.slotId === slot.id)
          const player = starter ? game.roster.find((item) => item.id === starter.playerId) : undefined
          const prof = player ? player.positions[slot.position] : 0
          const eligible = game.roster
            .filter((item) => item.positions[slot.position] > 0 || item.id === starter?.playerId)
            .sort((a, b) => roleFit(b.attrs, starter?.role ?? slot.defaultRole) * positionMultiplier(b.positions[slot.position]) - roleFit(a.attrs, starter?.role ?? slot.defaultRole) * positionMultiplier(a.positions[slot.position]))
          return `<div class="lineup-row">
            <div class="slot-label"><span class="pos ${positionClass(slot.position)}">${positionLabel(slot.position)}</span><b>${slot.label}</b>${player ? `<small>熟练 ${Math.round(prof)} · 折损 ${pct(1 - positionMultiplier(prof))}</small>${keyAttrSummary(player, starter?.role ?? slot.defaultRole, slot.position)}` : '<small class="warn-text">未安排</small>'}</div>
            <select data-lineup-player="${slot.id}"><option value="">— 选择球员 —</option>${eligible.map((item) => `<option value="${item.id}" ${item.id === starter?.playerId ? 'selected' : ''}>${esc(item.name)}${injuryUntil(game, item) ? ' · 受伤' : ''} · ${Math.round(item.positions[slot.position])} · CA ${playerCA(item).toFixed(1)}</option>`).join('')}</select>
            <select data-lineup-role="${slot.id}">${ROLES_BY_POSITION[slot.position].map((role) => `<option value="${role}" ${starter?.role === role ? 'selected' : ''}>${ROLES[role].label}</option>`).join('')}</select>
            <span class="fit">${player ? (roleFit(player.attrs, starter?.role ?? slot.defaultRole) * positionMultiplier(prof)).toFixed(1) : '—'}</span>
          </div>`
        }).join('')}
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>替补</h2><span class="muted">最多 3 人，比赛中最多换 3 次</span></div>
      <div class="bench-row">${[0, 1, 2].map((index) => `
        <select data-lineup-bench="${index}"><option value="">— 替补 ${index + 1} —</option>${game.roster.filter((item) => !draft.starters.some((starter) => starter.playerId === item.id)).map((item) => `<option value="${item.id}" ${draft.bench[index] === item.id ? 'selected' : ''}>${esc(item.name)}${injuryUntil(game, item) ? ' · 受伤' : ''} · ${positionLabel(primaryPosition(item))} · CA ${playerCA(item).toFixed(1)}</option>`).join('')}</select>`).join('')}</div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>赛前自动换人</h2><button class="btn small" data-action="auto-sub-add" ${autoSubs.timed.length >= 3 ? 'disabled' : ''}>添加定时换人</button></div>
      <p class="muted small">修改后请保存阵容，从下一场生效。手动与自动共用 3 次；按受伤、定时、体力顺序处理。自动选择能胜任该位置的替补；体力换人要求替补体力不低于阈值，避免连续换下新上场的球员。没有合适替补时不会换人。</p>
      <div class="callout"><b>停赛与纪律</b><span>${Object.keys(game.suspensions ?? {}).length ? Object.entries(game.suspensions ?? {}).map(([id, value]) => `${esc(game.roster.find((player) => player.id === id)?.name ?? id)} 停赛 ${value.matches} 场`).join('；') : '没有停赛球员。红牌停赛 2 场，累计 3 张黄牌停赛 1 场。'}</span></div>
      <div class="form-row"><label for="auto-sub-stamina">体力低于</label><select id="auto-sub-stamina"><option value="">关闭</option>${Array.from({ length: 99 }, (_, i) => i + 1).map((value) => `<option value="${value}" ${autoSubs.staminaBelow === value ? 'selected' : ''}>${value}%</option>`).join('')}</select></div>
      <div class="form-row"><label for="auto-sub-injury">受伤后自动换人</label><input type="checkbox" id="auto-sub-injury" ${autoSubs.onInjury ? 'checked' : ''}></div>
      ${autoSubs.timed.map((rule, index) => `<div class="auto-sub-row">
        <label>比赛时间（分钟） <input aria-label="定时换人时间（分钟）" type="number" min="0.1" max="89.9" step="0.1" data-auto-sub-time="${index}" value="${Math.round(autoSubDisplaySeconds(rule) / 60 * 10) / 10}"></label>
        <select aria-label="定时换下球员" data-auto-sub-out="${index}"><option value="">— 换下首发 —</option>${draft.starters.map((starter) => { const player = game.roster.find((p) => p.id === starter.playerId); return player ? `<option value="${player.id}" ${rule.outId === player.id ? 'selected' : ''}>${esc(player.name)}</option>` : '' }).join('')}</select>
        <select aria-label="定时换上球员" data-auto-sub-in="${index}"><option value="">— 换上替补 —</option>${draft.bench.map((id) => { const player = game.roster.find((p) => p.id === id); return player ? `<option value="${player.id}" ${rule.inId === player.id ? 'selected' : ''}>${esc(player.name)}</option>` : '' }).join('')}</select>
        <button class="btn small" data-action="auto-sub-remove" data-index="${index}">删除</button>
      </div>`).join('')}
      <p class="muted small">定时换人在到时后的下一个比赛事件边界执行。伤病由同一人物的所有成品共用，恢复前带伤比赛能力下降 30%；不影响精力和培养。</p>
    </div>
  `
}

function keyAttrSummary(player: Player, role: RoleId, position: Position): string {
  const gk = player.positions.GK > 0
  const weights = ROLES[role].weights
  const key = (Object.entries(weights).filter(([attr]) => mainAttrsFor(gk).includes(attr as AttrKey)).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'passing') as AttrKey
  const multiplier = positionMultiplier(player.positions[position])
  return `<small class="key-attr">关键 ${attrLabel(key)} ${displayAttr(key, player.attrs[key], gk).toFixed(0)} → ${displayAttr(key, player.attrs[key] * multiplier, gk).toFixed(0)}</small>`
}

function lineupSummary(draft: Lineup): string {
  const roles = draft.starters.map((starter) => ROLES[starter.role]?.label).filter(Boolean)
  return `<p><b>职责：</b>${roles.join(' / ')}</p><p><b>战术：</b>${tacticText(draft.tactics)}</p>`
}

function renderSeason(): string {
  const fixture = playerFixture(game)
  const roundFixtures = currentRoundFixtures(game)
  return `
    <div class="page-head">
      <div><div class="eyebrow">第 ${game.season.index} 赛季 · ${game.world ? worldDivisionLabel(game.world, game.season.divisionId ?? game.world.playerDivisionId) : '联赛'}</div><h1>${game.season.finished ? '赛季结束' : `第 ${game.season.round} / 38 轮`}</h1><p class="muted">20 队双循环：每 3 个游戏日一轮，现实约 1.3 场/天；联赛允许平局，比赛显示 90 分钟（现实约 10 分钟）。${game.season.finished ? '' : `距下一轮自动结算：${matchdayCountdown(game)}`}</p>${game.season.tier === 'division2' ? '<p class="muted small">二级联赛前 8 名进入升级附加赛，3 个升级名额。</p>' : game.season.tier === 'division1' ? '<p class="muted small">一级联赛前三升入冠军联赛，后三降入二级联赛。</p>' : game.season.tier === 'champions' ? '<p class="muted small">冠军联赛后三降入一级联赛。</p>' : ''}</div>
      <div class="btn-row">
        ${game.activeMatch ? `<button class="btn primary" data-nav="match">继续比赛</button>` : ''}
        ${game.season.finished ? `<button class="btn primary" data-action="next-season">开始下一赛季</button>` : fixture && !fixture.played && !game.activeMatch ? `<button class="btn primary" data-action="start-league">开始本轮比赛</button>` : ''}
        ${!fixture && !game.season.finished && !game.activeMatch ? `<button class="btn" data-action="sim-round">模拟本轮</button>` : ''}
      </div>
    </div>
    ${game.season.finished ? `<div class="callout"><b>冠军：${esc(teamName(game, game.season.champion ?? ''))}</b><span>你的最终排名：第 ${game.season.playerFinish ?? '—'} 名</span></div>` : ''}
    <div class="grid two">
      <div class="panel">
        <div class="panel-head"><h2>积分榜</h2></div>
        <table class="table"><thead><tr><th>#</th><th>球队</th><th>场</th><th>胜</th><th>平</th><th>负</th><th>进/失</th><th>净</th><th>分</th></tr></thead>
          <tbody>${game.season.table.map((row, index) => `<tr class="${row.teamId === 'player' ? 'me' : ''}"><td>${index + 1}</td><td>${esc(teamName(game, row.teamId))}</td><td>${row.played}</td><td>${row.won}</td><td>${row.drawn}</td><td>${row.lost}</td><td>${row.gf}/${row.ga}</td><td>${row.gf - row.ga}</td><td><b>${row.points}</b></td></tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>本轮赛程</h2><span class="muted">${seasonRoundLabel(game)}</span></div>
        ${roundFixtures.map((item) => `<div class="fixture ${item.isPlayer ? 'me' : ''}"><span>${esc(teamName(game, item.homeId))} vs ${esc(teamName(game, item.awayId))}</span><b>${item.played && item.score ? `${item.score.home}:${item.score.away}` : '未赛'}</b></div>`).join('')}
        ${!fixture ? '<p class="muted">本轮没有你的比赛，等待服务器结算。</p>' : ''}
        ${fixture && !fixture.played ? `<button class="btn primary wide" data-action="start-league">对阵 ${esc(teamName(game, fixture.awayId))}</button>` : ''}
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>全部赛程</h2></div>
      <div class="fixture-grid">${[1, 2, 3, 4, 5].map((round) => `<div class="round-box"><h3>第 ${round} 轮</h3>${game.season.fixtures.filter((item) => item.round === round).map((item) => `<div class="fixture ${item.isPlayer ? 'me' : ''}"><span>${esc(teamName(game, item.homeId))} vs ${esc(teamName(game, item.awayId))}</span><b>${item.played && item.score ? `${item.score.home}:${item.score.away}` : '—'}</b></div>`).join('')}</div>`).join('')}</div>
    </div>
  `
}


function renderWorld(): string {
  if (!game.world) return `<div class="page-head"><div><div class="eyebrow">世界</div><h1>旧存档</h1><p class="muted">当前存档使用旧的单级联赛；开始新游戏即可进入三级共享世界。</p></div><button class="btn primary" data-action="new-game">开始三级世界</button></div>`
  const world = game.world
  const playerClub = world.clubs.find((club) => club.id === 'player')
  const division = world.divisions.find((item) => item.divisionId === world.playerDivisionId)
  const playoff = world.lastPromotionPlayoff ?? world.promotionPlayoff
  const divisions = [
    { id: 'champions', label: '冠军联赛', note: '20 队 · 顶级 3-4 名真实球星' },
    { id: 'division1', label: '一级联赛', note: '20 队 · 1-2 名真实球星' },
    { id: 'd2-north', label: '二级联赛 · 北区', note: '20 队 · 无真实球星' },
    { id: 'd2-south', label: '二级联赛 · 南区', note: '20 队 · 无真实球星' },
  ]
  return `
    <div class="page-head"><div><div class="eyebrow">赛季 ${world.seasonIndex} · ${world.clubs.length} 支球队</div><h1>三级共享世界</h1><p class="muted">冠军联赛 / 一级联赛 / 二级联赛（南北两区）。当前执教：<b>${esc(playerClub?.name ?? game.clubName)}</b> · ${worldTierLabel(playerClub?.tier ?? 'division2')}${playerClub?.conference ? ` · ${playerClub.conference === 'north' ? '北区' : '南区'}` : ''}。</p></div>
      <div class="btn-row"><button class="btn" data-action="world-toggle-offside">越位：${game.settings?.offside ?? true ? '开' : '关'}</button><button class="btn ghost" data-action="new-game">接管另一支二级球队</button></div>
    </div>
    <div class="grid two">
      <div class="panel"><div class="panel-head"><h2>我的联赛</h2><span>${division ? worldDivisionLabel(world, division.divisionId ?? '') : ''}</span></div>
        ${division ? `<table class="table mini"><thead><tr><th>#</th><th>球队</th><th>场</th><th>净胜</th><th>分</th></tr></thead><tbody>${division.table.map((row, index) => `<tr class="${row.teamId === 'player' ? 'me' : ''}"><td>${index + 1}</td><td>${esc(world.clubs.find((club) => club.id === row.teamId)?.name ?? row.teamId)}</td><td>${row.played}</td><td>${row.gf - row.ga > 0 ? '+' : ''}${row.gf - row.ga}</td><td><b>${row.points}</b></td></tr>`).join('')}</tbody></table>` : '<p class="muted">当前联赛不存在。</p>'}
      </div>
      <div class="panel"><div class="panel-head"><h2>升降级</h2></div>
        <p class="muted small">一级联赛前三升入冠军联赛；冠军联赛后三降入一级联赛；一级联赛后三降入二级联赛。二级南北区前 8 名进入升级附加赛，决出 3 个升级名额。</p>
        ${playoff ? `<p>升级附加赛：${playoff.promoted.map((id) => esc(world.clubs.find((club) => club.id === id)?.name ?? id)).join('、') || '进行中'}</p>` : '<p class="muted">附加赛在赛季结束后自动进行。</p>'}
        ${world.history.length ? `<h3>历史</h3>${world.history.slice().reverse().slice(0, 5).map((item) => `<div class="row"><span>第 ${item.seasonIndex} 赛季 · 冠军 ${esc(item.champion)} · 升级 ${item.promotions.length} 队</span></div>`).join('')}` : ''}
      </div>
    </div>
    <div class="panel"><div class="panel-head"><h2>全部级别</h2><span class="muted">共 ${world.clubs.length} 队</span></div>
      ${divisions.map((item) => { const d = world.divisions.find((entry) => entry.divisionId === item.id); const clubs = world.clubs.filter((club) => (club.tier === 'champions' && item.id === 'champions') || (club.tier === 'division1' && item.id === 'division1') || (club.tier === 'division2' && ((club.conference ?? 'north') === (item.id === 'd2-south' ? 'south' : 'north')))).sort((a, b) => b.strength - a.strength); return `<div class="round-box"><h3>${item.label}</h3><p class="muted small">${item.note} · 已完成 ${d?.fixtures.filter((fixture) => fixture.played).length ?? 0} / ${d?.fixtures.length ?? 0} 场</p><div class="team-meta">${clubs.slice(0, 20).map((club) => `<span class="${club.id === 'player' ? 'ok' : ''}">${esc(club.name)}${club.starPlayerIds.length ? ` · ${club.starPlayerIds.length}★` : ''}</span>`).join('')}</div></div>` }).join('')}
    </div>
    <div class="panel"><div class="panel-head"><h2>接管二级球队</h2></div><p class="muted small">新玩家从二级联赛开始，接手一支无主的 20 队联赛球队；当前世界时间与赛季进度保留。开始新游戏会覆盖本地存档。</p><div class="team-meta">${d2ClubChoices().slice(0, 8).map((club) => `<span>${esc(club.name)} · ${club.conference === 'north' ? '北区' : '南区'}</span>`).join('')}</div></div>
  `
}

function renderChallenge(): string {
  return `
    <div class="page-head"><div><div class="eyebrow">单场挑战</div><h1>友谊赛</h1><p class="muted">不计联赛积分，平局直接进入点球大战。比赛固定种子，读档不能刷新射门。</p></div></div>
    <div class="card-grid challenge-grid">
      ${game.aiTeams.map((team) => `<div class="team-card" style="--team:${team.color};--accent:${team.accent}">
        <div class="team-color"></div>
        <h2>${esc(team.name)}</h2><p>${esc(team.style)}</p>
        <div class="team-meta"><span>${team.formationId}</span><span>${tacticText(team.tactics)}</span></div>
        <div class="team-players">${team.players.slice(0, 7).map((player) => `<span>${esc(player.name)}</span>`).join('')}</div>
        <button class="btn primary" data-action="start-challenge" data-team="${team.id}" ${game.activeMatch ? 'disabled' : ''}>单场挑战</button>
      </div>`).join('')}
    </div>
    <div class="panel"><div class="panel-head"><h2>挑战记录</h2><span class="muted">${game.challengeHistory.length} 场</span></div>
      ${game.challengeHistory.length === 0 ? '<p class="muted">还没有挑战记录。</p>' : game.challengeHistory.map((record) => `<div class="row"><span>${esc(record.awayName)} · ${record.result === 'win' ? '胜' : record.result === 'loss' ? '负' : '平'} ${record.score.home}:${record.score.away}${record.shootout ? `（点球 ${record.shootout.home}:${record.shootout.away}）` : ''}</span><button class="link" data-action="open-review" data-record="${record.id}">复盘 →</button></div>`).join('')}
    </div>
  `
}

function renderReview(): string {
  const record = ui.reviewId ? [...game.matchHistory, ...game.challengeHistory].find((item) => item.id === ui.reviewId) : null
  if (record) return renderRecord(record)
  const records = [...game.matchHistory, ...game.challengeHistory]
  return `
    <div class="page-head"><div><div class="eyebrow">复盘</div><h1>比赛记录</h1><p class="muted">概率、技能条件、失败原因与建议都在这里。表现层不改写比赛结果。</p></div></div>
    ${records.length === 0 ? '<div class="empty">还没有比赛。先去赛季或挑战打一场。</div>' : `<div class="record-list">${records.map((item) => `<button class="record-card" data-action="open-review" data-record="${item.id}">
      <div class="record-score">${item.score.home} : ${item.score.away}${item.shootout ? `<small>点球 ${item.shootout.home}:${item.shootout.away}</small>` : ''}</div>
      <div><b>${esc(item.homeName)} vs ${esc(item.awayName)}</b><span>${item.isLeague ? `联赛第 ${item.round} 轮` : '友谊赛'} · ${item.result === 'win' ? '胜' : item.result === 'loss' ? '负' : '平'} · 种子 ${item.seed}</span></div>
      <span class="link">查看 →</span>
    </button>`).join('')}</div>`}
  `
}

function renderRecord(record: MatchRecord): string {
  if (replay.id !== record.id) resetReplay(record.id)
  const review = buildReview(record)
  const home = record.stats.home
  const away = record.stats.away
  const playerSide = record.awayId === PLAYER_TEAM_ID ? 'away' : 'home'
  return `
    <div class="page-head"><div><button class="link" data-action="back-review">← 返回记录</button><div class="eyebrow">${record.isLeague ? `联赛第 ${record.round} 轮` : '友谊赛'} · 种子 ${record.seed}</div><h1>${esc(record.homeName)} vs ${esc(record.awayName)}</h1></div></div>
    ${renderReplay(record)}
    <details class="review-details"><summary>展开完整赛后复盘（含最终结果）</summary>
    <div class="panel"><h2>最终比分 ${record.score.home} : ${record.score.away}${record.shootout ? ` · 点球 ${record.shootout.home}:${record.shootout.away}` : ''}</h2><p>${record.result === 'win' ? '胜利' : record.result === 'loss' ? '失利' : '平局'}</p></div>
    ${renderGoals(record)}
    <div class="grid two">
      <div class="panel"><div class="panel-head"><h2>比赛统计</h2></div>
        <table class="table"><thead><tr><th></th><th>${esc(record.homeName)}</th><th>${esc(record.awayName)}</th></tr></thead><tbody>
          ${statRow('控球率', `${home.possession}%`, `${away.possession}%`)}
          ${statRow('射门', home.shots, away.shots)}
          ${statRow('射正', home.shotsOnTarget, away.shotsOnTarget)}
          ${statRow('进球', home.goals, away.goals)}
          ${statRow('xG', home.xg.toFixed(2), away.xg.toFixed(2))}
          ${statRow('传球', `${home.passesCompleted}/${home.passes}`, `${away.passesCompleted}/${away.passes}`)}
          ${statRow('拦截', home.interceptions, away.interceptions)}
          ${statRow('抢断', home.tackles, away.tackles)}
          ${statRow('犯规', home.fouls, away.fouls)}
          ${statRow('黄牌', home.yellowCards ?? 0, away.yellowCards ?? 0)}
          ${statRow('红牌', home.redCards ?? 0, away.redCards ?? 0)}
        </tbody></table>
      </div>
      <div class="panel"><div class="panel-head"><h2>复盘建议</h2></div>
        ${review.map((item) => `<div class="advice ${item.tone}"><b>${esc(item.title)}</b><p>${esc(item.detail)}</p></div>`).join('')}
      </div>
    </div>
    <div class="grid two">
      <div class="panel"><div class="panel-head"><h2>关键事件</h2></div><div class="event-log">${record.keyEvents.slice().reverse().map((entry) => renderEvent(entry, record.durationSeconds ?? 600)).join('')}</div></div>
      <div class="panel"><div class="panel-head"><h2>技能 / 失败原因</h2></div>
        ${record.skillStats.filter((skill) => skill.conditions > 0).length === 0 ? '<p class="muted">本场没有技能触发。</p>' : record.skillStats.filter((skill) => skill.conditions > 0).map((skill) => `<div class="row"><span>${esc(skill.name)} · ${SKILLS[skill.skillId].name} <small>${skill.side === playerSide ? '你' : '对手'}</small></span><b>条件 ${skill.conditions} / 生效 ${skill.applied}</b></div>`).join('')}
        <div class="divider"></div>
        ${record.failureStats.map((item) => `<div class="row"><span>${failureLabel(item.reason)}</span><b>${item.count}</b></div>${item.examples.slice(0, 2).map((example) => `<p class="muted small">· ${esc(example)}</p>`).join('')}`).join('')}
      </div>
    </div>
    <div class="panel"><div class="panel-head"><h2>球员数据</h2></div>
      <table class="table"><thead><tr><th>球员</th><th>队</th><th>分钟</th><th>传球</th><th>射门</th><th>进球</th><th>抢断</th><th>拦截</th><th>跑动</th><th>体力</th></tr></thead><tbody>
        ${record.playerStats.slice().sort((a, b) => b.goals - a.goals || b.shots - a.shots).slice(0, 16).map((player) => `<tr><td>${esc(player.name)}</td><td>${player.side === playerSide ? '你' : '对手'}</td><td>${player.minutes.toFixed(0)}</td><td>${player.passesCompleted}/${player.passes}</td><td>${player.shots}</td><td>${player.goals}</td><td>${player.tackles}</td><td>${player.interceptions}</td><td>${player.distance.toFixed(0)}</td><td>${player.staminaLeft}%</td></tr>`).join('')}
      </tbody></table>
    </div>
    </details>
  `
}

function renderCommentary(entry: CommentaryEntry, durationSeconds = 600): string {
  const shootout = entry.shootoutScore ? ` · 点球 ${entry.shootoutScore.home}:${entry.shootoutScore.away}` : ''
  return `<div class="event-line ${esc(entry.type)}"><span class="clock">${clockText(displayClock(entry.clock, durationSeconds))}</span><span class="type">${esc(eventTypeLabel(entry.type))}</span><p>${esc(entry.text)} <small>${entry.score.home}:${entry.score.away}${shootout}</small></p></div>`
}

function renderReplay(record: MatchRecord): string {
  const duration = record.durationSeconds ?? 600
  const entries = record.commentary
  const count = entries?.length ?? record.keyEvents.length
  const shown = entries?.slice(0, replay.index)
  const last = shown?.at(-1)
  return `<div class="panel replay-panel"><div class="panel-head"><h2>文字播放器</h2><span class="muted">${replay.index} / ${count}</span></div>
    <p class="muted">${entries ? '按比赛时钟逐条播放；比分随事件更新。' : '旧记录只有关键事件，历史比分不可用。'}</p>
    <div class="replay-score">${esc(record.homeName)} <b>${entries ? (last ? `${last.score.home} : ${last.score.away}` : '0 : 0') : '— : —'}</b> ${esc(record.awayName)}${last?.shootoutScore ? `<small>点球 ${last.shootoutScore.home} : ${last.shootoutScore.away}</small>` : ''}</div>
    <div class="btn-row"><button class="btn primary" data-action="replay-toggle" ${count === 0 || replay.index >= count ? 'disabled' : ''}>${replay.playing ? '暂停' : '开始 / 继续'}</button><button class="btn" data-action="replay-reset">重新播放</button><button class="btn" data-action="replay-speed">${replay.speed}×</button></div>
    <div class="event-log commentary-log">${entries ? shown!.slice().reverse().map((entry) => renderCommentary(entry, duration)).join('') : record.keyEvents.slice(0, replay.index).reverse().map((entry) => renderEvent(entry, duration)).join('')}${replay.index === 0 ? '<p class="muted">点击开始播放。</p>' : ''}</div></div>`
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

function renderGoals(record: MatchRecord): string {
  const duration = record.durationSeconds ?? 600
  const body = { left: '左脚', right: '右脚', head: '头球' }
  const technique = { power: '力量', placed: '推射', header: '头球' }
  const situation = { open: '运动战', penalty: '点球', free_kick: '任意球' }
  const target = { top_left: '左上', top_center: '中上', top_right: '右上', bottom_left: '左下', bottom_center: '中下', bottom_right: '右下' }
  return `<div class="panel"><div class="panel-head"><h2>进球详情</h2><span class="muted">落点为进攻视角</span></div>${record.goalDetails?.length ? record.goalDetails.map((goal) => `<div class="goal-detail"><b>${esc(goal.playerName)}</b><span>${goal.side === 'home' ? '主队' : '客队'} · ${goal.half === 1 ? '上半场' : '下半场'} ${clockText(displayClock(goal.clock, duration))}</span><span>位置 ${shotPositionText(goal)} (${goal.origin.x.toFixed(1)}, ${goal.origin.y.toFixed(1)}) · 距离 ${goal.distance.toFixed(1)} 米</span><span>${body[goal.bodyPart]}${goal.technique === 'header' ? '' : ` · ${technique[goal.technique]}`} · ${situation[goal.situation]}${goal.chance ? ` · ${goal.chance}` : ' · 旧版未记录机会'} · 落点 ${target[goal.target]}</span></div>`).join('') : '<p class="muted">暂无记录。</p>'}</div>`
}

function statRow(label: string, home: string | number, away: string | number): string {
  return `<tr><td>${label}</td><td>${home}</td><td>${away}</td></tr>`
}

function renderEvent(entry: MatchLogEntry, durationSeconds = 600): string {
  const chance = entry.shotChance ? ` <small class="tag">${entry.shotChance.label} · 保底 ${(entry.shotChance.floor * 100).toFixed(0)}%</small>` : ['shot', 'goal', 'save', 'block', 'miss'].includes(entry.type) ? ' <small class="tag">旧版未记录机会类型</small>' : ''
  const probs = entry.probabilities ? ` <small>${probabilityText(entry.probabilities)}</small>` : ''
  const ratings = entry.ratings ? ` <small class="ratings">${ratingText(entry.ratings)}</small>` : ''
  const skill = entry.skill ? ` <small class="tag">${skillName(entry.skill.id)}${entry.skill.condition ? ' 生效' : ' 未满足'}</small>` : ''
  return `<div class="event-line ${entry.type}"><span class="clock">${clockText(displayClock(entry.clock, durationSeconds))}</span><span class="type">${eventTypeLabel(entry.type)}</span><p>${esc(entry.text)}${chance}${probs}${ratings}${skill}</p></div>`
}

function ratingText(ratings: Record<string, number>): string {
  const labels: Record<string, string> = { a: 'A', d: 'D', c: 'C', p0: 'p0', deviation: '跑位偏差', block: '封堵', onTarget: '射正', goalGiven: '射正后进球', finish: '终结', gk: '门将' }
  return `评分 ${Object.entries(ratings).map(([key, value]) => `${labels[key] ?? key} ${value.toFixed(2)}`).join(' · ')}`
}

function probabilityText(probs: Record<string, number>): string {
  const labels: Record<string, string> = { success: '成功', intercepted: '拦截', out: '出界', loose: '争夺', block: '封堵', off: '偏出', save: '扑救', goal: '进球', tackle: '夺球', foul: '犯规', miss: '罚失', draw: '平' }
  return Object.entries(probs).map(([key, value]) => `${labels[key] ?? key} ${(value * 100).toFixed(0)}%`).join(' / ')
}

function eventTypeLabel(type: string): string {
  const labels: Record<string, string> = { goal: '进球', shot: '射门', save: '扑救', block: '封堵', foul: '犯规', pass: '传球', dribble: '盘带', tackle: '抢断', contest: '争夺', setpiece: '定位球', penalty: '点球', kickoff: '开球', half: '半场', full: '终场', sub: '换人', injury: '受伤', tactic: '战术', miss: '偏出', info: '信息' }
  return labels[type] ?? type
}

function failureLabel(reason: string): string {
  return { unrecognized: '视野不足 / 没识别线路', misjudged: '选择错误', position_timing: '跑位与时机', execution: '执行失败' }[reason] ?? reason
}

function renderMatch(): string {
  if (!game.activeMatch) return '<div class="empty">没有进行中的比赛。</div>'
  if (!ui.matchEngine) ui.matchEngine = restoreActiveEngine(game)
  const engine = ui.matchEngine
  if (!engine) return '<div class="empty">比赛状态读取失败。</div>'
  const state = engine.state
  const home = state.teams[0]
  const away = state.teams[1]
  const totalPoss = state.stats.home.possession + state.stats.away.possession
  const homePoss = totalPoss > 0 ? (state.stats.home.possession / totalPoss) * 100 : 50
  const active = game.activeMatch
  const matchClock = active.context.isLeague ? leagueDisplayClock(active) : displayClock(state.clock, state.durationSeconds)
  return `
    <div class="match-shell">
      <div class="scoreboard">
        <div class="score-team home"><span class="dot" style="background:${home.color}"></span><b>${esc(home.name)}</b><small>${active.context.homeAway === 'home' ? '你' : '对手'}</small></div>
        <div class="score-main"><b>${state.score.home} : ${state.score.away}</b>${state.shootout ? `<small>点球 ${state.shootout.home} : ${state.shootout.away}</small>` : ''}<span>${state.half === 1 ? '上半场' : '下半场'} · <span ${active.context.isLeague ? 'data-league-clock' : ''}>${clockText(matchClock)}</span> / ${clockText(MATCH_DISPLAY_SECONDS)}</span></div>
        <div class="score-team away"><b>${esc(away.name)}</b><small>${active.context.homeAway === 'away' ? '你 · ' : ''}${active.context.isLeague ? `联赛第 ${active.context.round} 轮` : '友谊赛'}</small><span class="dot" style="background:${away.color}"></span></div>
      </div>
      <div class="match-controls">
        ${active.context.isLeague ? `<span class="muted">联赛按现实时间进行，不可暂停、加速或跳过。</span><button class="btn small" data-action="match-coach">教练调整</button>` : `
          <button class="btn ${ui.matchPlaying ? 'primary' : ''}" data-action="match-toggle">${ui.matchPlaying ? '暂停' : state.finished ? '已结束' : '开始 / 继续'}</button>
          <button class="btn small" data-speed="650">慢</button><button class="btn small" data-speed="300">正常</button><button class="btn small" data-speed="120">快</button>
          <button class="btn small" data-action="match-skip">跳过到终场</button>
          <button class="btn small" data-action="match-coach" ${active.coachPausesLeft <= 0 ? 'disabled' : ''}>教练暂停（${active.coachPausesLeft}）</button>`}
        <span class="muted">${state.step} 步 · 种子 ${active.context.seed}</span>
      </div>
      <div class="pitch-wrap"><canvas id="pitch" width="1000" height="640"></canvas></div>
      <div class="match-grid">
        <div class="panel"><div class="panel-head"><h2>比赛态势</h2></div>
          <div class="live-stats">
            <div><span>控球</span><b>${homePoss.toFixed(0)}% / ${(100 - homePoss).toFixed(0)}%</b></div>
            <div><span>射门</span><b>${state.stats.home.shots} / ${state.stats.away.shots}</b></div>
            <div><span>射正</span><b>${state.stats.home.shotsOnTarget} / ${state.stats.away.shotsOnTarget}</b></div>
            <div><span>xG</span><b>${state.stats.home.xg.toFixed(2)} / ${state.stats.away.xg.toFixed(2)}</b></div>
            <div><span>传球</span><b>${state.stats.home.passesCompleted}/${state.stats.home.passes} · ${state.stats.away.passesCompleted}/${state.stats.away.passes}</b></div>
            <div><span>体力</span><b>${avgStamina(home)}% / ${avgStamina(away)}%</b></div>
          </div>
        </div>
        <div class="panel"><div class="panel-head"><h2>文字直播</h2><span class="muted">${state.commentary ? '全部已发生事件' : '旧存档 · 仅日志'}</span></div><div class="event-log live commentary-log">${state.commentary ? state.commentary.slice().reverse().map((entry) => renderCommentary(entry, state.durationSeconds)).join('') : state.log.slice().reverse().map((entry) => renderEvent(entry, state.durationSeconds)).join('')}</div></div>
      </div>
      ${ui.coachPanel ? renderCoachPanel(engine) : ''}
    </div>
  `
}

function avgStamina(team: { players: { onPitch: boolean; stamina: number; maxStamina: number }[] }): number {
  const players = team.players.filter((player) => player.onPitch)
  if (players.length === 0) return 0
  return Math.round((players.reduce((sum, player) => sum + (player.stamina / player.maxStamina) * 100, 0) / players.length) * 10) / 10
}

function renderCoachPanel(engine: MatchEngine): string {
  const side = game.activeMatch!.context.homeAway
  const team = engine.getTeam(side)
  const onPitch = team.players.filter((player) => player.onPitch)
  const bench = engine.availableBench(side)
  return `<div class="panel coach-panel"><div class="panel-head"><h2>教练调整</h2><span class="muted">换人 ${team.subsUsed} / 3 次（含自动）</span></div>
    <div class="grid two">
      <div><h3>战术心态</h3>
        <p class="muted small">当前：${team.mentality ? MATCH_MENTALITY_LABELS[team.mentality] : '赛前战术'} · ${tacticText(team.tactics)}</p>
        <div class="form-row"><label for="match-mentality">比赛指令</label><select id="match-mentality"><option value="attack" ${team.mentality === 'attack' ? 'selected' : ''}>全体进攻</option><option value="balanced" ${!team.mentality || team.mentality === 'balanced' ? 'selected' : ''}>均衡</option><option value="defend" ${team.mentality === 'defend' ? 'selected' : ''}>全体防守</option></select></div>
        <button class="btn primary small" data-action="match-tactics-apply">应用战术</button>
      </div>
      <div><h3>换人</h3>
        <div class="form-row"><label>换下</label><select id="match-out">${onPitch.map((player) => `<option value="${player.id}">${esc(player.name)} · ${positionLabel(player.position)} · 体力 ${Math.round((player.stamina / player.maxStamina) * 100)}%${player.injured ? ' · 受伤' : ''}</option>`).join('')}</select></div>
        <div class="form-row"><label>换上</label><select id="match-in">${bench.length === 0 ? '<option value="">没有可用替补</option>' : bench.map((player) => `<option value="${player.id}">${esc(player.name)} · ${positionLabel(primaryPosition({ positions: player.positions } as Player))}${player.injured ? ' · 受伤' : ''}</option>`).join('')}</select></div>
        <button class="btn primary small" data-action="match-sub" ${bench.length === 0 ? 'disabled' : ''}>确认换人</button>
        <p class="muted small">${game.activeMatch?.context.isLeague ? '联赛继续进行，调整立即生效' : '换人只在教练暂停时进行'}；被换下球员不能再次上场。</p>
      </div>
    </div>
  </div>`
}

function drawPitch(): void {
  const canvas = document.getElementById('pitch') as HTMLCanvasElement | null
  const engine = ui.matchEngine
  if (!canvas || !engine) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const snapshot = engine.snapshot()
  if (game.activeMatch?.context.isLeague) snapshot.clock = leagueElapsed(game.activeMatch)
  const w = canvas.width
  const h = canvas.height
  const pad = 26
  const sx = (w - pad * 2) / PITCH_LENGTH
  const sy = (h - pad * 2) / PITCH_WIDTH
  const x = (value: number) => pad + value * sx
  const y = (value: number) => pad + value * sy
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#07140d'
  ctx.fillRect(0, 0, w, h)
  const stripes = 12
  for (let index = 0; index < stripes; index++) {
    ctx.fillStyle = index % 2 === 0 ? '#123d24' : '#0f3520'
    ctx.fillRect(pad + (index * (w - pad * 2)) / stripes, pad, (w - pad * 2) / stripes, h - pad * 2)
  }
  ctx.strokeStyle = 'rgba(220,255,235,0.65)'
  ctx.lineWidth = 2
  ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2)
  ctx.beginPath(); ctx.moveTo(x(50), y(0)); ctx.lineTo(x(50), y(64)); ctx.stroke()
  ctx.beginPath(); ctx.arc(x(50), y(32), 7 * sx, 0, Math.PI * 2); ctx.stroke()
  ctx.beginPath(); ctx.arc(x(50), y(32), 3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(220,255,235,0.65)'; ctx.fill()
  const boxW = 18 * sx
  const boxH = 30 * sy
  ctx.strokeRect(pad, y(32) - boxH / 2, boxW, boxH)
  ctx.strokeRect(w - pad - boxW, y(32) - boxH / 2, boxW, boxH)
  const goalH = 12 * sy
  ctx.strokeRect(pad - 6, y(32) - goalH / 2, 6, goalH)
  ctx.strokeRect(w - pad, y(32) - goalH / 2, 6, goalH)
  for (const player of snapshot.players) {
    const team = engine.state.teams[player.side === 'home' ? 0 : 1]
    const isGk = player.position === 'GK'
    const px = x(player.x)
    const py = y(player.y)
    ctx.beginPath()
    ctx.arc(px, py, 11, 0, Math.PI * 2)
    ctx.fillStyle = isGk ? '#f8fafc' : team.color
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = team.accent
    ctx.stroke()
    ctx.fillStyle = isGk ? '#0f172a' : '#07140d'
    ctx.font = 'bold 11px system-ui'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(player.number), px, py + 1)
    ctx.beginPath()
    ctx.arc(px, py, 15, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * player.stamina) / 100)
    ctx.strokeStyle = player.stamina > 55 ? 'rgba(52,211,153,0.75)' : 'rgba(248,113,113,0.85)'
    ctx.lineWidth = 2
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.arc(x(snapshot.ball.x), y(snapshot.ball.y), 4.5, 0, Math.PI * 2)
  ctx.fillStyle = '#fefce8'
  ctx.fill()
  ctx.strokeStyle = '#111827'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.fillStyle = 'rgba(220,255,235,0.8)'
  ctx.font = '12px system-ui'
  ctx.textAlign = 'left'
  ctx.fillText(`${snapshot.score.home} : ${snapshot.score.away} · ${clockText(displayClock(snapshot.clock, game.activeMatch?.context.durationSeconds ?? 900))}`, pad + 8, pad + 20)
}

function ensureTimer(): void {
  if (ui.screen !== 'match' || !ui.matchPlaying || !ui.matchEngine || !game.activeMatch || game.activeMatch.context.isLeague) {
    stopTimer()
    return
  }
  if (ui.matchTimer !== null) return
  ui.matchTimer = window.setInterval(() => tickMatch(), ui.matchSpeed)
}

function stopTimer(): void {
  if (ui.matchTimer !== null) {
    window.clearInterval(ui.matchTimer)
    ui.matchTimer = null
  }
}

function tickMatch(): void {
  const engine = ui.matchEngine
  if (!engine || !game.activeMatch || !ui.matchPlaying) return
  if (engine.state.finished) {
    completeMatch()
    return
  }
  const logLength = engine.state.log.length
  engine.step()
  if (engine.state.step % 5 === 0 || engine.state.log.slice(logLength).some((entry) => entry.injury)) syncActiveEngine(game, engine)
  if (engine.state.finished) {
    completeMatch()
    return
  }
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
  const result = startTraining(game, playerId)
  if (!result.ok) {
    showNotice(result.error ?? '无法开始培养')
    return
  }
  openTraining(playerId)
}

function executeTraining(): void {
  if (!ui.trainingPlayerId) return
  const result = trainingAction(game, ui.trainingPlayerId, buildTrainingRequest())
  if (!result.ok) showNotice(result.error ?? '行动失败')
  else {
    ui.trainingTeammateIds = []
    ui.notice = result.exchange ? `交流赛：${result.exchange.homeScore}:${result.exchange.awayScore} 对 ${result.exchange.opponentName} · ${{ win: '胜', draw: '平', loss: '负' }[result.exchange.result]}` : result.event ? `触发事件：${result.event.title}` : '行动完成。'
  }
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

document.addEventListener('click', async (event) => {
  const target = event.target as HTMLElement
  if (target.dataset.stop === 'true') return
  const stopped = target.closest<HTMLElement>('[data-stop="true"]')
  if (stopped && !target.closest('[data-action]') && !target.closest('[data-nav]')) return
  const nav = target.closest<HTMLElement>('[data-nav]')
  if (nav?.dataset.nav) {
    go(nav.dataset.nav as Screen)
    return
  }
  const posFilter = target.closest<HTMLElement>('[data-filter-pos]')
  if (posFilter?.dataset.filterPos) {
    ui.academyPos = posFilter.dataset.filterPos as Position | 'ALL'
    ui.academyPage = 0
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
  const speed = target.closest<HTMLElement>('[data-speed]')
  if (speed?.dataset.speed) {
    if (game.activeMatch?.context.isLeague) return
    ui.matchSpeed = Number(speed.dataset.speed)
    stopTimer()
    render()
    return
  }
  const actionEl = target.closest<HTMLElement>('[data-action]')
  const action = actionEl?.dataset.action
  if (!action) return
  const playerId = actionEl?.dataset.player
  const recordId = actionEl?.dataset.record
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
      const result = upgradeFacility(game, actionEl?.dataset.facility as FacilityId)
      if (result.ok) persist()
      showNotice(result.ok ? '设施已升级。' : `升级失败：${result.error ?? '未知错误'}`)
      break
    }
    case 'club-list':
    case 'club-cancel':
    case 'club-buy':
    case 'club-buy-ai': {
      if (!playerId) break
      const input = actionEl?.parentElement?.querySelector<HTMLInputElement>('[data-club-price]')
      const price = input?.valueAsNumber ?? NaN
      const result = action === 'club-list' ? listPlayer(game, playerId, price) : action === 'club-cancel' ? cancelListing(game, playerId) : action === 'club-buy-ai' ? buyFromClub(game, actionEl?.dataset.team ?? '', playerId) : buyFreeAgent(game, playerId)
      if (result.ok) persist()
      showNotice(result.ok ? (action === 'club-list' ? '已挂牌，等待下一轮结算。' : action === 'club-cancel' ? '已取消挂牌。' : action === 'club-buy-ai' ? '已从 AI 球队买入。' : '已签入球员。') : `交易失败：${result.error ?? '未知错误'}`)
      break
    }
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
      if (game.activeMatch?.context.isLeague) { showNotice('联赛进行中不能开始新游戏。'); break }
      if (window.confirm('开始新游戏会覆盖当前存档，确定吗？')) {
        clearSave()
        const picks = d2ClubChoices()
        const choice = window.prompt('选择要接管的二级联赛球队（输入编号）：\n' + picks.map((club, index) => `${index + 1}. ${club.name}（${club.conference === 'north' ? '北区' : '南区'}）`).join('\n'), '1')
        if (choice === null) break
        const picked = picks[Math.max(0, Math.min(picks.length - 1, Number(choice) - 1))]
        game = createWorldGame(undefined, picked?.id)
        saveGame(game)
        ui = { ...ui, screen: 'home', trainingPlayerId: null, trainingTeammateIds: [], detailPlayerId: null, reviewId: null, lineupDraft: null, autoSubsDraft: null, notice: '新游戏已创建。', matchEngine: null, matchPlaying: false, completing: false }
        stopTimer()
        render()
      }
      break
    case 'detail':
      if (playerId) {
        ui.detailPlayerId = playerId
        render()
      }
      break
    case 'close-detail':
      ui.detailPlayerId = null
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
      if (actionEl?.dataset.option) chooseEvent(actionEl.dataset.option)
      break
    case 'confirm-candidate':
      if (playerId) {
        const result = confirmTraining(game, playerId)
        ui.notice = result.ok ? `已替换 ${result.replacedName ?? ''}。` : result.error ?? '确认失败'
        if (result.ok) {
          ui.trainingPlayerId = playerId
          ui.lineupDraft = null
          ui.autoSubsDraft = null
        }
        render()
      }
      break
    case 'discard-candidate':
      if (playerId) {
        const result = discardTraining(game, playerId)
        ui.notice = result.ok ? '已放弃候选，旧成品保留。' : result.error ?? '放弃失败'
        render()
      }
      break
    case 'academy-prev':
      ui.academyPage = Math.max(0, ui.academyPage - 1)
      render()
      break
    case 'academy-next':
      ui.academyPage += 1
      render()
      break
    case 'lineup-auto':
      ui.lineupDraft = autoFillLineupDraft()
      ui.notice = '已自动填充，记得保存。'
      render()
      break
    case 'lineup-save':
      applyLineup()
      break
    case 'auto-sub-add':
      if (ui.autoSubsDraft && ui.autoSubsDraft.timed.length < 3) {
        ui.autoSubsDraft.timed.push({ atMinute: 5, outId: '', inId: '' })
        render()
      }
      break
    case 'auto-sub-remove':
      if (ui.autoSubsDraft) {
        ui.autoSubsDraft.timed.splice(Number(actionEl?.dataset.index), 1)
        render()
      }
      break
    case 'start-league': {
      if (ui.completing) break
      ui.completing = true
      try {
        if (hasOnlineSession()) await leagueActionOnline({ action: 'start_league' })
        else {
          const result = startLeague(game)
          if (!result.ok) throw new Error(result.error ?? '无法开始比赛')
          advanceLeagueRealtime(game)
        }
        ui.screen = 'match'
        ui.matchEngine = restoreActiveEngine(game)
        ui.matchPlaying = false
        ui.coachPanel = false
        if (!hasOnlineSession()) persist()
        render()
      } catch (error) {
        showNotice(error instanceof Error ? error.message : '无法开始比赛')
      } finally {
        ui.completing = false
      }
      break
    }
    case 'world-toggle-offside':
      game.settings = { ...(game.settings ?? { offside: true }), offside: !(game.settings?.offside ?? true) }
      persist()
      showNotice(`越位规则已${game.settings.offside ? '开启' : '关闭'}。`)
      break
    case 'next-season': {
      const result = startNextSeasonAction(game)
      ui.notice = result.ok ? '新赛季已开始；升级附加赛、升降级、年龄与合同已结算。' : result.error ?? '无法开始下一赛季'
      if (result.ok) persist()
      render()
      break
    }
    case 'sim-round': {
      const result = simulateSeasonRound(game)
      ui.notice = result.ok ? '本轮 AI 比赛已模拟。' : result.error ?? '无法模拟'
      render()
      break
    }
    case 'start-challenge': {
      const teamId = actionEl?.dataset.team
      if (!teamId) break
      const result = startSingleChallenge(game, teamId)
      if (!result.ok) showNotice(result.error ?? '无法开始挑战')
      else {
        ui.screen = 'match'
        ui.matchEngine = restoreActiveEngine(game)
        ui.matchPlaying = true
        ui.coachPanel = false
        ui.completing = false
        persist()
        render()
      }
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
    case 'match-coach':
      if (game.activeMatch?.context.isLeague) {
        ui.coachPanel = !ui.coachPanel
        render()
      } else if (useCoachPause(game)) {
        ui.matchPlaying = false
        stopTimer()
        ui.coachPanel = true
        render()
      } else showNotice('教练暂停已用完。')
      break
    case 'match-tactics-apply':
      if (ui.matchEngine) {
        const mentality = (document.getElementById('match-mentality') as HTMLSelectElement | null)?.value as MatchMentality
        if (game.activeMatch?.context.isLeague && hasOnlineSession()) {
          try {
            await leagueActionOnline({ action: 'set_match_tactics', mentality })
            ui.notice = '战术已更新。'
          } catch (error) { ui.notice = error instanceof Error ? error.message : '更新失败' }
        } else {
          if (game.activeMatch?.context.isLeague) tickRealtimeLeague()
          if (!ui.matchEngine || !game.activeMatch) break
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
      if (game.activeMatch?.context.isLeague && hasOnlineSession()) {
        try {
          await leagueActionOnline({ action: 'substitute', outId: out, inId: input })
          ui.notice = '换人完成。'
        } catch (error) { ui.notice = error instanceof Error ? error.message : '换人失败' }
      } else {
        if (game.activeMatch?.context.isLeague) tickRealtimeLeague()
        if (!ui.matchEngine || !game.activeMatch) break
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
  if (target.id === 'academy-era') {
    ui.academyEra = target.value
    ui.academyPage = 0
    persist()
    render()
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
  if (target.id === 'lineup-formation' && ui.lineupDraft) {
    const formationId = target.value as Lineup['formationId']
    ui.lineupDraft = structuredClone(autoFillLineup(game.roster, formationId, ui.lineupDraft.tactics))
    render()
    return
  }
  const tactic = target.dataset.tactic as keyof Tactics | undefined
  if (tactic && ui.lineupDraft) {
    ;(ui.lineupDraft.tactics as unknown as Record<string, string>)[tactic] = target.value
    render()
    return
  }
  const slotId = target.dataset.lineupPlayer
  if (slotId && ui.lineupDraft) {
    updateLineupDraft((draft) => {
      const starter = draft.starters.find((item) => item.slotId === slotId)
      if (starter) starter.playerId = target.value
      else draft.starters.push({ slotId, playerId: target.value, role: FORMATIONS[draft.formationId].slots.find((slot) => slot.id === slotId)?.defaultRole ?? 'cm_organizer' })
    })
    return
  }
  const roleSlot = target.dataset.lineupRole
  if (roleSlot && ui.lineupDraft) {
    updateLineupDraft((draft) => {
      const starter = draft.starters.find((item) => item.slotId === roleSlot)
      if (starter) starter.role = target.value as RoleId
    })
    return
  }
  const benchIndex = target.dataset.lineupBench
  if (benchIndex !== undefined && ui.lineupDraft) {
    updateLineupDraft((draft) => {
      const index = Number(benchIndex)
      if (target.value) draft.bench[index] = target.value
      else draft.bench.splice(index, 1)
    })
  }
})

document.addEventListener('input', (event) => {
  const target = event.target as HTMLInputElement
  if (target.id === 'academy-search') {
    ui.academySearch = target.value
    ui.academyPage = 0
    render()
    const next = document.getElementById('academy-search') as HTMLInputElement | null
    if (next) {
      next.focus()
      const length = next.value.length
      next.setSelectionRange(length, length)
    }
  }
})

function autoFillLineupDraft(): Lineup {
  const base = ui.lineupDraft ?? game.lineup
  return structuredClone(autoFillLineup(game.roster, base.formationId, base.tactics))
}

function autoAdvanceSeason(): void {
  if (hasOnlineSession() || game.activeMatch || game.season.finished) return
  const result = catchUpSeason(game)
  if (result.advanced <= 0) return
  ui.notice = `已自动结算 ${result.advanced} 轮比赛。`
  persist()
  render()
}

function tickRealtimeLeague(): void {
  const active = game.activeMatch
  if (!active?.context.isLeague) return
  if (!hasOnlineSession() && advanceLeagueRealtime(game)) {
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

window.setInterval(tickRealtimeLeague, 1000)
window.setInterval(autoAdvanceSeason, 30_000)
autoAdvanceSeason()
render()
bootOnline()
