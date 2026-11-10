import type { Attributes, GameState, Player } from './types.ts'
import { ALL_ATTRIBUTES } from './types.ts'
import { isMainAttr } from './scale.ts'
import { buildLeague } from './data/ai-teams.ts'
import { autoFillLineup, refreshAILineups, validateLineup } from './squad.ts'
import { elevenFormationFor } from './data/formations.ts'
import { upgradeElevenASide } from './eleven.ts'
import { validateAutoSubPlan } from './match/management.ts'
import { createSeason } from './season.ts'
import { ensureWorldCalendar } from './world.ts'
import { migrateGameSchedule } from './schedule.ts'
import { latestKickoffAt } from './calendar.ts'
import { splitSeed } from './rng.ts'
import { economyOf } from './economy.ts'
import { addLegacySignature } from './data/players.ts'
import { ensureCards } from './cards.ts'
import { ATTRS_VERSION, NAMES_VERSION, TRAITS_VERSION, upgradeBurstAttr, upgradeNames, upgradeStarTraits } from './names.ts'
import { ensurePve } from './pve.ts'
import { pruneChemistry } from './chemistry.ts'

// 游戏改名后仍沿用旧键，改了已有存档就读不到了。
export const SAVE_KEY = 'fm-seven-a-side-save-v3'
export const LEGACY_SAVE_KEY = 'fm-seven-a-side-save-v2'
/** 本地存档是系统自动建的、玩家还没亲自选过球队：离线模式进来时要先让他选一支。 */
export const TEAM_PICK_PENDING_KEY = 'fm-seven-a-side-team-pick-pending'

export function teamPickPending(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(TEAM_PICK_PENDING_KEY) === '1'
  } catch {
    return false
  }
}

export function setTeamPickPending(pending: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (pending) localStorage.setItem(TEAM_PICK_PENDING_KEY, '1')
    else localStorage.removeItem(TEAM_PICK_PENDING_KEY)
  } catch {
    /* 存储不可用时就当没有标记 */
  }
}
export const GAME_VERSION = 3

type RemoteSaver = (game: GameState) => void
let remoteSaver: RemoteSaver | null = null

export function setRemoteSaver(saver: RemoteSaver | null): void {
  remoteSaver = saver
}

export function createInitialGame(seed?: number, clubName = '青石'): GameState {
  const gameSeed = seed ?? Math.floor(Math.random() * 0x7fffffff)
  // 从最近一个开赛时间点（北京时间 12:00 / 20:00）开始：第 1 轮马上就能踢。
  const startedAt = latestKickoffAt(Date.now())
  const { playerTeam, aiTeams, freeStars } = buildLeague(gameSeed, clubName)
  const roster = playerTeam.players
  const lineup = playerTeam.lineup
  const check = validateLineup(roster, lineup)
  if (!check.valid) throw new Error(`初始阵容不合法：${check.errors.join('；')}`)
  const game: GameState = {
    version: GAME_VERSION,
    createdAt: startedAt,
    seed: gameSeed,
    clubName: playerTeam.name,
    roster,
    lineup,
    training: {},
    candidates: {},
    cards: [],
    namesVersion: NAMES_VERSION,
    traitsVersion: TRAITS_VERSION,
    attrsVersion: ATTRS_VERSION,
    season: createSeason(gameSeed, aiTeams, playerTeam.name, startedAt),
    aiTeams,
    freeStars,
    matchHistory: [],
    challengeHistory: [],
    ui: { screen: 'home' },
  }
  economyOf(game)
  ensurePve(game)
  return game
}

/** 只写本地缓存（联机存档来自服务器时用，避免把服务器状态再推回去）。 */
/**
 * 联赛直播回放（activeMatch.preplayed）只活在服务器下发的存档副本里：
 * 不落本地缓存，否则离线重开会把已经结束的比赛当成“进行中”。
 */
export function withoutReplay(game: GameState): GameState {
  return game.activeMatch?.preplayed ? { ...game, activeMatch: undefined } : game
}

export function cacheGameLocally(game: GameState): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SAVE_KEY, JSON.stringify(withoutReplay(game)))
  } catch {
    // 本地缓存失败不影响服务器同步。
  }
}

export function saveGame(game: GameState): boolean {
  pruneChemistry(game.chemistry, Date.now(), game.season.gameDayMs)
  game.ui = { ...(game.ui ?? { screen: 'home' }) }
  let local = false
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SAVE_KEY, JSON.stringify(withoutReplay(game)))
      local = true
    }
  } catch {
    local = false
  }
  try {
    remoteSaver?.(game)
    return local || !!remoteSaver
  } catch {
    return local
  }
}

export function loadGame(): GameState | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(SAVE_KEY) ?? localStorage.getItem(LEGACY_SAVE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as GameState
    const migrated = parsed?.version === 2
    if (migrated) migrateV2(parsed)
    if (!parsed || parsed.version !== GAME_VERSION || !Array.isArray(parsed.roster) || parsed.roster.length < 10) return null
    if (!parsed.lineup || !parsed.season || !Array.isArray(parsed.aiTeams) || !Array.isArray(parsed.freeStars)) return null
    if (!parsed.season.startedAt || parsed.season.table.length !== 20) return null
    if (parsed.world) {
      if (!Array.isArray(parsed.world.divisions) || !Array.isArray(parsed.world.clubs)) return null
      const division = parsed.world.divisions.find((item) => item.divisionId === (parsed.season.divisionId ?? parsed.world!.playerDivisionId))
      if (!division) return null
      if (parsed.season.divisionId) {
        division.fixtures = parsed.season.fixtures
        division.table = parsed.season.table
        division.finished = parsed.season.finished
        division.champion = parsed.season.champion
        division.playerFinish = parsed.season.playerFinish
        division.round = parsed.season.round
        division.startedAt = parsed.season.startedAt
        division.index = parsed.season.index
        division.seed = parsed.season.seed
      }
      parsed.season = division
      parsed.world.playerDivisionId = division.divisionId ?? parsed.world.playerDivisionId
      ensureWorldCalendar(parsed.world)
      parsed.reserveStars ??= []
      parsed.suspensions ??= {}
      parsed.yellowCounts ??= {}
      // 越位规则固定开启：旧存档里关掉过的也改回来。
      parsed.settings = { ...(parsed.settings ?? {}), offside: true }
    }
    // 一天一轮的旧赛程换成一天两轮（北京时间 12:00、20:00），当前该踢的轮次不变。
    const rescheduled = migrateGameSchedule(parsed, Date.now())
    // 7 人制存档迁移到 11 人制：补随机球员、换阵型（只在还有旧阵型时动手）。
    const elevenUpgraded = upgradeElevenASide(parsed)
    const repaired = repairLoadedLineup(parsed)
    // 以前 AI 买进来的球员没排进首发，一直坐在名单外：读档时按名单重排一次（单机的 AI 球队都没有教练）。
    const aiLineupsRefreshed = refreshAILineups(parsed.aiTeams.filter((team) => team && !team.isPlayer))
    const signaturesAdded = upgradeLegacySignatures(parsed)
    const economyAdded = parsed.economy == null
    economyOf(parsed)
    const cardsAdded = ensureCards(parsed)
    const namesUpgraded = upgradeNames(parsed)
    const traitsUpgraded = upgradeStarTraits(parsed)
    const attrsUpgraded = upgradeBurstAttr(parsed)
    const pveAdded = ensurePve(parsed)
    parsed.ui = parsed.ui ?? { screen: 'home' }
    const chemistryPruned = pruneChemistry(parsed.chemistry, Date.now(), parsed.season.gameDayMs)
    if (chemistryPruned || rescheduled || elevenUpgraded || repaired || aiLineupsRefreshed || migrated || signaturesAdded || economyAdded || cardsAdded || namesUpgraded || traitsUpgraded || attrsUpgraded || pveAdded) saveGame(parsed)
    return parsed
  } catch {
    return null
  }
}

export function upgradeLegacySignatures(game: GameState): boolean {
  const players = [
    ...game.roster,
    ...game.aiTeams.flatMap((team) => team?.players ?? []),
    ...game.freeStars,
    ...(game.reserveStars ?? []),
    ...Object.values(game.training ?? {}).map((session) => session?.candidate),
    ...Object.values(game.candidates ?? {}),
    ...(Array.isArray(game.market?.listings) ? game.market.listings.map((listing) => listing?.player) : []),
  ]
  let changed = false
  for (const player of players) if (player && addLegacySignature(player)) changed = true
  return changed
}

function migrateV2(game: GameState): void {
  const seen = new Set<Player>()
  const scalePlayer = (player: Player) => {
    if (seen.has(player)) return
    seen.add(player)
    const gk = player.positions.GK > 0
    player.attrs = scaleAttrs(player.attrs, gk)
    player.ceilings = scaleAttrs(player.ceilings, gk)
    player.baseAttrs = scaleAttrs(player.baseAttrs, gk)
    player.pa = Math.round(player.pa * 7.5 * 10) / 10
    if (player.history) {
      player.history = player.history.map((entry) => entry.gains ? { ...entry, gains: scaleGains(entry.gains, gk) } : entry)
    }
  }
  game.roster.forEach(scalePlayer)
  game.aiTeams.forEach((team) => team.players.forEach(scalePlayer))
  game.freeStars.forEach(scalePlayer)
  game.market?.listings?.forEach((listing) => scalePlayer(listing.player))
  Object.values(game.training).forEach((session) => {
    scalePlayer(session.candidate)
    const gk = session.candidate.positions.GK > 0
    session.log = session.log.map((entry) => entry.gains ? { ...entry, gains: scaleGains(entry.gains, gk) } : entry)
  })
  Object.values(game.candidates).forEach(scalePlayer)
  game.version = GAME_VERSION
}

function scaleGains(gains: Partial<Record<keyof Attributes, number>>, gk: boolean): Partial<Record<keyof Attributes, number>> {
  const out: Partial<Record<keyof Attributes, number>> = {}
  for (const [key, value] of Object.entries(gains) as [keyof Attributes, number][]) {
    out[key] = Math.round((isMainAttr(key, gk) ? value * 15 : value / 5) * 10) / 10
  }
  return out
}

function scaleAttrs(attrs: Attributes, gk: boolean): Attributes {
  const out = {} as Attributes
  for (const key of ALL_ATTRIBUTES) {
    out[key] = Math.round((isMainAttr(key, gk) ? attrs[key] * 15 : attrs[key] / 5) * 10) / 10
  }
  return out
}

function repairLoadedLineup(game: GameState): boolean {
  if (validateLineup(game.roster, game.lineup).valid) return false
  const formation = elevenFormationFor(game.lineup.formationId)
  game.lineup = autoFillLineup(game.roster, formation, game.lineup.tactics)
  if (game.autoSubs && validateAutoSubPlan(game.roster, game.lineup, game.autoSubs).length) delete game.autoSubs
  return true
}

export function clearSave(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SAVE_KEY)
      localStorage.removeItem(LEGACY_SAVE_KEY)
    }
  } catch {
    // ignore
  }
}

export function hasSave(): boolean {
  try {
    return typeof localStorage !== 'undefined' && !!(localStorage.getItem(SAVE_KEY) ?? localStorage.getItem(LEGACY_SAVE_KEY))
  } catch {
    return false
  }
}

export function newTrainingSeed(game: GameState, playerId: string): number {
  return splitSeed(game.seed, `training-${playerId}-${Date.now()}`)
}
