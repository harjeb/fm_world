import { describe, expect, it } from 'vitest'
import { effectiveAttr } from '../src/game/ca.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { createInitialGame } from '../src/game/state.ts'
import { ALL_ATTRIBUTES, type Attributes } from '../src/game/types.ts'

const flat = Object.fromEntries(ALL_ATTRIBUTES.map((key) => [key, 80])) as Attributes
const at = (stamina: number, key: keyof Attributes) => effectiveAttr(flat, stamina, 100, key, false)

describe('体力越低发挥越差', () => {
  it('体力见底时，速度、加速、灵活、力量掉 75%', () => {
    for (const key of ['speed', 'acceleration', 'agility', 'strength'] as const) expect(at(0, key)).toBeCloseTo(20, 5)
  })

  it('体力见底时，其他属性掉 50%', () => {
    for (const key of ['passing', 'shooting', 'dribbling', 'tackling', 'composure', 'vision', 'reflexes'] as const) expect(at(0, key)).toBeCloseTo(40, 5)
  })

  it('耐力不受影响，否则体力越低消耗越快会滚雪球', () => {
    expect(at(0, 'endurance')).toBeCloseTo(80, 5)
    expect(at(0.5, 'endurance')).toBeCloseTo(80, 5)
  })

  it('按体力比例线性变化，满体力不打折', () => {
    expect(at(1, 'speed')).toBeCloseTo(80, 5)
    expect(at(1, 'passing')).toBeCloseTo(80, 5)
    expect(at(0.5, 'speed')).toBeCloseTo(50, 5)
    expect(at(0.5, 'passing')).toBeCloseTo(60, 5)
    expect(at(0.8, 'speed')).toBeCloseTo(68, 5)
    expect(at(0.8, 'passing')).toBeCloseTo(72, 5)
  })

  it('比赛里的属性真的按体力打折', () => {
    const game = createInitialGame(71)
    const input = teamInputFromLineup(game.roster, game.lineup, { id: 'p', name: 'P', color: '#fff', accent: '#000' })
    const engine = new MatchEngine({ seed: 1, home: input, away: structuredClone(input), knockout: false })
    const player = engine.getTeam('home').players.find((item) => item.position !== 'GK')!
    player.traitId = 'none' as never
    player.stamina = player.maxStamina
    const fresh = { speed: engine.eff(player, 'speed'), passing: engine.eff(player, 'passing') }
    player.stamina = player.maxStamina * 0.5
    expect(engine.eff(player, 'speed') / fresh.speed).toBeCloseTo(0.625, 2)
    expect(engine.eff(player, 'passing') / fresh.passing).toBeCloseTo(0.75, 2)
  })
})
