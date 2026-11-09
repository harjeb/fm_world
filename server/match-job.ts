import crypto from 'node:crypto'
import type { AITeam, AutoSubPlan, Fixture, MatchRecord, Suspension } from '../src/game/types.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { createMatchRecord, fixtureScorers, teamInputFromAI } from '../src/game/match/setup.ts'
import { prepareMatchInjuries } from '../src/game/injury.ts'
import { facilityLevel } from '../src/game/economy.ts'
import { LOGIC_MATCH_SECONDS, matchRealSeconds } from '../src/game/match/time.ts'
import { matchConditionLoss } from '../src/game/condition.ts'

export type MatchBook = {
  injuries: Record<string, number>
  suspensions: Record<string, Suspension>
  yellowCounts: Record<string, number>
  appearances: Record<string, number[]>
  conditionAt: Record<string, number>
}
export const emptyMatchBook = (): MatchBook => ({ injuries: {}, suspensions: {}, yellowCounts: {}, appearances: {}, conditionAt: {} })

export type LockedTeam = {
  team: AITeam
  autoSubs?: AutoSubPlan
  injuries: Record<string, number>
  suspended: string[]
  medical: number
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
    const team = teamInputFromAI(locked.team, new Set(locked.suspended))
    if (locked.autoSubs) team.autoSubs = structuredClone(locked.autoSubs)
    return team
  }
  const engine = new MatchEngine({
    seed: job.seed, home: input(job.home), away: input(job.away), knockout: false,
    durationSeconds: LOGIC_MATCH_SECONDS, offside: true, recordPlayback: false, rulesVersion: 2,
  })
  prepareMatchInjuries(engine.state, { ...job.home.injuries, ...job.away.injuries }, job.kickoffAt)
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
  for (const stat of record.playerStats) {
    const id = stat.sourceId ?? stat.playerId.split(':').slice(1).join(':')
    // 踢满 90 分钟掉 70 点（见 condition.ts），和单机结算同一个算法。
    conditionLoss[id] = matchConditionLoss(stat.minutes)
    appearances[id] = Math.round(stat.minutes)
  }
  const cards = state.log.flatMap((entry) => entry.card && entry.playerId ? [{ card: entry.card, playerId: entry.playerId }] : [])
  return { id: job.id, record, fixture: { score: { ...record.score }, matchId: job.id, ...fixtureScorers(state), autoSimulated: true }, injuries, conditionLoss, appearances, cards }
}

/** 同一个全服战报映射给双方教练，各自看到自己的球队 ID、阵容和胜负。 */
export function recordForClub(job: MatchJob, result: MatchJobResult, clubId: string): MatchRecord {
  const record = structuredClone(result.record)
  const home = clubId === job.home.team.id
  record.homeId = home ? 'player' : job.home.team.id
  record.awayId = home ? job.away.team.id : 'player'
  record.opponentId = home ? job.away.team.id : job.home.team.id
  record.lineup = structuredClone(home ? job.home.team.lineup : job.away.team.lineup)
  const scored = home ? record.score.home : record.score.away
  const conceded = home ? record.score.away : record.score.home
  record.result = scored > conceded ? 'win' : scored < conceded ? 'loss' : 'draw'
  return record
}
