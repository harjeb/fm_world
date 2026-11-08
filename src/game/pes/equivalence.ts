/**
 * 旧引擎的“等价性语料”（docs/pes2d-migration-plan.md 阶段 1 的安全网）。
 *
 * 阶段 1 要把结算函数从 MatchEngine 里抽出去，验收标准是“同种子下旧引擎的输出逐位一致”。
 * baseline.json 的金标准每个批次只有 8 场，覆盖不到点球、红牌、头球争顶、点球大战这些少见路径；
 * 这里换一种更严的办法：几百场、多种球队和设置，对每场**最终完整状态**（日志、统计、技能计数、
 * 随机数位置、全部球员状态）取哈希。重构后任何一个概率、一次随机数消耗、一条日志的差别都会让哈希变化。
 *
 * 记录：npm run pes:equiv -- --write；核对：npm run pes:equiv。
 * 有意改了引擎（调平衡、修缺陷）后重新记录，并在提交说明里写清为什么变。
 */
import { createWorldGame } from '../world.ts'
import { MatchEngine } from '../match/engine.ts'
import { teamInputFromAI, teamInputFromLineup } from '../match/setup.ts'
import { LOGIC_MATCH_SECONDS } from '../match/time.ts'
import { BASELINE_STARTED_AT, BASELINE_WORLD_SEED } from './baseline.ts'
import type { MatchTeamInput } from '../match/types.ts'

export type EquivCase = { rules: 2 | 3; seed: number; home: number; away: number; offside: boolean; knockout: boolean }
export type EquivResult = EquivCase & { score: [number, number]; hash: string }

export const EQUIV_SEED0 = 30_000
export const EQUIV_TEAMS = 16
/** 每个规则版本的场数。v3 一场约 0.3 秒，240 场并行跑十几秒。 */
export const EQUIV_MATCHES_PER_RULES = 240

/** 对象键排序后再序列化：重构只改变属性的赋值顺序时不该报警。 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const keys = Object.keys(value as object).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
}

function fnv(text: string, seed: number): number {
  let hash = seed
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** 两个不同种子的 32 位 FNV 拼成 64 位，碰撞概率可以忽略。 */
export function hash64(text: string): string {
  return fnv(text, 2166136261).toString(16).padStart(8, '0') + fnv(text, 0x9e3779b1).toString(16).padStart(8, '0')
}

let cachedTeams: MatchTeamInput[] | null = null
function teams(): MatchTeamInput[] {
  if (!cachedTeams) {
    const game = createWorldGame(BASELINE_WORLD_SEED, undefined, undefined, BASELINE_STARTED_AT)
    const player = teamInputFromLineup(game.roster, game.lineup, { id: 'player', name: 'P', color: '#34d399', accent: '#052e1b' })
    const ai = game.aiTeams.slice(0, EQUIV_TEAMS - 1).map((team) => teamInputFromAI(team))
    cachedTeams = [player, ...ai]
    if (cachedTeams.length < EQUIV_TEAMS) throw new Error(`等价性语料需要 ${EQUIV_TEAMS} 支球队，只有 ${cachedTeams.length}`)
  }
  return cachedTeams
}

/** 固定的一组比赛：球队、越位开关、淘汰赛（会走点球大战）都轮换，两个规则版本各一份。 */
export function equivalenceCases(perRules = EQUIV_MATCHES_PER_RULES): EquivCase[] {
  const cases: EquivCase[] = []
  for (const rules of [3, 2] as const) {
    for (let index = 0; index < perRules; index++) {
      const home = index % EQUIV_TEAMS
      let away = (index * 5 + 3) % EQUIV_TEAMS
      if (away === home) away = (away + 1) % EQUIV_TEAMS
      cases.push({ rules, seed: EQUIV_SEED0 + index, home, away, offside: index % 2 === 0, knockout: index % 3 === 0 })
    }
  }
  return cases
}

export function runEquivalenceCase(spec: EquivCase): EquivResult {
  const all = teams()
  const engine = new MatchEngine({
    seed: spec.seed,
    home: structuredClone(all[spec.home]),
    away: structuredClone(all[spec.away]),
    knockout: spec.knockout,
    durationSeconds: LOGIC_MATCH_SECONDS,
    offside: spec.offside,
    recordPlayback: false,
    rulesVersion: spec.rules,
  })
  const state = engine.simulate()
  return { ...spec, score: [state.score.home, state.score.away], hash: hash64(canonical(engine.serialize())) }
}
