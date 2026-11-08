import { beforeEach, describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { EXCHANGE_STRENGTH_RATIOS, pickExchangeOpponent, startTrainingWithSupport, trainingAction } from '../src/game/actions.ts'
import { caOf } from '../src/game/ca.ts'
import { EVENTS } from '../src/game/data/events.ts'
import type { AITeam } from '../src/game/types.ts'

function stubLocalStorage(): void {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k), clear: () => store.clear() },
  })
}

/** 独立算法：这支队首发的基础卡RANK（首发 CA 之和）。 */
function baseRating(team: AITeam): number {
  return team.lineup.starters
    .map((slot) => team.players.find((player) => player.id === slot.playerId)!)
    .reduce((sum, player) => sum + caOf(player.baseAttrs ?? player.attrs, player.positions.GK > 0), 0)
}

describe('交流赛对手按RANK挑选', () => {
  beforeEach(stubLocalStorage)

  it('每周的目标是我方RANK × 0.85 / 1.00 / 1.10，选基础卡RANK最接近的球队', () => {
    expect(EXCHANGE_STRENGTH_RATIOS).toEqual([0.85, 1, 1.1])
    const game = createInitialGame(321)
    const ratings = game.aiTeams.map((team) => baseRating(team))
    const mid = [...ratings].sort((a, b) => a - b)[Math.floor(ratings.length / 2)]
    for (const [index, ratio] of EXCHANGE_STRENGTH_RATIOS.entries()) {
      const picked = pickExchangeOpponent(game.aiTeams, mid, index + 1)
      const best = Math.min(...ratings.map((value) => Math.abs(value - mid * ratio)))
      expect(Math.abs(picked.rating - mid * ratio)).toBeCloseTo(best, 6)
      expect(picked.rating).toBeCloseTo(baseRating(picked.team), 6)
    }
    // 第三周之后沿用最后一周的比例
    expect(pickExchangeOpponent(game.aiTeams, mid, 5).team.id).toBe(pickExchangeOpponent(game.aiTeams, mid, 3).team.id)
  })

  it('对手一律用基础卡属性，不带已装备的球员卡', () => {
    const game = createInitialGame(322)
    const team = game.aiTeams[0]
    const victim = team.players[0]
    victim.attrs = Object.fromEntries(Object.keys(victim.attrs).map((key) => [key, 1400])) as typeof victim.attrs
    victim.equippedCardId = 'card-fake'
    const picked = pickExchangeOpponent([team], 600, 2).team
    const used = picked.players.find((player) => player.id === victim.id)!
    expect(used.attrs).toEqual(victim.baseAttrs)
    expect(used.equippedCardId).toBeUndefined()
    // 原来的球队对象不被改动
    expect(victim.attrs.passing).toBe(1400)
  })

  it('已经打过的对手尽量不重复；全打过才允许重复', () => {
    const game = createInitialGame(323)
    const first = pickExchangeOpponent(game.aiTeams, 12000, 2).team
    const second = pickExchangeOpponent(game.aiTeams, 12000, 2, [first.id]).team
    expect(second.id).not.toBe(first.id)
    const all = game.aiTeams.map((team) => team.id)
    expect(all).toContain(pickExchangeOpponent(game.aiTeams, 12000, 2, all).team.id)
  })

  it('培养里的交流赛会记下双方RANK，且对手来自本联赛', () => {
    const game = createInitialGame(324)
    const main = game.roster.find((player) => player.positions.GK === 0)!
    expect(startTrainingWithSupport(game, main.id).ok).toBe(true)
    const session = game.training[main.id]
    session.flags = EVENTS.map((event) => event.id)
    session.lastEventAction = Object.fromEntries(EVENTS.map((event) => [event.id, 1000]))
    session.eventCounts = Object.fromEntries(EVENTS.map((event) => [event.id, 1000]))
    session.action = 0
    const result = trainingAction(game, main.id, { kind: 'activity', activityId: 'exchange' } as any)
    expect(result.ok, result.error).toBe(true)
    expect(result.exchange?.week).toBe(1)
    expect(game.aiTeams.some((team) => team.id === result.exchange!.opponentId)).toBe(true)
    expect(result.exchange!.ownRating).toBeGreaterThan(0)
    expect(result.exchange!.opponentRating).toBeGreaterThan(0)
    // 第 1 周对手RANK应低于我方（目标是 85%）
    expect(session.log.at(-1)!.text).toContain('RANK')
  })
})
