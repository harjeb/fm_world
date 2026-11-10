import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { createTrainingSession } from '../src/game/training.ts'
import { grantBookSkill } from '../src/game/legend-learning.ts'
import { PEAK_SKILL_STAGES, PEAK_SKILLS } from '../src/game/data/peak-skills.ts'
import { applyPveResult, ensurePve } from '../src/game/pve.ts'
import { hasLegendBook } from '../src/game/legend-books.ts'
import type { MatchContext, MatchRecord } from '../src/game/types.ts'

describe('巅峰彩书', () => {
  it('从 80 起每 5 关固定发放一本', () => {
    expect(Object.keys(PEAK_SKILL_STAGES).map(Number)).toEqual([80, 85, 90, 95, 100])
    expect(new Set(Object.values(PEAK_SKILL_STAGES)).size).toBe(5)
  })

  it('学会时两项当前 +100、上限 +50，超过 1500 也保留', () => {
    const game = createInitialGame(81)
    const player = game.roster.find((item) => item.positions.GK === 0)!
    player.attrs.shooting = 1500
    player.ceilings.shooting = 1500
    player.attrs.dribbling = 700
    player.ceilings.dribbling = 700
    const session = createTrainingSession(player, 81, { stadium: 25, academy: 25, medical: 25, shop: 25, sponsor: 25, psychology: 25, tactics: 25 }, 1)
    const result = grantBookSkill(session, { id: 'lg_peak_striker', tier: 'rainbow' })
    expect(result.ok).toBe(true)
    expect(session.candidate.attrs.shooting).toBe(1550)
    expect(session.candidate.ceilings.shooting).toBe(1550)
    expect(session.candidate.attrs.dribbling).toBe(750)
    expect(session.candidate.ceilings.dribbling).toBe(750)
  })

  it('巅峰胜利发书，旧进度在加载时补发', () => {
    const game = createInitialGame(82)
    game.pve!.peak.cleared = 79
    const context = { isLeague: false, mode: 'peak', stage: 80, opponentId: 'peak-80', homeAway: 'home', seed: 1 } as MatchContext
    const record = { id: 'm-peak-80', result: 'win', score: { home: 1, away: 0 } } as MatchRecord
    applyPveResult(game, record, context)
    expect(hasLegendBook(game, 'lg_peak_striker', 'rainbow')).toBe(true)
    const old = createInitialGame(83)
    old.pve!.peak.cleared = 100
    ensurePve(old)
    for (const id of Object.values(PEAK_SKILLS)) expect(hasLegendBook(old, id.id, 'rainbow')).toBe(true)
  })
})
