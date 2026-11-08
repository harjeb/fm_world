/**
 * 新比赛引擎的对外入口（docs/pes2d-migration-plan.md 阶段 3）：
 * 给两支 `MatchTeamInput`（和现有 `MatchEngine` 同一种输入），建好物理比赛 + 结算模型，跑完整场，
 * 并给出和现有引擎同一种类型的结果状态（`MatchState`：比分、球员和球队统计、技能计数、伤病记录）。
 *
 * 物理比赛（pes2d）负责球员怎么跑、球怎么飞；每个接触点的成败由现有引擎的概率模型按真实属性裁决（`PesSettlement`）。
 * 点球大战不进 2D，沿用现有引擎的纯结算（`SettlementKernel.shootoutOrder / shootoutKickOdds`）。
 */
import { ROLES } from '../data/roles.ts'
import { customSpotFor } from '../squad.ts'
import { MATCH_TACTICS, autoSubDisplaySeconds } from '../match/management.ts'
import { opponentSide } from '../match/team.ts'
import { LOGIC_MATCH_SECONDS } from '../match/time.ts'
import type { MatchMentality, Tactics } from '../types.ts'
import type { MatchPlayerState, MatchSide, MatchState, MatchTeamInput, MatchTeamState } from '../match/types.ts'
import { abilityOf } from './ability.ts'
import { formationRows } from './formation.ts'
import { PesSettlement, type PesSettlementJSON } from './settle.ts'
import { PesMatch, type PesTeamInit } from './sim.ts'
import { GAME_RULES, makePitch7, type PesMatchSnapshot, type PesRules, type PesTactics, type PitchSpec } from './spec.ts'

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
  /** 整场模拟时长 D（秒），默认 900（15 个足球分钟，显示为 90 分钟） */
  durationSeconds?: number
  /** 越位规则，默认不开（和现有引擎一致） */
  offside?: boolean
  /** 赛前伤病、当前时间 */
  injuries?: Parameters<typeof import('../injury.ts').prepareMatchInjuries>[1]
  now?: number
  recordHz?: number
  /** 覆盖默认的 GAME_RULES */
  rules?: Partial<PesRules>
  /** 场地；默认 60×40 的 7 人制 */
  spec?: PitchSpec
}

function pesTeam(input: MatchTeamInput, team: MatchTeamState): PesTeamInit {
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
        abilities: abilityOf(player.attrs),
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
      this.settlement = new PesSettlement(source.snapshot.contact as PesSettlementJSON)
      this.match = PesMatch.restore(source.snapshot, { contact: this.settlement })
      return
    }
    const duration = source.durationSeconds ?? LOGIC_MATCH_SECONDS
    this.settlement = new PesSettlement({
      seed: source.seed,
      home: source.home,
      away: source.away,
      knockout: source.knockout ?? false,
      durationSeconds: duration,
      offside: source.offside ?? false,
      injuries: source.injuries,
      now: source.now,
    })
    const game = this.settlement.game
    this.match = new PesMatch({
      spec: source.spec ?? makePitch7(duration),
      seed: source.seed,
      home: pesTeam(source.home, game.teams[0]),
      away: pesTeam(source.away, game.teams[1]),
      recordHz: source.recordHz,
      rules: { ...GAME_RULES, offside: source.offside ?? false, ...source.rules },
      contact: this.settlement,
    })
    this.settlement.markStarters(this.match)
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
    // 自动换人每个模拟秒检查一次：用“这一步跨过了整数秒”判断，不需要额外状态，读档后行为一致
    if (Math.floor(m.time) !== second) this.applyAutoSubs()
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

  private afterRegulation(): void {
    const g = this.state
    if (g.finished) return
    this.settlement.finalize(this.match)
    if (this.settlement.knockout && g.score.home === g.score.away) this.shootout()
    g.finished = true
    g.phase = 'finished'
    g.half = 2
    g.clock = g.durationSeconds
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

  substitute(outId: string, inId: string, side: MatchSide = 'home', autoReason?: 'injury' | 'timed' | 'stamina'): { ok: boolean; error?: string } {
    const g = this.state
    if (g.finished) return { ok: false, error: '比赛已经结束' }
    const team = g.teams[side === 'home' ? 0 : 1]
    if (team.subsUsed >= 3) return { ok: false, error: '已经用完 3 次换人' }
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
      abilities: abilityOf(incoming.attrs),
      stamina: incoming.stamina / Math.max(1, incoming.maxStamina),
      ref: incoming.id,
      num: incoming.number,
    })
    this.settlement.bind(physical.pid, incoming)
    this.settlement.markLeft(outPid, this.match.time)
    this.settlement.markJoined(physical.pid, this.match.time)
    return { ok: true }
  }

  setTactics(mentality: MatchMentality, side: MatchSide = 'home'): { ok: boolean; error?: string } {
    const g = this.state
    if (g.finished) return { ok: false, error: '比赛已经结束' }
    if (mentality !== 'attack' && mentality !== 'balanced' && mentality !== 'defend') return { ok: false, error: '无效的比赛心态' }
    const tactics = MATCH_TACTICS[mentality]
    const team = g.teams[side === 'home' ? 0 : 1]
    team.tactics = { ...tactics }
    team.mentality = mentality
    this.match.teams[side === 'home' ? 0 : 1].tactics = tacticsOf(tactics)
    g.instructions.push({ step: g.step, kind: 'tactic', mentality, tactics: { ...tactics } })
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
          if (team.subsUsed >= 3) break
          replace(out, 'injury')
        }
      }
      plan.timed = plan.timed.filter((rule) => {
        const displayAt = autoSubDisplaySeconds(rule)
        const atLogic = g.durationSeconds > 0 ? (displayAt / 5400) * g.durationSeconds : 0
        if (atLogic > this.match.time) return true
        const out = team.players.find((p) => p.sourceId === rule.outId && p.onPitch)
        const incoming = team.bench.find((p) => p.sourceId === rule.inId && !p.cameOff && !p.onPitch)
        if (!out || !incoming || incoming.injured || team.subsUsed >= 3) return false
        return !this.substitute(out.id, incoming.id, team.side, 'timed').ok
      })
      if (plan.staminaBelow !== null) {
        for (const out of team.players.filter((p) => p.onPitch && p.stamina / p.maxStamina * 100 < plan.staminaBelow!).sort((a, b) => a.stamina / a.maxStamina - b.stamina / b.maxStamina)) {
          if (team.subsUsed >= 3) break
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
