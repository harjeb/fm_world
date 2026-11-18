import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { loadPveContent } from '../src/game/pve-content.ts'
import { finishMatch, restoreActiveEngine } from '../src/game/actions.ts'
import { nextBeijingMidnight } from '../src/game/calendar.ts'
import { PEAK_DAILY_LIMIT } from '../src/game/peak-attempts.ts'
import type { GameState } from '../src/game/types.ts'

beforeAll(loadPveContent)
const dirs: string[] = []
const servers: AppServer[] = []
afterEach(() => {
  for (const app of servers.splice(0)) app.close()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('联机巅峰次数与存档保护', () => {
  it('服务器原子开赛、保存进度、跨设备防止绕过，下一游戏日刷新', async () => {
    let clock = Date.UTC(2026, 10, 14, 1)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-peak-online-'))
    dirs.push(dir)
    let app = createAppServer({ dataDir: dir, tickMs: 0, now: () => clock })
    servers.push(app)
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
    let base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
    const register = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'peak-user', password: 'secret123' }) })
    expect(register.status).toBe(201)
    const account = await register.json() as { token: string }
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${account.token}` }
    const get = async () => (await fetch(`${base}/api/game`, { headers })).json() as Promise<{ game: GameState; revision: number }>
    const start = async () => fetch(`${base}/api/peak/start`, { method: 'POST', headers, body: JSON.stringify({ stage: 1 }) })
    const save = async (game: GameState, revision: number) => fetch(`${base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game, baseRevision: revision }) })

    const both = await Promise.all([start(), start()])
    expect(both.map(r => r.status).sort()).toEqual([200, 400])
    let state = await get()
    expect(state.game.pve!.peak.dailyAttempts?.count).toBe(1)
    const first = state.game.activeMatch!.context
    // An old or manipulated client cannot change the current match or reset the counter.
    const changed = structuredClone(state.game)
    changed.activeMatch!.context.seed++
    expect((await save(changed, state.revision)).status).toBe(409)
    const invalid = structuredClone(state.game)
    ;(invalid as unknown as { challengeHistory: unknown }).challengeHistory = {}
    expect((await save(invalid, state.revision)).status).toBe(409)
    const oldRewards = structuredClone(state.game)
    delete oldRewards.pve!.peak.stageRewardVersion
    delete oldRewards.pve!.peak.claimedStageRewards
    expect((await save(oldRewards, state.revision)).status).toBe(409)
    const oldClient = structuredClone(state.game)
    delete oldClient.pve!.peak.dailyAttempts
    delete oldClient.pve!.peak.attemptCounter
    expect((await save(oldClient, state.revision)).status).toBe(200)
    state = await get()
    expect(state.game.pve!.peak.dailyAttempts?.count).toBe(1)
    expect(state.game.pve!.peak.attemptCounter).toBe(1)

    const engine = restoreActiveEngine(state.game)!
    engine.simulate()
    const record = finishMatch(state.game, engine, clock)!
    expect(record.id).toContain('peak-v2-1')
    expect((await save(state.game, state.revision)).status).toBe(200)
    state = await get()
    expect(state.game.challengeHistory.some(row => row.id === record.id)).toBe(true)
    expect(state.game.pve!.peak.dailyAttempts?.count).toBe(1)

    for (let attempt = 2; attempt <= PEAK_DAILY_LIMIT; attempt++) {
      const response = await start()
      expect(response.status).toBe(200)
      state = await get()
      expect(state.game.pve!.peak.dailyAttempts?.count).toBe(attempt)
      expect(state.game.activeMatch!.context.seed).not.toBe(first.seed)
      state.game.activeMatch = undefined
      expect((await save(state.game, state.revision)).status).toBe(200)
    }
    const exhausted = await start()
    expect(exhausted.status).toBe(400)
    expect((await exhausted.json()).error).toContain(`${PEAK_DAILY_LIMIT} 次`)
    state = await get()
    const fake = structuredClone(state.game)
    fake.activeMatch = { context: first, engineState: {}, instructions: [], lineup: fake.lineup, startedAt: clock, coachPausesLeft: 3 }
    expect((await save(fake, state.revision)).status).toBe(409)
    state = await get()
    expect(state.game.pve!.peak.dailyAttempts?.count).toBe(PEAK_DAILY_LIMIT)
    // 正常停服、重启后同一天不能重新刷次数。
    await app.flush()
    await app.shutdown()
    servers.pop()
    app = createAppServer({ dataDir: dir, tickMs: 0, now: () => clock })
    servers.push(app)
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
    expect((await start()).status).toBe(400)
    state = await get()
    expect(state.game.pve!.peak.dailyAttempts?.count).toBe(PEAK_DAILY_LIMIT)
    clock = nextBeijingMidnight(clock)
    expect((await start()).status).toBe(200)
    state = await get()
    expect(state.game.pve!.peak.dailyAttempts?.count).toBe(1)
    expect(state.game.pve!.peak.attemptCounter).toBe(PEAK_DAILY_LIMIT + 1)
  }, 120_000)
})
