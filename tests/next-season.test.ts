import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { awardRoundIncome, economyOf } from '../src/game/economy.ts'
import { cancelListing, listPlayer, playerMarketValue, settleMarket } from '../src/game/market.ts'
import { catchUpSeason, ROUND_MS, startLeagueMatch, startNextSeason, updateSeasonTable } from '../src/game/season.ts'

function finish(game: ReturnType<typeof createInitialGame>) {
  for (const fixture of game.season.fixtures) fixture.played = true
  game.season.round = 38
  updateSeasonTable(game)
}

describe('next season', () => {
  it('rejects unfinished, active and malformed markets without mutation', () => {
    const game = createInitialGame(42)
    let before = structuredClone(game)
    expect(startNextSeason(game).ok).toBe(false)
    expect(game).toEqual(before)
    finish(game)
    game.activeMatch = {} as typeof game.activeMatch
    before = structuredClone(game)
    expect(startNextSeason(game).ok).toBe(false)
    expect(game).toEqual(before)
    delete game.activeMatch
    game.market = { listings: [null], lastSettledRound: 38 } as unknown as typeof game.market
    before = structuredClone(game)
    expect(startNextSeason(game).ok).toBe(false)
    expect(game).toEqual(before)
  })

  it('carries escrow and state, resets round markers, and starts from now', () => {
    const game = createInitialGame(43)
    const p = game.roster[0]
    game.season.round = 38
    expect(listPlayer(game, p.id, playerMarketValue(p)).ok).toBe(true)
    finish(game)
    const economy = economyOf(game)
    economy.lastIncomeRound = 38
    game.market!.lastSettledRound = 38
    const balance = economy.balance, roster = structuredClone(game.roster), lineup = structuredClone(game.lineup)
    const history = structuredClone(game.matchHistory), challenges = structuredClone(game.challengeHistory)
    const oldSeason = structuredClone(game.season)
    const oldSeed = game.season.seed
    expect(startNextSeason(game, 123456).ok).toBe(true)
    expect(game.seasonHistory).toEqual([oldSeason])
    expect(JSON.parse(JSON.stringify(game)).seasonHistory).toEqual([oldSeason])
    expect(game.season.index).toBe(2)
    expect(game.season.seed).not.toBe(oldSeed)
    expect(game.season.startedAt).toBe(123456)
    expect(game.season.fixtures.find(f => f.round === 1)!.kickoffAt).toBe(123456)
    expect(game.season.fixtures.every(f => !f.played)).toBe(true)
    expect(game.roster).toEqual(roster)
    expect(game.lineup).toEqual(lineup)
    expect(game.matchHistory).toEqual(history)
    expect(game.challengeHistory).toEqual(challenges)
    expect(economy.balance).toBe(balance)
    expect(game.market!.listings.map(l => l.listedRound)).toEqual([1])
    expect(settleMarket(game, 1)).toBe(0)
    expect(game.market!.listings).toHaveLength(1)
    expect(cancelListing(game, p.id).ok).toBe(true)
    expect(game.roster).toContain(p)
    const income = awardRoundIncome(game, 1)
    expect(income).toBeGreaterThan(0)
    expect(awardRoundIncome(game, 1)).toBe(0)
    finish(game)
    const second = structuredClone(game.season)
    expect(startNextSeason(game, 234567).ok).toBe(true)
    expect(game.seasonHistory).toEqual([oldSeason, second])
  })

  it('settles an unpaid last round and market exactly once before resetting their cursors', () => {
    const game = createInitialGame(49)
    game.season.round = 38
    const player = game.roster[0]
    const price = Math.round(playerMarketValue(player) * 0.9)
    expect(listPlayer(game, player.id, price).ok).toBe(true)
    const fixture = game.season.fixtures.find(f => f.round === 38 && f.isPlayer)!
    fixture.score = fixture.homeId === 'player' ? { home: 2, away: 0 } : { home: 0, away: 2 }
    finish(game)
    const economy = economyOf(game)
    economy.lastIncomeRound = 37
    game.market!.lastSettledRound = 37
    const balance = economy.balance
    expect(startNextSeason(game, 123456).ok).toBe(true)
    expect(economy.balance).toBe(balance + 32000 + price)
    expect(economy.lastIncomeRound).toBe(0)
    expect(game.market!.lastSettledRound).toBe(0)
    expect(game.market!.listings).toHaveLength(0)
    expect(game.freeStars.some(item => item.id === player.id)).toBe(true)
    expect(startNextSeason(game, 123456).ok).toBe(false)
    expect(economy.balance).toBe(balance + 32000 + price)
  })

  it('initializes legacy economy and changes league match seeds', () => {
    const game = createInitialGame(44)
    const firstSeed = startLeagueMatch(game, 100).context!.seed
    delete game.activeMatch
    finish(game)
    delete game.economy
    expect(catchUpSeason(game, game.season.startedAt + 100 * ROUND_MS).advanced).toBe(0)
    expect(startNextSeason(game, 1000).ok).toBe(true)
    expect(game.economy!.balance).toBe(100000)
    expect(game.economy!.lastIncomeRound).toBe(0)
    expect(startLeagueMatch(game, 1000).context!.seed).not.toBe(firstSeed)
  })
})
