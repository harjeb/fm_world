import type {
  AITeam,
  ConferenceId,
  Fixture,
  GameState,
  Lineup,
  Player,
  PromotionMatch,
  PromotionPlayoff,
  SeasonState,
  SeasonTableRow,
  TierId,
  WorldClub,
  WorldState,
} from './types.ts'
import { PLAYER_SEEDS, createPlayerFromSeed, seedById } from './data/players.ts'
import { createRandomPlayer, randomSquadPositionTemplate } from './data/random-players.ts'
import { DIVISION_IDS, WORLD_CLUB_DEFS, divisionIdForTier, type WorldClubDef } from './data/world-clubs.ts'
import { autoFillLineup, validateLineup } from './squad.ts'
import { caOf } from './ca.ts'
import { derivedRng, splitSeed, hashString } from './rng.ts'
import { simulateAIvsAIState } from './match/setup.ts'
import { economyOf } from './economy.ts'
import { GAME_DAY_MS, ROUND_GAME_DAYS, ROUND_MS, gameDayOfRound, kickoffAtForRound } from './calendar.ts'

export const WORLD_ROUNDS = 38
const START_YEAR = 2026

export type WorldSetup = {
  world: WorldState
  playerClub: WorldClub
  freeStars: Player[]
  reserveStars: Player[]
}

export type WorldGame = WorldSetup & {
  playerTeam: AITeam
  aiTeams: AITeam[]
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function initialAge(id: string): number {
  return 16 + (hashString(id) % 11)
}

function makeStars(): Player[] {
  return PLAYER_SEEDS.map((seed) => {
    const player = createPlayerFromSeed(seed)
    player.age = initialAge(seed.id)
    player.starKey = seed.id
    player.generation = 0
    return player
  })
}

function clubDefs(seed: number): WorldClubDef[] {
  // 固定名单，seed 只影响球队实力微调和后续生成球员。
  const rng = derivedRng(seed, 'world-clubs')
  return WORLD_CLUB_DEFS.map((def) => ({
    ...def,
    strength: clamp(def.strength + (rng.chance(0.18) ? 1 : rng.chance(0.18) ? -1 : 0), 1, 5),
  }))
}

function pickPlayerClub(defs: WorldClubDef[], requested?: string): WorldClubDef {
  const d2 = defs.filter((club) => club.tier === 'division2')
  return d2.find((club) => club.id === requested) ?? d2[0]
}

export function createWorld(seed: number, requestedClubId?: string, startedAt = Date.now()): WorldSetup {
  const defs = clubDefs(seed)
  const chosen = pickPlayerClub(defs, requestedClubId)
  const clubs: WorldClub[] = defs.map((def) => ({
    ...def,
    id: def.id === chosen.id ? 'player' : def.id,
    name: def.id === chosen.id ? chosen.name : def.name,
    isPlayer: def.id === chosen.id,
    starPlayerIds: [],
  }))
  const allStars = makeStars()
  const used = new Set<string>()
  const starAges: Record<string, number> = {}
  for (const star of allStars) starAges[star.id] = star.age ?? 24
  const byQuality = [...allStars].sort((a, b) => {
    const ta = seedById(a.seedId)?.tier ?? 0
    const tb = seedById(b.seedId)?.tier ?? 0
    return tb - ta || caOf(b.attrs, b.positions.GK > 0) - caOf(a.attrs, a.positions.GK > 0)
  })
  const topTier = clubs.filter((club) => club.tier === 'champions').sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id))
  const secondTier = clubs.filter((club) => club.tier === 'division1').sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id))
  for (const club of [...topTier, ...secondTier]) {
    const target = club.starCount
    let hasGk = false
    for (const star of byQuality) {
      if (club.starPlayerIds.length >= target) break
      if (used.has(star.id)) continue
      if (star.positions.GK > 0 && hasGk) continue
      used.add(star.id)
      club.starPlayerIds.push(star.id)
      hasGk ||= star.positions.GK > 0
    }
  }
  const remaining = allStars.filter((star) => !used.has(star.id))
  // 250 人进入自由市场，其余作为未公开的储备，退役/升班时补充。
  const freeStars = remaining.slice(0, 250)
  const reserveStars = remaining.slice(250)
  const world: WorldState = {
    version: 1,
    seasonIndex: 1,
    seasonStartedAt: startedAt,
    clubs,
    divisions: [],
    playerDivisionId: divisionIdForTier('division2', chosen.conference ?? 'north'),
    starAges,
    history: [],
  }
  world.divisions = buildAllDivisions(world, seed, startedAt)
  const playerClub = clubs.find((club) => club.isPlayer)!
  return { world, playerClub, freeStars, reserveStars }
}

function buildFixtures(teamIds: string[], startedAt: number, playerId = 'player'): Fixture[] {
  const ids = [...teamIds]
  const fixtures: Fixture[] = []
  let order = [...ids]
  const matches: { round: number; a: string; b: string }[] = []
  for (let round = 1; round <= ids.length - 1; round++) {
    for (let index = 0; index < ids.length / 2; index++) {
      const a = order[index]
      const b = order[ids.length - 1 - index]
      const homeId = (round + index) % 2 === 0 ? a : b
      const awayId = homeId === a ? b : a
      matches.push({ round, a: homeId, b: awayId })
    }
    order = [order[0], order[order.length - 1], ...order.slice(1, order.length - 1)]
  }
  const second = matches.map((match) => ({ round: match.round + ids.length - 1, a: match.b, b: match.a }))
  for (const match of [...matches, ...second]) {
    fixtures.push({
      round: match.round,
      homeId: match.a,
      awayId: match.b,
      isPlayer: match.a === playerId || match.b === playerId,
      played: false,
      gameDay: gameDayOfRound(match.round),
      kickoffAt: kickoffAtForRound(startedAt, match.round),
    })
  }
  return fixtures
}

export function computeWorldTable(ids: string[], fixtures: Fixture[], names: Map<string, string>): SeasonTableRow[] {
  const rows = new Map<string, SeasonTableRow>()
  for (const id of ids) rows.set(id, { teamId: id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 })
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

export function buildWorldDivision(
  world: WorldState,
  id: string,
  seed: number,
  startedAt: number,
  index = world.seasonIndex,
): SeasonState {
  const tier: TierId = id === 'champions' ? 'champions' : id === 'division1' ? 'division1' : 'division2'
  const conference: ConferenceId | undefined = id === 'd2-south' ? 'south' : id === 'd2-north' ? 'north' : undefined
  const clubs = world.clubs.filter((club) => divisionIdForTier(club.tier, club.conference) === id)
  const clubIds = clubs.map((club) => club.id)
  const fixtures = buildFixtures(clubIds, startedAt)
  const names = new Map(clubs.map((club) => [club.id, club.name]))
  const season: SeasonState = {
    index,
    round: 1,
    fixtures,
    table: computeWorldTable(clubIds, fixtures, names),
    finished: false,
    champion: null,
    playerFinish: null,
    seed: splitSeed(seed, `division-${id}-${index}`),
    startedAt,
    gameDayMs: GAME_DAY_MS,
    roundGameDays: ROUND_GAME_DAYS,
    divisionId: id,
    tier,
    conference,
    clubIds,
  }
  return season
}

function buildAllDivisions(world: WorldState, seed: number, startedAt: number): SeasonState[] {
  const result: SeasonState[] = []
  for (const id of DIVISION_IDS) {
    const season = buildWorldDivision(world, id, seed, startedAt)
    const playerIn = season.clubIds?.includes('player')
    result.push(season)
    if (playerIn) world.playerDivisionId = id
  }
  return result
}

function starPlayer(id: string, world: WorldState): Player | undefined {
  const seed = seedById(id)
  if (!seed) return undefined
  const player = createPlayerFromSeed(seed)
  player.starKey = id
  player.generation = 0
  player.age = world.starAges[id] ?? player.age ?? 24
  return player
}

function clubById(world: WorldState, id: string): WorldClub {
  const club = world.clubs.find((item) => item.id === id)
  if (!club) throw new Error(`找不到球队 ${id}`)
  return club
}

function teamFromClub(world: WorldState, club: WorldClub, seed: number, playerTeam?: { roster: Player[]; lineup: Lineup }): AITeam {
  if (club.isPlayer && playerTeam) {
    return {
      ...club,
      players: playerTeam.roster,
      lineup: playerTeam.lineup,
      playerNames: club.starPlayerIds.map((id) => world.starAges[id] ? seedById(id)?.name ?? id : id),
    }
  }
  const rng = derivedRng(seed, 'club-squad', club.id, world.seasonIndex)
  const usedNames = new Set<string>()
  const stars = club.starPlayerIds.map((id) => starPlayer(id, world)).filter((p): p is Player => !!p)
  for (const star of stars) {
    usedNames.add(star.name)
    usedNames.add(star.enName)
  }
  const byPosition = new Map<string, Player[]>()
  for (const star of stars) {
    const pos = (['GK', 'CB', 'W', 'CM', 'ST'] as const).find((p) => star.positions[p] >= 70) ?? (star.positions.GK > 0 ? 'GK' : 'CM')
    byPosition.set(pos, [...(byPosition.get(pos) ?? []), star])
  }
  const players: Player[] = []
  const template = randomSquadPositionTemplate()
  for (let slot = 0; slot < template.length; slot++) {
    const position = template[slot]
    const star = byPosition.get(position)?.shift()
    if (star) players.push(star)
    else {
      players.push(createRandomPlayer({
        seed: splitSeed(seed, `club-${club.id}-${world.seasonIndex}-${slot}`),
        position,
        tier: club.strength >= 5 ? 4 : club.strength >= 3 ? 3 : 2,
        usedNames,
        idPrefix: `${club.id}-${slot + 1}`,
      }))
    }
  }
  const lineup = autoFillLineup(players, club.formationId, club.tactics)
  const check = validateLineup(players, lineup)
  if (!check.valid) throw new Error(`球队 ${club.name} 阵容不合法：${check.errors.join('；')}`)
  return { ...club, players, lineup, playerNames: stars.map((star) => star.name) }
}

export function buildWorldDivisionTeams(
  world: WorldState,
  divisionId: string,
  seed: number,
  playerTeam?: { roster: Player[]; lineup: Lineup },
): { playerTeam: AITeam; aiTeams: AITeam[] } {
  const division = world.divisions.find((item) => item.divisionId === divisionId)
  if (!division?.clubIds) throw new Error('联赛分区不存在')
  const clubIds = division.clubIds
  const teams = clubIds.map((id) => teamFromClub(world, clubById(world, id), seed, playerTeam))
  const player = teams.find((team) => team.isPlayer)
  if (!player) throw new Error('玩家球队不在当前联赛')
  return { playerTeam: player, aiTeams: teams.filter((team) => !team.isPlayer) }
}

function createWorldGameFromSetup(setup: WorldSetup, seed: number, startedAt: number, clubName?: string): GameState {
  const playerClub = setup.playerClub
  if (clubName) playerClub.name = clubName
  const division = setup.world.divisions.find((item) => item.divisionId === setup.world.playerDivisionId)!
  if (playerClub.starPlayerIds.length === 0) {
    // 玩家从二级开始，但保留一名招牌球员；从一级队调剂，保持 100 名俱乐部球星、250 自由、150 储备。
    const donor = setup.world.clubs.find((club) => club.tier === 'division1' && club.starPlayerIds.length > 1)
    if (donor) {
      playerClub.starPlayerIds = [donor.starPlayerIds.pop()!]
    } else {
      const starter = setup.reserveStars[0] ?? setup.freeStars[0]
      if (starter) {
        playerClub.starPlayerIds = [starter.id]
        setup.reserveStars = setup.reserveStars.filter((player) => player.id !== starter.id)
        setup.freeStars = setup.freeStars.filter((player) => player.id !== starter.id)
      }
    }
  }
  const playerTeam = teamFromClub(setup.world, playerClub, seed)
  const playerRoster = playerTeam.players
  const playerLineup = playerTeam.lineup
  const check = validateLineup(playerRoster, playerLineup)
  if (!check.valid) throw new Error(`初始阵容不合法：${check.errors.join('；')}`)
  const aiTeams = (division.clubIds ?? [])
    .filter((id) => id !== 'player')
    .map((id) => teamFromClub(setup.world, clubById(setup.world, id), seed))
  const game: GameState = {
    version: 3,
    createdAt: startedAt,
    seed,
    clubName: playerTeam.name,
    roster: playerRoster,
    lineup: playerLineup,
    training: {},
    candidates: {},
    season: division,
    aiTeams,
    freeStars: setup.freeStars,
    reserveStars: setup.reserveStars,
    matchHistory: [],
    challengeHistory: [],
    ui: { screen: 'home' },
    world: setup.world,
    suspensions: {},
    yellowCounts: {},
    settings: { offside: true },
  }
  for (const player of playerRoster) {
    player.contract = { clubId: 'player', wage: wageForPlayer(player), expiresSeason: division.index + 3 }
  }
  economyOf(game)
  return game
}

export function createWorldGame(seed = Math.floor(Math.random() * 0x7fffffff), requestedClubId?: string, clubName?: string, startedAt = Date.now()): GameState {
  return createWorldGameFromSetup(createWorld(seed, requestedClubId, startedAt), seed, startedAt, clubName)
}

/** 用于服务器共享世界的无主世界：保留 80 支原始球队，不替换玩家球队。 */
export function createOwnerlessWorld(seed: number, startedAt = Date.now()): { world: WorldState; freeStars: Player[]; reserveStars: Player[] } {
  const setup = createWorld(seed, undefined, startedAt)
  const club = setup.playerClub
  const def = WORLD_CLUB_DEFS.find((item) => item.tier === 'division2' && item.name === club.name && item.conference === club.conference)
  if (def) {
    const oldId = club.id
    club.id = def.id
    club.isPlayer = false
    for (const division of setup.world.divisions) {
      division.clubIds = (division.clubIds ?? []).map((id) => id === oldId ? def.id : id)
      division.table = division.table.map((row) => row.teamId === oldId ? { ...row, teamId: def.id } : row)
      if (division.champion === oldId) division.champion = def.id
      for (const fixture of division.fixtures) {
        if (fixture.homeId === oldId) fixture.homeId = def.id
        if (fixture.awayId === oldId) fixture.awayId = def.id
        fixture.isPlayer = false
      }
    }
    setup.world.playerDivisionId = divisionIdForTier(def.tier, def.conference)
  }
  return { world: setup.world, freeStars: setup.freeStars, reserveStars: setup.reserveStars }
}

/** 新账号接手球队的优先顺序：先低级别，再高级别。 */
const NEW_ACCOUNT_TIERS: TierId[] = ['division2', 'division1', 'champions']

/**
 * 给新账号挑一支没人执教的球队。
 *
 * `aliveAccountIds` 用来剔除「owner 指向已删除账号」的僵尸归属：这类球队视为空位。
 * 全部满员时返回 undefined —— 调用方必须拒绝注册，**不要**回退去覆盖已有归属。
 */
export function pickFreeClubForNewAccount(
  world: WorldState,
  owners: Record<string, string>,
  aliveAccountIds?: Iterable<string>,
): WorldClub | undefined {
  const alive = aliveAccountIds ? new Set(aliveAccountIds) : undefined
  const taken = new Set(
    Object.entries(owners)
      .filter(([, accountId]) => !alive || alive.has(accountId))
      .map(([clubId]) => clubId),
  )
  for (const tier of NEW_ACCOUNT_TIERS) {
    const free = world.clubs.find((club) => club.tier === tier && !taken.has(club.id))
    if (free) return free
  }
  return undefined
}

/** 球队席位统计，用于给前端提示「还有几个空位」。 */
export function worldSlots(
  world: WorldState,
  owners: Record<string, string>,
  aliveAccountIds?: Iterable<string>,
): { total: number; taken: number; free: number } {
  const total = world.clubs.length
  const alive = aliveAccountIds ? new Set(aliveAccountIds) : undefined
  const taken = new Set(
    Object.entries(owners)
      .filter(([, accountId]) => !alive || alive.has(accountId))
      .map(([clubId]) => clubId),
  ).size
  return { total, taken, free: total - taken }
}

/** 由共享世界快照接管一支二级球队；保留已赛场次与当前赛季进度。 */
export function createWorldGameFromWorld(
  base: WorldState,
  clubId: string,
  seed: number,
  startedAt: number,
  freeStars: Player[],
  reserveStars: Player[],
  clubName?: string,
): GameState {
  const world = structuredClone(base)
  const club = world.clubs.find((item) => item.id === clubId)
  if (!club || club.tier !== 'division2') throw new Error('只能接管二级联赛球队')
  const division = world.divisions.find((item) => item.clubIds?.includes(clubId))
  if (!division) throw new Error('找不到球队所在赛区')
  for (const item of world.divisions) {
    item.clubIds = (item.clubIds ?? []).map((id) => id === clubId ? 'player' : id)
    item.table = item.table.map((row) => row.teamId === clubId ? { ...row, teamId: 'player' } : row)
    if (item.champion === clubId) item.champion = 'player'
    for (const fixture of item.fixtures) {
      if (fixture.homeId === clubId) fixture.homeId = 'player'
      if (fixture.awayId === clubId) fixture.awayId = 'player'
      if (fixture.homeId === 'player' || fixture.awayId === 'player') fixture.isPlayer = true
    }
  }
  club.id = 'player'
  club.isPlayer = true
  world.playerDivisionId = division.divisionId ?? world.playerDivisionId
  return createWorldGameFromSetup({
    world,
    playerClub: club,
    freeStars: structuredClone(freeStars),
    reserveStars: structuredClone(reserveStars),
  }, seed, startedAt, clubName)
}

/** 服务器共享世界按现实时间抽象推进；返回是否有变化。 */
export function advanceOwnerlessWorld(world: WorldState, now = Date.now()): boolean {
  const completed = Math.min(38, Math.floor(Math.max(0, now - world.seasonStartedAt) / ROUND_MS))
  let changed = false
  const clubs = new Map(world.clubs.map((club) => [club.id, club]))
  for (const division of world.divisions) {
    for (const fixture of division.fixtures) {
      if (fixture.round > completed || fixture.played) continue
      const home = clubs.get(fixture.homeId)
      const away = clubs.get(fixture.awayId)
      if (!home || !away) continue
      fixture.score = abstractScore(home, away, splitSeed(division.seed, `ownerless-${fixture.round}-${fixture.homeId}-${fixture.awayId}`))
      fixture.played = true
      changed = true
    }
    const names = new Map(division.clubIds?.map((id) => [id, clubs.get(id)?.name ?? id]) ?? [])
    division.table = computeWorldTable(division.clubIds ?? [], division.fixtures, names)
    division.round = Math.min(38, completed + 1)
    division.finished = division.fixtures.every((fixture) => fixture.played)
    if (division.finished) division.champion = division.table[0]?.teamId ?? null
  }
  return changed
}

export function d2ClubChoices(): { id: string; name: string; conference: ConferenceId }[] {
  return WORLD_CLUB_DEFS.filter((club) => club.tier === 'division2').map((club) => ({ id: club.id, name: club.name, conference: club.conference ?? 'north' }))
}

export function wageForPlayer(player: Player): number {
  const ca = caOf(player.attrs, player.positions.GK > 0)
  return Math.max(100, Math.round(ca * 4))
}

export function syncPlayerDivision(game: GameState): void {
  if (!game.world) return
  const division = game.world.divisions.find((item) => item.divisionId === game.world!.playerDivisionId)
  if (!division) return
  const ids = game.season.clubIds ?? ['player', ...game.aiTeams.map((team) => team.id)]
  const names = new Map(ids.map((id) => [id, game.world!.clubs.find((club) => club.id === id)?.name ?? id]))
  const table = computeWorldTable(ids, game.season.fixtures, names)
  game.season.table = table
  game.season.finished = game.season.fixtures.every((fixture) => fixture.played)
  game.season.champion = game.season.finished ? (table[0]?.teamId ?? null) : null
  game.season.playerFinish = game.season.finished ? table.findIndex((row) => row.teamId === 'player') + 1 : null
  division.fixtures = game.season.fixtures
  division.table = table
  division.finished = game.season.finished
  division.champion = game.season.champion
  division.playerFinish = game.season.playerFinish
  division.round = game.season.round
}

export function simulateOtherDivisions(game: GameState, throughRound: number): void {
  if (!game.world) return
  const clubs = new Map(game.world.clubs.map((club) => [club.id, club]))
  for (const division of game.world.divisions) {
    if (division.divisionId === game.world.playerDivisionId) continue
    for (const fixture of division.fixtures) {
      if (fixture.round > throughRound || fixture.played) continue
      const home = clubs.get(fixture.homeId)
      const away = clubs.get(fixture.awayId)
      if (!home || !away) continue
      const score = abstractScore(home, away, splitSeed(division.seed, `abstract-${fixture.round}-${fixture.homeId}-${fixture.awayId}`))
      fixture.score = score
      fixture.played = true
    }
    const names = new Map(division.clubIds?.map((id) => [id, clubs.get(id)?.name ?? id]) ?? [])
    division.table = computeWorldTable(division.clubIds ?? [], division.fixtures, names)
    const playedRounds = division.fixtures.reduce((max, fixture) => fixture.played ? Math.max(max, fixture.round) : max, 0)
    division.round = Math.min(38, playedRounds + 1)
    division.finished = division.fixtures.every((fixture) => fixture.played)
    if (division.finished) division.champion = division.table[0]?.teamId ?? null
  }
}

function poisson(rng: ReturnType<typeof derivedRng>, lambda: number): number {
  const limit = Math.exp(-lambda)
  let product = 1
  let count = 0
  do {
    count++
    product *= rng.float()
  } while (product > limit && count < 10)
  return count - 1
}

function abstractScore(home: WorldClub, away: WorldClub, seed: number): { home: number; away: number } {
  const rng = derivedRng(seed, 'abstract-score')
  const diff = home.strength - away.strength
  const homeXg = clamp(1.35 + diff * 0.22, 0.3, 3.2)
  const awayXg = clamp(1.15 - diff * 0.18, 0.25, 2.9)
  return { home: poisson(rng, homeXg), away: poisson(rng, awayXg) }
}

function tableOf(world: WorldState, divisionId: string, teamId: string): SeasonTableRow {
  const table = world.divisions.find((division) => division.divisionId === divisionId)?.table ?? []
  return table.find((row) => row.teamId === teamId) ?? { teamId, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 }
}

function playoffSeed(world: WorldState): string[] {
  const north = world.divisions.find((division) => division.divisionId === 'd2-north')!
  const south = world.divisions.find((division) => division.divisionId === 'd2-south')!
  const all = [...north.table, ...south.table].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (b.gf - b.ga !== a.gf - a.ga) return (b.gf - b.ga) - (a.gf - a.ga)
    return b.gf - a.gf
  })
  const champions = [north.table[0], south.table[0]].filter(Boolean)
  const rest = all.filter((row) => !champions.some((champ) => champ.teamId === row.teamId)).slice(0, 6)
  return [...champions, ...rest].slice(0, 8).map((row) => row.teamId)
}

function penaltyWinner(homeId: string, awayId: string, seed: number): { home: number; away: number } {
  const rng = derivedRng(seed, 'penalty-shootout')
  let home = 0, away = 0
  for (let i = 0; i < 5; i++) {
    if (rng.chance(0.72)) home++
    if (rng.chance(0.72)) away++
  }
  while (home === away) {
    if (rng.chance(0.72)) home++
    if (rng.chance(0.72)) away++
  }
  return { home, away }
}

function simulatePlayoffMatch(
  game: GameState,
  homeId: string,
  awayId: string,
  stage: PromotionMatch['stage'],
  index: number,
): PromotionMatch {
  const world = game.world!
  const home = clubById(world, homeId)
  const away = clubById(world, awayId)
  const playerTeam = homeId === 'player' ? { roster: game.roster, lineup: game.lineup } : awayId === 'player' ? { roster: game.roster, lineup: game.lineup } : undefined
  const h = homeId === 'player' ? teamFromClub(world, home, splitSeed(world.seasonStartedAt, `playoff-${homeId}`), playerTeam) : teamFromClub(world, home, splitSeed(world.seasonStartedAt, `playoff-${homeId}`))
  const a = awayId === 'player' ? teamFromClub(world, away, splitSeed(world.seasonStartedAt, `playoff-${awayId}`), playerTeam) : teamFromClub(world, away, splitSeed(world.seasonStartedAt, `playoff-${awayId}`))
  const state = simulateAIvsAIState(h, a, splitSeed(game.seed, `playoff-${world.seasonIndex}-${stage}-${homeId}-${awayId}`))
  const score = { home: state.score.home, away: state.score.away }
  let shootout: { home: number; away: number } | undefined
  if (score.home === score.away) shootout = penaltyWinner(homeId, awayId, splitSeed(game.seed, `playoff-pens-${index}`))
  return { id: `po-${stage}-${index}`, stage, homeId, awayId, score, shootout }
}

function winnerOf(match: PromotionMatch): string {
  if (match.shootout) return match.shootout.home > match.shootout.away ? match.homeId : match.awayId
  return (match.score?.home ?? 0) >= (match.score?.away ?? 0) ? match.homeId : match.awayId
}

function loserOf(match: PromotionMatch): string {
  return winnerOf(match) === match.homeId ? match.awayId : match.homeId
}

function runPromotionPlayoff(game: GameState): PromotionPlayoff {
  const teams = playoffSeed(game.world!)
  const matches: PromotionMatch[] = []
  const qf = [0, 1, 2, 3].map((i) => simulatePlayoffMatch(game, teams[i], teams[7 - i], 'quarter', i))
  matches.push(...qf)
  const sf = [
    simulatePlayoffMatch(game, winnerOf(qf[0]), winnerOf(qf[3]), 'semi', 4),
    simulatePlayoffMatch(game, winnerOf(qf[1]), winnerOf(qf[2]), 'semi', 5),
  ]
  matches.push(...sf)
  const third = simulatePlayoffMatch(game, loserOf(sf[0]), loserOf(sf[1]), 'third', 6)
  matches.push(third)
  const final = simulatePlayoffMatch(game, winnerOf(sf[0]), winnerOf(sf[1]), 'final', 7)
  matches.push(final)
  return { seasonIndex: game.world!.seasonIndex, teams, matches, promoted: [winnerOf(final), loserOf(final), winnerOf(third)], finished: true }
}

function assignRelegatedToD2(world: WorldState, relegated: string[], current: Map<string, WorldClub>): void {
  const counts = new Map<ConferenceId, number>()
  for (const conf of ['north', 'south'] as const) {
    counts.set(conf, world.clubs.filter((club) => club.tier === 'division2' && club.conference === conf).length)
  }
  for (const id of relegated) {
    const conf = (counts.get('north') ?? 0) <= (counts.get('south') ?? 0) ? 'north' : 'south'
    counts.set(conf, (counts.get(conf) ?? 0) + 1)
    const club = current.get(id)
    if (club) {
      club.tier = 'division2'
      club.conference = conf
    }
  }
}

function promoteAndRelegate(game: GameState): { promoted: string[]; relegated: string[] } {
  const world = game.world!
  const current = new Map(world.clubs.map((club) => [club.id, club]))
  const champions = world.divisions.find((division) => division.divisionId === 'champions')!
  const d1 = world.divisions.find((division) => division.divisionId === 'division1')!
  const playoff = runPromotionPlayoff(game)
  world.promotionPlayoff = playoff
  const champsBottom = champions.table.slice(-3).map((row) => row.teamId)
  const d1Top = d1.table.slice(0, 3).map((row) => row.teamId)
  const d1Bottom = d1.table.slice(-3).map((row) => row.teamId)
  const promoted = playoff.promoted
  for (const id of champsBottom) {
    const club = current.get(id)
    if (club) club.tier = 'division1'
  }
  for (const id of d1Top) {
    const club = current.get(id)
    if (club) club.tier = 'champions'
  }
  for (const id of promoted) {
    const club = current.get(id)
    if (club) { club.tier = 'division1'; club.conference = undefined }
  }
  assignRelegatedToD2(world, d1Bottom, current)
  for (const club of world.clubs) {
    club.starCount = club.tier === 'champions' ? (club.strength >= 4 ? 4 : 3) : club.tier === 'division1' ? (club.strength >= 3 ? 2 : 1) : 0
  }
  // 顶级/一级球星名额重新分配，二级不保留真实球星。
  for (const club of world.clubs) {
    if (club.isPlayer) continue
    while (club.starPlayerIds.length > club.starCount) {
      const surplus = club.starPlayerIds.pop()!
      const existing = game.freeStars.find((p) => p.id === surplus) ?? game.reserveStars?.find((p) => p.id === surplus)
      if (existing) {
        if (!game.freeStars.some((p) => p.id === existing.id)) game.freeStars.push(existing)
        game.reserveStars = (game.reserveStars ?? []).filter((p) => p.id !== existing.id)
      } else {
        const p = starPlayer(surplus, world)
        if (p && !game.freeStars.some((x) => x.id === p.id)) game.freeStars.push(p)
      }
    }
    if (club.tier === 'division2' && !club.isPlayer) {
      for (const starId of club.starPlayerIds) {
        const free = game.reserveStars?.find((p) => p.id === starId) ?? game.freeStars.find((p) => p.id === starId)
        if (!free) {
          const p = starPlayer(starId, world)
          if (p) game.freeStars.push(p)
        }
      }
      club.starPlayerIds = []
    }
  }
  world.history.push({
    seasonIndex: world.seasonIndex,
    champion: current.get(champions.champion ?? '')?.name ?? champions.champion ?? '',
    promotions: [...d1Top, ...promoted],
    relegations: [...champsBottom, ...d1Bottom],
  })
  return { promoted, relegated: [...champsBottom, ...d1Bottom] }
}

function retireAndRegen(game: GameState): void {
  const world = game.world!
  const all = new Map<string, Player>()
  for (const p of game.freeStars) all.set(p.id, p)
  for (const p of game.reserveStars ?? []) all.set(p.id, p)
  for (const team of game.aiTeams) for (const p of team.players) all.set(p.id, p)
  for (const p of game.roster) all.set(p.id, p)
  const rng = derivedRng(game.seed, 'retirement', world.seasonIndex)
  const retired: Player[] = []
  for (const player of all.values()) {
    player.age = (player.age ?? 24) + 1
    if (player.starKey) world.starAges[player.id] = player.age
    const age = player.age
    const chance = age >= 40 ? 1 : age === 39 ? 0.9 : age === 38 ? 0.7 : age === 37 ? 0.5 : age === 36 ? 0.3 : age === 35 ? 0.15 : 0
    if (rng.chance(chance)) retired.push(player)
  }
  // 其他级别联赛的球星也要老化；他们不在当前阵容中，只保留年龄/归属信息。
  for (const id of Object.keys(world.starAges)) {
    if (all.has(id)) continue
    const age = world.starAges[id]
    const nextAge = age + 1
    const chance = nextAge >= 40 ? 1 : nextAge === 39 ? 0.9 : nextAge === 38 ? 0.7 : nextAge === 37 ? 0.5 : nextAge === 36 ? 0.3 : nextAge === 35 ? 0.15 : 0
    if (rng.chance(chance)) {
      world.starAges[id] = nextAge
      const original = starPlayer(id, world)
      for (const club of world.clubs) club.starPlayerIds = club.starPlayerIds.filter((starId) => starId !== id)
      delete world.starAges[id]
      if (original?.starKey) {
        const regen = makeRegen(original)
        world.starAges[regen.id] = 16
        game.freeStars.push(regen)
      }
    } else world.starAges[id] = nextAge
  }
  for (const player of retired) {
    const key = player.starKey
    game.roster = game.roster.filter((p) => p.id !== player.id)
    for (const team of game.aiTeams) {
      team.players = team.players.filter((p) => p.id !== player.id)
      team.starPlayerIds = team.starPlayerIds.filter((id) => id !== player.id)
    }
    game.freeStars = game.freeStars.filter((p) => p.id !== player.id)
    game.reserveStars = (game.reserveStars ?? []).filter((p) => p.id !== player.id)
    for (const club of world.clubs) club.starPlayerIds = club.starPlayerIds.filter((id) => id !== player.id)
    delete world.starAges[player.id]
    if (key) {
      const regen = makeRegen(player)
      world.starAges[regen.id] = 16
      game.freeStars.push(regen)
    }
  }
  // 玩家阵容被退役/到期清空时补齐青年球员。
  ensurePlayerSquad(game, rng)
}

function makeRegen(player: Player): Player {
  const regen = structuredClone(player)
  const generation = (player.generation ?? 0) + 1
  regen.id = `regen-${player.starKey ?? player.id}-${generation}`
  regen.seedId = player.seedId
  regen.age = 16
  regen.generation = generation
  regen.contract = undefined
  regen.condition = 100
  regen.energy = 100
  for (const key of Object.keys(regen.attrs) as (keyof typeof regen.attrs)[]) {
    regen.attrs[key] = Math.round(regen.attrs[key] * 0.62 * 10) / 10
    regen.baseAttrs[key] = regen.attrs[key]
  }
  regen.pa = Math.max(caOf(regen.attrs, regen.positions.GK > 0), regen.pa * 0.78)
  return regen
}

function ensurePlayerSquad(game: GameState, rng: ReturnType<typeof derivedRng>): void {
  const used = new Set(game.roster.flatMap((p) => [p.name, p.enName]))
  let slot = 0
  while (game.roster.length < 18) {
    const position = randomSquadPositionTemplate()[slot % 18]
    const player = createRandomPlayer({ seed: rng.int(0x7fffffff), position, tier: 2, usedNames: used, idPrefix: `youth-${game.season.index}-${slot}` })
    player.age = 16 + rng.int(5)
    player.contract = { clubId: 'player', wage: wageForPlayer(player), expiresSeason: game.season.index + 3 }
    game.roster.push(player)
    slot++
  }
  const repaired = autoFillLineup(game.roster, game.lineup.formationId, game.lineup.tactics)
  if (validateLineup(game.roster, repaired).valid) game.lineup = repaired
}

function refillClubStars(world: WorldState, game: GameState): void {
  const pool = [...game.freeStars, ...(game.reserveStars ?? [])]
  const used = new Set(world.clubs.flatMap((club) => club.starPlayerIds))
  for (const club of world.clubs) {
    if (club.isPlayer) continue
    const target = club.tier === 'champions' ? club.starCount : club.tier === 'division1' ? club.starCount : 0
    while (club.starPlayerIds.length < target) {
      const pick = pool.find((player) => !used.has(player.id) && !!seedById(player.id))
      if (!pick) break
      used.add(pick.id)
      club.starPlayerIds.push(pick.id)
      game.freeStars = game.freeStars.filter((p) => p.id !== pick.id)
      game.reserveStars = (game.reserveStars ?? []).filter((p) => p.id !== pick.id)
      world.starAges[pick.id] = pick.age ?? 24
    }
  }
}

function expireContracts(game: GameState): void {
  if (!game.world) return
  const index = game.world.seasonIndex
  const expired: Player[] = []
  game.roster = game.roster.filter((player) => {
    if (!player.contract || player.contract.clubId !== 'player' || player.contract.expiresSeason > index) return true
    if (game.roster.length <= 12) {
      player.contract.expiresSeason = index + 2
      return true
    }
    player.contract = undefined
    expired.push(player)
    return false
  })
  game.freeStars.push(...expired)
  ensurePlayerSquad(game, derivedRng(game.seed, 'contract-youth', index))
}

function payWorldWages(game: GameState, round: number): number {
  if (!game.world || game.world.seasonIndex <= 1) return 0 // 首个赛季由董事会承担工资
  const economy = economyOf(game)
  const total = game.roster.reduce((sum, player) => sum + (player.contract?.wage ?? 0), 0)
  if (total <= 0) return 0
  const paid = Math.min(economy.balance, total)
  economy.balance -= paid
  return paid
}

export function worldWageBill(game: GameState): number {
  return game.roster.reduce((sum, player) => sum + (player.contract?.wage ?? 0), 0)
}

export function advanceWorldSeason(game: GameState, now = Date.now()): { ok: boolean; error?: string } {
  if (!game.world) return { ok: false, error: '世界数据不存在' }
  if (game.activeMatch || !game.season.finished) return { ok: false, error: '赛季尚未结束或比赛进行中' }
  syncPlayerDivision(game)
  simulateOtherDivisions(game, 38)
  const allFinished = game.world.divisions.every((division) => division.fixtures.every((fixture) => fixture.played))
  if (!allFinished) return { ok: false, error: '其他联赛尚未结束' }
  ;(game.seasonHistory ??= []).push(game.season)
  promoteAndRelegate(game)
  retireAndRegen(game)
  expireContracts(game)
  refillClubStars(game.world, game)
  // 自由市场保持至少 250 人；不足时从储备补入。
  while (game.freeStars.length < 250 && (game.reserveStars?.length ?? 0) > 0) game.freeStars.push(game.reserveStars!.shift()!)
  const world = game.world
  world.seasonIndex++
  world.seasonStartedAt = now
  world.lastPromotionPlayoff = world.promotionPlayoff
  world.promotionPlayoff = undefined
  let playerDivision = divisionIdForTier(clubById(world, 'player').tier, clubById(world, 'player').conference)
  world.playerDivisionId = playerDivision
  world.divisions = buildAllDivisions(world, splitSeed(game.seed, `world-season-${world.seasonIndex}`), now)
  playerDivision = world.playerDivisionId
  const next = world.divisions.find((division) => division.divisionId === playerDivision)!
  game.season = next
  const teams = buildWorldDivisionTeams(world, playerDivision, splitSeed(game.seed, `world-teams-${world.seasonIndex}`), { roster: game.roster, lineup: game.lineup })
  game.aiTeams = teams.aiTeams
  game.clubName = teams.playerTeam.name
  const repaired = autoFillLineup(game.roster, game.lineup.formationId, game.lineup.tactics)
  if (validateLineup(game.roster, repaired).valid) game.lineup = repaired
  game.economy = economyOf(game)
  game.economy.lastIncomeRound = 0
  if (game.market) { game.market.lastSettledRound = 0; for (const listing of game.market.listings) listing.listedRound = 1 }
  return { ok: true }
}

export function worldDivisionLabel(world: WorldState, divisionId: string): string {
  if (divisionId === 'champions') return '冠军联赛'
  if (divisionId === 'division1') return '一级联赛'
  return divisionId === 'd2-south' ? '二级联赛 · 南区' : '二级联赛 · 北区'
}

export function worldTierLabel(tier: TierId): string {
  return tier === 'champions' ? '冠军联赛' : tier === 'division1' ? '一级联赛' : '二级联赛'
}

export { payWorldWages }
