import type { AttrKey, AutoSubPlan, GameState, Lineup, Position, SkillId } from '../game/types.ts'
import { loadGame, saveGame } from '../game/state.ts'
import { createWorldGame, type ClubPreview } from '../game/world.ts'
import { restoreActiveEngine } from '../game/actions.ts'
import type { MatchEngine } from '../game/match/engine.ts'
import type { TrainingActionId } from '../game/training.ts'
import type { TrainingActivityId } from '../game/training-calendar.ts'

export type Screen = 'club' | 'transfer' | 'home' | 'academy' | 'inventory' | 'training' | 'lineup' | 'season' | 'world' | 'challenge' | 'review' | 'match'
export type ClubTab = 'facilities' | 'contracts'
export type TransferTab = 'market' | 'free'
export type SquadSortKey = 'pos' | 'name' | 'age' | 'ca' | 'condition' | 'energy' | 'value' | `attr${number}`

export type UIState = {
  screen: Screen
  clubTab: ClubTab
  transferTab: TransferTab
  clubSearch: string
  clubPage: number
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
  notice: string
  matchPlaying: boolean
  matchSpeed: number
  pitchView: 'match' | 'tracking'
  /** 友谊赛当前这一步在屏幕上播多久。 */
  matchStepMs: number
  matchEngine: MatchEngine | null
  matchTimer: number | null
  coachPanel: boolean
  lineupDraft: Lineup | null
  lineupSlot: string | null
  autoSubsDraft: AutoSubPlan | null
  completing: boolean
  accountOpen: boolean
  authMode: 'login' | 'register'
  turnstileToken: string
  newGameOpen: boolean
  newGameClubId: string | null
  /** 选队界面看到的名单和确认后开局用的是同一个种子。 */
  newGamePreview: { seed: number; clubs: ClubPreview[] } | null
}

const SAVE_SCREEN: Screen[] = ['club', 'transfer', 'home', 'academy', 'inventory', 'training', 'lineup', 'season', 'world', 'challenge', 'review', 'match']

const saved = loadGame()
/** 当前存档。其他模块通过 live binding 读到最新值，替换时用 setGame。 */
export let game: GameState = saved ?? createWorldGame()
if (!saved) saveGame(game)

export function setGame(next: GameState): void {
  game = next
}

export const ui: UIState = {
  screen: 'home',
  clubTab: 'facilities',
  transferTab: 'market',
  clubSearch: '',
  clubPage: 0,
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
  notice: '',
  matchPlaying: false,
  matchSpeed: 300,
  pitchView: 'tracking',
  matchStepMs: 300,
  matchEngine: null,
  matchTimer: null,
  coachPanel: false,
  lineupDraft: null,
  lineupSlot: null,
  autoSubsDraft: null,
  completing: false,
  accountOpen: false,
  authMode: 'login',
  turnstileToken: '',
  newGameOpen: false,
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
