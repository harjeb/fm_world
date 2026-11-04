import type { GameState, Player } from './types.ts'
import type { MatchState } from './match/types.ts'
import { INJURY_PROFILES } from './data/injury-profiles.ts'
import type { PCG32 } from './rng.ts'
import { economyOf } from './economy.ts'
import { matchRealSeconds } from './match/time.ts'

export function personKey(player: Pick<Player, 'id' | 'seedId'>): string {
  return player.seedId || player.id
}

export function injuryProneness(personId: string): number {
  return Object.hasOwn(INJURY_PROFILES, personId) ? INJURY_PROFILES[personId] : 10
}

export function injuryRisk(prone: number, fatigue: number, prevention: boolean): number {
  const boundedProne = Math.max(1, Math.min(20, prone))
  const boundedFatigue = Math.max(0, Math.min(1, fatigue))
  return (0.012 + boundedFatigue * 0.025) * (0.5 + boundedProne / 20) * (prevention ? 0.7 : 1)
}

// Most injuries are short; 3% last 30–60 game days.
export function injuryRecoveryDays(rng: Pick<PCG32, 'int'>, resilience: boolean): number {
  const tier = rng.int(100)
  const days = tier < 70 ? 1 + rng.int(5) : tier < 90 ? 6 + rng.int(9) : tier < 97 ? 15 + rng.int(15) : 30 + rng.int(31)
  return resilience ? Math.max(1, Math.ceil(days * 0.7)) : days
}

export function injuryUntil(game: Pick<GameState, 'injuries'>, player: Pick<Player, 'id' | 'seedId'>, now = Date.now()): number | null {
  const until = game.injuries?.[personKey(player)]
  return typeof until === 'number' && Number.isFinite(until) && Number.isFinite(now) && until > now ? until : null
}

export function prepareMatchInjuries(state: MatchState, injuries: GameState['injuries'], now: number): void {
  for (const team of state.teams) {
    for (const player of [...team.players, ...team.bench]) {
      const until = injuries?.[player.personId ?? player.sourceId]
      if (typeof until === 'number' && Number.isFinite(until) && Number.isFinite(now) && until > now) player.injured = true
    }
  }
}

export function recordMatchInjuries(game: GameState, state: MatchState, baseTime: number, useMatchClock: boolean): void {
  for (const entry of state.log) {
    const injury = entry.type === 'injury' ? entry.injury : undefined
    if (!injury || !injury.personId || !Number.isFinite(injury.recoveryDays) || injury.recoveryDays <= 0) continue
    let until = injury.recoverAt
    if (until === undefined) {
      const team = state.teams.find(team => team.side === entry.team)
      if (team?.id === 'player') {
        const medical = economyOf(game).medical
        const level = Number.isInteger(medical) && medical >= 1 && medical <= 5 ? medical : 1
        injury.recoveryDays = Math.max(1, Math.ceil(injury.recoveryDays * (1 - 0.08 * (level - 1))))
      }
      const time = baseTime + (useMatchClock ? matchRealSeconds(entry.clock, state.durationSeconds) * 1000 : 0)
      until = time + game.season.gameDayMs * injury.recoveryDays
      if (!Number.isFinite(until) || !Number.isFinite(game.season.gameDayMs) || game.season.gameDayMs <= 0) continue
      injury.recoverAt = until
    }
    if (!Number.isFinite(until)) continue
    game.injuries ??= {}
    const previous = game.injuries[injury.personId]
    if (!Number.isFinite(previous) || until > previous) game.injuries[injury.personId] = until
  }
}
