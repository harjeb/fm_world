import type { GameState, Lineup, MatchContext, MatchRecord, MatchTeamStats, Player } from '../types.ts'
import type { AITeam } from '../types.ts'
import type { MatchTeamInput } from './types.ts'
import { FORMATIONS } from '../data/formations.ts'
import { MatchEngine, normalizePossession } from './engine.ts'
import { PesEngine, type GameEngine } from '../pes/engine.ts'
import { aiNeedsRotation, aiRotatedLineup, autoFillLineup, validateLineup } from '../squad.ts'
import { prepareMatchInjuries } from '../injury.ts'
import { LOGIC_MATCH_SECONDS } from './time.ts'
import { matchPerformanceOf } from '../economy.ts'

export type TeamIdentity = { id: string; name: string; color: string; accent: string }

export function teamInputFromLineup(roster: Player[], lineup: Lineup, identity: TeamIdentity): MatchTeamInput {
  const check = validateLineup(roster, lineup)
  if (!check.valid) throw new Error(`阵容不合法：${check.errors.join('；')}`)
  const formation = FORMATIONS[lineup.formationId]
  const starters = lineup.starters.map((starter) => {
    const slot = formation.slots.find((item) => item.id === starter.slotId)
    const player = roster.find((item) => item.id === starter.playerId)
    if (!slot || !player) throw new Error('阵容缺少球员或位置')
    return { player, role: starter.role, slotId: starter.slotId }
  })
  const bench = lineup.bench.map((id) => {
    const player = roster.find((item) => item.id === id)
    if (!player) throw new Error('替补球员不存在')
    return player
  })
  return {
    ...identity,
    formationId: lineup.formationId,
    tactics: { ...lineup.tactics },
    starters,
    bench,
  }
}

/**
 * 电脑球队的比赛阵容。rotate：体能低于 80 的先休息（联赛用；有教练的球队按教练自己排的阵容，不传）。
 * 轮换只影响这一场，存档里的阵容不变。
 */
export function teamInputFromAI(ai: AITeam, suspended?: Set<string>, options: { rotate?: boolean } = {}): MatchTeamInput {
  const players = suspended?.size ? ai.players.filter((player) => !suspended.has(player.id)) : ai.players
  const tactics = ai.lineup?.tactics ?? ai.tactics
  const lineup = options.rotate && aiNeedsRotation(players, ai.lineup)
    ? aiRotatedLineup(players, ai.lineup?.formationId ?? ai.formationId, tactics, ai.lineup)
    : players.length === ai.players.length ? ai.lineup : autoFillLineup(players, ai.formationId, ai.tactics)
  return { ...teamInputFromLineup(players, lineup, { id: ai.id, name: ai.name, color: ai.color, accent: ai.accent }), autoSubs: { timed: [], staminaBelow: null, onInjury: true } }
}

/** 两支电脑球队的比赛（联赛、升级附加赛）：体能低于 80 的先休息（rotate 默认开）。 */
export function simulateAIvsAIState(home: AITeam, away: AITeam, seed: number, durationSeconds = LOGIC_MATCH_SECONDS, injuries?: GameState['injuries'], now = Date.now(), suspended?: Set<string>, rotate = true) {
  const engine = new MatchEngine({
    seed,
    home: teamInputFromAI(home, suspended, { rotate }),
    away: teamInputFromAI(away, suspended, { rotate }),
    knockout: false,
    durationSeconds,
    offside: false,
    // 世界后台的批量比赛不需要球场回放，避免给每支 AI 队逐帧复制坐标。
    recordPlayback: false,
    // 后台只产出赛果：用 v2 的整步模拟，避免几百场比赛按 0.1 秒重算跑位。
    // 需要展示的比赛（用户自己的联赛/友谊赛）仍走 v3。
    rulesVersion: 2,
  })
  prepareMatchInjuries(engine.state, injuries, now)
  return engine.simulate()
}

export function simulateAIvsAI(home: AITeam, away: AITeam, seed: number): { home: number; away: number } {
  return { ...simulateAIvsAIState(home, away, seed).score }
}

export function createMatchRecord(game: { season?: { index: number }; lineup: Lineup }, state: ReturnType<MatchEngine['serialize']>, context: MatchContext): MatchRecord {
  normalizePossession(state)
  const home = state.teams[0]
  const away = state.teams[1]
  const shootout = state.shootout ? { home: state.shootout.home, away: state.shootout.away } : undefined
  const playerSide = context.homeAway === 'home' ? 'home' : 'away'
  const opponentSide = playerSide === 'home' ? 'away' : 'home'
  let result: MatchRecord['result'] = 'draw'
  if (!context.isLeague && shootout) {
    result = shootout[playerSide] > shootout[opponentSide] ? 'win' : shootout[playerSide] < shootout[opponentSide] ? 'loss' : 'draw'
  } else {
    result = state.score[playerSide] > state.score[opponentSide] ? 'win' : state.score[playerSide] < state.score[opponentSide] ? 'loss' : 'draw'
  }
  const playerStats = state.teams.flatMap((team) =>
    [...team.players, ...team.bench]
      .filter((player) => player.stats.minutes > 0 || player.stats.touches > 0)
      .map((player) => ({ ...player.stats })),
  )
  const failureStats = (Object.entries(state.failures) as [keyof typeof state.failures, { count: number; examples: string[] }][]).map(
    ([reason, aggregate]) => ({ reason, count: aggregate.count, examples: [...aggregate.examples] }),
  )
  const keyTypes = new Set(['goal', 'penalty', 'save', 'block', 'foul', 'injury', 'sub', 'tactic', 'half', 'full', 'kickoff', 'setpiece'])
  const keyEvents = state.log.filter((entry) => keyTypes.has(entry.type))
  return {
    id: `m-${context.recordKey ?? context.seed}-${context.isLeague ? `L${context.round ?? 0}` : 'C'}`,
    seed: context.seed,
    createdAt: Date.now(),
    seasonIndex: game.season?.index ?? 1,
    durationSeconds: state.durationSeconds,
    isLeague: context.isLeague,
    mode: context.mode,
    stage: context.stage,
    cupId: context.cupId,
    cupFixtureId: context.cupFixtureId,
    ...(context.shootoutOffset ? { aggregateScore: { home: state.score.home + context.shootoutOffset.home, away: state.score.away + context.shootoutOffset.away } } : {}),
    round: context.round,
    homeId: home.id,
    awayId: away.id,
    homeName: home.name,
    awayName: away.name,
    score: { ...state.score },
    shootout,
    result,
    stats: {
      home: cloneStats(state.stats.home),
      away: cloneStats(state.stats.away),
    },
    playerStats,
    skillStats: state.skillStats.map((skill) => ({ ...skill })),
    failureStats,
    keyEvents: keyEvents.map((entry) => ({ ...entry })),
    commentary: state.commentary?.map((entry) => ({ ...entry, score: { ...entry.score }, ...(entry.shootoutScore ? { shootoutScore: { ...entry.shootoutScore } } : {}) })),
    goalDetails: state.log.flatMap((entry) => entry.goal ? [{ ...entry.goal, origin: { ...entry.goal.origin } }] : []),
    instructions: [...state.instructions],
    lineup: structuredClone(game.lineup),
    opponentId: context.opponentId,
  }
}

function cloneStats(stats: MatchTeamStats): MatchTeamStats {
  return { ...stats }
}

/**
 * 从比赛状态里抽出本场进球/助攻，写进 Fixture 供射手榜统计。
 * 用 sourceId（球员 ID），这样跨赛季对得回同一个人的数据。
 */
export function fixtureScorers(state: ReturnType<MatchEngine['serialize']>): {
  scorers: { playerId: string; name: string; goals: number; teamId: string }[]
  assisters: { playerId: string; name: string; assists: number; teamId: string }[]
} {
  const scorers = new Map<string, { playerId: string; name: string; goals: number; teamId: string }>()
  const assisters = new Map<string, { playerId: string; name: string; assists: number; teamId: string }>()
  for (const team of state.teams) {
    for (const player of [...team.players, ...team.bench]) {
      const id = player.stats.sourceId ?? player.sourceId
      if (player.stats.goals > 0) {
        const entry = scorers.get(id) ?? { playerId: id, name: player.name, goals: 0, teamId: team.id }
        entry.goals += player.stats.goals
        scorers.set(id, entry)
      }
      const assists = player.stats.assists ?? 0
      if (assists > 0) {
        const entry = assisters.get(id) ?? { playerId: id, name: player.name, assists: 0, teamId: team.id }
        entry.assists += assists
        assisters.set(id, entry)
      }
    }
  }
  return {
    scorers: [...scorers.values()].sort((a, b) => b.goals - a.goals),
    assisters: [...assisters.values()].sort((a, b) => b.assists - a.assists),
  }
}

/**
 * 创建一场比赛的引擎。没有指定 rulesVersion 时用新引擎（pes2d 物理 + 现有结算内核）；
 * 指定了就用对应版本的现有引擎（后台 AI 对 AI 用 v2，只要赛果）。
 */
/**
 * 比赛里按 factor 发挥的球员副本：所有比赛属性同比例打折（欠薪时 0.5）。存档里的球员不变。
 * 要在建队（校验阵容）之前替换整份名单，自定义摆位按球员对象记，用副本校验就会记到副本上。
 */
export function playersAtPerformance(players: Player[], factor: number): Player[] {
  if (!(factor > 0) || factor >= 1) return players
  return players.map((player) => ({
    ...player,
    attrs: Object.fromEntries(Object.entries(player.attrs).map(([key, value]) => [key, value * factor])) as Player['attrs'],
  }))
}

export function buildMatchEngineForGame(game: GameState, context: MatchContext, ai: AITeam, now = Date.now(), suspended?: Set<string>, rulesVersion?: number): GameEngine {
  // 欠薪：一线队在比赛里只能发挥一半（见 economy.ts）。
  const roster = playersAtPerformance(game.roster, matchPerformanceOf(game))
  const playerInput = teamInputFromLineup(roster, game.lineup, {
    id: 'player',
    name: game.clubName,
    color: '#34d399',
    accent: '#052e1b',
  })
  if (game.autoSubs) playerInput.autoSubs = structuredClone(game.autoSubs)
  // 对手是电脑球队：体能低于 80 的先休息。
  const aiInput = teamInputFromAI(ai, suspended, { rotate: true })
  if (rulesVersion === undefined) {
    const pes = new PesEngine({
      seed: context.seed,
      home: context.homeAway === 'home' ? playerInput : aiInput,
      away: context.homeAway === 'home' ? aiInput : playerInput,
      knockout: context.knockout ?? !context.isLeague,
      shootoutOffset: context.shootoutOffset,
      durationSeconds: context.durationSeconds,
      offside: context.offside ?? false,
    })
    prepareMatchInjuries(pes.state, game.injuries, now)
    return pes
  }
  const engine = new MatchEngine({
    seed: context.seed,
    home: context.homeAway === 'home' ? playerInput : aiInput,
    away: context.homeAway === 'home' ? aiInput : playerInput,
    knockout: context.knockout ?? !context.isLeague,
    shootoutOffset: context.shootoutOffset,
    durationSeconds: context.durationSeconds,
    offside: context.offside ?? false,
    ...(rulesVersion === undefined ? {} : { rulesVersion }),
  })
  prepareMatchInjuries(engine.state, game.injuries, now)
  return engine
}

