import type { GameState, MatchRecord, PlayerMatchStats } from './types.ts'
import { PLAYER_TEAM_ID } from './season.ts'

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
}

const EMPTY: StatTotals = {
  apps: 0, minutes: 0, goals: 0, assists: 0, shots: 0, passes: 0, passesCompleted: 0, tackles: 0, interceptions: 0, goalsPerMatch: 0,
}

function add(totals: StatTotals, stats: PlayerMatchStats): void {
  totals.apps += 1
  totals.minutes += Math.max(0, Math.round(stats.minutes))
  totals.goals += stats.goals
  totals.assists += stats.assists ?? 0
  totals.shots += stats.shots
  totals.passes += stats.passes
  totals.passesCompleted += stats.passesCompleted
  totals.tackles += stats.tackles
  totals.interceptions += stats.interceptions
}

function finish(totals: StatTotals): StatTotals {
  return { ...totals, goalsPerMatch: totals.apps ? Math.round((totals.goals / totals.apps) * 100) / 100 : 0 }
}

/** 这条战报里这名球员的数据。playerId 用存档里的球员 ID。 */
function statsOf(record: MatchRecord, playerId: string): PlayerMatchStats | undefined {
  return record.playerStats.find((stats) => (stats.sourceId ?? stats.playerId.split(':').slice(1).join(':')) === playerId)
}

function playerRecords(game: GameState, playerId: string): { record: MatchRecord; stats: PlayerMatchStats }[] {
  const rows: { record: MatchRecord; stats: PlayerMatchStats }[] = []
  for (const record of [...game.matchHistory, ...game.challengeHistory]) {
    const stats = statsOf(record, playerId)
    if (stats) rows.push({ record, stats })
  }
  return rows
}

/** 本赛季（联赛 + 友谊赛）的数据。 */
export function seasonStats(game: GameState, playerId: string): StatTotals {
  const index = game.season.index
  const totals = { ...EMPTY }
  for (const { record, stats } of playerRecords(game, playerId)) {
    if ((record.seasonIndex ?? 1) !== index) continue
    add(totals, stats)
  }
  return finish(totals)
}

/** 生涯累计（含友谊赛）。 */
export function careerStats(game: GameState, playerId: string): StatTotals {
  const totals = { ...EMPTY }
  for (const { stats } of playerRecords(game, playerId)) add(totals, stats)
  return finish(totals)
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
