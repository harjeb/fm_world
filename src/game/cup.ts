import type { AITeam, GameState } from './types.ts'
import { CUP_DEFS, CUP_SEED, cupDefById, type CupId } from './data/cup-config.ts'
import { CUP_TEAM_POOLS } from './data/cup-teams.generated.ts'
import type { LegendTeamDef } from './data/legend-teams.ts'
import { buildHistoricTeam } from './legend.ts'
import { generatedTeamDefinition, generatedTeamSpec } from './generated-team.ts'
import { alignPveStrength } from './pve-strength.ts'
import { caOf } from './ca.ts'
import { cachedOwnerlessTeams } from './world.ts'
import { derivedRng, splitSeed } from './rng.ts'

export type CupParticipant = {
  id: string
  name: string
  kind: 'player' | 'world' | 'random'
  /** 随机队的 LegendTeamDef id；世界队/玩家没有。 */
  defId?: string
  team: AITeam
}

export type CupSeasonState = {
  version: 1
  seasonIndex: number
  fields: Record<CupId, { worldIds: string[]; randomDefs: LegendTeamDef[] }>
  worldTeams: Record<string, AITeam>
}

export type CupFixture = {
  id: string
  round: number
  homeId: string
  awayId: string
  played: boolean
  score?: { home: number; away: number }
  matchId?: string
}

export type CupGroup = {
  index: number
  teams: CupParticipant[]
  fixtures: CupFixture[]
}

const randomTeamCache = new Map<string, AITeam>()
const randomDefCache = new Map<string, LegendTeamDef[]>()

function shuffle<T>(list: readonly T[], rng: { int(maxExclusive: number): number }): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function randomTeam(def: LegendTeamDef): AITeam {
  const key = JSON.stringify(def)
  const cached = randomTeamCache.get(key)
  if (cached) return structuredClone(cached)
  const team = alignPveStrength(buildHistoricTeam(def), def.targetCa!)
  randomTeamCache.set(key, team)
  if (randomTeamCache.size > 64) randomTeamCache.delete(randomTeamCache.keys().next().value!)
  return structuredClone(team)
}

/** Store compact deterministic recipes; a new season gets entirely new clubs and players. */
function randomDefinitions(cupId: CupId, seasonIndex: number, count: number): LegendTeamDef[] {
  const def = cupDefById(cupId)
  const pool = CUP_TEAM_POOLS[def.randomPool]
  if (!pool.length) throw new Error(`杯赛随机池为空：${def.randomPool}`)
  const key = `${cupId}-${seasonIndex}`
  const definitions = randomDefCache.get(key) ?? []
  const names = new Set(definitions.map(entry => entry.club))
  const targets = pool.map(entry => entry.targetCa!)
  const low = Math.min(...targets), high = Math.max(...targets)
  for (let i = definitions.length; i < count; i++) {
    const id = `cup-${def.randomPool}-s${seasonIndex}-${i + 1}`
    const seed = splitSeed(CUP_SEED, id)
    const target = Math.round(low + derivedRng(seed, 'cup-strength').float() * (high - low))
    const spec = generatedTeamSpec(seed, target, id, i)
    const base = spec.name
    let suffix = 2
    while (names.has(spec.name)) spec.name = `${base} ${suffix++}`
    names.add(spec.name)
    definitions.push(generatedTeamDefinition(spec))
  }
  randomDefCache.set(key, definitions)
  if (randomDefCache.size > 6) randomDefCache.delete(randomDefCache.keys().next().value!)
  return structuredClone(definitions.slice(0, count))
}

export function cupRandomTeams(cupId: CupId, seasonIndex: number, count = cupDefById(cupId).randomCount): CupParticipant[] {
  return randomDefinitions(cupId, seasonIndex, count).map(def => {
    const team = randomTeam(def)
    return { id: team.id, name: team.name, kind: 'random', defId: def.id, team }
  })
}

export function playerTeamForCup(game: GameState): AITeam {
  const ranked = [...game.roster].sort((a, b) => caOf(b.attrs, b.positions.GK > 0) - caOf(a.attrs, a.positions.GK > 0))
  return {
    id: 'player',
    name: game.clubName,
    short: game.clubName.slice(0, 2),
    color: '#34d399',
    accent: '#052e1b',
    style: 'player',
    formationId: game.lineup.formationId,
    tactics: { ...game.lineup.tactics },
    strength: 5,
    playerNames: game.roster.map((player) => player.name),
    lineup: structuredClone(game.lineup),
    players: game.roster,
    starPlayerIds: ranked.slice(0, 3).map((player) => player.id),
    starCount: 3,
    isPlayer: true,
  }
}

function allWorldTeams(game: GameState, canonical?: readonly AITeam[]): Map<string, AITeam> {
  const byId = new Map<string, AITeam>()
  if (game.world && !canonical) {
    for (const [id, team] of Object.entries(cachedOwnerlessTeams(game.world, game.seed, game.aiClubs))) byId.set(id, team)
  }
  // 本分区的当季名单优先：可能已经换人/培养过。
  for (const team of game.aiTeams) byId.set(team.id, team)
  for (const team of canonical ?? []) byId.set(team.id, team)
  return byId
}

function worldClubIds(game: GameState, cupId: CupId): string[] {
  if (!game.world) return game.aiTeams.map((team) => team.id)
  const world = game.world
  const division = world.divisions.find((item) => item.divisionId === (game.season.divisionId ?? world.playerDivisionId))
  const own = new Set(division?.clubIds ?? [])
  const ids = world.clubs
    .filter((club) => club.id !== 'player' && !club.isPlayer)
    .filter((club) => {
      if (cupId === 'community') return own.has(club.id)
      if (cupId === 'league') return club.tier !== 'champions'
      return club.tier === 'champions'
    })
    .map((club) => club.id)
  if (cupId === 'community' && ids.length < 12) {
    return world.clubs.filter((club) => club.id !== 'player' && !club.isPlayer && club.tier !== 'champions').map((club) => club.id)
  }
  return ids
}

export function cupWorldTeams(game: GameState, cupId: CupId, seasonIndex: number, count?: number, canonical?: readonly AITeam[]): CupParticipant[] {
  const def = cupDefById(cupId)
  const want = count ?? def.worldCount
  const teams = allWorldTeams(game, canonical)
  const rng = derivedRng(splitSeed(CUP_SEED, `cup-world-${cupId}-${seasonIndex}`), 'pick')
  const pool = shuffle(worldClubIds(game, cupId), rng)
    .map((id) => teams.get(id))
    .filter((team): team is AITeam => !!team && team.id !== 'player' && !team.isPlayer)
  const picked: CupParticipant[] = []
  for (let i = 0; i < Math.min(want, pool.length); i++) {
    const team = pool[i]
    picked.push({ id: team.id, name: team.name, kind: 'world', team })
  }
  return picked
}

function createCupSeason(game: GameState, seasonIndex: number, canonical?: readonly AITeam[]): CupSeasonState {
  const state: CupSeasonState = { version: 1, seasonIndex, fields: {} as CupSeasonState['fields'], worldTeams: {} }
  for (const def of CUP_DEFS) {
    const world = cupWorldTeams(game, def.id, seasonIndex, def.worldCount, canonical)
    for (const entry of world) state.worldTeams[entry.id] ??= structuredClone(entry.team)
    state.fields[def.id] = {
      worldIds: world.map(entry => entry.id),
      randomDefs: randomDefinitions(def.id, seasonIndex, def.size - 1 - world.length),
    }
  }
  return state
}

/** Capture once at season opening (or once when migrating an older save). */
export function ensureCupSeason(game: GameState, canonical?: readonly AITeam[]): boolean {
  if (!game.pve) return false
  const old = game.pve.cupSeason
  if (old?.version === 1 && old.seasonIndex === game.season.index && CUP_DEFS.every(def => {
    const field = old.fields?.[def.id]
    return Array.isArray(field?.worldIds) && Array.isArray(field.randomDefs) &&
      field.worldIds.length + field.randomDefs.length === def.size - 1 && field.worldIds.every(id => old.worldTeams?.[id])
  })) return false
  game.pve.cupSeason = createCupSeason(game, game.season.index, canonical)
  return true
}

export function hasCupSeasonTeam(game: GameState, cupId: CupId, id: string): boolean {
  const pool = game.pve?.cupSeason
  const field = pool?.fields?.[cupId]
  if (!pool || !Array.isArray(field?.worldIds) || !Array.isArray(field.randomDefs)) return false
  return field.worldIds.includes(id) && !!pool.worldTeams?.[id] || field.randomDefs.some(def => `legend-${def.id}` === id)
}

export function cupSeasonTeam(game: GameState, cupId: CupId, id: string): AITeam | undefined {
  const pool = game.pve?.cupSeason
  const field = pool?.fields?.[cupId]
  if (!pool || !Array.isArray(field?.worldIds) || !Array.isArray(field.randomDefs)) return undefined
  if (field.worldIds.includes(id)) return structuredClone(pool.worldTeams?.[id])
  const def = field.randomDefs.find(entry => `legend-${entry.id}` === id)
  return def ? randomTeam(def) : undefined
}

/** Preview and enrollment share the same season-opening opponents. */
export function buildCupField(cupId: CupId, game: GameState, seasonIndex = game.season.index): CupParticipant[] {
  if (seasonIndex === game.season.index) ensureCupSeason(game)
  const season = seasonIndex === game.season.index && game.pve?.cupSeason ? game.pve.cupSeason : createCupSeason(game, seasonIndex)
  const field = season.fields[cupId]
  const world: CupParticipant[] = field.worldIds.map(id => {
    const team = structuredClone(season.worldTeams[id])
    return { id, name: team.name, kind: 'world', team }
  })
  const random: CupParticipant[] = field.randomDefs.map(def => {
    const team = randomTeam(def)
    return { id: team.id, name: team.name, kind: 'random', defId: def.id, team }
  })
  const rng = derivedRng(splitSeed(CUP_SEED, `cup-field-${cupId}-${seasonIndex}`), 'shuffle')
  const player: CupParticipant = { id: 'player', name: game.clubName, kind: 'player', team: playerTeamForCup(game) }
  const others = shuffle([...world, ...random], rng)
  return shuffle([player, ...others], rng)
}

const GROUP_PAIRS: [number, number][][] = [
  [[0, 1], [2, 3]],
  [[0, 2], [1, 3]],
  [[0, 3], [1, 2]],
]

/** 4 队单循环：3 轮 × 2 场。 */
export function buildCupGroups(cupId: CupId, field: CupParticipant[], seasonIndex: number): CupGroup[] {
  const def = cupDefById(cupId)
  const rng = derivedRng(splitSeed(CUP_SEED, `cup-groups-${cupId}-${seasonIndex}`), 'groups')
  const shuffled = shuffle(field, rng)
  const groups: CupGroup[] = []
  for (let index = 0; index < def.groups; index++) {
    const teams = shuffled.slice(index * 4, index * 4 + 4)
    if (teams.length < 4) break
    const fixtures: CupFixture[] = []
    GROUP_PAIRS.forEach((pairs, round) => {
      pairs.forEach(([home, away], match) => {
        fixtures.push({
          id: `cup-${cupId}-${seasonIndex}-g${index + 1}-r${round + 1}-${match + 1}`,
          round: round + 1,
          homeId: teams[home].id,
          awayId: teams[away].id,
          played: false,
        })
      })
    })
    groups.push({ index, teams, fixtures })
  }
  return groups
}
