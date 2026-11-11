/**
 * 新机制触发率诊断（只读，不参与平衡判定）。
 *
 *   npx tsx scripts/tactics-diagnostics.ts [--n 4]
 *
 * 统计：空当传球次数、身后传球占比、窄防守下的实际无球宽度、任务冲突数。
 * 结果只说明“机制有没有发生”，不说明对胜负的因果。
 */
import { baselineTeams } from '../src/game/pes/baseline.ts'
import { PesGame } from '../src/game/pes/game.ts'
import { STYLE_LIST_REV2, type StyleId } from '../src/game/pes/tactics.ts'
import type { PesPlayer } from '../src/game/pes/spec.ts'

const index = process.argv.indexOf('--n')
const SEEDS = index >= 0 ? Math.max(1, Number(process.argv[index + 1]) || 4) : 4

const style = (id: StyleId) => STYLE_LIST_REV2.find((s) => s.id === id)!.instructions

type Pair = { a: StyleId; b: StyleId; why: string }
const PAIRS: Pair[] = [
  { a: 'directCounter', b: 'highPress', why: '快反(接空当) vs 高压(高防线)' },
  { a: 'fluidCounter', b: 'highPress', why: '灵反(接空当) vs 高压' },
  { a: 'wingPlay', b: 'catenaccio', why: '双翼 vs 链式(窄防守)' },
  { a: 'control', b: 'catenaccio', why: '控制 vs 链式(窄防守)' },
  { a: 'verticalTiki', b: 'parkBus', why: '垂密 vs 摆巴(窄防守)' },
]

const quantile = (sorted: number[], q: number): number => {
  if (!sorted.length) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function run(a: StyleId, b: StyleId, seed: number): {
  spaceA: number; throughA: number; passesA: number
  widthB: number; widthBNormal: number; conflicts: number
} {
  const teams = baselineTeams(1)
  for (const team of [teams.home, teams.away]) {
    delete team.autoSubs
    delete team.chemistry
    for (const starter of team.starters) starter.player.condition = 100
    for (const player of team.bench) player.condition = 100
  }
  teams.home.instructions = structuredClone(style(a))
  teams.away.instructions = structuredClone(style(b))
  const game = new PesGame({
    seed, home: teams.home, away: teams.away, durationSeconds: 900,
    offside: true, noInjuries: true, now: 0,
  })
  const m = game.match
  // 逐帧采样：对手持球时防守方的外场横向宽度。
  const widths: number[] = []
  const originalStep = m.step.bind(m)
  let conflicts = 0
  ;(m as unknown as { step: () => void }).step = (): void => {
    originalStep()
    const owner = m.ball.owner
    if (owner < 0) return
    const ownerTi = m.players[owner].ti
    const def = m.teams[1 - ownerTi]
    const ys = def.players.filter((p) => p.slot !== 0).map((p) => p.pos.y).sort((x, y) => x - y)
    if (ys.length >= 8) widths.push(quantile(ys, 0.9) - quantile(ys, 0.1))
    const marked = new Set<number>()
    for (const slot of def.marks) if (slot >= 0) marked.add(slot)
    for (const pid of [def.presser, def.presser2, def.cover]) {
      if (typeof pid === 'number' && pid >= 0 && marked.has(pid)) conflicts++
    }
  }
  game.run()
  const passes = m.events.filter((e) => e.type === 'pass' && e.meta?.kind !== 'cross' && e.ti === 0)
  const spaceA = passes.filter((e) => typeof e.meta?.plannedX === 'number').length
  const throughA = passes.filter((e) => e.meta?.kind === 'through').length
  return {
    spaceA, throughA, passesA: passes.length,
    widthB: widths.length ? widths.reduce((x, y) => x + y, 0) / widths.length : NaN,
    widthBNormal: NaN,
    conflicts,
  }
}

function normalWidth(b: StyleId, seed: number): number {
  const teams = baselineTeams(1)
  for (const team of [teams.home, teams.away]) {
    delete team.autoSubs
    delete team.chemistry
    for (const starter of team.starters) starter.player.condition = 100
    for (const player of team.bench) player.condition = 100
  }
  const neutral = structuredClone(style(b))
  if (neutral.advanced?.defense) neutral.advanced.defense.width = 'normal'
  teams.home.instructions = structuredClone(style('blank'))
  teams.away.instructions = neutral
  const game = new PesGame({ seed, home: teams.home, away: teams.away, durationSeconds: 900, offside: true, noInjuries: true, now: 0 })
  const m = game.match
  const widths: number[] = []
  const originalStep = m.step.bind(m)
  ;(m as unknown as { step: () => void }).step = (): void => {
    originalStep()
    const owner = m.ball.owner
    if (owner < 0) return
    const def = m.teams[1 - m.players[owner].ti]
    const ys = def.players.filter((p: PesPlayer) => p.slot !== 0).map((p) => p.pos.y).sort((x, y) => x - y)
    if (ys.length >= 8) widths.push(quantile(ys, 0.9) - quantile(ys, 0.1))
  }
  game.run()
  return widths.length ? widths.reduce((x, y) => x + y, 0) / widths.length : NaN
}

console.log(`诊断：${SEEDS} 个种子 × ${PAIRS.length} 组对位（每场 900 模拟秒）\n`)
for (const pair of PAIRS) {
  let space = 0; let through = 0; let passes = 0; let conflicts = 0
  let widthNarrow = 0; let widthNormal = 0
  for (let i = 0; i < SEEDS; i++) {
    const seed = 1000 + i * 7
    const r = run(pair.a, pair.b, seed)
    space += r.spaceA; through += r.throughA; passes += r.passesA; conflicts += r.conflicts
    widthNarrow += r.widthB
    widthNormal += normalWidth(pair.b, seed)
  }
  console.log(`${pair.why}`)
  console.log(`  进攻方传球 ${passes}，其中空当传球 ${space}（${(space / Math.max(1, passes) * 100).toFixed(1)}%），身后型 ${through}`)
  console.log(`  防守方无球宽度：窄 ${(widthNarrow / SEEDS).toFixed(2)} m vs 同模板 normal ${(widthNormal / SEEDS).toFixed(2)} m`)
  console.log(`  上抢者/协防者同时被盯人分配的次数 ${conflicts}\n`)
}
