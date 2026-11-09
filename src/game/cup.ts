import type { AITeam, GameState } from './types.ts'
import { CUP_SEED, cupDefById, type CupId } from './data/cup-config.ts'
import { CUP_TEAM_POOLS } from './data/cup-teams.generated.ts'
import type { LegendTeamDef } from './data/legend-teams.ts'
import { buildHistoricTeam } from './legend.ts'
import { cachedOwnerlessTeams } from './world.ts'
import { derivedRng, splitSeed } from './rng.ts'

export type CupParticipant = {
  id: string
  name: string
  kind: 'world' | 'random'
  team: AITeam
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

function shuffle<T>(list: readonly T[], rng: { int(maxExclusive: number): number }): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function randomTeam(def: LegendTeamDef): AITeam {
  const cached = randomTeamCache.get(def.id)
  if (cached) return cached
  const team = buildHistoricTeam(def)
  randomTeamCache.set(def.id, team)
  return team
}

/** 随机队池按赛季轮换选取；池子本身是全局固定的，所有玩家相同。 */
export function cupRandomTeams(cupId: CupId, seasonIndex: number, count?: number): CupParticipant[] {
  const def = cupDefById(cupId)
  const pool = CUP_TEAM_POOLS[def.randomPool]
  const want = count ?? def.randomCount
  if (!pool.length) throw new Error(`杯赛随机池为空：${def.randomPool}`)
  const rng = derivedRng(splitSeed(CUP_SEED, `cup-random-${cupId}-${seasonIndex}`), 'pick')
  const start = rng.int(pool.length)
  const picked: CupParticipant[] = []
  for (let i = 0; i < want; i++) {
    const teamDef = pool[(start + i) % pool.length]
    const team = randomTeam(teamDef)
    picked.push({ id: team.id, name: team.name, kind: 'random', team })
  }
  return picked
}

function allWorldTeams(game: GameState): Map<string, AITeam> {
  const byId = new Map<string, AITeam>()
  if (game.world) {
    for (const [id, team] of Object.entries(cachedOwnerlessTeams(game.world, game.seed, game.aiClubs))) byId.set(id, team)
  }
  // 本分区的当季名单优先：可能已经换人/培养过。
  for (const team of game.aiTeams) byId.set(team.id, team)
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

export function cupWorldTeams(game: GameState, cupId: CupId, seasonIndex: number, count?: number): CupParticipant[] {
  const def = cupDefById(cupId)
  const want = count ?? def.worldCount
  const teams = allWorldTeams(game)
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

/** 世界队 + 随机队混合后按赛季洗牌，得到本季该杯赛的参赛名单。 */
export function buildCupField(cupId: CupId, game: GameState, seasonIndex = game.season.index): CupParticipant[] {
  const def = cupDefById(cupId)
  const world = cupWorldTeams(game, cupId, seasonIndex, def.worldCount)
  const random = cupRandomTeams(cupId, seasonIndex, def.randomCount)
  const extraRandom = world.length < def.worldCount ? cupRandomTeams(cupId, seasonIndex, def.randomCount + (def.worldCount - world.length)) : random
  const extraWorld = random.length < def.randomCount ? cupWorldTeams(game, cupId, seasonIndex, def.worldCount + (def.randomCount - random.length)) : world
  const field = [...extraWorld, ...extraRandom]
  const rng = derivedRng(splitSeed(CUP_SEED, `cup-field-${cupId}-${seasonIndex}`), 'shuffle')
  return shuffle(field, rng).slice(0, def.size)
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
