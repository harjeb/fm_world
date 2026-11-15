import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { validateLegacyCupSave } from '../server/legacy-cup-guard.ts'
import type { ActiveMatchSave, MatchRecord } from '../src/game/types.ts'

describe('旧版挑战杯迁移保护', () => {
  it('不允许通过旧客户端新开旧杯赛，但允许切换前正在进行的比赛继续和结算', () => {
    const previous = createInitialGame(818)
    const match = { context: { isLeague: false, mode: 'cup', cupId: 'community', cupFixtureId: 'old-1', recordKey: 'old-1', seed: 11, homeAway: 'home', opponentId: 'old-opponent', opponentName: '对手' }, engineState: {}, instructions: [], lineup: previous.lineup, startedAt: 1, coachPausesLeft: 3 } as ActiveMatchSave
    const incoming = structuredClone(previous)
    incoming.activeMatch = structuredClone(match)
    expect(validateLegacyCupSave(previous, incoming)).toContain('旧版挑战杯已关闭')
    previous.activeMatch = structuredClone(match)
    expect(validateLegacyCupSave(previous, incoming)).toBeUndefined()
    incoming.activeMatch!.context.seed++
    expect(validateLegacyCupSave(previous, incoming)).toContain('旧版挑战杯已关闭')
    incoming.activeMatch = undefined
    incoming.challengeHistory.unshift({ id: 'm-old-1-C', mode: 'cup', cupFixtureId: 'old-1', cupId: 'community' } as MatchRecord)
    expect(validateLegacyCupSave(previous, incoming)).toBeUndefined()
    incoming.challengeHistory[0].cupFixtureId = 'other'
    expect(validateLegacyCupSave(previous, incoming)).toContain('旧版挑战杯已关闭')
  })
})
