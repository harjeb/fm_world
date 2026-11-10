/** 巅峰之路的全局配置：所有玩家共用同一套关卡对手。 */
export const PEAK_ROAD_SEED = 0x5eed2026
export const PEAK_ROAD_VERSION = 1

const BANDS: [from: number, to: number, startCa: number, endCa: number][] = [
  [1, 10, 350, 450],
  [11, 20, 450, 550],
  [21, 30, 550, 630],
  [31, 40, 630, 710],
  [41, 50, 710, 780],
  [51, 60, 780, 850],
  [61, 70, 850, 920],
  [71, 80, 920, 1000],
  [81, 90, 1000, 1135],
  [91, 99, 1150, 1270],
  [100, 100, 1300, 1300],
]

/** 1–100 关的目标首发平均 CA；段内线性、取整到 5。 */
export function peakStageTargetCa(stage: number): number {
  const clamped = Math.max(1, Math.min(100, Math.round(stage)))
  for (const [from, to, startCa, endCa] of BANDS) {
    if (clamped < from || clamped > to) continue
    if (from === to) return endCa
    const value = startCa + ((endCa - startCa) * (clamped - from)) / (to - from)
    return Math.round(value / 5) * 5
  }
  return 1300
}

/** 81–100 关固定国家队的序号（0 起）；其他关卡返回 -1。 */
export function nationalTeamIndexForStage(stage: number): number {
  return stage >= 81 && stage <= 100 ? stage - 81 : -1
}
