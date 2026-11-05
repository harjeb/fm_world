/**
 * 对比「给判定加回合」和「给画面加运动层」两条路线的成本。
 *
 *   npm run match:motion
 *
 * 输出：
 *   - 一场比赛现有的判定步数与每步占用的播放时间；
 *   - 10 Hz 运动层铺满整场需要的 tick 数（= 判定步数之外的纯动画采样）；
 *   - 引擎每步的实测耗时，以及把判定做到 10 Hz 需要多少倍 CPU；
 *   - 现有每步的进球/射门率，说明为什么不能直接把判定乘 40。
 */
import { createInitialGame } from '../src/game/state.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { LOGIC_MATCH_SECONDS } from '../src/game/match/time.ts'
import { motionTicksForFrames, motionProfileOf, MOTION_TICK_HZ } from '../src/game/match/motion.ts'

const seeds = Array.from({ length: 8 }, (_, index) => 2024 + index)

type Row = {
  seed: number
  steps: number
  logicalSeconds: number
  goals: number
  shots: number
  milliseconds: number
  /** 直接按“起点→终点”匀速滑行时，有多少段超过球员本场的最高速度。 */
  overSpeedSegments: number
  segments: number
  /** 超速最严重的一段是最高速度的几倍。 */
  worstSpeedRatio: number
}

const rows: Row[] = []
for (const seed of seeds) {
  const game = createInitialGame(seed)
  const input = teamInputFromLineup(game.roster, game.lineup, { id: 'player', name: game.clubName, color: '#34d399', accent: '#052e1b' })
  const started = performance.now()
  const engine = new MatchEngine({ seed, home: input, away: structuredClone(input), knockout: false, durationSeconds: LOGIC_MATCH_SECONDS })
  const state = engine.simulate()
  const milliseconds = performance.now() - started
  const profiles = new Map(state.teams.flatMap((team) => team.players.map((player) => [player.id, motionProfileOf({
    speed: player.attrs.speed,
    acceleration: player.attrs.acceleration,
    agility: player.attrs.agility,
    stamina: player.stamina / Math.max(1, player.maxStamina),
  })] as const)))
  let overSpeedSegments = 0
  let segments = 0
  let worstSpeedRatio = 0
  for (const frame of state.playbackFrames ?? []) {
    const from = new Map(frame.from.players.map((player) => [player.id, player]))
    const seconds = Math.max(1e-6, frame.to.clock - frame.from.clock)
    for (const player of frame.to.players) {
      const start = from.get(player.id)
      if (!start) continue
      const cap = profiles.get(player.id)?.maxSpeed
      if (!cap) continue
      segments++
      const ratio = Math.hypot(player.x - start.x, player.y - start.y) / seconds / cap
      if (ratio > 1) overSpeedSegments++
      worstSpeedRatio = Math.max(worstSpeedRatio, ratio)
    }
  }
  rows.push({
    seed,
    steps: state.step,
    logicalSeconds: state.clock,
    goals: state.score.home + state.score.away,
    shots: state.stats.home.shots + state.stats.away.shots,
    milliseconds,
    overSpeedSegments,
    segments,
    worstSpeedRatio,
  })
}

const mean = (pick: (row: Row) => number) => rows.reduce((sum, row) => sum + pick(row), 0) / rows.length
const steps = mean((row) => row.steps)
const logical = mean((row) => row.logicalSeconds)
const goals = mean((row) => row.goals)
const shots = mean((row) => row.shots)
const ms = mean((row) => row.milliseconds)
const secondsPerStep = logical / steps
const ticks = Math.round(logical * MOTION_TICK_HZ)
// 只用“步数 × 每步逻辑秒数”估算：每一步按平均时长铺 10 Hz。
const sampleTicks = rows.length ? motionTicksForFrames([{ from: { clock: 0 }, to: { clock: 1 } }]) * steps * secondsPerStep : 0

const report = {
  games: rows.length,
  decisionsPerMatch: Number(steps.toFixed(1)),
  logicalSecondsPerMatch: Number(logical.toFixed(1)),
  displaySecondsPerDecision: Number(secondsPerStep.toFixed(2)),
  motionTicksPerMatch: ticks,
  motionTicksOverDecisions: Number((ticks / steps).toFixed(1)),
  engineMillisecondsPerMatch: Number(ms.toFixed(1)),
  engineMillisecondsPerDecision: Number((ms / steps).toFixed(3)),
  goalsPerDecision: Number((goals / steps).toFixed(4)),
  shotsPerDecision: Number((shots / steps).toFixed(3)),
  /** 把判定做成 10 Hz 需要的决策数（900 秒 × 10）。 */
  decisionsIfTenHertz: ticks,
  /** 判定乘 40 后，按现在的每步进球率会得到多少球（仅说明量级）。 */
  goalsIfDecisionRateScaled: Number((goals * (ticks / steps)).toFixed(0)),
  /** 判定乘 40 后预计的引擎耗时。 */
  engineSecondsIfDecisionRateScaled: Number(((ms * (ticks / steps)) / 1000).toFixed(1)),
  sampleFrameTicks: sampleTicks,
  /** 旧画法（两个判定之间匀速直线）里，超过球员最高速度的位移段占比。 */
  overSpeedSegmentShare: Number((mean((row) => row.overSpeedSegments) / mean((row) => row.segments)).toFixed(3)),
  worstSpeedRatio: Number(mean((row) => row.worstSpeedRatio).toFixed(2)),
  seeds: rows.map((row) => ({ seed: row.seed, steps: row.steps, goals: row.goals, shots: row.shots, ms: Number(row.milliseconds.toFixed(1)) })),
}

console.log(JSON.stringify(report, null, 2))
