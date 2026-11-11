import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { createInitialGame } from '../src/game/state.ts'
import {
  applyTacticPreset,
  autoFillLineup,
  computeLineupFamiliarity,
  saveTacticPreset,
  validateLineup,
} from '../src/game/squad.ts'
import { buildMatchEngineForGame, teamInputFromLineup } from '../src/game/match/setup.ts'
import { PesEngine } from '../src/game/pes/engine.ts'
import {
  cloneInstructions,
  legacyTacticsFromInstructions,
  setInstructionField,
  styleByRevision,
  type TacticalInstructionsV2,
} from '../src/game/pes/tactics.ts'
import { lineupStyleLabel, teamTacticSummary } from '../src/ui/format.ts'

const servers: AppServer[] = []
afterEach(() => {
  while (servers.length) servers.pop()!.close()
})

describe('战术引擎产品链路集成', () => {
  it('阵容保存风格与十二项指令、切换阵型与命名预设均完整保留，并接入 PesEngine 与临场心态叠加', () => {
    const game = createInitialGame(12345)
    const wingTpl = styleByRevision('wingPlay', 3)
    const customInst = setInstructionField(wingTpl.instructions, 'defense.line', 'high')
    game.lineup.tacticalStyle = 'wingPlay'
    game.lineup.tacticalInstructions = customInst
    game.lineup.tactics = legacyTacticsFromInstructions(customInst)

    expect(validateLineup(game.roster, game.lineup).valid).toBe(true)
    expect(lineupStyleLabel(game.lineup)).toBe('双翼齐飞·已调整')

    // 保存并应用预设
    const saved = saveTacticPreset(game.lineup, '边路高压', 1_700_000_000_000)
    expect(saved.ok).toBe(true)
    expect(saved.preset?.lineup.tacticalStyle).toBe('wingPlay')
    expect(saved.preset?.lineup.tacticalInstructions).toEqual(customInst)

    // 换阵型自动填充时保留战术风格与十二项指令
    const switched = autoFillLineup(game.roster, '4-3-3', game.lineup.tactics, game.lineup)
    expect(switched.formationId).toBe('4-3-3')
    expect(switched.tacticalStyle).toBe('wingPlay')
    expect(switched.tacticalInstructions).toEqual(customInst)

    // 应用预设恢复回原阵型与指令
    const applied = applyTacticPreset(switched, saved.preset!.id)!
    expect(applied.formationId).toBe(game.lineup.formationId)
    expect(applied.tacticalInstructions).toEqual(customInst)

    // 战术熟练度受位置熟练度与战术研究室设施阶段影响
    const baseFam = computeLineupFamiliarity(game.roster, game.lineup, 1)
    const maxFacilityFam = computeLineupFamiliarity(game.roster, game.lineup, 25)
    expect(maxFacilityFam).toBeGreaterThan(baseFam)

    const mismatched = structuredClone(game.lineup)
    // 故意把外场位置熟练度清零模拟严重错位，熟练度应明显下降
    const strippedRoster = game.roster.map((p) =>
      p.positions.GK > 0 ? p : { ...p, positions: { GK: 0, CB: 0, W: 0, CM: 0, ST: 0 } },
    )
    const lowFam = computeLineupFamiliarity(strippedRoster, mismatched, 1)
    expect(lowFam).toBeLessThan(baseFam)

    // buildMatchEngineForGame 把指令和熟练度送入 PesEngine，且临场心态叠加不会抹除赛前模板
    const input = teamInputFromLineup(
      game.roster,
      game.lineup,
      { id: 'player', name: game.clubName, color: '#34d399', accent: '#052e1b' },
      { tacticsStage: 10 },
    )
    expect(input.instructions).toEqual(customInst)
    expect(input.tacticalStyle).toBe('wingPlay')
    expect(input.familiarity).toBeCloseTo(computeLineupFamiliarity(game.roster, game.lineup, 10), 6)

    const engine = buildMatchEngineForGame(
      game,
      {
        isLeague: false,
        opponentId: game.aiTeams[0].id,
        opponentName: game.aiTeams[0].name,
        seed: 99,
        homeAway: 'home',
        durationSeconds: 60,
      },
      game.aiTeams[0],
    )
    expect(engine).toBeInstanceOf(PesEngine)
    const homeState = engine.getTeam('home')
    expect(homeState.instructions).toEqual(customInst)
    expect(teamTacticSummary(homeState)).toContain('双翼齐飞·已调整')

    expect(engine.setTactics('defend', 'home').ok).toBe(true)
    expect(engine.getTeam('home').instructions?.defense.line).toBe('mid') // high 下调一档为 mid
    expect(engine.setTactics('balanced', 'home').ok).toBe(true)
    expect(engine.getTeam('home').instructions).toEqual(customInst)
  })

  it('服务端 PUT /api/game 与 Agent API set_lineup 完整支持战术风格与指令，并拦截非法枚举', async () => {
    const app = createAppServer({
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'fm-tactics-api-')),
      staticDir: path.resolve('dist'),
      tickMs: 0,
    })
    servers.push(app)
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`

    const reg = (await (
      await fetch(`${base}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'tac_coach', password: 'secret123' }),
      })
    ).json()) as { token: string; revision: number; game: ReturnType<typeof createInitialGame> }

    const { token: agentToken } = (await (
      await fetch(`${base}/api/agent/token`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${reg.token}` },
      })
    ).json()) as { token: string }

    const agentHeaders = { Authorization: `Bearer ${agentToken}`, 'Content-Type': 'application/json' }

    // 1. Agent state 提供 tacticalStyles 目录与 tacticalFamiliarity
    const initialState = (await (await fetch(`${base}/api/agent/state`, { headers: agentHeaders })).json()) as {
      game: {
        tacticalStyles: { id: string; name: string; instructions: TacticalInstructionsV2 }[]
        lineupAnalysis: { tacticalFamiliarity: number }
        lineup: typeof reg.game.lineup
      }
    }
    expect(initialState.game.tacticalStyles.length).toBe(11)
    expect(initialState.game.lineupAnalysis.tacticalFamiliarity).toBeGreaterThanOrEqual(0.5)

    // 2. Agent set_lineup 仅传 tacticalStyle 自动展开模板
    const applyStyle = await fetch(`${base}/api/agent/action`, {
      method: 'POST',
      headers: agentHeaders,
      body: JSON.stringify({
        action: 'set_lineup',
        lineup: {
          formationId: initialState.game.lineup.formationId,
          starters: initialState.game.lineup.starters,
          bench: initialState.game.lineup.bench,
          tacticalStyle: 'directCounter',
        },
      }),
    })
    expect(applyStyle.status).toBe(200)
    const afterStyle = (await applyStyle.json()) as { ok: boolean; result: typeof reg.game.lineup }
    expect(afterStyle.ok).toBe(true)
    expect(afterStyle.result.tacticalStyle).toBe('directCounter')
    expect(afterStyle.result.tacticalInstructions).toEqual(styleByRevision('directCounter', 3).instructions)
    expect(afterStyle.result.tactics.passing).toBe('direct')

    // 3. Agent set_lineup 传入非法指令字段时返回明确 400 错误
    const badInst = cloneInstructions(afterStyle.result.tacticalInstructions!) as unknown as Record<string, Record<string, unknown>>
    badInst.possession.passing = 'ultra_long'
    const rejectAgent = await fetch(`${base}/api/agent/action`, {
      method: 'POST',
      headers: agentHeaders,
      body: JSON.stringify({
        action: 'set_lineup',
        lineup: {
          formationId: initialState.game.lineup.formationId,
          starters: initialState.game.lineup.starters,
          bench: initialState.game.lineup.bench,
          tacticalInstructions: badInst,
        },
      }),
    })
    expect(rejectAgent.status).toBe(400)
    const rejectBody = (await rejectAgent.json()) as { ok: boolean; error: string }
    expect(rejectBody.ok).toBe(false)
    expect(rejectBody.error).toMatch(/possession\.passing/)

    // 4. PUT /api/game 拦截非法 tacticalStyle 与非法 tacticalInstructions
    const currentResp = (await (
      await fetch(`${base}/api/game`, { headers: { Authorization: `Bearer ${reg.token}` } })
    ).json()) as { revision: number; game: ReturnType<typeof createInitialGame> }
    const tampered = structuredClone(currentResp.game)
    ;(tampered.lineup as unknown as { tacticalStyle: string }).tacticalStyle = 'fake_style'
    const badPut = await fetch(`${base}/api/game`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${reg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseRevision: currentResp.revision, game: tampered }),
    })
    expect(badPut.status).toBe(400)
  })
})
