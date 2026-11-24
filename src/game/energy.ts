/**
 * 训练精力按时间连续恢复：每个游戏日 50 点（现实每小时 25 点），满 100 为止。
 * 每名球员记着上次结算的时间（energyAt），开始培养、推进赛季、联机服务器定期推进、读档时补算这段时间的恢复；
 * 拒绝高价报价而不满的球员，那段时间只恢复一成。
 */
import type { GameState, Player } from './types.ts'
import { GAME_DAY_MS } from './calendar.ts'
import { ENERGY_RECOVERY_PER_GAME_DAY } from './training.ts'
import { UNHAPPY_ENERGY_RATE, energyRateFactor } from './transfer-rules.ts'

/** 纯只读计算这名球员在 now 时刻的实时精力（不改动对象，供界面展示、按钮解锁判断与 Agent 视图共用）。 */
export function currentEnergy(player: Pick<Player, 'energy' | 'energyAt' | 'unhappy'>, now: number): number {
  const base = Number.isFinite(player.energy) ? player.energy : 100
  const clampedBase = Math.max(0, Math.min(100, base))
  const last = player.energyAt
  if (!Number.isFinite(now) || last === undefined || !Number.isFinite(last) || !(now > last)) return clampedBase
  if (clampedBase >= 100) return 100
  const until = player.unhappy?.until
  let factor = 1
  if (until !== undefined && until > last) {
    const unhappyPart = (Math.min(until, now) - last) / (now - last)
    factor = unhappyPart * UNHAPPY_ENERGY_RATE + (1 - unhappyPart)
  }
  const days = (now - last) / GAME_DAY_MS
  const gained = days * ENERGY_RECOVERY_PER_GAME_DAY * factor
  return Math.max(0, Math.min(100, clampedBase + gained))
}

/**
 * 补算这名球员到 now 为止恢复的精力。第一次结算只记时间（旧存档不倒补）。
 * 传入 minStep > 0（如联机后台 30 秒 tick 传 1）时，只有累计恢复达到 minStep 或回满 100 才推进 energyAt 并返回 true，
 * 避免每 30 秒空刷存档，同时完全保留不足一步的小数恢复时间。
 */
export function settleEnergy(player: Player, now: number, minStep = 0): boolean {
  if (!Number.isFinite(now)) return false
  const last = player.energyAt
  if (last === undefined || !Number.isFinite(last)) {
    player.energyAt = now
    return true
  }
  if (!(now > last)) return false
  const prev = Number.isFinite(player.energy) ? player.energy : 100
  const hadUnhappy = !!player.unhappy
  if (prev >= 100) {
    const expiredUnhappy = hadUnhappy && player.unhappy!.until <= now
    if (expiredUnhappy) {
      delete player.unhappy
      player.energyAt = now
      return true
    }
    if (minStep <= 0) player.energyAt = now
    return false
  }
  const preview = currentEnergy(player, now)
  if (minStep > 0 && preview - prev < minStep && preview < 100) return false
  const days = (now - last) / GAME_DAY_MS
  const factor = energyRateFactor(player, last, now)
  const gained = days * ENERGY_RECOVERY_PER_GAME_DAY * factor
  const next = Math.max(0, Math.min(100, prev + gained))
  player.energyAt = now
  player.energy = next
  return next !== prev || (hadUnhappy && !player.unhappy)
}

/** 整个一线队补算精力；返回是否有任何球员发生了精力/时钟/不满变化。 */
export function settleSquadEnergy(game: Pick<GameState, 'roster'>, now: number, minStep = 0): boolean {
  let changed = false
  for (const player of game.roster) {
    if (settleEnergy(player, now, minStep)) changed = true
  }
  return changed
}

/** 离线“跳至比赛日”把时间往前跳了 delta：精力和不满都按跳过的时间算。 */
export function shiftEnergyClock(game: Pick<GameState, 'roster'>, delta: number): void {
  for (const player of game.roster) {
    if (typeof player.energyAt === 'number') player.energyAt -= delta
    if (player.unhappy) player.unhappy = { ...player.unhappy, until: player.unhappy.until - delta }
  }
}
