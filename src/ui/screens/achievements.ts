import {
  ACHIEVEMENT_CATEGORY_LABELS,
  ACHIEVEMENT_CATEGORY_ORDER,
  achievementSummary,
  type AchievementItemView,
} from '../../game/achievements.ts'
import { legendBookLabel } from '../../game/legend-books.ts'
import { SHOP_BOOK_PRICE, shopPointsOf } from '../../game/shop.ts'
import { bookTitle, icon, pageHead, panel, tag, tile } from '../components.ts'
import { esc } from '../format.ts'
import { game, ui, type AchievementFilter } from '../state.ts'

function rewardPills(item: AchievementItemView): string {
  const parts: string[] = []
  if (item.reward.money) {
    parts.push(tag(`金币 +${item.reward.money.toLocaleString()}`, 'gold'))
  }
  if (item.reward.shopPoints) {
    parts.push(tag(`商店点券 +${item.reward.shopPoints}`, 'info'))
  }
  if (item.reward.fans) {
    parts.push(tag(`球迷 +${item.reward.fans.toLocaleString()}`, 'good'))
  }
  if (item.reward.ceilingBonus) {
    parts.push(tag(`主属性上限 +${item.reward.ceilingBonus}`, 'gold'))
  }
  if (item.reward.skillBook) {
    parts.push(bookTitle(legendBookLabel(item.reward.skillBook), item.reward.skillBook.tier))
  }
  if (parts.length === 0) {
    return '<span class="muted small">奖励待定（后续更新）</span>'
  }
  return parts.join(' ')
}

function progressText(item: AchievementItemView): string {
  if (item.unit === '分×10') {
    return `${(item.current / 10).toFixed(1)} / ${(item.target / 10).toFixed(1)} 分`
  }
  return `${item.current.toLocaleString()} / ${item.target.toLocaleString()} ${item.unit}`
}

function renderCard(item: AchievementItemView): string {
  const isWelfare = item.category === 'welfare'
  const masked = item.hidden && !item.unlocked

  if (masked) {
    return `<article class="ach-card is-hidden-locked" data-achievement-card="${esc(item.id)}">
      <div class="ach-card-head">
        <div class="ach-card-title">
          ${tag('隐藏', '')}
          <b class="ach-mystery-title">？？？</b>
        </div>
        <div class="ach-card-action"><span class="muted small">未解锁</span></div>
      </div>
      <p class="ach-card-desc muted small">达成未知的高难赛场或俱乐部壮举后自动解锁揭晓。</p>
      <div class="ach-card-progress">
        <div class="ach-bar is-mystery"><i style="width:0%"></i></div>
        <span class="num-text small muted">？ / ？</span>
      </div>
      <div class="ach-card-foot">
        <span class="muted small">奖励</span>
        <span class="ach-reward">${rewardPills(item)}</span>
      </div>
    </article>`
  }

  const pct = Math.max(0, Math.min(100, Math.round((item.current / Math.max(1, item.target)) * 100)))
  const statusControl = item.claimable
    ? `<button class="btn small primary" data-action="claim-achievement" data-achievement="${esc(item.id)}">领取奖励</button>`
    : item.claimed
      ? tag(item.backfilled ? '已自动补发' : '已领取', 'good')
      : item.unlocked
        ? tag('已解锁', 'good')
        : `<span class="muted small">进行中</span>`
  const cls = [
    'ach-card',
    isWelfare ? 'is-welfare' : '',
    item.hidden && item.unlocked ? 'is-hidden-unlocked' : '',
    item.claimable ? 'is-claimable' : '',
    item.claimed ? 'is-claimed' : '',
  ].filter(Boolean).join(' ')
  return `<article class="${cls}" data-achievement-card="${esc(item.id)}">
    <div class="ach-card-head">
      <div class="ach-card-title">
        ${isWelfare ? tag('1.0 福利', 'gold') : item.hidden ? tag('隐藏已揭晓', 'gold') : ''}
        <b>${esc(item.title)}</b>
      </div>
      <div class="ach-card-action">${statusControl}</div>
    </div>
    <p class="ach-card-desc muted small">${esc(item.desc)}</p>
    <div class="ach-card-progress">
      <div class="ach-bar"><i style="width:${pct}%"></i></div>
      <span class="num-text small ${item.unlocked ? 'up' : 'muted'}">${esc(progressText(item))}</span>
    </div>
    <div class="ach-card-foot">
      <span class="muted small">奖励</span>
      <span class="ach-reward">${rewardPills(item)}</span>
    </div>
  </article>`
}

export function renderAchievements(): string {
  const summary = achievementSummary(game)
  const points = shopPointsOf(game)
  const filter: AchievementFilter = ui.achievementFilter ?? 'all'
  const pendingParts: string[] = []
  if (summary.pendingMoney > 0) pendingParts.push(`+${summary.pendingMoney.toLocaleString()} 金币`)
  if (summary.pendingShopPoints > 0) pendingParts.push(`+${summary.pendingShopPoints} 商店点券`)
  if (summary.pendingCeilingBonus > 0) pendingParts.push(`+${summary.pendingCeilingBonus} 主属性上限`)
  const claimAllBtn = summary.claimable > 0
    ? `<button class="btn primary" data-action="claim-achievement-all">${icon('star', 14)}一键领取全部（${summary.claimable}）</button>`
    : ''
  const backfillBanner = summary.welfareBackfillMoney > 0
    ? `<div class="banner gold">${icon('star', 16)}<b>1.0 正式版巅峰首胜福利已自动补发</b><span>检测到你此前已通关「巅峰之路」第 1 关，福利奖金 <b>${summary.welfareBackfillMoney.toLocaleString()} 金币</b> 已自动发放至俱乐部余额！</span></div>`
    : ''

  const filteredItems = summary.items.filter((item) => {
    if (filter === 'standard') return !item.hidden
    if (filter === 'hidden') return item.hidden
    if (filter === 'unlocked') return item.unlocked
    return true
  })

  const filterTabs: { id: AchievementFilter; label: string }[] = [
    { id: 'all', label: `全部 (${summary.total})` },
    { id: 'standard', label: `常规成就 (${summary.standardTotal})` },
    { id: 'hidden', label: `隐藏挑战 (${summary.hiddenUnlocked}/${summary.hiddenTotal})` },
    { id: 'unlocked', label: `已解锁 (${summary.unlocked})` },
  ]

  const sections = ACHIEVEMENT_CATEGORY_ORDER.map((category) => {
    const list = filteredItems.filter((item) => item.category === category)
    if (!list.length) return ''
    const doneCount = list.filter((item) => item.unlocked).length
    const claimableCount = list.filter((item) => item.claimable).length
    const isHiddenGroup = list.every((item) => item.hidden)
    const aside = claimableCount > 0
      ? tag(`可领取 ${claimableCount}`, 'gold')
      : isHiddenGroup
        ? `<span class="muted small">已揭晓 ${doneCount} / ${list.length}</span>`
        : `<span class="muted small">${doneCount} / ${list.length}</span>`
    // 已解锁或可领取的成就优先排在前面，便于玩家一眼看到刚揭晓的成就
    const sorted = [...list].sort((a, b) => Number(b.claimable) - Number(a.claimable) || Number(b.unlocked) - Number(a.unlocked))
    return panel(`${ACHIEVEMENT_CATEGORY_LABELS[category]} <small>${doneCount} / ${list.length}</small>`, `
      <div class="ach-grid">${sorted.map(renderCard).join('')}</div>
    `, { flush: true, aside })
  }).join('')

  return `
    ${pageHead({
      kicker: '经营 · 1.0 成就体系',
      title: '俱乐部成就',
      sub: `常规成就奖励商店点券、主属性上限（独立叠加）与 1.0 福利；另有 ${summary.hiddenTotal} 项高难隐藏挑战（未解锁前显示为「？？？」），达成后自动揭晓，后续将开放球迷、彩虹技能书等专属奖励。`,
      actions: `${claimAllBtn}<button class="btn ghost" data-nav="shop">前往技能书商店 ${icon('right', 13)}</button>`,
    })}
    ${backfillBanner}
    <div class="kpi-row club-kpis">
      ${tile('已解锁成就', `${summary.unlocked} / ${summary.total}`, `常规 ${summary.unlocked - summary.hiddenUnlocked}/${summary.standardTotal} · 隐藏 ${summary.hiddenUnlocked}/${summary.hiddenTotal}`)}
      ${tile('待领取奖励', String(summary.claimable), pendingParts.length ? pendingParts.join(' · ') : '暂无待领取')}
      ${tile('成就上限加成', `+${summary.earnedCeilingBonus}`, `满额 +${summary.maxCeilingBonus} · 独立叠加`)}
      ${tile('已领成就点券', `${summary.earnedShopPoints} / ${summary.maxShopPoints}`, '跨赛季永久保留')}
      ${tile('当前商店点券', String(points), `可兑换 ${Math.floor(points / SHOP_BOOK_PRICE)} 本技能书`)}
    </div>
    <div class="tabs" role="tablist">
      ${filterTabs.map((tab) => `<button class="tab ${filter === tab.id ? 'active' : ''}" role="tab" aria-selected="${filter === tab.id}" data-ach-filter="${tab.id}">${tab.label}</button>`).join('')}
    </div>
    ${sections || panel('俱乐部成就', '<p class="muted pad">该筛选下暂无已解锁成就，快去绿茵场上创造奇迹吧！</p>', { flush: true })}
  `
}
