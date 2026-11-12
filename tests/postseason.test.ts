import { describe, expect, it } from 'vitest'
import { createWorldGame, ensurePromotionPlayoff, ensureWorldCalendar } from '../src/game/world.ts'
import { GAME_DAY_MS, POSTSEASON_GAME_DAYS, gameDateOf, postseasonStartAt, seasonCalendarStartDay, seasonEndAt, seasonGameDays, seasonStartAt } from '../src/game/calendar.ts'
import { inPostseason, nextSeasonCountdown, skipToPostseasonEnd, startNextSeason } from '../src/game/season.ts'
import { startNextSeasonAction } from '../src/game/actions.ts'
import { chemistryKey, chemistryOf } from '../src/game/chemistry.ts'

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

  it('休整期结束进入下一赛季时，游戏日历直接跳到新一年的 11/01（与球员每赛季 +1 岁同步），休赛期伤病痊愈但保留默契', () => {
    expect(seasonCalendarStartDay(1)).toBe(0)
    expect(seasonCalendarStartDay(2)).toBe(365)
    // 2028 是闰年（含 2028/02/29），2027/11/01 → 2028/11/01 跨 366 天
    expect(seasonCalendarStartDay(3)).toBe(731)
    expect(seasonCalendarStartDay(4)).toBe(1096)

    const game = finishRegularSeason(12)
    const youngPlayer = game.roster.find((p) => (p.age ?? 24) <= 25)!
    const initialAge = youngPlayer.age ?? 24
    const initialId = youngPlayer.id
    const partner = game.roster.find((p) => p.id !== initialId)!
    const season1End = seasonEndAt(game.season.startedAt)

    // 换季前：第 1 赛季休整刚结束，游戏日期在 2027 年 1 月末
    expect(gameDateOf(game.world!.calendarStartAt!, season1End).label).toBe('2027/01/28')

    // 赛末留有 30 个游戏日的伤病与一段队友默契
    const injuredKey = youngPlayer.seedId || youngPlayer.id
    game.injuries = { [injuredKey]: season1End + 30 * GAME_DAY_MS }
    game.chemistry = {
      [chemistryKey(initialId, partner.id)]: {
        players: initialId < partner.id ? [initialId, partner.id] : [partner.id, initialId],
        minutes: 900,
        training: 4,
        lastAt: season1End - 5 * GAME_DAY_MS,
      },
    }

    // 进入第 2 赛季：现实时间仍在 season1End，游戏内日期直接跳到 2027/11/01
    expect(startNextSeason(game, season1End).ok).toBe(true)
    expect(game.season.index).toBe(2)
    expect(gameDateOf(game.world!.calendarStartAt!, game.world!.seasonStartedAt).label).toBe('2027/11/01')
    expect(game.roster.find((p) => p.id === initialId)?.age).toBe(initialAge + 1)
    expect(game.injuries?.[injuredKey]).toBeUndefined()
    expect(chemistryOf(game.chemistry, initialId, partner.id, season1End)).toBeGreaterThan(0)

    // 再踢完第 2 赛季进入第 3 赛季：跳到闰年后的 2028/11/01
    for (const division of game.world!.divisions) {
      for (const fixture of division.fixtures) {
        fixture.played = true
        fixture.score = { home: 0, away: 0 }
      }
    }
    game.season.finished = true
    const season2End = seasonEndAt(game.season.startedAt)
    expect(startNextSeason(game, season2End).ok).toBe(true)
    expect(game.season.index).toBe(3)
    expect(gameDateOf(game.world!.calendarStartAt!, game.world!.seasonStartedAt).label).toBe('2028/11/01')
    expect(game.roster.find((p) => p.id === initialId)?.age).toBe(initialAge + 2)
  })

  it('单机跳过赛后休整并开启新赛季后，当前时刻的顶栏日期直接落在下一年 11/01；旧世界换季存档也会自动对齐年份', () => {
    const game = finishRegularSeason(18)
    const now = game.season.startedAt + 10 * GAME_DAY_MS
    const jump = skipToPostseasonEnd(game, now)
    expect(jump.ok).toBe(true)
    expect(startNextSeasonAction(game, now).ok).toBe(true)
    expect(gameDateOf(game.world!.calendarStartAt!, now).label).toBe('2027/11/01')

    // 模拟旧版未跳年份的第 3 赛季存档：ensureWorldCalendar 会自动修正到 2028/11/01
    game.world!.calendarStartAt = game.world!.seasonStartedAt - 176 * GAME_DAY_MS
    game.world!.seasonIndex = 3
    expect(ensureWorldCalendar(game.world!)).toBe(true)
    expect(gameDateOf(game.world!.calendarStartAt!, game.world!.seasonStartedAt).label).toBe('2028/11/01')
  })
})
