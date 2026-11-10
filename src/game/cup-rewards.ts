import type { CupId } from './data/cup-config.ts'
import type { Attributes, GameState, Player, TrainingSession } from './types.ts'
import { createPlayerFromSeed, seedById } from './data/players.ts'
import { normalizeCeilings } from './data/attr-profile.ts'
import { legendValue } from './legend-bonus.ts'
import { attrHardLimit, mainAttrsFor } from './scale.ts'

/** 每种奖杯只生效一次；三种奖杯可以叠加。 */
export const CUP_CEILING_BONUS: Record<CupId, number> = {
  community: 100,
  league: 150,
  champions: 200,
}

const CUP_IDS: CupId[] = ['community', 'league', 'champions']
const CLUB_CEILING_VERSION = 3

/** 当前俱乐部所有已解锁奖杯的上限加成，不依赖球员何时入队。 */
export function cupCeilingBonus(game: Pick<GameState, 'pve'>): number {
  const pve = game.pve
  if (!pve) return 0
  return CUP_IDS.reduce((sum, id) => sum + (pve.cupCeilingClaims?.[id] ? CUP_CEILING_BONUS[id] : 0), 0)
}

/**
 * 计算培养使用的实际上限：球员个人上限 + 俱乐部奖杯 + 个人技能。
 * 不修改球员的个人上限；只作用于主属性，且最终不超过 2000。
 * 当前属性如果已超过计算出的上限则原样保留，不因此再额外叠加奖杯。
 */
export function effectiveClubCeilings(player: Pick<Player, 'attrs' | 'ceilings' | 'positions'>, clubBonus: number, skillBonus = 0): Attributes {
  const gk = player.positions.GK > 0
  const result = normalizeCeilings(player.attrs, player.ceilings, (key) => attrHardLimit(key, gk))
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

/** 奖杯或阵容变化后同步进行中的培养；设施仍保持原有的开局快照规则。 */
export function syncCupCeilingSessions(game: GameState): boolean {
  const activeIds = new Set(game.roster.map((player) => player.id))
  const bonus = cupCeilingBonus(game)
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

/** 发放俱乐部永久加成；同一杯赛重复夺冠不会叠加。 */
export function applyCupCeilingReward(game: GameState, cupId: CupId): number {
  if (!game.pve || !Object.hasOwn(CUP_CEILING_BONUS, cupId)) return 0
  const claims = (game.pve.cupCeilingClaims ??= {})
  if (claims[cupId]) return 0
  claims[cupId] = true
  syncCupCeilingSessions(game)
  return CUP_CEILING_BONUS[cupId]
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
  const ids = CUP_IDS.filter(id => legacyClaims[id] === true)
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
    const cupId = trophy.cupId as CupId
    if (!Object.hasOwn(CUP_CEILING_BONUS, cupId)) continue
    if (pve.cupCeilingClaims[cupId]) {
      if (!trophy.ceilingBonus) {
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
