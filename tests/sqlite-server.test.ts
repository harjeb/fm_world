import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { createAppServer, type AppServer } from '../server/app.ts'
import { ACCOUNT_DB_FILE, AccountStore } from '../server/account-store.ts'
import type { GameState } from '../src/game/types.ts'
import { readStoredAccounts } from './account-storage-helpers.ts'

const servers: AppServer[] = []
const dirs: string[] = []
const clock = () => Date.UTC(2026, 10, 9, 8, 15)
function directory(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-sqlite-api-'))
  dirs.push(dir)
  return dir
}
async function start(dir = directory()) {
  const app = createAppServer({ dataDir: dir, tickMs: 0, now: clock })
  servers.push(app)
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
  return { app, dir, base: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}` }
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })
async function register(base: string, username: string) {
  const response = await fetch(`${base}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'secret123' }),
  })
  expect(response.status).toBe(201)
  return response.json() as Promise<{ token: string; user: { id: string }; game: GameState; revision: number }>
}
afterEach(() => {
  for (const app of servers.splice(0)) app.close()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('SQLite 账号 HTTP 集成', () => {
  it('普通保存只更新本账号，会话退出和 Agent 吊销在重启后仍生效', async () => {
    const { app, base, dir } = await start()
    const alice = await register(base, 'Alice')
    const bob = await register(base, 'Bob')
    const tokenResponse = await fetch(`${base}/api/agent/token`, { method: 'POST', headers: auth(alice.token) })
    const { token: agentToken } = await tokenResponse.json() as { token: string }
    const db = new DatabaseSync(path.join(dir, ACCOUNT_DB_FILE))
    try {
      db.exec(`CREATE TABLE audit (id TEXT);
        CREATE TRIGGER account_updates AFTER UPDATE ON accounts BEGIN INSERT INTO audit VALUES (new.id); END;`)
      const current = await (await fetch(`${base}/api/game`, { headers: auth(alice.token) })).json() as { game: GameState; revision: number }
      current.game.lineup.tactics.tempo = 'slow'
      const saved = await fetch(`${base}/api/game`, {
        method: 'PUT', headers: auth(alice.token), body: JSON.stringify({ game: current.game, baseRevision: current.revision }),
      })
      expect(saved.status).toBe(200)
      await app.flush()
      expect(db.prepare('SELECT id FROM audit').all()).toEqual([{ id: alice.user.id }])
      expect(fs.existsSync(path.join(dir, 'accounts.json'))).toBe(false)
      expect(fs.existsSync(path.join(dir, 'sessions.json'))).toBe(false)
    } finally { db.close() }
    expect((await fetch(`${base}/api/agent/revoke`, { method: 'POST', headers: auth(alice.token) })).status).toBe(200)
    expect((await fetch(`${base}/api/logout`, { method: 'POST', headers: auth(alice.token) })).status).toBe(200)
    await app.shutdown()
    const next = await start(dir)
    expect((await fetch(`${next.base}/api/me`, { headers: auth(alice.token) })).status).toBe(401)
    expect((await fetch(`${next.base}/api/agent/state`, { headers: auth(agentToken) })).status).toBe(401)
    expect((await fetch(`${next.base}/api/me`, { headers: auth(bob.token) })).status).toBe(200)
    const login = await fetch(`${next.base}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'aLiCe', password: 'secret123' }),
    })
    expect(login.status).toBe(200)
    expect((await login.json() as { game: GameState }).game.lineup.tactics.tempo).toBe('slow')
  })

  it('旧 JSON 迁移后保留密码、浏览器会话、Agent 令牌、版本和游戏存档', async () => {
    const first = await start()
    const alice = await register(first.base, 'legacy_coach')
    const { token: agentToken } = await (await fetch(`${first.base}/api/agent/token`, { method: 'POST', headers: auth(alice.token) })).json() as { token: string }
    await first.app.shutdown()
    const source = new AccountStore(first.dir)
    const accounts = JSON.stringify({ accounts: source.accounts })
    const sessions = JSON.stringify(source.sessions)
    source.close()
    const legacy = directory()
    fs.copyFileSync(path.join(first.dir, 'world.json'), path.join(legacy, 'world.json'))
    fs.writeFileSync(path.join(legacy, 'accounts.json'), accounts)
    fs.writeFileSync(path.join(legacy, 'sessions.json'), sessions)
    const migrated = await start(legacy)
    expect(migrated.app.accountCount()).toBe(1)
    const saved = await (await fetch(`${migrated.base}/api/game`, { headers: auth(alice.token) })).json() as { game: GameState; revision: number }
    expect(saved.game.roster).toEqual(alice.game.roster)
    expect(saved.revision).toBeGreaterThanOrEqual(alice.revision)
    expect((await fetch(`${migrated.base}/api/agent/state`, { headers: auth(agentToken) })).status).toBe(200)
    const login = await fetch(`${migrated.base}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'legacy_coach', password: 'secret123' }),
    })
    expect(login.status).toBe(200)
    await migrated.app.shutdown()
    expect(fs.readFileSync(path.join(legacy, 'accounts.json'), 'utf8')).toBe(accounts)
    expect(fs.readFileSync(path.join(legacy, 'sessions.json'), 'utf8')).toBe(sessions)
  })

  it('优雅退出先排空正在上传的存档，再强制落盘', async () => {
    const { app, base, dir } = await start()
    const alice = await register(base, 'upload_coach')
    alice.game.lineup.tactics.tempo = 'slow'
    const body = JSON.stringify({ game: alice.game, baseRevision: alice.revision })
    const received = new Promise<void>(resolve => app.server.once('request', () => resolve()))
    let request!: http.ClientRequest
    const response = new Promise<number | undefined>((resolve, reject) => {
      request = http.request(`${base}/api/game`, {
        method: 'PUT', headers: { ...auth(alice.token), 'Content-Length': Buffer.byteLength(body) },
      }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
      request.on('error', reject)
    })
    request.write(body.slice(0, 100))
    await received
    const shutdown = app.shutdown()
    request.end(body.slice(100))
    expect(await response).toBe(200)
    await shutdown
    expect(readStoredAccounts(dir).accounts[0].game.lineup.tactics.tempo).toBe('slow')
  })
})
