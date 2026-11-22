import type { AttrKey, ShopAuxSkillId, ShopSkillId } from '../types.ts'
import { isMainAttr } from '../scale.ts'

export type ShopSkillScope = 'field' | 'gk' | 'any'
export type ShopSkillGroup = 'defense' | 'midfield' | 'wing' | 'forward' | 'gk' | 'auxiliary'
export type ShopSkillRequirement = { attr: AttrKey; silver: number; gold: number; rainbow: number }
export type ShopCatalogSkillId = ShopSkillId | 'injury_prevention' | 'injury_resilience'

export type ShopSkillDef = {
  id: ShopSkillId
  name: string
  desc: string
  condition: string
  cost: '低' | '中' | '高'
  scope: ShopSkillScope
  group: ShopSkillGroup
  category: 'main' | 'auxiliary'
  requires: ShopSkillRequirement[]
}

export const SHOP_GROUP_LABELS: Record<ShopSkillGroup, string> = {
  defense: '防线',
  midfield: '中场',
  wing: '边路',
  forward: '锋线',
  gk: '门将',
  auxiliary: '辅助',
}

const MAIN_THRESHOLDS = { silver: 600, gold: 750, rainbow: 900 } as const
const HIDDEN_THRESHOLDS = { silver: 8, gold: 11, rainbow: 14 } as const

function shopSkill(
  id: ShopSkillId,
  name: string,
  scope: ShopSkillScope,
  group: ShopSkillGroup,
  attr: AttrKey,
  cost: '低' | '中' | '高',
  desc: string,
  condition: string,
  category: 'main' | 'auxiliary' = 'main',
): ShopSkillDef {
  const main = scope === 'any' ? isMainAttr(attr, false) && isMainAttr(attr, true) : isMainAttr(attr, scope === 'gk')
  return {
    id,
    name,
    desc,
    condition,
    cost,
    scope,
    group,
    category,
    requires: [{ attr, ...(main ? MAIN_THRESHOLDS : HIDDEN_THRESHOLDS) }],
  }
}

/** 30 个非传奇、非巅峰的商店技能（24 外场 + 6 门将），每赛季轮换上架 8 外场 + 2 门将金书。 */
export const SHOP_SKILLS: Record<ShopSkillId, ShopSkillDef> = {
  // 防线（6）
  sh_buildup: shopSkill('sh_buildup', '后场出球', 'field', 'defense', 'passing', '低', '在本方半场发起短传或长传出球时更稳健。', '本方半场短传 / 长传'),
  sh_box_defense: shopSkill('sh_box_defense', '禁区铁闸', 'field', 'defense', 'tackling', '中', '在本方禁区附近防守对手盘带时更具压迫力。', '本方禁区附近防守盘带'),
  sh_mid_destroyer: shopSkill('sh_mid_destroyer', '中路绞杀', 'field', 'defense', 'tackling', '中', '在中路区域一对一防守对手盘带时抢断更稳。', '中路区域防守盘带'),
  sh_clear_header: shopSkill('sh_clear_header', '解围头槌', 'field', 'defense', 'heading', '中', '防守高空球与传中争顶时更占优势。', '防守方参与高空球争顶'),
  sh_clean_tackle: shopSkill('sh_clean_tackle', '冷静断球', 'field', 'defense', 'composure', '中', '盘带对抗防守时下脚更干净，明显减少无谓犯规。', '盘带对抗防守'),
  sh_long_block: shopSkill('sh_long_block', '远射封锁', 'field', 'defense', 'defPos', '中', '封堵对手禁区外远射时更容易挡出球路。', '封堵禁区外射门'),

  // 中场（6）
  sh_switch_play: shopSkill('sh_switch_play', '转移分边', 'field', 'midfield', 'passing', '低', '从中路大范围或快速分球至边路时更精准。', '中路向边路传球'),
  sh_halfspace_pass: shopSkill('sh_halfspace_pass', '肋部渗透', 'field', 'midfield', 'vision', '中', '在前场组织短传与直塞渗透时传球质量更高。', '前场短传 / 直塞'),
  sh_ball_magnet: shopSkill('sh_ball_magnet', '接应大师', 'field', 'midfield', 'firstTouch', '低', '接应队友传球更稳健，显著提高传接成功率与二点球控制力。', '接应传球 / 二点球'),
  sh_counter_press: shopSkill('sh_counter_press', '反抢猎犬', 'field', 'midfield', 'anticipation', '中', '在对方半场争抢二点球与球权反抢时更积极。', '对方半场争抢二点球'),
  sh_ball_carrier: shopSkill('sh_ball_carrier', '推进节拍', 'field', 'midfield', 'dribbling', '中', '在中路区域带球推进和摆脱防守时更稳健。', '中路区域盘带'),
  sh_lane_cut: shopSkill('sh_lane_cut', '传球封线', 'field', 'midfield', 'anticipation', '中', '拦截对手长传转移或身后直塞时抢截更有效。', '拦截长传 / 直塞'),

  // 边路（4）
  sh_cut_inside: shopSkill('sh_cut_inside', '内切突破', 'field', 'wing', 'dribbling', '中', '在前场边路受到贴身逼抢时更擅长盘带强突。', '前场边路受压盘带'),
  sh_cutback: shopSkill('sh_cutback', '倒三角回敲', 'field', 'wing', 'passing', '中', '从前场边路或底线向中路禁区回敲时更精准。', '前场边路向中路传球'),
  sh_dead_ball: shopSkill('sh_dead_ball', '定位球弧线', 'field', 'wing', 'passing', '低', '优先主罚任意球传中与角球，显著提升落点精度与禁区队友争顶优势。', '任意球传中 / 角球'),
  sh_cut_in_shot: shopSkill('sh_cut_in_shot', '内切兜射', 'field', 'wing', 'shooting', '中', '从肋部中远距离偏侧位置起脚兜射时更准更致命。', '肋部 14–24 米偏侧起脚'),

  // 锋线（8）
  sh_clinical_1v1: shopSkill('sh_clinical_1v1', '单刀杀手', 'field', 'forward', 'composure', '高', '获得单刀或禁区空位良机时终结更加冷静致命。', '单刀 / 禁区空位起脚'),
  sh_target_header: shopSkill('sh_target_header', '头球抢点', 'field', 'forward', 'heading', '中', '进攻端争抢高空球与传中落点时更有统治力。', '进攻方参与高空球争顶'),
  sh_power_header: shopSkill('sh_power_header', '强力头槌', 'field', 'forward', 'heading', '中', '头球攻门时射正与破门威胁同步提升。', '头球射门'),
  sh_free_kick: shopSkill('sh_free_kick', '任意球大师', 'field', 'forward', 'shooting', '中', '优先主罚直接任意球并拓展射程，弧线与落点极具破门威胁。', '直接任意球（射程 +3m）'),
  sh_poised_finish: shopSkill('sh_poised_finish', '抗压终结', 'field', 'forward', 'strength', '中', '在防守球员贴身干扰下依然能稳定完成射门。', '受贴身压迫时起脚'),
  sh_target_link: shopSkill('sh_target_link', '支点做球', 'field', 'forward', 'strength', '低', '在前场作为进攻支点接应传球时更容易护住并衔接成功。', '前场接应队友传球'),
  sh_tight_angle: shopSkill('sh_tight_angle', '小角度巧射', 'field', 'forward', 'shooting', '中', '在禁区两侧及小角度起脚时仍能精准命中门框并提升破门率。', '小角度（< 36°）起脚'),
  sh_box_poacher: shopSkill('sh_box_poacher', '门前补射', 'field', 'forward', 'offBall', '中', '在对方禁区附近嗅觉敏锐，更容易抢下二点球。', '对方禁区附近争二点球'),

  // 门将（6）
  sh_gk_long_save: shopSkill('sh_gk_long_save', '远射克星', 'gk', 'gk', 'reflexes', '中', '门将在位面对对手禁区外远射时扑救更稳健。', '门将在位面对禁区外远射'),
  sh_gk_penalty: shopSkill('sh_gk_penalty', '扑点专家', 'gk', 'gk', 'composure', '高', '面对常规点球和点球大战时判断更准、扑点更有威胁。', '面对常规点球 / 点球大战'),
  sh_gk_box_command: shopSkill('sh_gk_box_command', '小禁区霸主', 'gk', 'gk', 'oneOnOne', '中', '门将在位面对 12 米内近距离射门时封堵扑救更强。', '门将在位面对 12 米内近射'),
  sh_gk_aerial_save: shopSkill('sh_gk_aerial_save', '门线防头球', 'gk', 'gk', 'handling', '中', '门将在位面对头球攻门时下意识扑救更果断。', '门将在位面对头球攻门'),
  sh_gk_short_build: shopSkill('sh_gk_short_build', '稳健短传', 'gk', 'gk', 'passing', '低', '门将通过短传组织后场出球时更准确稳健。', '门将发起短传'),
  sh_gk_loose_claim: shopSkill('sh_gk_loose_claim', '门前抢断', 'gk', 'gk', 'rushing', '中', '门将在禁区内冲出争抢二点球与落点时更占先机。', '门将参与二点球争夺'),

  // 辅助（10，全位置通用，占 2 格辅助技能槽，全部提供场上情境能力或纪律加成）
  sh_aux_penalty_calm: shopSkill('sh_aux_penalty_calm', '点球大心脏', 'any', 'auxiliary', 'decisions', '中', '常规点球与点球大战时更加沉稳，主罚与扑点均生效。', '常规点球 / 点球大战', 'auxiliary'),
  sh_aux_comeback: shopSkill('sh_aux_comeback', '逆风斗志', 'any', 'auxiliary', 'teamwork', '中', '球队落后时更冷静专注，提升镇定与决断表现。', '比分落后时', 'auxiliary'),
  sh_aux_hold_lead: shopSkill('sh_aux_hold_lead', '领先稳控', 'any', 'auxiliary', 'defPos', '中', '球队领先时防线注意力更集中，提升站位与预判。', '比分领先时', 'auxiliary'),
  sh_aux_late_surge: shopSkill('sh_aux_late_surge', '绝杀意志', 'any', 'auxiliary', 'endurance', '中', '比赛最后 15 分钟冲刺启动与心态更加稳健。', '第 75 分钟后', 'auxiliary'),
  sh_aux_fast_start: shopSkill('sh_aux_fast_start', '开场快热', 'any', 'auxiliary', 'anticipation', '低', '开场阶段迅速进入比赛节奏，提前预判与触球更顺。', '开场前 15 分钟', 'auxiliary'),
  sh_aux_super_sub: shopSkill('sh_aux_super_sub', '超级替补', 'any', 'auxiliary', 'agility', '中', '作为替补登场后爆发启动、心态与预判全面提振。', '替补登场后', 'auxiliary'),
  sh_aux_home_boost: shopSkill('sh_aux_home_boost', '主场之魂', 'any', 'auxiliary', 'vision', '低', '主场作战时更易阅读队友跑位，视野与配合提升。', '主场比赛时', 'auxiliary'),
  sh_aux_away_steel: shopSkill('sh_aux_away_steel', '客场冷血', 'any', 'auxiliary', 'firstTouch', '低', '客场面对嘘声依然冷静，第一脚触球与抗压更稳。', '客场比赛时', 'auxiliary'),
  sh_aux_tired_grit: shopSkill('sh_aux_tired_grit', '越战越勇', 'any', 'auxiliary', 'endurance', '中', '体能跌破七成后凭借意志稳住步法与防守站位。', '体力低于 70% 时', 'auxiliary'),
  sh_aux_discipline: shopSkill('sh_aux_discipline', '纪律严明', 'any', 'auxiliary', 'decisions', '低', '动作尺度拿捏老道，犯规后领黄牌与直红风险明显降低。', '犯规后吃牌判定', 'auxiliary'),
}

export const SHOP_SKILL_IDS = Object.keys(SHOP_SKILLS) as ShopSkillId[]
export const SHOP_OUTFIELD_SKILL_IDS = SHOP_SKILL_IDS.filter((id) => SHOP_SKILLS[id].category === 'main' && SHOP_SKILLS[id].scope === 'field')
export const SHOP_GK_SKILL_IDS = SHOP_SKILL_IDS.filter((id) => SHOP_SKILLS[id].category === 'main' && SHOP_SKILLS[id].scope === 'gk')
export const SHOP_AUX_NEW_SKILL_IDS = SHOP_SKILL_IDS.filter((id) => SHOP_SKILLS[id].category === 'auxiliary') as ShopAuxSkillId[]
/** 商店辅助金书轮换池（共 12 本：10 个场上/纪律辅助新技能 + 伤病预防/伤病韧性金书）。 */
export const SHOP_AUX_CATALOG_IDS: readonly ShopCatalogSkillId[] = [...SHOP_AUX_NEW_SKILL_IDS, 'injury_prevention', 'injury_resilience']
