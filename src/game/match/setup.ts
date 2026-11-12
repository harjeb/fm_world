import type { Chemistry, GameState, Lineup, MatchContext, MatchRecord, MatchTeamStats, Player } from '../types.ts'
import { chemistrySnapshot } from '../chemistry.ts'
import { GAME_DAY_MS } from '../calendar.ts'
import type { AITeam } from '../types.ts'
import type { MatchTeamInput } from './types.ts'
import { FORMATIONS } from '../data/formations.ts'
import { MatchEngine, normalizePossession } from './engine.ts'
import { PesEngine, type GameEngine } from '../pes/engine.ts'
import { cloneInstructions, instructionsFromLegacyTactics, legacyTacticsFromInstructions } from '../pes/tactics.ts'
import { aiNeedsRotation, aiRotatedLineup, autoFillLineup, computeLineupFamiliarity, validateLineup } from '../squad.ts'
import { applyAITacticsToLineup, defaultAIAutoSubs, defaultAITacticsStage } from '../ai-tactics.ts'
import { prepareMatchInjuries } from '../injury.ts'
import { LOGIC_MATCH_SECONDS } from './time.ts'
import { matchPerformanceOf } from '../economy.ts'

export type TeamIdentity = { id: string; name: string; color: string; accent: string }

export function withChemistry(input: MatchTeamInput, store: Chemistry | undefined, now: number, gameDayMs = GAME_DAY_MS): MatchTeamInput {
  const scores = chemistrySnapshot(store, [...input.starters.map(p => p.player.id), ...input.bench.map(p => p.id)], now, gameDayMs)
  if (Object.keys(scores).length) input.chemistry = scores
  return input
}

export function teamInputFromLineup(
  roster: Player[],
  lineup: Lineup,
  identity: TeamIdentity,
  options?: { tacticsStage?: number },
): MatchTeamInput {
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
  const activePlan = lineup.matchPlan && lineup.matchPlan !== 'standard' ? lineup.matchPlan : undefined
  const instructions = lineup.tacticalInstructions
    ? cloneInstructions(lineup.tacticalInstructions)
    : activePlan
      ? instructionsFromLegacyTactics(lineup.tactics)
      : undefined
  const tactics = instructions ? legacyTacticsFromInstructions(instructions) : { ...lineup.tactics }
  return {
    ...identity,
    formationId: lineup.formationId,
    tactics,
    ...(activePlan ? { matchPlan: activePlan } : {}),
    ...(instructions
      ? {
          ...(lineup.tacticalStyle ? { tacticalStyle: lineup.tacticalStyle } : {}),
          instructions,
          familiarity: computeLineupFamiliarity(roster, lineup, options?.tacticsStage ?? 1),
        }
      : {}),
    starters,
    bench,
  }
}

/**
 * 电脑球队（或 AI 接管球队）这一场的首发和替补。rotate：体能低于 80 或受伤的先休息（联赛用；在线教练自己排的阵容不传）。
 * 轮换只影响这一场，存档里的阵容不变。停赛的人先剔除；剔除后阵容不完整时也按轮换重排
 * （不能退回“只看实力”的自动填充，否则体能低的人会被排进首发）。
 */
export function aiMatchLineup(ai: AITeam, suspended?: Set<string>, rotate = false, injured?: ReadonlySet<string>): Lineup {
  const players = suspended?.size ? ai.players.filter((player) => !suspended.has(player.id)) : ai.players
  const tactics = ai.lineup?.tactics ?? ai.tactics
  const intact = players.length === ai.players.length || validateLineup(players, ai.lineup).valid
  if (rotate && (!intact || aiNeedsRotation(players, ai.lineup, injured))) {
    return aiRotatedLineup(players, ai.lineup?.formationId ?? ai.formationId, tactics, ai.lineup, injured)
  }
  return intact ? ai.lineup : autoFillLineup(players, ai.formationId, ai.tactics)
}

/** 电脑球队（或锁定比赛阵容）的比赛输入（见 aiMatchLineup）。 */
export function teamInputFromAI(
  ai: AITeam,
  suspended?: Set<string>,
  options: {
    rotate?: boolean
    tacticsStage?: number
    injured?: ReadonlySet<string>
    aiCoach?: boolean
    preserveLineupTactics?: boolean
  } = {},
): MatchTeamInput {
  const aiCoach = options.aiCoach ?? true
  const players = suspended?.size ? ai.players.filter((player) => !suspended.has(player.id)) : ai.players
  const baseLineup = aiMatchLineup(ai, suspended, options.rotate, options.injured)
  let effectiveLineup = baseLineup
  if (aiCoach && !options.preserveLineupTactics && (baseLineup !== ai.lineup || !baseLineup.tacticalInstructions)) {
    effectiveLineup = baseLineup === ai.lineup ? structuredClone(baseLineup) : baseLineup
    applyAITacticsToLineup(effectiveLineup, {
      players,
      clubStyle: ai.style,
      seedTactics: ai.tactics,
      strength: ai.strength,
      tier: ai.tier,
    })
  }
  const tacticsStage = options.tacticsStage ?? (aiCoach ? defaultAITacticsStage({ ...ai, players, lineup: effectiveLineup }) : 1)
  return {
    ...teamInputFromLineup(players, effectiveLineup, { id: ai.id, name: ai.name, color: ai.color, accent: ai.accent }, { tacticsStage }),
    ...(aiCoach
      ? { aiCoach: true, autoSubs: defaultAIAutoSubs() }
      : { autoSubs: { timed: [], staminaBelow: null, onInjury: true } }),
  }
}

/** 两支电脑球队的比赛（联赛、升级附加赛）：体能低于 80 的先休息（rotate 默认开）。 */
export function simulateAIvsAIState(home: AITeam, away: AITeam, seed: number, durationSeconds = LOGIC_MATCH_SECONDS, injuries?: GameState['injuries'], now = Date.now(), suspended?: Set<string>, rotate = true, chemistry?: Chemistry, gameDayMs = GAME_DAY_MS) {
  const engine = new MatchEngine({
    seed,
    home: withChemistry(teamInputFromAI(home, suspended, { rotate }), chemistry, now, gameDayMs),
    away: withChemistry(teamInputFromAI(away, suspended, { rotate }), chemistry, now, gameDayMs),
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

/** 挑战赛不继承赛前体能，也不让赛前伤病标记进入比赛。 */
function playersAtFullCondition(players: Player[]): Player[] {
  return players.map((player) => ({ ...player, condition: 100 }))
}

export function buildMatchEngineForGame(game: GameState, context: MatchContext, ai: AITeam, now = Date.now(), suspended?: Set<string>, rulesVersion?: number): GameEngine {
  // 欠薪：一线队在比赛里只能发挥一半（见 economy.ts）。
  const challenge = !context.isLeague
  const baseRoster = playersAtPerformance(game.roster, matchPerformanceOf(game))
  // 所有非联赛挑战都从满状态开始；联赛仍按存档体能。
  const roster = challenge ? playersAtFullCondition(baseRoster) : baseRoster

  const playerInput = teamInputFromLineup(
    roster,
    game.lineup,
    {
      id: 'player',
      name: game.clubName,
      color: '#34d399',
      accent: '#052e1b',
    },
    { tacticsStage: game.economy?.tactics ?? 1 },
  )
  if (game.autoSubs) playerInput.autoSubs = structuredClone(game.autoSubs)
  // 对手是电脑球队：体能低于 80 的先休息，并按俱乐部战术室阶段（或阵容强度估算）计算战术熟练度。
  const aiClubTactics = game.aiClubs?.[ai.id]?.economy.tactics
  const aiInput = teamInputFromAI(ai, suspended, { rotate: true, tacticsStage: aiClubTactics })
  withChemistry(playerInput, game.chemistry, now, game.season.gameDayMs)
  withChemistry(aiInput, game.chemistry, now, game.season.gameDayMs)
  if (rulesVersion === undefined) {
    const pes = new PesEngine({
      seed: context.seed,
      home: context.homeAway === 'home' ? playerInput : aiInput,
      away: context.homeAway === 'home' ? aiInput : playerInput,
      knockout: context.knockout ?? (!context.isLeague && !context.allowDraw),
      shootoutOffset: context.shootoutOffset,
      durationSeconds: context.durationSeconds,
      offside: context.offside ?? false,
      noInjuries: context.noInjuries ?? challenge,
    })
    if (!challenge && !context.noInjuries) prepareMatchInjuries(pes.state, game.injuries, now)
    return pes
  }
  const engine = new MatchEngine({
    seed: context.seed,
    home: context.homeAway === 'home' ? playerInput : aiInput,
    away: context.homeAway === 'home' ? aiInput : playerInput,
    knockout: context.knockout ?? (!context.isLeague && !context.allowDraw),
    shootoutOffset: context.shootoutOffset,
    durationSeconds: context.durationSeconds,
    offside: context.offside ?? false,
    noInjuries: context.noInjuries ?? challenge,
    ...(rulesVersion === undefined ? {} : { rulesVersion }),
  })
  if (!challenge && !context.noInjuries) prepareMatchInjuries(engine.state, game.injuries, now)
  return engine
}

