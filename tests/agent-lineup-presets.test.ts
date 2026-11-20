import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { applyAgentAction } from '../server/agent.ts'
import { createWorldGame } from '../src/game/world.ts'
import {
  MAX_TACTIC_PRESETS,
  autoFillLineup,
  findTacticPresetByName,
  overwriteTacticPreset,
  saveTacticPreset,
} from '../src/game/squad.ts'
import { makeTeams } from './helpers.ts'

const servers: AppServer[] = []
const dirs: string[] = []

afterEach(() => {
  while (servers.length) servers.pop()!.close()
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

async function setupServer(now: () => number = () => Date.now()) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-agent-presets-'))
  dirs.push(dataDir)
  const app = createAppServer({ dataDir, staticDir: path.resolve('dist'), tickMs: 0, now })
  servers.push(app)
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
  const registered = await (await fetch(`${base}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'presetcoach', password: 'secret123' }),
  })).json() as { token: string }
  const { token } = await (await fetch(`${base}/api/agent/token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${registered.token}` },
  })).json() as { token: string }
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const action = async (body: Record<string, unknown>) => {
    const response = await fetch(`${base}/api/agent/action`, { method: 'POST', headers, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() as any }
  }
  const state = async () => (await (await fetch(`${base}/api/agent/state`, { headers })).json() as any).game
  return { base, action, state }
}

describe('阵容预设底层规则（覆盖与数量上限）', () => {
  it('支持用显式阵容保存、按 ID 覆盖并可选改名，以及按数量上限拦截新建', () => {
    const { roster, lineup } = makeTeams(200, '4-4-2')
    const alt = autoFillLineup(roster, '4-3-3', { ...lineup.tactics, press: 'high' })
    const saved = saveTacticPreset(lineup, '主力高压', 1_700_000_000_000, alt)
    expect(saved.ok).toBe(true)
    expect(saved.preset?.lineup.formationId).toBe('4-3-3')
    expect(findTacticPresetByName(lineup, '  主力高压 ')?.id).toBe(saved.preset?.id)

    const updated = overwriteTacticPreset(lineup, saved.preset!.id, lineup, { name: '稳守反击', createdAt: 1_700_000_005_000 })
    expect(updated.ok).toBe(true)
    expect(updated.preset?.id).toBe(saved.preset?.id)
    expect(updated.preset?.name).toBe('稳守反击')
    expect(updated.preset?.createdAt).toBe(1_700_000_005_000)
    expect(updated.preset?.lineup.formationId).toBe('4-4-2')
    expect((updated.preset?.lineup as { presets?: unknown }).presets).toBeUndefined()

    for (let i = 1; i < MAX_TACTIC_PRESETS; i++) {
      expect(saveTacticPreset(lineup, `预设${i}`, 1_700_000_010_000 + i).ok).toBe(true)
    }
    expect(lineup.presets).toHaveLength(MAX_TACTIC_PRESETS)
    const overflow = saveTacticPreset(lineup, '超限预设', 1_700_000_099_000)
    expect(overflow.ok).toBe(false)
    expect(overflow.error).toContain(String(MAX_TACTIC_PRESETS))
    // 已达上限时覆盖已有预设仍然允许
    expect(overwriteTacticPreset(lineup, saved.preset!.id, alt).ok).toBe(true)
  })
})

describe('Agent API 阵容预设动作', () => {
  it('支持保存当前阵容、保存显式阵容、按 presetId 与同名 overwrite 覆盖、应用、重命名与删除', async () => {
    const { action, state } = await setupServer()
    const initial = await state()
    const originalFormation = initial.lineup.formationId

    // 1. 保存当前生效阵容为预设
    const created = await action({ action: 'save_lineup_preset', name: '主力阵' })
    expect(created.status, created.body.error).toBe(200)
    expect(created.body.result.overwritten).toBe(false)
    const firstId = created.body.result.preset.id
    expect(created.body.result.preset.name).toBe('主力阵')
    expect(created.body.result.preset.lineup.formationId).toBe(originalFormation)
    expect(created.body.game.lineup.presets).toHaveLength(1)

    // 2. 重名且未传 overwrite 时拒绝
    const duplicate = await action({ action: 'save_lineup_preset', name: ' 主力阵 ' })
    expect(duplicate.status).toBe(400)
    expect(duplicate.body.error).toContain('已经有叫')

    // 3. 显式传入新 lineup + overwrite: true 按同名覆盖，且不修改当前生效阵容
    const switched = await action({ action: 'auto_lineup', formationId: '4-3-3' })
    expect(switched.status).toBe(200)
    const lineup433 = switched.body.game.lineup
    const restored = await action({ action: 'auto_lineup', formationId: '4-4-2' })
    expect(restored.status).toBe(200)

    const overwrittenByName = await action({
      action: 'save_lineup_preset',
      name: '主力阵',
      overwrite: true,
      lineup: {
        formationId: '4-3-3',
        starters: lineup433.starters,
        bench: lineup433.bench,
        tacticalStyle: 'highPress',
        matchPlan: 'fastStart',
        customPositions: { st: { x: 0.62, y: 0.45 } },
      },
    })
    expect(overwrittenByName.status, overwrittenByName.body.error).toBe(200)
    expect(overwrittenByName.body.result.overwritten).toBe(true)
    expect(overwrittenByName.body.result.preset.id).toBe(firstId)
    expect(overwrittenByName.body.result.preset.lineup.formationId).toBe('4-3-3')
    expect(overwrittenByName.body.result.preset.lineup.tacticalStyle).toBe('highPress')
    expect(overwrittenByName.body.result.preset.lineup.matchPlan).toBe('fastStart')
    expect(overwrittenByName.body.result.preset.lineup.customPositions).toEqual({ st: { x: 0.62, y: 0.45 } })
    // 当前生效阵容保持 4-4-2 不变
    expect(overwrittenByName.body.game.lineup.formationId).toBe('4-4-2')
    expect(overwrittenByName.body.game.lineup.presets).toHaveLength(1)

    // 4. 按 presetId 覆盖并可选改名
    const overwrittenById = await action({
      action: 'save_lineup_preset',
      presetId: firstId,
      name: '杯赛高压 433',
      lineup: {
        formationId: '4-3-3',
        starters: lineup433.starters,
        bench: lineup433.bench,
        tacticalStyle: 'wingPlay',
        matchPlan: 'allOutWin',
      },
    })
    expect(overwrittenById.status, overwrittenById.body.error).toBe(200)
    expect(overwrittenById.body.result.overwritten).toBe(true)
    expect(overwrittenById.body.result.preset.id).toBe(firstId)
    expect(overwrittenById.body.result.preset.name).toBe('杯赛高压 433')
    expect(overwrittenById.body.result.preset.lineup.tacticalStyle).toBe('wingPlay')
    expect(overwrittenById.body.result.preset.lineup.matchPlan).toBe('allOutWin')

    // 5. 应用预设到当前阵容（自动处理冲突的定时换人规则）
    const active = await state()
    const outStarter = active.lineup.starters.find((s: { playerId: string }) => !lineup433.starters.some((x: { playerId: string }) => x.playerId === s.playerId))
    const inBench = active.lineup.bench[0]
    if (outStarter && inBench) {
      const subRes = await action({
        action: 'set_auto_subs',
        plan: { timed: [{ atMinute: 60, outId: outStarter.playerId, inId: inBench }], staminaBelow: null, onInjury: true },
      })
      expect(subRes.status).toBe(200)
    }
    const applied = await action({ action: 'apply_lineup_preset', presetId: firstId })
    expect(applied.status, applied.body.error).toBe(200)
    expect(applied.body.game.lineup.formationId).toBe('4-3-3')
    expect(applied.body.game.lineup.tacticalStyle).toBe('wingPlay')
    expect(applied.body.game.lineup.matchPlan).toBe('allOutWin')
    expect(applied.body.game.lineup.presets).toHaveLength(1)

    // 6. 重命名预设与删除预设
    const renamed = await action({ action: 'rename_lineup_preset', presetId: firstId, name: '决战边路' })
    expect(renamed.status, renamed.body.error).toBe(200)
    expect(renamed.body.result.preset.name).toBe('决战边路')

    const deleted = await action({ action: 'delete_lineup_preset', presetId: firstId })
    expect(deleted.status, deleted.body.error).toBe(200)
    expect(deleted.body.result.deleted).toBe(true)
    expect(deleted.body.game.lineup.presets).toEqual([])
    expect((await action({ action: 'delete_lineup_preset', presetId: firstId })).status).toBe(400)
  })

  it('校验非法参数；赛前锁阵期间拒绝 apply_lineup_preset，但允许保存/覆盖/删改预设', () => {
    const game = createWorldGame(41)
    const nextFixture = game.season.fixtures.find((f) => f.isPlayer && !f.played)!
    const lockedNow = (nextFixture.kickoffAt ?? Date.now()) - 10 * 60_000

    // 非法 presetId / 非法阵容 / 非法坐标都会被拒绝
    expect(applyAgentAction(game, { action: 'save_lineup_preset', presetId: 'missing' }, lockedNow).ok).toBe(false)
    expect(applyAgentAction(game, { action: 'save_lineup_preset', presetId: '' }, lockedNow).ok).toBe(false)
    expect(applyAgentAction(game, { action: 'save_lineup_preset', name: '坏坐标', lineup: { ...game.lineup, customPositions: { nope: { x: 0.5, y: 0.5 } } } }, lockedNow).ok).toBe(false)

    // 锁阵期间仍可保存和覆盖预设（不改动当前生效阵容）
    const saved = applyAgentAction(game, { action: 'save_lineup_preset', name: '备选方案' }, lockedNow)
    expect(saved.ok, saved.error).toBe(true)
    const presetId = (saved.result as { preset: { id: string } }).preset.id

    const alt = autoFillLineup(game.roster, '4-3-3', game.lineup.tactics)
    const overwritten = applyAgentAction(game, { action: 'save_lineup_preset', presetId, lineup: alt }, lockedNow)
    expect(overwritten.ok, overwritten.error).toBe(true)
    expect(game.lineup.formationId).not.toBe('4-3-3')

    // 锁阵期间 apply_lineup_preset 必须被拦截
    const lockedApply = applyAgentAction(game, { action: 'apply_lineup_preset', presetId }, lockedNow)
    expect(lockedApply.ok).toBe(false)
    expect(lockedApply.error).toContain('阵容已锁定')
  })
})
