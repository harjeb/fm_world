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
const dirs: string[] = []
afterEach(() => {
  while (servers.length) servers.pop()!.close()
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** 电脑球队也要在自由市场上跟玩家抢人，而且是在服务器那边自动出手，单机联机都成立。 */
describe('服务器上的电脑球队竞拍', () => {
  it('同一轮多于三家 AI 同时开拍，玩家仍可与它们竞价', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-ai-auction-'))
    dirs.push(dataDir)
    const app = createAppServer({ dataDir, staticDir: path.resolve('dist'), tickMs: 0 })
    servers.push(app)
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
    await fetch(base + '/api/market')
    app.runMarketTick()
    const reg = await (await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ai_auction', password: 'secret123' }),
    })).json() as { token: string }
    const auth = { Authorization: `Bearer ${reg.token}` }
    type Running = {playerId: string; bids: {amount: number; accountId: string}[]}
    const snapshot = await (await fetch(base + '/api/market')).json() as { auctions: Running[] }
    expect(snapshot.auctions.length).toBeGreaterThan(3)
    const buyers = new Set(snapshot.auctions.flatMap(a => a.bids.map(b => b.accountId)))
    expect([...buyers].filter(id => id.startsWith(AI_BID_PREFIX)).length).toBeGreaterThan(3)
    const cheap = [...snapshot.auctions].sort((a, b) => a.bids.at(-1)!.amount - b.bids.at(-1)!.amount)[0]
    const price = Math.ceil(cheap.bids.at(-1)!.amount * 1.05)
    const placed = await fetch(base + '/api/market/bid', { method: 'POST', headers: auth, body: JSON.stringify({playerId: cheap.playerId, amount: price}) })
    expect(placed.status).toBe(200)
    const after = await (await fetch(base + '/api/market')).json() as { auctions: Running[] }
    expect(after.auctions.find(a => a.playerId === cheap.playerId)!.bids.at(-1)!.amount).toBe(price)
  }, 20_000)

  it('玩家出价被电脑球队顶掉后，钱仍然在玩家账上', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-ai-auction-'))
    dirs.push(dataDir)
    const app = createAppServer({ dataDir, staticDir: path.resolve('dist'), tickMs: 0 })
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
