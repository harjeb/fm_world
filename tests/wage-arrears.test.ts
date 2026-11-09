import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EconomyState, MatchContext } from '../src/game/types.ts'
import { ALL_ATTRIBUTES } from '../src/game/types.ts'
import { UNPAID_PERFORMANCE, economyOf, matchPerformanceOf, payWageArrears, payWageBill, wageArrearsOf } from '../src/game/economy.ts'
import { buildMatchEngineForGame } from '../src/game/match/setup.ts'
import type { MatchEngine } from '../src/game/match/engine.ts'
import { attrRating } from '../src/game/scale.ts'
import { createWorldGame } from '../src/game/world.ts'

describe('欠薪', () => {
  it('发薪时余额不够就记欠薪；下次发薪先补欠薪再发本轮的', () => {
    const economy = { balance: 100 } as EconomyState
    expect(payWageBill(economy, 300)).toBe(100)
    expect(economy.balance).toBe(0)
    expect(economy.wageArrears).toBe(200)
    economy.balance = 1000
    expect(payWageBill(economy, 300)).toBe(500)
    expect(economy.balance).toBe(500)
    expect(economy.wageArrears).toBeUndefined()
  })

  it('手动补发必须一次还清；还清后恢复正常发挥', () => {
    const game = createWorldGame(6100)
    const economy = economyOf(game)
    economy.balance = 50
    economy.wageArrears = 80
    expect(matchPerformanceOf(game)).toBe(UNPAID_PERFORMANCE)
    expect(payWageArrears(game)).toMatchObject({ ok: false, error: expect.stringContaining('还差 30') })
    expect(wageArrearsOf(game)).toBe(80)
    economy.balance = 200
    expect(payWageArrears(game)).toMatchObject({ ok: true, paid: 80 })
    expect(economy.balance).toBe(120)
    expect(wageArrearsOf(game)).toBe(0)
    expect(matchPerformanceOf(game)).toBe(1)
  })

  it('欠薪时一线队在比赛里所有属性减半，存档里的球员属性不变', () => {
    const game = createWorldGame(6101)
    const ai = game.aiTeams[0]
    const context: MatchContext = { isLeague: false, opponentId: ai.id, opponentName: ai.name, seed: 7, homeAway: 'home', durationSeconds: 900 }
    const starterId = game.lineup.starters[0].playerId
    const player = game.roster.find((item) => item.id === starterId)!
    const gk = player.positions.GK > 0
    const before = structuredClone(player.attrs)
    const inMatch = (engine: MatchEngine) => engine.state.teams[0].players.find((item) => item.sourceId === starterId)!

    const paid = inMatch(buildMatchEngineForGame(game, context, ai, Date.now(), undefined, 2) as MatchEngine)
    expect(paid.attrs.passing).toBeCloseTo(attrRating('passing', before.passing, gk), 6)

    economyOf(game).wageArrears = 1
    const unpaid = inMatch(buildMatchEngineForGame(game, context, ai, Date.now(), undefined, 2) as MatchEngine)
    for (const key of ALL_ATTRIBUTES) {
      expect(unpaid.attrs[key], key).toBeCloseTo(attrRating(key, before[key] * UNPAID_PERFORMANCE, gk), 6)
    }
    expect(player.attrs).toEqual(before)
  })
})

describe('欠薪的总览提示', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) }
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('window', { localStorage: storage, location: { search: '', hash: '', origin: 'http://localhost' }, addEventListener() {}, matchMedia: () => ({ matches: false }) })
    vi.stubGlobal('document', { documentElement: { dataset: {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('欠薪时总览最上面显示欠多少、只发挥 50%，余额够时可以补发', async () => {
    const { game } = await import('../src/ui/state.ts')
    const { renderHome } = await import('../src/ui/screens/home.ts')
    delete economyOf(game).wageArrears
    expect(renderHome()).not.toContain('arrears-alert')

    economyOf(game).balance = 1_000
    economyOf(game).wageArrears = 5_000
    let home = renderHome()
    expect(home).toContain('arrears-alert')
    expect(home).toContain('欠薪 5,000')
    expect(home).toContain('50%')
    expect(home).toMatch(/data-action="pay-wage-arrears" disabled/)
    expect(home.indexOf('arrears-alert')).toBeLessThan(home.indexOf('class="dash"'))

    economyOf(game).balance = 9_000
    home = renderHome()
    expect(home).toMatch(/data-action="pay-wage-arrears" >/)
  })
})
