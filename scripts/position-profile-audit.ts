import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { DETAILED_POSITIONS, readDetailedPositions } from '../src/game/detailed-positions.ts'
import { livePositionPlayers, migrateLivePlayerPositions, migratePositionProfiles } from '../src/game/position-profile-migration.ts'
import type { AITeam, GameState, Player } from '../src/game/types.ts'

// Read-only production audit. Transform only parsed in-memory copies; NEVER persist to the supplied directory.
const dir = process.argv[2] ?? 'data'
const world = JSON.parse(fs.readFileSync(path.join(dir, 'world.json'), 'utf8'))
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function untouched(p: Player) {
  const { detailedPositions, baseDetailedPositions, detailedPositionsVersion, baseDetailedPositionsVersion, positionProfile, ...rest } = p
  return rest
}
function snapshot(p: Player) {
  return { fingerprint: hash(untouched(p)), current: readDetailedPositions(p), base: readDetailedPositions({ positions: p.basePositions, detailedPositions: p.baseDetailedPositions }) }
}
function verify(p: Player, old: ReturnType<typeof snapshot>): void {
  if (hash(untouched(p)) !== old.fingerprint) throw new Error(`Non-position fields changed: ${p.id}`)
  const current = readDetailedPositions(p), base = readDetailedPositions({ positions: p.basePositions, detailedPositions: p.baseDetailedPositions })
  for (const pos of DETAILED_POSITIONS) if (current[pos] < old.current[pos] || base[pos] < old.base[pos]) throw new Error(`Proficiency decreased: ${p.id}/${pos}`)
}
function coverage(players: Player[], threshold: number) {
  return Object.fromEntries(DETAILED_POSITIONS.map(pos => [pos, players.filter(p => readDetailedPositions({ positions: p.basePositions, detailedPositions: p.baseDetailedPositions })[pos] >= threshold).length]))
}
const teams = Object.values(world.teams ?? {}) as AITeam[]
const random = teams.flatMap(t => t.players).filter(p => p.era === 'random')
const before = { playable: coverage(random, 80), natural: coverage(random, 90) }
let worldChanged = 0
for (const p of [
  ...teams.flatMap(t => t.players), ...world.freeStars, ...world.reserveStars,
  ...Object.values(world.aiClubs ?? {}).flatMap((c: any) => c.signings ?? []),
  ...Object.values(world.world.transferTeams ?? {}).flatMap((t: any) => t.players ?? []),
] as Player[]) {
  const old = snapshot(p)
  if (migrateLivePlayerPositions(p)) worldChanged++
  verify(p, old)
  if (migrateLivePlayerPositions(p)) throw new Error(`Non-idempotent world migration: ${p.id}`)
}
const after = { playable: coverage(random, 80), natural: coverage(random, 90) }
const short = teams.filter(t => ['DL', 'DR', 'WBL', 'WBR'].some(pos => !t.players.some(p => readDetailedPositions({ positions: p.basePositions, detailedPositions: p.baseDetailedPositions })[pos as 'DL'] >= 80)))
console.log(JSON.stringify({ randomPlayers: random.length, before, after, worldChanged, teamsWithFullbackShortage: short.map(t => t.id) }, null, 2))
const db = new DatabaseSync(path.join(dir, 'accounts.sqlite'), { readOnly: true })
let accounts = 0, changed = 0, copies = 0, cards = 0
try {
  for (const row of db.prepare('SELECT game_json FROM accounts').iterate()) {
    const game = JSON.parse(row.game_json as string) as GameState
    const players = livePositionPlayers(game)
    const old = players.map(snapshot)
    const oldCards = new Map((game.cards ?? []).map(card => {
      const { detailedPositions, detailedPositionsVersion, ...unchanged } = card
      return [card, { positions: readDetailedPositions(card), fingerprint: hash(unchanged) }] as const
    }))
    const frozen = hash([game.activeMatch, game.pve, game.matchHistory, game.challengeHistory])
    if (migratePositionProfiles(game)) changed++
    for (let i = 0; i < players.length; i++) verify(players[i], old[i])
    for (const card of game.cards ?? []) {
      const oldCard = oldCards.get(card)!
      const { detailedPositions, detailedPositionsVersion, ...unchanged } = card
      if (hash(unchanged) !== oldCard.fingerprint) throw new Error(`Card non-position fields changed: ${card.id}`)
      const effective = readDetailedPositions(card)
      for (const pos of DETAILED_POSITIONS) if (effective[pos] < oldCard.positions[pos]) throw new Error(`Card proficiency decreased: ${card.id}/${pos}`)
    }
    if (hash([game.activeMatch, game.pve, game.matchHistory, game.challengeHistory]) !== frozen) throw new Error('Frozen match/PvE snapshots changed')
    if (migratePositionProfiles(game)) throw new Error('Account migration is not idempotent')
    accounts++; copies += players.length; cards += game.cards?.length ?? 0
  }
} finally { db.close() }
console.log(JSON.stringify({ accounts, changed, livePlayerCopiesChecked: copies, cards, status: 'PASS: read-only, no decreases or non-position changes; frozen snapshots preserved; idempotent' }))
