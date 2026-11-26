import type { SkillDef } from './skills.ts'
import type { StarTrait } from './star-traits.ts'
import type { TsubasaSkillId } from '../types.ts'

export type TsubasaTraitId =
  | 'ct_trait_wakabayashi'
  | 'ct_trait_soda'
  | 'ct_trait_jito'
  | 'ct_trait_ishizaki'
  | 'ct_trait_matsuyama'
  | 'ct_trait_misugi'
  | 'ct_trait_tsubasa'
  | 'ct_trait_misaki'
  | 'ct_trait_aoi'
  | 'ct_trait_hyuga'
  | 'ct_trait_nitta'
  | 'ct_trait_wakashimazu'
  | 'ct_trait_sawada'
  | 'ct_trait_izawa'
  | 'ct_trait_kisugi'
  | 'ct_trait_taki'

export type TsubasaSkillDef = SkillDef & {
  id: TsubasaSkillId
  scope: 'field' | 'gk'
  /** 拥有此唯一技能的角色英文名（与 CAPTAIN_TSUBASA_ALL_STARS 一致）。 */
  ownerEnName: string
  /** 角色唯一专属技能：不掉书、不入商店、不跨队友传授。 */
  exclusive: true
}

export type TsubasaLoadout = {
  traitId: TsubasaTraitId
  skillId: TsubasaSkillId
}

/**
 * 《足球小将》全明星 16 名角色的唯一专属特性（不与 500 名真实球星特性及 20 项通用特性重名）。
 * 按原著人设与经典梗设计，直接接入比赛结算引擎。
 */
export const TSUBASA_TRAITS: Record<TsubasaTraitId, StarTrait> = {
  // 若林源三 — S.G.G.K 名台词「禁区外一律不进」
  ct_trait_wakabayashi: { name: '禁区外必杀封锁', when: 'any', kind: 'save', scope: 'longRange', goal: 12 },
  // 早田诚 — 边路死盯对手王牌的「王牌杀手」
  ct_trait_soda: { name: '王牌杀手', when: 'wide', kind: 'defend', success: 11 },
  // 次藤洋 — 九州铁塔般的恐怖身体对抗
  ct_trait_jito: { name: '九州巨岩', when: 'ownHalf', kind: 'attr', attr: 'strength', chance: 65, bonus: 580 },
  // 石崎了 — 拼命三郎永不倒下的意志
  ct_trait_ishizaki: { name: '颜面铁壁', when: 'any', kind: 'secondWind', stamina: 48 },
  // 松山光 — 富良野雪原炼就的铁血队长逆境斗魂
  ct_trait_matsuyama: { name: '北国雪原之魂', when: 'behind', kind: 'aura', attr: 'tackling', bonus: 90 },
  // 三杉淳 — 球场贵公子：体力充沛时如绝世天才般统筹全队
  ct_trait_misugi: { name: '球场贵公子', when: 'fresh', kind: 'aura', attr: 'passing', bonus: 95 },
  // 大空翼 — 「足球是朋友」：球感天赋放大自身全部必杀技威力
  ct_trait_tsubasa: { name: '足球是朋友', when: 'any', kind: 'skillBoost', pct: 60 },
  // 岬太郎 — 黄金搭档：与核心无缝衔接的致命直塞
  ct_trait_misaki: { name: '黄金搭档', when: 'any', kind: 'pass', scope: 'through', success: 13 },
  // 葵新伍 — 意甲历练的无尽奔跑「太阳王子」
  ct_trait_aoi: { name: '太阳王子', when: 'any', kind: 'stamina', drain: 40 },
  // 日向小次郎 — 猛虎斗志：越进球越狂暴的锋线猛兽
  ct_trait_hyuga: { name: '猛虎斗志', when: 'any', kind: 'hotStreak', bonus: 260 },
  // 新田瞬 — 闪电前插反越位的「疾风猎鹰」
  ct_trait_nitta: { name: '疾风猎鹰', when: 'any', kind: 'onside', chance: 42 },
  // 若岛津健 — 空手道武门：近距离反应极快的门线格斗家
  ct_trait_wakashimazu: { name: '空手道武门', when: 'any', kind: 'save', scope: 'inBox', goal: 9 },
  // 泽田武 — 东邦中场节拍器与锋线润滑剂
  ct_trait_sawada: { name: '东邦润滑剂', when: 'any', kind: 'pass', scope: 'short', success: 11 },
  // 井泽守 — 修哲中场空战指挥官
  ct_trait_izawa: { name: '修哲指挥官', when: 'aerial', kind: 'attr', attr: 'strength', chance: 70, bonus: 550 },
  // 来生哲兵 — 修哲锋线灵巧单刀杀手
  ct_trait_kisugi: { name: '修哲门前嗅觉', when: 'any', kind: 'shot', scope: 'oneOnOne', onTarget: 11, goal: 7 },
  // 泷一 — 贴着边线高速突破传中的边线魔术师
  ct_trait_taki: { name: '边线魔术师', when: 'any', kind: 'pass', scope: 'cross', success: 12 },
}

/**
 * 《足球小将》全明星 16 名角色的唯一专属彩虹绝技（每人一项，全游唯一）。
 * 绝不掉落技能书、不进入商店、不被队友学习或继承。
 */
export const TSUBASA_SKILLS: Record<TsubasaSkillId, TsubasaSkillDef> = {
  ct_sggk: {
    id: 'ct_sggk',
    name: '超级天才门将',
    desc: '若林源三唯一绝技：S.G.G.K 极致门线反应与铁腕控球，任何射门都稳如磐石。',
    condition: '门将在位面对射门 / 抱球',
    cost: '高',
    scope: 'gk',
    ownerEnName: 'Genzo Wakabayashi',
    exclusive: true,
  },
  ct_razor_shot: {
    id: 'ct_razor_shot',
    name: '剃刀射门',
    desc: '早田诚唯一绝技：急速外旋的剃刀传中与小角度拐弯射门，防不胜防。',
    condition: '边路传中 / 偏侧小角度射门',
    cost: '高',
    scope: 'field',
    ownerEnName: 'Makoto Soda',
    exclusive: true,
  },
  ct_power_tackle: {
    id: 'ct_power_tackle',
    name: '重装冲撞',
    desc: '次藤洋唯一绝技：巨岩般的身体冲撞抢断、禁区封堵与强力制空。',
    condition: '防守抢断 / 本方半场封堵 / 争顶',
    cost: '高',
    scope: 'field',
    ownerEnName: 'Hiroshi Jito',
    exclusive: true,
  },
  ct_face_block: {
    id: 'ct_face_block',
    name: '颜面封堵',
    desc: '石崎了唯一绝技：奋不顾身的经典脸部挡球与本方半场死拼二点球。',
    condition: '封堵射门 / 本方半场二点球',
    cost: '高',
    scope: 'field',
    ownerEnName: 'Ryo Ishizaki',
    exclusive: true,
  },
  ct_eagle_shot: {
    id: 'ct_eagle_shot',
    name: '荒鹰射门',
    desc: '松山光唯一绝技：贴地疾飞的精准长传调度与势大力沉的荒鹰远射。',
    condition: '长传 / 禁区外远射',
    cost: '高',
    scope: 'field',
    ownerEnName: 'Hikaru Matsuyama',
    exclusive: true,
  },
  ct_offside_trap: {
    id: 'ct_offside_trap',
    name: '越位陷阱指挥',
    desc: '三杉淳唯一绝技：华丽洞察全局的拦截防守、防区护球与优雅空战终结。',
    condition: '防守拦截抢断 / 本方半场二点球 / 头球攻门',
    cost: '高',
    scope: 'field',
    ownerEnName: 'Jun Misugi',
    exclusive: true,
  },
  ct_drive_shot: {
    id: 'ct_drive_shot',
    name: '曲线射门',
    desc: '大空翼唯一绝技：从高空急坠入网的招牌抽球射门，兼顾中路大师级调度。',
    condition: '禁区外起脚 / 中路传球',
    cost: '高',
    scope: 'field',
    ownerEnName: 'Tsubasa Ozora',
    exclusive: true,
  },
  ct_boomerang_pass: {
    id: 'ct_boomerang_pass',
    name: '回旋镖传球',
    desc: '岬太郎唯一绝技：如回旋镖般精准绕开防线的直塞、前场短传与传中配合。',
    condition: '直塞 / 前场短传 / 传中',
    cost: '高',
    scope: 'field',
    ownerEnName: 'Taro Misaki',
    exclusive: true,
  },
  ct_chokkaku_feint: {
    id: 'ct_chokkaku_feint',
    name: '直角假动作',
    desc: '葵新伍唯一绝技：高速九十度变向过人，突破下限极高且积极边路回追。',
    condition: '盘带突破 / 边路回追防守',
    cost: '高',
    scope: 'field',
    ownerEnName: 'Shingo Aoi',
    exclusive: true,
  },
  ct_tiger_shot: {
    id: 'ct_tiger_shot',
    name: '猛虎射门',
    desc: '日向小次郎唯一绝技：贯穿球网的霸道重炮，强力压制门将扑救并极大提升终结。',
    condition: '起脚射门（非头球 / 点球）',
    cost: '高',
    scope: 'field',
    ownerEnName: 'Kojiro Hyuga',
    exclusive: true,
  },
  ct_falcon_shot: {
    id: 'ct_falcon_shot',
    name: '疾风隼射门',
    desc: '新田瞬唯一绝技：高速前插接应直塞与不停球迅猛隼射终结。',
    condition: '禁区内起脚 / 接应直塞',
    cost: '高',
    scope: 'field',
    ownerEnName: 'Shun Nitta',
    exclusive: true,
  },
  ct_triangle_jump: {
    id: 'ct_triangle_jump',
    name: '三角跳跃',
    desc: '若岛津健唯一绝技：脚蹬门柱飞跃扑救单刀近射，并强势制霸禁区高空球。',
    condition: '面对单刀或近射 / 门将高球争顶',
    cost: '高',
    scope: 'gk',
    ownerEnName: 'Ken Wakashimazu',
    exclusive: true,
  },
  ct_toho_link: {
    id: 'ct_toho_link',
    name: '东邦连携',
    desc: '泽田武唯一绝技：细腻流畅的东邦短传渗透与高压下的冷静护球摆脱。',
    condition: '短传 / 受压出球与盘带',
    cost: '高',
    scope: 'field',
    ownerEnName: 'Takeshi Sawada',
    exclusive: true,
  },
  ct_aerial_command: {
    id: 'ct_aerial_command',
    name: '高空调度',
    desc: '井泽守唯一绝技：制霸高空球争顶与中路精准预判拦截。',
    condition: '高空争顶 / 中路拦截传球',
    cost: '高',
    scope: 'field',
    ownerEnName: 'Mamoru Izawa',
    exclusive: true,
  },
  ct_silver_poacher: {
    id: 'ct_silver_poacher',
    name: '修哲抢点',
    desc: '来生哲兵唯一绝技：鬼魅跑位抢占前场二点球并在禁区内果断破门。',
    condition: '禁区内起脚 / 前场二点球争抢',
    cost: '高',
    scope: 'field',
    ownerEnName: 'Teppei Kisugi',
    exclusive: true,
  },
  ct_sideline_dribble: {
    id: 'ct_sideline_dribble',
    name: '边线突击',
    desc: '泷一唯一绝技：紧贴边线疾驰过人并送出高质量传中。',
    condition: '边路盘带 / 边路传中',
    cost: '高',
    scope: 'field',
    ownerEnName: 'Hajime Taki',
    exclusive: true,
  },
}

/** 16 名《足球小将》角色的英文名 → 唯一特性与唯一彩虹技能映射。 */
export const TSUBASA_LOADOUT: Readonly<Record<string, TsubasaLoadout>> = {
  'Genzo Wakabayashi': { traitId: 'ct_trait_wakabayashi', skillId: 'ct_sggk' },
  'Makoto Soda': { traitId: 'ct_trait_soda', skillId: 'ct_razor_shot' },
  'Hiroshi Jito': { traitId: 'ct_trait_jito', skillId: 'ct_power_tackle' },
  'Ryo Ishizaki': { traitId: 'ct_trait_ishizaki', skillId: 'ct_face_block' },
  'Hikaru Matsuyama': { traitId: 'ct_trait_matsuyama', skillId: 'ct_eagle_shot' },
  'Jun Misugi': { traitId: 'ct_trait_misugi', skillId: 'ct_offside_trap' },
  'Tsubasa Ozora': { traitId: 'ct_trait_tsubasa', skillId: 'ct_drive_shot' },
  'Taro Misaki': { traitId: 'ct_trait_misaki', skillId: 'ct_boomerang_pass' },
  'Shingo Aoi': { traitId: 'ct_trait_aoi', skillId: 'ct_chokkaku_feint' },
  'Kojiro Hyuga': { traitId: 'ct_trait_hyuga', skillId: 'ct_tiger_shot' },
  'Shun Nitta': { traitId: 'ct_trait_nitta', skillId: 'ct_falcon_shot' },
  'Ken Wakashimazu': { traitId: 'ct_trait_wakashimazu', skillId: 'ct_triangle_jump' },
  'Takeshi Sawada': { traitId: 'ct_trait_sawada', skillId: 'ct_toho_link' },
  'Mamoru Izawa': { traitId: 'ct_trait_izawa', skillId: 'ct_aerial_command' },
  'Teppei Kisugi': { traitId: 'ct_trait_kisugi', skillId: 'ct_silver_poacher' },
  'Hajime Taki': { traitId: 'ct_trait_taki', skillId: 'ct_sideline_dribble' },
}

export function tsubasaLoadoutFor(enName?: string): TsubasaLoadout | undefined {
  return enName ? TSUBASA_LOADOUT[enName] : undefined
}

/** 角色唯一专属技能：不掉落技能书、不跨球员学习、不进入商店。 */
export function isExclusiveSkill(id: string): id is TsubasaSkillId {
  return Object.hasOwn(TSUBASA_SKILLS, id)
}
