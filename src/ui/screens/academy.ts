import type { Player } from '../../game/types.ts'
import { POSITIONS } from '../../game/types.ts'
import { bestMarketValue } from '../../game/market.ts'
import { MAIN_FIELD_ATTRS, MAIN_GK_ATTRS } from '../../game/scale.ts'
import { playerCards } from '../../game/cards.ts'
import { PLAYABLE_PROFICIENCY } from '../../game/ca.ts'
import { ATTR_STOPS, CA_STOPS, attrHeadCell, attrHeat, caHeat, cardSelect, countryLabel, emptyState, eraLabel, heatLegend, icon, injuryLabel, mainAttrs, meter, pageHead, panel, posBadge, primaryPosition, skillTag, skillTierLabel, tag, traitLabel } from '../components.ts'
import { esc, playerCA, positionLabel, skillName } from '../format.ts'
import { tipAttrs } from '../tooltip.ts'
import { skillEffectText } from '../../game/data/skill-effects.ts'
import { getSkillTier } from '../../game/inheritance.ts'
import { game, ui, type SquadSortKey } from '../state.ts'

function sortValue(player: Player, key: SquadSortKey): number | string {
  switch (key) {
    case 'pos': return POSITIONS.indexOf(primaryPosition(player))
    case 'name': return player.name
    case 'age': return player.age ?? 24
    case 'ca': return playerCA(player)
    case 'condition': return player.condition ?? 100
    case 'energy': return player.energy ?? 100
    case 'value': return bestMarketValue(game, player)
    default: {
      const index = Number(key.slice(4))
      return player.attrs[mainAttrs(player)[index]] ?? 0
    }
  }
}

function filteredRoster(): Player[] {
  const query = ui.academySearch.trim().toLowerCase()
  const roster = game.roster.filter((player) => {
    if (ui.academyPos !== 'ALL' && player.positions[ui.academyPos] < PLAYABLE_PROFICIENCY) return false
    if (ui.academyEra !== 'ALL' && player.era !== ui.academyEra) return false
    if (!query) return true
    return `${player.name} ${player.enName} ${player.country}`.toLowerCase().includes(query)
  })
  return roster.sort((a, b) => {
    const x = sortValue(a, ui.squadSort)
    const y = sortValue(b, ui.squadSort)
    const order = typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y), 'zh-CN') : x - y
    return order * ui.squadSortDir
  })
}

function sortHead(key: SquadSortKey, label: string, className = ''): string {
  const active = ui.squadSort === key
  return `<th class="sortable ${className} ${active ? 'sorted' : ''}" data-sort="${key}" ${active ? `aria-sort="${ui.squadSortDir === 1 ? 'ascending' : 'descending'}"` : ''}>${label}${active ? `<span class="sort-mark">${ui.squadSortDir === 1 ? '▲' : '▼'}</span>` : ''}</th>`
}

function statusTags(player: Player): string {
  const session = game.training[player.id]
  const candidate = game.candidates[player.id]
  const tags: string[] = []
  if (game.lineup.starters.some((starter) => starter.playerId === player.id)) tags.push(tag('首发', 'solid'))
  else if (game.lineup.bench.includes(player.id)) tags.push(tag('替补'))
  if (injuryLabel(player)) tags.push(tag('受伤', 'bad'))
  if (game.suspensions?.[player.id]) tags.push(tag('停赛', 'bad'))
  if (session && !session.completed) tags.push(tag(session.pendingEventId ? '待处理事件' : '培养中', session.pendingEventId ? 'gold' : 'info'))
  if (candidate || session?.completed) tags.push(tag('新卡', 'good'))
  return `<span class="tag-row">${tags.join('')}</span>`
}

function squadRow(player: Player): string {
  const pos = primaryPosition(player)
  const skills = player.skills.slice(0, 2).map((skill) => skillTag(player, skill)).join('')
  const hiddenSkills = player.skills.slice(2)
  const more = hiddenSkills.length ? `<span class="muted small has-tip" ${tipAttrs('其余技能', hiddenSkills.map((skill) => `${skillName(skill)} · ${skillTierLabel(player, skill)}：${skillEffectText(skill, getSkillTier(player, skill))}`).join('\n'))}>+${hiddenSkills.length}</span>` : ''
  return `<tr class="clickable" data-action="detail" data-player="${esc(player.id)}" data-key="${esc(player.id)}">
    <td>${posBadge(pos)}</td>
    <td class="name-cell"><button class="name-btn" data-action="detail" data-player="${esc(player.id)}">${esc(player.name)}</button><small>${esc(player.enName)}</small></td>
    <td class="num">${player.age ?? 24}</td>
    <td class="dim">${esc(countryLabel(player))}</td>
    <td class="dim">${esc(eraLabel(player.era))}</td>
    <td class="t-card">${playerCards(game, player.id).length ? cardSelect(player) : '<span class="muted small">原始</span>'}</td>
    <td class="num strong">${caHeat(playerCA(player))}</td>
    ${mainAttrs(player).map((key) => `<td class="num">${attrHeat(player.attrs[key])}</td>`).join('')}
    <td class="meter-cell">${meter(player.condition ?? 100)}</td>
    <td class="meter-cell">${meter(player.energy ?? 100)}</td>
    <td class="num dim">${bestMarketValue(game, player).toLocaleString()}</td>
    <td>${statusTags(player)}</td>
    <td><span class="tag-row">${traitLabel(player.traitId, true)}${skills}${more}</span></td>
  </tr>`
}

function squadTable(players: Player[], gk: boolean): string {
  const attrs = gk ? MAIN_GK_ATTRS : MAIN_FIELD_ATTRS
  return `<div class="table-scroll"><table class="dt squad">
    <thead><tr>
      ${sortHead('pos', '位置')}
      ${sortHead('name', '球员')}
      ${sortHead('age', '龄', 'num')}
      <th>国籍</th>
      <th>年代</th>
      <th>球员卡</th>
      ${sortHead('ca', 'CA', 'num ca-col')}
      ${attrs.map((key, index) => sortHead(`attr${index}`, attrHeadCell(key), 'num attr-col')).join('')}
      ${sortHead('condition', '体能', 'meter-col')}
      ${sortHead('energy', '精力', 'energy-col')}
      ${sortHead('value', '估值', 'num value-col')}
      <th class="mark-col">标记</th>
      <th class="skill-col">特性与技能</th>
    </tr></thead>
    <tbody>${players.map(squadRow).join('')}</tbody>
  </table></div>`
}

export function renderAcademy(): string {
  const all = filteredRoster()
  const field = all.filter((player) => player.positions.GK <= 0)
  const keepers = all.filter((player) => player.positions.GK > 0)
  const eras = [...new Set(game.roster.map((player) => player.era))]
  return `
    ${pageHead({
      kicker: '球员',
      title: `${game.roster.length} 名球员`,
      sub: '表里的属性来自每人当前装备的球员卡；可以直接在“球员卡”列换卡。点击球员查看详情，点击表头排序。',
    })}
    <div class="toolbar">
      <div class="input-icon">${icon('search', 14)}<input id="academy-search" placeholder="搜索球员 / 国家 / 英文名" value="${esc(ui.academySearch)}" /></div>
      <select id="academy-era" aria-label="年代">
        <option value="ALL" ${ui.academyEra === 'ALL' ? 'selected' : ''}>全部年代</option>
        ${eras.map((era) => `<option value="${esc(era)}" ${ui.academyEra === era ? 'selected' : ''}>${esc(era === 'random' ? '青训球员' : era)}</option>`).join('')}
      </select>
      <div class="seg" role="group" aria-label="位置">
        <button class="${ui.academyPos === 'ALL' ? 'active' : ''}" data-filter-pos="ALL">全部</button>
        ${POSITIONS.map((pos) => `<button class="${ui.academyPos === pos ? 'active' : ''}" data-filter-pos="${pos}">${positionLabel(pos)}</button>`).join('')}
      </div>
      <span class="muted toolbar-count">${all.length} 人</span>
      ${heatLegend('属性', ATTR_STOPS)}
    </div>
    <div id="academy-results">
      ${all.length === 0 ? emptyState('没有符合条件的球员。') : ''}
      ${field.length ? panel(`外场球员 <small>${field.length}</small>`, squadTable(field, false), { flush: true, aside: heatLegend('CA', CA_STOPS) }) : ''}
      ${keepers.length ? panel(`门将 <small>${keepers.length}</small>`, squadTable(keepers, true), { flush: true }) : ''}
    </div>
  `
}
