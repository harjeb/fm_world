import type { ScoutReport } from './scouting.ts'
import type { YouthOrigin, YouthState } from './youth.ts'
import type { PositionProfile } from './natural-positions.ts'

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

export type DetailedPosition = 'GK' | 'DL' | 'DC' | 'DR' | 'WBL' | 'WBR' | 'DM' | 'ML' | 'MC' | 'MR' | 'AML' | 'AMC' | 'AMR' | 'ST'
/** Missing entries fall back to the corresponding coarse position. */
export type DetailedPositionTable = Partial<Record<DetailedPosition, number>>

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
  | 'w_back'
  | 'cm_organizer'
  | 'cm_destroyer'
  | 'cm_box2box'
  | 'st_finisher'
  | 'st_target'
  | 'st_runner'

/** 11 人制阵型（不含门将的写法）。 */
export type ElevenFormationId = '4-4-2' | '4-3-3' | '4-2-3-1' | '3-5-2' | '5-3-2' | '4-1-4-1' | '3-4-3' | '4-1-2-1-2'
/** 旧的 7 人制阵型：只用来读取迁移前的存档和进行中的旧比赛，不能再选。 */
export type LegacyFormationId = '1-2-3-1' | '1-3-2-1' | '1-2-2-2'
export type FormationId = ElevenFormationId | LegacyFormationId

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
  | 'gk_safe_hands'
  | 'gk_high_ball'
  | 'gk_close_down'
  | 'gk_long_kick'
  | 'cb_intercept'
  | 'cb_block'
  | 'cb_cover'
  | 'wing_cross'
  | 'wing_support'
  | 'wing_track_back'
  | 'cm_long_pass'
  | 'cm_shield'
  | 'st_breakaway'
  | 'injury_prevention'
  | 'injury_resilience'
  | 'lg_drill_master'
  | 'lg_fast_learner'
  | 'lg_physical_gift'
  | 'lg_technical_gift'
  | 'lg_ceiling_break'
  | 'lg_iron_constitution'
  | 'lg_recovery_pro'
  | 'lg_match_ready'
  | 'lg_vision_master'
  | 'lg_calm_mind'
  | 'lg_opportunist'
  | 'lg_anticipate'
  | 'lg_leader'
  | 'lg_game_management'
  | 'lg_clutch'
  | 'lg_pass_vision'
  | 'lg_off_ball_iq'
  | 'lg_set_piece_iq'
  | 'lg_rabona'
  | 'lg_bicycle'
  | 'lg_diving_header'
  | 'lg_rainbow_flick'
  | 'lg_elastico'
  | 'lg_roulette'
  | 'lg_low_drive'
  | 'lg_chip'
  | 'lg_knuckleball'
  | 'lg_trivela'
  | 'lg_slide_tackle'
  | 'lg_goal_line_clearance'
  | 'lg_quick_throw'
  | 'lg_volley'
  | 'lg_super_long_shot'
  | 'lg_cannon_shot'
  | 'lg_rising_shot'
  | 'lg_halfway_lob'
  | 'lg_goal_second_wind'
  | 'lg_assist_second_wind'
  | 'lg_tackle_second_wind'
  | 'lg_save_second_wind'
  | 'lg_second_win'
  | 'lg_halftime_recovery'
  | 'lg_marathon'
  | 'lg_second_half_legs'
  | 'lg_defensive_economy'
  | 'lg_off_ball_economy'
  | 'lg_press_machine'
  | 'lg_wing_engine'
  | 'lg_gk_economy'
  | 'lg_stamina_regen'
  | 'lg_peak_striker'
  | 'lg_peak_engine'
  | 'lg_peak_wall'
  | 'lg_peak_wing'
  | 'lg_peak_keeper'
  | 'lg_legend_star'
  | ShopSkillId

export type ShopSkillId =
  | 'sh_buildup'
  | 'sh_box_defense'
  | 'sh_mid_destroyer'
  | 'sh_clear_header'
  | 'sh_clean_tackle'
  | 'sh_long_block'
  | 'sh_switch_play'
  | 'sh_halfspace_pass'
  | 'sh_ball_magnet'
  | 'sh_counter_press'
  | 'sh_ball_carrier'
  | 'sh_lane_cut'
  | 'sh_cut_inside'
  | 'sh_cutback'
  | 'sh_dead_ball'
  | 'sh_cut_in_shot'
  | 'sh_clinical_1v1'
  | 'sh_target_header'
  | 'sh_power_header'
  | 'sh_free_kick'
  | 'sh_poised_finish'
  | 'sh_target_link'
  | 'sh_tight_angle'
  | 'sh_box_poacher'
  | 'sh_gk_long_save'
  | 'sh_gk_penalty'
  | 'sh_gk_box_command'
  | 'sh_gk_aerial_save'
  | 'sh_gk_short_build'
  | 'sh_gk_loose_claim'
  | ShopAuxSkillId

export type ShopAuxSkillId =
  | 'sh_aux_penalty_calm'
  | 'sh_aux_comeback'
  | 'sh_aux_hold_lead'
  | 'sh_aux_late_surge'
  | 'sh_aux_fast_start'
  | 'sh_aux_super_sub'
  | 'sh_aux_home_boost'
  | 'sh_aux_away_steel'
  | 'sh_aux_tired_grit'
  | 'sh_aux_discipline'

export type PeakSkillId = 'lg_peak_striker' | 'lg_peak_engine' | 'lg_peak_wall' | 'lg_peak_wing' | 'lg_peak_keeper'
export type SpecialBookSkillId = 'lg_legend_star'
export type LegendSkillId = Exclude<Extract<SkillId, `lg_${string}`>, PeakSkillId | SpecialBookSkillId>

export type SkillTier = 'silver' | 'gold' | 'rainbow'
export type LegendBookTier = SkillTier
/** 任何技能都可以成为技能书：传奇 / 巅峰书来自挑战，基础技能书主要来自联赛掉落。 */
export type SkillBookId = SkillId
export type LegendBook = { id: SkillBookId; tier: LegendBookTier }
/** 联机联赛赛后掉落：场上球员的某项技能按其档位变成技能书。 */
export type LeagueBookDrop = { playerId: string; playerName: string; side: 'home' | 'away'; id: SkillBookId; tier: LegendBookTier; minutes: number }

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

export type BaseTraitId =
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

/** 球星专属特性的 id 是 star_ 加种子 id，比如 star_p001。 */
export type TraitId = BaseTraitId | `star_${string}`

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
  /** Stable natural-position floors; independent of equipped card/training. */
  positionProfile?: PositionProfile
  /** 永久的青训出身标记；提拔和转会后仍保留。 */
  youthOrigin?: YouthOrigin
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
  detailedPositions?: DetailedPositionTable
  detailedPositionsVersion?: 1
  personality: Personality
  traitId: TraitId
  style: StyleId
  skills: SkillId[]
  skillTiers?: Partial<Record<SkillId, SkillTier>>
  signatureSkill?: SkillId
  /** 0 表示身上是原始属性，否则等于已装备球员卡的 version。 */
  version: number
  history?: TrainingLogEntry[]
  baseAttrs: Attributes
  basePositions: PositionTable
  baseDetailedPositions?: DetailedPositionTable
  baseDetailedPositionsVersion?: 1
  basePersonality: Personality
  /** 第一次换上球员卡时记下的原始技能；此前 skills 本身就是原始技能。 */
  baseSkills?: SkillId[]
  baseSkillTiers?: Partial<Record<SkillId, SkillTier>>
  /** 当前装备的球员卡；没有则使用原始属性。 */
  equippedCardId?: string
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
  /** 精力上次结算的时间（毫秒）；精力按经过的游戏日连续恢复。 */
  energyAt?: number
  /** 体能恢复上次结算到的时间（毫秒）；体能每小时按比例恢复，见 condition.ts。 */
  recoveryAt?: number
  /** 不满（拒绝了别的球队的高价报价）：截止时间之前精力恢复大减。 */
  unhappy?: { until: number; reason: string }
  /** 自由市场当天补进来的随机球员（第几个游戏日）；第二天没人买就销毁，签下后清掉。 */
  marketDay?: number
}

/** AI 俱乐部给玩家球队的报价。4 个游戏日内不回复就算拒绝。 */
export type TransferOffer = {
  id: string
  clubId: string
  clubName: string
  tier?: TierId
  playerId: string
  playerName: string
  amount: number
  /** 报价时这名球员的身价；amount ≥ 身价 × 1.3 算高价，拒绝会让球员不满。 */
  value: number
  createdAt: number
  expiresAt: number
  status: 'pending' | 'accepted' | 'rejected' | 'expired' | 'withdrawn'
  resolvedAt?: number
  note?: string
}

/**
 * 球员卡：一轮培养的成果，属于某一名球员，生成后不再变化。
 * 姓名、年龄、合同、体力、精力、伤病、停赛都在 Player 上，换卡不影响。
 */
export type PlayerCard = {
  /** 锁定后不能回收或手动删除；挂牌出售成交仍按原规则销毁。 */
  recycleLocked?: boolean
  id: string
  playerId: string
  /** 球员离队后库存里仍要显示名字。 */
  playerName: string
  /** 玩家给这张卡起的名字；同一名球员的卡名不重复。 */
  customName?: string
  /** 这名球员的第几张卡，只用于显示。 */
  serial: number
  /** 新卡都是 1；旧存档里逐轮累积出来的成果会大于 1。 */
  version: number
  routeId: RouteId | null
  createdAt: number
  attrs: Attributes
  positions: PositionTable
  detailedPositions?: DetailedPositionTable
  detailedPositionsVersion?: 1
  personality: Personality
  skills: SkillId[]
  skillTiers?: Partial<Record<SkillId, SkillTier>>
  history?: TrainingLogEntry[]
}

export type Contract = {
  clubId: string
  /** 每轮工资。 */
  wage: number
  /** 到期赛季序号；该赛季结束后进入自由市场。 */
  expiresSeason: number
}

export type TierId = 'champions' | 'division1' | 'division2'
/** 二级联赛的赛区：north/south 是开局的南北两区，二级满员后服务器会开出 zone3、zone4…… */
export type ConferenceId = 'north' | 'south' | `zone${number}`

export type WorldClub = AITeamDef & {
  /** 接管/改名前的队名，换教练时只恢复此名。 */
  initialName?: string
  tier: TierId
  conference?: ConferenceId
  starPlayerIds: string[]
  starCount: number
  isPlayer?: boolean
  /** 被玩家接管后 id 会变成 player，开局名单仍按这支队原来的 id 生成，否则选哪支队都一样。 */
  squadKey?: string
  /** 当前实时生效的阵型与战术摘要（联机时由共享球队阵容同步，用于跨赛区友谊赛展示，不覆盖建队基底 `tactics`）。 */
  liveFormationId?: FormationId
  liveTactics?: Tactics
  liveTacticalStyle?: import('./pes/tactics.ts').StyleId
}

export type PromotionMatch = {
  id: string
  /** qualifier=各区 2/3 名加赛，group=小组循环（瑞士轮），runnerup=小组第二再战，legacy 旧赛制用 quarter/semi/third/final。 */
  stage: 'qualifier' | 'group' | 'runnerup' | 'quarter' | 'semi' | 'third' | 'final'
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
  /** 进入小组赛的两组球队。 */
  groups?: string[][]
  /** 小组第二再战那一组的球队。 */
  runnerUps?: string[]
}

export type WorldSeasonSummary = {
  seasonIndex: number
  champion: string
  promotions: string[]
  relegations: string[]
  /** 该赛季冠军联赛最终前四，用于下一赛季传奇杯参赛资格。 */
  championsTop4?: string[]
}

export type WorldState = {
  /** Missing means legacy deterministic generation; only new worlds/seasons enable the new generator. */
  positionGenerationVersion?: 1
  version: 1
  seasonIndex: number
  seasonStartedAt: number
  /** 游戏第一天对应的真实时间（2026/11/01）；旧存档缺省时由赛季开始时间推算。 */
  calendarStartAt?: number
  clubs: WorldClub[]
  divisions: SeasonState[]
  playerDivisionId: string
  /** 所有真实球星的年龄，按 player.id。 */
  starAges: Record<string, number>
  /** 单机跨赛区转会后卖方的持久化快照。 */
  transferTeams?: Record<string, AITeam>
  promotionPlayoff?: PromotionPlayoff
  lastPromotionPlayoff?: PromotionPlayoff
  /** 正式杯赛系统已启用；第 6 轮以前赛程可能尚未生成。 */
  seasonCupMode?: 1
  /** 全世界共享的正式赛季杯赛（旧赛季缺省）。 */
  seasonCups?: import('./season-cups.ts').SeasonCups
  seasonCupHistory?: import('./season-cups.ts').SeasonCups[]
  history: WorldSeasonSummary[]
  /** 赛程日历版本：2 = 一天两轮（北京时间 12:00、20:00）。 */
  kickoffSchedule?: number
  /** 单机“跳至比赛日”累计把存档时钟往前拨了多少毫秒；开赛时间点按存档时钟算（联机永远是 0）。 */
  clockShift?: number
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
export type AutoSubScoreState = 'any' | 'leading' | 'drawing' | 'trailing' | 'not_leading'
export type AutoSubPreferBy = 'proficiency' | 'stamina' | 'ca'
export type AutoSubConditionRule = {
  /** 目标范围：任意位置 / 指定大位置（GK·CB·W·CM·ST） / 指定阵型槽位 / 指定球员 */
  targetKind: 'any' | 'position' | 'slot' | 'player'
  targetValue?: string
  staminaBelow: number
  minMinute?: number
  scoreState?: AutoSubScoreState
  /** 为空或省略时自动挑选同位置最佳可用替补；填替补球员 ID 时定向换上该替补 */
  inId?: string
}
export type AutoSubPlan = {
  timed: { atMinute?: number; /** 旧档字段：按旧 10 分钟比赛秒数解释，新计划使用 atMinute。 */ atSeconds?: number; outId: string; inId: string }[]
  staminaBelow: number | null
  /** 赛前轮换体能阈值；缺省或 null 关闭。 */
  preMatchStaminaBelow?: number | null
  /** 全局体力换人生效位置（缺省代表全部 5 个位置，兼容旧存档）。 */
  staminaPositions?: Position[]
  /** 全局体力换人最早生效分钟（0–89.9，缺省 0）。 */
  staminaMinMinute?: number
  /** 自动挑选替补时的排序偏好（缺省 'proficiency'）。 */
  preferBy?: AutoSubPreferBy
  /** 按体力 + 指定位置/槽位/球员/比分触发的智能换人规则（最多 5 条）。 */
  conditionRules?: AutoSubConditionRule[]
  onInjury: boolean
}

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
  /** 赛前选择的战术风格模板（仅用于展开默认指令与标签展示，不直接参与模拟加成）。 */
  tacticalStyle?: import('./pes/tactics.ts').StyleId
  /** 赛前十二项战术指令；缺省时沿用旧五项战术映射。 */
  tacticalInstructions?: import('./pes/tactics.ts').TacticalInstructionsV2
  /** 下场比赛计划（如全力争胜、龟缩防守等）；缺省或 standard 为常规部署。 */
  matchPlan?: import('./pes/match-plan.ts').MatchPlanId
  /** 玩家自己摆的位置（0–1 归一化坐标），key 是 starter.slotId。没摆过的位置用阵型默认值。 */
  customPositions?: Record<string, { x: number; y: number }>
  /** 玩家命名保存的战术配置。 */
  presets?: TacticPreset[]
}

export type TacticPreset = {
  id: string
  name: string
  createdAt: number
  lineup: Omit<Lineup, 'presets'>
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
  /** 开赛时双方的RANK（首发 CA 之和，对手按基础卡算）。 */
  ownRating?: number
  opponentRating?: number
  homeScore: number
  awayScore: number
  result: 'win' | 'draw' | 'loss'
}

export type TrainingSkillChoice =
  | { source: 'book'; id: SkillBookId; tier: LegendBookTier }
  | { source: 'teammate'; id: SkillId; mentor: Pick<Player, 'id' | 'name' | 'positions' | 'skillTiers'> }
  | { source: 'basic'; id: SkillId }

export type TrainingSession = {
  /** 本轮开始时消耗的培养点，结束或中途取消均不退。 */
  qualityBonusPoints?: 0 | 10 | 20 | 30
  /** 无此字段的旧课程继续使用旧行动规则。 */
  scheduleVersion?: 1
  /** 陪练队友：开局选定的其他 6 名队友，只给本次培养的主角加成长，不消耗精力也不涨属性。 */
  partnerIds?: string[]
  scheduleSeed?: number
  /** Role snapshot used to keep match-training rewards stable throughout the course. */
  matchRole?: RoleId
  lowMoodWeeks?: number[]
  exchangeMatches?: TrainingExchange[]
  playerId: string
  seed: number
  candidate: Player
  /** 当前所属俱乐部的奖杯上限加成；夺冠后会同步到进行中的培养。 */
  cupCeilingBonus?: number
  /** 本轮携带的技能书快照；书不消耗。 */
  books?: LegendBook[]
  /** 已抽出的交流赛后选项及同一行动等待处理的普通事件，均随存档保存。 */
  pendingBookChoices?: LegendBook[]
  /** 新版交流赛技能候选；包含来源与队友快照，读档不重新抽签。 */
  pendingSkillChoices?: TrainingSkillChoice[]
  /** 本轮随机挑出的最多五名技能来源，仅能来自共同培养的队友。 */
  skillTeacherIds?: string[]
  queuedEventId?: string
  academyLevel?: number
  stadiumLevel?: number
  /** 培养快照里的设施阶段；旧存档/旧课程可能缺新增的两个设施。 */
  facilityLevels?: Partial<Pick<EconomyState, FacilityId>>
  /** 设施快照用的是“阶段”（1–25）还是旧存档的“等级”（1–5）。 */
  facilityStageVersion?: number
  baseVersion: number
  /** 培养完成后生成的球员卡。 */
  cardId?: string
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
  /** 直接按存档刻度发放的固定属性净增（如传奇之星彩色事件 +100），不经事件倍率/建筑/心情缩放，仍受上限约束。 */
  flatAttrs?: Partial<Record<AttrKey, number>>
  fatigue?: number
  route?: { id: RouteId; points: number }
  routeOwn?: number
  skill?: SkillId
  bookSkill?: { id: SkillBookId; tier: LegendBookTier }
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
  /** 传奇技能书：动态概率由 bookLearnChance() 计算，不走 branch 的线性公式。 */
  book?: { id: SkillBookId; tier: LegendBookTier }
  /** 交流赛后的技能学习（含书、队友和基础技能）。 */
  trainingSkill?: TrainingSkillChoice
  /** 传奇之星隐藏事件：100% 继承同位置真实球星的彩虹招牌技能。 */
  rainbowInherit?: { skill: SkillId; starName: string }
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
  /** 特殊视觉稀有度（如传奇之星触发的彩色事件）。 */
  rarity?: 'rainbow'
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
  /** Display minutes (0-90), used to measure actual overlap between teammates. */
  onMinute?: number
  offMinute?: number
  passes: number
  passesCompleted: number
  shots: number
  /** 以下高级数据只在完整记录的比赛中存在；旧战报缺省表示未知，而非零。 */
  shotsOnTarget?: number
  xg?: number
  chancesCreated?: number
  chancesConverted?: number
  xa?: number
  tackleAttempts?: number
  saves?: number
  /** 赛后按本场事件计算的 1–10 分游戏评分。 */
  rating?: number
  goals: number
  /** 助攻：进球前最后一次成功传球。旧战报没有这一项。 */
  assists?: number
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
  /** 助攻者；点球、单干或对方失误造成的进球没有。 */
  assistId?: string
  assistName?: string
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
  /** 射门落点（球门线上的具体位置），回放据此把球踢向角落而不是球门正中。 */
  shotAim?: { x: number; y: number }
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
  /** 这场比赛属于第几赛季；旧战报没有这一项，只用于球员数据统计。 */
  seasonIndex?: number
  durationSeconds?: number
  isLeague: boolean
  /** PvE 模式；联赛和旧战报没有。 */
  mode?: MatchMode
  /** 巅峰之路关卡；仅 mode = peak。 */
  stage?: number
  /** 杯赛 id / 场次 id；仅 mode = cup。 */
  cupId?: string
  cupFixtureId?: string
  /** 次回合总比分，按本场主客方向。 */
  aggregateScore?: { home: number; away: number }
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
  /** 联机联赛：服务器留着开球时的引擎初始状态，可以在复盘页 2D 重看整场（`GET /api/match/replay`）。 */
  hasReplay?: boolean
  /** 联机联赛赛后技能书掉落（只给真人执教的球队，服务器判定）。 */
  bookDrops?: LeagueBookDrop[]
  /** 联机精简模式：文字解说、关键事件、技能统计等复盘明细按需从 /api/match/record 拉取。 */
  detailDeferred?: true
}

export type MatchInstruction = {
  step: number
  kind: 'sub' | 'tactic'
  autoReason?: 'injury' | 'timed' | 'stamina' | 'tactical' | 'plan' | 'ai'
  side?: 'home' | 'away'
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
  /** 本场进球与助攻（含 AI 对 AI），供射手榜/助攻榜统计。 */
  scorers?: { playerId: string; name: string; goals: number; teamId?: string }[]
  assisters?: { playerId: string; name: string; assists: number; teamId?: string }[]
  /** 服务器共享世界中首次提交这场真实比赛的教练 ID。 */
  reportedBy?: string
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
  /** 赛程日历版本：2 = 一天两轮（北京时间 12:00、20:00）。没有的是旧的一天一轮，读档时迁移。 */
  kickoffSchedule?: number
  /** 单机“跳至比赛日”累计把存档时钟往前拨了多少毫秒；开赛时间点按存档时钟算（联机永远是 0）。 */
  clockShift?: number
  /** 联机精简模式：本赛区赛程与 game.season.fixtures 相同，客户端接收后直接复原。 */
  fixturesFromSeason?: true
}

export type AITeamDef = {
  id: string
  name: string
  /** 真实球队的英文名；冠军联赛的球队和自定义队名没有这一项。 */
  enName?: string
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

export type FacilityId = 'stadium' | 'academy' | 'medical' | 'shop' | 'sponsor' | 'psychology' | 'tactics'

export type EconomyState = {
  balance: number
  /** 支持球队的球迷人数，随联赛赛果增长；旧存档由 economyOf 补齐。 */
  fans: number
  /** 最近一次结算的实际收入，供俱乐部界面显示。 */
  lastRoundIncome?: number
  /** 已经发过排名奖金的赛季序号；防止重复发放。 */
  prizeSeason?: number
  /** 最近一次拿到的排名奖金。 */
  lastPrize?: number
  lastFanChange?: number
  /** 欠球员的工资（发薪时余额不够的部分）；不为 0 时球员在比赛里只发挥一半。 */
  wageArrears?: number
  /** 设施用的是“阶段”数值（1–25）；2 表示已从旧的 1–5 等级迁移过；3 加了心理/战术两座设施。 */
  stageVersion?: number
  stadium: number
  academy: number
  medical: number
  /** 球迷商店：只提高每轮收入，不再给属性成长。 */
  shop: number
  /** 赞助商：只提高每轮收入，不再给属性成长。 */
  sponsor: number
  /** 心理辅导室：团队合作、镇定、决断成长。 */
  psychology: number
  /** 战术研究室：视野、预判、无球跑动、防守站位成长。 */
  tactics: number
  lastIncomeRound: number
}

export type MatchMode = 'friendly' | 'legend' | 'cup' | 'peak'

export type PveLegendRecord = {
  played: number
  won: number
  drawn: number
  lost: number
  goals: number
  conceded: number
}

export type PvePeakHistoryEntry = {
  stage: number
  at: number
  matchId?: string
  won: boolean
  score?: { home: number; away: number }
}

export type CupRunStatus = 'active' | 'eliminated' | 'champion' | 'void'

export type CupTableRow = {
  teamId: string
  played: number
  won: number
  drawn: number
  lost: number
  gf: number
  ga: number
  points: number
}

export type CupFixture = {
  id: string
  round: number
  homeId: string
  awayId: string
  played: boolean
  score?: { home: number; away: number }
  shootout?: { home: number; away: number }
  matchId?: string
}

export type CupTie = {
  id: string
  round: 'r16' | 'qf' | 'sf' | 'final'
  legs: CupFixture[]
  aggregate?: { home: number; away: number }
  shootout?: { home: number; away: number }
  winnerId?: string
}

export type CupGroupState = {
  index: number
  teamIds: string[]
  fixtures: CupFixture[]
  table: CupTableRow[]
}

export type CupRun = {
  cupId: string
  /** New runs reference the immutable season pool instead of duplicating full squads. */
  seasonPool?: boolean
  seasonIndex: number
  status: CupRunStatus
  stage: 'group' | 'r16' | 'qf' | 'sf' | 'final' | 'done'
  participants: Record<string, { name: string; kind: 'player' | 'world' | 'random'; defId?: string; snapshot?: AITeam }>
  groups: CupGroupState[]
  playerGroupIndex: number
  /** 小组赛当前轮次（1–3）。 */
  groupRound: number
  qualifiers?: string[]
  knockout?: { round: 'r16' | 'qf' | 'sf' | 'final'; ties: CupTie[] }
  /** 完整淘汰赛路径，当前轮也保留在其中。 */
  rounds?: { round: 'r16' | 'qf' | 'sf' | 'final'; ties: CupTie[] }[]
  finalMatchId?: string
}

export type TrophyRecord = {
  cupId: string
  cupName: string
  seasonIndex: number
  wonAt: number
  finalOpponent: string
  finalScore: { home: number; away: number }
  finalShootout?: { home: number; away: number }
  /** 首次夺冠时发放的俱乐部主属性上限奖励。 */
  ceilingBonus?: number
  /** 首次夺冠时发放的专属技能书奖励（如传奇杯《传奇之星》彩书）。 */
  rewardBook?: LegendBook
  /** 本届额外夺冠金币（不含每场参赛金）。 */
  goldPrize?: number
  matchId?: string
}

export type PvePeakReward = {
  claimedAt: number
  playerId: string
  templateId: string
  name: string
  ca: number
  pa: number
}

export type PveState = {
  legends: Record<string, PveLegendRecord>
  peak: {
    cleared: number
    history: PvePeakHistoryEntry[]
    /** 开赛时消耗的游戏日次数；旧存档缺省表示尚未记录。 */
    dailyAttempts?: { day: number; count: number }
    /** 所有巅峰比赛共用的递增开赛序号，用于不重复的种子和战报 ID。 */
    attemptCounter?: number
    reward50?: PvePeakReward
    /** 旧版已领取的整十关奖励；新版也保留其特殊奖励的去重标记。 */
    claimedMilestones?: number[]
    /** 每关奖励迁移版本；2 表示采用分关奖励。 */
    stageRewardVersion?: 2
    /** 已发放或由旧里程碑覆盖的关卡，保证重试和迁移不重复。 */
    claimedStageRewards?: number[]
    /** 单属性上限 +100 的突破卡库存。 */
    breakthroughCards?: number
  }
  cups: Record<string, CupRun>
  /** Season-opening opponents; only the current season is retained. */
  cupSeason?: import('./cup.ts').CupSeasonState
  /** 联机浏览器视图：需要时从服务器取得冻结对手，不在本地重建。 */
  cupSeasonDeferred?: true
  cupHistory?: CupRun[]
  /** 已获得的俱乐部奖杯上限加成，每种杯赛只计一次。 */
  cupCeilingClaims?: Partial<Record<string, true>>
  /** 正式杯赛金币发放账本：按比赛或赛季/杯赛去重。 */
  seasonCupGoldClaims?: Record<string, number>
  /** 已检查旧版已公布比赛并补发过杯赛奖金。 */
  seasonCupGoldVersion?: 1
  /** Ceiling migration version; 3 preserves ambiguous legacy ceilings and repairs v2 deductions. */
  cupCeilingVersion?: number
  /** 旧版已直接修改的上限原始值备份；旧档有转会或截断时可追溯。 */
  legacyCupCeilings?: Record<string, Attributes>
  trophies: TrophyRecord[]
}
export type PairChemistry = {
  players: [string, string]
  minutes: number
  training: number
  lastAt: number
  trainingAt?: number
  trainingToday?: number
}

export type Chemistry = Record<string, PairChemistry>

export type ShopState = {
  /** 当前可用商店点数（跨赛季累计不清零）。 */
  points: number
  /** 已发放过赛季排名点数的赛季编号 → 获得点数（按赛季去重）。 */
  seasonClaims: Record<number, number>
  /** 已发放过巅峰之路点数的关卡号列表（1..100，用于首通发奖与已通关玩家自动补发去重）。 */
  peakClaimedStages: number[]
  /** 巅峰之路已累计发放过的商店点数（用于调高巅峰点数后的差额补发与幂等校验）。 */
  peakPointsAwarded?: number
  /** 最近一次赛季结算获得的商店点数。 */
  lastSeasonPoints?: number
  /** 最近一次老存档巅峰之路自动补发的商店点数。 */
  lastPeakBackfill?: number
}

export type BoardAmbition = 'safe' | 'expected' | 'ambitious'
export type BoardGrade = 'S' | 'A' | 'B' | 'C' | 'D'
export type BoardCupStage = 'none' | 'qualified' | 'r16' | 'qf' | 'sf' | 'final' | 'champion'
export type BoardCupId = 'community' | 'league' | 'champions'

export type BoardGoalOption = {
  ambition: BoardAmbition
  label: string
  leagueTarget: number
  cupId: BoardCupId
  cupTarget: BoardCupStage
  transferGrant: number
  facilityGrant: number
  wageCap: number
  meetBonus: number
  exceedBonus: number
}

export type BoardSeasonMandate = {
  seasonIndex: number
  tier: TierId
  powerRank: number
  totalClubs: number
  ambition: BoardAmbition
  leagueTarget: number
  cupId: BoardCupId
  cupTarget: BoardCupStage
  /** 本赛季董事会初始拨付的转会预算。 */
  initialTransferBudget: number
  /** 本赛季当前剩余可用转会预算（买人扣减、卖人按留存率回流、滑块可与工资帽互转）。 */
  transferBudget: number
  /** 本赛季董事会初始拨付的设施预算。 */
  initialFacilityBudget: number
  /** 本赛季当前剩余可用设施预算（仅设施升级消耗，不与转会/工资帽互通）。 */
  facilityBudget: number
  /** 本赛季初始基础工资帽（每轮）。 */
  initialWageCap: number
  /** 当前基础工资帽（每轮，可通过滑块与转会预算按 38:1 互转；有效工资帽另加商业设施 30% 分成）。 */
  wageCap: number
  /** 卖人收入回流至转会预算的比例（0.5 / 0.75 / 0.85）。 */
  retentionRate: number
  /** 滑块累计调整到转会预算的净额（正=从工资帽转入转会预算，负=从转会预算转入工资帽）。 */
  sliderShift: number
  /** 达标 / 超额奖金（赛季末考核后发放至余额）。 */
  meetBonus: number
  exceedBonus: number
  /** 本赛季目标档位是否已锁定（第 4 轮起或手动确认锁定后不可更改）。 */
  locked: boolean
  /** 本赛季三档方案快照，供开季第 1–3 轮切换对比。 */
  options: BoardGoalOption[]
}

export type BoardOffseasonPreview = {
  nextSeasonIndex: number
  projectedTier: TierId
  confirmed: boolean
  powerRank: number
  totalClubs: number
  budgetMultiplier: number
  wageMultiplier: number
  retentionRate: number
  options: BoardGoalOption[]
  /** 升级杯尚未决出结果时附带的「若升入一级联赛」三档只读参考方案。 */
  promotionOptions?: BoardGoalOption[]
}

export type BoardEvaluation = {
  seasonIndex: number
  tier: TierId
  ambition: BoardAmbition
  leagueTarget: number
  leagueActual: number
  cupId: BoardCupId
  cupTarget: BoardCupStage
  cupActual: BoardCupStage
  grade: BoardGrade
  confidenceBefore: number
  confidenceAfter: number
  bonusPaid: number
  nextBudgetMultiplier: number
  summary: string
}

export type BoardState = {
  version: 1
  /** 董事会信任度（15–100，初始 60）。 */
  confidence: number
  /** 最近一次赛季考核评级（直接参与下赛季预算奖惩系数）。 */
  lastGrade?: BoardGrade
  /** 当前赛季激活的董事会目标与独立预算（第 2 赛季起生效）。 */
  current?: BoardSeasonMandate
  /** 休赛期预选的下赛季目标档位（级别已确定时使用；换季时自动生效，未选默认 expected）。 */
  pendingChoice?: BoardAmbition
  /** 休赛期按级别分别预选的目标档位（升级杯未决时可同时为一级/二级各选一套，换季按实际级别生效）。 */
  pendingChoicesByTier?: Partial<Record<TierId, BoardAmbition>>
  /** 休赛期生成的下赛季目标与预算预览。 */
  offseasonPreview?: BoardOffseasonPreview
  /** 历年董事会考核记录（最新在前，最多保留 20 条）。 */
  history: BoardEvaluation[]
}

export type GameState = {
  /** 独立青训营；缺省旧档首次进入时初始化一次。 */
  youth?: YouthState
  /** 技能书商店点数与领取账本；旧档首次进入时初始化并补发已通关巅峰关卡点数。 */
  shop?: ShopState
  /** 俱乐部董事会目标、独立转会/设施预算、工资帽与考核记录（第 2 赛季起激活）。 */
  board?: BoardState
  scoutReports?: ScoutReport[]
  /** 全俱乐部共用的回收培养点；旧档不存在时为 0。 */
  trainingPoints?: number
  version: number
  createdAt: number
  seed: number
  clubName: string
  /** 培养页的自动培养设置。 */
  /** 旧存档的全局自动培养设置：没有单独设置过的球员用它当默认值。 */
  trainingAuto?: TrainingAutoConfig
  /** 按球员保存的自动培养策略和“自动培养”开关。 */
  trainingAutoByPlayer?: Record<string, TrainingAutoConfig>
  economy?: EconomyState
  market?: { listings: { player: Player; price: number; listedRound?: number }[]; lastSettledRound: number }
  roster: Player[]
  lineup: Lineup
  autoSubs?: AutoSubPlan
  training: Record<string, TrainingSession>
  /** 已获得的传奇/巅峰技能书；只增不减，学习不消耗。 */
  legendBooks?: LegendBook[]
  /** 按球员保存的培养技能书配置，key 为 id:tier。 */
  trainingBooksByPlayer?: Record<string, string[]>
  /** 每支传奇队“已有彩书后再次获胜”的球迷补偿是否已发；每队只发一次。 */
  legendRepeatFans?: Record<string, true>
  injuries?: Record<string, number>
  /** Sparse relationships between player instances, independent of equipped cards. */
  chemistry?: Chemistry
  /** 最近 20 场的出场分钟（按球员 id，玩家和本联赛 AI 球队的都记），俱乐部判断放不放人用。 */
  appearances?: Record<string, number[]>
  /** AI 俱乐部发来的报价（收件箱）。 */
  transferOffers?: TransferOffer[]
  /** 联机账号：世界、电脑球队和自由市场由服务器维护，本地不另算。 */
  shared?: true
  /** 自由市场最近一次每日补充是第几个游戏日（单机）。 */
  freeMarketDay?: number
  /** 培养结束、玩家还没决定是否换上的那一份；对应的卡已经在 cards 里。 */
  candidates: Record<string, Player>
  /** 库存：培养出来的所有球员卡。 */
  cards?: PlayerCard[]
  cardSeq?: number
  /** 存档里的名字用的是第几版命名，见 names.ts。 */
  namesVersion?: number
  /** 球星专属特性升级到了第几版，见 names.ts。 */
  traitsVersion?: number
  attrsVersion?: number
  season: SeasonState
  seasonHistory?: SeasonState[]
  aiTeams: AITeam[]
  /** 电脑球队的钱、设施和培养成果；单机世界自己算，联机以服务器的为准。 */
  aiClubs?: Record<string, AIClubState>
  freeStars: Player[]
  matchHistory: MatchRecord[]
  challengeHistory: MatchRecord[]
  /** PvE 进度：传奇战绩、巅峰通关、杯赛/奖杯。旧存档读档时补齐。 */
  pve?: PveState
  activeMatch?: ActiveMatchSave
  ui?: { screen: string }
  world?: WorldState
  reserveStars?: Player[]
  suspensions?: Record<string, Suspension>
  yellowCounts?: Record<string, number>
  settings?: GameSettings
}

/** 电脑球队练出来的一张卡：属性是绝对值，评分最高的那张才会被留下。 */
export type AICard = {
  /** 1500 分制的能力评分，和属性一起变；只有更高分的新卡才会替换旧卡。 */
  rating: number
  attrs: Attributes
  /** 这张卡属于谁（球员 id 加英文名）。槽位上换了人，旧卡不能套给新人。 */
  owner?: string
}

/** 一支电脑球队的经营状态。设施同样是 1–25 阶段，和玩家的经济系统共用一套函数。 */
export type AIClubState = {
  economy: EconomyState
  /** 还没兑现的培养名额（按游戏日累计的小数）。 */
  progress: number
  /** 阵容槽位（0 起）上最强的那张卡。 */
  cards: Record<string, AICard>
  /** 从转会市场签下、下一场比赛起可以出场的球员。 */
  signings: Player[]
  trained: number
  upgrades: number
  /** 电脑球队的正式杯赛金币和永久上限加成账本。 */
  seasonCupGoldClaims?: Record<string, number>
  cupCeilingClaims?: Partial<Record<string, true>>
  /** 还没兑现的设施升级名额（按轮累计的小数）；二级慢、顶级快。 */
  upgradeProgress?: number
  /** 这个赛季已经买进几个人（竞拍、签自由球员、挖人），每赛季最多 5 人。 */
  transfers?: { season: number; bought: number }
  /**
   * 这一圈培养里已经练过的球员（`id|英文名`）。电脑球队按“原始 CA 从高到低、还没练过的”挑人，
   * 全队都练过一遍后清空重新开一圈；球员离队后自然从名单里剔除。
   */
  trainedOwners?: string[]
}

export type MatchContext = {
  isLeague: boolean
  mode?: MatchMode
  stage?: number
  cupId?: string
  cupFixtureId?: string
  /** 小组赛、两回合首回合允许平局；次回合根据总比分决胜。 */
  knockout?: boolean
  /** 传奇挑战：90 分钟平局直接结束，不点球。 */
  allowDraw?: boolean
  /** 挑战赛：满状态入场，不生成新的伤病；默认所有非联赛比赛。 */
  noInjuries?: boolean
  shootoutOffset?: { home: number; away: number }
  /** 战报 ID 的去重键；比赛结果由本次 seed 决定。 */
  recordKey?: string | number
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
  /**
   * 联机联赛的回放：比赛已经在开球前 30 分钟锁定阵容并由服务器算好，
   * 这里的 engineState 是开球那一刻的初始状态，浏览器按现实时钟把它回放出来（约 10 分钟），不能干预。
   * 只存在于服务器下发的存档副本里，不会保存回服务器，也不落本地缓存。
   */
  preplayed?: boolean
}

export type ReviewRecommendation = {
  title: string
  detail: string
  tone: 'good' | 'warn' | 'bad'
}

export type AutoTrainingPresetId =
  | 'signature'
  | 'max'
  | 'finisher'
  | 'playmaker'
  | 'winger'
  | 'defender'
  | 'gk_stopper'
  | 'gk_sweeper'
  | 'gk_wall'
  | 'custom'

/** 自动培养：按预设流派、属性优先级练，或者把主属性练到最低目标。 */
export type TrainingAutoConfig = {
  enabled: boolean
  /** “自动培养”开关：打开后，这名球员正在进行的培养会自动往后走。默认关。 */
  autopilot?: boolean
  /** 一级菜单选中的快捷预设；二级细调手动调整后记为 custom。 */
  preset?: AutoTrainingPresetId
  /** priority：按优先级练满；targets：补到最低目标；max：每次都选属性总成长最多的那一项。 */
  mode: 'priority' | 'targets' | 'max'
  /** 属性优先级，靠前的先练。 */
  priority: AttrKey[]
  /** 最低目标（存档值 0–2000）；没达到就优先安排对应训练。 */
  targets: Partial<Record<AttrKey, number>>
}
