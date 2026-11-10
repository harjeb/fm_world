import { describe, expect, it } from 'vitest'
import { CHEMISTRY_EXPIRY_DAYS, chemistryForPlayers, chemistryKey, chemistryOf, chemistrySnapshot, mergeChemistryTraining, pruneChemistry, recordMatchChemistry, recordTrainingChemistry } from '../src/game/chemistry.ts'
import { GAME_DAY_MS } from '../src/game/calendar.ts'
import type { Chemistry, PlayerMatchStats } from '../src/game/types.ts'

const now = Date.UTC(2026, 10, 10)
const stat = (id: string, side: 'home' | 'away', from: number, to: number) => ({ sourceId: id, side, onMinute: from, offMinute: to } as PlayerMatchStats)

describe('teammate chemistry', () => {
  it('grows only for actual overlapping teammates, with one symmetric record', () => {
    const owner: { chemistry?: Chemistry } = {}
    recordMatchChemistry(owner, [stat('a', 'home', 0, 45), stat('b', 'home', 45, 90), stat('c', 'home', 0, 90), stat('d', 'away', 0, 90)], now)
    expect(Object.keys(owner.chemistry!)).toHaveLength(2)
    expect(owner.chemistry![chemistryKey('a', 'c')].minutes).toBe(45)
    expect(owner.chemistry![chemistryKey('a', 'b')]).toBeUndefined()
    expect(chemistryOf(owner.chemistry, 'c', 'a', now)).toBeCloseTo(chemistryOf(owner.chemistry, 'a', 'c', now))
    expect(chemistryOf(owner.chemistry, 'a', 'c', now)).toBeGreaterThan(0)
  })

  it('starts at four points for a full match and has diminishing growth', () => {
    const owner: { chemistry?: Chemistry } = {}
    const stats = [stat('a', 'home', 0, 90), stat('b', 'home', 0, 90)]
    recordMatchChemistry(owner, stats, now)
    const first = chemistryOf(owner.chemistry, 'a', 'b', now)
    recordMatchChemistry(owner, stats, now + GAME_DAY_MS)
    expect(first).toBeCloseTo(4)
    expect(chemistryOf(owner.chemistry, 'a', 'b', now + GAME_DAY_MS) - first).toBeLessThan(first)
  })

  it('expires strictly after 180 game days and starts fresh on reunion', () => {
    const owner: { chemistry?: Chemistry } = {}
    const stats = [stat('a', 'home', 0, 90), stat('b', 'home', 0, 90)]
    recordMatchChemistry(owner, stats, now)
    const cutoff = now + CHEMISTRY_EXPIRY_DAYS * GAME_DAY_MS
    expect(pruneChemistry(owner.chemistry, cutoff)).toBe(false)
    expect(chemistryOf(owner.chemistry, 'a', 'b', cutoff + 1)).toBe(0)
    expect(chemistrySnapshot(owner.chemistry, ['a', 'b'], cutoff + 1)).toEqual({})
    expect(pruneChemistry(owner.chemistry, cutoff + 1)).toBe(true)
    recordMatchChemistry(owner, stats, cutoff + 1)
    expect(owner.chemistry![chemistryKey('a', 'b')].minutes).toBe(90)
  })

  it('caps daily training, refreshes cooperation, and resumes growth the next day', () => {
    const owner: { chemistry?: Chemistry } = {}
    for (let i = 0; i < 20; i++) recordTrainingChemistry(owner, [['a', 'b'], ['b', 'a'], ['a', 'a']], now)
    const pair = owner.chemistry![chemistryKey('a', 'b')]
    expect(pair.training).toBe(2)
    expect(Object.keys(owner.chemistry!)).toHaveLength(1)
    recordTrainingChemistry(owner, [['a', 'b']], now + GAME_DAY_MS)
    expect(pair.training).toBe(2.5)
    expect(pair.lastAt).toBe(now + GAME_DAY_MS)
  })

  it('keeps snapshots limited to the squad and historical account data limited to owned players', () => {
    const owner: { chemistry?: Chemistry } = {}
    recordMatchChemistry(owner, [stat('a', 'home', 0, 90), stat('b', 'home', 0, 90), stat('c', 'away', 0, 90), stat('d', 'away', 0, 90)], now)
    expect(Object.keys(chemistrySnapshot(owner.chemistry, ['a', 'b', 'new'], now))).toEqual([chemistryKey('a', 'b')])
    expect(Object.keys(chemistryForPlayers(owner.chemistry, new Set(['a']), now))).toEqual([chemistryKey('a', 'b')])
  })

  it('merges training once without accepting client match minutes or unrelated relationships', () => {
    const owner: { chemistry?: Chemistry } = {}
    const client: { chemistry?: Chemistry } = {}
    recordMatchChemistry(owner, [stat('a', 'home', 0, 90), stat('b', 'home', 0, 90)], now)
    recordTrainingChemistry(client, [['a', 'b'], ['a', 'c']], now)
    client.chemistry![chemistryKey('a', 'b')].minutes = 99999
    mergeChemistryTraining(owner, client.chemistry, new Set(['a', 'b']), now)
    mergeChemistryTraining(owner, client.chemistry, new Set(['a', 'b']), now)
    expect(owner.chemistry![chemistryKey('a', 'b')]).toMatchObject({ minutes: 90, training: 0.5 })
    expect(owner.chemistry![chemistryKey('a', 'c')]).toBeUndefined()
  })
})
