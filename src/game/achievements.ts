import { caOf } from './ca.ts'
import { economyOf, FACILITIES, facilityLevel } from './economy.ts'
import { ensureShop } from './shop.ts'
import type { AchievementState, FacilityId, GameState, Player, SeasonState, TierId } from './types.ts'

export type AchievementCategory = 'welfare' | 'pve' | 'training' | 'club' | 'honors'

export const ACHIEVEMENT_CATEGORY_LABELS: Record<AchievementCategory, string> = {
  welfare: '1.0 正式版福利',
  pve: '巅峰与传奇',
  training: '培养与青训',
  club: '经营与设施',
  honors: '联赛与荣誉',
}

export const ACHIEVEMENT_CATEGORY_ORDER: readonly AchievementCategory[] = [
  'welfare',
  'pve',
  'training',
  'club',
  'honors',
]

export const PEAK_WELFARE_ACHIEVEMENT_ID = 'peak_stage_1_welfare'
export const PEAK_WELFARE_MONEY = 1_000_000

export type AchievementReward = {
  money?: number
  shopPoints?: number
}

export type AchievementDef = {
  id: string
  category: AchievementCategory
  title: string
  desc: string
  target: number
  unit: string
  reward: AchievementReward
  /** 从权威存档实时读取当前进度。 */
  progressOf: (game: GameState) => number
}

const TIER_LEVEL: Record<TierId, number> = { division2: 1, division1: 2, champions: 3 }
const PLAYER_TEAM_ID = 'player'

function legendWinsCount(game: GameState): number {
  const legends = game.pve?.legends
  if (!legends) return 0
  return Object.values(legends).filter((row) => (row?.won ?? 0) > 0).length
}

function trainedCardsCount(game: GameState): number {
  const stored = Array.isArray(game.cards) ? game.cards.length : 0
  const seq = typeof game.cardSeq === 'number' && Number.isFinite(game.cardSeq) ? Math.floor(game.cardSeq) : 0
  return Math.max(stored, seq)
}

function playerCurrentCa(player: Pick<Player, 'attrs' | 'positions'>): number {
  return caOf(player.attrs, player.positions.GK > 0)
}

function maxSquadCa(game: GameState): number {
  let max = 0
  for (const player of game.roster ?? []) {
    const ca = playerCurrentCa(player)
    if (ca > max) max = ca
  }
  for (const card of game.cards ?? []) {
    const ca = playerCurrentCa(card)
    if (ca > max) max = ca
  }
  return Math.floor(max)
}

function promotedYouthCount(game: GameState): number {
  const rosterYouth = (game.roster ?? []).filter((p) => !!p.youthOrigin).length
  const calledUp = (game.youth?.members ?? []).filter((m) => m.calledUp).length
  return Math.max(rosterYouth, calledUp)
}

function maxFacilityLevelOf(game: GameState): number {
  const eco = game.economy
  if (!eco) return 1
  let max = 1
  for (const id of Object.keys(FACILITIES) as FacilityId[]) {
    const lv = facilityLevel(eco[id] ?? 1)
    if (lv > max) max = lv
  }
  return max
}

function allSeasons(game: GameState): SeasonState[] {
  const byIndex = new Map<number, SeasonState>()
  for (const season of game.seasonHistory ?? []) {
    if (season && Number.isInteger(season.index)) byIndex.set(season.index, season)
  }
  if (game.season && Number.isInteger(game.season.index)) {
    byIndex.set(game.season.index, game.season)
  }
  return [...byIndex.values()]
}

function leagueWinsCount(game: GameState): number {
  let wins = 0
  for (const season of allSeasons(game)) {
    const row = season.table?.find((entry) => entry.teamId === PLAYER_TEAM_ID)
    if (row && Number.isFinite(row.won)) wins += Math.max(0, Math.floor(row.won))
  }
  return wins
}

function highestTierLevel(game: GameState): number {
  let best = 1
  for (const season of allSeasons(game)) {
    const lv = season.tier ? TIER_LEVEL[season.tier] ?? 1 : 1
    if (lv > best) best = lv
  }
  return best
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // 1.0 特别福利成就
  {
    id: PEAK_WELFARE_ACHIEVEMENT_ID,
    category: 'welfare',
    title: '巅峰启程 · 1.0 福利',
    desc: '在「巅峰之路」赢得第 1 关胜利（已通关老存档自动补发 100 万金币）',
    target: 1,
    unit: '关',
    reward: { money: PEAK_WELFARE_MONEY },
    progressOf: (game) => Math.max(0, Math.floor(game.pve?.peak?.cleared ?? 0)),
  },

  // 巅峰与传奇
  {
    id: 'peak_clear_5',
    category: 'pve',
    title: '初露锋芒',
    desc: '在「巅峰之路」累计通关第 5 关',
    target: 5,
    unit: '关',
    reward: { shopPoints: 30 },
    progressOf: (game) => Math.max(0, Math.floor(game.pve?.peak?.cleared ?? 0)),
  },
  {
    id: 'peak_clear_10',
    category: 'pve',
    title: '十关破阵',
    desc: '在「巅峰之路」累计通关第 10 关',
    target: 10,
    unit: '关',
    reward: { shopPoints: 50 },
    progressOf: (game) => Math.max(0, Math.floor(game.pve?.peak?.cleared ?? 0)),
  },
  {
    id: 'peak_clear_25',
    category: 'pve',
    title: '巅峰强豪',
    desc: '在「巅峰之路」累计通关第 25 关',
    target: 25,
    unit: '关',
    reward: { shopPoints: 100 },
    progressOf: (game) => Math.max(0, Math.floor(game.pve?.peak?.cleared ?? 0)),
  },
  {
    id: 'peak_clear_50',
    category: 'pve',
    title: '半程封王',
    desc: '在「巅峰之路」累计通关第 50 关',
    target: 50,
    unit: '关',
    reward: { shopPoints: 200 },
    progressOf: (game) => Math.max(0, Math.floor(game.pve?.peak?.cleared ?? 0)),
  },
  {
    id: 'peak_clear_100',
    category: 'pve',
    title: '百关制霸',
    desc: '征服「巅峰之路」全部 100 关',
    target: 100,
    unit: '关',
    reward: { shopPoints: 500 },
    progressOf: (game) => Math.max(0, Math.floor(game.pve?.peak?.cleared ?? 0)),
  },
  {
    id: 'legend_win_1',
    category: 'pve',
    title: '挑战传奇',
    desc: '在「传奇挑战」中击败任意 1 支历史传奇球队',
    target: 1,
    unit: '队',
    reward: { shopPoints: 40 },
    progressOf: legendWinsCount,
  },
  {
    id: 'legend_win_5',
    category: 'pve',
    title: '传奇克星',
    desc: '在「传奇挑战」中累计击败 5 支不同传奇球队',
    target: 5,
    unit: '队',
    reward: { shopPoints: 100 },
    progressOf: legendWinsCount,
  },
  {
    id: 'legend_win_15',
    category: 'pve',
    title: '群星俯首',
    desc: '在「传奇挑战」中累计击败 15 支不同传奇球队',
    target: 15,
    unit: '队',
    reward: { shopPoints: 200 },
    progressOf: legendWinsCount,
  },

  // 培养与青训
  {
    id: 'cards_1',
    category: 'training',
    title: '初试身手',
    desc: '完成 1 次球员培养并产出球员卡',
    target: 1,
    unit: '张',
    reward: { shopPoints: 20 },
    progressOf: trainedCardsCount,
  },
  {
    id: 'cards_10',
    category: 'training',
    title: '青出于蓝',
    desc: '累计培养产出 10 张球员卡',
    target: 10,
    unit: '张',
    reward: { shopPoints: 50 },
    progressOf: trainedCardsCount,
  },
  {
    id: 'cards_30',
    category: 'training',
    title: '训练宗师',
    desc: '累计培养产出 30 张球员卡',
    target: 30,
    unit: '张',
    reward: { shopPoints: 100 },
    progressOf: trainedCardsCount,
  },
  {
    id: 'squad_ca_300',
    category: 'training',
    title: '王牌诞生',
    desc: '拥有任意 1 名当前 CA 达到 300 的球员或球员卡',
    target: 300,
    unit: 'CA',
    reward: { shopPoints: 60 },
    progressOf: maxSquadCa,
  },
  {
    id: 'squad_ca_450',
    category: 'training',
    title: '巨星降临',
    desc: '拥有任意 1 名当前 CA 达到 450 的球员或球员卡',
    target: 450,
    unit: 'CA',
    reward: { shopPoints: 120 },
    progressOf: maxSquadCa,
  },
  {
    id: 'youth_promote_1',
    category: 'training',
    title: '自家青训',
    desc: '将 1 名青训营新星征召或提拔进入一线队',
    target: 1,
    unit: '人',
    reward: { shopPoints: 40 },
    progressOf: promotedYouthCount,
  },

  // 经营与设施
  {
    id: 'facility_lv2',
    category: 'club',
    title: '初具规模',
    desc: '将任意一座俱乐部设施升级至 2 级',
    target: 2,
    unit: '级',
    reward: { shopPoints: 30 },
    progressOf: maxFacilityLevelOf,
  },
  {
    id: 'facility_lv3',
    category: 'club',
    title: '现代基地',
    desc: '将任意一座俱乐部设施升级至 3 级',
    target: 3,
    unit: '级',
    reward: { shopPoints: 60 },
    progressOf: maxFacilityLevelOf,
  },
  {
    id: 'facility_lv5',
    category: 'club',
    title: '世界顶级设施',
    desc: '将任意一座俱乐部设施升级至满级 5 级',
    target: 5,
    unit: '级',
    reward: { shopPoints: 150 },
    progressOf: maxFacilityLevelOf,
  },
  {
    id: 'fans_10k',
    category: 'club',
    title: '万人拥趸',
    desc: '俱乐部球迷规模达到 10,000 人',
    target: 10_000,
    unit: '人',
    reward: { shopPoints: 50 },
    progressOf: (game) => Math.max(0, Math.floor(game.economy?.fans ?? 0)),
  },

  // 联赛与荣誉
  {
    id: 'league_wins_10',
    category: 'honors',
    title: '稳步起航',
    desc: '在联赛中累计取得 10 场胜利',
    target: 10,
    unit: '胜',
    reward: { shopPoints: 30 },
    progressOf: leagueWinsCount,
  },
  {
    id: 'league_wins_30',
    category: 'honors',
    title: '常胜之师',
    desc: '在联赛中累计取得 30 场胜利',
    target: 30,
    unit: '胜',
    reward: { shopPoints: 80 },
    progressOf: leagueWinsCount,
  },
  {
    id: 'tier_division1',
    category: 'honors',
    title: '升入一级',
    desc: '带领俱乐部跻身一级联赛（或更高）',
    target: 2,
    unit: '级联赛',
    reward: { shopPoints: 100 },
    progressOf: highestTierLevel,
  },
  {
    id: 'tier_champions',
    category: 'honors',
    title: '问鼎冠联席位',
    desc: '带领俱乐部踏入冠军联赛舞台',
    target: 3,
    unit: '级联赛',
    reward: { shopPoints: 200 },
    progressOf: highestTierLevel,
  },
  {
    id: 'trophy_1',
    category: 'honors',
    title: '首座奖杯',
    desc: '赢得任意 1 座杯赛冠军奖杯',
    target: 1,
    unit: '座',
    reward: { shopPoints: 80 },
    progressOf: (game) => (Array.isArray(game.pve?.trophies) ? game.pve!.trophies.length : 0),
  },
]

const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((def) => [def.id, def]))

export const MAX_ACHIEVEMENT_SHOP_POINTS = ACHIEVEMENTS.reduce(
  (sum, def) => sum + (def.reward.shopPoints ?? 0),
  0,
)

export type AchievementItemView = {
  id: string
  category: AchievementCategory
  title: string
  desc: string
  current: number
  target: number
  unit: string
  reward: AchievementReward
  unlocked: boolean
  claimed: boolean
  claimable: boolean
  backfilled: boolean
  claimedAt?: number
}

export type AchievementSummary = {
  total: number
  unlocked: number
  claimed: number
  claimable: number
  pendingMoney: number
  pendingShopPoints: number
  earnedShopPoints: number
  maxShopPoints: number
  welfareBackfillMoney: number
  items: AchievementItemView[]
}

export type AchievementClaimResult =
  | { ok: true; claimedIds: string[]; money: number; shopPoints: number; points: number; balance: number }
  | { ok: false; error: string }

/**
 * 初始化成就账本，并为 1.0 上线前已经打通「巅峰之路第 1 关」的老存档自动补发 100 万金币福利。
 * 幂等：重复调用不会重复发放。
 */
export function ensureAchievements(game: GameState, now = Date.now()): { changed: boolean; backfilledMoney: number } {
  let changed = false
  let backfilledMoney = 0
  if (!game.achievements || typeof game.achievements !== 'object' || Array.isArray(game.achievements)) {
    game.achievements = { version: 1, claimed: {} }
    changed = true
  }
  const state = game.achievements as AchievementState
  if (state.version !== 1) {
    state.version = 1
    changed = true
  }
  if (!state.claimed || typeof state.claimed !== 'object' || Array.isArray(state.claimed)) {
    state.claimed = {}
    changed = true
  }
  if (state.welfareBackfillChecked !== true) {
    const cleared = Math.max(0, Math.floor(game.pve?.peak?.cleared ?? 0))
    if (cleared >= 1 && !state.claimed[PEAK_WELFARE_ACHIEVEMENT_ID]) {
      economyOf(game).balance += PEAK_WELFARE_MONEY
      state.claimed[PEAK_WELFARE_ACHIEVEMENT_ID] = { claimedAt: now, backfilled: true }
      state.welfareBackfillMoney = PEAK_WELFARE_MONEY
      backfilledMoney = PEAK_WELFARE_MONEY
    }
    state.welfareBackfillChecked = true
    changed = true
  }
  return { changed, backfilledMoney }
}

/** 实时评估全部成就进度与领取状态（纯读取，不改动存档）。 */
export function evaluateAchievements(game: GameState): AchievementItemView[] {
  const claimedMap = game.achievements?.claimed ?? {}
  return ACHIEVEMENTS.map((def) => {
    const raw = Math.max(0, Math.floor(def.progressOf(game)))
    const claim = claimedMap[def.id]
    const claimed = !!claim
    const unlocked = claimed || raw >= def.target
    return {
      id: def.id,
      category: def.category,
      title: def.title,
      desc: def.desc,
      current: Math.min(def.target, claimed ? def.target : raw),
      target: def.target,
      unit: def.unit,
      reward: def.reward,
      unlocked,
      claimed,
      claimable: unlocked && !claimed,
      backfilled: !!claim?.backfilled,
      claimedAt: claim?.claimedAt,
    }
  })
}

export function achievementSummary(game: GameState): AchievementSummary {
  const items = evaluateAchievements(game)
  let unlocked = 0
  let claimed = 0
  let claimable = 0
  let pendingMoney = 0
  let pendingShopPoints = 0
  let earnedShopPoints = 0
  for (const item of items) {
    if (item.unlocked) unlocked++
    if (item.claimed) {
      claimed++
      earnedShopPoints += item.reward.shopPoints ?? 0
    } else if (item.claimable) {
      claimable++
      pendingMoney += item.reward.money ?? 0
      pendingShopPoints += item.reward.shopPoints ?? 0
    }
  }
  return {
    total: items.length,
    unlocked,
    claimed,
    claimable,
    pendingMoney,
    pendingShopPoints,
    earnedShopPoints,
    maxShopPoints: MAX_ACHIEVEMENT_SHOP_POINTS,
    welfareBackfillMoney: game.achievements?.welfareBackfillMoney ?? 0,
    items,
  }
}

export function claimableAchievementCount(game: GameState): number {
  const claimedMap = game.achievements?.claimed ?? {}
  let count = 0
  for (const def of ACHIEVEMENTS) {
    if (claimedMap[def.id]) continue
    if (def.progressOf(game) >= def.target) count++
  }
  return count
}

function grantAchievement(game: GameState, def: AchievementDef, now: number): { money: number; shopPoints: number } {
  const money = def.reward.money ?? 0
  const shopPoints = def.reward.shopPoints ?? 0
  if (money > 0) economyOf(game).balance += money
  if (shopPoints > 0) {
    ensureShop(game)
    game.shop!.points += shopPoints
  }
  game.achievements!.claimed[def.id] = { claimedAt: now }
  return { money, shopPoints }
}

/** 领取单个已解锁但尚未领取的成就奖励。 */
export function claimAchievement(game: GameState, id: string, now = Date.now()): AchievementClaimResult {
  const def = ACHIEVEMENT_BY_ID.get(id)
  if (!def) return { ok: false, error: '找不到该成就' }
  ensureAchievements(game, now)
  if (game.achievements!.claimed[id]) return { ok: false, error: '该成就奖励已经领取过了' }
  if (def.progressOf(game) < def.target) return { ok: false, error: '该成就尚未达成，暂无法领取' }
  const { money, shopPoints } = grantAchievement(game, def, now)
  return {
    ok: true,
    claimedIds: [id],
    money,
    shopPoints,
    points: game.shop?.points ?? 0,
    balance: economyOf(game).balance,
  }
}

/** 一键领取当前所有已达成且尚未领取的成就奖励。 */
export function claimAllAchievements(game: GameState, now = Date.now()): AchievementClaimResult {
  ensureAchievements(game, now)
  const claimedIds: string[] = []
  let money = 0
  let shopPoints = 0
  for (const def of ACHIEVEMENTS) {
    if (game.achievements!.claimed[def.id]) continue
    if (def.progressOf(game) < def.target) continue
    const got = grantAchievement(game, def, now)
    claimedIds.push(def.id)
    money += got.money
    shopPoints += got.shopPoints
  }
  if (claimedIds.length === 0) return { ok: false, error: '目前没有可领取的成就奖励' }
  return {
    ok: true,
    claimedIds,
    money,
    shopPoints,
    points: game.shop?.points ?? 0,
    balance: economyOf(game).balance,
  }
}
