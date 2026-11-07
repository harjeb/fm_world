import type { Player } from '../../game/types.ts'
import { economyOf } from '../../game/economy.ts'
import { AUCTION_DURATION_MS, AUCTION_EXTEND_MS, AUCTION_MIN_RAISE, committedFunds, leadingBid, minimumBid } from '../../game/auction.ts'
import { traitEffectText } from '../../game/data/skill-effects.ts'
import { traitNameOf } from '../../game/data/star-traits.ts'
import { NPC_MAX_DEALS, NPC_ROUND_BUDGET, SQUAD_LIMIT, bestMarketValue, clubAsking, freeAgentAsking, saleChance, suggestedPrice, transferWindowOpen } from '../../game/market.ts'
import { isOnMarketToday, marketWindowLabel, nextMarketDayLabel } from '../../game/market-window.ts'
import { caHeat, clubName, countryLabel, emptyState, icon, pageHead, panel, posBadge, primaryPosition, tag, traitLabel } from '../components.ts'
import { countdownText, esc, playerCA } from '../format.ts'
import { isOnlineMode, marketState, onlineState, publicWorld, serverNow } from '../../online.ts'
import { game, ui, type TransferTab } from '../state.ts'

const TABS: { id: TransferTab; label: string }[] = [
  { id: 'market', label: '转会市场' },
  { id: 'free', label: '自由球员' },
]

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
  const buyRows = game.aiTeams.filter((team) => !isOnlineMode() || !publicWorld?.clubs.find((club) => club.id === team.id)?.managed).slice(0, 6).flatMap((team) => team.players.slice(0, 3).map((player) => {
    const price = clubAsking(game, player)
    return `<tr data-key="${esc(player.id)}">
      <td>${clubName(team.id, 16)}</td>
      <td>${posBadge(primaryPosition(player))}</td>
      ${nameCell(player)}
      <td class="num strong">${caHeat(playerCA(player))}</td>
      <td class="num">${price.toLocaleString()}</td>
      <td class="num"><button class="btn small" data-action="club-buy-ai" data-team="${esc(team.id)}" data-player="${esc(player.id)}" ${!open ? 'disabled' : ''}>谈判</button></td>
    </tr>`
  })).join('')
  return `<div class="banner ${open ? 'good' : 'muted'}">${icon('swap', 16)}<b>${game.world ? (open ? '转会窗口开放' : '转会窗口关闭') : '市场开放'}</b><span>仅与本地 NPC 交易，并非玩家之间的市场。${game.world ? '转会窗口：第 1-10 轮、20-30 轮。' : ''}</span></div>
    <div class="grid two">
      <div class="dash-col">
        ${panel(`已挂牌 <small>${market?.listings.length ?? 0}</small>`, listings, { flush: true })}
        ${panel('出售球员', sell, { flush: true })}
      </div>
      <div class="dash-col">
        ${panel('挂牌规则', `<ul class="rule-list">
          <li>${icon('coin', 13)}挂牌后球员离开阵容；结算时买家只按估值折价收购：不高于建议价（估值的 90%）必定成交，越接近估值越难卖，高于估值的要价会被直接拒绝。</li>
          <li>${icon('clock', 13)}每轮最多成交 ${NPC_MAX_DEALS} 笔、买家总预算 ${NPC_ROUND_BUDGET.toLocaleString()}。</li>
          <li>${icon('cards', 13)}估值按球员最好的一张卡计算，不看现在装备哪张。离队时他带走当前装备的属性，球员卡留在库存，回队后可以继续用。</li>
          <li>${icon('alert', 13)}挂牌须保留至少 10 人和合法阵容；培养中的球员不能挂牌；比赛中不能交易，赛季结束后不能新挂牌。</li>
          <li>${icon('swap', 13)}买人要谈判：答应他的赛季目标和位置、把报价抬到底价以上，成功率才会上来。球星只肯去冠军联赛、或者心里有别的下家时，加钱也未必够。</li>
          <li>${icon('academy', 13)}阵容上限 ${SQUAD_LIMIT} 人：签人可以超编，但开赛前必须裁掉多余的人，否则无法进入比赛。</li>
        </ul>`)}
        ${panel('从 AI 球队买人', `<div class="table-scroll"><table class="dt"><thead><tr><th>球队</th><th>位置</th><th>球员</th><th class="num">CA</th><th class="num">价格</th><th></th></tr></thead><tbody>${buyRows}</tbody></table></div>`, { flush: true })}
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
      <td class="num"><span class="bid-cell">${mine ? '<span class="muted small">等待结束</span>' : `<input class="bid-input" type="number" min="${next}" step="1" value="${next}" data-bid-amount aria-label="出价金额"><button class="btn small primary" data-action="auction-bid" data-player="${esc(player.id)}" ${canTrade ? '' : 'disabled'}>加价</button>`}</span></td>
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
    <p class="hint auction-rules">全服共用一个自由市场。第一个出价开始 ${AUCTION_DURATION_MS / 60_000} 分钟倒计时，其他人可以加价（每次至少 ${AUCTION_MIN_RAISE * 100}%）；最后 ${AUCTION_EXTEND_MS / 60_000} 分钟有人加价，倒计时回到 ${AUCTION_EXTEND_MS / 60_000} 分钟。时间到时最高价者得。其他俱乐部的电脑教练也会盯着抢手货，觉得值就会跟价。领先的出价会占用余额，你现在可用 <b>${available.toLocaleString()}</b>。</p>
    ${running.length ? panel(`竞拍中 <small>${running.length}</small>`, `<div class="table-scroll"><table class="dt auction-table"><thead><tr><th>位置</th><th>球员</th><th class="num">龄</th><th class="num">CA</th><th>特性</th><th class="num">当前价</th><th>领先</th><th class="num">倒计时</th><th class="num">出价</th></tr></thead><tbody>${auctionRows}</tbody></table></div>`, { flush: true }) : ''}
    ${panel(`自由球员 <small>${agents.length}</small>`, `
      <div class="toolbar in-panel">
        <div class="input-icon">${icon('search', 14)}<input id="club-search" placeholder="搜索姓名 / 国家 / 英文名 / 特性" value="${esc(ui.clubSearch)}"></div>
        <button class="btn small" data-action="club-search">搜索</button>
        <span class="muted small">阵容 ${game.roster.length} / 25 · 余额 ${economy.balance.toLocaleString()}</span>
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
    const window = marketWindowLabel(player)
    return `<tr class="clickable ${available ? '' : 'dim-row'}" data-action="detail" data-player="${esc(player.id)}" data-key="${esc(player.id)}">
      <td>${posBadge(primaryPosition(player))}</td>
      ${nameCell(player)}
      <td class="dim">${esc(countryLabel(player))}</td>
      <td class="num">${player.age ?? 24}</td>
      <td class="num strong">${caHeat(playerCA(player))}</td>
      <td>${traitLabel(player.traitId, true)}</td>
      <td class="num">${price.toLocaleString()}<br><small class="muted">${esc(available ? window : nextMarketDayLabel(game, player) + '挂牌')}</small></td>
      <td class="num">${available
        ? `<button class="btn small" data-action="club-buy" data-player="${esc(player.id)}" ${game.activeMatch || price <= 0 || !transferWindowOpen(game) ? 'disabled' : ''}>谈判</button>`
        : '<span class="muted small">未挂牌</span>'}</td>
    </tr>`
  }).join('')
  return panel(`自由球员 <small>${agents.length}</small>`, `
    <div class="toolbar in-panel">
      <div class="input-icon">${icon('search', 14)}<input id="club-search" placeholder="搜索姓名 / 国家 / 英文名 / 特性" value="${esc(ui.clubSearch)}"></div>
      <button class="btn small" data-action="club-search">搜索</button>
      <span class="muted small">阵容 ${game.roster.length} / 25 · 余额 ${economy.balance.toLocaleString()}</span>
    </div>
    <p class="hint">签人要谈判：他会问你的赛季目标和给他的位置，报价越高成功率越高。部分球星只在每月的固定几天挂牌。</p>
    ${game.roster.length > SQUAD_LIMIT ? `<p class="warn-text">阵容 ${game.roster.length} / ${SQUAD_LIMIT}，已超编：必须裁掉 ${game.roster.length - SQUAD_LIMIT} 人才能进入比赛。</p>` : ''}
    ${rows ? `<div class="table-scroll"><table class="dt"><thead><tr><th>位置</th><th>球员</th><th>国籍</th><th class="num">龄</th><th class="num">CA</th><th>特性</th><th class="num">底价 / 挂牌日</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState('没有匹配的自由球员。')}
    <div class="pager"><button class="btn small" data-action="club-prev" ${ui.clubPage === 0 ? 'disabled' : ''}>${icon('left', 13)}上一页</button><span class="muted small">${ui.clubPage + 1} / ${pages}</span><button class="btn small" data-action="club-next" ${ui.clubPage >= pages - 1 ? 'disabled' : ''}>下一页${icon('right', 13)}</button></div>
  `, { flush: true })
}

export function renderTransfer(): string {
  const tab = ui.transferTab === 'free' ? 'free' : 'market'
  const body = tab === 'free' ? freeTab() : marketTab()
  return `
    ${pageHead({ kicker: '经营', title: '转会市场' })}
    <div class="tabs" role="tablist">
      ${TABS.map((item) => `<button class="tab ${tab === item.id ? 'active' : ''}" role="tab" aria-selected="${tab === item.id}" data-transfer-tab="${item.id}">${item.id === 'free' && isOnlineMode() ? '全服竞拍' : item.label}</button>`).join('')}
    </div>
    ${body}
  `
}
