import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { game, setGame, ui } from '../src/ui/state.ts'
import { createWorldGame, worldTransferTeams } from '../src/game/world.ts'
import { aiTransferOffers, playerMarketValue, sellerSquadError, VALUE_CAP } from '../src/game/market.ts'
import { mainAttrsFor } from '../src/game/scale.ts'
import { untrainedPlayer } from '../src/game/cards.ts'
import { economyOf } from '../src/game/economy.ts'
import { negotiationDemands } from '../src/game/negotiation.ts'
import { initialDisplayCA } from '../src/game/rating.ts'
import { aiTransferMarket, marketState, onlineState, type AITransferOffer } from '../src/online.ts'

const mocks = vi.hoisted(() => ({
  save: vi.fn(() => true), online: false,
  buy: vi.fn(async (_body: Record<string, unknown>): Promise<unknown> => undefined),
  refresh: vi.fn(async () => {}),
}))
vi.mock('../src/game/state.ts', async (importOriginal) => ({ ...await importOriginal<typeof import('../src/game/state.ts')>(), saveGame: mocks.save }))
vi.mock('../src/ui/morph.ts', () => ({ morph: vi.fn() }))
vi.mock('../src/ui/tooltip.ts', () => ({ installTooltips: vi.fn(), syncTooltip: vi.fn() }))
vi.mock('../src/online.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/online.ts')>(),
  isOnlineMode: () => mocks.online,
  buyFromAIClubOnline: mocks.buy,
  refreshAITransferMarket: mocks.refresh,
  loadPublicConfig: () => new Promise(() => {}),
}))

let click: (event: unknown) => Promise<void>
let originalGame: typeof game
let originalUi: typeof ui
beforeAll(async () => {
  originalGame = game
  originalUi = { ...ui }
  const app = { toggleAttribute: vi.fn(), setAttribute: vi.fn() }
  const listeners: Record<string, Array<(event: unknown) => Promise<void>>> = {}
  vi.stubGlobal('document', {
    getElementById: (id: string) => id === 'app' ? app : null,
    querySelectorAll: () => [], querySelector: () => null,
    addEventListener: (type: string, listener: (event: unknown) => Promise<void>) => { (listeners[type] ??= []).push(listener) },
  })
  vi.stubGlobal('window', { addEventListener: vi.fn(), setInterval: vi.fn(), setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(), scrollTo: vi.fn() })
  await import('../src/ui/app.ts')
  click = listeners.click.at(-1)!
})
afterAll(() => {
  setGame(originalGame)
  Object.assign(ui, originalUi)
  Object.assign(onlineState, { status: 'offline', user: null })
  Object.assign(aiTransferMarket, { offers: [], loading: false, loaded: false, error: '' })
  Object.assign(marketState, { pool: [], auctions: [] })
  vi.unstubAllGlobals()
})
beforeEach(() => {
  setGame(createWorldGame(20241107))
  Object.assign(ui, originalUi, { screen: 'transfer', transferTab: 'ai', aiBuyTeam: 'ALL', aiBuyPos: 'ALL', aiBuySearch: '', aiBuyPage: 0, negotiation: null, notice: '' })
  Object.assign(onlineState, { status: 'offline', user: null })
  Object.assign(aiTransferMarket, { offers: [], loading: false, loaded: false, error: '' })
  Object.assign(marketState, { pool: [], auctions: [] })
  mocks.online = false
  mocks.save.mockReset().mockReturnValue(true)
  mocks.buy.mockReset()
  mocks.refresh.mockReset().mockResolvedValue(undefined)
  economyOf(game).balance = 1_000_000_000
})
async function act(action: string, dataset: Record<string, string> = {}) {
  const el = { dataset: { action, ...dataset }, matches: () => false, contains: () => false, closest: (selector: string) => selector === '[data-action]' ? el : null }
  await click({ target: el })
}
function foreignOffer() {
  const ids = new Set(game.aiTeams.map(team => team.id))
  const candidate = aiTransferOffers({ ...game, aiTeams: worldTransferTeams(game) })
    .find(item => !ids.has(item.team.id) && item.asking && !sellerSquadError(item.team, item.player))!
  expect(candidate).toBeDefined()
  return candidate
}

describe('自由球员报价弹窗', () => {
  it('联机出价弹窗不因离队前的培养属性抬高底价和默认报价', async () => {
    const player = structuredClone(game.roster.find((item) => item.positions.GK === 0)!)
    player.id = 'released-free-agent'
    const price = playerMarketValue(untrainedPlayer(player))
    expect(price).toBeGreaterThan(0)
    expect(price).toBeLessThan(VALUE_CAP)
    for (const key of mainAttrsFor(false)) player.attrs[key] = 1400
    expect(playerMarketValue(player)).toBe(VALUE_CAP)
    mocks.online = true
    marketState.pool = [player]
    ui.transferTab = 'free'
    await act('auction-bid', { player: player.id })
    expect(ui.negotiation).toMatchObject({ kind: 'bid', value: price, asking: price, offer: price })
  })
})

describe('世界 AI 转会实际点击', () => {
  it('单机打开跨区谈判，成功交易后卖方快照持久化且本赛区名单不变', async () => {
    const { team, player, asking } = foreignOffer()
    const before = game.aiTeams.map(item => item.id)
    await act('club-buy-ai', { team: team.id, player: player.id })
    expect(ui.negotiation).toMatchObject({ kind: 'club', clubId: team.id, playerId: player.id, asking })
    const demands = negotiationDemands(game, player)
    ui.negotiation!.goal = demands.goal
    ui.negotiation!.role = demands.role
    for (let offer = 20_000_000; offer < 100_000_000 && ui.negotiation; offer += 1_000_000) {
      ui.negotiation.offer = offer
      await act('nego-confirm')
    }
    expect(ui.negotiation).toBeNull()
    expect(game.roster.some(item => item.id === player.id)).toBe(true)
    expect(game.world!.transferTeams![team.id].players.some(item => item.id === player.id)).toBe(false)
    expect(game.aiTeams.map(item => item.id)).toEqual(before)
    expect(mocks.save).toHaveBeenCalled()
  })

  it('联机跨区谈判使用公开报价并提交服务器，而非本地修改名册', async () => {
    const { team, player: source, asking, terms } = foreignOffer()
    const player = untrainedPlayer(source)
    const quote: AITransferOffer = { teamId: team.id, teamName: team.name, asking, terms, blocked: null, demands: negotiationDemands(game, player),
      player: { id: player.id, name: player.name, enName: player.enName, country: player.country, era: player.era, age: player.age, foot: player.foot, height: player.height, positions: player.positions, detailedPositions: player.detailedPositions, traitId: player.traitId, skills: player.skills, skillTiers: player.skillTiers, attrs: player.attrs, ca: initialDisplayCA(player) } }
    mocks.online = true
    Object.assign(onlineState, { status: 'online', user: { id: 'coach', username: 'coach' } })
    aiTransferMarket.offers = [quote]
    await act('club-buy-ai', { team: team.id, player: player.id })
    expect(ui.negotiation).toMatchObject({ kind: 'club', clubId: team.id, playerId: player.id, asking })
    const authoritative = structuredClone(game)
    authoritative.roster.push(structuredClone(player))
    mocks.buy.mockResolvedValueOnce(authoritative)
    await act('nego-confirm')
    expect(mocks.buy).toHaveBeenCalledWith({ teamId: team.id, playerId: player.id, offer: asking, goal: 'promotion', role: 'first-team' })
    expect(game.roster.some(item => item.id === player.id)).toBe(true)
    expect(game.aiTeams.some(item => item.id === team.id)).toBe(false)
    expect(mocks.refresh).toHaveBeenCalled()
  })
})
