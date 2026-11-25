import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { loadPveContent } from '../src/game/pve-content.ts'
import { finishMatch, restoreActiveEngine, startLegendChallenge } from '../src/game/actions.ts'
import { nextBeijingMidnight } from '../src/game/calendar.ts'
import { LEGEND_DAILY_LIMIT, legendDailyStatus } from '../src/game/legend-attempts.ts'
import { createInitialGame } from '../src/game/state.ts'
import type { GameState } from '../src/game/types.ts'

beforeAll(loadPveContent)
const dirs: string[] = []
const servers: AppServer[] = []
afterEach(() => {
  for (const app of servers.splice(0)) app.close()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('传奇挑战每日限次（现实日 20 次，北京时间 00:00 重置）', () => {
  it('每个现实日最多开战 20 次，不受单机 clockShift 影响，北京时间 00:00 刷新', () => {
    const start = Date.UTC(2026, 10, 25, 10, 0) // 北京时间 18:00
    const game = createInitialGame(501)
    const seeds: number[] = []
    const keys: string[] = []
    for (let i = 0; i < LEGEND_DAILY_LIMIT; i++) {
      const res = startLegendChallenge(game, i % 2 === 0 ? 'milan-1988-89' : 'barcelona-2010-11', start + i * 1000)
      expect(res.ok).toBe(true)
      seeds.push(game.activeMatch!.context.seed)
      keys.push(String(game.activeMatch!.context.recordKey))
      game.activeMatch = undefined
    }
    expect(new Set(seeds).size).toBe(LEGEND_DAILY_LIMIT)
    expect(new Set(keys).size).toBe(LEGEND_DAILY_LIMIT)
    expect(legendDailyStatus(game, start)).toMatchObject({ used: LEGEND_DAILY_LIMIT, remaining: 0 })

    // 超过 20 次被拦截；即便调高单机 clockShift 或倒拨时钟也无法绕过现实日限制。
    expect(startLegendChallenge(game, 'milan-1988-89', start)).toMatchObject({ ok: false, error: expect.stringContaining(`${LEGEND_DAILY_LIMIT} 次`) })
    game.season.clockShift = 5 * 86_400_000
    expect(legendDailyStatus(game, start).remaining).toBe(0)
    expect(startLegendChallenge(game, 'milan-1988-89', start - 86_400_000).ok).toBe(false)

    // 跨过北京时间 00:00 现实自然日自动重置为 20 次。
    const midnight = nextBeijingMidnight(start)
    expect(legendDailyStatus(game, midnight - 1).remaining).toBe(0)
    expect(legendDailyStatus(game, midnight).remaining).toBe(LEGEND_DAILY_LIMIT)
    expect(startLegendChallenge(game, 'milan-1988-89', midnight).ok).toBe(true)
    expect(legendDailyStatus(game, midnight).remaining).toBe(LEGEND_DAILY_LIMIT - 1)
  })

  it('联机服务端原子扣次、防止 PUT /api/game 绕过或清零，重启持久化并在 0 点刷新', async () => {
    let clock = Date.UTC(2026, 10, 25, 14, 0) // 北京时间 22:00
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-legend-online-'))
    dirs.push(dir)
    let app = createAppServer({ dataDir: dir, tickMs: 0, now: () => clock })
    servers.push(app)
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
    let base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`

    const register = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'legend-user', password: 'secret123' }) })
    expect(register.status).toBe(201)
    const account = await register.json() as { token: string }
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${account.token}` }
    const get = async () => (await fetch(`${base}/api/game`, { headers })).json() as Promise<{ game: GameState; revision: number }>
    const start = async (legendId = 'milan-1988-89') => fetch(`${base}/api/legend/start`, { method: 'POST', headers, body: JSON.stringify({ legendId }) })
    const save = async (game: GameState, revision: number) => fetch(`${base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game, baseRevision: revision }) })

    // 并发点击只允许成功 1 次
    const both = await Promise.all([start(), start()])
    expect(both.map(r => r.status).sort()).toEqual([200, 400])
    let state = await get()
    expect(state.game.pve!.legendDailyAttempts?.count).toBe(1)
    const first = state.game.activeMatch!.context

    // 客户端试图篡改比赛种子会被 409 拒绝
    const tampered = structuredClone(state.game)
    tampered.activeMatch!.context.seed++
    expect((await save(tampered, state.revision)).status).toBe(409)

    // 旧客户端删掉 legendDailyAttempts 保存后，服务器仍保留权威计数
    const oldClient = structuredClone(state.game)
    delete oldClient.pve!.legendDailyAttempts
    delete oldClient.pve!.legendAttemptCounter
    expect((await save(oldClient, state.revision)).status).toBe(200)
    state = await get()
    expect(state.game.pve!.legendDailyAttempts?.count).toBe(1)
    expect(state.game.pve!.legendAttemptCounter).toBe(1)

    // 完赛并保存正常通过
    const engine = restoreActiveEngine(state.game)!
    engine.simulate()
    const record = finishMatch(state.game, engine, clock)!
    expect(record.id).toContain('legend-v2-1')
    expect((await save(state.game, state.revision)).status).toBe(200)

    // 连续消耗到满 20 次
    for (let attempt = 2; attempt <= LEGEND_DAILY_LIMIT; attempt++) {
      const response = await start(attempt % 2 === 0 ? 'barcelona-2010-11' : 'milan-1988-89')
      expect(response.status).toBe(200)
      state = await get()
      expect(state.game.pve!.legendDailyAttempts?.count).toBe(attempt)
      state.game.activeMatch = undefined
      expect((await save(state.game, state.revision)).status).toBe(200)
    }

    // 第 21 次被拒绝，且客户端无法通过 PUT /api/game 伪造传奇比赛
    const exhausted = await start()
    expect(exhausted.status).toBe(400)
    expect((await exhausted.json()).error).toContain(`${LEGEND_DAILY_LIMIT} 次`)
    state = await get()
    const fake = structuredClone(state.game)
    fake.activeMatch = { context: first, engineState: {}, instructions: [], lineup: fake.lineup, startedAt: clock, coachPausesLeft: 3 }
    expect((await save(fake, state.revision)).status).toBe(409)

    // 重启后仍保持 20/20，跨越北京时间 00:00 后自动刷新
    await app.flush()
    await app.shutdown()
    servers.pop()
    app = createAppServer({ dataDir: dir, tickMs: 0, now: () => clock })
    servers.push(app)
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
    expect((await start()).status).toBe(400)

    clock = nextBeijingMidnight(clock)
    expect((await start()).status).toBe(200)
    state = await get()
    expect(state.game.pve!.legendDailyAttempts?.count).toBe(1)
    expect(state.game.pve!.legendAttemptCounter).toBe(LEGEND_DAILY_LIMIT + 1)
  }, 120_000)
})
