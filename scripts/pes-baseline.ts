/**
 * 记录现有比赛引擎的基线（npm run pes:baseline），写到 src/game/pes/baseline.json。
 * 计划见 docs/pes2d-migration-plan.md 阶段 0；核心逻辑在 src/game/pes/baseline.ts。
 *
 *   npm run pes:baseline                  v3、v2 各 3 档实力差（镜像 / 客队低 7% / 低 13%），每档 200 场，约 2–3 分钟
 *   npm run pes:baseline -- --n 50        场数（调试用，不要提交）
 *   npm run pes:baseline -- --attr        另外跑逐属性 ±20 敏感度（v3，每个任务 150 场，共 45 个任务，较慢），写到 baseline-attrs.json
 *
 * 并行：每个批次一个子进程。同一份代码、同一组种子永远得到同一份 results / golden；timing 不参与比较。
 */
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ATTR_JOBS,
  BASELINE_FACTORS,
  BASELINE_MATCHES,
  BASELINE_RULES,
  BASELINE_SEED0,
  BASELINE_STARTED_AT,
  BASELINE_WORLD_SEED,
  runAttrJob,
  runBatch,
  type BatchResult,
  type BatchSpec,
} from '../src/game/pes/baseline.ts'
import { LOGIC_MATCH_SECONDS } from '../src/game/match/time.ts'
import type { AttrKey } from '../src/game/types.ts'

const self = fileURLToPath(import.meta.url)
const repoRoot = path.resolve(path.dirname(self), '..')
const outDir = path.join(repoRoot, 'src/game/pes')

/* ------------------------------ 子进程 ------------------------------ */

const childIndex = process.argv.indexOf('--child')
if (childIndex >= 0) {
  const payload = JSON.parse(process.argv[childIndex + 1]) as { kind: 'batch'; spec: BatchSpec } | { kind: 'attr'; attr: AttrKey; delta: number; n: number; seed0: number }
  const started = Date.now()
  const result = payload.kind === 'batch' ? runBatch(payload.spec) : runAttrJob(payload.attr, payload.delta, payload.n, payload.seed0)
  process.stdout.write(JSON.stringify({ result, ms: Date.now() - started }))
  process.exit(0)
}

/* ------------------------------ 父进程 ------------------------------ */

function option(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`)
  if (index < 0) return fallback
  const value = Number(process.argv[index + 1])
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} 需要一个正数`)
  return value
}

const matches = option('n', BASELINE_MATCHES)
const seed0 = option('seed', BASELINE_SEED0)
const concurrency = Math.max(1, Math.min(os.cpus().length - 1, 8))

function runChild<T>(payload: object): Promise<{ result: T; ms: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, self, '--child', JSON.stringify(payload)], { stdio: ['ignore', 'pipe', 'inherit'] })
    let out = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`子进程退出码 ${code}`))
      else resolve(JSON.parse(out) as { result: T; ms: number })
    })
  })
}

async function pool<T, R>(items: T[], worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        results[index] = await worker(items[index], index)
      }
    }),
  )
  return results
}

function gitHead(): string {
  try {
    const head = execSync('git rev-parse --short HEAD', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const dirty = execSync('git status --porcelain -- src scripts', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() !== ''
    return dirty ? `${head}+工作区有改动` : head
  } catch {
    return 'unknown'
  }
}

const started = Date.now()
const specs: BatchSpec[] = BASELINE_RULES.flatMap((rules) => BASELINE_FACTORS.map((awayFactor) => ({ rules, awayFactor, n: matches, seed0 })))
console.log(`基线：${specs.length} 个批次 × ${matches} 场，并行 ${concurrency}`)
const done = await pool(specs, async (spec) => {
  const run = await runChild<BatchResult>({ kind: 'batch', spec })
  const r = run.result.results
  console.log(`  v${spec.rules} 客队×${spec.awayFactor}: 主 ${r.homeWins} 平 ${r.draws} 客 ${r.awayWins}，每场 ${r.goals[2]} 球 / ${r.shots[2]} 脚，${(run.ms / matches).toFixed(0)} ms/场`)
  return run
})

const report = {
  schema: 1,
  note: '现有比赛引擎的基线。由 npm run pes:baseline 生成，不要手改。results 和 golden 是确定性的；timing 不参与比较。',
  world: { seed: BASELINE_WORLD_SEED, startedAt: BASELINE_STARTED_AT, durationSeconds: LOGIC_MATCH_SECONDS },
  options: { knockout: false, offside: false, recordPlayback: false },
  batches: done.map((run) => run.result),
  meta: { commit: gitHead(), node: process.version, note: '仅供追溯，不参与比较' },
  timing: Object.fromEntries(done.map((run, index) => [`v${specs[index].rules}-x${specs[index].awayFactor}`, { msPerMatch: Math.round(run.ms / matches) }])),
}
const outFile = path.join(outDir, 'baseline.json')
fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n')
console.log(`已写入 ${path.relative(repoRoot, outFile)}（${((Date.now() - started) / 1000).toFixed(0)} 秒）`)

if (process.argv.includes('--attr')) {
  const attrMatches = option('attr-n', 150)
  const attrSeed0 = option('attr-seed', 5000)
  const jobs = [{ attr: null as AttrKey | null, delta: 0 }, ...ATTR_JOBS]
  console.log(`逐属性：${jobs.length} 个任务 × ${attrMatches} 场（v3）`)
  const rows = await pool(jobs, async (job) => (await runChild<ReturnType<typeof runAttrJob>>({ kind: 'attr', attr: job.attr, delta: job.delta, n: attrMatches, seed0: attrSeed0 })).result)
  const attrFile = path.join(outDir, 'baseline-attrs.json')
  fs.writeFileSync(attrFile, JSON.stringify({ schema: 1, rules: 3, matches: attrMatches, seed0: attrSeed0, note: '主队全体（门将属性只改门将）某属性 ±20 个评分点，客队不变；goalDiff = 主队 − 客队，每场平均。', rows }, null, 2) + '\n')
  console.log(`已写入 ${path.relative(repoRoot, attrFile)}`)
}
