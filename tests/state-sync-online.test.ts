import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import {
  buildGameDelta,
  deepEqual,
  digestGameSections,
  fingerprintValue,
  negotiateEncoding,
  streamJsonTo,
  writeJsonChunkedAsync,
  writeJsonChunkedSync,
} from '../server/state-sync.ts'
import type { GameState, MatchRecord } from '../src/game/types.ts'

const dirs: string[] = []
const apps = new Set<AppServer>()

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-state-sync-'))
  dirs.push(dir)
  return dir
}

async function startServer(opts: { dataDir?: string; memoryPressure?: () => boolean; now?: () => number } = {}) {
  const dir = opts.dataDir ?? makeDir()
  const app = createAppServer({
    dataDir: dir,
    tickMs: 0,
    now: opts.now ?? (() => Date.UTC(2026, 10, 18, 1)),
    compactAccountWrites: true,
    memoryPressure: opts.memoryPressure,
  })
  apps.add(app)
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  return { app, dir, base: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}` }
}

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.resetModules()
  for (const app of apps) await app.shutdown()
  apps.clear()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

type SseEvent = { id?: string; data: Record<string, unknown> }

async function openSseReader(url: string, headers: Record<string, string> = {}) {
  const controller = new AbortController()
  const res = await fetch(url, { headers, signal: controller.signal })
  expect(res.ok).toBe(true)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const nextEvent = async (timeoutMs = 8_000): Promise<SseEvent> => {
    const deadline = Date.now() + timeoutMs
    while (true) {
      const idx = buffer.indexOf('\n\n')
      if (idx !== -1) {
        const block = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        let id: string | undefined
        const dataLines: string[] = []
        for (const line of block.split('\n')) {
          if (line.startsWith('id:')) id = line.slice(3).trim()
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
        }
        if (dataLines.length > 0) {
          return { id, data: JSON.parse(dataLines.join('\n')) as Record<string, unknown> }
        }
        continue
      }
      if (Date.now() > deadline) throw new Error(`Timed out waiting for SSE event. Buffer: ${buffer.slice(0, 200)}`)
      const { done, value } = await reader.read()
      if (done) throw new Error('SSE stream ended unexpectedly')
      buffer += decoder.decode(value, { stream: true })
    }
  }
  const close = async () => {
    controller.abort()
    try { await reader.cancel() } catch { /* ignore */ }
  }
  return { res, nextEvent, close }
}

function makeFakeRecord(id: string, createdAt: number): MatchRecord {
  return {
    id,
    seed: 42,
    createdAt,
    seasonIndex: 1,
    durationSeconds: 600,
    isLeague: false,
    mode: 'friendly',
    homeId: 'player',
    awayId: 'ai_01',
    homeName: '测试队',
    awayName: '对手队',
    score: { home: 2, away: 1 },
    result: 'win',
    stats: {
      home: { possession: 55, shots: 12, shotsOnTarget: 6, goals: 2, xg: 1.8, passes: 200, passesCompleted: 170, tackles: 10, interceptions: 8, fouls: 4, corners: 5, distance: 108, yellowCards: 1, redCards: 0 },
      away: { possession: 45, shots: 7, shotsOnTarget: 4, goals: 1, xg: 0.9, passes: 160, passesCompleted: 125, tackles: 9, interceptions: 6, fouls: 6, corners: 3, distance: 104, yellowCards: 2, redCards: 0 },
    },
    playerStats: [],
    skillStats: [{ playerId: 'p1', name: 'A', side: 'home', skillId: 'long_shot', conditions: 3, applied: 2 }],
    failureStats: [{ reason: 'execution', count: 1, examples: ['射门偏出'] }],
    keyEvents: [{ seq: 10, clock: 60, half: 1, type: 'goal', team: 'home', text: '远射破门' }],
    commentary: [{ seq: 10, clock: 60, half: 1, type: 'goal', team: 'home', text: '远射破门', score: { home: 1, away: 0 } }],
    goalDetails: [],
    instructions: [],
    lineup: {
      formationId: '4-3-3',
      starters: [],
      bench: [],
      tactics: { attack: 'balanced', passing: 'mixed', tempo: 'normal', line: 'mid', press: 'mid' },
    },
    opponentId: 'ai_01',
  }
}

describe('state-sync 核心原语', () => {
  it('正确协商 br / gzip / q=0 权重', () => {
    expect(negotiateEncoding('gzip, deflate, br')).toBe('br')
    expect(negotiateEncoding('gzip, deflate, br', { preferGzip: true })).toBe('gzip')
    expect(negotiateEncoding('br;q=0.5, gzip;q=0.9')).toBe('gzip')
    expect(negotiateEncoding('br;q=0, gzip;q=0')).toBeNull()
    expect(negotiateEncoding('br;q=0, gzip')).toBe('gzip')
    expect(negotiateEncoding('br', { preferGzip: true })).toBe('br')
    expect(negotiateEncoding(undefined)).toBeNull()
  })

  it('分块流式 JSON 与分块文件读写和标准 JSON.stringify 完全等价', async () => {
    const sample = {
      ok: true,
      undef: undefined,
      arr: [1, 2, 3, 4, 5, 6, undefined, { nested: '中文"引号\n换行', nums: [1, 2, 3, 4, 5, 6, 7] }],
      big: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, { id: i, list: Array.from({ length: 12 }, (_, j) => ({ j, text: 'x'.repeat(100) })) }])),
    }
    const chunks: string[] = []
    const sink = new Writable({
      write(chunk, _enc, cb) { chunks.push(chunk.toString('utf8')); cb() },
    })
    await streamJsonTo(sample, sink, { isUnderPressure: () => true })
    expect(JSON.parse(chunks.join(''))).toEqual(JSON.parse(JSON.stringify(sample)))

    const dir = makeDir()
    const syncFile = path.join(dir, 'sync.json')
    const asyncFile = path.join(dir, 'async.json')
    writeJsonChunkedSync(syncFile, sample)
    await writeJsonChunkedAsync(asyncFile, sample, () => true)
    expect(JSON.parse(fs.readFileSync(syncFile, 'utf8'))).toEqual(JSON.parse(JSON.stringify(sample)))
    expect(JSON.parse(fs.readFileSync(asyncFile, 'utf8'))).toEqual(JSON.parse(JSON.stringify(sample)))
  })

  it('零分配 deepEqual 与 fingerprintValue 准确识别结构变化', () => {
    const a = { x: 1, y: [2, { z: 'hi', cond: 90 }] }
    const b = { x: 1, y: [2, { z: 'hi', cond: 75 }] }
    expect(deepEqual(a, b)).toBe(false)
    expect(deepEqual(a, b, new Set(['cond']))).toBe(true)
    expect(fingerprintValue(a)).not.toBe(fingerprintValue(b))
    expect(fingerprintValue({ a: 1, b: [2, 3] })).toBe(fingerprintValue({ a: 1, b: [2, 3] }))
  })
})

describe('/api/game 瘦身、Brotli/Gzip 压缩、/api/events 增量推送与内存压力降级', () => {
  it('X-FM-Slim 瘦身 /api/game 并在 /api/match/record 按需拉取战报明细，PUT /api/game 不丢失服务端明细', async () => {
    const { base } = await startServer()
    const reg = await (await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-FM-Lazy-Cup': '1', 'X-FM-Slim': '1' },
      body: JSON.stringify({ username: 'slim_coach', password: 'password123' }),
    })).json() as { token: string; revision: number; game: GameState }

    // 精简模式下，本赛区赛程去重标记存在且 aiTeams 去掉了冗余字段
    const ownDiv = reg.game.world!.divisions.find(d => d.divisionId === reg.game.season.divisionId)!
    expect(ownDiv.fixturesFromSeason).toBe(true)
    expect(ownDiv.fixtures).toEqual([])
    expect(reg.game.aiTeams[0].players[0]).not.toHaveProperty('ceilings')
    expect(reg.game.aiTeams[0].players[0]).not.toHaveProperty('positionProfile')
    expect(reg.game.aiTeams[0].players[0]).not.toHaveProperty('condition')

    // 上传一条完整友谊赛战报
    const rec = makeFakeRecord('friendly-test-1', Date.now())
    const putGame = structuredClone(reg.game)
    putGame.challengeHistory = [rec]
    const putRes = await fetch(`${base}/api/game`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${reg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: putGame, baseRevision: reg.revision }),
    })
    expect(putRes.status).toBe(200)
    const putData = await putRes.json() as { revision: number }

    // 精简模式 GET /api/game 返回 Brotli 压缩且战报明细延迟加载
    const slimRes = await fetch(`${base}/api/game`, {
      headers: { Authorization: `Bearer ${reg.token}`, 'X-FM-Lazy-Cup': '1', 'X-FM-Slim': '1', 'Accept-Encoding': 'br, gzip' },
    })
    expect(slimRes.headers.get('content-encoding')).toBe('br')
    const slimSnap = await slimRes.json() as { game: GameState; revision: number }
    expect(slimSnap.game.challengeHistory[0].id).toBe('friendly-test-1')
    expect(slimSnap.game.challengeHistory[0].detailDeferred).toBe(true)
    expect(slimSnap.game.challengeHistory[0].keyEvents).toEqual([])
    expect(slimSnap.game.challengeHistory[0].commentary).toBeUndefined()

    // 再次 PUT 上传精简后的 challengeHistory，服务端仍保留完整明细
    const saveSlim = await fetch(`${base}/api/game`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${reg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: slimSnap.game, baseRevision: putData.revision }),
    })
    expect(saveSlim.status).toBe(200)

    // 通过 /api/match/record 按需拉取完整战报（且支持 br/gzip 压缩）
    const detailRes = await fetch(`${base}/api/match/record?id=friendly-test-1`, {
      headers: { Authorization: `Bearer ${reg.token}`, 'Accept-Encoding': 'br, gzip' },
    })
    expect(detailRes.status).toBe(200)
    const detailData = await detailRes.json() as { record: MatchRecord }
    expect(detailData.record.commentary).toHaveLength(1)
    expect(detailData.record.keyEvents).toHaveLength(1)
    expect(detailData.record.skillStats).toHaveLength(1)
    expect(detailData.record.detailDeferred).toBeUndefined()

    // 未开启 slim 的旧客户端仍拿到完整战报
    const legacySnap = await (await fetch(`${base}/api/game`, {
      headers: { Authorization: `Bearer ${reg.token}` },
    })).json() as { game: GameState }
    expect(legacySnap.game.challengeHistory[0].commentary).toHaveLength(1)
    expect(legacySnap.game.challengeHistory[0].detailDeferred).toBeUndefined()
  }, 30_000)

  it('/api/events 支持 gzip 压缩、sinceRevision 首连免全量下发与增量 state-patch（含 prepend）', async () => {
    const { base } = await startServer()
    const reg = await (await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-FM-Lazy-Cup': '1', 'X-FM-Slim': '1' },
      body: JSON.stringify({ username: 'delta_coach', password: 'password123' }),
    })).json() as { token: string; revision: number; game: GameState }

    // 1. 客户端带着 sinceRevision=当前版本 连接 SSE -> 首条收到轻量 state-sync，而非完整 game
    const sse = await openSseReader(
      `${base}/api/events?token=${reg.token}&client=tab-watcher&lazyCup=1&slim=1&delta=1&sinceRevision=${reg.revision}&hasLive=0`,
      { 'Accept-Encoding': 'gzip, br' },
    )
    try {
      expect(sse.res.headers.get('content-encoding')).toBe('gzip')
      const first = await sse.nextEvent()
      expect(first.id).toBe(String(reg.revision))
      expect(first.data.type).toBe('state-sync')
      expect(first.data.revision).toBe(reg.revision)
      expect(first.data).not.toHaveProperty('game')

      // 读走初始 market 和 chat 事件
      expect((await sse.nextEvent()).data.type).toBe('market')
      expect((await sse.nextEvent()).data.type).toBe('chat')

      // 2. 另一设备修改战术并新增一条友谊赛战报 -> 推送增量 state-patch（仅含变化字段 + prepend）
      const updated = structuredClone(reg.game)
      updated.lineup.tactics.tempo = updated.lineup.tactics.tempo === 'fast' ? 'slow' : 'fast'
      updated.challengeHistory = [makeFakeRecord('friendly-delta-1', Date.now()), ...updated.challengeHistory]
      const putRes = await fetch(`${base}/api/game`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${reg.token}`, 'Content-Type': 'application/json', 'X-FM-Client': 'tab-editor' },
        body: JSON.stringify({ game: updated, baseRevision: reg.revision }),
      })
      expect(putRes.status).toBe(200)
      const { revision: nextRev } = await putRes.json() as { revision: number }

      const patchEvent = await sse.nextEvent()
      expect(patchEvent.id).toBe(String(nextRev))
      expect(patchEvent.data.type).toBe('state-patch')
      expect(patchEvent.data.baseRevision).toBe(reg.revision)
      expect(patchEvent.data.revision).toBe(nextRev)
      const patch = patchEvent.data.patch as Record<string, unknown>
      expect(patch).toHaveProperty('lineup')
      expect(patch).not.toHaveProperty('world')
      expect(patch).not.toHaveProperty('aiTeams')
      expect(patch).not.toHaveProperty('matchHistory')
      expect(patch).not.toHaveProperty('season')
      const prepend = patchEvent.data.prepend as { challengeHistory?: MatchRecord[] } | undefined
      expect(prepend?.challengeHistory?.map(r => r.id)).toEqual(['friendly-delta-1'])
      expect(prepend?.challengeHistory?.[0].detailDeferred).toBe(true)

      // 3. 再次仅修改战术 -> 增量补丁只包含 lineup 一个字段（体积缩小 >99%）
      const refreshed = await (await fetch(`${base}/api/game`, {
        headers: { Authorization: `Bearer ${reg.token}`, 'X-FM-Lazy-Cup': '1', 'X-FM-Slim': '1' },
      })).json() as { revision: number; game: GameState }
      refreshed.game.lineup.tactics.tempo = refreshed.game.lineup.tactics.tempo === 'fast' ? 'slow' : 'fast'
      const put2 = await fetch(`${base}/api/game`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${reg.token}`, 'Content-Type': 'application/json', 'X-FM-Client': 'tab-editor' },
        body: JSON.stringify({ game: refreshed.game, baseRevision: refreshed.revision }),
      })
      expect(put2.status).toBe(200)
      const patch2 = await sse.nextEvent()
      expect(patch2.data.type).toBe('state-patch')
      expect(Object.keys(patch2.data.patch as Record<string, unknown>)).toEqual(['lineup'])
      expect(patch2.data.prepend).toBeUndefined()
    } finally {
      await sse.close()
    }
  }, 30_000)

  it('内存压力高时 /api/events 对过期增量客户端降级发送 state-stale，避免同步序列化全量快照', async () => {
    let underPressure = true
    const { base } = await startServer({ memoryPressure: () => underPressure })
    const reg = await (await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-FM-Lazy-Cup': '1', 'X-FM-Slim': '1' },
      body: JSON.stringify({ username: 'pressure_coach', password: 'password123' }),
    })).json() as { token: string; revision: number; game: GameState }

    // 落后版本在内存压力下重连 -> 收到极简 state-stale 提示，不推送数 MB 全量 state
    const sse = await openSseReader(
      `${base}/api/events?token=${reg.token}&client=tab-1&lazyCup=1&slim=1&delta=1&sinceRevision=0`,
      { 'Accept-Encoding': 'gzip' },
    )
    try {
      const first = await sse.nextEvent()
      expect(first.data.type).toBe('state-stale')
      expect(first.data.revision).toBe(reg.revision)
      expect(first.data).not.toHaveProperty('game')
    } finally {
      await sse.close()
    }

    // 同时 /api/game 仍可通过异步分块流 + Brotli 正常返回完整有效 JSON
    const gameRes = await fetch(`${base}/api/game`, {
      headers: { Authorization: `Bearer ${reg.token}`, 'X-FM-Lazy-Cup': '1', 'X-FM-Slim': '1', 'Accept-Encoding': 'br' },
    })
    expect(gameRes.status).toBe(200)
    expect(gameRes.headers.get('content-encoding')).toBe('br')
    const snap = await gameRes.json() as { revision: number; game: GameState }
    expect(snap.revision).toBe(reg.revision)
    expect(snap.game.clubName).toBe(reg.game.clubName)
    underPressure = false
  }, 30_000)

  it('前端 online.ts 正确消费 state-sync / state-patch / state-stale 并在缺失基线时回退拉取 /api/game', async () => {
    vi.resetModules()
    const store = new Map<string, string>([['fm-online-token', 'tok-delta']])
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    })
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    class MockEventSource {
      static latest: MockEventSource
      static lastUrl = ''
      onmessage: ((event: { data: string }) => void) | null = null
      onopen: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(url: string) { MockEventSource.latest = this; MockEventSource.lastUrl = url }
      close() {}
      emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }) }
    }
    vi.stubGlobal('EventSource', MockEventSource)
    const { createInitialGame } = await import('../src/game/state.ts')
    const baseGame = createInitialGame(19)
    let serverRev = 3
    const serverGame = structuredClone(baseGame)
    serverGame.clubName = '服务端重同步队'
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/game') return Response.json({ user: { id: 'u1', username: 'u1' }, game: serverRev === 3 ? baseGame : serverGame, revision: serverRev })
      return Response.json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const online = await import('../src/online.ts')
    const received: GameState[] = []
    online.setRemoteGameHandler((g) => received.push(g))
    const initGame = await online.initOnline()
    expect(initGame).toBeTruthy()
    expect(MockEventSource.lastUrl).toContain('delta=1')
    expect(MockEventSource.lastUrl).toContain('slim=1')
    expect(MockEventSource.lastUrl).toContain('sinceRevision=3')

    // state-sync 不触发重渲染回调
    MockEventSource.latest.emit({ type: 'state-sync', revision: 3, serverTime: Date.now() })
    expect(received).toHaveLength(0)

    // state-patch 增量合并字段并 prepend 战报
    const newRec = makeFakeRecord('patch-rec-1', Date.now())
    MockEventSource.latest.emit({
      type: 'state-patch',
      baseRevision: 3,
      revision: 4,
      patch: { clubName: '增量新队名' },
      prepend: { challengeHistory: [newRec] },
    })
    expect(received).toHaveLength(1)
    expect(received[0].clubName).toBe('增量新队名')
    expect(received[0].challengeHistory[0].id).toBe('patch-rec-1')
    expect(online.onlineState.revision).toBe(4)

    // state-stale 触发后台拉取 /api/game
    serverRev = 9
    MockEventSource.latest.emit({ type: 'state-stale', revision: 9, serverTime: Date.now() })
    await vi.waitFor(() => expect(online.onlineState.revision).toBe(9))
    expect(received.at(-1)?.clubName).toBe('服务端重同步队')
  })

  it('buildGameDelta 在多处重型字段变化时标记 heavy=true 以便内存压力降级', async () => {
    const { createInitialGame } = await import('../src/game/state.ts')
    const g1 = createInitialGame(5)
    const g2 = structuredClone(g1)
    g2.clubName = '改名'
    const d1 = digestGameSections(g1)
    const d2 = digestGameSections(g2)
    const small = buildGameDelta(d1, g2, d2)
    expect(small.changed).toBe(true)
    expect(small.heavy).toBe(false)
    expect(Object.keys(small.patch)).toEqual(['clubName'])

    const g3 = structuredClone(g1)
    g3.aiTeams[0].name = '新对手'
    g3.pve = { ...g3.pve!, trophies: [{ cupId: 'x', cupName: 'x', seasonIndex: 1, wonAt: 1, finalOpponent: 'a', finalScore: { home: 1, away: 0 } }] }
    const big = buildGameDelta(d1, g3, digestGameSections(g3))
    expect(big.heavy).toBe(true)
  })
})
