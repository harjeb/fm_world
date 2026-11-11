/**
 * 后续探索：两个严格镜像阵型，测试窄防守的边路代价和空当球前插漏斗。
 * 固定当前默认参数，不据此直接调参或宣称正式验收。
 */
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PesGame } from '../src/game/pes/game.ts'
import { DEFAULT_PARAMS, STYLES, cloneInstructions, type StyleId } from '../src/game/pes/tactics.ts'
import { caOf, positionMultiplier } from '../src/game/ca.ts'
import { FORMATIONS as GAME_FORMATIONS } from '../src/game/data/formations.ts'
import type { TeamIndex } from '../src/game/pes/spec.ts'
import { ablationFixture, type AblationFormation } from './tactics-ablation-fixture.ts'

const self = fileURLToPath(import.meta.url)
type Scenario = { id: string; a: StyleId; b: StyleId; space: boolean; narrow: boolean; famSide: 'a' | 'b' }
const SCENARIOS: readonly Scenario[] = [
  { id: 'counter:mixed', a: 'directCounter', b: 'highPress', space: false, narrow: false, famSide: 'a' },
  { id: 'counter:space', a: 'directCounter', b: 'highPress', space: true, narrow: false, famSide: 'a' },
  { id: 'control:normal', a: 'control', b: 'catenaccio', space: false, narrow: false, famSide: 'b' },
  { id: 'control:narrow', a: 'control', b: 'catenaccio', space: false, narrow: true, famSide: 'b' },
  { id: 'wing:normal', a: 'wingPlay', b: 'catenaccio', space: false, narrow: false, famSide: 'b' },
  { id: 'wing:narrow', a: 'wingPlay', b: 'catenaccio', space: false, narrow: true, famSide: 'b' },
]
const FORMATIONS: readonly AblationFormation[] = ['4-4-2', '4-3-3']
const FAMILIARITIES = [1, 0.4] as const
type Spec = { formation: AblationFormation; id: string; fam: number; seed: number; aHome: boolean }
type Side = {
  xg: number; goals: number; shots: number; passes: number; passCompleted: number; offsides: number
  defensiveWidth: number | null; widthSamples: number
  receptions: number; wideReceptions: number; wideFinalThirdReceptions: number
  crossDecisions: number; crossCandidates: number; crossPreferred: number; crossCanceledControl: number; crossCanceledFoul: number; crosses: number; crossSettledOk: number
  spaceDecisions: number; spaceEligibleDecisions: number; spaceCandidates: number; spaceRejections: Record<string, number>
  spacePasses: number; spaceSettledOk: number; spaceReceived: number; spaceReceivedOk: number
  runnerDecisions: number; runnerBlocked: Record<string, number>; runnerTrials: number; runnerStarted: number
  taskFrames: number; taskConflictFrames: number
}
type Row = { spec: Spec; a: Side; b: Side }
type Job = { specs: Spec[]; out: string; hashes: Record<AblationFormation, string> }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'number') return JSON.stringify(Number.isFinite(value) ? value : 0)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj).filter((k) => obj[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
function fixtureHash(formation: AblationFormation): string {
  return crypto.createHash('sha256').update(canonical(ablationFixture(formation))).digest('hex')
}
function codeHash(): string {
  const hash = crypto.createHash('sha256')
  const visit = (name: string): void => {
    if (fs.statSync(name).isDirectory()) for (const child of fs.readdirSync(name).sort()) visit(path.join(name, child))
    else hash.update(name).update('\0').update(fs.readFileSync(name)).update('\0')
  }
  for (const name of ['src', 'scripts/tactics-followup.ts', 'scripts/tactics-ablation-fixture.ts', 'scripts/tactics-experiment-helpers.ts', 'package-lock.json']) if (fs.existsSync(name)) visit(name)
  return hash.digest('hex')
}
function run(spec: Spec): Row {
  const scenario = SCENARIOS.find((c) => c.id === spec.id)
  if (!scenario) throw new Error(`未知实验 ${spec.id}`)
  const { home, away } = ablationFixture(spec.formation)
  const a = structuredClone(home)
  const b = structuredClone(away)
  a.instructions = cloneInstructions(STYLES[scenario.a].instructions)
  b.instructions = cloneInstructions(STYLES[scenario.b].instructions)
  a.instructions.advanced = { possession: { receiving: scenario.space ? 'space' : 'mixed' }, defense: { width: 'normal' } }
  b.instructions.advanced = { possession: { receiving: 'mixed' }, defense: { width: scenario.narrow ? 'narrow' : 'normal' } }
  a.familiarity = scenario.famSide === 'a' ? spec.fam : 1
  b.familiarity = scenario.famSide === 'b' ? spec.fam : 1
  const game = new PesGame({ seed: spec.seed, home: spec.aHome ? a : b, away: spec.aHome ? b : a,
    durationSeconds: 900, offside: true, noInjuries: true, now: 0, metrics: true })
  const state = game.run()
  const result = (index: TeamIndex): Side => {
    const stats = state.stats[index === 0 ? 'home' : 'away']
    const sample = game.match.metrics!.teams[index]
    const widths = sample.defensiveWidth
    return {
      xg: stats.xg, goals: stats.goals, shots: stats.shots, passes: stats.passes, passCompleted: stats.passesCompleted,
      offsides: game.match.teams[index].stats.offsides,
      defensiveWidth: widths.length ? widths.reduce((x, y) => x + y, 0) / widths.length : null, widthSamples: widths.length,
      receptions: sample.receptions, wideReceptions: sample.wideReceptions, wideFinalThirdReceptions: sample.wideFinalThirdReceptions,
      crossDecisions: sample.crossDecisions, crossCandidates: sample.crossCandidates, crossPreferred: sample.crossPreferred,
      crossCanceledControl: sample.crossCanceledControl, crossCanceledFoul: sample.crossCanceledFoul,
      crosses: sample.crosses, crossSettledOk: sample.crossSettledOk,
      spaceDecisions: sample.spaceDecisions, spaceEligibleDecisions: sample.spaceEligibleDecisions, spaceCandidates: sample.spaceCandidates,
      spaceRejections: sample.spaceRejections, spacePasses: sample.spacePasses, spaceSettledOk: sample.spaceSettledOk,
      spaceReceived: sample.spaceReceived, spaceReceivedOk: sample.spaceReceivedOk,
      runnerDecisions: sample.runnerDecisions, runnerBlocked: sample.runnerBlocked, runnerTrials: sample.runnerTrials, runnerStarted: sample.runnerStarted,
      taskFrames: sample.taskFrames, taskConflictFrames: sample.taskConflictFrames,
    }
  }
  return { spec, a: result(spec.aHome ? 0 : 1), b: result(spec.aHome ? 1 : 0) }
}
function worker(specs: Spec[], id: number, hashes: Record<AblationFormation, string>): Promise<Row[]> {
  const tmp = path.join(os.tmpdir(), `tactics-followup-${process.pid}-${id}.json`)
  const out = `${tmp}.out`
  fs.writeFileSync(tmp, JSON.stringify({ specs, out, hashes } satisfies Job))
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, self, '--child', tmp], { stdio: ['ignore', 'ignore', 'inherit'] })
    child.on('error', reject)
    child.on('close', (code) => {
      try {
        if (code !== 0) throw new Error(`worker ${id} 退出码 ${code}`)
        resolve(JSON.parse(fs.readFileSync(out, 'utf8')) as Row[])
      } catch (error) { reject(error) }
      finally { fs.rmSync(tmp, { force: true }); fs.rmSync(out, { force: true }) }
    })
  })
}
function option(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`)
  if (index < 0) return fallback
  const n = Number(process.argv[index + 1])
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`--${name} 需要正整数`)
  return n
}
const mean = (v: number[]) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN
function ci(v: number[]): [number, number] {
  if (v.length < 2) return [NaN, NaN]
  let state = 0x9e3779b9
  const samples: number[] = []
  for (let i = 0; i < 10000; i++) {
    let total = 0
    for (let j = 0; j < v.length; j++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      total += v[Math.floor(state / 0x100000000 * v.length)]
    }
    samples.push(total / v.length)
  }
  samples.sort((a, b) => a - b)
  return [samples[249], samples[9749]]
}
const fmt = (x: number) => Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(2)}` : 'n/a'
type Effect = { value: number; ci: [number, number]; n: number; seeds: number[]; bySeed: number[] }
const xgd = (r: Row) => r.a.xg - r.b.xg
const perMatch = (r: Row, key: keyof Side) => r.a[key] as number
function summarize(rows: Row[], seeds: number[]): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  const get = (form: AblationFormation, id: string, fam: number, seed: number) => rows.filter((r) => r.spec.formation === form && r.spec.id === id && r.spec.fam === fam && r.spec.seed === seed)
  const block = (form: AblationFormation, id: string, fam: number, seed: number, read: (r: Row) => number) => {
    const rs = get(form, id, fam, seed)
    if (rs.length !== 2 || new Set(rs.map((r) => r.spec.aHome)).size !== 2) return NaN
    const values = rs.map(read)
    return values.every(Number.isFinite) ? mean(values) : NaN
  }
  const effect = (form: AblationFormation, test: string, control: string, fam: number, read: (r: Row) => number): Effect => {
    const pairs = seeds.map((seed) => ({ seed, diff: block(form, test, fam, seed, read) - block(form, control, fam, seed, read) })).filter((v) => Number.isFinite(v.diff))
    const values = pairs.map((v) => v.diff)
    return { value: mean(values), ci: ci(values), n: values.length, seeds: pairs.map((v) => v.seed), bySeed: values }
  }
  for (const form of FORMATIONS) for (const fam of FAMILIARITIES) {
    const key = `${form}|fam=${fam}`
    const cases: Record<string, unknown> = {}
    const comparisons: Record<string, unknown> = {}
    console.log(`\n=== ${key} ===`)
    for (const scenario of SCENARIOS) {
      const rs = rows.filter((r) => r.spec.formation === form && r.spec.id === scenario.id && r.spec.fam === fam)
      const sum = (read: (r: Row) => number) => rs.reduce((s, r) => s + read(r), 0)
      const rejections: Record<string, number> = {}
      const runnerBlocked: Record<string, number> = {}
      for (const r of rs) {
        for (const [reason, count] of Object.entries(r.a.spaceRejections)) rejections[reason] = (rejections[reason] ?? 0) + count
        for (const [reason, count] of Object.entries(r.a.runnerBlocked)) runnerBlocked[reason] = (runnerBlocked[reason] ?? 0) + count
      }
      const widths = rs.map((r) => r.b.defensiveWidth).filter((n): n is number => n !== null)
      const v = {
        games: rs.length, xgd: mean(rs.map(xgd)), xgf: mean(rs.map((r) => r.a.xg)), xga: mean(rs.map((r) => r.b.xg)),
        defensiveWidthB: mean(widths), widthGames: widths.length, widthSamples: sum((r) => r.b.widthSamples),
        receptions: sum((r) => r.a.receptions), wideReceptions: sum((r) => r.a.wideReceptions), wideFinalThirdReceptions: sum((r) => r.a.wideFinalThirdReceptions),
        crosses: sum((r) => r.a.crosses), crossSettledOk: sum((r) => r.a.crossSettledOk), crossDecisions: sum((r) => r.a.crossDecisions),
        crossCandidates: sum((r) => r.a.crossCandidates), crossPreferred: sum((r) => r.a.crossPreferred),
        crossCanceledControl: sum((r) => r.a.crossCanceledControl), crossCanceledFoul: sum((r) => r.a.crossCanceledFoul),
        passes: sum((r) => r.a.passes), passCompleted: sum((r) => r.a.passCompleted), shots: sum((r) => r.a.shots), offsides: sum((r) => r.a.offsides),
        spaceDecisions: sum((r) => r.a.spaceDecisions), eligible: sum((r) => r.a.spaceEligibleDecisions), candidates: sum((r) => r.a.spaceCandidates),
        spacePasses: sum((r) => r.a.spacePasses), spaceSettledOk: sum((r) => r.a.spaceSettledOk), spaceReceived: sum((r) => r.a.spaceReceived), spaceReceivedOk: sum((r) => r.a.spaceReceivedOk),
        runnerDecisions: sum((r) => r.a.runnerDecisions), runnerTrials: sum((r) => r.a.runnerTrials), runnerStarted: sum((r) => r.a.runnerStarted), rejections, runnerBlocked,
        taskFrames: sum((r) => r.a.taskFrames + r.b.taskFrames), conflicts: sum((r) => r.a.taskConflictFrames + r.b.taskConflictFrames),
      }
      cases[scenario.id] = v
      console.log(`${scenario.id.padEnd(16)} xGD ${fmt(v.xgd)} B-width ${fmt(v.defensiveWidthB)} wide/final ${v.wideReceptions}/${v.wideFinalThirdReceptions} cross ${v.crosses} space ${v.spacePasses} runners ${v.runnerStarted}/${v.runnerTrials}/${v.runnerDecisions}`)
    }
    for (const [name, test, control] of [
      ['counter:space', 'counter:space', 'counter:mixed'],
      ['control:opponent-narrow', 'control:narrow', 'control:normal'],
      ['wing:opponent-narrow', 'wing:narrow', 'wing:normal'],
    ] as const) {
      const metrics = {
        xgd: effect(form, test, control, fam, xgd),
        defensiveWidthB: effect(form, test, control, fam, (r) => r.b.defensiveWidth ?? NaN),
        wideReceptions: effect(form, test, control, fam, (r) => perMatch(r, 'wideReceptions')),
        wideFinalThirdReceptions: effect(form, test, control, fam, (r) => perMatch(r, 'wideFinalThirdReceptions')),
        crosses: effect(form, test, control, fam, (r) => perMatch(r, 'crosses')),
        crossCandidates: effect(form, test, control, fam, (r) => perMatch(r, 'crossCandidates')),
        offsides: effect(form, test, control, fam, (r) => perMatch(r, 'offsides')),
        shots: effect(form, test, control, fam, (r) => perMatch(r, 'shots')),
      }
      comparisons[name] = metrics
      const fields = Object.entries(metrics).map(([label, v]) => `${label} ${fmt(v.value)} [${fmt(v.ci[0])},${fmt(v.ci[1])}]`).join(' | ')
      console.log(`  ${name}: ${fields}`)
    }
    output[key] = { cases, comparisons }
  }
  return output
}
async function main(): Promise<void> {
  const n = option('n', 8)
  const workers = Math.min(2, option('workers', Math.min(2, os.cpus().length)))
  const seed0 = option('seed0', 20001)
  const outIndex = process.argv.indexOf('--out')
  const out = outIndex < 0 ? 'docs/tactics-followup-results.json' : process.argv[outIndex + 1]
  if (!out || out.startsWith('--')) throw new Error('--out 需要文件路径')
  const seeds = Array.from({ length: n }, (_, i) => seed0 + i)
  const specs: Spec[] = []
  for (const formation of FORMATIONS) for (const scenario of SCENARIOS) for (const fam of FAMILIARITIES) for (const seed of seeds) for (const aHome of [true, false]) {
    specs.push({ formation, id: scenario.id, fam, seed, aHome })
  }
  const hashes = Object.fromEntries(FORMATIONS.map((f) => [f, fixtureHash(f)])) as Record<AblationFormation, string>
  const sourceHash = codeHash()
  const lineups = Object.fromEntries(FORMATIONS.map((formation) => {
    const { home } = ablationFixture(formation)
    return [formation, home.starters.map((s) => {
      const slot = GAME_FORMATIONS[formation].slots.find((v) => v.id === s.slotId)!
      const proficiency = s.player.positions[slot.position]
      return { slot: s.slotId, id: s.player.id, role: s.role, position: slot.position, proficiency,
        positionMultiplier: positionMultiplier(proficiency), ca: caOf(s.player.attrs, s.player.positions.GK > 0), skills: s.player.skills }
    })]
  }))
  console.log(`Node ${process.version}，源码 ${sourceHash}，夹具 ${JSON.stringify(hashes)}，${specs.length} 场，${n} 种子，${workers} worker`)
  const chunks: Spec[][] = Array.from({ length: workers }, () => [])
  specs.forEach((spec, index) => chunks[index % workers].push(spec))
  const started = Date.now()
  const rows = (await Promise.all(chunks.map((chunk, index) => chunk.length ? worker(chunk, index, hashes) : Promise.resolve([])))).flat()
  console.log(`跑完 ${rows.length} 场（${((Date.now() - started) / 1000).toFixed(1)}s）`)
  const summary = summarize(rows, seeds)
  fs.writeFileSync(out, JSON.stringify({ node: process.version, sourceHash, fixtureHashes: hashes, lineups, params: DEFAULT_PARAMS,
    scenarios: SCENARIOS, seeds, formations: FORMATIONS, familiarities: FAMILIARITIES, summary, rows }, null, 2))
  console.log(`\n原始数据：${out}`)
}
const child = process.argv.indexOf('--child')
if (child >= 0) {
  const job = JSON.parse(fs.readFileSync(process.argv[child + 1], 'utf8')) as Job
  for (const formation of FORMATIONS) if (fixtureHash(formation) !== job.hashes[formation]) throw new Error(`worker 夹具不一致：${formation}`)
  fs.writeFileSync(job.out, JSON.stringify(job.specs.map(run)))
} else void main().catch((error) => { console.error(error); process.exitCode = 1 })
