import { afterEach, describe, expect, it, vi } from 'vitest'

class FakeEvents {
  static current: FakeEvents
  onmessage: ((event: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(_url: string) { FakeEvents.current = this }
  close() {}
  emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }) }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('联机保存与 SSE', () => {
  it('待保存期间推迟远端广播，并忽略本标签页自己的保存回声', async () => {
    vi.resetModules()
    const store = new Map<string, string>([['fm-online-token', 'session']])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    })
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    vi.stubGlobal('EventSource', FakeEvents)
    const { createInitialGame, saveGame } = await import('../src/game/state.ts')
    const game = createInitialGame(7)
    let sentRevision = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/me') return Response.json({ user: { id: '1', username: 'u' }, revision: 1 })
      if (url === '/api/game' && init?.method !== 'PUT') return Response.json({ game, revision: 1 })
      const body = JSON.parse(String(init!.body)) as { game: typeof game; baseRevision: number }
      sentRevision = body.baseRevision
      const source = (init!.headers as Record<string, string>)['X-FM-Client']
      FakeEvents.current.emit({ type: 'state', revision: 3, source, game: body.game })
      return Response.json({ ok: true, revision: 3, updatedAt: Date.now() })
    }))
    const online = await import('../src/online.ts')
    const handler = vi.fn()
    online.setRemoteGameHandler(handler)
    await online.initOnline()
    game.clubName = '尚未保存的修改'
    saveGame(game)
    FakeEvents.current.emit({ type: 'state', revision: 2, game: { ...game, clubName: '旧服务器状态' } })
    expect(handler).not.toHaveBeenCalled()
    await online.flushOnlineNow()
    expect(sentRevision).toBe(1)
    expect(handler).not.toHaveBeenCalled()
    expect(online.onlineState.revision).toBe(3)
    FakeEvents.current.emit({ type: 'state', revision: 4, game: { ...game, clubName: '其他设备修改' } })
    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0][0].clubName).toBe('其他设备修改')
  })
})
