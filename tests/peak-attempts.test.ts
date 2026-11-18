import { beforeAll, describe, expect, it } from 'vitest'
import { loadPveContent } from '../src/game/pve-content.ts'
import { createInitialGame } from '../src/game/state.ts'
import { DAY_MS, nextBeijingMidnight } from '../src/game/calendar.ts'
import { finishMatch, restoreActiveEngine, startPeakChallenge } from '../src/game/actions.ts'
import { PEAK_DAILY_LIMIT, peakDailyStatus } from '../src/game/peak-attempts.ts'
import { applyPveResult } from '../src/game/pve.ts'
import type { MatchContext, MatchRecord } from '../src/game/types.ts'

beforeAll(loadPveContent)

describe('巅峰之路每日次数与重试', () => {
  it('所有关卡共用每天 10 次（北京时间 00:00 重置），开赛消耗；刷新与跨日正确', () => {
    const game = createInitialGame(2028)
    const start = Date.UTC(2026, 10, 14, 1) // 北京时间 09:00
    game.pve!.peak.cleared = 1
    const seeds: number[] = [], keys: (string | number | undefined)[] = []
    for (let i = 0; i < PEAK_DAILY_LIMIT; i++) {
      const stage = i % 2 === 0 ? 1 : 2
      expect(startPeakChallenge(game, stage, start).ok).toBe(true)
      seeds.push(game.activeMatch!.context.seed)
      keys.push(game.activeMatch!.context.recordKey)
      expect(peakDailyStatus(game, start).used).toBe(seeds.length)
      game.activeMatch = undefined
    }
    expect(new Set(seeds).size).toBe(PEAK_DAILY_LIMIT)
    expect(new Set(keys).size).toBe(PEAK_DAILY_LIMIT)
    const restored = JSON.parse(JSON.stringify(game)) as typeof game
    expect(peakDailyStatus(restored, start)).toMatchObject({ used: PEAK_DAILY_LIMIT, remaining: 0 })
    expect(startPeakChallenge(restored, 2, start)).toMatchObject({ ok: false, error: expect.stringContaining(`${PEAK_DAILY_LIMIT} 次`) })
    const midnight = nextBeijingMidnight(start)
    expect(peakDailyStatus(restored, midnight - 1).remaining).toBe(0)
    expect(peakDailyStatus(restored, midnight).remaining).toBe(PEAK_DAILY_LIMIT)
    expect(startPeakChallenge(restored, 2, midnight).ok).toBe(true)
    expect(restored.activeMatch!.context.seed).not.toBe(seeds[1])
    expect(peakDailyStatus(restored, midnight).remaining).toBe(PEAK_DAILY_LIMIT - 1)
  })

  it('无效关卡、未解锁关卡和已有比赛都不会消耗次数', () => {
    const game = createInitialGame(2029)
    const now = Date.UTC(2026, 10, 14, 1)
    for (const stage of [0, 2, 101, 1.5]) expect(startPeakChallenge(game, stage, now).ok).toBe(false)
    expect(peakDailyStatus(game, now).used).toBe(0)
    expect(startPeakChallenge(game, 1, now).ok).toBe(true)
    expect(startPeakChallenge(game, 1, now).ok).toBe(false)
    expect(peakDailyStatus(game, now).used).toBe(1)
  })

  it('时间回退不刷新，离线跳轮次跨越午夜正常刷新', () => {
    const game = createInitialGame(2030)
    const now = Date.UTC(2026, 10, 14, 2)
    expect(startPeakChallenge(game, 1, now).ok).toBe(true)
    game.activeMatch = undefined
    expect(peakDailyStatus(game, now - DAY_MS).used).toBe(1)
    game.season.clockShift = DAY_MS
    expect(peakDailyStatus(game, now).remaining).toBe(PEAK_DAILY_LIMIT)
  })

  it('相同关卡保持固定对手，但每次开赛独立模拟；读档续赛仍确定一致', () => {
    const game = createInitialGame(2031)
    const now = game.createdAt + 1000
    expect(startPeakChallenge(game, 1, now).ok).toBe(true)
    const first = restoreActiveEngine(game)!
    const firstSeed = game.activeMatch!.context.seed
    const firstOpponent = game.activeMatch!.context.opponentName
    const clone = structuredClone(game)
    const resumed = restoreActiveEngine(clone)!
    first.simulate(); resumed.simulate()
    expect(first.serialize()).toEqual(resumed.serialize())
    const record = finishMatch(game, first, now)!
    expect(record).toBeTruthy()
    expect(startPeakChallenge(game, 1, now).ok).toBe(true)
    expect(game.activeMatch!.context.seed).not.toBe(firstSeed)
    expect(game.activeMatch!.context.opponentName).toBe(firstOpponent)
    const retry = restoreActiveEngine(game)!
    retry.simulate()
    expect(retry.state.log).not.toEqual(first.state.log)
  })

  it('重打已通关关卡不重复发里程碑与技能书，也不能跳过未解锁关卡', () => {
    const game = createInitialGame(2032)
    game.pve!.peak.cleared = 80
    const context = { isLeague: false, mode: 'peak', stage: 80, opponentId: 'peak-80', homeAway: 'home', seed: 1 } as MatchContext
    const record = { id: 'old', result: 'win', score: { home: 1, away: 0 } } as MatchRecord
    applyPveResult(game, record, context)
    const money = game.economy!.balance, fans = game.economy!.fans
    const cards = game.pve!.peak.breakthroughCards, books = structuredClone(game.legendBooks)
    applyPveResult(game, { ...record, id: 'again' }, context)
    expect(game.economy!.balance).toBe(money)
    expect(game.economy!.fans).toBe(fans)
    expect(game.pve!.peak.breakthroughCards).toBe(cards)
    expect(game.legendBooks).toEqual(books)
    expect(startPeakChallenge(game, 10, game.createdAt + 1000).ok).toBe(true)
    game.activeMatch = undefined
    expect(startPeakChallenge(game, 82, game.createdAt + 1000).ok).toBe(false)
  })
})
