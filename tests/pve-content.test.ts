import { beforeAll, describe, expect, it } from 'vitest'
import { loadPveContent } from '../src/game/pve-content.ts'
beforeAll(loadPveContent)
import { createHash } from 'node:crypto'
import raw from '../src/game/data/pve-snapshots.generated.json'
import evidence from '../src/game/data/world-cup-evidence.generated.json'
import { NATIONAL_TEAMS } from '../src/game/data/national-teams.ts'
import { LEGEND_TEAMS } from '../src/game/data/legend-teams.ts'
import { buildPeakTeam, peakStageDef } from '../src/game/peak.ts'
import { startingCa } from '../src/game/pve-strength.ts'
import { legendTeamById } from '../src/game/legend.ts'
import { frozenPveTeam } from '../src/game/pve-content.ts'
import { validateLineup } from '../src/game/squad.ts'
import { sortCupTable, emptyCupRow } from '../src/game/cup-table.ts'

describe('PvE 数据冻结与历史名单', () => {
  it('完整属性快照有可复核内容 hash，不依赖运行时画像/随机生成器', () => {
    const { hash, ...body } = raw
    expect(createHash('sha256').update(JSON.stringify(body)).digest('hex')).toBe(hash)
    expect(Object.keys(body.legends)).toHaveLength(50)
    expect(Object.keys(body.peak)).toHaveLength(100)
    expect(Object.keys(body.cups)).toHaveLength(44)
  })

  it('100 关实际首发 CA 单调不降且精确对齐原定 350→1300 曲线', () => {
    let previous = 0
    for (let stage = 1; stage <= 100; stage++) {
      const team = buildPeakTeam(stage), ca = startingCa(team)
      expect(ca + 1e-6).toBeGreaterThanOrEqual(previous)
      expect(ca).toBeCloseTo(peakStageDef(stage).targetCa, 5)
      expect(validateLineup(team.players, team.lineup).valid).toBe(true)
      expect(new Set(team.players.map((p) => p.enName)).size).toBe(16)
      previous = ca
    }
    expect(previous).toBeCloseTo(1300, 5)
  })

  it('每支世界杯队的 16 名球员都能追溯到该届名单证据，号码不重复', () => {
    expect(NATIONAL_TEAMS).toHaveLength(20)
    const sources = evidence as Record<string, { source: string; players: Record<string, { number: number }> }>
    for (const def of NATIONAL_TEAMS) {
      expect(sources[def.id].source).toContain(`${def.season}_FIFA_World_Cup_squads`)
      const numbers = def.players.map((p) => sources[def.id].players[p[1]]?.number)
      expect(numbers.every((number) => Number.isInteger(number))).toBe(true)
      expect(new Set(numbers).size).toBe(16)
    }
    expect(NATIONAL_TEAMS[3].id).toBe('den-1998')
    expect(NATIONAL_TEAMS.find((d) => d.id === 'bra-2002')!.players.some((p) => p[1] === 'Ronaldinho')).toBe(true)
    expect(LEGEND_TEAMS.find((d) => d.id === 'lazio-1999-00')!.players.some((p) => p[1] === 'Hernán Crespo')).toBe(false)
  })

  it('比赛/测试修改返回值不会污染传奇、巅峰、杯赛缓存', () => {
    for (const get of [() => buildPeakTeam(37), () => legendTeamById('milan-1988-89')!, () => frozenPveTeam('cups', 'cup-casual-01')]) {
      const a = get(), original = a.players[0].attrs.passing
      a.players[0].attrs.passing = -1
      expect(get().players[0].attrs.passing).toBe(original)
    }
  })
})

describe('小组同分排序', () => {
  it('积分净胜球进球相等时看相互战绩；仍相等时固定抽签与输入顺序无关', () => {
    const a = { ...emptyCupRow('a'), points: 3, gf: 3, ga: 3 }, b = { ...emptyCupRow('b'), points: 3, gf: 3, ga: 3 }
    const group = { index: 0, teamIds: ['a', 'b'], table: [b, a], fixtures: [{ id: 'x', round: 1, homeId: 'a', awayId: 'b', played: true, score: { home: 2, away: 1 } }] }
    expect(sortCupTable(group)[0].teamId).toBe('a')
    group.fixtures = []
    const first = sortCupTable(group, 42).map((r) => r.teamId)
    group.table.reverse()
    expect(sortCupTable(group, 42).map((r) => r.teamId)).toEqual(first)
  })
})
