import type { AITeam, AttrKey, DetailedPosition, EventDef, FormationId, GameState, Lineup, PlayerCard, Position, RoleId, Tactics, TrainingAutoConfig, TrainingSession } from '../src/game/types.ts'
import {
  BOARD_CHOICE_MAX_ROUND,
  BOARD_WAGE_SLIDER_ROUNDS,
  adjustBoardBudgetSlider,
  boardCommercialWageBonus,
  boardEffectiveWageCap,
  boardSliderBounds,
  canSwitchCurrentBoardAmbition,
  chooseBoardAmbition,
  ensureBoard,
  isBoardAmbition,
  isBoardBudgetActive,
  isBoardTier,
  refreshOffseasonBoardPreview,
  syncBoardLockState,
} from '../src/game/board.ts'
import { worldWageBill } from '../src/game/world.ts'
import { detailedPositionForSlot, isDetailedPosition, readDetailedPositions, slotPositionValue } from '../src/game/detailed-positions.ts'
import { MAX_SCOUT_REPORTS, SCOUT_LEVELS, deleteScoutReport, startScouting, visibleScoutReports, type ScoutReport, type ScoutSource, type ScoutTarget, type VisibleScoutReport } from '../src/game/scouting.ts'
import { preferredPositionRatings } from '../src/game/scout-rating.ts'
import { cupCeilingBonus } from '../src/game/cup-rewards.ts'
import { MAIN_ATTR_HARD_MAX } from '../src/game/scale.ts'
import { PEAK_STAGES } from '../src/game/data/peak-stages.generated.ts'
import { PEAK_STAGE_COUNT, buildPeakTeam } from '../src/game/peak.ts'
import { PEAK_DAILY_LIMIT, peakDailyStatus } from '../src/game/peak-attempts.ts'
import { peakStageReward } from '../src/game/data/peak-rewards.ts'
import { peakSkillForStage } from '../src/game/data/peak-skills.ts'
import { applyPeakBreakthrough } from '../src/game/peak-milestones.ts'
import { PEAK_REWARD_STAGE, claimPeakReward, peakRewardReady } from '../src/game/peak-reward.ts'
import { LEGEND_TEAMS } from '../src/game/data/legend-teams.ts'
import { legendSkillForTeam } from '../src/game/data/legend-skills.ts'
import { legendTeamById } from '../src/game/legend.ts'
import { pveContentReady } from '../src/game/pve-content.ts'
import { ensurePve, legendRecordOf } from '../src/game/pve.ts'
import { youthView } from '../src/game/youth.ts'
import { applyYouthAction } from '../src/game/youth-actions.ts'
import type { TrainingRequest } from '../src/game/training.ts'
import { trainingDate, trainingOptions, type TrainingActivityId } from '../src/game/training-calendar.ts'
import type { SkillId } from '../src/game/types.ts'
import { SKILLS, canLearnSkill, skillCategory } from '../src/game/data/skills.ts'
import { economyOf, payWageArrears, upgradeFacility, FACILITIES, facilityLevel, facilityRoundIncome, facilityStageChance, facilityStageInLevel, facilityUpgradeCost, homeAtmosphereBonus, type FacilityId } from '../src/game/economy.ts'
import { aiTransferOffers, previewClubSigning, bestMarketValue, buyFreeAgent, listPlayer, cancelListing, releasePlayer, renewContract, signClubPlayer, transferWindowOpen } from '../src/game/market.ts'
import { negotiationDemands, negotiationTerms, SEASON_GOAL_LABELS, SQUAD_ROLE_LABELS, type SeasonGoal, type SquadRole } from '../src/game/negotiation.ts'
import { ALL_ATTRIBUTES, POSITIONS } from '../src/game/types.ts'
import { caOf } from '../src/game/ca.ts'
import { displayCA, displayAttr, displayGain, initialDisplayCA } from '../src/game/rating.ts'
import { mainAttrsFor } from '../src/game/scale.ts'
import { FORMATIONS, FORMATION_LIST, isLegacyFormation } from '../src/game/data/formations.ts'
import { ROLES, ROLES_BY_POSITION } from '../src/game/data/roles.ts'
import { bookKey, bookLearnChance, bookName, bookRequirementText, eventForSession, trainingSkillChance } from '../src/game/legend-learning.ts'
import { branchProbability, eventChance, trainingActionsTotal, eventGrowthScale, trainingQualityChances, TRAINING_ACTION_INFO, TRAINING_POINT_TIERS } from '../src/game/training.ts'
import { computeLineupFamiliarity, lineupSlots, setSlotPosition, validateLineup } from '../src/game/squad.ts'
import { ageProfileOf, lineupAgeAnalysis } from '../src/game/age-profile.ts'
import {
  STYLE_LIST_REV3,
  STYLE_META,
  cloneInstructions,
  inferStyleForInstructions,
  instructionsFromLegacyTactics,
  isStyleId,
  legacyTacticsFromInstructions,
  styleByRevision,
  tryValidateInstructions,
  type StyleId,
  type TacticalInstructionsV2,
} from '../src/game/pes/tactics.ts'
import { MATCH_PLAN_LIST, isMatchPlanId, matchPlanPhaseName, type MatchPlanId } from '../src/game/pes/match-plan.ts'
import {
  BACKUP_TACTIC_TEMPLATES,
  validateBackupTactics,
  validateMatchPlanRules,
  type BackupTactic,
  type MatchPlanRule,
} from '../src/game/pes/tactical-plan.ts'
import { emptyAutoSubs, validateAutoSubPlan } from '../src/game/match/management.ts'
import { positionMultiplier } from '../src/game/ca.ts'
import { displayClock } from '../src/game/match/time.ts'
import { leagueDisplayClock } from '../src/game/realtime.ts'
import { injuryUntil } from '../src/game/injury.ts'
import { buildReview } from '../src/game/review.ts'
import { cardRecyclePoints, cardsOf, playerCards, recyclePlayerCards, setCardRecycleLock, untrainedPlayer } from '../src/game/cards.ts'
import { skillEffectText, traitEffectText } from '../src/game/data/skill-effects.ts'
import { hasBookAtOrAbove } from '../src/game/legend-books.ts'
import { SHOP_BOOK_PRICE, buyShopBook, peakStageShopPoints, shopCatalog, shopPointsOf, shopSeasonIndex } from '../src/game/shop.ts'
import { traitNameOf } from '../src/game/data/star-traits.ts'
import {
  applyLineupPreset,
  autoLineup,
  autoTrainingConfig,
  autoTrainingRunnable,
  autoTrainingStep,
  defaultAutoPriority,
  deleteLineupPreset,
  renameLineupPreset,
  saveLineupPreset,
  setAutoTrainingConfig,
  setTrainingBookLoadout,
  trainingBookLoadout,
  changeMatchAutoSubs,
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
  startLegendChallenge,
  startNextSeasonAction,
  startPeakChallenge,
  startSingleChallenge,
  startTraining,
  startTrainingWithSupport,
  syncActiveEngine,
  trainingAction,
  trainingEventChoice,
  useCoachPause,
} from '../src/game/actions.ts'
import { dueRound, lineupLockState, matchdayCountdown, playerFixture, seasonRoundLabel, teamName } from '../src/game/season.ts'
import { displayEventHint, trainingLogText } from '../src/ui/format.ts'

export type AgentOutcome = { ok: boolean; error?: string; result?: unknown }

/** 服务器提供的共享世界信息：联机时有教练执教的球队不能直接买人（和转会页一致）。 */
export type AgentOptions = {
  isManaged?: (clubId: string) => boolean
  transferGame?: () => GameState
  /** 联机时用全服共享名册/自由市场解析球探目标；只读，不改账号存档。 */
  scoutGame?: () => GameState
  /** 联机时领先竞拍占用的资金，用于校验董事会滑块下限与档位下调。 */
  committedAuctions?: () => number
  clubId?: () => string | undefined
  teamsById?: () => Record<string, AITeam> | undefined
}

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
    detailedPositions: readDetailedPositions(card),
    personality: card.personality,
    skills: card.skills,
    skillTiers: card.skillTiers ?? {},
    equipped: owner?.equippedCardId === card.id,
    ownerInSquad: !!owner,
    recycleLocked: card.recycleLocked === true,
    recyclePoints: cardRecyclePoints(card),
  }
}

/** 球探报告只返回服务器已允许公开的字段；完成后附相对本队的明细位置星级。 */
function scoutReportView(report: VisibleScoutReport, game: GameState, now = Date.now()) {
  const full = 'estimatedAttrs' in report && report.estimatedAttrs && 'positions' in report && report.positions ? report as ScoutReport : undefined
  const positionRatings = full ? preferredPositionRatings({
    attrs: full.estimatedAttrs,
    positions: full.positions,
    ...(full.detailedPositions ? { detailedPositions: full.detailedPositions } : {}),
  }, game.roster).map(rating => ({
    position: rating.position,
    role: rating.role,
    roleLabel: ROLES[rating.role].label,
    score: Math.round(rating.score * 100) / 100,
    reference: Math.round(rating.reference * 100) / 100,
    stars: rating.stars,
  })) : null
  return { ...report, ready: !!full && report.readyAt <= now, ...(positionRatings ? { positionRatings } : {}) }
}

function scoutTarget(game: GameState, options: AgentOptions, body: Record<string, unknown>): { player?: GameState['roster'][number]; target?: ScoutTarget; error?: string } {
  const source = text(body.source) as ScoutSource
  if (!['club', 'transfer', 'market'].includes(source)) return { error: 'source 只能是 club、transfer 或 market' }
  const clubId = text(body.clubId || body.teamId).trim() || undefined
  const view = options.scoutGame?.() ?? game
  if (source === 'market') {
    const player = view.freeStars.find(item => item.id === text(body.playerId))
    return player ? { player, target: { source } } : { error: '球员不在自由市场' }
  }
  if (!clubId) return { error: '球队目标需要 clubId' }
  const team = view.aiTeams.find(item => item.id === clubId)
  if (!team) return { error: '找不到这支球队' }
  if (source === 'transfer' && options.isManaged?.(clubId)) return { error: '其他教练执教的球队请通过球队详情查看' }
  const found = team.players.find(item => item.id === text(body.playerId))
  if (!found) return { error: '球员不在该球队' }
  return { player: source === 'transfer' ? untrainedPlayer(found) : found, target: { source, clubId } }
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
    age: player.age ?? 24,
    ageProfile: ageProfileOf(player.age ?? 24, isGk),
    number: player.number,
    foot: player.foot,
    height: player.height,
    primaryPosition: primaryPosition(player),
    ca: displayCA(caOf(player.attrs, isGk)),
    initialCA: initialDisplayCA(player),
    youthOrigin: player.youthOrigin ?? null,
    positions: player.positions,
    detailedPositions: readDetailedPositions(player),
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
    /** 不满（拒绝了高价报价）：截止时间前精力恢复只剩一成。 */
    unhappy: player.unhappy ? { until: player.unhappy.until, reason: player.unhappy.reason } : null,
    injuryUntil: injuryUntil(game, player, now),
    equippedCardId: player.equippedCardId ?? null,
    cardIds: playerCards(game, player.id).map((card) => card.id),
    /** 估值（只看原始属性）；挂牌上限和买回价都用这个数。 */
    marketValue: bestMarketValue(game, player),
    contract: player.contract ? { wage: player.contract.wage, expiresSeason: player.contract.expiresSeason } : null,
  }
}

/** 自动培养设置，和培养页“自动策略”弹窗一致。 */
function autoTrainingView(game: GameState, playerId: string) {
  const { mode, priority, targets } = autoTrainingConfig(game, playerId)
  return { mode, priority, targets }
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
        ...(facility === 'stadium' ? { homeOnly: true, homeAtmosphereRating: Number(homeAtmosphereBonus(stage).toFixed(2)) } : {}),
        upgradeCost: facilityUpgradeCost(facility, stage),
      }
    }),
  }
}

function playerDetailView(player: GameState['roster'][number], game: GameState, now: number) {
  return {
    ...playerView(player, game, now),
    autoTraining: autoTrainingView(game, player.id),
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
    mode: active.context.mode ?? null,
    stage: active.context.stage ?? null,
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
    formationId: playerTeam.formationId,
    mentality: playerTeam.mentality ?? null,
    matchPlan: playerTeam.matchPlan ?? 'standard',
    activePlanPhase: playerTeam.activePlanPhase ?? null,
    activePlanPhaseLabel: playerTeam.activeRuleName ?? (matchPlanPhaseName(playerTeam.activePlanPhase) || null),
    planConditionFactor: playerTeam.planConditionFactor ?? null,
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
    mode: record.mode ?? null,
    stage: record.stage ?? null,
    round: record.round ?? null,
    homeName: record.homeName,
    awayName: record.awayName,
    score: record.score,
    shootout: record.shootout ?? null,
    result: record.result,
    autoSimulated: !!record.autoSimulated,
    bookDrops: (record.bookDrops ?? []).map((drop) => ({ ...drop, key: bookKey(drop), name: bookName(drop.id) })),
  }
}

function peakStageSummary(stage: number) {
  const def = PEAK_STAGES[stage - 1]
  if (!def) return null
  const reward = peakStageReward(stage)
  const book = peakSkillForStage(stage)
  return {
    stage: def.stage,
    targetCa: def.targetCa,
    kind: def.kind,
    club: def.team.club,
    clubEn: def.team.clubEn,
    season: def.team.season,
    tier: def.team.tier,
    formationId: def.team.formationId,
    reward: reward ? { kind: reward.kind, amount: reward.amount, shopPoints: peakStageShopPoints(stage), ...(reward.breakthroughCards ? { breakthroughCards: reward.breakthroughCards } : {}) } : null,
    peakSkillDrop: book ? { id: book.id, name: book.name, effect: book.effect } : null,
  }
}

function pveSummaryView(game: GameState, now: number) {
  const cleared = game.pve?.peak.cleared ?? 0
  const nextStage = cleared < PEAK_STAGE_COUNT ? cleared + 1 : null
  const legends = game.pve?.legends ?? {}
  return {
    peak: {
      cleared,
      nextStage,
      totalStages: PEAK_STAGE_COUNT,
      dailyLimit: PEAK_DAILY_LIMIT,
      dailyAttempts: peakDailyStatus(game, now),
      breakthroughCards: game.pve?.peak.breakthroughCards ?? 0,
      reward50Ready: peakRewardReady(game),
      reward50: game.pve?.peak.reward50 ?? null,
      currentStageDef: nextStage ? peakStageSummary(nextStage) : null,
    },
    legends: {
      total: LEGEND_TEAMS.length,
      beaten: Object.values(legends).filter((row) => row.won > 0).length,
      records: Object.fromEntries(Object.entries(legends).map(([id, row]) => [id, { ...row }])),
    },
  }
}

function pveCatalogView(game: GameState, now: number, body: Record<string, unknown>) {
  const summary = pveSummaryView(game, now)
  const stages = PEAK_STAGES.map((def) => peakStageSummary(def.stage)!)
  const legends = LEGEND_TEAMS.map((def) => {
    const drop = legendSkillForTeam(def.id)
    const record = legendRecordOf(game, def.id)
    return {
      id: def.id,
      club: def.club,
      clubEn: def.clubEn,
      season: def.season,
      coach: def.coach,
      tier: def.tier,
      formationId: def.formationId,
      note: def.note,
      dropSkill: drop ? { id: drop.id, name: drop.name, effect: drop.effect } : null,
      record,
    }
  })
  const rosterSeeds = new Set(game.roster.map((p) => p.seedId).filter(Boolean))
  const reward50Candidates = summary.peak.reward50Ready && pveContentReady()
    ? buildPeakTeam(PEAK_REWARD_STAGE).players.map((p) => ({
      templateId: p.id,
      name: p.name,
      enName: p.enName,
      primaryPosition: primaryPosition(p),
      ca: displayCA(caOf(p.attrs, p.positions.GK > 0)),
      traitName: traitNameOf(p.traitId),
      skills: p.skills,
      alreadyInSquad: rosterSeeds.has(p.id),
    }))
    : null
  const requestedStage = body.stage !== undefined ? Number(body.stage) : undefined
  const requestedLegendId = text(body.legendId)
  let preview: unknown = null
  if (pveContentReady() && requestedStage !== undefined && Number.isInteger(requestedStage) && requestedStage >= 1 && requestedStage <= PEAK_STAGE_COUNT) {
    const team = buildPeakTeam(requestedStage)
    preview = {
      kind: 'peak',
      stage: requestedStage,
      name: team.name,
      formationId: team.formationId,
      players: team.players.map((p) => ({ id: p.id, name: p.name, primaryPosition: primaryPosition(p), ca: displayCA(caOf(p.attrs, p.positions.GK > 0)), traitName: traitNameOf(p.traitId), skills: p.skills })),
    }
  } else if (pveContentReady() && requestedLegendId) {
    const team = legendTeamById(requestedLegendId)
    if (team) {
      preview = {
        kind: 'legend',
        legendId: requestedLegendId,
        name: team.name,
        formationId: team.formationId,
        players: team.players.map((p) => ({ id: p.id, name: p.name, primaryPosition: primaryPosition(p), ca: displayCA(caOf(p.attrs, p.positions.GK > 0)), traitName: traitNameOf(p.traitId), skills: p.skills })),
      }
    }
  }
  return {
    peak: { ...summary.peak, stages, ...(reward50Candidates ? { reward50Candidates } : {}) },
    legends: { total: summary.legends.total, beaten: summary.legends.beaten, teams: legends },
    ...(preview ? { preview } : {}),
  }
}

function eventView(session: TrainingSession, event: EventDef) {
  const gk = session.candidate.positions.GK > 0
  return {
    id: event.id, title: event.title, category: event.category, mainline: event.category === 'mainline', text: event.text,
    hintNote: session.scheduleVersion === 1 ? '提示为基础成长；低落情绪可能使正向属性成长减少 50%。' : null,
    options: event.options.map((option) => ({
      id: option.id, label: option.label, hint: displayEventHint(option.hint, gk, eventGrowthScale(session)),
      chanceText: option.book || option.trainingSkill ? '成功率' : option.branch?.chanceText ?? null,
      probability: option.trainingSkill ? Math.round(trainingSkillChance(session, option.trainingSkill) * 1000) / 1000 : option.book ? Math.round(bookLearnChance(session.candidate, option.book) * 1000) / 1000 : option.branch ? Math.round(branchProbability(session, option.branch.check, option.branch.p) * 1000) / 1000 : null,
      source: option.trainingSkill?.source ?? null,
      skillId: option.trainingSkill?.id ?? null,
      mentorName: option.trainingSkill?.source === 'teammate' ? option.trainingSkill.mentor.name : null,
      replaceOptions: option.trainingSkill && !canLearnSkill(session.candidate.skills, option.trainingSkill.id) ? session.candidate.skills.filter((id) => skillCategory(id) === skillCategory(option.trainingSkill!.id)) : [],
      successText: option.trainingSkill || option.book ? '学会技能；满槽时成功替换同类技能' : option.branch?.success.text ?? null,
      failureText: option.trainingSkill || option.book ? '原有技能与技能书保留' : option.branch?.failure.text ?? null,
    })),
  }
}

export function agentView(game: GameState, now = Date.now(), options: AgentOptions = {}) {
  const sessionView = Object.values(game.training).map((session) => {
    const player = game.roster.find((item) => item.id === session.playerId)
    const pending = session.pendingEventId ? eventForSession(session, session.pendingEventId) : undefined
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
      books: session.books ?? [],
      skillTeacherIds: session.skillTeacherIds ?? [],
      facilityLevels: session.facilityLevels ?? null,
      fatigue: session.fatigue,
      stamina: 100 - session.fatigue,
      energy: player?.energy ?? session.energy,
      completed: session.completed,
      cardId: session.cardId ?? null,
      routeId: session.routeId,
      routePoints: session.routePoints,
      qualityBonusPoints: session.qualityBonusPoints ?? 0,
      qualityChances: trainingQualityChances(session),
      nextEventChance: session.action >= trainingActionsTotal(session) ? null : eventChance(session, session.action + 1),
      candidate: playerView(session.candidate, game, now),
      autoTraining: autoTrainingView(game, session.playerId),
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
    trainingPoints: Number.isSafeInteger(game.trainingPoints) && (game.trainingPoints ?? 0) >= 0 ? game.trainingPoints ?? 0 : 0,
    trainingPointTiers: TRAINING_POINT_TIERS,
    seasonCups: game.world?.seasonCups ?? null,
    scouting: { levels: SCOUT_LEVELS, maxReports: MAX_SCOUT_REPORTS },
    scoutReports: visibleScoutReports(game, now).map(report => scoutReportView(report, game, now)),
    honors: {
      trophies: (game.pve?.trophies ?? []).map(trophy => ({ ...trophy })),
      cupCeilingBonus: cupCeilingBonus(game),
      cupCeilingClaims: { ...(game.pve?.cupCeilingClaims ?? {}) },
      seasonCupGoldClaims: { ...(game.pve?.seasonCupGoldClaims ?? {}) },
    },
    pve: pveSummaryView(game, now),
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
    board: (() => {
      const board = ensureBoard(game)
      syncBoardLockState(game)
      if (game.season.finished && !board.offseasonPreview) {
        refreshOffseasonBoardPreview(game, options.clubId?.(), options.teamsById?.())
      }
      const active = isBoardBudgetActive(game)
      const economy = economyOf(game)
      const committed = options.committedAuctions?.() ?? 0
      const effectiveWageCap = boardEffectiveWageCap(game)
      const commercialWageBonus = boardCommercialWageBonus(economy)
      const currentWageBill = worldWageBill(game)
      return {
        confidence: board.confidence,
        lastGrade: board.lastGrade ?? null,
        active,
        choiceMaxRound: BOARD_CHOICE_MAX_ROUND,
        sliderRatio: BOARD_WAGE_SLIDER_ROUNDS,
        canSwitchAmbition: canSwitchCurrentBoardAmbition(game),
        pendingChoice: board.pendingChoice ?? null,
        pendingChoicesByTier: board.pendingChoicesByTier ?? null,
        current: active && board.current ? {
          ...board.current,
          effectiveWageCap,
          commercialWageBonus,
          currentWageBill,
          wageHeadroom: effectiveWageCap === null ? null : effectiveWageCap - currentWageBill,
          sliderBounds: boardSliderBounds(game, committed),
        } : null,
        offseasonPreview: board.offseasonPreview ?? null,
        history: board.history,
      }
    })(),
    market: {
      transferWindowOpen: transferWindowOpen(game),
      /** 和转会页“从 AI 球队买人”同一份列表；用 preview_signing / sign_club_player 谈判。 */
      // 交易只转移原始球员，列表不展示对方装备卡的 CA / 属性 / 技能；非卖品 asking 为 null。
      clubOffers: aiTransferOffers(options.transferGame?.() ?? game, options.isManaged).map(({ team, player, asking, terms }) => ({
        teamId: team.id, teamName: team.name, player: playerView(untrainedPlayer(player), game, now), asking,
        status: terms.status, ageBand: terms.ageBand, minutesShare: Math.round(terms.minutesShare * 100) / 100, requiredPremium: terms.requiredPremium,
      })),
      freeAgents: game.freeStars.map((player) => ({ player: playerView(untrainedPlayer(player), game, now), price: bestMarketValue(game, player) })),
      listings: (game.market?.listings ?? []).map(({ player, price }) => ({ player: playerView(untrainedPlayer(player), game, now), price })),
    },
    // AI 俱乐部发来的报价：pending 的要在 expiresAt 前用 respond_offer 回复，过期算拒绝；高价（≥ 身价 1.3 倍）被拒绝球员会不满。
    transferOffers: (game.transferOffers ?? []).map((offer) => ({ ...offer, high: offer.amount >= offer.value * 1.3 })),
    teams: game.aiTeams.map((team) => ({ id: team.id, name: team.name, strength: team.strength, style: team.style, formationId: team.formationId })),
    youth: youthView(game, now),
    roster: game.roster.map((player) => playerView(player, game, now)),
    lineup: game.lineup,
    autoSubs: game.autoSubs ?? emptyAutoSubs(),
    autoSubErrors: validateAutoSubPlan(game.roster, game.lineup, game.autoSubs ?? emptyAutoSubs()),
    lineupAnalysis: {
      validation: lineupCheck,
      tacticalFamiliarity: computeLineupFamiliarity(game.roster, game.lineup, economyOf(game).tactics),
      ageSummary: lineupAgeAnalysis(game.roster, game.lineup),
      starters: slots.map((slot) => ({
        slotId: slot.slotId,
        position: slot.position,
        label: slot.label,
        playerId: slot.player?.id ?? null,
        playerName: slot.player?.name ?? null,
        role: slot.role,
        detailedPosition: detailedPositionForSlot({ id: slot.slotId, position: slot.position, label: slot.label }),
        proficiency: slot.player ? Math.round(slotPositionValue(slot.player, { id: slot.slotId, position: slot.position, label: slot.label })) : 0,
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
      slots: formation.slots.map((slot) => ({ id: slot.id, position: slot.position, label: slot.label, detailedPosition: detailedPositionForSlot(slot), defaultRole: slot.defaultRole })),
      defaultTactics: formation.defaultTactics,
    })),
    tacticalStyles: STYLE_LIST_REV3.map((style) => ({
      id: style.id,
      name: style.name,
      ...STYLE_META[style.id],
      instructions: style.instructions,
    })),
    matchPlans: MATCH_PLAN_LIST,
    backupTacticTemplates: BACKUP_TACTIC_TEMPLATES.map((tpl) => ({
      id: tpl.id,
      label: tpl.label,
      desc: tpl.desc,
      sample: tpl.build(`slot-${tpl.id}`),
    })),
    roles: ROLES_BY_POSITION,
    trainingSessions: sessionView,
    shop: {
      points: shopPointsOf(game),
      seasonIndex: shopSeasonIndex(game),
      price: SHOP_BOOK_PRICE,
      peakClaimedStages: (game.shop?.peakClaimedStages ?? []).length,
      seasonClaims: game.shop?.seasonClaims ?? {},
      catalog: shopCatalog(game.seed, shopSeasonIndex(game)).map((offer) => ({
        id: offer.id,
        key: bookKey(offer),
        name: bookName(offer.id),
        tier: offer.tier,
        scope: offer.scope,
        group: offer.group,
        category: offer.category,
        price: offer.price,
        owned: hasBookAtOrAbove(game, offer.id, 'gold'),
        effect: skillEffectText(offer.id, offer.tier),
        requirements: bookRequirementText(offer),
      })),
    },
    legendBooks: (game.legendBooks ?? []).map((book) => ({ ...book, key: bookKey(book), name: bookName(book.id), requirements: bookRequirementText(book) })),
    trainingBooksByPlayer: Object.fromEntries(game.roster.map((player) => [player.id, trainingBookLoadout(game, player.id)])),
    candidates: Object.values(game.candidates).map((player) => playerView(player, game, now)),
    cards: cardsOf(game).map((card) => cardView(card, game)),
    activeMatch: matchView(game),
    matchHistory: game.matchHistory.map(matchSummary),
    challengeHistory: game.challengeHistory.map(matchSummary),
    recentMatches: game.matchHistory.slice(0, 5).map(matchSummary),
    // 俱乐部页“历史成绩”：每个已完成赛季的级别、名次、战绩和冠军（只统计联赛）。
    seasonHistory: (game.seasonHistory ?? []).filter((season) => season.index !== game.season.index).map((season) => {
      const position = season.table.findIndex((row) => row.teamId === 'player')
      const row = position >= 0 ? season.table[position] : null
      return {
        index: season.index, tier: season.tier ?? null, conference: season.conference ?? null,
        finish: season.playerFinish ?? (position >= 0 ? position + 1 : null), teams: season.table.length,
        record: row ? { played: row.played, won: row.won, drawn: row.drawn, lost: row.lost, gf: row.gf, ga: row.ga, points: row.points } : null,
        champion: season.champion === 'player' ? game.clubName : season.champion ? (game.world?.clubs.find((club) => club.id === season.champion)?.name ?? teamName(game, season.champion)) : null,
        wonTitle: season.champion === 'player',
      }
    }),
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
    if (!Object.keys(request).every(key => ['kind', 'activityId', 'teammateIds', 'position', 'detailed', 'mentorId', 'skill', 'replaceSkill'].includes(key))) return null
    const activityId = text(request.activityId)
    if (!activityId.trim()) return null
    if (request.detailed !== undefined && typeof request.detailed !== 'boolean') return null
    if (request.position !== undefined && !isDetailedPosition(request.position) && !(POSITIONS as readonly string[]).includes(text(request.position))) return null
    if (request.detailed === true && request.position !== undefined && !isDetailedPosition(request.position)) return null
    if (request.mentorId !== undefined && !text(request.mentorId).trim()) return null
    if (request.skill !== undefined && !Object.hasOwn(SKILLS, text(request.skill))) return null
    if (request.replaceSkill !== undefined && !Object.hasOwn(SKILLS, text(request.replaceSkill))) return null
    return { kind, activityId: activityId as TrainingActivityId, ...teammates,
      ...(request.position === undefined ? {} : { position: request.position as Position | DetailedPosition }),
      ...(request.detailed === undefined ? {} : { detailed: request.detailed as boolean }),
      ...(request.mentorId === undefined ? {} : { mentorId: request.mentorId as string }),
      ...(request.skill === undefined ? {} : { skill: request.skill as SkillId }),
      ...(request.replaceSkill === undefined ? {} : { replaceSkill: request.replaceSkill as SkillId }) }
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
    if (request.detailed !== undefined && typeof request.detailed !== 'boolean') return null
    if (request.detailed === true && !isDetailedPosition(position)) return null
    return isDetailedPosition(position) || (POSITIONS as readonly string[]).includes(position)
      ? { kind, position: position as Position | DetailedPosition, ...(request.detailed === undefined ? {} : { detailed: request.detailed as boolean }) }
      : null
  }
  if (kind === 'protection') {
    const focus = text(request.focus)
    return focus === 'prevention' || focus === 'resilience' ? { kind, focus } : null
  }
  if (kind === 'inherit') {
    const mentorId = text(request.mentorId)
    const skill = text(request.skill)
    const replaceSkill = request.replaceSkill === undefined ? undefined : text(request.replaceSkill)
    if (replaceSkill !== undefined && !Object.hasOwn(SKILLS, replaceSkill)) return null
    return mentorId && Object.hasOwn(SKILLS, skill)
      ? { kind, mentorId, skill: skill as SkillId, ...(replaceSkill ? { replaceSkill: replaceSkill as SkillId } : {}) }
      : null
  }
  if (kind === 'rest' || kind === 'mentor') return { kind }
  return null
}

function parseLineup(game: GameState, value: unknown): { lineup?: Lineup; error?: string } {
  const raw = asRecord(value)
  const formationId = text(raw.formationId) as FormationId
  const formation = FORMATIONS[formationId]
  if (!formation) return { error: '无效阵容；需要合法 formationId、starters[{slotId,playerId,role}] 与 bench[playerId]' }
  if (!Array.isArray(raw.starters) || !Array.isArray(raw.bench)) {
    return { error: '无效阵容；需要合法 formationId、starters[{slotId,playerId,role}] 与 bench[playerId]' }
  }
  const starters: Lineup['starters'] = []
  for (const entry of raw.starters) {
    const starter = asRecord(entry)
    const slotId = text(starter.slotId)
    const playerId = text(starter.playerId)
    const slot = formation.slots.find((item) => item.id === slotId)
    if (!slot || !playerId) {
      return { error: '无效阵容；需要合法 formationId、starters[{slotId,playerId,role}] 与 bench[playerId]' }
    }
    const role = text(starter.role) as RoleId
    starters.push({ slotId, playerId, role: ROLES[role]?.position === slot.position ? role : slot.defaultRole })
  }

  let tacticalStyle: StyleId | undefined = game.lineup.tacticalStyle
  let tacticalInstructions: TacticalInstructionsV2 | undefined = game.lineup.tacticalInstructions
    ? cloneInstructions(game.lineup.tacticalInstructions)
    : undefined
  let matchPlan: MatchPlanId | undefined = game.lineup.matchPlan
  let tactics: Tactics = isTactics(raw.tactics) ? raw.tactics : game.lineup.tactics

  if (raw.matchPlan !== undefined) {
    if (raw.matchPlan === null || raw.matchPlan === 'standard') {
      matchPlan = undefined
    } else if (!isMatchPlanId(raw.matchPlan)) {
      return { error: `未知比赛计划：${String(raw.matchPlan)}` }
    } else {
      matchPlan = raw.matchPlan
    }
  }

  if (raw.tacticalStyle !== undefined && raw.tacticalStyle !== null && !isStyleId(raw.tacticalStyle)) {
    return { error: `未知战术风格：${String(raw.tacticalStyle)}` }
  }

  if (raw.tacticalInstructions !== undefined) {
    if (raw.tacticalInstructions === null) {
      tacticalInstructions = undefined
      if (raw.tacticalStyle === undefined || raw.tacticalStyle === null) tacticalStyle = undefined
    } else {
      const check = tryValidateInstructions(raw.tacticalInstructions)
      if (!check.ok) return { error: `战术指令无效：${check.error}` }
      tacticalInstructions = check.value
      tacticalStyle = isStyleId(raw.tacticalStyle) ? raw.tacticalStyle : inferStyleForInstructions(check.value).styleId
      tactics = legacyTacticsFromInstructions(check.value)
    }
  } else if (raw.tacticalStyle !== undefined) {
    if (raw.tacticalStyle === null) {
      tacticalStyle = undefined
      tacticalInstructions = undefined
    } else {
      tacticalStyle = raw.tacticalStyle
      tacticalInstructions = cloneInstructions(styleByRevision(raw.tacticalStyle, 3).instructions)
      tactics = legacyTacticsFromInstructions(tacticalInstructions)
    }
  } else if (isTactics(raw.tactics) && tacticalInstructions) {
    const prevTactics = game.lineup.tactics
    const tacticsChanged = raw.tactics.attack !== prevTactics.attack
      || raw.tactics.passing !== prevTactics.passing
      || raw.tactics.tempo !== prevTactics.tempo
      || raw.tactics.line !== prevTactics.line
      || raw.tactics.press !== prevTactics.press
    if (tacticsChanged) {
      tacticalInstructions = instructionsFromLegacyTactics(raw.tactics, tacticalInstructions)
      tactics = legacyTacticsFromInstructions(tacticalInstructions)
    }
  }

  let backupTactics: BackupTactic[] | undefined = game.lineup.backupTactics?.length
    ? structuredClone(game.lineup.backupTactics)
    : undefined
  let matchPlanRules: MatchPlanRule[] | undefined = game.lineup.matchPlanRules?.length
    ? structuredClone(game.lineup.matchPlanRules)
    : undefined

  if (raw.backupTactics !== undefined) {
    if (raw.backupTactics === null) {
      backupTactics = undefined
    } else {
      const errors = validateBackupTactics(raw.backupTactics)
      if (errors.length) return { error: `备选战术槽无效：${errors.join('；')}` }
      backupTactics = structuredClone(raw.backupTactics as BackupTactic[])
      if (!backupTactics.length) backupTactics = undefined
    }
  }

  if (raw.matchPlanRules !== undefined) {
    if (raw.matchPlanRules === null) {
      matchPlanRules = undefined
    } else {
      const errors = validateMatchPlanRules(raw.matchPlanRules, backupTactics)
      if (errors.length) return { error: `自定义比赛计划无效：${errors.join('；')}` }
      matchPlanRules = structuredClone(raw.matchPlanRules as MatchPlanRule[])
      if (!matchPlanRules.length) matchPlanRules = undefined
    }
  } else if (matchPlanRules?.length) {
    const errors = validateMatchPlanRules(matchPlanRules, backupTactics)
    if (errors.length) return { error: `自定义比赛计划与新备选战术槽不兼容：${errors.join('；')}` }
  }

  const next: Lineup = {
    formationId,
    starters,
    bench: raw.bench.map((id) => text(id)).filter(Boolean),
    tactics,
    ...(tacticalStyle ? { tacticalStyle } : {}),
    ...(tacticalInstructions ? { tacticalInstructions } : {}),
    ...(matchPlan ? { matchPlan } : {}),
    ...(backupTactics?.length ? { backupTactics } : {}),
    ...(matchPlanRules?.length ? { matchPlanRules } : {}),
  }
  if (raw.customPositions !== undefined) {
    if (raw.customPositions !== null) {
      if (typeof raw.customPositions !== 'object' || Array.isArray(raw.customPositions)) {
        return { error: 'customPositions 必须是槽位坐标映射对象' }
      }
      const slotIds = new Set(formation.slots.map((slot) => slot.id))
      for (const [slotId, spotValue] of Object.entries(raw.customPositions as Record<string, unknown>)) {
        if (!slotIds.has(slotId)) return { error: `自定义位置包含不在当前阵型中的槽位：${slotId}` }
        const spot = asRecord(spotValue)
        const x = spot.x
        const y = spot.y
        if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
          return { error: `自定义位置坐标无效：${slotId}` }
        }
        const clampedX = Math.round(Math.min(0.79, Math.max(0.02, x)) * 1000) / 1000
        const clampedY = Math.round(Math.min(0.98, Math.max(0.02, y)) * 1000) / 1000
        setSlotPosition(next, slotId, { x: clampedX, y: clampedY })
      }
    }
  } else if (game.lineup.customPositions && game.lineup.formationId === formationId) {
    next.customPositions = structuredClone(game.lineup.customPositions)
  }
  if (game.lineup.presets?.length) {
    next.presets = structuredClone(game.lineup.presets)
  }
  return { lineup: next }
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

const SEASON_GOALS = Object.keys(SEASON_GOAL_LABELS) as SeasonGoal[]
const SQUAD_ROLES = Object.keys(SQUAD_ROLE_LABELS) as SquadRole[]
const AUTO_TARGET_MAX = MAIN_ATTR_HARD_MAX

/** 谈判时的承诺；不填和手动谈判框的默认值一样（冲击上游 / 常规首发）。 */
function negotiationAnswers(body: Record<string, unknown>): { goal: SeasonGoal; role: SquadRole } | null {
  const goal = body.goal === undefined ? 'promotion' : text(body.goal) as SeasonGoal
  const role = body.role === undefined ? 'first-team' : text(body.role) as SquadRole
  return SEASON_GOALS.includes(goal) && SQUAD_ROLES.includes(role) ? { goal, role } : null
}

function findClubOffer(game: GameState, body: Record<string, unknown>, options: AgentOptions) {
  const teamId = text(body.teamId)
  const playerId = text(body.playerId)
  return aiTransferOffers(game, options.isManaged).find((offer) => offer.team.id === teamId && offer.player.id === playerId)
}

function parseAutoTrainingPatch(game: GameState, playerId: string, body: Record<string, unknown>): Partial<TrainingAutoConfig> | string {
  const player = game.roster.find((item) => item.id === playerId)
  if (!player) return '球员不存在'
  const patch: Partial<TrainingAutoConfig> = {}
  if (body.mode !== undefined) {
    if (body.mode !== 'priority' && body.mode !== 'targets' && body.mode !== 'max') return 'mode 只能是 priority、targets 或 max'
    patch.mode = body.mode
  }
  if (body.resetPriority === true) patch.priority = defaultAutoPriority(player)
  else if (body.priority !== undefined) {
    if (!Array.isArray(body.priority) || body.priority.some((key) => !(ALL_ATTRIBUTES as readonly unknown[]).includes(key))) return 'priority 必须是属性英文名数组'
    patch.priority = [...new Set(body.priority as AttrKey[])]
  }
  if (body.targets !== undefined) {
    const raw = asRecord(body.targets)
    const targets: Partial<Record<AttrKey, number>> = { ...autoTrainingConfig(game, playerId).targets }
    for (const [key, value] of Object.entries(raw)) {
      if (!(ALL_ATTRIBUTES as readonly string[]).includes(key) || typeof value !== 'number' || !Number.isFinite(value)) return `无效的目标属性：${key}`
      targets[key as AttrKey] = Math.round(Math.max(0, Math.min(AUTO_TARGET_MAX, value)))
    }
    patch.targets = targets
  }
  return patch
}

function findRecord(game: GameState, id: string) {
  return [...game.matchHistory, ...game.challengeHistory].find((record) => record.id === id)
}

export function applyAgentAction(game: GameState, rawBody: unknown, now = Date.now(), options: AgentOptions = {}): AgentOutcome {
  const rawAction = (rawBody as { action?: unknown } | null)?.action
  if ((rawAction === 'auto_lineup' || rawAction === 'set_lineup' || rawAction === 'apply_lineup_preset' || rawAction === 'set_auto_subs') && lineupLockState(game, now).locked) {
    return { ok: false, error: '阵容已锁定：开赛前 30 分钟内不能修改，比赛由服务器自动结算' }
  }
  const body = asRecord(rawBody)
  const action = text(body.action)
  switch (action) {
    case 'youth_action': return applyYouthAction(game, body.youth, now)
    case 'get_player': {
      const player = game.roster.find((item) => item.id === text(body.playerId))
      return player ? { ok: true, result: playerDetailView(player, game, now) } : { ok: false, error: '球员不存在' }
    }
    case 'start_next_season': {
      const result = startNextSeasonAction(game, now)
      return { ...result, result }
    }
    case 'set_training_books': {
      if (!Array.isArray(body.bookKeys) || body.bookKeys.some((key) => typeof key !== 'string')) return { ok: false, error: 'bookKeys 必须是技能书 key 数组' }
      const result = setTrainingBookLoadout(game, text(body.playerId), body.bookKeys as string[])
      return { ...result, result }
    }
    case 'buy_shop_book': {
      const skillId = text(body.skillId)
      if (!skillId) return { ok: false, error: 'skillId 不能为空' }
      const result = buyShopBook(game, skillId)
      return result.ok ? { ok: true, result } : result
    }
    case 'start_training': {
      // 省略 bookKeys 时使用该球员已保存的配置。
      if (body.bookKeys !== undefined && (!Array.isArray(body.bookKeys) || body.bookKeys.some((key) => typeof key !== 'string'))) return { ok: false, error: 'bookKeys 必须是技能书 key 数组' }
      const points = body.points === undefined ? 0 : body.points
      if (typeof points !== 'number' || !Number.isSafeInteger(points) || !TRAINING_POINT_TIERS.some(tier => tier.points === points)) return { ok: false, error: 'points 只能是 0、10、20 或 30' }
      const result = startTrainingWithSupport(game, text(body.playerId), undefined, body.bookKeys as string[] | undefined, points)
      return { ...result, result: result.ok ? { ok: true, pointsSpent: points, trainingPoints: game.trainingPoints ?? 0 } : result }
    }
    case 'recycle_cards': {
      if (!Array.isArray(body.cardIds) || body.cardIds.some(id => typeof id !== 'string')) return { ok: false, error: 'cardIds 必须是球员卡 ID 数组' }
      const result = recyclePlayerCards(game, body.cardIds as string[])
      if (result.ok) {
        const privateGame = game as GameState & { recycledCardIds?: string[] }
        privateGame.recycledCardIds = [...new Set([...(privateGame.recycledCardIds ?? []), ...body.cardIds as string[]])]
      }
      return result.ok ? { ok: true, result: { ...result, trainingPoints: game.trainingPoints ?? 0 } } : result
    }
    case 'lock_card': {
      if (typeof body.locked !== 'boolean') return { ok: false, error: 'locked 必须是布尔值' }
      const result = setCardRecycleLock(game, text(body.cardId), body.locked)
      return { ...result, result }
    }
    case 'start_scouting': {
      const resolved = scoutTarget(game, options, body)
      if (!resolved.player || !resolved.target) return { ok: false, error: resolved.error ?? '球探目标无效' }
      if (game.roster.some(item => item.id === resolved.player!.id)) return { ok: false, error: '不能考察本队球员' }
      const result = startScouting(game, resolved.player, resolved.target, body.level, now)
      if (!result.ok || !result.report) return { ok: false, error: result.error ?? '无法发起球探考察' }
      const report = scoutReportView(visibleScoutReports(game, now).find(item => item.id === result.report!.id)!, game, now)
      return { ok: true, result: { report, trainingPoints: game.trainingPoints ?? 0, balance: economyOf(game).balance } }
    }
    case 'get_scout_reports': {
      return { ok: true, result: { levels: SCOUT_LEVELS, maxReports: MAX_SCOUT_REPORTS, reports: visibleScoutReports(game, now).map(report => scoutReportView(report, game, now)) } }
    }
    case 'delete_scout_report': {
      const result = deleteScoutReport(game, body.reportId, now)
      return result.ok ? { ok: true, result: { ...result, reports: visibleScoutReports(game, now).map(report => scoutReportView(report, game, now)) } } : result
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
      const result = trainingAction(game, playerId, request, now)
      const session = game.training[playerId]
      // Group results may contain unfiltered events or hidden gains; expose only the primary result.
      const visible = { ok: result.ok, error: result.error, completed: result.completed, event: result.event && session ? eventView(session, result.event) : null, exchange: result.exchange }
      return { ...visible, result: visible }
    }
    case 'training_event_choice': {
      const playerId = text(body.playerId)
      const session = game.training[playerId]
      const pending = session?.pendingEventId ? eventForSession(session, session.pendingEventId) : undefined
      const event = pending && session ? eventView(session, pending) : undefined
      const replaceSkill = typeof body.replaceSkill === 'string' ? body.replaceSkill as SkillId : undefined
      const result = trainingEventChoice(game, playerId, text(body.optionId), replaceSkill)
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
    case 'board_choose_ambition': {
      const ambition = body.ambition
      if (!isBoardAmbition(ambition)) return { ok: false, error: 'ambition 只能是 safe / expected / ambitious' }
      const scope = body.scope === 'offseason' || body.scope === 'current' ? body.scope : undefined
      if (body.scope !== undefined && !scope) return { ok: false, error: 'scope 只能是 offseason 或 current' }
      const tier = isBoardTier(body.tier) ? body.tier : undefined
      if (body.tier !== undefined && !tier) return { ok: false, error: 'tier 只能是 division2 / division1 / champions' }
      if (body.lock !== undefined && typeof body.lock !== 'boolean') return { ok: false, error: 'lock 必须是布尔值' }
      const result = chooseBoardAmbition(game, ambition, {
        ...(scope ? { scope } : {}),
        ...(tier ? { tier } : {}),
        ...(body.lock === true ? { lock: true } : {}),
        committedAuctions: options.committedAuctions?.() ?? 0,
        clubId: options.clubId?.(),
        teamsById: options.teamsById?.(),
      })
      return result.ok ? { ok: true, result: { ok: true, board: game.board } } : result
    }
    case 'board_adjust_budget': {
      const delta = body.transferDelta
      if (typeof delta !== 'number' || !Number.isSafeInteger(delta)) return { ok: false, error: 'transferDelta 必须是整数' }
      const result = adjustBoardBudgetSlider(game, delta, options.committedAuctions?.() ?? 0)
      return result.ok ? { ok: true, result: { ...result, current: game.board?.current ?? null } } : result
    }
    case 'pay_wage_arrears': {
      // 欠薪期间球员只发挥一半；余额够时一次补清（和总览的「补发欠薪」按钮一样）。
      const result = payWageArrears(game)
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
    case 'preview_signing': {
      const offer = findClubOffer(game, body, options)
      if (!offer) return { ok: false, error: '这名球员不在本联赛 AI 球队的名单里（见 state.market.clubOffers）' }
      const answers = negotiationAnswers(body)
      if (!answers) return { ok: false, error: `goal 只能是 ${SEASON_GOALS.join('/')}，role 只能是 ${SQUAD_ROLES.join('/')}` }
      const amount = body.offer === undefined ? offer.asking ?? offer.terms.value : Number(body.offer)
      if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, error: '报价必须是正整数' }
      const preview = previewClubSigning(game, offer.team, offer.player, amount, answers)
      const demands = preview.player.demands
      return {
        ok: true,
        result: {
          teamId: offer.team.id, playerId: offer.player.id, playerName: offer.player.name,
          value: preview.value, asking: preview.asking, forSale: preview.forSale, offer: amount, balance: economyOf(game).balance, answers,
          // 俱乐部这关：主力 / 轮换 / 冷板凳、年龄段、最近出场占比、要求的溢价、点头概率和理由。
          club: { ...preview.club, chance: Math.round(preview.club.chance * 1000) / 1000, minutesShare: Math.round(preview.club.minutesShare * 100) / 100 },
          // 球员这关：他想听的目标 / 定位、想去的球队和最低联赛级别。
          demands: { goal: demands.goal, role: demands.role, minTier: demands.minTier, wantsClubName: demands.wantsClubId && demands.wantsClubId !== 'player' ? demands.wantsClubName : null },
          clubTier: game.season.tier ?? 'division2',
          playerChance: Math.round(preview.player.chance * 1000) / 1000,
          reasons: preview.player.reasons,
          chance: Math.round(preview.chance * 1000) / 1000,
        },
      }
    }
    case 'renew_contract': {
      // 和俱乐部页“续约 2 年”一致。
      const result = renewContract(game, text(body.playerId), 2)
      return result.ok ? { ok: true, result: game.roster.find((player) => player.id === text(body.playerId))?.contract ?? null } : result
    }
    case 'release_player': {
      const result = releasePlayer(game, text(body.playerId))
      return result.ok ? { ok: true, result } : result
    }
    case 'set_auto_training': {
      const playerId = text(body.playerId)
      const patch = parseAutoTrainingPatch(game, playerId, body)
      if (typeof patch === 'string') return { ok: false, error: patch }
      setAutoTrainingConfig(game, playerId, patch)
      return { ok: true, result: autoTrainingView(game, playerId) }
    }
    case 'run_auto_training': {
      // 和培养页的“自动培养”开关一样：只推进进行中的一轮，不会自己开始新一轮。
      const playerId = text(body.playerId)
      if (!autoTrainingRunnable(game, playerId)) return { ok: false, error: '没有进行中的培养：先 start_training，或先处理已完成的培养结果' }
      const rawSteps = Number(body.maxSteps ?? 60)
      const maxSteps = Math.max(1, Math.min(200, Number.isFinite(rawSteps) ? Math.floor(rawSteps) : 60))
      const steps: { kind: string; label: string | null }[] = []
      let completed = false
      while (steps.length < maxSteps && autoTrainingRunnable(game, playerId)) {
        const step = autoTrainingStep(game, playerId)
        if (!step.ok) return { ok: false, error: `自动培养已停止：${step.error ?? '无法继续'}`, result: { steps, completed } }
        steps.push({ kind: step.kind, label: step.label ?? null })
        if (step.completed) { completed = true; break }
      }
      return { ok: true, result: { steps, completed: completed || !!game.training[playerId]?.completed } }
    }
    case 'auto_lineup': {
      const requested = text(body.formationId)
      if (requested && (!FORMATIONS[requested as FormationId] || isLegacyFormation(requested))) {
        return { ok: false, error: `无效阵型：可选 ${FORMATION_LIST.map((formation) => formation.id).join(' / ')}` }
      }
      const formationId = requested ? requested as FormationId : game.lineup.formationId
      const result = autoLineup(game, formationId)
      return result.ok ? { ok: true, result: game.lineup } : { ok: false, error: result.errors.join('；') }
    }
    case 'set_lineup': {
      const parsed = parseLineup(game, body.lineup)
      if (!parsed.lineup) return { ok: false, error: parsed.error ?? '无效阵容；需要合法 formationId、starters[{slotId,playerId,role}] 与 bench[playerId]' }
      const result = setLineup(game, parsed.lineup, body.autoSubs === undefined ? game.autoSubs ?? emptyAutoSubs() : body.autoSubs)
      return result.ok ? { ok: true, result: game.lineup } : { ok: false, error: result.errors.join('；') }
    }
    case 'save_lineup_preset': {
      if (body.overwrite !== undefined && typeof body.overwrite !== 'boolean') {
        return { ok: false, error: 'overwrite 必须是布尔值' }
      }
      if (body.presetId !== undefined && typeof body.presetId !== 'string') {
        return { ok: false, error: 'presetId 必须是字符串' }
      }
      if (body.name !== undefined && typeof body.name !== 'string') {
        return { ok: false, error: 'name 必须是字符串' }
      }
      const presetId = body.presetId === undefined ? undefined : body.presetId.trim()
      if (body.presetId !== undefined && !presetId) {
        return { ok: false, error: 'presetId 不能为空' }
      }
      let targetLineup: Lineup | undefined
      if (body.lineup !== undefined) {
        const parsed = parseLineup(game, body.lineup)
        if (!parsed.lineup) return { ok: false, error: parsed.error ?? '无效阵容；需要合法 formationId、starters[{slotId,playerId,role}] 与 bench[playerId]' }
        targetLineup = parsed.lineup
      }
      const result = saveLineupPreset(game, {
        ...(presetId !== undefined ? { presetId } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        overwrite: body.overwrite === true,
        ...(targetLineup ? { lineup: targetLineup } : {}),
        now,
      })
      return result.ok
        ? { ok: true, result: { preset: result.preset, overwritten: !!result.overwritten, presets: game.lineup.presets ?? [] } }
        : { ok: false, error: result.error }
    }
    case 'apply_lineup_preset': {
      const presetId = text(body.presetId).trim()
      if (!presetId) return { ok: false, error: '请提供 presetId（来自 state.lineup.presets[].id）' }
      const result = applyLineupPreset(game, presetId, body.autoSubs)
      return result.ok
        ? { ok: true, result: { preset: result.preset, lineup: game.lineup, autoSubs: game.autoSubs ?? emptyAutoSubs(), clearedAutoSubs: !!result.clearedAutoSubs } }
        : { ok: false, error: result.error }
    }
    case 'rename_lineup_preset': {
      const presetId = text(body.presetId).trim()
      if (!presetId) return { ok: false, error: '请提供 presetId（来自 state.lineup.presets[].id）' }
      if (typeof body.name !== 'string') return { ok: false, error: '请提供新的战术名称 name' }
      const result = renameLineupPreset(game, presetId, body.name)
      return result.ok
        ? { ok: true, result: { preset: result.preset, presets: game.lineup.presets ?? [] } }
        : { ok: false, error: result.error }
    }
    case 'delete_lineup_preset': {
      const presetId = text(body.presetId).trim()
      if (!presetId) return { ok: false, error: '请提供 presetId（来自 state.lineup.presets[].id）' }
      const result = deleteLineupPreset(game, presetId)
      return result.ok
        ? { ok: true, result: { deleted: true, presetId, presets: game.lineup.presets ?? [] } }
        : { ok: false, error: result.error }
    }
    case 'set_auto_subs': {
      const result = setAutoSubs(game, body.plan)
      return result.ok ? { ok: true, result: game.autoSubs } : { ok: false, error: result.errors.join('；') }
    }
    case 'start_league': {
      // 联机比赛由共享世界时钟控制：本轮还没到开赛时间就不能提前开打。
      if (game.season.round > dueRound(game, now)) {
        return { ok: false, error: `第 ${game.season.round} 轮还没开始：距下一轮 ${matchdayCountdown(game, now)}` }
      }
      const result = startLeague(game, now)
      return { ...result, result: result.ok ? matchView(game) : undefined }
    }
    case 'start_friendly': {
      const result = startSingleChallenge(game, text(body.teamId), now)
      return { ...result, result: result.ok ? matchView(game) : undefined }
    }
    case 'get_pve': {
      return { ok: true, result: pveCatalogView(game, now, body) }
    }
    case 'start_peak_challenge': {
      ensurePve(game)
      const cleared = game.pve?.peak.cleared ?? 0
      const stage = body.stage === undefined ? Math.min(PEAK_STAGE_COUNT, cleared + 1) : Number(body.stage)
      const result = startPeakChallenge(game, stage, now)
      return { ...result, result: result.ok ? matchView(game) : undefined }
    }
    case 'start_legend_challenge': {
      const legendId = text(body.legendId)
      if (!legendId) return { ok: false, error: '请提供 legendId（来自 get_pve 的 legends.teams[].id）' }
      const result = startLegendChallenge(game, legendId, now)
      return { ...result, result: result.ok ? matchView(game) : undefined }
    }
    case 'use_peak_breakthrough': {
      const playerId = text(body.playerId)
      const attr = text(body.attr)
      if (!playerId) return { ok: false, error: '请提供 playerId' }
      if (!(ALL_ATTRIBUTES as readonly string[]).includes(attr)) return { ok: false, error: '无效的属性名' }
      const result = applyPeakBreakthrough(game, playerId, attr as AttrKey)
      return { ...result, result }
    }
    case 'claim_peak_reward': {
      const templateId = text(body.templateId)
      if (!templateId) return { ok: false, error: '请提供 templateId（来自 get_pve 的 peak.reward50Candidates[].templateId）' }
      const result = claimPeakReward(game, templateId)
      return result.ok ? { ok: true, result: { player: playerView(result.player, game, now) } } : result
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
    case 'set_match_auto_subs': {
      if (!game.activeMatch) return { ok: false, error: '当前没有进行中的比赛' }
      const engine = restoreActiveEngine(game)
      if (!engine) return { ok: false, error: '无法恢复比赛引擎' }
      const rawPlan = body.plan ?? body.autoSubs
      const syncDefault = body.syncDefault === true && !lineupLockState(game, now).locked
      const result = changeMatchAutoSubs(game, engine, rawPlan as Parameters<typeof changeMatchAutoSubs>[2], syncDefault)
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
      if (!game.activeMatch) return { ok: false, error: '当前没有进行中的比赛' }
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
