import type { CupId } from './data/cup-config.ts'
import type { GameState, Player } from './types.ts'
import { attrHardLimit, mainAttrsFor } from './rating.ts'

/** 三个杯赛的永久俱乐部上限奖励；同一个杯赛只发一次。 */
export const CUP_CEILING_BONUS: Record<CupId, number> = {
  community: 100,
  league: 150,
  champions: 200,
}

/** 只提升当前俱乐部所有球员的**主属性上限**；隐藏属性 0–20 不参与这种 +100/+150/+200。 */
function applyCeilingBonus(player: Player, amount: number): void {
  const gk = player.positions.GK > 0
  player.ceilings = { ...player.ceilings }
  for (const key of mainAttrsFor(gk)) {
    const hard = attrHardLimit(key, gk)
    const current = Number.isFinite(player.ceilings[key]) && player.ceilings[key] > 0 ? player.ceilings[key] : hard
    player.ceilings[key] = Math.round(Math.min(hard, current + amount) * 10) / 10
  }
}

/** 发放杯赛冠军上限奖励；已领过同一个杯赛返回 0。 */
export function applyCupCeilingReward(game: GameState, cupId: CupId): number {
  if (!game.pve) return 0
  const claims = (game.pve.cupCeilingClaims ??= {})
  if (claims[cupId]) return 0
  const amount = CUP_CEILING_BONUS[cupId]
  for (const player of game.roster) applyCeilingBonus(player, amount)
  claims[cupId] = true
  return amount
}

/** 旧存档补领：已经有奖杯但还没有上限领取记录的杯赛，补发一次。 */
export function ensureCupCeilingClaims(game: GameState): boolean {
  if (!game.pve) return false
  let changed = false
  if (!game.pve.cupCeilingClaims || typeof game.pve.cupCeilingClaims !== 'object' || Array.isArray(game.pve.cupCeilingClaims)) {
    game.pve.cupCeilingClaims = {}
    changed = true
  }
  for (const trophy of game.pve.trophies) {
    const cupId = trophy.cupId as CupId
    if (!(cupId in CUP_CEILING_BONUS) || game.pve.cupCeilingClaims[cupId]) continue
    const amount = applyCupCeilingReward(game, cupId)
    if (amount > 0) {
      trophy.ceilingBonus = amount
      changed = true
    }
  }
  return changed
}
