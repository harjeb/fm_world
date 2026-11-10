import { ALL_ATTRIBUTES } from './types.ts'
import type {
  AttrKey,
  EventDef,
  EventEffect,
  EventOption,
  GameState,
  Player,
  Position,
  TrainingSession,
  TrainingExchange,
  SkillId,
} from './types.ts'
import { ATTR_META, RELATED_ATTRS, attrLabel } from './data/attributes.ts'
import { EVENTS, ROUTE_LABELS, ROUTE_SKILL, eventById } from './data/events.ts'
import { SKILLS, canLearnSkill } from './data/skills.ts'
import { applyGains, attrText, caOf, isGoalkeeper } from './ca.ts'
import { derivedRng } from './rng.ts'
import { PLAYER_COUNT } from './data/players.ts'
import { FACILITY_STAGE_VERSION, MAX_FACILITY_LEVEL, MAX_FACILITY_STAGE, STAGES_PER_LEVEL, facilityLevel, facilityStageChance, type FacilityId } from './economy.ts'
import { addTrainedCard, closeFinishedTraining, deleteCard, equipCard } from './cards.ts'
import { attrMax, attrRating, CA_MAX, MAIN_ATTR_MAX, displayGain, isMainAttr, scaleAuthoredGains } from './rating.ts'
import { inheritanceChances, mentorSkill, validateInheritance } from './inheritance.ts'
import { bookEvents, bookLearnChance, eventForSession, grantBookSkill, bookTierLabel } from './legend-learning.ts'
import { effectiveTrainingCeilings } from './cup-rewards.ts'
import { legendMultiplier, legendValue } from './legend-bonus.ts'
import { partnerAssignment, trainingDate, trainingLowMood, trainingOptions, type TrainingActivityId } from './training-calendar.ts'

export const ACTIONS_PER_ROUTE = 30
export const ACTIONS_PER_WEEK = 3

export function trainingActionsTotal(session: TrainingSession): number {
  return session.actionsTotal ?? 18
}

/** 事件给的属性成长是事件数据里写的数值乘这个系数：新培养曾是 ×0.5，现在整体放大 4 倍（×2）。旧课程不变。 */
export function eventGrowthScale(session: TrainingSession): number {
  return session.actionsTotal === undefined ? 1 : 2
}

/** 导师复盘（没有额外事件时）的决策成长，保持原来的 ×0.5，不跟事件一起放大。 */
function mentorReviewScale(session: TrainingSession): number {
  return session.actionsTotal === undefined ? 1 : 0.5
}

const ROUTE_CHAIN: Record<string, string> = {
  safe_organization: 'passing',
  through_passing: 'passing',
  hold_shape: 'defending',
  press_hunt: 'defending',
  calm_finish: 'finishing',
  long_range: 'finishing',
}

export type TrainingActionId = 'drill' | 'combo' | 'match' | 'position' | 'rest' | 'mentor' | 'protection' | 'inherit'

export type TrainingRequest =
  | { kind: 'activity'; activityId: TrainingActivityId; teammateIds?: string[]; position?: Position; mentorId?: string; skill?: SkillId }
  | { kind: 'drill'; attr: AttrKey; teammateIds?: string[] }
  | { kind: 'combo'; focus: 'attack' | 'defense'; teammateIds?: string[] }
  | { kind: 'match'; teammateIds?: string[] }
  | { kind: 'position'; position: Position }
  | { kind: 'rest' }
  | { kind: 'mentor' }
  | { kind: 'protection'; focus: 'prevention' | 'resilience' }
  | { kind: 'inherit'; mentorId: string; skill: SkillId }

export type TrainingPlan = {
  kind: TrainingActionId | 'activity'
  label: string
  text: string
  gains: Partial<Record<AttrKey, number>>
  fatigue: number
  energyCost: number
  error: boolean
  caBefore: number
  caAfter: number
  scale: number
  cappedByCeiling: boolean
  cappedByPa: boolean
  quality?: { label: string; multiplier: number }
  invalid?: boolean
  note?: string
}

export const TRAINING_ACTION_INFO: { id: TrainingActionId; label: string; desc: string; fatigue: string; energy: string }[] = [
  { id: 'drill', label: '专项训练', desc: '重点提高一项主属性，相关属性也可能成长。', fatigue: '+12', energy: '不耗精力' },
  { id: 'combo', label: '配合训练', desc: '进攻或防守配合，提升多项相关能力。', fatigue: '+16', energy: '不耗精力' },
  { id: 'match', label: '队内比赛', desc: '高强度综合练习，多项属性成长较多。', fatigue: '+25', energy: '不耗精力' },
  { id: 'position', label: '位置训练', desc: '学习一个未解锁位置，或提高现有位置熟练度。不消耗 CA。', fatigue: '约 +8', energy: '不耗精力' },
  { id: 'protection', label: '伤病防护', desc: '学习银色伤病预防或伤病韧性辅助技能。', fatigue: '约 +8', energy: '不耗精力' },
  { id: 'inherit', label: '技能传承', desc: '向队友学习技能；位置、疲劳和导师技能品质影响成功与品质。', fatigue: '约 +8', energy: '不耗精力' },
  { id: 'rest', label: '休息', desc: '恢复 30 点训练体力。', fatigue: '-30', energy: '不耗精力' },
  { id: 'mentor', label: '导师活动', desc: '不直接成长，但保证触发一次当前可用的事件，适合推进路线。', fatigue: '约 -5', energy: '不耗精力' },
]

/** 开始一轮培养消耗的精力，与课程内训练体力分开。 */
export const TRAINING_ENERGY_COST = 30

/**
 * 游戏内 1 天恢复 50 点精力（游戏日按 4 倍速 = 现实 6 小时），按经过的时间连续恢复：
 * 精力从 0 到够开一轮培养（30 点）约 0.6 个游戏日，到满 2 个游戏日。见 energy.ts。
 */
export const ENERGY_RECOVERY_PER_GAME_DAY = 50
export const GAME_MINUTES_PER_DAY = 24 * 60
export const REAL_MINUTES_PER_GAME_DAY = 6 * 60
export const ENERGY_RECOVERY_PER_GAME_MINUTE = ENERGY_RECOVERY_PER_GAME_DAY / GAME_MINUTES_PER_DAY
export const ENERGY_RECOVERY_PER_REAL_MINUTE = ENERGY_RECOVERY_PER_GAME_DAY / REAL_MINUTES_PER_GAME_DAY

export function weekOfAction(action: number): number {
  return Math.max(1, Math.ceil(action / ACTIONS_PER_WEEK))
}

export function nextWeek(session: TrainingSession): number {
  if (session.scheduleVersion === 1) return trainingDate(Math.min(trainingActionsTotal(session), session.action + 1)).week
  return Math.min(weekOfAction(trainingActionsTotal(session)), Math.floor(session.action / ACTIONS_PER_WEEK) + 1)
}

function sessionWeek(session: TrainingSession, action: number): number {
  return session.scheduleVersion === 1 ? trainingDate(action).week : weekOfAction(action)
}

/** 没有显式快照时的默认阶段：1 级满阶段，保留旧课程测试的满额加成。 */
const DEFAULT_STAGE = STAGES_PER_LEVEL

export function createTrainingSession(player: Player, seed: number, snapshot: TrainingSession['facilityLevels'] | number = { stadium: DEFAULT_STAGE, academy: DEFAULT_STAGE, medical: DEFAULT_STAGE, shop: DEFAULT_STAGE, sponsor: DEFAULT_STAGE, psychology: DEFAULT_STAGE, tactics: DEFAULT_STAGE }, stadiumLevel = 1, books?: TrainingSession['books']): TrainingSession {
  // 旧的三参数写法传的是等级，换算成阶段后与新的存档格式一致。
  const levels = typeof snapshot === 'number'
    ? { stadium: stadiumLevel * STAGES_PER_LEVEL, academy: snapshot * STAGES_PER_LEVEL, medical: DEFAULT_STAGE, shop: DEFAULT_STAGE, sponsor: DEFAULT_STAGE, psychology: DEFAULT_STAGE, tactics: DEFAULT_STAGE }
    : snapshot!
  const candidate: Player = {
    ...player,
    attrs: { ...player.attrs },
    ceilings: { ...player.ceilings },
    positions: { ...player.positions },
    personality: { ...player.personality },
    baseAttrs: { ...player.baseAttrs },
    basePositions: { ...player.basePositions },
    basePersonality: { ...player.basePersonality },
    history: player.history?.map(entry => ({ ...entry, gains: entry.gains && { ...entry.gains } })),
    skills: [...player.skills],
    skillTiers: player.skillTiers && { ...player.skillTiers },
    version: player.version + 1,
  }
  return {
    scheduleVersion: 1,
    scheduleSeed: seed,
    playerId: player.id,
    seed,
    ...(books?.length ? { books: books.slice(0, 4) } : {}),
    candidate,
    facilityLevels: { ...levels },
    facilityStageVersion: FACILITY_STAGE_VERSION,
    academyLevel: levels.academy,
    stadiumLevel: levels.stadium,
    baseVersion: player.version,
    actionsTotal: ACTIONS_PER_ROUTE,
    action: 0,
    fatigue: 0,
    energy: Math.max(0, Math.min(100, player.energy ?? 100)),
    routeId: null,
    routePoints: 0,
    flags: [],
    eventCounts: {},
    lastEventAction: {},
    trained: {},
    trainedSinceEvent: {},
    focusHistory: [],
    pendingEventId: null,
    pendingEventAction: null,
    log: [
      {
        action: 0,
        week: 1,
        kind: 'system',
        title: '开始新一轮培养',
        text: '从原始属性开始培养。本轮 15 天，每天上午和下午各练一次；每周一上午交流赛，周五上午队内比赛、下午恢复。结束后产出一张新卡进入库存，和之前的卡互不影响。基础上限 1500，奖励/技能可把上限推到 2000。',
      },
    ],
    completed: false,
    startedAt: Date.now(),
  }
}

export function candidateIsGk(session: TrainingSession): boolean {
  return isGoalkeeper(session.candidate)
}

function actionRng(session: TrainingSession, nextAction: number, label: string) {
  return derivedRng(session.seed, 'training-action', session.playerId, nextAction, label)
}

const FACILITY_CATEGORY: Record<AttrKey, 'medical' | 'academy' | 'psychology' | 'tactics'> = {
  acceleration: 'medical', speed: 'medical', agility: 'medical', strength: 'medical', endurance: 'medical',
  passing: 'academy', firstTouch: 'academy', dribbling: 'academy', shooting: 'academy', tackling: 'academy', heading: 'academy', reflexes: 'academy', handling: 'academy', rushing: 'academy', oneOnOne: 'academy',
  teamwork: 'psychology', composure: 'psychology', decisions: 'psychology',
  vision: 'tactics', anticipation: 'tactics', offBall: 'tactics', defPos: 'tactics',
}

const FACILITY_IDS: FacilityId[] = ['stadium', 'academy', 'medical', 'shop', 'sponsor', 'psychology', 'tactics']

/** 旧培养快照存的是 1–5 级，就地换成阶段，保留原有等级与满级加成。 */
function stageSnapshot(session: TrainingSession): TrainingSession['facilityLevels'] {
  const levels = session.facilityLevels
  if (!levels) return undefined
  if (session.facilityStageVersion !== FACILITY_STAGE_VERSION) {
    for (const id of FACILITY_IDS) {
      if (id === 'psychology' || id === 'tactics') continue
      const value = levels[id]
      const legacy = Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_FACILITY_LEVEL ? (value as number) : 1
      levels[id] = Math.min(MAX_FACILITY_STAGE, legacy * STAGES_PER_LEVEL)
    }
    // 旧培养快照里的商店/赞助商同时包含培养加成，拆出来以后由新设施继承。
    levels.psychology ??= levels.shop
    levels.tactics ??= levels.sponsor
    session.facilityStageVersion = FACILITY_STAGE_VERSION
  }
  return levels
}

export type FacilityRolls = { stadium: number; category: number }

/**
 * 设施提供的成长加成。阶段 1–5 依次有 20%/40%/60%/80%/100% 的概率触发，
 * 因此没触发时这次行动就没有建筑加成；等级决定加成数值。
 */
export function facilityGrowthBonus(session: TrainingSession, key: AttrKey, rolls?: FacilityRolls): number {
  const levels = stageSnapshot(session)
  if (!levels) return 0 // Old in-progress saves have no facility snapshot.
  const category = FACILITY_CATEGORY[key]
  const roll = (id: FacilityId, slot: keyof FacilityRolls): number => rolls
    ? rolls[slot]
    : derivedRng(session.seed, 'facility-bonus', session.playerId, session.action + 1, key, id).float()
  const stadiumStage = levels.stadium
  const categoryStage = levels[category]
  // 旧课程快照里可能没有新增设施：那种情况只算球场。
  if (stadiumStage === undefined) return 0
  const stadium = roll('stadium', 'stadium') < facilityStageChance(stadiumStage) ? 2 * facilityLevel(stadiumStage) : 0
  if (categoryStage === undefined) return stadium
  const bonus = roll(category, 'category') < facilityStageChance(categoryStage) ? 5 * facilityLevel(categoryStage) : 0
  return stadium + bonus
}

/**
 * 每名队友/陪练给每个正成长属性额外加多少点：取这轮开始时七座设施里**最低的等级**——
 * 没全到 2 级是 1 点，全到 2 级后 2 点，全到 3 级后 3 点……全满级 5 点。
 * 旧课程没有设施快照，仍按原来的 2 点。
 */
export function partnerBonusPerMate(session: TrainingSession): number {
  const levels = stageSnapshot(session)
  if (!levels) return 2
  const lowest = Math.min(...FACILITY_IDS.map((id) => (levels[id] === undefined ? 1 : facilityLevel(levels[id]!))))
  return Math.max(1, Math.min(MAX_FACILITY_LEVEL, lowest))
}

function trainingCeilings(session: TrainingSession): Player['ceilings'] {
  // 奖杯是俱乐部实时加成，不写进球员个人 ceilings；旧培养/新培养统一走这里。
  return effectiveTrainingCeilings(session)
}

// Authored gains are already in storage units. The facility bonus replaces the
// old academy percentage multiplier and is added only to requested growth.
function facilityGains(session: TrainingSession, gains: Partial<Record<AttrKey, number>>): Partial<Record<AttrKey, number>> {
  const gk = candidateIsGk(session)
  return Object.fromEntries((Object.entries(gains) as [AttrKey, number][]).map(([key, value]) =>
    [key, value > 0 ? value + facilityGrowthBonus(session, key) * attrMax(key, gk) / MAIN_ATTR_MAX : value]))
}

function applyTrainingGains(session: TrainingSession, gains: Partial<Record<AttrKey, number>>) {
  return applyGains(session.candidate.attrs, trainingCeilings(session), CA_MAX, gains, candidateIsGk(session))
}

function moodGains(session: TrainingSession, gains: Partial<Record<AttrKey, number>>, action: number) {
  if (!trainingLowMood(session, action)) return gains
  return Object.fromEntries((Object.entries(gains) as [AttrKey, number][]).map(([key, value]) => [key, value > 0 ? value * 0.5 : value]))
}

/** 培养品质的倍数：只乘主属性/隐藏属性的基础值，不乘建筑和队友加成。 */
const QUALITY_MULTIPLIER = { failure: 0, plain: 0.7, success: 1, great: 1.3, perfect: 1.6 } as const
/** 体力（100 − 已消耗的疲劳）达到这个值就不会出“一般”；低于它，每低一点“一般”的概率就升一点。 */
export const PLAIN_FREE_STAMINA = 60
/** “一般”的概率上限：体力 30 以下不再继续升高，把余量让给“失败”。 */
export const PLAIN_MAX_CHANCE = 0.4
/** 大成功、完美成功的概率；体力 30 及以下直接关掉。 */
export const GREAT_CHANCE = 0.1
export const PERFECT_CHANCE = 0.02
/** 体力 30 及以下不再有大成功/完美，并开始出现“失败”（不涨属性）。 */
export const FAILURE_STAMINA = 30
/** 刚好 30 体力时的失败概率。 */
export const FAILURE_BASE_CHANCE = 0.05
/** 体力 0 时的失败概率。 */
export const FAILURE_MAX_CHANCE = 0.5
/** 主属性的基础值每次在 ±10% 内浮动（隐藏属性不浮动）。 */
export const GAIN_SPREAD = 0.1

/** 这个体力下出“一般”的概率：≥ 60 为 0，往下线性升到 30 体力时的 40%，之后不再升高。 */
export function plainChance(stamina: number): number {
  if (!(stamina < PLAIN_FREE_STAMINA)) return 0
  return Math.min(PLAIN_MAX_CHANCE, (PLAIN_FREE_STAMINA - Math.max(0, stamina)) / PLAIN_FREE_STAMINA * PLAIN_MAX_CHANCE)
}

/** 这个体力下出“失败”的概率：≥ 30 为 0，30 体力 5%，线性升到 0 体力时的 50%。 */
export function failureChance(stamina: number): number {
  if (!(stamina <= FAILURE_STAMINA)) return 0
  const low = (FAILURE_STAMINA - Math.max(0, stamina)) / FAILURE_STAMINA
  return Math.min(FAILURE_MAX_CHANCE, FAILURE_BASE_CHANCE + (FAILURE_MAX_CHANCE - FAILURE_BASE_CHANCE) * low)
}

/**
 * 这次培养的品质。同一次行动只掷一个骰子（由球员的培养种子和第几次行动决定），
 * 所以换课程不能重抽；骰子落在哪一档只看当前体力：
 * 体力 30 以上才有大成功/完美成功；体力 30 及以下会出现失败（×0），一般最多 40%，
 * 其余是成功。低体力时失败和一般一起挤压成功，逼着玩家安排休息。
 */
export function trainingQuality(session: TrainingSession): { label: string; multiplier: number } {
  const roll = derivedRng(session.seed, 'training-quality', session.playerId, session.action + 1).float()
  const stamina = 100 - session.fatigue
  const failure = failureChance(stamina)
  const plain = plainChance(stamina)
  const canCrit = stamina > FAILURE_STAMINA
  const fastLearner = legendValue(session.candidate, 'lg_fast_learner', 0.05)
  const perfect = canCrit ? PERFECT_CHANCE + fastLearner : 0
  const great = canCrit ? GREAT_CHANCE + fastLearner : 0
  if (roll < failure) return { label: '失败', multiplier: QUALITY_MULTIPLIER.failure }
  if (roll >= 1 - perfect) return { label: '完美成功', multiplier: QUALITY_MULTIPLIER.perfect }
  if (roll >= 1 - perfect - great) return { label: '大成功', multiplier: QUALITY_MULTIPLIER.great }
  if (roll < failure + plain) return { label: '一般', multiplier: QUALITY_MULTIPLIER.plain }
  return { label: '成功', multiplier: QUALITY_MULTIPLIER.success }
}

/**
 * 主属性基础值的浮动系数（0.9–1.1）。由培养种子、第几次行动和属性决定：
 * 预览和实际结算一致，换课程也不能重抽。
 */
function gainSpread(session: TrainingSession, key: AttrKey): number {
  const roll = derivedRng(session.seed, 'training-gain-spread', session.playerId, session.action + 1, key).float()
  return 1 + (roll * 2 - 1) * GAIN_SPREAD
}

function trainingFatigueCost(session: TrainingSession, base: number): number {
  return Math.max(0, Math.round(base * (1 - legendValue(session.candidate, 'lg_iron_constitution', 0.2))))
}

function legendGrowthMultiplier(session: TrainingSession, key: AttrKey, kind: string): number {
  const candidate = session.candidate
  let multiplier = 1
  if (kind === 'drill') multiplier += legendValue(candidate, 'lg_drill_master', 0.12)
  if (kind === 'match') multiplier += legendValue(candidate, 'lg_match_ready', 0.25)
  if ((['acceleration', 'speed', 'agility', 'strength'] as AttrKey[]).includes(key)) multiplier += legendValue(candidate, 'lg_physical_gift', 0.2)
  if ((['passing', 'shooting', 'dribbling', 'firstTouch'] as AttrKey[]).includes(key)) multiplier += legendValue(candidate, 'lg_technical_gift', 0.2)
  return multiplier
}

function actionGains(session: TrainingSession, gains: Partial<Record<AttrKey, number>>, multiplier: number, teammates: number, kind = 'other') {
  // 失败：这次行动没有任何属性成长（队友、设施、心情加成也一并免谈）。
  if (!(multiplier > 0)) return applyTrainingGains(session, {})
  const gk = candidateIsGk(session)
  const scaled = scaleAuthoredGains(gains, gk)
  // 主属性的基础值先浮动 ±10%，再乘品质，最后加队友；隐藏属性不浮动。
  const withTeam = Object.fromEntries((Object.entries(scaled) as [AttrKey, number][]).map(([key, value]) =>
    [key, value > 0 ? value * (isMainAttr(key, gk) ? gainSpread(session, key) : 1) * multiplier * legendGrowthMultiplier(session, key, kind) + partnerBonusPerMate(session) * teammates * attrMax(key, gk) / MAIN_ATTR_MAX : value]))
  return applyTrainingGains(session, moodGains(session, facilityGains(session, withTeam), session.action + 1))
}

/** 站在“恢复”上的每名陪练额外恢复的训练体力（比练其他项目时每人带来的成长更大一些）。 */
export const REST_PARTNER_RECOVERY = 4

/**
 * 这次行动有几名陪练站在所选项目上。日历课程里 6 名陪练每个时段随机分到各个选项，
 * 选了哪个选项才拿哪个选项上的人；旧课程没有日历，仍然全员加成。
 */
export function partnersAt(session: TrainingSession, request: TrainingRequest): number {
  const total = session.partnerIds?.length ?? 0
  if (!total) return 0
  if (session.scheduleVersion !== 1) return total
  if (request.kind !== 'activity') return 0
  return partnerAssignment(session)[request.activityId]?.length ?? 0
}

/**
 * 预览：hideQuality 为 true 时按“成功”档算成长，不泄露这一次掷出的品质（界面在执行后才揭晓）。
 * 真正结算始终不传它。
 */
export function planTraining(session: TrainingSession, request: TrainingRequest, mentor?: Player, teammateCount = 0, hideQuality = false): TrainingPlan {
  const before = caOf(session.candidate.attrs, candidateIsGk(session))
  if (session.scheduleVersion === 1) {
    if (session.completed || session.action >= trainingActionsTotal(session)) return emptyPlan('课程', '本轮培养已经结束。', before)
    if (session.pendingEventId) return emptyPlan('课程', '请先处理当前事件。', before)
    if (request.kind !== 'activity') return emptyPlan('课程', '请选择当前时段提供的课程。', before)
    const activity = trainingOptions(session).find(item => item.id === request.activityId)
    if (!activity) return emptyPlan('课程', '当前时段没有提供该课程。', before)
    const legacy: TrainingRequest | undefined = activity.id === 'position' ? { kind: 'position', position: request.position! } :
      activity.id === 'inherit' ? { kind: 'inherit', mentorId: request.mentorId!, skill: request.skill! } :
      activity.id === 'prevention' || activity.id === 'resilience' ? { kind: 'protection', focus: activity.id } :
      activity.id === 'rest' ? { kind: 'rest' } : activity.id === 'mentor' ? { kind: 'mentor' } :
      activity.id === 'match' || activity.id === 'exchange' ? { kind: 'match' } : undefined
    if (legacy) {
      const plan = planLegacyTraining(session, legacy, mentor, teammateCount, hideQuality)
      return { ...plan, label: activity.label, text: activity.desc, ...(activity.noRecovery ? { fatigue: 0, note: undefined } : {}) }
    }
    const cost = trainingFatigueCost(session, activity.cost!)
    if (session.fatigue + cost > 100) return emptyPlan(activity.label, `训练体力不足，需要 ${cost} 点，请先休息。`, before)
    const quality = hideQuality ? { label: '成功', multiplier: QUALITY_MULTIPLIER.success } : trainingQuality(session)
    const gains = candidateIsGk(session) ? activity.goalkeeperGains ?? activity.gains! : activity.gains!
    const result = actionGains(session, gains, quality.multiplier, teammateCount, activity.id === 'match' || activity.id === 'exchange' ? 'match' : 'other')
    return { kind: 'activity', label: activity.label, text: activity.desc, gains: result.actual, fatigue: cost, energyCost: 0, error: false, quality, caBefore: result.caBefore, caAfter: result.caAfter, scale: result.scale, cappedByCeiling: result.cappedByCeiling, cappedByPa: result.cappedByPa, note: result.cappedByCeiling ? '部分属性已达各自上限' : undefined }
  }
  if (request.kind === 'activity') return emptyPlan('培养', '旧课程不支持日历项目。', before)
  return planLegacyTraining(session, request, mentor, teammateCount, hideQuality)
}

function planLegacyTraining(session: TrainingSession, request: Exclude<TrainingRequest, { kind: 'activity' }>, mentor?: Player, teammateCount = 0, hideQuality = false): TrainingPlan {
  const nextAction = session.action + 1
  const isGk = candidateIsGk(session)
  const before = caOf(session.candidate.attrs, isGk)
  const requestedCost = request.kind === 'drill' ? 12 : request.kind === 'combo' ? 16 : request.kind === 'match' ? 25 :
    request.kind === 'position' || request.kind === 'protection' || request.kind === 'inherit' ? 8 : 0
  // 新课程里的交流赛和队内比赛是必须参加的，不消耗训练体力；作为交换，周五下午的休整不恢复体力。
  const cost = session.scheduleVersion === 1 && request.kind === 'match' ? 0 : trainingFatigueCost(session, requestedCost)
  if (session.fatigue + cost > 100) return emptyPlan('训练体力不足', `训练体力不足，需要 ${cost} 点，请先休息。`, before)
  if (request.kind === 'drill') {
    const attr = request.attr
    if (!ALL_ATTRIBUTES.includes(attr)) return emptyPlan('专项训练', '无效的训练属性。', before)
    if (!isGk && (attr === 'reflexes' || attr === 'handling' || attr === 'rushing' || attr === 'oneOnOne')) {
      return emptyPlan('专项训练', '外场球员不能训练门将专属属性。', before)
    }
    if (!isMainAttr(attr, isGk)) {
      return emptyPlan('专项训练', `${attrLabel(attr)} 是隐藏属性，不能直接专项训练；只能通过事件、配合或测验成长。`, before)
    }
    const rng = actionRng(session, nextAction, `drill-${attr}`)
    const professionalism = session.candidate.personality.professionalism
    const mainGain = 1 + rng.int(2)
    const ceilings = trainingCeilings(session)
    const relatedOptions = RELATED_ATTRS[attr].filter(
      (key) => (isGk || !['reflexes', 'handling', 'rushing', 'oneOnOne'].includes(key)) && session.candidate.attrs[key] < ceilings[key],
    )
    const related = relatedOptions.length > 0 && rng.chance(0.55 + professionalism / 500) ? rng.pick(relatedOptions) : null
    const gains: Partial<Record<AttrKey, number>> = { [attr]: mainGain }
    if (related) gains[related] = 1
    const quality = hideQuality ? { label: '成功', multiplier: QUALITY_MULTIPLIER.success } : trainingQuality(session)
    const result = actionGains(session, gains, quality.multiplier, teammateCount, 'drill')
    const fatigue = trainingFatigueCost(session, 12)
    const noteParts: string[] = []
    if (result.cappedByCeiling) noteParts.push('部分属性已达各自上限')
    if (related) noteParts.push(`相关属性：${attrLabel(related)}`)
    return {
      kind: 'drill',
      label: `专项训练 · ${attrLabel(attr)}`,
      text: `重点练习${attrLabel(attr)}。${ATTR_META[attr].desc}。`,
      gains: result.actual,
      fatigue,
      energyCost: 0,
      error: false,
      quality,
      caBefore: result.caBefore,
      caAfter: result.caAfter,
      scale: result.scale,
      cappedByCeiling: result.cappedByCeiling,
      cappedByPa: result.cappedByPa,
      note: noteParts.join('；'),
    }
  }
  if (request.kind === 'combo') {
    if (request.focus !== 'attack' && request.focus !== 'defense') return emptyPlan('配合训练', '无效的配合方向。', before)
    const rng = actionRng(session, nextAction, `combo-${request.focus}`)
    const attack = request.focus === 'attack'
    const pool = attack ? ['passing', 'firstTouch', 'offBall', 'teamwork'] : ['defPos', 'tackling', 'anticipation', 'teamwork']
    const first = pool[0] as AttrKey
    const second = pool[1] as AttrKey
    const third = pool[3] as AttrKey
    const gains: Partial<Record<AttrKey, number>> = {
      [first]: 0.5 + rng.int(2) * 0.5,
      [second]: 0.5 + rng.int(2) * 0.5,
      [third]: 0.5,
    }
    const quality = hideQuality ? { label: '成功', multiplier: QUALITY_MULTIPLIER.success } : trainingQuality(session)
    const result = actionGains(session, gains, quality.multiplier, teammateCount, 'combo')
    return {
      kind: 'combo',
      label: attack ? '配合训练 · 进攻' : '配合训练 · 防守',
      text: attack ? '短传、接应、跑位与团队合作同步练习。' : '站位、抢断、预判与补位同步练习。',
      gains: result.actual,
      fatigue: trainingFatigueCost(session, 16),
      energyCost: 0,
      error: false,
      quality,
      caBefore: result.caBefore,
      caAfter: result.caAfter,
      scale: result.scale,
      cappedByCeiling: result.cappedByCeiling,
      cappedByPa: result.cappedByPa,
      note: [result.cappedByCeiling ? '部分属性已达各自上限' : ''].filter(Boolean).join('；') || undefined,
    }
  }
  if (request.kind === 'match') {
    const key: AttrKey = isGk ? 'reflexes' : 'speed'
    const gains: Partial<Record<AttrKey, number>> = { passing: 2, [key]: 2, teamwork: 1 }
    const quality = hideQuality ? { label: '成功', multiplier: QUALITY_MULTIPLIER.success } : trainingQuality(session)
    const result = actionGains(session, gains, quality.multiplier, teammateCount, 'match')
    return {
      kind: 'match', label: '队内比赛', text: '高强度队内比赛，综合练习传球与身体或扑救。',
      gains: result.actual, fatigue: cost, energyCost: 0, error: false, quality,
      caBefore: result.caBefore, caAfter: result.caAfter, scale: result.scale,
      cappedByCeiling: result.cappedByCeiling, cappedByPa: result.cappedByPa,
      note: result.cappedByCeiling ? '部分属性已达各自上限' : undefined,
    }
  }
  if (request.kind === 'position') {
    const player = session.candidate
    const pos = request.position
    if (!['GK', 'CB', 'W', 'CM', 'ST'].includes(pos)) return emptyPlan('位置训练', '无效的位置。', before)
    if (!isGk && pos === 'GK') return emptyPlan('位置训练', '外场球员不能转职门将。', before)
    if (isGk && pos !== 'GK') return emptyPlan('位置训练', '首版门将不能转职外场。', before)
    if (player.positions[pos] >= 100) return emptyPlan('位置训练', `${pos} 熟练度已达 100。`, before)
    const rng = actionRng(session, nextAction, `position-${pos}`)
    const adaptability = player.personality.adaptability
    const current = player.positions[pos]
    const amount = current <= 0 ? 35 + adaptability * 0.15 : 6 + adaptability / 18 + rng.int(3)
    return {
      kind: 'position',
      label: `位置训练 · ${pos}`,
      text: current <= 0 ? `从零学习 ${pos} 的基本站位与任务。` : `提高 ${pos} 的熟练度，减少比赛中的属性折损。`,
      gains: {},
      fatigue: 8,
      energyCost: 0,
      error: false,
      caBefore: before,
      caAfter: before,
      scale: 1,
      cappedByCeiling: false,
      cappedByPa: false,
      note: `熟练度 ${Math.round(current)} → ${Math.min(100, Math.round(current + amount))}`,
    }
  }
  if (request.kind === 'inherit') {
    if (!mentor || mentor.id !== request.mentorId) return emptyPlan('技能传承', '请选择队内导师。', before)
    const error = validateInheritance(session, mentor, request.skill)
    if (error) return emptyPlan('技能传承', error, before)
    const chance = inheritanceChances(session, mentor, request.skill)
    return { kind: 'inherit', label: `技能传承 · ${SKILLS[request.skill].name}`, text: `向 ${mentor.name} 学习技能。`, gains: {}, fatigue: 8, energyCost: 0, error: false, caBefore: before, caAfter: before, scale: 1, cappedByCeiling: false, cappedByPa: false, note: `成功率 ${Math.round(chance.success * 100)}%，成功后金色 ${Math.round(chance.gold * 100)}%、彩色 ${Math.round(chance.rainbow * 100)}%` }
  }
  if (request.kind === 'protection') {
    if (request.focus !== 'prevention' && request.focus !== 'resilience') return emptyPlan('伤病防护', '无效的防护方向。', before)
    const skill: SkillId = request.focus === 'prevention' ? 'injury_prevention' : 'injury_resilience'
    if (!canLearnSkill(session.candidate.skills, skill)) {
      return emptyPlan('伤病防护', session.candidate.skills.includes(skill) ? '技能已掌握。' : '辅助技能槽已满。', before)
    }
    return { kind: 'protection', label: `伤病防护 · ${SKILLS[skill].name}`, text: `学习${SKILLS[skill].name}。`, gains: {}, fatigue: 8, energyCost: 0, error: false, caBefore: before, caAfter: before, scale: 1, cappedByCeiling: false, cappedByPa: false }
  }
  if (request.kind === 'rest') {
    // 站在恢复上的陪练：每人多恢复一点训练体力。
    const recovery = (30 + REST_PARTNER_RECOVERY * teammateCount) * (1 + legendValue(session.candidate, 'lg_recovery_pro', 0.3))
    return {
      kind: 'rest',
      label: '休息',
      text: '主动恢复，降低培养期疲劳。',
      gains: {},
      fatigue: -recovery,
      energyCost: 0,
      error: false,
      caBefore: before,
      caAfter: before,
      scale: 1,
      cappedByCeiling: false,
      cappedByPa: false,
      note: `疲劳 ${Math.round(session.fatigue)} → ${Math.round(Math.max(0, session.fatigue - recovery))}`,
    }
  }
  if (request.kind !== 'mentor') return emptyPlan('培养', '无效的培养行动。', before)
  return {
    kind: 'mentor',
    label: '导师活动',
    text: '与导师交流，保证触发一次当前可用事件。',
    gains: {},
    fatigue: -5,
    energyCost: 0,
    error: false,
    caBefore: before,
    caAfter: before,
    scale: 1,
    cappedByCeiling: false,
    cappedByPa: false,
    note: eligibleEventCount(session) > 0 ? '当前有可用事件，将优先触发路线/主线事件' : '当前没有特殊事件，会做一次基础复盘',
  }
}

function emptyPlan(label: string, text: string, ca: number): TrainingPlan {
  return {
    kind: 'drill',
    label,
    text,
    gains: {},
    fatigue: 0,
    energyCost: 0,
    error: false,
    caBefore: ca,
    caAfter: ca,
    scale: 1,
    cappedByCeiling: false,
    cappedByPa: false,
    invalid: true,
    note: text,
  }
}

export function eligibleEvents(session: TrainingSession, action = session.action): EventDef[] {
  const isGk = candidateIsGk(session)
  return [...EVENTS, ...bookEvents(session)].filter((event) => {
    const trigger = event.trigger
    if (event.once !== false) {
      if (session.flags.includes(event.id)) return false
    } else {
      const last = session.lastEventAction[event.id]
      if (last !== undefined && action - last <= (event.cooldown ?? 0)) return false
    }
    if (event.maxTimes !== undefined && (session.eventCounts[event.id] ?? 0) >= event.maxTimes) return false
    if (event.mutex?.some((id) => session.flags.includes(id))) return false
    const minAction = event.id === 'main_graduation' ? trainingActionsTotal(session) : trigger.minAction
    const maxAction = event.id === 'main_graduation' ? trainingActionsTotal(session) : trigger.maxAction
    if (minAction !== undefined && action < minAction) return false
    if (maxAction !== undefined && action > maxAction) return false
    if (trigger.minFatigue !== undefined && session.fatigue < trigger.minFatigue) return false
    if (trigger.playerCategory === 'gk' && !isGk) return false
    if (trigger.playerCategory === 'field' && isGk) return false
    if (trigger.playerCategory === undefined && event.id === 'train_gk' && !isGk) return false
    if (trigger.route && session.routeId !== trigger.route) return false
    if (trigger.noRoute && session.routeId !== null) return false
    if (trigger.routeMin !== undefined) {
      if (!session.routeId || session.routePoints < trigger.routeMin) return false
    }
    if (trigger.flag && !session.flags.includes(trigger.flag)) return false
    if (trigger.prior && !trigger.prior.every((id) => session.flags.includes(id))) return false
    if (trigger.minAttrs) {
      for (const [key, value] of Object.entries(trigger.minAttrs) as [AttrKey, number][]) {
        if (attrRating(key, session.candidate.attrs[key], isGk) < value) return false
      }
    }
    if (trigger.trained) {
      for (const [key, value] of Object.entries(trigger.trained) as [AttrKey, number][]) {
        if ((session.trained[key] ?? 0) < value) return false
      }
    }
    if (trigger.trainedAny) {
      const entries = Object.entries(trigger.trainedAny) as [AttrKey, number][]
      if (!entries.some(([key, value]) => (session.trained[key] ?? 0) >= value)) return false
    }
    if (trigger.trainedSince) {
      for (const [key, value] of Object.entries(trigger.trainedSince) as [AttrKey, number][]) {
        if ((session.trainedSinceEvent[key] ?? 0) < value) return false
      }
    }
    if (trigger.trainedSinceAny) {
      const entries = Object.entries(trigger.trainedSinceAny) as [AttrKey, number][]
      if (!entries.some(([key, value]) => (session.trainedSinceEvent[key] ?? 0) >= value)) return false
    }
    return true
  })
}

export function eligibleEventCount(session: TrainingSession, action = session.action): number {
  return eligibleEvents(session, action).length
}

export function guaranteedEvent(session: TrainingSession, action = session.action): EventDef | null {
  const eligible = eligibleEvents(session, action)
  const mainline = eligible.find((event) => event.mainline && (event.id === 'main_graduation' ? trainingActionsTotal(session) : event.trigger.minAction) === action)
  if (mainline) return mainline
  // 事件链不再“一满足条件就必出”：平时和普通事件一样靠概率抽，只有到了最迟期限才强制出现（公开的路线保障）。
  const overdue = eligible
    .filter((event) => event.trigger.latestAction !== undefined && action >= event.trigger.latestAction)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (b.stage ?? 0) - (a.stage ?? 0))
  if (overdue.length) return overdue[0]
  return null
}

/** 没有保底事件时，每次行动后出现事件的概率。保底事件（主线、路线入口等）仍是 100%。 */
export const EVENT_BASE_CHANCE = 0.1

export function pickEvent(session: TrainingSession, force = false): EventDef | null {
  const action = session.action
  const guaranteed = guaranteedEvent(session, action)
  if (guaranteed) return guaranteed
  const eligible = eligibleEvents(session, action).filter((event) => !event.mainline)
  if (eligible.length === 0) return null
  if (force) {
    eligible.sort((a, b) => b.weight - a.weight)
    return eligible[0]
  }
  // 先掷“这次行动有没有事件”，再按权重从候选里选具体哪个；两个骰子都由种子和行动序号决定，读档不重抽。
  if (derivedRng(session.seed, 'event-trigger', session.playerId, action).float() >= EVENT_BASE_CHANCE) return null
  const rng = derivedRng(session.seed, 'event-select', session.playerId, action)
  return rng.weighted(eligible, eligible.map((event) => eventWeight(session, event)))
}

function eventWeight(session: TrainingSession, event: EventDef): number {
  if (!event.chain || !session.routeId) return event.weight
  return event.weight * (ROUTE_CHAIN[session.routeId] === event.chain ? 1.25 : 1)
}

export function eventChance(session: TrainingSession, action = session.action): number {
  if (guaranteedEvent(session, action)) return 1
  return eligibleEvents(session, action).some((event) => !event.mainline) ? EVENT_BASE_CHANCE : 0
}

export type PerformResult = {
  ok: boolean
  error?: string
  event?: EventDef | null
  completed: boolean
  exchange?: TrainingExchange
}

/** Applies a session action only; callers must simulate and persist calendar exchange results via trainingAction. */
export function performTrainingAction(session: TrainingSession, request: TrainingRequest, mentor?: Player, teammateCount = 0, options: { silent?: boolean } = {}): PerformResult {
  if (session.completed) return { ok: false, error: '本轮培养已经结束', completed: true }
  if (session.pendingEventId) return { ok: false, error: '请先处理当前事件', completed: false }
  if (session.action >= trainingActionsTotal(session)) return { ok: false, error: '本轮培养的时段已用完', completed: true }
  const plan = planTraining(session, request, mentor, teammateCount)
  if (plan.invalid) return { ok: false, error: plan.note, completed: false }
  if (request.kind === 'activity') {
    const id = request.activityId
    if (id === 'position') {
      const pos = request.position!
      const current = session.candidate.positions[pos]
      const amount = current <= 0 ? 35 + session.candidate.personality.adaptability * 0.15 : 6 + session.candidate.personality.adaptability / 18 + actionRng(session, session.action + 1, `position-${pos}`).int(3)
      session.candidate.positions = { ...session.candidate.positions, [pos]: Math.min(100, current + amount) }
      plan.text += ` 熟练度 ${Math.round(current)} → ${Math.round(Math.min(100, current + amount))}。`
    } else if (id === 'inherit') {
      const outcome = mentorSkill(session, mentor!, request.skill!)
      if (!outcome.ok) return { ok: false, error: outcome.error, completed: false }
      plan.text += outcome.success ? ` 成功获得${{ silver: '银色', gold: '金色', rainbow: '彩色' }[outcome.tier!]}${SKILLS[request.skill!].name}。` : ' 本次传承未成功。'
    } else if (id === 'prevention' || id === 'resilience') {
      session.candidate.skills = [...session.candidate.skills, id === 'prevention' ? 'injury_prevention' : 'injury_resilience']
    }
    const result = applyTrainingGains(session, plan.gains)
    session.candidate.attrs = result.attrs
    for (const key of Object.keys(plan.gains) as AttrKey[]) {
      session.trained[key] = (session.trained[key] ?? 0) + 1
      session.trainedSinceEvent[key] = (session.trainedSinceEvent[key] ?? 0) + 1
      session.focusHistory.push(key)
    }
    session.log.push({ action: session.action + 1, week: sessionWeek(session, session.action + 1), kind: 'action', title: `${plan.label}${plan.quality ? `（${plan.quality.label}）` : ''}`, text: plan.text, gains: result.actual, fatigue: plan.fatigue })
  } else if (request.kind === 'drill') {
    const result = applyTrainingGains(session, plan.gains)
    session.candidate.attrs = result.attrs
    session.trained[request.attr] = (session.trained[request.attr] ?? 0) + 1
    session.trainedSinceEvent[request.attr] = (session.trainedSinceEvent[request.attr] ?? 0) + 1
    session.focusHistory.push(request.attr)
    session.log.push({
      action: session.action + 1,
      week: weekOfAction(session.action + 1),
      kind: 'action',
      title: `${plan.label}（${plan.quality!.label}）`,
      text: plan.text,
      gains: result.actual,
      fatigue: plan.fatigue,
    })
  } else if (request.kind === 'combo' || request.kind === 'match') {
    const result = applyTrainingGains(session, plan.gains)
    session.candidate.attrs = result.attrs
    const keys = Object.keys(plan.gains) as AttrKey[]
    for (const key of keys) {
      session.trained[key] = (session.trained[key] ?? 0) + 1
      session.trainedSinceEvent[key] = (session.trainedSinceEvent[key] ?? 0) + 1
      session.focusHistory.push(key)
    }
    session.log.push({
      action: session.action + 1,
      week: weekOfAction(session.action + 1),
      kind: 'action',
      title: `${plan.label}（${plan.quality!.label}）`,
      text: plan.text,
      gains: result.actual,
      fatigue: plan.fatigue,
    })
  } else if (request.kind === 'position') {
    const pos = request.position
    const current = session.candidate.positions[pos]
    const amount = current <= 0 ? 35 + session.candidate.personality.adaptability * 0.15 : 6 + session.candidate.personality.adaptability / 18 + actionRng(session, session.action + 1, `position-${pos}`).int(3)
    session.candidate.positions = { ...session.candidate.positions, [pos]: Math.min(100, current + amount) }
    session.log.push({
      action: session.action + 1,
      week: weekOfAction(session.action + 1),
      kind: 'action',
      title: plan.label,
      text: plan.text + ` 熟练度 ${Math.round(current)} → ${Math.round(Math.min(100, current + amount))}。`,
      fatigue: plan.fatigue,
    })
  } else if (request.kind === 'inherit') {
    const result = mentorSkill(session, mentor!, request.skill)
    if (!result.ok) return { ok: false, error: result.error, completed: false }
    const outcome = result.success ? `成功获得${{ silver: '银色', gold: '金色', rainbow: '彩色' }[result.tier!]}${SKILLS[request.skill].name}。` : '本次传承未成功。'
    session.log.push({ action: session.action + 1, week: weekOfAction(session.action + 1), kind: 'action', title: plan.label, text: `${plan.text} ${outcome}`, fatigue: plan.fatigue })
  } else if (request.kind === 'protection') {
    const skill: SkillId = request.focus === 'prevention' ? 'injury_prevention' : 'injury_resilience'
    session.candidate.skills = [...session.candidate.skills, skill]
    session.log.push({ action: session.action + 1, week: weekOfAction(session.action + 1), kind: 'action', title: plan.label, text: plan.text, fatigue: plan.fatigue })
  } else if (request.kind === 'rest') {
    session.log.push({
      action: session.action + 1,
      week: weekOfAction(session.action + 1),
      kind: 'action',
      title: plan.label,
      text: plan.text,
      fatigue: plan.fatigue,
    })
  } else {
    session.log.push({
      action: session.action + 1,
      week: weekOfAction(session.action + 1),
      kind: 'action',
      title: plan.label,
      text: plan.text,
      fatigue: plan.fatigue,
    })
  }
  session.fatigue = Math.max(0, Math.min(100, session.fatigue + plan.fatigue))
  session.action += 1
  const mentorAction = request.kind === 'mentor' || (request.kind === 'activity' && request.activityId === 'mentor')
  // 小队里只有主练的球员触发事件；队友静默推进，免得攒一堆没人处理的事件卡住下一时段。
  const event = options.silent ? null : pickEvent(session, mentorAction)
  if (event) {
    session.pendingEventId = event.id
    session.pendingEventAction = session.action
    return { ok: true, event, completed: false }
  }
  if (mentorAction) {
    const isGk = candidateIsGk(session)
    const result = applyTrainingGains(session, moodGains(session, facilityGains(session, scaleAuthoredGains({ decisions: mentorReviewScale(session) }, isGk)), session.action))
    session.candidate.attrs = result.attrs
    session.log.push({
      action: session.action,
      week: sessionWeek(session, session.action),
      kind: 'event',
      title: '导师复盘',
      text: result.actual.decisions ? '没有额外事件，导师和你复盘了最近几堂训练的选择。' : '没有额外事件，导师复盘没有带来属性增长（决策已达上限）。',
      gains: result.actual,
    })
  }
  if (session.action >= trainingActionsTotal(session)) completeSession(session)
  return { ok: true, event: null, completed: session.completed }
}

export type ResolveResult = {
  ok: boolean
  error?: string
  event?: EventDef
  option?: EventOption
  success?: boolean
  probability?: number
  roll?: number
  text?: string
  gains?: Partial<Record<AttrKey, number>>
  completed: boolean
}

export function resolveTrainingEvent(session: TrainingSession, optionId: string): ResolveResult {
  if (!session.pendingEventId) return { ok: false, error: '当前没有待处理事件', completed: session.completed }
  const event = eventForSession(session, session.pendingEventId)
  if (!event) return { ok: false, error: '未知事件配置', completed: session.completed }
  const option = event.options.find((item) => item.id === optionId)
  if (!option) return { ok: false, error: '未知选项', completed: session.completed }
  const rng = derivedRng(session.seed, 'event-outcome', session.playerId, event.id, option.id, session.action)
  let effect: EventEffect = option.effect ?? {}
  let success: boolean | undefined
  let probability: number | undefined
  let roll: number | undefined
  if (option.book) {
    // 书用平方曲线，不能复用 branchProbability 的线性公式。
    const chance = bookLearnChance?.(session.candidate, option.book) ?? 0
    probability = chance
    roll = rng.float()
    success = roll < chance
    effect = success
      ? { text: `你照着书练成了${bookTierLabel(option.book.tier)}《${SKILLS[option.book.id].name}》。`, bookSkill: option.book }
      : { text: `这本${bookTierLabel(option.book.tier)}《${SKILLS[option.book.id].name}》的动作没做顺，书还在包里。`, fatigue: 6 }
    probability = Math.round(probability * 1000) / 1000
    roll = Math.round(roll * 1000) / 1000
  } else if (option.branch) {
    probability = branchProbability(session, option.branch.check, option.branch.p)
    roll = rng.float()
    success = roll < probability
    effect = success ? option.branch.success : option.branch.failure
    probability = Math.round(probability * 1000) / 1000
    roll = Math.round(roll * 1000) / 1000
  }
  const applied = applyEventEffect(session, effect)
  const baseText = effect.text ?? option.label
  const summary = formatGains(applied.gains, candidateIsGk(session))
  const noteText = applied.notes.length > 0 ? ` ${applied.notes.join('；')}。` : ''
  const text = baseText + noteText + (summary ? `（${summary}）` : '')
  session.log.push({
    action: session.action,
    week: sessionWeek(session, Math.max(1, session.action)),
    kind: 'event',
    title: `${event.title} · ${option.label}`,
    text,
    gains: applied.gains,
  })
  session.flags.push(event.id)
  session.eventCounts[event.id] = (session.eventCounts[event.id] ?? 0) + 1
  session.lastEventAction[event.id] = session.action
  session.trainedSinceEvent = {}
  session.pendingEventId = null
  session.pendingEventAction = null
  if (session.action >= trainingActionsTotal(session)) completeSession(session)
  return {
    ok: true,
    event,
    option,
    success,
    probability,
    roll,
    text,
    gains: applied.gains,
    completed: session.completed,
  }
}

export function branchProbability(
  session: TrainingSession,
  check: { attrs: AttrKey[]; base?: number; scale?: number } | undefined,
  fixed?: number,
): number {
  if (fixed !== undefined) return Math.max(0.05, Math.min(0.95, fixed))
  if (!check) return 0.5
  const isGk = candidateIsGk(session)
  const values = check.attrs.map((attr) => attrRating(attr, session.candidate.attrs[attr] ?? 0, isGk))
  const avg = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  const p = (check.base ?? 0.5) + (check.scale ?? 0.008) * (avg - 50)
  return Math.max(0.12, Math.min(0.9, p))
}

function applyEventEffect(session: TrainingSession, effect: EventEffect): { gains: Partial<Record<AttrKey, number>>; notes: string[] } {
  const notes: string[] = []
  const gains: Partial<Record<AttrKey, number>> = { ...(effect.attrs ?? {}) }
  const isGk = candidateIsGk(session)
  let grantSkill: SkillId | null = null
  if (effect.skill) grantSkill = effect.skill
  if (effect.routeSkill) {
    if (session.routeId) grantSkill = ROUTE_SKILL[session.routeId]
    else {
      gains.decisions = (gains.decisions ?? 0) + 1
      notes.push('尚未选择路线，改为提升决策')
    }
  }
  if (grantSkill) {
    if (session.candidate.skills.includes(grantSkill)) {
      gains.decisions = (gains.decisions ?? 0) + 1
      notes.push('技能已掌握，改为提升决策')
    } else if (!canLearnSkill(session.candidate.skills, grantSkill)) {
      gains.decisions = (gains.decisions ?? 0) + 1
      notes.push('技能槽已满，改为提升决策')
    } else {
      session.candidate.skills = [...session.candidate.skills, grantSkill]
      notes.push(`学会技能`)
    }
  }
  if (effect.bookSkill) {
    const granted = grantBookSkill(session, effect.bookSkill)
    if (granted.ok) notes.push(granted.upgraded ? '技能升档成功' : '学会技能')
    else {
      gains.decisions = (gains.decisions ?? 0) + 1
      notes.push(`${granted.reason ?? '无法学习'}，改为提升决策`)
    }
  }
  const eventGains = Object.fromEntries((Object.entries(gains) as [AttrKey, number][]).map(([key, value]) => [key, value * eventGrowthScale(session)]))
  const result = applyTrainingGains(session, moodGains(session, facilityGains(session, scaleAuthoredGains(eventGains, isGk)), session.pendingEventAction ?? session.action))
  if (result.cappedByCeiling) notes.push('部分属性已达各自上限')
  session.candidate.attrs = result.attrs
  if (effect.fatigue) session.fatigue = Math.max(0, Math.min(100, session.fatigue + effect.fatigue))
  if (effect.personality) {
    for (const [key, value] of Object.entries(effect.personality) as [keyof Player['personality'], number][]) {
      session.candidate.personality[key] = Math.max(1, Math.min(99, session.candidate.personality[key] + value))
    }
  }
  if (effect.position) {
    const pos = effect.position.pos
    const current = session.candidate.positions[pos]
    if (current <= 0) session.candidate.positions[pos] = Math.max(35, effect.position.amount)
    else session.candidate.positions[pos] = Math.min(100, current + effect.position.amount)
  }
  if (effect.route) {
    if (session.routeId && session.routeId !== effect.route.id) {
      notes.push(`已有路线 ${ROUTE_LABELS[session.routeId]}，本效果只增加路线熟练度`)
      session.routePoints += effect.route.points
    } else {
      session.routeId = effect.route.id
      session.routePoints += effect.route.points
    }
  }
  if (effect.routeOwn && session.routeId) session.routePoints += effect.routeOwn
  if (effect.flags) session.flags.push(...effect.flags)
  if (grantSkill) notes.push(`技能：${SKILLS[grantSkill].name}`)
  return { gains: result.actual, notes }
}

export function formatGains(gains: Partial<Record<AttrKey, number>> | undefined, gk = false): string {
  if (!gains) return ''
  return (Object.entries(gains) as [AttrKey, number][])
    .filter(([, value]) => value > 0.01)
    .map(([key, value]) => `${attrLabel(key)} +${attrText(displayGain(key, value, gk))}`)
    .join('，')
}

function completeSession(session: TrainingSession): void {
  if (session.completed) return
  session.completed = true
  session.candidate.version = session.baseVersion + 1
  session.log.push({
    action: trainingActionsTotal(session),
    week: sessionWeek(session, trainingActionsTotal(session)),
    kind: 'system',
    title: '培养完成',
    text: '本轮培养结束。新球员卡已进入库存，换上之前球员仍使用原来的卡。',
  })
}

/** 培养结果页的“装备新卡”：换上刚练出来的卡并收起结果页。 */
export function confirmCandidate(game: GameState, playerId: string): { ok: boolean; error?: string; replaced?: Player } {
  const session = game.training[playerId]
  if (!game.candidates[playerId] || !session) return { ok: false, error: '没有刚完成培养的新卡' }
  const player = game.roster.find((item) => item.id === playerId)
  if (!player) return { ok: false, error: '原球员不存在' }
  const card = addTrainedCard(game, session)
  const result = equipCard(game, playerId, card.id)
  if (!result.ok) return result
  closeFinishedTraining(game, playerId)
  return { ok: true, replaced: player }
}

/** 培养结果页的“丢弃”：这张新卡不要了，球员继续用原来的卡。 */
export function discardCandidate(game: GameState, playerId: string): { ok: boolean; error?: string } {
  const session = game.training[playerId]
  if (!game.candidates[playerId] || !session) return { ok: false, error: '没有刚完成培养的新卡' }
  return deleteCard(game, addTrainedCard(game, session).id)
}

/** 培养结果页的“留在库存”：卡已入库，球员继续用原来的卡。 */
export function keepCandidate(game: GameState, playerId: string): { ok: boolean; error?: string } {
  const session = game.training[playerId]
  if (!game.candidates[playerId] || !session) return { ok: false, error: '没有刚完成培养的新卡' }
  addTrainedCard(game, session)
  closeFinishedTraining(game, playerId)
  return { ok: true }
}

export function trainingPlayerCount(): number {
  return PLAYER_COUNT
}
