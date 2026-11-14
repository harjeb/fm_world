import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { createMatchRecord } from '../src/game/match/setup.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { performanceRating } from '../src/game/match/performance.ts'
import { PesEngine } from '../src/game/pes/engine.ts'
import { baselineTeams } from '../src/game/pes/baseline.ts'
import { PesGame } from '../src/game/pes/game.ts'
import type { PesEvent, PesMatchSnapshot } from '../src/game/pes/spec.ts'
import type { PlayerMatchStats } from '../src/game/types.ts'

const teams = baselineTeams(1)
const inputs = () => ({ home: structuredClone(teams.home), away: structuredClone(teams.away) })
const newGame = () => new PesGame({ ...inputs(), seed: 71, durationSeconds: 120, noInjuries: true })
const addedFields = ['shotsOnTarget', 'xg', 'chancesCreated', 'chancesConverted', 'xa', 'tackleAttempts', 'saves', 'rating'] as const

function fire(g: PesGame, event: PesEvent): void {
  g.settlement.onEvent(g.match, event)
}

describe('新增比赛数据的事件记录', () => {
  it('按射门结果记录射正和 xG；关键传球只计一次，只有真正进球后才计机会转化', () => {
    const g = newGame()
    const [passer, shooter] = g.match.teams[0].players.slice(1, 3)
    const p = g.settlement.gamePlayer(passer.pid).stats
    const s = g.settlement.gamePlayer(shooter.pid).stats
    fire(g, { type: 'pass', ti: 0, t: 1, actors: [passer.pid, shooter.pid], meta: { result: 'ok' } })
    g.match.ball.lastTouch = shooter.pid
    fire(g, { type: 'shot', ti: 0, t: 2, actors: [shooter.pid], xg: 0.23, meta: { result: 'goal' } })
    expect(s).toMatchObject({ shots: 1, shotsOnTarget: 1, xg: 0.23 })
    expect(p).toMatchObject({ chancesCreated: 1, chancesConverted: 0, xa: 0.23 })
    g.match.teams[0].score = 1
    fire(g, { type: 'goal', ti: 0, t: 3, actors: [shooter.pid] })
    expect(p.chancesConverted).toBe(1)
    fire(g, { type: 'shot', ti: 0, t: 4, actors: [shooter.pid], xg: 0.12, meta: { result: 'miss' } })
    expect(s.shotsOnTarget).toBe(1)
    expect(s.xg).toBeCloseTo(0.35)
    expect(p.chancesCreated).toBe(1)
    expect(p.xa).toBe(0.23)
  })

  it('丢球、接球者不符、超时及直接任意球不会凭空创造机会', () => {
    const g = newGame()
    const [passer, receiver, other] = g.match.teams[0].players.slice(1, 4)
    const opponent = g.match.teams[1].players[1]
    const p = g.settlement.gamePlayer(passer.pid).stats
    const pass = (t: number) => fire(g, { type: 'pass', ti: 0, t, actors: [passer.pid, receiver.pid], meta: { result: 'ok' } })
    const shot = (t: number, pid: number, freeKick = false) => {
      g.match.ball.lastTouch = pid
      fire(g, { type: 'shot', ti: 0, t, actors: [pid], xg: 0.1, meta: { result: 'miss', freeKick } })
    }
    pass(1); shot(2, other.pid)
    pass(3); shot(12, receiver.pid)
    pass(13); fire(g, { type: 'duel', ti: 1, t: 14, actors: [opponent.pid, receiver.pid], meta: { outcome: 'loose' } }); shot(15, receiver.pid)
    pass(16); shot(17, receiver.pid, true)
    fire(g, { type: 'pass', ti: 0, t: 18, actors: [passer.pid, receiver.pid], meta: { result: 'miss' } }); shot(19, receiver.pid)
    expect(p).toMatchObject({ chancesCreated: 0, chancesConverted: 0, xa: 0 })
  })

  it('传中和角球按实际争顶者归属机会，并记录扑救但不把出击没收算作射门扑救', () => {
    const g = newGame()
    const [passer, intended, winner] = g.match.teams[0].players.slice(1, 4)
    const keeper = g.match.teams[1].players[0]
    const p = g.settlement.gamePlayer(passer.pid).stats
    const k = g.settlement.gamePlayer(keeper.pid).stats
    fire(g, { type: 'pass', ti: 0, t: 1, actors: [passer.pid, intended.pid], meta: { result: 'ok', kind: 'cross' } })
    g.match.ball.meta = { type: 'pass', from: passer.pid, intended: intended.pid, cross: true }
    g.match.ball.lastTouch = passer.pid
    fire(g, { type: 'aerial', ti: 0, t: 2, actors: [winner.pid], meta: { attacking: true } })
    fire(g, { type: 'shot', ti: 0, t: 2, actors: [winner.pid], xg: 0.31, meta: { result: 'save', header: true } })
    fire(g, { type: 'save', ti: 1, t: 3, actors: [keeper.pid, winner.pid], meta: { hold: true } })
    fire(g, { type: 'save', ti: 1, t: 4, actors: [keeper.pid], meta: { claim: true } })
    expect(p).toMatchObject({ chancesCreated: 1, xa: 0.31 })
    expect(k.saves).toBe(1)
    // 角球直接争顶，不产生普通传球事件。
    fire(g, { type: 'corner', ti: 0, t: 5, actors: [] })
    g.match.ball.meta = { type: 'pass', from: passer.pid, cross: true }
    fire(g, { type: 'aerial', ti: 0, t: 6, actors: [winner.pid], meta: { attacking: true } })
    fire(g, { type: 'shot', ti: 0, t: 6, actors: [winner.pid], xg: 0.2, meta: { result: 'miss', header: true } })
    expect(p.chancesCreated).toBe(2)
    expect(p.xa).toBeCloseTo(0.51)
  })

  it('对抗事件区分上抢犯规和战术犯规，统计可以从事件流重新计算', () => {
    const g = newGame()
    const defender = g.match.teams[1].players[1]
    const attacker = g.match.teams[0].players[1]
    const stats = g.settlement.gamePlayer(defender.pid).stats
    fire(g, { type: 'duel', ti: 1, t: 1, actors: [defender.pid, attacker.pid], meta: { outcome: 'keep' } })
    fire(g, { type: 'duel', ti: 1, t: 2, actors: [defender.pid, attacker.pid], meta: { outcome: 'loose' } })
    fire(g, { type: 'tackle', ti: 1, t: 3, actors: [defender.pid, attacker.pid], meta: { outcome: 'tackle' } })
    fire(g, { type: 'foul', ti: 1, t: 4, actors: [defender.pid, attacker.pid], meta: { tackleAttempt: true } })
    fire(g, { type: 'foul', ti: 1, t: 5, actors: [defender.pid, attacker.pid] })
    expect(stats).toMatchObject({ tackleAttempts: 4, tackles: 1 })
  })

  it('正在进行的传球及高级数据随快照恢复；旧比赛不把半场记录伪装为整场数据', () => {
    const g = newGame()
    const [passer, shooter] = g.match.teams[0].players.slice(1, 3)
    fire(g, { type: 'pass', ti: 0, t: 1, actors: [passer.pid, shooter.pid], meta: { result: 'ok' } })
    const snap = JSON.parse(JSON.stringify(g.serialize())) as PesMatchSnapshot
    const resumed = PesGame.restore(snap)
    resumed.match.ball.lastTouch = shooter.pid
    fire(resumed, { type: 'shot', ti: 0, t: 2, actors: [shooter.pid], xg: 0.4, meta: { result: 'miss' } })
    expect(resumed.settlement.gamePlayer(passer.pid).stats).toMatchObject({ chancesCreated: 1, xa: 0.4 })

    const old = newGame()
    old.advance(30)
    const before = JSON.parse(JSON.stringify(old.serialize())) as PesMatchSnapshot
    const contact = before.contact as { game: typeof old.state; extra: { keyPass?: unknown } }
    delete contact.extra.keyPass
    for (const team of contact.game.teams) for (const player of [...team.players, ...team.bench]) {
      for (const field of addedFields) delete player.stats[field]
    }
    const oldResumed = PesGame.restore(before)
    oldResumed.run()
    const straight = PesGame.restore(JSON.parse(JSON.stringify(old.serialize())) as PesMatchSnapshot)
    straight.run()
    const withoutNewFoulMetadata = (events: PesEvent[]) => events.map(event => {
      const copy = structuredClone(event)
      if (copy.meta) delete copy.meta.tackleAttempt
      return copy
    })
    expect(withoutNewFoulMetadata(oldResumed.match.events)).toEqual(withoutNewFoulMetadata(straight.match.events))
    expect(oldResumed.state.score).toEqual(straight.state.score)
    for (const team of oldResumed.state.teams) for (const player of [...team.players, ...team.bench]) {
      for (const field of addedFields) expect(player.stats[field]).toBeUndefined()
      expect(performanceRating(player.stats)).toBeUndefined()
    }
  })
})

describe('两代引擎到战报的完整记录', () => {
  it.each([2, 3])('旧 v%s 进行中快照继续比赛时不伪造缺失数据，也不改变赛果', (rulesVersion) => {
    const engine = new MatchEngine({ ...inputs(), seed: 88, knockout: false, durationSeconds: 100, rulesVersion, recordPlayback: false })
    for (let i = 0; i < 12; i++) engine.step()
    const complete = engine.serialize()
    const old = structuredClone(complete)
    for (const team of old.teams) for (const player of [...team.players, ...team.bench]) {
      for (const field of addedFields) delete player.stats[field]
    }
    delete old.recordKeyPass
    const resumed = MatchEngine.restore(old, false)
    const control = MatchEngine.restore(complete, false)
    resumed.simulate()
    control.simulate()
    expect(resumed.state.score).toEqual(control.state.score)
    expect(resumed.state.log).toEqual(control.state.log)
    for (const team of resumed.state.teams) for (const player of [...team.players, ...team.bench]) {
      for (const field of addedFields) expect(player.stats[field]).toBeUndefined()
      expect(performanceRating(player.stats)).toBeUndefined()
    }
  })

  it.each(['pes', 'v2'] as const)('%s 球员射正、xG、抢断与球队统计一致，评分可持久化', (kind) => {
    const engine = kind === 'pes'
      ? new PesEngine({ ...inputs(), seed: 431, knockout: false, durationSeconds: 180, noInjuries: true })
      : new MatchEngine({ ...inputs(), seed: 431, knockout: false, durationSeconds: 180, noInjuries: true, rulesVersion: 2, recordPlayback: false })
    const state = engine.simulate()
    for (const team of state.teams) {
      const players = [...team.players, ...team.bench]
      const sum = (key: keyof PlayerMatchStats) => players.reduce((total, player) => total + Number(player.stats[key] ?? 0), 0)
      expect(sum('shots')).toBe(state.stats[team.side].shots)
      expect(sum('shotsOnTarget')).toBe(state.stats[team.side].shotsOnTarget)
      expect(sum('xg')).toBeCloseTo(state.stats[team.side].xg, 8)
      expect(sum('tackles')).toBe(state.stats[team.side].tackles)
      for (const player of players) {
        expect(player.stats.tackleAttempts).toBeGreaterThanOrEqual(player.stats.tackles)
        expect(player.stats.chancesConverted).toBeLessThanOrEqual(player.stats.chancesCreated!)
      }
    }
    if (engine instanceof PesEngine) {
      const { match, settlement } = engine.game
      for (const player of match.players) {
        const stat = settlement.gamePlayer(player.pid).stats
        const events = match.events.filter(event => event.actors[0] === player.pid)
        const shots = events.filter(event => event.type === 'shot')
        expect(stat.shotsOnTarget).toBe(shots.filter(event => event.meta?.result === 'goal' || event.meta?.result === 'save').length)
        expect(stat.xg).toBeCloseTo(shots.reduce((sum, event) => sum + (event.xg ?? 0), 0), 8)
        expect(stat.tackleAttempts).toBe(events.filter(event => event.type === 'tackle' || event.type === 'duel' || event.type === 'foul' && event.meta?.tackleAttempt === true).length)
      }
    }
    const game = createInitialGame(3)
    const record = createMatchRecord(game, state, { isLeague: false, opponentId: 'opponent', opponentName: '对手', seed: 431, homeAway: 'home' })
    expect(record.playerStats.length).toBeGreaterThan(20)
    for (const stat of record.playerStats.filter(row => row.minutes > 0)) {
      expect(stat.rating).toBeGreaterThanOrEqual(1)
      expect(stat.rating).toBeLessThanOrEqual(10)
      expect(stat.xg).toBeGreaterThanOrEqual(0)
    }
    expect(JSON.parse(JSON.stringify(record)).playerStats).toEqual(record.playerStats)
  })
})
