import type { Player, SkillId, SkillTier, TrainingSession } from './types.ts'
import { POSITIONS } from './types.ts'
import { canLearnSkill, skillCategory, SKILLS } from './data/skills.ts'
import { derivedRng } from './rng.ts'

/** Unmarked skills in legacy saves are silver. Original star skills should be marked at creation. */
export function getSkillTier(player: Pick<Player, 'skillTiers'>, skillId: SkillId): SkillTier {
  return player.skillTiers?.[skillId] ?? 'silver'
}

/**
 * 校验技能传承条件；当目标类别技能槽已满时，允许传入同类别的 `replaceSkill` 顶掉已有技能。
 * The caller must also check that the mentor belongs to the training team's roster.
 */
export function validateInheritance(session: TrainingSession, mentor: Player, skillId: SkillId, replaceSkill?: SkillId): string | null {
  if (session.completed || session.action >= (session.actionsTotal ?? 18)) return '本轮培养已经结束'
  if (session.pendingEventId) return '请先处理当前事件'
  if (mentor.id === session.playerId || mentor.id === session.candidate.id) return '不能指导自己'
  if (!Object.hasOwn(SKILLS, skillId) || !mentor.skills.includes(skillId)) return '导师没有该技能'
  if (session.candidate.skills.includes(skillId)) return '技能已掌握'
  const category = skillCategory(skillId)
  if (!canLearnSkill(session.candidate.skills, skillId)) {
    if (!replaceSkill) return '技能槽已满，请选择要顶掉的已有技能'
    if (!session.candidate.skills.includes(replaceSkill) || skillCategory(replaceSkill) !== category) {
      return '请选择同类别的已有技能进行替换'
    }
    return null
  }
  if (replaceSkill !== undefined) {
    if (!session.candidate.skills.includes(replaceSkill) || skillCategory(replaceSkill) !== category) {
      return '请选择同类别的已有技能进行替换'
    }
  }
  return null
}

/** Tier probabilities are conditional on successful inheritance; silver is the remainder. */
export function inheritanceChances(session: TrainingSession, mentor: Player, skillId: SkillId): { success: number; gold: number; rainbow: number } {
  const primary = POSITIONS.reduce((best, pos) => mentor.positions[pos] > mentor.positions[best] ? pos : best, POSITIONS[0])
  const compatible = session.candidate.positions[primary] >= 60
  const tier = getSkillTier(mentor, skillId)
  const success = Math.max(0.2, Math.min(0.9, 0.5 + (compatible ? 0.15 : 0) + (tier === 'rainbow' ? 0.1 : tier === 'gold' ? 0.05 : 0) - Math.max(0, session.fatigue - 50) / 500))
  return { success, gold: tier === 'silver' ? 0 : tier === 'gold' ? 0.3 : 0.35, rainbow: tier === 'rainbow' ? 0.1 : 0 }
}

export type InheritanceResult =
  | { ok: false; error: string }
  | { ok: true; success: boolean; tier: SkillTier | null; roll: number; chances: ReturnType<typeof inheritanceChances>; replaced?: SkillId }

/** Executes only the inheritance effect. The training pipeline consumes the action and logs it. */
export function mentorSkill(session: TrainingSession, mentor: Player, skillId: SkillId, replaceSkill?: SkillId): InheritanceResult {
  const error = validateInheritance(session, mentor, skillId, replaceSkill)
  if (error) return { ok: false, error }
  const slotFull = !canLearnSkill(session.candidate.skills, skillId)
  const targetReplace = slotFull
    ? replaceSkill
    : (replaceSkill && session.candidate.skills.includes(replaceSkill) ? replaceSkill : undefined)
  const chances = inheritanceChances(session, mentor, skillId)
  const rng = derivedRng(session.seed, 'inherit', session.playerId, session.action + 1, mentor.seedId, skillId)
  const roll = rng.float()
  if (roll >= chances.success) return { ok: true, success: false, tier: null, roll, chances }
  const tierRoll = rng.float()
  const tier: SkillTier = tierRoll < chances.rainbow ? 'rainbow' : tierRoll < chances.rainbow + chances.gold ? 'gold' : 'silver'
  if (targetReplace) {
    session.candidate.skills = session.candidate.skills.map((item) => (item === targetReplace ? skillId : item))
    const nextTiers = { ...session.candidate.skillTiers }
    delete nextTiers[targetReplace]
    nextTiers[skillId] = tier
    session.candidate.skillTiers = nextTiers
    return { ok: true, success: true, tier, roll, chances, replaced: targetReplace }
  }
  session.candidate.skills = [...session.candidate.skills, skillId]
  session.candidate.skillTiers = { ...session.candidate.skillTiers, [skillId]: tier }
  return { ok: true, success: true, tier, roll, chances }
}
