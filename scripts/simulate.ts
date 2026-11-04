import { PLAYER_SEEDS, createPlayerFromSeed } from '../src/game/data/players.ts'
import { autoFillLineup } from '../src/game/squad.ts'
import { MatchEngine, normalizePossession } from '../src/game/match/engine.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import type { FailureReason } from '../src/game/types.ts'

type Args = { matches: number; seed: number }
function parseArgs(): Args {
  let matches = 1000
  let seed = 1
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--matches=')) matches = Math.max(1, Number(arg.split('=')[1]))
    if (arg.startsWith('--seed=')) seed = Number(arg.split('=')[1])
  }
  return { matches, seed }
}

declare const process: { argv: string[]; exitCode?: number }
const { matches, seed: baseSeed } = parseArgs()
const roster = PLAYER_SEEDS.map(createPlayerFromSeed)
const lineup = autoFillLineup(roster, '1-2-3-1')
const home = teamInputFromLineup(roster, lineup, { id: 'home', name: 'Home', color: '#34d399', accent: '#052e1b' })
const away = teamInputFromLineup(roster, lineup, { id: 'away', name: 'Away', color: '#f87171', accent: '#450a0a' })

const failures: Record<FailureReason, number> = { unrecognized: 0, misjudged: 0, position_timing: 0, execution: 0 }
const skills = new Map<string, { conditions: number; applied: number }>()
let wins = 0
let draws = 0
let losses = 0
let totalShots = 0
let totalGoals = 0
let totalPasses = 0
let totalCompleted = 0
let totalPossessionHome = 0
let totalTackles = 0
let totalInterceptions = 0
let totalTurnovers = 0
let totalFouls = 0
let totalCorners = 0
let totalXg = 0
let totalSteps = 0
let totalStamina = 0
let staminaSamples = 0
let totalOnTarget = 0
let totalMissedChances = 0
const chances: Record<string, number> = {}
const chanceGoals: Record<string, number> = {}
const started = Date.now()

for (let index = 0; index < matches; index++) {
  const seed = baseSeed + index
  const engine = new MatchEngine({ seed, home, away, knockout: false })
  const state = engine.simulate()
  normalizePossession(state)
  if (state.score.home > state.score.away) wins++
  else if (state.score.home < state.score.away) losses++
  else draws++
  totalShots += state.stats.home.shots + state.stats.away.shots
  totalGoals += state.stats.home.goals + state.stats.away.goals
  totalOnTarget += state.stats.home.shotsOnTarget + state.stats.away.shotsOnTarget
  totalMissedChances += state.decisionStats.missedChances ?? 0
  for (const entry of state.log) {
    if (!entry.shotChance) continue
    chances[entry.shotChance.type] = (chances[entry.shotChance.type] ?? 0) + 1
    if (entry.type === 'goal') chanceGoals[entry.shotChance.type] = (chanceGoals[entry.shotChance.type] ?? 0) + 1
  }
  totalPasses += state.stats.home.passes + state.stats.away.passes
  totalCompleted += state.stats.home.passesCompleted + state.stats.away.passesCompleted
  totalPossessionHome += state.stats.home.possession
  totalTackles += state.stats.home.tackles + state.stats.away.tackles
  totalInterceptions += state.stats.home.interceptions + state.stats.away.interceptions
  totalTurnovers += state.stats.home.interceptions + state.stats.away.interceptions + state.stats.home.tackles + state.stats.away.tackles
  totalFouls += state.stats.home.fouls + state.stats.away.fouls
  totalCorners += state.stats.home.corners + state.stats.away.corners
  totalXg += state.stats.home.xg + state.stats.away.xg
  totalSteps += state.step
  for (const failure of Object.keys(failures) as FailureReason[]) failures[failure] += state.failures[failure].count
  for (const skill of state.skillStats) {
    const key = `${skill.side}:${skill.name}:${skill.skillId}`
    const row = skills.get(key) ?? { conditions: 0, applied: 0 }
    row.conditions += skill.conditions
    row.applied += skill.applied
    skills.set(key, row)
  }
  for (const team of state.teams) {
    for (const player of team.players) {
      if (!player.onPitch) continue
      totalStamina += (player.stamina / player.maxStamina) * 100
      staminaSamples++
    }
  }
  if (state.shootout) {
    // 联赛模拟不应出现点球；若出现说明淘汰赛参数误用。
    throw new Error('联赛模拟中出现点球大战')
  }
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1)
const rate = (value: number) => `${((value / matches) * 100).toFixed(1)}%`
console.log(`七人制比赛批量模拟 · ${matches} 场 · seed ${baseSeed}..${baseSeed + matches - 1} · ${elapsed}s`)
console.log('—'.repeat(72))
const decisive = wins + losses
const homeShare = decisive > 0 ? wins / decisive : 0
const ci = decisive > 0 ? 1.96 * Math.sqrt((homeShare * (1 - homeShare)) / decisive) : 0
console.log(`主胜 ${wins} (${rate(wins)}) / 平 ${draws} (${rate(draws)}) / 客胜 ${losses} (${rate(losses)})`)
console.log(`剔除平局后的主胜率 ${(homeShare * 100).toFixed(1)}% ± ${(ci * 100).toFixed(1)}%（95% CI，n=${decisive}）`)
console.log(`场均总射门 ${(totalShots / matches).toFixed(2)} · 射正 ${(totalOnTarget / matches).toFixed(2)} · 总进球 ${(totalGoals / matches).toFixed(2)} · 射门转化 ${totalShots ? ((totalGoals / totalShots) * 100).toFixed(1) : '—'}%`)
console.log(`射正率 ${totalShots ? ((totalOnTarget / totalShots) * 100).toFixed(1) : '—'}% · 好机会放弃起脚 ${(totalMissedChances / matches).toFixed(2)}/场`)
console.log(`机会类型（次数 / 进球）: ${Object.keys(chances).sort().map((key) => `${key}=${chances[key]}/${chanceGoals[key] ?? 0}`).join(' · ')}`)
console.log(`场均传球 ${(totalPasses / matches).toFixed(1)} · 成功率 ${totalPasses ? ((totalCompleted / totalPasses) * 100).toFixed(1) : '—'}% · 场均 xG ${(totalXg / matches).toFixed(2)}`)
console.log(`主队平均控球 ${(totalPossessionHome / matches).toFixed(1)}% · 场均抢断 ${(totalTackles / matches).toFixed(1)} · 拦截 ${(totalInterceptions / matches).toFixed(1)} · 转换 ${(totalTurnovers / matches).toFixed(1)} · 犯规 ${(totalFouls / matches).toFixed(1)} · 角球 ${(totalCorners / matches).toFixed(1)}`)
console.log(`场均步数 ${(totalSteps / matches).toFixed(0)} · 终场平均体力 ${staminaSamples ? (totalStamina / staminaSamples).toFixed(1) : '—'}%`)
console.log(`失败原因 ${Object.entries(failures).map(([key, value]) => `${key}=${value}`).join(' · ')}`)
const topSkills = [...skills.entries()].sort((a, b) => b[1].conditions - a[1].conditions).slice(0, 12)
console.log('技能触发（条件 / 生效）:')
for (const [key, value] of topSkills) console.log(`  ${key}: ${value.conditions} / ${value.applied}`)
if (totalShots / matches < 18 || totalShots / matches > 30) {
  console.warn('⚠ 场均射门不在方案目标 18~30 区间，请继续调参。')
}
if (totalGoals / matches < 2 || totalGoals / matches > 5) {
  console.warn('⚠ 场均总进球不在方案目标 2~5 区间，请继续调参。')
}
if (decisive > 0 && Math.abs(homeShare - 0.5) > ci) {
  console.warn('⚠ 剔除平局后的主客胜率在 95% CI 外明显偏离 50%，请检查主客不对称。')
}
console.log('—'.repeat(72))
console.log('提示：本脚本固定同阵容镜像，不含战术/球员差异；用于验证引擎平衡与随机性，不作为真实对局强度结论。')
