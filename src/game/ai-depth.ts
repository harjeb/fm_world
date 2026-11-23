import { PLAYABLE_PROFICIENCY } from './ca.ts'
import { FORMATIONS } from './data/formations.ts'
import { detailedPositionForSlot, detailedPositionValue } from './detailed-positions.ts'
import type { AITeam, Player } from './types.ts'

/** 两套独立的十一人阵容。多面手能腾挪，但不能同时占两个席位。按阵型检查左右边路等细分位置。 */
export function analyzeAIDepth(team: Pick<AITeam, 'players' | 'lineup'>) {
  const eleven = FORMATIONS[team.lineup.formationId].slots.map(detailedPositionForSlot)
  const seats = [...eleven, ...eleven]
  const players = team.players
  const qualifies = (p: Player, pos: typeof seats[number]) => (p.positions.GK > 0) === (pos === 'GK') && detailedPositionValue(p, pos) >= PLAYABLE_PROFICIENCY
  const edges = players.map(p => seats.flatMap((pos, i) => qualifies(p, pos) ? [i] : []))
  const owner: number[] = seats.map(() => -1)
  function assign(player: number, seen: Set<number>): boolean {
    for (const seat of edges[player]) {
      if (seen.has(seat)) continue
      seen.add(seat)
      if (owner[seat] === -1 || assign(owner[seat], seen)) { owner[seat] = player; return true }
    }
    return false
  }
  players.forEach((_, i) => assign(i, new Set()))
  const spare = new Set<number>(), openings = new Set<number>()
  // 交替路径：从空席位反查，签下能直接补位、或能解除多面手占用的人，都能增加覆盖。
  function findOpening(seat: number) {
    if (openings.has(seat)) return
    openings.add(seat)
    for (let j = 0; j < owner.length; j++) if (owner[j] >= 0 && edges[owner[j]].includes(seat)) findOpening(j)
  }
  owner.forEach((p, i) => { if (p < 0) findOpening(i) })
  // 从未占席球员正向走，路径上的任意一人离开都不会减少最大覆盖。
  function findSpare(i: number) {
    if (spare.has(i)) return
    spare.add(i)
    for (const seat of edges[i]) if (owner[seat] >= 0) findSpare(owner[seat])
  }
  players.forEach((_, i) => { if (!owner.includes(i)) findSpare(i) })
  const needs = [...new Set([...openings].map(i => seats[i]))]
  return {
    missing: owner.filter(i => i < 0).length,
    shortPositions: owner.flatMap((p, i) => p < 0 ? [seats[i]] : []),
    improves: (p: Player) => needs.some(pos => qualifies(p, pos)),
    expendable: new Set([...spare].map(i => players[i].id)),
  }
}
export type AIDepth = ReturnType<typeof analyzeAIDepth>
