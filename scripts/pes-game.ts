/**
 * 新引擎（pes2d 物理 + 现有结算内核）的统计表（npm run pes:game）：和 `pes:baseline` 对现有引擎做的是同一件事，
 * 用同一个世界、同一支球队、同样三档实力差（镜像 / 客队属性 ×0.93 / ×0.87），方便并排对照、也是阶段 4 校准的起点。
 *
 *   npm run pes:game                 每档 30 场，D = 900 模拟秒
 *   npm run pes:game -- --n 100      每档 100 场
 *   npm run pes:game -- --d 600      整场 600 模拟秒
 *
 * 每档分给几个子进程并行跑。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { baselineTeams, BASELINE_FACTORS } from '../src/game/pes/baseline.ts'
import { PesGame } from '../src/game/pes/game.ts'

const self = fileURLToPath(import.meta.url)

interface Job {
  factor: number
  seeds: number[]
  duration: number
}
interface Row {
  factor: number
  seed: number
  score: [number, number]
  home: Record<string, number>
  away: Record<string, number>
  ms: number
  events: Record<string, number>
}

const childIndex = process.argv.indexOf('--child')
if (childIndex >= 0) {
  const job = JSON.parse(fs.readFileSync(process.argv[childIndex + 1], 'utf8')) as Job
  const { home, away } = baselineTeams(job.factor)
  const rows: Row[] = job.seeds.map((seed) => {
    const started = performance.now()
    const game = new PesGame({ seed, home: structuredClone(home), away: structuredClone(away), durationSeconds: job.duration })
    const state = game.run()
    const events: Record<string, number> = {}
    for (const e of game.match.events) events[e.type] = (events[e.type] ?? 0) + 1
    const pick = (side: 'home' | 'away') => Object.fromEntries(Object.entries(state.stats[side]).filter(([, v]) => typeof v === 'number')) as Record<string, number>
    return { factor: job.factor, seed, score: [state.score.home, state.score.away], home: pick('home'), away: pick('away'), ms: performance.now() - started, events }
  })
  process.stdout.write(JSON.stringify(rows))
  process.exit(0)
}

function option(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`)
  if (index < 0) return fallback
  const value = Number(process.argv[index + 1])
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} 需要一个正数`)
  return value
}

const perFactor = option('n', 30)
const duration = option('d', 900)
const workers = Math.max(1, Math.min(os.cpus().length - 1, 8))
const SEED0 = 9000

function run(job: Job, id: number): Promise<Row[]> {
  const tmp = path.join(os.tmpdir(), `pes-game-${process.pid}-${id}.json`)
  fs.writeFileSync(tmp, JSON.stringify(job))
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, self, '--child', tmp], { stdio: ['ignore', 'pipe', 'inherit'] })
    let out = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      fs.rmSync(tmp, { force: true })
      if (code !== 0) reject(new Error(`子进程退出码 ${code}`))
      else resolve(JSON.parse(out) as Row[])
    })
  })
}

const started = Date.now()
const jobs: Job[] = []
for (const factor of BASELINE_FACTORS) {
  const chunks: number[][] = Array.from({ length: workers }, () => [])
  for (let i = 0; i < perFactor; i++) chunks[i % workers].push(SEED0 + i)
  for (const seeds of chunks) if (seeds.length) jobs.push({ factor, seeds, duration })
}
const rows = (await Promise.all(jobs.map((job, id) => run(job, id)))).flat()

const mean = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / (xs.length || 1)
const f = (v: number, d = 1): string => v.toFixed(d)
console.log(`新引擎（pes2d + 结算内核）统计：7 人制，D = ${duration} 模拟秒，每档 ${perFactor} 场，耗时 ${((Date.now() - started) / 1000).toFixed(0)} 秒\n`)
console.log('| 客队属性 | 主 / 平 / 客 | 每场进球 | 射门（射正） | 传球成功率 | 抢断 | 拦截 | 犯规 | 角球 | 黄牌 / 红牌 | 控球（主） | 单队跑动 | 0:0 | 耗时/场 |')
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
for (const factor of BASELINE_FACTORS) {
  const mine = rows.filter((r) => r.factor === factor)
  const both = (key: string) => mean(mine.map((r) => r.home[key] + r.away[key]))
  const wins = mine.filter((r) => r.score[0] > r.score[1]).length
  const draws = mine.filter((r) => r.score[0] === r.score[1]).length
  const passes = both('passes')
  console.log(
    `| ×${factor} | ${wins} / ${draws} / ${mine.length - wins - draws} | ${f(mean(mine.map((r) => r.score[0] + r.score[1])), 2)} | ${f(both('shots'))}（${f(both('shotsOnTarget'))}） | ${f((both('passesCompleted') / passes) * 100, 0)}% | ${f(both('tackles'))} | ${f(both('interceptions'))} | ${f(both('fouls'))} | ${f(both('corners'))} | ${f(both('yellowCards'), 2)} / ${f(both('redCards'), 2)} | ${f(mean(mine.map((r) => r.home.possession)), 0)}% | ${f(mean(mine.map((r) => (r.home.distance + r.away.distance) / 2)) / 1000)} km | ${mine.filter((r) => r.score[0] + r.score[1] === 0).length} | ${f(mean(mine.map((r) => r.ms)) / 1000, 2)} 秒 |`,
  )
}
const mirror = rows.filter((r) => r.factor === 1)
const ev = (type: string) => mean(mirror.map((r) => r.events[type] ?? 0))
console.log(`\n镜像对阵每场事件：传球 ${f(ev('pass'))}，近身对抗 ${f(ev('duel') + ev('tackle'))}，争顶 ${f(ev('aerial'))}，任意球 ${f(ev('fk'))}，点球 ${f(ev('penalty'), 2)}，伤病 ${f(ev('injury'), 2)}，扑救 ${f(ev('save'))}，球门球 ${f(ev('goalkick'))}，界外球 ${f(ev('throwin'))}`)
