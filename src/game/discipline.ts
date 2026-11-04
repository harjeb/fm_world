import type { GameState } from './types.ts'

type LogState = { log: { card?: 'yellow' | 'red'; playerId?: string; side?: 'home' | 'away' | 'none' }[] }

export function suspendedPlayerIds(game: GameState): Set<string> {
  return new Set(Object.entries(game.suspensions ?? {}).filter(([, value]) => value.matches > 0).map(([id]) => id))
}

export function recordMatchDiscipline(game: GameState, state: LogState): void {
  game.suspensions ??= {}
  game.yellowCounts ??= {}
  const round = game.season?.round ?? 1
  const seenRed = new Set<string>()
  for (const entry of state.log) {
    if (!entry.card || !entry.playerId) continue
    const id = entry.playerId.split(':').slice(1).join(':') || entry.playerId
    if (entry.card === 'yellow') {
      game.yellowCounts[id] = (game.yellowCounts[id] ?? 0) + 1
      if (game.yellowCounts[id] >= 3) {
        game.yellowCounts[id] = 0
        game.suspensions[id] = { matches: 1, atRound: round + 1 }
      }
    } else if (!seenRed.has(id)) {
      seenRed.add(id)
      game.yellowCounts[id] = 0
      game.suspensions[id] = { matches: 2, atRound: round + 1 }
    }
  }
}

/** Call after a round has fully settled; bans start with the following round. */
export function serveSuspensions(game: GameState, round: number): void {
  if (!game.suspensions) return
  for (const [id, value] of Object.entries(game.suspensions)) {
    if (round < value.atRound) continue
    value.matches--
    if (value.matches <= 0) delete game.suspensions[id]
    else value.atRound = round + 1
  }
}
