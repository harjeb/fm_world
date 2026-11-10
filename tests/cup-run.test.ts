import { beforeAll, describe, expect, it } from 'vitest'
import { loadPveContent } from '../src/game/pve-content.ts'
beforeAll(loadPveContent)
import { createInitialGame } from '../src/game/state.ts'
import { cupPlayerFixture, cupTeam, enterCup, recordCupResult } from '../src/game/cup-run.ts'
import { ensurePve } from '../src/game/pve.ts'
import { startCupMatch, restoreActiveEngine, finishMatch } from '../src/game/actions.ts'
import { economyOf } from '../src/game/economy.ts'
import type { GameState, MatchRecord } from '../src/game/types.ts'

function complete(game: GameState, cupId: string, goals = 8, against = 0, pens?: { home: number; away: number }) {
  const run = game.pve!.cups[cupId]
  const next = cupPlayerFixture(run)!
  const home = next.fixture.homeId === 'player'
  const score = home ? { home: goals, away: against } : { home: against, away: goals }
  const record = { id: next.fixture.id, score, ...(pens ? { shootout: pens } : {}), result: goals > against ? 'win' : goals < against ? 'loss' : 'draw' } as MatchRecord
  const context = { isLeague: false, cupId, cupFixtureId: next.fixture.id, opponentId: home ? next.fixture.awayId : next.fixture.homeId, opponentName: '', seed: 1, homeAway: home ? 'home' as const : 'away' as const }
  recordCupResult(game, record, context)
  return { fixture: next.fixture, tie: next.tie, record, context }
}

function gameInCup(cup: 'community' | 'champions' = 'community') {
  const game = createInitialGame(5150)
  expect(enterCup(game, cup).ok).toBe(true)
  return game
}

describe('杯赛规则与持久化', () => {
  it('报名不提前公布未来赛果，小组赛每轮统一结算，平局各一分', () => {
    const game = gameInCup(), run = game.pve!.cups.community
    expect(run.groups).toHaveLength(4)
    expect(run.groups.flatMap((g) => g.fixtures).every((f) => !f.played)).toBe(true)
    complete(game, 'community', 1, 1)
    expect(run.groups[run.playerGroupIndex].table.find((row) => row.teamId === 'player')!.points).toBe(1)
    expect(run.groupRound).toBe(2)
    expect(run.groups.flatMap((g) => g.fixtures).filter((f) => f.round === 1).every((f) => f.played)).toBe(true)
    expect(run.groups.flatMap((g) => g.fixtures).filter((f) => f.round > 1).every((f) => !f.played)).toBe(true)
    expect(enterCup(game, 'community').ok).toBe(false)
  })

  it('真实小组赛进入引擎时允许平局；挑战比赛不扣体能', () => {
    const game = gameInCup()
    const conditions = game.roster.map((p) => p.condition)
    expect(startCupMatch(game, 'community').ok).toBe(true)
    expect(game.activeMatch!.context.knockout).toBe(false)
    const engine = restoreActiveEngine(game)!
    engine.simulate()
    const record = finishMatch(game, engine)!
    expect(record.mode).toBe('cup')
    expect(record.shootout).toBeUndefined()
    expect(game.roster.map((p) => p.condition)).toEqual(conditions)
  })

  it('16 队完整夺冠：保存三轮签表、只记一次奖杯、不发奖金', () => {
    const game = gameInCup(), before = economyOf(game).balance
    for (let i = 0; i < 3; i++) complete(game, 'community')
    const run = game.pve!.cups.community
    expect(run.stage).toBe('qf')
    for (let i = 0; i < 2; i++) complete(game, 'community')
    expect(run.stage).toBe('final')
    const last = complete(game, 'community')
    expect(run.status).toBe('champion')
    expect(run.rounds!.map((r) => r.round)).toEqual(['qf', 'sf', 'final'])
    expect(run.rounds!.every((r) => r.ties.every((t) => t.winnerId))).toBe(true)
    expect(game.pve!.trophies).toHaveLength(1)
    expect(game.pve!.trophies[0].finalScore).toEqual({ home: 8, away: 0 })
    recordCupResult(game, last.record, last.context)
    expect(game.pve!.trophies).toHaveLength(1)
    expect(economyOf(game).balance).toBe(before)
  })

  it('32 队：16 强单场、8 强与半决赛两回合、决赛单场', () => {
    const game = gameInCup('champions'), run = game.pve!.cups.champions
    for (let i = 0; i < 3; i++) complete(game, 'champions')
    expect(run.stage).toBe('r16')
    expect(cupPlayerFixture(run)!.tie!.legs).toHaveLength(1)
    complete(game, 'champions')
    expect(run.stage).toBe('qf')
    const first = complete(game, 'champions', 1, 2)
    expect(first.tie!.legs).toHaveLength(2)
    expect(run.stage).toBe('qf')
    expect(first.tie!.winnerId).toBeUndefined()
    // 次回合 2:1，使总比分 3:3，点球以本场主客方向记。
    const second = cupPlayerFixture(run)!.fixture
    const pens = second.homeId === 'player' ? { home: 5, away: 4 } : { home: 4, away: 5 }
    complete(game, 'champions', 2, 1, pens)
    expect(first.tie!.aggregate).toEqual({ home: 3, away: 3 })
    expect(first.tie!.winnerId).toBe('player')
    expect(run.stage).toBe('sf')
    complete(game, 'champions'); complete(game, 'champions')
    expect(run.stage).toBe('final')
    expect(cupPlayerFixture(run)!.tie!.legs).toHaveLength(1)
    complete(game, 'champions')
    expect(run.status).toBe('champion')
    expect(run.rounds).toHaveLength(4)
  })

  it('任何结果的旧赛季都允许重新报名，旧记录不丢失', () => {
    for (const status of ['active', 'eliminated', 'champion'] as const) {
      const game = gameInCup()
      game.pve!.cups.community.status = status
      game.season.index++
      ensurePve(game)
      expect(game.pve!.cupHistory).toHaveLength(1)
      expect(game.pve!.cupHistory![0].status).toBe(status === 'active' ? 'void' : status)
      expect(enterCup(game, 'community').ok).toBe(true)
      expect(game.pve!.cupHistory).toHaveLength(1)
    }
  })

  it('对手快照不随转会/培养改变，返回副本不污染内容', () => {
    const game = gameInCup(), run = game.pve!.cups.community
    const id = Object.keys(run.participants).find((key) => run.participants[key].kind === 'world')!
    const before = cupTeam(game, run, id)!
    game.aiTeams.find((team) => team.id === id)!.players[0].attrs.passing = 0
    expect(cupTeam(game, run, id)!.players[0].attrs).toEqual(before.players[0].attrs)
    before.players[0].attrs.passing = 0
    expect(cupTeam(game, run, id)!.players[0].attrs.passing).not.toBe(0)
  })

  it('JSON 读档后仍保留全部历史轮次与当前回合', () => {
    let game = gameInCup('champions')
    for (let i = 0; i < 4; i++) complete(game, 'champions')
    complete(game, 'champions')
    game = JSON.parse(JSON.stringify(game))
    const run = game.pve!.cups.champions
    expect(cupPlayerFixture(run)!.fixture.round).toBe(2)
    complete(game, 'champions')
    expect(run.rounds!.find((r) => r.round === 'qf')!.ties.find((t) => t.winnerId === 'player')!.legs.every((f) => f.played)).toBe(true)
  })
})
