import { caOf } from './ca.ts'
import { isTsubasaPlayer } from './data/tsubasa-specials.ts'
import type { GameState, Player } from './types.ts'

/** 《足球小将》全明星球员统一周薪。 */
export const TSUBASA_WAGE = 1_000

/**
 * 11 人制每队 25 人（7 人制时 18 人）：单人工资按 18 / 25 缩放，整队工资总额和 7 人制时相当，
 * 经济系统（收入、设施、AI 账本）不用跟着重调。
 */
export const SQUAD_WAGE_SCALE = 18 / 25

/** 单名球员每轮初始工资封顶（与身价封顶 2000 万对齐，覆盖原始 CA ~300 顶级巨星并杜绝指数爆炸）。 */
export const WAGE_CAP = 25_000

/** 续约后允许的单人每轮工资封顶（支持顶级球星多次真实加薪同时防止指数爆炸）。 */
export const RENEWAL_WAGE_CAP = 45_000

/** 真实球星（带 starKey）的默认签约工资溢价与保底（避免 220–245 CA 球星只拿 1,000–2,000/轮）。 */
export const STAR_WAGE_MULTIPLIER = 1.8
export const STAR_WAGE_FLOOR = 4_000

/** 球员续约可接受的新合同年限区间（从当前赛季起算）。 */
export const CONTRACT_RENEWAL_MIN_YEARS = 3
export const CONTRACT_RENEWAL_MAX_YEARS = 5

const roundWage = (value: number): number => Math.max(500, Math.round(value / 50) * 50)

export function wageForPlayer(player: Player): number {
  if (isTsubasaPlayer(player)) return TSUBASA_WAGE
  // 与身价（bestMarketValue）保持同一口径：只按原始属性（baseAttrs）计算，
  // 避免 AI 持续培养或装备高阶球员卡后把 CA 拉到 450–600 触发指数级天价工资。
  const attrs = player.baseAttrs ?? player.attrs
  const positions = player.basePositions ?? player.positions
  const ca = caOf(attrs, positions.GK > 0)
  const baseRaw = 800 * SQUAD_WAGE_SCALE * Math.pow(1.035, ca - 200)
  const raw = player.starKey ? Math.max(STAR_WAGE_FLOOR, baseRaw * STAR_WAGE_MULTIPLIER) : baseRaw
  return Math.min(WAGE_CAP, roundWage(raw))
}

/** 球员按年龄、星级与当前战力自然期望的新合同年限（3–5 年）。 */
export function preferredRenewalYears(player: Player): 3 | 4 | 5 {
  const age = player.age ?? 24
  const curCa = caOf(player.attrs, player.positions.GK > 0)
  if (age <= 24) return 5
  if (age <= 29) return (player.starKey || curCa >= 360) ? 5 : 4
  if (age <= 31) return 4
  return 3
}

export type ContractRenewalPreview = {
  /** 是否允许发起续约（合同尚未签满 5 年）。 */
  canRenew: boolean
  /** 请求的年限是否合法（3-5 年且晚于当前到期赛季）。 */
  validYears: boolean
  /** 是否属于提前续约（当前合同仍剩余 2 季及以上）。 */
  isEarlyRenewal: boolean
  currentSeason: number
  currentExpires: number
  remainingSeasons: number
  minYears: number
  maxYears: number
  /** 球员期望的新合同年限（已钳制在可选区间内）。 */
  preferredYears: number
  /** 本次预览采用的年限。 */
  years: number
  /** 所有合法可选年限（3-5 年内且能延长到期赛季）。 */
  availableYears: number[]
  nextExpiresSeason: number
  /** 续约前有效基础工资（异常天价存量合同会先回调至合理基准）。 */
  currentWage: number
  fairWage: number
  marketFairWage: number
  demandedWage: number
  raiseAmount: number
  raisePct: number
  reason?: string
}

/**
 * 计算球员续约 / 提前续约的条件与涨薪诉求（仿 FM）：
 * - 新合同固定为 3–5 年（从当前赛季起算），必须晚于现有到期赛季；
 * - 剩余 2 季及以上时视为「提前续约」，球员额外索要少量提前锁定溢价；
 * - 每次续约均在当前工资与成长后身价定位之间取高值，确保历次续约持续涨薪（封顶 RENEWAL_WAGE_CAP）。
 */
export function previewContractRenewal(
  game: Pick<GameState, 'season' | 'world'>,
  player: Player,
  requestedYears?: number,
): ContractRenewalPreview {
  const currentSeason = game.world?.seasonIndex ?? game.season.index
  const currentExpires = player.contract?.expiresSeason ?? currentSeason
  const remainingSeasons = Math.max(0, currentExpires - currentSeason)
  const minYears = Math.max(CONTRACT_RENEWAL_MIN_YEARS, remainingSeasons + 1)
  const maxYears = CONTRACT_RENEWAL_MAX_YEARS
  const canRenew = minYears <= maxYears
  const availableYears = canRenew
    ? Array.from({ length: maxYears - minYears + 1 }, (_, index) => minYears + index)
    : []
  const preferredYears = canRenew
    ? Math.min(maxYears, Math.max(minYears, preferredRenewalYears(player)))
    : maxYears
  const targetYears = requestedYears === undefined ? preferredYears : requestedYears
  const validYears = canRenew
    && Number.isSafeInteger(targetYears)
    && targetYears >= CONTRACT_RENEWAL_MIN_YEARS
    && targetYears <= CONTRACT_RENEWAL_MAX_YEARS
    && currentSeason + targetYears > currentExpires
  const effectiveYears = canRenew
    ? Math.min(maxYears, Math.max(minYears, Number.isSafeInteger(targetYears) ? targetYears : preferredYears))
    : maxYears
  const nextExpiresSeason = currentSeason + effectiveYears
  const isEarlyRenewal = remainingSeasons >= 2

  const tsubasa = isTsubasaPlayer(player)
  const isGk = player.positions.GK > 0
  const fairWage = wageForPlayer(player)
  const baseAttrs = player.baseAttrs ?? player.attrs
  const basePositions = player.basePositions ?? player.positions
  const baseCa = caOf(baseAttrs, basePositions.GK > 0)
  const curCa = caOf(player.attrs, isGk)
  const caGain = Math.max(0, curCa - baseCa)
  const growthBonus = Math.round((caGain * 4.5) / 50) * 50
  const marketFairWage = tsubasa ? TSUBASA_WAGE : Math.min(RENEWAL_WAGE_CAP, fairWage + growthBonus)

  const rawCurrentWage = player.contract?.wage ?? 0
  const currentWage = rawCurrentWage <= RENEWAL_WAGE_CAP ? rawCurrentWage : fairWage
  const yearPremium = (effectiveYears - CONTRACT_RENEWAL_MIN_YEARS) * 0.04
  const earlyPremium = isEarlyRenewal ? 0.05 : 0
  const growthRate = caGain >= 150 ? 0.08 : caGain >= 50 ? 0.04 : 0
  const raiseRate = 0.20 + growthRate + yearPremium + earlyPremium
  const minRaise = currentWage + Math.max(200, Math.round((currentWage * 0.15) / 50) * 50)
  const raisedFromCurrent = roundWage(currentWage * (1 + raiseRate))
  const targetFromFair = roundWage(marketFairWage * (1.10 + yearPremium + earlyPremium))
  const demandedWage = tsubasa ? TSUBASA_WAGE : Math.min(RENEWAL_WAGE_CAP, Math.max(minRaise, raisedFromCurrent, targetFromFair))
  const raiseAmount = Math.max(0, demandedWage - currentWage)
  const raisePct = currentWage > 0 ? Math.round((raiseAmount / currentWage) * 100) : 0

  let reason: string | undefined
  if (!canRenew) {
    reason = `合同已签至第 ${currentExpires} 赛季（余 ${remainingSeasons} 季），已满 ${CONTRACT_RENEWAL_MAX_YEARS} 年无需续约`
  } else if (!validYears) {
    reason = `球员要求签订 ${CONTRACT_RENEWAL_MIN_YEARS}-${CONTRACT_RENEWAL_MAX_YEARS} 年新合同，且须晚于当前到期赛季（第 ${currentExpires} 赛季）`
  }

  return {
    canRenew,
    validYears,
    isEarlyRenewal,
    currentSeason,
    currentExpires,
    remainingSeasons,
    minYears,
    maxYears,
    preferredYears,
    years: effectiveYears,
    availableYears,
    nextExpiresSeason,
    currentWage,
    fairWage,
    marketFairWage,
    demandedWage,
    raiseAmount,
    raisePct,
    reason,
  }
}

/**
 * 存量合同修复：旧版 wageForPlayer 按培养后 attrs 且无封顶计算，导致接管 AI 球队或续约时
 * 将单人每轮工资算到数万～数亿。凡超过续约封顶（RENEWAL_WAGE_CAP）的异常天价合同统一校正回正常值，
 * 保留正常的签约、历次渐进加薪续约与青训工资（100）。
 */
export function repairInflatedContractWages(roster: Player[]): boolean {
  let changed = false
  for (const player of roster) {
    if (!player?.contract || player.contract.clubId !== 'player') continue
    if (isTsubasaPlayer(player)) {
      if (player.contract.wage !== TSUBASA_WAGE) {
        player.contract.wage = TSUBASA_WAGE
        changed = true
      }
      continue
    }
    if (player.contract.wage > RENEWAL_WAGE_CAP) {
      player.contract.wage = wageForPlayer(player)
      changed = true
    }
  }
  return changed
}

export function worldWageBill(game: Pick<GameState, 'roster'>): number {
  return game.roster.reduce((sum, player) => sum + (player.contract?.wage ?? 0), 0)
}
