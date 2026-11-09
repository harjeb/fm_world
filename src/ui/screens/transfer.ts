import type { Player, TransferOffer } from '../../game/types.ts'
import { AI_SEASON_BUY_LIMIT, HIGH_OFFER_RATIO, SQUAD_STATUS_LABELS, UNHAPPY_GAME_DAYS, type SquadStatus } from '../../game/transfer-rules.ts'
import { isHighOffer } from '../../game/transfers.ts'
import { MIN_SQUAD } from '../../game/squad.ts'
import { economyOf } from '../../game/economy.ts'
import { AUCTION_DURATION_MS, AUCTION_EXTEND_MS, auctionRaiseFee, committedFunds, leadingBid, minimumBid } from '../../game/auction.ts'
import { traitEffectText } from '../../game/data/skill-effects.ts'
import { traitNameOf } from '../../game/data/star-traits.ts'
import { SQUAD_LIMIT, aiTransferOffers, bestMarketValue, freeAgentAsking, saleChance, suggestedPrice, transferWindowOpen } from '../../game/market.ts'
import { isOnMarketToday } from '../../game/market-window.ts'
import { caHeat, clubName, countryLabel, emptyState, icon, pageHead, panel, posBadge, primaryPosition, tag, traitLabel } from '../components.ts'
import { countdownText, esc, playerCA } from '../format.ts'
import { isOnlineMode, marketState, onlineState, publicWorld, serverNow } from '../../online.ts'
import { game, ui, type TransferTab } from '../state.ts'

const TABS: { id: TransferTab; label: string }[] = [
  { id: 'market', label: '挂牌出售' },
  { id: 'ai', label: '从 AI 球队买人' },
  { id: 'free', label: '自由球员' },
  { id: 'offers', label: '收到的报价' },
]

const STATUS_TONE: Record<SquadStatus, string> = { key: 'good', rotation: 'info', fringe: '' }
const pctText = (share: number) => `${Math.round(share * 100)}%`

function nameCell(player: Player): string {
  return `<td class="name-cell"><button class="name-btn" data-action="detail" data-player="${esc(player.id)}">${esc(player.name)}</button><small>${esc(player.enName)}</small></td>`
}

function marketTab(): string {
  const economy = economyOf(game)
  const market = game.market
  const open = transferWindowOpen(game)
  const listings = market?.listings.length
    ? `<div class="table-scroll"><table class="dt"><thead><tr><th>球员</th><th class="num">要价</th><th class="num">估值</th><th class="num">成交概率</th><th></th></tr></thead><tbody>${market.listings.map(({ player, price }) => `<tr data-key="${esc(player.id)}">
        ${nameCell(player)}
        <td class="num">${price.toLocaleString()}</td>
        <td class="num dim">${bestMarketValue(game, player).toLocaleString()}</td>
        <td class="num">${Math.round(saleChance(price, bestMarketValue(game, player)) * 100)}%</td>
        <td class="num"><button class="btn small" data-action="club-cancel" data-player="${esc(player.id)}">取消挂牌</button></td>
      </tr>`).join('')}</tbody></table></div>`
    : '<p class="muted pad">暂无挂牌。</p>'
  const sell = `<div class="table-scroll"><table class="dt"><thead><tr><th>位置</th><th>球员</th><th class="num">CA</th><th class="num">估值</th><th class="num">建议价</th><th>要价</th></tr></thead><tbody>${game.roster.map((player) => `<tr data-key="${esc(player.id)}">
      <td>${posBadge(primaryPosition(player))}</td>
      ${nameCell(player)}
      <td class="num strong">${caHeat(playerCA(player))}</td>
      <td class="num dim">${bestMarketValue(game, player).toLocaleString()}</td>
      <td class="num">${suggestedPrice(game, player).toLocaleString()}</td>
      <td class="price-cell"><input type="number" class="compact" min="1" max="9007199254740991" step="1" value="${suggestedPrice(game, player)}" aria-label="${esc(player.name)} 的要价" data-club-price="${esc(player.id)}"><button class="btn small" data-action="club-list" data-player="${esc(player.id)}">挂牌</button></td>
    </tr>`).join('')}</tbody></table></div>`
  return `<div class="banner ${open ? 'good' : 'muted'}">${icon('swap', 16)}<b>${game.world ? (open ? '转会窗口开放' : '转会窗口关闭') : '市场开放'}</b><span>仅与本地 NPC 交易，并非玩家之间的市场。${game.world ? '转会窗口：第 1-10 轮、20-30 轮。' : ''}</span></div>
    <div class="grid two">
      <div class="dash-col">
        ${panel(`已挂牌 <small>${market?.listings.length ?? 0}</small>`, listings, { flush: true })}
        ${panel('出售球员', sell, { flush: true })}
      </div>
      <div class="dash-col">
        ${panel('怎么买 AI 球队的人', `<ul class="rule-list">
          <li>${icon('swap', 13)}到「从 AI 球队买人」里找人谈判：先过俱乐部这关，再过球员本人这关。</li>
          <li>${icon('star', 13)}年轻主力（24 岁及以下）是非卖品，除非最近很少上场；当打之年的主力至少多给 50%，29 岁以上的主力至少多给 30%。</li>
          <li>${icon('clock', 13)}轮换球员按最近 20 场的出场时间要价（多给 10%–40%），冷板凳多给 5% 就能谈。达到要价后溢价越多越容易成交。</li>
          <li>${icon('info', 13)}AI 俱乐部每赛季最多买进 ${AI_SEASON_BUY_LIMIT} 人（竞拍、挖人、给你报价都算）；你从它们手里买人不占这个名额。</li>
        </ul>`)}
      </div>
    </div>`
}

function auctionTab(): string {
  const economy = economyOf(game)
  const me = onlineState.user?.id ?? ''
  const committed = committedFunds(marketState.auctions, me)
  const available = economy.balance - committed
  const canTrade = transferWindowOpen(game) && !game.activeMatch
  const running = marketState.auctions.filter((auction) => marketState.pool.some((player) => player.id === auction.playerId))
  const auctionRows = running.map((auction) => {
    const player = marketState.pool.find((item) => item.id === auction.playerId)!
    const lead = leadingBid(auction)
    const mine = lead.accountId === me
    const next = Math.max(minimumBid(player, auction), bestMarketValue(game, player))
    const left = auction.endsAt - serverNow()
    return `<tr data-key="${esc(player.id)}">
      <td>${posBadge(primaryPosition(player))}</td>
      <td class="name-cell"><button class="name-btn" data-action="detail" data-player="${esc(player.id)}">${esc(player.name)}</button><small>${esc(player.enName)}</small></td>
      <td class="num">${player.age ?? 24}</td>
      <td class="num strong">${caHeat(playerCA(player))}</td>
      <td>${traitLabel(player.traitId, true)}</td>
      <td class="num strong">${lead.amount.toLocaleString()}</td>
      <td>${mine ? tag('你领先', 'good') : esc(lead.club)}</td>
      <td class="num"><span class="countdown ${left < AUCTION_EXTEND_MS ? 'urgent' : ''}" data-countdown-end="${auction.endsAt}">${countdownText(left)}</span></td>
      <td class="num"><span class="bid-cell">${mine ? '<span class="muted small">等待结束</span>' : `<input class="bid-input" type="number" min="${next}" step="1" value="${next}" data-bid-amount aria-label="出价金额"><button class="btn small primary" data-action="auction-bid" data-player="${esc(player.id)}" ${canTrade ? '' : 'disabled'}>加价</button><small class="muted">手续费 ${auctionRaiseFee(next).toLocaleString()}</small>`}</span></td>
    </tr>`
  }).join('')
  const query = ui.clubSearch.trim().toLowerCase()
  const onAuction = new Set(running.map((auction) => auction.playerId))
  const agents = marketState.pool.filter((player) => !onAuction.has(player.id) && `${player.name} ${player.enName} ${player.country} ${traitNameOf(player.traitId)} ${traitEffectText(player.traitId)}`.toLowerCase().includes(query))
  const pageSize = 20
  const pages = Math.max(1, Math.ceil(agents.length / pageSize))
  ui.clubPage = Math.min(ui.clubPage, pages - 1)
  const rows = agents.slice(ui.clubPage * pageSize, ui.clubPage * pageSize + pageSize).map((player) => {
    const opening = Math.max(minimumBid(player), bestMarketValue(game, player))
    return `<tr class="clickable" data-action="detail" data-player="${esc(player.id)}" data-key="${esc(player.id)}">
      <td>${posBadge(primaryPosition(player))}</td>
      ${nameCell(player)}
      <td class="dim">${esc(countryLabel(player))}</td>
      <td class="num">${player.age ?? 24}</td>
      <td class="num strong">${caHeat(playerCA(player))}</td>
      <td>${traitLabel(player.traitId, true)}</td>
      <td class="num">${opening.toLocaleString()}</td>
      <td class="num"><button class="btn small" data-action="auction-bid" data-player="${esc(player.id)}" data-amount="${opening}" ${canTrade && available >= opening && game.roster.length < 25 ? '' : 'disabled'}>出价</button></td>
    </tr>`
  }).join('')
  const logRows = marketState.log.slice(0, 8).map((item) => `<li>${item.club ? `<b>${esc(item.club)}</b> 以 ${item.amount.toLocaleString()} 签下 ${esc(item.playerName)}` : `${esc(item.playerName)} 流拍，回到市场`}</li>`).join('')
  return `
    <p class="hint">${icon('clock', 13)} 第一口出价开始 ${AUCTION_DURATION_MS / 3_600_000} 小时倒计时，全服可见；最后 ${AUCTION_EXTEND_MS / 60_000} 分钟内有人跟价，倒计时重新回到 ${AUCTION_EXTEND_MS / 60_000} 分钟。跟价每次至少加 5%，并交出价 2%（至少 1,000）的手续费，手续费不退还。</p>
    ${running.length ? panel(`竞拍中 <small>${running.length}</small>`, `<div class="table-scroll"><table class="dt auction-table"><thead><tr><th>位置</th><th>球员</th><th class="num">龄</th><th class="num">CA</th><th>特性</th><th class="num">当前价</th><th>领先</th><th class="num">倒计时</th><th class="num">出价</th></tr></thead><tbody>${auctionRows}</tbody></table></div>`, { flush: true }) : ''}
    ${panel(`自由球员 <small>${agents.length}</small>`, `
      <div class="toolbar in-panel">
        <div class="input-icon">${icon('search', 14)}<input id="club-search" placeholder="搜索姓名 / 国家 / 英文名 / 特性" value="${esc(ui.clubSearch)}"></div>
        <button class="btn small" data-action="club-search">搜索</button>
        <span class="muted small">阵容 ${game.roster.length} / ${SQUAD_LIMIT} · 余额 ${economy.balance.toLocaleString()}</span>
      </div>
      ${rows ? `<div class="table-scroll"><table class="dt"><thead><tr><th>位置</th><th>球员</th><th>国籍</th><th class="num">龄</th><th class="num">CA</th><th>特性</th><th class="num">起拍价</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="muted pad">${marketState.pool.length ? '没有符合条件的球员。' : '正在加载自由市场…'}</p>`}
      <div class="pager"><button class="btn small" data-action="club-prev" ${ui.clubPage === 0 ? 'disabled' : ''}>${icon('left', 13)}上一页</button><span class="muted small">${ui.clubPage + 1} / ${pages}</span><button class="btn small" data-action="club-next" data-pages="${pages}" ${ui.clubPage >= pages - 1 ? 'disabled' : ''}>下一页${icon('right', 13)}</button></div>
    `, { flush: true })}
    ${logRows ? panel('最近成交', `<ul class="auction-log">${logRows}</ul>`) : ''}
  `
}

function freeTab(): string {
  if (isOnlineMode()) return auctionTab()
  const economy = economyOf(game)
  const query = ui.clubSearch.trim().toLowerCase()
  // 特性也能搜：想找“单刀”“点球”的球星时不用一个个点开看。
  // 球星只在挂牌日出现在市场；不在窗口里的直接不列出来（这是隐藏日程）。
  const agents = game.freeStars
    .filter((player) => isOnMarketToday(game, player))
    .filter((player) => `${player.name} ${player.enName} ${player.country} ${traitNameOf(player.traitId)} ${traitEffectText(player.traitId)}`.toLowerCase().includes(query))
  const pageSize = 20
  const pages = Math.max(1, Math.ceil(agents.length / pageSize))
  ui.clubPage = Math.min(ui.clubPage, pages - 1)
  const rows = agents.slice(ui.clubPage * pageSize, ui.clubPage * pageSize + pageSize).map((player) => {
    const price = freeAgentAsking(game, player)
    const available = isOnMarketToday(game, player)
    return `<tr class="clickable ${available ? '' : 'dim-row'}" data-action="detail" data-player="${esc(player.id)}" data-key="${esc(player.id)}">
      <td>${posBadge(primaryPosition(player))}</td>
      ${nameCell(player)}
      <td class="dim">${esc(countryLabel(player))}</td>
      <td class="num">${player.age ?? 24}</td>
      <td class="num strong">${caHeat(playerCA(player))}</td>
      <td>${traitLabel(player.traitId, true)}</td>
      <td class="num">${price.toLocaleString()}</td>
      <td class="num">${available
        ? `<button class="btn small" data-action="club-buy" data-player="${esc(player.id)}" ${game.activeMatch || price <= 0 || !transferWindowOpen(game) ? 'disabled' : ''}>谈判</button>`
        : '<span class="muted small">未挂牌</span>'}</td>
    </tr>`
  }).join('')
  return panel(`自由球员 <small>${agents.length}</small>`, `
    <div class="toolbar in-panel">
      <div class="input-icon">${icon('search', 14)}<input id="club-search" placeholder="搜索姓名 / 国家 / 英文名 / 特性" value="${esc(ui.clubSearch)}"></div>
      <button class="btn small" data-action="club-search">搜索</button>
      <span class="muted small">阵容 ${game.roster.length} / ${SQUAD_LIMIT} · 余额 ${economy.balance.toLocaleString()}</span>
    </div>
    <p class="hint">签人要谈判：他会问你的赛季目标和给他的位置，报价越高成功率越高。不是所有球员随时都能碰到。</p>
    ${game.roster.length > SQUAD_LIMIT ? `<p class="warn-text">阵容 ${game.roster.length} / ${SQUAD_LIMIT}，已超编：必须裁掉 ${game.roster.length - SQUAD_LIMIT} 人才能进入比赛。</p>` : ''}
    ${rows ? `<div class="table-scroll"><table class="dt"><thead><tr><th>位置</th><th>球员</th><th>国籍</th><th class="num">龄</th><th class="num">CA</th><th>特性</th><th class="num">底价</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState('没有匹配的自由球员。')}
    <div class="pager"><button class="btn small" data-action="club-prev" ${ui.clubPage === 0 ? 'disabled' : ''}>${icon('left', 13)}上一页</button><span class="muted small">${ui.clubPage + 1} / ${pages}</span><button class="btn small" data-action="club-next" ${ui.clubPage >= pages - 1 ? 'disabled' : ''}>下一页${icon('right', 13)}</button></div>
  `, { flush: true })
}

/** 从 AI 球队买人：本联赛 AI 球队的全部球员，带俱乐部态度和要价，可按球队 / 位置筛选。 */
function aiTab(): string {
  const open = transferWindowOpen(game)
  const managed = (clubId: string) => isOnlineMode() && !!publicWorld?.clubs.find((club) => club.id === clubId)?.managed
  const all = aiTransferOffers(game, managed)
  const teams = [...new Map(all.map((item) => [item.team.id, item.team.name])).entries()]
  const rows = all
    .filter((item) => (ui.aiBuyTeam === 'ALL' || item.team.id === ui.aiBuyTeam) && (ui.aiBuyPos === 'ALL' || primaryPosition(item.player) === ui.aiBuyPos))
    .sort((a, b) => playerCA(b.player) - playerCA(a.player))
  const pageSize = 20
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  ui.aiBuyPage = Math.min(ui.aiBuyPage, pages - 1)
  const body = rows.slice(ui.aiBuyPage * pageSize, ui.aiBuyPage * pageSize + pageSize).map(({ team, player, asking, terms }) => `<tr data-key="${esc(player.id)}">
      <td>${clubName(team.id, 14)}</td>
      <td>${posBadge(primaryPosition(player))}</td>
      ${nameCell(player)}
      <td class="num">${player.age ?? 24}</td>
      <td class="num strong">${caHeat(playerCA(player))}</td>
      <td>${tag(SQUAD_STATUS_LABELS[terms.status], STATUS_TONE[terms.status])}</td>
      <td class="num" title="${terms.recorded >= 5 ? `最近 ${terms.recorded} 场的出场时间` : '记录不足 5 场，按阵容角色估算'}">${pctText(terms.minutesShare)}${terms.recorded >= 5 ? '' : '<small class="muted">*</small>'}</td>
      <td class="num dim">${terms.value.toLocaleString()}</td>
      <td class="num">${asking === null ? tag('非卖品', 'bad') : asking.toLocaleString()}</td>
      <td class="num"><button class="btn small" data-action="club-buy-ai" data-team="${esc(team.id)}" data-player="${esc(player.id)}" ${!open || asking === null || game.activeMatch ? 'disabled' : ''}>谈判</button></td>
    </tr>`).join('')
  const teamOptions = ['<option value="ALL">全部球队</option>', ...teams.map(([id, name]) => `<option value="${esc(id)}" ${ui.aiBuyTeam === id ? 'selected' : ''}>${esc(name)}</option>`)].join('')
  const posOptions = [['ALL', '全部位置'], ['GK', '门将'], ['CB', '中卫'], ['W', '边路'], ['CM', '中场'], ['ST', '前锋']].map(([id, label]) => `<option value="${id}" ${ui.aiBuyPos === id ? 'selected' : ''}>${label}</option>`).join('')
  return `<div class="banner ${open ? 'good' : 'muted'}">${icon('swap', 16)}<b>${open ? '转会窗口开放' : '转会窗口关闭'}</b><span>转会窗口：第 1-10 轮、20-30 轮。俱乐部按主力 / 年龄 / 最近 20 场出场 / 你给的溢价决定放不放人，球员本人还要看你的承诺。</span></div>
    ${panel(`本联赛 AI 球队 <small>${rows.length} 人</small>`, `
      <div class="toolbar in-panel">
        <select id="ai-buy-team" class="compact">${teamOptions}</select>
        <select id="ai-buy-pos" class="compact">${posOptions}</select>
        <span class="muted small">近 20 场 = 出场时间占比（* 为按阵容角色估算） · 余额 ${economyOf(game).balance.toLocaleString()}</span>
      </div>
      ${body ? `<div class="table-scroll"><table class="dt"><thead><tr><th>球队</th><th>位置</th><th>球员</th><th class="num">龄</th><th class="num">CA</th><th>地位</th><th class="num">近 20 场</th><th class="num">身价</th><th class="num">俱乐部要价</th><th></th></tr></thead><tbody>${body}</tbody></table></div>` : emptyState('没有符合条件的球员。')}
      <div class="pager"><button class="btn small" data-action="ai-buy-prev" ${ui.aiBuyPage === 0 ? 'disabled' : ''}>${icon('left', 13)}上一页</button><span class="muted small">${ui.aiBuyPage + 1} / ${pages}</span><button class="btn small" data-action="ai-buy-next" data-pages="${pages}" ${ui.aiBuyPage >= pages - 1 ? 'disabled' : ''}>下一页${icon('right', 13)}</button></div>
    `, { flush: true })}`
}

const OFFER_STATUS: Record<TransferOffer['status'], string> = { pending: '待回复', accepted: '已接受', rejected: '已拒绝', expired: '已过期（视为拒绝）', withdrawn: '已撤回' }

/** 收到的报价：4 个游戏日（现实 24 小时）内回复，过期算拒绝；拒绝高价报价球员会不满。 */
function offersTab(): string {
  const offers = game.transferOffers ?? []
  const pending = offers.filter((offer) => offer.status === 'pending')
  const done = offers.filter((offer) => offer.status !== 'pending').slice(0, 12)
  const rows = pending.map((offer) => {
    const player = game.roster.find((item) => item.id === offer.playerId)
    const premium = offer.value > 0 ? offer.amount / offer.value - 1 : 0
    const high = isHighOffer(offer)
    return `<tr data-key="${esc(offer.id)}">
      <td>${clubName(offer.clubId, 14)}</td>
      <td>${player ? posBadge(primaryPosition(player)) : ''}</td>
      <td class="name-cell"><button class="name-btn" data-action="detail" data-player="${esc(offer.playerId)}">${esc(offer.playerName)}</button>${player ? `<small>${player.age ?? 24} 岁 · CA ${playerCA(player).toFixed(0)}</small>` : ''}</td>
      <td class="num strong">${offer.amount.toLocaleString()}</td>
      <td class="num dim">${offer.value.toLocaleString()}</td>
      <td class="num ${premium >= 0 ? 'up' : 'down'}">${premium >= 0 ? '+' : ''}${Math.round(premium * 100)}%</td>
      <td>${high ? tag('高价：拒绝他会不满', 'gold') : '<span class="muted small">拒绝没有影响</span>'}</td>
      <td class="num"><span class="countdown" data-countdown-end="${offer.expiresAt}">${countdownText(offer.expiresAt - serverNow())}</span></td>
      <td class="num actions-cell"><button class="btn small primary" data-action="offer-accept" data-offer="${esc(offer.id)}" ${game.activeMatch || !transferWindowOpen(game) ? 'disabled' : ''}>接受</button><button class="btn small ghost" data-action="offer-reject" data-offer="${esc(offer.id)}">拒绝</button></td>
    </tr>`
  }).join('')
  const history = done.map((offer) => `<li><b>${esc(offer.clubName)}</b> 出价 ${offer.amount.toLocaleString()} 求购 <b>${esc(offer.playerName)}</b> · ${OFFER_STATUS[offer.status]}${offer.note ? ` · <span class="muted">${esc(offer.note)}</span>` : ''}</li>`).join('')
  return `${panel(`待回复的报价 <small>${pending.length}</small>`, rows
      ? `<div class="table-scroll"><table class="dt"><thead><tr><th>求购球队</th><th>位置</th><th>球员</th><th class="num">报价</th><th class="num">身价</th><th class="num">溢价</th><th></th><th class="num">剩余</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : emptyState('暂时没有报价。转会窗口里，本联赛的 AI 俱乐部会按需给你的球员报价。'), { flush: true })}
    ${panel('规则', `<ul class="rule-list">
      <li>${icon('clock', 13)}报价 4 个游戏日（现实 24 小时）内有效，不回复算拒绝；转会窗口关闭时对方撤回。</li>
      <li>${icon('alert', 13)}报价不低于身价 ${HIGH_OFFER_RATIO} 倍算高价。拒绝（或放过期）高价报价，这名球员会不满 ${UNHAPPY_GAME_DAYS} 个游戏日：精力恢复只剩一成，很难开新的培养。</li>
      <li>${icon('swap', 13)}接受后钱立刻到账，球员去对方队；阵容至少要留 ${MIN_SQUAD} 人，正在培养的球员要等培养结束。</li>
    </ul>`)}
    ${history ? panel('最近处理的报价', `<ul class="auction-log">${history}</ul>`) : ''}`
}

export function renderTransfer(): string {
  const tab: TransferTab = ui.transferTab
  const body = tab === 'free' ? freeTab() : tab === 'ai' ? aiTab() : tab === 'offers' ? offersTab() : marketTab()
  const pendingCount = (game.transferOffers ?? []).filter((offer) => offer.status === 'pending').length
  return `
    ${pageHead({ kicker: '经营', title: '转会市场' })}
    <div class="tabs" role="tablist">
      ${TABS.map((item) => `<button class="tab ${tab === item.id ? 'active' : ''}" role="tab" aria-selected="${tab === item.id}" data-transfer-tab="${item.id}">${item.id === 'free' && isOnlineMode() ? '全服竞拍' : item.label}${item.id === 'offers' && pendingCount ? ` <span class="badge">${pendingCount}</span>` : ''}</button>`).join('')}
    </div>
    ${body}
  `
}
