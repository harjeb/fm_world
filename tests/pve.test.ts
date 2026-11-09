import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { ensurePve } from '../src/game/pve.ts'
import { finishMatch, restoreActiveEngine, startLegendChallenge, startPeakChallenge } from '../src/game/actions.ts'

describe('PvE 挑战', () => {
  it('旧存档补 PvE 字段', () => {
    const game = createInitialGame(101)
    delete (game as { pve?: unknown }).pve
    expect(ensurePve(game)).toBe(true)
    expect(game.pve).toEqual({
      legends: {},
      peak: { cleared: 0, rewardClaimed: 0, history: [] },
      cups: {},
      trophies: [],
    })
  })

  it('传奇挑战写入战绩，并在战报里标记 legend', () => {
    const game = createInitialGame(2026)
    const start = startLegendChallenge(game, 'milan-1988-89')
    expect(start.ok).toBe(true)
    expect(game.activeMatch?.context.mode).toBe('legend')

    const engine = restoreActiveEngine(game)!
    engine.simulate()
    const record = finishMatch(game, engine)!
    expect(record.mode).toBe('legend')
    expect(game.challengeHistory[0].mode).toBe('legend')

    const row = game.pve!.legends['milan-1988-89']
    expect(row.played).toBe(1)
    expect(row.won + row.drawn + row.lost).toBe(1)
    expect(row.goals).toBe(record.score.home)
    expect(row.conceded).toBe(record.score.away)
  })

  it('巅峰之路只能挑战当前关，结果写入进度和历史', () => {
    const game = createInitialGame(2027)
    expect(startPeakChallenge(game, 2).ok).toBe(false)

    const start = startPeakChallenge(game, 1)
    expect(start.ok).toBe(true)
    expect(game.activeMatch?.context.mode).toBe('peak')
    expect(game.activeMatch?.context.stage).toBe(1)

    const engine = restoreActiveEngine(game)!
    engine.simulate()
    const record = finishMatch(game, engine)!
    expect(record.mode).toBe('peak')
    expect(record.stage).toBe(1)
    expect(game.pve!.peak.history).toHaveLength(1)
    expect(game.pve!.peak.history[0].stage).toBe(1)
    expect(game.pve!.peak.cleared).toBe(record.result === 'win' ? 1 : 0)
  })
})
