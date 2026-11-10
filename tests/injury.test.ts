import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { injuryProneness, injuryUntil, personKey, prepareMatchInjuries, recordMatchInjuries } from '../src/game/injury.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { startTraining, trainingAction, trainingEventChoice, confirmTraining, startLeague, startSingleChallenge, restoreActiveEngine, finishMatch } from '../src/game/actions.ts'
import { eventById } from '../src/game/data/events.ts'
import { advanceLeagueRealtime } from '../src/game/realtime.ts'
import { catchUpSeason, simulateFixture } from '../src/game/season.ts'
import { kickoffAtForRound } from '../src/game/calendar.ts'
import { matchRealSeconds } from '../src/game/match/time.ts'

function setup() {
  const game = createInitialGame(12)
  const input = teamInputFromLineup(game.roster, game.lineup, { id: 'p', name: 'P', color: '#fff', accent: '#000' })
  return { game, engine: new MatchEngine({ seed: 12, home: input, away: input, knockout: false }) }
}

describe('人物伤病', () => {
  it('同人物不同卡共享，恢复边界及无效时间安全处理', () => {
    const { game, engine } = setup()
    const player = game.roster[0]
    const otherCard = { ...player, id: 'other-card' }
    const otherPerson = { ...player, seedId: 'another-person' }
    game.injuries = { [personKey(player)]: 200 }
    expect(injuryUntil(game, otherCard, 199)).toBe(200)
    expect(injuryUntil(game, otherPerson, 199)).toBeNull()
    expect(injuryUntil(game, player, 200)).toBeNull()
    prepareMatchInjuries(engine.state, game.injuries, 199)
    expect(engine.state.teams.flatMap(t => t.players).filter(p => p.personId === personKey(player)).every(p => p.injured)).toBe(true)
    expect(injuryUntil({ injuries: { [personKey(player)]: NaN } }, player, 1)).toBeNull()
    expect(personKey({ id: 'fallback', seedId: '' })).toBe('fallback')
    expect(injuryProneness(personKey(player))).toBe(injuryProneness(personKey(otherCard)))
    expect(injuryProneness(personKey(player))).toBeGreaterThanOrEqual(1)
    expect(injuryProneness(personKey(player))).toBeLessThanOrEqual(20)
  })

  it('记录固定截止时间并幂等，不修改训练，旧日志安全', () => {
    const { game, engine } = setup()
    const training = structuredClone(game.training)
    engine.state.log.push({ seq: 123, clock: 10, half: 1, type: 'injury', team: 'home', text: '', injury: { personId: 'person', recoveryDays: 2 } })
    engine.state.log.push({ seq: 124, clock: 11, half: 1, type: 'injury', team: 'home', text: '' })
    recordMatchInjuries(game, engine.state, 1000, true)
    const until = 1000 + matchRealSeconds(10, engine.state.durationSeconds) * 1000 + 2 * game.season.gameDayMs
    expect(game.injuries).toEqual({ person: until })
    recordMatchInjuries(game, engine.state, 999999999, true)
    expect(game.injuries!.person).toBe(until)
    expect(game.training).toEqual(training)
  })

  it('受伤不会改变精力或培养过程，确认成品后伤病仍属于同一人物', () => {
    const game = createInitialGame(2024)
    const healthy = structuredClone(game)
    const player = game.roster.find(p => p.positions.GK === 0)!
    expect(startTraining(game, player.id, 777).ok).toBe(true)
    expect(startTraining(healthy, player.id, 777).ok).toBe(true)
    delete game.training[player.id].scheduleVersion
    delete healthy.training[player.id].scheduleVersion
    const until = Date.now() + 60_000
    game.injuries = { [personKey(player)]: until }
    for (let i = 0; i < 100 && !game.training[player.id].completed; i++) {
      const session = game.training[player.id]
      if (session.pendingEventId) {
        const option = eventById(session.pendingEventId)!.options[0].id
        expect(trainingEventChoice(game, player.id, option).ok).toBe(true)
        expect(trainingEventChoice(healthy, player.id, option).ok).toBe(true)
      } else {
        const request = session.fatigue + 12 > 100 ? { kind: 'rest' as const } : { kind: 'drill' as const, attr: 'passing' as const }
        expect(trainingAction(game, player.id, request).ok).toBe(true)
        expect(trainingAction(healthy, player.id, request).ok).toBe(true)
      }
    }
    expect(game.training[player.id].completed).toBe(true)
    expect(game.training[player.id].energy).toBe(healthy.training[player.id].energy)
    expect(game.roster.find(p => p.id === player.id)!.energy).toBe(healthy.roster.find(p => p.id === player.id)!.energy)
    expect(game.candidates[player.id]).toEqual(healthy.candidates[player.id])
    expect(confirmTraining(game, player.id).ok).toBe(true)
    expect(injuryUntil(game, game.roster.find(p => p.id === player.id)!, until - 1)).toBe(until)
  })

  it('挑战赛忽略赛前伤病，不会带入也不会延长伤期', () => {
    const game = createInitialGame(12)
    const starter = game.roster.find(p => p.id === game.lineup.starters[0].playerId)!
    const until = 2_000_000
    game.injuries = { [personKey(starter)]: until }
    expect(startSingleChallenge(game, game.aiTeams[0].id, until - 1).ok).toBe(true)
    let engine = restoreActiveEngine(game)!
    expect(engine.getTeam('home').players.find(p => p.sourceId === starter.id)!.injured).not.toBe(true)
    engine.simulate()
    expect(finishMatch(game, engine, until - 1)).not.toBeNull()
    expect(game.injuries[personKey(starter)]).toBe(until)
    expect(startSingleChallenge(game, game.aiTeams[0].id, until).ok).toBe(true)
    engine = restoreActiveEngine(game)!
    expect(engine.getTeam('home').players.find(p => p.sourceId === starter.id)!.injured).not.toBe(true)
  })

  it('实时联赛受伤后立即入档，恢复/重复推进不延长伤期', () => {
    const game = createInitialGame(15)
    expect(startLeague(game, 1_000_000).ok).toBe(true)
    const injected = restoreActiveEngine(game)!
    injected.state.log.push({ seq: injected.state.log.length + 1, clock: 300, half: 1, type: 'injury', team: 'home', text: '', injury: { personId: 'person', recoveryDays: 2 } })
    game.activeMatch!.engineState = injected.serialize()
    advanceLeagueRealtime(game, 1_150_000)
    const engine = restoreActiveEngine(game)!
    const event = engine.state.log.find(e => e.injury)!
    expect(event).toBeDefined()
    const { personId, recoveryDays, recoverAt } = event.injury!
    expect(recoverAt).toBe(1_000_000 + matchRealSeconds(event.clock, engine.state.durationSeconds) * 1000 + recoveryDays * game.season.gameDayMs)
    expect(game.injuries![personId]).toBe(recoverAt)
    const restored = structuredClone(game)
    advanceLeagueRealtime(restored, 1_200_000)
    expect(restored.injuries![personId]).toBe(recoverAt)
    advanceLeagueRealtime(restored, 1_600_000)
    expect(restored.injuries![personId]).toBe(recoverAt)
  })

  it('联赛服务器晚重启时，AI 伤病按比赛时间而非重启时间恢复', () => {
    const onTime = createInitialGame(16)
    expect(startLeague(onTime, 1_000_000).ok).toBe(true)
    const injected = restoreActiveEngine(onTime)!
    injected.state.log.push({ seq: injected.state.log.length + 1, clock: 200, half: 1, type: 'injury', team: 'home', text: '', injury: { personId: 'one', recoveryDays: 2 } })
    injected.state.log.push({ seq: injected.state.log.length + 1, clock: 400, half: 1, type: 'injury', team: 'away', text: '', injury: { personId: 'two', recoveryDays: 2 } })
    onTime.activeMatch!.engineState = injected.serialize()
    const restarted = structuredClone(onTime)
    advanceLeagueRealtime(onTime, 1_600_000)
    advanceLeagueRealtime(restarted, 100_000_000)
    expect(Object.keys(onTime.injuries ?? {}).length).toBeGreaterThan(1)
    expect(restarted.injuries).toEqual(onTime.injuries)
    expect(restarted.season.fixtures.map(f => f.score)).toEqual(onTime.season.fixtures.map(f => f.score))
  })

  it('补赛按实际赛程记录伤病，一次或分批补算结果相同', () => {
    // 伤病是低概率事件，不写死某个种子：只模拟玩家自己的第一场，找一个真有人受伤的种子。
    const seed = (() => {
      for (let candidate = 1; candidate <= 80; candidate++) {
        const probe = createInitialGame(candidate)
        const fixture = probe.season.fixtures.find((item) => item.isPlayer)!
        fixture.kickoffAt = probe.season.startedAt
        const record = simulateFixture(probe, fixture, true, probe.season.startedAt)
        if (record?.keyEvents.some((entry) => entry.injury)) return candidate
      }
      throw new Error('前 80 个种子的第一轮都没有伤病，伤病概率可能被改坏了')
    })()
    const one = createInitialGame(seed)
    const batches = structuredClone(one)
    const start = one.season.startedAt
    catchUpSeason(one, kickoffAtForRound(start, 4))
    for (let round = 1; round <= 3; round++) catchUpSeason(batches, kickoffAtForRound(start, round + 1))
    expect(one.injuries).toEqual(batches.injuries)
    expect(one.season.fixtures.map(f => f.score)).toEqual(batches.season.fixtures.map(f => f.score))
    // 伤病是低概率事件，不绑定某一年某一轮：在前三轮里找第一场有伤病的比赛。
    const record = one.matchHistory.find((item) => item.keyEvents.some((entry) => entry.injury))!
    expect(record).toBeDefined()
    const event = record.keyEvents.find((entry) => entry.injury)!
    expect(event).toBeDefined()
    // 伤病从那一轮的开球时间算起（一天两轮：第 1、2、3 轮分别在开始后 0、8、24 小时）。
    expect(record.round).toBeDefined()
    expect(event.injury!.recoverAt).toBe(kickoffAtForRound(start, record.round!) + matchRealSeconds(event.clock, record.durationSeconds ?? 900) * 1000 + event.injury!.recoveryDays * one.season.gameDayMs)
  }, 20_000)

  it('当场跨队跨卡生效，旧比赛兼容且快照隐藏倾向', () => {
    const { engine } = setup()
    const home = engine.state.teams[0].players[0]
    const away = engine.state.teams[1].players[0]
    const bench = engine.state.teams[1].bench[0]
    bench.personId = home.personId
    delete home.injuryProneness
    delete away.injuryProneness
    const injure = (engine as unknown as { maybeInjure: (p: typeof home) => void }).maybeInjure.bind(engine)
    for (let step = 0; step < 10000 && !home.injured; step++) { engine.state.step = step; injure(home) }
    expect(home.injured && away.injured && bench.injured).toBe(true)
    expect(engine.state.log.filter(e => e.type === 'injury')).toHaveLength(1)
    injure(away)
    expect(engine.state.log.filter(e => e.type === 'injury')).toHaveLength(1)
    expect(JSON.stringify(engine.snapshot())).not.toContain('injuryProneness')
    delete home.personId
    expect(() => injure(home)).not.toThrow()
  })
})
