import type { AttrKey, SkillId } from '../types.ts'
import { isMainAttr } from '../scale.ts'
import { basicSkillScopeMatches } from './skills.ts'

export type BasicBookScope = 'any' | 'field' | 'gk'
export type BasicBookRequirement = { attr: AttrKey; silver: number; gold: number; rainbow: number }
export type BasicBookDef = { name: string; scope: BasicBookScope; requires: BasicBookRequirement[] }

/** 基础技能书对应的单项属性；主属性按 0-1500 计，隐藏属性按 1-20 计。 */
const BASIC_BOOK_ATTR: Partial<Record<SkillId, AttrKey>> = {
  through_ball: 'passing',
  safe_pass: 'decisions',
  one_touch: 'firstTouch',
  box_hunter: 'shooting',
  long_shot: 'shooting',
  weak_foot: 'dribbling',
  sweeper: 'tackling',
  iron_lung: 'endurance',
  aerial: 'heading',
  wing_runner: 'dribbling',
  gk_sweeper: 'rushing',
  gk_reflexes: 'reflexes',
  injury_prevention: 'endurance',
  injury_resilience: 'endurance',
  penalty_specialist: 'composure',
  gk_safe_hands: 'handling',
  gk_high_ball: 'rushing',
  gk_close_down: 'oneOnOne',
  gk_long_kick: 'passing',
  cb_intercept: 'anticipation',
  cb_block: 'defPos',
  cb_cover: 'teamwork',
  wing_cross: 'passing',
  wing_support: 'offBall',
  wing_track_back: 'speed',
  cm_long_pass: 'passing',
  cm_shield: 'strength',
  st_breakaway: 'acceleration',
}

const MAIN_THRESHOLDS = { silver: 600, gold: 750, rainbow: 900 }
const HIDDEN_THRESHOLDS = { silver: 8, gold: 11, rainbow: 14 }

export function basicBookScope(id: SkillId): BasicBookScope {
  const keeper = basicSkillScopeMatches(id, true)
  const field = basicSkillScopeMatches(id, false)
  return keeper && field ? 'any' : keeper ? 'gk' : 'field'
}

/** 非传奇 / 巅峰技能的书定义；未登记属性的技能不设门槛。 */
export function basicBookDef(id: SkillId, name: string): BasicBookDef {
  const scope = basicBookScope(id)
  const attr = BASIC_BOOK_ATTR[id]
  if (!attr) return { name, scope, requires: [] }
  const main = isMainAttr(attr, scope === 'gk')
  return { name, scope, requires: [{ attr, ...(main ? MAIN_THRESHOLDS : HIDDEN_THRESHOLDS) }] }
}
