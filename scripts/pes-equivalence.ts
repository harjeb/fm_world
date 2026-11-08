/**
 * 核对 / 记录旧引擎的等价性语料（npm run pes:equiv）。
 *
 *   npm run pes:equiv                核对：重新模拟语料里的每一场，和 src/game/pes/equivalence.json 逐场比哈希
 *   npm run pes:equiv -- --write     记录：用当前引擎重新生成 equivalence.json（有意改了引擎之后才用）
 *   npm run pes:equiv -- --n 40      每个规则版本只跑前 40 场（调试用，不能和 --write 一起用）
 *
 * 设计见 src/game/pes/equivalence.ts。每场比赛一个子进程批次并行，约十几秒。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EQUIV_MATCHES_PER_RULES, equivalenceCases, runEquivalenceCase, type EquivCase, type EquivResult } from '../src/game/pes/equivalence.ts'

const self = fileURLToPath(import.meta.url)
const repoRoot = path.resolve(path.dirname(self), '..')
const file = path.join(repoRoot, 'src/game/pes/equivalence.json')

const childIndex = process.argv.indexOf('--child')
if (childIndex >= 0) {
  const specs = JSON.parse(fs.readFileSync(process.argv[childIndex + 1], 'utf8')) as EquivCase[]
  process.stdout.write(JSON.stringify(specs.map(runEquivalenceCase)))
  process.exit(0)
}

function option(name: string): number | undefined {
  const index = process.argv.indexOf(`--${name}`)
  if (index < 0) return undefined
  const value = Number(process.argv[index + 1])
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} 需要一个正数`)
  return value
}

const write = process.argv.includes('--write')
const limit = option('n')
if (write && limit) throw new Error('--write 必须跑完整语料，不能和 --n 一起用')
const cases = equivalenceCases(limit ?? EQUIV_MATCHES_PER_RULES)
const workers = Math.max(1, Math.min(os.cpus().length - 1, 8))
const chunks: EquivCase[][] = Array.from({ length: workers }, () => [])
cases.forEach((item, index) => chunks[index % workers].push(item))

function runChunk(specs: EquivCase[], id: number): Promise<EquivResult[]> {
  const tmp = path.join(os.tmpdir(), `pes-equiv-${process.pid}-${id}.json`)
  fs.writeFileSync(tmp, JSON.stringify(specs))
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, self, '--child', tmp], { stdio: ['ignore', 'pipe', 'inherit'] })
    let out = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      fs.rmSync(tmp, { force: true })
      if (code !== 0) reject(new Error(`子进程退出码 ${code}`))
      else resolve(JSON.parse(out) as EquivResult[])
    })
  })
}

const started = Date.now()
const results = (await Promise.all(chunks.map((specs, id) => runChunk(specs, id)))).flat()
const key = (item: EquivCase) => `${item.rules}:${item.seed}`
const byKey = new Map(results.map((item) => [key(item), item]))
const ordered = cases.map((item) => byKey.get(key(item)) as EquivResult)

if (write) {
  fs.writeFileSync(file, JSON.stringify({ schema: 1, note: '旧引擎的等价性语料。由 npm run pes:equiv -- --write 生成，不要手改。', results: ordered }, null, 1) + '\n')
  console.log(`已记录 ${ordered.length} 场到 ${path.relative(repoRoot, file)}（${((Date.now() - started) / 1000).toFixed(0)} 秒）`)
  process.exit(0)
}

const recorded = JSON.parse(fs.readFileSync(file, 'utf8')) as { results: EquivResult[] }
const expected = new Map(recorded.results.map((item) => [key(item), item]))
const bad: string[] = []
for (const item of ordered) {
  const want = expected.get(key(item))
  if (!want) bad.push(`v${item.rules} 种子 ${item.seed}：语料里没有这一场`)
  else if (want.hash !== item.hash) bad.push(`v${item.rules} 种子 ${item.seed}：哈希 ${item.hash} ≠ 记录 ${want.hash}（比分 ${item.score.join('-')}，记录 ${want.score.join('-')}）`)
}
console.log(`核对 ${ordered.length} 场（${((Date.now() - started) / 1000).toFixed(0)} 秒）：${bad.length === 0 ? '全部逐位一致 ✔' : `${bad.length} 场不一致 ✘`}`)
for (const line of bad.slice(0, 15)) console.log('  ' + line)
if (bad.length > 15) console.log(`  …… 还有 ${bad.length - 15} 场`)
process.exit(bad.length === 0 ? 0 : 1)
