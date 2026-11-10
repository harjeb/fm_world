import type { AttrKey, AutoSubPlan, GameState, Lineup, Position, SkillId } from '../game/types.ts'
import { loadGame, saveGame, setTeamPickPending } from '../game/state.ts'
import { createWorldGame, type ClubPreview } from '../game/world.ts'
import { ensurePve } from '../game/pve.ts'
import { restoreActiveEngine } from '../game/actions.ts'
import type { GameEngine } from '../game/pes/engine.ts'
import type { SeasonGoal, SquadRole } from '../game/negotiation.ts'

/** 谈判弹窗的状态：报价和承诺放在这里，成功率每次重绘时重算。 */
export type NegotiationDraft = {
  kind: 'free' | 'club' | 'bid'
  playerId: string
  clubId?: string
  asking: number
  value: number
  offer: number
  goal: SeasonGoal
  role: SquadRole
  /** 上一次失败的原因，显示在弹窗里。 */
  message?: string
  /** 上一次掷骰的成功率，失败后用来说明“当时是 62%”。 */
  lastChance?: number
}
import type { TrainingActionId } from '../game/training.ts'
import type { TrainingActivityId } from '../game/training-calendar.ts'

export type Screen = 'club' | 'transfer' | 'home' | 'academy' | 'inventory' | 'training' | 'lineup' | 'season' | 'world' | 'challenge' | 'review' | 'match'
export type ClubTab = 'facilities' | 'contracts' | 'history'
export type TransferTab = 'market' | 'free' | 'ai' | 'offers'
export type SquadSortKey = 'pos' | 'name' | 'age' | 'ca' | 'condition' | 'energy' | 'value' | `attr${number}`
export type ChallengeMode = 'friendly' | 'legend' | 'cup' | 'peak'

export type UIState = {
  screen: Screen
  /** 每次打开页面都先问：登录进共享世界，还是离线玩本地存档。 */
  bootGate: boolean
  clubTab: ClubTab
  transferTab: TransferTab
  clubSearch: string
  clubPage: number
  /** 「从 AI 球队买人」的筛选和翻页。 */
  aiBuyTeam: string
  aiBuyPos: string
  aiBuyPage: number
  academySearch: string
  academyPos: Position | 'ALL'
  academyEra: string
  squadSort: SquadSortKey
  squadSortDir: 1 | -1
  inventorySearch: string
  inventoryPos: Position | 'ALL'
  inventorySort: 'new' | 'ca' | 'player'
  /** 正在确认删除的球员卡。 */
  cardDeleteId: string | null
  seasonRound: number | null
  /** 挑战页当前模式。 */
  challengeMode: ChallengeMode
  /** 传奇挑战档位筛选。 */
  legendTier: 'ALL' | 'S+' | 'S' | 'A' | 'B'
  legendSearch: string
  legendEra: string
  legendCountry: string
  pveTeamId: string | null
  peakPreviewStage: number | null
  cupHistorySeason: number | null
  /** 杯赛页正在预览分组的杯赛。 */
  cupPreviewId: string | null
  /** 友谊赛页面选中的联赛分区（可以约世界任意球队）。 */
  challengeDivision: string | null
  worldDivision: string | null
  worldClubId: string | null
  worldPlayerId: string | null
  trainingPlayerId: string | null
  trainingKind: TrainingActionId
  trainingActivity: TrainingActivityId | null
  trainingTeammateIds: string[]
  trainingAttr: AttrKey
  trainingCombo: 'attack' | 'defense'
  trainingPosition: Position
  trainingProtection: 'prevention' | 'resilience'
  trainingMentorId: string
  trainingSkill: SkillId | null
  detailPlayerId: string | null
  /** 任意界面点开的球队（世界里的 club id，玩家球队为 player）。 */
  clubViewId: string | null
  /** 球队详情里选中的球员。 */
  clubViewPlayerId: string | null
  /** 球员详情里“本赛季 / 生涯”数据选项卡。 */
  playerStatsTab: 'season' | 'career'
  reviewId: string | null
  /** 正在进行的球员谈判（自由球员 / AI 球队买人 / 联机竞拍）。 */
  negotiation: NegotiationDraft | null
  notice: string
  matchPlaying: boolean
  matchSpeed: number
  pitchView: 'match' | 'tracking'
  /** 友谊赛当前这一步在屏幕上播多久。 */
  matchStepMs: number
  matchEngine: GameEngine | null
  matchTimer: number | null
  coachPanel: boolean
  /** 当前这次教练暂停是否已经扣过一次（同一暂停里多次调整不再扣）。 */
  coachPauseUsed: boolean
  lineupDraft: Lineup | null
  lineupSlot: string | null
  /** 战术页“自动填充”用哪种方式：最强阵容 / 部分轮换 / 全部轮换。 */
  lineupAutoMode: 'best' | 'half' | 'full'
  autoSubsDraft: AutoSubPlan | null
  completing: boolean
  accountOpen: boolean
  /** 注册表单预选的球队；注册成功后不允许更换。 */
  registrationClubId: string
  /** 自动策略弹窗（针对当前选中的培养球员）。 */
  autoStrategyOpen: boolean
  authMode: 'login' | 'register'
  turnstileToken: string
  newGameOpen: boolean
  /** 第一次进离线模式的选队：必须选完才能继续，不能取消。 */
  newGameRequired: boolean
  newGameClubId: string | null
  /** 选队界面看到的名单和确认后开局用的是同一个种子。 */
  newGamePreview: { seed: number; clubs: ClubPreview[] } | null
}

const SAVE_SCREEN: Screen[] = ['club', 'transfer', 'home', 'academy', 'inventory', 'training', 'lineup', 'season', 'world', 'challenge', 'review', 'match']

const saved = loadGame()
/** 当前存档。其他模块通过 live binding 读到最新值，替换时用 setGame。 */
export let game: GameState = saved ?? createWorldGame()
ensurePve(game)
if (!saved) {
  saveGame(game)
  // 这支球队是系统随手分的：玩家选离线模式时会先让他自己挑一支。
  setTeamPickPending(true)
}

export function setGame(next: GameState): void {
  game = next
}

export const ui: UIState = {
  screen: 'home',
  bootGate: true,
  clubTab: 'facilities',
  transferTab: 'market',
  clubSearch: '',
  clubPage: 0,
  aiBuyTeam: 'ALL',
  aiBuyPos: 'ALL',
  aiBuyPage: 0,
  academySearch: '',
  academyPos: 'ALL',
  academyEra: 'ALL',
  squadSort: 'ca',
  squadSortDir: -1,
  inventorySearch: '',
  inventoryPos: 'ALL',
  inventorySort: 'new',
  cardDeleteId: null,
  seasonRound: null,
  challengeMode: 'friendly',
  legendTier: 'ALL',
  legendSearch: '',
  legendEra: 'ALL',
  legendCountry: 'ALL',
  pveTeamId: null,
  peakPreviewStage: null,
  cupHistorySeason: null,
  cupPreviewId: null,
  challengeDivision: null,
  worldDivision: null,
  worldClubId: null,
  worldPlayerId: null,
  trainingPlayerId: null,
  trainingKind: 'drill',
  trainingActivity: null,
  trainingTeammateIds: [],
  trainingAttr: 'passing',
  trainingProtection: 'prevention',
  trainingMentorId: '',
  trainingSkill: null,
  trainingCombo: 'attack',
  trainingPosition: 'CM',
  detailPlayerId: null,
  clubViewId: null,
  clubViewPlayerId: null,
  playerStatsTab: 'season',
  reviewId: null,
  negotiation: null,
  notice: '',
  matchPlaying: false,
  matchSpeed: 2700,
  pitchView: 'tracking',
  matchStepMs: 2700,
  matchEngine: null,
  matchTimer: null,
  coachPanel: false,
  coachPauseUsed: false,
  lineupDraft: null,
  lineupSlot: null,
  lineupAutoMode: 'best',
  autoSubsDraft: null,
  completing: false,
  accountOpen: false,
  registrationClubId: '',
  autoStrategyOpen: false,
  authMode: 'login',
  turnstileToken: '',
  newGameOpen: false,
  newGameRequired: false,
  newGameClubId: null,
  newGamePreview: null,
}

const initialScreen = game.ui?.screen as Screen | undefined
if (initialScreen && SAVE_SCREEN.includes(initialScreen)) ui.screen = initialScreen
if (ui.screen === 'match' && !game.activeMatch) ui.screen = 'home'
if (ui.screen === 'match') ui.matchEngine = restoreActiveEngine(game)

export const replay = { id: '', index: 0, playing: false, speed: 1, timer: null as number | null }

export function stopReplay(): void {
  if (replay.timer !== null) window.clearTimeout(replay.timer)
  replay.timer = null
  replay.playing = false
}

export function resetReplay(id: string): void {
  stopReplay()
  replay.id = id
  replay.index = 0
}
