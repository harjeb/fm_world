import { describe, expect, it } from 'vitest'
import { createOwnerlessWorld, expandWorldConference } from '../src/game/world.ts'
import { kickoffAtForRound } from '../src/game/calendar.ts'
import { advanceSeasonCup, applySeasonCupPlan, completedWorldRound, planSeasonCups, rescheduleActiveSeasonCups, seasonCupEntrants, seasonRoundKickoff } from '../src/game/season-cups.ts'
import type { WorldState } from '../src/game/types.ts'
import { recordForClub, seasonCupJobId, type MatchJob, type MatchJobResult } from '../server/match-job.ts'

const start = Date.UTC(2026, 10, 9, 2) // 北京时间 10:00
function setup(round = 6): WorldState {
  const world = createOwnerlessWorld(123, start).world
  for (const division of world.divisions) for (const fixture of division.fixtures) {
    if (fixture.round <= round) { fixture.played = true; fixture.score = { home: 1, away: 0 } }
  }
  return world
}

describe('赛季杯赛资格、赛程和轮空', () => {
  it('杯赛任务与联赛命名空间隔离，点球结果映射到两位教练', () => {
    const job = { home: { team: { id: 'home', lineup: {} } }, away: { team: { id: 'away', lineup: {} } } } as MatchJob
    const result = { record: { score: { home: 1, away: 1 }, shootout: { home: 4, away: 5 } } } as MatchJobResult
    expect(recordForClub(job, result, 'home').result).toBe('loss')
    expect(recordForClub(job, result, 'away').result).toBe('win')
    expect(seasonCupJobId(1, 'community', 'sc-1-community-1-1')).not.toBe(seasonCupJobId(1, 'cross', 'sc-1-community-1-1'))
    expect(seasonCupJobId(1, 'community', 'sc-1-community-1-1')).toMatch(/^q-[a-f0-9]{64}$/)
  })

  it('第六轮前不生成，资格使用第六轮而非后续名次', () => {
    const early = setup(5)
    expect(completedWorldRound(early)).toBe(5)
    expect(planSeasonCups(early, 1, kickoffAtForRound(start, 5) + 600_000)).toBeUndefined()
    const six = setup(6), ten = setup(10)
    expect(seasonCupEntrants(ten, 6)).toEqual(seasonCupEntrants(six, 6))
    const now = kickoffAtForRound(start, 10) + 600_000
    const plan = planSeasonCups(ten, 77, now)!
    expect(plan.qualificationRound).toBe(6)
    expect(plan.createdAt).toBe(now)
  })

  it('四项赛事从同一榜单确定，分级杯并行、跨级杯错时，插入 12:00 / 20:00 黄金档且不顺延联赛', () => {
    const world = setup()
    const original = structuredClone(world)
    const now = kickoffAtForRound(start, 6) + 600_000
    const plan = planSeasonCups(world, 77, now)!
    expect(world).toEqual(original)
    expect(plan.cups.map(cup => [cup.id, cup.entrants.length, cup.dates.length])).toEqual([
      ['community', 16, 4], ['league', 20, 5], ['champions', 20, 5], ['cross', 32, 5],
    ])
    expect(plan.delayedLeagueRounds).toEqual([])
    const [community, league, champions, cross] = plan.cups
    expect(community.dates).toEqual(league.dates.slice(0, 4))
    expect(champions.dates).toEqual(league.dates)
    expect(cross.dates.every(date => !league.dates.includes(date))).toBe(true)
    for (const cup of plan.cups) {
      expect(new Set(cup.entrants).size).toBe(cup.entrants.length)
      expect(cup.dates[0]).toBeGreaterThanOrEqual(now + 2 * 3600_000)
      expect(cup.dates.every(date => [12, 20].includes(new Date(date + 8 * 3600_000).getUTCHours()))).toBe(true)
    }
    expect(community.rounds[0].fixtures).toHaveLength(8)
    expect(league.rounds[0].byes).toEqual(league.entrants.slice(0, 12))
    expect(league.rounds[0].fixtures).toHaveLength(4)
    expect(champions.rounds[0].byes).toHaveLength(12)
    expect(cross.rounds[0].fixtures).toHaveLength(16)
    applySeasonCupPlan(world, plan)
    for (const division of world.divisions) for (const fixture of division.fixtures) {
      const before = original.divisions.find(item => item.divisionId === division.divisionId)!.fixtures.find(item => item.round === fixture.round && item.homeId === fixture.homeId && item.awayId === fixture.awayId)!
      expect(fixture.kickoffAt).toBe(before.kickoffAt)
    }
    expect(seasonRoundKickoff(world.divisions[0], 8)).toBe(kickoffAtForRound(start, 8))
    expect(planSeasonCups(world, 77, now)).toBeUndefined()
  })

  it('每轮需全部公布后才生成下一轮，重启和重复推进不重复发赛果', () => {
    const world = setup()
    const plan = planSeasonCups(world, 78, kickoffAtForRound(start, 6) + 600_000)!
    const cup = plan.cups.find(item => item.id === 'league')!
    expect(cup.rounds).toHaveLength(1)
    advanceSeasonCup(cup, world.seasonIndex, 78)
    expect(cup.rounds).toHaveLength(1)
    const ids = new Set<string>()
    let games = 0
    while (!cup.championId) {
      const round = cup.rounds.at(-1)!
      for (const fixture of round.fixtures) {
        expect(ids.has(fixture.id)).toBe(false)
        ids.add(fixture.id)
        fixture.played = true
        fixture.score = { home: 1, away: 0 }
        fixture.winnerId = fixture.homeId
        games++
      }
      advanceSeasonCup(cup, world.seasonIndex, 78)
    }
    expect(games).toBe(19)
    expect(cup.rounds).toHaveLength(5)
    expect(cup.entrants).toContain(cup.championId)
    const finished = structuredClone(cup)
    advanceSeasonCup(cup, world.seasonIndex, 78)
    expect(cup).toEqual(finished)
  })

  it('进行中杯赛重排时保留已赛首轮，未赛轮次全部排在常规赛结束前', () => {
    const world = setup(15)
    const plan = planSeasonCups(setup(6), 77, kickoffAtForRound(start, 6) + 600_000)!
    world.seasonCups = structuredClone(plan)
    world.seasonCups.delayedLeagueRounds = [15, 17, 19]
    for (const cup of world.seasonCups.cups.filter(c => c.id !== 'cross')) {
      for (const f of cup.rounds[0].fixtures) { f.played = true; f.score = { home: 1, away: 0 }; f.winnerId = f.homeId }
      advanceSeasonCup(cup, world.seasonIndex, 77)
    }
    const now = kickoffAtForRound(start, 15) + 3600_000
    expect(rescheduleActiveSeasonCups(world, now)).toBe(true)
    expect(world.seasonCups.delayedLeagueRounds).toEqual([])
    for (const cup of world.seasonCups.cups) {
      const unplayed = cup.id === 'cross' ? cup.dates : cup.dates.slice(1)
      expect(unplayed.every(d => d >= now + 2 * 3600_000 && [12, 16, 20].includes(new Date(d + 8 * 3600_000).getUTCHours()))).toBe(true)
      const activeRound = cup.rounds.at(-1)!
      expect(activeRound.kickoffAt).toBe(cup.dates[activeRound.round - 1])
      expect(activeRound.fixtures.every(f => f.kickoffAt === activeRound.kickoffAt)).toBe(true)
    }
  })

  it('新二级赛区每区前八进入社区杯，跨级杯最多 32 队并无重复', () => {
    const world = setup()
    expandWorldConference(world, 555)
    const division = world.divisions.at(-1)!
    for (const fixture of division.fixtures) if (fixture.round <= 6) { fixture.played = true; fixture.score = { home: 0, away: 0 } }
    const plan = planSeasonCups(world, 77, kickoffAtForRound(start, 6) + 600_000)!
    const community = plan.cups.find(cup => cup.id === 'community')!
    const cross = plan.cups.find(cup => cup.id === 'cross')!
    expect(community.entrants).toHaveLength(24)
    expect(community.rounds[0].byes).toHaveLength(8)
    expect(community.rounds[0].fixtures).toHaveLength(8)
    expect(cross.entrants).toHaveLength(32)
    expect(new Set(cross.entrants).size).toBe(32)
  })

  it('剩余日期不够时不改历史联赛，也不伪造杯赛', () => {
    const world = setup(37)
    const before = structuredClone(world)
    expect(planSeasonCups(world, 1, kickoffAtForRound(start, 37) + 600_000)).toBeUndefined()
    expect(world).toEqual(before)
  })
})
