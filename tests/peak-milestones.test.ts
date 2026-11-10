import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { awardPeakMilestone, applyPeakBreakthrough, ensurePeakMilestones } from '../src/game/peak-milestones.ts'
import { mainAttrsFor } from '../src/game/rating.ts'
import { startTraining } from '../src/game/actions.ts'
import { effectiveTrainingCeilings } from '../src/game/cup-rewards.ts'

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

  it('金币/球迷交替发放，5 张突破卡分布正确', () => {
    const game = createInitialGame(91)
    const money = game.economy!.balance
    const fans = game.economy!.fans
    expect(awardPeakMilestone(game, 10)).toBe(true)
    expect(game.economy!.balance).toBe(money + 300_000)
    expect(awardPeakMilestone(game, 20)).toBe(true)
    expect(game.economy!.fans).toBe(fans + 500)
    for (const stage of [30, 40, 60, 70, 80]) awardPeakMilestone(game, stage)
    expect(game.pve!.peak.breakthroughCards).toBe(5)
    expect(game.pve!.peak.claimedMilestones).toEqual([10, 20, 30, 40, 60, 70, 80])
    expect(awardPeakMilestone(game, 30)).toBe(false)
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

  it('旧进度加载时补发里程碑奖励', () => {
    const game = createInitialGame(93)
    game.pve!.peak.cleared = 80
    expect(ensurePeakMilestones(game)).toBe(true)
    expect(game.pve!.peak.breakthroughCards).toBe(5)
    expect(game.pve!.peak.claimedMilestones).toContain(80)
    expect(ensurePeakMilestones(game)).toBe(false)
  })
})
