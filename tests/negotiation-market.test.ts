import { beforeEach, describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { createWorldGame } from '../src/game/world.ts'
import { GAME_DAY_MS } from '../src/game/calendar.ts'
import { SQUAD_LIMIT, clubAsking, freeAgentAsking, playerMarketValue, signClubPlayer, signFreeAgent, squadLimitError } from '../src/game/market.ts'
import { starMarketDays } from '../src/game/market-window.ts'
import { negotiationDemands, negotiationRoll, negotiationTerms, SEASON_GOAL_LABELS, SQUAD_ROLE_LABELS } from '../src/game/negotiation.ts'
import { awardSeasonPrize, economyOf, seasonPrize } from '../src/game/economy.ts'
import { startLeagueMatch } from '../src/game/season.ts'
import type { GameState } from '../src/game/types.ts'

function stubLocalStorage(): void {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k), clear: () => store.clear() },
  })
}

/** 把存档的日历挪到某个“今天”（游戏第一天 2026/11/01 + index 天）。 */
function setToday(game: GameState, dayOfMonth: number): void {
  const now = Date.now()
  const daysSinceCalendarStart = Math.max(0, dayOfMonth - 1)
  game.world!.calendarStartAt = now - daysSinceCalendarStart * GAME_DAY_MS
  game.createdAt = game.world!.calendarStartAt
}

describe('身价曲线', () => {
  it('普通球员十几万到几十万，二级能碰到的最贵球星数百万', () => {
    const game = createWorldGame(20241107)
    const all = [...game.roster, ...game.freeStars, ...game.aiTeams.flatMap((team) => team.players)]
    const values = all.map((player) => playerMarketValue(player)).sort((a, b) => a - b)
    const pick = (q: number) => values[Math.min(values.length - 1, Math.floor(values.length * q))]
    expect(pick(0.05)).toBeGreaterThanOrEqual(100_000)
    expect(pick(0.05)).toBeLessThan(400_000)
    expect(pick(0.5)).toBeGreaterThan(400_000)
    expect(pick(0.5)).toBeLessThan(2_000_000)
    // 二级开局看得到的最贵球星在自由市场里；千万级的大牌在更高级别的球队手里。
    expect(values[values.length - 1]).toBeGreaterThanOrEqual(5_000_000)
    expect(values[values.length - 1]).toBeLessThanOrEqual(20_000_000)
  })
})

describe('谈判', () => {
  it('报价越高成功率越高；低于底价直接为零', () => {
    const game = createWorldGame(20241107)
    const player = game.freeStars[0]
    const demands = negotiationDemands(game, player)
    const value = playerMarketValue(player)
    const clubTier = game.season.tier ?? 'division2'
    const answers = { goal: demands.goal, role: demands.role }
    const at = (offer: number) => negotiationTerms({ demands, value, asking: value, offer, answers, clubTier, clubId: 'player' }).chance
    expect(at(value - 1)).toBe(0)
    expect(at(value)).toBeGreaterThan(0.3)
    expect(at(value * 2)).toBeGreaterThan(at(value))
    expect(at(value * 3)).toBeGreaterThanOrEqual(0.9)
  })

  it('承诺的目标/位置低于他的要求会明显降成功率', () => {
    const game = createWorldGame(20241107)
    const player = game.freeStars.find((item) => item.starKey)!
    const demands = negotiationDemands(game, player)
    const value = playerMarketValue(player)
    const clubTier = 'champions' as const
    const good = negotiationTerms({ demands, value, asking: value, offer: value * 1.2, answers: { goal: demands.goal, role: demands.role }, clubTier, clubId: 'player' }).chance
    const bad = negotiationTerms({ demands, value, asking: value, offer: value * 1.2, answers: { goal: 'survival', role: 'rotation' }, clubTier, clubId: 'player' }).chance
    expect(good).toBeGreaterThan(bad)
    expect(SEASON_GOAL_LABELS[demands.goal]).toBeTruthy()
    expect(SQUAD_ROLE_LABELS[demands.role]).toBeTruthy()
  })

  it('同一份报价结果固定，换报价才重新掷骰', () => {
    const game = createWorldGame(20241107)
    const player = game.freeStars[0]
    const demands = negotiationDemands(game, player)
    const answers = { goal: demands.goal, role: demands.role }
    const value = playerMarketValue(player)
    const chance = negotiationTerms({ demands, value, asking: value, offer: value * 1.3, answers, clubTier: 'division2', clubId: 'player' }).chance
    const first = negotiationRoll(game.seed, player, value * 1.3, answers, chance)
    for (let index = 0; index < 5; index++) expect(negotiationRoll(game.seed, player, value * 1.3, answers, chance)).toBe(first)
  })

  it('钱给够就能签下自由球员，余额按报价扣', () => {
    const game = createWorldGame(20241107)
    setToday(game, 5)
    const player = game.freeStars.find((item) => item.starKey && starMarketDays(item)!.includes(5))!
    const demands = negotiationDemands(game, player)
    const value = freeAgentAsking(game, player)
    economyOf(game).balance = value * 10
    const before = economyOf(game).balance
    // 98% 成功率也有失手的时候：换报价重试，直到谈成为止。
    let offer = value * 5
    let result = signFreeAgent(game, player.id, offer, { goal: demands.goal, role: demands.role })
    for (let attempt = 0; attempt < 4 && !result.ok; attempt++) {
      offer += value
      result = signFreeAgent(game, player.id, offer, { goal: demands.goal, role: demands.role })
    }
    expect(result.ok).toBe(true)
    expect(economyOf(game).balance).toBe(before - offer)
    expect(game.roster.some((item) => item.id === player.id)).toBe(true)
  })

  it('不在挂牌日的球星签不了，也买不了', () => {
    const game = createWorldGame(20241107)
    const star = game.freeStars.find((item) => item.starKey && !starMarketDays(item)!.includes(5))!
    setToday(game, 5)
    const demands = negotiationDemands(game, star)
    economyOf(game).balance = 99_000_000
    const result = signFreeAgent(game, star.id, freeAgentAsking(game, star) * 3, { goal: demands.goal, role: demands.role })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('不在市场')
  })

  it('从 AI 球队买人要走谈判：底价是估值 1.5 倍', () => {
    const game = createWorldGame(20241107)
    const team = game.aiTeams[0]
    const player = team.players.find((item) => !item.starKey)!
    const asking = clubAsking(game, player)
    expect(asking).toBeGreaterThanOrEqual(Math.round(playerMarketValue(player) * 1.5))
    const demands = negotiationDemands(game, player)
    economyOf(game).balance = asking * 10
    const result = signClubPlayer(game, team.id, player.id, asking * 5, { goal: demands.goal, role: demands.role })
    expect(result.ok).toBe(true)
    expect(team.players.some((item) => item.id === player.id)).toBe(false)
    expect(game.roster.some((item) => item.id === player.id)).toBe(true)
  })
})

describe('排名奖金与阵容上限', () => {
  it('冠军联赛第一 2000 万、二级第一 60 万，名次越低越少', () => {
    expect(seasonPrize('champions', 1)).toBe(20_000_000)
    expect(seasonPrize('division1', 1)).toBe(6_000_000)
    expect(seasonPrize('division2', 1)).toBe(600_000)
    expect(seasonPrize('champions', 20)).toBeLessThan(seasonPrize('champions', 2))
    expect(seasonPrize(undefined, 1)).toBe(600_000)
  })

  it('赛季结束只发一次排名奖金', () => {
    const game = createInitialGame(7)
    game.season.finished = true
    game.season.playerFinish = 3
    game.season.tier = 'division1'
    const before = economyOf(game).balance
    const prize = awardSeasonPrize(game)
    expect(prize).toBe(seasonPrize('division1', 3))
    expect(economyOf(game).balance).toBe(before + prize)
    expect(awardSeasonPrize(game)).toBe(0)
  })

  it(`阵容超过 ${SQUAD_LIMIT} 人时不能开赛，但签人本身不拦`, () => {
    const game = createInitialGame(8)
    const spare = structuredClone(game.roster[0])
    while (game.roster.length <= SQUAD_LIMIT) game.roster.push({ ...structuredClone(spare), id: `extra-${game.roster.length}` })
    expect(squadLimitError(game)).toContain('超过')
    const result = startLeagueMatch(game, 100)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('超过')
  })
})
