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

  it('只允许在先锋联赛选队：升入精英联赛的原二级托管席不可继承，曾从冠军联赛降级的原精英队亦禁止选择', async () => {
    const first = await start()
    // 先注册一支先锋联赛球队 d2n_01，再把该队模拟升到精英联赛并释放为托管席，同时把原精英队 d1_05 记入冠军联赛降级史并降到先锋联赛
    const reg = await fetch(`${first.base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'old_coach', password: 'secret123', clubId: 'd2n_01' }),
    })
    expect(reg.status).toBe(201)
    first.app.close()
    servers.pop()

    const worldPath = path.join(first.dir, 'world.json')
    const saved = JSON.parse(fs.readFileSync(worldPath, 'utf8'))
    // 1. 原二级队 d2n_01 升入精英联赛，且前任教练释放成空缺托管席（club:d2n_01）
    const promotedD2 = saved.world.clubs.find((club: any) => club.id === 'd2n_01')
    promotedD2.tier = 'division1'
    promotedD2.conference = undefined
    saved.owners['d2n_01'] = 'club:d2n_01'

    // 2. 原精英队 d1_05 历史上曾升入冠军联赛并从冠军联赛降级（relegations 前 3），如今落到先锋联赛
    const formerChamp = saved.world.clubs.find((club: any) => club.id === 'd1_05')
    formerChamp.tier = 'division2'
    formerChamp.conference = 'north'
    delete formerChamp.playerLocked
    saved.world.history = [
      {
        seasonIndex: 1,
        champion: '皇家马德里',
        promotions: ['d1_05', 'd1_02', 'd1_03', 'd2n_01', 'd2s_01', 'd2n_02'],
        relegations: ['ai_18', 'ai_19', 'ai_20', 'd1_18', 'd1_19', 'd1_20'],
      },
      {
        seasonIndex: 2,
        champion: '皇家马德里',
        promotions: ['d1_06', 'd1_07', 'd1_08', 'd2n_03', 'd2s_02', 'd2s_03'],
        relegations: ['d1_05', 'ai_16', 'ai_17', 'd1_15', 'd1_16', 'd1_17'],
      },
    ]

    // 3. 原精英队 d1_15 从精英联赛直接降到先锋联赛（未曾从冠军联赛降级）→ 应当可选
    const d1Relegated = saved.world.clubs.find((club: any) => club.id === 'd1_15')
    d1Relegated.tier = 'division2'
    d1Relegated.conference = 'south'
    delete d1Relegated.playerLocked

    fs.writeFileSync(worldPath, JSON.stringify(saved))

    const restarted = await start(first.dir)
    const regClubsRes = await fetch(`${restarted.base}/api/registration/clubs`)
    expect(regClubsRes.status).toBe(200)
    const regClubs = (await regClubsRes.json() as { clubs: Array<{ id: string; tier: string }> }).clubs
    const regIds = new Set(regClubs.map((c) => c.id))

    // 所有可选队必须全部在先锋联赛（division2）
    expect(regClubs.every((c) => c.tier === 'division2')).toBe(true)
    // 升入精英联赛的原二级托管席 d2n_01 不可见且不能继承
    expect(regIds.has('d2n_01')).toBe(false)
    // 曾从冠军联赛降级的 d1_05 已被回填 playerLocked 且不可见
    expect(regIds.has('d1_05')).toBe(false)
    // 仅从精英联赛降级的 d1_15 正常可见可选
    expect(regIds.has('d1_15')).toBe(true)

    // 尝试显式继承升到精英联赛的 d2n_01 → 400 拒绝
    const inheritPromoted = await fetch(`${restarted.base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'sneaky_d1', password: 'secret123', clubId: 'd2n_01' }),
    })
    expect(inheritPromoted.status).toBe(400)

    // 尝试显式选曾从冠军联赛降级的 d1_05 → 403 拒绝
    const pickFormerChamp = await fetch(`${restarted.base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'sneaky_champ', password: 'secret123', clubId: 'd1_05' }),
    })
    expect(pickFormerChamp.status).toBe(403)

    // 显式选择从精英联赛降级的 d1_15 → 201 成功
    const pickD1Relegated = await fetch(`${restarted.base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'valid_d1_drop', password: 'secret123', clubId: 'd1_15' }),
    })
    expect(pickD1Relegated.status).toBe(201)
  })
})
