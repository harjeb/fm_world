/**
 * PES2D 比赛内核的 TypeScript 版（docs/pes2d-migration-plan.md 阶段 2）。
 *
 * 来源：F:\FIFA_test\pes2d\sim.js（`finish-v3`）。移植时遵守的原则：
 *   1. **行为逐位一致**：同一份输入、同一个随机数序列，每一帧的球员和球的位置都与原版一致
 *      （scripts/pes-diff.ts 用原版做差分对照）。所以表达式的写法、遍历顺序、随机数抽取顺序都保持原样；
 *   2. 比赛状态是**纯数据**（见 spec.ts），可以 JSON 存档，读档后继续跑与不间断运行逐位一致；
 *   3. 随机数走注入的发生器（默认 PCG32，状态可取出），不再使用 Math.random；
 *   4. 场地和时长参数化（PitchSpec）：7 人制 60×40 米、整场 D 秒；战术距离乘 `K = L / 105`（计划 6.4）；
 *   5. 只修已确认的规则缺陷（计划 6.7）：出界归属写反两处、射正统计把打高的球算进去。
 *
 * 分层：
 *   1) 决策 Decision   每 0.15~0.45s 重新评估（含个人反应延迟）
 *   2) 目标 Target     阵型区域 + 战术滑杆 + 盯人 / 逼抢任务 -> 目标点
 *   3) 运动 Motion     加速度上限 / 最大速度 / 到达减速 / 分离力
 *   4) 球物理 Ball     滚动阻力、空气阻力、重力、弹跳、旋转
 *   5) 规则 Rules      出界、角球、球门球、越位、进球、半场
 *
 * 本阶段**不接结算内核**：传球、射门、抢断的成败仍由 pes2d 自己的几何与概率决定（自由运行）。阶段 3 才把接触点交给 resolution.ts。
 */
import { derivedRng, PCG32 } from '../rng.ts'
import type { ContactModel, PassKind, PassVerdict, ShotRequest, ShotVerdict } from './contact.ts'
import { MatchMetrics } from './metrics.ts'
import {
  DEFAULT_PARAMS,
  execution,
  INSTRUCTION_DIFFICULTY,
  triOf,
  type TacticalInstructionsV2,
  type TacticsParams,
} from './tactics.ts'
import {
  DEFAULT_TACTICS,
  emptyStats,
  makePitch7,
  NATIVE_RULES,
  type Abilities,
  type BallMeta,
  type PesBall,
  type PesEvent,
  type PesEventType,
  type PesFrame,
  type PesMatchSnapshot,
  type PesOpenPlayState,
  type PesPhase,
  type PesPlayer,
  type PesRestart,
  type PesRules,
  type PesSetPiece,
  type PesTactics,
  type PesTeam,
  type PitchSpec,
  type RestartType,
  type RngState,
  type TeamIndex,
  type Vec2,
} from './spec.ts'

/** 任意球离球门多远（现有引擎的 100 长球场单位）以内直接射门 / 传中禁区，同 match/resolution.ts。 */
const FREE_KICK_SHOT_RANGE = 35
const FREE_KICK_DELIVERY_RANGE = 50

/* ------------------------------ 工具 ------------------------------ */
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
const clamp01 = (v: number): number => clamp(v, 0, 1)
const len = (x: number, y: number): number => Math.hypot(x, y)
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)
const dist2 = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const norm = (x: number, y: number): Vec2 => {
  const l = Math.hypot(x, y) || 1
  return { x: x / l, y: y / l }
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax
  const vy = by - ay
  const wx = px - ax
  const wy = py - ay
  const vv = vx * vx + vy * vy
  let t = vv > 1e-9 ? (wx * vx + wy * vy) / vv : 0
  t = clamp01(t)
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t))
}

/* ------------------------------ 输入 ------------------------------ */
export interface PesPlayerInit {
  name: string
  role: string
  /** 阵型锚点：纵深 nx（0 = 本方球门线，1 = 对方球门线）、横向 ny（0 = 左，1 = 右） */
  nx: number
  ny: number
  /** 线位：0 后卫 ~ 1 前锋 */
  line: number
  abilities: Abilities
  /** 球衣号，默认队内序号 + 1 */
  num?: number
  /** 开场体力 0–1，默认 1（计划 4.4：由球员 condition 换算） */
  stamina?: number
  /** 调用方自己的球员 id，引擎原样带着不使用 */
  ref?: string
  /** 战术熟练度 0–1；缺省 1（只在新指令下生效）。 */
  familiarity?: number
}

export interface PesTeamInit {
  /** 第 0 个必须是门将 */
  players: PesPlayerInit[]
  tactics?: Partial<PesTactics>
}

/** 随机数发生器：状态要能取出来写进存档。PCG32 满足它。 */
export interface PesRng {
  float(): number
  toJSON(): RngState
}

export interface PesMatchInit {
  spec?: PitchSpec
  /** 默认 PCG32 的种子；也可以直接给 `rng`（差分测试用） */
  seed?: number
  rng?: PesRng
  home: PesTeamInit
  away: PesTeamInit
  /** 录像帧率（每秒几帧），0 或不给 = 不录 */
  recordHz?: number
  /** 玩法规则开关；不给 = pes2d 原版行为 */
  rules?: Partial<PesRules>
  /** 接触点结算模型；不给 = pes2d 原版的几何结算 */
  contact?: ContactModel
  /** 打开战术实验埋点（默认关闭；只观察，不改行为、不消耗随机数） */
  metrics?: boolean
  /** 覆盖新指令的实验参数 */
  tacticsParams?: Partial<TacticsParams>
}

export interface PesRestoreOptions {
  /** 用存档里的随机数状态重建发生器；默认 PCG32 */
  rngFactory?: (state: RngState) => PesRng
  /** 已经按存档里的 `contact` 数据恢复好的结算模型 */
  contact?: ContactModel
}

interface FinishView {
  distance: number
  depth: number
  angle: number
  defenders: PesPlayer[]
  keeperDistance: number
  clear: boolean
}

type Choice =
  | { type: 'carry' | 'shoot' | 'clear'; score: number }
  | { type: 'pass'; score: number; mate: PesPlayer; target?: Vec2 }
  | { type: 'cross'; score: number; mate: PesPlayer; spot: Vec2 }

export class PesMatch {
  readonly spec: PitchSpec
  rules: PesRules
  contact: ContactModel | null = null
  rng: PesRng
  time = 0
  half: 1 | 2 = 1
  phase: PesPhase = 'kickoff'
  kickoffTi: TeamIndex | -1 = -1
  ball: PesBall
  teams: [PesTeam, PesTeam]
  /** 全场球员，下标 = pid */
  players: PesPlayer[]
  restart: PesRestart | null = null
  setPiece: PesSetPiece | null = null
  events: PesEvent[] = []
  /** 战术实验埋点（默认 null）。 */
  metrics: MatchMetrics | null = null
  /** 新指令参数（只在有球队给 `instructions` 时生效）。 */
  tacticsParams: TacticsParams = DEFAULT_PARAMS
  /** 上一帧确认控球的队伍（新指令的攻防转换窗口）。 */
  private lastPoss: TeamIndex | null = null
  /** 新开实验比赛启用；旧快照缺少 tacticsState 时保留其原行为。 */
  private tacticalMechanics = false
  /** 仅新指令使用：区分重开球首脚与稳定开放比赛。 */
  private openPlay: PesOpenPlayState = { phase: 'restartPending', restartType: 'kickoff', team: null, taker: -1, candidate: null, controlledFor: 0 }
  private metricsClosed = false
  /** 录像帧（输出，不进存档） */
  frames: PesFrame[] = []
  recordHz = 0
  frameAcc = 0

  constructor(source: PesMatchInit | PesMatchSnapshot, options: PesRestoreOptions = {}) {
    if ('version' in source) {
      const snap = structuredClone(source)
      this.spec = snap.spec
      this.rules = snap.rules
      this.tacticalMechanics = !!snap.tacticsState
      this.tacticsParams = snap.tacticsState?.params ?? DEFAULT_PARAMS
      this.lastPoss = snap.tacticsState?.lastPoss ?? null
      if (snap.tacticsState) this.openPlay = snap.tacticsState.openPlay
      this.setPiece = snap.setPiece
      this.rng = (options.rngFactory ?? ((state: RngState) => PCG32.fromState(state.state, state.inc)))(snap.rng)
      this.time = snap.time
      this.half = snap.half
      this.phase = snap.phase
      this.kickoffTi = snap.kickoffTi
      this.ball = snap.ball
      this.teams = snap.teams
      this.players = [...snap.teams[0].players, ...snap.teams[0].offPlayers, ...snap.teams[1].players, ...snap.teams[1].offPlayers].sort((a, c) => a.pid - c.pid)
      this.restart = snap.restart
      this.events = snap.events
      this.recordHz = snap.recordHz
      this.frameAcc = snap.frameAcc
      this.contact = options.contact ?? null
      this.contact?.attach(this)
      return
    }
    this.spec = source.spec ?? makePitch7()
    this.tacticalMechanics = !!source.home.tactics?.instructions || !!source.away.tactics?.instructions
    this.rules = { ...NATIVE_RULES, ...source.rules }
    this.tacticsParams = { ...DEFAULT_PARAMS, ...source.tacticsParams }
    this.rng = source.rng ?? derivedRng(source.seed ?? 12345, 'pes-match')
    this.recordHz = source.recordHz ?? 0
    const home = this.buildTeam(source.home, 0, 'home', 1, 0)
    const away = this.buildTeam(source.away, 1, 'away', -1, home.players.length)
    this.teams = [home, away]
    this.players = [...home.players, ...away.players]
    this.ball = {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0,
      owner: -1, frozen: true, lastTouch: -1, meta: null,
      looseT: 0, saveCd: 0,
    }
    this.setupKickoff(home)
    this.contact = source.contact ?? null
    this.contact?.attach(this)
    if (source.metrics) this.metrics = new MatchMetrics(this)
  }

  private buildTeam(init: PesTeamInit, ti: TeamIndex, side: 'home' | 'away', dir: 1 | -1, base: number): PesTeam {
    const P = this.spec
    const team: PesTeam = {
      side,
      dir,
      tactics: { ...DEFAULT_TACTICS, ...init.tactics },
      score: 0,
      stats: emptyStats(),
      players: [],
      offPlayers: [],
      presser: -1,
      cover: -1,
      marks: init.players.map(() => -1),
    }
    init.players.forEach((row, slot) => {
      const hx = (row.nx - 0.5) * P.L * dir
      const hy = (row.ny - 0.5) * P.W * dir
      team.players.push({
        pid: base + slot,
        ti,
        slot,
        name: row.name,
        ref: row.ref ?? '',
        role: row.role,
        num: Number.isFinite(row.num) ? (row.num as number) : slot + 1,
        hn: { x: row.nx, y: row.ny },
        line: row.line,
        ab: { ...row.abilities },
        pos: { x: hx, y: hy },
        vel: { x: 0, y: 0 },
        facing: { x: dir, y: 0 },
        target: { x: hx, y: hy },
        urgency: 0.3,
        stamina: row.stamina ?? 1,
        decideT: this.rng.float() * 0.2,
        stun: 0,
        noClaim: 0,
        tackleCd: 0,
        shotCd: 0,
        holdUntil: 0,
        mode: 'idle',
        runUntil: 0,
        runTarget: null,
        distance: 0,
        touches: 0,
        familiarity: row.familiarity,
      })
    })
    return team
  }

  /* ---------- 公共接口 ---------- */
  get finished(): boolean {
    return this.phase === 'end'
  }

  /** 新指令实验状态需要额外保存；旧 v4 / 旧 P1 快照继续使用原路径。 */
  get usesTacticalMechanics(): boolean {
    return this.tacticalMechanics
  }

  step(): void {
    if (this.phase === 'end' || this.phase === 'half') return
    const P = this.spec
    const dt = P.DT

    // Settled shots already emitted their verdict. At the whistle only finish
    // that flight: no decisions, tackles, claims or restarts may create play.
    if (this.contact && this.time >= P.HALF * this.half) {
      this.time = P.HALF * this.half
      this.finishHalfFlight()
      return
    }

    if (this.phase === 'kickoff' || this.phase === 'restart') this.updateRestart(dt)
    else this.time += dt

    if (this.contact && this.time >= P.HALF * this.half) {
      this.time = P.HALF * this.half
      this.finishHalfFlight()
      return
    }

    // 新指令的上抢任务在本帧决策期间也可能因出球或死球失效。
    const shapeBall = this.usesTacticalMechanics
      ? { owner: this.ball.owner, frozen: this.ball.frozen, possession: this.possessionTeam() }
      : null
    this.updateShape()

    for (const t of this.teams) {
      for (const p of t.players) {
        p.decideT -= dt
        p.stun = Math.max(0, p.stun - dt)
        p.noClaim = Math.max(0, p.noClaim - dt)
        p.tackleCd = Math.max(0, p.tackleCd - dt)
        p.shotCd = Math.max(0, p.shotCd - dt)
        if (p.decideT <= 0 && p.stun <= 0) {
          this.metrics?.decide(p, this.time)
          this.decide(p)
          p.decideT = this.reactionTime(p)
        }
      }
    }

    this.updateBall(dt)
    if (shapeBall && (shapeBall.owner !== this.ball.owner || shapeBall.frozen !== this.ball.frozen
      || shapeBall.possession !== this.possessionTeam())) this.clearInstructionShape()
    for (const t of this.teams) for (const p of t.players) this.move(p, dt)
    this.tryTackles()
    this.resolvePossession()
    this.updateOpenPlay(dt)
    this.updateTransitions()
    this.checkRules()
    if (shapeBall && (shapeBall.owner !== this.ball.owner || shapeBall.frozen !== this.ball.frozen
      || shapeBall.possession !== this.possessionTeam())) this.clearInstructionShape()
    this.collect(dt)

    if (this.half === 1 && this.time >= P.HALF) this.onHalfEnd()
    else if (this.half === 2 && this.time >= P.HALF * 2) this.onHalfEnd()
    if ((this.phase as PesPhase) === 'end' && this.metrics && !this.metricsClosed) {
      this.metrics.finish(this)
      this.metricsClosed = true
    }
  }

  advance(seconds: number): void {
    const n = Math.max(1, Math.round(seconds / this.spec.DT))
    for (let i = 0; i < n; i++) this.step()
  }

  /** 跑到终场。 */
  run(): void {
    while (this.phase !== 'end') this.step()
  }

  /** 完整存档（纯数据，可直接 JSON.stringify）。录像帧不在里面。 */
  serialize(): PesMatchSnapshot {
    return structuredClone({
      version: 1 as const,
      spec: this.spec,
      rules: this.rules,
      rng: this.rng.toJSON(),
      time: this.time,
      half: this.half,
      phase: this.phase,
      kickoffTi: this.kickoffTi,
      ball: this.ball,
      teams: this.teams,
      restart: this.restart,
      setPiece: this.setPiece,
      events: this.events,
      recordHz: this.recordHz,
      frameAcc: this.frameAcc,
      ...(this.usesTacticalMechanics ? {
        tacticsState: { lastPoss: this.lastPoss, params: this.tacticsParams, openPlay: this.openPlay },
      } : {}),
      contact: this.contact ? this.contact.toJSON() : null,
    })
  }

  static restore(snapshot: PesMatchSnapshot, options: PesRestoreOptions = {}): PesMatch {
    return new PesMatch(snapshot, options)
  }

  /* ---------- 小工具 ---------- */
  other(team: PesTeam): PesTeam {
    return team === this.teams[0] ? this.teams[1] : this.teams[0]
  }

  private tiOf(team: PesTeam): TeamIndex {
    return team === this.teams[0] ? 0 : 1
  }

  /** 本方球门中心 / 对方球门中心 */
  private goalOf(t: PesTeam): Vec2 {
    return { x: -t.dir * this.spec.HL, y: 0 }
  }

  private oppGoalOf(t: PesTeam): Vec2 {
    return { x: t.dir * this.spec.HL, y: 0 }
  }

  private homeWorld(p: PesPlayer): Vec2 {
    const d = this.teams[p.ti].dir
    return { x: (p.hn.x - 0.5) * this.spec.L * d, y: (p.hn.y - 0.5) * this.spec.W * d }
  }

  private maxSpeed(p: PesPlayer): number {
    const base = 5.0 + p.ab.pace * 3.6 // 5.0 ~ 8.6 m/s
    return base * (0.78 + 0.22 * p.stamina) // 体能折损
  }

  private maxAccel(p: PesPlayer): number {
    return 3.5 + p.ab.accel * 4.5 // 3.5 ~ 8.0 m/s²
  }

  private reactionTime(p: PesPlayer): number {
    const t = this.teams[p.ti]
    if (t.tactics.instructions) {
      const rawTempo = this.tacticsParams.tempoValue[t.tactics.instructions.possession.tempo]
      const effTempo = 0.5 + (rawTempo - 0.5) * execution(p.familiarity ?? 1, this.tacticsParams, INSTRUCTION_DIFFICULTY.tempo)
      const base = 0.29 - 0.16 * effTempo
      const skill = 0.13 * (1 - p.ab.positioning)
      return clamp(base + skill + this.rng.float() * 0.07, 0.09, 0.45)
    }
    const tempo = t.tactics.tempo
    const base = 0.26 - 0.1 * tempo
    const skill = 0.13 * (1 - p.ab.positioning)
    return clamp(base + skill + this.rng.float() * 0.07, 0.1, 0.45)
  }

  private event(type: PesEventType, ti: TeamIndex | -1, actors: number[] = [], xg?: number, meta?: Record<string, number | string | boolean>): void {
    const e: PesEvent = { t: this.time, type, ti, actors }
    if (xg !== undefined) e.xg = xg
    if (meta) e.meta = meta
    this.events.push(e)
    if (this.contact) this.contact.onEvent(this, e)
  }

  /** 球队的门将（红牌罚下后没有）。 */
  private keeperOf(t: PesTeam): PesPlayer | null {
    return t.players.find((q) => q.slot === 0) ?? null
  }

  /** 点球点离球门线的距离（按禁区深度缩放，11 人制是 11 / 16.5）。 */
  private penaltySpotDepth(): number {
    return this.spec.PEN_D * (11 / 16.5)
  }

  /** `pos` 是否在 `def` 这支球队的禁区里。 */
  private inBoxOf(def: PesTeam, pos: Vec2): boolean {
    const P = this.spec
    return Math.abs(pos.x) > P.HL - P.PEN_D && Math.abs(pos.y) < P.PEN_W / 2 && (pos.x > 0) === (def.dir < 0)
  }

  /* ---------- 出牌 / 离场 / 换人 ---------- */
  private showCard(player: PesPlayer, card: 'yellow' | 'red', second: boolean): void {
    this.event('card', player.ti, [player.pid], undefined, { color: card, second })
    if (card === 'red') this.sendOff(player)
  }

  /** 红牌罚下：移出场上名单（保留在 offPlayers 里，事件里的 pid 永远查得到人）。 */
  private sendOff(player: PesPlayer): void {
    const t = this.teams[player.ti]
    const index = t.players.indexOf(player)
    if (index < 0) return
    t.players.splice(index, 1)
    t.offPlayers.push(player)
    const b = this.ball
    if (b.owner === player.pid) {
      b.owner = -1
      b.vx = player.vel.x
      b.vy = player.vel.y
      b.meta = { type: 'loose', from: player.pid }
      b.looseT = 0
    }
    if (this.restart && this.restart.taker === player.pid) this.restart.taker = -1
    if (this.openPlay.taker === player.pid) this.openPlay.taker = -1
    this.removeInstructionShapeReferences(player)
  }

  /**
   * 换人：新球员接替 `pid` 的位置（坐标、速度、朝向、目标、职责都继承），拿到一个新的 pid。
   * 被换下的球员移到 offPlayers。返回新球员。
   */
  substitute(pid: number, incoming: Pick<PesPlayerInit, 'name' | 'abilities' | 'stamina' | 'ref' | 'num' | 'familiarity'>): PesPlayer {
    const out = this.players[pid]
    const t = this.teams[out.ti]
    const index = t.players.indexOf(out)
    if (index < 0) throw new Error(`球员 ${pid} 不在场上`)
    const hadInstructionTask = this.tacticalMechanics && !!t.tactics.instructions && this.instructionTaskKey(t, out) !== ''
    const nextFamiliarity = incoming.familiarity ?? (t.tactics.instructions ? this.teamFamiliarity(t) : out.familiarity)
    const inc: PesPlayer = {
      pid: this.players.length,
      ti: out.ti,
      slot: out.slot,
      name: incoming.name,
      ref: incoming.ref ?? '',
      role: out.role,
      num: Number.isFinite(incoming.num) ? (incoming.num as number) : out.num,
      hn: { ...out.hn },
      line: out.line,
      ab: { ...incoming.abilities },
      pos: { ...out.pos },
      vel: { ...out.vel },
      facing: { ...out.facing },
      target: { ...out.target },
      urgency: out.urgency,
      stamina: incoming.stamina ?? 1,
      decideT: out.decideT,
      stun: 0,
      noClaim: 0,
      tackleCd: 0,
      shotCd: 0,
      holdUntil: 0,
      mode: 'idle',
      runUntil: 0,
      runTarget: null,
      distance: 0,
      touches: 0,
      ...(nextFamiliarity !== undefined ? { familiarity: nextFamiliarity } : {}),
    }
    t.players[index] = inc
    t.offPlayers.push(out)
    this.players.push(inc)
    const b = this.ball
    if (b.owner === out.pid) b.owner = inc.pid
    // Live responsibilities follow the replacement; historical touches and event actors do not.
    if (b.meta?.intended === out.pid) b.meta.intended = inc.pid
    if (b.meta?.icpt === out.pid) b.meta.icpt = inc.pid
    if (this.restart && this.restart.taker === out.pid) this.restart.taker = inc.pid
    if (this.openPlay.taker === out.pid) this.openPlay.taker = inc.pid
    if (this.setPiece?.taker === out.pid) this.setPiece.taker = inc.pid
    this.removeInstructionShapeReferences(out)
    if (hadInstructionTask) this.refreshInstructionMovement(inc)
    this.event('sub', out.ti, [inc.pid, out.pid])
    return inc
  }

  /**
   * 一次犯规的后续：犯规 / 出牌 / 受伤事件，然后开任意球或点球。
   * `victim` 是被犯规的持球人；禁区内犯规判点球（`rules.penalties` 打开时）。
   */
  private awardFoul(def: PesPlayer, victim: PesPlayer, v: { card: 'yellow' | 'red' | null; second: boolean; injured: number; recoveryDays: number; p: number }): void {
    const defTeam = this.teams[def.ti]
    defTeam.stats.fouls++
    const penalty = this.rules.penalties && this.inBoxOf(defTeam, victim.pos)
    this.event('foul', def.ti, [def.pid, victim.pid], undefined, { penalty, p: Math.round(v.p * 1000) / 1000, x: Math.round(victim.pos.x * 100) / 100, y: Math.round(victim.pos.y * 100) / 100 })
    if (v.card) this.showCard(def, v.card, v.second)
    if (v.injured >= 0) this.event('injury', this.players[v.injured].ti, [v.injured], undefined, { days: v.recoveryDays })
    if (penalty) {
      const spot = { x: -defTeam.dir * (this.spec.HL - this.penaltySpotDepth()), y: 0 }
      this.setRestart('penalty', spot, this.teams[victim.ti])
    } else {
      this.setRestart('fk', { x: victim.pos.x, y: victim.pos.y }, this.teams[victim.ti])
    }
  }

  /* ---------- 开球 / 死球 ---------- */
  private setupKickoff(team: PesTeam): void {
    this.kickoffTi = this.tiOf(team)
    this.setPiece = null
    const b = this.ball
    b.owner = -1
    b.frozen = true
    b.x = 0
    b.y = 0
    b.z = 0
    b.vx = b.vy = b.vz = 0
    b.meta = null
    b.looseT = 0

    for (const t of this.teams) {
      for (const p of t.players) {
        const hw = this.homeWorld(p)
        p.pos.x = hw.x
        p.pos.y = hw.y
        p.vel.x = p.vel.y = 0
        p.target = { x: hw.x, y: hw.y }
        p.stun = 0
        p.mode = 'idle'
        p.runTarget = null
        p.runUntil = 0
      }
    }
    // 开球时所有人必须在本方半场
    for (const t of this.teams) {
      for (const p of t.players) {
        if (p.pos.x * t.dir > -1.2) p.pos.x = -1.2 * t.dir
      }
    }
    const takers = team.players.filter((p) => p.role !== 'GK' && p.line > 0.3 && p.line < 0.7)
    const taker = takers[0] || team.players[Math.min(5, team.players.length - 1)]
    taker.pos.x = -team.dir * 1.1
    taker.pos.y = 0.5
    this.restart = { type: 'kickoff', ti: this.kickoffTi, t: 0, taker: taker.pid, x: 0, y: 0 }
    this.beginOpenRestart('kickoff', this.tiOf(team), taker.pid)
    this.phase = 'kickoff'
    // 开球已经重置了全部移动目标，只需清掉新指令球队的旧任务表。
    if (this.usesTacticalMechanics) for (const t of this.teams) {
      if (!t.tactics.instructions) continue
      t.presser = -1
      t.presser2 = -1
      t.cover = -1
      t.marks.fill(-1)
    }
  }

  private updateRestart(dt: number): void {
    const r = this.restart
    if (!r) {
      this.phase = 'play'
      return
    }
    r.t += dt
    const b = this.ball
    b.frozen = true
    b.x = r.x
    b.y = r.y
    b.z = 0
    b.vx = b.vy = b.vz = 0

    const taker = r.taker >= 0 ? this.players[r.taker] : null
    if (taker) {
      const d = dist(taker.pos, b)
      taker.target = { x: b.x - this.teams[taker.ti].dir * 0.7, y: b.y }
      taker.urgency = d > 2.5 ? 0.9 : 0.5
      taker.mode = 'support'
      // 点球：留 2 秒让双方退出禁区，主罚人到位后才出脚
      const waitForPenalty = this.contact !== null && r.type === 'penalty'
      const ready = waitForPenalty ? ((d < 1.3 && r.t >= 2.2) || r.t > 5) : (d < 1.3 || r.t > 5)
      if (ready) {
        if (this.contact && r.type === 'corner') {
          this.cornerKick(taker)
          return
        }
        if (this.contact && r.type === 'penalty') {
          this.penaltyKick(taker)
          return
        }
        b.owner = taker.pid
        b.frozen = false
        b.lastTouch = taker.pid
        taker.noClaim = 0
        this.phase = 'play'
        this.restart = null
        // 任意球：发球人在接下来几秒内按定位球的规则出球（直接射门 / 传中 / 短传）
        if (this.contact && r.type === 'fk') this.setPiece = { type: 'fk', taker: taker.pid, until: this.time + 4 }
      }
    } else {
      // 没有发球人（场上没人了）：别让球一直冻着
      if (this.contact) b.frozen = false
      this.phase = 'play'
      this.restart = null
    }
  }

  /** 点球时除主罚人和门将外，所有人退到禁区线外（攻守双方站在两侧）。 */
  private penaltyPosition(p: PesPlayer, r: PesRestart): Vec2 {
    const P = this.spec
    const attackers = this.teams[r.ti]
    const x = attackers.dir * (P.HL - P.PEN_D - 2.5)
    const side = p.ti === r.ti ? -1 : 1
    return { x, y: clamp(side * (3 + p.slot * 2.2), -P.HW + 2.5, P.HW - 2.5) }
  }

  /**
   * 角球和前场任意球传中开出前的站位：进攻方空中能力最好的几个人进禁区（近门柱、点球点、远门柱、禁区弧），
   * 防守方空中最好的几个人一对一盯住（站在对应进攻者靠球门一侧）。返回 null = 不用特殊站位。
   */
  private boxPosition(p: PesPlayer, r: PesRestart): Vec2 | null {
    if (p.slot === 0) return null
    const P = this.spec
    const att = this.teams[r.ti]
    const defTeam = this.other(att)
    if (r.type === 'fk') {
      const units = dist({ x: r.x, y: r.y }, this.oppGoalOf(att)) * (100 / P.L)
      if (units < FREE_KICK_SHOT_RANGE || units >= FREE_KICK_DELIVERY_RANGE) return null
    } else if (r.type !== 'corner') return null
    const g = this.oppGoalOf(att)
    const side = Math.sign(r.y) || 1
    const spots: Vec2[] = [
      { x: g.x - att.dir * 2.8, y: side * 2.6 },
      { x: g.x - att.dir * this.penaltySpotDepth(), y: -side * 0.6 },
      { x: g.x - att.dir * 3.8, y: -side * 4.2 },
      { x: g.x - att.dir * 9.0, y: side * 1.5 },
    ]
    const byAir = (a: PesPlayer, c: PesPlayer): number => (c.ab.air ?? 0) - (a.ab.air ?? 0)
    if (p.ti === r.ti) {
      if (p.pid === r.taker) return null
      const index = att.players.filter((q) => q.slot !== 0 && q.pid !== r.taker).sort(byAir).indexOf(p)
      return index >= 0 && index < spots.length ? spots[index] : null
    }
    const index = defTeam.players.filter((q) => q.slot !== 0).sort(byAir).indexOf(p)
    if (index < 0 || index >= spots.length) return null
    const mark = spots[index]
    const toGoal = norm(g.x - mark.x, g.y - mark.y)
    return { x: mark.x + toGoal.x * 0.8, y: mark.y + toGoal.y * 0.8 }
  }

  /** 点球：主罚人到位后直接出脚，成败交给结算模型。 */
  private penaltyKick(taker: PesPlayer): void {
    const b = this.ball
    b.frozen = false
    b.lastTouch = taker.pid
    taker.noClaim = 0
    this.phase = 'play'
    this.restart = null
    this.execShot(taker, 0, { header: false, penalty: true, freeKick: false })
  }

  /**
   * 角球：传到点球点附近，头球好的几名队员冲点，落点争顶（计划 4.7 的试验里已经跑通）。
   * 角球不判传球成败（和现有引擎一致：直接进入争顶）。
   */
  private cornerKick(taker: PesPlayer): void {
    const t = this.teams[taker.ti]
    const b = this.ball
    const g = this.oppGoalOf(t)
    const spot = { x: g.x - t.dir * this.penaltySpotDepth(), y: (this.rng.float() < 0.5 ? -1 : 1) * (0.8 + this.rng.float() * 2.2) }
    const heads = t.players.filter((q) => q !== taker && q.slot !== 0).sort((a, c) => (c.ab.air ?? 0) - (a.ab.air ?? 0))
    const runners = heads.filter((q) => dist(q.pos, spot) < 26).slice(0, 3)
    const target = runners[0] ?? heads[0]
    for (const q of runners) {
      q.runTarget = { x: spot.x + (this.rng.float() - 0.5) * 3, y: spot.y + (this.rng.float() - 0.5) * 4 }
      q.runUntil = this.time + 3.2
      q.mode = 'run'
    }
    this.launchCross(taker, spot, target ? target.pid : -1, 'ok', false)
    this.phase = 'play'
    this.restart = null
  }

  /**
   * 传中 / 角球 / 任意球传中的出球：高球飞向 `spot`，落点触发争顶。
   * 结果是 ok 时落点就在禁区里；icpt / miss / out 时球飞向拦截者 / 偏离 / 出界（由调用方改 spot）。
   */
  private launchCross(taker: PesPlayer, spot: Vec2, intended: number, result: 'ok' | 'icpt' | 'miss' | 'out' | null, setResult: boolean, interceptor = -1): void {
    this.noteOpenKick(taker)
    const t = this.teams[taker.ti]
    const b = this.ball
    const d = Math.hypot(spot.x - taker.pos.x, spot.y - taker.pos.y)
    const tf = clamp(d / 15, 0.9, 1.9)
    b.owner = -1
    b.frozen = false
    b.x = taker.pos.x
    b.y = taker.pos.y
    b.z = 0.1
    b.vx = (spot.x - taker.pos.x) / tf
    b.vy = (spot.y - taker.pos.y) / tf
    b.vz = 4.905 * tf
    b.spin = 0
    b.lastTouch = taker.pid
    b.looseT = 0
    const meta: BallMeta = { type: 'pass', from: taker.pid, intended, offside: false, loft: true, cross: result === 'ok' || result === null }
    if (setResult && result) meta.result = result
    if (interceptor >= 0) meta.icpt = interceptor
    b.meta = meta
    this.metrics?.trackCross(meta)
    taker.noClaim = 0.5
    taker.touches++
    t.stats.passes++
  }

  private setRestart(type: RestartType, pos: Vec2, team: PesTeam): void {
    this.phase = 'restart'
    const b = this.ball
    b.frozen = true
    b.owner = -1
    b.x = pos.x
    b.y = pos.y
    b.z = 0
    b.vx = b.vy = b.vz = 0
    b.meta = null
    b.looseT = 0

    const cands = team.players.filter((p) => p.role !== 'GK')
    let taker: PesPlayer | undefined
    if (type === 'corner' || type === 'fk') {
      cands.sort((a, c) => (dist(a.pos, pos) - a.ab.passing * 8) - (dist(c.pos, pos) - c.ab.passing * 8))
      taker = cands[0]
    } else if (type === 'penalty') {
      cands.sort((a, c) => c.ab.shooting - a.ab.shooting)
      taker = cands[0]
    } else if (type === 'goalkick') {
      taker = this.keeperOf(team) ?? undefined
      if (!taker) {
        // 门将被罚下了：离球最近的外场球员开球门球
        cands.sort((a, c) => dist2(a.pos, pos) - dist2(c.pos, pos))
        taker = cands[0]
      }
    } else {
      cands.sort((a, c) => dist2(a.pos, pos) - dist2(c.pos, pos))
      taker = cands[0]
    }
    b.lastTouch = taker ? taker.pid : -1
    const ti = this.tiOf(team)
    this.restart = { type, ti, t: 0, taker: taker ? taker.pid : -1, x: pos.x, y: pos.y }
    this.beginOpenRestart(type, ti, taker ? taker.pid : -1)
    if (this.usesTacticalMechanics) this.clearInstructionShape()
    this.event(type, ti, taker ? [taker.pid] : [])
  }

  /* ---------- 新指令：开放比赛与攻防转换 ---------- */
  private beginOpenRestart(type: RestartType, team: TeamIndex, taker: number): void {
    if (!this.usesTacticalMechanics) return
    this.openPlay = { phase: 'restartPending', restartType: type, team, taker, candidate: null, controlledFor: 0 }
    this.lastPoss = null
    for (const t of this.teams) {
      if (!t.tactics.instructions) continue
      t.gainAt = undefined
      t.lossAt = undefined
      t.pressEvalAt = undefined
      t.pressOwnerPid = undefined
    }
  }

  /** 第一脚仍属于重开球；候选队伍随后主动出脚时才确认开放比赛。 */
  private noteOpenKick(p: PesPlayer): void {
    if (!this.usesTacticalMechanics) return
    if (this.openPlay.phase === 'restartPending') {
      this.openPlay.phase = 'unconfirmed'
      this.openPlay.candidate = null
      this.openPlay.controlledFor = 0
    } else if (this.openPlay.phase === 'unconfirmed' && this.ball.owner === p.pid) {
      this.openPlay.phase = 'open'
    }
  }

  private updateOpenPlay(dt: number): void {
    if (!this.usesTacticalMechanics || this.ball.frozen || this.ball.owner < 0) return
    const owner = this.players[this.ball.owner]
    if (this.openPlay.phase === 'restartPending' && owner.pid !== this.openPlay.taker) {
      this.openPlay.phase = 'unconfirmed'
      this.openPlay.candidate = null
      this.openPlay.controlledFor = 0
    }
    if (this.openPlay.phase !== 'unconfirmed') return
    if (this.openPlay.candidate !== owner.ti) {
      this.openPlay.candidate = owner.ti
      this.openPlay.controlledFor = 0
    }
    this.openPlay.controlledFor += dt
    if (this.openPlay.controlledFor >= 0.2) this.openPlay.phase = 'open'
  }

  private updateTransitions(): void {
    const v2 = this.teams[0].tactics.instructions ?? this.teams[1].tactics.instructions
    if (!v2 && !this.metrics) return
    const poss = this.possessionTeam()
    const ti = poss ? this.tiOf(poss) : null
    if (this.metrics) this.metrics.step(this, ti, this.spec.DT)
    if (!v2 || ti === null) return
    if (this.lastPoss === null) {
      this.lastPoss = ti
      return
    }
    if (ti === this.lastPoss) return
    if (this.tacticalMechanics && this.openPlay.phase !== 'open') {
      this.lastPoss = ti
      return
    }
    this.teams[this.lastPoss].lossAt = this.time
    poss!.gainAt = this.time
    this.lastPoss = ti
  }

  /** 转换窗口是模拟秒，按整场时长缩放（文档 4.1）。 */
  private inWindow(since: number | undefined): boolean {
    if (since === undefined) return false
    return this.time - since <= this.tacticsParams.transitionWindow * (this.spec.HALF * 2) / 900
  }

  /** 球队熟练度：新指令的执行强度按全队外场均值缩放。 */
  private teamFamiliarity(t: PesTeam): number {
    const outfield = t.players.filter((p) => p.slot !== 0)
    if (!outfield.length) return 1
    return outfield.reduce((sum, p) => sum + (p.familiarity ?? 1), 0) / outfield.length
  }

  /**
   * 决策执行符号（docs/tactical-design-revision.md 5.2）：
   * 采用连续熟练度缩放，不再在每次决策或每帧随机抽签反转战术方向，保证 RNG 序列稳定。
   */
  private tacticBias(p: PesPlayer, _key: keyof typeof INSTRUCTION_DIFFICULTY): number {
    return this.teams[p.ti].tactics.instructions ? 1 : 0
  }

  /* ---------- 决策 ---------- */
  private possessionTeam(): PesTeam | null {
    const b = this.ball
    if (b.frozen) return null
    if (b.owner >= 0) return this.teams[this.players[b.owner].ti]
    // 正常传球飞行仍属于进攻阶段；被抢断、射门或传丢太久则转为争抢。
    const meta = b.meta
    if (meta && (meta.type === 'pass' || meta.type === 'cross') && b.looseT <= 4
      && meta.from >= 0 && meta.intended !== undefined && meta.intended >= 0
      && this.players[meta.from].ti === this.players[meta.intended].ti) return this.teams[this.players[meta.from].ti]
    return null
  }

  private decide(p: PesPlayer): void {
    const b = this.ball
    if (b.owner === p.pid) {
      if (p.slot === 0) this.decideGKOnBall(p)
      else this.decideOnBall(p)
      return
    }
    if (p.slot === 0) {
      this.decideGK(p)
      return
    }
    if (b.frozen) {
      if (this.restart && this.restart.taker === p.pid) return
      p.runTarget = null
      if (this.contact && this.restart && this.restart.type === 'penalty') {
        p.target = this.penaltyPosition(p, this.restart)
        p.urgency = 0.6
        p.mode = 'idle'
        return
      }
      // 角球 / 前场任意球传中：进攻方空中好的人进禁区站点，防守方一对一盯住
      const box = this.contact && this.restart ? this.boxPosition(p, this.restart) : null
      if (box) {
        p.target = box
        p.urgency = 0.75
        p.mode = 'idle'
        return
      }
      p.target = this.formationTarget(p)
      p.urgency = 0.28
      p.mode = 'idle'
      return
    }
    if (this.possessionTeam()) this.decideOffBall(p)
    else this.decideLoose(p)
  }

  private decideGK(p: PesPlayer): void {
    const P = this.spec
    const K = P.K
    const t = this.teams[p.ti]
    const g = this.goalOf(t)
    const b = this.ball
    const dBall = dist(b, g)
    // 射门来了：沿球门线移动到落点
    if (b.meta && b.meta.type === 'shot' && b.vx * Math.sign(g.x - b.x) > 0) {
      const tt = Math.abs((g.x - b.x) / (b.vx || 1))
      const yLine = b.y + b.vy * tt
      p.target = { x: g.x + t.dir * 0.7, y: clamp(yLine, -P.GOAL_HALF - 0.4, P.GOAL_HALF + 0.4) }
      p.urgency = 1.0
      p.mode = 'gk'
      return
    }
    const rush = this.possessionTeam() !== t && dBall < 14 * K && b.z < 1.8 && !b.frozen
    const to = norm(b.x - g.x, b.y - g.y)
    let r = 1.0 + clamp(dBall / (24 * K), 0, 2.4)
    if (rush) r = clamp(dBall - 0.9, 0.6, 11 * K)
    let tx = g.x + to.x * r
    let ty = g.y + to.y * r
    ty = clamp(ty, -P.GOAL_HALF - 2.4, P.GOAL_HALF + 2.4)
    if (Math.abs(tx) > P.HL - 0.5) tx = Math.sign(tx) * (P.HL - 0.5)
    p.target = { x: tx, y: ty }
    p.urgency = rush ? 0.95 : 0.5
    p.mode = 'gk'
  }

  private decideGKOnBall(p: PesPlayer): void {
    const t = this.teams[p.ti]
    if (!p.holdUntil) p.holdUntil = this.time + 0.9 + this.rng.float() * 0.9
    if (this.time < p.holdUntil) {
      p.target = { x: p.pos.x, y: clamp(p.pos.y, -3, 3) }
      p.urgency = 0.12
      p.mode = 'gk'
      return
    }
    const opps = this.other(t).players
    let best: PesPlayer | null = null
    let bs = 0.28
    if (t.tactics.instructions) p.bias = this.tacticBias(p, 'passing')
    for (const mate of t.players) {
      if (mate === p) continue
      const s = this.passValue(p, mate, 0.15, opps)
      if (s > bs) {
        bs = s
        best = mate
      }
    }
    if (best && this.rng.float() < 0.85) this.execPass(p, best, 0.15)
    else this.execClear(p)
    p.holdUntil = 0
  }

  /* ---- 持球者：射 / 传 / 带 / 解围 的效用打分 ---- */
  private decideOnBall(p: PesPlayer): void {
    const K = this.spec.K
    const t = this.teams[p.ti]
    const dir = t.dir
    const opps = this.other(t).players
    const press = this.pressure(p)
    const dGoal = dist(p.pos, this.oppGoalOf(t))
    // 新指令的执行符号：一次决策抽一次，之后所有候选共用，避免每个候选各抽一枚。
    if (t.tactics.instructions) p.bias = this.tacticBias(p, 'passing')

    // 刚接到球：先带一下（除非被逼得很紧）
    if (this.time < p.holdUntil && press < 0.5 && dGoal > 26 * K) {
      this.execCarry(p)
      return
    }

    // 刚开出的任意球：在射程内直接射门，再远一点传中禁区，其余照常
    if (this.setPiece && this.setPiece.taker === p.pid) {
      if (this.time > this.setPiece.until) this.setPiece = null
      else if (this.freeKickPlay(p)) {
        this.setPiece = null
        return
      }
    }

    let best: Choice = { type: 'carry', score: 0.1 }
    const finish = this.finishingContext(p, opps)
    const shotScore = dGoal < 32 * K ? this.shootValue(p, press, opps, finish) : 0

    if (p.shotCd <= 0 && shotScore > best.score) best = { type: 'shoot', score: shotScore }
    const spaceEnabled = this.tacticalMechanics && t.tactics.instructions?.advanced?.possession?.receiving === 'space' && this.openPlay.phase === 'open'
    const mates = spaceEnabled ? t.players.slice().sort((a, b) => a.pid - b.pid) : t.players
    let spaceCandidates = 0
    for (const mate of mates) {
      if (mate === p || mate.stun > 0) continue
      // 同一队友的普通候选和空当候选共用一次噪声，不因候选数增加而抽额外随机数。
      const noise: { value?: number } | undefined = spaceEnabled ? {} : undefined
      const s = this.passValue(p, mate, press, opps, shotScore, finish, undefined, noise)
      if (s > best.score) best = { type: 'pass', score: s, mate }
      if (spaceEnabled && s >= 0) {
        const target = this.spacePassTarget(p, mate, opps)
        if (target) {
          spaceCandidates++
          const spaceScore = this.passValue(p, mate, press, opps, shotScore, finish, target, noise)
          if (spaceScore > best.score) best = { type: 'pass', score: spaceScore, mate, target }
        }
      }
    }
    if (spaceEnabled) this.metrics?.spaceDecision(p.ti, spaceCandidates)
    if (p.pos.x * dir < -12 * K && press > 0.55) {
      const s = 0.3 + 0.5 * press
      if (s > best.score) best = { type: 'clear', score: s }
    }
    const sCarry = this.carryValue(p, press, opps)
    if (sCarry > best.score) best = { type: 'carry', score: sCarry }
    // 传中：边路持球者在传中区、禁区里有队友时可以选择传中。成败要走结算内核，没接结算的纯物理比赛不传中。
    if (this.rules.cross && this.contact) {
      const option = this.crossOption(p, press)
      if (this.tacticalMechanics && this.openPlay.phase === 'open') {
        this.metrics?.crossDecision(p.ti, !!option, !!option && option.score > best.score, option ? best.score - option.score : undefined)
      }
      if (option && option.score > best.score) best = { type: 'cross', score: option.score, mate: option.mate, spot: option.spot }
    }

    // 单刀终结阶段：远处继续突破，进入射程或门将逼近就出脚，不向后方重置进攻。
    const finishNow = finish.clear && p.shotCd <= 0 && (dGoal <= 18 * K || finish.keeperDistance < 5)
    if (finishNow && best.type === 'carry') best = { type: 'shoot', score: shotScore }

    // 已进入明确的单刀终结窗口时，不再用随机噪声取消出脚。
    if (!finishNow && best.type !== 'carry' && this.rng.float() < 0.08 * (1 - p.ab.control)) {
      if (best.type === 'cross' && this.tacticalMechanics && this.openPlay.phase === 'open') this.metrics?.crossCanceled(p.ti, 'control')
      best = { type: 'carry', score: sCarry }
    }

    // 战术犯规会立即切入死球阶段；记录前保留原开放状态。
    const observedCross = best.type === 'cross' && this.tacticalMechanics && this.openPlay.phase === 'open'
    if (this.contact && best.type !== 'carry' && !(this.setPiece && this.setPiece.taker === p.pid) && this.tacticalFoul(p)) {
      if (observedCross) this.metrics?.crossCanceled(p.ti, 'foul')
      return
    }

    if (best.type === 'shoot') this.execShot(p, press)
    else if (best.type === 'pass') this.execPass(p, best.mate, press, best.target)
    else if (best.type === 'cross') this.execCross(p, best.mate, best.spot)
    else if (best.type === 'clear') this.execClear(p)
    else this.execCarry(p)
  }

  /** 战术犯规：返回 true 表示犯规了，这次出球作废。 */
  private tacticalFoul(carrier: PesPlayer): boolean {
    const v = this.contact!.tacticalFoul(this, carrier)
    if (!v) return false
    this.awardFoul(this.players[v.defender], carrier, v)
    return true
  }

  /* ---- 传中 ---- */
  private crossOption(p: PesPlayer, press: number): { score: number; mate: PesPlayer; spot: Vec2 } | null {
    const P = this.spec
    if (p.slot === 0) return null
    const t = this.teams[p.ti]
    const dir = t.dir
    const toLine = P.HL - p.pos.x * dir
    const v2 = t.tactics.instructions
    const openTactical = this.tacticalMechanics && this.openPlay.phase === 'open' && !!v2
    const early = openTactical && v2?.advanced?.possession?.crossTiming === 'early'
    const exec = execution(p.familiarity ?? 1, this.tacticsParams)
    const limit = early ? lerp(0.27, 0.35, exec) : 0.27
    if (toLine > limit * P.L || Math.abs(p.pos.y) < P.PEN_W / 2 - 1) return null
    const inBox = (q: PesPlayer): boolean => P.HL - q.pos.x * dir < P.PEN_D + 2 && Math.abs(q.pos.y) < P.PEN_W / 2 + 1
    const mates = t.players.filter((q) => q !== p && q.slot !== 0 && q.stun <= 0 && inBox(q) && !this.isOffside(t, q))
    if (!mates.length) return null
    const g = this.oppGoalOf(t)
    const spot = { x: g.x - dir * this.penaltySpotDepth(), y: -Math.sign(p.pos.y || 1) * 1.8 }
    let mate = mates[0]
    for (const q of mates) if (dist(q.pos, spot) < dist(mate.pos, spot)) mate = q
    const defenders = this.other(t).players.filter((o) => o.slot !== 0 && P.HL - o.pos.x * dir < P.PEN_D + 2 && Math.abs(o.pos.y) < P.PEN_W / 2 + 1).length
    const baseConst = openTactical ? 0.42 : 0.34
    const wingBonus = openTactical && v2?.possession.focus === 'wing'
      ? 0.05 * execution(p.familiarity ?? 1, this.tacticsParams, INSTRUCTION_DIFFICULTY.focus)
      : 0
    const base = baseConst + 0.07 * Math.min(3, mates.length) + 0.12 * press - 0.05 * defenders + wingBonus
    const bias = early ? 0.12 * exec : 0
    return { score: base + bias, mate, spot }
  }

  /** 传中出脚：成败走结算内核（passModel 的 cross 型），到位后落点争顶，攻方赢了直接头球攻门。 */
  private execCross(p: PesPlayer, mate: PesPlayer, spot: Vec2, setPiece = false): void {
    const verdict = this.contact!.pass(this, p, mate, spot, 'cross', setPiece)
    if (!setPiece && this.tacticalMechanics && this.openPlay.phase === 'open') this.metrics?.cross(p.ti, verdict.result === 'ok')
    const aim = this.stagePassAim(p, spot.x, spot.y, verdict)
    this.launchCross(p, aim, mate.pid, verdict.result, true, verdict.interceptor)
    if (verdict.result === 'ok') this.sendRunners(p, spot, 3)
    this.event('pass', p.ti, [p.pid, mate.pid], undefined, {
      kind: 'cross', result: verdict.result, p: Math.round(verdict.p * 1000) / 1000, ...(verdict.interceptor >= 0 ? { icpt: verdict.interceptor } : {}), ...(setPiece ? { setPiece: true } : {}),
    })
    p.mode = 'idle'
  }

  /** 传中时禁区里空中能力好的队员冲点。 */
  private sendRunners(from: PesPlayer, spot: Vec2, count: number): void {
    const t = this.teams[from.ti]
    const heads = t.players.filter((q) => q !== from && q.slot !== 0).sort((a, c) => (c.ab.air ?? 0) - (a.ab.air ?? 0))
    const runners = heads.filter((q) => dist(q.pos, spot) < 20).slice(0, count)
    for (const q of runners) {
      q.runTarget = { x: spot.x + (this.rng.float() - 0.5) * 3, y: spot.y + (this.rng.float() - 0.5) * 4 }
      q.runUntil = this.time + 3
      q.mode = 'run'
    }
  }

  /** 任意球：射程内直接射门，再远一点传中到禁区；返回 false 表示照常处理（短传开出）。 */
  private freeKickPlay(p: PesPlayer): boolean {
    const P = this.spec
    const t = this.teams[p.ti]
    const toGoalUnits = dist(p.pos, this.oppGoalOf(t)) * (100 / P.L)
    const lateralUnits = Math.abs(p.pos.y) * (64 / P.W)
    if (toGoalUnits < FREE_KICK_SHOT_RANGE && lateralUnits < 22) {
      this.execShot(p, 0, { header: false, penalty: false, freeKick: true })
      return true
    }
    if (toGoalUnits < FREE_KICK_DELIVERY_RANGE) {
      const g = this.oppGoalOf(t)
      const spot = { x: g.x - t.dir * this.penaltySpotDepth(), y: -Math.sign(p.pos.y || 1) * 1.8 }
      const mates = t.players.filter((q) => q !== p && q.slot !== 0)
      if (!mates.length) return false
      let mate = mates[0]
      for (const q of mates) if (dist(q.pos, spot) < dist(mate.pos, spot)) mate = q
      this.execCross(p, mate, spot, true)
      return true
    }
    return false
  }

  /* ---- 高球落点争顶 ---- */
  private aerialDuel(): boolean {
    const b = this.ball
    const mt = b.meta!
    mt.aerialDone = true
    const attTi = this.players[mt.from].ti
    // 球还有 0.2–0.3 秒落地：按预计落点算谁够得着（跳起争顶的是落点附近的人）
    const fall = (b.vz + Math.sqrt(b.vz * b.vz + 19.62 * Math.max(0, b.z))) / 9.81
    const land = { x: b.x + b.vx * fall, y: b.y + b.vy * fall }
    const att: PesPlayer[] = []
    const def: PesPlayer[] = []
    for (const t of this.teams) {
      for (const q of t.players) {
        if (q.stun > 0) continue
        if (dist(q.pos, land) > (q.slot === 0 ? 4.2 : 3.0)) continue
        if (q.ti === attTi) att.push(q)
        else def.push(q)
      }
    }
    if (!att.length && !def.length) return false
    const winner = this.contact!.aerial(this, att, def, land, attTi)
    if (winner < 0) return false
    const q = this.players[winner]
    this.event('aerial', q.ti, [q.pid], undefined, { attacking: q.ti === attTi })
    const t = this.teams[q.ti]
    // 攻方在禁区附近赢得高球：直接头球攻门
    if (q.ti === attTi && q.slot !== 0 && dist(q.pos, this.oppGoalOf(t)) * (100 / this.spec.L) <= 24) {
      q.noClaim = 0
      b.owner = -1
      this.execShot(q, 0.3, { header: true, penalty: false, freeKick: false })
      return true
    }
    if (mt.type === 'pass' && mt.from >= 0 && this.players[mt.from].ti === q.ti && mt.from !== q.pid) t.stats.passesOk++
    b.owner = q.pid
    b.meta = null
    b.z = 0
    b.vx = b.vy = b.vz = 0
    b.lastTouch = q.pid
    b.looseT = 0
    q.holdUntil = this.time + 0.45 + this.rng.float() * 0.4
    q.touches++
    q.noClaim = 0
    return true
  }

  /** 传球类型：身后球 / 长传 / 短传（决定基础成功率）。 */
  private passKind(p: PesPlayer, mate: PesPlayer): PassKind {
    const t = this.teams[p.ti]
    const opp = this.other(t)
    if (mate.role !== 'GK' && mate.pos.x * t.dir > this.secondLastLx(t, opp) - 0.5 && (mate.pos.x - p.pos.x) * t.dir > 4) return 'through'
    return dist(p.pos, mate.pos) * (100 / this.spec.L) > 30 ? 'long' : 'short'
  }

  /** 传球结果 → 球实际瞄向哪里：被拦截时瞄向拦截者所在的线上点，传丢时偏离 3–7 米，出界时多传 12 米。 */
  private stagePassAim(p: PesPlayer, tx: number, ty: number, v: PassVerdict): Vec2 {
    const P = this.spec
    if (v.result === 'icpt' && v.interceptor >= 0) {
      const icpt = this.players[v.interceptor]
      const vx = tx - p.pos.x
      const vy = ty - p.pos.y
      const vv = vx * vx + vy * vy || 1
      const uu = clamp(((icpt.pos.x - p.pos.x) * vx + (icpt.pos.y - p.pos.y) * vy) / vv, 0.25, 0.9)
      tx = p.pos.x + vx * uu
      ty = p.pos.y + vy * uu
    } else if (v.result === 'miss') {
      const sd = this.rng.float() < 0.5 ? -1 : 1
      const off = 3.2 + this.rng.float() * 3.5
      const un = norm(tx - p.pos.x, ty - p.pos.y)
      tx += -un.y * sd * off + un.x * (this.rng.float() - 0.3) * off
      ty += un.x * sd * off + un.y * (this.rng.float() - 0.3) * off
    } else if (v.result === 'out') {
      const un = norm(tx - p.pos.x, ty - p.pos.y)
      tx += un.x * 12
      ty += un.y * 12
    }
    if (v.result === 'miss' || v.result === 'out') {
      const m = v.result === 'out' ? 3 : 2
      return { x: clamp(tx, -P.HL - m, P.HL + m), y: clamp(ty, -P.HW - m, P.HW + m) }
    }
    return { x: clamp(tx, -P.HL + 0.5, P.HL - 0.5), y: clamp(ty, -P.HW + 0.5, P.HW - 0.5) }
  }

  private finishingContext(p: PesPlayer, opps: PesPlayer[]): FinishView {
    const P = this.spec
    const K = P.K
    const t = this.teams[p.ti]
    const g = this.oppGoalOf(t)
    const depth = (g.x - p.pos.x) * t.dir
    const distance = dist(p.pos, g)
    const angle = depth > 0 ? Math.atan2(P.GOAL_HALF - p.pos.y, depth) - Math.atan2(-P.GOAL_HALF - p.pos.y, depth) : 0
    // 只考虑真正处在出脚前方的后卫。追兵/肩并肩的球员仍影响压力，但不是射门封堵者。
    const defenders = opps.filter((o) => o.role !== 'GK'
      && (o.pos.x - p.pos.x) * t.dir > 0.25 && (g.x - o.pos.x) * t.dir >= -0.5)
    const blocked = depth <= 0 || defenders.some((o) => {
      const progress = (o.pos.x - p.pos.x) * t.dir / depth
      return progress < 1 && Math.abs(o.pos.y - p.pos.y * (1 - progress)) < 2 + P.GOAL_HALF * progress
    })
    const keeper = opps.find((o) => o.role === 'GK')
    return {
      distance,
      depth,
      angle,
      defenders,
      keeperDistance: keeper ? dist(p.pos, keeper.pos) : Infinity,
      clear: distance <= 28 * K && angle >= 0.25 && !blocked,
    }
  }

  private isFinishingAssist(p: PesPlayer, mate: PesPlayer, opps: PesPlayer[], ownShot: number): boolean {
    const K = this.spec.K
    // 单刀时只接受近距离、能立刻形成明显更好终结的做球，不能把“后方无人”当机会。
    if (mate.role === 'GK' || mate.stun > 0 || mate.shotCd > 0
      || dist(p.pos, mate.pos) > 16 * K || this.isOffside(this.teams[p.ti], mate)) return false
    const receiver = this.finishingContext(mate, opps)
    if (!receiver.clear || receiver.distance > 18 * K || this.laneClearance(p.pos, mate.pos, opps) <= 1.8) return false
    const mateShot = this.shootValue(mate, this.pressure(mate), opps, receiver)
    return mateShot > ownShot + 0.18 && mateShot > ownShot * 1.15
  }

  private shootValue(p: PesPlayer, press: number, opps: PesPlayer[], finish: FinishView | null = null): number {
    const K = this.spec.K
    const t = this.teams[p.ti]
    const g = this.oppGoalOf(t)
    const view = finish || this.finishingContext(p, opps)
    const { distance: d, depth, angle: ang } = view
    if (depth <= 0 || d > 32 * K) return 0
    // 门将单独评估；身后追兵不能通过线段端点距离把前方射门线路“封死”。
    const lane = this.laneClearance(p.pos, g, view.defenders)
    const keeper = opps.find((o) => o.role === 'GK')
    let keeperFactor = 1
    if (keeper && (keeper.pos.x - p.pos.x) * t.dir > 0) {
      const coverage = clamp01(1 - segDist(keeper.pos.x, keeper.pos.y, p.pos.x, p.pos.y, g.x, g.y) / 2.5)
      keeperFactor -= coverage * (0.12 + 0.32 * clamp01((8 - dist(p.pos, keeper.pos)) / 8))
    }
    let s = 0.90 * Math.exp(-d / (16 * K))
      * clamp01(0.30 + ang / 1.5)
      * (0.55 + 0.50 * p.ab.shooting)
      * (1 - 0.40 * press)
      * clamp01(0.30 + lane / 4.0)
    if (d < 16 * K) s *= 1.45
    if (d < 11 * K) s *= 1.15
    if (d > 27 * K) s *= 0.6
    // 好角度、无后卫封堵时，及时结束进攻；不是简单地“进禁区就强制射门”。
    const finishBonus = 0.36 * clamp01((24 * K - d) / (12 * K)) * clamp01((ang - 0.18) / 0.40)
      * clamp01((lane - 1) / 2) * (1 - 0.5 * press)
    return (s * 2.6 + finishBonus) * keeperFactor
  }

  private passValue(p: PesPlayer, mate: PesPlayer, press: number, opps: PesPlayer[], shotScore: number | null = null, finish: FinishView | null = null, target?: Vec2, sharedNoise?: { value?: number }): number {
    const K = this.spec.K
    const t = this.teams[p.ti]
    const dir = t.dir
    const aim = target ?? mate.pos
    const d = dist(p.pos, aim)
    if (d < 3.0 || d > 62 * K) return -1
    const view = finish || this.finishingContext(p, opps)
    const ownShot = shotScore == null ? this.shootValue(p, press, opps, view) : shotScore
    // 这是单刀阶段的候选动作约束，不再依赖某个射门分数恰好超过软阈值。
    if (view.clear && !this.isFinishingAssist(p, mate, opps, ownShot)) return -1
    const lane = this.laneClearance(p.pos, aim, opps)
    const open = this.nearestOpp(aim, opps)
    const fwd = dir * (aim.x - p.pos.x)
    const isFwd = mate.line > p.line - 0.05

    let s = 0.30 * clamp01(fwd / (32 * K))
      + 0.26 * clamp01(open / 9)
      + 0.34 * clamp01((lane - 0.9) / 3.2)
      + 0.14 * clamp01(1 - d / (58 * K))
      + (isFwd ? 0.05 : 0)
    s += 0.06 * (mate.line - p.line) * (0.5 + t.tactics.direct)

    if (mate.mode === 'run' && lane > 1.8) s += 0.12 + 0.18 * t.tactics.direct
    // 打进禁区 / 身后：给一点冒险奖励，否则永远打不穿低位防守
    if (dir * aim.x > 20 * K && aim.x * dir > dir * p.pos.x) s += 0.10
    if (mate.mode === 'run') s += 0.06
    const offside = this.isOffside(t, mate)
    if (offside) s -= 1.2
    if (dir * p.pos.x < -18 * K && lane < 1.5) s -= 0.18
    if (mate.role === 'GK') s -= 0.25
    s -= clamp01(d / (62 * K)) * (1 - p.ab.passing) * 0.14
    s += press * 0.20
    // 没有压力 + 身前有空间时，更倾向自己带
    const spaceAhead = this.nearestOpp({ x: p.pos.x + dir * 5, y: p.pos.y }, opps)
    s *= 0.80 + 0.30 * clamp01(press) - 0.10 * clamp01((spaceAhead - 4) / 8)
    if (view.distance < 24 * K) {
      const mateShot = this.shootValue(mate, this.pressure(mate), opps)
      const betterChance = mateShot > ownShot + 0.18 && mateShot > ownShot * 1.15
      if (!offside && lane > 1.8 && betterChance) {
        // 横传空门 / 倒三角：奖励的是接球后的终结机会，而非传球本身的安全。
        s += 0.80 * mateShot * clamp01((lane - 0.9) / 2.5) * (0.6 + 0.4 * p.ab.passing)
      } else if (ownShot > 0.35) {
        if (fwd < -2) s -= 0.22 + 0.35 * clamp01(ownShot)
        if (ownShot > 0.60) s = Math.min(s, ownShot - 0.15)
      }
    }
    const noise = sharedNoise?.value ?? (this.rng.float() - 0.5) * 0.09
    if (sharedNoise) sharedNoise.value = noise
    s += noise
    // 新指令的首版九项：传球 / 方向 / 转换三项合计裁到 ±clip，只修改候选选择，不改传球成功率。
    const v2 = t.tactics.instructions
    if (v2) {
      const params = this.tacticsParams
      const K2 = this.spec.K
      const fam = this.teamFamiliarity(t)
      const passing = triOf(v2.possession.passing) * execution(fam, params, INSTRUCTION_DIFFICULTY.passing)
      const focus = triOf(v2.possession.focus) * execution(fam, params, INSTRUCTION_DIFFICULTY.focus)
      const z = clamp(Math.abs(aim.y) / (this.spec.HW - 2.5), 0, 1)
      let preference = params.wPass * passing * (clamp(d / (40 * K2), 0, 1) - 0.5)
        + params.wFocus * focus * (z - 0.5)
      const gain = v2.transition.onGain
      if (gain !== 'balanced' && this.inWindow(t.gainAt)) {
        const q = triOf(gain) * execution(fam, params, INSTRUCTION_DIFFICULTY.onGain)
        let transition = params.wTransition * q * clamp(fwd / (20 * K2), -1, 1)
        // 危险回传保护：纵向回传 > 2K 且线路净空不足 1.5K 的候选不能因为转换指令而加分。
        if (transition > 0 && fwd < -2 * K2 && lane < 1.5 * K2) transition = 0
        preference += transition
      }
      if (!target && v2.advanced?.possession?.receiving === 'feet' && d < 18 * K2) {
        preference += 0.03 * execution(mate.familiarity ?? 1, params, INSTRUCTION_DIFFICULTY.receiving)
      }
      s += clamp(preference, -params.clipPreference, params.clipPreference) * (p.bias ?? 1)
      if (target) s += Math.min(0.06, 0.04 * execution(mate.familiarity ?? 1, params))
    }
    return s
  }

  /** 空当候选只做可达性规划；不抽签，也不调用传球结算。调用方之外的防护也在这里复查启用条件。 */
  private spacePassTarget(p: PesPlayer, mate: PesPlayer, opps: PesPlayer[]): Vec2 | null {
    const P = this.spec
    const t = this.teams[p.ti]
    if (!this.tacticalMechanics || this.openPlay.phase !== 'open') return null
    if (t.tactics.instructions?.advanced?.possession?.receiving !== 'space') return null
    const reject = (reason: string): null => { this.metrics?.spaceReject(p.ti, reason); return null }
    if (mate.role === 'GK' || mate.stun > 0 || !mate.runTarget || mate.mode !== 'run'
      || this.time >= mate.runUntil) return reject('noActiveRun')
    if (mate.vel.x * t.dir < 0.5) return reject('insufficientForwardSpeed')
    const scale = clamp(this.tacticsParams.spaceLeadScale ?? 1, 0.5, 2)
    const lead = clamp(dist(p.pos, mate.pos) / 15, 0.3, 1.2) * scale
    let dx = mate.vel.x * lead
    let dy = mate.vel.y * lead
    const length = Math.hypot(dx, dy)
    if (length > 6 * P.K) { dx *= 6 * P.K / length; dy *= 6 * P.K / length }
    const target = { x: clamp(mate.pos.x + dx, -P.HL + 1, P.HL - 1), y: clamp(mate.pos.y + dy, -P.HW + 1, P.HW - 1) }
    const reference = Math.max(0, this.ball.x * t.dir, this.secondLastLx(t, this.other(t)))
    const distance = dist(p.pos, target)
    const maxSpaceDist = (t.tactics.instructions?.possession.passing === 'direct' ? 40 : 32) * P.K
    if ((target.x - mate.pos.x) * t.dir < P.K) return reject('shortLead')
    if (target.x * t.dir <= reference + 0.5 * P.K) return reject('notBehindLine')
    if (distance < 3 || distance > maxSpaceDist) return reject('distance')
    if (this.laneClearance(p.pos, target, opps) < 1.6 && distance > 17 * P.K) return reject('loftRequired')

    const direction = norm(target.x - p.pos.x, target.y - p.pos.y)
    const speed = clamp(8 + distance * 0.45, 9, 27)
    let x = p.pos.x + direction.x * 0.55
    let y = p.pos.y + direction.y * 0.55
    let z = 0.05
    let vz = 0
    let vx = direction.x * speed
    let vy = direction.y * speed
    let arrival = 0
    for (let elapsed = P.DT; elapsed <= 2.5 + 1e-9; elapsed += P.DT) {
      if (z > 0.01 || vz > 0.01) {
        vz -= 9.81 * P.DT
        z += vz * P.DT
        if (z <= 0) { z = 0; vz = vz < -1.6 ? -vz * 0.5 : 0; if (vz > 0) { vx *= 0.85; vy *= 0.85 } }
        const drag = Math.exp(-0.05 * P.DT)
        vx *= drag
        vy *= drag
      } else {
        const sp = Math.hypot(vx, vy)
        if (sp > 0.02) {
          const next = Math.max(0, sp - (0.55 + 0.012 * sp * sp) * P.DT)
          vx *= next / sp
          vy *= next / sp
        } else { vx = 0; vy = 0 }
      }
      x += vx * P.DT
      y += vy * P.DT
      if (Math.hypot(x - target.x, y - target.y) <= 1) { arrival = elapsed; break }
    }
    if (!arrival) return reject('ballUnreachable')
    const tau = Math.max(0, arrival - clamp(mate.decideT, 0, 0.45))
    const to = norm(target.x - mate.pos.x, target.y - mate.pos.y)
    const max = 0.88 * this.maxSpeed(mate)
    const v0 = clamp(mate.vel.x * to.x + mate.vel.y * to.y, 0, max)
    const acceleration = this.maxAccel(mate)
    const capTime = (max - v0) / acceleration
    const reach = tau <= capTime ? v0 * tau + 0.5 * acceleration * tau * tau
      : v0 * capTime + 0.5 * acceleration * capTime * capTime + max * (tau - capTime)
    return dist(mate.pos, target) <= reach + 1 ? target : reject('receiverUnreachable')
  }

  private carryValue(p: PesPlayer, press: number, opps: PesPlayer[]): number {
    const K = this.spec.K
    const t = this.teams[p.ti]
    const dir = t.dir
    const ahead = { x: p.pos.x + dir * 5.5, y: p.pos.y }
    const space = this.nearestOpp(ahead, opps)
    const dGoal = dist(p.pos, this.oppGoalOf(t))
    let base = 0.32 * clamp01((space - 1.2) / 7)
      + 0.16 * clamp01(dGoal / (48 * K))
      + 0.14 * p.ab.control
      + 0.16 * clamp01(1 - press * 1.25)
      + 0.03
    if (t.tactics.instructions) {
      const rawTempo = this.tacticsParams.tempoValue[t.tactics.instructions.possession.tempo]
      const effTempo = 0.5 + (rawTempo - 0.5) * execution(p.familiarity ?? 1, this.tacticsParams, INSTRUCTION_DIFFICULTY.tempo)
      base += (0.5 - effTempo) * 0.07 * clamp01(1 - press)
    }
    return base
  }

  /** 第二上抢者目标（A2）：优先封堵持球人近端最危险的出球线，无合适目标时退到球门侧协防阴影。 */
  private secondPresserTarget(t: PesTeam, owner: PesPlayer | null, ip: Vec2): Vec2 {
    const P = this.spec
    const K = P.K
    const g = this.goalOf(t)
    if (owner) {
      const attTeam = this.teams[owner.ti]
      let bestOpt: PesPlayer | null = null
      let bestScore = -1e9
      for (const opt of attTeam.players) {
        if (opt === owner || opt.slot === 0 || opt.stun > 0) continue
        const d = dist(owner.pos, opt.pos)
        if (d <= 0.5 || d > 14 * K) continue
        const forward = (opt.pos.x - owner.pos.x) * attTeam.dir
        const central = 1 - Math.min(1, Math.abs(opt.pos.y) / P.HW)
        const score = -d * 0.5 + forward * 0.45 + central * 2.5
        if (score > bestScore) {
          bestScore = score
          bestOpt = opt
        }
      }
      if (bestOpt) {
        const midX = lerp(ip.x, bestOpt.pos.x, 0.42) - t.dir * 1.0 * K
        const midY = lerp(ip.y, bestOpt.pos.y, 0.42)
        return {
          x: clamp(midX, -P.HL + 1.5, P.HL - 1.5),
          y: clamp(midY, -P.HW + 1.5, P.HW - 1.5),
        }
      }
    }
    const side = norm(g.x - ip.x, g.y - ip.y)
    return {
      x: clamp(ip.x + side.x * 2.8 * K, -P.HL + 1.5, P.HL - 1.5),
      y: clamp(ip.y + side.y * 2.8 * K, -P.HW + 1.5, P.HW - 1.5),
    }
  }

  /* ---- 无球球员 ---- */
  private decideOffBall(p: PesPlayer): void {
    const P = this.spec
    const K = P.K
    const t = this.teams[p.ti]
    const b = this.ball
    const owner = b.owner >= 0 ? this.players[b.owner] : null
    const possTeam = this.possessionTeam()

    // 结算判定“被拦截”：拦截者主动上前拦球
    if (this.contact && !owner && b.meta && b.meta.icpt === p.pid) {
      p.target = this.interceptPoint(p, 1.8)
      p.urgency = 1.0
      p.mode = 'press'
      return
    }

    // 飞行中的传球：接球人主动迎球，其余队友继续保持进攻队形。
    if (!owner && possTeam === t && b.meta && b.meta.intended === p.pid) {
      p.target = this.interceptPoint(p, 1.8)
      p.urgency = 1.0
      p.mode = 'support'
      return
    }

    if (possTeam === t) {
      let tgt = this.formationTarget(p)
      const dBall = dist(p.pos, b)
      const oppTeam = this.other(t)

      // 前腰也可前插；最多两人同时冲刺，其他人留作接应层。
      const runners = t.players.filter((q) => q.runTarget && this.time < q.runUntil).length
      const v2 = t.tactics.instructions
      const receiving = this.tacticalMechanics ? (v2?.advanced?.possession?.receiving ?? 'mixed') : 'mixed'
      const inCounter = !!v2 && this.inWindow(t.gainAt) && v2.transition.onGain === 'counter'
      // 熟练度同样削弱「得球后前插」的执行强度：fam 低时回到中性概率。
      let runProb = v2
        ? lerp(0.12, this.tacticsParams.runnerProb[this.inWindow(t.gainAt) ? v2.transition.onGain : 'balanced'],
          execution(this.teamFamiliarity(t), this.tacticsParams, INSTRUCTION_DIFFICULTY.onGain))
        : 0.12
      if (receiving === 'space' && this.openPlay.phase === 'open') {
        runProb += 0.04 * execution(p.familiarity ?? 1, this.tacticsParams, INSTRUCTION_DIFFICULTY.receiving)
      } else if (receiving === 'feet' && !inCounter) {
        runProb *= 1 - 0.45 * execution(p.familiarity ?? 1, this.tacticsParams, INSTRUCTION_DIFFICULTY.receiving)
      }
      const observeRunner = this.tacticalMechanics && receiving === 'space'
        && this.openPlay.phase === 'open' && p.line >= 0.6
      const minRunBallLx = this.tacticalMechanics && (receiving === 'space' || inCounter) ? -26 * K : -12 * K
      if (p.line >= 0.6 && this.time > p.runUntil && runners < 2 && b.x * t.dir > minRunBallLx) {
        const sbl = this.spaceBehindLine(p, oppTeam)
        if (sbl > 4) {
          const started = this.rng.float() < runProb
          if (observeRunner) this.metrics?.runner(p.ti, started ? 'started' : 'rollMiss')
          if (started) {
            const lineLx = Math.max(0, b.x * t.dir, this.secondLastLx(t, oppTeam))
            const runLx = this.tacticalMechanics && receiving === 'space' && this.openPlay.phase === 'open'
              ? Math.min(lineLx + 4 * K * execution(p.familiarity ?? 1, this.tacticsParams, INSTRUCTION_DIFFICULTY.receiving), P.HL - 6 * K)
              : this.tacticalMechanics
                ? Math.min(lineLx + (inCounter ? 2.5 : 1.0) * K, P.HL - 6 * K)
                : Math.min(lineLx - 1.5, P.HL - 6 * K)
            const chanY = clamp(this.homeWorld(p).y + (this.rng.float() - 0.5) * 6, -P.HW + 4, P.HW - 4)
            p.runTarget = { x: runLx * t.dir, y: chanY }
            p.runUntil = this.time + 1.4 + this.rng.float() * 1.2
          }
        } else if (observeRunner) this.metrics?.runner(p.ti, 'spaceThreshold')
      } else if (observeRunner) {
        const reason = this.time <= p.runUntil ? 'activeRun' : runners >= 2 ? 'runnerLimit' : 'ballTooDeep'
        this.metrics?.runner(p.ti, reason)
      }

      if (p.runTarget && this.time < p.runUntil) {
        tgt = p.runTarget
        p.urgency = 1.0
        p.mode = 'run'
      } else {
        if (p.mode === 'run') {
          p.mode = 'idle'
          p.runTarget = null
        }
        if (dBall < 28 * K && p.line > 0.22 && p.line < 0.68) {
          const side = Math.sign(p.hn.y - 0.5) || 1
          // 前腰在球前/肋部接应，中场在球后，后腰保留保护距离。
          let supportLx = K * (p.line >= 0.6 ? 4 + 3 * t.tactics.direct
            : p.line > 0.35 ? -(7 + 4 * (1 - t.tactics.direct)) : -15)
          if (receiving === 'feet') {
            supportLx -= 2.0 * K * execution(p.familiarity ?? 1, this.tacticsParams, INSTRUCTION_DIFFICULTY.receiving) * Math.sign(supportLx || 1)
          }
          const focus = v2 ? triOf(v2.possession.focus) * execution(this.teamFamiliarity(t), this.tacticsParams, INSTRUCTION_DIFFICULTY.focus) : 0
          const sup = {
            x: b.x + t.dir * supportLx,
            y: clamp(b.y + t.dir * side * 9 * K * (0.6 + 0.8 * t.tactics.width) * (1 + 0.35 * focus), -P.HW + 4, P.HW - 4),
          }
          tgt = { x: lerp(tgt.x, sup.x, 0.42), y: lerp(tgt.y, sup.y, 0.42) }
        }
        if (p.line >= 0.6) {
          const onsideLx = Math.max(0, b.x * t.dir, this.secondLastLx(t, oppTeam)) - 1.2
          tgt.x = Math.min(tgt.x * t.dir, onsideLx) * t.dir
        }
        const advanceGap = (tgt.x - p.pos.x) * t.dir
        p.urgency = advanceGap > 6 * K ? (p.line >= 0.6 ? 0.68 : 0.55) : (dBall < 32 * K ? 0.46 : 0.34)
        p.mode = dBall < 32 * K || advanceGap > 6 * K ? 'support' : 'idle'
      }
      p.target = tgt
      return
    }

    // ---- 防守 ----
    p.runTarget = null
    if (t.presser === p.pid || t.presser2 === p.pid) {
      const ip = owner ? { x: owner.pos.x + owner.vel.x * 0.55, y: owner.pos.y + owner.vel.y * 0.55 }
        : this.predictBall(0.5)
      if (this.tacticalMechanics && t.presser2 === p.pid) {
        p.target = this.secondPresserTarget(t, owner, ip)
        p.urgency = 0.85
        p.mode = 'press'
        return
      }
      const g = this.goalOf(t)
      const side = norm(g.x - ip.x, g.y - ip.y)
      p.target = { x: ip.x + side.x * 0.4, y: ip.y + side.y * 0.4 }
      p.urgency = 0.90
      p.mode = 'press'
      return
    }
    if (t.cover === p.pid) {
      const g = this.goalOf(t)
      const ip = owner ? owner.pos : b
      const dirv = norm(g.x - ip.x, g.y - ip.y)
      const v2 = t.tactics.instructions
      const compactScreen = this.tacticalMechanics && !!v2
        && (v2.defense.intensity === 'low' || v2.defense.line === 'low')
      const screenDist = compactScreen ? 3.6 : 5.5
      p.target = { x: ip.x + dirv.x * screenDist, y: ip.y + dirv.y * screenDist }
      p.urgency = compactScreen ? 0.72 : 0.50
      p.mode = 'cover'
      return
    }
    if (t.marks[p.slot] >= 0) {
      const o = this.players[t.marks[p.slot]]
      const g = this.goalOf(t)
      const dirv = norm(g.x - o.pos.x, g.y - o.pos.y)
      const toBall = norm(b.x - o.pos.x, b.y - o.pos.y)
      const deepThird = Math.abs(o.pos.x) > P.HL - 35 * K
      const ownThird = o.pos.x * t.dir < -(P.HL - 35 * K)
      const r = deepThird ? 1.35 : 1.8
      const v2 = t.tactics.instructions
      const lowBlockMark = this.tacticalMechanics && !!v2
        && (v2.defense.line === 'low' || v2.defense.intensity === 'low')
      if (lowBlockMark) {
        const effDef = execution(this.teamFamiliarity(t), this.tacticsParams, INSTRUCTION_DIFFICULTY.line)
        const gw = ownThird ? lerp(0.55, 0.82, effDef) : 0.55
        const bw = ownThird ? 1 - gw : 0.45
        let targetLx = (o.pos.x + (dirv.x * gw + toBall.x * bw) * r + o.vel.x * 0.10) * t.dir
        const targetY = o.pos.y + (dirv.y * gw + toBall.y * bw) * r + o.vel.y * 0.10
        if (ownThird) {
          targetLx = Math.min(targetLx, Math.max(-P.HL + 2, o.pos.x * t.dir - 0.95 * K * effDef))
        }
        if (p.line <= 0.35 && b.x * t.dir > -24 * K) {
          targetLx = Math.max(targetLx, -P.HL + lerp(16, 22, effDef) * K)
        }
        p.target = this.defensiveWidthTarget(p, { x: targetLx * t.dir, y: targetY })
        p.urgency = ownThird ? lerp(0.55, 0.68, effDef) : deepThird ? 0.55 : 0.36
      } else {
        p.target = {
          x: o.pos.x + (dirv.x * 0.55 + toBall.x * 0.45) * r + o.vel.x * 0.10,
          y: o.pos.y + (dirv.y * 0.55 + toBall.y * 0.45) * r + o.vel.y * 0.10,
        }
        p.target = this.defensiveWidthTarget(p, p.target)
        p.urgency = deepThird ? 0.55 : 0.36
      }
      p.mode = 'mark'
      return
    }

    p.target = this.defensiveWidthTarget(p, this.formationTarget(p))
    if (this.tacticalMechanics && t.tactics.instructions?.transition.onLoss === 'regroup'
      && this.inWindow(t.lossAt) && p.pos.x * t.dir > 0) {
      p.urgency = 0.44
    } else {
      p.urgency = 0.24
    }
    p.mode = 'idle'
  }

  /** 无球宽度只处理盯人和阵形目标，不移动上抢者、协防者或实际拦截者。 */
  private defensiveWidthTarget(p: PesPlayer, raw: Vec2): Vec2 {
    const P = this.spec
    const t = this.teams[p.ti]
    const width = t.tactics.instructions?.advanced?.defense?.width
    if (!this.tacticalMechanics || !width || width === 'normal' || this.ball.frozen) return raw
    const possession = this.possessionTeam()
    if (!possession || possession === t) return raw
    const opponent = this.other(t)
    const eligible = t.players.filter((q) => q.slot !== 0 && q.stun <= 0 && q.pid !== t.presser
      && q.pid !== t.presser2 && q.pid !== t.cover
      && !(this.contact && this.ball.owner < 0 && this.ball.meta?.icpt === q.pid)).sort((a, b) => a.pid - b.pid)
    if (eligible.length < 2 || !eligible.includes(p)) return raw
    const minY = -P.HW + 2.5
    const maxY = P.HW - 2.5
    let sum = 0
    for (const q of eligible) {
      const mark = t.marks[q.slot]
      const o = mark >= 0 ? opponent.players.find((other) => other.pid === mark) : undefined
      let y: number
      if (q === p) y = raw.y
      else if (o) {
        const g = this.goalOf(t)
        const goalDirection = norm(g.x - o.pos.x, g.y - o.pos.y)
        const ballDirection = norm(this.ball.x - o.pos.x, this.ball.y - o.pos.y)
        const r = Math.abs(o.pos.x) > P.HL - 35 * P.K ? 1.35 : 1.8
        const v2 = t.tactics.instructions
        const lowBlockMark = !!v2 && (v2.defense.line === 'low' || v2.defense.intensity === 'low')
        const ownThird = lowBlockMark && o.pos.x * t.dir < -(P.HL - 35 * P.K)
        if (ownThird) {
          const effDef = execution(this.teamFamiliarity(t), this.tacticsParams, INSTRUCTION_DIFFICULTY.line)
          const gw = lerp(0.55, 0.82, effDef)
          y = o.pos.y + (goalDirection.y * gw + ballDirection.y * (1 - gw)) * r + o.vel.y * 0.10
        } else {
          y = o.pos.y + (goalDirection.y * 0.55 + ballDirection.y * 0.45) * r + o.vel.y * 0.10
        }
      } else y = this.formationTarget(q).y
      if (!Number.isFinite(y)) return raw
      sum += clamp(y, minY, maxY)
    }
    const center = sum / eligible.length
    const rawY = clamp(raw.y, minY, maxY)
    const strength = execution(this.teamFamiliarity(t), this.tacticsParams)
    const compactness = clamp(this.tacticsParams.defenseCompactness ?? 0.15, 0, 0.35)
    const scale = 1 + compactness * triOf(width) * strength
    const proposed = center + (rawY - center) * scale
    let low = Math.max(minY, rawY - 3 * P.K)
    let high = Math.min(maxY, rawY + 3 * P.K)
    const marked = t.marks[p.slot]
    const o = marked >= 0 ? opponent.players.find((other) => other.pid === marked) : undefined
    if (o) {
      const maxGap = Math.abs(rawY - o.pos.y) + Math.max(0, this.tacticsParams.defenseMarkBuffer ?? 1.5) * P.K
      low = Math.max(low, o.pos.y - maxGap)
      high = Math.min(high, o.pos.y + maxGap)
    }
    return Number.isFinite(proposed) && low <= high ? { x: raw.x, y: clamp(proposed, low, high) } : raw
  }

  private decideLoose(p: PesPlayer): void {
    const b = this.ball
    const t = this.teams[p.ti]
    p.runTarget = null
    const ip = this.interceptPoint(p, 1.4)
    const mates = t.players.filter((q) => q.slot !== 0)
    mates.sort((a, c) => dist2(a.pos, b) - dist2(c.pos, b))
    const rank = mates.indexOf(p)
    const eta = dist(p.pos, ip) / Math.max(2.5, this.maxSpeed(p) * 0.7)
    if (rank < 2 && eta < 3.0) {
      p.target = ip
      p.urgency = 0.9
      p.mode = 'press'
    } else {
      p.target = this.formationTarget(p)
      p.urgency = 0.35
      p.mode = 'idle'
    }
  }

  /* ---- 阵型目标：区域式 ---- */
  private formationTarget(p: PesPlayer): Vec2 {
    const P = this.spec
    const K = P.K
    const t = this.teams[p.ti]
    const dir = t.dir
    const tac = t.tactics
    const b = this.ball
    const inPoss = this.possessionTeam() === t
    const bxt = b.x * dir
    const byt = b.y * dir

    const lx0 = (p.hn.x - 0.5) * P.L
    const ly0 = (p.hn.y - 0.5) * P.W

    const kx = 0.10 + 0.36 * p.line // 后卫几乎不跟球漂，前锋跟随最多
    const ky = 0.42 + 0.34 * p.line

    let lx = lx0 + bxt * kx
    let ly = ly0 * (0.72 + 0.6 * tac.width) + byt * ky * (1 - 0.30 * tac.width)

    // 新指令的持球宽度：只缩放相对球队中心的横向偏移，不把整体随球移动当成宽度；每个目标只缩放一次。
    const v2 = tac.instructions
    if (v2 && inPoss) {
      const center = this.possessionCenterY(t)
      const sign = triOf(v2.possession.width)
      const widthEff = execution(this.teamFamiliarity(t), this.tacticsParams, INSTRUCTION_DIFFICULTY.width)
      ly = center + (ly - center) * (1 + this.tacticsParams.wWidth * sign * widthEff)
    }

    const rawLine = v2 ? this.tacticsParams.lineValue[v2.defense.line] : tac.line
    const effLine = v2
      ? 0.5 + (rawLine - 0.5) * (t.lineBias ?? execution(this.teamFamiliarity(t), this.tacticsParams, INSTRUCTION_DIFFICULTY.line))
      : tac.line
    lx += K * (inPoss ? (3 + 8 * effLine) : -(2 + 6 * (1 - tac.press)))

    // 新指令的防线纵深：低防线整条后撤并收紧中后场纵深、高防线整体前压（后卫最明显，中场次之）。
    if (v2 && !inPoss) {
      const depth = K * (rawLine - 0.5) * 2 * this.tacticsParams.lineDepth * (t.lineBias ?? 1)
      if (this.tacticalMechanics && depth < 0) {
        // 低位防守优先压缩中场与后卫线之间的肋部/弧顶空当，避免后卫单独退进禁区把越位线拖深。
        lx += depth * (p.line <= 0.35 ? 0.72 : p.line <= 0.55 ? 1.05 : 0.55)
      } else {
        lx += depth * (p.line <= 0.35 ? 1 : p.line <= 0.55 ? 0.6 : 0.15)
      }
    }

    if (!inPoss) {
      // 防线：最高不能超过这条线；同时不能站在球的前面（球门一侧才是防守位置）
      const lineX = clamp(K * (-30 + effLine * 26) + (bxt + P.HL) * 0.16, -40 * K, -5 * K)
      if (p.line <= 0.35) lx = Math.min(lx, lineX)
      if (p.line <= 0.55) lx = Math.min(lx, bxt - 2.0)
      lx = Math.max(lx, -P.HL + 6 * K)
    } else {
      const capLx = p.line >= 0.85 ? P.HL - 9 * K : P.HL - 13 * K
      lx = Math.min(lx, capLx)
      if (p.line >= 0.85) lx = Math.max(lx, Math.min(bxt + 3 * K, P.HL - 9 * K))
      else if (p.line >= 0.6) lx = Math.max(lx, Math.min(bxt + 3 * K, P.HL - 16 * K))
      else if (p.line > 0.35) lx = Math.max(lx, Math.min(bxt - 9 * K, P.HL - 22 * K))
      else if (p.line > 0.22) lx = Math.max(lx, Math.min(bxt - 19 * K, P.HL - 30 * K))
      else lx = Math.max(lx, Math.min(bxt - 32 * K, P.HL - 40 * K))
    }

    lx = clamp(lx, -P.HL + 3, P.HL - 3)
    ly = clamp(ly, -P.HW + 2.5, P.HW - 2.5)
    return { x: lx * dir, y: ly * dir }
  }

  /**
   * 持球宽度缩放的中心：中性宽度下所有外场球员目标的横向均值。
   * 用目标而不是实际位置，避免把球员惯性 / 随球漂移误当成宽度。
   */
  private possessionCenterY(t: PesTeam): number {
    const P = this.spec
    const tac = t.tactics
    const byt = this.ball.y * t.dir
    let sum = 0
    let n = 0
    for (const p of t.players) {
      if (p.slot === 0) continue
      const ly0 = (p.hn.y - 0.5) * P.W
      const ky = 0.42 + 0.34 * p.line
      sum += ly0 * (0.72 + 0.6 * tac.width) + byt * ky * (1 - 0.30 * tac.width)
      n++
    }
    return n ? sum / n : 0
  }

  /* ---- 防线/越位线 ---- */  private secondLastLx(team: PesTeam, oppTeam: PesTeam): number {
    // 倒数第二名对手，包含门将；门将出击 / 被罚下时也按实际位置排序。
    const xs = oppTeam.players.map((o) => o.pos.x * team.dir).sort((a, b) => b - a)
    return xs[1] ?? -this.spec.HL
  }

  private spaceBehindLine(p: PesPlayer, oppTeam: PesTeam): number {
    const deepest = oppTeam.players.filter((o) => o.role !== 'GK')
      .reduce((mn, o) => Math.min(mn, o.pos.x * oppTeam.dir), this.spec.HL)
    if (this.tacticalMechanics) {
      // 新战术机制：度量对方最后一名外场后卫身后的真实草皮深度（到对方球门线距离），
      // 避免进攻者贴越位线站位时把“距后卫前方的距离”误判成没有身后空间。
      if (p.pos.x * oppTeam.dir < deepest - 2.5 * this.spec.K) return 0
      return deepest + this.spec.HL - 18 * this.spec.K
    }
    return p.pos.x * oppTeam.dir - deepest
  }

  private isOffside(team: PesTeam, player: PesPlayer): boolean {
    if (player.role === 'GK') return false
    if (player.pos.x * team.dir < 0.1) return false
    const oppTeam = this.other(team)
    const line = this.secondLastLx(team, oppTeam)
    const ballLx = this.ball.x * team.dir
    const plx = player.pos.x * team.dir
    return plx > line + 0.3 && plx > ballLx + 0.3
  }

  private nearestOpp(pos: Vec2, opps: PesPlayer[]): number {
    let best = 1e9
    for (const o of opps) {
      const d = dist2(pos, o.pos)
      if (d < best) best = d
    }
    return Math.sqrt(best)
  }

  private pressure(p: PesPlayer): number {
    const opps = this.other(this.teams[p.ti]).players
    let s = 0
    for (const o of opps) {
      const d = dist(o.pos, p.pos)
      if (d < 7) s += (1 - d / 7)
    }
    return clamp01(s / 2.2)
  }

  private laneClearance(a: Vec2, b: Vec2, opps: PesPlayer[]): number {
    let min = 1e9
    for (const o of opps) {
      const d = segDist(o.pos.x, o.pos.y, a.x, a.y, b.x, b.y)
      if (d < min) min = d
    }
    return min
  }

  /* ---- 执行动作 ---- */
  private execPass(p: PesPlayer, mate: PesPlayer, press: number, target?: Vec2): void {
    this.noteOpenKick(p)
    const K = this.spec.K
    const t = this.teams[p.ti]
    // 空当落点不参与越位判定：冻结出脚瞬间球和接球人的实际位置。
    const spaceOffside = target ? this.rules.offside && this.isOffside(t, mate) : false
    const d = dist(p.pos, target ?? mate.pos)
    this.metrics?.pass(this, p, mate.pos, dist(p.pos, mate.pos))
    const lead = clamp(d / 16, 0.15, 1.7)
    const errAng = (1 - p.ab.passing) * 0.075 * (d / 22) + press * 0.04
    let ang = (this.rng.float() - 0.5) * 2 * errAng

    let tx = target?.x ?? (mate.pos.x + mate.vel.x * lead * 0.9)
    let ty = target?.y ?? (mate.pos.y + mate.vel.y * lead * 0.9)
    // 接了结算模型：先判成败，再决定球往哪飞（出脚误差只剩演出）
    let verdict: PassVerdict | null = null
    let kind: PassKind = 'short'
    if (this.contact) {
      kind = target ? 'through' : this.passKind(p, mate)
      verdict = this.contact.pass(this, p, mate, { x: tx, y: ty }, kind, false)
      ang *= 0.25
      const aim = this.stagePassAim(p, tx, ty, verdict)
      tx = aim.x
      ty = aim.y
    }
    if (target) this.metrics?.spacePass(p.ti, verdict?.result === 'ok')
    const dx = tx - p.pos.x
    const dy = ty - p.pos.y
    const ca = Math.cos(ang)
    const sa = Math.sin(ang)
    tx = p.pos.x + dx * ca - dy * sa
    ty = p.pos.y + dx * sa + dy * ca

    const dd = Math.hypot(tx - p.pos.x, ty - p.pos.y)
    const speed = clamp(8 + dd * 0.45, 9, 27)
    const u = norm(tx - p.pos.x, ty - p.pos.y)
    const loft = target ? false : dd > 32 * K || (this.laneClearance(p.pos, mate.pos, this.other(t).players) < 1.6 && dd > 17 * K)

    const b = this.ball
    b.owner = -1
    b.x = p.pos.x + u.x * 0.55
    b.y = p.pos.y + u.y * 0.55
    b.z = 0.05
    b.vx = u.x * speed
    b.vy = u.y * speed
    b.vz = loft ? clamp(3.0 + dd * 0.10, 4.0, 9.0) : 0
    b.spin = (this.rng.float() - 0.5) * 2.0
    if (verdict) {
      let offside = target ? spaceOffside : this.rules.offside && this.isOffside(t, mate)
      if (offside && this.contact!.beatsOffside(this, mate)) offside = false
      b.meta = { type: 'pass', from: p.pid, intended: mate.pid, offside, result: verdict.result, loft,
        ...(target ? { plannedTarget: { ...target }, flightKind: 'space' as const } : {}) }
      if (verdict.interceptor >= 0) b.meta.icpt = verdict.interceptor
      this.event('pass', p.ti, [p.pid, mate.pid], undefined, {
        kind, result: verdict.result, p: Math.round(verdict.p * 1000) / 1000,
        ...(target ? { plannedX: target.x, plannedY: target.y } : {}),
        ...(verdict.interceptor >= 0 ? { icpt: verdict.interceptor } : {}),
      })
    } else b.meta = { type: 'pass', from: p.pid, intended: mate.pid,
      offside: target ? spaceOffside : this.isOffside(t, mate),
      ...(target ? { plannedTarget: { ...target }, flightKind: 'space' as const } : {}) }
    b.lastTouch = p.pid
    b.looseT = 0

    p.noClaim = 0.40
    p.touches++
    p.mode = 'idle'
    t.stats.passes++
  }

  /**
   * 接了结算模型的射门：成败（进球 / 被扑 / 封堵 / 偏出）由模型判定，然后让球按结果飞——
   * 进球飞向门将另一侧、被扑飞向门将、封堵在射手身边弹开、偏出飞向门外或门框上方。
   */
  private execShotSettled(p: PesPlayer, req: ShotRequest): void {
    const P = this.spec
    const K = P.K
    const t = this.teams[p.ti]
    const g = this.oppGoalOf(t)
    const gk = this.keeperOf(this.other(t))
    const v: ShotVerdict = this.contact!.shot(this, p, req)
    const b = this.ball
    b.owner = -1
    b.spin = 0
    t.stats.shots++
    t.stats.xg += v.xg
    p.noClaim = 0.45
    p.shotCd = 0.9
    p.touches++
    this.event('shot', p.ti, [p.pid], v.xg, { ...v.meta, result: v.result, header: req.header, penalty: req.penalty, freeKick: req.freeKick, ...(v.blocker >= 0 ? { blocker: v.blocker } : {}) })
    if (v.result === 'block') {
      const uu = norm((this.rng.float() - 0.5) * 2, (this.rng.float() - 0.5) * 2)
      b.x = p.pos.x + uu.x * 0.6
      b.y = p.pos.y + uu.y * 0.6
      b.z = 0.3
      b.vx = uu.x * 14
      b.vy = uu.y * 14
      b.vz = 2.5
      b.meta = { type: 'blocked', from: p.pid, result: 'block' }
      b.lastTouch = v.blocker >= 0 ? v.blocker : p.pid
      b.looseT = 0
      p.noClaim = 0.5
      p.shotCd = 0.6
      return
    }
    const gy = gk ? gk.pos.y : 0
    let aimY: number
    let tz: number
    if (v.result === 'goal') {
      // 打门将另一侧
      const side = Math.abs(gy) < 0.3 ? (this.rng.float() < 0.5 ? -1 : 1) : (gy > 0 ? -1 : 1)
      aimY = side * P.GOAL_HALF * (0.4 + 0.45 * this.rng.float())
      tz = 0.2 + 1.6 * this.rng.float()
    } else if (v.result === 'save') {
      aimY = clamp(gy + (this.rng.float() - 0.5) * 1.4, -P.GOAL_HALF + 0.3, P.GOAL_HALF - 0.3)
      tz = 0.4 + 1.0 * this.rng.float()
    } else if (this.rng.float() < 0.4) {
      // 打高
      aimY = (this.rng.float() - 0.5) * 2 * P.GOAL_HALF * 0.8
      tz = 2.8 + 1.4 * this.rng.float()
    } else {
      // 打偏
      aimY = (this.rng.float() < 0.5 ? -1 : 1) * (P.GOAL_HALF + 0.5 + 2.2 * this.rng.float())
      tz = 0.3 + 1.5 * this.rng.float()
    }
    const speed = req.header ? 15 + 4 * this.rng.float() : clamp(23 + p.ab.shooting * 8 - dist(p.pos, g) * 0.10, 17, 32)
    const z0 = req.header ? 1.8 : dist(p.pos, g) < 16 * K ? 0.05 : 0.35
    const plane = t.dir * (P.HL - 0.1)
    // Restored/custom placements may be on the goal plane: keep the launch finite and in front of it.
    const originX = Math.min(p.pos.x * t.dir, P.HL - 0.2) * t.dir
    const launch = () => {
      const u = norm(plane - originX, aimY - p.pos.y)
      // Do not spawn an extremely close shot beyond the goal plane.
      const offset = Math.min(0.55, Math.max(0, (plane - originX) / u.x) * 0.5)
      const x = originX + u.x * offset
      const y = p.pos.y + u.y * offset
      const drag = Math.exp(-0.05 * P.DT)
      const span = Math.abs(plane - x) * (1 - drag) / (Math.abs(u.x) * speed * P.DT * drag)
      const frames = Math.max(1, Math.ceil(Math.log(Math.max(1e-9, 1 - span)) / Math.log(drag)))
      const flight = frames * P.DT
      // Match updateBall's discrete drag/gravity, starting at the actual launch point.
      const vz = (tz - z0) / flight + 9.81 * (frames + 1) * P.DT / 2
      return { x, y, vx: u.x * speed, vy: u.y * speed, vz }
    }
    let flight = launch()
    if (v.result === 'miss' && tz > P.GOAL_H && flight.vz > 12) {
      // Too close to lift above the bar within the vertical-speed limit: stage a wide miss instead.
      aimY = (Math.sign(p.pos.y) || Math.sign(aimY) || 1) * (P.GOAL_HALF + 1.5)
      tz = 0.3
      flight = launch()
    }
    b.x = flight.x
    b.y = flight.y
    b.z = z0
    b.vx = flight.vx
    b.vy = flight.vy
    b.vz = clamp(flight.vz, req.header ? -9 : 0, 12)
    b.meta = { type: 'shot', from: p.pid, xg: v.xg, result: v.result, hold: v.hold, header: req.header }
    b.lastTouch = p.pid
    b.looseT = 0
  }

  private execShot(p: PesPlayer, press: number, req: ShotRequest = { header: false, penalty: false, freeKick: false }): void {
    this.noteOpenKick(p)
    if (this.contact) {
      this.execShotSettled(p, req)
      return
    }
    const P = this.spec
    const K = P.K
    const t = this.teams[p.ti]
    const g = this.oppGoalOf(t)
    const d = dist(p.pos, g)
    const spread = 1.1 + (1 - p.ab.shooting) * 4.2 + press * 1.6 + d * 0.09
    let aimY = (this.rng.float() - 0.5) * 2 * (P.GOAL_HALF + 0.9)
    aimY += (this.rng.float() - 0.5) * spread

    const u = norm(g.x - p.pos.x, aimY - p.pos.y)
    // 封堵：射门线路上有防守球员
    const opps = this.other(t).players
    let blocked = false
    for (const o of opps) {
      if (o.role === 'GK' || (o.pos.x - p.pos.x) * t.dir <= 0.25 || dist(o.pos, p.pos) > 9) continue
      if (segDist(o.pos.x, o.pos.y, p.pos.x, p.pos.y, g.x, aimY) < 1.25) {
        blocked = true
        break
      }
    }
    const speed = clamp(23 + p.ab.shooting * 8 - d * 0.10, 17, 32)
    const b = this.ball
    b.owner = -1
    b.x = p.pos.x + u.x * 0.55
    b.y = p.pos.y + u.y * 0.55
    b.z = d < 16 * K ? 0.05 : 0.35
    b.vx = u.x * speed
    b.vy = u.y * speed
    b.vz = d > 20 * K ? 2.0 : 0.6
    b.spin = (this.rng.float() - 0.5) * 3.5
    // 期望进球：距离 + 射门角度
    const ang = 2 * Math.atan2(P.GOAL_HALF, d)
    const xg = clamp01(Math.exp(-d / (8.5 * K)) * (0.26 + ang * 0.85) * (0.7 + 0.6 * p.ab.shooting))
    b.meta = { type: 'shot', from: p.pid, xg }
    if (blocked && this.rng.float() < 0.55) {
      const uu = norm((this.rng.float() - 0.5) * 2, (this.rng.float() - 0.5) * 2)
      b.vx = uu.x * 14
      b.vy = uu.y * 14
      b.vz = 2.5
      b.meta = { type: 'blocked', from: p.pid }
      p.noClaim = 0.5
      p.shotCd = 0.6
      this.event('block', p.ti, [p.pid])
      return
    }
    b.lastTouch = p.pid
    b.looseT = 0

    p.noClaim = 0.45
    p.shotCd = 0.9
    p.touches++
    t.stats.shots++
    t.stats.xg += xg
    this.event('shot', p.ti, [p.pid], xg)
  }

  private execClear(p: PesPlayer): void {
    this.noteOpenKick(p)
    const P = this.spec
    const K = P.K
    const t = this.teams[p.ti]
    const dir = t.dir
    const b = this.ball
    const ty = clamp(p.pos.y + (this.rng.float() - 0.5) * 28 * K, -P.HW + 5, P.HW - 5)
    const tx = p.pos.x + dir * K * (30 + this.rng.float() * 18)
    const u = norm(tx - p.pos.x, ty - p.pos.y)
    b.owner = -1
    b.x = p.pos.x + u.x * 0.55
    b.y = p.pos.y + u.y * 0.55
    b.z = 0.5
    b.vx = u.x * 21
    b.vy = u.y * 21
    b.vz = 9.0
    b.spin = 0
    b.meta = { type: 'clear', from: p.pid }
    b.lastTouch = p.pid
    b.looseT = 0
    p.noClaim = 0.45
    p.touches++
  }

  private execCarry(p: PesPlayer): void {
    const P = this.spec
    const t = this.teams[p.ti]
    const g = this.oppGoalOf(t)
    const toGoal = norm(g.x - p.pos.x, g.y - p.pos.y)
    const side = { x: -toGoal.y, y: toGoal.x }
    const wig = (this.rng.float() - 0.5) * 0.6
    p.target = {
      x: clamp(p.pos.x + toGoal.x * 6 + side.x * wig * 3, -P.HL + 2, P.HL - 2),
      y: clamp(p.pos.y + toGoal.y * 6 + side.y * wig * 3, -P.HW + 2, P.HW - 2),
    }
    p.urgency = 0.80
    p.mode = 'carry'
  }

  /* ---------- 球 ---------- */
  private interceptPoint(p: PesPlayer, maxT: number): Vec2 {
    maxT = maxT || 1.6
    const sp = Math.max(2.5, this.maxSpeed(p) * 0.95)
    let best = this.predictBall(0.15)
    let bestD = 1e9
    for (let t = 0.1; t <= maxT + 1e-6; t += 0.1) {
      const q = this.predictBall(t)
      const need = dist(p.pos, q)
      if (need <= sp * t + 1.0) return q
      if (need - sp * t < bestD) {
        bestD = need - sp * t
        best = q
      }
    }
    return best
  }

  private predictBall(t: number): Vec2 {
    const b = this.ball
    const k = b.z > 0.05 ? 0.05 : 0.42
    const f = (1 - Math.exp(-k * t)) / k
    return { x: b.x + b.vx * f, y: b.y + b.vy * f }
  }

  private updateBall(dt: number): void {
    const b = this.ball
    if (b.owner >= 0) {
      const p = this.players[b.owner]
      const f = p.facing
      b.x = p.pos.x + f.x * 0.5
      b.y = p.pos.y + f.y * 0.5
      b.z = 0
      b.vz = 0
      b.vx = p.vel.x
      b.vy = p.vel.y
      b.spin *= 0.9
      b.looseT = 0
      return
    }
    if (b.frozen) return

    b.looseT += dt

    if (b.z > 0.01 || b.vz > 0.01) {
      b.vz -= 9.81 * dt
      b.z += b.vz * dt
      if (b.z <= 0) {
        b.z = 0
        if (b.vz < -1.6) {
          b.vz = -b.vz * 0.5
          b.vx *= 0.85
          b.vy *= 0.85
        } else b.vz = 0
      }
      const drag = Math.exp(-0.05 * dt)
      b.vx *= drag
      b.vy *= drag
      if (Math.abs(b.spin) > 0.05) {
        const sp = len(b.vx, b.vy) || 1
        const ax = -b.vy / sp * b.spin * 0.9
        const ay = b.vx / sp * b.spin * 0.9
        b.vx += ax * dt
        b.vy += ay * dt
        b.spin *= Math.exp(-0.5 * dt)
      }
    } else {
      const sp = len(b.vx, b.vy)
      if (sp > 0.02) {
        const dec = (0.55 + 0.012 * sp * sp) * dt
        const ns = Math.max(0, sp - dec)
        b.vx *= ns / sp
        b.vy *= ns / sp
      } else {
        b.vx = 0
        b.vy = 0
      }
    }
    b.x += b.vx * dt
    b.y += b.vy * dt
  }

  private resolvePossession(): void {
    const b = this.ball
    // 传中 / 角球 / 任意球传中的高球落下来：先争顶
    if (this.contact && b.owner < 0 && !b.frozen && b.meta && b.meta.cross && !b.meta.aerialDone && b.vz < 0 && b.z < 2.3 && this.aerialDuel()) return
    if (b.owner >= 0 || b.frozen || b.z > 1.9) return

    const sp = len(b.vx, b.vy)
    // 结算已经判了结果的球：该拿球的人拿得到，别人在这段时间里拿不到
    const mt = this.contact ? b.meta : null
    const decided = !!mt && mt.type === 'pass' && !mt.cross // 传中的球不预先指定谁拿：落点争顶 / 谁先到谁拿
    const forced = (q: PesPlayer): boolean => decided && ((mt!.result === 'ok' && q.pid === mt!.intended) || (mt!.result === 'icpt' && q.pid === mt!.icpt))
    // All claiming paths, including the anti-stall fallback, share the same protection.
    const eligible = (p: PesPlayer): boolean => {
      if (p.noClaim > 0) return false
      if (!mt?.result) return true
      if (mt.type === 'shot' && b.looseT < 2.5) return false
      if (decided && b.looseT < 3.0) {
        if (mt.result === 'ok') return p.pid === mt.intended
        if (mt.result === 'icpt') return p.pid === mt.icpt
        if (mt.result === 'miss') return p.pid !== mt.intended
        if (mt.result === 'out') return false
      }
      return true
    }
    const claimants: PesPlayer[] = []
    let best: PesPlayer | null = null
    let bd = 1e9
    for (const t of this.teams) {
      for (const p of t.players) {
        if (!eligible(p)) continue
        const d = dist(p.pos, b)
        let reach = 0.78 + p.ab.control * 0.45 + (sp < 6 ? 0.35 : 0)
        if (b.meta && b.meta.intended === p.pid) reach += 0.35 // 接球人更容易拿到
        if (forced(p)) reach += 0.5
        if (d > reach) continue
        if (sp > 6 && !forced(p)) {
          let ok = p.ab.control * 0.55 + 0.45 - sp / 55
          if (b.meta && b.meta.intended === p.pid) ok += 0.25
          if (this.rng.float() > ok) continue
        }
        if (mt) claimants.push(p)
        if (d < bd) {
          bd = d
          best = p
        }
      }
    }
    // 几个人同时够得着：该拿球的人优先，其余按二点球争夺的权重（属性）抽签
    if (mt && claimants.length > 1) best = claimants.find(forced) ?? this.players[this.contact!.loose(this, claimants)]
    if (!best) {
      if (b.looseT > 2.0) {
        // 长时间无人控制：最近球员强制得到
        let near: PesPlayer | null = null
        let nd = 1e9
        for (const t of this.teams) {
          for (const p of t.players) {
            if (!eligible(p)) continue
            const d = dist(p.pos, b)
            if (d < nd) {
              nd = d
              near = p
            }
          }
        }
        if (near && nd < 3.2) best = near
      } else return
      if (!best) return
    }

    // 越位
    if (b.meta && b.meta.type === 'pass' && b.meta.intended === best.pid && b.meta.offside) {
      const bestTeam = this.teams[best.ti]
      const off = this.other(bestTeam)
      bestTeam.stats.offsides++
      this.event('offside', best.ti, [best.pid])
      this.setRestart('fk', { x: best.pos.x, y: best.pos.y }, off)
      return
    }

    if (b.meta && b.meta.type === 'pass' && b.meta.from >= 0 && this.players[b.meta.from].ti === best.ti && b.meta.from !== best.pid) {
      this.teams[best.ti].stats.passesOk++
      if (this.tacticalMechanics && this.openPlay.phase === 'open' && this.metrics && !this.metrics.isCross(b.meta)) this.metrics.receive(this, best)
      if (b.meta.flightKind === 'space' && b.meta.intended === best.pid) this.metrics?.spaceReceive(best.ti, b.meta.result === 'ok')
    }
    b.owner = best.pid
    const bestTeam = this.teams[best.ti]
    if (bestTeam.tactics.instructions) {
      const rawHold = 0.55 + this.rng.float() * 0.55
      const rawTempo = this.tacticsParams.tempoValue[bestTeam.tactics.instructions.possession.tempo]
      const effTempo = 0.5 + (rawTempo - 0.5) * execution(best.familiarity ?? 1, this.tacticsParams, INSTRUCTION_DIFFICULTY.tempo)
      best.holdUntil = this.time + rawHold * clamp(1.45 - 0.90 * effTempo, 0.55, 1.35)
    } else {
      best.holdUntil = this.time + 0.55 + this.rng.float() * 0.55
    }
    b.meta = null
    b.z = 0
    b.vx = b.vy = b.vz = 0
    b.lastTouch = best.pid
    b.looseT = 0
    best.touches++
    best.noClaim = 0
  }

  /* ---------- 移动 ---------- */
  private move(p: PesPlayer, dt: number): void {
    const t = this.teams[p.ti]

    const dx = p.target.x - p.pos.x
    const dy = p.target.y - p.pos.y
    const d = Math.hypot(dx, dy)

    let want = this.maxSpeed(p) * clamp(p.urgency, 0.1, 1) * 0.88
    if (this.ball.owner === p.pid) {
      // 带球本身就慢，且被贴身时更慢
      want *= 0.78 + 0.14 * p.ab.control
      let close = 0
      for (const o of this.other(t).players) {
        const dd = dist(o.pos, p.pos)
        if (dd < 2.4) close += (2.4 - dd) / 2.4
      }
      want *= clamp(1 - 0.20 * close, 0.5, 1)
    }
    const arrive = (p.mode === 'press' || p.mode === 'mark' || p.mode === 'cover') ? 0.7 : 2.6
    if (d < arrive) want *= d / arrive
    if (d < 0.12) want = 0

    let dvx = d > 1e-6 ? dx / d * want : 0
    let dvy = d > 1e-6 ? dy / d * want : 0

    // 分离力
    for (const q of t.players) {
      if (q === p) continue
      const ex = p.pos.x - q.pos.x
      const ey = p.pos.y - q.pos.y
      const e2 = ex * ex + ey * ey
      if (e2 < 7.3 && e2 > 1e-4) {
        const e = Math.sqrt(e2)
        const f = (2.7 - e) * 0.32
        dvx += ex / e * f
        dvy += ey / e * f
      }
    }

    const acc = this.maxAccel(p) * dt
    p.vel.x += clamp(dvx - p.vel.x, -acc, acc)
    p.vel.y += clamp(dvy - p.vel.y, -acc, acc)

    const sp = Math.hypot(p.vel.x, p.vel.y)
    const cap = this.maxSpeed(p) * 1.05
    if (sp > cap) {
      p.vel.x *= cap / sp
      p.vel.y *= cap / sp
    }

    const P = this.spec
    const ox = p.pos.x
    const oy = p.pos.y
    p.pos.x += p.vel.x * dt
    p.pos.y += p.vel.y * dt
    p.pos.x = clamp(p.pos.x, -P.HL + 0.6, P.HL - 0.6)
    p.pos.y = clamp(p.pos.y, -P.HW + 0.6, P.HW - 0.6)

    const moved = Math.hypot(p.pos.x - ox, p.pos.y - oy)
    p.distance += moved
    t.stats.distance += moved

    // 朝向
    const fs = Math.hypot(p.vel.x, p.vel.y)
    let fx: number
    let fy: number
    if (fs > 0.6) {
      fx = p.vel.x / fs
      fy = p.vel.y / fs
    } else {
      const tgt: Vec2 = this.ball.owner === p.pid ? this.oppGoalOf(t) : this.ball
      const u = norm(tgt.x - p.pos.x, tgt.y - p.pos.y)
      fx = u.x
      fy = u.y
    }
    const k = 1 - Math.exp(-10 * dt)
    p.facing.x = lerp(p.facing.x, fx, k)
    p.facing.y = lerp(p.facing.y, fy, k)
    const fl = Math.hypot(p.facing.x, p.facing.y) || 1
    p.facing.x /= fl
    p.facing.y /= fl

    // 体能
    const spd = Math.hypot(p.vel.x, p.vel.y)
    if (this.rules.fatigue === 'distance') {
      // 按跑动距离消耗、耐力越高越慢（对齐现有引擎，计划 3.3 / 4.7）。
      // 以 D = 900 为基准，D 不同时按 900 / D 缩放：跑完整场的体力曲线与 D 无关。
      // 耐力因子 0.509 + 0.617 × 能力，等价于现有引擎的 0.7 + 耐力评分 / 180。
      const ef = 0.509 + 0.617 * p.ab.stamina
      if (spd < 0.8) p.stamina = clamp01(p.stamina + 2e-4 * dt)
      else p.stamina = clamp01(p.stamina - moved * this.rules.fatiguePerMeter * (900 / (P.HALF * 2)) * (0.6 + 0.4 * (spd / 5) ** 2) / ef)
    } else {
      const drain = 1.05e-4 * (0.35 + (spd / 7.2) ** 3 * 1.5) * (1.35 - 0.5 * p.ab.stamina)
      p.stamina = clamp01(p.stamina + (spd > 3.0 ? -drain : 4.5e-5) * dt)
    }
  }

  private tryTackles(): void {
    const P = this.spec
    const att = this.ball.owner >= 0 ? this.players[this.ball.owner] : null
    if (!att || att.stun > 0 || this.ball.frozen) return
    for (const t of this.teams) {
      if (t === this.teams[att.ti]) continue
      for (const d of t.players) {
        // A foul/restart, keeper claim or successful tackle ends this contest immediately.
        if (this.ball.frozen || this.ball.owner !== att.pid || att.stun > 0) return
        if (d.stun > 0 || d.tackleCd > 0) continue
        if (d.role === 'GK') {
          // 门将出击：禁区内近身直接没收
          const inBox = Math.abs(att.pos.x) > P.HL - P.PEN_D && Math.abs(att.pos.y) < P.PEN_W / 2
            && (att.pos.x > 0) === (t.dir < 0)
          if (inBox && dist(d.pos, att.pos) < 2.1) {
            d.tackleCd = 0.8
            if (this.rng.float() < 0.6) {
              const b = this.ball
              b.owner = d.pid
              b.vx = b.vy = b.vz = 0
              b.z = 0
              b.meta = null
              b.lastTouch = d.pid
              d.holdUntil = this.time + 0.9 + this.rng.float() * 0.8
              att.stun = 0.4
              att.noClaim = 0.4
              t.stats.saves++
              this.event('save', d.ti, [d.pid], undefined, { claim: true })
            }
          }
          continue
        }
        if (dist(d.pos, att.pos) < 1.7) this.tryTackle(d, att)
      }
    }
  }

  /** 近身对抗交给结算模型：持球人摆脱 / 被干净断球 / 犯规（可能出牌、点球）/ 球滚向一旁。 */
  private tackleSettled(def: PesPlayer, att: PesPlayer): void {
    const v = this.contact!.duel(this, def, att)
    const b = this.ball
    const meta = { outcome: v.outcome, p: Math.round(v.p * 1000) / 1000 }
    if (v.outcome === 'foul') {
      this.awardFoul(def, att, v)
      return
    }
    if (v.outcome === 'tackle') {
      this.teams[def.ti].stats.tackles++
      const u = norm(att.pos.x - def.pos.x + (this.rng.float() - 0.5), att.pos.y - def.pos.y + (this.rng.float() - 0.5))
      b.owner = -1
      b.x = att.pos.x
      b.y = att.pos.y
      b.z = 0.08
      b.vx = u.x * (3.5 + this.rng.float() * 4.5)
      b.vy = u.y * (3.5 + this.rng.float() * 4.5)
      b.vz = 0
      b.meta = { type: 'loose', from: def.pid }
      b.lastTouch = def.pid
      b.looseT = 0
      att.stun = 0.30
      att.noClaim = 0.30
      def.noClaim = 0.10
      this.event('tackle', def.ti, [def.pid, att.pid], undefined, meta)
    } else if (v.outcome === 'loose') {
      const u = norm(def.pos.x - att.pos.x + (this.rng.float() - 0.5), def.pos.y - att.pos.y + (this.rng.float() - 0.5))
      b.owner = -1
      b.x = (att.pos.x + def.pos.x) / 2
      b.y = (att.pos.y + def.pos.y) / 2
      b.z = 0.08
      b.vx = u.x * (1.5 + this.rng.float() * 2.5)
      b.vy = u.y * (1.5 + this.rng.float() * 2.5)
      b.vz = 0
      b.meta = { type: 'loose', from: def.pid }
      b.lastTouch = att.pid
      b.looseT = 0
      att.noClaim = 0.15
      def.noClaim = 0.15
      this.event('duel', def.ti, [def.pid, att.pid], undefined, meta)
    } else {
      this.event('duel', def.ti, [def.pid, att.pid], undefined, meta)
    }
    if (v.injured >= 0) this.event('injury', this.players[v.injured].ti, [v.injured], undefined, { days: v.recoveryDays })
  }

  private tryTackle(def: PesPlayer, att: PesPlayer): void {
    if (def.tackleCd > 0 || att.role === 'GK' || att.noClaim > 0.05) return
    const d = dist(def.pos, att.pos)
    if (d > 1.6) return

    def.tackleCd = 0.75 + this.rng.float() * 0.35

    const defTeam = this.teams[def.ti]
    if (this.contact) {
      this.tackleSettled(def, att)
      return
    }
    // 犯规
    if (this.rng.float() < 0.03 * (0.5 + defTeam.tactics.aggression)) {
      defTeam.stats.fouls++
      this.event('foul', def.ti, [def.pid, att.pid])
      this.setRestart('fk', { x: att.pos.x, y: att.pos.y }, this.teams[att.ti])
      return
    }

    const rel = Math.hypot(def.vel.x - att.vel.x, def.vel.y - att.vel.y)
    // 是否卡在持球者与球门之间
    const g = this.goalOf(defTeam)
    const goalSide = dist(def.pos, g) < dist(att.pos, g)
    let ps = clamp01(def.ab.tackling * 0.85 - att.ab.control * 0.55 + 0.28)
    ps *= 0.85 + 0.3 * defTeam.tactics.aggression
    ps *= clamp01(1.1 - rel / 8)
    if (!goalSide) ps *= 0.65

    if (this.rng.float() >= ps) return

    defTeam.stats.tackles++
    const b = this.ball
    const u = norm(att.pos.x - def.pos.x + (this.rng.float() - 0.5), att.pos.y - def.pos.y + (this.rng.float() - 0.5))
    b.owner = -1
    b.x = att.pos.x
    b.y = att.pos.y
    b.z = 0.08
    b.vx = u.x * (3.5 + this.rng.float() * 4.5)
    b.vy = u.y * (3.5 + this.rng.float() * 4.5)
    b.vz = 0
    b.meta = { type: 'loose', from: def.pid }
    b.lastTouch = def.pid
    b.looseT = 0
    att.stun = 0.30
    att.noClaim = 0.30
    def.noClaim = 0.10
    this.event('tackle', def.ti, [def.pid, att.pid])
  }

  /* ---------- 规则 ---------- */
  private checkRules(): void {
    const P = this.spec
    const b = this.ball
    if (b.frozen || b.owner >= 0) return

    // 射正统计（球越过门线平面；打高的球不算射正）
    if (b.meta && b.meta.type === 'shot' && Math.abs(b.x) > P.HL - 0.1) {
      if (!b.meta.counted && (this.contact ? b.meta.result === 'goal' : Math.abs(b.y) < P.GOAL_HALF + 0.15 && b.z < P.GOAL_H)) this.teams[this.players[b.meta.from].ti].stats.shotsOn++
      b.meta.counted = true
    }

    // 进球：接了结算模型的射门由判定结果说了算（球越过门线且结果是 goal）；其余看几何
    // 接了模型时进球只来自结算判定为 goal 的射门——传球、传中、解围、反弹的球就算滚进门框也不算（按出界处理）：
    // 这样每个进球都对应恰好一脚 goal 射门，事件和统计自洽。
    const scripted = this.contact && b.meta && b.meta.type === 'shot' && b.meta.result ? b.meta : null
    const crossed = Math.abs(b.x) > P.HL - 0.1
    const isGoal = this.contact ? crossed && !!scripted && scripted.result === 'goal' : crossed && Math.abs(b.y) < P.GOAL_HALF && b.z < P.GOAL_H
    if (isGoal) {
      const scorer = Math.sign(b.x) === this.teams[0].dir ? this.teams[0] : this.teams[1]
      scorer.score++
      scorer.stats.goals++
      const conceded = this.other(scorer)
      const last = b.lastTouch >= 0 ? this.players[b.lastTouch] : null
      this.event('goal', this.tiOf(scorer), last ? [last.pid] : [], undefined, {
        ...(last && this.teams[last.ti] !== scorer ? { own: true } : {}),
        ...(scripted ? { header: !!scripted.header } : {}),
      })
      this.setupKickoff(conceded)
      return
    }

    this.gkSave()

    if (Math.abs(b.y) > P.HW - 0.05) {
      const last = b.lastTouch >= 0 ? this.players[b.lastTouch] : null
      const team = last ? this.other(this.teams[last.ti]) : this.teams[0]
      this.setRestart('throwin', { x: clamp(b.x, -P.HL + 4, P.HL - 4), y: Math.sign(b.y) * (P.HW - 0.35) }, team)
      return
    }

    if (Math.abs(b.x) > P.HL - 0.05) {
      const sideSign = Math.sign(b.x)
      // 出底线的那一端是谁的球门：该端的进攻方是 dir 与 sideSign 相同的球队，所以防守方是另一队
      const defending = sideSign === this.teams[0].dir ? this.teams[1] : this.teams[0]
      const attacking = this.other(defending)
      const last = b.lastTouch >= 0 ? this.players[b.lastTouch] : null
      // 防守方最后触球出底线 = 进攻方角球；进攻方最后触球出底线 = 防守方球门球
      if (last && this.teams[last.ti] === defending) {
        attacking.stats.corners++
        this.setRestart('corner', { x: sideSign * (P.HL - 0.35), y: Math.sign(b.y || 1) * (P.HW - 0.35) }, attacking)
      } else {
        this.setRestart('goalkick', { x: sideSign * (P.HL - 5.5), y: 0 }, defending)
      }
    }
  }

  /** 结算判定“被扑”的射门：球进入门前 7K 米内时门将必定扑到——抱住或脱手（近门柱时打出底线形成角球）。 */
  private gkSaveSettled(): void {
    const P = this.spec
    const K = P.K
    const b = this.ball
    if (b.saveCd > 0) {
      b.saveCd -= P.DT
      return
    }
    const mt = b.meta
    if (!mt || mt.type !== 'shot' || mt.result !== 'save') return
    const shooter = this.players[mt.from]
    for (const t of this.teams) {
      if (t === this.teams[shooter.ti]) continue
      const gk = this.keeperOf(t)
      if (!gk) continue
      const g = this.goalOf(t)
      if (b.vx * Math.sign(g.x - b.x) <= 0) continue
      if (dist(b, g) > 7.0 * K) continue
      gk.pos.y += (b.y - gk.pos.y) * 0.7 // 扑过去
      t.stats.saves++
      this.other(t).stats.shotsOn++
      b.saveCd = 0.5
      const hold = !!mt.hold
      const nearGoal = dist(shooter.pos, g) * (100 / P.L) < 18
      this.event('save', gk.ti, [gk.pid, shooter.pid], undefined, { hold, corner: !hold && nearGoal })
      b.lastTouch = gk.pid
      b.looseT = 0
      if (hold) {
        b.owner = gk.pid
        b.vx = b.vy = b.vz = 0
        b.z = 0
        b.meta = null
        gk.holdUntil = this.time + 1.0 + this.rng.float() * 1.0
      } else if (nearGoal) {
        // 扑出底线：沿球门线外侧飞出，形成角球
        const side = b.y >= 0 ? 1 : -1
        const out = norm(g.x + Math.sign(g.x) * 0.4 - b.x, side * (P.GOAL_HALF + 1.2) - b.y)
        b.vx = out.x * 12
        b.vy = out.y * 12
        b.vz = 3
        b.meta = { type: 'save', from: gk.pid }
      } else {
        // 脱手：球弹回禁区，双方争抢
        const away = norm(b.x - g.x, (b.y >= 0 ? 1 : -1) * 0.8)
        b.vx = away.x * 9
        b.vy = away.y * 9
        b.vz = 3
        b.meta = { type: 'save', from: gk.pid }
      }
      return
    }
  }

  private gkSave(): void {
    if (this.contact) {
      this.gkSaveSettled()
      return
    }
    const P = this.spec
    const K = P.K
    const b = this.ball
    if (b.saveCd > 0) {
      b.saveCd -= P.DT
      return
    }
    for (const t of this.teams) {
      const g = this.goalOf(t)
      const gk = t.players[0]
      if (b.vx * Math.sign(g.x - b.x) <= 0) continue
      const dGoal = dist(b, g)
      if (dGoal > 7.0 * K || b.z > 2.7) continue
      if (this.rng.float() < 0.25) continue
      const reach = 1.1 + gk.ab.handling * 0.85
      if (Math.abs(b.y - gk.pos.y) > reach || Math.abs(b.z - 0.9) > 1.6) continue

      const pSave = clamp01(0.52 + gk.ab.handling * 0.46 - len(b.vx, b.vy) / 130)
      if (this.rng.float() > pSave) continue

      t.stats.saves++
      if (b.meta && b.meta.type === 'shot') this.other(t).stats.shotsOn++
      b.saveCd = 0.5
      this.event('save', gk.ti, [gk.pid])
      if (this.rng.float() < 0.6) {
        b.owner = gk.pid
        b.vx = b.vy = b.vz = 0
        b.z = 0
        b.meta = null
        b.lastTouch = gk.pid
        gk.holdUntil = this.time + 1.0 + this.rng.float() * 1.0
      } else {
        const away = norm(g.x - b.x, (b.y >= 0 ? 1 : -1) * 1.5)
        b.vx = away.x * 12
        b.vy = away.y * 12
        b.vz = 3
        b.lastTouch = gk.pid
        b.meta = { type: 'save', from: gk.pid }
        b.looseT = 0
      }
      return
    }
  }

  /** Clock + ball metadata fully describe closing, including after JSON restore. */
  private finishHalfFlight(): void {
    const P = this.spec
    const b = this.ball
    const mt = b.meta
    if (this.phase === 'play' && !b.frozen && b.owner < 0 && mt?.type === 'shot' && mt.result) {
      this.updateBall(P.DT)
      // A long/slow shot can stop short under drag, or a save can miss its
      // keeper window. Bound the wait by the serialized flight age, then put
      // the ball at the committed endpoint and use the usual outcome rules.
      if (b.looseT >= Math.max(8, P.L / 8)) {
        const team = this.teams[this.players[mt.from].ti]
        const keeper = this.keeperOf(this.other(team))
        b.x = team.dir * (P.HL - (mt.result === 'save' && keeper ? P.K : 0))
        b.y = mt.result === 'goal' ? 0 : mt.result === 'save' && keeper ? 0 : P.GOAL_HALF + 1
        b.z = mt.result === 'miss' ? P.GOAL_H + 1 : 0.5
        b.vx = team.dir
        b.vy = b.vz = b.spin = b.saveCd = 0
      }
      this.checkRules()
      this.collect(P.DT)
      if (this.phase === 'play' && !b.frozen && b.owner < 0 && b.meta === mt) return
    }
    this.onHalfEnd()
  }

  private onHalfEnd(): void {
    if (this.half === 1) {
      this.half = 2
      this.time = this.spec.HALF
      for (const t of this.teams) {
        t.dir = t.dir === 1 ? -1 : 1
        for (const p of t.players) {
          const hw = this.homeWorld(p)
          p.pos.x = hw.x
          p.pos.y = hw.y
          p.vel.x = p.vel.y = 0
          p.stamina = clamp01(p.stamina + 0.05)
        }
      }
      this.event('half', -1)
      this.setPiece = null
      this.setupKickoff(this.teams[0])
      return
    }
    this.phase = 'end'
    this.event('end', -1)
    if (this.metrics && !this.metricsClosed) {
      this.metrics.finish(this)
      this.metricsClosed = true
    }
  }

  /* ---------- 统计 / 录像 ---------- */
  private collect(dt: number): void {
    const b = this.ball
    if (b.owner >= 0) this.teams[this.players[b.owner].ti].stats.possession += dt
    if (this.recordHz > 0) {
      this.frameAcc += dt
      if (this.frameAcc >= 1 / this.recordHz) {
        this.frameAcc = 0
        this.frames.push({
          t: +this.time.toFixed(2),
          b: [+b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2)],
          p: this.players.map((p): [number, number] => [+p.pos.x.toFixed(2), +p.pos.y.toFixed(2)]),
        })
      }
    }
  }

  /* ---------- 每帧更新压迫/盯人分配 ---------- */
  private instructionTaskKey(t: PesTeam, p: PesPlayer): string {
    if (p.pid === t.presser || p.pid === t.presser2) return 'press'
    if (p.pid === t.cover) return 'cover'
    const marked = t.marks[p.slot]
    return marked !== undefined && marked >= 0 ? `mark:${marked}` : ''
  }

  private instructionTasks(t: PesTeam): Map<number, string> {
    return new Map(t.players.map((p) => [p.pid, this.instructionTaskKey(t, p)]))
  }

  /** 任务变更后只刷新移动目标，不重新决策、不消耗随机数。 */
  private refreshInstructionMovement(p: PesPlayer): void {
    const b = this.ball
    const t = this.teams[p.ti]
    if (p.slot === 0 || b.owner === p.pid) return
    if (p.stun > 0) {
      p.target = { ...p.pos }
      p.urgency = 0.1
      p.mode = 'idle'
      return
    }
    if (b.frozen) {
      if (this.restart?.taker === p.pid) return
      p.runTarget = null
      if (this.contact && this.restart?.type === 'penalty') {
        p.target = this.penaltyPosition(p, this.restart)
        p.urgency = 0.6
      } else {
        const box = this.contact && this.restart ? this.boxPosition(p, this.restart) : null
        p.target = box ?? this.formationTarget(p)
        p.urgency = box ? 0.75 : 0.28
      }
      p.mode = 'idle'
      return
    }
    if (this.contact && b.owner < 0 && b.meta?.icpt === p.pid) {
      p.target = this.interceptPoint(p, 1.8)
      p.urgency = 1
      p.mode = 'press'
      return
    }
    const possession = this.possessionTeam()
    if (possession === t) {
      if (b.owner < 0 && b.meta?.intended === p.pid) {
        p.target = this.interceptPoint(p, 1.8)
        p.urgency = 1
        p.mode = 'support'
      } else if (p.runTarget && this.time < p.runUntil) {
        p.target = p.runTarget
        p.urgency = 1
        p.mode = 'run'
      } else {
        p.target = this.formationTarget(p)
        p.urgency = 0.34
        p.mode = 'idle'
      }
    } else if (possession) {
      this.decideOffBall(p)
    } else {
      this.decideLoose(p)
    }
  }

  private refreshChangedInstructionTasks(t: PesTeam, previous: Map<number, string>): void {
    for (const p of t.players) {
      if ((previous.get(p.pid) ?? '') !== this.instructionTaskKey(t, p)) this.refreshInstructionMovement(p)
    }
  }

  /** 球权或死球在决策中途变化：丢弃上一步分配，下个物理步再重建。 */
  private clearInstructionShape(): void {
    for (const t of this.teams) {
      if (!t.tactics.instructions) continue
      const previous = this.instructionTasks(t)
      t.presser = -1
      t.presser2 = -1
      t.cover = -1
      t.pressEvalAt = undefined
      t.pressOwnerPid = undefined
      t.marks.fill(-1)
      this.refreshChangedInstructionTasks(t, previous)
    }
  }

  /** 离场球员不能继续作为上抢者或盯人目标；换人后的新球员由下一步重新分配。 */
  private removeInstructionShapeReferences(player: PesPlayer): void {
    if (!this.tacticalMechanics) return
    for (const t of this.teams) {
      if (!t.tactics.instructions) continue
      const previous = this.instructionTasks(t)
      if (t.presser === player.pid) { t.presser = -1; t.pressEvalAt = undefined }
      if (t.presser2 === player.pid) { t.presser2 = -1; t.pressEvalAt = undefined }
      if (t.cover === player.pid) t.cover = -1
      if (t.pressOwnerPid === player.pid) t.pressOwnerPid = undefined
      if (this.tiOf(t) === player.ti) t.marks[player.slot] = -1
      for (let slot = 0; slot < t.marks.length; slot++) {
        if (t.marks[slot] === player.pid) t.marks[slot] = -1
      }
      this.refreshChangedInstructionTasks(t, previous)
    }
  }

  private updateShape(): void {
    const b = this.ball
    for (const t of this.teams) {
      const v2 = t.tactics.instructions
      const previous = v2 && this.tacticalMechanics ? this.instructionTasks(t) : null
      const prevPresser = t.presser
      const prevPresser2 = t.presser2 ?? -1
      t.marks.fill(-1)
      t.presser = -1
      t.cover = -1
      if (v2 && this.tacticalMechanics) t.presser2 = -1
      if (b.frozen || this.possessionTeam() === t) {
        if (v2 && this.tacticalMechanics) {
          t.pressEvalAt = undefined
          t.pressOwnerPid = undefined
        }
        if (previous) this.refreshChangedInstructionTasks(t, previous)
        continue
      }

      const outfield = t.players.filter((p) => p.role !== 'GK' && p.stun <= 0)
      if (!outfield.length) {
        if (previous) this.refreshChangedInstructionTasks(t, previous)
        continue
      }
      const ip = b.owner >= 0 ? { x: b.x + b.vx * 0.2, y: b.y + b.vy * 0.2 } : this.predictBall(0.4)
      const eta = (p: PesPlayer): number => dist(p.pos, ip) / Math.max(2.5, this.maxSpeed(p) * 0.6)
      const sorted = outfield.slice().sort((a, c) => eta(a) - eta(c))
      if (v2) {
        this.assignPressers(t, v2, outfield, ip, prevPresser, prevPresser2)
      } else {
        t.presser = sorted[0].pid
        t.cover = sorted[1] ? sorted[1].pid : -1
      }

      const oppTeam = this.other(t)
      const opps = oppTeam.players.filter((o) => o.role !== 'GK')
      const goal = this.goalOf(t)
      const threats = opps.slice().sort((a, c) =>
        (dist(a.pos, goal) - a.ab.positioning * 2.5) - (dist(c.pos, goal) - c.ab.positioning * 2.5))
      const used = new Set<number>([t.presser, t.cover])
      if (v2 && this.tacticalMechanics && t.presser2 !== undefined) used.add(t.presser2)
      for (const o of threats) {
        if (o.pid === b.owner) continue
        let best: PesPlayer | null = null
        let bd = 1e9
        for (const d of outfield) {
          if (used.has(d.pid)) continue
          const dd = dist(d.pos, o.pos)
          if (dd < bd) {
            bd = dd
            best = d
          }
        }
        if (best && bd < 16 * this.spec.K) {
          t.marks[best.slot] = o.pid
          used.add(best.pid)
        }
      }
      this.metrics?.tasks(this.tiOf(t), t)
      if (previous) this.refreshChangedInstructionTasks(t, previous)
    }
  }

  /**
   * 新指令的上抢调度（文档 4.1 + docs/tactical-design-revision.md 4.3 / 5.2）：
   * - 连续熟练度缩放，彻底移除每物理帧随机数反转抖动；
   * - 0.25s 周期保持当前合法上抢人，持球人变化 / 死球 / 人员失效立即重评；
   * - 紧急上抢不受回撤或逼抢线阻断（禁区/身前 3 米内仍允许 1 名合格防守人上前，计入人数上限）。
   */
  private assignPressers(
    t: PesTeam,
    v2: TacticalInstructionsV2,
    outfield: PesPlayer[],
    ip: Vec2,
    prevPresser = -1,
    prevPresser2 = -1,
  ): void {
    const P = this.spec
    const K = P.K
    const params = this.tacticsParams
    const b = this.ball
    const ti = this.tiOf(t)
    const fam = this.teamFamiliarity(t)
    const effEngage = execution(fam, params, INSTRUCTION_DIFFICULTY.engagement)
    const effIntensity = execution(fam, params, INSTRUCTION_DIFFICULTY.intensity)
    const effLine = execution(fam, params, INSTRUCTION_DIFFICULTY.line)
    const effLoss = execution(fam, params, INSTRUCTION_DIFFICULTY.onLoss)
    const u = (b.x * t.dir + P.HL) / P.L
    const counterpress = v2.transition.onLoss === 'counterpress' && this.inWindow(t.lossAt) && effLoss >= 0.5
    const regroup = v2.transition.onLoss === 'regroup' && this.inWindow(t.lossAt) && effLoss >= 0.5
    const engagement = lerp(params.engagement.mid, params.engagement[v2.defense.engagement], effEngage)
    const radius = lerp(params.pressRadius.mid, params.pressRadius[v2.defense.intensity], effIntensity) * K
    const rawCount = counterpress ? Math.max(2, params.pressCount[v2.defense.intensity]) : params.pressCount[v2.defense.intensity]
    const count = Math.max(1, Math.round(lerp(1, rawCount, effIntensity)))
    const rawLine = params.lineValue[v2.defense.line]
    t.lineBias = rawLine === 0.5 ? 0 : effLine
    const maxPress = Math.min(count, Math.max(0, outfield.length - params.keepBack))
    const search = counterpress
      ? Math.min(radius + params.counterpressBonus * K * effLoss, params.counterpressMax * K)
      : radius
    const allowed = !regroup && (counterpress || u <= engagement)
    const emergencyLimit = params.emergencyRadius * K

    const near = outfield
      .filter((p) => dist(p.pos, ip) <= search)
      .sort((a, c) => dist(a.pos, ip) - dist(c.pos, ip) || a.pid - c.pid)

    let picked: PesPlayer[] = []
    const canKeepSchedule = this.tacticalMechanics
      && t.pressEvalAt !== undefined
      && this.time < t.pressEvalAt
      && t.pressOwnerPid === b.owner
    if (canKeepSchedule) {
      const keepLimit = allowed ? search + 2.5 * K : emergencyLimit + 1.0 * K
      const p1 = prevPresser >= 0 ? outfield.find((p) => p.pid === prevPresser && dist(p.pos, ip) <= keepLimit) : undefined
      if (p1 && maxPress >= 1) {
        picked.push(p1)
        const p2 = allowed && maxPress >= 2 && prevPresser2 >= 0
          ? outfield.find((p) => p.pid === prevPresser2 && p.pid !== p1.pid && (counterpress || p.stamina >= 0.45) && dist(p.pos, ip) <= search + 3 * K)
          : undefined
        if (p2) picked.push(p2)
      }
    }

    if (!picked.length || (allowed && maxPress >= 2 && picked.length < 2 && near.length >= 2 && !canKeepSchedule)) {
      if (allowed) {
        picked = near.slice(0, 1)
        if (maxPress >= 2) {
          const second = near.find((p) => p !== picked[0] && (!this.tacticalMechanics || counterpress || p.stamina >= 0.45))
          if (second) picked.push(second)
        }
      } else {
        picked = []
      }
      // 紧急上抢：回撤窗口或逼抢线外，身前 3 米内仍允许 1 名合格防守人上前施压（计入留人上限）。
      if (!picked.length && maxPress >= 1) {
        const boxDangerLimit = this.tacticalMechanics && u <= 0.28 ? Math.min(radius, 9 * K) : emergencyLimit
        const emergency = outfield
          .filter((p) => dist(p.pos, ip) <= boxDangerLimit)
          .sort((a, c) => dist(a.pos, ip) - dist(c.pos, ip) || a.pid - c.pid)[0]
        if (emergency) picked.push(emergency)
      }
      if (this.tacticalMechanics) {
        t.pressEvalAt = this.time + 0.25
        t.pressOwnerPid = b.owner
      }
    }

    t.presser = picked[0] ? picked[0].pid : -1
    t.presser2 = picked[1] ? picked[1].pid : -1
    t.cover = near.find((p) => !picked.includes(p))?.pid ?? -1
    this.metrics?.press(ti, picked.length, u, this.inWindow(t.lossAt))
  }
}

