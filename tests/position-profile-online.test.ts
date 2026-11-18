import { afterEach, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { readStoredAccounts, writeStoredAccounts } from './account-storage-helpers.ts'
import { readDetailedPositions } from '../src/game/detailed-positions.ts'
import type { GameState } from '../src/game/types.ts'

const apps: AppServer[] = [], dirs: string[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.shutdown()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

it('migrates legacy live profiles on restart, protects authoritative roles/cards and world generation flag on PUT', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-natural-position-')); dirs.push(dir)
  const now = Date.UTC(2026, 10, 18, 1)
  const start = async () => {
    const app = createAppServer({ dataDir: dir, tickMs: 0, now: () => now })
    apps.push(app)
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
    return { app, base: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}` }
  }
  let running = await start()
  const registered = await (await fetch(`${running.base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'natural-coach', password: 'secret123' }) })).json() as any
  const headers = { Authorization: `Bearer ${registered.token}`, 'Content-Type': 'application/json' }
  const get = async () => await (await fetch(`${running.base}/api/game`, { headers })).json() as { game: GameState; revision: number }
  const save = (game: GameState, baseRevision: number) => fetch(`${running.base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game, baseRevision }) })
  await running.app.shutdown(); apps.pop()
  const db = readStoredAccounts(dir)
  const account = db.accounts[0]
  const player = account.game.roster.find(p => p.style.startsWith('fb_') || p.style.startsWith('w_'))!
  const id = player.id
  const attrs = structuredClone(player.attrs)
  const coarse = { ...player.positions }
  delete player.positionProfile
  player.detailedPositions = { DL: 10, DR: 10, WBL: 10, WBR: 10, ML: 85, MR: 85, AML: 96, AMR: 97 }
  player.baseDetailedPositions = { ...player.detailedPositions }
  const oldRevision = account.revision
  const oldGame = structuredClone(account.game)
  delete account.game.world!.positionGenerationVersion
  writeStoredAccounts(dir, db)
  const worldFile = path.join(dir, 'world.json')
  const shared = JSON.parse(fs.readFileSync(worldFile, 'utf8'))
  delete shared.world.positionGenerationVersion
  delete shared.positionProfilesVersion
  for (const team of Object.values(shared.teams) as any[]) for (const p of team.players) if (p.id === id) {
    delete p.positionProfile
    p.detailedPositions = { ...player.detailedPositions }
    p.baseDetailedPositions = { ...player.baseDetailedPositions }
  }
  fs.writeFileSync(worldFile, JSON.stringify(shared))
  running = await start()
  expect((await save(oldGame, oldRevision)).status).toBe(409)
  let state = await get()
  const fixed = state.game.roster.find(p => p.id === id)!
  expect(fixed.positionProfile).toBeTruthy()
  expect(fixed.attrs).toEqual(attrs)
  expect(fixed.positions).toEqual(coarse)
  const primary = fixed.positionProfile!.primary
  expect(readDetailedPositions(fixed)[primary]).toBeGreaterThanOrEqual(90)
  expect(readDetailedPositions(fixed).AMR).toBeGreaterThanOrEqual(97)
  expect(state.game.world!.positionGenerationVersion).toBeUndefined()
  const profile = structuredClone(fixed.positionProfile)
  fixed.positionProfile = { version: 1, primary: 'ST', floors: { ST: 100 } }
  fixed.baseDetailedPositions!.AMC = 99 // legitimate position training must survive metadata restoration
  state.game.world!.positionGenerationVersion = 1
  expect((await save(state.game, state.revision)).status).toBe(200)
  state = await get()
  const canonical = state.game.roster.find(p => p.id === id)!
  expect(canonical.positionProfile).toEqual(profile)
  expect(canonical.baseDetailedPositions!.AMC).toBe(99)
  expect(state.game.world!.positionGenerationVersion).toBeUndefined()
  const stableRevision = state.revision
  await running.app.shutdown(); apps.pop()
  running = await start()
  state = await get()
  expect(state.revision).toBe(stableRevision)
  expect(state.game.roster.find(p => p.id === id)!.positionProfile).toEqual(profile)
})
