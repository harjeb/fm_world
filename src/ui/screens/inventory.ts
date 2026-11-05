import type { AttrKey, Player, PlayerCard, Position } from '../../game/types.ts'
import { POSITIONS } from '../../game/types.ts'
import { CARD_NAME_LIMIT, baseBuild, cardsOf, playerCards, renameCard } from '../../game/cards.ts'
import { initialDisplayCA } from '../../game/rating.ts'
import { saveGame } from '../../game/state.ts'
import { attrHeat, caHeat, cardRoute, emptyState, findAnyPlayer, icon, mainAttrs, meter, pageHead, panel, posBadge, primaryPosition, skillTag, tag } from '../components.ts'
import { attrLabel, esc, playerCA, positionLabel } from '../format.ts'
import { morph } from '../morph.ts'
import { game, ui } from '../state.ts'

type Group = {
  playerId: string
  name: string
  /** 还在阵容里的球员；离队后为空，卡不能装备。 */
  owner: Player | undefined
  cards: PlayerCard[]
  position: Position
  best: number
  newest: number
}

function buildGroups(): Group[] {
  const ids = [...new Set(cardsOf(game).map((card) => card.playerId))]
  const query = ui.inventorySearch.trim().toLowerCase()
  const groups = ids.map((playerId): Group => {
    const cards = playerCards(game, playerId)
    const owner = game.roster.find((player) => player.id === playerId)
    const known = owner ?? findAnyPlayer(playerId)
    return {
      playerId,
      name: owner?.name ?? cards[0].playerName,
      owner,
      cards,
      position: primaryPosition(known ?? cards[cards.length - 1]),
      best: Math.max(...cards.map((card) => playerCA(card))),
      newest: Math.max(...cards.map((card) => card.createdAt)),
    }
  }).filter((group) => {
    if (ui.inventoryPos !== 'ALL' && group.position !== ui.inventoryPos) return false
    return !query || group.name.toLowerCase().includes(query)
  })
  const order = ui.inventorySort
  return groups.sort((a, b) => {
    if (!a.owner !== !b.owner) return a.owner ? -1 : 1
    if (order === 'ca') return b.best - a.best
    if (order === 'player') return a.name.localeCompare(b.name, 'zh-CN')
    return b.newest - a.newest
  })
}

/** 与当前装备的属性相比的差值；正在装备的那一张不显示。 */
function deltaText(value: number, reference: number | undefined): string {
  if (reference === undefined) return ''
  const delta = Math.round(value - reference)
  if (delta === 0) return '<small class="dim">±0</small>'
  return `<small class="${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : ''}${delta}</small>`
}

function attrGrid(attrs: Record<AttrKey, number>, keys: readonly AttrKey[], reference: Player | undefined): string {
  return `<div class="pcard-attrs">${keys.map((key) => `<div class="pcard-attr"><span>${attrLabel(key)}</span><b>${attrHeat(attrs[key])}</b>${deltaText(attrs[key], reference?.attrs[key])}</div>`).join('')}</div>`
}

function positionRow(positions: Player['positions']): string {
  const known = POSITIONS.filter((pos) => positions[pos] > 0).sort((a, b) => positions[b] - positions[a])
  return `<div class="pcard-pos">${known.map((pos) => `<span title="${positionLabel(pos)} 熟练 ${Math.round(positions[pos])}">${posBadge(pos)}<b class="num-text">${Math.round(positions[pos])}</b></span>`).join('')}</div>`
}

function skillRow(card: Pick<PlayerCard, 'skills' | 'skillTiers'>): string {
  return `<div class="pcard-skills tag-row">${card.skills.map((skill) => skillTag(card, skill)).join('') || '<span class="muted small">没有技能</span>'}</div>`
}

function deleteControls(card: PlayerCard, equipped: boolean): string {
  if (equipped) return ''
  if (ui.cardDeleteId === card.id) {
    return `<button class="btn small danger" data-action="card-delete-confirm" data-card="${esc(card.id)}">确认删除</button><button class="btn small ghost" data-action="card-delete-cancel">取消</button>`
  }
  return `<button class="btn small ghost" data-action="card-delete" data-card="${esc(card.id)}">删除</button>`
}

/* ---------- 卡名 ---------- */

/** 改名失败的中文提示，按卡 id 存；重绘后仍显示在那张卡上。 */
const cardNameErrors: Record<string, string> = {}

/** 只重绘库存页内容区，不惊动 app.ts 的整页 render。 */
function refreshInventory(): void {
  if (ui.screen !== 'inventory') return
  const main = document.querySelector<HTMLElement>('main.content')
  if (main) morph(main, renderInventory())
}

/**
 * 提卡名：空白等于恢复默认名；同一名球员重名会被拒绝并在卡上提示。
 * 名称本身存在 PlayerCard.customName 里，随存档一起持久化。
 */
function commitCardName(input: HTMLInputElement): void {
  const cardId = input.dataset.cardName
  if (!cardId) return
  const result = renameCard(game, cardId, input.value)
  if (result.ok) {
    delete cardNameErrors[cardId]
    saveGame(game)
    refreshInventory()
    return
  }
  cardNameErrors[cardId] = result.error ?? '改名失败'
  refreshInventory()
}

document.addEventListener('change', (event) => {
  const input = (event.target as HTMLElement).closest?.<HTMLInputElement>('[data-card-name]')
  if (input) commitCardName(input)
})

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return
  const input = (event.target as HTMLElement).closest?.<HTMLInputElement>('[data-card-name]')
  if (!input) return
  event.preventDefault()
  commitCardName(input)
})

/** 卡名输入框：空着就用默认的“卡 N”。 */
function cardNameField(card: PlayerCard): string {
  const custom = card.customName?.trim() ?? ''
  const error = cardNameErrors[card.id]
  return `<span class="card-name-field">
    <input class="card-name-input" data-card-name="${esc(card.id)}" value="${esc(custom)}" placeholder="${esc(`卡 ${card.serial}`)}" aria-label="这张卡的名字，留空恢复默认名“卡 ${card.serial}”" title="点开可改名；留空恢复默认名“卡 ${card.serial}”；同一名球员不能重名" maxlength="${CARD_NAME_LIMIT}" />
    ${error ? `<small class="card-name-error" role="status">${esc(error)}</small>` : `<small class="muted">${custom ? '自定义名' : '默认名'}</small>`}
  </span>`
}

function cardTile(card: PlayerCard, owner: Player | undefined): string {
  const equipped = owner?.equippedCardId === card.id
  const pending = game.training[card.playerId]?.cardId === card.id
  const reference = owner && !equipped ? owner : undefined
  return `<article class="pcard ${equipped ? 'equipped' : ''}" data-key="${esc(card.id)}">
    <header class="pcard-head">
      <div class="pcard-title">${cardNameField(card)}${equipped ? tag('已装备', 'solid') : pending ? tag('新', 'good') : ''}<small>${esc(cardRoute(card))}</small></div>
      <div class="pcard-ca"><small>CA</small>${caHeat(playerCA(card))}${deltaText(playerCA(card), reference ? playerCA(reference) : undefined)}</div>
    </header>
    ${attrGrid(card.attrs, mainAttrs({ positions: card.positions }), reference)}
    ${positionRow(card.positions)}
    ${skillRow(card)}
    <footer class="pcard-actions">
      ${owner && !equipped ? `<button class="btn small primary" data-action="card-equip" data-player="${esc(owner.id)}" data-card="${esc(card.id)}" ${game.activeMatch ? 'disabled title="比赛进行中不能换卡"' : ''}>${icon('check', 13)}装备</button>` : ''}
      ${deleteControls(card, equipped)}
    </footer>
  </article>`
}

function baseTile(owner: Player): string {
  const build = baseBuild(owner)
  const equipped = !owner.equippedCardId
  const reference = equipped ? undefined : owner
  return `<article class="pcard base ${equipped ? 'equipped' : ''}" data-key="base-${esc(owner.id)}">
    <header class="pcard-head">
      <div class="pcard-title"><b>原始属性</b>${equipped ? tag('已装备', 'solid') : ''}<small>没有培养过的样子</small></div>
      <div class="pcard-ca"><small>CA</small>${caHeat(initialDisplayCA(owner))}${deltaText(initialDisplayCA(owner), reference ? playerCA(reference) : undefined)}</div>
    </header>
    ${attrGrid(build.attrs, mainAttrs(owner), reference)}
    ${positionRow(build.positions)}
    ${skillRow(build)}
    <footer class="pcard-actions">
      ${equipped ? '' : `<button class="btn small" data-action="card-equip" data-player="${esc(owner.id)}" data-card="" ${game.activeMatch ? 'disabled title="比赛进行中不能换卡"' : ''}>换回原始</button>`}
    </footer>
  </article>`
}

function groupHead(group: Group): string {
  const { owner } = group
  return `<header class="card-owner">
    ${posBadge(group.position)}
    ${owner ? `<button class="name-btn" data-action="detail" data-player="${esc(owner.id)}">${esc(group.name)}</button>` : `<b>${esc(group.name)}</b>`}
    <span class="muted small">${group.cards.length} 张卡</span>
    ${owner
      ? `<span class="card-owner-meter" title="比赛体能属于球员本人，换卡不会恢复"><span>体能</span>${meter(owner.condition ?? 100)}</span>
         <span class="card-owner-meter" title="训练精力属于球员本人，换卡不会恢复"><span>精力</span>${meter(owner.energy ?? 100)}</span>
         <button class="btn small ghost card-owner-action" data-action="open-training" data-player="${esc(owner.id)}">${icon('training', 13)}培养</button>`
      : findAnyPlayer(group.playerId)
        ? `${tag('已离队')}<span class="muted small">回队后可以继续装备</span>`
        : `${tag('已离开联赛')}<span class="muted small">这些卡不能再装备，可以删除</span>`}
  </header>`
}

export function renderInventory(): string {
  const groups = buildGroups()
  const total = cardsOf(game).length
  const body = total === 0
    ? `<div class="empty-cta">${emptyState('库存还是空的。培养一轮后，新球员卡会自动进入这里。')}<button class="btn primary" data-nav="training">${icon('training', 14)}去培养</button></div>`
    : groups.length === 0
      ? emptyState('没有符合条件的球员卡。')
      : groups.map((group) => `<section class="panel card-group" data-key="${esc(group.playerId)}">
          ${groupHead(group)}
          <div class="pcard-grid">${group.owner ? baseTile(group.owner) : ''}${group.cards.map((card) => cardTile(card, group.owner)).join('')}</div>
        </section>`).join('')
  return `
    ${pageHead({
      kicker: '库存',
      title: `球员卡 <small class="head-count">${total} 张</small>`,
      sub: '一张卡是一轮培养的成果。球员装备自己的卡后，比赛就用这张卡的属性；一名球员可以有多张卡，随时搭配。点卡片名字可以给卡改名（留空恢复“卡 N”），同一名球员的卡名不能重复。体能、精力、伤病和停赛跟着球员走，换卡不会恢复。',
    })}
    ${total === 0 ? '' : `<div class="toolbar">
      <div class="input-icon">${icon('search', 14)}<input id="inventory-search" placeholder="搜索球员" value="${esc(ui.inventorySearch)}" /></div>
      <div class="seg" role="group" aria-label="位置">
        <button class="${ui.inventoryPos === 'ALL' ? 'active' : ''}" data-inventory-pos="ALL">全部</button>
        ${POSITIONS.map((pos) => `<button class="${ui.inventoryPos === pos ? 'active' : ''}" data-inventory-pos="${pos}">${positionLabel(pos)}</button>`).join('')}
      </div>
      <label class="field-inline" for="inventory-sort"><span>排序</span><select id="inventory-sort">
        <option value="new" ${ui.inventorySort === 'new' ? 'selected' : ''}>最新获得</option>
        <option value="ca" ${ui.inventorySort === 'ca' ? 'selected' : ''}>CA 最高</option>
        <option value="player" ${ui.inventorySort === 'player' ? 'selected' : ''}>球员姓名</option>
      </select></label>
      <span class="muted toolbar-count">${groups.length} 名球员</span>
    </div>`}
    ${body}
    ${total === 0 ? panel('怎么用', `<ul class="plain-list">
      <li>培养结束后，成果变成一张属于这名球员的卡，原来的卡不会消失。</li>
      <li>每轮都从原始属性开始，卡和卡之间互不影响，可以给同一名球员练出不同方向的卡。</li>
      <li>在这里、球员详情或战术页都能换卡。</li>
      <li>点卡上的名字可以改名（留空恢复“卡 N”），同一名球员的卡名不能重复。</li>
    </ul>`) : ''}
  `
}
