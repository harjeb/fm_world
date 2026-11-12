import { describe, expect, it } from 'vitest'
import { computeTeamRankTrend, latestPlayedRound } from '../src/game/standings-history.ts'
import type { Fixture } from '../src/game/types.ts'
import { createWorldGame, simulateOtherDivisions } from '../src/game/world.ts'
import { PLAYER_TEAM_ID, updateSeasonTable } from '../src/game/season.ts'
import { setGame, ui } from '../src/ui/state.ts'
import { renderSeason } from '../src/ui/screens/season.ts'
import { renderWorld } from '../src/ui/screens/world.ts'

describe('联赛排名变化轨迹与世界页历史比赛记录', () => {
  it('按每轮积分、净胜球、进球数计算排名轨迹，并忽略尚未完赛的半轮', () => {
    const ids = ['a', 'b', 'c', 'd']
    const names = new Map([
      ['a', '阿尔法'],
      ['b', '贝塔'],
      ['c', '伽马'],
      ['d', '德尔塔'],
    ])
    const fixtures: Fixture[] = [
      // 第 1 轮：a 0:2 b（a 排第 4），c 1:1 d
      { round: 1, homeId: 'a', awayId: 'b', isPlayer: true, played: true, score: { home: 0, away: 2 } },
      { round: 1, homeId: 'c', awayId: 'd', isPlayer: false, played: true, score: { home: 1, away: 1 } },
      // 第 2 轮：a 3:0 c（a 升至第 2），b 1:0 d（b 6 分第 1）
      { round: 2, homeId: 'a', awayId: 'c', isPlayer: true, played: true, score: { home: 3, away: 0 } },
      { round: 2, homeId: 'b', awayId: 'd', isPlayer: false, played: true, score: { home: 1, away: 0 } },
      // 第 3 轮：a 4:0 d，b 0:2 c（a 6 分净胜 +5 升至第 1！）
      { round: 3, homeId: 'a', awayId: 'd', isPlayer: true, played: true, score: { home: 4, away: 0 } },
      { round: 3, homeId: 'b', awayId: 'c', isPlayer: false, played: true, score: { home: 0, away: 2 } },
      // 第 4 轮：c vs b 已赛，但 a 的比赛进行中尚未完赛 -> 不应提前计入第 4 轮
      { round: 4, homeId: 'b', awayId: 'a', isPlayer: true, played: false },
      { round: 4, homeId: 'd', awayId: 'c', isPlayer: false, played: true, score: { home: 0, away: 3 } },
    ]

    const trend = computeTeamRankTrend({ teamId: 'a', teamIds: ids, fixtures, names, totalRounds: 6 })
    expect(trend.points.map((p) => ({ round: p.round, rank: p.rank, result: p.result }))).toEqual([
      { round: 1, rank: 4, result: 'L' },
      { round: 2, rank: 2, result: 'W' },
      { round: 3, rank: 1, result: 'W' },
    ])
    expect(trend.currentRank).toBe(1)
    expect(trend.bestRank).toBe(1)
    expect(trend.worstRank).toBe(4)
    expect(trend.deltaFromPrev).toBe(1)
    expect(latestPlayedRound(fixtures)).toBe(4)
  })

  it('赛季页渲染己队排名变化折线图，世界页渲染各级联赛比赛记录与选中球队排名折线图', () => {
    const worldGame = createWorldGame(777)
    // 模拟前 3 轮本赛区与其他级别赛区比赛
    for (let r = 1; r <= 3; r++) {
      for (const fx of worldGame.season.fixtures) {
        if (fx.round === r) {
          fx.played = true
          fx.score = fx.isPlayer ? { home: 2, away: 0 } : { home: 1, away: 1 }
        }
      }
      worldGame.season.round = r
      updateSeasonTable(worldGame)
      simulateOtherDivisions(worldGame, r)
    }
    worldGame.season.round = 4

    setGame(worldGame)
    ui.seasonRound = null
    const seasonHtml = renderSeason()
    expect(seasonHtml).toContain('本赛季排名变化')
    expect(seasonHtml).toContain('rank-svg')
    expect(seasonHtml).toContain('第 3 轮')

    // 世界页：切换到冠军联赛，默认展示第 3 轮完赛历史记录，选中冠军联赛榜首球队可看其排名变化折线图
    ui.worldDivision = 'champions'
    ui.worldRound = null
    ui.worldFixtureClubId = 'ALL'
    const champsDiv = worldGame.world!.divisions.find((d) => d.divisionId === 'champions')!
    const topClubId = champsDiv.table[0].teamId
    const topClubName = worldGame.world!.clubs.find((c) => c.id === topClubId)!.name
    ui.worldClubId = topClubId

    const worldHtml = renderWorld()
    expect(worldHtml).toContain('历史比赛记录 · 第 3 轮')
    expect(worldHtml).toContain('已完赛')
    expect(worldHtml).toContain(`${topClubName} · 本赛季排名变化`)
    expect(worldHtml).toContain(`${topClubName}`)

    // 按球队筛选比赛记录
    ui.worldFixtureClubId = topClubId
    const filteredHtml = renderWorld()
    expect(filteredHtml).toContain(`${topClubName} · 联赛比赛记录`)
    expect(filteredHtml).toContain('已完赛 3 场')
  })
})
