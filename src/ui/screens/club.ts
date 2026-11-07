import type { Player } from '../../game/types.ts'
import { BASE_ROUND_INCOME, economyOf, FACILITIES, facilityLevel, facilityRoundIncome, facilityStageChance, facilityStageInLevel, facilityUpgradeCost, GOAL_INCOME_BONUS, LEAGUE_WIN_BONUS, MAX_FACILITY_LEVEL, MAX_FACILITY_STAGE, projectedRoundIncome, STAGES_PER_LEVEL, type FacilityId } from '../../game/economy.ts'
import { bestMarketValue, transferWindowOpen } from '../../game/market.ts'
import { caHeat, icon, pageHead, panel, posBadge, primaryPosition, tag, tile } from '../components.ts'
import { esc, playerCA } from '../format.ts'
import type { IconName } from '../icons.ts'
import { game, ui, type ClubTab } from '../state.ts'

const FACILITY_INFO: Record<FacilityId, { label: string; icon: IconName; effect: string }> = {
  stadium: { label: '球场', icon: 'stadium', effect: '所有属性成长 +2 / 等级' },
  academy: { label: '青训设施', icon: 'cap', effect: '技术属性成长 +5 / 等级' },
  medical: { label: '医疗设施', icon: 'cross', effect: '身体属性成长 +5 / 等级；另缩短新伤恢复' },
  psychology: { label: '心理辅导室', icon: 'psychology', effect: '决断、团队合作、镇定成长 +5 / 等级' },
  tactics: { label: '战术研究室', icon: 'tactics', effect: '视野、预判、无球跑动、防守站位成长 +5 / 等级' },
  shop: { label: '球迷商店', icon: 'bag', effect: '只提高每轮余额收入，不加属性' },
  sponsor: { label: '赞助商', icon: 'badge', effect: '只提高每轮余额收入，不加属性' },
}

/** 只有这几座设施参与培养加成；球迷商店和赞助商只影响收入。 */
const GROWTH_FACILITIES = new Set<FacilityId>(['stadium', 'academy', 'medical', 'psychology', 'tactics'])

const TABS: { id: ClubTab; label: string }[] = [
  { id: 'facilities', label: '设施' },
  { id: 'contracts', label: '合同与工资' },
]

/** 等级内的 5 个阶段；每个等级的第 5 阶段必成。 */
function stagePips(stage: number): string {
  const current = facilityStageInLevel(stage)
  return `<span class="pips" aria-label="第 ${current} 阶段 / ${STAGES_PER_LEVEL}">${Array.from({ length: STAGES_PER_LEVEL }, (_, index) => `<i class="${index < current ? 'on' : ''}"></i>`).join('')}</span>`
}

function nameCell(player: Player): string {
  return `<td class="name-cell"><button class="name-btn" data-action="detail" data-player="${esc(player.id)}">${esc(player.name)}</button><small>${esc(player.enName)}</small></td>`
}

function facilitiesTab(): string {
  const economy = economyOf(game)
  const rows = (Object.keys(FACILITIES) as FacilityId[]).map((id) => {
    const info = FACILITY_INFO[id]
    const stage = economy[id]
    const level = facilityLevel(stage)
    const cost = facilityUpgradeCost(id, stage)
    const income = facilityRoundIncome(economy, id)
    const chance = Math.round(facilityStageChance(stage) * 100)
    return `<tr>
      <td><span class="facility-name">${icon(info.icon, 16)}<b>${info.label}</b><span class="lv">LV${level}</span></span></td>
      <td>${stagePips(stage)}<small class="muted stage-count">${facilityStageInLevel(stage)} / ${STAGES_PER_LEVEL}</small></td>
      <td class="num">${GROWTH_FACILITIES.has(id) ? `${chance}%` : '<span class="muted">—</span>'}</td>
      <td class="num">${income ? income.toLocaleString() : '<span class="muted">—</span>'}</td>
      <td class="dim wrap">${info.effect}</td>
      <td class="num"><button class="btn small" data-action="club-upgrade" data-facility="${id}" ${cost === null || economy.balance < cost ? 'disabled' : ''}>${cost === null ? '已满级' : `升级 · ${cost.toLocaleString()}`}</button></td>
    </tr>`
  }).join('')
  return `<div class="grid club-grid">
    ${panel('俱乐部设施', `<div class="table-scroll"><table class="dt"><thead><tr><th>设施</th><th>阶段</th><th class="num">成长概率</th><th class="num">每轮收入</th><th>培养加成</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`, { flush: true })}
    ${panel('设施规则', `<ul class="rule-list">
      <li>${icon('coin', 13)}每轮保底 ${BASE_ROUND_INCOME.toLocaleString()}；球迷每人贡献 2，球场、商店、赞助收入随球迷规模增长（最多按 4 倍计算）。</li>
      <li>${icon('flag', 13)}联赛比分推动球迷增长：胜场与进球越多，下一轮收入越高；本轮每进一球另得 ${GOAL_INCOME_BONUS.toLocaleString()}，胜场加 ${LEAGUE_WIN_BONUS.toLocaleString()} + 球迷数的 35%。友谊赛不计收入或涨粉。</li>
      <li>${icon('training', 13)}培养免费，仅消耗 30 精力；设施共 ${MAX_FACILITY_LEVEL} 个等级、每级 ${STAGES_PER_LEVEL} 个阶段（合计 ${MAX_FACILITY_STAGE} 个阶段）。第 ${STAGES_PER_LEVEL} 阶段会升到下一等级，费用明显高于同级的前几个阶段。</li>
      <li>${icon('bag', 13)}球迷商店和赞助商只提高每轮余额收入，不再提供属性成长；它们原来的培养加成由心理辅导室和战术研究室接管。</li>
      <li>${icon('up', 13)}每次培养或事件里，设施加成分两段独立判定：每个等级的第 ${STAGES_PER_LEVEL} 阶段必定触发，等级内其余阶段从该等级的下限线性上升（1 级 20%–100%、2 级 50%–100%、3 级 70%–100%、4 级 80%–100%、5 级 85%–100%）。升级不会让期望成长倒退。</li>
      <li>${icon('cap', 13)}设施提供额外成长，每项主属性各有自己的上限（由球员画像决定，通常不到 1500）。</li>
      <li>${icon('cross', 13)}每次行动或事件中，仅对基础成长为正的属性加成；例如医疗 3 级为每项符合条件的身体主属性额外 +15，球场另计。</li>
      <li>${icon('info', 13)}隐藏属性加成按 20/1500 缩放；休息、位置训练及无成长不加成，上限截断成长但不降低现有属性。</li>
      <li>${icon('clock', 13)}设施等级在开始培养时锁定，升级从下一次培养生效；旧培养若无设施快照则没有建筑加成。</li>
    </ul>`)}
  </div>`
}

function contractsTab(): string {
  const rows = [...game.roster]
    .sort((a, b) => (a.contract?.expiresSeason ?? 0) - (b.contract?.expiresSeason ?? 0) || playerCA(b) - playerCA(a))
    .map((player) => {
      const expiring = player.contract && player.contract.expiresSeason <= game.season.index
      return `<tr data-key="${esc(player.id)}">
        <td>${posBadge(primaryPosition(player))}</td>
        ${nameCell(player)}
        <td class="num">${player.age ?? 24}</td>
        <td class="num strong">${caHeat(playerCA(player))}</td>
        <td class="num">${player.contract ? `第 ${player.contract.expiresSeason} 赛季` : '—'} ${expiring ? tag('本季到期', 'gold') : ''}</td>
        <td class="num">${player.contract?.wage?.toLocaleString() ?? '—'}</td>
        <td class="num dim">${bestMarketValue(game, player).toLocaleString()}</td>
        <td class="num actions-cell"><button class="btn small" data-action="contract-renew" data-player="${esc(player.id)}">续约 2 年</button><button class="btn small ghost" data-action="contract-release" data-player="${esc(player.id)}">解约</button></td>
      </tr>`
    }).join('')
  const wages = game.roster.reduce((sum, player) => sum + (player.contract?.wage ?? 0), 0)
  return panel('合同与工资', `<div class="table-scroll"><table class="dt"><thead><tr><th>位置</th><th>球员</th><th class="num">龄</th><th class="num">CA</th><th class="num">合同至</th><th class="num">工资 / 轮</th><th class="num">估值</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint pad">合同到期赛季结束后，球员进入自由市场；阵容不足 13 人时自动续约。工资每轮从俱乐部余额扣除。</p>`, { flush: true, aside: `<span class="muted small">每轮工资 ${wages.toLocaleString()}</span>` })
}

export function renderClub(): string {
  const economy = economyOf(game)
  const wages = game.roster.reduce((sum, player) => sum + (player.contract?.wage ?? 0), 0)
  const income = projectedRoundIncome(economy, game.season.tier)
  const wagesDue = game.world && game.world.seasonIndex <= 1 ? 0 : wages
  const net = income - wagesDue
  const body = ui.clubTab === 'contracts' ? contractsTab() : facilitiesTab()
  return `
    ${pageHead({ kicker: '俱乐部', title: '设施与合同' })}
    <div class="kpi-row club-kpis">
      ${tile('余额', economy.balance.toLocaleString())}
      ${tile('球迷', economy.fans.toLocaleString(), economy.lastFanChange === undefined ? '联赛赛果带动球迷增长' : `上轮 ${economy.lastFanChange >= 0 ? '+' : ''}${economy.lastFanChange.toLocaleString()}`)}
      ${tile('预计每轮收入', income.toLocaleString(), economy.lastRoundIncome === undefined ? '不含本轮进球、胜场奖金' : `上轮实际 ${economy.lastRoundIncome.toLocaleString()}`)}
      ${tile('每轮工资', wages.toLocaleString(), game.world && game.world.seasonIndex <= 1 ? '首赛季由董事会承担' : `${game.roster.length} 名球员`)}
      ${tile('预计每轮净收入', `<span class="${net >= 0 ? 'up' : 'down'}">${net >= 0 ? '+' : ''}${net.toLocaleString()}</span>`, '不含本轮进球、胜场奖金和交易')}
    </div>
    <div class="tabs" role="tablist">
      ${TABS.map((tab) => `<button class="tab ${ui.clubTab === tab.id ? 'active' : ''}" role="tab" aria-selected="${ui.clubTab === tab.id}" data-club-tab="${tab.id}">${tab.label}</button>`).join('')}
    </div>
    ${body}
  `
}
