/** 探索为何有合格传中候选却不出脚；只观察原有选择与事件。 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import { ablationFixture, type AblationFormation } from './tactics-ablation-fixture.ts'
import { cloneInstructions, STYLES } from '../src/game/pes/tactics.ts'
import { PesGame } from '../src/game/pes/game.ts'

const option = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`)
  if (i < 0) return fallback
  const value = Number(process.argv[i + 1])
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${name} 需要正整数`)
  return value
}
const n = option('n', 4)
const seed0 = option('seed0', 30001)
const outAt = process.argv.indexOf('--out')
const out = outAt >= 0 ? process.argv[outAt + 1] : 'docs/tactics-cross-diagnostic.json'
if (!out || out.startsWith('--')) throw new Error('--out 需要文件路径')

type Row = {
  formation: AblationFormation; narrow: boolean; seed: number; aHome: boolean
  decisions: number; candidates: number; preferred: number; canceledControl: number; canceledFoul: number
  executed: number; eventsAll: number; eventsNotSetPiece: number; margins: number[]
}
const rows: Row[] = []
for (const formation of ['4-4-2', '4-3-3'] as const) for (const narrow of [false, true]) {
  for (let i = 0; i < n; i++) for (const aHome of [true, false]) {
    const seed = seed0 + i
    const { home: a, away: b } = ablationFixture(formation)
    a.instructions = cloneInstructions(STYLES.wingPlay.instructions)
    b.instructions = cloneInstructions(STYLES.catenaccio.instructions)
    a.instructions.advanced = { defense: { width: 'normal' }, possession: { receiving: 'mixed' } }
    b.instructions.advanced = { defense: { width: narrow ? 'narrow' : 'normal' }, possession: { receiving: 'mixed' } }
    a.familiarity = b.familiarity = 1
    const game = new PesGame({ seed, home: aHome ? a : b, away: aHome ? b : a,
      durationSeconds: 900, offside: true, noInjuries: true, now: 0, metrics: true })
    game.run()
    const index = aHome ? 0 : 1
    const sample = game.match.metrics!.teams[index]
    const events = game.match.events.filter((e) => e.type === 'pass' && e.ti === index && e.meta?.kind === 'cross')
    rows.push({ formation, narrow, seed, aHome, decisions: sample.crossDecisions, candidates: sample.crossCandidates,
      preferred: sample.crossPreferred, canceledControl: sample.crossCanceledControl, canceledFoul: sample.crossCanceledFoul,
      executed: sample.crosses, eventsAll: events.length, eventsNotSetPiece: events.filter((e) => e.meta?.setPiece !== true).length,
      margins: sample.crossMargins })
  }
}
const summary: Record<string, unknown> = {}
for (const formation of ['4-4-2', '4-3-3'] as const) for (const narrow of [false, true]) {
  const rs = rows.filter((r) => r.formation === formation && r.narrow === narrow)
  const sum = (key: keyof Row) => rs.reduce((total, r) => total + (typeof r[key] === 'number' ? r[key] as number : 0), 0)
  const s = { games: rs.length, decisions: sum('decisions'), candidates: sum('candidates'), preferred: sum('preferred'),
    canceledControl: sum('canceledControl'), canceledFoul: sum('canceledFoul'), executed: sum('executed'),
    eventsAll: sum('eventsAll'), eventsNotSetPiece: sum('eventsNotSetPiece') }
  const margins = rs.flatMap((r) => r.margins).sort((a, b) => a - b)
  const q = (p: number) => margins.length ? margins[Math.floor((margins.length - 1) * p)] : null
  const marginStats = { n: margins.length, median: q(0.5), p90: q(0.9), within005: margins.filter((v) => v <= 0.05).length,
    within01: margins.filter((v) => v <= 0.1).length, within02: margins.filter((v) => v <= 0.2).length }
  summary[`${formation}|${narrow ? 'narrow' : 'normal'}`] = { ...s, margins: marginStats }
  console.log(`${formation} ${narrow ? 'narrow' : 'normal'}：${s.games}场，决策 ${s.decisions}，候选 ${s.candidates}，得分最高 ${s.preferred}，动作随机取消 ${s.canceledControl}，犯规中断 ${s.canceledFoul}，开放比赛出脚 ${s.executed}，全场传中事件 ${s.eventsAll}（非任意球传中 ${s.eventsNotSetPiece}）；比分差 ${JSON.stringify(marginStats)}`)
}
const hash = crypto.createHash('sha256')
const visit = (name: string): void => {
  if (fs.statSync(name).isDirectory()) for (const child of fs.readdirSync(name).sort()) visit(`${name}/${child}`)
  else hash.update(name).update('\0').update(fs.readFileSync(name)).update('\0')
}
for (const file of ['src', 'scripts/tactics-cross-diagnostic.ts', 'scripts/tactics-ablation-fixture.ts', 'scripts/tactics-experiment-helpers.ts', 'package-lock.json']) if (fs.existsSync(file)) visit(file)
fs.writeFileSync(out, JSON.stringify({ node: process.version, sourceHash: hash.digest('hex'), seed0, n, summary, rows }, null, 2))
console.log(`结果：${out}`)
