import { describe, expect, it } from 'vitest'
import { injuryProneness, injuryRisk } from '../injury.ts'
import { teamInputFromAI, teamInputFromLineup } from '../match/setup.ts'
import type { MatchPlayerState } from '../match/types.ts'
import { derivedRng } from '../rng.ts'
import { createInitialGame } from '../state.ts'
import { PesGame } from './game.ts'
import { DEFAULT_TUNING, PesSettlement, type PesSettlementJSON, type SettlementTuning } from './settle.ts'

const game = createInitialGame(12)
const home = teamInputFromLineup(game.roster, game.lineup, { id: 'player', name: 'P', color: '#fff', accent: '#000' })
const away = teamInputFromAI(game.aiTeams[0])
const init = { seed: 12, home, away, knockout: false, durationSeconds: 900, offside: false }

function injury(settlement: PesSettlement, player: MatchPlayerState) {
  return (settlement as unknown as {
    injury(player: MatchPlayerState, pid: number): { pid: number; days: number }
  }).injury(player, 0)
}

function compareRolls(current: PesSettlement, original: PesSettlement, risk: number, rate: number) {
  let injuries = 0
  for (let step = 0; step < 5000; step++) {
    current.game.step = original.game.step = step
    const player = current.game.teams[0].players[1]
    const roll = derivedRng(init.seed, 'injury', step, player.id).float()
    const result = injury(current, player)
    expect(result.pid === 0).toBe(roll < risk * rate)
    if (result.pid >= 0) {
      injuries++
      // 相同随机抽样命中时，折扣不影响伤期抽样或恢复技能。
      expect(result).toEqual(injury(original, original.game.teams[0].players[1]))
      expect(result.days).toBeGreaterThanOrEqual(1)
      expect(result.days).toBeLessThanOrEqual(60)
    } else {
      expect(result).toEqual({ pid: -1, days: 0 })
    }
  }
  return injuries
}

describe('2D 接触伤病校准', () => {
  it.each([1, 0.3])('剩余体力 %s：伤病概率是原来的 1/4，体质、技能和特性仍生效', (stamina) => {
    expect(DEFAULT_TUNING.injuryRate).toBe(0.25)
    const current = new PesSettlement(init)
    const original = new PesSettlement({ ...init, tuning: { injuryRate: 1 } })
    for (const tier of [undefined, 'silver', 'gold', 'rainbow'] as const) {
      for (const settlement of [current, original]) {
        const player = settlement.game.teams[0].players[1]
        player.stamina = player.maxStamina * stamina
        player.skills = tier ? ['injury_prevention', 'injury_resilience'] : []
        player.skillTiers = tier ? { injury_prevention: tier, injury_resilience: tier } : {}
        player.traitId = tier ? 'star_p036' : 'iron'
      }
      const player = current.game.teams[0].players[1]
      const multiplier = tier === 'rainbow' ? 1.4 : tier === 'gold' ? 1.2 : tier === 'silver' ? 1 : 0
      const risk = injuryRisk(injuryProneness(player.personId ?? player.sourceId), 1 - stamina, false)
        * (1 - 0.3 * multiplier) * (tier ? 0.6 : 1)
      expect(compareRolls(current, original, risk, 0.25)).toBeGreaterThan(0)
    }
  })

  it('自定义 0 系数、禁止伤病及已经受伤时均不再产生伤病', () => {
    for (const options of [{ tuning: { injuryRate: 0 } }, { noInjuries: true }, {}]) {
      const settlement = new PesSettlement({ ...init, ...options })
      const player = settlement.game.teams[0].players[1]
      player.stamina = 0
      if (!('tuning' in options) && !('noInjuries' in options)) player.injured = true
      for (let step = 0; step < 1000; step++) {
        settlement.game.step = step
        expect(injury(settlement, player)).toEqual({ pid: -1, days: 0 })
      }
    }
  })

  it.each([0.25, 0.5, 1])('存档保留自定义伤病系数 %s，恢复后抽样一致', (injuryRate) => {
    const original = new PesSettlement({ ...init, tuning: { injuryRate } })
    const saved = JSON.parse(JSON.stringify(original.toJSON())) as PesSettlementJSON
    const restored = new PesSettlement(saved)
    expect(restored.toJSON()).toEqual(saved)
    expect(restored.toJSON().extra.tuning.injuryRate).toBe(injuryRate)
    const player = restored.game.teams[0].players[1]
    expect(compareRolls(restored, original, restored.settlementKernel.injuryOdds(player).risk, injuryRate)).toBeGreaterThan(0)
  })

  it('没有伤病系数的旧存档维持原概率，不修改传入存档', () => {
    const original = new PesSettlement({ ...init, tuning: { injuryRate: 1 } })
    const saved = original.toJSON()
    delete (saved.extra.tuning as Partial<SettlementTuning>).injuryRate
    const restored = new PesSettlement(saved)
    expect(saved.extra.tuning).not.toHaveProperty('injuryRate')
    expect(restored.toJSON().extra.tuning.injuryRate).toBe(1)
    const player = restored.game.teams[0].players[1]
    const risk = restored.settlementKernel.injuryOdds(player).risk
    expect(compareRolls(restored, original, risk, 1)).toBeGreaterThan(0)
  })

  it('整场中途读档保留新系数；旧比赛继续保留原概率且结果一致', () => {
    for (const legacy of [false, true]) {
      const first = new PesGame(init)
      first.advance(300)
      const saved = JSON.parse(JSON.stringify(first.serialize()))
      if (legacy) delete saved.contact.extra.tuning.injuryRate
      const uninterrupted = legacy ? PesGame.restore(saved) : first
      const resumed = PesGame.restore(saved)
      expect(resumed.settlement.toJSON().extra.tuning.injuryRate).toBe(legacy ? 1 : 0.25)
      uninterrupted.run()
      resumed.run()
      expect(resumed.state.finished).toBe(true)
      expect(resumed.state.clock).toBe(900)
      expect(resumed.serialize()).toEqual(uninterrupted.serialize())
    }
  })
})
