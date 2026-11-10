import { beforeAll, describe, expect, it } from 'vitest'
import { loadPveContent } from '../src/game/pve-content.ts'
beforeAll(loadPveContent)
import { CUP_DEFS, cupDefById } from '../src/game/data/cup-config.ts'
import { CUP_TEAM_POOLS } from '../src/game/data/cup-teams.generated.ts'
import { buildCupField, buildCupGroups, cupRandomTeams } from '../src/game/cup.ts'
import { buildHistoricTeam } from '../src/game/legend.ts'
import { createInitialGame } from '../src/game/state.ts'
import { caOf } from '../src/game/ca.ts'

describe('杯赛随机队池', () => {
  it('三个池子的规模分别是 8 / 12 / 24', () => {
    expect(CUP_TEAM_POOLS.casual).toHaveLength(8)
    expect(CUP_TEAM_POOLS.league).toHaveLength(12)
    expect(CUP_TEAM_POOLS.champions).toHaveLength(24)
  })

  it('每支随机队 16 人、阵容合法，实际 CA 接近设计目标', () => {
    for (const pool of Object.values(CUP_TEAM_POOLS)) {
      for (const def of pool) {
        expect(def.players, def.id).toHaveLength(16)
        const team = buildHistoricTeam(def)
        expect(team.lineup.starters, def.id).toHaveLength(11)
        expect(team.lineup.bench, def.id).toHaveLength(5)
        const average = team.players.slice(0, 11).reduce((sum, player) => sum + caOf(player.attrs, player.positions.GK > 0), 0) / 11
        expect(Math.abs(average - (def.targetCa ?? average)), def.id).toBeLessThanOrEqual(30)
      }
    }
  })
})

describe('杯赛配置与分组', () => {
  it('两个 16 队杯、一个 32 队杯；世界队 + 随机队数量等于总规模', () => {
    expect(CUP_DEFS.map((def) => def.size)).toEqual([16, 16, 32])
    for (const def of CUP_DEFS) {
      expect(def.groups * 4, def.id).toBe(def.size)
      expect(def.worldCount + def.randomCount + 1, def.id).toBe(def.size)
      expect(def.qualifiers, def.id).toBe(2)
    }
    expect(cupDefById('community').knockout).toEqual(['qf', 'sf', 'final'])
    expect(cupDefById('champions').knockout).toEqual(['r16', 'qf', 'sf', 'final'])
    expect(cupDefById('champions').twoLeggedFrom).toBe('qf')
  })

  it('16 队杯：4 组 × 4 队，每组单循环 6 场；32 队杯：8 组', () => {
    const game = createInitialGame(424242)
    for (const cupId of ['community', 'league', 'champions'] as const) {
      const def = cupDefById(cupId)
      const field = buildCupField(cupId, game, 1)
      expect(field, cupId).toHaveLength(def.size)
      expect(new Set(field.map((team) => team.id)).size, cupId).toBe(def.size)
      expect(field.filter((team) => team.kind === 'player')).toHaveLength(1)
      expect(field.filter((team) => team.kind === 'world')).toHaveLength(def.worldCount)
      expect(field.filter((team) => team.kind === 'random')).toHaveLength(def.randomCount)

      const groups = buildCupGroups(cupId, field, 1)
      expect(groups, cupId).toHaveLength(def.groups)
      for (const group of groups) {
        expect(group.teams).toHaveLength(4)
        expect(group.fixtures).toHaveLength(6)
        for (const team of group.teams) {
          expect(group.fixtures.filter((fixture) => fixture.homeId === team.id || fixture.awayId === team.id)).toHaveLength(3)
        }
      }
    }
  })

  it('同一赛季、同一杯赛的随机队固定；换季才轮换', () => {
    const first = cupRandomTeams('champions', 1).map((team) => team.id)
    const again = cupRandomTeams('champions', 1).map((team) => team.id)
    const next = cupRandomTeams('champions', 2).map((team) => team.id)
    expect(again).toEqual(first)
    expect(next).not.toEqual(first)
  })
})
