import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { changeMatchTactics, makeSubstitution, restoreActiveEngine, startLeague } from '../src/game/actions.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { MATCH_TACTICS } from '../src/game/match/management.ts'
import { createMatchRecord } from '../src/game/match/setup.ts'
import { chooseShotFoot, chooseShotTarget } from '../src/game/match/shooting.ts'
import type { MatchPlayerState, MatchTeamState } from '../src/game/match/types.ts'
import { derivedRng } from '../src/game/rng.ts'
import { makeTeams, inputFor } from './helpers.ts'

function match(seed: number, knockout = false) {
  const { roster, lineup } = makeTeams()
  return new MatchEngine({ seed, knockout, durationSeconds: 600, home: inputFor(roster, lineup, 'home', '主队'), away: inputFor(roster, lineup, 'away', '客队') })
}

describe('文字直播与进球', () => {
  it('每步只展示已发生事件，比分、时间及顺序与引擎一致', () => {
    const engine = match(8)
    let previousLength = 0
    let score = { home: 0, away: 0 }
    while (!engine.state.finished) {
      engine.step()
      const entries = engine.state.commentary!
      for (const entry of entries.slice(previousLength)) {
        if (entry.type === 'goal' && entry.team !== 'none') score = { ...score, [entry.team]: score[entry.team] + 1 }
        expect(entry.score).toEqual(score)
        expect(entry.clock).toBeLessThanOrEqual(engine.state.clock)
      }
      previousLength = entries.length
      expect(score).toEqual(engine.state.score)
    }
    const entries = engine.state.commentary!
    expect(entries.length).toBeGreaterThanOrEqual(150)
    expect(entries.length).toBeLessThanOrEqual(200)
    expect(entries.map((entry) => entry.seq)).toEqual(entries.map((_, index) => index + 1))
    for (let i = 1; i < entries.length; i++) expect(entries[i].clock).toBeGreaterThanOrEqual(entries[i - 1].clock)
    for (const log of engine.state.log) expect(entries.some((entry) => entry.clock === log.clock && entry.type === log.type && entry.text.endsWith(log.text))).toBe(true)
  })

  it('进球细节、文字和统计持久化自同一次射门', () => {
    const game = createInitialGame(8)
    expect(startLeague(game).ok).toBe(true)
    const engine = restoreActiveEngine(game)!
    engine.simulate()
    const record = createMatchRecord(game, engine.serialize(), game.activeMatch!.context)
    const goals = engine.state.log.filter((entry) => entry.type === 'goal')
    expect(goals.length).toBeGreaterThan(0)
    expect(record.goalDetails).toEqual(goals.map((entry) => entry.goal))
    expect(record.goalDetails!.length).toBe(record.score.home + record.score.away)
    expect(record.commentary).toEqual(engine.state.commentary)
    for (const entry of goals) {
      const goal = entry.goal!
      expect(goal.origin.x).toBeGreaterThanOrEqual(0)
      expect(goal.origin.x).toBeLessThanOrEqual(100)
      expect(goal.origin.y).toBeGreaterThanOrEqual(0)
      expect(goal.origin.y).toBeLessThanOrEqual(64)
      expect(goal.distance).toBeGreaterThan(0)
      expect(entry.text).toContain(goal.bodyPart === 'left' ? '左脚' : goal.bodyPart === 'right' ? '右脚' : '头球')
      expect(record.commentary!.some((line) => line.type === 'goal' && line.text.endsWith(entry.text))).toBe(true)
    }
    const shotXg = engine.state.log.filter((entry) => ['goal', 'save', 'block', 'miss'].includes(entry.type)).reduce((sum, entry) => sum + (entry.probabilities?.goal ?? 0), 0)
    expect(engine.state.stats.home.xg + engine.state.stats.away.xg).toBeCloseTo(shotXg, 2)
  })

  it('惯用脚、左右路、技术与双足实际影响射门', () => {
    const engine = match(4)
    const shooter = engine.state.teams[0].players.find((player) => player.position !== 'GK')!
    const opponent = engine.state.teams[1]
    shooter.foot = 'R'
    shooter.skills = []
    const left = Array.from({ length: 600 }, (_, i) => chooseShotFoot(shooter, 8, 50, derivedRng(i, 'foot'))).filter((foot) => foot === 'left').length
    const right = Array.from({ length: 600 }, (_, i) => chooseShotFoot(shooter, 56, 50, derivedRng(i, 'foot'))).filter((foot) => foot === 'left').length
    expect(left).toBeGreaterThan(200)
    expect(right).toBe(0)
    const weakAttempts = (balance: number) => Array.from({ length: 600 }, (_, i) => chooseShotFoot(shooter, 8, balance, derivedRng(i, 'foot'))).filter((foot) => foot === 'left').length
    expect(weakAttempts(90)).toBeGreaterThan(weakAttempts(10))
    shooter.skills.push('weak_foot')
    expect(weakAttempts(50)).toBeGreaterThan(left)
    shooter.skills = []
    const model = engine as unknown as { shotModel: (p: MatchPlayerState, team: MatchTeamState, opp: MatchTeamState, opts: { point: { x: number; y: number }; header: boolean; penalty: boolean; freeKick: boolean; foot: 'left' | 'right' }) => { pGoal: number } }
    const opts = { point: { x: 85, y: 20 }, header: false, penalty: false, freeKick: false, foot: 'left' as const }
    shooter.attrs.firstTouch = 15
    const weak = model.shotModel(shooter, engine.state.teams[0], opponent, opts).pGoal
    const strong = model.shotModel(shooter, engine.state.teams[0], opponent, { ...opts, foot: 'right' }).pGoal
    expect(strong).toBeGreaterThan(weak)
    shooter.attrs.firstTouch = 95
    expect(model.shotModel(shooter, engine.state.teams[0], opponent, opts).pGoal).toBeGreaterThan(weak)
    shooter.skills.push('weak_foot')
    expect(model.shotModel(shooter, engine.state.teams[0], opponent, opts).pGoal).toBeGreaterThan(weak)
    shooter.foot = 'B'
    expect(model.shotModel(shooter, engine.state.teams[0], opponent, opts).pGoal).toBe(model.shotModel(shooter, engine.state.teams[0], opponent, { ...opts, foot: 'right' }).pGoal)
    expect(model.shotModel(shooter, engine.state.teams[0], opponent, { ...opts, header: true }).pGoal).toBe(model.shotModel(shooter, engine.state.teams[0], opponent, { ...opts, header: true, foot: 'right' }).pGoal)
    const corners = (precision: number) => Array.from({ length: 1000 }, (_, i) => chooseShotTarget(precision, derivedRng(i, 'aim'))).filter((target) => !target.endsWith('center')).length
    expect(corners(90)).toBeGreaterThan(corners(10))
  })

  it('点球大战逐脚推进，恢复后不会重复或泄露未来结果', () => {
    let engine = match(1, true)
    for (let seed = 1; seed <= 100; seed++) {
      engine = match(seed, true)
      while (!engine.state.finished && engine.state.phase !== 'shootout') engine.step()
      if (engine.state.phase === 'shootout') break
    }
    expect(engine.state.phase).toBe('shootout')
    expect(engine.state.shootout!.attemptsHome + engine.state.shootout!.attemptsAway).toBe(0)
    engine.step()
    expect(engine.state.shootout!.attemptsHome + engine.state.shootout!.attemptsAway).toBe(1)
    const restored = MatchEngine.restore(structuredClone(engine.serialize()), true)
    const old = structuredClone(engine.serialize())
    delete old.commentary
    const legacy = MatchEngine.restore(old, true)
    expect(legacy.state.commentary!.find((entry) => entry.shootoutScore)?.shootoutScore).toEqual({ home: engine.state.shootout!.home, away: engine.state.shootout!.away })
    const expected = structuredClone(engine.simulate())
    const actual = restored.simulate()
    expect(actual.shootout).toEqual(expected.shootout)
    expect(actual.commentary).toEqual(expected.commentary)
    expect(actual.shootout!.finished).toBe(true)
    const kicks = actual.commentary!.filter((entry) => entry.type === 'penalty' && entry.shootoutScore)
    expect(kicks.length).toBe(actual.shootout!.attemptsHome + actual.shootout!.attemptsAway)
    expect(kicks.at(-1)!.shootoutScore).toEqual({ home: actual.shootout!.home, away: actual.shootout!.away })
  })

  it('半场或终场前获得的点球先罚完，不会被裁判终止', () => {
    for (const half of [1, 2] as const) {
      const engine = match(1, true)
      engine.state.half = half
      engine.state.clock = half === 1 ? 301 : 600
      engine.state.pendingSetPiece = { type: 'penalty', teamSide: 'home', x: 88, y: 32 }
      ;(engine as unknown as { checkPeriod: () => void }).checkPeriod()
      expect(engine.state.half).toBe(half)
      expect(engine.state.finished).toBe(false)
      expect(engine.state.pendingSetPiece?.type).toBe('penalty')
      engine.step()
      expect(engine.state.log.some((entry) => entry.type === 'penalty' && entry.text.includes('主罚点球'))).toBe(true)
      expect(engine.state.stats.home.shots).toBe(1)
      if (half === 1) expect(engine.state.half).toBe(2)
      else expect(engine.state.finished || engine.state.phase === 'shootout').toBe(true)
    }
  })

  it('左脚球员罚点球时使用惯用脚而非随机弱脚', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const engine = match(seed)
      const team = engine.state.teams[0]
      const opponent = engine.state.teams[1]
      const shooter = team.players.find((player) => player.position !== 'GK')!
      shooter.foot = 'L'
      const opts = { point: { x: 88, y: 32 }, header: false, penalty: true, freeKick: false }
      const methods = engine as unknown as {
        shotModel: (p: MatchPlayerState, t: MatchTeamState, o: MatchTeamState, options: typeof opts & { foot: 'left' }) => { finishScore: number }
        resolveShot: (p: MatchPlayerState, t: MatchTeamState, o: MatchTeamState, options: typeof opts) => { ratings?: Record<string, number> }
      }
      const expected = methods.shotModel(shooter, team, opponent, { ...opts, foot: 'left' }).finishScore
      expect(methods.resolveShot(shooter, team, opponent, opts).ratings!.finish).toBeCloseTo(expected, 2)
    }
  })

  it('玩家客场时，教练操作及事件归属客队而非对手', () => {
    const game = createInitialGame(1)
    startLeague(game)
    expect(game.activeMatch!.context.homeAway).toBe('away')
    const engine = restoreActiveEngine(game)!
    const before = { ...engine.getTeam('home').tactics }
    expect(changeMatchTactics(game, engine, 'attack').ok).toBe(true)
    expect(engine.getTeam('away').tactics).toEqual(MATCH_TACTICS.attack)
    expect(engine.getTeam('home').tactics).toEqual(before)
    expect(engine.state.commentary!.at(-1)!.team).toBe('away')
    const own = engine.getTeam('away')
    const pair = own.players.flatMap((out) => engine.availableBench('away').filter((input) => input.positions[out.position] > 0).map((input) => ({ out, input })))[0]
    expect(pair).toBeDefined()
    expect(makeSubstitution(game, engine, pair.out.id, pair.input.id).ok).toBe(true)
    expect(own.subsUsed).toBe(1)
    expect(engine.getTeam('home').subsUsed).toBe(0)
    expect(engine.state.commentary!.at(-1)!.team).toBe('away')
  })

  it('旧活动比赛可以从日志恢复已发生的文字及比分', () => {
    const engine = match(8)
    for (let i = 0; i < 80; i++) engine.step()
    const old = structuredClone(engine.serialize())
    delete old.commentary
    const restored = MatchEngine.restore(old, false)
    expect(restored.state.commentary!.length).toBe(old.log.length)
    expect(restored.state.commentary!.at(-1)!.score).toEqual(old.score)
    restored.step()
    expect(restored.state.commentary!.at(-1)!.seq).toBe(restored.state.commentary!.length)
  })
})
