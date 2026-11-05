import type { Auction, AuctionResult } from './game/auction.ts'
import type { AITeam, Attributes, GameState, Player, SeasonTableRow, Fixture, TierId, ConferenceId } from './game/types.ts'
import { setRemoteSaver, saveGame } from './game/state.ts'

const TOKEN_KEY = 'fm-online-token'

export type OnlineUser = { id: string; username: string }
export type OnlineStatus = 'offline' | 'connecting' | 'online'

export const onlineState: {
  status: OnlineStatus
  user: OnlineUser | null
  revision: number
  connected: boolean
  error: string
  lastSync: number
} = {
  status: 'offline',
  user: null,
  revision: 0,
  connected: false,
  error: '',
  lastSync: 0,
}

/** 全服自由市场。只有联机时有内容；单机还是用存档里的 freeStars。 */
export type WorldPublicPlayer = Pick<Player, 'id' | 'name' | 'enName' | 'country' | 'era' | 'age' | 'foot' | 'height' | 'positions' | 'traitId' | 'skills' | 'skillTiers'> & { attrs: Partial<Attributes>; ca: number }
export type WorldPublicClub = Pick<AITeam, 'id' | 'name' | 'color' | 'formationId'> & { tier: TierId; conference?: ConferenceId; managed?: boolean; players: WorldPublicPlayer[] }
export type WorldPublicSnapshot = {
  seasonIndex: number
  ownClubId: string | null
  clubs: WorldPublicClub[]
  divisions: { id: string; tier?: TierId; conference?: ConferenceId; round: number; table: SeasonTableRow[]; fixtures: Fixture[] }[]
}

/** 只包含公开球员资料，不接收体能、精力或教练存档。 */
export let publicWorld: WorldPublicSnapshot | null = null
let publicWorldRequest = 0

export async function refreshPublicWorld(): Promise<void> {
  if (onlineState.status !== 'online') return
  const request = ++publicWorldRequest
  try {
    const data = await requestJson<WorldPublicSnapshot>('/api/world/teams')
    if (request === publicWorldRequest && onlineState.status === 'online') {
      publicWorld = data
      notify()
    }
  } catch {
    // 网络中断时保留最近一次快照，下次打开世界页再重试。
  }
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

type AuthResponse = { token: string; user: OnlineUser; revision: number; game: GameState }
type StateResponse = { type: 'state'; revision: number; game: GameState; source?: string }

const clientId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
let token = typeof localStorage === 'undefined' ? null : localStorage.getItem(TOKEN_KEY)
let eventSource: EventSource | null = null
let deferredState: StateResponse | null = null
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
  return token ? { Authorization: `Bearer ${token}`, 'X-FM-Client': clientId } : {}
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...(init?.headers ?? {}), ...authHeaders() } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error((data as { error?: string }).error ?? `请求失败 (${response.status})`)
  return data as T
}

export async function registerOnline(
  username: string,
  password: string,
  extra: { inviteCode?: string; turnstileToken?: string } = {},
): Promise<AuthResponse> {
  const data = await requestJson<AuthResponse>('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      ...(extra.inviteCode ? { inviteCode: extra.inviteCode } : {}),
      ...(extra.turnstileToken ? { turnstileToken: extra.turnstileToken } : {}),
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
  await flushOnlineNow()
  try {
    await requestJson('/api/logout', { method: 'POST' })
  } catch {
    // 离线退出也要清掉本地令牌。
  }
  eventSource?.close()
  eventSource = null
  deferredState = null
  setRemoteSaver(null)
  setToken(null)
  onlineState.status = 'offline'
  onlineState.user = null
  onlineState.connected = false
  onlineState.revision = 0
  onlineState.error = ''
  Object.assign(marketState, { pool: [], auctions: [], log: [], version: 0 })
  ++publicWorldRequest
  publicWorld = null
  notify()
}

async function restoreSession(): Promise<GameState | null> {
  if (!token) return null
  onlineState.status = 'connecting'
  notify()
  try {
    const me = await requestJson<{ user: OnlineUser; revision: number }>('/api/me')
    onlineState.user = me.user
    const game = await requestJson<{ game: GameState; revision: number }>('/api/game')
    onlineState.revision = game.revision
    onlineState.status = 'online'
    onlineState.lastSync = Date.now()
    setRemoteSaver((next) => queueSave(next))
    connectEvents()
    notify()
    void refreshPublicWorld()
    return game.game
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
  setToken(data.token)
  onlineState.user = data.user
  onlineState.revision = data.revision
  onlineState.status = 'online'
  onlineState.connected = false
  onlineState.error = ''
  onlineState.lastSync = Date.now()
  setRemoteSaver((next) => queueSave(next))
  connectEvents()
  notify()
  void refreshPublicWorld()
}

function connectEvents(): void {
  if (!token || typeof EventSource === 'undefined') return
  eventSource?.close()
  eventSource = new EventSource(`/api/events?token=${encodeURIComponent(token)}`)
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
      const parsed = JSON.parse(event.data) as StateResponse | MarketMessage
      if (parsed.type === 'market') {
        applyMarket(parsed as MarketMessage)
        return
      }
      const data = parsed as StateResponse
      if (data.type !== 'state' || !data.game) return
      if (data.revision < onlineState.revision) return
      onlineState.revision = data.revision
      onlineState.lastSync = Date.now()
      onlineState.connected = true
      if (data.source !== clientId) {
        if (saving || pendingGame) deferredState = data
        else remoteGameHandler?.(data.game)
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
      body: JSON.stringify({ game, baseRevision }),
    })
    if (pendingGame && pendingRevision === baseRevision) pendingRevision = result.revision
    onlineState.revision = Math.max(onlineState.revision, result.revision)
    onlineState.lastSync = result.updatedAt
    onlineState.error = ''
    onlineState.status = 'online'
  } catch (error) {
    onlineState.error = error instanceof Error ? error.message : '同步失败'
    onlineState.status = 'offline'
    if (onlineState.error.includes('另一设备')) {
      try {
        const current = await requestJson<{ game: GameState; revision: number }>('/api/game')
        onlineState.revision = current.revision
        remoteGameHandler?.(current.game)
        onlineState.status = 'online'
      } catch {
        // 留到下一次 SSE/手动刷新。
      }
    }
  } finally {
    saving = false
    finishSave()
    saveFinished = null
    if (!pendingGame && deferredState) {
      // 自己保存成功后，保存前收到的同版本 SSE 不能覆盖已推进的本地比赛。
      if (deferredState.revision > onlineState.revision) remoteGameHandler?.(deferredState.game)
      deferredState = null
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

export async function leagueActionOnline(body: Record<string, unknown>): Promise<GameState> {
  return onlineGameAction('/api/match/action', body)
}

export async function nextWorldSeasonOnline(): Promise<GameState> {
  const next = await onlineGameAction('/api/world/next-season', {})
  void refreshPublicWorld()
  return next
}

async function onlineGameAction(endpoint: string, body: Record<string, unknown>): Promise<GameState> {
  await flushOnlineNow()
  if (onlineState.status !== 'online' || onlineState.error) throw new Error(onlineState.error || '请先连接服务器')
  const result = await requestJson<{ revision: number; game: GameState }>(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (result.revision >= onlineState.revision) {
    onlineState.revision = result.revision
    onlineState.lastSync = Date.now()
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
