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
  vi.useRealTimers()
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
      if (url === '/api/game' && init?.method !== 'PUT') return Response.json({ user: { id: '1', username: 'u' }, game, revision: 1 })
      const body = JSON.parse(String(init!.body)) as { game: typeof game; baseRevision: number }
      sentRevision = body.baseRevision
      const source = (init!.headers as Record<string, string>)['X-FM-Client']
      const revision = sentRevision + 2
      FakeEvents.current.emit({ type: 'state', revision, source, game: body.game })
      return Response.json({ ok: true, revision, updatedAt: Date.now() })
    }))
    const online = await import('../src/online.ts')
    const handler = vi.fn()
    online.setRemoteGameHandler(handler)
    expect((await online.initOnline())?.clubName).toBe(game.clubName)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(online.onlineState.user?.id).toBe('1')
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
    // 保存期间收到比本次保存回执还新的快照，不能等下一条 SSE 才显示。
    saveGame(game)
    FakeEvents.current.emit({ type: 'state', revision: 7, game: { ...game, clubName: '最新跨设备进度' } })
    expect(online.onlineState.revision).toBe(4)
    await online.flushOnlineNow()
    expect(online.onlineState.revision).toBe(7)
    expect(handler).toHaveBeenLastCalledWith(expect.objectContaining({ clubName: '最新跨设备进度' }))
  })
})

function stallRequest(init: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
  })
}

it.each(['PUT', 'POST'])('青训等待中的 %s 超时后取消请求，不自动重复提交', async (stalledMethod) => {
  vi.useFakeTimers()
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  const { createInitialGame, saveGame } = await import('../src/game/state.ts')
  const game = createInitialGame(10)
  const current = { ...game, clubName: '服务器权威状态' }
  let signal: AbortSignal | null | undefined
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/login') return Response.json({ token: 'test-token', user: { id: '1', username: 'u' }, revision: 1 })
    if (url === '/api/game' || url === '/api/youth/action') {
      if (init?.method === stalledMethod) {
        signal = init?.signal
        return stallRequest(init!)
      }
      return Response.json({ game: current, revision: 2 })
    }
    return Response.json({})
  })
  vi.stubGlobal('fetch', fetchMock)
  const online = await import('../src/online.ts')
  const handler = vi.fn()
  online.setRemoteGameHandler(handler)
  await online.loginOnline('u', 'password')
  if (stalledMethod === 'PUT') {
    saveGame(game)
    await vi.advanceTimersByTimeAsync(300) // 操作开始时，已有普通存档请求在途。
  }
  const operation = online.youthActionOnline({ action: 'recruit_position', position: 'DM' })
  const outcome = expect(operation).rejects.toThrow(stalledMethod === 'PUT' ? '服务器响应超时' : '操作结果尚未确认')
  await vi.advanceTimersByTimeAsync(20_000)
  await outcome
  expect(signal?.aborted).toBe(true)
  const youthRequests = fetchMock.mock.calls.filter(([url]) => url === '/api/youth/action')
  if (stalledMethod === 'PUT') {
    expect(youthRequests).toHaveLength(0)
    expect(handler).not.toHaveBeenCalled()
  } else {
    expect(youthRequests).toHaveLength(1)
    expect(handler).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ clubName: current.clubName }))
    expect(online.onlineState.revision).toBe(2)
  }
})
