import type { AttrKey, EventDef, FormationId, GameState, Lineup, PlayerCard, Position, RoleId, Tactics, TrainingSession } from '../src/game/types.ts'
import type { TrainingRequest } from '../src/game/training.ts'
import { trainingDate, trainingOptions, type TrainingActivityId } from '../src/game/training-calendar.ts'
import type { SkillId } from '../src/game/types.ts'
import { SKILLS } from '../src/game/data/skills.ts'
import { economyOf, upgradeFacility, FACILITIES, facilityLevel, facilityRoundIncome, facilityStageChance, facilityStageInLevel, facilityUpgradeCost, type FacilityId } from '../src/game/economy.ts'
import { bestMarketValue, buyFreeAgent, listPlayer, cancelListing } from '../src/game/market.ts'
import { ALL_ATTRIBUTES, POSITIONS } from '../src/game/types.ts'
import { caOf } from '../src/game/ca.ts'
import { displayCA, displayAttr, displayGain, initialDisplayCA } from '../src/game/rating.ts'
import { mainAttrsFor } from '../src/game/scale.ts'
import { FORMATIONS, FORMATION_LIST } from '../src/game/data/formations.ts'
import { ROLES, ROLES_BY_POSITION } from '../src/game/data/roles.ts'
import { eventById } from '../src/game/data/events.ts'
import { branchProbability, eventChance, trainingActionsTotal, eventGrowthScale, TRAINING_ACTION_INFO } from '../src/game/training.ts'
import { lineupSlots, validateLineup } from '../src/game/squad.ts'
import { emptyAutoSubs, validateAutoSubPlan } from '../src/game/match/management.ts'
import { positionMultiplier } from '../src/game/ca.ts'
import { displayClock } from '../src/game/match/time.ts'
import { leagueDisplayClock } from '../src/game/realtime.ts'
import { injuryUntil } from '../src/game/injury.ts'
import { buildReview } from '../src/game/review.ts'
import { cardsOf, playerCards } from '../src/game/cards.ts'
import { traitEffectText } from '../src/game/data/skill-effects.ts'
import { traitNameOf } from '../src/game/data/star-traits.ts'
import {
  autoLineup,
  changeMatchTactics,
  confirmTraining,
  discardTraining,
  equipPlayerCard,
  finishMatch,
  keepTraining,
  makeSubstitution,
  previewTraining,
  removePlayerCard,
  restoreActiveEngine,
  setAutoSubs,
  setLineup,
  simulateSeasonRound,
  startLeague,
  startNextSeasonAction,
  startSingleChallenge,
  startTraining,
  startTrainingWithSupport,
  syncActiveEngine,
  trainingAction,
  trainingEventChoice,
  useCoachPause,
} from '../src/game/actions.ts'
import { playerFixture, seasonRoundLabel, teamName } from '../src/game/season.ts'
import { displayEventHint, trainingLogText } from '../src/ui/format.ts'

export type AgentOutcome = { ok: boolean; error?: string; result?: unknown }

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const text = (value: unknown): string => typeof value === 'string' ? value : ''

function primaryPosition(player: GameState['roster'][number]): Position {
  return POSITIONS.filter((pos) => player.positions[pos] > 0).sort((a, b) => player.positions[b] - player.positions[a])[0] ?? 'CM'
}

/** Only expose the same main attributes as the manual interface. */
function visibleAttrs(player: GameState['roster'][number]) {
  const gk = player.positions.GK > 0
  const attrs: Partial<Record<AttrKey, number>> = {}
  for (const key of mainAttrsFor(gk)) attrs[key] = displayAttr(key, player.attrs[key], gk)
  return { attrs }
}

function cardView(card: PlayerCard, game: GameState) {
  const gk = card.positions.GK > 0
  const attrs: Partial<Record<AttrKey, number>> = {}
  for (const key of mainAttrsFor(gk)) attrs[key] = displayAttr(key, card.attrs[key], gk)
  const owner = game.roster.find((player) => player.id === card.playerId)
  return {
    id: card.id,
    playerId: card.playerId,
    playerName: card.playerName,
    serial: card.serial,
    routeId: card.routeId,
    ca: displayCA(caOf(card.attrs, gk)),
    attrs,
    positions: card.positions,
    personality: card.personality,
    skills: card.skills,
    skillTiers: card.skillTiers ?? {},
    equipped: owner?.equippedCardId === card.id,
    ownerInSquad: !!owner,
  }
}

function visibleGains(gains: Partial<Record<AttrKey, number>>, gk: boolean) {
  const result: Partial<Record<AttrKey, number>> = {}
  for (const key of mainAttrsFor(gk)) if (gains[key] != null) result[key] = displayGain(key, gains[key]!, gk)
  return result
}

export function playerView(player: GameState['roster'][number], game: GameState, now: number) {
  const isGk = player.positions.GK > 0
  return {
    id: player.id,
    name: player.name,
    enName: player.enName,
    country: player.country,
    era: player.era,
    number: player.number,
    foot: player.foot,
    height: player.height,
    primaryPosition: primaryPosition(player),
    ca: displayCA(caOf(player.attrs, isGk)),
    initialCA: initialDisplayCA(player),
    positions: player.positions,
    ...visibleAttrs(player),
    personality: player.personality,
    traitId: player.traitId,
    traitName: traitNameOf(player.traitId),
    traitEffect: traitEffectText(player.traitId),
    style: player.style,
    skills: player.skills,
    skillTiers: player.skillTiers ?? {},
    condition: player.condition,
    energy: player.energy,
    injuryUntil: injuryUntil(game, player, now),
    equippedCardId: player.equippedCardId ?? null,
    cardIds: playerCards(game, player.id).map((card) => card.id),
  }
}

/** 设施用“阶段”存储（每级 5 个，共 25 个），对外同时给出阶段、等级与成长概率。 */
function economyView(game: GameState) {
  const economy = economyOf(game)
  return {
    ...economy,
    facilities: Object.entries(FACILITIES).map(([id, info]) => {
      const facility = id as FacilityId
      const stage = economy[facility]
      return {
        id, ...info, stage,
        level: facilityLevel(stage),
        stageInLevel: facilityStageInLevel(stage),
        growthChance: facilityStageChance(stage),
        roundIncome: facilityRoundIncome(economy, facility),
        upgradeCost: facilityUpgradeCost(facility, stage),
      }
    }),
  }
}

function playerDetailView(player: GameState['roster'][number], game: GameState, now: number) {
  return {
    ...playerView(player, game, now),
    // 手动详情页只展示历史标题/正文，不展开历史收益。
    history: (player.history ?? []).map((entry) => ({ action: entry.action, week: entry.week, kind: entry.kind, title: entry.title, text: trainingLogText(entry, player.positions.GK > 0) })),
  }
}

function fixtureView(game: GameState, fixture: ReturnType<typeof playerFixture>) {
  if (!fixture) return null
  return {
    round: fixture.round,
    homeId: fixture.homeId,
    awayId: fixture.awayId,
    homeName: teamName(game, fixture.homeId),
    awayName: teamName(game, fixture.awayId),
    played: fixture.played,
    score: fixture.score ?? null,
  }
}

function matchPlayerView(player: { id: string; name: string; number: number; position: Position; role: RoleId; stamina: number; maxStamina: number; injured?: boolean }) {
  return {
    id: player.id,
    name: player.name,
    number: player.number,
    position: player.position,
    role: player.role,
    stamina: player.maxStamina > 0 ? Math.round((player.stamina / player.maxStamina) * 1000) / 10 : 0,
    injured: !!player.injured,
  }
}

/** 比赛中的可见信息，和手动比赛页 + 教练面板基本一致。 */
function matchView(game: GameState) {
  const active = game.activeMatch
  if (!active) return null
  const engine = restoreActiveEngine(game)
  if (!engine) return null
  const state = engine.state
  const matchClock = active.context.isLeague ? leagueDisplayClock(active) : displayClock(state.clock, state.durationSeconds)
  const playerSide = active.context.homeAway
  const playerIndex = playerSide === 'home' ? 0 : 1
  const opponentIndex = playerIndex === 0 ? 1 : 0
  const playerTeam = state.teams[playerIndex]
  const opponentTeam = state.teams[opponentIndex]
  const homePoss = state.stats.home.possession + state.stats.away.possession > 0
    ? (state.stats.home.possession / (state.stats.home.possession + state.stats.away.possession)) * 100
    : 50
  return {
    opponentId: active.context.opponentId,
    opponentName: active.context.opponentName,
    isLeague: active.context.isLeague,
    round: active.context.round ?? null,
    homeAway: playerSide,
    playerSide,
    playerName: playerTeam.name,
    opponentTeamName: opponentTeam.name,
    coachPausesLeft: active.coachPausesLeft,
    subsUsed: playerTeam.subsUsed,
    score: { ...state.score },
    clock: matchClock,
    half: state.half,
    step: state.step,
    finished: state.finished,
    possession: { player: playerSide === 'home' ? homePoss : 100 - homePoss, opponent: playerSide === 'home' ? 100 - homePoss : homePoss },
    stats: {
      player: state.stats[playerSide],
      opponent: state.stats[opponentIndex === 0 ? 'home' : 'away'],
    },
    tactics: { ...playerTeam.tactics },
    mentality: playerTeam.mentality ?? null,
    autoSubs: playerTeam.autoSubs ?? emptyAutoSubs(),
    onPitch: playerTeam.players.filter((player) => player.onPitch).map(matchPlayerView),
    bench: playerTeam.bench.map(matchPlayerView),
    availableBench: engine.availableBench(playerSide).map(matchPlayerView),
    commentary: (state.commentary ?? []).map((entry) => ({ ...entry, clock: displayClock(entry.clock, state.durationSeconds) })),
    recentLog: state.log.slice(-12).map((entry) => ({
      seq: entry.seq,
      clock: displayClock(entry.clock, state.durationSeconds),
      half: entry.half,
      type: entry.type,
      text: entry.text,
      probabilities: entry.probabilities,
      ratings: entry.ratings,
      skill: entry.skill,
      goal: entry.goal ? { ...entry.goal, clock: displayClock(entry.goal.clock, state.durationSeconds) } : undefined,
      shotChance: entry.shotChance,
    })),
    instructions: state.instructions,
    snapshot: { ...engine.snapshot(), clock: displayClock(engine.snapshot().clock, state.durationSeconds) },
  }
}

function matchSummary(record: GameState['matchHistory'][number]) {
  return {
    id: record.id,
    isLeague: record.isLeague,
    round: record.round ?? null,
    homeName: record.homeName,
    awayName: record.awayName,
    score: record.score,
    shootout: record.shootout ?? null,
    result: record.result,
    autoSimulated: !!record.autoSimulated,
  }
}

function eventView(session: TrainingSession, event: EventDef) {
  const gk = session.candidate.positions.GK > 0
  return {
    id: event.id, title: event.title, category: event.category, mainline: event.category === 'mainline', text: event.text,
    hintNote: session.scheduleVersion === 1 ? '提示为基础成长；低落情绪可能使正向属性成长减少 50%。' : null,
    options: event.options.map((option) => ({
      id: option.id, label: option.label, hint: displayEventHint(option.hint, gk, eventGrowthScale(session)),
      chanceText: option.branch?.chanceText ?? null,
      probability: option.branch ? Math.round(branchProbability(session, option.branch.check, option.branch.p) * 1000) / 1000 : null,
      successText: option.branch?.success.text ?? null, failureText: option.branch?.failure.text ?? null,
    })),
  }
}

export function agentView(game: GameState, now = Date.now()) {
  const sessionView = Object.values(game.training).map((session) => {
    const player = game.roster.find((item) => item.id === session.playerId)
    const pending = session.pendingEventId ? eventById(session.pendingEventId) : undefined
    return {
      playerId: session.playerId,
      playerName: player?.name ?? session.playerId,
      action: session.action,
      actionsTotal: trainingActionsTotal(session),
      scheduleVersion: session.scheduleVersion ?? null,
      date: session.scheduleVersion === 1 && session.action < trainingActionsTotal(session) ? trainingDate(session.action + 1) : null,
      options: session.scheduleVersion === 1 && session.action < trainingActionsTotal(session) ? trainingOptions(session).map(({ id, label, desc, stamina, group, parameters }) => ({ id, label, desc, stamina, group, ...(parameters ? { parameters } : {}) })) : [],
      lowMoodWeeks: session.lowMoodWeeks ?? [],
      exchangeMatches: session.exchangeMatches ?? [],
      facilityLevels: session.facilityLevels ?? null,
      fatigue: session.fatigue,
      stamina: 100 - session.fatigue,
      energy: player?.energy ?? session.energy,
      completed: session.completed,
      cardId: session.cardId ?? null,
      routeId: session.routeId,
      routePoints: session.routePoints,
      nextEventChance: session.action >= trainingActionsTotal(session) ? null : eventChance(session, session.action + 1),
      candidate: playerView(session.candidate, game, now),
      pendingEvent: pending ? eventView(session, pending) : null,
      log: session.log.slice(-24).map((entry) => ({
        action: entry.action,
        week: entry.week,
        kind: entry.kind,
        title: entry.title,
        text: trainingLogText(entry, session.candidate.positions.GK > 0),
        gains: visibleGains(entry.gains ?? {}, session.candidate.positions.GK > 0),
        fatigue: entry.fatigue,
      })),
    }
  })
  const lineupCheck = validateLineup(game.roster, game.lineup)
  const slots = lineupSlots(game.roster, game.lineup)
  return {
    club: { name: game.clubName, seed: game.seed, version: game.version },
    season: {
      index: game.season.index,
      round: game.season.round,
      label: seasonRoundLabel(game),
      finished: game.season.finished,
      champion: game.season.champion,
      playerFinish: game.season.playerFinish,
      table: game.season.table.map((row) => ({ ...row, teamName: teamName(game, row.teamId) })),
      currentFixture: fixtureView(game, playerFixture(game)),
      currentRoundFixtures: game.season.fixtures
        .filter((fixture) => fixture.round === game.season.round)
        .map((fixture) => fixtureView(game, fixture)),
      fixturesPreview: game.season.fixtures
        .filter((fixture) => fixture.round <= 5)
        .map((fixture) => fixtureView(game, fixture)),
    },
    economy: economyView(game),
    market: {
      freeAgents: game.freeStars.map((player) => ({ player: playerView(player, game, now), price: bestMarketValue(game, player) })),
      listings: (game.market?.listings ?? []).map(({ player, price }) => ({ player: playerView(player, game, now), price })),
    },
    teams: game.aiTeams.map((team) => ({ id: team.id, name: team.name, strength: team.strength, style: team.style, formationId: team.formationId })),
    roster: game.roster.map((player) => playerView(player, game, now)),
    lineup: game.lineup,
    autoSubs: game.autoSubs ?? emptyAutoSubs(),
    autoSubErrors: validateAutoSubPlan(game.roster, game.lineup, game.autoSubs ?? emptyAutoSubs()),
    lineupAnalysis: {
      validation: lineupCheck,
      starters: slots.map((slot) => ({
        slotId: slot.slotId,
        position: slot.position,
        label: slot.label,
        playerId: slot.player?.id ?? null,
        playerName: slot.player?.name ?? null,
        role: slot.role,
        proficiency: slot.player ? Math.round(slot.player.positions[slot.position]) : 0,
        effectiveLoss: Math.round(slot.effectiveLoss * 1000) / 1000,
        fit: Math.round(slot.fit * 10) / 10,
      })),
      bench: game.lineup.bench.map((id) => {
        const player = game.roster.find((item) => item.id === id)
        return { playerId: id, playerName: player?.name ?? id }
      }),
    },
    formations: FORMATION_LIST.map((formation) => ({
      id: formation.id,
      label: formation.label,
      desc: formation.desc,
      slots: formation.slots.map((slot) => ({ id: slot.id, position: slot.position, label: slot.label, defaultRole: slot.defaultRole })),
      defaultTactics: formation.defaultTactics,
    })),
    roles: ROLES_BY_POSITION,
    trainingSessions: sessionView,
    candidates: Object.values(game.candidates).map((player) => playerView(player, game, now)),
    cards: cardsOf(game).map((card) => cardView(card, game)),
    activeMatch: matchView(game),
    matchHistory: game.matchHistory.map(matchSummary),
    challengeHistory: game.challengeHistory.map(matchSummary),
    recentMatches: game.matchHistory.slice(0, 5).map(matchSummary),
    trainingActions: TRAINING_ACTION_INFO,
  }
}

function isTactics(value: unknown): value is Tactics {
  const t = asRecord(value)
  return ['middle', 'wing', 'balanced'].includes(text(t.attack))
    && ['short', 'mixed', 'direct'].includes(text(t.passing))
    && ['slow', 'normal', 'fast'].includes(text(t.tempo))
    && ['low', 'mid', 'high'].includes(text(t.line))
    && ['low', 'mid', 'high'].includes(text(t.press))
}

function parseTrainingRequest(value: unknown): TrainingRequest | null {
  const request = asRecord(value)
  const kind = text(request.kind)
  if (request.teammateIds !== undefined && (!Array.isArray(request.teammateIds) || request.teammateIds.some((id: unknown) => typeof id !== 'string' || !id.trim()))) return null
  if (request.teammateIds !== undefined && kind !== 'drill' && kind !== 'combo' && kind !== 'match' && kind !== 'activity') return null
  const teammates = request.teammateIds === undefined ? {} : { teammateIds: request.teammateIds as string[] }
  if (kind === 'activity') {
    if (!Object.keys(request).every(key => ['kind', 'activityId', 'teammateIds', 'position', 'mentorId', 'skill'].includes(key))) return null
    const activityId = text(request.activityId)
    if (!activityId.trim()) return null
    if (request.position !== undefined && !(POSITIONS as readonly string[]).includes(text(request.position))) return null
    if (request.mentorId !== undefined && !text(request.mentorId).trim()) return null
    if (request.skill !== undefined && !Object.hasOwn(SKILLS, text(request.skill))) return null
    return { kind, activityId: activityId as TrainingActivityId, ...teammates,
      ...(request.position === undefined ? {} : { position: request.position as Position }),
      ...(request.mentorId === undefined ? {} : { mentorId: request.mentorId as string }),
      ...(request.skill === undefined ? {} : { skill: request.skill as SkillId }) }
  }
  if (kind === 'drill') {
    const attr = text(request.attr)
    return (ALL_ATTRIBUTES as readonly string[]).includes(attr) ? { kind, attr: attr as AttrKey, ...teammates } : null
  }
  if (kind === 'combo') {
    const focus = text(request.focus)
    return focus === 'attack' || focus === 'defense' ? { kind, focus, ...teammates } : null
  }
  if (kind === 'match') return Object.keys(request).every(key => key === 'kind' || key === 'teammateIds') ? { kind, ...teammates } : null
  if (kind === 'position') {
    const position = text(request.position)
    return (POSITIONS as readonly string[]).includes(position) ? { kind, position: position as Position } : null
  }
  if (kind === 'protection') {
    const focus = text(request.focus)
    return focus === 'prevention' || focus === 'resilience' ? { kind, focus } : null
  }
  if (kind === 'inherit') {
    const mentorId = text(request.mentorId)
    const skill = text(request.skill)
    return mentorId && Object.hasOwn(SKILLS, skill) ? { kind, mentorId, skill: skill as SkillId } : null
  }
  if (kind === 'rest' || kind === 'mentor') return { kind }
  return null
}

function parseLineup(game: GameState, value: unknown): Lineup | null {
  const raw = asRecord(value)
  const formationId = text(raw.formationId) as FormationId
  const formation = FORMATIONS[formationId]
  if (!formation) return null
  if (!Array.isArray(raw.starters) || !Array.isArray(raw.bench)) return null
  const starters: Lineup['starters'] = []
  for (const entry of raw.starters) {
    const starter = asRecord(entry)
    const slotId = text(starter.slotId)
    const playerId = text(starter.playerId)
    const slot = formation.slots.find((item) => item.id === slotId)
    if (!slot || !playerId) return null
    const role = text(starter.role) as RoleId
    starters.push({ slotId, playerId, role: ROLES[role]?.position === slot.position ? role : slot.defaultRole })
  }
  return {
    formationId,
    starters,
    bench: raw.bench.map((id) => text(id)).filter(Boolean),
    tactics: isTactics(raw.tactics) ? raw.tactics : game.lineup.tactics,
  }
}

function matchResult(record: NonNullable<ReturnType<typeof finishMatch>>) {
  const duration = record.durationSeconds ?? 600
  return {
    ...matchSummary(record),
    goalDetails: (record.goalDetails ?? []).map((goal) => ({ ...goal, clock: displayClock(goal.clock, duration) })),
    commentary: (record.commentary ?? []).map((entry) => ({ ...entry, clock: displayClock(entry.clock, duration) })),
    review: buildReview(record),
  }
}

function findRecord(game: GameState, id: string) {
  return [...game.matchHistory, ...game.challengeHistory].find((record) => record.id === id)
}

export function applyAgentAction(game: GameState, rawBody: unknown, now = Date.now()): AgentOutcome {
  const body = asRecord(rawBody)
  const action = text(body.action)
  switch (action) {
    case 'get_player': {
      const player = game.roster.find((item) => item.id === text(body.playerId))
      return player ? { ok: true, result: playerDetailView(player, game, now) } : { ok: false, error: '球员不存在' }
    }
    case 'start_next_season': {
      const result = startNextSeasonAction(game, now)
      return { ...result, result }
    }
    case 'start_training': {
      // 陪练队友由系统自动挑 6 个（含门将），不再由调用方指定。
      const result = startTrainingWithSupport(game, text(body.playerId))
      return { ...result, result }
    }
    case 'preview_training': {
      const playerId = text(body.playerId)
      const request = parseTrainingRequest(body.request)
      if (!request) return { ok: false, error: '无效的训练请求；请检查 kind、参数及 teammateIds' }
      const preview = previewTraining(game, playerId, request)
      if (preview.error || !preview.plan) return { ok: false, error: preview.error ?? '无法预览训练' }
      const session = game.training[playerId]
      if (!session) return { ok: false, error: '没有进行中的培养' }
      return { ok: true, result: { request, plan: { ...preview.plan, gains: visibleGains(preview.plan.gains, session.candidate.positions.GK > 0) }, valid: true } }
    }
    case 'training_action': {
      const request = parseTrainingRequest(body.request)
      if (!request) return { ok: false, error: '无效的训练请求；请检查 kind、参数及 teammateIds' }
      const playerId = text(body.playerId)
      const result = trainingAction(game, playerId, request)
      const session = game.training[playerId]
      // Group results may contain unfiltered events or hidden gains; expose only the primary result.
      const visible = { ok: result.ok, error: result.error, completed: result.completed, event: result.event && session ? eventView(session, result.event) : null, exchange: result.exchange }
      return { ...visible, result: visible }
    }
    case 'training_event_choice': {
      const playerId = text(body.playerId)
      const session = game.training[playerId]
      const pending = session?.pendingEventId ? eventById(session.pendingEventId) : undefined
      const event = pending && session ? eventView(session, pending) : undefined
      const result = trainingEventChoice(game, playerId, text(body.optionId))
      const option = event?.options.find(item => item.id === result.option?.id)
      const visible = { ...result, event, option, gains: result.gains && visibleGains(result.gains, (session?.candidate.positions.GK ?? 0) > 0) }
      return { ...visible, result: visible }
    }
    case 'confirm_training': {
      const { ok, error, replacedName } = confirmTraining(game, text(body.playerId))
      return ok ? { ok, result: { ok, replacedName } } : { ok, error }
    }
    case 'discard_training': {
      const result = discardTraining(game, text(body.playerId))
      return { ...result, result }
    }
    case 'keep_training': {
      const result = keepTraining(game, text(body.playerId))
      return { ...result, result }
    }
    case 'equip_card': {
      const result = equipPlayerCard(game, text(body.playerId), body.cardId === null ? null : text(body.cardId))
      return { ...result, result }
    }
    case 'delete_card': {
      const result = removePlayerCard(game, text(body.cardId))
      return { ...result, result }
    }
    case 'upgrade_facility': {
      const id = text(body.facilityId)
      if (!Object.hasOwn(FACILITIES, id)) return { ok: false, error: '无效的设施' }
      const result = upgradeFacility(game, id as FacilityId)
      return result.ok ? { ok: true, result } : result
    }
    case 'buy_free_agent':
    case 'cancel_listing':
    case 'list_player': {
      if (typeof body.playerId !== 'string' || !body.playerId) return { ok: false, error: '无效的球员 ID' }
      if (action === 'list_player' && (typeof body.price !== 'number' || !Number.isSafeInteger(body.price) || body.price <= 0)) return { ok: false, error: '无效的价格' }
      const result = action === 'buy_free_agent' ? buyFreeAgent(game, body.playerId)
        : action === 'cancel_listing' ? cancelListing(game, body.playerId)
        : listPlayer(game, body.playerId, body.price as number)
      return result.ok ? { ok: true, result } : result
    }
    case 'auto_lineup': {
      const requested = text(body.formationId)
      const formationId = requested && FORMATIONS[requested as FormationId] ? requested as FormationId : game.lineup.formationId
      const result = autoLineup(game, formationId)
      return result.ok ? { ok: true, result: game.lineup } : { ok: false, error: result.errors.join('；') }
    }
    case 'set_lineup': {
      const lineup = parseLineup(game, body.lineup)
      if (!lineup) return { ok: false, error: '无效阵容；需要合法 formationId、starters[{slotId,playerId,role}] 与 bench[playerId]' }
      const result = setLineup(game, lineup, body.autoSubs === undefined ? game.autoSubs ?? emptyAutoSubs() : body.autoSubs)
      return result.ok ? { ok: true, result: game.lineup } : { ok: false, error: result.errors.join('；') }
    }
    case 'set_auto_subs': {
      const result = setAutoSubs(game, body.plan)
      return result.ok ? { ok: true, result: game.autoSubs } : { ok: false, error: result.errors.join('；') }
    }
    case 'start_league': {
      const result = startLeague(game, now)
      return { ...result, result: result.ok ? matchView(game) : undefined }
    }
    case 'start_friendly': {
      const result = startSingleChallenge(game, text(body.teamId), now)
      return { ...result, result: result.ok ? matchView(game) : undefined }
    }
    case 'get_match': {
      const matchId = text(body.matchId)
      if (matchId) {
        const record = findRecord(game, matchId)
        return record ? { ok: true, result: { record, review: buildReview(record) } } : { ok: false, error: '比赛记录不存在' }
      }
      const view = matchView(game)
      return view ? { ok: true, result: view } : { ok: false, error: '当前没有进行中的比赛' }
    }
    case 'advance_match': {
      if (!game.activeMatch) return { ok: false, error: '当前没有进行中的比赛' }
      if (game.activeMatch.context.isLeague) return { ok: false, error: '联赛按现实时间进行，不能手动推进' }
      const rawSteps = Number(body.steps ?? 1)
      const steps = Math.max(1, Math.min(20_000, Number.isFinite(rawSteps) ? Math.floor(rawSteps) : 1))
      const engine = restoreActiveEngine(game)
      if (!engine) return { ok: false, error: '无法恢复比赛引擎' }
      for (let index = 0; index < steps && !engine.state.finished; index++) engine.step()
      if (engine.state.finished) {
        const record = finishMatch(game, engine, now)
        return record ? { ok: true, result: { finished: true, record: matchResult(record), match: null } } : { ok: false, error: '比赛尚未结束或无法结算' }
      }
      syncActiveEngine(game, engine, now)
      return { ok: true, result: { finished: false, record: null, match: matchView(game) } }
    }
    case 'set_match_tactics': {
      if (!game.activeMatch) return { ok: false, error: '当前没有进行中的比赛' }
      if (body.mentality !== 'attack' && body.mentality !== 'balanced' && body.mentality !== 'defend') return { ok: false, error: '比赛中只能选择全体进攻、均衡或全体防守' }
      const engine = restoreActiveEngine(game)
      if (!engine) return { ok: false, error: '无法恢复比赛引擎' }
      const result = changeMatchTactics(game, engine, body.mentality)
      return { ...result, result: result.ok ? matchView(game) : undefined }
    }
    case 'substitute': {
      if (!game.activeMatch) return { ok: false, error: '当前没有进行中的比赛' }
      const engine = restoreActiveEngine(game)
      if (!engine) return { ok: false, error: '无法恢复比赛引擎' }
      const result = makeSubstitution(game, engine, text(body.outId), text(body.inId))
      return { ...result, result: result.ok ? matchView(game) : undefined }
    }
    case 'coach_pause': {
      if (!game.activeMatch) return { ok: false, error: '当前没有进行中的比赛' }
      if (game.activeMatch.context.isLeague) return { ok: false, error: '联赛不能暂停，请直接调整战术或换人' }
      const ok = useCoachPause(game)
      return ok ? { ok: true, result: matchView(game) } : { ok: false, error: '教练暂停已用完' }
    }
    case 'play_match': {
      if (!game.activeMatch) return { ok: false, error: '请先开始友谊赛' }
      if (game.activeMatch.context.isLeague) return { ok: false, error: '联赛按现实时间进行，不能跳到结果' }
      const engine = restoreActiveEngine(game)
      if (!engine) return { ok: false, error: '无法恢复比赛引擎' }
      engine.simulate()
      const record = finishMatch(game, engine, now)
      return record ? { ok: true, result: matchResult(record) } : { ok: false, error: '比赛尚未结束或无法结算' }
    }
    case 'simulate_round': {
      const result = simulateSeasonRound(game, now)
      return { ...result, result }
    }
    default:
      return { ok: false, error: `未知 action：${action || '(空)'}` }
  }
}
