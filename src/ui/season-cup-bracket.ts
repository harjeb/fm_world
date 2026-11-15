import { shuffleSeasonCupTeams, type SeasonCup, type SeasonCupFixture } from '../game/season-cups.ts'

/** 展示节点只连接真实或可确定的签位；不会提前计算任何比赛结果。 */
export type CupBracketNode = {
  id: string
  round: number
  fixture?: SeasonCupFixture
  byeTeam?: string
  children?: [CupBracketNode, CupBracketNode]
}

/** 同一个公开抽签种子与晋级顺序可重建树的连接，但未知对手仍显示待定。 */
export function buildSeasonCupBracket(cup: SeasonCup, drawSeed: number | undefined): CupBracketNode | undefined {
  const first = cup.rounds[0]
  if (!first || !Number.isFinite(drawSeed) || !cup.dates.length) return undefined
  let current: CupBracketNode[] = [
    ...first.byes.map((team, index) => ({ id: `bye-${index}-${team}`, round: 1, byeTeam: team })),
    ...first.fixtures.map(fixture => ({ id: fixture.id, round: 1, fixture })),
  ]
  const winner = (node: CupBracketNode): string | undefined => node.byeTeam ?? (node.fixture?.played ? node.fixture.winnerId : undefined)
  for (let round = 2; round <= cup.dates.length; round++) {
    if (!current.length || current.length % 2) return undefined
    const ordered = shuffleSeasonCupTeams(current, drawSeed!, cup.id, round)
    const actual = cup.rounds[round - 1]
    const next: CupBracketNode[] = []
    for (let index = 0; index < ordered.length; index += 2) {
      const left = ordered[index], right = ordered[index + 1]
      const fixture = actual?.fixtures[index / 2]
      if (actual && !fixture) return undefined
      // 遇到旧版或损坏的非同源签表，宁可退回真实赛程列表，也不画错晋级路径。
      if (fixture && ((winner(left) && fixture.homeId !== winner(left)) || (winner(right) && fixture.awayId !== winner(right)))) return undefined
      next.push({ id: fixture?.id ?? `pending-${round}-${index / 2}`, round, fixture, children: [left, right] })
    }
    current = next
  }
  return current.length === 1 ? current[0] : undefined
}
