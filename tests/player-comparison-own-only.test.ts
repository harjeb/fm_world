import { afterEach, describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { game as originalGame, setGame, ui } from '../src/ui/state.ts'
import { comparisonCandidates, renderPlayerComparison } from '../src/ui/screens/player-comparison.ts'
import { renderDetailOverlay } from '../src/ui/screens/overlays.ts'
import { positionMap } from '../src/ui/components.ts'

const originalUi = { ...ui }
afterEach(() => { setGame(originalGame); Object.assign(ui, originalUi) })

describe('本队球员对比', () => {
  it('仅使用阵容对象，拒绝外部候选、外部两侧和伪造的同 ID 数据', () => {
    const game = createInitialGame(771)
    setGame(game)
    const [own, teammate] = game.roster
    const outsider = game.aiTeams[0].players.find(p => !game.roster.some(o => o.id === p.id))!
    outsider.name = '外部独特姓名'
    expect(comparisonCandidates().map(p => p.id)).toEqual(game.roster.map(p => p.id))
    expect(renderPlayerComparison(outsider, own, [outsider, own], 'overview')).toBe('')
    const html = renderPlayerComparison(own, outsider, [outsider], 'positions')
    expect(html).not.toContain('外部独特姓名')
    expect(html).not.toContain(`value="${outsider.id}"`)
    expect(html).toContain('value="" selected')
    expect(html).toContain(`value="${teammate.id}"`)
    const fake = { ...teammate, name: '伪造球员' }
    const canonical = renderPlayerComparison(own, fake, [fake], 'overview')
    expect(canonical).not.toContain('伪造球员')
    expect(canonical).toContain(teammate.name)
  })
  it('隐藏外队对比入口并安全处理残留对比状态，本队不可选外队', () => {
    const game = createInitialGame(772)
    setGame(game)
    const own = game.roster[0]
    const outsider = game.aiTeams[0].players.find(p => !game.roster.some(o => o.id === p.id))!
    Object.assign(ui, { screen: 'home', detailPlayerId: outsider.id, playerDetailView: 'compare', playerCompareId: own.id, playerCompareTab: 'positions' })
    const foreign = renderDetailOverlay()
    expect(foreign).not.toContain('data-player-detail-view="compare"')
    expect(foreign).not.toContain('pc-root')
    expect(foreign).toContain('位置熟练度')
    Object.assign(ui, { detailPlayerId: own.id, playerCompareId: outsider.id })
    const ownHtml = renderDetailOverlay()
    expect(ownHtml).toContain('data-player-detail-view="compare"')
    expect(ownHtml).toContain('value="" selected')
    expect(ownHtml).not.toContain(`value="${outsider.id}"`)
    expect(ownHtml).toContain('pc-spot-value')
    expect(positionMap(outsider)).toContain('<title>左后卫')
  })
})
