/**
 * 接触点结算（docs/pes2d-migration-plan.md 阶段 3，路线 C）：把 pes2d 物理比赛里每个接触点的成败，
 * 交给现有引擎的概率模型（`SettlementKernel`，阶段 1 抽出来的）按球员真实属性裁决。
 *
 * 这个模型同时是**游戏层的状态**：它持有一份 `MatchState`（现有引擎的比赛状态类型），里面有 14 个球员的
 * 属性、技能、特性、体力、黄牌、伤病，以及按事件流累计出来的球员 / 球队统计。内核要的 `MatchPlayerState`
 * 坐标、体力在每次结算前从物理比赛同步过来（物理米 → 现有引擎的 100×64 单位，下半场两队换边时旋转 180°，
 * 保证主队永远朝 +x 进攻）。
 *
 * 统计**只从事件流推出来**（`onEvent`）：每个事件对应的数字就是同一份数据，不会出现“事件说进球、统计没有”。
 * 只有跑动、触球、体力、控球这类物理量在 `finalize` 时从物理比赛里取。
 */
import { STAR_TRAITS } from '../data/star-traits.generated.ts'
import { derivedRng } from '../rng.ts'
import { prepareMatchInjuries } from '../injury.ts'
import { MatchRatings } from '../match/ratings.ts'
import { SettlementKernel, pickByWeight, totalWeight } from '../match/resolution.ts'
import { GOAL_Y, PITCH_LENGTH, PITCH_WIDTH, buildMatchTeam } from '../match/team.ts'
import { distanceToSegment, goalXOf } from '../match/pitch.ts'
import type { GameState, MatchTeamStats, SkillId } from '../types.ts'
import type { MatchPlayerState, MatchSide, MatchState, MatchTeamInput, MatchTeamState } from '../match/types.ts'
import type { ContactModel, DuelVerdict, FoulVerdict, PassKind, PassVerdict, ShotRequest, ShotVerdict } from './contact.ts'
import type { PesMatch } from './sim.ts'
import type { PesEvent, PesPlayer, TeamIndex, Vec2 } from './spec.ts'

const round3 = (value: number): number => Math.round(value * 1000) / 1000

/**
 * 接触频率换算（阶段 4 校准）。现有引擎一场约 100 次传球、几十次回合动作；pes2d 一场约 350 次传球、
 * 三百多次近身纠缠，所以按“每次接触”结算的风险要打折，整场累计才和现有引擎相当。
 */
export interface SettlementTuning {
  /** 每次上抢承担的失败风险占现有引擎一次盘带对抗的比例（断球、球滚向一旁） */
  duelRate: number
  /** 同上，犯规这一项（现有引擎一场 8 次左右犯规，其中一半来自战术犯规） */
  duelFoulRate: number
  /** 战术犯规：出球前被贴身防守时的犯规概率折扣 */
  tacticalFoulRate: number
}

export const DEFAULT_TUNING: SettlementTuning = { duelRate: 0.35, duelFoulRate: 0.18, tacticalFoulRate: 0.2 }
const sideOf = (ti: TeamIndex | number): MatchSide => (ti === 0 ? 'home' : 'away')

export const emptyTeamStats = (): MatchTeamStats => ({
  possession: 0, passes: 0, passesCompleted: 0, shots: 0, shotsOnTarget: 0, goals: 0, interceptions: 0, tackles: 0,
  fouls: 0, corners: 0, xg: 0, distance: 0, yellowCards: 0, redCards: 0,
})

export interface PesSettlementInit {
  seed: number
  home: MatchTeamInput
  away: MatchTeamInput
  knockout: boolean
  durationSeconds: number
  /** 越位规则（现有引擎的开关，后台比赛不判越位） */
  offside: boolean
  /** 赛前的伤病，球员带伤上场（`prepareMatchInjuries`） */
  injuries?: GameState['injuries']
  now?: number
  tuning?: Partial<SettlementTuning>
}

/** 模型自己的、不属于 MatchState 的状态。 */
interface Extra {
  knockout: boolean
  offside: boolean
  tuning: SettlementTuning
  /** 最近一次成功传球（助攻用）：传球人 pid 和时间 */
  lastPass: { passer: number; t: number } | null
  /** 每个 pid 上场 / 离场的模拟时刻（算出场分钟；没有 left 表示踢到终场） */
  joined: Record<number, number>
  left: Record<number, number>
}

export interface PesSettlementJSON {
  game: MatchState
  extra: Extra
}

/** 战术滑杆之外，游戏层需要的比赛状态（对应现有 MatchEngine 构造函数里建的那一份）。 */
export function createGameState(init: PesSettlementInit): MatchState {
  const home = buildMatchTeam(init.home, 'home')
  const away = buildMatchTeam(init.away, 'away')
  const state: MatchState = {
    seed: init.seed,
    rulesVersion: 4,
    step: 0,
    clock: 0,
    durationSeconds: init.durationSeconds,
    half: 1,
    phase: 'open',
    score: { home: 0, away: 0 },
    teams: [home, away],
    ball: { x: PITCH_LENGTH / 2, y: GOAL_Y, ownerId: null, justReceived: false },
    possession: null,
    pendingSetPiece: null,
    finished: false,
    offside: init.offside,
    shootout: null,
    log: [],
    commentary: [],
    stats: { home: emptyTeamStats(), away: emptyTeamStats() },
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
    decisionRng: { state: '0', inc: '1' },
    resultRng: { state: '0', inc: '1' },
    lastGoalBy: null,
  }
  for (const team of state.teams) {
    for (const player of [...team.players, ...team.bench]) {
      // 存档要能 JSON 往返：世界里个别球员的号码是 NaN，换成 0（= 未知）
      if (!Number.isFinite(player.number)) player.number = 0
      for (const skillId of player.skills) {
        state.skillStats.push({ skillId, playerId: player.id, side: player.side, name: player.name, conditions: 0, applied: 0 })
      }
    }
  }
  if (init.injuries) prepareMatchInjuries(state, init.injuries, init.now ?? Date.now())
  return state
}

export class PesSettlement implements ContactModel {
  game: MatchState
  private extra: Extra
  private ratings: MatchRatings
  private kernel: SettlementKernel
  /** pid → 游戏球员 */
  private mp: MatchPlayerState[] = []
  /** 游戏球员 id → pid（只含场上的人） */
  private pidById = new Map<string, number>()

  constructor(source: PesSettlementInit | PesSettlementJSON) {
    if ('game' in source) {
      const copy = structuredClone(source)
      this.game = copy.game
      this.extra = copy.extra
    } else {
      this.game = createGameState(source)
      this.extra = { knockout: source.knockout, offside: source.offside, tuning: { ...DEFAULT_TUNING, ...source.tuning }, lastPass: null, joined: {}, left: {} }
    }
    this.ratings = new MatchRatings(() => this.game, () => this.game.durationSeconds)
    this.kernel = new SettlementKernel(this.ratings, {
      markSkill: (player, skillId, condition, applied) => this.markSkill(player, skillId, condition, applied),
      legacyRules: false,
    })
  }

  get knockout(): boolean {
    return this.extra.knockout
  }

  get offside(): boolean {
    return this.extra.offside
  }

  toJSON(): PesSettlementJSON {
    return structuredClone({ game: this.game, extra: this.extra })
  }

  /** 内核（给点球大战等游戏层逻辑用）。 */
  get settlementKernel(): SettlementKernel {
    return this.kernel
  }

  attach(m: PesMatch): void {
    const byId = new Map<string, MatchPlayerState>()
    for (const team of this.game.teams) for (const player of [...team.players, ...team.bench]) byId.set(player.id, player)
    this.mp = []
    this.pidById.clear()
    for (const q of m.players) {
      const player = byId.get(q.ref)
      if (!player) throw new Error(`游戏层找不到球员 ${q.ref}`)
      this.mp[q.pid] = player
    }
    for (const t of m.teams) for (const q of t.players) this.pidById.set(q.ref, q.pid)
  }

  /** 物理球员 ↔ 游戏球员的对应关系（换人后更新）。 */
  bind(pid: number, player: MatchPlayerState): void {
    this.mp[pid] = player
    this.pidById.set(player.id, pid)
  }

  unbind(player: MatchPlayerState): void {
    this.pidById.delete(player.id)
  }

  /** 场上某个游戏球员对应的 pid；不在场上为 -1。 */
  pidFor(id: string): number {
    return this.pidById.get(id) ?? -1
  }

  gamePlayer(pid: number): MatchPlayerState {
    return this.mp[pid]
  }

  /** 比赛开始时每个首发的上场时刻记为 0。 */
  markStarters(m: PesMatch): void {
    for (const q of m.players) this.extra.joined[q.pid] = 0
  }

  markJoined(pid: number, t: number): void {
    this.extra.joined[pid] = t
  }

  markLeft(pid: number, t: number): void {
    this.extra.left[pid] = t
  }

  private markSkill(player: MatchPlayerState, skillId: SkillId, condition: boolean, applied: boolean): void {
    if (!player.skills.includes(skillId)) return
    const stat = this.game.skillStats.find((entry) => entry.playerId === player.id && entry.skillId === skillId && entry.side === player.side)
    if (!stat) return
    if (condition) stat.conditions++
    if (applied) stat.applied++
  }

  /* ---------- 物理 → 游戏单位 ---------- */
  private toGame(m: PesMatch, v: Vec2): Vec2 {
    const P = m.spec
    const flip = m.teams[0].dir < 0
    return { x: ((flip ? -v.x : v.x) + P.HL) * (PITCH_LENGTH / P.L), y: ((flip ? -v.y : v.y) + P.HW) * (PITCH_WIDTH / P.W) }
  }

  /** 每次结算前：同步时钟、比分、球员坐标和体力，并让“步”加一（特性的随机判定按步派生）。 */
  private begin(m: PesMatch): void {
    const g = this.game
    g.step++
    g.clock = m.time
    g.half = m.half
    g.score.home = m.teams[0].score
    g.score.away = m.teams[1].score
    for (const t of m.teams) {
      for (const q of t.players) {
        const player = this.mp[q.pid]
        const at = this.toGame(m, q.pos)
        player.x = at.x
        player.y = at.y
        player.stamina = q.stamina * player.maxStamina
      }
    }
  }

  private teamOf(ti: TeamIndex | number): MatchTeamState {
    return this.game.teams[ti]
  }

  private pidOf(player: MatchPlayerState): number {
    const pid = this.pidById.get(player.id)
    if (pid === undefined) throw new Error(`球员 ${player.id} 不在场上`)
    return pid
  }

  /** 只含给定球员的球队视图（不改原球队）：让内核在“局部人群”里结算争顶、二点球。 */
  private view(team: MatchTeamState, pids: number[]): MatchTeamState {
    return { ...team, players: pids.map((pid) => this.mp[pid]) }
  }

  /* ---------- 传球 ---------- */
  pass(m: PesMatch, passer: PesPlayer, receiver: PesPlayer, aim: Vec2, kind: PassKind, setPiece = false): PassVerdict {
    this.begin(m)
    const carrier = this.mp[passer.pid]
    const target = this.mp[receiver.pid]
    const opp = this.teamOf(1 - passer.ti)
    const to = this.toGame(m, aim)
    if (setPiece) {
      // 任意球传中：成功率走 freeKickDeliveryChance；没传好由离落点最近的防守者解围
      const p = this.kernel.freeKickDeliveryChance(carrier, to)
      if (m.rng.float() < p) return { result: 'ok', interceptor: -1, p }
      const clearer = this.nearestOpponent(m, passer.ti, aim)
      return clearer ? { result: 'icpt', interceptor: clearer.pid, p } : { result: 'miss', interceptor: -1, p }
    }
    const model = this.kernel.passModel(carrier, target, kind, opp, { x: carrier.x, y: carrier.y }, to, true)
    // 物理比赛里接球人是跑向落点的：用落点当他的位置算偏离，不扣“落点离接球人太远”的惩罚
    const odds = this.kernel.passOdds(model, kind, to, to)
    const roll = m.rng.float()
    if (roll < odds.p) return { result: 'ok', interceptor: -1, p: odds.p }
    if (model.interceptor) return { result: 'icpt', interceptor: this.pidOf(model.interceptor), p: odds.p }
    if (roll < odds.p + odds.intercepted + odds.out) return { result: 'out', interceptor: -1, p: odds.p }
    return { result: 'miss', interceptor: -1, p: odds.p }
  }

  private nearestOpponent(m: PesMatch, ti: TeamIndex, point: Vec2): PesPlayer | null {
    let best: PesPlayer | null = null
    let bestD = Infinity
    for (const q of m.teams[1 - ti].players) {
      const d = Math.hypot(q.pos.x - point.x, q.pos.y - point.y)
      if (d < bestD) {
        bestD = d
        best = q
      }
    }
    return best
  }

  beatsOffside(m: PesMatch, receiver: PesPlayer): boolean {
    this.begin(m)
    const player = this.mp[receiver.pid]
    const runner = STAR_TRAITS[player.traitId]
    return runner?.kind === 'onside' && this.ratings.traitRoll(player, 'onside', runner.chance)
  }

  /* ---------- 射门 ---------- */
  shot(m: PesMatch, shooter: PesPlayer, req: ShotRequest): ShotVerdict {
    this.begin(m)
    const player = this.mp[shooter.pid]
    const team = this.teamOf(shooter.ti)
    const opp = this.teamOf(1 - shooter.ti)
    const point = { x: player.x, y: player.y }
    const detailRng = derivedRng(this.game.seed, 'shot-detail', this.game.step)
    const s = this.kernel.shotSettlement(player, team, opp, { point, header: req.header, penalty: req.penalty, freeKick: req.freeKick }, detailRng)
    const roll = m.rng.float()
    const { raw } = s
    const result: ShotVerdict['result'] = roll < raw.goal ? 'goal' : roll < raw.goal + raw.save ? 'save' : roll < raw.goal + raw.save + raw.block ? 'block' : 'miss'
    let hold = false
    if (result === 'save') {
      const gk = this.kernel.teamGoalkeeper(opp)
      // 点球被扑出后球在门将手里；其余按抱球概率
      hold = req.penalty || !gk || m.rng.float() < this.kernel.keeperCatchChance(gk, player)
    }
    const chance = s.model.chance
    const meta: Record<string, number | string | boolean> = {
      chance: chance.type,
      distance: round3(s.model.distance),
      angle: round3(chance.angle),
      pressure: round3(chance.pressure),
      blockers: chance.blockers,
      finish: round3(s.model.finishScore),
      gk: round3(s.model.gkScore),
      onTarget: round3(s.onTarget),
      goalGiven: round3(s.goalGiven),
      block: round3(raw.block),
      foot: s.foot ?? 'head',
      technique: s.technique,
      target: s.target,
    }
    return { result, blocker: result === 'block' ? this.blockerOf(m, shooter, point) : -1, xg: raw.goal, hold, meta }
  }

  /** 封堵者：射门线路上离线段最近的防守者（内核只给封堵分数，不给人）。 */
  private blockerOf(m: PesMatch, shooter: PesPlayer, from: Vec2): number {
    const target = { x: goalXOf(sideOf(shooter.ti)), y: GOAL_Y }
    let best = -1
    let bestD = Infinity
    for (const t of m.teams[1 - shooter.ti].players) {
      if (t.slot === 0) continue
      const at = this.mp[t.pid]
      const d = distanceToSegment(at, from, target)
      if (d < bestD) {
        bestD = d
        best = t.pid
      }
    }
    return best
  }

  /* ---------- 近身对抗 / 犯规 / 牌 / 伤病 ---------- */
  duel(m: PesMatch, defender: PesPlayer, carrier: PesPlayer): DuelVerdict {
    this.begin(m)
    const att = this.mp[carrier.pid]
    const def = this.mp[defender.pid]
    const model = this.kernel.dribbleModel(att, def, true)
    const odds = this.kernel.dribbleOdds(model, def, this.teamOf(defender.ti))
    // 现有引擎里一次盘带对抗对应一个回合动作（约 2.5 秒）；物理比赛里同一段纠缠会反复上抢（每次间隔约 0.9 秒），
    // 所以每次上抢只承担其中 DUEL_RATE 的失败风险，整段纠缠的累计风险才和现有引擎相当。
    const { duelRate, duelFoulRate } = this.extra.tuning
    const tackle = duelRate * odds.tackle
    const foul = duelFoulRate * odds.foul
    const keep = 1 - duelRate * (odds.tackle + odds.loose) - foul
    const roll = m.rng.float()
    const base = { p: keep }
    if (roll < keep) return { outcome: 'keep', card: null, second: false, injured: -1, recoveryDays: 0, ...base }
    if (roll < keep + tackle) {
      const hurt = this.injury(att, carrier.pid)
      return { outcome: 'tackle', card: null, second: false, injured: hurt.pid, recoveryDays: hurt.days, ...base }
    }
    if (roll < keep + tackle + foul) {
      const booking = this.book(def)
      const hurt = this.injury(att, carrier.pid)
      return { outcome: 'foul', card: booking.card, second: booking.second, injured: hurt.pid, recoveryDays: hurt.days, ...base }
    }
    return { outcome: 'loose', card: null, second: false, injured: -1, recoveryDays: 0, ...base }
  }

  tacticalFoul(m: PesMatch, carrier: PesPlayer): FoulVerdict | null {
    this.begin(m)
    const player = this.mp[carrier.pid]
    const odds = this.kernel.tacticalFoulOdds(player, this.teamOf(1 - carrier.ti))
    if (!odds) return null
    const chance = odds.chance * this.extra.tuning.tacticalFoulRate
    if (!derivedRng(this.game.seed, 'tactical-foul', this.game.step, player.id).chance(chance)) return null
    const booking = this.book(odds.defender, odds.yellow, odds.red)
    return { defender: this.pidOf(odds.defender), card: booking.card, second: booking.second, injured: -1, recoveryDays: 0, p: chance }
  }

  /** 犯规后出牌（现有 `book` 的概率部分）：第二张黄牌变红牌。状态变化在 onEvent('card') 里。 */
  private book(player: MatchPlayerState, yellowChance?: number, redChance?: number): { card: 'yellow' | 'red' | null; second: boolean } {
    if (player.sentOff) return { card: null, second: false }
    const rng = derivedRng(this.game.seed, 'card', this.game.step, player.id)
    const odds = this.kernel.cardOdds(player, yellowChance, redChance)
    const straight = rng.chance(odds.straightRed)
    const yellow = straight ? false : rng.chance(odds.yellow)
    if (straight) return { card: 'red', second: false }
    if (yellow) return player.yellowCards + 1 >= 2 ? { card: 'red', second: true } : { card: 'yellow', second: false }
    return { card: null, second: false }
  }

  /** 身体接触后受伤（现有 `maybeInjure` 的概率部分）。 */
  private injury(player: MatchPlayerState, pid: number): { pid: number; days: number } {
    if (player.injured) return { pid: -1, days: 0 }
    const { risk } = this.kernel.injuryOdds(player)
    const rng = derivedRng(this.game.seed, 'injury', this.game.step, player.id)
    if (!rng.chance(risk)) return { pid: -1, days: 0 }
    return { pid, days: this.kernel.recoveryDays(rng, player) }
  }

  /* ---------- 争顶 / 二点球 ---------- */
  aerial(m: PesMatch, attackers: PesPlayer[], defenders: PesPlayer[], point: Vec2, attackingTi: TeamIndex): number {
    this.begin(m)
    const attacking = this.view(this.teamOf(attackingTi), attackers.map((q) => q.pid))
    const defending = this.view(this.teamOf(1 - attackingTi), defenders.map((q) => q.pid))
    const contestants = this.kernel.aerialContestants(attacking, defending, this.toGame(m, point), sideOf(attackingTi), () => m.rng.float())
    if (!contestants.length) return -1
    const roll = m.rng.float() * totalWeight(contestants)
    return this.pidOf(pickByWeight(contestants, roll).player)
  }

  loose(m: PesMatch, claimants: PesPlayer[]): number {
    this.begin(m)
    const home = this.view(this.teamOf(0), claimants.filter((q) => q.ti === 0).map((q) => q.pid))
    const away = this.view(this.teamOf(1), claimants.filter((q) => q.ti === 1).map((q) => q.pid))
    const candidates = this.kernel.looseBallContestants([home, away], this.toGame(m, m.ball), () => m.rng.float())
    if (!candidates.length) return claimants[0].pid
    const roll = m.rng.float() * totalWeight(candidates)
    return this.pidOf(pickByWeight(candidates, roll).player)
  }

  /* ---------- 事件流 → 统计 ---------- */
  onEvent(m: PesMatch, e: PesEvent): void {
    const g = this.game
    switch (e.type) {
      case 'pass': {
        const passer = this.mp[e.actors[0]]
        const team = g.stats[passer.side]
        passer.stats.passes++
        team.passes++
        const result = e.meta?.result
        if (result === 'ok') {
          passer.stats.passesCompleted++
          team.passesCompleted++
          this.extra.lastPass = { passer: e.actors[0], t: e.t }
        } else {
          this.extra.lastPass = null
          if (result === 'icpt' && typeof e.meta?.icpt === 'number') {
            const interceptor = this.mp[e.meta.icpt]
            interceptor.stats.interceptions++
            g.stats[interceptor.side].interceptions++
          }
        }
        break
      }
      case 'shot': {
        const shooter = this.mp[e.actors[0]]
        const team = g.stats[shooter.side]
        shooter.stats.shots++
        team.shots++
        team.xg += e.xg ?? 0
        const result = e.meta?.result
        if (result === 'goal' || result === 'save') team.shotsOnTarget++
        break
      }
      case 'goal': {
        const scorer = this.mp[e.actors[0]]
        const own = e.meta?.own === true
        const side = sideOf(e.ti as TeamIndex)
        g.stats[side].goals++
        g.lastGoalBy = side
        g.score.home = m.teams[0].score
        g.score.away = m.teams[1].score
        if (!own && scorer) {
          scorer.stats.goals++
          const last = this.extra.lastPass
          if (last && e.t - last.t <= 8 && last.passer !== e.actors[0] && this.mp[last.passer].side === scorer.side) {
            const assister = this.mp[last.passer]
            assister.stats.assists = (assister.stats.assists ?? 0) + 1
            e.actors.push(last.passer)
            e.meta = { ...e.meta, assist: last.passer }
          }
        }
        this.extra.lastPass = null
        break
      }
      case 'tackle': {
        const tackler = this.mp[e.actors[0]]
        tackler.stats.tackles++
        g.stats[tackler.side].tackles++
        this.extra.lastPass = null
        break
      }
      case 'foul':
        g.stats[sideOf(e.ti as TeamIndex)].fouls++
        this.extra.lastPass = null
        break
      case 'card': {
        const player = this.mp[e.actors[0]]
        const team = g.stats[player.side]
        if (e.meta?.color === 'yellow') {
          player.yellowCards++
          player.stats.yellowCards = (player.stats.yellowCards ?? 0) + 1
          team.yellowCards++
        } else {
          if (e.meta?.second === true) player.yellowCards++
          player.stats.redCards = (player.stats.redCards ?? 0) + 1
          player.sentOff = true
          player.onPitch = false
          player.cameOff = true
          team.redCards++
          this.extra.left[e.actors[0]] = e.t
        }
        break
      }
      case 'injury': {
        const player = this.mp[e.actors[0]]
        const personId = player.personId ?? player.sourceId
        for (const team of g.teams) for (const card of [...team.players, ...team.bench]) if ((card.personId ?? card.sourceId) === personId) card.injured = true
        const days = typeof e.meta?.days === 'number' ? e.meta.days : 1
        g.log.push({ seq: g.log.length + 1, clock: Math.floor(e.t * 10) / 10, half: m.half, type: 'injury', team: player.side, text: `${player.name} 在身体接触中受伤。`, playerId: player.id, injury: { personId, recoveryDays: days } })
        break
      }
      case 'corner':
        g.stats[sideOf(e.ti as TeamIndex)].corners++
        this.extra.lastPass = null
        break
      case 'offside':
      case 'throwin':
      case 'goalkick':
      case 'fk':
      case 'penalty':
        this.extra.lastPass = null
        break
      default:
        break
    }
  }

  /* ---------- 终场 ---------- */
  /** 物理量（跑动、触球、体力、控球、出场分钟）在终场时从物理比赛里取，其余统计已经按事件累计好了。 */
  finalize(m: PesMatch): void {
    const g = this.game
    const D = g.durationSeconds
    for (const q of m.players) {
      const player = this.mp[q.pid]
      player.stats.distance = q.distance
      player.stats.touches = q.touches
      player.stats.staminaLeft = Math.round(q.stamina * 100)
      const from = this.extra.joined[q.pid] ?? 0
      const to = Math.min(this.extra.left[q.pid] ?? m.time, D)
      player.stats.minutes = D > 0 ? Math.max(0, ((to - from) / D) * 90) : 0
    }
    for (const ti of [0, 1] as TeamIndex[]) {
      const stats = g.stats[sideOf(ti)]
      stats.possession = m.teams[ti].stats.possession
      stats.distance = m.players.filter((q) => q.ti === ti).reduce((sum, q) => sum + q.distance, 0)
    }
    g.clock = m.time
    g.score.home = m.teams[0].score
    g.score.away = m.teams[1].score
    // 控球秒数换成百分比（与现有流程里的 normalizePossession 一致，重复调用结果不变）
    const total = g.stats.home.possession + g.stats.away.possession
    if (total > 0) {
      g.stats.home.possession = Math.round((g.stats.home.possession / total) * 1000) / 10
      g.stats.away.possession = Math.round((g.stats.away.possession / total) * 1000) / 10
    }
  }
}
