import type { ActiveMatchSave, GameState } from '../src/game/types.ts'

/** 旧挑战杯只允许完成切换前已经开始的那一场。 */
export function validateLegacyCupSave(previous: GameState, incoming: GameState): string | undefined {
  const legacy = (match?: ActiveMatchSave) => !!match && !match.preplayed && match.context?.mode === 'cup' && !match.context.cupId?.startsWith('season-')
  const before = legacy(previous.activeMatch) ? previous.activeMatch : undefined
  const after = legacy(incoming.activeMatch) ? incoming.activeMatch : undefined
  if (after && (!before || after.context.seed !== before.context.seed || after.context.recordKey !== before.context.recordKey || after.context.cupFixtureId !== before.context.cupFixtureId)) {
    return '存档已在另一设备更新：旧版挑战杯已关闭，请刷新页面查看赛季杯赛'
  }
  const known = new Set((previous.challengeHistory ?? []).filter(record => record?.mode === 'cup' && !record.cupId?.startsWith('season-')).map(record => record.id))
  for (const record of incoming.challengeHistory ?? []) {
    if (record?.mode !== 'cup' || record.cupId?.startsWith('season-') || known.has(record.id)) continue
    const expected = before && `m-${before.context.recordKey ?? before.context.seed}-C`
    if (!before || record.id !== expected || record.cupFixtureId !== before.context.cupFixtureId) {
      return '存档已在另一设备更新：旧版挑战杯已关闭，请刷新页面'
    }
  }
  return undefined
}
