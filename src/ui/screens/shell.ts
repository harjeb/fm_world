import { economyOf } from '../../game/economy.ts'
import { transferWindowOpen } from '../../game/market.ts'
import { PLAYER_TEAM_ID, inPostseason, matchdayCountdown, nextSeasonCountdown, playerFixture, seasonRoundLabel } from '../../game/season.ts'
import { gameDateOf } from '../../game/calendar.ts'
import { worldDivisionLabel } from '../../game/world.ts'
import { isOnlineMode, marketState, onlineKickoffPending, onlineState, serverNow } from '../../online.ts'
import { clubLook, crest } from '../components.ts'
import { countdownText, esc } from '../format.ts'
import { leadingBid } from '../../game/auction.ts'
import { icon, type IconName } from '../icons.ts'
import { game, ui, type Screen } from '../state.ts'

type NavItem = { id: Screen; label: string; icon: IconName; badge?: () => number }

function trainingAttention(): number {
  const pending = Object.values(game.training).filter((session) => session.pendingEventId || session.completed).length
  const candidatesOnly = Object.keys(game.candidates).filter((id) => !game.training[id]).length
  return pending + candidatesOnly
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: '', items: [{ id: 'home', label: '总览', icon: 'home' }] },
  {
    label: '球队',
    items: [
      { id: 'lineup', label: '战术', icon: 'lineup' },
      { id: 'academy', label: '球员', icon: 'academy' },
      { id: 'inventory', label: '库存', icon: 'cards' },
      { id: 'training', label: '培养', icon: 'training', badge: trainingAttention },
    ],
  },
  {
    label: '赛事',
    items: [
      { id: 'season', label: '赛季', icon: 'season' },
      { id: 'challenge', label: '挑战', icon: 'challenge' },
      { id: 'review', label: '复盘', icon: 'review' },
      { id: 'world', label: '世界', icon: 'world' },
    ],
  },
  { label: '经营', items: [
    { id: 'club', label: '俱乐部', icon: 'club' },
    { id: 'transfer', label: '转会', icon: 'swap', badge: () => (isOnlineMode() ? marketState.auctions.length : 0) },
  ] },
]

/** 游戏内日期：从 2026/11/01 起，每个真实 6 小时过一天。 */
function dateLabel(): string {
  const start = game.world?.calendarStartAt ?? game.createdAt
  return gameDateOf(start, Date.now()).label
}

function divisionText(): string {
  if (!game.world) return '联赛'
  return worldDivisionLabel(game.world, game.season.divisionId ?? game.world.playerDivisionId)
}

export function renderSidebar(): string {
  const look = clubLook(PLAYER_TEAM_ID)
  return `<aside class="sidebar" style="--club:${esc(look.color)}">
    <button class="side-club" data-action="go-home" title="回到总览">
      ${crest(look, 38)}
      <span class="side-club-text"><b>${esc(game.clubName)}</b><small>${esc(divisionText())}</small></span>
    </button>
    <nav class="side-nav" aria-label="主导航">
      ${game.activeMatch ? `<button class="nav-item live ${ui.screen === 'match' ? 'active' : ''}" data-nav="match">${icon('live', 18)}<span class="nav-label">比赛<span class="nav-extra">进行中</span></span></button>` : ''}
      ${NAV_GROUPS.map((group) => `
        ${group.label ? `<div class="nav-group">${group.label}</div>` : ''}
        ${group.items.map((item) => {
          const count = item.badge?.() ?? 0
          return `<button class="nav-item ${ui.screen === item.id ? 'active' : ''}" data-nav="${item.id}" ${ui.screen === item.id ? 'aria-current="page"' : ''}>${icon(item.icon, 18)}<span class="nav-label">${item.label}</span>${count ? `<span class="nav-badge">${count}</span>` : ''}</button>`
        }).join('')}
      `).join('')}
    </nav>
    <div class="side-foot">
      <span class="brand-mark">FM</span>
      <span class="brand-text"><b>FM 世界</b><small>种子 ${game.seed}</small></span>
    </div>
  </aside>`
}

function continueAction(): string {
  if (game.activeMatch && ui.screen === 'match') return `<span class="continue-wait live">${icon('live', 14)}比赛进行中</span>`
  if (game.activeMatch) return `<button class="btn primary continue" data-nav="match">${icon('play', 14)}继续比赛</button>`
  // 离线存档可以手动把日历推向下一个比赛日；联机时时间由服务器统一掌控。
  if (inPostseason(game)) {
    return isOnlineMode()
      ? `<span class="continue-wait">${icon('clock', 14)}赛后休整 · ${esc(nextSeasonCountdown(game))}</span>`
      : `<button class="btn primary continue" data-action="skip-postseason" title="跳过赛后休整，直接开新赛季">${icon('skip', 14)}跳至新赛季</button>`
  }
  if (game.season.finished) return `<button class="btn primary continue" data-action="next-season">${icon('play', 14)}开始下一赛季</button>`
  const fixture = playerFixture(game)
  if (fixture && !fixture.played) {
    // 联机联赛由服务器到点自动结算，顶栏只显示倒计时或结算状态；单机可以跳到比赛日。
    if (isOnlineMode()) {
      return onlineKickoffPending(game)
        ? `<span class="continue-wait">${icon('clock', 14)}下一轮 · ${esc(matchdayCountdown(game, serverNow()))}</span>`
        : `<span class="continue-wait">${icon('live', 14)}本轮由服务器自动结算</span>`
    }
    return `<button class="btn primary continue" data-action="start-league" title="把游戏日历快进到本轮比赛日，体能按跳过的天数恢复">${icon('play', 14)}跳至比赛日</button>`
  }
  return `<span class="continue-wait">${icon('clock', 14)}等待下一轮</span>`
}

/** 全服竞拍在任何页面都看得到。 */
function auctionChip(): string {
  if (!isOnlineMode() || !marketState.auctions.length) return ''
  const soonest = Math.min(...marketState.auctions.map((auction) => auction.endsAt))
  return `<button class="btn ghost auction-chip" data-action="open-auctions" title="全服自由球员竞拍">${icon('coin', 15)}<span>竞拍 ${marketState.auctions.length}</span><span class="countdown" data-countdown-end="${soonest}">${countdownText(soonest - serverNow())}</span></button>`
}

export function renderTopbar(): string {
  const economy = economyOf(game)
  const online = onlineState.status === 'online'
  const account = onlineState.user ? esc(onlineState.user.username) : '登录 / 注册'
  const sync = online ? (onlineState.connected ? '已同步' : '连接中') : ''
  return `<header class="topbar">
    <div class="top-stats">
      <div class="top-stat optional"><span>${esc(dateLabel())}</span><b>${esc(seasonRoundLabel(game))}</b></div>
      <div class="top-stat"><span>第 ${game.season.index} 赛季</span><b>${esc(divisionText())}</b></div>
      ${game.season.finished
        ? (inPostseason(game) ? `<div class="top-stat"><span>赛后休整</span><b>${esc(nextSeasonCountdown(game))}</b></div>` : '')
        : `<div class="top-stat optional"><span>距下一轮</span><b>${esc(matchdayCountdown(game))}</b></div>`}
      <div class="top-stat"><span>余额</span><b>${economy.balance.toLocaleString()}</b></div>
      <div class="top-stat optional"><span>转会窗</span><b class="${transferWindowOpen(game) ? 'ok' : 'muted'}">${transferWindowOpen(game) ? '开放' : '关闭'}</b></div>
    </div>
    <div class="top-actions">
      ${auctionChip()}
      <button class="btn ghost top-account" data-action="account-open">${icon('user', 15)}<span class="account-name">${account}</span>${sync ? `<span class="sync-state ${onlineState.connected ? 'ok' : 'muted'}">${sync}</span>` : ''}</button>
      <button class="btn ghost" data-action="new-game" title="开始新游戏">${icon('newgame', 15)}<span class="optional">新游戏</span></button>
      ${continueAction()}
    </div>
  </header>`
}

/** 最近多久的成交还上滚动条。 */
const TICKER_DEAL_WINDOW_MS = 24 * 3_600_000

/**
 * 全服转会播报：顶栏下面的滚动条，所有联机玩家都能看到。
 * 正在竞拍的球员（领先俱乐部、当前价、剩余时间）和最近的成交 / 流拍。
 * 内容复制一份接在后面，平移一半宽度就能无缝循环；倒计时由每秒的 data-countdown-end 定时器更新。
 */
export function renderMarketTicker(): string {
  if (!isOnlineMode()) return ''
  const now = serverNow()
  const auctions = [...marketState.auctions].filter((auction) => auction.bids.length > 0).sort((a, b) => a.endsAt - b.endsAt)
  const deals = marketState.log.filter((item) => now - item.at < TICKER_DEAL_WINDOW_MS).slice(0, 6)
  const items = [
    ...auctions.map((auction) => {
      const lead = leadingBid(auction)
      const raises = auction.bids.length - 1
      return `<span class="ticker-item live">${icon('coin', 13)}<b>${esc(lead.club)}</b> 出价 <b class="num">${lead.amount.toLocaleString()}</b> 竞拍 <b>${esc(auction.playerName)}</b>${raises > 0 ? ` · 已跟价 ${raises} 次` : ''} · 剩余 <span class="countdown" data-countdown-end="${auction.endsAt}">${countdownText(auction.endsAt - now)}</span></span>`
    }),
    ...deals.map((item) => item.club
      ? `<span class="ticker-item deal">${icon('check', 13)}<b>${esc(item.club)}</b> 以 <b class="num">${item.amount.toLocaleString()}</b> 签下了 <b>${esc(item.playerName)}</b></span>`
      : `<span class="ticker-item muted">${esc(item.playerName)} 流拍，回到自由市场</span>`),
  ]
  if (!items.length) return ''
  // 每条大约停留 7 秒，条数越多一圈越长。
  const duration = Math.max(18, items.length * 7)
  const strip = items.join('<span class="ticker-sep" aria-hidden="true">◆</span>')
  return `<div class="market-ticker" data-action="open-auctions" role="status" aria-label="全服转会播报" title="点击查看全服竞拍">
    <span class="ticker-label">${icon('live', 13)}全服转会</span>
    <div class="ticker-viewport"><div class="ticker-track" style="animation-duration:${duration}s">
      <span class="ticker-strip">${strip}<span class="ticker-sep" aria-hidden="true">◆</span></span><span class="ticker-strip" aria-hidden="true">${strip}<span class="ticker-sep">◆</span></span>
    </div></div>
  </div>`
}
