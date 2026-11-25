import { describe, expect, it } from 'vitest'
import type { GameState, MatchRecord, Player, PlayerMatchStats } from '../src/game/types.ts'
import { aggregatePerformance, averageRating, renderPlayerPerformance } from '../src/ui/screens/player-performance.ts'
import { renderDetailOverlay } from '../src/ui/screens/overlays.ts'
import { createInitialGame } from '../src/game/state.ts'
import { game as originalGame, setGame, ui } from '../src/ui/state.ts'

const stats = (patch: Partial<PlayerMatchStats> = {}): PlayerMatchStats => ({ playerId: 'away:player:1', name: 'P', side: 'away', minutes: 90, goals: 1, assists: 1, shots: 2, passes: 10, passesCompleted: 8, tackles: 2, interceptions: 1, distance: 100, touches: 12, staminaLeft: 50, yellowCards: 0, redCards: 0, ...patch })
const record = (id: string, patch: Partial<MatchRecord> = {}): MatchRecord => ({ id, isLeague: true, seasonIndex: 2, score: { home: 0, away: 2 }, result: 'loss', playerStats: [stats()], ...patch } as MatchRecord)
const state = (matchHistory: MatchRecord[], challengeHistory: MatchRecord[] = []): Pick<GameState, 'matchHistory' | 'challengeHistory' | 'season'> => ({ matchHistory, challengeHistory, season: { index: 2 } as GameState['season'] })

describe('player performance', () => {
  it('filters competitions, season and career, deduplicates and derives away wins from score', () => {
    const league = record('a')
    const friendly = record('b', { isLeague: false, mode: 'friendly', playerStats: [stats({ sourceId: 'player:1', playerId: 'other', goals: 2 })] })
    const old = record('c', { seasonIndex: undefined, isLeague: false, mode: 'cup' })
    const s = state([league, old], [league, friendly])
    expect(aggregatePerformance(s, 'player:1', 'season', 'all')).toMatchObject({ appearances: 2, goals: 3, wins: 2 })
    expect(aggregatePerformance(s, 'player:1', 'season', 'league')).toMatchObject({ appearances: 1, goals: 1 })
    expect(aggregatePerformance(s, 'player:1', 'career', 'cup')).toMatchObject({ appearances: 1 })
    expect(aggregatePerformance(s, 'player:1', 'career', 'all').appearances).toBe(3)
  })
  it('ignores DNP and preserves unknown optional stats', () => {
    const s = state([record('a', { playerStats: [stats({ minutes: 0 })] }), record('b', { playerStats: [stats({ assists: undefined, yellowCards: undefined })] })])
    expect(aggregatePerformance(s, 'player:1', 'season', 'all')).toMatchObject({ appearances: 1, assists: null, yellowCards: 0 })
    expect(aggregatePerformance(state([]), 'player:1', 'season', 'all')).toMatchObject({ appearances: 0, assists: null })
  })
  it('treats omitted card fields as zero, while adding actual cards across games', () => {
    const s = state([
      record('a', { playerStats: [stats({ yellowCards: undefined, redCards: undefined })] }),
      record('b', { playerStats: [stats({ yellowCards: 1, redCards: undefined })] }),
      record('c', { playerStats: [stats({ yellowCards: undefined, redCards: 1 })] }),
    ])
    expect(aggregatePerformance(s, 'player:1', 'season', 'all')).toMatchObject({ appearances: 3, yellowCards: 1, redCards: 1 })
  })
  it('新旧战报混合时仅汇总有记录的场次，同口径计算比率和平均评分', () => {
    const old = record('old', { playerStats: [stats({ tackles: 9 })] })
    const modern = record('modern', { playerStats: [stats({ tackles: 2, tackleAttempts: 4, shotsOnTarget: 2, xg: 0.42, chancesCreated: 3, chancesConverted: 1, xa: 0.6, rating: 7.2 })] })
    const modern2 = record('modern2', { playerStats: [stats({ tackles: 1, tackleAttempts: 1, shotsOnTarget: 1, xg: 0.2, chancesCreated: 1, chancesConverted: 1, xa: 0.1, rating: 8.4 })] })
    const total = aggregatePerformance(state([old, modern, modern2]), 'player:1', 'season', 'all')
    expect(total).toMatchObject({ appearances: 3, tackles: 12, shotsOnTarget: 3, chancesCreated: 4, chancesConverted: 2, tackleRate: { success: 3, attempts: 5, matches: 2 }, chanceRate: { success: 2, attempts: 4, matches: 2 } })
    expect(total.xg).toBeCloseTo(0.62)
    expect(total.xa).toBeCloseTo(0.7)
    expect(total.coverage).toMatchObject({ xg: 2, xa: 2, rating: 2 })
    expect(averageRating(total)).toBeCloseTo(7.8)
    const game = createInitialGame(91)
    game.season.index = 2
    game.matchHistory = [old, modern, modern2]
    setGame(game)
    try {
      const html = renderPlayerPerformance({ id: 'player:1', name: 'P' } as Player, 'season', 'all')
      expect(html).toContain('射正（2/3 场）</span><strong>3</strong>')
      expect(html).toContain('预期进球（2/3 场）</span><strong>0.62</strong>')
      expect(html).toContain('平均评分（2/3 场）</span><strong>7.8</strong>')
      expect(html).toContain('aria-label="抢断成功率（2/3 场） 60%"')
      expect(html).toContain('aria-label="机会转化率（2/3 场） 50%"')
    } finally { setGame(originalGame) }
  })
  it('renders escaped player name, accessible filters and safe empty denominators', () => {
    const html = renderPlayerPerformance({ id: 'missing-id', name: '<script>' } as Player, 'career', 'cup')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('data-performance-period="career" aria-pressed="true"')
    expect(html).toContain('data-performance-competition="cup" aria-pressed="true"')
    expect(html).not.toMatch(/NaN|Infinity/)
    expect(html).toContain('—')
  })

  it('门将比赛表现与球员档案展示门将专属数据，不显示外场进攻指标', () => {
    const legacy = record('gk-old', {
      score: { home: 0, away: 1 },
      playerStats: [stats({ side: 'away', goals: 0, assists: 0, shots: 0, tackles: 0, passes: 20, passesCompleted: 16, minutes: 90 })],
    })
    const modern = record('gk-new', {
      score: { home: 2, away: 1 },
      playerStats: [stats({ side: 'away', goals: 0, assists: 0, shots: 0, tackles: 0, passes: 25, passesCompleted: 20, minutes: 90, saves: 6, goalsConceded: 2, xgConceded: 2.8, claims: 2, rating: 7.6 })],
    })
    const total = aggregatePerformance(state([legacy, modern]), 'player:1', 'season', 'all')
    expect(total).toMatchObject({
      appearances: 2,
      cleanSheets: 1,
      saves: 6,
      goalsConceded: 2,
      claims: 2,
      saveRate: { success: 6, attempts: 8, matches: 1 },
      goalsPrevented: { matches: 1 },
    })
    expect(total.goalsPrevented.value).toBeCloseTo(0.8)
    expect(total.coverage).toMatchObject({ saves: 1, goalsConceded: 2, claims: 1, xgConceded: 1, rating: 1 })

    const game = createInitialGame(92)
    game.season.index = 2
    const gk = game.roster.find(p => p.positions.GK > 0)!
    const gkLegacy = record('gk-old', {
      score: { home: 0, away: 1 },
      playerStats: [stats({ playerId: `away:${gk.id}`, sourceId: gk.id, name: gk.name, side: 'away', goals: 0, assists: 0, shots: 0, tackles: 0, passes: 20, passesCompleted: 16, minutes: 90 })],
    })
    const gkModern = record('gk-new', {
      score: { home: 2, away: 1 },
      playerStats: [stats({ playerId: `away:${gk.id}`, sourceId: gk.id, name: gk.name, side: 'away', goals: 0, assists: 0, shots: 0, tackles: 0, passes: 25, passesCompleted: 20, minutes: 90, saves: 6, goalsConceded: 2, xgConceded: 2.8, claims: 2, rating: 7.6 })],
    })
    game.matchHistory = [gkLegacy, gkModern]
    setGame(game)
    const prevDetail = ui.detailPlayerId
    const prevView = ui.playerDetailView
    const prevStatsTab = ui.playerStatsTab
    try {
      const perfHtml = renderPlayerPerformance(gk, 'season', 'all')
      expect(perfHtml).toContain('GOALKEEPER PERFORMANCE')
      expect(perfHtml).toContain('门线扑救')
      expect(perfHtml).toContain('失球与零封')
      expect(perfHtml).toContain('出球组织')
      expect(perfHtml).toContain('禁区控制')
      expect(perfHtml).toContain('扑救成功率（1/2 场） 75%')
      expect(perfHtml).toContain('零封率（2/2 场） 50%')
      expect(perfHtml).toContain('阻止失球（1/2 场）</span><strong>+0.80</strong>')
      expect(perfHtml).toContain('面对预期失球（1/2 场）</span><strong>2.80</strong>')
      expect(perfHtml).toContain('出击摘球（1/2 场）</span><strong>2</strong>')
      expect(perfHtml).not.toContain('射门转化率')
      expect(perfHtml).not.toContain('创造机会')
      expect(perfHtml).not.toContain('抢断成功率')
      expect(perfHtml).not.toMatch(/NaN|Infinity/)

      // 球员档案页本赛季 / 生涯数据块应展示门将指标
      ui.detailPlayerId = gk.id
      ui.playerDetailView = 'profile'
      ui.playerStatsTab = 'season'
      const profileHtml = renderDetailOverlay()
      expect(profileHtml).toContain('<dt>零封</dt><dd>1</dd>')
      expect(profileHtml).toContain('<dt>扑救</dt><dd>6</dd>')
      expect(profileHtml).toContain('<dt>失球</dt><dd>2</dd>')
      expect(profileHtml).toContain('<dt>扑救成功率</dt><dd>75%</dd>')
      expect(profileHtml).not.toContain('<dt>每场进球</dt>')
      expect(profileHtml).not.toContain('<dt>射门</dt>')

      // 零出场门将安全渲染 —，不产生 NaN/Infinity
      game.matchHistory = []
      const emptyHtml = renderPlayerPerformance(gk, 'season', 'all')
      expect(emptyHtml).not.toMatch(/NaN|Infinity/)
      expect(emptyHtml).toContain('—')
    } finally {
      ui.detailPlayerId = prevDetail
      ui.playerDetailView = prevView
      ui.playerStatsTab = prevStatsTab
      setGame(originalGame)
    }
  })
})
