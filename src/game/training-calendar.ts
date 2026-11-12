import type { AttrKey, TrainingSession } from './types.ts'
import { derivedRng } from './rng.ts'
import { isGoalkeeper } from './ca.ts'
import { canLearnSkill } from './data/skills.ts'

export type TrainingActivityId =
  | 'exchange'
  | 'match'
  | 'rest'
  | 'video'
  | 'corners'
  | 'shooting'
  | 'tactics'
  | 'passing'
  | 'dribbling'
  | 'defending'
  | 'fitness'
  | 'goalkeeping'
  | 'sprint'
  | 'explosive'
  | 'duel'
  | 'long_passing'
  | 'aerial'
  | 'pressing'
  | 'off_ball_runs'
  | 'ball_control'
  | 'free_kicks'
  | 'stamina_run'
  | 'interception'
  | 'gk_saves'
  | 'gk_one_on_one'
  | 'gk_crosses'
  | 'gk_distribution'
  | 'gk_positioning'
  | 'gk_fitness'
  | 'gk_penalties'
  | 'gk_sweeper'
  | 'gk_handling'
  | 'gk_mental'
  | 'position'
  | 'inherit'
  | 'mentor'
  | 'prevention'
  | 'resilience'

export type TrainingActivity = {
  id: TrainingActivityId
  label: string
  desc: string
  stamina: string
  group: boolean
  /** 是否与共同训练/陪练队友累积默契。 */
  cooperative?: boolean
  parameters?: 'position' | 'inherit'
  cost?: number
  gains?: Partial<Record<AttrKey, number>>
  goalkeeperGains?: Partial<Record<AttrKey, number>>
  /** 这次休息不恢复体力。 */
  noRecovery?: boolean
}

/** 每个常规半天时段抽出的随机课程数（另加常驻的导师复盘与恢复，共 8 项）。 */
export const DRAWN_OPTIONS_PER_SLOT = 6

export const ACTIVITIES: TrainingActivity[] = [
  { id: 'video', label: '录像训练', desc: '通过比赛录像学习观察和决策。', stamina: '-8', group: true, cost: 8, gains: { vision: 1, decisions: 1 }, goalkeeperGains: { decisions: 1, composure: 1 } },
  { id: 'tactics', label: '战术学习', desc: '学习站位、配合和场上判断。', stamina: '-8', group: true, cooperative: true, cost: 8, gains: { decisions: 1, teamwork: 1, defPos: 0.5 } },
  { id: 'free_kicks', label: '定位球主罚', desc: '加练直接任意球弧线、落点控制与主罚抗压。', stamina: '-10', group: false, cost: 10, gains: { shooting: 1, passing: 0.75, composure: 0.5 } },
  { id: 'shooting', label: '射门练习', desc: '反复练习射门终结；门将练习扑救。', stamina: '-12', group: true, cost: 12, gains: { shooting: 1.5, composure: 0.5 }, goalkeeperGains: { reflexes: 1.5, oneOnOne: 0.5 } },
  { id: 'passing', label: '传接球练习', desc: '磨合短传渗透和第一脚触球。', stamina: '-12', group: true, cooperative: true, cost: 12, gains: { passing: 1.5, firstTouch: 0.5 } },
  { id: 'long_passing', label: '长传与传中', desc: '练习大范围转移调度与边路传中落点。', stamina: '-12', group: true, cooperative: true, cost: 12, gains: { passing: 1.25, vision: 0.75, offBall: 0.5 } },
  { id: 'dribbling', label: '盘带突破', desc: '练习控球、变向与高速摆脱。', stamina: '-12', group: true, cost: 12, gains: { dribbling: 1.5, acceleration: 0.5 }, goalkeeperGains: { passing: 1.5, rushing: 0.5 } },
  { id: 'ball_control', label: '停球摆脱', desc: '受迫环境下的第一脚卸球、护球与转身。', stamina: '-12', group: true, cost: 12, gains: { dribbling: 1, passing: 0.5, firstTouch: 0.75, composure: 0.5 } },
  { id: 'sprint', label: '冲刺跑', desc: '短程起速与长距离全力冲刺训练。', stamina: '-12', group: true, cost: 12, gains: { speed: 1.5, acceleration: 0.5 } },
  { id: 'explosive', label: '爆发变向', desc: '折返急停、第一步启动与敏捷重心转换。', stamina: '-12', group: true, cost: 12, gains: { acceleration: 1.5, agility: 0.5 } },
  { id: 'off_ball_runs', label: '无球前插', desc: '演练反越位启动、肋部穿插与抢点跑位。', stamina: '-12', group: true, cooperative: true, cost: 12, gains: { acceleration: 1, shooting: 0.5, offBall: 1 } },
  { id: 'duel', label: '身体对抗', desc: '贴身卡位、护球抗撞与一对一力量较量。', stamina: '-12', group: true, cost: 12, gains: { strength: 1.5, tackling: 0.5 } },
  { id: 'aerial', label: '头球争顶', desc: '传中落点预判、起跳对抗与头球攻防。', stamina: '-12', group: true, cooperative: true, cost: 12, gains: { strength: 1, heading: 1, anticipation: 0.5 } },
  { id: 'interception', label: '卡线拦截', desc: '阅读出球意图、提前移动封堵传球线路。', stamina: '-12', group: true, cooperative: true, cost: 12, gains: { tackling: 1, anticipation: 0.75, defPos: 0.75 } },
  { id: 'fitness', label: '体能训练', desc: '练习冲刺、爆发和身体对抗。', stamina: '-12', group: true, cost: 12, gains: { speed: 0.75, acceleration: 0.75, strength: 0.75 }, goalkeeperGains: { reflexes: 1, rushing: 1 } },
  { id: 'goalkeeping', label: '门前训练', desc: '练习门前终结；门将练习扑救和接球。', stamina: '-12', group: true, cost: 12, gains: { shooting: 1, strength: 1 }, goalkeeperGains: { reflexes: 1, handling: 1 } },
  { id: 'stamina_run', label: '耐力拉练', desc: '有氧变速跑与高强度往返，提升持续跑动能力。', stamina: '-14', group: true, cost: 14, gains: { speed: 0.75, strength: 0.75, endurance: 1 } },
  { id: 'corners', label: '角球练习', desc: '练习角球传递、前点争顶和战术配合。', stamina: '-16', group: true, cooperative: true, cost: 16, gains: { passing: 1, strength: 1, heading: 0.5, teamwork: 0.5 }, goalkeeperGains: { handling: 1, rushing: 1, teamwork: 0.5 } },
  { id: 'defending', label: '防守配合', desc: '练习抢断、补位与防线协防。', stamina: '-16', group: true, cooperative: true, cost: 16, gains: { tackling: 1.5, teamwork: 0.5, defPos: 0.5 }, goalkeeperGains: { oneOnOne: 1.5, teamwork: 0.5, composure: 0.5 } },
  { id: 'pressing', label: '高位逼抢', desc: '前场协同围抢、压迫出球与连续反抢。', stamina: '-16', group: true, cooperative: true, cost: 16, gains: { tackling: 1.25, speed: 0.75, endurance: 0.5, anticipation: 0.5 } },
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
export const GK_ONLY_ACTIVITIES: TrainingActivity[] = [
  { id: 'gk_saves', label: '扑救反应', desc: '近距离连续扑救，练反应、手型和第二反应。', stamina: '-12', group: true, cost: 12, gains: { reflexes: 1.5, handling: 0.5 } },
  { id: 'gk_handling', label: '高压手控', desc: '远射重炮与湿滑球路下的抱球稳健度练习。', stamina: '-12', group: true, cost: 12, gains: { handling: 1.5, composure: 0.5 } },
  { id: 'gk_one_on_one', label: '单刀一对一', desc: '面对单刀选择出击角度、封堵时机和身体姿态。', stamina: '-12', group: true, cost: 12, gains: { oneOnOne: 1.5, rushing: 0.5, composure: 0.5 } },
  { id: 'gk_crosses', label: '出击与高球', desc: '判断高球落点，练习出击摘球和禁区内的处理。', stamina: '-16', group: true, cooperative: true, cost: 16, gains: { rushing: 1.5, handling: 1, defPos: 0.5 } },
  { id: 'gk_sweeper', label: '门卫清道夫', desc: '防线身后保护、弃门拦截直塞与一脚出球衔接。', stamina: '-12', group: true, cooperative: true, cost: 12, gains: { rushing: 1.25, passing: 0.75, anticipation: 0.5 } },
  { id: 'gk_distribution', label: '手抛球与开大脚', desc: '练门将的手抛发动、短传组织和大脚落点。', stamina: '-12', group: true, cooperative: true, cost: 12, gains: { passing: 1.5, composure: 0.5, decisions: 0.5 } },
  { id: 'gk_penalties', label: '点球扑救', desc: '预判助跑节奏，锤炼极限侧扑与门前心理博弈。', stamina: '-12', group: true, cost: 12, gains: { reflexes: 1, oneOnOne: 0.75, composure: 0.75 } },
  { id: 'gk_positioning', label: '门将站位与指挥', desc: '练封角站位、指挥防线和提前预判来球。', stamina: '-8', group: true, cooperative: true, cost: 8, gains: { defPos: 1, decisions: 1, anticipation: 0.5, teamwork: 0.5 } },
  { id: 'gk_mental', label: '门前抗压', desc: '模拟高压围攻与读秒守成场景，强化镇定与决断。', stamina: '-8', group: false, cost: 8, gains: { composure: 1.5, decisions: 0.5 } },
  { id: 'gk_fitness', label: '门将体能', desc: '门将专项的步法、下地速度和连续起跳能力。', stamina: '-12', group: true, cost: 12, gains: { reflexes: 1, rushing: 1 } },
]

/** 门将池：专属课程 + 原本就兼顾门将的现有项目。 */
export const GK_ACTIVITIES: TrainingActivity[] = [
  ...GK_ONLY_ACTIVITIES,
  ...(['goalkeeping', 'video', 'tactics'] as TrainingActivityId[]).map((id) => ACTIVITIES.find((item) => item.id === id)!),
]

const EXCHANGE: TrainingActivity = { id: 'exchange', label: '交流赛', desc: '使用当前保存的阵容和已装备的属性与 AI 球队比赛，培养中的成果不参与。按位置与职责轮换两项主属性成长；失败使本课程下周一至周三属性成长减半。不消耗训练体力。', stamina: '不耗体力', group: true, cooperative: true }
const MATCH: TrainingActivity = { id: 'match', label: '队内比赛', desc: '按位置与职责轮换两项主属性，并练习团队合作。不消耗训练体力。', stamina: '不耗体力', group: true, cooperative: true }
const REST: TrainingActivity = { id: 'rest', label: '恢复', desc: '恢复 30 点训练体力。', stamina: '+30', group: false }
const MATCH_DAY_REST: TrainingActivity = { id: 'rest', label: '休整', desc: '队内比赛后的休整，不恢复训练体力。', stamina: '体力不变', group: false, noRecovery: true }
const MENTOR_ACTIVITY = ACTIVITIES.find((item) => item.id === 'mentor')!
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

const ALL_ACTIVITY_MAP = new Map<TrainingActivityId, TrainingActivity>([
  ...ACTIVITIES.map((item) => [item.id, item] as const),
  ...GK_ONLY_ACTIVITIES.map((item) => [item.id, item] as const),
  [EXCHANGE.id, EXCHANGE],
  [MATCH.id, MATCH],
  [REST.id, REST],
])

export function isCooperativeActivity(id: TrainingActivityId): boolean {
  return ALL_ACTIVITY_MAP.get(id)?.cooperative === true
}

/** action 从 1 开始，半天为一次行动，周末也是训练日。 */
export function trainingDate(action: number): { week: number; day: number; dayLabel: string; slot: '上午' | '下午' } {
  const index = Math.max(0, Math.floor(action) - 1)
  const day = Math.floor(index / 2) % 7
  return { week: Math.floor(index / 14) + 1, day: day + 1, dayLabel: DAYS[day], slot: index % 2 === 0 ? '上午' : '下午' }
}

/**
 * 判断非属性类的功能课程当前是否仍可学习：
 * - 伤病预防 / 伤病韧性：已学会或辅助技能槽已满后不再出现；
 * - 位置学习：所有可练位置均达 100 熟练度后不再出现；
 * - 技能传承：始终保留（技能槽满时支持顶掉已有技能）。
 */
export function isSpecialActivityAvailable(session: TrainingSession, item: TrainingActivity): boolean {
  const candidate = session.candidate
  if (!candidate) return true
  if (item.id === 'prevention') return canLearnSkill(candidate.skills, 'injury_prevention')
  if (item.id === 'resilience') return canLearnSkill(candidate.skills, 'injury_resilience')
  if (item.id === 'position') {
    const positions = isGoalkeeper(candidate) ? (['GK'] as const) : (['CB', 'W', 'CM', 'ST'] as const)
    return positions.some((pos) => candidate.positions[pos] < 100)
  }
  return true
}

/**
 * 每个半天时段独立抽取 6 项训练课（上午、下午各自刷新；刷新页面和读档不会重抽）：
 * - 外场保底至少 5 项涨属性的训练课，最多搭配 1 项未学满的功能课（已学会/学满的不再出现），避免功能项挤占训练位；
 * - 门将从 13 项门将课程中抽取 6 项；
 * - 末尾固定附上「导师复盘」与「恢复」，共 8 个选项。
 */
export function trainingOptions(session: TrainingSession): TrainingActivity[] {
  if (session.scheduleVersion !== 1 || session.completed || session.action >= (session.actionsTotal ?? 18)) return []
  const date = trainingDate(session.action + 1)
  if (date.day === 1 && date.slot === '上午') return [EXCHANGE]
  if (date.day === 5) return [date.slot === '上午' ? MATCH : MATCH_DAY_REST]
  const rng = derivedRng(session.scheduleSeed ?? session.seed, 'training-schedule', date.week, date.day, date.slot)
  const gk = !!session.candidate && isGoalkeeper(session.candidate)
  if (gk) {
    const pool = [...GK_ACTIVITIES]
    const chosen: TrainingActivity[] = []
    for (let i = 0; i < DRAWN_OPTIONS_PER_SLOT && pool.length > 0; i++) {
      chosen.push(pool.splice(rng.int(pool.length), 1)[0])
    }
    return [...chosen, MENTOR_ACTIVITY, REST]
  }
  const attrPool = ACTIVITIES.filter((item) => item.id !== 'mentor' && !!item.gains)
  const specialPool = ACTIVITIES.filter((item) => item.id !== 'mentor' && !item.gains && isSpecialActivityAvailable(session, item))
  const chosen: TrainingActivity[] = []
  const guaranteedAttrCount = DRAWN_OPTIONS_PER_SLOT - 1
  for (let i = 0; i < guaranteedAttrCount && attrPool.length > 0; i++) {
    chosen.push(attrPool.splice(rng.int(attrPool.length), 1)[0])
  }
  if (specialPool.length > 0 && rng.chance(0.6)) {
    chosen.push(specialPool[rng.int(specialPool.length)])
  } else if (attrPool.length > 0) {
    chosen.push(attrPool.splice(rng.int(attrPool.length), 1)[0])
  }
  return [...chosen, MENTOR_ACTIVITY, REST]
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
