import { starTraitOf } from '../data/star-traits.ts'
import type { TraitCondition } from '../data/star-traits.ts'
import type { AttrKey, BaseTraitId } from '../types.ts'
import { MAIN_ATTR_SCALE, MAX_ATTR_RATING } from '../scale.ts'
import { TRAITS } from '../data/skills.ts'
import { effectiveAttr } from '../ca.ts'
import { detailedPositionValue } from '../detailed-positions.ts'
import { chemistryKey } from '../chemistry.ts'
import { derivedRng } from '../rng.ts'
import { legendMultiplier } from '../legend-bonus.ts'
import { homeAtmosphereBonus } from '../economy.ts'
import { isHighIntensityTactics } from '../age-profile.ts'
import { opponentSide, skillTierMultiplier } from './team.ts'
import { clamp, progressOf, wideZone } from './pitch.ts'
import { reserveAuxAttrBonus } from './tactical-counters.ts'
import type { MatchEventContext, MatchPlayerState, MatchSide, MatchState, MatchTeamState } from './types.ts'

/**
 * 评分所需的比赛状态。MatchState 满足它；别的引擎（比如新的 2D 物理引擎）只要提供这几个字段就能复用同一套评分。
 * `teamTraits / teamTraitStep` 是光环特性的逐步缓存，会写回这个对象。
 */
export type RatingsState = Pick<MatchState, 'seed' | 'step' | 'clock' | 'score' | 'teams' | 'teamTraits' | 'teamTraitStep'>

/**
 * 属性评分：把球员的原始属性换成“这一刻的有效评分”（体能折损、位置熟练度、受伤、专属特性、球队光环、基础特性）。
 * 从 MatchEngine 原样搬出来，供结算内核（resolution.ts）和任何调用方共用；行为与搬出前逐位一致。
 */
export class MatchRatings {
  constructor(
    private readonly stateOf: () => RatingsState,
    private readonly durationOf: () => number,
  ) {}

  pairChemistry(a: MatchPlayerState, b: MatchPlayerState): number {
    if (a.side !== b.side || a.sourceId === b.sourceId) return 0
    const team = this.stateOf().teams[a.side === 'home' ? 0 : 1]
    return team.chemistry?.[chemistryKey(a.sourceId, b.sourceId)] ?? 0
  }

  teamOf(side: MatchSide): MatchTeamState | undefined {
    return this.stateOf().teams[side === 'home' ? 0 : 1]
  }

  opponentTeamOf(side: MatchSide): MatchTeamState | undefined {
    return this.stateOf().teams[side === 'home' ? 1 : 0]
  }

  scoreOf(side: MatchSide): number {
    return this.stateOf().score[side] ?? 0
  }

  activeShout(player: MatchPlayerState): MatchPlayerState['shoutState'] | undefined {
    const shout = player.shoutState
    const clock = this.stateOf().clock
    return shout && clock >= shout.appliedAt && clock < shout.expiresAt ? shout : undefined
  }

  eff(player: MatchPlayerState, key: Parameters<typeof effectiveAttr>[3], ctx: MatchEventContext = {}): number {
    const ratio = player.stamina / Math.max(1, player.maxStamina)
    const gk = player.position === 'GK'
    let value = effectiveAttr(player.attrs, ratio, player.detailedPosition ? detailedPositionValue(player, player.detailedPosition) : player.positions[player.position], key, gk)
    if (player.side === 'home') {
      const homeTeam = this.stateOf().teams[0]
      if (homeTeam?.stadiumStage && homeTeam.stadiumStage > 0) {
        value += homeAtmosphereBonus(homeTeam.stadiumStage)
      }
    }
    const star = starTraitOf(player.traitId)
    if (star?.kind === 'attr' && star.attr === key && this.traitConditionMet(player, star.when, ctx) && this.traitRoll(player, 'attr', star.chance)) value += star.bonus / MAIN_ATTR_SCALE
    if (star?.kind === 'hotStreak' && key === 'shooting') value += (star.bonus / MAIN_ATTR_SCALE) * player.stats.goals
    value += this.teamTraitBonus(player.side, key)
    if (player.skills.includes('lg_vision_master') && key === 'vision' && (ctx.passing || ctx.finalThird)) value += 7 * legendMultiplier(player, 'lg_vision_master')
    if (player.skills.includes('lg_game_management') && key === 'passing' && ctx.passing && this.stateOf().score[player.side] > this.stateOf().score[opponentSide(player.side)]) value += 3 * legendMultiplier(player, 'lg_game_management')
    if (player.skills.includes('lg_clutch') && (key === 'shooting' || key === 'composure') && this.matchProgress() >= 75 / 90) value += 5 * legendMultiplier(player, 'lg_clutch')
    if ((key === 'decisions' || key === 'composure' || key === 'passing' || key === 'tackling') && this.stateOf().score[player.side] < this.stateOf().score[opponentSide(player.side)]) {
      const team = this.stateOf().teams.find((entry) => entry.side === player.side)
      const leader = team?.players.find((entry) => entry.onPitch && entry.skills.includes('lg_leader'))
      if (leader) value += 4 * legendMultiplier(leader, 'lg_leader')
    }
    if (key === 'composure' && ctx.penalty && player.skills.includes('sh_aux_penalty_calm')) {
      value += 8 * skillTierMultiplier(player, 'sh_aux_penalty_calm')
    }
    if ((key === 'composure' || key === 'decisions') && player.skills.includes('sh_aux_comeback') && this.traitConditionMet(player, 'behind', ctx)) {
      value += 5 * skillTierMultiplier(player, 'sh_aux_comeback')
    }
    if ((key === 'defPos' || key === 'anticipation') && player.skills.includes('sh_aux_hold_lead') && this.traitConditionMet(player, 'ahead', ctx)) {
      value += 5 * skillTierMultiplier(player, 'sh_aux_hold_lead')
    }
    if ((key === 'composure' || key === 'acceleration') && player.skills.includes('sh_aux_late_surge') && this.traitConditionMet(player, 'late', ctx)) {
      value += 5 * skillTierMultiplier(player, 'sh_aux_late_surge')
    }
    if ((key === 'anticipation' || key === 'firstTouch') && player.skills.includes('sh_aux_fast_start') && this.traitConditionMet(player, 'early', ctx)) {
      value += 6 * skillTierMultiplier(player, 'sh_aux_fast_start')
    }
    if ((key === 'acceleration' || key === 'composure' || key === 'anticipation') && player.skills.includes('sh_aux_super_sub') && this.traitConditionMet(player, 'subbedOn', ctx)) {
      value += 5 * skillTierMultiplier(player, 'sh_aux_super_sub')
    }
    if ((key === 'teamwork' || key === 'vision') && player.skills.includes('sh_aux_home_boost') && this.traitConditionMet(player, 'home', ctx)) {
      value += 5 * skillTierMultiplier(player, 'sh_aux_home_boost')
    }
    if ((key === 'composure' || key === 'firstTouch') && player.skills.includes('sh_aux_away_steel') && this.traitConditionMet(player, 'away', ctx)) {
      value += 5 * skillTierMultiplier(player, 'sh_aux_away_steel')
    }
    if ((key === 'agility' || key === 'defPos') && player.skills.includes('sh_aux_tired_grit') && this.traitConditionMet(player, 'tired', ctx)) {
      value += 5 * skillTierMultiplier(player, 'sh_aux_tired_grit')
    }
    value += reserveAuxAttrBonus(player, key, this.teamOf(player.side), this.opponentTeamOf(player.side))
    const trait = TRAITS[player.traitId as BaseTraitId]
    if (trait) {
      switch (trait.effect) {
        case 'vision':
          if (key === 'vision' && (ctx.passing || ctx.finalThird)) value += trait.value
          break
        case 'finishing':
          if (key === 'shooting' && ctx.inBox) value += trait.value
          break
        case 'dribbling':
          if (key === 'dribbling') value += trait.value
          break
        case 'tackling':
          if (key === 'tackling') value += trait.value
          break
        case 'aerial':
          if ((key === 'heading' || key === 'strength') && ctx.aerial) value += trait.value
          break
        case 'pace':
          if (key === 'acceleration') value += trait.value * 0.5
          break
        case 'gkWall':
          if (key === 'reflexes') value += trait.value
          break
        case 'gkSweep':
          if (key === 'rushing') value += trait.value
          break
        case 'cross':
          if (key === 'passing' && ctx.crossing) value += trait.value
          break
        case 'link':
          if (key === 'firstTouch' && ctx.finalThird) value += trait.value
          break
        case 'overlap':
          if ((key === 'offBall' || key === 'acceleration') && ctx.wide) value += trait.value
          break
        case 'stamina':
          break
      }
    }
    const shout = player.shoutState
    if (shout && shout.delta !== 0 && this.stateOf().clock >= shout.appliedAt && this.stateOf().clock < shout.expiresAt) {
      if (shout.attrs.includes(key)) {
        value += shout.delta
      } else if (key === 'composure' || key === 'decisions' || key === 'teamwork') {
        value += shout.delta * 0.55
      }
    }
    if (player.routeId) {
      value += routeAttrDelta(player, key, ctx)
    }
    return clamp(value * (player.injured ? 0.7 : 1), 1, MAX_ATTR_RATING)
  }

  traitConditionMet(player: MatchPlayerState, when: TraitCondition, ctx: MatchEventContext = {}): boolean {
    switch (when) {
      case 'any': return true
      case 'late': return this.matchProgress() >= 75 / 90
      case 'early': return this.matchProgress() <= 15 / 90
      case 'secondHalf': return this.matchProgress() >= 0.5
      case 'behind': return this.stateOf().score[player.side] < this.stateOf().score[opponentSide(player.side)]
      case 'ahead': return this.stateOf().score[player.side] > this.stateOf().score[opponentSide(player.side)]
      case 'level': return this.stateOf().score[player.side] === this.stateOf().score[opponentSide(player.side)]
      case 'tired': return player.stamina / Math.max(1, player.maxStamina) < 0.7
      case 'fresh': return player.stamina / Math.max(1, player.maxStamina) > 0.8
      case 'wide': return wideZone(player)
      case 'attackingThird': return progressOf(player.side, player.x) > 0.65
      case 'ownHalf': return progressOf(player.side, player.x) < 0.5
      case 'home': return player.side === 'home'
      case 'away': return player.side === 'away'
      case 'subbedOn': return player.subbedOn === true
      case 'inBox': return ctx.inBox === true
      case 'crossing': return ctx.crossing === true
      case 'aerial': return ctx.aerial === true
    }
  }

  matchProgress(): number {
    return this.durationOf() > 0 ? this.stateOf().clock / this.durationOf() : 0
  }

  teamHighIntensity(side: MatchSide): boolean {
    const team = this.stateOf().teams[side === 'home' ? 0 : 1]
    return team ? isHighIntensityTactics(team.tactics, team.instructions) : false
  }

  traitRoll(player: MatchPlayerState, purpose: string, chance: number): boolean {
    return chance >= 100 || derivedRng(this.stateOf().seed, 'star-trait', purpose, this.stateOf().step, player.id).float() * 100 < chance
  }

  teamTraitBonus(side: MatchSide, key: AttrKey): number {
    if (this.stateOf().teamTraitStep !== this.stateOf().step) {
      this.stateOf().teamTraitStep = this.stateOf().step
      const traits: Record<string, number> = {}
      for (const team of this.stateOf().teams) {
        for (const carrier of team.players) {
          const trait = starTraitOf(carrier.traitId)
          if (!carrier.onPitch || (trait?.kind !== 'aura' && trait?.kind !== 'intimidate')) continue
          if (!this.traitConditionMet(carrier, trait.when)) continue
          const target = `${trait.kind === 'aura' ? carrier.side : opponentSide(carrier.side)}|${trait.attr}`
          const delta = (trait.kind === 'aura' ? trait.bonus : -trait.bonus) / MAIN_ATTR_SCALE
          traits[target] = (traits[target] ?? 0) + delta
        }
      }
      this.stateOf().teamTraits = traits
    }
    return this.stateOf().teamTraits?.[`${side}|${key}`] ?? 0
  }
}

/**
 * 培养路线球风烙印：不占 4+2 技能槽、不消耗 RNG，仅在球员装备带有 routeId 的角色卡时生效。
 * 每条路线提供明确的专精增益与小幅风格取舍，使同一球员切换不同路线卡时在 2D 引擎中呈现不同球风。
 */
export function routeAttrDelta(player: MatchPlayerState, key: AttrKey, ctx: MatchEventContext = {}): number {
  const route = player.routeId
  if (!route) return 0
  const gk = player.position === 'GK'
  const prog = progressOf(player.side, player.x)
  const isWide = Boolean(ctx.wide || ctx.crossing || wideZone(player))
  const isAttackThird = Boolean(ctx.finalThird || ctx.inBox || prog > 0.65)

  switch (route) {
    case 'safe_organization':
      if (!isAttackThird) {
        if (key === 'passing') return 3.5
        if (key === 'firstTouch') return 2.5
        if (key === 'composure') return 2
      } else if (key === 'vision') {
        return -1.5
      }
      return 0
    case 'through_passing':
      if (ctx.passing || isAttackThird) {
        if (key === 'vision') return 4
        if (key === 'passing') return 2.5
      }
      if (key === 'defPos') return -1.5
      return 0
    case 'hold_shape':
      if (key === 'defPos') return 4
      if (key === 'anticipation') return 2.5
      if (key === 'offBall') return -1.5
      return 0
    case 'press_hunt':
      if (key === 'tackling') return 4
      if (key === 'acceleration') return 2
      if (key === 'defPos') return -1.5
      return 0
    case 'calm_finish':
      if (ctx.inBox || (!ctx.longRange && prog > 0.8)) {
        if (key === 'shooting') return 3.5
        if (key === 'composure') return 3.5
      } else {
        if (key === 'shooting') return -2
        if (isAttackThird && key === 'composure') return 2
      }
      return 0
    case 'long_range':
      if (ctx.longRange || !ctx.inBox) {
        if (key === 'shooting') return 4
        if (key === 'strength') return 2
      }
      if (ctx.inBox && key === 'offBall') return -1.5
      return 0
    case 'wing_overdrive':
      if (isWide) {
        if (key === 'dribbling') return 4
        if (key === 'acceleration') return 3
      }
      if (key === 'defPos') return -1.5
      return 0
    case 'pinpoint_cross':
      if (isWide) {
        if (key === 'passing') return 4
        if (key === 'vision') return 2.5
      }
      if (ctx.inBox && key === 'shooting') return -1.5
      return 0
    case 'target_pivot':
      if (ctx.aerial || ctx.inBox || isAttackThird) {
        if (key === 'heading') return 4.5
        if (key === 'strength') return 3
      }
      if (key === 'agility') return -1.5
      return 0
    case 'power_shield':
      if (ctx.pressured || isAttackThird) {
        if (key === 'strength') return 3.5
        if (key === 'firstTouch') return 3
        if (key === 'composure') return 2
      }
      if (key === 'speed') return -1.5
      return 0
    case 'shot_stopper':
      if (!gk) return 0
      if (key === 'reflexes') return 4
      if (key === 'handling') return 3
      if (key === 'rushing') return -2
      return 0
    case 'sweeper_keeper':
      if (!gk) return 0
      if (key === 'rushing') return 4.5
      if (key === 'oneOnOne') return 3
      if (key === 'passing') return 2.5
      if (key === 'handling') return -1.5
      return 0
  }
}

