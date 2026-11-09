/**
 * 新内核自由运行的统计表（npm run pes:freerun）：不接结算，看 pes2d 自己的物理 + 几何结算在游戏场地（11 人制）下的表现。
 * 对应计划 6.6 的试跑表，用来确认移植后的内核和试跑时一样健康，也是阶段 4 校准前的起点。
 *
 *   npm run pes:freerun                 每组 12 场，D = 900 模拟秒
 *   npm run pes:freerun -- --n 30       每组 30 场
 *   npm run pes:freerun -- --d 600      整场 600 模拟秒
 *
 * 球员用 `fixtureTeam`（属性围绕典型水平随机）；每个对阵的两队互换主客场不另跑，种子不同即可。
 */
import { fixtureTeam } from '../src/game/pes/fixtures.ts'
import { FreeRunMonitor } from '../src/game/pes/health.ts'
import { PesMatch } from '../src/game/pes/sim.ts'
import { makeGamePitch, type PesTactics } from '../src/game/pes/spec.ts'
import type { FormationId } from '../src/game/types.ts'

function option(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`)
  if (index < 0) return fallback
  const value = Number(process.argv[index + 1])
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} 需要一个正数`)
  return value
}

const perCase = option('n', 12)
const duration = option('d', 900)

interface Case {
  label: string
  home: FormationId
  away: FormationId
  homeTactics?: Partial<PesTactics>
  awayTactics?: Partial<PesTactics>
  homeLevel?: number
  awayLevel?: number
}

const cases: Case[] = [
  { label: '镜像 4-4-2', home: '4-4-2', away: '4-4-2' },
  { label: '3-5-2 对 4-3-3', home: '3-5-2', away: '4-3-3' },
  { label: '高位逼抢 对 低位窄防', home: '4-3-3', away: '4-2-3-1', homeTactics: { line: 1, press: 1, tempo: 0.8 }, awayTactics: { line: 0, press: 0, width: 0.2, tempo: 0.3 } },
  { label: '实力差（客队属性低约 7%）', home: '4-4-2', away: '4-4-2', awayLevel: 35.5 },
]

const mean = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / (xs.length || 1)
const f = (v: number, digits = 1): string => v.toFixed(digits)

console.log(`自由运行：11 人制 105×68 米，D = ${duration} 模拟秒，每组 ${perCase} 场\n`)
console.log('| 对阵 | 进球 | 射门（射正） | 传球成功率 | 角球 | 球门球 | 越位 | 犯规 | 抢断 | 扑救 | 单队跑动 | 平局 / 0:0 | 耗时/场 |')
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|')

const health: string[] = []
for (const [index, c] of cases.entries()) {
  const rows = { goals: [] as number[], shots: [] as number[], on: [] as number[], passes: [] as number[], ok: [] as number[], corners: [] as number[], goalkicks: [] as number[], offsides: [] as number[], fouls: [] as number[], tackles: [] as number[], saves: [] as number[], km: [] as number[], draw: [] as number[], nil: [] as number[], ms: [] as number[] }
  let out = 0
  let stack = 0
  let stuck = 0
  let dead = 0
  const shapes = { depth: [] as number[], width: [] as number[] }
  for (let n = 0; n < perCase; n++) {
    const seed = 1000 * (index + 1) + n
    const m = new PesMatch({
      spec: makeGamePitch(duration),
      seed,
      home: fixtureTeam(c.home, { seed: seed * 2 + 1, prefix: 'H', tactics: c.homeTactics, level: c.homeLevel }),
      away: fixtureTeam(c.away, { seed: seed * 2 + 2, prefix: 'A', tactics: c.awayTactics, level: c.awayLevel }),
    })
    const monitor = new FreeRunMonitor()
    const started = performance.now()
    while (m.phase !== 'end') {
      m.step()
      monitor.observe(m)
    }
    rows.ms.push(performance.now() - started)
    const [h, a] = m.teams
    const report = monitor.report(m)
    out += report.outOfBounds
    stack += report.stackRatio
    stuck += report.stuckBall
    dead += report.deadBallRatio
    shapes.depth.push((report.teams[0].attacking.depth + report.teams[0].defending.depth) / 2)
    shapes.width.push((report.teams[0].attacking.width + report.teams[0].defending.width) / 2)
    rows.goals.push(h.score + a.score)
    rows.shots.push(h.stats.shots + a.stats.shots)
    rows.on.push(h.stats.shotsOn + a.stats.shotsOn)
    rows.passes.push(h.stats.passes + a.stats.passes)
    rows.ok.push(h.stats.passesOk + a.stats.passesOk)
    rows.corners.push(h.stats.corners + a.stats.corners)
    rows.goalkicks.push(m.events.filter((e) => e.type === 'goalkick').length)
    rows.offsides.push(h.stats.offsides + a.stats.offsides)
    rows.fouls.push(h.stats.fouls + a.stats.fouls)
    rows.tackles.push(h.stats.tackles + a.stats.tackles)
    rows.saves.push(h.stats.saves + a.stats.saves)
    rows.km.push((h.stats.distance + a.stats.distance) / 2 / 1000)
    rows.draw.push(h.score === a.score ? 1 : 0)
    rows.nil.push(h.score === 0 && a.score === 0 ? 1 : 0)
  }
  const passAcc = mean(rows.ok) / (mean(rows.passes) || 1)
  console.log(`| ${c.label} | ${f(mean(rows.goals))} | ${f(mean(rows.shots))}（${f(mean(rows.on))}） | ${f(passAcc * 100, 0)}% | ${f(mean(rows.corners))} | ${f(mean(rows.goalkicks))} | ${f(mean(rows.offsides))} | ${f(mean(rows.fouls))} | ${f(mean(rows.tackles))} | ${f(mean(rows.saves))} | ${f(mean(rows.km))} km | ${f(mean(rows.draw) * 100, 0)}% / ${f(mean(rows.nil) * 100, 0)}% | ${f(mean(rows.ms) / 1000, 2)} 秒 |`)
  health.push(`| ${c.label} | ${out} | ${f((stack / perCase) * 100, 2)}% | ${stuck} | ${f((dead / perCase) * 100, 1)}% | ${f(mean(shapes.depth))} 米 | ${f(mean(shapes.width))} 米 |`)
}

console.log('\n健康检查（全部场次合计 / 平均）\n')
console.log('| 对阵 | 越界球员·帧 | 队友间距 < 2 米 | 球卡死次数 | 死球时间 | 主队纵深 | 主队宽度 |')
console.log('|---|---|---|---|---|---|---|')
for (const row of health) console.log(row)
