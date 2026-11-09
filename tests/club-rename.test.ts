import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { CLUB_NAME_MAX, clubNameError, normalizeClubName } from '../src/game/club-name.ts'
import type { GameState } from '../src/game/types.ts'

describe('俱乐部名字规则', () => {
  it('最多 8 个字、不能为空、不能有特殊符号', () => {
    expect(CLUB_NAME_MAX).toBe(8)
    expect(clubNameError('一二三四五六七八', [])).toBeNull()
    expect(clubNameError('一二三四五六七八九', [])).toContain('最多 8 个字')
    expect(clubNameError('', [])).toContain('不能为空')
    expect(clubNameError('<b>', [])).toContain('特殊符号')
    expect(normalizeClubName('  北京   FC  ')).toBe('北京 FC')
  })

  it('不能和已有球队重名，比较时忽略大小写和空格', () => {
    expect(clubNameError('fc北京', ['FC 北京'])).toContain('FC 北京')
    expect(clubNameError('北京国安', ['上海申花'])).toBeNull()
  })
})

const servers: AppServer[] = []
afterEach(() => { while (servers.length) servers.pop()!.close() })

async function start() {
  const app = createAppServer({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'fm-rename-')), staticDir: path.resolve('dist'), tickMs: 0 })
  servers.push(app)
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
}

async function register(base: string, username: string) {
  const data = await (await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'secret123' }) })).json() as { token: string }
  return { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' }
}

const rename = (base: string, headers: Record<string, string>, name: string) =>
  fetch(`${base}/api/club/rename`, { method: 'POST', headers, body: JSON.stringify({ name }) })

describe('联机改俱乐部名字', () => {
  it('改名会查字数和全服重名，成功后全服看到新名字；普通保存不能改名', async () => {
    const base = await start()
    const one = await register(base, 'renamer')
    const two = await register(base, 'other')
    const world = await (await fetch(`${base}/api/world/teams`, { headers: one })).json() as { ownClubId: string; clubs: { id: string; name: string; managed: boolean }[] }
    const aiClub = world.clubs.find((club) => !club.managed)!

    expect((await rename(base, one, aiClub.name)).status).toBe(400)
    expect((await rename(base, one, '一二三四五六七八九')).status).toBe(400)

    const renamed = await rename(base, one, '  青石 联队 ')
    expect(renamed.status).toBe(200)
    const body = await renamed.json() as { game: GameState; revision: number }
    expect(body.game.clubName).toBe('青石 联队')
    const after = await (await fetch(`${base}/api/world/teams`, { headers: two })).json() as typeof world
    expect(after.clubs.find((club) => club.id === world.ownClubId)?.name).toBe('青石 联队')

    // 别的玩家不能再用这个名字（忽略空格）。
    const taken = await rename(base, two, '青石联队')
    expect(taken.status).toBe(400)
    expect((await taken.json() as { error: string }).error).toContain('青石 联队')

    // 普通存档保存带上别的名字也不会生效。
    const current = await (await fetch(`${base}/api/game`, { headers: one })).json() as { game: GameState; revision: number }
    current.game.clubName = '偷偷改名'
    const saved = await fetch(`${base}/api/game`, { method: 'PUT', headers: one, body: JSON.stringify({ game: current.game, baseRevision: current.revision }) })
    expect(saved.status).toBe(200)
    const reloaded = await (await fetch(`${base}/api/game`, { headers: one })).json() as { game: GameState }
    expect(reloaded.game.clubName).toBe('青石 联队')
  })

  it('Agent 也能改名，并能读到历年联赛成绩', async () => {
    const base = await start()
    const headers = await register(base, 'agentrename')
    const { token } = await (await fetch(`${base}/api/agent/token`, { method: 'POST', headers })).json() as { token: string }
    const agent = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const response = await fetch(`${base}/api/agent/action`, { method: 'POST', headers: agent, body: JSON.stringify({ action: 'rename_club', name: '智能联队' }) })
    expect(response.status).toBe(200)
    const body = await response.json() as { game: { club: { name: string }; seasonHistory: unknown[] } }
    expect(body.game.club.name).toBe('智能联队')
    expect(Array.isArray(body.game.seasonHistory)).toBe(true)
    const tooLong = await fetch(`${base}/api/agent/action`, { method: 'POST', headers: agent, body: JSON.stringify({ action: 'rename_club', name: '一二三四五六七八九' }) })
    expect(tooLong.status).toBe(400)
  })
})
