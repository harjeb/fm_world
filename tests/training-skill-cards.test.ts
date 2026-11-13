import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialGame, loadGame } from '../src/game/state.ts'
import { autoTrainingStep, setTrainingBookLoadout, startTraining, startTrainingWithSupport, trainingAction, trainingBookLoadout, trainingEventChoice } from '../src/game/actions.ts'
import { createTrainingSession, performTrainingAction, resolveTrainingEvent } from '../src/game/training.ts'
import { drawTrainingSkills, eventForSession, MATCH_BOOK_EVENT_ID, trainingSkillChoiceId } from '../src/game/legend-learning.ts'
import { derivedRng } from '../src/game/rng.ts'
import { EVENTS } from '../src/game/data/events.ts'
import { canLearnSkill, skillCategory } from '../src/game/data/skills.ts'
import { agentView, applyAgentAction } from '../server/agent.ts'
import type { LegendBook, Player, TrainingSkillChoice } from '../src/game/types.ts'

const books: LegendBook[] = [
  { id: 'lg_drill_master', tier: 'rainbow' },
  { id: 'lg_vision_master', tier: 'rainbow' },
  { id: 'lg_marathon', tier: 'rainbow' },
  { id: 'lg_low_drive', tier: 'gold' },
]
const keys = books.map((book) => `${book.id}:${book.tier}`)

function setup(seed = 201) {
  const game = createInitialGame(seed)
  const player = game.roster.find((item) => item.positions.GK === 0)!
  player.skills = []
  player.baseSkills = []
  player.skillTiers = {}
  player.baseSkillTiers = {}
  player.energy = 100
  game.legendBooks = structuredClone(books)
  return { game, player }
}

function noOrdinaryEvents(session: ReturnType<typeof createTrainingSession>) {
  session.flags = EVENTS.map((event) => event.id)
  session.lastEventAction = Object.fromEntries(EVENTS.map((event) => [event.id, 1000]))
  session.eventCounts = Object.fromEntries(EVENTS.map((event) => [event.id, 1000]))
}

function chooseFirst(game: ReturnType<typeof createInitialGame>, playerId: string) {
  const session = game.training[playerId]
  const event = eventForSession(session, session.pendingEventId!)!
  const option = event.options[0]
  const skill = option.trainingSkill?.id
  const replace = skill && !canLearnSkill(session.candidate.skills, skill) ? session.candidate.skills.find((id) => skillCategory(id) === skillCategory(skill)) : undefined
  return trainingEventChoice(game, playerId, option.id, replace)
}

afterEach(() => vi.unstubAllGlobals())

describe('交流赛技能卡配置与学习', () => {
  it('配置按球员保存、读档恢复，手动和自动培养都使用保存的书', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) })
    const { game, player } = setup()
    const other = game.roster.find((item) => item.id !== player.id && item.positions.GK === 0)!
    expect(setTrainingBookLoadout(game, player.id, keys).ok).toBe(true)
    expect(setTrainingBookLoadout(game, other.id, [keys[0]]).ok).toBe(true)
    const restored = loadGame()!
    expect(trainingBookLoadout(restored, player.id)).toEqual(keys)
    expect(trainingBookLoadout(restored, other.id)).toEqual([keys[0]])
    expect(startTrainingWithSupport(restored, player.id, 81).ok).toBe(true)
    expect(restored.training[player.id].books).toEqual(books)
    expect(autoTrainingStep(restored, other.id).ok).toBe(true)
    expect(restored.training[other.id].books).toEqual([books[0]])
    expect(setTrainingBookLoadout(restored, player.id, []).ok).toBe(true)
    expect(restored.training[player.id].books).toEqual(books)
  })

  it('非法配置不扣精力、不删除上一轮成果；校验原始技能，满槽可配置并在学习成功时替换', () => {
    const { game, player } = setup(202)
    const previous = createTrainingSession(player, 10)
    previous.completed = true
    game.training[player.id] = previous
    game.candidates[player.id] = structuredClone(player)
    const before = structuredClone(game)
    for (const invalid of [['missing:gold'], [...keys, 'missing:gold'], [keys[0], keys[0]], [keys[0], 'lg_drill_master:gold']]) {
      expect(startTraining(game, player.id, 1, invalid).ok).toBe(false)
      expect(game).toEqual(before)
    }
    game.legendBooks!.push({ id: 'lg_drill_master', tier: 'gold' })
    expect(setTrainingBookLoadout(game, player.id, [keys[0], 'lg_drill_master:gold']).error).toContain('同一个技能')
    player.equippedCardId = 'some-card'
    player.version = 1
    player.skills = ['lg_drill_master']
    player.baseSkills = ['through_ball', 'safe_pass', 'one_touch', 'box_hunter']
    expect(setTrainingBookLoadout(game, player.id, [keys[0]]).ok).toBe(true)
    expect(startTraining(game, player.id, 1).ok).toBe(true)
    expect(game.training[player.id].candidate.skills).not.toContain('lg_drill_master')
  })

  it('三类按 50:30:20 权重逐个抽取，不强制每类出现；同技能跨来源只出现一次', () => {
    const { game, player } = setup(203)
    const session = createTrainingSession(player, 1, undefined, 1, [books[0]])
    const peer = structuredClone(game.roster.find((p) => p.id !== player.id && p.positions.GK === 0)!)
    peer.skills = ['lg_leader', 'lg_drill_master']
    peer.skillTiers = { lg_leader: 'rainbow', lg_drill_master: 'gold' }
    const counts = { book: 0, teammate: 0, basic: 0 }
    let repeatedSource = false
    for (let seed = 1; seed <= 3500; seed++) {
      session.seed = seed
      const choices = drawTrainingSkills(session, [peer])
      expect(choices).toHaveLength(3)
      expect(new Set(choices.map((choice) => choice.id)).size).toBe(3)
      counts[choices[0].source]++
      if (new Set(choices.map((choice) => choice.source)).size < 3) repeatedSource = true
    }
    expect(counts.book / 3500).toBeGreaterThan(0.47)
    expect(counts.book / 3500).toBeLessThan(0.53)
    expect(counts.teammate / 3500).toBeGreaterThan(0.27)
    expect(counts.teammate / 3500).toBeLessThan(0.33)
    expect(counts.basic / 3500).toBeGreaterThan(0.17)
    expect(counts.basic / 3500).toBeLessThan(0.23)
    expect(repeatedSource).toBe(true)
    expect(drawTrainingSkills(session, [peer])).toEqual(drawTrainingSkills(structuredClone(session), [structuredClone(peer)]))
  })

  it('真实交流赛随机抽取最多 5 名实际陪练；读档不重抽，不丢主线；队内赛不触发', () => {
    const { game, player } = setup(204)
    expect(startTrainingWithSupport(game, player.id, 123, keys).ok).toBe(true)
    const session = game.training[player.id]
    Object.assign(session.candidate.attrs, { teamwork: 20, vision: 20, endurance: 20, composure: 20, shooting: 1500 })
    const result = trainingAction(game, player.id, { kind: 'activity', activityId: 'exchange' })
    expect(result.ok, result.error).toBe(true)
    expect(result.exchange).toBeDefined()
    expect(result.event?.id).toBe(MATCH_BOOK_EVENT_ID)
    expect(result.event?.options).toHaveLength(3)
    expect(new Set(result.event?.options.map((option) => option.trainingSkill?.id)).size).toBe(3)
    expect(session.skillTeacherIds).toHaveLength(5)
    expect(session.skillTeacherIds!.every((id) => session.partnerIds!.includes(id))).toBe(true)
    expect(session.queuedEventId).toBe('main_intake')
    const reloaded = JSON.parse(JSON.stringify(game)) as typeof game
    const restored = reloaded.training[player.id]
    expect(eventForSession(restored, restored.pendingEventId!)?.options).toEqual(result.event?.options)
    const beforeInvalid = structuredClone(restored)
    expect(trainingEventChoice(reloaded, player.id, 'not-an-option').ok).toBe(false)
    expect(restored).toEqual(beforeInvalid)
    const picked = result.event!.options[0]
    const learned = trainingEventChoice(reloaded, player.id, picked.id)
    expect(learned.ok).toBe(true)
    expect(Object.keys(restored.trainedSinceEvent).length).toBeGreaterThan(0)
    expect(restored.pendingEventId).toBe('main_intake')
    expect(trainingEventChoice(reloaded, player.id, 'passing').ok).toBe(true)
    noOrdinaryEvents(restored)
    restored.action = 8
    expect(trainingAction(reloaded, player.id, { kind: 'activity', activityId: 'match' }).event?.id).not.toBe(MATCH_BOOK_EVENT_ID)
    expect(restored.pendingEventId).toBeNull()
    restored.action = 14
    const next = trainingAction(reloaded, player.id, { kind: 'activity', activityId: 'exchange' })
    expect(next.event?.id).toBe(MATCH_BOOK_EVENT_ID)
    if (learned.success) expect(next.event?.options.map((option) => option.trainingSkill?.id)).not.toContain(picked.trainingSkill!.id)
    expect(restored.skillTeacherIds).toEqual(session.skillTeacherIds)
    expect(restored.skillTeacherIds!.every((id) => restored.partnerIds!.includes(id))).toBe(true)
    expect(reloaded.legendBooks).toEqual(books)
  })

  it('来源为队友时只读当前共同培养的最多五人，不读其他队友或对手', () => {
    const { game, player } = setup(205)
    expect(startTrainingWithSupport(game, player.id, 5, []).ok).toBe(true)
    const session = game.training[player.id]
    for (const other of game.roster) {
      other.skills = ['lg_leader']
      other.skillTiers = { lg_leader: 'rainbow' }
    }
    const result = trainingAction(game, player.id, { kind: 'activity', activityId: 'exchange' })
    expect(result.ok).toBe(true)
    expect(session.skillTeacherIds).toHaveLength(5)
    expect(session.skillTeacherIds!.every((id) => session.partnerIds!.includes(id))).toBe(true)
    const allowed = game.roster.filter((p) => session.skillTeacherIds!.includes(p.id))
    let sawPeer = false
    for (let seed = 1; seed < 50; seed++) {
      const copy = structuredClone(session)
      copy.seed = seed
      for (const choice of drawTrainingSkills(copy, allowed)) if (choice.source === 'teammate') {
        sawPeer = true
        expect(session.skillTeacherIds).toContain(choice.mentor.id)
        expect(choice.id).toBe('lg_leader')
      }
    }
    expect(sawPeer).toBe(true)
  })

  it('无技能书时仍触发基础技能；失败的书可再次出现，已掌握技能不会出现', () => {
    const { player } = setup(206)
    player.attrs.teamwork = 0
    const session = createTrainingSession(player, 1, undefined, 1, [])
    noOrdinaryEvents(session)
    const first = performTrainingAction(session, { kind: 'activity', activityId: 'exchange' })
    expect(first.event?.options).toHaveLength(3)
    expect(first.event?.options.every((option) => option.trainingSkill?.source === 'basic')).toBe(true)
    const basic = first.event!.options[0]
    expect(resolveTrainingEvent(session, basic.id).success).toBe(true)
    expect(session.candidate.skills).toContain(basic.trainingSkill!.id)
    session.books = [books[0]]
    session.action = 15
    const choice: TrainingSkillChoice = { source: 'book', ...books[0] }
    session.pendingSkillChoices = [choice]
    session.pendingEventId = MATCH_BOOK_EVENT_ID
    while (derivedRng(session.seed, 'event-outcome', session.playerId, MATCH_BOOK_EVENT_ID, keys[0], session.action).float() < 0.02) session.seed++
    expect(resolveTrainingEvent(session, keys[0]).success).toBe(false)
    expect(session.books).toEqual([books[0]])
    let canRetry = false
    for (let seed = 0; seed < 100; seed++) {
      session.seed = seed
      const options = drawTrainingSkills(session)
      expect(options.map((item) => item.id)).not.toContain(basic.trainingSkill!.id)
      if (options.some((item) => item.id === books[0].id)) canRetry = true
    }
    expect(canRetry).toBe(true)
  })

  it('满槽必须选择同类技能；成功替换，失败原技能不变', () => {
    const { player } = setup(207)
    player.attrs.teamwork = 20
    const session = createTrainingSession(player, 1, undefined, 1, [books[0]])
    session.candidate.skills = ['through_ball', 'safe_pass', 'one_touch', 'box_hunter', 'injury_prevention']
    const choice: TrainingSkillChoice = { source: 'book', ...books[0] }
    session.pendingSkillChoices = [choice]
    session.pendingEventId = MATCH_BOOK_EVENT_ID
    expect(resolveTrainingEvent(session, keys[0]).error).toContain('技能槽已满')
    expect(resolveTrainingEvent(session, keys[0], 'injury_prevention').ok).toBe(false)
    expect(resolveTrainingEvent(session, keys[0], 'safe_pass').success).toBe(true)
    expect(session.candidate.skills).not.toContain('safe_pass')
    expect(session.candidate.skills).toContain('lg_drill_master')
    expect(session.candidate.skills).toContain('injury_prevention')
    const failed = createTrainingSession(player, 1, undefined, 1, [books[0]])
    failed.candidate.attrs.teamwork = 0
    failed.candidate.skills = ['through_ball', 'safe_pass', 'one_touch', 'box_hunter']
    failed.pendingSkillChoices = [choice]
    failed.pendingEventId = MATCH_BOOK_EVENT_ID
    while (derivedRng(failed.seed, 'event-outcome', failed.playerId, MATCH_BOOK_EVENT_ID, keys[0], failed.action).float() < 0.02) failed.seed++
    expect(resolveTrainingEvent(failed, keys[0], 'safe_pass').success).toBe(false)
    expect(failed.candidate.skills).toContain('safe_pass')
    expect(failed.candidate.skills).not.toContain('lg_drill_master')
  })

  it('队友传授巅峰技能时同样获得属性及上限奖励', () => {
    const { game, player } = setup(211)
    const mentor = game.roster.find((item) => item.id !== player.id && item.positions.GK === 0)!
    mentor.skillTiers = { lg_peak_striker: 'rainbow' }
    const session = createTrainingSession(player, 1)
    session.candidate.attrs.shooting = 900
    session.candidate.attrs.dribbling = 900
    session.candidate.ceilings.shooting = 1200
    session.candidate.ceilings.dribbling = 1200
    const choice: TrainingSkillChoice = { source: 'teammate', id: 'lg_peak_striker', mentor: { id: mentor.id, name: mentor.name, positions: mentor.positions, skillTiers: mentor.skillTiers } }
    session.pendingSkillChoices = [choice]
    session.pendingEventId = MATCH_BOOK_EVENT_ID
    const optionId = trainingSkillChoiceId(choice)
    while (derivedRng(session.seed, 'event-outcome', session.playerId, MATCH_BOOK_EVENT_ID, optionId, session.action).float() >= 0.5) session.seed++
    expect(resolveTrainingEvent(session, optionId).success).toBe(true)
    expect(session.candidate.skills).toContain('lg_peak_striker')
    expect(session.candidate.attrs.shooting).toBe(1000)
    expect(session.candidate.attrs.dribbling).toBe(1000)
    expect(session.candidate.ceilings.shooting).toBe(1250)
    expect(session.candidate.ceilings.dribbling).toBe(1250)
  })

  it('旧版已弹出的书选项仍可读档处理', () => {
    const { player } = setup(212)
    const session = createTrainingSession(player, 1, undefined, 1, [books[0]])
    session.candidate.attrs.teamwork = 20
    session.pendingBookChoices = [books[0]]
    session.pendingEventId = MATCH_BOOK_EVENT_ID
    expect(eventForSession(session, session.pendingEventId)?.options[0].book).toEqual(books[0])
    expect(resolveTrainingEvent(session, keys[0]).success).toBe(true)
    expect(session.candidate.skills).toContain(books[0].id)
  })

  it('最后时段的交流赛先完成技能选择和毕业主线，再生成球员卡', () => {
    const { game, player } = setup(208)
    expect(startTraining(game, player.id, 2, [keys[0]]).ok).toBe(true)
    const session = game.training[player.id]
    session.actionsTotal = 29
    session.action = 28
    session.candidate.attrs.teamwork = 20
    const result = trainingAction(game, player.id, { kind: 'activity', activityId: 'exchange' })
    expect(result.event?.id).toBe(MATCH_BOOK_EVENT_ID)
    expect(session.queuedEventId).toBe('main_graduation')
    expect(chooseFirst(game, player.id).completed).toBe(false)
    expect(game.cards).toHaveLength(0)
    expect(session.pendingEventId).toBe('main_graduation')
    expect(trainingEventChoice(game, player.id, 'review').completed).toBe(true)
    expect(game.cards).toHaveLength(1)
  })

  it('组队交流赛各自处理技能，队友快照取同时培养中的成果', () => {
    const { game, player } = setup(209)
    const other = game.roster.find((item) => item.positions.GK === 0 && item.id !== player.id)!
    other.skills = []
    other.baseSkills = []
    other.energy = 100
    expect(startTraining(game, player.id, 1, [keys[0]]).ok).toBe(true)
    expect(startTraining(game, other.id, 2, [keys[1]]).ok).toBe(true)
    game.training[other.id].candidate.skills = ['lg_leader']
    game.training[other.id].candidate.skillTiers = { lg_leader: 'rainbow' }
    const result = trainingAction(game, player.id, { kind: 'activity', activityId: 'exchange', teammateIds: [other.id] })
    expect(result.ok, result.error).toBe(true)
    expect(game.training[player.id].skillTeacherIds).toEqual([other.id])
    expect(game.training[other.id].skillTeacherIds).toEqual([player.id])
    expect(game.training[player.id].pendingSkillChoices).toBeDefined()
    expect(game.training[other.id].pendingSkillChoices).toBeDefined()
    expect(chooseFirst(game, player.id).ok).toBe(true)
    expect(game.training[other.id].pendingEventId).toBe(MATCH_BOOK_EVENT_ID)
    expect(chooseFirst(game, other.id).ok).toBe(true)
  })

  it('Agent 能看到来源、成功率并自动处理；旧的独立传承项目拒绝使用', () => {
    const { game, player } = setup(210)
    expect(applyAgentAction(game, { action: 'set_training_books', playerId: player.id, bookKeys: [keys[0]] }).ok).toBe(true)
    expect(applyAgentAction(game, { action: 'start_training', playerId: player.id }).ok).toBe(true)
    const old = applyAgentAction(game, { action: 'training_action', playerId: player.id, request: { kind: 'activity', activityId: 'inherit' } })
    expect(old.ok).toBe(false)
    game.training[player.id].candidate.attrs.teamwork = 20
    expect(applyAgentAction(game, { action: 'training_action', playerId: player.id, request: { kind: 'activity', activityId: 'exchange' } }).ok).toBe(true)
    const view = agentView(game)
    expect(view.legendBooks[0].key).toBe(keys[0])
    const session = view.trainingSessions.find((item) => item.playerId === player.id)!
    expect(session.pendingEvent?.options).toHaveLength(3)
    expect(session.pendingEvent?.options.every((option) => ['book', 'teammate', 'basic'].includes(option.source!))).toBe(true)
    const step = autoTrainingStep(game, player.id)
    expect(step.ok, step.error).toBe(true)
    expect(step.kind).toBe('event')
    expect(agentView(game).trainingSessions.find((item) => item.playerId === player.id)!.pendingEvent?.id).toBe('main_intake')
  })
})
