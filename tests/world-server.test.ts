import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { ROUND_MS } from '../src/game/calendar.ts'

const servers: AppServer[] = []
afterEach(() => {
  while (servers.length) servers.pop()!.close()
})

async function start(clock?: () => number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-world-server-'))
  const app = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), tickMs: 0, ...(clock ? { now: clock } : {}) })
  servers.push(app)
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const port = (app.server.address() as AddressInfo).port
  return { base: `http://127.0.0.1:${port}` }
}

async function register(base: string, username: string) {
  const response = await fetch(`${base}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'secret123' }),
  })
  expect(response.status).toBe(201)
  return await response.json() as { game: any }
}

describe('服务器共享世界', () => {
  it('同一世界种子/开赛时间，两名新玩家分别接管不同的二级球队', async () => {
    const { base } = await start()
    const a = await register(base, 'world_a')
    const b = await register(base, 'world_b')
    expect(a.game.seed).toBe(b.game.seed)
    expect(a.game.season.startedAt).toBe(b.game.season.startedAt)
    expect(a.game.clubName).not.toBe(b.game.clubName)
    expect(a.game.world.clubs.find((club: any) => club.id === 'player')?.tier).toBe('division2')
    expect(b.game.world.clubs.find((club: any) => club.id === 'player')?.tier).toBe('division2')
    const world = await (await fetch(`${base}/api/world`)).json() as any
    expect(world.clubs).toHaveLength(80)
    expect(Object.keys(world.owners)).toHaveLength(2)
    // 席位统计：80 支球队，2 人已占，且两人拿到的是不同球队
    expect(world.slots).toEqual({ total: 80, taken: 2, free: 78 })
    expect(new Set(Object.keys(world.owners)).size).toBe(2)
    expect(world.round).toBeGreaterThanOrEqual(1)
  })

  it('新玩家在共享世界当前时间加入，而不是从第 1 轮重新开始', async () => {
    let now = Date.now()
    const { base } = await start(() => now)
    const first = await register(base, 'world_early')
    expect(first.game.season.round).toBe(1)
    now += ROUND_MS + 2 * 60 * 60 * 1000 // 一轮（现实 24 小时）多一点
    const late = await register(base, 'world_late')
    expect(late.game.season.round).toBeGreaterThanOrEqual(2)
    expect(late.game.season.fixtures.some((fixture: any) => fixture.played)).toBe(true)
    expect(late.game.world.clubs.find((club: any) => club.id === 'player')?.tier).toBe('division2')
  })
})
