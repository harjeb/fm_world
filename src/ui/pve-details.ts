import type { AITeam, Player } from '../game/types.ts'
import { caOf } from '../game/ca.ts'
import { mainAttrsFor } from '../game/scale.ts'
import { ALL_ATTRIBUTES } from '../game/types.ts'
import { ATTR_META } from '../game/data/attributes.ts'
import { FORMATIONS } from '../game/data/formations.ts'
import { caHeat, panel } from './components.ts'
import { attrValue, esc, skillName } from './format.ts'

export function coreNames(team: AITeam): string {
  const ids = new Set(team.lineup.starters.map((starter) => starter.playerId))
  return team.players.filter((p) => ids.has(p.id) && !p.positions.GK).sort((a, b) => caOf(b.attrs, false) - caOf(a.attrs, false)).slice(0, 3).map((p) => p.name).join('、')
}

export function pveTeamButton(key: string, label = '查看阵容'): string {
  return `<button class="btn small ghost" data-pve-team="${esc(key)}">${esc(label)}</button>`
}

function row(player: Player, label: string): string {
  const gk = player.positions.GK > 0
  const keys = mainAttrsFor(gk)
  const values = keys.map((key) => `<td class="num">${attrValue(player, key).toFixed(0)}</td>`).join('')
  const hidden = ALL_ATTRIBUTES.filter((key) => !keys.includes(key) && (gk || !['reflexes', 'handling', 'rushing', 'oneOnOne'].includes(key)))
  return `<tr><td>${esc(label)}</td><td><b>${esc(player.name)}</b><small class="muted"> ${esc(player.enName)}</small><details><summary>技能与其他属性</summary><p>${player.skills.map((id) => esc(skillName(id))).join('、') || '无技能'}</p><p class="small">${hidden.map((key) => `${esc(ATTR_META[key].label)} ${player.attrs[key].toFixed(1)}`).join(' · ')}</p><p class="muted small">年龄 ${player.age ?? '未核实'}；身高 ${player.height || '未核实'}${player.height ? 'cm' : ''}。</p></details></td><td class="num">${caHeat(caOf(player.attrs, gk))}</td>${values}${gk ? '<td>—</td>' : ''}</tr>`
}

/** 外场七项和门将六项分表，不能把反应/手控球塞到射门/抢断列下。 */
export function pveRoster(team: AITeam): string {
  const lineup = FORMATIONS[team.formationId]
  const roles = new Map(team.lineup.starters.map((starter) => [starter.playerId, lineup.slots.find((slot) => slot.id === starter.slotId)?.label ?? starter.slotId]))
  const ordered = [...team.lineup.starters.map((starter) => team.players.find((p) => p.id === starter.playerId)!), ...team.lineup.bench.map((id) => team.players.find((p) => p.id === id)!)]
  const table = (gk: boolean) => `<div class="table-scroll"><table class="dt"><thead><tr><th>首发/替补</th><th>球员</th><th class="num">CA</th>${(gk ? ['反应', '手控球', '出击', '一对一', '传球', '镇定', ''] : ['传球', '射门', '盘带', '抢断', '力量', '速度', '爆发']).map((text) => `<th class="num">${text}</th>`).join('')}</tr></thead><tbody>${ordered.filter((p) => (p.positions.GK > 0) === gk).map((p) => row(p, roles.get(p.id) ?? '替补')).join('')}</tbody></table></div>`
  return panel(`${esc(team.name)} · 完整阵容`, `${table(false)}${table(true)}`, { flush: true })
}
