import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { expect, it } from 'vitest'
import { createAppServer, type AppServer } from '../server/app.ts'
import { drainServerQueue, fastMatchResult } from './queued-server-helpers.ts'
import type { GameState } from '../src/game/types.ts'
import { LEAGUE_REALTIME_MS } from '../src/game/match/time.ts'
import { AUCTION_DURATION_MS, minimumBid } from '../src/game/auction.ts'

it('同区两名教练共用整轮定稿；冠军联赛独立出刊，重启和后续成交不改稿', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-edition-'))
  let clock = Date.UTC(2026, 10, 1), app: AppServer | undefined
  async function start() {
    app = createAppServer({ dataDir: dir, tickMs: 0, now: () => clock, matchQueue: { intervalMs: 0, compute: fastMatchResult } })
    await new Promise<void>(resolve => app!.server.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
  }
  let base = await start()
  const register = async (username: string, clubId: string) => {
    const r = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, clubId, password: 'secret123' }) })
    expect(r.status).toBe(201)
    return r.json() as Promise<{token: string; game: GameState}>
  }
  const load = async (token: string) => {
    const r = await fetch(`${base}/api/game`, { headers: { Authorization: `Bearer ${token}`, 'X-FM-Slim': '1' } })
    expect(r.status).toBe(200)
    return (await r.json() as {game: GameState}).game.world!.newsEditions
  }
  try {
    const a = await register('coach_alpha', 'd2n_01'), b = await register('coach_bravo', 'd2n_02')
    const region = a.game.season.divisionId!
    expect(b.game.season.divisionId).toBe(region)
    expect(await load(a.token)).toBeUndefined()
    const buy = async () => {
      const { pool } = await (await fetch(`${base}/api/market`)).json() as {pool: GameState['freeStars']}
      const p = pool.sort((x, y) => minimumBid(x) - minimumBid(y))[0]
      const r = await fetch(`${base}/api/market/bid`, { method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: p.id, amount: minimumBid(p) }) })
      expect(r.status).toBe(200)
      clock += AUCTION_DURATION_MS + 1
      const market = await (await fetch(`${base}/api/market`)).json()
      expect(market.log[0]).toMatchObject({ playerId: p.id, club: a.game.clubName })
      return p.name
    }
    const player = await buy()
    const kickoff = a.game.season.startedAt
    clock = kickoff + LEAGUE_REALTIME_MS - 1
    await app!.runMatchQueue()
    expect(await load(b.token)).toBeUndefined()
    clock += 1
    await drainServerQueue(app!, dir, clock)
    const editions = (await load(a.token))!
    expect(editions).toEqual(await load(b.token))
    expect(editions[region].round).toBe(1)
    expect(editions[region].matches.length + editions[region].transfers.length).toBe(4)
    expect(editions[region].transfers[0].detail).toContain(player)
    expect(editions.champions.matches).toHaveLength(4)
    expect(editions.champions.matches).not.toEqual(editions[region].matches)
    await buy()
    expect(await load(b.token)).toEqual(editions)
    await app!.shutdown(); base = await start()
    expect(await load(a.token)).toEqual(editions)
  } finally {
    await app?.shutdown(); fs.rmSync(dir, { recursive: true, force: true })
  }
})
