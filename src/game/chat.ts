import type { AttrKey, GameState, MatchRecord, PlayerCard, Position, RouteId, SkillId, SkillTier } from './types.ts'
import { POSITIONS } from './types.ts'
import { caOf } from './ca.ts'
import { cardDisplayName, cardsOf } from './cards.ts'
import { SKILLS } from './data/skills.ts'
import { displayClock, LOGIC_MATCH_SECONDS } from './match/time.ts'
import { extractMatchHighlights } from './review.ts'
import { mainAttrsFor } from './scale.ts'
import { playerAppearanceId } from './appearance.ts'

/** 全服聊天：内存中与落盘均只保留最新的 50 条消息。 */
export const CHAT_HISTORY_LIMIT = 50
export const CHAT_MAX_LENGTH = 200
export const CHAT_COOLDOWN_MS = 1_500

export const DEFAULT_CARD_SHARE_TEXT = '[晒出角色卡]'
export const DEFAULT_MATCH_SHARE_TEXT = '[分享比赛战报]'

export type ChatShareRequest =
  | { kind: 'card'; cardId: string }
  | { kind: 'match'; recordId: string }

export type ChatSharedCard = {
  kind: 'card'
  cardId: string
  playerId: string
  playerName: string
  cardTitle: string
  routeId?: RouteId
  appearanceId?: string
  height?: number
  ca: number
  country?: string
  age?: number
  positions: Record<Position, number>
  /** 仅包含公开的主属性（外场 7 项或门将 6 项），不下发隐藏属性。 */
  attrs: Partial<Record<AttrKey, number>>
  skills: SkillId[]
  skillTiers?: Partial<Record<SkillId, SkillTier>>
}

export type ChatSharedGoal = {
  minute: string
  playerName: string
  side: 'home' | 'away'
  assistName?: string
  appearanceId?: string
  height?: number
  number?: number
  assistAppearanceId?: string
  assistHeight?: number
  assistNumber?: number
  origin?: { x: number; y: number }
  distance?: number
  bodyPart?: 'left' | 'right' | 'head'
  technique?: 'power' | 'placed' | 'header'
  situation?: 'open' | 'penalty' | 'free_kick'
  target?: 'top_left' | 'top_center' | 'top_right' | 'bottom_left' | 'bottom_center' | 'bottom_right'
}

export type ChatSharedMatch = {
  kind: 'match'
  recordId: string
  competition: string
  homeName: string
  awayName: string
  homeColor: string
  awayColor: string
  score: { home: number; away: number }
  shootout?: { home: number; away: number }
  stats: {
    possession: [number, number]
    shots: [number, number]
    shotsOnTarget: [number, number]
    xg: [number, number]
  }
  goals: ChatSharedGoal[]
  highlights: { badge: string; shortLabel: string; side: 'home' | 'away' | 'none' }[]
  mvp?: { name: string; line: string }
}

export type ChatAttachment = ChatSharedCard | ChatSharedMatch

export type ChatMessage = {
  id: string
  accountId: string
  username: string
  clubId: string
  clubName: string
  clubColor: string
  text: string
  at: number
  share?: ChatAttachment
}

export type ChatSseMessage =
  | { type: 'chat'; mode: 'snapshot'; messages: ChatMessage[]; serverTime: number }
  | { type: 'chat'; mode: 'append'; message: ChatMessage; serverTime: number }

const SAFE_HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/

export function sanitizeChatColor(raw: unknown): string {
  return typeof raw === 'string' && SAFE_HEX_COLOR.test(raw.trim()) ? raw.trim() : '#4fd08a'
}

/** 去掉控制字符、折叠连续空白与换行，防止刷屏撑高列表。 */
export function normalizeChatText(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function validateChatText(
  raw: unknown,
  fallbackForShare?: string,
): { ok: true; text: string } | { ok: false; error: string } {
  const text = normalizeChatText(raw)
  if (!text) {
    if (fallbackForShare) return { ok: true, text: fallbackForShare }
    return { ok: false, error: '消息内容不能为空' }
  }
  const length = [...text].length
  if (length > CHAT_MAX_LENGTH) return { ok: false, error: `消息最多 ${CHAT_MAX_LENGTH} 个字（当前 ${length} 字）` }
  return { ok: true, text }
}

export function parseChatShareRequest(raw: unknown): ChatShareRequest | null | 'invalid' {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object') return 'invalid'
  const obj = raw as Record<string, unknown>
  if (obj.kind === 'card' && typeof obj.cardId === 'string' && obj.cardId.trim().length > 0 && obj.cardId.length <= 80) {
    return { kind: 'card', cardId: obj.cardId.trim() }
  }
  if (obj.kind === 'match' && typeof obj.recordId === 'string' && obj.recordId.trim().length > 0 && obj.recordId.length <= 120) {
    return { kind: 'match', recordId: obj.recordId.trim() }
  }
  return 'invalid'
}

/** 从玩家权威存档生成安全公开的角色卡名片快照（仅含主属性，不含隐藏属性或性格）。 */
export function buildChatSharedCard(game: GameState, cardId: string): ChatSharedCard | null {
  const card: PlayerCard | undefined = cardsOf(game).find((c) => c.id === cardId)
  if (!card) return null
  const owner = game.roster.find((p) => p.id === card.playerId)
  const isGk = (card.positions?.GK ?? 0) > 0
  const keys = mainAttrsFor(isGk)
  const publicAttrs: Partial<Record<AttrKey, number>> = {}
  for (const key of keys) {
    const v = card.attrs[key]
    if (typeof v === 'number' && Number.isFinite(v)) publicAttrs[key] = Math.round(v)
  }
  const positions = {} as Record<Position, number>
  for (const pos of POSITIONS) {
    positions[pos] = Math.round(card.positions?.[pos] ?? 0)
  }
  const validSkills = (card.skills ?? []).filter((id): id is SkillId => Object.hasOwn(SKILLS, id)).slice(0, 8)
  const tiers: Partial<Record<SkillId, SkillTier>> = {}
  for (const s of validSkills) {
    const t = card.skillTiers?.[s]
    if (t === 'silver' || t === 'gold' || t === 'rainbow') tiers[s] = t
  }
  return {
    kind: 'card',
    cardId: card.id,
    playerId: card.playerId,
    playerName: card.playerName || owner?.name || '未知球员',
    cardTitle: cardDisplayName(card),
    ...(card.routeId ? { routeId: card.routeId } : {}),
    ...(owner ? { appearanceId: playerAppearanceId(owner), height: owner.height } : {}),
    ca: Math.round(caOf(card.attrs, isGk) * 10) / 10,
    ...(owner?.country ? { country: owner.country } : {}),
    ...(typeof owner?.age === 'number' ? { age: owner.age } : {}),
    positions,
    attrs: publicAttrs,
    skills: validSkills,
    ...(Object.keys(tiers).length > 0 ? { skillTiers: tiers } : {}),
  }
}

function competitionLabelOf(record: MatchRecord): string {
  if (record.isLeague) return `联赛第 ${record.round ?? 1} 轮`
  if (record.mode === 'peak') return `巅峰之路 · 第 ${record.stage ?? 1} 关`
  if (record.mode === 'legend') return '传奇挑战'
  if (record.mode === 'cup') {
    const cupNames: Record<string, string> = {
      'season-community': '社区杯',
      'season-league': '联赛杯',
      'season-cross': '跨区杯',
      'season-champions': '星联杯',
      'season-legend': '传奇杯',
      'season-promotion': '升级杯',
      'season-event-draft': '星秀轮抽杯',
    }
    return (record.cupId && cupNames[record.cupId]) || '杯赛'
  }
  return '友谊赛'
}

/** 从权威战报生成紧凑可预览的战报卡片快照（不含双方战术板/隐藏属性等敏感信息）。 */
export function buildChatSharedMatch(
  record: MatchRecord,
  colors: { homeColor: string; awayColor: string },
): ChatSharedMatch {
  const duration = record.durationSeconds ?? LOGIC_MATCH_SECONDS
  const statByPlayer = new Map<string, MatchRecord['playerStats'][number]>()
  for (const s of record.playerStats ?? []) {
    statByPlayer.set(s.playerId, s)
    if (s.sourceId) statByPlayer.set(s.sourceId, s)
    statByPlayer.set(`${s.side}:${s.name}`, s)
  }
  const goals: ChatSharedGoal[] = (record.goalDetails ?? []).slice(0, 12).map((g) => {
    const m = Math.max(1, Math.min(90, Math.floor(displayClock(g.clock, duration) / 60) + 1))
    const scStat = statByPlayer.get(g.playerId) ?? statByPlayer.get(`${g.side}:${g.playerName}`)
    const astStat = g.assistId
      ? statByPlayer.get(g.assistId)
      : g.assistName
        ? statByPlayer.get(`${g.side}:${g.assistName}`)
        : undefined
    const appId = g.appearanceId ?? scStat?.appearanceId
    const hCm = g.height ?? scStat?.height
    const num = g.number ?? scStat?.number
    const astAppId = g.assistAppearanceId ?? astStat?.appearanceId
    const astHCm = g.assistHeight ?? astStat?.height
    const astNum = g.assistNumber ?? astStat?.number
    return {
      minute: `${m}'`,
      playerName: g.playerName,
      side: g.side,
      ...(g.assistName ? { assistName: g.assistName } : {}),
      ...(appId ? { appearanceId: appId } : {}),
      ...(hCm ? { height: hCm } : {}),
      ...(num ? { number: num } : {}),
      ...(astAppId ? { assistAppearanceId: astAppId } : {}),
      ...(astHCm ? { assistHeight: astHCm } : {}),
      ...(astNum ? { assistNumber: astNum } : {}),
      origin: { x: Math.round(g.origin.x * 10) / 10, y: Math.round(g.origin.y * 10) / 10 },
      distance: Math.round(g.distance * 10) / 10,
      bodyPart: g.bodyPart,
      technique: g.technique,
      situation: g.situation,
      target: g.target,
    }
  })
  const highlights = extractMatchHighlights(record)
    .filter((h) => h.actionClip)
    .slice(0, 8)
    .map((h) => ({ badge: h.badge, shortLabel: h.shortLabel, side: h.team }))

  const mvpPlayer = [...(record.playerStats ?? [])]
    .filter((p) => p.minutes > 0 || p.touches > 0)
    .sort(
      (a, b) =>
        (b.rating ?? 0) - (a.rating ?? 0) ||
        b.goals * 3 + (b.assists ?? 0) * 2 + (b.saves ?? 0) - (a.goals * 3 + (a.assists ?? 0) * 2 + (a.saves ?? 0)),
    )[0]
  const mvpParts: string[] = []
  if (mvpPlayer) {
    if (mvpPlayer.goals > 0) mvpParts.push(`${mvpPlayer.goals}球`)
    if ((mvpPlayer.assists ?? 0) > 0) mvpParts.push(`${mvpPlayer.assists}助`)
    if ((mvpPlayer.saves ?? 0) > 0) mvpParts.push(`${mvpPlayer.saves}扑救`)
    if (mvpPlayer.rating) mvpParts.push(`评分 ${mvpPlayer.rating.toFixed(1)}`)
  }

  return {
    kind: 'match',
    recordId: record.id,
    competition: competitionLabelOf(record),
    homeName: record.homeName,
    awayName: record.awayName,
    homeColor: sanitizeChatColor(colors.homeColor),
    awayColor: sanitizeChatColor(colors.awayColor),
    score: { home: record.score.home, away: record.score.away },
    ...(record.shootout ? { shootout: { home: record.shootout.home, away: record.shootout.away } } : {}),
    stats: {
      possession: [Math.round(record.stats.home.possession), Math.round(record.stats.away.possession)],
      shots: [record.stats.home.shots, record.stats.away.shots],
      shotsOnTarget: [record.stats.home.shotsOnTarget, record.stats.away.shotsOnTarget],
      xg: [Math.round(record.stats.home.xg * 100) / 100, Math.round(record.stats.away.xg * 100) / 100],
    },
    goals,
    highlights,
    ...(mvpPlayer ? { mvp: { name: mvpPlayer.name, line: mvpParts.join(' · ') || `出场 ${Math.round(mvpPlayer.minutes)}'` } } : {}),
  }
}

function isValidChatAttachment(raw: unknown): raw is ChatAttachment {
  if (!raw || typeof raw !== 'object') return false
  const obj = raw as Record<string, unknown>
  if (obj.kind === 'card') {
    return (
      typeof obj.cardId === 'string' &&
      typeof obj.playerId === 'string' &&
      typeof obj.playerName === 'string' &&
      typeof obj.cardTitle === 'string' &&
      typeof obj.ca === 'number' &&
      Number.isFinite(obj.ca) &&
      !!obj.positions &&
      typeof obj.positions === 'object' &&
      !!obj.attrs &&
      typeof obj.attrs === 'object' &&
      Array.isArray(obj.skills)
    )
  }
  if (obj.kind === 'match') {
    const score = obj.score as Record<string, unknown> | undefined
    const stats = obj.stats as Record<string, unknown> | undefined
    return (
      typeof obj.recordId === 'string' &&
      typeof obj.competition === 'string' &&
      typeof obj.homeName === 'string' &&
      typeof obj.awayName === 'string' &&
      typeof obj.homeColor === 'string' &&
      typeof obj.awayColor === 'string' &&
      !!score &&
      typeof score.home === 'number' &&
      typeof score.away === 'number' &&
      !!stats &&
      Array.isArray(stats.possession) &&
      Array.isArray(stats.shots) &&
      Array.isArray(stats.shotsOnTarget) &&
      Array.isArray(stats.xg) &&
      Array.isArray(obj.goals) &&
      Array.isArray(obj.highlights)
    )
  }
  return false
}

export function isValidChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  if (item.share !== undefined && !isValidChatAttachment(item.share)) return false
  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.accountId === 'string' &&
    typeof item.username === 'string' &&
    typeof item.clubId === 'string' &&
    typeof item.clubName === 'string' &&
    typeof item.clubColor === 'string' &&
    typeof item.text === 'string' &&
    item.text.length > 0 &&
    typeof item.at === 'number' &&
    Number.isFinite(item.at)
  )
}

/** 按 id 去重追加，并始终只保留最新的 limit 条消息。 */
export function appendChatMessage(
  history: readonly ChatMessage[],
  incoming: ChatMessage,
  limit = CHAT_HISTORY_LIMIT,
): ChatMessage[] {
  if (history.some((item) => item.id === incoming.id)) {
    return history.length > limit ? history.slice(-limit) : [...history]
  }
  const next = [...history, incoming]
  return next.length > limit ? next.slice(-limit) : next
}
