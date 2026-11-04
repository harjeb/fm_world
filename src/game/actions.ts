import type { AutoSubPlan, GameState, Lineup, MatchMentality, MatchRecord, TrainingExchange, TrainingSession } from './types.ts'
import type { MatchEngine } from './match/engine.ts'
import { MatchEngine as Engine } from './match/engine.ts'
import type { MatchState } from './match/types.ts'
import { createTrainingSession, planTraining, performTrainingAction, trainingActionsTotal, resolveTrainingEvent, confirmCandidate, discardCandidate, TRAINING_ENERGY_COST, type PerformResult, type ResolveResult, type TrainingRequest, type TrainingPlan } from './training.ts'
import { newTrainingSeed, saveGame } from './state.ts'
import { autoFillLineup, validateLineup } from './squad.ts'
import { advanceSeasonRound, finishActiveMatch, startChallenge, startLeagueMatch, startNextSeason } from './season.ts'
import { emptyAutoSubs, validateAutoSubPlan } from './match/management.ts'
import { recordMatchInjuries } from './injury.ts'
import { economyOf } from './economy.ts'
import { trainingDate, trainingOptions } from './training-calendar.ts'
import { derivedRng, splitSeed } from './rng.ts'
import { teamInputFromAI, teamInputFromLineup } from './match/setup.ts'
import { leagueMatchClockAt } from './realtime.ts'

export function startTraining(game: GameState, playerId: string, seed?: number): { ok: boolean; error?: string } {
  if (game.training[playerId]) return { ok: false, error: '该球员已有一轮培养' }
  if (game.candidates[playerId]) return { ok: false, error: '请先确认或放弃上一份候选成品' }
  const player = game.roster.find((item) => item.id === playerId)
  if (!player) return { ok: false, error: '球员不存在' }
  const energy = player.energy ?? 100
  if (!Number.isFinite(energy) || energy < TRAINING_ENERGY_COST) return { ok: false, error: `精力不足：开始一轮培养需要 ${TRAINING_ENERGY_COST} 点，当前 ${Math.round(energy)} 点。等待比赛日恢复。` }
  player.energy = Math.max(0, energy - TRAINING_ENERGY_COST)
  const economy = economyOf(game)
  const session = createTrainingSession(player, seed ?? newTrainingSeed(game, playerId), { stadium: economy.stadium, academy: economy.academy, medical: economy.medical, shop: economy.shop, sponsor: economy.sponsor })
  session.scheduleSeed = splitSeed(game.seed, 'training-calendar')
  game.training[playerId] = session
  saveGame(game)
  return { ok: true }
}

function trainingMentor(game: GameState, request: TrainingRequest) {
  return request.kind === 'inherit' || (request.kind === 'activity' && request.activityId === 'inherit')
    ? game.roster.find(item => item.id === request.mentorId) : undefined
}

function prepareTraining(game: GameState, playerId: string, request: TrainingRequest): { plan?: TrainingPlan; error?: string; completed?: boolean; ids?: string[] } {
  const session = game.training[playerId]
  if (!session) return { error: '没有进行中的培养', completed: false }
  const rawIds = (request as TrainingRequest & { teammateIds?: unknown }).teammateIds
  const groupAllowed = ['drill', 'combo', 'match'].includes(request.kind) ||
    (request.kind === 'activity' && !!trainingOptions(session).find(item => item.id === request.activityId)?.group)
  if (rawIds !== undefined && !groupAllowed) return { error: '此行动不能选择队友' }
  if (rawIds !== undefined && (!Array.isArray(rawIds) || rawIds.some((id) => typeof id !== 'string' || !id.trim() || id === playerId) || new Set(rawIds).size !== rawIds.length)) {
    return { error: '队友名单无效' }
  }
  const ids = [playerId, ...((rawIds ?? []) as string[])]
  const mentor = trainingMentor(game, request)
  let primaryPlan: TrainingPlan | undefined
  for (const id of ids) {
    const participant = game.training[id]
    if (id !== playerId && (!game.roster.some((player) => player.id === id) || !participant || game.candidates[id])) return { error: '队友没有进行中的培养' }
    if (!participant) return { error: '没有进行中的培养' }
    if (participant.completed) return { error: '本轮培养已经结束', completed: id === playerId }
    if (participant.pendingEventId) return { error: '请先处理当前事件' }
    if (participant.action >= trainingActionsTotal(participant)) return { error: `${trainingActionsTotal(participant)} 次行动已用完`, completed: id === playerId }
    if (participant.action !== session.action || participant.scheduleVersion !== session.scheduleVersion || (session.scheduleVersion === 1 && participant.scheduleSeed !== session.scheduleSeed)) return { error: '队友培养日程或行动进度不一致' }
    // Plan and execute on clones: neither preview nor a failed group action may mutate live state.
    const plan = planTraining(structuredClone(participant), request, mentor, ids.length - 1)
    if (plan.invalid) return { error: plan.note ?? '无法执行此培养行动' }
    const trial = performTrainingAction(structuredClone(participant), request, mentor, ids.length - 1)
    if (!trial.ok) return { error: trial.error, completed: id === playerId ? trial.completed : false }
    if (id === playerId) primaryPlan = plan
  }
  if (request.kind === 'activity' && request.activityId === 'exchange') {
    if (!game.aiTeams.length) return { error: '没有可用的交流赛对手' }
    const lineup = validateLineup(game.roster, game.lineup)
    if (!lineup.valid) return { error: `交流赛阵容不合法：${lineup.errors.join('；')}` }
  }
  return { plan: primaryPlan, ids }
}

function simulateTrainingExchange(game: GameState, session: TrainingSession): TrainingExchange {
  const week = trainingDate(session.action + 1).week
  const scheduleSeed = session.scheduleSeed ?? session.seed
  const opponent = derivedRng(scheduleSeed, 'training-exchange-opponent', week).pick(game.aiTeams)
  const home = teamInputFromLineup(game.roster, game.lineup, { id: 'player', name: game.clubName, color: '#34d399', accent: '#052e1b' })
  if (game.autoSubs) home.autoSubs = structuredClone(game.autoSubs)
  const engine = new Engine({ seed: splitSeed(scheduleSeed, `training-exchange-${week}`), home, away: teamInputFromAI(opponent), knockout: false })
  const score = engine.simulate().score
  return { week, opponentId: opponent.id, opponentName: opponent.name, homeScore: score.home, awayScore: score.away, result: score.home > score.away ? 'win' : score.home < score.away ? 'loss' : 'draw' }
}

export function previewTraining(game: GameState, playerId: string, request: TrainingRequest): { plan?: TrainingPlan; error?: string } {
  const { plan, error } = prepareTraining(game, playerId, request)
  return error ? { error } : { plan }
}

export function trainingAction(game: GameState, playerId: string, request: TrainingRequest): PerformResult {
  const prepared = prepareTraining(game, playerId, request)
  if (prepared.error || !prepared.ids) return { ok: false, error: prepared.error, completed: prepared.completed ?? false }
  const mentor = trainingMentor(game, request)
  let exchange: TrainingExchange | undefined
  if (request.kind === 'activity' && request.activityId === 'exchange') {
    try {
      exchange = simulateTrainingExchange(game, game.training[playerId])
    } catch (error) {
      return { ok: false, error: `交流赛无法进行：${error instanceof Error ? error.message : String(error)}`, completed: false }
    }
  }
  const staged = prepared.ids.map((id) => structuredClone(game.training[id]))
  let primaryResult: PerformResult | undefined
  for (let i = 0; i < staged.length; i++) {
    const result = performTrainingAction(staged[i], request, mentor, staged.length - 1)
    if (!result.ok) return result
    if (exchange) {
      const session = staged[i]
      // Group participants share the one simulated result.
      session.exchangeMatches = [...(session.exchangeMatches ?? []), { ...exchange }]
      if (exchange.result === 'loss') session.lowMoodWeeks = [...new Set([...(session.lowMoodWeeks ?? []), exchange.week + 1])]
      const entry = [...session.log].reverse().find(item => item.action === session.action && item.kind === 'action')
      if (entry) entry.text += ` 对阵 ${exchange.opponentName} ${exchange.homeScore}:${exchange.awayScore}（${{ win: '胜', draw: '平', loss: '负' }[exchange.result]}）。${exchange.result === 'loss' ? '下周一至周三心情低落，属性成长减少 50%。' : ''}`
    }
    if (i === 0) primaryResult = result
  }
  for (let i = 0; i < staged.length; i++) {
    Object.assign(game.training[prepared.ids[i]], staged[i])
    syncCandidate(game, prepared.ids[i])
  }
  saveGame(game)
  return exchange ? { ...primaryResult!, exchange } : primaryResult!
}

export function trainingEventChoice(game: GameState, playerId: string, optionId: string): ResolveResult {
  const session = game.training[playerId]
  if (!session) return { ok: false, error: '没有进行中的培养', completed: false }
  const result = resolveTrainingEvent(session, optionId)
  if (result.ok) syncCandidate(game, playerId)
  saveGame(game)
  return result
}

function syncCandidate(game: GameState, playerId: string): void {
  const session = game.training[playerId]
  if (session?.completed) game.candidates[playerId] = structuredClone(session.candidate)
}

export function confirmTraining(game: GameState, playerId: string): { ok: boolean; error?: string; replacedName?: string } {
  const result = confirmCandidate(game, playerId)
  if (result.ok) saveGame(game)
  return { ...result, replacedName: result.replaced?.name }
}

export function discardTraining(game: GameState, playerId: string): { ok: boolean; error?: string } {
  const result = discardCandidate(game, playerId)
  if (result.ok) saveGame(game)
  return result
}

export function setLineup(game: GameState, lineup: Lineup, autoSubs: unknown = game.autoSubs ?? emptyAutoSubs()): { ok: boolean; errors: string[] } {
  const check = validateLineup(game.roster, lineup)
  const errors = [...check.errors, ...validateAutoSubPlan(game.roster, lineup, autoSubs)]
  if (errors.length) return { ok: false, errors }
  game.lineup = structuredClone(lineup)
  game.autoSubs = structuredClone(autoSubs as AutoSubPlan)
  saveGame(game)
  return { ok: true, errors: [] }
}

export function setAutoSubs(game: GameState, plan: unknown): { ok: boolean; errors: string[] } {
  return setLineup(game, game.lineup, plan)
}

export function autoLineup(game: GameState, formationId = game.lineup.formationId): { ok: boolean; errors: string[] } {
  return setLineup(game, autoFillLineup(game.roster, formationId, game.lineup.tactics))
}

export function startNextSeasonAction(game: GameState, now = Date.now()): { ok: boolean; error?: string } {
  const result = startNextSeason(game, now)
  if (result.ok) saveGame(game)
  return result
}

export function startLeague(game: GameState, now = Date.now()): { ok: boolean; error?: string } {
  const error = validateAutoSubPlan(game.roster, game.lineup, game.autoSubs ?? emptyAutoSubs())[0]
  if (error) return { ok: false, error: `自动换人规则无效：${error}` }
  const result = startLeagueMatch(game, now)
  if (result.ok) saveGame(game)
  return { ok: result.ok, error: result.error }
}

export function startSingleChallenge(game: GameState, aiId: string, now = Date.now()): { ok: boolean; error?: string } {
  const error = validateAutoSubPlan(game.roster, game.lineup, game.autoSubs ?? emptyAutoSubs())[0]
  if (error) return { ok: false, error: `自动换人规则无效：${error}` }
  const result = startChallenge(game, aiId, now)
  if (result.ok) saveGame(game)
  return { ok: result.ok, error: result.error }
}

export function restoreActiveEngine(game: GameState): MatchEngine | null {
  if (!game.activeMatch) return null
  return Engine.restore(game.activeMatch.engineState as MatchState, !game.activeMatch.context.isLeague)
}

export function syncActiveEngine(game: GameState, engine: MatchEngine, now = Date.now()): void {
  if (!game.activeMatch) return
  recordMatchInjuries(game, engine.state, game.activeMatch.context.isLeague ? game.activeMatch.startedAt : now, game.activeMatch.context.isLeague)
  game.activeMatch.engineState = engine.serialize()
  game.activeMatch.instructions = [...engine.state.instructions]
  saveGame(game)
}

export function finishMatch(game: GameState, engine: MatchEngine, now = Date.now()): MatchRecord | null {
  const record = finishActiveMatch(game, engine, now)
  if (record) saveGame(game)
  return record
}

export function simulateSeasonRound(game: GameState, now = Date.now()): { ok: boolean; error?: string } {
  const result = advanceSeasonRound(game, now)
  if (result.ok) saveGame(game)
  return result
}

export function changeMatchTactics(game: GameState, engine: MatchEngine, mentality: MatchMentality): { ok: boolean; error?: string } {
  const active = game.activeMatch
  const eventClock = active?.context.isLeague && active ? leagueMatchClockAt(active, active.elapsedSeconds ?? 0) : undefined
  const result = engine.setTactics(mentality, active?.context.homeAway, eventClock)
  if (result.ok) syncActiveEngine(game, engine)
  return result
}

export function makeSubstitution(game: GameState, engine: MatchEngine, outId: string, inId: string): { ok: boolean; error?: string } {
  const active = game.activeMatch
  const eventClock = active?.context.isLeague && active ? leagueMatchClockAt(active, active.elapsedSeconds ?? 0) : undefined
  const result = engine.substitute(outId, inId, active?.context.homeAway, eventClock)
  if (result.ok) syncActiveEngine(game, engine)
  return result
}

export function useCoachPause(game: GameState): boolean {
  if (!game.activeMatch || game.activeMatch.context.isLeague || game.activeMatch.coachPausesLeft <= 0) return false
  game.activeMatch.coachPausesLeft--
  saveGame(game)
  return true
}
