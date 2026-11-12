import { describe, expect, it } from 'vitest'
import { attrStorage } from '../src/game/scale.ts'
import { ALL_ATTRIBUTES, type AITeam, type AttrKey, type Player } from '../src/game/types.ts'
import { createRandomPlayer } from '../src/game/data/random-players.ts'
import { createInitialGame } from '../src/game/state.ts'
import { createWorldGame } from '../src/game/world.ts'
import { legendTeamById } from '../src/game/legend.ts'
import { buildPeakTeam } from '../src/game/peak.ts'
import { loadPveContent } from '../src/game/pve-content.ts'
import { autoFillLineup, MAX_SUBS, refreshAILineup } from '../src/game/squad.ts'
import { buildMatchEngineForGame, teamInputFromAI } from '../src/game/match/setup.ts'
import { buildMatchTeam } from '../src/game/match/team.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { PesEngine } from '../src/game/pes/engine.ts'
import {
  deriveAITacticalProfile,
  evaluateAICoachTactics,
  executeAICoachSubs,
} from '../src/game/ai-tactics.ts'
import { computeMatchJob, type MatchJob } from '../server/match-job.ts'
import { GAME_DAY_MS } from '../src/game/calendar.ts'
import { LOGIC_MATCH_SECONDS } from '../src/game/match/time.ts'

function makeCustomPlayer(
  id: string,
  pos: 'GK' | 'CB' | 'W' | 'CM' | 'ST',
  baseRating: number,
  overrides: Partial<Record<AttrKey, number>> = {},
  height = 180,
): Player {
  const base = createRandomPlayer({ seed: 1001, position: pos, tier: 3, idPrefix: id })
  const isGk = pos === 'GK'
  const attrs = {} as Player['attrs']
  const ceilings = {} as Player['ceilings']
  for (const key of ALL_ATTRIBUTES) {
    const r = overrides[key] ?? baseRating
    attrs[key] = attrStorage(key, r, isGk)
    ceilings[key] = attrStorage(key, Math.min(99, r + 8), isGk)
  }
  return {
    ...base,
    id,
    name: `球员_${id}`,
    enName: id,
    age: 24,
    height,
    foot: 'R',
    positions: {
      GK: pos === 'GK' ? 100 : 0,
      CB: pos === 'CB' ? 100 : pos === 'CM' ? 40 : 0,
      W: pos === 'W' ? 100 : pos === 'ST' || pos === 'CM' ? 50 : 0,
      CM: pos === 'CM' ? 100 : pos === 'W' ? 50 : 0,
      ST: pos === 'ST' ? 100 : pos === 'W' ? 50 : 0,
    },
    attrs,
    ceilings,
    pa: 1200,
    condition: 100,
  }
}

function buildSyntheticSquad(
  prefix: string,
  customize: (pos: 'GK' | 'CB' | 'W' | 'CM' | 'ST', idx: number) => {
    rating: number
    overrides?: Partial<Record<AttrKey, number>>
    height?: number
  },
): Player[] {
  const positions: ('GK' | 'CB' | 'W' | 'CM' | 'ST')[] = [
    'GK',
    'CB', 'CB', 'CB', 'CB',
    'W', 'W', 'W', 'W',
    'CM', 'CM', 'CM', 'CM',
    'ST', 'ST',
    'GK', 'CB', 'CM', 'W', 'ST',
  ]
  return positions.map((pos, idx) => {
    const cfg = customize(pos, idx)
    return makeCustomPlayer(`${prefix}_${idx}`, pos, cfg.rating, cfg.overrides, cfg.height)
  })
}

describe('AI 赛前战术画像与因材施教配置', () => {
  it('世界联赛与单机联赛为所有 AI 球队配置多样化战术风格与十二项指令，且不篡改玩家初始白板阵容', () => {
    const offline = createInitialGame(42)
    expect(offline.lineup.tacticalInstructions).toBeUndefined()
    expect(offline.aiTeams.length).toBeGreaterThan(0)
    for (const ai of offline.aiTeams) {
      expect(ai.lineup.tacticalStyle).toBeDefined()
      expect(ai.lineup.tacticalInstructions).toBeDefined()
    }

    const worldGame = createWorldGame(2026)
    expect(worldGame.lineup.tacticalInstructions).toBeUndefined()
    const distinctStyles = new Set(worldGame.aiTeams.map((t) => t.lineup.tacticalStyle))
    expect(distinctStyles.size).toBeGreaterThanOrEqual(4)
  })

  it('根据俱乐部打法与首发球员能力差异，自动匹配传控、两翼高球、低位防反及慢中卫防线保护', () => {
    // 1. 高技术短传控球型阵容 -> tikiTaka / control / verticalTiki + 短传
    const tikiPlayers = buildSyntheticSquad('tiki', (pos) => ({
      rating: 72,
      overrides: pos === 'GK' ? {} : { passing: 88, firstTouch: 87, vision: 86, composure: 85, decisions: 85, speed: 66 },
      height: 175,
    }))
    const tikiLineup = autoFillLineup(tikiPlayers, '4-3-3', {
      attack: 'middle',
      passing: 'short',
      tempo: 'slow',
      line: 'high',
      press: 'high',
    })
    const tikiProfile = deriveAITacticalProfile({
      players: tikiPlayers,
      lineup: tikiLineup,
      clubStyle: '短传控球，靠中场轮转制造空位',
      seedTactics: tikiLineup.tactics,
      strength: 5,
    })
    expect(['tikiTaka', 'control', 'verticalTiki']).toContain(tikiProfile.tacticalStyle)
    expect(tikiProfile.tacticalInstructions.possession.passing).toBe('short')

    // 2. 快马边锋 + 195cm 高中锋 -> wingPlay + 提前传中 (early)
    const wingPlayers = buildSyntheticSquad('wing', (pos) => {
      if (pos === 'W') return { rating: 74, overrides: { speed: 90, acceleration: 90, dribbling: 86, passing: 82 } }
      if (pos === 'ST') return { rating: 74, overrides: { heading: 90, strength: 88, speed: 68 }, height: 195 }
      return { rating: 70 }
    })
    const wingLineup = autoFillLineup(wingPlayers, '4-4-2', {
      attack: 'wing',
      passing: 'mixed',
      tempo: 'fast',
      line: 'mid',
      press: 'mid',
    })
    const wingProfile = deriveAITacticalProfile({
      players: wingPlayers,
      lineup: wingLineup,
      clubStyle: '边路传中与禁区抢点',
      seedTactics: wingLineup.tactics,
      strength: 4,
    })
    expect(wingProfile.tacticalStyle).toBe('wingPlay')
    expect(wingProfile.tacticalInstructions.advanced?.possession?.crossTiming).toBe('early')

    // 3. 低位防守 + 高速前锋 -> directCounter / fluidCounter + 得球立即反击
    const counterPlayers = buildSyntheticSquad('cnt', (pos) => {
      if (pos === 'ST') return { rating: 72, overrides: { speed: 91, acceleration: 90, offBall: 86 } }
      if (pos === 'CB') return { rating: 75, overrides: { defPos: 86, tackling: 85, strength: 84, speed: 65 } }
      return { rating: 68 }
    })
    const counterLineup = autoFillLineup(counterPlayers, '5-3-2', {
      attack: 'balanced',
      passing: 'direct',
      tempo: 'fast',
      line: 'low',
      press: 'low',
    })
    const counterProfile = deriveAITacticalProfile({
      players: counterPlayers,
      lineup: counterLineup,
      clubStyle: '稳守反击，低位防守快速反击',
      seedTactics: counterLineup.tactics,
      strength: 3,
    })
    expect(['directCounter', 'fluidCounter', 'catenaccio']).toContain(counterProfile.tacticalStyle)
    expect(counterProfile.tacticalInstructions.defense.line).toBe('low')

    // 4. 慢速中卫安全保护：即便俱乐部倾向高防线，中卫回追过慢时自动降为中位防线
    const slowCbPlayers = buildSyntheticSquad('slowcb', (pos) => {
      if (pos === 'CB') return { rating: 68, overrides: { speed: 40, acceleration: 40, defPos: 78 } }
      return { rating: 75, overrides: { endurance: 82, teamwork: 80, passing: 80, firstTouch: 80 } }
    })
    const slowCbLineup = autoFillLineup(slowCbPlayers, '4-3-3', {
      attack: 'wing',
      passing: 'short',
      tempo: 'normal',
      line: 'high',
      press: 'high',
    })
    const slowCbProfile = deriveAITacticalProfile({
      players: slowCbPlayers,
      lineup: slowCbLineup,
      seedTactics: slowCbLineup.tactics,
      strength: 4,
    })
    expect(slowCbProfile.tacticalInstructions.defense.line).not.toBe('high')
  })

  it('PvE 传奇球队与巅峰之路球队构建输入时自动挂载契合战术与主教练 AI，且不污染冻结原对象', async () => {
    await loadPveContent()
    const legend = legendTeamById('barca-11') ?? buildPeakTeam(10)
    expect(Object.isFrozen(legend.lineup) || legend.lineup.tacticalInstructions === undefined).toBe(true)
    const input = teamInputFromAI(legend)
    expect(input.aiCoach).toBe(true)
    expect(input.tacticalStyle).toBeDefined()
    expect(input.instructions).toBeDefined()
    expect(input.familiarity).toBeGreaterThan(0.75)
    expect(legend.lineup.tacticalInstructions).toBeUndefined()

    // refreshAILineup 幂等稳定
    const clone: AITeam = structuredClone(buildPeakTeam(5))
    expect(refreshAILineup(clone)).toBe(true)
    expect(clone.lineup.tacticalStyle).toBeDefined()
    expect(refreshAILineup(clone)).toBe(false)
  })
})

describe('AI 赛中临场战术调度与智能换人', () => {
  it('AI 教练根据比分、分钟数与红牌劣势动态切换追分、搏命、锁局、控场与少人防反阶段', () => {
    const game = createInitialGame(99)
    const aiInput = teamInputFromAI(game.aiTeams[0])
    const oppInput = teamInputFromAI(game.aiTeams[1])
    const aiTeam = buildMatchTeam(aiInput, 'home')
    const oppTeam = buildMatchTeam(oppInput, 'away')

    // 开场 10 分钟：保持赛前基准不变
    expect(evaluateAICoachTactics(aiTeam, oppTeam, { minute: 10, scoreDiff: -1 }, false)).toBeNull()

    // 62 分钟落后 1 球：进入下半场追分阶段（全体进攻 + 加快节奏）
    const chase = evaluateAICoachTactics(aiTeam, oppTeam, { minute: 62, scoreDiff: -1 }, false)
    expect(chase).not.toBeNull()
    expect(chase!.phaseId).toBe('ai_second_half_chase')
    expect(chase!.mentality).toBe('attack')
    expect(chase!.instructions.possession.tempo).toBe('fast')
    expect(chase!.announcement).toContain('落后')
    aiTeam.aiCoachPhase = chase!.phaseId

    // 同阶段重复检查不重复刷屏
    expect(evaluateAICoachTactics(aiTeam, oppTeam, { minute: 65, scoreDiff: -1 }, false)).toBeNull()

    // 68 分钟扳平比分：恢复赛前基准战术
    const equalized = evaluateAICoachTactics(aiTeam, oppTeam, { minute: 68, scoreDiff: 0 }, false)
    expect(equalized).not.toBeNull()
    expect(equalized!.phaseId).toBe('base')
    expect(equalized!.mentality).toBe('balanced')
    aiTeam.aiCoachPhase = equalized!.phaseId

    // 79 分钟再次落后：升级为终场孤注一掷围攻
    const siege = evaluateAICoachTactics(aiTeam, oppTeam, { minute: 79, scoreDiff: -1 }, false)
    expect(siege).not.toBeNull()
    expect(siege!.phaseId).toBe('ai_late_siege')
    expect(siege!.mentality).toBe('attack')
    expect(siege!.instructions.defense.line).toBe('high')
    expect(siege!.instructions.possession.passing).toBe('direct')
    aiTeam.aiCoachPhase = siege!.phaseId

    // 85 分钟反超 1 球：切换为终场深度锁门保胜果
    const lockdown = evaluateAICoachTactics(aiTeam, oppTeam, { minute: 85, scoreDiff: 1 }, false)
    expect(lockdown).not.toBeNull()
    expect(lockdown!.phaseId).toBe('ai_late_lockdown')
    expect(lockdown!.mentality).toBe('defend')
    expect(lockdown!.instructions.defense.line).toBe('low')
    expect(lockdown!.instructions.possession.tempo).toBe('slow')
    aiTeam.aiCoachPhase = lockdown!.phaseId

    // 60 分钟两球领先：慢节奏控场节省体能
    const cushion = evaluateAICoachTactics(aiTeam, oppTeam, { minute: 60, scoreDiff: 2 }, false)
    expect(cushion).not.toBeNull()
    expect(cushion!.phaseId).toBe('ai_cruise_cushion')
    expect(cushion!.staminaMul).toBeLessThan(1)
    aiTeam.aiCoachPhase = cushion!.phaseId

    // 30 分钟吃到红牌少打一人：立即回收紧凑防反
    aiTeam.players[2].sentOff = true
    aiTeam.players[2].onPitch = false
    const redCompact = evaluateAICoachTactics(aiTeam, oppTeam, { minute: 30, scoreDiff: 0 }, false)
    expect(redCompact).not.toBeNull()
    expect(redCompact!.phaseId).toBe('ai_red_compact')
    expect(redCompact!.mentality).toBe('defend')
  })

  it('AI 智能换人按波次与黄牌/比分优先级换上对位生力军，且遵守换人上限与门将保护', () => {
    const game = createInitialGame(123)
    const aiInput = teamInputFromAI(game.aiTeams[0])
    const team = buildMatchTeam(aiInput, 'away')

    // 58 分钟：身背黄牌且体能降到 62% 的外场球员被保护性换下
    const booked = team.players.find((p) => p.position !== 'GK')!
    booked.yellowCards = 1
    booked.stamina = booked.maxStamina * 0.62
    const subsMade: { outId: string; inId: string; reason: string }[] = []
    executeAICoachSubs({
      team,
      clockSeconds: (58 / 90) * LOGIC_MATCH_SECONDS,
      durationSeconds: LOGIC_MATCH_SECONDS,
      scoreDiff: 0,
      availableBench: () => team.bench.filter((p) => !p.cameOff && !p.onPitch),
      substitute: (outId, inId, reason) => {
        subsMade.push({ outId, inId, reason })
        const idx = team.players.findIndex((p) => p.id === outId)
        const inc = team.bench.find((p) => p.id === inId)!
        const out = team.players[idx]
        team.players[idx] = { ...inc, role: out.role, slotId: out.slotId, position: out.position, onPitch: true, subbedOn: true }
        team.bench = team.bench.filter((p) => p.id !== inId)
        team.bench.push({ ...out, onPitch: false, cameOff: true })
        team.subsUsed++
        return true
      },
    })
    expect(subsMade.length).toBe(1)
    expect(subsMade[0].outId).toBe(booked.id)

    // 75 分钟落后 1 球，多名外场球员疲惫：继续分波次换人，不换门将、不换刚替补登场的球员、总数不超过波次上限 4
    for (const p of team.players) {
      if (p.position !== 'GK' && !p.subbedOn) p.stamina = p.maxStamina * 0.55
      if (p.position === 'GK') p.stamina = p.maxStamina * 0.45
    }
    executeAICoachSubs({
      team,
      clockSeconds: (75 / 90) * LOGIC_MATCH_SECONDS,
      durationSeconds: LOGIC_MATCH_SECONDS,
      scoreDiff: -1,
      availableBench: () => team.bench.filter((p) => !p.cameOff && !p.onPitch),
      substitute: (outId, inId, reason) => {
        const out = team.players.find((p) => p.id === outId)!
        expect(out.position).not.toBe('GK')
        expect(out.subbedOn).not.toBe(true)
        subsMade.push({ outId, inId, reason })
        const idx = team.players.findIndex((p) => p.id === outId)
        const inc = team.bench.find((p) => p.id === inId)!
        team.players[idx] = { ...inc, role: out.role, slotId: out.slotId, position: out.position, onPitch: true, subbedOn: true }
        team.bench = team.bench.filter((p) => p.id !== inId)
        team.bench.push({ ...out, onPitch: false, cameOff: true })
        team.subsUsed++
        return true
      },
    })
    expect(team.subsUsed).toBeGreaterThanOrEqual(2)
    expect(team.subsUsed).toBeLessThanOrEqual(4)
  })

  it('在 PesEngine 与 MatchEngine 完整 90 分钟实况中，AI 均能自主完成战术调整与换人', () => {
    const game = createInitialGame(314)
    // PES 物理引擎整场检验
    const pes = buildMatchEngineForGame(
      game,
      { isLeague: false, mode: 'friendly', opponentId: game.aiTeams[0].id, opponentName: game.aiTeams[0].name, seed: 202611, homeAway: 'home' },
      game.aiTeams[0],
    ) as PesEngine
    const pesEnd = pes.simulate()
    const awayPes = pesEnd.teams[1]
    expect(awayPes.aiCoach).toBe(true)
    expect(awayPes.subsUsed).toBeGreaterThanOrEqual(1)
    expect(awayPes.subsUsed).toBeLessThanOrEqual(MAX_SUBS)
    // 玩家主队未被标记 aiCoach，没有做任何未授权自动战术换人
    expect(pesEnd.teams[0].aiCoach).toBeUndefined()
    expect(pesEnd.teams[0].subsUsed).toBe(0)

    // MatchEngine 整场检验（两支 AI 互踢）
    const me = new MatchEngine({
      seed: 8801,
      home: teamInputFromAI(game.aiTeams[1]),
      away: teamInputFromAI(game.aiTeams[2]),
      knockout: false,
      durationSeconds: LOGIC_MATCH_SECONDS,
    })
    // 让主队开场 0:2 落后以必然触发 AI 赛中追分战术调整与多轮换人
    me.state.score.home = 0
    me.state.score.away = 2
    const meEnd = me.simulate()
    expect(meEnd.teams[0].subsUsed + meEnd.teams[1].subsUsed).toBeGreaterThanOrEqual(2)
    expect(meEnd.teams[0].subsUsed).toBeLessThanOrEqual(MAX_SUBS)
    expect(meEnd.teams[1].subsUsed).toBeLessThanOrEqual(MAX_SUBS)
    const aiTacticLogs = meEnd.log.filter((entry) => entry.type === 'tactic')
    expect(aiTacticLogs.length).toBeGreaterThan(0)
  })

  it('联机 MatchJob：真人教练完全保留手动控制权，AI 对手自主换人调战术，且客户端 2D 回放与服务器结算 100% 一致', () => {
    const worldGame = createWorldGame(777)
    const humanAsTeam: AITeam = {
      id: 'player-club',
      name: worldGame.clubName,
      short: '玩家',
      color: '#34d399',
      accent: '#052e1b',
      style: '均衡',
      formationId: worldGame.lineup.formationId,
      tactics: worldGame.lineup.tactics,
      strength: 4,
      playerNames: [],
      lineup: structuredClone(worldGame.lineup),
      players: structuredClone(worldGame.roster),
      starPlayerIds: [],
    }
    const aiOpponent = structuredClone(worldGame.aiTeams[0])

    const job: MatchJob = {
      id: 'q-test-ai-coaching-replay',
      season: 1,
      divisionId: worldGame.season.divisionId ?? 'champions',
      round: 1,
      kickoffAt: 1_760_000_000_000,
      lockedAt: 1_760_000_000_000 - 1800_000,
      seed: 556677,
      gameDayMs: GAME_DAY_MS,
      home: {
        team: humanAsTeam,
        injuries: {},
        suspended: [],
        medical: 1,
        tacticsStage: 5,
        // 真人在线教练：ai 与 aiTakeover 均为假
      },
      away: {
        team: aiOpponent,
        injuries: {},
        suspended: [],
        medical: 10,
        tacticsStage: 15,
        ai: true,
      },
    }

    const result = computeMatchJob(job)
    expect(result.initialState).toBeDefined()
    expect(result.initialState!.teams[0].aiCoach).toBeUndefined()
    expect(result.initialState!.teams[1].aiCoach).toBe(true)

    // 客户端从 initialState 恢复并逐秒推进到终场，比分、换人指令、AI 战术指令必须完全一致
    const clientReplay = PesEngine.restore(structuredClone(result.initialState!), false)
    const replayEnd = clientReplay.simulate()
    expect(replayEnd.score).toEqual(result.record.score)
    expect(replayEnd.instructions).toEqual(result.record.instructions)
    expect(replayEnd.teams[1].subsUsed).toBeGreaterThanOrEqual(1)
    expect(replayEnd.teams[0].subsUsed).toBe(0)
  })
})
