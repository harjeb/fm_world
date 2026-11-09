import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  const store = new Map<string, string>()
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) }
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', { localStorage: storage, location: { search: '', hash: '', origin: 'http://localhost' }, addEventListener() {}, matchMedia: () => ({ matches: false }) })
  vi.stubGlobal('document', { documentElement: { dataset: {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('真实玩家执教的球队名旁边有绿色人物图标', () => {
  it('自己的球队、联机时有教练的球队带图标，电脑球队不带', async () => {
    const online = await import('../src/online.ts')
    const { game } = await import('../src/ui/state.ts')
    const { clubName, leagueTable } = await import('../src/ui/components.ts')
    const [coached, computer] = game.aiTeams
    const mark = 'class="human-mark"'

    online.onlineState.status = 'offline'
    expect(clubName('player')).toContain(mark)
    expect(clubName(coached.id)).not.toContain(mark)

    // 联机：公开名单里 managed 的球队是别的教练在带。
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ seasonIndex: 1, clubs: [{ id: coached.id, name: coached.name, managed: true, players: [] }, { id: computer.id, name: computer.name, managed: false, players: [] }] }) }))
    online.onlineState.status = 'online'
    await online.refreshPublicWorld()
    expect(clubName(coached.id)).toContain(mark)
    expect(clubName(computer.id)).not.toContain(mark)

    const table = leagueTable(game.season.table)
    const rowOf = (id: string) => { const start = table.indexOf(`data-club-open="${id}"`); return table.slice(start, table.indexOf('</button>', start)) }
    expect(rowOf('player')).toContain(mark)
    expect(rowOf(coached.id)).toContain(mark)
    expect(rowOf(computer.id)).not.toContain(mark)
    online.onlineState.status = 'offline'
  })
})
