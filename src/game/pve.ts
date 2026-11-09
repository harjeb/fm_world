import type { GameState, MatchContext, MatchRecord, PveLegendRecord, PveState } from './types.ts'
import { recordCupResult } from './cup-run.ts'
import { peakStageReward } from './data/peak-config.ts'
import { economyOf } from './economy.ts'

const EMPTY_LEGEND: PveLegendRecord = { played: 0, won: 0, drawn: 0, lost: 0, goals: 0, conceded: 0 }

/** 旧存档补 PvE 字段；返回是否有改动。 */
export function ensurePve(game: GameState): boolean {
  let changed = false
  if (!game.pve) {
    game.pve = {
      legends: {},
      peak: { cleared: 0, rewardClaimed: 0, history: [] },
      cups: {},
      trophies: [],
    }
    changed = true
  }
  const pve = game.pve
  if (!pve.legends || typeof pve.legends !== 'object' || Array.isArray(pve.legends)) {
    pve.legends = {}
    changed = true
  }
  if (!pve.peak || typeof pve.peak !== 'object') {
    pve.peak = { cleared: 0, rewardClaimed: 0, history: [] }
    changed = true
  }
  if (!Array.isArray(pve.peak.history)) {
    pve.peak.history = []
    changed = true
  }
  if (!pve.cups || typeof pve.cups !== 'object' || Array.isArray(pve.cups)) {
    pve.cups = {}
    changed = true
  }
  if (!Array.isArray(pve.trophies)) {
    pve.trophies = []
    changed = true
  }
  for (const run of Object.values(pve.cups)) {
    if (run && run.status === 'active' && run.seasonIndex !== game.season.index) {
      run.status = 'void'
      changed = true
    }
  }
  return changed
}

export function legendRecordOf(game: GameState, legendId: string): PveLegendRecord {
  const row = game.pve?.legends?.[legendId]
  return row ? { ...row } : { ...EMPTY_LEGEND }
}

/** 一场 PvE 比赛结束后更新模式进度。联赛不调用。 */
export function applyPveResult(game: GameState, record: MatchRecord, context: MatchContext): void {
  if (context.isLeague) return
  ensurePve(game)
  const pve = game.pve as PveState
  const home = context.homeAway === 'home'
  const goals = home ? record.score.home : record.score.away
  const conceded = home ? record.score.away : record.score.home

  if (context.mode === 'legend') {
    // 引擎里的球队 id 是 legend-<defId>；存档按数据文件的 defId 记战绩。
    const key = context.opponentId.startsWith('legend-') ? context.opponentId.slice('legend-'.length) : context.opponentId
    const row = pve.legends[key] ?? { ...EMPTY_LEGEND }
    row.played += 1
    if (record.result === 'win') row.won += 1
    else if (record.result === 'draw') row.drawn += 1
    else row.lost += 1
    row.goals += goals
    row.conceded += conceded
    pve.legends[key] = row
    return
  }

  if (context.mode === 'cup') {
    recordCupResult(game, record, context)
    return
  }

  if (context.mode === 'peak' && context.stage) {
    pve.peak.history.unshift({
      stage: context.stage,
      at: Date.now(),
      matchId: record.id,
      won: record.result === 'win',
      score: { ...record.score },
    })
    if (pve.peak.history.length > 50) pve.peak.history.length = 50
    if (record.result === 'win') {
      pve.peak.cleared = Math.max(pve.peak.cleared, context.stage)
      const reward = peakStageReward(context.stage)
      if (reward > 0 && pve.peak.rewardClaimed < context.stage) {
        economyOf(game).balance += reward
        pve.peak.rewardClaimed = context.stage
      }
    }
  }
}
