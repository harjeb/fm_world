import { afterEach, expect, it, vi } from 'vitest'
import { createInitialGame, saveGame, setRemoteSaver } from '../src/game/state.ts'

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
afterEach(() => { setRemoteSaver(null); vi.unstubAllGlobals(); vi.resetModules() })

it('captures the delete revision after flushing a pending save', async () => {
  const game = createInitialGame(881)
  const calls: { path: string; body: Record<string, unknown> }[] = []
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
    calls.push({ path: url, body })
    if (url === '/api/login') return json({ token: 'token', user: { id: 'a', username: 'a' }, revision: 1, game })
    if (url === '/api/game' && init?.method === 'PUT') return json({ ok: true, revision: 2, updatedAt: 1 })
    if (url === '/api/scouting/delete') return json({ ok: true, revision: 3, game })
    return json({})
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  const online = await import('../src/online.ts')
  await online.loginOnline('a', 'password')
  saveGame(game)
  await online.deleteScoutingOnline('report-1')
  expect(calls.filter(call => call.path === '/api/game')).toHaveLength(1)
  expect(calls.find(call => call.path === '/api/game')!.body.baseRevision).toBe(1)
  expect(calls.find(call => call.path === '/api/scouting/delete')!.body).toEqual({ reportId: 'report-1', baseRevision: 2 })
  expect(online.onlineState.revision).toBe(3)
})
