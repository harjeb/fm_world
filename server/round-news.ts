import type { MarketReport, WorldState } from '../src/game/types.ts'
import { matchEdition, transferEdition } from '../src/game/football-news.ts'
import { computeWorldTable } from '../src/game/world.ts'
import { seasonRoundKickoff } from '../src/game/season-cups.ts'
import { LEAGUE_REALTIME_MS } from '../src/game/match/time.ts'
import { ROUND_INTERVAL_MS } from '../src/game/calendar.ts'

/** 从已公开的全服赛果定稿；每区仅保留最新一期。写时复制，避免修改已发给账号的快照。 */
export function publishRoundNews(world: WorldState, deals: MarketReport[], now: number): boolean {
  const names = new Map(world.clubs.map(c => [c.id, c.name]))
  let changed = false
  for (const d of world.divisions) {
    const id = d.divisionId
    if (!id || d.index !== world.seasonIndex) continue
    const current = world.newsEditions?.[id]
    const last = current?.season === d.index ? current.round : 0
    let round = 0
    for (const f of d.fixtures) if (f.played && f.score && f.round > last) round = Math.max(round, f.round)
    while (round > last) {
      const fixtures = d.fixtures.filter(f => f.round === round)
      if (fixtures.length && fixtures.every(f => f.played && f.score) && seasonRoundKickoff(d, round) + LEAGUE_REALTIME_MS <= now) break
      round--
    }
    if (round <= last) continue
    const cutoff = seasonRoundKickoff(d, round) + LEAGUE_REALTIME_MS
    const from = round === 1 ? cutoff - ROUND_INTERVAL_MS : seasonRoundKickoff(d, round - 1) + LEAGUE_REALTIME_MS
    const clubs = new Set(d.clubIds?.map(team => names.get(team)))
    const transfers = transferEdition(deals.filter(t => t.at > from && t.at <= cutoff && ((t.club && clubs.has(t.club)) || (t.seller && clubs.has(t.seller))))).slice(0, 1)
    const fixtures = d.fixtures.map(f => f.round <= round ? f : { round: f.round, homeId: f.homeId, awayId: f.awayId, played: false, isPlayer: false })
    const table = computeWorldTable(d.clubIds ?? d.table.map(r => r.teamId), fixtures, names)
    const matches = matchEdition({ ...d, fixtures, table }, names, true).slice(0, 4 - transfers.length)
    world.newsEditions = { ...world.newsEditions, [id]: { season: d.index, round, matches, transfers } }
    changed = true
  }
  return changed
}
