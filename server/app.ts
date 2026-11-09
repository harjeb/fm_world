import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createInitialGame, GAME_VERSION, upgradeLegacySignatures } from '../src/game/state.ts'
import { ensureCards } from '../src/game/cards.ts'
import { upgradeBurstAttr, upgradeNames, upgradeSharedWorldNames, upgradeStarTraits } from '../src/game/names.ts'
import { advanceSharedAccountSeason, advanceWorldSeason, buildOwnerlessTeams, createOwnerlessWorld, createWorldGameFromWorld, computeWorldTable, ensureWorldCalendar, ownerlessWorldFromClub, pickFreeClubForNewAccount, expandWorldConference, ensurePromotionPlayoff, wageForPlayer, worldForClub, worldSlots, worldWageBill } from '../src/game/world.ts'
import { lineupLockState } from '../src/game/season.ts'
import type { AIClubState, AITeam, Player, WorldState } from '../src/game/types.ts'
import { caOf } from '../src/game/ca.ts'
import { refreshAILineup, refreshAILineups, repairLineup } from '../src/game/squad.ts'
import { displayCA, mainAttrsFor } from '../src/game/rating.ts'
import { GAME_DAY_MS, kickoffAtForRound, postseasonStartAt, roundsKickedOff, seasonEndAt } from '../src/game/calendar.ts'
import { settleCondition } from '../src/game/condition.ts'
import { splitSeed } from '../src/game/rng.ts'
import { awardRoundIncome, awardSeasonPrize, economyOf, matchPerformanceOf, payWageBill } from '../src/game/economy.ts'
import { advanceLeagueRealtime } from '../src/game/realtime.ts'
import { validateAutoSubPlan } from '../src/game/match/management.ts'
import type { GameState, PlayerCard } from '../src/game/types.ts'
import { absorbFreeAgents, aiClubIdOf, auctionRaiseFee, leadingBid, minimumBid, placeAIBid, placeBid, settleAuctions, type AIBidder, type Auction, type AuctionResult, type BidResult, type FreeMarket } from '../src/game/auction.ts'
import { isOnMarketToday } from '../src/game/market-window.ts'
import { lineupRating } from '../src/game/club-rating.ts'
import { AI_SQUAD_LIMIT, advanceAIClub, aiBidFor, createAIClub, playerValue, recordAISigning, seedAIClubs } from '../src/game/ai-club.ts'
import { agentView, applyAgentAction, playerView, type AgentOptions } from './agent.ts'
import { clubNameError, normalizeClubName } from '../src/game/club-name.ts'
import { SEASON_GOAL_LABELS, SQUAD_ROLE_LABELS, type SeasonGoal, type SquadRole } from '../src/game/negotiation.ts'
import { aiPoachRound, expireOffers, generateAIOffers, respondToOffer, type MarketClub } from '../src/game/transfers.ts'
import { marketDayOf, refreshFreeMarket } from '../src/game/free-market.ts'
import { migrateGameSchedule, migrateWorldSchedule } from '../src/game/schedule.ts'
import { aiBuysLeft, noteAIBuy } from '../src/game/transfer-rules.ts'
import { settleMarket, signClubPlayer } from '../src/game/market.ts'
import { elevenAITeam, upgradeElevenASide } from '../src/game/eleven.ts'
import { elevenFormationFor, isLegacyFormation } from '../src/game/data/formations.ts'
import { startChallengeWithOpponent } from '../src/game/actions.ts'
import { MatchQueue, type MatchQueueOptions } from './match-queue.ts'
import { MatchScheduler } from './match-scheduler.ts'
import { emptyMatchBook, matchJobId, recordForClub, type LockedTeam, type MatchBook } from './match-job.ts'

type Account = {
  id: string
  username: string
  salt: string
  passwordHash: string
  agentToken?: string
  game: GameState
  revision: number
  lastUserRevision?: number
  /** 已合并进本账号的公开比赛；和账号一起原子保存，重启不重复发钱/记战报。 */
  appliedMatchIds?: string[]
  /** 上一次给这个账号发 AI 报价的“赛季:轮次”，每轮最多发一次。 */
  offerKey?: string
  createdAt: number
  updatedAt: number
}

type Db = { accounts: Account[] }

type SharedWorld = {
  seed: number
  startedAt: number
  owners: Record<string, string>
  world: WorldState
  /** 全服唯一的球队名册；已接管球队的名单由教练存档同步回来。 */
  teams?: Record<string, AITeam>
  /** 全服共用的自由球员池，只有服务器能改。 */
  freeStars: Player[]
  reserveStars: Player[]
  auctions?: Auction[]
  auctionLog?: AuctionResult[]
  marketVersion?: number
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
}

type SessionMap = Record<string, string>

export type AppServer = {
  server: http.Server
  close: () => void
  accountCount: () => number
  /** 运维 / 测试驱动一次后台队列，仍受服务器时间和统一公布规则约束。 */
  runMatchQueue: () => Promise<void>
}

const SESSION_FILE = 'sessions.json'
const DB_FILE = 'accounts.json'
const WORLD_FILE = 'world.json'

export function createAppServer(options: AppServerOptions = {}): AppServer {
  const dataDir = path.resolve(options.dataDir ?? 'data')
  const staticDir = path.resolve(options.staticDir ?? 'dist')
  const now = options.now ?? Date.now
  const registrationMode: RegistrationMode = options.registration ?? 'open'
  const inviteCode = options.inviteCode?.trim() ?? ''
  const turnstileSecret = options.turnstileSecret?.trim() ?? ''
  const turnstileSiteKey = options.turnstileSiteKey?.trim() ?? ''
  const registerLimitPerHour = Math.max(0, Math.trunc(options.registerLimitPerHour ?? 0))
  /* 邀请码模式没配邀请码会锁死注册，直接报错，避免部署后没人能注册。 */
  if (registrationMode === 'invite' && !inviteCode) throw new Error('registration=invite 需要配置 inviteCode')
  fs.mkdirSync(dataDir, { recursive: true })

  const dbPath = path.join(dataDir, DB_FILE)
  const sessionPath = path.join(dataDir, SESSION_FILE)
  const worldPath = path.join(dataDir, WORLD_FILE)
  const db: Db = readJson<Db>(dbPath, { accounts: [] })
  const loadedWorld = readJson<Partial<SharedWorld> | null>(worldPath, null)
  const sharedWorld: SharedWorld = {
    seed: loadedWorld?.seed ?? crypto.randomInt(1, 0x7fffffff),
    // 全新世界从当前时间之后的固定开球点开始；已有世界沿用其赛程，不为注册补造比赛。
    startedAt: loadedWorld?.startedAt ?? kickoffAtForRound(now(), 1),
    owners: loadedWorld?.owners ?? {},
    world: loadedWorld?.world as WorldState,
    teams: loadedWorld?.teams,
    freeStars: loadedWorld?.freeStars ?? [],
    reserveStars: loadedWorld?.reserveStars ?? [],
    auctions: loadedWorld?.auctions ?? [],
    auctionLog: loadedWorld?.auctionLog ?? [],
    marketVersion: loadedWorld?.marketVersion ?? 1,
    aiClubs: loadedWorld?.aiClubs,
    aiRound: loadedWorld?.aiRound,
    matchBook: loadedWorld?.matchBook,
  }
  if (sharedWorld.world) ensureWorldCalendar(sharedWorld.world)
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
  // 一天一轮 → 一天两轮（北京时间 12:00、20:00）：共享世界和每个账号的赛季一起挪，当前该踢的轮次不变。
  {
    const at = now()
    let moved = migrateWorldSchedule(sharedWorld.world, at)
    for (const account of db.accounts) if (account.game && migrateGameSchedule(account.game, at)) moved = true
    if (moved) writeJson(dbPath, db)
  }
  // 7 人制 → 11 人制：先迁移每个账号（玩家球队补随机球员、换阵型），有教练的球队名单直接用账号里的新名单，
  // 其余 AI 球队各自补人、换阵型，世界里各队的阵型也一起换。迁移过一次之后这里什么都不做。
  {
    let accountsMigrated = false
    for (const account of db.accounts) {
      if (account.game && upgradeElevenASide(account.game)) accountsMigrated = true
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
    if (accountsMigrated) writeJson(dbPath, db)
  }
  // 以前 AI 买进来的球员没排进首发（只修“不合法”的阵容），一直坐在名单外：无主的 AI 球队按名单重排一次。
  // 有教练的球队阵容是教练自己排的，不动。
  refreshAILineups(Object.entries(sharedWorld.teams ?? {}).filter(([clubId]) => !sharedWorld.owners[clubId]).map(([, team]) => team))
  if (!sharedWorld.matchBook) {
    sharedWorld.matchBook = emptyMatchBook()
    for (const account of db.accounts) {
      Object.assign(sharedWorld.matchBook.injuries, account.game?.injuries)
      Object.assign(sharedWorld.matchBook.suspensions, account.game?.suspensions)
      Object.assign(sharedWorld.matchBook.yellowCounts, account.game?.yellowCounts)
      Object.assign(sharedWorld.matchBook.appearances, account.game?.appearances)
    }
  }
  writeJson(worldPath, sharedWorld)
  const persistWorld = () => writeJson(worldPath, sharedWorld)
  const matchQueue = new MatchQueue(path.join(dataDir, 'match-jobs'), options.matchQueue)
  const matchScheduler = new MatchScheduler(matchQueue, sharedWorld, lockedTeamFor, persistWorld)
  let closed = false
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
    persistWorld()
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
  const worldRound = () => Math.min(38, Math.max(0, roundsKickedOff(sharedWorld.world.seasonStartedAt, now())))
  /** 转会窗口：第 1–10 轮、20–30 轮（和账号里的 transferWindowOpen 一致）。 */
  const worldWindowOpen = () => {
    const round = worldRound()
    return round <= 10 || (round >= 20 && round <= 30)
  }
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
      advanceAIClub(state, club, team, rounds, splitSeed(sharedWorld.seed, `ai-advance-${club.id}-${round}`))
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
    const anchor = { world: sharedWorld.world, createdAt: sharedWorld.startedAt }
    const committed = market.auctions.reduce((sum, item) => (item.bids.length && leadingBid(item).accountId === `ai:${club.id}` ? sum + leadingBid(item).amount : sum), 0)
    const open = market.pool
      .filter((player) => !market.auctions.some((auction) => auction.playerId === player.id) && isOnMarketToday(anchor, player, nowMs))
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
    if (aiFeesChanged) persistWorld()
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
    const team = sharedWorld.teams?.[clubId]
    if (!team) return null
    const account = db.accounts.find((item) => item.id === sharedWorld.owners[clubId])
    const valid = account?.game.world?.clubs.find((club) => club.id === 'player')?.squadKey === clubId
    const game = valid ? account.game : undefined
    const injuries = { ...sharedWorld.matchBook!.injuries }
    for (const [id, until] of Object.entries(game?.injuries ?? {})) injuries[id] = Math.max(injuries[id] ?? 0, until)
    const bans = { ...sharedWorld.matchBook!.suspensions }
    for (const [id, ban] of Object.entries(game?.suspensions ?? {})) if (sharedWorld.matchBook!.conditionAt[id] === undefined) bans[id] = ban
    const conditions = new Map(team.players.map((player) => [player.id, player]))
    const withCondition = (player: Player): Player => {
      const shared = conditions.get(player.id)
      return shared ? { ...player, condition: shared.condition, recoveryAt: shared.recoveryAt } : { ...player }
    }
    return {
      team: game ? { ...team, name: game.clubName, players: game.roster.map(withCondition), lineup: game.lineup, formationId: game.lineup.formationId, tactics: game.lineup.tactics } : team,
      autoSubs: game ? game.autoSubs ?? { timed: [], staminaBelow: null, onInjury: false } : undefined,
      injuries,
      suspended: Object.entries(bans).filter(([, ban]) => ban.matches > 0).map(([id]) => id),
      medical: game ? economyOf(game).medical : sharedWorld.aiClubs?.[clubId]?.economy.medical ?? 1,
      // 锁定时还欠薪：这场只发挥一半。
      ...(game && matchPerformanceOf(game) < 1 ? { performance: matchPerformanceOf(game) } : {}),
      // 没有教练的电脑球队：开球时体能低于 80 的先休息（体能在入队时按开球时间结算）。
      ...(game ? {} : { ai: true }),
    }
  }

  function inheritedMatchIds(game: GameState, clubId: string): string[] {
    return game.season.fixtures.filter((fixture) => fixture.isPlayer && fixture.played).map((fixture) => fixture.matchId ?? matchJobId(game.season.index, game.season.divisionId!, {
      round: fixture.round, homeId: fixture.homeId === 'player' ? clubId : fixture.homeId, awayId: fixture.awayId === 'player' ? clubId : fixture.awayId,
    }))
  }

  /** 只合并已公开比赛的增量；不替换培养、球员卡、资金或设施的整份锁定快照。 */
  function syncPublishedMatches(account: Account): boolean {
    const clubId = ownedClubId(account)
    if (!clubId) return false
    const game = account.game
    const applied = new Set(account.appliedMatchIds ?? [])
    let changed = false
    let coachedMatch = false
    for (const fixture of game.season.fixtures.filter((item) => item.isPlayer && item.played).sort((a, b) => a.round - b.round)) {
      const id = fixture.matchId
      if (!id?.startsWith('q-') || applied.has(id) || !matchQueue.ready(id)) continue
      const { input, result } = matchQueue.read(id)
      if (input.kickoffAt > now()) continue
      const coached = input.kickoffAt > account.createdAt
      coachedMatch ||= coached
      if (coached && !game.matchHistory.some((record) => record.id === id)) game.matchHistory.unshift(recordForClub(input, result, clubId))
      const economy = economyOf(game)
      if (coached && fixture.round > economy.lastIncomeRound) {
        awardRoundIncome(game, fixture.round)
        // 先补欠薪再发本轮工资，钱不够的记成欠薪（欠薪期间球员只发挥一半，见 world.ts）。
        if (game.season.index > 1) payWageBill(economy, worldWageBill(game))
        settleMarket(game, fixture.round)
      }
      applied.add(id)
      changed = true
    }
    if (changed) {
      account.appliedMatchIds = [...applied]
      const live = new Map((sharedWorld.teams?.[clubId]?.players ?? []).map((player) => [player.id, player]))
      for (const player of game.roster) {
        const shared = live.get(player.id)
        if (!shared) continue
        player.condition = shared.condition
        player.recoveryAt = shared.recoveryAt
      }
      if (coachedMatch && game.season.finished) awardSeasonPrize(game)
    }
    const book = sharedWorld.matchBook!
    const ids = new Set([...game.roster, ...game.aiTeams.flatMap((team) => team.players)].map((player) => player.id))
    const before = JSON.stringify([game.injuries, game.suspensions, game.yellowCounts, game.appearances])
    for (const [id, until] of Object.entries(book.injuries)) (game.injuries ??= {})[id] = Math.max(game.injuries?.[id] ?? 0, until)
    for (const id of ids) {
      if (book.suspensions[id]) (game.suspensions ??= {})[id] = structuredClone(book.suspensions[id])
      else if (book.conditionAt[id] !== undefined) delete game.suspensions?.[id]
      if (book.yellowCounts[id] !== undefined) (game.yellowCounts ??= {})[id] = book.yellowCounts[id]
      if (book.appearances[id]) (game.appearances ??= {})[id] = [...book.appearances[id]]
    }
    return changed || before !== JSON.stringify([game.injuries, game.suspensions, game.yellowCounts, game.appearances])
  }

  /** 其他分区的赛程与积分同样以全服快照为准，不保留各账号各自抽象模拟的比分。 */
  function pullSharedWorld(account: Account): boolean {
    const clubId = ownedClubId(account)
    if (!clubId || !account.game.world || account.game.season.index !== sharedWorld.world.seasonIndex) return false
    if (account.game.world.clubs.find((club) => club.id === 'player')?.squadKey !== clubId) return false
    const canonical = worldForClub(sharedWorld.world, clubId)
    for (const player of market.pool) delete canonical.starAges[player.id]
    if (JSON.stringify(account.game.world) === JSON.stringify(canonical)) return false
    account.game.world = canonical
    return true
  }

  /** 账号只拥有自己的阵容；其他球队每次都从全服名册读取，禁止旧存档覆盖共享球队。 */
  function pullSharedFixtures(account: Account): boolean {
    const season = account.game.season
    const clubId = ownedClubId(account)
    const division = sharedWorld.world.divisions.find((item) => item.divisionId === season.divisionId && item.index === season.index)
    if (!clubId || !division) return false
    let changed = false
    for (const fixture of season.fixtures) {
      const mine = fixture.homeId === 'player' || fixture.awayId === 'player'
      const homeId = fixture.homeId === 'player' ? clubId : fixture.homeId
      const awayId = fixture.awayId === 'player' ? clubId : fixture.awayId
      const canonical = division.fixtures.find((item) => item.round === fixture.round && item.homeId === homeId && item.awayId === awayId)
      // 所有已赛结果都以全服为准，包括接管前的 AI 战绩和本账号自己的旧比分。
      // 仅保留旧版正在进行中的这一场，不让异步刷新中断比赛。
      if (mine && account.game.activeMatch?.context.isLeague && account.game.activeMatch.context.round === fixture.round) continue
      if (!canonical?.played || !canonical.score) continue
      const next = { ...fixture, ...canonical, homeId: fixture.homeId, awayId: fixture.awayId, isPlayer: mine,
        scorers: canonical.scorers?.map((item) => ({ ...item, teamId: item.teamId === clubId ? 'player' : item.teamId })),
        assisters: canonical.assisters?.map((item) => ({ ...item, teamId: item.teamId === clubId ? 'player' : item.teamId })),
      }
      if (JSON.stringify(next) === JSON.stringify(fixture)) continue
      Object.assign(fixture, next)
      changed = true
    }
    if (!account.game.activeMatch?.context.isLeague && season.round !== division.round) { season.round = division.round; changed = true }
    if (changed) {
      const names = new Map(account.game.world?.clubs.map((club) => [club.id, club.name]) ?? [])
      season.table = computeWorldTable(season.clubIds ?? [], season.fixtures, names)
      season.finished = season.fixtures.every((fixture) => fixture.played)
      season.champion = season.finished ? season.table[0]?.teamId ?? null : null
      season.playerFinish = season.finished ? season.table.findIndex((row) => row.teamId === 'player') + 1 : null
      const local = account.game.world?.divisions.find((item) => item.divisionId === season.divisionId)
      if (local) { local.fixtures = season.fixtures; local.table = season.table }
    }
    return changed
  }

  function pullSharedTeams(account: Account): boolean {
    const ids = account.game.season.clubIds ?? []
    const teams = ids.filter((id) => id !== 'player').map((id) => sharedWorld.teams?.[id]).filter((team): team is AITeam => !!team)
    if (teams.length !== ids.length - 1) return false
    let changed = false
    for (const team of teams) {
      const local = account.game.world?.clubs.find((club) => club.id === team.id)
      const shared = sharedWorld.world.clubs.find((club) => club.id === team.id)
      if (local && shared && JSON.stringify(local.starPlayerIds) !== JSON.stringify(shared.starPlayerIds)) {
        local.starPlayerIds = [...shared.starPlayerIds]
        changed = true
      }
      if (local && shared && local.name !== shared.name) { local.name = shared.name; changed = true }
    }
    if (JSON.stringify(account.game.aiTeams) !== JSON.stringify(teams)) {
      account.game.aiTeams = structuredClone(teams)
      changed = true
    }
    return changed
  }

  /** 已接管球队的变动写回唯一名册；同一场比赛的结果只由第一个完成的教练写入。 */
  function publishClub(account: Account): void {
    const clubId = ownedClubId(account)
    if (!clubId || !sharedWorld.teams?.[clubId] || account.game.world?.clubs.find((item) => item.id === 'player')?.squadKey !== clubId) return
    const team = sharedWorld.teams[clubId]
    let changed = false
    if (JSON.stringify(team.players) !== JSON.stringify(account.game.roster) || JSON.stringify(team.lineup) !== JSON.stringify(account.game.lineup) || team.name !== account.game.clubName) {
      sharedWorld.teams[clubId] = { ...team, name: account.game.clubName, players: structuredClone(account.game.roster), lineup: structuredClone(account.game.lineup) }
      changed = true
    }
    const sharedClub = sharedWorld.world.clubs.find((item) => item.id === clubId)
    if (sharedClub) {
      if (sharedClub.name !== account.game.clubName) { sharedClub.name = account.game.clubName; changed = true }
      const stars = account.game.roster.filter((player) => player.starKey)
      if (JSON.stringify(sharedClub.starPlayerIds) !== JSON.stringify(stars.map((player) => player.id))) {
        sharedClub.starPlayerIds = stars.map((player) => player.id)
        changed = true
      }
      for (const player of stars) if (sharedWorld.world.starAges[player.id] !== (player.age ?? 24)) {
        sharedWorld.world.starAges[player.id] = player.age ?? 24
        changed = true
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
      if (fixturesChanged || changed) {
        const names = new Map(sharedWorld.world.clubs.map((club) => [club.id, club.name]))
        division.table = computeWorldTable(division.clubIds ?? [], division.fixtures, names)
        division.finished = division.fixtures.every((fixture) => fixture.played)
        division.champion = division.finished ? division.table[0]?.teamId ?? null : null
        changed = true
      }
    }
    if (changed) persistWorld()
  }

  function publicFacilities(economy: AIClubState['economy'] | undefined) {
    if (!economy) return undefined
    return { stadium: economy.stadium, academy: economy.academy, medical: economy.medical, shop: economy.shop, sponsor: economy.sponsor, psychology: economy.psychology, tactics: economy.tactics }
  }
  function publicPlayer(player: Player) {
    const { id, name, enName, country, era, age, foot, height, positions, attrs, baseAttrs, traitId, skills, skillTiers } = player
    const visible = Object.fromEntries(mainAttrsFor(positions.GK > 0).map((key) => [key, attrs[key]]))
    // ca 是现在装备的那张卡；baseCa 是没练过的原始属性，两者之差就是卡带来的提升。
    const baseCa = baseAttrs ? displayCA(caOf(baseAttrs, positions.GK > 0)) : undefined
    return { id, name, enName, country, era, age, foot, height, positions, attrs: visible, traitId, skills, skillTiers, ca: displayCA(caOf(attrs, positions.GK > 0)), baseCa }
  }
  for (const account of db.accounts) account.lastUserRevision ??= account.revision
  // 清理旧版新账号准备期；正式开球时间不因注册或登录而变化。
  let removedPreparation = false
  for (const account of db.accounts) {
    const clubId = ownedClubId(account)
    if (clubId && !account.appliedMatchIds) {
      account.appliedMatchIds = inheritedMatchIds(account.game, clubId)
      removedPreparation = true
    }
    if (account.game?.settings && 'autoSettle' in account.game.settings) {
      delete (account.game.settings as { autoSettle?: unknown }).autoSettle
      removedPreparation = true
    }
  }
  if (removedPreparation) writeJson(dbPath, db)
  const sessions: SessionMap = readJson<SessionMap>(sessionPath, {})
  const clients = new Map<string, Set<ServerResponse>>()
  const registerAttempts = new Map<string, number[]>()

  const persistDb = () => writeJson(dbPath, db)
  const persistSessions = () => writeJson(sessionPath, sessions)

  /** 全服广播用的竞拍信息：不含账号 ID 以外的隐私，也不带完整球员池，池子变了客户端按 version 重新拉。 */
  const marketPayload = () => ({ type: 'market', auctions: market.auctions, log: market.log, version: market.version, serverTime: now() })
  function broadcastMarket(): void {
    const message = `data: ${JSON.stringify(marketPayload())}\n\n`
    for (const group of clients.values()) for (const res of group) res.write(message)
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
    },
  }

  /**
   * 全服自由市场每个游戏日补到 200 人：先算当天挂牌的球星和留在市场上的球员，不足的用当天生成的随机球员补；
   * 前几天没人要的随机球员销毁（正在竞拍的等竞拍结束）。每个游戏日只做一次。
   */
  function refreshSharedFreeMarket(): void {
    const anchor = { world: sharedWorld.world, createdAt: sharedWorld.startedAt }
    const day = marketDayOf(anchor, now())
    if (sharedWorld.freeMarketDay === day) return
    sharedWorld.freeMarketDay = day
    const result = refreshFreeMarket({ pool: market.pool, anchor, now: now(), seed: sharedWorld.seed, busy: (id) => market.auctions.some((auction) => auction.playerId === id) })
    if (result.changed) {
      market.pool = result.pool
      market.version += 1
      persistMarket()
      broadcastMarket()
    } else persistWorld()
  }

  function settleDueAuctions(): void {
    refreshSharedFreeMarket()
    if (!market.auctions.some((auction) => auction.endsAt <= now())) return
    const results = settleAuctions(market, (id) => db.accounts.find((account) => account.id === id)?.game, now(), aiBidder)
    if (!results.length) return
    for (const { winnerId } of results) {
      if (winnerId && aiClubIdOf(winnerId)) continue
      const winner = winnerId ? db.accounts.find((account) => account.id === winnerId) : undefined
      if (!winner) continue
      publishClub(winner)
      winner.revision++
      winner.lastUserRevision = winner.revision
      winner.updatedAt = now()
      broadcast(winner)
    }
    persistDb()
    persistMarket()
    broadcastMarket()
  }

  /** 老化由各账号自己算，市场里的球员不归任何账号的世界管，否则会被算退役、生出下一代。 */
  function forgetMarketAges(account: Account): void {
    const ages = account.game?.world?.starAges
    if (ages) for (const player of market.pool) delete ages[player.id]
  }

  /* 老账号各有一份自由球员：并进全服市场；已经被人签走的从池子里拿掉。 */
  {
    const before = market.pool.length
    market.pool = market.pool.filter((player) => !onSomeRoster(player.id))
    let changed = market.pool.length !== before
    if (changed) market.version += 1
    for (const account of db.accounts) {
      if (account.game?.freeStars?.length && absorbFreeAgents(market, account.game, (id) => onSomeRoster(id))) changed = true
      forgetMarketAges(account)
    }
    if (changed) {
      persistDb()
      persistMarket()
    }
  }

  function bidFor(account: Account, playerId: unknown, amount: unknown): BidResult {
    if (typeof playerId !== 'string' || !playerId) return { ok: false, error: '无效的球员 ID' }
    if (account.game.activeMatch && !account.game.activeMatch.context.isLeague) return { ok: false, error: '比赛进行中不能出价' }
    settleDueAuctions()
    const player = market.pool.find((item) => item.id === playerId)
    const alreadyBidding = market.auctions.some((item) => item.playerId === playerId)
    if (player && !alreadyBidding && !isOnMarketToday({ world: account.game.world, createdAt: account.game.createdAt }, player)) {
      return { ok: false, error: `${player.name} 现在不在市场，过些天再来看看` }
    }
    const result = placeBid(market, account.game, account.id, playerId, Number(amount), now())
    if (result.ok) {
      // 跟价手续费已经从余额里扣掉了：账号存档也要保存并推给各设备。
      if (result.fee > 0) {
        account.revision++
        account.lastUserRevision = account.revision
        account.updatedAt = now()
        persistDb()
        broadcast(account)
      }
      persistMarket()
      broadcastMarket()
    }
    return result
  }

  const publicAccount = (account: Account) => ({ id: account.id, username: account.username })
  /** 世界页 / 球队详情看到的全服快照；手动界面和 Agent 的 get_world 共用。 */
  function worldSnapshot(account?: Account) {
    advanceAllMatches()
    return {
      seasonIndex: sharedWorld.world.seasonIndex,
      ownClubId: account ? ownedClubId(account) ?? null : null,
      clubs: sharedWorld.world.clubs.map((club) => {
        const owner = db.accounts.find((item) => item.id === sharedWorld.owners[club.id])
        const team = sharedWorld.teams?.[club.id]
        const validOwner = owner?.game.world?.clubs.find((item) => item.id === 'player')?.squadKey === club.id
        return {
          id: club.id, name: validOwner ? owner.game.clubName : club.name, color: club.color,
          tier: club.tier, conference: club.conference, managed: !!owner, formationId: validOwner ? owner.game.lineup.formationId : team?.formationId ?? club.formationId,
          players: (validOwner ? owner.game.roster : team?.players ?? []).map(publicPlayer),
          // RANK：首发 CA 之和。玩家管理的球队只按身上装备的属性算，不暴露库存里的卡。
          rating: validOwner ? Math.round(lineupRating(owner.game.roster, owner.game.lineup)) : team ? Math.round(lineupRating(team.players, team.lineup)) : undefined,
          // 电脑球队的设施公开；玩家管理的球队不公开经营数据。
          facilities: owner ? undefined : publicFacilities(sharedWorld.aiClubs?.[club.id]?.economy),
        }
      }),
      divisions: sharedWorld.world.divisions.map((division) => ({ id: division.divisionId, tier: division.tier, conference: division.conference, round: division.round, table: division.table, fixtures: division.fixtures.map(({ reportedBy: _reporter, ...fixture }) => fixture) })),
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
    publishClub(account)
    pullSharedWorld(account)
    persistWorld()
    account.revision++
    account.lastUserRevision = account.revision
    account.updatedAt = now()
    persistDb()
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
    const previousRoster = new Set(account.game.roster.map((player) => player.id))
    const previousTeams = account.game.aiTeams
    const result = signClubPlayer(account.game, teamId, String(body.playerId ?? ''), offer, { goal, role })
    if (result.ok) {
      commitAiSignings(previousRoster, previousTeams, account.game)
      const seller = sharedWorld.aiClubs?.[teamId]
      if (seller) seller.economy.balance += offer
      persistWorld()
      publishClub(account)
      account.revision++
      account.lastUserRevision = account.revision
      account.updatedAt = now()
      persistDb()
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
      persistDb()
      broadcast(account)
    }
    return { status: result.ok ? 200 : 400, payload: { ...result } }
  }

  /** 对手的实时体能只存在服务器；账号存档的公开副本不能带回这些字段。 */
  function publicGame(account: Account): GameState {
    const game = structuredClone(account.game)
    for (const team of game.aiTeams) for (const player of team.players) {
      delete (player as Partial<Player>).condition
      delete (player as Partial<Player>).energy
    }
    return game
  }
  const statePayload = (account: Account, source?: string) => ({ type: 'state', revision: account.revision, game: publicGame(account), ...(source ? { source } : {}) })

  function sendState(res: ServerResponse, account: Account, source?: string): void {
    res.write(`data: ${JSON.stringify(statePayload(account, source))}\n\n`)
  }

  function broadcast(account: Account, source?: string): void {
    const group = clients.get(account.id)
    if (!group) return
    for (const res of group) sendState(res, account, source)
  }

  function advanceAccount(account: Account): boolean {
    try {
      if (!account.game) return false
      // 7 人制存档迁移到 11 人制（只在还有旧阵型时动手）。
      const elevenUpgraded = upgradeElevenASide(account.game)
      // 联机账号的世界、电脑球队和自由市场由服务器维护：打上标记，本地的单机逻辑就不会另算一份。
      const markedShared = !account.game.shared
      if (markedShared) account.game.shared = true
      const signaturesAdded = upgradeLegacySignatures(account.game)
      const cardsAdded = ensureCards(account.game)
      const namesUpgraded = upgradeNames(account.game)
      const traitsUpgraded = upgradeStarTraits(account.game)
      const attrsUpgraded = upgradeBurstAttr(account.game)
      const sharedTeamsChanged = pullSharedTeams(account)
      const sharedFixturesChanged = pullSharedFixtures(account)
      const sharedWorldChanged = pullSharedWorld(account)
      const publishedMatchesChanged = syncPublishedMatches(account)
      // 体能每小时按比例恢复（见 condition.ts）；接管球队的名单以账号为准，publishClub 再写回共享名册。
      const rested = settleAccountConditions(account)
      let migrated = markedShared || elevenUpgraded || signaturesAdded || cardsAdded || namesUpgraded || traitsUpgraded || attrsUpgraded || sharedTeamsChanged || sharedFixturesChanged || sharedWorldChanged || publishedMatchesChanged || rested || absorbInto(account)
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
      if (!changed && !migrated && !economyAdded) return false
      publishClub(account)
      // 补算 / 自动结算会改动本地那份对手名单（体能、伤病）：同一次推进里就换回共享名册，
      // 免得下一次请求再同步一次、版本号又涨，客户端随后的保存被当成冲突。
      pullSharedTeams(account)
      pullSharedFixtures(account)
      pullSharedWorld(account)
      account.revision++
      // lastUserRevision 只记录“玩家自己保存”的版本；AI / 共享世界 / 自动结算的改动不算，
      // 否则这些服务端变化会把玩家的下一次保存判成冲突。
      account.updatedAt = now()
      persistDb()
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
    if (changed) persistWorld()
  }

  /** 同步全服公开赛果；仿真只在后台队列子进程中运行，和是否有人在线无关。 */
  function advanceAllMatches(): void {
    advanceSharedWorld()
    settleSharedConditions()
    for (const account of db.accounts) advanceAccount(account)
  }

  /** 最近一次全服换季的时间，用来让“开始下一赛季”请求在自动换季后保持幂等。 */
  let lastRollAt = -Infinity

  /** 全服赛季一次性结算：先在副本中算完升降级和所有教练的阵容，再一起发布。 */
  function rollSharedSeason(force = false): { ok: boolean; error?: string } {
    const old = sharedWorld.world
    // 即使强制请求换季，也不能绕过任务队列临时生成未结算的比分。
    if (!old.divisions.every((division) => division.fixtures.every((fixture) => fixture.played))) return { ok: false, error: '全服本赛季仍有比赛未完成' }
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
        if (game.season.index === old.seasonIndex) advanceSharedAccountSeason(game, old, next, clubId, provisional)
        else {
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
        game.world = worldForClub(next, clubId)
        game.season = game.world.divisions.find((division) => division.clubIds?.includes('player'))!
        game.aiTeams = (game.season.clubIds ?? []).filter((id) => id !== 'player').map((id) => structuredClone(teams[id]))
      }
      sharedWorld.world = next
      sharedWorld.teams = teams
      sharedWorld.reserveStars = representative.reserveStars ?? []
      for (const { account, game } of drafts) {
        account.game = game
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
      sharedWorld.matchBook!.suspensions = {}
      sharedWorld.matchBook!.yellowCounts = {}
      // 电脑球队也过了一个赛季：清掉已经并进名单的签入，账本和设施继续滚。
      for (const state of Object.values(sharedWorld.aiClubs ?? {})) state.signings = []
      persistWorld()
      persistDb()
      for (const { account } of drafts) broadcast(account)
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
    view.market.freeAgents = market.pool.filter((player) => onAuctionNow(player.id) || isOnMarketToday(anchor, player)).map((player) => {
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

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    advanceSharedWorld()
    autoRollSharedSeason()
    autoPlayoff()
    if (url.pathname === '/api/health') {
      json(res, 200, { ok: true, accounts: db.accounts.length, version: GAME_VERSION, worldSeasonStartedAt: sharedWorld.startedAt })
      return
    }

    if (url.pathname === '/api/world' && req.method === 'GET') {
      advanceAllMatches()
      json(res, 200, {
        seed: sharedWorld.seed,
        startedAt: sharedWorld.startedAt,
        owners: sharedWorld.owners,
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
      const anchor = { world: sharedWorld.world, createdAt: sharedWorld.world.calendarStartAt ?? now() }
      const onAuction = (id: string) => market.auctions.some((item) => item.playerId === id)
      json(res, 200, { ...marketPayload(), pool: market.pool.filter((player) => onAuction(player.id) || isOnMarketToday(anchor, player)) })
      return
    }

    if (url.pathname === '/api/public-config' && req.method === 'GET') {
      /* 只暴露注册模式与 sitekey，邀请码与 secret 永不下发。 */
      json(res, 200, { registration: registrationMode, turnstileSiteKey, accounts: db.accounts.length, slots: slotInfo() })
      return
    }

    // 注册前只读预览：不创建账号、不预占球队，只提供空缺二级球队的公开名单。
    if (url.pathname === '/api/registration/clubs' && req.method === 'GET') {
      if (registrationMode === 'closed') return json(res, 403, { error: '本服务器已关闭注册' })
      const clubs = worldSnapshot().clubs.filter((club) => club.tier === 'division2' && !club.managed)
      json(res, 200, { clubs })
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
        // 兼容未指定球队的 API 客户端：只在二级联赛找空位，满员就开新赛区。
        club = pickFreeClubForNewAccount(sharedWorld.world, sharedWorld.owners, aliveAccountIds())
        if (!club) {
          expandWorldConference(sharedWorld.world, splitSeed(sharedWorld.seed, `expand-${sharedWorld.world.seasonIndex}-${Object.keys(sharedWorld.owners).length}`))
          // 扩赛区后也必须补齐全服唯一名册，否则新球队的任务会阻塞同轮统一公布。
          for (const item of sharedWorld.world.clubs) if (!sharedWorld.aiClubs![item.id]) sharedWorld.aiClubs![item.id] = createAIClub(item, splitSeed(sharedWorld.seed, `ai-club-${item.id}`))
          const expandedTeams = buildOwnerlessTeams(sharedWorld.world, sharedWorld.seed, sharedWorld.aiClubs)
          for (const [id, team] of Object.entries(expandedTeams)) if (!sharedWorld.teams![id]) sharedWorld.teams![id] = team
          club = pickFreeClubForNewAccount(sharedWorld.world, sharedWorld.owners, aliveAccountIds())
        }
      }
      if (!club) return json(res, 503, { error: '服务器席位已满：新赛区也没能开出空位，请稍后再试' })
      const accountId = crypto.randomUUID()
      sharedWorld.owners[club.id] = accountId
      persistWorld()
      const account: Account = {
        id: accountId,
        username,
        salt,
        passwordHash: hashPassword(password, salt),
        // 自由球员全服共用，账号里不再有自己的一份。
        game: createWorldGameFromWorld(sharedWorld.world, club.id, sharedWorld.seed, sharedWorld.startedAt, [], sharedWorld.reserveStars),
        revision: 1,
        lastUserRevision: 1,
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
      forgetMarketAges(account)
      account.appliedMatchIds = inheritedMatchIds(account.game, club.id)
      db.accounts.push(account)
      const token = createSession(account.id)
      persistDb()
      persistSessions()
      advanceAccount(account)
      json(res, 201, { token, user: publicAccount(account), revision: account.revision, game: publicGame(account) })
      return
    }

    if (url.pathname === '/api/login' && req.method === 'POST') {
      const body = await readJsonBody(req)
      const username = String(body.username ?? '').trim().toLowerCase()
      const password = String(body.password ?? '')
      const account = db.accounts.find((item) => item.username.toLowerCase() === username)
      if (!account || hashPassword(password, account.salt) !== account.passwordHash) return json(res, 401, { error: '用户名或密码错误' })
      const token = createSession(account.id)
      persistSessions()
      advanceAccount(account)
      json(res, 200, { token, user: publicAccount(account), revision: account.revision, game: publicGame(account) })
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
      if (!account.agentToken) {
        account.agentToken = createAgentToken()
        persistDb()
      }
      json(res, 200, { token: account.agentToken })
      return
    }

    if (url.pathname === '/api/agent/revoke' && req.method === 'POST') {
      const account = accountFromToken(tokenFromRequest(req))
      if (!account) return json(res, 401, { error: '请先登录' })
      delete account.agentToken
      persistDb()
      json(res, 200, { ok: true })
      return
    }

    if (url.pathname.startsWith('/api/agent/')) {
      const agentAccount = agentAccountFromToken(tokenFromRequest(req))
      if (!agentAccount) return json(res, 401, { error: 'Agent 令牌无效，请在游戏账号面板重新生成' })
      // 联机时有教练执教的球队不能从 AI 购买入口买人，和转会页一致。
      const agentOptions: AgentOptions = { isManaged: (clubId) => !!sharedWorld.owners[clubId] }
      const agentState = () => withSharedMarket(agentView(agentAccount.game, now(), agentOptions), agentAccount)
      if (url.pathname === '/api/agent/state' && req.method === 'GET') {
        advanceAccount(agentAccount)
        settleDueAuctions()
        json(res, 200, { revision: agentAccount.revision, game: agentState() })
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
          json(res, outcome.ok ? 200 : 400, { ...outcome, revision: agentAccount.revision, game: agentState() })
          return
        }
        if (body.action === 'start_league' || body.action === 'simulate_round') return json(res, 400, { error: '联赛由服务器提前排队计算、到点统一公布，不能手动开赛或模拟' })
        if (body.action === 'buy_free_agent') return json(res, 400, { error: '联机时自由球员要竞拍，请用 bid_free_agent 出价' })
        if (body.action === 'bid_free_agent') {
          const bid = bidFor(agentAccount, body.playerId, body.amount)
          json(res, bid.ok ? 200 : 400, { ...bid, revision: agentAccount.revision, game: agentState() })
          return
        }
        /** 全服信息：世界页、球队详情里能看到的所有球队名单、积分榜与赛程。 */
        if (body.action === 'get_world') {
          json(res, 200, { ok: true, result: worldSnapshot(agentAccount), revision: agentAccount.revision, game: agentState() })
          return
        }
        if (body.action === 'sign_club_player' || body.action === 'respond_offer') {
          const reply = body.action === 'sign_club_player' ? buyFromAIClub(agentAccount, body) : answerOffer(agentAccount, body)
          json(res, reply.status, { ...reply.payload, result: reply.payload, revision: agentAccount.revision, game: agentState() })
          return
        }
        if (body.action === 'rename_club') {
          const renamed = renameClub(agentAccount, body.name)
          json(res, renamed.ok ? 200 : renamed.status, { ...renamed, revision: agentAccount.revision, game: agentState() })
          return
        }
        if (body.action === 'choose_club') {
          return json(res, 400, { error: '注册完成后不允许换队，球队只能在注册时选择' })
        }
        let outcome: ReturnType<typeof applyAgentAction>
        const previousRoster = new Set(agentAccount.game.roster.map((player) => player.id))
        const previousTeams = agentAccount.game.aiTeams
        if (body.action === 'start_world_friendly') {
          // 和世界页“约战”一样：对手名单由服务器给出，可以约全服任意一支球队（含别的教练执教的）。
          const found = friendlyTeamFor(agentAccount, String(body.clubId ?? ''))
          outcome = 'error' in found ? { ok: false, error: found.error } : startChallengeWithOpponent(agentAccount.game, found.team, now())
        } else {
          outcome = applyAgentAction(agentAccount.game, body, now(), agentOptions)
        }
        if (outcome.ok) commitAiSignings(previousRoster, previousTeams, agentAccount.game)
        if (outcome.ok && !['get_player', 'get_match', 'preview_training', 'preview_signing'].includes(String(body.action))) {
          publishClub(agentAccount)
          agentAccount.revision++
          const leagueOnly = agentAccount.game.activeMatch?.context.isLeague && ['start_league', 'set_match_tactics', 'substitute'].includes(String(body.action))
          if (!leagueOnly) agentAccount.lastUserRevision = agentAccount.revision
          agentAccount.updatedAt = now()
          persistDb()
          broadcast(agentAccount)
        }
        absorbInto(agentAccount)
        json(res, outcome.ok ? 200 : 400, { ...outcome, revision: agentAccount.revision, game: agentState() })
        return
      }
      json(res, 404, { error: 'Agent 接口不存在' })
      return
    }

    const account = accountFromToken(tokenFromRequest(req))
    if (!account) return json(res, 401, { error: '请先登录' })

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
      json(res, outcome.ok ? 200 : 400, { ...outcome, revision: account.revision, game: publicGame(account) })
      return
    }

    /** 友谊赛对手：联机时由服务器给出权威名单（含其他教练的球队），状态类信息不外发。 */
    if (url.pathname === '/api/world/friendly-team' && req.method === 'POST') {
      advanceAccount(account)
      const body = await readJsonBody(req)
      const found = friendlyTeamFor(account, String(body.clubId ?? ''))
      if ('error' in found) return json(res, found.status, { error: found.error })
      json(res, 200, { team: found.team })
      return
    }

    /** 旧客户端入口保留明确报错；浏览器和 Agent 都不能在注册后换队。 */
    if (url.pathname === '/api/world/choose-club' && req.method === 'POST') {
      return json(res, 400, { error: '注册完成后不允许换队，球队只能在注册时选择' })
    }

    if (url.pathname === '/api/transfer/ai-buy' && req.method === 'POST') {
      advanceAccount(account)
      const reply = buyFromAIClub(account, await readJsonBody(req))
      json(res, reply.status, { ...reply.payload, revision: account.revision, game: publicGame(account) })
      return
    }

    if (url.pathname === '/api/transfer/offer' && req.method === 'POST') {
      advanceAccount(account)
      const reply = answerOffer(account, await readJsonBody(req))
      json(res, reply.status, { ...reply.payload, revision: account.revision, game: publicGame(account) })
      return
    }

    if (url.pathname === '/api/club/rename' && req.method === 'POST') {
      advanceAccount(account)
      const body = await readJsonBody(req)
      const renamed = renameClub(account, body.name)
      if (!renamed.ok) return json(res, renamed.status, { error: renamed.error })
      json(res, 200, { revision: account.revision, game: publicGame(account) })
      return
    }

    if (url.pathname === '/api/world/teams' && req.method === 'GET') {
      json(res, 200, worldSnapshot(account))
      return
    }

    if (url.pathname === '/api/logout' && req.method === 'POST') {
      const token = tokenFromRequest(req)
      if (token) {
        delete sessions[token]
        persistSessions()
      }
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

    if (url.pathname === '/api/game' && req.method === 'GET') {
      advanceAccount(account)
      json(res, 200, { game: publicGame(account), revision: account.revision })
      return
    }

    if (url.pathname === '/api/match/action' && req.method === 'POST') {
      const body = await readJsonBody(req)
      if (!['start_league', 'set_match_tactics', 'substitute'].includes(String(body.action))) return json(res, 400, { error: '不支持的比赛操作' })
      if (body.action === 'start_league') return json(res, 400, { error: '联赛由服务器提前排队计算、到点统一公布，不需要手动开赛' })
      advanceAccount(account)
      if (body.action !== 'start_league' && !account.game.activeMatch?.context.isLeague) return json(res, 400, { error: '当前没有进行中的联赛' })
      const outcome = applyAgentAction(account.game, body, now())
      if (outcome.ok) {
        account.revision++
        account.updatedAt = now()
        persistDb()
        broadcast(account, String(req.headers['x-fm-client'] ?? '').slice(0, 128))
      }
      json(res, outcome.ok ? 200 : 400, { ...outcome, revision: account.revision, game: publicGame(account) })
      return
    }

    if (url.pathname === '/api/game' && req.method === 'PUT') {
      const body = await readJsonBody(req)
      advanceAccount(account)
      // 还没刷新的旧页面可能交上来 7 人制的存档：按同样的规则迁移（补出来的人和服务器上的一模一样）。
      if (body.game && typeof body.game === 'object') upgradeElevenASide(body.game as GameState)
      // 开赛前 30 分钟锁阵容：只拦阵容 / 自动换人，训练、转会、经济等其它改动照常保存。
      if (lineupLockState(account.game, now()).locked) {
        const incoming = body.game as GameState | undefined
        const lineupChanged = JSON.stringify(incoming?.lineup ?? null) !== JSON.stringify(account.game.lineup)
        const subsChanged = JSON.stringify(incoming?.autoSubs ?? null) !== JSON.stringify(account.game.autoSubs ?? null)
        if (lineupChanged || subsChanged) {
          return json(res, 409, { error: '阵容已锁定：开赛前 30 分钟内不能修改，比赛由服务器自动结算' })
        }
      }
      const baseRevision = Number(body.baseRevision)
      // 客户端基于“最后一次玩家保存”之后的版本都算安全：中间的 revision 增长来自服务器
      // （AI 训练、共享赛程、自动结算），保存后服务端会重新拉取这些共享数据。
      const serverAdvanced = baseRevision >= (account.lastUserRevision ?? account.revision)
      const onlyLeagueProgress = account.game.activeMatch?.context.isLeague && serverAdvanced && baseRevision < account.revision
      if (!Number.isInteger(baseRevision) || (baseRevision !== account.revision && !serverAdvanced && !onlyLeagueProgress)) {
        json(res, 409, { error: '存档已在另一设备更新', revision: account.revision, game: publicGame(account) })
        return
      }
      if (!isGameState(body.game)) return json(res, 400, { error: '无效的游戏存档' })
      // 比赛公布会改变收入、球迷、市场等：不能把公布前的整份旧经济覆盖回去。
      // 这种少见的并发保存需要客户端重新加载权威存档，而不是静默丢失服务器结算。
      if (body.game.economy && account.game.economy && body.game.economy.lastIncomeRound < account.game.economy.lastIncomeRound) {
        return json(res, 409, { error: '存档已在另一设备更新：比赛已结算，请重新加载', revision: account.revision, game: publicGame(account) })
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
      if (account.game.activeMatch?.context.isLeague) {
        body.game.activeMatch = account.game.activeMatch
      } else if (body.game.activeMatch?.context.isLeague) {
        return json(res, 400, { error: '联赛必须由服务器开始' })
      }
      // 联赛赛程、比分和战报只由服务器产生；旧页面保存不能回滚已赛结果、伪造未来比分或重踢。
      body.game.season = account.game.season
      body.game.matchHistory = account.game.matchHistory
      if (body.game.world && account.game.world) body.game.world = account.game.world
      // 联机改名只能走 /api/club/rename（要查重名和字数），普通保存不能顺手改掉。
      if (body.game.world) body.game.clubName = account.game.clubName
      // 伤病是服务器记录的：旧客户端根本不知道这个字段，保存时清空也不能把已知伤病抹掉。
      body.game.injuries = { ...(body.game.injuries ?? {}), ...(account.game.injuries ?? {}) }
      upgradeLegacySignatures(body.game)
      ensureCards(body.game)
      upgradeNames(body.game)
      upgradeStarTraits(body.game)
      upgradeBurstAttr(body.game)
      economyOf(body.game)
      // 其他教练的球员不能从 AI 购买入口直接转走。
      const incomingGame: GameState = body.game
      const previousRoster = new Set(account.game.roster.map((player) => player.id))
      if (signsFromOtherCoach(account, previousRoster, incomingGame)) {
        return json(res, 400, { error: '不能从其他玩家执教的球队直接买人' })
      }
      // 从 AI 球队买人必须走 /api/transfer/ai-buy（要过俱乐部的放人规则），普通保存不能直接把人加进来。
      const canonicalAI = new Set(account.game.aiTeams.flatMap((team) => sharedWorld.teams?.[team.id]?.players.map((player) => player.id) ?? []))
      if (incomingGame.roster.some((player) => canonicalAI.has(player.id) && !previousRoster.has(player.id))) {
        return json(res, 400, { error: '从 AI 球队买人请通过转会谈判（页面可能需要刷新）', revision: account.revision, game: publicGame(account) })
      }
      // 报价、出场记录、球员的不满都以服务器为准。
      incomingGame.transferOffers = account.game.transferOffers
      incomingGame.appearances = account.game.appearances
      incomingGame.suspensions = account.game.suspensions
      incomingGame.yellowCounts = account.game.yellowCounts
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
      pullSharedTeams(account)
      publishClub(account)
      absorbInto(account)
      pullSharedFixtures(account)
      pullSharedWorld(account)
      account.revision++
      account.lastUserRevision = account.revision
      account.updatedAt = now()
      persistDb()
      broadcast(account, String(req.headers['x-fm-client'] ?? '').slice(0, 128))
      json(res, 200, { ok: true, revision: account.revision, updatedAt: account.updatedAt })
      return
    }

    if (url.pathname === '/api/events' && req.method === 'GET') {
      openEvents(req, res, account)
      return
    }

    json(res, 404, { error: '接口不存在' })
  }

  function openEvents(req: IncomingMessage, res: ServerResponse, account: Account): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write('retry: 3000\n\n')
    let group = clients.get(account.id)
    if (!group) {
      group = new Set()
      clients.set(account.id, group)
    }
    group.add(res)
    sendState(res, account)
    res.write(`data: ${JSON.stringify(marketPayload())}\n\n`)
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000)
    const cleanup = () => {
      clearInterval(heartbeat)
      group!.delete(res)
      if (group!.size === 0) clients.delete(account.id)
    }
    req.on('close', cleanup)
    res.on('close', cleanup)
  }

  function createSession(accountId: string): string {
    const token = crypto.randomBytes(32).toString('hex')
    sessions[token] = accountId
    return token
  }

  function createAgentToken(): string {
    return `fm_${crypto.randomBytes(24).toString('hex')}`
  }

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
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable' })
    if (req.method === 'HEAD') res.end()
    else res.end(fs.readFileSync(target))
  }

  async function runMatchQueue(): Promise<void> {
    if (closed) return
    const changed = advanceSharedWorld()
    await matchQueue.pump(now())
    if (closed) return
    const published = matchScheduler.refresh(now())
    // 空闲或仅在提前计算时，不必每秒复制所有账号的整份存档。
    if (changed || published) for (const account of db.accounts) advanceAccount(account)
    autoRollSharedSeason()
    autoPlayoff()
  }

  const server = http.createServer((req, res) => void handle(req, res))
  const tickMs = options.tickMs ?? 30_000
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
  advanceAllMatches()
  autoRollSharedSeason()
  autoPlayoff()

  return {
    server,
    close: () => {
      closed = true
      if (timer) clearInterval(timer)
      if (matchTimer) clearInterval(matchTimer)
      if (jobTimer) clearInterval(jobTimer)
      matchQueue.close()
      for (const group of clients.values()) for (const res of group) res.end()
      clients.clear()
      server.close()
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
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fs.renameSync(tmp, file)
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
