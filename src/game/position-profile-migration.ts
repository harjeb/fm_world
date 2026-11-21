import type { GameState, Player, PlayerCard } from './types.ts'
import { DETAILED_POSITIONS, migrateGamePositions, migratePlayerPositions, readDetailedPositions } from './detailed-positions.ts'
import { backfillNaturalPlayer, naturalPositionProfile, withPositionFloors, type PositionProfile } from './natural-positions.ts'

/** Explicit live-storage allowlist; never traverse active matches, PvE/cup snapshots or historical lineups. */
export function livePositionPlayers(game: GameState, options?: { skipFrozenShared?: boolean }): Player[] {
  const skipFrozen = options?.skipFrozenShared === true
  const aiPlayers = game.aiTeams.flatMap(t => (skipFrozen && t && Object.isFrozen(t)) ? [] : (t?.players ?? []))
  const reservePlayers = (skipFrozen && game.reserveStars && Object.isFrozen(game.reserveStars)) ? [] : (game.reserveStars ?? [])
  return [
    ...game.roster, ...aiPlayers, ...game.freeStars, ...reservePlayers,
    ...(game.market?.listings ?? []).map(l => l.player),
    ...Object.values(game.training ?? {}).map(s => s?.candidate), ...Object.values(game.candidates ?? {}),
    ...Object.values(game.aiClubs ?? {}).flatMap(c => c.signings ?? []),
    ...Object.values(game.world?.transferTeams ?? {}).flatMap(t => t?.players ?? []),
    ...(game.youth?.members ?? []).map(m => m.player), ...(game.youth?.intake.candidates ?? []).map(m => m.player),
  ].filter((p): p is Player => !!p?.positions)
}

/** Also restores server-owned profile metadata after ordinary browser saves, without erasing training gains. */
export function preservePositionProfiles(previous: GameState, incoming: GameState): void {
  const profiles = new Map<string, PositionProfile>()
  for (const player of livePositionPlayers(previous)) if (player.positionProfile) profiles.set(player.id, player.positionProfile)
  for (const player of livePositionPlayers(incoming, { skipFrozenShared: true })) {
    const profile = profiles.get(player.id)
    if (profile) player.positionProfile = structuredClone(profile)
    else delete player.positionProfile
  }
}

export function migrateLivePlayerPositions(player: Player): boolean {
  const current = readDetailedPositions(player)
  const base = readDetailedPositions({ positions: player.basePositions ?? player.positions, detailedPositions: player.baseDetailedPositions })
  let changed = migratePlayerPositions(player)
  const nextCurrent = withPositionFloors(player.positions, player.detailedPositions, current)
  const nextBase = withPositionFloors(player.basePositions ?? player.positions, player.baseDetailedPositions, base)
  if (JSON.stringify(nextCurrent) !== JSON.stringify(player.detailedPositions ?? {})) { player.detailedPositions = nextCurrent; changed = true }
  if (JSON.stringify(nextBase) !== JSON.stringify(player.baseDetailedPositions ?? {})) { player.baseDetailedPositions = nextBase; changed = true }
  return backfillNaturalPlayer(player) || changed
}

export function migratePositionProfiles(game: GameState, trustedStored = true): boolean {
  const players = livePositionPlayers(game, { skipFrozenShared: true })
  // Preserve effective legacy values even when schema-v1 inference would otherwise lower an absent entry.
  const before = new Map(players.map(p => [p, {
    current: readDetailedPositions(p),
    base: readDetailedPositions({ positions: p.basePositions ?? p.positions, detailedPositions: p.baseDetailedPositions }),
  }]))
  const oldCards = new Map((game.cards ?? []).filter(c => c.positions).map(c => [c, readDetailedPositions(c)]))
  let changed = migrateGamePositions(game, { skipFrozenShared: true })
  const profileById = new Map<string, PositionProfile>()
  // Prefer roster identities over auxiliary copies, and explicit academy intake roles over generic fallbacks.
  for (const player of [...players].reverse()) if (player.positionProfile) profileById.set(player.id, naturalPositionProfile(player))
  for (const member of [...(game.youth?.members ?? []), ...(game.youth?.intake.candidates ?? [])]) {
    if (!profileById.has(member.player.id)) {
      const intake = member.growth[0]?.plan ?? member.plans[0]?.plan ?? member.plan
      profileById.set(member.player.id, naturalPositionProfile(member.player, intake.position))
    }
  }
  for (const player of players) if (!profileById.has(player.id)) profileById.set(player.id, naturalPositionProfile(player))
  for (const player of players) {
    const old = before.get(player)!
    const current = withPositionFloors(player.positions, player.detailedPositions, old.current)
    const base = withPositionFloors(player.basePositions ?? player.positions, player.baseDetailedPositions, old.base)
    if (JSON.stringify(player.detailedPositions ?? {}) !== JSON.stringify(current)) { player.detailedPositions = current; changed = true }
    if (JSON.stringify(player.baseDetailedPositions ?? {}) !== JSON.stringify(base)) { player.baseDetailedPositions = base; changed = true }
    if (backfillNaturalPlayer(player, profileById.get(player.id)!)) changed = true
  }
  for (const card of game.cards ?? []) {
    const profile = profileById.get(card.playerId)
    if (!profile || !card.positions) continue
    let detail = withPositionFloors(card.positions, card.detailedPositions, oldCards.get(card) ?? {})
    detail = withPositionFloors(card.positions, detail, profile.floors)
    if (JSON.stringify(detail) !== JSON.stringify(card.detailedPositions ?? {})) { card.detailedPositions = detail; changed = true }
  }
  const cards = new Map((game.cards ?? []).map(c => [c.id, c]))
  for (const player of players) {
    const card: PlayerCard | undefined = player.equippedCardId ? cards.get(player.equippedCardId) : undefined
    if (!card || card.playerId !== player.id) continue
    // Trusted old storage may have a divergent equipped copy: preserve positions from both.
    // A browser PUT must NOT inject live-copy increases into a canonical immutable card.
    if (trustedStored) {
      const union = withPositionFloors(card.positions, card.detailedPositions, readDetailedPositions(player))
      if (JSON.stringify(union) !== JSON.stringify(card.detailedPositions ?? {})) { card.detailedPositions = union; changed = true }
    }
    if (DETAILED_POSITIONS.some(pos => readDetailedPositions(player)[pos] !== readDetailedPositions(card)[pos])) {
      player.detailedPositions = { ...card.detailedPositions }
      changed = true
    }
  }
  return changed
}
