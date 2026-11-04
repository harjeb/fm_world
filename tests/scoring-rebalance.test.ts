import { describe, expect, it } from 'vitest'
import { MatchEngine } from '../src/game/match/engine.ts'
import { makeTeams, inputFor } from './helpers.ts'
import { MATCH_DISPLAY_SECONDS, LOGIC_MATCH_SECONDS, displayClock, logicClock } from '../src/game/match/time.ts'
import { matchRealSeconds } from '../src/game/match/time.ts'

function setup(seed = 7) {
  const { roster, lineup } = makeTeams()
  const engine = new MatchEngine({
    seed,
    home: inputFor(roster, lineup, 'home', 'Home'),
    away: inputFor(roster, lineup, 'away', 'Away'),
    knockout: false,
  })
  return engine
}

function isolatedShot(engine: MatchEngine, shooting = 35) {
  const [home, away] = engine.state.teams
  const shooter = home.players.find((player) => player.position !== 'GK')!
  const keeper = away.players.find((player) => player.position === 'GK')!
  shooter.position = 'ST'
  shooter.x = 90
  shooter.y = 32
  shooter.attrs.shooting = shooting
  shooter.attrs.composure = shooting
  keeper.x = 99
  keeper.y = 32
  for (const player of away.players) {
    if (player.id !== keeper.id) {
      player.x = 4
      player.y = player.id.endsWith('0') ? 4 : 60
    }
  }
  return { home, away, shooter, keeper }
}

describe('射门机会与保底', () => {
  it('干净单刀按场景保底，不因低射术跌破 78%，并随终结能力非递减', () => {
    let previous = 0
    for (const shooting of [25, 35, 50, 75, 95]) {
      const engine = setup()
      const { home, away, shooter } = isolatedShot(engine, shooting)
      const model = (engine as any).shotModel(shooter, home, away, { point: { x: shooter.x, y: shooter.y }, header: false, penalty: false, freeKick: false })
      expect(model.chance.type).toBe('clear_chance')
      expect(model.onTarget).toBeGreaterThanOrEqual(0.78 - 1e-9)
      expect(model.onTarget).toBeGreaterThanOrEqual(previous - 1e-9)
      previous = model.onTarget
    }
  })

  it('低射术的单刀显著优于困难远射，且困难射门不借用保底', () => {
    const engine = setup()
    const { home, away, shooter } = isolatedShot(engine, 30)
    const near = (engine as any).shotModel(shooter, home, away, { point: { x: 90, y: 32 }, header: false, penalty: false, freeKick: false })
    const far = (engine as any).shotModel(shooter, home, away, { point: { x: 58, y: 32 }, header: false, penalty: false, freeKick: false })
    expect(near.chance.type).toBe('clear_chance')
    expect(far.chance.type).toBe('difficult')
    expect(near.onTarget).toBeGreaterThan(far.onTarget + 0.25)
    expect(far.onTarget).toBeLessThan(0.4)
  })

  it('门将失位的近距空门有 90% 以上进球率，且失位门将不能隔空扑救', () => {
    const engine = setup()
    const [home, away] = engine.state.teams
    const shooter = home.players.find((player) => player.position !== 'GK')!
    const keeper = away.players.find((player) => player.position === 'GK')!
    shooter.position = 'ST'
    shooter.x = 94
    shooter.y = 32
    shooter.attrs.shooting = 35
    shooter.attrs.composure = 35
    keeper.x = 75
    keeper.y = 32
    for (const player of away.players) if (player.id !== keeper.id) { player.x = 4; player.y = 4 }
    const model = () => (engine as any).shotModel(shooter, home, away, { point: { x: 94, y: 32 }, header: false, penalty: false, freeKick: false })
    const open = model()
    expect(open.chance.type).toBe('open_goal')
    expect(open.goalGivenOnTarget).toBe(1)
    expect(open.pGoal).toBeGreaterThanOrEqual(0.9)
    keeper.attrs.oneOnOne = 95
    keeper.attrs.reflexes = 95
    keeper.attrs.defPos = 95
    expect(model().pGoal).toBeCloseTo(open.pGoal, 10)
  })

  it('门将持球时不会自己射门；外场防守预判越低，封堵评分越低', () => {
    const engine = setup()
    const [home, away] = engine.state.teams
    const keeper = home.players.find((player) => player.position === 'GK')!
    engine.state.ball.ownerId = keeper.id
    const decision = (engine as any).chooseAction(home, away, keeper)
    expect(decision.choice.kind).not.toBe('shoot')
    const defender = away.players.find((player) => player.position === 'CB')!
    defender.x = 95
    defender.y = 32
    defender.attrs.defPos = 90
    defender.attrs.anticipation = 90
    const strong = (engine as any).findBlockers(away, { x: 90, y: 32 }, { x: 100, y: 32 })[0]
    defender.attrs.defPos = 20
    defender.attrs.anticipation = 20
    const weak = (engine as any).findBlockers(away, { x: 90, y: 32 }, { x: 100, y: 32 })[0]
    expect(strong).toBeGreaterThan(weak)
  })

  it('实际结算空门时没有扑救结果，进球概率至少 85%', () => {
    const engine = setup()
    const [home, away] = engine.state.teams
    const shooter = home.players.find((player) => player.position !== 'GK')!
    const keeper = away.players.find((player) => player.position === 'GK')!
    shooter.position = 'ST'
    shooter.x = 94
    shooter.y = 32
    shooter.attrs.shooting = 35
    shooter.attrs.composure = 35
    keeper.x = 75
    keeper.y = 32
    for (const player of away.players) if (player.id !== keeper.id) { player.x = 4; player.y = 4 }
    ;(engine as any).resolveShot(shooter, home, away, { point: { x: 94, y: 32 }, header: false, penalty: false, freeKick: false })
    const entry = engine.state.log.at(-1)!
    expect(entry.shotChance?.type).toBe('open_goal')
    expect(entry.probabilities!.save).toBe(0)
    expect(entry.probabilities!.goal).toBeGreaterThanOrEqual(0.85)
  })

  it('外场防守者可及时到达时撤销单刀，门将不重复计入封堵', () => {
    const engine = setup()
    const { home, away, shooter, keeper } = isolatedShot(engine, 35)
    const defender = away.players.find((player) => player.position === 'CB')!
    defender.x = 90
    defender.y = 34
    const pressured = (engine as any).classifyShotChance(shooter, away, { x: shooter.x, y: shooter.y }, { header: false, penalty: false, freeKick: false })
    expect(['normal', 'difficult']).toContain(pressured.type)
    defender.x = 4
    defender.y = 60
    keeper.x = 95
    keeper.y = 32
    const covered = (engine as any).classifyShotChance(shooter, away, { x: shooter.x, y: shooter.y }, { header: false, penalty: false, freeKick: false })
    expect(covered.blockers).toBe(0)
    expect((engine as any).findBlockers(away, { x: shooter.x, y: shooter.y }, { x: 100, y: 32 })).toHaveLength(0)
  })

  it('只有实际单刀才使用门将一对一，降低门将能力提高进球率但不改变射正率', () => {
    const engine = setup()
    const { home, away, shooter, keeper } = isolatedShot(engine, 40)
    const model = () => (engine as any).shotModel(shooter, home, away, { point: { x: shooter.x, y: shooter.y }, header: false, penalty: false, freeKick: false })
    keeper.attrs.oneOnOne = 20
    keeper.attrs.reflexes = 45
    keeper.attrs.defPos = 45
    const weak = model()
    keeper.attrs.oneOnOne = 95
    const strong = model()
    expect(weak.chance.type).toBe('clear_chance')
    expect(weak.goalGivenOnTarget).toBeGreaterThan(strong.goalGivenOnTarget)
    expect(weak.onTarget).toBeCloseTo(strong.onTarget, 10)
    expect(strong.gkScore).toBeGreaterThan(weak.gkScore)
  })

  it('射门场景在关键边界连续变化', () => {
    const engine = setup()
    const [home, away] = engine.state.teams
    const shooter = home.players.find((player) => player.position !== 'GK')!
    const model = (x: number) => (engine as any).classifyShotChance(shooter, away, { x, y: 32 }, { header: false, penalty: false, freeKick: false })
    for (const [a, b] of [[92, 92.1], [84, 84.1], [82, 82.1], [74, 74.1]]) {
      const first = model(a)
      const second = model(b)
      expect(Math.abs(first.base - second.base)).toBeLessThan(0.2)
      expect(Math.abs(first.floor - second.floor)).toBeLessThan(0.2)
    }
  })

  it('时间、规则版本和旧比赛恢复路径相互独立', () => {
    const engine = setup()
    expect(LOGIC_MATCH_SECONDS).toBe(900)
    expect(MATCH_DISPLAY_SECONDS).toBe(5400)
    expect(displayClock(450, 900)).toBe(2700)
    expect(displayClock(900, 900)).toBe(5400)
    expect(logicClock(2700, 900)).toBe(450)
    expect(matchRealSeconds(450, 900)).toBe(300)
    expect(engine.state.rulesVersion).toBe(2)
    const legacyState = structuredClone(engine.serialize())
    delete legacyState.rulesVersion
    legacyState.durationSeconds = 600
    const legacy = MatchEngine.restore(legacyState, false)
    expect((legacy as any).legacyRules).toBe(true)
    expect((legacy as any).shotModel(legacy.state.teams[0].players[0], legacy.state.teams[0], legacy.state.teams[1], { point: { x: 90, y: 32 }, header: false, penalty: false, freeKick: false }).chance.reason).toBe('legacy')
  })

  it('四结果概率和为一，最终射正率受场景下限约束', () => {
    for (const seed of [11, 12, 13]) {
      const engine = setup(seed)
      const state = engine.simulate()
      for (const entry of state.log.filter((entry) => entry.shotChance && entry.probabilities)) {
        const sum = Object.values(entry.probabilities!).reduce((a, b) => a + b, 0)
        expect(sum).toBeGreaterThan(0.97)
        expect(sum).toBeLessThan(1.03)
        expect(entry.ratings!.onTarget).toBeGreaterThanOrEqual(entry.shotChance!.floor - 0.001)
        expect(entry.ratings!.onTarget).toBeLessThanOrEqual(entry.shotChance!.ceiling + 0.001)
      }
    }
  })
})
