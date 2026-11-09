import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { agentHandoffText } from '../src/ui/agent-handoff.ts'

const servers: AppServer[] = []
afterEach(() => { while (servers.length) servers.pop()!.close() })

async function setup() {
  const app = createAppServer({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'fm-agent-parity-')), staticDir: path.resolve('dist'), tickMs: 0 })
  servers.push(app)
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
  const registered = await (await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'parity', password: 'secret123' }) })).json() as { token: string }
  const { token } = await (await fetch(`${base}/api/agent/token`, { method: 'POST', headers: { Authorization: `Bearer ${registered.token}` } })).json() as { token: string }
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const action = async (body: Record<string, unknown>) => {
    const response = await fetch(`${base}/api/agent/action`, { method: 'POST', headers, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() as any }
  }
  const state = async () => (await (await fetch(`${base}/api/agent/state`, { headers })).json() as any).game
  return { base, action, state }
}

describe('Agent API 和手动界面能做的事一致', () => {
  it('状态里有年龄、估值、合同和可谈判的 AI 球员；全服世界可以读取', async () => {
    const { action, state } = await setup()
    const game = await state()
    const player = game.roster[0]
    expect(typeof player.age).toBe('number')
    expect(player.marketValue).toBeGreaterThan(0)
    expect(player.contract).toMatchObject({ wage: expect.any(Number), expiresSeason: expect.any(Number) })
    expect(typeof game.market.transferWindowOpen).toBe('boolean')
    expect(game.market.clubOffers.length).toBeGreaterThan(0)
    expect(game.market.clubOffers.length).toBeLessThanOrEqual(18)
    const world = await action({ action: 'get_world' })
    expect(world.status).toBe(200)
    expect(world.body.result.ownClubId).toBeTruthy()
    expect(world.body.result.clubs.length).toBeGreaterThan(8)
    expect(world.body.result.divisions.length).toBeGreaterThan(0)
  })

  it('选队、谈判买人、续约、解约都能通过 Agent 完成', async () => {
    const { action, state } = await setup()
    const world = (await action({ action: 'get_world' })).body.result
    const free = world.clubs.find((club: any) => club.tier === 'division2' && !club.managed)
    const chosen = await action({ action: 'choose_club', clubId: free.id })
    expect(chosen.status).toBe(200)
    expect((await action({ action: 'get_world' })).body.result.ownClubId).toBe(free.id)

    let game = await state()
    const offer = game.market.clubOffers[0]
    const preview = await action({ action: 'preview_signing', teamId: offer.teamId, playerId: offer.player.id })
    expect(preview.status).toBe(200)
    expect(preview.body.result.asking).toBe(offer.asking)
    expect(preview.body.result.chance).toBeGreaterThan(0)
    expect(preview.body.result.demands).toHaveProperty('goal')
    const low = await action({ action: 'sign_club_player', teamId: offer.teamId, playerId: offer.player.id, offer: 1 })
    expect(low.status).toBe(400)
    const outsider = await action({ action: 'preview_signing', teamId: offer.teamId, playerId: 'nobody' })
    expect(outsider.status).toBe(400)
    // 实际签一次：挑一名买得起、成功率封顶（必定成交）的球员；成功后共享世界里那支球队的名单也要同步去掉他。
    let deal: { teamId: string; playerId: string; offer: number } | undefined
    for (const candidate of [...game.market.clubOffers].sort((a: any, b: any) => a.asking - b.asking)) {
      const amount = Math.min(game.economy.balance, Math.ceil(candidate.asking * 1.5))
      if (amount < candidate.asking) continue
      const check = await action({ action: 'preview_signing', teamId: candidate.teamId, playerId: candidate.player.id, offer: amount, goal: 'title', role: 'star' })
      if (check.body.result.chance >= 0.98) { deal = { teamId: candidate.teamId, playerId: candidate.player.id, offer: amount }; break }
    }
    expect(deal, '应当至少有一名必定能签下的 AI 球员').toBeDefined()
    const signed = await action({ action: 'sign_club_player', ...deal!, goal: 'title', role: 'star' })
    expect(signed.status, signed.body.error).toBe(200)
    expect(signed.body.game.roster.some((player: any) => player.id === deal!.playerId)).toBe(true)
    expect(signed.body.game.economy.balance).toBe(game.economy.balance - deal!.offer)
    const after = (await action({ action: 'get_world' })).body.result
    expect(after.clubs.find((club: any) => club.id === deal!.teamId).players.some((player: any) => player.id === deal!.playerId)).toBe(false)
    expect((await state()).market.clubOffers.some((item: any) => item.player.id === deal!.playerId)).toBe(false)

    game = await state()
    const target = game.roster[game.roster.length - 1]
    const renewed = await action({ action: 'renew_contract', playerId: target.id })
    expect(renewed.status).toBe(200)
    expect(renewed.body.result.expiresSeason).toBeGreaterThanOrEqual(target.contract.expiresSeason + 2)
    const released = await action({ action: 'release_player', playerId: target.id })
    expect(released.status).toBe(200)
    expect(released.body.game.roster.some((player: any) => player.id === target.id)).toBe(false)
  })

  it('自动培养可以设置策略并连续推进进行中的一轮', async () => {
    const { action, state } = await setup()
    const game = await state()
    const playerId = game.roster.find((player: any) => player.energy >= 30).id
    const config = await action({ action: 'set_auto_training', playerId, mode: 'max', targets: { passing: 1200 } })
    expect(config.status).toBe(200)
    expect(config.body.result.mode).toBe('max')
    expect(config.body.result.targets.passing).toBe(1200)
    expect((await action({ action: 'set_auto_training', playerId, mode: 'nope' })).status).toBe(400)
    expect((await action({ action: 'run_auto_training', playerId })).status).toBe(400)
    expect((await action({ action: 'start_training', playerId })).status).toBe(200)
    const run = await action({ action: 'run_auto_training', playerId, maxSteps: 4 })
    expect(run.status, run.body.error).toBe(200)
    expect(run.body.result.steps.length).toBeGreaterThan(0)
    expect(run.body.result.steps.length).toBeLessThanOrEqual(4)
    const session = run.body.game.trainingSessions.find((item: any) => item.playerId === playerId)
    expect(session.autoTraining.mode).toBe('max')
  })

  it('可以约战全服任意一支球队', async () => {
    const { action } = await setup()
    const world = (await action({ action: 'get_world' })).body.result
    const opponent = world.clubs.find((club: any) => club.id !== world.ownClubId && club.tier !== 'division2') ?? world.clubs.find((club: any) => club.id !== world.ownClubId)
    expect((await action({ action: 'start_world_friendly', clubId: world.ownClubId })).status).toBe(400)
    const started = await action({ action: 'start_world_friendly', clubId: opponent.id })
    expect(started.status, started.body.error).toBe(200)
    expect(started.body.game.activeMatch.isLeague).toBe(false)
    const finished = await action({ action: 'play_match' })
    expect(finished.status).toBe(200)
    expect(finished.body.game.activeMatch).toBeNull()
  })
})

describe('复制给 AI 的接入说明', () => {
  it('包含令牌、文档地址、接口和游戏简介', () => {
    const text = agentHandoffText({ token: 'fm_test123', origin: 'https://fm.example.com/', clubName: '青石' })
    expect(text).toContain('fm_test123')
    expect(text).toContain('Authorization: Bearer fm_test123')
    expect(text).toContain('https://fm.example.com/api/agent/docs')
    expect(text).toContain('https://fm.example.com/api/agent/state')
    expect(text).toContain('11 人制足球经理')
    expect(text).toContain('青石')
  })
})
