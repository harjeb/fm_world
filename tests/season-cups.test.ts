import { describe, expect, it } from 'vitest'
import { createOwnerlessWorld, expandWorldConference } from '../src/game/world.ts'
import { kickoffAtForRound } from '../src/game/calendar.ts'
import { advanceSeasonCup, applySeasonCupPlan, completedWorldRound, planSeasonCups, seasonCupEntrants, seasonRoundKickoff } from '../src/game/season-cups.ts'
import type { WorldState } from '../src/game/types.ts'
import { recordForClub, seasonCupJobId, type MatchJob, type MatchJobResult } from '../server/match-job.ts'

const start = Date.UTC(2026, 10, 9, 12) // 北京时间 20:00
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

  it('四项赛事从同一榜单确定，分级杯并行、跨级杯错日，未来联赛统一延至 22:00', () => {
    const world = setup()
    const original = structuredClone(world)
    const now = kickoffAtForRound(start, 6) + 600_000
    const plan = planSeasonCups(world, 77, now)!
    expect(world).toEqual(original)
    expect(plan.cups.map(cup => [cup.id, cup.entrants.length, cup.dates.length])).toEqual([
      ['community', 16, 4], ['league', 20, 5], ['champions', 20, 5], ['cross', 32, 5],
    ])
    expect(plan.delayedLeagueRounds).toHaveLength(10)
    expect(new Set(plan.delayedLeagueRounds).size).toBe(10)
    const [community, league, champions, cross] = plan.cups
    expect(community.dates).toEqual(league.dates.slice(0, 4))
    expect(champions.dates).toEqual(league.dates)
    expect(cross.dates.every(date => !league.dates.includes(date))).toBe(true)
    for (const cup of plan.cups) {
      expect(new Set(cup.entrants).size).toBe(cup.entrants.length)
      expect(cup.dates[0]).toBeGreaterThanOrEqual(now + 24 * 3600_000)
      expect(cup.dates.every(date => new Date(date + 8 * 3600_000).getUTCHours() === 18)).toBe(true)
    }
    expect(community.rounds[0].fixtures).toHaveLength(8)
    expect(league.rounds[0].byes).toEqual(league.entrants.slice(0, 12))
    expect(league.rounds[0].fixtures).toHaveLength(4)
    expect(champions.rounds[0].byes).toHaveLength(12)
    expect(cross.rounds[0].fixtures).toHaveLength(16)
    applySeasonCupPlan(world, plan)
    for (const division of world.divisions) for (const fixture of division.fixtures) {
      const before = original.divisions.find(item => item.divisionId === division.divisionId)!.fixtures.find(item => item.round === fixture.round && item.homeId === fixture.homeId && item.awayId === fixture.awayId)!
      expect(fixture.kickoffAt).toBe(before.kickoffAt! + (plan.delayedLeagueRounds.includes(fixture.round) ? 2 * 3600_000 : 0))
    }
    expect(seasonRoundKickoff(world.divisions[0], plan.delayedLeagueRounds[0])).toBe(kickoffAtForRound(start, plan.delayedLeagueRounds[0]) + 2 * 3600_000)
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

  it('赛程顺延在 20:00 不能提前推进联赛轮号，22:00 才推进', async () => {
    const world = setup()
    const plan = planSeasonCups(world, 77, kickoffAtForRound(start, 6) + 600_000)!
    applySeasonCupPlan(world, plan)
    const round = plan.delayedLeagueRounds[0]
    const before = kickoffAtForRound(start, round)
    const { worldRoundsKickedOff } = await import('../src/game/season-cups.ts')
    expect(worldRoundsKickedOff(world, before)).toBe(round - 1)
    expect(worldRoundsKickedOff(world, before + 2 * 3600_000 - 1)).toBe(round - 1)
    expect(worldRoundsKickedOff(world, before + 2 * 3600_000)).toBe(round)
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
    expect(plan.delayedLeagueRounds).toHaveLength(10)
  })

  it('剩余日期不够时不改历史联赛，也不伪造杯赛', () => {
    const world = setup(37)
    const before = structuredClone(world)
    expect(planSeasonCups(world, 1, kickoffAtForRound(start, 37) + 600_000)).toBeUndefined()
    expect(world).toEqual(before)
  })
})
