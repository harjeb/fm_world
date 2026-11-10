import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { pickExchangeOpponent, previewTraining, startTraining, trainingAction, trainingEventChoice } from '../src/game/actions.ts'
import { planTraining } from '../src/game/training.ts'
import { trainingDate, trainingLowMood, trainingOptions, type TrainingActivityId } from '../src/game/training-calendar.ts'
import { EVENTS, eventById } from '../src/game/data/events.ts'
import { derivedRng, splitSeed } from '../src/game/rng.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { teamInputFromAI, teamInputFromLineup } from '../src/game/match/setup.ts'
import { isMainAttr } from '../src/game/scale.ts'
import { lineupRating } from '../src/game/club-rating.ts'
import { chemistryKey } from '../src/game/chemistry.ts'

function setup(count = 1) {
  const game = createInitialGame(410)
  const ids = game.roster.filter(p => !p.positions.GK).slice(0, count).map(p => p.id)
  ids.forEach((id, i) => {
    expect(startTraining(game, id, 120 + i).ok).toBe(true)
    const s = game.training[id]
    s.flags = EVENTS.map(e => e.id)
    s.lastEventAction = Object.fromEntries(EVENTS.map(e => [e.id, 1000]))
  })
  return { game, ids }
}
const activity = (activityId: TrainingActivityId) => ({ kind: 'activity' as const, activityId })

describe('calendar training', () => {
  it('maps all 30 slots to consecutive days including weekends and fixed activities', () => {
    const { game, ids } = setup()
    const s = game.training[ids[0]]
    for (let n = 1; n <= 30; n++) {
      const d = trainingDate(n)
      expect(d.week).toBe(Math.floor((n - 1) / 14) + 1)
      expect(d.day).toBe(Math.floor((n - 1) / 2) % 7 + 1)
      expect(d.slot).toBe(n % 2 ? '上午' : '下午')
      s.action = n - 1
      const options = trainingOptions(s)
      if (d.day === 1 && n % 2) expect(options.map(o => o.id)).toEqual(['exchange'])
      else if (d.day === 5) expect(options.map(o => o.id)).toEqual([n % 2 ? 'match' : 'rest'])
      else {
        expect(options.length).toBeGreaterThanOrEqual(5)
        expect(options.length).toBeLessThanOrEqual(6)
        expect(new Set(options.map(o => o.id)).size).toBe(options.length)
        expect(options.map(o => o.id)).toEqual(expect.arrayContaining(['mentor', 'rest']))
      }
    }
    expect(trainingDate(11).dayLabel).toBe('周六')
    expect(trainingDate(13).dayLabel).toBe('周日')
    expect(trainingDate(15)).toEqual({ week: 2, day: 1, dayLabel: '周一', slot: '上午' })
  })

  it('uses a common game seed and stable daily choices across players and copies', () => {
    const { game, ids } = setup(2)
    const [a, b] = ids.map(id => game.training[id])
    expect(a.scheduleVersion).toBe(1)
    expect(a.actionsTotal).toBe(30)
    expect(a.scheduleSeed).toBe(splitSeed(game.seed, 'training-calendar'))
    expect(b.scheduleSeed).toBe(a.scheduleSeed)
    for (let day = 2; day <= 14; day++) {
      a.action = b.action = (day - 1) * 2
      const morning = trainingOptions(a)
      expect(trainingOptions(b)).toEqual(morning)
      expect(trainingOptions(structuredClone(a))).toEqual(morning)
      a.action++
      if (![1, 5].includes(trainingDate(a.action + 1).day)) expect(trainingOptions(a)).toEqual(morning)
    }
  })

  it('completes a real 30-slot course, retaining exchange records across serialization', () => {
    const game = createInitialGame(411)
    const id = game.roster.find(player => !player.positions.GK)!.id
    expect(startTraining(game, id, 9).ok).toBe(true)
    const session = game.training[id]
    for (let guard = 0; guard < 80 && !session.completed; guard++) {
      if (session.pendingEventId) {
        expect(trainingEventChoice(game, id, eventById(session.pendingEventId)!.options[0].id).ok).toBe(true)
      } else {
        const options = trainingOptions(session)
        const option = options.find(item => item.id === (session.fatigue > 70 ? 'rest' : 'shooting')) ?? options.find(item => item.gains) ?? options[0]
        const result = trainingAction(game, id, activity(option.id))
        expect(result.ok, result.error).toBe(true)
      }
    }
    expect(session.completed).toBe(true)
    expect(session.action).toBe(30)
    expect(session.exchangeMatches?.map(match => match.week)).toEqual([1, 2, 3])
    expect(session.log.filter(entry => entry.title.startsWith('队内比赛')).map(entry => entry.week)).toEqual([1, 2])
    expect(JSON.parse(JSON.stringify(game)).training[id].exchangeMatches).toEqual(session.exchangeMatches)
    expect(game.candidates[id]).toBeTruthy()
  })

  it('rejects unavailable and legacy requests atomically, including pending events', () => {
    const { game, ids } = setup()
    const s = game.training[ids[0]]
    for (const request of [activity('rest'), { kind: 'rest' as const }, { kind: 'drill' as const, attr: 'speed' as const }]) {
      const before = structuredClone(game)
      expect(planTraining(structuredClone(s), request).invalid).toBeTruthy()
      expect(previewTraining(game, ids[0], request).error).toBeTruthy()
      expect(trainingAction(game, ids[0], request).ok).toBe(false)
      expect(game).toEqual(before)
    }
    s.pendingEventId = 'main_intake'
    const before = structuredClone(game)
    expect(trainingAction(game, ids[0], activity('exchange')).ok).toBe(false)
    expect(game).toEqual(before)
    expect(trainingEventChoice(game, ids[0], 'passing').ok).toBe(true)
  })

  it('validates all group participants before changing any session', () => {
    const { game, ids } = setup(2)
    const [a, b] = ids.map(id => game.training[id])
    a.action = b.action = 2
    const option = trainingOptions(a).find(o => o.group)!
    const request = { ...activity(option.id), teammateIds: [ids[1]] }
    for (const problem of ['progress', 'seed', 'pending', 'fatigue', 'duplicate']) {
      const copy = structuredClone(game)
      const other = copy.training[ids[1]]
      if (problem === 'progress') other.action++
      if (problem === 'seed') other.scheduleSeed!++
      if (problem === 'pending') other.pendingEventId = 'main_intake'
      if (problem === 'fatigue') other.fatigue = 100
      const bad = problem === 'duplicate' ? { ...request, teammateIds: [ids[1], ids[1]] } : request
      const before = structuredClone(copy)
      expect(previewTraining(copy, ids[0], bad).error).toBeTruthy()
      expect(trainingAction(copy, ids[0], bad).ok).toBe(false)
      expect(copy).toEqual(before)
    }
    expect(trainingAction(game, ids[0], request).ok).toBe(true)
    expect(a.action).toBe(3)
    expect(b.action).toBe(3)
  })

  it('simulates the actual exchange with the engine without changing league or roster', () => {
    const { game, ids } = setup(2)
    const s = game.training[ids[0]]
    const seed = s.scheduleSeed!
    const ownRating = lineupRating(game.roster, game.lineup)
    const picked = pickExchangeOpponent(game.aiTeams, ownRating, 1)
    const opponent = picked.team
    const home = teamInputFromLineup(game.roster, game.lineup, { id: 'player', name: game.clubName, color: '#34d399', accent: '#052e1b' })
    if (game.autoSubs) home.autoSubs = structuredClone(game.autoSubs)
    const engine = new MatchEngine({ seed: splitSeed(seed, 'training-exchange-1'), home, away: teamInputFromAI(opponent), knockout: false })
    const score = engine.simulate().score
    const before = structuredClone(game)
    const result = trainingAction(game, ids[0], { ...activity('exchange'), teammateIds: [ids[1]] })
    expect(result.ok).toBe(true)
    expect(result.exchange).toEqual({ week: 1, opponentId: opponent.id, opponentName: opponent.name, ownRating: Math.round(ownRating), opponentRating: Math.round(picked.rating), homeScore: score.home, awayScore: score.away, result: score.home > score.away ? 'win' : score.home < score.away ? 'loss' : 'draw' })
    expect(game.training[ids[1]].exchangeMatches).toEqual([result.exchange])
    expect(game.roster).toEqual(before.roster)
    expect(game.injuries).toEqual(before.injuries)
    expect(game.chemistry?.[chemistryKey(ids[0], ids[1])]?.training).toBe(0.5)
    const after = structuredClone(game)
    after.training = before.training
    after.chemistry = before.chemistry
    expect(after).toEqual(before)
    if (result.exchange?.result === 'loss') expect(s.lowMoodWeeks).toContain(2)
  })

  it('records a real loss once and applies mood to every group participant next week', () => {
    const { game, ids } = setup(2)
    // A much weaker current lineup against very strong opponents guarantees this seed loses.
    for (const player of game.roster) {
      for (const key of Object.keys(player.attrs) as (keyof typeof player.attrs)[]) player.attrs[key] = 1
    }
    for (const team of game.aiTeams) for (const player of team.players) {
      for (const key of Object.keys(player.attrs) as (keyof typeof player.attrs)[]) player.attrs[key] = isMainAttr(key, player.positions.GK > 0) ? 1500 : 20
    }
    const result = trainingAction(game, ids[0], { ...activity('exchange'), teammateIds: [ids[1]] })
    expect(result.exchange?.result).toBe('loss')
    for (const id of ids) {
      const s = game.training[id]
      expect(s.lowMoodWeeks).toEqual([2])
      expect(s.exchangeMatches).toEqual([result.exchange])
    }
    const before = structuredClone(game)
    expect(trainingAction(game, ids[0], activity('exchange')).ok).toBe(false)
    expect(game).toEqual(before)
  })

  it('交流赛和队内比赛不耗体力，体力耗尽时也照常有成长', () => {
    const { game, ids } = setup()
    const s = game.training[ids[0]]
    s.action = 8
    s.fatigue = 100
    // 体力 0 时有一半概率失败（失败不涨属性）；这里挑一个不失败的种子验证“不耗体力也照常有成长”。
    for (let seed = 0; seed < 100; seed++) {
      s.seed = seed
      if (previewTraining(game, ids[0], activity('match')).plan!.quality!.label !== '失败') break
    }
    const plan = previewTraining(game, ids[0], activity('match')).plan!
    expect(plan.fatigue).toBe(0)
    expect(plan.quality!.label).not.toBe('失败')
    expect(Object.values(plan.gains).some((value) => (value ?? 0) > 0)).toBe(true)
    expect(trainingAction(game, ids[0], activity('match')).ok).toBe(true)
    expect(s.fatigue).toBe(100)
    s.action = 14
    s.fatigue = 40
    const exchange = trainingAction(game, ids[0], activity('exchange'))
    expect(exchange.ok).toBe(true)
    expect(exchange.exchange?.week).toBe(2)
    expect(s.fatigue).toBe(40)
  })

  it('周五下午的休整不恢复体力，平时的恢复照常加 30', () => {
    const { game, ids } = setup()
    const s = game.training[ids[0]]
    s.action = 9
    s.fatigue = 60
    const [rest] = trainingOptions(s)
    expect(trainingOptions(s)).toHaveLength(1)
    expect(rest).toMatchObject({ id: 'rest', label: '休整', noRecovery: true })
    const plan = previewTraining(game, ids[0], activity('rest')).plan!
    expect(plan.fatigue).toBe(0)
    expect(plan.label).toBe('休整')
    expect(trainingAction(game, ids[0], activity('rest')).ok).toBe(true)
    expect(s.fatigue).toBe(60)
    expect(s.action).toBe(10)
    const normal = trainingOptions(s).find((option) => option.id === 'rest')!
    expect(normal.noRecovery).toBeUndefined()
    expect(trainingAction(game, ids[0], activity('rest')).ok).toBe(true)
    expect(s.fatigue).toBe(30)
  })

  it('其他项目体力不足还是不能执行，得先恢复', () => {
    const { game, ids } = setup()
    const s = game.training[ids[0]]
    s.action = 1
    s.fatigue = 100
    const paid = trainingOptions(s).find((option) => (option.cost ?? 0) > 0)!
    expect(trainingAction(game, ids[0], activity(paid.id)).ok).toBe(false)
    expect(s.action).toBe(1)
  })

  it('rejects an invalid exchange lineup without mutation', () => {
    const { game, ids } = setup()
    game.lineup.starters = []
    const before = structuredClone(game)
    expect(previewTraining(game, ids[0], activity('exchange')).error).toBeTruthy()
    expect(trainingAction(game, ids[0], activity('exchange')).ok).toBe(false)
    expect(game).toEqual(before)
  })

  it('halves positive gains including facility and teammate bonuses only Monday through Wednesday', () => {
    const { game, ids } = setup()
    const s = game.training[ids[0]]
    for (const key of Object.keys(s.candidate.attrs) as (keyof typeof s.candidate.attrs)[]) s.candidate.attrs[key] = 0
    s.lowMoodWeeks = [2]
    for (let n = 15; n <= 22; n++) {
      s.action = n - 1
      expect(trainingLowMood(s, n)).toBe(n <= 20)
      const option = trainingOptions(s).find(o => o.group)!
      const normal = structuredClone(s)
      normal.lowMoodWeeks = []
      const request = activity(option.id)
      const a = planTraining(structuredClone(s), request, undefined, 2)
      const b = planTraining(normal, request, undefined, 2)
      for (const [key, value] of Object.entries(b.gains)) expect(a.gains[key as keyof typeof a.gains]).toBeCloseTo((value as number) * (n <= 20 ? 0.5 : 1))
    }
  })

  it('halves event gains during low mood, but not after Wednesday', () => {
    const { game, ids } = setup()
    const s = game.training[ids[0]]
    for (const key of Object.keys(s.candidate.attrs) as (keyof typeof s.candidate.attrs)[]) s.candidate.attrs[key] = 0
    for (const action of [15, 16, 19, 20, 21]) {
      const normal = structuredClone(game)
      const sad = structuredClone(game)
      for (const g of [normal, sad]) {
        g.training[ids[0]].action = action
        g.training[ids[0]].pendingEventId = 'main_intake'
        g.training[ids[0]].pendingEventAction = action
      }
      sad.training[ids[0]].lowMoodWeeks = [2]
      const a = trainingEventChoice(sad, ids[0], 'passing')
      const b = trainingEventChoice(normal, ids[0], 'passing')
      expect(a.ok && b.ok).toBe(true)
      expect(b.gains!.passing).toBeGreaterThan(0)
      expect(a.gains!.passing).toBeCloseTo(b.gains!.passing! * (action <= 20 ? 0.5 : 1))
    }
  })

  it.each([18, 30])('keeps legacy %i-action sessions playable', total => {
    const { game, ids } = setup()
    const s = game.training[ids[0]]
    delete s.scheduleVersion
    if (total === 18) delete s.actionsTotal
    for (let n = 1; n <= total; n++) {
      expect(trainingAction(game, ids[0], { kind: 'rest' }).ok).toBe(true)
      expect(s.completed).toBe(n === total)
    }
    expect(game.candidates[ids[0]]).toBeTruthy()
  })
})
