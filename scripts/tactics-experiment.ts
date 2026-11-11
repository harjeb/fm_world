/**
 * 战术风格 / 球队指令的实验脚本（docs/tactical-validation-report.md）。
 *
 *   npm run tactics:experiment                       风格对照，3 场景 × 11 套配置 × 10 种子
 *   npm run tactics:experiment -- --n 20 --workers 2 加大样本
 *   npm run tactics:experiment -- --individual       单项指令上下档对照
 *   npm run tactics:experiment -- --familiarity      熟练度 1 / 0.7 / 0.4 / 0 的退化曲线
 *
 * 口径按 docs/fm-tactical-styles-and-instructions.md 4.2 / 4.5：
 * 固定夹具（baselineTeams(1)，体力 100，无 autoSubs / chemistry）、D = 900、11 人制、越位开、
 * 每种子 4 场（试验 / 对照 × 主客）。埋点见 src/game/pes/metrics.ts，只观察不改行为。
 * 结果写 docs/tactics-experiment-results.json，控制台打印相对文档目标区间的判定。
 */
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { baselineTeams } from '../src/game/pes/baseline.ts'
import { PesGame } from '../src/game/pes/game.ts'
import type { TeamSample } from '../src/game/pes/metrics.ts'
import { attrRating, attrStorage } from '../src/game/scale.ts'
import {
  DEFAULT_PARAMS,
  NEUTRAL_INSTRUCTIONS,
  STYLE_LIST,
  cloneInstructions,
  type StyleId,
  type TacticalInstructionsV2,
  type TacticsParams,
} from '../src/game/pes/tactics.ts'
import type { AttrKey } from '../src/game/types.ts'
import type { MatchState, MatchTeamInput } from '../src/game/match/types.ts'

const self = fileURLToPath(import.meta.url)

/* ------------------------------ 类型 ------------------------------ */

type Scenario = 'mirror' | 'technical' | 'lowTech' | 'speed'
const SCENARIOS: Scenario[] = ['mirror', 'technical', 'speed']

type Config = { id: string; instructions: TacticalInstructionsV2; complexity: number }

type MatchSpec = {
  seed: number
  scenario: Scenario
  aConfig: string
  famA: number
  /** 对手风格（缺省 = 中性 B0） */
  bConfig?: string
  /** 对手熟练度（缺省 = 1） */
  famB?: number
  /** A 是否主场（每种子主客各一场） */
  aHome: boolean
}

type SideResult = {
  goals: number
  xg: number
  possession: number
  passes: number
  passesOk: number
  shots: number
  shotsOn: number
  fouls: number
  distance: number
  pl: number
  cf: number
  w: number
  dl: number
  hlrNum: number
  hlrDen: number
  efNum: number
  efDen: number
  pressU: number
  pressFrames: number
  shapeFrames: number
  pressAssignments: number
  lossFrames: number
  lossPressFrames: number
  decideSum: number
  decideCount: number
  stamina: number
  staminaCount: number
}

type MatchResult = { spec: MatchSpec; a: SideResult; b: SideResult }

/* ------------------------------ 夹具 ------------------------------ */

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'number') return JSON.stringify(Number.isFinite(value) ? value : 0)
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).filter((k) => (value as Record<string, unknown>)[k] !== undefined).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** 文档 4.5 第 2 条的输入夹具；返回规范 JSON 的字节数与 SHA-256，便于和设计文档对照。 */
export function fixtureHash(): { bytes: number; sha256: string } {
  const { home, away } = baseFixture()
  const text = canonical({ home, away })
  return { bytes: Buffer.byteLength(text, 'utf8'), sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex') }
}

function baseFixture(): { home: MatchTeamInput; away: MatchTeamInput } {
  const { home, away } = baselineTeams(1)
  for (const team of [home, away]) {
    delete team.autoSubs
    delete team.chemistry
    for (const starter of team.starters) starter.player.condition = 100
    for (const player of team.bench) player.condition = 100
  }
  return { home, away }
}

const ATTR_SETS = {
  technical: { plus: ['passing', 'firstTouch', 'vision', 'decisions'], minus: ['tackling', 'strength', 'heading', 'defPos'] },
  speed: { plus: ['speed', 'acceleration', 'offBall', 'agility'], minus: ['passing', 'vision', 'teamwork', 'endurance'] },
} as const

/** 只改非门将的属性：+8 / −8 个比赛评分点，按文档 4.5 第 3 条用 attrRating / attrStorage 换算。 */
function shiftAttributes(team: MatchTeamInput, set: keyof typeof ATTR_SETS, sign: 1 | -1): void {
  const spec = ATTR_SETS[set]
  const shift = (player: MatchTeamInput['starters'][number]['player'], key: AttrKey, delta: number) => {
    const gk = player.positions.GK > 0
    const rating = attrRating(key, player.attrs[key], gk)
    const next = Math.max(1, Math.min(100, rating + delta))
    player.attrs[key] = attrStorage(key, next, gk)
  }
  for (const starter of team.starters) {
    if (starter.player.positions.GK > 0) continue
    for (const key of spec.plus) shift(starter.player, key, 8 * sign)
    for (const key of spec.minus) shift(starter.player, key, -8 * sign)
  }
}

function teamFor(scenario: Scenario, side: 'a' | 'b', config: Config, fam: number, base: { home: MatchTeamInput; away: MatchTeamInput }): MatchTeamInput {
  const team = structuredClone(side === 'a' ? base.home : base.away)
  team.familiarity = fam
  team.instructions = cloneInstructions(config.instructions)
  if (scenario === 'technical' && side === 'a') shiftAttributes(team, 'technical', 1)
  if (scenario === 'lowTech' && side === 'a') shiftAttributes(team, 'technical', -1)
  if (scenario === 'speed' && side === 'b') {
    shiftAttributes(team, 'speed', 1)
    // 速度型对手固定使用「快速防反」，见文档 4.5 第 3 条。
    team.instructions = cloneInstructions(STYLE_LIST.find((s) => s.id === 'directCounter')!.instructions)
  }
  return team
}

/** 一场比赛；A 在 teamIndex 0（主场）或 1（客场）。 */
function runMatch(spec: MatchSpec, params: Partial<TacticsParams>): MatchResult {
  const base = baseFixture()
  const configs = ALL_CONFIGS
  const aConfig = configs[spec.aConfig]
  const bConfig = configs[spec.bConfig ?? 'blank']
  const famB = spec.famB ?? 1
  const home = spec.aHome ? teamFor(spec.scenario, 'a', aConfig, spec.famA, base) : teamFor(spec.scenario, 'b', bConfig, famB, base)
  const away = spec.aHome ? teamFor(spec.scenario, 'b', bConfig, famB, base) : teamFor(spec.scenario, 'a', aConfig, spec.famA, base)
  const game = new PesGame({
    seed: spec.seed, home, away, durationSeconds: 900, offside: true, noInjuries: true, now: 0,
    metrics: true, tacticsParams: params,
  })
  const state = game.run()
  const metrics = game.match.metrics!
  const index = spec.aHome ? 0 : 1
  return {
    spec,
    a: sideResult(metrics.teams[index], state, spec.aHome ? 'home' : 'away'),
    b: sideResult(metrics.teams[1 - index], state, spec.aHome ? 'away' : 'home'),
  }
}

function sideResult(sample: TeamSample, state: MatchState, side: 'home' | 'away'): SideResult {
  const stats = state.stats[side]
  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0)
  const startRefs = Object.keys(sample.staminaEnd)
  const stamina = startRefs.map((ref) => sample.staminaEnd[ref]).filter(() => true)
  const staminaOutfield = startRefs.filter((ref) => sample.onPitchAtEnd[ref] && sample.isOutfield[ref]).map((ref) => sample.staminaEnd[ref])
  void stamina
  return {
    goals: stats.goals,
    xg: stats.xg,
    possession: stats.possession,
    passes: stats.passes,
    passesOk: stats.passesCompleted,
    shots: stats.shots,
    shotsOn: stats.shotsOnTarget,
    fouls: stats.fouls,
    distance: stats.distance,
    pl: mean(sample.passDistance),
    cf: sample.openPasses ? (sample.centralPasses / sample.openPasses) * 100 : Number.NaN,
    w: mean(sample.width),
    dl: mean(sample.defLine),
    hlrNum: sample.highTurnovers,
    hlrDen: sample.oppPossessionSeconds,
    efNum: sample.forwardTurnovers,
    efDen: sample.turnoverWindows,
    pressU: sample.pressFrames ? sample.pressU / sample.pressFrames : Number.NaN,
    pressFrames: sample.pressFrames,
    shapeFrames: sample.shapeFrames,
    pressAssignments: sample.pressAssignments,
    lossFrames: sample.lossFrames,
    lossPressFrames: sample.lossPressFrames,
    decideSum: sample.decideIntervalSum,
    decideCount: sample.decideCount,
    stamina: staminaOutfield.length ? staminaOutfield.reduce((a, b) => a + b, 0) / staminaOutfield.length : Number.NaN,
    staminaCount: staminaOutfield.length,
  }
}

/* ------------------------------ 配置 ------------------------------ */

const configFrom = (id: string, instructions: TacticalInstructionsV2, complexity = 1): Config => ({ id, instructions, complexity })

const ALL_CONFIGS: Record<string, Config> = {
  blank: configFrom('blank', NEUTRAL_INSTRUCTIONS, 1),
  ...Object.fromEntries(STYLE_LIST.filter((s) => s.id !== 'blank').map((s) => [s.id, configFrom(s.id, s.instructions, s.complexity)])),
}

type NamedStyle = Exclude<StyleId, 'blank'>
const STYLE_IDS = STYLE_LIST.map((s) => s.id).filter((id): id is NamedStyle => id !== 'blank')

/** 单项指令：只改一项，其余中性。 */
function individualConfigs(): { id: string; key: string; level: string; config: Config; metric: string }[] {
  const make = (key: string, level: string, mutate: (value: TacticalInstructionsV2) => void, metric: string) => {
    const instructions = cloneInstructions(NEUTRAL_INSTRUCTIONS)
    mutate(instructions)
    return { id: `${key}:${level}`, key, level, config: configFrom(`${key}:${level}`, instructions), metric }
  }
  return [
    make('passing', 'short', (v) => { v.possession.passing = 'short' }, 'PL-'),
    make('passing', 'direct', (v) => { v.possession.passing = 'direct' }, 'PL+'),
    make('focus', 'middle', (v) => { v.possession.focus = 'middle' }, 'CF+'),
    make('focus', 'wing', (v) => { v.possession.focus = 'wing' }, 'CF-'),
    make('width', 'narrow', (v) => { v.possession.width = 'narrow' }, 'W-'),
    make('width', 'wide', (v) => { v.possession.width = 'wide' }, 'W+'),
    make('tempo', 'slow', (v) => { v.possession.tempo = 'slow' }, 'tempo'),
    make('tempo', 'fast', (v) => { v.possession.tempo = 'fast' }, 'tempo'),
    make('line', 'low', (v) => { v.defense.line = 'low' }, 'DL-'),
    make('line', 'high', (v) => { v.defense.line = 'high' }, 'DL+'),
    make('engagement', 'low', (v) => { v.defense.engagement = 'low' }, 'pressU'),
    make('engagement', 'high', (v) => { v.defense.engagement = 'high' }, 'pressU'),
    make('intensity', 'low', (v) => { v.defense.intensity = 'low' }, 'pressN'),
    make('intensity', 'high', (v) => { v.defense.intensity = 'high' }, 'pressN'),
    make('onGain', 'hold', (v) => { v.transition.onGain = 'hold' }, 'EF-'),
    make('onGain', 'counter', (v) => { v.transition.onGain = 'counter' }, 'EF+'),
    make('onLoss', 'regroup', (v) => { v.transition.onLoss = 'regroup' }, 'pressLoss'),
    make('onLoss', 'counterpress', (v) => { v.transition.onLoss = 'counterpress' }, 'pressLoss'),
  ]
}

/* ------------------------------ 参数 ------------------------------ */

function option(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`)
  if (index < 0) return fallback
  const value = Number(process.argv[index + 1])
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} 需要一个正数`)
  return value
}

const MODE = process.argv.includes('--familiarity') ? 'familiarity'
  : process.argv.includes('--individual') ? 'individual'
    : process.argv.includes('--matrix') ? 'matrix'
      : process.argv.includes('--matchup') ? 'matchup' : 'styles'
const SEEDS = option('n', MODE === 'styles' ? 10 : 8)
const SEED0 = option('seed0', 1)
const WORKERS = Math.min(2, Math.max(1, option('workers', Math.min(2, os.cpus().length))))
function paramsOption(): Partial<TacticsParams> {
  const index = process.argv.indexOf('--params')
  if (index < 0) return {}
  try {
    return JSON.parse(process.argv[index + 1]) as Partial<TacticsParams>
  } catch (error) {
    throw new Error(`--params 必须是 JSON：${String(error)}`)
  }
}
const PARAMS: Partial<TacticsParams> = paramsOption()
/** 只跑某几类单项（`--only tempo --only intensity`）。 */
const ONLY = process.argv.flatMap((arg, index) => (arg === '--only' ? [process.argv[index + 1]] : []))
const CACHE_VERSION = 4
// 单项配置在模块加载时注册：子进程也要能查到这些 id。
const selectedSingles = () => individualConfigs().filter((single) => !ONLY.length || ONLY.includes(single.key))
if (MODE === 'individual') for (const single of selectedSingles()) ALL_CONFIGS[single.id] = single.config

/* ------------------------------ 子进程 ------------------------------ */

type Job = { mode: string; specs: MatchSpec[]; params: Partial<TacticsParams>; out: string }

const childIndex = process.argv.indexOf('--child')
if (childIndex >= 0) {
  const job = JSON.parse(fs.readFileSync(process.argv[childIndex + 1], 'utf8')) as Job
  // 单项模式的配置 id 由父进程注册；子进程没有 --individual 参数，按 job.mode 补上。
  if (job.mode === 'individual') for (const single of selectedSingles()) ALL_CONFIGS[single.id] = single.config
  const rows = job.specs.map((spec) => runMatch(spec, job.params))
  // 写文件而不是 stdout：几千场的结果超过管道缓冲，process.exit 会截断最后一段。
  fs.writeFileSync(job.out, JSON.stringify(rows))
  process.exit(0)
}

function runJob(specs: MatchSpec[], id: number): Promise<MatchResult[]> {
  const tmp = path.join(os.tmpdir(), `tactics-${process.pid}-${id}.json`)
  const out = path.join(os.tmpdir(), `tactics-${process.pid}-${id}-out.json`)
  fs.writeFileSync(tmp, JSON.stringify({ mode: MODE, specs, params: PARAMS, out } satisfies Job))
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, self, '--child', tmp], { stdio: ['ignore', 'ignore', 'inherit'] })
    child.on('error', reject)
    child.on('close', (code) => {
      fs.rmSync(tmp, { force: true })
      if (code !== 0) return reject(new Error(`子进程退出码 ${code}`))
      try {
        resolve(JSON.parse(fs.readFileSync(out, 'utf8')) as MatchResult[])
      } catch (error) {
        reject(error)
      } finally {
        fs.rmSync(out, { force: true })
      }
    })
  })
}

/* ------------------------------ 调度 ------------------------------ */

const results = new Map<string, MatchResult>()
const keyOf = (spec: MatchSpec) => `${spec.scenario}|${spec.aConfig}|${spec.famA}|${spec.bConfig ?? 'blank'}|${spec.famB ?? 1}|${spec.seed}|${spec.aHome}`
const CACHE = path.join(os.tmpdir(), 'fm-tactics-cache.json')
const paramsKey = JSON.stringify({ version: CACHE_VERSION, params: { ...DEFAULT_PARAMS, ...PARAMS } })

function loadCache(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE, 'utf8')) as { params: string; rows: Record<string, MatchResult> }
    if (raw.params !== paramsKey) return
    for (const [key, row] of Object.entries(raw.rows)) {
      // 旧缓存键是 scenario|aConfig|famA|seed|aHome；新键在中间加了对手风格和对手熟练度。
      const parts = key.split('|')
      results.set(parts.length === 5 ? `${parts[0]}|${parts[1]}|${parts[2]}|blank|1|${parts[3]}|${parts[4]}` : key, row)
    }
  } catch { /* 没有缓存就重跑 */ }
}

function saveCache(): void {
  const rows: Record<string, MatchResult> = {}
  for (const [key, row] of results) if (row) rows[key] = row
  fs.writeFileSync(CACHE, JSON.stringify({ params: paramsKey, rows }))
}

function need(specs: MatchSpec[]): void {
  for (const spec of specs) if (!results.has(keyOf(spec))) results.set(keyOf(spec), null as unknown as MatchResult)
}

async function execute(specs: MatchSpec[]): Promise<void> {
  const pending = specs.filter((spec) => !(results.get(keyOf(spec)) as MatchResult | undefined))
  const unique = [...new Map(pending.map((spec) => [keyOf(spec), spec])).values()]
  if (!unique.length) return
  const chunks: MatchSpec[][] = Array.from({ length: WORKERS }, () => [])
  unique.forEach((spec, index) => chunks[index % WORKERS].push(spec))
  const started = Date.now()
  const outputs = await Promise.all(chunks.map((chunk, index) => (chunk.length ? runJob(chunk, index) : Promise.resolve([]))))
  for (const row of outputs.flat()) results.set(keyOf(row.spec), row)
  saveCache()
  const done = unique.length
  process.stderr.write(`  跑完 ${done} 场（${((Date.now() - started) / 1000).toFixed(0)}s）\n`)
}

/* ------------------------------ 统计 ------------------------------ */

const mean = (values: number[]): number => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : Number.NaN)
const sd = (values: number[]): number => {
  if (values.length < 2) return Number.NaN
  const m = mean(values)
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1))
}

function bootstrapCi(values: number[], rounds = 2000): [number, number] {
  if (values.length < 2) return [Number.NaN, Number.NaN]
  const rng = (() => {
    let state = 0x9e3779b9
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0
      return state / 0x100000000
    }
  })()
  const means: number[] = []
  for (let i = 0; i < rounds; i++) {
    let sum = 0
    for (let j = 0; j < values.length; j++) sum += values[Math.floor(rng() * values.length)]
    means.push(sum / values.length)
  }
  means.sort((a, b) => a - b)
  return [means[Math.floor(rounds * 0.025)], means[Math.floor(rounds * 0.975) - 1]]
}

type Block = {
  seed: number
  scenario: Scenario
  pl: number
  cf: number
  w: number
  dl: number
  hlr: number
  ef: number
  xgd: number
  xgf: number
  xga: number
  gd: number
  possession: number
  pressU: number
  pressN: number
  pressRate: number
  lossPressRate: number
  decideInterval: number
  stamina: number
  passAcc: number
  shots: number
  distance: number
}

/** 两场（主客）合成一个种子块：先按场算均值 / 比率，再合成；xGD / 净胜球用每场 A 减对手。 */
function blockOf(home: MatchResult, away: MatchResult, seed: number, scenario: Scenario): Block {
  const a = home.a
  const c = away.a
  const pl = mean([a.pl, c.pl])
  const cf = (a.cf + c.cf) / 2
  const w = mean([a.w, c.w])
  const dl = mean([a.dl, c.dl])
  const hlr = (a.hlrNum + c.hlrNum) / Math.max(1e-9, (a.hlrDen + c.hlrDen) / 10) * 10
  const ef = (a.efNum + c.efNum) / Math.max(1, a.efDen + c.efDen) * 100
  const xgd = mean([home.a.xg - home.b.xg, away.a.xg - away.b.xg])
  const gd = mean([home.a.goals - home.b.goals, away.a.goals - away.b.goals])
  const passAcc = (a.passesOk + c.passesOk) / Math.max(1, a.passes + c.passes) * 100
  return {
    seed, scenario, pl, cf, w, dl, hlr, ef, xgd, gd,
    xgf: mean([a.xg, c.xg]),
    xga: mean([home.b.xg, away.b.xg]),
    possession: mean([a.possession, c.possession]),
    pressU: mean([a.pressU, c.pressU]),
    pressN: (a.pressAssignments + c.pressAssignments) / Math.max(1, a.pressFrames + c.pressFrames),
    pressRate: ((a.pressFrames + c.pressFrames) / Math.max(1, a.shapeFrames + c.shapeFrames)) * 100,
    lossPressRate: ((a.lossPressFrames + c.lossPressFrames) / Math.max(1, a.lossFrames + c.lossFrames)) * 100,
    decideInterval: (a.decideSum + c.decideSum) / Math.max(1, a.decideCount + c.decideCount),
    stamina: mean([a.stamina, c.stamina]),
    passAcc,
    shots: mean([a.shots, c.shots]),
    distance: mean([a.distance, c.distance]),
  }
}

function pairBlocks(config: string, scenario: Scenario, seeds: number[], fam = 1): Block[] {
  return seeds.map((seed) => {
    const home = results.get(`${scenario}|${config}|${fam}|${seed}|true`)
    const away = results.get(`${scenario}|${config}|${fam}|${seed}|false`)
    if (!home || !away) throw new Error(`缺少结果 ${scenario}/${config}/${fam}/${seed}`)
    return blockOf(home, away, seed, scenario)
  })
}

type Effect = { metric: string; value: number; ci: [number, number]; n: number }

function effect(name: string, test: Block[], control: Block[], kind: 'ratioPct' | 'pp' | 'abs'): Effect {
  const diffs: number[] = []
  for (let i = 0; i < test.length; i++) {
    const t = test[i]
    const c = control.find((item) => item.seed === t.seed && item.scenario === t.scenario)!
    const key = name as keyof Block
    const tv = t[key] as number
    const cv = c[key] as number
    if (!Number.isFinite(tv) || !Number.isFinite(cv)) continue
    diffs.push(kind === 'ratioPct' ? (tv / cv - 1) * 100 : kind === 'pp' ? tv - cv : tv - cv)
  }
  return { metric: name, value: mean(diffs), ci: bootstrapCi(diffs), n: diffs.length }
}

/* ------------------------------ 报告 ------------------------------ */

/** 文档 4.3 的行为目标区间（最小有意义差异），用于打印判定，不作为硬门槛。 */
const TARGET: Record<Exclude<StyleId, 'blank'>, { metric: string; kind: 'ratioPct' | 'pp' | 'abs'; range: [number, number]; min: number }> = {
  control: { metric: 'pl', kind: 'ratioPct', range: [-18, -6], min: 3 },
  highPress: { metric: 'hlr', kind: 'abs', range: [0.5, 3.0], min: 0.25 },
  tikiTaka: { metric: 'ef', kind: 'pp', range: [-10, -3], min: 2 },
  verticalTiki: { metric: 'cf', kind: 'pp', range: [6, 18], min: 3 },
  wingPlay: { metric: 'w', kind: 'abs', range: [3, 8], min: 1.5 },
  longBall: { metric: 'pl', kind: 'ratioPct', range: [8, 25], min: 4 },
  fluidCounter: { metric: 'pl', kind: 'ratioPct', range: [-25, -10], min: 4 },
  directCounter: { metric: 'ef', kind: 'pp', range: [4, 15], min: 2 },
  catenaccio: { metric: 'dl', kind: 'abs', range: [-10, -3], min: 1.5 },
  parkBus: { metric: 'ef', kind: 'pp', range: [-12, -3], min: 2 },
}

function verdict(value: number, ci: [number, number], target: { range: [number, number]; min: number }): string {
  const lo = Math.min(target.range[0], target.range[1])
  const hi = Math.max(target.range[0], target.range[1])
  if (!Number.isFinite(ci[0]) || !Number.isFinite(ci[1])) return '不确定'
  if (ci[1] < lo || ci[0] > hi) {
    const sign = (lo + hi) / 2
    if (ci[1] < 0 && sign > 0) return '方向相反'
    if (ci[0] > 0 && sign < 0) return '方向相反'
    return Math.abs(value) >= target.min ? '方向对/幅度超区间' : '方向对/幅度不足'
  }
  return Math.abs(value) >= target.min ? '区间内' : '不确定'
}

function fmt(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return 'n/a'
  return value.toFixed(digits)
}

async function main(): Promise<void> {
  loadCache()
  const seeds = Array.from({ length: SEEDS }, (_, i) => SEED0 + i)
  const hash = fixtureHash()
  console.log(`夹具：${hash.bytes} 字节，SHA-256 ${hash.sha256}`)
  console.log(`模式 ${MODE}，种子 ${SEEDS}，场景 ${SCENARIOS.join(' / ')}，参数 ${JSON.stringify({ ...DEFAULT_PARAMS, ...PARAMS })}`)

  const output: { fixture: unknown; mode: string; seeds: number[]; params: unknown; results: Record<string, any> } = { fixture: hash, mode: MODE, seeds, params: { ...DEFAULT_PARAMS, ...PARAMS }, results: {} }

  if (MODE === 'styles') {
    const specs: MatchSpec[] = []
    for (const scenario of SCENARIOS) {
      for (const id of ['blank', ...STYLE_IDS]) {
        for (const seed of seeds) {
          specs.push({ seed, scenario, aConfig: id, famA: 1, aHome: true })
          specs.push({ seed, scenario, aConfig: id, famA: 1, aHome: false })
        }
      }
    }
    need(specs)
    await execute(specs)

    console.log('\n风格行为指标（相对 B0，主客平均，均值 [95% CI]）')
    for (const id of STYLE_IDS) {
      const target = TARGET[id]
      const rows: Record<string, Effect> = {}
      for (const scenario of SCENARIOS) {
        const test = pairBlocks(id, scenario, seeds)
        const control = pairBlocks('blank', scenario, seeds)
        rows[scenario] = effect(target.metric, test, control, target.kind)
      }
      const overall: Effect = {
        metric: target.metric,
        value: mean(Object.values(rows).map((r) => r.value)),
        ci: bootstrapCi(Object.values(rows).map((r) => r.value)),
        n: rows.mirror.n,
      }
      const detail = SCENARIOS.map((scenario) => `${scenario} ${fmt(rows[scenario].value)}`).join(' | ')
      console.log(`${id.padEnd(14)} ${target.metric.padEnd(3)} 总体 ${fmt(overall.value).padStart(7)} [${fmt(overall.ci[0])}, ${fmt(overall.ci[1])}] ${verdict(overall.value, overall.ci, target)}  (${detail})`)
      output.results[id] = { target, overall, byScenario: rows }
    }
    // 结果与代价（只报告，不判通过）
    console.log('\n结果与代价（相对 B0 的差：xGD / 净胜球 / 控球 pp / 传球成功率 pp / 跑动米 / 期末体力）')
    for (const id of STYLE_IDS) {
      const parts: string[] = []
      for (const scenario of SCENARIOS) {
        const test = pairBlocks(id, scenario, seeds)
        const control = pairBlocks('blank', scenario, seeds)
        parts.push(`${scenario}: xGD ${fmt(effect('xgd', test, control, 'abs').value)} gd ${fmt(effect('gd', test, control, 'abs').value)} pos ${fmt(effect('possession', test, control, 'pp').value)} pass ${fmt(effect('passAcc', test, control, 'pp').value)} dist ${fmt(effect('distance', test, control, 'abs').value, 0)}m stam ${fmt(effect('stamina', test, control, 'abs').value)}`)
      }
      console.log(`${id}\n  ${parts.join('\n  ')}`)
      const byScenario: Record<string, unknown> = {}
      for (const scenario of SCENARIOS) {
        const test = pairBlocks(id, scenario, seeds)
        const control = pairBlocks('blank', scenario, seeds)
        byScenario[scenario] = {
          xgd: effect('xgd', test, control, 'abs'), xgf: effect('xgf', test, control, 'abs'),
          xga: effect('xga', test, control, 'abs'), gd: effect('gd', test, control, 'abs'),
          possession: effect('possession', test, control, 'pp'), passAcc: effect('passAcc', test, control, 'pp'),
          distance: effect('distance', test, control, 'abs'), stamina: effect('stamina', test, control, 'abs'),
          shots: effect('shots', test, control, 'abs'),
          pl: effect('pl', test, control, 'ratioPct'), cf: effect('cf', test, control, 'pp'),
          w: effect('w', test, control, 'abs'), dl: effect('dl', test, control, 'abs'),
          hlr: effect('hlr', test, control, 'abs'), ef: effect('ef', test, control, 'pp'),
          pressN: effect('pressN', test, control, 'abs'), pressU: effect('pressU', test, control, 'abs'),
        }
      }
      output.results[id].outcomes = byScenario
    }
    fs.writeFileSync(path.join('docs', 'tactics-experiment-results.json'), JSON.stringify(output, null, 2))
    return
  }

  if (MODE === 'individual') {
    const singles = selectedSingles()
    const specs: MatchSpec[] = []
    for (const scenario of SCENARIOS) {
      for (const id of ['blank', ...singles.map((s) => s.id)]) {
        for (const seed of seeds) {
          specs.push({ seed, scenario, aConfig: id, famA: 1, aHome: true })
          specs.push({ seed, scenario, aConfig: id, famA: 1, aHome: false })
        }
      }
    }
    need(specs)
    await execute(specs)
    const metricKey: Record<string, keyof Block> = {
      'PL-': 'pl', 'PL+': 'pl', 'CF+': 'cf', 'CF-': 'cf', 'W-': 'w', 'W+': 'w', 'DL-': 'dl', 'DL+': 'dl',
      'EF-': 'ef', 'EF+': 'ef', tempo: 'decideInterval', pressU: 'pressU', pressN: 'pressRate', pressLoss: 'lossPressRate',
    }
    console.log('\n单项指令（相对 B0，主客平均）')
    for (const single of singles) {
      const key = metricKey[single.metric]
      const kind = single.metric === 'PL-' || single.metric === 'PL+' ? 'ratioPct' : 'pp'
      const parts: string[] = []
      const byScenario: Record<string, unknown> = {}
      for (const scenario of SCENARIOS) {
        const test = pairBlocks(single.id, scenario, seeds)
        const control = pairBlocks('blank', scenario, seeds)
        const e = effect(String(key), test, control, kind)
        byScenario[scenario] = { [key]: e, pressRate: effect('pressRate', test, control, 'abs'), pressU: effect('pressU', test, control, 'abs'), lossPressRate: effect('lossPressRate', test, control, 'abs') }
        parts.push(`${scenario} ${fmt(e.value)} [${fmt(e.ci[0])}, ${fmt(e.ci[1])}]`)
      }
      console.log(`${single.id.padEnd(22)} ${String(key).padEnd(7)} ${parts.join(' | ')}`)
      output.results[single.id] = { metric: key, byScenario }
    }
    fs.writeFileSync(path.join('docs', 'tactics-experiment-individual.json'), JSON.stringify(output, null, 2))
    return
  }

  if (MODE === 'matrix') {
    // 风格对位矩阵：每个有序对（A 攻 / B 守）各跑主客两场，只看 mirror 场景（同一批球员）。
    const styles = STYLE_IDS
    const specs: MatchSpec[] = []
    // 只跑无序对：同一有序对的「A 主 + A 客」已经包含两个主客场，反向对位就是它的相反数。
    for (let i = 0; i < styles.length; i++) for (let j = i + 1; j < styles.length; j++) {
      for (const seed of seeds) {
        specs.push({ seed, scenario: 'mirror', aConfig: styles[i], bConfig: styles[j], famA: 1, famB: 1, aHome: true })
        specs.push({ seed, scenario: 'mirror', aConfig: styles[i], bConfig: styles[j], famA: 1, famB: 1, aHome: false })
      }
    }
    // 每个风格对中性 B0 的强度（同一批种子），用于把「整体强弱」从「克制」里拆出来。
    for (const style of styles) for (const seed of seeds) {
      specs.push({ seed, scenario: 'mirror', aConfig: style, bConfig: 'blank', famA: 1, famB: 1, aHome: true })
      specs.push({ seed, scenario: 'mirror', aConfig: style, bConfig: 'blank', famA: 1, famB: 1, aHome: false })
    }
    need(specs)
    await execute(specs)

    const block = (a: string, b: string): Block[] => seeds.map((seed) => {
      const home = results.get(`mirror|${a}|1|${b}|1|${seed}|true`)
      const away = results.get(`mirror|${a}|1|${b}|1|${seed}|false`)
      if (!home || !away) throw new Error(`缺少结果 ${a} vs ${b} / ${seed}`)
      return blockOf(home, away, seed, 'mirror')
    })

    const cell = (a: NamedStyle, b: NamedStyle) => {
      const forward = styles.indexOf(a) < styles.indexOf(b)
      const blocks = block(forward ? a : b, forward ? b : a)
      const sign = forward ? 1 : -1
      const values = blocks.map((item) => item.xgd * sign)
      const value = mean(values)
      const ci = bootstrapCi(values)
      const wins = mean(blocks.map((item) => (item.gd * sign > 0 ? 1 : item.gd * sign < 0 ? 0 : 0.5)))
      return { xgd: value, ci, winRate: wins * 100, xgf: mean(blocks.map((i) => (sign > 0 ? i.xgf : i.xga))), xga: mean(blocks.map((i) => (sign > 0 ? i.xga : i.xgf))) }
    }

    const short: Record<string, string> = {
      control: '控制', highPress: '高压', tikiTaka: '密短', verticalTiki: '垂密',
      wingPlay: '双翼', longBall: '长传', fluidCounter: '灵反', directCounter: '快反',
      catenaccio: '链式', parkBus: '摆巴',
    }
    console.log('\n风格对位矩阵：行 = A，列 = B，单元格 = A − B 的 xGD（主客平均，* = 95% 区间不含 0）')
    console.log(['A\\B'.padEnd(6), ...styles.map((b) => short[b].padEnd(6))].join(' '))
    const out: Record<string, unknown> = {}
    for (const a of styles) {
      const row: string[] = []
      const rowOut: Record<string, unknown> = {}
      for (const b of styles) {
        if (a === b) { row.push('—'.padEnd(6)); continue }
        const r = cell(a, b)
        const mark = r.ci[0] > 0 || r.ci[1] < 0 ? '*' : ' '
        row.push(`${r.xgd >= 0 ? '+' : ''}${r.xgd.toFixed(2)}${mark}`.padEnd(6))
        rowOut[b] = r
      }
      console.log([short[a].padEnd(6), ...row].join(' '))
      out[a] = rowOut
    }
    // 与中性的关系：先算「自身强度」（相对 B0 的 xGD），再看对位是否偏离强度差。
    const neutral = (style: NamedStyle): Block[] => seeds.map((seed) => {
      const home = results.get(`mirror|${style}|1|blank|1|${seed}|true`)
      const away = results.get(`mirror|${style}|1|blank|1|${seed}|false`)
      if (!home || !away) throw new Error(`缺少中性对照 ${style} / ${seed}`)
      return blockOf(home, away, seed, 'mirror')
    })
    const strength = (style: NamedStyle) => {
      const values = neutral(style).map((item) => item.xgd)
      return { xgd: mean(values), ci: bootstrapCi(values) }
    }
    console.log('\n相对中性的强度（mirror，xGD vs B0）')
    for (const a of styles) {
      const st = strength(a)
      console.log(`${short[a]}  ${st.xgd >= 0 ? '+' : ''}${st.xgd.toFixed(2)}  [${st.ci[0].toFixed(2)}, ${st.ci[1].toFixed(2)}]`)
      ;(out as Record<string, unknown>)[`${a}:neutral`] = st
    }

    // 交互项 = 实测对位 − (A 的强度 − B 的强度)：> 0 才是「克制」，≈ 0 说明只是整体强弱。
    const interaction = (a: NamedStyle, b: NamedStyle) => {
      const forward = styles.indexOf(a) < styles.indexOf(b)
      const first = forward ? a : b
      const second = forward ? b : a
      const sign = forward ? 1 : -1
      const blocks = block(first, second)
      const na = neutral(first)
      const nb = neutral(second)
      const values = blocks.map((item, index) => (item.xgd - (na[index].xgd - nb[index].xgd)) * sign)
      return { value: mean(values), ci: bootstrapCi(values) }
    }
    console.log('\n交互项矩阵：行 A，列 B，`实测 A−B 的 xGD − (A 对中性 − B 对中性)`；* = 区间不含 0')
    console.log(['A\\B'.padEnd(6), ...styles.map((b) => short[b].padEnd(6))].join(' '))
    const interactionOut: Record<string, unknown> = {}
    for (const a of styles) {
      const row: string[] = []
      const rowOut: Record<string, unknown> = {}
      for (const b of styles) {
        if (a === b) { row.push('—'.padEnd(6)); continue }
        const r = interaction(a, b)
        const mark = r.ci[0] > 0 || r.ci[1] < 0 ? '*' : ' '
        row.push(`${r.value >= 0 ? '+' : ''}${r.value.toFixed(2)}${mark}`.padEnd(6))
        rowOut[b] = r
      }
      console.log([short[a].padEnd(6), ...row].join(' '))
      interactionOut[a] = rowOut
    }
    ;(out as Record<string, unknown>).interaction = interactionOut

    // 每个风格最好 / 最差的对手
    console.log('\n每个风格的最佳 / 最差对位（xGD）')
    for (const a of styles) {
      const cells = styles.filter((b) => b !== a).map((b) => ({ b, ...cell(a, b) }))
      cells.sort((x, y) => y.xgd - x.xgd)
      const best = cells[0]
      const worst = cells[cells.length - 1]
      console.log(`${short[a]}  最佳 vs ${short[best.b]} ${best.xgd.toFixed(2)} (${best.ci[0].toFixed(2)}, ${best.ci[1].toFixed(2)}) | 最差 vs ${short[worst.b]} ${worst.xgd.toFixed(2)} (${worst.ci[0].toFixed(2)}, ${worst.ci[1].toFixed(2)})`)
      out[`${a}:best`] = { vs: best.b, xgd: best.xgd, ci: best.ci }
      out[`${a}:worst`] = { vs: worst.b, xgd: worst.xgd, ci: worst.ci }
    }
    output.results = out
    fs.writeFileSync(path.join('docs', 'tactics-experiment-matrix.json'), JSON.stringify(output, null, 2))
    return
  }

  if (MODE === 'matchup') {
    // 熟练度绑定：同一对位里分别改 A / B 的熟练度，看克制是否还在。
    const pairs: [NamedStyle, NamedStyle][] = [
      ['directCounter', 'highPress'], ['directCounter', 'control'], ['longBall', 'highPress'],
      ['fluidCounter', 'highPress'], ['catenaccio', 'control'], ['parkBus', 'control'],
      ['wingPlay', 'catenaccio'], ['tikiTaka', 'directCounter'],
    ]
    const levels = [1, 0.7, 0.4]
    const specs: MatchSpec[] = []
    for (const [a, b] of pairs) for (const famA of levels) for (const famB of levels) for (const seed of seeds) {
      specs.push({ seed, scenario: 'mirror', aConfig: a, bConfig: b, famA, famB, aHome: true })
      specs.push({ seed, scenario: 'mirror', aConfig: a, bConfig: b, famA, famB, aHome: false })
    }
    need(specs)
    await execute(specs)
    const short: Record<string, string> = {
      control: '控制', highPress: '高压', tikiTaka: '密短', verticalTiki: '垂密',
      wingPlay: '双翼', longBall: '长传', fluidCounter: '灵反', directCounter: '快反',
      catenaccio: '链式', parkBus: '摆巴',
    }
    const out: Record<string, unknown> = {}
    console.log('\n熟练度 × 对位：A − B 的 xGD（A 熟练度 → / B 熟练度 ↓）')
    for (const [a, b] of pairs) {
      console.log(`\n${short[a]} vs ${short[b]}`)
      console.log(['A\\B'.padEnd(6), ...levels.map((fam) => `B ${fam.toFixed(1)}`.padEnd(6))].join(' '))
      const table: Record<string, unknown> = {}
      for (const famA of levels) {
        const row: string[] = []
        const rowOut: Record<string, unknown> = {}
        for (const famB of levels) {
          const blocks = seeds.map((seed) => {
            const home = results.get(`mirror|${a}|${famA}|${b}|${famB}|${seed}|true`)
            const away = results.get(`mirror|${a}|${famA}|${b}|${famB}|${seed}|false`)
            if (!home || !away) throw new Error(`缺少结果 ${a} vs ${b} / ${famA} / ${famB} / ${seed}`)
            return blockOf(home, away, seed, 'mirror')
          })
          const value = mean(blocks.map((item) => item.xgd))
          const ci = bootstrapCi(blocks.map((item) => item.xgd))
          const ef = mean(blocks.map((item) => item.ef))
          const hlr = (blocks.reduce((sum, item) => sum + item.hlr, 0)) / blocks.length
          rowOut[famB] = { xgd: value, ci, ef, hlr }
          row.push(`${value >= 0 ? '+' : ''}${value.toFixed(2)}`.padEnd(6))
        }
        console.log([`A ${famA.toFixed(1)}`.padEnd(6), ...row].join(' '))
        table[famA] = rowOut
      }
      out[`${a}|${b}`] = table
    }
    output.results = out
    fs.writeFileSync(path.join('docs', 'tactics-experiment-matchup.json'), JSON.stringify(output, null, 2))
    return
  }

  // 熟练度：同一风格在不同熟练度下的行为指标退化
  const famLevels = [1, 0.7, 0.4, 0]
  const famStyles: NamedStyle[] = ['control', 'highPress', 'tikiTaka', 'verticalTiki', 'wingPlay', 'directCounter', 'catenaccio']
  const specs: MatchSpec[] = []
  for (const scenario of ['mirror', 'speed'] as Scenario[]) {
    for (const id of ['blank', ...famStyles]) {
      for (const fam of famLevels) {
        for (const seed of seeds) {
          specs.push({ seed, scenario, aConfig: id, famA: fam, aHome: true })
          specs.push({ seed, scenario, aConfig: id, famA: fam, aHome: false })
        }
      }
    }
  }
  need(specs)
  await execute(specs)
  console.log('\n熟练度退化（同风格相对 B0 的主指标，mirror + speed 平均）')
  const famOut: Record<string, unknown> = {}
  for (const id of famStyles) {
    const target = TARGET[id]
    const line: string[] = []
    const rows: Record<string, unknown> = {}
    for (const fam of famLevels) {
      const values: number[] = []
      const perScenario: Record<string, number> = {}
      for (const scenario of ['mirror', 'speed'] as Scenario[]) {
        const test = pairBlocks(id, scenario, seeds, fam)
        const control = pairBlocks('blank', scenario, seeds, 1)
        const e = effect(target.metric, test, control, target.kind)
        values.push(e.value)
        perScenario[scenario] = e.value
      }
      const value = mean(values)
      rows[String(fam)] = { value, ci: bootstrapCi(values), perScenario }
      line.push(`fam ${fam.toFixed(1)} ${fmt(value)}`)
    }
    console.log(`${id.padEnd(14)} ${target.metric.padEnd(3)} ${line.join(' | ')}`)
    famOut[id] = rows
  }
  output.results = famOut
  fs.writeFileSync(path.join('docs', 'tactics-experiment-familiarity.json'), JSON.stringify(output, null, 2))
}

void main()
