import type { MatchRecord } from '../game/types.ts'
import type { UIState } from './state.ts'

type CompletionState = Pick<UIState, 'screen' | 'challengeMode' | 'peakPreviewStage' | 'reviewId' | 'notice'> & {
  seasonEventMode?: UIState['seasonEventMode']
}

/** 挑战取胜回到对应模式；轮抽瑞士轮完赛直接回到活动页积分榜；联赛、正式杯赛和未取胜仍使用既有赛后复盘。 */
export function returnToChallengeAfterWin(ui: CompletionState, record: MatchRecord): boolean {
  if (record.cupId === 'season-event-draft') {
    ui.seasonEventMode = 'draft'
    ui.reviewId = null
    ui.screen = 'events'
    ui.notice = '本轮瑞士轮对决已结算！积分榜已更新，可在已完赛战报中回看 2D 录像。'
    return true
  }
  if (record.isLeague || record.result !== 'win' || record.cupId?.startsWith('season-')) return false
  ui.challengeMode = record.mode ?? 'friendly'
  if (record.mode === 'peak') ui.peakPreviewStage = null
  ui.reviewId = null
  ui.screen = 'challenge'
  ui.notice = '挑战成功，可继续挑战或在记录中查看战报。'
  return true
}
