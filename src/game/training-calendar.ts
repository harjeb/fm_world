import type { AttrKey, TrainingSession } from './types.ts'
import { derivedRng } from './rng.ts'
import { isGoalkeeper } from './ca.ts'

export type TrainingActivityId = 'exchange' | 'match' | 'rest' | 'video' | 'corners' | 'shooting' | 'tactics' | 'passing' | 'dribbling' | 'defending' | 'fitness' | 'goalkeeping' | 'gk_saves' | 'gk_one_on_one' | 'gk_crosses' | 'gk_distribution' | 'gk_positioning' | 'gk_fitness' | 'position' | 'inherit' | 'mentor' | 'prevention' | 'resilience'

export type TrainingActivity = {
  id: TrainingActivityId
  label: string
  desc: string
  stamina: string
  group: boolean
  parameters?: 'position' | 'inherit'
  cost?: number
  gains?: Partial<Record<AttrKey, number>>
  goalkeeperGains?: Partial<Record<AttrKey, number>>
  /** 这次休息不恢复体力。 */
  noRecovery?: boolean
}

const ACTIVITIES: TrainingActivity[] = [
  { id: 'video', label: '录像训练', desc: '通过比赛录像学习观察和决策。', stamina: '-8', group: true, cost: 8, gains: { vision: 1, decisions: 1 }, goalkeeperGains: { decisions: 1, composure: 1 } },
  { id: 'corners', label: '角球练习', desc: '练习角球传递和争顶配合。', stamina: '-16', group: true, cost: 16, gains: { passing: 1, strength: 1, teamwork: 0.5 }, goalkeeperGains: { handling: 1, rushing: 1, teamwork: 0.5 } },
  { id: 'shooting', label: '射门练习', desc: '反复练习射门；门将练习扑救。', stamina: '-12', group: true, cost: 12, gains: { shooting: 1.5, composure: 0.5 }, goalkeeperGains: { reflexes: 1.5, oneOnOne: 0.5 } },
  { id: 'tactics', label: '战术学习', desc: '学习站位、配合和场上判断。', stamina: '-8', group: true, cost: 8, gains: { decisions: 1, teamwork: 1, defPos: 0.5 } },
  { id: 'passing', label: '传接球练习', desc: '磨合短传和第一脚触球。', stamina: '-12', group: true, cost: 12, gains: { passing: 1.5, firstTouch: 0.5 } },
  { id: 'dribbling', label: '盘带突破', desc: '练习控球、变向与摆脱。', stamina: '-12', group: true, cost: 12, gains: { dribbling: 1.5, acceleration: 0.5 }, goalkeeperGains: { passing: 1.5, rushing: 0.5 } },
  { id: 'defending', label: '防守配合', desc: '练习抢断、补位与协防。', stamina: '-16', group: true, cost: 16, gains: { tackling: 1.5, teamwork: 0.5, defPos: 0.5 }, goalkeeperGains: { oneOnOne: 1.5, teamwork: 0.5, composure: 0.5 } },
  { id: 'fitness', label: '体能训练', desc: '练习冲刺、爆发和身体对抗。', stamina: '-12', group: true, cost: 12, gains: { speed: 0.75, acceleration: 0.75, strength: 0.75 }, goalkeeperGains: { reflexes: 1, rushing: 1 } },
  { id: 'goalkeeping', label: '门前训练', desc: '练习门前终结；门将练习扑救和接球。', stamina: '-12', group: true, cost: 12, gains: { shooting: 1, strength: 1 }, goalkeeperGains: { reflexes: 1, handling: 1 } },
  { id: 'position', label: '位置学习', desc: '学习位置或提高熟练度。', stamina: '-8', group: false, parameters: 'position' },
  { id: 'inherit', label: '技能传承', desc: '向队友学习技能。', stamina: '-8', group: false, parameters: 'inherit' },
  { id: 'mentor', label: '导师复盘', desc: '和导师交流，优先触发培养事件。', stamina: '+5', group: false },
  { id: 'prevention', label: '伤病预防', desc: '学习伤病预防技能。', stamina: '-8', group: false },
  { id: 'resilience', label: '伤病韧性', desc: '学习伤病韧性技能。', stamina: '-8', group: false },
]

/**
 * 门将专属课程：成长只落在门将相关的属性上（反应、手控球、出击、一对一、
 * 传球、镇定、决断、预判、防守站位），不会出现射术/盘带这类外场主属性。
 */
const GK_ONLY_ACTIVITIES: TrainingActivity[] = [
  { id: 'gk_saves', label: '扑救反应', desc: '近距离连续扑救，练反应、手型和第二反应。', stamina: '-12', group: true, cost: 12, gains: { reflexes: 1.5, handling: 0.5 } },
  { id: 'gk_one_on_one', label: '单刀一对一', desc: '面对单刀选择出击角度、封堵时机和身体姿态。', stamina: '-12', group: true, cost: 12, gains: { oneOnOne: 1.5, rushing: 0.5, composure: 0.5 } },
  { id: 'gk_crosses', label: '出击与高球', desc: '判断高球落点，练习出击摘球和禁区内的处理。', stamina: '-16', group: true, cost: 16, gains: { rushing: 1.5, handling: 1, defPos: 0.5 } },
  { id: 'gk_distribution', label: '手抛球与开大脚', desc: '练门将的手抛发动、短传组织和大脚落点。', stamina: '-12', group: true, cost: 12, gains: { passing: 1.5, composure: 0.5, decisions: 0.5 } },
  { id: 'gk_positioning', label: '门将站位与指挥', desc: '练封角站位、指挥防线和提前预判来球。', stamina: '-8', group: true, cost: 8, gains: { defPos: 1, decisions: 1, anticipation: 0.5, teamwork: 0.5 } },
  { id: 'gk_fitness', label: '门将体能', desc: '门将专项的步法、下地速度和连续起跳能力。', stamina: '-12', group: true, cost: 12, gains: { reflexes: 1, rushing: 1 } },
]

/** 门将池：专属课程 + 原本就兼顾门将的现有项目。 */
const GK_ACTIVITIES: TrainingActivity[] = [
  ...GK_ONLY_ACTIVITIES,
  ...(['goalkeeping', 'video', 'tactics'] as TrainingActivityId[]).map((id) => ACTIVITIES.find((item) => item.id === id)!),
]

const EXCHANGE: TrainingActivity = { id: 'exchange', label: '交流赛', desc: '使用当前保存的阵容和已装备的属性与 AI 球队比赛，培养中的成果不参与。失败使本课程下周一至周三属性成长减半。不消耗训练体力。', stamina: '不耗体力', group: true }
const MATCH: TrainingActivity = { id: 'match', label: '队内比赛', desc: '高强度队内比赛，综合练习。不消耗训练体力。', stamina: '不耗体力', group: true }
const REST: TrainingActivity = { id: 'rest', label: '恢复', desc: '恢复 30 点训练体力。', stamina: '+30', group: false }
const MATCH_DAY_REST: TrainingActivity = { id: 'rest', label: '休整', desc: '队内比赛后的休整，不恢复训练体力。', stamina: '体力不变', group: false, noRecovery: true }
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

/** action 从 1 开始，半天为一次行动，周末也是训练日。 */
export function trainingDate(action: number): { week: number; day: number; dayLabel: string; slot: '上午' | '下午' } {
  const index = Math.max(0, Math.floor(action) - 1)
  const day = Math.floor(index / 2) % 7
  return { week: Math.floor(index / 14) + 1, day: day + 1, dayLabel: DAYS[day], slot: index % 2 === 0 ? '上午' : '下午' }
}

/** 每天抽一次项目，上午下午共用同一组候选；刷新和读档不会重抽。 */
export function trainingOptions(session: TrainingSession): TrainingActivity[] {
  if (session.scheduleVersion !== 1 || session.completed || session.action >= (session.actionsTotal ?? 18)) return []
  const date = trainingDate(session.action + 1)
  if (date.day === 1 && date.slot === '上午') return [EXCHANGE]
  if (date.day === 5) return [date.slot === '上午' ? MATCH : MATCH_DAY_REST]
  const rng = derivedRng(session.scheduleSeed ?? session.seed, 'training-schedule', date.week, date.day)
  // 门将换成专属候选池；外场球员仍用原来的项目表，随机结果不变。
  // 旧测试会传只有日历字段的假会话，没有候选球员时按外场处理。
  const source = session.candidate && isGoalkeeper(session.candidate) ? GK_ACTIVITIES : ACTIVITIES
  const pool = source.filter(item => item.id !== 'mentor')
  const chosen: TrainingActivity[] = []
  for (let i = 0; i < 4; i++) chosen.push(pool.splice(rng.int(pool.length), 1)[0])
  return [...chosen, ACTIVITIES.find(item => item.id === 'mentor')!, REST]
}

/**
 * 这一时段 6 名陪练各自随机站到哪个选项上（含“恢复”）：每人独立随机，合计恰好是全部陪练，
 * 有的选项可能一个都没有。只看种子和第几次行动，刷新、读档、切换选项都不会重抽。
 */
export function partnerAssignment(session: TrainingSession): Record<string, string[]> {
  const options = trainingOptions(session)
  const assignment: Record<string, string[]> = Object.fromEntries(options.map((item) => [item.id, [] as string[]]))
  const ids = session.partnerIds ?? []
  if (!options.length || !ids.length) return assignment
  const rng = derivedRng(session.scheduleSeed ?? session.seed, 'training-partner-slots', session.action + 1)
  for (const id of ids) assignment[options[rng.int(options.length)].id].push(id)
  return assignment
}

export function trainingLowMood(session: TrainingSession, action: number): boolean {
  const date = trainingDate(action)
  return session.scheduleVersion === 1 && date.day <= 3 && (session.lowMoodWeeks ?? []).includes(date.week)
}
