import { caOf, costAttrs } from './ca.ts'
import { MAX_FANS, STAGES_PER_LEVEL, facilityLevel, facilityStageChance, facilityUpgradeCost, projectedRoundIncome } from './economy.ts'
import { ROUND_GAME_DAYS } from './calendar.ts'
import { derivedRng, splitSeed } from './rng.ts'
import { playerMarketValue } from './pricing.ts'
import { isOnMarketToday } from './market-window.ts'
import { attrMax, attrRating } from './scale.ts'
import { ALL_ATTRIBUTES, type AICard, type AIClubState, type AITeam, type AttrKey, type Attributes, type FacilityId, type GameState, type Player, type TierId, type WorldClub, type WorldState } from './types.ts'
import { FULL_SQUAD, repairLineup, validateLineup } from './squad.ts'
import { cachedOwnerlessTeams } from './world.ts'

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
  /** 升设施时最少留下的钱占 reserve 的比例。顶级球队优先升级，敢花到留底的一半。 */
  upgradeFloor: number
  /** 每轮最多升几次设施（小数按轮累计）：二级慢、一级积极、顶级最快。 */
  upgradePerRound: number
  /** 抢人时最多愿意出到估值的几倍。级别越高越敢花。 */
  overpay: number
  /** 每个游戏日的培养次数区间（含两端）。 */
  perDay: readonly [number, number]
}

const TIER_PROFILE: Record<TierId, TierProfile> = {
  champions: { balance: 12_000_000, fans: 44_000, stage: [12, 18], minStage: 11, reserve: 3_000_000, upgradeFloor: 0.5, upgradePerRound: 4, overpay: 1.2, perDay: [3, 5] },
  division1: { balance: 6_000_000, fans: 17_000, stage: [8, 13], minStage: 1, reserve: 1_500_000, upgradeFloor: 1, upgradePerRound: 2, overpay: 1.1, perDay: [2, 3] },
  division2: { balance: 2_500_000, fans: 6_000, stage: [3, 7], minStage: 1, reserve: 600_000, upgradeFloor: 1, upgradePerRound: 0.6, overpay: 1.0, perDay: [1, 1] },
}

export const aiTierProfile = (tier: TierId): TierProfile => TIER_PROFILE[tier]

/**
 * 一次培养的基础力度（1500 分制 CA）：和玩家自己培养同量级——玩家一次平均涨 7 点左右，
 * 这里再乘设施系数（0.9–2.1）和设施触发概率。级别之间的差距在每天练几次，不在单次力度。
 */
const AI_CA_PER_SESSION = 6
/** 离潜力（PA）还剩这么多 CA 以内时成长逐渐放缓，免得每天练好几次的顶级球队涨到离谱。 */
const AI_PA_TAPER = 120
/** 电脑球队阵容上限：比玩家的 25 人低，抢人时会留出位置。 */
/** 电脑球队名单上限：25 人名单再留 4 个签人的空位。 */
export const AI_SQUAD_LIMIT = 29
/** 名单少于这个数就算“人手不够”，会去自由市场补人（比赛名单 18 人再多几个轮换）。 */
const AI_DEPTH_TARGET = FULL_SQUAD + 4
/** 一个赛季最多攒下几个外来球员，免得存档越滚越大。 */
const AI_SIGNING_LIMIT = 6
const AI_BALANCE_CAP = 60_000_000

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
    clubs[club.id] = createAIClub(club, splitSeed(seed, `ai-club-${club.id}`))
  }
  return clubs
}

export function aiClubOf(aiClubs: Record<string, AIClubState> | undefined, world: WorldState, clubId: string, seed: number): AIClubState | undefined {
  const club = world.clubs.find((item) => item.id === clubId)
  if (!club) return undefined
  const book = (aiClubs ??= {})
  return (book[clubId] ??= createAIClub(club, splitSeed(seed, `ai-club-${clubId}`)))
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

function clampAttrs(attrs: Attributes, gk: boolean): void {
  for (const key of ALL_ATTRIBUTES) {
    const max = attrMax(key, gk)
    if (!Number.isFinite(attrs[key])) attrs[key] = 0
    if (attrs[key] > max) attrs[key] = max
    if (attrs[key] < 0) attrs[key] = 0
  }
}

/**
 * 自动装备评分更高的卡：只有这名球员自己的、评分比他现在高的卡才会装上；
 * 评分不高于现在的不装，球员比卡强时反过来更新卡。别人的卡（槽位上换了人）一律不套。
 */
export function equipAICards(state: AIClubState, players: Player[]): boolean {
  let changed = false
  for (let slot = 0; slot < players.length; slot++) if (equipSlot(state, players, slot)) changed = true
  return changed
}

/** 只处理一个槽位（练完一张卡后用，不必把整个名单再过一遍）。 */
function equipSlot(state: AIClubState, players: Player[], slot: number): boolean {
  const player = players[slot]
  if (!player) return false
  const card = cardOf(state, slot, player)
  const current = playerCa(player)
  if (card.rating > current + 0.5) {
    for (const key of ALL_ATTRIBUTES) player.attrs[key] = card.attrs[key] ?? player.attrs[key]
    clampAttrs(player.attrs, player.positions.GK > 0)
    return true
  }
  if (current > card.rating + 0.5) state.cards[String(slot)] = { rating: current, attrs: { ...player.attrs }, owner: ownerOf(player) }
  return false
}

/** 把签下的球员塞进阵容：同位置挑最弱的换掉，位置不合适就补一个空位。 */
export function mergeSignings(state: AIClubState, players: Player[]): Player[] {
  if (!state.signings.length) return players
  const squad = [...players]
  const pending = [...state.signings].sort((a, b) => playerCa(b) - playerCa(a)).slice(0, AI_SIGNING_LIMIT)
  for (const signing of pending) {
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

const growableAttrs = (gk: boolean): readonly AttrKey[] => costAttrs(gk)

function growCard(state: AIClubState, card: AICard, gk: boolean, rng: ReturnType<typeof derivedRng>, pa?: number): number {
  const before = caOf(card.attrs, gk)
  const facilityScale = 0.6 + facilityLevel(state.economy.stadium) / 5 + facilityLevel(state.economy.academy) / 10
  // 越接近潜力越难练；没有名单（只有账本）时没有潜力可比，按满力度算。
  const taper = pa === undefined ? 1 : Math.max(0, Math.min(1, (pa - before) / AI_PA_TAPER))
  const gain = AI_CA_PER_SESSION * facilityScale * (0.6 + rng.float() * 0.8) * taper
  if (!(gain > 0)) return before
  const keys = growableAttrs(gk)
  // 把“提升 X 点能力评分”换算成属性比例：评分近似和属性评分的平方成正比。
  const factor = Math.sqrt((before + gain) / Math.max(1, before))
  const chances = {
    stadium: facilityStageChance(state.economy.stadium),
    academy: facilityStageChance(state.economy.academy),
    medical: facilityStageChance(state.economy.medical),
    psychology: facilityStageChance(state.economy.psychology),
    tactics: facilityStageChance(state.economy.tactics),
  }
  const rolls = {
    stadium: rng.float(),
    academy: rng.float(),
    medical: rng.float(),
    psychology: rng.float(),
    tactics: rng.float(),
  }
  // 球场管全属性，其它设施管各自那一类；抽到没触发就这次白练，和玩家一样。
  const boost = 0.6 + 0.4 * ((rolls.stadium < chances.stadium ? 1 : 0) + (rolls.academy < chances.academy ? 1 : 0) + (rolls.medical < chances.medical ? 1 : 0) + (rolls.psychology < chances.psychology ? 1 : 0) + (rolls.tactics < chances.tactics ? 1 : 0)) / 5
  for (const key of keys) card.attrs[key] = Math.round(card.attrs[key] * (1 + (factor - 1) * boost))
  clampAttrs(card.attrs, gk)
  return caOf(card.attrs, gk)
}

/** 挑一个最该练的槽位：评分最低的那几个里随机一个，青训好的队会顺带照顾年轻人。 */
function pickSlot(state: AIClubState, players: Player[] | undefined, rng: ReturnType<typeof derivedRng>): number {
  const ratings: { slot: number; rating: number }[] = []
  const length = players?.length ?? Math.max(0, ...Object.keys(state.cards).map((key) => Number(key) + 1))
  for (let slot = 0; slot < length; slot++) {
    const player = players?.[slot]
    const card = state.cards[String(slot)]
    ratings.push({ slot, rating: player ? Math.min(playerCa(player), card?.rating ?? Infinity) : card?.rating ?? 0 })
  }
  if (!ratings.length) return -1
  ratings.sort((a, b) => a.rating - b.rating)
  return ratings[Math.min(ratings.length - 1, rng.int(3))].slot
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
 * `rounds` 是这次补算了多少轮，每天的训练次数按 ROUND_GAME_DAYS 折算。
 * `applyToTeam = false` 时只练卡片，不动当季名单（服务器用：名册改动要等赛季滚动再统一生效，
 * 否则每个 tick 都会改动全服名册、把每个教练的存档版本推高）。
 */
export function advanceAIClub(state: AIClubState, club: Pick<WorldClub, 'id' | 'tier'>, team: AITeam | undefined, rounds: number, seed: number, applyToTeam = true): AIAdvanceResult {
  if (rounds <= 0) return { trained: 0, upgrades: 0 }
  const profile = TIER_PROFILE[club.tier] ?? TIER_PROFILE.division2
  // 收入：和玩家同一套公式（基本收入 + 球迷 + 设施），按轮结算。
  state.economy.balance = Math.min(AI_BALANCE_CAP, state.economy.balance + projectedRoundIncome(state.economy) * rounds)
  state.economy.fans = Math.min(MAX_FANS, Math.round(state.economy.fans * (1 + 0.006 * rounds)))
  const players = team?.players
  if (players && players.length && applyToTeam) equipAICards(state, players)

  const days = rounds * ROUND_GAME_DAYS
  const rng = derivedRng(seed, 'ai-train', state.trained, rounds)
  state.progress += days * aiTrainingPerDay(club.tier, rng)
  let sessions = Math.floor(state.progress)
  state.progress -= sessions
  sessions = Math.min(sessions, days * profile.perDay[1])
  let trained = 0
  for (let step = 0; step < sessions; step++) {
    const slot = pickSlot(state, players, rng)
    if (slot < 0) break
    const base = players?.[slot]
    // 没有当季名单（其他分区）就不练：账本里的卡等下赛季随名单重建，免得把 GK 属性练到场上球员身上。
    if (!base) break
    const card = cardOf(state, slot, base)
    const gk = base.positions.GK > 0
    const before = card.rating
    const after = growCard(state, card, gk, rng, base.pa)
    if (after <= before + 0.4) continue
    state.cards[String(slot)] = { rating: after, attrs: { ...card.attrs }, owner: card.owner }
    trained += 1
    // 按名单下标装这个槽位自己的卡（不能拿一个人当 0 号槽位去套）。
    if (applyToTeam && players) equipSlot(state, players, slot)
    state.trained += 1
  }

  // 设施升级按级别限速：二级慢（约两轮升一次）、一级积极、顶级最快；名额按轮累计，钱不够就作废。
  // 升级前的留底比买人时更低：顶级球队优先升设施，宁可少留点钱。
  state.upgradeProgress = (state.upgradeProgress ?? 0) + profile.upgradePerRound * rounds
  const allowance = Math.floor(state.upgradeProgress)
  state.upgradeProgress -= allowance
  const floor = Math.round(profile.reserve * profile.upgradeFloor)
  let upgrades = 0
  while (upgrades < allowance) {
    const cost = cheapestUpgrade(state, club.tier)
    if (cost == null || state.economy.balance - cost < floor) break
    if (upgradeOneFacility(state, club.tier, seed) === 0) break
    upgrades += 1
  }
  return { trained, upgrades }
}

/** 当前买得起的最便宜的那次升级要多少钱。 */
function cheapestUpgrade(state: AIClubState, tier: TierId): number | null {
  const costs = AI_FACILITIES
    .map((id) => facilityUpgradeCost(id, state.economy[id]))
    .filter((cost): cost is number => cost != null)
  return costs.length ? Math.min(...costs) : null
}

/** 升一次设施（挑阶段最低、优先级最高的那个），不会花到升级留底以下。 */
function upgradeOneFacility(state: AIClubState, tier: TierId, seed: number): number {
  const profile = TIER_PROFILE[tier] ?? TIER_PROFILE.division2
  const budget = state.economy.balance - Math.round(profile.reserve * profile.upgradeFloor)
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
    advanceAIClub(state, club, team, rounds, splitSeed(game.seed, `ai-advance-${club.id}-${game.season?.round ?? 1}-${rounds}`), !!own)
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
}

/**
 * 电脑球队的出价策略。
 *
 * 只在三种情况下出手：本队同位置明显不如他、性价比很高（远低于阵容均价）、人手不够。
 * 出价封顶是“估值 × 级别系数”，并且永远不动留底的钱、单笔不超过可用资金的四成；
 * 对手已经出到自己出不起的价就不再跟，绝不为了抬价乱加。
 */
export function aiBidFor(input: AIBidInput): number | null {
  const { state, tier, player, squad, value, minimum } = input
  const rival = input.rival ?? null
  if (!(value > 0) || !(minimum > 0)) return null
  const profile = TIER_PROFILE[tier] ?? TIER_PROFILE.division2
  if (squad.length >= AI_SQUAD_LIMIT) return null
  const spendable = state.economy.balance - profile.reserve - Math.max(0, input.committed ?? 0)
  if (spendable < minimum) return null

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
  if (state.signings.some((item) => item.id === player.id)) return
  state.economy.balance = Math.max(0, state.economy.balance - amount)
  state.signings = [...state.signings, player].sort((a, b) => playerCa(b) - playerCa(a)).slice(0, AI_SIGNING_LIMIT)
}

/* ------------------------------------------------------------------ 单机整合 */

/**
 * 自由市场也会被电脑球队盯上：比本队同位置强、或者性价比高就签走。
 * 只在池子还厚的时候动手，免得玩家一进市场发现没人可签。
 */
export function aiSignFreeAgents(game: { world?: WorldState; createdAt?: number; aiClubs?: Record<string, AIClubState>; aiTeams?: AITeam[]; freeStars: Player[]; seed: number }, round: number, now = Date.now()): number {
  if (!game.world || !game.aiClubs || !game.aiTeams?.length) return 0
  if (Object.keys(game.aiClubs).length === 0) return 0
  if (game.freeStars.length <= 24) return 0
  const rng = derivedRng(splitSeed(game.seed, 'ai-poach'), round)
  const anchor = { world: game.world, createdAt: game.createdAt ?? now }
  const targets = game.freeStars
    .filter((player) => isOnMarketToday(anchor, player, now))
    .sort((a, b) => playerCa(b) - playerCa(a))
    .slice(0, 12)
  let signed = 0
  for (const player of targets) {
    if (signed >= 2) break
    const club = game.aiTeams![rng.int(game.aiTeams!.length)]
    const state = game.aiClubs?.[club.id]
    if (!state || club.players.length >= AI_SQUAD_LIMIT) continue
    const value = playerValue(player)
    const plan = aiBidFor({ state, tier: club.tier ?? 'division2', player, squad: club.players, value, minimum: value })
    if (!plan) continue
    recordAISigning(state, player, Math.min(plan, value))
    game.freeStars = game.freeStars.filter((item) => item.id !== player.id)
    club.players = [...club.players, player]
    const repaired = repairLineup(club.players, club.lineup)
    if (validateLineup(club.players, repaired.lineup).valid) club.lineup = repaired.lineup
    signed += 1
  }
  return signed
}

/** 一轮结束后的电脑球队行为：结算收入、培养、升级设施、抢自由球员。 */
export function runAIClubs(game: GameState, round: number): void {
  if (!game.world) return
  advanceAIClubs(game, 1)
  aiSignFreeAgents(game, round)
}
