import { describe, expect, it } from 'vitest'
import { clubRatings, lineupRating, opponentRankShare } from '../src/game/club-rating.ts'
import { awardRoundIncome, economyOf, fansAfterResult, lossWeightByRank, LOSS_WEIGHT_VS_STRONGEST, LOSS_WEIGHT_VS_WEAKEST } from '../src/game/economy.ts'
import { createWorldGame } from '../src/game/world.ts'
import type { GameState, PlayerCard } from '../src/game/types.ts'

function ranked(game: GameState): string[] {
  return [...clubRatings(game).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id)
}

/** 玩家第 1 轮 0-1 输给 opponentId，返回球迷变化。 */
function fansAfterLosingTo(game: GameState, opponentId: string, fans = 20000): number {
  const copy = structuredClone(game)
  copy.season.fixtures = [{ round: 1, homeId: 'player', awayId: opponentId, isPlayer: true, played: true, score: { home: 0, away: 1 } }] as GameState['season']['fixtures']
  const economy = economyOf(copy)
  economy.fans = fans
  economy.lastIncomeRound = 0
  awardRoundIncome(copy, 1)
  return economy.fans - fans
}

describe('一阵评分', () => {
  const game = createWorldGame(5)

  it('本联赛每支球队都有评分，评分是首发每人最强卡的 CA 之和', () => {
    const ratings = clubRatings(game)
    expect(ratings.size).toBe(game.aiTeams.length + 1)
    expect(ratings.has('player')).toBe(true)
    for (const rating of ratings.values()) expect(rating).toBeGreaterThan(0)
    expect(lineupRating(game.roster, game.lineup)).toBe(ratings.get('player'))
  })

  it('球员库存里最强的那张卡才算，不看装备哪张，弱卡不会拉低评分', () => {
    const base = lineupRating(game.roster, game.lineup, [])
    const starter = game.roster.find((player) => player.id === game.lineup.starters[0].playerId)!
    const scale = (factor: number) => Object.fromEntries(Object.entries(starter.attrs).map(([key, value]) => [key, value * factor]))
    const strong = { id: 'c1', playerId: starter.id, attrs: scale(1.08), positions: starter.positions } as unknown as PlayerCard
    const weak = { id: 'c2', playerId: starter.id, attrs: scale(0.8), positions: starter.positions } as unknown as PlayerCard
    expect(lineupRating(game.roster, game.lineup, [weak])).toBe(base)
    expect(lineupRating(game.roster, game.lineup, [strong])).toBeGreaterThan(base)
    expect(lineupRating(game.roster, game.lineup, [weak, strong])).toBe(lineupRating(game.roster, game.lineup, [strong]))
    // 板凳上的人不算。
    const bench = game.roster.find((player) => !game.lineup.starters.some((item) => item.playerId === player.id))!
    const benchCard = { id: 'c3', playerId: bench.id, attrs: scale(1.5), positions: bench.positions } as unknown as PlayerCard
    expect(lineupRating(game.roster, game.lineup, [benchCard])).toBe(base)
  })

  it('对手排位：最强的一队是 0，最弱的一队是 1，找不到对手是 null', () => {
    const order = ranked(game)
    expect(opponentRankShare(game, order[0])).toBe(0)
    expect(opponentRankShare(game, order[order.length - 1])).toBe(1)
    expect(opponentRankShare(game, order[Math.floor(order.length / 2)])).toBeGreaterThan(0)
    expect(opponentRankShare(game, 'nobody')).toBeNull()
  })
})

describe('输球掉球迷看对手排位', () => {
  it('对手越弱力度越大，只影响输球', () => {
    expect(lossWeightByRank(0)).toBe(LOSS_WEIGHT_VS_STRONGEST)
    expect(lossWeightByRank(1)).toBe(LOSS_WEIGHT_VS_WEAKEST)
    expect(lossWeightByRank(0.3)).toBeLessThan(lossWeightByRank(0.7))
    expect(fansAfterResult(20000, 0, 1, 0)).toBe(20000)
    expect(fansAfterResult(20000, 0, 1, 0.1)).toBeLessThan(20000)
    expect(20000 - fansAfterResult(20000, 0, 1, 0.1)).toBeLessThan(20000 - fansAfterResult(20000, 0, 1, 1.6))
    expect(fansAfterResult(20000, 1, 0, 0.1)).toBe(fansAfterResult(20000, 1, 0, 1.6))
    expect(fansAfterResult(20000, 1, 1, 0.1)).toBe(fansAfterResult(20000, 1, 1, 1.6))
  })

  it('同一场 0-1，输给联赛最强的一队几乎不掉，输给最弱的一队掉得最多', () => {
    const game = createWorldGame(5)
    const opponents = ranked(game).filter((id) => id !== 'player')
    const strongest = fansAfterLosingTo(game, opponents[0])
    const middle = fansAfterLosingTo(game, opponents[Math.floor(opponents.length / 2)])
    const weakest = fansAfterLosingTo(game, opponents[opponents.length - 1])
    expect(strongest).toBeLessThanOrEqual(0)
    expect(weakest).toBeLessThan(middle)
    expect(middle).toBeLessThan(strongest)
    expect(Math.abs(weakest)).toBeGreaterThan(Math.abs(strongest) * 5)
  })
})
