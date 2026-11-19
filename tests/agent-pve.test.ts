import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAppServer } from '../server/app.ts'
import { createInitialGame } from '../src/game/state.ts'
import { applyAgentAction } from '../server/agent.ts'
import { loadPveContent } from '../src/game/pve-content.ts'
import { ensurePve } from '../src/game/pve.ts'
import { PEAK_REWARD_STAGE } from '../src/game/peak-reward.ts'
import { buildPeakTeam } from '../src/game/peak.ts'

const temps: string[] = []
const servers: Array<ReturnType<typeof createAppServer>> = []

afterEach(async () => {
  while (servers.length) await servers.pop()!.shutdown()
  while (temps.length) fs.rmSync(temps.pop()!, { recursive: true, force: true })
})

async function bootServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-agent-pve-'))
  temps.push(dir)
  const app = createAppServer({ dataDir: dir, tickMs: 0 })
  servers.push(app)
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', () => resolve()))
  const addr = app.server.address() as { port: number }
  const base = `http://127.0.0.1:${addr.port}`

  const reg = await fetch(`${base}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'pvecoach', password: 'password123' }),
  }).then((r) => r.json() as Promise<{ token: string }>)

  const tok = await fetch(`${base}/api/agent/token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${reg.token}` },
  }).then((r) => r.json() as Promise<{ token: string }>)

  const agentCall = async (body: Record<string, unknown>) => {
    const res = await fetch(`${base}/api/agent/action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: res.status, data: await res.json() as Record<string, any> }
  }

  return { base, agentToken: tok.token, agentCall }
}

describe('Agent API 巅峰之路与传奇挑战', () => {
  it('docs、state、get_pve、start_peak_challenge、start_legend_challenge 与 play_match 全链路可用', async () => {
    const { base, agentToken, agentCall } = await bootServer()

    const docs = await fetch(`${base}/api/agent/docs`).then((r) => r.text())
    expect(docs).toContain('start_peak_challenge')
    expect(docs).toContain('start_legend_challenge')
    expect(docs).toContain('get_pve')
    expect(docs).toContain('use_peak_breakthrough')
    expect(docs).toContain('claim_peak_reward')

    const stateRes = await fetch(`${base}/api/agent/state`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    }).then((r) => r.json() as Promise<{ revision: number; game: any }>)
    expect(stateRes.game.pve.peak.cleared).toBe(0)
    expect(stateRes.game.pve.peak.nextStage).toBe(1)
    expect(stateRes.game.pve.peak.totalStages).toBe(100)
    expect(stateRes.game.pve.legends.total).toBe(50)

    // get_pve 为只读，不增加 revision
    const pve = await agentCall({ action: 'get_pve', stage: 1 })
    expect(pve.status).toBe(200)
    expect(pve.data.revision).toBe(stateRes.revision)
    expect(pve.data.result.peak.stages).toHaveLength(100)
    expect(pve.data.result.legends.teams).toHaveLength(50)
    expect(pve.data.result.preview.stage).toBe(1)

    // 跳关被拒绝
    const skip = await agentCall({ action: 'start_peak_challenge', stage: 2 })
    expect(skip.status).toBe(400)
    expect(skip.data.error).toContain('第 1 关')

    // 省略 stage 默认开第 1 关，随后 play_match 结算
    const startPeak = await agentCall({ action: 'start_peak_challenge' })
    expect(startPeak.status).toBe(200)
    expect(startPeak.data.result.mode).toBe('peak')
    expect(startPeak.data.result.stage).toBe(1)
    expect(startPeak.data.game.pve.peak.dailyAttempts.used).toBe(1)

    const finishPeak = await agentCall({ action: 'play_match' })
    expect(finishPeak.status).toBe(200)
    expect(finishPeak.data.result.mode).toBe('peak')
    expect(finishPeak.data.result.stage).toBe(1)
    expect(finishPeak.data.game.activeMatch).toBeNull()
    expect(finishPeak.data.game.challengeHistory[0].mode).toBe('peak')

    // 开启传奇挑战并结算
    const startLegend = await agentCall({ action: 'start_legend_challenge', legendId: 'barcelona-2010-11' })
    expect(startLegend.status).toBe(200)
    expect(startLegend.data.result.mode).toBe('legend')
    expect(startLegend.data.result.opponentId).toBe('legend-barcelona-2010-11')

    const finishLegend = await agentCall({ action: 'play_match' })
    expect(finishLegend.status).toBe(200)
    expect(finishLegend.data.result.mode).toBe('legend')
    expect(finishLegend.data.game.pve.legends.records['barcelona-2010-11'].played).toBe(1)
  })

  it('use_peak_breakthrough 与 claim_peak_reward 正常生效', async () => {
    await loadPveContent()
    const game = createInitialGame(1234)
    ensurePve(game)
    game.pve!.peak.breakthroughCards = 1
    game.pve!.peak.cleared = PEAK_REWARD_STAGE

    const outfield = game.roster.find((p) => p.positions.GK === 0)!
    outfield.ceilings.shooting = 1100
    const bt = applyAgentAction(game, { action: 'use_peak_breakthrough', playerId: outfield.id, attr: 'shooting' })
    expect(bt.ok).toBe(true)
    expect(outfield.ceilings.shooting).toBe(1200)
    expect(game.pve!.peak.breakthroughCards).toBe(0)

    const allStar = buildPeakTeam(PEAK_REWARD_STAGE).players[0]
    const beforeCount = game.roster.length
    const claim = applyAgentAction(game, { action: 'claim_peak_reward', templateId: allStar.id })
    expect(claim.ok).toBe(true)
    expect(game.roster.length).toBe(beforeCount + 1)
    expect(game.pve!.peak.reward50?.templateId).toBe(allStar.id)
  })
})
