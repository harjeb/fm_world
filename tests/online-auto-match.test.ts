import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { createWorldGame } from '../src/game/world.ts'
import { nextMatchCountdown, playerFixture, roundKickoffAt, settleDuePlayerMatch } from '../src/game/season.ts'
import { kickoffAtForRound } from '../src/game/calendar.ts'
import type { GameState } from '../src/game/types.ts'
import { drainServerQueue, fastMatchResult } from './queued-server-helpers.ts'

const servers: AppServer[] = [], dirs: string[] = []
afterEach(() => { while (servers.length) servers.pop()!.close(); while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true }) })

describe('联机联赛到点自动结算', () => {
  it('离线用的单场结算函数：开赛前不结算，到点踢并写进战报；重复调用不会多踢一场', () => {
    const game = createWorldGame(11, undefined, undefined, 1_000_000)
    const kickoff = roundKickoffAt(game, game.season.round)
    expect(settleDuePlayerMatch(game, kickoff - 1)).toBeNull()
    expect(playerFixture(game)!.played).toBe(false)
    const record = settleDuePlayerMatch(game, kickoff)
    expect(record).not.toBeNull()
    expect(record!.autoSimulated).toBe(true)
    expect(playerFixture(game)!.played).toBe(true)
    expect(playerFixture(game)!.autoSimulated).toBe(true)
    expect(game.matchHistory[0]).toBe(record)
    expect(settleDuePlayerMatch(game, kickoff + 1000)).toBeNull()
    expect(game.matchHistory).toHaveLength(1)
  })

  it('注册不产生比赛，服务器后台提前计算；到点才公布，玩家不能手动开赛', async () => {
    let clock = Date.UTC(2026, 10, 9, 8, 15) // 北京时间 16:15
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-auto-match-')); dirs.push(dataDir)
    const app = createAppServer({ dataDir, staticDir: path.resolve('dist'), tickMs: 0, now: () => clock, matchQueue: { intervalMs: 0, compute: fastMatchResult } })
    servers.push(app)
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
    const registered = await (await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'auto_match', password: 'secret123' }) })).json() as { token: string; game: GameState; revision: number }
    const auth = { Authorization: `Bearer ${registered.token}`, 'Content-Type': 'application/json' }
    const load = async () => await (await fetch(`${base}/api/game`, { headers: auth })).json() as { game: GameState }
    const first = await load()
    expect(playerFixture(first.game)!.played).toBe(false)
    expect(first.game.matchHistory).toHaveLength(0)
    expect(first.game.activeMatch).toBeUndefined()
    expect(nextMatchCountdown(first.game, clock)).toBe('3 小时 45 分')
    expect(first.game.settings).not.toHaveProperty('autoSettle')
    clock += 30 * 60_000
    expect((await load()).game.matchHistory).toHaveLength(0)
    expect(nextMatchCountdown((await load()).game, clock)).toBe('3 小时 15 分')
    clock = Date.UTC(2026, 10, 9, 11, 30)
    await drainServerQueue(app, dataDir, clock)
    expect(playerFixture((await load()).game)!.played).toBe(false)
    clock = Date.UTC(2026, 10, 9, 12)
    await drainServerQueue(app, dataDir, clock)
    const atKickoff = await load()
    expect(playerFixture(atKickoff.game)!.played).toBe(true)
    expect(atKickoff.game.matchHistory).toHaveLength(1)
    expect(registered.game.world!.seasonStartedAt).toBe(Date.UTC(2026, 10, 9, 12))
    clock = kickoffAtForRound(registered.game.world!.seasonStartedAt, 2)
    await drainServerQueue(app, dataDir, clock)
    const second = await load()
    expect(second.game.season.round).toBe(2)
    expect(playerFixture(second.game, 2)!.played).toBe(true)
    expect(second.game.matchHistory).toHaveLength(2)
    expect((await load()).game.matchHistory).toEqual(second.game.matchHistory)
    const manual = await fetch(`${base}/api/match/action`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'start_league' }) })
    expect(manual.status).toBe(400)
  })
})
