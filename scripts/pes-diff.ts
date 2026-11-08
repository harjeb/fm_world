/**
 * 差分对照：TypeScript 版 pes2d 内核 vs 原版 sim.js，逐帧逐位比较（npm run pes:diff）。
 *
 *   npm run pes:diff                  跑全部用例（约半分钟）
 *   npm run pes:diff -- --quick       只跑短用例（每个 300 秒）
 *   PES2D_SRC=路径 npm run pes:diff    指定原版 sim.js 的位置（默认 F:/FIFA_test/pes2d/sim.js）
 *
 * 做法见 src/game/pes/reference.ts：两边注入同一个 mulberry32，抽到的随机数完全一样，
 * 所以每一帧每个球员和球的位置、速度、体力、模式……都必须逐位相同；第一处不一致就停下并报出是哪个字段。
 */
import { formationRows } from '../src/game/pes/formation.ts'
import { makePair, referenceAvailable, referencePath, runDiff, type PairedCase, type RefRow } from '../src/game/pes/reference.ts'
import { makePitch11, makePitch7 } from '../src/game/pes/spec.ts'
import type { FormationId } from '../src/game/types.ts'

if (!referenceAvailable()) {
  console.error(`找不到原版 pes2d：${referencePath()}（用环境变量 PES2D_SRC 指定）`)
  process.exit(2)
}

const quick = process.argv.includes('--quick')
const ids: FormationId[] = ['1-2-3-1', '1-3-2-1', '1-2-2-2']
const rows7: Record<string, RefRow[]> = Object.fromEntries(
  ids.map((id) => [id, formationRows(id).map((row): RefRow => [row.role, row.nx, row.ny, row.line])]),
)

const long = quick ? 300 : 900
const long11 = quick ? 300 : 600
const at7 = (label: string, home: FormationId, away: FormationId, extra: Partial<PairedCase> = {}): PairedCase => ({
  label, spec: makePitch7(long), scaled: true, formations: rows7, homeFormation: home, awayFormation: away, seed: 7, rngSeed: 700, ...extra,
})
const at11 = (label: string, home: string, away: string, extra: Partial<PairedCase> = {}): PairedCase => ({
  label, spec: makePitch11(long11), scaled: false, homeFormation: home, awayFormation: away, seed: 3, rngSeed: 300, ...extra,
})

const cases: PairedCase[] = [
  at11(`11 人制原版常数：4-3-3 对 4-2-3-1（${long11} 秒）`, '4-3-3', '4-2-3-1'),
  at11(`11 人制原版常数：4-4-2 对 3-5-2，高位逼抢对退守窄防（${long11} 秒）`, '4-4-2', '3-5-2', {
    seed: 11, rngSeed: 1100, homeStrength: 0.85, awayStrength: 0.6,
    homeTactics: { line: 0.9, press: 0.9, tempo: 0.8, direct: 0.8, aggression: 0.8, width: 0.8 },
    awayTactics: { line: 0.1, press: 0.1, tempo: 0.2, direct: 0.2, aggression: 0.2, width: 0.1 },
  }),
  at7(`7 人制：1-2-3-1 镜像（${long} 秒）`, '1-2-3-1', '1-2-3-1'),
  at7(`7 人制：1-3-2-1 对 1-2-2-2（${long} 秒）`, '1-3-2-1', '1-2-2-2', { seed: 21, rngSeed: 2100 }),
  at7(`7 人制：实力差 + 战术拉满（${long} 秒）`, '1-2-2-2', '1-2-3-1', {
    seed: 33, rngSeed: 3300, homeStrength: 0.9, awayStrength: 0.45,
    homeTactics: { line: 1, press: 1, tempo: 1, direct: 1, aggression: 1, width: 1 },
    awayTactics: { line: 0, press: 0, tempo: 0, direct: 0, aggression: 0, width: 0 },
  }),
  at7(`7 人制：另一组种子（${long} 秒）`, '1-2-3-1', '1-3-2-1', { seed: 99, rngSeed: 9900 }),
]

let failed = 0
const started = Date.now()
for (const item of cases) {
  const t0 = Date.now()
  const { ref, pes } = makePair(item)
  const result = runDiff(ref, pes, Math.ceil(item.spec.HALF * 2 / item.spec.DT) * 3)
  const ms = Date.now() - t0
  const finished = ref.state === 'end' && pes.phase === 'end'
  const score = `${ref.home.score}-${ref.away.score}`
  if (result.mismatch) {
    failed++
    console.log(`✘ ${item.label}\n    第 ${result.steps} 帧（模拟 ${result.at.toFixed(2)} 秒）：${result.mismatch}`)
  } else if (!finished) {
    failed++
    console.log(`✘ ${item.label}\n    跑了 ${result.steps} 帧还没到终场`)
  } else {
    console.log(`✔ ${item.label}  ${result.steps} 帧逐位一致，比分 ${score}，射门 ${ref.home.stats.shots + ref.away.stats.shots}，事件 ${pes.events.length}，${ms} ms`)
  }
}
console.log(`\n${failed === 0 ? '全部逐位一致 ✔' : `${failed} 个用例不一致 ✘`}（${((Date.now() - started) / 1000).toFixed(0)} 秒）`)
process.exit(failed === 0 ? 0 : 1)
