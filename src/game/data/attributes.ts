import type { AttrKey, FieldAttr, GkAttr, Position } from '../types.ts'
import { FIELD_ATTRIBUTES, GK_ATTRIBUTES, POSITIONS } from '../types.ts'

export type AttrMeta = {
  key: AttrKey
  label: string
  short: string
  group: '技术' | '精神' | '身体' | '门将'
  desc: string
}

export const ATTR_META: Record<AttrKey, AttrMeta> = {
  passing: { key: 'passing', label: '传球', short: '传', group: '技术', desc: '选定线路后能否把球传到位' },
  firstTouch: { key: 'firstTouch', label: '第一脚触球', short: '触', group: '技术', desc: '接球后的控制质量与处理时间' },
  dribbling: { key: 'dribbling', label: '盘带', short: '带', group: '技术', desc: '持球变向、摆脱和推进的执行' },
  shooting: { key: 'shooting', label: '射术', short: '射', group: '技术', desc: '射门精度和终结质量' },
  tackling: { key: 'tackling', label: '抢断', short: '断', group: '技术', desc: '进入对抗范围后能否干净夺球' },
  heading: { key: 'heading', label: '头球', short: '头', group: '技术', desc: '高空球接触后的处理质量' },
  vision: { key: 'vision', label: '视野', short: '视', group: '精神', desc: '能识别哪些接应线路与进攻机会' },
  decisions: { key: 'decisions', label: '决策', short: '决', group: '精神', desc: '如何评估传、带、射的收益和风险' },
  offBall: { key: 'offBall', label: '无球跑位', short: '跑', group: '精神', desc: '进攻时选择接应点与前插时机' },
  defPos: { key: 'defPos', label: '防守站位', short: '位', group: '精神', desc: '防守时保护什么区域、如何保持队形' },
  anticipation: { key: 'anticipation', label: '预判', short: '预', group: '精神', desc: '判断落点、运动趋势和拦截时机' },
  composure: { key: 'composure', label: '镇定', short: '定', group: '精神', desc: '受压、单刀等场景下的技术稳定性' },
  teamwork: { key: 'teamwork', label: '团队合作', short: '团', group: '精神', desc: '按职责接应、补位和留后，而非只追球' },
  acceleration: { key: 'acceleration', label: '爆发', short: '爆', group: '身体', desc: '短距离起步、第一步和摆脱时的瞬间加速' },
  speed: { key: 'speed', label: '速度', short: '速', group: '身体', desc: '持续冲刺的最高移动速度' },
  agility: { key: 'agility', label: '灵活', short: '灵', group: '身体', desc: '转身与变向，避免速度快却转不过身' },
  strength: { key: 'strength', label: '力量', short: '力', group: '身体', desc: '护球、身体争抢和对抗中的稳定性' },
  endurance: { key: 'endurance', label: '耐力', short: '耐', group: '身体', desc: '体力容量和持续跑动的消耗耐受' },
  reflexes: { key: 'reflexes', label: '扑救反应', short: '扑', group: '门将', desc: '面对射门时的反应与扑救' },
  handling: { key: 'handling', label: '手控', short: '手', group: '门将', desc: '抱球稳定性与脱手控制' },
  rushing: { key: 'rushing', label: '出击', short: '出', group: '门将', desc: '离门争抢身后球与单刀' },
  oneOnOne: { key: 'oneOnOne', label: '一对一', short: '1v1', group: '门将', desc: '单刀场景下的封堵能力' },
}

export const ATTR_GROUPS = [
  { name: '技术' as const, attrs: FIELD_ATTRIBUTES.filter((a) => ATTR_META[a].group === '技术') },
  { name: '精神' as const, attrs: FIELD_ATTRIBUTES.filter((a) => ATTR_META[a].group === '精神') },
  { name: '身体' as const, attrs: FIELD_ATTRIBUTES.filter((a) => ATTR_META[a].group === '身体') },
  { name: '门将' as const, attrs: [...GK_ATTRIBUTES] },
]

export const RELATED_ATTRS: Record<AttrKey, AttrKey[]> = {
  passing: ['vision', 'firstTouch'],
  firstTouch: ['composure', 'agility'],
  dribbling: ['agility', 'acceleration'],
  shooting: ['composure', 'offBall'],
  tackling: ['defPos', 'strength'],
  heading: ['strength', 'offBall'],
  vision: ['decisions', 'passing'],
  decisions: ['composure', 'vision'],
  offBall: ['acceleration', 'anticipation'],
  defPos: ['anticipation', 'teamwork'],
  anticipation: ['defPos', 'vision'],
  composure: ['decisions', 'firstTouch'],
  teamwork: ['offBall', 'defPos'],
  acceleration: ['speed', 'agility'],
  speed: ['acceleration', 'endurance'],
  agility: ['acceleration', 'dribbling'],
  strength: ['heading', 'tackling'],
  endurance: ['strength', 'teamwork'],
  reflexes: ['oneOnOne', 'agility'],
  handling: ['reflexes', 'composure'],
  rushing: ['anticipation', 'speed'],
  oneOnOne: ['reflexes', 'composure'],
}

export const POSITION_LABELS: Record<Position, string> = {
  GK: '门将',
  CB: '中卫',
  W: '边路',
  CM: '中场',
  ST: '前锋',
}

export const POSITION_DESC: Record<Position, string> = {
  GK: '只守门，外场与门将首版不能互相转职',
  CB: '守身后、补位、对抗',
  W: '边路推进、接应、回追',
  CM: '连接、组织、扫荡',
  ST: '抢点、跑位、终结',
}

export function attrLabel(key: AttrKey): string {
  return ATTR_META[key].label
}

export function fieldAttrs(isGk: boolean): readonly AttrKey[] {
  return isGk ? [...FIELD_ATTRIBUTES, ...GK_ATTRIBUTES] : FIELD_ATTRIBUTES
}

export function isFieldAttr(key: AttrKey): key is FieldAttr {
  return (FIELD_ATTRIBUTES as readonly string[]).includes(key)
}

export function isGkAttr(key: AttrKey): key is GkAttr {
  return (GK_ATTRIBUTES as readonly string[]).includes(key)
}

export function positionsUnlocked(positions: Record<Position, number>): Position[] {
  return POSITIONS.filter((p) => positions[p] > 0)
}
