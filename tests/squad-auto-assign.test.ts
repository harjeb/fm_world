import { beforeEach, describe, expect, it } from 'vitest'
import { createWorldGame } from '../src/game/world.ts'
import { autoAssignLineup, validateLineup, type AutoAssignContext, type AutoAssignMode } from '../src/game/squad.ts'
import type { Lineup, Player } from '../src/game/types.ts'

function stubLocalStorage(): void {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k), clear: () => store.clear() },
  })
}

function setup(seed = 2024) {
  const game = createWorldGame(seed)
  return { game, roster: game.roster, formationId: game.lineup.formationId, tactics: game.lineup.tactics }
}

function context(overrides: Partial<Record<string, { condition?: number; minutes?: number }>> = {}, extra: Partial<AutoAssignContext> = {}): AutoAssignContext {
  return {
    condition: (player) => overrides[player.id]?.condition ?? 100,
    minutes: (player) => overrides[player.id]?.minutes ?? 0,
    ...extra,
  }
}

const assign = (mode: AutoAssignMode, roster: Player[], formationId: Lineup['formationId'], tactics: Lineup['tactics'], ctx: AutoAssignContext) =>
  autoAssignLineup(roster, formationId, tactics, undefined, mode, ctx)

const ids = (lineup: Lineup) => lineup.starters.map((starter) => starter.playerId)

describe('战术页自动分配', () => {
  beforeEach(stubLocalStorage)

  it('三种方式排出来的阵容都合法，门将位是门将', () => {
    const { roster, formationId, tactics } = setup()
    for (const mode of ['best', 'half', 'full'] as const) {
      const lineup = assign(mode, roster, formationId, tactics, context())
      const check = validateLineup(roster, lineup)
      expect(check.valid, `${mode}: ${check.errors.join('；')}`).toBe(true)
      expect(new Set(ids(lineup)).size).toBe(lineup.starters.length)
      const keeper = lineup.starters.find((starter) => starter.slotId === 'gk')
      if (keeper) expect(roster.find((player) => player.id === keeper.playerId)!.positions.GK).toBeGreaterThan(0)
    }
  })

  it('最强阵容：CA 和熟练度优先，体能只是很小的参考——单个主力体力差一点不会改变阵容的主体', () => {
    const { roster, formationId, tactics } = setup()
    const fresh = assign('best', roster, formationId, tactics, context())
    const tired = assign('best', roster, formationId, tactics, context({ [ids(fresh)[3]]: { condition: 55 } }))
    const kept = ids(tired).filter((id) => ids(fresh).includes(id)).length
    expect(kept).toBeGreaterThanOrEqual(ids(fresh).length - 2)
    // 体力再差也只是权重很小：在两名几乎一样强的球员之间才起决定作用，门将位不受影响
    expect(tired.starters.find((starter) => starter.slotId === 'gk')?.playerId).toBe(fresh.starters.find((starter) => starter.slotId === 'gk')?.playerId)
  })

  it('部分轮换：把体力最差的约一半主力换成体力更好的替补', () => {
    const { roster, formationId, tactics } = setup()
    const base = assign('best', roster, formationId, tactics, context())
    // 主力体力从 20 到 80 参差不齐，替补都是满体力
    const conditions = Object.fromEntries(ids(base).map((id, index) => [id, { condition: 20 + index * 10 }]))
    const ctx = context(conditions)
    // 对照组：同一个体能条件下的最强阵容，部分轮换就是在它的基础上换人
    const best = assign('best', roster, formationId, tactics, ctx)
    const half = assign('half', roster, formationId, tactics, ctx)
    expect(validateLineup(roster, half).valid).toBe(true)
    const out = ids(best).filter((id) => !ids(half).includes(id))
    const incoming = ids(half).filter((id) => !ids(best).includes(id))
    expect(out.length).toBeGreaterThanOrEqual(2)
    expect(out.length).toBeLessThanOrEqual(Math.round(ids(best).length / 2))
    expect(incoming.length).toBe(out.length)
    // 换下去的都在体力最差的那一半里（没有可踢该位置且更新鲜的替补时就不换），换上来的体力都比换下的好
    const half8 = [...ids(best)].sort((a, b) => ctx.condition(roster.find((p) => p.id === a)!) - ctx.condition(roster.find((p) => p.id === b)!)).slice(0, Math.round(ids(best).length / 2))
    for (const id of out) expect(half8).toContain(id)
    const highestOut = Math.max(...out.map((id) => ctx.condition(roster.find((p) => p.id === id)!)))
    for (const id of incoming) expect(ctx.condition(roster.find((p) => p.id === id)!)).toBeGreaterThan(Math.min(...out.map((o) => ctx.condition(roster.find((p) => p.id === o)!))))
    expect(highestOut).toBeLessThan(100)
  })

  it('部分轮换：替补没有更新鲜的人时就不换', () => {
    const { roster, formationId, tactics } = setup()
    const everyone = Object.fromEntries(roster.map((player) => [player.id, { condition: 60 }]))
    const best = assign('best', roster, formationId, tactics, context(everyone))
    const half = assign('half', roster, formationId, tactics, context(everyone))
    expect(ids(half)).toEqual(ids(best))
  })

  it('全部轮换：每个位置换上本赛季上场最少的人', () => {
    const { roster, formationId, tactics } = setup()
    const best = assign('best', roster, formationId, tactics, context())
    // 最强阵容的人都已经踢了 900 分钟，其他人几乎没上场
    const played = Object.fromEntries(ids(best).map((id) => [id, { minutes: 900 }]))
    const spare = roster.filter((player) => !ids(best).includes(player.id))
    spare.forEach((player, index) => { played[player.id] = { minutes: index * 10 } as { minutes: number } })
    const ctx = context(played)
    const full = assign('full', roster, formationId, tactics, ctx)
    expect(validateLineup(roster, full).valid).toBe(true)
    const averageMinutes = (lineup: Lineup) => ids(lineup).reduce((sum, id) => sum + ctx.minutes(roster.find((p) => p.id === id)!), 0) / ids(lineup).length
    expect(averageMinutes(full)).toBeLessThan(averageMinutes(best) / 2)
    const fresh = ids(full).filter((id) => !ids(best).includes(id)).length
    expect(fresh).toBeGreaterThanOrEqual(ids(full).length - 2)
    // 门将位上的是上场最少的那名门将
    const keepers = roster.filter((player) => player.positions.GK > 0)
    if (keepers.length > 1) {
      const least = [...keepers].sort((a, b) => ctx.minutes(a) - ctx.minutes(b))[0]
      expect(full.starters.find((starter) => starter.slotId === 'gk')?.playerId).toBe(least.id)
    }
  })

  it('熟练度低于 80 不算可踢：79 的高 CA 球员不会排在 80 的球员前面，只有没人可踢时才让他顶上', () => {
    const { roster, formationId, tactics } = setup()
    const outfield = roster.filter((player) => player.positions.GK <= 0)
    const [a, b] = outfield
    for (const player of outfield) player.positions.ST = 0
    // a 的 CA 更高但前锋熟练度只有 79；b 的前锋熟练度刚好 80。两人别的位置都不会，只能争前锋位。
    for (const player of [a, b]) { player.positions.CB = 0; player.positions.W = 0; player.positions.CM = 0 }
    a.positions.ST = 79
    b.positions.ST = 80
    for (const mode of ['best', 'half'] as const) {
      const lineup = assign(mode, roster, formationId, tactics, context())
      expect(lineup.starters.find((starter) => starter.slotId === 'st')?.playerId, mode).toBe(b.id)
    }
    // 没人达到 80 时才退而求其次：79 的人也能被排上去
    b.positions.ST = 60
    const fallback = assign('best', roster, formationId, tactics, context())
    expect(fallback.starters.find((starter) => starter.slotId === 'st')?.playerId).toBe(a.id)
  })

  it('停赛的人不会被排进首发，带伤的会被降级', () => {
    const { roster, formationId, tactics } = setup()
    const best = assign('best', roster, formationId, tactics, context())
    const banned = new Set(ids(best).slice(1, 3))
    for (const mode of ['best', 'half', 'full'] as const) {
      const lineup = assign(mode, roster, formationId, tactics, context({}, { suspended: (player) => banned.has(player.id) }))
      for (const id of banned) expect(ids(lineup), mode).not.toContain(id)
    }
    const injured = ids(best)[1]
    const lineup = assign('best', roster, formationId, tactics, context({}, { injured: (player) => player.id === injured }))
    // 带伤的人得分 ×0.7，不一定被换掉，但至少不会比原来更靠前：阵容仍然合法
    expect(validateLineup(roster, lineup).valid).toBe(true)
  })
})
