import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerCard } from '../src/game/types.ts'
import { createTrainingSession } from '../src/game/training.ts'
import { game, ui } from '../src/ui/state.ts'
import { playerCA, skillName } from '../src/ui/format.ts'

let renderInventory: typeof import('../src/ui/screens/inventory.ts').renderInventory
let recyclableCards: typeof import('../src/ui/screens/inventory.ts').recyclableCards
beforeAll(async () => {
  vi.stubGlobal('document', { addEventListener: vi.fn() })
  ;({ renderInventory, recyclableCards } = await import('../src/ui/screens/inventory.ts'))
})
afterAll(() => vi.unstubAllGlobals())

let original: { roster: typeof game.roster; cards: typeof game.cards; training: typeof game.training; trainingPoints: typeof game.trainingPoints; ui: Pick<typeof ui, 'inventorySearch' | 'inventoryPos' | 'inventorySort' | 'recycleSelectedIds' | 'recycleConfirm' | 'cardDeleteId'> }
beforeEach(() => {
  original = {
    roster: game.roster, cards: game.cards, training: game.training, trainingPoints: game.trainingPoints,
    ui: { inventorySearch: ui.inventorySearch, inventoryPos: ui.inventoryPos, inventorySort: ui.inventorySort, recycleSelectedIds: ui.recycleSelectedIds, recycleConfirm: ui.recycleConfirm, cardDeleteId: ui.cardDeleteId },
  }
  game.roster = structuredClone(game.roster)
  for (const player of game.roster) delete player.equippedCardId
  game.cards = []; game.training = {}; game.trainingPoints = 0
  ui.inventorySearch = ''; ui.inventoryPos = 'ALL'; ui.inventorySort = 'new'
  ui.recycleSelectedIds = []; ui.recycleConfirm = false; ui.cardDeleteId = null
})
afterEach(() => {
  game.roster = original.roster; game.cards = original.cards; game.training = original.training; game.trainingPoints = original.trainingPoints
  Object.assign(ui, original.ui)
})

describe('球员卡回收 UI', () => {
  it('展示余额、可选状态、锁定操作及安全的完整预览，不修改卡片', () => {
    const p = game.roster[0]
    const make = (id: string, serial: number): PlayerCard => ({ id, serial, playerId: p.id, playerName: p.name, version: 1, routeId: null, createdAt: serial, attrs: { ...p.attrs }, positions: { ...p.positions }, personality: { ...p.personality }, skills: ['lg_fast_learner'] })
    const available = make('a"<', 1), locked = make('locked', 2), equipped = make('equipped', 3), pending = make('pending', 4)
    available.customName = '<危险卡>'
    locked.recycleLocked = true
    p.equippedCardId = equipped.id
    game.cards = [available, locked, equipped, pending]
    game.training[p.id] = createTrainingSession(p, 10)
    game.training[p.id].cardId = pending.id
    game.trainingPoints = 42
    ui.inventorySearch = ''; ui.inventoryPos = 'ALL'; ui.inventorySort = 'new'
    ui.recycleSelectedIds = [available.id, locked.id]
    ui.recycleConfirm = true
    const before = structuredClone(game.cards)
    const html = renderInventory()
    expect(game.cards).toEqual(before)
    expect(html).toContain('共享培养点：42')
    expect(html).toContain('data-recycle-card="a&quot;&lt;" checked')
    expect(html).toMatch(/data-recycle-card="locked"[^>]*checked[^>]*disabled/)
    expect(html).toMatch(/data-recycle-card="equipped"[^>]*disabled/)
    expect(html).toMatch(/data-recycle-card="pending"[^>]*disabled/)
    expect(html).toContain('data-action="card-recycle-lock" data-card="locked" data-locked="false"')
    const lockedTile = html.slice(html.indexOf('data-key="locked"'), html.indexOf('</article>', html.indexOf('data-key="locked"')))
    expect(lockedTile).not.toContain('card-delete')
    const lockedBtn = lockedTile.match(/<button\b[^>]*data-action="card-recycle-lock"[^>]*>([\s\S]*?)<\/button>/)
    expect(lockedBtn?.[0]).toContain('is-locked')
    expect(lockedBtn?.[0]).toContain('aria-pressed="true"')
    expect(lockedBtn?.[1]).toMatch(/^<svg\b[\s\S]*<\/svg>$/)
    expect(lockedBtn?.[1]).not.toContain('解锁')
    expect(lockedBtn?.[1]).not.toContain('锁定')
    const unlockedTile = html.slice(html.indexOf('data-key="a&quot;&lt;"'), html.indexOf('</article>', html.indexOf('data-key="a&quot;&lt;"')))
    const unlockedBtn = unlockedTile.match(/<button\b[^>]*data-action="card-recycle-lock"[^>]*>([\s\S]*?)<\/button>/)
    expect(unlockedBtn?.[0]).not.toContain('is-locked')
    expect(unlockedBtn?.[0]).toContain('aria-pressed="false"')
    expect(unlockedBtn?.[1]).toMatch(/^<svg\b[\s\S]*<\/svg>$/)
    expect(unlockedBtn?.[1]).not.toContain('锁定')
    expect(unlockedBtn?.[1]).not.toContain('解锁')
    expect(unlockedBtn?.[1]).not.toBe(lockedBtn?.[1])
    for (const action of ['select-all', 'open', 'confirm', 'cancel']) expect(html).toContain(`data-action="card-recycle-${action}"`)
    expect(html).toContain('&lt;危险卡&gt;')
    expect(html).not.toContain('<危险卡>')
    expect(html).toContain(skillName(available.skills[0]))
    expect(html).toContain(`共 1 张，可获得 <strong>${Math.max(1, Math.floor(Math.round(playerCA(available)) / 100))}</strong>`)
    expect(html).toContain('不可逆')
    ui.inventorySearch = 'no-such-player'
    const filtered = renderInventory()
    expect(filtered).not.toContain('data-recycle-card=')
    expect(filtered).toMatch(/data-action="card-recycle-select-all"\s+disabled/)
    expect(filtered).toContain('&lt;危险卡&gt;') // selected cards remain in preview across filters
    ui.inventorySearch = ''
  })

  it('一键回收全部不受空筛选结果影响，无合格卡时禁用', () => {
    const p = game.roster[0]
    const card: PlayerCard = { id: 'eligible', serial: 1, playerId: p.id, playerName: p.name, version: 1, routeId: null, createdAt: 1, attrs: { ...p.attrs }, positions: { ...p.positions }, personality: { ...p.personality }, skills: [] }
    game.cards = [card]
    ui.inventorySearch = 'no-such-player'
    const filtered = renderInventory()
    expect(filtered).not.toContain('data-recycle-card=')
    const button = filtered.match(/<button\b[^>]*data-action="card-recycle-all"[^>]*>[\s\S]*?<\/button>/)?.[0]
    expect(button).toBeDefined()
    expect(button).toContain('一键回收全部')
    expect(button).not.toMatch(/\sdisabled(?:\s|=|>)/)

    card.recycleLocked = true
    const disabled = renderInventory().match(/<button\b[^>]*data-action="card-recycle-all"[^>]*>[\s\S]*?<\/button>/)?.[0]
    expect(disabled).toBeDefined()
    expect(disabled).toMatch(/\sdisabled(?:\s|=|>)/)
    game.cards = []
    const empty = renderInventory().match(/<button\b[^>]*data-action="card-recycle-all"[^>]*>[\s\S]*?<\/button>/)?.[0]
    expect(empty).toBeDefined()
    expect(empty).toMatch(/\sdisabled(?:\s|=|>)/)
  })

  it('返回全库存实际可回收卡，包括多位球员及离队卡，排除所有不可回收卡', () => {
    const [p, other] = game.roster
    const make = (id: string, serial: number, owner = p): PlayerCard => ({ id, serial, playerId: owner.id, playerName: owner.name, version: 1, routeId: null, createdAt: serial, attrs: { ...owner.attrs }, positions: { ...owner.positions }, personality: { ...owner.personality }, skills: [] })
    const a = make('a', 1), b = make('b', 2, other), departed = make('departed', 3)
    departed.playerId = 'departed-player'; departed.playerName = '离队球员'
    const equipped = make('equipped', 4), crossEquipped = make('cross-equipped', 5)
    const locked = make('locked', 6), pending = make('pending', 7), invalid = make('invalid', 8)
    p.equippedCardId = equipped.id
    other.equippedCardId = crossEquipped.id // 装备者不是卡片所属球员
    locked.recycleLocked = true
    game.training[other.id] = createTrainingSession(other, 10)
    game.training[other.id].cardId = pending.id // 待处理结果也由另一位球员的 session 引用
    invalid.positions = { ...invalid.positions, GK: NaN }
    game.cards = [a, b, departed, equipped, crossEquipped, locked, pending, invalid]
    ui.recycleSelectedIds = [locked.id] // 不能依赖当前选择

    const expected = ['a', 'b', 'departed'].sort()
    expect(recyclableCards().map((card) => card.id).sort()).toEqual(expected)
    ui.inventorySearch = 'no-such-player'
    expect(recyclableCards().map((card) => card.id).sort()).toEqual(expected)
    ui.inventorySearch = ''; ui.inventoryPos = 'GK'
    expect(recyclableCards().map((card) => card.id).sort()).toEqual(expected)
    ui.inventorySearch = 'no-such-player'
    expect(recyclableCards().map((card) => card.id).sort()).toEqual(expected)
  })
})
