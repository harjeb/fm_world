import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createInitialGame, GAME_VERSION, upgradeLegacySignatures } from '../src/game/state.ts'
import { createOwnerlessWorld, createWorldGameFromWorld, advanceOwnerlessWorld, pickFreeClubForNewAccount, worldSlots } from '../src/game/world.ts'
import type { Player, WorldState } from '../src/game/types.ts'
import { catchUpSeason, ROUND_MS } from '../src/game/season.ts'
import { economyOf } from '../src/game/economy.ts'
import { advanceLeagueRealtime } from '../src/game/realtime.ts'
import { validateAutoSubPlan } from '../src/game/match/management.ts'
import type { GameState } from '../src/game/types.ts'
import { agentView, applyAgentAction } from './agent.ts'

type Account = {
  id: string
  username: string
  salt: string
  passwordHash: string
  agentToken?: string
  game: GameState
  revision: number
  lastUserRevision?: number
  createdAt: number
  updatedAt: number
}

type Db = { accounts: Account[] }

type SharedWorld = {
  seed: number
  startedAt: number
  owners: Record<string, string>
  world: WorldState
  freeStars: Player[]
  reserveStars: Player[]
}

export type RegistrationMode = 'open' | 'invite' | 'closed'

export type AppServerOptions = {
  dataDir?: string
  staticDir?: string
  tickMs?: number
  now?: () => number
  /** 注册入口：open 谁都能注册；invite 需要邀请码；closed 只能登录。默认 open。 */
  registration?: RegistrationMode
  /** registration 为 invite 时的邀请码。 */
  inviteCode?: string
  /** 配置后注册必须通过 Cloudflare Turnstile 校验。 */
  turnstileSecret?: string
  /** 下发给前端的 Turnstile sitekey。 */
  turnstileSiteKey?: string
  /** 单 IP 每小时注册次数上限；0 或不填表示不限。 */
  registerLimitPerHour?: number
}

type SessionMap = Record<string, string>

export type AppServer = {
  server: http.Server
  close: () => void
  accountCount: () => number
}

const SESSION_FILE = 'sessions.json'
const DB_FILE = 'accounts.json'
const WORLD_FILE = 'world.json'

export function createAppServer(options: AppServerOptions = {}): AppServer {
  const dataDir = path.resolve(options.dataDir ?? 'data')
  const staticDir = path.resolve(options.staticDir ?? 'dist')
  const now = options.now ?? Date.now
  const registrationMode: RegistrationMode = options.registration ?? 'open'
  const inviteCode = options.inviteCode?.trim() ?? ''
  const turnstileSecret = options.turnstileSecret?.trim() ?? ''
  const turnstileSiteKey = options.turnstileSiteKey?.trim() ?? ''
  const registerLimitPerHour = Math.max(0, Math.trunc(options.registerLimitPerHour ?? 0))
  /* 邀请码模式没配邀请码会锁死注册，直接报错，避免部署后没人能注册。 */
  if (registrationMode === 'invite' && !inviteCode) throw new Error('registration=invite 需要配置 inviteCode')
  fs.mkdirSync(dataDir, { recursive: true })

  const dbPath = path.join(dataDir, DB_FILE)
  const sessionPath = path.join(dataDir, SESSION_FILE)
  const worldPath = path.join(dataDir, WORLD_FILE)
  const db: Db = readJson<Db>(dbPath, { accounts: [] })
  const loadedWorld = readJson<Partial<SharedWorld> | null>(worldPath, null)
  const sharedWorld: SharedWorld = {
    seed: loadedWorld?.seed ?? crypto.randomInt(1, 0x7fffffff),
    startedAt: loadedWorld?.startedAt ?? now(),
    owners: loadedWorld?.owners ?? {},
    world: loadedWorld?.world as WorldState,
    freeStars: loadedWorld?.freeStars ?? [],
    reserveStars: loadedWorld?.reserveStars ?? [],
  }
  if (!sharedWorld.world || !sharedWorld.freeStars.length) {
    const ownerless = createOwnerlessWorld(sharedWorld.seed, sharedWorld.startedAt)
    sharedWorld.world = ownerless.world
    sharedWorld.freeStars = ownerless.freeStars
    sharedWorld.reserveStars = ownerless.reserveStars
  }
  writeJson(worldPath, sharedWorld)
  const persistWorld = () => writeJson(worldPath, sharedWorld)
  function advanceSharedWorld(): void {
    if (advanceOwnerlessWorld(sharedWorld.world, now())) persistWorld()
  }
  for (const account of db.accounts) account.lastUserRevision ??= account.revision
  const sessions: SessionMap = readJson<SessionMap>(sessionPath, {})
  const clients = new Map<string, Set<ServerResponse>>()
  const registerAttempts = new Map<string, number[]>()

  const persistDb = () => writeJson(dbPath, db)
  const persistSessions = () => writeJson(sessionPath, sessions)

  const publicAccount = (account: Account) => ({ id: account.id, username: account.username })
  const statePayload = (account: Account, source?: string) => ({ type: 'state', revision: account.revision, game: account.game, ...(source ? { source } : {}) })

  function sendState(res: ServerResponse, account: Account, source?: string): void {
    res.write(`data: ${JSON.stringify(statePayload(account, source))}\n\n`)
  }

  function broadcast(account: Account, source?: string): void {
    const group = clients.get(account.id)
    if (!group) return
    for (const res of group) sendState(res, account, source)
  }

  function advanceAccount(account: Account): boolean {
    try {
      if (!account.game) return false
      const migrated = upgradeLegacySignatures(account.game)
      const economyAdded = account.game.economy == null
      economyOf(account.game)
      const progressingLeague = !!account.game.activeMatch?.context.isLeague
      const changed = progressingLeague
        ? advanceLeagueRealtime(account.game, now())
        : !account.game.activeMatch && !account.game.season.finished && catchUpSeason(account.game, now()).advanced > 0
      if (!changed && !migrated && !economyAdded) return false
      account.revision++
      if (migrated || economyAdded || !progressingLeague || !account.game.activeMatch) account.lastUserRevision = account.revision
      account.updatedAt = now()
      persistDb()
      broadcast(account)
      return true
    } catch (error) {
      console.error(`advanceAccount failed for ${account.username}`, error)
      return false
    }
  }

  function accountFromToken(token: string | undefined): Account | undefined {
    if (!token) return undefined
    const id = sessions[token]
    return db.accounts.find((account) => account.id === id)
  }

  function agentAccountFromToken(token: string | undefined): Account | undefined {
    if (!token?.startsWith('fm_')) return undefined
    return db.accounts.find((account) => account.agentToken === token)
  }

  function tokenFromRequest(req: IncomingMessage): string | undefined {
    const auth = req.headers.authorization
    if (auth?.startsWith('Bearer ')) return auth.slice(7)
    const url = new URL(req.url ?? '/', 'http://localhost')
    return url.searchParams.get('token') ?? undefined
  }

  /** Cloudflare 隧道会写入 cf-connecting-ip；直连时退回 socket 地址。 */
  function clientIp(req: IncomingMessage): string {
    const cf = req.headers['cf-connecting-ip']
    if (typeof cf === 'string' && cf.trim()) return cf.trim()
    const forwarded = req.headers['x-forwarded-for']
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded
    if (first) {
      const candidate = first.split(',')[0].trim()
      if (candidate) return candidate
    }
    return req.socket.remoteAddress ?? 'unknown'
  }

  function takeRegisterSlot(ip: string): boolean {
    if (!registerLimitPerHour) return true
    const at = now()
    const windowMs = 60 * 60 * 1000
    const recent = (registerAttempts.get(ip) ?? []).filter((stamp) => at - stamp < windowMs)
    if (recent.length >= registerLimitPerHour) {
      registerAttempts.set(ip, recent)
      return false
    }
    recent.push(at)
    registerAttempts.set(ip, recent)
    if (registerAttempts.size > 4096) {
      for (const [key, list] of registerAttempts) if (!list.some((stamp) => at - stamp < windowMs)) registerAttempts.delete(key)
    }
    return true
  }

  function inviteMatches(given: string): boolean {
    if (!inviteCode) return false
    const a = Buffer.from(given, 'utf8')
    const b = Buffer.from(inviteCode, 'utf8')
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  }

  async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
    if (!turnstileSecret) return true
    if (!token) return false
    try {
      const body = new URLSearchParams({ secret: turnstileSecret, response: token })
      if (ip && ip !== 'unknown') body.set('remoteip', ip)
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(5000),
      })
      const data = (await response.json()) as { success?: boolean }
      return data.success === true
    } catch {
      return false
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url)
        return
      }
      serveStatic(req, res, url)
    } catch (error) {
      console.error(error)
      if (!res.headersSent) json(res, 500, { error: '服务器内部错误' })
      else res.end()
    }
  }

  const aliveAccountIds = () => db.accounts.map((account) => account.id)
  /** 空位统计（owners 里指向已删除账号的条目视为空位）。 */
  function slotInfo() {
    return worldSlots(sharedWorld.world, sharedWorld.owners, aliveAccountIds())
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (url.pathname === '/api/health') {
      json(res, 200, { ok: true, accounts: db.accounts.length, version: GAME_VERSION, worldSeasonStartedAt: sharedWorld.startedAt })
      return
    }

    if (url.pathname === '/api/world' && req.method === 'GET') {
      advanceSharedWorld()
      json(res, 200, {
        seed: sharedWorld.seed,
        startedAt: sharedWorld.startedAt,
        owners: sharedWorld.owners,
        slots: slotInfo(),
        round: sharedWorld.world.divisions[0]?.round ?? 1,
        seasonIndex: sharedWorld.world.seasonIndex,
        divisions: sharedWorld.world.divisions.map((division) => ({ id: division.divisionId, tier: division.tier, conference: division.conference, round: division.round, finished: division.finished, table: division.table })),
        clubs: sharedWorld.world.clubs.map((club) => ({ id: club.id, name: club.name, tier: club.tier, conference: club.conference })),
      })
      return
    }

    if (url.pathname === '/api/public-config' && req.method === 'GET') {
      /* 只暴露注册模式与 sitekey，邀请码与 secret 永不下发。 */
      json(res, 200, { registration: registrationMode, turnstileSiteKey, accounts: db.accounts.length, slots: slotInfo() })
      return
    }

    if (url.pathname === '/api/register' && req.method === 'POST') {
      if (registrationMode === 'closed') return json(res, 403, { error: '本服务器已关闭注册' })
      const ip = clientIp(req)
      if (!takeRegisterSlot(ip)) return json(res, 429, { error: '注册过于频繁，请稍后再试' })
      const body = await readJsonBody(req)
      if (registrationMode === 'invite' && !inviteMatches(String(body.inviteCode ?? '').trim())) {
        return json(res, 403, { error: '邀请码不正确' })
      }
      if (turnstileSecret && !(await verifyTurnstile(String(body.turnstileToken ?? ''), ip))) {
        return json(res, 400, { error: '人机验证未通过，请刷新后重试' })
      }
      const username = String(body.username ?? '').trim()
      const password = String(body.password ?? '')
      if (!/^[\p{L}\p{N}_-]{2,24}$/u.test(username)) return json(res, 400, { error: '用户名需为 2-24 位字母、数字、中文、_ 或 -' })
      if (password.length < 6) return json(res, 400, { error: '密码至少 6 位' })
      if (db.accounts.some((account) => account.username.toLowerCase() === username.toLowerCase())) return json(res, 409, { error: '用户名已存在' })
      const salt = crypto.randomBytes(16).toString('hex')
      advanceSharedWorld()
      // 找不到空位就拒绝，绝不回退去覆盖别人已经在带的球队。
      const club = pickFreeClubForNewAccount(sharedWorld.world, sharedWorld.owners, aliveAccountIds())
      if (!club) return json(res, 503, { error: '服务器席位已满：所有球队都有教练了，等我们开新分区' })
      const accountId = crypto.randomUUID()
      sharedWorld.owners[club.id] = accountId
      persistWorld()
      const account: Account = {
        id: accountId,
        username,
        salt,
        passwordHash: hashPassword(password, salt),
        game: createWorldGameFromWorld(sharedWorld.world, club.id, sharedWorld.seed, sharedWorld.startedAt, sharedWorld.freeStars, sharedWorld.reserveStars),
        revision: 1,
        lastUserRevision: 1,
        createdAt: now(),
        updatedAt: now(),
      }
      db.accounts.push(account)
      const token = createSession(account.id)
      persistDb()
      persistSessions()
      advanceAccount(account)
      json(res, 201, { token, user: publicAccount(account), revision: account.revision, game: account.game })
      return
    }

    if (url.pathname === '/api/login' && req.method === 'POST') {
      const body = await readJsonBody(req)
      const username = String(body.username ?? '').trim().toLowerCase()
      const password = String(body.password ?? '')
      const account = db.accounts.find((item) => item.username.toLowerCase() === username)
      if (!account || hashPassword(password, account.salt) !== account.passwordHash) return json(res, 401, { error: '用户名或密码错误' })
      const token = createSession(account.id)
      persistSessions()
      advanceAccount(account)
      json(res, 200, { token, user: publicAccount(account), revision: account.revision, game: account.game })
      return
    }

    if (url.pathname === '/api/agent/docs' && req.method === 'GET') {
      const docsPath = path.resolve('docs/agent-api.md')
      if (!fs.existsSync(docsPath)) return json(res, 404, { error: 'Agent 文档不存在' })
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-cache' })
      res.end(fs.readFileSync(docsPath))
      return
    }

    if (url.pathname === '/api/agent/token' && req.method === 'POST') {
      const account = accountFromToken(tokenFromRequest(req))
      if (!account) return json(res, 401, { error: '请先登录' })
      if (!account.agentToken) {
        account.agentToken = createAgentToken()
        persistDb()
      }
      json(res, 200, { token: account.agentToken })
      return
    }

    if (url.pathname === '/api/agent/revoke' && req.method === 'POST') {
      const account = accountFromToken(tokenFromRequest(req))
      if (!account) return json(res, 401, { error: '请先登录' })
      delete account.agentToken
      persistDb()
      json(res, 200, { ok: true })
      return
    }

    if (url.pathname.startsWith('/api/agent/')) {
      const agentAccount = agentAccountFromToken(tokenFromRequest(req))
      if (!agentAccount) return json(res, 401, { error: 'Agent 令牌无效，请在游戏账号面板重新生成' })
      if (url.pathname === '/api/agent/state' && req.method === 'GET') {
        advanceAccount(agentAccount)
        json(res, 200, { revision: agentAccount.revision, game: agentView(agentAccount.game, now()) })
        return
      }
      if (url.pathname === '/api/agent/action' && req.method === 'POST') {
        const body = await readJsonBody(req)
        advanceAccount(agentAccount)
        const outcome = applyAgentAction(agentAccount.game, body, now())
        if (outcome.ok && !['get_player', 'get_match', 'preview_training'].includes(String(body.action))) {
          agentAccount.revision++
          const leagueOnly = agentAccount.game.activeMatch?.context.isLeague && ['start_league', 'set_match_tactics', 'substitute'].includes(String(body.action))
          if (!leagueOnly) agentAccount.lastUserRevision = agentAccount.revision
          agentAccount.updatedAt = now()
          persistDb()
          broadcast(agentAccount)
        }
        json(res, outcome.ok ? 200 : 400, { ...outcome, revision: agentAccount.revision, game: agentView(agentAccount.game, now()) })
        return
      }
      json(res, 404, { error: 'Agent 接口不存在' })
      return
    }

    const account = accountFromToken(tokenFromRequest(req))
    if (!account) return json(res, 401, { error: '请先登录' })

    if (url.pathname === '/api/logout' && req.method === 'POST') {
      const token = tokenFromRequest(req)
      if (token) {
        delete sessions[token]
        persistSessions()
      }
      json(res, 200, { ok: true })
      return
    }

    if (url.pathname === '/api/me' && req.method === 'GET') {
      json(res, 200, { user: publicAccount(account), revision: account.revision })
      return
    }

    if (url.pathname === '/api/game' && req.method === 'GET') {
      advanceAccount(account)
      json(res, 200, { game: account.game, revision: account.revision })
      return
    }

    if (url.pathname === '/api/match/action' && req.method === 'POST') {
      const body = await readJsonBody(req)
      if (!['start_league', 'set_match_tactics', 'substitute'].includes(String(body.action))) return json(res, 400, { error: '不支持的比赛操作' })
      advanceAccount(account)
      if (body.action !== 'start_league' && !account.game.activeMatch?.context.isLeague) return json(res, 400, { error: '当前没有进行中的联赛' })
      const outcome = applyAgentAction(account.game, body, now())
      if (outcome.ok) {
        account.revision++
        account.updatedAt = now()
        persistDb()
        broadcast(account, String(req.headers['x-fm-client'] ?? '').slice(0, 128))
      }
      json(res, outcome.ok ? 200 : 400, { ...outcome, revision: account.revision, game: account.game })
      return
    }

    if (url.pathname === '/api/game' && req.method === 'PUT') {
      const body = await readJsonBody(req)
      advanceAccount(account)
      const baseRevision = Number(body.baseRevision)
      const onlyLeagueProgress = account.game.activeMatch?.context.isLeague && baseRevision >= (account.lastUserRevision ?? account.revision) && baseRevision < account.revision
      if (!Number.isInteger(baseRevision) || (baseRevision !== account.revision && !onlyLeagueProgress)) {
        json(res, 409, { error: '存档已在另一设备更新', revision: account.revision, game: account.game })
        return
      }
      if (!isGameState(body.game)) return json(res, 400, { error: '无效的游戏存档' })
      if (body.game.injuries !== undefined && (!body.game.injuries || typeof body.game.injuries !== 'object' || Array.isArray(body.game.injuries) || Object.values(body.game.injuries).some((time) => typeof time !== 'number' || !Number.isFinite(time) || time < 0))) return json(res, 400, { error: '无效的伤病状态' })
      if (body.game.autoSubs !== undefined) {
        const errors = validateAutoSubPlan(body.game.roster, body.game.lineup, body.game.autoSubs)
        if (errors.length) return json(res, 400, { error: `自动换人规则无效：${errors.join('；')}` })
      }
      if (account.game.activeMatch?.context.isLeague) {
        body.game.activeMatch = account.game.activeMatch
        body.game.season = account.game.season
        body.game.matchHistory = account.game.matchHistory
        body.game.injuries = account.game.injuries
      } else if (body.game.activeMatch?.context.isLeague) {
        return json(res, 400, { error: '联赛必须由服务器开始' })
      }
      upgradeLegacySignatures(body.game)
      economyOf(body.game)
      account.game = body.game
      account.revision++
      account.lastUserRevision = account.revision
      account.updatedAt = now()
      persistDb()
      broadcast(account, String(req.headers['x-fm-client'] ?? '').slice(0, 128))
      json(res, 200, { ok: true, revision: account.revision, updatedAt: account.updatedAt })
      return
    }

    if (url.pathname === '/api/events' && req.method === 'GET') {
      openEvents(req, res, account)
      return
    }

    json(res, 404, { error: '接口不存在' })
  }

  function openEvents(req: IncomingMessage, res: ServerResponse, account: Account): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write('retry: 3000\n\n')
    let group = clients.get(account.id)
    if (!group) {
      group = new Set()
      clients.set(account.id, group)
    }
    group.add(res)
    sendState(res, account)
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000)
    const cleanup = () => {
      clearInterval(heartbeat)
      group!.delete(res)
      if (group!.size === 0) clients.delete(account.id)
    }
    req.on('close', cleanup)
    res.on('close', cleanup)
  }

  function createSession(accountId: string): string {
    const token = crypto.randomBytes(32).toString('hex')
    sessions[token] = accountId
    return token
  }

  function createAgentToken(): string {
    return `fm_${crypto.randomBytes(24).toString('hex')}`
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL): void {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' })
    const pathname = decodeURIComponent(url.pathname)
    const requested = pathname === '/' ? '/index.html' : pathname
    const filePath = path.resolve(staticDir, `.${requested}`)
    if (!filePath.startsWith(staticDir + path.sep) && filePath !== path.join(staticDir, 'index.html')) {
      json(res, 403, { error: 'Forbidden' })
      return
    }
    let target = filePath
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      target = path.join(staticDir, 'index.html')
    }
    if (!fs.existsSync(target)) {
      json(res, 503, { error: '前端尚未构建，请先运行 npm run build' })
      return
    }
    const ext = path.extname(target).toLowerCase()
    const type = CONTENT_TYPES[ext] ?? 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable' })
    if (req.method === 'HEAD') res.end()
    else res.end(fs.readFileSync(target))
  }

  const server = http.createServer((req, res) => void handle(req, res))
  const tickMs = options.tickMs ?? 30_000
  const timer = tickMs > 0
    ? setInterval(() => {
        advanceSharedWorld()
        for (const account of db.accounts) advanceAccount(account)
      }, tickMs)
    : null
  timer?.unref?.()
  const matchTimer = tickMs > 0 ? setInterval(() => {
    for (const account of db.accounts) if (account.game.activeMatch?.context.isLeague) advanceAccount(account)
  }, 1000) : null
  matchTimer?.unref?.()

  return {
    server,
    close: () => {
      if (timer) clearInterval(timer)
      if (matchTimer) clearInterval(matchTimer)
      for (const group of clients.values()) for (const res of group) res.end()
      clients.clear()
      server.close()
    },
    accountCount: () => db.accounts.length,
  }
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex')
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, value: unknown): void {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fs.renameSync(tmp, file)
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > 8 * 1024 * 1024) throw new Error('请求体过大')
    chunks.push(buf)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function isGameState(value: unknown): value is GameState {
  const game = value as GameState
  return !!game
    && game.version === GAME_VERSION
    && Array.isArray(game.roster)
    && game.roster.length >= 10
    && !!game.lineup
    && Array.isArray(game.lineup.starters)
    && Array.isArray(game.lineup.bench)
    && Array.isArray(game.aiTeams)
    && Array.isArray(game.freeStars)
    && !!game.season
    && Array.isArray(game.season.fixtures)
    && game.season.fixtures.every((fixture) => !!fixture && Number.isInteger(fixture.round) && fixture.round > 0 && typeof fixture.played === 'boolean')
    && Array.isArray(game.season.table)
    && game.season.table.length === 20
    && (game.world === undefined || (Array.isArray(game.world.clubs) && Array.isArray(game.world.divisions)))
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}
