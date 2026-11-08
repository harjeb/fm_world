import { beforeEach, describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { startTraining, startTrainingSquad, trainingAction } from '../src/game/actions.ts'
import { trainingOptions } from '../src/game/training-calendar.ts'
import { EVENTS } from '../src/game/data/events.ts'
import { TRAINING_ENERGY_COST } from '../src/game/training.ts'
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
  const outfield = game.roster.filter((player) => player.positions.GK === 0).slice(0, 6)
  const main = outfield[0]
  const partners = [gk, ...outfield.slice(1)].map((player) => player.id)
  return { game, gk, main, partners }
}

const activity = (id: string) => ({ kind: 'activity', activityId: id } as any)

describe('训练小队', () => {
  beforeEach(stubLocalStorage)

  it('开局选定 6 名队友（含门将），7 人同日程；没有门将/超过 6 人会被拒绝', () => {
    const { game, gk, main, partners } = setup()
    expect(startTrainingSquad(game, main.id, partners).ok).toBe(true)
    const ids = [main.id, ...partners]
    for (const id of ids) {
      const session = game.training[id]
      expect(session.partnerIds).toHaveLength(6)
      expect(session.partnerIds).not.toContain(id)
      expect(session.scheduleSeed).toBe(game.training[main.id].scheduleSeed)
      expect(session.action).toBe(0)
    }
    expect(game.training[gk.id].partnerIds).toContain(main.id)

    const other = createInitialGame(322)
    const noGkMain = other.roster.find((player) => player.positions.GK === 0)!
    const noGk = other.roster.filter((player) => player.positions.GK === 0 && player.id !== noGkMain.id).slice(0, 6)
    expect(startTrainingSquad(other, noGkMain.id, noGk.map((player) => player.id))).toMatchObject({ ok: false, error: expect.stringContaining('门将') })

    const third = createInitialGame(323)
    const anyMain = third.roster.find((player) => player.positions.GK === 0)!
    const tooMany = third.roster.filter((player) => player.id !== anyMain.id).slice(0, 7)
    expect(startTrainingSquad(third, anyMain.id, tooMany.map((player) => player.id))).toMatchObject({ ok: false, error: expect.stringContaining('最多') })
  })

  it('组队项目全员参加，交流赛 7 人共享结果，队友不会攒下待处理事件', () => {
    const { game, main, partners } = setup()
    expect(startTrainingSquad(game, main.id, partners).ok).toBe(true)
    const ids = [main.id, ...partners]
    for (const id of ids) suppress(game.training[id])
    // 第 1 个时段是周一上午强制交流赛。
    const result = trainingAction(game, main.id, activity('exchange'))
    expect(result.ok).toBe(true)
    expect(result.exchange).toBeDefined()
    for (const id of ids) {
      expect(game.training[id].action).toBe(1)
      expect(game.training[id].pendingEventId ?? null).toBeNull()
      expect(game.training[id].exchangeMatches?.[0]).toMatchObject({ week: result.exchange!.week, homeScore: result.exchange!.homeScore, awayScore: result.exchange!.awayScore })
    }
  })

  it('个人项目/休息时其他队友同步休息，行动序号始终一致', () => {
    const { game, main, partners } = setup(4242)
    expect(startTrainingSquad(game, main.id, partners).ok).toBe(true)
    const ids = [main.id, ...partners]
    for (const id of ids) suppress(game.training[id])
    // 先消耗掉周一上午的交流赛，再连做两次休息。
    expect(trainingAction(game, main.id, activity('exchange')).ok).toBe(true)
    for (const step of [1, 2]) {
      const result = trainingAction(game, main.id, activity('rest'))
      expect(result.ok, result.error).toBe(true)
      for (const id of ids) expect(game.training[id].action).toBe(1 + step)
    }
  })

  it('小队里门将也能跟着外场课程练，选项池和外场一致', () => {
    const { game, gk, main, partners } = setup(99)
    expect(startTrainingSquad(game, main.id, partners).ok).toBe(true)
    const gkSession = game.training[gk.id]
    const mainSession = game.training[main.id]
    for (const id of [main.id, ...partners]) {
      suppress(game.training[id])
      game.training[id].action = 1
    }
    expect(trainingOptions(gkSession).map((item) => item.id)).toEqual(trainingOptions(mainSession).map((item) => item.id))
    const course = trainingOptions(mainSession).find((item) => (item.cost ?? 0) > 0 && item.group)!
    const result = trainingAction(game, main.id, activity(course.id))
    expect(result.ok, result.error).toBe(true)
    expect(gkSession.action).toBe(2)
  })

  it('精力不足或已在培养中的队友不能进小队', () => {
    const { game, main, partners } = setup(555)
    expect(startTraining(game, partners[0]).ok).toBe(true)
    expect(startTrainingSquad(game, main.id, partners)).toMatchObject({ ok: false, error: expect.stringContaining('培养') })
    const second = createInitialGame(556)
    const gk = second.roster.find((player) => player.positions.GK > 0)!
    gk.energy = TRAINING_ENERGY_COST - 1
    const main2 = second.roster.find((player) => player.positions.GK === 0)!
    const rest = second.roster.filter((player) => player.positions.GK === 0 && player.id !== main2.id).slice(0, 5).map((player) => player.id)
    expect(startTrainingSquad(second, main2.id, [gk.id, ...rest])).toMatchObject({ ok: false, error: expect.stringContaining('精力') })
  })
})
