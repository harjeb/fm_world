import { afterEach, beforeAll, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { loadPveContent } from '../src/game/pve-content.ts'
import type { GameState } from '../src/game/types.ts'
import { deleteScoutReport, startScouting } from '../src/game/scouting.ts'

beforeAll(loadPveContent)
let app: AppServer | undefined
let dir = ''
afterEach(async () => { if (app) await app.shutdown(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); app = undefined; dir = '' })

it('only deletes completed owned reports, serializes concurrent deletions and permits new commissions without refund', async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-scout-delete-'))
  let clock = 1_700_000_000_000
  app = createAppServer({ dataDir: dir, tickMs: 0, now: () => clock })
  await new Promise<void>(resolve => app!.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
  const register = async (username: string) => (await (await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'secret123' }) })).json() as { token: string }).token
  const a = await register('delete_one'), b = await register('delete_two')
  const headers = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })
  const get = async (token: string) => await (await fetch(`${base}/api/game`, { headers: headers(token) })).json() as { game: GameState; revision: number }
  const post = (token: string, endpoint: string, body: unknown) => fetch(`${base}/api/scouting/${endpoint}`, { method: 'POST', headers: headers(token), body: JSON.stringify(body) })
  const initial = await get(a), other = await get(b)
  const clubId = other.game.world!.clubs.find(c => c.id === 'player')!.squadKey!
  const target = { source: 'club', clubId, playerId: other.game.roster[0].id, level: 5 }
  expect((await post(a, 'start', target)).status).toBe(200)
  const pending = await get(a), report = pending.game.scoutReports![0]
  expect((await post(a, 'delete', { reportId: report.id, baseRevision: pending.revision })).status).toBe(400)
  expect((await post(b, 'delete', { reportId: report.id, baseRevision: other.revision })).status).toBe(400)
  const ownClub = initial.game.world!.clubs.find(c => c.id === 'player')!.squadKey!
  expect((await post(b, 'start', { source: 'club', clubId: ownClub, playerId: initial.game.roster[0].id, level: 5 })).status).toBe(200)
  const bPending = await get(b)
  expect(bPending.game.scoutReports![0].id).not.toBe(report.id)
  expect((await post(b, 'delete', { reportId: report.id, baseRevision: bPending.revision })).status).toBe(400)
  expect((await get(b)).game.scoutReports).toHaveLength(1)
  expect((await fetch(`${base}/api/scouting/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401)
  clock = report.readyAt
  const ready = await get(a)
  const attempts = await Promise.all([post(a, 'delete', { reportId: report.id, baseRevision: ready.revision }), post(a, 'delete', { reportId: report.id, baseRevision: ready.revision })])
  expect(attempts.map(r => r.status).sort()).toEqual([200, 409])
  const deleted = await get(a)
  expect(deleted.game.scoutReports).toHaveLength(0)
  expect(deleted.game.economy!.balance).toBe(initial.game.economy!.balance - 20000)
  expect((await post(a, 'delete', { reportId: report.id, baseRevision: ready.revision })).status).toBe(409)
  expect((await post(a, 'start', target)).status).toBe(200)
  const again = await get(a)
  expect(again.game.scoutReports![0].id).not.toBe(report.id)
  expect(again.game.economy!.balance).toBe(initial.game.economy!.balance - 40000)

  // Multiple deletions and starts at the same timestamp must never reuse an ID.
  const local = structuredClone(again.game)
  const player = other.game.roster[0]
  local.scoutReports = []
  const ids = new Set<string>()
  for (let i = 0; i < 4; i++) {
    const result = startScouting(local, player, { source: 'club', clubId }, 1, clock)
    expect(result.ok).toBe(true)
    ids.add(result.report!.id)
    expect(deleteScoutReport(local, result.report!.id, result.report!.readyAt).ok).toBe(true)
  }
  expect(ids.size).toBe(4)
}, 120_000)
