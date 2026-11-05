import { describe, expect, it } from 'vitest'
import { ATTR_META } from '../src/game/data/attributes.ts'
import { PLAYER_SEEDS, createPlayerFromSeed } from '../src/game/data/players.ts'
import { caOf } from '../src/game/ca.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { ATTRS_VERSION, upgradeBurstAttr, upgradeSharedWorldNames } from '../src/game/names.ts'
import { MAIN_FIELD_ATTRS, MAIN_GK_ATTRS, attrMax, attrRating, isMainAttr } from '../src/game/scale.ts'
import { createInitialGame } from '../src/game/state.ts'
import { trainingOptions } from '../src/game/training-calendar.ts'
import { createWorldGame } from '../src/game/world.ts'
import type { GameState, Player, TrainingSession } from '../src/game/types.ts'

/** 把存档退回爆发还是隐藏属性（0-20）的样子。 */
function toOldScale(player: Player): void {
  if (player.positions.GK > 0) return
  for (const attrs of [player.attrs, player.baseAttrs, player.ceilings]) attrs.acceleration = attrs.acceleration / 75
}

function oldSave(): GameState {
  const game = createWorldGame(31)
  delete game.attrsVersion
  for (const player of [...game.roster, ...game.freeStars, ...(game.reserveStars ?? []), ...game.aiTeams.flatMap((team) => team.players)]) toOldScale(player)
  return game
}

describe('爆发属性', () => {
  it('是外场球员的第 7 项主属性，名字叫爆发；门将还是隐藏属性', () => {
    expect(MAIN_FIELD_ATTRS).toContain('acceleration')
    expect(MAIN_FIELD_ATTRS).toHaveLength(7)
    expect(MAIN_GK_ATTRS).not.toContain('acceleration')
    expect(ATTR_META.acceleration.label).toBe('爆发')
    expect(isMainAttr('acceleration', false)).toBe(true)
    expect(isMainAttr('acceleration', true)).toBe(false)
    expect(attrMax('acceleration', false)).toBe(1500)
    expect(attrMax('acceleration', true)).toBe(20)
  })

  it('真实球星的爆发按打法有差别：跑得快的比站桩的高', () => {
    const value = (enName: string) => createPlayerFromSeed(PLAYER_SEEDS.find((seed) => seed.enName === enName)!).ceilings.acceleration
    expect(value('Kylian Mbappé')).toBeGreaterThan(value('Andrea Pirlo'))
    expect(value('Kylian Mbappé')).toBeGreaterThan(900)
  })

  it('旧存档升级后只换单位，评分不变，门将不动，只升级一次', () => {
    const game = oldSave()
    const player = game.roster.find((item) => item.positions.GK === 0)!
    const keeper = game.roster.find((item) => item.positions.GK > 0)!
    const hidden = player.attrs.acceleration
    const keeperValue = keeper.attrs.acceleration
    expect(hidden).toBeLessThanOrEqual(20)
    expect(upgradeBurstAttr(game)).toBe(true)
    expect(game.attrsVersion).toBe(ATTRS_VERSION)
    expect(player.attrs.acceleration).toBeCloseTo(hidden * 75, 0)
    expect(attrRating('acceleration', player.attrs.acceleration, false)).toBeCloseTo(hidden * 5, 1)
    expect(player.ceilings.acceleration).toBeGreaterThan(20)
    expect(player.baseAttrs.acceleration).toBeGreaterThan(20)
    expect(keeper.attrs.acceleration).toBe(keeperValue)
    const once = player.attrs.acceleration
    expect(upgradeBurstAttr(game)).toBe(false)
    expect(player.attrs.acceleration).toBe(once)
  })

  it('升级前后 CA 基本不变', () => {
    const game = oldSave()
    const player = game.roster.find((item) => item.positions.GK === 0)!
    const fresh = createWorldGame(31).roster.find((item) => item.id === player.id)!
    upgradeBurstAttr(game)
    expect(caOf(player.attrs, false)).toBeCloseTo(caOf(fresh.attrs, false), 0)
  })

  it('培养中的球员和球员卡也一起升级', () => {
    const game = oldSave()
    const player = game.roster.find((item) => item.positions.GK === 0)!
    const candidate = structuredClone(player)
    candidate.attrs.acceleration = 12
    candidate.ceilings.acceleration = 18
    candidate.baseAttrs.acceleration = 10
    game.candidates = { [player.id]: candidate }
    game.cards = [{ id: 'c1', playerId: player.id, attrs: { ...player.attrs, acceleration: 14 }, positions: player.positions } as never]
    upgradeBurstAttr(game)
    expect(candidate.attrs.acceleration).toBe(900)
    expect(candidate.ceilings.acceleration).toBe(1350)
    expect(candidate.baseAttrs.acceleration).toBe(750)
    expect(game.cards![0].attrs.acceleration).toBe(1050)
  })

  it('联机世界的自由和储备球星也升级', () => {
    const star = createPlayerFromSeed(PLAYER_SEEDS.find((seed) => seed.pos !== 'GK')!)
    const before = star.attrs.acceleration
    toOldScale(star)
    expect(upgradeSharedWorldNames({ freeStars: [star], reserveStars: [] })).toBe(true)
    expect(star.attrs.acceleration).toBeCloseTo(before, 0)
    expect(upgradeSharedWorldNames({ freeStars: [star], reserveStars: [] })).toBe(false)
  })

  it('比赛里爆发真的起作用：盘带更容易摆脱，防守方的爆发能抵消', () => {
    const game = createInitialGame(71)
    const input = teamInputFromLineup(game.roster, game.lineup, { id: 'p', name: 'P', color: '#fff', accent: '#000' })
    const engine = new MatchEngine({ seed: 1, home: input, away: structuredClone(input), knockout: false })
    const carrier = engine.getTeam('home').players.find((item) => item.position !== 'GK')!
    const defender = engine.getTeam('away').players.find((item) => item.position !== 'GK')!
    const internals = engine as unknown as { dribbleModel(a: unknown, b: unknown, mark: boolean): { p: number } }
    const dribble = () => internals.dribbleModel(carrier, defender, false).p
    carrier.attrs.acceleration = 30
    defender.attrs.acceleration = 50
    const slow = dribble()
    carrier.attrs.acceleration = 90
    const fast = dribble()
    expect(fast).toBeGreaterThan(slow)
    defender.attrs.acceleration = 90
    expect(dribble()).toBeLessThan(fast)
  })

  it('培养能练到爆发', () => {
    const session = (scheduleSeed: number) => ({ scheduleVersion: 1, completed: false, action: 1, actionsTotal: 30, seed: 5, scheduleSeed }) as unknown as TrainingSession
    const options = Array.from({ length: 60 }, (_, index) => trainingOptions(session(index + 1))).flat()
    const fitness = options.find((option) => option.id === 'fitness')
    expect(fitness?.gains?.acceleration).toBeGreaterThan(0)
    expect(options.find((option) => option.id === 'dribbling')?.gains?.acceleration).toBeGreaterThan(0)
  })
})
