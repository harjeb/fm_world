import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  const store = new Map<string, string>()
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) }
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', { localStorage: storage, location: { search: '', hash: '', origin: 'http://localhost' }, addEventListener() {}, matchMedia: () => ({ matches: false }) })
  vi.stubGlobal('document', { documentElement: { dataset: {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('真实玩家执教的球队名旁边有绿色人物图标，超过 3 天未上线为黄色', () => {
  it('自己的球队、联机时有教练的球队带绿色图标，超过 3 天未上线带黄色 ai-takeover 图标，电脑球队不带', async () => {
    const online = await import('../src/online.ts')
    const { game } = await import('../src/ui/state.ts')
    const { clubName, leagueTable } = await import('../src/ui/components.ts')
    const { clubRosterPanel } = await import('../src/ui/club-view.ts')
    const [coached, takeoverClub, computer] = game.aiTeams
    const greenMark = 'class="human-mark"'
    const yellowMark = 'class="human-mark ai-takeover"'

    online.onlineState.status = 'offline'
    expect(clubName('player')).toContain(greenMark)
    expect(clubName(coached.id)).not.toContain('human-mark')

    // 联机：公开名单里 managed 的球队是别的教练在带；aiTakeover 为超过 3 天未上线由 AI 接管。
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        seasonIndex: 1,
        clubs: [
          { id: coached.id, name: coached.name, managed: true, aiTakeover: false, players: [] },
          { id: takeoverClub.id, name: takeoverClub.name, managed: true, aiTakeover: true, players: [] },
          { id: computer.id, name: computer.name, managed: false, players: [] },
        ],
      }),
    }))
    online.onlineState.status = 'online'
    await online.refreshPublicWorld()
    expect(clubName(coached.id)).toContain(greenMark)
    expect(clubName(coached.id)).toContain('真实玩家执教')
    expect(clubName(takeoverClub.id)).toContain(yellowMark)
    expect(clubName(takeoverClub.id)).toContain('AI 接管中')
    expect(clubName(computer.id)).not.toContain('human-mark')
    // 自己的球队当前在线查看，始终是绿色。
    expect(clubName('player')).toContain(greenMark)
    expect(clubName('player')).not.toContain('ai-takeover')

    const table = leagueTable(game.season.table)
    const rowOf = (id: string) => { const start = table.indexOf(`data-club-open="${id}"`); return table.slice(start, table.indexOf('</button>', start)) }
    expect(rowOf('player')).toContain(greenMark)
    expect(rowOf(coached.id)).toContain(greenMark)
    expect(rowOf(takeoverClub.id)).toContain(yellowMark)
    expect(rowOf(computer.id)).not.toContain('human-mark')

    const rosterHtml = clubRosterPanel({
      id: takeoverClub.id,
      name: takeoverClub.name,
      color: takeoverClub.color,
      formationId: takeoverClub.formationId,
      tier: 'division2',
      managed: true,
      aiTakeover: true,
      players: [],
    })
    expect(rosterHtml).toContain(yellowMark)
    expect(rosterHtml).toContain('AI 接管中')

    online.onlineState.status = 'offline'
  })
})
