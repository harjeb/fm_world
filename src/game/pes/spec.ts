/**
 * 新比赛引擎（pes2d 内核的 TypeScript 版）的数据类型与场地参数。
 * 设计见 docs/pes2d-migration-plan.md 第 6 节、阶段 2。
 *
 * 约定：
 *   - 所有比赛状态都是**纯数据**（对象 / 数组 / 数字 / 字符串），没有类实例、没有 Map、没有互相引用，
 *     可以直接 JSON.stringify 存档，读档后继续跑与不间断运行逐位一致；
 *   - 球员之间、球员与球之间的引用一律用 `pid`（全场唯一序号：主队 0..n-1，客队 n..2n-1），不用对象；
 *   - 坐标：x ∈ [-HL, HL]，y ∈ [-HW, HW]，单位米，原点在场地中心。主队 dir=+1 进攻 +x，客队 dir=-1 进攻 -x；
 *     下半场两队交换方向（dir 取反）。
 */
import type { RngState } from '../match/types.ts'

export type { RngState }

export type Side = 'home' | 'away'
/** 队伍序号：0 = 主队，1 = 客队。 */
export type TeamIndex = 0 | 1

export interface Vec2 {
  x: number
  y: number
}

/** pes2d 的场上角色（只有 GK 在逻辑里有特殊含义；其余只用来分配站位权重）。 */
export type PesRole = string

export type PlayerMode = 'idle' | 'support' | 'run' | 'press' | 'cover' | 'mark' | 'carry' | 'gk'

/** 运动层的 9 个合成能力，0–1。由 `abilityOf()` 从我们的 22 个属性换算。 */
export interface Abilities {
  pace: number
  accel: number
  stamina: number
  control: number
  passing: number
  shooting: number
  tackling: number
  positioning: number
  handling: number
  /** 空中能力（头球 / 对抗 / 身高）：决定角球和传中时谁冲点；原版 pes2d 没有这一项 */
  air?: number
}

/** 战术滑杆，0–1（第 5 节）。 */
export interface PesTactics {
  /** 0 窄 ~ 1 宽 */
  width: number
  /** 0 退守 ~ 1 高位 */
  line: number
  /** 0 保守 ~ 1 疯狂逼抢 */
  press: number
  /** 0 慢 ~ 1 快 */
  tempo: number
  /** 0 短传 ~ 1 直塞 */
  direct: number
  aggression: number
}

export const DEFAULT_TACTICS: PesTactics = { width: 0.5, line: 0.5, press: 0.5, tempo: 0.5, direct: 0.5, aggression: 0.5 }

export interface PesTeamStats {
  shots: number
  shotsOn: number
  goals: number
  xg: number
  passes: number
  passesOk: number
  tackles: number
  fouls: number
  /** 控球秒数 */
  possession: number
  /** 全队跑动米数 */
  distance: number
  corners: number
  offsides: number
  saves: number
}

export const emptyStats = (): PesTeamStats => ({
  shots: 0, shotsOn: 0, goals: 0, xg: 0, passes: 0, passesOk: 0, tackles: 0, fouls: 0,
  possession: 0, distance: 0, corners: 0, offsides: 0, saves: 0,
})

/**
 * 场地与时间参数。名字沿用 pes2d 的 `P`，方便对照原版。
 *
 * 7 人制标定（计划 6.4）：场地 60×40 米，球门半宽 3.75（球门宽 7.5 米，占场宽 18.75%，与现有游戏 12/64 的比例一致）；
 * 跑速、球速、反应、碰撞半径等**物理量不缩放**，只有战术距离（射程、接应偏移、防线高度、盯人距离……）
 * 乘以 `K = L / 105`；压力半径、传球线路净空、队友分离等物理邻近量也不缩放。
 */
export interface PitchSpec {
  /** 场长、场宽（米） */
  L: number
  W: number
  HL: number
  HW: number
  /** 球门半宽、门高（米） */
  GOAL_HALF: number
  GOAL_H: number
  /** 禁区深度、宽度，中圈半径 */
  PEN_D: number
  PEN_W: number
  CIRCLE: number
  /** 半场的模拟秒数 = D / 2（D 是整场的模拟时长，计划第 2 节） */
  HALF: number
  /** 战术距离缩放系数 */
  K: number
  /** 物理步长（秒） */
  DT: number
}

export interface PitchOptions {
  length?: number
  width?: number
  goalHalf?: number
  goalHeight?: number
  penDepth?: number
  penWidth?: number
  circle?: number
  /** 整场模拟时长 D（秒） */
  duration?: number
  /** 战术距离缩放；默认 length / 105 */
  k?: number
  dt?: number
}

export function makePitchSpec(options: PitchOptions = {}): PitchSpec {
  const L = options.length ?? 60
  const W = options.width ?? 40
  return {
    L,
    W,
    HL: L / 2,
    HW: W / 2,
    GOAL_HALF: options.goalHalf ?? 3.75,
    GOAL_H: options.goalHeight ?? 2.44,
    PEN_D: options.penDepth ?? 9.5,
    PEN_W: options.penWidth ?? 24,
    CIRCLE: options.circle ?? 6,
    HALF: (options.duration ?? 900) / 2,
    K: options.k ?? L / 105,
    DT: options.dt ?? 1 / 60,
  }
}

/** 7 人制：60×40 米，整场 D = 900 模拟秒（15 个足球分钟，计划第 2 节）。 */
export const makePitch7 = (duration = 900): PitchSpec => makePitchSpec({ duration })

/** 原版 pes2d 的 11 人制标准场地（用来和原版 sim.js 做差分对照）。 */
export const makePitch11 = (duration = 5400): PitchSpec =>
  makePitchSpec({ length: 105, width: 68, goalHalf: 3.66, penDepth: 16.5, penWidth: 40.32, circle: 9.15, duration })

/**
 * 游戏用的 11 人制场地（标准 105×68 米，战术距离不缩放，K = 1）。
 * 比赛时长 D 和体力系数都按这块场地标定；改场地时要一起重测进球数和体能曲线。
 */
export const makeGamePitch = (duration = 900): PitchSpec => makePitch11(duration)

export interface PesPlayer {
  /** 全场唯一序号：主队 0..n-1，客队 n..2n-1 */
  pid: number
  /** 所属队伍 */
  ti: TeamIndex
  /** 队内序号，0 = 门将 */
  slot: number
  name: string
  /** 调用方自己的球员 id（引擎不使用，只原样带着） */
  ref: string
  role: PesRole
  num: number
  /** 阵型锚点：纵深 nx（0 = 本方球门线，1 = 对方球门线）、横向 ny（0 = 左，1 = 右） */
  hn: Vec2
  /** 线位：0 后卫 ~ 1 前锋 */
  line: number
  ab: Abilities
  pos: Vec2
  vel: Vec2
  facing: Vec2
  target: Vec2
  urgency: number
  stamina: number
  decideT: number
  stun: number
  noClaim: number
  tackleCd: number
  shotCd: number
  holdUntil: number
  mode: PlayerMode
  runUntil: number
  runTarget: Vec2 | null
  /** 个人跑动米数 */
  distance: number
  touches: number
}

export interface PesTeam {
  side: Side
  dir: 1 | -1
  tactics: PesTactics
  score: number
  stats: PesTeamStats
  /** 场上的球员（红牌罚下、被换下的会移到 offPlayers） */
  players: PesPlayer[]
  /** 已离场的球员（红牌 / 被换下），保留他们是为了事件里的 pid 永远查得到人 */
  offPlayers: PesPlayer[]
  /** 本帧负责上抢的球员 pid / 第二保护 pid，没有为 -1。每帧重新分配。 */
  presser: number
  cover: number
  /** marks[slot] = 该队员本帧盯防的对方 pid，没有为 -1。每帧重新分配。 */
  marks: number[]
}

export type BallMetaType = 'pass' | 'cross' | 'shot' | 'blocked' | 'clear' | 'loose' | 'save'

export interface BallMeta {
  type: BallMetaType
  /** 出脚的球员 pid */
  from: number
  /** 传球的目标 pid；没有为 -1 */
  intended?: number
  offside?: boolean
  xg?: number
  counted?: boolean
  /**
   * 结算内核已经判定的结果（只在接了结算模型时才有）：
   * 传球 ok = 到位 / icpt = 被拦截 / miss = 传丢 / out = 出界；射门 goal / save / block / miss。
   */
  result?: 'ok' | 'icpt' | 'miss' | 'out' | 'goal' | 'save' | 'block'
  /** 传球被拦截时的拦截者 pid */
  icpt?: number
  /** 高球：落地前会触发争顶 */
  loft?: boolean
  /** 传中 / 角球 / 任意球传中：落点争顶后攻方赢了直接头球攻门 */
  cross?: boolean
  /** 争顶已经结算过 */
  aerialDone?: boolean
  /** 门将扑救后抱住（true）还是脱手（false），出脚时已定 */
  hold?: boolean
  /** 射门是头球 */
  header?: boolean
}

export interface PesBall {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  spin: number
  /** 持球人 pid，无人持球为 -1 */
  owner: number
  /** 死球（开球 / 界外球等待发球时球冻结） */
  frozen: boolean
  /** 最后触球人 pid，没有为 -1 */
  lastTouch: number
  meta: BallMeta | null
  /** 球离开持球人后无人控制的秒数 */
  looseT: number
  saveCd: number
}

export type RestartType = 'kickoff' | 'throwin' | 'corner' | 'goalkick' | 'fk' | 'penalty'

export interface PesRestart {
  type: RestartType
  /** 发球队 */
  ti: TeamIndex
  t: number
  /** 发球人 pid，没有为 -1 */
  taker: number
  x: number
  y: number
}

export type PesPhase = 'kickoff' | 'restart' | 'play' | 'half' | 'end'

export type PesEventType =
  | 'shot' | 'block' | 'goal' | 'save' | 'foul' | 'tackle' | 'offside' | RestartType | 'half' | 'end'
  /** 传球出脚（结果在 meta.result） */
  | 'pass'
  /** 近身对抗没有断球（过人成功 / 球滚向一旁） */
  | 'duel'
  /** 高球落点争顶 */
  | 'aerial'
  | 'card'
  | 'injury'
  | 'sub'

/**
 * 事件流：每个接触点和规则事件一条。复盘、统计、解说都从这里取（计划 6.3）。
 * `actors` 是相关球员 pid（主角在前）；`ti` 是事件所属队伍，裁判事件为 -1。
 * 统计只能从事件流推出来，这样事件和数字永远是同一份数据。
 */
export interface PesEvent {
  t: number
  type: PesEventType
  ti: TeamIndex | -1
  actors: number[]
  xg?: number
  /** 事件细节（结果、类型、概率、位置……），值只用数字 / 字符串 / 布尔 */
  meta?: Record<string, number | string | boolean>
}

/** 录像帧：量化到厘米。 */
export interface PesFrame {
  t: number
  /** 球 [x, y, z] */
  b: [number, number, number]
  /** 球员 [x, y]，顺序同 pid */
  p: [number, number][]
}

/**
 * 玩法规则开关。`NATIVE_RULES` 是 pes2d 原版的行为（与原版逐位对照用）；
 * 接上结算内核的比赛用 `GAME_RULES`。每一项都只在打开时才改变行为。
 */
export interface PesRules {
  /** 体力：native = pes2d 原版（15 分钟几乎不掉）；distance = 按跑动距离消耗、耐力越高越慢（计划 3.3 / 4.7） */
  fatigue: 'native' | 'distance'
  /** distance 模型的每米消耗（以 D = 900 为基准，内部按 900 / D 缩放，保证“整场跑完”的体力曲线与 D 无关） */
  fatiguePerMeter: number
  /** 传中机制（计划 Q17）：边路持球者在传中区且禁区里有队友时可以选择传中 */
  cross: boolean
  /** 越位判罚；false = 不判 */
  offside: boolean
  /** 禁区内犯规判点球；false = 一律任意球 */
  penalties: boolean
}

export const NATIVE_RULES: PesRules = { fatigue: 'native', fatiguePerMeter: 2.0e-4, cross: false, offside: true, penalties: false }
/**
 * 玩法体力标定（D = 900，11 人制 105×68 场地）：普通外场球员满体力踢完显示的 90 分钟，
 * 计入中场 +5% 恢复后平均消耗约 70%（7 人制时是 4e-4；11 人制场地大、人均跑动多约一成，降到 3.8e-4）。原来的 2e-4 只消耗约三成。
 * 仍按实际跑动 / 速度 / 耐力扣除，不在终场强制改数：前场多跑更累、
 * 门将少跑消耗更少，替补只扣上场后的消耗；模拟时长缩放由 sim.ts 处理。
 * 比赛存档自带 fatiguePerMeter，因此进行中的旧比赛保持原来的消耗系数。
 */
export const GAME_FATIGUE_PER_METER = 3.8e-4
export const GAME_RULES: PesRules = { fatigue: 'distance', fatiguePerMeter: GAME_FATIGUE_PER_METER, cross: true, offside: true, penalties: true }

/** 刚开出的任意球：发球人在这段时间内按定位球的规则出球（直接射门 / 传中 / 短传）。 */
export interface PesSetPiece {
  type: 'fk'
  taker: number
  until: number
}

export interface PesMatchSnapshot {
  version: 1
  spec: PitchSpec
  rules: PesRules
  rng: RngState
  time: number
  half: 1 | 2
  phase: PesPhase
  /** 本次开球的球队，没有为 -1 */
  kickoffTi: TeamIndex | -1
  ball: PesBall
  teams: [PesTeam, PesTeam]
  restart: PesRestart | null
  setPiece: PesSetPiece | null
  events: PesEvent[]
  /** 录像：0 = 不录，否则为每秒帧数 */
  recordHz: number
  frameAcc: number
  /** 结算模型的存档（纯数据）；没接结算为 null */
  contact: unknown
}
