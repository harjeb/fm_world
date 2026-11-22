import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EconomyState, MatchContext } from '../src/game/types.ts'
import { ALL_ATTRIBUTES } from '../src/game/types.ts'
import { UNPAID_PERFORMANCE, economyOf, matchPerformanceOf, payWageArrears, payWageBill, wageArrearsOf } from '../src/game/economy.ts'
import { buildMatchEngineForGame } from '../src/game/match/setup.ts'
import type { MatchEngine } from '../src/game/match/engine.ts'
import { attrRating, attrStorage } from '../src/game/scale.ts'
import { RENEWAL_WAGE_CAP, WAGE_CAP, createWorldGame, previewContractRenewal, repairInflatedContractWages, wageForPlayer } from '../src/game/world.ts'
import { renewContract } from '../src/game/market.ts'

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

describe('工资口径与存量天价合同修复', () => {
  it('wageForPlayer 只按原始属性 baseAttrs 计算并封顶，培养/装卡后不会指数爆炸', () => {
    const game = createWorldGame(6102)
    const player = game.roster.find((p) => p.positions.GK === 0)!
    const baseWage = wageForPlayer(player)
    expect(baseWage).toBeGreaterThanOrEqual(500)
    expect(baseWage).toBeLessThan(10_000)

    // 模拟 AI 长期培养或装备高阶球员卡，把当前 attrs 拉到 CA ~600（baseAttrs 保持原始）
    player.baseAttrs = structuredClone(player.baseAttrs ?? player.attrs)
    for (const key of ALL_ATTRIBUTES) {
      player.attrs[key] = attrStorage(key, 65, false)
    }
    expect(wageForPlayer(player)).toBe(baseWage)

    // 即使原始属性极高，也不超过单人封顶上限 WAGE_CAP
    for (const key of ALL_ATTRIBUTES) {
      player.baseAttrs[key] = attrStorage(key, 95, false)
    }
    expect(wageForPlayer(player)).toBe(WAGE_CAP)
  })

  it('repairInflatedContractWages 修复天价存量合同且不伤及正常签约、渐进加薪续约与青训合同', () => {
    const game = createWorldGame(6103)
    const [inflated, normal, renewed, youth] = game.roster
    const fair0 = wageForPlayer(inflated)
    const fair1 = wageForPlayer(normal)
    const fair2 = wageForPlayer(renewed)

    inflated.contract = { clubId: 'player', wage: 484_471_900, expiresSeason: 4 }
    normal.contract = { clubId: 'player', wage: fair1, expiresSeason: 4 }
    const progressiveWage = Math.min(RENEWAL_WAGE_CAP, Math.round((fair2 * 2.2) / 50) * 50)
    renewed.contract = { clubId: 'player', wage: progressiveWage, expiresSeason: 6, renewals: 3 }
    youth.contract = { clubId: 'player', wage: 100, expiresSeason: 5 }

    expect(repairInflatedContractWages([inflated, normal, renewed, youth])).toBe(true)
    expect(inflated.contract.wage).toBe(fair0)
    expect(normal.contract.wage).toBe(fair1)
    expect(renewed.contract.wage).toBe(progressiveWage)
    expect(youth.contract.wage).toBe(100)
    // 幂等：再次调用不再修改
    expect(repairInflatedContractWages([inflated, normal, renewed, youth])).toBe(false)
  })

  it('续约支持 3-5 年、提前续约与历次渐进加薪，同时把残留天价合同拉回合理区间', () => {
    const game = createWorldGame(6104)
    const player = game.roster.find((p) => p.positions.GK === 0)!
    const fair = wageForPlayer(player)
    player.baseAttrs = structuredClone(player.baseAttrs ?? player.attrs)
    for (const key of ALL_ATTRIBUTES) player.attrs[key] = attrStorage(key, 68, false)
    player.contract = { clubId: 'player', wage: 83_322_200, expiresSeason: 4 }

    // 2 年合同被拒（要求 3-5 年）；3 年合同未晚于现有第 4 赛季也被拒
    expect(renewContract(game, player.id, 2).ok).toBe(false)
    expect(renewContract(game, player.id, 3).ok).toBe(false)

    // 剩余 3 季可提前续约 4 或 5 年，同时天价合同回到封顶内合理涨薪
    const firstPreview = previewContractRenewal(game, player, 4)
    expect(firstPreview.isEarlyRenewal).toBe(true)
    expect(firstPreview.canRenew).toBe(true)
    expect(firstPreview.demandedWage).toBeGreaterThan(fair)
    expect(firstPreview.demandedWage).toBeLessThanOrEqual(RENEWAL_WAGE_CAP)
    expect(renewContract(game, player.id, 4).ok).toBe(true)
    const firstWage = player.contract.wage
    expect(firstWage).toBe(firstPreview.demandedWage)
    expect(player.contract.expiresSeason).toBe(5)
    expect(player.contract.renewals).toBe(1)

    // 再提前续约到 5 年：工资应在前一次基础上继续上涨
    expect(renewContract(game, player.id, 5).ok).toBe(true)
    const secondWage = player.contract.wage
    expect(secondWage).toBeGreaterThan(firstWage)
    expect(player.contract.expiresSeason).toBe(6)
    expect(player.contract.renewals).toBe(2)

    // 已签满 5 年（第 1 赛季签至第 6 赛季）禁止重复续约
    expect(previewContractRenewal(game, player).canRenew).toBe(false)
    expect(renewContract(game, player.id, 5).ok).toBe(false)

    // 进入第 3 赛季后剩余 3 季，可再次提前续约且工资继续递涨
    game.world!.seasonIndex = 3
    game.season.index = 3
    expect(renewContract(game, player.id, 4).ok).toBe(true)
    expect(player.contract.wage).toBeGreaterThan(secondWage)
    expect(player.contract.expiresSeason).toBe(7)
    expect(player.contract.renewals).toBe(3)
  })
})
