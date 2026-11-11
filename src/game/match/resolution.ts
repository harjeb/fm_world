import { STAR_TRAITS } from '../data/star-traits.generated.ts'
import type { PassScope, ShotScope } from '../data/star-traits.ts'
import { ROLES } from '../data/roles.ts'
import type { GoalDetail, ShotChanceDetail, SkillId } from '../types.ts'
import { injuryProneness, injuryRecoveryDays, injuryRisk } from '../injury.ts'
import type { PCG32 } from '../rng.ts'
import { chooseShotFoot, chooseShotTarget, isWeakShotFoot } from './shooting.ts'
import { GOAL_WIDTH, GOAL_Y, PITCH_LENGTH, PITCH_WIDTH, skillTierMultiplier } from './team.ts'
import { legendMultiplier } from '../legend-bonus.ts'
import { clamp, dirOf, distance, distanceToSegment, goalXOf, inBox, logit, ownGoalXOf, progressOf, sigmoid, weakFoot, wideZone } from './pitch.ts'
import type { MatchRatings } from './ratings.ts'
import type { MatchPlayerState, MatchSide, MatchTeamState } from './types.ts'

/**
 * 结算内核：球场上每个“接触点”的成败概率与解释（传球、过人、射门、争顶、犯规、牌、伤病）。
 *
 * 从 MatchEngine 的私有方法原样搬出来（docs/pes2d-migration-plan.md 阶段 1），目的是让旧引擎和新的
 * 物理引擎共用同一套属性公式。约定：
 *   - 这里只算“概率 + 解释”，掷骰、改状态、写日志留给调用方；
 *   - 属性评分从 `ratings` 读，技能触发统计和旧存档规则从 `hooks` 读，内核自己不持有比赛状态；
 *   - 旧引擎同种子的结果必须和搬出前逐位一致（npm run pes:equiv 守着）。
 */

export type PassType = 'short' | 'long' | 'through' | 'cross'

/** 至少多远的传球算长传。 */
export const LONG_PASS_METERS = 25

/** 逼抢档位对应的强度系数（犯规倾向、逼抢跑动都用）。 */
export const PRESS_LEVEL = { low: 0, mid: 1, high: 2 } as const

/** 任意球离球门多远以内直接射门；再远一点就传中到禁区，更远的只是短传开出。 */
export const FREE_KICK_SHOT_RANGE = 35
export const FREE_KICK_DELIVERY_RANGE = 50

/**
 * 战术犯规：只是拉人、绊人，比盘带对抗里的犯规轻。
 * 离球门越近越愿意动手，也越容易吃牌。50 米外的犯规只是打断节奏，任意球短传开出。
 */
export const TACTICAL_FOUL_ZONES = [
  { within: FREE_KICK_SHOT_RANGE, chance: 0.14, yellow: 0.15 },
  { within: FREE_KICK_DELIVERY_RANGE, chance: 0.1, yellow: 0.12 },
  { within: Infinity, chance: 0.025, yellow: 0.08 },
]
export const TACTICAL_FOUL_RED = 0.001

/** 一次抽签的参与者：权重越大越容易赢。 */
export type Contestant = { player: MatchPlayerState; weight: number }
export type AerialContestant = Contestant & { side: MatchSide }

/** 抽签：roll 在 [0, 总权重) 里；落在谁的区间谁赢，浮点误差落到末尾时算最后一个。 */
export function pickByWeight<T extends { weight: number }>(items: T[], roll: number): T {
  let winner = items[items.length - 1]
  let acc = 0
  for (const item of items) {
    acc += item.weight
    if (roll <= acc) {
      winner = item
      break
    }
  }
  return winner
}

export function totalWeight(items: { weight: number }[]): number {
  return items.reduce((sum, item) => sum + item.weight, 0)
}

export type PassModel = {
  p: number
  a: number
  d: number
  c: number
  p0: number
  interceptor: MatchPlayerState | null
  support: number
  weakFoot: boolean
}

export type ShotModel = {
  block: number
  onTarget: number
  goalGivenOnTarget: number
  pGoal: number
  finishScore: number
  gkScore: number
  distance: number
  chance: ShotChanceDetail
}

/** 内核对评分的依赖：有效属性和特性触发条件。MatchRatings 满足它。 */
export type KernelRatings = Pick<MatchRatings, 'eff' | 'traitConditionMet'> & Partial<Pick<MatchRatings, 'pairChemistry'>>

/** 内核对调用方的依赖：技能触发统计（只在 markSkills 为真时调用）和旧存档规则开关。 */
export interface KernelHooks {
  markSkill(player: MatchPlayerState, skillId: SkillId, condition: boolean, applied: boolean): void
  /** rulesVersion < 2 的旧存档；新引擎恒为 false。 */
  readonly legacyRules: boolean
}

export class SettlementKernel {
  constructor(
    private readonly ratings: KernelRatings,
    private readonly hooks: KernelHooks,
  ) {}

  shotScopeMatches(scope: ShotScope, chance: ShotChanceDetail, inBoxShot: boolean, opts: { header: boolean; penalty: boolean; freeKick: boolean }): boolean {
    switch (scope) {
      case 'any': return true
      // 射门路线上没有防守球员，只剩门将。clear_chance 每场只有零点几次，这样才碰得到。
      case 'oneOnOne': return !opts.header && !opts.penalty && !opts.freeKick && chance.blockers === 0
      case 'inBox': return inBoxShot && !opts.penalty
      case 'longRange': return !inBoxShot && !opts.penalty && !opts.freeKick
      case 'header': return opts.header
      case 'freeKick': return opts.freeKick
      case 'penalty': return opts.penalty
    }
  }

  /** 传球成功率的修正：传球人的特性加，主要拦截人的特性减。 */
  passTraitDelta(carrier: MatchPlayerState, interceptor: MatchPlayerState | null, type: PassType | undefined, pressure: number, dist = 0, freeKick = false): number {
    let delta = 0
    const passer = STAR_TRAITS[carrier.traitId]
    if (passer?.kind === 'pass' && this.passScopeMatches(passer.scope, carrier, type, pressure, dist, freeKick) && this.ratings.traitConditionMet(carrier, passer.when)) delta += passer.success / 100
    const defender = interceptor ? STAR_TRAITS[interceptor.traitId] : undefined
    if (interceptor && defender?.kind === 'defend' && this.ratings.traitConditionMet(interceptor, defender.when)) delta -= defender.success / 100
    return delta
  }

  passScopeMatches(scope: PassScope, carrier: MatchPlayerState, type: PassType | undefined, pressure: number, dist: number, freeKick: boolean): boolean {
    if (scope === 'any') return true
    if (scope === 'pressured') return pressure > 2.5
    if (scope === 'freeKick') return freeKick
    // 真正的传中和长传每场才一两次，所以边路的传球、够远的传球都算。
    if (scope === 'cross') return type === 'cross' || wideZone(carrier)
    if (scope === 'long') return type === 'long' || dist >= LONG_PASS_METERS
    return scope === type
  }

  passModel(
    carrier: MatchPlayerState,
    receiver: MatchPlayerState,
    type: PassType | undefined,
    opp: MatchTeamState,
    from: { x: number; y: number },
    to: { x: number; y: number },
    markSkills: boolean,
  ): PassModel {
    const weak = weakFoot(carrier)
    const pressureDist = this.nearestOpponent(opp, carrier)
    const pressure = pressureDist ? Math.max(0, 9 - distance(pressureDist, carrier)) : 0
    const dist = distance(from, to)
    const interceptors = this.findLineInterceptors(opp, from, to)
    const main = interceptors[0]?.player ?? null
    let a = 0.7 * this.ratings.eff(carrier, 'passing', { passing: true, crossing: type === 'cross' }) + 0.2 * this.ratings.eff(carrier, 'composure') + 0.1 * this.ratings.eff(receiver, 'firstTouch', { finalThird: progressOf(carrier.side, receiver.x) > 0.65 })
    const support = interceptors.slice(1, 2).reduce((sum, item) => sum + Math.min(6, Math.max(0, item.score) * 0.1), 0)
    let d = main ? 0.75 * this.ratings.eff(main, 'tackling') + 0.25 * this.ratings.eff(main, 'agility') + Math.min(12, support) : 0
    if (main?.skills.includes('sweeper')) {
      d += 4 * skillTierMultiplier(main, 'sweeper')
      if (markSkills) this.hooks.markSkill(main, 'sweeper', true, true)
    }
    let c = -Math.max(0, dist - 12) * 0.35
    const cooperation = this.ratings.pairChemistry?.(carrier, receiver) ?? 0
    c += 4 * clamp(cooperation, 0, 100) / 100 * (type === 'long' ? 0.5 : type === 'cross' ? 0.8 : 1)
    const nearestToReceiver = this.nearestOpponent(opp, receiver)
    c += nearestToReceiver ? Math.min(5, distance(nearestToReceiver, receiver) * 0.25) : 3
    c -= pressure * 0.8
    if (weak) c -= 4
    if (type === 'cross') c += 2
    if (type === 'through') c -= 2
    if (type === 'long') c -= 2
    let p0 = type === 'short' ? 0.86 : type === 'long' ? 0.74 : type === 'through' ? 0.6 : 0.64
    if (carrier.skills.includes('safe_pass') && type === 'short' && pressure > 2.5) {
      a += 4 * skillTierMultiplier(carrier, 'safe_pass')
      if (markSkills) this.hooks.markSkill(carrier, 'safe_pass', true, true)
    } else if (carrier.skills.includes('safe_pass') && type === 'short') {
      if (markSkills) this.hooks.markSkill(carrier, 'safe_pass', false, false)
    }
    if (carrier.skills.includes('through_ball') && type === 'through') {
      const ahead = opp.players.filter((player) => player.onPitch && (receiver.x - player.x) * dirOf(carrier.side) > -2)
      if (ahead.length > 0) {
        a += 5 * skillTierMultiplier(carrier, 'through_ball')
        if (markSkills) this.hooks.markSkill(carrier, 'through_ball', true, true)
      } else if (markSkills) this.hooks.markSkill(carrier, 'through_ball', false, false)
    }
    if (carrier.skills.includes('weak_foot') && weak) {
      c += 3 * skillTierMultiplier(carrier, 'weak_foot')
      if (markSkills) this.hooks.markSkill(carrier, 'weak_foot', true, true)
    } else if (carrier.skills.includes('weak_foot')) {
      if (markSkills) this.hooks.markSkill(carrier, 'weak_foot', false, false)
    }
    if (!this.hooks.legacyRules) {
      if (carrier.skills.includes('lg_pass_vision') && type === 'through') {
        const m = legendMultiplier(carrier, 'lg_pass_vision')
        p0 += 0.02 * m
        a += 6 * m
        if (markSkills) this.hooks.markSkill(carrier, 'lg_pass_vision', true, true)
      }
      if (carrier.skills.includes('lg_trivela') && type === 'cross') {
        const m = legendMultiplier(carrier, 'lg_trivela')
        a += 4 * m
        c += 2 * m
        if (markSkills) this.hooks.markSkill(carrier, 'lg_trivela', true, true)
      }
      if (carrier.position === 'GK' && carrier.skills.includes('lg_quick_throw')) {
        const m = legendMultiplier(carrier, 'lg_quick_throw')
        a += 6 * m
        if (markSkills) this.hooks.markSkill(carrier, 'lg_quick_throw', true, true)
      }
    }
    const p = clamp(sigmoid(logit(p0) + (a - d + c) / 30) + this.passTraitDelta(carrier, main, type, pressure, dist), 0.05, 0.97)
    return { p, a, d, c, p0, interceptor: main, support, weakFoot: weak }
  }

  findLineInterceptors(opp: MatchTeamState, from: { x: number; y: number }, to: { x: number; y: number }): { player: MatchPlayerState; score: number; dist: number }[] {
    const list: { player: MatchPlayerState; score: number; dist: number }[] = []
    for (const player of opp.players) {
      if (!player.onPitch) continue
      const dist = distanceToSegment(player, from, to)
      const reach = 2.1 + this.ratings.eff(player, 'anticipation') * 0.028 + (player.position === 'GK' ? 0.8 : 0)
      if (dist <= reach) {
        const score = 0.4 * this.ratings.eff(player, 'anticipation') + 0.3 * this.ratings.eff(player, 'defPos') + 0.3 * this.ratings.eff(player, 'agility') - dist * 6
        list.push({ player, score, dist })
      }
    }
    list.sort((a, b) => b.score - a.score)
    return list
  }

  nearestOpponent(opp: MatchTeamState, point: { x: number; y: number }): MatchPlayerState | null {
    let best: MatchPlayerState | null = null
    let bestDist = Infinity
    for (const player of opp.players) {
      if (!player.onPitch) continue
      const dist = distance(player, point)
      if (dist < bestDist) {
        bestDist = dist
        best = player
      }
    }
    return best
  }

  dribbleModel(carrier: MatchPlayerState, defender: MatchPlayerState, markSkills: boolean): { p: number; a: number; d: number } {
    const weak = weakFoot(carrier)
    const wing = wideZone(carrier)
    const pressure = distance(defender, carrier) < 5 ? 1 : 0
    let a = 0.4 * this.ratings.eff(carrier, 'dribbling') + 0.22 * this.ratings.eff(carrier, 'agility') + 0.18 * this.ratings.eff(carrier, 'strength') + 0.2 * this.ratings.eff(carrier, 'acceleration')
    if (carrier.skills.includes('wing_runner') && wing) {
      a += 5 * skillTierMultiplier(carrier, 'wing_runner')
      if (markSkills) this.hooks.markSkill(carrier, 'wing_runner', true, true)
    } else if (carrier.skills.includes('wing_runner')) {
      if (markSkills) this.hooks.markSkill(carrier, 'wing_runner', false, false)
    }
    let d = 0.6 * this.ratings.eff(defender, 'tackling') + 0.15 * this.ratings.eff(defender, 'agility') + 0.1 * this.ratings.eff(defender, 'strength') + 0.15 * this.ratings.eff(defender, 'acceleration')
    if (defender.skills.includes('sweeper')) {
      d += 3 * skillTierMultiplier(defender, 'sweeper')
      if (markSkills) this.hooks.markSkill(defender, 'sweeper', true, true)
    }
    let c = -pressure * 2 - (weak ? 3 : 0)
    if (carrier.skills.includes('weak_foot') && weak) c += 2 * skillTierMultiplier(carrier, 'weak_foot')
    if (!this.hooks.legacyRules) {
      if (carrier.skills.includes('lg_rainbow_flick') && wing) {
        const m = legendMultiplier(carrier, 'lg_rainbow_flick')
        a += 6 * m
        if (markSkills) this.hooks.markSkill(carrier, 'lg_rainbow_flick', true, true)
      }
      if (carrier.skills.includes('lg_roulette') && pressure) {
        const m = legendMultiplier(carrier, 'lg_roulette')
        a += 6 * m
        if (markSkills) this.hooks.markSkill(carrier, 'lg_roulette', true, true)
      }
      if (defender.skills.includes('lg_slide_tackle')) {
        const m = legendMultiplier(defender, 'lg_slide_tackle')
        d += 5 * m
        if (markSkills) this.hooks.markSkill(defender, 'lg_slide_tackle', true, true)
      }
    }
    if (defender.role === 'cb_stopper' || defender.role === 'cm_destroyer') c -= 1
    let traitDelta = 0
    const dribbler = STAR_TRAITS[carrier.traitId]
    if (dribbler?.kind === 'dribble' && this.ratings.traitConditionMet(carrier, dribbler.when)) traitDelta += dribbler.success / 100
    const stopper = STAR_TRAITS[defender.traitId]
    if (stopper?.kind === 'defend' && this.ratings.traitConditionMet(defender, stopper.when)) traitDelta -= stopper.success / 100
    const floor = 0.12 + (carrier.skills.includes('lg_elastico') && !this.hooks.legacyRules ? 0.08 * legendMultiplier(carrier, 'lg_elastico') : 0)
    if (carrier.skills.includes('lg_elastico') && markSkills && !this.hooks.legacyRules) this.hooks.markSkill(carrier, 'lg_elastico', true, true)
    return { p: clamp(sigmoid(logit(0.72) + (a - d + c) / 30) + traitDelta, floor, 0.95), a, d }
  }

  /** 旧活动比赛恢复路径：只用于没有 rulesVersion 的存档。 */
  legacyShotModel(
    shooter: MatchPlayerState,
    team: MatchTeamState,
    opp: MatchTeamState,
    opts: { point: { x: number; y: number }; header: boolean; penalty: boolean; freeKick: boolean; foot?: 'left' | 'right' },
    markSkills = false,
  ): ShotModel {
    const target = { x: goalXOf(shooter.side), y: GOAL_Y }
    const dist = distance(opts.point, target)
    const gk = this.teamGoalkeeper(opp)
    const inBoxShot = inBox(shooter.side, opts.point)
    const weak = !opts.header && (opts.foot ? isWeakShotFoot(shooter, opts.foot) : weakFoot(shooter))
    let finishScore = opts.header
      ? 0.55 * this.ratings.eff(shooter, 'heading', { aerial: true, inBox: true }) + 0.25 * this.ratings.eff(shooter, 'shooting', { inBox: true }) + 0.2 * this.ratings.eff(shooter, 'composure', { inBox: true })
      : 0.75 * this.ratings.eff(shooter, 'shooting', { inBox: inBoxShot }) + 0.25 * this.ratings.eff(shooter, 'composure', { inBox: inBoxShot })
    if (weak) finishScore -= clamp(11 - this.ratings.eff(shooter, 'firstTouch') * 0.07 - (shooter.skills.includes('weak_foot') ? 3 * skillTierMultiplier(shooter, 'weak_foot') : 0), 2, 10)
    const pressure = this.nearestOpponent(opp, opts.point)
    const pressurePenalty = pressure ? Math.max(0, 6 - distance(pressure, opts.point)) * 0.8 : 0
    const anglePenalty = Math.max(0, Math.abs(opts.point.y - GOAL_Y) - 12) * 0.6
    let t = 0.54 + (finishScore - 55) / 150 - Math.max(0, dist - 10) * 0.011 - anglePenalty / 100 + (opts.header ? -0.03 : 0)
    let g = 0.38 + (finishScore - 55) / 170 - Math.max(0, dist - 12) * 0.004
    if (opts.penalty) {
      t = 0.7 + (finishScore - 50) / 180
      g = 0.5 + (finishScore - 50) / 220
    }
    if (shooter.skills.includes('box_hunter') && inBoxShot) {
      t += 0.04 * skillTierMultiplier(shooter, 'box_hunter')
      g += 0.03 * skillTierMultiplier(shooter, 'box_hunter')
      if (markSkills) this.hooks.markSkill(shooter, 'box_hunter', true, true)
    } else if (shooter.skills.includes('box_hunter') && markSkills) this.hooks.markSkill(shooter, 'box_hunter', false, false)
    if (shooter.skills.includes('long_shot') && !inBoxShot) {
      t += 0.035 * skillTierMultiplier(shooter, 'long_shot')
      g += 0.02 * skillTierMultiplier(shooter, 'long_shot')
      if (markSkills) this.hooks.markSkill(shooter, 'long_shot', true, true)
    } else if (shooter.skills.includes('long_shot') && markSkills) this.hooks.markSkill(shooter, 'long_shot', false, false)
    if (shooter.skills.includes('weak_foot') && weak) {
      t += 0.02 * skillTierMultiplier(shooter, 'weak_foot')
      if (markSkills) this.hooks.markSkill(shooter, 'weak_foot', true, true)
    } else if (shooter.skills.includes('weak_foot') && markSkills) this.hooks.markSkill(shooter, 'weak_foot', false, false)
    if (opts.penalty && shooter.skills.includes('penalty_specialist')) {
      t += 0.05 * skillTierMultiplier(shooter, 'penalty_specialist')
      g += 0.04 * skillTierMultiplier(shooter, 'penalty_specialist')
      if (markSkills) this.hooks.markSkill(shooter, 'penalty_specialist', true, true)
    }
    t -= pressurePenalty / 100
    t = clamp(t, 0.12, 0.93)
    let gkScore = gk
      ? 0.6 * this.ratings.eff(gk, 'reflexes', { oneOnOne: !!pressure && distance(pressure, gk) < 10 }) + 0.25 * this.ratings.eff(gk, 'defPos') + 0.15 * this.ratings.eff(gk, 'oneOnOne', { oneOnOne: true })
      : 45
    if (gk) {
      const gkOut = distance(gk, { x: ownGoalXOf(gk.side), y: GOAL_Y }) > 10
      if (gkOut) g += 0.1
      if (opts.penalty) gkScore = 0.55 * this.ratings.eff(gk, 'oneOnOne', { oneOnOne: true, penalty: true }) + 0.3 * this.ratings.eff(gk, 'reflexes') + 0.15 * this.ratings.eff(gk, 'defPos')
      if (gk.skills.includes('gk_reflexes')) {
        gkScore += 5 * skillTierMultiplier(gk, 'gk_reflexes')
        if (markSkills) this.hooks.markSkill(gk, 'gk_reflexes', true, true)
      }
    }
    g = clamp(g - (gkScore - 55) / 200, 0.07, 0.82)
    let block = 0
    if (!opts.penalty) {
      const blockers = this.findBlockers(opp, opts.point, target, true)
      if (blockers.length > 0) block = clamp(0.015 + Math.max(0, blockers[0] - 30) * 0.008, 0.01, 0.42)
      if (opts.freeKick) block += 0.05
    }
    block = clamp(block, 0, 0.45)
    const onTarget = clamp(t, 0.05, 0.95)
    const goalGiven = clamp(g, 0.05, 0.95)
    const chance: ShotChanceDetail = { type: 'normal', label: '旧版规则', base: onTarget, floor: 0.05, ceiling: 0.95, goalBase: goalGiven, distance: dist, angle: this.goalAngle(opts.point, shooter.side), pressure: 0, blockers: 0, reason: 'legacy' }
    return { block, onTarget, goalGivenOnTarget: goalGiven, pGoal: (1 - block) * onTarget * goalGiven, finishScore, gkScore, distance: dist, chance }
  }

  shotChanceValue(type: ShotChanceDetail['type']): number {
    return { open_goal: 0.95, clear_chance: 0.82, box_open: 0.58, normal: 0.3, difficult: 0.08, penalty: 0.78, header: 0.4, free_kick: 0.15 }[type]
  }

  goalAngle(point: { x: number; y: number }, side: MatchSide): number {
    const dx = Math.max(0.2, Math.abs(goalXOf(side) - point.x))
    const top = Math.atan2(GOAL_Y - GOAL_WIDTH / 2 - point.y, dx)
    const bottom = Math.atan2(GOAL_Y + GOAL_WIDTH / 2 - point.y, dx)
    return Math.abs(bottom - top) * 180 / Math.PI
  }

  classifyShotChance(
    shooter: MatchPlayerState,
    opp: MatchTeamState,
    point: { x: number; y: number },
    opts: { header: boolean; penalty: boolean; freeKick: boolean },
  ): ShotChanceDetail {
    const target = { x: goalXOf(shooter.side), y: GOAL_Y }
    const dist = distance(point, target)
    const angle = this.goalAngle(point, shooter.side)
    const gk = this.teamGoalkeeper(opp)
    const gkOut = !gk || distance(gk, { x: ownGoalXOf(gk.side), y: GOAL_Y }) > 10
    const outfield = opp.players.filter((player) => player.onPitch && player.position !== 'GK')
    const nearest = outfield.length ? Math.min(...outfield.map((player) => distance(player, point))) : 99
    const blockers = this.findBlockers(opp, point, target).length
    const pressure = clamp((7 - nearest) / 7, 0, 1)
    const mk = (type: ShotChanceDetail['type'], label: string, base: number, floor: number, ceiling: number, goalBase: number, reason: string): ShotChanceDetail => ({
      type, label, base, floor, ceiling, goalBase, distance: dist, angle, pressure, blockers, reason,
    })
    if (opts.penalty) return mk('penalty', '点球', 0.7, 0.68, 0.95, 0.5, '点球，仅门将和主罚者')
    if (opts.freeKick) {
      // 20 米以内最好罚，越远射正和破门都越难。
      const far = Math.max(0, dist - 20)
      return mk('free_kick', '任意球', clamp(0.46 - far * 0.008, 0.3, 0.46), 0.1, 0.75, clamp(0.3 - far * 0.003, 0.24, 0.3), '直接任意球，有人墙和距离影响')
    }
    if (opts.header) return mk('header', '头球', 0.5, 0.2, 0.88, 0.36, '头球，使用头球与镇定')
    if (dist <= 8 && angle >= 35 && nearest > 8 && blockers === 0 && gkOut) {
      return mk('open_goal', '近距空门', 0.94, 0.9, 0.99, 0.82, '近距离、角度开放、门将未覆盖')
    }
    if (dist <= 16 && angle >= 24 && nearest > 6.5 && blockers === 0) {
      // 接近空门时把单刀参数连续抬高，避免 8 米边界跳变。
      const nearOpen = clamp((10 - dist) / 2, 0, 1) * clamp((nearest - 6) / 2, 0, 1) * clamp((angle - 30) / 5, 0, 1)
      return mk('clear_chance', '干净单刀', 0.85 + 0.09 * nearOpen, 0.78 + 0.12 * nearOpen, 0.97, 0.6, '距门近、角度开放、外场防守来不及干扰')
    }
    if (dist <= 18 && angle >= 18 && nearest > 4.5 && blockers === 0) {
      const nearClear = clamp((18 - dist) / 2, 0, 1) * clamp((nearest - 5) / 1.5, 0, 1) * clamp((angle - 20) / 4, 0, 1)
      return mk('box_open', '禁区空位', 0.77 + 0.08 * nearClear, 0.65 + 0.13 * nearClear, 0.95, 0.48, '禁区内空位，仍有门将')
    }
    if (dist <= 26 && angle >= 12) {
      const nearBox = clamp((20 - dist) / 2, 0, 1)
      const base = clamp(0.62 - Math.max(0, dist - 20) * 0.02 - (nearest <= 4 ? 0.06 : 0) + 0.17 * nearBox, 0.47, 0.72)
      return mk('normal', '普通射门', base, 0.35 + 0.3 * nearBox, 0.9, 0.38, nearest <= 4 ? '有贴身干扰的普通射门' : '角度尚可的普通射门')
    }
    const nearNormal = clamp((34 - dist) / 8, 0, 1)
    const base = clamp(0.6 - Math.max(0, dist - 20) * 0.023 - Math.max(0, 16 - angle) * 0.004, 0.16, 0.6)
    return mk('difficult', '困难射门', base, 0.05 + 0.3 * nearNormal, 0.75 + 0.15 * nearNormal, 0.23 + 0.15 * nearNormal, '距离远、角度小或有封堵')
  }

  shotModel(
    shooter: MatchPlayerState,
    team: MatchTeamState,
    opp: MatchTeamState,
    opts: { point: { x: number; y: number }; header: boolean; penalty: boolean; freeKick: boolean; foot?: 'left' | 'right' },
    markSkills = false,
  ): ShotModel {
    if (this.hooks.legacyRules) return this.legacyShotModel(shooter, team, opp, opts, markSkills)
    const target = { x: goalXOf(shooter.side), y: GOAL_Y }
    const dist = distance(opts.point, target)
    const gk = this.teamGoalkeeper(opp)
    const inBoxShot = inBox(shooter.side, opts.point)
    const weak = !opts.header && (opts.foot ? isWeakShotFoot(shooter, opts.foot) : weakFoot(shooter))
    const chance = this.classifyShotChance(shooter, opp, opts.point, opts)
    let finishScore = opts.header
      ? 0.55 * this.ratings.eff(shooter, 'heading', { aerial: true, inBox: true }) + 0.25 * this.ratings.eff(shooter, 'shooting', { inBox: true }) + 0.2 * this.ratings.eff(shooter, 'composure', { inBox: true })
      : 0.75 * this.ratings.eff(shooter, 'shooting', { inBox: inBoxShot }) + 0.25 * this.ratings.eff(shooter, 'composure', { inBox: inBoxShot })
    if (weak) finishScore -= clamp(11 - this.ratings.eff(shooter, 'firstTouch') * 0.07 - (shooter.skills.includes('weak_foot') ? 3 * skillTierMultiplier(shooter, 'weak_foot') : 0), 2, 10)
    const precision = opts.header
      ? 0.7 * this.ratings.eff(shooter, 'heading') + 0.3 * this.ratings.eff(shooter, 'composure')
      : 0.7 * this.ratings.eff(shooter, 'shooting') + 0.3 * this.ratings.eff(shooter, 'composure')
    const attributeAdjust = clamp((precision - 50) * 0.002, -0.1, 0.1)
    const weakAdjust = weak ? -0.02 : 0
    let onTarget = clamp(chance.base + attributeAdjust + weakAdjust, chance.floor, chance.ceiling)
    let goalGiven = chance.goalBase
    let gkScore = 45
    const noKeeper = !gk
    let keeperInPosition = false
    if (gk) {
      const gkOut = distance(gk, { x: ownGoalXOf(gk.side), y: GOAL_Y }) > 10
      keeperInPosition = !gkOut
      if (gkOut) {
        // 已失位的门将不能隔空用高属性扑救；只保留很小的回追影响。
        gkScore = 25
        goalGiven += chance.type === 'open_goal' ? 0.12 : 0.06
      } else {
        const oneOnOne = chance.type === 'clear_chance'
        gkScore = oneOnOne || opts.penalty
          ? 0.55 * this.ratings.eff(gk, 'oneOnOne', { oneOnOne: true, penalty: opts.penalty }) + 0.3 * this.ratings.eff(gk, 'reflexes') + 0.15 * this.ratings.eff(gk, 'defPos')
          : 0.65 * this.ratings.eff(gk, 'reflexes', { oneOnOne: false }) + 0.35 * this.ratings.eff(gk, 'defPos')
      }
      if (gk.skills.includes('gk_reflexes')) {
        if (!gkOut) gkScore += 5 * skillTierMultiplier(gk, 'gk_reflexes')
        if (markSkills) this.hooks.markSkill(gk, 'gk_reflexes', true, true)
      }
      if (!this.hooks.legacyRules) {
        if (gkOut && shooter.skills.includes('lg_chip') && dist > 10) {
          const m = legendMultiplier(shooter, 'lg_chip')
          goalGiven += 0.12 * m
          if (markSkills) this.hooks.markSkill(shooter, 'lg_chip', true, true)
        }
        if (gkOut && dist > 25 && shooter.skills.includes('lg_halfway_lob')) {
          const m = legendMultiplier(shooter, 'lg_halfway_lob')
          goalGiven += 0.25 * m
          if (markSkills) this.hooks.markSkill(shooter, 'lg_halfway_lob', true, true)
        }
        if (shooter.skills.includes('lg_cannon_shot')) {
          const m = legendMultiplier(shooter, 'lg_cannon_shot')
          gkScore -= 4 * m
          if (markSkills) this.hooks.markSkill(shooter, 'lg_cannon_shot', true, true)
        }
      }
    } else {
      goalGiven = 1
    }
    goalGiven = clamp(goalGiven + (finishScore - gkScore) * 0.003, 0.05, 0.95)
    if (noKeeper || chance.type === 'open_goal') goalGiven = 1
    if (shooter.skills.includes('box_hunter') && inBoxShot) {
      onTarget += 0.04 * skillTierMultiplier(shooter, 'box_hunter')
      goalGiven += 0.03 * skillTierMultiplier(shooter, 'box_hunter')
      if (markSkills) this.hooks.markSkill(shooter, 'box_hunter', true, true)
    } else if (shooter.skills.includes('box_hunter')) {
      if (markSkills) this.hooks.markSkill(shooter, 'box_hunter', false, false)
    }
    if (shooter.skills.includes('long_shot') && !inBoxShot) {
      onTarget += 0.035 * skillTierMultiplier(shooter, 'long_shot')
      goalGiven += 0.02 * skillTierMultiplier(shooter, 'long_shot')
      if (markSkills) this.hooks.markSkill(shooter, 'long_shot', true, true)
    } else if (shooter.skills.includes('long_shot')) {
      if (markSkills) this.hooks.markSkill(shooter, 'long_shot', false, false)
    }
    if (shooter.skills.includes('weak_foot') && weak) {
      onTarget += 0.02 * skillTierMultiplier(shooter, 'weak_foot')
      if (markSkills) this.hooks.markSkill(shooter, 'weak_foot', true, true)
    } else if (shooter.skills.includes('weak_foot')) {
      if (markSkills) this.hooks.markSkill(shooter, 'weak_foot', false, false)
    }
    if (opts.penalty && shooter.skills.includes('penalty_specialist')) {
      onTarget += 0.05 * skillTierMultiplier(shooter, 'penalty_specialist')
      goalGiven += 0.04 * skillTierMultiplier(shooter, 'penalty_specialist')
      if (markSkills) this.hooks.markSkill(shooter, 'penalty_specialist', true, true)
    }
    if (!this.hooks.legacyRules) {
      if (shooter.skills.includes('lg_low_drive') && inBoxShot && !opts.header && !opts.penalty) {
        const m = legendMultiplier(shooter, 'lg_low_drive')
        onTarget += 0.03 * m
        goalGiven += 0.02 * m
        if (markSkills) this.hooks.markSkill(shooter, 'lg_low_drive', true, true)
      }
      if (opts.header && shooter.skills.includes('lg_diving_header')) {
        const m = legendMultiplier(shooter, 'lg_diving_header')
        onTarget += 0.05 * m
        goalGiven += 0.03 * m
        if (markSkills) this.hooks.markSkill(shooter, 'lg_diving_header', true, true)
      }
      if (opts.header && shooter.skills.includes('lg_bicycle')) {
        const m = legendMultiplier(shooter, 'lg_bicycle')
        onTarget += 0.04 * m
        if (markSkills) this.hooks.markSkill(shooter, 'lg_bicycle', true, true)
      }
      if (weak && shooter.skills.includes('lg_rabona')) {
        const m = legendMultiplier(shooter, 'lg_rabona')
        onTarget += 0.02 * m
        if (markSkills) this.hooks.markSkill(shooter, 'lg_rabona', true, true)
      }
      if (opts.freeKick && shooter.skills.includes('lg_knuckleball')) {
        const m = legendMultiplier(shooter, 'lg_knuckleball')
        onTarget += 0.06 * m
        goalGiven += 0.04 * m
        if (markSkills) this.hooks.markSkill(shooter, 'lg_knuckleball', true, true)
      }
      if (dist >= 20 && shooter.skills.includes('lg_rising_shot')) {
        const m = legendMultiplier(shooter, 'lg_rising_shot')
        goalGiven += 0.03 * m
        if (markSkills) this.hooks.markSkill(shooter, 'lg_rising_shot', true, true)
      }
      if (inBoxShot && shooter.skills.includes('lg_volley')) {
        const m = legendMultiplier(shooter, 'lg_volley')
        onTarget += 0.05 * m
        if (markSkills) this.hooks.markSkill(shooter, 'lg_volley', true, true)
      }
      if (!inBoxShot && shooter.skills.includes('lg_super_long_shot')) {
        const m = legendMultiplier(shooter, 'lg_super_long_shot')
        onTarget += 0.02 * m
        goalGiven += 0.02 * m
        if (markSkills) this.hooks.markSkill(shooter, 'lg_super_long_shot', true, true)
      }
    }
    // 先调整普通射门的基础转化率，再叠加技能/专属特性的固定加成。
    if (!this.hooks.legacyRules && !noKeeper && (chance.type === 'normal' || chance.type === 'difficult')) goalGiven *= 0.75
    const finisher = STAR_TRAITS[shooter.traitId]
    if (finisher?.kind === 'shot' && this.shotScopeMatches(finisher.scope, chance, inBoxShot, opts) && this.ratings.traitConditionMet(shooter, finisher.when)) {
      onTarget += finisher.onTarget / 100
      goalGiven += finisher.goal / 100
    }
    // 失位的门将不能隔空扑救，特性也一样；空门本来就没有扑救。
    const keeper = gk ? STAR_TRAITS[gk.traitId] : undefined
    if (gk && keeperInPosition && chance.type !== 'open_goal' && keeper?.kind === 'save' && this.shotScopeMatches(keeper.scope, chance, inBoxShot, opts) && this.ratings.traitConditionMet(gk, keeper.when)) goalGiven -= keeper.goal / 100
    onTarget = clamp(onTarget, chance.floor, chance.ceiling)
    goalGiven = clamp(goalGiven, 0.05, noKeeper || chance.type === 'open_goal' ? 1 : 0.95)
    let block = 0
    if (!opts.penalty) {
      const blockers = this.findBlockers(opp, opts.point, target)
      if (blockers.length > 0) {
        const score = blockers[0]
        block = clamp(0.015 + Math.max(0, score - 30) * 0.008, 0.01, 0.42)
      }
      if (opts.freeKick) block += 0.05
    }
    block = clamp(block, 0, 0.45)
    const pGoal = (1 - block) * onTarget * goalGiven
    return { block, onTarget, goalGivenOnTarget: goalGiven, pGoal, finishScore, gkScore, distance: dist, chance }
  }

  findBlockers(opp: MatchTeamState, shooter: { x: number; y: number }, target: { x: number; y: number }, includeGk = false): number[] {
    const scores: number[] = []
    for (const player of opp.players) {
      if (!player.onPitch || (!includeGk && player.position === 'GK')) continue
      const dist = distanceToSegment(player, shooter, target)
      if (dist > 5.2) continue
      const between = (player.x - shooter.x) * (target.x - shooter.x) >= 0 && (player.x - shooter.x) * (target.x - shooter.x) <= (target.x - shooter.x) ** 2 + 0.1
      if (!between) continue
      scores.push(this.ratings.eff(player, 'defPos') * 0.45 + this.ratings.eff(player, 'anticipation') * 0.35 + (5.2 - dist) * 4 + (player.skills.includes('lg_goal_line_clearance') && !this.hooks.legacyRules ? 8 * legendMultiplier(player, 'lg_goal_line_clearance') : 0))
    }
    scores.sort((a, b) => b - a)
    return scores
  }

  teamGoalkeeper(team: MatchTeamState): MatchPlayerState | null {
    return team.players.find((player) => player.onPitch && player.position === 'GK') ?? null
  }

  /**
   * 传球四种结局的概率：成功 / 被拦截 / 出界 / 落在无人区。在 passModel 的基础上扣掉“落点离接球人太远”的惩罚；
   * 失败里按落点是否靠近边界分配出界概率，有拦截人时其余大部分算被拦截。概率不取整。
   * `to` 是球实际落到的位置（v3 连续引擎里是权威轨迹的落点）。
   */
  passOdds(model: PassModel, type: PassType | undefined, receiver: { x: number; y: number }, to: { x: number; y: number }): { p: number; deviation: number; intercepted: number; out: number; loose: number } {
    const deviation = type === 'cross' ? 0 : distance(receiver, to)
    const p = clamp(model.p - Math.min(0.12, Math.max(0, deviation - 4) * 0.015), 0.05, 0.97)
    const outRisk = to.y < 5 || to.y > PITCH_WIDTH - 5 || to.x < 3 || to.x > PITCH_LENGTH - 3 ? 0.24 : 0.1
    const intercepted = model.interceptor ? (1 - p) * (1 - outRisk * 0.35) : 0
    let out = (1 - p) * outRisk
    let loose = 1 - p - intercepted - out
    if (loose < 0) {
      out += loose
      loose = 0
    }
    return { p, deviation, intercepted, out, loose }
  }

  /** 传成功之后，接球人离落点多远以内还接得住（超过就变成落点争抢）。传中落点本来就在人群里，放宽。 */
  receptionReach(receiver: MatchPlayerState, type: PassType | undefined): number {
    const base = type === 'cross' ? 8 : 3.4 + this.ratings.eff(receiver, 'anticipation') * 0.02
    return base + (receiver.skills.includes('lg_anticipate') && !this.hooks.legacyRules ? 1.2 * legendMultiplier(receiver, 'lg_anticipate') : 0)
  }

  /** 前场任意球传中到禁区，球能不能传到位。 */
  freeKickDeliveryChance(taker: MatchPlayerState, point: { x: number; y: number }): number {
    const quality = 0.6 + (this.ratings.eff(taker, 'passing', { passing: true, crossing: true }) - 50) * 0.006 + (taker.skills.includes('lg_set_piece_iq') && !this.hooks.legacyRules ? 0.06 * legendMultiplier(taker, 'lg_set_piece_iq') : 0)
    return clamp(quality + this.passTraitDelta(taker, null, 'cross', 0, distance(taker, point), true), 0.3, 0.95)
  }

  /**
   * 射门的“怎么踢”：哪只脚、打哪个角、什么技术。随机数全部来自调用方给的 rng（旧引擎按 种子 + 步数 + 日志条数 派生，
   * 不动比赛主随机流）。抽取顺序固定：脚 → 角 → 技术。
   */
  planShot(
    shooter: MatchPlayerState,
    opp: MatchTeamState,
    opts: { point: { x: number; y: number }; header: boolean; penalty: boolean; target?: GoalDetail['target'] },
    rng: PCG32,
  ): { foot: 'left' | 'right' | undefined; target: GoalDetail['target']; technique: GoalDetail['technique'] } {
    const balance = (this.ratings.eff(shooter, 'firstTouch') + this.ratings.eff(shooter, 'agility')) / 2
    const foot = opts.header ? undefined : opts.penalty && shooter.foot !== 'B'
      ? shooter.foot === 'L' ? 'left' : 'right'
      : chooseShotFoot(shooter, opts.point.y, balance, rng)
    const precision = opts.header
      ? 0.7 * this.ratings.eff(shooter, 'heading') + 0.3 * this.ratings.eff(shooter, 'composure')
      : 0.7 * this.ratings.eff(shooter, 'shooting') + 0.3 * this.ratings.eff(shooter, 'composure')
    // 门将偏哪边就往另一边打，射门不再总是打在门将身上。
    const gkNow = this.teamGoalkeeper(opp)
    const target = opts.target ?? chooseShotTarget(precision, rng, gkNow ? gkNow.y - GOAL_Y : 0)
    const technique: GoalDetail['technique'] = opts.header ? 'header' : rng.chance(clamp(0.5 + (this.ratings.eff(shooter, 'strength') - this.ratings.eff(shooter, 'composure')) / 160, 0.2, 0.8)) ? 'power' : 'placed'
    return { foot, target, technique }
  }

  /**
   * 射门四种结局的概率：封堵 / 偏出 / 被扑 / 进球。在 shotModel 的基础上，再按“打哪个角、什么技术”微调射正率和门将得手率。
   * 概率不取整；日志里的取整由调用方做。
   */
  shotOdds(model: ShotModel, target: GoalDetail['target'], technique: GoalDetail['technique']): { onTarget: number; goalGiven: number; raw: { block: number; off: number; save: number; goal: number } } {
    const corner = target.endsWith('left') || target.endsWith('right')
    const onTarget = clamp(model.onTarget + (corner ? -0.035 : 0.02) + (technique === 'power' ? -0.015 : technique === 'placed' ? 0.015 : 0), model.chance.floor, model.chance.ceiling)
    const goalCap = model.chance.type === 'open_goal' || model.goalGivenOnTarget >= 1 ? 1 : 0.95
    const goalGiven = clamp(model.goalGivenOnTarget + (corner ? 0.02 : -0.02) + (technique === 'power' ? 0.025 : technique === 'placed' ? -0.015 : 0), 0.05, goalCap)
    const raw = {
      block: model.block,
      off: (1 - model.block) * (1 - onTarget),
      save: (1 - model.block) * onTarget * (1 - goalGiven),
      goal: (1 - model.block) * onTarget * goalGiven,
    }
    return { onTarget, goalGiven, raw }
  }

  /** 一次射门从选脚、选角到结局概率的完整结算（planShot + shotModel + shotOdds）。 */
  shotSettlement(
    shooter: MatchPlayerState,
    team: MatchTeamState,
    opp: MatchTeamState,
    opts: { point: { x: number; y: number }; header: boolean; penalty: boolean; freeKick: boolean; target?: GoalDetail['target'] },
    rng: PCG32,
  ): { foot: 'left' | 'right' | undefined; target: GoalDetail['target']; technique: GoalDetail['technique']; model: ShotModel; onTarget: number; goalGiven: number; raw: { block: number; off: number; save: number; goal: number } } {
    const plan = this.planShot(shooter, opp, opts, rng)
    const model = this.shotModel(shooter, team, opp, { ...opts, foot: plan.foot }, true)
    return { ...plan, model, ...this.shotOdds(model, plan.target, plan.technique) }
  }

  /** 门将把射门抱住（而不是扑出）的概率。 */
  keeperCatchChance(gk: MatchPlayerState, shooter: MatchPlayerState): number {
    return clamp(0.35 + (this.ratings.eff(gk, 'handling') - this.ratings.eff(shooter, 'shooting')) / 150, 0.12, 0.88)
  }

  /** 防守者动手的倾向（盘带犯规和战术犯规共用）：逼抢越凶、角色越爱逼抢越高。新战术指令下保持基准中性，不借上抢频率隐性抬高犯规率。 */
  foulShare(defender: MatchPlayerState, opp: MatchTeamState): number {
    const pressLevel = opp.instructions ? PRESS_LEVEL.mid : PRESS_LEVEL[opp.tactics.press]
    return clamp(0.16 + ROLES[defender.role].pressBias * 0.05 + pressLevel * 0.02, 0.1, 0.35)
  }

  /**
   * 过人对抗的四种结局：成功 / 被干净断下 / 被犯规 / 球滚向一旁。success 就是 dribbleModel 给的 p；
   * 其余按“失败里有多少是犯规”分配。概率不取整。
   */
  dribbleOdds(model: { p: number }, defender: MatchPlayerState, opp: MatchTeamState): { success: number; tackle: number; foul: number; loose: number } {
    const foulShare = this.foulShare(defender, opp)
    const tackleShare = (1 - model.p) * (1 - foulShare) * 0.72
    const looseShare = Math.max(0, 1 - model.p - tackleShare - (1 - model.p) * foulShare)
    const foulP = (1 - model.p) * foulShare
    return { success: model.p, tackle: tackleShare, foul: foulP, loose: looseShare }
  }

  /**
   * 被贴身防守时，防守球员可能直接犯规：宁可送一个任意球，也不让对手舒服地射门或直塞。
   * 禁区内不敢动手，门将既不会冲出来拉人，也不会被拉。返回 null 表示这个情境不会发生战术犯规；
   * 否则给出犯规概率和这次犯规的黄牌、红牌概率，是否真的犯规由调用方抽签。
   */
  tacticalFoulOdds(carrier: MatchPlayerState, opp: MatchTeamState): { defender: MatchPlayerState; chance: number; yellow: number; red: number } | null {
    if (carrier.position === 'GK' || inBox(carrier.side, carrier)) return null
    const goalDistance = distance(carrier, { x: goalXOf(carrier.side), y: GOAL_Y })
    const defender = this.nearestOpponent(opp, carrier)
    if (!defender || defender.position === 'GK' || distance(defender, carrier) > 5) return null
    const zone = TACTICAL_FOUL_ZONES.find((item) => goalDistance < item.within)!
    // 和盘带犯规用同一套逼抢倾向；中等逼抢、普通角色是 1 倍。
    const aggression = this.foulShare(defender, opp) / 0.18
    // 抢断越好越不用动手：评分 50 是 1 倍，90 是 0.8 倍。
    const discipline = 1.25 - this.ratings.eff(defender, 'tackling') / 200
    const magnet = STAR_TRAITS[carrier.traitId]
    const drawn = magnet?.kind === 'drawFoul' && this.ratings.traitConditionMet(carrier, magnet.when) ? 1 + magnet.pct / 100 : 1
    // 回合变多后，按每次接触略降低战术犯规率，保持整场犯规/牌数稳定。
    const chance = zone.chance * aggression * discipline * drawn * 0.88
    return { defender, chance, yellow: zone.yellow, red: TACTICAL_FOUL_RED }
  }

  /**
   * 一次犯规之后出牌的概率：直接红牌 / 黄牌（黄牌只在没有直红时抽）。球星特性可以降低。
   * 触球次数增多不能同步增加每场直红数量；旧比赛保持原规则。
   */
  cardOdds(player: MatchPlayerState, yellowChance = this.hooks.legacyRules ? 0.17 : 0.13, redChance = 0.012): { straightRed: number; yellow: number } {
    const cardTrait = STAR_TRAITS[player.traitId]
    const cardScale = cardTrait?.kind === 'card' ? 1 - cardTrait.risk / 100 : 1
    return {
      straightRed: redChance * cardScale * (this.hooks.legacyRules ? 1 : 0.25),
      yellow: yellowChance * cardScale * (this.hooks.legacyRules ? 1 : 0.8),
    }
  }

  /** 一次身体接触后这名球员受伤的概率（体能、伤病体质、技能、球星特性）。同一个人的所有球员卡共享 personId。 */
  injuryOdds(player: MatchPlayerState): { personId: string; risk: number } {
    const personId = player.personId ?? player.sourceId
    const prone = injuryProneness(personId)
    const fatigue = clamp(1 - player.stamina / Math.max(1, player.maxStamina), 0, 1)
    const baseRisk = injuryRisk(prone, fatigue, false)
    const injuryTrait = STAR_TRAITS[player.traitId]
    const risk = (player.skills.includes('injury_prevention')
      ? baseRisk - (baseRisk - injuryRisk(prone, fatigue, true)) * skillTierMultiplier(player, 'injury_prevention')
      : baseRisk) * (injuryTrait?.kind === 'injury' ? 1 - injuryTrait.risk / 100 : 1)
    return { personId, risk }
  }

  recoveryDays(rng: Parameters<typeof injuryRecoveryDays>[0], player: MatchPlayerState): number {
    const days = injuryRecoveryDays(rng, false)
    if (!player.skills.includes('injury_resilience')) return days
    const silverDays = Math.max(1, Math.ceil(days * 0.7))
    return Math.max(1, Math.ceil(days - (days - silverDays) * skillTierMultiplier(player, 'injury_resilience')))
  }

  /** 点球大战的主罚顺序：场上外场球员按 射术 + 镇定 从高到低。 */
  shootoutOrder(team: MatchTeamState): MatchPlayerState[] {
    return team.players.filter((player) => player.onPitch && player.position !== 'GK')
      .sort((a, b) => (this.ratings.eff(b, 'shooting') + this.ratings.eff(b, 'composure')) - (this.ratings.eff(a, 'shooting') + this.ratings.eff(a, 'composure')))
  }

  /**
   * 点球大战里一脚点球的命中率。点球大战只有一个命中率，所以射正和进球的加成合在一起算；
   * 条件照常判定，“主场”特性客场不生效。
   */
  shootoutKickOdds(taker: MatchPlayerState, gk: MatchPlayerState | null): number {
    const takerScore = this.ratings.eff(taker, 'shooting') * 0.6 + this.ratings.eff(taker, 'composure') * 0.4
    const gkScore = gk ? this.ratings.eff(gk, 'reflexes') * 0.6 + this.ratings.eff(gk, 'oneOnOne') * 0.4 + (gk.skills.includes('gk_reflexes') ? 5 * skillTierMultiplier(gk, 'gk_reflexes') : 0) : 50
    let p = clamp(0.7 + (takerScore - 60) / 250 - (gkScore - 55) / 400, 0.5, 0.9)
    if (taker.skills.includes('penalty_specialist')) p += 0.06 * skillTierMultiplier(taker, 'penalty_specialist')
    const takerTrait = STAR_TRAITS[taker.traitId]
    if (takerTrait?.kind === 'shot' && (takerTrait.scope === 'penalty' || takerTrait.scope === 'any') && this.ratings.traitConditionMet(taker, takerTrait.when)) p += (takerTrait.onTarget + takerTrait.goal) / 100
    const keeperTrait = gk ? STAR_TRAITS[gk.traitId] : undefined
    if (gk && keeperTrait?.kind === 'save' && (keeperTrait.scope === 'penalty' || keeperTrait.scope === 'any') && this.ratings.traitConditionMet(gk, keeperTrait.when)) p -= keeperTrait.goal / 100
    if (gk?.skills.includes('sweeper')) p -= 0.015 * skillTierMultiplier(gk, 'sweeper')
    return clamp(p, 0.45, 0.92)
  }

  /** 谁能在这个位置把球停下：二点球争夺和追球都用同一套判定。 */
  reachOf(player: MatchPlayerState): number {
    return 4.5 + this.ratings.eff(player, 'anticipation') * 0.035 + this.ratings.eff(player, 'speed') * 0.01 + this.ratings.eff(player, 'acceleration') * 0.01
  }

  /**
   * 高空球 / 传中落点的争顶参与者：落点 13 米内的进攻方（不含门将）和防守方（门将 11 米内），各自按头球、对抗、
   * 预判、身高、技能得分，再乘一个 0.85–1.15 的随机扰动。扰动由调用方提供（jitter），先进攻方后防守方各抽一次。
   */
  aerialContestants(attacking: MatchTeamState, defending: MatchTeamState, point: { x: number; y: number }, attackingSide: MatchSide, jitter: () => number): AerialContestant[] {
    const contestants: AerialContestant[] = []
    for (const player of attacking.players) {
      if (!player.onPitch || player.position === 'GK') continue
      const dist = distance(player, point)
      if (dist <= 13) {
        const weight =
          0.45 * this.ratings.eff(player, 'heading', { aerial: true }) +
          0.25 * this.ratings.eff(player, 'strength', { aerial: true }) +
          0.2 * this.ratings.eff(player, 'anticipation') +
          0.1 * this.ratings.eff(player, 'offBall') +
          Math.max(0, player.height - 175) * 0.2 +
          (player.skills.includes('aerial') ? 5 * skillTierMultiplier(player, 'aerial') : 0) +
          (player.skills.includes('lg_off_ball_iq') && !this.hooks.legacyRules ? 6 * legendMultiplier(player, 'lg_off_ball_iq') : 0)
        contestants.push({ player, weight: weight * (0.85 + jitter() * 0.3), side: attackingSide })
        if (player.skills.includes('aerial')) this.hooks.markSkill(player, 'aerial', true, true)
      }
    }
    for (const player of defending.players) {
      if (!player.onPitch) continue
      const dist = distance(player, point)
      const isGk = player.position === 'GK'
      if (dist <= (isGk ? 11 : 13)) {
        const weight = (isGk
          ? 0.4 * this.ratings.eff(player, 'rushing', { aerial: true }) + 0.3 * this.ratings.eff(player, 'handling') + 0.2 * this.ratings.eff(player, 'anticipation') + 10
          : 0.4 * this.ratings.eff(player, 'heading', { aerial: true }) + 0.3 * this.ratings.eff(player, 'strength', { aerial: true }) + 0.2 * this.ratings.eff(player, 'defPos') + 0.1 * this.ratings.eff(player, 'anticipation')) + Math.max(0, player.height - 175) * 0.2
        contestants.push({ player, weight: weight * (0.85 + jitter() * 0.3), side: defending.side })
        if (!isGk && player.skills.includes('aerial')) this.hooks.markSkill(player, 'aerial', true, true)
      }
    }
    return contestants
  }

  /**
   * 球落在地上没人控制时，够得着球的人（两队全部场上球员）各自的抢球得分（再乘 0.75–1.25 的随机扰动，由调用方提供）。
   * 够得着：离球不超过 reachOf。
   */
  looseBallContestants(teams: MatchTeamState[], ball: { x: number; y: number }, jitter: () => number): Contestant[] {
    const candidates: Contestant[] = []
    for (const team of teams) {
      for (const player of team.players) {
        if (!player.onPitch) continue
        const dist = distance(player, ball)
        const reach = 4.5 + this.ratings.eff(player, 'anticipation') * 0.035 + this.ratings.eff(player, 'speed') * 0.01 + this.ratings.eff(player, 'acceleration') * 0.01
        if (dist <= reach) {
          const gk = player.position === 'GK'
          const weight = gk
            ? 0.5 * this.ratings.eff(player, 'rushing') + 0.3 * this.ratings.eff(player, 'handling') + 1
            : 0.35 * this.ratings.eff(player, 'anticipation') +
              0.2 * (player.position === 'CB' ? this.ratings.eff(player, 'defPos') : this.ratings.eff(player, 'offBall')) +
              0.2 * this.ratings.eff(player, 'strength') +
              0.07 * this.ratings.eff(player, 'speed') +
              0.08 * this.ratings.eff(player, 'acceleration') +
              (player.skills.includes('lg_off_ball_iq') && !this.hooks.legacyRules ? 6 * legendMultiplier(player, 'lg_off_ball_iq') : 0) +
              Math.max(0, player.height - 175) * 0.15
          candidates.push({ player, weight: weight * (0.75 + jitter() * 0.5) })
        }
      }
    }
    return candidates
  }
}
