import type { GameState, MatchRecord, PlayerMatchStats } from './types.ts'
import { PLAYER_TEAM_ID } from './season.ts'
import { displayClock } from './match/time.ts'

/** 球员数据统计：本赛季和生涯。数据来源是已保存的比赛战报。 */
export type StatTotals = {
  apps: number
  minutes: number
  goals: number
  assists: number
  shots: number
  passes: number
  passesCompleted: number
  tackles: number
  interceptions: number
  /** 出场时间里平均每场进球。 */
  goalsPerMatch: number
  /** 门将专属统计（旧战报缺省失球时按比分与出场区间安全推导）。 */
  saves: number
  savesKnownApps: number
  goalsConceded: number
  concededKnownApps: number
  cleanSheets: number
  claims: number
  claimsKnownApps: number
  xgConceded: number
  xgConcededKnownApps: number
  savesPerMatch: number
  concededPerMatch: number
  /** 扑救成功率 = 扑救 ÷ (扑救 + 失球)，同场两项均已知且面对至少 1 次射正时有值。 */
  saveRate: number | null
}

const EMPTY: StatTotals = {
  apps: 0,
  minutes: 0,
  goals: 0,
  assists: 0,
  shots: 0,
  passes: 0,
  passesCompleted: 0,
  tackles: 0,
  interceptions: 0,
  goalsPerMatch: 0,
  saves: 0,
  savesKnownApps: 0,
  goalsConceded: 0,
  concededKnownApps: 0,
  cleanSheets: 0,
  claims: 0,
  claimsKnownApps: 0,
  xgConceded: 0,
  xgConcededKnownApps: 0,
  savesPerMatch: 0,
  concededPerMatch: 0,
  saveRate: null,
}

const isNonNegNum = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

/**
 * 推导单场门将的失球与零封：
 * 1) 优先使用战报里已直接记录的 stats.goalsConceded；
 * 2) 旧战报未直接记录时，若该门将打满（>=85 分钟或无上下场分段），按对手常规比分记失球；
 *    若中途替补上下场且战报含完整 goalDetails，按在场时间窗口精确统计失球。
 */
export function matchKeeperConceded(record: MatchRecord, stats: PlayerMatchStats): { conceded: number | null; cleanSheet: boolean } {
  const mins = isNonNegNum(stats.minutes) ? stats.minutes : 0
  if (isNonNegNum(stats.goalsConceded)) {
    return { conceded: stats.goalsConceded, cleanSheet: stats.goalsConceded === 0 && mins >= 60 }
  }
  if ((stats.side !== 'home' && stats.side !== 'away') || !isNonNegNum(record.score?.home) || !isNonNegNum(record.score?.away)) {
    return { conceded: null, cleanSheet: false }
  }
  const oppSide = stats.side === 'home' ? 'away' : 'home'
  const oppScore = record.score[oppSide]
  const subbed = isNonNegNum(stats.onMinute) && isNonNegNum(stats.offMinute) && (stats.onMinute > 0 || stats.offMinute < 90) && mins < 85
  if (subbed) {
    const details = record.goalDetails
    if (Array.isArray(details) && details.length >= record.score.home + record.score.away) {
      const duration = record.durationSeconds ?? 600
      let count = 0
      for (const goal of details) {
        if (goal.side !== oppSide) continue
        const minute = displayClock(goal.clock, duration) / 60
        if (minute >= stats.onMinute! - 0.5 && minute <= stats.offMinute! + 0.5) count++
      }
      return { conceded: count, cleanSheet: count === 0 && mins >= 60 }
    }
    return { conceded: null, cleanSheet: false }
  }
  return { conceded: oppScore, cleanSheet: oppScore === 0 && mins >= 60 }
}

type RateAcc = { saves: number; conceded: number }

function add(totals: StatTotals, record: MatchRecord, stats: PlayerMatchStats, rate: RateAcc): void {
  totals.apps += 1
  totals.minutes += Math.max(0, Math.round(stats.minutes))
  totals.goals += stats.goals
  totals.assists += stats.assists ?? 0
  totals.shots += stats.shots
  totals.passes += stats.passes
  totals.passesCompleted += stats.passesCompleted
  totals.tackles += stats.tackles
  totals.interceptions += stats.interceptions

  const hasSaves = isNonNegNum(stats.saves)
  if (hasSaves) {
    totals.saves += stats.saves!
    totals.savesKnownApps += 1
  }
  const { conceded, cleanSheet } = matchKeeperConceded(record, stats)
  if (conceded !== null) {
    totals.goalsConceded += conceded
    totals.concededKnownApps += 1
    if (cleanSheet) totals.cleanSheets += 1
  }
  if (hasSaves && conceded !== null) {
    rate.saves += stats.saves!
    rate.conceded += conceded
  }
  if (isNonNegNum(stats.claims)) {
    totals.claims += stats.claims!
    totals.claimsKnownApps += 1
  }
  if (isNonNegNum(stats.xgConceded)) {
    totals.xgConceded += stats.xgConceded!
    totals.xgConcededKnownApps += 1
  }
}

function finish(totals: StatTotals, rate: RateAcc): StatTotals {
  const faced = rate.saves + rate.conceded
  return {
    ...totals,
    goalsPerMatch: totals.apps ? Math.round((totals.goals / totals.apps) * 100) / 100 : 0,
    savesPerMatch: totals.savesKnownApps ? Math.round((totals.saves / totals.savesKnownApps) * 100) / 100 : 0,
    concededPerMatch: totals.concededKnownApps ? Math.round((totals.goalsConceded / totals.concededKnownApps) * 100) / 100 : 0,
    saveRate: faced > 0 ? rate.saves / faced : null,
  }
}

/** 这条战报里这名球员的数据。playerId 用存档里的球员 ID。 */
function statsOf(record: MatchRecord, playerId: string): PlayerMatchStats | undefined {
  return record.playerStats.find((stats) => (stats.sourceId ?? stats.playerId.split(':').slice(1).join(':')) === playerId)
}

function playerRecords(game: GameState, playerId: string): { record: MatchRecord; stats: PlayerMatchStats }[] {
  const rows: { record: MatchRecord; stats: PlayerMatchStats }[] = []
  const seen = new Set<string>()
  for (const record of [...game.matchHistory, ...game.challengeHistory]) {
    if (record.id && seen.has(record.id)) continue
    const stats = statsOf(record, playerId)
    if (!stats || !(stats.minutes > 0)) continue
    if (record.id) seen.add(record.id)
    rows.push({ record, stats })
  }
  return rows
}

/** 本赛季（联赛 + 友谊赛）的数据。 */
export function seasonStats(game: GameState, playerId: string): StatTotals {
  const index = game.season.index
  const totals = { ...EMPTY }
  const rate: RateAcc = { saves: 0, conceded: 0 }
  for (const { record, stats } of playerRecords(game, playerId)) {
    if ((record.seasonIndex ?? 1) !== index) continue
    add(totals, record, stats, rate)
  }
  return finish(totals, rate)
}

/** 生涯累计（含友谊赛）。 */
export function careerStats(game: GameState, playerId: string): StatTotals {
  const totals = { ...EMPTY }
  const rate: RateAcc = { saves: 0, conceded: 0 }
  for (const { record, stats } of playerRecords(game, playerId)) add(totals, record, stats, rate)
  return finish(totals, rate)
}

/** 只有本赛季联赛数据的球员（比如别队的球员），用赛程里的进球/助攻记录。 */
export function fixtureTotals(game: GameState, playerId: string): { goals: number; assists: number; apps: number } {
  let goals = 0
  let assists = 0
  let apps = 0
  for (const division of game.world?.divisions ?? [game.season]) {
    for (const fixture of division.fixtures) {
      if (!fixture.played) continue
      const scored = fixture.scorers?.find((row) => row.playerId === playerId)
      const assisted = fixture.assisters?.find((row) => row.playerId === playerId)
      if (!scored && !assisted) continue
      apps += 1
      goals += scored?.goals ?? 0
      assists += assisted?.assists ?? 0
    }
  }
  // 自己球队的人如果已经算过详细数据，就以战报为准。
  return { goals, assists, apps }
}

/** 玩家球队里这名球员是不是自己人。 */
export function isOwnPlayer(game: GameState, playerId: string): boolean {
  return game.roster.some((player) => player.id === playerId)
}

export function teamOfPlayer(game: GameState, playerId: string): string | undefined {
  if (isOwnPlayer(game, playerId)) return PLAYER_TEAM_ID
  for (const division of game.world?.divisions ?? []) {
    for (const fixture of division.fixtures) {
      if (fixture.scorers?.some((row) => row.playerId === playerId && row.teamId === fixture.homeId)) return fixture.homeId
      if (fixture.scorers?.some((row) => row.playerId === playerId && row.teamId === fixture.awayId)) return fixture.awayId
      if (fixture.assisters?.some((row) => row.playerId === playerId && row.teamId === fixture.homeId)) return fixture.homeId
      if (fixture.assisters?.some((row) => row.playerId === playerId && row.teamId === fixture.awayId)) return fixture.awayId
    }
  }
  return undefined
}
