import type { CupId } from './data/cup-config.ts'
import type { SeasonCupId } from './season-cups.ts'
import { SEASON_CUP_REWARDS } from './data/season-cup-rewards.ts'
import { achievementCeilingBonusFromClaims } from './data/achievement-rewards.ts'
import type { AttrKey, Attributes, GameState, Player, TrainingSession } from './types.ts'
import { createPlayerFromSeed, seedById } from './data/players.ts'
import { normalizeCeilings } from './data/attr-profile.ts'
import { legendValue } from './legend-bonus.ts'
import { addLegendBook } from './legend-books.ts'
import { attrHardLimit, isMainAttr, mainAttrsFor } from './scale.ts'

/** 每种杯赛对应一个俱乐部主属性上限档位；多项冠军只取最高值，不叠加。传奇杯不给上限（改为专属彩书）。 */
export const CUP_CEILING_BONUS: Record<SeasonCupId, number> = {
  community: SEASON_CUP_REWARDS.community.ceiling,
  league: SEASON_CUP_REWARDS.league.ceiling,
  champions: SEASON_CUP_REWARDS.champions.ceiling,
  cross: SEASON_CUP_REWARDS.cross.ceiling,
  legend: SEASON_CUP_REWARDS.legend.ceiling,
  promotion: SEASON_CUP_REWARDS.promotion.ceiling,
}

const LEGACY_CUP_IDS: CupId[] = ['community', 'league', 'champions']
const CUP_IDS: SeasonCupId[] = [...LEGACY_CUP_IDS, 'cross', 'legend']

/** 奖杯主属性上限唯一生效：只取已获各类杯赛冠军中的最高值，不叠加。 */
export function cupCeilingBonusFromClaims(claims?: Partial<Record<string, true>>): number {
  return CUP_IDS.reduce((max, id) => (claims?.[id] ? Math.max(max, CUP_CEILING_BONUS[id]) : max), 0)
}
const CLUB_CEILING_VERSION = 3

/** 当前俱乐部所有已解锁奖杯的上限加成（取最高值），不依赖球员何时入队。 */
export function cupCeilingBonus(game: Pick<GameState, 'pve'>): number {
  const pve = game.pve
  if (!pve) return 0
  return cupCeilingBonusFromClaims(pve.cupCeilingClaims)
}

/** 当前俱乐部所有已领取成就的主属性上限加成（各项成就独立叠加）。 */
export function achievementCeilingBonus(game: Pick<GameState, 'achievements'>): number {
  return achievementCeilingBonusFromClaims(game.achievements?.claimed)
}

/** 当前俱乐部生效的主属性总上限加成：奖杯上限（取最高） + 成就上限（各项独立叠加）。 */
export function clubCeilingBonus(game: Pick<GameState, 'pve' | 'achievements'>): number {
  return cupCeilingBonus(game) + achievementCeilingBonus(game)
}

/**
 * 计算培养使用的实际上限：球员个人上限 + 俱乐部奖杯/成就 + 个人技能。
 * 不修改球员的个人上限；主属性最终不超过 2000，隐藏属性统一为 20（外场门将属性为 0）。
 * 当前属性如果已超过计算出的上限则原样保留，不因此再额外叠加加成。
 */
export function effectiveClubCeilings(player: Pick<Player, 'attrs' | 'ceilings' | 'positions'>, clubBonus: number, skillBonus = 0): Attributes {
  const gk = player.positions.GK > 0
  const result = normalizeCeilings(player.attrs, player.ceilings, (key) => attrHardLimit(key, gk))
  // 隐藏属性不再设个人单独上限，统一放开到 20（外场门将属性保持 0），兼容旧存档。
  for (const key of Object.keys(result) as AttrKey[]) {
    if (!isMainAttr(key, gk)) result[key] = attrHardLimit(key, gk)
  }
  const bonus = Math.max(0, clubBonus) + Math.max(0, skillBonus)
  if (!bonus) return result
  for (const key of mainAttrsFor(gk)) {
    const hard = attrHardLimit(key, gk)
    const raw = player.ceilings?.[key]
    const personal = Number.isFinite(raw) && raw > 0 ? Math.min(raw, hard) : hard
    result[key] = Math.max(Math.min(player.attrs[key], hard), Math.min(hard, personal + bonus))
  }
  return result
}

/** 奖杯、成就或阵容变化后同步进行中的培养；设施仍保持原有的开局快照规则。 */
export function syncCupCeilingSessions(game: GameState): boolean {
  const activeIds = new Set(game.roster.map((player) => player.id))
  const bonus = clubCeilingBonus(game)
  let changed = false
  for (const session of Object.values(game.training ?? {})) {
    if (!session || session.completed) continue
    const next = activeIds.has(session.playerId) ? bonus : 0
    if ((session.cupCeilingBonus ?? 0) !== next) {
      session.cupCeilingBonus = next
      changed = true
    }
  }
  return changed
}

/** 发放俱乐部奖杯上限加成（多项冠军只取最高值不叠加）；返回新解锁的最高上限档位，未提升则返回 0。 */
export function applyCupCeilingReward(game: GameState, cupId: SeasonCupId): number {
  if (!game.pve || !Object.hasOwn(CUP_CEILING_BONUS, cupId)) return 0
  const tierBonus = CUP_CEILING_BONUS[cupId]
  if (!(tierBonus > 0)) return 0
  const claims = (game.pve.cupCeilingClaims ??= {})
  if (claims[cupId]) return 0
  const before = cupCeilingBonus(game)
  claims[cupId] = true
  syncCupCeilingSessions(game)
  const after = cupCeilingBonus(game)
  return after > before ? tierBonus : 0
}

/** Only separate an embedded reward when the full original ceiling vector is recoverable. */
function separateLegacyBonus(player: Player, amount: number): boolean {
  if (!(amount > 0) || !player.ceilings) return false
  const seed = seedById(player.seedId)
  if (!seed || (player.generation ?? 0) !== 0) return false
  const original = createPlayerFromSeed(seed)
  if (Object.keys(original.baseAttrs).some(key => original.baseAttrs[key as keyof Attributes] !== player.baseAttrs?.[key as keyof Attributes])) return false
  const gk = player.positions.GK > 0
  if (gk !== (original.positions.GK > 0)) return false
  const keys = mainAttrsFor(gk)
  // A single changed attribute is not evidence of a trophy: breakthrough cards also raise ceilings.
  if (keys.some(key => !Number.isFinite(player.ceilings[key]) || Math.abs(player.ceilings[key] - Math.min(attrHardLimit(key, gk), original.ceilings[key] + amount)) > 0.01)) return false
  player.ceilings = { ...player.ceilings }
  for (const key of keys) player.ceilings[key] = original.ceilings[key]
  return true
}

function bonusBeforeSession(game: GameState, ids: CupId[], startedAt: number): number {
  return ids.reduce((sum, id) => {
    const dates = game.pve!.trophies.filter(trophy => trophy.cupId === id && Number.isFinite(trophy.wonAt)).map(trophy => trophy.wonAt)
    const first = dates.length ? Math.min(...dates) : undefined
    return first === undefined || startedAt >= first ? sum + CUP_CEILING_BONUS[id] : sum
  }, 0)
}

/** Recover v2 deductions from unchanged ceiling entries, rather than later trophy totals. */
function restoreVersionTwo(player: Player, backup: Attributes | undefined, possibleBonuses: number[]): number {
  if (!backup || !player.ceilings) return 0
  const gk = player.positions.GK > 0
  const keys = mainAttrsFor(gk)
  const difference = Math.max(0, ...keys.map(key => Number.isFinite(backup[key]) && Number.isFinite(player.ceilings[key]) ? backup[key] - player.ceilings[key] : 0))
  const amount = possibleBonuses.find(value => value > 0 && Math.abs(value - difference) < 0.01) ?? 0
  player.ceilings = { ...player.ceilings }
  for (const key of keys) {
    if (!Number.isFinite(backup[key])) continue
    const deducted = amount > 0 && backup[key] > amount + 0.5 ? Math.round((backup[key] - amount) * 10) / 10 : backup[key]
    const current = Number.isFinite(player.ceilings[key]) ? player.ceilings[key] : backup[key]
    // If all entries were subsequently modified, keep both recorded and current ceilings as floors.
    player.ceilings[key] = Math.min(attrHardLimit(key, gk), Math.max(backup[key], current + backup[key] - deducted))
  }
  return amount
}

/** Unknown roster history is preserved; never deduct a guessed reward from personal ceilings. */
function migrateLegacyCeilings(game: GameState, legacyClaims: Partial<Record<string, true>>): void {
  const pve = game.pve!
  const ids = LEGACY_CUP_IDS.filter(id => legacyClaims[id] === true)
  const amount = ids.reduce((sum, id) => sum + CUP_CEILING_BONUS[id], 0)
  if (!amount) return
  const possibleBonuses = ids.reduce((values, id) => [...values, ...values.map(value => value + CUP_CEILING_BONUS[id])], [0])
  const backups = pve.legacyCupCeilings ??= {}
  const migrate = (player: Player, key: string, bonus: number) => {
    if (pve.cupCeilingVersion === 2) bonus = restoreVersionTwo(player, backups[key], possibleBonuses.filter(value => value <= bonus))
    const original = { ...player.ceilings }
    if (separateLegacyBonus(player, bonus)) backups[key] ??= original
  }
  for (const player of game.roster) migrate(player, player.id, amount)
  for (const session of Object.values(game.training ?? {})) {
    if (!session?.candidate?.ceilings) continue
    const bonus = bonusBeforeSession(game, ids, session.startedAt)
    migrate(session.candidate, `training:${session.playerId}`, bonus)
    const pending = game.candidates?.[session.playerId]
    if (pending?.ceilings) migrate(pending, `candidate:${session.playerId}`, bonus)
  }
}

/** 旧存档的奖杯自动解锁对应俱乐部加成，并保证迁移和同步可重复执行。 */
export function ensureCupCeilingClaims(game: GameState): boolean {
  const pve = game.pve
  if (!pve) return false
  let changed = false
  if (!pve.cupCeilingClaims || typeof pve.cupCeilingClaims !== 'object' || Array.isArray(pve.cupCeilingClaims)) {
    pve.cupCeilingClaims = {}
    changed = true
  }
  if (pve.cupCeilingVersion !== CLUB_CEILING_VERSION) {
    migrateLegacyCeilings(game, pve.cupCeilingClaims)
    pve.cupCeilingVersion = CLUB_CEILING_VERSION
    changed = true
  }
  for (const trophy of pve.trophies ?? []) {
    const official = trophy.cupId.startsWith('season-')
    const cupId = (official ? trophy.cupId.slice('season-'.length) : trophy.cupId) as SeasonCupId
    if (!Object.hasOwn(CUP_CEILING_BONUS, cupId)) continue
    const rewardBook = SEASON_CUP_REWARDS[cupId]?.book
    if (rewardBook && addLegendBook(game, rewardBook.id, rewardBook.tier)) {
      trophy.rewardBook ??= { ...rewardBook }
      changed = true
    }
    if (!(CUP_CEILING_BONUS[cupId] > 0)) continue
    if (pve.cupCeilingClaims[cupId]) {
      // 赛季杯后续夺冠只发金币，不要把旧的首次上限奖励标到每座奖杯上。
      if (!official && !trophy.ceilingBonus) {
        trophy.ceilingBonus = CUP_CEILING_BONUS[cupId]
        changed = true
      }
      continue
    }
    pve.cupCeilingClaims[cupId] = true
    trophy.ceilingBonus = CUP_CEILING_BONUS[cupId]
    changed = true
  }
  return syncCupCeilingSessions(game) || changed
}

/** 与手动培养、自动培养及技能书事件共用同一套实际上限。 */
export function effectiveTrainingCeilings(session: TrainingSession): Attributes {
  const bonus = session.cupCeilingBonus
  const clubBonus = typeof bonus === 'number' && Number.isFinite(bonus) ? Math.max(0, bonus) : 0
  return effectiveClubCeilings(session.candidate, clubBonus, legendValue(session.candidate, 'lg_ceiling_break', 200))
}
