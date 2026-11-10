import fs from 'node:fs'
import path from 'node:path'
import { CUP_SEED, type CupPoolId } from '../src/game/data/cup-config.ts'
import type { LegendTeamDef } from '../src/game/data/legend-teams.ts'
import { generateTeam, generatedTeamSpec } from '../src/game/generated-team.ts'
import { splitSeed } from '../src/game/rng.ts'

type PoolSpec = { id: CupPoolId; count: number; minCa: number; maxCa: number }

const POOLS: PoolSpec[] = [
  { id: 'casual', count: 8, minCa: 600, maxCa: 750 },
  { id: 'league', count: 12, minCa: 780, maxCa: 920 },
  { id: 'champions', count: 24, minCa: 950, maxCa: 1100 },
]

const usedNames = new Set<string>()
const pools: Record<CupPoolId, LegendTeamDef[]> = { casual: [], league: [], champions: [] }

for (const pool of POOLS) {
  for (let index = 0; index < pool.count; index++) {
    const targetCa = Math.round(pool.minCa + ((pool.maxCa - pool.minCa) * index) / Math.max(1, pool.count - 1))
    const seed = splitSeed(CUP_SEED, `cup-pool-${pool.id}-${index}`)
    const id = `cup-${pool.id}-${String(index + 1).padStart(2, '0')}`
    const spec = generatedTeamSpec(seed, targetCa, id, index)
    const { def, actualCa } = generateTeam(spec)
    let name = def.club
    let suffix = 2
    while (usedNames.has(name)) {
      name = `${def.club} ${'II'.repeat(suffix - 1)}`
      suffix += 1
    }
    usedNames.add(name)
    def.club = name
    pools[pool.id].push(def)
    const diff = actualCa - targetCa
    console.log(`${pool.id.padEnd(9)} ${id} ${name.padEnd(10, ' ')} 目标 ${targetCa}  实际 ${actualCa.toFixed(0)}  ${diff >= 0 ? '+' : ''}${diff.toFixed(0)}`)
    if (Math.abs(diff) > 25) console.warn(`  ! ${id} 偏差超过 25`)
  }
}

const output = `// 由 scripts/generate-cup-teams.ts 生成，请勿手改。\n// 全局种子 0x${CUP_SEED.toString(16)}，所有玩家共享同一批随机队。\nimport type { LegendTeamDef } from './legend-teams.ts'\n\nexport const CUP_TEAM_POOLS: Record<'casual' | 'league' | 'champions', LegendTeamDef[]> = ${JSON.stringify(pools, null, 2)}\n`
const target = path.join(process.cwd(), 'src', 'game', 'data', 'cup-teams.generated.ts')
fs.writeFileSync(target, output)
console.log(`\n已写入 ${target}`)
console.log(`随机队：社区杯 ${pools.casual.length}、联盟杯 ${pools.league.length}、冠军杯 ${pools.champions.length}`)
