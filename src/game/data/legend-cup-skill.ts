import type { LegendBook, SkillBookId, SpecialBookSkillId } from '../types.ts'

export type SpecialBookSkillDef = {
  id: SpecialBookSkillId
  name: string
  desc: string
  condition: string
  cost: '低' | '中' | '高'
  scope: 'any' | 'field' | 'gk'
  /** 携带在培养技能书槽即生效，不占球员实战 4+2 技能槽，不进入周一交流赛技能学习选项。 */
  passiveBook: true
  requires: []
  effect: string
}

export const LEGEND_STAR_BOOK_ID: SpecialBookSkillId = 'lg_legend_star'
export const LEGEND_STAR_EVENT_ID = 'legend_star_event'
export const LEGEND_STAR_INHERIT_EVENT_ID = 'legend_star_inherit_event'
/** 携带《传奇之星》彩书时，每次常规培养行动独立触发彩色事件的概率（10%）。 */
export const LEGEND_STAR_EVENT_CHANCE = 0.1
export const LEGEND_STAR_INHERIT_CHANCE = 0.001
/** 单轮培养最多触发彩色事件次数。 */
export const LEGEND_STAR_MAX_TRIGGERS = 3
/** 彩色事件二选一后为所选主属性带来的固定净增。 */
export const LEGEND_STAR_ATTR_GAIN = 100
/** 彩色事件每次提供的随机未满主属性选项数。 */
export const LEGEND_STAR_CHOICES = 2

export const LEGEND_CUP_REWARD_BOOK: LegendBook = {
  id: LEGEND_STAR_BOOK_ID,
  tier: 'rainbow',
}

export const SPECIAL_BOOK_SKILLS: Record<SpecialBookSkillId, SpecialBookSkillDef> = {
  lg_legend_star: {
    id: 'lg_legend_star',
    name: '传奇之星',
    desc: '传奇杯首次夺冠专属技能书。培养前带入书槽即全程生效，不占球员实战技能槽。',
    condition: '培养前带入技能书槽（不占实战技能槽）',
    cost: '高',
    scope: 'any',
    passiveBook: true,
    requires: [],
    effect: `携带生效：每次常规行动 ${Math.round(LEGEND_STAR_EVENT_CHANCE * 100)}% 触发彩色事件，从 ${LEGEND_STAR_CHOICES} 项随机未满主属性中二选一 +${LEGEND_STAR_ATTR_GAIN}（每轮最多 ${LEGEND_STAR_MAX_TRIGGERS} 次）`,
  },
}

export function isPassiveTrainingBook(id: SkillBookId): boolean {
  return id === LEGEND_STAR_BOOK_ID
}
