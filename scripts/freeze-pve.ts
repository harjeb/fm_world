import fs from 'node:fs'
import crypto from 'node:crypto'
import { LEGEND_TEAMS } from '../src/game/data/legend-teams.ts'
import { PEAK_STAGES } from '../src/game/data/peak-stages.generated.ts'
import { CUP_TEAM_POOLS } from '../src/game/data/cup-teams.generated.ts'
import { LEGEND_TIER_CA, buildHistoricTeam, legendTierTargets } from '../src/game/legend.ts'
import { alignPveStrength, applyStarPotential, startingCa } from '../src/game/pve-strength.ts'
import type { AITeam } from '../src/game/types.ts'
import { validateLineup } from '../src/game/squad.ts'

const legends: Record<string, AITeam> = {}, peak: Record<string, AITeam> = {}, cups: Record<string, AITeam> = {}
const legendTargets = legendTierTargets()
for (const def of LEGEND_TEAMS) legends[def.id] = alignPveStrength(buildHistoricTeam(def), legendTargets.get(def.id)!)
for (const stage of PEAK_STAGES) {
  const team = alignPveStrength(buildHistoricTeam(stage.team), stage.targetCa)
  peak[String(stage.stage)] = stage.kind === 'special' ? applyStarPotential(team) : team
}
for (const pool of Object.values(CUP_TEAM_POOLS)) for (const def of pool) cups[def.id] = alignPveStrength(buildHistoricTeam(def), def.targetCa!)
for (const team of [...Object.values(legends), ...Object.values(peak), ...Object.values(cups)]) {
  const check = validateLineup(team.players, team.lineup)
  if (!check.valid) throw new Error(`${team.id}: ${check.errors.join('；')}`)
  if (new Set(team.players.map((p) => p.enName)).size !== 16) throw new Error(`${team.id}: 球员重名`)
}
for (let i = 1; i < 100; i++) if (startingCa(peak[String(i)]) > startingCa(peak[String(i + 1)]) + 1e-6) throw new Error(`关卡 ${i}→${i + 1} CA 倒退`)
for (const stage of PEAK_STAGES.filter((item) => item.kind === 'special')) {
  const team = peak[String(stage.stage)]
  const minPa = Math.min(...team.players.map((player) => player.pa))
  if (minPa < 1300) throw new Error(`特别关 ${stage.stage}: 球星上限过低 ${minPa.toFixed(0)}`)
}
for (const def of LEGEND_TEAMS) {
  const ca = startingCa(legends[def.id]), [min, max] = LEGEND_TIER_CA[def.tier]
  if (ca < min - 1e-6 || ca > max + 1e-6) throw new Error(`${def.id}: ${def.tier} 档 CA ${ca.toFixed(1)} 不在 ${min}–${max}`)
}
const body = { version: 2, legends, peak, cups }
const hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')
fs.writeFileSync('src/game/data/pve-snapshots.generated.json', JSON.stringify({ ...body, hash }) + '\n')
console.log(`冻结 50 传奇 + 100 巅峰 + 44 杯赛，完整属性/首发/替补；SHA256 ${hash}`)
