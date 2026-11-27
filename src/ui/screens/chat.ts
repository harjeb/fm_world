import {
  CHAT_HISTORY_LIMIT,
  CHAT_MAX_LENGTH,
  DEFAULT_CARD_SHARE_TEXT,
  DEFAULT_MATCH_SHARE_TEXT,
  sanitizeChatColor,
  type ChatMessage,
  type ChatSharedCard,
  type ChatSharedMatch,
} from '../../game/chat.ts'
import { cardsOf } from '../../game/cards.ts'
import { ATTR_META } from '../../game/data/attributes.ts'
import { ROUTE_EFFECT_DESC, ROUTE_LABELS } from '../../game/data/events.ts'
import { mainAttrsFor } from '../../game/scale.ts'
import { POSITIONS } from '../../game/types.ts'
import { chatState, isOnlineMode, onlineState, serverNow } from '../../online.ts'
import {
  attrHeat,
  attributeRadar,
  caHeat,
  compareRow,
  crest,
  distinctKit,
  ownName,
  playerPortrait,
  posBadge,
  primaryPosition,
  skillTag,
  tag,
} from '../components.ts'
import { esc, positionLabel } from '../format.ts'
import { icon } from '../icons.ts'
import { game, ui } from '../state.ts'

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

function renderCardEmbed(msgId: string, card: ChatSharedCard): string {
  const pos = primaryPosition({ positions: card.positions })
  const routeText = card.routeId && ROUTE_LABELS[card.routeId] ? ROUTE_LABELS[card.routeId] : '角色卡'
  const topSkills = card.skills.slice(0, 3).map((s) => skillTag({ skillTiers: card.skillTiers }, s)).join('')
  const extraCount = Math.max(0, card.skills.length - 3)
  return `<button type="button" class="chat-embed chat-embed-card" data-action="chat-preview-msg" data-msg-id="${esc(msgId)}" aria-label="查看角色卡 ${esc(card.playerName)} ${esc(card.cardTitle)}">
    <div class="chat-embed-card-top">
      ${playerPortrait({ id: card.playerId, name: card.playerName, country: card.country ?? '英格兰', age: card.age ?? 22, positions: card.positions }, 38)}
      <div class="chat-embed-card-main">
        <div class="chat-embed-card-name">${posBadge(pos)}<b>${esc(card.playerName)}</b><small>${esc(card.cardTitle)}</small></div>
        <div class="chat-embed-card-sub"><span>${esc(routeText)}</span>${card.country ? `<span>· ${esc(card.country)}</span>` : ''}${card.age ? `<span>· ${card.age}岁</span>` : ''}</div>
      </div>
      <div class="chat-embed-ca"><small>CA</small>${caHeat(card.ca)}</div>
    </div>
    ${topSkills ? `<div class="chat-embed-skills">${topSkills}${extraCount > 0 ? `<span class="muted small">+${extraCount}</span>` : ''}<span class="chat-embed-cta">查看属性 ${icon('right', 11)}</span></div>` : `<div class="chat-embed-skills"><span class="muted small">无装备技能</span><span class="chat-embed-cta">查看属性 ${icon('right', 11)}</span></div>`}
  </button>`
}

function renderMatchEmbed(msgId: string, match: ChatSharedMatch): string {
  const awayKit = distinctKit(match.awayColor, match.homeColor)
  const scorerLine = match.goals.slice(0, 3).map((g) => `${g.minute} ${g.playerName}`).join(' · ')
  return `<button type="button" class="chat-embed chat-embed-match" data-action="chat-preview-msg" data-msg-id="${esc(msgId)}" aria-label="查看战报 ${esc(match.homeName)} ${match.score.home}:${match.score.away} ${esc(match.awayName)}">
    <div class="chat-embed-match-meta">
      <span class="tag info">${esc(match.competition)}</span>
      <span class="muted small">xG ${match.stats.xg[0].toFixed(2)} - ${match.stats.xg[1].toFixed(2)} · 射门 ${match.stats.shots[0]}-${match.stats.shots[1]}</span>
    </div>
    <div class="chat-embed-scoreline">
      <span class="chat-embed-team">${crest({ name: match.homeName, color: match.homeColor }, 20)}<b>${esc(match.homeName)}</b></span>
      <span class="chat-embed-digits">${match.score.home} : ${match.score.away}${match.shootout ? `<small>点 ${match.shootout.home}:${match.shootout.away}</small>` : ''}</span>
      <span class="chat-embed-team away"><b>${esc(match.awayName)}</b>${crest({ name: match.awayName, color: awayKit }, 20)}</span>
    </div>
    <div class="chat-embed-foot">
      <span class="muted small">${scorerLine ? esc(`⚽ ${scorerLine}${match.goals.length > 3 ? ' …' : ''}`) : match.mvp ? esc(`最佳：${match.mvp.name}`) : '90 分钟激战'}</span>
      <span class="chat-embed-cta">查看战报 ${icon('right', 11)}</span>
    </div>
  </button>`
}

function shouldShowCaption(msg: ChatMessage): boolean {
  if (!msg.share) return true
  return msg.text !== DEFAULT_CARD_SHARE_TEXT && msg.text !== DEFAULT_MATCH_SHARE_TEXT
}

export function renderChatDrawer(): string {
  if (!ui.chatOpen) return ''
  const online = isOnlineMode()
  const now = serverNow()
  const me = onlineState.user?.id
  const messages = chatState.messages
  const hasCards = (cardsOf(game).length ?? 0) > 0
  const hasMatches = ((game?.matchHistory?.length ?? 0) + (game?.challengeHistory?.length ?? 0)) > 0
  const pending = ui.chatPendingShare

  const body = !online
    ? `<div class="chat-offline">
        <p>全服聊天仅在联机世界开放，登录或注册后即可与全服执教教练实时交流战术、晒角色卡名片与精彩战报。</p>
        <button class="btn primary" data-action="chat-login">${icon('user', 14)}<span>登录 / 注册联机账号</span></button>
      </div>`
    : `<div id="chat-messages" class="chat-messages" data-key="chat-messages">
        ${messages.length === 0
          ? '<div class="chat-empty">暂时还没有人发言，晒出一张得意角色卡或发第一条消息打个招呼吧！</div>'
          : messages.map((msg) => {
              const mine = msg.accountId === me
              const color = sanitizeChatColor(msg.clubColor)
              const clubNode = msg.clubId
                ? `<button class="link chat-club" data-club-open="${esc(msg.clubId)}" title="查看球队名单">${ownName(msg.clubName, mine)}</button>`
                : `<b class="chat-club-plain">${ownName(msg.clubName, mine)}</b>`
              const embed = msg.share
                ? msg.share.kind === 'card'
                  ? renderCardEmbed(msg.id, msg.share)
                  : renderMatchEmbed(msg.id, msg.share)
                : ''
              return `<div class="chat-msg ${mine ? 'mine' : ''}" data-key="${esc(msg.id)}">
                ${crest({ name: msg.clubName, color }, 26)}
                <div class="chat-msg-body">
                  <div class="chat-msg-meta">
                    ${clubNode}
                    <span class="chat-user">@${esc(msg.username)}</span>
                    ${mine ? '<span class="chat-mine-tag">我</span>' : ''}
                    <time class="chat-time num-text">${esc(formatChatTime(msg.at, now))}</time>
                  </div>
                  ${shouldShowCaption(msg) ? `<p class="chat-text">${esc(msg.text)}</p>` : ''}
                  ${embed}
                </div>
              </div>`
            }).join('')}
      </div>
      ${ui.chatError ? `<div class="chat-error" role="alert">${icon('alert', 13)}<span>${esc(ui.chatError)}</span></div>` : ''}
      <div class="chat-share-bar">
        ${pending
          ? `<div class="chat-pending-pill">
              <span class="tag solid">${pending.kind === 'card' ? '角色卡' : '战报'}</span>
              <span class="chat-pending-label">${esc(pending.label)}</span>
              <button type="button" class="btn small ghost chat-pending-clear" data-action="chat-clear-share" aria-label="移除待发送卡片">${icon('close', 12)}</button>
            </div>`
          : `<div class="chat-quick-actions">
              <button type="button" class="btn small ghost" data-action="chat-pick-best-card" ${hasCards ? '' : 'disabled title="库存里还没有已培养的角色卡"'}>${icon('cards', 13)}晒最强卡</button>
              <button type="button" class="btn small ghost" data-action="chat-pick-last-match" ${hasMatches ? '' : 'disabled title="还没有比赛记录"'}>${icon('review', 13)}晒最新战报</button>
              <span class="muted small">库存页与复盘页也可任选单卡/单场分享</span>
            </div>`}
      </div>
      <div class="chat-composer">
        <input id="chat-input" type="text" maxlength="${CHAT_MAX_LENGTH}" placeholder="${pending ? '配一句留言（留空也可直接发送）…' : `输入消息，按 Enter 发送（最多 ${CHAT_MAX_LENGTH} 字）…`}" autocomplete="off" ${chatState.sending ? 'disabled' : ''}>
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
      <div class="chat-sub">全服执教教练实时频道 · 支持晒角色卡名片与比赛战报</div>
      ${body}
    </aside>
  </div>`
}

function renderSharedCardModalBody(msg: ChatMessage, card: ChatSharedCard): string {
  const isGk = (card.positions.GK ?? 0) > 0
  const pos = primaryPosition({ positions: card.positions })
  const keys = mainAttrsFor(isGk)
  const routeText = card.routeId && ROUTE_LABELS[card.routeId] ? ROUTE_LABELS[card.routeId] : '未选路线'
  const posChips = POSITIONS
    .filter((p) => (card.positions[p] ?? 0) > 0)
    .sort((a, b) => (card.positions[b] ?? 0) - (card.positions[a] ?? 0))
    .map((p) => `<span class="tag">${esc(positionLabel(p))} ${Math.round(card.positions[p])}</span>`)
    .join('')
  const skillsHtml = card.skills.length
    ? card.skills.map((s) => skillTag({ skillTiers: card.skillTiers }, s)).join('')
    : '<span class="muted small">未装备实战技能</span>'
  const attrRows = keys.map((k) => {
    const val = Math.round(card.attrs[k] ?? 0)
    const pct = Math.max(4, Math.min(100, (val / 1500) * 100))
    return `<div class="share-attr-row">
      <span class="share-attr-name">${esc(ATTR_META[k].label)}</span>
      <span class="share-attr-bar"><i style="width:${pct.toFixed(1)}%"></i></span>
      <span class="num">${attrHeat(val)}</span>
    </div>`
  }).join('')

  return `
    <div class="share-modal-head">
      ${playerPortrait({ id: card.playerId, name: card.playerName, country: card.country ?? '英格兰', age: card.age ?? 22, positions: card.positions }, 56)}
      ${posBadge(pos)}
      <div class="share-modal-title">
        <h1>${esc(card.playerName)} <small>${esc(card.cardTitle)}</small></h1>
        <p class="hint">来自 ${crest({ name: msg.clubName, color: sanitizeChatColor(msg.clubColor) }, 16)} <b>${esc(msg.clubName)}</b>（@${esc(msg.username)}） · 路线：${esc(routeText)}${card.country ? ` · ${esc(card.country)}` : ''}${card.age ? ` · ${card.age}岁` : ''}</p>
      </div>
      <div class="share-modal-ca"><small>当前 CA</small>${caHeat(card.ca, 1)}</div>
    </div>
    <div class="share-card-grid">
      <div class="share-radar-box">
        ${attributeRadar({ attrs: card.attrs, positions: card.positions }, undefined, 200)}
      </div>
      <div class="share-attrs-box">
        ${attrRows}
      </div>
    </div>
    <div class="share-card-sec">
      <h3>擅长位置</h3>
      <div class="tag-row">${posChips || '<span class="muted small">—</span>'}</div>
    </div>
    ${card.routeId && ROUTE_LABELS[card.routeId] ? `<div class="share-card-sec">
      <h3>球风烙印 <small class="muted">（随卡生效 · 不占技能槽）</small></h3>
      <div class="tag-row"><span class="tag info">烙印 · ${esc(ROUTE_LABELS[card.routeId])}</span><span class="muted small">${esc(ROUTE_EFFECT_DESC[card.routeId])}</span></div>
    </div>` : ''}
    <div class="share-card-sec">
      <h3>实战技能 <small class="muted">（悬停查看效果）</small></h3>
      <div class="tag-row">${skillsHtml}</div>
    </div>`
}

function renderSharedMatchModalBody(msg: ChatMessage, match: ChatSharedMatch): string {
  const homeKit = sanitizeChatColor(match.homeColor)
  const awayKit = distinctKit(sanitizeChatColor(match.awayColor), homeKit)
  const canOpenOwnReview = [...(game?.matchHistory ?? []), ...(game?.challengeHistory ?? [])].some((r) => r.id === match.recordId)
  const goalItems = match.goals.map((g, idx) => `<div class="share-goal-row ${g.side}">
      <span class="share-goal-min num-text">${esc(g.minute)}</span>
      <b>${esc(g.playerName)}</b>
      ${g.assistName ? `<small class="muted">（${esc(g.assistName)} 助攻）</small>` : ''}
      <span class="tag">${g.side === 'home' ? esc(match.homeName) : esc(match.awayName)}</span>
      <button type="button" class="btn small ghost share-goal-3d" data-action="chat-highlight-3d" data-msg-id="${esc(msg.id)}" data-goal-index="${idx}" title="3D 重演此粒进球">🎬 3D</button>
    </div>`).join('')
  const hlItems = match.highlights.map((h) => `<span class="hl-chip is-static"><span class="hl-chip-badge">${esc(h.badge)}</span><span>${esc(h.shortLabel)}</span></span>`).join('')

  return `
    <div class="share-match-top">
      <span class="tag info">${esc(match.competition)}</span>
      <span class="muted small">由 @${esc(msg.username)}（${esc(msg.clubName)}）分享</span>
    </div>
    <section class="report-score share-match-score" style="--home:${esc(homeKit)};--away:${esc(awayKit)}">
      <span class="share-team-col home">${crest({ name: match.homeName, color: homeKit }, 30)}<b>${esc(match.homeName)}</b></span>
      <div class="report-digits">
        <b>${match.score.home} : ${match.score.away}</b>
        ${match.shootout ? `<small>点球 ${match.shootout.home}:${match.shootout.away}</small>` : ''}
      </div>
      <span class="share-team-col away"><b>${esc(match.awayName)}</b>${crest({ name: match.awayName, color: awayKit }, 30)}</span>
    </section>
    ${match.mvp ? `<div class="banner gold share-mvp-bar">${icon('star', 15)}<b>本场最佳：${esc(match.mvp.name)}</b><span>${esc(match.mvp.line)}</span></div>` : ''}
    <div class="share-match-cols" style="--home:${esc(homeKit)};--away:${esc(awayKit)}">
      <div class="share-card-sec">
        <h3>核心统计对比</h3>
        <div class="cmp-head"><span><i class="swatch cmp-swatch-home"></i>${esc(match.homeName)}</span><span>${esc(match.awayName)}<i class="swatch cmp-swatch-away"></i></span></div>
        ${compareRow('控球率', match.stats.possession[0], match.stats.possession[1], `${match.stats.possession[0]}%`, `${match.stats.possession[1]}%`)}
        ${compareRow('射门', match.stats.shots[0], match.stats.shots[1])}
        ${compareRow('射正', match.stats.shotsOnTarget[0], match.stats.shotsOnTarget[1])}
        ${compareRow('预期进球 xG', match.stats.xg[0], match.stats.xg[1], match.stats.xg[0].toFixed(2), match.stats.xg[1].toFixed(2))}
      </div>
      <div class="share-card-sec">
        <h3>进球时间线</h3>
        ${goalItems ? `<div class="share-goal-list">${goalItems}</div>` : '<p class="muted small">本场常规时间互交白卷。</p>'}
      </div>
    </div>
    ${hlItems ? `<div class="share-card-sec"><h3>关键高光时刻</h3><div class="rp-hl-chips">${hlItems}</div></div>` : ''}
    <div class="share-modal-foot">
      <button type="button" class="btn hl3d-entry-btn" data-action="chat-highlight-3d" data-msg-id="${esc(msg.id)}" title="按战报坐标合成半场禁区 3D 进球重演">🎬 3D 进球剧场</button>
      ${canOpenOwnReview ? `<button type="button" class="btn primary" data-action="chat-open-own-review" data-record="${esc(match.recordId)}">${icon('play', 14)}打开完整复盘 / 2D 重看</button>` : ''}
    </div>`
}

/** 点击聊天室里的角色卡名片或战报卡片时弹出的详情预览层。 */
export function renderChatShareModal(): string {
  if (!ui.chatPreviewMsgId) return ''
  const msg = chatState.messages.find((m) => m.id === ui.chatPreviewMsgId)
  if (!msg?.share) return ''
  const label = msg.share.kind === 'card' ? `${msg.share.playerName} 角色卡名片` : `${msg.share.homeName} vs ${msg.share.awayName} 战报预览`
  const content = msg.share.kind === 'card'
    ? renderSharedCardModalBody(msg, msg.share)
    : renderSharedMatchModalBody(msg, msg.share)
  return `<div class="overlay chat-share-overlay" data-action="chat-preview-close">
    <div class="modal share-preview-modal" data-stop="true" role="dialog" aria-modal="true" aria-label="${esc(label)}">
      <button class="modal-close" data-action="chat-preview-close" aria-label="关闭">${icon('close', 16)}</button>
      ${content}
    </div>
  </div>`
}
