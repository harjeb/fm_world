import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { AUCTION_DURATION_MS, AUCTION_EXTEND_MS, absorbFreeAgents, committedFunds, leadingBid, minimumBid, placeBid, settleAuctions, type FreeMarket } from '../src/game/auction.ts'
import { economyOf } from '../src/game/economy.ts'
import { SQUAD_LIMIT, playerMarketValue, releasePlayer, squadLimitError } from '../src/game/market.ts'
import { createWorldGame } from '../src/game/world.ts'
import type { GameState } from '../src/game/types.ts'

/* ---------- 规则 ---------- */

function setup() {
  const a = createWorldGame(41)
  const b = createWorldGame(41, 'd2n_02')
  const pool = a.freeStars
  a.freeStars = []
  b.freeStars = []
  economyOf(a).balance = 10_000_000
  economyOf(b).balance = 10_000_000
  const market: FreeMarket = { pool, auctions: [], log: [], version: 1 }
  const games: Record<string, GameState> = { a, b }
  return { market, a, b, games, player: pool[0], value: playerMarketValue(pool[0]) }
}

describe('竞拍规则', () => {
  it('第一口价按估值起拍，开始 5 分钟倒计时', () => {
    const { market, a, player, value } = setup()
    expect(placeBid(market, a, 'a', player.id, value - 1, 1000).ok).toBe(false)
    const bid = placeBid(market, a, 'a', player.id, value, 1000)
    expect(bid.ok).toBe(true)
    expect(market.auctions).toHaveLength(1)
    expect(market.auctions[0].endsAt).toBe(1000 + AUCTION_DURATION_MS)
    expect(leadingBid(market.auctions[0])).toMatchObject({ accountId: 'a', amount: value, club: a.clubName })
    // 出价时钱不扣，球员也还在市场。
    expect(economyOf(a).balance).toBe(10_000_000)
    expect(market.pool.some((item) => item.id === player.id)).toBe(true)
  })

  it('加价至少 5%；自己不能抬自己的价', () => {
    const { market, a, b, player, value } = setup()
    placeBid(market, a, 'a', player.id, value, 1000)
    const minimum = minimumBid(player, market.auctions[0])
    expect(minimum).toBe(Math.ceil(value * 1.05))
    expect(placeBid(market, b, 'b', player.id, minimum - 1, 2000).ok).toBe(false)
    const raised = placeBid(market, b, 'b', player.id, minimum, 2000)
    expect(raised).toMatchObject({ ok: true, outbid: 'a' })
    const again = placeBid(market, b, 'b', player.id, minimum * 2, 3000)
    expect(again).toMatchObject({ ok: false, error: '你已经是最高出价' })
  })

  it('最后 1 分钟有人加价，倒计时回到 1 分钟；时间还多时不延长', () => {
    const { market, a, b, player, value } = setup()
    placeBid(market, a, 'a', player.id, value, 0)
    const original = market.auctions[0].endsAt
    placeBid(market, b, 'b', player.id, minimumBid(player, market.auctions[0]), 1000)
    expect(market.auctions[0].endsAt).toBe(original)
    const late = original - 5000
    placeBid(market, a, 'a', player.id, minimumBid(player, market.auctions[0]), late)
    expect(market.auctions[0].endsAt).toBe(late + AUCTION_EXTEND_MS)
  })

  it('领先的出价占用余额：同一笔钱不能同时拍两个人', () => {
    const { market, a, player, value } = setup()
    const other = market.pool[1]
    economyOf(a).balance = value + 10
    expect(placeBid(market, a, 'a', player.id, value, 0).ok).toBe(true)
    expect(committedFunds(market.auctions, 'a')).toBe(value)
    const second = placeBid(market, a, 'a', other.id, playerMarketValue(other), 0)
    expect(second.ok).toBe(false)
    expect(second).toMatchObject({ error: expect.stringContaining('占用') })
  })

  it('被超过之后钱就空出来了', () => {
    const { market, a, b, player, value } = setup()
    const other = market.pool[1]
    economyOf(a).balance = Math.max(value, playerMarketValue(other)) + 10
    placeBid(market, a, 'a', player.id, value, 0)
    placeBid(market, b, 'b', player.id, minimumBid(player, market.auctions[0]), 1)
    expect(committedFunds(market.auctions, 'a')).toBe(0)
    expect(placeBid(market, a, 'a', other.id, playerMarketValue(other), 2).ok).toBe(true)
  })

  it('签人可以超编，超出 25 人时由开赛前的阵容检查拦下', () => {
    const { market, a, player, value } = setup()
    const other = market.pool[1]
    const spare = structuredClone(a.roster[0])
    while (a.roster.length < SQUAD_LIMIT + 1) a.roster.push({ ...structuredClone(spare), id: `extra-${a.roster.length}` })
    economyOf(a).balance = Math.max(value, playerMarketValue(other)) * 2
    expect(placeBid(market, a, 'a', player.id, value, 0).ok).toBe(true)
    expect(squadLimitError(a)).toContain('超过')
  })

  it('无效出价和不在市场的球员都被拒绝，转会窗关闭时也不能出价', () => {
    const { market, a, player, value } = setup()
    expect(placeBid(market, a, 'a', 'nobody', value, 0).ok).toBe(false)
    for (const amount of [Number.NaN, -5, 0, 1.5, Number.MAX_VALUE]) expect(placeBid(market, a, 'a', player.id, amount, 0).ok, String(amount)).toBe(false)
    a.season.round = 15
    expect(placeBid(market, a, 'a', player.id, value, 0)).toMatchObject({ ok: false, error: '转会窗口已关闭' })
  })

  it('时间到最高价者得：扣钱、进阵容、离开市场、记录成交', () => {
    const { market, a, b, games, player, value } = setup()
    placeBid(market, a, 'a', player.id, value, 0)
    const price = minimumBid(player, market.auctions[0])
    placeBid(market, b, 'b', player.id, price, 1)
    expect(settleAuctions(market, (id) => games[id], AUCTION_DURATION_MS - 1)).toEqual([])
    const [settled] = settleAuctions(market, (id) => games[id], AUCTION_DURATION_MS)
    expect(settled.winnerId).toBe('b')
    expect(economyOf(b).balance).toBe(10_000_000 - price)
    expect(economyOf(a).balance).toBe(10_000_000)
    expect(b.roster.some((item) => item.id === player.id)).toBe(true)
    expect(b.roster.find((item) => item.id === player.id)?.contract?.clubId).toBe('player')
    expect(a.roster.some((item) => item.id === player.id)).toBe(false)
    expect(market.pool.some((item) => item.id === player.id)).toBe(false)
    expect(market.auctions).toEqual([])
    expect(market.log[0]).toMatchObject({ playerId: player.id, club: b.clubName, amount: price })
    expect(market.version).toBe(2)
  })

  it('最高价者买不起时顺延给下一个出价的人', () => {
    const { market, a, b, games, player, value } = setup()
    placeBid(market, a, 'a', player.id, value, 0)
    placeBid(market, b, 'b', player.id, minimumBid(player, market.auctions[0]), 1)
    economyOf(b).balance = 5
    const [settled] = settleAuctions(market, (id) => games[id], AUCTION_DURATION_MS)
    expect(settled.winnerId).toBe('a')
    expect(economyOf(a).balance).toBe(10_000_000 - value)
    expect(economyOf(b).balance).toBe(5)
  })

  it('所有出价的人都买不起时流拍，球员回到市场可以重新竞拍', () => {
    const { market, a, games, player, value } = setup()
    placeBid(market, a, 'a', player.id, value, 0)
    economyOf(a).balance = 0
    const [settled] = settleAuctions(market, (id) => games[id], AUCTION_DURATION_MS)
    expect(settled.winnerId).toBeNull()
    expect(market.pool.some((item) => item.id === player.id)).toBe(true)
    expect(market.auctions).toEqual([])
    expect(market.log[0]).toMatchObject({ playerId: player.id, club: null })
  })

  it('赢家正在踢友谊赛时等比赛结束再结算，联赛不用等', () => {
    const { market, a, games, player, value } = setup()
    placeBid(market, a, 'a', player.id, value, 0)
    a.activeMatch = { context: { isLeague: false } } as never
    expect(settleAuctions(market, (id) => games[id], AUCTION_DURATION_MS)).toEqual([])
    expect(market.auctions).toHaveLength(1)
    a.activeMatch = { context: { isLeague: true } } as never
    expect(settleAuctions(market, (id) => games[id], AUCTION_DURATION_MS)).toHaveLength(1)
  })

  it('自己练过的球员，起拍价按最好的卡算，不能低价卖掉再低价买回', () => {
    const { market, a } = setup()
    const player = market.pool.find((item) => item.positions.GK === 0)!
    const value = playerMarketValue(player)
    a.cards = [{ id: 'c', serial: 1, playerId: player.id, attrs: { ...player.attrs, passing: 1500, shooting: 1500, dribbling: 1500 }, positions: player.positions } as never]
    expect(placeBid(market, a, 'a', player.id, value, 0).ok).toBe(false)
    const strong = playerMarketValue(a.cards![0])
    expect(strong).toBeGreaterThan(value)
    economyOf(a).balance = strong * 2
    expect(placeBid(market, a, 'a', player.id, strong, 0).ok).toBe(true)
  })

  it('账号放出来的球员进市场；已经在市场或被别人签走的不重复', () => {
    const { market, a, player } = setup()
    const released = a.roster.find((item) => item.era === 'random')!
    expect(releasePlayer(a, released.id).ok).toBe(true)
    a.freeStars.push(structuredClone(player))
    const version = market.version
    expect(absorbFreeAgents(market, a, () => false)).toBe(true)
    expect(a.freeStars).toEqual([])
    expect(market.pool.filter((item) => item.id === released.id)).toHaveLength(1)
    expect(market.pool.filter((item) => item.id === player.id)).toHaveLength(1)
    expect(market.version).toBe(version + 1)
    const taken = structuredClone(a.roster.find((item) => item.era === 'random')!)
    a.freeStars.push(taken)
    absorbFreeAgents(market, a, (id) => id === taken.id)
    expect(market.pool.some((item) => item.id === taken.id)).toBe(false)
  })
})

/* ---------- 服务器 ---------- */

const servers: AppServer[] = []
const dirs: string[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

async function start(now: () => number, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-auction-'))) {
  if (!dirs.includes(dir)) dirs.push(dir)
  const app = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), tickMs: 0, now })
  servers.push(app)
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  return { app, base: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`, dir }
}

async function register(base: string, username: string) {
  const response = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'secret123' }) })
  expect(response.status).toBe(201)
  const data = await response.json() as { token: string; user: { id: string }; revision: number; game: GameState }
  return { ...data, headers: { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' } }
}

const getMarket = async (base: string) => (await fetch(`${base}/api/market`)).json() as Promise<{ pool: GameState['freeStars']; auctions: FreeMarket['auctions']; log: FreeMarket['log']; version: number; serverTime: number }>
const bid = (base: string, headers: Record<string, string>, playerId: string, amount: number) => fetch(`${base}/api/market/bid`, { method: 'POST', headers, body: JSON.stringify({ playerId, amount }) })
const getGame = async (base: string, headers: Record<string, string>) => (await fetch(`${base}/api/game`, { headers })).json() as Promise<{ game: GameState; revision: number }>

/** 读 SSE，直到等到符合条件的消息。 */
async function waitForEvent(base: string, token: string, match: (data: Record<string, unknown>) => boolean, trigger: () => Promise<unknown>): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const response = await fetch(`${base}/api/events?token=${token}`, { signal: controller.signal })
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let triggered = false
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) throw new Error('SSE 断开')
      buffer += decoder.decode(value, { stream: true })
      let index
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        if (!chunk.startsWith('data: ')) continue
        const data = JSON.parse(chunk.slice(6)) as Record<string, unknown>
        if (triggered && match(data)) return data
        if (!triggered && data.type === 'market') {
          triggered = true
          await trigger()
        }
      }
    }
  } finally {
    controller.abort()
  }
}

describe('全服自由市场', () => {
  it('新账号没有自己的一份，所有人看到同一个球员池；不用登录也能看', async () => {
    const { base } = await start(() => 1_000_000)
    const one = await register(base, 'alpha')
    const two = await register(base, 'bravo')
    expect(one.game.freeStars).toEqual([])
    expect(two.game.freeStars).toEqual([])
    const market = await getMarket(base)
    // 球星只在挂牌日出现，所以看到的是 250 人里的一个子集。
    expect(market.pool.length).toBeGreaterThan(0)
    expect(market.pool.length).toBeLessThanOrEqual(250)
    expect(market.auctions).toEqual([])
  })

  it('一个人出价，另一个人加价，时间到后最高价者签下；全服都看得到结果', async () => {
    let clock = 1_000_000
    const { base } = await start(() => clock)
    const one = await register(base, 'alpha')
    const two = await register(base, 'bravo')
    const { pool } = await getMarket(base)
    const cheapest = [...pool].sort((a, b) => playerMarketValue(a) - playerMarketValue(b))
    const player = cheapest[0]
    const value = playerMarketValue(player)

    expect((await bid(base, one.headers, player.id, value)).status).toBe(200)
    let market = await getMarket(base)
    expect(market.auctions[0]).toMatchObject({ playerId: player.id, endsAt: clock + AUCTION_DURATION_MS })
    expect(leadingBid(market.auctions[0]).club).toBe(one.game.clubName)

    const low = await bid(base, two.headers, player.id, value)
    expect(low.status).toBe(400)
    const price = minimumBid(player, market.auctions[0])
    expect((await bid(base, two.headers, player.id, price)).status).toBe(200)

    clock += AUCTION_DURATION_MS + 1
    market = await getMarket(base)
    expect(market.auctions).toEqual([])
    expect(market.pool.some((item) => item.id === player.id)).toBe(false)
    expect(market.log[0]).toMatchObject({ playerId: player.id, club: two.game.clubName, amount: price })

    const winner = await getGame(base, two.headers)
    expect(winner.game.roster.some((item) => item.id === player.id)).toBe(true)
    expect(economyOf(winner.game).balance).toBeLessThan(economyOf(two.game).balance)
    const loser = await getGame(base, one.headers)
    expect(loser.game.roster.some((item) => item.id === player.id)).toBe(false)
    expect(economyOf(loser.game).balance).toBeGreaterThanOrEqual(economyOf(one.game).balance)
  })

  it('一个人出价，所有在线的人都实时收到', async () => {
    const { base } = await start(() => 1_000_000)
    const one = await register(base, 'alpha')
    const two = await register(base, 'bravo')
    const { pool } = await getMarket(base)
    const target = [...pool].sort((a, b) => playerMarketValue(a) - playerMarketValue(b))[0]
    const message = await waitForEvent(base, two.token, (data) => data.type === 'market' && (data.auctions as unknown[]).length === 1, () => bid(base, one.headers, target.id, playerMarketValue(target)))
    const [auction] = message.auctions as FreeMarket['auctions']
    expect(auction.playerId).toBe(target.id)
    expect(leadingBid(auction).club).toBe(one.game.clubName)
  })

  it('赢家的存档实时更新，被放出来的球员也实时进市场', async () => {
    let clock = 1_000_000
    const { base } = await start(() => clock)
    const one = await register(base, 'alpha')
    const { pool } = await getMarket(base)
    const target = [...pool].sort((a, b) => playerMarketValue(a) - playerMarketValue(b))[0]
    await bid(base, one.headers, target.id, playerMarketValue(target))
    clock += AUCTION_DURATION_MS + 1
    const state = await waitForEvent(base, one.token, (data) => data.type === 'state', () => getMarket(base))
    expect((state.game as GameState).roster.some((item) => item.id === target.id)).toBe(true)

    // 客户端把球员解约后保存，这名球员进全服市场，账号存档里不留。
    const current = await getGame(base, one.headers)
    const released = current.game.roster.find((item) => item.era === 'random')!
    expect(releasePlayer(current.game, released.id).ok).toBe(true)
    const put = await fetch(`${base}/api/game`, { method: 'PUT', headers: one.headers, body: JSON.stringify({ game: current.game, baseRevision: current.revision }) })
    expect(put.status).toBe(200)
    expect((await getMarket(base)).pool.some((item) => item.id === released.id)).toBe(true)
    expect((await getGame(base, one.headers)).game.freeStars).toEqual([])
  })

  it('客户端改不了市场：存档里塞回别人签走的人不会进市场', async () => {
    let clock = 1_000_000
    const { base } = await start(() => clock)
    const one = await register(base, 'alpha')
    const two = await register(base, 'bravo')
    const { pool } = await getMarket(base)
    const target = [...pool].sort((a, b) => playerMarketValue(a) - playerMarketValue(b))[0]
    await bid(base, one.headers, target.id, playerMarketValue(target))
    clock += AUCTION_DURATION_MS + 1
    await getMarket(base)
    const current = await getGame(base, two.headers)
    current.game.freeStars = [structuredClone(target)]
    await fetch(`${base}/api/game`, { method: 'PUT', headers: two.headers, body: JSON.stringify({ game: current.game, baseRevision: current.revision }) })
    expect((await getMarket(base)).pool.some((item) => item.id === target.id)).toBe(false)
  })

  it('没登录不能出价；比赛进行中不能出价', async () => {
    const { base } = await start(() => 1_000_000)
    const one = await register(base, 'alpha')
    const { pool } = await getMarket(base)
    const anonymous = await fetch(`${base}/api/market/bid`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: pool[0].id, amount: 1 }) })
    expect(anonymous.status).toBe(401)
    const bad = await bid(base, one.headers, 'nobody', 100)
    expect(bad.status).toBe(400)
  })

  it('重启服务器后竞拍和球员池都还在，到点照常结算', async () => {
    let clock = 1_000_000
    const first = await start(() => clock)
    const one = await register(first.base, 'alpha')
    const { pool } = await getMarket(first.base)
    const cheapest = [...pool].sort((a, b) => playerMarketValue(a) - playerMarketValue(b))[0]
    await bid(first.base, one.headers, cheapest.id, playerMarketValue(cheapest))
    const before = (await getMarket(first.base)).pool.length
    servers.splice(0).forEach((server) => server.close())
    const second = await start(() => clock, first.dir)
    let market = await getMarket(second.base)
    expect(market.auctions).toHaveLength(1)
    expect(market.pool.length).toBe(before)
    clock += AUCTION_DURATION_MS + 1
    market = await getMarket(second.base)
    expect(market.auctions).toEqual([])
    expect(market.pool.length).toBe(before - 1)
  })

  it('老账号里各有一份自由球员时，并进全服市场，已经被人买走的不再出现', async () => {
    const clock = 1_000_000
    const first = await start(() => clock)
    const one = await register(first.base, 'alpha')
    const { pool } = await getMarket(first.base)
    servers.splice(0).forEach((server) => server.close())
    // 模拟老存档：账号里有一份自由球员，其中一人已经买进阵容。
    const dbPath = path.join(first.dir, 'accounts.json')
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8')) as { accounts: { game: GameState }[] }
    db.accounts[0].game.freeStars = structuredClone(pool.slice(1))
    db.accounts[0].game.roster.push(structuredClone(pool[0]))
    fs.writeFileSync(dbPath, JSON.stringify(db))
    const second = await start(() => clock, first.dir)
    const market = await getMarket(second.base)
    expect(market.pool.some((item) => item.id === pool[0].id)).toBe(false)
    expect(market.pool.length).toBeLessThanOrEqual(250)
    const again = await fetch(`${second.base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'alpha', password: 'secret123' }) })
    const logged = await again.json() as { game: GameState }
    expect(logged.game.freeStars).toEqual([])
    expect(one.user.id).toBeTruthy()
  })

  it('Agent：看得到竞拍，用 bid_free_agent 出价，buy_free_agent 被拒绝', async () => {
    const { base } = await start(() => 1_000_000)
    const one = await register(base, 'alpha')
    const { token } = await (await fetch(`${base}/api/agent/token`, { method: 'POST', headers: one.headers })).json() as { token: string }
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const state = await (await fetch(`${base}/api/agent/state`, { headers })).json() as { game: { market: { freeAgents: { player: { id: string }; price: number }[]; auctions: unknown[] } } }
    expect(state.game.market.freeAgents.length).toBeGreaterThan(0)
    const target = [...state.game.market.freeAgents].sort((a, b) => a.price - b.price)[0]
    const refused = await fetch(`${base}/api/agent/action`, { method: 'POST', headers, body: JSON.stringify({ action: 'buy_free_agent', playerId: target.player.id }) })
    expect(refused.status).toBe(400)
    const placed = await fetch(`${base}/api/agent/action`, { method: 'POST', headers, body: JSON.stringify({ action: 'bid_free_agent', playerId: target.player.id, amount: target.price }) })
    expect(placed.status).toBe(200)
    const after = await placed.json() as { game: { market: { auctions: { playerId: string; leadingIsYou: boolean; secondsLeft: number; currentBid: number }[] } } }
    expect(after.game.market.auctions[0]).toMatchObject({ playerId: target.player.id, leadingIsYou: true, currentBid: target.price, secondsLeft: AUCTION_DURATION_MS / 1000 })
  })
})
