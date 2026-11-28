import type { AttrKey, AutoSubPlan, DetailedPosition, GameState, Lineup, Position, SkillId } from '../game/types.ts'
import { loadGame, setTeamPickPending } from '../game/state.ts'
import { createWorldGame, type ClubPreview } from '../game/world.ts'
import { ensurePve } from '../game/pve.ts'
import { ensureAchievements } from '../game/achievements.ts'
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

export type Screen = 'youth' | 'club' | 'achievements' | 'shop' | 'transfer' | 'home' | 'academy' | 'inventory' | 'training' | 'lineup' | 'season' | 'cups' | 'events' | 'world' | 'challenge' | 'review' | 'match'
export type ClubTab = 'board' | 'facilities' | 'contracts' | 'history'
export type AchievementFilter = 'all' | 'standard' | 'hidden' | 'unlocked'
export type TransferTab = 'market' | 'free' | 'ai' | 'offers'
export type FreeTransferSortKey = 'ca' | 'age' | 'price' | 'pos' | 'name'
export type AiTransferSortKey = 'ca' | 'age' | 'asking' | 'value' | 'minutes' | 'pos' | 'name'
export type SellTransferSortKey = 'ca' | 'value' | 'suggested' | 'pos' | 'name'
export type SquadSortKey = 'pos' | 'name' | 'age' | 'ca' | 'condition' | 'energy' | 'value' | `attr${number}`
export type InventoryTab = 'cards' | 'books'
export type ChallengeMode = 'friendly' | 'legend' | 'cup' | 'peak'

export type UIState = {
  screen: Screen
  /** 每次打开页面都先问：登录进共享世界，还是离线玩本地存档。 */
  bootGate: boolean
  clubTab: ClubTab
  achievementFilter: AchievementFilter
  /** 董事会转会预算↔工资帽滑块的未提交草稿值（正=工资帽转转会，负=转会转工资帽）。 */
  boardSliderDraft: number
  /** 合同页每位球员当前选择的续约年限（3–5 年，仅界面草稿）。 */
  renewYearsByPlayer: Record<string, number>
  transferTab: TransferTab
  clubSearch: string
  clubPos: Position | 'ALL'
  clubSort: FreeTransferSortKey
  clubSortDir: 1 | -1
  clubPage: number
  /** 「从 AI 球队买人」的筛选、排序和翻页。 */
  aiBuyTeam: string
  aiBuyPos: string
  aiBuySearch: string
  aiBuySort: AiTransferSortKey
  aiBuySortDir: 1 | -1
  aiBuyOnlyAvailable: boolean
  aiBuyPage: number
  /** 「挂牌出售」列表的筛选与排序。 */
  sellPos: Position | 'ALL'
  sellSort: SellTransferSortKey
  sellSortDir: 1 | -1
  academySearch: string
  academyPos: Position | 'ALL'
  academyEra: string
  squadSort: SquadSortKey
  squadSortDir: 1 | -1
  inventoryTab: InventoryTab
  inventorySearch: string
  inventoryPos: Position | 'ALL'
  inventorySort: 'new' | 'ca' | 'player'
  inventoryBookSearch: string
  inventoryBookTier: 'ALL' | 'rainbow' | 'gold' | 'silver'
  inventoryBookCat: 'ALL' | 'primary' | 'auxiliary' | 'passive'
  /** 正在确认删除的球员卡。 */
  cardDeleteId: string | null
  /** 仅在库存页暂存的回收选择与二次确认状态。 */
  recycleSelectedIds: string[]
  recycleConfirm: boolean
  seasonRound: number | null
  /** 正式赛季杯赛选中的赛事标签。 */
  seasonCupTab: import('../game/season-cups.ts').SeasonCupId
  /** 赛季活动页当前选中的模式（null 时默认取本赛季主打活动）。 */
  seasonEventMode: import('../game/events/season-events.ts').SeasonEventMode | null
  draftThemePreview: import('../game/events/draft-cup.ts').DraftPoolThemeId | null
  draftSwapPlayerId: string | null
  draftChosenBookId: import('../game/types.ts').SkillBookId | null
  /** 挑战页当前模式。 */
  challengeMode: ChallengeMode
  /** 传奇挑战档位筛选；默认先看 B 档，所有档位均可自由切换。 */
  legendTier: 'ALL' | 'S+' | 'S' | 'A' | 'B'
  legendSearch: string
  legendEra: string
  legendCountry: string
  pveTeamId: string | null
  peakPreviewStage: number | null
  peakCardPlayerId: string | null
  peakCardAttr: AttrKey | null
  cupHistorySeason: number | null
  /** 杯赛页正在预览分组的杯赛。 */
  cupPreviewId: string | null
  /** 友谊赛页面选中的联赛分区（可以约世界任意球队）。 */
  challengeDivision: string | null
  newsDivision: string | null
  worldDivision: string | null
  worldRound: number | null
  worldFixtureClubId: string
  worldClubId: string | null
  worldPlayerId: string | null
  trainingPlayerId: string | null
  /** 下次手动或自动开始培养时选择的点数档位，不写入存档。 */
  trainingPointSpend: 0 | 10 | 20 | 30
  /** 本轮培养准备携带的传奇技能书 key（id:tier）。 */
  trainingBookIds: string[]
  trainingKind: TrainingActionId
  trainingActivity: TrainingActivityId | null
  trainingTeammateIds: string[]
  trainingAttr: AttrKey
  trainingCombo: 'attack' | 'defense'
  trainingPosition: Position | DetailedPosition
  trainingProtection: 'prevention' | 'resilience'
  /** 赛后每个学习选项各自选定的替换技能。 */
  trainingEventReplacements: Record<string, SkillId>
  detailPlayerId: string | null
  /** 球员详情内的档案、表现和对比页面；仅是界面状态，不写入存档。 */
  playerDetailView: 'profile' | 'performance' | 'compare'
  playerCompareId: string | null
  playerCompareTab: 'overview' | 'attributes' | 'stats' | 'positions'
  playerPerformancePeriod: 'season' | 'career'
  playerPerformanceCompetition: 'all' | 'league' | 'cup'
  /** 任意界面点开的球队（世界里的 club id，玩家球队为 player）。 */
  clubViewId: string | null
  /** 球队详情里选中的球员。 */
  clubViewPlayerId: string | null
  /** 球员详情里“本赛季 / 生涯”数据选项卡。 */
  playerStatsTab: 'season' | 'career'
  reviewId: string | null
  /** 刚踢完实时比赛直达复盘页时默认展开完整报告；从列表点进时默认收起防剧透。 */
  reviewAutoOpen: boolean
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
  /** 比赛中教练调整面板里的自动换人草稿与“同步保存为默认”勾选状态。 */
  matchAutoSubsDraft: AutoSubPlan | null
  matchAutoSubsSyncDefault: boolean
  /** 比赛中场边喊话目标（'' 表示全队，否则为己方场上球员 sourceId）。 */
  matchShoutTarget: string
  /** 联机直播喊话请求进行中防重复提交。 */
  matchShoutPending: boolean
  /** 版本更新说明弹窗是否打开。 */
  changelogOpen: boolean
  /** 全服聊天侧边抽屉是否打开。 */
  chatOpen: boolean
  chatError: string
  /** 待发送到全服聊天的角色卡名片、整场战报或单粒 3D 进球附件草稿。 */
  chatPendingShare: (
    | { kind: 'card'; cardId: string; label: string }
    | { kind: 'match'; recordId: string; label: string }
    | { kind: 'goal'; recordId: string; goalIndex: number; label: string }
  ) | null
  /** 正在弹窗预览的全服聊天分享消息 ID。 */
  chatPreviewMsgId: string | null
  /** 手机端底部“全部页面”导航抽屉是否打开。 */
  mobileNavOpen: boolean
  completing: boolean
  accountOpen: boolean
  /** 联机账号弹窗内修改账号/密码的表单状态；保存成功后递增 nonce 以清空密码输入框。 */
  accountEditNonce: number
  accountEditError: string
  accountEditBusy: boolean
  /** 注册表单预选的球队；注册成功后不允许更换。 */
  registrationClubId: string
  /** 自动策略弹窗（针对当前选中的培养球员）。 */
  autoStrategyOpen: boolean
  /** 自动策略弹窗是否展开到二级细调菜单（false 为一级简洁预设页）。 */
  autoStrategyDetail: boolean
  authMode: 'login' | 'register'
  turnstileToken: string
  newGameOpen: boolean
  /** 第一次进离线模式的选队：必须选完才能继续，不能取消。 */
  newGameRequired: boolean
  newGameClubId: string | null
  /** 选队界面看到的名单和确认后开局用的是同一个种子。 */
  newGamePreview: { seed: number; clubs: ClubPreview[] } | null
}

const SAVE_SCREEN: Screen[] = ['youth', 'club', 'achievements', 'shop', 'transfer', 'home', 'academy', 'inventory', 'training', 'lineup', 'season', 'cups', 'events', 'world', 'challenge', 'review', 'match']

/** 模式选定后才初始化；启动页不读取、迁移或生成离线世界。 */
export let game: GameState

export function startOfflineGame(): void {
  const saved = loadGame()
  game = saved ?? createWorldGame()
  ensurePve(game)
  ensureAchievements(game)
  if (!saved) setTeamPickPending(true)
  restoreSavedScreen()
}

export function setGame(next: GameState): void {
  game = next
}

export const ui: UIState = {
  screen: 'home',
  bootGate: true,
  clubTab: 'facilities',
  achievementFilter: 'all',
  boardSliderDraft: 0,
  renewYearsByPlayer: {},
  transferTab: 'market',
  clubSearch: '',
  clubPos: 'ALL',
  clubSort: 'ca',
  clubSortDir: -1,
  clubPage: 0,
  aiBuyTeam: 'ALL',
  aiBuyPos: 'ALL',
  aiBuySearch: '',
  aiBuySort: 'ca',
  aiBuySortDir: -1,
  aiBuyOnlyAvailable: false,
  aiBuyPage: 0,
  sellPos: 'ALL',
  sellSort: 'ca',
  sellSortDir: -1,
  academySearch: '',
  academyPos: 'ALL',
  academyEra: 'ALL',
  squadSort: 'ca',
  squadSortDir: -1,
  inventoryTab: 'cards',
  inventorySearch: '',
  inventoryPos: 'ALL',
  inventorySort: 'new',
  inventoryBookSearch: '',
  inventoryBookTier: 'ALL',
  inventoryBookCat: 'ALL',
  cardDeleteId: null,
  recycleSelectedIds: [],
  recycleConfirm: false,
  seasonRound: null,
  seasonCupTab: 'community',
  challengeMode: 'friendly',
  legendTier: 'B',
  legendSearch: '',
  legendEra: 'ALL',
  legendCountry: 'ALL',
  pveTeamId: null,
  peakPreviewStage: null,
  peakCardPlayerId: null,
  peakCardAttr: null,
  cupHistorySeason: null,
  cupPreviewId: null,
  challengeDivision: null,
  seasonEventMode: null,
  draftThemePreview: null,
  draftSwapPlayerId: null,
  draftChosenBookId: null,
  newsDivision: null,
  worldDivision: null,
  worldRound: null,
  worldFixtureClubId: 'ALL',
  worldClubId: null,
  worldPlayerId: null,
  trainingPlayerId: null,
  trainingPointSpend: 0,
  trainingBookIds: [],
  trainingKind: 'drill',
  trainingActivity: null,
  trainingTeammateIds: [],
  trainingAttr: 'passing',
  trainingProtection: 'prevention',
  trainingEventReplacements: {},
  trainingCombo: 'attack',
  trainingPosition: 'CM',
  detailPlayerId: null,
  playerDetailView: 'profile',
  playerCompareId: null,
  playerCompareTab: 'overview',
  playerPerformancePeriod: 'season',
  playerPerformanceCompetition: 'all',
  clubViewId: null,
  clubViewPlayerId: null,
  playerStatsTab: 'season',
  reviewId: null,
  reviewAutoOpen: false,
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
  matchAutoSubsDraft: null,
  matchAutoSubsSyncDefault: false,
  matchShoutTarget: '',
  matchShoutPending: false,
  changelogOpen: false,
  chatOpen: false,
  chatError: '',
  chatPendingShare: null,
  chatPreviewMsgId: null,
  mobileNavOpen: false,
  completing: false,
  accountOpen: false,
  accountEditNonce: 0,
  accountEditError: '',
  accountEditBusy: false,
  registrationClubId: '',
  autoStrategyOpen: false,
  autoStrategyDetail: false,
  authMode: 'login',
  turnstileToken: '',
  newGameOpen: false,
  newGameRequired: false,
  newGameClubId: null,
  newGamePreview: null,
}

export function restoreSavedScreen(): void {
  const initialScreen = game.ui?.screen as Screen | undefined
  ui.screen = initialScreen && SAVE_SCREEN.includes(initialScreen) ? initialScreen : 'home'
  if (ui.screen === 'match' && !game.activeMatch) ui.screen = 'home'
  ui.matchEngine = ui.screen === 'match' ? restoreActiveEngine(game) : null
}

// 服务端独立渲染页面时没有浏览器模式选择器，使用离线世界。
if (import.meta.env?.SSR ?? typeof document === 'undefined') startOfflineGame()

export const replay = { id: '', index: 0, playing: false, speed: 1, highlightsOnly: false, drawerOpen: false, timer: null as number | null }

export function stopReplay(): void {
  if (replay.timer !== null) window.clearTimeout(replay.timer)
  replay.timer = null
  replay.playing = false
}

export function resetReplay(id: string): void {
  stopReplay()
  replay.id = id
  replay.index = 0
  replay.highlightsOnly = false
  replay.drawerOpen = false
}
