import { beforeAll, describe, expect, it } from 'vitest'
import { loadPveContent } from '../src/game/pve-content.ts'
beforeAll(loadPveContent)
import { PEAK_STAGES } from '../src/game/data/peak-stages.generated.ts'
import { PEAK_STAGE_COUNT, buildPeakTeam, peakStageTargetCa } from '../src/game/peak.ts'
import { caOf } from '../src/game/ca.ts'
import { startingCa } from '../src/game/pve-strength.ts'

describe('巅峰之路 100 关', () => {
  it('关卡连续、难度单调不降、100 关到 1300', () => {
    expect(PEAK_STAGE_COUNT).toBe(100)
    expect(PEAK_STAGES.map((stage) => stage.stage)).toEqual(Array.from({ length: 100 }, (_, index) => index + 1))
    for (let index = 1; index < PEAK_STAGES.length; index++) {
      expect(PEAK_STAGES[index].targetCa).toBeGreaterThanOrEqual(PEAK_STAGES[index - 1].targetCa)
    }
    expect(PEAK_STAGES[0].targetCa).toBe(350)
    expect(PEAK_STAGES[80].targetCa).toBe(1000)
    expect(PEAK_STAGES[99].targetCa).toBe(1300)
    expect(peakStageTargetCa(100)).toBe(1300)
  })

  it('1–80 关生成/特别，81–100 关固定国家队', () => {
    expect(PEAK_STAGES.slice(0, 80).every((stage) => stage.kind === 'generated' || stage.kind === 'special')).toBe(true)
    expect(PEAK_STAGES[49].kind).toBe('special')
    expect(PEAK_STAGES.slice(80).every((stage) => stage.kind === 'national')).toBe(true)
  })

  it('第 50 关是足球小将全明星：CA 保持 780，球星上限 1500', () => {
    const team = buildPeakTeam(50)
    expect(team.name).toBe('足球小将 全明星')
    expect(startingCa(team)).toBeCloseTo(780, 5)
    expect(team.players).toHaveLength(16)
    expect(team.players.find((player) => player.name === '大空翼')).toBeTruthy()
    expect(team.players.every((player) => player.pa >= 1499.9)).toBe(true)
    expect(team.players.every((player) => caOf(player.ceilings, player.positions.GK > 0) >= 1499.9)).toBe(true)
  })

  it('每关可构建 16 人合法阵容，实际 CA 接近目标', () => {
    for (const stage of [1, 20, 50, 80, 81, 90, 99, 100]) {
      const def = PEAK_STAGES[stage - 1]
      const team = buildPeakTeam(stage)
      expect(team.players, def.team.id).toHaveLength(16)
      expect(team.lineup.starters, def.team.id).toHaveLength(11)
      expect(team.lineup.bench, def.team.id).toHaveLength(5)
      const average = team.players.slice(0, 11).reduce((sum, player) => sum + caOf(player.attrs, player.positions.GK > 0), 0) / 11
      expect(Math.abs(average - def.targetCa), `${stage} ${average.toFixed(0)} vs ${def.targetCa}`).toBeLessThanOrEqual(25)
    }
  })

  it('同一关重复构建稳定', () => {
    const first = buildPeakTeam(37)
    const again = buildPeakTeam(37)
    expect(again.players.map((player) => [player.name, player.attrs.shooting, player.attrs.tackling])).toEqual(
      first.players.map((player) => [player.name, player.attrs.shooting, player.attrs.tackling]),
    )
  })
})
