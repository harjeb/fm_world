import { describe, expect, it } from 'vitest'
import { createOwnerlessWorld } from '../src/game/world.ts'
import { advanceSeasonCup, planSeasonCups, type SeasonCup } from '../src/game/season-cups.ts'
import { kickoffAtForRound } from '../src/game/calendar.ts'
import { buildSeasonCupBracket, type CupBracketNode } from '../src/ui/season-cup-bracket.ts'
import { seasonCupLeaders } from '../src/game/season-cup-stats.ts'

const start = Date.UTC(2026, 10, 9, 12)
function setup(): SeasonCup {
  const world = createOwnerlessWorld(122, start).world
  for (const div of world.divisions) for (const fixture of div.fixtures) if (fixture.round <= 6) { fixture.played = true; fixture.score = { home: 1, away: 0 } }
  return planSeasonCups(world, 122, kickoffAtForRound(start, 6) + 600_000)!.cups.find(cup => cup.id === 'league')!
}
function all(node: CupBracketNode): CupBracketNode[] { return [node, ...(node.children?.flatMap(all) ?? [])] }

describe('杯赛淘汰树与排行', () => {
  it('20 队预选赛和 12 轮空正确连到最终签位，赛果公布后路径仍完全一致', () => {
    const cup = setup()
    let tree = buildSeasonCupBracket(cup, 122)!
    expect(tree).toBeDefined()
    expect(all(tree).filter(node => node.byeTeam)).toHaveLength(12)
    expect(all(tree).filter(node => node.fixture)).toHaveLength(4)
    expect(all(tree).filter(node => !node.fixture && !node.byeTeam)).toHaveLength(15)
    while (!cup.championId) {
      for (const fixture of cup.rounds.at(-1)!.fixtures) { fixture.played = true; fixture.score = { home: 1, away: 0 }; fixture.winnerId = fixture.homeId }
      advanceSeasonCup(cup, 1, 122)
      tree = buildSeasonCupBracket(cup, 122)!
      expect(tree).toBeDefined()
    }
    expect(all(tree).filter(node => node.fixture)).toHaveLength(19)
    expect(tree.fixture?.winnerId).toBe(cup.championId)
  })

  it('抽签种子丢失或路径不一致时安全回退，不虚构对阵', () => {
    const cup = setup()
    expect(buildSeasonCupBracket(cup, undefined)).toBeUndefined()
    for (const fixture of cup.rounds[0].fixtures) { fixture.played = true; fixture.winnerId = fixture.homeId }
    advanceSeasonCup(cup, 1, 122)
    cup.rounds[1].fixtures[0].homeId = 'unknown'
    expect(buildSeasonCupBracket(cup, 122)).toBeUndefined()
  })

  it('排行只包含已公布比赛，进球、助攻、射门、抢断及扑救分类汇总', () => {
    const cup = setup()
    const [a, b] = cup.rounds[0].fixtures
    a.played = true
    a.scorers = [{ playerId: 'p1', teamId: a.homeId, name: 'A', goals: 2 }]
    a.assisters = [{ playerId: 'p2', teamId: a.awayId, name: 'B', assists: 1 }]
    a.playerStats = [{ playerId: 'p1', teamId: a.homeId, name: 'A', minutes: 90, shots: 5, tackles: 2 }, { playerId: 'gk', teamId: a.awayId, name: 'GK', minutes: 90, saves: 3 }]
    b.scorers = [{ playerId: 'hidden', teamId: b.homeId, name: '未公布', goals: 99 }]
    expect(seasonCupLeaders(cup, 'goals')).toMatchObject([{ playerId: 'p1', value: 2 }])
    expect(seasonCupLeaders(cup, 'assists')).toMatchObject([{ playerId: 'p2', value: 1 }])
    expect(seasonCupLeaders(cup, 'shots')).toMatchObject([{ playerId: 'p1', value: 5 }])
    expect(seasonCupLeaders(cup, 'tackles')).toMatchObject([{ playerId: 'p1', value: 2 }])
    expect(seasonCupLeaders(cup, 'saves')).toMatchObject([{ playerId: 'gk', value: 3 }])
    expect(JSON.stringify(seasonCupLeaders(cup, 'goals'))).not.toContain('未公布')
  })
})
