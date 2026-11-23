import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it, vi } from 'vitest'
import { AccountStore } from '../server/account-store.ts'
import { createAppServer, IDLE_COACH_RELEASE_MS, PROTECTED_USERNAMES, type AppServer } from '../server/app.ts'
import { seasonEndAt } from '../src/game/calendar.ts'
import { computeWorldTable } from '../src/game/world.ts'
import type { GameState, WorldState } from '../src/game/types.ts'

it('连续 7 天未上线自动清理教练账号并释放球队（保留进度、恢复原名），未满 7 天保留，换季清任务安全回滚', async () => {
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

    // 推进 6 天（超过 3 天 AI 接管，但未满 7 天）：重启后不应清除账号。
    clock += 6 * 24 * 60 * 60_000
    await stop()
    await open()
    expect(app!.accountCount()).toBe(2)
    // 活跃教练刷新在线时间，确保后续不会满 7 天。
    expect((await request('/api/game', undefined, active.token)).status).toBe(200)

    // 同时验证换季失败回滚与清理逻辑（seasonEndAt 距开季 ~7.5 天，idle 超过 7 天，active 仅离线 ~1.5 天）。
    await stop()
    fs.writeFileSync(path.join(queueDir, 'index.json'), JSON.stringify([{ id: jobId, season: 1, status: 'published' }]))
    fs.writeFileSync(path.join(queueDir, `${jobId}.input.json`), '{}')
    fs.writeFileSync(resultFile, '{}')
    await open(); expect(fs.existsSync(resultFile)).toBe(true)
    await roll(true); expect(fs.existsSync(resultFile)).toBe(true) // 世界虽已换季，账号提交失败，不能清成果。
    // 活跃教练在赛季中上线打卡（一整个完整赛季为 7.0 天，不上线会被正常清理）
    clock += 3 * 24 * 60 * 60_000
    expect((await request('/api/game', undefined, active.token)).status).toBe(200)
    await roll(); expect(fs.existsSync(resultFile)).toBe(false)
    expect(app!.accountCount()).toBe(1)
    expect((await request('/api/game', undefined, first.token)).status).toBe(401)
    expect((await request('/api/agent/state', undefined, agent.token)).status).toBe(401)
    expect((await request('/api/login', { username: 'idle', password: 'first-password' })).status).toBe(401)

    // 再测试赛季中（不换季）直接满 7 天离线 + 孤儿账号清理：
    expect((await request('/api/game', undefined, active.token)).status).toBe(200)
    const midIdle = await register('mid_idle', 'd2n_02', 'mid-password')
    const orphan = await register('orphan_idle', 'd2n_03', 'orphan-password')
    expect(app!.accountCount()).toBe(3)
    await stop()
    // 把 orphan_idle 从 world.owners 移除，模拟无球队孤儿账号
    const worldNoOrphan = stored()
    delete worldNoOrphan.owners['d2n_03']
    fs.writeFileSync(worldFile, JSON.stringify(worldNoOrphan))
    // 推进 4 天让 active 打卡续命，再推进 3 天 + 1 秒让 mid_idle 与 orphan_idle 都满 7 天
    clock += 4 * 24 * 60 * 60_000
    await open()
    expect(app!.accountCount()).toBe(3)
    expect((await request('/api/game', undefined, active.token)).status).toBe(200)
    await stop()
    clock += (IDLE_COACH_RELEASE_MS - 4 * 24 * 60 * 60_000) + 1000
    await open()
    expect(app!.accountCount()).toBe(1) // mid_idle 和 orphan_idle 都被立刻清理，仅剩 active
    expect((await request('/api/game', undefined, midIdle.token)).status).toBe(401)
    expect((await request('/api/game', undefined, orphan.token)).status).toBe(401)

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
      expect(db.prepare('SELECT 1 FROM accounts WHERE id=?').get(orphan.user.id)).toBeUndefined()
      expect(db.prepare('SELECT 1 FROM sessions WHERE account_id=?').get(first.user.id)).toBeUndefined()
      const row = db.prepare('SELECT a.id, a.game_json FROM accounts a JOIN club_handovers h ON h.holder=a.id WHERE h.club_id=?').get(club)!
      saved = JSON.parse(row.game_json as string)
      const fixtureRows = db.prepare('SELECT season_index, fixtures_json FROM season_history_fixtures WHERE account_id=?').all(row.id as string) as { season_index: number; fixtures_json: string }[]
      const fixturesBySeason = new Map(fixtureRows.map(item => [item.season_index, JSON.parse(item.fixtures_json)]))
      if (Array.isArray(saved.seasonHistory)) {
        saved.seasonHistory = saved.seasonHistory.map(s => (!s.fixtures?.length && fixturesBySeason.has(s.index) ? { ...s, fixtures: fixturesBySeason.get(s.index) } : s))
      }
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

it('保留名单内的用户（默认含 harjeb，且支持额外配置）离线再久也永不被清理或释放球队', async () => {
  expect(PROTECTED_USERNAMES[0]).toBe('harjeb')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-protected-'))
  let clock = Date.UTC(2026, 10, 9, 8, 15)
  let app: AppServer | undefined
  let base = ''
  const open = async () => {
    app = createAppServer({ dataDir: dir, tickMs: 0, now: () => clock, protectedUsernames: ['VipCoach'] })
    await new Promise<void>(resolve => app!.server.listen(0, '127.0.0.1', resolve))
    const addr = app.server.address()
    if (!addr || typeof addr === 'string') throw new Error('missing address')
    base = `http://127.0.0.1:${addr.port}`
  }
  const stop = async () => { await app!.shutdown(); app = undefined }
  const request = (url: string, body?: object, token?: string) => fetch(base + url, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body && JSON.stringify(body),
  })
  const register = async (username: string, clubId: string, password: string) => {
    const res = await request('/api/register', { username, password, clubId })
    expect(res.status).toBe(201)
    return await res.json() as { user: { id: string }; token: string }
  }
  try {
    await open()
    const harjeb = await register('Harjeb', 'd2n_01', 'pass-1234')
    const vip = await register('vipcoach', 'd2n_02', 'pass-1234')
    const regular = await register('regular_idle', 'd2n_03', 'pass-1234')
    expect(app!.accountCount()).toBe(3)

    // 推进 30 天（远超 7 天清理阈值），重启触发 sweepIdleCoaches
    await stop()
    clock += 30 * 24 * 60 * 60_000
    await open()

    // regular_idle 被清理，但 harjeb 与 vipcoach 永久保留
    expect(app!.accountCount()).toBe(2)
    expect((await request('/api/game', undefined, regular.token)).status).toBe(401)
    expect((await request('/api/game', undefined, harjeb.token)).status).toBe(200)
    expect((await request('/api/game', undefined, vip.token)).status).toBe(200)
  } finally {
    if (app) await stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}, 60_000)
