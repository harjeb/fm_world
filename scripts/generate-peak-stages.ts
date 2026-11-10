import fs from 'node:fs'
import path from 'node:path'
import { PEAK_ROAD_SEED, PEAK_ROAD_VERSION, nationalTeamIndexForStage, peakStageTargetCa } from '../src/game/data/peak-config.ts'
import { NATIONAL_TEAMS } from '../src/game/data/national-teams.ts'
import type { LegendTeamDef } from '../src/game/data/legend-teams.ts'
import { calibrateGeneratedTeam, generateTeam, generatedTeamSpec } from '../src/game/generated-team.ts'
import { splitSeed } from '../src/game/rng.ts'
import { buildHistoricTeam } from '../src/game/legend.ts'
import { alignPveStrength, startingCa } from '../src/game/pve-strength.ts'

export type PeakStageDef = {
  stage: number
  targetCa: number
  actualCa: number
  kind: 'generated' | 'national'
  team: LegendTeamDef
}

const usedNames = new Set<string>()
const stages: PeakStageDef[] = []

for (let stage = 1; stage <= 100; stage++) {
  const targetCa = peakStageTargetCa(stage)
  const nationalIndex = nationalTeamIndexForStage(stage)
  if (nationalIndex >= 0) {
    const base = NATIONAL_TEAMS[nationalIndex]
    const { def, actualCa } = calibrateGeneratedTeam(base, targetCa)
    def.targetCa = targetCa
    stages.push({ stage, targetCa, actualCa, kind: 'national', team: def })
    console.log(`${String(stage).padStart(3, ' ')}  国家队  ${def.club} ${def.season}  目标 ${targetCa}  实际 ${actualCa.toFixed(0)}`)
    continue
  }

  const seed = splitSeed(PEAK_ROAD_SEED, `peak-v${PEAK_ROAD_VERSION}-${stage}`)
  const spec = generatedTeamSpec(seed, targetCa, `peak-${stage}`, stage - 1)
  const { def, actualCa } = generateTeam(spec)
  let name = def.club
  let suffix = 2
  while (usedNames.has(name)) {
    name = `${def.club} ${'II'.repeat(suffix - 1)}`
    suffix += 1
  }
  usedNames.add(name)
  def.club = name
  stages.push({ stage, targetCa, actualCa, kind: 'generated', team: def })
  if (stage % 10 === 0 || Math.abs(actualCa - targetCa) > 25) {
    console.log(`${String(stage).padStart(3, ' ')}  生成    ${name}  目标 ${targetCa}  实际 ${actualCa.toFixed(0)}  ${actualCa >= targetCa ? '+' : ''}${(actualCa - targetCa).toFixed(0)}`)
  }
}

for (const stage of stages) stage.actualCa = startingCa(alignPveStrength(buildHistoricTeam(stage.team), stage.targetCa))

const output = `// 由 scripts/generate-peak-stages.ts 生成，请勿手改。\n// 全局种子 0x${PEAK_ROAD_SEED.toString(16)}，所有玩家共享同一套 100 关对手。\nimport type { LegendTeamDef } from './legend-teams.ts'\n\nexport type PeakStageDef = {\n  stage: number\n  targetCa: number\n  actualCa: number\n  kind: 'generated' | 'national'\n  team: LegendTeamDef\n}\n\nexport const PEAK_STAGES: PeakStageDef[] = ${JSON.stringify(stages, null, 2)}\n`
const target = path.join(process.cwd(), 'src', 'game', 'data', 'peak-stages.generated.ts')
fs.writeFileSync(target, output)
console.log(`\n已写入 ${target}`)
console.log(`共 ${stages.length} 关：生成 ${stages.filter((stage) => stage.kind === 'generated').length}，国家队 ${stages.filter((stage) => stage.kind === 'national').length}`)
const bad = stages.filter((stage) => Math.abs(stage.actualCa - stage.targetCa) > 25)
if (bad.length) console.log(`偏差超过 25 的关卡：${bad.map((stage) => `${stage.stage}(${stage.actualCa.toFixed(0)}/${stage.targetCa})`).join('、')}`)
