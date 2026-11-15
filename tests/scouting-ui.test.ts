import { afterEach, describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { economyOf } from '../src/game/economy.ts'
import { startScouting, visibleScoutReports } from '../src/game/scouting.ts'
import { game as originalGame, setGame, ui } from '../src/ui/state.ts'
import { renderScoutControls, renderScoutPanel, renderScoutReport } from '../src/ui/screens/scouting.ts'
import { renderDetailOverlay } from '../src/ui/screens/overlays.ts'
import { clubRosterPanel } from '../src/ui/club-view.ts'

const oldUi = { ...ui }
afterEach(() => { setGame(originalGame); Object.assign(ui, oldUi) })

describe('球探 UI', () => {
  it('单机报告在期限前隐藏，完成显示估计；脱敏报告到期后仍不显示', () => {
    const game = createInitialGame(123); economyOf(game).balance = 100000
    const player = game.aiTeams[0].players[0]
    const report = startScouting(game, player, { source: 'club', clubId: 'opponent' }, 2, 100).report!
    expect(renderScoutReport(report, game.roster, report.readyAt - 1)).not.toContain('估计属性有随机误差')
    const redacted = visibleScoutReports(game, 100)[0]
    expect(renderScoutReport(redacted, game.roster, report.readyAt + 1)).toContain('等待报告刷新')
    const done = renderScoutReport(report, game.roster, report.readyAt)
    expect(done).toContain('估计属性有随机误差'); expect(done).toContain('相对本队'); expect(done).toContain(report.snapshotLabel)
  })
  it('控件按目标隔离，面板保留离开市场的报告', () => {
    const game = createInitialGame(123); economyOf(game).balance = 100000; setGame(game)
    const p = game.aiTeams[0].players[0]
    startScouting(game, p, { source: 'club', clubId: 'team' }, 1, 100)
    startScouting(game, p, { source: 'transfer', clubId: 'team' }, 2, 200)
    const club = renderScoutControls(p.id, 'club', 'team')
    expect(club).toContain('data-source="club"'); expect(club).toContain('data-club="team"'); expect(club).toContain('data-scout-level'); expect(club).not.toContain('2级 · 发起')
    expect(renderScoutControls(p.id, 'transfer', 'team')).toContain('data-source="transfer"')
    const panel = renderScoutPanel(); expect(panel).toContain('data-action="scout-refresh"'); expect(panel.indexOf('转会')).toBeLessThan(panel.indexOf('球队'))
  })
  it('球队名单与自由市场详情提供控件且无外队比较入口', () => {
    const game = createInitialGame(123); setGame(game)
    const p = game.freeStars[0]
    Object.assign(ui, { screen: 'transfer', transferTab: 'free', detailPlayerId: p.id, playerDetailView: 'profile' })
    const html = renderDetailOverlay()
    expect(html).toContain('data-source="market"'); expect(html).not.toContain('data-player-detail-view="compare"')
    const other = game.aiTeams[0].players[0]
    const club = { id: 'test', name: 'test', players: [{ ...other, ca: 50 }] } as any
    const roster = clubRosterPanel(club, other.id)
    expect(roster).toContain('data-source="club"'); expect(roster).toContain('data-club="test"')
  })
})
