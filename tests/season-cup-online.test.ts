import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { computeMatchJob, type MatchJob, type MatchJobResult } from '../server/match-job.ts'
import { createOwnerlessWorld, buildOwnerlessTeams, computeWorldTable } from '../src/game/world.ts'
import { kickoffAtForRound } from '../src/game/calendar.ts'
import { applySeasonCupPlan, planSeasonCups } from '../src/game/season-cups.ts'
import { PesEngine } from '../src/game/pes/engine.ts'
import type { GameState } from '../src/game/types.ts'
import { fastMatchResult } from './queued-server-helpers.ts'

const dirs: string[] = []
const servers: AppServer[] = []
afterEach(() => {
  for (const app of servers.splice(0)) app.close()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

async function compute(job: MatchJob): Promise<MatchJobResult> {
  if (job.home.coachId || job.away.coachId) return computeMatchJob(job)
  const result = await fastMatchResult(job)
  result.record.score = { home: 1, away: 0 }
  result.fixture.score = { home: 1, away: 0 }
  return result
}

describe('联机赛季杯赛', () => {
  it('双方共享同一场直播与赛后战报，22 点联赛顺延和重启幂等', async () => {
    const seed = 319, start = Date.UTC(2026, 10, 9, 12)
    const { world, freeStars, reserveStars } = createOwnerlessWorld(seed, start)
    for (const division of world.divisions) for (const fixture of division.fixtures) if (fixture.round <= 6) {
      fixture.played = true; fixture.score = { home: 1, away: 0 }
    }
    const plan = planSeasonCups(world, seed, kickoffAtForRound(start, 6) + 600_000)!
    applySeasonCupPlan(world, plan)
    world.seasonCupMode = 1
    const firstCup = world.seasonCups!.cups.find(cup => cup.id === 'community')!
    const cupFixture = firstCup.rounds[0].fixtures[0]
    const cupAt = cupFixture.kickoffAt
    // 构造已经公布到杯赛日午间的正常世界，保留杯赛及 22 点联赛未赛。
    const names = new Map(world.clubs.map(club => [club.id, club.name]))
    for (const division of world.divisions) {
      for (const fixture of division.fixtures) if (fixture.kickoffAt! < cupAt) { fixture.played = true; fixture.score = { home: 1, away: 0 } }
      division.table = computeWorldTable(division.clubIds!, division.fixtures, names)
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-season-cup-server-'))
    dirs.push(dir)
    fs.writeFileSync(path.join(dir, 'world.json'), JSON.stringify({ seed, startedAt: start, owners: {}, world, teams: buildOwnerlessTeams(world, seed), freeStars, reserveStars }))
    let clock = cupAt - 31 * 60_000
    let app = createAppServer({ dataDir: dir, tickMs: 0, now: () => clock, seasonCups: true, matchQueue: { intervalMs: 0, compute } })
    servers.push(app)
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
    let base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
    const register = async (username: string, clubId: string) => {
      const response = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'secret123', clubId }) })
      expect(response.status).toBe(201)
      return response.json() as Promise<{ token: string }>
    }
    const home = await register('cup_home', cupFixture.homeId)
    const away = await register('cup_away', cupFixture.awayId)
    const headers = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })
    const load = async (token: string) => (await (await fetch(`${base}/api/game`, { headers: headers(token) })).json()) as { game: GameState; revision: number }
    const stale = await load(home.token)
    // 模拟尚未收到杯赛赛程的旧页面；锁阵仍以服务器世界为准。
    delete stale.game.world!.seasonCups
    stale.game.lineup.tactics.tempo = stale.game.lineup.tactics.tempo === 'fast' ? 'slow' : 'fast'
    clock = cupAt - 30 * 60_000
    const lockedSave = await fetch(`${base}/api/game`, { method: 'PUT', headers: headers(home.token), body: JSON.stringify({ game: stale.game, baseRevision: stale.revision }) })
    expect(lockedSave.status).toBe(409)
    for (let i = 0; i < 40; i++) await app.runMatchQueue()
    let one = await load(home.token), two = await load(away.token)
    const fixtures = one.game.world!.seasonCups!.cups.flatMap(cup => cup.rounds.flatMap(round => round.fixtures))
    expect(fixtures.every(fixture => !fixture.played && !fixture.score)).toBe(true)
    const delayed = one.game.season.fixtures.find(fixture => fixture.round === world.seasonCups!.delayedLeagueRounds[0])!
    expect(delayed.kickoffAt).toBe(cupAt + 4 * 3600_000)
    expect(one.game.challengeHistory).toHaveLength(0)
    clock = cupAt
    one = await load(home.token); two = await load(away.token)
    const beforeHome = structuredClone(one), beforeAway = structuredClone(two)
    expect(one.game.activeMatch).toMatchObject({ preplayed: true, context: { mode: 'cup', isLeague: false, cupFixtureId: cupFixture.id } })
    expect(two.game.activeMatch!.context.homeAway).not.toBe(one.game.activeMatch!.context.homeAway)
    expect(one.game.activeMatch!.context.seed).toBe(two.game.activeMatch!.context.seed)
    const replay = PesEngine.restore(one.game.activeMatch!.engineState as never)
    replay.simulate()
    const expected = replay.state.score
    clock = cupAt + 600_000 - 1
    await app.runMatchQueue()
    expect((await load(home.token)).game.challengeHistory).toHaveLength(0)
    clock++
    await app.runMatchQueue()
    one = await load(home.token); two = await load(away.token)
    expect(one.game.challengeHistory).toHaveLength(1)
    expect(two.game.challengeHistory).toHaveLength(1)
    expect(one.game.challengeHistory[0].id).toBe(two.game.challengeHistory[0].id)
    expect(one.game.challengeHistory[0].score).toEqual(expected)
    expect(two.game.challengeHistory[0].score).toEqual(expected)
    expect(one.game.challengeHistory[0].hasReplay).toBe(true)
    expect((await fetch(`${base}/api/match/replay?id=${one.game.challengeHistory[0].id}`, { headers: headers(home.token) })).status).toBe(200)
    expect(one.game.challengeHistory[0].result).not.toBe(two.game.challengeHistory[0].result)
    expect(one.game.economy!.balance).toBe(beforeHome.game.economy!.balance + 50_000)
    expect(two.game.economy!.balance).toBe(beforeAway.game.economy!.balance + 50_000)
    const oldSave = await fetch(`${base}/api/game`, { method: 'PUT', headers: headers(home.token), body: JSON.stringify({ game: beforeHome.game, baseRevision: beforeHome.revision }) })
    expect(oldSave.status).toBe(409)
    expect((await load(home.token)).game.economy!.balance).toBe(one.game.economy!.balance)
    const publishedCup = one.game.world!.seasonCups!.cups.find(cup => cup.id === 'community')!
    expect(publishedCup.rounds).toHaveLength(2)
    const savedFixture = publishedCup.rounds[0].fixtures.find(fixture => fixture.id === cupFixture.id)!
    expect(savedFixture.playerStats!.length).toBeGreaterThan(0)
    expect(savedFixture.scorers).toBeDefined()
    expect(savedFixture.assisters).toBeDefined()
    const before = structuredClone(one.game.challengeHistory)
    const tampered = structuredClone(one.game)
    tampered.challengeHistory = []
    const saved = await fetch(`${base}/api/game`, { method: 'PUT', headers: headers(home.token), body: JSON.stringify({ game: tampered, baseRevision: one.revision }) })
    expect(saved.status).toBe(200)
    expect((await load(home.token)).game.challengeHistory).toEqual(before)
    await app.flush(); await app.shutdown(); servers.pop()
    app = createAppServer({ dataDir: dir, tickMs: 0, now: () => clock, seasonCups: true, matchQueue: { intervalMs: 0, compute } })
    servers.push(app)
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
    await app.runMatchQueue()
    expect((await load(home.token)).game.challengeHistory).toEqual(before)
  }, 120_000)

  it('冠军和亚军各得参赛金，冠军额外金币与上限在重启后不重复发放', async () => {
    const seed = 712, start = Date.UTC(2026, 10, 9, 12), cupAt = Date.UTC(2026, 10, 15, 10)
    const { world, freeStars, reserveStars } = createOwnerlessWorld(seed, start)
    const [homeId, awayId] = world.divisions.find(division => division.divisionId === 'd2-north')!.clubIds!.slice(0, 2)
    for (const division of world.divisions) {
      for (const fixture of division.fixtures) if (fixture.kickoffAt! < cupAt) { fixture.played = true; fixture.score = { home: 1, away: 0 } }
      division.table = computeWorldTable(division.clubIds!, division.fixtures, new Map(world.clubs.map(club => [club.id, club.name])))
    }
    world.seasonCupMode = 1
    world.seasonCups = { version: 1, seasonIndex: 1, qualificationRound: 6, createdAt: cupAt - 24 * 3600_000, delayedLeagueRounds: [], cups: [{
      id: 'community', name: '社区杯', entrants: [homeId, awayId], dates: [cupAt], rounds: [{ round: 1, kickoffAt: cupAt, byes: [], fixtures: [{ id: 'final', cupId: 'community', round: 1, homeId, awayId, kickoffAt: cupAt, played: false }] }],
    }] }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-season-cup-final-')); dirs.push(dir)
    fs.writeFileSync(path.join(dir, 'world.json'), JSON.stringify({ seed, startedAt: start, owners: {}, world, teams: buildOwnerlessTeams(world, seed), freeStars, reserveStars }))
    let clock = cupAt - 31 * 60_000
    let app = createAppServer({ dataDir: dir, tickMs: 0, now: () => clock, seasonCups: true, matchQueue: { intervalMs: 0, compute } }); servers.push(app)
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
    let base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
    const register = async (username: string, clubId: string) => {
      const response = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'secret123', clubId }) })
      expect(response.status).toBe(201)
      return response.json() as Promise<{ token: string }>
    }
    const home = await register('final_home', homeId), away = await register('final_away', awayId)
    const headers = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })
    const load = async (token: string) => (await (await fetch(`${base}/api/game`, { headers: headers(token) })).json()) as { game: GameState; revision: number }
    const beforeHome = await load(home.token), beforeAway = await load(away.token)
    clock = cupAt - 30 * 60_000
    for (let i = 0; i < 5; i++) await app.runMatchQueue()
    clock = cupAt + 600_000
    await app.runMatchQueue()
    const one = await load(home.token), two = await load(away.token)
    const homeWon = one.game.challengeHistory[0].result === 'win'
    const winner = homeWon ? one : two, loser = homeWon ? two : one
    const winnerBefore = homeWon ? beforeHome : beforeAway, loserBefore = homeWon ? beforeAway : beforeHome
    expect(winner.game.economy!.balance).toBe(winnerBefore.game.economy!.balance + 50_000 + 300_000)
    expect(loser.game.economy!.balance).toBe(loserBefore.game.economy!.balance + 50_000)
    expect(winner.game.pve!.cupCeilingClaims?.community).toBe(true)
    expect(winner.game.pve!.trophies).toEqual(expect.arrayContaining([expect.objectContaining({ cupId: 'season-community', ceilingBonus: 100, goldPrize: 300_000 })]))
    expect(loser.game.pve!.trophies.filter(item => item.cupId === 'season-community')).toHaveLength(0)
    const snapshot = { balance: winner.game.economy!.balance, trophies: structuredClone(winner.game.pve!.trophies), claims: structuredClone(winner.game.pve!.seasonCupGoldClaims) }
    await app.flush(); await app.shutdown(); servers.pop()
    app = createAppServer({ dataDir: dir, tickMs: 0, now: () => clock, seasonCups: true, matchQueue: { intervalMs: 0, compute } }); servers.push(app)
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
    await app.runMatchQueue()
    const restored = await load(homeWon ? home.token : away.token)
    expect(restored.game.economy!.balance).toBe(snapshot.balance)
    expect(restored.game.pve!.trophies).toEqual(snapshot.trophies)
    expect(restored.game.pve!.seasonCupGoldClaims).toEqual(snapshot.claims)
  }, 120_000)
})
