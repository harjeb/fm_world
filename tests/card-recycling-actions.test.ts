import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerCard } from '../src/game/types.ts'
import { cardRecyclePoints, recyclePlayerCards } from '../src/game/cards.ts'
import { onlineState } from '../src/online.ts'
import { createTrainingSession } from '../src/game/training.ts'
import { game, ui, setGame } from '../src/ui/state.ts'

const mocks = vi.hoisted(() => ({
  save: vi.fn(() => true),
  online: false,
  flush: vi.fn(async () => {}),
  recycle: vi.fn(async (_ids: string[], _revision: number) => {}),
}))
vi.mock('../src/game/state.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/game/state.ts')>(),
  saveGame: mocks.save,
}))
vi.mock('../src/ui/morph.ts', () => ({ morph: vi.fn() }))
vi.mock('../src/ui/tooltip.ts', () => ({ installTooltips: vi.fn(), syncTooltip: vi.fn() }))
vi.mock('../src/online.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/online.ts')>(),
  isOnlineMode: () => mocks.online,
  flushOnlineNow: mocks.flush,
  recycleCardsOnline: mocks.recycle,
  loadPublicConfig: () => new Promise(() => {}),
}))

let click: (event: unknown) => Promise<void>
let originalGame: typeof game
let originalUi: typeof ui

beforeAll(async () => {
  originalGame = structuredClone(game)
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
  // Other modules may register click handlers; identify the app handler by its action behavior.
  expect(listeners.click?.length).toBeGreaterThan(0)
  click = listeners.click[listeners.click.length - 1]
})
afterAll(() => { setGame(originalGame); Object.assign(ui, originalUi); vi.unstubAllGlobals() })

async function act(action: string) {
  const el = { dataset: { action }, matches: () => false, contains: () => false,
    closest: (selector: string) => selector === '[data-action]' ? el : null }
  await click({ target: el })
}

function card(id: string, serial: number): PlayerCard {
  const p = game.roster[0]
  return { id, serial, playerId: p.id, playerName: p.name, version: 1, routeId: null, createdAt: serial,
    attrs: { ...p.attrs }, positions: { ...p.positions }, personality: { ...p.personality }, skills: [] }
}

beforeEach(() => {
  setGame(structuredClone(originalGame))
  Object.assign(ui, originalUi)
  delete game.shared
  for (const p of game.roster) delete p.equippedCardId
  game.cards = []; game.training = {}; game.trainingPoints = 42
  ui.screen = 'inventory'; ui.inventorySearch = 'no-such-player'; ui.inventoryPos = 'ALL'
  ui.recycleSelectedIds = []; ui.recycleConfirm = false; ui.notice = ''
  mocks.save.mockReset().mockReturnValue(true)
  mocks.online = false
  mocks.flush.mockReset().mockResolvedValue(undefined)
  mocks.recycle.mockReset().mockResolvedValue(undefined)
  Object.assign(onlineState, { status: 'offline', user: null, revision: 0, error: '' })
})

describe('离线球员卡回收点击事件', () => {
  it('空搜索结果的一键预览覆盖库存并替换旧选择；取消不修改数据', async () => {
    const a = card('a', 1), b = card('b', 2), equipped = card('equipped', 3), locked = card('locked', 4), pending = card('pending', 5)
    game.roster[0].equippedCardId = equipped.id
    locked.recycleLocked = true
    game.training[game.roster[0].id] = createTrainingSession(game.roster[0], 10)
    game.training[game.roster[0].id].cardId = pending.id
    game.cards = [a, b, equipped, locked, pending]
    ui.recycleSelectedIds = ['locked', 'old']
    const before = structuredClone(game.cards)
    await act('card-recycle-all')
    expect(ui.recycleConfirm).toBe(true)
    expect(ui.recycleSelectedIds).toEqual(['a', 'b'])
    expect(game.cards).toEqual(before)
    expect(game.trainingPoints).toBe(42)
    await act('card-recycle-cancel')
    expect(ui.recycleConfirm).toBe(false)
    expect(game.cards).toEqual(before)
    expect(game.trainingPoints).toBe(42)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('确认只删除预览卡并加点，预览后新增卡保留', async () => {
    const a = card('a', 1), b = card('b', 2), locked = card('locked', 3)
    locked.recycleLocked = true
    game.cards = [a, b, locked]
    const points = cardRecyclePoints(a)! + cardRecyclePoints(b)!
    await act('card-recycle-all')
    expect(ui.recycleSelectedIds).toEqual(['a', 'b'])
    game.cards.push(card('new', 4))
    await act('card-recycle-confirm')
    expect(game.cards.map(c => c.id)).toEqual(['locked', 'new'])
    expect(game.trainingPoints).toBe(42 + points)
    expect(ui.recycleConfirm).toBe(false)
    expect(ui.recycleSelectedIds).toEqual([])
    expect(mocks.save).toHaveBeenCalledOnce()
  })

  it.each(['equip', 'lock', 'pending', 'modify'])('一键预览后%s改变时拒绝整批确认', async (change) => {
    game.cards = [card('a', 1), card('b', 2)]
    await act('card-recycle-all')
    expect(ui.recycleConfirm).toBe(true)
    if (change === 'equip') game.roster[0].equippedCardId = 'a'
    else if (change === 'lock') game.cards[0].recycleLocked = true
    else if (change === 'pending') {
      const player = game.roster[0]
      game.training[player.id] = createTrainingSession(player, 10)
      game.training[player.id].cardId = 'a'
    } else game.cards[0].attrs.passing++
    const before = structuredClone(game.cards)
    await act('card-recycle-confirm')
    expect(game.cards).toEqual(before)
    expect(game.trainingPoints).toBe(42)
    expect(ui.recycleConfirm).toBe(false)
    expect(ui.notice).toContain('重新预览')
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('存档失败时回滚卡片和点数', async () => {
    game.cards = [card('a', 1), card('b', 2)]
    const before = structuredClone(game.cards)
    await act('card-recycle-all')
    expect(ui.recycleConfirm).toBe(true)
    mocks.save.mockReturnValue(false)
    await act('card-recycle-confirm')
    expect(mocks.save).toHaveBeenCalledOnce()
    expect(game.cards).toEqual(before)
    expect(game.trainingPoints).toBe(42)
    expect(ui.recycleConfirm).toBe(false)
    expect(ui.notice).toContain('操作已撤销')
  })
})

describe('联机球员卡回收点击事件', () => {
  it('先同步再确定全库存预览，只向服务器提交已预览的卡与版本', async () => {
    mocks.online = true
    Object.assign(onlineState, { status: 'online', revision: 7 })
    game.cards = [card('a', 1), card('b', 2)]
    ui.recycleSelectedIds = ['a']
    mocks.flush.mockImplementationOnce(async () => {
      game.cards![0].recycleLocked = true
      game.cards!.push(card('from-sync', 3))
      onlineState.revision = 8
    })
    await act('card-recycle-all')
    expect(mocks.flush).toHaveBeenCalledOnce()
    expect(ui.recycleSelectedIds).toEqual(['b', 'from-sync'])
    expect(ui.recycleConfirm).toBe(true)
    expect(mocks.recycle).not.toHaveBeenCalled()
    const points = game.cards.slice(1).reduce((sum, item) => sum + cardRecyclePoints(item)!, 0)
    game.cards.push(card('after-preview', 4))
    mocks.recycle.mockImplementationOnce(async (ids, revision) => {
      expect(revision).toBe(8)
      expect(recyclePlayerCards(game, ids).ok).toBe(true)
    })
    await act('card-recycle-confirm')
    expect(mocks.recycle).toHaveBeenCalledWith(['b', 'from-sync'], 8)
    expect(game.cards.map(item => item.id)).toEqual(['a', 'after-preview'])
    expect(game.trainingPoints).toBe(42 + points)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('预览后的联机版本变化或同步失败时不会提交回收', async () => {
    mocks.online = true
    Object.assign(onlineState, { status: 'online', revision: 10 })
    game.cards = [card('a', 1)]
    await act('card-recycle-all')
    onlineState.revision = 11
    await act('card-recycle-confirm')
    expect(ui.notice).toContain('重新预览')
    expect(mocks.recycle).not.toHaveBeenCalled()
    expect(game.cards).toHaveLength(1)

    mocks.flush.mockRejectedValueOnce(new Error('同步失败'))
    await act('card-recycle-all')
    expect(ui.recycleConfirm).toBe(false)
    expect(ui.notice).toContain('同步失败')
    expect(mocks.recycle).not.toHaveBeenCalled()
    expect(game.cards).toHaveLength(1)
  })
})
