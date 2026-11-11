/**
 * 比较两份战术矩阵结果（通常是修订版 1 与新方案）。
 *
 *   npx tsx scripts/tactics-compare.ts docs/a.json docs/b.json
 *
 * 只读 JSON，不跑模拟；输出强度、对位与交互项的差值，以及预设的五条设计假设。
 */
import fs from 'node:fs'

type Cell = { xgd: number; ci: [number, number]; matchPointsPct?: number }
type Matrix = {
  fixture: { bytes: number; sha256: string }
  seeds: number[]
  runner?: { revision?: number; squad?: number; exactMirror?: boolean; sourceHash?: string }
  results: Record<string, Record<string, Cell>> & { interaction: Record<string, Record<string, { value: number; ci: [number, number] }>> }
}

const SHORT: Record<string, string> = {
  control: '控制', highPress: '高压', tikiTaka: '密短', verticalTiki: '垂密', wingPlay: '双翼',
  longBall: '长传', fluidCounter: '灵反', directCounter: '快反', catenaccio: '链式', parkBus: '摆巴',
}
const STYLES = Object.keys(SHORT)

const read = (file: string): Matrix => JSON.parse(fs.readFileSync(file, 'utf8')) as Matrix
const fmt = (v: number, digits = 2): string => (Number.isFinite(v) ? (v >= 0 ? `+${v.toFixed(digits)}` : v.toFixed(digits)) : 'n/a')
const mark = (ci: [number, number]): string => (ci[0] > 0 || ci[1] < 0 ? '*' : ' ')

function strengths(m: Matrix): Record<string, Cell> {
  const out: Record<string, Cell> = {}
  for (const style of STYLES) {
    const cell = (m.results as Record<string, unknown>)[`${style}:neutral`] as Cell | undefined
    if (cell) out[style] = cell
  }
  return out
}

function main(): void {
  const [fileA, fileB] = process.argv.slice(2)
  if (!fileA || !fileB) throw new Error('用法：tsx scripts/tactics-compare.ts <旧.json> <新.json>')
  const a = read(fileA)
  const b = read(fileB)
  if (a.fixture.sha256 !== b.fixture.sha256) throw new Error('两份结果夹具不同，不能直接比较')
  if (a.seeds.join(',') !== b.seeds.join(',')) throw new Error('两份结果种子不同，不能直接比较')
  const labelA = `修订 ${a.runner?.revision ?? '?'}`
  const labelB = `修订 ${b.runner?.revision ?? '?'}`
  console.log(`${fileA} (${labelA})  vs  ${fileB} (${labelB})`)
  console.log(`夹具 ${a.fixture.sha256.slice(0, 12)}…，种子 ${a.seeds.length} 个\n`)

  const sa = strengths(a)
  const sb = strengths(b)
  console.log(`相对中性的强度（xGD vs B0）：${labelA} → ${labelB}`)
  for (const style of STYLES) {
    const x = sa[style]
    const y = sb[style]
    if (!x || !y) continue
    console.log(`  ${SHORT[style]}  ${fmt(x.xgd)}${mark(x.ci)} → ${fmt(y.xgd)}${mark(y.ci)}   Δ${fmt(y.xgd - x.xgd)}`)
  }

  console.log(`\n交互项 A−B（扣除双方对中性强度后的残差）：${labelA} → ${labelB}`)
  console.log(['A\\B'.padEnd(6), ...STYLES.map((s) => SHORT[s].padEnd(6))].join(' '))
  for (const x of STYLES) {
    const row: string[] = []
    for (const y of STYLES) {
      if (x === y) { row.push('—'.padEnd(6)); continue }
      const old = a.results.interaction[x]?.[y]
      const now = b.results.interaction[x]?.[y]
      if (!old || !now) { row.push('n/a'.padEnd(6)); continue }
      const delta = now.value - old.value
      row.push(`${fmt(now.value)}${mark(now.ci)}${Math.abs(delta) >= 0.5 ? `(${delta > 0 ? '+' : ''}${delta.toFixed(1)})` : ''}`.padEnd(6))
    }
    console.log([SHORT[x].padEnd(6), ...row].join(' '))
  }

  // 设计假设：关注“进攻方相对该对手”的原始对位与交互项是否朝预期方向移动。
  const hypotheses: { text: string; a: string; b: string; expect: 'up' | 'down' }[] = [
    { text: '快反 vs 高压：快反应更能利用高防线', a: 'directCounter', b: 'highPress', expect: 'up' },
    { text: '长传 vs 高压：应更少被压死', a: 'longBall', b: 'highPress', expect: 'up' },
    { text: '双翼 vs 链式：窄低位应让出边路', a: 'wingPlay', b: 'catenaccio', expect: 'up' },
    { text: '双翼 vs 摆巴：同上', a: 'wingPlay', b: 'parkBus', expect: 'up' },
    { text: '垂密 vs 链式：中路短传应更难打透窄低位', a: 'verticalTiki', b: 'catenaccio', expect: 'down' },
    { text: '控制 vs 链式：控球应更难打透低位', a: 'control', b: 'catenaccio', expect: 'down' },
    { text: '快反 vs 控制：低位反击对控球', a: 'directCounter', b: 'control', expect: 'up' },
    { text: '灵反 vs 高压：同上（灵活版）', a: 'fluidCounter', b: 'highPress', expect: 'up' },
  ]
  console.log('\n预设对位（原始 xGD 与交互项）：')
  for (const h of hypotheses) {
    const rawA = a.results[h.a]?.[h.b]
    const rawB = b.results[h.a]?.[h.b]
    const intA = a.results.interaction[h.a]?.[h.b]
    const intB = b.results.interaction[h.a]?.[h.b]
    if (!rawA || !rawB || !intA || !intB) continue
    const delta = rawB.xgd - rawA.xgd
    const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
    const verdict = direction === 'flat' ? '无变化' : direction === h.expect ? '符合预期方向' : '**与预期相反**'
    console.log(`  ${h.text}: 原始 ${fmt(rawA.xgd)} → ${fmt(rawB.xgd)}（Δ${fmt(delta)}，${verdict}）；交互 ${fmt(intA.value)} → ${fmt(intB.value)}${mark(intB.ci)}`)
  }
}

main()
