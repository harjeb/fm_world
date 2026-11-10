import type { CupGroupState, CupTableRow } from './types.ts'
import { CUP_SEED } from './data/cup-config.ts'
import { splitSeed } from './rng.ts'

export const emptyCupRow = (teamId: string): CupTableRow => ({ teamId, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 })

export function updateCupTable(rows: CupTableRow[], homeId: string, awayId: string, score: { home: number; away: number }): void {
  const home = rows.find((row) => row.teamId === homeId)!
  const away = rows.find((row) => row.teamId === awayId)!
  home.played++; away.played++
  home.gf += score.home; home.ga += score.away; away.gf += score.away; away.ga += score.home
  if (score.home > score.away) { home.won++; home.points += 3; away.lost++ }
  else if (score.home < score.away) { away.won++; away.points += 3; home.lost++ }
  else { home.drawn++; away.drawn++; home.points++; away.points++ }
}

/** 积分 → 净胜球 → 总进球 → 同分球队之间的小积分榜 → 固定抽签。UI 与结算共用。 */
export function sortCupTable(group: CupGroupState, seed = CUP_SEED): CupTableRow[] {
  const basic = (a: CupTableRow, b: CupTableRow) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf
  const rows = [...group.table].sort(basic)
  const result: CupTableRow[] = []
  for (let i = 0; i < rows.length;) {
    let j = i + 1
    while (j < rows.length && basic(rows[i], rows[j]) === 0) j++
    const tied = rows.slice(i, j)
    const ids = new Set(tied.map((row) => row.teamId))
    const mini = tied.map((row) => emptyCupRow(row.teamId))
    for (const fixture of group.fixtures) {
      if (fixture.played && fixture.score && ids.has(fixture.homeId) && ids.has(fixture.awayId)) updateCupTable(mini, fixture.homeId, fixture.awayId, fixture.score)
    }
    tied.sort((a, b) => basic(mini.find((row) => row.teamId === a.teamId)!, mini.find((row) => row.teamId === b.teamId)!) ||
      splitSeed(seed, `draw-${a.teamId}`) - splitSeed(seed, `draw-${b.teamId}`) || a.teamId.localeCompare(b.teamId))
    result.push(...tied)
    i = j
  }
  return result
}
