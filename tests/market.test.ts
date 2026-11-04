import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/game/types.ts'
import { economyOf } from '../src/game/economy.ts'
import { buyFreeAgent, cancelListing, listPlayer, playerMarketValue, settleMarket } from '../src/game/market.ts'
import { makeTeams, allPlayers } from './helpers.ts'
import { validateLineup } from '../src/game/squad.ts'

function game() {
  const { roster, lineup } = makeTeams(30)
  const freeStars = allPlayers().slice(30, 35)
  return { roster, lineup, freeStars, training: {}, candidates: {}, injuries: {}, season: { round: 1, fixtures: [] } } as unknown as GameState
}

describe('local market', () => {
  it('escrows, repairs lineup and cancels without losing identity or injury', () => {
    const g = game()
    const id = g.lineup.starters[0].playerId
    const player = g.roster.find(p => p.id === id)!
    g.injuries![id] = 123
    expect(listPlayer(g, id, 100).ok).toBe(true)
    expect(g.roster).not.toContain(player)
    expect(validateLineup(g.roster, g.lineup).valid).toBe(true)
    expect(listPlayer(g, id, 100).ok).toBe(false)
    expect(cancelListing(g, id).ok).toBe(true)
    expect(g.roster).toContain(player)
    expect(g.injuries![id]).toBe(123)
  })
  it('buys only with enough funds and never duplicates', () => {
    const g = game(), p = g.freeStars[0], e = economyOf(g)
    e.balance = 0
    expect(buyFreeAgent(g, p.id).ok).toBe(false)
    expect(g.freeStars).toContain(p)
    e.balance = playerMarketValue(p)
    expect(buyFreeAgent(g, p.id).ok).toBe(true)
    expect(e.balance).toBe(0)
    expect(g.roster).toContain(p)
    expect(buyFreeAgent(g, p.id).ok).toBe(false)
  })
  it('settles once per increasing round and leaves overpriced listings', () => {
    const g = game(), p = g.roster[0], q = g.roster[1], e = economyOf(g)
    // 按估值九折挂牌 = 买家一口价，必定成交；按估值挂就没人接
    const price = Math.round(playerMarketValue(p) * 0.9)
    expect(listPlayer(g, p.id, price).ok).toBe(true)
    expect(listPlayer(g, q.id, playerMarketValue(q)).ok).toBe(true)
    const balance = e.balance
    expect(settleMarket(g, 1)).toBe(price)
    expect(e.balance).toBe(balance + price)
    expect(g.freeStars).toContain(p)
    expect(settleMarket(g, 1)).toBe(0)
    expect(settleMarket(g, 2)).toBe(0)
    expect(cancelListing(g, q.id).ok).toBe(true)
    expect(buyFreeAgent(g, p.id).ok).toBe(true)
    expect(g.roster).toContain(p)
  })
  it('rejects malformed escrow atomically across operations', () => {
    const g = game(), p = g.roster[0], free = g.freeStars[0]
    g.market = { listings: null, lastSettledRound: 0 } as unknown as NonNullable<GameState['market']>
    const before = structuredClone(g)
    expect(listPlayer(g, p.id, 100).ok).toBe(false)
    expect(cancelListing(g, p.id).ok).toBe(false)
    expect(buyFreeAgent(g, free.id).ok).toBe(false)
    expect(settleMarket(g, 1)).toBe(0)
    expect(g).toEqual(before)
  })
  it('blocks active-match cancellation and duplicate escrow', () => {
    const g = game(), p = g.roster[0]
    expect(listPlayer(g, p.id, 100).ok).toBe(true)
    expect(listPlayer(g, p.id, 100).ok).toBe(false)
    g.activeMatch = {} as GameState['activeMatch']
    const before = structuredClone(g)
    expect(cancelListing(g, p.id).ok).toBe(false)
    expect(g).toEqual(before)
    delete g.activeMatch
    g.market!.listings.push(g.market!.listings[0])
    const duplicate = structuredClone(g)
    expect(cancelListing(g, p.id).ok).toBe(false)
    expect(settleMarket(g, 1)).toBe(0)
    expect(g).toEqual(duplicate)
  })
  it('does not settle a new listing for an earlier round', () => {
    const g = game(), p = g.roster[0], e = economyOf(g)
    g.market = { listings: [], lastSettledRound: 1 }
    g.season.round = 3
    const price = Math.round(playerMarketValue(p) * 0.9), balance = e.balance
    expect(listPlayer(g, p.id, price).ok).toBe(true)
    expect(settleMarket(g, 2)).toBe(0)
    expect(e.balance).toBe(balance)
    expect(settleMarket(g, 3)).toBe(price)
    expect(g.freeStars.filter(player => player.id === p.id)).toHaveLength(1)
  })
  it('rejects overflow without partial settlement', () => {
    const g = game(), e = economyOf(g), p = g.roster[0]
    expect(listPlayer(g, p.id, Math.round(playerMarketValue(p) * 0.9)).ok).toBe(true)
    e.balance = Number.MAX_SAFE_INTEGER
    const before = structuredClone(g)
    expect(settleMarket(g, 1)).toBe(0)
    expect(g).toEqual(before)
  })
  it('does not lock a player in escrow after the season has ended', () => {
    const g = game(), p = g.roster[0]
    g.season.finished = true
    expect(listPlayer(g, p.id, playerMarketValue(p)).ok).toBe(false)
    expect(g.roster).toContain(p)
    expect(g.market).toBeUndefined()
  })
  it('rejects a malformed player before moving them into escrow', () => {
    const g = game(), p = g.roster[0]
    p.attrs.passing = NaN
    const before = structuredClone(g)
    expect(listPlayer(g, p.id, 100).ok).toBe(false)
    expect(g).toEqual(before)
  })
  it('rejects invalid prices without moving players', () => {
    const g = game(), p = g.roster[0]
    for (const price of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(listPlayer(g, p.id, price).ok).toBe(false)
    expect(g.roster).toContain(p)
  })
})
