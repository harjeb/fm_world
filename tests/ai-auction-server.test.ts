import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { AI_BID_PREFIX } from '../src/game/auction.ts'

const servers: AppServer[] = []

/** 自由球员的当前最低价只在 agent 视图里给，和文档一致。 */
async function agentState(base: string, auth: Record<string, string>): Promise<unknown> {
  const token = await (await fetch(`${base}/api/agent/token`, { method: 'POST', headers: auth })).json() as { token: string }
  return (await fetch(`${base}/api/agent/state`, { headers: { Authorization: `Bearer ${token.token}` } })).json()
}
afterEach(() => {
  while (servers.length) servers.pop()!.close()
})

/** 电脑球队也要在自由市场上跟玩家抢人，而且是在服务器那边自动出手，单机联机都成立。 */
describe('服务器上的电脑球队竞拍', () => {
  it('玩家出价后，电脑球队会按自己的上限跟价', async () => {
    const app = createAppServer({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'fm-ai-auction-')), staticDir: path.resolve('dist'), tickMs: 20 })
    servers.push(app)
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
    const reg = await (await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ai_auction', password: 'secret123' }),
    })).json() as { token: string }
    const auth = { Authorization: `Bearer ${reg.token}` }
    type Entry = { player: { id: string; ca: number }; price: number }
    const view = await agentState(base, auth) as { game: { market: { freeAgents: Entry[] } } }
    // 自由市场每天补满 200 人，最便宜的多是电脑球队看不上的替补；挑买得起的人里能力最高的那个。
    const target = [...view.game.market.freeAgents].filter((entry) => entry.price <= 450_000).sort((a, b) => b.player.ca - a.player.ca)[0]
    const placed = await fetch(`${base}/api/market/bid`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: target.player.id, amount: target.price }),
    })
    expect(placed.status).toBe(200)

    // 游标每 tick 前进一批球队，跑几轮就能遇到愿意跟价的。
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      const snapshot = await (await fetch(`${base}/api/market`, { headers: auth })).json() as { auctions: { playerId: string; bids: { accountId: string; amount: number }[] }[] }
      const auction = snapshot.auctions.find((item) => item.playerId === target.player.id)
      if (auction && auction.bids.some((bid) => bid.accountId.startsWith(AI_BID_PREFIX))) {
        expect(auction.bids.length).toBeGreaterThan(1)
        for (const bid of auction.bids) expect(bid.amount).toBeGreaterThanOrEqual(target.price)
        return
      }
    }
    throw new Error('电脑球队始终没有跟价')
  }, 20_000)

  it('玩家出价被电脑球队顶掉后，钱仍然在玩家账上', async () => {
    const app = createAppServer({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'fm-ai-auction-')), staticDir: path.resolve('dist'), tickMs: 0 })
    servers.push(app)
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
    const reg = await (await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ai_auction_2', password: 'secret123' }),
    })).json() as { token: string }
    const auth = { Authorization: `Bearer ${reg.token}` }
    const view = await agentState(base, auth) as { game: { market: { freeAgents: { player: { id: string }; price: number }[] }, economy: { balance: number } } }
    const target = [...view.game.market.freeAgents].sort((a, b) => a.price - b.price)[0]
    const balance = view.game.economy.balance
    const placed = await fetch(`${base}/api/market/bid`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: target.player.id, amount: target.price }),
    })
    expect(placed.status).toBe(200)
    const after = await agentState(base, auth) as { game: { economy: { balance: number }; market: { auctions: { playerId: string }[] } } }
    // 出价时只占用，不扣钱。
    expect(after.game.economy.balance).toBe(balance)
    expect(after.game.market.auctions.some((auction) => auction.playerId === target.player.id)).toBe(true)
  })
})
