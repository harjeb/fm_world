import { afterEach, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'

let app: AppServer | undefined
let dir = ''
afterEach(() => { app?.close(); app = undefined; if (dir) fs.rmSync(dir, { recursive: true, force: true }) })

it('shares authoritative cross-division offers and commits a purchase only once', async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-cross-transfer-'))
  app = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), tickMs: 0 })
  await new Promise<void>(resolve => app!.server.listen(0, '127.0.0.1', resolve))
  let base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
  const req = async (url: string, token = '', body?: unknown, method = body ? 'POST' : 'GET') => {
    const r = await fetch(base + url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: r.status, data: await r.json() as any }
  }
  const a = (await req('/api/register', '', { username: 'crossone', password: 'secret123' })).data
  const b = (await req('/api/register', '', { username: 'crosstwo', password: 'secret123' })).data
  const ag = (await req('/api/agent/token', a.token, {})).data.token
  const game = (await req('/api/game', a.token)).data
  const otherGame = (await req('/api/game', b.token)).data.game
  const league = new Set([...game.game.aiTeams, ...otherGame.aiTeams].map((t: any) => t.id))
  const offers = (await req('/api/transfer/ai-offers', a.token)).data.offers
  const agent = (await req('/api/agent/state', ag)).data.game
  expect(agent.market.clubOffers.length).toBe(offers.length)
  const candidates = offers.filter((o: any) => !league.has(o.teamId) && o.asking && !o.blocked).sort((x: any, y: any) => x.asking - y.asking)
  expect(candidates.length).toBeGreaterThan(0)
  expect(candidates[0].player).not.toHaveProperty('potential')
  expect(candidates[0]).toHaveProperty('demands')
  const saved = structuredClone(game.game)
  saved.roster.push(candidates[0].player)
  expect((await req('/api/game', a.token, { game: saved, baseRevision: game.revision }, 'PUT')).status).toBe(400)
  let deal: any
  for (const candidate of candidates.slice(0, 50)) {
    const amount = Math.min(agent.economy.balance, Math.ceil(candidate.asking * 1.5))
    if (amount < candidate.asking) continue
    const preview = await req('/api/agent/action', ag, { action: 'preview_signing', teamId: candidate.teamId, playerId: candidate.player.id, offer: amount, goal: 'title', role: 'star' })
    if (preview.data.result?.club.chance >= 0.97 && preview.data.result?.playerChance >= 0.98) { deal = { teamId: candidate.teamId, playerId: candidate.player.id, offer: amount, goal: 'title', role: 'star' }; break }
  }
  expect(deal).toBeDefined()
  const worldBefore = JSON.parse(fs.readFileSync(path.join(dir, 'world.json'), 'utf8'))
  const managedId = Object.keys(worldBefore.owners).find(id => worldBefore.teams[id].players.some((p: any) => p.id === otherGame.roster[0].id))!
  expect((await req('/api/transfer/ai-buy', a.token, { ...deal, teamId: managedId, playerId: otherGame.roster[0].id })).status).toBe(400)
  const before = (await req('/api/game', a.token)).data.game
  const failed = await req('/api/transfer/ai-buy', a.token, { ...deal, offer: 1 })
  expect(failed.status).toBe(400)
  expect((await req('/api/game', a.token)).data.game.roster).toEqual(before.roster)
  // 模拟卖方此前签入过这名球员：卖出后不能再由 AI 签约账本把他恢复。
  await app!.flush(); await app!.shutdown()
  const signed = worldBefore.teams[deal.teamId].players.find((p: any) => p.id === deal.playerId)
  worldBefore.aiClubs[deal.teamId].signings.push(signed)
  fs.writeFileSync(path.join(dir, 'world.json'), JSON.stringify(worldBefore))
  app = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), tickMs: 0 })
  await new Promise<void>(resolve => app!.server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
  const [first, second] = await Promise.all([req('/api/transfer/ai-buy', a.token, deal), req('/api/transfer/ai-buy', b.token, deal)])
  expect([first.status, second.status].sort()).toEqual([200, 400])
  const winner = first.status === 200 ? a.token : b.token
  const result = (await req('/api/game', winner)).data.game
  expect(result.roster.some((p: any) => p.id === deal.playerId)).toBe(true)
  expect(result.aiTeams.some((t: any) => t.id === deal.teamId)).toBe(false)
  expect((await req('/api/transfer/ai-buy', winner, deal)).status).toBe(400)
  expect((await req('/api/transfer/ai-offers', winner)).data.offers.some((o: any) => o.player.id === deal.playerId)).toBe(false)
  await app!.flush()
  await app!.shutdown()
  app = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), tickMs: 0 })
  await new Promise<void>(resolve => app!.server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
  const worldAfter = JSON.parse(fs.readFileSync(path.join(dir, 'world.json'), 'utf8'))
  expect(worldAfter.aiClubs[deal.teamId].economy.balance).toBe(worldBefore.aiClubs[deal.teamId].economy.balance + deal.offer)
  expect(worldAfter.teams[deal.teamId].players.some((p: any) => p.id === deal.playerId)).toBe(false)
  expect(worldAfter.aiClubs[deal.teamId].signings.some((p: any) => p.id === deal.playerId)).toBe(false)
  expect((await req('/api/game', winner)).data.game.roster.some((p: any) => p.id === deal.playerId)).toBe(true)
})
