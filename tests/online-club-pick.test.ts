import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { readStoredAccounts, writeStoredAccounts } from './account-storage-helpers.ts'
import { applyAgentAction } from '../server/agent.ts'
import { createWorldGame } from '../src/game/world.ts'
import { seasonStartForRound } from '../src/game/calendar.ts'
import type { GameState } from '../src/game/types.ts'
import type { WorldPublicClub, WorldPublicSnapshot } from '../src/online.ts'

const servers: AppServer[] = []
const dirs: string[] = []
afterEach(() => {
  while (servers.length) servers.pop()!.close()
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

async function start(dataDir?: string) {
  if (!dataDir) {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-club-pick-'))
    dirs.push(dataDir)
  }
  const app = createAppServer({ dataDir, staticDir: path.resolve('dist'), tickMs: 0, now: () => Date.UTC(2026, 10, 9, 8, 15) })
  servers.push(app)
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  return { base: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`, dataDir, app }
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })
const register = (base: string, username: string, clubId?: string) => fetch(`${base}/api/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password: 'secret123', clubId }),
})
const choices = async (base: string) => (await (await fetch(`${base}/api/registration/clubs`)).json() as { clubs: WorldPublicClub[] }).clubs
const world = async (base: string, token: string) => (await (await fetch(`${base}/api/world/teams`, { headers: auth(token) })).json() as WorldPublicSnapshot)

describe('注册时选队，注册后不能换队', () => {
  it('注册前可预览空缺二级球队；预览不创建账号或占位，注册直接接管选中的球队', async () => {
    const { base, app } = await start()
    const free = await choices(base)
    expect(free.length).toBeGreaterThan(1)
    expect(free.every((club) => club.tier === 'division2' && !club.managed)).toBe(true)
    expect(free[0].players.length).toBeGreaterThanOrEqual(18)
    expect(free[0].players.every((player) => !('energy' in player) && !('condition' in player))).toBe(true)
    expect(app.accountCount()).toBe(0)
    expect(await choices(base)).toHaveLength(free.length)
    const target = free[1]
    const response = await register(base, 'picker', target.id)
    expect(response.status).toBe(201)
    const registered = await response.json() as { token: string; game: GameState }
    expect(registered.game.clubName).toBe(target.name)
    expect(registered.game.world!.clubs.find((club) => club.id === 'player')?.squadKey).toBe(target.id)
    expect((await world(base, registered.token)).ownClubId).toBe(target.id)
    expect((await choices(base)).some((club) => club.id === target.id)).toBe(false)
    // 注册后立即不能换队，包括 AI 已经补算过的情况。
    const again = await fetch(`${base}/api/world/choose-club`, { method: 'POST', headers: auth(registered.token), body: JSON.stringify({ clubId: free[0].id }) })
    expect(again.status).toBe(400)
    expect((await again.json() as { error: string }).error).toContain('注册完成后不允许换队')
    expect((await world(base, registered.token)).ownClubId).toBe(target.id)
  })

  it('球队被抢先注册后返回冲突；非法球队不能创建账号', async () => {
    const { base, app } = await start()
    const free = await choices(base)
    expect((await register(base, 'first', free[0].id)).status).toBe(201)
    expect((await register(base, 'second', free[0].id)).status).toBe(409)
    expect((await register(base, 'invalid', 'missing-club')).status).toBe(400)
    const publicState = await (await fetch(`${base}/api/world`)).json() as { clubs: { id: string; tier: string }[] }
    const higher = publicState.clubs.find((club) => club.tier !== 'division2')!
    expect((await register(base, 'higher', higher.id)).status).toBe(400)
    expect(app.accountCount()).toBe(1)
    // 冲突没有留下半个账号：同一用户名可以改选另一支球队后重试。
    expect((await register(base, 'second', free[1].id)).status).toBe(201)
  })

  it('不指定球队的旧注册客户端也不能换队；修改存档、Agent 和重启都不能绕过', async () => {
    let { base, dataDir } = await start()
    const response = await register(base, 'fixed_club')
    const registered = await response.json() as { token: string; game: GameState; revision: number }
    const before = await world(base, registered.token)
    const other = before.clubs.find((club) => club.tier === 'division2' && !club.managed)!
    const headers = auth(registered.token)
    const changed = structuredClone(registered.game)
    changed.world!.clubs.find((club) => club.id === 'player')!.squadKey = other.id
    const forged = await fetch(`${base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game: changed, baseRevision: registered.revision }) })
    expect(forged.status).toBe(400)
    const noWorld = structuredClone(registered.game)
    delete noWorld.world
    const missingWorld = await fetch(`${base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game: noWorld, baseRevision: registered.revision }) })
    expect(missingWorld.status).toBe(400)
    const agent = await (await fetch(`${base}/api/agent/token`, { method: 'POST', headers })).json() as { token: string }
    const agentSwap = await fetch(`${base}/api/agent/action`, { method: 'POST', headers: auth(agent.token), body: JSON.stringify({ action: 'choose_club', clubId: other.id }) })
    expect(agentSwap.status).toBe(400)
    // 旧客户端即使上传“尚未选队”的标记，服务端也没有注册后换队的通路。
    const current = await (await fetch(`${base}/api/game`, { headers })).json() as { game: GameState; revision: number }
    Object.assign(current.game.settings!, { clubPicked: false, autoSettle: { season: 1, fromRound: 2, after: Date.UTC(2026, 10, 9, 8, 45) } })
    const saved = await fetch(`${base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game: current.game, baseRevision: current.revision }) })
    expect(saved.status).toBe(200)
    const afterSave = await (await fetch(`${base}/api/game`, { headers })).json() as { game: GameState }
    expect(afterSave.game.settings).not.toHaveProperty('autoSettle')
    servers.pop()!.close()
    const stored = readStoredAccounts(dataDir)
    Object.assign(stored.accounts[0].game.settings!, { autoSettle: { season: 1, fromRound: 2, after: Date.UTC(2026, 10, 9, 8, 45) } })
    writeStoredAccounts(dataDir, stored)
    ;({ base } = await start(dataDir))
    expect(readStoredAccounts(dataDir).accounts[0].game.settings).not.toHaveProperty('autoSettle')
    const swap = await fetch(`${base}/api/world/choose-club`, { method: 'POST', headers, body: JSON.stringify({ clubId: other.id }) })
    expect(swap.status).toBe(400)
    expect((await world(base, registered.token)).ownClubId).toBe(before.ownClubId)
  })

  it('联机 start_league 必须等到本轮开赛时间，不能提前开打', () => {
    const now = 1_000_000_000
    const game = createWorldGame(2024, undefined, undefined, now)
    game.season.startedAt = now
    game.season.round = 2
    const early = applyAgentAction(game, { action: 'start_league' }, now)
    expect(early.ok).toBe(false)
    expect(early.error).toContain('还没开始')
    game.season.startedAt = seasonStartForRound(now, 2)
    const due = applyAgentAction(game, { action: 'start_league' }, now)
    expect(due.ok, due.error).toBe(true)
  })
})
