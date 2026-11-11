/** 尽早传中单项探索：相同阵容、对手、种子，主客配对；不改变旧模板。 */
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ablationFixture, type AblationFormation } from './tactics-ablation-fixture.ts'
import { cloneInstructions, STYLES } from '../src/game/pes/tactics.ts'
import { PesGame } from '../src/game/pes/game.ts'
import type { TeamIndex } from '../src/game/pes/spec.ts'

const self = fileURLToPath(import.meta.url)
const forms = ['4-4-2', '4-3-3'] as const
const fams = [1, 0.4] as const
type Spec = { formation: AblationFormation; narrow: boolean; fam: number; early: boolean; seed: number; aHome: boolean }
type Row = { spec: Spec; xgd: number; xga: number; shots: number; xgf: number; goals: number; pass: number; passOk: number;
  decisions: number; candidates: number; preferred: number; canceledControl: number; canceledFoul: number; crosses: number; settledOk: number;
  wideReceptions: number; wideFinalThirdReceptions: number; defensiveWidth: number | null }
type Job = { specs: Spec[]; out: string; sourceHash: string }
function sourceHash(): string {
  const hash = crypto.createHash('sha256')
  const visit = (file: string): void => {
    if (fs.statSync(file).isDirectory()) for (const child of fs.readdirSync(file).sort()) visit(path.join(file, child))
    else hash.update(file).update('\0').update(fs.readFileSync(file)).update('\0')
  }
  for (const file of ['src', 'scripts/tactics-cross-experiment.ts', 'scripts/tactics-ablation-fixture.ts', 'scripts/tactics-experiment-helpers.ts', 'package-lock.json']) if (fs.existsSync(file)) visit(file)
  return hash.digest('hex')
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'number') return JSON.stringify(Number.isFinite(value) ? value : 0)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj).filter((k) => obj[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
function run(spec: Spec): Row {
  const { home: a, away: b } = ablationFixture(spec.formation)
  a.instructions = cloneInstructions(STYLES.wingPlay.instructions)
  b.instructions = cloneInstructions(STYLES.catenaccio.instructions)
  a.instructions.advanced = { possession: { receiving: 'mixed', crossTiming: spec.early ? 'early' : 'balanced' }, defense: { width: 'normal' } }
  b.instructions.advanced = { possession: { receiving: 'mixed', crossTiming: 'balanced' }, defense: { width: spec.narrow ? 'narrow' : 'normal' } }
  a.familiarity = spec.fam
  b.familiarity = 1
  const game = new PesGame({ seed: spec.seed, home: spec.aHome ? a : b, away: spec.aHome ? b : a,
    durationSeconds: 900, offside: true, noInjuries: true, now: 0, metrics: true })
  const state = game.run()
  const index: TeamIndex = spec.aHome ? 0 : 1
  const opp: TeamIndex = index === 0 ? 1 : 0
  const aStats = state.stats[index === 0 ? 'home' : 'away']
  const bStats = state.stats[index === 0 ? 'away' : 'home']
  const sample = game.match.metrics!.teams[index]
  const widths = game.match.metrics!.teams[opp].defensiveWidth
  return { spec, xgd: aStats.xg - bStats.xg, xga: bStats.xg, xgf: aStats.xg, goals: aStats.goals, shots: aStats.shots,
    pass: aStats.passes, passOk: aStats.passesCompleted, decisions: sample.crossDecisions, candidates: sample.crossCandidates,
    preferred: sample.crossPreferred, canceledControl: sample.crossCanceledControl, canceledFoul: sample.crossCanceledFoul,
    crosses: sample.crosses, settledOk: sample.crossSettledOk, wideReceptions: sample.wideReceptions,
    wideFinalThirdReceptions: sample.wideFinalThirdReceptions, defensiveWidth: widths.length ? widths.reduce((a, b) => a + b, 0) / widths.length : null }
}
function worker(specs: Spec[], id: number, expected: string): Promise<Row[]> {
  const tmp = path.join(os.tmpdir(), `cross-${process.pid}-${id}.json`)
  const out = `${tmp}.out`
  fs.writeFileSync(tmp, JSON.stringify({ specs, out, sourceHash: expected } satisfies Job))
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
  const value = Number(process.argv[index + 1])
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${name} 需要正整数`)
  return value
}
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN
function ci(a: number[]): [number, number] {
  if (a.length < 2) return [NaN, NaN]
  let state = 0x9e3779b9
  const samples: number[] = []
  for (let i = 0; i < 10000; i++) {
    let total = 0
    for (let j = 0; j < a.length; j++) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; total += a[Math.floor(state / 0x100000000 * a.length)] }
    samples.push(total / a.length)
  }
  samples.sort((x, y) => x - y)
  return [samples[249], samples[9749]]
}
const fmt = (n: number) => Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}` : 'n/a'
function summarize(rows: Row[], seeds: number[]): Record<string, unknown> {
  const summary: Record<string, unknown> = {}
  for (const formation of forms) for (const narrow of [false, true]) for (const fam of fams) {
    const key = `${formation}|${narrow ? 'narrow' : 'normal'}|fam=${fam}`
    const cells: Record<string, unknown> = {}
    for (const early of [false, true]) {
      const rs = rows.filter((r) => r.spec.formation === formation && r.spec.narrow === narrow && r.spec.fam === fam && r.spec.early === early)
      const sum = (f: (r: Row) => number) => rs.reduce((v, r) => v + f(r), 0)
      cells[early ? 'early' : 'balanced'] = { games: rs.length, xgd: mean(rs.map((r) => r.xgd)), xgf: mean(rs.map((r) => r.xgf)), xga: mean(rs.map((r) => r.xga)),
        crosses: sum((r) => r.crosses), settledOk: sum((r) => r.settledOk), candidates: sum((r) => r.candidates), preferred: sum((r) => r.preferred),
        canceledControl: sum((r) => r.canceledControl), canceledFoul: sum((r) => r.canceledFoul), pass: sum((r) => r.pass), passOk: sum((r) => r.passOk) }
    }
    const effect = (field: keyof Omit<Row, 'spec'>) => {
      const diffs = seeds.map((seed) => {
        const values = (early: boolean) => rows.filter((r) => r.spec.formation === formation && r.spec.narrow === narrow && r.spec.fam === fam && r.spec.early === early && r.spec.seed === seed)
        const a = values(true); const b = values(false)
        if (a.length !== 2 || b.length !== 2) return NaN
        const pick = (r: Row) => typeof r[field] === 'number' ? r[field] as number : NaN
        const av = a.map(pick); const bv = b.map(pick)
        return av.every(Number.isFinite) && bv.every(Number.isFinite) ? mean(av) - mean(bv) : NaN
      }).filter(Number.isFinite)
      return { value: mean(diffs), ci: ci(diffs), n: diffs.length, bySeed: diffs }
    }
    const effects = { xgd: effect('xgd'), xgf: effect('xgf'), xga: effect('xga'), goals: effect('goals'), shots: effect('shots'),
      crosses: effect('crosses'), candidates: effect('candidates'), preferred: effect('preferred'), wideFinalThirdReceptions: effect('wideFinalThirdReceptions') }
    summary[key] = { cells, effects }
    console.log(`${key}: Δcross ${fmt(effects.crosses.value)} [${fmt(effects.crosses.ci[0])},${fmt(effects.crosses.ci[1])}], ΔxGD ${fmt(effects.xgd.value)} [${fmt(effects.xgd.ci[0])},${fmt(effects.xgd.ci[1])}], Δshots ${fmt(effects.shots.value)}`)
  }
  return summary
}
async function main(): Promise<void> {
  const n = option('n', 4)
  const seed0 = option('seed0', 40001)
  const workers = Math.min(2, option('workers', Math.min(2, os.cpus().length)))
  const at = process.argv.indexOf('--out')
  const out = at < 0 ? 'docs/tactics-cross-experiment.json' : process.argv[at + 1]
  if (!out || out.startsWith('--')) throw new Error('--out 需要文件路径')
  const seeds = Array.from({ length: n }, (_, i) => seed0 + i)
  const specs: Spec[] = []
  for (const formation of forms) for (const narrow of [false, true]) for (const fam of fams) for (const early of [false, true]) for (const seed of seeds) for (const aHome of [true, false]) {
    specs.push({ formation, narrow, fam, early, seed, aHome })
  }
  const hashes = Object.fromEntries(forms.map((formation) => [formation, crypto.createHash('sha256').update(canonical(ablationFixture(formation))).digest('hex')]))
  const source = sourceHash()
  console.log(`Node ${process.version}，源码 ${source}，夹具 ${JSON.stringify(hashes)}，${specs.length} 场，${n} 种子，${workers} worker`)
  const chunks: Spec[][] = Array.from({ length: workers }, () => [])
  specs.forEach((spec, i) => chunks[i % workers].push(spec))
  const started = Date.now()
  const rows = (await Promise.all(chunks.map((chunk, i) => chunk.length ? worker(chunk, i, source) : Promise.resolve([])))).flat()
  console.log(`跑完 ${rows.length} 场（${((Date.now() - started) / 1000).toFixed(1)}s）`)
  const summary = summarize(rows, seeds)
  fs.writeFileSync(out, JSON.stringify({ node: process.version, sourceHash: source, fixtureHashes: hashes, seeds, forms, fams, summary, rows }, null, 2))
  console.log(`原始数据：${out}`)
}
const child = process.argv.indexOf('--child')
if (child >= 0) {
  const job = JSON.parse(fs.readFileSync(process.argv[child + 1], 'utf8')) as Job
  if (sourceHash() !== job.sourceHash) throw new Error('worker 源码不一致')
  fs.writeFileSync(job.out, JSON.stringify(job.specs.map(run)))
} else void main().catch((error) => { console.error(error); process.exitCode = 1 })
