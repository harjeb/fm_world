import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { applyCupCeilingReward, ensureCupCeilingClaims, CUP_CEILING_BONUS } from '../src/game/cup-rewards.ts'
import { attrHardLimit, mainAttrsFor } from '../src/game/rating.ts'
import type { TrophyRecord } from '../src/game/types.ts'

function mainCeilings(game: ReturnType<typeof createInitialGame>) {
  return game.roster.map((player) => mainAttrsFor(player.positions.GK > 0).map((key) => player.ceilings[key]))
}

describe('杯赛冠军俱乐部上限奖励', () => {
  it('三个杯赛分别 +100/+150/+200，且每个杯赛只发一次', () => {
    const game = createInitialGame(71)
    const before = mainCeilings(game)
    expect(applyCupCeilingReward(game, 'community')).toBe(100)
    expect(applyCupCeilingReward(game, 'league')).toBe(150)
    expect(applyCupCeilingReward(game, 'champions')).toBe(200)
    expect(applyCupCeilingReward(game, 'champions')).toBe(0)
    const after = mainCeilings(game)
    for (let p = 0; p < after.length; p++) {
      for (let a = 0; a < after[p].length; a++) {
        expect(after[p][a] - before[p][a]).toBeCloseTo(450, 5)
      }
    }
    expect(CUP_CEILING_BONUS).toEqual({ community: 100, league: 150, champions: 200 })
  })

  it('上限被硬顶在 2000，不会超过道具硬上限', () => {
    const game = createInitialGame(72)
    for (const player of game.roster) for (const key of mainAttrsFor(player.positions.GK > 0)) player.ceilings[key] = 1950
    applyCupCeilingReward(game, 'champions')
    for (const player of game.roster) for (const key of mainAttrsFor(player.positions.GK > 0)) {
      expect(player.ceilings[key]).toBeLessThanOrEqual(attrHardLimit(key, player.positions.GK > 0))
      expect(player.ceilings[key]).toBe(2000)
    }
  })

  it('旧存档已有奖杯时补发对应俱乐部上限', () => {
    const game = createInitialGame(73)
    game.pve!.trophies = [{ cupId: 'league', cupName: '联盟杯', seasonIndex: 1, wonAt: 1, finalOpponent: 'x', finalScore: { home: 1, away: 0 } } as TrophyRecord]
    const before = game.roster[0].ceilings.passing
    expect(ensureCupCeilingClaims(game)).toBe(true)
    expect(game.roster[0].ceilings.passing).toBe(before + 150)
    expect(game.pve!.cupCeilingClaims?.league).toBe(true)
    expect(ensureCupCeilingClaims(game)).toBe(false)
  })
})
