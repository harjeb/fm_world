import { afterEach, describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
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
})
