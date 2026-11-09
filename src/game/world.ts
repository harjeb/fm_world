import type {
  AIClubState,
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
import { LEGACY_SQUAD_SIZE, buildNameBook, createRandomPlayer, randomSquadPositionTemplate, type SquadName } from './data/random-players.ts'
import { DIVISION_IDS, WORLD_CLUB_DEFS, conferenceOfDivision, divisionIdForTier, type WorldClubDef } from './data/world-clubs.ts'
import { ATTRS_VERSION, NAMES_VERSION, TRAITS_VERSION } from './names.ts'
import { FULL_SQUAD, MIN_SQUAD, autoFillLineup, validateLineup } from './squad.ts'
import { equipAICards, mergeSignings, seedAIClubs } from './ai-club.ts'
import { caOf } from './ca.ts'
import { derivedRng, splitSeed, hashString } from './rng.ts'
import { simulateAIvsAIState } from './match/setup.ts'
import { economyOf } from './economy.ts'
import { GAME_DAY_MS, gameDayOfRound, kickoffAtForRound, roundsKickedOff, seasonEndAt, seasonGameDays, DAILY_SCHEDULE, BEIJING_SCHEDULE, averageRoundGameDays, type KickoffSchedule } from './calendar.ts'

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

export function createWorld(seed: number, requestedClubId?: string, startedAt = Date.now(), schedule: KickoffSchedule = DAILY_SCHEDULE): WorldSetup {
  const defs = clubDefs(seed)
  const chosen = pickPlayerClub(defs, requestedClubId)
  const clubs: WorldClub[] = defs.map((def) => ({
    ...def,
    id: def.id === chosen.id ? 'player' : def.id,
    name: def.id === chosen.id ? chosen.name : def.name,
    isPlayer: def.id === chosen.id,
    squadKey: def.id === chosen.id ? def.id : undefined,
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
    calendarStartAt: startedAt,
    clubs,
    divisions: [],
    playerDivisionId: divisionIdForTier('division2', chosen.conference ?? 'north'),
    starAges,
    history: [],
    kickoffSchedule: schedule,
  }
  world.divisions = buildAllDivisions(world, seed, startedAt)
  const playerClub = clubs.find((club) => club.isPlayer)!
  return { world, playerClub, freeStars, reserveStars }
}

function buildFixtures(teamIds: string[], startedAt: number, playerId = 'player', schedule: KickoffSchedule = DAILY_SCHEDULE): Fixture[] {
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
      gameDay: gameDayOfRound(startedAt, match.round, schedule),
      kickoffAt: kickoffAtForRound(startedAt, match.round, schedule),
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
  const conference: ConferenceId | undefined = conferenceOfDivision(id)
  const clubs = world.clubs.filter((club) => divisionIdForTier(club.tier, club.conference) === id)
  const clubIds = clubs.map((club) => club.id)
  const fixtures = buildFixtures(clubIds, startedAt, 'player', world.kickoffSchedule)
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
    roundGameDays: averageRoundGameDays(world.kickoffSchedule),
    kickoffSchedule: world.kickoffSchedule ?? DAILY_SCHEDULE,
    divisionId: id,
    tier,
    conference,
    clubIds,
  }
  return season
}

/** 二级联赛现有的赛区 ID：南北两区 + 后来开出的新区。 */
export function divisionIdsOf(world: WorldState): string[] {
  const ids = ['champions', 'division1']
  const zones = new Set<string>()
  for (const club of world.clubs.filter((item) => item.tier === 'division2')) {
    zones.add(divisionIdForTier('division2', club.conference))
  }
  for (const id of DIVISION_IDS.slice(2)) ids.push(id)
  for (const id of [...zones].sort()) if (!ids.includes(id)) ids.push(id)
  return ids
}

function buildAllDivisions(world: WorldState, seed: number, startedAt: number): SeasonState[] {
  const result: SeasonState[] = []
  for (const id of divisionIdsOf(world)) {
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

const CLUB_INDEX = new Map(WORLD_CLUB_DEFS.map((def, index) => [def.id, index]))
const SQUAD_SIZE = randomSquadPositionTemplate().length
const nameBooks = new Map<string, SquadName[][]>()

/**
 * 这个种子、这个赛季的名册。没有要避开的名字时可以复用，选队预览和真正开局拿到的是同一本。
 * 前 18 个名字用 7 人制时代的同一本名册（已有的人名字不变），11 人制追加的槽位另用一本扩展名册。
 */
function nameBook(seed: number, seasonIndex: number, reserved: Player[] = []): SquadName[][] {
  const build = (): SquadName[][] => {
    const reservedNames = new Set(reserved.flatMap((player) => [player.name, player.enName]))
    const base = buildNameBook(splitSeed(seed, `name-book-${seasonIndex}`), WORLD_CLUB_DEFS.length, LEGACY_SQUAD_SIZE, reservedNames)
    const taken = new Set([...reservedNames, ...base.flat().flatMap((name) => [name.name, name.enName])])
    const extra = buildNameBook(splitSeed(seed, `name-book-ext-${seasonIndex}`), WORLD_CLUB_DEFS.length, SQUAD_SIZE - LEGACY_SQUAD_SIZE, taken, base.map((names) => names.flatMap((name) => [name.family, name.enName.split(' ').at(-1) ?? name.family])))
    return base.map((names, club) => [...names, ...extra[club]])
  }
  if (reserved.length) return build()
  const key = `${seed}|${seasonIndex}`
  let book = nameBooks.get(key)
  if (!book) {
    book = build()
    if (nameBooks.size >= 8) nameBooks.clear()
    nameBooks.set(key, book)
  }
  return book
}

function teamFromClub(world: WorldState, club: WorldClub, seed: number, playerTeam?: { roster: Player[]; lineup: Lineup }, book = nameBook(seed, world.seasonIndex), aiClubs?: Record<string, AIClubState>): AITeam {
  if (club.isPlayer && playerTeam) {
    return {
      ...club,
      players: playerTeam.roster,
      lineup: playerTeam.lineup,
      playerNames: club.starPlayerIds.map((id) => world.starAges[id] ? seedById(id)?.name ?? id : id),
    }
  }
  // 玩家已经签下的球星不会再出现在这支队，哪怕旧存档的名单还没清掉他。
  const held = new Set((playerTeam?.roster ?? []).map((player) => player.id))
  const stars = club.starPlayerIds.filter((id) => !held.has(id)).map((id) => starPlayer(id, world)).filter((p): p is Player => !!p)
  const byPosition = new Map<string, Player[]>()
  for (const star of stars) {
    const pos = (['GK', 'CB', 'W', 'CM', 'ST'] as const).find((p) => star.positions[p] >= 70) ?? (star.positions.GK > 0 ? 'GK' : 'CM')
    byPosition.set(pos, [...(byPosition.get(pos) ?? []), star])
  }
  const players: Player[] = []
  const template = randomSquadPositionTemplate()
  const squadKey = club.squadKey ?? club.id
  const names = book[CLUB_INDEX.get(squadKey) ?? hashString(squadKey) % book.length]
  for (let slot = 0; slot < template.length; slot++) {
    const position = template[slot]
    const star = byPosition.get(position)?.shift()
    if (star) players.push(star)
    else {
      players.push(createRandomPlayer({
        seed: splitSeed(seed, `club-${squadKey}-${world.seasonIndex}-${slot}`),
        position,
        tier: club.strength >= 5 ? 4 : club.strength >= 3 ? 3 : 2,
        fixedName: names[slot],
        idPrefix: `${club.id}-${slot + 1}`,
      }))
    }
  }
  // 电脑球队练出来的卡和签下的人在这里并进名单：评分更高的卡才会被换上。
  const ai = aiClubs?.[squadKey]
  const squad = ai ? mergeSignings(ai, players) : players
  if (ai) equipAICards(ai, squad)
  const lineup = autoFillLineup(squad, club.formationId, club.tactics)
  const check = validateLineup(squad, lineup)
  if (!check.valid) throw new Error(`球队 ${club.name} 阵容不合法：${check.errors.join('；')}`)
  return { ...club, players: squad, lineup, playerNames: stars.map((star) => star.name) }
}

export function buildWorldDivisionTeams(
  world: WorldState,
  divisionId: string,
  seed: number,
  playerTeam?: { roster: Player[]; lineup: Lineup; reserved?: Player[] },
  aiClubs?: Record<string, AIClubState>,
): { playerTeam: AITeam; aiTeams: AITeam[] } {
  const division = world.divisions.find((item) => item.divisionId === divisionId)
  if (!division?.clubIds) throw new Error('联赛分区不存在')
  const clubIds = division.clubIds
  const book = nameBook(seed, world.seasonIndex, [...(playerTeam?.roster ?? []), ...(playerTeam?.reserved ?? [])])
  const teams = clubIds.map((id) => teamFromClub(world, clubById(world, id), seed, playerTeam, book, aiClubs))
  const player = teams.find((team) => team.isPlayer)
  if (!player) throw new Error('玩家球队不在当前联赛')
  return { playerTeam: player, aiTeams: teams.filter((team) => !team.isPlayer) }
}

function createWorldGameFromSetup(setup: WorldSetup, seed: number, startedAt: number, clubName?: string, aiClubs?: Record<string, AIClubState>): GameState {
  const playerClub = setup.playerClub
  if (clubName) playerClub.name = clubName
  const division = setup.world.divisions.find((item) => item.divisionId === setup.world.playerDivisionId)!
  const playerTeam = teamFromClub(setup.world, playerClub, seed)
  const playerRoster = playerTeam.players
  const playerLineup = playerTeam.lineup
  const check = validateLineup(playerRoster, playerLineup)
  if (!check.valid) throw new Error(`初始阵容不合法：${check.errors.join('；')}`)
  const aiTeams = (division.clubIds ?? [])
    .filter((id) => id !== 'player')
    .map((id) => teamFromClub(setup.world, clubById(setup.world, id), seed, undefined, undefined, aiClubs))
  const game: GameState = {
    version: 3,
    createdAt: startedAt,
    seed,
    clubName: playerTeam.name,
    roster: playerRoster,
    lineup: playerLineup,
    training: {},
    candidates: {},
    cards: [],
    namesVersion: NAMES_VERSION,
    traitsVersion: TRAITS_VERSION,
    attrsVersion: ATTRS_VERSION,
    season: division,
    aiTeams,
    aiClubs,
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
  const setup = createWorld(seed, requestedClubId, startedAt)
  return createWorldGameFromSetup(setup, seed, startedAt, clubName, seedAIClubs(setup.world, seed))
}

export type ClubPreview = {
  id: string
  name: string
  enName?: string
  conference: ConferenceId
  color: string
  formationId: WorldClub['formationId']
  roster: Player[]
  lineup: Lineup
}

/**
 * 选队界面用：这个种子下每支二级球队开局的名单。
 * 和 createWorldGame(seed, id) 实际拿到的完全一样（有测试保证），只是不用把整个世界建 40 遍。
 */
export function previewD2Clubs(seed: number): ClubPreview[] {
  const { world } = createWorld(seed)
  return world.clubs.filter((club) => club.tier === 'division2').map((club) => {
    const squadKey = club.squadKey ?? club.id
    const team = teamFromClub(world, { ...club, id: 'player', squadKey, isPlayer: true, starPlayerIds: [] }, seed)
    return {
      id: squadKey,
      name: club.name,
      enName: club.enName,
      conference: club.conference ?? 'north',
      color: club.color,
      formationId: club.formationId,
      roster: team.players,
      lineup: team.lineup,
    }
  })
}

const ownerlessCache = new Map<string, { clubCount: number; teams: Record<string, AITeam> }>()

/**
 * buildOwnerlessTeams 的带缓存版本：友谊赛列表要一次拿到 80 支球队的名单，
 * 同一赛季内重复调用不必每次重新生成 1400 名球员。
 */
export function cachedOwnerlessTeams(world: WorldState, seed: number, aiClubs?: Record<string, AIClubState>): Record<string, AITeam> {
  const key = `${seed}|${world.seasonIndex}|${world.clubs.length}|${aiClubs ? Object.keys(aiClubs).length : 0}`
  const hit = ownerlessCache.get(key)
  if (hit) return hit.teams
  const teams = buildOwnerlessTeams(world, seed, aiClubs)
  if (ownerlessCache.size >= 4) ownerlessCache.clear()
  ownerlessCache.set(key, { clubCount: world.clubs.length, teams })
  return teams
}

/** 为服务器世界生成全部球队的同一套球员名单；同一赛季只生成一次并持久化。 */
export function buildOwnerlessTeams(world: WorldState, seed: number, aiClubs?: Record<string, AIClubState>): Record<string, AITeam> {
  const book = nameBook(seed, world.seasonIndex)
  return Object.fromEntries(world.clubs.map((club) => [club.id, teamFromClub(world, club, seed, undefined, book, aiClubs)]))
}

/** 用于服务器共享世界的无主世界：保留 80 支原始球队，不替换玩家球队。 */
export function createOwnerlessWorld(seed: number, startedAt = Date.now()): { world: WorldState; freeStars: Player[]; reserveStars: Player[] } {
  // 服务器共享世界用联机赛程：每天北京时间 12:00、20:00 各一轮。
  const setup = createWorld(seed, undefined, startedAt, BEIJING_SCHEDULE)
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

/** 新区球队名：用固定的中文词根拼，保证同一种子每次生成都一样。 */
const ZONE_CITIES = ['蓝港', '白河', '石桥', '青松', '赤岩', '东浦', '西岭', '南湾', '北岸', '云川', '金滩', '铁山', '沙洲', '湖畔', '长堤', '海湾', '松林', '雪原', '远洋', '望江']
const ZONE_SUFFIXES = ['竞技', '联队', '城', '体育', '流浪者', '勇士', '航海', '铁路', '青年', '大学']
const ZONE_COLORS = ['#2f6fed', '#e0592a', '#1f9d55', '#8b5cf6', '#d4a017', '#0f766e', '#b91c1c', '#475569']

/**
 * 二级联赛满员后开一个新赛区：20 支新球队、同样的双循环赛程。
 * 只在服务器注册新账号时调用；`seed` 决定名字和队服颜色。
 */
export function expandWorldConference(world: WorldState, seed: number): { conference: ConferenceId; divisionId: string } {
  const used = new Set(world.clubs.map((club) => club.name))
  let zoneNo = 3
  while (world.clubs.some((club) => club.conference === `zone${zoneNo}`)) zoneNo++
  const conference: ConferenceId = `zone${zoneNo}`
  const rng = derivedRng(seed, 'world-expand', zoneNo)
  const created: WorldClub[] = []
  for (let index = 0; index < 20; index++) {
    let name = ''
    for (let tries = 0; tries < 40 && (!name || used.has(name)); tries++) {
      name = `${ZONE_CITIES[rng.int(ZONE_CITIES.length)]}${ZONE_SUFFIXES[rng.int(ZONE_SUFFIXES.length)]}`
    }
    while (!name || used.has(name)) name = `${ZONE_CITIES[rng.int(ZONE_CITIES.length)]}${ZONE_SUFFIXES[rng.int(ZONE_SUFFIXES.length)]}${created.length + 1}`
    used.add(name)
    const id = `d2z${zoneNo}_${String(index + 1).padStart(2, '0')}`
    created.push({
      id,
      name,
      short: name.slice(0, 2),
      color: ZONE_COLORS[rng.int(ZONE_COLORS.length)],
      accent: '#0b1220',
      style: rng.pick(['balanced', 'attack', 'defend', 'press']),
      formationId: rng.pick(['4-4-2', '4-3-3', '4-2-3-1', '3-5-2', '5-3-2', '4-1-4-1', '3-4-3', '4-1-2-1-2'] as const),
      tactics: { attack: 'balanced', passing: 'mixed', tempo: 'normal', line: 'mid', press: 'mid' },
      strength: index < 5 ? 3 : index < 14 ? 2 : 1,
      playerNames: [],
      tier: 'division2',
      conference,
      starPlayerIds: [],
      starCount: 0,
    })
  }
  world.clubs.push(...created)
  const divisionId = divisionIdForTier('division2', conference)
  const division = buildWorldDivision(world, divisionId, splitSeed(seed, `zone-${zoneNo}`), world.seasonStartedAt, world.seasonIndex)
  world.divisions.push(division)
  return { conference, divisionId }
}

/**
 * 给新账号挑一支没人执教的球队。
 *
 * 规则：只在二级联赛找空位；二级满了就开一个新赛区（返回 undefined，让调用方先 expandWorldConference）。
 * `aliveAccountIds` 用来剔除「owner 指向已删除账号」的僵尸归属：这类球队视为空位。
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
  return world.clubs.find((club) => club.tier === 'division2' && !taken.has(club.id))
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

/** 共享世界只保存真实球队 ID；账号存档把自己执教的球队映射为 player。 */
export function worldForClub(base: WorldState, clubId: string): WorldState {
  const world = structuredClone(base)
  const club = clubById(world, clubId)
  const division = world.divisions.find((item) => item.clubIds?.includes(clubId))
  if (!division) throw new Error('找不到球队所在赛区')
  for (const item of world.divisions) {
    item.clubIds = (item.clubIds ?? []).map((id) => id === clubId ? 'player' : id)
    item.table = item.table.map((row) => row.teamId === clubId ? { ...row, teamId: 'player' } : row)
    if (item.champion === clubId) item.champion = 'player'
    for (const fixture of item.fixtures) {
      if (fixture.homeId === clubId) fixture.homeId = 'player'
      if (fixture.awayId === clubId) fixture.awayId = 'player'
      fixture.isPlayer = fixture.homeId === 'player' || fixture.awayId === 'player'
    }
  }
  club.squadKey = club.id
  club.id = 'player'
  club.isPlayer = true
  world.playerDivisionId = division.divisionId ?? world.playerDivisionId
  return world
}

/** 把结算后的账号世界还原为服务器稳定球队 ID。 */
export function ownerlessWorldFromClub(base: WorldState, clubId: string): WorldState {
  const world = structuredClone(base)
  const club = clubById(world, 'player')
  club.id = clubId
  club.isPlayer = false
  delete club.squadKey
  for (const division of world.divisions) {
    division.clubIds = division.clubIds?.map((id) => id === 'player' ? clubId : id)
    division.table = division.table.map((row) => row.teamId === 'player' ? { ...row, teamId: clubId } : row)
    if (division.champion === 'player') division.champion = clubId
    for (const fixture of division.fixtures) {
      if (fixture.homeId === 'player') fixture.homeId = clubId
      if (fixture.awayId === 'player') fixture.awayId = clubId
      fixture.isPlayer = false
    }
  }
  for (const playoff of [world.promotionPlayoff, world.lastPromotionPlayoff]) {
    if (!playoff) continue
    playoff.teams = playoff.teams.map((id) => id === 'player' ? clubId : id)
    playoff.promoted = playoff.promoted.map((id) => id === 'player' ? clubId : id)
    for (const match of playoff.matches) {
      if (match.homeId === 'player') match.homeId = clubId
      if (match.awayId === 'player') match.awayId = clubId
    }
  }
  for (const entry of world.history) {
    entry.promotions = entry.promotions.map((id) => id === 'player' ? clubId : id)
    entry.relegations = entry.relegations.map((id) => id === 'player' ? clubId : id)
  }
  return world
}


/* ---------- 射手榜 / 助攻榜 ---------- */

export type LeaderRow = { playerId: string; name: string; teamId: string; goals: number; assists: number }

const SQUAD_TEMPLATE = randomSquadPositionTemplate()
/** 谁更可能进球/助攻：越靠前越吃球权。 */
const SCORER_WEIGHT: Record<string, number> = { ST: 6, W: 4, CM: 2, CB: 1, GK: 0.15 }
const ASSIST_WEIGHT: Record<string, number> = { ST: 3, W: 5, CM: 4, CB: 1.5, GK: 0.1 }

function weightedSlot(rng: ReturnType<typeof derivedRng>, weights: Record<string, number>): number {
  let total = 0
  for (const position of SQUAD_TEMPLATE) total += weights[position] ?? 0
  if (total <= 0) return 0
  let roll = rng.float() * total
  for (let slot = 0; slot < SQUAD_TEMPLATE.length; slot++) {
    roll -= weights[SQUAD_TEMPLATE[slot]] ?? 0
    if (roll <= 0) return slot
  }
  return 0
}

/**
 * 其他联赛只保存比分，没有逐场球员数据；用同一份名单簿确定性地派进球和助攻，
 * 这样射手榜上的名字和真正生成的名单一致，读档也不会变。
 */
export function abstractTally(
  seed: number,
  seasonIndex: number,
  homeId: string,
  awayId: string,
  score: { home: number; away: number },
  matchSeed: number,
): { scorers: NonNullable<Fixture['scorers']>; assisters: NonNullable<Fixture['assisters']> } {
  const rng = derivedRng(matchSeed, 'abstract-tally')
  const book = nameBook(seed, seasonIndex)
  const lookup = (clubId: string, slot: number) => {
    const names = book[CLUB_INDEX.get(clubId) ?? hashString(clubId) % book.length]
    return { playerId: `${clubId}-${slot + 1}`, name: names?.[slot]?.name ?? `${clubId}-${slot + 1}`, teamId: clubId }
  }
  const collect = (clubId: string, count: number, weights: Record<string, number>, key: 'goals' | 'assists') => {
    const rows = new Map<string, { playerId: string; name: string; teamId: string; goals: number; assists: number }>()
    for (let index = 0; index < Math.max(0, count); index++) {
      const ref = lookup(clubId, weightedSlot(rng, weights))
      const row = rows.get(ref.playerId) ?? { playerId: ref.playerId, name: ref.name, teamId: clubId, goals: 0, assists: 0 }
      row[key]++
      rows.set(ref.playerId, row)
    }
    return [...rows.values()]
  }
  const scorers = [...collect(homeId, score.home, SCORER_WEIGHT, 'goals'), ...collect(awayId, score.away, SCORER_WEIGHT, 'goals')]
    .map((row) => ({ playerId: row.playerId, name: row.name, teamId: row.teamId, goals: row.goals }))
  const assisters = [...collect(homeId, score.home, ASSIST_WEIGHT, 'assists'), ...collect(awayId, score.away, ASSIST_WEIGHT, 'assists')]
    .map((row) => ({ playerId: row.playerId, name: row.name, teamId: row.teamId, assists: row.assists }))
  return { scorers, assisters }
}

/** 一个联赛的射手榜或助攻榜；只统计已经踢完的比赛。 */
export function divisionLeaders(division: { fixtures: Fixture[] }, kind: 'goals' | 'assists', limit = 5): LeaderRow[] {
  const rows = new Map<string, LeaderRow>()
  for (const fixture of division.fixtures) {
    if (!fixture.played) continue
    if (kind === 'goals') {
      for (const scorer of fixture.scorers ?? []) {
        const row = rows.get(scorer.playerId) ?? { playerId: scorer.playerId, name: scorer.name, teamId: scorer.teamId ?? fixture.homeId, goals: 0, assists: 0 }
        row.goals += scorer.goals
        rows.set(scorer.playerId, row)
      }
    } else {
      for (const assister of fixture.assisters ?? []) {
        const row = rows.get(assister.playerId) ?? { playerId: assister.playerId, name: assister.name, teamId: assister.teamId ?? fixture.homeId, goals: 0, assists: 0 }
        row.assists += assister.assists
        rows.set(assister.playerId, row)
      }
    }
  }
  const list = [...rows.values()].filter((row) => (kind === 'goals' ? row.goals : row.assists) > 0)
  list.sort((a, b) => (kind === 'goals' ? b.goals - a.goals || b.assists - a.assists : b.assists - a.assists || b.goals - a.goals) || a.name.localeCompare(b.name, 'zh-CN'))
  return list.slice(0, limit)
}

/** 由共享世界快照接管一支空位球队；优先二级，满员后可接管更高级别。 */
export function createWorldGameFromWorld(
  base: WorldState,
  clubId: string,
  seed: number,
  startedAt: number,
  freeStars: Player[],
  reserveStars: Player[],
  clubName?: string,
): GameState {
  const world = worldForClub(base, clubId)
  const club = clubById(world, 'player')
  const game = createWorldGameFromSetup({
    world,
    playerClub: club,
    freeStars: structuredClone(freeStars),
    reserveStars: structuredClone(reserveStars),
  // 联机账号的电脑球队以服务器为准，不在这里另算一份（传空对象表示“由服务器推进”）。
  }, seed, startedAt, clubName, {})
  game.shared = true
  return game
}

/** 服务器共享世界按现实时间抽象推进；返回是否有变化。 */
export function advanceOwnerlessWorld(world: WorldState, now = Date.now(), ownedClubs: ReadonlySet<string> = new Set(), seed = world.seasonStartedAt): boolean {
  // 第 n 轮在第 n+1 轮开赛时结算（和以前“开赛后一轮间隔”一致）。
  const completed = Math.min(38, Math.max(0, roundsKickedOff(world.seasonStartedAt, now, world.kickoffSchedule) - 1))
  let changed = false
  const clubs = new Map(world.clubs.map((club) => [club.id, club]))
  for (const division of world.divisions) {
    for (const fixture of division.fixtures) {
      if (fixture.round > completed || fixture.played || ownedClubs.has(fixture.homeId) || ownedClubs.has(fixture.awayId)) continue
      const home = clubs.get(fixture.homeId)
      const away = clubs.get(fixture.awayId)
      if (!home || !away) continue
      const matchSeed = splitSeed(division.seed, `ownerless-${fixture.round}-${fixture.homeId}-${fixture.awayId}`)
      const score = abstractScore(home, away, matchSeed)
      fixture.score = score
      fixture.played = true
      const tally = abstractTally(seed, world.seasonIndex, fixture.homeId, fixture.awayId, score, matchSeed)
      fixture.scorers = tally.scorers
      fixture.assisters = tally.assisters
      changed = true
    }
    const names = new Map(division.clubIds?.map((id) => [id, clubs.get(id)?.name ?? id]) ?? [])
    division.table = computeWorldTable(division.clubIds ?? [], division.fixtures, names)
    const nextRound = Math.min(38, completed + 1)
    if (division.round !== nextRound) changed = true
    division.round = nextRound
    division.finished = division.fixtures.every((fixture) => fixture.played)
    if (division.finished) division.champion = division.table[0]?.teamId ?? null
  }
  return changed
}

export function d2ClubChoices(): { id: string; name: string; enName?: string; conference: ConferenceId }[] {
  return WORLD_CLUB_DEFS.filter((club) => club.tier === 'division2').map((club) => ({ id: club.id, name: club.name, enName: club.enName, conference: club.conference ?? 'north' }))
}

/**
 * 11 人制每队 25 人（7 人制时 18 人）：单人工资按 18 / 25 缩放，整队工资总额和 7 人制时相当，
 * 经济系统（收入、设施、AI 账本）不用跟着重调。
 */
export const SQUAD_WAGE_SCALE = 18 / 25

export function wageForPlayer(player: Player): number {
  // 身价涨到十万–千万级之后，工资也跟着走：CA 205 约 700/轮，270 约 6500/轮，292 约 1.45 万/轮。
  const ca = caOf(player.attrs, player.positions.GK > 0)
  return Math.max(500, Math.round((800 * SQUAD_WAGE_SCALE * Math.pow(1.035, ca - 200)) / 50) * 50)
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

export function simulateOtherDivisions(game: GameState, throughRound: number, seed = game.seed): void {
  if (!game.world) return
  const clubs = new Map(game.world.clubs.map((club) => [club.id, club]))
  for (const division of game.world.divisions) {
    if (division.divisionId === game.world.playerDivisionId) continue
    for (const fixture of division.fixtures) {
      if (fixture.round > throughRound || fixture.played) continue
      const home = clubs.get(fixture.homeId)
      const away = clubs.get(fixture.awayId)
      if (!home || !away) continue
      const matchSeed = splitSeed(division.seed, `abstract-${fixture.round}-${fixture.homeId}-${fixture.awayId}`)
      const score = abstractScore(home, away, matchSeed)
      fixture.score = score
      fixture.played = true
      const tally = abstractTally(seed, game.world.seasonIndex, fixture.homeId, fixture.awayId, score, matchSeed)
      fixture.scorers = tally.scorers
      fixture.assisters = tally.assisters
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

/** 二级每个赛区的前三名进入升级杯。 */
function playoffSeed(world: WorldState): { teams: string[]; champions: string[]; others: string[]; byZone: string[][] } {
  const zones = world.divisions
    .filter((division) => division.tier === 'division2')
    .sort((a, b) => (a.divisionId ?? '').localeCompare(b.divisionId ?? ''))
  const champions: string[] = []
  const others: string[] = []
  const byZone: string[][] = []
  for (const zone of zones) {
    const top = zone.table.slice(0, 3).map((row) => row.teamId)
    byZone.push(top)
    if (top[0]) champions.push(top[0])
    if (top[1]) others.push(top[1])
    if (top[2]) others.push(top[2])
  }
  return { teams: [...champions, ...others], champions, others, byZone }
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
  const h = homeId === 'player' ? teamFromClub(world, home, splitSeed(world.seasonStartedAt, `playoff-${homeId}`), playerTeam) : game.aiTeams.find((team) => team.id === homeId) ?? teamFromClub(world, home, splitSeed(world.seasonStartedAt, `playoff-${homeId}`))
  const a = awayId === 'player' ? teamFromClub(world, away, splitSeed(world.seasonStartedAt, `playoff-${awayId}`), playerTeam) : game.aiTeams.find((team) => team.id === awayId) ?? teamFromClub(world, away, splitSeed(world.seasonStartedAt, `playoff-${awayId}`))
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

/** 小组循环：人少时这就是一轮瑞士轮，按积分、净胜球、进球排。 */
function groupWinner(game: GameState, teams: string[], groups: string[][], index: number, matches: PromotionMatch[] = []): string {
  const rows = new Map<string, { id: string; points: number; gf: number; ga: number }>()
  for (const id of teams) rows.set(id, { id, points: 0, gf: 0, ga: 0 })
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const match = simulatePlayoffMatch(game, teams[i], teams[j], 'group', groups.length * 100 + index * 10 + i * 3 + j)
      groups[index].push(match.id)
      matches.push(match)
      const home = rows.get(teams[i])!
      const away = rows.get(teams[j])!
      const homeGoals = match.score?.home ?? 0
      const awayGoals = match.score?.away ?? 0
      home.gf += homeGoals
      home.ga += awayGoals
      away.gf += awayGoals
      away.ga += homeGoals
      if (match.shootout) {
        // 小组赛也要分胜负：点球赢的拿 2 分，输的 1 分，避免三队同分时全靠净胜球。
        if (match.shootout.home > match.shootout.away) { home.points += 2; away.points += 1 }
        else { away.points += 2; home.points += 1 }
      } else if (homeGoals > awayGoals) home.points += 3
      else if (homeGoals < awayGoals) away.points += 3
      else { home.points += 1; away.points += 1 }
    }
  }
  return [...rows.values()].sort((a, b) =>
    b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.id.localeCompare(b.id))[0].id
}

/**
 * 升级杯：每个二级赛区的第 1 名轮空，2/3 名先加赛；
 * 出线的人和轮空的人随机分成两组踢循环（瑞士轮），小组第一直接升级；
 * 两个小组第二再踢一轮，胜者拿到第三个升级名额。
 */
function runPromotionPlayoff(game: GameState): PromotionPlayoff {
  const world = game.world!
  const seed = playoffSeed(world)
  const matches: PromotionMatch[] = []
  const qualified: string[] = [...seed.champions]
  // 每个赛区的 2/3 名加赛一轮。
  seed.byZone.forEach((zone, index) => {
    if (zone.length < 3) return
    const match = simulatePlayoffMatch(game, zone[1], zone[2], 'qualifier', index)
    matches.push(match)
    qualified.push(winnerOf(match))
  })
  const rng = derivedRng(splitSeed(game.seed, `playoff-groups-${world.seasonIndex}`), 'groups')
  const shuffled = [...qualified]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const other = rng.int(i + 1)
    ;[shuffled[i], shuffled[other]] = [shuffled[other], shuffled[i]]
  }
  const half = Math.ceil(shuffled.length / 2)
  const groupTeams = [shuffled.slice(0, half), shuffled.slice(half)].filter((group) => group.length > 0)
  const groups: string[][] = groupTeams.map(() => [])
  const winners = groupTeams.map((teams, index) => groupWinner(game, teams, groups, index, matches))
  const runnerUps = groupTeams
    .map((teams, index) => teams.filter((id) => id !== winners[index])[0])
    .filter((id): id is string => !!id)
  let runnerUpWinner: string | undefined
  if (runnerUps.length > 0) {
    const runnerGroups: string[][] = [[]]
    runnerUpWinner = groupWinner(game, runnerUps, runnerGroups, 0, matches)
  }
  const promoted = [...winners, ...(runnerUpWinner ? [runnerUpWinner] : [])].filter((id): id is string => !!id)
  return {
    seasonIndex: world.seasonIndex,
    teams: seed.teams,
    matches,
    promoted: promoted.slice(0, 3),
    finished: true,
    groups,
    runnerUps,
  }
}

/** 常规赛结束就先把升级杯踢完，让赛后那 12 个游戏日里有比赛可看。 */
export function ensurePromotionPlayoff(game: GameState): PromotionPlayoff | undefined {
  const world = game.world
  if (!world) return undefined
  if (world.promotionPlayoff?.seasonIndex === world.seasonIndex) return world.promotionPlayoff
  const zones = world.divisions.filter((division) => division.tier === 'division2')
  if (!zones.length) return undefined
  if (!world.divisions.every((division) => division.fixtures.every((fixture) => fixture.played))) return undefined
  if (world.divisions.some((division) => !division.table.length)) return undefined
  const playoff = runPromotionPlayoff(game)
  world.promotionPlayoff = playoff
  return playoff
}

function assignRelegatedToD2(world: WorldState, relegated: string[], current: Map<string, WorldClub>): void {
  const confs = [...new Set(world.clubs.filter((club) => club.tier === 'division2').map((club) => club.conference ?? 'north'))]
  const counts = new Map<ConferenceId, number>()
  for (const conf of confs) {
    counts.set(conf, world.clubs.filter((club) => club.tier === 'division2' && (club.conference ?? 'north') === conf).length)
  }
  for (const id of relegated) {
    const conf = confs.reduce((best, item) => (counts.get(item) ?? 0) < (counts.get(best) ?? 0) ? item : best, confs[0] ?? 'north')
    counts.set(conf, (counts.get(conf) ?? 0) + 1)
    const club = current.get(id)
    if (club) {
      club.tier = 'division2'
      club.conference = conf
    }
  }
}

function promoteAndRelegate(game: GameState, protectedClubs: ReadonlySet<string> = new Set()): { promoted: string[]; relegated: string[] } {
  const world = game.world!
  const current = new Map(world.clubs.map((club) => [club.id, club]))
  const champions = world.divisions.find((division) => division.divisionId === 'champions')!
  const d1 = world.divisions.find((division) => division.divisionId === 'division1')!
  // 附加赛在常规赛一结束就算好并展示在季后赛窗口里；这里直接沿用，不再换一套随机结果。
  const playoff = world.promotionPlayoff?.seasonIndex === world.seasonIndex ? world.promotionPlayoff : runPromotionPlayoff(game)
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
    if (club.isPlayer || protectedClubs.has(club.id)) continue
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
  // 新一代是另一个人：不继承上一代的卡和培养记录，当前状态就是他的原始属性。
  regen.version = 0
  delete regen.equippedCardId
  delete regen.history
  delete regen.baseSkills
  delete regen.baseSkillTiers
  regen.basePositions = { ...regen.positions }
  regen.basePersonality = { ...regen.personality }
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
  while (game.roster.length < FULL_SQUAD) {
    const template = randomSquadPositionTemplate()
    const position = template[slot % template.length]
    const player = createRandomPlayer({ seed: rng.int(0x7fffffff), position, tier: 2, usedNames: used, idPrefix: `youth-${game.season.index}-${slot}` })
    player.age = 16 + rng.int(5)
    player.contract = { clubId: 'player', wage: wageForPlayer(player), expiresSeason: game.season.index + 3 }
    game.roster.push(player)
    slot++
  }
  const repaired = autoFillLineup(game.roster, game.lineup.formationId, game.lineup.tactics)
  if (validateLineup(game.roster, repaired).valid) game.lineup = repaired
}

function refillClubStars(world: WorldState, game: GameState, protectedClubs: ReadonlySet<string> = new Set()): void {
  const pool = [...game.freeStars, ...(game.reserveStars ?? [])]
  const used = new Set(world.clubs.flatMap((club) => club.starPlayerIds))
  for (const club of world.clubs) {
    if (club.isPlayer || protectedClubs.has(club.id)) continue
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
    if (game.roster.length <= MIN_SQUAD) {
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

export function advanceWorldSeason(game: GameState, now = Date.now(), protectedClubs: ReadonlySet<string> = new Set(), fillMarket = true): { ok: boolean; error?: string } {
  if (!game.world) return { ok: false, error: '世界数据不存在' }
  if (game.activeMatch || !game.season.finished) return { ok: false, error: '赛季尚未结束或比赛进行中' }
  syncPlayerDivision(game)
  simulateOtherDivisions(game, 38)
  const allFinished = game.world.divisions.every((division) => division.fixtures.every((fixture) => fixture.played))
  if (!allFinished) return { ok: false, error: '其他联赛尚未结束' }
  ;(game.seasonHistory ??= []).push(game.season)
  promoteAndRelegate(game, protectedClubs)
  retireAndRegen(game)
  expireContracts(game)
  refillClubStars(game.world, game, protectedClubs)
  // 自由市场保持至少 250 人；不足时从储备补入。
  while (fillMarket && game.freeStars.length < 250 && (game.reserveStars?.length ?? 0) > 0) game.freeStars.push(game.reserveStars!.shift()!)
  const world = game.world
  // 赛季按日历排期开始，而不是等到有人点“下一赛季”：赛后那 12 个游戏日照样留给附加赛。新赛季接在上赛季结束处。
  const scheduledStart = seasonEndAt(world.seasonStartedAt, world.kickoffSchedule)
  world.seasonIndex++
  world.seasonStartedAt = Math.min(now, scheduledStart) > 0 ? scheduledStart : now
  world.lastPromotionPlayoff = world.promotionPlayoff
  world.promotionPlayoff = undefined
  let playerDivision = divisionIdForTier(clubById(world, 'player').tier, clubById(world, 'player').conference)
  world.playerDivisionId = playerDivision
  world.divisions = buildAllDivisions(world, splitSeed(game.seed, `world-season-${world.seasonIndex}`), world.seasonStartedAt)
  playerDivision = world.playerDivisionId
  const next = world.divisions.find((division) => division.divisionId === playerDivision)!
  game.season = next
  const teams = buildWorldDivisionTeams(world, playerDivision, splitSeed(game.seed, `world-teams-${world.seasonIndex}`), { roster: game.roster, lineup: game.lineup, reserved: game.freeStars }, game.aiClubs)
  game.aiTeams = teams.aiTeams
  // 签入的人已经并进新赛季名单，账本不再重复合并。
  for (const state of Object.values(game.aiClubs ?? {})) state.signings = []
  game.clubName = teams.playerTeam.name
  const repaired = autoFillLineup(game.roster, game.lineup.formationId, game.lineup.tactics)
  if (validateLineup(game.roster, repaired).valid) game.lineup = repaired
  game.economy = economyOf(game)
  game.economy.lastIncomeRound = 0
  if (game.market) { game.market.lastSettledRound = 0; for (const listing of game.market.listings) listing.listedRound = 1 }
  return { ok: true }
}

/* 同一轮全服结算后，只在服务器上给各教练结算个人阵容与合同；世界赛程直接引用全服快照。 */
export function advanceSharedAccountSeason(game: GameState, oldWorld: WorldState, nextWorld: WorldState, clubId: string, teams: Record<string, AITeam>): void {
  const previous = worldForClub(oldWorld, clubId)
  game.world = previous
  game.season = previous.divisions.find((division) => division.clubIds?.includes('player'))!
  ;(game.seasonHistory ??= []).push(game.season)
  const personal = { ...game, seed: splitSeed(game.seed, `club-${clubId}-retirement`), world: structuredClone(previous), roster: structuredClone(game.roster), lineup: structuredClone(game.lineup), aiTeams: [], freeStars: [], reserveStars: [] }
  personal.world.starAges = Object.fromEntries(personal.roster.filter((player) => player.starKey).map((player) => [player.id, player.age ?? 24]))
  retireAndRegen(personal)
  game.roster = personal.roster
  game.lineup = personal.lineup
  game.freeStars.push(...personal.freeStars)
  expireContracts(game)
  game.world = worldForClub(nextWorld, clubId)
  game.season = game.world.divisions.find((division) => division.clubIds?.includes('player'))!
  game.aiTeams = (game.season.clubIds ?? []).filter((id) => id !== 'player').map((id) => structuredClone(teams[id]))
  game.economy = economyOf(game)
  game.economy.lastIncomeRound = 0
  if (game.market) { game.market.lastSettledRound = 0; for (const listing of game.market.listings) listing.listedRound = 1 }
}

/** 旧世界没有 calendarStartAt：按当前赛季开始时间反推游戏第一天，日期不会从今天重新算。 */
export function ensureWorldCalendar(world: WorldState): boolean {
  if (Number.isFinite(world.calendarStartAt) && (world.calendarStartAt ?? 0) > 0) return false
  const index = Math.max(1, world.seasonIndex)
  const start = world.seasonStartedAt || Date.now()
  world.calendarStartAt = start - (index - 1) * seasonGameDays(start, world.kickoffSchedule) * GAME_DAY_MS
  return true
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
