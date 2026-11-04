import type { AttrKey, Attributes } from '../types.ts'
import { GK_ATTRIBUTES } from '../types.ts'
import { attrRating, attrStorage } from '../scale.ts'

/**
 * 球员属性上限的映射层。
 *
 * 借鉴 Football Manager 的「画像」思路——每个球员在不同维度上相对强弱不同，
 * 因此成长上限也不同——但不搬运任何 FM 数值表。本作属性为 0-1500（主）/0-20（隐藏），
 * FM 为 1-20 整数评分，两者通过本文件换算。
 */

/** 0-1 的相对权重，1 表示该维度是该球员的招牌。 */
export type AttrProfile = Partial<Record<AttrKey, number>>

/**
 * FM 属性名 → 本作属性键。只声明维度对应关系，用于把外部数据转成画像；
 * 未列出的 FM 属性（如 Bravery、Leadership、Flair）本作没有对应维度，直接忽略。
 * 数值本身不搬运：调用方传入的是 FM 的 1-20 评分。
 */
export const FM_ATTRIBUTE_MAP: Record<string, AttrKey> = {
  // 技术
  Passing: 'passing',
  Crossing: 'passing',
  Corners: 'passing',
  FreeKickTaking: 'passing',
  LongThrows: 'passing',
  Technique: 'firstTouch',
  FirstTouch: 'firstTouch',
  Dribbling: 'dribbling',
  Finishing: 'shooting',
  LongShots: 'shooting',
  Tackling: 'tackling',
  Marking: 'defPos',
  Heading: 'heading',
  PenaltyTaking: 'composure',
  // 精神
  Vision: 'vision',
  Decisions: 'decisions',
  Concentration: 'decisions',
  OffTheBall: 'offBall',
  Positioning: 'defPos',
  Anticipation: 'anticipation',
  Composure: 'composure',
  Teamwork: 'teamwork',
  WorkRate: 'teamwork',
  // 身体
  Acceleration: 'acceleration',
  Pace: 'speed',
  Agility: 'agility',
  Balance: 'agility',
  Strength: 'strength',
  Stamina: 'endurance',
  NaturalFitness: 'endurance',
  // 门将
  Reflexes: 'reflexes',
  Handling: 'handling',
  CommandOfArea: 'rushing',
  RushingOut: 'rushing',
  OneOnOnes: 'oneOnOne',
  Kicking: 'passing',
}

/**
 * FM 导出的表头在不同界面语言/不同视图下写法不一致，这里统一成可比较的形式：
 * 去掉空格、下划线、连字符、点号并转小写。中文表头原样保留。
 */
export function normalizeFmHeader(header: string): string {
  return header.replace(/[\s_\-.]/g, '').toLowerCase()
}

/**
 * 表头别名。包含 FM 英文全名、FM 球员列表里的短名，以及中文版 FM 的表头。
 * 键必须已通过 normalizeFmHeader 处理。
 */
export const FM_HEADER_ALIASES: Record<string, AttrKey> = {
  // 英文全名（已归一化）
  passing: 'passing', crossing: 'passing', corners: 'passing', freekicktaking: 'passing', longthrows: 'passing', kicking: 'passing',
  technique: 'firstTouch', firsttouch: 'firstTouch',
  dribbling: 'dribbling', finishing: 'shooting', longshots: 'shooting',
  tackling: 'tackling', marking: 'defPos', positioning: 'defPos', heading: 'heading',
  penaltytaking: 'composure', composure: 'composure',
  vision: 'vision', decisions: 'decisions', concentration: 'decisions',
  offtheball: 'offBall', anticipation: 'anticipation', teamwork: 'teamwork', workrate: 'teamwork',
  acceleration: 'acceleration', pace: 'speed', agility: 'agility', balance: 'agility',
  strength: 'strength', stamina: 'endurance', naturalfitness: 'endurance',
  reflexes: 'reflexes', handling: 'handling', commandofarea: 'rushing', rushingout: 'rushing',
  oneonones: 'oneOnOne',
  // FM 列表里的短名
  pas: 'passing', cro: 'passing', cor: 'passing', fre: 'passing', lth: 'passing', kic: 'passing',
  tec: 'firstTouch', fir: 'firstTouch', dri: 'dribbling', fin: 'shooting', lon: 'shooting',
  tck: 'tackling', mar: 'defPos', pos: 'defPos', hea: 'heading', pen: 'composure', cmp: 'composure',
  vis: 'vision', dec: 'decisions', cnt: 'decisions', otb: 'offBall', ant: 'anticipation',
  tea: 'teamwork', wor: 'teamwork', acc: 'acceleration', pac: 'speed', agi: 'agility', bal: 'agility',
  str: 'strength', sta: 'endurance', nat: 'endurance',
  ref: 'reflexes', han: 'handling', cmd: 'rushing', rus: 'rushing', one: 'oneOnOne',
  // 中文版 FM 表头
  传球: 'passing', 传中: 'passing', 角球: 'passing', 任意球: 'passing', 界外球: 'passing', 球门球: 'passing',
  技术: 'firstTouch', 停球: 'firstTouch', 盘带: 'dribbling', 射门: 'shooting', 远射: 'shooting',
  抢断: 'tackling', 盯人: 'defPos', 防守站位: 'defPos', 头球: 'heading', 点球: 'composure', 镇定: 'composure',
  视野: 'vision', 决断: 'decisions', 集中: 'decisions', 无球跑动: 'offBall', 预判: 'anticipation',
  团队合作: 'teamwork', 工作投入: 'teamwork', 爆发力: 'acceleration', 速度: 'speed', 灵活: 'agility', 平衡: 'agility',
  强壮: 'strength', 耐力: 'endurance', 体质: 'endurance',
  反应: 'reflexes', 手控球: 'handling', 指挥防守: 'rushing', 出击: 'rushing', 一对一: 'oneOnOne',
}

/** FM_ATTRIBUTE_MAP 的归一化索引，兼容直接传入完整属性名的调用方。 */
const NORMALIZED_FM_MAP: Record<string, AttrKey> = Object.fromEntries(
  Object.entries(FM_ATTRIBUTE_MAP).map(([name, key]) => [normalizeFmHeader(name), key]),
)

/**
 * 查询表头对应的本作属性；识别不了返回 undefined。
 *
 * 先按整串查，再按 `_` / `/` 切段从右往左逐段查——数据库导出用的是
 * `技术_传球_passing` 这种「中文分类_中文名_英文原名」的拼装表头，
 * 只有最后一段能和 FM 原始字段名对上。
 */
export function fmAttrKey(header: string): AttrKey | undefined {
  const lookup = (candidate: string): AttrKey | undefined => {
    const normalized = normalizeFmHeader(candidate)
    return FM_HEADER_ALIASES[normalized] ?? NORMALIZED_FM_MAP[normalized]
  }
  const direct = lookup(header)
  if (direct) return direct
  const segments = header.split(/[_/|]/).filter(segment => segment.trim() !== '')
  for (let i = segments.length - 1; i >= 0; i--) {
    const hit = lookup(segments[i])
    if (hit) return hit
  }
  return undefined
}

/** 上限计算的默认权重：未给出画像的维度按此处理。 */
export const DEFAULT_PROFILE_WEIGHT = 0.3

/** 每项属性都至少有的成长空间（0-100 评分点）。 */
const BASE_ROOM = 7.0
/** 画像权重带来的额外成长空间。 */
const PROFILE_ROOM = 6.0
/** 每级星级带来的额外成长空间。 */
const TIER_ROOM = 1.6

/** 单次随机扰动的幅度，与旧生成器保持一致。 */
export const CEILING_JITTER = 4

/** 画像权重 + 星级决定的成长空间（不含随机扰动）。 */
export function ceilingRoom(weight: number | undefined, tier: number): number {
  const w = Number.isFinite(weight) && (weight as number) > 0 ? (weight as number) : DEFAULT_PROFILE_WEIGHT
  const t = Number.isFinite(tier) ? Math.max(1, Math.min(5, tier)) : 3
  return BASE_ROOM + PROFILE_ROOM * w + TIER_ROOM * t
}

const clampRating = (value: number): number => Math.max(1, Math.min(99, Math.round(value * 10) / 10))

/**
 * FM 的 1-20 评分 → 0-1 权重。
 * 用 0.8 次幂让高分之间的差距比低分之间更明显，符合「招牌属性才配顶格」的直觉。
 */
export function fmRatingToWeight(rating: number): number {
  if (!Number.isFinite(rating)) return DEFAULT_PROFILE_WEIGHT
  const normalized = (Math.max(1, Math.min(20, rating)) - 1) / 19
  return Math.pow(normalized, 0.8)
}

/** 把一组原始权重归一化到 0-1，便于不同来源（风格、外部数据）共用同一套上限公式。 */
export function profileFromWeights(weights: Partial<Record<AttrKey, number>>): AttrProfile {
  const entries = Object.entries(weights) as [AttrKey, number][]
  const values = entries.map(([, value]) => (Number.isFinite(value) && value > 0 ? value : 0))
  const max = Math.max(...values)
  if (!(max > 0)) return {}
  return Object.fromEntries(entries.map(([key], index) => [key, values[index] / max])) as AttrProfile
}

/**
 * FM 属性评分表 → 画像。同一本作属性被多个 FM 属性命中时取较高值，
 * 因为「会传球」不应被「传中」的低分拉低。
 */
export function profileFromFm(ratings: Partial<Record<string, number>>): AttrProfile {
  const merged: Partial<Record<AttrKey, number>> = {}
  for (const [fmName, rating] of Object.entries(ratings)) {
    const key = fmAttrKey(fmName)
    if (!key) continue
    const weight = fmRatingToWeight(rating ?? 0)
    if (!(key in merged) || weight > (merged[key] ?? 0)) merged[key] = weight
  }
  return profileFromWeights(merged)
}

export type CeilingOptions = {
  /** 星级 1-5，决定整体成长空间。 */
  tier: number
  /** 门将只使用 4 项门将属性，外场不使用。 */
  isGk: boolean
  /** 同一球员必须稳定，传入确定性的随机源。 */
  jitter?: () => number
}

/**
 * 由当前属性与画像算出每项属性的上限（存档单位）。
 *
 * 核心：tier 决定「多强」，画像决定「强在哪」。画像高的维度上限更高，
 * 因此两名同星级球员的成长方向与终值都不一样，而不是全员 1500。
 */
export function ceilingsFromProfile(current: Attributes, profile: AttrProfile, options: CeilingOptions): Attributes {
  const { tier, isGk, jitter } = options
  const ceilings = {} as Attributes
  for (const key of Object.keys(current) as AttrKey[]) {
    // 外场球员的门将属性不适用，直接置 0，且不消耗随机源（否则会改变后续生成的顺序）。
    if (!isGk && (GK_ATTRIBUTES as readonly string[]).includes(key)) {
      ceilings[key] = 0
      continue
    }
    const rating = attrRating(key, current[key], isGk)
    const room = ceilingRoom(profile[key], tier) + (jitter ? jitter() * CEILING_JITTER : CEILING_JITTER / 2)
    ceilings[key] = Math.round(attrStorage(key, clampRating(Math.min(99, rating + room)), isGk) * 10) / 10
  }
  return ceilings
}

/**
 * 把上限修正到合法、可用：不低于当前属性（避免旧存档被冻死），不高于该属性的绝对上限。
 */
export function normalizeCeilings(current: Attributes, ceilings: Attributes | undefined, absoluteMax: (key: AttrKey) => number): Attributes {
  const out = {} as Attributes
  for (const key of Object.keys(current) as AttrKey[]) {
    const limit = absoluteMax(key)
    const raw = ceilings?.[key]
    const value = Number.isFinite(raw) && (raw as number) > 0 ? Math.min(raw as number, limit) : limit
    out[key] = Math.round(Math.max(value, Math.min(current[key], limit)) * 10) / 10
  }
  return out
}
