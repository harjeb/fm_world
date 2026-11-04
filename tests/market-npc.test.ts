import { describe, expect, it } from 'vitest'
import type { GameState, Player } from '../src/game/types.ts'
import { economyOf } from '../src/game/economy.ts'
import {
  MAX_LISTING_RATIO,
  NPC_BID_RATIO,
  NPC_MAX_DEALS,
  NPC_ROUND_BUDGET,
  listPlayer,
  playerMarketValue,
  saleChance,
  settleMarket,
  suggestedPrice,
} from '../src/game/market.ts'
import { makeTeams, allPlayers } from './helpers.ts'

function game(seed = 42) {
  const { roster, lineup } = makeTeams(30)
  const freeStars = allPlayers().slice(30, 40)
  return {
    seed,
    roster,
    lineup,
    freeStars,
    training: {},
    candidates: {},
    injuries: {},
    season: { round: 1, fixtures: [], index: 1 },
  } as unknown as GameState
}

/** 直接把球员放进托管，等价于 listPlayer 成功之后的状态。 */
function escrow(g: GameState, player: Player, price: number, round = 1) {
  g.roster = g.roster.filter((item) => item.id !== player.id)
  const market = (g.market ??= { listings: [], lastSettledRound: 0 })
  market.listings.push({ player, price, listedRound: round })
}

describe('本地 NPC 报价', () => {
  it('买家只按估值折价收购，要价越高越难成交', () => {
    const value = 10_000
    expect(saleChance(Math.round(value * NPC_BID_RATIO), value)).toBe(1) // 一口价，必成交
    expect(saleChance(value * 0.8, value)).toBe(1) // 折价更好卖
    expect(saleChance(value * 0.95, value)).toBeCloseTo(0.5, 6)
    expect(saleChance(value, value)).toBe(0) // 按估值挂牌没人接
    expect(saleChance(value * 1.2, value)).toBe(0)
    expect(saleChance(Number.NaN, value)).toBe(0)
    expect(saleChance(value, 0)).toBe(0)
    const series = [0.9, 0.93, 0.96, 0.99].map((ratio) => saleChance(value * ratio, value))
    for (let index = 1; index < series.length; index++) expect(series[index]).toBeLessThan(series[index - 1])
  })

  it('建议价就是买家一口价，等于估值九折', () => {
    const g = game()
    const player = g.roster[0]
    expect(suggestedPrice(player)).toBe(Math.round(playerMarketValue(player) * NPC_BID_RATIO))
    expect(listPlayer(g, player.id, suggestedPrice(player)).ok).toBe(true)
    const expected = suggestedPrice(player)
    expect(settleMarket(g, 1)).toBe(expected)
  })

  it('要价高于估值直接拒收，套利环断在挂牌这一步', () => {
    const g = game()
    const player = g.roster[0]
    const value = playerMarketValue(player)
    const before = structuredClone(g)
    expect(listPlayer(g, player.id, Math.round(value * MAX_LISTING_RATIO) + 1).ok).toBe(false)
    expect(listPlayer(g, player.id, value * 2).ok).toBe(false)
    expect(g).toEqual(before)
    expect(settleMarket(g, 1)).toBe(0)
  })

  it('买入 → 加价挂牌 → 回自由市场 → 再买回，不可能产生保证利润', () => {
    const g = game()
    const start = economyOf(g).balance
    const player = g.roster[0]
    const value = playerMarketValue(player)
    economyOf(g).balance -= value // buyFreeAgent 就是按估值收钱
    // 按估值挂牌已经是合法要价的上限，但买家最多出九成：30 轮都无人接盘
    for (let round = 1; round <= 30; round++) {
      g.season.round = round
      if (!g.market?.listings.some((item) => item.player.id === player.id)) escrow(g, player, value)
      expect(settleMarket(g, round)).toBe(0)
    }
    expect(g.freeStars.some((item) => item.id === player.id)).toBe(false)
    expect(economyOf(g).balance).toBe(start - value)
    // 只有折价才卖得掉，卖价必然低于买入价 —— 循环越跑越亏
    expect(suggestedPrice(player)).toBeLessThan(value)
  })

  it('同一轮最多成交 NPC_MAX_DEALS 笔，且受买家预算约束', () => {
    const g = game()
    const listed = g.roster.slice(0, 6)
    for (const player of listed) escrow(g, player, suggestedPrice(player))
    const proceeds = settleMarket(g, 1)
    const sold = g.freeStars.filter((player) => listed.some((item) => item.id === player.id))
    expect(sold.length).toBeGreaterThan(0)
    expect(sold.length).toBeLessThanOrEqual(NPC_MAX_DEALS)
    expect(g.market!.listings).toHaveLength(listed.length - sold.length)
    expect(proceeds).toBe(sold.reduce((sum, player) => sum + suggestedPrice(player), 0))
    // 第一笔可以突破预算，其余受 12 万预算约束
    expect(proceeds).toBeLessThanOrEqual(Math.max(...sold.map(suggestedPrice)) + NPC_ROUND_BUDGET)
  })

  it('同样的种子与轮次得到同样的成交结果', () => {
    const play = () => {
      const g = game(7)
      const listed = g.roster.slice(0, 5)
      for (const player of listed) escrow(g, player, Math.round(playerMarketValue(player) * 0.93))
      const proceeds = settleMarket(g, 1)
      return { proceeds, left: g.market!.listings.length }
    }
    expect(play()).toEqual(play())
  })
})
