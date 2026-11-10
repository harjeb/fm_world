/**
 * 新比赛引擎的对外入口（docs/pes2d-migration-plan.md 阶段 3）：
 * 给两支 `MatchTeamInput`（和现有 `MatchEngine` 同一种输入），建好物理比赛 + 结算模型，跑完整场，
 * 并给出和现有引擎同一种类型的结果状态（`MatchState`：比分、球员和球队统计、技能计数、伤病记录）。
 *
 * 物理比赛（pes2d）负责球员怎么跑、球怎么飞；每个接触点的成败由现有引擎的概率模型按真实属性裁决（`PesSettlement`）。
 * 点球大战不进 2D，沿用现有引擎的纯结算（`SettlementKernel.shootoutOrder / shootoutKickOdds`）。
 */
import { ROLES } from '../data/roles.ts'
import { MAX_SUBS, customSpotFor } from '../squad.ts'
import { MATCH_MENTALITY_LABELS, MATCH_TACTICS, autoSubDisplaySeconds } from '../match/management.ts'
import { inBox, progressOf, wideZone } from '../match/pitch.ts'
import { opponentSide, PITCH_LENGTH, PITCH_WIDTH } from '../match/team.ts'
import { LOGIC_MATCH_SECONDS } from '../match/time.ts'
import { needsShootout } from '../match/knockout.ts'
import type { MatchMentality, Tactics } from '../types.ts'
import type { MatchPlayerState, MatchSide, MatchState, MatchTeamInput, MatchTeamState } from '../match/types.ts'
import { MotionRatings } from './ability.ts'
import { formationRows } from './formation.ts'
import { PesSettlement, type PesSettlementJSON } from './settle.ts'
import { PesMatch, type PesTeamInit } from './sim.ts'
import { GAME_RULES, makeGamePitch, type PesEvent, type PesMatchSnapshot, type PesRules, type PesTactics, type PitchSpec } from './spec.ts'

function motionAbilities(player: MatchPlayerState, ratings: MotionRatings) {
  return ratings.abilities(player, {
    wide: wideZone(player),
    finalThird: progressOf(player.side, player.x) > 0.65,
    inBox: inBox(player.side, player),
  })
}

function refreshMotionAbilities(m: PesMatch, settlement: PesSettlement): void {
  const g = settlement.game
  // Time/score/roster can change without a contact (and hence without a new g.step).
  delete g.teamTraitStep
  const ratings = new MotionRatings(() => g, () => g.durationSeconds)
  const flip = m.teams[0].dir < 0 ? -1 : 1
  for (const team of m.teams) for (const q of team.players) {
    const player = settlement.gamePlayer(q.pid)
    q.ab = motionAbilities({
      ...player,
      x: (q.pos.x * flip + m.spec.HL) * PITCH_LENGTH / m.spec.L,
      y: (q.pos.y * flip + m.spec.HW) * PITCH_WIDTH / m.spec.W,
      stamina: q.stamina * player.maxStamina,
    }, ratings)
  }
}

/** Observe injury events after settlement has marked every card of the same person. */
class MotionSettlement extends PesSettlement {
  override onEvent(m: PesMatch, e: PesEvent): void {
    super.onEvent(m, e)
    if (e.type === 'injury') refreshMotionAbilities(m, this)
  }
}

/** 我们的 5 个战术枚举 → pes2d 滑杆（计划 5.1）。 */
export function tacticsOf(tactics: Tactics): PesTactics {
  const press = { low: 0.25, mid: 0.5, high: 0.8 }[tactics.press]
  return {
    width: { middle: 0.3, balanced: 0.5, wing: 0.75 }[tactics.attack],
    direct: { short: 0.2, mixed: 0.5, direct: 0.85 }[tactics.passing],
    tempo: { slow: 0.25, normal: 0.5, fast: 0.8 }[tactics.tempo],
    line: { low: 0.2, mid: 0.5, high: 0.8 }[tactics.line],
    press,
    aggression: 0.35 + 0.3 * press,
  }
}

export interface PesGameOptions {
  seed: number
  home: MatchTeamInput
  away: MatchTeamInput
  /** 淘汰赛：常规时间踢平后点球大战 */
  knockout?: boolean
  shootoutOffset?: { home: number; away: number }
  /** 整场模拟时长 D（秒），默认 900（15 个足球分钟，显示为 90 分钟） */
  durationSeconds?: number
  /** 越位规则，默认不开（和现有引擎一致） */
  offside?: boolean
  /** 赛前伤病、当前时间 */
  injuries?: Parameters<typeof import('../injury.ts').prepareMatchInjuries>[1]
  /** 挑战赛：不生成新的伤病。 */
  noInjuries?: boolean
  now?: number
  recordHz?: number
  /** 覆盖默认的 GAME_RULES */
  rules?: Partial<PesRules>
  /** 场地；默认 11 人制的游戏场地（makeGamePitch） */
  spec?: PitchSpec
}

function pesTeam(input: MatchTeamInput, team: MatchTeamState, ratings: MotionRatings): PesTeamInit {
  const custom: Record<string, { x: number; y: number }> = {}
  for (const starter of input.starters) {
    const spot = customSpotFor(starter.player)
    if (spot) custom[starter.slotId] = spot
  }
  const rows = formationRows(input.formationId, custom)
  return {
    tactics: tacticsOf(input.tactics),
    players: rows.map((row) => {
      const player = team.players.find((item) => item.slotId === row.slotId)
      if (!player) throw new Error(`阵容缺少位置 ${row.slotId}`)
      return {
        name: player.name,
        role: row.role,
        nx: row.nx,
        ny: row.ny,
        line: row.line,
        abilities: motionAbilities(player, ratings),
        num: player.number,
        stamina: player.stamina / Math.max(1, player.maxStamina),
        ref: player.id,
      }
    }),
  }
}

export class PesGame {
  readonly match: PesMatch
  readonly settlement: PesSettlement

  constructor(source: PesGameOptions | { snapshot: PesMatchSnapshot }) {
    if ('snapshot' in source) {
      this.settlement = new MotionSettlement(source.snapshot.contact as PesSettlementJSON)
      this.match = PesMatch.restore(source.snapshot, { contact: this.settlement })
      return
    }
    const duration = source.durationSeconds ?? LOGIC_MATCH_SECONDS
    this.settlement = new MotionSettlement({
      seed: source.seed,
      home: source.home,
      away: source.away,
      knockout: source.knockout ?? false,
      durationSeconds: duration,
      offside: source.offside ?? false,
      injuries: source.injuries,
      noInjuries: source.noInjuries,
      now: source.now,
    })
    const game = this.settlement.game
    if (source.shootoutOffset) game.shootoutOffset = { ...source.shootoutOffset }
    const ratings = new MotionRatings(() => game, () => game.durationSeconds)
    this.match = new PesMatch({
      spec: source.spec ?? makeGamePitch(duration),
      seed: source.seed,
      home: pesTeam(source.home, game.teams[0], ratings),
      away: pesTeam(source.away, game.teams[1], ratings),
      recordHz: source.recordHz,
      rules: { ...GAME_RULES, offside: source.offside ?? false, ...source.rules },
      contact: this.settlement,
    })
    // Kickoff placement may differ from the lineup's nominal coordinates.
    refreshMotionAbilities(this.match, this.settlement)
    this.settlement.markStarters(this.match)
    this.settlement.note('kickoff', 'none', `${game.teams[0].name} 对 ${game.teams[1].name}，比赛开始。`, {}, 0)
  }

  static restore(snapshot: PesMatchSnapshot): PesGame {
    return new PesGame({ snapshot })
  }

  /** 完整存档（纯数据，可直接 JSON.stringify）。 */
  serialize(): PesMatchSnapshot {
    return this.match.serialize()
  }

  /** 游戏层的比赛状态（比分、统计、技能计数、伤病记录……），和现有引擎同一种类型。 */
  get state(): MatchState {
    return this.settlement.game
  }

  get finished(): boolean {
    return this.state.finished
  }

  step(): void {
    const m = this.match
    if (m.phase === 'end') return
    const second = Math.floor(m.time)
    m.step()
    const g = this.state
    g.clock = m.time
    g.half = m.half
    // 每个模拟秒：自动换人、同步游戏层物理量、刷新运动能力的时钟 / 比分 / 空间上下文。
    // 用“这一步跨过了整数秒”判断，不需要额外状态，读档后行为一致
    if (Math.floor(m.time) !== second) {
      this.applyAutoSubs()
      this.syncLive()
      refreshMotionAbilities(m, this.settlement)
    }
    if (m.finished) this.afterRegulation()
  }

  advance(seconds: number): void {
    const n = Math.max(1, Math.round(seconds / this.match.spec.DT))
    for (let i = 0; i < n; i++) this.step()
  }

  /** 跑到终场（淘汰赛踢平会接着点球大战）。 */
  run(): MatchState {
    while (!this.state.finished) this.step()
    return this.state
  }

  /** 比赛进行中，把物理量同步到游戏层：比分、控球秒数、体力。 */
  private syncLive(): void {
    const g = this.state
    const m = this.match
    g.score.home = m.teams[0].score
    g.score.away = m.teams[1].score
    g.stats.home.possession = m.teams[0].stats.possession
    g.stats.away.possession = m.teams[1].stats.possession
    for (const t of m.teams) {
      for (const q of t.players) {
        const player = this.settlement.gamePlayer(q.pid)
        player.stamina = q.stamina * player.maxStamina
        player.stats.staminaLeft = Math.round(q.stamina * 100)
      }
    }
  }

  private afterRegulation(): void {
    const g = this.state
    if (g.finished) return
    this.settlement.finalize(this.match)
    if (needsShootout(this.settlement.knockout, g.score, g.shootoutOffset)) {
      this.settlement.note('info', 'none', g.shootoutOffset ? '两回合总比分战平，进入点球大战（不计客场进球）。' : '常规时间结束，双方战平，比赛进入点球大战。', {}, g.durationSeconds)
      this.shootout()
    }
    g.finished = true
    g.phase = 'finished'
    g.half = 2
    g.clock = g.durationSeconds
    const shootoutText = g.shootout ? `点球大战 ${g.shootout.home} : ${g.shootout.away}。` : ''
    this.settlement.note('full', 'none', `全场结束。 ${shootoutText}比分 ${g.score.home} : ${g.score.away}。`, {}, g.durationSeconds)
  }

  /* ---------- 点球大战（不进 2D，沿用现有引擎的纯结算） ---------- */
  private shootout(): void {
    const g = this.state
    const kernel = this.settlement.settlementKernel
    const state = { home: 0, away: 0, attemptsHome: 0, attemptsAway: 0, current: 'home' as MatchSide, suddenDeath: false, finished: false }
    g.shootout = state
    g.phase = 'shootout'
    while (!state.finished) {
      const side = state.current
      const team = g.teams[side === 'home' ? 0 : 1]
      const opp = g.teams[side === 'home' ? 1 : 0]
      const gk = kernel.teamGoalkeeper(opp)
      const takers = kernel.shootoutOrder(team)
      const index = side === 'home' ? state.attemptsHome : state.attemptsAway
      const taker = takers[index % takers.length]
      if (!taker) {
        state.finished = true
        break
      }
      const p = kernel.shootoutKickOdds(taker, gk)
      const goal = this.match.rng.float() < p
      if (goal) state[side]++
      if (side === 'home') state.attemptsHome++
      else state.attemptsAway++
      this.settlement.note('penalty', side, `${team.name} ${taker.name} 主罚${goal ? '命中' : '罚失'}（点球大战 ${state.home} : ${state.away}）。`, { playerId: taker.id }, g.durationSeconds)
      state.suddenDeath = state.attemptsHome >= 5 && state.attemptsAway >= 5
      const remainingHome = Math.max(0, 5 - state.attemptsHome)
      const remainingAway = Math.max(0, 5 - state.attemptsAway)
      state.finished = state.suddenDeath
        ? state.attemptsHome === state.attemptsAway && state.home !== state.away
        : state.home > state.away + remainingAway || state.away > state.home + remainingHome
      state.current = opponentSide(side)
    }
  }

  /* ---------- 换人 / 战术 ---------- */
  availableBench(side: MatchSide): MatchPlayerState[] {
    return this.state.teams[side === 'home' ? 0 : 1].bench.filter((player) => !player.cameOff && !player.onPitch)
  }

  substitute(outId: string, inId: string, side: MatchSide = 'home', autoReason?: 'injury' | 'timed' | 'stamina', at?: number): { ok: boolean; error?: string } {
    const g = this.state
    if (g.finished) return { ok: false, error: '比赛已经结束' }
    const team = g.teams[side === 'home' ? 0 : 1]
    if (team.subsUsed >= MAX_SUBS) return { ok: false, error: `已经用完 ${MAX_SUBS} 次换人` }
    const outIndex = team.players.findIndex((player) => player.id === outId && player.onPitch)
    if (outIndex < 0) return { ok: false, error: '被换下的球员不在场上' }
    const inPlayer = team.bench.find((player) => player.id === inId && !player.cameOff && !player.onPitch)
    if (!inPlayer) return { ok: false, error: '替补球员不可用' }
    const out = team.players[outIndex]
    if (ROLES[out.role].position !== out.position) return { ok: false, error: '职责与位置不匹配' }
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
    const outPid = this.settlement.pidFor(out.id)
    // 先改游戏层，再让物理比赛里的位置换人；新球员拿新的 pid
    team.players[outIndex] = incoming
    team.bench = team.bench.filter((player) => player.id !== inId)
    team.bench.push(outgoing)
    team.subsUsed++
    g.instructions.push({ step: g.step, kind: 'sub', outId, inId, ...(autoReason ? { autoReason } : {}) })
    this.settlement.unbind(out)
    this.settlement.bind(outPid, outgoing)
    const physical = this.match.substitute(outPid, {
      name: incoming.name,
      abilities: motionAbilities(incoming, new MotionRatings(() => g, () => g.durationSeconds)),
      stamina: incoming.stamina / Math.max(1, incoming.maxStamina),
      ref: incoming.id,
      num: incoming.number,
    })
    this.settlement.bind(physical.pid, incoming)
    this.settlement.markLeft(outPid, this.match.time)
    this.settlement.markJoined(physical.pid, this.match.time)
    refreshMotionAbilities(this.match, this.settlement)
    const reason = autoReason ? `自动换人（${{ injury: '受伤', timed: '定时', stamina: '体力' }[autoReason]}）` : '换人'
    this.settlement.note('sub', side, `${reason}：${incoming.name} 换下 ${out.name}。`, { playerId: incoming.id }, at ?? this.match.time)
    return { ok: true }
  }

  setTactics(mentality: MatchMentality, side: MatchSide = 'home', at?: number): { ok: boolean; error?: string } {
    const g = this.state
    if (g.finished) return { ok: false, error: '比赛已经结束' }
    if (mentality !== 'attack' && mentality !== 'balanced' && mentality !== 'defend') return { ok: false, error: '无效的比赛心态' }
    const tactics = MATCH_TACTICS[mentality]
    const team = g.teams[side === 'home' ? 0 : 1]
    team.tactics = { ...tactics }
    team.mentality = mentality
    this.match.teams[side === 'home' ? 0 : 1].tactics = tacticsOf(tactics)
    g.instructions.push({ step: g.step, kind: 'tactic', mentality, tactics: { ...tactics } })
    this.settlement.note('tactic', side, `教练调整战术：${MATCH_MENTALITY_LABELS[mentality]}。`, {}, at ?? this.match.time)
    return { ok: true }
  }

  /** 自动换人计划（受伤 / 定时 / 体力），每个模拟秒检查一次。移植自现有引擎的 `applyAutoSubs`。 */
  private applyAutoSubs(): void {
    const g = this.state
    for (const team of g.teams) {
      const plan = team.autoSubs
      if (!plan) continue
      const replace = (out: MatchPlayerState, reason: 'injury' | 'stamina'): boolean => {
        const incoming = this.availableBench(team.side).filter((p) => !p.injured && p.positions[out.position] > 0
          && (reason !== 'stamina' || p.stamina / Math.max(1, p.maxStamina) * 100 >= plan.staminaBelow!))
          .sort((a, b) => b.positions[out.position] - a.positions[out.position])[0]
        return !!incoming && this.substitute(out.id, incoming.id, team.side, reason).ok
      }
      this.syncStamina(team)
      if (plan.onInjury) {
        for (const out of team.players.filter((p) => p.onPitch && p.injured).sort((a, b) => a.stamina / a.maxStamina - b.stamina / b.maxStamina)) {
          if (team.subsUsed >= MAX_SUBS) break
          replace(out, 'injury')
        }
      }
      plan.timed = plan.timed.filter((rule) => {
        const displayAt = autoSubDisplaySeconds(rule)
        const atLogic = g.durationSeconds > 0 ? (displayAt / 5400) * g.durationSeconds : 0
        if (atLogic > this.match.time) return true
        const out = team.players.find((p) => p.sourceId === rule.outId && p.onPitch)
        const incoming = team.bench.find((p) => p.sourceId === rule.inId && !p.cameOff && !p.onPitch)
        if (!out || !incoming || incoming.injured || team.subsUsed >= MAX_SUBS) return false
        return !this.substitute(out.id, incoming.id, team.side, 'timed').ok
      })
      if (plan.staminaBelow !== null) {
        for (const out of team.players.filter((p) => p.onPitch && p.stamina / p.maxStamina * 100 < plan.staminaBelow!).sort((a, b) => a.stamina / a.maxStamina - b.stamina / b.maxStamina)) {
          if (team.subsUsed >= MAX_SUBS) break
          replace(out, 'stamina')
        }
      }
    }
  }

  /** 把物理比赛里的体力同步到游戏层（体力阈值换人要看最新体力）。 */
  private syncStamina(team: MatchTeamState): void {
    const ti = team.side === 'home' ? 0 : 1
    for (const q of this.match.teams[ti].players) {
      const player = this.settlement.gamePlayer(q.pid)
      player.stamina = q.stamina * player.maxStamina
    }
  }
}
