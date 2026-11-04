import type { AttrKey, TrainingSession } from './types.ts'
import { derivedRng } from './rng.ts'

export type TrainingActivityId = 'exchange' | 'match' | 'rest' | 'video' | 'corners' | 'shooting' | 'tactics' | 'passing' | 'dribbling' | 'defending' | 'fitness' | 'goalkeeping' | 'position' | 'inherit' | 'mentor' | 'prevention' | 'resilience'

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
}

const ACTIVITIES: TrainingActivity[] = [
  { id: 'video', label: '录像训练', desc: '通过比赛录像学习观察和决策。', stamina: '-8', group: true, cost: 8, gains: { vision: 1, decisions: 1 }, goalkeeperGains: { decisions: 1, composure: 1 } },
  { id: 'corners', label: '角球练习', desc: '练习角球传递和争顶配合。', stamina: '-16', group: true, cost: 16, gains: { passing: 1, strength: 1, teamwork: 0.5 }, goalkeeperGains: { handling: 1, rushing: 1, teamwork: 0.5 } },
  { id: 'shooting', label: '射门练习', desc: '反复练习射门；门将练习扑救。', stamina: '-12', group: true, cost: 12, gains: { shooting: 1.5, composure: 0.5 }, goalkeeperGains: { reflexes: 1.5, oneOnOne: 0.5 } },
  { id: 'tactics', label: '战术学习', desc: '学习站位、配合和场上判断。', stamina: '-8', group: true, cost: 8, gains: { decisions: 1, teamwork: 1, defPos: 0.5 } },
  { id: 'passing', label: '传接球练习', desc: '磨合短传和第一脚触球。', stamina: '-12', group: true, cost: 12, gains: { passing: 1.5, firstTouch: 0.5 } },
  { id: 'dribbling', label: '盘带突破', desc: '练习控球、变向与摆脱。', stamina: '-12', group: true, cost: 12, gains: { dribbling: 1.5, speed: 0.5 }, goalkeeperGains: { passing: 1.5, rushing: 0.5 } },
  { id: 'defending', label: '防守配合', desc: '练习抢断、补位与协防。', stamina: '-16', group: true, cost: 16, gains: { tackling: 1.5, teamwork: 0.5, defPos: 0.5 }, goalkeeperGains: { oneOnOne: 1.5, teamwork: 0.5, composure: 0.5 } },
  { id: 'fitness', label: '体能训练', desc: '练习加速与身体对抗。', stamina: '-12', group: true, cost: 12, gains: { speed: 1, strength: 1 }, goalkeeperGains: { reflexes: 1, rushing: 1 } },
  { id: 'goalkeeping', label: '门前训练', desc: '练习门前终结；门将练习扑救和接球。', stamina: '-12', group: true, cost: 12, gains: { shooting: 1, strength: 1 }, goalkeeperGains: { reflexes: 1, handling: 1 } },
  { id: 'position', label: '位置学习', desc: '学习位置或提高熟练度。', stamina: '-8', group: false, parameters: 'position' },
  { id: 'inherit', label: '技能传承', desc: '向队友学习技能。', stamina: '-8', group: false, parameters: 'inherit' },
  { id: 'mentor', label: '导师复盘', desc: '和导师交流，优先触发培养事件。', stamina: '+5', group: false },
  { id: 'prevention', label: '伤病预防', desc: '学习伤病预防技能。', stamina: '-8', group: false },
  { id: 'resilience', label: '伤病韧性', desc: '学习伤病韧性技能。', stamina: '-8', group: false },
]

const EXCHANGE: TrainingActivity = { id: 'exchange', label: '交流赛', desc: '使用当前已确认阵容与 AI 球队比赛；训练候选须确认后才能上场。失败使本课程下周一至周三属性成长减半。体力不足 25 时耗尽剩余体力。', stamina: '最多 -25', group: true }
const MATCH: TrainingActivity = { id: 'match', label: '队内比赛', desc: '高强度队内比赛，综合练习；体力不足 25 时耗尽剩余体力。', stamina: '最多 -25', group: true }
const REST: TrainingActivity = { id: 'rest', label: '恢复', desc: '恢复 30 点训练体力。', stamina: '+30', group: false }
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
  if (date.day === 5) return [date.slot === '上午' ? MATCH : REST]
  const rng = derivedRng(session.scheduleSeed ?? session.seed, 'training-schedule', date.week, date.day)
  const pool = ACTIVITIES.filter(item => item.id !== 'mentor')
  const chosen: TrainingActivity[] = []
  for (let i = 0; i < 4; i++) chosen.push(pool.splice(rng.int(pool.length), 1)[0])
  return [...chosen, ACTIVITIES.find(item => item.id === 'mentor')!, REST]
}

export function trainingLowMood(session: TrainingSession, action: number): boolean {
  const date = trainingDate(action)
  return session.scheduleVersion === 1 && date.day <= 3 && (session.lowMoodWeeks ?? []).includes(date.week)
}
