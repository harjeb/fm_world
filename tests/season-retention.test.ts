import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it, vi } from 'vitest'
import { AccountStore } from '../server/account-store.ts'
import { createAppServer, type AppServer } from '../server/app.ts'
import { seasonEndAt } from '../src/game/calendar.ts'
import { computeWorldTable } from '../src/game/world.ts'
import type { GameState, WorldState } from '../src/game/types.ts'

it('连续两个完整赛季未上线才删除教练；换季清任务，重启后新身份接手同一份球队进度', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-retention-'))
  const worldFile = path.join(dir, 'world.json')
  const queueDir = path.join(dir, 'match-jobs')
  const jobId = `q-${'b'.repeat(64)}`
  const resultFile = path.join(queueDir, `${jobId}.result.json`)
  let clock = Date.UTC(2026, 10, 9, 8, 15), app: AppServer | undefined, base = ''
  const open = async () => {
    app = createAppServer({ dataDir: dir, tickMs: 0, now: () => clock })
    await new Promise<void>(resolve => app!.server.listen(0, '127.0.0.1', resolve))
    const addr = app.server.address()
    if (!addr || typeof addr === 'string') throw new Error('missing address')
    base = `http://127.0.0.1:${addr.port}`
  }
  const stop = async () => { await app!.shutdown(); app = undefined }
  const request = (url: string, body?: object, token?: string) => fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) })
  const register = async (username: string, clubId: string, password: string) => {
    const response = await request('/api/register', { username, password, clubId })
    expect(response.status).toBe(201)
    return await response.json() as { user: { id: string }; token: string; game: GameState }
  }
  const stored = () => JSON.parse(fs.readFileSync(worldFile, 'utf8')) as { world: WorldState; owners: Record<string, string> }
  const roll = async (failAccountCommit = false) => {
    await stop()
    const state = stored()
    const names = new Map(state.world.clubs.map(club => [club.id, club.name]))
    for (const d of state.world.divisions) {
      for (const f of d.fixtures) { f.played = true; f.score = { home: 1, away: 1 } }
      d.table = computeWorldTable(d.clubIds!, d.fixtures, names)
      d.finished = true; d.round = 38; d.champion = d.table[0].teamId
    }
    fs.writeFileSync(worldFile, JSON.stringify(state))
    clock = seasonEndAt(state.world.seasonStartedAt) + 1
    if (failAccountCommit) {
      const failure = new Error('模拟换季账号落盘失败')
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      const flush = vi.spyOn(AccountStore.prototype, 'flushSync').mockImplementationOnce(() => { throw failure })
      try {
        await open()
        expect(log).toHaveBeenCalledWith('全服赛季结算失败', failure)
      } finally { flush.mockRestore(); log.mockRestore() }
    } else await open()
    expect(stored().world.seasonIndex).toBe(state.world.seasonIndex + 1)
  }
  try {
    await open()
    const club = 'd2n_01', first = await register('idle', club, 'first-password')
    const active = await register('active', 'd2s_01', 'active-password')
    const originalName = first.game.clubName
    expect((await request('/api/club/rename', { name: '回收测试队' }, first.token)).status).toBe(200)
    const agent = await (await request('/api/agent/token', {}, first.token)).json() as { token: string }
    await stop()
    fs.writeFileSync(path.join(queueDir, 'index.json'), JSON.stringify([{ id: jobId, season: 1, status: 'published' }]))
    fs.writeFileSync(path.join(queueDir, `${jobId}.input.json`), '{}')
    fs.writeFileSync(resultFile, '{}')
    await open(); expect(fs.existsSync(resultFile)).toBe(true)
    await roll(true); expect(fs.existsSync(resultFile)).toBe(true) // 世界虽已换季，账号提交失败，不能清成果。
    await roll(); expect(fs.existsSync(resultFile)).toBe(false)
    expect(app!.accountCount()).toBe(2) // 第 2 赛季才是第一个完整缺席赛季。
    expect((await request('/api/game', undefined, active.token)).status).toBe(200)
    await roll(); expect(app!.accountCount()).toBe(1)
    expect((await request('/api/game', undefined, first.token)).status).toBe(401)
    expect((await request('/api/agent/state', undefined, agent.token)).status).toBe(401)
    expect((await request('/api/login', { username: 'idle', password: 'first-password' })).status).toBe(401)
    await stop()
    // 模拟交接事务成功后，旧 world.json 尚未替换即重启。
    const stale = stored(); stale.owners[club] = first.user.id
    stale.world.clubs.find(c => c.id === club)!.name = '回收测试队'
    fs.writeFileSync(worldFile, JSON.stringify(stale))
    await open()
    const available = await (await request('/api/registration/clubs')).json()
    expect(available.clubs.find((c: {id: string}) => c.id === club)).toMatchObject({ name: originalName, managed: false })
    await app!.flush()
    const db = new DatabaseSync(path.join(dir, 'accounts.sqlite'), { readOnly: true })
    let saved: GameState
    try {
      expect(db.prepare('SELECT 1 FROM accounts WHERE id=?').get(first.user.id)).toBeUndefined()
      expect(db.prepare('SELECT 1 FROM sessions WHERE account_id=?').get(first.user.id)).toBeUndefined()
      const row = db.prepare('SELECT a.game_json FROM accounts a JOIN club_handovers h ON h.holder=a.id WHERE h.club_id=?').get(club)!
      saved = JSON.parse(row.game_json as string)
    } finally { db.close() }
    const next = await register('idle', club, 'new-password')
    expect(next.user.id).not.toBe(first.user.id)
    expect(next.game.clubName).toBe(originalName)
    for (const key of ['lineup', 'roster', 'economy', 'cards', 'training', 'seasonHistory', 'matchHistory'] as const) expect(next.game[key]).toEqual(saved[key])
    expect((await request('/api/game', undefined, first.token)).status).toBe(401)
    expect((await request('/api/register', { clubId: club, username: 'again', password: 'not-allowed' })).status).toBe(409)
    expect((await request('/api/game', undefined, active.token)).status).toBe(200)
  } finally { if (app) await stop(); fs.rmSync(dir, { recursive: true, force: true }) }
}, 180_000)
