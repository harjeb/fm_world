import { afterEach, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { readStoredAccounts, writeStoredAccounts } from './account-storage-helpers.ts'

const apps: AppServer[] = []
const dirs: string[] = []
afterEach(() => { for (const app of apps.splice(0)) app.close(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

it('rejects pre-migration revisions and migrates subsequent legacy PUTs after card authority', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-position-online-')); dirs.push(dir)
  const start = async () => {
    const app = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), tickMs: 0 }); apps.push(app)
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
    return { app, base: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}` }
  }
  const first = await start()
  const registered = await (await fetch(`${first.base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'positions_test', password: 'secret123' }) })).json() as any
  first.app.close()
  const db = readStoredAccounts(dir)
  const p = db.accounts[0].game.roster.find(player => !player.positions.GK)!
  delete p.detailedPositions; delete p.detailedPositionsVersion
  writeStoredAccounts(dir, db)
  const second = await start()
  const headers = { Authorization: `Bearer ${registered.token}`, 'Content-Type': 'application/json' }
  const old = await fetch(`${second.base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game: registered.game, baseRevision: registered.revision }) })
  expect(old.status).toBe(409)
  const current = await (await fetch(`${second.base}/api/game`, { headers })).json() as any
  expect(current.revision).toBeGreaterThan(registered.revision)
  const legacy = current.game.roster.find((player: any) => player.id === p.id)
  delete legacy.detailedPositions; delete legacy.detailedPositionsVersion
  const saved = await fetch(`${second.base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game: current.game, baseRevision: current.revision }) })
  expect(saved.status).toBe(200)
  const next = await (await fetch(`${second.base}/api/game`, { headers })).json() as any
  const owner = next.game.roster.find((player: any) => player.id === p.id)
  expect(owner.detailedPositions).toBeDefined()
  const card = { id: 'position-card', playerId: owner.id, playerName: owner.name, serial: 1, version: 1, routeId: null, createdAt: 1, attrs: owner.attrs, positions: owner.positions, personality: owner.personality, skills: owner.skills, detailedPositions: { DL: 11, DR: 77 }, detailedPositionsVersion: 1 }
  owner.equippedCardId = card.id
  owner.detailedPositions = { ...card.detailedPositions }
  next.game.cards.push(card)
  const create = await fetch(`${second.base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game: next.game, baseRevision: next.revision }) })
  expect(create.status).toBe(200)
  const withCard = await (await fetch(`${second.base}/api/game`, { headers })).json() as any
  const expectedDetails = structuredClone(withCard.game.cards[0].detailedPositions)
  expect(expectedDetails).toMatchObject(card.detailedPositions) // Existing learned entries survive new natural-position floors.
  const legacyOwner = withCard.game.roster.find((player: any) => player.id === p.id)
  delete legacyOwner.detailedPositions; delete legacyOwner.detailedPositionsVersion
  delete withCard.game.cards[0].detailedPositions; delete withCard.game.cards[0].detailedPositionsVersion
  const update = await fetch(`${second.base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game: withCard.game, baseRevision: withCard.revision }) })
  expect(update.status).toBe(200)
  const restored = await (await fetch(`${second.base}/api/game`, { headers })).json() as any
  expect(restored.game.cards[0].detailedPositions).toEqual(expectedDetails)
  expect(restored.game.roster.find((player: any) => player.id === p.id).detailedPositions).toEqual(expectedDetails)
})
