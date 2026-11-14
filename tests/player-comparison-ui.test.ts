import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { renderPlayerComparison, type CompareTab } from '../src/ui/screens/player-comparison.ts'

const players = () => createInitialGame(710).roster

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
  it('supports no selection, self comparison, and a selected player absent from candidates', () => {
    const [a, b] = players()
    expect(renderPlayerComparison(a, undefined, [], 'overview')).toContain('value="" selected')
    expect(renderPlayerComparison(a, a, [a], 'overview')).toContain(`value="${a.id}" selected`)
    expect(renderPlayerComparison(a, b, [], 'overview')).toContain(`value="${b.id}" selected`)
  })
  it('renders real attributes and positions, but never invents unavailable match statistics', () => {
    const [a, b] = players()
    a.positions.GK = 0
    b.positions.GK = 1
    a.attrs.passing = 1500
    b.attrs.passing = 750
    const attrs = renderPlayerComparison(a, b, [b], 'attributes')
    expect(attrs).toContain('<th>传球</th><td>1500</td><td>750</td>')
    expect(attrs).toContain('<th>扑救反应</th><td>—</td>')
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
