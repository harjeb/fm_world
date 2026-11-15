import { afterEach, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import type { Player } from '../src/game/types.ts'

let app: AppServer | undefined
let dir = ''
afterEach(async () => { if (app) await app.shutdown(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); app = undefined; dir = '' })

it('online market reports use the transferable base build instead of an equipped card', async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-scout-base-'))
  let clock = 1_700_000_000_000
  let base = ''
  const boot = async () => {
    app = createAppServer({ dataDir: dir, tickMs: 0, now: () => clock })
    await new Promise<void>(resolve => app!.server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
  }
  await boot()
  const register = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'marketbase', password: 'secret123' }) })
  const { token } = await register.json() as { token: string }
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const market = await (await fetch(`${base}/api/market`)).json() as { pool: Player[] }
  const target = market.pool.find(player => player.positions.GK === 0)!
  expect(target).toBeDefined()
  await app!.shutdown(); app = undefined

  const worldPath = path.join(dir, 'world.json')
  const world = JSON.parse(fs.readFileSync(worldPath, 'utf8')) as { freeStars: Player[] }
  const player = world.freeStars.find(item => item.id === target.id)!
  player.version = 3
  player.equippedCardId = 'old-equipped-card'
  player.attrs.passing = Math.min(1500, player.baseAttrs.passing + 300)
  const originalPassing = player.baseAttrs.passing
  expect(player.attrs.passing).not.toBe(originalPassing)
  fs.writeFileSync(worldPath, JSON.stringify(world))

  await boot()
  const result = await fetch(`${base}/api/scouting/start`, { method: 'POST', headers, body: JSON.stringify({ source: 'market', playerId: target.id, level: 5 }) })
  expect(result.status).toBe(200)
  const pending = await result.json() as { game: { scoutReports: { readyAt: number }[] } }
  clock = pending.game.scoutReports[0].readyAt
  const state = await (await fetch(`${base}/api/game`, { headers })).json() as { game: { scoutReports: { snapshotLabel: string; estimatedAttrs: { passing: number } }[] } }
  expect(state.game.scoutReports[0].snapshotLabel).toBe('原始版本')
  expect(state.game.scoutReports[0].estimatedAttrs.passing).toBe(originalPassing)
}, 120_000)
