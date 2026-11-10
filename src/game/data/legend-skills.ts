import type { AttrKey, LegendSkillId } from '../types.ts'

type SkillCost = '低' | '中' | '高'

export type LegendSkillFamily = 'growth' | 'iq' | 'move' | 'range' | 'recovery' | 'economy'
export type LegendSkillScope = 'field' | 'gk' | 'any'
export type LegendSkillRequirement = { attr: AttrKey; gold: number; rainbow: number }

export type LegendSkillDef = {
  id: LegendSkillId
  name: string
  desc: string
  condition: string
  cost: SkillCost
  family: LegendSkillFamily
  /** 掉落这本书的传奇队 id（与 legend-teams.ts 的 id 对应）。 */
  legendTeam: string
  requires: LegendSkillRequirement[]
  scope: LegendSkillScope
  /** 金档/彩档效果摘要，用于技能书 UI。 */
  effect: string
}

const skill = (
  id: LegendSkillId,
  name: string,
  family: LegendSkillFamily,
  legendTeam: string,
  cost: SkillCost,
  scope: LegendSkillScope,
  requires: LegendSkillRequirement[],
  desc: string,
  condition: string,
  effect: string,
): LegendSkillDef => ({ id, name, family, legendTeam, cost, scope, requires, desc, condition, effect })

export const LEGEND_SKILLS: Record<LegendSkillId, LegendSkillDef> = {
  lg_drill_master: skill('lg_drill_master', '训练狂人', 'growth', 'ajax-1994-95', '中', 'any', [{ attr: 'teamwork', gold: 9, rainbow: 13 }], '专项训练时，目标属性成长更多。', '完成一次专项训练', '专项训练成长 +12% / +17%'),
  lg_fast_learner: skill('lg_fast_learner', '悟性', 'growth', 'red-star-1990-91', '中', 'any', [{ attr: 'decisions', gold: 11, rainbow: 14 }], '培养时更容易出现大成功与完美成功。', '每次培养品质判定', '大成功/完美概率 +5pp / +7pp'),
  lg_physical_gift: skill('lg_physical_gift', '身体天赋', 'growth', 'lazio-1999-00', '中', 'field', [{ attr: 'strength', gold: 700, rainbow: 900 }, { attr: 'acceleration', gold: 700, rainbow: 900 }], '加速、速度、敏捷、力量的训练成长更高。', '培养身体类属性', '身体类成长 +20% / +28%'),
  lg_technical_gift: skill('lg_technical_gift', '技术天赋', 'growth', 'river-1996-97', '中', 'field', [{ attr: 'passing', gold: 700, rainbow: 900 }, { attr: 'dribbling', gold: 700, rainbow: 900 }], '传球、射门、盘带、停球的训练成长更高。', '培养技术类属性', '技术类成长 +20% / +28%'),
  lg_ceiling_break: skill('lg_ceiling_break', '上限突破', 'growth', 'bayern-1974-75', '高', 'field', [{ attr: 'strength', gold: 800, rainbow: 900 }, { attr: 'endurance', gold: 13, rainbow: 15 }], '把球员主属性上限往 1500 顶；已经顶格的球员无效。', '永久', '主属性上限 +200 / +280（最多 1500）'),
  lg_iron_constitution: skill('lg_iron_constitution', '钢铁体质', 'growth', 'chelsea-2004-05', '低', 'any', [{ attr: 'endurance', gold: 12, rainbow: 15 }], '每次上训练课消耗的训练体力更少。', '每次训练课', '训练体力消耗 -20% / -28%'),
  lg_recovery_pro: skill('lg_recovery_pro', '恢复专家', 'growth', 'psv-1987-88', '低', 'any', [{ attr: 'endurance', gold: 9, rainbow: 12 }], '休息时恢复更多训练体力。', '选择休息', '休息恢复 +30% / +42%'),
  lg_match_ready: skill('lg_match_ready', '比赛型', 'growth', 'juventus-1997-98', '中', 'any', [{ attr: 'anticipation', gold: 9, rainbow: 12 }], '交流赛/队内比赛的成长更高。', '参加交流赛或队内比赛', '比赛成长 +25% / +35%'),

  lg_vision_master: skill('lg_vision_master', '视野大师', 'iq', 'boca-2000-01', '中', 'any', [{ attr: 'vision', gold: 12, rainbow: 15 }], '更容易识别出向前的传球线路。', '识别传球线路', '视野有效值 +7 / +10'),
  lg_calm_mind: skill('lg_calm_mind', '冷静大脑', 'iq', 'marseille-1992-93', '中', 'any', [{ attr: 'decisions', gold: 12, rainbow: 15 }], '受压时选择动作更稳定。', '5 米内有人压迫时选择动作', '决策噪声 ×0.78 / ×0.69'),
  lg_opportunist: skill('lg_opportunist', '机会主义', 'iq', 'valencia-1999-00', '中', 'field', [{ attr: 'offBall', gold: 11, rainbow: 14 }], '更愿意把球送到最有威胁的射门位置。', '评估射门选项', '机会价值 ×1.35 / ×1.5'),
  lg_anticipate: skill('lg_anticipate', '提前预判', 'iq', 'milan-1988-89', '中', 'any', [{ attr: 'anticipation', gold: 11, rainbow: 14 }], '接球时的控制范围更大。', '接球', '接球半径 +1.2m / +1.7m'),
  lg_leader: skill('lg_leader', '逆风领袖', 'iq', 'man-utd-1998-99', '高', 'any', [{ attr: 'teamwork', gold: 13, rainbow: 15 }], '落后时让全队决策更稳定。', '比分落后', '全队决策 +4 / +6'),
  lg_game_management: skill('lg_game_management', '控场', 'iq', 'barcelona-2008-09', '中', 'any', [{ attr: 'decisions', gold: 10, rainbow: 13 }, { attr: 'passing', gold: 700, rainbow: 900 }], '领先时更擅长控制传球节奏。', '比分领先', '传球 a +3 / +4.2'),
  lg_clutch: skill('lg_clutch', '读秒专家', 'iq', 'juventus-1995-96', '高', 'field', [{ attr: 'shooting', gold: 700, rainbow: 900 }, { attr: 'composure', gold: 11, rainbow: 14 }], '比赛最后阶段射门更冷静。', '75 分钟后', '射门/镇定 +5 / +7'),
  lg_pass_vision: skill('lg_pass_vision', '直塞视野', 'iq', 'barcelona-2010-11', '高', 'any', [{ attr: 'passing', gold: 800, rainbow: 1000 }, { attr: 'vision', gold: 11, rainbow: 14 }], '直塞线路更准、更容易穿过防线。', '直塞', 'p0 +0.02、视野 +6 / +0.03、+8'),
  lg_off_ball_iq: skill('lg_off_ball_iq', '无球智商', 'iq', 'ajax-1971-72', '中', 'field', [{ attr: 'offBall', gold: 11, rainbow: 14 }, { attr: 'anticipation', gold: 11, rainbow: 14 }], '争顶、二点球和跑位选择更好。', '争顶 / 二点球 / 跑位', '无球 +6 / +8'),
  lg_set_piece_iq: skill('lg_set_piece_iq', '定位球大脑', 'iq', 'flamengo-1981-82', '中', 'field', [{ attr: 'passing', gold: 800, rainbow: 1000 }, { attr: 'composure', gold: 12, rainbow: 15 }], '任意球传中的落点更好。', '任意球传中', '传中质量 +0.06 / +0.084'),

  lg_rabona: skill('lg_rabona', '插花脚', 'move', 'porto-2003-04', '高', 'field', [{ attr: 'dribbling', gold: 800, rainbow: 1000 }, { attr: 'firstTouch', gold: 11, rainbow: 14 }], '用逆足起脚时取消逆足惩罚，并提高射正。', '用逆足起脚', '逆足惩罚取消、onTarget +0.02 / +0.028'),
  lg_bicycle: skill('lg_bicycle', '倒钩', 'move', 'real-madrid-2016-17', '高', 'field', [{ attr: 'heading', gold: 12, rainbow: 15 }, { attr: 'agility', gold: 12, rainbow: 15 }], '头球场景可以用倒钩处理，射正更高。', '头球场景', 'onTarget +0.04 / +0.056'),
  lg_diving_header: skill('lg_diving_header', '鱼跃冲顶', 'move', 'sampdoria-1990-91', '中', 'field', [{ attr: 'heading', gold: 13, rainbow: 15 }, { attr: 'strength', gold: 700, rainbow: 900 }], '鱼跃冲顶让头球更有威胁。', '头球', 'onTarget +0.05、goalGiven +0.03 / +0.07、+0.042'),
  lg_rainbow_flick: skill('lg_rainbow_flick', '彩虹过人', 'move', 'psg-2019-20', '高', 'field', [{ attr: 'dribbling', gold: 900, rainbow: 1100 }, { attr: 'agility', gold: 13, rainbow: 15 }], '边路盘带时用彩虹过人，成功后提升士气。', '边路盘带', '盘带 a +6 / +8；球迷 +0.4% / +0.56%'),
  lg_elastico: skill('lg_elastico', '牛尾巴', 'move', 'santos-1962-63', '高', 'field', [{ attr: 'dribbling', gold: 850, rainbow: 1050 }, { attr: 'firstTouch', gold: 12, rainbow: 15 }], '盘带失败率下限更高。', '盘带', '成功率下限 0.12→0.20 / 0.24'),
  lg_roulette: skill('lg_roulette', '马赛回旋', 'move', 'napoli-1989-90', '中', 'field', [{ attr: 'dribbling', gold: 800, rainbow: 1000 }, { attr: 'agility', gold: 12, rainbow: 15 }], '5 米内有防守者时用马赛回旋摆脱。', '5 米内有防守者', '盘带 a +6 / +8'),
  lg_low_drive: skill('lg_low_drive', '贴地斩', 'move', 'monaco-2003-04', '中', 'field', [{ attr: 'shooting', gold: 850, rainbow: 1050 }, { attr: 'composure', gold: 11, rainbow: 14 }], '禁区内低射更稳定。', '禁区内起脚', 'onTarget +0.03、goalGiven +0.02 / +0.042、+0.028'),
  lg_chip: skill('lg_chip', '挑射', 'move', 'barcelona-2014-15', '高', 'field', [{ attr: 'shooting', gold: 800, rainbow: 1000 }, { attr: 'composure', gold: 12, rainbow: 15 }], '门将离门较远时挑射。', '门将离门 >10m', 'goalGiven +0.12 / +0.17'),
  lg_knuckleball: skill('lg_knuckleball', '电梯球', 'move', 'man-utd-2007-08', '高', 'field', [{ attr: 'passing', gold: 800, rainbow: 1000 }, { attr: 'shooting', gold: 750, rainbow: 950 }], '直接任意球飘忽不定。', '直接任意球', 'onTarget +0.06、goalGiven +0.04 / +0.084、+0.056'),
  lg_trivela: skill('lg_trivela', '外脚背', 'move', 'aston-villa-1981-82', '中', 'field', [{ attr: 'passing', gold: 850, rainbow: 1050 }, { attr: 'firstTouch', gold: 11, rainbow: 14 }], '外脚背传中更准。', '传中', '传球 a +4、c +2 / +5.6、+2.8'),
  lg_slide_tackle: skill('lg_slide_tackle', '滑铲', 'move', 'inter-1964-65', '中', 'field', [{ attr: 'tackling', gold: 850, rainbow: 1050 }, { attr: 'speed', gold: 750, rainbow: 950 }], '滑铲提高抢断并降低犯规。', '抢断', '抢断 d +5、犯规 ×0.8 / +7、×0.72'),
  lg_goal_line_clearance: skill('lg_goal_line_clearance', '门线解围', 'move', 'inter-2009-10', '高', 'field', [{ attr: 'defPos', gold: 12, rainbow: 15 }, { attr: 'tackling', gold: 800, rainbow: 1000 }], '门线前封堵射门更有效。', '封堵射门', '封堵评分 +8 / +11.2'),
  lg_quick_throw: skill('lg_quick_throw', '手抛快攻', 'move', 'everton-1984-85', '中', 'gk', [{ attr: 'passing', gold: 800, rainbow: 1000 }, { attr: 'handling', gold: 700, rainbow: 900 }], '门将拿球后快速手抛发动进攻。', '门将持球 3 秒内出球', '传球 a +6 / +8'),
  lg_volley: skill('lg_volley', '凌空抽射', 'move', 'real-madrid-2001-02', '高', 'field', [{ attr: 'shooting', gold: 850, rainbow: 1050 }, { attr: 'firstTouch', gold: 12, rainbow: 15 }], '接传中或直塞后一脚凌空。', '接球后 1 步内射门', 'onTarget +0.05 / +0.07'),

  lg_super_long_shot: skill('lg_super_long_shot', '超级远射', 'range', 'benfica-1961-62', '高', 'field', [{ attr: 'shooting', gold: 900, rainbow: 1100 }, { attr: 'strength', gold: 850, rainbow: 1050 }], '把可选射门距离推得更远，并降低距离惩罚。', '远距离射门', '射程 56→66m / 70m；距离惩罚 ×0.65 / ×0.5'),
  lg_cannon_shot: skill('lg_cannon_shot', '炮弹球', 'range', 'real-madrid-1959-60', '高', 'field', [{ attr: 'strength', gold: 900, rainbow: 1100 }, { attr: 'acceleration', gold: 850, rainbow: 1050 }], '用身体力量压低门将评分。', '起脚', '门将评分 -4 / -6'),
  lg_rising_shot: skill('lg_rising_shot', '升龙炮', 'range', 'leverkusen-2001-02', '高', 'field', [{ attr: 'shooting', gold: 850, rainbow: 1050 }, { attr: 'strength', gold: 800, rainbow: 1000 }], '20 米外起脚时球路上扬。', '20m 外起脚', 'goalGiven +0.03 / +0.042'),
  lg_halfway_lob: skill('lg_halfway_lob', '半场吊射', 'range', 'roma-2000-01', '高', 'field', [{ attr: 'shooting', gold: 800, rainbow: 1000 }, { attr: 'anticipation', gold: 10, rainbow: 13 }], '门将离门超过 25 米时吊射。', '门将离门 >25m', 'goalGiven +0.25 / +0.35'),

  lg_goal_second_wind: skill('lg_goal_second_wind', '进球回气', 'recovery', 'milan-2006-07', '中', 'field', [{ attr: 'shooting', gold: 750, rainbow: 950 }, { attr: 'endurance', gold: 10, rainbow: 13 }], '进球后恢复比赛体力。', '进球', '体力 +8 / +11'),
  lg_assist_second_wind: skill('lg_assist_second_wind', '助攻回气', 'recovery', 'arsenal-2003-04', '中', 'field', [{ attr: 'endurance', gold: 9, rainbow: 12 }, { attr: 'teamwork', gold: 9, rainbow: 12 }], '送出助攻后恢复比赛体力。', '助攻', '体力 +6 / +8.4'),
  lg_tackle_second_wind: skill('lg_tackle_second_wind', '抢断回气', 'recovery', 'atletico-2013-14', '中', 'field', [{ attr: 'endurance', gold: 10, rainbow: 13 }, { attr: 'tackling', gold: 750, rainbow: 950 }], '成功抢断或拦截后恢复比赛体力。', '成功抢断 / 拦截', '体力 +1.5 / +2.1'),
  lg_save_second_wind: skill('lg_save_second_wind', '扑救回气', 'recovery', 'steaua-1985-86', '中', 'gk', [{ attr: 'endurance', gold: 9, rainbow: 12 }, { attr: 'reflexes', gold: 800, rainbow: 1000 }], '门将扑救后恢复比赛体力。', '扑住 / 扑出', '体力 +3 / +4.2'),
  lg_second_win: skill('lg_second_win', '第二春', 'recovery', 'liverpool-2004-05', '高', 'field', [{ attr: 'strength', gold: 700, rainbow: 900 }, { attr: 'endurance', gold: 12, rainbow: 15 }], '体力第一次低于 40% 时一次性恢复。', '体力首次低于 40%', '体力 +12 / +17'),
  lg_halftime_recovery: skill('lg_halftime_recovery', '中场补给', 'recovery', 'dortmund-1996-97', '低', 'any', [{ attr: 'endurance', gold: 9, rainbow: 12 }], '中场休息时额外恢复体力。', '中场休息', '体力 +8 / +11'),

  lg_marathon: skill('lg_marathon', '马拉松', 'economy', 'dynamo-kyiv-1985-86', '中', 'any', [{ attr: 'endurance', gold: 13, rainbow: 15 }], '全场跑动体力消耗降低。', '全场', '消耗 -8% / -11%'),
  lg_second_half_legs: skill('lg_second_half_legs', '下半场省力', 'economy', 'dortmund-2011-12', '中', 'any', [{ attr: 'endurance', gold: 11, rainbow: 14 }], '下半场体力消耗降低。', '下半场', '消耗 -15% / -21%'),
  lg_defensive_economy: skill('lg_defensive_economy', '防守省力', 'economy', 'milan-1993-94', '中', 'field', [{ attr: 'endurance', gold: 10, rainbow: 13 }, { attr: 'defPos', gold: 10, rainbow: 13 }], '回追防守时更省体力。', '回追防守', '消耗 -25% / -35%'),
  lg_off_ball_economy: skill('lg_off_ball_economy', '无球省力', 'economy', 'nottingham-forest-1979-80', '低', 'field', [{ attr: 'endurance', gold: 10, rainbow: 13 }, { attr: 'offBall', gold: 10, rainbow: 13 }], '无球跑位时更省体力。', '无球跑位', '消耗 -20% / -28%'),
  lg_press_machine: skill('lg_press_machine', '压迫机器', 'economy', 'liverpool-1983-84', '高', 'any', [{ attr: 'endurance', gold: 11, rainbow: 14 }, { attr: 'teamwork', gold: 11, rainbow: 14 }], '高位压迫更省体力，并提高压迫倾向。', '高位压迫', '消耗 -18% / -25%；pressBias +1'),
  lg_wing_engine: skill('lg_wing_engine', '边路快马', 'economy', 'bayern-2012-13', '中', 'field', [{ attr: 'endurance', gold: 10, rainbow: 13 }, { attr: 'speed', gold: 800, rainbow: 1000 }], '边路冲刺更省体力。', '边路冲刺', '消耗 -25% / -35%'),
  lg_gk_economy: skill('lg_gk_economy', '门将省力', 'economy', 'parma-1998-99', '中', 'gk', [{ attr: 'endurance', gold: 9, rainbow: 12 }, { attr: 'rushing', gold: 750, rainbow: 950 }], '门将跑动体力消耗更低。', '门将', '门将系数 0.50→0.42 / 0.36'),
  lg_stamina_regen: skill('lg_stamina_regen', '呼吸法', 'economy', 'celtic-1966-67', '低', 'any', [{ attr: 'anticipation', gold: 9, rainbow: 12 }, { attr: 'endurance', gold: 10, rainbow: 13 }], '站立或慢走时恢复更多体力。', '站立 / 慢走', '回复 0.020→0.035 / 0.049 每步'),
}

/** 队伍 id → 掉落技能；50 支队伍一一对应，无重复。 */
export const LEGEND_SKILL_DROPS: Record<string, LegendSkillId> = Object.fromEntries(
  Object.values(LEGEND_SKILLS).map((skill) => [skill.legendTeam, skill.id]),
)

export function legendSkillForTeam(teamId: string): LegendSkillDef | undefined {
  return LEGEND_SKILLS[LEGEND_SKILL_DROPS[teamId]]
}

export const LEGEND_SKILL_IDS = Object.keys(LEGEND_SKILLS) as LegendSkillId[]
export const MAX_BOOKS = 4
