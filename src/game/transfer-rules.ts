/**
 * 转会规则：俱乐部肯不肯放人、AI 一赛季最多买几个人、拒绝高价报价后球员的不满。
 *
 * 放人看四件事：是不是主力、年龄、最近 20 场的出场时间、对方给的溢价（报价 / 身价 − 1）。
 * - 年龄大的主力（29 岁及以上）：至少多给 30% 才肯放。
 * - 当打之年的主力（25–28 岁）：至少多给 50%。
 * - 年轻主力（24 岁及以下）：非卖品；除非他最近上场时间很少，那就按轮换球员算。
 * - 轮换球员：要的溢价随出场时间涨（10%–40%），年轻的再多 10%。
 * - 冷板凳（最近几乎不上场）：身价多给 5% 就能谈。
 * 达到要价也不是一定成交，溢价越多越容易；同一份报价的结果固定（种子 + 报价决定），换报价才重新判定。
 * 这里只有纯规则，存档读写在 market.ts / transfers.ts。
 */
import type { AIClubState, Lineup, Player } from './types.ts'
import { derivedRng, splitSeed } from './rng.ts'
import { GAME_DAY_MS } from './calendar.ts'

/** AI 俱乐部一个赛季最多买进几个人（竞拍、直接签自由球员、挖人都算）。 */
export const AI_SEASON_BUY_LIMIT = 5
/** 看最近多少场的出场时间。 */
export const RECENT_MATCHES = 20
/** 24 岁及以下算年轻球员。 */
export const YOUNG_MAX_AGE = 24
/** 29 岁及以上算老将。 */
export const VETERAN_MIN_AGE = 29
/** 最近出场时间占比低于这个就是冷板凳。 */
export const BENCH_WARMER_SHARE = 0.15
/** 年轻主力最近出场占比低于这个，就不再算“非卖品”。 */
export const YOUNG_STARTER_LOW_SHARE = 0.35
/** 报价不低于身价的这个倍数算“高价”：拒绝高价报价，球员会不满。 */
export const HIGH_OFFER_RATIO = 1.3
/** 不满持续几个游戏日（现实 2 天）。 */
export const UNHAPPY_GAME_DAYS = 8
/** 不满期间精力恢复只剩这么多（平时每轮够开 3 轮培养，不满时最多 1 轮）。 */
export const UNHAPPY_ENERGY_RATE = 0.1
/** AI 给玩家球队的报价，4 个游戏日（现实 24 小时）内不回复就算拒绝。 */
export const OFFER_RESPONSE_GAME_DAYS = 4

export type SquadStatus = 'key' | 'rotation' | 'fringe'
export type AgeBand = 'young' | 'prime' | 'veteran'

export const SQUAD_STATUS_LABELS: Record<SquadStatus, string> = { key: '主力', rotation: '轮换', fringe: '冷板凳' }
export const AGE_BAND_LABELS: Record<AgeBand, string> = { young: '年轻', prime: '当打之年', veteran: '老将' }

export type ReleaseAssessment = {
  status: SquadStatus
  ageBand: AgeBand
  age: number
  /** 最近出场时间占比（0–1，按每场 90 分钟算）。 */
  minutesShare: number
  /** 有记录的场次；不足时按阵容角色估算。 */
  recorded: number
  /** 这名球员在首发里。 */
  starter: boolean
  /** 至少要多给多少溢价；null = 非卖品。 */
  requiredPremium: number | null
  /** 俱乐部要价（身价 × (1 + 要求的溢价)，取整到千）；非卖品为 null。 */
  asking: number | null
  value: number
  reasons: string[]
}

export function ageBandOf(age: number): AgeBand {
  if (age <= YOUNG_MAX_AGE) return 'young'
  if (age >= VETERAN_MIN_AGE) return 'veteran'
  return 'prime'
}

/** 没有出场记录时按阵容角色估算：首发几乎踢满，替补偶尔上，名单外不上。 */
function estimatedShare(lineup: Pick<Lineup, 'starters' | 'bench'>, playerId: string): number {
  if (lineup.starters.some((starter) => starter.playerId === playerId)) return 0.92
  if (lineup.bench.includes(playerId)) return 0.12
  return 0
}

/**
 * 最近的出场时间占比。有 5 场以上记录就用记录（最多最近 20 场），否则按阵容角色估算，
 * 记录不够 20 场时用估算补齐。
 */
export function minutesShareOf(minutes: readonly number[] | undefined, lineup: Pick<Lineup, 'starters' | 'bench'>, playerId: string): { share: number; recorded: number } {
  const recent = (minutes ?? []).slice(-RECENT_MATCHES)
  const estimate = estimatedShare(lineup, playerId)
  if (recent.length < 5) return { share: estimate, recorded: recent.length }
  const played = recent.reduce((sum, value) => sum + Math.max(0, Math.min(90, value)) / 90, 0)
  const padded = played + estimate * (RECENT_MATCHES - recent.length)
  return { share: Math.max(0, Math.min(1, padded / RECENT_MATCHES)), recorded: recent.length }
}

const roundPrice = (value: number): number => Math.ceil(value / 1000) * 1000

/** 俱乐部对这名球员的态度：主力/轮换/冷板凳、要价、非卖品。 */
export function assessRelease(input: {
  player: Pick<Player, 'id' | 'age'>
  lineup: Pick<Lineup, 'starters' | 'bench'>
  minutes?: readonly number[]
  value: number
}): ReleaseAssessment {
  const age = input.player.age ?? 24
  const ageBand = ageBandOf(age)
  const starter = input.lineup.starters.some((starter) => starter.playerId === input.player.id)
  const { share, recorded } = minutesShareOf(input.minutes, input.lineup, input.player.id)
  const reasons: string[] = []
  let status: SquadStatus = starter ? 'key' : share < BENCH_WARMER_SHARE ? 'fringe' : 'rotation'
  // 首发但最近上场很少（刚伤愈、刚被换下来）：按轮换算。
  if (status === 'key' && share < 0.5) status = share < BENCH_WARMER_SHARE ? 'fringe' : 'rotation'
  let required: number | null
  if (status === 'key') {
    if (ageBand === 'young') {
      required = null
      reasons.push('年轻主力，俱乐部不卖')
    } else if (ageBand === 'veteran') {
      required = 0.3
      reasons.push(`${age} 岁的主力：至少多给 30% 才肯放`)
    } else {
      required = 0.5
      reasons.push(`当打之年的主力：至少多给 50% 才肯放`)
    }
  } else if (status === 'rotation') {
    required = 0.1 + 0.3 * share + (ageBand === 'young' ? 0.1 : 0)
    reasons.push(`轮换球员，最近出场 ${Math.round(share * 100)}%：至少多给 ${Math.round(required * 100)}%`)
  } else {
    required = 0.05
    reasons.push('坐冷板凳，身价多给一点就能谈')
  }
  // 年轻主力最近几乎不上场，俱乐部也愿意谈（按轮换算）。
  if (status === 'key' && ageBand === 'young' && share < YOUNG_STARTER_LOW_SHARE) {
    status = 'rotation'
    required = 0.2 + 0.3 * share
    reasons.splice(0, reasons.length, `年轻主力但最近出场只有 ${Math.round(share * 100)}%：至少多给 ${Math.round(required * 100)}%`)
  }
  const value = Math.max(0, Math.round(input.value))
  return {
    status,
    ageBand,
    age,
    minutesShare: share,
    recorded,
    starter,
    requiredPremium: required,
    asking: required === null || value <= 0 ? null : roundPrice(value * (1 + required)),
    value,
    reasons,
  }
}

/** 达到要价后俱乐部点头的概率：溢价超出要求越多越容易，冷板凳最好谈。 */
export function releaseChance(assessment: ReleaseAssessment, offer: number): number {
  if (assessment.requiredPremium === null || assessment.asking === null || assessment.value <= 0) return 0
  if (!Number.isSafeInteger(offer) || offer < assessment.asking) return 0
  const premium = offer / assessment.value - 1
  const base = assessment.status === 'fringe' ? 0.8 : assessment.status === 'rotation' ? 0.55 : 0.45
  return Math.max(0, Math.min(0.97, base + (premium - assessment.requiredPremium) * 2.5))
}

/** 俱乐部放不放人：同一份报价结果固定，换报价才重新判定。 */
export function releaseRoll(seed: number, playerId: string, offer: number, chance: number): boolean {
  if (!(chance > 0)) return false
  if (chance >= 0.97) return true
  return derivedRng(splitSeed(seed, 'club-release'), playerId, offer).chance(chance)
}

/* ---------- AI 一赛季的买人名额 ---------- */

export function aiBuysUsed(state: Pick<AIClubState, 'transfers'> | undefined, season: number): number {
  return state?.transfers?.season === season ? state.transfers.bought : 0
}

/** 还能买几个人（pending = 已经在途、还没结算的，比如正领先的竞拍）。 */
export function aiBuysLeft(state: Pick<AIClubState, 'transfers'> | undefined, season: number, pending = 0): number {
  return Math.max(0, AI_SEASON_BUY_LIMIT - aiBuysUsed(state, season) - pending)
}

export function noteAIBuy(state: AIClubState, season: number): void {
  state.transfers = { season, bought: aiBuysUsed(state, season) + 1 }
}

/* ---------- 不满 ---------- */

/** 拒绝高价报价后球员不满：之后 8 个游戏日精力恢复只剩一成。连续拒绝会把时间续满，不叠加。 */
export function makeUnhappy(player: Player, reason: string, now: number): void {
  const until = now + UNHAPPY_GAME_DAYS * GAME_DAY_MS
  player.unhappy = { until: Math.max(player.unhappy?.until ?? 0, until), reason }
}

/**
 * [from, to] 这段时间的精力恢复倍率：落在不满期间的那部分按一成算。
 * 不满已经过去就顺手清掉。
 */
export function energyRateFactor(player: Player, from: number, to: number): number {
  const until = player.unhappy?.until
  if (until === undefined) return 1
  if (until <= to) delete player.unhappy
  if (!(to > from) || until <= from) return 1
  const unhappyPart = (Math.min(until, to) - from) / (to - from)
  return unhappyPart * UNHAPPY_ENERGY_RATE + (1 - unhappyPart)
}
