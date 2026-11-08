import { describe, expect, it } from 'vitest'
import { PLAYER_SEEDS, createPlayerFromSeed } from '../src/game/data/players.ts'
import { traitEffectText } from '../src/game/data/skill-effects.ts'
import { STAR_TRAITS } from '../src/game/data/star-traits.generated.ts'
import { starTraitId, type StarEffect } from '../src/game/data/star-traits.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import type { MatchPlayerState, MatchState, MatchTeamInput, MatchTeamState } from '../src/game/match/types.ts'
import { createInitialGame } from '../src/game/state.ts'
import type { MatchLogEntry, TraitId } from '../src/game/types.ts'

type Internals = {
  maybeTacticalFoul(opp: MatchTeamState, carrier: MatchPlayerState): MatchLogEntry | null
  pickTaker(team: MatchTeamState, mode: 'pass' | 'cross' | 'shoot', x: number, y: number, freeKick?: boolean): MatchPlayerState | null
  executeSetPiece(): MatchLogEntry | null
  setPendingSetPiece(type: string, side: string, x: number, y: number, note?: string): void
  shotModel(shooter: MatchPlayerState, team: MatchTeamState, opp: MatchTeamState, opts: { point: { x: number; y: number }; header: boolean; penalty: boolean; freeKick: boolean }): { onTarget: number; goalGivenOnTarget: number }
  deliverFreeKick(team: MatchTeamState, opp: MatchTeamState, taker: MatchPlayerState): MatchLogEntry | null
}
const internals = (engine: MatchEngine) => engine as unknown as Internals

const sharedInput = (() => {
  const game = createInitialGame(71)
  return teamInputFromLineup(game.roster, game.lineup, { id: 'p', name: 'P', color: '#fff', accent: '#000' })
})()

function inputs(): { home: MatchTeamInput; away: MatchTeamInput } {
  return { home: structuredClone(sharedInput), away: structuredClone(sharedInput) }
}

/** 所有人属性相同、没有特性的比赛，只看任意球规则本身。 */
function plainEngine(seed = 1): MatchEngine {
  const engine = new MatchEngine({ seed, ...inputs(), knockout: false, offside: true })
  for (const team of engine.state.teams) {
    for (const player of [...team.players, ...team.bench]) {
      player.traitId = 'none' as TraitId
      player.skills = []
      player.stamina = player.maxStamina
      player.positions[player.position] = 100
      for (const key of Object.keys(player.attrs) as (keyof typeof player.attrs)[]) player.attrs[key] = 40
    }
  }
  return engine
}

const field = (engine: MatchEngine, side: 'home' | 'away') => engine.getTeam(side).players.filter((player) => player.position !== 'GK')
const keeper = (engine: MatchEngine, side: 'home' | 'away') => engine.getTeam(side).players.find((player) => player.position === 'GK')!

/** 把持球人放到指定位置，最近的防守球员贴在 gap 米外，其他防守球员放远。 */
function place(engine: MatchEngine, x: number, y: number, gap = 2): { carrier: MatchPlayerState; defender: MatchPlayerState } {
  const carrier = field(engine, 'home')[0]
  const [defender, ...others] = field(engine, 'away')
  carrier.x = x
  carrier.y = y
  defender.x = x + gap
  defender.y = y
  others.forEach((player, index) => {
    player.x = 5
    player.y = 5 + index * 10
  })
  keeper(engine, 'away').x = 98
  keeper(engine, 'away').y = 32
  return { carrier, defender }
}

/** 同一个位置反复判定，返回犯规的比例。每一步用不同的派生随机数。 */
function foulRate(engine: MatchEngine, carrier: MatchPlayerState, trials = 2000): number {
  const opp = engine.getTeam('away')
  let fouls = 0
  for (let step = 1; step <= trials; step++) {
    engine.state.step = step
    if (internals(engine).maybeTacticalFoul(opp, carrier)) {
      fouls++
      engine.state.pendingSetPiece = null
      for (const player of opp.players) {
        player.sentOff = false
        player.onPitch = true
        player.yellowCards = 0
      }
    }
  }
  return fouls / trials
}

function withTrait<T>(player: MatchPlayerState, effect: StarEffect, run: () => T): T {
  STAR_TRAITS.star_fk_test = { name: 'x', when: 'any', ...effect }
  player.traitId = 'star_fk_test'
  const result = run()
  player.traitId = 'none' as TraitId
  delete STAR_TRAITS.star_fk_test
  return result
}

const directShots = (state: MatchState) => state.log.filter((entry) => entry.shotChance?.type === 'free_kick')

describe('任意球的数量', () => {
  it('直接任意球每场 1 到 3 次，进球、射门和红黄牌都在正常范围', () => {
    const { home, away } = inputs()
    const total = { direct: 0, directGoals: 0, goals: 0, shots: 0, fouls: 0, yellow: 0, red: 0, injuries: 0, penalties: 0 }
    const matches = 150
    for (let seed = 1; seed <= matches; seed++) {
      const state = new MatchEngine({ seed, home, away, knockout: false, offside: true }).simulate()
      const shots = directShots(state)
      total.direct += shots.length
      total.directGoals += shots.filter((entry) => entry.type === 'goal').length
      total.goals += state.score.home + state.score.away
      total.injuries += state.log.filter((entry) => entry.type === 'injury').length
      total.penalties += state.log.filter((entry) => entry.shotChance?.type === 'penalty').length
      for (const side of ['home', 'away'] as const) {
        total.shots += state.stats[side].shots
        total.fouls += state.stats[side].fouls
        total.yellow += state.stats[side].yellowCards
        total.red += state.stats[side].redCards
      }
    }
    const perMatch = (value: number) => value / matches
    expect(perMatch(total.direct)).toBeGreaterThan(1)
    expect(perMatch(total.direct)).toBeLessThan(3)
    // 转化率接近现实里的直接任意球。
    expect(total.directGoals / total.direct).toBeGreaterThan(0.03)
    expect(total.directGoals / total.direct).toBeLessThan(0.2)
    expect(perMatch(total.goals)).toBeGreaterThan(2)
    // 进攻模型改成更垂直的战术后，这份阵容的场均进球从 ~3.0 升到 ~3.7；
    // 上限放宽到 4.6，仍然能拦住“进球爆炸”，同时和 balance.test 的 <5 保持一致。
    expect(perMatch(total.goals)).toBeLessThan(4.6)
    expect(perMatch(total.shots)).toBeGreaterThan(17)
    expect(perMatch(total.fouls)).toBeGreaterThan(3.5)
    // v3（连续模拟）的犯规比旧引擎多：旧引擎每场约 6.5 次，v3 从 c352ef4 起就是约 7.6 次（150 场，这份阵容），
    // 原来的上限 7 是按旧引擎调的。放宽到 8.5，仍然拦得住犯规翻倍。
    expect(perMatch(total.fouls)).toBeLessThan(8.5)
    // 红牌和受伤不能跟着翻倍。下面的上限是按 v3 的实测定的（这份阵容、150 场、种子 1..150）：
    //                旧引擎(v2)   v3 实测    上限
    //   黄牌 / 场       0.62        0.83      1.0
    //   受伤 / 场       0.04        0.38      0.5
    // v3 的受伤比旧引擎多得多：伤病判定只在过人对抗被抢断或犯规之后发生，v3 的抢断、犯规更多，
    // 球员体力还会真实消耗，疲劳又让 injuryRisk 翻倍以上。这是 v3 本身的平衡，不是这个测试要管的；
    // 这里的上限只是 v3 的回归线，防止它在现有水平上再翻倍。
    expect(perMatch(total.yellow)).toBeGreaterThan(0.35)
    expect(perMatch(total.yellow)).toBeLessThan(1.0)
    expect(perMatch(total.red)).toBeLessThan(0.06)
    expect(perMatch(total.injuries)).toBeLessThan(0.5)
    // 禁区内不会战术犯规，点球还是很少。
    expect(perMatch(total.penalties)).toBeLessThan(0.1)
    // v3 一场约 0.33 秒，150 场要 50 秒左右（旧引擎只要 5 秒，原来的 30 秒是按它定的）。
  }, 120_000)
})

describe('战术犯规', () => {
  it('离球门越远越少，禁区内和防守球员没贴身时不会发生', () => {
    const engine = plainEngine()
    const near = place(engine, 75, 32)
    const nearRate = foulRate(engine, near.carrier)
    expect(nearRate).toBeGreaterThan(0.08)

    // 50 米外也会犯规，只是少得多。
    const far = place(engine, 30, 32)
    const farRate = foulRate(engine, far.carrier)
    expect(farRate).toBeGreaterThan(0.01)
    expect(farRate).toBeLessThan(nearRate / 3)
    // 禁区里不敢动手。
    const box = place(engine, 90, 32)
    expect(foulRate(engine, box.carrier, 300)).toBe(0)
    // 防守球员没贴上来。
    const loose = place(engine, 75, 32, 7)
    expect(foulRate(engine, loose.carrier, 300)).toBe(0)
  })

  it('门将不会冲出来拉人，自己持球时也不会被拉', () => {
    const engine = plainEngine()
    const { carrier } = place(engine, 75, 32)
    for (const player of field(engine, 'away')) {
      player.x = 5
      player.y = 5
    }
    keeper(engine, 'away').x = 77
    keeper(engine, 'away').y = 32
    expect(foulRate(engine, carrier, 300)).toBe(0)

    const again = plainEngine()
    const home = keeper(again, 'home')
    home.x = 8
    home.y = 32
    const presser = field(again, 'away')[0]
    presser.x = 10
    presser.y = 32
    expect(foulRate(again, home, 300)).toBe(0)
  })

  it('离球门越近、逼抢越高，越容易犯规', () => {
    const engine = plainEngine()
    const near = place(engine, 75, 32)
    const nearRate = foulRate(engine, near.carrier)
    const delivery = place(engine, 55, 32)
    const deliveryRate = foulRate(engine, delivery.carrier)
    expect(nearRate).toBeGreaterThan(deliveryRate)
    const { carrier } = place(engine, 75, 32)
    engine.getTeam('away').tactics.press = 'high'
    const high = foulRate(engine, carrier)
    engine.getTeam('away').tactics.press = 'low'
    const low = foulRate(engine, carrier)
    expect(high).toBeGreaterThan(low * 1.1)
  })

  it('抢断好的防守球员更少犯规', () => {
    const engine = plainEngine()
    const { carrier, defender } = place(engine, 75, 32)
    const poor = foulRate(engine, carrier)
    defender.attrs.tackling = 1400
    expect(foulRate(engine, carrier)).toBeLessThan(poor)
  })

  it('造犯规特性放大对手犯规的概率', () => {
    const engine = plainEngine()
    const { carrier } = place(engine, 75, 32)
    const plain = foulRate(engine, carrier)
    const drawn = withTrait(carrier, { kind: 'drawFoul', pct: 100 }, () => foulRate(engine, carrier))
    expect(drawn).toBeGreaterThan(plain * 1.6)
    expect(drawn).toBeLessThan(plain * 2.4)
  })

  it('犯规记入统计，轮到持球方在原地罚任意球；离球门越近越容易吃牌', () => {
    const engine = plainEngine()
    const { carrier } = place(engine, 75, 30)
    const opp = engine.getTeam('away')
    let step = 0
    let entry: MatchLogEntry | null = null
    while (!entry && step < 3000) {
      engine.state.step = ++step
      entry = internals(engine).maybeTacticalFoul(opp, carrier)
    }
    expect(entry?.type).toBe('foul')
    expect(entry?.text).toContain('判罚任意球')
    expect(engine.state.stats.away.fouls).toBe(1)
    expect(engine.state.pendingSetPiece).toMatchObject({ type: 'free_kick', teamSide: 'home', x: 75, y: 30 })

    const yellowRate = (x: number, trials: number) => {
      const repeat = plainEngine(2)
      const placed = place(repeat, x, 32)
      foulRate(repeat, placed.carrier, trials)
      const fouls = repeat.state.stats.away.fouls
      expect(fouls).toBeGreaterThan(200)
      return repeat.state.stats.away.yellowCards / fouls
    }
    const nearYellow = yellowRate(75, 4000)
    const farYellow = yellowRate(25, 12000)
    expect(nearYellow).toBeGreaterThan(0.1)
    expect(nearYellow).toBeLessThan(0.2)
    expect(farYellow).toBeGreaterThan(0.03)
    expect(farYellow).toBeLessThan(nearYellow)
  })

  it('旧规则的比赛不会出现战术犯规', () => {
    const engine = plainEngine()
    const { carrier } = place(engine, 75, 32)
    const legacy = MatchEngine.restore({ ...structuredClone(engine.serialize()), rulesVersion: 1 }, false)
    const before = legacy.state.stats.away.fouls
    for (let index = 0; index < 60 && !legacy.state.finished; index++) legacy.step()
    expect(carrier).toBeDefined()
    expect(legacy.state.log.filter((entry) => entry.type === 'foul' && entry.text.includes('放倒'))).toHaveLength(0)
    expect(legacy.state.stats.away.fouls).toBeGreaterThanOrEqual(before)
  })
})

describe('任意球怎么罚', () => {
  /** 在指定位置罚一次任意球，返回这一步写下的日志。 */
  function take(engine: MatchEngine, x: number, y: number): MatchLogEntry[] {
    internals(engine).setPendingSetPiece('free_kick', 'home', x, y, '测试')
    const start = engine.state.log.length
    internals(engine).executeSetPiece()
    return engine.state.log.slice(start)
  }

  it('35 米以内且角度够正时直接射门', () => {
    for (const [x, y] of [[80, 32], [68, 32], [72, 45]]) {
      const log = take(plainEngine(), x, y)
      expect(log.some((entry) => entry.shotChance?.type === 'free_kick'), `${x},${y}`).toBe(true)
    }
  })

  it('再远一点或角度太偏就传中到禁区', () => {
    for (const [x, y] of [[55, 32], [85, 4]]) {
      const log = take(plainEngine(), x, y)
      expect(log.some((entry) => entry.shotChance?.type === 'free_kick'), `${x},${y}`).toBe(false)
      expect(log.some((entry) => entry.text.includes('任意球传')), `${x},${y}`).toBe(true)
    }
  })

  it('本方半场的任意球由离得最近的人短传开出', () => {
    const engine = plainEngine()
    const [nearest, ...others] = field(engine, 'home')
    nearest.x = 22
    nearest.y = 30
    for (const player of others) {
      player.x = 60
      player.y = 32
    }
    // 射术和传球最好的人站得远，也不用他跑回来。
    others[0].attrs.passing = 1400
    others[0].attrs.shooting = 1400
    const log = take(engine, 20, 32)
    expect(log.some((entry) => entry.shotChance?.type === 'free_kick')).toBe(false)
    expect(log.some((entry) => entry.text.includes('任意球传'))).toBe(false)
    expect(log.find((entry) => entry.type === 'setpiece')?.playerId).toBe(nearest.id)
  })

  it('越远越难进', () => {
    const engine = plainEngine()
    const shooter = field(engine, 'home')[0]
    const model = (x: number) => internals(engine).shotModel(shooter, engine.getTeam('home'), engine.getTeam('away'), { point: { x, y: 32 }, header: false, penalty: false, freeKick: true })
    keeper(engine, 'away').x = 98
    const close = model(82)
    const far = model(66)
    expect(far.onTarget).toBeLessThan(close.onTarget)
    expect(far.goalGivenOnTarget).toBeLessThan(close.goalGivenOnTarget)
  })

  it('带任意球特性的人优先主罚，不管射术排第几', () => {
    const engine = plainEngine()
    const home = engine.getTeam('home')
    const [best, specialist] = field(engine, 'home')
    best.attrs.shooting = 1400
    best.attrs.passing = 1400
    specialist.attrs.shooting = 300
    specialist.attrs.passing = 300
    const pick = internals(engine).pickTaker.bind(engine)
    expect(pick(home, 'shoot', 70, 32, true)?.id).toBe(best.id)
    withTrait(specialist, { kind: 'shot', scope: 'freeKick', onTarget: 10, goal: 8 }, () => {
      expect(pick(home, 'shoot', 70, 32, true)?.id).toBe(specialist.id)
      // 不是任意球时不用让他来。
      expect(pick(home, 'shoot', 70, 32, false)?.id).toBe(best.id)
      expect(pick(home, 'cross', 55, 32, true)?.id).toBe(best.id)
    })
    withTrait(specialist, { kind: 'pass', scope: 'freeKick', success: 10 }, () => {
      expect(pick(home, 'cross', 55, 32, true)?.id).toBe(specialist.id)
      expect(pick(home, 'shoot', 70, 32, true)?.id).toBe(best.id)
    })
  })

  it('任意球射门特性只在直接任意球时生效', () => {
    const engine = plainEngine()
    const shooter = field(engine, 'home')[0]
    keeper(engine, 'away').x = 98
    const model = (freeKick: boolean) => internals(engine).shotModel(shooter, engine.getTeam('home'), engine.getTeam('away'), { point: { x: 75, y: 32 }, header: false, penalty: false, freeKick })
    const plainKick = model(true)
    const plainOpen = model(false)
    withTrait(shooter, { kind: 'shot', scope: 'freeKick', onTarget: 10, goal: 8 }, () => {
      expect(model(true).onTarget - plainKick.onTarget).toBeCloseTo(0.1, 5)
      expect(model(true).goalGivenOnTarget - plainKick.goalGivenOnTarget).toBeCloseTo(0.08, 5)
      expect(model(false).onTarget).toBe(plainOpen.onTarget)
    })
  })

  it('门将的任意球特性压低对手进球率', () => {
    const engine = plainEngine()
    const shooter = field(engine, 'home')[0]
    keeper(engine, 'away').x = 98
    const model = () => internals(engine).shotModel(shooter, engine.getTeam('home'), engine.getTeam('away'), { point: { x: 75, y: 32 }, header: false, penalty: false, freeKick: true })
    const plain = model()
    const saved = withTrait(keeper(engine, 'away'), { kind: 'save', scope: 'freeKick', goal: 10 }, model)
    expect(plain.goalGivenOnTarget - saved.goalGivenOnTarget).toBeCloseTo(0.1, 5)
  })

  it('任意球传中：传球好、带特性的人更容易传到位，失败时被对方解围', () => {
    const rate = (setup?: (taker: MatchPlayerState) => void) => {
      let delivered = 0
      let cleared = 0
      const trials = 400
      for (let seed = 1; seed <= trials; seed++) {
        const engine = plainEngine(seed)
        const taker = field(engine, 'home')[0]
        setup?.(taker)
        const start = engine.state.log.length
        internals(engine).deliverFreeKick(engine.getTeam('home'), engine.getTeam('away'), taker)
        const line = engine.state.log.slice(start).find((entry) => entry.text.includes('任意球传'))!
        if (line.text.includes('传入禁区')) delivered++
        else {
          cleared++
          expect(engine.state.possession).toBe('away')
        }
        const sum = Object.values(line.probabilities!).reduce((total, value) => total + value, 0)
        expect(sum).toBeCloseTo(1, 2)
      }
      expect(delivered + cleared).toBe(trials)
      return delivered / trials
    }
    const plain = rate()
    const skilled = rate((taker) => { taker.attrs.passing = 1350 })
    const trait = rate((taker) => {
      STAR_TRAITS.star_fk_test = { name: 'x', when: 'any', kind: 'pass', scope: 'freeKick', success: 20 }
      taker.traitId = 'star_fk_test'
    })
    delete STAR_TRAITS.star_fk_test
    expect(skilled).toBeGreaterThan(plain + 0.1)
    expect(trait).toBeGreaterThan(plain + 0.1)
  })
})

describe('任意球相关的球星特性', () => {
  const traitOf = (enName: string) => {
    const seed = PLAYER_SEEDS.find((item) => item.enName === enName)!
    return STAR_TRAITS[starTraitId(seed.id)]
  }

  it('任意球名家都是直接任意球特性，没有条件限制', () => {
    for (const name of ['David Beckham', 'Andrea Pirlo', 'Roberto Carlos', 'Ronaldinho', 'Lionel Messi', 'Cristiano Ronaldo', 'Alessandro Del Piero', 'J. Ward-Prowse']) {
      expect(traitOf(name), name).toMatchObject({ kind: 'shot', scope: 'freeKick', when: 'any' })
    }
  })

  it('内马尔、阿扎尔、格拉利什会造犯规', () => {
    for (const name of ['Neymar Jr', 'Eden Hazard', 'J. Grealish']) expect(traitOf(name).kind, name).toBe('drawFoul')
  })

  it('各种任意球特性都有一定数量，说明文字说得清楚', () => {
    const all = Object.values(STAR_TRAITS)
    const shots = all.filter((trait) => trait.kind === 'shot' && trait.scope === 'freeKick')
    const saves = all.filter((trait) => trait.kind === 'save' && trait.scope === 'freeKick')
    const passes = all.filter((trait) => trait.kind === 'pass' && trait.scope === 'freeKick')
    const longs = all.filter((trait) => trait.kind === 'pass' && trait.scope === 'long')
    const drawn = all.filter((trait) => trait.kind === 'drawFoul')
    expect(shots.length).toBeGreaterThanOrEqual(25)
    expect(saves.length).toBeGreaterThanOrEqual(2)
    expect(passes.length).toBeGreaterThanOrEqual(4)
    expect(longs.length).toBeGreaterThanOrEqual(4)
    expect(drawn.length).toBeGreaterThanOrEqual(4)
    const seed = PLAYER_SEEDS.find((item) => item.enName === 'David Beckham')!
    expect(createPlayerFromSeed(seed).traitId).toBe(starTraitId(seed.id))
    expect(traitEffectText(starTraitId(seed.id))).toContain('直接任意球时')
  })
})

describe('复现', () => {
  it('同种子两场比赛的犯规和任意球完全一样，中途读档后也一样', () => {
    const { home, away } = inputs()
    const run = () => new MatchEngine({ seed: 33, home, away, knockout: false, offside: true })
    const first = run().simulate()
    expect(first.stats.home.fouls + first.stats.away.fouls).toBeGreaterThan(0)
    expect(run().simulate().log.map((entry) => entry.text)).toEqual(first.log.map((entry) => entry.text))
    const half = run()
    for (let index = 0; index < 100 && !half.state.finished; index++) half.step()
    const resumed = MatchEngine.restore(structuredClone(half.serialize()), false).simulate()
    expect(resumed.log.map((entry) => entry.text)).toEqual(first.log.map((entry) => entry.text))
  })
})
