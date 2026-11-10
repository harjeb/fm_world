import type { Chemistry, PairChemistry, PlayerMatchStats } from './types.ts'
import { GAME_DAY_MS } from './calendar.ts'

export const CHEMISTRY_EXPIRY_DAYS = 180
export const CHEMISTRY_TRAINING_DAILY_CAP = 2

export function chemistryKey(a: string, b: string): string {
  return JSON.stringify(a < b ? [a, b] : [b, a])
}

export function chemistryExpired(pair: PairChemistry, now: number, gameDayMs = GAME_DAY_MS): boolean {
  return now - pair.lastAt > CHEMISTRY_EXPIRY_DAYS * gameDayMs
}

/** Cumulative exposure gives diminishing returns without storing per-match history. */
export function chemistryValue(pair: PairChemistry | undefined): number {
  return pair ? 100 * (1 - Math.pow(0.96, pair.minutes / 90) * Math.pow(0.99, pair.training)) : 0
}

export function chemistryOf(store: Chemistry | undefined, a: string, b: string, now = Date.now(), gameDayMs = GAME_DAY_MS): number {
  const pair = store?.[chemistryKey(a, b)]
  return pair && !chemistryExpired(pair, now, gameDayMs) ? chemistryValue(pair) : 0
}

export function pruneChemistry(store: Chemistry | undefined, now: number, gameDayMs = GAME_DAY_MS): boolean {
  let changed = false
  for (const [key, pair] of Object.entries(store ?? {})) {
    if (chemistryExpired(pair, now, gameDayMs)) { delete store![key]; changed = true }
  }
  return changed
}

function pairFor(store: Chemistry, a: string, b: string, now: number, gameDayMs: number): PairChemistry {
  const key = chemistryKey(a, b)
  let pair = store[key]
  if (!pair || chemistryExpired(pair, now, gameDayMs)) {
    pair = { players: a < b ? [a, b] : [b, a], minutes: 0, training: 0, lastAt: now }
    store[key] = pair
  }
  return pair
}

/** Legacy records without entry/exit times cannot reliably identify overlap. */
export function recordMatchChemistry(owner: { chemistry?: Chemistry }, stats: PlayerMatchStats[], now: number, gameDayMs = GAME_DAY_MS): void {
  pruneChemistry(owner.chemistry, now, gameDayMs)
  const played = stats.filter(p => p.sourceId && p.onMinute !== undefined && p.offMinute !== undefined && p.offMinute > p.onMinute)
  for (let i = 0; i < played.length; i++) for (let j = i + 1; j < played.length; j++) {
    const a = played[i], b = played[j]
    if (a.side !== b.side || a.sourceId === b.sourceId) continue
    const overlap = Math.max(0, Math.min(90, a.offMinute!, b.offMinute!) - Math.max(0, a.onMinute!, b.onMinute!))
    if (!overlap) continue
    const pair = pairFor(owner.chemistry ??= {}, a.sourceId!, b.sourceId!, now, gameDayMs)
    pair.minutes += overlap
    pair.lastAt = Math.max(pair.lastAt, now)
  }
}

/** Only actual training partners are supplied; each pair has a daily growth budget. */
export function recordTrainingChemistry(owner: { chemistry?: Chemistry }, pairs: [string, string][], now: number, gameDayMs = GAME_DAY_MS): void {
  pruneChemistry(owner.chemistry, now, gameDayMs)
  const seen = new Set<string>()
  for (const [a, b] of pairs) {
    const key = chemistryKey(a, b)
    if (a === b || seen.has(key)) continue
    seen.add(key)
    const pair = pairFor(owner.chemistry ??= {}, a, b, now, gameDayMs)
    if (Math.floor((pair.trainingAt ?? -gameDayMs) / gameDayMs) !== Math.floor(now / gameDayMs)) pair.trainingToday = 0
    const gain = Math.max(0, Math.min(0.5, CHEMISTRY_TRAINING_DAILY_CAP - (pair.trainingToday ?? 0)))
    pair.training += gain
    pair.trainingToday = (pair.trainingToday ?? 0) + gain
    pair.trainingAt = now
    pair.lastAt = Math.max(pair.lastAt, now)
  }
}

/** Match snapshots contain scores only for the selected squad, including substitutes. */
export function chemistrySnapshot(store: Chemistry | undefined, ids: string[], now: number, gameDayMs = GAME_DAY_MS): Record<string, number> {
  const result: Record<string, number> = {}
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const value = chemistryOf(store, ids[i], ids[j], now, gameDayMs)
    if (value > 0) result[chemistryKey(ids[i], ids[j])] = value
  }
  return result
}

/** Accounts receive current and former partners of their own players only. */
export function chemistryForPlayers(store: Chemistry | undefined, ids: Set<string>, now: number, gameDayMs = GAME_DAY_MS): Chemistry {
  return Object.fromEntries(Object.entries(store ?? {}).filter(([, pair]) => !chemistryExpired(pair, now, gameDayMs) && pair.players.some(id => ids.has(id))).map(([key, pair]) => [key, { ...pair, players: [...pair.players] as [string, string] }]))
}

/** Merge client training exposure without rolling back authoritative match minutes. */
export function mergeChemistryTraining(owner: { chemistry?: Chemistry }, incoming: Chemistry | undefined, roster: Set<string>, now: number, gameDayMs = GAME_DAY_MS): void {
  pruneChemistry(owner.chemistry, now, gameDayMs)
  for (const [key, candidate] of Object.entries(incoming ?? {})) {
    if (!candidate || !Array.isArray(candidate.players) || candidate.players.length !== 2) continue
    const [a, b] = candidate.players
    if (typeof a !== 'string' || typeof b !== 'string' || a === b || !roster.has(a) || !roster.has(b) || key !== chemistryKey(a, b)) continue
    if (!Number.isFinite(candidate.training) || candidate.training <= 0 || !Number.isFinite(candidate.trainingAt) || candidate.trainingAt! > now || chemistryExpired({ ...candidate, lastAt: candidate.trainingAt! }, now, gameDayMs)) continue
    const pair = pairFor(owner.chemistry ??= {}, a, b, candidate.trainingAt!, gameDayMs)
    if (candidate.training <= pair.training) continue
    pair.training = candidate.training
    if (candidate.trainingAt! >= (pair.trainingAt ?? 0)) pair.trainingToday = Number.isFinite(candidate.trainingToday) ? Math.max(0, Math.min(CHEMISTRY_TRAINING_DAILY_CAP, candidate.trainingToday!)) : 0
    pair.trainingAt = Math.max(pair.trainingAt ?? 0, candidate.trainingAt!)
    pair.lastAt = Math.max(pair.lastAt, candidate.trainingAt!)
  }
}
