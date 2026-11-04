import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { skillTierMultiplier } from '../src/game/match/team.ts'

describe('match skill tiers', () => {
  it('copies tiers without aliasing and defaults legacy states to silver', () => {
    const game = createInitialGame(12)
    const input = teamInputFromLineup(game.roster, game.lineup, { id: 'p', name: 'P', color: '#fff', accent: '#000' })
    const source = input.starters[0].player
    source.skillTiers = { one_touch: 'gold' }
    const engine = new MatchEngine({ seed: 12, home: input, away: input, knockout: false })
    const player = engine.state.teams[0].players[0]
    expect(player.skillTiers?.one_touch).toBe('gold')
    source.skillTiers.one_touch = 'rainbow'
    expect(player.skillTiers?.one_touch).toBe('gold')
    expect(skillTierMultiplier(player, 'one_touch')).toBe(1.2)
    delete player.skillTiers
    expect(skillTierMultiplier(player, 'one_touch')).toBe(1)
    expect(JSON.stringify(engine.snapshot())).not.toContain('injuryProneness')
  })

  it('gives every iron-lung tier progressively lower stamina drain', () => {
    const game = createInitialGame(12)
    const input = teamInputFromLineup(game.roster, game.lineup, { id: 'p', name: 'P', color: '#fff', accent: '#000' })
    const engine = new MatchEngine({ seed: 12, home: input, away: input, knockout: false })
    const [team, opp] = engine.state.teams
    const player = team.players.find((item) => item.position !== 'GK')!
    const state = structuredClone(engine.serialize())
    const drain = (tier?: 'silver' | 'gold' | 'rainbow') => {
      const copy = MatchEngine.restore(structuredClone(state), false)
      const [home, away] = copy.state.teams
      const p = home.players.find((item) => item.id === player.id)!
      p.skills = tier ? ['iron_lung'] : []
      p.skillTiers = tier ? { iron_lung: tier } : {}
      const before = p.stamina
      ;(copy as any).moveAll(home, away, p, { kind: 'dribble', point: { x: p.x + 5, y: p.y } }, 1)
      return before - p.stamina
    }
    const base = drain()
    expect(drain('silver') / base).toBeCloseTo(0.95)
    expect(drain('gold') / base).toBeCloseTo(0.9)
    expect(drain('rainbow') / base).toBeCloseTo(0.85)
  })

  it('gives goalkeepers a working, tiered shot-stopping signature', () => {
    const game = createInitialGame(12)
    const input = teamInputFromLineup(game.roster, game.lineup, { id: 'p', name: 'P', color: '#fff', accent: '#000' })
    const engine = new MatchEngine({ seed: 12, home: input, away: input, knockout: false })
    const [team, opp] = engine.state.teams
    const shooter = team.players.find((player) => player.position !== 'GK')!
    const keeper = opp.players.find((player) => player.position === 'GK')!
    keeper.x = 99
    keeper.y = 32
    const score = () => (engine as any).shotModel(shooter, team, opp, { point: { x: 84, y: 32 }, header: false, penalty: false, freeKick: false }).gkScore as number
    keeper.skills = []
    const base = score()
    keeper.skills = ['gk_reflexes']
    keeper.skillTiers = { gk_reflexes: 'silver' }
    expect(score() - base).toBeCloseTo(5)
    keeper.skillTiers.gk_reflexes = 'rainbow'
    expect(score() - base).toBeCloseTo(7)
  })

  it('scales one-touch preparation time without changing the base action', () => {
    const game = createInitialGame(12)
    const input = teamInputFromLineup(game.roster, game.lineup, { id: 'p', name: 'P', color: '#fff', accent: '#000' })
    const engine = new MatchEngine({ seed: 12, home: input, away: input, knockout: false })
    const [team, opp] = engine.state.teams
    const player = team.players[0]
    player.skills = ['one_touch']
    for (const opponent of opp.players) { opponent.x = 100; opponent.y = 60 }
    player.x = 10; player.y = 10
    engine.state.ball.justReceived = true
    const timing = () => (engine as any).computeTiming(team, opp, player, { kind: 'pass', type: 'short' }).prep as number
    delete player.skillTiers
    const silver = timing()
    player.skillTiers = { one_touch: 'gold' }
    const gold = timing()
    player.skillTiers.one_touch = 'rainbow'
    const rainbow = timing()
    expect(silver - gold).toBeCloseTo(0.2)
    expect(silver - rainbow).toBeCloseTo(0.4)
  })
})
