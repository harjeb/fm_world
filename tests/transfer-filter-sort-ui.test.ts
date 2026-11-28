import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { mainAttrsFor } from '../src/game/scale.ts'
import { initialDisplayCA } from '../src/game/rating.ts'
import { negotiationDemands } from '../src/game/negotiation.ts'
import type { Player, Position } from '../src/game/types.ts'
import { aiTransferMarket, marketState, onlineState, type AITransferOffer } from '../src/online.ts'
import { game, setGame, ui } from '../src/ui/state.ts'

let renderTransfer: typeof import('../src/ui/screens/transfer.ts').renderTransfer
let originalGame: typeof game
let originalUi: typeof ui

beforeAll(async () => {
  originalGame = game
  originalUi = { ...ui }
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', { localStorage: storage, location: { search: '', hash: '', origin: 'http://localhost' }, addEventListener() {}, matchMedia: () => ({ matches: false }) })
  vi.stubGlobal('document', { documentElement: { dataset: {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} })
  ;({ renderTransfer } = await import('../src/ui/screens/transfer.ts'))
})

afterAll(() => {
  setGame(originalGame)
  Object.assign(ui, originalUi)
  Object.assign(onlineState, { status: 'offline', user: null })
  Object.assign(marketState, { pool: [], auctions: [], log: [], version: 0 })
  Object.assign(aiTransferMarket, { offers: [], loading: false, loaded: false, error: '' })
  vi.unstubAllGlobals()
})

function makePlayer(template: Player, id: string, name: string, pos: Position, attrVal: number, age: number): Player {
  const p = structuredClone(template)
  delete p.starKey
  delete p.equippedCardId
  p.id = p.seedId = id
  p.name = name
  p.enName = id
  p.age = age
  p.positions = { GK: 0, CB: 0, W: 0, CM: 0, ST: 0, [pos]: 95 }
  for (const key of mainAttrsFor(pos === 'GK')) {
    p.attrs[key] = attrVal
    p.baseAttrs[key] = attrVal
  }
  return p
}

function rowOrder(html: string): string[] {
  return [...html.matchAll(/<tr\b[^>]*data-key="([^"]+)"/g)].map((m) => m[1])
}

beforeEach(() => {
  setGame(createInitialGame(5050))
  Object.assign(ui, {
    screen: 'transfer',
    transferTab: 'free',
    clubSearch: '',
    clubPos: 'ALL',
    clubSort: 'ca',
    clubSortDir: -1,
    clubPage: 0,
    aiBuyTeam: 'ALL',
    aiBuyPos: 'ALL',
    aiBuySearch: '',
    aiBuySort: 'ca',
    aiBuySortDir: -1,
    aiBuyOnlyAvailable: false,
    aiBuyPage: 0,
    sellPos: 'ALL',
    sellSort: 'ca',
    sellSortDir: -1,
  })
  Object.assign(onlineState, { status: 'offline', user: null })
  Object.assign(marketState, { pool: [], auctions: [], log: [], version: 0 })
  Object.assign(aiTransferMarket, { offers: [], loading: false, loaded: false, error: '' })
})

describe('转会市场位置筛选与 CA 等排序', () => {
  it.each([false, true])('自由球员 / 全服竞拍支持位置筛选和 CA / 年龄 / 价格排序（联机：%s）', (online) => {
    const baseField = game.roster.find((p) => p.positions.GK === 0)!
    const baseGk = game.roster.find((p) => p.positions.GK > 0)!
    const gkLow = makePlayer(baseGk, 'p-gk-low', '低能门将', 'GK', 600, 31)
    const stMid = makePlayer(baseField, 'p-st-mid', '中能前锋', 'ST', 800, 21)
    const stHigh = makePlayer(baseField, 'p-st-high', '高能前锋', 'ST', 1100, 28)
    const cbTop = makePlayer(baseField, 'p-cb-top', '顶配中卫', 'CB', 1200, 25)
    expect(initialDisplayCA(cbTop)).toBeGreaterThan(initialDisplayCA(stHigh))
    expect(initialDisplayCA(stHigh)).toBeGreaterThan(initialDisplayCA(stMid))
    expect(initialDisplayCA(stMid)).toBeGreaterThan(initialDisplayCA(gkLow))

    const pool = [gkLow, stMid, stHigh, cbTop]
    game.freeStars = pool
    marketState.pool = pool
    onlineState.status = online ? 'online' : 'offline'
    ui.transferTab = 'free'

    // 默认按原始 CA 降序，而不是固定目录顺序
    const defaultHtml = renderTransfer()
    expect(defaultHtml).toContain('id="club-sort"')
    expect(defaultHtml).toContain('data-club-pos="ST"')
    expect(defaultHtml).toContain('data-club-sort="ca"')
    expect(rowOrder(defaultHtml)).toEqual(['p-cb-top', 'p-st-high', 'p-st-mid', 'p-gk-low'])

    // 原始 CA 升序
    ui.clubSort = 'ca'
    ui.clubSortDir = 1
    expect(rowOrder(renderTransfer())).toEqual(['p-gk-low', 'p-st-mid', 'p-st-high', 'p-cb-top'])

    // 年龄升序
    ui.clubSort = 'age'
    ui.clubSortDir = 1
    expect(rowOrder(renderTransfer())).toEqual(['p-st-mid', 'p-cb-top', 'p-st-high', 'p-gk-low'])

    // 位置筛选 ST + CA 降序
    ui.clubPos = 'ST'
    ui.clubSort = 'ca'
    ui.clubSortDir = -1
    expect(rowOrder(renderTransfer())).toEqual(['p-st-high', 'p-st-mid'])
  })

  it('从 AI 球队买人支持 CA / 要价 / 年龄排序、仅看可谈筛选与位置过滤', () => {
    const team = game.aiTeams[0]
    const baseField = game.roster.find((p) => p.positions.GK === 0)!
    const pLow = makePlayer(baseField, 'ai-low', '廉价替补', 'ST', 650, 29)
    const pMid = makePlayer(baseField, 'ai-mid', '主力中锋', 'ST', 900, 22)
    const pHigh = makePlayer(baseField, 'ai-high', '王牌中场', 'CM', 1100, 26)
    onlineState.status = 'online'
    ui.transferTab = 'ai'
    const mkOffer = (p: Player, asking: number | null, blocked: string | null): AITransferOffer => ({
      teamId: team.id,
      teamName: team.name,
      player: {
        id: p.id, name: p.name, enName: p.enName, country: p.country, era: p.era, age: p.age, foot: p.foot, height: p.height,
        positions: p.positions, detailedPositions: p.detailedPositions, traitId: p.traitId, skills: p.skills, skillTiers: p.skillTiers,
        ca: initialDisplayCA(p), attrs: Object.fromEntries(mainAttrsFor(false).map((k) => [k, p.attrs[k]])),
      },
      asking,
      terms: {
        status: 'rotation',
        ageBand: 'prime',
        age: p.age ?? 24,
        minutesShare: 0.5,
        recorded: 10,
        starter: false,
        requiredPremium: asking === null ? null : 0.2,
        asking,
        value: asking ?? 500_000,
        reasons: [],
      },
      blocked,
      demands: negotiationDemands(game, p),
    })
    aiTransferMarket.offers = [
      mkOffer(pLow, 200_000, null),
      mkOffer(pMid, null, '年轻主力'),
      mkOffer(pHigh, 900_000, null),
    ]

    // 默认按原始 CA 降序
    expect(rowOrder(renderTransfer())).toEqual(['ai-high', 'ai-mid', 'ai-low'])

    // 按原始 CA 升序
    ui.aiBuySort = 'ca'
    ui.aiBuySortDir = 1
    expect(rowOrder(renderTransfer())).toEqual(['ai-low', 'ai-mid', 'ai-high'])

    // 按要价升序时，非卖品始终排在可谈球员之后
    ui.aiBuySort = 'asking'
    ui.aiBuySortDir = 1
    expect(rowOrder(renderTransfer())).toEqual(['ai-low', 'ai-high', 'ai-mid'])

    // 按要价降序时，非卖品仍排在最后
    ui.aiBuySortDir = -1
    expect(rowOrder(renderTransfer())).toEqual(['ai-high', 'ai-low', 'ai-mid'])

    // 勾选“仅看可谈”过滤非卖品
    ui.aiBuyOnlyAvailable = true
    expect(rowOrder(renderTransfer())).toEqual(['ai-high', 'ai-low'])

    // 叠加位置过滤 ST
    ui.aiBuyPos = 'ST'
    expect(rowOrder(renderTransfer())).toEqual(['ai-low'])
  })

  it('挂牌出售列表支持位置筛选和原始 CA 升降序', () => {
    const baseField = game.roster.find((p) => p.positions.GK === 0)!
    const baseGk = game.roster.find((p) => p.positions.GK > 0)!
    game.roster = [
      makePlayer(baseField, 'sell-st-low', '替补前锋', 'ST', 650, 27),
      makePlayer(baseField, 'sell-st-high', '王牌前锋', 'ST', 1050, 24),
      makePlayer(baseGk, 'sell-gk', '主力门将', 'GK', 900, 26),
    ]
    ui.transferTab = 'market'

    expect(rowOrder(renderTransfer())).toEqual(['sell-st-high', 'sell-gk', 'sell-st-low'])

    ui.sellPos = 'ST'
    ui.sellSort = 'ca'
    ui.sellSortDir = 1
    expect(rowOrder(renderTransfer())).toEqual(['sell-st-low', 'sell-st-high'])
  })
})
