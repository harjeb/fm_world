import type {
  AutoSubPlan,
  AttrKey,
  Attributes,
  CommentaryEntry,
  FailureReason,
  FormationId,
  GoalDetail,
  MatchInstruction,
  MatchLogEntry,
  MatchMentality,
  MatchTeamStats,
  Player,
  PlayerMatchStats,
  Position,
  RoleId,
  SkillId,
  Tactics,
  TraitId,
} from '../types.ts'

export type MatchSide = 'home' | 'away'

export type PlayerMotionState = {
  vx: number
  vy: number
  heading: number
}

export type MatchPlayerState = {
  id: string
  sourceId: string
  personId?: string
  injuryProneness?: number
  name: string
  number: number
  side: MatchSide
  attrs: Attributes
  positions: Record<Position, number>
  skills: SkillId[]
  skillTiers?: Partial<Record<SkillId, 'silver' | 'gold' | 'rainbow'>>
  traitId: TraitId
  foot: 'L' | 'R' | 'B'
  height: number
  role: RoleId
  slotId: string
  position: Position
  x: number
  y: number
  stamina: number
  maxStamina: number
  onPitch: boolean
  injured?: boolean
  cameOff: boolean
  yellowCards: number
  sentOff: boolean
  stats: PlayerMatchStats
  /** 替补上场的球员；专属特性的“替补上场后”看这一项。 */
  subbedOn?: boolean
  /** “每场一次”的专属特性已经用过。 */
  traitUsed?: boolean
  /** v3 连续仿真的速度/朝向；v2 存档没有这一项。 */
  motion?: PlayerMotionState
}

export type MatchTeamState = {
  side: MatchSide
  id: string
  name: string
  color: string
  accent: string
  formationId: FormationId
  tactics: Tactics
  /** 赛前五项战术基线（供比赛计划恢复赛前阶段使用）。 */
  baseTactics?: Tactics
  mentality?: MatchMentality
  tacticalStyle?: import('../pes/tactics.ts').StyleId
  /** 赛前设定的下场比赛计划。 */
  matchPlan?: import('../pes/match-plan.ts').MatchPlanId
  /** 当前已触发的比赛计划阶段 ID。 */
  activePlanPhase?: string
  /** 是否启用 AI 主教练临场战术调度与智能换人。 */
  aiCoach?: boolean
  /** AI 主教练当前生效的临场战术阶段 ID。 */
  aiCoachPhase?: string
  /** 赛前战术指令基线（供临场心态叠加与回切恢复使用）。 */
  baseInstructions?: import('../pes/tactics.ts').TacticalInstructionsV2
  /** 当前生效的战术指令。 */
  instructions?: import('../pes/tactics.ts').TacticalInstructionsV2
  /** 全队战术执行熟练度 0–1。 */
  familiarity?: number
  players: MatchPlayerState[]
  bench: MatchPlayerState[]
  autoSubs?: AutoSubPlan
  subsUsed: number
  chemistry?: Record<string, number>
}

export type PitchPoint = { x: number; y: number }

export type BallState = {
  x: number
  y: number
  ownerId: string | null
  justReceived: boolean
}

/** 单步结束后的视觉轨迹；不影响球权/结算，旧存档可缺省。 */
export type BallMotion = {
  step: number
  kind: 'pass' | 'shot' | 'dribble' | 'loose'
  from: { x: number; y: number }
  /** 同一步传中接头球时，先到接球点再飞向球门。 */
  via?: { x: number; y: number }
  to: { x: number; y: number }
}

export type SetPieceType = 'kickoff' | 'throw_in' | 'goal_kick' | 'corner' | 'free_kick' | 'penalty'

/** 纯视觉的位置快照，不含球员属性、日志或未来状态。 */
export type MatchPlaybackPose = {
  clock: number
  ball: BallState
  players: { id: string; x: number; y: number }[]
}

export type MatchPlaybackFrame = {
  step: number
  /** v3 每 0.2 秒一帧，同一步会有多帧；用 seq 去重和排序。 */
  seq?: number
  /** v3 权威子帧：球和球员按 from→to 直接插值，不再套用动作级出脚时间线。 */
  substep?: boolean
  from: MatchPlaybackPose
  to: MatchPlaybackPose
  motion?: BallMotion
  restart?: SetPieceType
  goal?: boolean
}

export type MatchActionChoice = {
  kind: 'pass' | 'dribble' | 'shoot' | 'clear'
  type?: 'short' | 'long' | 'through' | 'cross'
  targetId?: string
  point: PitchPoint
  label: string
  estimatedP: number
  successValue: number
  failureValue: number
  estimatedTime: number
  chanceType?: string
}

export type MatchBallFlight = {
  kind: 'pass' | 'shot' | 'loose'
  from: PitchPoint
  via?: PitchPoint
  to: PitchPoint
  startedAt: number
  endsAt: number
}

/**
 * v3 的一个动作：选好动作后先连续跑位，release 时出球，resolve 时只裁决一次。
 * 全部字段都能存档，因此在任意 0.1 秒边界恢复都能继续。
 */
export type MatchActionState = {
  id: number
  kind: 'open' | 'setpiece' | 'loose' | 'foul'
  phase: 'prepare' | 'flight' | 'settle'
  choice?: MatchActionChoice
  startedAt: number
  /** 出脚/出球时刻；dribble 与 loose 等于 resolveAt。 */
  releaseAt: number
  resolveAt: number
  from: PitchPoint
  target: PitchPoint
  /** 定位球/开球类型；开放比赛为空。 */
  restart?: SetPieceType
  setPiece?: { type: SetPieceType; teamSide: MatchSide; x: number; y: number; takerId?: string; mode?: 'pass' | 'shot' | 'cross'; targetId?: string }
  /** 最近一次意图更新里各球员的目标位置。 */
  targets?: Record<string, PitchPoint>
  targetsAt?: number
  /** 当前压迫者（防守方），供逐 tick 体力消耗复用。 */
  presserId?: string
  flight?: MatchBallFlight
  actorId?: string
  receiverId?: string
  /** 出脚时已算好的射门目标（与 resolveShot 的 detailRng 对齐）。 */
  shotTarget?: GoalDetail['target']
  /** 选择时的评估摘要，用于赛后失败归因；不影响判定。 */
  decision?: { recognized: number; missed: number; chosenQ: number; bestQ: number }
  /** 出脚前已经知道的结果（点球大战等）；普通动作在 resolveAt 才 roll。 */
  fallback?: boolean
}

export type SetPieceState = {
  type: SetPieceType
  teamSide: MatchSide
  x: number
  y: number
  takerId?: string
  note?: string
}

export type RngState = { state: string; inc: string }

export type MatchFailureAggregate = {
  count: number
  examples: string[]
}

export type MatchSkillAggregate = {
  skillId: SkillId
  playerId: string
  side: MatchSide
  name: string
  conditions: number
  applied: number
}

export type ShootoutState = {
  home: number
  away: number
  attemptsHome: number
  attemptsAway: number
  current: MatchSide
  suddenDeath: boolean
  finished: boolean
}

export type MatchState = {
  seed: number
  rulesVersion?: number
  step: number
  clock: number
  durationSeconds: number
  half: 1 | 2
  phase: 'kickoff' | 'open' | 'setpiece' | 'shootout' | 'finished'
  score: { home: number; away: number }
  teams: [MatchTeamState, MatchTeamState]
  ball: BallState
  ballMotion?: BallMotion
  playbackFrames?: MatchPlaybackFrame[]
  /** v3：0.1 秒基础步计数；step 仍是动作/回合数。 */
  tick?: number
  /** v3：当前正在执行的动作。 */
  action?: MatchActionState | null
  /** v3：帧的单调序号，防止同一步的多帧被去重掉。 */
  playbackSeq?: number
  /** 球队光环/威慑缓存：按 step 失效，必须随存档恢复，否则读档后会在动作中途重算。 */
  teamTraitStep?: number
  teamTraits?: Record<string, number>
  /** v3 运动参数缓存：必须随存档恢复，否则会在动作中途按不同时刻重算 eff()。 */
  motionProfiles?: Record<string, { stamina: number; profile: { maxSpeed: number; acceleration: number; deceleration: number; turnRate: number } }>
  /** 最近一次成功传球：进球助攻要在读档后仍然成立。 */
  recordAssist?: { id: string; name: string; side: MatchSide; step: number }
  /** 最近一次可归属射门机会的传球；只用于高级统计，不改变助攻规则。 */
  recordKeyPass?: { id: string; side: MatchSide; step: number; receiverId?: string }
  possession: MatchSide | null
  pendingSetPiece: SetPieceState | null
  finished: boolean
  offside?: boolean
  /** 挑战赛：不生成新的伤病。 */
  noInjuries?: boolean
  shootout: ShootoutState | null
  /** 两回合次回合：上一回合比分，已换算成本场主客方向。 */
  shootoutOffset?: { home: number; away: number }
  log: MatchLogEntry[]
  commentary?: CommentaryEntry[]
  stats: { home: MatchTeamStats; away: MatchTeamStats }
  failures: Record<FailureReason, MatchFailureAggregate>
  playerFailures: Record<string, Partial<Record<FailureReason, number>>>
  skillStats: MatchSkillAggregate[]
  decisionStats: { recognized: number; missed: number; choices: Record<string, number>; missedChances?: number; missedChanceExamples?: string[] }
  instructions: MatchInstruction[]
  decisionRng: RngState
  resultRng: RngState
  lastGoalBy: MatchSide | null
  /** 新引擎（rulesVersion 4）的物理比赛存档；现有引擎没有这一项。 */
  pes?: unknown
}

export type MatchTeamInput = {
  id: string
  name: string
  color: string
  accent: string
  formationId: FormationId
  tactics: Tactics
  tacticalStyle?: import('../pes/tactics.ts').StyleId
  /** 下场比赛计划（给了且非 standard 时随比赛时间和比分自动触发战术阶段）。 */
  matchPlan?: import('../pes/match-plan.ts').MatchPlanId
  /** 十二项战术指令（docs/fm-tactical-styles-and-instructions.md）：给了才走新战术引擎分支。 */
  instructions?: import('../pes/tactics.ts').TacticalInstructionsV2
  /** 全队战术熟练度 0–1（缺省 1）。只在新指令下生效。 */
  familiarity?: number
  /** 是否启用 AI 主教练临场战术调度与智能换人。 */
  aiCoach?: boolean
  autoSubs?: AutoSubPlan
  chemistry?: Record<string, number>
  starters: { player: Player; role: RoleId; slotId: string }[]
  bench: Player[]
}

export type MatchEngineOptions = {
  seed: number
  home: MatchTeamInput
  away: MatchTeamInput
  knockout: boolean
  shootoutOffset?: { home: number; away: number }
  durationSeconds?: number
  offside?: boolean
  /** 挑战赛：不生成新的伤病。 */
  noInjuries?: boolean
  /** 2 只用于回归对照；默认使用当前规则版本。 */
  rulesVersion?: number
}

export type StepResult = {
  state: MatchState
  entry: MatchLogEntry | null
  finished: boolean
}

export type MatchEventContext = {
  attr?: AttrKey
  inBox?: boolean
  wide?: boolean
  crossing?: boolean
  aerial?: boolean
  passing?: boolean
  longRange?: boolean
  pressured?: boolean
  ownHalf?: boolean
  finalThird?: boolean
  oneOnOne?: boolean
  penalty?: boolean
}
