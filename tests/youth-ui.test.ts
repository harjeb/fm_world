import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createWorldGame } from '../src/game/world.ts'
import { ensureYouth, settleYouth, YOUTH_WEEK_MS } from '../src/game/youth.ts'
import { applyYouthAction } from '../src/game/youth-actions.ts'
import { roundKickoffAt } from '../src/game/season.ts'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createFmMcpServer } from '../mcp/server.ts'

beforeEach(() => {
  const store = new Map<string, string>()
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) }
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', { localStorage: storage, location: { search: '', hash: '', origin: 'http://localhost' }, addEventListener() {}, matchMedia: () => ({ matches: false }) })
  vi.stubGlobal('document', { documentElement: { dataset: {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} })
})
afterEach(() => { vi.unstubAllGlobals() })

it('独立页面、位置能力选择、成长记录和永久标记，不向玩家说明设施概率机制', async () => {
  const { setGame, ui } = await import('../src/ui/state.ts')
  const { renderYouth } = await import('../src/ui/screens/youth.ts')
  const { renderAcademy } = await import('../src/ui/screens/academy.ts')
  const { renderSidebar } = await import('../src/ui/screens/shell.ts')
  const { renderDetailOverlay } = await import('../src/ui/screens/overlays.ts')
  const { onlineState } = await import('../src/online.ts')
  onlineState.status = 'offline'
  const now = Date.now()
  const game = createWorldGame(8091)
  game.season.fixtures.forEach(f => { f.played = true })
  ensureYouth(game, now)
  const member = game.youth!.members[1]
  member.player.name = '<script>危险名字</script>'
  setGame(game)
  ui.screen = 'youth'
  let html = renderYouth()
  expect(renderSidebar()).toContain('data-nav="youth"')
  expect(html).toContain('data-youth-position')
  expect(html).toContain('data-youth-focus')
  expect(html).toContain('临时征召')
  expect(html).toContain('正式提拔')
  expect(html).toContain('当前能力')
  expect(html).toContain('潜力')
  expect(html).toContain('rating-stars')
  expect(html).not.toContain('青训上限')
  expect(html).not.toContain('基础 CA')
  expect(html).not.toContain('role="progressbar"')
  expect(html).not.toContain(member.ceiling.toFixed(1))
  expect(html).toContain('youth-badge')
  expect(html).toContain('&lt;script&gt;')
  expect(html).not.toContain('<script>危险名字</script>')
  expect(html).not.toMatch(/设施加成|突破概率|设施.*概率|突破成长|成长倍率.*设施/)
  const id = member.player.id
  expect(applyYouthAction(game, { action: 'call_up', playerId: id }, now).ok).toBe(true)
  expect(renderAcademy()).toContain('youth-badge')
  ui.detailPlayerId = id
  ui.playerDetailView = 'profile'
  expect(renderDetailOverlay()).toContain('正式提拔后才能培养角色卡')
  expect(renderDetailOverlay()).toContain('youth-ratings')
  expect(renderDetailOverlay()).not.toContain('原始 CA')
  expect(renderDetailOverlay()).not.toContain('card-row-ca')
  settleYouth(game, now + YOUTH_WEEK_MS)
  html = renderYouth()
  expect(html).toContain('最近成长记录')
  expect(html).toContain('免费签入')
  expect(html).toContain('比赛系数')
  expect(html).not.toContain('CA 成长')
  expect(html).not.toContain('基础 CA')
  expect(html).not.toContain('青训上限')
  expect(applyYouthAction(game, { action: 'promote', playerId: id }, now + YOUTH_WEEK_MS).ok).toBe(true)
  expect(renderDetailOverlay()).toContain('youth-badge')
  expect(renderDetailOverlay()).toContain('培养角色卡')
})

it('阵容锁定时说明名单按钮不可用的原因，培养方向仍可保存', async () => {
  const { setGame } = await import('../src/ui/state.ts')
  const { renderYouth } = await import('../src/ui/screens/youth.ts')
  const start = Date.UTC(2026, 10, 18, 1)
  const game = createWorldGame(8092, undefined, '青训测试', start)
  ensureYouth(game, start)
  setGame(game)
  const clock = vi.spyOn(Date, 'now').mockReturnValue(roundKickoffAt(game, game.season.round) - 10 * 60_000)
  try {
    const html = renderYouth()
    expect(html).toContain('阵容已锁定，暂不能征召、下放、提拔或解约')
    for (const kind of ['call_up', 'promote', 'release']) {
      expect(html).toMatch(new RegExp(`data-action="youth-${kind}"[^>]* disabled>`))
    }
    expect(html).not.toMatch(/data-action="youth-plan"[^>]* disabled>/)
  } finally {
    clock.mockRestore()
  }
})

it('MCP exposes youth actions with typed position/focus and forwards them to the authoritative endpoint', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  const server = createFmMcpServer({ server: 'http://example.test', token: 'test' })
  const client = new Client({ name: 'test', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    const youth = { action: 'plan', playerId: 'academy-test', plan: { position: 'DM', focus: 'passing' } }
    const result = await client.callTool({ name: 'youth_action', arguments: { youth } })
    expect(result.isError).toBeFalsy()
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ action: 'youth_action', youth })
  } finally {
    await client.close()
    await server.close()
  }
})
