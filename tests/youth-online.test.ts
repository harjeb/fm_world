import { afterEach, beforeAll, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { createAppServer, type AppServer } from '../server/app.ts'
import { loadPveContent } from '../src/game/pve-content.ts'
import type { GameState } from '../src/game/types.ts'

beforeAll(loadPveContent)
const apps: AppServer[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.shutdown()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

it('authoritative academy actions, concurrent promotion, stale browser saves and durable restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-youth-'))
  dirs.push(dir)
  const now = Date.UTC(2026, 10, 18, 1)
  let app = createAppServer({ dataDir: dir, tickMs: 0, now: () => now })
  apps.push(app)
  const listen = async () => {
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
  }
  let base = await listen()
  const registration = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'youth-coach', password: 'secret123' }) })
  expect(registration.status).toBe(201)
  const { token } = await registration.json() as { token: string }
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const get = async () => await (await fetch(`${base}/api/game`, { headers })).json() as { game: GameState; revision: number }
  const post = (url: string, body: unknown) => fetch(`${base}${url}`, { method: 'POST', headers, body: JSON.stringify(body) })
  const save = (game: GameState, revision: number) => fetch(`${base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game, baseRevision: revision }) })
  let state = await get()
  expect(state.game.youth?.members).toHaveLength(6)
  const ids = state.game.youth!.members.map(m => m.player.id)
  const balance = state.game.economy!.balance
  const youth = (body: object, revision = state.revision) => post('/api/youth/action', { ...body, baseRevision: revision })
  expect((await youth({ action: 'plan', playerId: ids[1], plan: { position: 'DM', focus: 'passing' } })).status).toBe(200)
  state = await get()
  expect(state.game.youth!.members[1].plan).toEqual({ position: 'DM', focus: 'passing' })
  expect((await youth({ action: 'call_up', playerId: ids[1] })).status).toBe(200)
  state = await get()
  expect(state.game.roster.find(p => p.id === ids[1])?.youthOrigin).toBeTruthy()
  expect((await post('/api/training/start', { playerId: ids[1], bookKeys: [], points: 0 })).status).toBe(400)
  state = await get()
  const original = structuredClone(state.game.roster.find(p => p.id === ids[1])!)
  state.game.youth!.members[1].ceiling = 99999
  state.game.roster.find(p => p.id === ids[1])!.baseAttrs.passing = 9999
  state.game.roster.find(p => p.id === ids[1])!.attrs.passing = 9999
  delete state.game.roster.find(p => p.id === ids[1])!.youthOrigin
  expect((await save(state.game, state.revision)).status).toBe(200)
  state = await get()
  expect(state.game.roster.find(p => p.id === ids[1])!.baseAttrs).toEqual(original.baseAttrs)
  expect(state.game.roster.find(p => p.id === ids[1])!.youthOrigin).toEqual(original.youthOrigin)
  expect(state.game.youth!.members[1].ceiling).toBeLessThanOrEqual(280)
  const forged = structuredClone(state.game)
  forged.roster.push(structuredClone(forged.youth!.members[2].player))
  expect((await save(forged, state.revision)).status).toBe(400)
  const stale = structuredClone(state)
  const concurrent = await Promise.all([
    youth({ action: 'promote', playerId: ids[1] }),
    youth({ action: 'promote', playerId: ids[1] }),
  ])
  expect(concurrent.map(r => r.status).sort()).toEqual([200, 409])
  state = await get()
  expect(state.game.youth?.members).toHaveLength(5)
  expect(state.game.roster.filter(p => p.id === ids[1])).toHaveLength(1)
  expect(state.game.roster.find(p => p.id === ids[1])!.youthOrigin?.promotedAt).toBe(now)
  expect(state.game.economy!.balance).toBe(balance)
  expect((await save(stale.game, stale.revision)).status).toBe(409)
  const db = new DatabaseSync(path.join(dir, 'accounts.sqlite'), { readOnly: true })
  const row = db.prepare('SELECT game_json FROM accounts WHERE username = ?').get('youth-coach') as { game_json: string }
  const stored = JSON.parse(row.game_json) as GameState
  expect(stored.youth?.members).toHaveLength(5)
  expect(stored.roster.find(p => p.id === ids[1])!.youthOrigin?.promotedAt).toBe(now)
  db.close()
  await app.shutdown()
  apps.pop()
  app = createAppServer({ dataDir: dir, tickMs: 0, now: () => now })
  apps.push(app)
  base = await listen()
  state = await get()
  expect(state.game.youth?.members).toHaveLength(5)
  expect(state.game.youth!.members.map(m => m.player.id)).toEqual(ids.filter(id => id !== ids[1]))
  expect((await youth({ action: 'promote', playerId: ids[1] })).status).toBe(400)
  expect((await post('/api/training/start', { playerId: ids[1], bookKeys: [], points: 0 })).status).toBe(200)
  state = await get()
  expect(state.game.training[ids[1]]).toBeTruthy()
  expect(state.game.training[ids[1]].candidate.baseAttrs).toEqual(original.baseAttrs)
})
