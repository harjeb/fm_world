import type { CupId } from './data/cup-config.ts'
import type { Attributes, GameState, Player, TrainingSession } from './types.ts'
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
const CLUB_CEILING_VERSION = 2

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

/**
 * 旧实现直接把奖杯数值写入夺冠时的名单，且没有记录当时的名单或被 2000 截断的部分。
 * 迁移时对现有名单按旧领取记录扣回，以保持原有效上限不变，再由俱乐部实时加成提供；
 * 同时保留扣回前的完整上限，供旧档有人员变动或截断时人工核对。
 */
function migrateLegacyCeilings(game: GameState, legacyClaims: Partial<Record<string, true>>): boolean {
  if (!game.pve) return false
  const legacyIds = CUP_IDS.filter((id) => legacyClaims[id] === true)
  const legacyBonus = legacyIds.reduce((sum, id) => sum + CUP_CEILING_BONUS[id], 0)
  if (!legacyBonus) return false
  const backups: NonNullable<NonNullable<GameState['pve']>['legacyCupCeilings']> = {}
  for (const player of game.roster) {
    if (!player.ceilings) continue
    const original = { ...player.ceilings }
    if (removeLegacyBonus(player, legacyBonus)) backups[player.id] = original
  }
  // 旧培养从个人上限取快照：只扣除开始培养以前已发放的奖杯，避免把后来夺冠的奖杯扣两次。
  for (const session of Object.values(game.training ?? {})) {
    if (!session?.candidate?.ceilings) continue
    const before = legacyIds.reduce((sum, id) => {
      const first = game.pve!.trophies.filter((trophy) => trophy.cupId === id && Number.isFinite(trophy.wonAt))
        .reduce<number | undefined>((value, trophy) => value === undefined ? trophy.wonAt : Math.min(value, trophy.wonAt), undefined)
      return first === undefined || session.startedAt >= first ? sum + CUP_CEILING_BONUS[id] : sum
    }, 0)
    if (before) {
      const original = { ...session.candidate.ceilings }
      if (removeLegacyBonus(session.candidate, before)) backups[`training:${session.playerId}`] = original
      const pending = game.candidates?.[session.playerId]
      if (pending?.ceilings) {
        const pendingOriginal = { ...pending.ceilings }
        if (removeLegacyBonus(pending, before)) backups[`candidate:${session.playerId}`] = pendingOriginal
      }
    }
  }
  game.pve.legacyCupCeilings = backups
  return true
}

function removeLegacyBonus(player: Player, amount: number): boolean {
  const gk = player.positions.GK > 0
  if (!(amount > 0) || !player.ceilings) return false
  // 低于旧奖杯总额的上限不可能包含过旧的直接加成，避免误伤后来加入的新球员。
  if (!mainAttrsFor(gk).some((key) => player.ceilings[key] > amount + 0.5)) return false
  player.ceilings = { ...player.ceilings }
  for (const key of mainAttrsFor(gk)) {
    const raw = player.ceilings[key]
    if (Number.isFinite(raw) && raw > amount + 0.5) player.ceilings[key] = Math.round((raw - amount) * 10) / 10
  }
  return true
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
    if (migrateLegacyCeilings(game, pve.cupCeilingClaims)) changed = true
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
