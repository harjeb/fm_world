import { describe, expect, it, beforeEach } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { createWorldGame } from '../src/game/world.ts'
import { GAME_DAY_MS, ROUND_GAME_DAYS, advanceSeasonRound, dueRound, playerFixture, skipToMatchday, skipToPostseasonEnd } from '../src/game/season.ts'
import { kickoffAtForRound, seasonEndAt } from '../src/game/calendar.ts'
import { startLeagueOnMatchday } from '../src/game/actions.ts'
import type { Player } from '../src/game/types.ts'

function stubLocalStorage(): void {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    },
  })
}

/** 直接标记玩家本轮比赛已踢完并结算，不跑引擎，用来快速把轮次推到第 n 轮。 */
function playRounds(game: ReturnType<typeof createInitialGame>, rounds: number, now: number): void {
  for (let index = 0; index < rounds; index++) {
    const fixture = playerFixture(game)
    if (!fixture) throw new Error('缺少玩家赛程')
    fixture.played = true
    fixture.score = { home: 1, away: 0 }
    const result = advanceSeasonRound(game, now)
    if (!result.ok) throw new Error(result.error)
  }
}

const gameDayOf = (game: ReturnType<typeof createInitialGame>, now: number, anchor: number) => Math.floor((now - anchor) / GAME_DAY_MS)

describe('跳至比赛日（离线存档）', () => {
  beforeEach(stubLocalStorage)

  it('连踢 5 轮后点一次，日历追到第 6 轮比赛日', () => {
    const now = Date.now()
    const game = createInitialGame(2024)
    playRounds(game, 5, now)
    expect(game.season.round).toBe(6)
    // 现在还是“第 1 天”，所以第 6 轮按日历算是 20 个游戏日之后。
    expect(gameDayOf(game, now, game.createdAt)).toBe(0)

    const jump = skipToMatchday(game, now)
    expect(jump.ok).toBe(true)
    expect(jump.gameDays).toBe((ROUND_GAME_DAYS * (6 - 1)))
    expect(game.season.round).toBe(6)
    // 日期、轮次、开球时间重新对齐：第 6 轮就在今天。
    expect(gameDayOf(game, now, game.createdAt)).toBe(ROUND_GAME_DAYS * (6 - 1))
    expect(kickoffAtForRound(game.season.startedAt, 6)).toBe(now)
    expect(dueRound(game, now)).toBe(6)
  })

  it('跳过的日子会恢复体能、精力，并把伤病按时间治好', () => {
    const now = Date.now()
    const game = createInitialGame(77)
    game.season.round = 4
    const player = game.roster.find((item) => item.positions.GK === 0)!
    player.condition = 30
    player.energy = 20
    const injured = game.roster.find((item) => item.positions.W > 0)!
    game.injuries = { [injured.seedId || injured.id]: now + 2 * GAME_DAY_MS }
    const healthy = game.roster.length

    const jump = skipToMatchday(game, now)
    expect(jump.gameDays).toBe(ROUND_GAME_DAYS * 3)
    expect(player.condition).toBe(100)
    expect(player.energy).toBeGreaterThan(20)
    expect(game.injuries).toBeDefined()
    expect(Object.keys(game.injuries!).length).toBe(0)
    expect(healthy).toBe(game.roster.length)
  })

  it('世界存档里的日历锚点也跟着走，顶栏日期不会停在创建那天', () => {
    const now = Date.now()
    const game = createWorldGame(20241107)
    game.season.round = 6
    const beforeCalendar = game.world!.calendarStartAt!
    const beforeSeason = game.world!.seasonStartedAt
    const jump = skipToMatchday(game, now)
    expect(jump.gameDays).toBe(ROUND_GAME_DAYS * 5)
    const delta = jump.gameDays * GAME_DAY_MS
    expect(game.world!.calendarStartAt).toBe(beforeCalendar - delta)
    expect(game.world!.seasonStartedAt).toBe(beforeSeason - delta)
    expect(gameDayOf(game, now, game.world!.calendarStartAt!)).toBe(ROUND_GAME_DAYS * 5)
  })

  it('开赛失败就回滚，不会白跳时间', () => {
    const now = Date.now()
    const game = createInitialGame(31)
    game.season.round = 6
    const starter = game.lineup.starters[0]
    game.suspensions = { [starter.playerId]: { matches: 1, atRound: 1 } }
    const before = { startedAt: game.season.startedAt, createdAt: game.createdAt, condition: game.roster.map((p: Player) => p.condition) }

    const result = startLeagueOnMatchday(game, now)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('停赛')
    expect(game.season.startedAt).toBe(before.startedAt)
    expect(game.createdAt).toBe(before.createdAt)
    expect(game.roster.map((p: Player) => p.condition)).toEqual(before.condition)
    expect(game.activeMatch).toBeUndefined()
  })

  it('赛后休整也能跳到结束，之后可以直接开新赛季', () => {
    const now = Date.now()
    const game = createInitialGame(55)
    for (const fixture of game.season.fixtures) {
      fixture.played = true
      fixture.score = fixture.score ?? { home: 0, away: 0 }
    }
    game.season.finished = true
    expect(now).toBeLessThan(seasonEndAt(game.season.startedAt))
    const jump = skipToPostseasonEnd(game, now)
    expect(jump.ok).toBe(true)
    expect(seasonEndAt(game.season.startedAt)).toBeLessThanOrEqual(now + 1)
    expect(skipToPostseasonEnd(game, now).gameDays).toBe(0)
  })
})
