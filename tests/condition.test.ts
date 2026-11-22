import { describe, expect, it } from 'vitest'
import { GAME_DAY_MS, HOUR_MS } from '../src/game/calendar.ts'
import { matchConditionLoss, settleCondition } from '../src/game/condition.ts'
import { finishActiveMatch, playerFixture, settleGameConditions, simulateFixture } from '../src/game/season.ts'
import { restoreActiveEngine, startSingleChallenge } from '../src/game/actions.ts'
import { createWorldGame } from '../src/game/world.ts'

const STEP = GAME_DAY_MS / 6

describe('体能：踢满一场掉 70，现实每小时恢复 15（每 20 分钟 +5）', () => {
  it('消耗按上场分钟同比例', () => {
    expect(matchConditionLoss(90)).toBe(70)
    expect(matchConditionLoss(45)).toBe(35)
    expect(matchConditionLoss(0)).toBe(0)
  })

  it('每过完整 20 分钟恢复 5 点，不足一个周期留到下次；满 100 为止', () => {
    const start = 1_000_000_000_000
    const player = { condition: 30, recoveryAt: start }
    expect(settleCondition(player, start + STEP * 0.9)).toBe(false)
    expect(player.condition).toBe(30)
    settleCondition(player, start + STEP * 2.5)
    expect(player.condition).toBe(40)
    expect(player.recoveryAt).toBe(start + STEP * 2)
    settleCondition(player, start + HOUR_MS)
    expect(player.condition).toBe(45)
    settleCondition(player, start + 2 * HOUR_MS)
    expect(player.condition).toBe(60)
    settleCondition(player, start + 4 * HOUR_MS)
    expect(player.condition).toBe(90)
    settleCondition(player, start + 5 * HOUR_MS)
    expect(player.condition).toBe(100)
    expect(settleCondition(player, start + 5 * HOUR_MS)).toBe(false)
  })

  it('离线一次补算与分段结算一致，倒退时间不会重复恢复', () => {
    const start = 1_000_000_000_000
    const offline = { condition: 1, recoveryAt: start }
    const online = { ...offline }
    settleCondition(offline, start + 2 * HOUR_MS)
    for (let step = 1; step <= 6; step++) settleCondition(online, start + step * STEP)
    expect(offline).toEqual(online)
    expect(offline.condition).toBe(31)
    expect(settleCondition(offline, start + HOUR_MS)).toBe(false)
    expect(offline).toEqual(online)
  })

  it('第一次结算只记时间；给了上一场的开球时间就从那时候开始算', () => {
    const start = 1_000_000_000_000
    const fresh = { condition: 30 } as { condition: number; recoveryAt?: number }
    expect(settleCondition(fresh, start)).toBe(true)
    expect(fresh.condition).toBe(30)
    expect(fresh.recoveryAt).toBe(start)
    const played = { condition: 30 } as { condition: number; recoveryAt?: number }
    settleCondition(played, start, GAME_DAY_MS, start - HOUR_MS)
    expect(played.condition).toBe(45)
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

  it('休息按现实时间恢复：两小时补 30', () => {
    const game = createWorldGame(5151)
    const start = Date.now()
    const player = game.roster[0]
    player.condition = 30
    player.recoveryAt = start
    settleGameConditions(game, start + 2 * HOUR_MS)
    expect(player.condition).toBe(60)
  })
})
