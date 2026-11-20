import { LEGEND_GROUP_ROUNDS, LEGEND_QF_SLOTS, LEGEND_TOTAL_ROUNDS, shuffleSeasonCupTeams, type SeasonCup, type SeasonCupFixture } from '../game/season-cups.ts'

/** 展示节点只连接真实或可确定的签位；不会提前计算任何比赛结果。 */
export type CupBracketNode = {
  id: string
  round: number
  fixture?: SeasonCupFixture
  /** 两回合淘汰赛（1/4 决赛、半决赛）使用 leg1 / leg2 合并展示总比分与双回合赛果。 */
  leg1?: SeasonCupFixture
  leg2?: SeasonCupFixture
  leg2Round?: number
  tieTitle?: string
  byeTeam?: string
  homePlaceholder?: string
  awayPlaceholder?: string
  children?: [CupBracketNode, CupBracketNode]
}

function buildGroupCupKnockoutBracket(cup: SeasonCup): CupBracketNode | undefined {
  const groups = cup.groups
  if (!groups?.length) return undefined
  const qfL1Round = LEGEND_GROUP_ROUNDS + 1
  // 兼容两回合欧冠赛制（8 轮：3 小组 + 2 QF + 2 SF + 1 决赛）与旧 6 轮单场赛制
  const twoLegged = cup.dates.length >= LEGEND_TOTAL_ROUNDS
  if (twoLegged) {
    const qfL2Round = qfL1Round + 1
    const sfL1Round = qfL2Round + 1
    const sfL2Round = sfL1Round + 1
    const finalRound = sfL2Round + 1
    const qfNodes: CupBracketNode[] = LEGEND_QF_SLOTS.map(([g1, r1, g2, r2], index) => {
      const leg1 = cup.rounds[qfL1Round - 1]?.fixtures[index]
      const leg2 = cup.rounds[qfL2Round - 1]?.fixtures[index]
      const g1Name = groups[g1]?.name ?? `${String.fromCharCode(65 + g1)} 组`
      const g2Name = groups[g2]?.name ?? `${String.fromCharCode(65 + g2)} 组`
      return {
        id: leg2?.id ?? leg1?.id ?? `pending-qf-${index}`,
        round: qfL1Round,
        leg2Round: qfL2Round,
        leg1,
        leg2,
        tieTitle: '四分之一决赛 · 两回合',
        homePlaceholder: `${g1Name}第 ${r1 + 1}`,
        awayPlaceholder: `${g2Name}第 ${r2 + 1}`,
      }
    })
    const tieWinner = (node: CupBracketNode): string | undefined =>
      node.leg2?.played ? node.leg2.winnerId : node.fixture?.played ? node.fixture.winnerId : undefined
    const sfNodes: CupBracketNode[] = [0, 1].map((index) => {
      const left = qfNodes[index * 2], right = qfNodes[index * 2 + 1]
      const leg1 = cup.rounds[sfL1Round - 1]?.fixtures[index]
      const leg2 = cup.rounds[sfL2Round - 1]?.fixtures[index]
      return {
        id: leg2?.id ?? leg1?.id ?? `pending-sf-${index}`,
        round: sfL1Round,
        leg2Round: sfL2Round,
        leg1,
        leg2,
        tieTitle: '半决赛 · 两回合',
        children: [left, right],
      }
    })
    const finalFixture = cup.rounds[finalRound - 1]?.fixtures[0]
    const w0 = tieWinner(sfNodes[0]), w1 = tieWinner(sfNodes[1])
    if (finalFixture && ((w0 && finalFixture.homeId !== w0) || (w1 && finalFixture.awayId !== w1))) return undefined
    return {
      id: finalFixture?.id ?? 'pending-final',
      round: finalRound,
      fixture: finalFixture,
      tieTitle: '决赛 · 单场',
      children: [sfNodes[0], sfNodes[1]],
    }
  }
  if (cup.dates.length < LEGEND_GROUP_ROUNDS + 3) return undefined
  const qfActual = cup.rounds[qfL1Round - 1]
  const winner = (node: CupBracketNode): string | undefined => node.fixture?.played ? node.fixture.winnerId : undefined
  let current: CupBracketNode[] = LEGEND_QF_SLOTS.map(([g1, r1, g2, r2], index) => {
    const fixture = qfActual?.fixtures[index]
    const g1Name = groups[g1]?.name ?? `${String.fromCharCode(65 + g1)} 组`
    const g2Name = groups[g2]?.name ?? `${String.fromCharCode(65 + g2)} 组`
    return {
      id: fixture?.id ?? `pending-${qfL1Round}-${index}`,
      round: qfL1Round,
      fixture,
      homePlaceholder: `${g1Name}第 ${r1 + 1}`,
      awayPlaceholder: `${g2Name}第 ${r2 + 1}`,
    }
  })
  for (let round = qfL1Round + 1; round <= cup.dates.length; round++) {
    if (!current.length || current.length % 2) return undefined
    const actual = cup.rounds[round - 1]
    const next: CupBracketNode[] = []
    for (let index = 0; index < current.length; index += 2) {
      const left = current[index], right = current[index + 1]
      const fixture = actual?.fixtures[index / 2]
      if (actual && !fixture) return undefined
      if (fixture && ((winner(left) && fixture.homeId !== winner(left)) || (winner(right) && fixture.awayId !== winner(right)))) return undefined
      next.push({ id: fixture?.id ?? `pending-${round}-${index / 2}`, round, fixture, children: [left, right] })
    }
    current = next
  }
  return current.length === 1 ? current[0] : undefined
}

/** 同一个公开抽签种子与晋级顺序可重建树的连接，但未知对手仍显示待定。 */
export function buildSeasonCupBracket(cup: SeasonCup, drawSeed: number | undefined): CupBracketNode | undefined {
  if (cup.groups?.length) return buildGroupCupKnockoutBracket(cup)
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
