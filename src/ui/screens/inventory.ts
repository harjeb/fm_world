import type { AttrKey, LegendBook, Player, PlayerCard, Position, SkillId } from '../../game/types.ts'
import { POSITIONS } from '../../game/types.ts'
import { CARD_NAME_LIMIT, baseBuild, cardRecyclePoints, cardsOf, playerCards, renameCard } from '../../game/cards.ts'
import { isPassiveTrainingBook } from '../../game/data/legend-cup-skill.ts'
import { skillEffectText } from '../../game/data/skill-effects.ts'
import { SKILLS, skillCategory } from '../../game/data/skills.ts'
import { DETAILED_POSITIONS, DETAILED_POSITION_LABELS, DETAILED_TO_POSITION, detailedPositionValue } from '../../game/detailed-positions.ts'
import { legendBookLabel } from '../../game/legend-books.ts'
import { bookRequirementText } from '../../game/legend-learning.ts'
import { initialDisplayCA } from '../../game/rating.ts'
import { saveGame } from '../../game/state.ts'
import { isOnlineMode, renameCardOnline } from '../../online.ts'
import { attrHeat, bookArt, bookTitle, caHeat, cardRoute, cardRouteEffect, emptyState, findAnyPlayer, icon, mainAttrs, pageHead, panel, playerPortrait, posBadge, primaryPosition, skillTag, tag } from '../components.ts'
import { attrLabel, esc, playerCA, positionClass, positionLabel, skillName } from '../format.ts'
import { morph } from '../morph.ts'
import { game, ui } from '../state.ts'
import { tipAttrs } from '../tooltip.ts'

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

const BOOK_TIER_ORDER = { rainbow: 0, gold: 1, silver: 2 } as const
const BOOK_TIER_NAME = { rainbow: '彩虹', gold: '金色', silver: '银色' } as const
type BookCat = 'primary' | 'auxiliary' | 'passive'
const BOOK_CAT_LABEL: Record<BookCat, string> = { passive: '培养专属', primary: '主技能', auxiliary: '辅助' }

function bookCatOf(id: SkillId): BookCat {
  if (isPassiveTrainingBook(id)) return 'passive'
  return skillCategory(id) === 'auxiliary' ? 'auxiliary' : 'primary'
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

/** 与当前装备的属性相比的非零差值；正在装备或差值为 0 时留空以节省卡片空间。 */
function deltaText(value: number, reference: number | undefined): string {
  if (reference === undefined) return ''
  const delta = Math.round(value - reference)
  if (delta === 0) return ''
  return `<small class="${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : ''}${delta}</small>`
}

function attrGrid(attrs: Record<AttrKey, number>, keys: readonly AttrKey[], reference: Player | undefined): string {
  return `<div class="pcard-attrs">${keys.map((key) => `<div class="pcard-attr"><span>${attrLabel(key)}</span><b>${attrHeat(attrs[key])}</b>${deltaText(attrs[key], reference?.attrs[key])}</div>`).join('')}</div>`
}

function positionRow(player: Pick<Player, 'positions' | 'detailedPositions'>): string {
  const known = DETAILED_POSITIONS.filter((pos) => detailedPositionValue(player, pos) > 0).sort((a, b) => detailedPositionValue(player, b) - detailedPositionValue(player, a))
  return `<div class="pcard-pos">${known.map((pos) => `<span title="${DETAILED_POSITION_LABELS[pos]} 熟练 ${Math.round(detailedPositionValue(player, pos))}"><span class="pos ${positionClass(DETAILED_TO_POSITION[pos])}">${pos}</span><b class="num-text">${Math.round(detailedPositionValue(player, pos))}</b></span>`).join('')}</div>`
}

function skillRow(card: Pick<PlayerCard, 'skills' | 'skillTiers'>): string {
  if (!card.skills.length) return ''
  return `<div class="pcard-skills tag-row">${card.skills.map((skill) => skillTag(card, skill)).join('')}</div>`
}

function deleteControls(card: PlayerCard, equipped: boolean): string {
  if (equipped || card.recycleLocked) return ''
  if (ui.cardDeleteId === card.id) {
    return `<button class="btn small danger" data-action="card-delete-confirm" data-card="${esc(card.id)}">确认删</button><button class="btn small ghost" data-action="card-delete-cancel">取消</button>`
  }
  return `<button class="btn small ghost" data-action="card-delete" data-card="${esc(card.id)}" title="直接删除不会获得培养点">删除</button>`
}

/* ---------- 卡名 ---------- */

/** 改名失败的中文提示，按卡 id 存；重绘后仍显示在那张卡上。 */
const cardNameErrors: Record<string, string> = {}
/** 避免 Enter 与随后的 blur/change 重复提交同一个联机改名请求。 */
const cardRenamePending = new Set<string>()

/** 只重绘库存页内容区，不惊动 app.ts 的整页 render。 */
function refreshInventory(): void {
  if (ui.screen !== 'inventory') return
  const main = document.querySelector<HTMLElement>('main.content')
  if (main) morph(main, renderInventory())
}

/**
 * 提卡名：空白等于恢复默认名；同一名球员重名会被拒绝并在卡上提示。
 * 名称本身存在 PlayerCard.customName 里，联机走专门接口、单机随存档持久化。
 */
async function commitCardName(input: HTMLInputElement): Promise<void> {
  const cardId = input.dataset.cardName
  if (!cardId || cardRenamePending.has(cardId)) return
  const nextValue = input.value
  const current = game.cards?.find((card) => card.id === cardId)?.customName?.trim() ?? ''
  if (nextValue.trim() === current && !cardNameErrors[cardId]) return
  if (!isOnlineMode()) {
    const result = renameCard(game, cardId, nextValue)
    if (result.ok) {
      delete cardNameErrors[cardId]
      saveGame(game)
      refreshInventory()
      return
    }
    cardNameErrors[cardId] = result.error ?? '改名失败'
    refreshInventory()
    return
  }
  cardRenamePending.add(cardId)
  delete cardNameErrors[cardId]
  try {
    await renameCardOnline(cardId, nextValue)
    delete cardNameErrors[cardId]
  } catch (error) {
    cardNameErrors[cardId] = error instanceof Error ? error.message : '改名失败'
  } finally {
    cardRenamePending.delete(cardId)
    refreshInventory()
  }
}

document.addEventListener('change', (event) => {
  const input = (event.target as HTMLElement).closest?.<HTMLInputElement>('[data-card-name]')
  if (input) void commitCardName(input)
})

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return
  const input = (event.target as HTMLElement).closest?.<HTMLInputElement>('[data-card-name]')
  if (!input) return
  event.preventDefault()
  void commitCardName(input)
})

/** 卡名输入框：空着就用默认的“卡 N”。 */
function cardNameField(card: PlayerCard): string {
  const custom = card.customName?.trim() ?? ''
  const error = cardNameErrors[card.id]
  return `<span class="card-name-field">
    <input class="card-name-input" data-card-name="${esc(card.id)}" value="${esc(custom)}" placeholder="${esc(`卡 ${card.serial}`)}" aria-label="这张卡的名字，留空恢复默认名“卡 ${card.serial}”" title="点开可改名；留空恢复默认名“卡 ${card.serial}”；同一名球员不能重名" maxlength="${CARD_NAME_LIMIT}" />
    ${error ? `<small class="card-name-error" role="status">${esc(error)}</small>` : ''}
  </span>`
}

function recycleEligible(card: PlayerCard): boolean {
  return cardRecyclePoints(card) !== null && !card.recycleLocked && !game.roster.some((player) => player.equippedCardId === card.id)
    && !Object.values(game.training ?? {}).some((session) => session?.cardId === card.id)
}

/** 全库存可回收卡，与搜索、位置筛选及当前选择无关。 */
export function recyclableCards(): PlayerCard[] {
  return cardsOf(game).filter(recycleEligible)
}

/** 与确认操作共用同一份可回收清单，避免确认时提交未展示的卡。 */
export function selectedRecycleCards(): PlayerCard[] {
  const selected = new Set(ui.recycleSelectedIds)
  return cardsOf(game).filter((card) => selected.has(card.id) && recycleEligible(card))
}

function recyclePreview(): string {
  const cards = selectedRecycleCards()
  const total = cards.reduce((sum, card) => sum + (cardRecyclePoints(card) ?? 0), 0)
  return `<section class="panel recycle-preview" aria-labelledby="recycle-preview-title">
    <h2 id="recycle-preview-title">回收确认</h2>
    <p class="recycle-warning" role="alert">回收不可逆，球员卡及其培养成果将永久消失，请仔细确认。</p>
    ${cards.length ? `<ul class="recycle-list">${cards.map((card) => `<li><strong>${esc(card.customName?.trim() || `卡 ${card.serial}`)}</strong> · ${esc(card.playerName)} · CA ${Math.round(playerCA(card))} · 技能：${esc(card.skills.map((skill) => `${skillName(skill)}（${card.skillTiers?.[skill] === 'rainbow' ? '彩' : card.skillTiers?.[skill] === 'gold' ? '金' : '银'}）`).join('、') || '无')} · ${cardRecyclePoints(card)} 培养点</li>`).join('')}</ul>` : '<p>没有可回收的已选卡片。</p>'}
    <p>共 ${cards.length} 张，可获得 <strong>${total}</strong> 培养点。已失效的选择不会列入预览。</p>
    <div class="recycle-actions"><button class="btn danger" data-action="card-recycle-confirm" ${cards.length ? '' : 'disabled'}>确认回收</button><button class="btn ghost" data-action="card-recycle-cancel">取消</button></div>
  </section>`
}

function cardTile(card: PlayerCard, owner: Player | undefined): string {
  const equipped = owner?.equippedCardId === card.id
  const pending = game.training[card.playerId]?.cardId === card.id
  const reference = owner && !equipped ? owner : undefined
  const route = cardRoute(card)
  const routeEffect = cardRouteEffect(card)
  const routeAttrs = routeEffect
    ? `${tipAttrs(`路线 · ${route}`, `${routeEffect}\n装备后在 2D 比赛生效，不占技能槽`)} title="${esc(`球风烙印：${routeEffect}`)}"`
    : ''
  const pts = cardRecyclePoints(card)
  const recycleTitle = pts === null
    ? '卡片能力无效，不能回收'
    : equipped
      ? '已装备不可回收'
      : pending
        ? '新卡待处理不可回收'
        : card.recycleLocked
          ? '已锁定不可回收'
          : `勾选回收可得 ${pts} 培养点`
  const recycleText = pts === null ? '无效' : equipped ? '已装' : pending ? '待处理' : card.recycleLocked ? '已锁' : `+${pts}点`

  return `<article class="pcard ${equipped ? 'equipped' : ''}" data-key="${esc(card.id)}">
    <header class="pcard-head">
      <div class="pcard-title">
        ${cardNameField(card)}
        ${equipped ? tag('已装备', 'solid') : pending ? tag('新', 'good') : ''}
        <span class="tag pcard-route" ${routeAttrs}>${esc(route)}</span>
      </div>
      <div class="pcard-ca"><small>CA</small>${caHeat(playerCA(card))}${deltaText(playerCA(card), reference ? playerCA(reference) : undefined)}</div>
    </header>
    ${attrGrid(card.attrs, mainAttrs({ positions: card.positions }), reference)}
    ${positionRow(card)}
    ${skillRow(card)}
    <footer class="pcard-foot">
      <label class="pcard-recycle-check" title="${esc(recycleTitle)}"><input type="checkbox" data-recycle-card="${esc(card.id)}" ${ui.recycleSelectedIds.includes(card.id) ? 'checked' : ''} ${recycleEligible(card) ? '' : 'disabled'} /><span>${recycleText}</span></label>
      <div class="pcard-actions">
        ${owner && !equipped ? `<button class="btn small primary" data-action="card-equip" data-player="${esc(owner.id)}" data-card="${esc(card.id)}" ${game.activeMatch ? 'disabled title="比赛进行中不能换卡"' : ''}>装备</button>` : ''}
        <button class="btn small ghost" data-action="chat-share-card" data-card="${esc(card.id)}" title="晒这张角色卡到全服聊天">${icon('chat', 12)}晒</button>
        <button class="btn small ghost" data-action="card-recycle-lock" data-card="${esc(card.id)}" data-locked="${card.recycleLocked ? 'false' : 'true'}" aria-label="${card.recycleLocked ? '解锁' : '锁定'}${esc(card.customName?.trim() || `卡 ${card.serial}`)}回收">${card.recycleLocked ? '解锁' : '锁定'}</button>
        ${deleteControls(card, equipped)}
      </div>
    </footer>
  </article>`
}

function baseTile(owner: Player): string {
  const build = baseBuild(owner)
  const equipped = !owner.equippedCardId
  const reference = equipped ? undefined : owner
  return `<article class="pcard base ${equipped ? 'equipped' : ''}" data-key="base-${esc(owner.id)}">
    <header class="pcard-head">
      <div class="pcard-title"><b>原始属性</b>${equipped ? tag('已装备', 'solid') : ''}<span class="muted small">未培养状态</span></div>
      <div class="pcard-ca"><small>CA</small>${caHeat(initialDisplayCA(owner))}${deltaText(initialDisplayCA(owner), reference ? playerCA(reference) : undefined)}</div>
    </header>
    ${attrGrid(build.attrs, mainAttrs(owner), reference)}
    ${positionRow(build)}
    ${skillRow(build)}
    <footer class="pcard-foot">
      <span class="muted small">可随时重置回原始</span>
      <div class="pcard-actions">
        ${equipped ? '' : `<button class="btn small" data-action="card-equip" data-player="${esc(owner.id)}" data-card="" ${game.activeMatch ? 'disabled title="比赛进行中不能换卡"' : ''}>换回原始</button>`}
      </div>
    </footer>
  </article>`
}

function ownerStatPill(label: string, value: number, title: string): string {
  const rounded = Math.round(value)
  const tone = rounded >= 60 ? 'good' : rounded >= 35 ? 'warn' : 'bad'
  return `<span class="card-stat-pill ${tone}" title="${esc(title)}">${esc(label)} <b>${rounded}%</b></span>`
}

function groupHead(group: Group): string {
  const { owner } = group
  const known = owner ?? findAnyPlayer(group.playerId)
  const avatar = known ? playerPortrait(known, 26) : ''
  const hasEquippedCard = !!owner?.equippedCardId
  return `<header class="card-owner">
    ${avatar}
    ${posBadge(group.position)}
    ${owner ? `<button class="name-btn" data-action="detail" data-player="${esc(owner.id)}">${esc(group.name)}</button>` : `<b>${esc(group.name)}</b>`}
    <span class="muted small">${group.cards.length} 卡</span>
    ${owner
      ? `${ownerStatPill('体能', owner.condition ?? 100, '比赛体能属于球员本人，换卡不会恢复')}
         ${ownerStatPill('精力', owner.energy ?? 100, '训练精力属于球员本人，换卡不会恢复')}
         <div class="card-owner-action">
           ${hasEquippedCard ? `<button class="btn small ghost" data-action="card-equip" data-player="${esc(owner.id)}" data-card="" ${game.activeMatch ? 'disabled title="比赛进行中不能换卡"' : `title="未培养原始 CA ${Math.round(initialDisplayCA(owner))}；点击换回原始属性"`}>原始 ${Math.round(initialDisplayCA(owner))} · 换回</button>` : ''}
           <button class="btn small ghost" data-action="open-training" data-player="${esc(owner.id)}">${icon('training', 13)}培养</button>
         </div>`
      : findAnyPlayer(group.playerId)
        ? `${tag('已离队')}<span class="muted small">回队后可续装</span>`
        : `${tag('已离开联赛')}<span class="muted small">仅可删除或回收</span>`}
  </header>`
}

function renderCardsTab(): string {
  const groups = buildGroups()
  const total = cardsOf(game).length
  const recyclableCount = recyclableCards().length
  const ruleTip = '回收未装备、未锁定且已处理完培养结果的卡可获得共享培养点（显示 CA 每 100 分得 1 点，最低 1 点）；挂牌出售成交时该球员的卡将销毁。一键回收全部不受筛选条件影响，将先预览再确认。'
  const body = total === 0
    ? `<div class="empty-cta">${emptyState('库存还是空的。培养一轮后，新球员卡会自动进入这里。')}<button class="btn primary" data-nav="training">${icon('training', 14)}去培养</button></div>`
    : groups.length === 0
      ? emptyState('没有符合条件的球员卡。')
      : groups.map((group) => `<section class="panel card-group" data-key="${esc(group.playerId)}">
          ${groupHead(group)}
          <div class="pcard-grid">${group.owner && !group.owner.equippedCardId ? baseTile(group.owner) : ''}${group.cards.map((card) => cardTile(card, group.owner)).join('')}</div>
        </section>`).join('')

  return `
    <section class="panel recycle-bar compact" aria-label="球员卡回收">
      <div class="recycle-info"><strong>共享培养点：${esc(game.trainingPoints ?? 0)}</strong><span class="muted small" title="${esc(ruleTip)}">CA 每 100 分回收 1 点（未装备/未锁定/已确认）；一键回收将先预览。</span></div>
      <div class="recycle-actions"><button class="btn small" data-action="card-recycle-select-all" ${groups.some((group) => group.cards.some(recycleEligible)) ? '' : 'disabled'}>全选筛选</button><button class="btn small primary" data-action="card-recycle-open" ${ui.recycleSelectedIds.length ? '' : 'disabled'}>预览回收（${ui.recycleSelectedIds.length}）</button><button class="btn small danger" data-action="card-recycle-all" ${recyclableCount ? '' : 'disabled'}>一键回收全部（${recyclableCount}）</button></div>
    </section>
    ${ui.recycleConfirm ? recyclePreview() : ''}
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
      <li>在这里、球员详情或战术页都能换卡；点卡名可改名（同一球员不能重名）。</li>
    </ul>`) : ''}
  `
}

function renderBookItem(book: LegendBook): string {
  const label = legendBookLabel(book)
  const def = SKILLS[book.id as keyof typeof SKILLS]
  const effect = def ? skillEffectText(book.id as keyof typeof SKILLS, book.tier) : ''
  const cat = bookCatOf(book.id)
  const reqText = cat === 'passive' ? '培养期生效 · 不占实战槽' : bookRequirementText(book)
  const tipBody = [def?.desc, effect, reqText, '前往培养页选择球员即可带入书槽'].filter(Boolean).join('\n')
  const tip = tipAttrs(`${label} · ${BOOK_TIER_NAME[book.tier]}技能书`, tipBody)
  return `<article class="inv-book-item tier-${book.tier}" role="listitem" ${tip} data-book-id="${esc(book.id)}" data-book-tier="${book.tier}">
    <div class="inv-book-art">${bookArt(book.tier, 32)}</div>
    <div class="inv-book-main">
      <div class="inv-book-head">
        ${bookTitle(label, book.tier)}
        <span class="tag">${BOOK_CAT_LABEL[cat]}</span>
        <span class="muted small inv-book-req">${esc(reqText)}</span>
      </div>
      <p class="inv-book-desc">${esc(effect || def?.desc || '')}</p>
    </div>
  </article>`
}

function renderBooksTab(): string {
  const books = (game.legendBooks ?? []).slice().sort((a, b) =>
    BOOK_TIER_ORDER[a.tier] - BOOK_TIER_ORDER[b.tier] || legendBookLabel(a).localeCompare(legendBookLabel(b), 'zh-CN'),
  )
  if (!books.length) {
    return `<div class="empty-cta">
      ${emptyState('还没有收集到技能书。联赛场上掉落、传奇挑战、巅峰之路与传奇杯都会产出银/金/彩技能书。')}
      <div class="btn-row">
        <button class="btn primary" data-nav="challenge">${icon('flag', 14)}前往挑战</button>
        <button class="btn" data-nav="training">${icon('training', 14)}去培养</button>
      </div>
    </div>`
  }

  const tierCounts = { rainbow: 0, gold: 0, silver: 0 }
  for (const book of books) tierCounts[book.tier]++

  const query = ui.inventoryBookSearch.trim().toLowerCase()
  const filtered = books.filter((book) => {
    if (ui.inventoryBookTier !== 'ALL' && book.tier !== ui.inventoryBookTier) return false
    if (ui.inventoryBookCat !== 'ALL' && bookCatOf(book.id) !== ui.inventoryBookCat) return false
    if (!query) return true
    const def = SKILLS[book.id as keyof typeof SKILLS]
    const text = [legendBookLabel(book), def?.desc ?? '', def ? skillEffectText(book.id as keyof typeof SKILLS, book.tier) : ''].join(' ').toLowerCase()
    return text.includes(query)
  })

  return `
    <div class="toolbar inv-book-toolbar">
      <div class="input-icon">${icon('search', 14)}<input id="inventory-book-search" type="search" placeholder="搜索技能名或效果" value="${esc(ui.inventoryBookSearch)}" /></div>
      <div class="seg" role="group" aria-label="稀有度">
        <button class="${ui.inventoryBookTier === 'ALL' ? 'active' : ''}" data-inventory-book-tier="ALL">全部 ${books.length}</button>
        <button class="${ui.inventoryBookTier === 'rainbow' ? 'active' : ''}" data-inventory-book-tier="rainbow">彩 ${tierCounts.rainbow}</button>
        <button class="${ui.inventoryBookTier === 'gold' ? 'active' : ''}" data-inventory-book-tier="gold">金 ${tierCounts.gold}</button>
        <button class="${ui.inventoryBookTier === 'silver' ? 'active' : ''}" data-inventory-book-tier="silver">银 ${tierCounts.silver}</button>
      </div>
      <div class="seg" role="group" aria-label="技能类别">
        <button class="${ui.inventoryBookCat === 'ALL' ? 'active' : ''}" data-inventory-book-cat="ALL">全部类别</button>
        <button class="${ui.inventoryBookCat === 'primary' ? 'active' : ''}" data-inventory-book-cat="primary">主技能</button>
        <button class="${ui.inventoryBookCat === 'auxiliary' ? 'active' : ''}" data-inventory-book-cat="auxiliary">辅助</button>
        <button class="${ui.inventoryBookCat === 'passive' ? 'active' : ''}" data-inventory-book-cat="passive">培养专属</button>
      </div>
      <span class="muted toolbar-count">${filtered.length} / ${books.length} 本</span>
    </div>
    ${filtered.length
      ? `<div class="inv-book-grid" role="list" aria-label="技能书库存">${filtered.map(renderBookItem).join('')}</div>`
      : emptyState('没有符合条件的技能书。')}
  `
}

export function renderInventory(): string {
  const totalCards = cardsOf(game).length
  const totalBooks = game.legendBooks?.length ?? 0
  const tab = ui.inventoryTab === 'books' ? 'books' : 'cards'

  return `
    ${pageHead({
      kicker: '库存',
      title: `库存 <small class="head-count">球员卡 ${totalCards} · 技能书 ${totalBooks}</small>`,
      sub: '管理已培养的球员卡与收集到的技能书；点击卡名可重命名，悬停技能书查看详情与携带条件。',
      actions: `<button class="btn small" data-nav="training">${icon('training', 13)}去培养</button>`,
    })}
    <nav class="tabs inv-tabs" aria-label="库存分类">
      <button class="tab ${tab === 'cards' ? 'active' : ''}" data-inventory-tab="cards">球员卡 <small>${totalCards}</small></button>
      <button class="tab ${tab === 'books' ? 'active' : ''}" data-inventory-tab="books">技能书 <small>${totalBooks}</small></button>
    </nav>
    ${tab === 'books' ? renderBooksTab() : renderCardsTab()}
  `
}
