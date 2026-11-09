import { describe, expect, it } from 'vitest'
import { createWorldGame, ensurePromotionPlayoff } from '../src/game/world.ts'
import { GAME_DAY_MS, POSTSEASON_GAME_DAYS, gameDateOf, postseasonStartAt, seasonEndAt, seasonGameDays, seasonStartAt } from '../src/game/calendar.ts'
import { inPostseason, nextSeasonCountdown } from '../src/game/season.ts'
import { startNextSeasonAction } from '../src/game/actions.ts'

/** 把常规赛 38 轮全部补完，模拟“赛季刚结束”。 */
function finishRegularSeason(seed: number) {
  const game = createWorldGame(seed)
  for (const division of game.world!.divisions) {
    for (const fixture of division.fixtures) {
      if (!fixture.played) {
        fixture.played = true
        fixture.score = { home: 1, away: 1 }
      }
    }
  }
  for (const fixture of game.season.fixtures) {
    if (!fixture.played) {
      fixture.played = true
      fixture.score = { home: 1, away: 1 }
    }
  }
  game.season.finished = true
  ensurePromotionPlayoff(game)
  return game
}

describe('赛后休整窗口与日历', () => {
  it('游戏日历从 2026/11/01 开始，每 6 小时过一天', () => {
    const start = Date.UTC(2026, 10, 1)
    expect(gameDateOf(start, start).label).toBe('2026/11/01')
    expect(gameDateOf(start, start + GAME_DAY_MS).label).toBe('2026/11/02')
    expect(gameDateOf(start, start + 61 * GAME_DAY_MS).label).toBe('2027/01/01')
  })

  it('每个赛季在常规赛之后留 12 个游戏日给升级杯，下一赛季接着开始', () => {
    // 北京时间 12:00 开始的赛季：38 轮踢 18 天 8 小时，再过 8 小时进入休整，休整 3 天。
    const start = Date.UTC(2026, 10, 1, 4)
    expect(POSTSEASON_GAME_DAYS).toBe(12)
    expect(seasonEndAt(start) - postseasonStartAt(start)).toBe(12 * GAME_DAY_MS)
    expect(seasonStartAt(start, 1)).toBe(start)
    expect(seasonStartAt(start, 2)).toBe(seasonEndAt(start))
    expect(seasonGameDays(start)).toBe(88)
    expect(gameDateOf(start, seasonStartAt(start, 2)).gameDay).toBe(88)
  })

  it('赛季结束后不能立刻开新赛季，要等休整窗口走完', () => {
    const game = finishRegularSeason(5)
    const started = game.season.startedAt
    expect(inPostseason(game, postseasonStartAt(started) + GAME_DAY_MS)).toBe(true)
    const blocked = startNextSeasonAction(game, postseasonStartAt(started) + GAME_DAY_MS)
    expect(blocked.ok).toBe(false)
    expect(blocked.error).toContain('赛后休整')
    expect(nextSeasonCountdown(game, postseasonStartAt(started) + GAME_DAY_MS)).toContain('天')
    expect(inPostseason(game, seasonEndAt(started))).toBe(false)
  })

  it('常规赛一结束就算好升级杯，休整期间就能看到赛果', () => {
    const game = finishRegularSeason(6)
    // updateSeasonTable 会在补完赛程时把附加赛算好；这里直接走同一入口。
    const playoff = game.world!.promotionPlayoff
    expect(playoff).toBeDefined()
    expect(playoff!.promoted).toHaveLength(3)
    expect(playoff!.finished).toBe(true)
  })
})
