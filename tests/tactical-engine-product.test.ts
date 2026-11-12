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
import { MatchEngine } from '../src/game/match/engine.ts'
import { PesEngine } from '../src/game/pes/engine.ts'
import {
  MATCH_PLAN_LIST,
  evaluateMatchPlan,
  matchPlanConditionFactor,
} from '../src/game/pes/match-plan.ts'
import { simulateFixture } from '../src/game/season.ts'
import { finishMatch, startSingleChallenge } from '../src/game/actions.ts'
import { computeMatchJob, matchJobId } from '../server/match-job.ts'
import {
  NEUTRAL_INSTRUCTIONS,
  cloneInstructions,
  legacyTacticsFromInstructions,
  setInstructionField,
  styleByRevision,
  type TacticalInstructionsV2,
} from '../src/game/pes/tactics.ts'
import { lineupStyleLabel, teamTacticSummary } from '../src/ui/format.ts'

const servers: AppServer[] = []
const tempDirs: string[] = []
afterEach(() => {
  while (servers.length) servers.pop()!.close()
  while (tempDirs.length) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
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

  it('服务端 PUT /api/game 与 Agent API set_lineup 完整支持战术风格、指令与下场比赛计划，并拦截非法枚举', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-tactics-api-'))
    tempDirs.push(dataDir)
    const app = createAppServer({
      dataDir,
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

    // 1. Agent state 提供 tacticalStyles、matchPlans 目录与 tacticalFamiliarity
    const initialState = (await (await fetch(`${base}/api/agent/state`, { headers: agentHeaders })).json()) as {
      game: {
        tacticalStyles: { id: string; name: string; instructions: TacticalInstructionsV2 }[]
        matchPlans: { id: string; name: string; conditionFactor: number }[]
        lineupAnalysis: { tacticalFamiliarity: number }
        lineup: typeof reg.game.lineup
      }
    }
    expect(initialState.game.tacticalStyles.length).toBe(11)
    expect(initialState.game.matchPlans.length).toBe(14)
    expect(initialState.game.lineupAnalysis.tacticalFamiliarity).toBeGreaterThanOrEqual(0.5)

    // 2. Agent set_lineup 支持同时传 tacticalStyle 与 matchPlan
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
          matchPlan: 'parkTheBus',
        },
      }),
    })
    expect(applyStyle.status).toBe(200)
    const afterStyle = (await applyStyle.json()) as { ok: boolean; result: typeof reg.game.lineup }
    expect(afterStyle.ok).toBe(true)
    expect(afterStyle.result.tacticalStyle).toBe('directCounter')
    expect(afterStyle.result.matchPlan).toBe('parkTheBus')
    expect(afterStyle.result.tacticalInstructions).toEqual(styleByRevision('directCounter', 3).instructions)
    expect(afterStyle.result.tactics.passing).toBe('direct')

    // 2b. Agent set_lineup 传入非法 matchPlan 时返回明确 400 错误
    const rejectPlan = await fetch(`${base}/api/agent/action`, {
      method: 'POST',
      headers: agentHeaders,
      body: JSON.stringify({
        action: 'set_lineup',
        lineup: {
          formationId: initialState.game.lineup.formationId,
          starters: initialState.game.lineup.starters,
          bench: initialState.game.lineup.bench,
          matchPlan: 'invalid_plan',
        },
      }),
    })
    expect(rejectPlan.status).toBe(400)
    const rejectPlanBody = (await rejectPlan.json()) as { ok: boolean; error: string }
    expect(rejectPlanBody.error).toMatch(/未知比赛计划/)

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

    const tamperedPlan = structuredClone(currentResp.game)
    ;(tamperedPlan.lineup as unknown as { matchPlan: string }).matchPlan = 'ultra_bus'
    const badPlanPut = await fetch(`${base}/api/game`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${reg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseRevision: currentResp.revision, game: tamperedPlan }),
    })
    expect(badPlanPut.status).toBe(400)
  })

  it('14 套下场比赛计划覆盖全力争胜/龟缩防守/领先锁局/杯赛总比分等动态阶段，并同时影响赛季与挑战', () => {
    expect(MATCH_PLAN_LIST.length).toBe(14)
    const ids = MATCH_PLAN_LIST.map((p) => p.id)
    expect(ids).toContain('allOutWin')
    expect(ids).toContain('parkTheBus')
    expect(ids).toContain('conserveStamina')
    expect(ids).toContain('cupHoldout')

    // 1. 预设与换阵型完整保留 matchPlan，非法枚举被拦截
    const game = createInitialGame(20261112)
    for (const plan of MATCH_PLAN_LIST) {
      game.lineup.matchPlan = plan.id
      expect(validateLineup(game.roster, game.lineup).valid).toBe(true)
    }
    ;(game.lineup as unknown as { matchPlan: string }).matchPlan = 'not_a_plan'
    expect(validateLineup(game.roster, game.lineup).valid).toBe(false)

    game.lineup.matchPlan = 'allOutWin'
    expect(lineupStyleLabel(game.lineup)).toContain('计划:全力争胜')
    const presetRes = saveTacticPreset(game.lineup, '决死强攻', 1_700_000_111_000)
    expect(presetRes.ok).toBe(true)
    expect(presetRes.preset?.lineup.matchPlan).toBe('allOutWin')
    const switched = autoFillLineup(game.roster, '4-3-3', game.lineup.tactics, game.lineup)
    expect(switched.matchPlan).toBe('allOutWin')
    const restored = applyTacticPreset(switched, presetRes.preset!.id)!
    expect(restored.matchPlan).toBe('allOutWin')

    // 2. 纯函数评估验证：领先锁局、全力争胜、龟缩防守、杯赛两回合总比分
    expect(evaluateMatchPlan('standard', NEUTRAL_INSTRUCTIONS, { minute: 50, scoreDiff: 0, effectiveDiff: 0 })).toBeNull()
    const bus = evaluateMatchPlan('parkTheBus', NEUTRAL_INSTRUCTIONS, { minute: 10, scoreDiff: 0, effectiveDiff: 0 })!
    expect(bus.phaseId).toBe('bus_lock')
    expect(bus.instructions.defense.line).toBe('low')
    expect(bus.instructions.possession.tempo).toBe('slow')

    const lead0 = evaluateMatchPlan('protectLead', NEUTRAL_INSTRUCTIONS, { minute: 30, scoreDiff: 0, effectiveDiff: 0 })!
    expect(lead0.phaseId).toBe('base')
    const lead50 = evaluateMatchPlan('protectLead', NEUTRAL_INSTRUCTIONS, { minute: 50, scoreDiff: 1, effectiveDiff: 1 })!
    expect(lead50.phaseId).toBe('lead_steady')
    const lead80 = evaluateMatchPlan('protectLead', NEUTRAL_INSTRUCTIONS, { minute: 80, scoreDiff: 1, effectiveDiff: 1 })!
    expect(lead80.phaseId).toBe('lead_lockdown')

    // 杯赛次回合总比分感知：本场 0:0 但首回合落后 1 球（effectiveDiff = -1）时主动破釜沉舟进攻
    const cupTrailingAgg = evaluateMatchPlan('cupHoldout', NEUTRAL_INSTRUCTIONS, { minute: 20, scoreDiff: 0, effectiveDiff: -1, knockout: true })!
    expect(cupTrailingAgg.phaseId).toBe('cup_chase')
    expect(cupTrailingAgg.instructions.defense.line).toBe('high')
    const cupLeadingAgg = evaluateMatchPlan('cupHoldout', NEUTRAL_INSTRUCTIONS, { minute: 20, scoreDiff: 0, effectiveDiff: 1, knockout: true })!
    expect(cupLeadingAgg.phaseId).toBe('cup_protect')
    expect(cupLeadingAgg.instructions.defense.line).toBe('low')

    // 3. 挑战赛（PesEngine）实测：比赛计划在开场与 60 分钟动态变阵、写入战报，且挑战赛不扣赛季持久体能
    const challengeGame = createInitialGame(778899)
    challengeGame.lineup.matchPlan = 'allOutWin'
    for (const p of challengeGame.roster) p.condition = 100
    const startRes = startSingleChallenge(challengeGame, challengeGame.aiTeams[0].id)
    expect(startRes.ok).toBe(true)
    const chalEngine = new PesEngine({
      seed: 42,
      home: teamInputFromLineup(challengeGame.roster, challengeGame.lineup, { id: 'player', name: '我方', color: '#22c55e', accent: '#052e16' }),
      away: teamInputFromLineup(challengeGame.aiTeams[0].players, challengeGame.aiTeams[0].lineup, { id: 'ai', name: '对手', color: '#ef4444', accent: '#450a0a' }),
      knockout: true,
      durationSeconds: 30,
      noInjuries: true,
    })
    expect(chalEngine.getTeam('home').activePlanPhase).toBe('allout_open')
    expect(teamTacticSummary(chalEngine.getTeam('home'))).toContain('计划:全力争胜(积极强攻)')
    expect(chalEngine.state.log.some((e) => e.type === 'tactic' && e.text.includes('比赛计划「全力争胜」'))).toBe(true)

    // 验证存档恢复（联机直播回放 / 刷新恢复同款路径）与连续运行完全一致
    const snapMid = chalEngine.serialize()
    const restoredEngine = PesEngine.restore(snapMid)
    const finalContinuous = chalEngine.simulate()
    const finalRestored = restoredEngine.simulate()
    expect(finalRestored.score).toEqual(finalContinuous.score)
    expect(finalRestored.teams[0].activePlanPhase).toBe(finalContinuous.teams[0].activePlanPhase)

    // 结束挑战赛：验证挑战赛不扣持久体能
    challengeGame.activeMatch!.engineState = finalContinuous
    const chalRecord = finishMatch(challengeGame, chalEngine)
    expect(chalRecord).not.toBeNull()
    expect(challengeGame.roster.every((p) => p.condition === 100)).toBe(true)

    // 4. MatchEngine（后台自动结算与培养交流赛引擎）同样执行比赛计划变阵
    const autoEngine = new MatchEngine({
      seed: 55,
      home: teamInputFromLineup(challengeGame.roster, { ...challengeGame.lineup, matchPlan: 'fastStart' }, { id: 'player', name: '我方', color: '#22c55e', accent: '#052e16' }),
      away: teamInputFromLineup(challengeGame.aiTeams[0].players, challengeGame.aiTeams[0].lineup, { id: 'ai', name: '对手', color: '#ef4444', accent: '#450a0a' }),
      knockout: false,
      durationSeconds: 60,
      rulesVersion: 2,
    })
    expect(autoEngine.state.teams[0].activePlanPhase).toBe('fast_blitz')
    const autoDone = autoEngine.simulate()
    expect(autoDone.log.filter((e) => e.type === 'tactic' && e.text.includes('比赛计划「抢开局闪电战」')).length).toBeGreaterThanOrEqual(2)

    // 5. 赛季联赛影响（单机 simulateFixture 与联机 computeMatchJob）：全力争胜耗能更高，留力养生显著省体能
    const gameAllOut = createInitialGame(9001)
    const gameSaveStam = createInitialGame(9001)
    gameAllOut.lineup.matchPlan = 'allOutWin'
    gameSaveStam.lineup.matchPlan = 'conserveStamina'
    for (const p of gameAllOut.roster) p.condition = 100
    for (const p of gameSaveStam.roster) p.condition = 100

    const fixAllOut = gameAllOut.season.fixtures.find((f) => f.round === 1 && f.isPlayer)!
    const fixSaveStam = gameSaveStam.season.fixtures.find((f) => f.round === 1 && f.isPlayer)!
    simulateFixture(gameAllOut, fixAllOut, true)
    simulateFixture(gameSaveStam, fixSaveStam, true)

    const starterId = gameAllOut.lineup.starters[0].playerId
    const condAfterAllOut = gameAllOut.roster.find((p) => p.id === starterId)!.condition
    const condAfterSaveStam = gameSaveStam.roster.find((p) => p.id === starterId)!.condition
    expect(matchPlanConditionFactor('allOutWin')).toBeGreaterThan(1)
    expect(matchPlanConditionFactor('conserveStamina')).toBeLessThan(1)
    expect(condAfterSaveStam).toBeGreaterThan(condAfterAllOut + 15)

    // 联机 MatchJob 同样按比赛计划倍率结算双方 conditionLoss
    const homeTeam = { ...gameAllOut.aiTeams[0], lineup: { ...gameAllOut.aiTeams[0].lineup, matchPlan: 'allOutWin' as const } }
    const awayTeam = { ...gameAllOut.aiTeams[1], lineup: { ...gameAllOut.aiTeams[1].lineup, matchPlan: 'conserveStamina' as const } }
    const jobRes = computeMatchJob({
      id: matchJobId(1, 'd1', { round: 1, homeId: homeTeam.id, awayId: awayTeam.id }),
      season: 1,
      divisionId: 'd1',
      round: 1,
      seed: 31415,
      lockedAt: 1_700_000_000_000 - 1_800_000,
      kickoffAt: 1_700_000_000_000,
      gameDayMs: 21_600_000,
      home: { team: homeTeam, injuries: {}, suspended: [], medical: 1, ai: false },
      away: { team: awayTeam, injuries: {}, suspended: [], medical: 1, ai: false },
    })
    const homeFullStarter = homeTeam.lineup.starters[0].playerId
    const awayFullStarter = awayTeam.lineup.starters[0].playerId
    expect(jobRes.conditionLoss[homeFullStarter]).toBeGreaterThan(jobRes.conditionLoss[awayFullStarter])
  })
})
