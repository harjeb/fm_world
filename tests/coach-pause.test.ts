import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { reserveCoachPause, startSingleChallenge, useCoachPause } from '../src/game/actions.ts'

const friendly = () => {
  const game = createInitialGame(7)
  const started = startSingleChallenge(game, game.aiTeams[0].id)
  expect(started.ok).toBe(true)
  return game
}

describe('教练暂停的扣次规则', () => {
  it('友谊赛默认 3 次教练暂停', () => {
    const game = friendly()
    expect(game.activeMatch!.coachPausesLeft).toBe(3)
  })

  it('同一次暂停里多次调整只扣 1 次', () => {
    const game = friendly()
    const first = reserveCoachPause(game, false)
    expect(first).toEqual({ ok: true, used: true })
    expect(game.activeMatch!.coachPausesLeft).toBe(2)
    // 第二次调整时 alreadyUsed 为 true：既不再扣，也仍然放行。
    const second = reserveCoachPause(game, first.used)
    expect(second).toEqual({ ok: true, used: true })
    expect(game.activeMatch!.coachPausesLeft).toBe(2)
    // 关掉面板再打开（重新开始一次暂停）才会再扣一次。
    const third = reserveCoachPause(game, false)
    expect(third.ok).toBe(true)
    expect(game.activeMatch!.coachPausesLeft).toBe(1)
  })

  it('用完 3 次后拒绝新的调整，但已经开始的暂停仍可继续调整', () => {
    const game = friendly()
    for (let i = 0; i < 3; i++) expect(reserveCoachPause(game, false).ok).toBe(true)
    expect(game.activeMatch!.coachPausesLeft).toBe(0)
    const denied = reserveCoachPause(game, false)
    expect(denied.ok).toBe(false)
    expect(denied.error).toContain('用完')
    expect(reserveCoachPause(game, true).ok).toBe(true)
  })

  it('联赛比赛不能靠这个接口暂停', () => {
    const game = createInitialGame(8)
    game.activeMatch = {
      context: { isLeague: true, round: 1, opponentId: 'x', opponentName: 'X', seed: 1, homeAway: 'home' },
      engineState: {},
      instructions: [],
      lineup: structuredClone(game.lineup),
      startedAt: Date.now(),
      coachPausesLeft: 3,
    }
    const result = reserveCoachPause(game, false)
    expect(result.ok).toBe(false)
    expect(game.activeMatch.coachPausesLeft).toBe(3)
    expect(useCoachPause(game)).toBe(false)
  })
})
