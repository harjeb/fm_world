import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorldGame, worldTransferTeams } from '../src/game/world.ts'
import { aiTransferOffers, previewClubSigning, sellerSquadError } from '../src/game/market.ts'
import { untrainedPlayer } from '../src/game/cards.ts'
import { negotiationDemands, negotiationTerms } from '../src/game/negotiation.ts'
import { releaseChance } from '../src/game/transfer-rules.ts'
import { initialDisplayCA } from '../src/game/rating.ts'
import { mainAttrsFor } from '../src/game/scale.ts'
import type { AITransferOffer } from '../src/online.ts'
import { aiTransferMarket, onlineState } from '../src/online.ts'
import { game, setGame, ui } from '../src/ui/state.ts'

let renderTransfer: typeof import('../src/ui/screens/transfer.ts').renderTransfer
let renderDetailOverlay: typeof import('../src/ui/screens/overlays.ts').renderDetailOverlay
let renderNegotiationOverlay: typeof import('../src/ui/screens/overlays.ts').renderNegotiationOverlay
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
  ;({ renderDetailOverlay, renderNegotiationOverlay } = await import('../src/ui/screens/overlays.ts'))
})
afterAll(() => {
  setGame(originalGame)
  Object.assign(ui, originalUi)
  Object.assign(onlineState, { status: 'offline', user: null })
  Object.assign(aiTransferMarket, { offers: [], loading: false, loaded: false, error: '' })
  vi.unstubAllGlobals()
})
beforeEach(() => {
  setGame(createWorldGame(20241107))
  Object.assign(ui, { screen: 'transfer', transferTab: 'ai', aiBuyTeam: 'ALL', aiBuyPos: 'ALL', aiBuySearch: '', aiBuyPage: 0, detailPlayerId: null, negotiation: null })
  Object.assign(onlineState, { status: 'offline', user: null })
  Object.assign(aiTransferMarket, { offers: [], loading: false, loaded: false, error: '' })
})

function foreignOffer() {
  const local = new Set(game.aiTeams.map(team => team.id))
  const offers = aiTransferOffers({ ...game, aiTeams: worldTransferTeams(game) })
  const found = offers.find(item => !local.has(item.team.id) && item.asking !== null && !sellerSquadError(item.team, item.player))!
  expect(found).toBeDefined()
  return found
}

describe('世界 AI 转会界面', () => {
  it('离线按全世界球队和姓名筛选，并可预览跨赛区球员及谈判', () => {
    const { team, player, asking } = foreignOffer()
    const before = game.aiTeams.map(item => item.id)
    ui.aiBuyTeam = team.id
    ui.aiBuySearch = player.name
    const html = renderTransfer()
    expect(html).toContain('全世界 AI 球队')
    expect(html).toContain(`data-team="${team.id}" data-player="${player.id}"`)
    expect(html).toContain(player.name)
    ui.detailPlayerId = player.id
    expect(renderDetailOverlay()).toContain(player.name)
    const answers = { goal: 'title' as const, role: 'star' as const }
    ui.negotiation = { kind: 'club', clubId: team.id, playerId: player.id, asking: asking!, value: 1, offer: asking!, ...answers }
    const preview = previewClubSigning(game, team, player, asking!, answers)
    ui.negotiation.value = preview.value
    const dialog = renderNegotiationOverlay()
    expect(dialog).toContain(team.name)
    expect(dialog).toContain('俱乐部这关')
    expect(dialog).toContain(`${(Math.round(preview.chance * 1000) / 10).toFixed(1)}%`)
    expect(game.aiTeams.map(item => item.id)).toEqual(before)
  })

  it('联机仅用服务器公开报价显示跨区球员，不依赖本地完整球员', () => {
    const { team, player: source, asking, terms } = foreignOffer()
    const player = untrainedPlayer(source)
    const quote: AITransferOffer = {
      teamId: team.id, teamName: team.name,
      player: { id: player.id, name: player.name, enName: player.enName, country: player.country, era: player.era, age: player.age, foot: player.foot, height: player.height, positions: player.positions, detailedPositions: player.detailedPositions, traitId: player.traitId, skills: player.skills, skillTiers: player.skillTiers, ca: initialDisplayCA(player), attrs: Object.fromEntries(mainAttrsFor(player.positions.GK > 0).map(key => [key, player.attrs[key]])) },
      asking, terms, blocked: null, demands: negotiationDemands(game, player),
    }
    Object.assign(onlineState, { status: 'online', user: { id: 'coach', username: 'coach' } })
    aiTransferMarket.offers = [quote]
    aiTransferMarket.loaded = true
    ui.aiBuySearch = player.name
    const html = renderTransfer()
    expect(html).toContain('全世界 AI 球队')
    expect(html).toContain('刷新名单')
    expect(html).toContain(`data-team="${team.id}" data-player="${player.id}"`)
    expect(game.aiTeams.some(item => item.id === team.id)).toBe(false)
    ui.detailPlayerId = player.id
    expect(renderDetailOverlay()).toContain('位置熟练度')
    const answers = { goal: 'title' as const, role: 'star' as const }
    ui.negotiation = { kind: 'club', clubId: team.id, playerId: player.id, asking: asking!, value: terms.value, offer: asking!, ...answers }
    const playerChance = negotiationTerms({ demands: quote.demands, value: terms.value, asking: asking!, offer: asking!, answers, clubTier: game.season.tier ?? 'division2', clubId: 'player' }).chance
    const chance = Math.round(releaseChance(terms, asking!) * playerChance * 1000) / 10
    const dialog = renderNegotiationOverlay()
    expect(dialog).toContain(team.name)
    expect(dialog).toContain(`${chance.toFixed(1)}%`)
    quote.blocked = '卖方人数不足'
    const blockedHtml = renderTransfer()
    const blockedRow = blockedHtml.match(new RegExp(`<tr[^>]*data-key="${player.id}"[^>]*>[\\s\\S]*?</tr>`))![0]
    expect(blockedRow).toContain('非卖品')
    expect(blockedRow).not.toContain(`>${asking!.toLocaleString()}<`)
    const blocked = blockedRow.match(new RegExp(`<button[^>]*data-team="${team.id}"[^>]*>`))![0]
    expect(blocked).toContain('disabled')
    expect(blocked).toContain('卖方人数不足')
    expect(game.aiTeams.some(item => item.id === team.id)).toBe(false)

    quote.blocked = null
    game.activeMatch = {} as typeof game.activeMatch
    const matchHtml = renderTransfer()
    expect(matchHtml).toContain('比赛进行中暂不可谈判')
    const matchBtn = matchHtml.match(new RegExp(`<button[^>]*data-team="${team.id}"[^>]*>`))![0]
    expect(matchBtn).toContain('disabled')
    expect(matchBtn).toContain('比赛进行中暂不可谈判')
  })
})
