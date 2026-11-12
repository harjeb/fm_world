import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Worker } from 'node:worker_threads'
import type { GameState } from '../src/game/types.ts'

export type Account = {
  id: string
  username: string
  salt: string
  passwordHash: string
  agentToken?: string
  game: GameState
  revision: number
  lastUserRevision?: number
  /** 与账号原子保存，重启不重复发钱 / 记战报。 */
  appliedMatchIds?: string[]
  /** 最近一次 AI 报价的“赛季:轮次”。 */
  offerKey?: string
  lastOnlineAt?: number
  aiTakeoverKey?: string
  createdAt: number
  updatedAt: number
}

export const ACCOUNT_DB_FILE = 'accounts.sqlite'
const ACCOUNT_SQL = `INSERT INTO accounts
  (id, username, username_key, salt, password_hash, agent_token, game_json, revision,
   last_user_revision, applied_match_ids, offer_key, last_online_at, ai_takeover_key, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    username=excluded.username, username_key=excluded.username_key, salt=excluded.salt,
    password_hash=excluded.password_hash, agent_token=excluded.agent_token,
    game_json=excluded.game_json, revision=excluded.revision,
    last_user_revision=excluded.last_user_revision, applied_match_ids=excluded.applied_match_ids,
    offer_key=excluded.offer_key, last_online_at=excluded.last_online_at, ai_takeover_key=excluded.ai_takeover_key,
    created_at=excluded.created_at, updated_at=excluded.updated_at`
const SESSION_SQL = 'INSERT INTO sessions (token, account_id) VALUES (?, ?) ON CONFLICT(token) DO UPDATE SET account_id=excluded.account_id'
const DELETE_SESSION_SQL = 'DELETE FROM sessions WHERE token = ?'
type Values = Array<string | number | null>
type Batch = {
  id: number
  accounts: Account[]
  sessions: Map<string, string | null>
  status: Int32Array
  done: Promise<void>
  complete: () => void
  error?: string
}

function accountValues(account: Account): Values {
  return [account.id, account.username, account.username.toLowerCase(), account.salt, account.passwordHash,
    account.agentToken ?? null, JSON.stringify(account.game), account.revision,
    account.lastUserRevision ?? null, account.appliedMatchIds ? JSON.stringify(account.appliedMatchIds) : null,
    account.offerKey ?? null, account.lastOnlineAt ?? null, account.aiTakeoverKey ?? null, account.createdAt, account.updatedAt]
}

function transaction(db: DatabaseSync, run: () => void): void {
  db.exec('BEGIN IMMEDIATE')
  try { run(); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error }
}

/**
 * 账号仍在内存中参与游戏逻辑；落盘只处理显式标脏的账号，不扫描 / 重写其他账号。
 * 固定窗口合并保存，SQLite 事务在 worker 中执行。flushSync 只用于停服 / 测试。
 */
export class AccountStore {
  readonly accounts: Account[]
  readonly sessions: Record<string, string>
  private readonly db: DatabaseSync
  private readonly filename: string
  private readonly dirty = new Map<string, Account>()
  private readonly dirtySessions = new Map<string, string | null>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private worker: Worker | null = null
  private inFlight: Batch | null = null
  private nextBatchId = 0
  private closed = false

  constructor(dataDir: string, private readonly saveDelayMs = 1000) {
    fs.mkdirSync(dataDir, { recursive: true })
    this.filename = path.join(dataDir, ACCOUNT_DB_FILE)
    this.db = new DatabaseSync(this.filename)
    try {
      fs.chmodSync(this.filename, 0o600)
      this.db.exec(`PRAGMA busy_timeout=5000;
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=FULL;
        PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          username_key TEXT NOT NULL UNIQUE,
          salt TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          agent_token TEXT UNIQUE,
          game_json TEXT NOT NULL,
          revision INTEGER NOT NULL,
          last_user_revision INTEGER,
          applied_match_ids TEXT,
          offer_key TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);`)
      const columns = new Set(this.db.prepare('PRAGMA table_info(accounts)').all().map((row) => row.name as string))
      if (!columns.has('last_online_at')) this.db.exec('ALTER TABLE accounts ADD COLUMN last_online_at INTEGER')
      if (!columns.has('ai_takeover_key')) this.db.exec('ALTER TABLE accounts ADD COLUMN ai_takeover_key TEXT')
      this.migrateLegacy(dataDir)
      this.accounts = this.db.prepare('SELECT * FROM accounts ORDER BY rowid').all().map((row) => ({
        id: row.id as string,
        username: row.username as string,
        salt: row.salt as string,
        passwordHash: row.password_hash as string,
        ...(row.agent_token !== null ? { agentToken: row.agent_token as string } : {}),
        game: JSON.parse(row.game_json as string) as GameState,
        revision: row.revision as number,
        ...(row.last_user_revision !== null ? { lastUserRevision: row.last_user_revision as number } : {}),
        ...(row.applied_match_ids !== null ? { appliedMatchIds: JSON.parse(row.applied_match_ids as string) as string[] } : {}),
        ...(row.offer_key !== null ? { offerKey: row.offer_key as string } : {}),
        ...(row.last_online_at !== null ? { lastOnlineAt: row.last_online_at as number } : {}),
        ...(row.ai_takeover_key !== null ? { aiTakeoverKey: row.ai_takeover_key as string } : {}),
        createdAt: row.created_at as number,
        updatedAt: row.updated_at as number,
      }))
      this.sessions = Object.fromEntries(this.db.prepare('SELECT token, account_id FROM sessions').all()
        .map((row) => [row.token as string, row.account_id as string]))
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  private migrateLegacy(dataDir: string): void {
    if (this.db.prepare("SELECT value FROM metadata WHERE key='legacy-json-imported'").get()) return
    // 损坏 / 无权限的旧存档必须让启动失败，不能静默当成空数据库。
    const accountPath = path.join(dataDir, 'accounts.json')
    const sessionPath = path.join(dataDir, 'sessions.json')
    const legacy = fs.existsSync(accountPath)
      ? JSON.parse(fs.readFileSync(accountPath, 'utf8')) as { accounts: Account[] }
      : { accounts: [] }
    if (!Array.isArray(legacy.accounts)) throw new Error('accounts.json 缺少 accounts 数组，无法迁移')
    const sessions: unknown = fs.existsSync(sessionPath) ? JSON.parse(fs.readFileSync(sessionPath, 'utf8')) : {}
    if (!sessions || typeof sessions !== 'object' || Array.isArray(sessions)) throw new Error('sessions.json 格式错误，无法迁移')
    transaction(this.db, () => {
      const insert = this.db.prepare(ACCOUNT_SQL)
      for (const account of legacy.accounts) {
        if (!account || typeof account.id !== 'string' || !account.id
          || typeof account.username !== 'string' || !account.username
          || typeof account.salt !== 'string' || typeof account.passwordHash !== 'string'
          || !account.game || typeof account.game !== 'object' || Array.isArray(account.game)
          || !Number.isInteger(account.revision) || !Number.isFinite(account.createdAt) || !Number.isFinite(account.updatedAt)) {
          throw new Error('accounts.json 含无效账号，无法迁移')
        }
        insert.run(...accountValues(account))
      }
      const ids = new Set(legacy.accounts.map((account) => account.id))
      const insertSession = this.db.prepare(SESSION_SQL)
      for (const [token, id] of Object.entries(sessions)) {
        if (typeof id !== 'string') throw new Error('sessions.json 含无效会话，无法迁移')
        if (ids.has(id)) insertSession.run(token, id)
      }
      // 即使全新安装也写标记：以后不能因为遗留 JSON 的存在而覆盖 SQLite。
      this.db.prepare("INSERT INTO metadata (key, value) VALUES ('legacy-json-imported', '1')").run()
    })
  }

  save(account: Account): void {
    this.assertOpen()
    this.dirty.set(account.id, account)
    this.schedule()
  }

  setSession(token: string, accountId: string | null): void {
    this.assertOpen()
    this.dirtySessions.set(token, accountId)
    this.schedule()
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('账号数据库已关闭')
  }

  private schedule(): void {
    if (this.timer || this.closed) return
    // 不重置已有定时器，连续保存也不会无限延后落盘。
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush().catch((error) => {
        console.error('账号 SQLite 写入失败，将重试', error)
        this.schedule()
      })
    }, this.saveDelayMs)
    this.timer.unref()
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./account-writer.mjs', import.meta.url), {
      workerData: { filename: this.filename, accountSql: ACCOUNT_SQL, sessionSql: SESSION_SQL, deleteSessionSql: DELETE_SESSION_SQL },
      // Worker 是原生 JS，不继承 tsx / 测试 runner 的加载钩子。
      execArgv: [],
    })
    worker.on('message', (message: { id: number; error?: string }) => {
      if (this.inFlight?.id === message.id) {
        this.inFlight.error = message.error
        this.inFlight.complete()
      }
    })
    worker.on('error', (error) => this.workerFailed(worker, error.message))
    worker.on('exit', (code) => {
      if (!this.closed) this.workerFailed(worker, `SQLite worker 退出 (${code})`)
    })
    worker.unref()
    this.worker = worker
    return worker
  }

  private workerFailed(worker: Worker, error: string): void {
    if (this.worker !== worker) return
    this.worker = null
    if (this.inFlight) {
      this.inFlight.error = error
      Atomics.store(this.inFlight.status, 0, -1)
      Atomics.notify(this.inFlight.status, 0)
      this.inFlight.complete()
    }
  }

  private finishBatch(batch: Batch): boolean {
    if (this.inFlight !== batch) return Atomics.load(batch.status, 0) === 1
    const ok = Atomics.load(batch.status, 0) === 1
    this.inFlight = null
    if (!ok) {
      for (const account of batch.accounts) if (!this.dirty.has(account.id)) this.dirty.set(account.id, account)
      for (const [token, id] of batch.sessions) if (!this.dirtySessions.has(token)) this.dirtySessions.set(token, id)
      this.schedule()
    }
    this.worker?.unref()
    batch.complete()
    return ok
  }

  /** 等到当前所有脏账号落盘；正常请求不必等待它。 */
  async flush(): Promise<void> {
    if (this.closed) return
    this.clearTimer()
    while (!this.closed) {
      if (!this.inFlight) {
        if (!this.dirty.size && !this.dirtySessions.size) return
        const accounts = [...this.dirty.values()]
        const sessions = new Map(this.dirtySessions)
        // 先序列化成功再清脏标记，异常不会吞掉待保存数据。
        const values = accounts.map(accountValues)
        const worker = this.getWorker()
        worker.ref() // 显式 await flush 时，进程必须等这笔事务完成。
        let complete!: () => void
        const done = new Promise<void>((resolve) => { complete = resolve })
        const status = new Int32Array(new SharedArrayBuffer(4))
        this.dirty.clear()
        this.dirtySessions.clear()
        const id = ++this.nextBatchId
        this.inFlight = { id, accounts, sessions, status, done, complete }
        try { worker.postMessage({ id, accounts: values, sessions: [...sessions], status: status.buffer }) }
        catch (error) { this.workerFailed(worker, String(error)) }
      }
      const batch = this.inFlight!
      await batch.done
      if (!this.finishBatch(batch)) throw new Error(batch.error ?? 'SQLite 写入失败')
    }
  }

  /** 停服同步屏障：先等后台事务结束，再提交最后一份状态，不会被旧快照覆盖。 */
  flushSync(): void {
    if (this.closed) return
    this.clearTimer()
    if (this.inFlight) {
      const batch = this.inFlight
      const deadline = Date.now() + 15_000
      while (Atomics.load(batch.status, 0) === 0) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) throw new Error('等待账号 SQLite 后台写入超时')
        Atomics.wait(batch.status, 0, 0, remaining)
      }
      this.finishBatch(batch)
    }
    const accounts = [...this.dirty.values()].map(accountValues)
    const sessions = [...this.dirtySessions]
    if (!accounts.length && !sessions.length) return
    transaction(this.db, () => {
      const save = this.db.prepare(ACCOUNT_SQL)
      for (const values of accounts) save.run(...values)
      const set = this.db.prepare(SESSION_SQL)
      const remove = this.db.prepare(DELETE_SESSION_SQL)
      for (const [token, id] of sessions) {
        if (id === null) remove.run(token)
        else set.run(token, id)
      }
    })
    this.dirty.clear()
    this.dirtySessions.clear()
  }

  close(): void {
    if (this.closed) return
    this.flushSync()
    if (this.worker) {
      // 确认连接关闭后才返回，调用方可立即重启或备份数据库。
      const status = new Int32Array(new SharedArrayBuffer(4))
      this.worker.postMessage({ close: true, status: status.buffer })
      if (Atomics.wait(status, 0, 0, 10_000) === 'timed-out' || Atomics.load(status, 0) !== 1) {
        throw new Error('关闭账号 SQLite 后台连接失败')
      }
      void this.worker.terminate()
      this.worker = null
    }
    this.db.close()
    this.closed = true
  }
}
