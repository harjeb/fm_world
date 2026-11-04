import { describe, expect, it } from 'vitest'
import { injuryProneness, injuryRecoveryDays, injuryRisk, personKey } from '../src/game/injury.ts'
import { INJURY_PROFILES } from '../src/game/data/injury-profiles.ts'
import { derivedRng } from '../src/game/rng.ts'
import { createInitialGame } from '../src/game/state.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { MatchEngine } from '../src/game/match/engine.ts'

describe('injury model', () => {
  it('uses researched ratings and a stable randomized fallback', () => {
    expect(Object.keys(INJURY_PROFILES)).toHaveLength(185)
    expect(injuryProneness('p014')).toBe(14)
    const values = new Set(Array.from({ length: 100 }, (_, index) => injuryProneness(`gen-${index}`)))
    expect(values.size).toBeGreaterThan(5)
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(5)
      expect(value).toBeLessThanOrEqual(17)
    }
    expect(injuryProneness('fictional')).toBe(injuryProneness('fictional'))
    expect(injuryProneness('toString')).toBeGreaterThanOrEqual(5)
  })

  it('prevention reduces risk independently of recovery', () => {
    expect(injuryRisk(20, 1, false)).toBeGreaterThan(injuryRisk(1, 1, false))
    expect(injuryRisk(10, 1, false)).toBeGreaterThan(injuryRisk(10, 0, false))
    expect(injuryRisk(10, 0.5, true)).toBeCloseTo(injuryRisk(10, 0.5, false) * 0.7)
    const a = derivedRng(8, 'test'), b = derivedRng(8, 'test')
    for (let i = 0; i < 1000; i++) {
      const normal = injuryRecoveryDays(a, false), resilient = injuryRecoveryDays(b, true)
      expect(resilient).toBe(Math.max(1, Math.ceil(normal * 0.7)))
    }
  })

  it('applies tiered prevention and resilience in the match engine independently', () => {
    const game = createInitialGame(12)
    const input = teamInputFromLineup(game.roster, game.lineup, { id: 'p', name: 'P', color: '#fff', accent: '#000' })
    const engine = new MatchEngine({ seed: 12, home: input, away: input, knockout: false })
    const player = engine.state.teams[0].players[0]
    const risk = injuryRisk(injuryProneness(player.personId ?? player.sourceId), 0, false)
    player.stamina = player.maxStamina
    const counts = (tier?: 'silver' | 'gold' | 'rainbow') => {
      player.skills = tier ? ['injury_prevention'] : []
      player.skillTiers = tier ? { injury_prevention: tier } : {}
      let count = 0
      for (let step = 0; step < 1000; step++) {
        engine.state.step = step
        player.injured = false
        const roll = derivedRng(engine.state.seed, 'injury', step, player.id).float()
        ;(engine as any).maybeInjure(player)
        const multiplier = tier === 'rainbow' ? 1.4 : tier === 'gold' ? 1.2 : tier === 'silver' ? 1 : 0
        expect(!!player.injured).toBe(roll < risk * (1 - 0.3 * multiplier))
        if (player.injured) count++
      }
      return count
    }
    const [base, silver, gold, rainbow] = [counts(), counts('silver'), counts('gold'), counts('rainbow')]
    expect(base).toBeGreaterThan(silver)
    expect(silver).toBeGreaterThanOrEqual(gold)
    expect(gold).toBeGreaterThanOrEqual(rainbow)

    player.skills = ['injury_resilience']
    const rng = () => ({ int: (max: number) => max - 1 })
    const recovery = () => (engine as any).recoveryDays(rng(), player) as number
    player.skillTiers = { injury_resilience: 'silver' }
    expect(recovery()).toBe(42)
    player.skillTiers.injury_resilience = 'gold'
    expect(recovery()).toBe(39)
    player.skillTiers.injury_resilience = 'rainbow'
    expect(recovery()).toBe(35)
    player.skills = ['injury_prevention']
    expect(recovery()).toBe(60)
  })

  it('has a predominantly short distribution with a rare bounded long tail', () => {
    const rng = derivedRng(123, 'distribution')
    const days = Array.from({ length: 10000 }, () => injuryRecoveryDays(rng, false))
    expect(Math.min(...days)).toBe(1)
    expect(Math.max(...days)).toBe(60)
    expect(days.filter(d => d <= 5).length).toBeGreaterThan(6500)
    expect(days.filter(d => d >= 30).length).toBeGreaterThan(100)
    expect(days.filter(d => d >= 30).length).toBeLessThan(500)
  })

  it('carries person ratings into match state and falls back for older states', () => {
    const game = createInitialGame(12)
    const input = teamInputFromLineup(game.roster, game.lineup, { id: 'p', name: 'P', color: '#fff', accent: '#000' })
    const engine = new MatchEngine({ seed: 12, home: input, away: input, knockout: false })
    const starter = input.starters[0].player
    const card = engine.state.teams[0].players[0]
    expect(card.personId).toBe(personKey(starter))
    expect(JSON.stringify(engine.serialize())).not.toContain('injuryProneness')
    const old = structuredClone(engine.serialize())
    old.teams[0].players[0].injuryProneness = 20
    const restored = MatchEngine.restore(old, false)
    expect(() => restored.simulate()).not.toThrow()
  })
})
