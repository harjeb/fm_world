/**
 * 战术单项 / 组合消融：相同对手、严格镜像、主客换边、配对种子。
 * 仅探索，不冒充正式验收；输出每场原始数据以便重采样。
 *
 * npm run tactics:ablation -- --n 4 --workers 2 --out /tmp/tactics-ablation.json
 */
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { baselineTeams } from '../src/game/pes/baseline.ts'
import { PesGame } from '../src/game/pes/game.ts'
import { DEFAULT_PARAMS, STYLES, cloneInstructions, type StyleId, type TacticalInstructionsV2, type TacticsParams } from '../src/game/pes/tactics.ts'
import { attrLimit, attrStorage } from '../src/game/scale.ts'
import { ALL_ATTRIBUTES } from '../src/game/types.ts'
import type { MatchTeamInput } from '../src/game/match/types.ts'
import { makeExactMirror } from './tactics-experiment-helpers.ts'

const self = fileURLToPath(import.meta.url)
type Case = { id: string; a: StyleId; b: StyleId; space: boolean; narrow: 'a' | 'b' | 'none'; famSide: 'a' | 'b' }
const CASES: Case[] = [
  { id: 'counter-high:00', a: 'directCounter', b: 'highPress', space: false, narrow: 'none', famSide: 'a' },
  { id: 'counter-high:10', a: 'directCounter', b: 'highPress', space: true, narrow: 'none', famSide: 'a' },
  { id: 'counter-high:01', a: 'directCounter', b: 'highPress', space: false, narrow: 'a', famSide: 'a' },
  { id: 'counter-high:11', a: 'directCounter', b: 'highPress', space: true, narrow: 'a', famSide: 'a' },
  { id: 'control-chain:normal', a: 'control', b: 'catenaccio', space: false, narrow: 'none', famSide: 'b' },
  { id: 'control-chain:narrow', a: 'control', b: 'catenaccio', space: false, narrow: 'b', famSide: 'b' },
  { id: 'wing-chain:normal', a: 'wingPlay', b: 'catenaccio', space: false, narrow: 'none', famSide: 'b' },
  { id: 'wing-chain:narrow', a: 'wingPlay', b: 'catenaccio', space: false, narrow: 'b', famSide: 'b' },
]
const PROFILES = {
  previous: { spaceLeadScale: 1, defenseCompactness: 0.15, defenseMarkBuffer: 1.5 },
  proposed: { spaceLeadScale: 1.5, defenseCompactness: 0.25, defenseMarkBuffer: 3 },
} as const
type Profile = keyof typeof PROFILES
type Spec = { id: string; profile: Profile; fam: number; seed: number; aHome: boolean }
type Side = {
  xg: number; goals: number; passes: number; shots: number; possession: number
  defensiveWidth: number | null; widthSamples: number
  spaceDecisions: number; eligible: number; candidates: number; rejections: Record<string, number>; spacePasses: number; settledOk: number; received: number; receivedOk: number
  taskFrames: number; taskConflictFrames: number
}
type Row = { spec: Spec; a: Side; b: Side }
type Job = { specs: Spec[]; out: string; fixtureHash: string }

function fixture(): { home: MatchTeamInput; away: MatchTeamInput } {
  const { home, away } = baselineTeams(1)
  for (const team of [home, away]) {
    delete team.autoSubs
    delete team.chemistry
    for (const player of [...team.starters.map((s) => s.player), ...team.bench]) {
      player.condition = 100
      const gk = player.positions.GK > 0
      for (const key of ALL_ATTRIBUTES) {
        const limit = attrLimit(key, gk)
        player.attrs[key] = limit <= 0 ? 0 : Math.min(limit, Math.round(attrStorage(key, 67, gk)))
      }
    }
  }
  makeExactMirror(home, away)
  return { home, away }
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
function hashFixture(): string { return crypto.createHash('sha256').update(canonical(fixture())).digest('hex') }
function codeHash(): string {
  const hash = crypto.createHash('sha256')
  const visit = (name: string): void => {
    if (fs.statSync(name).isDirectory()) for (const child of fs.readdirSync(name).sort()) visit(path.join(name, child))
    else hash.update(name).update('\0').update(fs.readFileSync(name)).update('\0')
  }
  for (const name of ['src', 'scripts/tactics-ablation.ts', 'scripts/tactics-experiment-helpers.ts', 'package-lock.json']) if (fs.existsSync(name)) visit(name)
  return hash.digest('hex')
}

function configure(style: StyleId, space: boolean, narrow: boolean): TacticalInstructionsV2 {
  const config = cloneInstructions(STYLES[style].instructions)
  // 显式中性和非中性只差这一项；其余九项 / 人员 / 对手保持一致。
  config.advanced = { possession: { receiving: space ? 'space' : 'mixed' }, defense: { width: narrow ? 'narrow' : 'normal' } }
  return config
}

function run(spec: Spec): Row {
  const scenario = CASES.find((c) => c.id === spec.id)
  if (!scenario) throw new Error(`未知实验 ${spec.id}`)
  const base = fixture()
  const a = structuredClone(base.home)
  const b = structuredClone(base.away)
  a.instructions = configure(scenario.a, scenario.space, scenario.narrow === 'a')
  b.instructions = configure(scenario.b, false, scenario.narrow === 'b')
  a.familiarity = scenario.famSide === 'a' ? spec.fam : 1
  b.familiarity = scenario.famSide === 'b' ? spec.fam : 1
  const game = new PesGame({ seed: spec.seed, home: spec.aHome ? a : b, away: spec.aHome ? b : a,
    durationSeconds: 900, offside: true, noInjuries: true, now: 0, metrics: true,
    tacticsParams: PROFILES[spec.profile] satisfies Partial<TacticsParams> })
  const state = game.run()
  const result = (index: 0 | 1): Side => {
    const stats = state.stats[index === 0 ? 'home' : 'away']
    const metrics = game.match.metrics!.teams[index]
    const widths = metrics.defensiveWidth
    return {
      xg: stats.xg, goals: stats.goals, passes: stats.passes, shots: stats.shots, possession: stats.possession,
      defensiveWidth: widths.length ? widths.reduce((x, y) => x + y, 0) / widths.length : null, widthSamples: widths.length,
      spaceDecisions: metrics.spaceDecisions, eligible: metrics.spaceEligibleDecisions, candidates: metrics.spaceCandidates,
      rejections: metrics.spaceRejections, spacePasses: metrics.spacePasses, settledOk: metrics.spaceSettledOk, received: metrics.spaceReceived, receivedOk: metrics.spaceReceivedOk,
      taskFrames: metrics.taskFrames, taskConflictFrames: metrics.taskConflictFrames,
    }
  }
  return { spec, a: result(spec.aHome ? 0 : 1), b: result(spec.aHome ? 1 : 0) }
}

function worker(specs: Spec[], id: number, fixtureHash: string): Promise<Row[]> {
  const tmp = path.join(os.tmpdir(), `tactics-ablation-${process.pid}-${id}.json`)
  const out = `${tmp}.out`
  fs.writeFileSync(tmp, JSON.stringify({ specs, out, fixtureHash } satisfies Job))
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
const mean = (values: number[]): number => values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN
function ci(values: number[]): [number, number] {
  if (values.length < 2) return [NaN, NaN]
  let state = 0x9e3779b9
  const samples: number[] = []
  for (let i = 0; i < 5000; i++) {
    let total = 0
    for (let j = 0; j < values.length; j++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      total += values[Math.floor(state / 0x100000000 * values.length)]
    }
    samples.push(total / values.length)
  }
  samples.sort((a, b) => a - b)
  return [samples[124], samples[4874]]
}
const fmt = (x: number): string => Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(2)}` : 'n/a'

function report(rows: Row[], seeds: number[]): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  const cells = (id: string, profile: Profile, fam: number): Row[] => rows.filter((r) => r.spec.id === id && r.spec.profile === profile && r.spec.fam === fam)
  const block = (id: string, profile: Profile, fam: number, seed: number, pick: (r: Row) => number): number => {
    const matches = cells(id, profile, fam).filter((r) => r.spec.seed === seed)
    return matches.length === 2 ? mean(matches.map(pick)) : NaN
  }
  const comparison = (profile: Profile, fam: number, a: string, b: string, pick: (r: Row) => number) => {
    const values = seeds.map((seed) => block(a, profile, fam, seed, pick) - block(b, profile, fam, seed, pick)).filter(Number.isFinite)
    return { value: mean(values), ci: ci(values), n: values.length, bySeed: values }
  }
  for (const profile of Object.keys(PROFILES) as Profile[]) for (const fam of [1, 0.4]) {
    const key = `${profile}|fam=${fam}`
    const group: Record<string, unknown> = {}
    console.log(`\n=== ${key} ===`)
    for (const c of CASES) {
      const rs = cells(c.id, profile, fam)
      const games = rs.length
      const widthSide = c.famSide === 'a' ? 'a' : 'b'
      const widths = rs.map((r) => r[widthSide].defensiveWidth).filter((v): v is number => v !== null)
      const passes = rs.reduce((s, r) => s + r.a.passes, 0)
      const through = rs.reduce((s, r) => s + r.a.spacePasses, 0)
      const ok = rs.reduce((s, r) => s + r.a.settledOk, 0)
      const received = rs.reduce((s, r) => s + r.a.received, 0)
      const receivedOk = rs.reduce((s, r) => s + r.a.receivedOk, 0)
      const eligible = rs.reduce((s, r) => s + r.a.eligible, 0)
      const decisions = rs.reduce((s, r) => s + r.a.spaceDecisions, 0)
      const rejections: Record<string, number> = {}
      for (const r of rs) for (const [reason, count] of Object.entries(r.a.rejections)) rejections[reason] = (rejections[reason] ?? 0) + count
      const conflicts = rs.reduce((s, r) => s + r.a.taskConflictFrames + r.b.taskConflictFrames, 0)
      const taskFrames = rs.reduce((s, r) => s + r.a.taskFrames + r.b.taskFrames, 0)
      const xgd = mean(rs.map((r) => r.a.xg - r.b.xg))
      group[c.id] = { games, xgd, width: mean(widths), widthGames: widths.length, passes, spacePasses: through, settledOk: ok, received, receivedOk, eligible, decisions, rejections, conflicts, taskFrames }
      console.log(`${c.id.padEnd(24)} xGD ${fmt(xgd)} width ${fmt(mean(widths))}m space ${through}/${passes} settled/recv/recvOk ${ok}/${received}/${receivedOk} eligible ${eligible}/${decisions} conflict ${conflicts}/${taskFrames}`)
    }
    const comparisons: Record<string, unknown> = {}
    for (const [name, a, b] of [
      ['counter:space', 'counter-high:10', 'counter-high:00'],
      ['counter:narrow', 'counter-high:01', 'counter-high:00'],
      ['counter:both', 'counter-high:11', 'counter-high:00'],
      ['control:opponent-narrow', 'control-chain:narrow', 'control-chain:normal'],
      ['wing:opponent-narrow', 'wing-chain:narrow', 'wing-chain:normal'],
    ] as const) {
      const xgd = comparison(profile, fam, a, b, (r) => r.a.xg - r.b.xg)
      const width = comparison(profile, fam, a, b, (r) => (name.startsWith('counter') ? r.a : r.b).defensiveWidth ?? NaN)
      comparisons[name] = { xgd, width }
      console.log(`  ${name}: ΔxGD ${fmt(xgd.value)} [${fmt(xgd.ci[0])},${fmt(xgd.ci[1])}] Δwidth ${fmt(width.value)}m [${fmt(width.ci[0])},${fmt(width.ci[1])}]`)
    }
    const interaction = seeds.map((seed) => {
      const xgd = (id: string) => block(id, profile, fam, seed, (r) => r.a.xg - r.b.xg)
      return xgd('counter-high:11') - xgd('counter-high:10') - xgd('counter-high:01') + xgd('counter-high:00')
    }).filter(Number.isFinite)
    const joint = { value: mean(interaction), ci: ci(interaction), n: interaction.length, bySeed: interaction }
    console.log(`  counter:space×narrow: ΔΔxGD ${fmt(joint.value)} [${fmt(joint.ci[0])},${fmt(joint.ci[1])}]`)
    output[key] = { cells: group, comparisons, jointInteraction: joint }
  }
  const summarize = (values: number[]) => {
    const complete = values.filter(Number.isFinite)
    return { value: mean(complete), ci: ci(complete), n: complete.length }
  }
  const definitions = [
    ['counter:space', 'counter-high:10', 'counter-high:00'],
    ['counter:narrow', 'counter-high:01', 'counter-high:00'],
    ['counter:both', 'counter-high:11', 'counter-high:00'],
    ['control:opponent-narrow', 'control-chain:narrow', 'control-chain:normal'],
    ['wing:opponent-narrow', 'wing-chain:narrow', 'wing-chain:normal'],
  ] as const
  const effects: Record<string, unknown> = {}
  const xgd = (r: Row) => r.a.xg - r.b.xg
  for (const [name, treatment, control] of definitions) {
    const diff = (profile: Profile, fam: number, seed: number, pick: (r: Row) => number) =>
      block(treatment, profile, fam, seed, pick) - block(control, profile, fam, seed, pick)
    for (const fam of [1, 0.4]) {
      const change = summarize(seeds.map((seed) => diff('proposed', fam, seed, xgd) - diff('previous', fam, seed, xgd)))
      effects[`profile|${name}|fam=${fam}`] = change
      console.log(`profile ${name} fam=${fam}: 新旧效应差 ΔΔxGD ${fmt(change.value)} [${fmt(change.ci[0])},${fmt(change.ci[1])}]`)
    }
    for (const profile of Object.keys(PROFILES) as Profile[]) {
      const change = summarize(seeds.map((seed) => diff(profile, 1, seed, xgd) - diff(profile, 0.4, seed, xgd)))
      effects[`familiarity|${name}|${profile}`] = change
      console.log(`familiarity ${name} ${profile}: 1.0 与 0.4 的效应差 ${fmt(change.value)} [${fmt(change.ci[0])},${fmt(change.ci[1])}]`)
    }
  }
  const pctSpace = (r: Row) => r.a.passes > 0 ? 100 * r.a.spacePasses / r.a.passes : NaN
  for (const fam of [1, 0.4]) {
    const profileChange = summarize(seeds.map((seed) => block('counter-high:10', 'proposed', fam, seed, pctSpace)
      - block('counter-high:10', 'previous', fam, seed, pctSpace)))
    const familiarChange = summarize(seeds.map((seed) => block('counter-high:10', 'proposed', 1, seed, pctSpace)
      - block('counter-high:10', 'proposed', 0.4, seed, pctSpace)))
    effects[`spaceRateProfile|fam=${fam}`] = profileChange
    if (fam === 1) effects.spaceRateFamiliarity = familiarChange
    console.log(`space proportion fam=${fam}: 新旧差 ${fmt(profileChange.value)} pp [${fmt(profileChange.ci[0])},${fmt(profileChange.ci[1])}]`)
  }
  output.pairedContrasts = effects
  return output
}

async function main(): Promise<void> {
  const n = option('n', 4)
  const workers = Math.min(2, option('workers', Math.min(2, os.cpus().length)))
  const seed0 = option('seed0', 1)
  const outIndex = process.argv.indexOf('--out')
  const out = outIndex < 0 ? 'docs/tactics-ablation-results.json' : process.argv[outIndex + 1]
  if (!out || out.startsWith('--')) throw new Error('--out 需要文件路径')
  const seeds = Array.from({ length: n }, (_, i) => seed0 + i)
  const specs: Spec[] = []
  for (const c of CASES) for (const profile of Object.keys(PROFILES) as Profile[]) for (const fam of [1, 0.4]) for (const seed of seeds) for (const aHome of [true, false]) {
    specs.push({ id: c.id, profile, fam, seed, aHome })
  }
  const hash = hashFixture()
  const source = codeHash()
  console.log(`夹具 SHA-256 ${hash}，源码 SHA-256 ${source}，${specs.length} 场，${n} 个种子，${workers} worker`)
  const chunks: Spec[][] = Array.from({ length: workers }, () => [])
  specs.forEach((spec, index) => chunks[index % workers].push(spec))
  const started = Date.now()
  const rows = (await Promise.all(chunks.map((chunk, index) => chunk.length ? worker(chunk, index, hash) : Promise.resolve([])))).flat()
  console.log(`跑完 ${rows.length} 场（${((Date.now() - started) / 1000).toFixed(1)}s）`)
  const summary = report(rows, seeds)
  fs.writeFileSync(out, JSON.stringify({ fixture: { sha256: hash, squad: 67, exactMirror: true }, node: process.version,
    sourceHash: source, defaults: DEFAULT_PARAMS, profiles: PROFILES, cases: CASES, seeds, summary, rows }, null, 2))
  console.log(`\n原始数据：${out}`)
}

const child = process.argv.indexOf('--child')
if (child >= 0) {
  const job = JSON.parse(fs.readFileSync(process.argv[child + 1], 'utf8')) as Job
  if (hashFixture() !== job.fixtureHash) throw new Error('worker 夹具不一致')
  fs.writeFileSync(job.out, JSON.stringify(job.specs.map(run)))
} else void main().catch((error) => { console.error(error); process.exitCode = 1 })
