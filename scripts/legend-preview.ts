import { caOf } from '../src/game/ca.ts'
import { allLegendTeams, legendTeamById } from '../src/game/legend.ts'
import { LEGEND_TEAMS } from '../src/game/data/legend-teams.ts'
import { FORMATIONS } from '../src/game/data/formations.ts'

const fmt = (value: number) => value.toFixed(0)

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
      const proficiency = player.positions[slot.position]
      if (proficiency < 80) errors.push(`${def.id}: ${player.name} 在 ${slot.position} 熟练度 ${proficiency}`)
    }
    for (let i = 0; i < def.players.length; i++) {
      const target = def.players[i][5]
      if (target < 1250 || target > 1450) errors.push(`${def.id}: ${def.players[i][0]} 目标 CA ${target} 越界`)
      const player = team.players[i]
      const actual = caOf(player.attrs, player.positions.GK > 0)
      if (Math.abs(actual - target) > 12) errors.push(`${def.id}: ${player.name} CA ${fmt(actual)} ≠ ${target}`)
    }
  }
  return errors
}

const errors = validate()
const teams = allLegendTeams()
console.log(`传奇队 ${teams.length} 支，球员 ${teams.reduce((sum, team) => sum + team.players.length, 0)} 名`)
if (errors.length) {
  console.log(`校验失败 ${errors.length} 条：`)
  for (const error of errors.slice(0, 40)) console.log(`  - ${error}`)
} else {
  console.log('校验通过：每队 16 人、首发位置匹配、CA 在 1250–1450 且与目标误差 ≤ 12。')
}

const tiers = ['S+', 'S', 'A', 'B'] as const
for (const tier of tiers) {
  const ids = LEGEND_TEAMS.filter((team) => team.tier === tier).map((team) => team.id)
  const averages = ids.map((id) => {
    const team = legendTeamById(id)!
    return team.players.slice(0, 11).reduce((sum, player) => sum + caOf(player.attrs, player.positions.GK > 0), 0) / 11
  })
  console.log(`${tier}: ${ids.length} 队，首发平均 CA ${fmt(averages.reduce((sum, value) => sum + value, 0) / averages.length)}`)
}

for (const id of ['milan-1988-89', 'barcelona-2010-11']) {
  const def = LEGEND_TEAMS.find((item) => item.id === id)!
  const team = legendTeamById(id)!
  const avg = team.players.slice(0, 11).reduce((sum, player) => sum + caOf(player.attrs, player.positions.GK > 0), 0) / 11
  console.log(`\n=== ${def.club} ${def.season} · ${def.coach} · ${def.tier} ===`)
  console.log(`${def.note}`)
  console.log(`阵型 ${def.formationId}，首发平均 CA ${fmt(avg)}`)
  for (const starter of team.lineup.starters) {
    const player = team.players.find((item) => item.id === starter.playerId)!
    const ca = caOf(player.attrs, player.positions.GK > 0)
    const slot = FORMATIONS[def.formationId].slots.find((item) => item.id === starter.slotId)!
    const gk = player.positions.GK > 0
    const key = gk
      ? `反应 ${fmt(player.attrs.reflexes)}  手控球 ${fmt(player.attrs.handling)}  出击 ${fmt(player.attrs.rushing)}  一对一 ${fmt(player.attrs.oneOnOne)}`
      : `射门 ${fmt(player.attrs.shooting)}  速度 ${fmt(player.attrs.speed)}  传球 ${fmt(player.attrs.passing)}  防守站位 ${fmt(player.attrs.defPos)}/20`
    console.log(`  ${slot.label.padEnd(4, ' ')} ${player.name.padEnd(10, ' ')} ${gk ? 'GK' : slot.position}  CA ${fmt(ca)}  ${key}`)
  }
  const bench = team.lineup.bench.map((benchId) => team.players.find((player) => player.id === benchId)!)
  console.log(`  替补：${bench.map((player) => `${player.name} ${fmt(caOf(player.attrs, player.positions.GK > 0))}`).join('、')}`)
}
