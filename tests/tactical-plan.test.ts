import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { createWorldGame } from '../src/game/world.ts'
import {
  applyBackupTacticToLineup,
  applyTacticOnlyFromPreset,
  saveTacticPreset,
  validateLineup,
} from '../src/game/squad.ts'
import { teamInputFromLineup, teamInputFromAI } from '../src/game/match/setup.ts'
import { buildMatchTeam } from '../src/game/match/team.ts'
import { PesGame } from '../src/game/pes/game.ts'
import { PesEngine } from '../src/game/pes/engine.ts'
import { MATCH_PLAN_LIST } from '../src/game/pes/match-plan.ts'
import { STYLES_REV3, cloneInstructions } from '../src/game/pes/tactics.ts'
import {
  BACKUP_TACTIC_TEMPLATES,
  backupTacticFromLineup,
  computeFormationReassignment,
  createFMClassicBundle,
  effectiveMatchConditionFactor,
  evaluateCustomMatchPlanRules,
  rulesFromBuiltInMatchPlan,
  sanitizeMatchPlanRules,
  validateBackupTactics,
  validateMatchPlanRules,
  type BackupTactic,
  type MatchPlanRule,
} from '../src/game/pes/tactical-plan.ts'
import { computeMatchJob, type MatchJob } from '../server/match-job.ts'
import { applyAgentAction, agentView } from '../server/agent.ts'
import { renderFmTacticalPlanPanel } from '../src/ui/tactical-plan-editor.ts'

describe('FM Tactical Slots & Custom Match Plan Rules', () => {
  it('validates backup tactics and custom match plan rules strictly', () => {
    const bundle = createFMClassicBundle('4-3-3')
    expect(validateBackupTactics(bundle.backupTactics)).toEqual([])
    expect(validateMatchPlanRules(bundle.matchPlanRules, bundle.backupTactics)).toEqual([])

    // Invalid slot reference should fail validation
    const badRules: MatchPlanRule[] = [
      {
        id: 'r1',
        name: '非法槽位',
        enabled: true,
        condition: { minMinute: 60, maxMinute: 90, score: 'leading' },
        action: { tacticSlotId: 'slot-missing' },
      },
    ]
    expect(validateMatchPlanRules(badRules, bundle.backupTactics).length).toBeGreaterThan(0)

    // Invalid minute window (min >= max)
    const badMinutes: MatchPlanRule[] = [
      {
        id: 'r2',
        name: '倒挂时间',
        enabled: true,
        condition: { minMinute: 70, maxMinute: 60 },
        action: { mentality: 'defend' },
      },
    ]
    expect(validateMatchPlanRules(badMinutes, bundle.backupTactics).length).toBeGreaterThan(0)

    // sanitizeMatchPlanRules strips broken tacticSlotId cleanly
    const cleaned = sanitizeMatchPlanRules(badRules, bundle.backupTactics)!
    expect(cleaned[0].action.tacticSlotId).toBeUndefined()
    expect(validateMatchPlanRules(cleaned, bundle.backupTactics)).toEqual([])

    // Every built-in match plan (except standard) expands cleanly into valid editable rules
    for (const def of MATCH_PLAN_LIST) {
      if (def.id === 'standard') continue
      const expanded = rulesFromBuiltInMatchPlan(def.id)
      expect(expanded.length).toBeGreaterThan(0)
      expect(validateMatchPlanRules(expanded, [])).toEqual([])
    }
  })

  it('decouples tactics from roster churn: preset tactic-only & backup slot survive selling players', () => {
    const game = createWorldGame(20261121)
    const testSlotId = game.lineup.starters.find((s) => s.slotId !== 'gk')!.slotId
    game.lineup.tacticalStyle = 'highPress'
    game.lineup.tacticalInstructions = cloneInstructions(STYLES_REV3.highPress.instructions)
    game.lineup.customPositions = { [testSlotId]: { x: 0.76, y: 0.52 } }

    const saved = saveTacticPreset(game.lineup, '高位强攻预设')
    expect(saved.ok).toBe(true)
    const presetId = saved.preset!.id

    const backup = backupTacticFromLineup(game.lineup, 'slot-2', '备选高位', 'attack')
    expect(backup.customPositions?.[testSlotId]).toEqual({ x: 0.76, y: 0.52 })

    // Simulate selling one of the original starters from the roster!
    const soldStarterId = game.lineup.starters.find((s) => s.slotId !== 'gk')!.playerId
    const reducedRoster = game.roster.filter((p) => p.id !== soldStarterId)
    expect(reducedRoster.length).toBeGreaterThanOrEqual(18)

    // Applying tactic-only from preset succeeds with valid 11-man lineup and preserves customPositions & instructions
    const appliedPreset = applyTacticOnlyFromPreset(reducedRoster, game.lineup, presetId)!
    expect(appliedPreset).toBeTruthy()
    expect(validateLineup(reducedRoster, appliedPreset).valid).toBe(true)
    expect(appliedPreset.customPositions?.[testSlotId]).toEqual({ x: 0.76, y: 0.52 })
    expect(appliedPreset.tacticalStyle).toBe('highPress')

    // Applying backup tactic to board also produces a valid lineup despite missing preferred player
    const appliedBackup = applyBackupTacticToLineup(reducedRoster, game.lineup, backup)
    expect(validateLineup(reducedRoster, appliedBackup).valid).toBe(true)
    expect(appliedBackup.formationId).toBe(backup.formationId)
  })

  it('computes optimal Hungarian formation reassignment for 11 men and adapts 10 men cleanly (4-4-2 → 4-4-1)', () => {
    const game = createWorldGame(20261122)
    const input = teamInputFromLineup(game.roster, game.lineup, {
      id: 'home', name: '主队', color: '#34d399', accent: '#052e1b',
    })
    const team = buildMatchTeam(input, 'home')

    // 11-man switch to 5-3-2 with explicit preferredPlayer
    const gk = team.players.find((p) => p.position === 'GK')!
    const preferredOutfield = team.players.find((p) => p.position === 'CB')!
    const res11 = computeFormationReassignment(
      team.players,
      '5-3-2',
      { cbc: { x: 0.14, y: 0.5 } },
      { cbc: 'cb_cover' },
      { cbc: preferredOutfield.sourceId },
    )
    expect(res11.assignments).toHaveLength(11)
    expect(res11.shapeLabel).toBe('5-3-2')
    const gkAssign = res11.assignments.find((a) => a.playerId === gk.id)!
    expect(gkAssign.slotId).toBe('gk')
    expect(gkAssign.pesRole).toBe('GK')
    const prefAssign = res11.assignments.find((a) => a.playerId === preferredOutfield.id)!
    expect(prefAssign.slotId).toBe('cbc')
    expect(prefAssign.role).toBe('cb_cover')
    expect(prefAssign.nx).toBeCloseTo(0.14, 4)

    // 10-man red card adaptation: 4-4-2 drops 1 ST and centers the lone remaining ST at ny = 0.5 → 4-4-1!
    const tenMen = team.players.filter((p, idx) => idx !== 10)
    expect(tenMen).toHaveLength(10)
    const res10 = computeFormationReassignment(tenMen, '4-4-2')
    expect(res10.assignments).toHaveLength(10)
    expect(res10.shapeLabel).toBe('4-4-1')
    const loneSt = res10.assignments.filter((a) => a.position === 'ST')
    expect(loneSt).toHaveLength(1)
    expect(loneSt[0].ny).toBeCloseTo(0.5, 4)
  })

  it('evaluates priority, once-latch, 3-minute cooldown, and urgent score/red-card bypass accurately', () => {
    const rules: MatchPlanRule[] = [
      {
        id: 'r-red',
        name: '红牌收缩',
        enabled: true,
        condition: { minMinute: 0, maxMinute: 90, redCard: 'own_down' },
        action: { mentality: 'defend' },
      },
      {
        id: 'r-tired',
        name: '体能下降控节奏',
        enabled: true,
        condition: { minMinute: 50, maxMinute: 90, avgStaminaBelow: 55 },
        action: { mentality: 'defend' },
      },
      {
        id: 'r-once',
        name: '半场搏命锁定',
        enabled: true,
        once: true,
        condition: { minMinute: 45, maxMinute: 90, score: 'trailing' },
        action: { mentality: 'attack' },
      },
    ]

    // Kickoff normal: no rule matches
    let res = evaluateCustomMatchPlanRules(rules, {
      minute: 0, scoreDiff: 0, effectiveDiff: 0, ownOnPitch: 11, oppOnPitch: 11, avgStaminaPct: 100, isKickoff: true,
    })
    expect(res.changed).toBe(false)
    expect(res.rule).toBeNull()

    // Minute 50 stamina drops below 55 → r-tired triggers immediately (first switch from base)
    res = evaluateCustomMatchPlanRules(rules, {
      minute: 50, scoreDiff: 0, effectiveDiff: 0, ownOnPitch: 11, oppOnPitch: 11, avgStaminaPct: 54, isKickoff: false,
    }, res.nextState)
    expect(res.changed).toBe(true)
    expect(res.rule?.id).toBe('r-tired')

    // Minute 51 stamina ticks back to 56 (routine change within 3 min cooldown) → debounced!
    res = evaluateCustomMatchPlanRules(rules, {
      minute: 51, scoreDiff: 0, effectiveDiff: 0, ownOnPitch: 11, oppOnPitch: 11, avgStaminaPct: 56, isKickoff: false,
    }, res.nextState)
    expect(res.changed).toBe(false)
    expect(res.nextState.activeRuleId).toBe('r-tired')

    // Minute 51.5 WE GET A RED CARD (urgent!) → bypasses cooldown immediately and fires r-red!
    res = evaluateCustomMatchPlanRules(rules, {
      minute: 51.5, scoreDiff: 0, effectiveDiff: 0, ownOnPitch: 10, oppOnPitch: 11, avgStaminaPct: 56, isKickoff: false,
    }, res.nextState)
    expect(res.changed).toBe(true)
    expect(res.rule?.id).toBe('r-red')

    // Separate test for once: true latch (doesn't revert when score goes back to 0-0)
    let onceRes = evaluateCustomMatchPlanRules([rules[2]], {
      minute: 46, scoreDiff: -1, effectiveDiff: -1, ownOnPitch: 11, oppOnPitch: 11, avgStaminaPct: 75, isKickoff: false,
    })
    expect(onceRes.changed).toBe(true)
    expect(onceRes.rule?.id).toBe('r-once')
    expect(onceRes.nextState.latchedRuleId).toBe('r-once')

    // Equalize at 55' → because r-once is latched, stays on r-once instead of reverting to base
    onceRes = evaluateCustomMatchPlanRules([rules[2]], {
      minute: 55, scoreDiff: 0, effectiveDiff: 0, ownOnPitch: 11, oppOnPitch: 11, avgStaminaPct: 70, isKickoff: false,
    }, onceRes.nextState)
    expect(onceRes.changed).toBe(false)
    expect(onceRes.rule?.id).toBe('r-once')
  })

  it('executes mid-match formation switch, linked sub (before formation), revert to base, and weighted conditionFactor in PesGame', () => {
    const game = createWorldGame(20261123)
    const lineup = structuredClone(game.lineup)
    lineup.formationId = '4-3-3'
    // Rebuild valid 4-3-3 starters if needed
    const defendSlot: BackupTactic = BACKUP_TACTIC_TEMPLATES.find((t) => t.id === 'bus_532')!.build('slot-2')
    lineup.backupTactics = [defendSlot]
    lineup.matchPlanRules = [
      {
        id: 'rule-phase-1',
        name: '20-45分切5-3-2铁桶+换上后卫',
        enabled: true,
        condition: { minMinute: 20, maxMinute: 45, score: 'any' },
        action: {
          tacticSlotId: defendSlot.id,
          mentality: 'defend',
          linkedSub: { outKind: 'lowest_stamina', inKind: 'best_defender' },
        },
      },
    ]

    const baseLineup = applyBackupTacticToLineup(game.roster, lineup, {
      id: 'tmp',
      name: 'base',
      formationId: '4-3-3',
      mentality: 'balanced',
      tacticalStyle: 'control',
      tacticalInstructions: cloneInstructions(STYLES_REV3.control.instructions),
    })
    baseLineup.backupTactics = lineup.backupTactics
    baseLineup.matchPlanRules = lineup.matchPlanRules

    const homeInput = teamInputFromLineup(game.roster, baseLineup, {
      id: 'home', name: '奥利给', color: '#34d399', accent: '#052e1b',
    }, { tacticsStage: 10 })
    const awayInput = teamInputFromAI(game.aiTeams[0])

    const pes = new PesGame({ seed: 777001, home: homeInput, away: awayInput, durationSeconds: 900, offside: true })
    expect(pes.state.teams[0].formationId).toBe('4-3-3')

    // Advance to minute 25 (250s in 900s match) → rule-phase-1 should have switched to 5-3-2 AND done linked sub!
    pes.advance(250)
    const homeTeam = pes.state.teams[0]
    expect(homeTeam.formationId).toBe('5-3-2')
    expect(homeTeam.activeRuleName).toBe('20-45分切5-3-2铁桶+换上后卫')
    expect(homeTeam.mentality).toBe('defend')
    expect(homeTeam.subsUsed).toBeGreaterThanOrEqual(1)
    expect(homeTeam.planRuleState?.linkedSubRuleIds).toContain('rule-phase-1')
    // Verify physical PesPlayer positions actually updated to 5-3-2 (3 CBs + 2 WBs + 3 CMs + 2 STs)
    const cbCount = homeTeam.players.filter((p) => p.onPitch && p.position === 'CB').length
    expect(cbCount).toBe(3)
    const physRoles = pes.match.teams[0].players.map((p) => p.role)
    expect(physRoles.filter((r) => r === 'CB').length).toBe(3)
    expect(physRoles.filter((r) => r === 'ST').length).toBe(2)

    // Advance past minute 50 (500s) → rule-phase-1 window ended, should revert cleanly back to 4-3-3!
    pes.advance(260)
    expect(homeTeam.formationId).toBe('4-3-3')
    expect(homeTeam.activeRuleName).toBeUndefined()
    expect(homeTeam.players.filter((p) => p.onPitch && p.position === 'CB').length).toBe(2)

    // Finish match and check commentary + weighted conditionFactor
    pes.run()
    const tacticNotes = pes.state.log.filter((e) => e.type === 'tactic' && e.team === 'home')
    expect(tacticNotes.some((e) => e.text.includes('20-45分切5-3-2铁桶+换上后卫') && e.text.includes('5-3-2'))).toBe(true)
    expect(tacticNotes.some((e) => e.text.includes('恢复主战术') && e.text.includes('4-3-3'))).toBe(true)
    expect(homeTeam.planConditionFactor).toBeDefined()
    expect(effectiveMatchConditionFactor(homeTeam)).toBe(homeTeam.planConditionFactor)
    expect(homeTeam.planConditionFactor!).toBeGreaterThanOrEqual(0.84)
    expect(homeTeam.planConditionFactor!).toBeLessThanOrEqual(1.18)
  })

  it('server computeMatchJob executes custom FM rules & PesEngine.restore replay is 100% bit-for-bit identical', () => {
    const game = createWorldGame(20261124)
    const bundle = createFMClassicBundle(game.lineup.formationId)
    // Add an unconditional 35'-90' rule to guarantee mid-match formation switch & linked sub fire in this test seed
    const guaranteedRules: MatchPlanRule[] = [
      {
        id: 'rule-guaranteed-532',
        name: '35分必切5-3-2并换防',
        enabled: true,
        condition: { minMinute: 35, maxMinute: 90, score: 'any' },
        action: {
          tacticSlotId: bundle.backupTactics[0].id,
          mentality: 'defend',
          linkedSub: { outKind: 'lowest_stamina', inKind: 'best_defender' },
        },
      },
    ]
    const playerLineup = structuredClone(game.lineup)
    playerLineup.backupTactics = bundle.backupTactics
    playerLineup.matchPlanRules = guaranteedRules

    const homeTeamObj = {
      ...game.aiTeams[0],
      id: 'club-home-fm',
      name: 'FM测试队',
      players: structuredClone(game.roster),
      lineup: playerLineup,
      formationId: playerLineup.formationId,
      tactics: playerLineup.tactics,
    }
    const awayTeamObj = {
      ...game.aiTeams[1],
      id: 'club-away-ai',
    }

    const job: MatchJob = {
      id: 'q-fm-plan-test',
      season: 2,
      divisionId: 'division2-north',
      round: 1,
      kickoffAt: Date.now(),
      lockedAt: Date.now() - 1800_000,
      seed: 987654321,
      gameDayMs: 86_400_000,
      home: {
        team: homeTeamObj,
        injuries: {},
        suspended: [],
        medical: 5,
        tacticsStage: 12,
        stadiumStage: 8,
        coachId: 'coach-test',
      },
      away: {
        team: awayTeamObj,
        injuries: {},
        suspended: [],
        medical: 3,
        tacticsStage: 5,
        ai: true,
      },
    }

    const result = computeMatchJob(job)
    expect(result.initialState).toBeDefined()
    // Server background simulation actually fired the formation switch & linked sub!
    expect(result.record.keyEvents.some((e) => e.type === 'tactic' && e.text.includes('35分必切5-3-2并换防') && e.text.includes('5-3-2'))).toBe(true)
    expect(result.record.instructions.some((i) => i.kind === 'tactic' && i.formationId === '5-3-2' && i.planRuleName === '35分必切5-3-2并换防')).toBe(true)
    expect(result.record.instructions.some((i) => i.kind === 'sub' && i.autoReason === 'tactical')).toBe(true)

    // Restore initialState just like client 2D live broadcast & replay do → MUST be 100% identical!
    const replayedEngine = PesEngine.restore(result.initialState!, false)
    const replayedState = replayedEngine.simulate()
    expect(replayedState.score).toEqual(result.record.score)
    expect(replayedState.teams[0].formationId).toBe('5-3-2')
    expect(replayedState.teams[0].activeRuleName).toBe('35分必切5-3-2并换防')
    expect(replayedState.instructions).toEqual(result.record.instructions)
    expect(replayedState.stats.home.shots).toBe(result.record.stats.home.shots)
    expect(replayedState.stats.away.shots).toBe(result.record.stats.away.shots)
  })

  it('supports Agent API set_lineup & lineup UI rendering with FM tactical slots and match plan rules', () => {
    const game = createWorldGame(20261125)
    const bundle = createFMClassicBundle(game.lineup.formationId)

    // Agent API set_lineup saves backupTactics + matchPlanRules cleanly (pass timestamp well before kickoff lock)
    const nextKickoff = game.season.fixtures.find((f) => f.isPlayer && !f.played)?.kickoffAt ?? game.season.startedAt
    const unlockedNow = nextKickoff - 3_600_000
    const res = applyAgentAction(game, {
      action: 'set_lineup',
      lineup: {
        formationId: game.lineup.formationId,
        starters: game.lineup.starters,
        bench: game.lineup.bench,
        tactics: game.lineup.tactics,
        backupTactics: bundle.backupTactics,
        matchPlanRules: bundle.matchPlanRules,
      },
    }, unlockedNow)
    expect(res.error).toBeUndefined()
    expect(res.ok).toBe(true)
    expect(game.lineup.backupTactics?.length).toBe(3)
    expect(game.lineup.matchPlanRules?.length).toBe(4)

    // Invalid rule reference via Agent API is cleanly rejected
    const badRes = applyAgentAction(game, {
      action: 'set_lineup',
      lineup: {
        formationId: game.lineup.formationId,
        starters: game.lineup.starters,
        bench: game.lineup.bench,
        tactics: game.lineup.tactics,
        backupTactics: bundle.backupTactics,
        matchPlanRules: [{ id: 'bad', name: 'bad', enabled: true, condition: {}, action: { tacticSlotId: 'no-such-slot' } }],
      },
    }, unlockedNow)
    expect(badRes.ok).toBe(false)

    const view = agentView(game) as Record<string, unknown>
    expect(Array.isArray(view.backupTacticTemplates)).toBe(true)

    // FM Tactical Plan UI panel renders slots, rules, and active custom badge cleanly
    const html = renderFmTacticalPlanPanel({ draft: game.lineup, roster: game.roster, disabled: false })
    expect(html).toContain('FM 战术槽 & 条件比赛计划')
    expect(html).toContain('5-3-2 领先铁桶')
    expect(html).toContain('红牌少打一人：立刻收缩 4-4-1')
    expect(html).toContain('自定义生效 · 4 条规则')
  })

  it('responds immediately to an in-match red card by switching to 10-man 4-4-1 shape', () => {
    const game = createWorldGame(20261126)
    const redSlot = BACKUP_TACTIC_TEMPLATES.find((t) => t.id === 'redcard_442')!.build('slot-red')
    const lineup = structuredClone(game.lineup)
    lineup.backupTactics = [redSlot]
    lineup.matchPlanRules = [
      {
        id: 'rule-red-card',
        name: '少打一人立即缩4-4-1',
        enabled: true,
        condition: { minMinute: 0, maxMinute: 90, redCard: 'own_down' },
        action: { tacticSlotId: redSlot.id, mentality: 'defend' },
      },
    ]
    const homeInput = teamInputFromLineup(game.roster, lineup, {
      id: 'home', name: '红牌测试队', color: '#34d399', accent: '#052e1b',
    })
    const awayInput = teamInputFromAI(game.aiTeams[0])
    const pes = new PesGame({ seed: 777002, home: homeInput, away: awayInput, durationSeconds: 900, offside: true })

    // Advance 30 seconds (minute 3), rule must NOT have triggered while 11v11
    pes.advance(30)
    expect(pes.state.teams[0].activeRuleName).toBeUndefined()

    // Simulate a red card removing 1 home outfield player from the physical pitch & marking sentOff
    const victimPhys = pes.match.teams[0].players.find((p) => p.slot !== 0)!
    const victimGame = pes.settlement.gamePlayer(victimPhys.pid)
    victimGame.sentOff = true
    victimGame.onPitch = false
    const pIdx = pes.match.teams[0].players.indexOf(victimPhys)
    pes.match.teams[0].players.splice(pIdx, 1)
    pes.match.teams[0].offPlayers.push(victimPhys)

    // Advance just 2 seconds → urgent red-card bypass must fire immediately and reshape 10 men into 4-4-1!
    pes.advance(2)
    const homeTeam = pes.state.teams[0]
    expect(homeTeam.activeRuleName).toBe('少打一人立即缩4-4-1')
    expect(homeTeam.formationId).toBe('4-4-2')
    expect(homeTeam.mentality).toBe('defend')
    const activePhys = pes.match.teams[0].players
    expect(activePhys).toHaveLength(10)
    const stPhys = activePhys.filter((p) => p.role === 'ST')
    expect(stPhys).toHaveLength(1)
    expect(stPhys[0].hn.y).toBeCloseTo(0.5, 4)
    expect(pes.state.log.some((e) => e.type === 'tactic' && e.text.includes('4-4-1'))).toBe(true)
  })

  const servers: AppServer[] = []
  const dirs: string[] = []
  afterEach(async () => {
    while (servers.length) await servers.pop()!.close()
    while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
  })

  it('persists and validates backupTactics & matchPlanRules end-to-end over HTTP PUT/GET /api/game', async () => {
    const clock = Date.UTC(2026, 10, 9, 8, 15)
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-tacplan-'))
    dirs.push(dataDir)
    const app = createAppServer({ dataDir, staticDir: path.resolve('dist'), tickMs: 0, now: () => clock })
    servers.push(app)
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`

    const reg = await (await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fm_tactics_coach', password: 'secret123' }),
    })).json() as { token: string; game: ReturnType<typeof createWorldGame>; revision: number }

    const headers = { Authorization: `Bearer ${reg.token}`, 'Content-Type': 'application/json' }
    const initial = await (await fetch(`${base}/api/game`, { headers })).json() as { game: ReturnType<typeof createWorldGame>; revision: number }
    const bundle = createFMClassicBundle(initial.game.lineup.formationId)

    // 1. Valid save succeeds and persists through GET /api/game
    const nextGame = structuredClone(initial.game)
    nextGame.lineup.backupTactics = bundle.backupTactics
    nextGame.lineup.matchPlanRules = bundle.matchPlanRules
    const putOk = await fetch(`${base}/api/game`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ game: nextGame, baseRevision: initial.revision }),
    })
    expect(putOk.status).toBe(200)
    const savedPayload = await putOk.json() as { revision: number }

    const reloaded = await (await fetch(`${base}/api/game`, { headers })).json() as { game: ReturnType<typeof createWorldGame> }
    expect(reloaded.game.lineup.backupTactics).toHaveLength(3)
    expect(reloaded.game.lineup.matchPlanRules).toHaveLength(4)
    expect(reloaded.game.lineup.matchPlanRules![0].condition.redCard).toBe('own_down')

    // 2. Invalid rule slot reference is rejected with HTTP 400
    const badGame = structuredClone(reloaded.game)
    badGame.lineup.matchPlanRules = [{
      id: 'bad-rule',
      name: '非法引用',
      enabled: true,
      condition: { minMinute: 50, maxMinute: 90 },
      action: { tacticSlotId: 'slot-nonexistent' },
    }]
    const putBad = await fetch(`${base}/api/game`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ game: badGame, baseRevision: savedPayload.revision }),
    })
    expect(putBad.status).toBe(400)
  })
})
