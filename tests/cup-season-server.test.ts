import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import type { AITeam, GameState, WorldState } from '../src/game/types.ts'
import { fastMatchResult } from './queued-server-helpers.ts'
import { computeWorldTable } from '../src/game/world.ts'
import { seasonEndAt } from '../src/game/calendar.ts'

const servers: AppServer[] = []
const directories: string[] = []
afterEach(() => {
  while (servers.length) servers.pop()!.close()
  for (const directory of directories.splice(0)) {
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('fm-cup-season-')) throw new Error('Unexpected test directory')
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('shared seasonal cup opening rosters', () => {
  it('replaces every coach pool at the shared rollover and gives late coaches the same new recipes', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-cup-season-'))
    directories.push(directory)
    let clock = Date.UTC(2026, 10, 9, 8, 15)
    const open = async () => {
      const app = createAppServer({ dataDir: directory, tickMs: 0, now: () => clock, matchQueue: { intervalMs: 0, compute: fastMatchResult } })
      servers.push(app)
      await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
      return { app, base: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}` }
    }
    const first = await open()
    const response = await fetch(`${first.base}/api/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'rollover_coach', password: crypto.randomUUID() }),
    })
    expect(response.status).toBe(201)
    const account = await response.json() as { token: string; game: GameState }
    const oldIds = account.game.pve!.cupSeason!.fields.community.randomDefs.map(def => def.id)
    first.app.close()
    servers.splice(servers.indexOf(first.app), 1)
    // Settlement is covered by queue tests; this fixture isolates the season-opening transaction.
    const file = path.join(directory, 'world.json')
    const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as { world: WorldState; cupOpening: { seasonIndex: number; teams: Record<string, AITeam> } }
    const names = new Map(stored.world.clubs.map(club => [club.id, club.name]))
    for (const division of stored.world.divisions) {
      for (const fixture of division.fixtures) { fixture.played = true; fixture.score = { home: 0, away: 0 } }
      division.table = computeWorldTable(division.clubIds!, division.fixtures, names)
      division.round = 38
      division.finished = true
      division.champion = division.table[0].teamId
    }
    clock = seasonEndAt(stored.world.seasonStartedAt) + 1
    fs.writeFileSync(file, JSON.stringify(stored))
    const restarted = await open()
    const currentResponse = await fetch(`${restarted.base}/api/game`, { headers: { Authorization: `Bearer ${account.token}` } })
    expect(currentResponse.status).toBe(200)
    const { game } = await currentResponse.json() as { game: GameState }
    expect(game.season.index).toBe(2)
    expect(game.pve!.cupSeason!.seasonIndex).toBe(2)
    expect(game.pve!.cupSeason!.fields.community.randomDefs.every(def => !oldIds.includes(def.id))).toBe(true)
    const opening = (JSON.parse(fs.readFileSync(file, 'utf8')) as typeof stored).cupOpening
    expect(opening.seasonIndex).toBe(2)
    for (const [id, team] of Object.entries(game.pve!.cupSeason!.worldTeams)) expect(team.players).toEqual(opening.teams[id].players)
    const late = await fetch(`${restarted.base}/api/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'rollover_late_coach', password: crypto.randomUUID() }),
    })
    expect(late.status).toBe(201)
    const lateGame = (await late.json() as { game: GameState }).game
    expect(lateGame.pve!.cupSeason!.seasonIndex).toBe(2)
    expect(lateGame.pve!.cupSeason!.fields.community.randomDefs).toEqual(game.pve!.cupSeason!.fields.community.randomDefs)
  })

  it('preserves opening squads across server restarts and midseason registrations', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-cup-season-'))
    directories.push(directory)
    const now = () => Date.UTC(2026, 10, 9, 8, 15)
    const open = async () => {
      const app = createAppServer({ dataDir: directory, tickMs: 0, now, matchQueue: { intervalMs: 0, compute: fastMatchResult } })
      servers.push(app)
      await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
      return { app, base: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}` }
    }
    const first = await open()
    first.app.close()
    servers.splice(servers.indexOf(first.app), 1)
    const file = path.join(directory, 'world.json')
    const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as { teams: Record<string, AITeam>; cupOpening: { seasonIndex: number; teams: Record<string, AITeam> } }
    const opening = structuredClone(stored.cupOpening)
    for (const team of Object.values(stored.teams)) {
      team.name = `Midseason ${team.id}`
      team.players[0].attrs.passing = 1
    }
    fs.writeFileSync(file, JSON.stringify(stored))
    const restarted = await open()
    const pools = []
    for (const username of ['cup_coach_one', 'cup_coach_two']) {
      const response = await fetch(`${restarted.base}/api/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: crypto.randomUUID() }),
      })
      expect(response.status).toBe(201)
      const { game } = await response.json() as { game: GameState }
      const pool = game.pve!.cupSeason!
      expect(pool.seasonIndex).toBe(opening.seasonIndex)
      expect(Object.keys(pool.worldTeams).length).toBeGreaterThan(11)
      for (const [id, team] of Object.entries(pool.worldTeams)) {
        expect(team.name).toBe(opening.teams[id].name)
        expect(team.players[0].attrs).toEqual(opening.teams[id].players[0].attrs)
      }
      pools.push(pool)
    }
    for (const id of Object.keys(pools[0].worldTeams)) {
      if (pools[1].worldTeams[id]) expect(pools[1].worldTeams[id]).toEqual(pools[0].worldTeams[id])
    }
    const after = JSON.parse(fs.readFileSync(file, 'utf8')) as typeof stored
    expect(after.cupOpening).toEqual(opening)
  })
})
