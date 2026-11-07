import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialGame, loadGame, saveGame } from '../src/game/state.ts'
import { previewTraining, startTraining, trainingAction, trainingEventChoice } from '../src/game/actions.ts'
import { EVENTS, eventById } from '../src/game/data/events.ts'
import { createTrainingSession, eligibleEvents, failureChance, plainChance } from '../src/game/training.ts'
import { economyOf } from '../src/game/economy.ts'
import { displayEventHint } from '../src/ui/format.ts'
import type { GameState, TrainingSession } from '../src/game/types.ts'

// Keep event selection from obscuring tests concerned with course mechanics.
function suppressEvents(session: TrainingSession) {
  session.flags = EVENTS.map(event => event.id)
  session.lastEventAction = Object.fromEntries(EVENTS.map(event => [event.id, 1000]))
  session.eventCounts = Object.fromEntries(EVENTS.map(event => [event.id, 1000]))
}

function setup(count = 1) {
  const game = createInitialGame(410)
  // 满 1 级（第 5 阶段）保证设施加成 100% 触发，便于比较确定数值。
  const economy = economyOf(game)
  for (const id of ['stadium', 'academy', 'medical', 'shop', 'sponsor', 'psychology', 'tactics'] as const) economy[id] = 5
  const players = game.roster.filter(player => !player.positions.GK).slice(0, count)
  for (const [index, player] of players.entries()) {
    expect(startTraining(game, player.id, 120 + index).ok).toBe(true)
    delete game.training[player.id].scheduleVersion
    const session = game.training[player.id]
    suppressEvents(session)
    // Leave ample headroom for comparing uncapped gains.
    for (const key of Object.keys(session.candidate.attrs) as (keyof typeof session.candidate.attrs)[]) session.candidate.attrs[key] = 0
  }
  return { game, players, sessions: players.map(player => game.training[player.id]) }
}

const drill = { kind: 'drill', attr: 'speed' } as const
const combo = { kind: 'combo', focus: 'attack' } as const
// Match is a new course action; its minimal request has no additional fields.
const match = { kind: 'match' } as const
const courses = [drill, combo, match] as const

function preview(game: GameState, id: string, request: any) {
  return previewTraining(game, id, request)
}
function act(game: GameState, id: string, request: any) {
  return trainingAction(game, id, request)
}

afterEach(() => vi.unstubAllGlobals())

describe('expanded training courses', () => {
  it('creates 30-action courses and preserves the 18-action legacy fallback', () => {
    for (const legacy of [false, true]) {
      const { game, players, sessions } = setup()
      const [session] = sessions
      expect(session.actionsTotal).toBe(30)
      if (legacy) delete session.actionsTotal
      const total = legacy ? 18 : 30
      for (let i = 1; i <= total; i++) {
        const result = act(game, players[0].id, { kind: 'rest' })
        expect(result.ok).toBe(true)
        expect(session.action).toBe(i)
        expect(session.completed).toBe(i === total)
        expect(Boolean(game.candidates[players[0].id])).toBe(i === total)
      }
      expect(session.log.at(-1)?.action).toBe(total)
      expect(act(game, players[0].id, { kind: 'rest' }).ok).toBe(false)
    }
  })

  it('preserves graduation milestones for new and legacy courses', () => {
    const { sessions } = setup()
    const session = sessions[0]
    session.flags = []
    session.lastEventAction = {}
    session.eventCounts = {}
    expect(eligibleEvents(session, 6).some(event => event.id === 'main_test1')).toBe(true)
    expect(eligibleEvents(session, 12).some(event => event.id === 'main_test2')).toBe(true)
    expect(eligibleEvents(session, 18).some(event => event.id === 'main_graduation')).toBe(false)
    expect(eligibleEvents(session, 30).some(event => event.id === 'main_graduation')).toBe(true)
    delete session.actionsTotal
    expect(eligibleEvents(session, 18).some(event => event.id === 'main_graduation')).toBe(true)
    expect(eligibleEvents(session, 30).some(event => event.id === 'main_graduation')).toBe(false)
  })

  it('defers graduation until a naturally selected final-action event is resolved', () => {
    const { game, players, sessions } = setup()
    const session = sessions[0]
    // main_intake is a naturally guaranteed first-action event; place the course
    // immediately before its final action while retaining its eligibility.
    session.action = 29
    session.flags = []
    session.lastEventAction = {}
    session.eventCounts = {}
    // A mentor action forces selection of an eligible natural event.
    const result = act(game, players[0].id, { kind: 'mentor' })
    expect(result.ok).toBe(true)
    expect(session.pendingEventId).toBeTruthy()
    expect(session.completed).toBe(false)
    expect(game.candidates[players[0].id]).toBeUndefined()
    const event = eventById(session.pendingEventId!)!
    expect(trainingEventChoice(game, players[0].id, event.options[0].id).ok).toBe(true)
    expect(session.completed).toBe(true)
    expect(game.candidates[players[0].id]).toEqual(session.candidate)
    expect(session.log.at(-1)?.action).toBe(30)
  })

  it('shows event fatigue effects as training stamina and preserves legacy energy', () => {
    expect(displayEventHint('传球 +2，疲劳 +3，职业素养 +2', false)).toBe('传球 +30，训练体力 -3，职业素养 +2')
    expect(displayEventHint('传球 +2，疲劳 +3，职业素养 +2', false, 0.5)).toBe('传球 +15，训练体力 -3，职业素养 +2')
    expect(displayEventHint('决策 +1，疲劳 -6', false)).toBe('决策 +1，训练体力 +6')
    const game = createInitialGame(410)
    const player = game.roster[0]
    delete (player as Partial<typeof player>).energy
    expect(startTraining(game, player.id, 120).ok).toBe(true)
    delete game.training[player.id].scheduleVersion
    expect(player.energy).toBe(70)
  })

  it('halves new event base gains while retaining facility bonuses and old course values', () => {
    const { game, players, sessions } = setup()
    const id = players[0].id
    const current = sessions[0]
    const legacy = structuredClone(current)
    delete legacy.actionsTotal
    current.pendingEventId = legacy.pendingEventId = 'main_intake'
    game.training[id] = current
    const a = trainingEventChoice(game, id, 'passing')
    game.training[id] = legacy
    const b = trainingEventChoice(game, id, 'passing')
    expect(a.gains!.passing).toBeCloseTo(15 + 7)
    expect(b.gains!.passing).toBeCloseTo(30 + 7)
    expect(a.gains!.firstTouch).toBeCloseTo(0.5 + 7 * 20 / 1500)
    expect(b.gains!.firstTouch).toBeCloseTo(1 + 7 * 20 / 1500)
    expect(displayEventHint('传球 +2，第一脚触球 +1', false, 0.5)).toBe('传球 +15，第一脚触球 +0.5')
  })

  it('uses one deterministic quality per player and action across all course requests', () => {
    const { game, players } = setup()
    const id = players[0].id
    const before = structuredClone(game)
    const plans = courses.map(request => preview(game, id, request).plan!)
    expect(plans.every(Boolean)).toBe(true)
    expect(plans[0].quality).toEqual(plans[1].quality)
    expect(plans[1].quality).toEqual(plans[2].quality)
    expect(preview(game, id, drill).plan).toEqual(plans[0])
    expect(game).toEqual(before)
    expect(['一般', '成功', '大成功', '完美成功']).toContain(plans[0].quality!.label)
    expect(({ '一般': 0.7, '成功': 1, '大成功': 1.3, '完美成功': 1.6 } as Record<string, number>)[plans[0].quality!.label]).toBe(plans[0].quality!.multiplier)
  })

  it('体力 60 以上不出一般，大成功 10%、完美成功 2%，其余是成功', () => {
    const { game, players, sessions } = setup()
    for (const fatigue of [0, 20, 40]) {
      sessions[0].fatigue = fatigue
      const counts: Record<string, number> = {}
      for (let seed = 0; seed < 4096; seed++) {
        sessions[0].seed = seed
        const quality = preview(game, players[0].id, drill).plan!.quality!
        counts[quality.label] = (counts[quality.label] ?? 0) + 1
      }
      expect(counts['一般'], `fatigue ${fatigue}`).toBeUndefined()
      expect(Math.abs(counts['大成功'] / 4096 - 0.1), `fatigue ${fatigue}`).toBeLessThan(0.02)
      expect(Math.abs(counts['完美成功'] / 4096 - 0.02), `fatigue ${fatigue}`).toBeLessThan(0.01)
      expect(Math.abs(counts['成功'] / 4096 - 0.88), `fatigue ${fatigue}`).toBeLessThan(0.03)
    }
  })

  it('体力低于 60 才会出一般，越低越多，大成功和完美成功的概率不变', () => {
    expect(plainChance(60)).toBe(0)
    expect(plainChance(100)).toBe(0)
    expect(plainChance(59)).toBeGreaterThan(0)
    expect(plainChance(30)).toBeGreaterThan(plainChance(50))
    // 体力 30 以下“一般”不再升高，把余量让给失败。
    expect(plainChance(0)).toBeCloseTo(0.4)
    const { game, players, sessions } = setup()
    const seen = new Map<string, number>()
    const share = (fatigue: number) => {
      sessions[0].fatigue = fatigue
      const counts: Record<string, number> = {}
      for (let seed = 0; seed < 4096; seed++) {
        sessions[0].seed = seed
        const quality = preview(game, players[0].id, drill).plan!.quality!
        counts[quality.label] = (counts[quality.label] ?? 0) + 1
        seen.set(quality.label, quality.multiplier)
      }
      return (label: string) => (counts[label] ?? 0) / 4096
    }
    const half = share(70)  // 体力 30：没有大成功/完美，开始有 5% 失败
    expect(Math.abs(half('一般') - plainChance(30))).toBeLessThan(0.03)
    expect(half('大成功')).toBe(0)
    expect(half('完美成功')).toBe(0)
    expect(Math.abs(half('失败') - failureChance(30))).toBeLessThan(0.02)
    expect(Object.fromEntries(seen)).toEqual({ '一般': 0.7, '成功': 1, '失败': 0 })
  })

  it('体力 30 及以下没有大成功/完美，失败随体力下降变多，且失败不涨任何属性', () => {
    expect(failureChance(30)).toBeCloseTo(0.05)
    expect(failureChance(15)).toBeGreaterThan(failureChance(30))
    expect(failureChance(0)).toBeCloseTo(0.5)
    expect(failureChance(31)).toBe(0)
    const { game, players, sessions } = setup()
    const session = sessions[0]
    // 专项训练要 12 点体力，最高只能带着 88 疲劳开练（体力 12）。
    session.fatigue = 88
    const counts: Record<string, number> = {}
    for (let seed = 0; seed < 4096; seed++) {
      session.seed = seed
      const quality = preview(game, players[0].id, drill).plan!.quality!
      counts[quality.label] = (counts[quality.label] ?? 0) + 1
    }
    expect(counts['大成功']).toBeUndefined()
    expect(counts['完美成功']).toBeUndefined()
    expect(Math.abs(counts['失败'] / 4096 - failureChance(12))).toBeLessThan(0.03)
    expect(Math.abs(counts['一般'] / 4096 - plainChance(12))).toBeLessThan(0.03)
    expect(counts['失败'] + counts['一般'] + counts['成功']).toBe(4096)

    // 找一个会失败的种子，真跑一次：属性、CA、日志都不涨。
    let failedSeed = -1
    for (let seed = 0; seed < 200 && failedSeed < 0; seed++) {
      session.seed = seed
      if (preview(game, players[0].id, drill).plan!.quality!.label === '失败') failedSeed = seed
    }
    expect(failedSeed).toBeGreaterThanOrEqual(0)
    session.seed = failedSeed
    const attrsBefore = { ...session.candidate.attrs }
    const result = act(game, players[0].id, drill)
    expect(result.ok).toBe(true)
    expect(session.candidate.attrs).toEqual(attrsBefore)
    expect(session.log.at(-1)?.title).toContain('失败')
    expect(session.log.at(-1)?.gains).toEqual({})
  })

  it('主属性的基础值每次在 ±10% 内浮动，隐藏属性不浮动，同一次行动预览和结算一致', () => {
    const { game, players, sessions } = setup()
    delete sessions[0].facilityLevels
    const request = { kind: 'drill', attr: 'speed' } as const
    const ratios: number[] = []
    for (let seed = 0; seed < 600; seed++) {
      sessions[0].seed = seed
      const plan = preview(game, players[0].id, request).plan!
      // 专项训练：主属性 speed 的基础值是 1 或 2 点（×15），再乘品质。
      const base = plan.gains.speed! / plan.quality!.multiplier
      ratios.push(base / 15)
    }
    const spread = ratios.map(value => value / Math.round(value))
    expect(Math.min(...spread)).toBeGreaterThanOrEqual(0.9 - 1e-9)
    expect(Math.max(...spread)).toBeLessThanOrEqual(1.1 + 1e-9)
    expect(Math.min(...spread)).toBeLessThan(0.95)
    expect(Math.max(...spread)).toBeGreaterThan(1.05)
    // 隐藏属性（配合 teamwork）不浮动：除以品质倍数后每个种子都一样；主属性（传球）则各不相同。
    const hidden = new Set<number>()
    const main = new Set<number>()
    for (let seed = 0; seed < 200; seed++) {
      sessions[0].seed = seed
      const plan = preview(game, players[0].id, combo).plan!
      hidden.add(Math.round(plan.gains.teamwork! / plan.quality!.multiplier * 1e6))
      main.add(Math.round(plan.gains.passing! / plan.quality!.multiplier * 1e3))
    }
    expect(hidden.size).toBe(1)
    expect(main.size).toBeGreaterThan(20)
    // 同一次行动换课程也不重抽：浮动只由培养种子、行动序号和属性决定。
    sessions[0].seed = 77
    const a = preview(game, players[0].id, request).plan!
    expect(preview(game, players[0].id, request).plan).toEqual(a)
  })

  it.each(courses)('preview agrees with execution for $kind and charges the specified fatigue', request => {
    const { game, players, sessions } = setup()
    const [session] = sessions
    const plan = preview(game, players[0].id, request).plan!
    expect(plan.fatigue).toBe(({ drill: 12, combo: 16, match: 25 } as const)[request.kind])
    const before = structuredClone(session.candidate.attrs)
    expect(act(game, players[0].id, request).ok).toBe(true)
    expect(session.fatigue).toBe(plan.fatigue)
    for (const [key, gain] of Object.entries(plan.gains)) {
      const attr = key as keyof typeof before
      expect(session.candidate.attrs[attr] - before[attr]).toBeCloseTo(gain as number)
    }
  })

  it.each(courses)('rejects insufficient stamina atomically for $kind, including preview', request => {
    const { game, players, sessions } = setup()
    const cost = ({ drill: 12, combo: 16, match: 25 } as const)[request.kind]
    sessions[0].fatigue = 101 - cost
    const before = structuredClone(game)
    expect(preview(game, players[0].id, request).error).toBeTruthy()
    expect(act(game, players[0].id, request).ok).toBe(false)
    expect(game).toEqual(before)
    sessions[0].fatigue = 100 - cost
    expect(act(game, players[0].id, request).ok).toBe(true)
    expect(sessions[0].fatigue).toBe(100)
    expect(act(game, players[0].id, { kind: 'rest' }).ok).toBe(true)
    expect(sessions[0].fatigue).toBe(70)
  })

  it('adds the medical and stadium facility bonus once, independently of quality', () => {
    const { game, players, sessions } = setup()
    sessions[0].facilityLevels = { stadium: 5, academy: 5, medical: 15, shop: 5, sponsor: 5, psychology: 5, tactics: 5 }
    for (let seed = 0; seed < 40; seed++) {
      sessions[0].seed = seed
      const withFacility = preview(game, players[0].id, drill).plan!
      delete sessions[0].facilityLevels
      const withoutFacility = preview(game, players[0].id, drill).plan!
      expect(withFacility.quality).toEqual(withoutFacility.quality)
      expect(withFacility.gains.speed! - withoutFacility.gains.speed!).toBeCloseTo(17)
      sessions[0].facilityLevels = { stadium: 5, academy: 5, medical: 15, shop: 5, sponsor: 5, psychology: 5, tactics: 5 }
    }
  })

  it('respects the attribute cap and reports the actual previewed gain', () => {
    const { game, players, sessions } = setup()
    sessions[0].candidate.attrs.speed = 1499
    sessions[0].candidate.ceilings.speed = 1500
    const plan = preview(game, players[0].id, drill).plan!
    expect(plan.gains.speed).toBeCloseTo(1)
    expect(act(game, players[0].id, drill).ok).toBe(true)
    expect(sessions[0].candidate.attrs.speed).toBe(1500)
  })

  it.each(courses)('executes $kind for every teammate with their own preview and tier', request => {
    const { game, players, sessions } = setup(3)
    const ids = players.map(player => player.id)
    const grouped = { ...request, teammateIds: ids.slice(1) }
    const plans = ids.map((id, i) => preview(game, id, { ...request, teammateIds: ids.filter((_, j) => i !== j) }).plan!)
    const before = sessions.map(session => structuredClone(session.candidate.attrs))
    expect(act(game, ids[0], grouped).ok).toBe(true)
    sessions.forEach((session, i) => {
      expect(session.action).toBe(1)
      expect(session.fatigue).toBe(plans[i].fatigue)
      for (const [key, gain] of Object.entries(plans[i].gains)) {
        const attr = key as keyof typeof session.candidate.attrs
        expect(session.candidate.attrs[attr] - before[i][attr]).toBeCloseTo(gain as number)
      }
    })
  })

  it('adds two raw main units per other teammate, scaled for hidden attributes', () => {
    const { game, players } = setup(3)
    const ids = players.map(player => player.id)
    const solo = preview(game, ids[0], combo).plan!
    const group = preview(game, ids[0], { ...combo, teammateIds: ids.slice(1) }).plan!
    expect(group.quality).toEqual(solo.quality)
    expect(group.gains.passing! - solo.gains.passing!).toBeCloseTo(4)
    expect(group.gains.teamwork! - solo.gains.teamwork!).toBeCloseTo(4 * 20 / 1500)
  })

  it.each(['missing', 'self', 'duplicate', 'no-session', 'stale', 'pending', 'stamina', 'off-roster', 'unsupported'])('rejects %s participants without changing anyone', problem => {
    const { game, players, sessions } = setup(3)
    const ids = players.map(player => player.id)
    let request: any = { ...drill, teammateIds: [ids[1]] }
    if (problem === 'missing') request.teammateIds = ['not-a-player']
    if (problem === 'self') request.teammateIds = [ids[0]]
    if (problem === 'duplicate') request.teammateIds = [ids[1], ids[1]]
    if (problem === 'no-session') delete game.training[ids[1]]
    if (problem === 'stale') sessions[1].action = 1
    if (problem === 'pending') { sessions[1].pendingEventId = 'main_intake'; sessions[1].pendingEventAction = 0 }
    if (problem === 'stamina') sessions[1].fatigue = 89
    if (problem === 'off-roster') game.roster = game.roster.filter(player => player.id !== ids[1])
    if (problem === 'unsupported') request = { kind: 'rest', teammateIds: [ids[1]] }
    const before = structuredClone(game)
    expect(preview(game, ids[0], request).error).toBeTruthy()
    expect(act(game, ids[0], request).ok).toBe(false)
    expect(game).toEqual(before)
  })

  it('preserves new and legacy sessions across save/load and continues deterministically', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) })
    const { game, players, sessions } = setup(2)
    delete sessions[1].actionsTotal
    expect(act(game, players[0].id, drill).ok).toBe(true)
    expect(saveGame(game)).toBe(true)
    const loaded = loadGame()!
    expect(loaded.training[players[0].id].actionsTotal).toBe(30)
    expect(loaded.training[players[1].id].actionsTotal).toBeUndefined()
    expect(preview(loaded, players[0].id, combo)).toEqual(preview(game, players[0].id, combo))
    expect(act(loaded, players[0].id, combo).ok).toBe(true)
    expect(act(game, players[0].id, combo).ok).toBe(true)
    expect(loaded.training[players[0].id]).toEqual(game.training[players[0].id])
  })
})
