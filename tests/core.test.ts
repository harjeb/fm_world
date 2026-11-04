import { describe, expect, it } from 'vitest'
import { applyGains, caCeilingOf, caOf, effectiveAttr, positionMultiplier } from '../src/game/ca.ts'
import { attrRating, isMainAttr } from '../src/game/scale.ts'
import { PLAYER_SEEDS, createPlayerFromSeed } from '../src/game/data/players.ts'
import { AI_TEAM_DEFS } from '../src/game/data/ai-teams.ts'
import { createRandomPlayer } from '../src/game/data/random-players.ts'
import { POSITIONS } from '../src/game/types.ts'
import { createInitialGame } from '../src/game/state.ts'
import { autoFillLineup, validateLineup } from '../src/game/squad.ts'
import { FORMATION_LIST } from '../src/game/data/formations.ts'
import { EVENT_BY_ID } from '../src/game/data/events.ts'

describe('CA / PA 与初始数据', () => {
  it('CA 公式按外场 18 项、门将 22 项计算', () => {
    const player = createPlayerFromSeed(PLAYER_SEEDS[0])
    const gk = createPlayerFromSeed(PLAYER_SEEDS[21])
    expect(caOf(player.attrs, false)).toBeGreaterThan(0)
    expect(caOf(gk.attrs, true)).toBeGreaterThan(0)
    const maxFor = (gk: boolean) => Object.fromEntries(Object.keys(player.attrs).map((key) => [key, isMainAttr(key as keyof typeof player.attrs, gk) ? 1500 : 20])) as typeof player.attrs
    expect(caOf(maxFor(false), false)).toBeCloseTo(1500, 6)
    expect(caOf(maxFor(true), true)).toBeCloseTo(1500, 6)
  })

  it('初始 CA ≤ PA ≤ 天花板 CA', () => {
    for (const seed of PLAYER_SEEDS) {
      const player = createPlayerFromSeed(seed)
      const gk = seed.pos === 'GK'
      expect(caOf(player.attrs, gk)).toBeLessThanOrEqual(player.pa + 1e-6)
      expect(player.pa).toBeLessThanOrEqual(caCeilingOf(player.ceilings, gk) + 1e-6)
    }
  })

  it('新球员初始 CA 约为 200–300，保留原有潜力和单项上限', () => {
    const stars = PLAYER_SEEDS.map(createPlayerFromSeed)
    const league = createInitialGame(4)
    const random = POSITIONS.flatMap((position) => [1, 2, 3, 4].flatMap((tier) =>
      Array.from({ length: 30 }, (_, seed) => createRandomPlayer({ seed, position, tier }))))
    const players = [...stars, ...league.roster, ...league.aiTeams.flatMap((team) => team.players), ...random]
    for (const player of players) {
      const gk = player.positions.GK > 0
      const ca = caOf(player.attrs, gk)
      expect(ca).toBeGreaterThanOrEqual(200)
      expect(ca).toBeLessThanOrEqual(300)
      expect(ca).toBeLessThanOrEqual(player.pa)
      expect(player.pa).toBeLessThanOrEqual(caCeilingOf(player.ceilings, gk) + 1e-6)
      expect(player.baseAttrs).toEqual(player.attrs)
    }
    const ronaldo = stars.find((player) => player.name === 'C罗')!
    const yamal = stars.find((player) => player.name === '亚马尔')!
    expect(ronaldo.pa).toBe(825.7)
    expect(yamal.pa).toBe(706.7)
    expect(ronaldo.pa - caOf(ronaldo.attrs, false)).toBeGreaterThan(500)
    expect(yamal.pa - caOf(yamal.attrs, false)).toBeGreaterThan(400)
  })

  it('通用旧兼容公式按传入的上限和预算截断', () => {
    const player = createPlayerFromSeed(PLAYER_SEEDS[40])
    const gains = { passing: 20, firstTouch: 20, decisions: 20 }
    const result = applyGains(player.attrs, { ...player.ceilings, passing: player.attrs.passing + 1 }, player.attrs.passing + 1, gains, false)
    expect(result.attrs.passing).toBeLessThanOrEqual(player.ceilings.passing + 1e-9)
    expect(result.cappedByCeiling).toBe(true)
    expect(result.caAfter).toBeLessThanOrEqual(player.pa + 1e-9)
    if (result.cappedByPa) expect(result.scale).toBeLessThan(1)
  })

  it('位置系数只作用一次，0/100 熟练度分别为 0.6/1.0', () => {
    expect(positionMultiplier(0)).toBeCloseTo(0.6)
    expect(positionMultiplier(100)).toBeCloseTo(1)
    expect(positionMultiplier(50)).toBeCloseTo(0.8)
    const player = createPlayerFromSeed(PLAYER_SEEDS[40])
    const ratingAttrs = Object.fromEntries(Object.keys(player.attrs).map((key) => [key, attrRating(key as keyof typeof player.attrs, (player.attrs as Record<string, number>)[key], false)])) as typeof player.attrs
    const full = effectiveAttr(ratingAttrs, 1, 100, 'passing', false)
    const none = effectiveAttr(ratingAttrs, 1, 0, 'passing', false)
    expect(none / full).toBeCloseTo(0.6, 5)
  })

  it('200 名真实球星，20 队每队 18 人，每队 1-3 名真实球星', () => {
    expect(PLAYER_SEEDS).toHaveLength(500)
    expect(new Set(PLAYER_SEEDS.map((seed) => seed.name)).size).toBe(500)
    expect(new Set(PLAYER_SEEDS.map((seed) => seed.enName)).size).toBe(500)
    const game = createInitialGame(1)
    expect(game.roster).toHaveLength(18)
    expect(game.aiTeams).toHaveLength(19)
    expect(game.aiTeams.every((team) => team.players.length === 18)).toBe(true)
    expect(game.aiTeams.every((team) => team.starPlayerIds.length >= 1 && team.starPlayerIds.length <= 3)).toBe(true)
    expect(game.freeStars.length).toBeGreaterThan(0)
    expect(validateLineup(game.roster, game.lineup).valid).toBe(true)
  })

  it('20 支联赛球队有明确强弱档位', () => {
    const game = createInitialGame(3)
    const strengths = [3, ...game.aiTeams.map((team) => team.strength)]
    expect(new Set(strengths).size).toBeGreaterThanOrEqual(3)
    expect(AI_TEAM_DEFS).toHaveLength(20)
  })

  it('随机球员按位置生成，潜力低于世界级', () => {
    const game = createInitialGame(4)
    const random = game.roster.filter((player) => player.id.startsWith('r'))
    expect(random.length).toBeGreaterThan(0)
    expect(random.every((player) => player.pa <= 1500)).toBe(true)
    expect(random.every((player) => player.energy >= 0 && player.energy <= 100)).toBe(true)
  })

  it('三种阵型都能自动生成合法 7+3 阵容', () => {
    const game = createInitialGame(2)
    for (const formation of FORMATION_LIST) {
      const lineup = autoFillLineup(game.roster, formation.id)
      expect(validateLineup(game.roster, lineup).valid).toBe(true)
    }
  })

  it('30 个事件、3 条各 3 段链、4 条主线', () => {
    expect(EVENT_BY_ID.size).toBe(30)
    for (const chain of ['passing', 'defending', 'finishing']) {
      expect([...EVENT_BY_ID.values()].filter((event) => event.chain === chain && event.stage).length).toBe(3)
    }
    expect([...EVENT_BY_ID.values()].filter((event) => event.mainline).length).toBe(4)
  })
})
