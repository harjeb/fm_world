import type { ActiveMatchSave, GameState } from '../src/game/types.ts'

/** 客户端可保存比赛过程，但不能通过普通存档创建传奇挑战比赛或覆盖服务器每日次数。 */
function legendMatchId(active: ActiveMatchSave): string {
  return `m-${active.context.recordKey ?? active.context.seed}-C`
}

export function validateLegendSave(previous: GameState, incoming: GameState): string | undefined {
  const before = previous.activeMatch?.context?.mode === 'legend' ? previous.activeMatch : undefined
  const after = incoming.activeMatch?.context?.mode === 'legend' ? incoming.activeMatch : undefined
  if (after && (!before || after.context.isLeague || after.context.seed !== before.context.seed ||
      after.context.opponentId !== before.context.opponentId || after.context.recordKey !== before.context.recordKey)) {
    return '存档已在另一设备更新：传奇挑战必须通过服务器开始，请刷新页面后重试'
  }
  if (incoming.challengeHistory != null && !Array.isArray(incoming.challengeHistory)) return '无效的挑战战报'
  const oldIds = new Set((previous.challengeHistory ?? []).filter(record => record?.mode === 'legend').map(record => record.id))
  for (const record of incoming.challengeHistory ?? []) {
    if (record?.mode !== 'legend' || oldIds.has(record.id)) continue
    if (!before || record.id !== legendMatchId(before) || record.opponentId !== before.context.opponentId) {
      return '存档已在另一设备更新：传奇战报与服务器正在进行的比赛不一致，请刷新页面'
    }
  }
  return undefined
}

/** 旧页面和客户端存档不能清空或改写服务器的传奇挑战现实日次数与比赛序号。 */
export function preserveLegendAttempts(previous: GameState, incoming: GameState): void {
  const source = previous.pve
  const target = incoming.pve
  if (!target) return
  if (source?.legendDailyAttempts) target.legendDailyAttempts = { ...source.legendDailyAttempts }
  else delete target.legendDailyAttempts
  if (source?.legendAttemptCounter !== undefined) target.legendAttemptCounter = source.legendAttemptCounter
  else delete target.legendAttemptCounter
}
