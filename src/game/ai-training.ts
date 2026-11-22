import type { AIClubState, AttrKey, EventDef, EventOption, Player, SkillId, SkillTier, TrainingSession } from './types.ts'
import { branchProbability, createTrainingSession, failureChance, performTrainingAction, resolveTrainingEvent, trainingActionsForSeason, trainingActionsTotal, trainingFatigueCost } from './training.ts'
import { trainingOptions, type TrainingActivity } from './training-calendar.ts'
import { eventForSession, trainingSkillChance } from './legend-learning.ts'
import { getSkillTier } from './inheritance.ts'
import { canLearnSkill, skillCategory } from './data/skills.ts'
import { keyAttrsOf } from './data/key-attrs.ts'
import { mainAttrsFor } from './scale.ts'
import { untrainedPlayer } from './cards.ts'
import { caOf } from './ca.ts'

type FacilityStages = Pick<AIClubState['economy'], 'stadium' | 'academy' | 'medical' | 'shop' | 'sponsor' | 'psychology' | 'tactics'>

function weightsFor(player: Player): Map<AttrKey, number> {
  const gk = player.positions.GK > 0
  const order = [...keyAttrsOf(player)]
  for (const attr of mainAttrsFor(gk)) if (!order.includes(attr)) order.push(attr)
  // 和玩家默认自动策略一致：招牌属性在前，权重按优先级递减。
  return new Map(order.map((attr, index) => [attr, order.length - index]))
}

function activityGains(activity: TrainingActivity, gk: boolean): Partial<Record<AttrKey, number>> {
  return (gk ? activity.goalkeeperGains ?? activity.gains : activity.gains) ?? {}
}

function chooseActivity(session: TrainingSession, weights: Map<AttrKey, number>): TrainingActivity | undefined {
  const options = trainingOptions(session)
  const rest = options.find((item) => item.id === 'rest' && !item.noRecovery)
  const mentor = options.find((item) => item.id === 'mentor')
  const remaining = trainingActionsTotal(session) - session.action
  const stamina = 100 - session.fatigue
  if (remaining > 1 && failureChance(stamina) > 0 && rest) return rest
  const gk = session.candidate.positions.GK > 0
  let best: TrainingActivity | undefined
  let bestScore = 0
  for (const activity of options) {
    if (activity.cost !== undefined && session.fatigue + trainingFatigueCost(session, activity.cost) > 100) continue
    const gains = activityGains(activity, gk)
    let score = 0
    for (const [attr, gain] of Object.entries(gains) as [AttrKey, number][]) {
      if (gain > 0) score += gain * (weights.get(attr) ?? 0)
    }
    if (score > bestScore + 1e-9) {
      best = activity
      bestScore = score
    }
  }
  if (best) return best
  return (failureChance(stamina) > 0 || session.fatigue >= 45) && rest ? rest : mentor ?? rest ?? options[0]
}

const SKILL_TIER_ORDER: Record<SkillTier, number> = { silver: 0, gold: 1, rainbow: 2 }

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

function optionScore(session: TrainingSession, option: EventOption, weights: Map<AttrKey, number>): number {
  const score = (effect: { attrs?: Partial<Record<AttrKey, number>>; flatAttrs?: Partial<Record<AttrKey, number>> } | undefined): number => {
    let total = 0
    for (const [attr, gain] of Object.entries(effect?.attrs ?? {}) as [AttrKey, number][]) {
      if (gain > 0) total += gain * (weights.get(attr) ?? 0)
    }
    for (const [attr, gain] of Object.entries(effect?.flatAttrs ?? {}) as [AttrKey, number][]) {
      if (gain > 0) total += gain * (weights.get(attr) ?? 0)
    }
    return total
  }
  if (option.trainingSkill) {
    const choice = option.trainingSkill
    const full = !canLearnSkill(session.candidate.skills, choice.id)
    const tierBonus = choice.source === 'teammate'
      ? 1 + SKILL_TIER_ORDER[getSkillTier(choice.mentor, choice.id)] * 0.25
      : 1
    const raw = { book: 850, teammate: 650, basic: 500 }[choice.source] * tierBonus * trainingSkillChance(session, choice)
    if (!full) return raw
    const victim = bestReplaceableSkill(session.candidate, choice.id)
    if (!victim || victim === session.candidate.signatureSkill) return 0
    const victimRank = SKILL_TIER_ORDER[getSkillTier(session.candidate, victim)]
    // 槽位已满时，不主动拿基础银技覆盖已有技能，优先仅用有更高档位潜力的队友/技能书替换低档位技能。
    if (choice.source === 'basic') return 1
    if (choice.source === 'teammate' && SKILL_TIER_ORDER[getSkillTier(choice.mentor, choice.id)] <= victimRank) return 2
    return raw * 0.6
  }
  if (option.branch) {
    const probability = branchProbability(session, option.branch.check, option.branch.p)
    return probability * score(option.branch.success) + (1 - probability) * score(option.branch.failure)
  }
  return score(option.effect)
}

function chooseEvent(session: TrainingSession, event: EventDef, weights: Map<AttrKey, number>): EventOption {
  let best = event.options[0]
  let bestScore = -1
  for (const option of event.options) {
    const score = optionScore(session, option, weights)
    if (score > bestScore + 1e-9) {
      best = option
      bestScore = score
    }
  }
  return best
}

/**
 * 用玩家同一套培养规则跑完一整轮（当季时段 + 事件 + 周一交流赛技能学习），返回完成的培养会话。
 * AI 选项目按“招牌属性优先、其余主属性兜底”的自动策略，事件按期望成长选，周一交流赛支持同队队友技能传承；
 * 体力进入失败率区间时自动休息。最终仍受球员自己的 PA 上限约束。
 */
export function simulateAITrainingSession(
  base: Player,
  seed: number,
  economy: FacilityStages,
  seasonIndex = 1,
  cupCeilingBonus = 0,
  teammates?: readonly Player[],
): TrainingSession {
  const session = createTrainingSession(untrainedPlayer(base), seed, {
    stadium: economy.stadium,
    academy: economy.academy,
    medical: economy.medical,
    shop: economy.shop,
    sponsor: economy.sponsor,
    psychology: economy.psychology,
    tactics: economy.tactics,
  }, 1, undefined, trainingActionsForSeason(seasonIndex))
  session.cupCeilingBonus = Math.max(0, cupCeilingBonus)
  const weights = weightsFor(base)
  const skillTeammates = teammates?.filter((player) => player.id !== base.id && player.skills.length > 0)
  const actionOptions = skillTeammates?.length ? { skillTeammates } : undefined
  for (let step = 0; step < 200 && !session.completed; step++) {
    if (session.pendingEventId) {
      const event = eventForSession(session, session.pendingEventId)
      if (!event) break
      const option = chooseEvent(session, event, weights)
      const choice = option.trainingSkill
      const replace = choice ? bestReplaceableSkill(session.candidate, choice.id) : undefined
      const result = resolveTrainingEvent(session, option.id, replace)
      if (!result.ok) break
      continue
    }
    if (session.action >= trainingActionsTotal(session)) break
    const activity = chooseActivity(session, weights)
    if (!activity) break
    const result = performTrainingAction(session, { kind: 'activity', activityId: activity.id }, undefined, 0, actionOptions)
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
): Player {
  return simulateAITrainingSession(base, seed, economy, seasonIndex, cupCeilingBonus, teammates).candidate
}

export function aiTrainingGain(base: Player, trained: Player): number {
  return caOf(trained.attrs, trained.positions.GK > 0) - caOf(base.attrs, base.positions.GK > 0)
}
