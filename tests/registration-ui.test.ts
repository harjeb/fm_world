import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  const store = new Map<string, string>()
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) }
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', { localStorage: storage, location: { search: '', hash: '', origin: 'http://localhost' }, addEventListener() {}, matchMedia: () => ({ matches: false }) })
  vi.stubGlobal('document', { documentElement: { dataset: {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('注册选队预览', () => {
  it('球员 CA 显示为整数，仍按完整精度排序且不修改服务器给出的原始数值', async () => {
    const positions = { GK: 0, CB: 0, W: 0, CM: 99, ST: 0 }
    const players = [
      { name: '第一位', ca: 201.24, positions },
      { name: '第四位', ca: 198.99, positions },
      { name: '第二位', ca: 200.51, positions },
      { name: '第三位', ca: 199.49, positions },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ clubs: [{ id: 'club', name: '测试队', tier: 'division2', players }] }) }))
    const online = await import('../src/online.ts')
    const { ui } = await import('../src/ui/state.ts')
    const { renderAccountOverlay } = await import('../src/ui/screens/overlays.ts')
    online.publicConfig.registration = 'open'
    online.onlineState.status = 'offline'
    await online.refreshRegistrationClubs()
    ui.accountOpen = true
    ui.authMode = 'register'
    ui.registrationClubId = 'club'

    const html = renderAccountOverlay()
    const shown = [...html.matchAll(/CA (\d+(?:\.\d+)?)/g)].map((match) => match[1])
    expect(shown).toEqual(['201', '201', '199'])
    expect(html).not.toContain('第四位')
    expect(html.indexOf('第一位')).toBeLessThan(html.indexOf('第二位'))
    expect(html.indexOf('第二位')).toBeLessThan(html.indexOf('第三位'))
    expect(online.registrationClubs![0].players.map((player) => player.ca)).toEqual([201.24, 198.99, 200.51, 199.49])
  })
})
