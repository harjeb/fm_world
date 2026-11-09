import type { AITeam } from './types.ts'
import { PEAK_STAGES, type PeakStageDef } from './data/peak-stages.generated.ts'
import { buildHistoricTeam } from './legend.ts'

export { PEAK_ROAD_SEED, PEAK_ROAD_VERSION, peakStageTargetCa } from './data/peak-config.ts'

export const PEAK_STAGE_COUNT = PEAK_STAGES.length

const cache = new Map<number, AITeam>()

export function peakStageDef(stage: number): PeakStageDef {
  const index = Math.round(stage) - 1
  const def = PEAK_STAGES[index]
  if (!def || def.stage !== Math.round(stage)) throw new Error(`巅峰之路没有第 ${stage} 关`)
  return def
}

/** 读取冻结的关卡定义并构建球队；同一关只构建一次。 */
export function buildPeakTeam(stage: number): AITeam {
  const key = Math.round(stage)
  const cached = cache.get(key)
  if (cached) return cached
  const team = buildHistoricTeam(peakStageDef(key).team)
  cache.set(key, team)
  return team
}
