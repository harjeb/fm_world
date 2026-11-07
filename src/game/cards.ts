import type { GameState, Player, PlayerCard, RouteId, TrainingSession } from './types.ts'

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
type Build = Pick<Player, 'attrs' | 'positions' | 'personality' | 'skills' | 'skillTiers' | 'history' | 'version'>

export type CardOutcome = { ok: boolean; error?: string }

/** 卡里只留最近的培养记录，库存再大也不至于把存档撑爆。 */
const CARD_HISTORY_LIMIT = 16

const fail = (error: string): CardOutcome => ({ ok: false, error })

function cloneBuild(source: Build): Build {
  return {
    attrs: { ...source.attrs },
    positions: { ...source.positions },
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
  const card: PlayerCard = {
    id: `card-${game.cardSeq}`,
    playerId: owner.id,
    playerName: owner.name,
    serial,
    routeId,
    createdAt: Date.now(),
    ...copy,
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
    player.baseSkills = [...player.skills]
    player.baseSkillTiers = { ...player.skillTiers }
  }
  const copy = cloneBuild(build)
  player.attrs = copy.attrs
  player.positions = copy.positions
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
