import { beforeAll, describe, expect, it } from 'vitest'
import { loadPveContent } from '../src/game/pve-content.ts'
beforeAll(loadPveContent)
import { LEGEND_TIER_CA, legendTeamById } from '../src/game/legend.ts'
import { LEGEND_TEAMS } from '../src/game/data/legend-teams.ts'
import { FORMATIONS } from '../src/game/data/formations.ts'
import { startingCa } from '../src/game/pve-strength.ts'

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

  it('冻结后的首发 CA 落在 S+/S/A/B 档位区间，且档位严格分离', () => {
    const byTier = new Map<string, number[]>()
    for (const def of LEGEND_TEAMS) {
      const team = legendTeamById(def.id)!
      const ca = startingCa(team)
      const [min, max] = LEGEND_TIER_CA[def.tier]
      expect(ca, def.id).toBeGreaterThanOrEqual(min - 0.01)
      expect(ca, def.id).toBeLessThanOrEqual(max + 0.01)
      byTier.set(def.tier, [...(byTier.get(def.tier) ?? []), ca])
    }
    const tiers = ['S+', 'S', 'A', 'B'] as const
    for (let index = 0; index < tiers.length - 1; index++) {
      const lower = byTier.get(tiers[index])!, higher = byTier.get(tiers[index + 1])!
      expect(Math.min(...lower)).toBeGreaterThan(Math.max(...higher))
    }
  })

  it('同一队内没有重复的英文名', () => {
    for (const def of LEGEND_TEAMS) {
      const names = def.players.map((player) => player[1])
      expect(new Set(names).size, def.id).toBe(names.length)
    }
  })
})
