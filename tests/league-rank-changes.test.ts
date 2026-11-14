import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Fixture, SeasonTableRow } from '../src/game/types.ts'
import { latestRoundRankChanges } from '../src/game/standings-history.ts'
import { computeWorldTable, createWorldGame } from '../src/game/world.ts'
import { updateSeasonTable } from '../src/game/season.ts'
import { leagueTable } from '../src/ui/components.ts'
import { setGame, ui } from '../src/ui/state.ts'
import { renderHome } from '../src/ui/screens/home.ts'
import { renderSeason } from '../src/ui/screens/season.ts'
import { renderWorld } from '../src/ui/screens/world.ts'
import { onlineState, refreshPublicWorld } from '../src/online.ts'

const ids = ['a', 'b', 'c', 'd']
const names = new Map(ids.map((id) => [id, id.toUpperCase()]))
const labels = Object.fromEntries(ids.map((id) => [id, { name: id.toUpperCase(), color: '#123456' }]))
const fixtures: Fixture[] = [
  { round: 1, homeId: 'a', awayId: 'b', isPlayer: false, played: true, score: { home: 4, away: 0 } },
  { round: 1, homeId: 'd', awayId: 'c', isPlayer: false, played: true, score: { home: 2, away: 1 } },
  { round: 2, homeId: 'c', awayId: 'a', isPlayer: false, played: true, score: { home: 3, away: 0 } },
  { round: 2, homeId: 'b', awayId: 'd', isPlayer: false, played: true, score: { home: 2, away: 0 } },
]

function rowHtml(html: string, teamId: string): string {
  return html.split('<tr').find((row) => row.includes(`data-club-open="${teamId}"`)) ?? ''
}

afterEach(() => {
  onlineState.status = 'offline'
  ui.worldDivision = null
  ui.worldClubId = null
  vi.unstubAllGlobals()
})

describe('联赛积分榜最近一轮排名变化', () => {
  it('按上一轮和当前完整积分榜对比，显示上升、下降和不变，不修改积分榜', () => {
    const rows = computeWorldTable(ids, fixtures, names)
    const original = structuredClone(rows)
    expect(rows.map((row) => row.teamId)).toEqual(['c', 'a', 'd', 'b'])
    expect(Object.fromEntries(latestRoundRankChanges(rows, fixtures, names))).toEqual({ c: 2, a: -1, d: -1, b: 0 })
    expect(rows).toEqual(original)

    const html = leagueTable(rows, { fixtures, clubLabels: labels })
    expect(rowHtml(html, 'c')).toContain('class="table-rank-change up"')
    expect(rowHtml(html, 'c')).toContain('较上一轮上升 2 名')
    expect(rowHtml(html, 'b')).toContain('class="table-rank-change flat"')
    expect(rowHtml(html, 'b')).toContain('较上一轮排名不变')
    expect(rowHtml(html, 'a')).toContain('class="table-rank-change down"')
    expect(rowHtml(html, 'a')).toContain('较上一轮下降 1 名')
    expect(rowHtml(html, 'a')).toMatch(/↓<\/span><button[^>]*data-club-open="a"/)

    // 首页只显示部分排名，变化仍按所有球队计算。
    const compact = leagueTable(rows, { fixtures, clubLabels: labels, compact: true, window: { from: 0, to: 2 } })
    expect(rowHtml(compact, 'c')).toContain('较上一轮上升 2 名')
    expect(rowHtml(compact, 'a')).toContain('较上一轮下降 1 名')
    expect(rowHtml(compact, 'b')).toBe('')
  })

  it('未开赛或只踢完第一轮时没有上一轮可比较，不把横线误标为排名不变', () => {
    const firstRound = fixtures.slice(0, 2)
    const firstRows = computeWorldTable(ids, firstRound, names)
    expect(latestRoundRankChanges(firstRows, firstRound, names).size).toBe(0)
    expect(latestRoundRankChanges(firstRows, [], names).size).toBe(0)
    const html = leagueTable(firstRows, { fixtures: firstRound, clubLabels: labels })
    expect(rowHtml(html, 'a')).toContain('class="table-rank-change flat"')
    expect(rowHtml(html, 'a')).toContain('暂无上一轮排名')
    expect(rowHtml(html, 'a')).not.toContain('较上一轮排名不变')
  })

  it('最新一轮只结算部分比赛时忽略未完赛比分，仍与上一轮完整排名对比', () => {
    const partial: Fixture[] = [
      ...fixtures,
      { round: 3, homeId: 'a', awayId: 'c', isPlayer: false, played: true, score: { home: 4, away: 0 } },
      { round: 3, homeId: 'b', awayId: 'd', isPlayer: false, played: false, score: { home: 0, away: 9 } },
      { round: 4, homeId: 'a', awayId: 'd', isPlayer: false, played: false },
    ]
    const rows = computeWorldTable(ids, partial, names)
    expect(Object.fromEntries(latestRoundRankChanges(rows, partial, names))).toEqual({ a: 1, d: 1, c: -2, b: 0 })
  })

  it('积分、净胜球和进球均相同时，按球队名称排序而不是球队 ID', () => {
    const clubNames = new Map([['a', 'Zeta'], ['b', 'Alpha'], ['c', 'Gamma'], ['d', 'Beta']])
    const draws: Fixture[] = [
      { round: 1, homeId: 'a', awayId: 'b', isPlayer: false, played: true, score: { home: 0, away: 0 } },
      { round: 1, homeId: 'c', awayId: 'd', isPlayer: false, played: true, score: { home: 0, away: 0 } },
      { round: 2, homeId: 'a', awayId: 'c', isPlayer: false, played: true, score: { home: 0, away: 0 } },
      { round: 2, homeId: 'b', awayId: 'd', isPlayer: false, played: true, score: { home: 0, away: 0 } },
    ]
    const rows = computeWorldTable(ids, draws, clubNames)
    expect(rows.map((row) => row.teamId)).toEqual(['b', 'd', 'c', 'a'])
    expect([...latestRoundRankChanges(rows, draws, clubNames).values()]).toEqual([0, 0, 0, 0])
  })

  it('首页、赛季页和世界页的完整联赛积分榜都显示对应的排名变化', () => {
    const game = createWorldGame(567)
    const results = game.season.fixtures.filter((fixture) => fixture.round <= 2)
    results.forEach((fixture, index) => {
      fixture.played = true
      fixture.score = index % 3 === 0 ? { home: 0, away: 2 } : { home: index % 4 + 1, away: 0 }
    })
    game.season.round = 3
    updateSeasonTable(game)
    setGame(game)
    ui.worldDivision = game.world!.playerDivisionId
    const clubNames = new Map(game.world!.clubs.map((club) => [club.id, club.id === 'player' ? game.clubName : club.name]))
    const previous = computeWorldTable(game.season.table.map((row) => row.teamId), results.filter((fixture) => fixture.round === 1), clubNames)
    const expected = new Map(game.season.table.map((row, index) => [row.teamId, previous.findIndex((entry) => entry.teamId === row.teamId) - index]))
    expect([...expected.values()].some((change) => change > 0)).toBe(true)
    expect([...expected.values()].some((change) => change < 0)).toBe(true)

    const pages = [renderSeason(), renderWorld(), renderHome()]
    for (const [teamId, change] of expected) {
      for (const html of pages) {
        const row = rowHtml(html, teamId)
        if (!row) continue // 首页只显示部分排名。
        const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
        expect(row).toContain(`class="table-rank-change ${direction}"`)
      }
      expect(rowHtml(pages[0], teamId)).not.toBe('')
      expect(rowHtml(pages[1], teamId)).not.toBe('')
    }
  })

  it('联机世界页使用公开赛程和真实球队 ID，正确处理自己的球队 ID 映射', async () => {
    const game = createWorldGame(123)
    game.clubName = 'A'
    setGame(game)
    const table: SeasonTableRow[] = computeWorldTable(ids, fixtures, names)
    const snapshot = {
      seasonIndex: game.world!.seasonIndex,
      ownClubId: 'a',
      clubs: ids.map((id) => ({ id, name: names.get(id), color: '#123456', formationId: '442', tier: 'champions', players: [] })),
      divisions: [{ id: 'champions', tier: 'champions', round: 3, table, fixtures }],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot }))
    onlineState.status = 'online'
    await refreshPublicWorld()
    ui.worldDivision = 'champions'
    ui.worldClubId = null
    const html = renderWorld()
    expect(rowHtml(html, 'c')).toContain('较上一轮上升 2 名')
    expect(rowHtml(html, 'b')).toContain('较上一轮排名不变')
    expect(rowHtml(html, 'player')).toContain('较上一轮下降 1 名')
  })
})
