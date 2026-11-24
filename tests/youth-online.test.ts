import { afterEach, beforeAll, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { createAppServer, type AppServer } from '../server/app.ts'
import { loadPveContent } from '../src/game/pve-content.ts'
import type { GameState } from '../src/game/types.ts'
import { YOUTH_DOWNTIME_COMPENSATION_ID, YOUTH_WEEK_MS, youthCA } from '../src/game/youth.ts'
import { youthStars } from '../src/game/youth-rating.ts'
import { trainingOptions } from '../src/game/training-calendar.ts'

beforeAll(loadPveContent)
const apps: AppServer[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.shutdown()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

it('authoritative academy actions, concurrent promotion, stale browser saves and durable restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-youth-'))
  dirs.push(dir)
  const now = Date.UTC(2026, 10, 18, 1)
  let app = createAppServer({ dataDir: dir, tickMs: 0, now: () => now })
  apps.push(app)
  const listen = async () => {
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
  }
  let base = await listen()
  const registration = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'youth-coach', password: 'secret123' }) })
  expect(registration.status).toBe(201)
  const { token } = await registration.json() as { token: string }
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const get = async () => await (await fetch(`${base}/api/game`, { headers })).json() as { game: GameState; revision: number }
  const post = (url: string, body: unknown) => fetch(`${base}${url}`, { method: 'POST', headers, body: JSON.stringify(body) })
  const save = (game: GameState, revision: number) => fetch(`${base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game, baseRevision: revision }) })
  let state = await get()
  expect(state.game.youth?.members).toHaveLength(6)
  const ids = state.game.youth!.members.map(m => m.player.id)
  const balance = state.game.economy!.balance
  const youth = (body: object, revision = state.revision) => post('/api/youth/action', { ...body, baseRevision: revision })
  expect((await youth({ action: 'plan', playerId: ids[1], plan: { position: 'DM', focus: 'passing' } })).status).toBe(200)
  state = await get()
  expect(state.game.youth!.members[1].plan).toEqual({ position: 'DM', focus: 'passing' })
  expect((await youth({ action: 'call_up', playerId: ids[1] })).status).toBe(200)
  state = await get()
  expect(state.game.roster.find(p => p.id === ids[1])?.youthOrigin).toBeTruthy()
  expect((await post('/api/training/start', { playerId: ids[1], bookKeys: [], points: 0 })).status).toBe(400)
  state = await get()
  const original = structuredClone(state.game.roster.find(p => p.id === ids[1])!)
  state.game.youth!.members[1].ceiling = 99999
  state.game.roster.find(p => p.id === ids[1])!.baseAttrs.passing = 9999
  state.game.roster.find(p => p.id === ids[1])!.attrs.passing = 9999
  delete state.game.roster.find(p => p.id === ids[1])!.youthOrigin
  expect((await save(state.game, state.revision)).status).toBe(200)
  state = await get()
  expect(state.game.roster.find(p => p.id === ids[1])!.baseAttrs).toEqual(original.baseAttrs)
  expect(state.game.roster.find(p => p.id === ids[1])!.youthOrigin).toEqual(original.youthOrigin)
  expect(state.game.youth!.members[1].ceiling).toBeLessThanOrEqual(280)
  const forged = structuredClone(state.game)
  forged.roster.push(structuredClone(forged.youth!.members[2].player))
  expect((await save(forged, state.revision)).status).toBe(400)
  const stale = structuredClone(state)
  const concurrent = await Promise.all([
    youth({ action: 'promote', playerId: ids[1] }),
    youth({ action: 'promote', playerId: ids[1] }),
  ])
  expect(concurrent.map(r => r.status).sort()).toEqual([200, 409])
  state = await get()
  expect(state.game.youth?.members).toHaveLength(5)
  expect(state.game.roster.filter(p => p.id === ids[1])).toHaveLength(1)
  expect(state.game.roster.find(p => p.id === ids[1])!.youthOrigin?.promotedAt).toBe(now)
  expect(state.game.economy!.balance).toBe(balance)
  expect((await save(stale.game, stale.revision)).status).toBe(409)
  const db = new DatabaseSync(path.join(dir, 'accounts.sqlite'), { readOnly: true })
  const row = db.prepare('SELECT game_json FROM accounts WHERE username = ?').get('youth-coach') as { game_json: string }
  const stored = JSON.parse(row.game_json) as GameState
  expect(stored.youth?.members).toHaveLength(5)
  expect(stored.roster.find(p => p.id === ids[1])!.youthOrigin?.promotedAt).toBe(now)
  db.close()
  await app.shutdown()
  apps.pop()
  app = createAppServer({ dataDir: dir, tickMs: 0, now: () => now })
  apps.push(app)
  base = await listen()
  state = await get()
  expect(state.game.youth?.members).toHaveLength(5)
  expect(state.game.youth!.members.map(m => m.player.id)).toEqual(ids.filter(id => id !== ids[1]))
  expect((await youth({ action: 'promote', playerId: ids[1] })).status).toBe(400)
  expect((await post('/api/training/start', { playerId: ids[1], bookKeys: [], points: 0 })).status).toBe(200)
  state = await get()
  expect(state.game.training[ids[1]]).toBeTruthy()
  expect(state.game.training[ids[1]].candidate.baseAttrs).toEqual(original.baseAttrs)
})

it('联机账号下期青训招募按「下期重点」一次性发放宕机补偿 5★ 即战力，且客户端无法清空账本重领', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-youth-comp-'))
  dirs.push(dir)
  let clock = Date.UTC(2026, 10, 18, 1)
  const app = createAppServer({ dataDir: dir, tickMs: 0, now: () => clock })
  apps.push(app)
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`

  const registration = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'comp-coach', password: 'secret123' }) })
  expect(registration.status).toBe(201)
  const { token } = await registration.json() as { token: string }
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const get = async () => await (await fetch(`${base}/api/game`, { headers })).json() as { game: GameState; revision: number }
  const post = (url: string, body: unknown) => fetch(`${base}${url}`, { method: 'POST', headers, body: JSON.stringify(body) })
  const save = (game: GameState, revision: number) => fetch(`${base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game, baseRevision: revision }) })

  let state = await get()
  expect(state.game.shared).toBe(true)
  expect((await post('/api/youth/action', { action: 'recruit_position', position: 'AMR', baseRevision: state.revision })).status).toBe(200)

  // 一周后触发下一期招募：0 号位必出 17 岁、4★ 即战力、5★ 潜力的 AMR 补偿球员
  clock += YOUTH_WEEK_MS + 1000
  state = await get()
  const comp = state.game.youth!.intake.candidates[0]
  expect(comp.compensationId).toBe(YOUTH_DOWNTIME_COMPENSATION_ID)
  expect(comp.plan.position).toBe('AMR')
  expect(comp.player.age).toBe(17)
  expect(youthCA(comp.player)).toBeCloseTo(230, 5)
  expect(youthStars(youthCA(comp.player))).toBe(4)
  expect(comp.ceiling).toBe(268)
  expect(youthStars(comp.ceiling)).toBe(5)
  expect(state.game.youth!.compensations?.[YOUTH_DOWNTIME_COMPENSATION_ID]).toBe(true)

  // 客户端尝试篡改清除 compensations 账本：服务器 preserveYouthState 必须拦截保留
  const tampered = structuredClone(state.game)
  delete tampered.youth!.compensations
  expect((await save(tampered, state.revision)).status).toBe(200)
  state = await get()
  expect(state.game.youth!.compensations?.[YOUTH_DOWNTIME_COMPENSATION_ID]).toBe(true)

  // 免费签入并立刻临时征召进入一线队
  expect((await post('/api/youth/action', { action: 'sign', playerId: comp.player.id, baseRevision: state.revision })).status).toBe(200)
  state = await get()
  expect((await post('/api/youth/action', { action: 'call_up', playerId: comp.player.id, baseRevision: state.revision })).status).toBe(200)
  state = await get()
  expect(state.game.roster.some(p => p.id === comp.player.id)).toBe(true)

  // 再过一周刷新新招募期：不再重复发放宕机补偿
  clock += YOUTH_WEEK_MS
  state = await get()
  expect(state.game.youth!.intake.candidates.some(c => c.compensationId === YOUTH_DOWNTIME_COMPENSATION_ID)).toBe(false)
})

it('一线队培养或 Agent 非青训改动推进全局 revision 时不误拦青训操作，青训本身变化后仍触发 409 保护', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-youth-rev-'))
  dirs.push(dir)
  let clock = Date.UTC(2026, 10, 18, 1)
  const app = createAppServer({ dataDir: dir, tickMs: 0, now: () => clock })
  apps.push(app)
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`

  const reg = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'rev-coach', password: 'secret123' }) })
  expect(reg.status).toBe(201)
  const { token } = await reg.json() as { token: string }
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const get = async () => await (await fetch(`${base}/api/game`, { headers })).json() as { game: GameState; revision: number }
  const post = (url: string, body: unknown, h = headers) => fetch(`${base}${url}`, { method: 'POST', headers: h, body: JSON.stringify(body) })

  const snap = await get()
  const staleRev = snap.revision
  const starterId = snap.game.roster.find(p => p.positions.GK === 0)!.id

  // 模拟另一端/Agent 连续进行一线队培养（非青训操作）并推进全局 revision
  const startedRes = await post('/api/training/start', { playerId: starterId, bookKeys: [], points: 0 })
  expect(startedRes.status).toBe(200)
  const started = await startedRes.json() as { game: GameState }
  const firstActivity = trainingOptions(started.game.training[starterId])[0].id
  const { token: agentToken } = await (await post('/api/agent/token', {})).json() as { token: string }
  const agentHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${agentToken}` }
  expect((await post('/api/agent/action', { action: 'training_action', playerId: starterId, request: { kind: 'activity', activityId: firstActivity } }, agentHeaders)).status).toBe(200)
  const afterNonYouth = await get()
  expect(afterNonYouth.revision).toBeGreaterThan(staleRev)

  // 青训本身未变化：携带旧全局 revision 仍可正常保存招募方向，不再误报 409
  const okRes = await post('/api/youth/action', { action: 'recruit_position', position: 'ST', baseRevision: staleRev })
  expect(okRes.status).toBe(200)
  const afterYouth = await okRes.json() as { revision: number; game: GameState }
  expect(afterYouth.game.youth!.recruitPosition).toBe('ST')

  // 若 Agent 直接改了青训，旧版本必须被 409 拦截
  expect((await post('/api/agent/action', { action: 'youth_action', youth: { action: 'recruit_position', position: 'DM' } }, agentHeaders)).status).toBe(200)
  const conflictAfterAgentYouth = await post('/api/youth/action', { action: 'recruit_position', position: 'GK', baseRevision: afterYouth.revision })
  expect(conflictAfterAgentYouth.status).toBe(409)

  // 同步到最新版本后，哪怕跨周 settleYouth 刷新了招募期，旧版本也必须被 409 拦截
  const latest = await get()
  clock += YOUTH_WEEK_MS + 1000
  const conflictAfterIntake = await post('/api/youth/action', { action: 'recruit_position', position: 'GK', baseRevision: latest.revision })
  expect(conflictAfterIntake.status).toBe(409)
})
