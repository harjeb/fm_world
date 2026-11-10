import { caOf } from '../src/game/ca.ts'
import { attrRating } from '../src/game/scale.ts'
import { LEGEND_TIER_CA, allLegendTeams, legendTeamById } from '../src/game/legend.ts'
import { LEGEND_TEAMS } from '../src/game/data/legend-teams.ts'
import { startingCa } from '../src/game/pve-strength.ts'
import { FORMATIONS } from '../src/game/data/formations.ts'
import type { AttrKey, Player } from '../src/game/types.ts'

const fmt = (value: number) => value.toFixed(0)

const FIELD_LABELS: [AttrKey, string][] = [
  ['passing', '传球'],
  ['shooting', '射门'],
  ['dribbling', '盘带'],
  ['tackling', '抢断'],
  ['strength', '力量'],
  ['speed', '速度'],
  ['acceleration', '爆发'],
]
const GK_LABELS: [AttrKey, string][] = [
  ['reflexes', '反应'],
  ['handling', '手控球'],
  ['rushing', '出击'],
  ['oneOnOne', '一对一'],
  ['passing', '传球'],
  ['composure', '镇定'],
]

function labelsOf(player: Player): [AttrKey, string][] {
  return player.positions.GK > 0 ? GK_LABELS : FIELD_LABELS
}

function mainRatings(player: Player): number[] {
  const gk = player.positions.GK > 0
  return labelsOf(player).map(([key]) => attrRating(key, player.attrs[key], gk))
}

function meanRating(player: Player): number {
  const ratings = mainRatings(player)
  return ratings.reduce((sum, value) => sum + value, 0) / ratings.length
}

function validate(): string[] {
  const errors: string[] = []
  for (const def of LEGEND_TEAMS) {
    if (def.players.length !== 16) errors.push(`${def.id}: ${def.players.length} 名球员`)
    const team = legendTeamById(def.id)
    if (!team) {
      errors.push(`${def.id}: 构建失败`)
      continue
    }
    const byId = new Map(team.players.map((player) => [player.id, player]))
    for (const starter of team.lineup.starters) {
      const slot = FORMATIONS[def.formationId].slots.find((item) => item.id === starter.slotId)
      const player = byId.get(starter.playerId)
      if (!slot || !player) {
        errors.push(`${def.id}: 槽位 ${starter.slotId} 缺球员`)
        continue
      }
      if (player.positions[slot.position] < 80) errors.push(`${def.id}: ${player.name} 在 ${slot.position} 熟练度不足`)
    }
    for (const player of def.players) {
      if (player[5] < 80 || player[5] > 100) errors.push(`${def.id}: ${player[0]} 主属性平均目标 ${player[5]} 越界`)
    }
    const [minCa, maxCa] = LEGEND_TIER_CA[def.tier]
    const ca = startingCa(team)
    if (ca < minCa - 0.01 || ca > maxCa + 0.01) errors.push(`${def.id}: ${def.tier} 档首发 CA ${ca.toFixed(1)} 不在 ${minCa}–${maxCa}`)
  }
  return errors
}

await (await import('../src/game/pve-content.ts')).loadPveContent()
const errors = validate()
const teams = allLegendTeams()
console.log(`传奇队 ${teams.length} 支，球员 ${teams.reduce((sum, team) => sum + team.players.length, 0)} 名`)
if (errors.length) {
  console.log(`校验失败 ${errors.length} 条：`)
  for (const error of errors.slice(0, 40)) console.log(`  - ${error}`)
} else {
  console.log('校验通过：每队 16 人、首发位置匹配、原始名单主属性目标 80–100、首发 CA 落在档位区间。')
}

for (const tier of ['S+', 'S', 'A', 'B'] as const) {
  const defs = LEGEND_TEAMS.filter((team) => team.tier === tier)
  const rows = defs.map((def) => startingCa(legendTeamById(def.id)!))
  const [minCa, maxCa] = LEGEND_TIER_CA[tier]
  console.log(`${tier}: ${defs.length} 队，首发平均 CA ${(rows.reduce((sum, value) => sum + value, 0) / rows.length).toFixed(1)}（档位 ${minCa}–${maxCa}）`)
}

for (const id of ['milan-1988-89', 'barcelona-2010-11']) {
  const def = LEGEND_TEAMS.find((item) => item.id === id)!
  const team = legendTeamById(id)!
  const avg = team.players.slice(0, 11).reduce((sum, player) => sum + meanRating(player), 0) / 11
  const avgCa = team.players.slice(0, 11).reduce((sum, player) => sum + caOf(player.attrs, player.positions.GK > 0), 0) / 11
  console.log(`\n=== ${def.club} ${def.season} · ${def.coach} · ${def.tier} ===`)
  console.log(`${def.note}`)
  console.log(`阵型 ${def.formationId}，首发 7 项主属性平均 ${avg.toFixed(1)}，平均 CA ${fmt(avgCa)}`)
  for (const starter of team.lineup.starters) {
    const player = team.players.find((item) => item.id === starter.playerId)!
    const slot = FORMATIONS[def.formationId].slots.find((item) => item.id === starter.slotId)!
    const gk = player.positions.GK > 0
    const values = labelsOf(player)
      .map(([key, label]) => `${label}${fmt(attrRating(key, player.attrs[key], gk))}`)
      .join(' ')
    console.log(`  ${slot.label.padEnd(4, ' ')} ${player.name.padEnd(10, ' ')} ${values} | 平均 ${meanRating(player).toFixed(1)}`)
  }
  const bench = team.lineup.bench.map((benchId) => team.players.find((player) => player.id === benchId)!)
  console.log(`  替补：${bench.map((player) => `${player.name} ${meanRating(player).toFixed(1)}`).join('、')}`)
}
