import { beforeAll, describe, expect, it } from 'vitest'
import { loadPveContent } from '../src/game/pve-content.ts'
beforeAll(loadPveContent)
import { attrRating } from '../src/game/scale.ts'
import { legendTeamById } from '../src/game/legend.ts'
import { LEGEND_TEAMS } from '../src/game/data/legend-teams.ts'
import { FORMATIONS } from '../src/game/data/formations.ts'
import type { AttrKey, Player } from '../src/game/types.ts'

const MAIN_FIELD: AttrKey[] = ['passing', 'shooting', 'dribbling', 'tackling', 'strength', 'speed', 'acceleration']
const MAIN_GK: AttrKey[] = ['reflexes', 'handling', 'rushing', 'oneOnOne', 'passing', 'composure']

function mainKeys(player: Player): AttrKey[] {
  return player.positions.GK > 0 ? MAIN_GK : MAIN_FIELD
}

function mainRatings(player: Player): number[] {
  const gk = player.positions.GK > 0
  return mainKeys(player).map((key) => attrRating(key, player.attrs[key], gk))
}

describe('传奇队数据', () => {
  it('50 支，每队 16 人，7 项主属性平均目标在 80–100', () => {
    expect(LEGEND_TEAMS).toHaveLength(50)
    for (const def of LEGEND_TEAMS) {
      expect(def.players, def.id).toHaveLength(16)
      for (const player of def.players) {
        expect(player[5], `${def.id} ${player[1]}`).toBeGreaterThanOrEqual(80)
        expect(player[5], `${def.id} ${player[1]}`).toBeLessThanOrEqual(100)
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

  it('实际主属性平均与目标误差不超过 1.5，且每名球员至少有一项主属性低于 88', () => {
    for (const def of LEGEND_TEAMS) {
      const team = legendTeamById(def.id)!
      for (let index = 0; index < def.players.length; index++) {
        const target = def.players[index][5]
        const player = team.players[index]
        const ratings = mainRatings(player)
        const average = ratings.reduce((sum, value) => sum + value, 0) / ratings.length
        expect(Math.abs(average - target), `${player.name} ${average.toFixed(1)} vs ${target}`).toBeLessThanOrEqual(1.5)
        expect(Math.min(...ratings), `${player.name} 最弱主属性`).toBeLessThan(88)
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
