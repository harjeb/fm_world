import type { Chemistry } from '../game/types.ts'
import { GAME_DAY_MS } from '../game/calendar.ts'
import { chemistryKey, chemistryOf } from '../game/chemistry.ts'

export type ChemistryLinkPlayer = { id: string; x: number; y: number }
export type ChemistryLink = { a: ChemistryLinkPlayer; b: ChemistryLinkPlayer; value: number; minutes: number }

/** Display strongest disjoint pairs, preferring nearby partners when scores tie. */
export function selectChemistryLinks(store: Chemistry | undefined, players: ChemistryLinkPlayer[], now: number, gameDayMs = GAME_DAY_MS): ChemistryLink[] {
  const ordered = [...players].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const candidates: ChemistryLink[] = []
  for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) {
    const a = ordered[i], b = ordered[j]
    if (a.id === b.id) continue
    const value = chemistryOf(store, a.id, b.id, now, gameDayMs)
    if (value > 0) candidates.push({ a, b, value, minutes: store![chemistryKey(a.id, b.id)].minutes })
  }
  const distance = ({ a, b }: ChemistryLink) => Math.hypot(a.x - b.x, a.y - b.y)
  candidates.sort((a, b) => b.value - a.value || distance(a) - distance(b) ||
    (chemistryKey(a.a.id, a.b.id) < chemistryKey(b.a.id, b.b.id) ? -1 : 1))
  const used = new Set<string>()
  return candidates.filter(({ a, b }) => {
    if (used.has(a.id) || used.has(b.id)) return false
    used.add(a.id)
    used.add(b.id)
    return true
  })
}
