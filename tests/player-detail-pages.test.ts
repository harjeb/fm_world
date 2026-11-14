import { afterEach, describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import type { MatchRecord, PlayerMatchStats } from '../src/game/types.ts'
import { untrainedPlayer } from '../src/game/cards.ts'
import { game as previousGame, setGame, ui } from '../src/ui/state.ts'
import { renderDetailOverlay } from '../src/ui/screens/overlays.ts'
import { comparisonCandidates } from '../src/ui/screens/player-comparison.ts'

const originalGame = previousGame

afterEach(() => {
  setGame(originalGame)
  Object.assign(ui, { detailPlayerId: null, playerDetailView: 'profile', playerCompareId: null, playerCompareTab: 'overview', playerPerformancePeriod: 'season', playerPerformanceCompetition: 'all', screen: 'home' })
})

function setup() {
  const game = createInitialGame(771)
  setGame(game)
  const [player, other] = game.roster
  Object.assign(ui, { detailPlayerId: player.id, playerDetailView: 'profile', playerCompareId: other.id, playerCompareTab: 'overview', playerPerformancePeriod: 'season', playerPerformanceCompetition: 'all', screen: 'home' })
  const row = (id: string, goals: number): PlayerMatchStats => ({ playerId: `home:${id}`, sourceId: id, name: id, side: 'home', minutes: 90, goals, assists: 1, shots: 4, passes: 10, passesCompleted: 8, tackles: 2, interceptions: 1, distance: 600, touches: 14, staminaLeft: 70, yellowCards: 0, redCards: 0 })
  game.matchHistory = [{ id: 'league-one', seasonIndex: game.season.index, isLeague: true, score: { home: 2, away: 0 }, playerStats: [row(player.id, 2), row(other.id, 0)] } as MatchRecord]
  game.challengeHistory = [{ id: 'cup-one', seasonIndex: game.season.index, isLeague: false, mode: 'cup', score: { home: 0, away: 1 }, playerStats: [row(player.id, 0)] } as MatchRecord]
  return { game, player, other }
}

describe('球员详情中的表现与对比页面', () => {
  it('保留原有档案并显示三个可用入口', () => {
    setup()
    const html = renderDetailOverlay()
    expect(html).toContain('data-player-detail-view="profile" class="active" aria-pressed="true"')
    expect(html).toContain('data-player-detail-view="performance"')
    expect(html).toContain('data-player-detail-view="compare"')
    expect(html).toContain('位置熟练度')
  })
  it('对比中的球员和数据来自真实战报，支持两侧选择和各分类', () => {
    const { player, other } = setup()
    ui.playerDetailView = 'compare'
    let html = renderDetailOverlay()
    expect(html).toContain('data-player-compare-base')
    expect(html).toContain('data-player-compare-select')
    expect(html).toContain(`value="${player.id}" selected`)
    expect(html).toContain(`value="${other.id}" selected`)
    expect(html).toContain('出场 2　进球 2　助攻 2')
    expect(html).toContain('出场 1　进球 0　助攻 1')
    ui.playerCompareTab = 'stats'
    html = renderDetailOverlay()
    expect(html).toContain('<th>出场</th><td>2</td><td>1</td>')
    expect(html).toContain('<th>进球</th><td>2</td><td>0</td>')
    expect(html).toContain('<th>传球成功率</th><td>80%</td><td>80%</td>')
    expect(html).toContain('<th>评分</th><td>—</td><td>—</td>')
  })
  it('表现页面按选择的赛事汇总，不使用其他赛事的数据', () => {
    setup()
    ui.playerDetailView = 'performance'
    ui.playerPerformanceCompetition = 'league'
    const html = renderDetailOverlay()
    expect(html).toContain('data-player-detail-view="performance" class="active"')
    expect(html).toContain('data-performance-competition="league" aria-pressed="true"')
    expect(html).toContain('aria-label="射门转化率 50%"')
    expect(html).toContain('aria-label="传球成功率 80%"')
    expect(html).toContain('预期进球')
    expect(html).not.toMatch(/NaN|Infinity/)
  })
  it('转会页面两侧外队球员都使用可转移的原始属性', () => {
    const { game } = setup()
    const [player, other] = game.aiTeams[0].players.filter(item => !item.positions.GK)
    player.attrs.passing = 1400
    other.attrs.passing = 1400
    player.baseAttrs.passing = 400
    other.baseAttrs.passing = 600
    Object.assign(ui, { screen: 'transfer', detailPlayerId: player.id, playerCompareId: other.id, playerDetailView: 'compare', playerCompareTab: 'attributes' })
    const html = renderDetailOverlay()
    expect(html).toContain(`<th>传球</th><td>${untrainedPlayer(player).attrs.passing}</td><td>${untrainedPlayer(other).attrs.passing}</td>`)
    expect(html).toContain('不包含球员卡')
  })
  it('候选列表去重并优先本队球员', () => {
    const { game, player } = setup()
    game.freeStars.push({ ...player, name: '重复记录' })
    const candidates = comparisonCandidates().filter(item => item.id === player.id)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toBe(player)
  })
})
