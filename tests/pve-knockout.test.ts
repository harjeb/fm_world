import { beforeAll, describe, expect, it } from 'vitest'
import { loadPveContent } from '../src/game/pve-content.ts'
beforeAll(loadPveContent)
import { buildPeakTeam } from '../src/game/peak.ts'
import { teamInputFromAI } from '../src/game/match/setup.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { PesEngine } from '../src/game/pes/engine.ts'
import { needsShootout } from '../src/game/match/knockout.ts'

describe('杯赛平局与两回合点球', () => {
  it('只有总比分相等才点球，单场比分并非必要条件', () => {
    expect(needsShootout(false, { home: 0, away: 0 })).toBe(false)
    expect(needsShootout(true, { home: 0, away: 0 }, { home: 2, away: 1 })).toBe(false)
    expect(needsShootout(true, { home: 1, away: 2 }, { home: 2, away: 1 })).toBe(true)
  })

  for (const type of ['pes', 'legacy'] as const) it(`${type}：比赛日志、战报和读档一致使用总比分规则`, () => {
    const home = buildPeakTeam(1), away = buildPeakTeam(2)
    const options = { seed: 812, home: teamInputFromAI(home), away: teamInputFromAI(away), knockout: false, durationSeconds: 30, offside: true, rulesVersion: 2 }
    const create = (knockout: boolean, shootoutOffset?: { home: number; away: number }) => type === 'pes'
      ? new PesEngine({ ...options, knockout, shootoutOffset }) : new MatchEngine({ ...options, knockout, shootoutOffset, recordPlayback: false })
    const regular = create(false).simulate()
    expect(regular.shootout).toBeNull()
    const offset = { home: regular.score.away, away: regular.score.home }
    const aggregateTie = create(true, offset)
    aggregateTie.step()
    const saved = JSON.parse(JSON.stringify(aggregateTie.serialize()))
    const resumed = type === 'pes' ? PesEngine.restore(saved) : MatchEngine.restore(saved, true)
    const result = resumed.simulate()
    expect(result.score).toEqual(regular.score)
    expect(result.shootout).not.toBeNull()
    expect(result.shootout!.home).not.toBe(result.shootout!.away)
    expect(result.log.some((entry) => entry.type === 'penalty')).toBe(true)
    const notTied = create(true, { home: offset.home + 1, away: offset.away }).simulate()
    expect(notTied.score).toEqual(regular.score)
    expect(notTied.shootout).toBeNull()
  })
})
