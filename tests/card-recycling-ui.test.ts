import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { PlayerCard } from '../src/game/types.ts'
import { createTrainingSession } from '../src/game/training.ts'
import { game, ui } from '../src/ui/state.ts'
import { playerCA, skillName } from '../src/ui/format.ts'

let renderInventory: typeof import('../src/ui/screens/inventory.ts').renderInventory
beforeAll(async () => {
  vi.stubGlobal('document', { addEventListener: vi.fn() })
  ;({ renderInventory } = await import('../src/ui/screens/inventory.ts'))
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
    delete game.training[p.id]; delete p.equippedCardId
  })
})
