import type { AITeam, Fixture, GameState, MatchContext, MatchRecord, SeasonState, SeasonTableRow } from './types.ts'
import { splitSeed } from './rng.ts'
import { buildMatchEngineForGame, createMatchRecord, fixtureScorers, simulateAIvsAIState } from './match/setup.ts'
import type { GameEngine } from './pes/engine.ts'
import { ENERGY_RECOVERY_PER_GAME_DAY } from './training.ts'
import { RECENT_MATCHES } from './transfer-rules.ts'
import { settleSquadEnergy, shiftEnergyClock } from './energy.ts'
import { applyConditionLoss, settleConditions, shiftConditionClock } from './condition.ts'
import { expireOffers, runLocalTransfers } from './transfers.ts'
import { refreshLocalFreeMarket } from './free-market.ts'
import { awardSeasonPrize } from './economy.ts'
import { squadLimitError } from './market.ts'
import { AVERAGE_ROUND_GAME_DAYS, GAME_DAY_MS, KICKOFF_SCHEDULE, latestKickoffAt, elapsedGameDays, gameDayOfRound, kickoffAtForRound, seasonEndAt, roundsKickedOff, roundGapGameDays } from './calendar.ts'
import { recordMatchInjuries } from './injury.ts'
import { awardRoundIncome, economyOf } from './economy.ts'
import { playerMarketValue, settleMarket } from './market.ts'
import { LOGIC_MATCH_SECONDS } from './match/time.ts'
import { advanceWorldSeason, ensurePromotionPlayoff, simulateOtherDivisions, syncPlayerDivision, payWorldWages } from './world.ts'
import { runAIClubs } from './ai-club.ts'
import { recordMatchDiscipline, serveSuspensions, suspendedPlayerIds } from './discipline.ts'

export const PLAYER_TEAM_ID = 'player'
export const ROUNDS = 38
export { AVERAGE_ROUND_GAME_DAYS, GAME_DAY_MS } from './calendar.ts'
export { LEAGUE_REALTIME_SECONDS } from './match/time.ts'
export const LEAGUE_MATCH_SECONDS = LOGIC_MATCH_SECONDS

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function createSeason(seed: number, aiTeams: AITeam[], clubName: string, startedAt = latestKickoffAt(Date.now()), clockShift = 0): SeasonState {
  const ids = [PLAYER_TEAM_ID, ...aiTeams.map((team) => team.id)]
  const fixtures = buildFixtures(ids, startedAt, clockShift)
  const season: SeasonState = {
    index: 1,
    round: 1,
    fixtures,
    table: [],
    finished: false,
    champion: null,
    playerFinish: null,
    seed,
    startedAt,
    gameDayMs: GAME_DAY_MS,
    roundGameDays: AVERAGE_ROUND_GAME_DAYS,
    kickoffSchedule: KICKOFF_SCHEDULE,
    ...(clockShift ? { clockShift } : {}),
  }
  const names = new Map<string, string>([[PLAYER_TEAM_ID, clubName], ...aiTeams.map((team) => [team.id, team.name] as [string, string])])
  season.table = computeTable(ids, fixtures, names)
  return season
}

/** Finish any pending final-round settlement before starting the next season. */
export function startNextSeason(game: GameState, now = Date.now()): { ok: boolean; error?: string } {
  if (game.world) return advanceWorldSeason(game, now)
  if (game.activeMatch || !game.season?.finished) return { ok: false, error: '赛季尚未结束或比赛进行中' }
  const season = game.season
  if (!Number.isSafeInteger(season.index) || season.index < 1 || !Number.isSafeInteger(season.index + 1) ||
      !Array.isArray(season.fixtures) || !season.fixtures.length || season.fixtures.some(f => !f || f.played !== true) ||
      !Array.isArray(game.aiTeams) || game.aiTeams.some(team => !team || typeof team.id !== 'string' || typeof team.name !== 'string') ||
      !Number.isFinite(game.seed) || !Number.isFinite(now) ||
      (game.seasonHistory !== undefined && !Array.isArray(game.seasonHistory)) ||
      (game.economy != null && (typeof game.economy !== 'object' || Array.isArray(game.economy)))) return { ok: false, error: '赛季数据无效' }
  const market = game.market
  if (market !== undefined) {
    if (!market || !Array.isArray(market.listings) || !Number.isSafeInteger(market.lastSettledRound) || market.lastSettledRound < 0 ||
        !Array.isArray(game.roster) || !Array.isArray(game.freeStars)) return { ok: false, error: '市场数据无效' }
    const ids = new Set<string>()
    for (const player of [...game.roster, ...game.freeStars]) {
      if (!player || typeof player.id !== 'string' || !player.id || ids.has(player.id)) return { ok: false, error: '市场球员无效' }
      ids.add(player.id)
    }
    for (const listing of market.listings) {
      if (!listing || !listing.player || typeof listing.player.id !== 'string' || !listing.player.id || ids.has(listing.player.id) ||
          !Number.isSafeInteger(listing.price) || listing.price <= 0 ||
          (listing.listedRound !== undefined && (!Number.isSafeInteger(listing.listedRound) || listing.listedRound <= 0)) ||
          !playerMarketValue(listing.player)) return { ok: false, error: '市场挂牌无效' }
      ids.add(listing.player.id)
    }
  }
  const index = season.index + 1
  // 老的单联赛存档：新赛季从（存档时钟）最近一个开赛时间点开始，跳过的时间继续算数。
  const next = createSeason(splitSeed(game.seed, `season-${index}`), game.aiTeams, game.clubName, latestKickoffAt(now, season.clockShift), season.clockShift)
  next.index = index
  const economy = economyOf(game)
  awardRoundIncome(game, season.round)
  if (market) settleMarket(game, season.round)
  economy.lastIncomeRound = 0
  if (market) {
    market.lastSettledRound = 0
    for (const listing of market.listings) listing.listedRound = 1
  }
  ;(game.seasonHistory ??= []).push(season)
  game.season = next
  return { ok: true }
}

/** 20 队双循环：19 轮首循环 + 19 轮次循环，每天北京时间 12:00、20:00 各一轮。 */
function buildFixtures(teamIds: string[], startedAt: number, shift = 0): Fixture[] {
  const ids = [...teamIds]
  const fixtures: Fixture[] = []
  let order = [...ids]
  const matches: { round: number; a: string; b: string }[] = []
  for (let round = 1; round <= ids.length - 1; round++) {
    for (let index = 0; index < ids.length / 2; index++) {
      const a = order[index]
      const b = order[ids.length - 1 - index]
      if (a === 'BYE' || b === 'BYE') continue
      const homeId = (round + index) % 2 === 0 ? a : b
      const awayId = homeId === a ? b : a
      matches.push({ round, a: homeId, b: awayId })
    }
    order = [order[0], order[order.length - 1], ...order.slice(1, order.length - 1)]
  }
  // 次循环主客场对调。
  const second = matches.map((match) => ({ round: match.round + ids.length - 1, a: match.b, b: match.a }))
  for (const match of [...matches, ...second]) {
    fixtures.push({
      round: match.round,
      homeId: match.a,
      awayId: match.b,
      isPlayer: match.a === PLAYER_TEAM_ID || match.b === PLAYER_TEAM_ID,
      played: false,
      gameDay: gameDayOfRound(startedAt, match.round, shift),
      kickoffAt: kickoffAtForRound(startedAt, match.round, shift),
    })
  }
  return fixtures
}

export function teamName(game: GameState, id: string): string {
  if (id === PLAYER_TEAM_ID) return game.clubName
  return game.aiTeams.find((team) => team.id === id)?.name ?? id
}

export function teamStrength(game: GameState, id: string): number {
  if (id === PLAYER_TEAM_ID) return 3
  return game.aiTeams.find((team) => team.id === id)?.strength ?? 1
}

function computeTable(ids: string[], fixtures: Fixture[], names: Map<string, string>): SeasonTableRow[] {
  const rows = new Map<string, SeasonTableRow>()
  for (const id of ids) {
    rows.set(id, { teamId: id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 })
  }
  for (const fixture of fixtures) {
    if (!fixture.played || !fixture.score) continue
    const home = rows.get(fixture.homeId)
    const away = rows.get(fixture.awayId)
    if (!home || !away) continue
    home.played++
    away.played++
    home.gf += fixture.score.home
    home.ga += fixture.score.away
    away.gf += fixture.score.away
    away.ga += fixture.score.home
    if (fixture.score.home > fixture.score.away) {
      home.won++
      home.points += 3
      away.lost++
    } else if (fixture.score.home < fixture.score.away) {
      away.won++
      away.points += 3
      home.lost++
    } else {
      home.drawn++
      away.drawn++
      home.points++
      away.points++
    }
  }
  return [...rows.values()].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    const gdA = a.gf - a.ga
    const gdB = b.gf - b.ga
    if (gdB !== gdA) return gdB - gdA
    if (b.gf !== a.gf) return b.gf - a.gf
    return (names.get(a.teamId) ?? a.teamId).localeCompare(names.get(b.teamId) ?? b.teamId, 'zh-CN')
  })
}

export function updateSeasonTable(game: GameState): void {
  const ids = [PLAYER_TEAM_ID, ...game.aiTeams.map((team) => team.id)]
  const names = new Map<string, string>([[PLAYER_TEAM_ID, game.clubName], ...game.aiTeams.map((team) => [team.id, team.name] as [string, string])])
  game.season.table = computeTable(ids, game.season.fixtures, names)
  syncPlayerDivision(game)
  const allPlayed = game.season.fixtures.every((fixture) => fixture.played)
  game.season.finished = allPlayed
  if (allPlayed) {
    game.season.champion = game.season.table[0]?.teamId ?? null
    game.season.playerFinish = game.season.table.findIndex((row) => row.teamId === PLAYER_TEAM_ID) + 1
    // 常规赛一结束就把升级杯算好，赛后休整期间世界页能看到赛果。
    ensurePromotionPlayoff(game)
    // 排名奖金只发一次，靠 economy.prizeSeason 去重。
    awardSeasonPrize(game)
  }
}

export function playerFixture(game: GameState, round = game.season.round): Fixture | undefined {
  return game.season.fixtures.find((fixture) => fixture.round === round && fixture.isPlayer)
}

export function currentRoundFixtures(game: GameState): Fixture[] {
  return game.season.fixtures.filter((fixture) => fixture.round === game.season.round)
}

export function isRoundComplete(game: GameState, round = game.season.round): boolean {
  return game.season.fixtures.filter((fixture) => fixture.round === round).every((fixture) => fixture.played)
}

export function dueRound(game: GameState, now = Date.now()): number {
  // 已经开过球的轮数（每天北京时间 12:00、20:00 各一轮）；赛季开始到第一轮开赛之间也算第 1 轮。
  return Math.min(ROUNDS + 1, Math.max(1, roundsKickedOff(game.season.startedAt, now, game.season.clockShift)))
}

export function seasonDay(game: GameState, now = Date.now()): number {
  return elapsedGameDays(game.season.startedAt, now) + 1
}

export function roundKickoffAt(game: GameState, round = game.season.round): number {
  return kickoffAtForRound(game.season.startedAt, round, game.season.clockShift)
}

/** 当前轮的结算时刻，也就是下一轮开赛的时刻。 */
export function nextMatchdayAt(game: GameState): number {
  return roundKickoffAt(game, game.season.round + 1)
}

/** 赛后休整还要多久（升级附加赛窗口）。 */
export function nextSeasonCountdown(game: GameState, now = Date.now()): string {
  const diff = Math.max(0, seasonEndAt(game.season.startedAt, game.season.clockShift) - now)
  const days = Math.floor(diff / GAME_DAY_MS)
  const hours = Math.floor((diff % GAME_DAY_MS) / 3_600_000)
  const minutes = Math.floor((diff % 3_600_000) / 60_000)
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  return `${minutes} 分钟`
}

/** 赛季结束后是否还在赛后休整窗口里（这期间只能踢友谊赛）。 */
export function inPostseason(game: GameState, now = Date.now()): boolean {
  return game.season.finished && now < seasonEndAt(game.season.startedAt, game.season.clockShift)
}

export function matchdayCountdown(game: GameState, now = Date.now()): string {
  if (game.season.finished) return '赛季结束'
  const diff = Math.max(0, nextMatchdayAt(game) - now)
  const hours = Math.floor(diff / 3_600_000)
  const minutes = Math.floor((diff % 3_600_000) / 60_000)
  return `${hours} 小时 ${minutes} 分`
}

/**
 * 一线队和电脑球队全部球员的体能恢复结算到 at（每小时 +5，见 condition.ts）。
 * 自动补算多轮比赛时按每轮的开球时间逐轮结算，再结算到现在，所以不会把比赛之后的休息算到比赛之前。
 */
export function settleGameConditions(game: GameState, at: number): boolean {
  const players = [...game.roster, ...game.aiTeams.flatMap((team) => team?.players ?? [])]
  return settleConditions(players, at, game.season?.gameDayMs ?? GAME_DAY_MS)
}

/** 电脑球队的训练精力按轮间隔补（一线队的按时间连续恢复，见 energy.ts）。体能按时间结算，不在这里。 */
function recoverAIEnergy(game: GameState, gameDays: number): void {
  for (const player of game.aiTeams.flatMap((team) => team.players)) {
    player.energy = clamp((player.energy ?? 100) + gameDays * ENERGY_RECOVERY_PER_GAME_DAY, 0, 100)
  }
}

/* ---------- 离线存档：手动把日历快进到比赛日 ---------- */

/**
 * 把存档里的时间锚点一起往前挪 delta 毫秒，存档时钟（clockShift）同时往前拨 delta。
 * 赛季起点、每场比赛的开球时间、世界日历都要同时动，否则“第 N 轮”和“第几天”会再次错开；
 * 开赛时间点按存档时钟的 12:00 / 20:00 算，所以挪完以后赛程仍然对得上。
 */
function shiftCalendar(game: GameState, delta: number): void {
  if (!Number.isFinite(delta) || delta <= 0) return
  // 当前赛季就是世界里玩家那个分区；其他分区一起挪，各挪一次。
  for (const season of new Set([game.season, ...(game.world?.divisions ?? [])])) {
    season.startedAt -= delta
    season.clockShift = (season.clockShift ?? 0) + delta
    for (const fixture of season.fixtures ?? []) {
      if (typeof fixture.kickoffAt === 'number') fixture.kickoffAt -= delta
    }
  }
  if (game.world) {
    if (typeof game.world.calendarStartAt === 'number') game.world.calendarStartAt -= delta
    else game.createdAt -= delta
    game.world.seasonStartedAt -= delta
    game.world.clockShift = (game.world.clockShift ?? 0) + delta
  } else {
    // 没有世界数据的老存档：顶栏日期回退到建档时间。
    game.createdAt -= delta
  }
}

/** 时间往前跳了多久，伤病就愈合多久（伤病存的是绝对时间）。 */
function shiftInjuries(game: GameState, delta: number, now: number): void {
  if (!game.injuries) return
  for (const [key, until] of Object.entries(game.injuries)) {
    if (!Number.isFinite(until)) continue
    if (until - delta <= now) delete game.injuries[key]
    else game.injuries[key] = until - delta
  }
}

function skipCalendar(game: GameState, delta: number, now: number): { ok: boolean; gameDays: number } {
  if (!(delta > 0)) return { ok: true, gameDays: 0 }
  const gameDays = delta / game.season.gameDayMs
  // 先把精力结算到现在（没记过时间的从现在开始记），再把时钟往回拨跳过的时长，补上这段时间的恢复。
  settleSquadEnergy(game, now)
  // 体能同理：先结算到现在，再把结算时间往回拨，跳过的这段按休息恢复。
  settleGameConditions(game, now)
  shiftCalendar(game, delta)
  shiftEnergyClock(game, delta)
  shiftConditionClock([...game.roster, ...game.aiTeams.flatMap((team) => team.players)], delta)
  // 报价的回复期限也按游戏日算：时间往前跳，期限跟着往前挪。
  for (const offer of game.transferOffers ?? []) {
    if (offer.status !== 'pending') continue
    offer.createdAt -= delta
    offer.expiresAt -= delta
  }
  recoverAIEnergy(game, gameDays)
  settleGameConditions(game, now)
  settleSquadEnergy(game, now)
  shiftInjuries(game, delta, now)
  return { ok: true, gameDays }
}

/**
 * 离线存档：把游戏日历快进到本轮比赛日。
 * 「跳至比赛日」用的就是它：日期、赛程、体能和伤病一起按跳过的天数推进，
 * 避免只踢了 5 轮、日历还停在第 2 天。
 */
export function skipToMatchday(game: GameState, now = Date.now()): { ok: boolean; error?: string; gameDays: number } {
  if (game.season.finished) return { ok: false, error: '赛季已经结束', gameDays: 0 }
  if (game.activeMatch) return { ok: true, gameDays: 0 }
  return skipCalendar(game, roundKickoffAt(game, game.season.round) - now, now)
}

/** 离线存档：把赛后休整快进到结束，之后就能开始下一赛季。 */
export function skipToPostseasonEnd(game: GameState, now = Date.now()): { ok: boolean; error?: string; gameDays: number } {
  if (!game.season.finished) return { ok: false, error: '常规赛还没结束', gameDays: 0 }
  if (now >= seasonEndAt(game.season.startedAt, game.season.clockShift)) return { ok: true, gameDays: 0 }
  return skipCalendar(game, seasonEndAt(game.season.startedAt, game.season.clockShift) - now, now)
}

/**
 * 联赛踢完一场：两队整个名单各记一笔出场分钟（没进比赛名单、没上场记 0），只留最近 20 场。
 * 俱乐部判断放不放人时看这份记录（见 transfer-rules.ts）。
 */
function recordAppearances(game: GameState, homeId: string, awayId: string, stats: MatchRecord['playerStats']): void {
  const minutes = new Map<string, number>()
  for (const stat of stats) minutes.set(stat.sourceId ?? stat.playerId.split(':').slice(1).join(':'), stat.minutes)
  const squads = [homeId, awayId].map((id) => (id === PLAYER_TEAM_ID ? game.roster : game.aiTeams.find((team) => team.id === id)?.players ?? []))
  const book = (game.appearances ??= {})
  for (const squad of squads) {
    for (const player of squad) book[player.id] = [...(book[player.id] ?? []), Math.round(minutes.get(player.id) ?? 0)].slice(-RECENT_MATCHES)
  }
  // 换赛季后旧名单的人不再出现：记录太多时只留当前还在名单上的。
  if (Object.keys(book).length > 2000) {
    const present = new Set([...game.roster, ...game.aiTeams.flatMap((team) => team.players)].map((player) => player.id))
    for (const id of Object.keys(book)) if (!present.has(id)) delete book[id]
  }
}

function applyMatchConditions(game: GameState, stats: MatchRecord['playerStats']): void {
  const all = new Map<string, { condition: number }>()
  for (const player of game.roster) all.set(player.id, player)
  for (const team of game.aiTeams) for (const player of team.players) all.set(player.id, player)
  for (const stat of stats) {
    const id = stat.sourceId ?? stat.playerId.split(':').slice(1).join(':')
    const player = all.get(id)
    if (!player) continue
    // 踢满 90 分钟掉 70 点（见 condition.ts）。
    applyConditionLoss(player, stat.minutes)
  }
}

export function simulateFixture(game: GameState, fixture: Fixture, auto = false, now = auto ? fixture.kickoffAt ?? Date.now() : Date.now()): MatchRecord | null {
  if (fixture.played) return null
  const homeAI = fixture.homeId === PLAYER_TEAM_ID ? null : game.aiTeams.find((team) => team.id === fixture.homeId)
  const awayAI = fixture.awayId === PLAYER_TEAM_ID ? null : game.aiTeams.find((team) => team.id === fixture.awayId)
  if (!homeAI && fixture.homeId !== PLAYER_TEAM_ID) return null
  if (!awayAI && fixture.awayId !== PLAYER_TEAM_ID) return null
  const context: MatchContext = {
    isLeague: true,
    round: fixture.round,
    opponentId: fixture.homeId === PLAYER_TEAM_ID ? fixture.awayId : fixture.homeId,
    opponentName: teamName(game, fixture.homeId === PLAYER_TEAM_ID ? fixture.awayId : fixture.homeId),
    seed: splitSeed(game.season.seed, `fixture-${fixture.round}-${fixture.homeId}-${fixture.awayId}`),
    homeAway: fixture.homeId === PLAYER_TEAM_ID ? 'home' : 'away',
    durationSeconds: LEAGUE_MATCH_SECONDS,
  }
  const engine = buildMatchEngineForGame(game, context, homeAI ?? awayAI!, now, suspendedPlayerIds(game), auto ? 2 : undefined)
  const state = engine.simulate()
  recordMatchInjuries(game, state, now, auto)
  if (game.world) recordMatchDiscipline(game, state)
  const record = createMatchRecord(game, state, context)
  if (auto) record.autoSimulated = true
  fixture.played = true
  fixture.score = { ...record.score }
  fixture.matchId = record.id
  const tally = fixtureScorers(state)
  fixture.scorers = tally.scorers
  fixture.assisters = tally.assisters
  if (auto) fixture.autoSimulated = true
  applyMatchConditions(game, record.playerStats)
  recordAppearances(game, fixture.homeId, fixture.awayId, record.playerStats)
  return record
}

export function simulateAIFixturesInRound(game: GameState, round = game.season.round, now = Date.now(), historical = false): void {
  for (const fixture of game.season.fixtures) {
    if (fixture.round !== round || fixture.played || fixture.isPlayer) continue
    const home = game.aiTeams.find((team) => team.id === fixture.homeId)
    const away = game.aiTeams.find((team) => team.id === fixture.awayId)
    if (!home || !away) continue
    const seed = splitSeed(game.season.seed, `ai-${round}-${fixture.homeId}-${fixture.awayId}`)
    const state = simulateAIvsAIState(home, away, seed, LEAGUE_MATCH_SECONDS, game.injuries, now, suspendedPlayerIds(game))
    recordMatchInjuries(game, state, now, historical)
    recordMatchDiscipline(game, state)
    fixture.score = { home: state.score.home, away: state.score.away }
    fixture.played = true
    const tally = fixtureScorers(state)
    fixture.scorers = tally.scorers
    fixture.assisters = tally.assisters
    const record = createMatchRecord(game, state, {
      isLeague: true,
      round,
      opponentId: home.id,
      opponentName: home.name,
      seed,
      homeAway: 'home',
      durationSeconds: LEAGUE_MATCH_SECONDS,
    })
    record.autoSimulated = true
    applyMatchConditions(game, record.playerStats)
    recordAppearances(game, fixture.homeId, fixture.awayId, record.playerStats)
  }
  updateSeasonTable(game)
}

/** 真实时间推进：到点的轮次自动结算，包括玩家未进行的比赛。 */
export function catchUpSeason(game: GameState, now = Date.now()): { advanced: number; records: MatchRecord[]; rested: boolean } {
  const records: MatchRecord[] = []
  // 一线队精力按时间补算（比赛进行中、赛季结束后也照常恢复）。
  settleSquadEnergy(game, now)
  // 过期的报价（4 个游戏日没回复）按拒绝处理。
  expireOffers(game, now)
  // 自由市场每个游戏日补到 200 人，前几天没人要的随机球员销毁（联机由服务器补）。
  refreshLocalFreeMarket(game, now)
  if (game.activeMatch || game.season.finished) return { advanced: 0, records, rested: settleGameConditions(game, now) }
  economyOf(game)
  const target = dueRound(game, now)
  let advanced = 0
  while (game.season.round < target && !game.season.finished) {
    const round = game.season.round
    // 体能先按休息结算到这一轮开球，再踢这一轮（补算多轮时不把之后的休息提前算进来）。
    settleGameConditions(game, Math.min(now, roundKickoffAt(game, round)))
    const playerMatch = playerFixture(game, round)
    if (playerMatch && !playerMatch.played) {
      const record = simulateFixture(game, playerMatch, true, roundKickoffAt(game, round))
      if (record) records.push(record)
    }
    simulateAIFixturesInRound(game, round, roundKickoffAt(game, round), true)
    updateSeasonTable(game)
    if (!isRoundComplete(game, round)) break
    awardRoundIncome(game, round)
    settleMarket(game, round)
    runAIClubs(game, round)
    // AI 互相挖人、给玩家报价（单机；联机由服务器在共享名册上做）。
    runLocalTransfers(game, round, now)
    if (game.world) {
      simulateOtherDivisions(game, round)
      payWorldWages(game, round)
      serveSuspensions(game, round)
    }
    advanced++
    if (round < ROUNDS && !game.season.finished) {
      game.season.round = round + 1
      recoverAIEnergy(game, roundGapGameDays(game.season.startedAt, round, game.season.clockShift))
    }
    updateSeasonTable(game)
  }
  const rested = settleGameConditions(game, now)
  for (const record of records) {
    if (record.isLeague && (record.homeId === PLAYER_TEAM_ID || record.awayId === PLAYER_TEAM_ID)) game.matchHistory.unshift(record)
  }
  return { advanced, records, rested }
}

/** 玩家比赛结束后推进：模拟同轮剩余 AI 比赛并进入下一轮。 */
export function advanceSeasonRound(game: GameState, now = Date.now()): { ok: boolean; error?: string } {
  if (game.season.finished) return { ok: false, error: '赛季已经结束' }
  economyOf(game)
  const round = game.season.round
  const playerMatch = playerFixture(game, round)
  if (playerMatch && !playerMatch.played) return { ok: false, error: '本轮玩家比赛还未进行' }
  settleGameConditions(game, now)
  simulateAIFixturesInRound(game, round, now)
  updateSeasonTable(game)
  if (!isRoundComplete(game, round)) return { ok: false, error: '本轮仍有比赛未完成' }
  awardRoundIncome(game, round)
  settleMarket(game, round)
  runAIClubs(game, round)
  runLocalTransfers(game, round, now)
  if (game.world) {
    simulateOtherDivisions(game, round)
    payWorldWages(game, round)
    serveSuspensions(game, round)
  }
  if (!game.season.finished && round < ROUNDS) {
    game.season.round = round + 1
    recoverAIEnergy(game, roundGapGameDays(game.season.startedAt, round, game.season.clockShift))
  }
  updateSeasonTable(game)
  return { ok: true }
}

/** 把毫秒差写成“X 天 X 小时 / X 小时 X 分 / X 分”。 */
export function shortCountdown(ms: number): string {
  const diff = Math.max(0, ms)
  const days = Math.floor(diff / 86_400_000)
  const hours = Math.floor((diff % 86_400_000) / 3_600_000)
  const minutes = Math.floor((diff % 3_600_000) / 60_000)
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  return `${minutes} 分`
}

/**
 * 下一场比赛倒计时始终指向固定开球时间；到点未结算时显示“即将开赛”，
 * 本轮结算后显示下一轮开球时间。
 */
export function nextMatchCountdown(game: GameState, now = Date.now()): string {
  if (game.shared) {
    const future = game.season.fixtures.filter((fixture) => fixture.isPlayer && !fixture.played && roundKickoffAt(game, fixture.round) > now)
      .sort((a, b) => a.round - b.round)[0]
    if (future) return shortCountdown(roundKickoffAt(game, future.round) - now)
    return game.season.finished ? '赛季结束' : '结果结算中'
  }
  const fixture = playerFixture(game, game.season.round)
  if (fixture && !fixture.played) {
    const kickoff = roundKickoffAt(game, game.season.round)
    // 还没到固定开球时间时不能提前结算。
    if (now < kickoff) return shortCountdown(kickoff - now)
    return '即将开赛'
  }
  return shortCountdown(roundKickoffAt(game, Math.min(ROUNDS, game.season.round + 1)) - now)
}

/** 开赛前这么久锁定阵容：锁了之后不能再改首发 / 替补 / 职责 / 战术 / 自动换人。 */
export const LINEUP_LOCK_MS = 30 * 60_000

/**
 * 联机阵容锁：当前轮开赛前 30 分钟到本轮结算之前不能再改阵容。
 * 本轮已经结算（fixture.played）后立即解锁，方便准备下一轮。
 */
export function lineupLockState(game: GameState, now = Date.now()): { locked: boolean; lockAt: number; kickoffAt: number } {
  if (game.shared) {
    const future = game.season.fixtures.filter((fixture) => fixture.isPlayer && !fixture.played && roundKickoffAt(game, fixture.round) > now)
      .sort((a, b) => a.round - b.round)[0]
    const kickoffAt = roundKickoffAt(game, future?.round ?? Math.min(ROUNDS, game.season.round + 1))
    const lockAt = kickoffAt - LINEUP_LOCK_MS
    // 已开球的场次输入已经持久化；即使重启恢复时尚在排队，也能准备下一场。
    return { locked: !!future && now >= lockAt, lockAt, kickoffAt }
  }
  const current = playerFixture(game, game.season.round)
  if (current && !current.played) {
    const kickoff = roundKickoffAt(game, game.season.round)
    return { locked: now >= kickoff - LINEUP_LOCK_MS, lockAt: kickoff - LINEUP_LOCK_MS, kickoffAt: kickoff }
  }
  // 本轮已结算时，锁的是下一轮：上一轮踢完后到下一轮开赛前 30 分钟之间仍然可以准备阵容。
  const next = Math.min(ROUNDS, game.season.round + 1)
  const kickoff = roundKickoffAt(game, next)
  const target = playerFixture(game, next)
  const lockAt = kickoff - LINEUP_LOCK_MS
  return { locked: !!target && !target.played && now >= lockAt, lockAt, kickoffAt: kickoff }
}

/**
 * 联机：到了开赛时间还没踢的当前轮比赛由服务器自动结算（用玩家已保存的阵容 / 战术 / 自动换人），
 * 玩家下次打开页面直接看到比分。更早的轮次由 catchUpSeason 补算；有进行中的比赛时不抢。
 */
export function settleDuePlayerMatch(game: GameState, now = Date.now()): MatchRecord | null {
  if (game.activeMatch || game.season.finished) return null
  const round = game.season.round
  if (now < roundKickoffAt(game, round)) return null
  const fixture = playerFixture(game, round)
  if (!fixture || fixture.played) return null
  const record = simulateFixture(game, fixture, true, roundKickoffAt(game, round))
  if (!record) return null
  game.matchHistory.unshift(record)
  updateSeasonTable(game)
  return record
}

export function startLeagueMatch(game: GameState, now = Date.now()): { ok: boolean; error?: string; context?: MatchContext } {
  if (game.activeMatch) return { ok: false, error: '已有进行中的比赛' }
  if (game.season.finished) return { ok: false, error: '赛季已经结束' }
  const overLimit = squadLimitError(game)
  if (overLimit) return { ok: false, error: overLimit }
  const fixture = playerFixture(game)
  if (!fixture) return { ok: false, error: '本轮没有你的比赛' }
  if (fixture.played) return { ok: false, error: '本轮比赛已经完成' }
  const suspended = suspendedPlayerIds(game)
  const unavailable = game.lineup.starters.find((starter) => suspended.has(starter.playerId)) ?? (game.lineup.bench.map((id) => ({ playerId: id })).find((item) => suspended.has(item.playerId)))
  if (unavailable) return { ok: false, error: '首发或替补中有停赛球员，请调整阵容' }
  const opponentId = fixture.homeId === PLAYER_TEAM_ID ? fixture.awayId : fixture.homeId
  const ai = game.aiTeams.find((team) => team.id === opponentId)
  if (!ai) return { ok: false, error: '找不到对手' }
  const context: MatchContext = {
    isLeague: true,
    round: game.season.round,
    opponentId: ai.id,
    opponentName: ai.name,
    seed: splitSeed(game.season.seed, `league-${game.season.round}-${ai.id}`),
    homeAway: fixture.homeId === PLAYER_TEAM_ID ? 'home' : 'away',
    durationSeconds: LEAGUE_MATCH_SECONDS,
    offside: true,
  }
  // 开球前把休息恢复的体能结算到现在。
  settleGameConditions(game, now)
  const engine = buildMatchEngineForGame(game, context, ai, now)
  game.activeMatch = {
    context,
    engineState: engine.serialize(),
    instructions: [],
    lineup: structuredClone(game.lineup),
    startedAt: now,
    coachPausesLeft: 3,
  }
  return { ok: true, context }
}

/** 任意一支球队的友谊赛；赛季休整期间也可以约世界里的其他球队。 */
export function startChallengeAgainstTeam(
  game: GameState,
  ai: AITeam,
  seed: number,
  now = Date.now(),
): { ok: boolean; error?: string; context?: MatchContext } {
  if (game.activeMatch) return { ok: false, error: '已有进行中的比赛' }
  const overLimit = squadLimitError(game)
  if (overLimit) return { ok: false, error: overLimit }
  const context: MatchContext = {
    isLeague: false,
    opponentId: ai.id,
    opponentName: ai.name,
    seed,
    homeAway: 'home',
    durationSeconds: LEAGUE_MATCH_SECONDS,
    offside: true,
  }
  // 开球前把休息恢复的体能结算到现在。
  settleGameConditions(game, now)
  const engine = buildMatchEngineForGame(game, context, ai, now)
  game.activeMatch = {
    context,
    engineState: engine.serialize(),
    instructions: [],
    lineup: structuredClone(game.lineup),
    startedAt: now,
    coachPausesLeft: 3,
  }
  return { ok: true, context }
}

export function startChallenge(game: GameState, aiId: string, now = Date.now()): { ok: boolean; error?: string; context?: MatchContext } {
  if (game.activeMatch) return { ok: false, error: '已有进行中的比赛' }
  const overLimit = squadLimitError(game)
  if (overLimit) return { ok: false, error: overLimit }
  const ai = game.aiTeams.find((team) => team.id === aiId)
  if (!ai) return { ok: false, error: '找不到对手' }
  const context: MatchContext = {
    isLeague: false,
    opponentId: ai.id,
    opponentName: ai.name,
    seed: splitSeed(game.seed, `friendly-${ai.id}-${game.challengeHistory.length}`),
    homeAway: 'home',
    durationSeconds: LEAGUE_MATCH_SECONDS,
    offside: true,
  }
  // 开球前把休息恢复的体能结算到现在。
  settleGameConditions(game, now)
  const engine = buildMatchEngineForGame(game, context, ai, now)
  game.activeMatch = {
    context,
    engineState: engine.serialize(),
    instructions: [],
    lineup: structuredClone(game.lineup),
    startedAt: now,
    coachPausesLeft: 3,
  }
  return { ok: true, context }
}

export function finishActiveMatch(game: GameState, engine: GameEngine, now = Date.now()): MatchRecord | null {
  const active = game.activeMatch
  if (!active) return null
  const state = engine.serialize()
  if (!state.finished) return null
  economyOf(game)
  recordMatchInjuries(game, state, active.context.isLeague ? active.startedAt : now, active.context.isLeague)
  const record = createMatchRecord(game, state, active.context)
  applyMatchConditions(game, record.playerStats)
  if (active.context.isLeague) {
    const home = active.context.homeAway === 'home' ? PLAYER_TEAM_ID : active.context.opponentId
    recordAppearances(game, home, home === PLAYER_TEAM_ID ? active.context.opponentId : PLAYER_TEAM_ID, record.playerStats)
    const round = active.context.round ?? game.season.round
    const fixture = game.season.fixtures.find((item) => item.round === round && item.isPlayer)
    if (fixture) {
      fixture.played = true
      fixture.score = { ...record.score }
      fixture.matchId = record.id
      const tally = fixtureScorers(state)
      fixture.scorers = tally.scorers
      fixture.assisters = tally.assisters
    }
    game.matchHistory.unshift(record)
    simulateAIFixturesInRound(game, round, active.startedAt, true)
    updateSeasonTable(game)
    if (game.world) {
      simulateOtherDivisions(game, round)
      recordMatchDiscipline(game, state)
    }
    if (isRoundComplete(game, round)) {
      awardRoundIncome(game, round)
      settleMarket(game, round)
      if (game.world) {
        payWorldWages(game, round)
        serveSuspensions(game, round)
      }
      if (!game.season.finished && round < ROUNDS) {
        game.season.round = round + 1
        recoverAIEnergy(game, roundGapGameDays(game.season.startedAt, round, game.season.clockShift))
      }
      updateSeasonTable(game)
    }
  } else {
    game.challengeHistory.unshift(record)
  }
  game.activeMatch = undefined
  return record
}

export function seasonRoundLabel(game: GameState): string {
  if (game.season.finished) return '赛季结束'
  return `第 ${game.season.round} / ${ROUNDS} 轮`
}

export function fixtureLabel(game: GameState, fixture: Fixture): string {
  return `${teamName(game, fixture.homeId)} vs ${teamName(game, fixture.awayId)}${fixture.played && fixture.score ? ` · ${fixture.score.home}:${fixture.score.away}` : ''}`
}
