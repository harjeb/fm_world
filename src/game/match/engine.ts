import { STAR_TRAITS } from '../data/star-traits.generated.ts'
import type { ShotScope, TraitCondition } from '../data/star-traits.ts'
import type { BaseTraitId } from '../types.ts'
import { skillTierMultiplier } from './team.ts'
import { MatchRatings } from './ratings.ts'
import { FREE_KICK_DELIVERY_RANGE, FREE_KICK_SHOT_RANGE, PRESS_LEVEL, SettlementKernel, pickByWeight, totalWeight } from './resolution.ts'
import type { PassModel, PassType, ShotModel } from './resolution.ts'
import type {
  GoalDetail,
  FailureReason,
  MatchInstruction,
  MatchLogEntry,
  PlayerMatchStats,
  RoleId,
  SkillId,
  MatchMentality,
} from '../types.ts'
import { MATCH_TACTICS, MATCH_MENTALITY_LABELS, autoSubDisplaySeconds } from './management.ts'
import { FORMATIONS } from '../data/formations.ts'
import { MAX_SUBS } from '../squad.ts'
import { ROLES, ROLES_BY_POSITION } from '../data/roles.ts'
import { SKILLS, TRAITS } from '../data/skills.ts'
import { effectiveAttr, isGoalkeeper } from '../ca.ts'
import { PCG32, derivedRng } from '../rng.ts'
import { injuryRecoveryDays } from '../injury.ts'
import { commentLog, commentPossession, restoreCommentary } from './commentary.ts'
import { chooseShotFoot, chooseShotTarget, shotAimPoint, shotPositionText, shotTargetText } from './shooting.ts'
import { GOAL_Y, PITCH_LENGTH, PITCH_WIDTH, buildMatchTeam, opponentSide } from './team.ts'
import { LOGIC_MATCH_SECONDS, MATCH_BASE_TICK_SECONDS, MATCH_RULES_VERSION, displayClock, matchRuleSet } from './time.ts'
import type { MatchRuleSet } from './time.ts'
import { capturePlaybackPose, PLAYBACK_FRAME_LIMIT, PLAYBACK_FRAME_LIMIT_V3 } from './playback.ts'
import { motionProfileOf, motionStateAt, stepMotion } from './kinematics.ts'
import type { MotionProfile, MotionState } from './kinematics.ts'
import type {
  BallMotion,
  BallState,
  MatchActionChoice,
  MatchActionState,
  MatchBallFlight,
  MatchEventContext,
  MatchPlayerState,
  MatchPlaybackFrame,
  MatchPlaybackPose,
  MatchSide,
  MatchState,
  MatchTeamInput,
  MatchTeamState,
  RngState,
  SetPieceState,
  StepResult,
} from './types.ts'
import type { ShotChanceDetail } from '../types.ts'
import { clamp, dirOf, distance, distanceToSegment, goalXOf, inBox, ownGoalXOf, progressOf, wideZone } from './pitch.ts'

const TEMPO_MULT = { slow: 1.2, normal: 1, fast: 0.8 } as const
const LINE_X = { low: 16, mid: 27, high: 39 } as const
const PRESS_RANGE = { low: 17, mid: 27, high: 38 } as const
const GOAL_CENTER = { x: PITCH_LENGTH, y: GOAL_Y }

type ActionChoice = {
  kind: 'pass' | 'dribble' | 'shoot' | 'clear'
  type?: PassType
  targetId?: string
  start?: { x: number; y: number }
  point: { x: number; y: number }
  label: string
  estimatedP: number
  successValue: number
  failureValue: number
  estimatedTime: number
  chanceType?: ShotChanceDetail['type']
  q?: number
}

type DecisionResult = {
  choice: ActionChoice
  probabilities: Record<string, number>
  recognized: number
  missed: number
  chosenQ: number
  bestQ: number
}

/** 0.1 秒基础步的量化：避免 0.30000000000000004 这类时钟误差累积。 */
const toTick = (value: number): number => Math.round(value * 10) / 10

function rngState(rng: PCG32): RngState {
  return rng.toJSON()
}

import { needsShootout } from './knockout.ts'

export class MatchEngine {
  state: MatchState
  private decisionRng: PCG32
  private resultRng: PCG32
  private knockout: boolean
  private durationSeconds: number
  private rules: MatchRuleSet
  private continuous: boolean
  private legacyRules: boolean
  private offside: boolean
  private recordPlayback = true
  private playbackStepActive = false
  private playbackBeforeReset?: MatchPlaybackPose

  constructor(options: { seed: number; home: MatchTeamInput; away: MatchTeamInput; knockout: boolean; shootoutOffset?: { home: number; away: number }; durationSeconds?: number; offside?: boolean; recordPlayback?: boolean; rulesVersion?: number }) {
    const home = buildMatchTeam(options.home, 'home')
    const away = buildMatchTeam(options.away, 'away')
    this.decisionRng = derivedRng(options.seed, 'match-decision')
    this.resultRng = derivedRng(options.seed, 'match-result')
    this.knockout = options.knockout
    this.durationSeconds = options.durationSeconds ?? LOGIC_MATCH_SECONDS
    this.rules = matchRuleSet(options.rulesVersion ?? MATCH_RULES_VERSION)
    this.continuous = this.rules === 'v3'
    this.legacyRules = this.rules === 'legacy'
    this.offside = options.offside ?? false
    this.recordPlayback = options.recordPlayback ?? true
    this.state = {
      seed: options.seed,
      rulesVersion: options.rulesVersion ?? MATCH_RULES_VERSION,
      step: 0,
      clock: 0,
      durationSeconds: this.durationSeconds,
      half: 1,
      phase: 'setpiece',
      score: { home: 0, away: 0 },
      teams: [home, away],
      ball: { x: PITCH_LENGTH / 2, y: GOAL_Y, ownerId: null, justReceived: false },
      possession: 'home',
      pendingSetPiece: { type: 'kickoff', teamSide: 'home', x: PITCH_LENGTH / 2, y: GOAL_Y },
      finished: false,
      offside: this.offside,
      shootout: null,
      ...(options.shootoutOffset ? { shootoutOffset: { ...options.shootoutOffset } } : {}),
      log: [],
      commentary: [],
      stats: {
        home: emptyTeamStats(),
        away: emptyTeamStats(),
      },
      failures: {
        unrecognized: { count: 0, examples: [] },
        misjudged: { count: 0, examples: [] },
        position_timing: { count: 0, examples: [] },
        execution: { count: 0, examples: [] },
      },
      playerFailures: {},
      skillStats: [],
      decisionStats: { recognized: 0, missed: 0, choices: {} },
      instructions: [],
      decisionRng: rngState(this.decisionRng),
      resultRng: rngState(this.resultRng),
      lastGoalBy: null,
    }
    this.resetKickoffPositions('home')
    this.initSkillStats()
    this.syncRng()
  }

  static fromState(state: MatchState): MatchEngine {
    const engine = Object.create(MatchEngine.prototype) as MatchEngine
    engine.state = state
    restoreCommentary(state)
    engine.offside = state.offside ?? false
    engine.decisionRng = PCG32.fromState(state.decisionRng.state, state.decisionRng.inc)
    engine.resultRng = PCG32.fromState(state.resultRng.state, state.resultRng.inc)
    engine.knockout = false
    engine.durationSeconds = state.durationSeconds ?? 1200
    engine.rules = matchRuleSet(state.rulesVersion)
    engine.continuous = engine.rules === 'v3'
    engine.legacyRules = engine.rules === 'legacy'
    // Object.create 不会跑字段初始值，这里要自己补上。
    engine.playbackStepActive = false
    engine.playbackBeforeReset = undefined
    engine.recordPlayback = true
    return engine
  }

  static restore(state: MatchState, knockout: boolean): MatchEngine {
    const engine = MatchEngine.fromState(state)
    engine.knockout = knockout
    return engine
  }

  serialize(): MatchState {
    this.syncRng()
    return this.state
  }

  /** 隔离副本保留比赛模式与随机流，不对原状态执行 serialize 的同步写入。 */
  clone(): MatchEngine {
    const state = structuredClone(this.state)
    state.decisionRng = rngState(this.decisionRng)
    state.resultRng = rngState(this.resultRng)
    return MatchEngine.restore(state, this.knockout)
  }

  private syncRng(): void {
    this.state.decisionRng = rngState(this.decisionRng)
    this.state.resultRng = rngState(this.resultRng)
  }

  private initSkillStats(): void {
    for (const team of this.state.teams) {
      for (const player of [...team.players, ...team.bench]) {
        for (const skillId of player.skills) {
          this.state.skillStats.push({
            skillId,
            playerId: player.id,
            side: player.side,
            name: player.name,
            conditions: 0,
            applied: 0,
          })
        }
      }
    }
  }

  get ruleSet(): MatchRuleSet {
    return this.rules
  }

  step(realtime = false): StepResult {
    if (this.continuous) return this.stepContinuous(realtime)
    return this.stepAtomic(realtime)
  }

  private stepAtomic(realtime = false): StepResult {
    if (this.state.finished) return { state: this.state, entry: null, finished: true }
    let playbackFrom = this.recordPlayback ? capturePlaybackPose(this.state) : undefined
    let restart = this.state.pendingSetPiece?.type
    this.playbackStepActive = this.recordPlayback
    this.playbackBeforeReset = undefined
    try {
      this.state.step++
      const logStart = this.state.log.length
      this.state.ballMotion = undefined
      let entry: MatchLogEntry | null = null
      if (realtime && this.state.phase !== 'shootout') this.checkPeriod()
      if (this.state.finished) {
        this.syncRng()
        this.recordPlaybackFrame(playbackFrom, restart, false)
        return { state: this.state, entry: this.state.log.at(-1) ?? null, finished: true }
      }
      if (realtime && this.playbackBeforeReset) {
        // 实时中场重置发生在动作之前：本步应播放新开球，不是重播上半场末的位置。
        playbackFrom = capturePlaybackPose(this.state)
        restart = this.state.pendingSetPiece?.type
        this.playbackBeforeReset = undefined
      }
      const oldBall = this.state.ball
      const oldOwner = this.carrier()
      const from = this.state.pendingSetPiece
        ? { x: this.state.pendingSetPiece.x, y: this.state.pendingSetPiece.y }
        : oldOwner ? { x: oldOwner.x, y: oldOwner.y } : { x: oldBall.x, y: oldBall.y }
      if (this.state.phase !== 'shootout' && this.state.clock < this.durationSeconds) this.applyAutoSubs()
      if (this.state.phase === 'shootout') {
        this.advanceShootout()
      } else {
        const carrier = this.carrier()
        if (carrier && !this.state.pendingSetPiece && this.state.step % 2 === 0) commentPossession(this.state, carrier)
        entry = this.state.pendingSetPiece ? this.executeSetPiece() : this.openPlay()
        if (realtime && this.state.half === 1) this.state.clock = Math.min(this.state.clock, this.durationSeconds / 2)
        if (!realtime) this.checkPeriod()
      }
      this.syncRng()
      if (entry === null && this.state.log.length > logStart) entry = this.state.log[this.state.log.length - 1]
      const events = this.state.log.slice(logStart)
      const goal = events.find((event) => event.type === 'goal')
      const shot = events.find((event) => ['goal', 'save', 'miss', 'block', 'shot'].includes(event.type))
      const action = goal ?? shot ?? entry
      if (action && this.state.phase !== 'shootout') {
        const kind = shot ? 'shot' : action.type === 'dribble' ? 'dribble' : action.type === 'pass' ? 'pass' : 'loose'
        const origin = goal?.goal?.origin
        const via = origin && distance(from, origin) > 4 ? origin : undefined
        // resetKickoffPositions 可在上面的动作调用内写入；TS 不跟踪方法的字段副作用。
        const beforeReset = this.playbackBeforeReset as MatchPlaybackPose | undefined
        const target = action?.shotAim
          ? { x: action.shotAim.x, y: action.shotAim.y }
          : goal?.goal
            ? { x: goalXOf(goal.goal.side), y: GOAL_Y }
            : { x: beforeReset?.ball.x ?? this.state.ball.x, y: beforeReset?.ball.y ?? this.state.ball.y }
        this.state.ballMotion = { step: this.state.step, kind, from, ...(via ? { via } : {}), to: target }
      }
      this.recordPlaybackFrame(playbackFrom, restart, goal !== undefined)
      return { state: this.state, entry, finished: this.state.finished }
    } finally {
      this.playbackStepActive = false
      this.playbackBeforeReset = undefined
    }
  }

  private recordPlaybackFrame(from: MatchPlaybackPose | undefined, restart: MatchPlaybackFrame['restart'], goal: boolean): void {
    if (!from) return
    // 进球后全队被拉回中圈：下一步不是一次 30 米的冲刺，而是一次重置。
    // 只影响回放元数据，比分/随机数/事件都不变。
    if (!restart && this.state.playbackFrames?.at(-1)?.goal) restart = 'kickoff'
    const to = this.playbackBeforeReset ?? capturePlaybackPose(this.state)
    to.clock = this.state.clock
    const motion = this.state.ballMotion ? structuredClone(this.state.ballMotion) : undefined
    // 赛果已将真实球重置到中圈；视觉球仍须先飞抵球门。
    if (goal && motion) to.ball = { ...to.ball, ...motion.to, ownerId: null, justReceived: false }
    const frame: MatchPlaybackFrame = {
      step: this.state.step,
      from,
      to,
      ...(motion ? { motion } : {}),
      ...(restart ? { restart } : {}),
      ...(goal ? { goal: true } : {}),
    }
    this.state.playbackFrames = [...(this.state.playbackFrames ?? []), frame].slice(-PLAYBACK_FRAME_LIMIT)
  }

  // ── v3：0.1 秒连续仿真 ─────────────────────────────────────────────

  /** 推进到目标比赛时刻；不启动 target 之后的新动作，也不产生 target 之后的事件。 */
  advanceTo(targetClock: number): { changed: boolean; entries: MatchLogEntry[] } {
    if (!this.continuous) throw new Error('advanceTo 只用于 v3 比赛')
    const startClock = this.state.clock
    const logStart = this.state.log.length
    let guard = 0
    while (!this.state.finished && this.state.clock < targetClock - 1e-6 && guard++ < 200_000) {
      this.tickOnce()
    }
    this.syncRng()
    return { changed: this.state.clock > startClock, entries: this.state.log.slice(logStart) }
  }

  /** 一次 step 仍是一个动作/回合：从选动作推进到它被裁决（或半场/终场）。 */
  private stepContinuous(_realtime = false): StepResult {
    if (this.state.finished) return { state: this.state, entry: null, finished: true }
    const logStart = this.state.log.length
    const startStep = this.state.step
    let guard = 0
    while (!this.state.finished && guard++ < 20_000) {
      if (this.state.phase === 'shootout') {
        this.advanceShootout()
        this.state.step++
        break
      }
      const boundary = this.tickOnce()
      if (boundary) break
      if (this.state.step > startStep && !this.state.action) break
    }
    this.syncRng()
    const entries = this.state.log.slice(logStart)
    return { state: this.state, entry: entries.at(-1) ?? null, finished: this.state.finished }
  }

  private tickOnce(): boolean {
    if (this.state.finished) return true
    if (this.state.phase === 'shootout') return false
    if (!this.state.action) {
      const periodEnd = this.state.half === 1 ? this.durationSeconds / 2 : this.durationSeconds
      if (this.state.clock >= periodEnd - 1e-6 && !this.penaltyHoldsPeriod()) return this.checkPeriodContinuous()
      this.beginContinuousAction()
      if (!this.state.action) {
        this.advanceContinuousClock()
        return false
      }
    }
    const action = this.state.action!
    // 上一帧的 to 就是这一 tick 的起点；重启首 tick 例外：先摆好球/站位，让切镜头从新位置开始。
    const startsRestart = action.restart !== undefined && Math.abs(this.state.clock - action.startedAt) < 1e-9
    const previousFrame = this.state.playbackFrames?.at(-1)
    const from = this.recordPlayback
      ? (startsRestart || !previousFrame || Math.abs(previousFrame.to.clock - this.state.clock) > 1e-9
        ? capturePlaybackPose(this.state)
        : previousFrame.to)
      : undefined
    const logStart = this.state.log.length
    this.refreshActionTargets(action)
    this.integrateTeams(MATCH_BASE_TICK_SECONDS)
    this.advanceContinuousClock()
    if (action.kind === 'open' && action.phase === 'prepare') this.glueBallToOwner()
    if (
      action.phase === 'prepare'
      && action.kind !== 'loose'
      && action.kind !== 'foul'
      && action.choice?.kind !== 'dribble'
      && this.state.clock >= action.releaseAt - 1e-6
    ) {
      this.releaseContinuousAction(action)
    }
    if (action.flight) {
      this.positionFlight(action)
      this.glueBallToOwner()
    }
    if (this.state.clock >= action.resolveAt - 1e-6) this.resolveContinuousAction(action)
    const goal = this.state.log.slice(logStart).some((entry) => entry.type === 'goal')
    this.recordContinuousFrame(from, action, goal)
    if (!this.state.action) {
      const periodEnd = this.state.half === 1 ? this.durationSeconds / 2 : this.durationSeconds
      if (this.state.clock >= periodEnd - 1e-6 && !this.penaltyHoldsPeriod()) return this.checkPeriodContinuous()
    }
    return false
  }

  /**
   * 半场或终场前判给的点球要先罚完，不会被哨声吞掉（旧引擎 checkPeriod 的规则，v3 之前漏了）。
   * 到了期末时下一个动作就是这个点球；罚完后 pendingSetPiece 不再是 penalty，本节才结束。
   */
  private penaltyHoldsPeriod(): boolean {
    return this.state.pendingSetPiece?.type === 'penalty'
  }

  private advanceContinuousClock(): void {
    // 期末补罚的点球不占比赛时钟：时钟停在期末，点球的事件都落在期末这一刻，日志时间不会倒退，
    // 下半场 / 终场的时长也不会被吃掉。只有期末被点球拖住时才会走到这里。
    const periodEnd = this.state.half === 1 ? this.durationSeconds / 2 : this.durationSeconds
    if (this.state.clock >= periodEnd - 1e-6) return
    this.state.tick = (this.state.tick ?? 0) + 1
    this.state.clock = toTick(this.state.clock + MATCH_BASE_TICK_SECONDS)
    if (this.state.possession) this.addPossessionTime(this.state.possession, MATCH_BASE_TICK_SECONDS)
    this.advancePlayerMinutes(MATCH_BASE_TICK_SECONDS)
  }

  private beginContinuousAction(): void {
    if (this.state.phase === 'shootout' || this.state.finished) return
    if (this.state.clock < this.durationSeconds) this.applyAutoSubs()
    const pending = this.state.pendingSetPiece
    if (pending) {
      this.beginSetPieceAction(pending)
      return
    }
    const carrier = this.carrier()
    if (carrier) this.beginOpenAction(carrier)
    else this.beginLooseAction()
  }

  private beginOpenAction(carrier: MatchPlayerState): void {
    const team = this.getTeam(carrier.side)
    const opp = this.getOpponent(carrier.side)
    this.state.possession = carrier.side
    this.state.phase = 'open'
    const decision = this.chooseAction(team, opp, carrier)
    const timing = this.computeTiming(team, opp, carrier, decision.choice)
    const ticks = Math.max(1, Math.round(timing.total / MATCH_BASE_TICK_SECONDS))
    const prepTicks = Math.max(1, Math.min(ticks - 1, Math.round(timing.prep / MATCH_BASE_TICK_SECONDS)))
    const start = this.state.clock
    const periodEnd = this.state.half === 1 ? this.durationSeconds / 2 : this.durationSeconds
    const resolveAt = Math.min(periodEnd, toTick(start + ticks * MATCH_BASE_TICK_SECONDS))
    const id = this.state.step + 1
    this.state.step = id
    const choice = decision.choice as unknown as MatchActionChoice
    const action: MatchActionState = {
      id,
      kind: 'open',
      phase: 'prepare',
      choice,
      startedAt: start,
      releaseAt: Math.min(resolveAt, toTick(start + prepTicks * MATCH_BASE_TICK_SECONDS)),
      resolveAt,
      from: { x: carrier.x, y: carrier.y },
      target: { ...choice.point },
      actorId: carrier.id,
      receiverId: choice.targetId,
      targets: {},
      targetsAt: -1,
      decision: {
        recognized: decision.recognized,
        missed: decision.missed,
        chosenQ: decision.chosenQ,
        bestQ: decision.bestQ,
      },
    }
    if (choice.kind === 'dribble') action.releaseAt = resolveAt
    this.state.action = action
    if (this.state.step % 2 === 0) commentPossession(this.state, carrier)
    // 先设好本步 id 再判犯规：v2 的派生随机数就是按 step 取的，这样两边不会错位。
    const foul = this.maybeTacticalFoul(opp, carrier)
    if (foul) {
      action.kind = 'foul'
      action.resolveAt = Math.min(action.resolveAt, toTick(start + MATCH_BASE_TICK_SECONDS))
      action.releaseAt = action.resolveAt
    }
  }

  private beginLooseAction(): void {
    let nearest: { player: MatchPlayerState; dist: number } | null = null
    for (const team of this.state.teams) {
      for (const player of team.players) {
        if (!player.onPitch || player.position === 'GK') continue
        const dist = distance(player, this.state.ball)
        if (!nearest || dist < nearest.dist) nearest = { player, dist }
      }
    }
    const start = this.state.clock
    const periodEnd = this.state.half === 1 ? this.durationSeconds / 2 : this.durationSeconds
    const duration = nearest ? clamp(nearest.dist / 6.2, 1, 3.2) : 1
    const resolveAt = Math.min(periodEnd, toTick(start + duration))
    const id = this.state.step + 1
    this.state.step = id
    const action: MatchActionState = {
      id,
      kind: 'loose',
      phase: 'prepare',
      startedAt: start,
      releaseAt: resolveAt,
      resolveAt,
      from: { x: this.state.ball.x, y: this.state.ball.y },
      target: { x: this.state.ball.x, y: this.state.ball.y },
      targets: {},
      targetsAt: -1,
    }
    this.state.action = action
    this.state.phase = 'open'
    if (nearest) this.state.possession = nearest.player.side
  }

  private beginSetPieceAction(sp: SetPieceState): void {
    const type = sp.type
    const teamSide = sp.teamSide
    const team = this.getTeam(teamSide)
    const opp = this.getOpponent(teamSide)
    const gx = goalXOf(teamSide)
    const dir = dirOf(teamSide)
    if (type === 'kickoff') this.resetKickoffPositions(teamSide)
    const start = this.state.clock
    const periodEnd = this.state.half === 1 ? this.durationSeconds / 2 : this.durationSeconds
    const total = type === 'throw_in' ? 5 : type === 'corner' || type === 'free_kick' ? 7 : 6
    let mode: 'pass' | 'shot' | 'cross' = 'pass'
    let taker: MatchPlayerState | null = null
    let target: MatchPlayerState | null = null
    let delivery = { x: sp.x, y: sp.y }
    if (type === 'kickoff') {
      taker = this.pickTaker(team, 'pass', sp.x, sp.y)
      target = taker ? this.pickSafeOutlet(team, taker) : null
    } else if (type === 'throw_in') {
      taker = this.nearestOutfielder(team, sp)
      target = taker ? this.pickSafeOutlet(team, taker) : null
    } else if (type === 'goal_kick') {
      taker = this.teamGoalkeeper(team)
      target = taker ? this.pickSafeOutlet(team, taker) : null
    } else if (type === 'corner') {
      taker = this.pickTaker(team, 'cross', sp.x, sp.y)
      delivery = { x: gx - dir * 8, y: GOAL_Y }
      mode = 'cross'
    } else if (type === 'free_kick') {
      const dist = distance(sp, { x: gx, y: GOAL_Y })
      if (dist < FREE_KICK_SHOT_RANGE && Math.abs(sp.y - GOAL_Y) < 22) mode = 'shot'
      else if (dist < FREE_KICK_DELIVERY_RANGE) mode = 'cross'
      taker = this.pickTaker(team, mode === 'shot' ? 'shoot' : mode === 'cross' ? 'cross' : 'pass', sp.x, sp.y, true)
      if (mode === 'shot') delivery = { x: gx, y: GOAL_Y }
      else if (mode === 'cross') delivery = { x: gx - dir * 8, y: GOAL_Y }
      else target = taker ? this.pickSafeOutlet(team, taker) : null
    } else {
      mode = 'shot'
      taker = this.pickTaker(team, 'shoot', gx - dir * 12, GOAL_Y)
      delivery = { x: gx, y: GOAL_Y }
    }
    if (!taker) {
      this.state.pendingSetPiece = null
      this.state.ball = { x: PITCH_LENGTH / 2, y: GOAL_Y, ownerId: null, justReceived: false }
      this.state.phase = 'open'
      return
    }
    const point = mode === 'shot' ? { x: gx, y: GOAL_Y } : mode === 'cross' ? delivery : target ? { x: target.x, y: target.y } : { x: sp.x + dir * 14, y: sp.y }
    const choice: MatchActionChoice = {
      kind: mode === 'shot' ? 'shoot' : 'pass',
      type: mode === 'cross' ? 'cross' : undefined,
      targetId: target?.id,
      point,
      label: type === 'kickoff' ? '开球' : type === 'corner' ? '角球' : type === 'penalty' ? '点球' : type === 'free_kick' ? '任意球' : '定位球',
      estimatedP: 0.8,
      successValue: 0,
      failureValue: 0,
      estimatedTime: total,
    }
    const flightSeconds = mode === 'shot' ? 0.6 : mode === 'cross' ? 0.9 : 0.7
    const setup = Math.max(0.8, total - flightSeconds - 0.3)
    const releaseAt = toTick(start + setup)
    const resolveAt = Math.min(periodEnd, toTick(start + total))
    const id = this.state.step + 1
    this.state.step = id
    const action: MatchActionState = {
      id,
      kind: 'setpiece',
      phase: 'prepare',
      choice,
      startedAt: start,
      releaseAt: Math.min(releaseAt, resolveAt - MATCH_BASE_TICK_SECONDS),
      resolveAt,
      from: { x: sp.x, y: sp.y },
      target: { ...choice.point },
      restart: type,
      setPiece: { type, teamSide, x: sp.x, y: sp.y, takerId: taker.id, mode, targetId: target?.id },
      actorId: taker.id,
      receiverId: target?.id,
      targets: {},
      targetsAt: -1,
      decision: { recognized: 0, missed: 0, chosenQ: 0, bestQ: 0 },
    }
    this.state.action = action
    this.state.pendingSetPiece = null
    this.state.phase = 'setpiece'
    this.state.possession = teamSide
    this.state.ball = { x: sp.x, y: sp.y, ownerId: null, justReceived: false }
    action.targets = this.buildSetPieceTargets(action, team, opp)
    action.targetsAt = start
    const note = type === 'kickoff' ? `${team.name} 在中圈开球。`
      : type === 'throw_in' ? `${team.name} 获得界外球。`
        : type === 'goal_kick' ? `${team.name} 门将开球门球。`
          : type === 'corner' ? `${team.name} 获得角球。`
            : type === 'penalty' ? `${taker.name} 站上点球点。`
              : `${team.name} 获得任意球。`
    this.log('setpiece', teamSide, note, { playerId: taker.id })
  }

  private buildSetPieceTargets(action: MatchActionState, team: MatchTeamState, opp: MatchTeamState): Record<string, { x: number; y: number }> {
    const targets: Record<string, { x: number; y: number }> = {}
    const sp = action.setPiece!
    const taker = this.playerById(action.actorId)
    const choice = action.choice as unknown as ActionChoice
    const presser = taker ? this.pickPresser(opp, taker) : null
    const marking = this.buildMarking(opp, team)
    for (const player of [...team.players, ...opp.players]) {
      if (!player.onPitch) continue
      const ownTeam = player.side === team.side ? team : opp
      const otherTeam = player.side === team.side ? opp : team
      targets[player.id] = this.desiredTarget(player, player.side === team.side, ownTeam, otherTeam, taker ?? player, choice, presser, marking)
    }
    if (taker) targets[taker.id] = { x: sp.x, y: sp.y }
    if (sp.type === 'corner' || (sp.type === 'free_kick' && sp.mode === 'cross')) {
      const gx = goalXOf(team.side)
      const dir = dirOf(team.side)
      const attackers = team.players.filter((player) => player.onPitch && player.position !== 'GK').sort((a, b) => b.attrs.heading - a.attrs.heading)
      const defenders = opp.players.filter((player) => player.onPitch && player.position !== 'GK').sort((a, b) => b.attrs.heading - a.attrs.heading)
      attackers.slice(0, 3).forEach((player, index) => {
        targets[player.id] = { x: clamp(gx - dir * (7 + index * 2), 4, PITCH_LENGTH - 4), y: clamp(GOAL_Y + (index - 1) * 7, 20, 44) }
      })
      defenders.slice(0, 4).forEach((player, index) => {
        targets[player.id] = { x: clamp(gx - dir * (3 + index * 1.5), 3, PITCH_LENGTH - 3), y: clamp(GOAL_Y + (index - 1.5) * 6, 22, 42) }
      })
      const gk = this.teamGoalkeeper(opp)
      if (gk) targets[gk.id] = { x: gx - dir, y: GOAL_Y }
    } else if (sp.type === 'penalty') {
      const gx = goalXOf(team.side)
      const dir = dirOf(team.side)
      targets[taker!.id] = { x: gx - dir * 12, y: GOAL_Y }
      const gk = this.teamGoalkeeper(opp)
      if (gk) targets[gk.id] = { x: gx - dir * 0.8, y: GOAL_Y }
    } else if (sp.type === 'goal_kick') {
      const dir = dirOf(team.side)
      targets[taker!.id] = { x: ownGoalXOf(team.side) + dir * 6, y: GOAL_Y }
    }
    return targets
  }

  private refreshActionTargets(action: MatchActionState): void {
    if (action.kind === 'foul') return
    if (action.kind === 'setpiece' && this.state.clock < action.releaseAt - 1e-6) return
    const owner = this.carrier()
    const receiver = action.receiverId ? this.playerById(action.receiverId) : undefined
    const teamSide = action.setPiece?.teamSide ?? owner?.side ?? this.playerById(action.actorId)?.side ?? this.state.possession ?? 'home'
    const team = this.getTeam(teamSide)
    const opp = this.getOpponent(teamSide)
    const carrier = owner ?? receiver ?? this.nearestToBall() ?? this.playerById(action.actorId)
    if (!carrier) return
    const choice = (action.choice as unknown as ActionChoice | undefined) ?? {
      kind: 'dribble', point: { x: this.state.ball.x, y: this.state.ball.y }, label: '', estimatedP: 0, successValue: 0, failureValue: 0, estimatedTime: 0,
    }
    const tick = this.state.tick ?? 0
    if (!action.targets) action.targets = {}
    const chasers = action.kind === 'loose' ? this.looseChasers() : null
    let anyDue = false
    for (const player of [...team.players, ...opp.players]) {
      if (!player.onPitch) continue
      if (!action.targets[player.id] || this.intentDue(player.id, tick) || chasers?.has(player.id)) {
        anyDue = true
        break
      }
    }
    if (!anyDue) return
    const presser = this.pickPresser(opp, carrier)
    const marking = this.buildMarking(opp, team)
    action.presserId = presser ?? undefined
    for (const player of [...team.players, ...opp.players]) {
      if (!player.onPitch) continue
      if (action.targets[player.id] && !this.intentDue(player.id, tick) && !chasers?.has(player.id)) continue
      if (chasers?.has(player.id)) {
        action.targets[player.id] = { x: this.state.ball.x, y: this.state.ball.y }
        continue
      }
      const ownTeam = player.side === team.side ? team : opp
      const otherTeam = player.side === team.side ? opp : team
      action.targets[player.id] = this.desiredTarget(player, player.side === team.side, ownTeam, otherTeam, carrier, choice, presser, marking)
    }
    action.targetsAt = this.state.clock
  }

  private intentDue(id: string, tick: number): boolean {
    let hash = 2166136261
    for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
    const period = 2 + (hash % 4)
    return (tick + (hash % period)) % period === 0
  }

  private nearestToBall(): MatchPlayerState | undefined {
    let best: MatchPlayerState | undefined
    let bestDist = Infinity
    for (const team of this.state.teams) {
      for (const player of team.players) {
        if (!player.onPitch) continue
        const dist = distance(player, this.state.ball)
        if (dist < bestDist) {
          best = player
          bestDist = dist
        }
      }
    }
    return best
  }

  private looseChasers(): Set<string> {
    const picked = new Set<string>()
    for (const team of this.state.teams) {
      team.players
        .filter((player) => player.onPitch && (player.position !== 'GK' || inBox(team.side, this.state.ball) || distance(player, this.state.ball) < 10))
        .sort((a, b) => distance(a, this.state.ball) - distance(b, this.state.ball))
        .slice(0, 2)
        .forEach((player) => picked.add(player.id))
    }
    return picked
  }

  private motionProfileFor(player: MatchPlayerState): MotionProfile {
    // 用整数百分位做键：缓存连同 profile 一起存档，读档后不会在动作中途重算。
    const staminaKey = Math.round((player.stamina / Math.max(1, player.maxStamina)) * 100)
    this.state.motionProfiles ??= {}
    const cached = this.state.motionProfiles[player.id]
    if (cached && cached.stamina === staminaKey) return cached.profile
    const profile = motionProfileOf({
      speed: this.eff(player, 'speed'),
      acceleration: this.eff(player, 'acceleration', { wide: wideZone(player) }),
      agility: this.eff(player, 'agility'),
      stamina: staminaKey / 100,
    })
    this.state.motionProfiles[player.id] = { stamina: staminaKey, profile }
    return profile
  }

  private integrateTeams(dt: number): void {
    const action = this.state.action
    if (!action) return
    const presser = action.presserId ?? null
    for (const team of this.state.teams) {
      const opp = this.getOpponent(team.side)
      for (const player of team.players) {
        if (!player.onPitch) continue
        const target = action.targets?.[player.id]
        if (!target) continue
        const ratio = player.stamina / Math.max(1, player.maxStamina)
        const profile = this.motionProfileFor(player)
        const stored = player.motion
        const motion: MotionState = {
          x: player.x,
          y: player.y,
          vx: stored?.vx ?? 0,
          vy: stored?.vy ?? 0,
          heading: stored?.heading ?? 0,
        }
        stepMotion(motion, profile, target, dt)
        const nx = clamp(motion.x, 2, PITCH_LENGTH - 2)
        const ny = clamp(motion.y, 2, PITCH_WIDTH - 2)
        const moved = Math.hypot(nx - player.x, ny - player.y)
        player.x = nx
        player.y = ny
        player.motion = { vx: motion.vx, vy: motion.vy, heading: motion.heading }
        if (moved > 0) {
          player.stats.distance += moved
          this.state.stats[player.side].distance += moved
        }
        const endurance = this.eff(player, 'endurance')
        const enduranceFactor = 0.7 + endurance / 180
        const pressIntensity = 1 + (player.side === opp.side ? PRESS_LEVEL[opp.tactics.press] * 0.08 : 0) + (player.role === 'cm_destroyer' ? 0.06 : 0)
        let drain = (moved * 0.028 + 0.018 * (dt / 4.1)) * pressIntensity * this.staminaFactor(player) / enduranceFactor
        if (!this.legacyRules) drain *= 0.77
        if (player.skills.includes('iron_lung')) drain *= 1 - (0.05 + (skillTierMultiplier(player, 'iron_lung') - 1) * 0.25)
        if (player.position === 'GK') drain *= 0.5
        if (player.side === opp.side && presser === player.id) drain *= 1.12
        const staminaTrait = STAR_TRAITS[player.traitId]
        if (staminaTrait?.kind === 'stamina' && this.traitConditionMet(player, staminaTrait.when)) drain *= 1 - staminaTrait.drain / 100
        player.stamina = Math.max(0, player.stamina - drain)
        if (staminaTrait?.kind === 'secondWind' && !player.traitUsed && player.stamina / Math.max(1, player.maxStamina) < 0.6) {
          player.traitUsed = true
          player.stamina = Math.min(player.maxStamina, player.stamina + player.maxStamina * staminaTrait.stamina / 100)
        }
        if (moved < 0.08 && player.stamina < player.maxStamina) player.stamina = Math.min(player.maxStamina, player.stamina + 0.02 * (dt / 4.1))
        player.stats.staminaLeft = Math.round((player.stamina / Math.max(1, player.maxStamina)) * 100)
      }
    }
  }

  private glueBallToOwner(): void {
    const owner = this.carrier()
    if (!owner) return
    this.state.ball.x = owner.x
    this.state.ball.y = owner.y
  }

  private releaseContinuousAction(action: MatchActionState): void {
    const carrier = this.playerById(action.actorId) ?? this.carrier()
    const choice = action.choice as unknown as ActionChoice | undefined
    if (!carrier || !choice) return
    const team = this.getTeam(carrier.side)
    const opp = this.getOpponent(carrier.side)
    const sp = action.setPiece
    const launch = sp ? { x: sp.x, y: sp.y } : { x: carrier.x, y: carrier.y }
    let flight: MatchBallFlight | null = null
    if (choice.kind === 'pass') {
      let to = { ...choice.point }
      if (choice.type !== 'through' && choice.type !== 'cross') {
        const receiver = this.playerById(choice.targetId ?? null)
        if (receiver) {
          const rough = distance(launch, receiver) / 22
          to = {
            x: clamp(receiver.x + (receiver.motion?.vx ?? 0) * rough * 0.6, 2, PITCH_LENGTH - 2),
            y: clamp(receiver.y + (receiver.motion?.vy ?? 0) * rough * 0.6, 2, PITCH_WIDTH - 2),
          }
        }
      }
      const speed = choice.type === 'cross' ? 19 : distance(launch, to) > 25 ? 19 : 22
      const span = clamp(distance(launch, to) / speed, 0.18, Math.max(0.2, action.resolveAt - this.state.clock))
      flight = { kind: 'pass', from: launch, to, startedAt: this.state.clock, endsAt: toTick(this.state.clock + span) }
    } else if (choice.kind === 'shoot') {
      const opts = {
        point: { x: carrier.x, y: carrier.y },
        header: false,
        penalty: sp?.type === 'penalty',
        freeKick: sp?.type === 'free_kick',
      }
      const aim = this.shotAimFor(carrier, opp, opts)
      action.shotTarget = aim.target
      const span = clamp(distance(launch, aim.point) / 30, 0.25, Math.max(0.25, action.resolveAt - this.state.clock))
      flight = { kind: 'shot', from: launch, to: aim.point, startedAt: this.state.clock, endsAt: toTick(this.state.clock + span) }
    } else if (choice.kind === 'clear') {
      const span = clamp(distance(launch, choice.point) / 24, 0.2, Math.max(0.2, action.resolveAt - this.state.clock))
      flight = { kind: 'loose', from: launch, to: { ...choice.point }, startedAt: this.state.clock, endsAt: toTick(this.state.clock + span) }
    }
    if (!flight) return
    action.flight = flight
    action.phase = 'flight'
    this.state.ball = { x: launch.x, y: launch.y, ownerId: null, justReceived: false }
  }

  private shotAimFor(
    shooter: MatchPlayerState,
    opp: MatchTeamState,
    opts: { point: { x: number; y: number }; header: boolean; penalty: boolean; freeKick: boolean },
  ): { target: GoalDetail['target']; point: { x: number; y: number } } {
    const detailRng = derivedRng(this.state.seed, 'shot-detail', this.state.step, this.state.log.length)
    const balance = (this.eff(shooter, 'firstTouch') + this.eff(shooter, 'agility')) / 2
    if (!opts.header && !(opts.penalty && shooter.foot !== 'B')) chooseShotFoot(shooter, opts.point.y, balance, detailRng)
    const precision = opts.header
      ? 0.7 * this.eff(shooter, 'heading') + 0.3 * this.eff(shooter, 'composure')
      : 0.7 * this.eff(shooter, 'shooting') + 0.3 * this.eff(shooter, 'composure')
    const gk = this.teamGoalkeeper(opp)
    const target = chooseShotTarget(precision, detailRng, gk ? gk.y - GOAL_Y : 0)
    return { target, point: shotAimPoint(shooter.side, target) }
  }

  private positionFlight(action: MatchActionState): void {
    const flight = action.flight
    if (!flight) return
    const span = Math.max(0.1, flight.endsAt - flight.startedAt)
    const t = clamp((this.state.clock - flight.startedAt) / span, 0, 1)
    this.state.ball.x = flight.from.x + (flight.to.x - flight.from.x) * t
    this.state.ball.y = flight.from.y + (flight.to.y - flight.from.y) * t
    this.state.ball.ownerId = null
    if (t >= 1 && action.phase === 'flight') action.phase = 'settle'
  }

  private resolveContinuousAction(action: MatchActionState): void {
    const logStart = this.state.log.length
    let entry: MatchLogEntry | null = null
    if (action.kind === 'foul') {
      this.state.action = null
      return
    }
    if (action.kind === 'loose') {
      entry = this.resolveLooseBall()
    } else if (action.kind === 'setpiece') {
      entry = this.resolveSetPiece(action)
    } else {
      const carrier = this.playerById(action.actorId) ?? this.carrier()
      const choice = action.choice as unknown as ActionChoice | undefined
      if (carrier && choice) {
        const team = this.getTeam(carrier.side)
        const opp = this.getOpponent(carrier.side)
        if (choice.kind === 'pass') {
          choice.start = action.flight?.from
          entry = this.resolvePass(team, opp, carrier, choice, action.resolveAt - action.startedAt)
        } else if (choice.kind === 'dribble') {
          entry = this.resolveDribble(team, opp, carrier, choice, action.resolveAt - action.startedAt)
        } else if (choice.kind === 'shoot') {
          entry = this.resolveShot(carrier, team, opp, {
            point: { x: carrier.x, y: carrier.y }, header: false, penalty: false, freeKick: false, target: action.shotTarget,
          })
        } else {
          entry = this.resolveClear(team, carrier, choice)
        }
      }
    }
    this.state.action = null
    if (entry === null) entry = this.state.log.slice(logStart).at(-1) ?? null
    const carrier = this.playerById(action.actorId)
    if (entry?.reason && carrier && action.decision) {
      if (action.decision.missed > 0 && (action.choice?.kind === 'pass' || action.choice?.kind === 'dribble')) {
        this.addFailure(carrier, 'unrecognized', `${carrier.name} 没有识别到更向前的线路`)
      }
      if (action.decision.chosenQ < action.decision.bestQ - 0.05 && action.choice?.kind !== 'clear') {
        this.addFailure(carrier, 'misjudged', `${carrier.name} 在多个选择中选了一个风险收益更差的动作`)
      }
    }
    this.state.phase = this.state.pendingSetPiece ? 'setpiece' : 'open'
  }

  private resolveSetPiece(action: MatchActionState): MatchLogEntry | null {
    const sp = action.setPiece
    const choice = action.choice as unknown as ActionChoice | undefined
    if (!sp || !choice) return null
    const team = this.getTeam(sp.teamSide)
    const opp = this.getOpponent(sp.teamSide)
    const taker = this.playerById(sp.takerId ?? null)
    if (!taker) return null
    if (sp.type === 'corner') return this.resolveAerial(team, opp, choice.point, sp.teamSide, true)
    if (sp.type === 'free_kick') {
      if (sp.mode === 'shot') {
        return this.resolveShot(taker, team, opp, { point: { x: sp.x, y: sp.y }, header: false, penalty: false, freeKick: true, target: action.shotTarget })
      }
      if (sp.mode === 'cross') return this.deliverFreeKick(team, opp, taker)
    }
    if (sp.type === 'penalty') {
      return this.resolveShot(taker, team, opp, { point: { x: taker.x, y: taker.y }, header: false, penalty: true, freeKick: false, target: action.shotTarget })
    }
    return this.resolvePass(team, opp, taker, choice, 0)
  }

  private recordContinuousFrame(from: MatchPlaybackPose | undefined, action: MatchActionState, goal: boolean): void {
    if (!this.recordPlayback || !from) return
    const to = capturePlaybackPose(this.state)
    const motion = this.frameMotion(from, to, action)
    // 只有重启的首帧是硬切；定位球准备/飞行继续按子帧插值。
    const restart = action.restart && Math.abs(from.clock - action.startedAt) < 1e-9 ? action.restart : undefined
    const seq = (this.state.playbackSeq ?? 0) + 1
    this.state.playbackSeq = seq
    const frame: MatchPlaybackFrame = {
      step: action.id,
      seq,
      from,
      to,
      ...(motion ? { motion } : {}),
      ...(restart ? { restart } : {}),
      ...(goal ? { goal: true } : {}),
      substep: true,
    }
    // 每个 0.1 秒都记一帧：只保留最近 18 秒，播放时首尾相接，不会隔一帧空 0.1 秒。
    const frames = this.state.playbackFrames ??= []
    frames.push(frame)
    if (frames.length > PLAYBACK_FRAME_LIMIT_V3) frames.splice(0, frames.length - PLAYBACK_FRAME_LIMIT_V3)
    this.state.ballMotion = motion
  }

  private frameMotion(from: MatchPlaybackPose, to: MatchPlaybackPose, action: MatchActionState): BallMotion | undefined {
    const moved = distance(from.ball, to.ball)
    if (action.flight && this.state.clock <= action.flight.endsAt + 1e-6) {
      return {
        step: action.id,
        kind: action.flight.kind,
        from: { x: from.ball.x, y: from.ball.y },
        to: { x: to.ball.x, y: to.ball.y },
      }
    }
    if (to.ball.ownerId && to.ball.ownerId === from.ball.ownerId) {
      return { step: action.id, kind: 'dribble', from: { x: from.ball.x, y: from.ball.y }, to: { x: to.ball.x, y: to.ball.y } }
    }
    if (moved > 0.02 || from.ball.ownerId !== to.ball.ownerId) {
      return { step: action.id, kind: 'loose', from: { x: from.ball.x, y: from.ball.y }, to: { x: to.ball.x, y: to.ball.y } }
    }
    return undefined
  }

  private checkPeriodContinuous(): boolean {
    if (this.state.finished) return true
    const halfLength = this.durationSeconds / 2
    if (this.state.half === 1 && this.state.clock >= halfLength - 1e-6) {
      this.state.clock = halfLength
      this.state.tick = Math.round(halfLength * 10)
      this.state.half = 2
      this.state.action = null
      this.resetKickoffPositions('away')
      this.log('half', 'none', '上半场结束，双方交换半场。', {})
      return true
    }
    if (this.state.half === 2 && this.state.clock >= this.durationSeconds - 1e-6) {
      if (needsShootout(this.knockout, this.state.score, this.state.shootoutOffset)) this.startShootout()
      else this.finishMatch('全场结束。')
      return true
    }
    return false
  }

  /** v3 进球后不立刻把全队拉回中圈：等开球动作开始时再切镜头。 */
  private deferKickoff(side: MatchSide): void {
    this.state.pendingSetPiece = { type: 'kickoff', teamSide: side, x: PITCH_LENGTH / 2, y: GOAL_Y }
    this.state.phase = 'setpiece'
    this.state.possession = side
  }

  simulate(maxSteps = 20000): MatchState {
    let guard = 0
    while (!this.state.finished && guard++ < maxSteps) this.step()
    if (!this.state.finished) {
      this.finishMatch('比赛超过最大步数，按终场处理')
    }
    return this.state
  }

  snapshot() {
    return {
      clock: this.state.clock,
      half: this.state.half,
      score: { ...this.state.score },
      ball: { ...this.state.ball },
      players: this.state.teams.flatMap((team) =>
        [...team.players, ...team.bench].filter((player) => player.onPitch).map((player) => ({
          id: player.id,
          name: player.name,
          number: player.number,
          side: player.side,
          x: player.x,
          y: player.y,
          stamina: player.stamina,
          position: player.position,
          onPitch: player.onPitch,
        })),
      ),
    }
  }

  getTeam(side: MatchSide): MatchTeamState {
    return this.state.teams[side === 'home' ? 0 : 1]
  }

  private getOpponent(side: MatchSide): MatchTeamState {
    return this.getTeam(opponentSide(side))
  }

  /** 助攻：同一队最后一次成功传球发生在 3 步内，且不是射门者自己。 */
  private assistFor(shooter: MatchPlayerState): MatchPlayerState | undefined {
    const pass = this.state.recordAssist
    if (!pass || pass.side !== shooter.side || pass.id === shooter.id) return undefined
    if (this.state.step - pass.step > 3) return undefined
    return this.getTeam(shooter.side).players.find((player) => player.id === pass.id)
  }

  private statsOf(team: MatchTeamState) {
    return this.state.stats[team.side]
  }

  private playerById(id: string | null | undefined): MatchPlayerState | undefined {
    if (!id) return undefined
    for (const team of this.state.teams) {
      const found = team.players.find((player) => player.id === id) ?? team.bench.find((player) => player.id === id)
      if (found) return found
    }
    return undefined
  }

  private carrier(): MatchPlayerState | undefined {
    const player = this.playerById(this.state.ball.ownerId)
    return player?.onPitch ? player : undefined
  }

  private ratingsCache?: MatchRatings

  /** 懒创建：fromState 用 Object.create 恢复引擎，不会跑字段初始值；state 和时长也要在用到时才取。 */
  private get ratings(): MatchRatings {
    return (this.ratingsCache ??= new MatchRatings(() => this.state, () => this.durationSeconds))
  }

  private kernelCache?: SettlementKernel

  /** 结算内核：属性评分走本引擎的 ratings，技能统计和旧规则开关走本引擎的状态。懒创建理由同上。 */
  private get kernel(): SettlementKernel {
    if (!this.kernelCache) {
      const legacy = () => this.legacyRules
      this.kernelCache = new SettlementKernel(this.ratings, {
        markSkill: (player, skillId, condition, applied) => this.markSkill(player, skillId, condition, applied),
        get legacyRules() {
          return legacy()
        },
      })
    }
    return this.kernelCache
  }

  eff(player: MatchPlayerState, key: Parameters<typeof effectiveAttr>[3], ctx: MatchEventContext = {}): number {
    return this.ratings.eff(player, key, ctx)
  }

  private traitConditionMet(player: MatchPlayerState, when: TraitCondition, ctx: MatchEventContext = {}): boolean {
    return this.ratings.traitConditionMet(player, when, ctx)
  }

  /**
   * 专属特性的概率判定。按“这一步 + 这名球员 + 用途”派生，不消耗比赛主随机流：
   * 同一步里多次读取结果一致，读档后也一样，比赛仍然可复现。
   */
  private traitRoll(player: MatchPlayerState, purpose: string, chance: number): boolean {
    return this.ratings.traitRoll(player, purpose, chance)
  }

  private shotScopeMatches(scope: ShotScope, chance: ShotChanceDetail, inBoxShot: boolean, opts: { header: boolean; penalty: boolean; freeKick: boolean }): boolean {
    return this.kernel.shotScopeMatches(scope, chance, inBoxShot, opts)
  }

  private passTraitDelta(carrier: MatchPlayerState, interceptor: MatchPlayerState | null, type: ActionChoice['type'], pressure: number, dist = 0, freeKick = false): number {
    return this.kernel.passTraitDelta(carrier, interceptor, type, pressure, dist, freeKick)
  }

  private staminaFactor(player: MatchPlayerState): number {
    const trait = TRAITS[player.traitId as BaseTraitId]
    return trait?.effect === 'stamina' ? 1 - trait.value / 100 : 1
  }

  private openPlay(): MatchLogEntry | null {
    const carrier = this.carrier()
    if (!carrier) {
      // 球没人控制：两队最近的球员真的跑过去抢，而不是把球瞬移到某个人脚下。
      return this.chaseLooseBall()
    }
    const team = this.getTeam(carrier.side)
    const opp = this.getOpponent(carrier.side)
    this.state.possession = carrier.side
    const decision = this.chooseAction(team, opp, carrier)
    const timing = this.computeTiming(team, opp, carrier, decision.choice)
    if (this.legacyRules) {
      this.moveAll(team, opp, carrier, decision.choice, timing.total)
    } else if (decision.choice.kind === 'shoot') {
      // 射门只给防守方准备时间；球飞行时间不能用来先贴住射手。
      this.moveAll(team, opp, carrier, decision.choice, timing.prep)
    } else if (decision.choice.kind === 'dribble') {
      // 持球者和防守者同时移动，解决“防守者先追静止持球者”的时序优势。
      this.moveAll(team, opp, carrier, decision.choice, timing.total)
    } else {
      this.moveAll(team, opp, carrier, decision.choice, timing.total)
    }
    this.state.ball.justReceived = false
    const foul = this.legacyRules ? null : this.maybeTacticalFoul(opp, carrier)
    const entry = foul ?? this.resolveChoice(team, opp, carrier, decision.choice, timing.total)
    if (entry?.reason && decision.missed > 0 && (decision.choice.kind === 'pass' || decision.choice.kind === 'dribble')) {
      this.addFailure(carrier, 'unrecognized', `${carrier.name} 没有识别到更向前的线路`)
    }
    if (entry?.reason && decision.chosenQ < decision.bestQ - 0.05 && decision.choice.kind !== 'clear') {
      this.addFailure(carrier, 'misjudged', `${carrier.name} 在多个选择中选了一个风险收益更差的动作`)
    }
    this.advanceClock(timing.total)
    this.addPossessionTime(carrier.side, timing.total)
    this.advancePlayerMinutes(timing.total)
    return entry
  }

  private chooseAction(team: MatchTeamState, opp: MatchTeamState, carrier: MatchPlayerState): DecisionResult {
    const candidates: ActionChoice[] = []
    let missed = 0
    let recognized = 0
    const dir = dirOf(carrier.side)
    const carrierGoalDistance = distance(carrier, { x: goalXOf(carrier.side), y: GOAL_Y })
    const nearestOpp = this.nearestOpponent(opp, carrier)
    const pressure = nearestOpp ? Math.max(0, 9 - distance(nearestOpp, carrier)) / 9 : 0
    const teammates = team.players.filter((player) => player.onPitch && player.id !== carrier.id)

    const passChoices: ActionChoice[] = []
    for (const receiver of teammates) {
      const receiverDist = distance(carrier, receiver)
      const forward = (receiver.x - carrier.x) * dir
      const receiverInBox = inBox(carrier.side, receiver)
      const carrierWide = wideZone(carrier)
      let type: ActionChoice['type'] = 'short'
      if (carrierWide && receiverInBox && receiverDist > 17) type = 'cross'
      else if (forward > 8 && receiverDist > 13) type = 'through'
      else if (receiverDist > 30) type = 'long'
      const intended = this.estimatedReceptionPoint(carrier, receiver, type)
      const lineRisk = this.countLineRisk(opp, carrier, intended)
      const safe = forward <= 4 || (type === 'short' && lineRisk <= 1)
      const vision = this.eff(carrier, 'vision', { passing: true, finalThird: progressOf(carrier.side, carrier.x) > 0.65 })
      const difficulty = Math.max(0, forward) * 0.32 + lineRisk * 5 + (type === 'through' ? 4 : 0) + (receiverDist > 30 ? 5 : 0)
      const recognitionScore = vision * 0.7 + this.eff(carrier, 'teamwork') * 0.1 + 24 - difficulty
      const canSee = safe || recognitionScore > 30
      if (!canSee) {
        if (type === 'through' || (type === 'long' && forward > 6) || type === 'cross') missed++
        continue
      }
      recognized++
      const model = this.passModel(carrier, receiver, type, opp, carrier, intended, false)
      const successValue = this.passValue(carrier, receiver, type)
      const failureValue = -Math.max(0.02, 0.11 - progressOf(carrier.side, receiver.x) * 0.09)
      let tactical = 0
      if (team.tactics.attack === 'wing' && (receiver.y < 17 || receiver.y > 47)) tactical += 0.018
      if (team.tactics.attack === 'middle' && receiver.y > 20 && receiver.y < 44) tactical += 0.014
      if (team.tactics.passing === 'short' && type === 'short') tactical += 0.014
      if (team.tactics.passing === 'direct' && (type === 'long' || type === 'through')) tactical += 0.02
      if (team.tactics.tempo === 'fast' && (type === 'through' || forward > 8)) tactical += 0.008
      if (carrier.role === 'cm_organizer' && type !== 'cross') tactical += 0.008
      if (carrier.role === 'st_target' && receiverInBox) tactical += 0.012
      if (receiver.role === 'st_runner' && type === 'through') tactical += 0.018
      const time = type === 'short' ? 4 : 6
      passChoices.push({
        kind: 'pass',
        type,
        targetId: receiver.id,
        point: intended,
        label: `${type === 'cross' ? '传中' : type === 'through' ? '直塞' : type === 'long' ? '长传' : '短传'} → ${receiver.name}`,
        estimatedP: model.p,
        successValue,
        failureValue,
        estimatedTime: time,
      })
      const q =
        model.p * successValue +
        (1 - model.p) * failureValue -
        time * 0.0012 -
        0.3 * 0.0005 +
        tactical
      ;(passChoices[passChoices.length - 1] as ActionChoice & { q?: number }).q = q
    }

    for (const choice of passChoices) candidates.push(choice)

    if (carrier.position !== 'GK') for (const [dx, dy, label] of [
      [1, 0, '向前突破'],
      [0.25, 1, '向右侧突破'],
      [0.25, -1, '向左侧突破'],
      [-0.6, 0, '回撤护球'],
    ] as [number, number, string][]) {
      const point = {
        x: clamp(carrier.x + dir * dx * (7 + this.eff(carrier, 'dribbling') / 18), 2, PITCH_LENGTH - 2),
        y: clamp(carrier.y + dy * 8, 2, PITCH_WIDTH - 2),
      }
      if (distance(point, carrier) < 2) continue
      const defender = this.nearestOpponent(opp, carrier)
      // 无人贴身时推进比回传更合理；接近防守者时仍按对抗模型评估。
      const p = !defender || distance(defender, carrier) > 12 ? 0.96 : this.dribbleModel(carrier, defender, false).p
      const progress = progressOf(carrier.side, point.x)
      const carrierProgress = progressOf(carrier.side, carrier.x)
      const successValue = 0.005 + Math.max(0, progress - carrierProgress) * 0.22 + (inBox(carrier.side, point) ? 0.07 : 0)
      const failureValue = -Math.max(0.03, 0.1 - progress * 0.08)
      let tactical = 0
      if (team.tactics.tempo === 'fast' && dx > 0.5) tactical += 0.01
      if (team.tactics.attack === 'wing' && wideZone(carrier)) tactical += 0.012
      const choice: ActionChoice = {
        kind: 'dribble',
        start: { x: carrier.x, y: carrier.y },
        point,
        label,
        estimatedP: p,
        successValue,
        failureValue,
        estimatedTime: 6,
      }
      choice.q = p * successValue + (1 - p) * failureValue - 6 * 0.0012 - 0.3 * 0.0005 + tactical
      candidates.push(choice)
    }

    const shootRange = carrier.skills.includes('lg_super_long_shot') ? (carrier.skillTiers?.lg_super_long_shot === 'rainbow' ? 70 : 66) : 56
    if (carrier.position !== 'GK' && carrierGoalDistance <= shootRange && Math.abs(carrier.y - GOAL_Y) < 36) {
      const goal = { x: goalXOf(carrier.side), y: GOAL_Y }
      const model = this.shotModel(carrier, team, opp, { point: carrier, header: false, penalty: false, freeKick: false })
      const p = model.pGoal
      const tactical = carrier.role === 'st_finisher' ? 0.02 : 0
      const opportunist = carrier.skills.includes('lg_opportunist') ? (carrier.skillTiers?.lg_opportunist === 'rainbow' ? 1.5 : 1.35) : 1
      const chanceValue = this.shotChanceValue(model.chance.type) * opportunist
      const choice: ActionChoice = {
        kind: 'shoot',
        point: goal,
        label: '射门',
        estimatedP: p,
        successValue: 1,
        failureValue: -0.03,
        estimatedTime: 3,
        chanceType: model.chance.type,
      }
      // 远距离的低质量起脚不再和禁区里的机会等价：距离越远，越倾向再传一脚。
      let distancePenalty = Math.max(0, carrierGoalDistance - 20) * 0.002
      if (carrier.skills.includes('lg_super_long_shot')) distancePenalty *= carrier.skillTiers?.lg_super_long_shot === 'rainbow' ? 0.5 : 0.65
      choice.q = p * 1 + (1 - p) * -0.03 + chanceValue * 0.22 - distancePenalty - 3 * 0.0012 - 0.2 * 0.0005 + tactical
      candidates.push(choice)
    }

    if (progressOf(carrier.side, carrier.x) < 0.35 && pressure > 0.3) {
      const point = {
        x: clamp(carrier.x + dir * 32, 3, PITCH_LENGTH - 3),
        y: clamp(carrier.y + (carrier.y < GOAL_Y ? 6 : -6), 4, PITCH_WIDTH - 4),
      }
      candidates.push({
        kind: 'clear',
        point,
        label: '大脚解围',
        estimatedP: 0.9,
        successValue: -0.015,
        failureValue: -0.08,
        estimatedTime: 6,
      })
      ;(candidates[candidates.length - 1] as ActionChoice & { q?: number }).q = 0.9 * -0.015 + 0.1 * -0.08 - 6 * 0.0012
    }

    if (candidates.length === 0) {
      candidates.push({
        kind: 'dribble',
        point: { x: clamp(carrier.x + dir * 4, 2, PITCH_LENGTH - 2), y: carrier.y },
        label: '护球',
        estimatedP: 0.8,
        successValue: 0,
        failureValue: -0.05,
        estimatedTime: 5,
      })
      ;(candidates[candidates.length - 1] as ActionChoice & { q?: number }).q = -0.01
    }

    const decisionQuality = this.eff(carrier, 'decisions', { pressured: pressure > 0.4 })
    let sigma = 0.012 + (100 - decisionQuality) * 0.0011
    if (carrier.skills.includes('lg_calm_mind')) sigma *= carrier.skillTiers?.lg_calm_mind === 'rainbow' ? 0.69 : 0.78
    const scored = candidates.map((candidate) => {
      const q = (candidate as ActionChoice & { q?: number }).q ?? 0
      const qHat = q + this.decisionRng.range(-sigma, sigma)
      return { choice: candidate, q, qHat }
    })
    scored.sort((a, b) => b.qHat - a.qHat)
    const best = scored[0]
    const margin = 0.075
    const kept = scored.filter((item) => item.qHat >= best.qHat - margin)
    const temperature = 0.026
    const weights = kept.map((item) => Math.exp((item.qHat - best.qHat) / temperature))
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
    const probabilities: Record<string, number> = {}
    kept.forEach((item, index) => {
      probabilities[item.choice.label] = Math.round((weights[index] / totalWeight) * 1000) / 1000
    })
    const picked = kept[this.decisionRng.weighted(kept.map((_, index) => index), weights)]
    const goodShot = scored.find((item) => item.choice.kind === 'shoot' && item.choice.chanceType && ['open_goal', 'clear_chance', 'box_open'].includes(item.choice.chanceType))
    if (goodShot && picked.choice.kind !== 'shoot') {
      const stats = this.state.decisionStats
      stats.missedChances = (stats.missedChances ?? 0) + 1
      stats.missedChanceExamples ??= []
      if (stats.missedChanceExamples.length < 5) stats.missedChanceExamples.push(`${carrier.name} 在${goodShot.choice.chanceType === 'open_goal' ? '近距空门' : goodShot.choice.chanceType === 'clear_chance' ? '干净单刀' : '禁区空位'}选择${picked.choice.label}`)
    }
    this.state.decisionStats.recognized += recognized
    this.state.decisionStats.missed += missed
    this.state.decisionStats.choices[picked.choice.kind] = (this.state.decisionStats.choices[picked.choice.kind] ?? 0) + 1
    return { choice: picked.choice, probabilities, recognized, missed, chosenQ: picked.q, bestQ: best.q }
  }

  private estimatedReceptionPoint(carrier: MatchPlayerState, receiver: MatchPlayerState, type: ActionChoice['type']): { x: number; y: number } {
    const dir = dirOf(carrier.side)
    if (type === 'through') {
      return { x: clamp(receiver.x + dir * 10, 3, PITCH_LENGTH - 3), y: clamp(receiver.y + (receiver.y - GOAL_Y) * 0.08, 4, PITCH_WIDTH - 4) }
    }
    if (type === 'cross') {
      return { x: goalXOf(carrier.side) - dir * 9, y: clamp(GOAL_Y + (receiver.y - GOAL_Y) * 0.35, 20, 44) }
    }
    return { x: receiver.x, y: receiver.y }
  }

  private countLineRisk(opp: MatchTeamState, from: { x: number; y: number }, to: { x: number; y: number }): number {
    let risk = 0
    for (const defender of opp.players) {
      if (!defender.onPitch) continue
      if (distanceToSegment(defender, from, to) < 3.6) risk++
    }
    return risk
  }

  private computeTiming(team: MatchTeamState, opp: MatchTeamState, carrier: MatchPlayerState, choice: ActionChoice): { prep: number; execution: number; total: number } {
    const basePrep = choice.kind === 'pass' ? (choice.type === 'short' ? 2 : 2) : choice.kind === 'dribble' ? 1 : choice.kind === 'shoot' ? 1 : 2
    const execution = choice.kind === 'pass' ? (choice.type === 'short' ? 2 : 4) : choice.kind === 'dribble' ? 5 : choice.kind === 'shoot' ? 2 : 4
    const justReceived = this.state.ball.justReceived
    const firstTouch = this.eff(carrier, 'firstTouch')
    const receiveAdjust = justReceived ? 0.5 * (1 - firstTouch / 100) : 0
    const tempo = TEMPO_MULT[team.tactics.tempo]
    let reduction = 0
    if (justReceived && choice.kind === 'pass' && carrier.skills.includes('one_touch')) {
      const pressure = this.nearestOpponent(opp, carrier)
      const lowPressure = !pressure || distance(pressure, carrier) > 8
      if (lowPressure) {
        reduction = skillTierMultiplier(carrier, 'one_touch')
        this.markSkill(carrier, 'one_touch', true, true)
      } else {
        this.markSkill(carrier, 'one_touch', false, false)
      }
    }
    // 增加完整比赛中的触球回合，保持一脚出球技能原有的时间收益。
    const pace = this.legacyRules ? 1 : 0.74
    const prep = Math.max(0.1, (basePrep + receiveAdjust) * tempo * pace - reduction)
    return { prep, execution: execution * pace, total: prep + execution * pace }
  }

  private moveAll(team: MatchTeamState, opp: MatchTeamState, carrier: MatchPlayerState, choice: ActionChoice, requestedTime: number): void {
    // 终场前最后一步时钟会被截断：跑动时间跟着截断，别让人一步滑出十几米。
    const time = Math.max(0, Math.min(requestedTime, this.durationSeconds - this.state.clock))
    const attacking = carrier.side
    const presser = this.pickPresser(opp, carrier)
    const marking = this.buildMarking(opp, team)
    const targets = new Map<string, { x: number; y: number }>()
    for (const player of [...team.players, ...opp.players]) {
      if (!player.onPitch) continue
      const ownTeam = player.side === team.side ? team : opp
      const otherTeam = player.side === team.side ? opp : team
      targets.set(player.id, this.desiredTarget(player, attacking === player.side, ownTeam, otherTeam, carrier, choice, presser, marking))
    }
    for (const player of [...team.players, ...opp.players]) {
      if (!player.onPitch) continue
      const target = targets.get(player.id)
      if (!target) continue
      const ratio = player.stamina / Math.max(1, player.maxStamina)
      const speed = this.eff(player, 'speed')
      const accel = this.eff(player, 'acceleration', { wide: wideZone(player) })
      // 和展示层的物理上限对齐（5.4–8.6 m/s）：引擎里一脚长传不该让球员
      // 以 12 m/s 滑过去，否则动画层只能靠瞬移追。速度决定续航，爆发补一点启动。
      let maxSpeed = 5.4 + 3.2 * (speed / 100) + 0.3 * (accel / 100)
      if (player.role === 'st_runner' || player.role === 'w_winger') maxSpeed += 0.3
      const moveCap = maxSpeed * time * (0.75 + 0.25 * ratio)
      const dx = target.x - player.x
      const dy = target.y - player.y
      const dist = Math.hypot(dx, dy)
      const move = Math.min(dist, Math.max(0, moveCap))
      if (move > 0.05) {
        player.x = clamp(player.x + (dx / dist) * move, 2, PITCH_LENGTH - 2)
        player.y = clamp(player.y + (dy / dist) * move, 2, PITCH_WIDTH - 2)
        player.stats.distance += move
        this.state.stats[player.side].distance += move
      }
      const endurance = this.eff(player, 'endurance')
      const enduranceFactor = 0.7 + endurance / 180
      const pressIntensity = 1 + (player.side === opp.side ? PRESS_LEVEL[opp.tactics.press] * 0.08 : 0) + (player.role === 'cm_destroyer' ? 0.06 : 0)
      let drain = (move * 0.028 + 0.018) * pressIntensity * this.staminaFactor(player) / enduranceFactor
      if (!this.legacyRules) drain *= 0.77 // 更密集的动作不应使终场体力按步数额外翻倍。
      if (player.skills.includes('iron_lung')) drain *= 1 - (0.05 + (skillTierMultiplier(player, 'iron_lung') - 1) * 0.25)
      if (player.position === 'GK') drain *= 0.5
      if (player.side === opp.side && presser === player.id) drain *= 1.12
      const staminaTrait = STAR_TRAITS[player.traitId]
      if (staminaTrait?.kind === 'stamina' && this.traitConditionMet(player, staminaTrait.when)) drain *= 1 - staminaTrait.drain / 100
      player.stamina = Math.max(0, player.stamina - drain)
      if (staminaTrait?.kind === 'secondWind' && !player.traitUsed && player.stamina / Math.max(1, player.maxStamina) < 0.6) {
        player.traitUsed = true
        player.stamina = Math.min(player.maxStamina, player.stamina + player.maxStamina * staminaTrait.stamina / 100)
      }
      if (move < 0.8 && player.stamina < player.maxStamina) player.stamina = Math.min(player.maxStamina, player.stamina + 0.02)
      player.stats.staminaLeft = Math.round((player.stamina / player.maxStamina) * 100)
      if (player.skills.includes('iron_lung')) {
        const stat = this.state.skillStats.find((entry) => entry.playerId === player.id && entry.skillId === 'iron_lung' && entry.side === player.side)
        if (stat && stat.conditions === 0) this.markSkill(player, 'iron_lung', true, true)
      }
    }
  }

  /**
   * 反引力式站位修正：两名最近的队友离目标点太近时把人推开，
   * 避免整条线挤成一团。对应 GFootball 的“队友排斥 0.4”。
   */
  private spacingAdjust(player: MatchPlayerState, target: { x: number; y: number }, team: MatchTeamState): { x: number; y: number } {
    let x = target.x
    let y = target.y
    const mates = team.players
      .filter((mate) => mate.id !== player.id && mate.onPitch)
      .map((mate) => ({ mate, distance: Math.hypot(mate.x - x, mate.y - y) }))
      .filter((item) => item.distance < 8)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 2)
    for (const { mate, distance } of mates) {
      const push = (8 - distance) * 0.45
      const dx = x - mate.x
      const dy = y - mate.y
      const length = Math.hypot(dx, dy) || 1
      x += (dx / length) * push
      y += (dy / length) * push
    }
    return { x, y }
  }

  private desiredTarget(
    player: MatchPlayerState,
    attacking: boolean,
    team: MatchTeamState,
    opp: MatchTeamState,
    carrier: MatchPlayerState,
    choice: ActionChoice,
    presser: string | null,
    marking: Map<string, string>,
  ): { x: number; y: number } {
    const dir = dirOf(player.side)
    const formation = FORMATIONS[team.formationId]
    const slot = formation.slots.find((item) => item.id === player.slotId)
    const baseX = slot ? slot.x * PITCH_LENGTH : 35
    const baseY = slot ? slot.y * PITCH_WIDTH : GOAL_Y
    const anchorX = player.side === 'home' ? baseX : PITCH_LENGTH - baseX
    const anchorY = player.side === 'home' ? baseY : PITCH_WIDTH - baseY
    const ball = this.state.ball
    const progress = progressOf(player.side, ball.x)
    const role = ROLES[player.role]
    const mentalityShift = team.mentality === 'attack' ? 5 : team.mentality === 'defend' ? -5 : 0

    if (player.position === 'GK') {
      const gx = ownGoalXOf(player.side)
      const goal = { x: goalXOf(player.side), y: GOAL_Y }
      const distToOwnGoal = distance(player, { x: gx, y: GOAL_Y })
      if (!attacking && (player.role === 'gk_sweeper' || player.skills.includes('gk_sweeper')) && progressOf(player.side, ball.x) < 0.45 && distToOwnGoal < 26) {
        const gx = ownGoalXOf(player.side)
        const low = gx + dir * 3
        const high = gx + dir * (24 + (player.skills.includes('gk_sweeper') ? 24 * (skillTierMultiplier(player, 'gk_sweeper') - 1) : 0))
        const targetX = clamp(ball.x - dir * 4, Math.min(low, high), Math.max(low, high))
        return { x: targetX, y: clamp(ball.y, 20, 44) }
      }
      return { x: clamp(gx + dir * (1.5 + progress * 2), 1.5, PITCH_LENGTH - 1.5), y: clamp(GOAL_Y + (ball.y - GOAL_Y) * 0.3, 25, 39) }
    }

    if (!this.legacyRules && player.id === carrier.id) {
      if (choice.kind === 'dribble') return { x: choice.point.x, y: choice.point.y }
      return { x: player.x, y: player.y }
    }
    if (this.legacyRules && player.id === carrier.id && choice.kind === 'dribble') {
      return { x: player.x, y: player.y }
    }

    if (!this.legacyRules && attacking && choice.kind === 'pass' && (choice.type === 'through' || choice.type === 'cross') && choice.targetId === player.id) {
      return { x: choice.point.x, y: choice.point.y }
    }

    if (attacking) {
      let x: number
      let y: number
      if (progress < 0.42) {
        // 后场组织时也要给纵深：整条线跟着球往前挪，而不是钉在原地。
        x = anchorX + dir * (3 + progress * 11)
        y = anchorY + (ball.y - anchorY) * 0.18
      } else {
        const push = 10 + progress * 20
        x = anchorX + dir * push
        y = anchorY + (ball.y - anchorY) * (0.16 + role.widthBias * 0.12)
      }
      if (player.position === 'ST' || player.position === 'W') {
        const run = role.forwardRun
        // 前锋更早开始跑：球一过中线就压向对方防线身后，而不是等球到 60% 才动。
        if (run > 0.45 && progress > 0.35) {
          x = ball.x + dir * (7 + run * 14 + this.eff(player, 'offBall') / 20)
          if (player.position === 'W') y = anchorY * 0.5 + ball.y * 0.5 + (anchorY - GOAL_Y) * 0.3
          else y = GOAL_Y + (anchorY - GOAL_Y) * 0.35
        }
      } else if (player.position === 'CM') {
        const support = role.supportBias
        // 中场不再永远躲在球后面：盒到盒/边中场在进攻时插到球前，给持球人一个向前的出口。
        const advanced = player.role === 'cm_box2box' || player.role === 'cm_organizer'
        x = advanced && progress > 0.45
          ? ball.x + dir * (4 + support * 3)
          : ball.x - dir * (3 + support * 6)
        y = ball.y * 0.45 + anchorY * 0.55 + (player.role === 'cm_destroyer' ? (GOAL_Y - ball.y) * 0.15 : 0)
      } else if (player.position === 'CB') {
        if (role.holdBack) x = player.side === 'home' ? Math.min(x, 53) : Math.max(x, 47)
        else x = player.side === 'home' ? Math.min(x, 42) : Math.max(x, 58)
        y = anchorY * 0.7 + ball.y * 0.3
      }
      if (player.position === 'CB' && role.holdBack && progress < 0.55) {
        x = player.side === 'home' ? Math.min(x, 45) : Math.max(x, 55)
      }
      const spaced = this.spacingAdjust(player, { x: x + dir * mentalityShift, y }, team)
      return { x: clamp(spaced.x, 4, PITCH_LENGTH - 4), y: clamp(spaced.y, 3, PITCH_WIDTH - 3) }
    }

    if (player.id === presser) {
      const targetX = carrier.x - dir * 1.4
      const targetY = carrier.y
      return { x: clamp(targetX, 3, PITCH_LENGTH - 3), y: clamp(targetY, 3, PITCH_WIDTH - 3) }
    }
    const lineX = LINE_X[team.tactics.line]
    const linePos = player.side === 'home' ? lineX : PITCH_LENGTH - lineX
    const defensiveAnchorX = player.side === 'home' ? Math.min(anchorX, linePos) : Math.max(anchorX, linePos)
    const pressureShift = (ball.x - defensiveAnchorX) * 0.18
    let x = defensiveAnchorX + pressureShift
    let y = anchorY + (ball.y - anchorY) * 0.36
    if (player.position === 'CB' || player.position === 'CM') {
      const markId = marking.get(player.id)
      const marked = markId ? this.playerById(markId) : undefined
      if (marked) {
        const goalSide = player.side === 'home' ? -2.2 : 2.2
        const blend = clamp(0.5 + this.eff(player, 'defPos') / 220, 0.55, 0.95)
        x = x * (1 - blend) + (marked.x + goalSide) * blend
        y = y * (1 - blend) + marked.y * blend
      }
    }
    if (progress > 0.7) x = player.side === 'home' ? Math.max(x, 10) : Math.min(x, PITCH_LENGTH - 10)
    return { x: clamp(x + dir * mentalityShift, 3, PITCH_LENGTH - 3), y: clamp(y, 3, PITCH_WIDTH - 3) }
  }

  private pickPresser(team: MatchTeamState, carrier: MatchPlayerState): string | null {
    // 中/高位压迫要从较远处主动接近持球人，而非等他进入防守三区。
    const range = PRESS_RANGE[team.tactics.press] + (team.tactics.press === 'low' ? 0 : team.tactics.press === 'mid' ? 18 : 22)
    const level = PRESS_LEVEL[team.tactics.press]
    let best: MatchPlayerState | null = null
    let bestScore = Infinity
    for (const player of team.players) {
      if (!player.onPitch || player.position === 'GK') continue
      const dist = distance(player, carrier)
      if (dist > range + 12) continue
      const score = dist - ROLES[player.role].pressBias * 4 - level * 3
      if (score < bestScore) {
        bestScore = score
        best = player
      }
    }
    if (!best) return null
    if (team.tactics.press === 'low' && distance(best, carrier) > range) return null
    return best.id
  }

  private buildMarking(team: MatchTeamState, opp: MatchTeamState): Map<string, string> {
    const map = new Map<string, string>()
    const defenders = team.players.filter((player) => player.onPitch && player.position !== 'GK')
    const attackers = opp.players
      .filter((player) => player.onPitch && player.position !== 'GK')
      .sort((a, b) => progressOf(opp.side, b.x) - progressOf(opp.side, a.x))
    const used = new Set<string>()
    for (const defender of defenders) {
      let best: MatchPlayerState | null = null
      let bestDist = Infinity
      for (const attacker of attackers) {
        if (used.has(attacker.id)) continue
        const dist = distance(defender, attacker)
        if (dist < bestDist) {
          bestDist = dist
          best = attacker
        }
      }
      if (best && bestDist < 30) {
        map.set(defender.id, best.id)
        used.add(best.id)
      }
    }
    return map
  }

  private resolveChoice(team: MatchTeamState, opp: MatchTeamState, carrier: MatchPlayerState, choice: ActionChoice, time: number): MatchLogEntry | null {
    if (choice.kind === 'pass') return this.resolvePass(team, opp, carrier, choice, time)
    if (choice.kind === 'dribble') return this.resolveDribble(team, opp, carrier, choice, time)
    if (choice.kind === 'shoot') return this.resolveShot(carrier, team, opp, { point: carrier, header: false, penalty: false, freeKick: false })
    return this.resolveClear(team, carrier, choice)
  }

  private passModel(
    carrier: MatchPlayerState,
    receiver: MatchPlayerState,
    type: ActionChoice['type'],
    opp: MatchTeamState,
    from: { x: number; y: number },
    to: { x: number; y: number },
    markSkills: boolean,
  ): PassModel {
    return this.kernel.passModel(carrier, receiver, type, opp, from, to, markSkills)
  }

  private nearestOpponent(opp: MatchTeamState, point: { x: number; y: number }): MatchPlayerState | null {
    return this.kernel.nearestOpponent(opp, point)
  }

  private passValue(carrier: MatchPlayerState, receiver: MatchPlayerState, type: ActionChoice['type']): number {
    const fromProgress = progressOf(carrier.side, carrier.x)
    const progress = progressOf(carrier.side, receiver.x)
    const advance = progress - fromProgress
    // 无压回传不能与向前接应近似等价；受到逼抢时保留回做的价值。
    const pressure = this.nearestOpponent(this.getOpponent(carrier.side), carrier)
    const escape = pressure ? clamp((12 - distance(pressure, carrier)) / 12, 0, 1) : 0
    let value = 0.005 + Math.max(0, advance) * 0.46 + Math.min(0, advance) * 0.34 * (1 - escape * 0.6)
    // 已经在对方半场还往回倒，比“后场组织”更伤：逼出向前的选择，而不是安全回传。
    if (advance < -0.02 && fromProgress > 0.45) value -= 0.025 + fromProgress * 0.06
    // 回传门将只有在被逼抢、确实没线路时才合理。
    if (receiver.position === 'GK' && escape < 0.6) value -= 0.05
    if (type === 'through') value += 0.05
    if (type === 'cross') value += 0.03
    if (inBox(carrier.side, receiver)) value += 0.1
    if (progress > 0.72) value += 0.03
    return value
  }

  private isOffside(receiver: MatchPlayerState, opp: MatchTeamState, side: MatchSide): boolean {
    const dir = dirOf(side)
    const defenders = opp.players.filter((player) => player.onPitch && player.position !== 'GK')
    if (defenders.length === 0) return false
    const line = side === 'home' ? Math.max(...defenders.map((player) => player.x)) : Math.min(...defenders.map((player) => player.x))
    const beyond = side === 'home' ? receiver.x > line + 0.6 : receiver.x < line - 0.6
    return beyond && (receiver.x - this.state.ball.x) * dir > -0.2
  }

  private resolvePass(team: MatchTeamState, opp: MatchTeamState, carrier: MatchPlayerState, choice: ActionChoice, time: number): MatchLogEntry | null {
    const receiver = this.playerById(choice.targetId ?? null)
    if (!receiver || !receiver.onPitch) return this.resolveLooseBall()
    const from = this.continuous ? (choice.start ?? { x: carrier.x, y: carrier.y }) : { x: carrier.x, y: carrier.y }
    // v3：球已经按权威轨迹飞到落点；模型必须用真实落点，而不是把球瞬移回接球人脚下。
    const to = this.continuous ? { x: this.state.ball.x, y: this.state.ball.y } : { x: receiver.x, y: receiver.y }
    const model = this.passModel(carrier, receiver, choice.type, opp, from, to, true)
    const { p, deviation, intercepted: pIntercept, out: pOut, loose: pLoose } = this.kernel.passOdds(model, choice.type, receiver, to)
    carrier.stats.passes++
    carrier.stats.touches++
    this.statsOf(team).passes++
    const interceptor = model.interceptor
    const probabilities = {
      success: round(p),
      intercepted: round(pIntercept),
      out: round(pOut),
      loose: round(Math.max(0, pLoose)),
    }
    const ratings = { a: round(model.a), d: round(model.d), c: round(model.c), p0: model.p0, deviation: round(deviation) }
    const roll = round(this.resultRng.float())
    const success = roll < p
    if (success) {
      // v3：模型说“能传到”不等于接球人真能到。球落在几米外就变成落点争抢，
      // 不把球瞬移到他脚下，也不计完成传球/助攻。
      if (this.continuous) {
        const reach = this.kernel.receptionReach(receiver, choice.type)
        if (distance(receiver, to) > reach) {
          this.state.ball = { x: to.x, y: to.y, ownerId: null, justReceived: false }
          this.state.possession = carrier.side
          return this.log('contest', carrier.side, `${receiver.name} 没能在落点接住，球权待争。`, {
            playerId: receiver.id,
            probabilities,
            ratings,
            roll,
          })
        }
      }
      this.state.recordAssist = { id: carrier.id, name: carrier.name, side: carrier.side, step: this.state.step }
      carrier.stats.passesCompleted++
      this.statsOf(team).passesCompleted++
      this.state.ball = { x: receiver.x, y: receiver.y, ownerId: receiver.id, justReceived: true }
      this.state.possession = carrier.side
      const runner = STAR_TRAITS[receiver.traitId]
      const beatsTheLine = runner?.kind === 'onside' && this.traitRoll(receiver, 'onside', runner.chance)
      if (this.offside && choice.type === 'through' && this.isOffside(receiver, opp, carrier.side) && !beatsTheLine) {
        const entry = this.log('out', carrier.side, `${receiver.name} 越位，进攻被吹停。`, {
          playerId: receiver.id,
          probabilities,
          ratings,
          roll,
          offside: true,
        })
        this.setPendingSetPiece('free_kick', opp.side, receiver.x, receiver.y, '越位')
        return entry
      }
      if (choice.type === 'cross') {
        const entry = this.log('pass', carrier.side, `${carrier.name} 传中送向禁区，${receiver.name} 争顶。`, {
          playerId: carrier.id,
          probabilities,
          ratings,
          roll,
        })
        this.resolveAerial(team, opp, { x: goalXOf(carrier.side) - dirOf(carrier.side) * 8, y: GOAL_Y }, carrier.side, true)
        return entry
      }
      if (choice.type === 'through') {
        const gk = this.teamGoalkeeper(opp)
        if (gk && gk.skills.includes('gk_sweeper') && inBox(opp.side, receiver)) {
          this.markSkill(gk, 'gk_sweeper', true, this.eff(gk, 'rushing') > 55)
        }
      }
      return this.log('pass', carrier.side, `${carrier.name} ${choice.type === 'through' ? '直塞' : choice.type === 'long' ? '长传' : '传球'}找到 ${receiver.name}。`, {
        playerId: carrier.id,
        probabilities,
        ratings,
        roll,
      })
    }
    if (interceptor) {
      interceptor.stats.interceptions++
      this.statsOf(opp).interceptions++
      this.state.ball = { x: interceptor.x, y: interceptor.y, ownerId: interceptor.id, justReceived: true }
      this.state.possession = interceptor.side
      const reason: FailureReason = deviation > 4 ? 'position_timing' : 'execution'
      this.addFailure(carrier, reason, `${carrier.name} 的传球被 ${interceptor.name} 断下`)
      const note = model.support > 0 ? '，协防压缩了线路' : ''
      return this.log('pass', carrier.side, `${carrier.name} 的传球被 ${interceptor.name} 拦截${note}。`, {
        playerId: carrier.id,
        probabilities,
        ratings,
        roll,
        reason,
      })
    }
    if (roll < p + pIntercept + pOut) {
      this.outcomeOut(carrier.side, to)
      this.addFailure(carrier, 'execution', `${carrier.name} 的传球出了边线`)
      return this.log('pass', carrier.side, `${carrier.name} 的传球出了边界。`, {
        playerId: carrier.id,
        probabilities,
        ratings,
        roll,
        reason: 'execution',
      })
    }
    this.state.ball = { x: (carrier.x + receiver.x) / 2, y: (carrier.y + receiver.y) / 2, ownerId: null, justReceived: false }
    this.state.possession = null
    const reason: FailureReason = deviation > 4 ? 'position_timing' : 'execution'
    this.addFailure(carrier, reason, `${carrier.name} 的传球没有被接应者控制`)
    return this.log('pass', carrier.side, `${carrier.name} 的传球落在无人区，双方争抢。`, {
      playerId: carrier.id,
      probabilities,
      ratings,
      roll,
      reason,
    })
  }

  private dribbleModel(carrier: MatchPlayerState, defender: MatchPlayerState, markSkills: boolean): { p: number; a: number; d: number } {
    return this.kernel.dribbleModel(carrier, defender, markSkills)
  }

  private resolveDribble(team: MatchTeamState, opp: MatchTeamState, carrier: MatchPlayerState, choice: ActionChoice, time: number): MatchLogEntry | null {
    const defender = this.nearestOpponent(opp, carrier)
    const inTackleRange = defender ? distance(defender, carrier) < 4.2 : false
    if (!defender || !inTackleRange) {
      carrier.stats.touches++
      const moved = this.legacyRules ? this.moveCarrier(carrier, choice.point, time) : choice.start ? distance(choice.start, carrier) : 0
      this.state.ball = { x: carrier.x, y: carrier.y, ownerId: carrier.id, justReceived: false }
      return this.log('dribble', carrier.side, `${carrier.name} 带球推进 ${moved.toFixed(1)} 米。`, { playerId: carrier.id, probabilities: { success: 1 } })
    }
    const model = this.dribbleModel(carrier, defender, true)
    const { tackle: tackleShare, foul: foulP, loose: looseShare } = this.kernel.dribbleOdds(model, defender, opp)
    const probabilities = {
      success: round(model.p),
      tackle: round(tackleShare),
      foul: round(foulP),
      loose: round(looseShare),
    }
    const roll = this.resultRng.float()
    if (roll < model.p) {
      carrier.stats.touches++
      const moved = this.legacyRules ? this.moveCarrier(carrier, choice.point, time) : choice.start ? distance(choice.start, carrier) : 0
      this.state.ball = { x: carrier.x, y: carrier.y, ownerId: carrier.id, justReceived: false }
      return this.log('dribble', carrier.side, `${carrier.name} 摆脱 ${defender.name}，推进 ${moved.toFixed(1)} 米。`, {
        playerId: carrier.id,
        probabilities,
        ratings: { a: round(model.a), d: round(model.d) },
        roll,
      })
    }
    if (roll < model.p + tackleShare) {
      defender.stats.tackles++
      this.statsOf(opp).tackles++
      this.state.ball = { x: defender.x, y: defender.y, ownerId: defender.id, justReceived: true }
      this.state.possession = defender.side
      this.addFailure(carrier, 'position_timing', `${carrier.name} 被 ${defender.name} 干净断球`)
      const entry = this.log('tackle', defender.side, `${defender.name} 干净地断下 ${carrier.name} 的球。`, {
        playerId: defender.id,
        probabilities,
        ratings: { a: round(model.a), d: round(model.d) },
        roll,
        reason: 'position_timing',
      })
      this.maybeInjure(carrier)
      return entry
    }
    if (roll < model.p + tackleShare + foulP) {
      this.statsOf(opp).fouls++
      const penalty = inBox(carrier.side, carrier)
      this.addFailure(carrier, 'position_timing', `${carrier.name} 被 ${defender.name} 犯规`)
      const card = this.book(opp, defender)
      this.setPendingSetPiece(penalty ? 'penalty' : 'free_kick', carrier.side, carrier.x, carrier.y, `${defender.name} 对 ${carrier.name} 犯规`)
      const entry = this.log('foul', defender.side, `${defender.name} 犯规，${penalty ? '判罚点球' : '判罚任意球'}${card === 'red' ? '；红牌罚下' : card === 'yellow' ? '；黄牌' : ''}。`, {
        playerId: defender.id,
        probabilities,
        ratings: { a: round(model.a), d: round(model.d) },
        roll,
        reason: 'position_timing',
        ...(card ? { card } : {}),
      })
      this.maybeInjure(carrier)
      return entry
    }
    this.state.ball = { x: (carrier.x + defender.x) / 2, y: (carrier.y + defender.y) / 2, ownerId: null, justReceived: false }
    this.state.possession = null
    this.addFailure(carrier, 'execution', `${carrier.name} 与 ${defender.name} 对抗后球权未定`)
    return this.log('dribble', carrier.side, `${carrier.name} 与 ${defender.name} 对抗后，球滚向一旁。`, {
      playerId: carrier.id,
      probabilities,
      ratings: { a: round(model.a), d: round(model.d) },
      roll,
      reason: 'execution',
    })
  }

  private moveCarrier(carrier: MatchPlayerState, point: { x: number; y: number }, time: number): number {
    const ratio = carrier.stamina / Math.max(1, carrier.maxStamina)
    const speed = this.eff(carrier, 'speed')
    const accel = this.eff(carrier, 'acceleration', { wide: wideZone(carrier) })
    const maxMove = (0.06 * speed + 0.05 * accel + 1.2) * time * (0.75 + 0.25 * ratio)
    const dx = point.x - carrier.x
    const dy = point.y - carrier.y
    const dist = Math.hypot(dx, dy)
    const move = Math.min(dist, maxMove)
    if (move > 0.05) {
      carrier.x = clamp(carrier.x + (dx / dist) * move, 2, PITCH_LENGTH - 2)
      carrier.y = clamp(carrier.y + (dy / dist) * move, 2, PITCH_WIDTH - 2)
      carrier.stats.distance += move
      this.state.stats[carrier.side].distance += move
    }
    this.state.ball = { x: carrier.x, y: carrier.y, ownerId: carrier.id, justReceived: false }
    return move
  }

  private resolveClear(team: MatchTeamState, carrier: MatchPlayerState, choice: ActionChoice): MatchLogEntry | null {
    const point = choice.point
    this.state.ball = { x: point.x, y: point.y, ownerId: null, justReceived: false }
    this.state.possession = null
    carrier.stats.touches++
    return this.log('pass', carrier.side, `${carrier.name} 大脚解围，球飞向中场。`, { playerId: carrier.id, probabilities: { success: 0.9, loose: 0.1 } })
  }

  private shotChanceValue(type: ShotChanceDetail['type']): number {
    return this.kernel.shotChanceValue(type)
  }

  private classifyShotChance(
    shooter: MatchPlayerState,
    opp: MatchTeamState,
    point: { x: number; y: number },
    opts: { header: boolean; penalty: boolean; freeKick: boolean },
  ): ShotChanceDetail {
    return this.kernel.classifyShotChance(shooter, opp, point, opts)
  }

  private shotModel(
    shooter: MatchPlayerState,
    team: MatchTeamState,
    opp: MatchTeamState,
    opts: { point: { x: number; y: number }; header: boolean; penalty: boolean; freeKick: boolean; foot?: 'left' | 'right' },
    markSkills = false,
  ): ShotModel {
    return this.kernel.shotModel(shooter, team, opp, opts, markSkills)
  }

  private findBlockers(opp: MatchTeamState, shooter: { x: number; y: number }, target: { x: number; y: number }, includeGk = false): number[] {
    return this.kernel.findBlockers(opp, shooter, target, includeGk)
  }

  private resolveShot(
    shooter: MatchPlayerState,
    team: MatchTeamState,
    opp: MatchTeamState,
    opts: { point: { x: number; y: number }; header: boolean; penalty: boolean; freeKick: boolean; target?: GoalDetail['target'] },
  ): MatchLogEntry {
    const origin = { x: opts.point.x, y: opts.point.y }
    const detailRng = derivedRng(this.state.seed, 'shot-detail', this.state.step, this.state.log.length)
    const { foot, target, technique, model, onTarget, goalGiven, raw } = this.kernel.shotSettlement(shooter, team, opp, { ...opts, point: origin }, detailRng)
    const probs = {
      block: round(raw.block),
      off: round(raw.off),
      save: round(raw.save),
      goal: round(raw.goal),
    }
    const shotRatings = { block: round(model.block), onTarget: round(onTarget), goalGiven: round(goalGiven), finish: round(model.finishScore), gk: round(model.gkScore) }
    const shotChance: ShotChanceDetail | undefined = this.legacyRules ? undefined : { ...model.chance, base: round(model.chance.base), floor: round(model.chance.floor), ceiling: round(model.chance.ceiling), goalBase: round(model.chance.goalBase), distance: round(model.chance.distance), angle: round(model.chance.angle), pressure: round(model.chance.pressure) }
    const roll = this.resultRng.float()
    const shotAim = shotAimPoint(shooter.side, target)
    shooter.stats.shots++
    shooter.stats.touches++
    this.statsOf(team).shots++
    this.statsOf(team).xg += raw.goal
    if (roll < raw.goal) {
      this.state.score[shooter.side]++
      this.state.lastGoalBy = shooter.side
      shooter.stats.goals++
      const assister = this.assistFor(shooter)
      if (assister) assister.stats.assists = (assister.stats.assists ?? 0) + 1
      const scorerTrait = STAR_TRAITS[shooter.traitId]
      if (scorerTrait?.kind === 'goalRecover') shooter.stamina = Math.min(shooter.maxStamina, shooter.stamina + shooter.maxStamina * scorerTrait.stamina / 100)
      this.statsOf(team).goals++
      this.statsOf(team).shotsOnTarget++
      this.addPossessionTime(shooter.side, 0)
      const goal: GoalDetail = {
        playerId: shooter.id, playerName: shooter.name, side: shooter.side,
        clock: Math.floor(this.state.clock * 10) / 10, half: this.state.half,
        origin, distance: Math.round(model.distance * 10) / 10,
        bodyPart: foot ?? 'head', technique,
        situation: opts.penalty ? 'penalty' : opts.freeKick ? 'free_kick' : 'open', chance: model.chance.type, target,
        ...(assister ? { assistId: assister.id, assistName: assister.name } : {}),
      }
      const action = technique === 'header' ? '头球攻门' : `${foot === 'left' ? '左脚' : '右脚'}${technique === 'power' ? '抽射' : '推射'}`
      const situation = opts.penalty ? '主罚点球，' : opts.freeKick ? '主罚任意球，' : ''
      this.log('goal', shooter.side, `${shooter.name}${situation}在${shotPositionText(goal)}${action}，球飞入球门${shotTargetText(target)}！${this.state.score.home} : ${this.state.score.away}`, {
        playerId: shooter.id, goal, shotAim: shotAimPoint(shooter.side, target),
        probabilities: probs,
        ratings: shotRatings,
        shotChance,
        roll,
      })
      if (this.continuous) this.deferKickoff(opponentSide(shooter.side))
      else this.resetKickoffPositions(opponentSide(shooter.side))
      return this.state.log[this.state.log.length - 1]
    }
    if (roll < raw.goal + raw.save) {
      this.statsOf(team).shotsOnTarget++
      const gk = this.teamGoalkeeper(opp)
      if (gk && opts.penalty) {
        this.state.ball = { x: gk.x, y: gk.y, ownerId: gk.id, justReceived: true }
        this.state.possession = gk.side
        this.addFailure(shooter, 'execution', `${shooter.name} 的点球被 ${gk.name} 扑出`)
        return this.log('save', gk.side, `${gk.name} 扑出 ${shooter.name} 的点球，点球结束。`, {
          playerId: gk.id,
          probabilities: probs,
          ratings: shotRatings,
          shotChance,
          roll,
          reason: 'execution',
          shotAim,
        })
      }
      if (gk) {
        const catchP = this.kernel.keeperCatchChance(gk, shooter)
        const catchRoll = this.resultRng.float()
        if (catchRoll < catchP) {
          this.state.ball = { x: gk.x, y: gk.y, ownerId: gk.id, justReceived: true }
          this.state.possession = gk.side
          this.addFailure(shooter, 'execution', `${shooter.name} 的射门被 ${gk.name} 扑住`)
          return this.log('save', gk.side, `${gk.name} 把 ${shooter.name} 的射门稳稳抱住。`, {
            playerId: gk.id,
            probabilities: probs,
            ratings: shotRatings,
            shotChance,
            roll,
            reason: 'execution',
            shotAim,
          })
        }
        const nearGoal = distance(shooter, { x: goalXOf(shooter.side), y: GOAL_Y }) < 18
        if (nearGoal) {
          this.awardCorner(shooter.side, shooter.x, shooter.y)
          this.addFailure(shooter, 'execution', `${shooter.name} 的射门被 ${gk.name} 扑出底线`)
          return this.log('save', gk.side, `${gk.name} 扑出 ${shooter.name} 的射门，球出底线，角球。`, {
            playerId: gk.id,
            probabilities: probs,
            ratings: shotRatings,
            shotChance,
            roll,
            reason: 'execution',
            shotAim,
          })
        }
        this.state.ball = { x: clamp(gk.x + dirOf(gk.side) * 2, 1, PITCH_LENGTH - 1), y: gk.y, ownerId: null, justReceived: false }
        this.state.possession = null
        this.addFailure(shooter, 'execution', `${shooter.name} 的射门被 ${gk.name} 扑出`)
        return this.log('save', gk.side, `${gk.name} 扑出 ${shooter.name} 的射门，但没有抱稳，禁区内争抢。`, {
          playerId: gk.id,
          probabilities: probs,
          ratings: shotRatings,
          shotChance,
          roll,
          reason: 'execution',
          shotAim,
        })
      }
    }
    if (roll < raw.goal + raw.save + raw.block) {
      const nearGoal = distance(shooter, { x: goalXOf(shooter.side), y: GOAL_Y }) < 18
      if (nearGoal) {
        this.awardCorner(shooter.side, shooter.x, shooter.y)
        this.addFailure(shooter, 'position_timing', `${shooter.name} 的射门被封堵出底线`)
        return this.log('block', opp.side, `${shooter.name} 的射门被封堵出底线，角球。`, {
          playerId: shooter.id,
          probabilities: probs,
          ratings: shotRatings,
          shotChance,
          roll,
          reason: 'position_timing',
        })
      }
      this.state.ball = {
        x: clamp(shooter.x + dirOf(shooter.side) * 4, 2, PITCH_LENGTH - 2),
        y: clamp(shooter.y + (shooter.y - GOAL_Y) * 0.2, 2, PITCH_WIDTH - 2),
        ownerId: null,
        justReceived: false,
      }
      this.state.possession = null
      this.addFailure(shooter, 'position_timing', `${shooter.name} 的射门被防守者封堵`)
      return this.log('block', opp.side, `${shooter.name} 的射门被封堵，球落在禁区外。`, {
        playerId: shooter.id,
        probabilities: probs,
        ratings: shotRatings,
        shotChance,
        roll,
        reason: 'position_timing',
        shotAim,
      })
    }
    this.state.ball = { x: clamp(goalXOf(shooter.side), 2, PITCH_LENGTH - 2), y: shooter.y, ownerId: null, justReceived: false }
    const defending = opp.side
    this.setPendingSetPiece('goal_kick', defending, ownGoalXOf(defending) + dirOf(defending) * 6, GOAL_Y, '射门偏出')
    this.addFailure(shooter, 'execution', `${shooter.name} 的射门偏出`)
    return this.log('miss', shooter.side, `${shooter.name} 的射门偏出球门。`, {
      playerId: shooter.id,
      probabilities: probs,
      ratings: shotRatings,
      shotChance,
      roll,
      reason: 'execution',
      shotAim: { x: shotAim.x, y: clamp(shotAim.y + (shotAim.y - GOAL_Y) * 0.6, 1, PITCH_WIDTH - 1) },
    })
  }

  private teamGoalkeeper(team: MatchTeamState): MatchPlayerState | null {
    return this.kernel.teamGoalkeeper(team)
  }

  private resolveAerial(team: MatchTeamState, opp: MatchTeamState, point: { x: number; y: number }, attackingSide: MatchSide, headerShot: boolean): MatchLogEntry | null {
    const attacking = this.getTeam(attackingSide)
    const defending = this.getOpponent(attackingSide)
    const contestants = this.kernel.aerialContestants(attacking, defending, point, attackingSide, () => this.resultRng.float())
    if (contestants.length === 0) {
      this.state.ball = { x: point.x, y: point.y, ownerId: null, justReceived: false }
      return this.log('contest', attackingSide, '禁区里没有人碰到球，球落在草地上。', {})
    }
    const total = totalWeight(contestants)
    const roll = this.resultRng.float() * total
    const winner = pickByWeight(contestants, roll)
    const probabilities: Record<string, number> = {}
    for (const item of contestants.slice(0, 4)) probabilities[item.player.name] = round(item.weight / total)
    if (winner.player.position === 'GK' || winner.side !== attackingSide) {
      this.state.ball = { x: winner.player.x, y: winner.player.y, ownerId: winner.player.id, justReceived: true }
      this.state.possession = winner.side
      return this.log('contest', winner.side, `${winner.player.name} 抢到第一点，把球顶出危险区域。`, {
        playerId: winner.player.id,
        probabilities,
        roll: round(roll / total),
      })
    }
    if (headerShot) {
      this.state.ball = { x: winner.player.x, y: winner.player.y, ownerId: winner.player.id, justReceived: true }
      this.log('contest', attackingSide, `${winner.player.name} 抢到落点，直接头球攻门！`, {
        playerId: winner.player.id,
        probabilities,
        roll: round(roll / total),
      })
      return this.resolveShot(winner.player, attacking, defending, { point: winner.player, header: true, penalty: false, freeKick: false })
    }
    this.state.ball = { x: winner.player.x, y: winner.player.y, ownerId: winner.player.id, justReceived: true }
    this.state.possession = attackingSide
    return this.log('contest', attackingSide, `${winner.player.name} 在争顶中胜出，控制住球。`, {
      playerId: winner.player.id,
      probabilities,
      roll: round(roll / total),
    })
  }

  private reachOf(player: MatchPlayerState): number {
    return this.kernel.reachOf(player)
  }

  /** 没有持球人时，按属性速度把最近的球员往球的位置带一段。 */
  private moveRunnerToward(player: MatchPlayerState, x: number, y: number, time: number): number {
    const ratio = player.stamina / Math.max(1, player.maxStamina)
    const speed = this.eff(player, 'speed')
    const accel = this.eff(player, 'acceleration')
    let maxSpeed = 5.4 + 3.2 * (speed / 100) + 0.3 * (accel / 100)
    if (player.role === 'st_runner' || player.role === 'w_winger') maxSpeed += 0.3
    const cap = maxSpeed * time * (0.75 + 0.25 * ratio)
    const dx = x - player.x
    const dy = y - player.y
    const dist = Math.hypot(dx, dy)
    const move = Math.min(dist, Math.max(0, cap))
    if (move <= 0.05) return 0
    player.x = clamp(player.x + (dx / dist) * move, 2, PITCH_LENGTH - 2)
    player.y = clamp(player.y + (dy / dist) * move, 2, PITCH_WIDTH - 2)
    player.stats.distance += move
    this.state.stats[player.side].distance += move
    player.stamina = Math.max(0, player.stamina - move * 0.03 * this.staminaFactor(player))
    player.stats.staminaLeft = Math.round(player.stamina / Math.max(1, player.maxStamina) * 100)
    return move
  }

  /**
   * 二点球/落点争抢：两队各派最近的两个人冲向球，跑一段真实时间后按距离判定球权。
   * 球留在落点不动，谁先到谁拿——不再出现“球瞬移到最近的球员脚下”。
   */
  private chaseLooseBall(): MatchLogEntry | null {
    const ball = this.state.ball
    const chasers: { player: MatchPlayerState; dist: number }[] = []
    for (const team of this.state.teams) {
      const candidates = team.players
        .filter((player) => player.onPitch && (player.position !== 'GK' || inBox(player.side, ball)))
        .map((player) => ({ player, dist: distance(player, ball) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 2)
      chasers.push(...candidates)
    }
    if (!chasers.length) {
      // 理论上不会发生（门将也可以捡球），留个兜底避免卡死。
      this.state.ball = { ...this.state.ball, ownerId: null, justReceived: false }
      this.advanceClock(2)
      return this.log('info', 'none', '球停在无人区，比赛继续。', {})
    }
    chasers.sort((a, b) => a.dist - b.dist)
    const closest = chasers[0]
    const pace = Math.max(3.4, 5.4 + 3.2 * (this.eff(closest.player, 'speed') / 100) + 0.3 * (this.eff(closest.player, 'acceleration') / 100))
    const time = Math.max(0.2, Math.min(clamp(closest.dist / pace, 1, 3.2), this.durationSeconds - this.state.clock))
    for (const { player } of chasers) this.moveRunnerToward(player, ball.x, ball.y, time)
    this.advanceClock(time)
    this.advancePlayerMinutes(time)
    const winner = chasers
      .map(({ player }) => ({ player, dist: distance(player, ball) }))
      .filter(({ player, dist }) => dist <= this.reachOf(player))
      .sort((a, b) => a.dist - b.dist)[0]
    if (!winner) {
      const names = chasers.slice(0, 2).map(({ player }) => player.name).join('、')
      return this.log('contest', 'none', `球落在无人区，${names} 正在追。`, {})
    }
    this.state.ball = { x: winner.player.x, y: winner.player.y, ownerId: winner.player.id, justReceived: true }
    this.state.possession = winner.player.side
    return this.log('contest', winner.player.side, `${winner.player.name} 抢在对手之前拿到落点。`, { playerId: winner.player.id })
  }

  private resolveLooseBall(): MatchLogEntry {
    const ball = this.state.ball
    const candidates = this.kernel.looseBallContestants(this.state.teams, ball, () => this.resultRng.float())
    if (candidates.length === 0) {
      let nearest: MatchPlayerState | null = null
      let best = Infinity
      for (const team of this.state.teams) {
        for (const player of team.players) {
          if (!player.onPitch) continue
          const dist = distance(player, ball)
          if (dist < best) {
            best = dist
            nearest = player
          }
        }
      }
      // 没人够得着：球就留在落点，下一步由两队最近的球员跑过去抢（chaseLooseBall）。
      const entry = this.log('info', 'none', '球落在无人区，双方开始追抢。', {})
      if (!this.continuous) this.advanceClock(1.2)
      return entry
    }
    const total = totalWeight(candidates)
    const roll = this.resultRng.float() * total
    const winner = pickByWeight(candidates, roll)
    const probabilities: Record<string, number> = {}
    for (const item of candidates.slice(0, 4)) probabilities[item.player.name] = round(item.weight / total)
    this.state.ball = { x: winner.player.x, y: winner.player.y, ownerId: winner.player.id, justReceived: true }
    this.state.possession = winner.player.side
    const entry = this.log('contest', winner.player.side, `${winner.player.name} 在二点球争夺中把球控制下来。`, {
      playerId: winner.player.id,
      probabilities,
      roll: round(roll / total),
    })
    if (this.continuous) this.advancePlayerMinutes(2)
    if (!this.continuous) this.advanceClock(2)
    return entry
  }

  private executeSetPiece(): MatchLogEntry | null {
    const sp = this.state.pendingSetPiece
    if (!sp) return null
    this.state.pendingSetPiece = null
    this.state.phase = 'open'
    const team = this.getTeam(sp.teamSide)
    const opp = this.getOpponent(sp.teamSide)
    this.state.possession = sp.teamSide
    let time = this.legacyRules ? 10 : 6
    let entry: MatchLogEntry | null = null
    if (sp.type === 'kickoff') {
      const taker = this.pickTaker(team, 'pass', sp.x, sp.y)
      if (!taker) return this.log('info', sp.teamSide, '开球球员没有到位。', {})
      this.state.ball = { x: PITCH_LENGTH / 2, y: GOAL_Y, ownerId: taker.id, justReceived: false }
      this.log('kickoff', sp.teamSide, `${team.name} 开球。`, {})
      const target = this.pickSafeOutlet(team, taker)
      if (!target) return this.log('info', sp.teamSide, '没有可接应的队友，开球被迫向前。', {})
      const choice: ActionChoice = {
        kind: 'pass',
        type: 'short',
        targetId: target.id,
        point: { x: target.x, y: target.y },
        label: '开球短传',
        estimatedP: 0.9,
        successValue: 0,
        failureValue: 0,
        estimatedTime: 4,
      }
      this.moveAll(team, opp, taker, choice, time)
      entry = this.resolvePass(team, opp, taker, choice, time)
    } else if (sp.type === 'throw_in') {
      const taker = this.pickTaker(team, 'pass', sp.x, sp.y)
      if (taker) {
        this.moveRunnerToward(taker, clamp(sp.x, 2, PITCH_LENGTH - 2), clamp(sp.y, 1.5, PITCH_WIDTH - 1.5), time)
        this.state.ball = { x: taker.x, y: taker.y, ownerId: taker.id, justReceived: false }
        const target = this.pickSafeOutlet(team, taker)
        this.log('setpiece', sp.teamSide, `${team.name} 掷界外球。`, {})
        if (target) {
          const choice: ActionChoice = { kind: 'pass', type: 'short', targetId: target.id, point: target, label: '界外球', estimatedP: 0.85, successValue: 0, failureValue: 0, estimatedTime: 2 }
          this.moveAll(team, opp, taker, choice, time)
          entry = this.resolvePass(team, opp, taker, choice, 2)
        }
      }
      time = this.legacyRules ? 8 : 5
    } else if (sp.type === 'goal_kick') {
      const gk = this.teamGoalkeeper(team)
      if (gk) {
        this.moveRunnerToward(gk, ownGoalXOf(team.side) + dirOf(team.side) * 6, GOAL_Y, time)
        this.state.ball = { x: gk.x, y: gk.y, ownerId: gk.id, justReceived: false }
        const target = this.pickSafeOutlet(team, gk)
        this.log('setpiece', sp.teamSide, `${gk.name} 开球门球。`, { playerId: gk.id })
        if (target) {
          const type = opp.tactics.press === 'high' ? 'long' : 'short'
          const choice: ActionChoice = { kind: 'pass', type, targetId: target.id, point: target, label: '球门球', estimatedP: 0.85, successValue: 0, failureValue: 0, estimatedTime: type === 'short' ? 4 : 6 }
          this.moveAll(team, opp, gk, choice, time)
          entry = this.resolvePass(team, opp, gk, choice, 2)
        }
      }
      time = this.legacyRules ? 10 : 6
    } else if (sp.type === 'corner') {
      const taker = this.pickTaker(team, 'cross', sp.x, sp.y)
      if (taker) {
        this.moveRunnerToward(taker, sp.x, sp.y, time)
        this.prepareCorner(team, opp, sp, time)
        this.state.ball = { x: sp.x, y: sp.y, ownerId: taker.id, justReceived: false }
        this.log('setpiece', sp.teamSide, `${taker.name} 主罚角球。`, { playerId: taker.id })
        this.state.ball = { x: goalXOf(team.side) - dirOf(team.side) * 8, y: GOAL_Y, ownerId: null, justReceived: false }
        entry = this.resolveAerial(team, opp, { x: goalXOf(team.side) - dirOf(team.side) * 8, y: GOAL_Y }, team.side, true)
      }
      time = this.legacyRules ? 12 : 7
    } else if (sp.type === 'free_kick') {
      const distToGoal = distance(sp, { x: goalXOf(team.side), y: GOAL_Y })
      const direct = distToGoal < (this.legacyRules ? 30 : FREE_KICK_SHOT_RANGE) && Math.abs(sp.y - GOAL_Y) < 22
      const delivery = !this.legacyRules && !direct && distToGoal < FREE_KICK_DELIVERY_RANGE
      // 后场的任意球就近开出，不用把别的位置的人叫过来。
      const taker = this.legacyRules || direct || delivery
        ? this.pickTaker(team, direct || this.legacyRules ? 'shoot' : 'cross', sp.x, sp.y, true)
        : this.nearestOutfielder(team, sp)
      if (taker) {
        this.moveRunnerToward(taker, sp.x, sp.y, time)
        if (delivery) this.prepareCorner(team, opp, { ...sp }, time)
        this.state.ball = { x: sp.x, y: sp.y, ownerId: taker.id, justReceived: false }
        this.log('setpiece', sp.teamSide, `${team.name} 获得任意球，${taker.name} 站在球前。`, { playerId: taker.id })
        const directChoice: ActionChoice = { kind: 'shoot', point: { x: goalXOf(team.side), y: GOAL_Y }, label: '任意球直接射门', estimatedP: 0.3, successValue: 1, failureValue: 0, estimatedTime: time }
        if (direct) {
          this.moveAll(team, opp, taker, directChoice, time)
          entry = this.resolveShot(taker, team, opp, { point: sp, header: false, penalty: false, freeKick: true })
        } else if (delivery) {
          this.moveAll(team, opp, taker, { ...directChoice, label: '任意球传中' }, time)
          entry = this.deliverFreeKick(team, opp, taker)
        } else {
          const target = this.pickSafeOutlet(team, taker)
          if (target) {
            const choice: ActionChoice = { kind: 'pass', type: 'short', targetId: target.id, point: target, label: '任意球', estimatedP: 0.85, successValue: 0, failureValue: 0, estimatedTime: 2 }
            this.moveAll(team, opp, taker, choice, time)
            entry = this.resolvePass(team, opp, taker, choice, 2)
          }
        }
      }
      time = this.legacyRules ? 12 : 7
    } else if (sp.type === 'penalty') {
      const taker = this.pickTaker(team, 'shoot', sp.x, sp.y)
      if (taker) {
        this.moveRunnerToward(taker, goalXOf(team.side) - dirOf(team.side) * 12, GOAL_Y, time)
        const gk = this.teamGoalkeeper(opp)
        if (gk) this.moveRunnerToward(gk, goalXOf(team.side) - dirOf(team.side) * 0.8, GOAL_Y, time)
        this.state.ball = { x: taker.x, y: taker.y, ownerId: taker.id, justReceived: false }
        this.log('penalty', sp.teamSide, `${taker.name} 主罚点球。`, { playerId: taker.id })
        const spot: ActionChoice = { kind: 'shoot', point: { x: goalXOf(team.side), y: GOAL_Y }, label: '点球', estimatedP: 0.9, successValue: 1, failureValue: 0, estimatedTime: time }
        this.moveAll(team, opp, taker, spot, time)
        entry = this.resolveShot(taker, team, opp, { point: taker, header: false, penalty: true, freeKick: false })
      }
      time = this.legacyRules ? 10 : 6
    }
    this.advanceClock(time)
    this.addPossessionTime(sp.teamSide, time)
    this.advancePlayerMinutes(time)
    if (this.state.pendingSetPiece) this.state.phase = 'setpiece'
    return entry
  }

  /** 前场任意球传中到禁区：先看球能不能传到位，到位了就和角球一样争顶。 */
  private deliverFreeKick(team: MatchTeamState, opp: MatchTeamState, taker: MatchPlayerState): MatchLogEntry | null {
    const point = { x: goalXOf(team.side) - dirOf(team.side) * 8, y: GOAL_Y }
    const p = this.kernel.freeKickDeliveryChance(taker, point)
    const roll = this.resultRng.float()
    taker.stats.passes++
    taker.stats.touches++
    this.statsOf(team).passes++
    if (roll >= p) {
      const clearer = this.nearestOpponent(opp, point)
      this.state.ball = { x: clearer?.x ?? point.x, y: clearer?.y ?? point.y, ownerId: clearer?.id ?? null, justReceived: true }
      this.state.possession = clearer ? opp.side : null
      return this.log('pass', team.side, `${taker.name} 的任意球传中质量不高，${clearer ? `被 ${clearer.name} 解围` : '没有人碰到'}。`, {
        playerId: taker.id, probabilities: { success: round(p), fail: round(1 - p) }, roll: round(roll),
      })
    }
    taker.stats.passesCompleted++
    this.statsOf(team).passesCompleted++
    this.state.ball = { x: point.x, y: point.y, ownerId: null, justReceived: false }
    this.log('pass', team.side, `${taker.name} 把任意球传入禁区。`, { playerId: taker.id, probabilities: { success: round(p), fail: round(1 - p) }, roll: round(roll) })
    return this.resolveAerial(team, opp, point, team.side, true)
  }

  /**
   * 被贴身防守时，防守球员可能直接犯规：宁可送一个任意球，也不让对手舒服地射门或直塞。
   * 这是任意球的主要来源。禁区内不敢动手，门将既不会冲出来拉人，也不会被拉。
   * 用派生随机数判定，不犯规时不影响比赛主随机流。
   */
  private maybeTacticalFoul(opp: MatchTeamState, carrier: MatchPlayerState): MatchLogEntry | null {
    const odds = this.kernel.tacticalFoulOdds(carrier, opp)
    if (!odds) return null
    const { defender, chance } = odds
    if (!derivedRng(this.state.seed, 'tactical-foul', this.state.step, carrier.id).chance(chance)) return null
    this.statsOf(opp).fouls++
    const card = this.book(opp, defender, odds.yellow, odds.red)
    this.setPendingSetPiece('free_kick', carrier.side, carrier.x, carrier.y, `${defender.name} 对 ${carrier.name} 犯规`)
    return this.log('foul', defender.side, `${defender.name} 放倒 ${carrier.name}，判罚任意球${card === 'red' ? '；红牌罚下' : card === 'yellow' ? '；黄牌' : ''}。`, {
      playerId: defender.id,
      probabilities: { foul: round(chance) },
      ...(card ? { card } : {}),
    })
  }

  private prepareCorner(team: MatchTeamState, opp: MatchTeamState, sp: SetPieceState, time = 6): void {
    const attacking = team.players
      .filter((player) => player.onPitch && player.position !== 'GK')
      .sort((a, b) => b.attrs.heading - a.attrs.heading)
    const defenders = opp.players
      .filter((player) => player.onPitch && player.position !== 'GK')
      .sort((a, b) => b.attrs.heading - a.attrs.heading)
    const gx = goalXOf(team.side)
    const dir = dirOf(team.side)
    // 定位球站位也靠跑：6–7 秒够从附近跑到禁区，不再把人瞬移进禁区。
    attacking.slice(0, 3).forEach((player, index) => {
      this.moveRunnerToward(player, clamp(gx - dir * (7 + index * 2), 4, PITCH_LENGTH - 4), clamp(GOAL_Y + (index - 1) * 7, 20, 44), time)
    })
    defenders.slice(0, 4).forEach((player, index) => {
      this.moveRunnerToward(player, clamp(gx - dir * (3 + index * 1.5), 3, PITCH_LENGTH - 3), clamp(GOAL_Y + (index - 1.5) * 6, 22, 42), time)
    })
    const gk = this.teamGoalkeeper(opp)
    if (gk) this.moveRunnerToward(gk, gx - dir * 1, GOAL_Y, time)
    sp.x = gx - dir * 1.5
    sp.y = sp.y < GOAL_Y ? 2 : PITCH_WIDTH - 2
  }

  private pickTaker(team: MatchTeamState, mode: 'pass' | 'cross' | 'shoot', x: number, y: number, freeKick = false): MatchPlayerState | null {
    const players = team.players.filter((player) => player.onPitch && player.position !== 'GK')
    if (players.length === 0) return null
    const scored = players.map((player) => {
      let score = mode === 'shoot' ? player.attrs.shooting * 0.6 + player.attrs.composure * 0.4 : player.attrs.passing * 0.7 + player.attrs.vision * 0.3
      if (mode === 'cross') score += player.attrs.passing * 0.2
      score -= distance(player, { x, y }) * 0.2
      // 带任意球特性的人优先主罚，否则特性可能一直用不上。
      if (freeKick) {
        const trait = STAR_TRAITS[player.traitId]
        if ((mode === 'shoot' && trait?.kind === 'shot' && trait.scope === 'freeKick') || (mode === 'cross' && trait?.kind === 'pass' && trait.scope === 'freeKick')) score += 3000
      }
      return { player, score }
    })
    scored.sort((a, b) => b.score - a.score)
    return scored[0]?.player ?? null
  }

  private nearestOutfielder(team: MatchTeamState, point: { x: number; y: number }): MatchPlayerState | null {
    let best: MatchPlayerState | null = null
    let bestDist = Infinity
    for (const player of team.players) {
      if (!player.onPitch || player.position === 'GK') continue
      const dist = distance(player, point)
      if (dist < bestDist) {
        bestDist = dist
        best = player
      }
    }
    return best
  }

  private pickSafeOutlet(team: MatchTeamState, taker: MatchPlayerState): MatchPlayerState | null {
    const dir = dirOf(team.side)
    const players = team.players.filter((player) => player.onPitch && player.id !== taker.id)
    if (players.length === 0) return null
    const scored = players.map((player) => {
      const forward = (player.x - taker.x) * dir
      const dist = distance(player, taker)
      const nearest = this.nearestOpponent(this.getOpponent(team.side), player)
      const openness = nearest ? distance(nearest, player) : 5
      return { player, score: openness * 1.2 - dist * 0.25 - Math.max(0, forward - 10) * 0.4 }
    })
    scored.sort((a, b) => b.score - a.score)
    return scored[0]?.player ?? null
  }

  private awardCorner(side: MatchSide, x: number, y: number): void {
    this.state.stats[side].corners++
    this.setPendingSetPiece('corner', side, goalXOf(side) - dirOf(side) * 1.5, y < GOAL_Y ? 2 : PITCH_WIDTH - 2, '防守方将球挡出底线')
  }

  private setPendingSetPiece(type: SetPieceState['type'], teamSide: MatchSide, x: number, y: number, note?: string): void {
    this.state.pendingSetPiece = {
      type,
      teamSide,
      x: clamp(x, 1, PITCH_LENGTH - 1),
      y: clamp(y, 1, PITCH_WIDTH - 1),
      note,
    }
    this.state.phase = 'setpiece'
    this.state.possession = teamSide
    if (!this.continuous) {
      this.state.ball = { x: clamp(x, 1, PITCH_LENGTH - 1), y: clamp(y, 1, PITCH_WIDTH - 1), ownerId: null, justReceived: false }
    }
  }

  private outcomeOut(side: MatchSide, point: { x: number; y: number }): SetPieceState['type'] {
    const dir = dirOf(side)
    if (point.y < 2 || point.y > PITCH_WIDTH - 2) {
      this.setPendingSetPiece('throw_in', opponentSide(side), point.x, point.y < 2 ? 1 : PITCH_WIDTH - 1, '球出边线')
      return 'throw_in'
    }
    if ((point.x - goalXOf(side)) * dir >= -1) {
      const def = opponentSide(side)
      this.setPendingSetPiece('goal_kick', def, ownGoalXOf(def) + dirOf(def) * 6, GOAL_Y, '球出底线')
      return 'goal_kick'
    }
    this.setPendingSetPiece('throw_in', opponentSide(side), point.x, clamp(point.y, 1, PITCH_WIDTH - 1), '球出边界')
    return 'throw_in'
  }

  private resetKickoffPositions(teamSide: MatchSide): void {
    // 仅 step 中保留首次重置前的位置；构造/读档不会留下临时视觉状态。
    if (this.playbackStepActive && !this.playbackBeforeReset) this.playbackBeforeReset = capturePlaybackPose(this.state)
    const formationHome = FORMATIONS[this.state.teams[0].formationId]
    const formationAway = FORMATIONS[this.state.teams[1].formationId]
    for (const [index, team] of this.state.teams.entries()) {
      const formation = index === 0 ? formationHome : formationAway
      for (const player of team.players) {
        if (!player.onPitch) continue
        const slot = formation.slots.find((item) => item.id === player.slotId)
        if (!slot) continue
        const baseX = 8 + slot.x * 42
        const baseY = slot.y * PITCH_WIDTH
        player.x = team.side === 'home' ? baseX : PITCH_LENGTH - baseX
        player.y = team.side === 'home' ? baseY : PITCH_WIDTH - baseY
        player.motion = undefined
      }
    }
    this.state.ball = { x: PITCH_LENGTH / 2, y: GOAL_Y, ownerId: null, justReceived: false }
    this.state.pendingSetPiece = { type: 'kickoff', teamSide, x: PITCH_LENGTH / 2, y: GOAL_Y }
    this.state.phase = 'setpiece'
    this.state.possession = teamSide
  }

  private checkPeriod(): void {
    if (this.state.finished) return
    const halfLength = this.durationSeconds / 2
    const periodEnd = this.state.half === 1 ? halfLength : this.durationSeconds
    if (this.state.pendingSetPiece?.type === 'penalty' && this.state.clock >= periodEnd) {
      this.state.clock = periodEnd
      return
    }
    if (this.state.half === 1 && this.state.clock >= halfLength) {
      this.state.clock = halfLength
      this.state.half = 2
      this.resetKickoffPositions('away')
      this.log('half', 'none', '上半场结束，双方交换半场。', {})
    } else if (this.state.half === 2 && this.state.clock >= this.durationSeconds) {
      if (needsShootout(this.knockout, this.state.score, this.state.shootoutOffset)) this.startShootout()
      else this.finishMatch('全场结束。')
    }
  }

  private finishMatch(reason: string): void {
    if (this.state.finished) return
    this.state.clock = this.durationSeconds
    this.state.half = 2
    this.state.finished = true
    this.state.phase = 'finished'
    const shootoutText = this.state.shootout
      ? `点球大战 ${this.state.shootout.home} : ${this.state.shootout.away}。`
      : ''
    this.log('full', 'none', `${reason} ${shootoutText}比分 ${this.state.score.home} : ${this.state.score.away}。`, {})
  }

  private startShootout(): void {
    this.state.shootout = { home: 0, away: 0, attemptsHome: 0, attemptsAway: 0, current: 'home', suddenDeath: false, finished: false }
    this.state.phase = 'shootout'
    this.log('info', 'none', this.state.shootoutOffset ? '两回合总比分战平，进入点球大战（不计客场进球）。' : '常规时间结束，双方战平，比赛进入点球大战。', {})
  }

  private advanceShootout(): void {
    const state = this.state.shootout!
    const side = state.current
    const team = this.getTeam(side)
    const gk = this.teamGoalkeeper(this.getOpponent(side))
    const takers = this.kernel.shootoutOrder(team)
    const index = side === 'home' ? state.attemptsHome : state.attemptsAway
    const taker = takers[index % takers.length]
    if (!taker) {
      state.finished = true
      this.finishMatch('点球大战结束。')
      return
    }
    const p = this.kernel.shootoutKickOdds(taker, gk)
    const roll = this.resultRng.float()
    const goal = roll < p
    if (goal) state[side]++
    if (side === 'home') state.attemptsHome++
    else state.attemptsAway++
    this.log('penalty', side, `${team.name} ${taker.name} 主罚${goal ? '命中' : '罚失'}（点球大战 ${state.home} : ${state.away}）。`, {
      playerId: taker.id, probabilities: { goal: round(p), miss: round(1 - p) }, roll: round(roll),
    })
    state.suddenDeath = state.attemptsHome >= 5 && state.attemptsAway >= 5
    const remainingHome = Math.max(0, 5 - state.attemptsHome)
    const remainingAway = Math.max(0, 5 - state.attemptsAway)
    state.finished = state.suddenDeath
      ? state.attemptsHome === state.attemptsAway && state.home !== state.away
      : state.home > state.away + remainingAway || state.away > state.home + remainingHome
    state.current = opponentSide(side)
    if (state.finished) this.finishMatch('点球大战结束。')
  }

  private advanceClock(seconds: number): void {
    this.state.clock = Math.min(this.durationSeconds, this.state.clock + seconds)
  }

  private advancePlayerMinutes(seconds: number): void {
    const displayMinutes = this.durationSeconds > 0 ? (seconds / this.durationSeconds) * 90 : 0
    for (const team of this.state.teams) {
      for (const player of team.players) {
        if (player.onPitch) player.stats.minutes += displayMinutes
      }
    }
  }

  private addPossessionTime(side: MatchSide, seconds: number): void {
    if (seconds <= 0) return
    this.state.stats[side].possession += seconds
  }

  private addFailure(player: MatchPlayerState, reason: FailureReason, example: string): void {
    const aggregate = this.state.failures[reason]
    aggregate.count++
    if (aggregate.examples.length < 5) aggregate.examples.push(example)
    const perPlayer = this.state.playerFailures[player.id] ?? {}
    perPlayer[reason] = (perPlayer[reason] ?? 0) + 1
    this.state.playerFailures[player.id] = perPlayer
  }

  private recoveryDays(rng: Parameters<typeof injuryRecoveryDays>[0], player: MatchPlayerState): number {
    return this.kernel.recoveryDays(rng, player)
  }

  private markSkill(player: MatchPlayerState, skillId: SkillId, condition: boolean, applied: boolean): void {
    if (!player.skills.includes(skillId)) return
    const stat = this.state.skillStats.find((entry) => entry.playerId === player.id && entry.skillId === skillId && entry.side === player.side)
    if (!stat) return
    if (condition) stat.conditions++
    if (applied) stat.applied++
  }

  private log(
    type: MatchLogEntry['type'],
    team: MatchSide | 'none',
    text: string,
    extra: Partial<MatchLogEntry> = {},
  ): MatchLogEntry {
    const entry: MatchLogEntry = {
      seq: this.state.log.length + 1,
      clock: Math.floor(this.state.clock * 10) / 10,
      half: this.state.half,
      type,
      team,
      text,
      ...extra,
    }
    this.state.log.push(entry)
    commentLog(this.state, entry)
    return entry
  }

  private book(team: MatchTeamState, player: MatchPlayerState, yellowChance = this.legacyRules ? 0.17 : 0.13, redChance = 0.012): 'yellow' | 'red' | null {
    if (player.sentOff) return null
    const rng = derivedRng(this.state.seed, 'card', this.state.step, player.id)
    const odds = this.kernel.cardOdds(player, yellowChance, redChance)
    const straight = rng.chance(odds.straightRed)
    const yellow = straight ? false : rng.chance(odds.yellow)
    player.yellowCards += yellow ? 1 : 0
    const red = straight || player.yellowCards >= 2
    if (red) {
      player.stats.redCards = (player.stats.redCards ?? 0) + 1
      player.sentOff = true
      player.onPitch = false
      player.cameOff = true
      if (this.state.ball.ownerId === player.id) this.state.ball = { ...this.state.ball, ownerId: null, justReceived: false }
      this.statsOf(team).redCards++
      return 'red'
    }
    if (yellow) {
      player.stats.yellowCards = (player.stats.yellowCards ?? 0) + 1
      this.statsOf(team).yellowCards++
      return 'yellow'
    }
    return null
  }

  private maybeInjure(player: MatchPlayerState): void {
    if (player.injured) return
    const { personId, risk } = this.kernel.injuryOdds(player)
    const rng = derivedRng(this.state.seed, 'injury', this.state.step, player.id)
    if (rng.chance(risk)) {
      for (const team of this.state.teams) {
        for (const card of [...team.players, ...team.bench]) {
          if ((card.personId ?? card.sourceId) === personId) card.injured = true
        }
      }
      this.log('injury', player.side, `${player.name} 在身体接触中受伤。`, {
        playerId: player.id, injury: { personId, recoveryDays: this.recoveryDays(rng, player) },
      })
    }
  }

  private applyAutoSubs(): void {
    for (const team of this.state.teams) {
      const plan = team.autoSubs
      if (!plan) continue
      const replace = (out: MatchPlayerState, reason: 'injury' | 'stamina'): boolean => {
        const incoming = this.availableBench(team.side).filter(p => !p.injured && p.positions[out.position] > 0
          && (reason !== 'stamina' || p.stamina / Math.max(1, p.maxStamina) * 100 >= plan.staminaBelow!))
          .sort((a, b) => b.positions[out.position] - a.positions[out.position])[0]
        return !!incoming && this.substitute(out.id, incoming.id, team.side, this.state.clock, reason).ok
      }
      if (plan.onInjury) {
        for (const out of team.players.filter(p => p.onPitch && p.injured).sort((a, b) => a.stamina / a.maxStamina - b.stamina / b.maxStamina)) {
          if (team.subsUsed >= MAX_SUBS) break
          replace(out, 'injury')
        }
      }
      plan.timed = plan.timed.filter(rule => {
        const displayAt = autoSubDisplaySeconds(rule)
        const atLogic = this.durationSeconds > 0 ? (displayAt / 5400) * this.durationSeconds : 0
        if (atLogic > this.state.clock) return true
        const out = team.players.find(p => p.sourceId === rule.outId && p.onPitch)
        const incoming = team.bench.find(p => p.sourceId === rule.inId && !p.cameOff && !p.onPitch)
        if (!out || !incoming || incoming.injured || team.subsUsed >= MAX_SUBS) return false
        return !this.substitute(out.id, incoming.id, team.side, this.state.clock, 'timed').ok
      })
      if (plan.staminaBelow !== null) {
        for (const out of team.players.filter(p => p.onPitch && p.stamina / p.maxStamina * 100 < plan.staminaBelow!).sort((a, b) => a.stamina / a.maxStamina - b.stamina / b.maxStamina)) {
          if (team.subsUsed >= MAX_SUBS) break
          replace(out, 'stamina')
        }
      }
    }
  }

  setTactics(mentality: MatchMentality, side: MatchSide = 'home', eventClock = this.state.clock): { ok: boolean; error?: string } {
    if (this.state.finished) return { ok: false, error: '比赛已经结束' }
    if (mentality !== 'attack' && mentality !== 'balanced' && mentality !== 'defend') return { ok: false, error: '无效的比赛心态' }
    const tactics = MATCH_TACTICS[mentality]
    this.getTeam(side).tactics = { ...tactics }
    this.getTeam(side).mentality = mentality
    this.state.instructions.push({ step: this.state.step, kind: 'tactic', mentality, tactics: { ...tactics } })
    this.log('tactic', side, `教练调整战术：${MATCH_MENTALITY_LABELS[mentality]}。`, { clock: Math.floor(eventClock * 10) / 10 })
    this.syncRng()
    return { ok: true }
  }

  substitute(outId: string, inId: string, side: MatchSide = 'home', eventClock = this.state.clock, autoReason?: 'injury' | 'timed' | 'stamina'): { ok: boolean; error?: string } {
    if (this.state.finished) return { ok: false, error: '比赛已经结束' }
    const team = this.getTeam(side)
    if (team.subsUsed >= MAX_SUBS) return { ok: false, error: `已经用完 ${MAX_SUBS} 次换人` }
    const outIndex = team.players.findIndex((player) => player.id === outId && player.onPitch)
    if (outIndex < 0) return { ok: false, error: '被换下的球员不在场上' }
    const inPlayer = team.bench.find((player) => player.id === inId && !player.cameOff && !player.onPitch)
    if (!inPlayer) return { ok: false, error: '替补球员不可用' }
    const out = team.players[outIndex]
    const role = ROLES[out.role]
    if (role.position !== out.position) return { ok: false, error: '职责与位置不匹配' }
    const incoming: MatchPlayerState = {
      ...inPlayer,
      role: out.role,
      slotId: out.slotId,
      position: out.position,
      x: out.x,
      y: out.y,
      stamina: inPlayer.stamina,
      onPitch: true,
      cameOff: false,
      subbedOn: true,
      stats: { ...inPlayer.stats, staminaLeft: Math.round(inPlayer.stamina / Math.max(1, inPlayer.maxStamina) * 100) },
    }
    const outgoing: MatchPlayerState = { ...out, onPitch: false, cameOff: true, stats: { ...out.stats, staminaLeft: Math.round((out.stamina / out.maxStamina) * 100) } }
    team.players[outIndex] = incoming
    if (this.state.ball.ownerId === out.id) this.state.ball.ownerId = incoming.id
    team.bench = team.bench.filter((player) => player.id !== inId)
    team.bench.push(outgoing)
    team.subsUsed++
    this.state.instructions.push({ step: this.state.step, kind: 'sub', outId, inId, ...(autoReason ? { autoReason } : {}) })
    const reason = autoReason ? `自动换人（${{ injury: '受伤', timed: '定时', stamina: '体力' }[autoReason]}）` : '换人'
    this.log('sub', side, `${reason}：${incoming.name} 换下 ${out.name}。`, { playerId: incoming.id, clock: Math.floor(eventClock * 10) / 10 })
    this.syncRng()
    return { ok: true }
  }

  availableBench(side: MatchSide = 'home'): MatchPlayerState[] {
    return this.getTeam(side).bench.filter((player) => !player.cameOff && !player.onPitch)
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

function emptyTeamStats() {
  return {
    possession: 0,
    passes: 0,
    passesCompleted: 0,
    shots: 0,
    shotsOnTarget: 0,
    goals: 0,
    interceptions: 0,
    tackles: 0,
    fouls: 0,
    corners: 0,
    xg: 0,
    distance: 0,
    yellowCards: 0,
    redCards: 0,
  }
}

export function normalizePossession(state: MatchState): void {
  const total = state.stats.home.possession + state.stats.away.possession
  if (total <= 0) return
  state.stats.home.possession = Math.round((state.stats.home.possession / total) * 1000) / 10
  state.stats.away.possession = Math.round((state.stats.away.possession / total) * 1000) / 10
}
