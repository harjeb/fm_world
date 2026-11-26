import type { BaseTraitId, SkillId, SkillTier, TraitEffect, TraitId } from '../types.ts'
import { MAIN_ATTR_SCALE } from '../scale.ts'
import { TRAITS } from './skills.ts'
import { LEGEND_SKILLS } from './legend-skills.ts'
import { PEAK_SKILLS } from './peak-skills.ts'
import { starTraitOf, starTraitText } from './star-traits.ts'
import { isExclusiveSkill } from './tsubasa-specials.ts'

/**
 * 给玩家看的技能和特性效果说明。
 * 数字来自 match/engine.ts 和 match/team.ts 里的实际结算，改那边的数值时这里要跟着改。
 * “成功率约 +x%” 是按常见局面（成功率 60%–75%）估算的，实际随局面变化。
 */

const TIER_MULTIPLIER: Record<SkillTier, number> = { silver: 1, gold: 1.2, rainbow: 1.4 }

/** 去掉浮点误差和多余的 0：4.800000000000001 → 4.8。 */
const num = (value: number) => String(Math.round(value * 10) / 10)

const SKILL_EFFECTS: Partial<Record<SkillId, (m: number) => string>> = {
  through_ball: (m) => `直塞时：传球评分 +${num(5 * m)}，成功率约 +${num(3.5 * m)}%。`,
  safe_pass: (m) => `受压时短传：传球评分 +${num(4 * m)}，成功率约 +${num(2.5 * m)}%。`,
  one_touch: (m) => `低压接球直接出球，处理时间缩短 ${num(m)} 秒；低压短传/直塞传球评分 +${num(4 * m)}。`,
  box_hunter: (m) => `在禁区内起脚：射正率 +${num(4 * m)}%，进球率 +${num(3 * m)}%。`,
  long_shot: (m) => `在禁区外起脚：射正率 +${num(3.5 * m)}%，进球率 +${num(2 * m)}%。`,
  weak_foot: (m) => `更敢用逆足（使用机会 +${num(12 * m)}%）。逆足射门射正率 +${num(2 * m)}%，逆足传球成功率约 +${num(2 * m)}%，逆足惩罚减轻。`,
  sweeper: (m) => `亲自拦截或抢断时：防守评分 +${num(3 * m)} 到 +${num(4 * m)}，对手成功率约 -${num(2.5 * m)}%。`,
  iron_lung: (m) => `跑动时的体力消耗 -${num(5 + (m - 1) * 25)}%。`,
  aerial: (m) => `争顶高空球时：争顶评分 +${num(5 * m)}。`,
  wing_runner: (m) => `在边路盘带：盘带评分 +${num(5 * m)}，成功率约 +${num(3 * m)}%。`,
  gk_sweeper: (m) => `门将积极出击，最远离门线约 ${num(24 * m)} 米；出球传球 +${num(4 * m)}，单刀/禁区空位扑救 +${num(5 * m)}（常规 +${num(2.5 * m)}），高空与二点球出击 +${num(5 * m)} / +${num(8 * m)}。`,
  gk_reflexes: (m) => `面对射门：扑救评分 +${num(5 * m)}，对手进球率约 -${num(1.5 * m)}%。`,
  injury_prevention: (m) => `比赛中的受伤风险 -${num(30 * m)}%。`,
  injury_resilience: (m) => `受伤后的恢复时间 -${num(30 * m)}%。`,
  penalty_specialist: (m) => `主罚点球：射正率 +${num(5 * m)}%，进球率 +${num(4 * m)}%；点球大战命中率 +${num(6 * m)}%。`,
  gk_safe_hands: (m) => `扑救后抱住球的概率 +${num(8 * m)}%。`,
  gk_high_ball: (m) => `门将争夺高球：争顶评分 +${num(5 * m)}。`,
  gk_close_down: (m) => `面对单刀：门将评分 +${num(5 * m)}。`,
  gk_long_kick: (m) => `门将长传：传球评分 +${num(4 * m)}。`,
  cb_intercept: (m) => `拦截传球时：线路评分 +${num(4 * m)}，防守评分 +${num(3 * m)}。`,
  cb_block: (m) => `己方半场封堵射门：封堵评分 +${num(5 * m)}。`,
  cb_cover: (m) => `己方半场争抢二点球：争抢评分 +${num(5 * m)}。`,
  wing_cross: (m) => `传中时：传球评分 +${num(4 * m)}。`,
  wing_support: (m) => `前场边路接球：传球评分 +${num(4 * m)}。`,
  wing_track_back: (m) => `边路防守一对一：防守评分 +${num(4 * m)}。`,
  cm_long_pass: (m) => `长传时：传球评分 +${num(4 * m)}。`,
  cm_shield: (m) => `受压盘带时：盘带评分 +${num(4 * m)}。`,
  st_breakaway: (m) => `接应直塞：传球评分 +${num(4 * m)}。`,
  sh_buildup: (m) => `本方半场短传 / 长传：传球评分 +${num(4 * m)}。`,
  sh_box_defense: (m) => `本方禁区附近防盘带：防守评分 +${num(5 * m)}。`,
  sh_mid_destroyer: (m) => `中路区域防盘带：防守评分 +${num(4 * m)}。`,
  sh_clear_header: (m) => `防守方争顶高空球：争顶评分 +${num(6 * m)}。`,
  sh_clean_tackle: (m) => `盘带对抗防守时：犯规占比 -${num(18 * m)}%。`,
  sh_long_block: (m) => `封堵禁区外远射：封堵评分 +${num(6 * m)}。`,
  sh_switch_play: (m) => `中路向边路传球：传球评分 +${num(4.5 * m)}。`,
  sh_halfspace_pass: (m) => `前场短传 / 直塞：传球评分 +${num(4.5 * m)}。`,
  sh_ball_magnet: (m) => `接应队友传球：接应传球评分 +${num(4.5 * m)}、控制半径 +${num(0.9 * m)} 米；争抢二点球 +${num(4 * m)}。`,
  sh_counter_press: (m) => `对方半场争抢二点球：争抢评分 +${num(5 * m)}。`,
  sh_ball_carrier: (m) => `中路区域盘带：盘带评分 +${num(4.5 * m)}。`,
  sh_lane_cut: (m) => `拦截长传 / 直塞：防守评分 +${num(5 * m)}。`,
  sh_cut_inside: (m) => `前场边路受压盘带：盘带评分 +${num(5 * m)}。`,
  sh_cutback: (m) => `前场边路向中路传球：传球评分 +${num(5 * m)}。`,
  sh_dead_ball: (m) => `任意球传中与角球优先主罚：任意球传中质量 +${num(12 * m)}%，落点己方争顶评分 +${num(8 * m)}。`,
  sh_cut_in_shot: (m) => `肋部 14–24 米偏侧起脚：射正率 +${num(3.5 * m)}%，进球率 +${num(2 * m)}%。`,
  sh_clinical_1v1: (m) => `单刀或禁区空位起脚：进球率 +${num(4.5 * m)}%。`,
  sh_target_header: (m) => `进攻方争顶高空球：争顶评分 +${num(6 * m)}。`,
  sh_power_header: (m) => `头球攻门：射正率 +${num(3.5 * m)}%，进球率 +${num(2.5 * m)}%。`,
  sh_free_kick: (m) => `直接任意球优先主罚（射程 +3 米）：射正率 +${num(11 * m)}%，进球率 +${num(7 * m)}%。`,
  sh_poised_finish: (m) => `受贴身压迫起脚：射正率 +${num(3.5 * m)}%，进球率 +${num(2.5 * m)}%。`,
  sh_target_link: (m) => `前场接应队友传球：传球评分 +${num(4.5 * m)}。`,
  sh_tight_angle: (m) => `偏侧/小角度（< 36°）起脚：射正率 +${num(4.5 * m)}%，进球率 +${num(3 * m)}%。`,
  sh_box_poacher: (m) => `对方禁区附近争二点球：争抢评分 +${num(6 * m)}。`,
  sh_gk_long_save: (m) => `门将在位面对禁区外远射：扑救评分 +${num(6 * m)}。`,
  sh_gk_penalty: (m) => `常规点球扑救评分 +${num(6 * m)}；点球大战对手命中率 -${num(5 * m)}%。`,
  sh_gk_box_command: (m) => `门将在位面对 12 米内近射：扑救评分 +${num(5 * m)}。`,
  sh_gk_aerial_save: (m) => `门将在位面对头球攻门：扑救评分 +${num(6 * m)}。`,
  sh_gk_short_build: (m) => `门将发起短传：传球评分 +${num(5 * m)}。`,
  sh_gk_loose_claim: (m) => `门将参与二点球争夺：争抢评分 +${num(6 * m)}。`,
  sh_aux_penalty_calm: (m) => `常规点球与点球大战（主罚/扑点）：镇定有效评分 +${num(8 * m)}。`,
  sh_aux_comeback: (m) => `比分落后时：镇定与决断有效评分各 +${num(5 * m)}。`,
  sh_aux_hold_lead: (m) => `比分领先时：防守站位与预判有效评分各 +${num(5 * m)}。`,
  sh_aux_late_surge: (m) => `第 75 分钟后：镇定与加速有效评分各 +${num(5 * m)}。`,
  sh_aux_fast_start: (m) => `开场前 15 分钟：预判与第一脚触球有效评分各 +${num(6 * m)}。`,
  sh_aux_super_sub: (m) => `替补登场后：加速、镇定与预判有效评分各 +${num(5 * m)}。`,
  sh_aux_home_boost: (m) => `主场比赛时：团队合作与视野有效评分各 +${num(5 * m)}。`,
  sh_aux_away_steel: (m) => `客场比赛时：镇定与第一脚触球有效评分各 +${num(5 * m)}。`,
  sh_aux_tired_grit: (m) => `体力低于 70% 时：敏捷与防守站位有效评分各 +${num(5 * m)}。`,
  sh_aux_discipline: (m) => `犯规后吃牌判定：黄牌与直红风险 -${num(25 * m)}%。`,
  lg_legend_star: () => '培养前带入书槽即全程生效（不占技能槽）：每次常规行动 10% 触发彩色事件，从 2 项随机未满主属性中二选一 +100（每轮最多 3 次）。',
  ct_sggk: (m) => `门将在位面对射门：扑救评分 +${num(6.5 * m)}；扑救后抱住球的概率 +${num(10 * m)}%。`,
  ct_razor_shot: (m) => `边路传中：传球评分 +${num(5.5 * m)}；偏侧或小角度起脚：射正率 +${num(4.5 * m)}%，进球率 +${num(3 * m)}%。`,
  ct_power_tackle: (m) => `防守对抗：抢断评分 +${num(5.5 * m)}；本方半场封堵射门 +${num(6 * m)}；高空争顶评分 +${num(4.5 * m)}。`,
  ct_face_block: (m) => `封堵对手射门：封堵评分 +${num(8.5 * m)}；本方半场二点球争抢 +${num(5 * m)}。`,
  ct_eagle_shot: (m) => `长传调度：传球评分 +${num(5.5 * m)}；禁区外远射：射正率 +${num(4.5 * m)}%，进球率 +${num(3.5 * m)}%。`,
  ct_offside_trap: (m) => `拦截与抢断：防守评分 +${num(5.5 * m)}；本方半场二点球争抢 +${num(5 * m)}；头球攻门射正率 +${num(4 * m)}%。`,
  ct_drive_shot: (m) => `禁区外起脚：射正率 +${num(5.5 * m)}%，进球率 +${num(4 * m)}%；中路传球调度评分 +${num(3 * m)}。`,
  ct_boomerang_pass: (m) => `直塞或前场短传：传球评分 +${num(6 * m)}；边路传中：传球评分 +${num(5 * m)}。`,
  ct_chokkaku_feint: (m) => `盘带突破：盘带评分 +${num(6 * m)}，成功率下限 +${num(6 * m)}%；边路回追防守评分 +${num(3.5 * m)}。`,
  ct_tiger_shot: (m) => `起脚射门（非头球 / 点球）：压低门将评分 -${num(5 * m)}，射正率 +${num(4 * m)}%，进球率 +${num(4.5 * m)}%。`,
  ct_falcon_shot: (m) => `禁区内起脚：射正率 +${num(4.5 * m)}%，进球率 +${num(3.5 * m)}%；接应直塞：传球配合评分 +${num(5 * m)}。`,
  ct_triangle_jump: (m) => `门将在位面对单刀或近射：扑救评分 +${num(6 * m)}；门将高空球出击争顶 +${num(6.5 * m)}。`,
  ct_toho_link: (m) => `短传配合：传球评分 +${num(5 * m)}；受压出球与盘带摆脱评分各 +${num(4 * m)}。`,
  ct_aerial_command: (m) => `高空球争顶：争顶评分 +${num(6 * m)}；中路拦截传球：防守评分 +${num(5 * m)}。`,
  ct_silver_poacher: (m) => `禁区内起脚：射正率 +${num(4.5 * m)}%，进球率 +${num(3.5 * m)}%；前场二点球争抢 +${num(5.5 * m)}。`,
  ct_sideline_dribble: (m) => `边路盘带：盘带评分 +${num(5.5 * m)}；边路传中：传球评分 +${num(5.5 * m)}。`,
}

export function skillEffectText(id: SkillId, tier: SkillTier = 'silver'): string {
  const fn = SKILL_EFFECTS[id]
  if (fn) return fn(TIER_MULTIPLIER[tier])
  const legend = LEGEND_SKILLS[id as keyof typeof LEGEND_SKILLS] as { effect?: string } | undefined
  const peak = PEAK_SKILLS[id as keyof typeof PEAK_SKILLS] as { effect?: string } | undefined
  const effect = legend?.effect ?? peak?.effect
  if (!effect) return ''
  const text = effect.replace(/(\d+\.\d{2,})/g, (_match, value: string) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return value
    const rounded = Math.round(n * 10) / 10
    return n !== 0 && rounded === 0 ? String(Number(n.toPrecision(2))) : String(rounded)
  })
  return `${text}（银/金 ×1 / 彩 ×1.4）`
}

/** 铁肺不是按倍数算的，单独说明；角色唯一专属技能标明唯一属性。 */
export function skillTierNote(id: SkillId): string {
  if (id === 'iron_lung') return '等级效果：银 5% / 金 10% / 彩虹 15%'
  if (isExclusiveSkill(id)) return '角色唯一专属绝技（默认彩虹档；倍率参考：银 ×1 / 金 ×1.2 / 彩虹 ×1.4）'
  return '等级效果：银 ×1 / 金 ×1.2 / 彩虹 ×1.4'
}

/** Describe the attribute effect and value without exposing engine-scale labels. */
const main = (value: number) => `+${num(value * MAIN_ATTR_SCALE)}`
const hidden = (value: number) => `+${num(value)}`

const TRAIT_EFFECTS: Record<TraitEffect, (value: number) => string> = {
  vision: (v) => `传球或进入前场时：视野 ${hidden(v)}。`,
  finishing: (v) => `在禁区内射门时：射术 ${main(v)}。`,
  dribbling: (v) => `盘带 ${main(v)}。`,
  tackling: (v) => `抢断 ${main(v)}。`,
  aerial: (v) => `争顶时：力量 ${main(v)}，头球 ${hidden(v)}。`,
  pace: (v) => `加速 ${hidden(v * 0.5)}。`,
  stamina: (v) => `跑动时的体力消耗 -${num(v)}%。`,
  gkWall: (v) => `扑救反应 ${main(v)}。`,
  gkSweep: (v) => `出击 ${main(v)}。`,
  cross: (v) => `传中时：传球 ${main(v)}。`,
  link: (v) => `在前场接球时：第一脚触球 ${hidden(v)}。`,
  overlap: (v) => `在边路时：无球跑位和加速 ${hidden(v)}。`,
}

export function traitEffectText(id: TraitId): string {
  const star = starTraitOf(id)
  if (star) return starTraitText(star)
  const trait = TRAITS[id as BaseTraitId]
  return trait ? TRAIT_EFFECTS[trait.effect](trait.value) : ''
}
