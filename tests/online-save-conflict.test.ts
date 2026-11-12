import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import type { GameState } from '../src/game/types.ts'

const servers: AppServer[] = [], dirs: string[] = []
afterEach(() => {
  while (servers.length) servers.pop()!.close()
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('联机保存冲突', () => {
  it('服务器自己推进（AI/自动结算）后，玩家基于旧版本保存仍然成功；另一台设备真正覆盖才 409', async () => {
    let clock = 1_000_000
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-conflict-'))
    dirs.push(dataDir)
    const app = createAppServer({
      dataDir,
      staticDir: path.resolve('dist'),
      tickMs: 0,
      now: () => clock,
    })
    servers.push(app)
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
    const registered = await (await fetch(`${base}/api/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'save_probe', password: 'secret123' }),
    })).json() as { token: string; revision: number }
    const auth = { Authorization: `Bearer ${registered.token}`, 'Content-Type': 'application/json' }
    const originalBase = registered.revision
    const originalGame = (await (await fetch(`${base}/api/game`, { headers: auth })).json() as { game: GameState }).game

    // 服务器推进到下一轮，自动结算并 bump revision
    clock += 2 * 24 * 60 * 60 * 1000
    const advanced = await (await fetch(`${base}/api/game`, { headers: auth })).json() as { game: GameState; revision: number }
    expect(advanced.revision).toBeGreaterThan(originalBase)

    // 玩家基于注册时的旧版本保存（比如本机一直开着页面）
    const local = structuredClone(originalGame)
    local.ui = { screen: 'club' }
    const saved = await fetch(`${base}/api/game`, { method: 'PUT', headers: auth, body: JSON.stringify({ game: local, baseRevision: originalBase }) })
    expect(saved.status).toBe(200)
    await saved.json()

    // 另一台设备用更老的 baseRevision 覆盖：应该 409
    const stale = await fetch(`${base}/api/game`, { method: 'PUT', headers: auth, body: JSON.stringify({ game: local, baseRevision: originalBase }) })
    expect(stale.status).toBe(409)
    // 用最新版本再存一次是正常流程
    const fresh = await (await fetch(`${base}/api/game`, { headers: auth })).json() as { game: GameState; revision: number }
    const retry = await fetch(`${base}/api/game`, { method: 'PUT', headers: auth, body: JSON.stringify({ game: fresh.game, baseRevision: fresh.revision }) })
    expect(retry.status).toBe(200)
  })
})
