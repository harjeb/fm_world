import { createHash } from 'node:crypto'
import type { AITeam, GameState, Player, SeasonState } from '../src/game/types.ts'

export type AccountPart = { slot: string; hash: string; json: string }

/** 不可变冻结杯赛球队的序列化缓存：避免每次保存账号都重复 JSON.stringify + SHA-256 28 支球队。 */
const frozenCupPartCache = new WeakMap<object, { hash: string; json: string }>()

/** Exact, immutable snapshots. Never rebuild a saved fixture or opponent from today's live world. */
export function packAccountGame(game: GameState, compact: boolean): { json: string; parts: AccountPart[] } {
  const reference: GameState & { __accountPartsV1?: number } = { ...game }
  delete reference.__accountPartsV1
  if (!compact || !game.shared || !Array.isArray(game.world?.divisions) || !Array.isArray(game.aiTeams)) return { json: JSON.stringify(reference), parts: [] }
  const parts: AccountPart[] = []
  const put = (slot: string, value: unknown) => {
    const json = JSON.stringify(value)
    parts.push({ slot, hash: createHash('sha256').update(json).digest('hex'), json })
  }
  reference.aiTeams = []
  reference.world = { ...game.world, divisions: [] }
  game.aiTeams.forEach((team, index) => put(`team/${index}`, team))
  game.world.divisions.forEach((division, index) => put(`division/${index}`, division))
  if (game.reserveStars) {
    put('reserve', game.reserveStars)
    delete reference.reserveStars
  }
  const cup = game.pve?.cupSeason
  if (cup?.worldTeams) {
    for (const [id, team] of Object.entries(cup.worldTeams)) {
      const cached = team && typeof team === 'object' ? frozenCupPartCache.get(team) : undefined
      if (cached) parts.push({ slot: `cup/${id}`, hash: cached.hash, json: cached.json })
      else {
        const json = JSON.stringify(team)
        const hash = createHash('sha256').update(json).digest('hex')
        if (team && typeof team === 'object' && Object.isFrozen(team)) {
          frozenCupPartCache.set(team, { hash, json })
        }
        parts.push({ slot: `cup/${id}`, hash, json })
      }
    }
    reference.pve = { ...game.pve!, cupSeason: { ...cup, worldTeams: {} } }
  }
  if (game.aiClubs && Object.keys(game.aiClubs).length) {
    put('ai-clubs', game.aiClubs)
    delete reference.aiClubs
  }
  return { json: JSON.stringify({ ...reference, __accountPartsV1: parts.length }), parts }
}

export function unpackAccountGame(
  json: string,
  parts: Iterable<Pick<AccountPart, 'slot' | 'json'> & { hash?: string }>,
  sharedCupPool?: Map<string, AITeam>,
): GameState {
  const game = JSON.parse(json) as GameState & { __accountPartsV1?: number }
  const expected = game.__accountPartsV1
  delete game.__accountPartsV1
  let count = 0
  for (const { slot, json: part, hash } of parts) {
    count++
    if (slot.startsWith('cup/') && game.pve?.cupSeason) {
      let team = hash && sharedCupPool ? sharedCupPool.get(hash) : undefined
      if (!team) {
        team = Object.freeze(JSON.parse(part) as AITeam)
        if (hash) {
          frozenCupPartCache.set(team, { hash, json: part })
          sharedCupPool?.set(hash, team)
        }
      }
      // Use an own property even if an old stored team id happens to match a prototype property.
      Object.defineProperty(game.pve.cupSeason.worldTeams, slot.slice(4), { value: team, enumerable: true, writable: true, configurable: true })
      continue
    }
    const value = JSON.parse(part)
    if (slot === 'reserve') game.reserveStars = value as Player[]
    else if (slot === 'ai-clubs') game.aiClubs = value as GameState['aiClubs']
    else if (slot.startsWith('team/')) game.aiTeams[Number(slot.slice(5))] = value as AITeam
    else if (slot.startsWith('division/') && game.world) game.world.divisions[Number(slot.slice(9))] = value as SeasonState
    else throw new Error(`未知的账号快照字段：${slot}`)
  }
  if (expected !== count && (expected !== undefined || count !== 0)) throw new Error('账号存档共享快照不完整，请检查 SQLite 备份')
  return game
}
