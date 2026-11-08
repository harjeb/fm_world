import { beforeEach, describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { startTrainingSquad, trainingAction, previewTraining } from '../src/game/actions.ts'
import { EVENTS } from '../src/game/data/events.ts'
import { trainingOptions } from '../src/game/training-calendar.ts'
import type { GameState, TrainingSession } from '../src/game/types.ts'

function stubLocalStorage(): void {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k), clear: () => store.clear() },
  })
}

function suppress(session: TrainingSession): void {
  session.flags = EVENTS.map((event) => event.id)
  session.lastEventAction = Object.fromEntries(EVENTS.map((event) => [event.id, 1000]))
  session.eventCounts = Object.fromEntries(EVENTS.map((event) => [event.id, 1000]))
}

function setup(seed = 321) {
  const game = createInitialGame(seed)
  const gk = game.roster.find((player) => player.positions.GK > 0)!
  const outfield = game.roster.filter((player) => player.positions.GK === 0)
  const main = outfield[0]
  const partners = [gk, ...outfield.slice(1, 6)].map((player) => player.id)
  return { game, gk, main, partners }
}

const activity = (id: string) => ({ kind: 'activity', activityId: id } as any)
const sum = (gains: Record<string, number> | undefined) => Object.values(gains ?? {}).reduce((a, b) => a + (b ?? 0), 0)

describe('陪练队友', () => {
  beforeEach(stubLocalStorage)

  it('只开主角一个人的培养，6 名陪练不消耗精力、不生成 session', () => {
    const { game, main, partners } = setup()
    const energy = partners.map((id) => game.roster.find((p) => p.id === id)!.energy ?? 100)
    expect(startTrainingSquad(game, main.id, partners).ok).toBe(true)
    const session = game.training[main.id]
    expect(session.partnerIds).toEqual(partners)
    expect(Object.keys(game.training)).toEqual([main.id])
    partners.forEach((id, index) => {
      expect(game.training[id]).toBeUndefined()
      expect(game.roster.find((p) => p.id === id)!.energy ?? 100).toBe(energy[index])
    })
  })

  it('陪练只加成长：6 名陪练比单练每次多约 +12 点', () => {
    const { game, main, partners } = setup(777)
    expect(startTrainingSquad(game, main.id, partners).ok).toBe(true)
    const session = game.training[main.id]
    suppress(session)
    session.action = 1
    const offered = trainingOptions(session).find((item) => (item.cost ?? 0) > 0 && item.group)!
    const course = { kind: 'activity', activityId: offered.id } as any
    const withSquad = previewTraining(game, main.id, course).plan!
    session.partnerIds = []
    const solo = previewTraining(game, main.id, course).plan!
    expect(sum(withSquad.gains) - sum(solo.gains)).toBeGreaterThan(10)
    session.partnerIds = partners
    const again = previewTraining(game, main.id, course).plan!
    expect(sum(again.gains)).toBeCloseTo(sum(withSquad.gains), 6)
  })

  it('陪练不涨属性、不产生球员卡，主角正常拿到成长', () => {
    const { game, main, partners } = setup(4242)
    expect(startTrainingSquad(game, main.id, partners).ok).toBe(true)
    const session = game.training[main.id]
    suppress(session)
    session.action = 1
    const partnerAttrs = partners.map((id) => ({ ...game.roster.find((p) => p.id === id)!.attrs }))
    const offered = trainingOptions(session).find((item) => (item.cost ?? 0) > 0 && item.group)!
    const course = { kind: 'activity', activityId: offered.id } as any
    expect(trainingAction(game, main.id, course).ok).toBe(true)
    expect(sum(session.log.at(-1)?.gains as Record<string, number>)).toBeGreaterThan(0)
    partners.forEach((id, index) => {
      expect(game.training[id]).toBeUndefined()
      expect(game.roster.find((p) => p.id === id)!.attrs).toEqual(partnerAttrs[index])
    })
  })

  it('交流赛用主角 + 6 名陪练的阵容', () => {
    const { game, main, partners } = setup(99)
    expect(startTrainingSquad(game, main.id, partners).ok).toBe(true)
    suppress(game.training[main.id])
    const result = trainingAction(game, main.id, activity('exchange'))
    expect(result.ok, result.error).toBe(true)
    expect(result.exchange).toBeDefined()
    expect(game.training[main.id].exchangeMatches?.[0]).toMatchObject({ week: result.exchange!.week, homeScore: result.exchange!.homeScore })
    // 陪练没有自己的培养，不会产生交流赛记录
    for (const id of partners) expect(game.training[id]).toBeUndefined()
  })

  it('没有门将、超过 6 人或重复队友会被拒绝', () => {
    const { game, main } = setup(555)
    const outfield = game.roster.filter((p) => p.positions.GK === 0 && p.id !== main.id).slice(0, 6).map((p) => p.id)
    expect(startTrainingSquad(game, main.id, outfield)).toMatchObject({ ok: false, error: expect.stringContaining('门将') })
    const withGk = [game.roster.find((p) => p.positions.GK > 0)!.id, ...outfield.slice(0, 5)].slice(0, 6)
    expect(startTrainingSquad(game, main.id, [...withGk, withGk[0]])).toMatchObject({ ok: false, error: expect.stringContaining('重复') })
    const seven = [game.roster.find((p) => p.positions.GK > 0)!.id, ...outfield].slice(0, 7)
    expect(startTrainingSquad(game, main.id, seven)).toMatchObject({ ok: false, error: expect.stringContaining('最多') })
  })
})
