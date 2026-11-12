import { CHAT_HISTORY_LIMIT, CHAT_MAX_LENGTH, sanitizeChatColor } from '../../game/chat.ts'
import { chatState, isOnlineMode, onlineState, serverNow } from '../../online.ts'
import { crest } from '../components.ts'
import { icon } from '../icons.ts'
import { esc } from '../format.ts'
import { ui } from '../state.ts'

const pad2 = (n: number): string => String(n).padStart(2, '0')

function formatChatTime(at: number, now: number): string {
  const date = new Date(at)
  const current = new Date(now)
  const hm = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  if (
    date.getFullYear() === current.getFullYear() &&
    date.getMonth() === current.getMonth() &&
    date.getDate() === current.getDate()
  ) {
    return hm
  }
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${hm}`
}

export function renderChatDrawer(): string {
  if (!ui.chatOpen) return ''
  const online = isOnlineMode()
  const now = serverNow()
  const me = onlineState.user?.id
  const messages = chatState.messages

  const body = !online
    ? `<div class="chat-offline">
        <p>全服聊天仅在联机世界开放，登录或注册后即可与全服执教教练实时交流战术、转会与赛况。</p>
        <button class="btn primary" data-action="chat-login">${icon('user', 14)}<span>登录 / 注册联机账号</span></button>
      </div>`
    : `<div id="chat-messages" class="chat-messages" data-key="chat-messages">
        ${messages.length === 0
          ? '<div class="chat-empty">暂时还没有人发言，发第一条消息和全服教练打个招呼吧！</div>'
          : messages.map((msg) => {
              const mine = msg.accountId === me
              const color = sanitizeChatColor(msg.clubColor)
              const clubNode = msg.clubId
                ? `<button class="link chat-club" data-club-open="${esc(msg.clubId)}" title="查看球队名单">${esc(msg.clubName)}</button>`
                : `<b class="chat-club-plain">${esc(msg.clubName)}</b>`
              return `<div class="chat-msg ${mine ? 'mine' : ''}" data-key="${esc(msg.id)}">
                ${crest({ name: msg.clubName, color }, 26)}
                <div class="chat-msg-body">
                  <div class="chat-msg-meta">
                    ${clubNode}
                    <span class="chat-user">@${esc(msg.username)}</span>
                    ${mine ? '<span class="chat-mine-tag">我</span>' : ''}
                    <time class="chat-time num-text">${esc(formatChatTime(msg.at, now))}</time>
                  </div>
                  <p class="chat-text">${esc(msg.text)}</p>
                </div>
              </div>`
            }).join('')}
      </div>
      ${ui.chatError ? `<div class="chat-error" role="alert">${icon('alert', 13)}<span>${esc(ui.chatError)}</span></div>` : ''}
      <div class="chat-composer">
        <input id="chat-input" type="text" maxlength="${CHAT_MAX_LENGTH}" placeholder="输入消息，按 Enter 发送（最多 ${CHAT_MAX_LENGTH} 字）…" autocomplete="off" ${chatState.sending ? 'disabled' : ''}>
        <button class="btn primary chat-send-btn" data-action="chat-send" ${chatState.sending ? 'disabled' : ''}>${icon('send', 14)}<span>${chatState.sending ? '发送中' : '发送'}</span></button>
      </div>`

  return `<div class="chat-backdrop" data-action="chat-close">
    <aside class="chat-drawer" data-stop="true" role="dialog" aria-modal="true" aria-label="全服聊天">
      <header class="chat-head">
        <div class="chat-title">
          ${icon('chat', 16)}
          <b>全服聊天</b>
          <span class="tag">${online ? `${messages.length} / ${CHAT_HISTORY_LIMIT}` : '仅联机'}</span>
        </div>
        <button class="modal-close chat-close" data-action="chat-close" aria-label="关闭全服聊天">${icon('close', 16)}</button>
      </header>
      <div class="chat-sub">全服执教教练实时频道 · 自动保留最新 ${CHAT_HISTORY_LIMIT} 条消息</div>
      ${body}
    </aside>
  </div>`
}
