import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TransferOffer } from '../src/game/types.ts'

beforeEach(() => {
  const store = new Map<string, string>()
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) }
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', { localStorage: storage, location: { search: '', hash: '', origin: 'http://localhost' }, addEventListener() {}, matchMedia: () => ({ matches: false }) })
  vi.stubGlobal('document', { documentElement: { dataset: {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} })
})
afterEach(() => { vi.unstubAllGlobals() })

function offer(game: { roster: { id: string; name: string }[] }, index: number, status: TransferOffer['status'] = 'pending'): TransferOffer {
  const player = game.roster[index]
  return {
    id: `offer-${index}`, clubId: 'ai_01', clubName: `求购队${index}`, playerId: player.id, playerName: player.name,
    amount: 2_600_000, value: 2_000_000, createdAt: Date.now(), expiresAt: Date.now() + 3_600_000, status,
  }
}

describe('收到转会报价的提醒', () => {
  it('总览最上面醒目显示待回复的报价，侧栏「转会」和「收到的报价」标签显示红色数字', async () => {
    const { game } = await import('../src/ui/state.ts')
    const { renderHome } = await import('../src/ui/screens/home.ts')
    const { renderSidebar } = await import('../src/ui/screens/shell.ts')
    const { renderTransfer } = await import('../src/ui/screens/transfer.ts')

    game.transferOffers = []
    expect(renderHome()).not.toContain('offer-alert')
    expect(renderSidebar()).not.toContain('nav-badge alert')

    game.transferOffers = [offer(game, 0), offer(game, 1), offer(game, 2, 'rejected')]
    const home = renderHome()
    expect(home).toContain('class="offer-alert"')
    expect(home).toContain('收到 2 份转会报价')
    expect(home).toContain('求购队0')
    expect(home).toContain(game.roster[1].name)
    expect(home).not.toContain('求购队2')
    // 提示块排在仪表盘前面，点了去「收到的报价」。
    expect(home.indexOf('offer-alert')).toBeLessThan(home.indexOf('class="dash"'))
    expect(home).toContain('data-action="go-transfer" data-tab="offers"')

    const sidebar = renderSidebar()
    const transferNav = sidebar.slice(sidebar.indexOf('data-nav="transfer"'))
    expect(transferNav.slice(0, transferNav.indexOf('</button>'))).toMatch(/<span class="nav-badge alert"[^>]*>2<\/span>/)

    expect(renderTransfer()).toContain('<span class="badge">2</span>')
  })
})
