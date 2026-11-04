import { skillTierMultiplier } from './team.ts'
import type { GoalDetail } from '../types.ts'
import type { PCG32 } from '../rng.ts'
import type { MatchPlayerState } from './types.ts'
import { GOAL_Y, PITCH_LENGTH } from './team.ts'

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

/** Left and right are relative to the attacking direction, not the screen. */
export function attackingLeft(player: MatchPlayerState, y: number): boolean {
  return player.side === 'home' ? y < GOAL_Y : y > GOAL_Y
}

export function chooseShotFoot(player: MatchPlayerState, y: number, balance: number, rng: PCG32): 'left' | 'right' {
  const natural = attackingLeft(player, y) ? 'left' : 'right'
  if (player.foot === 'B') return natural
  const preferred = player.foot === 'L' ? 'left' : 'right'
  if (natural === preferred) return preferred
  const wide = Math.abs(y - GOAL_Y) / GOAL_Y
  const weakChance = clamp(0.18 + wide * 0.5 + (balance - 50) / 500 + (player.skills.includes('weak_foot') ? 0.12 * skillTierMultiplier(player, 'weak_foot') : 0), 0.08, 0.85)
  return rng.chance(weakChance) ? natural : preferred
}

export function isWeakShotFoot(player: MatchPlayerState, foot: 'left' | 'right'): boolean {
  return player.foot !== 'B' && (player.foot === 'L' ? foot === 'right' : foot === 'left')
}

/** Abstract aiming zones: their probabilities depend on the same effective attributes as shots. */
export function chooseShotTarget(precision: number, rng: PCG32): GoalDetail['target'] {
  const corner = 0.5 + precision / 100
  const center = 1.6 - precision / 125
  const high = 0.65 + precision / 250
  return rng.weighted(
    ['top_left', 'top_center', 'top_right', 'bottom_left', 'bottom_center', 'bottom_right'] as const,
    [corner * high, center * high, corner * high, corner, center, corner],
  )
}

export function shotPositionText(goal: Pick<GoalDetail, 'side' | 'origin'>): string {
  const progress = goal.side === 'home' ? goal.origin.x / PITCH_LENGTH : 1 - goal.origin.x / PITCH_LENGTH
  const box = progress >= 0.84 && goal.origin.y >= 18 && goal.origin.y <= 46
  const left = goal.side === 'home' ? goal.origin.y < GOAL_Y : goal.origin.y > GOAL_Y
  const side = Math.abs(goal.origin.y - GOAL_Y) < 7 ? '中路' : left ? '左侧' : '右侧'
  return `${box ? '禁区内' : '禁区外'}${side}`
}

export function shotTargetText(target: GoalDetail['target']): string {
  return {
    top_left: '左上角', top_center: '上方中路', top_right: '右上角',
    bottom_left: '左下角', bottom_center: '下方中路', bottom_right: '右下角',
  }[target]
}
