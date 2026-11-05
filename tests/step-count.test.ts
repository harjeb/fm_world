import { describe, expect, it } from 'vitest'
import { MatchEngine } from '../src/game/match/engine.ts'
import { inputFor, makeTeams } from './helpers.ts'

// 动画密度由独立轨迹采样补齐，不能靠改比赛钟/额外判定来制造更多进球。
describe('比赛判定回合的基线', () => {
  it('保持原有回合密度与90分钟终场，不因为播放层重写而翻倍判定', () => {
    const { roster, lineup } = makeTeams()
    for (const seed of [1, 7, 23]) {
      const engine = new MatchEngine({
        seed, knockout: false,
        home: inputFor(roster, lineup, 'home', 'Home'),
        away: inputFor(roster, lineup, 'away', 'Away'),
      })
      engine.simulate()
      expect(engine.state.step).toBeGreaterThan(190)
      expect(engine.state.step).toBeLessThan(300)
      expect(engine.state.clock).toBe(engine.state.durationSeconds)
    }
  })
})
