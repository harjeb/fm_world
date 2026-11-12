import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { readStoredAccounts, writeStoredAccounts } from './account-storage-helpers.ts'
import { personKey } from '../src/game/injury.ts'
import { seasonEndAt, seasonStartForRound } from '../src/game/calendar.ts'
import { FORMATIONS } from '../src/game/data/formations.ts'
import { createInitialGame } from '../src/game/state.ts'
import type { FormationId } from '../src/game/types.ts'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createFmMcpServer } from '../mcp/server.ts'

const servers: AppServer[] = []
const dirs: string[] = []

async function start(now?: () => number, tickMs = 0) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-server-test-'))
  dirs.push(dir)
  const app = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), tickMs, now })
  servers.push(app)
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const port = (app.server.address() as AddressInfo).port
  return { app, base: `http://127.0.0.1:${port}`, dir }
}

async function register(base: string, username = `u${Date.now()}${Math.random().toString(36).slice(2, 6)}`) {
  const response = await fetch(`${base}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'secret123' }),
  })
  expect(response.status).toBe(201)
  return response.json() as Promise<{ token: string; user: { username: string }; revision: number; game: Record<string, any> }>
}

async function readSse(reader: ReadableStreamDefaultReader<Uint8Array>, previous = ''): Promise<{ data: any; rest: string }> {
  let buffer = previous
  for (;;) {
    const index = buffer.indexOf('\n\n')
    if (index >= 0) {
      const block = buffer.slice(0, index)
      buffer = buffer.slice(index + 2)
      const line = block.split('\n').find((item) => item.startsWith('data: '))
      if (line) return { data: JSON.parse(line.slice(6)), rest: buffer }
      continue
    }
    const chunk = await reader.read()
    if (chunk.done) throw new Error('SSE closed')
    buffer += new TextDecoder().decode(chunk.value)
  }
}

afterEach(() => {
  for (const app of servers.splice(0)) app.close()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('联机服务器 / 账号 / SSE', () => {
  it('注册、登录、读取存档、写入存档', async () => {
    const { base } = await start()
    const account = await register(base, 'alice')
    expect(account.token).toHaveLength(64)
    expect(account.game.version).toBe(3)
    expect(account.game.roster.length).toBeGreaterThan(10)

    const login = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'secret123' }),
    })
    expect(login.status).toBe(200)
    const session = await login.json() as { token: string }
    const gameResponse = await fetch(`${base}/api/game`, { headers: { Authorization: `Bearer ${session.token}` } })
    expect(gameResponse.status).toBe(200)
    const current = await gameResponse.json() as { revision: number; game: Record<string, any> }
    // 联机存档里俱乐部名字只能走改名接口，普通保存用战术设置做标记。
    const originalName = current.game.clubName
    current.game.clubName = '联机队'
    current.game.lineup.tactics.tempo = 'slow'
    const put = await fetch(`${base}/api/game`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: current.game, baseRevision: current.revision }),
    })
    expect(put.status).toBe(200)
    const saved = await put.json() as { revision: number }
    expect(saved.revision).toBe(current.revision + 1)

    const reload = await fetch(`${base}/api/game`, { headers: { Authorization: `Bearer ${session.token}` } })
    const next = await reload.json() as { revision: number; game: Record<string, any> }
    expect(next.revision).toBe(saved.revision)
    expect(next.game.lineup.tactics.tempo).toBe('slow')
    expect(next.game.clubName).toBe(originalName)
  })

  it('拒绝缺失或损坏赛程的存档，不污染已保存的数据', async () => {
    const { base } = await start()
    const account = await register(base, 'invalid_fixtures')
    const headers = { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' }
    for (const fixtures of [undefined, null, [null], [{ round: 1, played: 'yes' }]]) {
      const invalid = structuredClone(account.game)
      delete invalid.economy
      invalid.season.fixtures = fixtures
      const response = await fetch(`${base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game: invalid, baseRevision: account.revision }) })
      expect(response.status).toBe(400)
    }
    const saved = await (await fetch(`${base}/api/game`, { headers })).json() as { revision: number; game: Record<string, any> }
    expect(saved.revision).toBe(account.revision)
    expect(saved.game.season.fixtures).toEqual(account.game.season.fixtures)
  })

  it('拒绝损坏的球员卡库存；合法的库存能存能取', async () => {
    const { base } = await start()
    const account = await register(base, 'card_inventory')
    const headers = { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' }
    for (const cards of ['nope', [null], [{ id: 'card-1' }], [{ id: 'card-1', playerId: 'p', attrs: {}, positions: {}, personality: {}, skills: 'x' }]]) {
      const invalid = structuredClone(account.game)
      invalid.cards = cards
      const response = await fetch(`${base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game: invalid, baseRevision: account.revision }) })
      expect(response.status).toBe(400)
    }
    const owner = account.game.roster[0]
    const card = { id: 'card-1', playerId: owner.id, playerName: owner.name, serial: 1, version: 1, parentCardId: null, routeId: null, createdAt: 1, attrs: owner.attrs, positions: owner.positions, personality: owner.personality, skills: owner.skills }
    const valid = structuredClone(account.game)
    valid.cards = [card]
    const put = await fetch(`${base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game: valid, baseRevision: account.revision }) })
    expect(put.status).toBe(200)
    const saved = await (await fetch(`${base}/api/game`, { headers })).json() as { game: Record<string, any> }
    expect(saved.game.cards).toEqual([card])
  })

  it('服务器重启后把旧存档已确认的培养成果收进库存', async () => {
    const { app, base, dir } = await start()
    const account = await register(base, 'legacy_cards')
    app.close()
    const db = readStoredAccounts(dir)
    const oldGame = db.accounts[0].game
    delete oldGame.cards
    const trained = oldGame.roster[0]
    trained.version = 2
    trained.attrs.passing += 50
    writeStoredAccounts(dir, db)
    const restarted = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), tickMs: 0 })
    servers.push(restarted)
    await new Promise<void>((resolve) => restarted.server.listen(0, '127.0.0.1', resolve))
    const port = (restarted.server.address() as AddressInfo).port
    const response = await fetch(`http://127.0.0.1:${port}/api/game`, { headers: { Authorization: `Bearer ${account.token}` } })
    const result = await response.json() as { revision: number; game: Record<string, any> }
    expect(result.revision).toBeGreaterThan(account.revision)
    expect(result.game.cards).toHaveLength(1)
    const player = result.game.roster.find((item: any) => item.id === trained.id)
    expect(player.equippedCardId).toBe(result.game.cards[0].id)
    expect(result.game.cards[0].attrs).toEqual(player.attrs)
    expect(result.game.cards[0].version).toBe(2)
  })

  it('服务器重启后先迁移旧存档经济和招牌技能，再推进赛季', async () => {
    const { app, base, dir } = await start()
    const account = await register(base, 'legacy_migration')
    app.close()
    const db = readStoredAccounts(dir)
    const oldGame = db.accounts[0].game
    delete oldGame.economy
    // 二级开局没有球星：把一名储备球星放进阵容，当作玩家后来签下的人。
    const star = oldGame.reserveStars!.shift()!
    oldGame.roster.push(star)
    const signature = star.signatureSkill!
    delete star.signatureSkill
    delete star.skillTiers
    star.skills = []
    oldGame.season.startedAt = seasonStartForRound(Date.now(), 2)
    writeStoredAccounts(dir, db)
    const restarted = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), tickMs: 0 })
    servers.push(restarted)
    await new Promise<void>((resolve) => restarted.server.listen(0, '127.0.0.1', resolve))
    const port = (restarted.server.address() as AddressInfo).port
    const response = await fetch(`http://127.0.0.1:${port}/api/game`, { headers: { Authorization: `Bearer ${account.token}` } })
    const result = await response.json() as { revision: number; game: Record<string, any> }
    expect(result.revision).toBeGreaterThan(account.revision)
    const fixture = result.game.season.fixtures.find((item: any) => item.round === 1 && item.isPlayer)
    // 迁移只补球迷与设施阶段，金额按第 1 轮的赛果结算；这里只校验结算发生且只发生一次。
    const economy = result.game.economy as Record<string, number>
    expect(economy.lastIncomeRound).toBe(1)
    expect(economy.balance).toBeGreaterThan(100000)
    expect(economy.stageVersion).toBe(3)
    const expectedBalance = economy.balance
    expect(result.game.roster.find((player: any) => player.id === star.id)).toMatchObject({ signatureSkill: signature, skillTiers: { [signature]: 'rainbow' } })
    await restarted.flush()
    const stored = readStoredAccounts(dir)
    expect(stored.accounts[0].game.economy!.balance).toBe(expectedBalance)
  })

  it('错误密码被拒绝，过期 revision 返回 409', async () => {
    const { base } = await start()
    const account = await register(base, 'bob')
    const bad = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bob', password: 'wrong' }),
    })
    expect(bad.status).toBe(401)

    account.game.clubName = 'B'
    const first = await fetch(`${base}/api/game`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: account.game, baseRevision: account.revision }),
    })
    expect(first.status).toBe(200)
    const conflict = await fetch(`${base}/api/game`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: account.game, baseRevision: account.revision }),
    })
    expect(conflict.status).toBe(409)
  })

  it('SSE 收到初始状态和后续保存广播', async () => {
    const { base } = await start()
    const account = await register(base, 'carol')
    const controller = new AbortController()
    const response = await fetch(`${base}/api/events?token=${account.token}`, { signal: controller.signal })
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    const first = await readSse(reader)
    expect(first.data.revision).toBe(account.revision)
    expect(first.data.game.clubName).toBe(account.game.clubName)
    // 连上之后紧跟全服市场与全服聊天初始快照。
    const market = await readSse(reader, first.rest)
    expect(market.data.type).toBe('market')
    const chat = await readSse(reader, market.rest)
    expect(chat.data.type).toBe('chat')

    account.game.lineup.tactics.tempo = 'slow'
    await fetch(`${base}/api/game`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json', 'X-FM-Client': 'test-tab' },
      body: JSON.stringify({ game: account.game, baseRevision: account.revision }),
    })
    const second = await readSse(reader, chat.rest)
    expect(second.data.revision).toBe(account.revision + 1)
    expect(second.data.source).toBe('test-tab')
    expect(second.data.game.lineup.tactics.tempo).toBe('slow')
    controller.abort()
  })

  it('账号与会话在服务器重启后仍可用', async () => {
    const { app, base, dir } = await start()
    const account = await register(base, 'erin')
    app.close()

    const restarted = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), tickMs: 0 })
    servers.push(restarted)
    await new Promise<void>((resolve) => restarted.server.listen(0, '127.0.0.1', resolve))
    const port = (restarted.server.address() as AddressInfo).port
    const response = await fetch(`http://127.0.0.1:${port}/api/game`, { headers: { Authorization: `Bearer ${account.token}` } })
    expect(response.status).toBe(200)
    const current = await response.json() as { game: { clubName: string } }
    expect(current.game.clubName).toBe(account.game.clubName)
  })

  it('联赛进行时服务器保护比赛和赛季，非比赛修改可跨实时进度保存', async () => {
    let now = Date.now()
    const { base } = await start(() => now)
    const account = await register(base, 'liveguard')
    const headers = { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' }
    const started = await (await fetch(`${base}/api/match/action`, { method: 'POST', headers, body: JSON.stringify({ action: 'start_league' }) })).json() as { revision: number; game: Record<string, any> }
    const oldMatch = structuredClone(started.game.activeMatch)
    now += 20_000
    const current = await (await fetch(`${base}/api/game`, { headers })).json() as { revision: number; game: Record<string, any> }
    expect(current.revision).toBeGreaterThan(started.revision)
    expect(current.game.activeMatch.elapsedSeconds).toBe(20)
    const adjustment = await fetch(`${base}/api/match/action`, { method: 'POST', headers, body: JSON.stringify({ action: 'set_match_tactics', mentality: 'attack' }) })
    expect(adjustment.status).toBe(200)
    const adjusted = await adjustment.json() as { game: Record<string, any> }
    started.game.lineup.tactics.press = 'low'
    started.game.activeMatch = undefined
    started.game.season.round = 30
    const put = await fetch(`${base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game: started.game, baseRevision: started.revision }) })
    expect(put.status).toBe(200)
    const merged = await (await fetch(`${base}/api/game`, { headers })).json() as { revision: number; game: Record<string, any> }
    expect(merged.game.lineup.tactics.press).toBe('low')
    expect(merged.game.season.round).toBe(1)
    expect(merged.game.activeMatch.context.isLeague).toBe(true)
    expect(merged.game.activeMatch.engineState.log.length).toBe(adjusted.game.activeMatch.engineState.log.length)
    expect(merged.game.activeMatch.engineState.log.at(-1).type).toBe('tactic')
    const conflict = await fetch(`${base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game: started.game, baseRevision: started.revision }) })
    expect(conflict.status).toBe(409)
    now += 580_000
    const finished = await (await fetch(`${base}/api/game`, { headers })).json() as { revision: number; game: Record<string, any> }
    expect(finished.game.activeMatch).toBeUndefined()
    expect(finished.game.matchHistory).toHaveLength(1)
    finished.game.activeMatch = oldMatch
    const forged = await fetch(`${base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game: finished.game, baseRevision: finished.revision }) })
    // 服务器在两次请求之间可能又推进了一轮（409）；两种拒绝都算没接受伪造的比赛。
    expect([400, 409]).toContain(forged.status)
    const afterForgery = await (await fetch(`${base}/api/game`, { headers })).json() as { game: Record<string, any> }
    expect(afterForgery.game.activeMatch).toBeUndefined()
  })

  it('联赛伤病由服务器持久化、跨旧客户端保存和重启，并对 Agent 隐藏易伤属性', async () => {
    let now = Date.now()
    const { app, base, dir } = await start(() => now)
    const account = await register(base, 'injuryguard')
    const headers = { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' }
    // 伤病本身是低概率事件（约 1/40 场），这里直接把一条恢复记录写进存档，
    // 专门验证“服务器持久化 / 跨旧客户端保存 / 重启 / Agent 隐藏易伤属性”这条链路；
    // 由比赛产生伤病的那条路径在 tests/injury.test.ts 里单独覆盖。
    const prepared = createInitialGame(49)
    const injured = prepared.roster[0]
    const personId = personKey(injured)
    const recoverAt = now + 2 * 6 * 3600_000
    prepared.injuries = { [personId]: recoverAt }
    const init = await fetch(`${base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game: prepared, baseRevision: account.revision }) })
    expect(init.status).toBe(200)
    const token = await (await fetch(`${base}/api/agent/token`, { method: 'POST', headers })).json() as { token: string }
    const current = await (await fetch(`${base}/api/game`, { headers })).json() as { revision: number; game: Record<string, any> }
    expect(current.game.injuries[personId]).toBe(recoverAt)
    const player = current.game.roster.find((p: any) => p.id === injured.id)
    expect(player).toBeDefined()
    const started = { game: current.game, revision: current.revision }
    // 旧客户端保存时把 injuries 清空，也不能把服务器已知的伤病抹掉。
    started.game.injuries = {}
    const put = await fetch(`${base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game: started.game, baseRevision: started.revision }) })
    expect(put.status).toBe(200)
    const merged = await (await fetch(`${base}/api/game`, { headers })).json() as { game: Record<string, any> }
    expect(merged.game.injuries[personId]).toBe(recoverAt)
    const agentHeaders = { Authorization: `Bearer ${token.token}` }
    const state = await (await fetch(`${base}/api/agent/state`, { headers: agentHeaders })).json() as { game: Record<string, any> }
    expect(state.game.roster.find((p: any) => p.id === player.id).injuryUntil).toBe(recoverAt)
    expect(JSON.stringify(state)).not.toContain('injuryProneness')

    app.close()
    servers.splice(servers.indexOf(app), 1)
    const restarted = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), tickMs: 0, now: () => now })
    servers.push(restarted)
    await new Promise<void>((resolve) => restarted.server.listen(0, '127.0.0.1', resolve))
    const port = (restarted.server.address() as AddressInfo).port
    const url = `http://127.0.0.1:${port}/api/agent/state`
    const afterRestart = await (await fetch(url, { headers: agentHeaders })).json() as { game: Record<string, any> }
    expect(afterRestart.game.roster.find((p: any) => p.id === player.id).injuryUntil).toBe(recoverAt)
    now = recoverAt
    const recovered = await (await fetch(url, { headers: agentHeaders })).json() as { game: Record<string, any> }
    expect(recovered.game.roster.find((p: any) => p.id === player.id).injuryUntil).toBeNull()
  })

  it('无浏览器时后台推进，服务器重启后按真实时间补足并只结算一次', async () => {
    let now = Date.now()
    const { app, base, dir } = await start(() => now, 10)
    const account = await register(base, 'realtimerestart')
    const headers = { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' }
    expect((await fetch(`${base}/api/match/action`, { method: 'POST', headers, body: JSON.stringify({ action: 'start_league' }) })).status).toBe(200)
    now += 20_000
    const until = Date.now() + 3000
    let disk: Record<string, any> = {}
    while (Date.now() < until) {
      disk = readStoredAccounts(dir)
      if (disk.accounts[0].game.activeMatch?.elapsedSeconds === 20) break
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
    expect(disk.accounts[0].game.activeMatch.elapsedSeconds).toBe(20)
    app.close()
    servers.splice(servers.indexOf(app), 1)
    now += 580_000
    const restarted = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), tickMs: 0, now: () => now })
    servers.push(restarted)
    await new Promise<void>((resolve) => restarted.server.listen(0, '127.0.0.1', resolve))
    const port = (restarted.server.address() as AddressInfo).port
    const url = `http://127.0.0.1:${port}/api/game`
    const one = await (await fetch(url, { headers })).json() as { game: { matchHistory: unknown[]; activeMatch?: unknown } }
    expect(one.game.activeMatch).toBeUndefined()
    expect(one.game.matchHistory).toHaveLength(1)
    const two = await (await fetch(url, { headers })).json() as { game: { matchHistory: unknown[] } }
    expect(two.game.matchHistory).toHaveLength(1)
  })

})

describe('Agent API', () => {
  it('MCP 设置的换人计划由服务器执行，重启后不提前或重复', async () => {
    let now = Date.now()
    const { app, base, dir } = await start(() => now)
    const account = await register(base, 'subsagent')
    const headers = { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' }
    const token = (await (await fetch(`${base}/api/agent/token`, { method: 'POST', headers })).json() as { token: string }).token
    const lineup = account.game.lineup
    const slots = FORMATIONS[lineup.formationId as FormationId].slots
    const pairs = lineup.starters.flatMap((starter: { slotId: string; playerId: string }) => {
      const position = slots.find((slot) => slot.id === starter.slotId)!.position
      return lineup.bench.filter((id: string) => account.game.roster.find((player: { id: string }) => player.id === id).positions[position] > 0)
        .map((id: string) => ({ outId: starter.playerId, inId: id }))
    })
    expect(pairs.length).toBeGreaterThan(0)
    const plan = { timed: [{ atMinute: 10, ...pairs[0] }], staminaBelow: null, onInjury: false }
    const mcp = createFmMcpServer({ server: base, token })
    const client = new Client({ name: 'test-subs', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await mcp.connect(serverTransport)
    await client.connect(clientTransport)
    expect((await client.listTools()).tools.some((tool) => tool.name === 'set_auto_subs')).toBe(true)
    expect((await client.callTool({ name: 'set_auto_subs', arguments: { plan } })).isError).not.toBe(true)
    const invalid = await fetch(`${base}/api/agent/action`, { method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'set_auto_subs', plan: { ...plan, staminaBelow: 101 } }) })
    expect(invalid.status).toBe(400)
    const started = await fetch(`${base}/api/match/action`, { method: 'POST', headers, body: JSON.stringify({ action: 'start_league' }) })
    expect(started.status).toBe(200)
    now += 25_000
    let saved = await (await fetch(`${base}/api/game`, { headers })).json() as { game: Record<string, any>; revision: number }
    expect(saved.game.autoSubs).toEqual(plan)
    expect(saved.game.activeMatch.engineState.instructions.filter((i: { autoReason?: string }) => i.autoReason === 'timed')).toHaveLength(0)
    await client.close()
    await mcp.close()
    app.close()
    const restarted = createAppServer({ dataDir: dir, tickMs: 0, now: () => now })
    servers.push(restarted)
    await new Promise<void>((resolve) => restarted.server.listen(0, '127.0.0.1', resolve))
    const resumed = `http://127.0.0.1:${(restarted.server.address() as AddressInfo).port}`
    now += 50_000
    saved = await (await fetch(`${resumed}/api/game`, { headers })).json() as typeof saved
    const instructions = saved.game.activeMatch.engineState.instructions.filter((i: { autoReason?: string }) => i.autoReason === 'timed')
    expect(instructions).toHaveLength(1)
    expect(instructions[0].outId).toMatch(new RegExp(`:${pairs[0].outId}$`))
    const savedAgain = await (await fetch(`${resumed}/api/game`, { headers })).json() as typeof saved
    expect(savedAgain.game.activeMatch.engineState.instructions.filter((i: { autoReason?: string }) => i.autoReason === 'timed')).toHaveLength(1)
    const invalidSave = structuredClone(savedAgain.game)
    invalidSave.autoSubs = { ...plan, timed: 'invalid' }
    expect((await fetch(`${resumed}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game: invalidSave, baseRevision: savedAgain.revision }) })).status).toBe(400)
  })

  it('MCP 和 Agent 可开始下一赛季并持久保存历史', async () => {
    let clock = Date.now()
    const { base } = await start(() => clock)
    const account = await register(base, 'agent_next_season')
    const tokenResponse = await fetch(`${base}/api/agent/token`, { method: 'POST', headers: { Authorization: `Bearer ${account.token}` } })
    const { token } = await tokenResponse.json() as { token: string }
    const mcp = createFmMcpServer({ server: base, token })
    const client = new Client({ name: 'test', version: '1.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await mcp.connect(serverTransport)
    await client.connect(clientTransport)
    try {
      expect((await client.listTools()).tools.some(tool => tool.name === 'start_next_season')).toBe(true)
      expect((await client.callTool({ name: 'start_next_season', arguments: {} })).isError).toBe(true)
      account.game.season.round = 38
      account.game.season.finished = true
      for (const fixture of account.game.season.fixtures) { fixture.played = true; fixture.score = { home: 0, away: 0 } }
      account.game.economy.lastIncomeRound = 38
      const balance = account.game.economy.balance
      const put = await fetch(`${base}/api/game`, { method: 'PUT', headers: { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ game: account.game, baseRevision: account.revision }) })
      expect(put.status).toBe(200)
      // 常规赛结束后要等 12 个游戏日的赛后休整窗口走完，才允许开始新赛季。
      expect((await client.callTool({ name: 'start_next_season', arguments: {} })).isError).toBe(true)
      clock = Math.max(clock, seasonEndAt(account.game.world.seasonStartedAt))
      expect((await client.callTool({ name: 'start_next_season', arguments: {} })).isError).not.toBe(true)
      const saved = await (await fetch(`${base}/api/game`, { headers: { Authorization: `Bearer ${account.token}` } })).json() as { game: Record<string, any> }
      expect(saved.game.season.index).toBe(2)
      expect(saved.game.season.round).toBe(1)
      expect(saved.game.seasonHistory).toHaveLength(1)
      expect(saved.game.seasonHistory[0].fixtures.every((fixture: { played: boolean }) => fixture.played)).toBe(true)
      expect(saved.game.economy.balance).toBe(balance)
      // 重试是幂等的空操作：服务器刚换过季，再点一次不该报错。
      const retry = await fetch(`${base}/api/agent/action`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start_next_season' }) })
      expect(retry.status).toBe(200)
      expect((await retry.json() as { alreadyRolled?: boolean }).alreadyRolled).toBe(true)
    } finally {
      await client.close()
      await mcp.close()
    }
  })

  it('MCP and HTTP apply group training together with validated previews', async () => {
    const { base } = await start()
    const account = await register(base, 'group_training')
    const token = (await (await fetch(`${base}/api/agent/token`, { method: 'POST', headers: { Authorization: `Bearer ${account.token}` } })).json() as { token: string }).token
    const action = async (body: Record<string, unknown>) => fetch(`${base}/api/agent/action`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const [first, second] = account.game.roster.filter((player: { positions: { GK: number } }) => !player.positions.GK).slice(0, 2)
    for (const player of [first, second]) expect((await action({ action: 'start_training', playerId: player.id })).status).toBe(200)
    const mcp = createFmMcpServer({ server: base, token })
    const client = new Client({ name: 'training-test', version: '1.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await mcp.connect(serverTransport)
    await client.connect(clientTransport)
    try {
      const request = { kind: 'activity', activityId: 'exchange', teammateIds: [second.id] }
      const preview = await client.callTool({ name: 'preview_training', arguments: { playerId: first.id, request } })
      expect(preview.isError).not.toBe(true)
      const result = JSON.parse((preview.content as Array<{ text: string }>)[0].text)
      expect(result.result.plan).toMatchObject({ fatigue: 0, quality: { label: expect.any(String), multiplier: expect.any(Number) } })
      expect((await client.callTool({ name: 'training_action', arguments: { playerId: first.id, request } })).isError).not.toBe(true)
      const view = await (await fetch(`${base}/api/agent/state`, { headers: { Authorization: `Bearer ${token}` } })).json() as { game: { trainingSessions: Array<{ playerId: string; action: number; actionsTotal: number; stamina: number; pendingEvent: { id: string } }> } }
      for (const id of [first.id, second.id]) expect(view.game.trainingSessions.find(session => session.playerId === id)).toMatchObject({ action: 1, actionsTotal: 30, stamina: 100, pendingEvent: { id: 'main_intake' } })
      const invalid = await action({ action: 'training_action', playerId: first.id, request: { ...request, teammateIds: [second.id, second.id] } })
      expect(invalid.status).toBe(400)
      const saved = await (await fetch(`${base}/api/game`, { headers: { Authorization: `Bearer ${account.token}` } })).json() as { game: { training: Record<string, { action: number; fatigue: number; pendingEventId: string }> } }
      for (const id of [first.id, second.id]) expect(saved.game.training[id]).toMatchObject({ action: 1, fatigue: 0, pendingEventId: 'main_intake' })
    } finally {
      await client.close()
      await mcp.close()
    }
  })

  it('Agent 联赛只能按现实时间推进，友谊赛仍可步进和跳过', async () => {
    let now = Date.now()
    const { base } = await start(() => now)
    const account = await register(base, 'agentuser')

    const tokenResponse = await fetch(`${base}/api/agent/token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${account.token}` },
    })
    expect(tokenResponse.status).toBe(200)
    const { token: agentToken } = await tokenResponse.json() as { token: string }
    expect(agentToken.startsWith('fm_')).toBe(true)

    const stateResponse = await fetch(`${base}/api/agent/state`, { headers: { Authorization: `Bearer ${agentToken}` } })
    expect(stateResponse.status).toBe(200)
    const state = await stateResponse.json() as { game: { roster: Array<{ id: string; energy: number; positions: Record<string, number>; attrs: Record<string, number>; ceilings?: unknown; pa?: unknown }>; season: { round: number } } }
    expect(state.game.roster.length).toBeGreaterThan(10)
    const outfield = state.game.roster.find((player) => player.positions.GK === 0)!
    expect(outfield.attrs.reflexes).toBeUndefined()
    expect(outfield.ceilings).toBeUndefined()
    expect(outfield.pa).toBeUndefined()
    expect(outfield.attrs.passing).toBeGreaterThanOrEqual(0)
    expect(outfield.attrs.passing).toBe(account.game.roster.find((player: { id: string }) => player.id === outfield.id).attrs.passing)

    const sessionCannotUseAgent = await fetch(`${base}/api/agent/state`, { headers: { Authorization: `Bearer ${account.token}` } })
    expect(sessionCannotUseAgent.status).toBe(401)
    const agentCannotUseSave = await fetch(`${base}/api/game`, { headers: { Authorization: `Bearer ${agentToken}` } })
    expect(agentCannotUseSave.status).toBe(401)

    const action = (body: Record<string, unknown>) => fetch(`${base}/api/agent/action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    // 旧的 7 人制阵型已经停用
    expect((await action({ action: 'auto_lineup', formationId: '1-3-2-1' })).status).toBe(400)
    expect((await action({ action: 'auto_lineup', formationId: '3-5-2' })).status).toBe(200)
    const trainee = state.game.roster.find((player) => player.energy >= 30)!
    const detail = await action({ action: 'get_player', playerId: trainee.id })
    expect(detail.status).toBe(200)
    expect((await detail.json() as { result: { history: unknown[] } }).result.history).toBeDefined()
    expect((await action({ action: 'start_training', playerId: trainee.id })).status).toBe(200)

    const preview = await action({ action: 'preview_training', playerId: trainee.id, request: { kind: 'activity', activityId: 'exchange' } })
    expect(preview.status).toBe(200)
    const previewBody = await preview.json() as { result: { valid: boolean; plan: { gains: Record<string, number> } } }
    expect(previewBody.result.valid).toBe(true)
    expect(Object.keys(previewBody.result.plan.gains).length).toBeGreaterThan(0)

    expect((await action({ action: 'training_action', playerId: trainee.id, request: { kind: 'activity', activityId: 'exchange' } })).status).toBe(200)

    const started = await action({ action: 'start_league' })
    expect(started.status).toBe(200)
    const live = await action({ action: 'get_match' })
    expect(live.status).toBe(200)
    const liveBody = await live.json() as { result: { playerSide: string; onPitch: Array<{ id: string; position: string }>; availableBench: Array<{ id: string }>; commentary: Array<{ seq: number; clock: number }> } }
    expect(liveBody.result.onPitch).toHaveLength(11)
    expect([...liveBody.result.onPitch, ...liveBody.result.availableBench].every((player) => player.id.startsWith(`${liveBody.result.playerSide}:`))).toBe(true)
    expect(liveBody.result.commentary.every((line) => line.clock === 0)).toBe(true)
    expect((await action({ action: 'advance_match', steps: 25 })).status).toBe(400)
    expect((await action({ action: 'play_match' })).status).toBe(400)
    expect((await action({ action: 'coach_pause' })).status).toBe(400)
    const mcp = createFmMcpServer({ server: base, token: agentToken })
    const client = new Client({ name: 'test', version: '1.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await mcp.connect(serverTransport)
    await client.connect(clientTransport)
    const tools = await client.listTools()
    expect(tools.tools.find((tool) => tool.name === 'advance_match')?.description).toContain('仅限友谊赛')
    expect((await client.callTool({ name: 'advance_match', arguments: { steps: 50 } })).isError).toBe(true)
    expect((await client.callTool({ name: 'play_match', arguments: {} })).isError).toBe(true)
    expect((await client.callTool({ name: 'set_match_tactics', arguments: { mentality: 'balanced' } })).isError).not.toBe(true)
    const balanced = await (await action({ action: 'get_match' })).json() as { result: { mentality: string; tactics: { tempo: string; line: string } } }
    expect(balanced.result.mentality).toBe('balanced')
    expect(balanced.result.tactics).toMatchObject({ tempo: 'normal', line: 'mid' })
    await client.close()
    await mcp.close()
    now += 25_000
    const progressed = await (await action({ action: 'get_match' })).json() as { result: { clock: number; commentary: Array<{ clock: number }> } }
    expect(progressed.result.clock).toBe(225)
    expect(progressed.result.commentary.length).toBeGreaterThan(liveBody.result.commentary.length)
    expect(progressed.result.commentary.every((line) => line.clock <= 225)).toBe(true)

    expect((await action({ action: 'set_match_tactics', tactics: { attack: 'wing', passing: 'short', tempo: 'fast', line: 'high', press: 'high' } })).status).toBe(400)
    const tactics = await action({ action: 'set_match_tactics', mentality: 'attack' })
    expect(tactics.status).toBe(200)
    const tacticsBody = await tactics.json() as { result: { tactics: { tempo: string }; commentary: Array<{ clock: number }> } }
    expect(tacticsBody.result.tactics.tempo).toBe('fast')
    expect(tacticsBody.result.commentary.at(-1)!.clock).toBe(225)

    now += 575_000
    const saved = await (await fetch(`${base}/api/game`, { headers: { Authorization: `Bearer ${account.token}` } })).json() as { game: { matchHistory: Array<{ id: string; score: { home: number; away: number }; goalDetails: unknown[]; commentary: Array<{ score: { home: number; away: number } }> }>; activeMatch?: unknown } }
    expect(saved.game.activeMatch).toBeUndefined()
    const record = saved.game.matchHistory[0]
    expect(record.goalDetails.length).toBe(record.score.home + record.score.away)
    expect(record.commentary.at(-1)!.score).toEqual(record.score)
    const reviewed = await action({ action: 'get_match', matchId: record.id })
    expect(reviewed.status).toBe(200)
    expect((await reviewed.json() as { result: { record: { id: string }; review: unknown[] } }).result.record.id).toBe(record.id)

    const available = await (await fetch(`${base}/api/agent/state`, { headers: { Authorization: `Bearer ${agentToken}` } })).json() as { game: { teams: Array<{ id: string }> } }
    expect((await action({ action: 'start_friendly', teamId: available.game.teams[0].id })).status).toBe(200)
    expect((await action({ action: 'advance_match', steps: 5 })).status).toBe(200)
    expect((await action({ action: 'coach_pause' })).status).toBe(200)
    const played = await action({ action: 'play_match' })
    expect(played.status).toBe(200)
    expect((await played.json() as { result: { commentary: unknown[] } }).result.commentary.length).toBeGreaterThan(0)
  })
})
