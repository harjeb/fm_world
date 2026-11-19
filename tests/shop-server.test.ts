import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { readStoredAccounts, writeStoredAccounts } from './account-storage-helpers.ts'
import { SHOP_BOOK_PRICE, shopCatalog, totalPeakShopPoints } from '../src/game/shop.ts'

const servers: AppServer[] = []
const dirs: string[] = []

async function start(dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-shop-test-')), now?: () => number) {
  if (!dirs.includes(dir)) dirs.push(dir)
  const app = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), tickMs: 0, now })
  servers.push(app)
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const port = (app.server.address() as AddressInfo).port
  return { app, base: `http://127.0.0.1:${port}`, dir }
}

async function register(base: string, username: string) {
  const res = await fetch(`${base}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'secret123' }),
  })
  expect(res.status).toBe(201)
  return res.json() as Promise<{ token: string; revision: number; game: Record<string, any> }>
}

afterEach(() => {
  for (const app of servers.splice(0)) app.close()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('联机服务器商店与巅峰点数补发', () => {
  it('同世界所有俱乐部共享同一批 10 本上架金书，且支持老账号巅峰之路自动补发、防篡改与原子兑换', async () => {
    const first = await start()
    const alice = await register(first.base, 'shop_alice')
    const bob = await register(first.base, 'shop_bob')

    // 全服共享同一批 12 本（8 外场 + 2 门将 + 2 辅助，基于共享世界种子）
    expect(alice.game.seed).toBe(bob.game.seed)
    const catalog = shopCatalog(alice.game.seed, alice.game.season.index)
    expect(catalog).toHaveLength(12)

    // 模拟老存档：重启前直接写入已通关巅峰之路第 25 关且无 shop 字段
    first.app.close()
    servers.pop()
    const stored = readStoredAccounts(first.dir)
    const aliceRow = stored.accounts.find((acc: any) => acc.username === 'shop_alice')!
    aliceRow.game.pve!.peak.cleared = 25
    delete aliceRow.game.shop
    writeStoredAccounts(first.dir, stored)

    // 重启并拉取存档：自动补发前 25 关商店点数（20*5 + 5*8 = 140 点）
    const restarted = await start(first.dir)
    const loginRes = await fetch(`${restarted.base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'shop_alice', password: 'secret123' }),
    })
    expect(loginRes.status).toBe(200)
    const { token } = await loginRes.json() as { token: string }

    const gameRes = await fetch(`${restarted.base}/api/game`, { headers: { Authorization: `Bearer ${token}` } })
    expect(gameRes.status).toBe(200)
    const loaded = await gameRes.json() as { revision: number; game: Record<string, any> }
    const expectedPts = totalPeakShopPoints(25)
    expect(expectedPts).toBe(420)
    expect(loaded.game.shop.points).toBe(expectedPts)
    expect(loaded.game.shop.peakClaimedStages).toHaveLength(25)
    expect(loaded.game.shop.lastPeakBackfill).toBe(expectedPts)

    // 客户端试图在 PUT /api/game 中伪造 99999 商店点数 → 服务器忽略并维持权威值
    const forged = structuredClone(loaded.game)
    forged.shop.points = 99999
    const putRes = await fetch(`${restarted.base}/api/game`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: forged, baseRevision: loaded.revision }),
    })
    expect(putRes.status).toBe(200)
    const afterPut = await (await fetch(`${restarted.base}/api/game`, { headers: { Authorization: `Bearer ${token}` } })).json() as { game: Record<string, any> }
    expect(afterPut.game.shop.points).toBe(expectedPts)

    // 通过 /api/shop/buy 正常兑换 1 本金书（140 → 40）
    const targetSkill = catalog[0].id
    const buyRes = await fetch(`${restarted.base}/api/shop/buy`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId: targetSkill }),
    })
    expect(buyRes.status).toBe(200)
    const bought = await buyRes.json() as { ok: boolean; points: number; book: { id: string; tier: string }; game: Record<string, any> }
    expect(bought.ok).toBe(true)
    expect(bought.points).toBe(expectedPts - SHOP_BOOK_PRICE)
    expect(bought.book).toEqual({ id: targetSkill, tier: 'gold' })
    expect(bought.game.legendBooks.some((b: any) => b.id === targetSkill && b.tier === 'gold')).toBe(true)

    // 重复买同一本被拒绝
    const dupRes = await fetch(`${restarted.base}/api/shop/buy`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId: targetSkill }),
    })
    expect(dupRes.status).toBe(400)

    // Agent API 可读取 shop 货架与点数，且可调用 buy_shop_book
    const tokenRes = await fetch(`${restarted.base}/api/agent/token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    const { token: agentToken } = await tokenRes.json() as { token: string }
    const agentStateRes = await fetch(`${restarted.base}/api/agent/state`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    })
    expect(agentStateRes.status).toBe(200)
    const agentState = await agentStateRes.json() as { game: Record<string, any> }
    expect(agentState.game.shop.points).toBe(expectedPts - SHOP_BOOK_PRICE)
    expect(agentState.game.shop.catalog).toHaveLength(12)
    expect(agentState.game.shop.catalog[0].owned).toBe(true)

    // 剩余 320 点可继续通过 Agent API 再买 1 本（320 -> 220）
    const agentBuy = await fetch(`${restarted.base}/api/agent/action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'buy_shop_book', skillId: catalog[1].id }),
    })
    expect(agentBuy.status).toBe(200)
    const agentBought = await agentBuy.json() as { ok: boolean; game: Record<string, any> }
    expect(agentBought.ok).toBe(true)
    expect(agentBought.game.shop.points).toBe(expectedPts - 2 * SHOP_BOOK_PRICE)
    expect(agentBought.game.shop.catalog[1].owned).toBe(true)
  })
})
