import { skillTierMultiplier } from './team.ts'
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
import { ROLES, ROLES_BY_POSITION } from '../data/roles.ts'
import { SKILLS, TRAITS } from '../data/skills.ts'
import { effectiveAttr, isGoalkeeper } from '../ca.ts'
import { PCG32, derivedRng } from '../rng.ts'
import { injuryProneness, injuryRisk, injuryRecoveryDays } from '../injury.ts'
import { commentLog, commentPossession, restoreCommentary } from './commentary.ts'
import { chooseShotFoot, chooseShotTarget, isWeakShotFoot, shotPositionText, shotTargetText } from './shooting.ts'
import { GOAL_Y, PITCH_LENGTH, PITCH_WIDTH, GOAL_WIDTH, buildMatchTeam, opponentSide } from './team.ts'
import { LOGIC_MATCH_SECONDS, MATCH_RULES_VERSION, displayClock } from './time.ts'
import type {
  BallState,
  MatchEventContext,
  MatchPlayerState,
  MatchSide,
  MatchState,
  MatchTeamInput,
  MatchTeamState,
  RngState,
  SetPieceState,
  StepResult,
} from './types.ts'
import type { ShotChanceDetail } from '../types.ts'

const TEMPO_MULT = { slow: 1.2, normal: 1, fast: 0.8 } as const
const LINE_X = { low: 16, mid: 27, high: 39 } as const
const PRESS_RANGE = { low: 17, mid: 27, high: 38 } as const
const PRESS_LEVEL = { low: 0, mid: 1, high: 2 } as const
const GOAL_CENTER = { x: PITCH_LENGTH, y: GOAL_Y }

type ActionChoice = {
  kind: 'pass' | 'dribble' | 'shoot' | 'clear'
  type?: 'short' | 'long' | 'through' | 'cross'
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

type PassModel = {
  p: number
  a: number
  d: number
  c: number
  p0: number
  interceptor: MatchPlayerState | null
  support: number
  weakFoot: boolean
}

type ShotModel = {
  block: number
  onTarget: number
  goalGivenOnTarget: number
  pGoal: number
  finishScore: number
  gkScore: number
  distance: number
  chance: ShotChanceDetail
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function distanceToSegment(point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq <= 1e-9) return distance(point, a)
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq, 0, 1)
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z))
}

function logit(p: number): number {
  const safe = clamp(p, 0.001, 0.999)
  return Math.log(safe / (1 - safe))
}

function dirOf(side: MatchSide): number {
  return side === 'home' ? 1 : -1
}

function goalXOf(side: MatchSide): number {
  return side === 'home' ? PITCH_LENGTH : 0
}

function ownGoalXOf(side: MatchSide): number {
  return side === 'home' ? 0 : PITCH_LENGTH
}

function progressOf(side: MatchSide, x: number): number {
  return clamp(side === 'home' ? x / PITCH_LENGTH : (PITCH_LENGTH - x) / PITCH_LENGTH, 0, 1)
}

function inBox(side: MatchSide, point: { x: number; y: number }): boolean {
  const x = side === 'home' ? point.x : PITCH_LENGTH - point.x
  return x >= 84 && point.y >= 18 && point.y <= 46
}

function wideZone(point: { x: number; y: number }): boolean {
  return point.y < 17 || point.y > 47
}

function weakFoot(player: MatchPlayerState): boolean {
  if (player.foot === 'B') return false
  const offensiveLeft = player.side === 'home' ? player.y < GOAL_Y : player.y > GOAL_Y
  return (player.foot === 'L') !== offensiveLeft
}

function rngState(rng: PCG32): RngState {
  return rng.toJSON()
}

export class MatchEngine {
  state: MatchState
  private decisionRng: PCG32
  private resultRng: PCG32
  private knockout: boolean
  private durationSeconds: number
  private legacyRules: boolean
  private offside: boolean

  constructor(options: { seed: number; home: MatchTeamInput; away: MatchTeamInput; knockout: boolean; durationSeconds?: number; offside?: boolean }) {
    const home = buildMatchTeam(options.home, 'home')
    const away = buildMatchTeam(options.away, 'away')
    this.decisionRng = derivedRng(options.seed, 'match-decision')
    this.resultRng = derivedRng(options.seed, 'match-result')
    this.knockout = options.knockout
    this.durationSeconds = options.durationSeconds ?? LOGIC_MATCH_SECONDS
    this.legacyRules = false
    this.offside = options.offside ?? false
    this.state = {
      seed: options.seed,
      rulesVersion: MATCH_RULES_VERSION,
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
    engine.legacyRules = state.rulesVersion !== MATCH_RULES_VERSION
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

  step(realtime = false): StepResult {
    if (this.state.finished) return { state: this.state, entry: null, finished: true }
    this.state.step++
    const logStart = this.state.log.length
    let entry: MatchLogEntry | null = null
    if (realtime && this.state.phase !== 'shootout') this.checkPeriod()
    if (this.state.finished) {
      this.syncRng()
      return { state: this.state, entry: this.state.log.at(-1) ?? null, finished: true }
    }
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
    return { state: this.state, entry, finished: this.state.finished }
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

  private statsOf(team: MatchTeamState) {
    return this.state.stats[team.side]
  }

  private playerById(id: string | null): MatchPlayerState | undefined {
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

  eff(player: MatchPlayerState, key: Parameters<typeof effectiveAttr>[3], ctx: MatchEventContext = {}): number {
    const ratio = player.stamina / Math.max(1, player.maxStamina)
    const gk = player.position === 'GK'
    let value = effectiveAttr(player.attrs, ratio, player.positions[player.position], key, gk)
    const trait = TRAITS[player.traitId]
    if (trait) {
      switch (trait.effect) {
        case 'vision':
          if (key === 'vision' && (ctx.passing || ctx.finalThird)) value += trait.value
          break
        case 'finishing':
          if (key === 'shooting' && ctx.inBox) value += trait.value
          break
        case 'dribbling':
          if (key === 'dribbling') value += trait.value
          break
        case 'tackling':
          if (key === 'tackling') value += trait.value
          break
        case 'aerial':
          if ((key === 'heading' || key === 'strength') && ctx.aerial) value += trait.value
          break
        case 'pace':
          if (key === 'acceleration') value += trait.value * 0.5
          break
        case 'gkWall':
          if (key === 'reflexes') value += trait.value
          break
        case 'gkSweep':
          if (key === 'rushing') value += trait.value
          break
        case 'cross':
          if (key === 'passing' && ctx.crossing) value += trait.value
          break
        case 'link':
          if (key === 'firstTouch' && ctx.finalThird) value += trait.value
          break
        case 'overlap':
          if ((key === 'offBall' || key === 'acceleration') && ctx.wide) value += trait.value
          break
        case 'stamina':
          break
      }
    }
    return clamp(value * (player.injured ? 0.7 : 1), 1, 100)
  }

  private staminaFactor(player: MatchPlayerState): number {
    const trait = TRAITS[player.traitId]
    return trait?.effect === 'stamina' ? 1 - trait.value / 100 : 1
  }

  private openPlay(): MatchLogEntry | null {
    let carrier = this.carrier()
    if (!carrier) {
      return this.resolveLooseBall()
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
    const entry = this.resolveChoice(team, opp, carrier, decision.choice, timing.total)
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
      const canSee = safe || recognitionScore > 34
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
      const p = defender ? this.dribbleModel(carrier, defender, false).p : 0.93
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

    if (carrier.position !== 'GK' && carrierGoalDistance <= 56 && Math.abs(carrier.y - GOAL_Y) < 36) {
      const goal = { x: goalXOf(carrier.side), y: GOAL_Y }
      const model = this.shotModel(carrier, team, opp, { point: carrier, header: false, penalty: false, freeKick: false })
      const p = model.pGoal
      const tactical = carrier.role === 'st_finisher' ? 0.02 : 0
      const chanceValue = this.shotChanceValue(model.chance.type)
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
      choice.q = p * 1 + (1 - p) * -0.03 + chanceValue * 0.3 - 3 * 0.0012 - 0.2 * 0.0005 + tactical
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
    const sigma = 0.012 + (100 - decisionQuality) * 0.0011
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
    const prep = Math.max(0.25, (basePrep + receiveAdjust) * tempo - reduction)
    return { prep, execution, total: prep + execution }
  }

  private moveAll(team: MatchTeamState, opp: MatchTeamState, carrier: MatchPlayerState, choice: ActionChoice, time: number): void {
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
      let maxSpeed = 0.07 * speed + 0.035 * accel + 1.2
      if (player.role === 'st_runner' || player.role === 'w_winger') maxSpeed += 0.4
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
      if (player.skills.includes('iron_lung')) drain *= 1 - (0.05 + (skillTierMultiplier(player, 'iron_lung') - 1) * 0.25)
      if (player.position === 'GK') drain *= 0.5
      if (player.side === opp.side && presser === player.id) drain *= 1.12
      player.stamina = Math.max(0, player.stamina - drain)
      if (move < 0.8 && player.stamina < player.maxStamina) player.stamina = Math.min(player.maxStamina, player.stamina + 0.02)
      player.stats.staminaLeft = Math.round((player.stamina / player.maxStamina) * 100)
      if (player.skills.includes('iron_lung')) {
        const stat = this.state.skillStats.find((entry) => entry.playerId === player.id && entry.skillId === 'iron_lung' && entry.side === player.side)
        if (stat && stat.conditions === 0) this.markSkill(player, 'iron_lung', true, true)
      }
    }
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
        x = anchorX + dir * (2 + progress * 8)
        y = anchorY + (ball.y - anchorY) * 0.18
      } else {
        const push = 8 + progress * 15
        x = anchorX + dir * push
        y = anchorY + (ball.y - anchorY) * (0.16 + role.widthBias * 0.12)
      }
      if (player.position === 'ST' || player.position === 'W') {
        const run = role.forwardRun
        if (run > 0.45) {
          const targetX = ball.x + dir * (5 + run * 11 + this.eff(player, 'offBall') / 25)
          if (progress > 0.5) x = targetX
          if (player.position === 'W') y = anchorY * 0.55 + ball.y * 0.45 + (anchorY - GOAL_Y) * 0.25
          else y = GOAL_Y + (anchorY - GOAL_Y) * 0.4
        }
      } else if (player.position === 'CM') {
        const support = role.supportBias
        x = ball.x - dir * (4 + support * 7)
        y = ball.y * 0.45 + anchorY * 0.55 + (player.role === 'cm_destroyer' ? (GOAL_Y - ball.y) * 0.15 : 0)
        if (player.role === 'cm_box2box' && progress > 0.62) x = ball.x + dir * 6
      } else if (player.position === 'CB') {
        if (role.holdBack) x = player.side === 'home' ? Math.min(x, 53) : Math.max(x, 47)
        else x = player.side === 'home' ? Math.min(x, 42) : Math.max(x, 58)
        y = anchorY * 0.7 + ball.y * 0.3
      }
      if (player.position === 'CB' && role.holdBack && progress < 0.55) {
        x = player.side === 'home' ? Math.min(x, 45) : Math.max(x, 55)
      }
      return { x: clamp(x + dir * mentalityShift, 4, PITCH_LENGTH - 4), y: clamp(y, 3, PITCH_WIDTH - 3) }
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
    const range = PRESS_RANGE[team.tactics.press]
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
    const weak = weakFoot(carrier)
    const pressureDist = this.nearestOpponent(opp, carrier)
    const pressure = pressureDist ? Math.max(0, 9 - distance(pressureDist, carrier)) : 0
    const dist = distance(from, to)
    const interceptors = this.findLineInterceptors(opp, from, to)
    const main = interceptors[0]?.player ?? null
    let a = 0.7 * this.eff(carrier, 'passing', { passing: true, crossing: type === 'cross' }) + 0.2 * this.eff(carrier, 'composure') + 0.1 * this.eff(receiver, 'firstTouch', { finalThird: progressOf(carrier.side, receiver.x) > 0.65 })
    const support = interceptors.slice(1, 2).reduce((sum, item) => sum + Math.min(6, Math.max(0, item.score) * 0.1), 0)
    let d = main ? 0.75 * this.eff(main, 'tackling') + 0.25 * this.eff(main, 'agility') + Math.min(12, support) : 0
    if (main?.skills.includes('sweeper')) {
      d += 4 * skillTierMultiplier(main, 'sweeper')
      if (markSkills) this.markSkill(main, 'sweeper', true, true)
    }
    let c = -Math.max(0, dist - 12) * 0.35
    const nearestToReceiver = this.nearestOpponent(opp, receiver)
    c += nearestToReceiver ? Math.min(5, distance(nearestToReceiver, receiver) * 0.25) : 3
    c -= pressure * 0.8
    if (weak) c -= 4
    if (type === 'cross') c += 2
    if (type === 'through') c -= 2
    if (type === 'long') c -= 2
    let p0 = type === 'short' ? 0.86 : type === 'long' ? 0.74 : type === 'through' ? 0.6 : 0.64
    if (carrier.skills.includes('safe_pass') && type === 'short' && pressure > 2.5) {
      a += 4 * skillTierMultiplier(carrier, 'safe_pass')
      if (markSkills) this.markSkill(carrier, 'safe_pass', true, true)
    } else if (carrier.skills.includes('safe_pass') && type === 'short') {
      if (markSkills) this.markSkill(carrier, 'safe_pass', false, false)
    }
    if (carrier.skills.includes('through_ball') && type === 'through') {
      const ahead = opp.players.filter((player) => player.onPitch && (receiver.x - player.x) * dirOf(carrier.side) > -2)
      if (ahead.length > 0) {
        a += 5 * skillTierMultiplier(carrier, 'through_ball')
        if (markSkills) this.markSkill(carrier, 'through_ball', true, true)
      } else if (markSkills) this.markSkill(carrier, 'through_ball', false, false)
    }
    if (carrier.skills.includes('weak_foot') && weak) {
      c += 3 * skillTierMultiplier(carrier, 'weak_foot')
      if (markSkills) this.markSkill(carrier, 'weak_foot', true, true)
    } else if (carrier.skills.includes('weak_foot')) {
      if (markSkills) this.markSkill(carrier, 'weak_foot', false, false)
    }
    const p = clamp(sigmoid(logit(p0) + (a - d + c) / 30), 0.05, 0.97)
    return { p, a, d, c, p0, interceptor: main, support, weakFoot: weak }
  }

  private findLineInterceptors(opp: MatchTeamState, from: { x: number; y: number }, to: { x: number; y: number }): { player: MatchPlayerState; score: number; dist: number }[] {
    const list: { player: MatchPlayerState; score: number; dist: number }[] = []
    for (const player of opp.players) {
      if (!player.onPitch) continue
      const dist = distanceToSegment(player, from, to)
      const reach = 2.1 + this.eff(player, 'anticipation') * 0.028 + (player.position === 'GK' ? 0.8 : 0)
      if (dist <= reach) {
        const score = 0.4 * this.eff(player, 'anticipation') + 0.3 * this.eff(player, 'defPos') + 0.3 * this.eff(player, 'agility') - dist * 6
        list.push({ player, score, dist })
      }
    }
    list.sort((a, b) => b.score - a.score)
    return list
  }

  private nearestOpponent(opp: MatchTeamState, point: { x: number; y: number }): MatchPlayerState | null {
    let best: MatchPlayerState | null = null
    let bestDist = Infinity
    for (const player of opp.players) {
      if (!player.onPitch) continue
      const dist = distance(player, point)
      if (dist < bestDist) {
        bestDist = dist
        best = player
      }
    }
    return best
  }

  private passValue(carrier: MatchPlayerState, receiver: MatchPlayerState, type: ActionChoice['type']): number {
    const fromProgress = progressOf(carrier.side, carrier.x)
    const progress = progressOf(carrier.side, receiver.x)
    let value = 0.005 + (progress - fromProgress) * 0.22
    if (type === 'through') value += 0.04
    if (type === 'cross') value += 0.02
    if (inBox(carrier.side, receiver)) value += 0.1
    if (progress > 0.72) value += 0.02
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
    const from = { x: carrier.x, y: carrier.y }
    const to = !this.legacyRules && (choice.type === 'through' || choice.type === 'cross')
      ? { x: choice.point.x, y: choice.point.y }
      : { x: receiver.x, y: receiver.y }
    const model = this.passModel(carrier, receiver, choice.type, opp, from, to, true)
    const deviation = choice.type === 'cross' ? 0 : distance(receiver, to)
    const p = clamp(model.p - Math.min(0.12, Math.max(0, deviation - 4) * 0.015), 0.05, 0.97)
    const pressure = this.nearestOpponent(opp, carrier)
    const pressured = !!pressure && distance(pressure, carrier) < 7
    carrier.stats.passes++
    carrier.stats.touches++
    this.statsOf(team).passes++
    const interceptor = model.interceptor
    const outRisk = to.y < 5 || to.y > PITCH_WIDTH - 5 || to.x < 3 || to.x > PITCH_LENGTH - 3 ? 0.24 : 0.1
    let pIntercept = interceptor ? (1 - p) * (1 - outRisk * 0.35) : 0
    let pOut = (1 - p) * outRisk
    let pLoose = 1 - p - pIntercept - pOut
    if (pLoose < 0) {
      pOut += pLoose
      pLoose = 0
    }
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
      carrier.stats.passesCompleted++
      this.statsOf(team).passesCompleted++
      if (!this.legacyRules && (choice.type === 'through' || choice.type === 'cross')) {
        receiver.x = to.x
        receiver.y = to.y
      }
      this.state.ball = { x: receiver.x, y: receiver.y, ownerId: receiver.id, justReceived: true }
      this.state.possession = carrier.side
      if (this.offside && choice.type === 'through' && this.isOffside(receiver, opp, carrier.side)) {
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
    const weak = weakFoot(carrier)
    const wing = wideZone(carrier)
    const pressure = distance(defender, carrier) < 5 ? 1 : 0
    let a = 0.45 * this.eff(carrier, 'dribbling') + 0.3 * this.eff(carrier, 'agility') + 0.25 * this.eff(carrier, 'strength')
    if (carrier.skills.includes('wing_runner') && wing) {
      a += 5 * skillTierMultiplier(carrier, 'wing_runner')
      if (markSkills) this.markSkill(carrier, 'wing_runner', true, true)
    } else if (carrier.skills.includes('wing_runner')) {
      if (markSkills) this.markSkill(carrier, 'wing_runner', false, false)
    }
    let d = 0.65 * this.eff(defender, 'tackling') + 0.2 * this.eff(defender, 'agility') + 0.15 * this.eff(defender, 'strength')
    if (defender.skills.includes('sweeper')) {
      d += 3 * skillTierMultiplier(defender, 'sweeper')
      if (markSkills) this.markSkill(defender, 'sweeper', true, true)
    }
    let c = -pressure * 2 - (weak ? 3 : 0)
    if (carrier.skills.includes('weak_foot') && weak) c += 2 * skillTierMultiplier(carrier, 'weak_foot')
    if (defender.role === 'cb_stopper' || defender.role === 'cm_destroyer') c -= 1
    return { p: clamp(sigmoid(logit(0.72) + (a - d + c) / 30), 0.12, 0.95), a, d }
  }

  private resolveDribble(team: MatchTeamState, opp: MatchTeamState, carrier: MatchPlayerState, choice: ActionChoice, time: number): MatchLogEntry | null {
    const defender = this.nearestOpponent(opp, carrier)
    const inTackleRange = defender ? distance(defender, carrier) < 4.2 : false
    if (!defender || !inTackleRange) {
      carrier.stats.touches++
      const moved = this.legacyRules ? this.moveCarrier(carrier, choice.point, time) : choice.start ? distance(choice.start, carrier) : 0
      return this.log('dribble', carrier.side, `${carrier.name} 带球推进 ${moved.toFixed(1)} 米。`, { playerId: carrier.id, probabilities: { success: 1 } })
    }
    const model = this.dribbleModel(carrier, defender, true)
    const foulShare = clamp(0.16 + ROLES[defender.role].pressBias * 0.05 + PRESS_LEVEL[opp.tactics.press] * 0.02, 0.1, 0.35)
    const tackleShare = (1 - model.p) * (1 - foulShare) * 0.72
    const looseShare = Math.max(0, 1 - model.p - tackleShare - (1 - model.p) * foulShare)
    const foulP = (1 - model.p) * foulShare
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
      this.state.ball = { x: carrier.x, y: carrier.y, ownerId: defender.id, justReceived: true }
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
      const entry = this.log('foul', defender.side, `${defender.name} 犯规，${penalty ? '判罚点球' : '前场任意球'}${card === 'red' ? '；红牌罚下' : card === 'yellow' ? '；黄牌' : ''}。`, {
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
    const maxMove = (0.07 * speed + 0.035 * accel + 1.2) * time * (0.75 + 0.25 * ratio)
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

  /** 旧活动比赛恢复路径：只用于没有 rulesVersion 的存档。 */
  private legacyShotModel(
    shooter: MatchPlayerState,
    team: MatchTeamState,
    opp: MatchTeamState,
    opts: { point: { x: number; y: number }; header: boolean; penalty: boolean; freeKick: boolean; foot?: 'left' | 'right' },
    markSkills = false,
  ): ShotModel {
    const target = { x: goalXOf(shooter.side), y: GOAL_Y }
    const dist = distance(opts.point, target)
    const gk = this.teamGoalkeeper(opp)
    const inBoxShot = inBox(shooter.side, opts.point)
    const weak = !opts.header && (opts.foot ? isWeakShotFoot(shooter, opts.foot) : weakFoot(shooter))
    let finishScore = opts.header
      ? 0.55 * this.eff(shooter, 'heading', { aerial: true, inBox: true }) + 0.25 * this.eff(shooter, 'shooting', { inBox: true }) + 0.2 * this.eff(shooter, 'composure', { inBox: true })
      : 0.75 * this.eff(shooter, 'shooting', { inBox: inBoxShot }) + 0.25 * this.eff(shooter, 'composure', { inBox: inBoxShot })
    if (weak) finishScore -= clamp(11 - this.eff(shooter, 'firstTouch') * 0.07 - (shooter.skills.includes('weak_foot') ? 3 * skillTierMultiplier(shooter, 'weak_foot') : 0), 2, 10)
    const pressure = this.nearestOpponent(opp, opts.point)
    const pressurePenalty = pressure ? Math.max(0, 6 - distance(pressure, opts.point)) * 0.8 : 0
    const anglePenalty = Math.max(0, Math.abs(opts.point.y - GOAL_Y) - 12) * 0.6
    let t = 0.54 + (finishScore - 55) / 150 - Math.max(0, dist - 10) * 0.011 - anglePenalty / 100 + (opts.header ? -0.03 : 0)
    let g = 0.38 + (finishScore - 55) / 170 - Math.max(0, dist - 12) * 0.004
    if (opts.penalty) {
      t = 0.7 + (finishScore - 50) / 180
      g = 0.5 + (finishScore - 50) / 220
    }
    if (shooter.skills.includes('box_hunter') && inBoxShot) {
      t += 0.04 * skillTierMultiplier(shooter, 'box_hunter')
      g += 0.03 * skillTierMultiplier(shooter, 'box_hunter')
      if (markSkills) this.markSkill(shooter, 'box_hunter', true, true)
    } else if (shooter.skills.includes('box_hunter') && markSkills) this.markSkill(shooter, 'box_hunter', false, false)
    if (shooter.skills.includes('long_shot') && !inBoxShot) {
      t += 0.035 * skillTierMultiplier(shooter, 'long_shot')
      g += 0.02 * skillTierMultiplier(shooter, 'long_shot')
      if (markSkills) this.markSkill(shooter, 'long_shot', true, true)
    } else if (shooter.skills.includes('long_shot') && markSkills) this.markSkill(shooter, 'long_shot', false, false)
    if (shooter.skills.includes('weak_foot') && weak) {
      t += 0.02 * skillTierMultiplier(shooter, 'weak_foot')
      if (markSkills) this.markSkill(shooter, 'weak_foot', true, true)
    } else if (shooter.skills.includes('weak_foot') && markSkills) this.markSkill(shooter, 'weak_foot', false, false)
    if (opts.penalty && shooter.skills.includes('penalty_specialist')) {
      t += 0.05 * skillTierMultiplier(shooter, 'penalty_specialist')
      g += 0.04 * skillTierMultiplier(shooter, 'penalty_specialist')
      if (markSkills) this.markSkill(shooter, 'penalty_specialist', true, true)
    }
    t -= pressurePenalty / 100
    t = clamp(t, 0.12, 0.93)
    let gkScore = gk
      ? 0.6 * this.eff(gk, 'reflexes', { oneOnOne: !!pressure && distance(pressure, gk) < 10 }) + 0.25 * this.eff(gk, 'defPos') + 0.15 * this.eff(gk, 'oneOnOne', { oneOnOne: true })
      : 45
    if (gk) {
      const gkOut = distance(gk, { x: ownGoalXOf(gk.side), y: GOAL_Y }) > 10
      if (gkOut) g += 0.1
      if (opts.penalty) gkScore = 0.55 * this.eff(gk, 'oneOnOne', { oneOnOne: true, penalty: true }) + 0.3 * this.eff(gk, 'reflexes') + 0.15 * this.eff(gk, 'defPos')
      if (gk.skills.includes('gk_reflexes')) {
        gkScore += 5 * skillTierMultiplier(gk, 'gk_reflexes')
        if (markSkills) this.markSkill(gk, 'gk_reflexes', true, true)
      }
    }
    g = clamp(g - (gkScore - 55) / 200, 0.07, 0.82)
    let block = 0
    if (!opts.penalty) {
      const blockers = this.findBlockers(opp, opts.point, target, true)
      if (blockers.length > 0) block = clamp(0.015 + Math.max(0, blockers[0] - 30) * 0.008, 0.01, 0.42)
      if (opts.freeKick) block += 0.05
    }
    block = clamp(block, 0, 0.45)
    const onTarget = clamp(t, 0.05, 0.95)
    const goalGiven = clamp(g, 0.05, 0.95)
    const chance: ShotChanceDetail = { type: 'normal', label: '旧版规则', base: onTarget, floor: 0.05, ceiling: 0.95, goalBase: goalGiven, distance: dist, angle: this.goalAngle(opts.point, shooter.side), pressure: 0, blockers: 0, reason: 'legacy' }
    return { block, onTarget, goalGivenOnTarget: goalGiven, pGoal: (1 - block) * onTarget * goalGiven, finishScore, gkScore, distance: dist, chance }
  }

  private shotChanceValue(type: ShotChanceDetail['type']): number {
    return { open_goal: 0.95, clear_chance: 0.82, box_open: 0.58, normal: 0.3, difficult: 0.08, penalty: 0.78, header: 0.4, free_kick: 0.15 }[type]
  }

  private goalAngle(point: { x: number; y: number }, side: MatchSide): number {
    const dx = Math.max(0.2, Math.abs(goalXOf(side) - point.x))
    const top = Math.atan2(GOAL_Y - GOAL_WIDTH / 2 - point.y, dx)
    const bottom = Math.atan2(GOAL_Y + GOAL_WIDTH / 2 - point.y, dx)
    return Math.abs(bottom - top) * 180 / Math.PI
  }

  private classifyShotChance(
    shooter: MatchPlayerState,
    opp: MatchTeamState,
    point: { x: number; y: number },
    opts: { header: boolean; penalty: boolean; freeKick: boolean },
  ): ShotChanceDetail {
    const target = { x: goalXOf(shooter.side), y: GOAL_Y }
    const dist = distance(point, target)
    const angle = this.goalAngle(point, shooter.side)
    const gk = this.teamGoalkeeper(opp)
    const gkOut = !gk || distance(gk, { x: ownGoalXOf(gk.side), y: GOAL_Y }) > 10
    const outfield = opp.players.filter((player) => player.onPitch && player.position !== 'GK')
    const nearest = outfield.length ? Math.min(...outfield.map((player) => distance(player, point))) : 99
    const blockers = this.findBlockers(opp, point, target).length
    const pressure = clamp((7 - nearest) / 7, 0, 1)
    const mk = (type: ShotChanceDetail['type'], label: string, base: number, floor: number, ceiling: number, goalBase: number, reason: string): ShotChanceDetail => ({
      type, label, base, floor, ceiling, goalBase, distance: dist, angle, pressure, blockers, reason,
    })
    if (opts.penalty) return mk('penalty', '点球', 0.7, 0.68, 0.95, 0.5, '点球，仅门将和主罚者')
    if (opts.freeKick) return mk('free_kick', '任意球', 0.38, 0.1, 0.75, 0.24, '直接任意球，有人墙和距离影响')
    if (opts.header) return mk('header', '头球', 0.48, 0.2, 0.88, 0.32, '头球，使用头球与镇定')
    if (dist <= 8 && angle >= 35 && nearest > 8 && blockers === 0 && gkOut) {
      return mk('open_goal', '近距空门', 0.94, 0.9, 0.99, 0.82, '近距离、角度开放、门将未覆盖')
    }
    if (dist <= 16 && angle >= 24 && nearest > 6.5 && blockers === 0) {
      // 接近空门时把单刀参数连续抬高，避免 8 米边界跳变。
      const nearOpen = clamp((10 - dist) / 2, 0, 1) * clamp((nearest - 6) / 2, 0, 1) * clamp((angle - 30) / 5, 0, 1)
      return mk('clear_chance', '干净单刀', 0.85 + 0.09 * nearOpen, 0.78 + 0.12 * nearOpen, 0.97, 0.56, '距门近、角度开放、外场防守来不及干扰')
    }
    if (dist <= 18 && angle >= 18 && nearest > 4.5 && blockers === 0) {
      const nearClear = clamp((18 - dist) / 2, 0, 1) * clamp((nearest - 5) / 1.5, 0, 1) * clamp((angle - 20) / 4, 0, 1)
      return mk('box_open', '禁区空位', 0.77 + 0.08 * nearClear, 0.65 + 0.13 * nearClear, 0.95, 0.43, '禁区内空位，仍有门将')
    }
    if (dist <= 26 && angle >= 12) {
      const nearBox = clamp((20 - dist) / 2, 0, 1)
      const base = clamp(0.6 - Math.max(0, dist - 20) * 0.02 - (nearest <= 4 ? 0.06 : 0) + 0.17 * nearBox, 0.45, 0.7)
      return mk('normal', '普通射门', base, 0.35 + 0.3 * nearBox, 0.9, 0.33, nearest <= 4 ? '有贴身干扰的普通射门' : '角度尚可的普通射门')
    }
    const nearNormal = clamp((34 - dist) / 8, 0, 1)
    const base = clamp(0.6 - Math.max(0, dist - 20) * 0.023 - Math.max(0, 16 - angle) * 0.004, 0.16, 0.6)
    return mk('difficult', '困难射门', base, 0.05 + 0.3 * nearNormal, 0.75 + 0.15 * nearNormal, 0.2 + 0.13 * nearNormal, '距离远、角度小或有封堵')
  }

  private shotModel(
    shooter: MatchPlayerState,
    team: MatchTeamState,
    opp: MatchTeamState,
    opts: { point: { x: number; y: number }; header: boolean; penalty: boolean; freeKick: boolean; foot?: 'left' | 'right' },
    markSkills = false,
  ): ShotModel {
    if (this.legacyRules) return this.legacyShotModel(shooter, team, opp, opts, markSkills)
    const target = { x: goalXOf(shooter.side), y: GOAL_Y }
    const dist = distance(opts.point, target)
    const gk = this.teamGoalkeeper(opp)
    const inBoxShot = inBox(shooter.side, opts.point)
    const weak = !opts.header && (opts.foot ? isWeakShotFoot(shooter, opts.foot) : weakFoot(shooter))
    const chance = this.classifyShotChance(shooter, opp, opts.point, opts)
    let finishScore = opts.header
      ? 0.55 * this.eff(shooter, 'heading', { aerial: true, inBox: true }) + 0.25 * this.eff(shooter, 'shooting', { inBox: true }) + 0.2 * this.eff(shooter, 'composure', { inBox: true })
      : 0.75 * this.eff(shooter, 'shooting', { inBox: inBoxShot }) + 0.25 * this.eff(shooter, 'composure', { inBox: inBoxShot })
    if (weak) finishScore -= clamp(11 - this.eff(shooter, 'firstTouch') * 0.07 - (shooter.skills.includes('weak_foot') ? 3 * skillTierMultiplier(shooter, 'weak_foot') : 0), 2, 10)
    const precision = opts.header
      ? 0.7 * this.eff(shooter, 'heading') + 0.3 * this.eff(shooter, 'composure')
      : 0.7 * this.eff(shooter, 'shooting') + 0.3 * this.eff(shooter, 'composure')
    const attributeAdjust = clamp((precision - 50) * 0.002, -0.1, 0.1)
    const weakAdjust = weak ? -0.02 : 0
    let onTarget = clamp(chance.base + attributeAdjust + weakAdjust, chance.floor, chance.ceiling)
    let goalGiven = chance.goalBase
    let gkScore = 45
    const noKeeper = !gk
    if (gk) {
      const gkOut = distance(gk, { x: ownGoalXOf(gk.side), y: GOAL_Y }) > 10
      if (gkOut) {
        // 已失位的门将不能隔空用高属性扑救；只保留很小的回追影响。
        gkScore = 25
        goalGiven += chance.type === 'open_goal' ? 0.12 : 0.06
      } else {
        const oneOnOne = chance.type === 'clear_chance'
        gkScore = oneOnOne || opts.penalty
          ? 0.55 * this.eff(gk, 'oneOnOne', { oneOnOne: true, penalty: opts.penalty }) + 0.3 * this.eff(gk, 'reflexes') + 0.15 * this.eff(gk, 'defPos')
          : 0.65 * this.eff(gk, 'reflexes', { oneOnOne: false }) + 0.35 * this.eff(gk, 'defPos')
      }
      if (gk.skills.includes('gk_reflexes')) {
        if (!gkOut) gkScore += 5 * skillTierMultiplier(gk, 'gk_reflexes')
        if (markSkills) this.markSkill(gk, 'gk_reflexes', true, true)
      }
    } else {
      goalGiven = 1
    }
    goalGiven = clamp(goalGiven + (finishScore - gkScore) * 0.003, 0.05, 0.95)
    if (noKeeper || chance.type === 'open_goal') goalGiven = 1
    if (shooter.skills.includes('box_hunter') && inBoxShot) {
      onTarget += 0.04 * skillTierMultiplier(shooter, 'box_hunter')
      goalGiven += 0.03 * skillTierMultiplier(shooter, 'box_hunter')
      if (markSkills) this.markSkill(shooter, 'box_hunter', true, true)
    } else if (shooter.skills.includes('box_hunter')) {
      if (markSkills) this.markSkill(shooter, 'box_hunter', false, false)
    }
    if (shooter.skills.includes('long_shot') && !inBoxShot) {
      onTarget += 0.035 * skillTierMultiplier(shooter, 'long_shot')
      goalGiven += 0.02 * skillTierMultiplier(shooter, 'long_shot')
      if (markSkills) this.markSkill(shooter, 'long_shot', true, true)
    } else if (shooter.skills.includes('long_shot')) {
      if (markSkills) this.markSkill(shooter, 'long_shot', false, false)
    }
    if (shooter.skills.includes('weak_foot') && weak) {
      onTarget += 0.02 * skillTierMultiplier(shooter, 'weak_foot')
      if (markSkills) this.markSkill(shooter, 'weak_foot', true, true)
    } else if (shooter.skills.includes('weak_foot')) {
      if (markSkills) this.markSkill(shooter, 'weak_foot', false, false)
    }
    if (opts.penalty && shooter.skills.includes('penalty_specialist')) {
      onTarget += 0.05 * skillTierMultiplier(shooter, 'penalty_specialist')
      goalGiven += 0.04 * skillTierMultiplier(shooter, 'penalty_specialist')
      if (markSkills) this.markSkill(shooter, 'penalty_specialist', true, true)
    }
    onTarget = clamp(onTarget, chance.floor, chance.ceiling)
    goalGiven = clamp(goalGiven, 0.05, noKeeper || chance.type === 'open_goal' ? 1 : 0.95)
    let block = 0
    if (!opts.penalty) {
      const blockers = this.findBlockers(opp, opts.point, target)
      if (blockers.length > 0) {
        const score = blockers[0]
        block = clamp(0.015 + Math.max(0, score - 30) * 0.008, 0.01, 0.42)
      }
      if (opts.freeKick) block += 0.05
    }
    block = clamp(block, 0, 0.45)
    const pGoal = (1 - block) * onTarget * goalGiven
    return { block, onTarget, goalGivenOnTarget: goalGiven, pGoal, finishScore, gkScore, distance: dist, chance }
  }

  private findBlockers(opp: MatchTeamState, shooter: { x: number; y: number }, target: { x: number; y: number }, includeGk = false): number[] {
    const scores: number[] = []
    for (const player of opp.players) {
      if (!player.onPitch || (!includeGk && player.position === 'GK')) continue
      const dist = distanceToSegment(player, shooter, target)
      if (dist > 5.2) continue
      const between = (player.x - shooter.x) * (target.x - shooter.x) >= 0 && (player.x - shooter.x) * (target.x - shooter.x) <= (target.x - shooter.x) ** 2 + 0.1
      if (!between) continue
      scores.push(this.eff(player, 'defPos') * 0.45 + this.eff(player, 'anticipation') * 0.35 + (5.2 - dist) * 4)
    }
    scores.sort((a, b) => b - a)
    return scores
  }

  private resolveShot(
    shooter: MatchPlayerState,
    team: MatchTeamState,
    opp: MatchTeamState,
    opts: { point: { x: number; y: number }; header: boolean; penalty: boolean; freeKick: boolean },
  ): MatchLogEntry {
    const origin = { x: opts.point.x, y: opts.point.y }
    const detailRng = derivedRng(this.state.seed, 'shot-detail', this.state.step, this.state.log.length)
    const balance = (this.eff(shooter, 'firstTouch') + this.eff(shooter, 'agility')) / 2
    const foot = opts.header ? undefined : opts.penalty && shooter.foot !== 'B'
      ? shooter.foot === 'L' ? 'left' : 'right'
      : chooseShotFoot(shooter, origin.y, balance, detailRng)
    const precision = opts.header
      ? 0.7 * this.eff(shooter, 'heading') + 0.3 * this.eff(shooter, 'composure')
      : 0.7 * this.eff(shooter, 'shooting') + 0.3 * this.eff(shooter, 'composure')
    const target = chooseShotTarget(precision, detailRng)
    const technique: GoalDetail['technique'] = opts.header ? 'header' : detailRng.chance(clamp(0.5 + (this.eff(shooter, 'strength') - this.eff(shooter, 'composure')) / 160, 0.2, 0.8)) ? 'power' : 'placed'
    const model = this.shotModel(shooter, team, opp, { ...opts, point: origin, foot }, true)
    const corner = target.endsWith('left') || target.endsWith('right')
    const onTarget = clamp(model.onTarget + (corner ? -0.02 : 0.02) + (technique === 'power' ? -0.015 : technique === 'placed' ? 0.015 : 0), model.chance.floor, model.chance.ceiling)
    const goalCap = model.chance.type === 'open_goal' || model.goalGivenOnTarget >= 1 ? 1 : 0.95
    const goalGiven = clamp(model.goalGivenOnTarget + (corner ? 0.03 : -0.02) + (technique === 'power' ? 0.025 : technique === 'placed' ? -0.015 : 0), 0.05, goalCap)
    const raw = {
      block: model.block,
      off: (1 - model.block) * (1 - onTarget),
      save: (1 - model.block) * onTarget * (1 - goalGiven),
      goal: (1 - model.block) * onTarget * goalGiven,
    }
    const probs = {
      block: round(raw.block),
      off: round(raw.off),
      save: round(raw.save),
      goal: round(raw.goal),
    }
    const shotRatings = { block: round(model.block), onTarget: round(onTarget), goalGiven: round(goalGiven), finish: round(model.finishScore), gk: round(model.gkScore) }
    const shotChance: ShotChanceDetail | undefined = this.legacyRules ? undefined : { ...model.chance, base: round(model.chance.base), floor: round(model.chance.floor), ceiling: round(model.chance.ceiling), goalBase: round(model.chance.goalBase), distance: round(model.chance.distance), angle: round(model.chance.angle), pressure: round(model.chance.pressure) }
    const roll = this.resultRng.float()
    shooter.stats.shots++
    shooter.stats.touches++
    this.statsOf(team).shots++
    this.statsOf(team).xg += raw.goal
    if (roll < raw.goal) {
      this.state.score[shooter.side]++
      this.state.lastGoalBy = shooter.side
      shooter.stats.goals++
      this.statsOf(team).goals++
      this.statsOf(team).shotsOnTarget++
      this.addPossessionTime(shooter.side, 0)
      const goal: GoalDetail = {
        playerId: shooter.id, playerName: shooter.name, side: shooter.side,
        clock: Math.floor(this.state.clock * 10) / 10, half: this.state.half,
        origin, distance: Math.round(model.distance * 10) / 10,
        bodyPart: foot ?? 'head', technique,
        situation: opts.penalty ? 'penalty' : opts.freeKick ? 'free_kick' : 'open', chance: model.chance.type, target,
      }
      const action = technique === 'header' ? '头球攻门' : `${foot === 'left' ? '左脚' : '右脚'}${technique === 'power' ? '抽射' : '推射'}`
      const situation = opts.penalty ? '主罚点球，' : opts.freeKick ? '主罚任意球，' : ''
      this.log('goal', shooter.side, `${shooter.name}${situation}在${shotPositionText(goal)}${action}，球飞入球门${shotTargetText(target)}！${this.state.score.home} : ${this.state.score.away}`, {
        playerId: shooter.id, goal,
        probabilities: probs,
        ratings: shotRatings,
        shotChance,
        roll,
      })
      this.resetKickoffPositions(opponentSide(shooter.side))
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
        })
      }
      if (gk) {
        const catchP = clamp(0.35 + (this.eff(gk, 'handling') - this.eff(shooter, 'shooting')) / 150, 0.12, 0.88)
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
    })
  }

  private teamGoalkeeper(team: MatchTeamState): MatchPlayerState | null {
    return team.players.find((player) => player.onPitch && player.position === 'GK') ?? null
  }

  private resolveAerial(team: MatchTeamState, opp: MatchTeamState, point: { x: number; y: number }, attackingSide: MatchSide, headerShot: boolean): MatchLogEntry | null {
    const attacking = this.getTeam(attackingSide)
    const defending = this.getOpponent(attackingSide)
    const contestants: { player: MatchPlayerState; weight: number; side: MatchSide }[] = []
    for (const player of attacking.players) {
      if (!player.onPitch || player.position === 'GK') continue
      const dist = distance(player, point)
      if (dist <= 13) {
        const weight =
          0.45 * this.eff(player, 'heading', { aerial: true }) +
          0.25 * this.eff(player, 'strength', { aerial: true }) +
          0.2 * this.eff(player, 'anticipation') +
          0.1 * this.eff(player, 'offBall') +
          Math.max(0, player.height - 175) * 0.2 +
          (player.skills.includes('aerial') ? 5 * skillTierMultiplier(player, 'aerial') : 0)
        contestants.push({ player, weight: weight * (0.85 + this.resultRng.float() * 0.3), side: attackingSide })
        if (player.skills.includes('aerial')) this.markSkill(player, 'aerial', true, true)
      }
    }
    for (const player of defending.players) {
      if (!player.onPitch) continue
      const dist = distance(player, point)
      const isGk = player.position === 'GK'
      if (dist <= (isGk ? 11 : 13)) {
        const weight = isGk
          ? 0.4 * this.eff(player, 'rushing', { aerial: true }) + 0.3 * this.eff(player, 'handling') + 0.2 * this.eff(player, 'anticipation') + 10
          : 0.4 * this.eff(player, 'heading', { aerial: true }) + 0.3 * this.eff(player, 'strength', { aerial: true }) + 0.2 * this.eff(player, 'defPos') + 0.1 * this.eff(player, 'anticipation')
        contestants.push({ player, weight: weight * (0.85 + this.resultRng.float() * 0.3), side: defending.side })
        if (!isGk && player.skills.includes('aerial')) this.markSkill(player, 'aerial', true, true)
      }
    }
    if (contestants.length === 0) {
      this.state.ball = { x: point.x, y: point.y, ownerId: null, justReceived: false }
      return this.log('contest', attackingSide, '禁区里没有人碰到球，球落在草地上。', {})
    }
    const total = contestants.reduce((sum, item) => sum + item.weight, 0)
    const roll = this.resultRng.float() * total
    let winner = contestants[contestants.length - 1]
    let acc = 0
    for (const item of contestants) {
      acc += item.weight
      if (roll <= acc) {
        winner = item
        break
      }
    }
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

  private resolveLooseBall(): MatchLogEntry {
    const ball = this.state.ball
    const candidates: { player: MatchPlayerState; weight: number }[] = []
    for (const team of this.state.teams) {
      for (const player of team.players) {
        if (!player.onPitch) continue
        const dist = distance(player, ball)
        const reach = 4.5 + this.eff(player, 'anticipation') * 0.035 + this.eff(player, 'speed') * 0.02
        if (dist <= reach) {
          const gk = player.position === 'GK'
          const weight = gk
            ? 0.5 * this.eff(player, 'rushing') + 0.3 * this.eff(player, 'handling') + 1
            : 0.35 * this.eff(player, 'anticipation') +
              0.2 * (player.position === 'CB' ? this.eff(player, 'defPos') : this.eff(player, 'offBall')) +
              0.2 * this.eff(player, 'strength') +
              0.15 * this.eff(player, 'speed') +
              Math.max(0, player.height - 175) * 0.15
          candidates.push({ player, weight: weight * (0.75 + this.resultRng.float() * 0.5) })
        }
      }
    }
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
      if (nearest) {
        this.state.ball = { x: nearest.x, y: nearest.y, ownerId: nearest.id, justReceived: true }
        this.state.possession = nearest.side
        return this.log('info', nearest.side, `${nearest.name} 跑过来捡起了球。`, { playerId: nearest.id })
      }
      this.state.ball = { x: PITCH_LENGTH / 2, y: GOAL_Y, ownerId: null, justReceived: false }
      const entry = this.log('info', 'none', '球停在无人区，比赛继续。', {})
      this.advanceClock(2)
      return entry
    }
    const total = candidates.reduce((sum, item) => sum + item.weight, 0)
    const roll = this.resultRng.float() * total
    let winner = candidates[candidates.length - 1]
    let acc = 0
    for (const item of candidates) {
      acc += item.weight
      if (roll <= acc) {
        winner = item
        break
      }
    }
    const probabilities: Record<string, number> = {}
    for (const item of candidates.slice(0, 4)) probabilities[item.player.name] = round(item.weight / total)
    this.state.ball = { x: winner.player.x, y: winner.player.y, ownerId: winner.player.id, justReceived: true }
    this.state.possession = winner.player.side
    const entry = this.log('contest', winner.player.side, `${winner.player.name} 在二点球争夺中把球控制下来。`, {
      playerId: winner.player.id,
      probabilities,
      roll: round(roll / total),
    })
    this.advanceClock(2)
    this.advancePlayerMinutes(2)
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
    let time = 10
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
      entry = this.resolvePass(team, opp, taker, choice, time)
    } else if (sp.type === 'throw_in') {
      const taker = this.pickTaker(team, 'pass', sp.x, sp.y)
      if (taker) {
        taker.x = clamp(sp.x, 2, PITCH_LENGTH - 2)
        taker.y = clamp(sp.y, 1.5, PITCH_WIDTH - 1.5)
        this.state.ball = { x: taker.x, y: taker.y, ownerId: taker.id, justReceived: false }
        const target = this.pickSafeOutlet(team, taker)
        this.log('setpiece', sp.teamSide, `${team.name} 掷界外球。`, {})
        if (target) {
          const choice: ActionChoice = { kind: 'pass', type: 'short', targetId: target.id, point: target, label: '界外球', estimatedP: 0.85, successValue: 0, failureValue: 0, estimatedTime: 2 }
          entry = this.resolvePass(team, opp, taker, choice, 2)
        }
      }
      time = 8
    } else if (sp.type === 'goal_kick') {
      const gk = this.teamGoalkeeper(team)
      if (gk) {
        gk.x = ownGoalXOf(team.side) + dirOf(team.side) * 6
        gk.y = GOAL_Y
        this.state.ball = { x: gk.x, y: gk.y, ownerId: gk.id, justReceived: false }
        const target = this.pickSafeOutlet(team, gk)
        this.log('setpiece', sp.teamSide, `${gk.name} 开球门球。`, { playerId: gk.id })
        if (target) {
          const type = opp.tactics.press === 'high' ? 'long' : 'short'
          const choice: ActionChoice = { kind: 'pass', type, targetId: target.id, point: target, label: '球门球', estimatedP: 0.85, successValue: 0, failureValue: 0, estimatedTime: type === 'short' ? 4 : 6 }
          entry = this.resolvePass(team, opp, gk, choice, 2)
        }
      }
      time = 10
    } else if (sp.type === 'corner') {
      const taker = this.pickTaker(team, 'cross', sp.x, sp.y)
      if (taker) {
        taker.x = sp.x
        taker.y = sp.y
        this.prepareCorner(team, opp, sp)
        this.state.ball = { x: sp.x, y: sp.y, ownerId: taker.id, justReceived: false }
        this.log('setpiece', sp.teamSide, `${taker.name} 主罚角球。`, { playerId: taker.id })
        this.state.ball = { x: goalXOf(team.side) - dirOf(team.side) * 8, y: GOAL_Y, ownerId: null, justReceived: false }
        entry = this.resolveAerial(team, opp, { x: goalXOf(team.side) - dirOf(team.side) * 8, y: GOAL_Y }, team.side, true)
      }
      time = 12
    } else if (sp.type === 'free_kick') {
      const taker = this.pickTaker(team, 'shoot', sp.x, sp.y)
      if (taker) {
        taker.x = sp.x
        taker.y = sp.y
        this.state.ball = { x: sp.x, y: sp.y, ownerId: taker.id, justReceived: false }
        const distToGoal = distance(sp, { x: goalXOf(team.side), y: GOAL_Y })
        this.log('setpiece', sp.teamSide, `${team.name} 获得任意球，${taker.name} 站在球前。`, { playerId: taker.id })
        if (distToGoal < 30 && Math.abs(sp.y - GOAL_Y) < 22) {
          entry = this.resolveShot(taker, team, opp, { point: sp, header: false, penalty: false, freeKick: true })
        } else {
          const target = this.pickSafeOutlet(team, taker)
          if (target) {
            const choice: ActionChoice = { kind: 'pass', type: 'short', targetId: target.id, point: target, label: '任意球', estimatedP: 0.85, successValue: 0, failureValue: 0, estimatedTime: 2 }
            entry = this.resolvePass(team, opp, taker, choice, 2)
          }
        }
      }
      time = 12
    } else if (sp.type === 'penalty') {
      const taker = this.pickTaker(team, 'shoot', sp.x, sp.y)
      if (taker) {
        taker.x = goalXOf(team.side) - dirOf(team.side) * 12
        taker.y = GOAL_Y
        const gk = this.teamGoalkeeper(opp)
        if (gk) {
          gk.x = goalXOf(team.side) - dirOf(team.side) * 0.8
          gk.y = GOAL_Y
        }
        this.state.ball = { x: taker.x, y: taker.y, ownerId: taker.id, justReceived: false }
        this.log('penalty', sp.teamSide, `${taker.name} 主罚点球。`, { playerId: taker.id })
        entry = this.resolveShot(taker, team, opp, { point: taker, header: false, penalty: true, freeKick: false })
      }
      time = 10
    }
    this.advanceClock(time)
    this.addPossessionTime(sp.teamSide, time)
    this.advancePlayerMinutes(time)
    if (this.state.pendingSetPiece) this.state.phase = 'setpiece'
    return entry
  }

  private prepareCorner(team: MatchTeamState, opp: MatchTeamState, sp: SetPieceState): void {
    const attacking = team.players
      .filter((player) => player.onPitch && player.position !== 'GK')
      .sort((a, b) => b.attrs.heading - a.attrs.heading)
    const defenders = opp.players
      .filter((player) => player.onPitch && player.position !== 'GK')
      .sort((a, b) => b.attrs.heading - a.attrs.heading)
    const gx = goalXOf(team.side)
    const dir = dirOf(team.side)
    attacking.slice(0, 3).forEach((player, index) => {
      player.x = clamp(gx - dir * (7 + index * 2), 4, PITCH_LENGTH - 4)
      player.y = clamp(GOAL_Y + (index - 1) * 7, 20, 44)
    })
    defenders.slice(0, 4).forEach((player, index) => {
      player.x = clamp(gx - dir * (3 + index * 1.5), 3, PITCH_LENGTH - 3)
      player.y = clamp(GOAL_Y + (index - 1.5) * 6, 22, 42)
    })
    const gk = this.teamGoalkeeper(opp)
    if (gk) {
      gk.x = gx - dir * 1
      gk.y = GOAL_Y
    }
    sp.x = gx - dir * 1.5
    sp.y = sp.y < GOAL_Y ? 2 : PITCH_WIDTH - 2
  }

  private pickTaker(team: MatchTeamState, mode: 'pass' | 'cross' | 'shoot', x: number, y: number): MatchPlayerState | null {
    const players = team.players.filter((player) => player.onPitch && player.position !== 'GK')
    if (players.length === 0) return null
    const scored = players.map((player) => {
      let score = mode === 'shoot' ? player.attrs.shooting * 0.6 + player.attrs.composure * 0.4 : player.attrs.passing * 0.7 + player.attrs.vision * 0.3
      if (mode === 'cross') score += player.attrs.passing * 0.2
      score -= distance(player, { x, y }) * 0.2
      return { player, score }
    })
    scored.sort((a, b) => b.score - a.score)
    return scored[0]?.player ?? null
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
    this.state.ball = { x: clamp(x, 1, PITCH_LENGTH - 1), y: clamp(y, 1, PITCH_WIDTH - 1), ownerId: null, justReceived: false }
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
      if (this.knockout && this.state.score.home === this.state.score.away) this.startShootout()
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
    this.log('info', 'none', '常规时间结束，双方战平，比赛进入点球大战。', {})
  }

  private advanceShootout(): void {
    const state = this.state.shootout!
    const side = state.current
    const team = this.getTeam(side)
    const gk = this.teamGoalkeeper(this.getOpponent(side))
    const takers = team.players.filter((player) => player.onPitch && player.position !== 'GK')
      .sort((a, b) => (this.eff(b, 'shooting') + this.eff(b, 'composure')) - (this.eff(a, 'shooting') + this.eff(a, 'composure')))
    const index = side === 'home' ? state.attemptsHome : state.attemptsAway
    const taker = takers[index % takers.length]
    if (!taker) {
      state.finished = true
      this.finishMatch('点球大战结束。')
      return
    }
    const takerScore = this.eff(taker, 'shooting') * 0.6 + this.eff(taker, 'composure') * 0.4
    const gkScore = gk ? this.eff(gk, 'reflexes') * 0.6 + this.eff(gk, 'oneOnOne') * 0.4 + (gk.skills.includes('gk_reflexes') ? 5 * skillTierMultiplier(gk, 'gk_reflexes') : 0) : 50
    let p = clamp(0.7 + (takerScore - 60) / 250 - (gkScore - 55) / 400, 0.5, 0.9)
    if (taker.skills.includes('penalty_specialist')) p += 0.06 * skillTierMultiplier(taker, 'penalty_specialist')
    if (gk?.skills.includes('sweeper')) p -= 0.015 * skillTierMultiplier(gk, 'sweeper')
    p = clamp(p, 0.45, 0.92)
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
    const days = injuryRecoveryDays(rng, false)
    if (!player.skills.includes('injury_resilience')) return days
    const silverDays = Math.max(1, Math.ceil(days * 0.7))
    return Math.max(1, Math.ceil(days - (days - silverDays) * skillTierMultiplier(player, 'injury_resilience')))
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

  private book(team: MatchTeamState, player: MatchPlayerState): 'yellow' | 'red' | null {
    if (player.sentOff) return null
    const rng = derivedRng(this.state.seed, 'card', this.state.step, player.id)
    const straight = rng.chance(0.012)
    const yellow = straight ? false : rng.chance(0.17)
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
    const personId = player.personId ?? player.sourceId
    const prone = injuryProneness(personId)
    const fatigue = clamp(1 - player.stamina / Math.max(1, player.maxStamina), 0, 1)
    const baseRisk = injuryRisk(prone, fatigue, false)
    const risk = player.skills.includes('injury_prevention')
      ? baseRisk - (baseRisk - injuryRisk(prone, fatigue, true)) * skillTierMultiplier(player, 'injury_prevention')
      : baseRisk
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
          if (team.subsUsed >= 3) break
          replace(out, 'injury')
        }
      }
      plan.timed = plan.timed.filter(rule => {
        const displayAt = autoSubDisplaySeconds(rule)
        const atLogic = this.durationSeconds > 0 ? (displayAt / 5400) * this.durationSeconds : 0
        if (atLogic > this.state.clock) return true
        const out = team.players.find(p => p.sourceId === rule.outId && p.onPitch)
        const incoming = team.bench.find(p => p.sourceId === rule.inId && !p.cameOff && !p.onPitch)
        if (!out || !incoming || incoming.injured || team.subsUsed >= 3 || incoming.positions[out.position] <= 0) return false
        return !this.substitute(out.id, incoming.id, team.side, this.state.clock, 'timed').ok
      })
      if (plan.staminaBelow !== null) {
        for (const out of team.players.filter(p => p.onPitch && p.stamina / p.maxStamina * 100 < plan.staminaBelow!).sort((a, b) => a.stamina / a.maxStamina - b.stamina / b.maxStamina)) {
          if (team.subsUsed >= 3) break
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
    if (team.subsUsed >= 3) return { ok: false, error: '已经用完 3 次换人' }
    const outIndex = team.players.findIndex((player) => player.id === outId && player.onPitch)
    if (outIndex < 0) return { ok: false, error: '被换下的球员不在场上' }
    const inPlayer = team.bench.find((player) => player.id === inId && !player.cameOff && !player.onPitch)
    if (!inPlayer) return { ok: false, error: '替补球员不可用' }
    const out = team.players[outIndex]
    if (inPlayer.positions[out.position] <= 0) return { ok: false, error: `${inPlayer.name} 尚未学会 ${out.position}，不能替换到该位置` }
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
