import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { FREE_MARKET_TARGET, marketDayOf, refreshFreeMarket, refreshLocalFreeMarket } from '../src/game/free-market.ts'
import { isOnMarketToday } from '../src/game/market-window.ts'
import { buyFreeAgent } from '../src/game/market.ts'
import { GAME_DAY_MS } from '../src/game/calendar.ts'
import { economyOf } from '../src/game/economy.ts'
import { createWorldGame } from '../src/game/world.ts'
import type { Player } from '../src/game/types.ts'

const visibleCount = (pool: Player[], anchor: Parameters<typeof isOnMarketToday>[0], now: number) => pool.filter((player) => isOnMarketToday(anchor, player, now)).length

describe('自由市场每日补充', () => {
  it('先算当天挂牌的球星，不足 200 人用随机球员补满；球星都留着', () => {
    const game = createWorldGame(3101)
    const now = game.world!.calendarStartAt! + 3 * GAME_DAY_MS + 1000
    const stars = [...game.freeStars]
    const { pool, changed } = refreshFreeMarket({ pool: stars, anchor: game, now, seed: game.seed })
    expect(changed).toBe(true)
    expect(visibleCount(pool, game, now)).toBe(FREE_MARKET_TARGET)
    for (const star of stars) expect(pool).toContain(star)
    const fillers = pool.filter((player) => player.marketDay !== undefined)
    expect(fillers.every((player) => player.marketDay === marketDayOf(game, now) && !player.starKey)).toBe(true)
    expect(new Set(pool.map((player) => player.id)).size).toBe(pool.length)
  })

  it('第二天没人买的随机球员销毁、换一批新的，名单不会越滚越大；正在竞拍的先留着', () => {
    const game = createWorldGame(3102)
    const start = game.world!.calendarStartAt! + 1000
    let pool = refreshFreeMarket({ pool: [...game.freeStars], anchor: game, now: start, seed: game.seed }).pool
    const dayOne = pool.filter((player) => player.marketDay !== undefined)
    const kept = dayOne[0]
    const sizes: number[] = []
    for (let day = 1; day <= 6; day++) {
      const now = start + day * GAME_DAY_MS
      pool = refreshFreeMarket({ pool, anchor: game, now, seed: game.seed, busy: (id) => id === kept.id }).pool
      expect(visibleCount(pool, game, now)).toBeGreaterThanOrEqual(FREE_MARKET_TARGET)
      sizes.push(pool.length)
    }
    // 前一天的补充球员都没了，只剩还在竞拍的那一个
    expect(pool.some((player) => player.id === kept.id)).toBe(true)
    expect(dayOne.filter((player) => pool.some((item) => item.id === player.id))).toHaveLength(1)
    expect(Math.max(...sizes)).toBeLessThanOrEqual(game.freeStars.length + FREE_MARKET_TARGET + 1)
  })

  it('同一天、同一个世界补出来的人完全一样', () => {
    const game = createWorldGame(3103)
    const now = game.world!.calendarStartAt! + 5 * GAME_DAY_MS
    const a = refreshFreeMarket({ pool: [...game.freeStars], anchor: game, now, seed: game.seed }).pool.map((player) => [player.id, player.name])
    const b = refreshFreeMarket({ pool: [...game.freeStars], anchor: game, now, seed: game.seed }).pool.map((player) => [player.id, player.name])
    expect(a).toEqual(b)
  })

  it('签下的补充球员成了正式球员，第二天不会被销毁', () => {
    const game = createWorldGame(3104)
    game.freeStars = []
    const now = Date.now()
    expect(refreshLocalFreeMarket(game, now)).toBe(true)
    // 同一天只补一次
    expect(refreshLocalFreeMarket(game, now + 1000)).toBe(false)
    economyOf(game).balance = 100_000_000
    game.season.round = 1
    const filler = game.freeStars.find((player) => player.marketDay !== undefined)!
    expect(buyFreeAgent(game, filler.id).ok).toBe(true)
    const signed = game.roster.find((player) => player.id === filler.id)!
    expect(signed.marketDay).toBeUndefined()
    refreshLocalFreeMarket(game, now + 2 * GAME_DAY_MS)
    expect(game.roster.some((player) => player.id === filler.id)).toBe(true)
    expect(game.freeStars.some((player) => player.marketDay !== undefined && player.marketDay < marketDayOf(game, now + 2 * GAME_DAY_MS))).toBe(false)
  })

  it('联机账号的存档不在本地补（由服务器补）', () => {
    const game = createWorldGame(3105)
    game.shared = true
    const before = game.freeStars.length
    expect(refreshLocalFreeMarket(game, Date.now())).toBe(false)
    expect(game.freeStars).toHaveLength(before)
  })
})

const servers: AppServer[] = []
afterEach(() => { while (servers.length) servers.pop()!.close() })

describe('联机：全服自由市场每天补到 200 人', () => {
  it('市场接口能看到 200 人，其中有便宜的随机球员', async () => {
    const app = createAppServer({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'fm-free-market-')), staticDir: path.resolve('dist'), tickMs: 0 })
    servers.push(app)
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
    const market = await (await fetch(`${base}/api/market`)).json() as { pool: Player[] }
    expect(market.pool.length).toBeGreaterThanOrEqual(FREE_MARKET_TARGET)
    expect(market.pool.some((player) => player.marketDay !== undefined)).toBe(true)
  })
})
