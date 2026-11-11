import { describe, expect, it } from 'vitest'
import { FORMATIONS } from '../src/game/data/formations.ts'
import { baselineTeams } from '../src/game/pes/baseline.ts'
import { ablationFixture } from './tactics-ablation-fixture.ts'

describe('跨阵型严格镜像夹具', () => {
  it.each(['4-4-2', '4-3-3'] as const)('%s 两队槽位、角色、属性、技能和替补逐项相同', (formation) => {
    const { home, away } = ablationFixture(formation)
    expect(home.id).not.toBe(away.id)
    expect(home.formationId).toBe(formation)
    expect(away.formationId).toBe(formation)
    expect(home.starters).toHaveLength(11)
    expect(away.starters).toEqual(home.starters)
    expect(away.bench).toEqual(home.bench)
    expect(home.starters.map((s) => s.slotId)).toEqual(FORMATIONS[formation].slots.map((s) => s.id))
    expect(new Set(home.starters.map((s) => s.player.id)).size).toBe(11)
    for (const s of home.starters) expect(s.player.condition).toBe(100)
  })

  it('生成夹具不会修改后续 baselineTeams 的球员属性', () => {
    const before = baselineTeams(1).home.starters.map((s) => structuredClone(s.player.attrs))
    ablationFixture('4-3-3')
    expect(baselineTeams(1).home.starters.map((s) => s.player.attrs)).toEqual(before)
  })
})
