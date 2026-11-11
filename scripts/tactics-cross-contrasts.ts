/**
 * 从 tactics-cross-experiment 的原始比赛重算真正的配对差中之差。
 * npm run tactics:cross-contrasts -- <input.json> <output.json>
 */
import fs from 'node:fs'

type Spec = { formation: string; narrow: boolean; fam: number; early: boolean; seed: number; aHome: boolean }
type Row = { spec: Spec; crosses: number; xgd: number }
type Input = { sourceHash: string; fixtureHashes: Record<string, string>; seeds: number[]; rows: Row[] }
const [inputFile, outputFile] = process.argv.slice(2)
if (!inputFile || !outputFile) throw new Error('用法：tsx scripts/tactics-cross-contrasts.ts input.json output.json')
const data = JSON.parse(fs.readFileSync(inputFile, 'utf8')) as Input
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
function ci(values: number[]): [number, number] {
  if (values.length < 2) return [NaN, NaN]
  let state = 0x9e3779b9
  const samples: number[] = []
  for (let i = 0; i < 10000; i++) {
    let total = 0
    for (let j = 0; j < values.length; j++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      total += values[Math.floor(state / 0x100000000 * values.length)]
    }
    samples.push(total / values.length)
  }
  samples.sort((a, b) => a - b)
  return [samples[249], samples[9749]]
}
const block = (formation: string, narrow: boolean, fam: number, early: boolean, seed: number, metric: 'crosses' | 'xgd'): number => {
  const rs = data.rows.filter((r) => r.spec.formation === formation && r.spec.narrow === narrow && r.spec.fam === fam && r.spec.early === early && r.spec.seed === seed)
  if (rs.length !== 2 || new Set(rs.map((r) => r.spec.aHome)).size !== 2) throw new Error(`缺少完整主客：${formation}/${narrow}/${fam}/${early}/${seed}`)
  return mean(rs.map((r) => r[metric]))
}
const effect = (formation: string, narrow: boolean, fam: number, seed: number, metric: 'crosses' | 'xgd'): number =>
  block(formation, narrow, fam, true, seed, metric) - block(formation, narrow, fam, false, seed, metric)
const make = (bySeed: number[]) => ({ value: mean(bySeed), ci: ci(bySeed), n: bySeed.length, bySeed })
const contrasts: Record<string, unknown> = {}
for (const formation of ['4-4-2', '4-3-3']) for (const metric of ['crosses', 'xgd'] as const) {
  for (const fam of [1, 0.4]) {
    const key = `${formation}|${metric}|narrow-vs-normal|fam=${fam}`
    contrasts[key] = make(data.seeds.map((seed) => effect(formation, true, fam, seed, metric) - effect(formation, false, fam, seed, metric)))
  }
  for (const narrow of [false, true]) {
    const key = `${formation}|${metric}|familiarity-1-vs-0.4|${narrow ? 'narrow' : 'normal'}`
    contrasts[key] = make(data.seeds.map((seed) => effect(formation, narrow, 1, seed, metric) - effect(formation, narrow, 0.4, seed, metric)))
  }
}
fs.writeFileSync(outputFile, JSON.stringify({ sourceFile: inputFile, sourceHash: data.sourceHash, fixtureHashes: data.fixtureHashes, seeds: data.seeds, contrasts }, null, 2))
for (const [key, value] of Object.entries(contrasts)) {
  const v = value as { value: number; ci: [number, number] }
  console.log(`${key}: ${v.value.toFixed(2)} [${v.ci[0].toFixed(2)},${v.ci[1].toFixed(2)}]`)
}
