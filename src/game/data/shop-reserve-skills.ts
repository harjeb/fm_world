import type { AttrKey, ShopReserveAuxSkillId, ShopReserveMainSkillId, SkillId } from '../types.ts'
import { isMainAttr } from '../scale.ts'
import type { ShopSkillDef, ShopSkillGroup, ShopSkillScope } from './shop-skills.ts'

export type ShopReserveSkillId = ShopReserveMainSkillId | ShopReserveAuxSkillId

const MAIN_THRESHOLDS = { silver: 600, gold: 750, rainbow: 900 } as const
const HIDDEN_THRESHOLDS = { silver: 8, gold: 11, rainbow: 14 } as const

function reserveSkill(
  id: ShopReserveSkillId,
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

/**
 * S4+ 赛季商店备用池（共 60 本：40 外场 + 10 门将 + 10 辅助）：
 * - 偏战术/阵型/体型/体能对策型，极少万能书，构建清晰克制关系；
 * - 内部呈「强少弱多」分布（12 本核心强对策 + 21 本实用对策 + 27 本窄场景/轻度对策），
 *   但商店前端不标稀有度，只标「首发 / 返场」，由玩家根据对手战术自行研判挑选。
 */
export const SHOP_RESERVE_SKILLS: Record<ShopReserveSkillId, ShopSkillDef> = {
  // ========================= 防线对策（10） =========================
  sh_r_anti_wing_wall: reserveSkill('sh_r_anti_wing_wall', '锁翼铁闸', 'field', 'defense', 'tackling', '高', '专克双翼齐飞：对阵边路打法时，防盘带、拦截传中与禁区防空全面压制。', '对手主打边路（防盘带 / 拦截传中 / 防守争顶）'),
  sh_r_anti_counter_anchor: reserveSkill('sh_r_anti_counter_anchor', '反击制动阀', 'field', 'defense', 'anticipation', '高', '专克快节奏防反：对阵快攻/反击球队时，本方半场拦截与抢断极稳且大幅降低吃牌风险。', '对手主打快节奏/防反（本方半场防守与吃牌判定）'),
  sh_r_anti_long_radar: reserveSkill('sh_r_anti_long_radar', '防空雷达', 'field', 'defense', 'heading', '中', '专克长传冲吊：对阵直接长传球队时，拦截长传与高空解围能力大幅提升。', '对手主打直接长传（拦截长传 / 防守争顶）'),
  sh_r_anti_twin_strikers: reserveSkill('sh_r_anti_twin_strikers', '双锋联防', 'field', 'defense', 'defPos', '中', '专克双前锋阵型：对阵双前锋/多前锋时，本方禁区附近防盘带与封堵射门更硬。', '对手场上 ≥ 2 名 ST（禁区附近防盘带 / 封堵）'),
  sh_r_anti_short_trap: reserveSkill('sh_r_anti_short_trap', '短传断网', 'field', 'defense', 'anticipation', '中', '专克传控渗透：对阵短传打法时，中后场拦截短传与直塞线路更加精准。', '对手主打短传（拦截短传 / 直塞）'),
  sh_r_anti_tall_lowblock: reserveSkill('sh_r_anti_tall_lowblock', '下盘切球', 'field', 'defense', 'agility', '低', '面对身材高大的持球手时，靠低重心卡位与精准下脚提升抢断成功率。', '防守身高 ≥ 186cm 的对手盘带'),
  sh_r_anti_press_clearance: reserveSkill('sh_r_anti_press_clearance', '高压解围手', 'field', 'defense', 'passing', '低', '面对高压逼抢时，在本方半场果断长传把球送到前场空当。', '对手高位逼抢且在本方半场长传'),
  sh_r_anti_middle_block: reserveSkill('sh_r_anti_middle_block', '中路封枪', 'field', 'defense', 'defPos', '低', '面对中路渗透球队时，在弧顶附近封堵对手禁区外远射更果断。', '对手主打中路（封堵禁区外射门）'),
  sh_r_anti_late_siege: reserveSkill('sh_r_anti_late_siege', '读秒堵枪眼', 'field', 'defense', 'composure', '低', '领先进入比赛尾声被围攻时，门前封堵射门格外拼命。', '比分领先且第 75 分钟后封堵射门'),
  sh_r_anti_direct_cover: reserveSkill('sh_r_anti_direct_cover', '落点清扫', 'field', 'defense', 'anticipation', '低', '对阵直接长传球队时，本方半场争抢第一落点后的二点球更主动。', '对手主打直接长传（本方半场二点球）'),

  // ========================= 中场对策（10） =========================
  sh_r_press_breaker: reserveSkill('sh_r_press_breaker', '破逼抢大师', 'field', 'midfield', 'composure', '高', '专克高压逼抢：对阵高压迫/反抢球队时，受压出球与盘带摆脱如履平地。', '对手高位逼抢（受压传球 / 受压盘带）'),
  sh_r_bus_key: reserveSkill('sh_r_bus_key', '破大巴钥匙', 'field', 'midfield', 'vision', '高', '专克低位铁桶阵：对阵低位防线时，前场渗透传球更致命且弧顶远射极具杀伤。', '对手低位防线（前场短传直塞 / 禁区外远射）'),
  sh_r_highline_launcher: reserveSkill('sh_r_highline_launcher', '身后制导炮', 'field', 'midfield', 'passing', '中', '专克高位防线：对阵压上的高防线时，直塞与长传精准打穿防线身后。', '对手高位防线（直塞 / 长传）'),
  sh_r_anti_tiki_hound: reserveSkill('sh_r_anti_tiki_hound', '传控绞肉机', 'field', 'midfield', 'tackling', '中', '专克短传控球：对阵短传球队时，中路贴身扫荡与切断短传线路极具压迫力。', '对手主打短传（中路防盘带 / 拦截短传）'),
  sh_r_anti_mid3_control: reserveSkill('sh_r_anti_mid3_control', '三中场克星', 'field', 'midfield', 'decisions', '中', '专克强中场阵型：对阵三中场及以上阵型时，中路短传配合与二点控制占优。', '对手场上 ≥ 3 名 CM（中路短传 / 二点球）'),
  sh_r_anti_lowpress_tempo: reserveSkill('sh_r_anti_lowpress_tempo', '从容节拍器', 'field', 'midfield', 'passing', '中', '专克退守观望：对手不主动逼抢时，在中场从容完成大范围长传调度与直塞。', '对手低逼抢/退守（长传 / 直塞）'),
  sh_r_anti_counter_foul: reserveSkill('sh_r_anti_counter_foul', '战术急刹', 'field', 'midfield', 'tackling', '低', '对阵快攻/防反球队时，中路拦截盘带更稳且动作干净、不易送危险任意球。', '对手主打快节奏/防反（中路防盘带）'),
  sh_r_anti_wing_switch: reserveSkill('sh_r_anti_wing_switch', '弱侧偷袭', 'field', 'midfield', 'vision', '低', '对阵边路倾轧的对手时，顺势把球从中路快速分向对手防守薄弱的另一侧。', '对手主打边路（中路向边路传球）'),
  sh_r_anti_tired_mid: reserveSkill('sh_r_anti_tired_mid', '残血收割机', 'field', 'midfield', 'dribbling', '低', '对手高强度消耗至体能见底后，在中路持球推进与短传掌控节奏更轻松。', '对手全队平均体力 < 65%（中路盘带 / 短传）'),
  sh_r_anti_tall_weave: reserveSkill('sh_r_anti_tall_weave', '穿针小陀螺', 'field', 'midfield', 'agility', '低', '面对身材高大的防守者时，利用小步频变向完成贴身摆脱。', '面对身高 ≥ 186cm 防守者盘带'),

  // ========================= 边路对策（10） =========================
  sh_r_anti_3back_flank: reserveSkill('sh_r_anti_3back_flank', '三中卫拆解者', 'field', 'wing', 'dribbling', '高', '专克三中卫/五后卫：精准打击翼卫身后空当，边路突破与传中极具统治力。', '对手场上 ≥ 3 名 CB（边路盘带 / 传中）'),
  sh_r_anti_highline_sprint: reserveSkill('sh_r_anti_highline_sprint', '反越位飞翼', 'field', 'wing', 'speed', '高', '专克高位防线：高速冲击高位防线边肋空当，边路突破、接应直塞与内切终结全面爆发。', '对手高位防线（边路盘带 / 接直塞长传 / 偏侧射门）'),
  sh_r_anti_lowblock_cross: reserveSkill('sh_r_anti_lowblock_cross', '铁桶高空弧线', 'field', 'wing', 'passing', '中', '专克低位防线：面对禁区密防时，边路精准传中绕过人群直找高点。', '对手低位防线（边路传中）'),
  sh_r_anti_press_escape_wing: reserveSkill('sh_r_anti_press_escape_wing', '边路脱压王', 'field', 'wing', 'dribbling', '中', '专克高压逼抢：在边路遭遇多人围抢时仍能从容摆脱并安全出球。', '对手高位逼抢（边路受压盘带 / 短传）'),
  sh_r_anti_wing_duel: reserveSkill('sh_r_anti_wing_duel', '边路猎手', 'field', 'wing', 'tackling', '中', '专克双翼齐飞：在边路一对一防守与二点球争夺中锁死对手边锋。', '对手主打边路（边路防盘带 / 二点球）'),
  sh_r_anti_middle_wide: reserveSkill('sh_r_anti_middle_wide', '拉开宽度', 'field', 'wing', 'dribbling', '低', '对阵收缩中路的对手时，利用边路开阔空间顺畅推进。', '对手主打中路（边路盘带）'),
  sh_r_anti_tall_wing: reserveSkill('sh_r_anti_tall_wing', '灵巧变向', 'field', 'wing', 'agility', '低', '在边路面对高大边卫时，凭急停变向提升过人成功率。', '面对身高 ≥ 186cm 防守者边路盘带'),
  sh_r_anti_short_cutback: reserveSkill('sh_r_anti_short_cutback', '反击倒三角', 'field', 'wing', 'passing', '低', '对阵短传压上的对手时，边路前插后向中路回敲更加精准。', '对手主打短传（前场边路向中路传球）'),
  sh_r_anti_lowpress_cutin: reserveSkill('sh_r_anti_lowpress_cutin', '空当兜射', 'field', 'wing', 'shooting', '低', '对手退守不前压时，在肋部中距离从容内切兜射提高射正率。', '对手低逼抢/退守（肋部 14–24 米起脚）'),
  sh_r_anti_counter_track: reserveSkill('sh_r_anti_counter_track', '回追封边', 'field', 'wing', 'speed', '低', '面对快攻/防反球队时，边路回防一对一卡位更稳健。', '对手主打快节奏/防反（边路防盘带）'),

  // ========================= 锋线对策（10） =========================
  sh_r_highline_assassin: reserveSkill('sh_r_highline_assassin', '高位线屠夫', 'field', 'forward', 'acceleration', '高', '专克高位防线：反越位接应身后直塞极准，形成单刀/空位时终结一剑封喉。', '对手高位防线（接应直塞 / 单刀与禁区空位射门）'),
  sh_r_bus_breaker_cannon: reserveSkill('sh_r_bus_breaker_cannon', '破大巴重炮', 'field', 'forward', 'shooting', '高', '专克低位铁桶阵：面对禁区密集人墙时，外围重炮射正、破门与压制门将全面爆发。', '对手低位防线（禁区外远射）'),
  sh_r_bus_siege_header: reserveSkill('sh_r_bus_siege_header', '铁桶攻城锤', 'field', 'forward', 'heading', '中', '专克低位防线：面对摆大巴时化身禁区高塔，强吃争顶并大幅提升头球破门威胁。', '对手低位防线（进攻争顶 / 头球攻门）'),
  sh_r_anti_sweeper_gk: reserveSkill('sh_r_anti_sweeper_gk', '清道夫噩梦', 'field', 'forward', 'composure', '中', '专克出击型门将：面对喜欢压出禁区的清道夫门将时，射门判断老辣、大幅压低门将发挥。', '对手门将为出击型（常规射门 / 单刀）'),
  sh_r_anti_press_poacher: reserveSkill('sh_r_anti_press_poacher', '高压反杀者', 'field', 'forward', 'offBall', '中', '专克高压逼抢：对手大举压上时嗅觉敏锐，前场二点球抢点与禁区内冷射极具威胁。', '对手高位逼抢（前场二点球 / 禁区内射门）'),
  sh_r_giant_bully: reserveSkill('sh_r_giant_bully', '制空碾压', 'field', 'forward', 'strength', '中', '专克矮小防线：身高明显压制贴身防守者时，争顶统治力与头球转化率大幅提高。', '比最近防守者高 ≥ 8cm（进攻争顶 / 头球攻门）'),
  sh_r_anti_3back_poacher: reserveSkill('sh_r_anti_3back_poacher', '肋部插刀', 'field', 'forward', 'shooting', '低', '对阵三中卫/五后卫时，从边中卫结合部小角度起脚更具威胁。', '对手场上 ≥ 3 名 CB（小角度 < 36° 起脚）'),
  sh_r_anti_lowpress_link: reserveSkill('sh_r_anti_lowpress_link', '支点策应', 'field', 'forward', 'strength', '低', '对手低位退守时，在前场背身拿球衔接队友传球更稳健。', '对手低逼抢/退守（前场接应传球）'),
  sh_r_anti_tired_finisher: reserveSkill('sh_r_anti_tired_finisher', '体能收割枪', 'field', 'forward', 'composure', '低', '对手防线体能见底后，抓住松懈在禁区内冷静完成致命一击。', '对手全队平均体力 < 65%（禁区内射门）'),
  sh_r_small_agile_shot: reserveSkill('sh_r_small_agile_shot', '矮脚虎穿裆', 'field', 'forward', 'agility', '低', '面对高大中卫贴身干扰时，靠灵活转身在禁区内抢出射门角度。', '比最近防守者矮 ≥ 8cm（禁区内受压起脚）'),

  // ========================= 门将对策（10） =========================
  sh_r_gk_anti_wing_boss: reserveSkill('sh_r_gk_anti_wing_boss', '传中流噩梦', 'gk', 'gk', 'handling', '高', '专克双翼齐飞：对阵边路传中球队时，高空球摘取、头球扑救与稳健抱球统治小禁区。', '对手主打边路（高空争顶 / 头球扑救 / 抱球）'),
  sh_r_gk_anti_counter_wall: reserveSkill('sh_r_gk_anti_counter_wall', '反击叹息墙', 'gk', 'gk', 'oneOnOne', '高', '专克快节奏防反：面对快攻打穿防线形成的单刀与禁区空位时，神勇封堵并果断出击抢二点。', '对手主打快节奏/防反（单刀空位扑救 / 二点球）'),
  sh_r_gk_anti_press_kick: reserveSkill('sh_r_gk_anti_press_kick', '越线长传手', 'gk', 'gk', 'passing', '中', '专克高压逼抢：对手高位围抢后场时，一脚精准长传直接打穿逼抢线发动反击。', '对手高位逼抢（门将长传 / 短传）'),
  sh_r_gk_anti_lowblock_long: reserveSkill('sh_r_gk_anti_lowblock_long', '远射吸星手', 'gk', 'gk', 'reflexes', '中', '专克中路/远射流：对阵中路渗透或退守反击对手时，封杀禁区外远射并稳稳抱死。', '对手主打中路或低逼抢（禁区外远射扑救 / 抱球）'),
  sh_r_gk_anti_twin_box: reserveSkill('sh_r_gk_anti_twin_box', '双锋封门神', 'gk', 'gk', 'reflexes', '中', '专克双前锋阵型：面对双前锋禁区连线近射时，门线反应格外迅捷。', '对手场上 ≥ 2 名 ST（12 米内近射扑救）'),
  sh_r_gk_anti_direct_sweep: reserveSkill('sh_r_gk_anti_direct_sweep', '长传清道夫', 'gk', 'gk', 'rushing', '低', '对阵直接长传球队时，主动出击化解长传高空落点与二点球。', '对手主打直接长传（门将高空球 / 二点球）'),
  sh_r_gk_anti_short_box: reserveSkill('sh_r_gk_anti_short_box', '近角守门员', 'gk', 'gk', 'composure', '低', '对阵短传渗透球队时，面对禁区内小配合起脚站位稳健。', '对手主打短传（禁区内常规射门扑救）'),
  sh_r_gk_anti_highline_launch: reserveSkill('sh_r_gk_anti_highline_launch', '反击手抛弹', 'gk', 'gk', 'passing', '低', '对阵高位防线时，门将长传出球精准寻找前锋冲刺路线。', '对手高位防线（门将长传）'),
  sh_r_gk_anti_tired_catch: reserveSkill('sh_r_gk_anti_tired_catch', '稳抱残球', 'gk', 'gk', 'handling', '低', '比赛最后 15 分钟对手体能下降后，扑救后直接抱死不给补射机会。', '第 75 分钟后门将抱球'),
  sh_r_gk_anti_lead_calm: reserveSkill('sh_r_gk_anti_lead_calm', '守成门锁', 'gk', 'gk', 'composure', '低', '球队比分领先时心态平稳，常规扑救更加稳健。', '比分领先时门将扑救'),

  // ========================= 辅助对策（10，占辅助槽、全位置通用） =========================
  sh_aux_r_anti_press_aura: reserveSkill('sh_aux_r_anti_press_aura', '反压迫指挥', 'any', 'auxiliary', 'composure', '高', '专克高压逼抢（全队光环）：对阵高压迫球队时，鼓舞全队沉着停球处理，且自身跑动更省体。', '对手高位逼抢（全队光环 + 自身省体）', 'auxiliary'),
  sh_aux_r_anti_bus_vision: reserveSkill('sh_aux_r_anti_bus_vision', '破密防直觉', 'any', 'auxiliary', 'vision', '高', '专克低位铁桶阵：面对密集防守时洞察细微空当，视野、决断与无球跑位全面飙升。', '对手低位防线时', 'auxiliary'),
  sh_aux_r_anti_highline_pace: reserveSkill('sh_aux_r_anti_highline_pace', '反越位警觉', 'any', 'auxiliary', 'offBall', '中', '专克高位防线：对阵高防线时提前捕捉造越位间隙，加速与无球跑位明显增强。', '对手高位防线时', 'auxiliary'),
  sh_aux_r_anti_fast_read: reserveSkill('sh_aux_r_anti_fast_read', '快攻预判', 'any', 'auxiliary', 'anticipation', '中', '专克快节奏防反：对阵反击球队时提前落位，预判与防守站位大幅提高。', '对手主打快节奏/防反时', 'auxiliary'),
  sh_aux_r_anti_short_press: reserveSkill('sh_aux_r_anti_short_press', '传控压迫感', 'any', 'auxiliary', 'anticipation', '中', '专克短传控球：面对倒脚传控球队时上抢预判精准，抢断与预判明显增强。', '对手主打短传时', 'auxiliary'),
  sh_aux_r_anti_wing_shift: reserveSkill('sh_aux_r_anti_wing_shift', '边路协防意识', 'any', 'auxiliary', 'defPos', '中', '专克双翼齐飞：对阵边路进攻球队时横移补位迅速，防守站位与加速提升。', '对手主打边路时', 'auxiliary'),
  sh_aux_r_anti_direct_body: reserveSkill('sh_aux_r_anti_direct_body', '防空卡位', 'any', 'auxiliary', 'heading', '低', '对阵直接长传球队时，高空争抢时的力量与头球表现更稳。', '对手主打直接长传时', 'auxiliary'),
  sh_aux_r_anti_lowpress_calm: reserveSkill('sh_aux_r_anti_lowpress_calm', '阵地耐心', 'any', 'auxiliary', 'decisions', '低', '面对退守观望的对手时保持耐心，视野与镇定提升。', '对手低逼抢/退守时', 'auxiliary'),
  sh_aux_r_anti_mid3_grit: reserveSkill('sh_aux_r_anti_mid3_grit', '硬抗中场海', 'any', 'auxiliary', 'teamwork', '低', '面对三中场及以上强中场阵型时，团队协作与敏捷小幅提升。', '对手场上 ≥ 3 名 CM 时', 'auxiliary'),
  sh_aux_r_anti_tired_surge: reserveSkill('sh_aux_r_anti_tired_surge', '趁虚而入', 'any', 'auxiliary', 'offBall', '低', '对手全队体能跌破 65% 后，加快冲击频率，加速与无球跑位提升。', '对手全队平均体力 < 65% 时', 'auxiliary'),
}

export const SHOP_RESERVE_SKILL_IDS = Object.keys(SHOP_RESERVE_SKILLS) as ShopReserveSkillId[]
export const SHOP_RESERVE_OUTFIELD_SKILL_IDS = SHOP_RESERVE_SKILL_IDS.filter((id) => SHOP_RESERVE_SKILLS[id].category === 'main' && SHOP_RESERVE_SKILLS[id].scope === 'field')
export const SHOP_RESERVE_GK_SKILL_IDS = SHOP_RESERVE_SKILL_IDS.filter((id) => SHOP_RESERVE_SKILLS[id].category === 'main' && SHOP_RESERVE_SKILLS[id].scope === 'gk')
export const SHOP_RESERVE_AUX_SKILL_IDS = SHOP_RESERVE_SKILL_IDS.filter((id) => SHOP_RESERVE_SKILLS[id].category === 'auxiliary') as ShopReserveAuxSkillId[]

const num = (value: number) => String(Math.round(value * 10) / 10)

/** 60 本备用池技能书的效果说明（与 match/tactical-counters.ts 结算数值严格一一对应）。 */
export const SHOP_RESERVE_SKILL_EFFECTS: Record<ShopReserveSkillId, (m: number) => string> = {
  sh_r_anti_wing_wall: (m) => `对阵边路打法对手：防盘带 +${num(7.5 * m)}，拦截传中 +${num(7.5 * m)}，防守争顶 +${num(6 * m)}。`,
  sh_r_anti_counter_anchor: (m) => `对阵快节奏/防反对手：本方半场防盘带 +${num(7.5 * m)}，拦截直塞/长传 +${num(8 * m)}，吃牌风险 -${num(30 * m)}%。`,
  sh_r_anti_long_radar: (m) => `对阵直接长传对手：拦截长传 +${num(7 * m)}，防守高空争顶 +${num(6.5 * m)}。`,
  sh_r_anti_twin_strikers: (m) => `对阵双前锋阵型（≥2 ST）：本方禁区附近防盘带 +${num(6.5 * m)}，封堵射门 +${num(6.5 * m)}。`,
  sh_r_anti_short_trap: (m) => `对阵短传打法对手：拦截短传与直塞 +${num(6.5 * m)}。`,
  sh_r_anti_tall_lowblock: (m) => `防守身高 ≥ 186cm 的对手盘带：防守评分 +${num(4.5 * m)}。`,
  sh_r_anti_press_clearance: (m) => `对阵高位逼抢对手：本方半场长传出球 +${num(4.5 * m)}。`,
  sh_r_anti_middle_block: (m) => `对阵中路打法对手：封堵禁区外远射 +${num(5 * m)}。`,
  sh_r_anti_late_siege: (m) => `比分领先且第 75 分钟后：封堵射门 +${num(5.5 * m)}。`,
  sh_r_anti_direct_cover: (m) => `对阵直接长传对手：本方半场争抢二点球 +${num(4.5 * m)}。`,

  sh_r_press_breaker: (m) => `对阵高位逼抢对手：受压短传/长传 +${num(8 * m)}，受压盘带摆脱 +${num(7.5 * m)}。`,
  sh_r_bus_key: (m) => `对阵低位防线对手：前场短传与直塞 +${num(7.5 * m)}；禁区外远射射正 +${num(5 * m)}%，进球 +${num(4 * m)}%。`,
  sh_r_highline_launcher: (m) => `对阵高位防线对手：直塞与长传评分 +${num(7 * m)}。`,
  sh_r_anti_tiki_hound: (m) => `对阵短传打法对手：中路防盘带 +${num(6.5 * m)}，拦截短传 +${num(6 * m)}。`,
  sh_r_anti_mid3_control: (m) => `对阵三中场及以上阵型（≥3 CM）：中路短传 +${num(5.5 * m)}，争抢二点球 +${num(6 * m)}。`,
  sh_r_anti_lowpress_tempo: (m) => `对阵低逼抢/退守对手：长传调度与直塞 +${num(6.5 * m)}。`,
  sh_r_anti_counter_foul: (m) => `对阵快节奏/防反对手：中路防盘带 +${num(4.5 * m)}，盘带犯规占比 -${num(15 * m)}%。`,
  sh_r_anti_wing_switch: (m) => `对阵边路打法对手：中路向边路转移传球 +${num(4.5 * m)}。`,
  sh_r_anti_tired_mid: (m) => `对手全队平均体力 < 65%：中路盘带与短传各 +${num(4.5 * m)}。`,
  sh_r_anti_tall_weave: (m) => `面对身高 ≥ 186cm 防守者：盘带评分 +${num(4.5 * m)}。`,

  sh_r_anti_3back_flank: (m) => `对阵三中卫/五后卫阵型（≥3 CB）：边路盘带 +${num(8 * m)}，边路传中 +${num(7.5 * m)}。`,
  sh_r_anti_highline_sprint: (m) => `对阵高位防线对手：边路盘带 +${num(7.5 * m)}，接应直塞/长传 +${num(7 * m)}，偏侧起脚进球 +${num(4 * m)}%。`,
  sh_r_anti_lowblock_cross: (m) => `对阵低位防线对手：边路传中 +${num(7 * m)}。`,
  sh_r_anti_press_escape_wing: (m) => `对阵高位逼抢对手：边路受压盘带 +${num(6.5 * m)}，边路受压短传 +${num(5.5 * m)}。`,
  sh_r_anti_wing_duel: (m) => `对阵边路打法对手：边路防盘带 +${num(6.5 * m)}，边路二点球争抢 +${num(5 * m)}。`,
  sh_r_anti_middle_wide: (m) => `对阵中路打法对手：边路盘带 +${num(4.5 * m)}。`,
  sh_r_anti_tall_wing: (m) => `面对身高 ≥ 186cm 防守者：边路盘带 +${num(4.5 * m)}。`,
  sh_r_anti_short_cutback: (m) => `对阵短传打法对手：前场边路向中路回敲 +${num(5 * m)}。`,
  sh_r_anti_lowpress_cutin: (m) => `对阵低逼抢/退守对手：肋部 14–24 米起脚射正 +${num(3.5 * m)}%。`,
  sh_r_anti_counter_track: (m) => `对阵快节奏/防反对手：边路防盘带 +${num(4 * m)}。`,

  sh_r_highline_assassin: (m) => `对阵高位防线对手：接应直塞 +${num(7 * m)}；单刀或禁区空位射正 +${num(6 * m)}%，进球 +${num(5.5 * m)}%。`,
  sh_r_bus_breaker_cannon: (m) => `对阵低位防线对手：禁区外远射射正 +${num(6 * m)}%，进球 +${num(5 * m)}%，压低门将评分 -${num(4.5 * m)}。`,
  sh_r_bus_siege_header: (m) => `对阵低位防线对手：进攻争顶 +${num(7 * m)}；头球攻门射正 +${num(4.5 * m)}%，进球 +${num(3.5 * m)}%。`,
  sh_r_anti_sweeper_gk: (m) => `面对出击型门将：起脚射门压低门将评分 -${num(5.5 * m)}；单刀进球 +${num(3.5 * m)}%。`,
  sh_r_anti_press_poacher: (m) => `对阵高位逼抢对手：前场二点球争抢 +${num(6.5 * m)}；禁区内起脚进球 +${num(3.5 * m)}%。`,
  sh_r_giant_bully: (m) => `比最近防守者高 ≥ 8cm：进攻争顶 +${num(6.5 * m)}；头球攻门进球 +${num(3.5 * m)}%。`,
  sh_r_anti_3back_poacher: (m) => `对阵三中卫/五后卫阵型（≥3 CB）：小角度（< 36°）射正 +${num(4 * m)}%，进球 +${num(2.5 * m)}%。`,
  sh_r_anti_lowpress_link: (m) => `对阵低逼抢/退守对手：前场接应队友传球 +${num(4.5 * m)}。`,
  sh_r_anti_tired_finisher: (m) => `对手全队平均体力 < 65%：禁区内起脚进球 +${num(3.5 * m)}%。`,
  sh_r_small_agile_shot: (m) => `比最近防守者矮 ≥ 8cm：禁区内受压起脚射正 +${num(3.5 * m)}%。`,

  sh_r_gk_anti_wing_boss: (m) => `对阵边路打法对手：门将高空争顶 +${num(8 * m)}，头球扑救 +${num(8 * m)}，抱球率 +${num(10 * m)}%。`,
  sh_r_gk_anti_counter_wall: (m) => `对阵快节奏/防反对手：门将在位面对单刀/禁区空位扑救 +${num(8.5 * m)}，二点球出击 +${num(6.5 * m)}。`,
  sh_r_gk_anti_press_kick: (m) => `对阵高位逼抢对手：门将长传出球 +${num(7.5 * m)}，短传出球 +${num(5.5 * m)}。`,
  sh_r_gk_anti_lowblock_long: (m) => `对阵中路打法或低逼抢对手：门将面对禁区外远射扑救 +${num(7.5 * m)}，抱球率 +${num(8 * m)}%。`,
  sh_r_gk_anti_twin_box: (m) => `对阵双前锋阵型（≥2 ST）：门将面对 12 米内近射扑救 +${num(7 * m)}。`,
  sh_r_gk_anti_direct_sweep: (m) => `对阵直接长传对手：门将高空争顶与二点球争抢各 +${num(5 * m)}。`,
  sh_r_gk_anti_short_box: (m) => `对阵短传打法对手：门将面对禁区内射门扑救 +${num(4.5 * m)}。`,
  sh_r_gk_anti_highline_launch: (m) => `对阵高位防线对手：门将长传发动 +${num(5 * m)}。`,
  sh_r_gk_anti_tired_catch: (m) => `第 75 分钟后：门将扑救抱球率 +${num(7 * m)}%。`,
  sh_r_gk_anti_lead_calm: (m) => `比分领先时：门将在位扑救评分 +${num(4 * m)}。`,

  sh_aux_r_anti_press_aura: (m) => `对阵高位逼抢对手（全队光环）：全队镇定与第一脚触球各 +${num(4.5 * m)}，自身跑动耗体 -${num(12 * m)}%。`,
  sh_aux_r_anti_bus_vision: (m) => `对阵低位防线对手：视野、决断与无球跑位有效评分各 +${num(7.5 * m)}。`,
  sh_aux_r_anti_highline_pace: (m) => `对阵高位防线对手：加速与无球跑位有效评分各 +${num(6.5 * m)}。`,
  sh_aux_r_anti_fast_read: (m) => `对阵快节奏/防反对手：预判与防守站位有效评分各 +${num(6.5 * m)}。`,
  sh_aux_r_anti_short_press: (m) => `对阵短传打法对手：抢断与预判有效评分各 +${num(6 * m)}。`,
  sh_aux_r_anti_wing_shift: (m) => `对阵边路打法对手：防守站位与加速有效评分各 +${num(6 * m)}。`,
  sh_aux_r_anti_direct_body: (m) => `对阵直接长传对手：力量与头球有效评分各 +${num(4.5 * m)}。`,
  sh_aux_r_anti_lowpress_calm: (m) => `对阵低逼抢/退守对手：视野与镇定有效评分各 +${num(4.5 * m)}。`,
  sh_aux_r_anti_mid3_grit: (m) => `对阵三中场及以上阵型（≥3 CM）：团队合作与敏捷有效评分各 +${num(4.5 * m)}。`,
  sh_aux_r_anti_tired_surge: (m) => `对手全队平均体力 < 65%：加速与无球跑位有效评分各 +${num(5 * m)}。`,
} as Record<SkillId, (m: number) => string> as Record<ShopReserveSkillId, (m: number) => string>
