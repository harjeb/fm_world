import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createOwnerlessWorld, buildOwnerlessTeams } from '../src/game/world.ts'
import { seedAIClubs } from '../src/game/ai-club.ts'
import { SEASON_CUP_REWARDS } from '../src/game/data/season-cup-rewards.ts'
import { kickoffAtForRound } from '../src/game/calendar.ts'
import { seasonRoundKickoff } from '../src/game/season-cups.ts'
import { MatchQueue } from '../server/match-queue.ts'
import { MatchScheduler } from '../server/match-scheduler.ts'
import { emptyMatchBook, seasonCupJobId, type MatchJob, type MatchJobResult } from '../server/match-job.ts'
import type { MatchRecord } from '../src/game/types.ts'

const dirs: string[] = []
const queues: MatchQueue[] = []
afterEach(() => {
  for (const queue of queues.splice(0)) queue.close()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function result(job: MatchJob): MatchJobResult {
  const players = [...job.home.team.players, ...job.away.team.players]
  const appearances = Object.fromEntries(players.map(player => [player.id, 0]))
  const conditionLoss = Object.fromEntries(players.map(player => [player.id, 0]))
  for (const locked of [job.home, job.away]) for (const starter of locked.team.lineup.starters) {
    appearances[starter.playerId] = 90
    conditionLoss[starter.playerId] = 70
  }
  const record = { id: job.id, score: { home: 1, away: 0 }, playerStats: [] } as unknown as MatchRecord
  return { id: job.id, record, fixture: { score: record.score, matchId: job.id }, injuries: {}, conditionLoss, appearances, cards: [] }
}

describe('赛季杯赛任务调度', () => {
  it('先公布较早联赛再锁杯赛；18:10 统一公布，下一轮与体能只结算一次', async () => {
    const start = Date.UTC(2026, 10, 9, 12)
    const world = createOwnerlessWorld(19, start).world
    const teams = buildOwnerlessTeams(world, 19)
    for (const division of world.divisions) for (const fixture of division.fixtures) if (fixture.round <= 6) {
      fixture.played = true; fixture.score = { home: 1, away: 0 }
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-season-cup-'))
    dirs.push(dir)
    const queue = new MatchQueue(dir, { intervalMs: 0, compute: async job => result(job) })
    queues.push(queue)
    const shared = { seed: 19, world, teams, matchBook: emptyMatchBook() }
    let persisted = 0
    const scheduler = new MatchScheduler(queue, shared, id => ({ team: structuredClone(teams[id]), injuries: {}, suspended: [], medical: 1, ai: true }), () => { persisted++ }, true)
    scheduler.refresh(kickoffAtForRound(start, 6) + 600_000)
    expect(world.seasonCups).toBeDefined()
    const cups = world.seasonCups!.cups
    const date = cups[0].dates[0]
    const nextLeague = world.divisions[0].fixtures.find(f => f.kickoffAt! > date)!
    expect(seasonRoundKickoff(world.divisions[0], nextLeague.round)).toBe(date + 2 * 3600_000)
    const first = cups.flatMap(cup => cup.rounds[0].kickoffAt === date ? cup.rounds[0].fixtures : [])
    expect(first).toHaveLength(16)
    // 有更早的联赛未完成时不能锁杯赛。
    scheduler.refresh(date - 30 * 60_000)
    expect(first.every(fixture => !queue.entries.has(seasonCupJobId(world.seasonIndex, fixture.cupId, fixture.id)))).toBe(true)
    // 前序联赛在测试中手动标为已公布，清掉其模拟排队项。
    queue.entries.clear()
    for (const division of world.divisions) for (const fixture of division.fixtures) if (fixture.kickoffAt! < date) {
      fixture.played = true; fixture.score = { home: 1, away: 0 }
    }
    scheduler.refresh(date - 30 * 60_000)
    expect(queue.entries.size).toBe(16)
    for (let i = 0; i < 16; i++) await queue.pump(date - 30 * 60_000)
    expect([...queue.entries.values()].every(entry => entry.status === 'ready')).toBe(true)
    expect(first.every(fixture => !fixture.played && !fixture.score)).toBe(true)
    scheduler.refresh(date + 600_000 - 1)
    expect(first.every(fixture => !fixture.played && !fixture.score)).toBe(true)
    // 杯赛公布后才能锁定同日 22:00 的联赛。
    scheduler.refresh(date + 3.5 * 3600_000)
    expect(first.every(fixture => fixture.played && fixture.matchId)).toBe(true)
    expect(cups.filter(cup => cup.dates[0] === date).every(cup => cup.rounds.length === 2)).toBe(true)
    expect(first.every(fixture => queue.entries.get(seasonCupJobId(world.seasonIndex, fixture.cupId, fixture.id))?.status === 'published')).toBe(true)
    const chosen = first[0].homeId
    const locked = queue.read(first[0].matchId!).input.home
    const playerId = locked.team.lineup.starters[0].playerId
    const player = teams[chosen].players.find(item => item.id === playerId)!
    expect(player.condition).toBeLessThan(100)
    const condition = player.condition
    scheduler.refresh(date + 3.5 * 3600_000)
    expect(player.condition).toBe(condition)
    expect(persisted).toBeGreaterThan(0)
  })

  it('十个杯赛日期走完整届赛事，所有冠军、比赛数量与赛程均确定且不重复', async () => {
    const start = Date.UTC(2026, 10, 9, 12)
    const world = createOwnerlessWorld(25, start).world
    const teams = buildOwnerlessTeams(world, 25)
    for (const division of world.divisions) for (const fixture of division.fixtures) if (fixture.round <= 6) { fixture.played = true; fixture.score = { home: 1, away: 0 } }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-season-cup-full-')); dirs.push(dir)
    const queue = new MatchQueue(dir, { intervalMs: 0, compute: async job => result(job) }); queues.push(queue)
    const aiClubs = seedAIClubs(world, 25)
    const shared = { seed: 25, world, teams, aiClubs, matchBook: emptyMatchBook() }
    const scheduler = new MatchScheduler(queue, shared, id => ({ team: structuredClone(teams[id]), injuries: {}, suspended: [], medical: 1, ai: true }), () => {}, true)
    scheduler.refresh(kickoffAtForRound(start, 6) + 600_000)
    const cups = world.seasonCups!.cups
    const dates = [...new Set(cups.flatMap(cup => cup.dates))].sort((a, b) => a - b)
    expect(dates).toHaveLength(10)
    for (const date of dates) {
      for (const division of world.divisions) for (const fixture of division.fixtures) if (fixture.kickoffAt! < date) { fixture.played = true; fixture.score ??= { home: 1, away: 0 } }
      scheduler.refresh(date - 30 * 60_000)
      const count = [...queue.entries.values()].filter(entry => entry.status === 'queued').length
      for (let i = 0; i < count; i++) await queue.pump(date - 30 * 60_000)
      scheduler.refresh(date + 600_000 - 1)
      expect(cups.flatMap(cup => cup.rounds).filter(round => round.kickoffAt === date).flatMap(round => round.fixtures).every(fixture => !fixture.played)).toBe(true)
      scheduler.refresh(date + 600_000)
      expect(cups.flatMap(cup => cup.rounds).filter(round => round.kickoffAt === date).flatMap(round => round.fixtures).every(fixture => fixture.played)).toBe(true)
    }
    expect(cups.every(cup => cup.championId && cup.entrants.includes(cup.championId))).toBe(true)
    for (const cup of cups) {
      const champion = aiClubs[cup.championId!]
      expect(champion.cupCeilingClaims?.[cup.id]).toBe(true)
      expect(champion.seasonCupGoldClaims?.[`champion:1:${cup.id}`]).toBe(SEASON_CUP_REWARDS[cup.id].champion)
      for (const round of cup.rounds) for (const fixture of round.fixtures) for (const club of [fixture.homeId, fixture.awayId]) {
        expect(aiClubs[club].seasonCupGoldClaims?.[`match:${fixture.matchId}`]).toBe(SEASON_CUP_REWARDS[cup.id].appearance)
      }
    }
    expect(cups.map(cup => cup.rounds.reduce((sum, round) => sum + round.fixtures.length, 0))).toEqual([15, 19, 19, 31])
    expect([...queue.entries.values()].filter(entry => entry.status === 'published')).toHaveLength(84)
    const before = JSON.stringify({ cups: world.seasonCups, book: shared.matchBook, aiClubs })
    scheduler.refresh(dates.at(-1)! + 600_000)
    expect(JSON.stringify({ cups: world.seasonCups, book: shared.matchBook, aiClubs })).toBe(before)
  }, 120_000)
})
