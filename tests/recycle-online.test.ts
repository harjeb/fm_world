import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { createAppServer, type AppServer } from '../server/app.ts'
import { AccountStore } from '../server/account-store.ts'
import { loadPveContent } from '../src/game/pve-content.ts'
import { startTrainingWithSupport } from '../src/game/actions.ts'
import type { GameState } from '../src/game/types.ts'

beforeAll(loadPveContent)
const servers: AppServer[] = []
const dirs: string[] = []
afterEach(() => {
  for (const app of servers.splice(0)) app.close()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

it('recycles atomically, protects balance and bonuses across saves and restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-recycle-'))
  dirs.push(dir)
  let app = createAppServer({ dataDir: dir, tickMs: 0, now: () => Date.UTC(2026, 10, 14, 1) })
  servers.push(app)
  const listen = async () => {
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
  }
  let base = await listen()
  const registration = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'recycle-user', password: 'secret123' }) })
  expect(registration.status).toBe(201)
  const { token } = await registration.json() as { token: string }
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const get = async () => await (await fetch(`${base}/api/game`, { headers })).json() as { game: GameState; revision: number }
  const save = (game: GameState, revision: number) => fetch(`${base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game, baseRevision: revision }) })
  const post = (url: string, body: unknown) => fetch(`${base}${url}`, { method: 'POST', headers, body: JSON.stringify(body) })
  let state = await get()
  const player = state.game.roster[0]
  const template = { id: 'template', playerId: player.id, playerName: player.name, serial: 1, version: 1, routeId: null, createdAt: Date.now(), attrs: player.attrs, positions: player.positions, personality: player.personality, skills: player.skills }
  const ids = Array.from({ length: 35 }, (_, i) => `test-extra-${i}`)
  state.game.cards ??= []
  state.game.cards.push(...ids.map(id => ({ ...structuredClone(template), id, recycleLocked: false })))
  state.game.trainingPoints = 9999
  expect((await save(state.game, state.revision)).status).toBe(200)
  state = await get()
  expect(state.game.trainingPoints ?? 0).toBe(0)
  const playerId = state.game.roster[0].id
  const localId = state.game.roster[1].id
  expect(startTrainingWithSupport(state.game, localId, 1234, [], 0).ok).toBe(true)
  state.game.training[localId].qualityBonusPoints = 30
  expect((await save(state.game, state.revision)).status).toBe(200)
  state = await get()
  expect(state.game.training[localId].qualityBonusPoints).toBe(0)
  expect((await post('/api/training/start', { playerId, bookKeys: [], points: 10 })).status).toBe(400)
  expect((await post('/api/training/start', { playerId, bookKeys: [], points: 5 })).status).toBe(400)
  const oldPreview = state.revision
  expect((await post('/api/cards/lock', { cardId: ids[0], locked: true })).status).toBe(200)
  expect((await post('/api/cards/recycle', { cardIds: [ids[1]], baseRevision: oldPreview })).status).toBe(409)
  state = await get()
  const originalPassing = state.game.cards!.find(c => c.id === ids[1])!.attrs.passing
  state.game.cards!.find(c => c.id === ids[0])!.recycleLocked = false
  state.game.cards!.find(c => c.id === ids[1])!.attrs.passing = 999999
  expect((await save(state.game, state.revision)).status).toBe(200)
  state = await get()
  expect(state.game.cards!.find(c => c.id === ids[1])!.attrs.passing).toBe(originalPassing)
  expect((await post('/api/cards/recycle', { cardIds: [ids[0], ids[1]], baseRevision: state.revision })).status).toBe(400)
  expect((await post('/api/cards/lock', { cardId: ids[0], locked: false })).status).toBe(200)
  state = await get()
  const both = await Promise.all([post('/api/cards/recycle', { cardIds: ids, baseRevision: state.revision }), post('/api/cards/recycle', { cardIds: ids, baseRevision: state.revision })])
  expect(both.map(r => r.status).sort()).toEqual([200, 409])
  state = await get()
  expect(state.game.trainingPoints).toBeGreaterThanOrEqual(10)
  const balance = state.game.trainingPoints!
  // 成功响应前必须已经落盘，而不是仅排进一秒后的合并写入队列。
  const sqlite = new DatabaseSync(path.join(dir, 'accounts.sqlite'), { readOnly: true })
  const stored = sqlite.prepare('SELECT game_json FROM accounts WHERE username = ?').get('recycle-user') as { game_json: string }
  const persisted = JSON.parse(stored.game_json) as GameState & { recycledCardIds: string[] }
  expect(persisted.trainingPoints).toBe(balance)
  expect(persisted.cards?.some(card => ids.includes(card.id))).toBe(false)
  expect(persisted.recycledCardIds).toEqual(expect.arrayContaining(ids))
  sqlite.close()
  const stale = structuredClone(state.game)
  stale.cards!.push({ ...structuredClone(template), id: ids[0] })
  expect((await save(stale, state.revision)).status).toBe(409)
  expect((await post('/api/training/start', { playerId, bookKeys: ['invalid'], points: 10 })).status).toBe(400)
  expect((await post('/api/training/start', { playerId, bookKeys: [], points: 10 })).status).toBe(200)
  state = await get()
  expect(state.game.trainingPoints).toBe(balance - 10)
  expect(state.game.training[playerId].qualityBonusPoints).toBe(10)
  state.game.training[playerId].qualityBonusPoints = 30
  state.game.trainingPoints = 10000
  expect((await save(state.game, state.revision)).status).toBe(200)
  state = await get()
  expect(state.game.trainingPoints).toBe(balance - 10)
  expect(state.game.training[playerId].qualityBonusPoints).toBe(10)
  state.game.training[playerId].seed++
  state.game.training[playerId].qualityBonusPoints = 30
  expect((await save(state.game, state.revision)).status).toBe(200)
  state = await get()
  expect(state.game.training[playerId].qualityBonusPoints).toBe(0)
  await app.flush()
  await app.shutdown()
  servers.pop()
  app = createAppServer({ dataDir: dir, tickMs: 0, now: () => Date.UTC(2026, 10, 14, 1) })
  servers.push(app)
  base = await listen()
  state = await get()
  expect(state.game.trainingPoints).toBe(balance - 10)
  stale.trainingPoints = 9999
  expect((await save(stale, state.revision)).status).toBe(409)
  expect((await post('/api/cards/recycle', { cardIds: [ids[0]], baseRevision: state.revision })).status).toBe(400)
  expect((await save(state.game, state.revision)).status).toBe(200)

  // 写入失败期间不把未确认的内存账本从 GET 泄露成已完成交易；修复后重试落盘。
  state = await get()
  state.game.cards!.push({ ...structuredClone(template), id: 'failure-card' })
  expect((await save(state.game, state.revision)).status).toBe(200)
  state = await get()
  const beforeFailedCommit = state.game.trainingPoints!
  const originalFlush = AccountStore.prototype.flush
  let failWrites = true
  const spy = vi.spyOn(AccountStore.prototype, 'flush').mockImplementation(function (this: AccountStore) {
    return failWrites ? Promise.reject(new Error('simulated SQLite failure')) : originalFlush.call(this)
  })
  try {
    const failed = await post('/api/cards/recycle', { cardIds: ['failure-card'], baseRevision: state.revision })
    expect(failed.status).toBe(503)
    expect((await fetch(`${base}/api/game`, { headers })).status).toBe(503)
    failWrites = false
    state = await get()
    expect(state.game.trainingPoints).toBeGreaterThan(beforeFailedCommit)
    expect(state.game.cards!.some(card => card.id === 'failure-card')).toBe(false)
    const db = new DatabaseSync(path.join(dir, 'accounts.sqlite'), { readOnly: true })
    const row = db.prepare('SELECT game_json FROM accounts WHERE username = ?').get('recycle-user') as { game_json: string }
    expect((JSON.parse(row.game_json) as GameState).trainingPoints).toBe(state.game.trainingPoints)
    db.close()
  } finally {
    spy.mockRestore()
  }
}, 120_000)
