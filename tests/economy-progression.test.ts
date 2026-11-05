import { expect, it } from 'vitest'
import { awardRoundIncome, economyOf, facilityUpgradeCost, MAX_FACILITY_STAGE, upgradeFacility } from '../src/game/economy'
import type { Fixture, GameState } from '../src/game/types'

// Model separate 38-round seasons, not a single season with N fixtures.
// Reset the income cursor at the boundary, as round numbers restart each season.
function simulate(winEvery: number, seasons = 6): number | undefined {
  const game = { season: { fixtures: [] } } as unknown as GameState
  const economy = economyOf(game)
  let maxed: number | undefined
  for (let season = 0; season < seasons && maxed === undefined; season++) {
    economy.lastIncomeRound = 0
    game.season.fixtures = Array.from({ length: 38 }, (_, i) => {
      const globalRound = season * 38 + i + 1
      const won = winEvery > 0 && globalRound % winEvery === 0
      return { round: i + 1, homeId: 'player', awayId: 'ai', isPlayer: true,
        played: true, score: { home: won ? 1 : 0, away: won ? 0 : 1 } } as Fixture
    })
    for (let round = 1; round <= 38; round++) {
      awardRoundIncome(game, round)
      let cost = facilityUpgradeCost('stadium', economy.stadium)
      while (cost !== null && economy.balance >= cost) {
        expect(upgradeFacility(game, 'stadium').ok).toBe(true)
        if (economy.stadium === MAX_FACILITY_STAGE) maxed = season * 38 + round
        cost = facilityUpgradeCost('stadium', economy.stadium)
      }
    }
  }
  return maxed
}

it('takes multiple seasons to max the stadium and rewards winning more', () => {
  const noWins = simulate(0)
  const normalWins = simulate(6)
  const halfWins = simulate(2)
  console.info('Stadium stage 25 round (0%, one in six, 50% wins):', noWins, normalWins, halfWins)
  // 25 个阶段需要跨越多个赛季，胜利带来的球迷和奖金应当真的更快。
  expect(normalWins).toBeDefined()
  expect(halfWins).toBeDefined()
  expect(halfWins!).toBeLessThan(normalWins!)
  expect(normalWins!).toBeLessThanOrEqual(noWins ?? Infinity)
  expect(normalWins!).toBeGreaterThan(38)
})
