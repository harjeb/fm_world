import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { INITIAL_CHAMPIONS_CLUB_IDS } from '../src/game/data/world-clubs.ts'

const servers: AppServer[] = []
const dirs: string[] = []

async function start(dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-champ-lock-'))) {
  if (!dirs.includes(dir)) dirs.push(dir)
  const app = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), tickMs: 0 })
  servers.push(app)
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const port = (app.server.address() as AddressInfo).port
  return { app, base: `http://127.0.0.1:${port}`, dir }
}

afterEach(() => {
  for (const app of servers.splice(0)) app.close()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('初始冠军联赛球队锁定（降级到二级也不允许玩家选择）', () => {
  it('启动自动回填 playerLocked，降级到二级的初始冠军队在选队列表隐藏、接口拒绝 403 且不会被自动分配', async () => {
    const first = await start()
    first.app.close()
    servers.pop()

    // 模拟线上旧 world.json：移除所有 playerLocked 标记，并把 ai_13（多特蒙德）与 d1_11（谢菲尔德星期三）同时降入二级联赛
    const worldPath = path.join(first.dir, 'world.json')
    const saved = JSON.parse(fs.readFileSync(worldPath, 'utf8'))
    for (const club of saved.world.clubs) delete club.playerLocked
    const champ = saved.world.clubs.find((club: any) => club.id === 'ai_13')
    const d1 = saved.world.clubs.find((club: any) => club.id === 'd1_11')
    champ.tier = 'division2'
    champ.conference = 'north'
    d1.tier = 'division2'
    d1.conference = 'south'
    fs.writeFileSync(worldPath, JSON.stringify(saved))

    // 重启服务器：应自动为全部 20 支初始冠军队回填 playerLocked = true 并落盘
    const restarted = await start(first.dir)
    const persisted = JSON.parse(fs.readFileSync(worldPath, 'utf8'))
    const lockedIds = persisted.world.clubs.filter((club: any) => club.playerLocked).map((club: any) => club.id)
    expect(new Set(lockedIds)).toEqual(INITIAL_CHAMPIONS_CLUB_IDS)

    // 注册可选球队列表：不包含任何初始冠军队（即使 ai_13 已在 division2），但允许降级的初始一级队 d1_11
    const regClubsRes = await fetch(`${restarted.base}/api/registration/clubs`)
    expect(regClubsRes.status).toBe(200)
    const regClubs = (await regClubsRes.json() as { clubs: Array<{ id: string }> }).clubs
    const regClubIds = new Set(regClubs.map((c) => c.id))
    for (const champId of INITIAL_CHAMPIONS_CLUB_IDS) {
      expect(regClubIds.has(champId)).toBe(false)
    }
    expect(regClubIds.has('d1_11')).toBe(true)

    // 显式 POST /api/register 指定已降入二级的初始冠军队 ai_13 → 403 拒绝
    const blockedRes = await fetch(`${restarted.base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'blocked_user', password: 'secret123', clubId: 'ai_13' }),
    })
    expect(blockedRes.status).toBe(403)
    const blockedJson = await blockedRes.json() as { error: string }
    expect(blockedJson.error).toContain('锁定')

    // 显式注册降级到二级的普通一级队 d1_11 → 允许成功
    const okRes = await fetch(`${restarted.base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'd1_taker', password: 'secret123', clubId: 'd1_11' }),
    })
    expect(okRes.status).toBe(201)
  })
})
