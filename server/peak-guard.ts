import type { ActiveMatchSave, GameState } from '../src/game/types.ts'

/** 客户端可保存比赛过程，但不能通过普通存档创建巅峰比赛或覆盖服务器次数。 */
function peakMatchId(active: ActiveMatchSave): string {
  return `m-${active.context.recordKey ?? active.context.seed}-C`
}

export function validatePeakSave(previous: GameState, incoming: GameState): string | undefined {
  const savedPeak = previous.pve?.peak
  const nextPeak = incoming.pve?.peak
  if (savedPeak?.stageRewardVersion === 2 && (nextPeak?.stageRewardVersion !== 2 || !Array.isArray(nextPeak.claimedStageRewards) ||
      (savedPeak.claimedStageRewards ?? []).some(stage => !nextPeak.claimedStageRewards!.includes(stage)))) {
    return '存档已在另一设备更新：巅峰奖励规则已升级，请刷新页面后重试'
  }
  const before = previous.activeMatch?.context?.mode === 'peak' ? previous.activeMatch : undefined
  const after = incoming.activeMatch?.context?.mode === 'peak' ? incoming.activeMatch : undefined
  if (after && (!before || after.context.isLeague || after.context.seed !== before.context.seed ||
      after.context.stage !== before.context.stage || after.context.recordKey !== before.context.recordKey)) {
    return '存档已在另一设备更新：巅峰挑战必须通过服务器开始，请刷新页面后重试'
  }
  if (incoming.challengeHistory != null && !Array.isArray(incoming.challengeHistory)) return '无效的挑战战报'
  const oldIds = new Set((previous.challengeHistory ?? []).filter(record => record?.mode === 'peak').map(record => record.id))
  for (const record of incoming.challengeHistory ?? []) {
    if (record?.mode !== 'peak' || oldIds.has(record.id)) continue
    if (!before || record.id !== peakMatchId(before) || record.stage !== before.context.stage) {
      return '存档已在另一设备更新：巅峰战报与服务器正在进行的比赛不一致，请刷新页面'
    }
    if (savedPeak?.stageRewardVersion === 2 && record.result === 'win' && (!record.stage || !nextPeak?.claimedStageRewards?.includes(record.stage))) {
      return '存档已在另一设备更新：巅峰奖励规则已升级，请刷新页面后重试'
    }
  }
  return undefined
}

/** 旧页面和客户端存档不能清空或改写服务器的游戏日次数、比赛序号。 */
export function preservePeakAttempts(previous: GameState, incoming: GameState): void {
  const source = previous.pve?.peak
  const target = incoming.pve?.peak
  if (!target) return
  if (source?.dailyAttempts) target.dailyAttempts = { ...source.dailyAttempts }
  else delete target.dailyAttempts
  if (source?.attemptCounter !== undefined) target.attemptCounter = source.attemptCounter
  else delete target.attemptCounter
}
