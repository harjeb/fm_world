import { describe, expect, it } from 'vitest'
import type { Fixture, GameState } from '../src/game/types'
import { awardRoundIncome, economyOf, FACILITIES, facilityUpgradeCost, LEAGUE_WIN_BONUS, upgradeFacility } from '../src/game/economy'

const oldSave = () => ({ season: { fixtures: [] } } as unknown as GameState)

describe('economy', () => {
  it('initializes old saves once', () => {
    const game = oldSave()
    const e = economyOf(game)
    expect(e).toEqual({ balance: 100000, stadium: 1, academy: 1, medical: 1, shop: 1, sponsor: 1, lastIncomeRound: 0 })
    expect(economyOf(game)).toBe(e)
  })

  it('cannot upgrade the stadium immediately with default funds', () => {
    const game = oldSave()
    const e = economyOf(game)
    const before = { ...e }
    expect(upgradeFacility(game, 'stadium').ok).toBe(false)
    expect(e).toEqual(before)
  })

  it('preserves existing save balances and levels while charging future costs', () => {
    const game = oldSave()
    const e = economyOf(game)
    e.balance = 700000
    e.stadium = 3
    expect(economyOf(game)).toBe(e)
    expect(e.balance).toBe(700000)
    expect(e.stadium).toBe(3)
    expect(upgradeFacility(game, 'stadium')).toEqual({ ok: true })
    expect(e.balance).toBe(100000)
    expect(e.stadium).toBe(4)
  })

  it('charges the current level cost and caps upgrades', () => {
    const game = oldSave()
    const e = economyOf(game)
    e.balance = 2000000
    expect([1, 2, 3, 4].map(level => facilityUpgradeCost('stadium', level)))
      .toEqual([200000, 400000, 600000, 800000])
    for (let level = 1; level < 5; level++) {
      const before = e.balance
      expect(upgradeFacility(game, 'stadium')).toEqual({ ok: true })
      expect(e.balance).toBe(before - FACILITIES.stadium.baseCost * level)
      expect(e.stadium).toBe(level + 1)
    }
    const before = { ...e }
    expect(facilityUpgradeCost('stadium', 5)).toBeNull()
    expect(upgradeFacility(game, 'stadium').ok).toBe(false)
    expect(e).toEqual(before)
  })

  it('does not mutate on insufficient funds or invalid inputs', () => {
    const game = oldSave()
    const e = economyOf(game)
    e.balance = 0
    const before = { ...e }
    expect(upgradeFacility(game, 'academy').ok).toBe(false)
    expect(upgradeFacility(game, 'bogus' as 'academy').ok).toBe(false)
    expect(e).toEqual(before)
    e.medical = NaN
    expect(upgradeFacility(game, 'shop').ok).toBe(false)
    expect(awardRoundIncome(game, 1)).toBe(0)
    expect(e.balance).toBe(0)
  })

  it.each([
    ['home win', { homeId: 'player', awayId: 'ai', score: { home: 2, away: 1 } }, true],
    ['away win', { homeId: 'ai', awayId: 'player', score: { home: 0, away: 1 } }, true],
    ['loss', { score: { home: 0, away: 1 } }, false],
    ['draw', { score: { home: 1, away: 1 } }, false],
    ['missing score', { score: undefined }, false],
    ['negative score', { score: { home: 1, away: -1 } }, false],
    ['fractional score', { score: { home: 1.5, away: 0 } }, false],
    ['unsafe score', { score: { home: Number.MAX_SAFE_INTEGER + 1, away: 0 } }, false],
    ['unplayed', { played: false }, false],
    ['AI fixture', { isPlayer: false }, false],
    ['unknown player', { homeId: 'other' }, false],
    ['both player', { awayId: 'player' }, false],
  ] as const)('awards bonus for %s only when eligible', (_label, changes, wins) => {
    const game = oldSave()
    economyOf(game)
    game.season.fixtures = [{ round: 1, homeId: 'player', awayId: 'ai', isPlayer: true, played: true,
      score: { home: 1, away: 0 }, ...changes } as Fixture]
    const income = 22000 + (wins ? LEAGUE_WIN_BONUS : 0)
    expect(awardRoundIncome(game, 1)).toBe(income)
    expect(awardRoundIncome(game, 1)).toBe(0)
    expect(economyOf(game).balance).toBe(100000 + income)
  })

  it('does not pay skipped wins retroactively and rejects overflow atomically', () => {
    const game = oldSave()
    const e = economyOf(game)
    game.season.fixtures = [1, 2].map(round => ({ round, homeId: 'player', awayId: 'ai',
      isPlayer: true, played: true, score: { home: 1, away: 0 } }))
    e.balance = Number.MAX_SAFE_INTEGER - 22000
    expect(awardRoundIncome(game, 2)).toBe(0)
    expect(e.lastIncomeRound).toBe(0)
    expect(e.balance).toBe(Number.MAX_SAFE_INTEGER - 22000)
    e.balance = 100000
    expect(awardRoundIncome(game, 2)).toBe(32000)
    expect(awardRoundIncome(game, 1)).toBe(0)
    expect(e.balance).toBe(132000)
  })

  it('pays income once per increasing completed round', () => {
    const game = oldSave()
    const e = economyOf(game)
    expect(awardRoundIncome(game, 1)).toBe(22000)
    expect(awardRoundIncome(game, 1)).toBe(0)
    expect(awardRoundIncome(game, 0)).toBe(0)
    expect(awardRoundIncome(game, Infinity)).toBe(0)
    expect(upgradeFacility(game, 'shop').ok).toBe(true)
    expect(awardRoundIncome(game, 2)).toBe(25000)
    expect(awardRoundIncome(game, 1)).toBe(0)
    expect(e.lastIncomeRound).toBe(2)
    expect(e.balance).toBe(127000)
  })
})
