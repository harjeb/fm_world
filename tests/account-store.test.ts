import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ACCOUNT_DB_FILE, AccountStore, type Account } from '../server/account-store.ts'
import type { GameState } from '../src/game/types.ts'

const dirs: string[] = []
const stores: AccountStore[] = []
function directory(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-sqlite-'))
  dirs.push(dir)
  return dir
}
function open(dir = directory(), delay = 1000): AccountStore {
  const store = new AccountStore(dir, delay)
  stores.push(store)
  return store
}
function account(id = 'alice'): Account {
  return {
    id, username: id, salt: 'salt', passwordHash: 'hash', agentToken: `fm_${id}`,
    game: { clubName: '测试球队', roster: [] } as unknown as GameState,
    revision: 7, lastUserRevision: 5, appliedMatchIds: ['match-1'], offerKey: '1:2',
    createdAt: 100, updatedAt: 200,
  }
}
function inspect<T>(dir: string, run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path.join(dir, ACCOUNT_DB_FILE))
  try { return run(db) } finally { db.close() }
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('SQLite 账号存储', () => {
  it('完整迁移旧账号 / 会话；保留 JSON 且只导入一次', () => {
    const dir = directory()
    const original = account('教练甲')
    const accounts = JSON.stringify({ accounts: [original] }, null, 2)
    const sessions = JSON.stringify({ valid: original.id, orphan: 'deleted' })
    fs.writeFileSync(path.join(dir, 'accounts.json'), accounts)
    fs.writeFileSync(path.join(dir, 'sessions.json'), sessions)
    const store = open(dir)
    expect(store.accounts).toEqual([original])
    expect(store.sessions).toEqual({ valid: original.id })
    original.game.clubName = 'SQLite 中的新名字'
    original.revision++
    store.save(original)
    store.setSession('valid', null)
    store.setSession('new', original.id)
    store.close()
    expect(fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8')).toBe(accounts)
    expect(fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8')).toBe(sessions)
    const restarted = open(dir)
    expect(restarted.accounts).toEqual([original])
    expect(restarted.sessions).toEqual({ new: original.id })
    expect(inspect(dir, (db) => db.prepare('PRAGMA journal_mode').get())).toMatchObject({ journal_mode: 'wal' })
  })

  it('没有旧文件的新安装也有迁移标记，不导入后来出现的过期 JSON', () => {
    const dir = directory()
    open(dir).close()
    fs.writeFileSync(path.join(dir, 'accounts.json'), JSON.stringify({ accounts: [account()] }))
    expect(open(dir).accounts).toEqual([])
  })

  it('损坏的旧 JSON 让启动失败；事务回滚，修好后可以重新迁移', () => {
    const dir = directory()
    const legacy = path.join(dir, 'accounts.json')
    fs.writeFileSync(legacy, '{broken')
    expect(() => open(dir)).toThrow()
    fs.writeFileSync(legacy, JSON.stringify({ accounts: [account('Alice'), account('alice')] }))
    expect(() => open(dir)).toThrow(/UNIQUE/)
    expect(inspect(dir, (db) => db.prepare('SELECT count(*) AS n FROM accounts').get())).toMatchObject({ n: 0 })
    fs.writeFileSync(legacy, JSON.stringify({ accounts: [account()] }))
    expect(open(dir).accounts).toEqual([account()])
  })

  it('100 个账号中合并同账号多次保存，只写当前账号一次，其他账号完全不写', async () => {
    const dir = directory()
    const store = open(dir)
    const alice = account()
    const others = Array.from({ length: 99 }, (_, index) => account(`coach_${index}`))
    store.save(alice)
    for (const other of others) store.save(other)
    store.setSession('token', alice.id)
    store.flushSync()
    inspect(dir, (db) => db.exec(`CREATE TABLE audit (id TEXT);
      CREATE TRIGGER account_updates AFTER UPDATE ON accounts BEGIN INSERT INTO audit VALUES (new.id); END;`))
    for (let n = 0; n < 10; n++) {
      alice.game.clubName = `修改 ${n}`
      alice.revision++
      store.save(alice)
    }
    expect(inspect(dir, (db) => db.prepare('SELECT * FROM audit').all())).toEqual([])
    await store.flush()
    expect(inspect(dir, (db) => db.prepare('SELECT * FROM audit').all())).toEqual([{ id: alice.id }])
    store.close()
    const next = open(dir)
    expect(next.accounts).toEqual([alice, ...others])
    expect(next.sessions).toEqual({ token: alice.id })
    expect(fs.existsSync(path.join(dir, 'accounts.json'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'sessions.json'))).toBe(false)
  })

  it('定时器自动后台写入，不需要手动 flush', async () => {
    const dir = directory()
    const store = open(dir, 20)
    store.save(account())
    await expect.poll(() => inspect(dir, (db) => db.prepare('SELECT revision FROM accounts').get()), { timeout: 3000 })
      .toMatchObject({ revision: 7 })
  })

  it('后台写入期间的新保存不会丢失，并支持并发 flush', async () => {
    const dir = directory()
    const store = open(dir)
    const alice = account()
    store.save(alice)
    const first = store.flush()
    alice.game.clubName = '后台写入期间又修改'
    alice.revision++
    store.save(alice)
    store.setSession('session', alice.id)
    await Promise.all([first, store.flush()])
    store.close()
    const next = open(dir)
    expect(next.accounts).toEqual([alice])
    expect(next.sessions).toEqual({ session: alice.id })
  })

  it('同步关闭等待在途事务，再写最后一份状态；允许重复关闭和立即重启', async () => {
    const dir = directory()
    const store = open(dir)
    const alice = account()
    store.save(alice)
    const inFlight = store.flush()
    alice.game.clubName = '关闭前的最后修改'
    alice.revision++
    store.save(alice)
    store.setSession('session', alice.id)
    store.close()
    store.close()
    await inFlight
    const next = open(dir)
    expect(next.accounts).toEqual([alice])
    expect(next.sessions).toEqual({ session: alice.id })
    expect(() => store.save(alice)).toThrow(/已关闭/)
  })

  it('失败的异步事务保留脏状态，修复原因后能重试；账号和会话原子提交', async () => {
    const dir = directory()
    const store = open(dir)
    const alice = account()
    const bob = account('bob')
    store.save(alice)
    store.save(bob)
    await store.flush()
    bob.username = 'ALICE'
    store.save(bob)
    store.setSession('new', alice.id)
    await expect(store.flush()).rejects.toThrow(/UNIQUE/)
    expect(inspect(dir, (db) => db.prepare('SELECT * FROM sessions').all())).toEqual([])
    bob.username = 'Robert'
    await store.flush()
    store.close()
    const next = open(dir)
    expect(next.accounts).toEqual([alice, bob])
    expect(next.sessions).toEqual({ new: alice.id })
  })

  it('会话删除与 Agent 令牌吊销在重启后仍生效，即使 revision 没变', async () => {
    const dir = directory()
    const store = open(dir)
    const alice = account()
    store.save(alice)
    store.setSession('logged-out', alice.id)
    await store.flush()
    delete alice.agentToken
    store.save(alice)
    store.setSession('logged-out', null)
    store.setSession('still-in', alice.id)
    store.close()
    const next = open(dir)
    expect(next.accounts[0].agentToken).toBeUndefined()
    expect(next.accounts[0].revision).toBe(7)
    expect(next.sessions).toEqual({ 'still-in': alice.id })
  })
})
