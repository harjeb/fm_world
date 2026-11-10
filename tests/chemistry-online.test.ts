import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import type { MatchJob } from '../server/match-job.ts'
import type { GameState, PlayerMatchStats } from '../src/game/types.ts'
import { chemistryKey, recordTrainingChemistry } from '../src/game/chemistry.ts'
import { kickoffAtForRound } from '../src/game/calendar.ts'
import { drainServerQueue, fastMatchResult } from './queued-server-helpers.ts'

const apps: AppServer[] = [], dirs: string[] = []
afterEach(() => { while (apps.length) apps.pop()!.close(); while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true }) })

describe('shared-world chemistry', () => {
  it('locks squad chemistry, settles matches once, and preserves server growth across stale client saves', async () => {
    let clock = Date.UTC(2026, 10, 10, 8)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-chemistry-')); dirs.push(dir)
    const jobs: MatchJob[] = []
    const app = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), tickMs: 0, now: () => clock, matchQueue: { intervalMs: 0, compute: async job => {
      jobs.push(job)
      const result = await fastMatchResult(job)
      result.record.playerStats = ([['home', job.home], ['away', job.away]] as const).flatMap(([side, locked]) => locked.team.lineup.starters.slice(0, 2).map(p => ({ sourceId: p.playerId, playerId: `${side}:${p.playerId}`, side, minutes: 90, onMinute: 0, offMinute: 90 } as PlayerMatchStats)))
      return result
    } } })
    apps.push(app)
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
    const registration = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'chemistry_test', password: randomUUID() }) })
    expect(registration.status).toBe(201)
    const registered = await registration.json() as { token: string; game: GameState; revision: number }
    const headers = { Authorization: `Bearer ${registered.token}`, 'Content-Type': 'application/json' }
    const load = async () => await (await fetch(`${base}/api/game`, { headers })).json() as { game: GameState; revision: number }
    const save = async (state: { game: GameState; revision: number }) => fetch(`${base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game: state.game, baseRevision: state.revision }) })
    const first = await load()
    const ids = first.game.lineup.starters.slice(0, 2).map(p => p.playerId)
    const key = chemistryKey(ids[0], ids[1])
    recordTrainingChemistry(first.game, [[ids[0], ids[1]]], clock)
    const stale = structuredClone(first.game.chemistry!)
    expect((await save(first)).status).toBe(200)
    expect((await load()).game.chemistry![key].training).toBe(0.5)
    const kickoff = kickoffAtForRound(first.game.season.startedAt, 1)
    clock = kickoff - 30 * 60_000
    await drainServerQueue(app, dir, clock)
    const ownJob = jobs.find(j => [...j.home.team.lineup.starters, ...j.away.team.lineup.starters].some(p => p.playerId === ids[0]))!
    const locked = ownJob.home.team.lineup.starters.some(p => p.playerId === ids[0]) ? ownJob.home : ownJob.away
    expect(locked.chemistry![key]).toBeGreaterThan(0)
    expect(Object.keys(locked.chemistry!)).toHaveLength(1)
    clock = kickoff + 10 * 60_000
    await drainServerQueue(app, dir, clock)
    const after = await load()
    expect(after.game.chemistry![key]).toMatchObject({ minutes: 90, training: 0.5 })
    expect((await load()).game.chemistry![key].minutes).toBe(90)
    after.game.chemistry = stale
    expect((await save(after)).status).toBe(200)
    expect((await load()).game.chemistry![key]).toMatchObject({ minutes: 90, training: 0.5 })
    const legacy = await load()
    delete legacy.game.chemistry
    expect((await save(legacy)).status).toBe(200)
    expect((await load()).game.chemistry![key].minutes).toBe(90)
  })
})
