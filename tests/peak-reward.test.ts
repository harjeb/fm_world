import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { AccountStore } from '../server/account-store.ts'
import { createAppServer, type AppServer } from '../server/app.ts'
import { loadPveContent } from '../src/game/pve-content.ts'
beforeAll(loadPveContent)
import { caOf } from '../src/game/ca.ts'
import { createInitialGame } from '../src/game/state.ts'
import { buildPeakTeam } from '../src/game/peak.ts'
import { claimPeakReward, peakRewardReady } from '../src/game/peak-reward.ts'
import { SQUAD_LIMIT } from '../src/game/market.ts'
import { boardEffectiveWageCap, ensureBoard, evaluateAndRollBoardSeason } from '../src/game/board.ts'
import { TSUBASA_WAGE, previewContractRenewal, repairInflatedContractWages, wageForPlayer, worldWageBill } from '../src/game/wages.ts'

function setupPeak50TightBoardAccount(dir: string, userId: string): void {
  const worldPath = path.join(dir, 'world.json')
  const rawWorld = JSON.parse(fs.readFileSync(worldPath, 'utf8'))
  rawWorld.world.seasonIndex = 2
  fs.writeFileSync(worldPath, JSON.stringify(rawWorld))

  const store = new AccountStore(dir)
  const account = store.accounts.find((a) => a.id === userId)!
  account.game.season.index = 2
  if (account.game.world) account.game.world.seasonIndex = 2
  account.game.pve!.peak.cleared = 50
  ensureBoard(account.game)
  evaluateAndRollBoardSeason(account.game, {
    seasonIndex: 1,
    tier: account.game.season.tier ?? 'division2',
    finish: 5,
    totalTeams: 20,
    clubIds: ['player'],
  })
  const tightBill = worldWageBill(account.game)
  const effectiveBefore = boardEffectiveWageCap(account.game)!
  account.game.board!.current!.wageCap = Math.max(0, account.game.board!.current!.wageCap - (effectiveBefore - tightBill))
  account.game.board!.current!.locked = true
  store.save(account)
  store.flushSync()
  store.close()
}

const servers: AppServer[] = []
const dirs: string[] = []

afterEach(async () => {
  for (const app of servers.splice(0)) await app.shutdown()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const boss = () => buildPeakTeam(50)
const tsubasa = () => boss().players.find((player) => player.name === '大空翼')!

function readyGame(seed = 12345) {
  const game = createInitialGame(seed)
  game.pve!.peak.cleared = 50
  return game
}

describe('第 50 关全明星奖励', () => {
  it('通关后可选一名球员，按当前 CA 入队，并保留逐人 PA 上限', () => {
    const game = readyGame()
    const template = tsubasa()
    expect(peakRewardReady(game)).toBe(true)
    const result = claimPeakReward(game, template.id)
    expect(result.ok, result.ok ? '' : result.error).toBe(true)
    if (!result.ok) return
    const added = result.player
    expect(added.name).toBe('大空翼')
    expect(added.id).not.toBe(template.id)
    expect(added.id.startsWith('reward-')).toBe(true)
    expect(caOf(added.attrs, added.positions.GK > 0)).toBeCloseTo(caOf(template.attrs, template.positions.GK > 0), 5)
    expect(added.pa).toBeCloseTo(1500, 5)
    expect(added.ceilings).toEqual(template.ceilings)
    expect(added.contract?.wage).toBe(TSUBASA_WAGE)
    expect(TSUBASA_WAGE).toBe(1000)
    expect(game.roster.at(-1)!.id).toBe(added.id)
    expect(game.pve!.peak.reward50?.playerId).toBe(added.id)
    expect(peakRewardReady(game)).toBe(false)
  })

  it('每个账号只能领取一次', () => {
    const game = readyGame(12346)
    expect(claimPeakReward(game, tsubasa().id).ok).toBe(true)
    const again = claimPeakReward(game, tsubasa().id)
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error).toContain('已经领取')
  })

  it('阵容满 30 人时拒绝领取，不悄悄替换球员', () => {
    const game = readyGame(12347)
    const fill = game.roster[0]
    while (game.roster.length < SQUAD_LIMIT) {
      game.roster.push({ ...structuredClone(fill), id: `fill-${game.roster.length}` })
    }
    const result = claimPeakReward(game, tsubasa().id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('阵容已满')
    expect(game.roster).toHaveLength(SQUAD_LIMIT)
  })

  it('联机环境下即使工资帽已满，权威领取接口 /api/peak/claim-reward 也可正确落盘且不再显示待领取', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-peak-claim-'))
    dirs.push(dir)
    const app1 = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), tickMs: 0 })
    await new Promise<void>((resolve) => app1.server.listen(0, '127.0.0.1', resolve))
    const base1 = `http://127.0.0.1:${(app1.server.address() as AddressInfo).port}`

    const reg = await fetch(`${base1}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'tsubasaclaimer', password: 'secret123' }),
    })
    expect(reg.status).toBe(201)
    const auth = await reg.json() as { token: string; user: { id: string; agentToken: string } }
    await app1.shutdown()

    // 构造 S2+ 董事会满工资帽且已通关第 50 关的服务端账号存档（大空翼 25,000 周薪必然超过当前有效工资帽）
    setupPeak50TightBoardAccount(dir, auth.user.id)

    const app2 = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), tickMs: 0 })
    servers.push(app2)
    await new Promise<void>((resolve) => app2.server.listen(0, '127.0.0.1', resolve))
    const base2 = `http://127.0.0.1:${(app2.server.address() as AddressInfo).port}`

    const tsubasaTemplate = tsubasa()
    const claimRes = await fetch(`${base2}/api/peak/claim-reward`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: tsubasaTemplate.id }),
    })
    expect(claimRes.status).toBe(200)
    const claimBody = await claimRes.json() as { ok: boolean; playerName: string; game: any }
    expect(claimBody.ok).toBe(true)
    expect(claimBody.playerName).toBe('大空翼')
    expect(claimBody.game.pve.peak.reward50?.templateId).toBe(tsubasaTemplate.id)

    // GET /api/game 与 Agent get_pve 均已确认落盘，不再显示待领取
    const gameRes = await fetch(`${base2}/api/game`, { headers: { Authorization: `Bearer ${auth.token}` } })
    const gameJson = await gameRes.json() as { game: any }
    expect(peakRewardReady(gameJson.game)).toBe(false)
    expect(gameJson.game.roster.some((p: any) => p.name === '大空翼')).toBe(true)

    const tokRes = await fetch(`${base2}/api/agent/token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.token}` },
    })
    const { token: agentToken } = await tokRes.json() as { token: string }
    const pveRes = await fetch(`${base2}/api/agent/action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_pve' }),
    })
    const pveJson = await pveRes.json() as { result: any }
    expect(pveJson.result.peak.reward50Ready).toBe(false)
    expect(pveJson.result.peak.reward50?.templateId).toBe(tsubasaTemplate.id)

    // 重复领取被拒绝
    const dupRes = await fetch(`${base2}/api/peak/claim-reward`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: tsubasaTemplate.id }),
    })
    expect(dupRes.status).toBe(400)
  })

  it('旧版客户端通过 PUT /api/game 在满工资帽下补存第 50 关大空翼也可放行，普通超帽加薪仍拦截 409', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-peak-legacy-put-'))
    dirs.push(dir)
    const app1 = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), tickMs: 0 })
    await new Promise<void>((resolve) => app1.server.listen(0, '127.0.0.1', resolve))
    const base1 = `http://127.0.0.1:${(app1.server.address() as AddressInfo).port}`

    const reg = await fetch(`${base1}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'legacyclaimer', password: 'secret123' }),
    })
    expect(reg.status).toBe(201)
    const auth = await reg.json() as { token: string; user: { id: string } }
    await app1.shutdown()

    setupPeak50TightBoardAccount(dir, auth.user.id)

    const app2 = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), tickMs: 0 })
    servers.push(app2)
    await new Promise<void>((resolve) => app2.server.listen(0, '127.0.0.1', resolve))
    const base2 = `http://127.0.0.1:${(app2.server.address() as AddressInfo).port}`

    const snapRes = await fetch(`${base2}/api/game`, { headers: { Authorization: `Bearer ${auth.token}` } })
    const snap = await snapRes.json() as { game: any; revision: number }

    // 1. 普通擅自涨薪仍应返回 409
    const badGame = structuredClone(snap.game)
    badGame.roster[0].contract = { clubId: 'player', wage: 999_999, expiresSeason: 6 }
    const rejectRes = await fetch(`${base2}/api/game`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: badGame, baseRevision: snap.revision }),
    })
    expect(rejectRes.status).toBe(409)

    // 2. 第 50 关奖励领取大空翼即使超出工资帽也应成功落盘 200
    const claimGame = structuredClone(snap.game)
    expect(claimPeakReward(claimGame, tsubasa().id).ok).toBe(true)
    const okRes = await fetch(`${base2}/api/game`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: claimGame, baseRevision: snap.revision }),
    })
    expect(okRes.status).toBe(200)
    const afterRes = await fetch(`${base2}/api/game`, { headers: { Authorization: `Bearer ${auth.token}` } })
    const afterJson = await afterRes.json() as { game: any }
    expect(peakRewardReady(afterJson.game)).toBe(false)
    expect(afterJson.game.pve.peak.reward50?.name).toBe('大空翼')
  })

  it('16 名《足球小将》全明星周薪在签约、续约与存量存档修复时统一为 1000', () => {
    const game = readyGame(22334)
    const allStars = boss().players
    expect(allStars).toHaveLength(16)
    for (const star of allStars) {
      expect(wageForPlayer(star)).toBe(1000)
    }

    const claimed = claimPeakReward(game, tsubasa().id)
    expect(claimed.ok).toBe(true)
    if (!claimed.ok) return
    const player = claimed.player
    expect(player.contract?.wage).toBe(1000)

    // 续约预览仍保持周薪 1000
    const preview = previewContractRenewal(game, player, 4)
    expect(preview.fairWage).toBe(1000)
    expect(preview.marketFairWage).toBe(1000)
    expect(preview.demandedWage).toBe(1000)

    // 已有存量旧高薪（如 25,000）在加载/启动修复时回调为 1000
    player.contract!.wage = 25_000
    expect(repairInflatedContractWages(game.roster)).toBe(true)
    expect(player.contract?.wage).toBe(1000)
    expect(repairInflatedContractWages(game.roster)).toBe(false)
  })
})
