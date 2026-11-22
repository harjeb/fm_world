import { SHOP_GROUP_LABELS } from '../../game/data/shop-skills.ts'
import { SKILLS } from '../../game/data/skills.ts'
import { skillEffectText } from '../../game/data/skill-effects.ts'
import { hasBookAtOrAbove } from '../../game/legend-books.ts'
import { bookRequirementText } from '../../game/legend-learning.ts'
import {
  MAX_PEAK_SHOP_POINTS,
  PEAK_SHOP_POINTS_BANDS,
  SEASON_SHOP_POINTS_TABLE,
  SHOP_BOOK_PRICE,
  peakStageShopPoints,
  seasonShopPoints,
  shopCatalog,
  shopPointsOf,
  shopSeasonIndex,
  type ShopOffer,
} from '../../game/shop.ts'
import type { TierId } from '../../game/types.ts'
import { worldTierLabel } from '../../game/world.ts'
import { bookTitle, pageHead, panel, tag, tile } from '../components.ts'
import { esc } from '../format.ts'
import { icon } from '../icons.ts'
import { game } from '../state.ts'

function currentRank(): number | null {
  const finish = game.season.playerFinish
  if (typeof finish === 'number' && finish > 0) return finish
  const idx = game.season.table.findIndex((row) => row.teamId === 'player')
  return idx >= 0 ? idx + 1 : null
}

function renderOfferCard(offer: ShopOffer, points: number): string {
  const def = SKILLS[offer.id]
  const owned = hasBookAtOrAbove(game, offer.id, 'gold')
  const affordable = points >= offer.price
  const button = owned
    ? `<button class="btn small" disabled>已拥有</button>`
    : `<button class="btn small ${affordable ? 'primary' : ''}" data-action="buy-shop-book" data-skill="${esc(offer.id)}" ${affordable ? '' : 'disabled'}>${affordable ? `兑换（${offer.price} 点）` : `需 ${offer.price} 点`}</button>`
  const badgeTone = offer.category === 'auxiliary' ? 'good' : offer.scope === 'gk' ? 'info' : ''
  return `<article class="shop-card ${owned ? 'owned' : ''}" data-shop-book="${esc(offer.id)}">
    <div class="shop-card-head">
      <div class="shop-card-title">
        ${bookTitle(def.name, 'gold')}
        ${tag(SHOP_GROUP_LABELS[offer.group], badgeTone)}
        ${offer.category === 'auxiliary' ? tag('辅助槽', '') : ''}
      </div>
      <span class="shop-price">${owned ? tag('已入库', 'good') : `<b>${offer.price}</b> 点`}</span>
    </div>
    <p class="shop-effect">${esc(skillEffectText(offer.id, 'gold'))}</p>
    <p class="muted small shop-meta">条件：${esc(def.condition)} · 门槛：${esc(bookRequirementText(offer))}</p>
    <div class="shop-card-foot">
      <span class="muted small">${esc(def.desc)}</span>
      ${button}
    </div>
  </article>`
}

function renderPointsGuide(tier: TierId, rank: number | null): string {
  const ranks = Array.from({ length: 20 }, (_, i) => i + 1)
  const rankRows = ranks.map((r) => {
    const active = rank === r
    return `<tr class="${active ? 'me' : ''}">
      <td class="num">第 ${r} 名</td>
      <td class="num ${tier === 'division2' && active ? 'strong' : ''}">${SEASON_SHOP_POINTS_TABLE.division2[r - 1]}</td>
      <td class="num ${tier === 'division1' && active ? 'strong' : ''}">${SEASON_SHOP_POINTS_TABLE.division1[r - 1]}</td>
      <td class="num ${tier === 'champions' && active ? 'strong' : ''}">${SEASON_SHOP_POINTS_TABLE.champions[r - 1]}</td>
    </tr>`
  }).join('')
  const peakRows = PEAK_SHOP_POINTS_BANDS.map((band) => {
    const count = band.to - band.from + 1
    return `<tr><td>第 ${band.from}–${band.to} 关</td><td class="num">+${band.points} 点 / 关</td><td class="num">${count * band.points} 点</td></tr>`
  }).join('')
  const projected = rank ? seasonShopPoints(tier, rank) : null
  const summary = projected !== null
    ? `当前位于 <b>${esc(worldTierLabel(tier))}</b> 第 <b>${rank}</b> 名，若以此排名完赛预计获得 <b>${projected}</b> 点（约 ${Math.floor(projected / SHOP_BOOK_PRICE)} 本）。`
    : `当前位于 <b>${esc(worldTierLabel(tier))}</b>，赛季常规赛结束时按最终排名发放商店点数。`
  return panel('点数获取说明', `
    <p class="hint pad">${summary} 商店点数跨赛季永久保留，不会清零；巅峰之路每关首通额外获得一次性点数，旧档已通关关卡会自动补发。</p>
    <div class="grid two pad-grid">
      <div>
        <h4 class="sub-head">巅峰之路每关首通（额外 · 共 ${MAX_PEAK_SHOP_POINTS} 点）</h4>
        <div class="table-scroll"><table class="dt"><thead><tr><th>关卡段</th><th class="num">每关点数</th><th class="num">小计</th></tr></thead><tbody>${peakRows}</tbody></table></div>
      </div>
      <div>
        <h4 class="sub-head">赛季排名结算（级别越高越多）</h4>
        <details>
          <summary>查看 1–20 名完整点数表（当前：${esc(worldTierLabel(tier))}）</summary>
          <div class="table-scroll"><table class="dt"><thead><tr><th class="num">排名</th><th class="num">二级联赛</th><th class="num">一级联赛</th><th class="num">冠军联赛</th></tr></thead><tbody>${rankRows}</tbody></table></div>
        </details>
      </div>
    </div>
  `, { flush: true })
}

export function renderShop(): string {
  const points = shopPointsOf(game)
  const season = shopSeasonIndex(game)
  const catalog = shopCatalog(game.seed, season)
  const outfield = catalog.filter((offer) => offer.category === 'main' && offer.scope === 'field')
  const gk = catalog.filter((offer) => offer.category === 'main' && offer.scope === 'gk')
  const aux = catalog.filter((offer) => offer.category === 'auxiliary')
  const ownedTotal = catalog.filter((offer) => hasBookAtOrAbove(game, offer.id, 'gold')).length
  const outfieldOwned = outfield.filter((offer) => hasBookAtOrAbove(game, offer.id, 'gold')).length
  const gkOwned = gk.filter((offer) => hasBookAtOrAbove(game, offer.id, 'gold')).length
  const auxOwned = aux.filter((offer) => hasBookAtOrAbove(game, offer.id, 'gold')).length
  const claimedStages = game.shop?.peakClaimedStages ?? []
  const claimedPeakPts = claimedStages.reduce((sum, stage) => sum + peakStageShopPoints(stage), 0)
  const tier: TierId = game.season.tier ?? 'division2'
  const rank = currentRank()
  const projected = rank ? seasonShopPoints(tier, rank) : null
  const backfillNote = game.shop?.lastPeakBackfill
    ? `<div class="banner info">${icon('star', 16)}<b>巅峰之路历史点数已补发</b><span>已按你的历史通关进度自动补发 ${game.shop.lastPeakBackfill} 商店点数。</span></div>`
    : ''

  return `
    ${pageHead({
      kicker: '经营 · 每赛季更新',
      title: '技能书商店',
      sub: '每赛季轮换上架 8 本外场、2 本守门员与 2 本辅助技能书（共 12 本）；购买后永久入库，不消耗。',
      actions: `<button class="btn ghost" data-nav="training">前往培养配置技能卡 ${icon('right', 13)}</button>`,
    })}
    ${backfillNote}
    <div class="kpi-row">
      ${tile('当前商店点数', String(points), `可兑换 ${Math.floor(points / SHOP_BOOK_PRICE)} 本`)}
      ${tile(`第 ${season} 赛季货架`, `${ownedTotal} / ${catalog.length}`, '下赛季开赛时刷新')}
      ${tile('本季预计结算', projected !== null ? `+${projected} 点` : '—', `${worldTierLabel(tier)}${rank ? ` · 暂列第 ${rank}` : ''}`)}
      ${tile('巅峰之路额外点数', `${claimedPeakPts} / ${MAX_PEAK_SHOP_POINTS}`, `已领 ${claimedStages.length} / 100 关`)}
    </div>
    ${panel(`外场技能书 <small>${outfieldOwned} / ${outfield.length}</small>`, `<div class="shop-grid">${outfield.map((offer) => renderOfferCard(offer, points)).join('')}</div>`, { flush: true, aside: tag('每本 100 点', 'gold') })}
    ${panel(`守门员技能书 <small>${gkOwned} / ${gk.length}</small>`, `<div class="shop-grid">${gk.map((offer) => renderOfferCard(offer, points)).join('')}</div>`, { flush: true, aside: tag('每本 100 点', 'info') })}
    ${panel(`辅助技能书 <small>${auxOwned} / ${aux.length}</small>`, `<div class="shop-grid">${aux.map((offer) => renderOfferCard(offer, points)).join('')}</div>`, { flush: true, aside: tag('占辅助槽 · 通用 · 100 点', 'good') })}
    ${renderPointsGuide(tier, rank)}
  `
}
