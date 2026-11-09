import { describe, expect, it } from 'vitest'
import { caOf } from '../src/game/ca.ts'
import { legendTeamById } from '../src/game/legend.ts'
import { LEGEND_TEAMS } from '../src/game/data/legend-teams.ts'
import { FORMATIONS } from '../src/game/data/formations.ts'

describe('传奇队数据', () => {
  it('50 支，每队 16 人，CA 全部落在 1250–1450', () => {
    expect(LEGEND_TEAMS).toHaveLength(50)
    for (const def of LEGEND_TEAMS) {
      expect(def.players, def.id).toHaveLength(16)
      for (const player of def.players) {
        expect(player[5], `${def.id} ${player[1]}`).toBeGreaterThanOrEqual(1250)
        expect(player[5], `${def.id} ${player[1]}`).toBeLessThanOrEqual(1450)
      }
    }
  })

  it('每队都能构建出合法阵容，首发位置与阵型槽位匹配', () => {
    for (const def of LEGEND_TEAMS) {
      const team = legendTeamById(def.id)
      expect(team, def.id).toBeTruthy()
      const byId = new Map(team!.players.map((player) => [player.id, player]))
      for (const starter of team!.lineup.starters) {
        const slot = FORMATIONS[def.formationId].slots.find((item) => item.id === starter.slotId)!
        const player = byId.get(starter.playerId)!
        expect(player.positions[slot.position], `${def.id} ${player.name} ${slot.position}`).toBeGreaterThanOrEqual(80)
      }
      expect(team!.lineup.starters).toHaveLength(11)
      expect(team!.lineup.bench).toHaveLength(5)
    }
  })

  it('实际 CA 与设计目标误差不超过 12（隐藏属性按 0.5 评分取整）', () => {
    for (const def of LEGEND_TEAMS) {
      const team = legendTeamById(def.id)!
      for (let index = 0; index < def.players.length; index++) {
        const target = def.players[index][5]
        const player = team.players[index]
        const actual = caOf(player.attrs, player.positions.GK > 0)
        expect(Math.abs(actual - target), `${player.name} ${actual.toFixed(0)} vs ${target}`).toBeLessThanOrEqual(12)
      }
    }
  })

  it('同一队内没有重复的英文名', () => {
    for (const def of LEGEND_TEAMS) {
      const names = def.players.map((player) => player[1])
      expect(new Set(names).size, def.id).toBe(names.length)
    }
  })
})
