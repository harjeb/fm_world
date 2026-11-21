import type { Auction, AuctionResult } from './game/auction.ts'
import type { ScoutLevel, ScoutSource, VisibleScoutReport } from './game/scouting.ts'
import type { CupSeasonState } from './game/cup.ts'
import { CHAT_HISTORY_LIMIT, appendChatMessage, isValidChatMessage, type ChatMessage, type ChatSseMessage } from './game/chat.ts'
import type { AITeam, Attributes, FacilityId, GameState, MatchRecord, Player, SeasonTableRow, Fixture, TierId, ConferenceId } from './game/types.ts'
import type { ReleaseAssessment } from './game/transfer-rules.ts'
import type { NegotiationDemands } from './game/negotiation.ts'
import { setRemoteSaver, saveGame, withoutDeferredCupPool } from './game/state.ts'
import { dueRound } from './game/season.ts'

const TOKEN_KEY = 'fm-online-token'
const SAVE_TIMEOUT_MS = 12_000
const ACTION_TIMEOUT_MS = 10_000
const RECOVERY_TIMEOUT_MS = 5_000

type ClubCoaches = Record<string, 'human' | 'takeover'>
type CoachSnapshot = { clubCoaches?: ClubCoaches }

export type OnlineUser = { id: string; username: string }
export type OnlineStatus = 'offline' | 'connecting' | 'online'

export const onlineState: {
  status: OnlineStatus
  user: OnlineUser | null
  revision: number
  connected: boolean
  error: string
  lastSync: number
  clubCoaches: ClubCoaches | null
} = {
  status: 'offline',
  user: null,
  revision: 0,
  connected: false,
  error: '',
  lastSync: 0,
  clubCoaches: null,
}

/** 全服自由市场。只有联机时有内容；单机还是用存档里的 freeStars。 */
export type WorldPublicPlayer = Pick<Player, 'youthOrigin' | 'id' | 'name' | 'enName' | 'country' | 'era' | 'age' | 'foot' | 'height' | 'positions' | 'detailedPositions' | 'traitId' | 'skills' | 'skillTiers'> & { attrs: Partial<Attributes>; ca: number; baseCa?: number }
export type AITransferOffer = {
  teamId: string
  teamName: string
  player: WorldPublicPlayer
  asking: number | null
  terms: ReleaseAssessment
  blocked: string | null
  demands: NegotiationDemands
}

/** 市场列表是临时公开快照，不加入账号的本赛区赛程或保存数据。 */
export const aiTransferMarket: { offers: AITransferOffer[]; loading: boolean; loaded: boolean; error: string } = { offers: [], loading: false, loaded: false, error: '' }
let aiTransferRequest = 0
export type WorldPublicClub = Pick<AITeam, 'id' | 'name' | 'color' | 'formationId'> & { rosterDeferred?: true; tier: TierId; conference?: ConferenceId; managed?: boolean; /** 教练已超过 3 天未上线，当前由 AI 临时接管。 */ aiTakeover?: boolean; /** RANK：首发 CA 之和。 */ rating?: number; players: WorldPublicPlayer[]; /** 设施阶段（1–25）；电脑球队公开，玩家管理的球队不公开。 */ facilities?: Partial<Record<FacilityId, number>> }
export type WorldPublicSnapshot = {
  seasonIndex: number
  ownClubId: string | null
  clubs: WorldPublicClub[]
  divisions: { id: string; tier?: TierId; conference?: ConferenceId; round: number; table: SeasonTableRow[]; fixtures: Fixture[] }[]
}

/** 只包含公开球员资料，不接收体能、精力或教练存档。 */
export let publicWorld: WorldPublicSnapshot | null = null
let publicWorldRequest = 0
let pendingWorld: { epoch: number; promise: Promise<void> } | undefined
let publicClubRequest = 0
let viewedClub: { epoch: number; seasonIndex: number; requested: string; club: WorldPublicClub } | undefined

export function loadedPublicClub(id: string, season: number): WorldPublicClub | undefined {
  return viewedClub?.epoch === sessionEpoch && viewedClub.seasonIndex === season && (viewedClub.requested === id || viewedClub.club.id === id) ? viewedClub.club : undefined
}

export async function refreshPublicClub(id: string): Promise<void> {
  if (!isOnlineMode()) return
  const request = ++publicClubRequest
  const epoch = sessionEpoch
  const data = await requestJson<{ club: WorldPublicClub; seasonIndex: number }>(`/api/world/club?id=${encodeURIComponent(id)}`, undefined, ACTION_TIMEOUT_MS)
  if (epoch !== sessionEpoch || request !== publicClubRequest || !isOnlineMode()) return
  if (!Number.isSafeInteger(data.seasonIndex) || !data.club || !Array.isArray(data.club.players) || (id !== 'player' && id !== data.club.id)) throw new Error('球队名单响应无效')
  viewedClub = { epoch, requested: id, ...data }
  notify()
}

/** 注册前的空缺球队预览；球队仅在注册提交成功时分配。 */
export let registrationClubs: WorldPublicClub[] | null = null

export async function refreshRegistrationClubs(): Promise<void> {
  const data = await requestJson<{ clubs: WorldPublicClub[] }>('/api/registration/clubs')
  registrationClubs = data.clubs
  notify()
}

export function refreshPublicWorld(): Promise<void> {
  if (!isOnlineMode()) return Promise.resolve()
  const epoch = sessionEpoch
  if (pendingWorld?.epoch === epoch) return pendingWorld.promise
  const request = ++publicWorldRequest
  const promise = requestJson<WorldPublicSnapshot>('/api/world/teams', { headers: { 'X-FM-World-Summary': '1' } }, ACTION_TIMEOUT_MS).then(data => {
    if (request === publicWorldRequest && sessionEpoch === epoch && isOnlineMode() && Array.isArray(data.clubs) && Array.isArray(data.divisions)) {
      publicWorld = data
      onlineState.clubCoaches = Object.fromEntries(data.clubs.filter(club => club.managed).map(club => [club.id, club.aiTakeover ? 'takeover' : 'human']))
      notify()
    }
  }).catch(() => {
    // 网络中断时保留最近一次快照，下次打开世界页再重试。
  }).finally(() => { if (pendingWorld?.promise === promise) pendingWorld = undefined })
  pendingWorld = { epoch, promise }
  return promise
}

export const marketState = {
  pool: [] as Player[],
  auctions: [] as Auction[],
  log: [] as AuctionResult[],
  version: 0,
  serverOffset: 0,
}

type MarketMessage = { type: 'market'; auctions: Auction[]; log: AuctionResult[]; version: number; serverTime: number }

const marketListeners = new Set<(previous: Auction[], previousLog: AuctionResult[]) => void>()

export function subscribeMarket(listener: (previous: Auction[], previousLog: AuctionResult[]) => void): () => void {
  marketListeners.add(listener)
  return () => marketListeners.delete(listener)
}

/** 倒计时按服务器时间算，本机时钟不准也不会提前或拖后。 */
export function serverNow(): number {
  return Date.now() + marketState.serverOffset
}

const CHAT_SEEN_KEY = 'fm-chat-seen-at'

export const chatState = {
  messages: [] as ChatMessage[],
  unread: 0,
  sending: false,
}

export type ChatUpdateEvent = { kind: 'snapshot' | 'append'; added?: ChatMessage }

const chatListeners = new Set<(event: ChatUpdateEvent) => void>()

export function subscribeChat(listener: (event: ChatUpdateEvent) => void): () => void {
  chatListeners.add(listener)
  return () => chatListeners.delete(listener)
}

function readChatSeenAt(): number {
  if (typeof localStorage === 'undefined') return 0
  const raw = Number(localStorage.getItem(CHAT_SEEN_KEY) ?? 0)
  return Number.isFinite(raw) && raw > 0 ? raw : 0
}

function writeChatSeenAt(at: number): void {
  if (typeof localStorage !== 'undefined' && Number.isFinite(at) && at > 0) {
    localStorage.setItem(CHAT_SEEN_KEY, String(Math.floor(at)))
  }
}

export function markChatSeen(): void {
  chatState.unread = 0
  const latest = Math.max(readChatSeenAt(), chatState.messages.at(-1)?.at ?? 0, serverNow())
  writeChatSeenAt(latest)
}

export type RegistrationMode = 'open' | 'invite' | 'closed'

export type PublicConfig = {
  /** unknown 表示拿不到服务器配置（纯静态部署 / 离线）。 */
  registration: RegistrationMode | 'unknown'
  turnstileSiteKey: string
}

export const publicConfig: PublicConfig = { registration: 'unknown', turnstileSiteKey: '' }

/** 拉取注册入口配置。静态部署或服务器不可达时返回 unknown。 */
export async function loadPublicConfig(): Promise<PublicConfig> {
  try {
    const response = await fetch('/api/public-config', { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = (await response.json()) as { registration?: string; turnstileSiteKey?: string }
    publicConfig.registration = data.registration === 'invite' || data.registration === 'closed' ? data.registration : 'open'
    publicConfig.turnstileSiteKey = typeof data.turnstileSiteKey === 'string' ? data.turnstileSiteKey : ''
  } catch {
    publicConfig.registration = 'unknown'
    publicConfig.turnstileSiteKey = ''
  }
  return publicConfig
}

type AuthResponse = CoachSnapshot & { token: string; user: OnlineUser; revision: number; game: GameState }
type StateResponse = CoachSnapshot & { type: 'state'; revision: number; serverTime?: number; game: GameState; source?: string }
type StateSyncResponse = CoachSnapshot & { type: 'state-sync'; revision: number; serverTime?: number; source?: string }
type StatePatchResponse = CoachSnapshot & {
  type: 'state-patch'
  baseRevision: number
  revision: number
  serverTime?: number
  patch: Record<string, unknown>
  prepend?: { matchHistory?: MatchRecord[]; challengeHistory?: MatchRecord[] }
  remove?: string[]
  source?: string
}
type StateStaleResponse = CoachSnapshot & { type: 'state-stale'; revision: number; serverTime?: number; source?: string }
type SsePayload = StateResponse | StateSyncResponse | StatePatchResponse | StateStaleResponse | MarketMessage | ChatSseMessage

const clientId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
let token = typeof localStorage === 'undefined' ? null : localStorage.getItem(TOKEN_KEY)
let sessionEpoch = 0
let eventSource: EventSource | null = null
let deferredState: StateResponse | null = null
let deferredPatches: StatePatchResponse[] = []
let deferredResync = false
let syncedGame: GameState | null = null
let resyncPending: Promise<void> | null = null
let pendingGame: GameState | null = null
let pendingRevision = 0
let saveTimer: number | null = null
let saving = false
let saveFinished: Promise<void> | null = null
let remoteGameHandler: ((game: GameState) => void) | null = null
const listeners = new Set<() => void>()

export function subscribeOnline(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setRemoteGameHandler(handler: ((game: GameState) => void) | null): void {
  remoteGameHandler = handler
}

function notify(): void {
  for (const listener of listeners) listener()
}

function setToken(next: string | null): void {
  token = next
  if (typeof localStorage !== 'undefined') {
    if (next) localStorage.setItem(TOKEN_KEY, next)
    else localStorage.removeItem(TOKEN_KEY)
  }
}

function authHeaders(): Record<string, string> {
  return {
    'X-FM-Lazy-Cup': '1',
    'X-FM-Slim': '1',
    ...(token ? { Authorization: `Bearer ${token}`, 'X-FM-Client': clientId } : {}),
  }
}

/** 还原联机精简模式省略的本赛区重复赛程，并合并已按需加载的杯赛名单和战报明细。 */
export function hydrateOnlineGame<T extends GameState | null | undefined>(game: T): T {
  if (!game) return game
  if (game.world?.divisions && game.season?.fixtures) {
    for (const division of game.world.divisions) {
      if (division.fixturesFromSeason) {
        division.fixtures = game.season.fixtures
        delete division.fixturesFromSeason
      }
    }
  }
  applyLoadedCupSeason(game)
  applyLoadedMatchRecords(game)
  return game
}

function applyStatePatch(base: GameState, data: StatePatchResponse): GameState {
  const next = { ...base, ...(data.patch as Partial<GameState>) } as GameState & Record<string, unknown>
  if (data.prepend?.matchHistory?.length) {
    const existing = new Set((next.matchHistory ?? []).map((item) => item.id))
    const fresh = data.prepend.matchHistory.filter((item) => !existing.has(item.id))
    next.matchHistory = [...fresh, ...(next.matchHistory ?? [])]
  }
  if (data.prepend?.challengeHistory?.length) {
    const existing = new Set((next.challengeHistory ?? []).map((item) => item.id))
    const fresh = data.prepend.challengeHistory.filter((item) => !existing.has(item.id))
    next.challengeHistory = [...fresh, ...(next.challengeHistory ?? [])]
  }
  if (data.remove?.length) {
    for (const key of data.remove) delete next[key]
  }
  return hydrateOnlineGame(next as GameState)
}

function triggerResyncFromServer(): void {
  if (!token || !isOnlineMode() || resyncPending) return
  const epoch = sessionEpoch
  const run = requestJson<CoachSnapshot & { game: GameState; revision: number }>('/api/game', { cache: 'no-store' }, 20_000)
    .then((current) => {
      if (epoch !== sessionEpoch || !isOnlineMode() || !current.game || !Number.isSafeInteger(current.revision)) return
      hydrateOnlineGame(current.game)
      if (current.clubCoaches) onlineState.clubCoaches = current.clubCoaches
      if (saving || pendingGame) {
        if (!deferredState || current.revision >= deferredState.revision) {
          deferredState = { type: 'state', revision: current.revision, game: current.game, clubCoaches: current.clubCoaches }
        }
        return
      }
      if (current.revision >= onlineState.revision) {
        onlineState.revision = current.revision
        onlineState.lastSync = Date.now()
        syncedGame = current.game
        remoteGameHandler?.(current.game)
        if (publicWorld && current.game.world?.seasonIndex !== publicWorld.seasonIndex) void refreshPublicWorld()
        notify()
      }
    })
    .catch(() => {
      // 留到下一次 SSE 或用户手动刷新。
    })
    .finally(() => { if (resyncPending === run) resyncPending = null })
  resyncPending = run
}

/** 对准服务器时钟。联赛直播回放按它算“比赛踢到第几分钟”，所以必须在应用存档之前就同步好。 */
function syncServerClock(serverTime: unknown): void {
  if (typeof serverTime === 'number' && Number.isFinite(serverTime)) marketState.serverOffset = serverTime - Date.now()
}

class OnlineTimeoutError extends Error {
  constructor() { super('服务器响应超时，请检查网络连接。') }
}

async function withRequestTimeout<T>(ms: number, request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new OnlineTimeoutError()), ms)
  try {
    return await request(controller.signal)
  } catch (error) {
    controller.signal.throwIfAborted()
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function requestJson<T>(url: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  const request = async (signal = init?.signal) => {
    const response = await fetch(url, { ...init, signal, headers: { ...(init?.headers ?? {}), ...authHeaders() } })
    const data = await response.json().catch(() => ({}))
    signal?.throwIfAborted()
    syncServerClock((data as { serverTime?: unknown } | null)?.serverTime)
    if (!response.ok) throw new Error((data as { error?: string }).error ?? `请求失败 (${response.status})`)
    return data as T
  }
  return timeoutMs ? withRequestTimeout(timeoutMs, request) : request()
}

function clearAITransferMarket(): void {
  aiTransferRequest++
  Object.assign(aiTransferMarket, { offers: [], loading: false, loaded: false, error: '' })
}

/** 重新读取全世界 AI 报价；交易时服务器仍会复核球队、球员和价格。 */
export async function refreshAITransferMarket(): Promise<void> {
  if (!isOnlineMode()) return
  const request = ++aiTransferRequest
  const user = onlineState.user?.id
  aiTransferMarket.loading = true
  aiTransferMarket.error = ''
  notify()
  try {
    const data = await requestJson<{ offers: AITransferOffer[] }>('/api/transfer/ai-offers')
    if (request !== aiTransferRequest || !isOnlineMode() || onlineState.user?.id !== user) return
    aiTransferMarket.offers = data.offers
    aiTransferMarket.loaded = true
  } catch (error) {
    if (request !== aiTransferRequest) return
    aiTransferMarket.error = error instanceof Error ? error.message : '市场加载失败'
  } finally {
    if (request === aiTransferRequest) { aiTransferMarket.loading = false; notify() }
  }
}

/** 赛后 2D 重看：开球时的引擎初始状态（只给参赛的教练，比赛公布之后才有）。 */
export async function fetchMatchReplay(matchId: string): Promise<{ engineState: unknown; homeAway: 'home' | 'away'; durationSeconds: number }> {
  return requestJson(`/api/match/replay?id=${encodeURIComponent(matchId)}`)
}

export async function registerOnline(
  username: string,
  password: string,
  extra: { inviteCode?: string; turnstileToken?: string; clubId?: string } = {},
): Promise<AuthResponse> {
  const data = await requestJson<AuthResponse>('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      ...(extra.inviteCode ? { inviteCode: extra.inviteCode } : {}),
      ...(extra.turnstileToken ? { turnstileToken: extra.turnstileToken } : {}),
      ...(extra.clubId ? { clubId: extra.clubId } : {}),
    }),
  })
  acceptSession(data)
  return data
}

export async function loginOnline(username: string, password: string): Promise<AuthResponse> {
  const data = await requestJson<AuthResponse>('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  acceptSession(data)
  return data
}

export async function logoutOnline(): Promise<void> {
  ++sessionEpoch
  await flushOnlineNow()
  try {
    await requestJson('/api/logout', { method: 'POST' })
  } catch {
    // 离线退出也要清掉本地令牌。
  }
  eventSource?.close()
  eventSource = null
  deferredState = null
  deferredPatches = []
  deferredResync = false
  syncedGame = null
  loadedMatchRecords.clear()
  matchRecordRequests.clear()
  setRemoteSaver(null)
  setToken(null)
  onlineState.status = 'offline'
  onlineState.user = null
  onlineState.clubCoaches = null
  onlineState.connected = false
  onlineState.revision = 0
  onlineState.error = ''
  Object.assign(marketState, { pool: [], auctions: [], log: [], version: 0 })
  clearAITransferMarket()
  Object.assign(chatState, { messages: [], unread: 0, sending: false })
  ++publicWorldRequest
  publicWorld = null
  notify()
}

async function restoreSession(): Promise<GameState | null> {
  if (!token) return null
  ++sessionEpoch
  ++publicWorldRequest
  publicWorld = null
  loadedMatchRecords.clear()
  matchRecordRequests.clear()
  deferredState = null
  deferredPatches = []
  deferredResync = false
  onlineState.clubCoaches = null
  onlineState.status = 'connecting'
  notify()
  try {
    const snapshot = await requestJson<CoachSnapshot & { user?: OnlineUser; game: GameState; revision: number }>('/api/game', { cache: 'no-store' }, 30_000)
    if (!snapshot.game || !Number.isSafeInteger(snapshot.revision)) throw new Error('服务器返回的存档无效，请重试。')
    hydrateOnlineGame(snapshot.game)
    // 滚动更新期间旧服务端尚未在快照里附带账号信息。
    onlineState.user = snapshot.user ?? (await requestJson<{ user: OnlineUser }>('/api/me', undefined, ACTION_TIMEOUT_MS)).user
    onlineState.clubCoaches = snapshot.clubCoaches ?? null
    onlineState.revision = snapshot.revision
    syncedGame = snapshot.game
    onlineState.error = ''
    onlineState.status = 'online'
    onlineState.lastSync = Date.now()
    setRemoteSaver((next) => queueSave(next))
    connectEvents()
    notify()
    return snapshot.game
  } catch (error) {
    onlineState.status = 'offline'
    onlineState.error = error instanceof Error ? error.message : '连接服务器失败'
    if (onlineState.error.includes('请先登录')) {
      setToken(null)
      onlineState.user = null
    }
    notify()
    return null
  }
}

function acceptSession(data: AuthResponse): void {
  ++sessionEpoch
  ++publicWorldRequest
  publicWorld = null
  loadedMatchRecords.clear()
  matchRecordRequests.clear()
  deferredState = null
  deferredPatches = []
  deferredResync = false
  clearAITransferMarket()
  hydrateOnlineGame(data.game)
  setToken(data.token)
  onlineState.clubCoaches = data.clubCoaches ?? null
  onlineState.user = data.user
  onlineState.revision = data.revision
  syncedGame = data.game ?? null
  onlineState.status = 'online'
  onlineState.connected = false
  onlineState.error = ''
  onlineState.lastSync = Date.now()
  setRemoteSaver((next) => queueSave(next))
  connectEvents()
  notify()
}

function connectEvents(): void {
  if (!token || typeof EventSource === 'undefined') return
  eventSource?.close()
  const params = new URLSearchParams({
    token,
    client: clientId,
    lazyCup: '1',
    slim: '1',
    delta: '1',
  })
  if (syncedGame && Number.isSafeInteger(onlineState.revision) && onlineState.revision > 0) {
    params.set('sinceRevision', String(onlineState.revision))
    params.set('hasLive', syncedGame.activeMatch?.preplayed ? '1' : '0')
  }
  eventSource = new EventSource(`/api/events?${params.toString()}`)
  eventSource.onopen = () => {
    onlineState.connected = true
    notify()
  }
  eventSource.onerror = () => {
    onlineState.connected = false
    notify()
  }
  eventSource.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data) as SsePayload
      if (parsed.type === 'market') {
        applyMarket(parsed as MarketMessage)
        return
      }
      if (parsed.type === 'chat') {
        applyChat(parsed as ChatSseMessage)
        return
      }
      if (parsed.type === 'state-sync') {
        syncServerClock(parsed.serverTime)
        if (parsed.revision < onlineState.revision) return
        if (parsed.clubCoaches) onlineState.clubCoaches = parsed.clubCoaches
        onlineState.lastSync = Date.now()
        onlineState.connected = true
        if (!(saving || pendingGame)) onlineState.revision = parsed.revision
        notify()
        return
      }
      if (parsed.type === 'state-stale') {
        syncServerClock(parsed.serverTime)
        if (parsed.clubCoaches) onlineState.clubCoaches = parsed.clubCoaches
        onlineState.connected = true
        if (parsed.revision > onlineState.revision || !syncedGame) {
          if (saving || pendingGame) deferredResync = true
          else triggerResyncFromServer()
        }
        notify()
        return
      }
      if (parsed.type === 'state-patch') {
        syncServerClock(parsed.serverTime)
        if (parsed.revision < onlineState.revision) return
        if (parsed.clubCoaches) onlineState.clubCoaches = parsed.clubCoaches
        onlineState.lastSync = Date.now()
        onlineState.connected = true
        if (parsed.source === clientId) {
          if (!(saving || pendingGame)) onlineState.revision = parsed.revision
          notify()
          return
        }
        if (saving || pendingGame) {
          deferredPatches.push(parsed)
          notify()
          return
        }
        if (!syncedGame || parsed.baseRevision !== onlineState.revision) {
          triggerResyncFromServer()
          notify()
          return
        }
        const next = applyStatePatch(syncedGame, parsed)
        syncedGame = next
        onlineState.revision = parsed.revision
        remoteGameHandler?.(next)
        if (publicWorld && next.world?.seasonIndex !== publicWorld.seasonIndex) void refreshPublicWorld()
        notify()
        return
      }
      const data = parsed as StateResponse
      if (data.type !== 'state' || !data.game) return
      syncServerClock(data.serverTime)
      if (data.revision < onlineState.revision) return
      hydrateOnlineGame(data.game)
      if (data.clubCoaches) onlineState.clubCoaches = data.clubCoaches
      onlineState.lastSync = Date.now()
      onlineState.connected = true
      if (data.source !== clientId && (saving || pendingGame)) {
        // 尚未应用的推送不能先提高本地版本，否则保存结束时会把它当作旧档丢掉。
        if (!deferredState || data.revision >= deferredState.revision) deferredState = data
        deferredPatches = []
      } else {
        onlineState.revision = data.revision
        syncedGame = data.game
        if (data.source !== clientId) remoteGameHandler?.(data.game)
      }
      if (publicWorld && data.game.world?.seasonIndex !== publicWorld.seasonIndex) void refreshPublicWorld()
      notify()
    } catch {
      // 忽略心跳或损坏消息。
    }
  }
}

function applyMarket(data: MarketMessage): void {
  const previous = marketState.auctions
  const previousLog = marketState.log
  marketState.auctions = data.auctions
  marketState.log = data.log
  marketState.serverOffset = data.serverTime - Date.now()
  for (const listener of marketListeners) listener(previous, previousLog)
  if (data.version !== marketState.version) void refreshMarketPool()
  notify()
}

/** 球员池比较大，只在它变了的时候才拉。 */
async function refreshMarketPool(): Promise<void> {
  try {
    const data = await requestJson<MarketMessage & { pool: Player[] }>('/api/market')
    marketState.pool = data.pool
    marketState.version = data.version
    notify()
  } catch {
    // 下一条市场消息还会再试。
  }
}

function applyChat(data: ChatSseMessage): void {
  syncServerClock(data.serverTime)
  if (data.mode === 'snapshot') {
    chatState.messages = Array.isArray(data.messages)
      ? data.messages.filter(isValidChatMessage).slice(-CHAT_HISTORY_LIMIT)
      : []
    const seenAt = readChatSeenAt()
    if (seenAt <= 0) {
      writeChatSeenAt(Math.max(chatState.messages.at(-1)?.at ?? 0, serverNow()))
      chatState.unread = 0
    } else {
      const me = onlineState.user?.id
      chatState.unread = Math.min(
        CHAT_HISTORY_LIMIT,
        chatState.messages.filter((item) => item.at > seenAt && item.accountId !== me).length,
      )
    }
    for (const listener of chatListeners) listener({ kind: 'snapshot' })
    notify()
    return
  }
  if (data.mode === 'append' && isValidChatMessage(data.message)) {
    const alreadyHad = chatState.messages.some((item) => item.id === data.message.id)
    chatState.messages = appendChatMessage(chatState.messages, data.message, CHAT_HISTORY_LIMIT)
    if (!alreadyHad) {
      if (data.message.accountId !== onlineState.user?.id) {
        chatState.unread = Math.min(CHAT_HISTORY_LIMIT, chatState.unread + 1)
      }
      for (const listener of chatListeners) listener({ kind: 'append', added: data.message })
    }
    notify()
  }
}

export async function refreshChatOnline(): Promise<void> {
  if (onlineState.status !== 'online') return
  try {
    const data = await requestJson<{ messages: ChatMessage[]; serverTime?: number }>('/api/chat')
    applyChat({ type: 'chat', mode: 'snapshot', messages: data.messages, serverTime: data.serverTime ?? serverNow() })
  } catch {
    // 网络暂时中断时保留本地消息列表。
  }
}

export async function sendChatOnline(text: string): Promise<ChatMessage> {
  chatState.sending = true
  notify()
  try {
    const data = await requestJson<{ ok: boolean; message: ChatMessage; serverTime?: number }>('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    const alreadyHad = chatState.messages.some((item) => item.id === data.message.id)
    chatState.messages = appendChatMessage(chatState.messages, data.message, CHAT_HISTORY_LIMIT)
    markChatSeen()
    if (!alreadyHad) {
      for (const listener of chatListeners) listener({ kind: 'append', added: data.message })
    }
    return data.message
  } finally {
    chatState.sending = false
    notify()
  }
}

export async function bidOnline(playerId: string, amount: number): Promise<void> {
  await flushOnlineNow()
  const data = await requestJson<MarketMessage>('/api/market/bid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, amount }),
  })
  applyMarket(data)
}

function queueSave(game: GameState): void {
  if (!token) return
  pendingGame = structuredClone(game)
  pendingRevision = onlineState.revision
  if (saveTimer !== null) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    void flushSave()
  }, 250)
}

async function flushSave(): Promise<void> {
  if (saving) {
    await saveFinished
    return
  }
  if (!token || !pendingGame) return
  saving = true
  let finishSave!: () => void
  saveFinished = new Promise<void>((resolve) => { finishSave = resolve })
  const game = pendingGame
  const baseRevision = pendingRevision
  pendingGame = null
  try {
    const result = await requestJson<{ ok: boolean; revision: number; updatedAt: number }>('/api/game', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      // 联赛直播回放是服务器下发的副本，不存回服务器（几十 KB 的初始引擎状态）。
      body: JSON.stringify({ game: withoutDeferredCupPool(game.activeMatch?.preplayed ? { ...game, activeMatch: undefined } : game), baseRevision }),
    }, SAVE_TIMEOUT_MS)
    if (pendingGame && pendingRevision === baseRevision) pendingRevision = result.revision
    onlineState.revision = Math.max(onlineState.revision, result.revision)
    syncedGame = game
    onlineState.lastSync = result.updatedAt
    onlineState.error = ''
  } catch (error) {
    // 保存失败不等于退出联机会话；保留服务器球队快照，不能切到本地推进逻辑。
    onlineState.error = error instanceof Error ? error.message : '同步失败'
    if (onlineState.error.includes('另一设备')) {
      try {
        const current = await requestJson<{ game: GameState; revision: number }>('/api/game', undefined, RECOVERY_TIMEOUT_MS)
        hydrateOnlineGame(current.game)
        onlineState.revision = current.revision
        syncedGame = current.game
        remoteGameHandler?.(current.game)
      } catch {
        // 留到下一次 SSE/手动刷新。
      }
    }
  } finally {
    saving = false
    finishSave()
    saveFinished = null
    if (!pendingGame) {
      if (deferredState) {
        // 自己保存成功后，保存前收到的同版本 SSE 不能覆盖已推进的本地比赛。
        if (deferredState.revision > onlineState.revision) {
          onlineState.revision = deferredState.revision
          syncedGame = deferredState.game
          remoteGameHandler?.(deferredState.game)
        }
        deferredState = null
      }
      if (deferredPatches.length) {
        const queued = deferredPatches
        deferredPatches = []
        let applied = false
        for (const patch of queued) {
          if (patch.revision <= onlineState.revision) continue
          if (syncedGame && patch.baseRevision === onlineState.revision) {
            syncedGame = applyStatePatch(syncedGame, patch)
            onlineState.revision = patch.revision
            applied = true
          } else {
            deferredResync = true
            break
          }
        }
        if (applied && !deferredResync && syncedGame) remoteGameHandler?.(syncedGame)
      }
      if (deferredResync) {
        deferredResync = false
        triggerResyncFromServer()
      }
    }
    notify()
    if (pendingGame) {
      if (saveTimer !== null) window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => {
        saveTimer = null
        void flushSave()
      }, 250)
    }
  }
}

export async function flushOnlineNow(): Promise<void> {
  if (saveTimer !== null) window.clearTimeout(saveTimer)
  saveTimer = null
  while (token && (pendingGame || saving)) await flushSave()
}

export function hasOnlineSession(): boolean {
  return !!token
}

/**
 * 本次是否已载入联机存档；临时断流或保存失败都不改变游戏模式。
 * 启动页选了「离线模式」时，本地令牌仍然保留（方便下次继续联机），
 * 但这一局的所有推进都必须走本地，不能因为“有令牌”就去请求服务器。
 */
export function isOnlineMode(): boolean {
  return onlineState.status === 'online'
}

/** 联机时本轮还没到全服开赛时间（服务器会拒绝 start_league）。用服务器时间判断，避免本机时钟偏差。 */
export function onlineKickoffPending(game: GameState): boolean {
  return isOnlineMode() && game.season.round > dueRound(game, serverNow())
}

export async function leagueActionOnline(body: Record<string, unknown>): Promise<GameState> {
  return onlineGameAction('/api/match/action', body)
}

/** 巅峰次数由服务器原子扣除，避免多设备重复使用。 */
export async function startPeakOnline(stage: number): Promise<GameState> {
  try {
    return await onlineGameAction('/api/peak/start', { stage })
  } catch (error) {
    // 其他设备可能已经消耗次数，失败后拉回权威状态以更新页面。
    try {
      const current = await requestJson<{ game: GameState; revision: number }>('/api/game')
      if (current.revision >= onlineState.revision) {
        hydrateOnlineGame(current.game)
        onlineState.revision = current.revision
        syncedGame = current.game
        remoteGameHandler?.(current.game)
        notify()
      }
    } catch { /* 保留原始错误 */ }
    throw error
  }
}

/** 联机改俱乐部名字：服务器检查字数和重名，成功后全服看到的新名字一起更新。 */
export async function renameClubOnline(name: string): Promise<GameState> {
  const game = await onlineGameAction('/api/club/rename', { name })
  if (publicWorld) void refreshPublicWorld()
  return game
}

/** 联机向 AI 球队买人：服务器按放人规则和球员诉求判定，成交后共享名册同步。失败时抛出原因。 */
export async function buyFromAIClubOnline(body: { teamId: string; playerId: string; offer: number; goal: string; role: string }): Promise<GameState> {
  return onlineGameAction('/api/transfer/ai-buy', body)
}

/** 联机回复 AI 俱乐部的报价。 */
export async function respondOfferOnline(offerId: string, accept: boolean): Promise<GameState> {
  return onlineGameAction('/api/transfer/offer', { offerId, accept })
}

/** 响应丢失或并发失败时先取回权威状态：请求可能已提交，不能盲目在本地重做。 */
async function protectedGameAction(endpoint: string, body: Record<string, unknown> | (() => Record<string, unknown>)): Promise<GameState> {
  await requireSyncedOnline()
  try {
    return await submitGameAction(endpoint, body, ACTION_TIMEOUT_MS)
  } catch (error) {
    try {
      const current = await requestJson<{ game: GameState; revision: number }>('/api/game', undefined, RECOVERY_TIMEOUT_MS)
      if (current.revision >= onlineState.revision) {
        hydrateOnlineGame(current.game)
        onlineState.revision = current.revision
        syncedGame = current.game
        remoteGameHandler?.(current.game)
        notify()
      }
    } catch { /* 保留原始错误，用户可手动刷新检查。 */ }
    if (error instanceof OnlineTimeoutError) throw new Error('服务器响应超时，操作结果尚未确认。请刷新检查后再操作。')
    throw error
  }
}

export async function recycleCardsOnline(cardIds: string[], baseRevision: number): Promise<GameState> {
  return protectedGameAction('/api/cards/recycle', { cardIds, baseRevision })
}

export async function setCardRecycleLockOnline(cardId: string, locked: boolean): Promise<GameState> {
  return protectedGameAction('/api/cards/lock', { cardId, locked })
}

export async function startScoutingOnline(playerId: string, source: ScoutSource, level: ScoutLevel, clubId?: string): Promise<GameState> {
  return protectedGameAction('/api/scouting/start', { playerId, source, level, clubId })
}

export async function deleteScoutingOnline(reportId: string): Promise<GameState> {
  // 排队的普通存档可能先把 revision 推进，必须在 flush 后再取版本。
  return protectedGameAction('/api/scouting/delete', () => ({ reportId, baseRevision: onlineState.revision }))
}

/** 只合并当前存档中仍存在的已完成报告，不应用服务器存档快照。 */
export async function refreshGameOnline(currentGame: () => GameState): Promise<boolean> {
  const requestToken = token
  const user = onlineState.user?.id
  const epoch = sessionEpoch
  const currentSession = () => !!requestToken && token === requestToken && !!user && onlineState.user?.id === user && sessionEpoch === epoch && isOnlineMode()
  await flushOnlineNow()
  if (sessionEpoch !== epoch || token !== requestToken || onlineState.user?.id !== user) return false
  if (!currentSession() || onlineState.error) throw new Error(onlineState.error || '请先连接服务器')
  let result: { response: Response; data: { reports?: VisibleScoutReport[]; serverTime?: number; error?: string } }
  try {
    result = await withRequestTimeout(ACTION_TIMEOUT_MS, async (signal) => {
      const response = await fetch('/api/scouting/reports', { signal, headers: { Authorization: `Bearer ${requestToken}`, 'X-FM-Client': clientId } })
      return { response, data: await response.json() }
    })
  } catch (error) {
    if (!currentSession()) return false
    throw error
  }
  if (!currentSession()) return false
  const { response, data } = result
  if (!response.ok) throw new Error(data.error ?? `请求失败 (${response.status})`)
  if (!Array.isArray(data.reports) || typeof data.serverTime !== 'number' || !Number.isFinite(data.serverTime)) throw new Error('报告响应无效')
  const reports = data.reports
  const game = currentGame()
  if (Array.isArray(game.scoutReports)) {
    game.scoutReports = game.scoutReports.map(local => {
      const completed = reports.find(report => report.id === local.id && report.playerId === local.playerId && report.source === local.source && report.clubId === local.clubId && report.readyAt === local.readyAt && report.readyAt <= data.serverTime! && 'estimatedAttrs' in report && !!report.estimatedAttrs)
      return completed && 'estimatedAttrs' in completed ? completed : local
    })
  }
  syncServerClock(data.serverTime)
  notify()
  return true
}

let cupSnapshot: { epoch: number; value: CupSeasonState } | undefined
let cupRequest: { epoch: number; season: number; pending: Promise<void> } | undefined
const loadedMatchRecords = new Map<string, MatchRecord>()
const matchRecordRequests = new Map<string, Promise<MatchRecord>>()

/** Keep loaded match details across SSE updates, cleared on logout or account switch. */
export function applyLoadedMatchRecords(game: GameState): void {
  if (!loadedMatchRecords.size) return
  if (Array.isArray(game.matchHistory)) {
    for (let i = 0; i < game.matchHistory.length; i++) {
      const rec = game.matchHistory[i]
      if (rec?.detailDeferred) {
        const full = loadedMatchRecords.get(rec.id)
        if (full) game.matchHistory[i] = full
      }
    }
  }
  if (Array.isArray(game.challengeHistory)) {
    for (let i = 0; i < game.challengeHistory.length; i++) {
      const rec = game.challengeHistory[i]
      if (rec?.detailDeferred) {
        const full = loadedMatchRecords.get(rec.id)
        if (full) game.challengeHistory[i] = full
      }
    }
  }
}

export function isMatchRecordLoading(id: string): boolean {
  return matchRecordRequests.has(id)
}

export function loadMatchRecordOnline(id: string): Promise<MatchRecord> {
  const epoch = sessionEpoch
  if (!token || !isOnlineMode()) return Promise.reject(new Error('请先连接服务器'))
  const cached = loadedMatchRecords.get(id)
  if (cached) return Promise.resolve(cached)
  const existing = matchRecordRequests.get(id)
  if (existing) return existing
  const pending = requestJson<{ record: MatchRecord }>(`/api/match/record?id=${encodeURIComponent(id)}`, undefined, ACTION_TIMEOUT_MS)
    .then(({ record }) => {
      if (epoch !== sessionEpoch || !isOnlineMode()) throw new Error('会话已变化')
      if (!record || record.id !== id) throw new Error('战报响应无效')
      loadedMatchRecords.set(id, record)
      while (loadedMatchRecords.size > 16) loadedMatchRecords.delete(loadedMatchRecords.keys().next().value!)
      if (syncedGame) applyLoadedMatchRecords(syncedGame)
      return record
    })
    .finally(() => {
      if (matchRecordRequests.get(id) === pending) matchRecordRequests.delete(id)
      notify()
    })
  matchRecordRequests.set(id, pending)
  notify()
  return pending
}

/** Keep loaded opponents across state broadcasts, but never across a new login or season. */
export function applyLoadedCupSeason(game: GameState): void {
  if (game.pve?.cupSeasonDeferred && !game.pve.cupSeason && cupSnapshot?.epoch === sessionEpoch && cupSnapshot.value.seasonIndex === game.season.index) {
    game.pve.cupSeason = cupSnapshot.value
  }
}

export function loadCupSeasonOnline(season: number): Promise<void> {
  const epoch = sessionEpoch
  if (!token || !isOnlineMode()) return Promise.reject(new Error('请先连接服务器'))
  if (cupSnapshot?.epoch === epoch && cupSnapshot.value.seasonIndex === season) return Promise.resolve()
  if (cupRequest?.epoch === epoch && cupRequest.season === season) return cupRequest.pending
  const pending = requestJson<{ cupSeason: CupSeasonState }>(`/api/pve/cup-season?season=${season}`, undefined, ACTION_TIMEOUT_MS).then(({ cupSeason }) => {
    if (cupRequest?.pending !== pending || sessionEpoch !== epoch || !isOnlineMode()) return
    if (cupSeason?.version !== 1 || cupSeason.seasonIndex !== season || !cupSeason.fields || !cupSeason.worldTeams) throw new Error('杯赛对手数据无效')
    cupSnapshot = { epoch, value: cupSeason }
  }).finally(() => { if (cupRequest?.pending === pending) cupRequest = undefined })
  cupRequest = { epoch, season, pending }
  return pending
}

export async function youthActionOnline(body: import('./game/youth-actions.ts').YouthAction): Promise<GameState> {
  return protectedGameAction('/api/youth/action', () => ({ ...body, baseRevision: onlineState.revision }))
}

export async function startTrainingOnline(playerId: string, bookKeys: string[], points: number): Promise<GameState> {
  return protectedGameAction('/api/training/start', { playerId, bookKeys, points })
}

export async function buyShopBookOnline(skillId: string): Promise<GameState> {
  return protectedGameAction('/api/shop/buy', { skillId })
}

export async function chooseBoardAmbitionOnline(
  ambition: import('./game/types.ts').BoardAmbition,
  options: { scope?: 'offseason' | 'current'; lock?: boolean } = {},
): Promise<GameState> {
  return protectedGameAction('/api/board/choose', {
    ambition,
    ...(options.scope ? { scope: options.scope } : {}),
    ...(options.lock ? { lock: true } : {}),
  })
}

export async function adjustBoardBudgetOnline(transferDelta: number): Promise<GameState> {
  return protectedGameAction('/api/board/slider', { transferDelta })
}

export async function upgradeFacilityOnline(facilityId: import('./game/types.ts').FacilityId): Promise<GameState> {
  return protectedGameAction('/api/club/upgrade', { facilityId })
}

export async function nextWorldSeasonOnline(): Promise<GameState> {
  const next = await onlineGameAction('/api/world/next-season', {})
  if (publicWorld) void refreshPublicWorld()
  return next
}

async function requireSyncedOnline(): Promise<void> {
  await flushOnlineNow()
  if (onlineState.status !== 'online' || onlineState.error) throw new Error(onlineState.error || '请先连接服务器')
}

async function onlineGameAction(endpoint: string, body: Record<string, unknown>): Promise<GameState> {
  await requireSyncedOnline()
  return submitGameAction(endpoint, body)
}

async function submitGameAction(endpoint: string, body: Record<string, unknown> | (() => Record<string, unknown>), timeoutMs?: number): Promise<GameState> {
  const result = await requestJson<{ revision: number; game: GameState }>(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(typeof body === 'function' ? body() : body),
  }, timeoutMs)
  if (!Number.isSafeInteger(result.revision) || !result.game) throw new Error('服务器返回的存档无效，请刷新检查。')
  hydrateOnlineGame(result.game)
  if (result.revision >= onlineState.revision) {
    onlineState.revision = result.revision
    onlineState.lastSync = Date.now()
    syncedGame = result.game
    remoteGameHandler?.(result.game)
    notify()
  }
  return result.game
}

export async function initOnline(): Promise<GameState | null> {
  const game = await restoreSession()
  if (game) return game
  return null
}

/** 让本地离线流程也保留一份最新存档；联网时再由 remoteSaver 推送。 */
export function saveLocally(game: GameState): void {
  saveGame(game)
}

/** 联机友谊赛对手名单：服务器返回权威阵容（其他教练的球队也一样）。 */
export async function fetchFriendlyTeam(clubId: string): Promise<{ team: AITeam } | { error: string }> {
  const response = await fetch('/api/world/friendly-team', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ clubId }),
  })
  const data = await response.json().catch(() => ({})) as { team?: AITeam; error?: string }
  return response.ok && data.team ? { team: data.team } : { error: data.error ?? '服务器没有返回对手名单' }
}

export async function createAgentTokenOnline(): Promise<string> {
  const data = await requestJson<{ token: string }>('/api/agent/token', { method: 'POST' })
  return data.token
}

export async function revokeAgentTokenOnline(): Promise<void> {
  await requestJson('/api/agent/revoke', { method: 'POST' })
}
