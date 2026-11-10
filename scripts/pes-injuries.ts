/**
 * 联赛 2D 伤病整场校准：相同阵容 / 种子分别用原概率和当前折扣，比较满体能与低体能入场。
 * npm run pes:injuries -- --n 100 --seed 9000
 * 每档 n 对比赛，均完整模拟 90 分钟；不继承上一场的伤病或体能，避免污染对照。
 */
import { buildMatchEngineForGame } from '../src/game/match/setup.ts'
import { LOGIC_MATCH_SECONDS } from '../src/game/match/time.ts'
import { PesEngine } from '../src/game/pes/engine.ts'
import { PesGame } from '../src/game/pes/game.ts'
import { DEFAULT_TUNING, type PesSettlementJSON } from '../src/game/pes/settle.ts'
import { createInitialGame } from '../src/game/state.ts'
import type { MatchContext } from '../src/game/types.ts'

function option(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`)
  if (index < 0) return fallback
  const value = Number(process.argv[index + 1])
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${name} 需要一个正整数`)
  return value
}

const n = option('n', 100)
const seed0 = option('seed', 9000)
const started = performance.now()
const template = createInitialGame(12)
const totals = () => ({ injuries: 0, injuredMatches: 0, max: 0, tackles: 0, fouls: 0 })
console.log(`2D 联赛伤病校准：D=${LOGIC_MATCH_SECONDS}，每档 ${n} 对整场比赛，种子 ${seed0}–${seed0 + n - 1}`)
console.log(`世界种子 12，轮换对阵 ${template.aiTeams.length} 支 AI 球队；当前伤病系数 ${DEFAULT_TUNING.injuryRate}。`)
console.log('| 入场体能 | 概率系数 | 受伤总人次 | 人次 / 场 | 有伤病场次 | 单场最多 | 抢断 / 场 | 犯规 / 场 |')
console.log('|---|---|---|---|---|---|---|---|')

for (const condition of [100, 30]) {
  const game = structuredClone(template)
  for (const player of [...game.roster, ...game.aiTeams.flatMap((team) => team.players)]) player.condition = condition
  const before = totals(), after = totals()
  for (let i = 0; i < n; i++) {
    const opponent = game.aiTeams[i % game.aiTeams.length]
    const context: MatchContext = {
      isLeague: true, opponentId: opponent.id, opponentName: opponent.name,
      seed: seed0 + i, homeAway: i % 2 ? 'away' : 'home', durationSeconds: LOGIC_MATCH_SECONDS,
    }
    const engine = buildMatchEngineForGame(game, context, opponent, 0)
    if (!(engine instanceof PesEngine)) throw new Error('校准需要 2D 引擎')
    const snapshot = engine.game.serialize()
    ;(snapshot.contact as PesSettlementJSON).extra.tuning.injuryRate = 1
    const original = PesGame.restore(snapshot)
    for (const [match, total] of [[original, before], [engine.game, after]] as const) {
      const state = match.run()
      if (!state.finished || state.clock !== LOGIC_MATCH_SECONDS) throw new Error('比赛未完整结束')
      const injuries = state.log.filter((entry) => entry.type === 'injury').length
      total.injuries += injuries
      total.injuredMatches += Number(injuries > 0)
      total.max = Math.max(total.max, injuries)
      total.tackles += state.stats.home.tackles + state.stats.away.tackles
      total.fouls += state.stats.home.fouls + state.stats.away.fouls
    }
  }
  for (const [rate, total] of [[1, before], [DEFAULT_TUNING.injuryRate, after]] as const) {
    console.log(`| ${condition}% | ${rate} | ${total.injuries} | ${(total.injuries / n).toFixed(3)} | ${total.injuredMatches} / ${n} | ${total.max} | ${(total.tackles / n).toFixed(2)} | ${(total.fouls / n).toFixed(2)} |`)
  }
  console.log(`入场体能 ${condition}%：整场伤病人次为原来的 ${before.injuries ? (after.injuries / before.injuries * 100).toFixed(1) + '%' : 'N/A（原概率无伤病）'}。`)
}
console.log(`耗时 ${((performance.now() - started) / 1000).toFixed(1)} 秒。单次概率降至 1/4，不代表整场人次必然精确降至 1/4（受抽样、受伤后的比赛进程及换人影响）。`)
