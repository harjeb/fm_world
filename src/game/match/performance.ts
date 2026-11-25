import type { PlayerMatchStats } from '../types.ts'

/** Optional fields are deliberately not initialized here: a resumed old match is incomplete. */
export function recordShot(stats: PlayerMatchStats, xg: number, onTarget: boolean): void {
  if (stats.xg !== undefined) stats.xg += xg
  if (stats.shotsOnTarget !== undefined && onTarget) stats.shotsOnTarget++
}

/** A created chance is the final completed pass before a teammate's shot. */
export function recordChance(stats: PlayerMatchStats, xg: number): void {
  if (stats.chancesCreated !== undefined) stats.chancesCreated++
  if (stats.xa !== undefined) stats.xa += xg
}

export function recordChanceGoal(stats: PlayerMatchStats): void {
  if (stats.chancesConverted !== undefined) stats.chancesConverted++
}

export function recordTackleAttempt(stats: PlayerMatchStats): void {
  if (stats.tackleAttempts !== undefined) stats.tackleAttempts++
}

export function recordSave(stats: PlayerMatchStats, xg = 0): void {
  if (stats.saves !== undefined) stats.saves++
  if (stats.xgConceded !== undefined && Number.isFinite(xg) && xg > 0) stats.xgConceded += xg
}

export function recordConceded(stats: PlayerMatchStats, xg = 0): void {
  if (stats.goalsConceded !== undefined) stats.goalsConceded++
  if (stats.xgConceded !== undefined && Number.isFinite(xg) && xg > 0) stats.xgConceded += xg
}

export function recordClaim(stats: PlayerMatchStats): void {
  if (stats.claims !== undefined) stats.claims++
}

/**
 * A transparent, game-specific 1–10 event rating, not an external provider's rating.
 * Calculated only for full recordings; legacy/in-progress old matches remain unknown.
 */
export function performanceRating(stats: PlayerMatchStats): number | undefined {
  const { minutes, goals, assists, shots, shotsOnTarget, passes, passesCompleted, tackles, tackleAttempts, interceptions, saves } = stats
  const values = [minutes, goals, assists, shots, shotsOnTarget, passes, passesCompleted, tackles, tackleAttempts, interceptions, saves]
  if (values.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0) || minutes <= 0 || shotsOnTarget! > shots || passesCompleted > passes || tackles > tackleAttempts!) return undefined
  if (![stats.yellowCards ?? 0, stats.redCards ?? 0].every(value => Number.isFinite(value) && value >= 0)) return undefined
  const score = 6 + goals * 0.8 + assists! * 0.5 + shotsOnTarget! * 0.1 + tackles * 0.07 + interceptions * 0.05 + saves! * 0.08
    + Math.min(0.4, passesCompleted * 0.01) - (shots - shotsOnTarget!) * 0.025 - (stats.yellowCards ?? 0) * 0.15 - (stats.redCards ?? 0) * 0.6
  return Math.round(Math.max(1, Math.min(10, score)) * 10) / 10
}
