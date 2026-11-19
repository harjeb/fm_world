/**
 * 球员体能（condition，1–100）：比赛消耗、按时间恢复。单机结算和联机服务器结算共用这里的数。
 *
 * - 消耗：联赛和正式杯赛扣。踢满 90 分钟掉 70 点（满体能 100 → 30），按上场分钟同比例；加时赛也按分钟继续算。
 *   挑战里的比赛（友谊赛、单场挑战、世界挑战）不扣体能。
 * - 恢复：现实每小时恢复 30 点，每 20 分钟结算一次 +10，满 100 为止；离线同样恢复。
 *   每名球员记着上次结算到的时间（recoveryAt），只按完整周期往前走，不足一周期留到下次。
 *
 * 体能越低，下一场开场时的体力越低（见 match/team.ts）；不改变比赛内体力、训练体力或培养精力。
 */
import type { Player } from './types.ts'
import { GAME_DAY_MS, HOUR_MS } from './calendar.ts'

/** 踢满一场（90 分钟）消耗的体能。 */
export const MATCH_CONDITION_LOSS = 70
/** 一场比赛的分钟数（消耗按这个折算）。 */
export const FULL_MATCH_MINUTES = 90
/** 现实每小时恢复的比赛体能。 */
export const CONDITION_RECOVERY_PER_HOUR = 30
/** 内部时间基准的恢复量；保留 gameDayMs 参数用于测试加速与存档时钟。 */
export const CONDITION_RECOVERY_PER_GAME_DAY = CONDITION_RECOVERY_PER_HOUR * GAME_DAY_MS / HOUR_MS
/** 一个内部时间基准分几次结算恢复（默认现实每 20 分钟一次）。 */
export const CONDITION_SETTLES_PER_GAME_DAY = 6

const MIN_CONDITION = 1
const MAX_CONDITION = 100

/** 这名球员这场踢了 minutes 分钟，体能掉多少（可按比赛计划体能倍率缩放）。 */
export function matchConditionLoss(minutes: number, factor = 1): number {
  if (!(minutes > 0)) return 0
  return (MATCH_CONDITION_LOSS * minutes * factor) / FULL_MATCH_MINUTES
}

/** 扣掉这场比赛的体能（最低 1）。 */
export function applyConditionLoss(player: Pick<Player, 'condition'>, minutes: number, factor = 1): void {
  player.condition = Math.max(MIN_CONDITION, Math.min(MAX_CONDITION, (player.condition ?? MAX_CONDITION) - matchConditionLoss(minutes, factor)))
}

/** 一次结算的时长（默认现实 20 分钟）。 */
export function conditionSettleMs(gameDayMs = GAME_DAY_MS): number {
  return gameDayMs / CONDITION_SETTLES_PER_GAME_DAY
}

/**
 * 把这名球员的体能恢复结算到 now：每过完整 20 分钟恢复 10 点，不足一个周期留到下次。
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
  const prev = player.condition ?? MAX_CONDITION
  const gained = (steps * CONDITION_RECOVERY_PER_GAME_DAY) / CONDITION_SETTLES_PER_GAME_DAY
  const next = Math.max(MIN_CONDITION, Math.min(MAX_CONDITION, prev + gained))
  player.condition = next
  return next !== prev
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
