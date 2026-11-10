import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { startTraining } from '../src/game/actions.ts'
import { applyCupCeilingReward, cupCeilingBonus, effectiveClubCeilings, ensureCupCeilingClaims, CUP_CEILING_BONUS } from '../src/game/cup-rewards.ts'
import { attrHardLimit, mainAttrsFor } from '../src/game/rating.ts'
import type { TrophyRecord } from '../src/game/types.ts'
import { createPlayerFromSeed, seedById } from '../src/game/data/players.ts'

function mainCeilings(game: ReturnType<typeof createInitialGame>) {
  const bonus = cupCeilingBonus(game)
  return game.roster.map((player) => mainAttrsFor(player.positions.GK > 0).map((key) => effectiveClubCeilings(player, bonus)[key]))
}

describe('杯赛冠军俱乐部上限奖励', () => {
  it('三个杯赛分别 +100/+150/+200，且每个杯赛只发一次', () => {
    const game = createInitialGame(71)
    const before = mainCeilings(game)
    expect(applyCupCeilingReward(game, 'community')).toBe(100)
    expect(applyCupCeilingReward(game, 'league')).toBe(150)
    expect(applyCupCeilingReward(game, 'champions')).toBe(200)
    expect(applyCupCeilingReward(game, 'champions')).toBe(0)
    expect(cupCeilingBonus(game)).toBe(450)
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
    const bonus = cupCeilingBonus(game)
    for (const player of game.roster) for (const key of mainAttrsFor(player.positions.GK > 0)) {
      const effective = effectiveClubCeilings(player, bonus)[key]
      expect(effective).toBeLessThanOrEqual(attrHardLimit(key, player.positions.GK > 0))
      expect(effective).toBe(2000)
    }
  })

  it('之后加入的球员和进行中的培养也实时吃到奖杯加成', () => {
    const game = createInitialGame(74)
    applyCupCeilingReward(game, 'community')
    const player = game.roster.find((item) => item.positions.GK === 0)!
    const before = player.ceilings.passing
    const rookie = structuredClone(player)
    rookie.id = 'rookie'
    game.roster.push(rookie)
    expect(effectiveClubCeilings(rookie, cupCeilingBonus(game)).passing).toBe(before + 100)
    const started = startTraining(game, player.id, 7)
    expect(started.ok, started.error).toBe(true)
    expect(game.training[player.id].cupCeilingBonus).toBe(100)
    applyCupCeilingReward(game, 'league')
    expect(game.training[player.id].cupCeilingBonus).toBe(250)
  })

  it('旧版直接写入个人上限的奖杯加成会迁移成俱乐部实时加成，不会叠加两次', () => {
    const game = createInitialGame(75)
    const player = createPlayerFromSeed(seedById('p001')!)
    game.roster.push(player)
    const before = player.ceilings.passing
    game.pve!.cupCeilingClaims = { league: true }
    game.pve!.cupCeilingVersion = undefined
    game.pve!.trophies = [{ cupId: 'league', cupName: '联盟杯', seasonIndex: 1, wonAt: 1, finalOpponent: 'x', finalScore: { home: 1, away: 0 } }]
    for (const key of mainAttrsFor(player.positions.GK > 0)) player.ceilings[key] = Math.min(2000, player.ceilings[key] + 150)
    expect(ensureCupCeilingClaims(game)).toBe(true)
    expect(player.ceilings.passing).toBe(before)
    expect(effectiveClubCeilings(player, cupCeilingBonus(game)).passing).toBe(before + 150)
    expect(game.pve!.cupCeilingVersion).toBe(3)
    expect(game.pve!.legacyCupCeilings?.[player.id]).toBeTruthy()
  })

  it('preserves newcomers and unknown personal ceilings during legacy migration', () => {
    const game = createInitialGame(76)
    const newcomer = game.roster.find(item => item.positions.GK === 0)!
    const before = structuredClone(newcomer.ceilings)
    const unknown = structuredClone(newcomer)
    unknown.id = 'unknown'
    unknown.seedId = 'unknown'
    unknown.ceilings.passing = 2000
    game.roster.push(unknown)
    game.pve!.cupCeilingVersion = undefined
    game.pve!.cupCeilingClaims = { league: true }
    expect(ensureCupCeilingClaims(game)).toBe(true)
    expect(newcomer.ceilings).toEqual(before)
    expect(effectiveClubCeilings(newcomer, cupCeilingBonus(game)).passing).toBe(Math.min(2000, before.passing + 150))
    expect(unknown.ceilings.passing).toBe(2000)
    const snapshot = structuredClone(game)
    expect(ensureCupCeilingClaims(game)).toBe(false)
    expect(game).toEqual(snapshot)
  })

  it('repairs version 2 deductions while preserving subsequent breakthroughs', () => {
    const game = createInitialGame(77)
    const player = game.roster.find(item => item.positions.GK === 0)!
    expect(startTraining(game, player.id, 7).ok).toBe(true)
    const session = game.training[player.id]
    const original = structuredClone(player.ceilings)
    const beforeTraining = structuredClone(session.candidate.ceilings)
    game.pve!.cupCeilingVersion = 2
    game.pve!.cupCeilingClaims = { league: true }
    game.pve!.legacyCupCeilings = { [player.id]: original, [`training:${player.id}`]: beforeTraining }
    for (const target of [player, session.candidate]) {
      for (const key of mainAttrsFor(false)) target.ceilings[key] -= 150
      target.ceilings.passing += 100
    }
    expect(ensureCupCeilingClaims(game)).toBe(true)
    expect(player.ceilings.passing).toBeCloseTo(original.passing + 100)
    expect(session.candidate.ceilings.passing).toBeCloseTo(beforeTraining.passing + 100)
    expect(player.ceilings.speed).toBeCloseTo(original.speed)
    expect(ensureCupCeilingClaims(game)).toBe(false)
  })

  it('does not refund later trophies as if version 2 had deducted them', () => {
    const game = createInitialGame(78)
    const player = createPlayerFromSeed(seedById('p001')!)
    game.roster.push(player)
    const personal = structuredClone(player.ceilings)
    const backup = structuredClone(player.ceilings)
    for (const key of mainAttrsFor(false)) backup[key] += 150
    game.pve!.cupCeilingVersion = 2
    game.pve!.cupCeilingClaims = { league: true, champions: true }
    game.pve!.legacyCupCeilings = { [player.id]: backup }
    expect(ensureCupCeilingClaims(game)).toBe(true)
    expect(player.ceilings).toEqual(personal)
    expect(cupCeilingBonus(game)).toBe(350)
    expect(effectiveClubCeilings(player, 350).passing).toBe(personal.passing + 350)
    expect(ensureCupCeilingClaims(game)).toBe(false)
  })

  it('旧存档已有奖杯时补发对应俱乐部上限', () => {
    const game = createInitialGame(73)
    game.pve!.trophies = [{ cupId: 'league', cupName: '联盟杯', seasonIndex: 1, wonAt: 1, finalOpponent: 'x', finalScore: { home: 1, away: 0 } } as TrophyRecord]
    const before = game.roster[0].ceilings.passing
    expect(ensureCupCeilingClaims(game)).toBe(true)
    expect(game.roster[0].ceilings.passing).toBe(before)
    expect(effectiveClubCeilings(game.roster[0], cupCeilingBonus(game)).passing).toBe(before + 150)
    expect(game.pve!.cupCeilingClaims?.league).toBe(true)
    expect(ensureCupCeilingClaims(game)).toBe(false)
  })
})
