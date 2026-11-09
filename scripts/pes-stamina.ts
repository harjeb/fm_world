/**
 * PES 比赛体力标定：旧消耗 vs 当前消耗，同阵容、同种子、满体力、关自动换人。
 * 每档逐场串行运行，避免批量模拟占满服务器；不创建账号、不读写存档。
 *
 *   npm run pes:stamina                   每个阵型每档 6 场，默认 D = 900
 *   npm run pes:stamina -- --n 10 --d 450  换压缩时长验证整场消耗
 */
import { baselineTeams } from '../src/game/pes/baseline.ts'
import { PesGame } from '../src/game/pes/game.ts'
import { GAME_FATIGUE_PER_METER } from '../src/game/pes/spec.ts'
import { autoFillLineup } from '../src/game/squad.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { LOGIC_MATCH_SECONDS } from '../src/game/match/time.ts'
import type { MatchTeamInput } from '../src/game/match/types.ts'
import type { FormationId } from '../src/game/types.ts'

function option(name: string, fallback: number): number {
  const at = process.argv.indexOf(`--${name}`)
  if (at < 0) return fallback
  const value = Number(process.argv[at + 1])
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`--${name} 需要正整数`)
  return value
}

const n = option('n', 6)
const duration = option('d', LOGIC_MATCH_SECONDS)
const formations: FormationId[] = ['1-3-2-1', '1-2-3-1', '1-2-2-2']
const baseline = baselineTeams(1)
const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)

function input(source: MatchTeamInput, formation: FormationId): MatchTeamInput {
  const players = structuredClone([...source.starters.map((starter) => starter.player), ...source.bench])
  for (const player of players) player.condition = 100
  const lineup = autoFillLineup(players, formation, source.tactics)
  return { ...teamInputFromLineup(players, lineup, source), autoSubs: { timed: [], staminaBelow: null, onInjury: false } }
}

console.log(`显示 90 分钟 / 模拟 ${duration} 秒；每档 ${n} 场；仅统计踢满全场的外场球员（排除红牌 / 换下）`)
console.log('| 阵型 | 系数 | 半场前剩余 | 终场剩余 | 消耗 | 终场范围 | 门将剩余 | 样本人数 |')
console.log('|---|---|---:|---:|---:|---:|---:|---:|')
for (const formation of formations) {
  for (const [label, rate] of [['旧', 2e-4], ['新', GAME_FATIGUE_PER_METER]] as const) {
    const half: number[] = [], final: number[] = [], keepers: number[] = []
    for (let index = 0; index < n; index++) {
      const game = new PesGame({
        seed: 101 + index,
        home: input(baseline.home, formation),
        away: input(baseline.away, formation),
        durationSeconds: duration,
        rules: { fatiguePerMeter: rate },
      })
      let halfTaken = false
      while (!game.finished) {
        game.step()
        // 中场前取样，单独保留原有的中场 +5% 恢复。
        if (!halfTaken && game.match.time >= duration / 2 - 2 * game.match.spec.DT) {
          half.push(...game.match.teams.flatMap((team) => team.players).filter((player) => player.role !== 'GK').map((player) => player.stamina * 100))
          halfTaken = true
        }
      }
      for (const player of game.state.teams.flatMap((team) => team.players)) {
        if (player.sentOff || player.stats.minutes < 89.99) continue
        ;(player.position === 'GK' ? keepers : final).push(player.stats.staminaLeft)
      }
    }
    const range = final.length ? `${Math.min(...final)}–${Math.max(...final)}%` : '—'
    console.log(`| ${formation} | ${label} ${rate} | ${mean(half).toFixed(1)}% | ${mean(final).toFixed(1)}% | ${(100 - mean(final)).toFixed(1)}% | ${range} | ${mean(keepers).toFixed(1)}% | ${final.length} |`)
  }
}
