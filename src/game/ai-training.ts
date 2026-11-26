import type { AIClubState, AttrKey, EventDef, EventOption, LegendBook, Player, Position, SkillId, SkillTier, TrainingSession } from './types.ts'
import {
  CATEGORY_BONUS_PER_LEVEL,
  FAILURE_STAMINA,
  STADIUM_BONUS_PER_LEVEL,
  branchProbability,
  createTrainingSession,
  eventGrowthScale,
  failureChance,
  partnerBonusPerMate,
  partnersAt,
  performTrainingAction,
  plainChance,
  resolveTrainingEvent,
  trainingActionsForSeason,
  trainingActionsTotal,
  trainingFatigueCost,
} from './training.ts'
import {
  OVERSEAS_CAMP_MULTIPLIER,
  isOverseasCampAction,
  partnerAssignment,
  trainingDate,
  trainingLowMood,
  trainingOptions,
  type TrainingActivity,
} from './training-calendar.ts'
import { bookLearnChance, canChooseTrainingBook, eventForSession, trainingSkillChance } from './legend-learning.ts'
import { getSkillTier } from './inheritance.ts'
import { canLearnSkill, skillCategory } from './data/skills.ts'
import { maxBooksForSeason } from './data/legend-skills.ts'
import { SHOP_SKILLS, type ShopSkillGroup } from './data/shop-skills.ts'
import { isPassiveTrainingBook } from './data/legend-cup-skill.ts'
import { effectiveTrainingCeilings } from './cup-rewards.ts'
import { facilityLevel, facilityStageChance } from './economy.ts'
import { attrMax, attrRating, authoredGain, MAIN_ATTR_MAX } from './scale.ts'
import { keyAttrsOf } from './data/key-attrs.ts'
import { untrainedPlayer } from './cards.ts'
import { caOf } from './ca.ts'
import { derivedRng } from './rng.ts'

type FacilityStages = Pick<AIClubState['economy'], 'stadium' | 'academy' | 'medical' | 'shop' | 'sponsor' | 'psychology' | 'tactics'>

const AI_SUPPORT_SIZE = 6

const FACILITY_CATEGORY: Record<AttrKey, 'medical' | 'academy' | 'psychology' | 'tactics'> = {
  acceleration: 'medical', speed: 'medical', agility: 'medical', strength: 'medical', endurance: 'medical',
  passing: 'academy', firstTouch: 'academy', dribbling: 'academy', shooting: 'academy', tackling: 'academy', heading: 'academy', reflexes: 'academy', handling: 'academy', rushing: 'academy', oneOnOne: 'academy',
  teamwork: 'psychology', composure: 'psychology', decisions: 'psychology',
  vision: 'tactics', anticipation: 'tactics', offBall: 'tactics', defPos: 'tactics',
}

const POSITION_PRIMARY_GROUPS: Record<Position, readonly ShopSkillGroup[]> = {
  GK: ['gk'],
  CB: ['defense'],
  W: ['wing', 'forward', 'midfield'],
  CM: ['midfield', 'defense', 'wing'],
  ST: ['forward', 'wing'],
}

function primaryPositionOf(player: Pick<Player, 'positions'>): Position {
  let best: Position = 'CM'
  let bestScore = -1
  for (const pos of ['GK', 'CB', 'W', 'CM', 'ST'] as const) {
    const score = player.positions[pos] ?? 0
    if (score > bestScore) {
      best = pos
      bestScore = score
    }
  }
  return best
}

/**
 * 给 AI 培养挑选 6 名队内陪练（与玩家 startTrainingWithSupport 规则一致）：
 * 门将选 6 名外场；外场必带 1 名门将 + 5 名各线均衡的外场队友，同位置优先熟练度靠前者。
 * 队友不足 6 人时有几名带几名，绝不凭空造人。
 */
export function pickAIPartners(base: Player, teammates: readonly Player[] | undefined, seed: number): string[] {
  if (!teammates?.length) return []
  const pool = teammates.filter((player) => player.id !== base.id)
  if (!pool.length) return []
  const limit = Math.min(AI_SUPPORT_SIZE, pool.length)
  const rng = derivedRng(seed, 'ai-support-partners', base.id)
  const chosen: string[] = []
  const needs: Position[] = base.positions.GK > 0
    ? ['CB', 'W', 'CM', 'ST', 'CB', 'CM']
    : ['GK', 'CB', 'W', 'CM', 'ST', 'CM']
  for (const pos of needs) {
    if (chosen.length >= limit) break
    const candidates = pool
      .filter((player) => !chosen.includes(player.id) && (pos === 'GK' ? player.positions.GK > 0 : player.positions.GK === 0))
      .sort((a, b) => (b.positions[pos] ?? 0) - (a.positions[pos] ?? 0) || a.id.localeCompare(b.id))
    if (!candidates.length) continue
    const top = candidates.slice(0, Math.min(5, candidates.length))
    chosen.push(top[rng.int(top.length)].id)
  }
  const fillers = pool.filter((player) => !chosen.includes(player.id))
  while (chosen.length < limit && fillers.length) {
    chosen.push(fillers.splice(rng.int(fillers.length), 1)[0].id)
  }
  return chosen
}

const SKILL_TIER_ORDER: Record<SkillTier, number> = { silver: 0, gold: 1, rainbow: 2 }

/** 从俱乐部技能书库存中为本轮培养挑出最多 maxBooksForSeason(seasonIndex) 本匹配位置的书。 */
export function pickAITrainingBooks(
  base: Player,
  clubBooks: readonly LegendBook[] | undefined,
  seasonIndex: number,
  seed: number,
): LegendBook[] {
  if (!clubBooks?.length) return []
  const limit = maxBooksForSeason(seasonIndex)
  const eligible = clubBooks.filter((book) => canChooseTrainingBook(base, book).ok)
  if (eligible.length <= limit) return eligible.map((book) => ({ ...book }))

  const primary = primaryPositionOf(base)
  const preferredGroups = POSITION_PRIMARY_GROUPS[primary]
  const rng = derivedRng(seed, 'ai-training-books', base.id, seasonIndex)
  const auxFull = !canLearnSkill(base.skills, 'injury_prevention') && !canLearnSkill(base.skills, 'injury_resilience')
  const scored = eligible.map((book) => {
    let score = SKILL_TIER_ORDER[book.tier] * 12 + bookLearnChance(base, book) * 10 + rng.float() * 4
    const isAux = !isPassiveTrainingBook(book.id) && skillCategory(book.id) === 'auxiliary'
    if (isPassiveTrainingBook(book.id)) {
      score += 40
    } else if (isAux) {
      score += auxFull ? 2 : 18
    } else {
      const def = (SHOP_SKILLS as Record<string, { group?: ShopSkillGroup } | undefined>)[book.id]
      const idx = def?.group ? preferredGroups.indexOf(def.group) : -1
      score += idx === 0 ? 32 : idx > 0 ? 18 : 8
    }
    return { book, isAux, score }
  })
  scored.sort((a, b) => b.score - a.score)

  const picked: LegendBook[] = []
  let auxCount = 0
  const maxAux = auxFull ? 0 : Math.min(2, Math.max(1, limit - 2))
  for (const item of scored) {
    if (picked.length >= limit) break
    if (item.isAux && auxCount >= maxAux) continue
    picked.push({ ...item.book })
    if (item.isAux) auxCount++
  }
  if (picked.length < limit) {
    for (const item of scored) {
      if (picked.length >= limit) break
      if (picked.some((b) => b.id === item.book.id && b.tier === item.book.tier)) continue
      picked.push({ ...item.book })
    }
  }
  return picked
}

function activityGains(activity: TrainingActivity, gk: boolean): Partial<Record<AttrKey, number>> {
  return (gk ? activity.goalkeeperGains ?? activity.gains : activity.gains) ?? {}
}

function expectedFacilityBonus(session: TrainingSession, attr: AttrKey): number {
  const levels = session.facilityLevels
  if (!levels || levels.stadium === undefined) return 0
  const stadium = facilityStageChance(levels.stadium) * STADIUM_BONUS_PER_LEVEL * facilityLevel(levels.stadium)
  const category = FACILITY_CATEGORY[attr]
  const catStage = levels[category]
  if (catStage === undefined) return stadium
  return stadium + facilityStageChance(catStage) * CATEGORY_BONUS_PER_LEVEL * facilityLevel(catStage)
}

/** 单项属性从 before 增长 gain（按当前有效上限截断）所带来的精确 CA 平方项净增。 */
function caDeltaForAttr(attr: AttrKey, before: number, ceiling: number, gain: number, gk: boolean): number {
  if (!(gain > 0)) return 0
  const room = Math.max(0, ceiling - before)
  const actual = Math.min(gain, room)
  if (!(actual > 1e-6)) return 0
  const r0 = attrRating(attr, before, gk) / 100
  const r1 = attrRating(attr, before + actual, gk) / 100
  return Math.max(0, r1 * r1 - r0 * r0)
}

/**
 * 轻量解析评估一堂常规课的期望 CA 收益：
 * - 严格按有效上限（含俱乐部杯赛上限加成）截断，绝不在已满属性上空转；
 * - 主属性与隐藏属性一视同仁计入 CA 平方增量，并对未满的招牌属性给予温和偏好（+8%）；
 * - 计入陪练站位加成、设施期望加成、低落减半与第 3 周国外特训 ×3。
 */
function scoreActivity(
  session: TrainingSession,
  activity: TrainingActivity,
  keyAttrs: ReadonlySet<AttrKey>,
  ceilings: Player['ceilings'],
  teammates: number,
  partnerPerMate: number,
  moodScale: number,
  campScale: number,
): number {
  const gk = session.candidate.positions.GK > 0
  const gains = activityGains(activity, gk)
  const attrs = session.candidate.attrs
  let total = 0
  for (const [attr, points] of Object.entries(gains) as [AttrKey, number][]) {
    if (!(points > 0)) continue
    const before = attrs[attr]
    const ceiling = ceilings[attr]
    if (before + 0.5 >= ceiling) continue
    const scaleRatio = attrMax(attr, gk) / MAIN_ATTR_MAX
    const raw = (authoredGain(attr, points, gk) + (partnerPerMate * teammates + expectedFacilityBonus(session, attr)) * scaleRatio) * moodScale * campScale
    const delta = caDeltaForAttr(attr, before, ceiling, raw, gk)
    if (delta > 0) total += keyAttrs.has(attr) ? delta * 1.08 : delta
  }
  return total
}

/**
 * 与玩家自动培养一致的智能控体策略：
 * 1. 最后一个时段不休息；
 * 2. 体力进入失败区间（≤ 30）立即休息；
 * 3. 下个时段是强制比赛日（周一交流赛 / 周五队内赛）且本时段训练会把体力压进失败区间时提前休息；
 * 4. 即将进入第 3 周国外特训（×3）且体力 < 75 时提前回满，避免在 3 倍时段浪费回合；
 * 5. 体力逼近失败线且「恢复」上站了 ≥ 2 名陪练、最佳训练课上无陪练时顺势恢复。
 */
function shouldAIRest(
  session: TrainingSession,
  options: TrainingActivity[],
  best: TrainingActivity | undefined,
  partners: Record<string, string[]> | undefined,
): boolean {
  const rest = options.find((item) => item.id === 'rest' && !item.noRecovery)
  if (!rest) return false
  const remaining = trainingActionsTotal(session) - session.action
  const stamina = 100 - session.fatigue
  if (!best) return session.fatigue >= 35
  if (remaining <= 1) return false
  if (failureChance(stamina) > 0) return true
  const nextAction = session.action + 2
  if (nextAction <= trainingActionsTotal(session)) {
    const nextDate = trainingDate(nextAction)
    const mandatoryMatchNext = (nextDate.day === 1 && nextDate.slot === '上午') || (nextDate.day === 5 && nextDate.slot === '上午')
    if (mandatoryMatchNext) {
      const cost = trainingFatigueCost(session, best.cost ?? 0)
      if (failureChance(stamina - cost) > 0 && stamina <= FAILURE_STAMINA + 16) return true
    }
    if (!isOverseasCampAction(session, session.action + 1) && isOverseasCampAction(session, nextAction) && stamina < 75) return true
  }
  if (stamina <= FAILURE_STAMINA + 6 && plainChance(stamina) >= 0.15 && partners) {
    if ((partners.rest?.length ?? 0) >= 2 && (partners[best.id]?.length ?? 0) === 0) return true
  }
  return false
}

function chooseActivity(session: TrainingSession, keyAttrs: ReadonlySet<AttrKey>): TrainingActivity | undefined {
  const options = trainingOptions(session)
  if (options.length <= 1) return options[0]
  const rest = options.find((item) => item.id === 'rest' && !item.noRecovery)
  const mentor = options.find((item) => item.id === 'mentor')
  const nextAction = session.action + 1
  const ceilings = effectiveTrainingCeilings(session)
  const partners = session.partnerIds?.length ? partnerAssignment(session) : undefined
  const partnerPerMate = partners ? partnerBonusPerMate(session) : 0
  const moodScale = trainingLowMood(session, nextAction) ? 0.5 : 1
  const campScale = isOverseasCampAction(session, nextAction) ? OVERSEAS_CAMP_MULTIPLIER : 1
  let best: TrainingActivity | undefined
  let bestScore = 0
  for (const activity of options) {
    if (activity.id === 'rest' || activity.id === 'mentor' || activity.id === 'position' || activity.id === 'prevention' || activity.id === 'resilience') continue
    if (activity.cost !== undefined && session.fatigue + trainingFatigueCost(session, activity.cost) > 100) continue
    const teammates = partners?.[activity.id]?.length ?? 0
    const score = scoreActivity(session, activity, keyAttrs, ceilings, teammates, partnerPerMate, moodScale, campScale)
    if (score > bestScore + 1e-9) {
      best = activity
      bestScore = score
    }
  }
  if (shouldAIRest(session, options, best, partners) && rest) return rest
  if (best) return best
  const stamina = 100 - session.fatigue
  return (failureChance(stamina) > 0 || session.fatigue >= 45) && rest ? rest : mentor ?? rest ?? options[0]
}

/** 技能槽满时挑最适合被替换的同类别技能：优先保住招牌技与高档位技能。 */
function bestReplaceableSkill(candidate: Player, incomingId: SkillId): SkillId | undefined {
  if (canLearnSkill(candidate.skills, incomingId)) return undefined
  const category = skillCategory(incomingId)
  const same = candidate.skills.filter((id) => skillCategory(id) === category)
  if (!same.length) return undefined
  const nonSig = same.filter((id) => id !== candidate.signatureSkill)
  const pool = nonSig.length ? nonSig : same
  pool.sort((a, b) => SKILL_TIER_ORDER[getSkillTier(candidate, a)] - SKILL_TIER_ORDER[getSkillTier(candidate, b)])
  return pool[0]
}

function optionScore(session: TrainingSession, option: EventOption, keyAttrs: ReadonlySet<AttrKey>): number {
  const gk = session.candidate.positions.GK > 0
  const ceilings = effectiveTrainingCeilings(session)
  const attrs = session.candidate.attrs
  const scale = eventGrowthScale(session)
  const moodScale = trainingLowMood(session, session.pendingEventAction ?? session.action) ? 0.5 : 1
  const lowStamina = 100 - session.fatigue <= FAILURE_STAMINA + 8

  const score = (effect: { attrs?: Partial<Record<AttrKey, number>>; flatAttrs?: Partial<Record<AttrKey, number>>; fatigue?: number } | undefined): number => {
    if (!effect) return 0
    let total = 0
    for (const [attr, points] of Object.entries(effect.attrs ?? {}) as [AttrKey, number][]) {
      if (!(points > 0)) continue
      const scaleRatio = attrMax(attr, gk) / MAIN_ATTR_MAX
      const raw = (authoredGain(attr, points * scale, gk) + expectedFacilityBonus(session, attr) * scaleRatio) * moodScale
      const delta = caDeltaForAttr(attr, attrs[attr], ceilings[attr], raw, gk)
      if (delta > 0) total += (keyAttrs.has(attr) ? delta * 1.08 : delta) * 1000
    }
    for (const [attr, flat] of Object.entries(effect.flatAttrs ?? {}) as [AttrKey, number][]) {
      if (!(flat > 0)) continue
      const delta = caDeltaForAttr(attr, attrs[attr], ceilings[attr], flat, gk)
      if (delta > 0) total += (keyAttrs.has(attr) ? delta * 1.08 : delta) * 1000
    }
    if (lowStamina && effect.fatigue) total -= effect.fatigue * 0.4
    return total
  }
  if (option.rainbowInherit) return 1200
  if (option.trainingSkill) {
    const choice = option.trainingSkill
    const full = !canLearnSkill(session.candidate.skills, choice.id)
    const incomingRank = choice.source === 'teammate'
      ? SKILL_TIER_ORDER[getSkillTier(choice.mentor, choice.id)]
      : choice.source === 'book'
        ? SKILL_TIER_ORDER[choice.tier]
        : 0
    const tierBonus = 1 + incomingRank * 0.25
    const raw = { book: 850, teammate: 650, basic: 500 }[choice.source] * tierBonus * trainingSkillChance(session, choice)
    if (!full) return raw
    const victim = bestReplaceableSkill(session.candidate, choice.id)
    if (!victim || victim === session.candidate.signatureSkill) return 0
    const victimRank = SKILL_TIER_ORDER[getSkillTier(session.candidate, victim)]
    // 槽位已满时，不主动拿同档或更低档技能覆盖已有技能，优先仅用更高档位的技能书/队友技能升级低档技能。
    if (choice.source === 'basic') return 1
    if (incomingRank <= victimRank) return 2
    return raw * 0.65
  }
  if (option.book) {
    const p = bookLearnChance(session.candidate, option.book)
    return p > 0 ? 500 * p : -1
  }
  if (option.branch) {
    const probability = branchProbability(session, option.branch.check, option.branch.p)
    return probability * score(option.branch.success) + (1 - probability) * score(option.branch.failure)
  }
  return score(option.effect)
}

function chooseEvent(session: TrainingSession, event: EventDef, keyAttrs: ReadonlySet<AttrKey>): EventOption {
  let best = event.options[0]
  let bestScore = -Infinity
  for (const option of event.options) {
    const score = optionScore(session, option, keyAttrs)
    if (score > bestScore + 1e-9) {
      best = option
      bestScore = score
    }
  }
  return best
}

/**
 * 用玩家同一套培养规则跑完一整轮（当季时段 + 6 名正常陪练 + 俱乐部技能书 + 事件 + 周一交流赛技能学习）：
 * - 选课按实际有效 CA 净增排序（避开已满上限属性、兼顾隐藏属性与招牌偏好、计入陪练站位与国外特训 ×3）；
 * - 控体与玩家自动策略一致（失败区间、比赛日前、国外特训周前、高陪练恢复）；
 * - 最终仍受球员自身上限与俱乐部杯赛上限约束。
 */
export function simulateAITrainingSession(
  base: Player,
  seed: number,
  economy: FacilityStages,
  seasonIndex = 1,
  cupCeilingBonus = 0,
  teammates?: readonly Player[],
  clubBooks?: readonly LegendBook[],
): TrainingSession {
  const cleanBase = untrainedPlayer(base)
  const books = pickAITrainingBooks(cleanBase, clubBooks, seasonIndex, seed)
  const session = createTrainingSession(cleanBase, seed, {
    stadium: economy.stadium,
    academy: economy.academy,
    medical: economy.medical,
    shop: economy.shop,
    sponsor: economy.sponsor,
    psychology: economy.psychology,
    tactics: economy.tactics,
  }, 1, books.length ? books : undefined, trainingActionsForSeason(seasonIndex))
  session.cupCeilingBonus = Math.max(0, cupCeilingBonus)
  const partnerIds = pickAIPartners(cleanBase, teammates, seed)
  if (partnerIds.length) session.partnerIds = partnerIds
  const keyAttrs = new Set<AttrKey>(keyAttrsOf(cleanBase))
  const skillTeammates = teammates?.filter((player) => player.id !== base.id && player.skills.length > 0)
  const actionOptions = skillTeammates?.length ? { skillTeammates } : undefined
  for (let step = 0; step < 200 && !session.completed; step++) {
    if (session.pendingEventId) {
      const event = eventForSession(session, session.pendingEventId)
      if (!event) break
      const option = chooseEvent(session, event, keyAttrs)
      const choice = option.trainingSkill
      const replace = choice ? bestReplaceableSkill(session.candidate, choice.id) : undefined
      const result = resolveTrainingEvent(session, option.id, replace)
      if (!result.ok) break
      continue
    }
    if (session.action >= trainingActionsTotal(session)) break
    const activity = chooseActivity(session, keyAttrs)
    if (!activity) break
    const request = { kind: 'activity' as const, activityId: activity.id }
    const teammateCount = partnersAt(session, request)
    const result = performTrainingAction(session, request, undefined, teammateCount, actionOptions)
    if (!result.ok) break
  }
  return session
}

export function simulateAITrainingRound(
  base: Player,
  seed: number,
  economy: FacilityStages,
  seasonIndex = 1,
  cupCeilingBonus = 0,
  teammates?: readonly Player[],
  clubBooks?: readonly LegendBook[],
): Player {
  return simulateAITrainingSession(base, seed, economy, seasonIndex, cupCeilingBonus, teammates, clubBooks).candidate
}

export function aiTrainingGain(base: Player, trained: Player): number {
  return caOf(trained.attrs, trained.positions.GK > 0) - caOf(base.attrs, base.positions.GK > 0)
}
