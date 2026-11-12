/** 全服聊天：内存中与落盘均只保留最新的 50 条消息。 */
export const CHAT_HISTORY_LIMIT = 50
export const CHAT_MAX_LENGTH = 200
export const CHAT_COOLDOWN_MS = 1_500

export type ChatMessage = {
  id: string
  accountId: string
  username: string
  clubId: string
  clubName: string
  clubColor: string
  text: string
  at: number
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

export function validateChatText(raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
  const text = normalizeChatText(raw)
  if (!text) return { ok: false, error: '消息内容不能为空' }
  const length = [...text].length
  if (length > CHAT_MAX_LENGTH) return { ok: false, error: `消息最多 ${CHAT_MAX_LENGTH} 个字（当前 ${length} 字）` }
  return { ok: true, text }
}

export function isValidChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
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
