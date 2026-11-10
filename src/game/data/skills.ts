import type { BaseTraitId, SkillId, TraitEffect } from '../types.ts'
import { LEGEND_SKILLS } from './legend-skills.ts'
import { PEAK_SKILLS } from './peak-skills.ts'

export type { BaseTraitId }

export type SkillCategory = 'main' | 'auxiliary'
export const MAIN_SKILL_CAPACITY = 4
export const AUXILIARY_SKILL_CAPACITY = 2

export function skillCategory(id: SkillId): SkillCategory {
  return id === 'injury_prevention' || id === 'injury_resilience' ? 'auxiliary' : 'main'
}

export function skillCapacity(category: SkillCategory): number {
  return category === 'main' ? MAIN_SKILL_CAPACITY : AUXILIARY_SKILL_CAPACITY
}

export function canLearnSkill(skills: readonly SkillId[], id: SkillId): boolean {
  const category = skillCategory(id)
  return !skills.includes(id) && skills.filter((skill) => skillCategory(skill) === category).length < skillCapacity(category)
}

export type SkillDef = {
  id: SkillId
  name: string
  desc: string
  condition: string
  cost: '低' | '中' | '高'
}

export const SKILLS: Record<SkillId, SkillDef> = {
  ...LEGEND_SKILLS,
  ...PEAK_SKILLS,
  through_ball: {
    id: 'through_ball',
    name: '穿线者',
    desc: '前方存在有效接应跑位时，改善直塞线路质量。',
    condition: '直塞且接应者已形成前插线路',
    cost: '中',
  },
  safe_pass: {
    id: 'safe_pass',
    name: '稳健分球',
    desc: '受压时改善安全短传，较少冒险。',
    condition: '短传且持球人受到压迫',
    cost: '低',
  },
  one_touch: {
    id: 'one_touch',
    name: '一脚出球',
    desc: '低压接球且有合法传球目标时，缩短处理时间 1 秒。',
    condition: '低压 + 本步已选择传球',
    cost: '低',
  },
  box_hunter: {
    id: 'box_hunter',
    name: '禁区猎手',
    desc: '接到禁区内传球后射门，改善近距离终结。',
    condition: '在禁区内起脚',
    cost: '中',
  },
  long_shot: {
    id: 'long_shot',
    name: '重炮手',
    desc: '远射时减少距离惩罚。',
    condition: '禁区外射门',
    cost: '中',
  },
  weak_foot: {
    id: 'weak_foot',
    name: '逆足训练',
    desc: '用非惯用脚处理球时减少惩罚，不是全场加伤害。',
    condition: '本步使用逆足',
    cost: '低',
  },
  sweeper: {
    id: 'sweeper',
    name: '扫荡者',
    desc: '作为实际拦截或抢断参与者时，改善夺球能力。',
    condition: '实际参与抢断 / 拦截',
    cost: '中',
  },
  iron_lung: {
    id: 'iron_lung',
    name: '铁肺',
    desc: '降低持续跑动的体力消耗。',
    condition: '每步跑动',
    cost: '低',
  },
  aerial: {
    id: 'aerial',
    name: '空中霸主',
    desc: '争顶时改善头球处理与身体对抗。',
    condition: '参与高空球争夺',
    cost: '中',
  },
  wing_runner: {
    id: 'wing_runner',
    name: '边路飞翼',
    desc: '在边路持球突破时改善盘带执行。',
    condition: '在边路区域盘带',
    cost: '低',
  },
  gk_sweeper: {
    id: 'gk_sweeper',
    name: '出击门将',
    desc: '对方身后球进入可争夺区域时，更积极出击。',
    condition: '对方身后球进入门将可争夺区域',
    cost: '中',
  },
  gk_reflexes: { id: 'gk_reflexes', name: '门线神扑', desc: '面对射门时提高门将扑救能力。', condition: '门将面对射门', cost: '低' },
  injury_prevention: { id: 'injury_prevention', name: '伤病预防', desc: '通过训练掌握伤病预防技巧。', condition: '伤病风险', cost: '低' },
  injury_resilience: { id: 'injury_resilience', name: '伤病韧性', desc: '通过训练掌握伤病应对技巧。', condition: '受伤时', cost: '低' },
  penalty_specialist: {
    id: 'penalty_specialist',
    name: '点球专家',
    desc: '主罚点球与点球大战时提高射正与终结质量。',
    condition: '主罚点球',
    cost: '低',
  },
}

/** 随机球员用的 20 个通用特性；真实球星用 star-traits.ts 里的专属特性。 */
export type TraitDef = {
  id: BaseTraitId
  name: string
  desc: string
  effect: TraitEffect
  value: number
}

export const TRAITS: Record<BaseTraitId, TraitDef> = {
  metronome: { id: 'metronome', name: '节拍器', desc: '组织传球时视野更清晰', effect: 'vision', value: 6 },
  visionary: { id: 'visionary', name: '空间阅读者', desc: '识别向前线路时获得视野加成', effect: 'vision', value: 7 },
  cold_blood: { id: 'cold_blood', name: '冷血终结者', desc: '禁区内射门更冷静', effect: 'finishing', value: 7 },
  poacher: { id: 'poacher', name: '禁区之狐', desc: '近距离终结更稳定', effect: 'finishing', value: 6 },
  dribbler: { id: 'dribbler', name: '盘带大师', desc: '持球摆脱时盘带更有效', effect: 'dribbling', value: 6 },
  shield: { id: 'shield', name: '中场屏障', desc: '防守对抗时抢断更稳', effect: 'tackling', value: 6 },
  iron: { id: 'iron', name: '铁血后卫', desc: '防守对抗时抢断更稳', effect: 'tackling', value: 5 },
  target: { id: 'target', name: '空霸', desc: '争顶时头球与力量更强', effect: 'aerial', value: 7 },
  pace: { id: 'pace', name: '追风', desc: '前插跑动时加速更快', effect: 'pace', value: 6 },
  engine: { id: 'engine', name: '永动机', desc: '跑动体力消耗更低', effect: 'stamina', value: 8 },
  wall: { id: 'wall', name: '门线之王', desc: '面对射门时扑救反应更快', effect: 'gkWall', value: 6 },
  shotstopper: { id: 'shotstopper', name: '扑救专家', desc: '面对射门时扑救反应更快', effect: 'gkWall', value: 7 },
  sweeper: { id: 'sweeper', name: '清道夫', desc: '出击处理身后球更积极', effect: 'gkSweep', value: 6 },
  crosser: { id: 'crosser', name: '传中大师', desc: '边路传中时传球更准', effect: 'cross', value: 6 },
  halfspace: { id: 'halfspace', name: '肋部艺术家', desc: '边路向肋部传递时更准', effect: 'cross', value: 5 },
  link: { id: 'link', name: '前场支点', desc: '前场接球时第一脚触球更好', effect: 'link', value: 6 },
  overlap: { id: 'overlap', name: '套边狂魔', desc: '边路前插时跑位与加速更好', effect: 'overlap', value: 6 },
  anchor: { id: 'anchor', name: '定海神针', desc: '防守站位与抢断更稳', effect: 'tackling', value: 5 },
  finisher: { id: 'finisher', name: '天生射手', desc: '禁区内射门更冷静', effect: 'finishing', value: 6 },
  enforcer: { id: 'enforcer', name: '绞肉机', desc: '防守对抗时抢断更稳', effect: 'tackling', value: 6 },
}
