import { afterEach, beforeAll, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { cardRecyclePoints } from '../src/game/cards.ts'
import { loadPveContent } from '../src/game/pve-content.ts'
import type { GameState, PlayerCard } from '../src/game/types.ts'

beforeAll(loadPveContent)
let app: AppServer | undefined
let dir: string | undefined
afterEach(async () => {
  if (app) await app.shutdown()
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  app = undefined
  dir = undefined
})

it('concurrent starts for different players cannot overspend shared points', async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-recycle-spend-'))
  app = createAppServer({ dataDir: dir, tickMs: 0 })
  await new Promise<void>(resolve => app!.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
  const registration = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'spend-concurrency', password: 'secret123' }) })
  expect(registration.status).toBe(201)
  const { token } = await registration.json() as { token: string }
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const get = async () => await (await fetch(`${base}/api/game`, { headers })).json() as { game: GameState; revision: number }
  const post = (url: string, body: unknown) => fetch(`${base}${url}`, { method: 'POST', headers, body: JSON.stringify(body) })
  let state = await get()
  const player = state.game.roster[0]
  const template: PlayerCard = { id: '', playerId: player.id, playerName: player.name, serial: 1, version: 1, routeId: null, createdAt: 0, attrs: player.attrs, positions: player.positions, personality: player.personality, skills: player.skills }
  const value = cardRecyclePoints(template)!
  expect(value).toBeGreaterThan(0)
  expect(value).toBeLessThan(10)
  const ids = Array.from({ length: Math.ceil(10 / value) }, (_, i) => `spend-card-${i}`)
  state.game.cards ??= []
  state.game.cards.push(...ids.map(id => ({ ...structuredClone(template), id })))
  expect((await fetch(`${base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game: state.game, baseRevision: state.revision }) })).status).toBe(200)
  state = await get()
  expect((await post('/api/cards/recycle', { cardIds: ids, baseRevision: state.revision })).status).toBe(200)
  state = await get()
  const balance = state.game.trainingPoints!
  expect(balance).toBeGreaterThanOrEqual(10)
  expect(balance).toBeLessThan(20)
  const players = state.game.roster.slice(0, 2)
  const starts = await Promise.all(players.map(p => post('/api/training/start', { playerId: p.id, bookKeys: [], points: 10 })))
  expect(starts.map(response => response.status).sort()).toEqual([200, 400])
  state = await get()
  expect(state.game.trainingPoints).toBe(balance - 10)
  expect(players.filter(p => state.game.training[p.id]?.qualityBonusPoints === 10)).toHaveLength(1)
}, 120_000)
