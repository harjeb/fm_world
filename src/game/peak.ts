import type { AITeam } from './types.ts'
import { PEAK_STAGES, type PeakStageDef } from './data/peak-stages.generated.ts'
import { frozenPveTeam } from './pve-content.ts'
import { startingCa } from './pve-strength.ts'

export { PEAK_ROAD_SEED, PEAK_ROAD_VERSION, peakStageTargetCa } from './data/peak-config.ts'

export const PEAK_STAGE_COUNT = PEAK_STAGES.length

const cache = new Map<number, AITeam>()

export function peakStageDef(stage: number): PeakStageDef {
  const index = Math.round(stage) - 1
  const def = PEAK_STAGES[index]
  if (!def || def.stage !== Math.round(stage)) throw new Error(`巅峰之路没有第 ${stage} 关`)
  return { ...def, actualCa: startingCa(buildPeakTeam(stage)) }
}

/** 读取冻结的关卡定义并构建球队；同一关只构建一次。 */
export function buildPeakTeam(stage: number): AITeam {
  if (!Number.isInteger(stage) || stage < 1 || stage > PEAK_STAGE_COUNT) throw new Error(`无效关卡：${stage}`)
  const key = stage
  const cached = cache.get(key)
  if (cached) return structuredClone(cached)
  const team = frozenPveTeam('peak', String(key))
  cache.set(key, team)
  return structuredClone(team)
}
