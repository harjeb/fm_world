import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { createWorldGame } from '../src/game/world.ts'
import { GAME_DAY_MS, advanceSeasonRound, dueRound, nextMatchdayAt, playerFixture, skipToMatchday, skipToPostseasonEnd } from '../src/game/season.ts'
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
/** 北京时间（UTC+8）的小时。 */
const beijingHour = (at: number) => (new Date(at).getUTCHours() + 8) % 24

describe('跳至比赛日（离线存档）', () => {
  // 测试先取 `now`，建档时又各取一次 Date.now()；毫秒一跳（并行跑全套时很常见）就差出 5e-8 个游戏日，
  // “刚好 20 天 / 第 0 天”的断言随机失败。把时钟冻住，三处取到的是同一个值。
  beforeEach(() => {
    stubLocalStorage()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-14T08:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('连踢 5 轮后点一次，日历追到第 6 轮比赛日', () => {
    const now = Date.now()
    const game = createInitialGame(2024)
    playRounds(game, 5, now)
    expect(game.season.round).toBe(6)
    // 存档从今天北京时间 12:00 开始，现在 16:00，还是“第 1 天”；第 6 轮在后天 20:00。
    expect(game.season.startedAt).toBe(Date.UTC(2026, 2, 14, 4))
    expect(gameDayOf(game, now, game.createdAt)).toBe(0)
    const kickoff = kickoffAtForRound(game.season.startedAt, 6)
    expect(kickoff - game.season.startedAt).toBe((2 * 24 + 8) * 60 * 60 * 1000)

    const jump = skipToMatchday(game, now)
    expect(jump.ok).toBe(true)
    expect(jump.gameDays).toBeCloseTo((kickoff - now) / GAME_DAY_MS, 10)
    expect(game.season.round).toBe(6)
    // 日期、轮次、开球时间重新对齐：第 6 轮就在现在。
    expect(gameDayOf(game, now, game.createdAt)).toBe(Math.floor((kickoff - Date.UTC(2026, 2, 14, 4)) / GAME_DAY_MS))
    expect(game.season.clockShift).toBe(kickoff - now)
    expect(kickoffAtForRound(game.season.startedAt, 6, game.season.clockShift)).toBe(now)
    expect(dueRound(game, now)).toBe(6)
    // 存档时钟领先现实：按存档时钟，第 6 轮在 20:00，下一轮在第二天 12:00（16 小时后）。
    expect(beijingHour(now + game.season.clockShift!)).toBe(20)
    expect(nextMatchdayAt(game)).toBe(now + 16 * 60 * 60 * 1000)
    expect(beijingHour(nextMatchdayAt(game) + game.season.clockShift!)).toBe(12)
  })

  it('跳过两次，存档时钟累计领先，赛程仍然对得上', () => {
    const now = Date.now()
    const game = createInitialGame(2025)
    playRounds(game, 2, now)
    const first = skipToMatchday(game, now)
    expect(first.gameDays).toBeGreaterThan(0)
    expect(dueRound(game, now)).toBe(3)
    playRounds(game, 1, now)
    const second = skipToMatchday(game, now)
    expect(second.gameDays).toBeGreaterThan(0)
    expect(dueRound(game, now)).toBe(4)
    expect(kickoffAtForRound(game.season.startedAt, 4, game.season.clockShift)).toBe(now)
    for (const fixture of game.season.fixtures) {
      expect(fixture.kickoffAt).toBe(kickoffAtForRound(game.season.startedAt, fixture.round, game.season.clockShift))
      expect([12, 20]).toContain(beijingHour(fixture.kickoffAt! + game.season.clockShift!))
    }
  })

  it('跳过的日子会恢复体能、精力，并把伤病按时间治好', () => {
    const now = Date.now()
    const game = createInitialGame(77)
    game.season.round = 7
    const player = game.roster.find((item) => item.positions.GK === 0)!
    player.condition = 30
    player.energy = 20
    const injured = game.roster.find((item) => item.positions.W > 0)!
    game.injuries = { [injured.seedId || injured.id]: now + 2 * GAME_DAY_MS }
    const healthy = game.roster.length

    const jump = skipToMatchday(game, now)
    // 第 7 轮在 3 天后的 12:00：68 小时 = 11⅓ 个游戏日。
    expect(jump.gameDays).toBeCloseTo(68 / 6, 10)
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
    const kickoff = kickoffAtForRound(beforeSeason, 6)
    const jump = skipToMatchday(game, now)
    const delta = kickoff - now
    expect(jump.gameDays).toBeCloseTo(delta / GAME_DAY_MS, 10)
    expect(game.world!.calendarStartAt).toBe(beforeCalendar - delta)
    expect(game.world!.seasonStartedAt).toBe(beforeSeason - delta)
    expect(game.world!.clockShift).toBe(delta)
    expect(gameDayOf(game, now, game.world!.calendarStartAt!)).toBe(Math.floor((kickoff - beforeCalendar) / GAME_DAY_MS))
    // 其他分区一起挪：全世界还是同一套开赛时间
    for (const division of game.world!.divisions) {
      expect(division.startedAt).toBe(game.world!.seasonStartedAt)
      expect(division.clockShift).toBe(delta)
    }
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
    expect(seasonEndAt(game.season.startedAt, game.season.clockShift)).toBeLessThanOrEqual(now + 1)
    expect(skipToPostseasonEnd(game, now).gameDays).toBe(0)
  })
})
