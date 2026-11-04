export const FIELD_ATTRIBUTES = [
  'passing',
  'firstTouch',
  'dribbling',
  'shooting',
  'tackling',
  'heading',
  'vision',
  'decisions',
  'offBall',
  'defPos',
  'anticipation',
  'composure',
  'teamwork',
  'acceleration',
  'speed',
  'agility',
  'strength',
  'endurance',
] as const

export const GK_ATTRIBUTES = ['reflexes', 'handling', 'rushing', 'oneOnOne'] as const

export const ALL_ATTRIBUTES = [...FIELD_ATTRIBUTES, ...GK_ATTRIBUTES] as const

export type FieldAttr = (typeof FIELD_ATTRIBUTES)[number]
export type GkAttr = (typeof GK_ATTRIBUTES)[number]
export type AttrKey = (typeof ALL_ATTRIBUTES)[number]
export type Attributes = Record<AttrKey, number>

export const POSITIONS = ['GK', 'CB', 'W', 'CM', 'ST'] as const
export type Position = (typeof POSITIONS)[number]
export type PositionTable = Record<Position, number>

export type Foot = 'L' | 'R' | 'B'

export type RoleId =
  | 'gk_line'
  | 'gk_sweeper'
  | 'cb_stopper'
  | 'cb_cover'
  | 'cb_ball'
  | 'w_winger'
  | 'w_support'
  | 'w_inside'
  | 'cm_organizer'
  | 'cm_destroyer'
  | 'cm_box2box'
  | 'st_finisher'
  | 'st_target'
  | 'st_runner'

export type FormationId = '1-2-3-1' | '1-3-2-1' | '1-2-2-2'

export type SkillId =
  | 'through_ball'
  | 'safe_pass'
  | 'one_touch'
  | 'box_hunter'
  | 'long_shot'
  | 'weak_foot'
  | 'sweeper'
  | 'iron_lung'
  | 'aerial'
  | 'wing_runner'
  | 'gk_sweeper'
  | 'gk_reflexes'
  | 'penalty_specialist'
  | 'injury_prevention'
  | 'injury_resilience'

export type SkillTier = 'silver' | 'gold' | 'rainbow'

export type TraitEffect =
  | 'vision'
  | 'finishing'
  | 'dribbling'
  | 'tackling'
  | 'aerial'
  | 'pace'
  | 'stamina'
  | 'gkWall'
  | 'gkSweep'
  | 'cross'
  | 'link'
  | 'overlap'

export type TraitId =
  | 'metronome'
  | 'visionary'
  | 'cold_blood'
  | 'poacher'
  | 'dribbler'
  | 'shield'
  | 'iron'
  | 'target'
  | 'pace'
  | 'engine'
  | 'wall'
  | 'shotstopper'
  | 'sweeper'
  | 'crosser'
  | 'halfspace'
  | 'link'
  | 'overlap'
  | 'anchor'
  | 'finisher'
  | 'enforcer'

export type StyleId =
  | 'gk_wall'
  | 'gk_shotstopper'
  | 'gk_sweeper'
  | 'cb_stopper'
  | 'cb_cover'
  | 'cb_ballplaying'
  | 'fb_attacking'
  | 'fb_playmaker'
  | 'w_dribbler'
  | 'w_crosser'
  | 'w_finisher'
  | 'w_playmaker'
  | 'w_engine'
  | 'cm_playmaker'
  | 'cm_creator'
  | 'cm_destroyer'
  | 'cm_box2box'
  | 'cm_mezzala'
  | 'cm_engine'
  | 'st_finisher'
  | 'st_poacher'
  | 'st_target'
  | 'st_runner'
  | 'st_false9'

export type RouteId = 'safe_organization' | 'through_passing' | 'hold_shape' | 'press_hunt' | 'calm_finish' | 'long_range'

export type Personality = {
  professionalism: number
  ambition: number
  adaptability: number
}

export type Player = {
  id: string
  seedId: string
  name: string
  enName: string
  country: string
  era: string
  number: number
  foot: Foot
  height: number
  attrs: Attributes
  ceilings: Attributes
  pa: number
  positions: PositionTable
  personality: Personality
  traitId: TraitId
  style: StyleId
  skills: SkillId[]
  skillTiers?: Partial<Record<SkillId, SkillTier>>
  signatureSkill?: SkillId
  version: number
  history?: TrainingLogEntry[]
  baseAttrs: Attributes
  basePositions: PositionTable
  basePersonality: Personality
  /** 赛季体能/状态，1-100；比赛开始时映射为初始体力。 */
  condition: number
  /** 训练精力，1-100；每次训练消耗，休息恢复。与比赛体力分离。 */
  energy: number
  /** 年龄；旧存档没有时按 24 岁处理。 */
  age?: number
  /** 真实球星跨代重生的稳定键。 */
  starKey?: string
  /** 第几代同名球员；原始球星为 0。 */
  generation?: number
  contract?: Contract
}

export type Contract = {
  clubId: string
  /** 每轮工资。 */
  wage: number
  /** 到期赛季序号；该赛季结束后进入自由市场。 */
  expiresSeason: number
}

export type TierId = 'champions' | 'division1' | 'division2'
export type ConferenceId = 'north' | 'south'

export type WorldClub = AITeamDef & {
  tier: TierId
  conference?: ConferenceId
  starPlayerIds: string[]
  starCount: number
  isPlayer?: boolean
}

export type PromotionMatch = {
  id: string
  stage: 'quarter' | 'semi' | 'third' | 'final'
  homeId: string
  awayId: string
  score?: { home: number; away: number }
  shootout?: { home: number; away: number }
}

export type PromotionPlayoff = {
  seasonIndex: number
  teams: string[]
  matches: PromotionMatch[]
  promoted: string[]
  finished: boolean
}

export type WorldSeasonSummary = {
  seasonIndex: number
  champion: string
  promotions: string[]
  relegations: string[]
}

export type WorldState = {
  version: 1
  seasonIndex: number
  seasonStartedAt: number
  clubs: WorldClub[]
  divisions: SeasonState[]
  playerDivisionId: string
  /** 所有真实球星的年龄，按 player.id。 */
  starAges: Record<string, number>
  promotionPlayoff?: PromotionPlayoff
  lastPromotionPlayoff?: PromotionPlayoff
  history: WorldSeasonSummary[]
}

export type Suspension = {
  matches: number
  atRound: number
}

export type GameSettings = {
  offside: boolean
}

export type Tactics = {
  attack: 'middle' | 'wing' | 'balanced'
  passing: 'short' | 'mixed' | 'direct'
  tempo: 'slow' | 'normal' | 'fast'
  line: 'low' | 'mid' | 'high'
  press: 'low' | 'mid' | 'high'
}

export type MatchMentality = 'attack' | 'balanced' | 'defend'
export type AutoSubPlan = { timed: { atMinute?: number; /** 旧档字段：按旧 10 分钟比赛秒数解释，新计划使用 atMinute。 */ atSeconds?: number; outId: string; inId: string }[]; staminaBelow: number | null; onInjury: boolean }

export type Starter = {
  slotId: string
  playerId: string
  role: RoleId
}

export type Lineup = {
  formationId: FormationId
  starters: Starter[]
  bench: string[]
  tactics: Tactics
}

export type TrainingLogKind = 'action' | 'event' | 'test' | 'system'

export type TrainingLogEntry = {
  action: number
  week: number
  kind: TrainingLogKind
  title: string
  text: string
  gains?: Partial<Record<AttrKey, number>>
  fatigue?: number
}

export type TrainingExchange = {
  week: number
  opponentId: string
  opponentName: string
  homeScore: number
  awayScore: number
  result: 'win' | 'draw' | 'loss'
}

export type TrainingSession = {
  /** 无此字段的旧课程继续使用旧行动规则。 */
  scheduleVersion?: 1
  scheduleSeed?: number
  lowMoodWeeks?: number[]
  exchangeMatches?: TrainingExchange[]
  playerId: string
  seed: number
  candidate: Player
  academyLevel?: number
  stadiumLevel?: number
  facilityLevels?: Pick<EconomyState, 'stadium' | 'academy' | 'medical' | 'shop' | 'sponsor'>
  baseVersion: number
  /** 旧培养无此字段，仍按 18 次完成。 */
  actionsTotal?: number
  action: number
  fatigue: number
  energy: number
  routeId: RouteId | null
  routePoints: number
  flags: string[]
  eventCounts: Record<string, number>
  lastEventAction: Record<string, number>
  trained: Partial<Record<AttrKey, number>>
  trainedSinceEvent: Partial<Record<AttrKey, number>>
  focusHistory: AttrKey[]
  pendingEventId: string | null
  pendingEventAction: number | null
  log: TrainingLogEntry[]
  completed: boolean
  startedAt: number
}

export type EventCategory = 'mainline' | 'training' | 'personality' | 'teammate' | 'pressure' | 'chain' | 'other'

export type EventEffect = {
  text?: string
  attrs?: Partial<Record<AttrKey, number>>
  fatigue?: number
  route?: { id: RouteId; points: number }
  routeOwn?: number
  skill?: SkillId
  routeSkill?: boolean
  position?: { pos: Position; amount: number }
  personality?: Partial<Personality>
  flags?: string[]
}

export type EventCheck = {
  attrs: AttrKey[]
  base?: number
  scale?: number
}

export type EventBranch = {
  chanceText: string
  check?: EventCheck
  p?: number
  success: EventEffect
  failure: EventEffect
}

export type EventOption = {
  id: string
  label: string
  hint: string
  effect?: EventEffect
  branch?: EventBranch
}

export type EventTrigger = {
  minAction?: number
  maxAction?: number
  latestAction?: number
  minAttrs?: Partial<Record<AttrKey, number>>
  trained?: Partial<Record<AttrKey, number>>
  trainedAny?: Partial<Record<AttrKey, number>>
  trainedSince?: Partial<Record<AttrKey, number>>
  trainedSinceAny?: Partial<Record<AttrKey, number>>
  minFatigue?: number
  route?: RouteId
  routeMin?: number
  noRoute?: boolean
  prior?: string[]
  flag?: string
  playerCategory?: 'field' | 'gk'
}

export type EventDef = {
  id: string
  title: string
  category: EventCategory
  chain?: string
  stage?: number
  mainline?: boolean
  priority?: number
  weight: number
  once?: boolean
  cooldown?: number
  trigger: EventTrigger
  maxTimes?: number
  mutex?: string[]
  text: string
  options: EventOption[]
}

export type MatchTeamStats = {
  possession: number
  passes: number
  passesCompleted: number
  shots: number
  shotsOnTarget: number
  goals: number
  interceptions: number
  tackles: number
  fouls: number
  corners: number
  xg: number
  distance: number
  yellowCards: number
  redCards: number
}

export type PlayerMatchStats = {
  playerId: string
  sourceId?: string
  name: string
  side: 'home' | 'away'
  minutes: number
  passes: number
  passesCompleted: number
  shots: number
  goals: number
  tackles: number
  interceptions: number
  distance: number
  staminaLeft: number
  touches: number
  yellowCards?: number
  redCards?: number
}

export type SkillMatchStat = {
  skillId: SkillId
  playerId: string
  side: 'home' | 'away'
  name: string
  conditions: number
  applied: number
}

export type FailureReason = 'unrecognized' | 'misjudged' | 'position_timing' | 'execution'

export type FailureStat = {
  reason: FailureReason
  count: number
  examples: string[]
}

export type ShotChanceType = 'open_goal' | 'clear_chance' | 'box_open' | 'normal' | 'difficult' | 'penalty' | 'free_kick' | 'header'

export type ShotChanceDetail = {
  type: ShotChanceType
  label: string
  base: number
  floor: number
  ceiling: number
  goalBase: number
  distance: number
  angle: number
  pressure: number
  blockers: number
  reason: string
}

export type GoalDetail = {
  playerId: string
  playerName: string
  side: 'home' | 'away'
  clock: number
  half: 1 | 2
  origin: { x: number; y: number }
  distance: number
  bodyPart: 'left' | 'right' | 'head'
  technique: 'power' | 'placed' | 'header'
  situation: 'open' | 'penalty' | 'free_kick'
  chance?: ShotChanceType
  target: 'top_left' | 'top_center' | 'top_right' | 'bottom_left' | 'bottom_center' | 'bottom_right'
}

export type CommentaryEntry = {
  seq: number
  clock: number
  half: 1 | 2
  type: MatchLogEntry['type']
  team: 'home' | 'away' | 'none'
  text: string
  score: { home: number; away: number }
  shootoutScore?: { home: number; away: number }
}

export type MatchLogEntry = {
  seq: number
  clock: number
  half: 1 | 2
  type:
    | 'kickoff'
    | 'pass'
    | 'dribble'
    | 'shot'
    | 'tackle'
    | 'contest'
    | 'goal'
    | 'save'
    | 'block'
    | 'miss'
    | 'out'
    | 'foul'
    | 'injury'
    | 'setpiece'
    | 'penalty'
    | 'half'
    | 'full'
    | 'sub'
    | 'tactic'
    | 'info'
  team: 'home' | 'away' | 'none'
  playerId?: string
  text: string
  probabilities?: Record<string, number>
  ratings?: Record<string, number>
  shotChance?: ShotChanceDetail
  roll?: number
  reason?: FailureReason
  skill?: { id: SkillId; condition: boolean; text: string }
  injury?: { personId: string; recoveryDays: number; recoverAt?: number }
  card?: 'yellow' | 'red'
  offside?: boolean
  goal?: GoalDetail
  snapshot?: MatchSnapshot
}

export type MatchPlayerSnapshot = {
  id: string
  name: string
  number: number
  side: 'home' | 'away'
  x: number
  y: number
  stamina: number
  position: Position
  onPitch: boolean
}

export type MatchSnapshot = {
  clock: number
  half: 1 | 2
  score: { home: number; away: number }
  ball: { x: number; y: number; ownerId?: string }
  players: MatchPlayerSnapshot[]
}

export type MatchRecord = {
  id: string
  seed: number
  createdAt: number
  durationSeconds?: number
  isLeague: boolean
  round?: number
  homeId: string
  awayId: string
  homeName: string
  awayName: string
  score: { home: number; away: number }
  shootout?: { home: number; away: number }
  result: 'win' | 'draw' | 'loss'
  stats: { home: MatchTeamStats; away: MatchTeamStats }
  playerStats: PlayerMatchStats[]
  skillStats: SkillMatchStat[]
  failureStats: FailureStat[]
  keyEvents: MatchLogEntry[]
  commentary?: CommentaryEntry[]
  goalDetails?: GoalDetail[]
  decisionStats?: { recognized: number; missed: number; choices: Record<string, number>; missedChances?: number; missedChanceExamples?: string[] }
  instructions: MatchInstruction[]
  lineup: Lineup
  opponentId: string
  autoSimulated?: boolean
}

export type MatchInstruction = {
  step: number
  kind: 'sub' | 'tactic'
  autoReason?: 'injury' | 'timed' | 'stamina'
  outId?: string
  inId?: string
  role?: RoleId
  tactics?: Tactics
  mentality?: MatchMentality
}

export type Fixture = {
  round: number
  homeId: string
  awayId: string
  isPlayer: boolean
  played: boolean
  score?: { home: number; away: number }
  matchId?: string
  shootout?: { home: number; away: number }
  gameDay?: number
  kickoffAt?: number
  autoSimulated?: boolean
}

export type SeasonTableRow = {
  teamId: string
  played: number
  won: number
  drawn: number
  lost: number
  gf: number
  ga: number
  points: number
}

export type SeasonState = {
  index: number
  round: number
  fixtures: Fixture[]
  table: SeasonTableRow[]
  finished: boolean
  champion: string | null
  playerFinish: number | null
  seed: number
  startedAt: number
  gameDayMs: number
  roundGameDays: number
  divisionId?: string
  tier?: TierId
  conference?: ConferenceId
  clubIds?: string[]
}

export type AITeamDef = {
  id: string
  name: string
  short: string
  color: string
  accent: string
  style: string
  formationId: FormationId
  tactics: Tactics
  strength: number
  playerNames: string[]
}

export type AITeam = AITeamDef & {
  lineup: Lineup
  players: Player[]
  starPlayerIds: string[]
  isPlayer?: boolean
  tier?: TierId
  conference?: ConferenceId
  starCount?: number
}

export type FacilityId = 'stadium' | 'academy' | 'medical' | 'shop' | 'sponsor'

export type EconomyState = {
  balance: number
  stadium: number
  academy: number
  medical: number
  shop: number
  sponsor: number
  lastIncomeRound: number
}

export type GameState = {
  version: number
  createdAt: number
  seed: number
  clubName: string
  economy?: EconomyState
  market?: { listings: { player: Player; price: number; listedRound?: number }[]; lastSettledRound: number }
  roster: Player[]
  lineup: Lineup
  autoSubs?: AutoSubPlan
  training: Record<string, TrainingSession>
  injuries?: Record<string, number>
  candidates: Record<string, Player>
  season: SeasonState
  seasonHistory?: SeasonState[]
  aiTeams: AITeam[]
  freeStars: Player[]
  matchHistory: MatchRecord[]
  challengeHistory: MatchRecord[]
  activeMatch?: ActiveMatchSave
  ui?: { screen: string }
  world?: WorldState
  reserveStars?: Player[]
  suspensions?: Record<string, Suspension>
  yellowCounts?: Record<string, number>
  settings?: GameSettings
}

export type MatchContext = {
  isLeague: boolean
  round?: number
  opponentId: string
  opponentName: string
  seed: number
  homeAway: 'home' | 'away'
  durationSeconds?: number
  offside?: boolean
}

export type ActiveMatchSave = {
  context: MatchContext
  engineState: unknown
  instructions: MatchInstruction[]
  lineup: Lineup
  startedAt: number
  elapsedSeconds?: number
  coachPausesLeft: number
}

export type ReviewRecommendation = {
  title: string
  detail: string
  tone: 'good' | 'warn' | 'bad'
}
