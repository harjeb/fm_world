import type { GameState, LegendBook, ShopState, TierId } from './types.ts'
import {
  SHOP_BASE_AUX_CATALOG_IDS,
  SHOP_BASE_GK_SKILL_IDS,
  SHOP_BASE_OUTFIELD_SKILL_IDS,
  SHOP_RESERVE_AUX_SKILL_IDS,
  SHOP_RESERVE_GK_SKILL_IDS,
  SHOP_RESERVE_OUTFIELD_SKILL_IDS,
  SHOP_SKILLS,
  type ShopCatalogSkillId,
  type ShopSkillGroup,
  type ShopSkillScope,
} from './data/shop-skills.ts'
import { addLegendBook, ensureLegendBooks, hasBookAtOrAbove } from './legend-books.ts'
import { derivedRng } from './rng.ts'

/** 商店每本金色技能书统一售价（商店点数）。 */
export const SHOP_BOOK_PRICE = 100
/** 每赛季上架的外场 / 门将 / 辅助金技能书数量（合计 12 本）。 */
export const SHOP_OUTFIELD_COUNT = 8
export const SHOP_GK_COUNT = 2
export const SHOP_AUX_COUNT = 2

/**
 * 赛季结算排名点数表（1–20 名）：
 * - 二级联赛上游（1–4 名）：480–400 点 → 稳换 4 本；
 * - 一级联赛上游（1–4 名）：800–670 点 → 稳换 6–8 本；
 * - 冠军/顶级联赛上游（1–4 名）：1200–1000 点 → 全换 10 本。
 */
export const SEASON_SHOP_POINTS_TABLE: Record<TierId, readonly number[]> = {
  champions: [1200, 1120, 1060, 1000, 950, 900, 860, 820, 780, 750, 710, 680, 650, 620, 600, 570, 540, 520, 500, 480],
  division1: [800, 750, 710, 670, 640, 600, 570, 540, 510, 490, 460, 440, 420, 400, 380, 360, 340, 320, 300, 280],
  division2: [480, 440, 420, 400, 380, 350, 330, 310, 290, 270, 250, 240, 230, 220, 210, 190, 180, 170, 160, 150],
}

const LEGACY_V1_PEAK_BANDS: readonly { from: number; to: number; points: number }[] = [
  { from: 1, to: 20, points: 5 },
  { from: 21, to: 40, points: 8 },
  { from: 41, to: 60, points: 12 },
  { from: 61, to: 80, points: 16 },
  { from: 81, to: 100, points: 20 },
]

export const PEAK_SHOP_POINTS_BANDS: readonly { from: number; to: number; points: number }[] = [
  { from: 1, to: 20, points: 15 },
  { from: 21, to: 40, points: 24 },
  { from: 41, to: 60, points: 36 },
  { from: 61, to: 80, points: 48 },
  { from: 81, to: 100, points: 60 },
]

export const MAX_PEAK_SHOP_POINTS = PEAK_SHOP_POINTS_BANDS.reduce((sum, band) => sum + (band.to - band.from + 1) * band.points, 0)

function legacyV1PeakStagePoints(stage: number): number {
  return LEGACY_V1_PEAK_BANDS.find((band) => stage >= band.from && stage <= band.to)?.points ?? 0
}

export type ShopOffer = {
  id: ShopCatalogSkillId
  tier: 'gold'
  price: number
  scope: ShopSkillScope
  group: ShopSkillGroup
  category: 'main' | 'auxiliary'
  /** 是否为该世界首次在商店上架的新书（true=首发，false=返场）。 */
  isDebut: boolean
}

export type ShopBuyResult =
  | { ok: true; book: LegendBook; price: number; points: number }
  | { ok: false; error: string }

/** 按联赛级别与最终排名（1–20）返回赛季结束获得的商店点数。 */
export function seasonShopPoints(tier: TierId | undefined, rank: number): number {
  if (!Number.isSafeInteger(rank) || rank < 1) return 0
  const table = SEASON_SHOP_POINTS_TABLE[tier ?? 'division2'] ?? SEASON_SHOP_POINTS_TABLE.division2
  return table[Math.min(table.length - 1, rank - 1)]
}

/** 巅峰之路单关首通获得的额外商店点数（1–100 关）。 */
export function peakStageShopPoints(stage: number): number {
  if (!Number.isSafeInteger(stage) || stage < 1 || stage > 100) return 0
  return PEAK_SHOP_POINTS_BANDS.find((band) => stage >= band.from && stage <= band.to)?.points ?? 0
}

/** 通关前 cleared 关累计可获得的巅峰之路商店点数。 */
export function totalPeakShopPoints(cleared: number): number {
  const max = Math.max(0, Math.min(100, Math.floor(Number.isFinite(cleared) ? cleared : 0)))
  let sum = 0
  for (let stage = 1; stage <= max; stage++) sum += peakStageShopPoints(stage)
  return sum
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
 * 3 赛季完整轮换洗牌：
 * - 每个 3 赛季周期（如 S1–S3、S4–S6）内，池中全部技能各出现恰好 1 次；
 * - 跨周期衔接时（如 S3 → S4），新周期第 1 期优先从非上期末尾集合中抽取，避免相邻两赛季重复。
 */
function cycleOrder<T>(pool: readonly T[], worldSeed: number, label: string, cycle: number, chunkSize: number): T[] {
  let prevLast: T[] = []
  let order: T[] = []
  for (let c = 0; c <= cycle; c++) {
    const rng = derivedRng(worldSeed, label, c)
    if (c === 0 || prevLast.length === 0 || pool.length - prevLast.length < chunkSize) {
      order = shuffleWith(pool, rng)
    } else {
      const prevSet = new Set(prevLast)
      const fresh = shuffleWith(pool.filter((item) => !prevSet.has(item)), rng)
      const firstChunk = fresh.slice(0, chunkSize)
      const rest = shuffleWith([...fresh.slice(chunkSize), ...prevLast], rng)
      order = [...firstChunk, ...rest]
    }
    prevLast = order.slice(order.length - chunkSize)
  }
  return order
}

/** 当前存档对应的商店赛季编号（联机与单机均与当前赛季一致）。 */
export function shopSeasonIndex(game: Pick<GameState, 'season' | 'world'>): number {
  return Math.max(1, Math.floor(game.world?.seasonIndex ?? game.season?.index ?? 1))
}

/**
 * 单类别的赛季货架调度：
 * - S1–S3：沿用基础池洗牌（与历史版本完全一致，保证老服 S1–S3 货架不变），每本均为首发；
 * - S4 起：采用「一半返场 + 一半全新」——
 *   - 返场半区：从 3 个赛季前（S(n-3)）的货架中随机抽一半返场（过滤上一季已上架项，保证相邻赛季零重复）；
 *   - 全新半区：从尚未在本世界上架过的备用池（含基础池剩余项 + 60 本对策备用池）纯随机依次首发；
 *   - 备用池全部首发完毕后（外场/门将 S14+、辅助 S20+），将全池并入大轮换，优先挑选最久未上架的书，相邻赛季仍零重复。
 */
function buildCategorySeason<T extends string>(
  basePool: readonly T[],
  reservePool: readonly T[],
  perSeason: number,
  worldSeed: number,
  label: string,
  targetSeason: number,
): { id: T; isDebut: boolean }[] {
  const baseOrder = cycleOrder(basePool, worldSeed, label, 0, perSeason)
  const history: T[][] = []
  const seen = new Set<T>()
  const lastSeen = new Map<T, number>()

  // S1–S3：完整基础池首轮（与既有逻辑逐项一致）
  const initSeasons = Math.min(3, targetSeason)
  for (let s = 1; s <= initSeasons; s++) {
    const start = (s - 1) * perSeason
    const ids = baseOrder.slice(start, start + perSeason)
    if (s === targetSeason) {
      return ids.map((id) => ({ id, isDebut: !seen.has(id) }))
    }
    history[s] = ids
    for (const id of ids) {
      seen.add(id)
      lastSeen.set(id, s)
    }
  }

  // S4+：构建纯随机的新书首发队列（基础池在 S1–S3 未登场项 + 备用池全部项）
  const remainingBase = basePool.filter((id) => !seen.has(id))
  const debutQueue = shuffleWith<T>([...remainingBase, ...reservePool], derivedRng(worldSeed, `${label}-reserve-debut`))
  const fullPool: T[] = [...basePool, ...reservePool]
  const rerunCount = Math.floor(perSeason / 2)

  for (let s = 4; s <= targetSeason; s++) {
    const prev = new Set(history[s - 1] ?? [])
    const source = history[s - 3] ?? []
    const rerunRng = derivedRng(worldSeed, `${label}-rerun`, s)
    const rerunCandidates = shuffleWith(source.filter((id) => !prev.has(id)), rerunRng)
    const reruns: T[] = rerunCandidates.slice(0, rerunCount)
    const chosen = new Set<T>(reruns)

    // 极端情况下若 S(n-3) 有效候补不足一半，从历史上已出现且不在上一季的书里补齐返场名额
    if (reruns.length < rerunCount) {
      const extraSeen = shuffleWith(
        [...seen].filter((id) => !prev.has(id) && !chosen.has(id)),
        rerunRng,
      ).sort((a, b) => (lastSeen.get(a) ?? 0) - (lastSeen.get(b) ?? 0))
      for (const id of extraSeen) {
        if (reruns.length >= rerunCount) break
        reruns.push(id)
        chosen.add(id)
      }
    }

    const freshNeed = perSeason - reruns.length
    const fresh: T[] = []
    while (fresh.length < freshNeed && debutQueue.length > 0) {
      const next = debutQueue.shift()!
      if (prev.has(next) || chosen.has(next)) continue
      fresh.push(next)
      chosen.add(next)
    }

    // 备用池全部首发完之后，按“最久未上架”顺序 + 纯随机同阶打散补足另一半
    if (fresh.length < freshNeed) {
      const postRng = derivedRng(worldSeed, `${label}-post`, s)
      const candidates = shuffleWith(fullPool.filter((id) => !prev.has(id) && !chosen.has(id)), postRng)
      candidates.sort((a, b) => (lastSeen.get(a) ?? 0) - (lastSeen.get(b) ?? 0))
      for (const id of candidates) {
        if (fresh.length >= freshNeed) break
        fresh.push(id)
        chosen.add(id)
      }
    }

    // 新书（首发）排在前面，返场书排在后面，界面一眼区分
    const combined = [...fresh, ...reruns]
    if (s === targetSeason) {
      return combined.map((id) => ({ id, isDebut: !seen.has(id) }))
    }
    history[s] = combined
    for (const id of combined) {
      seen.add(id)
      lastSeen.set(id, s)
    }
  }
  return []
}

/**
 * 指定世界种子与赛季号的商店货架（8 本外场金书 + 2 本门将金书 + 2 本辅助金书 = 12 本）。
 * - S1–S3：基础池首轮轮换；
 * - S4 起：每类一半从 S(n-3) 返场、一半从备用池全新首发；
 * - 联机模式下同一世界所有俱乐部共享同一 `worldSeed`，因此全服同赛季上架相同的 12 本。
 */
export function shopCatalog(worldSeed: number, seasonIndex: number): ShopOffer[] {
  const season = Math.max(1, Math.floor(Number.isFinite(seasonIndex) ? seasonIndex : 1))
  const outfield = buildCategorySeason(
    SHOP_BASE_OUTFIELD_SKILL_IDS,
    SHOP_RESERVE_OUTFIELD_SKILL_IDS,
    SHOP_OUTFIELD_COUNT,
    worldSeed,
    'shop-outfield-cycle',
    season,
  )
  const gk = buildCategorySeason(
    SHOP_BASE_GK_SKILL_IDS,
    SHOP_RESERVE_GK_SKILL_IDS,
    SHOP_GK_COUNT,
    worldSeed,
    'shop-gk-cycle',
    season,
  )
  const aux = buildCategorySeason(
    SHOP_BASE_AUX_CATALOG_IDS,
    SHOP_RESERVE_AUX_SKILL_IDS,
    SHOP_AUX_COUNT,
    worldSeed,
    'shop-aux-cycle',
    season,
  )

  const mainOffers: ShopOffer[] = [...outfield, ...gk].map(({ id, isDebut }) => ({
    id,
    tier: 'gold',
    price: SHOP_BOOK_PRICE,
    scope: SHOP_SKILLS[id].scope,
    group: SHOP_SKILLS[id].group,
    category: 'main',
    isDebut,
  }))
  const auxOffers: ShopOffer[] = aux.map(({ id, isDebut }) => ({
    id,
    tier: 'gold',
    price: SHOP_BOOK_PRICE,
    scope: 'any',
    group: 'auxiliary',
    category: 'auxiliary',
    isDebut,
  }))
  return [...mainOffers, ...auxOffers]
}

export function shopPointsOf(game: Pick<GameState, 'shop'>): number {
  const points = game.shop?.points
  return typeof points === 'number' && Number.isSafeInteger(points) && points >= 0 ? points : 0
}

/**
 * 初始化/修复商店状态，并按 `pve.peak.cleared` 幂等补发所有尚未领取的巅峰之路关卡点数。
 * 返回是否有状态改动。
 */
export function ensureShop(game: GameState): boolean {
  let changed = false
  const existed = !!game.shop && typeof game.shop === 'object' && !Array.isArray(game.shop)
  if (!existed) {
    game.shop = { points: 0, seasonClaims: {}, peakClaimedStages: [] }
    changed = true
  }
  const shop = game.shop as ShopState
  if (typeof shop.points !== 'number' || !Number.isSafeInteger(shop.points) || shop.points < 0) {
    shop.points = 0
    changed = true
  }
  if (!shop.seasonClaims || typeof shop.seasonClaims !== 'object' || Array.isArray(shop.seasonClaims)) {
    shop.seasonClaims = {}
    changed = true
  }
  if (!Array.isArray(shop.peakClaimedStages)) {
    shop.peakClaimedStages = []
    changed = true
  } else {
    const clean = [...new Set(shop.peakClaimedStages.filter((stage) => Number.isSafeInteger(stage) && stage >= 1 && stage <= 100))].sort((a, b) => a - b)
    if (clean.length !== shop.peakClaimedStages.length || clean.some((stage, index) => shop.peakClaimedStages[index] !== stage)) {
      shop.peakClaimedStages = clean
      changed = true
    }
  }
  const hadTrackedAwarded = typeof shop.peakPointsAwarded === 'number' && Number.isSafeInteger(shop.peakPointsAwarded) && shop.peakPointsAwarded >= 0
  const legacyAwarded = shop.peakClaimedStages.reduce((sum, stage) => sum + legacyV1PeakStagePoints(stage), 0)
  const alreadyAwarded = hadTrackedAwarded ? shop.peakPointsAwarded! : legacyAwarded
  if (!hadTrackedAwarded) {
    shop.peakPointsAwarded = alreadyAwarded
    changed = true
  }
  const cleared = Math.max(0, Math.min(100, Math.floor(game.pve?.peak?.cleared ?? 0)))
  const claimed = new Set(shop.peakClaimedStages)
  const missing: number[] = []
  for (let stage = 1; stage <= cleared; stage++) {
    if (!claimed.has(stage)) missing.push(stage)
  }
  const targetStages = missing.length > 0 ? [...shop.peakClaimedStages, ...missing].sort((a, b) => a - b) : shop.peakClaimedStages
  const targetPoints = targetStages.reduce((sum, stage) => sum + peakStageShopPoints(stage), 0)
  const delta = Math.max(0, targetPoints - alreadyAwarded)
  if (missing.length > 0) {
    shop.peakClaimedStages = targetStages
    changed = true
  }
  if (delta > 0) {
    shop.points += delta
    shop.peakPointsAwarded = alreadyAwarded + delta
    // 首次建立商店、从旧版 ×1 档位升级差额补发，或一次补发多关时记录补发提示；正常单关新通不覆盖。
    if (!existed || !hadTrackedAwarded || missing.length > 1) shop.lastPeakBackfill = delta
    changed = true
  }
  return changed
}

/** 巅峰之路首通某关时发放商店点数；已领过则幂等返回 0。 */
export function awardPeakShopPoints(game: GameState, stage: number): number {
  if (!Number.isSafeInteger(stage) || stage < 1 || stage > 100) return 0
  const before = shopPointsOf(game)
  const hadStage = !!game.shop?.peakClaimedStages?.includes(stage)
  ensureShop(game)
  const shop = game.shop!
  if (!shop.peakClaimedStages.includes(stage)) {
    const pts = peakStageShopPoints(stage)
    if (pts <= 0) return 0
    shop.points += pts
    shop.peakClaimedStages = [...shop.peakClaimedStages, stage].sort((a, b) => a - b)
    shop.peakPointsAwarded = (shop.peakPointsAwarded ?? 0) + pts
    return pts
  }
  return hadStage ? 0 : Math.max(0, shop.points - before)
}

/** 赛季结束、排名确定后按级别与名次发放商店点数；同一赛季号只发一次。 */
export function awardSeasonShopPoints(
  game: GameState,
  seasonOverride?: { index: number; tier?: TierId; finished: boolean; playerFinish: number | null },
): number {
  const season = seasonOverride ?? game.season
  if (!season?.finished || !Number.isSafeInteger(season.index) || season.index < 1) return 0
  if (!Number.isSafeInteger(season.playerFinish ?? 0) || !(season.playerFinish! > 0)) return 0
  ensureShop(game)
  const shop = game.shop!
  if (shop.seasonClaims[season.index] !== undefined) return 0
  const pts = seasonShopPoints(season.tier ?? 'division2', season.playerFinish!)
  if (pts <= 0) return 0
  shop.points += pts
  shop.seasonClaims[season.index] = pts
  shop.lastSeasonPoints = pts
  return pts
}

/** 消耗商店点数购买当季上架的一本金色技能书（永久加入库存，不消耗）。 */
export function buyShopBook(game: GameState, skillId: string): ShopBuyResult {
  ensureShop(game)
  ensureLegendBooks(game)
  const catalog = shopCatalog(game.seed, shopSeasonIndex(game))
  const offer = catalog.find((item) => item.id === skillId)
  if (!offer) return { ok: false, error: '本期商店没有上架这本技能书' }
  if (hasBookAtOrAbove(game, offer.id, 'gold')) return { ok: false, error: '库存里已有该技能的同档或更高档位技能书' }
  const shop = game.shop!
  if (shop.points < offer.price) return { ok: false, error: `商店点数不足：需要 ${offer.price} 点，当前 ${shop.points} 点` }
  shop.points -= offer.price
  addLegendBook(game, offer.id, 'gold')
  return { ok: true, book: { id: offer.id, tier: 'gold' }, price: offer.price, points: shop.points }
}
