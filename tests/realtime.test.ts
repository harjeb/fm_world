import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { changeMatchTactics, startLeague, restoreActiveEngine } from '../src/game/actions.ts'
import { advanceLeagueRealtime, leagueElapsed, leagueMatchClock } from '../src/game/realtime.ts'
import { displayClock, MATCH_DISPLAY_SECONDS } from '../src/game/match/time.ts'
import { FORMATIONS } from '../src/game/data/formations.ts'

function started(seed = 1) {
  const game = createInitialGame(seed)
  expect(startLeague(game).ok).toBe(true)
  game.activeMatch!.startedAt = 1_000_000
  return game
}

describe('联赛现实时间', () => {
  it('按现实秒推进且不提前公开事件或终场，重复调用和时钟回拨不倒退', () => {
    const game = started()
    const initial = structuredClone(game)
    const expected = restoreActiveEngine(initial)!.simulate()
    for (const seconds of [0, 1, 15, 299, 300, 301, 599]) {
      advanceLeagueRealtime(game, 1_000_000 + seconds * 1000)
      expect(game.activeMatch).toBeDefined()
      const state = restoreActiveEngine(game)!.state
      expect(leagueElapsed(game.activeMatch!, 0)).toBe(seconds)
      expect(state.commentary!.every((entry) => displayClock(entry.clock, state.durationSeconds) <= seconds * (MATCH_DISPLAY_SECONDS / 600))).toBe(true)
      expect(state.finished).toBe(false)
      const copy = structuredClone(state)
      advanceLeagueRealtime(game, 1_000_000 + seconds * 1000)
      expect(restoreActiveEngine(game)!.state).toEqual(copy)
    }
    advanceLeagueRealtime(game, 1_600_000)
    expect(game.activeMatch).toBeUndefined()
    expect(game.matchHistory).toHaveLength(1)
    expect(game.matchHistory[0].score).toEqual(expected.score)
    expect(game.matchHistory[0].commentary).toEqual(expected.commentary)
    advanceLeagueRealtime(game, 2_000_000)
    expect(game.matchHistory).toHaveLength(1)
  })

  it('实时战术调整按当前时间记入播报，不泄露下一个动作的未来时刻', () => {
    const game = started()
    advanceLeagueRealtime(game, 1_003_000)
    const engine = restoreActiveEngine(game)!
    expect(engine.state.clock).toBeGreaterThan(3)
    expect(changeMatchTactics(game, engine, 'attack').ok).toBe(true)
    expect(engine.state.commentary!.at(-1)!.clock).toBeCloseTo(leagueMatchClock(game.activeMatch!, 1_003_000), 5)
    advanceLeagueRealtime(game, 1_004_000)
    expect(restoreActiveEngine(game)!.state.commentary!.every((entry) => displayClock(entry.clock, game.activeMatch!.context.durationSeconds ?? 900) <= displayClock(leagueMatchClock(game.activeMatch!, 1_004_000), game.activeMatch!.context.durationSeconds ?? 900))).toBe(true)
  })

  it('中场前调整不会让稍后的直播出现倒序事件', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const game = started(seed)
      advanceLeagueRealtime(game, 1_299_000)
      const engine = restoreActiveEngine(game)!
      expect(changeMatchTactics(game, engine, 'attack').ok).toBe(true)
      advanceLeagueRealtime(game, 1_300_000)
      const clocks = restoreActiveEngine(game)!.state.commentary!.map((entry) => entry.clock)
      expect(clocks.every((clock, index) => index === 0 || clock >= clocks[index - 1])).toBe(true)
      expect(displayClock(clocks.at(-1)!, game.activeMatch!.context.durationSeconds ?? 900)).toBeLessThanOrEqual(MATCH_DISPLAY_SECONDS / 2)
    }
    // 12 个种子的半场回归（含后台赛程），不是性能断言；全套并行时需留出 CPU 争用余量。
  }, 15_000)

  it('定时自动换人不提前，重启和分批推进与直接模拟结果一致', () => {
    for (let seed = 1; seed <= 8; seed++) {
      let game = createInitialGame(seed)
      const slots = FORMATIONS[game.lineup.formationId].slots
      const pairs = game.lineup.starters.flatMap((starter) => {
        const position = slots.find((slot) => slot.id === starter.slotId)!.position
        return game.lineup.bench.filter((id) => game.roster.find((player) => player.id === id)!.positions[position] > 0)
          .map((id) => ({ outId: starter.playerId, inId: id }))
      })
      expect(pairs.length).toBeGreaterThan(0)
      game.autoSubs = { timed: [{ atMinute: 45, ...pairs[0] }], staminaBelow: null, onInjury: false }
      expect(startLeague(game).ok).toBe(true)
      game.activeMatch!.startedAt = 1_000_000
      const expected = restoreActiveEngine(structuredClone(game))!.simulate()
      for (const seconds of [0, 100, 299]) {
        advanceLeagueRealtime(game, 1_000_000 + seconds * 1000)
        const own = restoreActiveEngine(game)!.getTeam(game.activeMatch!.context.homeAway)
        expect(own.subsUsed).toBe(0)
        expect(restoreActiveEngine(game)!.state.commentary!.every((entry) => displayClock(entry.clock, game.activeMatch!.context.durationSeconds ?? 900) <= seconds * (MATCH_DISPLAY_SECONDS / 600))).toBe(true)
      }
      game = structuredClone(game)
      advanceLeagueRealtime(game, 1_330_000)
      const own = restoreActiveEngine(game)!.getTeam(game.activeMatch!.context.homeAway)
      expect(own.subsUsed).toBeGreaterThanOrEqual(1)
      expect(own.autoSubs!.timed).toHaveLength(0)
      advanceLeagueRealtime(game, 1_600_000)
      expect(game.matchHistory[0].commentary).toEqual(expected.commentary)
      expect(game.matchHistory[0].instructions).toEqual(expected.instructions)
      expect(game.matchHistory[0].score).toEqual(expected.score)
    }
  }, 20_000)

  it('重启或关页后按经过的真实时间恢复，而不是从零或立刻完成', () => {
    const game = started(2)
    advanceLeagueRealtime(game, 1_020_000)
    const restored = structuredClone(game)
    advanceLeagueRealtime(restored, 1_120_000)
    expect(leagueElapsed(restored.activeMatch!, 1_120_000)).toBe(120)
    expect(displayClock(restoreActiveEngine(restored)!.state.commentary!.at(-1)!.clock, restored.activeMatch!.context.durationSeconds ?? 900)).toBeLessThanOrEqual(120 * (MATCH_DISPLAY_SECONDS / 600))
    expect(restored.matchHistory).toHaveLength(0)
    advanceLeagueRealtime(restored, 1_601_000)
    expect(restored.matchHistory).toHaveLength(1)
  })
})
