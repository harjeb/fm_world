/**
 * 战术实验埋点（docs/tactical-validation-report.md 4.2 的指标口径）。
 *
 * 只观察、不改决策、不额外抽取随机数：`match.metrics` 为 `null` 时一行都不会执行。
 * 由 `npm run tactics:experiment` 打开；游戏内比赛默认关闭，因此 v4 行为逐位不变。
 *
 * 已实现的口径（相对文档的简化写在字段注释里）：
 * - `PL` 开放比赛每次非门将传球尝试的出脚点 → 出脚时预定接球人位置的距离（米）。
 * - `CF` 同上，预定接球人 `abs(y) ≤ HW / 3` 的比例。
 * - `W` 本方稳定控球时，每模拟秒外场球员 `y` 的 `P90 − P10`（米）。
 * - `DL` 对手稳定控球时，每模拟秒本方「开赛阵型 line ≤ 0.35 且非门将」球员的进攻方向坐标均值（米）。
 * - `HLR` 在 `u ≥ 2/3` 确认的夺回次数 / 对手控球显示分钟 × 10。
 * - `EF` 夺回后 1.5 模拟秒窗口内至少一脚向前 ≥ 5K 米的传球尝试的夺回占比。
 * - `Stam` 原首发外场球员的期末体力与跑动（满场 / 提前离场分别统计）。
 *
 * 夺回确认沿用文档 4.1 第 1–4 条的主干：候选球队连续实际控球累计 0.20 模拟秒确认；
 * 候选期间主动出脚立即确认；原控球队重新控球或死球取消候选；其他无主球暂停计时。
 * 文档里「暂定窗口挂起 / 恢复」的细节没有实现（本实验只用一个活动窗口），不据此宣称通过兼容性验收。
 */
import type { BallMeta, PesPlayer, PesTeam, TeamIndex } from './spec.ts'
import type { PesMatch } from './sim.ts'

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/** 一队的原始指标（求和 / 样本形式，不在这里取平均，方便按种子块重算）。 */
export type TeamSample = {
  /** PL 采样（米） */
  passDistance: number[]
  /** 中路传球尝试 / 全部传球尝试 */
  centralPasses: number
  openPasses: number
  /** 每秒控球 / 对手控球期间无球宽度采样（米）。 */
  width: number[]
  defensiveWidth: number[]
  /** 空当决策、可行候选、出脚裁决和实际接球；观察而不额外生成候选。 */
  spaceDecisions: number
  spaceEligibleDecisions: number
  spaceCandidates: number
  spaceRejections: Record<string, number>
  spacePasses: number
  spaceSettledOk: number
  spaceReceived: number
  spaceReceivedOk: number
  /** 活球普通传球的实际接球；边路以接球时 abs(y)>HW/3 定义。 */
  receptions: number
  wideReceptions: number
  wideFinalThirdReceptions: number
  /** 常规传中决策暴露、可行候选、实际出脚及预裁决成功。 */
  crossDecisions: number
  crossCandidates: number
  crossPreferred: number
  /** 合格传中候选的最佳竞争动作分数减传中分数；正数表示尚不足以胜出。 */
  crossMargins: number[]
  crossCanceledControl: number
  crossCanceledFoul: number
  crosses: number
  crossSettledOk: number
  /** 启用接空当时无球决策的前插申请漏斗。 */
  runnerDecisions: number
  runnerBlocked: Record<string, number>
  runnerTrials: number
  runnerStarted: number
  /** 任务分配帧与其中存在本方上抢 / 协防者占用本方盯人槽的帧数。 */
  taskFrames: number
  taskConflictFrames: number
  /** 每秒防线深度采样（米，己方球门线为 0） */
  defLine: number[]
  /** 对方控球秒数（HLR / DL 的分母） */
  oppPossessionSeconds: number
  possessionSeconds: number
  highTurnovers: number
  turnovers: number
  /** EF：有向前 ≥5K 传球的夺回 / 全部夺回窗口 */
  forwardTurnovers: number
  turnoverWindows: number
  /** 压迫调度：有上抢任务的帧数与这些帧的球 `u` 均值（engagement 诊断） */
  pressFrames: number
  pressU: number
  /** 防守帧总数（无球阶段调用调度器的帧）：和 pressFrames 一起给出上抢发生率 */
  shapeFrames: number
  /** 上抢任务数（intensity 诊断） */
  pressAssignments: number
  /** 失球转换窗口内的帧数 / 其中有上抢任务的帧数（onLoss 诊断） */
  lossFrames: number
  lossPressFrames: number
  /** 外场球员两次决策之间的平均间隔（tempo 诊断） */
  decideIntervalSum: number
  decideCount: number
  /** 每名球员的期末体力 / 跑动（ref → 值） */
  staminaEnd: Record<string, number>
  distance: Record<string, number>
  /** 是否在终场仍在场上 */
  onPitchAtEnd: Record<string, boolean>
  /** 是否外场球员 */
  isOutfield: Record<string, boolean>
}

export const emptySample = (): TeamSample => ({
  passDistance: [], centralPasses: 0, openPasses: 0, width: [], defensiveWidth: [], defLine: [],
  spaceDecisions: 0, spaceEligibleDecisions: 0, spaceCandidates: 0, spaceRejections: {}, spacePasses: 0, spaceSettledOk: 0, spaceReceived: 0, spaceReceivedOk: 0,
  receptions: 0, wideReceptions: 0, wideFinalThirdReceptions: 0, crossDecisions: 0, crossCandidates: 0,
  crossPreferred: 0, crossMargins: [], crossCanceledControl: 0, crossCanceledFoul: 0, crosses: 0, crossSettledOk: 0,
  runnerDecisions: 0, runnerBlocked: {}, runnerTrials: 0, runnerStarted: 0,
  taskFrames: 0, taskConflictFrames: 0,
  oppPossessionSeconds: 0, possessionSeconds: 0, highTurnovers: 0, turnovers: 0,
  forwardTurnovers: 0, turnoverWindows: 0, pressFrames: 0, pressU: 0, pressAssignments: 0,
  shapeFrames: 0, lossFrames: 0, lossPressFrames: 0, decideIntervalSum: 0, decideCount: 0,
  staminaEnd: {}, distance: {}, onPitchAtEnd: {}, isOutfield: {},
})

type Candidate = { ti: TeamIndex; t0: number; acc: number; x: number; y: number }
type Pending = { ti: TeamIndex; start: number; end: number; forward: boolean }

export class MatchMetrics {
  readonly teams: [TeamSample, TeamSample] = [emptySample(), emptySample()]
  private confirmed: TeamIndex | null = null
  private candidate: Candidate | null = null
  private pending: Pending | null = null
  private lastSecond = -1
  /** 失败传中的 BallMeta.cross 可能为 false；只在埋点内跟踪来源，不改比赛快照。 */
  private readonly crossFlights = new WeakSet<BallMeta>()
  private readonly starters: [PesPlayer[], PesPlayer[]]
  /** 防线 / 低位中场槽位：开赛阵型 line ≤ 0.35 的非门将球员 */
  private readonly deepSlots: [Set<number>, Set<number>]

  constructor(match: PesMatch) {
    this.starters = [match.teams[0].players.slice(), match.teams[1].players.slice()]
    this.deepSlots = [
      new Set(this.starters[0].filter((p) => p.slot !== 0 && p.line <= 0.35).map((p) => p.slot)),
      new Set(this.starters[1].filter((p) => p.slot !== 0 && p.line <= 0.35).map((p) => p.slot)),
    ]
  }

  /** 每帧调用；`poss` 是 `possessionTeam()` 的索引（含同队传球飞行），无稳定控球为 null。 */
  step(match: PesMatch, poss: TeamIndex | null, dt: number): void {
    const window = 1.5 * (match.spec.HALF * 2) / 900
    const open = match.phase === 'play' && !match.ball.frozen
    const t = match.time

    for (const ti of [0, 1] as TeamIndex[]) {
      if (poss === ti) this.teams[ti].possessionSeconds += dt
      if (poss !== null && poss !== ti) this.teams[ti].oppPossessionSeconds += dt
    }

    if (!open) {
      this.candidate = null
      if (this.pending) this.closeWindow()
      return
    }

    if (poss !== null) {
      if (this.pending && !this.pending.forward && poss !== this.pending.ti && t > this.pending.start + 0.4) {
        // 对手重新拿到实际控制：窗口结束（未向前传球，计入分母）。
        this.closeWindow()
      }
      if (this.confirmed === null) this.confirmed = poss
      else if (poss === this.confirmed) this.candidate = null
      else {
        if (this.candidate?.ti === poss) this.candidate.acc += dt
        else this.candidate = { ti: poss, t0: t, acc: dt, x: match.ball.x, y: match.ball.y }
        if (this.candidate.acc >= 0.2) {
          const from = this.candidate
          this.confirmed = poss
          const sample = this.teams[poss]
          sample.turnovers++
          const dir = match.teams[poss].dir
          const u = (from.x * dir + match.spec.HL) / match.spec.L
          if (u >= 2 / 3) sample.highTurnovers++
          if (this.pending) this.closeWindow()
          this.pending = { ti: poss, start: from.t0, end: from.t0 + window, forward: false }
          this.candidate = null
        }
      }
    }

    if (this.pending && t >= this.pending.end) this.closeWindow()

    const second = Math.floor(t)
    if (second !== this.lastSecond) {
      this.lastSecond = second
      for (const ti of [0, 1] as TeamIndex[]) {
        const sample = this.teams[ti]
        const team = match.teams[ti]
        const outfield = team.players.filter((p) => p.slot !== 0)
        if (poss === ti && outfield.length >= 8) {
          const ys = outfield.map((p) => p.pos.y).sort((a, b) => a - b)
          sample.width.push(quantile(ys, 0.9) - quantile(ys, 0.1))
        }
        if (poss !== null && poss !== ti) {
          if (outfield.length >= 8) {
            const ys = outfield.map((p) => p.pos.y).sort((a, b) => a - b)
            sample.defensiveWidth.push(quantile(ys, 0.9) - quantile(ys, 0.1))
          }
          const deep = team.players.filter((p) => this.deepSlots[ti].has(p.slot))
          if (deep.length) {
            const mean = deep.reduce((sum, p) => sum + (p.pos.x * team.dir + match.spec.HL), 0) / deep.length
            sample.defLine.push(mean)
          }
        }
      }
    }
  }

  /** 一次传球尝试（不含传中 / 解围 / 射门）。`target` 是出脚时的预定接球人位置。 */
  pass(match: PesMatch, from: PesPlayer, target: { x: number; y: number }, distance: number): void {
    if (match.phase !== 'play') return
    const sample = this.teams[from.ti]
    sample.openPasses++
    sample.passDistance.push(distance)
    if (Math.abs(target.y) <= match.spec.HW / 3) sample.centralPasses++
    const dir = match.teams[from.ti].dir
    if (this.pending && this.pending.ti === from.ti && (target.x - from.pos.x) * dir >= 5 * match.spec.K) {
      this.pending.forward = true
    }
    // 候选期间主动出脚：立即确认换队（文档 4.1 第 2 条）。
    if (this.candidate && this.candidate.ti === from.ti) {
      const c = this.candidate
      this.confirmed = from.ti
      const sampleTeam = this.teams[from.ti]
      sampleTeam.turnovers++
      const u = (c.x * dir + match.spec.HL) / match.spec.L
      if (u >= 2 / 3) sampleTeam.highTurnovers++
      if (this.pending) this.closeWindow()
      this.pending = { ti: from.ti, start: c.t0, end: c.t0 + 1.5 * (match.spec.HALF * 2) / 900, forward: false }
      this.candidate = null
    }
  }

  /** 上抢调度埋点：`u` 是球的进攻方向坐标（0 本方球门线，1 对方球门线）。 */
  press(team: TeamIndex, count: number, u: number, lossWindow: boolean): void {
    const sample = this.teams[team]
    sample.shapeFrames++
    if (lossWindow) {
      sample.lossFrames++
      if (count > 0) sample.lossPressFrames++
    }
    if (count <= 0) return
    sample.pressFrames++
    sample.pressU += clamp01(u)
    sample.pressAssignments += count
  }

  /** 空当候选在原决策中已生成；只记录数目，不重复评分或调用 RNG。 */
  spaceDecision(team: TeamIndex, candidates: number): void {
    const sample = this.teams[team]
    sample.spaceDecisions++
    if (candidates > 0) sample.spaceEligibleDecisions++
    sample.spaceCandidates += candidates
  }

  spaceReject(team: TeamIndex, reason: string): void {
    const sample = this.teams[team]
    sample.spaceRejections[reason] = (sample.spaceRejections[reason] ?? 0) + 1
  }

  spacePass(team: TeamIndex, settledOk: boolean): void {
    this.teams[team].spacePasses++
    if (settledOk) this.teams[team].spaceSettledOk++
  }

  spaceReceive(team: TeamIndex, settledOk: boolean): void {
    this.teams[team].spaceReceived++
    if (settledOk) this.teams[team].spaceReceivedOk++
  }

  trackCross(meta: BallMeta): void { this.crossFlights.add(meta) }

  isCross(meta: BallMeta): boolean { return !!meta.cross || this.crossFlights.has(meta) }

  /** 只记录已实际接球的普通传球，不将预裁决当作到位。 */
  receive(match: PesMatch, receiver: PesPlayer): void {
    const sample = this.teams[receiver.ti]
    sample.receptions++
    if (Math.abs(receiver.pos.y) > match.spec.HW / 3) {
      sample.wideReceptions++
      const team = match.teams[receiver.ti]
      if ((receiver.pos.x * team.dir + match.spec.HL) / match.spec.L >= 2 / 3) sample.wideFinalThirdReceptions++
    }
  }

  crossDecision(team: TeamIndex, available: boolean, preferred: boolean, margin?: number): void {
    const sample = this.teams[team]
    sample.crossDecisions++
    if (available) {
      sample.crossCandidates++
      if (margin !== undefined && Number.isFinite(margin)) sample.crossMargins.push(margin)
    }
    if (available && preferred) sample.crossPreferred++
  }

  crossCanceled(team: TeamIndex, reason: 'control' | 'foul'): void {
    const sample = this.teams[team]
    if (reason === 'control') sample.crossCanceledControl++
    else sample.crossCanceledFoul++
  }

  cross(team: TeamIndex, settledOk: boolean): void {
    const sample = this.teams[team]
    sample.crosses++
    if (settledOk) sample.crossSettledOk++
  }

  runner(team: TeamIndex, result: string): void {
    const sample = this.teams[team]
    sample.runnerDecisions++
    if (result === 'started') { sample.runnerTrials++; sample.runnerStarted++ }
    else if (result === 'rollMiss') sample.runnerTrials++
    else sample.runnerBlocked[result] = (sample.runnerBlocked[result] ?? 0) + 1
  }

  /** marks[slot] 是对手 pid，冲突应检查本方任务球员的 slot。 */
  tasks(team: TeamIndex, shape: PesTeam): void {
    const sample = this.teams[team]
    sample.taskFrames++
    if (shape.players.some((p) => (p.pid === shape.presser || p.pid === shape.presser2 || p.pid === shape.cover)
      && (shape.marks[p.slot] ?? -1) >= 0)) sample.taskConflictFrames++
  }

  /** 决策间隔埋点（tempo）：外场球员相邻两次决策的模拟秒差。 */
  private readonly lastDecision = new Map<number, number>()
  decide(p: PesPlayer, time: number): void {
    if (p.slot === 0) return
    const last = this.lastDecision.get(p.pid)
    this.lastDecision.set(p.pid, time)
    if (last === undefined) return
    const gap = time - last
    if (gap <= 0 || gap > 2) return
    const sample = this.teams[p.ti]
    sample.decideIntervalSum += gap
    sample.decideCount++
  }

  private closeWindow(): void {
    if (!this.pending) return
    const sample = this.teams[this.pending.ti]
    sample.turnoverWindows++
    if (this.pending.forward) sample.forwardTurnovers++
    this.pending = null
  }

  /** 终场：记录首发球员的期末体力与跑动。 */
  finish(match: PesMatch): void {
    if (this.pending) this.closeWindow()
    for (const ti of [0, 1] as TeamIndex[]) {
      const sample = this.teams[ti]
      const team = match.teams[ti]
      for (const p of this.starters[ti]) {
        const on = team.players.find((q) => q.pid === p.pid)
        sample.staminaEnd[p.ref] = on ? on.stamina : p.stamina
        sample.distance[p.ref] = on ? on.distance : p.distance
        sample.onPitchAtEnd[p.ref] = !!on
        sample.isOutfield[p.ref] = p.slot !== 0
      }
    }
  }
}
