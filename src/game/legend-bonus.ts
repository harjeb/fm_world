import type { Player, SkillId } from './types.ts'

/** 传奇技能档位倍率：金/银按 1，彩按 1.4；没有学会返回 0。 */
export function legendMultiplier(player: Pick<Player, 'skills' | 'skillTiers'>, id: SkillId): number {
  if (!player.skills.includes(id)) return 0
  return player.skillTiers?.[id] === 'rainbow' ? 1.4 : 1
}

/** goldValue 是金档数值；彩档按 1.4 放大。 */
export function legendValue(player: Pick<Player, 'skills' | 'skillTiers'>, id: SkillId, goldValue: number): number {
  const multiplier = legendMultiplier(player, id)
  return multiplier > 0 ? goldValue * multiplier : 0
}

export function hasLegendSkill(player: Pick<Player, 'skills'>, id: SkillId): boolean {
  return player.skills.includes(id)
}
