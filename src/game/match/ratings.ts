import { STAR_TRAITS } from '../data/star-traits.generated.ts'
import type { TraitCondition } from '../data/star-traits.ts'
import type { AttrKey, BaseTraitId } from '../types.ts'
import { MAIN_ATTR_SCALE } from '../scale.ts'
import { TRAITS } from '../data/skills.ts'
import { effectiveAttr } from '../ca.ts'
import { derivedRng } from '../rng.ts'
import { legendMultiplier } from '../legend-bonus.ts'
import { opponentSide } from './team.ts'
import { clamp, progressOf, wideZone } from './pitch.ts'
import type { MatchEventContext, MatchPlayerState, MatchSide, MatchState } from './types.ts'

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

  eff(player: MatchPlayerState, key: Parameters<typeof effectiveAttr>[3], ctx: MatchEventContext = {}): number {
    const ratio = player.stamina / Math.max(1, player.maxStamina)
    const gk = player.position === 'GK'
    let value = effectiveAttr(player.attrs, ratio, player.positions[player.position], key, gk)
    const star = STAR_TRAITS[player.traitId]
    if (star?.kind === 'attr' && star.attr === key && this.traitConditionMet(player, star.when, ctx) && this.traitRoll(player, 'attr', star.chance)) value += star.bonus / MAIN_ATTR_SCALE
    if (star?.kind === 'hotStreak' && key === 'shooting') value += (star.bonus / MAIN_ATTR_SCALE) * player.stats.goals
    value += this.teamTraitBonus(player.side, key)
    if (player.skills.includes('lg_vision_master') && key === 'vision' && (ctx.passing || ctx.finalThird)) value += 7 * legendMultiplier(player, 'lg_vision_master')
    if (player.skills.includes('lg_game_management') && key === 'passing' && ctx.passing && this.stateOf().score[player.side] > this.stateOf().score[opponentSide(player.side)]) value += 3 * legendMultiplier(player, 'lg_game_management')
    if (player.skills.includes('lg_clutch') && (key === 'shooting' || key === 'composure') && this.matchProgress() >= 75 / 90) value += 5 * legendMultiplier(player, 'lg_clutch')
    if (key === 'decisions' && this.stateOf().score[player.side] < this.stateOf().score[opponentSide(player.side)]) {
      const team = this.stateOf().teams.find((entry) => entry.side === player.side)
      const leader = team?.players.find((entry) => entry.onPitch && entry.skills.includes('lg_leader'))
      if (leader) value += 4 * legendMultiplier(leader, 'lg_leader')
    }
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
    return clamp(value * (player.injured ? 0.7 : 1), 1, 100)
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

  traitRoll(player: MatchPlayerState, purpose: string, chance: number): boolean {
    return chance >= 100 || derivedRng(this.stateOf().seed, 'star-trait', purpose, this.stateOf().step, player.id).float() * 100 < chance
  }

  teamTraitBonus(side: MatchSide, key: AttrKey): number {
    if (this.stateOf().teamTraitStep !== this.stateOf().step) {
      this.stateOf().teamTraitStep = this.stateOf().step
      const traits: Record<string, number> = {}
      for (const team of this.stateOf().teams) {
        for (const carrier of team.players) {
          const trait = STAR_TRAITS[carrier.traitId]
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
