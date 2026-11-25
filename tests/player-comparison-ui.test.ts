import { afterEach, describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import type { MatchRecord } from '../src/game/types.ts'
import { renderPlayerComparison, type CompareTab } from '../src/ui/screens/player-comparison.ts'
import { positionMap } from '../src/ui/components.ts'
import { game as originalGame, setGame } from '../src/ui/state.ts'

const players = () => {
  const game = createInitialGame(710)
  setGame(game)
  return game.roster
}

afterEach(() => setGame(originalGame))

describe('球员对比', () => {
  it('renders selection, escaped identities and all tabs with active state', () => {
    const [a, b] = players()
    a.name = '<script>alert(1)</script>'
    b.name = '对手 & 朋友'
    b.id = 'x" onfocus="bad'
    const html = renderPlayerComparison(a, b, [a, b], 'overview')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('value="x&quot; onfocus=&quot;bad" selected')
    expect(html).toContain('对手 &amp; 朋友')
    expect(html).toContain('data-player-compare-select')
    expect(html).toContain('data-player-compare-tab="overview" class="pc-active" aria-pressed="true"')
    for (const tab of ['overview', 'attributes', 'stats', 'positions']) expect(html).toContain(`data-player-compare-tab="${tab}"`)
    expect(html).toContain('pc-shape-first')
    expect(html).toContain('pc-shape-second')
  })
  it('shows independent detailed position values on profile and comparison', () => {
    const [a, b] = players()
    a.detailedPositions = { DL: 91, DR: 13 }
    const profile = positionMap(a)
    expect(profile).toContain('左后卫 91')
    expect(profile).toContain('右后卫 13')
    const comparison = renderPlayerComparison(a, b, [b], 'positions')
    expect(comparison).toContain('<th>左后卫</th><td>91</td>')
    expect(comparison).toContain('<th>右后卫</th><td>13</td>')
  })
  it('supports no selection, self comparison, and a selected teammate absent from supplied candidates', () => {
    const [a, b] = players()
    expect(renderPlayerComparison(a, undefined, [], 'overview')).toContain('value="" selected')
    expect(renderPlayerComparison(a, a, [a], 'overview')).toContain(`value="${a.id}" selected`)
    expect(renderPlayerComparison(a, b, [], 'overview')).toContain(`value="${b.id}" selected`)
  })
  it('renders real attributes and positions, but never invents unavailable match statistics', () => {
    const [a, b] = players()
    a.positions.GK = 0
    b.positions.GK = 1
    a.detailedPositions = { ...a.detailedPositions, GK: 0 }
    b.detailedPositions = { ...b.detailedPositions, GK: 1 }
    a.attrs.passing = 1500
    b.attrs.passing = 750
    a.attrs.vision = 12
    b.attrs.vision = 12
    const attrs = renderPlayerComparison(a, b, [b], 'attributes')
    // Unified single FM-style multi-column table containing all 4 attribute groups
    expect(attrs.match(/<table\b/g)).toHaveLength(1)
    for (const group of ['技术', '精神', '身体', '门将']) {
      expect(attrs).toContain(`>${group}</th>`)
    }
    expect(attrs).toMatch(/<th scope="row" class="pc-attr-name"[^>]*>传球<\/th><td class="pc-attr-num pc-col-a"><span class="pc-attr-val"><span class="pc-num">1500<\/span><span class="pc-diff pc-diff-up"[^>]*><svg[^>]*><path d="M1\.8 6\.6 5 3\.4 8\.2 6\.6"\/><\/svg><\/span><\/span><\/td><td class="pc-attr-num pc-col-b"><span class="pc-attr-val"><span class="pc-num">750<\/span><span class="pc-diff pc-diff-down"[^>]*><svg[^>]*><path d="M1\.8 3\.4 5 6\.6 8\.2 3\.4"\/><\/svg><\/span><\/span><\/td>/)
    expect(attrs).toMatch(/<th scope="row" class="pc-attr-name pc-group-sep pc-attr-hidden"[^>]*>视野<\/th><td class="pc-attr-num pc-col-a"><span class="pc-attr-val"><span class="pc-num">12<\/span><span class="pc-diff pc-diff-eq" aria-hidden="true"><\/span><\/span><\/td><td class="pc-attr-num pc-col-b"><span class="pc-attr-val"><span class="pc-num">12<\/span><span class="pc-diff pc-diff-eq" aria-hidden="true"><\/span><\/span><\/td>/)
    expect(attrs).toMatch(/<th scope="row" class="pc-attr-name pc-group-sep"[^>]*>扑救反应<\/th><td class="pc-attr-num pc-col-a"><span class="pc-attr-val"><span class="pc-num">—<\/span><span class="pc-diff pc-diff-eq" aria-hidden="true"><\/span><\/span><\/td>/)
    // Cross-scale GK vs outfielder: composure is 0-20 for outfielder (15 => 75) vs 0-1500 for GK (450 => 30)
    a.attrs.composure = 15
    b.attrs.composure = 450
    const crossAttrs = renderPlayerComparison(a, b, [b], 'attributes')
    expect(crossAttrs).toMatch(/>镇定<\/th><td class="pc-attr-num pc-col-a"><span class="pc-attr-val"><span class="pc-num">15<\/span><span class="pc-diff pc-diff-up"/)
    expect(crossAttrs).toMatch(/>镇定<\/th><td class="pc-attr-num pc-col-a">.*?<\/td><td class="pc-attr-num pc-col-b"><span class="pc-attr-val"><span class="pc-num">450<\/span><span class="pc-diff pc-diff-down"/)
    // No compared player selected => no diff arrows shown
    const soloAttrs = renderPlayerComparison(a, undefined, [b], 'attributes')
    expect(soloAttrs).not.toContain('pc-diff-up')
    expect(soloAttrs).not.toContain('pc-diff-down')
    const stats = renderPlayerComparison(a, b, [b], 'stats')
    expect(stats).toContain('仅统计本赛季已保存的战报')
    expect(stats).toContain('<th>出场</th><td>—</td><td>—</td>')
    const positions = renderPlayerComparison(a, b, [b], 'positions')
    expect(positions).toContain('<th>门将</th><td>0</td><td>1</td>')
    for (const tab of ['overview', 'attributes', 'stats', 'positions'] as CompareTab[]) {
      expect(renderPlayerComparison(a, b, [b], tab)).toContain(`data-player-compare-tab="${tab}" class="pc-active"`)
    }
  })

  it('门将对比在总览和数据页展示门将专属指标，混合对比仅在门将列展示门将指标', () => {
    const game = createInitialGame(712)
    game.season.index = 1
    const keepers = game.roster.filter(p => p.positions.GK > 0)
    const outfielder = game.roster.find(p => p.positions.GK <= 0)!
    const [gkA, gkB] = keepers
    expect(gkA).toBeTruthy()
    expect(gkB).toBeTruthy()
    game.matchHistory = [
      {
        id: 'gk-cmp-1', isLeague: true, seasonIndex: 1, score: { home: 2, away: 0 }, result: 'win',
        playerStats: [
          { playerId: `home:${gkA.id}`, sourceId: gkA.id, name: gkA.name, side: 'home', minutes: 90, passes: 20, passesCompleted: 18, shots: 0, goals: 0, assists: 0, tackles: 0, interceptions: 1, distance: 4000, staminaLeft: 85, touches: 24, saves: 4, goalsConceded: 0, xgConceded: 1.15, claims: 2, rating: 7.4 },
          { playerId: `home:${outfielder.id}`, sourceId: outfielder.id, name: outfielder.name, side: 'home', minutes: 90, passes: 30, passesCompleted: 27, shots: 3, goals: 1, assists: 1, tackles: 2, interceptions: 2, distance: 9500, staminaLeft: 70, touches: 45, rating: 7.8 },
        ],
      } as MatchRecord,
      {
        id: 'gk-cmp-2', isLeague: true, seasonIndex: 1, score: { home: 1, away: 2 }, result: 'loss',
        playerStats: [
          { playerId: `home:${gkB.id}`, sourceId: gkB.id, name: gkB.name, side: 'home', minutes: 90, passes: 22, passesCompleted: 17, shots: 0, goals: 0, assists: 0, tackles: 0, interceptions: 0, distance: 4100, staminaLeft: 82, touches: 26, saves: 3, goalsConceded: 2, xgConceded: 1.6, claims: 1, rating: 6.5 },
        ],
      } as MatchRecord,
    ]
    setGame(game)

    const gkOverview = renderPlayerComparison(gkA, gkB, [gkA, gkB], 'overview')
    expect(gkOverview).toContain('扑救 4　失球 0　零封 1')
    expect(gkOverview).toContain('扑救 3　失球 2　零封 0')
    expect(gkOverview).toContain('扑救成功率 100%')
    expect(gkOverview).toContain('扑救成功率 60%')
    expect(gkOverview).not.toContain('进球 ')

    const gkStats = renderPlayerComparison(gkA, gkB, [gkA, gkB], 'stats')
    expect(gkStats).toContain('<th>扑救</th><td>4（1/1 场）</td><td>3（1/1 场）</td>')
    expect(gkStats).toContain('<th>失球</th><td>0（1/1 场）</td><td>2（1/1 场）</td>')
    expect(gkStats).toContain('<th>零封</th><td>1（1/1 场）</td><td>0（1/1 场）</td>')
    expect(gkStats).toContain('<th>扑救成功率</th><td>100%（1/1 场）</td><td>60%（1/1 场）</td>')
    expect(gkStats).toContain('<th>阻止失球</th><td>+1.15（1/1 场）</td><td>-0.40（1/1 场）</td>')
    expect(gkStats).toContain('<th>出击摘球</th><td>2（1/1 场）</td><td>1（1/1 场）</td>')
    expect(gkStats).not.toContain('<th>进球</th>')
    expect(gkStats).not.toContain('<th>射门</th>')

    const mixedStats = renderPlayerComparison(outfielder, gkA, [outfielder, gkA], 'stats')
    expect(mixedStats).toContain('<th>扑救</th><td>—</td><td>4（1/1 场）</td>')
    expect(mixedStats).toContain('<th>零封</th><td>—</td><td>1（1/1 场）</td>')
  })
})
