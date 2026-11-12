import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { caOf } from '../src/game/ca.ts'
import { initialDisplayCA } from '../src/game/rating.ts'
import { mainAttrsFor } from '../src/game/scale.ts'
import { createInitialGame } from '../src/game/state.ts'
import { untrainedPlayer } from '../src/game/cards.ts'
import type { Player } from '../src/game/types.ts'

beforeEach(() => {
  const store = new Map<string, string>()
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  }
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', { localStorage: storage, location: { search: '', hash: '', origin: 'http://localhost' }, addEventListener() {}, matchMedia: () => ({ matches: false }) })
  vi.stubGlobal('document', { documentElement: { dataset: {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} })
})
afterEach(() => vi.unstubAllGlobals())

function equip(player: Player) {
  for (const key of mainAttrsFor(player.positions.GK > 0)) player.attrs[key] = 1400
  player.equippedCardId = 'test-trained-card'
  player.version = 3
}

async function setup() {
  const { setGame, ui } = await import('../src/ui/state.ts')
  const { marketState, onlineState } = await import('../src/online.ts')
  const { renderTransfer } = await import('../src/ui/screens/transfer.ts')
  const { renderDetailOverlay, renderNegotiationOverlay } = await import('../src/ui/screens/overlays.ts')
  const { caHeat } = await import('../src/ui/components.ts')
  const game = createInitialGame(710)
  const team = game.aiTeams[0]
  const player = team.players.find((item) => item.positions.GK === 0)!
  player.age = 31
  equip(player)
  setGame(game)
  Object.assign(ui, { screen: 'transfer', transferTab: 'ai', aiBuyTeam: team.id, aiBuyPos: 'ALL', aiBuyPage: 0, clubSearch: '', clubPage: 0, negotiation: null, detailPlayerId: null })
  onlineState.status = 'offline'
  marketState.pool = []
  marketState.auctions = []
  marketState.log = []
  return { game, team, player, ui, marketState, onlineState, renderTransfer, renderDetailOverlay, renderNegotiationOverlay, caHeat }
}

function rowFor(html: string, playerId: string) {
  const row = html.match(new RegExp(`<tr[^>]*data-key="${playerId}"[^>]*>[\\s\\S]*?</tr>`))?.[0]
  expect(row, `missing transfer row for ${playerId}`).toBeDefined()
  return row!
}

describe('转会市场展示原始 CA', () => {
  it('AI 买人列表按原始 CA 排序，装备强卡不能抬高展示值或排序', async () => {
    const { team, player, renderTransfer, caHeat } = await setup()
    const original = structuredClone(untrainedPlayer(player))
    original.id = original.seedId = 'original-stronger'
    original.name = '原始更强的球员'
    for (const key of mainAttrsFor(false)) player.baseAttrs[key] *= 0.5
    team.players = [player, original]
    const before = structuredClone(player)
    expect(caOf(player.attrs, false)).toBeGreaterThan(initialDisplayCA(original))
    expect(initialDisplayCA(player)).toBeLessThan(initialDisplayCA(original))
    const html = renderTransfer()
    const row = rowFor(html, player.id)
    expect(html).toContain('<th class="num">原始 CA</th>')
    expect(row).toContain(caHeat(initialDisplayCA(player)))
    expect(row).not.toContain(caHeat(caOf(player.attrs, false)))
    expect(html.indexOf(`data-key="${original.id}"`)).toBeLessThan(html.indexOf(`data-key="${player.id}"`))
    expect(player).toEqual(before)
  })

  it('谈判弹窗显示原始 CA，明确说明不携带球员卡', async () => {
    const { player, team, ui, renderNegotiationOverlay } = await setup()
    ui.negotiation = { kind: 'club', playerId: player.id, clubId: team.id, asking: 1_000_000, value: 900_000, offer: 1_000_000, goal: 'title', role: 'star' }
    const before = structuredClone(player)
    const html = renderNegotiationOverlay()
    expect(html).toContain(`原始 CA ${initialDisplayCA(player).toFixed(0)}</small>`)
    expect(html).not.toContain(` CA ${caOf(player.attrs, false).toFixed(0)}</small>`)
    expect(html).toContain('培养出的球员卡不随人转移')
    expect(player).toEqual(before)
  })

  it('从转会市场打开 AI 球员详情，CA 和属性都展示实际买到的原始球员', async () => {
    const { player, ui, renderDetailOverlay, caHeat } = await setup()
    ui.detailPlayerId = player.id
    const before = structuredClone(player)
    const html = renderDetailOverlay()
    expect(html).toContain(`<span>原始 CA</span><b>${caHeat(initialDisplayCA(player), 1)}</b>`)
    expect(html).not.toContain(caHeat(caOf(player.attrs, false), 1))
    expect(html).toContain('转会不包含球员卡')
    expect(player).toEqual(before)
    // 离开交易场景，球员详情仍显示他实际装备的卡，不影响比赛 / 阵容的能力展示。
    ui.screen = 'lineup'
    expect(renderDetailOverlay()).toContain(`<span>CA</span><b>${caHeat(caOf(player.attrs, false), 1)}</b>`)
  })

  it('出售列表和收到的 AI 报价也展示原始 CA', async () => {
    const { game, ui, renderTransfer, caHeat } = await setup()
    const player = game.roster.find((item) => item.positions.GK === 0)!
    equip(player)
    ui.transferTab = 'market'
    expect(rowFor(renderTransfer(), player.id)).toContain(caHeat(initialDisplayCA(player)))
    game.transferOffers = [{ id: 'offer-original-ca', clubId: game.aiTeams[0].id, clubName: game.aiTeams[0].name, playerId: player.id, playerName: player.name, amount: 1_000_000, value: 900_000, createdAt: 0, expiresAt: Date.now() + 60_000, status: 'pending' }]
    ui.transferTab = 'offers'
    expect(renderTransfer()).toContain(`原始 CA ${initialDisplayCA(player).toFixed(0)}</small>`)
  })

  it.each([false, true])('自由球员列表使用原始 CA（联机：%s）', async (online) => {
    const { game, player, ui, marketState, onlineState, renderTransfer, caHeat } = await setup()
    delete player.starKey
    game.freeStars = [player]
    marketState.pool = [player]
    onlineState.status = online ? 'online' : 'offline'
    ui.transferTab = 'free'
    const row = rowFor(renderTransfer(), player.id)
    expect(row).toContain(caHeat(initialDisplayCA(player)))
    expect(row).not.toContain(caHeat(caOf(player.attrs, false)))
  })

  it('正在竞拍的球员也不会把装备卡 CA 显示为买入后的能力', async () => {
    const { player, ui, marketState, onlineState, renderTransfer, caHeat } = await setup()
    onlineState.status = 'online'
    ui.transferTab = 'free'
    marketState.pool = [player]
    marketState.auctions = [{ playerId: player.id, playerName: player.name, startedAt: Date.now(), endsAt: Date.now() + 60_000, bids: [{ accountId: 'buyer', club: '买方', amount: 1_000_000, at: Date.now() }] }]
    expect(rowFor(renderTransfer(), player.id)).toContain(caHeat(initialDisplayCA(player)))
  })
})
