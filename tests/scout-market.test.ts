import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { GAME_DAY_MS } from '../src/game/calendar.ts'
import { FREE_MARKET_TARGET, refreshFreeMarket, refreshLocalFreeMarket, isLocalFreeAgentAvailable } from '../src/game/free-market.ts'
import { buyFreeAgent } from '../src/game/market.ts'
import { isOnMarketToday } from '../src/game/market-window.ts'
import { scoutKeepsOnMarket, startScouting } from '../src/game/scouting.ts'
import { economyOf } from '../src/game/economy.ts'
import { createWorldGame } from '../src/game/world.ts'
import { loadPveContent } from '../src/game/pve-content.ts'
import { minimumBid, AUCTION_DURATION_MS } from '../src/game/auction.ts'
import type { GameState, Player } from '../src/game/types.ts'

beforeAll(loadPveContent)
afterEach(() => vi.restoreAllMocks())

it('单机报告耗时与额外一天内保留补充球员，到期清理，签下后不复活', () => {
  const game = createWorldGame(1451)
  const t = game.world!.calendarStartAt! + 1000
  game.freeStars = []
  economyOf(game).balance = 100_000_000
  game.season.round = 1
  refreshLocalFreeMarket(game, t)
  const [p, q] = game.freeStars
  const r = startScouting(game, p, { source: 'market' }, 1, t).report!
  const s = startScouting(game, q, { source: 'market' }, 1, t).report!
  for (let d = 1; d <= 4; d++) {
    refreshLocalFreeMarket(game, t + d * GAME_DAY_MS)
    expect(game.freeStars.some(x => x.id === p.id)).toBe(true)
  }
  expect(scoutKeepsOnMarket(game, p.id, r.readyAt)).toBe(true)
  vi.spyOn(Date, 'now').mockReturnValue(r.readyAt)
  expect(buyFreeAgent(game, p.id).ok).toBe(true)
  refreshLocalFreeMarket(game, s.readyAt + GAME_DAY_MS)
  expect(game.freeStars.some(x => x.id === p.id || x.id === q.id)).toBe(false)
  expect(game.roster.some(x => x.id === p.id)).toBe(true)
  expect(scoutKeepsOnMarket(game, q.id, s.readyAt + GAME_DAY_MS)).toBe(false)
})

it('球星脱离挂牌日仍可谈；迁移后的报告时间和存档游戏日决定宽限', () => {
  const game = createWorldGame(1452)
  const t = game.world!.calendarStartAt! + 1000
  const star = game.freeStars.find(p => p.starKey)!
  const report = startScouting(game, star, { source: 'market' }, 1, t).report!
  const off = Array.from({ length: 28 }, (_, i) => t + i * GAME_DAY_MS).find(x => !isOnMarketToday(game, star, x))!
  report.startedAt = off - 100
  report.readyAt = off + 100
  game.season.gameDayMs = 12345
  expect(isLocalFreeAgentAvailable(game, star, off)).toBe(true)
  expect(isLocalFreeAgentAvailable(game, star, report.readyAt + 12344)).toBe(true)
  expect(isLocalFreeAgentAvailable(game, star, report.readyAt + 12345)).toBe(false)
})

it('刷新计数包含暂留及竞拍的非挂牌球员，但不会复活已离池球员', () => {
  const game = createWorldGame(1453)
  const t = game.world!.calendarStartAt! + 1000
  const star = game.freeStars.find(p => p.starKey)!
  const off = Array.from({ length: 28 }, (_, i) => t + i * GAME_DAY_MS).find(x => !isOnMarketToday(game, star, x))!
  game.freeStars = []
  refreshLocalFreeMarket(game, t)
  const [auctioned] = game.freeStars
  const bought = { ...game.freeStars[1], id: 'already-bought' }
  const report = startScouting(game, star, { source: 'market' }, 1, t).report!
  report.startedAt = off - 100
  report.readyAt = off + 100
  const oldFiller = { ...auctioned, marketDay: -1 }
  const busy = (id: string) => id === oldFiller.id || id === bought.id || scoutKeepsOnMarket(game, id, off)
  const result = refreshFreeMarket({ pool: [star, oldFiller], anchor: game, now: off, seed: game.seed, busy })
  expect(result.pool).toHaveLength(FREE_MARKET_TARGET)
  expect(result.pool.some(p => p.id === star.id)).toBe(true)
  expect(result.pool.some(p => p.id === oldFiller.id)).toBe(true)
  expect(result.pool.some(p => p.id === bought.id)).toBe(false)
})

it('联机任意账号的报告对全服生效，其他账号可竞拍，成交后跨日不复活', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-market-'))
  let app: AppServer | undefined
  let clock = 1_700_000_000_000
  try {
    app = createAppServer({ dataDir: dir, tickMs: 0, now: () => clock })
    await new Promise<void>(resolve => app!.server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
    const register = async (username: string) => (await (await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'secret123' }) })).json() as { token: string }).token
    const a = await register('market_scout_a'), b = await register('market_scout_b')
    const headers = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })
    const market = async () => await (await fetch(base + '/api/market')).json() as { pool: Player[] }
    const post = (url: string, token: string, body: unknown) => fetch(base + url, { method: 'POST', headers: headers(token), body: JSON.stringify(body) })
    const initial = await market()
    const [p, q] = initial.pool.filter(x => x.marketDay !== undefined && minimumBid(x) < 450000)
    expect(p).toBeDefined(); expect(q).toBeDefined()
    for (const player of [p, q]) expect((await post('/api/scouting/start', a, { source: 'market', playerId: player.id, level: 1 })).status).toBe(200)
    const state = await (await fetch(base + '/api/game', { headers: headers(a) })).json() as { game: GameState }
    const report = state.game.scoutReports!.find(r => r.playerId === p.id)!
    clock = report.readyAt
    expect((await market()).pool.some(x => x.id === p.id)).toBe(true)
    const bid = await post('/api/market/bid', b, { playerId: p.id, amount: minimumBid(p) })
    expect(bid.status).toBe(200)
    const raised = Math.ceil(minimumBid(p) * 1.05)
    expect((await post('/api/market/bid', a, { playerId: p.id, amount: raised })).status).toBe(200)
    clock += AUCTION_DURATION_MS + 1
    expect((await market()).pool.some(x => x.id === p.id)).toBe(false)
    clock = report.readyAt + state.game.season.gameDayMs
    expect((await market()).pool.some(x => x.id === q.id)).toBe(false)
    clock += 2 * GAME_DAY_MS
    expect((await market()).pool.some(x => x.id === p.id)).toBe(false)
  } finally {
    if (app) await app.shutdown()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}, 120_000)
