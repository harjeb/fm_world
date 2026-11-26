import type { AchievementState } from '../types.ts'

/**
 * 成就提供的主属性上限奖励表：每项成就互相独立，领取后直接叠加，
 * 并与奖杯上限（取最高）独立叠加，统一受单属性 2000 硬上限约束。
 */
export const ACHIEVEMENT_CEILING_BONUSES: Readonly<Record<string, number>> = {
  feat_league_streak_5: 50,
  feat_league_streak_10: 100,
  feat_season_player_50_goals: 50,
  feat_five_goals_player: 50,
}

export const MAX_ACHIEVEMENT_CEILING_BONUS = Object.values(ACHIEVEMENT_CEILING_BONUSES).reduce(
  (sum, value) => sum + value,
  0,
)

/** 统计已领取成就提供的主属性上限总加成（各项独立叠加）。 */
export function achievementCeilingBonusFromClaims(claimed?: AchievementState['claimed']): number {
  if (!claimed) return 0
  let total = 0
  for (const [id, bonus] of Object.entries(ACHIEVEMENT_CEILING_BONUSES)) {
    if (bonus > 0 && claimed[id]) total += bonus
  }
  return total
}
