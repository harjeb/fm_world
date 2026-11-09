/**
 * 差分对照：把 TypeScript 版内核（sim.ts）和 pes2d 原版 sim.js 放在一起逐帧比。
 *
 * 原版在 F:\FIFA_test\pes2d\sim.js（你的项目，这里不改它、也不拷进仓库），路径可用环境变量 PES2D_SRC 指定。
 * 加载时对原文做三类**字符串补丁**，补丁清单本身就是“我们对原版改了什么”的完整说明：
 *   A. 确定性：去掉构造函数里的 Math.random（球员初始反应计时由调用方给）；
 *   B. 规则缺陷（计划 6.7）：出界归属、射正统计、越位线包含门将、死球后停止抢断、拿球保护；
 *   C. 7 人制标定（计划 6.4）：场地参数外置，约 50 处战术距离乘 K（只在 `scaled: true` 时打）。
 * 随机数：原版用 mulberry32；TS 版的发生器是注入的，这里也注入同一个 mulberry32，两边抽到的数完全一样，
 * 于是每一帧每个球员、球的位置都应当逐位相同。
 */
import fs from 'node:fs'
import { PesMatch } from './sim.ts'
import type { PesPlayerInit, PesRng, PesTeamInit } from './sim.ts'
import type { PesTactics, PitchSpec } from './spec.ts'

export const DEFAULT_REFERENCE_PATH = 'F:/FIFA_test/pes2d/sim.js'

export function referencePath(): string {
  return process.env.PES2D_SRC || DEFAULT_REFERENCE_PATH
}

export function referenceAvailable(): boolean {
  try {
    return fs.statSync(referencePath()).isFile()
  } catch {
    return false
  }
}

/** 原版 pes2d 用的发生器；可序列化为单个 32 位状态。 */
export function mulberry32(seed: number): PesRng & { next(): number } {
  let a = seed | 0
  const next = (): number => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { next, float: next, toJSON: () => ({ state: String(a >>> 0), inc: '1' }) }
}

export type RefRow = [string, number, number, number]

export interface ReferenceConfig {
  /** 场地与时间（对应原版的 P） */
  P: { L: number; W: number; GOAL_HALF: number; GOAL_H: number; PEN_D: number; PEN_W: number; CIRCLE: number; HALF: number }
  /** 打 7 人制补丁（战术距离乘 K）；false = 只打 A、B 两类，用来对照原版 11 人制 */
  scaled: boolean
  K: number
  /** 替换原版的阵型表（7 人制阵型）；不给就用原版的 */
  formations?: Record<string, RefRow[]>
}

/* ---------- A、B：任何模式都打 ---------- */
const BASE_PATCHES: [string, string][] = [
  ['this.decideT = Math.random() * 0.2;', 'this.decideT = 0;'],
  // 出界归属写反（6.7 第 1 条）：球出 sideSign 那一端，该端的进攻方是 dir 与 sideSign 相同的队，防守方是另一队
  ['const defending = sideSign === this.home.dir ? this.home : this.away;', 'const defending = sideSign === this.home.dir ? this.away : this.home;'],
  // 出界归属第二处写反（6.7 第 4 条）：防守方最后触球才是进攻方角球
  ['if (last && last.team === attacking) {', 'if (last && last.team === defending) {'],
  // 射正统计：打高的球不算，同一脚射门只统计一次
  ['if (Math.abs(b.y) < P.GOAL_HALF + 0.15) b.meta.from.team.stats.shotsOn++;', 'if (!b.meta.counted && Math.abs(b.y) < P.GOAL_HALF + 0.15 && b.z < P.GOAL_H) b.meta.from.team.stats.shotsOn++;'],
  // 同步共享规则修复，仅在内存中修补参照实现，不改原版文件。
  ["const xs = oppTeam.players.filter(o => o.role !== 'GK').map(o => o.pos.x * team.dir).sort((a, b) => b - a);", 'const xs = oppTeam.players.map(o => o.pos.x * team.dir).sort((a, b) => b - a);'],
  ['return xs.length > 1 ? xs[1] : (xs[0] == null ? -P.HL : xs[0]);', 'return xs[1] ?? -P.HL;'],
  ['if (!att || att.stun > 0) return;', 'if (!att || att.stun > 0 || this.ball.frozen) return;'],
  ['for (const d of t.players) {\n        if (d.stun > 0 || d.tackleCd > 0) continue;', 'for (const d of t.players) {\n        if (this.ball.frozen || this.ball.owner !== att || att.stun > 0) return;\n        if (d.stun > 0 || d.tackleCd > 0) continue;'],
  ['for (const t of this.teams) for (const p of t.players) {\n          const d = dist(p.pos, b);', 'for (const t of this.teams) for (const p of t.players) {\n          if (p.noClaim > 0) continue;\n          const d = dist(p.pos, b);'],
]

/* ---------- C：7 人制标定（原 make_sim7.py 的替换清单） ---------- */
const K_PATCHES: [string, string][] = [
  ['if (depth <= 0 || d > 32) return 0;', 'if (depth <= 0 || d > 32 * K) return 0;'],
  ['let s = 0.90 * Math.exp(-d / 16)', 'let s = 0.90 * Math.exp(-d / (16 * K))'],
  ['if (d < 16) s *= 1.45;', 'if (d < 16 * K) s *= 1.45;'],
  ['if (d < 11) s *= 1.15;', 'if (d < 11 * K) s *= 1.15;'],
  ['if (d > 27) s *= 0.6;', 'if (d > 27 * K) s *= 0.6;'],
  ['0.36 * clamp01((24 - d) / 12)', '0.36 * clamp01((24 * K - d) / (12 * K))'],
  ['clear: distance <= 28 && angle >= 0.25 && !blocked', 'clear: distance <= 28 * K && angle >= 0.25 && !blocked'],
  ['|| dist(p.pos, mate.pos) > 16 || this.isOffside(p.team, mate)) return false;', '|| dist(p.pos, mate.pos) > 16 * K || this.isOffside(p.team, mate)) return false;'],
  ['if (!receiver.clear || receiver.distance > 18 ||', 'if (!receiver.clear || receiver.distance > 18 * K ||'],
  ['if (this.time < p.holdUntil && press < 0.5 && dGoal > 26) {', 'if (this.time < p.holdUntil && press < 0.5 && dGoal > 26 * K) {'],
  ['const shotScore = dGoal < 32 ? m.shootValue(p, press, opps, finish) : 0;', 'const shotScore = dGoal < 32 * K ? m.shootValue(p, press, opps, finish) : 0;'],
  ['if (p.pos.x * dir < -12 && press > 0.55) {', 'if (p.pos.x * dir < -12 * K && press > 0.55) {'],
  ['(dGoal <= 18 || finish.keeperDistance < 5)', '(dGoal <= 18 * K || finish.keeperDistance < 5)'],
  ['if (d < 3.0 || d > 62) return -1;', 'if (d < 3.0 || d > 62 * K) return -1;'],
  ['let s = 0.30 * clamp01(fwd / 32)', 'let s = 0.30 * clamp01(fwd / (32 * K))'],
  ['+ 0.14 * clamp01(1 - d / 58)', '+ 0.14 * clamp01(1 - d / (58 * K))'],
  ['if (dir * mate.pos.x > 20 && mate.pos.x * dir > dir * p.pos.x) s += 0.10;', 'if (dir * mate.pos.x > 20 * K && mate.pos.x * dir > dir * p.pos.x) s += 0.10;'],
  ['if (dir * p.pos.x < -18 && lane < 1.5) s -= 0.18;', 'if (dir * p.pos.x < -18 * K && lane < 1.5) s -= 0.18;'],
  ['s -= clamp01(d / 62) * (1 - p.attrs.passing) * 0.14;', 's -= clamp01(d / (62 * K)) * (1 - p.attrs.passing) * 0.14;'],
  ['if (view.distance < 24) {', 'if (view.distance < 24 * K) {'],
  ['+ 0.16 * clamp01(dGoal / 48)', '+ 0.16 * clamp01(dGoal / (48 * K))'],
  ['p.line >= 0.6 && m.time > p.runUntil && runners < 2 && b.x * t.dir > -12) {', 'p.line >= 0.6 && m.time > p.runUntil && runners < 2 && b.x * t.dir > -12 * K) {'],
  ['const runLx = Math.min(lineLx - 1.5, P.HL - 6);', 'const runLx = Math.min(lineLx - 1.5, P.HL - 6 * K);'],
  ['if (dBall < 28 && p.line > 0.22 && p.line < 0.68) {', 'if (dBall < 28 * K && p.line > 0.22 && p.line < 0.68) {'],
  [
    'const supportLx = p.line >= 0.6 ? 4 + 3 * t.tactics.direct\n            : p.line > 0.35 ? -(7 + 4 * (1 - t.tactics.direct)) : -15;',
    'const supportLx = K * (p.line >= 0.6 ? 4 + 3 * t.tactics.direct\n            : p.line > 0.35 ? -(7 + 4 * (1 - t.tactics.direct)) : -15);',
  ],
  ['y: clamp(b.y + t.dir * side * 9 * (0.6 + 0.8 * t.tactics.width), -P.HW + 4, P.HW - 4)', 'y: clamp(b.y + t.dir * side * 9 * K * (0.6 + 0.8 * t.tactics.width), -P.HW + 4, P.HW - 4)'],
  ['p.urgency = advanceGap > 6 ? (p.line >= 0.6 ? 0.68 : 0.55) : (dBall < 32 ? 0.46 : 0.34);', 'p.urgency = advanceGap > 6 * K ? (p.line >= 0.6 ? 0.68 : 0.55) : (dBall < 32 * K ? 0.46 : 0.34);'],
  ["p.mode = dBall < 32 || advanceGap > 6 ? 'support' : 'idle';", "p.mode = dBall < 32 * K || advanceGap > 6 * K ? 'support' : 'idle';"],
  ['const deepThird = Math.abs(o.pos.x) > P.HL - 35;', 'const deepThird = Math.abs(o.pos.x) > P.HL - 35 * K;'],
  ['lx += inPoss ? (3 + 8 * tac.line) : -(2 + 6 * (1 - tac.press));', 'lx += K * (inPoss ? (3 + 8 * tac.line) : -(2 + 6 * (1 - tac.press)));'],
  ['const lineX = clamp(-30 + tac.line * 26 + (bxt + P.HL) * 0.16, -40, -5);', 'const lineX = clamp(K * (-30 + tac.line * 26) + (bxt + P.HL) * 0.16, -40 * K, -5 * K);'],
  ['lx = Math.max(lx, -P.HL + 6);', 'lx = Math.max(lx, -P.HL + 6 * K);'],
  ['const capLx = p.line >= 0.85 ? P.HL - 9 : P.HL - 13;', 'const capLx = p.line >= 0.85 ? P.HL - 9 * K : P.HL - 13 * K;'],
  ['if (p.line >= 0.85) lx = Math.max(lx, Math.min(bxt + 3, P.HL - 9));', 'if (p.line >= 0.85) lx = Math.max(lx, Math.min(bxt + 3 * K, P.HL - 9 * K));'],
  ['else if (p.line >= 0.6) lx = Math.max(lx, Math.min(bxt + 3, P.HL - 16));', 'else if (p.line >= 0.6) lx = Math.max(lx, Math.min(bxt + 3 * K, P.HL - 16 * K));'],
  ['else if (p.line > 0.35) lx = Math.max(lx, Math.min(bxt - 9, P.HL - 22));', 'else if (p.line > 0.35) lx = Math.max(lx, Math.min(bxt - 9 * K, P.HL - 22 * K));'],
  ['else if (p.line > 0.22) lx = Math.max(lx, Math.min(bxt - 19, P.HL - 30));', 'else if (p.line > 0.22) lx = Math.max(lx, Math.min(bxt - 19 * K, P.HL - 30 * K));'],
  ['else lx = Math.max(lx, Math.min(bxt - 32, P.HL - 40));', 'else lx = Math.max(lx, Math.min(bxt - 32 * K, P.HL - 40 * K));'],
  ['const loft = dd > 32 || (m.laneClearance(p.pos, mate.pos, m.other(t).players) < 1.6 && dd > 17);', 'const loft = dd > 32 * K || (m.laneClearance(p.pos, mate.pos, m.other(t).players) < 1.6 && dd > 17 * K);'],
  ['b.z = d < 16 ? 0.05 : 0.35;', 'b.z = d < 16 * K ? 0.05 : 0.35;'],
  ['b.vz = d > 20 ? 2.0 : 0.6;', 'b.vz = d > 20 * K ? 2.0 : 0.6;'],
  ['const xg = clamp01(Math.exp(-d / 8.5)', 'const xg = clamp01(Math.exp(-d / (8.5 * K))'],
  ['const ty = clamp(p.pos.y + (this.rng() - 0.5) * 28, -P.HW + 5, P.HW - 5);', 'const ty = clamp(p.pos.y + (this.rng() - 0.5) * 28 * K, -P.HW + 5, P.HW - 5);'],
  ['const tx = p.pos.x + dir * (30 + this.rng() * 18);', 'const tx = p.pos.x + dir * K * (30 + this.rng() * 18);'],
  ['if (best && bd < 16) { t.marks.set(best, o); used.add(best); }', 'if (best && bd < 16 * K) { t.marks.set(best, o); used.add(best); }'],
  ['const rush = this.possessionTeam() !== p.team && dBall < 14 && b.z < 1.8 && !b.frozen;', 'const rush = this.possessionTeam() !== p.team && dBall < 14 * K && b.z < 1.8 && !b.frozen;'],
  ['let r = 1.0 + clamp(dBall / 24, 0, 2.4);', 'let r = 1.0 + clamp(dBall / (24 * K), 0, 2.4);'],
  ['if (rush) r = clamp(dBall - 0.9, 0.6, 11);', 'if (rush) r = clamp(dBall - 0.9, 0.6, 11 * K);'],
  ['if (dGoal > 7.0 || b.z > 2.7) continue;', 'if (dGoal > 7.0 * K || b.z > 2.7) continue;'],
]

export interface RefPlayer {
  team: { side: string }
  role: string
  attrs: Record<string, number>
  decideT: number
  pos: { x: number; y: number }
  vel: { x: number; y: number }
  facing: { x: number; y: number }
  target: { x: number; y: number }
  [key: string]: unknown
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RefMatch = any

export interface RefModule {
  Match: new (opts: Record<string, unknown>) => RefMatch
  FORMATIONS: Record<string, RefRow[]>
}

export function loadReference(config: ReferenceConfig): RefModule {
  // 原版文件是 CRLF；补丁里的多行文本按 LF 写
  let src = fs.readFileSync(referencePath(), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
  const apply = (patches: [string, string][]): void => {
    for (const [from, to] of patches) {
      const count = src.split(from).length - 1
      if (count !== 1) throw new Error(`原版 sim.js 与补丁清单对不上（出现 ${count} 次）：${from.slice(0, 80)}`)
      src = src.replace(from, () => to)
    }
  }
  apply(BASE_PATCHES)
  // 场地与时长：原版的 P 里只有 HALF 随时长变；7 人制还要换场地尺寸
  const P = config.P
  const pBlock = /const P = \{[\s\S]*?\n\};/
  if (!pBlock.test(src)) throw new Error('找不到原版的 P 定义')
  src = src.replace(pBlock, () => `const P = {
  L: ${P.L}, W: ${P.W}, HL: ${P.L / 2}, HW: ${P.W / 2},
  GOAL_HALF: ${P.GOAL_HALF}, GOAL_H: ${P.GOAL_H},
  PEN_D: ${P.PEN_D}, PEN_W: ${P.PEN_W}, CIRCLE: ${P.CIRCLE},
  HALF: ${P.HALF}
};`)
  if (config.scaled) {
    src = src.replace('const DT = 1 / 60;', () => `const DT = 1 / 60;\nconst K = ${config.K};`)
    apply(K_PATCHES)
  }
  if (config.formations) {
    const a = src.indexOf('const FORMATIONS = {')
    const b = src.indexOf('const ROLE_W = {')
    if (a < 0 || b < 0) throw new Error('找不到原版的阵型表')
    src = src.slice(0, a) + `const FORMATIONS = ${JSON.stringify(config.formations)};\n\n` + src.slice(b)
  }
  const module = { exports: {} as unknown }
  new Function('module', src)(module)
  return module.exports as RefModule
}

/* ---------- 逐帧比较 ---------- */
const same = (a: unknown, b: unknown): boolean => a === b || (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b))

/**
 * 比较一帧：返回第一处不一致的描述，一致返回 null。
 * 把原版里“对象引用”的字段（持球人、最后触球人、传球目标、发球人）换成球员序号再比。
 */
export function firstMismatch(ref: RefMatch, pes: PesMatch): string | null {
  const refPlayers: RefPlayer[] = ref.home.players.concat(ref.away.players)
  const pid = (o: unknown): number => (o ? refPlayers.indexOf(o as RefPlayer) : -1)
  const check = (label: string, a: unknown, b: unknown): string | null => (same(a, b) ? null : `${label}：原版 ${String(a)}，TS ${String(b)}`)
  const fail = (...checks: (string | null)[]): string | null => checks.find((item) => item !== null) ?? null

  const head = fail(
    check('time', ref.time, pes.time),
    check('half', ref.half, pes.half),
    check('state', ref.state, pes.phase),
    check('score.home', ref.home.score, pes.teams[0].score),
    check('score.away', ref.away.score, pes.teams[1].score),
  )
  if (head) return head

  const rb = ref.ball
  const pb = pes.ball
  const ball = fail(
    check('ball.x', rb.x, pb.x), check('ball.y', rb.y, pb.y), check('ball.z', rb.z, pb.z),
    check('ball.vx', rb.vx, pb.vx), check('ball.vy', rb.vy, pb.vy), check('ball.vz', rb.vz, pb.vz),
    check('ball.spin', rb.spin, pb.spin),
    check('ball.owner', pid(rb.owner), pb.owner),
    check('ball.frozen', rb.frozen, pb.frozen),
    check('ball.lastTouch', pid(rb.lastTouch), pb.lastTouch),
    check('ball.looseT', rb.looseT, pb.looseT),
    check('ball.saveCd', rb.saveCd, pb.saveCd),
    check('ball.meta', rb.meta ? rb.meta.type : null, pb.meta ? pb.meta.type : null),
  )
  if (ball) return ball
  if (rb.meta) {
    const meta = fail(
      check('ball.meta.from', pid(rb.meta.from), pb.meta ? pb.meta.from : -2),
      check('ball.meta.intended', rb.meta.intended ? pid(rb.meta.intended) : undefined, pb.meta ? pb.meta.intended : undefined),
      check('ball.meta.offside', rb.meta.offside, pb.meta ? pb.meta.offside : undefined),
      check('ball.meta.xg', rb.meta.xg, pb.meta ? pb.meta.xg : undefined),
    )
    if (meta) return meta
  }

  for (let i = 0; i < refPlayers.length; i++) {
    const r = refPlayers[i]
    const p = pes.players[i]
    const tag = `球员${i}(${p.name})`
    const bad = fail(
      check(`${tag}.pos.x`, r.pos.x, p.pos.x), check(`${tag}.pos.y`, r.pos.y, p.pos.y),
      check(`${tag}.vel.x`, r.vel.x, p.vel.x), check(`${tag}.vel.y`, r.vel.y, p.vel.y),
      check(`${tag}.facing.x`, r.facing.x, p.facing.x), check(`${tag}.facing.y`, r.facing.y, p.facing.y),
      check(`${tag}.target.x`, r.target.x, p.target.x), check(`${tag}.target.y`, r.target.y, p.target.y),
      check(`${tag}.urgency`, r.urgency, p.urgency), check(`${tag}.stamina`, r.stamina, p.stamina),
      check(`${tag}.decideT`, r.decideT, p.decideT), check(`${tag}.stun`, r.stun, p.stun),
      check(`${tag}.noClaim`, r.noClaim, p.noClaim), check(`${tag}.tackleCd`, r.tackleCd, p.tackleCd),
      check(`${tag}.shotCd`, r.shotCd, p.shotCd), check(`${tag}.holdUntil`, r.holdUntil, p.holdUntil),
      check(`${tag}.mode`, r.mode, p.mode), check(`${tag}.runUntil`, r.runUntil, p.runUntil),
      check(`${tag}.runTarget`, r.runTarget ? `${(r.runTarget as { x: number; y: number }).x},${(r.runTarget as { x: number; y: number }).y}` : null,
        p.runTarget ? `${p.runTarget.x},${p.runTarget.y}` : null),
      check(`${tag}.distance`, r.distance, p.distance), check(`${tag}.touches`, r.touches, p.touches),
    )
    if (bad) return bad
  }

  const rs = [ref.home.stats, ref.away.stats]
  for (let ti = 0; ti < 2; ti++) {
    for (const key of Object.keys(rs[ti])) {
      const bad = check(`stats[${ti}].${key}`, rs[ti][key], (pes.teams[ti].stats as unknown as Record<string, number>)[key])
      if (bad) return bad
    }
  }
  const rr = ref.restart
  const pr = pes.restart
  const restart = fail(
    check('restart', rr ? rr.type : null, pr ? pr.type : null),
    rr ? check('restart.taker', pid(rr.taker), pr ? pr.taker : -2) : null,
    rr ? check('restart.t', rr.t, pr ? pr.t : -2) : null,
  )
  return restart
}

export interface DiffResult {
  steps: number
  mismatch: string | null
  at: number
}

/** 两边同时走 steps 帧，每帧比较，遇到第一处不一致就停。 */
export function runDiff(ref: RefMatch, pes: PesMatch, steps: number): DiffResult {
  for (let i = 0; i < steps; i++) {
    ref.step()
    pes.step()
    const bad = firstMismatch(ref, pes)
    if (bad) return { steps: i + 1, mismatch: bad, at: ref.time }
    if (ref.state === 'end') return { steps: i + 1, mismatch: null, at: ref.time }
  }
  return { steps, mismatch: null, at: ref.time }
}

/* ---------- 成对构造：同一份输入喂给原版和 TS 版 ---------- */
export interface PairedCase {
  label: string
  /** 场地 / 时长；scaled 与 spec.K 对应 */
  spec: PitchSpec
  scaled: boolean
  /** 7 人制阵型表（scaled 时给；不给用原版的） */
  formations?: Record<string, RefRow[]>
  homeFormation: string
  awayFormation: string
  homeStrength?: number
  awayStrength?: number
  homeTactics?: Partial<PesTactics>
  awayTactics?: Partial<PesTactics>
  /** 原版构造用的种子（决定随机能力） */
  seed: number
  /** 构造后比赛随机数的种子 */
  rngSeed: number
}

export function makePair(c: PairedCase): { ref: RefMatch; pes: PesMatch } {
  const P = c.spec
  const mod = loadReference({
    P: { L: P.L, W: P.W, GOAL_HALF: P.GOAL_HALF, GOAL_H: P.GOAL_H, PEN_D: P.PEN_D, PEN_W: P.PEN_W, CIRCLE: P.CIRCLE, HALF: P.HALF },
    scaled: c.scaled,
    K: P.K,
    formations: c.formations,
  })
  const ref = new mod.Match({
    seed: c.seed,
    home: { formation: c.homeFormation, strength: c.homeStrength, tactics: c.homeTactics },
    away: { formation: c.awayFormation, strength: c.awayStrength, tactics: c.awayTactics },
  })
  const toInit = (team: { players: RefPlayer[]; tactics: PesTactics }): PesTeamInit => ({
    players: team.players.map((p) => ({
      name: p.name as string,
      role: p.role,
      nx: (p.homeN as { x: number }).x,
      ny: (p.homeN as { y: number }).y,
      line: p.line as number,
      abilities: { ...p.attrs } as unknown as PesPlayerInit['abilities'],
      num: p.num as number,
    })),
    tactics: { ...team.tactics },
  })
  const home = toInit(ref.home)
  const away = toInit(ref.away)
  // 原版构造时用 Math.random 给每人一个初始反应计时（已补丁成 0）；两边都改成同一串数：
  // TS 版按“主队、客队”顺序从注入的发生器里各抽一个乘 0.2，原版这里手动设成同样的值，并把发生器接到同一个位置。
  const rngRef = mulberry32(c.rngSeed)
  const refPlayers: RefPlayer[] = ref.home.players.concat(ref.away.players)
  for (const p of refPlayers) p.decideT = rngRef.float() * 0.2
  ref.rng = rngRef.float
  const pes = new PesMatch({ spec: P, rng: mulberry32(c.rngSeed), home, away })
  return { ref, pes }
}
