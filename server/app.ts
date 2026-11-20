import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import {
  buildGameDelta,
  compareTeamPlayers,
  createMemoryMonitor,
  createSseSink,
  deepEqual,
  digestGameSections,
  fingerprintValue,
  negotiateEncoding,
  projectAiTeam,
  sendCompressedJson,
  slimMatchRecord,
  writeJsonChunkedAsync,
  writeJsonChunkedSync,
  type GameSectionDigest,
  type SseSink,
} from './state-sync.ts'
import { createInitialGame, GAME_VERSION, upgradeLegacySignatures } from '../src/game/state.ts'
import { addTrainedCard, ensureCards, equipCard, playerCards, recyclePlayerCards, setCardRecycleLock, untrainedPlayer } from '../src/game/cards.ts'
import { ensurePve } from '../src/game/pve.ts'
import { loadPveContent } from '../src/game/pve-content.ts'
import { upgradeBurstAttr, upgradeNames, upgradeSharedWorldNames, upgradeStarTraits } from '../src/game/names.ts'
import { advanceSharedAccountSeason, advanceWorldSeason, buildOwnerlessTeams, catchUpExpandedDivision, createOwnerlessWorld, createWorldGameFromWorld, computeWorldTable, ensureWorldCalendar, healInjuriesByMs, migrateLegacyExpandedTactics, ownerlessWorldFromClub, pickFreeClubForNewAccount, expandWorldConference, ensurePromotionPlayoff, repairInflatedContractWages, syncAllClubLiveTactics, syncClubLiveTactics, wageForPlayer, worldForClub, worldSlots, worldWageBill } from '../src/game/world.ts'
import { pickExpandedZoneClubs } from '../src/game/data/world-clubs.ts'
import { lineupLockState } from '../src/game/season.ts'
import { completedWorldRound, paysSeasonCupAppearanceGold, seasonRoundKickoff, worldRoundsKickedOff } from '../src/game/season-cups.ts'
import { legendCupTeamById } from '../src/game/data/legend-cup-teams.ts'
import { LEGEND_STAR_BOOK_ID } from '../src/game/data/legend-cup-skill.ts'
import type { AIClubState, AITeam, Player, WorldClub, WorldState } from '../src/game/types.ts'
import { caOf } from '../src/game/ca.ts'
import { refreshAILineup, refreshAILineups, repairLineup } from '../src/game/squad.ts'
import { displayCA, mainAttrsFor } from '../src/game/rating.ts'
import { GAME_DAY_MS, kickoffAtForRound, postseasonStartAt, roundsKickedOff, seasonEndAt } from '../src/game/calendar.ts'
import { isYouthTrainee, recordYouthMatch, settleYouth, observeYouthFacility } from '../src/game/youth.ts'
import { applyYouthAction } from '../src/game/youth-actions.ts'
import { preserveYouthState } from '../src/game/youth-authority.ts'
import { settleCondition } from '../src/game/condition.ts'
import { splitSeed } from '../src/game/rng.ts'
import { awardRoundIncome, awardSeasonPrize, economyOf, matchPerformanceOf, payWageBill } from '../src/game/economy.ts'
import { advanceLeagueRealtime } from '../src/game/realtime.ts'
import { DEFAULT_PRE_MATCH_STAMINA_BELOW, DEFAULT_STAMINA_BELOW, emptyAutoSubs, validateAutoSubPlan } from '../src/game/match/management.ts'
import type { ActiveMatchSave, GameState, PlayerCard } from '../src/game/types.ts'
import { LEAGUE_REALTIME_MS, LOGIC_MATCH_SECONDS } from '../src/game/match/time.ts'
import { absorbFreeAgents, aiClubIdOf, auctionRaiseFee, committedFunds, leadingBid, minimumBid, placeAIBid, placeBid, settleAuctions, type AIBidder, type Auction, type AuctionResult, type BidResult, type FreeMarket } from '../src/game/auction.ts'
import { isOnMarketToday } from '../src/game/market-window.ts'
import { lineupRating } from '../src/game/club-rating.ts'
import { AI_SQUAD_LIMIT, advanceAIClub, aiBidFor, createAIClub, playerValue, recordAISigning, seedAIClubs } from '../src/game/ai-club.ts'
import { agentView, applyAgentAction, playerView, type AgentOptions } from './agent.ts'
import { clubNameError, normalizeClubName } from '../src/game/club-name.ts'
import { negotiationDemands, SEASON_GOAL_LABELS, SQUAD_ROLE_LABELS, type SeasonGoal, type SquadRole } from '../src/game/negotiation.ts'
import { aiPoachRound, expireOffers, generateAIOffers, respondToOffer, type MarketClub } from '../src/game/transfers.ts'
import { marketDayOf, refreshFreeMarket } from '../src/game/free-market.ts'
import { migrateGameSchedule, migrateWorldSchedule } from '../src/game/schedule.ts'
import { aiBuysLeft, noteAIBuy } from '../src/game/transfer-rules.ts'
import { aiTransferOffers, sellerSquadError, settleMarket, signClubPlayer } from '../src/game/market.ts'
import { elevenAITeam, upgradeElevenASide } from '../src/game/eleven.ts'
import { elevenFormationFor, isLegacyFormation } from '../src/game/data/formations.ts'
import { startChallengeWithOpponent, startPeakChallenge, startTrainingWithSupport } from '../src/game/actions.ts'
import { awardAISeasonCup, awardSeasonCupChampion, awardSeasonCupMatch } from '../src/game/season-cup-rewards.ts'
import { seasonCupPlayerStats } from '../src/game/season-cup-stats.ts'
import { cupCeilingBonus, ensureCupCeilingClaims } from '../src/game/cup-rewards.ts'
import { preservePeakAttempts, validatePeakSave } from './peak-guard.ts'
import { validateLegacyCupSave } from './legacy-cup-guard.ts'
import { MatchQueue, type MatchQueueOptions } from './match-queue.ts'
import { MatchScheduler } from './match-scheduler.ts'
import { emptyMatchBook, matchJobId, seasonCupJobId, recordForClub, type LockedTeam, type MatchBook, type MatchJob } from './match-job.ts'
import { awardLeagueBookDrops } from '../src/game/league-book-drops.ts'
import { awardSeasonShopPoints, buyShopBook } from '../src/game/shop.ts'
import { chemistryForPlayers, mergeChemistryTraining } from '../src/game/chemistry.ts'
import { isStyleId, tryValidateInstructions } from '../src/game/pes/tactics.ts'
import { isMatchPlanId, matchPlanConditionFactor } from '../src/game/pes/match-plan.ts'
import { simulateAITrainingSession } from '../src/game/ai-training.ts'
import { settleSquadEnergy } from '../src/game/energy.ts'
import { TRAINING_ENERGY_COST } from '../src/game/training.ts'
import { SCOUT_LEVELS, startScouting, deleteScoutReport, visibleScoutReports, scoutKeepsOnMarket } from '../src/game/scouting.ts'
import { migrateLivePlayerPositions, migratePositionProfiles, preservePositionProfiles } from '../src/game/position-profile-migration.ts'
import {
  CHAT_COOLDOWN_MS,
  CHAT_HISTORY_LIMIT,
  isValidChatMessage,
  sanitizeChatColor,
  validateChatText,
  type ChatMessage,
  type ChatSseMessage,
} from '../src/game/chat.ts'

/** 玩家超过 3 天未上线（现实 72 小时）后，球队临时进入 AI 接管状态；重新上线即刻解除。 */
export const AI_TAKEOVER_INACTIVE_MS = 3 * 24 * 60 * 60_000
const ONLINE_PERSIST_INTERVAL_MS = 5 * 60_000

import { AccountStore, type Account } from './account-store.ts'

type SharedWorld = {
  seed: number
  startedAt: number
  owners: Record<string, string>
  world: WorldState
  /** 全服唯一的球队名册；已接管球队的名单由教练存档同步回来。 */
  teams?: Record<string, AITeam>
  /** Opening rosters shared by all cup draws, including coaches joining midseason. */
  cupOpening?: { seasonIndex: number; teams: Record<string, AITeam> }
  /** 全服共用的自由球员池，只有服务器能改。 */
  freeStars: Player[]
  reserveStars: Player[]
  auctions?: Auction[]
  auctionLog?: AuctionResult[]
  marketVersion?: number
  positionProfilesVersion?: 1
  /** 电脑球队的钱、设施和培养成果；全服一份，跟着赛季一起滚。 */
  aiClubs?: Record<string, AIClubState>
  /** 自由市场最近一次每日补充是第几个游戏日。 */
  freeMarketDay?: number
  /** 仅含已经公布的比赛影响；未公布结果永远留在私有任务目录。 */
  matchBook?: MatchBook
  /** 电脑球队已经算到第几轮，防止每个 tick 都推进一次。 */
  aiRound?: number
}

export type RegistrationMode = 'open' | 'invite' | 'closed'

export type AppServerOptions = {
  dataDir?: string
  staticDir?: string
  tickMs?: number
  matchQueue?: MatchQueueOptions
  /** 赛季杯赛开发期显式启用，默认关闭以保护现有生产赛程。 */
  seasonCups?: boolean
  compactAccountWrites?: boolean
  now?: () => number
  /** 注册入口：open 谁都能注册；invite 需要邀请码；closed 只能登录。默认 open。 */
  registration?: RegistrationMode
  /** registration 为 invite 时的邀请码。 */
  inviteCode?: string
  /** 配置后注册必须通过 Cloudflare Turnstile 校验。 */
  turnstileSecret?: string
  /** 下发给前端的 Turnstile sitekey。 */
  turnstileSiteKey?: string
  /** 单 IP 每小时注册次数上限；0 或不填表示不限。 */
  registerLimitPerHour?: number
  /** 测试用内存压力钩子；省略时按 RSS / 堆占比 / 可用物理内存自动判定。 */
  memoryPressure?: () => boolean
}

export type AppServer = {
  server: http.Server
  close: () => void
  /** 停止接收新请求，等待在途请求完成后 flush（进程退出时使用）。 */
  shutdown: () => Promise<void>
  /** 等待账号和会话落盘（正常请求由后台合并保存）。 */
  flush: () => Promise<void>
  accountCount: () => number
  /** 运维 / 测试驱动一次后台队列，仍受服务器时间和统一公布规则约束。 */
  runMatchQueue: () => Promise<void>
}

const WORLD_FILE = 'world.json'
const CHAT_FILE = 'chat.json'

export function createAppServer(options: AppServerOptions = {}): AppServer {
  const dataDir = path.resolve(options.dataDir ?? 'data')
  const staticDir = path.resolve(options.staticDir ?? 'dist')
  const now = options.now ?? Date.now
  const tickMs = options.tickMs ?? 30_000
  const memoryMonitor = createMemoryMonitor(options.memoryPressure)
  const registrationMode: RegistrationMode = options.registration ?? 'open'
  const inviteCode = options.inviteCode?.trim() ?? ''
  const turnstileSecret = options.turnstileSecret?.trim() ?? ''
  const turnstileSiteKey = options.turnstileSiteKey?.trim() ?? ''
  const registerLimitPerHour = Math.max(0, Math.trunc(options.registerLimitPerHour ?? 0))
  /* 邀请码模式没配邀请码会锁死注册，直接报错，避免部署后没人能注册。 */
  if (registrationMode === 'invite' && !inviteCode) throw new Error('registration=invite 需要配置 inviteCode')
  fs.mkdirSync(dataDir, { recursive: true })

  const accountStore = new AccountStore(dataDir, undefined, options.compactAccountWrites)
  const db = { accounts: accountStore.accounts }
  const persistAccount = (account: Account) => accountStore.save(account)
  // 关键操作未确认落盘时，不能通过 GET、SSE 或 Agent 把内存里的结果当作已提交。
  const pendingAccountCommits = new Map<string, symbol>()
  async function confirmAccountCommit(account: Account): Promise<boolean> {
    try {
      let commit: symbol | undefined
      while ((commit = pendingAccountCommits.get(account.id))) {
        await accountStore.flush()
        // 另一笔提交可能在等待落盘期间开始；只清除刚刚确认的那一笔。
        if (pendingAccountCommits.get(account.id) === commit) pendingAccountCommits.delete(account.id)
      }
      return true
    } catch {
      return false
    }
  }
  const worldPath = path.join(dataDir, WORLD_FILE)
  const loadedWorld = readJson<Partial<SharedWorld> | null>(worldPath, null)
  const sharedWorld: SharedWorld = {
    seed: loadedWorld?.seed ?? crypto.randomInt(1, 0x7fffffff),
    // 全新世界从当前时间之后的固定开球点开始；已有世界沿用其赛程，不为注册补造比赛。
    startedAt: loadedWorld?.startedAt ?? kickoffAtForRound(now(), 1),
    owners: loadedWorld?.owners ?? {},
    world: loadedWorld?.world as WorldState,
    teams: loadedWorld?.teams,
    cupOpening: loadedWorld?.cupOpening,
    freeStars: loadedWorld?.freeStars ?? [],
    reserveStars: loadedWorld?.reserveStars ?? [],
    auctions: loadedWorld?.auctions ?? [],
    auctionLog: loadedWorld?.auctionLog ?? [],
    marketVersion: loadedWorld?.marketVersion ?? 1,
    positionProfilesVersion: loadedWorld?.positionProfilesVersion,
    aiClubs: loadedWorld?.aiClubs,
    aiRound: loadedWorld?.aiRound,
    matchBook: loadedWorld?.matchBook,
  }
  if (sharedWorld.world) {
    ensureWorldCalendar(sharedWorld.world)
    if (sharedWorld.world.seasonCups) {
      sharedWorld.world.seasonCups.drawSeed ??= sharedWorld.seed
      for (const cup of sharedWorld.world.seasonCups.cups) if (cup.id === 'cross' && cup.name === '跨级杯') cup.name = '星联杯'
    }
  }
  if (!sharedWorld.world) {
    const ownerless = createOwnerlessWorld(sharedWorld.seed, sharedWorld.startedAt)
    sharedWorld.world = ownerless.world
    sharedWorld.freeStars = ownerless.freeStars
    sharedWorld.reserveStars = ownerless.reserveStars
  }
  upgradeSharedWorldNames(sharedWorld)
  if (!sharedWorld.aiClubs) sharedWorld.aiClubs = seedAIClubs(sharedWorld.world, sharedWorld.seed)
  if (!sharedWorld.teams || Object.keys(sharedWorld.teams).length !== sharedWorld.world.clubs.length) {
    sharedWorld.teams = buildOwnerlessTeams(sharedWorld.world, sharedWorld.seed, sharedWorld.aiClubs)
    // 兼容旧服务器：先保留已有账号的球队名单，不重新生成已培养的球员。
    for (const account of db.accounts) {
      const clubId = Object.keys(sharedWorld.owners).find((id) => sharedWorld.owners[id] === account.id)
      if (clubId && account.game?.roster) sharedWorld.teams[clubId] = { ...sharedWorld.teams[clubId], players: structuredClone(account.game.roster), lineup: structuredClone(account.game.lineup) }
    }
    // 旧世界按账号各自挑招牌球星；迁移时从无主 AI 球队删掉已被教练签下的球星。
    const held = new Set(db.accounts.flatMap((account) => account.game?.roster?.map((player) => player.id) ?? []))
    for (const club of sharedWorld.world.clubs) {
      if (sharedWorld.owners[club.id] || !sharedWorld.teams[club.id]) continue
      const team = sharedWorld.teams[club.id]
      if (!team.players.some((player) => held.has(player.id))) continue
      team.players = team.players.filter((player) => !held.has(player.id))
      team.starPlayerIds = team.starPlayerIds.filter((id) => !held.has(id))
      club.starPlayerIds = club.starPlayerIds.filter((id) => !held.has(id))
      team.lineup = repairLineup(team.players, team.lineup).lineup
    }
  }
  // 将旧版扩区生成的无主虚构队名（缺少 enName 的 d2z* 球队）平滑升级为统一风格的真实低级别球队名（≤7 字）。
  {
    const isLegacyExpanded = (club: WorldClub) => club.id.startsWith('d2z') && !club.enName && !sharedWorld.owners[club.id]
    const legacyExpanded = sharedWorld.world.clubs.filter(isLegacyExpanded)
    if (legacyExpanded.length) {
      const usedNames = new Set([
        ...sharedWorld.world.clubs.filter((club) => !isLegacyExpanded(club)).map((club) => club.name),
        ...db.accounts.map((account) => account.game?.clubName).filter((name): name is string => !!name),
      ])
      const byZone = new Map<number, WorldClub[]>()
      for (const club of legacyExpanded) {
        const zoneNo = Number(club.conference?.replace('zone', '') ?? '3')
        const key = Number.isInteger(zoneNo) && zoneNo >= 3 ? zoneNo : 3
        byZone.set(key, [...(byZone.get(key) ?? []), club])
      }
      const touchedDivisions = new Set<string>()
      for (const [zoneNo, clubs] of byZone) {
        const identities = pickExpandedZoneClubs(zoneNo, usedNames, clubs.length)
        clubs.forEach((club, index) => {
          const identity = identities[index]
          if (!identity) return
          const [name, enName, color] = identity
          usedNames.add(name)
          club.name = name
          club.enName = enName
          club.short = name.slice(0, 2)
          club.color = color
          club.accent = '#0f172a'
          club.style = '二级联赛球队。'
          const team = sharedWorld.teams?.[club.id]
          if (team) {
            team.name = name
            team.enName = enName
            team.short = name.slice(0, 2)
            team.color = color
            team.accent = '#0f172a'
            team.style = '二级联赛球队。'
          }
          if (club.conference) touchedDivisions.add(`d2-${club.conference}`)
        })
      }
      const clubNames = new Map(sharedWorld.world.clubs.map((club) => [club.id, club.name]))
      for (const division of sharedWorld.world.divisions) {
        if (division.divisionId && touchedDivisions.has(division.divisionId)) {
          division.table = computeWorldTable(division.clubIds ?? [], division.fixtures, clubNames)
        }
      }
    }
  }
  // 赛程迁移（一天固定 6 轮：北京时间 02/06/10/14/18/22）：共享世界与各账号同步重排未赛场次，并补齐默认没体力自动换人。
  {
    const at = now()
    migrateWorldSchedule(sharedWorld.world, at)
    ensureWorldCalendar(sharedWorld.world)
    for (const account of db.accounts) {
      if (account.game && migrateGameSchedule(account.game, at)) {
        account.revision++
        account.lastUserRevision = account.revision
        persistAccount(account)
      }
    }
  }
  // 7 人制 → 11 人制：先迁移每个账号（玩家球队补随机球员、换阵型），有教练的球队名单直接用账号里的新名单，
  // 其余 AI 球队各自补人、换阵型，世界里各队的阵型也一起换。迁移过一次之后这里什么都不做。
  {
    for (const account of db.accounts) {
      if (account.game && upgradeElevenASide(account.game)) persistAccount(account)
    }
    for (const club of sharedWorld.world.clubs) {
      if (isLegacyFormation(club.formationId)) club.formationId = elevenFormationFor(club.formationId)
    }
    for (const [clubId, team] of Object.entries(sharedWorld.teams ?? {})) {
      if (!isLegacyFormation(team.formationId) && !isLegacyFormation(team.lineup?.formationId ?? '')) continue
      const owner = db.accounts.find((account) => account.id === sharedWorld.owners[clubId])
      const ownsIt = owner?.game?.world?.clubs.find((club) => club.id === 'player')?.squadKey === clubId
      sharedWorld.teams![clubId] = ownsIt && owner
        ? { ...team, formationId: owner.game.lineup.formationId, players: structuredClone(owner.game.roster), lineup: structuredClone(owner.game.lineup) }
        : elevenAITeam(team, sharedWorld.seed)
    }
  }
  // 统一迁移账号与共享世界的实时球员；已锁定的比赛任务、回放和杯赛开赛快照不改。
  for (const account of db.accounts) {
    const posChanged = account.game ? migratePositionProfiles(account.game) : false
    const wageFixed = account.game ? repairInflatedContractWages(account.game.roster) : false
    if (posChanged || wageFixed) {
      account.revision++
      account.lastUserRevision = account.revision
      persistAccount(account)
    }
  }
  for (const team of Object.values(sharedWorld.teams ?? {})) {
    repairInflatedContractWages(team.players)
  }
  for (const player of [
    ...Object.values(sharedWorld.teams ?? {}).flatMap(team => team.players),
    ...sharedWorld.freeStars, ...sharedWorld.reserveStars,
    ...Object.values(sharedWorld.aiClubs ?? {}).flatMap(club => club.signings ?? []),
    ...Object.values(sharedWorld.world.transferTeams ?? {}).flatMap(team => team.players),
  ]) migrateLivePlayerPositions(player)
  // Clients cache the free-player pool by market version.
  if (sharedWorld.positionProfilesVersion !== 1) {
    sharedWorld.positionProfilesVersion = 1
    sharedWorld.marketVersion = (sharedWorld.marketVersion ?? 1) + 1
  }
  // 早期扩区（v0.4.18 前）的 d2z* 球队战术统一写死为默认均衡：按确定性洗牌补齐多样化基底战术，
  // 同步更新无主 AI 球队的基底战术（真人执教球队阵容不动）。
  migrateLegacyExpandedTactics(sharedWorld.world, sharedWorld.seed, {
    teams: sharedWorld.teams,
    owners: sharedWorld.owners,
  })
  // 以前 AI 买进来的球员没排进首发（只修“不合法”的阵容），一直坐在名单外：无主的 AI 球队按名单重排一次。
  // 有教练的球队阵容是教练自己排的，不动。
  refreshAILineups(Object.entries(sharedWorld.teams ?? {}).filter(([clubId]) => !sharedWorld.owners[clubId]).map(([, team]) => team))
  syncAllClubLiveTactics(sharedWorld.world, sharedWorld.teams)
  if (!sharedWorld.matchBook) {
    sharedWorld.matchBook = emptyMatchBook()
    for (const account of db.accounts) {
      Object.assign(sharedWorld.matchBook.injuries, account.game?.injuries)
      Object.assign(sharedWorld.matchBook.suspensions, account.game?.suspensions)
      Object.assign(sharedWorld.matchBook.yellowCounts, account.game?.yellowCounts)
      Object.assign(sharedWorld.matchBook.appearances, account.game?.appearances)
    }
  }
  let sharedWorldVersion = 1
  let sharedTeamsPublicVersion = 1
  let sharedMatchBookVersion = 1
  let worldDirty = false
  let worldWriteUrgent = false
  let worldWriteGen = 0
  let worldWriteTimer: ReturnType<typeof setTimeout> | null = null
  let worldWriteTimerDelayMs = 0
  let worldWriteInFlight: Promise<void> | null = null
  let worldPersistDeferDepth = 0

  function flushWorldSync(): void {
    if (worldWriteTimer) { clearTimeout(worldWriteTimer); worldWriteTimer = null; worldWriteTimerDelayMs = 0 }
    if (!worldDirty) return
    worldDirty = false
    worldWriteUrgent = false
    worldWriteGen++
    writeJsonChunkedSync(worldPath, sharedWorld)
  }

  async function flushWorldAsync(): Promise<void> {
    if (worldWriteTimer) { clearTimeout(worldWriteTimer); worldWriteTimer = null; worldWriteTimerDelayMs = 0 }
    while (worldWriteInFlight || worldDirty) {
      if (worldWriteInFlight) { await worldWriteInFlight; continue }
      if (!worldDirty) break
      worldDirty = false
      worldWriteUrgent = false
      const gen = ++worldWriteGen
      const run = writeJsonChunkedAsync(worldPath, sharedWorld, memoryMonitor.isUnderPressure, () => gen === worldWriteGen)
        .catch((error) => {
          if (gen === worldWriteGen) worldDirty = true
          console.error('world.json 异步写入失败', error)
          throw error
        })
        .finally(() => { if (worldWriteInFlight === run) worldWriteInFlight = null })
      worldWriteInFlight = run
      await run
    }
  }

  const WORLD_WRITE_URGENT_MS = 300
  const WORLD_WRITE_LAZY_MS = 5 * 60_000
  function scheduleWorldWrite(): void {
    if (closed || worldWriteInFlight) return
    const delayMs = worldWriteUrgent ? WORLD_WRITE_URGENT_MS : WORLD_WRITE_LAZY_MS
    if (worldWriteTimer) {
      if (delayMs >= worldWriteTimerDelayMs) return
      clearTimeout(worldWriteTimer)
      worldWriteTimer = null
    }
    worldWriteTimerDelayMs = delayMs
    worldWriteTimer = setTimeout(() => {
      worldWriteTimer = null
      worldWriteTimerDelayMs = 0
      if (!worldDirty || closed) return
      void flushWorldAsync().catch(() => {
        if (!closed) scheduleWorldWrite()
      })
    }, delayMs)
    worldWriteTimer.unref?.()
  }

  type PersistWorldReason = { world?: boolean; teams?: boolean; matchBook?: boolean; immediate?: boolean; lowPriority?: boolean }
  function persistWorld(reason: PersistWorldReason = { world: true, teams: true, matchBook: true }): void {
    if (reason.world) sharedWorldVersion++
    if (reason.teams) sharedTeamsPublicVersion++
    if (reason.matchBook) sharedMatchBookVersion++
    worldDirty = true
    if (!reason.lowPriority) worldWriteUrgent = true
    if (worldPersistDeferDepth > 0 && !reason.immediate) return
    if (tickMs === 0 || reason.immediate) {
      flushWorldSync()
    } else {
      scheduleWorldWrite()
    }
  }

  function withDeferredWorldPersist<T>(fn: () => T): T {
    worldPersistDeferDepth++
    try {
      return fn()
    } finally {
      worldPersistDeferDepth--
      if (worldPersistDeferDepth === 0 && worldDirty) {
        if (tickMs === 0) flushWorldSync()
        else scheduleWorldWrite()
      }
    }
  }

  writeJsonChunkedSync(worldPath, sharedWorld)

  type AccountSyncState = {
    worldVer: number
    fixturesVer: number
    teamsVer: number
    marketVer: number
    matchBookVer: number
    worldSeason: number
    migratedGame?: GameState
  }
  const accountSync = new WeakMap<Account, AccountSyncState>()
  const syncOf = (account: Account): AccountSyncState => {
    let state = accountSync.get(account)
    if (!state) {
      state = { worldVer: 0, fixturesVer: 0, teamsVer: 0, marketVer: 0, matchBookVer: 0, worldSeason: -1 }
      accountSync.set(account, state)
    }
    return state
  }
  const chatPath = path.join(dataDir, CHAT_FILE)
  const loadedChat = readJson<unknown>(chatPath, [])
  const chatMessages: ChatMessage[] = Array.isArray(loadedChat)
    ? loadedChat.filter(isValidChatMessage).slice(-CHAT_HISTORY_LIMIT)
    : []
  const persistChat = () => writeJson(chatPath, chatMessages)
  const chatLastSentAt = new Map<string, number>()
  let chatSeq = 0
  const sessions = accountStore.sessions
  type EventClient = {
    res: ServerResponse
    sink: SseSink
    id: string
    lazyCup: boolean
    slim: boolean
    delta: boolean
    lastRevision: number
    lastDigest: GameSectionDigest | null
    queue: Promise<void>
    pendingBroadcast: { source?: string } | null
    closed: boolean
  }
  const clients = new Map<string, Set<EventClient>>()
  const registerAttempts = new Map<string, number[]>()
  let closed = false

  function isAccountOnlineNow(account: Account): boolean {
    return (clients.get(account.id)?.size ?? 0) > 0
  }

  function isAccountAITakeover(account: Account, at = now()): boolean {
    if (isAccountOnlineNow(account)) return false
    const lastOnline = account.lastOnlineAt ?? account.createdAt
    return at - lastOnline > AI_TAKEOVER_INACTIVE_MS
  }

  /** 只返回球队 ID 和公开执教状态，不带账号 ID、在线时间或球员名单。 */
  function clubCoaches(): Record<string, 'human' | 'takeover'> {
    const accounts = new Map(db.accounts.map(account => [account.id, account]))
    const result: Record<string, 'human' | 'takeover'> = {}
    const at = now()
    for (const [clubId, ownerId] of Object.entries(sharedWorld.owners)) {
      const owner = accounts.get(ownerId)
      if (owner) result[clubId] = isAccountAITakeover(owner, at) ? 'takeover' : 'human'
    }
    return result
  }

  function touchAccountOnline(account: Account, forcePersist = false): void {
    const t = now()
    const prev = account.lastOnlineAt
    const wasTakeover = prev !== undefined && t - prev > AI_TAKEOVER_INACTIVE_MS
    account.lastOnlineAt = t
    if (!closed && (forcePersist || prev === undefined || wasTakeover || t - prev >= ONLINE_PERSIST_INTERVAL_MS)) {
      persistAccount(account)
    }
  }
  let cachedCupOpening: { seasonIndex: number; teams: Record<string, AITeam>; list: AITeam[] } | null = null
  function cupOpeningTeams(): AITeam[] {
    if (sharedWorld.cupOpening?.seasonIndex !== sharedWorld.world.seasonIndex) {
      sharedWorld.cupOpening = { seasonIndex: sharedWorld.world.seasonIndex, teams: structuredClone(sharedWorld.teams ?? {}) }
      persistWorld({ world: false, teams: false, matchBook: false })
    }
    if (!cachedCupOpening || cachedCupOpening.seasonIndex !== sharedWorld.cupOpening.seasonIndex || cachedCupOpening.teams !== sharedWorld.cupOpening.teams) {
      cachedCupOpening = {
        seasonIndex: sharedWorld.cupOpening.seasonIndex,
        teams: sharedWorld.cupOpening.teams,
        list: Object.values(sharedWorld.cupOpening.teams),
      }
    }
    return cachedCupOpening.list
  }
  const matchQueue = new MatchQueue(path.join(dataDir, 'match-jobs'), options.matchQueue)
  // 升级前已公布的杯赛可以从已保存的任务补齐榜单；绝不读取未公开比赛。
  {
    let changed = false, complete = true
    const season = sharedWorld.world.seasonCups
    const rewardBackfill = !!season && season.aiRewardVersion !== 1
    for (const cup of season?.cups ?? []) for (const round of cup.rounds) for (const fixture of round.fixtures) {
      if (!fixture.played || !fixture.matchId) continue
      const needStats = !fixture.scorers || !fixture.assisters || !fixture.playerStats
      if (!needStats && !rewardBackfill) continue
      if (!matchQueue.ready(fixture.matchId)) { complete = false; continue }
      const { input, result } = matchQueue.read(fixture.matchId)
      if (needStats) {
        fixture.scorers ??= result.fixture.scorers ?? []
        fixture.assisters ??= result.fixture.assisters ?? []
        fixture.playerStats ??= seasonCupPlayerStats(result.record)
        changed = true
      }
      if (rewardBackfill && paysSeasonCupAppearanceGold(fixture)) for (const locked of [input.home, input.away]) {
        const ai = !locked.coachId ? sharedWorld.aiClubs?.[locked.team.id] : undefined
        if (!ai) continue
        const champion = cup.championId === locked.team.id && round.round === cup.rounds.at(-1)?.round && round.fixtures.length === 1 && fixture.winnerId === locked.team.id
        awardAISeasonCup(ai, cup.id, fixture.matchId, input.season, champion)
        changed = true
      }
    }
    if (season && rewardBackfill && complete) { season.aiRewardVersion = 1; changed = true }
    if (changed) persistWorld({ world: true, teams: false, matchBook: false, immediate: true })
  }
  const matchScheduler = new MatchScheduler(
    matchQueue,
    sharedWorld,
    lockedTeamFor,
    () => persistWorld({ world: true, teams: true, matchBook: true, immediate: true }),
    options.seasonCups === true,
  )
  const market: FreeMarket = {
    pool: sharedWorld.freeStars,
    auctions: sharedWorld.auctions ?? [],
    log: sharedWorld.auctionLog ?? [],
    version: sharedWorld.marketVersion ?? 1,
  }
  function persistMarket(): void {
    sharedWorld.freeStars = market.pool
    sharedWorld.auctions = market.auctions
    sharedWorld.auctionLog = market.log
    sharedWorld.marketVersion = market.version
    persistWorld({ world: false, teams: false, matchBook: false })
  }
  function advanceSharedWorld(): boolean {
    const changed = matchScheduler.refresh(now())
    advanceSharedAIClubs()
    return changed
  }

  /**
   * 电脑球队按轮推进：收钱、培养、升设施。所有球队共用一份账本，赛季滚动时保留。
   * 练出来的卡当场装到共享名册上（每轮只改一次），对手这一轮踢球就用新卡，玩家也能在球队名单里看到。
   */
  const serverSeason = () => sharedWorld.world.seasonIndex
  const worldRound = () => Math.min(38, Math.max(0, worldRoundsKickedOff(sharedWorld.world, now())))
  /** 转会窗口常开。 */
  const worldWindowOpen = () => true
  /** 没有教练执教的 AI 俱乐部：共享名册 + 共享账本。ids 给了就只取这几家。 */
  function sharedMarketClubs(ids?: readonly string[]): MarketClub[] {
    const book = sharedWorld.aiClubs ?? {}
    return sharedWorld.world.clubs
      .filter((club) => !club.isPlayer && !sharedWorld.owners[club.id] && (!ids || ids.includes(club.id)))
      .flatMap((club) => {
        const team = sharedWorld.teams?.[club.id]
        const state = book[club.id]
        return team && state ? [{ id: club.id, name: team.name, tier: club.tier ?? 'division2', team, state }] : []
      })
  }
  /** 这家 AI 正领先的竞拍数：赢了就会占买进名额，所以先算在途。 */
  const aiLeadingAuctions = (clubId: string) => market.auctions.filter((auction) => auction.bids.length > 0 && leadingBid(auction).accountId === `ai:${clubId}`).length

  function advanceSharedAIClubs(): void {
    const book = (sharedWorld.aiClubs ??= seedAIClubs(sharedWorld.world, sharedWorld.seed))
    const round = worldRound()
    const previous = sharedWorld.aiRound ?? 0
    if (previous >= round) return
    const rounds = Math.min(round - previous, 38)
    sharedWorld.aiRound = round
    let changed = false
    for (const club of sharedWorld.world.clubs) {
      if (club.isPlayer || sharedWorld.owners[club.id]) continue
      const state = (book[club.id] ??= createAIClub(club, splitSeed(sharedWorld.seed, `ai-club-${club.id}`)))
      const team = sharedWorld.teams?.[club.id]
      const before = `${state.economy.balance}|${state.trained}|${state.upgrades}`
      advanceAIClub(state, club, team, rounds, splitSeed(sharedWorld.seed, `ai-advance-${club.id}-${round}`), true, sharedWorld.world.seasonIndex)
      if (syncClubLiveTactics(club, team)) changed = true
      if (`${state.economy.balance}|${state.trained}|${state.upgrades}` !== before) changed = true
    }
    // 转会窗口里 AI 之间按需互相挖人（同级或更低级别），每轮全服最多 3 笔。
    if (worldWindowOpen()) {
      aiPoachRound({
        clubs: sharedMarketClubs(), season: serverSeason(), round, seed: sharedWorld.seed, maxMoves: 3,
        onMove: (move) => {
          const seller = sharedWorld.world.clubs.find((club) => club.id === move.sellerId)
          if (seller) seller.starPlayerIds = seller.starPlayerIds.filter((id) => id !== move.playerId)
          market.log = [{ playerId: move.playerId, playerName: move.playerName, club: sharedWorld.teams?.[move.buyerId]?.name ?? move.buyerId, amount: move.amount, at: now() }, ...market.log].slice(0, 30)
          changed = true
        },
      })
      if (syncAllClubLiveTactics(sharedWorld.world, sharedWorld.teams)) changed = true
    }
    if (changed || rounds > 0) persistWorld()
  }

  let aiAuctionCursor = 0

  /**
   * 电脑球队在自由球员市场里跟玩家抢人：按“本队同位置是否明显更好/性价比/人手”决定，
   * 出价封顶是估值乘级别系数，还留着自己的底钱，不会为了抬价乱加。
   */
  let aiOpenCursor = 0

  /**
   * 电脑球队按需开拍：缺位置、同位置明显更强或人手不够时，对今天在市场上的自由球员出第一口价。
   * 每个 tick 最多一家、一个人；AI 开的竞拍同时最多 3 个，其他 AI 和玩家照常跟价。
   */
  function aiOpenAuctions(): boolean {
    if (!worldWindowOpen() || !sharedWorld.aiClubs) return false
    if (market.auctions.filter((auction) => auction.bids[0]?.accountId.startsWith('ai:')).length >= 3) return false
    const clubs = sharedMarketClubs()
    if (!clubs.length) return false
    const club = clubs[aiOpenCursor++ % clubs.length]
    const buysLeft = aiBuysLeft(club.state, serverSeason(), aiLeadingAuctions(club.id))
    if (buysLeft <= 0 || club.team.players.length >= AI_SQUAD_LIMIT) return false
    const nowMs = now()
    const keptIds = collectScoutKeptIds(nowMs)
    const committed = market.auctions.reduce((sum, item) => (item.bids.length && leadingBid(item).accountId === `ai:${club.id}` ? sum + leadingBid(item).amount : sum), 0)
    const open = market.pool
      .filter((player) => !market.auctions.some((auction) => auction.playerId === player.id) && sharedAvailable(player, nowMs, keptIds))
      .sort((a, b) => playerValue(b) - playerValue(a))
      .slice(0, 30)
    for (const player of open) {
      const minimum = minimumBid(player)
      const plan = aiBidFor({ state: club.state, tier: club.tier, player, squad: club.team.players, value: playerValue(player), minimum, committed, buysLeft })
      if (!plan || club.state.economy.balance - committed < minimum) continue
      if (placeAIBid(market, { id: club.id, name: club.team.name }, player.id, minimum, nowMs).ok) return true
    }
    return false
  }

  function aiAuctionTick(): void {
    if (aiOpenAuctions()) {
      persistMarket()
      broadcastMarket()
    }
    if (!market.auctions.length || !sharedWorld.aiClubs) return
    const nowMs = now()
    const clubs = sharedWorld.world.clubs.filter((club) => !club.isPlayer && !sharedWorld.owners[club.id] && sharedWorld.aiClubs![club.id])
    if (!clubs.length) return
    let changed = false
    let aiFeesChanged = false
    // 每个 tick 只看一小批球队，但游标一直往前走，几次下来全联盟都会轮到。
    const window = 10
    const start = aiAuctionCursor++ % clubs.length
    const candidates = Array.from({ length: Math.min(window, clubs.length) }, (_, index) => clubs[(start + index) % clubs.length])
    for (const auction of [...market.auctions]) {
      if (auction.endsAt <= nowMs || auction.bids.length === 0) continue
      const player = market.pool.find((item) => item.id === auction.playerId)
      if (!player) continue
      const lead = leadingBid(auction)
      for (const club of candidates) {
        const state = sharedWorld.aiClubs[club.id]
        const squad = sharedWorld.teams?.[club.id]?.players
        if (!state || !squad || squad.length >= AI_SQUAD_LIMIT) continue
        if (squad.some((item) => item.id === player.id)) continue
        const accountId = `ai:${club.id}`
        if (lead.accountId === accountId) continue
        const committed = market.auctions.reduce((sum, item) => {
          if (!item.bids.length) return sum
          const top = leadingBid(item)
          return top.accountId === accountId ? sum + top.amount : sum
        }, 0)
        const plan = aiBidFor({
          state,
          tier: club.tier ?? 'division2',
          player,
          squad,
          value: playerValue(player),
          minimum: minimumBid(player, auction),
          rival: lead.amount,
          committed,
          // 每赛季最多买 5 人：已经买的 + 正领先的竞拍都算。
          buysLeft: aiBuysLeft(state, serverSeason(), aiLeadingAuctions(club.id)),
        })
        if (!plan) continue
        // 电脑球队跟价也要交手续费：交完还得付得起这口价才跟。
        if (state.economy.balance - committed < plan + auctionRaiseFee(plan)) continue
        const bid = placeAIBid(market, { id: club.id, name: sharedWorld.teams![club.id].name }, player.id, plan, nowMs)
        if (bid.ok) {
          state.economy.balance -= bid.fee
          aiFeesChanged = true
          changed = true
          break
        }
      }
    }
    if (aiFeesChanged) persistWorld({ world: false, teams: false, matchBook: false })
    if (changed) {
      persistMarket()
      broadcastMarket()
    }
  }

  function ownedClubId(account: Account): string | undefined {
    return Object.keys(sharedWorld.owners).find((id) => sharedWorld.owners[id] === account.id)
  }

  /** 锁定的是整份比赛输入，不只首发 ID；之后训练、换卡或转会也不能改变已入队的本场。 */
  function lockedTeamFor(clubId: string): LockedTeam | null {
    const legendTeam = legendCupTeamById(clubId)
    if (legendTeam) {
      const injuries: Record<string, number> = {}
      for (const player of legendTeam.players) {
        const until = sharedWorld.matchBook?.injuries[player.id]
        if (until) injuries[player.id] = until
      }
      return {
        team: legendTeam,
        injuries,
        suspended: [],
        medical: 25,
        tacticsStage: 25,
        stadiumStage: 25,
        ai: true,
      }
    }
    const team = sharedWorld.teams?.[clubId]
    if (!team) return null
    const account = db.accounts.find((item) => item.id === sharedWorld.owners[clubId])
    const valid = account?.game.world?.clubs.find((club) => club.id === 'player')?.squadKey === clubId
    const game = valid ? account.game : undefined
    const aiTakeover = !!(account && valid && isAccountAITakeover(account))
    const injuries = { ...sharedWorld.matchBook!.injuries }
    for (const [id, until] of Object.entries(game?.injuries ?? {})) injuries[id] = Math.max(injuries[id] ?? 0, until)
    const bans = { ...sharedWorld.matchBook!.suspensions }
    for (const [id, ban] of Object.entries(game?.suspensions ?? {})) if (sharedWorld.matchBook!.conditionAt[id] === undefined) bans[id] = ban
    const conditions = new Map(team.players.map((player) => [player.id, player]))
    const withCondition = (player: Player): Player => {
      const shared = conditions.get(player.id)
      return shared ? { ...player, condition: shared.condition, recoveryAt: shared.recoveryAt } : { ...player }
    }
    const lockedLineup = game
      ? aiTakeover && game.lineup.matchPlan && matchPlanConditionFactor(game.lineup.matchPlan) > 1.05
        ? { ...game.lineup, matchPlan: 'standard' as const }
        : game.lineup
      : team.lineup
    return {
      team: game ? { ...team, name: game.clubName, players: game.roster.map(withCondition), lineup: lockedLineup, formationId: lockedLineup.formationId, tactics: lockedLineup.tactics } : team,
      autoSubs: game
        ? aiTakeover
          ? {
              timed: [],
              staminaBelow: game.autoSubs?.staminaBelow ?? DEFAULT_STAMINA_BELOW,
              preMatchStaminaBelow: game.autoSubs?.preMatchStaminaBelow ?? DEFAULT_PRE_MATCH_STAMINA_BELOW,
              onInjury: true,
            }
          : game.autoSubs ?? emptyAutoSubs()
        : undefined,
      injuries,
      suspended: Object.entries(bans).filter(([, ban]) => ban.matches > 0).map(([id]) => id),
      medical: game ? economyOf(game).medical : sharedWorld.aiClubs?.[clubId]?.economy.medical ?? 1,
      tacticsStage: game ? economyOf(game).tactics : sharedWorld.aiClubs?.[clubId]?.economy.tactics,
      stadiumStage: game ? economyOf(game).stadium : sharedWorld.aiClubs?.[clubId]?.economy.stadium ?? 1,
      // 锁定时还欠薪：这场只发挥一半。
      ...(game && matchPerformanceOf(game) < 1 ? { performance: matchPerformanceOf(game) } : {}),
      // 没有教练的电脑球队：开球时体能低于 80 的先休息；超过 3 天未上线的玩家球队则进入 aiTakeover 自动轮换。
      ...(game && account ? { coachId: account.id } : {}),
      ...(game ? (aiTakeover ? { aiTakeover: true } : {}) : { ai: true }),
    }
  }

  /** 在服务器权威世界中计算锁阵，不依赖客户端缓存的赛程。 */
  function officialLineupLocked(account: Account, at: number): boolean {
    if (lineupLockState(account.game, at).locked) return true
    const clubId = ownedClubId(account)
    if (!clubId) return false
    const fixtures = sharedWorld.world.seasonCups?.cups.flatMap(cup => cup.rounds.flatMap(round => round.fixtures)) ?? []
    return fixtures.some(fixture => !fixture.played && fixture.kickoffAt > at && fixture.kickoffAt - at <= 30 * 60_000 && (fixture.homeId === clubId || fixture.awayId === clubId))
  }

  function inheritedMatchIds(game: GameState, clubId: string): string[] {
    return game.season.fixtures.filter((fixture) => fixture.isPlayer && fixture.played).map((fixture) => fixture.matchId ?? matchJobId(game.season.index, game.season.divisionId!, {
      round: fixture.round, homeId: fixture.homeId === 'player' ? clubId : fixture.homeId, awayId: fixture.awayId === 'player' ? clubId : fixture.awayId,
    }))
  }

  /** 只合并已公开比赛的增量；不替换培养、球员卡、资金或设施的整份锁定快照。 */
  function syncPublishedMatches(account: Account): { changed: boolean; rewardChanged: boolean } {
    const clubId = ownedClubId(account)
    if (!clubId) return { changed: false, rewardChanged: false }
    const game = account.game
    const sync = syncOf(account)
    const applied = new Set(account.appliedMatchIds ?? [])
    let changed = false
    let rewardChanged = false
    const needsCupBackfill = game.pve?.seasonCupGoldVersion !== 1
    let cupBackfillReady = true
    let coachedMatch = false
    const t = now()
    for (const fixture of game.season.fixtures) {
      if (!fixture.isPlayer || !fixture.played) continue
      const id = fixture.matchId
      if (!id?.startsWith('q-') || applied.has(id) || !matchQueue.ready(id)) continue
      // 按轮次排序只在确实存在未应用已赛场次时再走完整排序路径。
      const dueFixtures = game.season.fixtures
        .filter((item) => item.isPlayer && item.played && item.matchId?.startsWith('q-') && !applied.has(item.matchId) && matchQueue.ready(item.matchId))
        .sort((a, b) => a.round - b.round)
      for (const due of dueFixtures) {
        const matchId = due.matchId!
        const { input, result } = matchQueue.read(matchId)
        // 开球后还要“直播” 10 分钟，比赛公布（比分、战报、收入）之前不能提前结算。
        if (input.kickoffAt + LEAGUE_REALTIME_MS > t) continue
        const coached = input.kickoffAt > account.createdAt
        coachedMatch ||= coached
        if (coached && !game.matchHistory.some((record) => record.id === matchId)) game.matchHistory.unshift(recordForClub(input, result, clubId))
        if (coached) {
          recordYouthMatch(game, recordForClub(input, result, clubId))
          // 真人执教球队独立判定：双方场上球员都可能掉书，已收集（同档或更高档）的不再掉。
          const drops = awardLeagueBookDrops(game, {
            players: [...input.home.team.players, ...input.away.team.players],
            stats: result.record.playerStats,
            seed: input.seed,
            label: `${matchId}|${clubId}`,
          })
          const record = game.matchHistory.find((item) => item.id === matchId)
          if (record) record.bookDrops = drops
        }
        const economy = economyOf(game)
        if (coached && due.round > economy.lastIncomeRound) {
          awardRoundIncome(game, due.round)
          // 先补欠薪再发本轮工资，钱不够的记成欠薪（欠薪期间球员只发挥一半，见 world.ts）。
          if (game.season.index > 1) payWageBill(economy, worldWageBill(game))
          settleMarket(game, due.round)
        }
        applied.add(matchId)
        changed = true
      }
      break
    }
    // 正式杯赛在全服世界中公布；双方教练从同一个任务结果同步，不产生联赛收入。
    for (const cup of sharedWorld.world.seasonCups?.cups ?? []) for (const round of cup.rounds) for (const fixture of round.fixtures) {
      if (!fixture.played || !fixture.matchId || (fixture.homeId !== clubId && fixture.awayId !== clubId)) continue
      if (applied.has(fixture.matchId) && !needsCupBackfill) continue
      if (!matchQueue.ready(fixture.matchId)) { cupBackfillReady = false; continue }
      const { input, result } = matchQueue.read(fixture.matchId)
      const locked = input.home.team.id === clubId ? input.home : input.away
      if (locked.coachId === account.id) {
        const record = recordForClub(input, result, clubId)
        recordYouthMatch(game, record)
        if (!game.challengeHistory.some(item => item.id === fixture.matchId)) { game.challengeHistory.unshift(record); changed = true }
        if (paysSeasonCupAppearanceGold(fixture) && awardSeasonCupMatch(game, cup.id, fixture.matchId)) { changed = true; rewardChanged = true }
        if (cup.championId === clubId && round.round === cup.rounds.at(-1)?.round && round.fixtures.length === 1 && fixture.winnerId === clubId) {
          ensurePve(game)
          let trophy = game.pve!.trophies.find(item => item.cupId === `season-${cup.id}` && item.seasonIndex === input.season)
          if (!trophy) {
            const ownHome = input.home.team.id === clubId
            trophy = {
              cupId: `season-${cup.id}`, cupName: cup.name, seasonIndex: input.season, wonAt: input.kickoffAt,
              finalOpponent: ownHome ? input.away.team.name : input.home.team.name,
              finalScore: ownHome ? { ...record.score } : { home: record.score.away, away: record.score.home },
              ...(record.shootout ? { finalShootout: ownHome ? { ...record.shootout } : { home: record.shootout.away, away: record.shootout.home } } : {}),
              matchId: fixture.matchId,
            }
            game.pve!.trophies.push(trophy)
            changed = true
          }
          const reward = awardSeasonCupChampion(game, cup.id, input.season, trophy)
          if (reward.gold || reward.ceiling || reward.book) { changed = true; rewardChanged = true }
        }
      }
      if (!applied.has(fixture.matchId)) { applied.add(fixture.matchId); changed = true }
    }
    if (needsCupBackfill && cupBackfillReady && game.pve) { game.pve.seasonCupGoldVersion = 1; changed = true }
    if (changed) {
      account.appliedMatchIds = [...applied]
      const live = new Map((sharedWorld.teams?.[clubId]?.players ?? []).map((player) => [player.id, player]))
      for (const player of game.roster) {
        const shared = live.get(player.id)
        if (!shared) continue
        player.condition = shared.condition
        player.recoveryAt = shared.recoveryAt
      }
      if (coachedMatch && game.season.finished) {
        awardSeasonPrize(game)
        if (awardSeasonShopPoints(game) > 0) rewardChanged = true
      }
    }
    const book = sharedWorld.matchBook!
    let bookChanged = false
    const nextChemistry = chemistryForPlayers(book.chemistry, new Set(game.roster.map(p => p.id)), t, game.season.gameDayMs)
    if (!deepEqual(game.chemistry, nextChemistry)) {
      game.chemistry = nextChemistry
      bookChanged = true
    }
    if (changed || sync.matchBookVer !== sharedMatchBookVersion) {
      for (const [id, until] of Object.entries(book.injuries)) {
        const prev = game.injuries?.[id] ?? 0
        const next = Math.max(prev, until)
        if (next !== prev || !(id in (game.injuries ?? {}))) {
          (game.injuries ??= {})[id] = next
          bookChanged = true
        }
      }
      const ids = new Set<string>()
      for (const player of game.roster) ids.add(player.id)
      for (const team of game.aiTeams) for (const player of team.players) ids.add(player.id)
      for (const id of ids) {
        if (book.suspensions[id]) {
          if (!deepEqual(game.suspensions?.[id], book.suspensions[id])) {
            (game.suspensions ??= {})[id] = structuredClone(book.suspensions[id])
            bookChanged = true
          }
        } else if (book.conditionAt[id] !== undefined && game.suspensions && id in game.suspensions) {
          delete game.suspensions[id]
          bookChanged = true
        }
        if (book.yellowCounts[id] !== undefined && game.yellowCounts?.[id] !== book.yellowCounts[id]) {
          (game.yellowCounts ??= {})[id] = book.yellowCounts[id]
          bookChanged = true
        }
        if (book.appearances[id] && !deepEqual(game.appearances?.[id], book.appearances[id])) {
          (game.appearances ??= {})[id] = [...book.appearances[id]]
          bookChanged = true
        }
      }
      sync.matchBookVer = sharedMatchBookVersion
    }
    return { changed: changed || bookChanged, rewardChanged }
  }

  /** 其他分区的赛程与积分同样以全服快照为准，不保留各账号各自抽象模拟的比分。 */
  function pullSharedWorld(account: Account): boolean {
    const clubId = ownedClubId(account)
    if (!clubId || !account.game.world || account.game.season.index !== sharedWorld.world.seasonIndex) return false
    if (account.game.world.clubs.find((club) => club.id === 'player')?.squadKey !== clubId) return false
    const sync = syncOf(account)
    if (sync.worldVer === sharedWorldVersion && sync.marketVer === market.version && sync.worldSeason === sharedWorld.world.seasonIndex) {
      return false
    }
    const canonical = worldForClub(sharedWorld.world, clubId)
    for (const player of market.pool) delete canonical.starAges[player.id]
    sync.worldVer = sharedWorldVersion
    sync.marketVer = market.version
    sync.worldSeason = sharedWorld.world.seasonIndex
    if (deepEqual(account.game.world, canonical)) return false
    account.game.world = canonical
    return true
  }

  /** 账号只拥有自己的阵容；其他球队每次都从全服名册读取，禁止旧存档覆盖共享球队。 */
  function pullSharedFixtures(account: Account): boolean {
    const season = account.game.season
    const clubId = ownedClubId(account)
    const division = sharedWorld.world.divisions.find((item) => item.divisionId === season.divisionId && item.index === season.index)
    if (!clubId || !division) return false
    const sync = syncOf(account)
    const hasLegacyLeague = !!account.game.activeMatch?.context.isLeague
    if (!hasLegacyLeague && sync.fixturesVer === sharedWorldVersion && sync.worldSeason === sharedWorld.world.seasonIndex) {
      return false
    }
    const canonicalMap = new Map<string, (typeof division.fixtures)[number]>()
    for (const item of division.fixtures) canonicalMap.set(`${item.round}|${item.homeId}|${item.awayId}`, item)
    let changed = false
    for (const fixture of season.fixtures) {
      const mine = fixture.homeId === 'player' || fixture.awayId === 'player'
      const homeId = fixture.homeId === 'player' ? clubId : fixture.homeId
      const awayId = fixture.awayId === 'player' ? clubId : fixture.awayId
      const canonical = canonicalMap.get(`${fixture.round}|${homeId}|${awayId}`)
      // 所有已赛结果都以全服为准，包括接管前的 AI 战绩和本账号自己的旧比分。
      // 仅保留旧版正在进行中的这一场，不让异步刷新中断比赛。
      if (mine && account.game.activeMatch?.context.isLeague && account.game.activeMatch.context.round === fixture.round) continue
      if (!canonical) continue
      if (!canonical.played || !canonical.score) {
        if (fixture.kickoffAt !== canonical.kickoffAt || fixture.gameDay !== canonical.gameDay) {
          fixture.kickoffAt = canonical.kickoffAt
          fixture.gameDay = canonical.gameDay
          changed = true
        }
        continue
      }
      const next = { ...fixture, ...canonical, homeId: fixture.homeId, awayId: fixture.awayId, isPlayer: mine,
        scorers: canonical.scorers?.map((item) => ({ ...item, teamId: item.teamId === clubId ? 'player' : item.teamId })),
        assisters: canonical.assisters?.map((item) => ({ ...item, teamId: item.teamId === clubId ? 'player' : item.teamId })),
      }
      if (deepEqual(next, fixture)) continue
      Object.assign(fixture, next)
      changed = true
    }
    if (!hasLegacyLeague && season.round !== division.round) { season.round = division.round; changed = true }
    if (season.gameDayMs !== division.gameDayMs) { season.gameDayMs = division.gameDayMs; changed = true }
    if (season.kickoffSchedule !== division.kickoffSchedule) { season.kickoffSchedule = division.kickoffSchedule; changed = true }
    if (changed) {
      const names = new Map(account.game.world?.clubs.map((club) => [club.id, club.name]) ?? [])
      season.table = computeWorldTable(season.clubIds ?? [], season.fixtures, names)
      season.finished = season.fixtures.every((fixture) => fixture.played)
      season.champion = season.finished ? season.table[0]?.teamId ?? null : null
      season.playerFinish = season.finished ? season.table.findIndex((row) => row.teamId === 'player') + 1 : null
      const local = account.game.world?.divisions.find((item) => item.divisionId === season.divisionId)
      if (local) { local.fixtures = season.fixtures; local.table = season.table }
    }
    if (!hasLegacyLeague) {
      sync.fixturesVer = sharedWorldVersion
      sync.worldSeason = sharedWorld.world.seasonIndex
    }
    return changed
  }

  const AI_TEAM_COMPARE_IGNORE = new Set(['condition', 'energy', 'recoveryAt', 'energyAt'])
  function pullSharedTeams(account: Account): boolean {
    const sync = syncOf(account)
    if (sync.teamsVer === sharedTeamsPublicVersion && sync.worldSeason === sharedWorld.world.seasonIndex) {
      return false
    }
    const ids = account.game.season.clubIds ?? []
    const teams = ids.filter((id) => id !== 'player').map((id) => sharedWorld.teams?.[id]).filter((team): team is AITeam => !!team)
    if (teams.length !== ids.length - 1) return false
    let changed = false
    const localClubs = new Map(account.game.world?.clubs.map((club) => [club.id, club]) ?? [])
    const sharedClubs = new Map(sharedWorld.world.clubs.map((club) => [club.id, club]))
    for (const team of teams) {
      const local = localClubs.get(team.id)
      const shared = sharedClubs.get(team.id)
      if (local && shared && !deepEqual(local.starPlayerIds, shared.starPlayerIds)) {
        local.starPlayerIds = [...shared.starPlayerIds]
        changed = true
      }
      if (local && shared && local.name !== shared.name) { local.name = shared.name; changed = true }
    }
    const current = account.game.aiTeams
    let teamsChanged = current.length !== teams.length
    if (!teamsChanged) {
      for (let i = 0; i < teams.length; i++) {
        if (!deepEqual(current[i], teams[i], AI_TEAM_COMPARE_IGNORE)) {
          teamsChanged = true
          break
        }
      }
    }
    if (teamsChanged) {
      account.game.aiTeams = teams.map((team, index) => (
        current[index] && deepEqual(current[index], team, AI_TEAM_COMPARE_IGNORE)
          ? current[index]
          : structuredClone(team)
      ))
      changed = true
    }
    sync.teamsVer = sharedTeamsPublicVersion
    sync.worldSeason = sharedWorld.world.seasonIndex
    return changed
  }

  /** 已接管球队的变动写回唯一名册；同一场比赛的结果只由第一个完成的教练写入。 */
  function publishClub(account: Account): void {
    const clubId = ownedClubId(account)
    if (!clubId || !sharedWorld.teams?.[clubId] || account.game.world?.clubs.find((item) => item.id === 'player')?.squadKey !== clubId) return
    const team = sharedWorld.teams[clubId]
    let anyChanged = false
    let worldChanged = false
    let teamsPublicChanged = false
    let matchBookChanged = false
    const book = sharedWorld.matchBook!
    const beforeChemistry = fingerprintValue(book.chemistry)
    const ownPlayers = new Set(account.game.roster.map(p => p.id))
    mergeChemistryTraining(book, account.game.chemistry, ownPlayers, now(), account.game.season.gameDayMs)
    account.game.chemistry = chemistryForPlayers(book.chemistry, ownPlayers, now(), account.game.season.gameDayMs)
    if (beforeChemistry !== fingerprintValue(book.chemistry)) {
      anyChanged = true
      matchBookChanged = true
    }
    const rosterDiff = compareTeamPlayers(team.players, account.game.roster)
    const lineupChanged = !deepEqual(team.lineup, account.game.lineup)
    const nameChanged = team.name !== account.game.clubName
    if (rosterDiff.anyChanged || lineupChanged || nameChanged) {
      sharedWorld.teams[clubId] = { ...team, name: account.game.clubName, players: structuredClone(account.game.roster), lineup: structuredClone(account.game.lineup) }
      anyChanged = true
      if (rosterDiff.publicChanged || lineupChanged || nameChanged) teamsPublicChanged = true
    }
    const sharedClub = sharedWorld.world.clubs.find((item) => item.id === clubId)
    let clubNameChanged = false
    if (sharedClub) {
      if (sharedClub.name !== account.game.clubName) { sharedClub.name = account.game.clubName; anyChanged = true; worldChanged = true; clubNameChanged = true }
      const stars = account.game.roster.filter((player) => player.starKey)
      const starIds = stars.map((player) => player.id)
      if (!deepEqual(sharedClub.starPlayerIds, starIds)) {
        sharedClub.starPlayerIds = starIds
        anyChanged = true
        worldChanged = true
      }
      for (const player of stars) if (sharedWorld.world.starAges[player.id] !== (player.age ?? 24)) {
        sharedWorld.world.starAges[player.id] = player.age ?? 24
        anyChanged = true
        worldChanged = true
      }
      if (syncClubLiveTactics(sharedClub, sharedWorld.teams[clubId])) {
        anyChanged = true
        worldChanged = true
      }
    }
    const division = sharedWorld.world.divisions.find((item) => item.divisionId === account.game.season.divisionId && item.index === account.game.season.index)
    if (division) {
      let fixturesChanged = false
      for (const fixture of account.game.season.fixtures) {
        // 只有升级前已经在进行中的旧版联赛仍可回写；队列比赛的赛果只由统一发布事务写入。
        if (!fixture.played || !fixture.score || !fixture.matchId || fixture.matchId.startsWith('q-') || (fixture.homeId !== 'player' && fixture.awayId !== 'player')) continue
        const homeId = fixture.homeId === 'player' ? clubId : fixture.homeId
        const awayId = fixture.awayId === 'player' ? clubId : fixture.awayId
        const canonical = division.fixtures.find((item) => item.round === fixture.round && item.homeId === homeId && item.awayId === awayId)
        // 已结算的比赛不可重算或改写，接管球队不能把历史 AI 比分变成新教练的比赛。
        if (!canonical || canonical.played || canonical.reportedBy) continue
        canonical.score = { ...fixture.score }
        canonical.played = true
        canonical.autoSimulated = fixture.autoSimulated
        canonical.reportedBy = account.id
        fixturesChanged = true
      }
      if (fixturesChanged || clubNameChanged) {
        const names = new Map(sharedWorld.world.clubs.map((club) => [club.id, club.name]))
        division.table = computeWorldTable(division.clubIds ?? [], division.fixtures, names)
        division.finished = division.fixtures.every((fixture) => fixture.played)
        division.champion = division.finished ? division.table[0]?.teamId ?? null : null
        anyChanged = true
        worldChanged = true
      }
    }
    if (anyChanged) {
      const conditionOnly = !worldChanged && !teamsPublicChanged && !matchBookChanged
      persistWorld({ world: worldChanged, teams: teamsPublicChanged, matchBook: matchBookChanged, lowPriority: conditionOnly })
    }
  }

  function publicFacilities(economy: AIClubState['economy'] | undefined) {
    if (!economy) return undefined
    return { stadium: economy.stadium, academy: economy.academy, medical: economy.medical, shop: economy.shop, sponsor: economy.sponsor, psychology: economy.psychology, tactics: economy.tactics }
  }
  function publicPlayer(player: Player) {
    const { id, name, enName, country, era, age, foot, height, positions, detailedPositions, attrs, baseAttrs, traitId, skills, skillTiers } = player
    const visible = Object.fromEntries(mainAttrsFor(positions.GK > 0).map((key) => [key, attrs[key]]))
    // ca 是现在装备的那张卡；baseCa 是没练过的原始属性，两者之差就是卡带来的提升。
    const baseCa = baseAttrs ? displayCA(caOf(baseAttrs, positions.GK > 0)) : undefined
    return { id, name, enName, country, era, age, foot, height, positions, detailedPositions, attrs: visible, traitId, skills, skillTiers, ca: displayCA(caOf(attrs, positions.GK > 0)), baseCa, youthOrigin: player.youthOrigin }
  }
  // 清理旧版新账号准备期并补齐真实在线时间戳。
  for (const account of db.accounts) {
    let removedPreparation = false
    if (account.lastUserRevision === undefined) {
      account.lastUserRevision = account.revision
      removedPreparation = true
    }
    if (account.lastOnlineAt === undefined) {
      account.lastOnlineAt = account.updatedAt || account.createdAt || now()
      removedPreparation = true
    }
    const clubId = ownedClubId(account)
    if (clubId && !account.appliedMatchIds) {
      account.appliedMatchIds = inheritedMatchIds(account.game, clubId)
      removedPreparation = true
    }
    if (account.game?.settings && 'autoSettle' in account.game.settings) {
      delete (account.game.settings as { autoSettle?: unknown }).autoSettle
      removedPreparation = true
    }
    if (removedPreparation) persistAccount(account)
  }

  function enqueueClientTask(client: EventClient, task: () => Promise<void> | void): void {
    client.queue = client.queue
      .then(() => {
        if (client.closed || client.sink.isClosed()) return
        return task()
      })
      .catch(() => {})
  }

  function sendClientRaw(client: EventClient, text: string): void {
    enqueueClientTask(client, () => {
      if (!client.closed && !client.sink.isClosed()) client.sink.writeRaw(text)
    })
  }

  /** 全服广播用的竞拍信息：不含账号 ID 以外的隐私，也不带完整球员池，池子变了客户端按 version 重新拉。 */
  const marketPayload = () => ({ type: 'market', auctions: market.auctions, log: market.log, version: market.version, serverTime: now() })
  function broadcastMarket(): void {
    if (clients.size === 0) return
    const message = `data: ${JSON.stringify(marketPayload())}\n\n`
    for (const group of clients.values()) for (const client of group) sendClientRaw(client, message)
  }

  const onSomeRoster = (playerId: string, except?: Account) =>
    db.accounts.some((account) => account !== except && account.game?.roster?.some((player) => player.id === playerId))

  /** 账号里放出来的自由球员进全服市场。别人已经签走的人不会回来。 */
  function absorbInto(account: Account): boolean {
    if (!account.game?.freeStars?.length) return false
    const before = market.version
    const onAuction = (id: string) => market.auctions.some((auction) => auction.playerId === id)
    const changed = absorbFreeAgents(market, account.game, (id) => onAuction(id) || onSomeRoster(id))
    if (market.version !== before) {
      persistMarket()
      broadcastMarket()
    }
    return changed
  }

  /** 电脑球队赢下竞拍：扣钱、把人记进账本，同时直接进当季名单。 */
  const aiBidder: AIBidder = {
    balance: (clubId) => sharedWorld.aiClubs?.[clubId]?.economy.balance ?? 0,
    canSign: (clubId) => (sharedWorld.teams?.[clubId]?.players.length ?? AI_SQUAD_LIMIT) < AI_SQUAD_LIMIT,
    sign: (clubId, player, amount) => {
      const state = sharedWorld.aiClubs?.[clubId]
      const team = sharedWorld.teams?.[clubId]
      if (!state || !team) return
      recordAISigning(state, player, amount)
      noteAIBuy(state, serverSeason())
      team.players = [...team.players, player]
      // 拍下的球员要能进首发：只修“不合法”的阵容会让他一直坐在名单外。
      refreshAILineup(team)
      const club = sharedWorld.world.clubs.find((item) => item.id === clubId)
      if (club) syncClubLiveTactics(club, team)
    },
  }

  /**
   * 全服自由市场每个游戏日补到 200 人：先算当天挂牌的球星和留在市场上的球员，不足的用当天生成的随机球员补；
   * 前几天没人要的随机球员销毁（正在竞拍的等竞拍结束）。每个游戏日只做一次。
   */
  function collectScoutKeptIds(t: number): Set<string> {
    const kept = new Set<string>()
    for (const account of db.accounts) {
      const reports = account.game?.scoutReports
      if (!reports?.length) continue
      for (const report of reports) {
        if (report.source === 'market' && scoutKeepsOnMarket(account.game, report.playerId, t)) kept.add(report.playerId)
      }
    }
    return kept
  }

  function sharedScoutKeeps(playerId: string, t: number): boolean {
    return db.accounts.some(account => account.game && scoutKeepsOnMarket(account.game, playerId, t))
  }

  function sharedAvailable(player: Player, t: number, keptIds?: ReadonlySet<string>): boolean {
    const anchor = { world: sharedWorld.world, createdAt: sharedWorld.startedAt }
    const kept = keptIds ? keptIds.has(player.id) : sharedScoutKeeps(player.id, t)
    return (player.marketDay === undefined || player.marketDay >= marketDayOf(anchor, t) || kept) &&
      (kept || isOnMarketToday(anchor, player, t))
  }

  function refreshSharedFreeMarket(): void {
    const anchor = { world: sharedWorld.world, createdAt: sharedWorld.startedAt }
    const t = now()
    const day = marketDayOf(anchor, t)
    const keptIds = collectScoutKeptIds(t)
    const auctionIds = new Set(market.auctions.map((auction) => auction.playerId))
    const busy = (id: string) => auctionIds.has(id) || keptIds.has(id)
    if (sharedWorld.freeMarketDay === day) {
      const pool = market.pool.filter(player => player.marketDay === undefined || player.marketDay >= day || busy(player.id))
      if (pool.length !== market.pool.length) {
        market.pool = pool
        market.version++
        persistMarket()
        broadcastMarket()
      }
      return
    }
    sharedWorld.freeMarketDay = day
    const result = refreshFreeMarket({ pool: market.pool, anchor, now: t, seed: sharedWorld.seed, busy })
    if (result.changed) {
      market.pool = result.pool
      market.version += 1
      persistMarket()
      broadcastMarket()
    } else persistWorld({ world: false, teams: false, matchBook: false })
  }

  let visibleMarketIds: string | undefined
  function syncMarketVisibility(): void {
    const t = now()
    const keptIds = collectScoutKeptIds(t)
    const auctionIds = new Set(market.auctions.map((auction) => auction.playerId))
    const ids = market.pool.filter(p => auctionIds.has(p.id) || sharedAvailable(p, t, keptIds)).map(p => p.id).sort().join('\n')
    if (visibleMarketIds !== undefined && visibleMarketIds !== ids) {
      market.version++
      persistMarket()
      broadcastMarket()
    }
    visibleMarketIds = ids
  }

  function settleDueAuctions(): void {
    refreshSharedFreeMarket()
    syncMarketVisibility()
    if (!market.auctions.some((auction) => auction.endsAt <= now())) return
    const results = settleAuctions(market, (id) => db.accounts.find((account) => account.id === id)?.game, now(), aiBidder)
    if (!results.length) return
    let aiWon = false
    for (const { winnerId } of results) {
      if (winnerId && aiClubIdOf(winnerId)) { aiWon = true; continue }
      const winner = winnerId ? db.accounts.find((account) => account.id === winnerId) : undefined
      if (!winner) continue
      publishClub(winner)
      winner.revision++
      winner.lastUserRevision = winner.revision
      winner.updatedAt = now()
      persistAccount(winner)
      broadcast(winner)
    }
    if (aiWon) sharedTeamsPublicVersion++
    persistMarket()
    broadcastMarket()
  }

  /** 老化由各账号自己算，市场里的球员不归任何账号的世界管，否则会被算退役、生出下一代。 */
  function forgetMarketAges(account: Account): boolean {
    const ages = account.game?.world?.starAges
    let changed = false
    if (ages) for (const player of market.pool) if (player.id in ages) {
      delete ages[player.id]
      changed = true
    }
    return changed
  }

  /* 老账号各有一份自由球员：并进全服市场；已经被人签走的从池子里拿掉。 */
  {
    const before = market.pool.length
    market.pool = market.pool.filter((player) => !onSomeRoster(player.id))
    let changed = market.pool.length !== before
    if (changed) market.version += 1
    for (const account of db.accounts) {
      if (account.game?.freeStars?.length && absorbFreeAgents(market, account.game, (id) => onSomeRoster(id))) {
        changed = true
        persistAccount(account)
      }
      if (forgetMarketAges(account)) persistAccount(account)
    }
    if (changed) {
      persistMarket()
    }
  }

  function bidFor(account: Account, playerId: unknown, amount: unknown): BidResult {
    if (typeof playerId !== 'string' || !playerId) return { ok: false, error: '无效的球员 ID' }
    if (account.game.activeMatch && !account.game.activeMatch.context.isLeague) return { ok: false, error: '比赛进行中不能出价' }
    settleDueAuctions()
    const player = market.pool.find((item) => item.id === playerId)
    const alreadyBidding = market.auctions.some((item) => item.playerId === playerId)
    if (player && !alreadyBidding && !sharedAvailable(player, now())) {
      return { ok: false, error: `${player.name} 现在不在市场，过些天再来看看` }
    }
    const result = placeBid(market, account.game, account.id, playerId, Number(amount), now())
    if (result.ok) {
      // 跟价手续费已经从余额里扣掉了：账号存档也要保存并推给各设备。
      if (result.fee > 0) {
        account.revision++
        account.lastUserRevision = account.revision
        account.updatedAt = now()
        persistAccount(account)
        broadcast(account)
      }
      persistMarket()
      broadcastMarket()
    }
    return result
  }

  const publicAccount = (account: Account) => ({ id: account.id, username: account.username })
  function publicWorldClub(club: WorldClub, includeRoster: boolean) {
    const owner = db.accounts.find((item) => item.id === sharedWorld.owners[club.id])
    const team = sharedWorld.teams?.[club.id]
    const validOwner = owner?.game.world?.clubs.find((item) => item.id === 'player')?.squadKey === club.id
    return {
      id: club.id, name: validOwner ? owner.game.clubName : club.name, color: club.color,
      tier: club.tier, conference: club.conference, managed: !!owner, aiTakeover: !!owner && isAccountAITakeover(owner),
      formationId: validOwner ? owner.game.lineup.formationId : team?.formationId ?? club.formationId,
      players: includeRoster ? (validOwner ? owner.game.roster : team?.players ?? []).map(publicPlayer) : [],
      ...(includeRoster ? {} : { rosterDeferred: true }),
      // RANK and public facilities do not reveal cards or finances of managed clubs.
      rating: validOwner ? Math.round(lineupRating(owner.game.roster, owner.game.lineup)) : team ? Math.round(lineupRating(team.players, team.lineup)) : undefined,
      facilities: owner ? undefined : publicFacilities(sharedWorld.aiClubs?.[club.id]?.economy),
    }
  }

  /** Summary requests return standings and club metadata without every player's attributes. */
  function worldSnapshot(account?: Account, includeRosters = true) {
    advanceAllMatches()
    return {
      seasonIndex: sharedWorld.world.seasonIndex,
      ownClubId: account ? ownedClubId(account) ?? null : null,
      clubs: sharedWorld.world.clubs.map(club => publicWorldClub(club, includeRosters)),
      divisions: sharedWorld.world.divisions.map((division) => ({ id: division.divisionId, tier: division.tier, conference: division.conference, round: division.round, table: division.table, fixtures: division.fixtures.map(({ reportedBy: _reporter, ...fixture }) => fixture) })),
      ...(sharedWorld.world.seasonCups ? { seasonCups: structuredClone(sharedWorld.world.seasonCups) } : {}),
    }
  }

  /** 友谊赛对手：联机时由服务器给出权威名单（含其他教练的球队），状态类信息不外发。 */
  function friendlyTeamFor(account: Account, clubId: string): { team: AITeam } | { error: string; status: number } {
    const club = sharedWorld.world.clubs.find((item) => item.id === clubId)
    if (!club) return { error: '找不到这支球队', status: 404 }
    if (clubId === ownedClubId(account)) return { error: '不能和自己踢友谊赛', status: 400 }
    const team = sharedWorld.teams?.[clubId] ?? buildOwnerlessTeams(sharedWorld.world, sharedWorld.seed, sharedWorld.aiClubs)[clubId]
    if (!team) return { error: '这支球队还没有名单', status: 404 }
    const clone = structuredClone(team)
    for (const player of clone.players) {
      delete (player as Partial<Player>).condition
      delete (player as Partial<Player>).energy
    }
    return { team: clone }
  }

  const chatSnapshotPayload = (): ChatSseMessage => ({
    type: 'chat',
    mode: 'snapshot',
    messages: chatMessages,
    serverTime: now(),
  })

  function broadcastChatSnapshot(): void {
    if (clients.size === 0) return
    const payload = `data: ${JSON.stringify(chatSnapshotPayload())}\n\n`
    for (const group of clients.values()) for (const client of group) sendClientRaw(client, payload)
  }

  function broadcastChatAppend(message: ChatMessage): void {
    if (clients.size === 0) return
    const event: ChatSseMessage = { type: 'chat', mode: 'append', message, serverTime: now() }
    const payload = `data: ${JSON.stringify(event)}\n\n`
    for (const group of clients.values()) for (const client of group) sendClientRaw(client, payload)
  }

  /** 发送全服聊天消息：校验字数与冷却，仅保留最新 50 条并实时推送。 */
  function postChat(account: Account, rawText: unknown): { ok: true; message: ChatMessage } | { ok: false; error: string; status: number } {
    const valid = validateChatText(rawText)
    if (!valid.ok) return { ok: false, error: valid.error, status: 400 }
    const t = now()
    const prev = chatLastSentAt.get(account.id)
    if (prev !== undefined && t - prev < CHAT_COOLDOWN_MS) {
      return { ok: false, error: '发言太快了，请稍等片刻', status: 429 }
    }
    chatLastSentAt.set(account.id, t)
    const clubId = ownedClubId(account) ?? ''
    const worldClub = clubId ? sharedWorld.world.clubs.find((item) => item.id === clubId) : undefined
    const playerClub = account.game?.world?.clubs.find((item) => item.id === 'player')
    const clubName = account.game?.clubName || worldClub?.name || account.username
    const clubColor = sanitizeChatColor(worldClub?.color ?? playerClub?.color)
    const message: ChatMessage = {
      id: `${t.toString(36)}-${(++chatSeq).toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      accountId: account.id,
      username: account.username,
      clubId,
      clubName,
      clubColor,
      text: valid.text,
      at: t,
    }
    chatMessages.push(message)
    if (chatMessages.length > CHAT_HISTORY_LIMIT) {
      chatMessages.splice(0, chatMessages.length - CHAT_HISTORY_LIMIT)
    }
    persistChat()
    broadcastChatAppend(message)
    return { ok: true, message }
  }

  /** 联机改俱乐部名字：最多 8 个字，不能和全服任何其他球队（AI 球队或别的教练的球队）重名。 */
  function renameClub(account: Account, rawName: unknown): { ok: true; name: string } | { ok: false; error: string; status: number } {
    const clubId = ownedClubId(account)
    if (!clubId || !account.game.world) return { ok: false, error: '只有联机执教球队时才能改名', status: 400 }
    if (account.game.activeMatch) return { ok: false, error: '比赛进行中不能改名', status: 400 }
    const name = normalizeClubName(rawName)
    if (name === account.game.clubName) return { ok: true, name }
    const taken = [
      ...sharedWorld.world.clubs.filter((club) => club.id !== clubId).map((club) => club.name),
      ...Object.entries(sharedWorld.teams ?? {}).filter(([id]) => id !== clubId).map(([, team]) => team.name),
      ...db.accounts.filter((item) => item.id !== account.id && item.game).map((item) => item.game.clubName),
    ]
    const error = clubNameError(name, taken)
    if (error) return { ok: false, error, status: 400 }
    account.game.clubName = name
    let chatRenamed = false
    for (const item of chatMessages) {
      if (item.accountId === account.id && item.clubName !== name) {
        item.clubName = name
        chatRenamed = true
      }
    }
    if (chatRenamed) {
      persistChat()
      broadcastChatSnapshot()
    }
    publishClub(account)
    pullSharedWorld(account)
    persistWorld()
    account.revision++
    account.lastUserRevision = account.revision
    account.updatedAt = now()
    persistAccount(account)
    broadcast(account)
    return { ok: true, name }
  }

  /** 新签进来的人里有没有来自其他教练执教的球队（AI 购买入口不能转走别的玩家的球员）。 */
  function signsFromOtherCoach(account: Account, previousRoster: ReadonlySet<string>, next: GameState): boolean {
    const own = ownedClubId(account)
    return Object.keys(sharedWorld.owners).some((id) => id !== own && sharedWorld.owners[id] &&
      sharedWorld.teams?.[id]?.players.some((player) => next.roster.some((item) => item.id === player.id) && !previousRoster.has(player.id)))
  }

  /** 只允许通过实际签下的球员改变共享 AI 名册；不接受客户端提交的整队副本。 */
  function commitAiSignings(previousRoster: ReadonlySet<string>, teams: readonly AITeam[], next: GameState): void {
    if (!next.world) return
    let changed = false
    for (const team of teams) {
      const canonical = sharedWorld.teams?.[team.id]
      if (!canonical) continue
      const signed = canonical.players.filter((player) => next.roster.some((item) => item.id === player.id) && !previousRoster.has(player.id))
      if (!signed.length) continue
      canonical.players = canonical.players.filter((player) => !signed.some((item) => item.id === player.id))
      canonical.starPlayerIds = canonical.starPlayerIds.filter((id) => !signed.some((item) => item.id === id))
      const updated = next.aiTeams.find((item) => item.id === team.id)
      canonical.lineup = repairLineup(canonical.players, updated?.lineup ?? canonical.lineup).lineup
      const worldClub = sharedWorld.world.clubs.find((item) => item.id === team.id)
      if (worldClub) worldClub.starPlayerIds = worldClub.starPlayerIds.filter((id) => !signed.some((item) => item.id === id))
      changed = true
    }
    if (changed) persistWorld()
  }

  function transferSnapshot(account: Account): GameState {
    // 报价和预览只读；不复制整份全世界名单，成交时再单独克隆卖家。
    const validClubs = new Set(sharedWorld.world.clubs.map((club) => club.id))
    const aiTeams = Object.entries(sharedWorld.teams ?? {}).filter(([id]) => !sharedWorld.owners[id] && validClubs.has(id)).map(([, team]) => team)
    return { ...account.game, aiTeams, appearances: sharedWorld.matchBook!.appearances }
  }

  function transferOffers(account: Account) {
    const game = transferSnapshot(account)
    return aiTransferOffers(game).map(({ team, player, asking, terms }) => ({
      teamId: team.id, teamName: team.name, player: publicPlayer(untrainedPlayer(player)), asking, terms,
      blocked: sellerSquadError(team, player), demands: negotiationDemands(game, player),
    }))
  }

  /** Agent 球探只读取共享名册/自由市场解析目标；费用和报告仍写入账号自己的存档。 */
  function scoutingSnapshot(account: Account): GameState {
    const validClubs = new Set(sharedWorld.world.clubs.map((club) => club.id))
    return {
      ...account.game,
      aiTeams: Object.entries(sharedWorld.teams ?? {}).filter(([id]) => validClubs.has(id)).map(([, team]) => team),
      freeStars: market.pool,
    }
  }

  type ServerReply = { status: number; payload: Record<string, unknown> }

  /**
   * 玩家向本联赛 AI 球队买人（手动界面和 Agent 共用）：俱乐部按放人规则、球员按个人诉求，都点头才成交；
   * 钱进对方的共享账本，共享名册同步拿掉这名球员。不占对方的买进名额。
   */
  function buyFromAIClub(account: Account, body: Record<string, unknown>): ServerReply {
    const teamId = String(body.teamId ?? '')
    if (sharedWorld.owners[teamId]) return { status: 400, payload: { ok: false, error: '不能从其他玩家执教的球队直接买人' } }
    const goal = String(body.goal ?? 'promotion') as SeasonGoal
    const role = String(body.role ?? 'first-team') as SquadRole
    if (!Object.hasOwn(SEASON_GOAL_LABELS, goal) || !Object.hasOwn(SQUAD_ROLE_LABELS, role)) return { status: 400, payload: { ok: false, error: '无效的赛季目标或队内定位' } }
    const offer = Number(body.offer)
    const playerId = String(body.playerId ?? '')
    const canonical = sharedWorld.teams?.[teamId]
    // 本地列表可能落后于共享世界：不能凭旧名单再次购买已经转走的球员。
    if (!sharedWorld.world.clubs.some(club => club.id === teamId) || !canonical?.players.some((player) => player.id === playerId) || db.accounts.some(other => other.game.roster.some(player => player.id === playerId))) {
      return { status: 400, payload: { ok: false, error: '球员不在该球队' } }
    }
    const previousTeams = account.game.aiTeams
    const staged = structuredClone(account.game)
    staged.aiTeams = [structuredClone(canonical)]
    staged.appearances = sharedWorld.matchBook!.appearances
    // 卖家收入由共享账本统一入账，不能同时修改账号里的 AI 账本副本。
    const aiClubs = staged.aiClubs
    staged.aiClubs = undefined
    const result = signClubPlayer(staged, teamId, playerId, offer, { goal, role })
    staged.aiClubs = aiClubs
    if (result.ok) {
      const updated = staged.aiTeams.find(team => team.id === teamId)!
      staged.aiTeams = previousTeams.map(team => team.id === teamId ? structuredClone(updated) : team)
      staged.appearances = account.game.appearances
      account.game = staged
      accountSync.delete(account)
      sharedWorld.teams![teamId] = structuredClone(updated)
      const worldClub = sharedWorld.world.clubs.find(club => club.id === teamId)
      if (worldClub) worldClub.starPlayerIds = [...updated.starPlayerIds]
      const seller = sharedWorld.aiClubs?.[teamId]
      if (seller) {
        seller.economy.balance += offer
        seller.signings = seller.signings.filter((item) => item.id !== playerId)
      }
      persistWorld()
      publishClub(account)
      account.revision++
      account.lastUserRevision = account.revision
      account.updatedAt = now()
      persistAccount(account)
      broadcast(account)
    }
    return { status: result.ok ? 200 : 400, payload: { ...result } }
  }

  /** 玩家回复 AI 的报价：接受就把人转到对方的共享名册（对方扣钱、占买进名额）；拒绝高价报价球员会不满。 */
  function answerOffer(account: Account, body: Record<string, unknown>): ServerReply {
    const offerId = String(body.offerId ?? '')
    const accept = body.accept === true
    const offer = account.game.transferOffers?.find((item) => item.id === offerId)
    const buyer = offer ? sharedMarketClubs([offer.clubId])[0] : undefined
    const result = respondToOffer(account.game, offerId, accept, now(), buyer, serverSeason())
    if (result.ok) {
      if (accept) persistWorld()
      publishClub(account)
      account.revision++
      account.lastUserRevision = account.revision
      account.updatedAt = now()
      persistAccount(account)
      broadcast(account)
    }
    return { status: result.ok ? 200 : 400, payload: { ...result } }
  }

  /** 直播播完后到比分公布之间最多留多久（公布本来就在播完那一刻，这只是防止出现空档）。 */
  const LIVE_GRACE_MS = 5 * 60_000
  /** 直播窗口里反复下发同一场的初始引擎状态：读盘一次就够，只留最近几场。 */
  const liveStates = new Map<string, { input: MatchJob; state: unknown }>()
  function liveStateOf(id: string): { input: MatchJob; state: unknown } {
    const cached = liveStates.get(id)
    if (cached) return cached
    const { input, result } = matchQueue.read(id)
    // 没有初始状态的（纯电脑对电脑、测试里的假结果）也记下来，免得每秒反复读盘。
    const entry = { input, state: result.initialState }
    liveStates.set(id, entry)
    while (liveStates.size > 8) liveStates.delete(liveStates.keys().next().value!)
    return entry
  }

  /**
   * 开球后到公布前（10 分钟，LEAGUE_REALTIME_MS），这位教练能“看直播”的那场比赛。
   * 比赛早在开球前 30 分钟锁定阵容、由后台子进程算好，这里只下发开球那一刻的初始引擎状态：
   * 浏览器按现实时钟把整场回放出来（和算好的结果同一份种子，比分一致），比分/积分榜要等 10 分钟后才公布。
   */
  /** 现在是否在某一轮开球后的直播窗口里（最近一次开球起 10 分钟 + 余量）；绝大多数时间不在，就不必逐账号找直播。 */
  function inLiveWindow(t: number): boolean {
    const round = Math.min(38, worldRoundsKickedOff(sharedWorld.world, t))
    const division = sharedWorld.world.divisions[0]
    const leagueLive = round >= 1 && !!division && t - seasonRoundKickoff(division, round) < LEAGUE_REALTIME_MS + LIVE_GRACE_MS
    const cupLive = sharedWorld.world.seasonCups?.cups.some(cup => cup.rounds.some(item => t >= item.kickoffAt && t < item.kickoffAt + LEAGUE_REALTIME_MS + LIVE_GRACE_MS)) ?? false
    return leagueLive || cupLive
  }

  function liveMatchFor(account: Account): ActiveMatchSave | undefined {
    if (!inLiveWindow(now())) return undefined
    const clubId = ownedClubId(account)
    const game = account.game
    if (!clubId || game.world?.clubs.find((club) => club.id === 'player')?.squadKey !== clubId) return undefined
    const t = now()
    for (const fixture of game.season.fixtures) {
      if (!fixture.isPlayer || fixture.played) continue
      const division = sharedWorld.world.divisions.find(item => item.divisionId === game.season.divisionId)
      const kickoffAt = division ? seasonRoundKickoff(division, fixture.round) : kickoffAtForRound(sharedWorld.world.seasonStartedAt, fixture.round)
      // 开球起放到公布为止：10 分钟播完后到公布之间留一点余量，不出现空档；
      // 停服后补公布的老比赛不再放直播（也不用为它们逐场读盘）。
      if (t < kickoffAt || t >= kickoffAt + LEAGUE_REALTIME_MS + LIVE_GRACE_MS) continue
      // 开球之后才接管的球队没有参与这场比赛的锁定，不放直播。
      if (kickoffAt <= account.createdAt) continue
      const id = matchJobId(game.season.index, game.season.divisionId!, {
        round: fixture.round, homeId: fixture.homeId === 'player' ? clubId : fixture.homeId, awayId: fixture.awayId === 'player' ? clubId : fixture.awayId,
      })
      if (!matchQueue.ready(id)) continue
      const live = liveStateOf(id)
      if (!live.state) continue
      const home = live.input.home.team.id === clubId
      const mine = home ? live.input.home : live.input.away
      const theirs = home ? live.input.away : live.input.home
      return {
        context: { isLeague: true, round: live.input.round, opponentId: theirs.team.id, opponentName: theirs.team.name, seed: live.input.seed, homeAway: home ? 'home' : 'away', durationSeconds: LOGIC_MATCH_SECONDS, offside: true },
        engineState: live.state,
        instructions: [],
        lineup: structuredClone(mine.team.lineup),
        startedAt: live.input.kickoffAt,
        coachPausesLeft: 0,
        preplayed: true,
      }
    }
    for (const cup of sharedWorld.world.seasonCups?.cups ?? []) for (const round of cup.rounds) for (const fixture of round.fixtures) {
      if (fixture.played || (fixture.homeId !== clubId && fixture.awayId !== clubId) || t < fixture.kickoffAt || t >= fixture.kickoffAt + LEAGUE_REALTIME_MS + LIVE_GRACE_MS) continue
      const id = seasonCupJobId(game.season.index, cup.id, fixture.id)
      if (!matchQueue.ready(id)) continue
      const live = liveStateOf(id)
      const home = live.input.home.team.id === clubId
      const mine = home ? live.input.home : live.input.away
      const theirs = home ? live.input.away : live.input.home
      if (!live.state || mine.coachId !== account.id) continue
      return {
        context: { isLeague: false, mode: 'cup', cupId: `season-${cup.id}`, cupFixtureId: fixture.id, round: fixture.round, opponentId: theirs.team.id, opponentName: theirs.team.name, seed: live.input.seed, homeAway: home ? 'home' : 'away', durationSeconds: LOGIC_MATCH_SECONDS, offside: true },
        engineState: live.state, instructions: [], lineup: structuredClone(mine.team.lineup), startedAt: live.input.kickoffAt, coachPausesLeft: 0, preplayed: true,
      }
    }
    return undefined
  }

  /** 对手的实时体能只存在服务器；账号存档的公开副本不能带回这些字段。零全量克隆投影，slim 模式进一步瘦身。 */
  type ProjectOptions = { lazyCup?: boolean; slim?: boolean }
  const projectedAiTeamCache = new WeakMap<AITeam, { epoch: string; full?: AITeam; slim?: AITeam }>()
  function projectAiTeamCached(team: AITeam, slim: boolean, epoch: string): AITeam {
    let entry = projectedAiTeamCache.get(team)
    if (!entry || entry.epoch !== epoch) {
      entry = { epoch }
      projectedAiTeamCache.set(team, entry)
    }
    if (slim) return (entry.slim ??= projectAiTeam(team, true))
    return (entry.full ??= projectAiTeam(team, false))
  }

  function projectGame(account: Account, options: boolean | ProjectOptions = false): GameState {
    const lazyCup = typeof options === 'boolean' ? options : options.lazyCup === true
    const slim = typeof options === 'boolean' ? false : options.slim === true
    const original = account.game
    // Keep the pool in an ongoing legacy cup match so reload can finish its simulation.
    const match = original.activeMatch
    const legacyMatch = match?.context.mode === 'cup' && !match.context.cupId?.startsWith('season-')
    const pve = lazyCup && original.pve?.cupSeason
      ? { ...original.pve, cupSeason: legacyMatch ? original.pve.cupSeason : undefined, cupSeasonDeferred: true as const }
      : original.pve
    const game: GameState = { ...original, ...(pve !== original.pve ? { pve } : {}) }
    if (lazyCup) delete game.reserveStars
    delete (game as GameState & { recycledCardIds?: string[] }).recycledCardIds
    // Pending reports are deliberately incomplete on the wire, although GameState's
    // offline type describes the complete, server-side report.
    game.scoutReports = visibleScoutReports(original, now()) as GameState['scoutReports']
    const cacheEpoch = `${original.namesVersion ?? 0}:${original.traitsVersion ?? 0}:${original.attrsVersion ?? 0}:${sharedTeamsPublicVersion}`
    game.aiTeams = original.aiTeams.map((team) => projectAiTeamCached(team, slim, cacheEpoch))
    if (slim) {
      game.matchHistory = original.matchHistory.map(slimMatchRecord)
      game.challengeHistory = original.challengeHistory.map(slimMatchRecord)
      if (original.world) {
        const ownDivId = original.season.divisionId ?? original.world.playerDivisionId
        game.world = {
          ...original.world,
          divisions: original.world.divisions.map((division) =>
            division.divisionId === ownDivId
              ? { ...division, fixtures: [], fixturesFromSeason: true as const }
              : division,
          ),
        }
      }
    }
    // 直播回放只放在下发的副本里，不写回账号存档。
    if (!game.activeMatch) {
      const live = liveMatchFor(account)
      if (live) game.activeMatch = live
    }
    return game
  }

  function fastSectionTokens(account: Account, slim: boolean): { worldRef?: object; worldToken?: string } {
    const sync = syncOf(account)
    if (account.game.world && account.game.shared && !account.game.activeMatch?.context.isLeague && sync.worldVer === sharedWorldVersion && sync.fixturesVer === sharedWorldVersion && sync.marketVer === market.version) {
      return {
        worldRef: account.game.world,
        worldToken: `w:${sharedWorldVersion}:${market.version}:${account.game.season.round}:${account.game.season.finished ? 1 : 0}:${account.game.clubName}:${slim ? 1 : 0}:${account.game.world.seasonIndex}`,
      }
    }
    return {}
  }

  /** 开球那一刻把直播推给在线的教练（存档本身没有变化，不会触发普通的状态推送）。 */
  const liveAnnounced = new Set<string>()
  function announceLiveMatches(): void {
    const t = now()
    if (!inLiveWindow(t)) {
      if (memoryMonitor.isUnderPressure() && liveStates.size > 0) liveStates.clear()
      return
    }
    for (const key of liveAnnounced) if (Number(key.split('@')[1]) + 60 * 60_000 <= t) liveAnnounced.delete(key)
    for (const account of db.accounts) {
      if (!clients.has(account.id)) continue
      const live = liveMatchFor(account)
      if (!live) continue
      const key = `${account.id}@${live.startedAt}`
      if (liveAnnounced.has(key)) continue
      liveAnnounced.add(key)
      broadcast(account)
    }
  }

  // serverTime：客户端在应用存档（含直播回放）之前先对准服务器时钟，本机时钟不准也不会把回放放到错的时刻。
  function broadcast(account: Account, source?: string): void {
    if (pendingAccountCommits.has(account.id)) return
    const group = clients.get(account.id)
    if (!group || group.size === 0) return
    for (const client of group) {
      if (client.closed || client.sink.isClosed()) continue
      // 保存方本地已经是最新状态；回推完整存档只会让页面卡住，但需要同步其增量基线以便下次差分。
      if (source && client.id === source) {
        if (client.delta) {
          const projected = projectGame(account, { lazyCup: client.lazyCup, slim: client.slim })
          client.lastDigest = digestGameSections(projected, fastSectionTokens(account, client.slim))
          client.lastRevision = account.revision
        }
        continue
      }
      if (client.pendingBroadcast) {
        client.pendingBroadcast = { source }
        continue
      }
      client.pendingBroadcast = { source }
      enqueueClientTask(client, async () => {
        const pending = client.pendingBroadcast
        client.pendingBroadcast = null
        if (!pending || client.closed || client.sink.isClosed()) return
        const projected = projectGame(account, { lazyCup: client.lazyCup, slim: client.slim })
        const coaches = clubCoaches()
        const serverTime = now()
        const rev = account.revision
        const sourceField = pending.source ? { source: pending.source } : {}

        if (client.delta && client.lastDigest) {
          const nextDigest = digestGameSections(projected, fastSectionTokens(account, client.slim))
          const delta = buildGameDelta(client.lastDigest, projected, nextDigest)
          const baseRevision = client.lastRevision
          if (!delta.changed) {
            client.lastRevision = rev
            client.lastDigest = nextDigest
            client.sink.writeRaw(`id: ${rev}\ndata: ${JSON.stringify({ type: 'state-sync', revision: rev, clubCoaches: coaches, serverTime, ...sourceField })}\n\n`)
            return
          }
          if (delta.heavy && memoryMonitor.isUnderPressure()) {
            client.lastDigest = null
            client.lastRevision = rev
            client.sink.writeRaw(`id: ${rev}\ndata: ${JSON.stringify({ type: 'state-stale', revision: rev, clubCoaches: coaches, serverTime, ...sourceField })}\n\n`)
            return
          }
          client.lastRevision = rev
          client.lastDigest = nextDigest
          await client.sink.writeEventAsync(
            rev,
            {
              type: 'state-patch',
              baseRevision,
              revision: rev,
              clubCoaches: coaches,
              serverTime,
              patch: delta.patch,
              ...(delta.prepend ? { prepend: delta.prepend } : {}),
              ...(delta.remove ? { remove: delta.remove } : {}),
              ...sourceField,
            },
            memoryMonitor.isUnderPressure,
          )
          return
        }

        if (client.delta && memoryMonitor.isUnderPressure()) {
          client.lastDigest = null
          client.lastRevision = rev
          client.sink.writeRaw(`id: ${rev}\ndata: ${JSON.stringify({ type: 'state-stale', revision: rev, clubCoaches: coaches, serverTime, ...sourceField })}\n\n`)
          return
        }

        if (client.delta) {
          client.lastDigest = digestGameSections(projected, fastSectionTokens(account, client.slim))
          client.lastRevision = rev
        }
        await client.sink.writeEventAsync(
          rev,
          { type: 'state', revision: rev, clubCoaches: coaches, serverTime, game: projected, ...sourceField },
          memoryMonitor.isUnderPressure,
        )
      })
    }
  }

  /**
   * 超过 3 天未上线的玩家球队：每轮由 AI 自动打理基础阵容与培养——
   * 1. 若库存已有更高 CA 的球员卡则自动装上（绝不删除玩家已有卡片）；
   * 2. 修复不合法的首发阵容；
   * 3. 用球队自有训练精力代练 1 名球员，仅当练出更高 CA 的卡时才收进库存并装备（不花资金、不卖球员）。
   */
  function runAITakeoverUpkeep(account: Account): boolean {
    if (!isAccountAITakeover(account) || account.game.activeMatch) return false
    const key = `${account.game.season.index}:${account.game.season.round}`
    if (account.aiTakeoverKey === key) return false
    account.aiTakeoverKey = key
    const game = account.game
    let changed = true
    ensureCards(game)
    for (const player of game.roster) {
      const gk = player.positions.GK > 0
      let bestId: string | null = null
      let bestCa = caOf(player.attrs, gk) + 0.5
      for (const card of playerCards(game, player.id)) {
        const cardCa = caOf(card.attrs, gk)
        if (cardCa > bestCa) {
          bestCa = cardCa
          bestId = card.id
        }
      }
      if (bestId && equipCard(game, player.id, bestId).ok) changed = true
    }
    const repaired = repairLineup(game.roster, game.lineup)
    if (repaired.changed) {
      game.lineup = repaired.lineup
      changed = true
    }
    settleSquadEnergy(game, now())
    const starterSet = new Set(game.lineup.starters.map((item) => item.playerId))
    const benchSet = new Set(game.lineup.bench)
    const eligible = game.roster.filter((player) => {
      if (isYouthTrainee(player)) return false
      const running = game.training?.[player.id]
      if (running && !running.completed) return false
      return (player.energy ?? 100) >= TRAINING_ENERGY_COST
    })
    if (eligible.length > 0) {
      const ranked = [...eligible].sort((a, b) => {
        const tierOf = (p: Player) => (starterSet.has(p.id) ? 2 : benchSet.has(p.id) ? 1 : 0)
        const tierDiff = tierOf(b) - tierOf(a)
        if (tierDiff !== 0) return tierDiff
        const verDiff = (a.version ?? 0) - (b.version ?? 0)
        if (verDiff !== 0) return verDiff
        return caOf(b.baseAttrs ?? b.attrs, b.positions.GK > 0) - caOf(a.baseAttrs ?? a.attrs, a.positions.GK > 0)
      })
      const target = ranked[(Math.max(1, game.season.round) - 1) % Math.min(ranked.length, 11)] ?? ranked[0]
      target.energy = Math.max(0, (target.energy ?? 100) - TRAINING_ENERGY_COST)
      const economy = economyOf(game)
      const seed = splitSeed(sharedWorld.seed, `ai-takeover-train-${account.id}-${game.season.index}-${game.season.round}-${target.id}`)
      const session = simulateAITrainingSession(target, seed, economy, game.season.index, cupCeilingBonus(game))
      const gk = target.positions.GK > 0
      if (caOf(session.candidate.attrs, gk) > caOf(target.attrs, gk) + 0.5) {
        const card = addTrainedCard(game, session)
        equipCard(game, target.id, card.id)
      }
      changed = true
    }
    return changed
  }

  function advanceAccount(account: Account): boolean {
    try {
      if (!account.game) return false
      const sync = syncOf(account)
      const needsMigration = sync.migratedGame !== account.game
      // 7 人制存档迁移到 11 人制（只在还有旧阵型时动手）。
      const elevenUpgraded = needsMigration ? upgradeElevenASide(account.game) : false
      // 联机账号的世界、电脑球队和自由市场由服务器维护：打上标记，本地的单机逻辑就不会另算一份。
      const markedShared = !account.game.shared
      if (markedShared) account.game.shared = true
      const signaturesAdded = needsMigration ? upgradeLegacySignatures(account.game) : false
      const cardsAdded = ensureCards(account.game)
      const pveAdded = ensurePve(account.game, cupOpeningTeams())
      const namesUpgraded = needsMigration ? upgradeNames(account.game) : false
      const traitsUpgraded = needsMigration ? upgradeStarTraits(account.game) : false
      const attrsUpgraded = needsMigration ? upgradeBurstAttr(account.game) : false
      if (needsMigration) sync.migratedGame = account.game
      const sharedTeamsChanged = pullSharedTeams(account)
      const sharedFixturesChanged = pullSharedFixtures(account)
      const sharedWorldChanged = pullSharedWorld(account)
      const publishedMatches = syncPublishedMatches(account)
      const seasonShopAwarded = account.game.season.finished && account.game.economy?.prizeSeason === account.game.season.index
        ? awardSeasonShopPoints(account.game) > 0
        : false
      const youthChanged = settleYouth(account.game, now())
      // 体能每小时按比例恢复；PvE 迁移不覆盖 main 的体能和共享名册逻辑。
      const rested = settleAccountConditions(account)
      let migrated = youthChanged || seasonShopAwarded || markedShared || elevenUpgraded || signaturesAdded || cardsAdded || pveAdded || namesUpgraded || traitsUpgraded || attrsUpgraded || sharedTeamsChanged || sharedFixturesChanged || sharedWorldChanged || publishedMatches.changed || rested || absorbInto(account)
      const economyAdded = account.game.economy == null || account.game.economy.fans === undefined
      economyOf(account.game)
      const progressingLeague = !!account.game.activeMatch?.context.isLeague
      // 新联赛只消费全服已经发布的结果，注册 / 登录 / 保存都不能触发本账号单独模拟。
      const changed = progressingLeague ? advanceLeagueRealtime(account.game, now()) : false
      // 补算里卖给 NPC 或合同到期的球员，这一步进市场。
      if (absorbInto(account)) migrated = true
      // 报价：过期的按拒绝处理；每轮最多来一份新报价（本联赛没有教练执教的 AI 俱乐部，按需出价）。
      if (expireOffers(account.game, now())) migrated = true
      const offerKey = `${account.game.season.index}:${account.game.season.round}`
      if (account.offerKey !== offerKey) {
        account.offerKey = offerKey
        const ids = (account.game.season.clubIds ?? []).filter((id) => id !== 'player')
        if (generateAIOffers({ game: account.game, clubs: sharedMarketClubs(ids), season: serverSeason(), round: account.game.season.round, now: now(), seed: splitSeed(sharedWorld.seed, `offers-${account.id}`) })) migrated = true
      }
      if (runAITakeoverUpkeep(account)) migrated = true
      if (!changed && !migrated && !economyAdded) return false
      publishClub(account)
      // 补算 / 自动结算会改动本地那份对手名单（体能、伤病）：同一次推进里就换回共享名册，
      // 免得下一次请求再同步一次、版本号又涨，客户端随后的保存被当成冲突。
      pullSharedTeams(account)
      pullSharedFixtures(account)
      pullSharedWorld(account)
      account.revision++
      // 杯赛/商店结算发奖后，旧客户端基于奖励前的余额不能再覆盖该账号。
      if (publishedMatches.rewardChanged || seasonShopAwarded) account.lastUserRevision = account.revision
      // lastUserRevision 通常只记录“玩家自己保存”的版本；AI / 共享世界 / 自动结算的改动不算，
      // 否则这些服务端变化会把玩家的下一次保存判成冲突。
      account.updatedAt = now()
      persistAccount(account)
      broadcast(account)
      return true
    } catch (error) {
      console.error(`advanceAccount failed for ${account.username}`, error)
      return false
    }
  }

  /** 全服比赛日长度（测试里可能缩短）；体能每个游戏日的六分之一结算一次。 */
  const sharedGameDayMs = (): number => sharedWorld.world.divisions[0]?.gameDayMs ?? GAME_DAY_MS

  /** 接管球队的一线队体能结算到现在；没有上过全服比赛的人从现在开始记。 */
  function settleAccountConditions(account: Account): boolean {
    const clubId = ownedClubId(account)
    if (!clubId || account.game.world?.clubs.find((club) => club.id === 'player')?.squadKey !== clubId) return false
    const book = sharedWorld.matchBook!
    let changed = false
    for (const player of account.game.roster) if (settleCondition(player, now(), sharedGameDayMs(), book.conditionAt[player.id])) changed = true
    return changed
  }

  /** 无主 AI 球队的体能结算到现在（有教练的球队走账号，见 settleAccountConditions）。 */
  function settleSharedConditions(): void {
    const book = sharedWorld.matchBook!
    let changed = false
    for (const [clubId, team] of Object.entries(sharedWorld.teams ?? {})) {
      if (sharedWorld.owners[clubId]) continue
      for (const player of team.players) if (settleCondition(player, now(), sharedGameDayMs(), book.conditionAt[player.id])) changed = true
    }
    // 无主 AI 的隐藏体能变化可按时钟确定性重算，低优先级合批落盘，避免每 30 秒重写整份 19 MB world.json。
    if (changed) persistWorld({ world: false, teams: false, matchBook: false, lowPriority: true })
  }

  /** 同步全服公开赛果；仿真只在后台队列子进程中运行，和是否有人在线无关。 */
  function advanceAllMatches(): void {
    withDeferredWorldPersist(() => {
      advanceSharedWorld()
      settleSharedConditions()
      for (const account of db.accounts) advanceAccount(account)
    })
  }

  /** 最近一次全服换季的时间，用来让“开始下一赛季”请求在自动换季后保持幂等。 */
  let lastRollAt = -Infinity

  /** 全服赛季一次性结算：先在副本中算完升降级和所有教练的阵容，再一起发布。 */
  function rollSharedSeason(force = false): { ok: boolean; error?: string } {
    const old = sharedWorld.world
    // 即使强制请求换季，也不能绕过任务队列临时生成未结算的比分。
    if (!old.divisions.every((division) => division.fixtures.every((fixture) => fixture.played))) return { ok: false, error: '全服本赛季仍有比赛未完成' }
    if (old.seasonCups?.cups.some(cup => !cup.championId)) return { ok: false, error: '全服赛季杯赛仍有比赛未完成' }
    const managed = db.accounts.flatMap((account) => {
      const clubId = ownedClubId(account)
      return clubId && account.game.world?.clubs.some((club) => club.id === 'player' && club.squadKey === clubId) ? [{ account, clubId }] : []
    })
    if (managed.some(({ account }) => account.game.activeMatch?.context.isLeague)) return { ok: false, error: '有教练的联赛比赛仍在进行' }
    try {
      const sample = managed.find(({ account }) => account.game.season.index === old.seasonIndex)
      const representativeId = sample?.clubId ?? old.clubs.find((club) => club.tier === 'division2')!.id
      const representative = sample
        ? structuredClone(sample.account.game)
        : createWorldGameFromWorld(old, representativeId, sharedWorld.seed, old.seasonStartedAt, [], [])
      representative.world = worldForClub(old, representativeId)
      representative.season = representative.world.divisions.find((division) => division.clubIds?.includes('player'))!
      representative.aiTeams = Object.entries(sharedWorld.teams ?? {}).filter(([id]) => id !== representativeId).map(([, team]) => structuredClone(team))
      representative.freeStars = []
      representative.reserveStars = structuredClone(sharedWorld.reserveStars)
      // 市场球员由市场管理，不因任一教练的赛季存档而被重复退役。
      for (const player of market.pool) delete representative.world.starAges[player.id]
      delete representative.activeMatch
      const protectedClubs = new Set(managed.map(({ clubId }) => clubId).filter((id) => id !== representativeId))
      const result = advanceWorldSeason(representative, now(), protectedClubs, false)
      if (!result.ok) return result
      const next = ownerlessWorldFromClub(representative.world!, representativeId)
      const teamSeed = splitSeed(sharedWorld.seed, `world-teams-${next.seasonIndex}`)
      const provisional = buildOwnerlessTeams(next, teamSeed, sharedWorld.aiClubs)
      const drafts = managed.map(({ account, clubId }) => {
        const game = structuredClone(account.game)
        if (game.season.index === old.seasonIndex) {
          const oldDiv = old.divisions.find((division) => division.clubIds?.includes(clubId))
          const coachedInOld = oldDiv?.fixtures.some((fixture) => (fixture.homeId === clubId || fixture.awayId === clubId) && fixture.played && (fixture.kickoffAt ?? 0) > account.createdAt)
          if (oldDiv && coachedInOld) {
            const finish = oldDiv.table.findIndex((row) => row.teamId === clubId) + 1
            if (finish > 0) awardSeasonShopPoints(game, { index: old.seasonIndex, tier: oldDiv.tier, finished: true, playerFinish: finish })
          }
          advanceSharedAccountSeason(game, old, next, clubId, provisional)
        } else {
          // 兼容此前由个人存档提前进入下一赛季的账号，不能再给球员老化一次。
          game.world = worldForClub(next, clubId)
          game.season = game.world.divisions.find((division) => division.clubIds?.includes('player'))!
        }
        return { account, clubId, game }
      })
      // 真实教练名单覆盖预生成的 AI 名册，球星归属也以实际签约名单为准。
      for (const { clubId, game } of drafts) {
        const club = next.clubs.find((item) => item.id === clubId)!
        const previousStars = [...club.starPlayerIds]
        club.starPlayerIds = game.roster.filter((player) => player.starKey).map((player) => player.id)
        for (const id of previousStars) if (!club.starPlayerIds.includes(id)) delete next.starAges[id]
        for (const player of game.roster) if (player.starKey) next.starAges[player.id] = player.age ?? 24
      }
      const teams = buildOwnerlessTeams(next, teamSeed, sharedWorld.aiClubs)
      for (const { clubId, game } of drafts) {
        teams[clubId] = { ...teams[clubId], players: structuredClone(game.roster), lineup: structuredClone(game.lineup) }
      }
      syncAllClubLiveTactics(next, teams)
      for (const { clubId, game } of drafts) {
        game.world = worldForClub(next, clubId)
        game.season = game.world.divisions.find((division) => division.clubIds?.includes('player'))!
        game.aiTeams = (game.season.clubIds ?? []).filter((id) => id !== 'player').map((id) => structuredClone(teams[id]))
      }
      sharedWorld.world = next
      sharedWorld.teams = teams
      sharedWorld.cupOpening = { seasonIndex: next.seasonIndex, teams: structuredClone(teams) }
      sharedWorld.reserveStars = representative.reserveStars ?? []
      for (const { account, game } of drafts) {
        ensurePve(game, cupOpeningTeams())
        account.game = game
        accountSync.delete(account)
        account.appliedMatchIds = []
        account.revision++
        account.lastUserRevision = account.revision
        account.updatedAt = now()
        absorbInto(account)
      }
      const occupied = new Set([...Object.values(teams).flatMap((team) => team.players.map((player) => player.id)), ...market.pool.map((player) => player.id)])
      const ownedStarKeys = new Set(drafts.flatMap(({ game }) => game.roster.filter((player) => player.starKey).map((player) => player.starKey!)))
      const released = representative.freeStars.filter((player) => !occupied.has(player.id) && !(player.id.startsWith('regen-') && player.starKey && ownedStarKeys.has(player.starKey)))
      if (released.length) {
        market.pool.push(...released)
        market.version++
        persistMarket()
        broadcastMarket()
      }
      sharedWorld.startedAt = next.seasonStartedAt
      sharedWorld.aiRound = 0
      const offseasonDelta = Math.max(0, (old.calendarStartAt ?? old.seasonStartedAt) - (next.calendarStartAt ?? next.seasonStartedAt))
      healInjuriesByMs(sharedWorld.matchBook!.injuries, offseasonDelta, now())
      sharedWorld.matchBook!.suspensions = {}
      sharedWorld.matchBook!.yellowCounts = {}
      sharedWorld.matchBook!.cupDiscipline = {}
      // 电脑球队也过了一个赛季：清掉已经并进名单的签入，账本和设施继续滚。
      for (const state of Object.values(sharedWorld.aiClubs ?? {})) state.signings = []
      persistWorld({ world: true, teams: true, matchBook: true, immediate: true })
      for (const { account } of drafts) {
        persistAccount(account)
        broadcast(account)
      }
      lastRollAt = now()
      return { ok: true }
    } catch (error) {
      console.error('全服赛季结算失败', error)
      return { ok: false, error: '全服赛季结算失败，请稍后重试' }
    }
  }

  let lastSeasonCheck = -Infinity
  function autoRollSharedSeason(): void {
    // 常规赛结束后先留 12 个游戏日给升级附加赛和友谊赛，窗口走完才开新赛季。
    if (now() < seasonEndAt(sharedWorld.world.seasonStartedAt) || now() - lastSeasonCheck < 5000) return
    // 停服恢复可能仍在逐场处理旧任务：不要提前尝试换季，也不阻塞后台队列。
    if (sharedWorld.world.divisions.some((division) => division.fixtures.some((fixture) => !fixture.played))) return
    lastSeasonCheck = now()
    advanceAllMatches()
    rollSharedSeason()
  }

  /** 常规赛一结束就把升级杯算出来，让休整期间的世界页能看到赛果。 */
  function autoPlayoff(): void {
    if (now() < postseasonStartAt(sharedWorld.world.seasonStartedAt)) return
    // 休整窗口已经走完时会立刻换季，没必要再单独算一次附加赛。
    if (now() >= seasonEndAt(sharedWorld.world.seasonStartedAt)) return
    if (sharedWorld.world.promotionPlayoff?.seasonIndex === sharedWorld.world.seasonIndex) return
    if (sharedWorld.world.divisions.some((division) => division.fixtures.some((fixture) => !fixture.played))) return
    const managed = db.accounts.flatMap((account) => {
      const clubId = ownedClubId(account)
      return clubId ? [{ account, clubId }] : []
    })
    const sample = managed.find(({ account }) => account.game.season.index === sharedWorld.world.seasonIndex)?.account.game
    const representativeId = managed[0]?.clubId ?? sharedWorld.world.clubs.find((club) => club.tier === 'division2')!.id
    let game: GameState
    try {
      game = sample ? structuredClone(sample) : createWorldGameFromWorld(sharedWorld.world, representativeId, sharedWorld.seed, sharedWorld.startedAt, [], [])
    } catch {
      return
    }
    game.world = worldForClub(sharedWorld.world, representativeId)
    game.season = game.world.divisions.find((division) => division.clubIds?.includes('player'))!
    game.aiTeams = Object.entries(sharedWorld.teams ?? {})
      .filter(([id]) => id !== representativeId)
      .map(([, team]) => structuredClone(team))
    delete game.activeMatch
    try {
      const playoff = ensurePromotionPlayoff(game)
      if (!playoff) return
      sharedWorld.world.promotionPlayoff = ownerlessWorldFromClub(game.world, representativeId).promotionPlayoff
      persistWorld()
    } catch (error) {
      console.error('升级附加赛计算失败', error)
    }
  }

  function accountFromToken(token: string | undefined): Account | undefined {
    if (!token) return undefined
    const id = sessions[token]
    return db.accounts.find((account) => account.id === id)
  }

  function agentAccountFromToken(token: string | undefined): Account | undefined {
    if (!token?.startsWith('fm_')) return undefined
    return db.accounts.find((account) => account.agentToken === token)
  }

  function tokenFromRequest(req: IncomingMessage): string | undefined {
    const auth = req.headers.authorization
    if (auth?.startsWith('Bearer ')) return auth.slice(7)
    const url = new URL(req.url ?? '/', 'http://localhost')
    return url.searchParams.get('token') ?? undefined
  }

  /** Cloudflare 隧道会写入 cf-connecting-ip；直连时退回 socket 地址。 */
  function clientIp(req: IncomingMessage): string {
    const cf = req.headers['cf-connecting-ip']
    if (typeof cf === 'string' && cf.trim()) return cf.trim()
    const forwarded = req.headers['x-forwarded-for']
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded
    if (first) {
      const candidate = first.split(',')[0].trim()
      if (candidate) return candidate
    }
    return req.socket.remoteAddress ?? 'unknown'
  }

  function takeRegisterSlot(ip: string): boolean {
    if (!registerLimitPerHour) return true
    const at = now()
    const windowMs = 60 * 60 * 1000
    const recent = (registerAttempts.get(ip) ?? []).filter((stamp) => at - stamp < windowMs)
    if (recent.length >= registerLimitPerHour) {
      registerAttempts.set(ip, recent)
      return false
    }
    recent.push(at)
    registerAttempts.set(ip, recent)
    if (registerAttempts.size > 4096) {
      for (const [key, list] of registerAttempts) if (!list.some((stamp) => at - stamp < windowMs)) registerAttempts.delete(key)
    }
    return true
  }

  function inviteMatches(given: string): boolean {
    if (!inviteCode) return false
    const a = Buffer.from(given, 'utf8')
    const b = Buffer.from(inviteCode, 'utf8')
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  }

  async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
    if (!turnstileSecret) return true
    if (!token) return false
    try {
      const body = new URLSearchParams({ secret: turnstileSecret, response: token })
      if (ip && ip !== 'unknown') body.set('remoteip', ip)
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(5000),
      })
      const data = (await response.json()) as { success?: boolean }
      return data.success === true
    } catch {
      return false
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (closed) return json(res, 503, { error: '服务器正在停止，请稍后重试' })
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url)
        return
      }
      serveStatic(req, res, url)
    } catch (error) {
      console.error(error)
      if (!res.headersSent) json(res, 500, { error: '服务器内部错误' })
      else res.end()
    }
  }

  /** 给 Agent 看的自由市场：全服的球员池和正在进行的竞拍。 */
  function withSharedMarket<T extends { market: { freeAgents: unknown[] } }>(view: T, account: Account): T {
    const anchor = { world: account.game.world, createdAt: account.game.createdAt }
    const onAuctionNow = (id: string) => market.auctions.some((item) => item.playerId === id)
    view.market.freeAgents = market.pool.filter((player) => onAuctionNow(player.id) || sharedAvailable(player, now())).map((player) => {
      const auction = market.auctions.find((item) => item.playerId === player.id)
      return {
        player: playerView(player, account.game, now()),
        price: minimumBid(player, auction),
      }
    })
    ;(view.market as Record<string, unknown>).auctions = market.auctions.map((auction) => ({
      playerId: auction.playerId,
      playerName: auction.playerName,
      endsAt: auction.endsAt,
      secondsLeft: Math.max(0, Math.ceil((auction.endsAt - now()) / 1000)),
      currentBid: leadingBid(auction).amount,
      leadingClub: leadingBid(auction).club,
      leadingIsYou: leadingBid(auction).accountId === account.id,
    }))
    // 转会页“最近成交”：谁以多少钱签下了谁，或者流拍。
    ;(view.market as Record<string, unknown>).recentDeals = market.log.slice(0, 8)
    return view
  }

  const aliveAccountIds = () => db.accounts.map((account) => account.id)
  /** 空位统计（owners 里指向已删除账号的条目视为空位）。 */
  function slotInfo() {
    return worldSlots(sharedWorld.world, sharedWorld.owners, aliveAccountIds())
  }

  /** 二级联赛满员时按需开出新赛区，并补齐名册、AI 经营轮次与前序已公布轮次。 */
  function ensureFreeD2Club(): WorldClub | undefined {
    const existing = pickFreeClubForNewAccount(sharedWorld.world, sharedWorld.owners, aliveAccountIds())
    if (existing) return existing
    const completedBefore = completedWorldRound(sharedWorld.world)
    const { divisionId } = expandWorldConference(
      sharedWorld.world,
      splitSeed(sharedWorld.seed, `expand-${sharedWorld.world.seasonIndex}-${Object.keys(sharedWorld.owners).length}`),
    )
    const newDivision = sharedWorld.world.divisions.find((item) => item.divisionId === divisionId)
    const newClubIds = new Set(newDivision?.clubIds ?? [])
    const newClubs = sharedWorld.world.clubs.filter((item) => newClubIds.has(item.id))
    sharedWorld.aiClubs ??= {}
    sharedWorld.teams ??= {}
    for (const item of newClubs) {
      if (!sharedWorld.aiClubs[item.id]) sharedWorld.aiClubs[item.id] = createAIClub(item, splitSeed(sharedWorld.seed, `ai-club-${item.id}`))
    }
    const teamSeed = sharedWorld.world.seasonIndex > 1
      ? splitSeed(sharedWorld.seed, `world-teams-${sharedWorld.world.seasonIndex}`)
      : sharedWorld.seed
    const expandedTeams = buildOwnerlessTeams(sharedWorld.world, teamSeed, sharedWorld.aiClubs)
    for (const item of newClubs) {
      if (!sharedWorld.teams[item.id] && expandedTeams[item.id]) sharedWorld.teams[item.id] = expandedTeams[item.id]
    }
    const aiRounds = Math.min(Math.max(sharedWorld.aiRound ?? 0, completedBefore), 38)
    for (const item of newClubs) {
      const team = sharedWorld.teams[item.id]
      const state = sharedWorld.aiClubs[item.id]
      for (let round = 1; round <= aiRounds; round++) {
        advanceAIClub(state, item, team, 1, splitSeed(sharedWorld.seed, `ai-advance-${item.id}-${round}`), true, sharedWorld.world.seasonIndex)
      }
      if (team) {
        refreshAILineup(team)
        syncClubLiveTactics(item, team)
      }
    }
    if (newDivision) catchUpExpandedDivision(sharedWorld.world, newDivision, completedBefore, sharedWorld.seed)
    persistWorld()
    advanceAllMatches()
    return pickFreeClubForNewAccount(sharedWorld.world, sharedWorld.owners, aliveAccountIds())
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    // Older clients continue to receive the full GameState.
    const publicGame = (account: Account) => projectGame(account, {
      lazyCup: req.headers['x-fm-lazy-cup'] === '1',
      slim: req.headers['x-fm-slim'] === '1',
    })
    const sendJson = (status: number, value: unknown, stream = false) =>
      sendCompressedJson(req, res, status, value, { stream, isUnderPressure: memoryMonitor.isUnderPressure })
    advanceSharedWorld()
    autoRollSharedSeason()
    autoPlayoff()
    if (url.pathname === '/api/health') {
      json(res, 200, { ok: true, accounts: db.accounts.length, version: GAME_VERSION, worldSeasonStartedAt: sharedWorld.startedAt, memory: memoryMonitor.snapshot() })
      return
    }

    if (url.pathname === '/api/world' && req.method === 'GET') {
      advanceAllMatches()
      const aiTakeoverClubs = sharedWorld.world.clubs.flatMap((club) => {
        const owner = db.accounts.find((item) => item.id === sharedWorld.owners[club.id])
        return owner && isAccountAITakeover(owner) ? [club.id] : []
      })
      await sendJson(200, {
        seed: sharedWorld.seed,
        startedAt: sharedWorld.startedAt,
        owners: sharedWorld.owners,
        aiTakeoverClubs,
        slots: slotInfo(),
        round: sharedWorld.world.divisions[0]?.round ?? 1,
        seasonIndex: sharedWorld.world.seasonIndex,
        divisions: sharedWorld.world.divisions.map((division) => ({ id: division.divisionId, tier: division.tier, conference: division.conference, round: division.round, finished: division.finished, table: division.table })),
        clubs: sharedWorld.world.clubs.map((club) => ({ id: club.id, name: club.name, tier: club.tier, conference: club.conference })),
      })
      return
    }

    /* 自由市场全服可见，不用登录也能看。 */
    if (url.pathname === '/api/market' && req.method === 'GET') {
      settleDueAuctions()
      const t = now()
      const keptIds = collectScoutKeptIds(t)
      const onAuction = new Set(market.auctions.map((item) => item.playerId))
      await sendJson(200, { ...marketPayload(), pool: market.pool.filter((player) => onAuction.has(player.id) || sharedAvailable(player, t, keptIds)) }, true)
      return
    }

    if (url.pathname === '/api/chat' && req.method === 'GET') {
      json(res, 200, { messages: chatMessages, serverTime: now() })
      return
    }

    if (url.pathname === '/api/public-config' && req.method === 'GET') {
      /* 只暴露注册模式与 sitekey，邀请码与 secret 永不下发。 */
      json(res, 200, { registration: registrationMode, turnstileSiteKey, accounts: db.accounts.length, slots: slotInfo() })
      return
    }

    // 注册前只读预览：不创建账号、不预占球队，只提供空缺二级球队的公开名单；二级满员时自动开出新赛区。
    if (url.pathname === '/api/registration/clubs' && req.method === 'GET') {
      if (registrationMode === 'closed') return json(res, 403, { error: '本服务器已关闭注册' })
      advanceAllMatches()
      ensureFreeD2Club()
      const clubs = worldSnapshot().clubs.filter((club) => club.tier === 'division2' && !club.managed)
      await sendJson(200, { clubs }, true)
      return
    }

    if (url.pathname === '/api/register' && req.method === 'POST') {
      if (registrationMode === 'closed') return json(res, 403, { error: '本服务器已关闭注册' })
      const ip = clientIp(req)
      if (!takeRegisterSlot(ip)) return json(res, 429, { error: '注册过于频繁，请稍后再试' })
      const body = await readJsonBody(req)
      if (registrationMode === 'invite' && !inviteMatches(String(body.inviteCode ?? '').trim())) {
        return json(res, 403, { error: '邀请码不正确' })
      }
      if (turnstileSecret && !(await verifyTurnstile(String(body.turnstileToken ?? ''), ip))) {
        return json(res, 400, { error: '人机验证未通过，请刷新后重试' })
      }
      const username = String(body.username ?? '').trim()
      const password = String(body.password ?? '')
      if (!/^[\p{L}\p{N}_-]{2,24}$/u.test(username)) return json(res, 400, { error: '用户名需为 2-24 位字母、数字、中文、_ 或 -' })
      if (password.length < 6) return json(res, 400, { error: '密码至少 6 位' })
      if (db.accounts.some((account) => account.username.toLowerCase() === username.toLowerCase())) return json(res, 409, { error: '用户名已存在' })
      const salt = crypto.randomBytes(16).toString('hex')
      // 接管前把全服到点的比赛统一结算，账号只继承球队已有战绩，注册本身不产生比赛。
      advanceAllMatches()
      // 选队在注册事务内完成；注册成功后球队归属固定，不能再换队。
      const requestedClubId = typeof body.clubId === 'string' ? body.clubId.trim() : ''
      let club = requestedClubId ? sharedWorld.world.clubs.find((item) => item.id === requestedClubId) : undefined
      if (requestedClubId) {
        if (!club) return json(res, 400, { error: '找不到这支球队，请刷新列表' })
        if (club.tier !== 'division2') return json(res, 400, { error: '只能选择空缺的二级联赛球队' })
        const ownerId = sharedWorld.owners[club.id]
        if (db.accounts.some((item) => item.id === ownerId)) {
          return json(res, 409, { error: '这支球队已经有人执教，请选择其他球队' })
        }
      } else {
        // 兼容未指定球队的 API 客户端：只在二级联赛找空位，满员就开新赛区并补齐赛果与名单。
        club = ensureFreeD2Club()
      }
      if (!club) return json(res, 503, { error: '服务器席位已满：新赛区也没能开出空位，请稍后再试' })
      const accountId = crypto.randomUUID()
      sharedWorld.owners[club.id] = accountId
      persistWorld({ world: false, teams: false, matchBook: false, immediate: true })
      const account: Account = {
        id: accountId,
        username,
        salt,
        passwordHash: hashPassword(password, salt),
        // 自由球员全服共用，账号里不再有自己的一份。
        game: createWorldGameFromWorld(sharedWorld.world, club.id, sharedWorld.seed, sharedWorld.startedAt, [], sharedWorld.reserveStars),
        revision: 1,
        lastUserRevision: 1,
        lastOnlineAt: now(),
        createdAt: now(),
        updatedAt: now(),
      }
      const initialTeam = sharedWorld.teams?.[club.id]
      if (initialTeam) {
        account.game.roster = structuredClone(initialTeam.players).map((player) => ({
          ...player,
          contract: { clubId: 'player', wage: wageForPlayer(player), expiresSeason: account.game.season.index + 3 },
        }))
        account.game.lineup = structuredClone(initialTeam.lineup)
      }
      const inheritedCupBonuses = sharedWorld.aiClubs?.[club.id]?.cupCeilingClaims
      if (inheritedCupBonuses) {
        ensurePve(account.game)
        account.game.pve!.cupCeilingClaims = { ...account.game.pve!.cupCeilingClaims, ...inheritedCupBonuses }
        ensureCupCeilingClaims(account.game)
      }
      forgetMarketAges(account)
      account.appliedMatchIds = inheritedMatchIds(account.game, club.id)
      db.accounts.push(account)
      const token = createSession(account.id)
      persistAccount(account)
      advanceAccount(account)
      await accountStore.flush()
      await sendJson(201, { token, user: publicAccount(account), revision: account.revision, clubCoaches: clubCoaches(), serverTime: now(), game: publicGame(account) }, true)
      return
    }

    if (url.pathname === '/api/login' && req.method === 'POST') {
      const body = await readJsonBody(req)
      const username = String(body.username ?? '').trim().toLowerCase()
      const password = String(body.password ?? '')
      const account = db.accounts.find((item) => item.username.toLowerCase() === username)
      if (!account || hashPassword(password, account.salt) !== account.passwordHash) return json(res, 401, { error: '用户名或密码错误' })
      if (pendingAccountCommits.has(account.id) && !await confirmAccountCommit(account)) return json(res, 503, { error: '服务器存档尚未确认，请稍后重试' })
      touchAccountOnline(account, true)
      const token = createSession(account.id)
      advanceAccount(account)
      await accountStore.flush()
      await sendJson(200, { token, user: publicAccount(account), revision: account.revision, clubCoaches: clubCoaches(), serverTime: now(), game: publicGame(account) }, true)
      return
    }

    if (url.pathname === '/api/agent/docs' && req.method === 'GET') {
      const docsPath = path.resolve('docs/agent-api.md')
      if (!fs.existsSync(docsPath)) return json(res, 404, { error: 'Agent 文档不存在' })
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-cache' })
      res.end(fs.readFileSync(docsPath))
      return
    }

    if (url.pathname === '/api/agent/token' && req.method === 'POST') {
      const account = accountFromToken(tokenFromRequest(req))
      if (!account) return json(res, 401, { error: '请先登录' })
      touchAccountOnline(account)
      if (!account.agentToken) {
        account.agentToken = createAgentToken()
        persistAccount(account)
      }
      await accountStore.flush()
      json(res, 200, { token: account.agentToken })
      return
    }

    if (url.pathname === '/api/agent/revoke' && req.method === 'POST') {
      const account = accountFromToken(tokenFromRequest(req))
      if (!account) return json(res, 401, { error: '请先登录' })
      touchAccountOnline(account)
      delete account.agentToken
      persistAccount(account)
      await accountStore.flush()
      json(res, 200, { ok: true })
      return
    }

    if (url.pathname.startsWith('/api/agent/')) {
      const agentAccount = agentAccountFromToken(tokenFromRequest(req))
      if (!agentAccount) return json(res, 401, { error: 'Agent 令牌无效，请在游戏账号面板重新生成' })
      if (pendingAccountCommits.has(agentAccount.id) && !await confirmAccountCommit(agentAccount)) return json(res, 503, { error: '服务器存档尚未确认，请稍后重试' })
      touchAccountOnline(agentAccount)
      // 联机时有教练执教的球队不能从 AI 购买入口买人，和转会页一致。
      const agentOptions: AgentOptions = { isManaged: (clubId) => !!sharedWorld.owners[clubId], transferGame: () => transferSnapshot(agentAccount), scoutGame: () => scoutingSnapshot(agentAccount) }
      const agentState = () => withSharedMarket(agentView(agentAccount.game, now(), agentOptions), agentAccount)
      if (url.pathname === '/api/agent/state' && req.method === 'GET') {
        advanceAccount(agentAccount)
        settleDueAuctions()
        await sendJson(200, { revision: agentAccount.revision, game: agentState() }, true)
        return
      }
      if (url.pathname === '/api/agent/action' && req.method === 'POST') {
        const body = await readJsonBody(req)
        advanceAccount(agentAccount)
        if (body.action === 'start_next_season' && agentAccount.game.world) {
          const outcome = agentAccount.game.season.finished
            ? (now() >= seasonEndAt(sharedWorld.world.seasonStartedAt)
              ? rollSharedSeason(true)
              : { ok: false, error: '赛后休整还没结束：窗口结束后会自动开新赛季' })
            : now() - lastRollAt < 15_000
              ? { ok: true, alreadyRolled: true }
              : { ok: false, error: '本赛季尚未结束' }
          await sendJson(outcome.ok ? 200 : 400, { ...outcome, revision: agentAccount.revision, game: agentState() }, true)
          return
        }
        if (body.action === 'start_league' || body.action === 'simulate_round') return json(res, 400, { error: '联赛由服务器提前排队计算、开球 10 分钟后统一公布，不能手动开赛或模拟' })
        if (['auto_lineup', 'set_lineup', 'set_auto_subs'].includes(String(body.action)) && officialLineupLocked(agentAccount, now())) {
          await sendJson(400, { ok: false, error: '阵容已锁定：开赛前 30 分钟内不能修改，比赛由服务器自动结算', revision: agentAccount.revision, game: agentState() }, true)
          return
        }
        if (body.action === 'youth_action') {
          const game = structuredClone(agentAccount.game)
          const outcome = applyYouthAction(game, body.youth, now(), officialLineupLocked(agentAccount, now()) || !!liveMatchFor(agentAccount))
          if (outcome.ok) {
            agentAccount.game = game
            accountSync.delete(agentAccount)
            agentAccount.revision++
            agentAccount.lastUserRevision = agentAccount.revision
            agentAccount.updatedAt = now()
            pendingAccountCommits.set(agentAccount.id, Symbol('youth-agent-commit'))
            persistAccount(agentAccount)
            if (!await confirmAccountCommit(agentAccount)) return json(res, 503, { error: '青训操作保存尚未确认，请刷新检查' })
            publishClub(agentAccount)
            broadcast(agentAccount)
          }
          await sendJson(outcome.ok ? 200 : 400, { ...outcome, revision: agentAccount.revision, game: agentState() }, true)
          return
        }
        if (body.action === 'buy_free_agent') return json(res, 400, { error: '联机时自由球员要竞拍，请用 bid_free_agent 出价' })
        if (body.action === 'bid_free_agent') {
          const bid = bidFor(agentAccount, body.playerId, body.amount)
          await sendJson(bid.ok ? 200 : 400, { ...bid, revision: agentAccount.revision, game: agentState() }, true)
          return
        }
        /** 全服信息：世界页、球队详情里能看到的所有球队名单、积分榜与赛程。 */
        if (body.action === 'get_world') {
          await sendJson(200, { ok: true, result: worldSnapshot(agentAccount), revision: agentAccount.revision, game: agentState() }, true)
          return
        }
        if (body.action === 'get_chat') {
          await sendJson(200, { ok: true, result: { messages: chatMessages }, revision: agentAccount.revision, game: agentState() }, true)
          return
        }
        if (body.action === 'send_chat') {
          const sent = postChat(agentAccount, body.text)
          await sendJson(sent.ok ? 200 : sent.status, { ...sent, ...(sent.ok ? { result: { message: sent.message, messages: chatMessages } } : {}), revision: agentAccount.revision, game: agentState() }, true)
          return
        }
        if (body.action === 'sign_club_player' || body.action === 'respond_offer') {
          const reply = body.action === 'sign_club_player' ? buyFromAIClub(agentAccount, body) : answerOffer(agentAccount, body)
          await sendJson(reply.status, { ...reply.payload, result: reply.payload, revision: agentAccount.revision, game: agentState() }, true)
          return
        }
        if (body.action === 'rename_club') {
          const renamed = renameClub(agentAccount, body.name)
          await sendJson(renamed.ok ? 200 : renamed.status, { ...renamed, revision: agentAccount.revision, game: agentState() }, true)
          return
        }
        if (body.action === 'choose_club') {
          return json(res, 400, { error: '注册完成后不允许换队，球队只能在注册时选择' })
        }
        if (['get_pve', 'start_peak_challenge', 'start_legend_challenge', 'claim_peak_reward'].includes(String(body.action))) {
          await loadPveContent()
        }
        let outcome: ReturnType<typeof applyAgentAction>
        const previousRoster = new Set(agentAccount.game.roster.map((player) => player.id))
        const previousTeams = agentAccount.game.aiTeams
        if (body.action === 'start_world_friendly') {
          // 和世界页“约战”一样：对手名单由服务器给出，可以约全服任意一支球队（含别的教练执教的）。
          const found = friendlyTeamFor(agentAccount, String(body.clubId ?? ''))
          outcome = 'error' in found ? { ok: false, error: found.error } : startChallengeWithOpponent(agentAccount.game, found.team, now())
        } else {
          outcome = applyAgentAction(body.action === 'preview_signing' ? transferSnapshot(agentAccount) : agentAccount.game, body, now(), agentOptions)
        }
        if (outcome.ok) commitAiSignings(previousRoster, previousTeams, agentAccount.game)
        if (outcome.ok && !['get_player', 'get_match', 'get_pve', 'preview_training', 'preview_signing', 'get_scout_reports'].includes(String(body.action))) {
          publishClub(agentAccount)
          agentAccount.revision++
          const leagueOnly = agentAccount.game.activeMatch?.context.isLeague && ['start_league', 'set_match_tactics', 'set_match_auto_subs', 'substitute'].includes(String(body.action))
          if (!leagueOnly) agentAccount.lastUserRevision = agentAccount.revision
          agentAccount.updatedAt = now()
          persistAccount(agentAccount)
          broadcast(agentAccount)
        }
        absorbInto(agentAccount)
        await sendJson(outcome.ok ? 200 : 400, { ...outcome, revision: agentAccount.revision, game: agentState() }, true)
        return
      }
      json(res, 404, { error: 'Agent 接口不存在' })
      return
    }

    const account = accountFromToken(tokenFromRequest(req))
    if (!account) return json(res, 401, { error: '请先登录' })
    if (pendingAccountCommits.has(account.id) && !await confirmAccountCommit(account)) return json(res, 503, { error: '服务器存档尚未确认，请稍后重试' })
    touchAccountOnline(account)

    if (url.pathname === '/api/world/next-season' && req.method === 'POST') {
      advanceAccount(account)
      const postseasonOver = now() >= seasonEndAt(sharedWorld.world.seasonStartedAt)
      const outcome = account.game.season.finished
        ? (postseasonOver
          ? rollSharedSeason(true)
          : { ok: false, error: '赛后休整还没结束：先踢升级杯/友谊赛，窗口结束会自动开新赛季' })
        // 服务器刚刚自动换过季了：这个请求是幂等的空操作，不该报错。
        : now() - lastRollAt < 15_000
          ? { ok: true, alreadyRolled: true }
          : { ok: false, error: '本赛季尚未结束' }
      await sendJson(outcome.ok ? 200 : 400, { ...outcome, revision: account.revision, game: publicGame(account) }, true)
      return
    }

    /** 友谊赛对手：联机时由服务器给出权威名单（含其他教练的球队），状态类信息不外发。 */
    if (url.pathname === '/api/world/friendly-team' && req.method === 'POST') {
      advanceAccount(account)
      const body = await readJsonBody(req)
      const found = friendlyTeamFor(account, String(body.clubId ?? ''))
      if ('error' in found) return json(res, found.status, { error: found.error })
      await sendJson(200, { team: found.team })
      return
    }

    /** 旧客户端入口保留明确报错；浏览器和 Agent 都不能在注册后换队。 */
    if (url.pathname === '/api/world/choose-club' && req.method === 'POST') {
      return json(res, 400, { error: '注册完成后不允许换队，球队只能在注册时选择' })
    }

    if (url.pathname === '/api/transfer/ai-offers' && req.method === 'GET') {
      advanceAccount(account)
      await sendJson(200, { offers: transferOffers(account) }, true)
      return
    }

    if (url.pathname === '/api/transfer/ai-buy' && req.method === 'POST') {
      advanceAccount(account)
      const reply = buyFromAIClub(account, await readJsonBody(req))
      await sendJson(reply.status, { ...reply.payload, revision: account.revision, game: publicGame(account) }, true)
      return
    }

    if (url.pathname === '/api/transfer/offer' && req.method === 'POST') {
      advanceAccount(account)
      const reply = answerOffer(account, await readJsonBody(req))
      await sendJson(reply.status, { ...reply.payload, revision: account.revision, game: publicGame(account) }, true)
      return
    }

    if (url.pathname === '/api/club/rename' && req.method === 'POST') {
      advanceAccount(account)
      const body = await readJsonBody(req)
      const renamed = renameClub(account, body.name)
      if (!renamed.ok) return json(res, renamed.status, { error: renamed.error })
      await sendJson(200, { revision: account.revision, game: publicGame(account) }, true)
      return
    }

    if (url.pathname === '/api/world/teams' && req.method === 'GET') {
      await sendJson(200, worldSnapshot(account, req.headers['x-fm-world-summary'] !== '1'), true)
      return
    }
    if (url.pathname === '/api/world/club' && req.method === 'GET') {
      advanceAllMatches()
      const requested = url.searchParams.get('id')
      const id = requested === 'player' ? ownedClubId(account) : requested
      if (id) {
        const legendTeam = legendCupTeamById(id)
        if (legendTeam) {
          await sendJson(200, {
            club: {
              id: legendTeam.id,
              name: legendTeam.name,
              color: legendTeam.color,
              tier: 'champions' as const,
              managed: false,
              aiTakeover: false,
              formationId: legendTeam.formationId,
              players: legendTeam.players.map(publicPlayer),
              rating: Math.round(lineupRating(legendTeam.players, legendTeam.lineup)),
            },
            seasonIndex: sharedWorld.world.seasonIndex,
          })
          return
        }
      }
      const club = sharedWorld.world.clubs.find(item => item.id === id)
      if (!club) return json(res, 404, { error: '找不到这支球队' })
      await sendJson(200, { club: publicWorldClub(club, true), seasonIndex: sharedWorld.world.seasonIndex })
      return
    }

    if (url.pathname === '/api/logout' && req.method === 'POST') {
      const token = tokenFromRequest(req)
      if (token) {
        delete sessions[token]
        accountStore.setSession(token, null)
      }
      await accountStore.flush()
      json(res, 200, { ok: true })
      return
    }

    if (url.pathname === '/api/me' && req.method === 'GET') {
      json(res, 200, { user: publicAccount(account), revision: account.revision })
      return
    }

    if (url.pathname === '/api/market/bid' && req.method === 'POST') {
      const body = await readJsonBody(req)
      advanceAccount(account)
      const bid = bidFor(account, body.playerId, body.amount)
      json(res, bid.ok ? 200 : 400, { ...bid, ...marketPayload() })
      return
    }

    // 赛后 2D 重看：只给参赛的教练，且比赛已经公布（战报在他的历史里）。返回开球时的引擎初始状态，
    // 浏览器从头回放，和公布的比分一致。
    if (url.pathname === '/api/match/replay' && req.method === 'GET') {
      const id = url.searchParams.get('id') ?? ''
      const clubId = ownedClubId(account)
      const record = /^q-[a-f0-9]{64}$/.test(id) ? [...account.game.matchHistory, ...account.game.challengeHistory].find((item) => item.id === id) : undefined
      if (!clubId || !record?.hasReplay || !matchQueue.ready(id)) return json(res, 404, { error: '没有这场比赛的 2D 回放' })
      const { input, state } = liveStateOf(id)
      if (!state) return json(res, 404, { error: '没有这场比赛的 2D 回放' })
      await sendJson(200, { id, engineState: state, homeAway: input.home.team.id === clubId ? 'home' : 'away', durationSeconds: LOGIC_MATCH_SECONDS }, true)
      return
    }

    // 复盘明细按需加载：联机精简模式（X-FM-Slim: 1）打开某场战报时再拉完整解说/关键事件/技能统计。
    if (url.pathname === '/api/match/record' && req.method === 'GET') {
      const id = url.searchParams.get('id') ?? ''
      const record = id ? [...account.game.matchHistory, ...account.game.challengeHistory].find((item) => item.id === id) : undefined
      if (!record) return json(res, 404, { error: '找不到这场比赛战报' })
      await sendJson(200, { record })
      return
    }

    if (url.pathname === '/api/scouting/reports' && req.method === 'GET') {
      const serverTime = now()
      await sendJson(200, { reports: visibleScoutReports(account.game, serverTime), serverTime })
      return
    }

    if (url.pathname === '/api/pve/cup-season' && req.method === 'GET') {
      advanceAccount(account)
      const cupSeason = account.game.pve?.cupSeason
      if (!cupSeason || cupSeason.seasonIndex !== account.game.season.index || String(cupSeason.seasonIndex) !== url.searchParams.get('season')) return json(res, 409, { error: '杯赛赛季已变化，请同步后重试' })
      await sendJson(200, { cupSeason, serverTime: now() }, true)
      return
    }

    if (url.pathname === '/api/game' && req.method === 'GET') {
      advanceAccount(account)
      const snapshot = { user: publicAccount(account), game: publicGame(account), revision: account.revision, clubCoaches: clubCoaches(), serverTime: now() }
      await sendJson(200, snapshot, true)
      return
    }

    if (url.pathname === '/api/scouting/delete' && req.method === 'POST') {
      const body = await readJsonBody(req)
      if (pendingAccountCommits.has(account.id) && !await confirmAccountCommit(account)) return json(res, 503, { error: '服务器存档尚未确认，请稍后重试' })
      advanceAccount(account)
      if (typeof body.reportId !== 'string' || !body.reportId || !Number.isSafeInteger(body.baseRevision)) return json(res, 400, { error: '报告或版本无效' })
      if (body.baseRevision !== account.revision) { await sendJson(409, { error: '存档已变化，请刷新报告', revision: account.revision, game: publicGame(account) }, true); return }
      const game = structuredClone(account.game)
      const marketReport = game.scoutReports?.find(r => r.id === body.reportId)?.source === 'market'
      const outcome = deleteScoutReport(game, body.reportId, now())
      if (!outcome.ok) { await sendJson(400, { error: outcome.error, revision: account.revision, game: publicGame(account) }, true); return }
      account.game = game
      accountSync.delete(account)
      account.revision++
      account.lastUserRevision = account.revision
      account.updatedAt = now()
      pendingAccountCommits.set(account.id, Symbol('scouting-delete-commit'))
      persistAccount(account)
      if (!await confirmAccountCommit(account)) return json(res, 503, { error: '服务器保存失败，操作状态未确认，请稍后刷新存档检查' })
      broadcast(account, String(req.headers['x-fm-client'] ?? '').slice(0, 128))
      if (marketReport) syncMarketVisibility()
      await sendJson(200, { ok: true, revision: account.revision, game: publicGame(account), serverTime: now() }, true)
      return
    }

    if (url.pathname === '/api/scouting/start' && req.method === 'POST') {
      const body = await readJsonBody(req)
      if (pendingAccountCommits.has(account.id) && !await confirmAccountCommit(account)) return json(res, 503, { error: '服务器存档尚未确认，请稍后重试' })
      advanceAccount(account)
      const { playerId, source, clubId, level } = body
      if (typeof playerId !== 'string' || !playerId.trim() || !['club', 'transfer', 'market'].includes(String(source)) ||
          (clubId !== undefined && (typeof clubId !== 'string' || !clubId.trim())) ||
          ((source === 'club' || source === 'transfer') && (typeof clubId !== 'string' || !clubId.trim())) ||
          (source === 'market' && clubId !== undefined)) {
        return json(res, 400, { error: '球探目标无效' })
      }
      const id = typeof clubId === 'string' ? clubId.trim() : undefined
      let player: Player | undefined
      if (source === 'club') {
        if (id !== ownedClubId(account) && sharedWorld.world.clubs.some(club => club.id === id)) {
          const owner = id && sharedWorld.owners[id]
          player = owner ? db.accounts.find(other => other.id === owner)?.game.roster.find(p => p.id === playerId) : sharedWorld.teams?.[id!]?.players.find(p => p.id === playerId)
        }
      } else if (source === 'transfer') {
        const offer = aiTransferOffers(transferSnapshot(account)).find(item => item.team.id === id && item.player.id === playerId)
        if (offer && id !== ownedClubId(account) && !db.accounts.some(other => other.game.roster.some(p => p.id === playerId))) player = untrainedPlayer(offer.player)
      } else {
        settleDueAuctions()
        const t = now()
        const candidate = market.pool.find(p => p.id === playerId)
        if (candidate && (market.auctions.some(a => a.playerId === playerId && a.endsAt > t) || sharedAvailable(candidate, t))) player = untrainedPlayer(candidate)
      }
      if (!player || account.game.roster.some(p => p.id === playerId)) return json(res, 400, { error: '球员不在指定的球探目标中' })
      const fee = SCOUT_LEVELS.find(item => item.level === level)?.fee
      if (fee !== undefined && economyOf(account.game).balance - committedFunds(market.auctions, account.id) < fee) {
        return json(res, 400, { error: '可用余额不足，其他领先的竞拍已占用部分资金' })
      }
      const game = structuredClone(account.game)
      const outcome = startScouting(game, player, { source: source as 'club' | 'transfer' | 'market', ...(id ? { clubId: id } : {}) }, level, now())
      if (!outcome.ok) { await sendJson(400, { error: outcome.error, revision: account.revision, game: publicGame(account) }, true); return }
      // Scope IDs to the authoritative account; world seeds and clocks can be shared.
      if (outcome.report) outcome.report.id = `scout-${account.id}-${outcome.report.id}`
      account.game = game
      accountSync.delete(account)
      account.revision++
      account.lastUserRevision = account.revision
      account.updatedAt = now()
      pendingAccountCommits.set(account.id, Symbol('scouting-commit'))
      persistAccount(account)
      if (!await confirmAccountCommit(account)) return json(res, 503, { error: '服务器保存失败，操作状态未确认，请稍后刷新存档检查' })
      broadcast(account, String(req.headers['x-fm-client'] ?? '').slice(0, 128))
      if (source === 'market') syncMarketVisibility()
      // Never return outcome.report: it contains the complete, private snapshot.
      await sendJson(200, { ok: true, revision: account.revision, game: publicGame(account), serverTime: now() }, true)
      return
    }

    if (url.pathname === '/api/youth/action' && req.method === 'POST') {
      const body = await readJsonBody(req)
      if (pendingAccountCommits.has(account.id) && !await confirmAccountCommit(account)) return json(res, 503, { error: '服务器存档尚未确认，请稍后重试' })
      advanceAccount(account)
      if (!Number.isSafeInteger(body.baseRevision) || body.baseRevision !== account.revision) { await sendJson(409, { error: '青训状态已变化，请刷新后重试', revision: account.revision, game: publicGame(account) }, true); return }
      const game = structuredClone(account.game)
      const outcome = applyYouthAction(game, body, now(), officialLineupLocked(account, now()) || !!liveMatchFor(account))
      if (!outcome.ok) { await sendJson(400, { error: outcome.error, revision: account.revision, game: publicGame(account) }, true); return }
      account.game = game
      accountSync.delete(account)
      account.revision++
      account.lastUserRevision = account.revision
      account.updatedAt = now()
      pendingAccountCommits.set(account.id, Symbol('youth-commit'))
      persistAccount(account)
      if (!await confirmAccountCommit(account)) return json(res, 503, { error: '服务器保存尚未确认，请刷新检查，勿重复操作' })
      publishClub(account)
      broadcast(account, String(req.headers['x-fm-client'] ?? '').slice(0, 128))
      await sendJson(200, { ...outcome, revision: account.revision, game: publicGame(account), serverTime: now() }, true)
      return
    }

    if (['/api/cards/recycle', '/api/cards/lock', '/api/training/start', '/api/shop/buy'].includes(url.pathname) && req.method === 'POST') {
      const body = await readJsonBody(req)
      if (pendingAccountCommits.has(account.id) && !await confirmAccountCommit(account)) return json(res, 503, { error: '服务器存档尚未确认，请稍后重试' })
      advanceAccount(account)
      // No await between reading the current account and committing: concurrent requests
      // are serialized by the event loop. Work on a clone because domain actions may mutate
      // (and call saveGame) even before returning an error.
      const game = structuredClone(account.game)
      let outcome: { ok: boolean; error?: string }
      if (url.pathname === '/api/cards/recycle') {
        if (!Array.isArray(body.cardIds) || !body.cardIds.every(id => typeof id === 'string') || !Number.isSafeInteger(body.baseRevision)) return json(res, 400, { error: '球员卡列表或预览版本无效' })
        if (body.baseRevision !== account.revision) { await sendJson(409, { error: '存档已变化，请重新预览球员卡', revision: account.revision, game: publicGame(account) }, true); return }
        outcome = recyclePlayerCards(game, body.cardIds as string[])
        if (outcome.ok) {
          const privateGame = game as GameState & { recycledCardIds?: string[] }
          privateGame.recycledCardIds = [...new Set([...(privateGame.recycledCardIds ?? []), ...body.cardIds as string[]])]
        }
      } else if (url.pathname === '/api/cards/lock') {
        if (typeof body.cardId !== 'string' || !body.cardId || typeof body.locked !== 'boolean') return json(res, 400, { error: '球员卡或锁定状态无效' })
        outcome = setCardRecycleLock(game, body.cardId, body.locked)
      } else if (url.pathname === '/api/shop/buy') {
        if (typeof body.skillId !== 'string' || !body.skillId) return json(res, 400, { error: '技能书 ID 无效' })
        outcome = buyShopBook(game, body.skillId)
      } else {
        if (typeof body.playerId !== 'string' || !body.playerId || !Array.isArray(body.bookKeys) || !body.bookKeys.every(key => typeof key === 'string') || typeof body.points !== 'number') return json(res, 400, { error: '培养参数无效' })
        outcome = startTrainingWithSupport(game, body.playerId, undefined, body.bookKeys as string[], body.points as number, false)
      }
      if (!outcome.ok) { await sendJson(400, { error: outcome.error, revision: account.revision, game: publicGame(account) }, true); return }
      account.game = game
      accountSync.delete(account)
      account.revision++
      account.lastUserRevision = account.revision
      account.updatedAt = now()
      pendingAccountCommits.set(account.id, Symbol('recycling-commit'))
      persistAccount(account)
      // 确认前等待 SQLite 事务：卡片、点数、培养快照和防重账本一起落盘。
      if (!await confirmAccountCommit(account)) {
        return json(res, 503, { error: '服务器保存失败，操作状态未确认，请稍后刷新存档检查' })
      }
      broadcast(account, String(req.headers['x-fm-client'] ?? '').slice(0, 128))
      await sendJson(200, { ...outcome, revision: account.revision, game: publicGame(account), serverTime: now() }, true)
      return
    }

    if (url.pathname === '/api/peak/start' && req.method === 'POST') {
      const body = await readJsonBody(req)
      advanceAccount(account)
      if (!account.game.activeMatch && liveMatchFor(account)) { await sendJson(400, { error: '联赛直播期间不能开始巅峰挑战', revision: account.revision, game: publicGame(account), serverTime: now() }, true); return }
      const outcome = startPeakChallenge(account.game, Number(body.stage), now())
      if (!outcome.ok) { await sendJson(400, { error: outcome.error, revision: account.revision, game: publicGame(account), serverTime: now() }, true); return }
      account.revision++
      account.lastUserRevision = account.revision
      account.updatedAt = now()
      persistAccount(account)
      broadcast(account, String(req.headers['x-fm-client'] ?? '').slice(0, 128))
      await sendJson(200, { ok: true, revision: account.revision, game: publicGame(account), serverTime: now() }, true)
      return
    }

    if (url.pathname === '/api/match/action' && req.method === 'POST') {
      const body = await readJsonBody(req)
      if (!['start_league', 'set_match_tactics', 'set_match_auto_subs', 'substitute'].includes(String(body.action))) return json(res, 400, { error: '不支持的比赛操作' })
      if (body.action === 'start_league') return json(res, 400, { error: '联赛由服务器提前排队计算、开球 10 分钟后统一公布，不需要手动开赛' })
      advanceAccount(account)
      if (body.action !== 'start_league' && !account.game.activeMatch?.context.isLeague) return json(res, 400, { error: '当前没有进行中的联赛' })
      const outcome = applyAgentAction(account.game, body, now())
      if (outcome.ok) {
        account.revision++
        account.updatedAt = now()
        persistAccount(account)
        broadcast(account, String(req.headers['x-fm-client'] ?? '').slice(0, 128))
      }
      await sendJson(outcome.ok ? 200 : 400, { ...outcome, revision: account.revision, game: publicGame(account) }, true)
      return
    }

    if (url.pathname === '/api/game' && req.method === 'PUT') {
      const body = await readJsonBody(req)
      if (pendingAccountCommits.has(account.id) && !await confirmAccountCommit(account)) return json(res, 503, { error: '服务器存档尚未确认，请稍后重试' })
      advanceAccount(account)
      // 还没刷新的旧页面可能交上来 7 人制的存档：按同样的规则迁移（补出来的人和服务器上的一模一样）。
      if (body.game && typeof body.game === 'object') upgradeElevenASide(body.game as GameState)
      // 开赛前 30 分钟锁阵容：只拦阵容 / 自动换人，训练、转会、经济等其它改动照常保存。
      if (officialLineupLocked(account, now())) {
        const incoming = body.game as GameState | undefined
        const lineupChanged = !deepEqual(incoming?.lineup ?? null, account.game.lineup)
        const subsChanged = !deepEqual(incoming?.autoSubs ?? null, account.game.autoSubs ?? null)
        if (lineupChanged || subsChanged) {
          return json(res, 409, { error: '阵容已锁定：开赛前 30 分钟内不能修改，比赛由服务器自动结算' })
        }
      }
      const baseRevision = Number(body.baseRevision)
      // 客户端基于“最后一次玩家保存”之后的版本都算安全：中间的 revision 增长来自服务器
      // （AI 训练、共享赛程、自动结算），保存后服务端会重新拉取这些共享数据。
      const serverAdvanced = baseRevision >= (account.lastUserRevision ?? account.revision)
      const onlyLeagueProgress = account.game.activeMatch?.context.isLeague && serverAdvanced && baseRevision < account.revision
      if (!Number.isInteger(baseRevision) || baseRevision > account.revision || (baseRevision !== account.revision && !serverAdvanced && !onlyLeagueProgress)) {
        await sendJson(409, { error: '存档已在另一设备更新', revision: account.revision, game: publicGame(account) }, true)
        return
      }
      if (!isGameState(body.game)) return json(res, 400, { error: '无效的游戏存档' })
      if (!body.game.training || typeof body.game.training !== 'object' || Array.isArray(body.game.training) || Object.values(body.game.training).some(session => session != null && (typeof session !== 'object' || Array.isArray(session)))) return json(res, 400, { error: '无效的培养状态' })
      preservePositionProfiles(account.game, body.game)
      const youthError = preserveYouthState(account.game, body.game, now())
      if (youthError) { await sendJson(400, { error: youthError, revision: account.revision, game: publicGame(account) }, true); return }
      if (account.game.shared) body.game.reserveStars = account.game.reserveStars
      // The private ledger lives in game_json so it is committed atomically with the
      // balance. Never trust a ledger supplied by the client.
      const previousPrivate = account.game as GameState & { recycledCardIds?: string[] }
      const incomingPrivate = body.game as GameState & { recycledCardIds?: string[] }
      const recycled = previousPrivate.recycledCardIds ?? []
      const recycledIds = new Set(recycled)
      if ((body.game.cards ?? []).some(card => recycledIds.has(card.id))) { await sendJson(409, { error: '存档包含已回收的球员卡，请重新加载', revision: account.revision, game: publicGame(account) }, true); return }
      incomingPrivate.recycledCardIds = [...recycled]
      body.game.scoutReports = structuredClone(account.game.scoutReports)
      ;(body.game as GameState & { scoutReportSeq?: number }).scoutReportSeq = (account.game as GameState & { scoutReportSeq?: number }).scoutReportSeq
      body.game.trainingPoints = account.game.trainingPoints
      body.game.shop = structuredClone(account.game.shop)
      body.game.cardSeq = Math.max(body.game.cardSeq ?? 0, account.game.cardSeq ?? 0)
      const oldCards = new Map((account.game.cards ?? []).map(card => [card.id, card]))
      for (const [id, session] of Object.entries(body.game.training)) {
        if (!session) continue
        const previous = account.game.training[id]
        const same = previous && session.playerId === previous.playerId && session.seed === previous.seed && session.startedAt === previous.startedAt
        session.qualityBonusPoints = same && [0, 10, 20, 30].includes(previous.qualityBonusPoints ?? 0) ? previous.qualityBonusPoints : 0
      }
      if (body.game.activeMatch?.preplayed && !account.game.activeMatch) delete body.game.activeMatch
      const peakError = validatePeakSave(account.game, body.game)
      if (peakError) { await sendJson(409, { error: peakError, revision: account.revision, game: publicGame(account) }, true); return }
      const legacyCupError = sharedWorld.world.seasonCupMode ? validateLegacyCupSave(account.game, body.game) : undefined
      if (legacyCupError) { await sendJson(409, { error: legacyCupError, revision: account.revision, game: publicGame(account) }, true); return }
      // 比赛公布会改变收入、球迷、市场等：不能把公布前的整份旧经济覆盖回去。
      // 这种少见的并发保存需要客户端重新加载权威存档，而不是静默丢失服务器结算。
      if (body.game.economy && account.game.economy && body.game.economy.lastIncomeRound < account.game.economy.lastIncomeRound) {
        await sendJson(409, { error: '存档已在另一设备更新：比赛已结算，请重新加载', revision: account.revision, game: publicGame(account) }, true)
        return
      }
      // 旧页面再次保存时也不能把已取消的新账号准备期带回来。
      if (body.game.settings) delete (body.game.settings as { autoSettle?: unknown }).autoSettle
      const assignedId = ownedClubId(account)
      if ((assignedId && body.game.world?.clubs.find((club) => club.id === 'player')?.squadKey !== assignedId) || (body.game.world && (body.game.seed !== account.game.seed || body.game.world.seasonIndex !== sharedWorld.world.seasonIndex || body.game.season.index !== sharedWorld.world.seasonIndex))) {
        return json(res, 400, { error: '联机账号不能替换共享世界或接管其他球队' })
      }
      if (body.game.injuries !== undefined && (!body.game.injuries || typeof body.game.injuries !== 'object' || Array.isArray(body.game.injuries) || Object.values(body.game.injuries).some((time) => typeof time !== 'number' || !Number.isFinite(time) || time < 0))) return json(res, 400, { error: '无效的伤病状态' })
      if (body.game.autoSubs !== undefined) {
        const errors = validateAutoSubPlan(body.game.roster, body.game.lineup, body.game.autoSubs)
        if (errors.length) return json(res, 400, { error: `自动换人规则无效：${errors.join('；')}` })
      }
      if (body.game.lineup.tacticalStyle !== undefined && !isStyleId(body.game.lineup.tacticalStyle)) {
        return json(res, 400, { error: `未知战术风格：${String(body.game.lineup.tacticalStyle)}` })
      }
      if (body.game.lineup.tacticalInstructions !== undefined) {
        const check = tryValidateInstructions(body.game.lineup.tacticalInstructions)
        if (!check.ok) return json(res, 400, { error: `战术指令无效：${check.error}` })
      }
      if (body.game.lineup.matchPlan !== undefined && !isMatchPlanId(body.game.lineup.matchPlan)) {
        return json(res, 400, { error: `未知比赛计划：${String(body.game.lineup.matchPlan)}` })
      }
      for (const preset of body.game.lineup.presets ?? []) {
        if (preset?.lineup?.tacticalStyle !== undefined && !isStyleId(preset.lineup.tacticalStyle)) {
          return json(res, 400, { error: `预设“${preset.name}”战术风格无效` })
        }
        if (preset?.lineup?.tacticalInstructions !== undefined) {
          const check = tryValidateInstructions(preset.lineup.tacticalInstructions)
          if (!check.ok) return json(res, 400, { error: `预设“${preset.name}”战术指令无效：${check.error}` })
        }
        if (preset?.lineup?.matchPlan !== undefined && !isMatchPlanId(preset.lineup.matchPlan)) {
          return json(res, 400, { error: `预设“${preset.name}”比赛计划无效` })
        }
      }
      if (account.game.activeMatch?.context.isLeague) {
        body.game.activeMatch = account.game.activeMatch
      } else if (body.game.activeMatch?.context.isLeague) {
        // 直播回放是服务器下发的副本，旧页面原样存回来时直接丢掉；其他联赛进度一律拒绝。
        if (!body.game.activeMatch.preplayed) return json(res, 400, { error: '联赛必须由服务器开始' })
        delete body.game.activeMatch
      }
      // 联赛赛程、比分和战报只由服务器产生；旧页面保存不能回滚已赛结果、伪造未来比分或重踢。
      body.game.season = account.game.season
      body.game.matchHistory = account.game.matchHistory
      // 正式杯赛战报与荣誉由服务器发布；旧客户端不能伪造或覆盖。精简模式上传的延迟摘要恢复服务器完整战报。
      const previousChallengesById = new Map(account.game.challengeHistory.map(item => [item.id, item]))
      const officialRecords = account.game.challengeHistory.filter(item => item.cupId?.startsWith('season-'))
      const restoredChallenges = (body.game.challengeHistory ?? [])
        .filter(item => !item.cupId?.startsWith('season-'))
        .map(item => {
          if (item.detailDeferred) {
            const existing = previousChallengesById.get(item.id)
            if (existing) return existing
            const cleaned = { ...item }
            delete cleaned.detailDeferred
            return cleaned
          }
          return item
        })
      body.game.challengeHistory = [...restoredChallenges, ...officialRecords].sort((a, b) => b.createdAt - a.createdAt)
      if (body.game.world && account.game.world) body.game.world = account.game.world
      // 联机改名只能走 /api/club/rename（要查重名和字数），普通保存不能顺手改掉。
      if (body.game.world) body.game.clubName = account.game.clubName
      // 伤病是服务器记录的：旧客户端根本不知道这个字段，保存时清空也不能把已知伤病抹掉。
      body.game.injuries = { ...(body.game.injuries ?? {}), ...(account.game.injuries ?? {}) }
      upgradeLegacySignatures(body.game)
      ensureCards(body.game)
      // The frozen pool belongs to this account/season, not to a client upload or the live world.
      if (account.game.pve?.cupSeason) {
        body.game.pve = { ...(body.game.pve ?? account.game.pve), cupSeason: account.game.pve.cupSeason }
      }
      if (body.game.pve) delete body.game.pve.cupSeasonDeferred
      ensurePve(body.game, cupOpeningTeams())
      if (body.game.pve && account.game.pve) {
        const officialTrophies = account.game.pve.trophies.filter(item => item.cupId.startsWith('season-'))
        body.game.pve.trophies = [...(body.game.pve.trophies ?? []).filter(item => !item.cupId.startsWith('season-')), ...officialTrophies]
        body.game.pve.seasonCupGoldClaims = { ...(account.game.pve.seasonCupGoldClaims ?? {}) }
        body.game.pve.seasonCupGoldVersion = account.game.pve.seasonCupGoldVersion
        const owned = account.game.pve.cupCeilingClaims ?? {}
        body.game.pve.cupCeilingClaims = { ...(body.game.pve.cupCeilingClaims ?? {}), ...owned }
        if (!owned.cross) delete body.game.pve.cupCeilingClaims.cross
        if (!owned.legend) delete body.game.pve.cupCeilingClaims.legend
        ensureCupCeilingClaims(body.game)
      }
      preservePeakAttempts(account.game, body.game)
      upgradeNames(body.game)
      upgradeStarTraits(body.game)
      upgradeBurstAttr(body.game)
      // 成品卡属性、技能和锁定状态以服务器为准；普通存档只能改卡名。
      // 放在旧档升级之后，避免把服务器已经升级的属性再升级一次。
      // 新培养卡仍来自现有客户端培养流程，完整培养模拟尚不是服务器权威。
      if (body.game.cards) body.game.cards = body.game.cards.map((card) => {
        const old = oldCards.get(card.id)
        if (!old) return card
        const preserved = { ...old, customName: card.customName }
        if (card.customName === undefined) delete preserved.customName
        return preserved
      })
      // Cards are authoritative for existing builds; migrate after restoring them so
      // missing equipped copies are recovered from the canonical card.
      migratePositionProfiles(body.game, false)
      economyOf(body.game)
      // 其他教练的球员不能从 AI 购买入口直接转走。
      const incomingGame: GameState = body.game
      const previousRoster = new Set(account.game.roster.map((player) => player.id))
      if (signsFromOtherCoach(account, previousRoster, incomingGame)) {
        return json(res, 400, { error: '不能从其他玩家执教的球队直接买人' })
      }
      // 从 AI 球队买人必须走 /api/transfer/ai-buy（要过俱乐部的放人规则），普通保存不能直接把人加进来。
      const canonicalAI = new Set(Object.values(sharedWorld.teams ?? {}).flatMap((team) => team.players.map((player) => player.id)))
      if (incomingGame.roster.some((player) => canonicalAI.has(player.id) && !previousRoster.has(player.id))) {
        return json(res, 400, { error: '从 AI 球队买人请通过转会谈判（页面可能需要刷新）', revision: account.revision, game: publicGame(account) })
      }
      // 报价、出场记录、球员的不满都以服务器为准。
      incomingGame.transferOffers = account.game.transferOffers
      incomingGame.appearances = account.game.appearances
      incomingGame.suspensions = account.game.suspensions
      incomingGame.yellowCounts = account.game.yellowCounts
      // 技能书永不消耗：服务器联赛掉落的书不能被尚未刷新的旧页面保存覆盖掉；传奇杯首冠专属彩书《传奇之星》只能由服务器权威发放，防客户端伪造。
      const hadLegendStar = (account.game.legendBooks ?? []).some((book) => book.id === LEGEND_STAR_BOOK_ID)
      if (!hadLegendStar && incomingGame.legendBooks?.length) {
        incomingGame.legendBooks = incomingGame.legendBooks.filter((book) => book.id !== LEGEND_STAR_BOOK_ID)
      }
      const bookKeys = new Set((incomingGame.legendBooks ?? []).map((book) => `${book.id}:${book.tier}`))
      const serverBooks = (account.game.legendBooks ?? []).filter((book) => !bookKeys.has(`${book.id}:${book.tier}`))
      if (serverBooks.length) incomingGame.legendBooks = [...(incomingGame.legendBooks ?? []), ...serverBooks]
      for (const player of incomingGame.roster) {
        const known = account.game.roster.find((item) => item.id === player.id)
        // 联机比赛体能由已发布的服务器结果决定；旧页面不能把赛后体能恢复成赛前值。
        if (known && sharedWorld.matchBook!.conditionAt[player.id] !== undefined) player.condition = known.condition
        // 体能恢复由服务器每小时结算，页面不能改结算时间。
        if (known) player.recoveryAt = known.recoveryAt
        else delete player.recoveryAt
        if (known?.unhappy) player.unhappy = known.unhappy
        else delete player.unhappy
      }
      account.game = body.game
      accountSync.delete(account)
      observeYouthFacility(account.game, now())
      pullSharedTeams(account)
      publishClub(account)
      absorbInto(account)
      pullSharedFixtures(account)
      pullSharedWorld(account)
      account.revision++
      account.lastUserRevision = account.revision
      account.updatedAt = now()
      persistAccount(account)
      broadcast(account, String(req.headers['x-fm-client'] ?? '').slice(0, 128))
      json(res, 200, { ok: true, revision: account.revision, updatedAt: account.updatedAt })
      return
    }

    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const body = await readJsonBody(req)
      const sent = postChat(account, body.text)
      if (!sent.ok) return json(res, sent.status, { error: sent.error })
      json(res, 200, { ok: true, message: sent.message, messages: chatMessages, serverTime: now() })
      return
    }

    if (url.pathname === '/api/events' && req.method === 'GET') {
      openEvents(req, res, account, url)
      return
    }

    json(res, 404, { error: '接口不存在' })
  }

  function parseEventRevision(value: string | string[] | null | undefined): number | undefined {
    const raw = Array.isArray(value) ? value[0] : value
    if (!raw) return undefined
    const parsed = Number(raw.trim())
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
  }

  function openEvents(req: IncomingMessage, res: ServerResponse, account: Account, url: URL): void {
    const sink = createSseSink(req, res)
    let group = clients.get(account.id)
    if (!group) {
      group = new Set()
      clients.set(account.id, group)
    }
    const client: EventClient = {
      res,
      sink,
      id: url.searchParams.get('client') ?? '',
      lazyCup: url.searchParams.get('lazyCup') === '1',
      slim: url.searchParams.get('slim') === '1',
      delta: url.searchParams.get('delta') === '1',
      lastRevision: 0,
      lastDigest: null,
      queue: Promise.resolve(),
      pendingBroadcast: null,
      closed: false,
    }
    group.add(client)
    const clientRev = parseEventRevision(req.headers['last-event-id']) ?? parseEventRevision(url.searchParams.get('sinceRevision'))
    const hasLiveParam = url.searchParams.get('hasLive')

    enqueueClientTask(client, async () => {
      if (client.closed || client.sink.isClosed()) return
      client.sink.writeRaw('retry: 3000\n\n')
      const projected = projectGame(account, { lazyCup: client.lazyCup, slim: client.slim })
      const coaches = clubCoaches()
      const serverTime = now()
      const rev = account.revision

      if (client.delta && clientRev !== undefined && clientRev === rev) {
        const digest = digestGameSections(projected, fastSectionTokens(account, client.slim))
        client.lastRevision = rev
        client.lastDigest = digest
        if (projected.activeMatch && hasLiveParam === '0') {
          await client.sink.writeEventAsync(
            rev,
            { type: 'state-patch', baseRevision: rev, revision: rev, clubCoaches: coaches, serverTime, patch: { activeMatch: projected.activeMatch } },
            memoryMonitor.isUnderPressure,
          )
        } else if (!projected.activeMatch && hasLiveParam === '1') {
          client.sink.writeRaw(`id: ${rev}\ndata: ${JSON.stringify({ type: 'state-patch', baseRevision: rev, revision: rev, clubCoaches: coaches, serverTime, patch: {}, remove: ['activeMatch'] })}\n\n`)
        } else {
          client.sink.writeRaw(`id: ${rev}\ndata: ${JSON.stringify({ type: 'state-sync', revision: rev, clubCoaches: coaches, serverTime })}\n\n`)
        }
      } else if (client.delta && clientRev !== undefined && memoryMonitor.isUnderPressure()) {
        client.lastRevision = rev
        client.lastDigest = null
        client.sink.writeRaw(`id: ${rev}\ndata: ${JSON.stringify({ type: 'state-stale', revision: rev, clubCoaches: coaches, serverTime })}\n\n`)
      } else {
        if (client.delta) {
          client.lastDigest = digestGameSections(projected, fastSectionTokens(account, client.slim))
          client.lastRevision = rev
        }
        await client.sink.writeEventAsync(
          rev,
          { type: 'state', revision: rev, clubCoaches: coaches, serverTime, game: projected },
          memoryMonitor.isUnderPressure,
        )
      }
      if (client.closed || client.sink.isClosed()) return
      client.sink.writeRaw(`data: ${JSON.stringify(marketPayload())}\n\n`)
      client.sink.writeRaw(`data: ${JSON.stringify(chatSnapshotPayload())}\n\n`)
    })

    const heartbeat = setInterval(() => {
      touchAccountOnline(account)
      sendClientRaw(client, ': ping\n\n')
    }, 15_000)
    const cleanup = () => {
      if (client.closed) return
      client.closed = true
      clearInterval(heartbeat)
      group!.delete(client)
      if (group!.size === 0) {
        clients.delete(account.id)
        touchAccountOnline(account, true)
      }
    }
    req.on('close', cleanup)
    res.on('close', cleanup)
  }

  function createSession(accountId: string): string {
    const token = crypto.randomBytes(32).toString('hex')
    sessions[token] = accountId
    accountStore.setSession(token, accountId)
    return token
  }

  function createAgentToken(): string {
    return `fm_${crypto.randomBytes(24).toString('hex')}`
  }

  const COMPRESSIBLE_EXTS = new Set(['.html', '.js', '.css', '.json', '.svg'])
  function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL): void {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' })
    const pathname = decodeURIComponent(url.pathname)
    const requested = pathname === '/' ? '/index.html' : pathname
    const filePath = path.resolve(staticDir, `.${requested}`)
    if (!filePath.startsWith(staticDir + path.sep) && filePath !== path.join(staticDir, 'index.html')) {
      json(res, 403, { error: 'Forbidden' })
      return
    }
    let target = filePath
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      target = path.join(staticDir, 'index.html')
    }
    if (!fs.existsSync(target)) {
      json(res, 503, { error: '前端尚未构建，请先运行 npm run build' })
      return
    }
    const ext = path.extname(target).toLowerCase()
    const type = CONTENT_TYPES[ext] ?? 'application/octet-stream'
    const stat = fs.statSync(target)
    const encoding = COMPRESSIBLE_EXTS.has(ext) && stat.size >= 1024 ? negotiateEncoding(req.headers['accept-encoding']) : null
    const headers: Record<string, string> = {
      'Content-Type': type,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      Vary: 'Accept-Encoding',
      ...(encoding ? { 'Content-Encoding': encoding } : {}),
    }
    res.writeHead(200, headers)
    if (req.method === 'HEAD') { res.end(); return }
    const fileStream = fs.createReadStream(target)
    fileStream.on('error', () => { if (!res.destroyed) res.destroy() })
    if (encoding === 'br') {
      const compressor = zlib.createBrotliCompress({
        params: {
          [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
          [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
          [zlib.constants.BROTLI_PARAM_LGWIN]: 18,
        },
      })
      compressor.on('error', () => { if (!res.destroyed) res.destroy() })
      res.once('close', () => { if (!compressor.destroyed) compressor.destroy(); fileStream.destroy() })
      fileStream.pipe(compressor).pipe(res)
    } else if (encoding === 'gzip') {
      const compressor = zlib.createGzip({ level: 4, memLevel: 6 })
      compressor.on('error', () => { if (!res.destroyed) res.destroy() })
      res.once('close', () => { if (!compressor.destroyed) compressor.destroy(); fileStream.destroy() })
      fileStream.pipe(compressor).pipe(res)
    } else {
      res.once('close', () => fileStream.destroy())
      fileStream.pipe(res)
    }
  }

  async function runMatchQueue(): Promise<void> {
    if (closed) return
    const changed = advanceSharedWorld()
    await matchQueue.pump(now())
    if (closed) return
    const published = matchScheduler.refresh(now())
    // 空闲或仅在提前计算时，不必每秒复制所有账号的整份存档。
    if (changed || published) {
      withDeferredWorldPersist(() => {
        for (const account of db.accounts) advanceAccount(account)
      })
    }
    announceLiveMatches()
    autoRollSharedSeason()
    autoPlayoff()
  }

  const server = http.createServer((req, res) => void handle(req, res))
  const timer = tickMs > 0
    ? setInterval(() => {
        advanceAllMatches()
        autoRollSharedSeason()
        autoPlayoff()
        aiAuctionTick()
      }, tickMs)
    : null
  timer?.unref?.()
  const matchTimer = tickMs > 0 ? setInterval(() => {
    for (const account of db.accounts) if (account.game.activeMatch?.context.isLeague) advanceAccount(account)
    settleDueAuctions()
  }, 1000) : null
  matchTimer?.unref?.()
  const jobTimer = tickMs > 0 ? setInterval(() => {
    void runMatchQueue().catch((error) => console.error('比赛队列推进失败', error))
  }, Math.min(1000, tickMs)) : null
  jobTimer?.unref?.()

  // 启动时恢复的是整个共享世界，而不是等账号注册 / 登录时再为它单独生成比分。
  cupOpeningTeams()
  advanceAllMatches()
  autoRollSharedSeason()
  autoPlayoff()
  flushWorldSync()
  accountStore.flushSync()

  let stopped: Promise<void> | null = null
  function stopServer(): Promise<void> {
    if (stopped) return stopped
    closed = true
    if (timer) clearInterval(timer)
    if (matchTimer) clearInterval(matchTimer)
    if (jobTimer) clearInterval(jobTimer)
    if (worldWriteTimer) { clearTimeout(worldWriteTimer); worldWriteTimer = null }
    matchQueue.close()
    for (const group of clients.values()) {
      for (const client of group) {
        client.closed = true
        client.sink.end()
      }
    }
    clients.clear()
    stopped = new Promise<void>((resolve) => server.close(() => resolve()))
    return stopped
  }

  return {
    server,
    flush: async () => {
      await accountStore.flush()
      await flushWorldAsync()
    },
    shutdown: async () => {
      await stopServer()
      if (worldWriteInFlight) await worldWriteInFlight.catch(() => {})
      flushWorldSync()
      accountStore.close()
    },
    close: () => {
      void stopServer()
      flushWorldSync()
      accountStore.close()
    },
    accountCount: () => db.accounts.length,
    runMatchQueue,
  }
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex')
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, value: unknown): void {
  writeJsonChunkedSync(file, value)
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > 8 * 1024 * 1024) throw new Error('请求体过大')
    chunks.push(buf)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function isPlayerCard(value: unknown): boolean {
  const card = value as PlayerCard
  return !!card
    && typeof card.id === 'string'
    && typeof card.playerId === 'string'
    && !!card.attrs && typeof card.attrs === 'object'
    && !!card.positions && typeof card.positions === 'object'
    && !!card.personality && typeof card.personality === 'object'
    && Array.isArray(card.skills)
}

function isGameState(value: unknown): value is GameState {
  const game = value as GameState
  return !!game
    && game.version === GAME_VERSION
    && Array.isArray(game.roster)
    && game.roster.length >= 10
    && !!game.lineup
    && Array.isArray(game.lineup.starters)
    && Array.isArray(game.lineup.bench)
    && Array.isArray(game.aiTeams)
    && Array.isArray(game.freeStars)
    && (game.cards === undefined || (Array.isArray(game.cards) && game.cards.every(isPlayerCard)))
    && !!game.season
    && Array.isArray(game.season.fixtures)
    && game.season.fixtures.every((fixture) => !!fixture && Number.isInteger(fixture.round) && fixture.round > 0 && typeof fixture.played === 'boolean')
    && Array.isArray(game.season.table)
    && game.season.table.length === 20
    && (game.world === undefined || (Array.isArray(game.world.clubs) && Array.isArray(game.world.divisions)))
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}
