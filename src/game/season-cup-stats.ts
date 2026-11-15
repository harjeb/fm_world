import type { MatchRecord } from './types.ts'
import type { SeasonCup, SeasonCupPlayerStat } from './season-cups.ts'

/** 精简且可公开的个人数据；点球大战不算射门和进球。 */
export function seasonCupPlayerStats(record: MatchRecord): SeasonCupPlayerStat[] {
  return (record.playerStats ?? []).filter(stat => Number.isFinite(stat.minutes) && stat.minutes > 0).map(stat => ({
    playerId: stat.sourceId ?? (stat.playerId.startsWith(`${stat.side}:`) ? stat.playerId.slice(stat.side.length + 1) : stat.playerId),
    teamId: stat.side === 'home' ? record.homeId : record.awayId,
    name: stat.name,
    minutes: stat.minutes,
    ...(typeof stat.shots === 'number' && Number.isFinite(stat.shots) ? { shots: stat.shots } : {}),
    ...(typeof stat.tackles === 'number' && Number.isFinite(stat.tackles) ? { tackles: stat.tackles } : {}),
    ...(typeof stat.saves === 'number' && Number.isFinite(stat.saves) ? { saves: stat.saves } : {}),
  }))
}

export type CupLeaderKind = 'goals' | 'assists' | 'shots' | 'tackles' | 'saves'
export type CupLeader = { playerId: string; teamId: string; name: string; value: number }

/** 只汇总已公开的战报；未知字段不猜测，跨球队同名球员不合并。 */
export function seasonCupLeaders(cup: SeasonCup, kind: CupLeaderKind, limit = 10): CupLeader[] {
  const rows = new Map<string, CupLeader>()
  const add = (playerId: string, teamId: string | undefined, name: string, value: unknown) => {
    if (!teamId || typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return
    const key = `${teamId}\u0000${playerId}`
    const row = rows.get(key) ?? { playerId, teamId, name, value: 0 }
    row.value += value
    rows.set(key, row)
  }
  for (const round of cup.rounds) for (const fixture of round.fixtures) {
    if (!fixture.played) continue
    if (kind === 'goals') for (const stat of fixture.scorers ?? []) add(stat.playerId, stat.teamId, stat.name, stat.goals)
    else if (kind === 'assists') for (const stat of fixture.assisters ?? []) add(stat.playerId, stat.teamId, stat.name, stat.assists)
    else for (const stat of fixture.playerStats ?? []) add(stat.playerId, stat.teamId, stat.name, stat[kind])
  }
  return [...rows.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'zh-CN') || a.teamId.localeCompare(b.teamId)).slice(0, limit)
}
