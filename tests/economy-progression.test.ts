import { expect, it } from 'vitest'
import { awardRoundIncome, economyOf, facilityUpgradeCost, upgradeFacility } from '../src/game/economy'
import type { Fixture, GameState } from '../src/game/types'

// Model two separate 38-round seasons, not a single season with 76 fixtures.
// Reset the income cursor at the boundary, as round numbers restart each season.
function simulate(winEvery: number): number | undefined {
  const game = { season: { fixtures: [] } } as unknown as GameState
  const economy = economyOf(game)
  let level5: number | undefined
  for (let season = 0; season < 2; season++) {
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
        if (economy.stadium === 5) level5 = season * 38 + round
        cost = facilityUpgradeCost('stadium', economy.stadium)
      }
    }
  }
  return level5
}

it('reaches stadium level 5 around mid second season with normal income', () => {
  const noWins = simulate(0)
  const normalWins = simulate(6)
  const halfWins = simulate(2)
  console.info('Stadium level 5 round (0%, one in six, 50% wins):', noWins, normalWins, halfWins)
  expect(normalWins).toBeGreaterThanOrEqual(52)
  expect(normalWins).toBeLessThanOrEqual(62)
  expect(noWins).toBeDefined()
  expect(halfWins).toBeDefined()
  expect(halfWins!).toBeGreaterThan(1)
  expect(halfWins!).toBeLessThanOrEqual(normalWins!)
  expect(noWins!).toBeGreaterThanOrEqual(normalWins!)
  expect(noWins!).toBeLessThanOrEqual(76)
})
