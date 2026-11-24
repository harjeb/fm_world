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

it('联机登录不预取世界或杯赛，按需请求合并并隔离换账号时返回的快照', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  const { createInitialGame } = await import('../src/game/state.ts')
  const game = createInitialGame(97)
  const pool = game.pve!.cupSeason!
  delete game.pve!.cupSeason
  game.pve!.cupSeasonDeferred = true
  let release!: (response: Response) => void
  let login = 0
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/login') {
      expect((init!.headers as Record<string, string>)['X-FM-Lazy-Cup']).toBe('1')
      ++login
      return Promise.resolve(Response.json({ token: `token-${login}`, user: { id: String(login), username: 'test' }, revision: 1, game }))
    }
    return new Promise<Response>(resolve => { release = resolve })
  })
  vi.stubGlobal('fetch', fetchMock)
  const online = await import('../src/online.ts')
  await online.loginOnline('a', 'password')
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/login'])
  const pending = online.loadCupSeasonOnline(pool.seasonIndex)
  expect(online.loadCupSeasonOnline(pool.seasonIndex)).toBe(pending)
  expect(fetchMock.mock.calls[1][0]).toBe(`/api/pve/cup-season?season=${pool.seasonIndex}`)
  await online.loginOnline('b', 'password')
  release(Response.json({ cupSeason: pool }))
  await pending
  online.applyLoadedCupSeason(game)
  expect(game.pve!.cupSeason).toBeUndefined()
  const current = online.loadCupSeasonOnline(pool.seasonIndex)
  release(Response.json({ cupSeason: pool }))
  await current
  online.applyLoadedCupSeason(game)
  expect(game.pve).toMatchObject({ cupSeason: { seasonIndex: pool.seasonIndex } })
  expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/world/'))).toBe(false)
})

function stallRequest(init: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
  })
}

it('后台保存超时后仍显示联机球队状态，只有退出账号后才出现本地新游戏', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  vi.stubGlobal('EventSource', FakeEvents)
  const { createWorldGame } = await import('../src/game/world.ts')
  const { saveGame } = await import('../src/game/state.ts')
  const online = await import('../src/online.ts')
  const { setGame } = await import('../src/ui/state.ts')
  const { renderWorld } = await import('../src/ui/screens/world.ts')
  const { renderTopbar } = await import('../src/ui/screens/shell.ts')
  const game = createWorldGame(193)
  const opponent = game.season.table.find(row => row.teamId !== 'player')!.teamId
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/login') return Response.json({ token: 'session', user: { id: '1', username: 'u' }, revision: 1, game, clubCoaches: { [opponent]: 'takeover' } })
    if (init?.method === 'PUT') return stallRequest(init)
    if (url === '/api/logout') return Response.json({ ok: true })
    throw new Error('unexpected request: ' + url)
  }))
  setGame((await online.loginOnline('u', 'password')).game)
  FakeEvents.current.onopen?.()
  expect(renderWorld()).toContain('human-mark ai-takeover')
  saveGame(game)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(online.onlineState.error).toContain('超时')
  expect(renderTopbar()).toContain('同步失败')
  expect(renderTopbar()).not.toContain('data-action="new-game"')
  const world = renderWorld()
  expect(world).toContain('human-mark ai-takeover')
  expect(world).not.toContain('开始本地新游戏')
  await online.logoutOnline()
  expect(renderWorld()).toContain('开始本地新游戏')
  expect(renderWorld()).not.toContain('human-mark ai-takeover')
})

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
  await vi.advanceTimersByTimeAsync(25_000)
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

it('另一设备更新冲突拉回最新存档后清空错误、丢弃过期队列，并恢复青训招募位置保存', async () => {
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  vi.stubGlobal('EventSource', FakeEvents)
  const { createInitialGame, saveGame } = await import('../src/game/state.ts')
  const game = createInitialGame(33)
  const serverLatest = { ...structuredClone(game), clubName: '另一设备最新档' }
  const afterYouth = { ...structuredClone(serverLatest), clubName: '已保存青训招募' }
  let releasePut!: (response: Response) => void
  let putCalls = 0
  let youthBody: Record<string, unknown> | null = null
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/login') return Response.json({ token: 'tok', user: { id: '1', username: 'u' }, revision: 1, game })
    if (url === '/api/game' && init?.method === 'PUT') {
      putCalls++
      return new Promise<Response>((resolve) => { releasePut = resolve })
    }
    if (url === '/api/game') return Response.json({ game: serverLatest, revision: 5 })
    if (url === '/api/youth/action') {
      youthBody = JSON.parse(String(init!.body)) as Record<string, unknown>
      return Response.json({ ok: true, revision: 6, game: afterYouth })
    }
    return Response.json({})
  })
  vi.stubGlobal('fetch', fetchMock)
  const online = await import('../src/online.ts')
  const handler = vi.fn()
  online.setRemoteGameHandler(handler)
  await online.loginOnline('u', 'password')

  // 触发后台保存；在途期间再排队一份基于旧版本的修改。
  saveGame({ ...game, clubName: '本地旧修改1' })
  const flushing = online.flushOnlineNow()
  await vi.waitFor(() => expect(releasePut).toBeDefined())
  saveGame({ ...game, clubName: '本地旧修改2' })
  releasePut(Response.json({ error: '存档已在另一设备更新' }, { status: 409 }))
  await flushing

  expect(online.onlineState.error).toBe('')
  expect(online.onlineState.revision).toBe(5)
  expect(putCalls).toBe(1)
  expect(handler).toHaveBeenLastCalledWith(expect.objectContaining({ clubName: '另一设备最新档' }))

  // 不刷新页面即可直接提交青训招募位置，且携带拉回后的最新版本号。
  const saved = await online.youthActionOnline({ action: 'recruit_position', position: 'AMR' })
  expect(youthBody).toEqual({ action: 'recruit_position', position: 'AMR', baseRevision: 5 })
  expect(online.onlineState.revision).toBe(6)
  expect(online.onlineState.error).toBe('')
  expect(saved.clubName).toBe('已保存青训招募')
})

it('冲突即时恢复失败时保留错误提示，待后续 SSE 同步权威存档后再解除阻塞', async () => {
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  vi.stubGlobal('EventSource', FakeEvents)
  const { createInitialGame, saveGame } = await import('../src/game/state.ts')
  const game = createInitialGame(44)
  const serverLatest = { ...structuredClone(game), clubName: 'SSE恢复最新档' }
  let youthCalls = 0
  let lastYouthBaseRevision = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/login') return Response.json({ token: 'tok', user: { id: '1', username: 'u' }, revision: 1, game })
    if (url === '/api/game' && init?.method === 'PUT') return Response.json({ error: '存档已在另一设备更新' }, { status: 409 })
    if (url === '/api/game') return Response.json({ error: '服务暂时不可用' }, { status: 503 })
    if (url === '/api/youth/action') {
      youthCalls++
      lastYouthBaseRevision = (JSON.parse(String(init!.body)) as { baseRevision: number }).baseRevision
      return Response.json({ ok: true, revision: 5, game: serverLatest })
    }
    return Response.json({})
  }))
  const online = await import('../src/online.ts')
  await online.loginOnline('u', 'password')
  saveGame(game)
  await online.flushOnlineNow()

  expect(online.onlineState.error).toBe('存档已在另一设备更新')
  await expect(online.youthActionOnline({ action: 'recruit_position', position: 'DM' })).rejects.toThrow('存档已在另一设备更新')
  expect(youthCalls).toBe(0)

  // 后续 SSE 收到权威状态后自动清除冲突错误，恢复青训操作。
  FakeEvents.current.emit({ type: 'state', revision: 4, game: serverLatest })
  expect(online.onlineState.error).toBe('')
  expect(online.onlineState.revision).toBe(4)
  await online.youthActionOnline({ action: 'recruit_position', position: 'DM' })
  expect(youthCalls).toBe(1)
  expect(lastYouthBaseRevision).toBe(4)
  expect(online.onlineState.revision).toBe(5)
})
