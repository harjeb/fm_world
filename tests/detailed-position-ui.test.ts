import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { createTrainingSession, performTrainingAction } from '../src/game/training.ts'
import { addTrainedCard } from '../src/game/cards.ts'
import { detailedPositionValue } from '../src/game/detailed-positions.ts'
import { FORMATIONS } from '../src/game/data/formations.ts'
import { emptyAutoSubs } from '../src/game/match/management.ts'
import { game, setGame, ui } from '../src/ui/state.ts'

let renderTraining: typeof import('../src/ui/screens/training.ts').renderTraining
let buildTrainingRequest: typeof import('../src/ui/screens/training.ts').buildTrainingRequest
let renderLineup: typeof import('../src/ui/screens/lineup.ts').renderLineup
let renderInventory: typeof import('../src/ui/screens/inventory.ts').renderInventory
let originalGame: typeof game
let originalUi: typeof ui
beforeAll(async () => {
  originalGame = game
  originalUi = { ...ui }
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', { localStorage: storage, location: { search: '', hash: '', origin: 'http://localhost' }, addEventListener() {}, matchMedia: () => ({ matches: false }) })
  vi.stubGlobal('document', { documentElement: { dataset: {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} })
  ;({ renderTraining, buildTrainingRequest } = await import('../src/ui/screens/training.ts'))
  ;({ renderLineup } = await import('../src/ui/screens/lineup.ts'))
  ;({ renderInventory } = await import('../src/ui/screens/inventory.ts'))
})
afterAll(() => { setGame(originalGame); Object.assign(ui, originalUi); vi.unstubAllGlobals() })
beforeEach(() => {
  setGame(createInitialGame(12))
  Object.assign(ui, originalUi, { trainingPlayerId: null, trainingBookIds: [], trainingTeammateIds: [], lineupDraft: null, autoSubsDraft: null, lineupSlot: null })
})

describe('细分位置界面', () => {
  it('培养选择细分位置并实际只提升选中位置', () => {
    const player = game.roster.find(item => item.positions.GK === 0)!
    player.positions.W = player.basePositions.W = 0
    const session = createTrainingSession(player, 123)
    delete session.scheduleVersion
    game.training[player.id] = session
    Object.assign(ui, { screen: 'training', trainingPlayerId: player.id, trainingKind: 'position', trainingPosition: 'DL' })
    const html = renderTraining()
    for (const label of ['左后卫', '右后卫', '左翼卫', '右翼卫', '后腰', '左中场', '中前卫', '右中场', '左边锋', '前腰', '右边锋', '前锋']) expect(html).toContain(label)
    expect(html).toMatch(/<option value="DL" selected/)
    const request = buildTrainingRequest()
    expect(request).toEqual({ kind: 'position', position: 'DL', detailed: true })
    expect(performTrainingAction(session, request, undefined, 0, { silent: true }).ok).toBe(true)
    expect(detailedPositionValue(session.candidate, 'DL')).toBeGreaterThan(0)
    expect(detailedPositionValue(session.candidate, 'DR')).toBe(0)
  })

  it('库存卡显示各细分位置和独立熟练度', () => {
    const player = game.roster.find(item => item.positions.GK === 0)!
    const session = createTrainingSession(player, 123)
    session.candidate.detailedPositions = { DL: 41, DR: 96 }
    addTrainedCard(game, session)
    Object.assign(ui, { screen: 'inventory', inventorySearch: '', inventoryPos: 'ALL', recycleSelectedIds: [], recycleConfirm: false })
    const html = renderInventory()
    expect(html).toContain('左后卫 熟练 41')
    expect(html).toContain('右后卫 熟练 96')
  })

  it('阵容页按对应槽位显示细分熟练度，而不是粗略的边路数值', () => {
    const slot = FORMATIONS[game.lineup.formationId].slots.find(item => item.id === 'lb')!
    const starter = game.lineup.starters.find(item => item.slotId === slot.id)!
    const player = game.roster.find(item => item.id === starter.playerId)!
    player.positions.W = 100
    player.detailedPositions = { DL: 12, DR: 95 }
    Object.assign(ui, { screen: 'lineup', lineupDraft: structuredClone(game.lineup), autoSubsDraft: emptyAutoSubs(), lineupSlot: slot.id })
    const html = renderLineup()
    const row = html.match(new RegExp(`<tr[^>]*data-key="${player.id}"[^>]*>[\\s\\S]*?</tr>`))![0]
    expect(row).toContain('左后卫熟练度 12 / 100')
    expect(row).toContain('右后卫 熟练 95')
    expect(row).not.toContain('左后卫熟练度 100 / 100')
  })
})
