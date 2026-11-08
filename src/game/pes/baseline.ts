/**
 * 现有比赛引擎的基线（docs/pes2d-migration-plan.md 阶段 0）。
 *
 * 用途：
 * 1. 新引擎校准时对照的“现有水平”：进球、射门、传球、抢断、犯规、控球、xG，以及对实力差的敏感度。
 * 2. 阶段 1（结算内核抽取）的安全网：同种子下旧引擎的比分、统计、日志必须与重构前逐位一致（golden）。
 *
 * 采集脚本：npm run pes:baseline（scripts/pes-baseline.ts），结果在 src/game/pes/baseline.json。
 * 这个文件只被脚本和测试引用，不会进入游戏的打包。
 */
import { createWorldGame } from '../world.ts'
import { MatchEngine, normalizePossession } from '../match/engine.ts'
import { teamInputFromLineup } from '../match/setup.ts'
import { LOGIC_MATCH_SECONDS } from '../match/time.ts'
import { attrMax, attrStorage } from '../scale.ts'
import { ALL_ATTRIBUTES } from '../types.ts'
import type { MatchState, MatchTeamInput } from '../match/types.ts'
import type { AttrKey } from '../types.ts'

/** 固定世界种子和起始时间：`createWorldGame` 默认用 `Date.now()`，基线必须可重复。 */
export const BASELINE_WORLD_SEED = 2024
export const BASELINE_STARTED_AT = 0
/** 后台 AI 对 AI 用 v2，展示给玩家的比赛用 v3（src/game/match/setup.ts）。 */
export type BaselineRules = 2 | 3
export const BASELINE_RULES: readonly BaselineRules[] = [3, 2]
/** 客队全部属性 ×系数：1 = 镜像，0.93 ≈ 低 7%，0.87 ≈ 低 13%（计划 3.3、第 9 节的敏感度带用这两档）。 */
export const BASELINE_FACTORS: readonly number[] = [1, 0.93, 0.87]
export const BASELINE_SEED0 = 7000
export const BASELINE_MATCHES = 200
export const GOLDEN_MATCHES = 8

export type BatchSpec = { rules: BaselineRules; awayFactor: number; n: number; seed0: number }
/** 每场比赛的摘要：golden 用，数值保留 4 位小数避免跨平台浮点噪声。 */
export type MatchSummary = {
  seed: number
  score: [number, number]
  stats: Record<'home' | 'away', Record<string, number>>
  logLength: number
  logHash: string
  logTypes: Record<string, number>
}
export type BatchResult = {
  rules: BaselineRules
  awayFactor: number
  n: number
  seed0: number
  results: {
    homeWins: number
    draws: number
    awayWins: number
    /** 每场平均，主队 / 客队 / 合计 */
    goals: [number, number, number]
    shots: [number, number, number]
    shotsOnTarget: [number, number, number]
    xg: [number, number, number]
    passes: [number, number, number]
    passesCompleted: [number, number, number]
    passAccuracyPct: [number, number]
    tackles: [number, number, number]
    interceptions: [number, number, number]
    fouls: [number, number, number]
    corners: [number, number, number]
    yellowCards: [number, number, number]
    redCards: [number, number, number]
    possessionPct: [number, number]
    distanceKm: [number, number, number]
    scoreless: number
    maxTotalGoals: number
    /** 日志里各类事件每场平均条数 */
    logTypes: Record<string, number>
  }
  golden: MatchSummary[]
}

const round = (value: number, digits = 4) => {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function fnv1a(text: string): string {
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

let cachedGame: ReturnType<typeof createWorldGame> | null = null
function baselineGame() {
  cachedGame ??= createWorldGame(BASELINE_WORLD_SEED, undefined, undefined, BASELINE_STARTED_AT)
  return cachedGame
}

/** 主队用世界种子 2024 里玩家球队的阵容；客队是同一支球队，全部属性乘以系数。 */
export function baselineTeams(awayFactor: number): { home: MatchTeamInput; away: MatchTeamInput } {
  const game = baselineGame()
  const home = teamInputFromLineup(game.roster, game.lineup, { id: 'home', name: 'H', color: '#34d399', accent: '#052e1b' })
  const roster = game.roster.map((player) => {
    const copy = structuredClone(player)
    for (const key of ALL_ATTRIBUTES) copy.attrs[key] = Math.max(1, Math.min(1500, Math.round(copy.attrs[key] * awayFactor)))
    return copy
  })
  const away = teamInputFromLineup(roster, game.lineup, { id: 'away', name: 'A', color: '#f87171', accent: '#450a0a' })
  return { home, away }
}

export function simulateOne(rules: BaselineRules, seed: number, home: MatchTeamInput, away: MatchTeamInput): MatchSummary {
  const engine = new MatchEngine({ seed, home, away, knockout: false, durationSeconds: LOGIC_MATCH_SECONDS, offside: false, recordPlayback: false, rulesVersion: rules })
  const state: MatchState = engine.simulate()
  normalizePossession(state)
  const logTypes: Record<string, number> = {}
  for (const entry of state.log) logTypes[entry.type] = (logTypes[entry.type] ?? 0) + 1
  const pick = (side: 'home' | 'away') => {
    const stats: Record<string, number> = {}
    for (const [key, value] of Object.entries(state.stats[side])) if (typeof value === 'number') stats[key] = round(value)
    return stats
  }
  return {
    seed,
    score: [state.score.home, state.score.away],
    stats: { home: pick('home'), away: pick('away') },
    logLength: state.log.length,
    logHash: fnv1a(JSON.stringify(state.log.map((entry) => [entry.seq, entry.clock, entry.type, entry.team, entry.text]))),
    logTypes,
  }
}

export function runBatch(spec: BatchSpec): BatchResult {
  const { home, away } = baselineTeams(spec.awayFactor)
  const matches: MatchSummary[] = []
  for (let index = 0; index < spec.n; index++) matches.push(simulateOne(spec.rules, spec.seed0 + index, structuredClone(home), structuredClone(away)))
  const mean = (read: (match: MatchSummary) => number) => round(matches.reduce((sum, match) => sum + read(match), 0) / matches.length, 3)
  const triple = (key: string): [number, number, number] => [mean((m) => m.stats.home[key] ?? 0), mean((m) => m.stats.away[key] ?? 0), mean((m) => (m.stats.home[key] ?? 0) + (m.stats.away[key] ?? 0))]
  const sum = (side: 'home' | 'away', key: string) => matches.reduce((total, match) => total + (match.stats[side][key] ?? 0), 0)
  const typeKeys = [...new Set(matches.flatMap((match) => Object.keys(match.logTypes)))].sort()
  const logTypes: Record<string, number> = {}
  for (const key of typeKeys) logTypes[key] = mean((m) => m.logTypes[key] ?? 0)
  const possessionHome = mean((m) => m.stats.home.possession ?? 0)
  return {
    rules: spec.rules,
    awayFactor: spec.awayFactor,
    n: spec.n,
    seed0: spec.seed0,
    results: {
      homeWins: matches.filter((m) => m.score[0] > m.score[1]).length,
      draws: matches.filter((m) => m.score[0] === m.score[1]).length,
      awayWins: matches.filter((m) => m.score[0] < m.score[1]).length,
      goals: triple('goals'),
      shots: triple('shots'),
      shotsOnTarget: triple('shotsOnTarget'),
      xg: triple('xg'),
      passes: triple('passes'),
      passesCompleted: triple('passesCompleted'),
      passAccuracyPct: [round((sum('home', 'passesCompleted') / Math.max(1, sum('home', 'passes'))) * 100, 1), round((sum('away', 'passesCompleted') / Math.max(1, sum('away', 'passes'))) * 100, 1)],
      tackles: triple('tackles'),
      interceptions: triple('interceptions'),
      fouls: triple('fouls'),
      corners: triple('corners'),
      yellowCards: triple('yellowCards'),
      redCards: triple('redCards'),
      possessionPct: [possessionHome, round(100 - possessionHome, 1)],
      distanceKm: [round(mean((m) => m.stats.home.distance ?? 0) / 1000, 2), round(mean((m) => m.stats.away.distance ?? 0) / 1000, 2), round((mean((m) => m.stats.home.distance ?? 0) + mean((m) => m.stats.away.distance ?? 0)) / 1000, 2)],
      scoreless: matches.filter((m) => m.score[0] + m.score[1] === 0).length,
      maxTotalGoals: Math.max(...matches.map((m) => m.score[0] + m.score[1])),
      logTypes,
    },
    golden: matches.slice(0, GOLDEN_MATCHES),
  }
}

/* ------------------------------ 逐属性敏感度（可选，较慢） ------------------------------ */

export const ATTR_GK_ONLY: readonly AttrKey[] = ['reflexes', 'handling', 'rushing', 'oneOnOne']
export const ATTR_JOBS: readonly { attr: AttrKey; delta: number }[] = ALL_ATTRIBUTES.flatMap((attr) => [20, -20].map((delta) => ({ attr, delta })))

/** 主队全体（门将属性只改门将）某个属性 ±delta 个评分点，客队不变。 */
export function runAttrJob(attr: AttrKey | null, delta: number, n: number, seed0: number, rules: BaselineRules = 3) {
  const game = baselineGame()
  const gkAttr = attr !== null && ATTR_GK_ONLY.includes(attr)
  const roster = game.roster.map((player) => {
    const copy = structuredClone(player)
    const gk = copy.positions.GK > 0
    if (attr !== null && (gkAttr ? gk : !gk)) {
      copy.attrs[attr] = Math.max(1, Math.min(attrMax(attr, gk), copy.attrs[attr] + attrStorage(attr, delta, gk)))
    }
    return copy
  })
  const home = teamInputFromLineup(roster, game.lineup, { id: 'home', name: 'H', color: '#34d399', accent: '#052e1b' })
  const away = teamInputFromLineup(game.roster, game.lineup, { id: 'away', name: 'A', color: '#f87171', accent: '#450a0a' })
  const diffs: number[] = []
  let goalsHome = 0
  let goalsAway = 0
  let shotsDiff = 0
  let tackleDiff = 0
  for (let index = 0; index < n; index++) {
    const match = simulateOne(rules, seed0 + index, structuredClone(home), structuredClone(away))
    diffs.push(match.score[0] - match.score[1])
    goalsHome += match.score[0]
    goalsAway += match.score[1]
    shotsDiff += (match.stats.home.shots ?? 0) - (match.stats.away.shots ?? 0)
    tackleDiff += (match.stats.home.tackles ?? 0) - (match.stats.away.tackles ?? 0)
  }
  const avg = diffs.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(diffs.reduce((a, b) => a + (b - avg) ** 2, 0) / Math.max(1, n - 1))
  return {
    attr,
    delta,
    n,
    goalDiff: round(avg, 3),
    se: round(sd / Math.sqrt(n), 3),
    goalsHome: round(goalsHome / n, 3),
    goalsAway: round(goalsAway / n, 3),
    shotsDiff: round(shotsDiff / n, 3),
    tackleDiff: round(tackleDiff / n, 3),
  }
}
