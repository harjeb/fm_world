import { describe, expect, it } from 'vitest'
import { agentView } from '../server/agent.ts'
import { ATTR_META } from '../src/game/data/attributes.ts'
import { PLAYER_SEEDS, createPlayerFromSeed } from '../src/game/data/players.ts'
import { createRandomPlayer } from '../src/game/data/random-players.ts'
import { traitEffectText } from '../src/game/data/skill-effects.ts'
import { TRAITS } from '../src/game/data/skills.ts'
import { STAR_TRAITS } from '../src/game/data/star-traits.generated.ts'
import { TRAIT_CONDITION_TEXT, starTraitId, starTraitOf, starTraitText, traitNameOf, type StarEffect, type StarTrait, type TraitCondition } from '../src/game/data/star-traits.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { skillTierMultiplier } from '../src/game/match/team.ts'
import type { MatchPlayerState, MatchTeamInput } from '../src/game/match/types.ts'
import { upgradeSharedWorldNames, upgradeStarTraits } from '../src/game/names.ts'
import { MAIN_FIELD_ATTRS, MAIN_GK_ATTRS } from '../src/game/scale.ts'
import { createInitialGame } from '../src/game/state.ts'
import { createWorldGame } from '../src/game/world.ts'
import type { Player, TraitId } from '../src/game/types.ts'

type Internals = {
  shotModel(shooter: MatchPlayerState, team: unknown, opp: unknown, opts: { point: { x: number; y: number }; header: boolean; penalty: boolean; freeKick: boolean }): { onTarget: number; goalGivenOnTarget: number; chance: { type: string } }
  dribbleModel(carrier: MatchPlayerState, defender: MatchPlayerState, mark: boolean): { p: number }
  passTraitDelta(carrier: MatchPlayerState, interceptor: MatchPlayerState | null, type: string, pressure: number, dist?: number, freeKick?: boolean): number
  shotScopeMatches(scope: string, chance: { type: string; blockers?: number }, inBox: boolean, opts: { header: boolean; penalty: boolean; freeKick: boolean }): boolean
  book(team: unknown, player: MatchPlayerState): string | null
  maybeInjure(player: MatchPlayerState): void
  traitRoll(player: MatchPlayerState, purpose: string, chance: number): boolean
  startShootout(): void
  advanceShootout(): void
}
const internals = (engine: MatchEngine) => engine as unknown as Internals

function inputs(seed = 71): { home: MatchTeamInput; away: MatchTeamInput } {
  const game = createInitialGame(seed)
  const input = teamInputFromLineup(game.roster, game.lineup, { id: 'p', name: 'P', color: '#fff', accent: '#000' })
  return { home: input, away: structuredClone(input) }
}

function engineFor(seed = 1): MatchEngine {
  return new MatchEngine({ seed, ...inputs(), knockout: false })
}

const fieldPlayers = (engine: MatchEngine, side: 'home' | 'away' = 'home') => engine.getTeam(side).players.filter((item) => item.position !== 'GK')
const keeperOf = (engine: MatchEngine, side: 'home' | 'away' = 'away') => engine.getTeam(side).players.find((item) => item.position === 'GK')!

/** 给球员临时装上一个特性；清掉其他人的特性，免得互相干扰。 */
function withTrait<T>(engine: MatchEngine, player: MatchPlayerState, effect: StarEffect, run: () => T, when: TraitCondition = 'any'): T {
  STAR_TRAITS.star_test = { name: 'x', when, ...effect }
  const before = player.traitId
  player.traitId = 'star_test'
  engine.state.step += 1 // 光环按步缓存
  const result = run()
  player.traitId = before
  delete STAR_TRAITS.star_test
  engine.state.step += 1
  return result
}

function neutralize(engine: MatchEngine): void {
  for (const team of engine.state.teams) {
    for (const player of [...team.players, ...team.bench]) {
      player.traitId = 'none' as TraitId
      player.skills = []
      player.stamina = player.maxStamina * 0.6
      player.positions[player.position] = 100
      for (const key of Object.keys(player.attrs) as (keyof typeof player.attrs)[]) player.attrs[key] = 40
    }
  }
}

const attrTrait = (attr: 'tackling' | 'shooting' | 'passing' | 'strength', chance = 100, bonus = 90): StarEffect => ({ kind: 'attr', attr, chance, bonus })

describe('球星专属特性数据', () => {
  const all = () => PLAYER_SEEDS.map((seed) => STAR_TRAITS[starTraitId(seed.id)])

  it('500 名球星每人一个，id、名字和效果都不重复', () => {
    expect(PLAYER_SEEDS).toHaveLength(500)
    expect(all().every(Boolean)).toBe(true)
    expect(Object.keys(STAR_TRAITS)).toHaveLength(500)
    expect(new Set(all().map((trait) => trait.name)).size).toBe(500)
    expect(new Set(all().map(({ name: _name, ...effect }) => JSON.stringify(effect))).size).toBe(500)
  })

  it('不只有加属性：效果类型至少 16 种，加属性不超过一半', () => {
    const kinds = new Map<string, number>()
    for (const trait of all()) kinds.set(trait.kind, (kinds.get(trait.kind) ?? 0) + 1)
    expect(kinds.size).toBeGreaterThanOrEqual(17)
    expect(kinds.get('attr')!).toBeLessThan(250)
    expect(all().some((trait) => trait.kind === 'shot' && trait.scope === 'oneOnOne')).toBe(true)
  })

  it('名字没有重复的词', () => {
    for (const trait of all()) {
      for (const word of ['长传', '任意球', '传中', '门前', '禁区', '单刀', '后场']) {
        expect(trait.name.split(word).length - 1, trait.name).toBeLessThanOrEqual(1)
      }
    }
  })

  it('名字是中文，不和通用特性重名；数值都在合理范围内', () => {
    const generic = new Set(Object.values(TRAITS).map((trait) => trait.name))
    for (const seed of PLAYER_SEEDS) {
      const trait = STAR_TRAITS[starTraitId(seed.id)]
      const where = `${seed.name} ${JSON.stringify(trait)}`
      expect(generic.has(trait.name), where).toBe(false)
      expect(trait.name, where).toMatch(/^[一-龥]+$/)
      expect(TRAIT_CONDITION_TEXT[trait.when], where).toBeTruthy()
      if (trait.kind === 'attr') {
        const main: readonly string[] = seed.pos === 'GK' ? MAIN_GK_ATTRS : MAIN_FIELD_ATTRS
        expect(main.includes(trait.attr), where).toBe(true)
        expect(trait.chance, where).toBeGreaterThanOrEqual(5)
        expect(trait.chance, where).toBeLessThanOrEqual(100)
        expect(trait.bonus, where).toBeGreaterThanOrEqual(30)
        expect(trait.bonus, where).toBeLessThanOrEqual(700)
      }
      if (trait.kind === 'shot') {
        expect(trait.onTarget, where).toBeLessThanOrEqual(20)
        expect(trait.goal, where).toBeLessThanOrEqual(20)
        // 点球一个赛季也碰不到一次。
        expect(trait.scope, where).not.toBe('penalty')
      }
      if (trait.kind === 'pass') {
        expect(trait.success, where).toBeLessThanOrEqual(15)
        if (trait.scope === 'cross') expect(seed.pos, where).toBe('W')
      }
      if (trait.kind === 'dribble') expect(trait.success, where).toBeLessThanOrEqual(18)
      if (trait.kind === 'defend') expect(trait.success, where).toBeLessThanOrEqual(12)
      if (trait.kind === 'save') {
        expect(seed.pos, where).toBe('GK')
        expect(trait.goal, where).toBeLessThanOrEqual(14)
        expect(trait.scope, where).not.toBe('penalty')
      }
      if (trait.kind === 'aura' || trait.kind === 'intimidate') expect(trait.bonus, where).toBeLessThanOrEqual(100)
      if (trait.kind === 'shot' && trait.scope === 'oneOnOne') expect(['ST', 'W'], where).toContain(seed.pos)
      // 碰不到的条件不能配给这个位置。
      expect(trait.when, where).not.toBe('crossing')
      if (trait.when === 'wide') expect(seed.pos, where).toBe('W')
      if (trait.when === 'attackingThird') expect(['W', 'ST'], where).toContain(seed.pos)
      if (seed.pos === 'GK') expect(['tired', 'fresh', 'ownHalf'], where).not.toContain(trait.when)
      if (trait.kind === 'injury') expect(trait.risk, where).toBeLessThanOrEqual(80)
      if (trait.kind === 'card') expect(trait.risk, where).toBeLessThanOrEqual(90)
      if (trait.kind === 'stamina') expect(trait.drain, where).toBeLessThanOrEqual(45)
      // 大牌球星总是首发，不能拿“替补上场后”这种等于没有的特性。
      if (seed.tier > 3) expect(trait.when, where).not.toBe('subbedOn')
    }
  })

  it('引擎不判断条件的效果，when 只能是 any，否则说明文字和实际效果对不上', () => {
    const unconditional = new Set(['goalRecover', 'secondWind', 'hotStreak', 'injury', 'card', 'skillBoost', 'onside'])
    for (const trait of all()) if (unconditional.has(trait.kind)) expect(trait.when, JSON.stringify(trait)).toBe('any')
  })

  it('每场只碰到一两次的场景，不配少见的条件', () => {
    const common = ['any', 'home', 'away', 'secondHalf']
    for (const trait of all()) {
      const rareShot = (trait.kind === 'shot' || trait.kind === 'save') && ['freeKick', 'header', 'oneOnOne'].includes(trait.scope)
      const rarePass = trait.kind === 'pass' && ['freeKick', 'long'].includes(trait.scope)
      if (rareShot || rarePass) expect(common, JSON.stringify(trait)).toContain(trait.when)
    }
  })

  it('情境类条件只配引擎会传这个情境的属性', () => {
    for (const trait of all()) {
      if (trait.when === 'inBox') expect(trait.kind === 'attr' && trait.attr).toBe('shooting')
      if (trait.when === 'crossing') expect(trait.kind === 'attr' && trait.attr).toBe('passing')
      if (trait.when === 'aerial') expect(['strength', 'rushing']).toContain(trait.kind === 'attr' && trait.attr)
    }
  })

  it('加属性时，同星级的外场球员、同样没有条件，概率低的一次加得多', () => {
    for (const tier of [3, 4, 5]) {
      const attrs = PLAYER_SEEDS.filter((seed) => seed.tier === tier && seed.pos !== 'GK')
        .flatMap((seed) => {
          const trait = STAR_TRAITS[starTraitId(seed.id)]
          return trait.kind === 'attr' && trait.when === 'any' ? [trait] : []
        })
        .sort((a, b) => a.chance - b.chance)
      expect(attrs.length).toBeGreaterThan(3)
      for (let index = 1; index < attrs.length; index++) expect(attrs[index].bonus).toBeLessThanOrEqual(attrs[index - 1].bonus)
      expect(attrs.at(-1)!.bonus).toBeLessThan(attrs[0].bonus)
    }
  })

  it('彩票型只配“任何时候”；条件少见时概率不能太低，否则一场也触发不了几次', () => {
    const attrs = all().flatMap((trait) => (trait.kind === 'attr' ? [trait] : []))
    expect(attrs.some((trait) => trait.chance <= 10)).toBe(true)
    for (const trait of attrs) {
      if (trait.chance < 15) expect(trait.when, JSON.stringify(trait)).toBe('any')
      if (trait.when === 'late' || trait.when === 'early') expect(trait.chance, JSON.stringify(trait)).toBeGreaterThanOrEqual(90)
      if (trait.when === 'behind' || trait.when === 'ahead') expect(trait.chance, JSON.stringify(trait)).toBeGreaterThanOrEqual(50)
    }
  })

  it('星级越高，平均来说特性越强', () => {
    const byTier = (value: (trait: StarTrait) => number | null) => [3, 4, 5].map((tier) => {
      const values = PLAYER_SEEDS.filter((seed) => seed.tier === tier).flatMap((seed) => {
        const result = value(STAR_TRAITS[starTraitId(seed.id)])
        return result === null ? [] : [result]
      })
      return values.reduce((sum, item) => sum + item, 0) / values.length
    })
    const ascending = ([low, middle, high]: number[]) => {
      expect(middle).toBeGreaterThan(low)
      expect(high).toBeGreaterThan(middle)
    }
    ascending(byTier((trait) => (trait.kind === 'attr' ? (trait.chance * trait.bonus) / 100 : null)))
    ascending(byTier((trait) => (trait.kind === 'skillBoost' ? trait.pct : null)))
    ascending(byTier((trait) => (trait.kind === 'defend' ? trait.success : null)))
    ascending(byTier((trait) => (trait.kind === 'injury' ? trait.risk : null)))
  })

  it('真实球星拿专属特性，随机球员还是 20 个通用特性', () => {
    for (const seed of PLAYER_SEEDS.slice(0, 40)) expect(createPlayerFromSeed(seed).traitId).toBe(`star_${seed.id}`)
    for (let index = 0; index < 40; index++) {
      const player = createRandomPlayer({ seed: 300 + index, position: 'W', tier: 2 })
      expect(Object.hasOwn(TRAITS, player.traitId), player.traitId).toBe(true)
    }
  })

  it('每种效果都有说明文字', () => {
    const text = (trait: StarEffect & { when: TraitCondition }) => starTraitText({ name: 'x', ...trait })
    expect(text({ when: 'late', kind: 'attr', attr: 'shooting', chance: 5, bonus: 300 })).toBe('最后 15 分钟，每次动作 5% 概率 射术 +300。')
    expect(text({ when: 'any', kind: 'attr', attr: 'tackling', chance: 100, bonus: 90 })).toBe('抢断 +90。')
    expect(text({ when: 'any', kind: 'shot', scope: 'oneOnOne', onTarget: 5, goal: 3 })).toBe('单刀面对门将时射正率 +5%，进球率 +3%。')
    expect(text({ when: 'behind', kind: 'pass', scope: 'through', success: 4 })).toBe('比分落后时，直塞成功率 +4%。')
    expect(text({ when: 'any', kind: 'dribble', success: 4 })).toBe('盘带成功率 +4%。')
    expect(text({ when: 'any', kind: 'defend', success: 3 })).toBe('他上前防守时，对手传球和盘带成功率 -3%。')
    expect(text({ when: 'any', kind: 'save', scope: 'penalty', goal: 6 })).toBe('面对点球时（含点球大战）对手进球率 -6%。')
    expect(text({ when: 'any', kind: 'stamina', drain: 12 })).toBe('跑动时的体力消耗 -12%。')
    expect(text({ when: 'any', kind: 'goalRecover', stamina: 20 })).toBe('每进 1 球恢复 20% 体力。')
    expect(text({ when: 'any', kind: 'secondWind', stamina: 25 })).toBe('体力第一次跌破 60% 时恢复 25% 体力，每场一次。')
    expect(text({ when: 'any', kind: 'pass', scope: 'cross', success: 6 })).toBe('边路传球和传中成功率 +6%。')
    expect(text({ when: 'any', kind: 'pass', scope: 'long', success: 6 })).toBe('25 米以上的长传成功率 +6%。')
    expect(text({ when: 'any', kind: 'pass', scope: 'freeKick', success: 9 })).toBe('任意球传中成功率 +9%。')
    expect(text({ when: 'any', kind: 'shot', scope: 'freeKick', onTarget: 12, goal: 8 })).toBe('直接任意球时射正率 +12%，进球率 +8%。')
    expect(text({ when: 'any', kind: 'save', scope: 'freeKick', goal: 9 })).toBe('面对任意球时对手进球率 -9%。')
    expect(text({ when: 'any', kind: 'drawFoul', pct: 60 })).toBe('被贴身防守时，造犯规的概率 +60%。')
    expect(text({ when: 'any', kind: 'hotStreak', bonus: 60 })).toBe('本场每进 1 球，射术 +60，可以叠加。')
    expect(text({ when: 'any', kind: 'aura', attr: 'passing', bonus: 30 })).toBe('在场时全队传球 +30。')
    expect(text({ when: 'any', kind: 'intimidate', attr: 'shooting', bonus: 30 })).toBe('在场时对手全队射术 -30。')
    expect(text({ when: 'any', kind: 'injury', risk: 40 })).toBe('比赛中的受伤风险 -40%。')
    expect(text({ when: 'any', kind: 'card', risk: 50 })).toBe('犯规时吃牌的概率 -50%。')
    expect(text({ when: 'any', kind: 'skillBoost', pct: 20 })).toBe('自己所有技能的效果 +20%。')
    // 带条件时不重复“……时”。
    expect(text({ when: 'behind', kind: 'shot', scope: 'any', onTarget: 6, goal: 2 })).toBe('比分落后时，射正率 +6%，进球率 +2%。')
    expect(text({ when: 'home', kind: 'save', scope: 'any', goal: 2 })).toBe('主场，对手进球率 -2%。')
    expect(text({ when: 'level', kind: 'aura', attr: 'passing', bonus: 50 })).toBe('比分打平时，他在场则全队传球 +50。')
    expect(text({ when: 'late', kind: 'intimidate', attr: 'shooting', bonus: 55 })).toBe('最后 15 分钟，他在场则对手全队射术 -55。')
    expect(text({ when: 'any', kind: 'onside', chance: 25 })).toBe('本该越位的直塞，有 25% 概率不被吹罚。')
    const id = starTraitId(PLAYER_SEEDS[0].id)
    expect(traitNameOf(id)).toBe(starTraitOf(id)!.name)
    expect(traitEffectText(id)).toBe(starTraitText(starTraitOf(id)!))
    expect(traitNameOf('cold_blood')).toBe(TRAITS.cold_blood.name)
    expect(ATTR_META.shooting.label).toBe('射术')
  })
})

describe('比赛里的条件', () => {
  /** 这个条件下，100% 特性有没有生效。 */
  function active(engine: MatchEngine, player: MatchPlayerState, when: TraitCondition, ctx = {}, attr: 'tackling' | 'shooting' | 'passing' | 'strength' = 'tackling'): boolean {
    player.traitId = 'none' as TraitId
    const plain = engine.eff(player, attr, ctx)
    const boosted = withTrait(engine, player, attrTrait(attr), () => engine.eff(player, attr, ctx), when)
    return boosted > plain
  }

  it('时间：开场、下半场、最后 15 分钟', () => {
    const engine = engineFor()
    neutralize(engine)
    const player = fieldPlayers(engine)[0]
    const at = (minute: number) => { engine.state.clock = (minute / 90) * engine.state.durationSeconds }
    at(10)
    expect([active(engine, player, 'early'), active(engine, player, 'secondHalf'), active(engine, player, 'late')]).toEqual([true, false, false])
    at(50)
    expect([active(engine, player, 'early'), active(engine, player, 'secondHalf'), active(engine, player, 'late')]).toEqual([false, true, false])
    at(80)
    expect([active(engine, player, 'early'), active(engine, player, 'secondHalf'), active(engine, player, 'late')]).toEqual([false, true, true])
  })

  it('比分按球员自己一方算', () => {
    const engine = engineFor()
    neutralize(engine)
    const home = fieldPlayers(engine)[0]
    const away = fieldPlayers(engine, 'away')[0]
    engine.state.score = { home: 0, away: 1 }
    expect([active(engine, home, 'behind'), active(engine, home, 'ahead'), active(engine, home, 'level')]).toEqual([true, false, false])
    expect([active(engine, away, 'behind'), active(engine, away, 'ahead')]).toEqual([false, true])
    engine.state.score = { home: 2, away: 2 }
    expect(active(engine, home, 'level')).toBe(true)
  })

  it('体力、主客场、替补上场', () => {
    const engine = engineFor()
    neutralize(engine)
    const home = fieldPlayers(engine)[0]
    const away = fieldPlayers(engine, 'away')[0]
    home.stamina = home.maxStamina * 0.65
    expect([active(engine, home, 'tired'), active(engine, home, 'fresh')]).toEqual([true, false])
    home.stamina = home.maxStamina * 0.75
    expect([active(engine, home, 'tired'), active(engine, home, 'fresh')]).toEqual([false, false])
    home.stamina = home.maxStamina * 0.95
    expect([active(engine, home, 'tired'), active(engine, home, 'fresh')]).toEqual([false, true])
    expect([active(engine, home, 'home'), active(engine, home, 'away')]).toEqual([true, false])
    expect([active(engine, away, 'home'), active(engine, away, 'away')]).toEqual([false, true])
    expect(active(engine, home, 'subbedOn')).toBe(false)
    const incoming = engine.getTeam('home').bench[0]
    expect(engine.substitute(home.id, incoming.id).ok).toBe(true)
    const onPitch = engine.getTeam('home').players.find((item) => item.id === incoming.id)!
    expect(onPitch.subbedOn).toBe(true)
    expect(active(engine, onPitch, 'subbedOn')).toBe(true)
  })

  it('位置：边路、前场、本方半场，方向跟着球员所在一方', () => {
    const engine = engineFor()
    neutralize(engine)
    const home = fieldPlayers(engine)[0]
    const away = fieldPlayers(engine, 'away')[0]
    home.x = 90
    home.y = 2
    expect([active(engine, home, 'wide'), active(engine, home, 'attackingThird'), active(engine, home, 'ownHalf')]).toEqual([true, true, false])
    home.x = 10
    home.y = 32
    expect([active(engine, home, 'wide'), active(engine, home, 'attackingThird'), active(engine, home, 'ownHalf')]).toEqual([false, false, true])
    away.x = 90
    expect([active(engine, away, 'ownHalf'), active(engine, away, 'attackingThird')]).toEqual([true, false])
  })

  it('情境：禁区内射门、传中、争顶', () => {
    const engine = engineFor()
    neutralize(engine)
    const player = fieldPlayers(engine)[0]
    expect(active(engine, player, 'inBox', { inBox: true }, 'shooting')).toBe(true)
    expect(active(engine, player, 'inBox', { inBox: false }, 'shooting')).toBe(false)
    expect(active(engine, player, 'crossing', { crossing: true }, 'passing')).toBe(true)
    expect(active(engine, player, 'crossing', { crossing: false }, 'passing')).toBe(false)
    expect(active(engine, player, 'aerial', { aerial: true }, 'strength')).toBe(true)
    expect(active(engine, player, 'aerial', {}, 'strength')).toBe(false)
  })
})

describe('比赛里的效果', () => {
  it('加属性：100% 的加成是面板数值 ÷ 15，只加指定的属性', () => {
    const engine = engineFor()
    neutralize(engine)
    const player = fieldPlayers(engine)[0]
    const plainTackling = engine.eff(player, 'tackling')
    const plainPassing = engine.eff(player, 'passing')
    withTrait(engine, player, attrTrait('tackling'), () => {
      expect(engine.eff(player, 'tackling') - plainTackling).toBeCloseTo(6, 5)
      expect(engine.eff(player, 'passing')).toBe(plainPassing)
    })
  })

  it('概率按每一步判定：频率接近标称值，同一步多次读取一致，不同球员互相独立', () => {
    const engine = engineFor()
    neutralize(engine)
    const [a, b] = fieldPlayers(engine)
    const roll = internals(engine)
    let hits = 0
    let different = 0
    const total = 3000
    for (let step = 1; step <= total; step++) {
      engine.state.step = step
      const first = roll.traitRoll(a, 'attr', 20)
      expect(roll.traitRoll(a, 'attr', 20)).toBe(first)
      if (first) hits++
      if (first !== roll.traitRoll(b, 'attr', 20)) different++
    }
    expect(hits / total).toBeGreaterThan(0.17)
    expect(hits / total).toBeLessThan(0.23)
    expect(different / total).toBeGreaterThan(0.2)
    expect(roll.traitRoll(a, 'attr', 100)).toBe(true)
  })

  it('射门：范围对上才加，单刀时射正率和进球率都涨', () => {
    const engine = engineFor()
    neutralize(engine)
    const shooter = fieldPlayers(engine)[0]
    const home = engine.getTeam('home')
    const away = engine.getTeam('away')
    const opts = { point: { x: 80, y: 32 }, header: false, penalty: false, freeKick: false }
    const model = () => internals(engine).shotModel(shooter, home, away, opts)
    const plain = model()
    const boosted = withTrait(engine, shooter, { kind: 'shot', scope: 'any', onTarget: 5, goal: 3 }, model)
    expect(boosted.onTarget - plain.onTarget).toBeCloseTo(0.05, 5)
    expect(boosted.goalGivenOnTarget - plain.goalGivenOnTarget).toBeCloseTo(0.03, 5)
    const wrongScope = withTrait(engine, shooter, { kind: 'shot', scope: 'header', onTarget: 5, goal: 3 }, model)
    expect(wrongScope.onTarget).toBe(plain.onTarget)
    const scope = internals(engine).shotScopeMatches.bind(engine)
    const open = { header: false, penalty: false, freeKick: false }
    // 单刀：射门路线上没有防守球员，只剩门将；不只是 clear_chance。
    expect(scope('oneOnOne', { type: 'clear_chance', blockers: 0 }, true, open)).toBe(true)
    expect(scope('oneOnOne', { type: 'normal', blockers: 0 }, true, open)).toBe(true)
    expect(scope('oneOnOne', { type: 'normal', blockers: 1 }, true, open)).toBe(false)
    expect(scope('oneOnOne', { type: 'header', blockers: 0 }, true, { ...open, header: true })).toBe(false)
    expect(scope('inBox', { type: 'normal' }, true, open)).toBe(true)
    expect(scope('longRange', { type: 'normal' }, false, open)).toBe(true)
    expect(scope('longRange', { type: 'free_kick' }, false, { ...open, freeKick: true })).toBe(false)
    expect(scope('header', { type: 'header' }, true, { ...open, header: true })).toBe(true)
    expect(scope('freeKick', { type: 'free_kick' }, false, { ...open, freeKick: true })).toBe(true)
    expect(scope('penalty', { type: 'penalty' }, true, { ...open, penalty: true })).toBe(true)
    expect(scope('inBox', { type: 'penalty' }, true, { ...open, penalty: true })).toBe(false)
  })

  it('门将：对手进球率下降', () => {
    const engine = engineFor()
    neutralize(engine)
    const shooter = fieldPlayers(engine)[0]
    // 开场时门将站在离球门 10.1 米的地方，算失位，这里放回球门前。
    keeperOf(engine).x = 96
    const opts = { point: { x: 80, y: 32 }, header: false, penalty: false, freeKick: false }
    const model = () => internals(engine).shotModel(shooter, engine.getTeam('home'), engine.getTeam('away'), opts)
    const plain = model()
    const saved = withTrait(engine, keeperOf(engine), { kind: 'save', scope: 'any', goal: 4 }, model)
    expect(plain.goalGivenOnTarget - saved.goalGivenOnTarget).toBeCloseTo(0.04, 5)
  })

  it('门将失位时特性不生效，不能隔空扑救', () => {
    const engine = engineFor()
    neutralize(engine)
    const shooter = fieldPlayers(engine)[0]
    const keeper = keeperOf(engine)
    keeper.x = 50
    keeper.y = 32
    const opts = { point: { x: 92, y: 32 }, header: false, penalty: false, freeKick: false }
    const model = () => internals(engine).shotModel(shooter, engine.getTeam('home'), engine.getTeam('away'), opts)
    const plain = model()
    expect(withTrait(engine, keeper, { kind: 'save', scope: 'any', goal: 10 }, model).goalGivenOnTarget).toBe(plain.goalGivenOnTarget)
  })

  it('传球：传球人加成看范围，防守人减成', () => {
    const engine = engineFor()
    neutralize(engine)
    const [passer, ] = fieldPlayers(engine)
    const defender = fieldPlayers(engine, 'away')[0]
    const delta = internals(engine).passTraitDelta.bind(engine)
    expect(delta(passer, defender, 'through', 0)).toBe(0)
    withTrait(engine, passer, { kind: 'pass', scope: 'through', success: 5 }, () => {
      expect(delta(passer, defender, 'through', 0)).toBeCloseTo(0.05, 5)
      expect(delta(passer, defender, 'short', 0)).toBe(0)
    })
    withTrait(engine, passer, { kind: 'pass', scope: 'pressured', success: 5 }, () => {
      expect(delta(passer, defender, 'short', 3)).toBeCloseTo(0.05, 5)
      expect(delta(passer, defender, 'short', 1)).toBe(0)
    })
    withTrait(engine, defender, { kind: 'defend', success: 3 }, () => {
      expect(delta(passer, defender, 'short', 0)).toBeCloseTo(-0.03, 5)
      expect(delta(passer, null, 'short', 0)).toBe(0)
    })
    withTrait(engine, passer, { kind: 'pass', scope: 'long', success: 6 }, () => {
      expect(delta(passer, null, 'short', 0, 10)).toBe(0)
      expect(delta(passer, null, 'short', 0, 25)).toBeCloseTo(0.06, 5)
      expect(delta(passer, null, 'through', 0, 40)).toBeCloseTo(0.06, 5)
      expect(delta(passer, null, 'long', 0, 10)).toBeCloseTo(0.06, 5)
    })
    withTrait(engine, passer, { kind: 'pass', scope: 'freeKick', success: 9 }, () => {
      expect(delta(passer, null, 'cross', 0, 30)).toBe(0)
      expect(delta(passer, null, 'cross', 0, 30, true)).toBeCloseTo(0.09, 5)
    })
    withTrait(engine, passer, { kind: 'pass', scope: 'cross', success: 6 }, () => {
      passer.y = 32
      expect(delta(passer, null, 'short', 0)).toBe(0)
      expect(delta(passer, null, 'cross', 0)).toBeCloseTo(0.06, 5)
      passer.y = 5
      expect(delta(passer, null, 'short', 0)).toBeCloseTo(0.06, 5)
    })
  })

  it('盘带：进攻方加，防守方减', () => {
    const engine = engineFor()
    neutralize(engine)
    const carrier = fieldPlayers(engine)[0]
    const defender = fieldPlayers(engine, 'away')[0]
    const model = () => internals(engine).dribbleModel(carrier, defender, false).p
    const plain = model()
    expect(withTrait(engine, carrier, { kind: 'dribble', success: 5 }, model) - plain).toBeCloseTo(0.05, 5)
    expect(withTrait(engine, defender, { kind: 'defend', success: 4 }, model) - plain).toBeCloseTo(-0.04, 5)
  })

  it('越进越猛：本场每进 1 球射术叠加', () => {
    const engine = engineFor()
    neutralize(engine)
    const player = fieldPlayers(engine)[0]
    const plain = engine.eff(player, 'shooting')
    withTrait(engine, player, { kind: 'hotStreak', bonus: 60 }, () => {
      expect(engine.eff(player, 'shooting')).toBeCloseTo(plain, 5)
      player.stats.goals = 2
      expect(engine.eff(player, 'shooting') - plain).toBeCloseTo(8, 5)
      expect(engine.eff(player, 'passing')).toBe(engine.eff(player, 'tackling'))
    })
  })

  it('光环加全队，威慑减对手全队；下场后失效', () => {
    const engine = engineFor()
    neutralize(engine)
    const [carrier, mate] = fieldPlayers(engine)
    const rival = fieldPlayers(engine, 'away')[0]
    const baseMate = engine.eff(mate, 'passing')
    const baseRival = engine.eff(rival, 'passing')
    withTrait(engine, carrier, { kind: 'aura', attr: 'passing', bonus: 30 }, () => {
      expect(engine.eff(mate, 'passing') - baseMate).toBeCloseTo(2, 5)
      expect(engine.eff(carrier, 'passing') - baseMate).toBeCloseTo(2, 5)
      expect(engine.eff(rival, 'passing')).toBeCloseTo(baseRival, 5)
      carrier.onPitch = false
      engine.state.step += 1
      expect(engine.eff(mate, 'passing')).toBeCloseTo(baseMate, 5)
      carrier.onPitch = true
    })
    withTrait(engine, carrier, { kind: 'intimidate', attr: 'passing', bonus: 30 }, () => {
      expect(engine.eff(rival, 'passing') - baseRival).toBeCloseTo(-2, 5)
      expect(engine.eff(mate, 'passing')).toBeCloseTo(baseMate, 5)
    })
  })

  it('放大技能：只影响带这个特性的球员', () => {
    const engine = engineFor()
    neutralize(engine)
    const player = fieldPlayers(engine)[0]
    player.skillTiers = { box_hunter: 'gold' }
    expect(skillTierMultiplier(player, 'box_hunter')).toBeCloseTo(1.2, 5)
    withTrait(engine, player, { kind: 'skillBoost', pct: 50 }, () => {
      expect(skillTierMultiplier(player, 'box_hunter')).toBeCloseTo(1.8, 5)
    })
  })

  it('吃牌和受伤：风险降到 0 就再也不会发生', () => {
    const engine = engineFor()
    neutralize(engine)
    const team = engine.getTeam('home')
    const player = fieldPlayers(engine)[0]
    const tally = (run: () => boolean) => {
      let count = 0
      for (let step = 1; step <= 1500; step++) {
        engine.state.step = 10_000 + step
        if (run()) count++
        player.yellowCards = 0
        player.sentOff = false
        player.onPitch = true
        player.injured = false
      }
      return count
    }
    const booked = () => internals(engine).book(team, player) !== null
    const hurt = () => { internals(engine).maybeInjure(player); return !!player.injured }
    expect(tally(booked)).toBeGreaterThan(100)
    expect(tally(hurt)).toBeGreaterThan(5)
    STAR_TRAITS.star_test = { name: 'x', when: 'any', kind: 'card', risk: 100 }
    player.traitId = 'star_test'
    expect(tally(booked)).toBe(0)
    STAR_TRAITS.star_test = { name: 'x', when: 'any', kind: 'injury', risk: 100 }
    expect(tally(hurt)).toBe(0)
    delete STAR_TRAITS.star_test
    player.traitId = 'none' as TraitId
  })

  /** 给一方所有球员装上特性，跑完整场比赛。 */
  function simulateWith(effect: StarEffect, seed: number, options: { knockout?: boolean; offside?: boolean } = {}) {
    STAR_TRAITS.star_test = { name: 'x', when: 'any', ...effect }
    const { home, away } = inputs()
    for (const item of home.starters) item.player = { ...item.player, traitId: 'star_test' }
    const engine = new MatchEngine({ seed, home, away, knockout: options.knockout ?? false, offside: options.offside })
    const state = engine.simulate()
    delete STAR_TRAITS.star_test
    return state
  }

  it('体力消耗降低：同样踢一场，终场剩下的体力更多', () => {
    const left = (effect: StarEffect) => {
      const state = simulateWith(effect, 5)
      const players = state.teams[0].players
      return players.reduce((sum, player) => sum + player.stamina / player.maxStamina, 0) / players.length
    }
    expect(left({ kind: 'stamina', drain: 60 })).toBeGreaterThan(left({ kind: 'stamina', drain: 0 }) + 0.05)
  })

  it('体力见底回血：每场只触发一次', () => {
    const engine = engineFor()
    neutralize(engine)
    const player = fieldPlayers(engine)[0]
    STAR_TRAITS.star_test = { name: 'x', when: 'any', kind: 'secondWind', stamina: 40 }
    player.traitId = 'star_test'
    player.stamina = player.maxStamina * 0.65
    for (let index = 0; index < 3; index++) {
      engine.step()
      player.stamina = player.maxStamina * 0.65
    }
    expect(player.traitUsed).toBeFalsy()
    player.stamina = player.maxStamina * 0.2
    for (let index = 0; index < 5 && !player.traitUsed; index++) engine.step()
    expect(player.traitUsed).toBe(true)
    expect(player.stamina / player.maxStamina).toBeGreaterThan(0.45)
    player.stamina = player.maxStamina * 0.2
    for (let index = 0; index < 5; index++) engine.step()
    expect(player.stamina / player.maxStamina).toBeLessThan(0.21)
    delete STAR_TRAITS.star_test
  })

  it('进球回血：进球后这名球员的体力明显回升', () => {
    STAR_TRAITS.star_test = { name: 'x', when: 'any', kind: 'goalRecover', stamina: 60 }
    let checked = 0
    for (let seed = 1; seed <= 12 && checked === 0; seed++) {
      const { home, away } = inputs()
      for (const item of home.starters) item.player = { ...item.player, traitId: 'star_test' }
      const engine = new MatchEngine({ seed, home, away, knockout: false })
      while (!engine.state.finished && checked === 0) {
        const before = new Map(engine.getTeam('home').players.map((player) => [player.id, player.stamina / player.maxStamina]))
        const goals = engine.state.score.home
        engine.step()
        if (engine.state.score.home > goals) {
          const scorer = [...engine.state.log].reverse().find((entry) => entry.type === 'goal')!.playerId!
          const player = engine.getTeam('home').players.find((item) => item.id === scorer)
          if (player && before.has(player.id)) {
            expect(player.stamina / player.maxStamina).toBeGreaterThan(Math.min(0.99, before.get(player.id)! + 0.3))
            checked++
          }
        }
      }
    }
    delete STAR_TRAITS.star_test
    expect(checked).toBe(1)
  })

  it('躲越位：开着越位规则时，带 100% 特性的一方不会被吹越位', () => {
    const offsides = (effect: StarEffect) => {
      let count = 0
      // 这个阵容每场才有零点几次越位，多看几场。
      for (let seed = 1; seed <= 30; seed++) {
        const state = simulateWith(effect, seed, { offside: true })
        count += state.log.filter((entry) => entry.team === 'home' && entry.offside).length
      }
      return count
    }
    expect(offsides({ kind: 'onside', chance: 0 })).toBeGreaterThan(0)
    expect(offsides({ kind: 'onside', chance: 100 })).toBe(0)
  }, 30_000)

  describe('点球大战', () => {
    /** 主队罚第一个点球时的命中率。taker 和 keeper 分别是主队外场球员和客队门将的特性。 */
    function firstPenalty(taker?: StarEffect & { when?: TraitCondition }, keeper?: StarEffect & { when?: TraitCondition }): number {
      const engine = engineFor()
      neutralize(engine)
      if (taker) {
        STAR_TRAITS.star_taker = { name: 'x', when: 'any', ...taker }
        for (const player of fieldPlayers(engine)) player.traitId = 'star_taker'
      }
      if (keeper) {
        STAR_TRAITS.star_keeper = { name: 'y', when: 'any', ...keeper }
        keeperOf(engine).traitId = 'star_keeper'
      }
      internals(engine).startShootout()
      internals(engine).advanceShootout()
      delete STAR_TRAITS.star_taker
      delete STAR_TRAITS.star_keeper
      return engine.state.log.at(-1)!.probabilities!.goal
    }

    it('主罚的特性提高命中率，射正和进球的加成合在一起算', () => {
      const plain = firstPenalty()
      expect(firstPenalty({ kind: 'shot', scope: 'penalty', onTarget: 4, goal: 6 }) - plain).toBeCloseTo(0.1, 2)
      expect(firstPenalty({ kind: 'shot', scope: 'any', onTarget: 2, goal: 1 }) - plain).toBeCloseTo(0.03, 2)
      expect(firstPenalty({ kind: 'shot', scope: 'header', onTarget: 4, goal: 6 })).toBe(plain)
    })

    it('门将的特性降低命中率', () => {
      const plain = firstPenalty()
      expect(firstPenalty(undefined, { kind: 'save', scope: 'penalty', goal: 8 }) - plain).toBeCloseTo(-0.08, 2)
      expect(firstPenalty(undefined, { kind: 'save', scope: 'any', goal: 3 }) - plain).toBeCloseTo(-0.03, 2)
      expect(firstPenalty(undefined, { kind: 'save', scope: 'freeKick', goal: 8 })).toBe(plain)
    })

    it('条件照常判定：主队球员的“客场”特性不生效', () => {
      const plain = firstPenalty()
      const effect: StarEffect = { kind: 'shot', scope: 'penalty', onTarget: 0, goal: 8 }
      expect(firstPenalty({ ...effect, when: 'away' })).toBe(plain)
      expect(firstPenalty({ ...effect, when: 'home' }) - plain).toBeCloseTo(0.08, 2)
      const save: StarEffect = { kind: 'save', scope: 'penalty', goal: 8 }
      expect(firstPenalty(undefined, { ...save, when: 'home' })).toBe(plain)
      expect(firstPenalty(undefined, { ...save, when: 'away' }) - plain).toBeCloseTo(-0.08, 2)
    })
  })

  /** 两边的首发轮流戴上真实的专属特性，offset 决定从第几个开始。 */
  function starInputs(offset: number) {
    const ids = Object.keys(STAR_TRAITS)
    const { home, away } = inputs()
    const players = [...home.starters, ...away.starters]
    players.forEach((item, index) => { item.player = { ...item.player, traitId: ids[(offset + index) % ids.length] as TraitId } })
    return { home, away, count: players.length }
  }

  it('同种子两场比赛结果完全一样；中途读档后结果也一样', () => {
    const { home, away } = starInputs(120)
    const run = () => new MatchEngine({ seed: 9, home, away, knockout: false })
    const first = run().simulate()
    expect(run().simulate().log.map((entry) => entry.text)).toEqual(first.log.map((entry) => entry.text))
    const half = run()
    for (let index = 0; index < 150 && !half.state.finished; index++) half.step()
    const resumed = MatchEngine.restore(structuredClone(half.serialize()), false).simulate()
    expect(resumed.score).toEqual(first.score)
    expect(resumed.log.map((entry) => entry.text)).toEqual(first.log.map((entry) => entry.text))
  })

  it('全部 500 个特性都能跑完整场比赛，比分和球员数据都正常', () => {
    const { count } = starInputs(0)
    for (let offset = 0; offset < 500; offset += count) {
      const { home, away } = starInputs(offset)
      const state = new MatchEngine({ seed: 1000 + offset, home, away, knockout: true }).simulate()
      expect(state.finished).toBe(true)
      expect(state.score.home + state.score.away).toBeLessThan(30)
      for (const team of state.teams) {
        for (const player of [...team.players, ...team.bench]) {
          expect(Number.isFinite(player.stamina), player.name).toBe(true)
          expect(player.stamina, player.name).toBeLessThanOrEqual(player.maxStamina)
          expect(player.stamina, player.name).toBeGreaterThanOrEqual(0)
        }
      }
    }
  }, 30_000)
})

describe('旧存档和 Agent', () => {
  it('旧存档的真实球星换成专属特性，随机球员和属性不变，只处理一次', () => {
    const game = createWorldGame(73)
    delete game.traitsVersion
    const star = game.freeStars[0]
    const attrs = structuredClone(star.attrs)
    star.traitId = 'cold_blood'
    const rosterStar = game.freeStars.splice(1, 1)[0]
    game.roster.push(rosterStar)
    rosterStar.traitId = 'iron'
    const reserveStar = game.reserveStars![0]
    reserveStar.traitId = 'iron'
    const teamStar = { ...structuredClone(game.reserveStars![1]), traitId: 'iron' } as Player
    game.aiTeams[0].players.push(teamStar)
    const random = game.roster.find((player) => player.era === 'random')!
    const randomTrait = random.traitId
    expect(upgradeStarTraits(game)).toBe(true)
    expect(star.traitId).toBe(`star_${star.seedId}`)
    expect(rosterStar.traitId).toBe(`star_${rosterStar.seedId}`)
    expect(reserveStar.traitId).toBe(`star_${reserveStar.seedId}`)
    expect(teamStar.traitId).toBe(`star_${teamStar.seedId}`)
    expect(star.attrs).toEqual(attrs)
    expect(random.traitId).toBe(randomTrait)
    star.traitId = 'iron'
    expect(upgradeStarTraits(game)).toBe(false)
    expect(star.traitId).toBe('iron')
  })

  it('下一代球星继承同一个专属特性', () => {
    const game = createWorldGame(74)
    delete game.traitsVersion
    const star = game.freeStars[0]
    const regen = { ...structuredClone(star), id: 'regen-x', traitId: 'iron' } as Player
    game.freeStars = [regen]
    upgradeStarTraits(game)
    expect(regen.traitId).toBe(`star_${star.seedId}`)
  })

  it('共享世界里的球星也会升级', () => {
    const star = { ...createPlayerFromSeed(PLAYER_SEEDS[0]), traitId: 'iron' } as Player
    const shared = { freeStars: [star], reserveStars: [] }
    expect(upgradeSharedWorldNames(shared)).toBe(true)
    expect(star.traitId).toBe(`star_${PLAYER_SEEDS[0].id}`)
    expect(upgradeSharedWorldNames(shared)).toBe(false)
  })

  it('Agent 能看到特性名字和效果说明', () => {
    const game = createInitialGame(75)
    const star = game.roster.find((player) => player.era !== 'random')!
    const view = agentView(game).roster.find((player) => player.id === star.id)!
    expect(view.traitId).toBe(star.traitId)
    expect(view.traitName).toBe(traitNameOf(star.traitId))
    expect(view.traitEffect).toBe(traitEffectText(star.traitId))
    expect(view.traitEffect.length).toBeGreaterThan(4)
  })
})
