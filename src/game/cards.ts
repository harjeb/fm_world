import type { GameState, Player, PlayerCard, RouteId, TrainingSession } from './types.ts'
import { caOf, costAttrs } from './ca.ts'
import { CA_MAX } from './scale.ts'
import { inferDetailedPositions } from './detailed-positions.ts'

/**
 * 球员卡。
 *
 * 球员（Player）是人：姓名、年龄、合同、体力、精力、伤病、停赛都跟着人走。
 * 球员卡（PlayerCard）是一轮培养的成果：属性、位置熟练度、性格、技能，生成后不再变化。
 *
 * 球员身上的 attrs / positions / skills 等字段始终等于他装备的那张卡，没有装备时等于原始属性，
 * 所以比赛和阵容校验都不需要知道卡的存在；换卡是唯一改写这些字段的入口。
 * 每轮培养都从原始属性开始，卡和卡之间互不影响。
 */

/** 一张卡决定的全部字段。 */
type Build = Pick<Player, 'attrs' | 'positions' | 'detailedPositions' | 'personality' | 'skills' | 'skillTiers' | 'history' | 'version'>

export type CardOutcome = { ok: boolean; error?: string }

/** 卡里只留最近的培养记录，库存再大也不至于把存档撑爆。 */
const CARD_HISTORY_LIMIT = 16

const fail = (error: string): CardOutcome => ({ ok: false, error })

function cloneBuild(source: Build): Build {
  return {
    attrs: { ...source.attrs },
    positions: { ...source.positions },
    detailedPositions: source.detailedPositions && { ...source.detailedPositions },
    personality: { ...source.personality },
    skills: [...source.skills],
    skillTiers: source.skillTiers && { ...source.skillTiers },
    history: source.history?.map((entry) => ({ ...entry, gains: entry.gains && { ...entry.gains } })),
    version: source.version,
  }
}

export function cardsOf(game: Pick<GameState, 'cards'>): PlayerCard[] {
  return game.cards ?? []
}

/** 显示 CA 先取整，再按每 100 CA 折算；无效旧卡不允许回收。 */
export function cardRecyclePoints(card: Pick<PlayerCard, 'attrs' | 'positions'>): number | null {
  if (!card.attrs || !card.positions || typeof card.positions.GK !== 'number' || !Number.isFinite(card.positions.GK) || card.positions.GK < 0) return null
  const gk = card.positions.GK > 0
  if (costAttrs(gk).some(key => typeof card.attrs[key] !== 'number' || !Number.isFinite(card.attrs[key]) || card.attrs[key] < 0 || card.attrs[key] > Number.MAX_SAFE_INTEGER)) return null
  const ca = Math.round(caOf(card.attrs, gk))
  return Number.isSafeInteger(ca) && ca >= 0 && ca <= CA_MAX ? Math.max(1, Math.floor(ca / 100)) : null
}

/** 锁定或解锁库存卡（装备中的卡也可以提前上锁）。 */
export function setCardRecycleLock(game: GameState, cardId: string, locked: boolean): CardOutcome {
  const card = cardsOf(game).find(item => item.id === cardId)
  if (!card || typeof locked !== 'boolean') return fail('球员卡或锁定状态无效')
  card.recycleLocked = locked
  return { ok: true }
}

/** 整批校验通过后一次性删除卡片并增加俱乐部共享点数。 */
export function recyclePlayerCards(game: GameState, cardIds: string[]): { ok: boolean; error?: string; points?: number; count?: number } {
  if (!Array.isArray(cardIds) || !cardIds.length || cardIds.some(id => typeof id !== 'string' || !id) || new Set(cardIds).size !== cardIds.length) return fail('球员卡列表无效或重复')
  const balance = game.trainingPoints === undefined ? 0 : game.trainingPoints
  if (!Number.isSafeInteger(balance) || balance < 0) return fail('训练点数无效')
  const cards = cardsOf(game)
  const byId = new Map<string, PlayerCard>()
  const duplicates = new Set<string>()
  for (const card of cards) {
    if (byId.has(card.id)) duplicates.add(card.id)
    else byId.set(card.id, card)
  }
  const equipped = new Set(game.roster.map(player => player.equippedCardId).filter(Boolean))
  const pending = new Set(Object.values(game.training ?? {}).map(session => session?.cardId).filter(Boolean))
  let points = 0
  for (const id of cardIds) {
    const card = byId.get(id)
    if (!card || duplicates.has(id)) return fail('球员卡不存在或重复')
    if (card.recycleLocked || equipped.has(id) || pending.has(id)) return fail('球员卡已锁定、装备或等待处理')
    const value = cardRecyclePoints(card)
    if (value === null) return fail('球员卡能力无效')
    points += value
    if (!Number.isSafeInteger(points) || !Number.isSafeInteger(balance + points)) return fail('训练点数溢出')
  }
  const selected = new Set(cardIds)
  game.cards = cards.filter(card => !selected.has(card.id))
  game.trainingPoints = balance + points
  return { ok: true, points, count: cardIds.length }
}

/** 卡名的最大长度，和界面里的输入框保持一致。 */
export const CARD_NAME_LIMIT = 24

/**
 * 卡名比较用的归一化形式：去掉首尾空格并忽略大小写。
 * 界面显示仍然用玩家输入的原样文字。
 */
export function normalizeCardName(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * 一张卡的显示名：玩家起过名字就用玩家的，没起过就叫“卡 N”。
 * 卡片列表、换卡下拉框和球员详情都走这里，保证三处一致。
 */
export function cardDisplayName(card: Pick<PlayerCard, 'serial' | 'customName'>): string {
  const custom = card.customName?.trim()
  return custom ? custom : `卡 ${card.serial}`
}

export function playerCards(game: Pick<GameState, 'cards'>, playerId: string): PlayerCard[] {
  return cardsOf(game).filter((card) => card.playerId === playerId).sort((a, b) => a.serial - b.serial)
}

/**
 * 给一张卡改名。空白名字表示恢复默认的“卡 N”。
 * 同一名球员的卡名（归一化后）不能重复：既不能撞上别的自定义名，也不能撞上别的卡的默认名。
 */
export function renameCard(game: GameState, cardId: string, name: string): CardOutcome {
  const cards = cardsOf(game)
  const card = cards.find((item) => item.id === cardId)
  if (!card) return fail('球员卡不存在')
  const trimmed = name.trim()
  if (!trimmed) {
    // 清空输入等于去掉自定义名，回到“卡 N”。
    delete card.customName
    return { ok: true }
  }
  if ([...trimmed].length > CARD_NAME_LIMIT) return fail(`卡名最多 ${CARD_NAME_LIMIT} 个字`)
  const wanted = normalizeCardName(trimmed)
  const sameName = cards.find((item) => item !== card && item.playerId === card.playerId && normalizeCardName(cardDisplayName(item)) === wanted)
  if (sameName) return fail(`这名球员已经有一张叫“${cardDisplayName(sameName)}”的卡了，换一个名字`)
  card.customName = trimmed
  return { ok: true }
}

export function equippedCard(game: Pick<GameState, 'cards'>, player: Pick<Player, 'equippedCardId'>): PlayerCard | undefined {
  return player.equippedCardId ? cardsOf(game).find((card) => card.id === player.equippedCardId) : undefined
}

function addCard(game: GameState, owner: Pick<Player, 'id' | 'name'>, build: Build, routeId: RouteId | null): PlayerCard {
  const cards = (game.cards ??= [])
  game.cardSeq = (game.cardSeq ?? 0) + 1
  const serial = cards.reduce((max, card) => (card.playerId === owner.id ? Math.max(max, card.serial) : max), 0) + 1
  const copy = cloneBuild(build)
  const player = game.roster.find(item => item.id === owner.id)
  copy.detailedPositions ??= inferDetailedPositions({ positions: copy.positions, foot: player?.foot, style: player?.style })
  const card: PlayerCard = {
    id: `card-${game.cardSeq}`,
    playerId: owner.id,
    playerName: owner.name,
    serial,
    routeId,
    createdAt: Date.now(),
    ...copy,
    detailedPositionsVersion: 1,
    history: copy.history?.slice(-CARD_HISTORY_LIMIT),
  }
  cards.push(card)
  return card
}

/** 培养结束时把成果收进库存；重复调用不会多出一张。 */
export function addTrainedCard(game: GameState, session: TrainingSession): PlayerCard {
  const existing = session.cardId ? cardsOf(game).find((card) => card.id === session.cardId) : undefined
  if (existing) return existing
  const owner = game.roster.find((player) => player.id === session.playerId) ?? session.candidate
  const card = addCard(game, owner, { ...session.candidate, history: session.log, version: session.baseVersion + 1 }, session.routeId ?? null)
  session.cardId = card.id
  return card
}

/** 原始属性。旧存档里已培养过的球员没记录原始技能，只能还原成招牌技能。 */
export function baseBuild(player: Player): Build {
  const untouched = !player.equippedCardId && player.version === 0
  const skills = untouched ? player.skills : player.baseSkills ?? (player.signatureSkill ? [player.signatureSkill] : [])
  const tiers = untouched ? player.skillTiers : player.baseSkillTiers ?? player.skillTiers
  return {
    attrs: { ...player.baseAttrs },
    positions: { ...player.basePositions },
    detailedPositions: { ...(player.baseDetailedPositions ?? (untouched ? player.detailedPositions : undefined) ?? inferDetailedPositions({ positions: player.basePositions, style: player.style, foot: player.foot })) },
    personality: { ...player.basePersonality },
    skills: [...skills],
    skillTiers: Object.fromEntries(skills.flatMap((skill) => (tiers?.[skill] ? [[skill, tiers[skill]]] : []))),
    history: undefined,
    version: 0,
  }
}

/** 培养的起点：这名球员没有培养过的样子。体能、精力这些跟人走的字段不变。 */
export function untrainedPlayer(player: Player): Player {
  const base: Player = { ...player, ...baseBuild(player) }
  delete base.equippedCardId
  return base
}

function wear(player: Player, build: Build, cardId: string | null): void {
  if (!player.equippedCardId && player.version === 0) {
    player.baseDetailedPositions = player.detailedPositions && { ...player.detailedPositions }
    player.baseDetailedPositionsVersion = player.detailedPositionsVersion
    player.baseSkills = [...player.skills]
    player.baseSkillTiers = { ...player.skillTiers }
  }
  const copy = cloneBuild(build)
  copy.detailedPositions ??= inferDetailedPositions({ positions: copy.positions, style: player.style, foot: player.foot })
  player.attrs = copy.attrs
  player.positions = copy.positions
  player.detailedPositions = copy.detailedPositions
  player.detailedPositionsVersion = 1
  player.personality = copy.personality
  player.skills = copy.skills
  player.skillTiers = copy.skillTiers
  player.history = copy.history
  player.version = copy.version
  if (cardId) player.equippedCardId = cardId
  else delete player.equippedCardId
}

/**
 * 给球员换卡；cardId 为 null 表示换回原始属性。体力、精力、伤病、停赛都不变。
 * 任何人都能踢任何位置，所以换卡不会让阵容失效：新卡在这个位置的熟练度低，只是属性折损更多。
 */
export function equipCard(game: GameState, playerId: string, cardId: string | null): CardOutcome {
  ensureCards(game)
  if (game.activeMatch) return fail('比赛进行中不能换卡')
  const player = game.roster.find((item) => item.id === playerId)
  if (!player) return fail('球员不在你的阵容')
  if (player.youthOrigin && player.youthOrigin.promotedAt === undefined) return fail('青训球员正式提拔后才能装备球员卡')
  const card = cardId === null ? null : cardsOf(game).find((item) => item.id === cardId)
  if (card === undefined) return fail('球员卡不存在')
  if (card && card.playerId !== playerId) return fail('只能装备这名球员自己的卡')
  if ((player.equippedCardId ?? null) === cardId) return { ok: true }
  wear(player, card ?? baseBuild(player), cardId)
  return { ok: true }
}

/** 结束培养结果页：卡已经在库存里，这里只收起结果。 */
export function closeFinishedTraining(game: GameState, playerId: string): void {
  delete game.candidates[playerId]
  delete game.training[playerId]
}

export function deleteCard(game: GameState, cardId: string): CardOutcome {
  const cards = cardsOf(game)
  const card = cards.find((item) => item.id === cardId)
  if (!card) return fail('球员卡不存在')
  if (card.recycleLocked) return fail('这张卡已锁定，请先解锁')
  if (game.roster.some((player) => player.equippedCardId === cardId)) return fail('这张卡正在装备中，先换下来')
  if (game.training[card.playerId]?.cardId === cardId) closeFinishedTraining(game, card.playerId)
  game.cards = cards.filter((item) => item !== card)
  return { ok: true }
}

/**
 * 球员被卖走：他的所有卡一并销毁，人也回到没培养过的原始属性。
 * 只删卡不还原的话，他身上装备着的成品还在，等于卡带着人走了。
 */
export function destroyPlayerCards(game: GameState, player: Player): number {
  const cards = cardsOf(game)
  const kept = cards.filter((card) => card.playerId !== player.id)
  wear(player, baseBuild(player), null)
  delete game.candidates[player.id]
  delete game.training[player.id]
  game.cards = kept
  return cards.length - kept.length
}

/**
 * 补齐旧存档，并处理卡被删后球员才回队的情况：
 * 球员身上已确认的培养成果收进库存并视为已装备，等待确认的候选也收进库存。
 */
export function ensureCards(game: GameState): boolean {
  let changed = game.cards === undefined
  const cards = (game.cards ??= [])
  for (const player of game.roster) {
    if (player.equippedCardId && cards.some((card) => card.id === player.equippedCardId)) continue
    if (player.equippedCardId) {
      delete player.equippedCardId
      changed = true
    }
    if (player.version > 0) {
      player.equippedCardId = addCard(game, player, player, null).id
      changed = true
    }
  }
  for (const session of Object.values(game.training ?? {})) {
    if (session.completed && !session.cardId) {
      addTrainedCard(game, session)
      changed = true
    }
  }
  for (const [playerId, candidate] of Object.entries(game.candidates ?? {})) {
    if (game.training?.[playerId]) continue
    const owner = game.roster.find((player) => player.id === playerId)
    if (owner) addCard(game, owner, candidate, null)
    delete game.candidates[playerId]
    changed = true
  }
  return changed
}
