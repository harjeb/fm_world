/**
 * 训练精力按时间连续恢复：每个游戏日 50 点（现实 6 小时），满 100 为止。
 * 每名球员记着上次结算的时间（energyAt），开始培养、推进赛季、读档时补算这段时间的恢复；
 * 拒绝高价报价而不满的球员，那段时间只恢复一成。
 */
import type { GameState, Player } from './types.ts'
import { GAME_DAY_MS } from './calendar.ts'
import { ENERGY_RECOVERY_PER_GAME_DAY } from './training.ts'
import { energyRateFactor } from './transfer-rules.ts'

/** 补算这名球员到 now 为止恢复的精力。第一次结算只记时间（旧存档不倒补）。 */
export function settleEnergy(player: Player, now: number): void {
  const last = player.energyAt
  player.energyAt = now
  if (last === undefined || !Number.isFinite(last) || !(now > last)) return
  const days = (now - last) / GAME_DAY_MS
  const gained = days * ENERGY_RECOVERY_PER_GAME_DAY * energyRateFactor(player, last, now)
  player.energy = Math.max(0, Math.min(100, (player.energy ?? 100) + gained))
}

/** 整个一线队补算精力。 */
export function settleSquadEnergy(game: Pick<GameState, 'roster'>, now: number): void {
  for (const player of game.roster) settleEnergy(player, now)
}

/** 离线“跳至比赛日”把时间往前跳了 delta：精力和不满都按跳过的时间算。 */
export function shiftEnergyClock(game: Pick<GameState, 'roster'>, delta: number): void {
  for (const player of game.roster) {
    if (typeof player.energyAt === 'number') player.energyAt -= delta
    if (player.unhappy) player.unhappy = { ...player.unhappy, until: player.unhappy.until - delta }
  }
}
