import type { AIClubState, AttrKey, EventDef, EventOption, Player, TrainingSession } from './types.ts'
import { branchProbability, createTrainingSession, failureChance, performTrainingAction, resolveTrainingEvent, trainingActionsForSeason, trainingActionsTotal, trainingFatigueCost } from './training.ts'
import { trainingOptions, type TrainingActivity } from './training-calendar.ts'
import { eventById } from './data/events.ts'
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

function optionScore(session: TrainingSession, option: EventOption, weights: Map<AttrKey, number>): number {
  const score = (effect: { attrs?: Partial<Record<AttrKey, number>> } | undefined): number => {
    let total = 0
    for (const [attr, gain] of Object.entries(effect?.attrs ?? {}) as [AttrKey, number][]) {
      if (gain > 0) total += gain * (weights.get(attr) ?? 0)
    }
    return total
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
 * 用玩家同一套培养规则跑完一整轮（30 个时段 + 事件），返回完成的培养会话。
 * AI 没有陪练/导师，选项目按“招牌属性优先、其余主属性兜底”的自动策略，
 * 事件按期望成长选；体力进入失败率区间时自动休息。最终仍受球员自己的 PA 上限约束。
 */
export function simulateAITrainingSession(base: Player, seed: number, economy: FacilityStages, seasonIndex = 1): TrainingSession {
  const session = createTrainingSession(untrainedPlayer(base), seed, {
    stadium: economy.stadium,
    academy: economy.academy,
    medical: economy.medical,
    shop: economy.shop,
    sponsor: economy.sponsor,
    psychology: economy.psychology,
    tactics: economy.tactics,
  }, 1, undefined, trainingActionsForSeason(seasonIndex))
  const weights = weightsFor(base)
  for (let step = 0; step < 200 && !session.completed; step++) {
    if (session.pendingEventId) {
      const event = eventById(session.pendingEventId)
      if (!event) break
      const result = resolveTrainingEvent(session, chooseEvent(session, event, weights).id)
      if (!result.ok) break
      continue
    }
    if (session.action >= trainingActionsTotal(session)) break
    const activity = chooseActivity(session, weights)
    if (!activity) break
    const result = performTrainingAction(session, { kind: 'activity', activityId: activity.id })
    if (!result.ok) break
  }
  return session
}

export function simulateAITrainingRound(base: Player, seed: number, economy: FacilityStages, seasonIndex = 1): Player {
  return simulateAITrainingSession(base, seed, economy, seasonIndex).candidate
}

export function aiTrainingGain(base: Player, trained: Player): number {
  return caOf(trained.attrs, trained.positions.GK > 0) - caOf(base.attrs, base.positions.GK > 0)
}
