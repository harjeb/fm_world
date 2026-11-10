import type { GameState, Player, TierId } from './types.ts'
import { derivedRng, splitSeed } from './rng.ts'
import { caOf } from './ca.ts'

/** 谈判里可以承诺的赛季目标。 */
export type SeasonGoal = 'title' | 'promotion' | 'top-half' | 'survival'
/** 谈判里可以承诺的队内位置。 */
export type SquadRole = 'star' | 'first-team' | 'rotation'

export const SEASON_GOAL_LABELS: Record<SeasonGoal, string> = {
  title: '争冠 / 升级',
  promotion: '冲击上游',
  'top-half': '稳居中游',
  survival: '保级为主',
}

export const SQUAD_ROLE_LABELS: Record<SquadRole, string> = {
  star: '绝对主力',
  'first-team': '常规首发',
  rotation: '轮换替补',
}

export const TIER_LABELS: Record<TierId, string> = {
  champions: '冠军联赛',
  division1: '一级联赛',
  division2: '二级联赛',
}

const TIER_RANK: Record<TierId, number> = { division2: 1, division1: 2, champions: 3 }
const GOAL_RANK: Record<SeasonGoal, number> = { survival: 1, 'top-half': 2, promotion: 3, title: 4 }
const ROLE_RANK: Record<SquadRole, number> = { rotation: 1, 'first-team': 2, star: 3 }

/** 球员本人的诉求：这些都是他在谈判里会说的东西。 */
export type NegotiationDemands = {
  goal: SeasonGoal
  role: SquadRole
  /** 只肯去这个级别或更高的联赛。 */
  minTier: TierId | null
  /** 直说了想去这支球队；不是你的球队就要多出很多钱。 */
  wantsClubId: string | null
  wantsClubName: string | null
  /** 0.7–1.4：越高越看重钱，满足诉求的加成也越难凑满。 */
  greed: number
}

export type NegotiationAnswers = { goal: SeasonGoal; role: SquadRole }

export type NegotiationInput = {
  demands: NegotiationDemands
  /** 市场估值。 */
  value: number
  /** 对方底价：低于这个数直接免谈。 */
  asking: number
  offer: number
  answers: NegotiationAnswers
  clubTier: TierId
  clubId: string
}

export type NegotiationTerms = {
  chance: number
  reasons: string[]
  hard: string[]
}

export function negotiationKey(player: Pick<Player, 'id' | 'starKey'>): string {
  return player.starKey || player.id
}

/** 这些诉求完全由球员本人和存档种子决定，存档重开或反复点谈判都不会变。 */
export function negotiationDemands(game: Pick<GameState, 'seed' | 'world' | 'season'>, player: Player): NegotiationDemands {
  const rng = derivedRng(splitSeed(game.seed, 'negotiation-demands'), negotiationKey(player))
  const ca = caOf(player.baseAttrs ?? player.attrs, (player.basePositions ?? player.positions).GK > 0)
  const goal: SeasonGoal = ca >= 262
    ? 'title'
    : ca >= 246
      ? (rng.chance(0.65) ? 'title' : 'promotion')
      : ca >= 230
        ? (rng.chance(0.5) ? 'promotion' : 'top-half')
        : (rng.chance(0.6) ? 'top-half' : 'survival')
  const role: SquadRole = ca >= 252 ? 'star' : ca >= 236 ? 'first-team' : 'rotation'
  const minTier: TierId | null = ca >= 268 ? 'champions' : ca >= 255 ? (rng.chance(0.35) ? 'division1' : null) : null
  const greed = 0.7 + rng.int(61) / 100
  let wantsClubId: string | null = null
  let wantsClubName: string | null = null
  // 三成左右的球员会直说“我想去某支球队”，只从和他同级别或更高的队里挑。
  if (game.world && rng.chance(0.3)) {
    const tierRank = TIER_RANK[game.season?.tier ?? 'division2'] ?? 1
    const clubs = game.world.clubs.filter((club) => (TIER_RANK[club.tier] ?? 1) >= tierRank && club.id !== 'player')
    if (clubs.length) {
      const club = clubs[rng.int(clubs.length)]
      wantsClubId = club.id
      wantsClubName = club.name
    }
  }
  return { goal, role, minTier, wantsClubId, wantsClubName, greed }
}

/**
 * 谈判成功率。给钱能解决大部分问题，但三种情况很难用钱抹平：
 * 想去的球队不是你家、要求的联赛级别不够、承诺的目标/位置低于他的要求。
 */
export function negotiationTerms(input: NegotiationInput): NegotiationTerms {
  const { demands, value, asking, offer, answers, clubTier, clubId } = input
  const reasons: string[] = []
  const hard: string[] = []
  if (!(value > 0) || !(asking > 0) || !Number.isSafeInteger(offer) || offer <= 0) {
    return { chance: 0, reasons: ['报价无效'], hard: ['报价无效'] }
  }
  if (offer < asking) {
    reasons.push(`对方底价 ${asking.toLocaleString()}，这个报价不会谈`)
    return { chance: 0, reasons, hard: ['报价低于底价'] }
  }
  const over = offer / asking
  let chance = 0.45 + (over - 1) * 1.5 / demands.greed
  reasons.push(`报价是底价的 ${(over * 100).toFixed(0)}%`)

  if (GOAL_RANK[answers.goal] >= GOAL_RANK[demands.goal]) {
    chance += GOAL_RANK[answers.goal] > GOAL_RANK[demands.goal] ? 0.12 : 0.18
    reasons.push(`球队目标「${SEASON_GOAL_LABELS[answers.goal]}」符合他的期待`)
  } else {
    chance -= 0.3
    reasons.push(`他想听到「${SEASON_GOAL_LABELS[demands.goal]}」，你的目标不够有野心`)
  }

  if (ROLE_RANK[answers.role] >= ROLE_RANK[demands.role]) {
    chance += 0.15
    reasons.push(`承诺的位置「${SQUAD_ROLE_LABELS[answers.role]}」他满意`)
  } else {
    chance -= 0.32
    reasons.push(`他要求「${SQUAD_ROLE_LABELS[demands.role]}」，你只给了「${SQUAD_ROLE_LABELS[answers.role]}」`)
  }

  if (demands.minTier && (TIER_RANK[clubTier] ?? 1) < (TIER_RANK[demands.minTier] ?? 99)) {
    chance *= 0.12
    hard.push(`他只想踢${TIER_LABELS[demands.minTier]}，除非报价高到无法拒绝`)
    reasons.push(`球队级别不够：${TIER_LABELS[clubTier]} < ${TIER_LABELS[demands.minTier]}`)
  }

  if (demands.wantsClubId && demands.wantsClubId !== clubId) {
    chance *= 0.45
    hard.push(`他更想去 ${demands.wantsClubName ?? '别的球队'}`)
    reasons.push('他心里有别的下家，需要额外加钱')
  }

  chance = Math.max(0.02, Math.min(0.98, chance))
  return { chance, reasons, hard }
}

/** 同一份报价 + 同一组回答，掷骰结果固定；换报价才会重新掷。 */
export function negotiationRoll(
  seed: number,
  player: Player,
  offer: number,
  answers: NegotiationAnswers,
  chance: number,
): boolean {
  if (!(chance > 0)) return false
  if (chance >= 0.98) return true
  const rng = derivedRng(
    splitSeed(seed, 'negotiation-roll'),
    negotiationKey(player),
    offer,
    answers.goal,
    answers.role,
  )
  return rng.chance(chance)
}

/** 失败时给一句人话，别只说“失败”。 */
export function negotiationFailure(input: NegotiationInput, terms: NegotiationTerms): string {
  const { demands, answers, offer, asking } = input
  if (offer < asking) return '这个报价连底价都没到，对方直接挂断了电话。'
  if (demands.minTier && terms.hard.some((line) => line.includes(TIER_LABELS[demands.minTier!]))) {
    return `他只想踢${TIER_LABELS[demands.minTier]}，对你现在的级别不感兴趣。`
  }
  if (demands.wantsClubId && terms.hard.some((line) => line.includes('更想去'))) {
    return `他直说了想留在 ${demands.wantsClubName ?? '那支球队'}，除非报价再高一大截。`
  }
  if (ROLE_RANK[answers.role] < ROLE_RANK[demands.role]) return `他觉得「${SQUAD_ROLE_LABELS[answers.role]}」这个定位没有诚意。`
  if (GOAL_RANK[answers.goal] < GOAL_RANK[demands.goal]) return `他觉得球队的目标「${SEASON_GOAL_LABELS[answers.goal]}」不够有野心。`
  return '谈得差不多了，但他觉得还能再要一点。加钱或者换个承诺再试试。'
}
