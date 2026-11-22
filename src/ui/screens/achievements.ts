import {
  ACHIEVEMENT_CATEGORY_LABELS,
  ACHIEVEMENT_CATEGORY_ORDER,
  achievementSummary,
  type AchievementItemView,
} from '../../game/achievements.ts'
import { SHOP_BOOK_PRICE, shopPointsOf } from '../../game/shop.ts'
import { icon, pageHead, panel, tag, tile } from '../components.ts'
import { esc } from '../format.ts'
import { game } from '../state.ts'

function rewardPills(item: AchievementItemView): string {
  const parts: string[] = []
  if (item.reward.money) {
    parts.push(tag(`金币 +${item.reward.money.toLocaleString()}`, 'gold'))
  }
  if (item.reward.shopPoints) {
    parts.push(tag(`商店点券 +${item.reward.shopPoints}`, 'info'))
  }
  return parts.join(' ')
}

function renderCard(item: AchievementItemView): string {
  const pct = Math.max(0, Math.min(100, Math.round((item.current / Math.max(1, item.target)) * 100)))
  const isWelfare = item.category === 'welfare'
  const statusControl = item.claimable
    ? `<button class="btn small primary" data-action="claim-achievement" data-achievement="${esc(item.id)}">领取奖励</button>`
    : item.claimed
      ? tag(item.backfilled ? '已自动补发' : '已领取', 'good')
      : `<span class="muted small">进行中</span>`
  const cls = [
    'ach-card',
    isWelfare ? 'is-welfare' : '',
    item.claimable ? 'is-claimable' : '',
    item.claimed ? 'is-claimed' : '',
  ].filter(Boolean).join(' ')
  return `<article class="${cls}" data-achievement-card="${esc(item.id)}">
    <div class="ach-card-head">
      <div class="ach-card-title">
        ${isWelfare ? tag('1.0 福利', 'gold') : ''}
        <b>${esc(item.title)}</b>
      </div>
      <div class="ach-card-action">${statusControl}</div>
    </div>
    <p class="ach-card-desc muted small">${esc(item.desc)}</p>
    <div class="ach-card-progress">
      <div class="ach-bar"><i style="width:${pct}%"></i></div>
      <span class="num-text small ${item.unlocked ? 'up' : 'muted'}">${item.current.toLocaleString()} / ${item.target.toLocaleString()} ${esc(item.unit)}</span>
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
  const pendingParts: string[] = []
  if (summary.pendingMoney > 0) pendingParts.push(`+${summary.pendingMoney.toLocaleString()} 金币`)
  if (summary.pendingShopPoints > 0) pendingParts.push(`+${summary.pendingShopPoints} 商店点券`)
  const claimAllBtn = summary.claimable > 0
    ? `<button class="btn primary" data-action="claim-achievement-all">${icon('star', 14)}一键领取全部（${summary.claimable}）</button>`
    : ''
  const backfillBanner = summary.welfareBackfillMoney > 0
    ? `<div class="banner gold">${icon('star', 16)}<b>1.0 正式版巅峰首胜福利已自动补发</b><span>检测到你此前已通关「巅峰之路」第 1 关，福利奖金 <b>${summary.welfareBackfillMoney.toLocaleString()} 金币</b> 已自动发放至俱乐部余额！</span></div>`
    : ''

  const sections = ACHIEVEMENT_CATEGORY_ORDER.map((category) => {
    const list = summary.items.filter((item) => item.category === category)
    if (!list.length) return ''
    const doneCount = list.filter((item) => item.unlocked).length
    const claimableCount = list.filter((item) => item.claimable).length
    const aside = claimableCount > 0
      ? tag(`可领取 ${claimableCount}`, 'gold')
      : `<span class="muted small">${doneCount} / ${list.length}</span>`
    return panel(`${ACHIEVEMENT_CATEGORY_LABELS[category]} <small>${doneCount} / ${list.length}</small>`, `
      <div class="ach-grid">${list.map(renderCard).join('')}</div>
    `, { flush: true, aside })
  }).join('')

  return `
    ${pageHead({
      kicker: '经营 · 1.0 成就体系',
      title: '俱乐部成就',
      sub: '达成俱乐部各项里程碑即可领取商店点券与 1.0 专属福利；点券可前往技能书商店兑换金色技能书。',
      actions: `${claimAllBtn}<button class="btn ghost" data-nav="shop">前往技能书商店 ${icon('right', 13)}</button>`,
    })}
    ${backfillBanner}
    <div class="kpi-row">
      ${tile('已达成成就', `${summary.unlocked} / ${summary.total}`, `已领取 ${summary.claimed} 项`)}
      ${tile('待领取奖励', String(summary.claimable), pendingParts.length ? pendingParts.join(' · ') : '暂无待领取')}
      ${tile('已领成就点券', `${summary.earnedShopPoints} / ${summary.maxShopPoints}`, '跨赛季永久保留')}
      ${tile('当前商店点券', String(points), `可兑换 ${Math.floor(points / SHOP_BOOK_PRICE)} 本技能书`)}
    </div>
    ${sections}
  `
}
