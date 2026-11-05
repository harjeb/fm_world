import { describe, expect, it } from 'vitest'
import type { Fixture, GameState } from '../src/game/types'
import {
  awardRoundIncome, economyOf, facilityLevel, facilityRoundIncome, facilityStageInLevel, FACILITIES,
  facilityUpgradeCost, fansAfterResult, GOAL_INCOME_BONUS, LEAGUE_WIN_BONUS, MAX_FACILITY_STAGE,
  facilityStageChance, MAX_FACILITY_LEVEL, projectedRoundIncome, STARTING_FANS,
  STARTING_FACILITY_STAGE, STAGES_PER_LEVEL, upgradeFacility,
} from '../src/game/economy'

const oldSave = () => ({ season: { fixtures: [] } } as unknown as GameState)
const startStage = STARTING_FACILITY_STAGE

describe('economy', () => {
  it('initializes old saves once', () => {
    const game = oldSave()
    const e = economyOf(game)
    expect(e).toEqual({
      balance: 100000, fans: STARTING_FANS, stageVersion: 3,
      stadium: startStage, academy: startStage, medical: startStage, shop: startStage, sponsor: startStage,
      psychology: startStage, tactics: startStage,
      lastIncomeRound: 0,
    })
    expect(economyOf(game)).toBe(e)
  })

  it('walks 5 stages per level and finishes at stage 25', () => {
    const stages = Array.from({ length: MAX_FACILITY_STAGE }, (_, index) => index + 1)
    expect(stages.map(facilityLevel)).toEqual([
      1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5,
    ])
    expect(stages.slice(0, 6).map(facilityStageInLevel)).toEqual([1, 2, 3, 4, 5, 1])
    expect(facilityUpgradeCost('stadium', MAX_FACILITY_STAGE)).toBeNull()
    expect(facilityUpgradeCost('stadium', 0)).toBeNull()
    expect(facilityUpgradeCost('bogus' as 'stadium', 5)).toBeNull()
  })

  it('starts a fresh club at the first stage and raises the odds as stages go up', () => {
    const e = economyOf(oldSave())
    expect([e.stadium, e.academy, e.medical, e.shop, e.sponsor, e.psychology, e.tactics]).toEqual([1, 1, 1, 1, 1, 1, 1])
    expect(facilityStageChance(1)).toBeCloseTo(0.2)
    for (let stage = 0; stage < MAX_FACILITY_STAGE; stage += STAGES_PER_LEVEL) {
      // 每个等级的第 5 阶段必定触发。
      expect(facilityStageChance(stage + STAGES_PER_LEVEL)).toBe(1)
      // 等级内概率递增。
      for (let step = 2; step <= STAGES_PER_LEVEL; step++) {
        expect(facilityStageChance(stage + step)).toBeGreaterThanOrEqual(facilityStageChance(stage + step - 1))
      }
    }
    // 期望成长 = 概率 × 等级加成，跨等级不能倒退。
    const expected = Array.from({ length: MAX_FACILITY_STAGE }, (_, index) =>
      facilityStageChance(index + 1) * facilityLevel(index + 1))
    for (let index = 1; index < expected.length; index++) {
      expect(expected[index]).toBeGreaterThanOrEqual(expected[index - 1] - 1e-9)
    }
    expect(expected[MAX_FACILITY_STAGE - 1]).toBeCloseTo(MAX_FACILITY_LEVEL)
  })

  it('charges more for the stage that completes a level', () => {
    const costs = Array.from({ length: MAX_FACILITY_STAGE - 1 }, (_, index) => facilityUpgradeCost('stadium', index + 1)!).slice(0, 10)
    // 同一等级内越来越贵，第 5 阶段（升到下一等级）最贵。
    for (let index = 1; index < costs.length; index++) expect(costs[index]).toBeGreaterThan(costs[index - 1])
    expect(costs[4]).toBeGreaterThan(costs[3] * 1.4)
    expect(costs[5]).toBeGreaterThan(costs[4])
    expect(costs[9]).toBeGreaterThan(costs[6] * 2)
  })

  it('upgrades one stage at a time and runs out of money', () => {
    const game = oldSave()
    const e = economyOf(game)
    expect(e.balance).toBe(100000)
    let spent = 0
    let stages = 0
    while (upgradeFacility(game, 'stadium').ok) {
      stages++
      spent += facilityUpgradeCost('stadium', startStage + stages - 1)!
    }
    // 起始资金只够买下 1 级的前几个阶段，随后余额不足而停下。
    expect(stages).toBeGreaterThan(0)
    expect(facilityLevel(startStage + stages)).toBe(1)
    expect(e.balance).toBe(100000 - spent)
    expect(facilityUpgradeCost('stadium', e.stadium)!).toBeGreaterThan(e.balance)

    const before = { ...e }
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
    ['home win', { homeId: 'player', awayId: 'ai', score: { home: 2, away: 1 } }, [2, 1]],
    ['away win', { homeId: 'ai', awayId: 'player', score: { home: 0, away: 1 } }, [1, 0]],
    ['loss', { score: { home: 0, away: 1 } }, [0, 1]],
    ['draw', { score: { home: 1, away: 1 } }, [1, 1]],
    ['missing score', { score: undefined }, null],
    ['negative score', { score: { home: 1, away: -1 } }, null],
    ['fractional score', { score: { home: 1.5, away: 0 } }, null],
    ['unsafe score', { score: { home: Number.MAX_SAFE_INTEGER + 1, away: 0 } }, null],
    ['unplayed', { played: false }, null],
    ['AI fixture', { isPlayer: false }, null],
    ['unknown player', { homeId: 'other' }, null],
    ['both player', { awayId: 'player' }, null],
  ] as const)('awards score and fan growth for %s only when eligible', (_label, changes, result) => {
    const game = oldSave()
    economyOf(game)
    game.season.fixtures = [{ round: 1, homeId: 'player', awayId: 'ai', isPlayer: true, played: true,
      score: { home: 1, away: 0 }, ...changes } as Fixture]
    const [scored, conceded] = result ?? [0, 0]
    const nextFans = result ? fansAfterResult(STARTING_FANS, scored, conceded) : STARTING_FANS
    const expected = projectedRoundIncome({ ...economyOf(game), fans: nextFans }) + scored * GOAL_INCOME_BONUS +
      (result && scored > conceded ? LEAGUE_WIN_BONUS + Math.floor(nextFans * 0.35) : 0)
    expect(awardRoundIncome(game, 1)).toBe(expected)
    expect(economyOf(game).fans).toBe(nextFans)
    expect(economyOf(game).lastFanChange).toBe(nextFans - STARTING_FANS)
    expect(awardRoundIncome(game, 1)).toBe(0)
    expect(economyOf(game).balance).toBe(100000 + expected)
  })

  it('does not pay skipped wins retroactively and rejects overflow atomically', () => {
    const game = oldSave()
    const e = economyOf(game)
    game.season.fixtures = [1, 2].map(round => ({ round, homeId: 'player', awayId: 'ai',
      isPlayer: true, played: true, score: { home: 1, away: 0 } }))
    e.balance = Number.MAX_SAFE_INTEGER - 5000
    expect(awardRoundIncome(game, 2)).toBe(0)
    expect(e.lastIncomeRound).toBe(0)
    expect(e.balance).toBe(Number.MAX_SAFE_INTEGER - 5000)
    expect(e.fans).toBe(STARTING_FANS)
    e.balance = 100000
    const income = awardRoundIncome(game, 2)
    expect(income).toBeGreaterThan(projectedRoundIncome({ ...e, fans: STARTING_FANS }))
    expect(awardRoundIncome(game, 1)).toBe(0)
    expect(e.balance).toBe(100000 + income)
  })

  it('fans and income accelerate with score, while invalid scores never grow fans', () => {
    expect(fansAfterResult(STARTING_FANS, 3, 0)).toBeGreaterThan(fansAfterResult(STARTING_FANS, 1, 0))
    expect(fansAfterResult(STARTING_FANS, 1, 0)).toBeGreaterThan(fansAfterResult(STARTING_FANS, 0, 1))
    expect(fansAfterResult(STARTING_FANS, 100, 0)).toBe(fansAfterResult(STARTING_FANS, 8, 0))
    expect(fansAfterResult(150000, 2, 0)).toBe(150000)
    const game = oldSave()
    const e = economyOf(game)
    // 1 级第 1 阶段只有满额的 1/5，球迷 1200 时收入很低。
    expect(facilityRoundIncome(e, 'stadium')).toBe(240)
    const opening = projectedRoundIncome(e)
    expect(opening).toBe(1500 + STARTING_FANS * 2 + 240 + 144 + 192)
    e.fans = 12000
    expect(facilityRoundIncome(e, 'stadium')).toBe(2400)
    expect(projectedRoundIncome(e)).toBeGreaterThan(opening * 5)
  })

  it('migrates old saves by converting levels into stages', () => {
    const game = oldSave()
    game.season.index = 2
    game.economy = { balance: 455000, stadium: 5, academy: 2, medical: 3, shop: 4, sponsor: 2, lastIncomeRound: 10 } as GameState['economy']
    const e = economyOf(game)
    expect(e.balance).toBe(455000)
    expect(e.lastIncomeRound).toBe(10)
    expect([e.stadium, e.academy, e.medical, e.shop, e.sponsor]).toEqual([25, 10, 15, 20, 10])
    // 商店/赞助商原来的培养加成拆给心理/战术两座新设施。
    expect([e.psychology, e.tactics]).toEqual([20, 10])
    expect(e.fans).toBeGreaterThan(STARTING_FANS)
    expect(facilityLevel(e.medical)).toBe(3)
    expect(economyOf(game)).toBe(e)
  })

  it('v2 存档：商店/赞助商保持收入角色，培养加成转移给心理/战术设施', () => {
    const game = oldSave()
    game.economy = {
      balance: 50000, fans: 3000, stageVersion: 2,
      stadium: 12, academy: 7, medical: 9, shop: 15, sponsor: 22, lastIncomeRound: 4,
    } as GameState['economy']
    const e = economyOf(game)
    expect(e.stageVersion).toBe(3)
    // 原有阶段不动。
    expect([e.stadium, e.academy, e.medical, e.shop, e.sponsor]).toEqual([12, 7, 9, 15, 22])
    // 新设施继承商店/赞助商的阶段，培养加成不倒退。
    expect([e.psychology, e.tactics]).toEqual([15, 22])
    // 商店/赞助商只影响收入。
    expect(facilityRoundIncome(e, 'shop')).toBeGreaterThan(0)
    expect(facilityRoundIncome(e, 'psychology')).toBe(0)
  })

  it('pays income once per increasing completed round', () => {
    const game = oldSave()
    const e = economyOf(game)
    const opening = projectedRoundIncome(e)
    expect(awardRoundIncome(game, 1)).toBe(opening)
    expect(awardRoundIncome(game, 1)).toBe(0)
    expect(awardRoundIncome(game, 0)).toBe(0)
    expect(awardRoundIncome(game, Infinity)).toBe(0)
    e.balance = 240000
    const cost = facilityUpgradeCost('shop', e.shop)!
    expect(upgradeFacility(game, 'shop').ok).toBe(true)
    const afterUpgrade = projectedRoundIncome(e)
    expect(afterUpgrade).toBeGreaterThan(opening)
    expect(awardRoundIncome(game, 2)).toBe(afterUpgrade)
    expect(awardRoundIncome(game, 1)).toBe(0)
    expect(e.lastIncomeRound).toBe(2)
    expect(e.balance).toBe(240000 - cost + afterUpgrade)
  })
})
