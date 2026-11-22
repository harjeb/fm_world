import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Worker } from 'node:worker_threads'
import type { GameState } from '../src/game/types.ts'
import {
  extractAccountColdData,
  packAccountGame,
  unpackAccountGame,
  type AccountPart,
  type MatchDetailWrite,
  type SeasonFixturesWrite,
  type UnpackAccountMeta,
} from './account-parts.ts'
import { prepareAccountParts, prepareColdDataWriters } from './account-parts-sql.mjs'

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
  lastOnlineSeason?: number
  aiTakeoverKey?: string
  createdAt: number
  updatedAt: number
}

/** 无登录凭据的俱乐部托管席。它走原球队的比赛/经营路径，但不是玩家账号。 */
export const vacantSeatId = (clubId: string) => `club:${clubId}`
export const isVacantSeat = (id: string | undefined) => id?.startsWith('club:') === true

export const ACCOUNT_DB_FILE = 'accounts.sqlite'
/** Keep serialization/worker copies bounded when a recovery tick dirties every large save. */
export const ACCOUNT_WRITE_BATCH_SIZE = 2
const ACCOUNT_SQL = `INSERT INTO accounts
  (id, username, username_key, salt, password_hash, agent_token, game_json, revision,
   last_user_revision, applied_match_ids, offer_key, last_online_at, ai_takeover_key, created_at, updated_at, last_online_season)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    username=excluded.username, username_key=excluded.username_key, salt=excluded.salt,
    password_hash=excluded.password_hash, agent_token=excluded.agent_token,
    game_json=excluded.game_json, revision=excluded.revision,
    last_user_revision=excluded.last_user_revision, applied_match_ids=excluded.applied_match_ids,
    offer_key=excluded.offer_key, last_online_at=excluded.last_online_at, ai_takeover_key=excluded.ai_takeover_key,
    created_at=excluded.created_at, updated_at=excluded.updated_at, last_online_season=excluded.last_online_season`
const SESSION_SQL = 'INSERT INTO sessions (token, account_id) VALUES (?, ?) ON CONFLICT(token) DO UPDATE SET account_id=excluded.account_id'
const DELETE_SESSION_SQL = 'DELETE FROM sessions WHERE token = ?'
type ClubHandover = { club_id: string; holder: string; initial_name: string }
type Values = Array<string | number | null>
type AccountWrite = {
  id: string
  values: Values
  parts: AccountPart[]
  matchDetails: MatchDetailWrite[]
  seasonFixtures: SeasonFixturesWrite[]
}
type Batch = {
  id: number
  accounts: Account[]
  sessions: Map<string, string | null>
  matchDetails: Map<string, Map<string, string>>
  seasonFixtures: Map<string, Map<number, string>>
  status: Int32Array
  done: Promise<void>
  complete: () => void
  error?: string
}

function accountValues(account: Account, gameJson: string): Values {
  return [account.id, account.username, account.username.toLowerCase(), account.salt, account.passwordHash,
    account.agentToken ?? null, gameJson, account.revision,
    account.lastUserRevision ?? null, account.appliedMatchIds ? JSON.stringify(account.appliedMatchIds) : null,
    account.offerKey ?? null, account.lastOnlineAt ?? null, account.aiTakeoverKey ?? null, account.createdAt, account.updatedAt, account.lastOnlineSeason ?? null]
}

function transaction(db: DatabaseSync, run: () => void): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    run()
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* SQLite may auto-rollback on FULL/IOERR */ }
    throw error
  }
}

/**
 * 账号仍在内存中参与游戏逻辑；落盘只处理显式标脏的账号，不扫描 / 重写其他账号。
 * 战报重明细（解说/关键事件/技能统计）与历年旧赛程拆至 SQLite 冷表按需读取；
 * 共享只读世界/球队部件按内容哈希在内存中共享同一副本，避免多账号重复驻留。
 */
export class AccountStore {
  readonly accounts: Account[]
  readonly sessions: Record<string, string>
  private readonly db: DatabaseSync
  private readonly filename: string
  private readonly retired = new WeakSet<Account>()
  private readonly dirty = new Map<string, Account>()
  private readonly dirtySessions = new Map<string, string | null>()
  private readonly pendingMatchDetails = new Map<string, Map<string, string>>()
  private readonly pendingSeasonFixtures = new Map<string, Map<number, string>>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private worker: Worker | null = null
  private inFlight: Batch | null = null
  private nextBatchId = 0
  private closed = false

  constructor(dataDir: string, private readonly saveDelayMs = 1000, private readonly compactWrites = true) {
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
        CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
        CREATE TABLE IF NOT EXISTS club_handovers (
          club_id TEXT PRIMARY KEY, holder TEXT UNIQUE NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          initial_name TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS account_game_parts (hash TEXT PRIMARY KEY, json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS account_game_refs (
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          slot TEXT NOT NULL,
          hash TEXT NOT NULL REFERENCES account_game_parts(hash),
          PRIMARY KEY (account_id, slot)
        );
        CREATE INDEX IF NOT EXISTS account_game_refs_hash ON account_game_refs(hash);
        CREATE TABLE IF NOT EXISTS match_record_details (
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          match_id TEXT NOT NULL,
          detail_json TEXT NOT NULL,
          PRIMARY KEY (account_id, match_id)
        );
        CREATE TABLE IF NOT EXISTS season_history_fixtures (
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          season_index INTEGER NOT NULL,
          fixtures_json TEXT NOT NULL,
          PRIMARY KEY (account_id, season_index)
        );`)
      const columns = new Set(this.db.prepare('PRAGMA table_info(accounts)').all().map((row) => row.name as string))
      if (!columns.has('last_online_at')) this.db.exec('ALTER TABLE accounts ADD COLUMN last_online_at INTEGER')
      if (!columns.has('ai_takeover_key')) this.db.exec('ALTER TABLE accounts ADD COLUMN ai_takeover_key TEXT')
      if (!columns.has('last_online_season')) this.db.exec('ALTER TABLE accounts ADD COLUMN last_online_season INTEGER')
      this.migrateLegacy(dataDir)

      const accountIds = this.db.prepare('SELECT id FROM accounts ORDER BY rowid').all().map((row) => row.id as string)
      const loadAccount = this.db.prepare('SELECT * FROM accounts WHERE id = ?')
      const loadParts = this.db.prepare(`SELECT refs.slot, parts.hash, parts.json FROM account_game_refs refs
        JOIN account_game_parts parts ON refs.hash = parts.hash WHERE refs.account_id = ? ORDER BY refs.slot`)
      const saveAccountStmt = this.db.prepare(ACCOUNT_SQL)
      const saveParts = prepareAccountParts(this.db)
      const saveColdData = prepareColdDataWriters(this.db)

      // 共享只读部件（杯赛池、AI 球队、储备球星、其他赛区、赛季杯赛快照）按内容哈希复用同一只读实例，避免多账号内存倍增。
      const sharedPartPool = new Map<string, unknown>()
      this.accounts = []
      for (const accountId of accountIds) {
        const row = loadAccount.get(accountId) as Record<string, unknown> | undefined
        if (!row) continue
        const meta: UnpackAccountMeta = { hasUnsplitWorldParts: false }
        const game = unpackAccountGame(
          row.game_json as string,
          loadParts.iterate(accountId) as Iterable<{ slot: string; hash: string; json: string }>,
          sharedPartPool,
          meta,
        )
        const account: Account = {
          id: row.id as string,
          username: row.username as string,
          salt: row.salt as string,
          passwordHash: row.password_hash as string,
          ...(row.agent_token !== null ? { agentToken: row.agent_token as string } : {}),
          game,
          revision: row.revision as number,
          ...(row.last_user_revision !== null ? { lastUserRevision: row.last_user_revision as number } : {}),
          ...(row.applied_match_ids !== null ? { appliedMatchIds: JSON.parse(row.applied_match_ids as string) as string[] } : {}),
          ...(row.offer_key !== null ? { offerKey: row.offer_key as string } : {}),
          ...(row.last_online_at !== null ? { lastOnlineAt: row.last_online_at as number } : {}),
          ...(row.last_online_season !== null ? { lastOnlineSeason: row.last_online_season as number } : {}),
          ...(row.ai_takeover_key !== null ? { aiTakeoverKey: row.ai_takeover_key as string } : {}),
          createdAt: row.created_at as number,
          updatedAt: row.updated_at as number,
        }
        // 逐账号就地拆离旧存档里的战报重明细与历年赛程并落盘，避免一次性把全部旧解说读满堆内存。
        if (this.compactWrites && game.shared) {
          const extracted = extractAccountColdData(game)
          if (extracted.mutated || meta.hasUnsplitWorldParts) {
            const { json, parts } = packAccountGame(game, true)
            // 顺手把刚拆出的 seasonCups / seasonCupHistory 纳入共享冻结池，确保本次启动立刻生效。
            if (meta.hasUnsplitWorldParts && game.world) {
              for (const part of parts) {
                if (part.slot === 'season-cups') {
                  const key = `season-cups:${part.hash}`
                  let shared = sharedPartPool.get(key)
                  if (!shared) {
                    shared = Object.freeze(game.world.seasonCups!)
                    sharedPartPool.set(key, shared)
                  }
                  game.world.seasonCups = shared as typeof game.world.seasonCups
                } else if (part.slot === 'season-cup-history') {
                  const key = `season-cup-history:${part.hash}`
                  let shared = sharedPartPool.get(key)
                  if (!shared) {
                    shared = Object.freeze(game.world.seasonCupHistory!)
                    sharedPartPool.set(key, shared)
                  }
                  game.world.seasonCupHistory = shared as typeof game.world.seasonCupHistory
                }
              }
            }
            transaction(this.db, () => {
              saveAccountStmt.run(...accountValues(account, json))
              saveParts(account.id, parts)
              saveColdData(account.id, extracted.matchDetails, extracted.seasonFixtures)
            })
          }
        }
        this.accounts.push(account)
      }
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
          || typeof account.salt !== 'string' || !account.salt
          || typeof account.passwordHash !== 'string'
          || !account.game || typeof account.game !== 'object' || Array.isArray(account.game)
          || !Number.isInteger(account.revision) || !Number.isFinite(account.createdAt) || !Number.isFinite(account.updatedAt)) {
          throw new Error('accounts.json 含无效账号，无法迁移')
        }
        insert.run(...accountValues(account, JSON.stringify(account.game)))
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

  private stageColdData(account: Account): void {
    if (!this.compactWrites || !account.game?.shared) return
    const extracted = extractAccountColdData(account.game)
    if (extracted.matchDetails.length) {
      let bucket = this.pendingMatchDetails.get(account.id)
      if (!bucket) { bucket = new Map(); this.pendingMatchDetails.set(account.id, bucket) }
      for (const { matchId, detailJson } of extracted.matchDetails) bucket.set(matchId, detailJson)
    }
    if (extracted.seasonFixtures.length) {
      let bucket = this.pendingSeasonFixtures.get(account.id)
      if (!bucket) { bucket = new Map(); this.pendingSeasonFixtures.set(account.id, bucket) }
      for (const { seasonIndex, fixturesJson } of extracted.seasonFixtures) bucket.set(seasonIndex, fixturesJson)
    }
  }

  private prepareWrite(account: Account): AccountWrite {
    this.stageColdData(account)
    const { json, parts } = packAccountGame(account.game, this.compactWrites)
    const matchMap = this.pendingMatchDetails.get(account.id)
    const seasonMap = this.pendingSeasonFixtures.get(account.id)
    const matchDetails: MatchDetailWrite[] = matchMap
      ? Array.from(matchMap, ([matchId, detailJson]) => ({ matchId, detailJson }))
      : []
    const seasonFixtures: SeasonFixturesWrite[] = seasonMap
      ? Array.from(seasonMap, ([seasonIndex, fixturesJson]) => ({ seasonIndex, fixturesJson }))
      : []
    return { id: account.id, values: accountValues(account, json), parts, matchDetails, seasonFixtures }
  }

  /** 按需读取单场战报详情 JSON（优先读未落盘缓冲，再查 SQLite，保证写后立即可读）。 */
  getMatchDetail(accountId: string, matchId: string): string | null {
    const pending = this.pendingMatchDetails.get(accountId)?.get(matchId)
    if (pending !== undefined) return pending
    const inFlight = this.inFlight?.matchDetails.get(accountId)?.get(matchId)
    if (inFlight !== undefined) return inFlight
    if (this.closed) return null
    const row = this.db.prepare('SELECT detail_json FROM match_record_details WHERE account_id = ? AND match_id = ?').get(accountId, matchId) as { detail_json?: string } | undefined
    return typeof row?.detail_json === 'string' ? row.detail_json : null
  }

  /** 仅用于兼容非精简旧接口的全量战报回填。 */
  getAllMatchDetails(accountId: string): Map<string, string> {
    const out = new Map<string, string>()
    if (!this.closed) {
      for (const row of this.db.prepare('SELECT match_id, detail_json FROM match_record_details WHERE account_id = ?').iterate(accountId)) {
        out.set(row.match_id as string, row.detail_json as string)
      }
    }
    const inFlight = this.inFlight?.matchDetails.get(accountId)
    if (inFlight) for (const [matchId, detailJson] of inFlight) out.set(matchId, detailJson)
    const pending = this.pendingMatchDetails.get(accountId)
    if (pending) for (const [matchId, detailJson] of pending) out.set(matchId, detailJson)
    return out
  }

  /** 按需读取某往季完整赛程 JSON。 */
  getSeasonHistoryFixtures(accountId: string, seasonIndex: number): string | null {
    const pending = this.pendingSeasonFixtures.get(accountId)?.get(seasonIndex)
    if (pending !== undefined) return pending
    const inFlight = this.inFlight?.seasonFixtures.get(accountId)?.get(seasonIndex)
    if (inFlight !== undefined) return inFlight
    if (this.closed) return null
    const row = this.db.prepare('SELECT fixtures_json FROM season_history_fixtures WHERE account_id = ? AND season_index = ?').get(accountId, seasonIndex) as { fixtures_json?: string } | undefined
    return typeof row?.fixtures_json === 'string' ? row.fixtures_json : null
  }

  /** 仅用于兼容非精简旧接口的历年赛程回填。 */
  getAllSeasonHistoryFixtures(accountId: string): Map<number, string> {
    const out = new Map<number, string>()
    if (!this.closed) {
      for (const row of this.db.prepare('SELECT season_index, fixtures_json FROM season_history_fixtures WHERE account_id = ?').iterate(accountId)) {
        out.set(row.season_index as number, row.fixtures_json as string)
      }
    }
    const inFlight = this.inFlight?.seasonFixtures.get(accountId)
    if (inFlight) for (const [seasonIndex, fixturesJson] of inFlight) out.set(seasonIndex, fixturesJson)
    const pending = this.pendingSeasonFixtures.get(accountId)
    if (pending) for (const [seasonIndex, fixturesJson] of pending) out.set(seasonIndex, fixturesJson)
    return out
  }

  save(account: Account): void {
    this.assertOpen()
    if (this.retired.has(account)) return
    this.stageColdData(account)
    this.dirty.set(account.id, account)
    this.schedule()
  }

  setSession(token: string, accountId: string | null): void {
    this.assertOpen()
    this.dirtySessions.set(token, accountId)
    this.schedule()
  }

  /** SQLite 是交接的提交点；若随后更新 world.json 前宕机，启动时按此表修复归属。 */
  handovers(): ClubHandover[] {
    return this.db.prepare('SELECT * FROM club_handovers').all() as ClubHandover[]
  }

  replaceHolder(previous: Account, next: Account, clubId: string, initialName: string): void {
    this.assertOpen()
    this.flushSync() // 不允许在途 worker 的旧快照复活已删除的账号。
    const index = this.accounts.indexOf(previous)
    if (index < 0 || this.accounts.some(account => account.id === next.id)) throw new Error('球队归属已变化')
    const write = this.prepareWrite(next)
    transaction(this.db, () => {
      this.db.prepare(ACCOUNT_SQL).run(...write.values)
      prepareAccountParts(this.db)(next.id, write.parts)
      prepareColdDataWriters(this.db)(next.id, write.matchDetails, write.seasonFixtures)
      // 交接席位时把原教练已落盘的战报明细和历年赛程过户给托管席，再删旧账号（避免级联删除丢失历史）。
      this.db.prepare('UPDATE OR IGNORE match_record_details SET account_id = ? WHERE account_id = ?').run(next.id, previous.id)
      this.db.prepare('UPDATE OR IGNORE season_history_fixtures SET account_id = ? WHERE account_id = ?').run(next.id, previous.id)
      // 先为新持有人记录部件引用，再清旧引用，仍共享的部件不能删。
      prepareAccountParts(this.db)(previous.id, [])
      this.db.prepare('DELETE FROM accounts WHERE id=?').run(previous.id)
      this.db.prepare('INSERT INTO club_handovers (club_id, holder, initial_name) VALUES (?, ?, ?)').run(clubId, next.id, initialName)
    })
    this.dirty.delete(previous.id)
    this.pendingMatchDetails.delete(next.id)
    this.pendingSeasonFixtures.delete(next.id)
    this.pendingMatchDetails.delete(previous.id)
    this.pendingSeasonFixtures.delete(previous.id)
    this.retired.add(previous)
    this.accounts[index] = next
    for (const [token, id] of Object.entries(this.sessions)) if (id === previous.id) delete this.sessions[token]
  }

  /** 彻底删除无归属球队的长期离线/孤儿账号及其会话和附属部件。 */
  deleteAccount(account: Account): void {
    this.assertOpen()
    this.flushSync()
    const index = this.accounts.indexOf(account)
    if (index < 0) return
    transaction(this.db, () => {
      prepareAccountParts(this.db)(account.id, [])
      this.db.prepare('DELETE FROM accounts WHERE id=?').run(account.id)
    })
    this.dirty.delete(account.id)
    this.pendingMatchDetails.delete(account.id)
    this.pendingSeasonFixtures.delete(account.id)
    this.retired.add(account)
    this.accounts.splice(index, 1)
    for (const [token, id] of Object.entries(this.sessions)) if (id === account.id) delete this.sessions[token]
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
      for (const [accountId, map] of batch.matchDetails) {
        let bucket = this.pendingMatchDetails.get(accountId)
        if (!bucket) { bucket = new Map(); this.pendingMatchDetails.set(accountId, bucket) }
        for (const [matchId, detailJson] of map) if (!bucket.has(matchId)) bucket.set(matchId, detailJson)
      }
      for (const [accountId, map] of batch.seasonFixtures) {
        let bucket = this.pendingSeasonFixtures.get(accountId)
        if (!bucket) { bucket = new Map(); this.pendingSeasonFixtures.set(accountId, bucket) }
        for (const [seasonIndex, fixturesJson] of map) if (!bucket.has(seasonIndex)) bucket.set(seasonIndex, fixturesJson)
      }
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
        const accounts = [...this.dirty.values()].slice(0, ACCOUNT_WRITE_BATCH_SIZE)
        // Session foreign keys may refer to accounts in a later batch: commit them last.
        const sessions = accounts.length === this.dirty.size ? new Map(this.dirtySessions) : new Map<string, string | null>()
        // 先序列化成功再清脏标记，异常不会吞掉待保存数据。
        const values = accounts.map(account => this.prepareWrite(account))
        const batchMatchDetails = new Map<string, Map<string, string>>()
        const batchSeasonFixtures = new Map<string, Map<number, string>>()
        for (const write of values) {
          if (write.matchDetails.length) {
            batchMatchDetails.set(write.id, new Map(write.matchDetails.map(d => [d.matchId, d.detailJson])))
          }
          if (write.seasonFixtures.length) {
            batchSeasonFixtures.set(write.id, new Map(write.seasonFixtures.map(s => [s.seasonIndex, s.fixturesJson])))
          }
        }
        const worker = this.getWorker()
        worker.ref() // 显式 await flush 时，进程必须等这笔事务完成。
        let complete!: () => void
        const done = new Promise<void>((resolve) => { complete = resolve })
        const status = new Int32Array(new SharedArrayBuffer(4))
        for (const account of accounts) {
          this.dirty.delete(account.id)
          this.pendingMatchDetails.delete(account.id)
          this.pendingSeasonFixtures.delete(account.id)
        }
        for (const token of sessions.keys()) this.dirtySessions.delete(token)
        const id = ++this.nextBatchId
        this.inFlight = { id, accounts, sessions, matchDetails: batchMatchDetails, seasonFixtures: batchSeasonFixtures, status, done, complete }
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
    const accounts = [...this.dirty.values()]
    const sessions = [...this.dirtySessions]
    if (!accounts.length && !sessions.length) return
    transaction(this.db, () => {
      const save = this.db.prepare(ACCOUNT_SQL)
      const saveParts = prepareAccountParts(this.db)
      const saveColdData = prepareColdDataWriters(this.db)
      // Serialize one save at a time, not the entire account database in memory.
      for (const account of accounts) {
        const { id, values, parts, matchDetails, seasonFixtures } = this.prepareWrite(account)
        save.run(...values)
        saveParts(id, parts)
        saveColdData(id, matchDetails, seasonFixtures)
      }
      const set = this.db.prepare(SESSION_SQL)
      const remove = this.db.prepare(DELETE_SESSION_SQL)
      for (const [token, id] of sessions) {
        if (id === null) remove.run(token)
        else set.run(token, id)
      }
    })
    this.dirty.clear()
    this.dirtySessions.clear()
    this.pendingMatchDetails.clear()
    this.pendingSeasonFixtures.clear()
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
