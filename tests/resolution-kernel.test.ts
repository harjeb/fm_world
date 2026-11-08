import { describe, expect, it } from 'vitest'
import { MatchEngine } from '../src/game/match/engine.ts'
import { MatchRatings } from '../src/game/match/ratings.ts'
import {
  SettlementKernel,
  TACTICAL_FOUL_RED,
  pickByWeight,
  totalWeight,
  type KernelHooks,
} from '../src/game/match/resolution.ts'
import { derivedRng } from '../src/game/rng.ts'
import { inputFor, makeTeams } from './helpers.ts'
import type { MatchPlayerState } from '../src/game/match/types.ts'

/**
 * 结算内核（src/game/match/resolution.ts）脱离 MatchEngine 也能用：
 * 只要给它一份评分（MatchRatings）和两个回调（技能统计、旧存档开关）。
 * 新的 2D 物理引擎就是这样复用现有属性公式的（docs/pes2d-migration-plan.md 阶段 3）。
 */

function setup(seed = 11) {
  const { roster, lineup } = makeTeams()
  const engine = new MatchEngine({
    seed,
    home: inputFor(roster, lineup, 'home', 'Home'),
    away: inputFor(roster, lineup, 'away', 'Away'),
    knockout: false,
    rulesVersion: 2,
  })
  const state = engine.state
  // 名册里的球员会随机带特性；这里只测基础公式，统一换成没有效果的特性。
  for (const team of state.teams) for (const player of [...team.players, ...team.bench]) (player as any).traitId = 'test-neutral'
  const marks: string[] = []
  const hooks: KernelHooks = {
    markSkill: (player, skillId, condition, applied) => marks.push(`${player.id}:${skillId}:${condition}:${applied}`),
    legacyRules: false,
  }
  const ratings = new MatchRatings(() => state, () => state.durationSeconds)
  const kernel = new SettlementKernel(ratings, hooks)
  const [home, away] = state.teams
  return { engine, kernel, ratings, marks, home, away, state }
}

function outfield(team: { players: MatchPlayerState[] }, count = 2): MatchPlayerState[] {
  return team.players.filter((player) => player.onPitch && player.position !== 'GK').slice(0, count)
}

function keeper(team: { players: MatchPlayerState[] }): MatchPlayerState {
  return team.players.find((player) => player.onPitch && player.position === 'GK')!
}

describe('结算内核：脱离引擎独立工作', () => {
  it('传球、过人、射门模型的输出和引擎里的同名方法完全一致', () => {
    const { engine, kernel, home, away } = setup()
    const [passer, receiver] = outfield(home)
    passer.x = 40; passer.y = 30
    receiver.x = 60; receiver.y = 36
    const [defender] = outfield(away, 1)
    defender.x = 50; defender.y = 33
    const from = { x: passer.x, y: passer.y }
    const to = { x: receiver.x, y: receiver.y }
    expect(kernel.passModel(passer, receiver, 'through', away, from, to, false)).toEqual((engine as any).passModel(passer, receiver, 'through', away, from, to, false))
    expect(kernel.dribbleModel(passer, defender, false)).toEqual((engine as any).dribbleModel(passer, defender, false))
    const opts = { point: { x: 88, y: 30 }, header: false, penalty: false, freeKick: false }
    expect(kernel.shotModel(passer, home, away, opts, false)).toEqual((engine as any).shotModel(passer, home, away, opts, false))
  })

  it('传球成功率随传球人的传球属性升高、随拦截人的抢断属性降低', () => {
    const { kernel, home, away } = setup()
    const [passer, receiver] = outfield(home)
    const [defender] = outfield(away, 1)
    passer.x = 40; passer.y = 30
    receiver.x = 62; receiver.y = 30
    defender.x = 51; defender.y = 30
    const model = () => kernel.passModel(passer, receiver, 'long', away, { x: passer.x, y: passer.y }, { x: receiver.x, y: receiver.y }, false)
    passer.attrs.passing = 30
    const weak = model().p
    passer.attrs.passing = 90
    const strong = model().p
    expect(strong).toBeGreaterThan(weak + 0.03)
    defender.attrs.tackling = 20
    const soft = model().p
    defender.attrs.tackling = 95
    const hard = model().p
    expect(hard).toBeLessThan(soft - 0.02)
  })

  it('射门：射术越高进球越多，门将反应越高进球越少', () => {
    const { kernel, home, away } = setup()
    const [shooter] = outfield(home, 1)
    const gk = keeper(away)
    shooter.x = 90; shooter.y = 32
    gk.x = 99; gk.y = 32
    for (const player of away.players) if (player.id !== gk.id) { player.x = 4; player.y = 4 }
    const opts = { point: { x: shooter.x, y: shooter.y }, header: false, penalty: false, freeKick: false }
    const goal = () => kernel.shotModel(shooter, home, away, opts, false).pGoal
    shooter.attrs.shooting = 30; shooter.attrs.composure = 30
    const bad = goal()
    shooter.attrs.shooting = 90; shooter.attrs.composure = 90
    const good = goal()
    expect(good).toBeGreaterThan(bad)
    gk.attrs.reflexes = 20
    const weakKeeper = goal()
    gk.attrs.reflexes = 95
    const strongKeeper = goal()
    expect(strongKeeper).toBeLessThan(weakKeeper)
  })

  it('射门四种结局的概率加起来是 1，四个值都在 0..1 之间', () => {
    const { kernel, home, away } = setup()
    const [shooter] = outfield(home, 1)
    shooter.x = 80; shooter.y = 26
    for (const header of [false, true]) {
      const rng = derivedRng(3, 'kernel-test', header ? 1 : 0)
      const plan = kernel.shotSettlement(shooter, home, away, { point: { x: shooter.x, y: shooter.y }, header, penalty: false, freeKick: false }, rng)
      const { block, off, save, goal } = plan.raw
      expect(block + off + save + goal).toBeCloseTo(1, 12)
      for (const value of [block, off, save, goal]) {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      }
      expect(header ? plan.technique === 'header' : plan.technique === 'power' || plan.technique === 'placed').toBe(true)
      expect(plan.foot === undefined).toBe(header)
    }
  })

  it('过人对抗四种结局的概率加起来是 1，被断下和犯规在失败里按犯规倾向分配', () => {
    const { kernel, home, away } = setup()
    const [carrier] = outfield(home, 1)
    const [defender] = outfield(away, 1)
    carrier.x = 50; carrier.y = 30
    defender.x = 52; defender.y = 30
    const model = kernel.dribbleModel(carrier, defender, false)
    const odds = kernel.dribbleOdds(model, defender, away)
    expect(odds.success).toBe(model.p)
    expect(odds.success + odds.tackle + odds.foul + odds.loose).toBeCloseTo(1, 12)
    const share = kernel.foulShare(defender, away)
    expect(odds.foul).toBeCloseTo((1 - model.p) * share, 12)
  })

  it('战术犯规：门将持球、禁区内、没有贴身防守时不会发生；贴身防守时给出概率', () => {
    const { kernel, home, away } = setup()
    const [carrier] = outfield(home, 1)
    const [defender] = outfield(away, 1)
    for (const player of away.players) { player.x = 4; player.y = 4 }
    carrier.x = 60; carrier.y = 30
    expect(kernel.tacticalFoulOdds(carrier, away)).toBeNull()
    defender.x = 62; defender.y = 30
    const odds = kernel.tacticalFoulOdds(carrier, away)!
    expect(odds.defender.id).toBe(defender.id)
    expect(odds.chance).toBeGreaterThan(0)
    expect(odds.chance).toBeLessThan(0.3)
    expect(odds.red).toBe(TACTICAL_FOUL_RED)
    carrier.x = 92; carrier.y = 32
    defender.x = 93; defender.y = 32
    expect(kernel.tacticalFoulOdds(carrier, away)).toBeNull()
    carrier.x = 60; carrier.y = 30
    const gk = keeper(home)
    expect(kernel.tacticalFoulOdds(gk, away)).toBeNull()
  })

  it('出牌概率：旧存档规则比新规则更高，特性可以降低', () => {
    const { kernel, home, ratings } = setup()
    const [player] = outfield(home, 1)
    const modern = kernel.cardOdds(player)
    expect(modern.yellow).toBeCloseTo(0.13 * 0.8, 12)
    expect(modern.straightRed).toBeCloseTo(0.012 * 0.25, 12)
    const legacy = new SettlementKernel(ratings, { markSkill: () => undefined, legacyRules: true }).cardOdds(player)
    expect(legacy.yellow).toBeCloseTo(0.17, 12)
    expect(legacy.straightRed).toBeCloseTo(0.012, 12)
  })

  it('受伤概率：疲劳越重越高，且在 0..1 之间', () => {
    const { kernel, home } = setup()
    const [player] = outfield(home, 1)
    player.stamina = player.maxStamina
    const fresh = kernel.injuryOdds(player)
    player.stamina = player.maxStamina * 0.2
    const tired = kernel.injuryOdds(player)
    expect(tired.personId).toBe(fresh.personId)
    expect(tired.risk).toBeGreaterThan(fresh.risk)
    expect(fresh.risk).toBeGreaterThanOrEqual(0)
    expect(tired.risk).toBeLessThan(1)
  })

  it('争顶和二点球：随机扰动按“进攻方先、防守方后”的顺序各取一次', () => {
    const { kernel, home, away } = setup()
    const point = { x: 90, y: 32 }
    const attackers = outfield(home, 3)
    const defenders = outfield(away, 2)
    for (const player of [...home.players, ...away.players]) { player.x = 3; player.y = 3 }
    attackers.forEach((player, index) => { player.x = 88 + index; player.y = 30 + index })
    defenders.forEach((player, index) => { player.x = 92 - index; player.y = 33 - index })
    const draws: number[] = []
    let next = 0
    const jitter = () => {
      draws.push(next)
      return (next++ % 10) / 10
    }
    const contestants = kernel.aerialContestants(home, away, point, 'home', jitter)
    expect(draws.length).toBe(contestants.length)
    expect(contestants.slice(0, attackers.length).every((item) => item.side === 'home')).toBe(true)
    expect(contestants.slice(attackers.length).every((item) => item.side === 'away')).toBe(true)
    for (const item of contestants) expect(item.weight).toBeGreaterThan(0)

    const loose = kernel.looseBallContestants([home, away], point, () => 0.5)
    expect(loose.length).toBeGreaterThanOrEqual(attackers.length + defenders.length - 1)
    const ids = new Set(loose.map((item) => item.player.id))
    expect(ids.size).toBe(loose.length)
  })

  it('抽签：区间边界、浮点落到末尾、权重为 0 的人不会赢', () => {
    const items = [{ weight: 1, id: 'a' }, { weight: 0, id: 'b' }, { weight: 3, id: 'c' }]
    expect(totalWeight(items)).toBe(4)
    expect(pickByWeight(items, 0).id).toBe('a')
    expect(pickByWeight(items, 1).id).toBe('a')
    expect(pickByWeight(items, 1.0001).id).toBe('c')
    expect(pickByWeight(items, 4).id).toBe('c')
    expect(pickByWeight(items, 4.5).id).toBe('c')
  })

  it('技能触发统计只在 markSkills 为真时才记', () => {
    const { kernel, home, away, marks } = setup()
    const [passer, receiver] = outfield(home)
    ;(passer.skills as string[]).push('safe_pass')
    passer.x = 40; passer.y = 30
    receiver.x = 46; receiver.y = 30
    kernel.passModel(passer, receiver, 'short', away, { x: 40, y: 30 }, { x: 46, y: 30 }, false)
    expect(marks.length).toBe(0)
    kernel.passModel(passer, receiver, 'short', away, { x: 40, y: 30 }, { x: 46, y: 30 }, true)
    expect(marks.some((item) => item.includes('safe_pass'))).toBe(true)
  })
})
