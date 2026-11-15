import { afterEach, describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { createWorldGame } from '../src/game/world.ts'
import { lineupLockState, nextMatchCountdown, roundKickoffAt } from '../src/game/season.ts'
import type { GameState, MatchRecord } from '../src/game/types.ts'
import { game as originalGame, setGame } from '../src/ui/state.ts'
import { onlineState } from '../src/online.ts'
import { renderHome } from '../src/ui/screens/home.ts'
import { returnToChallengeAfterWin } from '../src/ui/match-completion.ts'

const originalStatus = onlineState.status
afterEach(() => { setGame(originalGame); onlineState.status = originalStatus })

function gameWithCompletedRound(): GameState {
  const game = createInitialGame(77123)
  game.season.round = 1
  const first = game.season.fixtures.find(fixture => fixture.isPlayer && fixture.round === 1)!
  first.played = true
  first.score = { home: 3, away: 1 }
  game.matchHistory = [{ id: 'record-round-one', isLeague: true, round: 1, score: { home: 3, away: 1 }, result: 'win', homeName: '主', awayName: '客' } as MatchRecord]
  return game
}

describe('总览下一轮预告', () => {
  it('本轮已结束但轮号尚未切换时，主卡片预告下一场，下方显示本轮结果', () => {
    const game = gameWithCompletedRound()
    setGame(game)
    onlineState.status = 'online'
    const html = renderHome()
    expect(html).toContain('下一轮预告')
    expect(html).toContain('data-next-round="2"')
    expect(html).toContain('第 2 轮')
    expect(html).toContain('第 1 轮结果')
    expect(html).toContain('3 : 1')
    expect(html).toContain('data-record="record-round-one"')
    expect(html.indexOf('nm-body')).toBeLessThan(html.indexOf('nm-recent'))
    expect(html).not.toContain('本轮结果</h')
  })

  it('离线时不为尚未切换的未来轮次提供错误开赛按钮', () => {
    const game = gameWithCompletedRound()
    setGame(game)
    onlineState.status = 'offline'
    let html = renderHome()
    expect(html).toContain('data-next-round="2"')
    expect(html).not.toContain('data-action="start-league"')
    game.season.round = 2
    html = renderHome()
    expect(html).toContain('data-action="start-league"')
    expect(html).toContain('第 1 轮结果')
  })

  it('当前轮没有战报时不会误连到上一赛季同轮的战报', () => {
    const game = gameWithCompletedRound()
    game.season.index = 2
    game.matchHistory[0].seasonIndex = 1
    setGame(game)
    const html = renderHome()
    const recent = html.slice(html.indexOf('class="nm-recent"'), html.indexOf('</div>', html.indexOf('class="nm-recent"')))
    expect(recent).toContain('第 1 轮结果')
    expect(recent).not.toContain('data-record=')
  })

  it('正式杯赛早于联赛时优先预告杯赛，锁阵及倒计时以杯赛时间为准', () => {
    const game = createWorldGame(92, undefined, undefined, Date.UTC(2026, 10, 9, 12))
    game.shared = true
    const own = game.world!.clubs.find(club => club.id === 'player')!.squadKey!
    const leagueAt = roundKickoffAt(game, 1)
    const cupAt = leagueAt - 2 * 3600_000
    game.world!.seasonCupMode = 1
    game.world!.seasonCups = { version: 1, seasonIndex: 1, qualificationRound: 6, createdAt: cupAt - 24 * 3600_000, delayedLeagueRounds: [], cups: [{
      id: 'community', name: '社区杯', entrants: [own, 'd2s_01'], dates: [cupAt], rounds: [{ round: 1, kickoffAt: cupAt, byes: [], fixtures: [{ id: 'cup-one', cupId: 'community', round: 1, homeId: own, awayId: 'd2s_01', kickoffAt: cupAt, played: false }] }],
    }] }
    setGame(game)
    onlineState.status = 'online'
    const html = renderHome()
    expect(html).toContain('社区杯 · 第 1 轮')
    expect(html).toContain('>社区杯</span>')
    expect(html).toContain('11/09 18:00')
    expect(html).toContain('下一轮预告')
    expect(nextMatchCountdown(game, cupAt - 60 * 60_000)).toBe('1 小时 0 分')
    expect(lineupLockState(game, cupAt - 30 * 60_000 - 1).locked).toBe(false)
    expect(lineupLockState(game, cupAt - 30 * 60_000).locked).toBe(true)
    expect(lineupLockState(game, cupAt - 30 * 60_000).kickoffAt).toBe(cupAt)
  })

  it('赛季结束保留最后结果，没有战报时不生成无效链接', () => {
    const game = gameWithCompletedRound()
    game.season.finished = true
    game.matchHistory = []
    setGame(game)
    const html = renderHome()
    expect(html).toContain('赛季结束')
    expect(html).toContain('第 1 轮结果')
    expect(html).toContain('class="nm-recent"')
    expect(html).not.toContain('data-record="record-round-one"')
  })
})

describe('挑战胜利后的去向', () => {
  const record = (patch: Partial<MatchRecord>) => ({ isLeague: false, result: 'win', ...patch } as MatchRecord)
  const state = () => ({ screen: 'match' as const, challengeMode: 'friendly' as const, peakPreviewStage: 10 as number | null, reviewId: 'old' as string | null, notice: '' })

  it('巅峰胜利返回挑战并显示下一关，可从历史查看战报', () => {
    const ui = state()
    expect(returnToChallengeAfterWin(ui, record({ mode: 'peak' }))).toBe(true)
    expect(ui).toMatchObject({ screen: 'challenge', challengeMode: 'peak', peakPreviewStage: null, reviewId: null })
    expect(ui.notice).toContain('战报')
  })

  it('友谊赛和传奇胜利回到对应模式；失败、平局及正式赛保留复盘', () => {
    for (const mode of ['friendly', 'legend', 'cup'] as const) {
      const ui = state()
      expect(returnToChallengeAfterWin(ui, record({ mode }))).toBe(true)
      expect(ui).toMatchObject({ screen: 'challenge', challengeMode: mode })
    }
    for (const patch of [{ result: 'loss' }, { result: 'draw' }, { isLeague: true }, { mode: 'cup', cupId: 'season-cross' }] as Partial<MatchRecord>[]) {
      const ui = state()
      expect(returnToChallengeAfterWin(ui, record(patch))).toBe(false)
      expect(ui.screen).toBe('match')
    }
  })
})
