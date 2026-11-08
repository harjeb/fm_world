import type { ActiveMatchSave, GameState } from './types.ts'
import type { MatchState } from './match/types.ts'
import { restoreEngine } from './pes/engine.ts'
import { finishActiveMatch, LEAGUE_REALTIME_SECONDS } from './season.ts'
import { displayClock, logicClock, MATCH_DISPLAY_SECONDS } from './match/time.ts'
import { recordMatchInjuries } from './injury.ts'

/** 现实联赛进度（0..约 600 秒），不是引擎逻辑时钟。 */
export function leagueElapsed(active: ActiveMatchSave, now = Date.now()): number {
  return Math.max(active.elapsedSeconds ?? 0, Math.min(LEAGUE_REALTIME_SECONDS, Math.max(0, (now - active.startedAt) / 1000)))
}

export function leagueMatchClock(active: ActiveMatchSave, now = Date.now()): number {
  return leagueMatchClockAt(active, leagueElapsed(active, now))
}

export function leagueMatchClockAt(active: ActiveMatchSave, elapsedSeconds: number): number {
  return logicClock((elapsedSeconds / LEAGUE_REALTIME_SECONDS) * MATCH_DISPLAY_SECONDS, active.context.durationSeconds)
}

export function leagueDisplayClock(active: ActiveMatchSave, now = Date.now()): number {
  return displayClock(leagueMatchClock(active, now), active.context.durationSeconds)
}

/** 只提交已经到时的整步，绝不提前暴露该步产生的未来事件。 */
export function advanceLeagueRealtime(game: GameState, now = Date.now()): boolean {
  const active = game.activeMatch
  if (!active?.context.isLeague) return false
  const elapsed = leagueElapsed(active, now)
  active.elapsedSeconds = elapsed
  const matchElapsed = leagueMatchClock(active, now)
  let engine = restoreEngine(active.engineState as MatchState, false)
  let changed = false
  if (engine.ruleSet === 'v3' || engine.ruleSet === 'pes') {
    // v3 以 0.1 秒为权威步长：直接推进到当前现实时刻，"比赛时间已经过了"
    // 和"球员真的跑了这么久"是同一个时钟，不需要试跑整步再回滚。
    const result = engine.advanceTo(matchElapsed)
    changed = result.changed
  } else {
    for (let count = 0; count < 20_000 && !engine.state.finished && engine.state.clock <= matchElapsed; count++) {
      const next = restoreEngine(structuredClone(engine.serialize()), false)
      const logLength = next.state.log.length
      next.step(true)
      if (next.state.log.slice(logLength).some((event) => event.clock > matchElapsed)) break
      engine = next
      changed = true
    }
  }
  if (changed) recordMatchInjuries(game, engine.state, active.startedAt, true)
  if (engine.state.finished) {
    finishActiveMatch(game, engine, now)
    return true
  }
  if (changed) {
    active.engineState = engine.serialize()
    active.instructions = [...engine.state.instructions]
  }
  return changed
}
