import { afterEach, beforeAll, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { loadPveContent } from '../src/game/pve-content.ts'
import { isOnMarketToday } from '../src/game/market-window.ts'
import type { Player } from '../src/game/types.ts'
import type { GameState } from '../src/game/types.ts'

beforeAll(loadPveContent)
let app: AppServer | undefined
let dir = ''
afterEach(async () => { if (app) await app.shutdown(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); app = undefined; dir = '' })

it('commits private reports and fees atomically, rejects forged targets and stale saves, and survives restart', async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-scout-'))
  let clock = 1_700_000_000_000
  let base = ''
  const boot = async () => {
    app = createAppServer({ dataDir: dir, tickMs: 0, now: () => clock })
    await new Promise<void>(resolve => app!.server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
  }
  await boot()
  const register = async (username: string) => {
    const r = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'secret123' }) })
    expect(r.status).toBe(201)
    return (await r.json() as { token: string }).token
  }
  const a = await register('scout_one'), b = await register('scout_two')
  const headers = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })
  const get = async (token: string) => await (await fetch(`${base}/api/game`, { headers: headers(token) })).json() as { game: GameState; revision: number }
  const post = (token: string, body: unknown) => fetch(`${base}/api/scouting/start`, { method: 'POST', headers: headers(token), body: JSON.stringify(body) })
  const put = (token: string, state: {game: GameState; revision: number}) => fetch(`${base}/api/game`, { method: 'PUT', headers: headers(token), body: JSON.stringify({ game: state.game, baseRevision: state.revision }) })
  const old = await get(a), other = await get(b)
  const clubId = other.game.world!.clubs.find(c => c.id === 'player')!.squadKey!
  const target = { source: 'club', clubId, playerId: other.game.roster[0].id, level: 5 }
  expect((await post(a, { ...target, playerId: 'forged' })).status).toBe(400)
  expect((await post(a, { ...target, clubId: undefined })).status).toBe(400)
  expect((await post(a, { ...target, source: 'transfer' })).status).toBe(400)
  expect((await post(a, { ...target, source: 'market', playerId: 'forged' })).status).toBe(400)
  const results = await Promise.all([post(a, target), post(a, target)])
  expect(results.map(r => r.status).sort()).toEqual([200, 400])
  const success = await results.find(r => r.status === 200)!.json() as { game: GameState; report?: unknown }
  expect(success.report).toBeUndefined()
  const pending = success.game.scoutReports![0]
  const reports = async (token?: string) => fetch(`${base}/api/scouting/reports`, { headers: token ? headers(token) : {} })
  expect((await reports()).status).toBe(401)
  const projection = await (await reports(a)).json() as { reports: unknown[]; serverTime: number; game?: unknown }
  expect(projection.game).toBeUndefined(); expect(projection.serverTime).toBe(clock)
  expect(projection.reports).toEqual([pending])
  expect((await (await reports(b)).json() as { reports: unknown[] }).reports).toEqual([])
  expect(pending).not.toHaveProperty('estimatedAttrs')
  expect(pending).not.toHaveProperty('positions')
  expect((await get(b)).game.scoutReports ?? []).toHaveLength(0)
  const offersResponse = await fetch(`${base}/api/transfer/ai-offers`, { headers: headers(b) })
  const offers = await offersResponse.json() as { offers: { teamId: string; player: { id: string } }[] }
  const offer = offers.offers[0]
  expect(offer).toBeDefined()
  expect((await post(b, { source: 'transfer', clubId: offer.teamId, playerId: offer.player.id, level: 1 })).status).toBe(200)
  const marketResponse = await fetch(`${base}/api/market`, { headers: headers(b) })
  const market = await marketResponse.json() as { pool: Player[] }
  const marketPlayer = market.pool.find(p => isOnMarketToday(other.game, p, clock))
  expect(marketPlayer).toBeDefined()
  expect((await post(b, { source: 'market', playerId: marketPlayer!.id, level: 1 })).status).toBe(200)
  expect((await put(a, old)).status).toBe(409)
  expect((await put(a, { ...old, revision: Number.MAX_SAFE_INTEGER })).status).toBe(409)
  let current = await get(a)
  expect(current.game.economy!.balance).toBe(old.game.economy!.balance - 20000)
  current.game.scoutReports = [{ ...pending, readyAt: 0, estimatedAttrs: other.game.roster[0].attrs } as typeof pending]
  expect((await put(a, current)).status).toBe(200)
  current = await get(a)
  expect(current.game.scoutReports![0].readyAt).toBe(pending.readyAt)
  expect(current.game.scoutReports![0]).not.toHaveProperty('estimatedAttrs')
  await app!.shutdown(); app = undefined
  await boot()
  expect((await get(a)).game.scoutReports![0]).not.toHaveProperty('estimatedAttrs')
  clock = pending.readyAt
  const finished = await get(a)
  expect((await (await reports(a)).json() as { reports: unknown[] }).reports[0]).toHaveProperty('estimatedAttrs')
  expect(finished.game.scoutReports![0]).toHaveProperty('estimatedAttrs')
  expect(finished.game.scoutReports![0]).toHaveProperty('positions')
  await app!.shutdown(); app = undefined
  await boot()
  expect((await get(a)).game.scoutReports![0]).toEqual(finished.game.scoutReports![0])
}, 120_000)
