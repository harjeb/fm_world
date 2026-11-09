import { describe, expect, it } from 'vitest'
import { GAME_DAY_MS } from '../src/game/calendar.ts'
import { matchConditionLoss, settleCondition } from '../src/game/condition.ts'
import { finishActiveMatch, playerFixture, settleGameConditions, simulateFixture } from '../src/game/season.ts'
import { restoreActiveEngine, startSingleChallenge } from '../src/game/actions.ts'
import { createWorldGame } from '../src/game/world.ts'

const HOUR = GAME_DAY_MS / 6

describe('体能：踢满一场掉 70，一个游戏日恢复 30（每小时结算 +5）', () => {
  it('消耗按上场分钟同比例', () => {
    expect(matchConditionLoss(90)).toBe(70)
    expect(matchConditionLoss(45)).toBe(35)
    expect(matchConditionLoss(0)).toBe(0)
  })

  it('每过一个整小时恢复 5 点，不足一小时留到下次；满 100 为止', () => {
    const start = 1_000_000_000_000
    const player = { condition: 30, recoveryAt: start }
    expect(settleCondition(player, start + HOUR * 0.9)).toBe(false)
    expect(player.condition).toBe(30)
    settleCondition(player, start + HOUR * 2.5)
    expect(player.condition).toBe(40)
    expect(player.recoveryAt).toBe(start + HOUR * 2)
    // 再过半小时凑满第 3 小时
    settleCondition(player, start + HOUR * 3)
    expect(player.condition).toBe(45)
    // 一个游戏日（6 小时）恢复 30
    settleCondition(player, start + HOUR * 9)
    expect(player.condition).toBe(75)
    settleCondition(player, start + HOUR * 100)
    expect(player.condition).toBe(100)
  })

  it('第一次结算只记时间；给了上一场的开球时间就从那时候开始算', () => {
    const start = 1_000_000_000_000
    const fresh = { condition: 30 } as { condition: number; recoveryAt?: number }
    expect(settleCondition(fresh, start)).toBe(true)
    expect(fresh.condition).toBe(30)
    expect(fresh.recoveryAt).toBe(start)
    const played = { condition: 30 } as { condition: number; recoveryAt?: number }
    settleCondition(played, start, GAME_DAY_MS, start - 4 * HOUR)
    expect(played.condition).toBe(50)
  })

  it('单机自动结算的联赛：踢满 90 分钟的首发从 100 掉到 30', () => {
    const game = createWorldGame(5150)
    for (const player of [...game.roster, ...game.aiTeams.flatMap((team) => team.players)]) player.condition = 100
    const fixture = playerFixture(game)!
    const record = simulateFixture(game, fixture, true, fixture.kickoffAt)!
    const full = record.playerStats.filter((stat) => stat.minutes >= 90 && (stat.sourceId ?? '').length > 0)
    expect(full.length).toBeGreaterThan(10)
    for (const stat of full) {
      const player = [...game.roster, ...game.aiTeams.flatMap((team) => team.players)].find((item) => item.id === stat.sourceId)!
      expect(player.condition).toBeCloseTo(100 - (70 * stat.minutes) / 90, 6)
    }
  })

  it('挑战里的比赛（友谊赛）不扣体能', () => {
    const game = createWorldGame(5152)
    for (const player of [...game.roster, ...game.aiTeams.flatMap((team) => team.players)]) {
      player.condition = 80
      delete player.recoveryAt
    }
    const now = Date.now()
    expect(startSingleChallenge(game, game.aiTeams[0].id, now).ok).toBe(true)
    const engine = restoreActiveEngine(game)!
    engine.simulate()
    const record = finishActiveMatch(game, engine, now)!
    expect(record.isLeague).toBe(false)
    expect(record.playerStats.some((stat) => stat.minutes >= 90)).toBe(true)
    for (const player of [...game.roster, ...game.aiTeams.flatMap((team) => team.players)]) expect(player.condition).toBe(80)
  })

  it('休息按时间恢复：一整个游戏日补 30', () => {
    const game = createWorldGame(5151)
    const start = Date.now()
    const player = game.roster[0]
    player.condition = 30
    player.recoveryAt = start
    settleGameConditions(game, start + GAME_DAY_MS)
    expect(player.condition).toBe(60)
  })
})
