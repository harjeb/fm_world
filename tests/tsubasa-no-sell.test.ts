import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { absorbFreeAgents, type FreeMarket } from '../src/game/auction.ts'
import { isTsubasaPlayer } from '../src/game/data/tsubasa-specials.ts'
import { bestMarketValue, buyFromClub, listPlayer, sellerSquadError, settleMarket } from '../src/game/market.ts'
import { buildPeakTeam } from '../src/game/peak.ts'
import { claimPeakReward } from '../src/game/peak-reward.ts'
import { loadPveContent } from '../src/game/pve-content.ts'
import { createInitialGame } from '../src/game/state.ts'
import { expireOffers, generateAIOffers, localMarketClubs, respondToOffer } from '../src/game/transfers.ts'
import { createWorldGame } from '../src/game/world.ts'

beforeAll(loadPveContent)
const servers: AppServer[] = []
const dirs: string[] = []
afterEach(() => {
  for (const app of servers.splice(0)) app.close()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('足球小将全明星不允许出售', () => {
  it('准确识别足球小将联动角色而不误伤普通真实球星与随机球员', () => {
    const team = buildPeakTeam(50)
    expect(team.players.every((p) => isTsubasaPlayer(p))).toBe(true)

    const game = createInitialGame(123)
    game.pve!.peak.cleared = 50
    const claim = claimPeakReward(game, team.players[0].id)
    expect(claim.ok).toBe(true)
    if (claim.ok) expect(isTsubasaPlayer(claim.player)).toBe(true)

    const regular = game.roster.find((p) => !!p.starKey && !p.seedId?.startsWith('legend-captain-tsubasa-all-stars-')) ?? game.freeStars.find((p) => !!p.starKey)!
    expect(isTsubasaPlayer(regular)).toBe(false)
    const rnd = game.roster.find((p) => !p.starKey && !p.seedId?.startsWith('legend-captain-tsubasa-all-stars-'))!
    expect(isTsubasaPlayer(rnd)).toBe(false)
  })

  it('禁止挂牌、结算、AI 报价、接受报价、AI 球队出售与共享自由市场吸收', () => {
    const game = createWorldGame(5050, 'north', '禁止售卖队')
    game.pve!.peak.cleared = 50
    const tsubasa = buildPeakTeam(50).players.find((p) => p.enName === 'Tsubasa Ozora')!
    const claimed = claimPeakReward(game, tsubasa.id)
    expect(claimed.ok).toBe(true)
    if (!claimed.ok) throw new Error('expected claim success')
    const star = claimed.player
    const price = bestMarketValue(game, star)

    // 1. 挂牌出售拦截
    const listRes = listPlayer(game, star.id, price)
    expect(listRes.ok).toBe(false)
    expect(listRes.error).toContain('足球小将')

    // 2. 即便历史脏数据里已有挂牌，settleMarket 也不成交
    game.market = { listings: [{ player: star, price, listedRound: 1 }], lastSettledRound: 0 }
    expect(settleMarket(game, 1)).toBe(0)
    expect(game.market.listings).toHaveLength(1)
    game.market = { listings: [], lastSettledRound: 0 }

    // 3. AI 报价不会以足球小将为目标
    const clubs = localMarketClubs(game)
    for (const club of clubs) club.state.economy.balance = 50_000_000
    game.roster = game.roster.map((p) => p)
    generateAIOffers({ game, clubs, season: 1, round: 1, now: game.season.startedAt + 60_000, seed: 77 })
    expect((game.transferOffers ?? []).some((o) => o.playerId === star.id)).toBe(false)

    // 4. 对已有待处理报价，接受被拒绝，过期处理直接撤回而不触发不满
    const buyer = clubs[0]
    buyer.state.economy.balance = 50_000_000
    game.transferOffers = [{
      id: 'legacy-tsubasa-offer',
      clubId: buyer.id,
      clubName: buyer.name,
      tier: buyer.tier,
      playerId: star.id,
      playerName: star.name,
      amount: price * 2,
      value: price,
      createdAt: game.season.startedAt,
      expiresAt: game.season.startedAt + 1000,
      status: 'pending',
    }]
    const acceptRes = respondToOffer(game, 'legacy-tsubasa-offer', true, game.season.startedAt + 500, buyer, 1)
    expect(acceptRes.ok).toBe(false)
    expect(acceptRes.error).toContain('足球小将')
    expect(game.roster.some((p) => p.id === star.id)).toBe(true)
    expect(game.transferOffers[0].status).toBe('withdrawn')
    expect(star.unhappy).toBeUndefined()

    game.transferOffers.push({
      id: 'legacy-tsubasa-offer-2',
      clubId: buyer.id,
      clubName: buyer.name,
      tier: buyer.tier,
      playerId: star.id,
      playerName: star.name,
      amount: price * 2,
      value: price,
      createdAt: game.season.startedAt,
      expiresAt: game.season.startedAt + 1000,
      status: 'pending',
    })
    expect(expireOffers(game, game.season.startedAt + 2000)).toBe(true)
    expect(game.transferOffers.find((o) => o.id === 'legacy-tsubasa-offer-2')?.status).toBe('withdrawn')
    expect(star.unhappy).toBeUndefined()

    // 5. AI 球队若持有也不可被挖/买
    const aiTeam = game.aiTeams[0]
    aiTeam.players.push(structuredClone(star))
    expect(sellerSquadError(aiTeam, star)).toContain('足球小将')
    const buyRes = buyFromClub(game, aiTeam.id, star.id)
    expect(buyRes.ok).toBe(false)

    // 6. 共享自由市场 absorbFreeAgents 不吸收足球小将
    const seeded = createInitialGame(901)
    seeded.freeStars = [star]
    const market: FreeMarket = { pool: [], auctions: [], log: [], version: 1 }
    absorbFreeAgents(market, seeded, () => false)
    expect(market.pool.some((p) => p.id === star.id)).toBe(false)
  })

  it('联机 PUT /api/game 拒绝保存包含足球小将的挂牌出售请求', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-tsubasa-nosell-'))
    dirs.push(dir)
    const app = createAppServer({ dataDir: dir, tickMs: 0, now: () => Date.UTC(2026, 10, 14, 1) })
    servers.push(app)
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`

    const reg = await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'tsubasa-guard', password: 'secret123' }),
    })
    expect(reg.status).toBe(201)
    const { token } = await reg.json() as { token: string }
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

    const current = await (await fetch(`${base}/api/game`, { headers })).json() as { game: any; revision: number }
    const tsubasa = structuredClone(buildPeakTeam(50).players[0])
    tsubasa.id = 'reward-tsubasa-test'
    tsubasa.seedId = buildPeakTeam(50).players[0].id
    current.game.market = {
      listings: [{ player: tsubasa, price: bestMarketValue(current.game, tsubasa), listedRound: 1 }],
      lastSettledRound: 0,
    }

    const res = await fetch(`${base}/api/game`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ game: current.game, baseRevision: current.revision }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('足球小将')
  })
})
