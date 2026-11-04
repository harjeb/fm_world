import { describe, expect, it } from 'vitest'
import { MatchEngine } from '../src/game/match/engine.ts'
import type { MatchState } from '../src/game/match/types.ts'
import { makeTeams, inputFor } from './helpers.ts'
import { LOGIC_MATCH_SECONDS } from '../src/game/match/time.ts'

function run(seed: number, knockout = false) {
  const { roster, lineup } = makeTeams()
  const engine = new MatchEngine({
    seed,
    home: inputFor(roster, lineup, 'home', 'Home'),
    away: inputFor(roster, lineup, 'away', 'Away'),
    knockout,
  })
  return engine.simulate()
}

function logSignature(state: MatchState): string {
  return JSON.stringify({
    score: state.score,
    steps: state.step,
    stats: state.stats,
    log: state.log.map((entry) => [entry.type, entry.text, entry.probabilities, entry.roll, entry.reason]),
  })
}

describe('比赛引擎', () => {
  it('同种子、同输入可复现', () => {
    const a = run(1234)
    const b = run(1234)
    expect(logSignature(a)).toBe(logSignature(b))
  })

  it('不同种子产生不同比赛', () => {
    const a = run(1)
    const b = run(2)
    expect(logSignature(a)).not.toBe(logSignature(b))
  })

  it('每次射门/传球/盘带的互斥结果概率和约等于 1', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const state = run(seed)
      const relevant = state.log.filter((entry) => ['pass', 'dribble', 'shot', 'save', 'block', 'goal', 'miss'].includes(entry.type) && entry.probabilities)
      expect(relevant.length).toBeGreaterThan(10)
      for (const entry of relevant) {
        const sum = Object.values(entry.probabilities!).reduce((acc, value) => acc + value, 0)
        expect(sum).toBeGreaterThan(0.97)
        expect(sum).toBeLessThan(1.03)
      }
    }
  })

  it('球权唯一、时钟推进、比赛必然结束', () => {
    const { roster, lineup } = makeTeams()
    const engine = new MatchEngine({
      seed: 42,
      home: inputFor(roster, lineup, 'home', 'Home'),
      away: inputFor(roster, lineup, 'away', 'Away'),
      knockout: false,
    })
    let guard = 0
    let previousClock = -1
    while (!engine.state.finished && guard++ < 5000) {
      engine.step()
      expect(engine.state.clock).toBeGreaterThanOrEqual(previousClock)
      previousClock = engine.state.clock
      const owner = engine.state.ball.ownerId
      if (owner) {
        const all = engine.state.teams.flatMap((team) => [...team.players, ...team.bench])
        const matches = all.filter((player) => player.id === owner && player.onPitch)
        expect(matches).toHaveLength(1)
      }
    }
    expect(engine.state.finished).toBe(true)
    expect(engine.state.clock).toBe(LOGIC_MATCH_SECONDS)
  })

  it('动作日志包含关键评分、概率与抽样值', () => {
    const state = run(6)
    const rated = state.log.filter((entry) => entry.ratings)
    expect(rated.length).toBeGreaterThan(0)
    for (const entry of rated.slice(0, 20)) {
      expect(Object.keys(entry.ratings!).length).toBeGreaterThan(0)
      expect(entry.probabilities).toBeTruthy()
      expect(entry.roll).toBeTypeOf('number')
    }
  })

  it('比赛会产生角球并复用定位球流程', () => {
    const state = run(3)
    expect(state.stats.home.corners + state.stats.away.corners).toBeGreaterThan(0)
    expect(state.log.some((entry) => entry.type === 'setpiece' && entry.text.includes('角球'))).toBe(true)
  })

  it('镜像批量胜率接近 50%', () => {
    let home = 0
    let draw = 0
    let away = 0
    let shots = 0
    let goals = 0
    for (let seed = 1; seed <= 30; seed++) {
      const state = run(seed)
      if (state.score.home > state.score.away) home++
      else if (state.score.home < state.score.away) away++
      else draw++
      shots += state.stats.home.shots + state.stats.away.shots
      goals += state.stats.home.goals + state.stats.away.goals
    }
    expect(home).toBeGreaterThanOrEqual(5)
    expect(away).toBeGreaterThanOrEqual(5)
    expect(draw).toBeGreaterThanOrEqual(2)
    expect(shots / 30).toBeGreaterThan(6)
    expect(goals / 30).toBeGreaterThan(0.5)
    expect(goals / 30).toBeLessThan(6)
  })

  it('只改 PA 不改变比赛结果', () => {
    const { roster, lineup } = makeTeams()
    const rosterA = roster.map((player) => ({ ...player, attrs: { ...player.attrs }, positions: { ...player.positions }, skills: [...player.skills] }))
    const rosterB = rosterA.map((player) => ({ ...player, pa: Math.max(1, player.pa - 20) }))
    const a = new MatchEngine({ seed: 77, home: inputFor(rosterA, lineup, 'home', 'A'), away: inputFor(rosterA, lineup, 'away', 'B'), knockout: false }).simulate()
    const b = new MatchEngine({ seed: 77, home: inputFor(rosterB, lineup, 'home', 'A'), away: inputFor(rosterB, lineup, 'away', 'B'), knockout: false }).simulate()
    expect(a.score).toEqual(b.score)
    expect(a.log.map((entry) => entry.text)).toEqual(b.log.map((entry) => entry.text))
  })

  it('淘汰赛平局进入点球大战', () => {
    let found: MatchState | null = null
    for (let seed = 1; seed <= 80; seed++) {
      const state = run(seed, true)
      if (state.score.home === state.score.away) {
        found = state
        break
      }
    }
    expect(found).not.toBeNull()
    expect(found!.shootout).not.toBeNull()
    expect(found!.shootout!.finished).toBe(true)
    expect(found!.log.some((entry) => entry.type === 'penalty')).toBe(true)
  })

  it('换人写入状态且不重复', () => {
    const { roster, lineup } = makeTeams()
    const engine = new MatchEngine({ seed: 8, home: inputFor(roster, lineup, 'home', 'Home'), away: inputFor(roster, lineup, 'away', 'Away'), knockout: false })
    for (let index = 0; index < 20 && !engine.state.finished; index++) engine.step()
    const out = engine.state.teams[0].players.find((player) => player.onPitch && player.position !== 'GK')
    const bench = engine.availableBench().find((player) => out && player.positions[out.position] > 0)
    expect(out).toBeTruthy()
    expect(bench).toBeTruthy()
    if (out && bench) {
      const result = engine.substitute(out.id, bench.id)
      expect(result.ok).toBe(true)
      expect(engine.state.teams[0].subsUsed).toBe(1)
      expect(engine.state.teams[0].bench.find((player) => player.id === out.id)?.onPitch).toBe(false)
      expect(engine.state.teams[0].bench.some((player) => player.id === out.id)).toBe(true)
      expect(engine.state.teams[0].players.find((player) => player.id === bench.id)?.onPitch).toBe(true)
    }
  })
})
