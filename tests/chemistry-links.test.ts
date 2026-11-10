import { describe, expect, it } from 'vitest'
import { chemistryKey, recordMatchChemistry } from '../src/game/chemistry.ts'
import { GAME_DAY_MS } from '../src/game/calendar.ts'
import type { Chemistry, PlayerMatchStats } from '../src/game/types.ts'
import { selectChemistryLinks } from '../src/ui/chemistry-links.ts'

const now = Date.UTC(2026, 10, 10)
const player = (id: string, x = 0, y = 0) => ({ id, x, y })

function relationships(pairs: [string, string, number][]): Chemistry {
  const owner: { chemistry?: Chemistry } = {}
  for (const [a, b, minutes] of pairs) {
    const stats = [a, b].map(sourceId => ({ sourceId, side: 'home', onMinute: 0, offMinute: minutes } as PlayerMatchStats))
    recordMatchChemistry(owner, stats, now)
  }
  return owner.chemistry!
}

describe('tactics chemistry links', () => {
  it('shows strongest non-overlapping partners while retaining other relationships', () => {
    const store = relationships([['a', 'b', 90], ['a', 'c', 45], ['b', 'd', 30], ['c', 'd', 20]])
    const players = ['a', 'b', 'c', 'd', 'e'].map(id => player(id))
    const links = selectChemistryLinks(store, players, now)
    expect(links.map(p => [p.a.id, p.b.id])).toEqual([['a', 'b'], ['c', 'd']])
    const ids = links.flatMap(p => [p.a.id, p.b.id])
    expect(new Set(ids).size).toBe(ids.length)
    expect(store[chemistryKey('a', 'c')].minutes).toBe(45)
    expect(store[chemistryKey('b', 'd')].minutes).toBe(30)
  })

  it('prefers nearby partners on ties and stays stable when roster order changes', () => {
    const store = relationships([['a', 'b', 90], ['a', 'c', 90], ['b', 'd', 90], ['c', 'd', 90]])
    const players = [player('a', 0), player('b', 1), player('c', 8), player('d', 9)]
    const links = selectChemistryLinks(store, players, now)
    expect(links.map(p => [p.a.id, p.b.id])).toEqual([['a', 'b'], ['c', 'd']])
    expect(selectChemistryLinks(store, [...players].reverse(), now)).toEqual(links)
  })

  it('excludes expired relationships and players outside the current starters', () => {
    const store = relationships([['a', 'b', 90], ['a', 'bench', 90], ['b', 'c', 90]])
    store[chemistryKey('a', 'b')].lastAt -= 180 * GAME_DAY_MS + 1
    const links = selectChemistryLinks(store, ['a', 'b', 'c'].map(id => player(id)), now)
    expect(links.map(p => [p.a.id, p.b.id])).toEqual([['b', 'c']])
    expect(links[0].minutes).toBe(90)
  })
})
