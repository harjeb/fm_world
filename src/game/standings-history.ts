import type { Fixture, SeasonTableRow } from './types.ts'

export type TeamRankPoint = {
  round: number
  rank: number
  points: number
  gd: number
  gf: number
  ga: number
  played: number
  result?: 'W' | 'D' | 'L'
  opponentId?: string
  isHome?: boolean
  score?: { home: number; away: number }
}

export type RankTrendSummary = {
  teamId: string
  totalTeams: number
  totalRounds: number
  points: TeamRankPoint[]
  currentRank: number | null
  bestRank: number | null
  worstRank: number | null
  /** 正数表示较上一轮排名上升（如第 8 升至第 5 为 +3），负数表示下降。 */
  deltaFromPrev: number
}

/**
 * 计算某支球队在本赛季每一轮结束后的积分榜名次轨迹。
 * 排序规则与正式积分榜完全一致：积分 → 净胜球 → 进球数 → 队名拼音序。
 */
export function computeTeamRankTrend(options: {
  teamId: string
  teamIds: string[]
  fixtures: Fixture[]
  names?: ReadonlyMap<string, string>
  totalRounds?: number
}): RankTrendSummary {
  const { teamId, fixtures, names } = options
  const idSet = new Set<string>(options.teamIds)
  for (const fixture of fixtures) {
    idSet.add(fixture.homeId)
    idSet.add(fixture.awayId)
  }
  const ids = [...idSet]
  const totalTeams = Math.max(1, ids.length)
  const maxFixtureRound = fixtures.reduce((max, item) => Math.max(max, item.round), 0)
  const totalRounds = Math.max(options.totalRounds ?? 38, maxFixtureRound, 1)

  if (!idSet.has(teamId) || fixtures.length === 0) {
    return {
      teamId,
      totalTeams,
      totalRounds,
      points: [],
      currentRank: null,
      bestRank: null,
      worstRank: null,
      deltaFromPrev: 0,
    }
  }

  const byRound = new Map<number, Fixture[]>()
  for (const fixture of fixtures) {
    let list = byRound.get(fixture.round)
    if (!list) {
      list = []
      byRound.set(fixture.round, list)
    }
    list.push(fixture)
  }

  const rows = new Map<string, SeasonTableRow>()
  for (const id of ids) {
    rows.set(id, { teamId: id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 })
  }

  const points: TeamRankPoint[] = []
  for (let round = 1; round <= maxFixtureRound; round++) {
    const roundFixtures = byRound.get(round)
    if (!roundFixtures?.length) continue
    const teamFixture = roundFixtures.find((item) => item.homeId === teamId || item.awayId === teamId)
    const teamReady = teamFixture ? teamFixture.played && !!teamFixture.score : roundFixtures.some((item) => item.played && !!item.score)
    if (!teamReady) continue

    for (const fixture of roundFixtures) {
      if (!fixture.played || !fixture.score) continue
      const home = rows.get(fixture.homeId)
      const away = rows.get(fixture.awayId)
      if (!home || !away) continue
      home.played++
      away.played++
      home.gf += fixture.score.home
      home.ga += fixture.score.away
      away.gf += fixture.score.away
      away.ga += fixture.score.home
      if (fixture.score.home > fixture.score.away) {
        home.won++
        home.points += 3
        away.lost++
      } else if (fixture.score.home < fixture.score.away) {
        away.won++
        away.points += 3
        home.lost++
      } else {
        home.drawn++
        away.drawn++
        home.points++
        away.points++
      }
    }

    const sorted = [...rows.values()].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points
      const gdA = a.gf - a.ga
      const gdB = b.gf - b.ga
      if (gdB !== gdA) return gdB - gdA
      if (b.gf !== a.gf) return b.gf - a.gf
      return (names?.get(a.teamId) ?? a.teamId).localeCompare(names?.get(b.teamId) ?? b.teamId, 'zh-CN')
    })

    const rankIndex = sorted.findIndex((row) => row.teamId === teamId)
    const own = rows.get(teamId)!
    let result: 'W' | 'D' | 'L' | undefined
    let opponentId: string | undefined
    let isHome: boolean | undefined
    let score: { home: number; away: number } | undefined
    if (teamFixture?.played && teamFixture.score) {
      isHome = teamFixture.homeId === teamId
      opponentId = isHome ? teamFixture.awayId : teamFixture.homeId
      score = { home: teamFixture.score.home, away: teamFixture.score.away }
      const mine = isHome ? score.home : score.away
      const theirs = isHome ? score.away : score.home
      result = mine > theirs ? 'W' : mine < theirs ? 'L' : 'D'
    }

    points.push({
      round,
      rank: rankIndex >= 0 ? rankIndex + 1 : totalTeams,
      points: own.points,
      gd: own.gf - own.ga,
      gf: own.gf,
      ga: own.ga,
      played: own.played,
      result,
      opponentId,
      isHome,
      score,
    })
  }

  const currentRank = points.length > 0 ? points[points.length - 1].rank : null
  const bestRank = points.length > 0 ? points.reduce((best, p) => Math.min(best, p.rank), points[0].rank) : null
  const worstRank = points.length > 0 ? points.reduce((worst, p) => Math.max(worst, p.rank), points[0].rank) : null
  const deltaFromPrev = points.length >= 2 ? points[points.length - 2].rank - points[points.length - 1].rank : 0

  return {
    teamId,
    totalTeams,
    totalRounds,
    points,
    currentRank,
    bestRank,
    worstRank,
    deltaFromPrev,
  }
}

/**
 * 最近一轮相对于上一轮的排名变化。以当前积分榜为准，撤销该轮已完赛的比分，
 * 只计算一次完整榜单，避免截取显示的球队时丢失其他球队的名次。
 * 尚无上一轮完赛记录时返回空 Map（没有可比较的排名）。
 */
export function latestRoundRankChanges(rows: SeasonTableRow[], fixtures: Fixture[], names?: ReadonlyMap<string, string>): Map<string, number> {
  const previous = rows.map((row) => ({ ...row }))
  const byId = new Map(previous.map((row) => [row.teamId, row]))
  const played = fixtures.filter((fixture) => fixture.played && fixture.score && byId.has(fixture.homeId) && byId.has(fixture.awayId))
  const latest = played.reduce((max, fixture) => Math.max(max, fixture.round), 0)
  if (!played.some((fixture) => fixture.round < latest)) return new Map()

  for (const fixture of played) {
    if (fixture.round !== latest) continue
    const home = byId.get(fixture.homeId)!
    const away = byId.get(fixture.awayId)!
    const score = fixture.score!
    home.played--
    away.played--
    home.gf -= score.home
    home.ga -= score.away
    away.gf -= score.away
    away.ga -= score.home
    if (score.home > score.away) {
      home.won--
      home.points -= 3
      away.lost--
    } else if (score.home < score.away) {
      away.won--
      away.points -= 3
      home.lost--
    } else {
      home.drawn--
      away.drawn--
      home.points--
      away.points--
    }
  }
  previous.sort((a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf ||
    (names?.get(a.teamId) ?? a.teamId).localeCompare(names?.get(b.teamId) ?? b.teamId, 'zh-CN'))
  const previousRanks = new Map(previous.map((row, index) => [row.teamId, index + 1]))
  return new Map(rows.map((row, index) => [row.teamId, previousRanks.get(row.teamId)! - (index + 1)]))
}

/** 返回该联赛最近一轮已有完赛记录的轮次；若本赛季尚未开踢则返回 fallbackRound。 */
export function latestPlayedRound(fixtures: Fixture[], fallbackRound = 1): number {
  let latest = 0
  for (const fixture of fixtures) {
    if (fixture.played && fixture.score && fixture.round > latest) {
      latest = fixture.round
    }
  }
  return latest > 0 ? latest : Math.max(1, fallbackRound)
}
