import { beforeEach, describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { pickSupportPartners, startTraining, startTrainingWithSupport, trainingAction, previewTraining } from '../src/game/actions.ts'
import { trainingOptions } from '../src/game/training-calendar.ts'
import { EVENTS } from '../src/game/data/events.ts'
import type { TrainingSession } from '../src/game/types.ts'

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

const sum = (gains: Record<string, number> | undefined) => Object.values(gains ?? {}).reduce((a, b) => a + (b ?? 0), 0)
const activity = (id: string) => ({ kind: 'activity', activityId: id } as any)

describe('系统自动陪练', () => {
  beforeEach(stubLocalStorage)

  it('开始培养时自动挑 6 名陪练（含门将），只开主角一个 session', () => {
    const game = createInitialGame(321)
    const main = game.roster.find((player) => player.positions.GK === 0)!
    const energy = game.roster.map((player) => player.energy ?? 100)
    expect(startTrainingWithSupport(game, main.id).ok).toBe(true)
    const session = game.training[main.id]
    expect(session.partnerIds).toHaveLength(6)
    expect(new Set(session.partnerIds).size).toBe(6)
    expect(session.partnerIds).not.toContain(main.id)
    // 外场球员必带一名其他门将
    expect(session.partnerIds!.some((id) => game.roster.find((p) => p.id === id)!.positions.GK > 0)).toBe(true)
    // 陪练不消耗精力、不生成 session
    expect(Object.keys(game.training)).toEqual([main.id])
    // 只有主角扣 30 精力，陪练一个都不扣。
    session.partnerIds!.forEach((id) => {
      const before = energy[game.roster.findIndex((player) => player.id === id)]
      expect(game.roster.find((player) => player.id === id)!.energy ?? 100).toBe(before)
    })
    expect(game.roster.find((player) => player.id === main.id)!.energy).toBe((energy[game.roster.findIndex((player) => player.id === main.id)] ?? 100) - 30)
  })

  it('练门将时 6 名陪练全是外场，且覆盖其他位置', () => {
    const game = createInitialGame(322)
    const gk = game.roster.find((player) => player.positions.GK > 0)!
    expect(startTrainingWithSupport(game, gk.id).ok).toBe(true)
    const partners = game.training[gk.id].partnerIds!.map((id) => game.roster.find((p) => p.id === id)!)
    expect(partners).toHaveLength(6)
    expect(partners.every((player) => player.positions.GK === 0)).toBe(true)
    const positions = ['CB', 'W', 'CM', 'ST'] as const
    const covered = new Set(partners.map((player) => [...positions].sort((a, b) => player.positions[b] - player.positions[a])[0]))
    expect(covered.size).toBeGreaterThanOrEqual(3)
  })

  it('陪练整轮固定；同一颗种子挑出来的人一样，换种子会换人', () => {
    const game = createInitialGame(323)
    const main = game.roster.find((player) => player.positions.GK === 0)!
    const first = pickSupportPartners(game, main.id, 11)
    expect(pickSupportPartners(game, main.id, 11)).toEqual(first)
    const variants = new Set<string>()
    for (let seed = 1; seed <= 40; seed++) variants.add((pickSupportPartners(game, main.id, seed) ?? []).join(','))
    expect(variants.size).toBeGreaterThan(1)
    expect(startTrainingWithSupport(game, main.id, 11).ok).toBe(true)
    const fixed = [...game.training[main.id].partnerIds!]
    for (const id of fixed) expect(game.training[id]).toBeUndefined()
    expect(game.training[main.id].partnerIds).toEqual(fixed)
  })

  it('陪练加成：比单练每次多约 +12 点，主角拿成长、陪练不变', () => {
    const game = createInitialGame(777)
    const main = game.roster.find((player) => player.positions.GK === 0)!
    expect(startTrainingWithSupport(game, main.id).ok).toBe(true)
    const session = game.training[main.id]
    suppress(session)
    session.action = 1
    const offered = trainingOptions(session).find((item) => (item.cost ?? 0) > 0 && item.group)!
    const course = activity(offered.id)
    const withSupport = previewTraining(game, main.id, course).plan!
    const partners = session.partnerIds!
    const partnerAttrs = partners.map((id) => ({ ...game.roster.find((p) => p.id === id)!.attrs }))
    session.partnerIds = []
    const solo = previewTraining(game, main.id, course).plan!
    expect(sum(withSupport.gains) - sum(solo.gains)).toBeGreaterThan(10)
    session.partnerIds = partners
    const result = trainingAction(game, main.id, course)
    expect(result.ok, result.error).toBe(true)
    expect(sum(session.log.at(-1)?.gains as Record<string, number>)).toBeGreaterThan(0)
    partners.forEach((id, index) => {
      expect(game.training[id]).toBeUndefined()
      expect(game.roster.find((p) => p.id === id)!.attrs).toEqual(partnerAttrs[index])
    })
  })

  it('交流赛用主角 + 6 名陪练的阵容；阵容不足或没有第二名门将时报错', () => {
    const game = createInitialGame(99)
    const main = game.roster.find((player) => player.positions.GK === 0)!
    expect(startTrainingWithSupport(game, main.id).ok).toBe(true)
    suppress(game.training[main.id])
    const result = trainingAction(game, main.id, activity('exchange'))
    expect(result.ok, result.error).toBe(true)
    expect(result.exchange).toBeDefined()
    expect(game.training[main.id].exchangeMatches?.[0]).toMatchObject({ week: result.exchange!.week, homeScore: result.exchange!.homeScore })

    const small = createInitialGame(100)
    small.roster = small.roster.slice(0, 6)
    expect(startTrainingWithSupport(small, small.roster[0].id)).toMatchObject({ ok: false, error: expect.stringContaining('陪练') })

    const noKeeper = createInitialGame(101)
    noKeeper.roster = noKeeper.roster.filter((player) => player.positions.GK === 0)
    expect(startTrainingWithSupport(noKeeper, noKeeper.roster[0].id)).toMatchObject({ ok: false, error: expect.stringContaining('门将') })
  })
})
