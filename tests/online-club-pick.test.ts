import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { applyAgentAction } from '../server/agent.ts'
import { createWorldGame } from '../src/game/world.ts'
import { ROUND_MS } from '../src/game/calendar.ts'
import type { GameState } from '../src/game/types.ts'

const servers: AppServer[] = []
afterEach(() => { while (servers.length) servers.pop()!.close() })

async function start() {
  const app = createAppServer({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'fm-club-pick-')), staticDir: path.resolve('dist'), tickMs: 0 })
  servers.push(app)
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })

describe('联机注册后选队', () => {
  it('新账号可以换成另一支空球队，共享世界归属和账号存档一起更新', async () => {
    const base = await start()
    const registered = await (await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'picker', password: 'secret123' }) })).json() as { token: string; game: GameState }
    const world = await (await fetch(`${base}/api/world/teams`, { headers: auth(registered.token) })).json() as any
    const free = world.clubs.filter((club: any) => club.tier === 'division2' && !club.managed)
    expect(free.length).toBeGreaterThan(0)
    const target = free[0]
    const picked = await fetch(`${base}/api/world/choose-club`, { method: 'POST', headers: auth(registered.token), body: JSON.stringify({ clubId: target.id }) })
    expect(picked.status).toBe(200)
    const body = await picked.json() as { game: GameState }
    expect(body.game.clubName).toBe(target.name)
    expect(body.game.season.round).toBe(1)
    const after = await (await fetch(`${base}/api/world/teams`, { headers: auth(registered.token) })).json() as any
    expect(after.ownClubId).toBe(target.id)
    // 踢过联赛之后不能换队
    const current = await (await fetch(`${base}/api/game`, { headers: auth(registered.token) })).json() as { game: GameState; revision: number }
    current.game.season.fixtures.find((fixture) => fixture.isPlayer)!.played = true
    const saved = await fetch(`${base}/api/game`, { method: 'PUT', headers: auth(registered.token), body: JSON.stringify({ game: current.game, baseRevision: current.revision }) })
    expect(saved.status).toBe(200)
    const again = await fetch(`${base}/api/world/choose-club`, { method: 'POST', headers: auth(registered.token), body: JSON.stringify({ clubId: free[1].id }) })
    expect(again.status).toBe(400)
  })

  it('联机 start_league 必须等到本轮开赛时间，不能提前开打', () => {
    const now = 1_000_000_000
    const game = createWorldGame(2024, undefined, undefined, now)
    game.season.startedAt = now
    game.season.round = 2
    const early = applyAgentAction(game, { action: 'start_league' }, now)
    expect(early.ok).toBe(false)
    expect(early.error).toContain('还没开始')
    // 第二轮开球时间到了就能开打
    game.season.startedAt = now - ROUND_MS
    const due = applyAgentAction(game, { action: 'start_league' }, now)
    expect(due.ok, due.error).toBe(true)
  })
})
