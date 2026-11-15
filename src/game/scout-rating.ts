import type { AttrKey, Attributes, DetailedPosition, DetailedPositionTable, Foot, PositionTable, RoleId, StyleId } from './types.ts'
import { PLAYABLE_PROFICIENCY, positionMultiplier } from './ca.ts'
import { FORMATIONS } from './data/formations.ts'
import { ROLES, roleFit, rolesForSlot } from './data/roles.ts'
import { DETAILED_POSITIONS, detailedPositionForSlot, detailedPositionValue, isDetailedPosition } from './detailed-positions.ts'

/** Only supplied information is used. Attribute values use normal storage units, not 0–100 ratings. */
export type ScoutSubject = {
  attrs: Partial<Attributes>
  positions: PositionTable
  detailedPositions?: DetailedPositionTable
  foot?: Foot
  style?: StyleId
}

export type PositionRelativeRating = {
  position: DetailedPosition
  role: RoleId
  /** Role fit (rating scale) multiplied by position proficiency. */
  score: number
  /** Mean of the strongest up to three eligible roster scores at this position. */
  reference: number
  stars: number
}

// Take the union of roles allowed by actual formation slots for each detailed position.
const positionRoles = new Map<DetailedPosition, RoleId[]>()
for (const formation of Object.values(FORMATIONS)) {
  for (const slot of formation.slots) {
    const position = detailedPositionForSlot(slot)
    const roles = positionRoles.get(position) ?? []
    for (const role of rolesForSlot(slot)) if (!roles.includes(role)) roles.push(role)
    positionRoles.set(position, roles)
  }
}

function positionScore(subject: ScoutSubject, position: DetailedPosition): { role: RoleId; score: number } | null {
  if (!subject?.positions || !subject.attrs) return null
  // Match the game's player scale convention; do not compare keepers with outfield players.
  const isGk = subject.positions.GK > 0
  if (isGk !== (position === 'GK')) return null
  const proficiency = detailedPositionValue(subject, position)
  if (proficiency < PLAYABLE_PROFICIENCY) return null
  let best: { role: RoleId; score: number } | null = null
  for (const role of positionRoles.get(position) ?? []) {
    const keys = Object.keys(ROLES[role].weights) as AttrKey[]
    // A role with unknown inputs is not an estimate of zero; only evaluate complete roles.
    if (!keys.every(key => typeof subject.attrs[key] === 'number' && Number.isFinite(subject.attrs[key]) && subject.attrs[key]! >= 0)) continue
    const score = roleFit(subject.attrs as Record<string, number>, role, isGk) * positionMultiplier(proficiency)
    if (!best || score > best.score) best = { role, score }
  }
  return best
}

/**
 * Compare with the mean of the top three (or all, if fewer) eligible roster players.
 * Baseline is exactly the supplied roster, including the subject if present: this makes
 * comparing alternate versions reproducible without silently replacing the current player.
 * 3 stars means equal to the baseline; each 10% difference adds/subtracts 0.5 stars,
 * rounded to the nearest half and clamped to 0–5. No positive reference => null.
 */
export function positionRelativeRating(subject: ScoutSubject, position: DetailedPosition, roster: readonly ScoutSubject[]): PositionRelativeRating | null {
  if (!isDetailedPosition(position)) return null
  const result = positionScore(subject, position)
  if (!result) return null
  const scores = (roster ?? []).map(player => positionScore(player, position)?.score)
    .filter((score): score is number => score !== undefined && Number.isFinite(score) && score > 0)
    .sort((a, b) => b - a).slice(0, 3)
  if (!scores.length) return null
  const reference = scores.reduce((sum, score) => sum + score, 0) / scores.length
  const stars = Math.max(0, Math.min(5, Math.round((3 + (result.score / reference - 1) * 5) * 2) / 2))
  return { position, ...result, reference, stars }
}

/** All playable positions with a usable baseline, strongest score first; ties follow the canonical position order. */
export function preferredPositionRatings(subject: ScoutSubject, roster: readonly ScoutSubject[]): PositionRelativeRating[] {
  return DETAILED_POSITIONS.map(position => positionRelativeRating(subject, position, roster))
    .filter((rating): rating is PositionRelativeRating => rating !== null)
    .sort((a, b) => b.score - a.score)
}
