import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { GAME_DAY_MS, ROUND_MS, SEASON_GAME_DAYS } from '../src/game/calendar.ts'

const servers: AppServer[] = []
afterEach(() => {
  while (servers.length) servers.pop()!.close()
})

async function start(clock?: () => number, dir?: string) {
  const dataDir = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'fm-world-server-'))
  const app = createAppServer({ dataDir, staticDir: path.resolve('dist'), tickMs: 0, ...(clock ? { now: clock } : {}) })
  servers.push(app)
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const port = (app.server.address() as AddressInfo).port
  return { base: `http://127.0.0.1:${port}`, dir: dataDir }
}

type Account = { token: string; revision: number; game: any }

async function register(base: string, username: string): Promise<Account> {
  const response = await fetch(`${base}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'secret123' }),
  })
  expect(response.status).toBe(201)
  return await response.json() as Account
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })

async function load(base: string, token: string): Promise<{ game: any; revision: number }> {
  const response = await fetch(`${base}/api/game`, { headers: auth(token) })
  expect(response.status).toBe(200)
  return await response.json() as { game: any; revision: number }
}

/** 把这个账号的联赛赛程全部标成已赛；返回可 PUT 回去的存档。 */
async function finishSeason(base: string, token: string) {
  const current = await load(base, token)
  for (const fixture of current.game.season.fixtures) {
    fixture.played = true
    fixture.score = fixture.score ?? { home: 1, away: 1 }
  }
  current.game.season.finished = true
  const saved = await fetch(`${base}/api/game`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ game: current.game, baseRevision: current.revision }) })
  expect(saved.status).toBe(200)
  return current.game
}

describe('服务器共享世界', () => {
  it('同一世界种子/开赛时间，两名新玩家分别接管不同的二级球队', async () => {
    const { base } = await start()
    const a = await register(base, 'world_a')
    const b = await register(base, 'world_b')
    expect(a.game.seed).toBe(b.game.seed)
    expect(a.game.season.startedAt).toBe(b.game.season.startedAt)
    expect(a.game.clubName).not.toBe(b.game.clubName)
    expect(a.game.world.clubs.find((club: any) => club.id === 'player')?.tier).toBe('division2')
    expect(b.game.world.clubs.find((club: any) => club.id === 'player')?.tier).toBe('division2')
    const world = await (await fetch(`${base}/api/world`)).json() as any
    expect(world.clubs).toHaveLength(80)
    expect(Object.keys(world.owners)).toHaveLength(2)
    expect(world.slots).toEqual({ total: 80, taken: 2, free: 78 })
    expect(new Set(Object.keys(world.owners)).size).toBe(2)
    expect(world.round).toBeGreaterThanOrEqual(1)
  })

  it('新玩家在共享世界当前时间加入，而不是从第 1 轮重新开始', async () => {
    let now = Date.now()
    const { base } = await start(() => now)
    const first = await register(base, 'world_early')
    expect(first.game.season.round).toBe(1)
    now += ROUND_MS + 2 * 60 * 60 * 1000 // 一轮（现实 24 小时）多一点
    const late = await register(base, 'world_late')
    expect(late.game.season.round).toBeGreaterThanOrEqual(2)
    expect(late.game.season.fixtures.some((fixture: any) => fixture.played)).toBe(true)
    expect(late.game.world.clubs.find((club: any) => club.id === 'player')?.tier).toBe('division2')
  })

  it('共享市场对所有账号可见，出售的球员会出现在池子里', async () => {
    const { base } = await start()
    const a = await register(base, 'market_a')
    const response = await fetch(`${base}/api/market`)
    expect(response.status).toBe(200)
    const market = await response.json() as any
    expect(Array.isArray(market.pool)).toBe(true)
    expect(market.pool.length).toBeGreaterThan(0)
    expect(a.game.freeStars.length + market.pool.length).toBeGreaterThan(0)
  })

  it('存档冲突时旧 revision 返回 409，新 revision 才能写入', async () => {
    const { base } = await start()
    const a = await register(base, 'revision_a')
    const current = await load(base, a.token)
    const ok = await fetch(`${base}/api/game`, { method: 'PUT', headers: auth(a.token), body: JSON.stringify({ game: current.game, baseRevision: current.revision }) })
    expect(ok.status).toBe(200)
    const stale = await fetch(`${base}/api/game`, { method: 'PUT', headers: auth(a.token), body: JSON.stringify({ game: current.game, baseRevision: current.revision }) })
    expect(stale.status).toBe(409)
  })

  it('服务器重启后共享名单保持不变，而不是按各账号重新生成', async () => {
    const { base, dir } = await start()
    const a = await register(base, 'shared_reboot_a')
    const before = await (await fetch(`${base}/api/world/teams`, { headers: auth(a.token) })).json() as any
    servers.pop()!.close()
    const restarted = await start(undefined, dir)
    const after = await (await fetch(`${restarted.base}/api/world/teams`, { headers: auth(a.token) })).json() as any
    expect(after.clubs.map((club: any) => [club.id, club.players.map((player: any) => player.id)])).toEqual(before.clubs.map((club: any) => [club.id, club.players.map((player: any) => player.id)]))
  })

  it('所有账号同时进入同一新赛季，升降级、赛程和球队名册全服一致，重启后新账号继承该赛季', async () => {
    let clock = Date.now()
    const { base, dir } = await start(() => clock)
    const a = await register(base, 'season_global_a')
    const b = await register(base, 'season_global_b')
    await finishSeason(base, a.token)
    const premature = await fetch(`${base}/api/world/next-season`, { method: 'POST', headers: auth(a.token), body: '{}' })
    expect(premature.status, await premature.clone().text()).toBe(400)
    await finishSeason(base, b.token)
    // 常规赛结束后要先走完 12 个游戏日的赛后休整窗口。
    clock += SEASON_GAME_DAYS * GAME_DAY_MS
    const rollover = await fetch(`${base}/api/world/next-season`, { method: 'POST', headers: auth(a.token), body: '{}' })
    const rolloverBody = await rollover.json() as { error?: string }
    expect(rolloverBody.error).toBeUndefined()
    expect(rollover.status).toBe(200)
    const world = await (await fetch(`${base}/api/world`)).json() as any
    expect(world.seasonIndex).toBe(2)
    expect(world.clubs).toHaveLength(80)
    expect(world.divisions.map((division: any) => division.table.length)).toEqual([20, 20, 20, 20])
    const aGame = await load(base, a.token)
    const bGame = await load(base, b.token)
    expect([aGame.game.season.index, bGame.game.season.index]).toEqual([2, 2])
    expect(aGame.game.season.startedAt).toBe(bGame.game.season.startedAt)
    expect(aGame.game.world.history).toEqual(bGame.game.world.history)
    expect(aGame.game.world.clubs.map((club: any) => [club.squadKey ?? club.id, club.tier, club.conference]).sort()).toEqual(bGame.game.world.clubs.map((club: any) => [club.squadKey ?? club.id, club.tier, club.conference]).sort())
    for (const id of ['champions', 'division1', 'd2-south']) {
      const first = aGame.game.world.divisions.find((division: any) => division.divisionId === id)
      const second = bGame.game.world.divisions.find((division: any) => division.divisionId === id)
      expect(first.fixtures).toEqual(second.fixtures)
      expect(first.table).toEqual(second.table)
    }
    const publicA = await (await fetch(`${base}/api/world/teams`, { headers: auth(a.token) })).json() as any
    const publicB = await (await fetch(`${base}/api/world/teams`, { headers: auth(b.token) })).json() as any
    expect(publicA.clubs).toEqual(publicB.clubs)
    expect(publicA.divisions).toEqual(publicB.divisions)
    await finishSeason(base, a.token)
    await finishSeason(base, b.token)
    clock += SEASON_GAME_DAYS * GAME_DAY_MS
    const thirdSeason = await fetch(`${base}/api/world/next-season`, { method: 'POST', headers: auth(b.token), body: '{}' })
    expect(thirdSeason.status).toBe(200)
    const aThird = await load(base, a.token)
    const bThird = await load(base, b.token)
    expect(aThird.game.season.index).toBe(3)
    expect(bThird.game.season.index).toBe(3)
    expect(aThird.game.world.history).toEqual(bThird.game.world.history)
    servers.pop()!.close()
    clock += 1000
    const restarted = await start(() => clock, dir)
    const late = await register(restarted.base, 'season_late')
    expect(late.game.season.index).toBe(3)
    const lateWorld = await (await fetch(`${restarted.base}/api/world`)).json() as any
    expect(lateWorld.seasonIndex).toBe(3)
    expect(Object.keys(lateWorld.owners).length).toBeGreaterThanOrEqual(1)
  }, 60_000)

  it('全服结算时各队退役与重生只发生一次，不把同一个球星复制进市场', async () => {
    let clock = Date.now()
    const { base } = await start(() => clock)
    const a = await register(base, 'retire_global_a')
    const b = await register(base, 'retire_global_b')
    const retiredIds: string[] = []
    for (const account of [a, b]) {
      const current = await load(base, account.token)
      const star = current.game.roster.find((player: any) => player.starKey)
      expect(star).toBeDefined()
      star.age = 40
      retiredIds.push(star.id)
      for (const fixture of current.game.season.fixtures) {
        fixture.played = true
        fixture.score = { home: 0, away: 0 }
      }
      current.game.season.finished = true
      expect((await fetch(`${base}/api/game`, { method: 'PUT', headers: auth(account.token), body: JSON.stringify({ game: current.game, baseRevision: current.revision }) })).status).toBe(200)
    }
    clock += SEASON_GAME_DAYS * GAME_DAY_MS
    const rolled = await fetch(`${base}/api/world/next-season`, { method: 'POST', headers: auth(a.token), body: '{}' })
    const rolledBody = await rolled.json() as { error?: string }
    expect(rolledBody.error).toBeUndefined()
    expect(rolled.status).toBe(200)
    const market = await (await fetch(`${base}/api/market`)).json() as any
    for (const id of retiredIds) {
      expect(market.pool.some((player: any) => player.id === id)).toBe(false)
      expect(market.pool.filter((player: any) => player.starKey === id && player.id.startsWith('regen-'))).toHaveLength(1)
    }
    expect(new Set(market.pool.map((player: any) => player.id)).size).toBe(market.pool.length)
  }, 20_000)

  it('常规赛结束后先进入 12 个游戏日的赛后休整，窗口走完才自动换季', async () => {
    let clock = Date.now()
    const { base } = await start(() => clock)
    const a = await register(base, 'auto_roll_a')
    const current = await load(base, a.token)
    for (const fixture of current.game.season.fixtures) { fixture.played = true; fixture.score = { home: 1, away: 1 } }
    current.game.season.finished = true
    const saved = await fetch(`${base}/api/game`, { method: 'PUT', headers: auth(a.token), body: JSON.stringify({ game: current.game, baseRevision: current.revision }) })
    expect(saved.status).toBe(200)
    // 常规赛刚结束：还在休整窗口里，赛季不会翻页。
    clock += ROUND_MS * 38
    const stillSame = await (await fetch(`${base}/api/world`)).json() as any
    expect(stillSame.seasonIndex).toBe(1)
    // 再等过休整窗口，服务器自动开新赛季。
    clock += (SEASON_GAME_DAYS - 38) * GAME_DAY_MS
    const world = await (await fetch(`${base}/api/world`)).json() as any
    expect(world.seasonIndex).toBe(2)
    const next = await load(base, a.token)
    expect(next.game.season.index).toBe(2)
    expect(next.game.world.seasonStartedAt).toBeLessThanOrEqual(clock)
  }, 30_000)

  it('离线满一个赛季后服务器先自动补赛，再全服换季', async () => {
    let clock = Date.now()
    const { base } = await start(() => clock)
    const a = await register(base, 'away_season_a')
    clock += SEASON_GAME_DAYS * GAME_DAY_MS
    const result = await load(base, a.token)
    expect(result.game.season.index).toBe(2)
    expect(result.game.world.history).toHaveLength(1)
    const world = await (await fetch(`${base}/api/world`)).json() as any
    expect(world.seasonIndex).toBe(2)
  }, 30_000)
})
