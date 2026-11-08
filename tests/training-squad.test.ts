import { beforeEach, describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { pickSupportPartners, startTraining, startTrainingWithSupport, trainingAction, previewTraining } from '../src/game/actions.ts'
import { partnerAssignment, trainingOptions } from '../src/game/training-calendar.ts'
import { REST_PARTNER_RECOVERY } from '../src/game/training.ts'
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

  it('6 名陪练每个时段随机分到各个选项，合计恰好 6 人，刷新不重抽', () => {
    const game = createInitialGame(777)
    const main = game.roster.find((player) => player.positions.GK === 0)!
    expect(startTrainingWithSupport(game, main.id).ok).toBe(true)
    const session = game.training[main.id]
    const seen = new Set<string>()
    let restHadPartners = false
    let someOptionEmpty = false
    for (const action of [1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13]) {
      session.action = action
      const options = trainingOptions(session)
      const assignment = partnerAssignment(session)
      expect(Object.keys(assignment).sort()).toEqual(options.map((item) => item.id).sort())
      const placed = Object.values(assignment).flat()
      expect(placed).toHaveLength(6)
      expect([...placed].sort()).toEqual([...session.partnerIds!].sort())
      expect(partnerAssignment(session)).toEqual(assignment)
      seen.add(JSON.stringify(assignment))
      if (assignment.rest.length > 0) restHadPartners = true
      if (Object.values(assignment).some((ids) => ids.length === 0)) someOptionEmpty = true
    }
    expect(seen.size).toBeGreaterThan(5)
    expect(restHadPartners).toBe(true)
    expect(someOptionEmpty).toBe(true)
  })

  it('周一交流赛、周五队内比赛只有一个选项，6 人全在上面', () => {
    const game = createInitialGame(778)
    const main = game.roster.find((player) => player.positions.GK === 0)!
    expect(startTrainingWithSupport(game, main.id).ok).toBe(true)
    const session = game.training[main.id]
    session.action = 0
    expect(partnerAssignment(session).exchange).toHaveLength(6)
    session.action = 8
    expect(partnerAssignment(session).match).toHaveLength(6)
  })

  it('陪练加成只来自站在所选项目上的人：有人就多长，没人就和单练一样', () => {
    const game = createInitialGame(777)
    const main = game.roster.find((player) => player.positions.GK === 0)!
    expect(startTrainingWithSupport(game, main.id).ok).toBe(true)
    const session = game.training[main.id]
    suppress(session)
    let withPartner = 0
    let withoutPartner = 0
    for (const action of [2, 3, 4, 5, 6, 7, 10, 11, 12, 13]) {
      session.action = action
      const assignment = partnerAssignment(session)
      for (const offered of trainingOptions(session).filter((item) => item.cost && item.gains)) {
        const course = activity(offered.id)
        const partners = session.partnerIds!
        const supported = previewTraining(game, main.id, course).plan!
        session.partnerIds = []
        const solo = previewTraining(game, main.id, course).plan!
        session.partnerIds = partners
        if (assignment[offered.id].length > 0) {
          expect(sum(supported.gains)).toBeGreaterThan(sum(solo.gains))
          withPartner++
        } else {
          expect(supported.gains).toEqual(solo.gains)
          withoutPartner++
        }
      }
    }
    expect(withPartner).toBeGreaterThan(0)
    expect(withoutPartner).toBeGreaterThan(0)
  })

  it('站在恢复上的陪练每人多恢复训练体力；执行后陪练自己不变', () => {
    const game = createInitialGame(779)
    const main = game.roster.find((player) => player.positions.GK === 0)!
    expect(startTrainingWithSupport(game, main.id).ok).toBe(true)
    const session = game.training[main.id]
    suppress(session)
    session.fatigue = 80
    let action = 2
    while (action < 14 && partnerAssignment({ ...session, action }).rest.length === 0) action++
    session.action = action
    const onRest = partnerAssignment(session).rest
    expect(onRest.length).toBeGreaterThan(0)
    const plan = previewTraining(game, main.id, activity('rest')).plan!
    expect(plan.fatigue).toBe(-(30 + REST_PARTNER_RECOVERY * onRest.length))
    const partnerAttrs = session.partnerIds!.map((id) => ({ ...game.roster.find((p) => p.id === id)!.attrs }))
    expect(trainingAction(game, main.id, activity('rest')).ok).toBe(true)
    expect(game.training[main.id].fatigue).toBe(Math.max(0, 80 - 30 - REST_PARTNER_RECOVERY * onRest.length))
    session.partnerIds!.forEach((id, index) => {
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
