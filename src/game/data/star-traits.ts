import type { AttrKey, TraitId } from '../types.ts'
import { ATTR_META } from './attributes.ts'
import { TRAITS, type BaseTraitId } from './skills.ts'
import { STAR_TRAITS } from './star-traits.generated.ts'

/**
 * 球星专属特性：500 名真实球星每人一个，不重复。
 * 可以是概率加属性（“每次动作 5% 概率射术 +500”），
 * 也可以直接改结果（“单刀时射正率 +5%”）或者别的玩法（全队光环、进球回血、越进越猛）。
 *
 * 数据在 star-traits.generated.ts，由 scripts/generate-star-traits.ts 生成，也可以直接改单个球星。
 * 生效的地方都在 match/engine.ts，搜 STAR_TRAITS 能找到。
 */
export type TraitCondition =
  | 'any'
  | 'late'
  | 'early'
  | 'secondHalf'
  | 'behind'
  | 'ahead'
  | 'level'
  | 'tired'
  | 'fresh'
  | 'wide'
  | 'attackingThird'
  | 'ownHalf'
  | 'home'
  | 'away'
  | 'subbedOn'
  | 'inBox'
  | 'crossing'
  | 'aerial'

export type ShotScope = 'any' | 'oneOnOne' | 'inBox' | 'longRange' | 'header' | 'freeKick' | 'penalty'
export type PassScope = 'any' | 'short' | 'through' | 'long' | 'cross' | 'pressured' | 'freeKick'

export type StarEffect =
  /** 每次动作 chance% 概率，主属性 +bonus（面板的 0–1500 尺度）。 */
  | { kind: 'attr'; attr: AttrKey; chance: number; bonus: number }
  /** 射门：射正率和进球率各加多少个百分点。 */
  | { kind: 'shot'; scope: ShotScope; onTarget: number; goal: number }
  | { kind: 'pass'; scope: PassScope; success: number }
  | { kind: 'dribble'; success: number }
  /** 他上前防守时，对手传球和盘带的成功率减多少个百分点。 */
  | { kind: 'defend'; success: number }
  /** 门将：对手进球率减多少个百分点。 */
  | { kind: 'save'; scope: ShotScope; goal: number }
  | { kind: 'stamina'; drain: number }
  /** 每进 1 球恢复多少体力（占满体力的百分比）。 */
  | { kind: 'goalRecover'; stamina: number }
  /** 体力第一次跌破 60% 时恢复，每场一次。 */
  | { kind: 'secondWind'; stamina: number }
  /** 本场每进 1 球，射术 +bonus，可以叠加。 */
  | { kind: 'hotStreak'; bonus: number }
  /** 在场时全队这项属性 +bonus。 */
  | { kind: 'aura'; attr: AttrKey; bonus: number }
  /** 在场时对手全队这项属性 -bonus。 */
  | { kind: 'intimidate'; attr: AttrKey; bonus: number }
  | { kind: 'injury'; risk: number }
  | { kind: 'card'; risk: number }
  /** 自己所有技能的效果放大多少。 */
  | { kind: 'skillBoost'; pct: number }
  /** 本该吹越位的直塞，有 chance% 概率不吹。 */
  | { kind: 'onside'; chance: number }
  /** 被贴身防守时，对手犯规的概率放大多少。 */
  | { kind: 'drawFoul'; pct: number }

/**
 * when 是生效条件。goalRecover、secondWind、hotStreak、injury、card、skillBoost、onside
 * 这几种引擎不判断条件，when 只能是 'any'（测试会检查）。
 */
export type StarTrait = { name: string; when: TraitCondition } & StarEffect

export const TRAIT_CONDITION_TEXT: Record<TraitCondition, string> = {
  any: '比赛中',
  late: '最后 15 分钟',
  early: '开场 15 分钟',
  secondHalf: '下半场',
  behind: '比分落后时',
  ahead: '比分领先时',
  level: '比分打平时',
  tired: '体力低于 70% 时',
  fresh: '体力高于 80% 时',
  wide: '在边路时',
  attackingThird: '在前场时',
  ownHalf: '在本方半场时',
  home: '主场',
  away: '客场',
  subbedOn: '替补上场后',
  inBox: '在禁区内射门时',
  crossing: '传中时',
  aerial: '争顶时',
}

const SHOT_SCOPE_TEXT: Record<ShotScope, string> = {
  any: '射门时',
  oneOnOne: '单刀面对门将时',
  inBox: '在禁区内射门时',
  longRange: '在禁区外远射时',
  header: '头球攻门时',
  freeKick: '直接任意球时',
  penalty: '主罚点球时（含点球大战）',
}

const SAVE_SCOPE_TEXT: Record<ShotScope, string> = {
  any: '面对射门时',
  oneOnOne: '面对单刀时',
  inBox: '面对禁区内射门时',
  longRange: '面对远射时',
  header: '面对头球时',
  freeKick: '面对任意球时',
  penalty: '面对点球时（含点球大战）',
}

const PASS_SCOPE_TEXT: Record<PassScope, string> = {
  any: '传球',
  short: '短传',
  through: '直塞',
  long: '25 米以上的长传',
  cross: '边路传球和传中',
  pressured: '受压时传球',
  freeKick: '任意球传中',
}

export function starTraitId(seedId: string): TraitId {
  return `star_${seedId}`
}

export function starTraitOf(id: TraitId): StarTrait | undefined {
  return STAR_TRAITS[id]
}

export function traitNameOf(id: TraitId): string {
  return STAR_TRAITS[id]?.name ?? TRAITS[id as BaseTraitId]?.name ?? id
}

const label = (attr: AttrKey) => ATTR_META[attr].label

function effectText(trait: StarTrait): string {
  switch (trait.kind) {
    case 'attr':
      return trait.chance >= 100 ? `${label(trait.attr)} +${trait.bonus}` : `每次动作 ${trait.chance}% 概率 ${label(trait.attr)} +${trait.bonus}`
    case 'shot': {
      const parts = [trait.onTarget ? `射正率 +${trait.onTarget}%` : '', trait.goal ? `进球率 +${trait.goal}%` : ''].filter(Boolean)
      // 已经有条件时不再说“射门时”，免得一句话里两个“时”。
      return `${trait.scope === 'any' && trait.when !== 'any' ? '' : SHOT_SCOPE_TEXT[trait.scope]}${parts.join('，')}`
    }
    case 'pass':
      return `${PASS_SCOPE_TEXT[trait.scope]}成功率 +${trait.success}%`
    case 'dribble':
      return `盘带成功率 +${trait.success}%`
    case 'defend':
      return `他上前防守时，对手传球和盘带成功率 -${trait.success}%`
    case 'save':
      return `${trait.scope === 'any' && trait.when !== 'any' ? '' : SAVE_SCOPE_TEXT[trait.scope]}对手进球率 -${trait.goal}%`
    case 'stamina':
      return `跑动时的体力消耗 -${trait.drain}%`
    case 'goalRecover':
      return `每进 1 球恢复 ${trait.stamina}% 体力`
    case 'secondWind':
      return `体力第一次跌破 60% 时恢复 ${trait.stamina}% 体力，每场一次`
    case 'hotStreak':
      return `本场每进 1 球，射术 +${trait.bonus}，可以叠加`
    case 'aura':
      return `${trait.when === 'any' ? '在场时' : '他在场则'}全队${label(trait.attr)} +${trait.bonus}`
    case 'intimidate':
      return `${trait.when === 'any' ? '在场时' : '他在场则'}对手全队${label(trait.attr)} -${trait.bonus}`
    case 'injury':
      return `比赛中的受伤风险 -${trait.risk}%`
    case 'card':
      return `犯规时吃牌的概率 -${trait.risk}%`
    case 'skillBoost':
      return `自己所有技能的效果 +${trait.pct}%`
    case 'onside':
      return `本该越位的直塞，有 ${trait.chance}% 概率不被吹罚`
    case 'drawFoul':
      return `被贴身防守时，造犯规的概率 +${trait.pct}%`
  }
}

export function starTraitText(trait: StarTrait): string {
  const effect = effectText(trait)
  return trait.when === 'any' ? `${effect}。` : `${TRAIT_CONDITION_TEXT[trait.when]}，${effect}。`
}
