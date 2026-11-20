import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { awardAISeasonCup, awardSeasonCupChampion, awardSeasonCupMatch } from '../src/game/season-cup-rewards.ts'
import { SEASON_CUP_REWARDS } from '../src/game/data/season-cup-rewards.ts'
import { applyCupCeilingReward, cupCeilingBonus, ensureCupCeilingClaims, effectiveClubCeilings } from '../src/game/cup-rewards.ts'
import { simulateAITrainingSession } from '../src/game/ai-training.ts'
import { createAIClub } from '../src/game/ai-club.ts'
import { startTraining } from '../src/game/actions.ts'
import type { TrophyRecord } from '../src/game/types.ts'

const trophy = (id: string, season = 1): TrophyRecord => ({ cupId: `season-${id}`, cupName: id, seasonIndex: season, wonAt: 1, finalOpponent: '对手', finalScore: { home: 1, away: 0 } })

describe('赛季杯赛金币与上限奖励', () => {
  it('双方每场都有参赛金，重复同步和重启不重复发放', () => {
    const game = createInitialGame(1001)
    const before = game.economy!.balance
    expect(awardSeasonCupMatch(game, 'community', 'm1')).toBe(50_000)
    expect(awardSeasonCupMatch(game, 'community', 'm1')).toBe(0)
    expect(awardSeasonCupMatch(game, 'cross', 'm2')).toBe(100_000)
    expect(game.economy!.balance).toBe(before + 150_000)
    const restored = JSON.parse(JSON.stringify(game)) as typeof game
    expect(awardSeasonCupMatch(restored, 'community', 'm1')).toBe(0)
    expect(restored.economy!.balance).toBe(before + 150_000)
  })

  it('冠军每赛季有额外金币，奖杯上限仅取最高值不叠加且兼容旧挑战杯；传奇杯首冠发彩书《传奇之星》', () => {
    const game = createInitialGame(1002)
    const initial = game.economy!.balance
    const player = game.roster.find(item => item.positions.GK === 0)!
    const raw = player.ceilings.passing
    expect(startTraining(game, player.id, 7).ok).toBe(true)
    expect(applyCupCeilingReward(game, 'community')).toBe(100)
    const old = trophy('community')
    expect(awardSeasonCupChampion(game, 'community', 1, old)).toEqual({ gold: 300_000, ceiling: 0 })
    expect(old.goldPrize).toBe(300_000)
    expect(old.ceilingBonus).toBeUndefined()
    expect(awardSeasonCupChampion(game, 'community', 1, old)).toEqual({ gold: 0, ceiling: 0 })
    const cross = trophy('cross')
    expect(awardSeasonCupChampion(game, 'cross', 1, cross)).toEqual({ gold: 1_500_000, ceiling: 250 })
    game.pve!.trophies.push(cross)
    expect(cupCeilingBonus(game)).toBe(250)
    expect(game.training[player.id].cupCeilingBonus).toBe(250)
    expect(effectiveClubCeilings(player, cupCeilingBonus(game)).passing).toBe(Math.min(2000, raw + 250))
    ensureCupCeilingClaims(game)
    expect(cupCeilingBonus(game)).toBe(250)
    expect(awardSeasonCupChampion(game, 'cross', 2, trophy('cross', 2))).toEqual({ gold: 1_500_000, ceiling: 0 })
    expect(cupCeilingBonus(game)).toBe(250)
    // 传奇杯首次夺冠不叠加属性上限，改发专属彩书《传奇之星》；第二次夺冠不再重复发书
    const legend1 = trophy('legend', 2)
    expect(awardSeasonCupChampion(game, 'legend', 2, legend1)).toEqual({
      gold: 3_000_000,
      ceiling: 0,
      book: { id: 'lg_legend_star', tier: 'rainbow' },
    })
    expect(legend1.ceilingBonus).toBeUndefined()
    expect(legend1.rewardBook).toEqual({ id: 'lg_legend_star', tier: 'rainbow' })
    expect(cupCeilingBonus(game)).toBe(250)
    expect(game.legendBooks?.filter((b) => b.id === 'lg_legend_star')).toEqual([{ id: 'lg_legend_star', tier: 'rainbow' }])
    expect(awardSeasonCupChampion(game, 'legend', 3, trophy('legend', 3))).toEqual({ gold: 3_000_000, ceiling: 0 })
    expect(game.legendBooks?.filter((b) => b.id === 'lg_legend_star')).toHaveLength(1)
    expect(game.economy!.balance).toBe(initial + 300_000 + 1_500_000 * 2 + 3_000_000 * 2)
  })

  it('AI 奖金同样幂等，上限加成应用到后续培养', () => {
    const ai = createAIClub({ id: 'ai', tier: 'division2' }, 2)
    const before = ai.economy.balance
    awardAISeasonCup(ai, 'community', 'm1', 1, true)
    awardAISeasonCup(ai, 'community', 'm1', 1, true)
    expect(ai.economy.balance).toBe(before + SEASON_CUP_REWARDS.community.appearance + SEASON_CUP_REWARDS.community.champion)
    expect(ai.cupCeilingClaims?.community).toBe(true)
    const game = createInitialGame(1003)
    const session = simulateAITrainingSession(game.roster[0], 4, ai.economy, 1, 100)
    expect(session.cupCeilingBonus).toBe(100)
  })
})
