import type { ElevenFormationId, FormationId, LegacyFormationId, Position, RoleId, Tactics } from '../types.ts'

export type FormationSlot = {
  id: string
  position: Position
  label: string
  x: number
  y: number
  defaultRole: RoleId
}

export type FormationDef = {
  id: FormationId
  label: string
  desc: string
  slots: FormationSlot[]
  defaultTactics: Tactics
  /** 旧 7 人制阵型：只读，不能再选。 */
  legacy?: true
}

const slot = (id: string, position: Position, label: string, x: number, y: number, defaultRole: RoleId): FormationSlot => ({ id, position, label, x, y, defaultRole })

/** 四后卫：两个边后卫（边路位置）+ 两个中卫。 */
const BACK_FOUR = [
  slot('gk', 'GK', '门将', 0.05, 0.5, 'gk_line'),
  slot('lb', 'W', '左后卫', 0.22, 0.1, 'w_back'),
  slot('cbl', 'CB', '左中卫', 0.19, 0.37, 'cb_cover'),
  slot('cbr', 'CB', '右中卫', 0.19, 0.63, 'cb_stopper'),
  slot('rb', 'W', '右后卫', 0.22, 0.9, 'w_back'),
]

const ELEVEN_FORMATIONS: Record<ElevenFormationId, FormationDef> = {
  '4-4-2': {
    id: '4-4-2',
    label: '4-4-2',
    desc: '四后卫 + 平行四中场 + 双前锋：攻守平衡、两条线紧凑，边路靠边前卫和边后卫配合，但中路人数容易被三中场压制。',
    slots: [
      ...BACK_FOUR,
      slot('lm', 'W', '左前卫', 0.47, 0.12, 'w_winger'),
      slot('cml', 'CM', '左中场', 0.42, 0.38, 'cm_organizer'),
      slot('cmr', 'CM', '右中场', 0.42, 0.62, 'cm_box2box'),
      slot('rm', 'W', '右前卫', 0.47, 0.88, 'w_support'),
      slot('stl', 'ST', '左前锋', 0.7, 0.4, 'st_runner'),
      slot('str', 'ST', '右前锋', 0.7, 0.6, 'st_target'),
    ],
    defaultTactics: { attack: 'balanced', passing: 'mixed', tempo: 'normal', line: 'mid', press: 'mid' },
  },
  '4-3-3': {
    id: '4-3-3',
    label: '4-3-3',
    desc: '四后卫 + 三中场 + 两翼齐飞：宽度和前场逼抢最好，单前锋需要边锋内切支援，后腰身后的空当怕被打反击。',
    slots: [
      ...BACK_FOUR,
      slot('cml', 'CM', '左中场', 0.44, 0.27, 'cm_box2box'),
      slot('cm', 'CM', '后腰', 0.35, 0.5, 'cm_destroyer'),
      slot('cmr', 'CM', '右中场', 0.44, 0.73, 'cm_organizer'),
      slot('lw', 'W', '左边锋', 0.64, 0.14, 'w_inside'),
      slot('st', 'ST', '中锋', 0.73, 0.5, 'st_finisher'),
      slot('rw', 'W', '右边锋', 0.64, 0.86, 'w_winger'),
    ],
    defaultTactics: { attack: 'wing', passing: 'mixed', tempo: 'normal', line: 'mid', press: 'high' },
  },
  '4-2-3-1': {
    id: '4-2-3-1',
    label: '4-2-3-1',
    desc: '双后腰保护防线，前腰和两个边路接应单前锋：防守最稳、中路组织好，但前锋容易孤立，进攻依赖前腰。',
    slots: [
      ...BACK_FOUR,
      slot('dml', 'CM', '左后腰', 0.35, 0.38, 'cm_destroyer'),
      slot('dmr', 'CM', '右后腰', 0.35, 0.62, 'cm_organizer'),
      slot('lw', 'W', '左边路', 0.56, 0.14, 'w_inside'),
      slot('am', 'CM', '前腰', 0.55, 0.5, 'cm_box2box'),
      slot('rw', 'W', '右边路', 0.56, 0.86, 'w_winger'),
      slot('st', 'ST', '中锋', 0.74, 0.5, 'st_target'),
    ],
    defaultTactics: { attack: 'middle', passing: 'short', tempo: 'normal', line: 'mid', press: 'mid' },
  },
  '3-5-2': {
    id: '3-5-2',
    label: '3-5-2',
    desc: '三中卫 + 两个边翼卫 + 三中场 + 双前锋：中路人数多、禁区里有两个终结点，但边翼卫来回跑，体能消耗大、身后易被打。',
    slots: [
      slot('gk', 'GK', '门将', 0.05, 0.5, 'gk_sweeper'),
      slot('cbl', 'CB', '左中卫', 0.2, 0.26, 'cb_stopper'),
      slot('cbc', 'CB', '中卫', 0.18, 0.5, 'cb_cover'),
      slot('cbr', 'CB', '右中卫', 0.2, 0.74, 'cb_ball'),
      slot('lwb', 'W', '左翼卫', 0.42, 0.08, 'w_support'),
      slot('cml', 'CM', '左中场', 0.45, 0.29, 'cm_box2box'),
      slot('cm', 'CM', '中场', 0.36, 0.5, 'cm_organizer'),
      slot('cmr', 'CM', '右中场', 0.45, 0.71, 'cm_destroyer'),
      slot('rwb', 'W', '右翼卫', 0.42, 0.92, 'w_support'),
      slot('stl', 'ST', '左前锋', 0.68, 0.4, 'st_runner'),
      slot('str', 'ST', '右前锋', 0.68, 0.6, 'st_finisher'),
    ],
    defaultTactics: { attack: 'middle', passing: 'mixed', tempo: 'normal', line: 'mid', press: 'mid' },
  },
  '5-3-2': {
    id: '5-3-2',
    label: '5-3-2',
    desc: '三中卫 + 两个回收的翼卫 + 三中场 + 双前锋：后场人数最多、最难被打穿，适合守住比分打反击，但边路推进慢、控球少。',
    slots: [
      slot('gk', 'GK', '门将', 0.05, 0.5, 'gk_line'),
      slot('lwb', 'W', '左翼卫', 0.27, 0.09, 'w_back'),
      slot('cbl', 'CB', '左中卫', 0.2, 0.28, 'cb_stopper'),
      slot('cbc', 'CB', '中卫', 0.16, 0.5, 'cb_cover'),
      slot('cbr', 'CB', '右中卫', 0.2, 0.72, 'cb_stopper'),
      slot('rwb', 'W', '右翼卫', 0.27, 0.91, 'w_back'),
      slot('cml', 'CM', '左中场', 0.44, 0.27, 'cm_box2box'),
      slot('cm', 'CM', '中场', 0.35, 0.5, 'cm_destroyer'),
      slot('cmr', 'CM', '右中场', 0.44, 0.73, 'cm_organizer'),
      slot('stl', 'ST', '左前锋', 0.68, 0.4, 'st_runner'),
      slot('str', 'ST', '右前锋', 0.68, 0.6, 'st_target'),
    ],
    defaultTactics: { attack: 'balanced', passing: 'direct', tempo: 'normal', line: 'low', press: 'mid' },
  },
  '4-1-4-1': {
    id: '4-1-4-1',
    label: '4-1-4-1',
    desc: '四后卫 + 单后腰 + 四名中场 + 单前锋：中场人多、压迫和控球好，后腰保护防线；进攻靠中场插上，单前锋容易孤立。',
    slots: [
      ...BACK_FOUR,
      slot('dm', 'CM', '后腰', 0.33, 0.5, 'cm_destroyer'),
      slot('lm', 'W', '左前卫', 0.48, 0.12, 'w_winger'),
      slot('cml', 'CM', '左中场', 0.46, 0.37, 'cm_box2box'),
      slot('cmr', 'CM', '右中场', 0.46, 0.63, 'cm_organizer'),
      slot('rm', 'W', '右前卫', 0.48, 0.88, 'w_support'),
      slot('st', 'ST', '中锋', 0.72, 0.5, 'st_target'),
    ],
    defaultTactics: { attack: 'balanced', passing: 'short', tempo: 'normal', line: 'mid', press: 'high' },
  },
  '3-4-3': {
    id: '3-4-3',
    label: '3-4-3',
    desc: '三中卫 + 两个翼卫两个中场 + 三前锋：前场人数最多、压迫凶，边路有翼卫和边锋双重冲击；中场只有两人，身后和两翼空当大。',
    slots: [
      slot('gk', 'GK', '门将', 0.05, 0.5, 'gk_sweeper'),
      slot('cbl', 'CB', '左中卫', 0.2, 0.26, 'cb_stopper'),
      slot('cbc', 'CB', '中卫', 0.18, 0.5, 'cb_cover'),
      slot('cbr', 'CB', '右中卫', 0.2, 0.74, 'cb_ball'),
      slot('lwb', 'W', '左翼卫', 0.42, 0.08, 'w_support'),
      slot('cml', 'CM', '左中场', 0.41, 0.38, 'cm_box2box'),
      slot('cmr', 'CM', '右中场', 0.41, 0.62, 'cm_organizer'),
      slot('rwb', 'W', '右翼卫', 0.42, 0.92, 'w_support'),
      slot('lw', 'W', '左边锋', 0.66, 0.16, 'w_inside'),
      slot('st', 'ST', '中锋', 0.74, 0.5, 'st_finisher'),
      slot('rw', 'W', '右边锋', 0.66, 0.84, 'w_winger'),
    ],
    defaultTactics: { attack: 'wing', passing: 'direct', tempo: 'fast', line: 'high', press: 'high' },
  },
  '4-1-2-1-2': {
    id: '4-1-2-1-2',
    label: '4-1-2-1-2',
    desc: '菱形中场：后腰 + 两个中场 + 前腰支援双前锋，中路配合多、禁区里两个终结点；没有边前卫，宽度全靠边后卫插上。',
    slots: [
      ...BACK_FOUR,
      slot('dm', 'CM', '后腰', 0.33, 0.5, 'cm_destroyer'),
      slot('cml', 'CM', '左中场', 0.44, 0.33, 'cm_box2box'),
      slot('cmr', 'CM', '右中场', 0.44, 0.67, 'cm_organizer'),
      slot('am', 'CM', '前腰', 0.56, 0.5, 'cm_organizer'),
      slot('stl', 'ST', '左前锋', 0.71, 0.4, 'st_runner'),
      slot('str', 'ST', '右前锋', 0.71, 0.6, 'st_finisher'),
    ],
    defaultTactics: { attack: 'middle', passing: 'short', tempo: 'normal', line: 'mid', press: 'mid' },
  },
}

/**
 * 旧的 7 人制阵型。只为读取迁移前的存档、回放和进行中的旧比赛保留，界面和接口都不能再选，
 * `validateLineup` 会拒绝它们；`elevenFormationFor` 给出迁移时对应的 11 人制阵型。
 */
const LEGACY_FORMATIONS: Record<LegacyFormationId, FormationDef> = {
  '1-2-3-1': {
    id: '1-2-3-1',
    label: '1-2-3-1',
    desc: '2 中卫 + 1 中场 + 2 边路 + 1 前锋：宽度好、接应点多，但边路同时前插会暴露中卫。',
    slots: [
      { id: 'gk', position: 'GK', label: '门将', x: 0.05, y: 0.5, defaultRole: 'gk_line' },
      { id: 'cbl', position: 'CB', label: '左中卫', x: 0.22, y: 0.34, defaultRole: 'cb_cover' },
      { id: 'cbr', position: 'CB', label: '右中卫', x: 0.22, y: 0.66, defaultRole: 'cb_stopper' },
      { id: 'cm', position: 'CM', label: '中场', x: 0.4, y: 0.5, defaultRole: 'cm_organizer' },
      { id: 'wl', position: 'W', label: '左边路', x: 0.58, y: 0.16, defaultRole: 'w_winger' },
      { id: 'wr', position: 'W', label: '右边路', x: 0.58, y: 0.84, defaultRole: 'w_support' },
      { id: 'st', position: 'ST', label: '前锋', x: 0.73, y: 0.5, defaultRole: 'st_finisher' },
    ],
    legacy: true,
    defaultTactics: { attack: 'balanced', passing: 'mixed', tempo: 'normal', line: 'mid', press: 'mid' },
  },
  '1-3-2-1': {
    id: '1-3-2-1',
    label: '1-3-2-1',
    desc: '3 中卫 + 2 中场 + 1 前锋：后场覆盖稳，适合防守转换，但前锋可能孤立、宽度不足。',
    slots: [
      { id: 'gk', position: 'GK', label: '门将', x: 0.05, y: 0.5, defaultRole: 'gk_sweeper' },
      { id: 'cbl', position: 'CB', label: '左中卫', x: 0.2, y: 0.26, defaultRole: 'cb_stopper' },
      { id: 'cbc', position: 'CB', label: '中卫', x: 0.19, y: 0.5, defaultRole: 'cb_cover' },
      { id: 'cbr', position: 'CB', label: '右中卫', x: 0.2, y: 0.74, defaultRole: 'cb_stopper' },
      { id: 'cml', position: 'CM', label: '左中场', x: 0.42, y: 0.35, defaultRole: 'cm_box2box' },
      { id: 'cmr', position: 'CM', label: '右中场', x: 0.42, y: 0.65, defaultRole: 'cm_organizer' },
      { id: 'st', position: 'ST', label: '前锋', x: 0.68, y: 0.5, defaultRole: 'st_target' },
    ],
    legacy: true,
    defaultTactics: { attack: 'middle', passing: 'mixed', tempo: 'normal', line: 'mid', press: 'mid' },
  },
  '1-2-2-2': {
    id: '1-2-2-2',
    label: '1-2-2-2',
    desc: '2 中卫 + 2 中场 + 2 前锋：禁区内终结点多，可支点搭档，但中场容易被压制、边路保护薄。',
    slots: [
      { id: 'gk', position: 'GK', label: '门将', x: 0.05, y: 0.5, defaultRole: 'gk_line' },
      { id: 'cbl', position: 'CB', label: '左中卫', x: 0.22, y: 0.35, defaultRole: 'cb_stopper' },
      { id: 'cbr', position: 'CB', label: '右中卫', x: 0.22, y: 0.65, defaultRole: 'cb_cover' },
      { id: 'cml', position: 'CM', label: '左中场', x: 0.42, y: 0.35, defaultRole: 'cm_organizer' },
      { id: 'cmr', position: 'CM', label: '右中场', x: 0.42, y: 0.65, defaultRole: 'cm_destroyer' },
      { id: 'stl', position: 'ST', label: '左前锋', x: 0.66, y: 0.36, defaultRole: 'st_runner' },
      { id: 'str', position: 'ST', label: '右前锋', x: 0.66, y: 0.64, defaultRole: 'st_target' },
    ],
    legacy: true,
    defaultTactics: { attack: 'balanced', passing: 'direct', tempo: 'normal', line: 'mid', press: 'mid' },
  },
}

export const FORMATIONS: Record<FormationId, FormationDef> = { ...ELEVEN_FORMATIONS, ...LEGACY_FORMATIONS }

/** 能选的阵型（11 人制）。 */
export const FORMATION_LIST: FormationDef[] = Object.values(ELEVEN_FORMATIONS)

/** 默认阵型。 */
export const DEFAULT_FORMATION: ElevenFormationId = '4-4-2'

export function isLegacyFormation(id: string): id is LegacyFormationId {
  return Object.hasOwn(LEGACY_FORMATIONS, id)
}

/** 旧 7 人制阵型迁移到哪个 11 人制阵型：两中卫配三中场 → 4-3-3，三中卫 → 3-5-2，双前锋 → 4-4-2。 */
const LEGACY_TO_ELEVEN: Record<LegacyFormationId, ElevenFormationId> = { '1-2-3-1': '4-3-3', '1-3-2-1': '3-5-2', '1-2-2-2': '4-4-2' }

export function elevenFormationFor(id: string): ElevenFormationId {
  if (Object.hasOwn(ELEVEN_FORMATIONS, id)) return id as ElevenFormationId
  return LEGACY_TO_ELEVEN[id as LegacyFormationId] ?? DEFAULT_FORMATION
}


export const TACTIC_LABELS = {
  attack: { label: '进攻方向', options: { middle: '中路', wing: '边路', balanced: '均衡' } },
  passing: { label: '传递', options: { short: '短传', mixed: '混合', direct: '直传' } },
  tempo: { label: '节奏', options: { slow: '稳健', normal: '正常', fast: '快速' } },
  line: { label: '防线', options: { low: '低', mid: '中', high: '高' } },
  press: { label: '压迫', options: { low: '低', mid: '中', high: '高' } },
} as const
