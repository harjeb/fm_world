import { describe, expect, it } from 'vitest'
import type { GameState, MatchRecord, Player, PlayerMatchStats } from '../src/game/types.ts'
import { aggregatePerformance, renderPlayerPerformance } from '../src/ui/screens/player-performance.ts'

const stats = (patch: Partial<PlayerMatchStats> = {}): PlayerMatchStats => ({ playerId: 'away:player:1', name: 'P', side: 'away', minutes: 90, goals: 1, assists: 1, shots: 2, passes: 10, passesCompleted: 8, tackles: 2, interceptions: 1, distance: 100, touches: 12, staminaLeft: 50, yellowCards: 0, redCards: 0, ...patch })
const record = (id: string, patch: Partial<MatchRecord> = {}): MatchRecord => ({ id, isLeague: true, seasonIndex: 2, score: { home: 0, away: 2 }, result: 'loss', playerStats: [stats()], ...patch } as MatchRecord)
const state = (matchHistory: MatchRecord[], challengeHistory: MatchRecord[] = []): Pick<GameState, 'matchHistory' | 'challengeHistory' | 'season'> => ({ matchHistory, challengeHistory, season: { index: 2 } as GameState['season'] })

describe('player performance', () => {
  it('filters competitions, season and career, deduplicates and derives away wins from score', () => {
    const league = record('a')
    const friendly = record('b', { isLeague: false, mode: 'friendly', playerStats: [stats({ sourceId: 'player:1', playerId: 'other', goals: 2 })] })
    const old = record('c', { seasonIndex: undefined, isLeague: false, mode: 'cup' })
    const s = state([league, old], [league, friendly])
    expect(aggregatePerformance(s, 'player:1', 'season', 'all')).toMatchObject({ appearances: 2, goals: 3, wins: 2 })
    expect(aggregatePerformance(s, 'player:1', 'season', 'league')).toMatchObject({ appearances: 1, goals: 1 })
    expect(aggregatePerformance(s, 'player:1', 'career', 'cup')).toMatchObject({ appearances: 1 })
    expect(aggregatePerformance(s, 'player:1', 'career', 'all').appearances).toBe(3)
  })
  it('ignores DNP and preserves unknown optional stats', () => {
    const s = state([record('a', { playerStats: [stats({ minutes: 0 })] }), record('b', { playerStats: [stats({ assists: undefined, yellowCards: undefined })] })])
    expect(aggregatePerformance(s, 'player:1', 'season', 'all')).toMatchObject({ appearances: 1, assists: null, yellowCards: 0 })
    expect(aggregatePerformance(state([]), 'player:1', 'season', 'all')).toMatchObject({ appearances: 0, assists: null })
  })
  it('treats omitted card fields as zero, while adding actual cards across games', () => {
    const s = state([
      record('a', { playerStats: [stats({ yellowCards: undefined, redCards: undefined })] }),
      record('b', { playerStats: [stats({ yellowCards: 1, redCards: undefined })] }),
      record('c', { playerStats: [stats({ yellowCards: undefined, redCards: 1 })] }),
    ])
    expect(aggregatePerformance(s, 'player:1', 'season', 'all')).toMatchObject({ appearances: 3, yellowCards: 1, redCards: 1 })
  })
  it('renders escaped player name, accessible filters and safe empty denominators', () => {
    const html = renderPlayerPerformance({ id: 'missing-id', name: '<script>' } as Player, 'career', 'cup')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('data-performance-period="career" aria-pressed="true"')
    expect(html).toContain('data-performance-competition="cup" aria-pressed="true"')
    expect(html).not.toMatch(/NaN|Infinity/)
    expect(html).toContain('—')
  })
})
