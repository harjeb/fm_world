import type { AITeam, Fixture, GameState, MatchContext, MatchRecord, SeasonState, SeasonTableRow } from './types.ts'
import { splitSeed } from './rng.ts'
import { buildMatchEngineForGame, createMatchRecord, simulateAIvsAIState } from './match/setup.ts'
import { MatchEngine } from './match/engine.ts'
import { ENERGY_RECOVERY_PER_GAME_DAY } from './training.ts'
import { GAME_DAY_MS, ROUND_GAME_DAYS, ROUND_MS, elapsedGameDays, gameDayOfRound, kickoffAtForRound } from './calendar.ts'
import { recordMatchInjuries } from './injury.ts'
import { awardRoundIncome, economyOf } from './economy.ts'
import { playerMarketValue, settleMarket } from './market.ts'
import { LOGIC_MATCH_SECONDS } from './match/time.ts'
import { advanceWorldSeason, simulateOtherDivisions, syncPlayerDivision, payWorldWages } from './world.ts'
import { recordMatchDiscipline, serveSuspensions, suspendedPlayerIds } from './discipline.ts'

export const PLAYER_TEAM_ID = 'player'
export const ROUNDS = 38
export { GAME_DAY_MS, ROUND_GAME_DAYS, ROUND_MS } from './calendar.ts'
export { LEAGUE_REALTIME_SECONDS } from './match/time.ts'
export const LEAGUE_MATCH_SECONDS = LOGIC_MATCH_SECONDS

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function createSeason(seed: number, aiTeams: AITeam[], clubName: string, startedAt = Date.now()): SeasonState {
  const ids = [PLAYER_TEAM_ID, ...aiTeams.map((team) => team.id)]
  const fixtures = buildFixtures(ids, startedAt)
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
    roundGameDays: ROUND_GAME_DAYS,
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
  const next = createSeason(splitSeed(game.seed, `season-${index}`), game.aiTeams, game.clubName, now)
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

/** 20 队双循环：19 轮首循环 + 19 轮次循环，每 4 个游戏日一轮（现实 24 小时）。 */
function buildFixtures(teamIds: string[], startedAt: number): Fixture[] {
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
      gameDay: gameDayOfRound(match.round),
      kickoffAt: kickoffAtForRound(startedAt, match.round),
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
  const elapsed = Math.max(0, now - game.season.startedAt)
  return Math.min(ROUNDS + 1, 1 + Math.floor(elapsed / ROUND_MS))
}

export function seasonDay(game: GameState, now = Date.now()): number {
  return elapsedGameDays(game.season.startedAt, now) + 1
}

export function roundKickoffAt(game: GameState, round = game.season.round): number {
  return kickoffAtForRound(game.season.startedAt, round)
}

export function nextMatchdayAt(game: GameState): number {
  return roundKickoffAt(game, game.season.round)
}

export function matchdayCountdown(game: GameState, now = Date.now()): string {
  if (game.season.finished) return '赛季结束'
  const diff = Math.max(0, nextMatchdayAt(game) - now)
  const hours = Math.floor(diff / 3_600_000)
  const minutes = Math.floor((diff % 3_600_000) / 60_000)
  return `${hours} 小时 ${minutes} 分`
}

function recoverConditions(game: GameState, gameDays: number): void {
  const all = [...game.roster, ...game.aiTeams.flatMap((team) => team.players)]
  for (const player of all) {
    player.condition = clamp((player.condition ?? 100) + gameDays * 7, 1, 100)
    player.energy = clamp((player.energy ?? 100) + gameDays * ENERGY_RECOVERY_PER_GAME_DAY, 0, 100)
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
    const loss = stat.minutes * 0.1 + Math.max(0, 55 - stat.staminaLeft) * 0.35
    player.condition = clamp(player.condition - loss, 1, 100)
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
  const engine = buildMatchEngineForGame(game, context, homeAI ?? awayAI!, now, suspendedPlayerIds(game))
  const state = engine.simulate()
  recordMatchInjuries(game, state, now, auto)
  if (game.world) recordMatchDiscipline(game, state)
  const record = createMatchRecord(game, state, context)
  if (auto) record.autoSimulated = true
  fixture.played = true
  fixture.score = { ...record.score }
  fixture.matchId = record.id
  if (auto) fixture.autoSimulated = true
  applyMatchConditions(game, record.playerStats)
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
  }
  updateSeasonTable(game)
}

/** 真实时间推进：到点的轮次自动结算，包括玩家未进行的比赛。 */
export function catchUpSeason(game: GameState, now = Date.now()): { advanced: number; records: MatchRecord[] } {
  const records: MatchRecord[] = []
  if (game.activeMatch || game.season.finished) return { advanced: 0, records }
  economyOf(game)
  const target = dueRound(game, now)
  let advanced = 0
  while (game.season.round < target && !game.season.finished) {
    const round = game.season.round
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
    if (game.world) {
      simulateOtherDivisions(game, round)
      payWorldWages(game, round)
      serveSuspensions(game, round)
    }
    advanced++
    if (round < ROUNDS && !game.season.finished) {
      game.season.round = round + 1
      recoverConditions(game, ROUND_GAME_DAYS)
    }
    updateSeasonTable(game)
  }
  for (const record of records) {
    if (record.isLeague && (record.homeId === PLAYER_TEAM_ID || record.awayId === PLAYER_TEAM_ID)) game.matchHistory.unshift(record)
  }
  return { advanced, records }
}

/** 玩家比赛结束后推进：模拟同轮剩余 AI 比赛并进入下一轮。 */
export function advanceSeasonRound(game: GameState, now = Date.now()): { ok: boolean; error?: string } {
  if (game.season.finished) return { ok: false, error: '赛季已经结束' }
  economyOf(game)
  const round = game.season.round
  const playerMatch = playerFixture(game, round)
  if (playerMatch && !playerMatch.played) return { ok: false, error: '本轮玩家比赛还未进行' }
  simulateAIFixturesInRound(game, round, now)
  updateSeasonTable(game)
  if (!isRoundComplete(game, round)) return { ok: false, error: '本轮仍有比赛未完成' }
  awardRoundIncome(game, round)
  settleMarket(game, round)
  if (game.world) {
    simulateOtherDivisions(game, round)
    payWorldWages(game, round)
    serveSuspensions(game, round)
  }
  if (!game.season.finished && round < ROUNDS) {
    game.season.round = round + 1
    recoverConditions(game, ROUND_GAME_DAYS)
  }
  updateSeasonTable(game)
  return { ok: true }
}

export function startLeagueMatch(game: GameState, now = Date.now()): { ok: boolean; error?: string; context?: MatchContext } {
  if (game.activeMatch) return { ok: false, error: '已有进行中的比赛' }
  if (game.season.finished) return { ok: false, error: '赛季已经结束' }
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
    offside: game.settings?.offside ?? true,
  }
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
  const ai = game.aiTeams.find((team) => team.id === aiId)
  if (!ai) return { ok: false, error: '找不到对手' }
  const context: MatchContext = {
    isLeague: false,
    opponentId: ai.id,
    opponentName: ai.name,
    seed: splitSeed(game.seed, `friendly-${ai.id}-${game.challengeHistory.length}`),
    homeAway: 'home',
    durationSeconds: LEAGUE_MATCH_SECONDS,
    offside: game.settings?.offside ?? true,
  }
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

export function finishActiveMatch(game: GameState, engine: MatchEngine, now = Date.now()): MatchRecord | null {
  const active = game.activeMatch
  if (!active) return null
  const state = engine.serialize()
  if (!state.finished) return null
  economyOf(game)
  recordMatchInjuries(game, state, active.context.isLeague ? active.startedAt : now, active.context.isLeague)
  const record = createMatchRecord(game, state, active.context)
  applyMatchConditions(game, record.playerStats)
  if (active.context.isLeague) {
    const round = active.context.round ?? game.season.round
    const fixture = game.season.fixtures.find((item) => item.round === round && item.isPlayer)
    if (fixture) {
      fixture.played = true
      fixture.score = { ...record.score }
      fixture.matchId = record.id
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
        recoverConditions(game, ROUND_GAME_DAYS)
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
