import type { MatchRecord } from '../game/types.ts'
import type { UIState } from './state.ts'

type CompletionState = Pick<UIState, 'screen' | 'challengeMode' | 'peakPreviewStage' | 'reviewId' | 'notice'>

/** 挑战取胜回到对应模式；联赛、正式杯赛和未取胜仍使用既有赛后复盘。 */
export function returnToChallengeAfterWin(ui: CompletionState, record: MatchRecord): boolean {
  if (record.isLeague || record.result !== 'win' || record.cupId?.startsWith('season-')) return false
  ui.challengeMode = record.mode ?? 'friendly'
  if (record.mode === 'peak') ui.peakPreviewStage = null
  ui.reviewId = null
  ui.screen = 'challenge'
  ui.notice = '挑战成功，可继续挑战或在记录中查看战报。'
  return true
}
