import type {
  AutoSubPlan,
  AttrKey,
  Attributes,
  CommentaryEntry,
  FailureReason,
  FormationId,
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
}

export type MatchTeamState = {
  side: MatchSide
  id: string
  name: string
  color: string
  accent: string
  formationId: FormationId
  tactics: Tactics
  mentality?: MatchMentality
  players: MatchPlayerState[]
  bench: MatchPlayerState[]
  autoSubs?: AutoSubPlan
  subsUsed: number
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
  from: MatchPlaybackPose
  to: MatchPlaybackPose
  motion?: BallMotion
  restart?: SetPieceType
  goal?: boolean
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
  possession: MatchSide | null
  pendingSetPiece: SetPieceState | null
  finished: boolean
  offside?: boolean
  shootout: ShootoutState | null
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
}

export type MatchTeamInput = {
  id: string
  name: string
  color: string
  accent: string
  formationId: FormationId
  tactics: Tactics
  autoSubs?: AutoSubPlan
  starters: { player: Player; role: RoleId; slotId: string }[]
  bench: Player[]
}

export type MatchEngineOptions = {
  seed: number
  home: MatchTeamInput
  away: MatchTeamInput
  knockout: boolean
  durationSeconds?: number
  offside?: boolean
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
