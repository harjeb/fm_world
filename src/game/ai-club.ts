import { analyzeAIDepth, type AIDepth } from './ai-depth.ts'
import { recordTransfer } from './transfer-news.ts'
import { caOf } from './ca.ts'
import { MAX_FANS, STAGES_PER_LEVEL, TIER_ROUND_INCOME, facilityLevel, facilityUpgradeCost, projectedRoundIncome } from './economy.ts'
import { AVERAGE_ROUND_GAME_DAYS } from './calendar.ts'
import { derivedRng, splitSeed } from './rng.ts'
import { basePlayerMarketValue, playerMarketValue } from './pricing.ts'
import { untrainedPlayer } from './cards.ts'
import { isOnMarketToday } from './market-window.ts'
import { attrHardLimit, attrMax, isMainAttr } from './scale.ts'
import { cupCeilingBonusFromClaims } from './cup-rewards.ts'
import { ALL_ATTRIBUTES, type AICard, type AIClubState, type AITeam, type AttrKey, type Attributes, type FacilityId, type GameState, type LegendBook, type Player, type SkillId, type SkillTier, type TierId, type WorldClub, type WorldState } from './types.ts'
import { FULL_SQUAD, refreshAILineup } from './squad.ts'
import { cachedOwnerlessTeams } from './world.ts'
import { aiBuysLeft, noteAIBuy } from './transfer-rules.ts'
import { simulateAITrainingRound } from './ai-training.ts'
import { shopCatalog } from './shop.ts'
import { bookKey } from './legend-learning.ts'

/**
 * 电脑球队的经营。
 *
 * 玩家有经济面板，电脑球队以前只有一份“强度”数字：不会买人、不升设施、也不培养。
 * 这里给每支球队补上一份自己的账本，规则照抄玩家的：收入看球迷和设施，升级要花钱，
 * 培养按设施阶段抽概率，练出来的卡只留评分最高的那张（等于自动装备最好的卡）。
 *
 * 全部是确定性的：同一份存档、同一个种子、同一天，结果完全一样。
 */

/** 设施列表，顺序也是电脑球队的升级偏好：先修球场，再修青训。 */
export const AI_FACILITIES: readonly FacilityId[] = ['stadium', 'academy', 'medical', 'psychology', 'tactics', 'shop', 'sponsor']

type TierProfile = {
  /** 开局余额。 */
  balance: number
  fans: number
  /** 开局设施阶段区间（含两端）。 */
  stage: readonly [number, number]
  /** 所有设施开局至少几阶段：顶级球队一开局就是 3 级（第 11 阶段）以上。 */
  minStage: number
  /** 留底资金：低于这个数就不再买人。 */
  reserve: number
  /** 本赛季还有买人名额时，升设施前最少留下的钱占 reserve 的比例（>= 1，避免设施升级把转会预算抽干）。 */
  upgradeFloor: number
  /** 每轮最多升几次设施（小数按轮累计）：二级慢、一级积极、顶级最快。 */
  upgradePerRound: number
  /** 抢人时最多愿意出到估值的几倍。级别越高越敢花。 */
  overpay: number
  /** 每个游戏日的培养次数区间（含两端）。 */
  perDay: readonly [number, number]
}

const TIER_PROFILE: Record<TierId, TierProfile> = {
  champions: { balance: 12_000_000, fans: 44_000, stage: [12, 18], minStage: 11, reserve: 3_000_000, upgradeFloor: 2.5, upgradePerRound: 4, overpay: 1.2, perDay: [3, 5] },
  division1: { balance: 6_000_000, fans: 17_000, stage: [8, 13], minStage: 1, reserve: 1_500_000, upgradeFloor: 2, upgradePerRound: 2, overpay: 1.1, perDay: [2, 3] },
  division2: { balance: 2_500_000, fans: 6_000, stage: [3, 7], minStage: 1, reserve: 600_000, upgradeFloor: 1, upgradePerRound: 0.6, overpay: 1.0, perDay: [1, 1] },
}

export const aiTierProfile = (tier: TierId): TierProfile => TIER_PROFILE[tier]

/** 每个赛季初 AI 按联赛级别从当季商店货架领取的金色技能书数量（级别越高越多）。 */
export const AI_SEASON_SHOP_BOOKS: Record<TierId, number> = {
  division2: 2,
  division1: 4,
  champions: 6,
}

function shuffleWith<T>(items: readonly T[], rng: ReturnType<typeof derivedRng>): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * 赛季初按联赛级别从当季商店货架（shopCatalog）为 AI 发放金色技能书（永久入库、幂等不重发）：
 * - 先锋联赛 2 本 / 季，精英联赛 4 本 / 季，冠军联赛 6 本 / 季；
 * - 自动跳过库存里已有的书；4 本及以上时保证外场、门将、辅助均衡覆盖。
 */
export function grantAISeasonShopBooks(
  state: AIClubState,
  club: Pick<WorldClub, 'id' | 'tier'>,
  worldSeed: number,
  seasonIndex: number,
): number {
  const season = Math.max(1, Math.floor(Number.isFinite(seasonIndex) ? seasonIndex : 1))
  if ((state.booksSeason ?? 0) >= season) return 0
  const count = AI_SEASON_SHOP_BOOKS[club.tier] ?? AI_SEASON_SHOP_BOOKS.division2
  const catalog = shopCatalog(worldSeed, season)
  const existing = state.books ?? []
  const owned = new Set(existing.map((book) => bookKey(book)))
  const available = catalog.filter((offer) => !owned.has(bookKey(offer)))
  const rng = derivedRng(worldSeed, 'ai-shop-books', club.id, season)
  const outfield = shuffleWith(available.filter((offer) => offer.category === 'main' && offer.scope === 'field'), rng)
  const gk = shuffleWith(available.filter((offer) => offer.category === 'main' && offer.scope === 'gk'), rng)
  const aux = shuffleWith(available.filter((offer) => offer.category === 'auxiliary'), rng)

  const picked: LegendBook[] = []
  const take = (pool: typeof available, max: number) => {
    while (picked.length < count && max > 0 && pool.length > 0) {
      const offer = pool.shift()!
      picked.push({ id: offer.id, tier: offer.tier })
      max--
    }
  }
  if (count >= 4) {
    take(gk, 1)
    take(aux, 1)
    take(outfield, count - picked.length)
  } else {
    take(outfield, 1)
  }
  if (picked.length < count) {
    const rest = shuffleWith([...outfield, ...gk, ...aux], rng)
    take(rest, count - picked.length)
  }
  if (picked.length) state.books = [...existing, ...picked]
  state.booksSeason = season
  return picked.length
}

/** 给世界里全部非玩家（且联机无主）的 AI 俱乐部幂等发放当季商店技能书。 */
export function grantAllAISeasonShopBooks(
  world: Pick<WorldState, 'clubs' | 'seasonIndex'>,
  aiClubs: Record<string, AIClubState> | undefined,
  worldSeed: number,
  owners: Readonly<Record<string, string>> = {},
): number {
  if (!aiClubs) return 0
  let total = 0
  for (const club of world.clubs) {
    if (club.isPlayer || owners[club.id]) continue
    const state = aiClubs[club.id]
    if (!state) continue
    total += grantAISeasonShopBooks(state, club, worldSeed, world.seasonIndex)
  }
  return total
}

/**
 * 设施升级留底：本赛季还有买人名额且未满员时，按 `reserve * upgradeFloor` 先给转会留足可用现金；
 * 用完当季买人名额或阵容满员后，回落到 `reserve`（仍绝不低于买人留底线）。
 */
export function aiUpgradeFloor(
  state: Pick<AIClubState, 'transfers'>,
  tier: TierId,
  seasonIndex: number,
  squadSize = 0,
): number {
  const profile = TIER_PROFILE[tier] ?? TIER_PROFILE.division2
  const canBuy = squadSize < AI_SQUAD_LIMIT && aiBuysLeft(state, seasonIndex) > 0
  const multiplier = canBuy ? Math.max(1, profile.upgradeFloor) : 1
  return Math.round(profile.reserve * multiplier)
}

/**
 * 一次训练 = 玩家的一整轮培养（30 个时段），直接调用玩家同一套训练规则。
 * 每天练几个人由 perDay 决定；成长只受球员自己的 PA 上限约束，没有额外加成。
 */
/** 电脑球队阵容上限：比玩家的 25 人低，抢人时会留出位置。 */
/** 电脑球队名单上限：25 人名单再留 4 个签人的空位。 */
export const AI_SQUAD_LIMIT = 29
/** 名单少于这个数就算“人手不够”，会去自由市场补人（比赛名单 18 人再多几个轮换）。 */
const AI_DEPTH_TARGET = FULL_SQUAD + 4
/** 一个赛季最多攒下几个外来球员，免得存档越滚越大。 */
const AI_SIGNING_LIMIT = 6
export const AI_BALANCE_CAP = 60_000_000

/** 电脑球队眼里的身价：和市场估值同一份曲线，出价才不会总是低于起拍价。 */
export function playerValue(player: Pick<Player, 'attrs' | 'positions'>): number {
  return playerMarketValue(player)
}

export function playerCa(player: Pick<Player, 'attrs' | 'positions'>): number {
  return caOf(player.attrs, player.positions.GK > 0)
}

/** 位置分组：电脑球队按这五个位置比较“有没有更强的选择”。 */
export function AI_SLOT_ORDER(): readonly string[] {
  return ['GK', 'CB', 'W', 'CM', 'ST']
}

export function primaryPosition(player: Pick<Player, 'positions'>): string {
  let best: keyof Player['positions'] = 'CM'
  let value = -1
  for (const key of AI_SLOT_ORDER() as (keyof Player['positions'])[]) {
    const score = player.positions[key] ?? 0
    if (score > value) {
      best = key
      value = score
    }
  }
  return best
}

/** 新存档里每支电脑球队的起步状态：级别越高，家底越厚、设施越好。 */
export function createAIClub(club: Pick<WorldClub, 'id' | 'tier'>, seed: number): AIClubState {
  const profile = TIER_PROFILE[club.tier] ?? TIER_PROFILE.division2
  const rng = derivedRng(seed, 'ai-club', club.id)
  const [low, high] = profile.stage
  const stage = low + rng.int(high - low + 1)
  const floor = Math.max(1, profile.minStage)
  return {
    economy: {
      balance: Math.round(profile.balance * (0.8 + rng.float() * 0.4)),
      fans: Math.round(profile.fans * (0.8 + rng.float() * 0.4)),
      stageVersion: 3,
      stadium: stage,
      academy: Math.max(floor, stage - rng.int(3)),
      medical: Math.max(floor, stage - rng.int(4)),
      shop: Math.max(floor, stage - rng.int(3)),
      sponsor: Math.max(floor, stage - rng.int(4)),
      psychology: Math.max(floor, stage - rng.int(3)),
      tactics: Math.max(floor, stage - rng.int(4)),
      lastIncomeRound: 0,
    },
    progress: 0,
    cards: {},
    signings: [],
    trained: 0,
    upgrades: 0,
  }
}

/** 给整个世界的电脑球队补齐账本；已有的不覆盖。 */
export function seedAIClubs(world: WorldState, seed: number): Record<string, AIClubState> {
  const clubs: Record<string, AIClubState> = {}
  for (const club of world.clubs) {
    if (club.isPlayer) continue
    const state = createAIClub(club, splitSeed(seed, `ai-club-${club.id}`))
    grantAISeasonShopBooks(state, club, seed, world.seasonIndex)
    clubs[club.id] = state
  }
  return clubs
}

export function aiClubOf(aiClubs: Record<string, AIClubState> | undefined, world: WorldState, clubId: string, seed: number): AIClubState | undefined {
  const club = world.clubs.find((item) => item.id === clubId)
  if (!club) return undefined
  const book = (aiClubs ??= {})
  const state = (book[clubId] ??= createAIClub(club, splitSeed(seed, `ai-club-${clubId}`)))
  grantAISeasonShopBooks(state, club, seed, world.seasonIndex)
  return state
}

/* ---------------------------------------------------------------- 培养、装备 */

const ownerOf = (player: Pick<Player, 'id' | 'enName'>): string => `${player.id}|${player.enName}`

/**
 * 这个槽位上这名球员自己的卡。卡跟人走：槽位上换了人（签人、赛季重建），
 * 旧卡属于上一个人，不能套给新人，这里按新人现在的属性重新开一张。
 */
function cardOf(state: AIClubState, slot: number, base: Player): AICard {
  const key = String(slot)
  const owner = ownerOf(base)
  const existing = state.cards[key]
  // 老账本的卡没有 owner：认作槽位上现在这个人的。
  if (existing && (existing.owner === undefined || existing.owner === owner)) {
    existing.owner = owner
    return existing
  }
  const card: AICard = { rating: playerCa(base), attrs: { ...base.attrs }, owner }
  state.cards[key] = card
  return card
}

const SKILL_TIER_SCORE: Record<SkillTier, number> = { silver: 6, gold: 10, rainbow: 15 }

function aiSkillScore(skills?: readonly SkillId[], skillTiers?: Partial<Record<SkillId, SkillTier>>): number {
  if (!skills?.length) return 0
  let total = 0
  for (const id of skills) total += SKILL_TIER_SCORE[skillTiers?.[id] ?? 'silver']
  return total
}

function sameSkills(
  a: readonly SkillId[] | undefined,
  aTiers: Partial<Record<SkillId, SkillTier>> | undefined,
  b: readonly SkillId[] | undefined,
  bTiers: Partial<Record<SkillId, SkillTier>> | undefined,
): boolean {
  const left = a ?? []
  const right = b ?? []
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false
    if ((aTiers?.[left[i]] ?? 'silver') !== (bTiers?.[right[i]] ?? 'silver')) return false
  }
  return true
}

/** 把 AI 卡上学会的技能同步到球员身上；首次改写前快照原始技能到 baseSkills，确保下次培养与转会还原不受污染。 */
function applyCardSkills(player: Player, card: AICard): boolean {
  if (!card.skills) return false
  if (sameSkills(player.skills, player.skillTiers, card.skills, card.skillTiers)) return false
  if (player.baseSkills === undefined) {
    player.baseSkills = [...player.skills]
    player.baseSkillTiers = player.skillTiers ? { ...player.skillTiers } : {}
  }
  player.skills = [...card.skills]
  player.skillTiers = card.skillTiers ? { ...card.skillTiers } : {}
  return true
}

function clampAttrs(attrs: Attributes, gk: boolean, clubBonus = 0): void {
  for (const key of ALL_ATTRIBUTES) {
    const max = clubBonus > 0 && isMainAttr(key, gk) ? attrHardLimit(key, gk) : attrMax(key, gk)
    if (!Number.isFinite(attrs[key])) attrs[key] = 0
    if (attrs[key] > max) attrs[key] = max
    if (attrs[key] < 0) attrs[key] = 0
  }
}

/**
 * 自动装备评分更高的卡：优先按球员身份（owner）跨槽位找回他自己练出的最强卡，
 * 避免换季或买卖球员导致槽位顺移时把球星/主力的培养卡清零；
 * 评分不高于现在的不装，球员比卡强时反过来更新卡；别人的卡一律不套给新人。
 */
export function equipAICards(state: AIClubState, players: Player[]): boolean {
  const byOwner = new Map<string, AICard>()
  const legacyBySlot = new Map<string, AICard>()
  for (const [key, card] of Object.entries(state.cards)) {
    if (!card) continue
    if (card.owner === undefined) {
      legacyBySlot.set(key, card)
      continue
    }
    const prev = byOwner.get(card.owner)
    if (
      !prev
      || card.rating > prev.rating + 0.5
      || (Math.abs(card.rating - prev.rating) <= 0.5 && aiSkillScore(card.skills, card.skillTiers) > aiSkillScore(prev.skills, prev.skillTiers))
    ) {
      byOwner.set(card.owner, card)
    }
  }
  const clubBonus = cupCeilingBonusFromClaims(state.cupCeilingClaims)
  const nextCards: Record<string, AICard> = {}
  let changed = false
  for (let slot = 0; slot < players.length; slot++) {
    const player = players[slot]
    if (!player) continue
    const key = String(slot)
    const owner = ownerOf(player)
    let card = byOwner.get(owner)
    if (!card) {
      const legacy = legacyBySlot.get(key)
      if (legacy) {
        legacy.owner = owner
        card = legacy
      }
    }
    const current = playerCa(player)
    if (!card) {
      nextCards[key] = { rating: current, attrs: { ...player.attrs }, owner }
      continue
    }
    if (card.rating > current + 0.5) {
      for (const attr of ALL_ATTRIBUTES) player.attrs[attr] = card.attrs[attr] ?? player.attrs[attr]
      clampAttrs(player.attrs, player.positions.GK > 0, clubBonus)
      applyCardSkills(player, card)
      nextCards[key] = card
      changed = true
    } else if (current > card.rating + 0.5) {
      nextCards[key] = {
        rating: current,
        attrs: { ...player.attrs },
        skills: [...player.skills],
        skillTiers: player.skillTiers ? { ...player.skillTiers } : {},
        owner,
      }
    } else {
      if (card.skills && aiSkillScore(card.skills, card.skillTiers) > aiSkillScore(player.skills, player.skillTiers)) {
        if (applyCardSkills(player, card)) changed = true
      }
      nextCards[key] = card
    }
  }
  state.cards = nextCards
  return changed
}

/** 只处理一个槽位（练完一张卡后用，不必把整个名单再过一遍）。 */
function equipSlot(state: AIClubState, players: Player[], slot: number): boolean {
  const player = players[slot]
  if (!player) return false
  const card = cardOf(state, slot, player)
  const current = playerCa(player)
  if (card.rating > current + 0.4) {
    for (const key of ALL_ATTRIBUTES) player.attrs[key] = card.attrs[key] ?? player.attrs[key]
    clampAttrs(player.attrs, player.positions.GK > 0, cupCeilingBonusFromClaims(state.cupCeilingClaims))
    applyCardSkills(player, card)
    return true
  }
  if (current > card.rating + 0.5) {
    state.cards[String(slot)] = {
      rating: current,
      attrs: { ...player.attrs },
      skills: [...player.skills],
      skillTiers: player.skillTiers ? { ...player.skillTiers } : {},
      owner: ownerOf(player),
    }
    return false
  }
  if (card.skills && aiSkillScore(card.skills, card.skillTiers) > aiSkillScore(player.skills, player.skillTiers)) {
    for (const key of ALL_ATTRIBUTES) player.attrs[key] = card.attrs[key] ?? player.attrs[key]
    clampAttrs(player.attrs, player.positions.GK > 0, cupCeilingBonusFromClaims(state.cupCeilingClaims))
    return applyCardSkills(player, card)
  }
  return false
}

/** 把签下的球员塞进阵容：同位置挑最弱的换掉，位置不合适就补一个空位。 */
export function mergeSignings(state: AIClubState, players: Player[]): Player[] {
  if (!state.signings.length) return players
  const squad = [...players]
  const pending = [...state.signings].sort((a, b) => playerCa(b) - playerCa(a)).slice(0, AI_SIGNING_LIMIT)
  for (const signing of pending) {
    // 当季名单可能已经并入这笔签约，重建球队时不能重复添加同一名球员。
    if (squad.some((player) => player.id === signing.id)) continue
    if (squad.length < AI_SQUAD_LIMIT) {
      squad.push(signing)
      continue
    }
    const position = primaryPosition(signing)
    let weakestIndex = -1
    let weakest = Infinity
    for (let index = 0; index < squad.length; index++) {
      if (primaryPosition(squad[index]) !== position) continue
      const rating = playerCa(squad[index])
      if (rating < weakest) {
        weakest = rating
        weakestIndex = index
      }
    }
    if (weakestIndex >= 0 && playerCa(signing) > weakest) squad[weakestIndex] = signing
  }
  return squad
}

/** 球员没培养过的样子的 CA（原始属性），不随已装备的培养卡变化。 */
function originalCa(player: Player): number {
  return caOf(player.baseAttrs ?? player.attrs, (player.basePositions ?? player.positions).GK > 0)
}

/**
 * 挑下一个要练的槽位：球队现在的人里，原始 CA 最高、且这一圈还没练过的那个。
 * 刚签进来的球星原始 CA 高又没练过，自然排在最前面；全队都练过一遍就清空，从头再来一圈。
 * 挑中的人当场记为“已练”，哪怕这次没练出更好的卡也不会原地重复。
 */
function pickSlot(state: AIClubState, players: Player[] | undefined): number {
  if (!players?.length) return -1
  const owners = new Set(players.map(ownerOf))
  // 已经离队的人不再占着记录。
  const trained = new Set((state.trainedOwners ?? []).filter((owner) => owners.has(owner)))
  const pick = (): number => {
    let best = -1
    let bestCa = -Infinity
    players.forEach((player, slot) => {
      if (trained.has(ownerOf(player))) return
      const ca = originalCa(player)
      if (ca > bestCa) {
        best = slot
        bestCa = ca
      }
    })
    return best
  }
  let slot = pick()
  if (slot < 0) {
    trained.clear()
    slot = pick()
  }
  if (slot >= 0) trained.add(ownerOf(players[slot]))
  state.trainedOwners = [...trained]
  return slot
}

/** 每支球队每天练几次。二级约 1 次，一级 2–3 次，顶级 3–5 次。 */
export function aiTrainingPerDay(tier: TierId, rng: ReturnType<typeof derivedRng>): number {
  const [low, high] = (TIER_PROFILE[tier] ?? TIER_PROFILE.division2).perDay
  return low + rng.int(high - low + 1)
}

/* ------------------------------------------------------------------- 每轮推进 */

export type AIAdvanceResult = { trained: number; upgrades: number }

/**
 * 推进一支电脑球队：收钱、涨球迷、按频率培养、偶尔升设施。
 * `rounds` 是这次补算了多少轮，每天的训练次数按 AVERAGE_ROUND_GAME_DAYS（一天两轮，平均一轮 2 个游戏日）折算。
 * `applyToTeam = false` 时只练卡片，不动当季名单（服务器用：名册改动要等赛季滚动再统一生效，
 * 否则每个 tick 都会改动全服名册、把每个教练的存档版本推高）。
 */
export function advanceAIClub(state: AIClubState, club: Pick<WorldClub, 'id' | 'tier'>, team: AITeam | undefined, rounds: number, seed: number, applyToTeam = true, seasonIndex = 1, worldSeed = seed): AIAdvanceResult {
  if (rounds <= 0) return { trained: 0, upgrades: 0 }
  grantAISeasonShopBooks(state, club, worldSeed, seasonIndex)
  const profile = TIER_PROFILE[club.tier] ?? TIER_PROFILE.division2
  // 收入：和玩家同一套公式（基本收入 + 球迷 + 设施 + 级别转播分成），按轮结算。
  state.economy.balance = Math.min(AI_BALANCE_CAP, state.economy.balance + projectedRoundIncome(state.economy, club.tier) * rounds)
  state.economy.fans = Math.min(MAX_FANS, Math.round(state.economy.fans * (1 + 0.006 * rounds)))
  const players = team?.players
  // 练出来的卡装到球员身上后，首发要跟着重排：评分更高的人才会把原来的主力换下来。
  let equipped = !!players?.length && applyToTeam && equipAICards(state, players)

  const days = rounds * AVERAGE_ROUND_GAME_DAYS
  const rng = derivedRng(seed, 'ai-train', state.trained, rounds)
  state.progress += days * aiTrainingPerDay(club.tier, rng)
  let sessions = Math.floor(state.progress)
  state.progress -= sessions
  sessions = Math.min(sessions, days * profile.perDay[1])
  let trained = 0
  for (let step = 0; step < sessions; step++) {
    const slot = pickSlot(state, players)
    if (slot < 0) break
    const base = players?.[slot]
    // 没有当季名单（其他分区）就不练：账本里的卡等下赛季随名单重建，免得把 GK 属性练到场上球员身上。
    if (!base) break
    const card = cardOf(state, slot, base)
    // 真实培养：从原始属性开始跑完当季培养时段（30 / 40 / 50）、6 名正常陪练、商店技能书、事件与周一交流赛技能学习。
    const trainedPlayer = simulateAITrainingRound(
      base,
      splitSeed(seed, `program-${state.trained}-${slot}`),
      state.economy,
      seasonIndex,
      cupCeilingBonusFromClaims(state.cupCeilingClaims),
      players,
      state.books,
    )
    state.trained += 1
    trained += 1
    const rating = playerCa(trainedPlayer)
    const trainedSkills = [...trainedPlayer.skills]
    const trainedSkillTiers = trainedPlayer.skillTiers ? { ...trainedPlayer.skillTiers } : {}
    const newSkillScore = aiSkillScore(trainedSkills, trainedSkillTiers)
    const oldSkillScore = aiSkillScore(card.skills ?? base.skills, card.skills ? card.skillTiers : base.skillTiers)
    const betterRating = rating > card.rating + 0.4 && (rating + newSkillScore >= card.rating + oldSkillScore)
    const betterSkillsAtSameCa = rating >= card.rating - 0.4 && newSkillScore > oldSkillScore
    const backfillLegacySkills = card.skills === undefined && newSkillScore > oldSkillScore
    if (betterRating || betterSkillsAtSameCa) {
      state.cards[String(slot)] = {
        rating,
        attrs: { ...trainedPlayer.attrs },
        skills: trainedSkills,
        skillTiers: trainedSkillTiers,
        owner: card.owner,
      }
      // 按名单下标装这个槽位自己的卡（不能拿一个人当 0 号槽位去套）。
      if (applyToTeam && players && equipSlot(state, players, slot)) equipped = true
    } else if (backfillLegacySkills) {
      // 老账本无技能字段的旧卡：保留高 CA 属性，补上本轮真实培养学到的技能。
      state.cards[String(slot)] = {
        ...card,
        skills: trainedSkills,
        skillTiers: trainedSkillTiers,
      }
      if (applyToTeam && players && equipSlot(state, players, slot)) equipped = true
    }
  }
  if (equipped && team) refreshAILineup(team)

  // 设施升级按级别限速：二级慢（约两轮升一次）、一级积极、顶级最快；名额按轮累计，钱不够就作废。
  // 当季还有买人名额且未满员时，先按 upgradeFloor 给转会留足预算，避免设施把现金抽干到买人留底以下。
  state.upgradeProgress = (state.upgradeProgress ?? 0) + profile.upgradePerRound * rounds
  const allowance = Math.floor(state.upgradeProgress)
  state.upgradeProgress -= allowance
  const floor = aiUpgradeFloor(state, club.tier, seasonIndex, players?.length ?? 0)
  let upgrades = 0
  while (upgrades < allowance) {
    const cost = cheapestUpgrade(state, club.tier)
    if (cost == null || state.economy.balance - cost < floor) break
    if (upgradeOneFacility(state, club.tier, seed, floor) === 0) break
    upgrades += 1
  }
  return { trained, upgrades }
}

/**
 * 一次性存量迁移：为此前已练过卡、但旧版未保存技能的 AI 球员补跑一轮真实培养（含同队队友技能传承），
 * 保留其现有最高 CA 属性不回退，并把学会的技能写入卡片与现役名单。幂等。
 */
export function backfillAICardSkills(
  state: AIClubState,
  team: AITeam | undefined,
  seed: number,
  seasonIndex = 1,
): boolean {
  if (!team?.players?.length) return false
  const players = team.players
  let changed = equipAICards(state, players)
  // 先处理原本就带技能或 CA 更高的核心球员，便于后续队友传承。
  const slots = players
    .map((player, slot) => ({ slot, priority: (player.skills.length > 0 ? 10_000 : 0) + playerCa(player) }))
    .sort((a, b) => b.priority - a.priority)
    .map((item) => item.slot)
  const cupBonus = cupCeilingBonusFromClaims(state.cupCeilingClaims)
  for (const slot of slots) {
    const player = players[slot]
    const card = state.cards[String(slot)]
    if (!player || !card || card.skills !== undefined) continue
    if (card.rating <= originalCa(player) + 5) continue
    const trained = simulateAITrainingRound(
      player,
      splitSeed(seed, `ai-card-skills-backfill-${team.id}-${slot}`),
      state.economy,
      seasonIndex,
      cupBonus,
      players,
      state.books,
    )
    const trainedSkills = [...trained.skills]
    const trainedSkillTiers = trained.skillTiers ? { ...trained.skillTiers } : {}
    // 仅回填技能与档位，不额外赠送免费 CA 成长，保持对真人玩家公平。
    state.cards[String(slot)] = { ...card, skills: trainedSkills, skillTiers: trainedSkillTiers }
    if (equipSlot(state, players, slot)) changed = true
  }
  if (changed && team) refreshAILineup(team)
  return changed
}

/**
 * 一次性历史补发：此前 advanceAIClub 调用 projectedRoundIncome 时未传入 club.tier，
 * 导致顶级（60万/轮）与一级（15万/轮）无主 AI 球队每轮按二级（3万/轮）结算。
 * 按 world.history 逆推每支球队历季真实级别，补齐全部漏发的转播分成差额（受 AI_BALANCE_CAP 封顶）。
 */
export function backfillAITierIncome(
  world: Pick<WorldState, 'clubs' | 'seasonIndex' | 'history'>,
  aiClubs: Record<string, AIClubState> | undefined,
  aiRound: number,
  owners: Readonly<Record<string, string>> = {},
): { clubs: number; totalAmount: number } {
  if (!aiClubs) return { clubs: 0, totalAmount: 0 }
  const base = TIER_ROUND_INCOME.division2
  const deltaFor = (tier: TierId | undefined): number => Math.max(0, (TIER_ROUND_INCOME[tier ?? 'division2'] ?? base) - base)
  const currentRounds = Math.min(38, Math.max(0, Math.floor(aiRound)))
  const history = [...(world.history ?? [])].sort((a, b) => b.seasonIndex - a.seasonIndex)
  let clubs = 0
  let totalAmount = 0
  for (const club of world.clubs) {
    if (club.isPlayer || owners[club.id]) continue
    const state = aiClubs[club.id]
    if (!state) continue
    let tier: TierId = club.tier ?? 'division2'
    let missed = deltaFor(tier) * currentRounds
    for (const entry of history) {
      if (entry.seasonIndex >= world.seasonIndex) continue
      if (entry.promotions?.includes(club.id)) {
        tier = tier === 'champions' ? 'division1' : 'division2'
      } else if (entry.relegations?.includes(club.id)) {
        tier = tier === 'division2' ? 'division1' : 'champions'
      }
      missed += deltaFor(tier) * 38
    }
    if (missed <= 0) continue
    const before = state.economy.balance
    state.economy.balance = Math.min(AI_BALANCE_CAP, before + missed)
    const added = state.economy.balance - before
    if (added > 0) {
      clubs++
      totalAmount += added
    }
  }
  return { clubs, totalAmount }
}

/** 当前买得起的最便宜的那次升级要多少钱。 */
function cheapestUpgrade(state: AIClubState, tier: TierId): number | null {
  const costs = AI_FACILITIES
    .map((id) => facilityUpgradeCost(id, state.economy[id]))
    .filter((cost): cost is number => cost != null)
  return costs.length ? Math.min(...costs) : null
}

/** 升一次设施（挑阶段最低、优先级最高的那个），不会花到升级留底以下。 */
function upgradeOneFacility(state: AIClubState, tier: TierId, seed: number, floor: number): number {
  const budget = state.economy.balance - floor
  if (budget <= 0) return 0
  const options = AI_FACILITIES
    .map((id) => ({ id, stage: state.economy[id], cost: facilityUpgradeCost(id, state.economy[id]) }))
    .filter((option) => option.cost != null && option.cost <= budget)
    .sort((a, b) => a.stage - b.stage || AI_FACILITIES.indexOf(a.id) - AI_FACILITIES.indexOf(b.id))
  if (!options.length) return 0
  const chosen = options[0]
  state.economy.balance -= chosen.cost!
  state.economy[chosen.id] = chosen.stage + 1
  state.upgrades += 1
  void tier
  void seed
  return 1
}

/**
 * 单机推进：玩家所在联赛那几支队直接练名单；其它联赛的队没有存档里的名单，
 * 就按世界种子复原一份名单当“靶子”，只练账本里的卡（不改名单），所以所有球队都会随时间变强。
 */
export function advanceAIClubs(game: { world?: WorldState; aiTeams?: AITeam[]; aiClubs?: Record<string, AIClubState>; seed: number; season?: { round: number; index: number } }, rounds = 1): boolean {
  if (!game.world || rounds <= 0) return false
  // 联机账号的 aiClubs 由服务器下发（初始是空对象），本地不要再算一份，否则会和全服名册打架。
  if (game.aiClubs && Object.keys(game.aiClubs).length === 0) return false
  const book = (game.aiClubs ??= seedAIClubs(game.world, game.seed))
  const teams = new Map((game.aiTeams ?? []).map((team) => [team.id, team]))
  let ownerless: Record<string, AITeam> | undefined
  for (const club of game.world.clubs) {
    if (club.isPlayer) continue
    const state = (book[club.id] ??= createAIClub(club, splitSeed(game.seed, `ai-club-${club.id}`)))
    const own = teams.get(club.id)
    // 其他分区没有存档名单：用种子复原的名单当培养对象，只练账本里的卡，不动任何名单。
    const team = own ?? (ownerless ??= cachedOwnerlessTeams(game.world, game.seed, game.aiClubs))[club.id]
    advanceAIClub(state, club, team, rounds, splitSeed(game.seed, `ai-advance-${club.id}-${game.season?.round ?? 1}-${rounds}`), !!own, game.world.seasonIndex, game.seed)
  }
  return true
}

/* --------------------------------------------------------------------- 抢人 */

export type AIBidInput = {
  state: AIClubState
  tier: TierId
  player: Player
  squad: Player[]
  /** 市场估值，和挂牌/竞拍用的是同一个数。 */
  value: number
  /** 下一口至少出多少。 */
  minimum: number
  /** 目前最高价；没有出价时传 null。 */
  rival?: number | null
  /** 这支球队在别的竞拍里已经压着的钱。 */
  committed?: number
  /** 本赛季还能买几个人（每赛季最多 5 人）；不传按不限。 */
  buysLeft?: number
  depth?: AIDepth
}

/** 单笔转会可用现金上限：两套阵容未齐时按剩余缺口均摊可用资金，补齐后单笔不超过可用资金的四成。 */
export function aiTransferCashBudget(state: AIClubState, tier: TierId, committed = 0, depth?: AIDepth): number {
  const profile = TIER_PROFILE[tier] ?? TIER_PROFILE.division2
  const spendable = state.economy.balance - profile.reserve - Math.max(0, committed)
  if (spendable <= 0) return 0
  return depth?.missing ? Math.floor(spendable / depth.missing) : Math.floor(spendable * 0.4)
}

/**
 * 电脑球队的出价策略。
 *
 * 两套阵容未齐前只给能填补空位的人出价，不设 CA 下限，并按「可用资金 ÷ 剩余缺口数」均摊单名额预算
 * （配合 strongestFirst 在预算内挑原始 CA 最高的球员）；两套齐整后才按升级或性价比逐渐考虑补强。
 * 出价封顶是“估值 × 级别系数”，永远不动留底的钱；齐整后单笔不超过可用资金的四成；
 * 对手已经出到自己出不起的价就不再跟，绝不为了抬价乱加。
 */
export function aiBidFor(input: AIBidInput): number | null {
  const { state, tier, player, squad, value, minimum } = input
  const rival = input.rival ?? null
  if (!(value > 0) || !(minimum > 0)) return null
  if (input.buysLeft !== undefined && input.buysLeft <= 0) return null
  const profile = TIER_PROFILE[tier] ?? TIER_PROFILE.division2
  if (squad.length >= AI_SQUAD_LIMIT) return null
  const spendable = state.economy.balance - profile.reserve - Math.max(0, input.committed ?? 0)
  if (spendable < minimum) return null

  const fillsGap = !!input.depth?.improves(player)
  if (input.depth?.missing && !fillsGap) return null
  // 补位按剩余缺口均摊可用资金；低 CA 不拦截，也不突破单名额预算或估值溢价上限。
  if (fillsGap) {
    const cap = Math.min(
      aiTransferCashBudget(state, tier, input.committed, input.depth),
      Math.round(value * profile.overpay * 1.1),
    )
    if (cap < minimum || (rival != null && rival >= cap)) return null
    return minimum
  }

  const gk = player.positions.GK > 0
  const ca = caOf(player.attrs, gk)
  const position = primaryPosition(player)
  const same = squad.filter((item) => primaryPosition(item) === position)
  const weakest = same.length ? Math.min(...same.map((item) => playerCa(item))) : 0
  const need = ca - weakest
  const averageValue = squad.length ? squad.reduce((sum, item) => sum + playerValue(item), 0) / squad.length : 0

  const reasons: string[] = []
  if (same.length === 0) reasons.push('missing')
  else if (need >= Math.max(12, ca * 0.04)) reasons.push('upgrade')
  if (averageValue > 0 && value <= averageValue * 0.8) reasons.push('bargain')
  if (squad.length < AI_DEPTH_TARGET) reasons.push('depth')
  if (!reasons.length) return null
  // 明显不如现有球员、也不缺人，就不花这个钱。
  if (need < -ca * 0.03 && !reasons.includes('depth') && !reasons.includes('missing')) return null

  const big = reasons.includes('upgrade') || reasons.includes('missing')
  const cap = Math.min(
    Math.floor(spendable * 0.4),
    Math.round(value * profile.overpay * (big ? 1.1 : 1)),
  )
  if (cap < minimum) return null
  if (rival != null && rival >= cap) return null
  const want = big ? cap : Math.min(cap, value)
  const amount = rival != null ? Math.max(minimum, Math.min(cap, Math.ceil(rival * 1.05))) : Math.max(minimum, Math.min(cap, want))
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null
}

/** 电脑球队把签下的人记进账本，赛季重建时并进名单。 */
export function recordAISigning(state: AIClubState, player: Player, amount: number): void {
  delete player.marketDay
  delete player.releasedToMarket
  if (state.signings.some((item) => item.id === player.id)) return
  state.economy.balance = Math.max(0, state.economy.balance - amount)
  state.signings = [...state.signings, player].sort((a, b) => playerCa(b) - playerCa(a)).slice(0, AI_SIGNING_LIMIT)
}

/** 原始 CA 高优先，同 CA 价格低优先；id 仅让完全相同的候选排序可复现。 */
export function strongestFirst(a: { price: number; ca: number; player: Player }, b: { price: number; ca: number; player: Player }): number {
  return b.ca - a.ca || a.price - b.price || a.player.id.localeCompare(b.player.id)
}

/** 每队每轮最多释放一名冗员；绝不通过裁人减少两套阵容的实际覆盖数。 */
export function releaseDepthSurplus(team: AITeam, state: AIClubState, club: WorldClub, pool: Player[], season: number, round: number): Player | undefined {
  if (team.players.length <= 22 || state.lastDepthRelease === `${season}:${round}`) return
  const depth = analyzeAIDepth(team)
  if (!depth.missing) return
  const starters = new Set(team.lineup.starters.map(s => s.playerId))
  const p = team.players.filter(p => depth.expendable.has(p.id) && !starters.has(p.id) && !pool.some(f => f.id === p.id))
    .sort((a, b) => Number(!!a.starKey) - Number(!!b.starKey) || originalCa(a) - originalCa(b) || a.id.localeCompare(b.id))[0]
  if (!p) return
  team.players = team.players.filter(x => x.id !== p.id)
  team.starPlayerIds = team.starPlayerIds.filter(id => id !== p.id)
  club.starPlayerIds = club.starPlayerIds.filter(id => id !== p.id)
  team.playerNames = team.playerNames.filter(name => name !== p.name)
  state.signings = state.signings.filter(x => x.id !== p.id)
  state.lastDepthRelease = `${season}:${round}`
  refreshAILineup(team)
  const released = untrainedPlayer(p)
  delete released.contract
  delete released.marketDay
  delete released.unhappy
  released.releasedToMarket = true
  pool.push(released)
  return released
}

/* ------------------------------------------------------------------ 单机整合 */

/**
 * 自由市场也会被电脑球队盯上：比本队同位置强、或者性价比高就签走。
 * 所有球队都可以签人，不因池内人数或其他球队已经成交而跳过。
 */
export function aiSignFreeAgents(game: Pick<GameState, 'transferNews'> & { world?: WorldState; createdAt?: number; aiClubs?: Record<string, AIClubState>; aiTeams?: AITeam[]; freeStars: Player[]; seed: number; season?: { index: number } }, round: number, now = Date.now()): number {
  if (!game.world || !game.aiClubs || !game.aiTeams?.length) return 0
  if (Object.keys(game.aiClubs).length === 0) return 0
  const anchor = { world: game.world, createdAt: game.createdAt ?? now }
  const targets = game.freeStars.filter(p => isOnMarketToday(anchor, p, now)).map(p => {
    const player = untrainedPlayer(p)
    return { player, price: basePlayerMarketValue(player), ca: originalCa(player) }
  }).sort(strongestFirst)
  const taken = new Set<string>()
  let signed = 0
  // 轮换先选的球队，但不限制多少家可在同一轮签约。
  const start = derivedRng(game.seed, 'free-buyers', round).int(game.aiTeams.length)
  for (let i = 0; i < game.aiTeams.length; i++) {
    const club = game.aiTeams[(start + i) % game.aiTeams.length], state = game.aiClubs[club.id]
    if (!state) continue
    const season = game.season?.index ?? game.world.seasonIndex
    let depth = analyzeAIDepth(club)
    for (;;) {
      const buysLeft = aiBuysLeft(state, season)
      if (!buysLeft || club.players.length >= AI_SQUAD_LIMIT) break
      const pick = targets.find(({ player, price }) =>
        !taken.has(player.id)
        && aiBidFor({ state, tier: club.tier ?? 'division2', player, squad: club.players, depth, value: price, minimum: price, buysLeft }) !== null,
      )
      if (!pick) break
      const fillingGap = depth.missing > 0
      recordAISigning(state, pick.player, pick.price)
      recordTransfer(game, pick.player, club.name, pick.price, 'free', undefined, now)
      noteAIBuy(state, season)
      taken.add(pick.player.id); signed++
      club.players = [...club.players, pick.player]
      refreshAILineup(club)
      depth = analyzeAIDepth(club)
      if (fillingGap && !depth.missing) break
    }
  }
  if (taken.size) game.freeStars = game.freeStars.filter(p => !taken.has(p.id))
  return signed
}

/** 一轮结束后的电脑球队行为：结算收入、培养、升级设施、抢自由球员。 */
export function runAIClubs(game: GameState, round: number): void {
  if (!game.world) return
  advanceAIClubs(game, 1)
  for (const team of game.aiTeams) {
    const state = game.aiClubs?.[team.id], club = game.world.clubs.find(c => c.id === team.id)
    if (state && club) releaseDepthSurplus(team, state, club, game.freeStars, game.season.index, round)
  }
  aiSignFreeAgents(game, round)
}
