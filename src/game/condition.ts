/**
 * 球员体能（condition，1–100）：比赛消耗、按时间恢复。单机结算和联机服务器结算共用这里的数。
 *
 * - 消耗：踢满 90 分钟掉 70 点（满体能 100 → 30），按上场分钟同比例；加时赛也按分钟继续算。
 * - 恢复：一个游戏日（现实 6 小时）恢复 30 点，每过一小时（游戏日的六分之一）按比例结算一次 +5，满 100 为止。
 *   每名球员记着上次结算到的时间（recoveryAt），只按整小时往前走，不足一小时的部分留到下次。
 *
 * 体能越低，下一场开场时的体力越低（见 match/team.ts），所以每天两场都踢满的球员会越来越累，要轮换。
 */
import type { Player } from './types.ts'
import { GAME_DAY_MS } from './calendar.ts'

/** 踢满一场（90 分钟）消耗的体能。 */
export const MATCH_CONDITION_LOSS = 70
/** 一场比赛的分钟数（消耗按这个折算）。 */
export const FULL_MATCH_MINUTES = 90
/** 每个游戏日（现实 6 小时）恢复的体能。 */
export const CONDITION_RECOVERY_PER_GAME_DAY = 30
/** 一个游戏日分几次结算恢复（现实每小时一次）。 */
export const CONDITION_SETTLES_PER_GAME_DAY = 6

const MIN_CONDITION = 1
const MAX_CONDITION = 100

/** 这名球员这场踢了 minutes 分钟，体能掉多少。 */
export function matchConditionLoss(minutes: number): number {
  if (!(minutes > 0)) return 0
  return (MATCH_CONDITION_LOSS * minutes) / FULL_MATCH_MINUTES
}

/** 扣掉这场比赛的体能（最低 1）。 */
export function applyConditionLoss(player: Pick<Player, 'condition'>, minutes: number): void {
  player.condition = Math.max(MIN_CONDITION, Math.min(MAX_CONDITION, (player.condition ?? MAX_CONDITION) - matchConditionLoss(minutes)))
}

/** 一次结算的时长（默认现实 1 小时）。 */
export function conditionSettleMs(gameDayMs = GAME_DAY_MS): number {
  return gameDayMs / CONDITION_SETTLES_PER_GAME_DAY
}

/**
 * 把这名球员的体能恢复结算到 now：过了几个整小时就恢复几次，每次 30 / 6 = 5 点。
 * 第一次结算只记时间（旧存档不倒补）；也可以传 since 指定从哪个时间开始算（比如上一场比赛的开球时间）。
 * 返回体能或结算时间有没有变化。
 */
export function settleCondition(player: Pick<Player, 'condition' | 'recoveryAt'>, now: number, gameDayMs = GAME_DAY_MS, since?: number): boolean {
  if (!Number.isFinite(now)) return false
  const last = player.recoveryAt ?? since
  if (last === undefined || !Number.isFinite(last)) {
    player.recoveryAt = now
    return true
  }
  if (player.recoveryAt === undefined) player.recoveryAt = last
  const step = conditionSettleMs(gameDayMs)
  const steps = step > 0 ? Math.floor((now - last) / step) : 0
  if (steps <= 0) return player.recoveryAt !== last
  player.recoveryAt = last + steps * step
  const gained = (steps * CONDITION_RECOVERY_PER_GAME_DAY) / CONDITION_SETTLES_PER_GAME_DAY
  player.condition = Math.max(MIN_CONDITION, Math.min(MAX_CONDITION, (player.condition ?? MAX_CONDITION) + gained))
  return true
}

/** 一批球员都结算到 now。返回有没有谁变了。 */
export function settleConditions(players: Iterable<Pick<Player, 'condition' | 'recoveryAt'>>, now: number, gameDayMs = GAME_DAY_MS): boolean {
  let changed = false
  for (const player of players) if (settleCondition(player, now, gameDayMs)) changed = true
  return changed
}

/** 离线“跳至比赛日”把时间往前跳了 delta：结算时间一起往回拨，跳过的这段按休息恢复。 */
export function shiftConditionClock(players: Iterable<Pick<Player, 'recoveryAt'>>, delta: number): void {
  if (!(delta > 0)) return
  for (const player of players) if (typeof player.recoveryAt === 'number') player.recoveryAt -= delta
}
