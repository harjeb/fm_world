import { ALL_ATTRIBUTES, type AITeam, type AttrKey, type Attributes, type AutoSubPlan, type AutoTrainingPresetId, type EventDef, type EventEffect, type EventOption, type GameState, type Lineup, type MatchMentality, type MatchRecord, type Player, type Position, type TrainingAutoConfig, type TrainingExchange, type TrainingSession } from './types.ts'
import type { GameEngine } from './pes/engine.ts'
import { restoreEngine } from './pes/engine.ts'
import { MatchEngine as Engine } from './match/engine.ts'
import type { MatchState } from './match/types.ts'
import { branchProbability, createTrainingSession, FAILURE_STAMINA, failureChance, partnersAt, plainChance, planTraining, performTrainingAction, trainingActionsForSeason, trainingActionsTotal, trainingFatigueCost, resolveTrainingEvent, confirmCandidate, discardCandidate, keepCandidate, TRAINING_ENERGY_COST, type PerformResult, type ResolveResult, type TrainingRequest, type TrainingPlan } from './training.ts'
import { addTrainedCard, closeFinishedTraining, deleteCard, equipCard, untrainedPlayer, type CardOutcome } from './cards.ts'
import { newTrainingSeed, saveGame } from './state.ts'
import { nextSeasonCountdown } from './season.ts'
import { seasonEndAt } from './calendar.ts'
import { autoFillLineup, bestRoleForPlayer, validateLineup } from './squad.ts'
import { FORMATIONS } from './data/formations.ts'
import { caOf, positionMultiplier } from './ca.ts'
import { lineupRating } from './club-rating.ts'
import { advanceSeasonRound, finishActiveMatch, skipToMatchday, startChallenge, startChallengeAgainstTeam, startLeagueMatch, startNextSeason } from './season.ts'
import { cachedOwnerlessTeams } from './world.ts'
import { legendTeamById } from './legend.ts'
import { PEAK_STAGE_COUNT, buildPeakTeam } from './peak.ts'
import { ensurePve } from './pve.ts'
import { cupPlayerFixture, cupTeam, enterCup } from './cup-run.ts'
import type { CupId } from './data/cup-config.ts'
import { emptyAutoSubs, validateAutoSubPlan } from './match/management.ts'
import { injuryUntil, recordMatchInjuries } from './injury.ts'
import { economyOf } from './economy.ts'
import { isCooperativeActivity, partnerAssignment, trainingDate, trainingOptions, type TrainingActivity } from './training-calendar.ts'
import { recordTrainingChemistry } from './chemistry.ts'
import { derivedRng, splitSeed } from './rng.ts'
import { teamInputFromAI, teamInputFromLineup, withChemistry } from './match/setup.ts'
import { leagueMatchClockAt } from './realtime.ts'
import { eventById } from './data/events.ts'
import { attrLabel } from './data/attributes.ts'
import { keyAttrsOf } from './data/key-attrs.ts'
import { isGoalkeeper } from './ca.ts'
import { bookLearnChance, canUseBookOnPlayer, eventForSession } from './legend-learning.ts'
import { cupCeilingBonus, effectiveTrainingCeilings } from './cup-rewards.ts'
import { MAIN_ATTR_HARD_MAX, mainAttrsFor } from './rating.ts'
import { settleEnergy } from './energy.ts'

export function startTraining(game: GameState, playerId: string, seed?: number, bookKeys?: string[]): { ok: boolean; error?: string } {
  const running = game.training[playerId]
  if (running && !running.completed) return { ok: false, error: '该球员已有一轮培养' }
  const player = game.roster.find((item) => item.id === playerId)
  if (!player) return { ok: false, error: '球员不存在' }
  settleEnergy(player, Date.now())
  const energy = player.energy ?? 100
  if (!Number.isFinite(energy) || energy < TRAINING_ENERGY_COST) {
    const unhappy = player.unhappy ? `（他正在闹情绪：${player.unhappy.reason}，精力恢复很慢）` : ''
    return { ok: false, error: `精力不足：开始一轮培养需要 ${TRAINING_ENERGY_COST} 点，当前 ${Math.round(energy)} 点；每个游戏日恢复 50 点${unhappy}。` }
  }
  // 上一轮的新卡已经在库存里，不需要先处理结果页才能开始下一轮。
  if (running?.completed || game.candidates[playerId]) closeFinishedTraining(game, playerId)
  player.energy = Math.max(0, energy - TRAINING_ENERGY_COST)
  const economy = economyOf(game)
  const keys = [...new Set(bookKeys ?? [])]
  const books = keys.map((key) => game.legendBooks?.find((book) => `${book.id}:${book.tier}` === key)).filter((book): book is NonNullable<typeof book> => !!book)
  if (books.length !== keys.length) return { ok: false, error: '技能书不在库存里，可能已被移除' }
  if (books.length > 4) return { ok: false, error: '一轮培养最多带 4 本技能书' }
  const unusable = books.find((book) => !canUseBookOnPlayer(player, book).ok)
  if (unusable) return { ok: false, error: `这本书当前不能使用：${canUseBookOnPlayer(player, unusable).reason ?? '位置或技能槽不匹配'}` }
  // 每轮都从原始属性开始，和他现在装备哪张卡无关；第 2 赛季 +5 天（40 时段），第 3 赛季起再 +2 天（44 时段）。
  const seasonIndex = Math.max(game.season?.index ?? 1, game.world?.seasonIndex ?? 1)
  const session = createTrainingSession(untrainedPlayer(player), seed ?? newTrainingSeed(game, playerId), { stadium: economy.stadium, academy: economy.academy, medical: economy.medical, shop: economy.shop, sponsor: economy.sponsor, psychology: economy.psychology, tactics: economy.tactics }, 1, books, trainingActionsForSeason(seasonIndex))
  session.scheduleSeed = splitSeed(game.seed, 'training-calendar')
  session.cupCeilingBonus = cupCeilingBonus(game)
  session.matchRole = game.lineup.starters.find(starter => starter.playerId === playerId)?.role
  // 候选卡只是一份属性快照：精力时钟和不满属于球员本人，不跟着进卡。
  delete session.candidate.energyAt
  delete session.candidate.unhappy
  game.training[playerId] = session
  saveGame(game)
  return { ok: true }
}

const SUPPORT_SIZE = 6

function primaryPositionOf(player: Player): Position {
  return (['GK', 'CB', 'W', 'CM', 'ST'] as Position[])
    .sort((a, b) => player.positions[b] - player.positions[a])[0] ?? 'CM'
}

/**
 * 系统给主角自动挑 6 名陪练：按当前阵型的其他位置轮流挑（中卫、边路、中场、前锋各先来一个，再按阵型补），
 * 同一位置优先熟练度高的人，但只在排名靠前的几个人里随机选，保证每轮不完全一样。
 * 主角是门将时只挑外场；主角是外场时必带 1 名其他门将。
 */
export function pickSupportPartners(
  game: GameState,
  playerId: string,
  seed: number,
): string[] | null {
  const player = game.roster.find((item) => item.id === playerId)
  if (!player) return null
  const pool = game.roster.filter((item) => item.id !== playerId)
  if (pool.length < SUPPORT_SIZE) return null
  const keeperCandidates = pool.filter((item) => item.positions.GK > 0)
  if (player.positions.GK === 0 && keeperCandidates.length === 0) return null

  const formation = FORMATIONS[game.lineup.formationId]
  const outfield = formation.slots.filter((slot) => slot.position !== 'GK').map((slot) => slot.position)
  if (player.positions.GK === 0) {
    const same = outfield.indexOf(primaryPositionOf(player))
    if (same >= 0) outfield.splice(same, 1)
  }
  // 11 人制的阵型位置多：各条线轮流挑，避免 6 个陪练全是后卫。
  const remaining = new Map<Position, number>()
  for (const position of outfield) remaining.set(position, (remaining.get(position) ?? 0) + 1)
  const rounds: Position[] = []
  while (rounds.length < outfield.length) {
    for (const position of ['CB', 'W', 'CM', 'ST'] as const) {
      const left = remaining.get(position) ?? 0
      if (left <= 0) continue
      rounds.push(position)
      remaining.set(position, left - 1)
    }
  }
  const needs: Position[] = player.positions.GK > 0 ? rounds : ['GK', ...rounds]
  // 门将位置优先从真正的门将里挑，绝不拿外场球员凑。
  const rng = derivedRng(seed, 'support-partners', playerId)
  const chosen: string[] = []
  const poolIds = new Set(pool.map((item) => item.id))
  for (const position of needs.slice(0, SUPPORT_SIZE)) {
    const candidates = pool.filter((item) => poolIds.has(item.id) && !chosen.includes(item.id)
      && (position === 'GK' ? item.positions.GK > 0 : item.positions.GK === 0))
      .map((item) => ({ item, score: item.positions[position] * positionMultiplier(item.positions[position]) }))
      .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
    if (!candidates.length) continue
    const top = candidates.slice(0, Math.min(5, candidates.length))
    chosen.push(top[rng.int(top.length)].item.id)
  }
  // 位置凑不齐时用剩下的人补齐（门将位置仍优先真门将）。
  const fillers = pool.filter((item) => !chosen.includes(item.id))
  while (chosen.length < SUPPORT_SIZE && fillers.length) {
    chosen.push(fillers.splice(rng.int(fillers.length), 1)[0].id)
  }
  return chosen.length === SUPPORT_SIZE ? chosen : null
}

/** 开始一轮带陪练的培养：系统自动选 6 人，陪练不消耗精力、不涨属性。 */
export function startTrainingWithSupport(game: GameState, playerId: string, seed?: number, bookKeys?: string[]): { ok: boolean; error?: string } {
  const running = game.training[playerId]
  if (running && !running.completed) return { ok: false, error: '该球员已有一轮培养' }
  const trainingSeed = seed ?? newTrainingSeed(game, playerId)
  const partners = pickSupportPartners(game, playerId, trainingSeed)
  if (!partners) return { ok: false, error: '陪练队友不足：需要 6 名其他球员，外场球员还要有至少 1 名其他门将' }
  const result = startTraining(game, playerId, trainingSeed, bookKeys)
  if (!result.ok) return result
  game.training[playerId].partnerIds = partners
  saveGame(game)
  return { ok: true }
}

function trainingMentor(game: GameState, request: TrainingRequest) {
  return request.kind === 'inherit' || (request.kind === 'activity' && request.activityId === 'inherit')
    ? game.roster.find(item => item.id === request.mentorId) : undefined
}

function prepareTraining(game: GameState, playerId: string, request: TrainingRequest, hideQuality = false): { plan?: TrainingPlan; error?: string; completed?: boolean; ids?: string[] } {
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
    if (participant.action >= trainingActionsTotal(participant)) return { error: '本轮培养的时段已用完', completed: id === playerId }
    if (participant.action !== session.action || participant.scheduleVersion !== session.scheduleVersion || (session.scheduleVersion === 1 && participant.scheduleSeed !== session.scheduleSeed)) return { error: '队友培养日程或行动进度不一致' }
    // Plan and execute on clones: neither preview nor a failed group action may mutate live state.
    const support = partnersAt(participant, request)
    const plan = planTraining(structuredClone(participant), request, mentor, Math.max(ids.length - 1, support), hideQuality)
    if (plan.invalid) return { error: plan.note ?? '无法执行此培养行动' }
    const trial = performTrainingAction(structuredClone(participant), request, mentor, Math.max(ids.length - 1, support))
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

/** 交流赛对手相对我方实力的比例：第一周弱 15%，第二周持平，第三周强 10%（之后沿用最后一周）。 */
export const EXCHANGE_STRENGTH_RATIOS = [0.85, 1, 1.1] as const

/** 基础卡版本的球员：属性、位置、性格、技能都回到没装备任何球员卡时的样子。 */
function baseCardPlayer(player: Player): Player {
  return {
    ...player,
    attrs: { ...(player.baseAttrs ?? player.attrs) },
    positions: { ...(player.basePositions ?? player.positions) },
    personality: { ...(player.basePersonality ?? player.personality) },
    skills: [...(player.baseSkills ?? player.skills)],
    skillTiers: player.baseSkillTiers ?? player.skillTiers,
    equippedCardId: undefined,
    version: 0,
  }
}

/**
 * 按周挑对手：目标 = 我方RANK × 当周比例，选RANK（首发 CA 之和，对手按基础卡算）最接近目标的球队；
 * 已经打过的尽量不重复。返回的球队球员已经换成基础卡版本。
 */
export function pickExchangeOpponent(teams: AITeam[], ownRating: number, week: number, faced: string[] = []): { team: AITeam; rating: number } {
  const ratio = EXCHANGE_STRENGTH_RATIOS[Math.min(Math.max(week, 1), EXCHANGE_STRENGTH_RATIOS.length) - 1]
  const target = ownRating * ratio
  const based = teams.map((team) => {
    const players = team.players.map(baseCardPlayer)
    return { team: { ...team, players }, rating: lineupRating(players, team.lineup) }
  })
  const fresh = based.filter((item) => !faced.includes(item.team.id))
  const pool = fresh.length ? fresh : based
  return pool.sort((x, y) => Math.abs(x.rating - target) - Math.abs(y.rating - target) || x.team.id.localeCompare(y.team.id))[0]
}

/** 交流赛阵容：保存的首发，培养中的球员不在首发时替下同位置（没有就任意外场）CA 最低的那个。 */
function exchangeLineup(game: GameState, playerId: string): Lineup {
  const lineup = structuredClone(game.lineup)
  if (lineup.starters.some((starter) => starter.playerId === playerId)) return lineup
  const trainee = game.roster.find((player) => player.id === playerId)
  if (!trainee) return lineup
  const slots = FORMATIONS[lineup.formationId]?.slots ?? []
  const positionOf = (slotId: string) => slots.find((slot) => slot.id === slotId)?.position
  const isGk = trainee.positions.GK > 0
  const candidates = lineup.starters.filter((starter) => (isGk ? positionOf(starter.slotId) === 'GK' : positionOf(starter.slotId) !== 'GK'))
  const same = candidates.filter((starter) => positionOf(starter.slotId) === primaryPositionOf(trainee))
  const pool = same.length ? same : candidates
  const caOfId = (id: string) => {
    const player = game.roster.find((item) => item.id === id)
    return player ? caOf(player.attrs, player.positions.GK > 0) : 0
  }
  const weakest = [...pool].sort((a, b) => caOfId(a.playerId) - caOfId(b.playerId))[0]
  if (!weakest) return lineup
  lineup.bench = lineup.bench.filter((id) => id !== playerId)
  weakest.playerId = playerId
  const slot = slots.find((item) => item.id === weakest.slotId)
  weakest.role = bestRoleForPlayer(trainee, slot?.position ?? 'CM', slot).role
  return validateLineup(game.roster, lineup).valid ? lineup : game.lineup
}

function simulateTrainingExchange(game: GameState, session: TrainingSession): TrainingExchange {
  const week = trainingDate(session.action + 1).week
  const scheduleSeed = session.scheduleSeed ?? session.seed
  // 交流赛用当前保存的首发（各自当前装备的属性）；培养中的球员一定上场，不在首发就顶替同位置最弱的人。
  const roster = game.roster
  const lineup = exchangeLineup(game, session.playerId)
  // 对手按RANK接近：我方RANK（上场首发的 CA 之和，含这名培养球员当前的 CA）乘当周比例，对手一律用基础卡属性。
  const ownRating = lineupRating(roster, lineup)
  const picked = pickExchangeOpponent(game.aiTeams, ownRating, week, (session.exchangeMatches ?? []).map((match) => match.opponentId))
  const opponent = picked.team
  const home = teamInputFromLineup(
    roster,
    lineup,
    { id: 'player', name: game.clubName, color: '#34d399', accent: '#052e1b' },
    { tacticsStage: game.economy?.tactics ?? 1 },
  )
  if (game.autoSubs) home.autoSubs = structuredClone(game.autoSubs)
  withChemistry(home, game.chemistry, Date.now(), game.season.gameDayMs)
  const engine = new Engine({ seed: splitSeed(scheduleSeed, `training-exchange-${week}`), home, away: teamInputFromAI(opponent), knockout: false })
  const score = engine.simulate().score
  return { week, opponentId: opponent.id, opponentName: opponent.name, ownRating: Math.round(ownRating), opponentRating: Math.round(picked.rating), homeScore: score.home, awayScore: score.away, result: score.home > score.away ? 'win' : score.home < score.away ? 'loss' : 'draw' }
}

export function previewTraining(game: GameState, playerId: string, request: TrainingRequest, hideQuality = false): { plan?: TrainingPlan; error?: string } {
  const { plan, error } = prepareTraining(game, playerId, request, hideQuality)
  return error ? { error } : { plan }
}

export function trainingAction(game: GameState, playerId: string, request: TrainingRequest, now = Date.now()): PerformResult {
  const current = game.training[playerId]
  // 陪练队友只按人数给主角加成长，不参与行动、不消耗精力、不涨属性。
  const support = current ? partnersAt(current, request) : 0
  // 显式 teammateIds（Agent/旧流程）仍然生效；没传时由系统陪练的人数提供加成。
  const prepared = prepareTraining(game, playerId, request)
  if (prepared.error || !prepared.ids) return { ok: false, error: prepared.error, completed: prepared.completed ?? false }
  const cooperative = request.kind === 'match' || request.kind === 'combo' || request.kind === 'drill' ||
    (request.kind === 'activity' && isCooperativeActivity(request.activityId))
  const trainingPairs: [string, string][] = []
  if (cooperative) {
    for (let i = 0; i < prepared.ids.length; i++) for (let j = i + 1; j < prepared.ids.length; j++) trainingPairs.push([prepared.ids[i], prepared.ids[j]])
    const partners = current.scheduleVersion === 1 && request.kind === 'activity'
      ? partnerAssignment(current)[request.activityId] ?? [] : current.partnerIds ?? []
    for (const id of partners) if (game.roster.some(p => p.id === id)) trainingPairs.push([playerId, id])
  }
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
    // 陪练小队固定按人数加成长；手动组队（Agent/旧流程）仍按实际参与的队友数。
    const result = performTrainingAction(staged[i], request, mentor, Math.max(staged.length - 1, support))
    if (!result.ok) return result
    if (exchange) {
      const session = staged[i]
      // Group participants share the one simulated result.
      session.exchangeMatches = [...(session.exchangeMatches ?? []), { ...exchange }]
      if (exchange.result === 'loss') session.lowMoodWeeks = [...new Set([...(session.lowMoodWeeks ?? []), exchange.week + 1])]
      const entry = [...session.log].reverse().find(item => item.action === session.action && item.kind === 'action')
      if (entry) entry.text += ` 对阵 ${exchange.opponentName}（RANK ${exchange.ownRating} 对 ${exchange.opponentRating}）${exchange.homeScore}:${exchange.awayScore}（${{ win: '胜', draw: '平', loss: '负' }[exchange.result]}）。${exchange.result === 'loss' ? '下周一至周三心情低落，属性成长减少 50%。' : ''}`
    }
    if (i === 0) primaryResult = result
  }
  for (let i = 0; i < staged.length; i++) {
    Object.assign(game.training[prepared.ids[i]], staged[i])
    syncCandidate(game, prepared.ids[i])
  }
  recordTrainingChemistry(game, trainingPairs, now, game.season.gameDayMs)
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
  if (session?.completed) {
    game.candidates[playerId] = structuredClone(session.candidate)
    addTrainedCard(game, session)
    // 自动培养开关默认总是关的：一轮结束就自动关掉，下一轮需要重新打开。
    const own = game.trainingAutoByPlayer?.[playerId]
    if (own?.autopilot) game.trainingAutoByPlayer = { ...game.trainingAutoByPlayer, [playerId]: { ...own, autopilot: false } }
  }
}

/* ---------- 自动培养 ---------- */

/** 自动培养一步的结果：start 表示刚开了一轮，event 表示自动选了事件，action 表示执行了训练项目。 */
export type AutoTrainingStepResult = {
  ok: boolean
  error?: string
  completed: boolean
  kind: 'start' | 'event' | 'action' | 'done'
  label?: string
}

export type AutoTrainingRunResult = {
  ok: boolean
  steps: number
  error?: string
  completed: boolean
}

/**
 * 读取自动培养配置。旧存档没有配置（或缺少字段）时按球员的主属性顺序补一份，
 * 只返回结果、不写存档，保存由界面负责。
 */
export function autoTrainingConfig(game: GameState, playerId?: string): TrainingAutoConfig {
  const player = playerId ? game.roster.find((item) => item.id === playerId) : undefined
  const mains = mainAttrsFor(player ? isGoalkeeper(player) : false)
  // 每名球员各存一份；没单独设置过的用旧的全局设置当默认值。开关只认球员自己的那份。
  const own = playerId ? game.trainingAutoByPlayer?.[playerId] : undefined
  const existing = own ?? game.trainingAuto
  // 玩家设置过优先级就沿用；一次都没设置过时，默认先练这名球员自己的 2 个主要属性（按他的风格），再练其余主属性。
  const saved = (existing?.priority ?? []).filter((key) => ALL_ATTRIBUTES.includes(key))
  const priority: AttrKey[] = [...new Set(saved.length ? saved : player ? keyAttrsOf(player) : [])]
  // 优先级里保证有这名球员的全部主属性，顺序沿用上面的结果。
  for (const key of mains) if (!priority.includes(key)) priority.push(key)
  const targets: Partial<Record<AttrKey, number>> = {}
  for (const [key, value] of Object.entries(existing?.targets ?? {}) as [AttrKey, number | undefined][]) {
    if (!ALL_ATTRIBUTES.includes(key) || typeof value !== 'number' || !Number.isFinite(value)) continue
    targets[key] = Math.round(Math.max(0, Math.min(MAIN_ATTR_HARD_MAX, value)))
  }
  return {
    enabled: existing?.enabled !== false,
    autopilot: own?.autopilot === true,
    ...(existing?.preset ? { preset: existing.preset } : {}),
    mode: existing?.mode === 'targets' || existing?.mode === 'max' ? existing.mode : 'priority',
    priority,
    targets,
  }
}

/** 这名球员的默认优先级：2 个主要属性在前，其余主属性按固定顺序接在后面。 */
export function defaultAutoPriority(player: Player): AttrKey[] {
  const priority: AttrKey[] = [...keyAttrsOf(player)]
  for (const key of mainAttrsFor(isGoalkeeper(player))) if (!priority.includes(key)) priority.push(key)
  return priority
}

export type AutoPresetOption = {
  id: Exclude<AutoTrainingPresetId, 'custom'>
  label: string
  tag?: string
  summary: string
  mode: TrainingAutoConfig['mode']
  priority: AttrKey[]
}

/** 一级简洁菜单针对该球员（外场或门将）提供的快捷培养方案。 */
export function autoTrainingPresetsFor(player: Player): AutoPresetOption[] {
  const keys = keyAttrsOf(player)
  const keyText = keys.map(attrLabel).join(' · ')
  const def = defaultAutoPriority(player)
  if (isGoalkeeper(player)) {
    return [
      { id: 'signature', label: '招牌特长', tag: '推荐', summary: `优先拉满核心：${keyText}`, mode: 'priority', priority: def },
      { id: 'max', label: '综合收益', summary: '每回合选总成长最高项，兼顾招牌属性', mode: 'max', priority: def },
      { id: 'gk_stopper', label: '门线神扑', summary: '主攻扑救反应、一对一与手控球', mode: 'priority', priority: ['reflexes', 'oneOnOne', 'handling', 'composure', 'rushing', 'passing'] },
      { id: 'gk_sweeper', label: '出击清道夫', summary: '主攻出击拦截、传球发动与扑救反应', mode: 'priority', priority: ['rushing', 'passing', 'reflexes', 'oneOnOne', 'composure', 'handling'] },
      { id: 'gk_wall', label: '稳健控场', summary: '主攻手控稳健、门前镇定与扑救反应', mode: 'priority', priority: ['handling', 'composure', 'reflexes', 'passing', 'oneOnOne', 'rushing'] },
    ]
  }
  return [
    { id: 'signature', label: '招牌特长', tag: '推荐', summary: `优先拉满核心：${keyText}`, mode: 'priority', priority: def },
    { id: 'max', label: '综合收益', summary: '每回合选总成长最高项，兼顾招牌属性', mode: 'max', priority: def },
    { id: 'finisher', label: '锋线终结', summary: '主攻射术、爆发启动与冲刺速度', mode: 'priority', priority: ['shooting', 'acceleration', 'speed', 'dribbling', 'strength', 'passing', 'tackling'] },
    { id: 'playmaker', label: '组织传控', summary: '主攻传球调度、盘带控球与爆发', mode: 'priority', priority: ['passing', 'dribbling', 'acceleration', 'shooting', 'speed', 'tackling', 'strength'] },
    { id: 'winger', label: '边路爆破', summary: '主攻冲刺速度、爆发变向与盘带突破', mode: 'priority', priority: ['speed', 'acceleration', 'dribbling', 'passing', 'shooting', 'strength', 'tackling'] },
    { id: 'defender', label: '防守铁闸', summary: '主攻抢断拦截、身体对抗与回追速度', mode: 'priority', priority: ['tackling', 'strength', 'speed', 'acceleration', 'passing', 'dribbling', 'shooting'] },
  ]
}

/** 根据当前自动配置推断匹配的一级预设 ID；若为最低目标或手动调过顺序则返回 custom。 */
export function resolveAutoPresetId(player: Player, config: TrainingAutoConfig): AutoTrainingPresetId {
  if (config.mode === 'targets') return 'custom'
  if (config.preset === 'custom') return 'custom'
  const presets = autoTrainingPresetsFor(player)
  const mains = mainAttrsFor(isGoalkeeper(player))
  const currentOrder = config.priority.filter((key) => mains.includes(key))
  const sameOrder = (a: AttrKey[], b: AttrKey[]) => a.length === b.length && a.every((key, i) => key === b[i])
  if (config.preset) {
    const chosen = presets.find((item) => item.id === config.preset)
    if (chosen && chosen.mode === config.mode && (chosen.mode === 'max' || sameOrder(chosen.priority, currentOrder))) {
      return chosen.id
    }
  }
  if (config.mode === 'max') return 'max'
  const matched = presets.find((item) => item.mode === 'priority' && sameOrder(item.priority, currentOrder))
  return matched ? matched.id : 'custom'
}

export function autoPresetLabel(player: Player, config: TrainingAutoConfig): string {
  const id = resolveAutoPresetId(player, config)
  if (id === 'custom') return config.mode === 'targets' ? '目标补齐' : '自定义顺序'
  return autoTrainingPresetsFor(player).find((item) => item.id === id)?.label ?? '招牌特长'
}

/** 选用一级菜单的快捷预设：写回对应模式与属性优先级。 */
export function applyAutoTrainingPreset(game: GameState, playerId: string, presetId: Exclude<AutoTrainingPresetId, 'custom'>): TrainingAutoConfig | null {
  const player = game.roster.find((item) => item.id === playerId)
  if (!player) return null
  const preset = autoTrainingPresetsFor(player).find((item) => item.id === presetId)
  if (!preset) return null
  return setAutoTrainingConfig(game, playerId, {
    preset: preset.id,
    mode: preset.mode,
    priority: [...preset.priority],
  })
}

/** 改某名球员的自动培养设置（策略或开关），只动他自己的那份；保存由界面负责。 */
export function setAutoTrainingConfig(game: GameState, playerId: string, patch: Partial<TrainingAutoConfig>): TrainingAutoConfig {
  const next = { ...autoTrainingConfig(game, playerId), ...patch }
  game.trainingAutoByPlayer = { ...(game.trainingAutoByPlayer ?? {}), [playerId]: next }
  return next
}

/** 开着“自动培养”时能不能继续往后走：有一轮没结束的培养就可以（不会自己开新一轮）。 */
export function autoTrainingRunnable(game: GameState, playerId: string): boolean {
  const session = game.training[playerId]
  return !!session && !session.completed && !game.candidates[playerId]
}

/** 本次培养里该球员各属性还能练到多少（球员个人上限）。 */
function autoTrainableCeilings(session: TrainingSession): Attributes {
  return effectiveTrainingCeilings(session)
}

type AutoWeight = { key: AttrKey; weight: number }

/**
 * 当前最值得练的属性（权重从高到低）：
 * - targets：补差距最大的主属性，达标的不列入；
 * - priority：按优先级依次练还没顶到个人上限的属性（练满就下一个）。
 */
function autoTrainingWeights(session: TrainingSession, config: TrainingAutoConfig): AutoWeight[] {
  const gk = isGoalkeeper(session.candidate)
  const ceilings = autoTrainableCeilings(session)
  const attrs = session.candidate.attrs
  const mains = mainAttrsFor(gk)
  const below = (key: AttrKey): boolean => attrs[key] + 0.5 < ceilings[key]
  const order = config.priority.filter((key) => mains.includes(key))
  for (const key of mains) if (!order.includes(key)) order.push(key)
  if (config.mode === 'max') {
    // 自动选择：项目/事件选项的得分是“能涨的属性总成长”，每次选最多的那一项；
    // 但这名球员自己的 2 个主要属性权重是别的属性的 3 倍，所以不会为了凑数把他练歪。
    const keys = new Set<AttrKey>(keyAttrsOf(session.candidate))
    return ALL_ATTRIBUTES.filter((key) => below(key)).map((key) => ({ key, weight: keys.has(key) ? 3 : 1 }))
  }
  if (config.mode === 'targets') {
    // 差距 = 目标值 - 当前值，目标超过个人上限时以实际上限为准。
    return mains
      .map((key) => ({ key, weight: Math.min(config.targets[key] ?? 0, ceilings[key]) - attrs[key] }))
      .filter((item) => item.weight > 0.5 && below(item.key))
      .sort((a, b) => b.weight - a.weight || order.indexOf(a.key) - order.indexOf(b.key))
  }
  return order
    .map((key, index) => ({ key, weight: (order.length - index) ** 2 }))
    .filter((item) => below(item.key))
}

/** 项目对门将/外场球员的实际成长表。 */
function autoActivityGains(activity: TrainingActivity, gk: boolean): Partial<Record<AttrKey, number>> {
  return (gk ? activity.goalkeeperGains ?? activity.gains : activity.gains) ?? {}
}

/** 在当前时段可执行且扣得起体力的项目里，挑一个对目标属性收益最大的；都不涨属性时返回 null。 */
function autoBestActivity(session: TrainingSession, weights: AutoWeight[]): TrainingActivity | null {
  if (weights.length === 0) return null
  const gk = isGoalkeeper(session.candidate)
  let best: TrainingActivity | null = null
  let bestScore = 0
  for (const activity of trainingOptions(session)) {
    if (activity.cost !== undefined && session.fatigue + trainingFatigueCost(session, activity.cost) > 100) continue
    const gains = autoActivityGains(activity, gk)
    let score = 0
    for (const item of weights) {
      const gain = gains[item.key] ?? 0
      if (gain > 0) score += gain * item.weight
    }
    if (score > bestScore + 1e-9) {
      best = activity
      bestScore = score
    }
  }
  return best
}

/**
 * 自动培养是否应当在本时段主动休息（按失败率与后续赛程智能控体）：
 * 1. 最后一个时段（剩余 ≤ 1）只要还能扣得起训练体力就不休息，避免白白浪费最后一次成长；
 * 2. 当前体力 ≤ 30（`failureChance(stamina) > 0`，此时出现 5%–50% 失败率且失去大成功/完美成功）立即休息；
 * 3. 下一个时段若是强制比赛日（周一上午交流赛 / 周五上午队内比赛，无恢复选项），且本时段训练会把体力压进 ≤ 30 的失败区间，则提前休息保证比赛品质；
 * 4. 体力逼近 30（31–36）且当前「恢复」站了 ≥ 2 名陪练（+46~+54 体力）而目标课无陪练时，顺势提前恢复。
 */
export function shouldAutoRest(session: TrainingSession, options: TrainingActivity[], bestActivity: TrainingActivity | null): boolean {
  const rest = options.find((item) => item.id === 'rest' && !item.noRecovery)
  if (!rest) return false
  const remaining = trainingActionsTotal(session) - session.action
  const stamina = 100 - session.fatigue
  if (!bestActivity) return session.fatigue >= 35
  if (remaining <= 1) return false
  if (failureChance(stamina) > 0) return true
  const nextAction = session.action + 2
  if (nextAction <= trainingActionsTotal(session)) {
    const nextDate = trainingDate(nextAction)
    const mandatoryMatchNext = (nextDate.day === 1 && nextDate.slot === '上午') || (nextDate.day === 5 && nextDate.slot === '上午')
    if (mandatoryMatchNext) {
      const cost = trainingFatigueCost(session, bestActivity.cost ?? 0)
      if (failureChance(stamina - cost) > 0 && stamina <= FAILURE_STAMINA + 16) return true
    }
  }
  if (stamina <= FAILURE_STAMINA + 6 && plainChance(stamina) >= 0.15 && session.partnerIds?.length) {
    const partners = partnerAssignment(session)
    if ((partners.rest?.length ?? 0) >= 2 && (partners[bestActivity.id]?.length ?? 0) === 0) return true
  }
  return false
}

/** 没有值得练的项目时：体力进入失败区间或偏低先恢复，否则找导师推进事件。 */
function autoFallbackActivity(session: TrainingSession, options: TrainingActivity[]): TrainingActivity | undefined {
  const rest = options.find((item) => item.id === 'rest' && !item.noRecovery)
  const mentor = options.find((item) => item.id === 'mentor')
  if ((failureChance(100 - session.fatigue) > 0 || session.fatigue >= 45) && rest) return rest
  return mentor ?? rest ?? options[0]
}

/** 事件自动选项：支持技能书事件，按目标属性期望收益排序；低体力时兼顾疲劳增减。 */
function autoEventOption(session: TrainingSession, event: EventDef, weights: AutoWeight[]): EventOption {
  const weightOf = new Map(weights.map((item) => [item.key, item.weight]))
  const lowStamina = 100 - session.fatigue <= FAILURE_STAMINA + 8
  const score = (effect: EventEffect | undefined): number => {
    let total = 0
    for (const [key, gain] of Object.entries(effect?.attrs ?? {}) as [AttrKey, number][]) {
      const weight = weightOf.get(key) ?? 0
      if (gain > 0 && weight > 0) total += gain * weight
    }
    if (lowStamina && effect?.fatigue) total -= effect.fatigue * 0.15
    return total
  }
  let best = event.options[0]
  let bestScore = -Infinity
  for (const option of event.options) {
    const value = option.book
      ? (() => {
          const p = bookLearnChance(session.candidate, option.book)
          return p > 0 ? 500 * p : -1
        })()
      : option.branch
        ? (() => {
            const p = branchProbability(session, option.branch!.check, option.branch!.p)
            return p * score(option.branch!.success) + (1 - p) * score(option.branch!.failure)
          })()
        : score(option.effect)
    if (value > bestScore + 1e-9) {
      best = option
      bestScore = value
    }
  }
  return best
}

/**
 * 自动培养一步：没有进行中的培养就先开始一轮；有待处理事件就按目标收益选一个；
 * 否则结合当前失败率与剩余回合判断休息或挑选收益最高的项目执行。
 */
export function autoTrainingStep(game: GameState, playerId: string): AutoTrainingStepResult {
  const player = game.roster.find((item) => item.id === playerId)
  if (!player) return { ok: false, error: '球员不存在', completed: false, kind: 'done' }
  let session = game.training[playerId]
  if (session?.completed) return { ok: true, completed: true, kind: 'done', label: '本轮培养已完成' }
  if (!session) {
    const started = startTraining(game, playerId)
    if (!started.ok) return { ok: false, error: started.error ?? '无法开始培养', completed: false, kind: 'start' }
    session = game.training[playerId]
    return { ok: true, completed: false, kind: 'start', label: '开始新一轮培养' }
  }
  const config = autoTrainingConfig(game, playerId)
  const weights = autoTrainingWeights(session, config)
  // 先处理事件（含传奇技能书事件）：最后一个时段触发的事件会挡住培养完成。
  if (session.pendingEventId) {
    const event = eventForSession(session, session.pendingEventId) ?? eventById(session.pendingEventId)
    if (!event) return { ok: false, error: '未知的事件配置', completed: false, kind: 'event' }
    const option = autoEventOption(session, event, weights)
    const result = trainingEventChoice(game, playerId, option.id)
    if (!result.ok) return { ok: false, error: result.error ?? '事件结算失败', completed: false, kind: 'event' }
    return { ok: true, completed: result.completed, kind: 'event', label: `${event.title} · ${option.label}` }
  }
  const totalActions = trainingActionsTotal(session)
  if (session.action >= totalActions) return { ok: true, completed: true, kind: 'done', label: '本轮培养已完成' }
  const options = session.scheduleVersion === 1 ? trainingOptions(session) : []
  if (options.length > 0) {
    const best = autoBestActivity(session, weights)
    let activity: TrainingActivity | undefined = shouldAutoRest(session, options, best)
      ? options.find((item) => item.id === 'rest' && !item.noRecovery)
      : (best ?? autoFallbackActivity(session, options))
    if (!activity) activity = autoFallbackActivity(session, options)
    if (!activity) return { ok: false, error: '当前时段没有可执行的训练项目', completed: false, kind: 'action' }
    if (activity.cost !== undefined && session.fatigue + trainingFatigueCost(session, activity.cost) > 100) {
      activity = options.find((item) => item.id === 'rest') ?? options.find((item) => item.id === 'mentor') ?? activity
    }
    const result = trainingAction(game, playerId, { kind: 'activity', activityId: activity.id })
    if (!result.ok) return { ok: false, error: result.error ?? '自动训练失败', completed: false, kind: 'action' }
    return { ok: true, completed: result.completed, kind: 'action', label: activity.label }
  }
  // 旧课程（没有日历项目）：直接练主属性；出现失败率（体力 ≤ 30 且非最后一回合）或体力不足时先休息。
  const top = weights.find((item) => mainAttrsFor(isGoalkeeper(player)).includes(item.key))
  const remaining = totalActions - session.action
  const drillCost = trainingFatigueCost(session, 12)
  const needRest = session.fatigue + drillCost > 100 || (remaining > 1 && failureChance(100 - session.fatigue) > 0)
  const request: TrainingRequest = needRest || !top ? { kind: 'rest' } : { kind: 'drill', attr: top.key }
  const result = trainingAction(game, playerId, request)
  if (!result.ok) return { ok: false, error: result.error ?? '自动训练失败', completed: false, kind: 'action' }
  return { ok: true, completed: result.completed, kind: 'action', label: request.kind === 'drill' ? `专项训练 · ${attrLabel(request.attr)}` : '休息' }
}

/** 连续自动培养，直到本轮结束或用完步数（默认 90 步，足够跑完第 3 赛季 44 时段加事件）。 */
export function runAutoTraining(game: GameState, playerId: string, maxSteps = 90): AutoTrainingRunResult {
  let steps = 0
  for (let guard = 0; guard < maxSteps; guard++) {
    const step = autoTrainingStep(game, playerId)
    steps++
    if (!step.ok) return { ok: false, steps, error: step.error, completed: step.completed }
    if (step.completed) return { ok: true, steps, completed: true }
  }
  const session = game.training[playerId]
  return { ok: true, steps, completed: !!session?.completed }
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

export function keepTraining(game: GameState, playerId: string): { ok: boolean; error?: string } {
  const result = keepCandidate(game, playerId)
  if (result.ok) saveGame(game)
  return result
}

/** cardId 为 null 表示换回原始属性。 */
export function equipPlayerCard(game: GameState, playerId: string, cardId: string | null): CardOutcome {
  const result = equipCard(game, playerId, cardId)
  if (result.ok) saveGame(game)
  return result
}

export function removePlayerCard(game: GameState, cardId: string): CardOutcome {
  const result = deleteCard(game, cardId)
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
  const available = game.roster.filter((player) => injuryUntil(game, player) === null)
  return setLineup(game, autoFillLineup(available, formationId, game.lineup.tactics, game.lineup))
}

export function startNextSeasonAction(game: GameState, now = Date.now()): { ok: boolean; error?: string } {
  // 赛季结束后先过 12 个游戏日的休整窗口（升级附加赛 + 友谊赛），不能一点就开新赛季。
  if (game.world && game.season.finished && now < seasonEndAt(game.season.startedAt, game.season.clockShift)) {
    return { ok: false, error: `赛后休整还没结束：${nextSeasonCountdown(game, now)}后开始下一赛季` }
  }
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

type ClockSnapshot = {
  seasons: { season: GameState['season']; startedAt: number; clockShift?: number; kickoffs: (number | undefined)[] }[]
  createdAt: number
  worldCalendarStartAt?: number
  worldSeasonStartedAt: number
  worldClockShift?: number
  condition: Map<string, { condition: number; energy: number }>
  injuries: Record<string, number> | undefined
}

function snapshotClock(game: GameState): ClockSnapshot {
  const condition = new Map<string, { condition: number; energy: number }>()
  for (const player of [...game.roster, ...game.aiTeams.flatMap((team) => team.players)]) {
    condition.set(player.id, { condition: player.condition, energy: player.energy })
  }
  return {
    seasons: [...new Set([game.season, ...(game.world?.divisions ?? [])])].map((season) => ({
      season,
      startedAt: season.startedAt,
      clockShift: season.clockShift,
      kickoffs: (season.fixtures ?? []).map((fixture) => fixture.kickoffAt),
    })),
    createdAt: game.createdAt,
    worldCalendarStartAt: game.world?.calendarStartAt,
    worldSeasonStartedAt: game.world?.seasonStartedAt ?? 0,
    worldClockShift: game.world?.clockShift,
    condition,
    injuries: game.injuries ? { ...game.injuries } : undefined,
  }
}

function restoreClock(game: GameState, snapshot: ClockSnapshot): void {
  for (const saved of snapshot.seasons) {
    saved.season.startedAt = saved.startedAt
    saved.season.clockShift = saved.clockShift
    if (saved.clockShift === undefined) delete saved.season.clockShift
    ;(saved.season.fixtures ?? []).forEach((fixture, index) => { fixture.kickoffAt = saved.kickoffs[index] })
  }
  game.createdAt = snapshot.createdAt
  if (game.world) {
    game.world.calendarStartAt = snapshot.worldCalendarStartAt
    game.world.seasonStartedAt = snapshot.worldSeasonStartedAt
    game.world.clockShift = snapshot.worldClockShift
    if (snapshot.worldClockShift === undefined) delete game.world.clockShift
  }
  for (const player of [...game.roster, ...game.aiTeams.flatMap((team) => team.players)]) {
    const before = snapshot.condition.get(player.id)
    if (!before) continue
    player.condition = before.condition
    player.energy = before.energy
  }
  if (snapshot.injuries) game.injuries = { ...snapshot.injuries }
  else delete game.injuries
}

/**
 * 离线存档专用：先把日历快进到本轮比赛日（顺手恢复体能、愈合伤病），再开赛。
 * 开赛失败就整体回滚，不会白跳时间。
 */
export function startLeagueOnMatchday(game: GameState, now = Date.now()): { ok: boolean; error?: string; gameDays: number } {
  const before = snapshotClock(game)
  const jump = skipToMatchday(game, now)
  if (!jump.ok) return { ok: false, error: jump.error, gameDays: 0 }
  const result = startLeague(game, now)
  if (!result.ok) {
    restoreClock(game, before)
    return { ok: false, error: result.error, gameDays: 0 }
  }
  return { ok: true, gameDays: jump.gameDays }
}

/**
 * 世界任意球队的友谊赛（含赛季休整期）。
 * 同一轮的对手用同一套名单生成逻辑，和世界页看到的球员一致。
 */
export function startWorldChallenge(game: GameState, clubId: string, now = Date.now()): { ok: boolean; error?: string } {
  const error = validateAutoSubPlan(game.roster, game.lineup, game.autoSubs ?? emptyAutoSubs())[0]
  if (error) return { ok: false, error: `自动换人规则无效：${error}` }
  if (clubId === 'player') return { ok: false, error: '不能和自己踢友谊赛' }
  const own = game.aiTeams.find((team) => team.id === clubId)
  const ai = own ?? (game.world ? cachedOwnerlessTeams(game.world, game.seed, game.aiClubs)[clubId] : undefined)
  if (!ai) return { ok: false, error: '找不到这支球队' }
  const seed = splitSeed(game.seed, `world-friendly-${clubId}-${game.challengeHistory.length}`)
  const result = startChallengeAgainstTeam(game, ai, seed, now)
  if (result.ok) saveGame(game)
  return { ok: result.ok, error: result.error }
}

/** 传奇挑战：和静态复刻的历史俱乐部队踢一场。 */
export function startLegendChallenge(game: GameState, legendId: string, now = Date.now()): { ok: boolean; error?: string } {
  const error = validateAutoSubPlan(game.roster, game.lineup, game.autoSubs ?? emptyAutoSubs())[0]
  if (error) return { ok: false, error: `自动换人规则无效：${error}` }
  const ai = legendTeamById(legendId)
  if (!ai) return { ok: false, error: '找不到这支传奇队' }
  ensurePve(game)
  const played = game.pve?.legends?.[legendId]?.played ?? 0
  const seed = splitSeed(game.seed, `legend-${legendId}-${played}`)
  const result = startChallengeAgainstTeam(game, ai, seed, now, 'legend', undefined, undefined, { allowDraw: true })
  if (result.ok) saveGame(game)
  return { ok: result.ok, error: result.error }
}

/** 巅峰之路：只能打当前关；对手由全局冻结表提供。 */
export function startPeakChallenge(game: GameState, stage: number, now = Date.now()): { ok: boolean; error?: string } {
  const error = validateAutoSubPlan(game.roster, game.lineup, game.autoSubs ?? emptyAutoSubs())[0]
  if (error) return { ok: false, error: `自动换人规则无效：${error}` }
  if (!Number.isInteger(stage)) return { ok: false, error: '关卡编号无效' }
  const target = stage
  ensurePve(game)
  const cleared = game.pve?.peak.cleared ?? 0
  if (target !== cleared + 1) return { ok: false, error: `只能挑战第 ${cleared + 1} 关` }
  if (target < 1 || target > PEAK_STAGE_COUNT) return { ok: false, error: '关卡不存在' }
  const ai = buildPeakTeam(target)
  const seed = splitSeed(game.seed, `peak-match-${target}`)
  const result = startChallengeAgainstTeam(game, ai, seed, now, 'peak', target, `${target}-${game.challengeHistory.length}`)
  if (result.ok) saveGame(game)
  return { ok: result.ok, error: result.error }
}

/** Enroll with the season-opening field; results remain hidden until each round is played. */
export function enterCupAction(game: GameState, cupId: CupId): { ok: boolean; error?: string } {
  ensurePve(game)
  const result = enterCup(game, cupId)
  if (result.ok) saveGame(game)
  return { ok: result.ok, error: result.error }
}

/** 打杯赛的下一场（小组赛或淘汰赛某一回合）。 */
export function startCupMatch(game: GameState, cupId: CupId, now = Date.now()): { ok: boolean; error?: string } {
  const error = validateAutoSubPlan(game.roster, game.lineup, game.autoSubs ?? emptyAutoSubs())[0]
  if (error) return { ok: false, error: `自动换人规则无效：${error}` }
  ensurePve(game)
  const run = game.pve?.cups?.[cupId]
  if (!run || run.status !== 'active') return { ok: false, error: '这个杯赛当前没有进行中的赛程' }
  const next = cupPlayerFixture(run)
  if (!next) return { ok: false, error: '杯赛当前没有你的比赛' }
  const fixture = next.fixture
  const opponentId = fixture.homeId === 'player' ? fixture.awayId : fixture.homeId
  const opponent = cupTeam(game, run, opponentId)
  if (!opponent) return { ok: false, error: '找不到杯赛对手' }
  const homeAway = fixture.homeId === 'player' ? 'home' : 'away'
  const seed = splitSeed(game.seed, `cup-match-${cupId}-${run.seasonIndex}-${fixture.id}`)
  const secondLeg = next.tie?.legs.length === 2 && next.tie.legs[1].id === fixture.id
  const firstScore = secondLeg ? next.tie!.legs[0].score : undefined
  const knockout = !!next.tie && (next.tie.legs.length === 1 || !!secondLeg)
  const result = startChallengeAgainstTeam(game, opponent, seed, now, 'cup', undefined, fixture.id, {
    homeAway,
    cupId,
    cupFixtureId: fixture.id,
    knockout,
    ...(firstScore ? { shootoutOffset: { home: firstScore.away, away: firstScore.home } } : {}),
  })
  if (result.ok) saveGame(game)
  return { ok: result.ok, error: result.error }
}

/** 用服务器给的名单开一场友谊赛（联机时对手可能由别的教练执教）。 */
export function startChallengeWithOpponent(game: GameState, opponent: AITeam, now = Date.now()): { ok: boolean; error?: string } {
  const error = validateAutoSubPlan(game.roster, game.lineup, game.autoSubs ?? emptyAutoSubs())[0]
  if (error) return { ok: false, error: `自动换人规则无效：${error}` }
  const seed = splitSeed(game.seed, `world-friendly-${opponent.id}-${game.challengeHistory.length}`)
  const result = startChallengeAgainstTeam(game, opponent, seed, now)
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

export function restoreActiveEngine(game: GameState): GameEngine | null {
  if (!game.activeMatch) return null
  return restoreEngine(game.activeMatch.engineState as MatchState, game.activeMatch.context.knockout ?? !game.activeMatch.context.isLeague)
}

export function syncActiveEngine(game: GameState, engine: GameEngine, now = Date.now()): void {
  if (!game.activeMatch) return
  if (game.activeMatch.context.isLeague) recordMatchInjuries(game, engine.state, game.activeMatch.startedAt, true)
  game.activeMatch.engineState = engine.serialize()
  game.activeMatch.instructions = [...engine.state.instructions]
  saveGame(game)
}

export function finishMatch(game: GameState, engine: GameEngine, now = Date.now()): MatchRecord | null {
  const record = finishActiveMatch(game, engine, now)
  if (record) saveGame(game)
  return record
}

export function simulateSeasonRound(game: GameState, now = Date.now()): { ok: boolean; error?: string } {
  const result = advanceSeasonRound(game, now)
  if (result.ok) saveGame(game)
  return result
}

export function changeMatchTactics(game: GameState, engine: GameEngine, mentality: MatchMentality): { ok: boolean; error?: string } {
  const active = game.activeMatch
  const eventClock = active?.context.isLeague && active ? leagueMatchClockAt(active, active.elapsedSeconds ?? 0) : undefined
  const result = engine.setTactics(mentality, active?.context.homeAway, eventClock)
  if (result.ok) syncActiveEngine(game, engine)
  return result
}

export function changeMatchAutoSubs(
  game: GameState,
  engine: GameEngine,
  plan: AutoSubPlan,
  syncDefault = false,
): { ok: boolean; error?: string } {
  const active = game.activeMatch
  const eventClock = active?.context.isLeague && active ? leagueMatchClockAt(active, active.elapsedSeconds ?? 0) : undefined
  const result = engine.setAutoSubs(plan, active?.context.homeAway, eventClock)
  if (!result.ok) return result
  if (syncDefault && validateAutoSubPlan(game.roster, game.lineup, plan).length === 0) {
    game.autoSubs = structuredClone(plan)
  }
  syncActiveEngine(game, engine)
  return result
}

export function makeSubstitution(game: GameState, engine: GameEngine, outId: string, inId: string): { ok: boolean; error?: string } {
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

/**
 * 教练暂停的扣次规则：**打开面板不扣**，只有在同一次暂停里第一次做调整时才扣一次，
 * 之后这次暂停里的换人/战术都不再重复扣。`alreadyUsed` 是当前这次暂停是否已经扣过。
 */
export function reserveCoachPause(game: GameState, alreadyUsed: boolean): { ok: boolean; used: boolean; error?: string } {
  if (alreadyUsed) return { ok: true, used: true }
  if (!game.activeMatch || game.activeMatch.context.isLeague) return { ok: false, used: false, error: '联赛不能暂停' }
  if (game.activeMatch.coachPausesLeft <= 0) return { ok: false, used: false, error: '教练暂停已用完。' }
  game.activeMatch.coachPausesLeft--
  saveGame(game)
  return { ok: true, used: true }
}
