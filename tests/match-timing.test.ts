import { describe, expect, it } from 'vitest'
import { MatchEngine } from '../src/game/match/engine.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { LEAGUE_REALTIME_SECONDS, LOGIC_MATCH_SECONDS } from '../src/game/match/time.ts'
import { createInitialGame } from '../src/game/state.ts'
import { ballPosition, friendlyStepMs, idleSway, leagueTweenMs } from '../src/ui/match-timing.ts'

function stepSeconds(seed: number): number[] {
  const game = createInitialGame(71)
  const input = teamInputFromLineup(game.roster, game.lineup, { id: 'a', name: 'A', color: '#fff', accent: '#000' })
  const engine = new MatchEngine({ seed, home: input, away: structuredClone(input), knockout: false, durationSeconds: LOGIC_MATCH_SECONDS })
  const gaps: number[] = []
  while (!engine.state.finished) {
    const before = engine.state.clock
    engine.step()
    gaps.push(engine.state.clock - before)
  }
  return gaps
}

describe('比赛画面的节奏', () => {
  it('友谊赛：一步越长播得越久，有上下限', () => {
    expect(friendlyStepMs(8, 300)).toBeGreaterThan(friendlyStepMs(4.1, 300))
    expect(friendlyStepMs(4.1, 300)).toBeGreaterThan(friendlyStepMs(2, 300))
    expect(friendlyStepMs(4.1, 300)).toBeCloseTo(300, 5)
    expect(friendlyStepMs(0, 300)).toBeCloseTo(90, 5)
    expect(friendlyStepMs(100, 300)).toBeCloseTo(750, 5)
  })

  it('友谊赛：速度档还是原来的快慢，一场总时长基本不变', () => {
    for (const speed of [4000, 2700, 1350]) {
      const gaps = [1, 2, 3].flatMap(stepSeconds)
      const total = gaps.reduce((sum, gap) => sum + friendlyStepMs(gap, speed), 0)
      const before = gaps.length * speed
      expect(total / before).toBeGreaterThan(0.8)
      expect(total / before).toBeLessThan(1.25)
    }
  })

  it('友谊赛正常档一场约 9–10 分钟，慢档约 13–15 分钟，快档约 4–5 分钟', () => {
    const gaps = [1, 2, 3, 4, 5, 6].flatMap(stepSeconds)
    // 一场比赛约 226 步：用上面这些步长估平均每步耗时，再乘回去。
    const oneMatch = (speed: number) => (gaps.reduce((sum, gap) => sum + friendlyStepMs(gap, speed), 0) / gaps.length) * 226 / 1000
    expect(oneMatch(2700)).toBeGreaterThan(8 * 60)
    expect(oneMatch(2700)).toBeLessThan(11 * 60)
    expect(oneMatch(4000)).toBeGreaterThan(12 * 60)
    expect(oneMatch(1350)).toBeLessThan(6 * 60)
  })

  it('联赛：队列使用真实动作时长，不再每回合额外拖慢800ms', () => {
    const scale = (LEAGUE_REALTIME_SECONDS / LOGIC_MATCH_SECONDS) * 1000
    for (const logical of [2, 4.3, 7, 10]) {
      expect(leagueTweenMs(logical, LOGIC_MATCH_SECONDS)).toBeCloseTo(logical * scale)
    }
    expect(leagueTweenMs(0, LOGIC_MATCH_SECONDS)).toBe(80)
    expect(leagueTweenMs(600, LOGIC_MATCH_SECONDS)).toBe(12_000)
    expect(leagueTweenMs(5, 0)).toBeGreaterThan(0)
  })

  it('球员的小幅走动：幅度不超过 1 米，每个人步调不同，随时间变化', () => {
    const ids = ['home:a-1', 'home:a-2', 'away:a-1', 'away:b-7']
    const samples = ids.map((id) => idleSway(id, 12.3))
    for (let t = 0; t < 200; t += 0.37) {
      for (const id of ids) {
        const { x, y } = idleSway(id, t)
        expect(Math.abs(x)).toBeLessThanOrEqual(0.8)
        expect(Math.abs(y)).toBeLessThanOrEqual(0.6)
      }
    }
    expect(new Set(samples.map((item) => item.x.toFixed(3))).size).toBe(ids.length)
    expect(idleSway(ids[0], 1).x).not.toBe(idleSway(ids[0], 2).x)
    expect(idleSway(ids[0], 5)).toEqual(idleSway(ids[0], 5))
  })

  it('球：从实际起点飞到落点，长传有小幅弧度，终点不偏移', () => {
    const from = { x: 20, y: 20 }
    const to = { x: 60, y: 20 }
    const motion = { step: 2, kind: 'pass' as const, from, to }
    expect(ballPosition(0, from, to, motion)).toEqual(from)
    expect(ballPosition(0.5, from, to, motion).x).toBe(40)
    expect(ballPosition(0.5, from, to, motion).y).toBeGreaterThan(20)
    expect(ballPosition(1, from, to, motion).x).toBe(60)
    expect(ballPosition(1, from, to, motion).y).toBeCloseTo(20)
    expect(ballPosition(0.5, from, to, { ...motion, kind: 'shot' }).y).toBe(20)
    const header = { ...motion, kind: 'shot' as const, via: { x: 45, y: 40 } }
    expect(ballPosition(0.65, from, to, header)).toEqual(header.via)
    expect(ballPosition(1, from, to, header)).toEqual(to)
  })
})
