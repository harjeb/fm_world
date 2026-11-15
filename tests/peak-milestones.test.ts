import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { awardPeakMilestone, applyPeakBreakthrough, ensurePeakMilestones } from '../src/game/peak-milestones.ts'
import { mainAttrsFor } from '../src/game/rating.ts'
import { startTraining } from '../src/game/actions.ts'
import { effectiveTrainingCeilings } from '../src/game/cup-rewards.ts'
import { PEAK_MILESTONES, peakStageReward } from '../src/game/data/peak-rewards.ts'
import { MAX_FANS } from '../src/game/economy.ts'
import { applyPveResult } from '../src/game/pve.ts'
import type { MatchContext, MatchRecord } from '../src/game/types.ts'

describe('巅峰里程碑奖励', () => {
  it('updates the active training ceiling without changing attributes or other players', () => {
    const game = createInitialGame(94)
    const player = game.roster.find(item => item.positions.GK === 0)!
    expect(startTraining(game, player.id, 7).ok).toBe(true)
    const session = game.training[player.id]
    const before = session.candidate.ceilings.passing
    const attrs = structuredClone(session.candidate.attrs)
    const other = structuredClone(game.roster.find(item => item.id !== player.id)!)
    game.pve!.peak.breakthroughCards = 2
    expect(applyPeakBreakthrough(game, player.id, 'passing').ok).toBe(true)
    expect(effectiveTrainingCeilings(session).passing).toBe(before + 100)
    expect(session.candidate.attrs).toEqual(attrs)
    expect(game.roster.find(item => item.id === other.id)).toEqual(other)
    expect(applyPeakBreakthrough(game, player.id, 'passing').ok).toBe(true)
    expect(session.candidate.ceilings.passing).toBe(before + 200)
  })

  it('uses the actual capped increase and preserves separate candidate bonuses', () => {
    const game = createInitialGame(95)
    const player = game.roster.find(item => item.positions.GK === 0)!
    player.ceilings.passing = 1950
    expect(startTraining(game, player.id, 7).ok).toBe(true)
    const session = game.training[player.id]
    session.candidate.ceilings.passing = 1900
    game.pve!.peak.breakthroughCards = 1
    expect(applyPeakBreakthrough(game, player.id, 'passing')).toMatchObject({ ok: true, amount: 50 })
    expect(session.candidate.ceilings.passing).toBe(1950)
    expect(player.ceilings.passing).toBe(2000)
  })

  it('leaves completed training snapshots unchanged', () => {
    const game = createInitialGame(96)
    const player = game.roster.find(item => item.positions.GK === 0)!
    expect(startTraining(game, player.id, 7).ok).toBe(true)
    const session = game.training[player.id]
    session.completed = true
    const before = structuredClone(session.candidate)
    game.pve!.peak.breakthroughCards = 1
    expect(applyPeakBreakthrough(game, player.id, 'passing').ok).toBe(true)
    expect(session.candidate).toEqual(before)
  })

  it('每关都有奖励，每十关合计严格等于旧里程碑，总突破卡数不变', () => {
    const game = createInitialGame(91)
    const money = game.economy!.balance
    const fans = game.economy!.fans
    for (const milestone of PEAK_MILESTONES) {
      const rewards = Array.from({ length: 10 }, (_, i) => peakStageReward(milestone.stage - 9 + i)!)
      expect(rewards.every(item => item.amount > 0 && item.kind === milestone.kind)).toBe(true)
      expect(rewards.reduce((total, item) => total + item.amount, 0)).toBe(milestone.amount)
      for (const reward of rewards) expect(awardPeakMilestone(game, reward.stage)).toBe(true)
    }
    expect(game.economy!.balance - money).toBe(PEAK_MILESTONES.filter(item => item.kind === 'money').reduce((sum, item) => sum + item.amount, 0))
    expect(game.economy!.fans - fans).toBe(PEAK_MILESTONES.filter(item => item.kind === 'fans').reduce((sum, item) => sum + item.amount, 0))
    expect(game.pve!.peak.breakthroughCards).toBe(5)
    expect(game.pve!.peak.claimedStageRewards).toHaveLength(100)
    expect(awardPeakMilestone(game, 30)).toBe(false)
    expect(peakStageReward(0)).toBeUndefined()
    expect(peakStageReward(101)).toBeUndefined()
  })

  it('实际胜利逐关发奖，重打已通关不再发；第十关不重复领取整段', () => {
    const game = createInitialGame(100)
    const before = game.economy!.balance
    for (let stage = 1; stage <= 10; stage++) {
      const context = { isLeague: false, mode: 'peak', stage, opponentId: `peak-${stage}`, homeAway: 'home', seed: stage } as MatchContext
      const record = { id: `match-${stage}`, result: 'win', score: { home: 2, away: 0 } } as MatchRecord
      applyPveResult(game, record, context)
      expect(game.economy!.balance).toBe(before + stage * 30_000)
      applyPveResult(game, { ...record, id: `replay-${stage}` }, context)
      expect(game.economy!.balance).toBe(before + stage * 30_000)
    }
    expect(game.pve!.peak.cleared).toBe(10)
    expect(game.pve!.peak.claimedStageRewards).toHaveLength(10)
  })

  it('突破卡只加单项主属性上限 +100，硬顶 2000', () => {
    const game = createInitialGame(92)
    const player = game.roster.find((item) => item.positions.GK === 0)!
    const attr = mainAttrsFor(false)[0]
    player.ceilings[attr] = 1950
    game.pve!.peak.breakthroughCards = 2
    const used = applyPeakBreakthrough(game, player.id, attr)
    expect(used.ok).toBe(true)
    if (used.ok) expect(used.amount).toBe(50)
    expect(player.ceilings[attr]).toBe(2000)
    expect(game.pve!.peak.breakthroughCards).toBe(1)
    const again = applyPeakBreakthrough(game, player.id, attr)
    expect(again.ok).toBe(false)
  })

  it('旧存档已领整十关不重复，未完成的一段按已通关数补发', () => {
    const game = createInitialGame(93)
    const peak = game.pve!.peak
    peak.cleared = 17
    peak.claimedMilestones = [10]
    delete peak.stageRewardVersion
    delete peak.claimedStageRewards
    const money = game.economy!.balance, fans = game.economy!.fans
    expect(ensurePeakMilestones(game)).toBe(true)
    expect(game.economy!.balance).toBe(money)
    expect(game.economy!.fans).toBe(fans + 7 * 50)
    expect(peak.claimedStageRewards).toHaveLength(17)
    expect(awardPeakMilestone(game, 1)).toBe(false)
    for (const stage of [18, 19, 20]) expect(awardPeakMilestone(game, stage)).toBe(true)
    expect(game.economy!.fans).toBe(fans + 500)
    expect(ensurePeakMilestones(game)).toBe(false)
  })

  it('旧进度漏标记的完整里程碑按旧规则补发一次；已有突破卡不重复发', () => {
    const game = createInitialGame(94)
    const peak = game.pve!.peak
    peak.cleared = 80
    peak.claimedMilestones = [10, 20, 30, 40, 50, 60, 70, 80]
    peak.breakthroughCards = 5
    delete peak.stageRewardVersion
    delete peak.claimedStageRewards
    const money = game.economy!.balance, fans = game.economy!.fans
    expect(ensurePeakMilestones(game)).toBe(true)
    expect(game.economy!.balance).toBe(money)
    expect(game.economy!.fans).toBe(fans)
    expect(peak.claimedStageRewards).toHaveLength(80)
    expect(peak.breakthroughCards).toBe(5)
    expect(ensurePeakMilestones(game)).toBe(false)

    const legacy = createInitialGame(95)
    legacy.pve!.peak.cleared = 30
    legacy.pve!.peak.claimedMilestones = []
    delete legacy.pve!.peak.stageRewardVersion
    delete legacy.pve!.peak.claimedStageRewards
    const initial = legacy.economy!.balance
    expect(ensurePeakMilestones(legacy)).toBe(true)
    expect(legacy.economy!.balance).toBe(initial + 300_000 + 500_000)
    expect(legacy.pve!.peak.breakthroughCards).toBe(1)
    expect(ensurePeakMilestones(legacy)).toBe(false)
  })

  it('球迷封顶不溢出，损坏的新账本不会再次补发', () => {
    const game = createInitialGame(96)
    game.economy!.fans = MAX_FANS - 10
    expect(awardPeakMilestone(game, 11)).toBe(true)
    expect(game.economy!.fans).toBe(MAX_FANS)
    game.pve!.peak.cleared = 12
    delete game.pve!.peak.claimedStageRewards
    const balance = game.economy!.balance
    ensurePeakMilestones(game)
    expect(game.economy!.balance).toBe(balance)
    expect(game.pve!.peak.claimedStageRewards).toHaveLength(12)
    expect(ensurePeakMilestones(game)).toBe(false)
  })
})
