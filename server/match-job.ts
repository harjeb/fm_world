import crypto from 'node:crypto'
import type { AITeam, AutoSubPlan, Chemistry, Fixture, MatchRecord, Suspension } from '../src/game/types.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { PesEngine, type GameEngine } from '../src/game/pes/engine.ts'
import type { MatchState } from '../src/game/match/types.ts'
import { createMatchRecord, fixtureScorers, playersAtPerformance, teamInputFromAI } from '../src/game/match/setup.ts'
import { prepareMatchInjuries } from '../src/game/injury.ts'
import { facilityLevel } from '../src/game/economy.ts'
import { LOGIC_MATCH_SECONDS, matchRealSeconds } from '../src/game/match/time.ts'
import { matchConditionLoss } from '../src/game/condition.ts'
import { matchPlanConditionFactor } from '../src/game/pes/match-plan.ts'

export type MatchBook = {
  injuries: Record<string, number>
  suspensions: Record<string, Suspension>
  yellowCounts: Record<string, number>
  appearances: Record<string, number[]>
  conditionAt: Record<string, number>
  chemistry?: Chemistry
}
export const emptyMatchBook = (): MatchBook => ({ injuries: {}, suspensions: {}, yellowCounts: {}, appearances: {}, conditionAt: {}, chemistry: {} })

export type LockedTeam = {
  team: AITeam
  chemistry?: Record<string, number>
  autoSubs?: AutoSubPlan
  injuries: Record<string, number>
  suspended: string[]
  medical: number
  tacticsStage?: number
  /** 锁定时这支队能发挥几成（欠薪 0.5）；没有这一项按 1 算。 */
  performance?: number
  /** 没有教练的电脑球队：体能低于 80 的先休息。有教练的按教练排的阵容。 */
  ai?: boolean
  /** 超过 3 天未上线的玩家球队：由 AI 自动轮换体能低/伤停球员并接管赛中换人，仍走 PES 引擎保留战术与回放。 */
  aiTakeover?: boolean
}
export type MatchJob = {
  id: string
  season: number
  divisionId: string
  round: number
  kickoffAt: number
  lockedAt: number
  seed: number
  gameDayMs: number
  home: LockedTeam
  away: LockedTeam
}
export type MatchJobResult = {
  id: string
  /**
   * 有教练参与的比赛用画面同款的 PES 引擎算，这里存开球那一刻的初始引擎状态：
   * 浏览器拿它按现实时钟回放整场（同一份种子和输入，回放和最终比分一致）。纯电脑对电脑的比赛没有。
   */
  initialState?: MatchState
  record: MatchRecord
  fixture: Pick<Fixture, 'score' | 'matchId' | 'scorers' | 'assisters' | 'autoSimulated'>
  injuries: Record<string, number>
  conditionLoss: Record<string, number>
  appearances: Record<string, number>
  cards: { card: 'yellow' | 'red'; playerId: string }[]
}

export function matchJobId(season: number, divisionId: string, fixture: Pick<Fixture, 'round' | 'homeId' | 'awayId'>): string {
  return `q-${crypto.createHash('sha256').update(JSON.stringify([season, divisionId, fixture.round, fixture.homeId, fixture.awayId])).digest('hex')}`
}

/** 纯计算：只读锁定快照，不访问账号、共享世界、网络或真实时钟。 */
export function computeMatchJob(job: MatchJob): MatchJobResult {
  const input = (locked: LockedTeam) => {
    // 欠薪的球队按锁定时的状态只发挥一半（见 economy.ts）。
    const factor = locked.performance ?? 1
    const squad = factor < 1 ? { ...locked.team, players: playersAtPerformance(locked.team.players, factor) } : locked.team
    const injured = new Set(Object.entries(locked.injuries).filter(([, until]) => until > job.kickoffAt).map(([id]) => id))
    const team = teamInputFromAI(squad, new Set(locked.suspended), {
      rotate: !!(locked.ai || locked.aiTakeover),
      tacticsStage: locked.tacticsStage,
      injured,
      aiCoach: !!(locked.ai || locked.aiTakeover),
      preserveLineupTactics: !!locked.aiTakeover,
    })
    if (locked.chemistry) team.chemistry = { ...locked.chemistry }
    if (locked.autoSubs) team.autoSubs = structuredClone(locked.autoSubs)
    return team
  }
  // 至少一方有教练：开球后要把整场当直播放给教练看，必须用和画面同一个的 PES 引擎。
  // 两支电脑球队互踢没人看，沿用便宜的整步引擎，只要赛果。
  const live = !job.home.ai || !job.away.ai
  const home = input(job.home), away = input(job.away)
  const engine: GameEngine = live
    ? new PesEngine({ seed: job.seed, home, away, knockout: false, durationSeconds: LOGIC_MATCH_SECONDS, offside: true })
    : new MatchEngine({ seed: job.seed, home, away, knockout: false, durationSeconds: LOGIC_MATCH_SECONDS, offside: true, recordPlayback: false, rulesVersion: 2 })
  prepareMatchInjuries(engine.state, { ...job.home.injuries, ...job.away.injuries }, job.kickoffAt)
  const initialState = live ? engine.serialize() : undefined
  const state = engine.simulate()
  const injuries: Record<string, number> = {}
  for (const entry of state.log) {
    const injury = entry.type === 'injury' ? entry.injury : undefined
    if (!injury?.personId || !(injury.recoveryDays > 0)) continue
    const medical = entry.team === 'home' ? job.home.medical : job.away.medical
    const days = Math.max(1, Math.ceil(injury.recoveryDays * (1 - 0.08 * (facilityLevel(medical) - 1))))
    const until = job.kickoffAt + matchRealSeconds(entry.clock, state.durationSeconds) * 1000 + days * job.gameDayMs
    injury.recoveryDays = days
    injury.recoverAt = until
    injuries[injury.personId] = Math.max(injuries[injury.personId] ?? 0, until)
  }
  const record = createMatchRecord({ season: { index: job.season }, lineup: job.home.team.lineup }, state, {
    isLeague: true, round: job.round, opponentId: job.away.team.id, opponentName: job.away.team.name,
    seed: job.seed, homeAway: 'home', durationSeconds: LOGIC_MATCH_SECONDS,
  })
  record.id = job.id
  record.createdAt = job.kickoffAt
  record.autoSimulated = true
  const conditionLoss: Record<string, number> = {}
  const appearances: Record<string, number> = Object.fromEntries([...job.home.team.players, ...job.away.team.players].map((player) => [player.id, 0]))
  const homeFactor = matchPlanConditionFactor(state.teams[0].matchPlan)
  const awayFactor = matchPlanConditionFactor(state.teams[1].matchPlan)
  for (const stat of record.playerStats) {
    const id = stat.sourceId ?? stat.playerId.split(':').slice(1).join(':')
    // 踢满 90 分钟掉 70 点（见 condition.ts），叠加比赛计划倍率，和单机结算同一个算法。
    conditionLoss[id] = matchConditionLoss(stat.minutes, stat.side === 'home' ? homeFactor : awayFactor)
    appearances[id] = Math.round(stat.minutes)
  }
  const cards = state.log.flatMap((entry) => entry.card && entry.playerId ? [{ card: entry.card, playerId: entry.playerId }] : [])
  return { id: job.id, ...(initialState ? { initialState } : {}), record, fixture: { score: { ...record.score }, matchId: job.id, ...fixtureScorers(state), autoSimulated: true }, injuries, conditionLoss, appearances, cards }
}

/** 同一个全服战报映射给双方教练，各自看到自己的球队 ID、阵容和胜负。 */
export function recordForClub(job: MatchJob, result: MatchJobResult, clubId: string): MatchRecord {
  const record = structuredClone(result.record)
  const home = clubId === job.home.team.id
  record.homeId = home ? 'player' : job.home.team.id
  record.awayId = home ? job.away.team.id : 'player'
  record.opponentId = home ? job.away.team.id : job.home.team.id
  record.lineup = structuredClone(home ? job.home.team.lineup : job.away.team.lineup)
  if (result.initialState) record.hasReplay = true
  const scored = home ? record.score.home : record.score.away
  const conceded = home ? record.score.away : record.score.home
  record.result = scored > conceded ? 'win' : scored < conceded ? 'loss' : 'draw'
  return record
}
