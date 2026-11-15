import { describe, expect, it } from 'vitest'
import { inferDetailedPositions, migrateGamePositions, detailedPositionValue } from '../src/game/detailed-positions.ts'
import { createInitialGame } from '../src/game/state.ts'
import { baseBuild } from '../src/game/cards.ts'
import { POSITION_TO_DETAILED, readDetailedPositions } from '../src/game/detailed-positions.ts'
import { toMatchPlayer } from '../src/game/match/team.ts'
import { MatchRatings } from '../src/game/match/ratings.ts'
import { createTrainingSession, performTrainingAction } from '../src/game/training.ts'

describe('detailed position migration', () => {
  it('estimates adjacent roles for every outfield primary without inventing playable expertise', () => {
    for (const primary of ['CB', 'W', 'CM', 'ST'] as const) {
      const positions = { GK: 0, CB: 0, W: 0, CM: 0, ST: 0, [primary]: 100 }
      const source = { positions, foot: 'L' as const, style: primary === 'W' ? 'w_dribbler' as const : 'cm_destroyer' as const }
      const table = inferDetailedPositions(source)
      expect(table).toEqual(inferDetailedPositions(source))
      expect(table.GK).toBe(0)
      expect(Math.max(...POSITION_TO_DETAILED[primary].map(pos => table[pos]))).toBe(100)
      const others = (['CB', 'W', 'CM', 'ST'] as const).filter(pos => pos !== primary).flatMap(pos => POSITION_TO_DETAILED[pos].map(detail => table[detail]))
      expect(Math.max(...others)).toBeGreaterThan(0)
      expect(Math.max(...others)).toBeLessThan(80)
      expect(new Set(Object.values(table)).size).toBeGreaterThan(2)
    }
    const keeper = inferDetailedPositions({ positions: { GK: 90, CB: 0, W: 0, CM: 0, ST: 0 } })
    expect(Object.values(keeper).filter(value => value !== 0)).toEqual([90])
  })
  it('migrates complete untrained coarse copies but not explicit or trained zeros', () => {
    const game = createInitialGame(19)
    const player = game.roster.find(p => p.positions.GK === 0)!
    player.positions = { GK: 0, CB: 95, W: 0, CM: 0, ST: 0 }
    player.basePositions = { ...player.positions }
    const copy = Object.fromEntries(Object.entries(POSITION_TO_DETAILED).flatMap(([coarse, group]) => group.map(pos => [pos, player.positions[coarse as keyof typeof player.positions]])))
    player.detailedPositions = { ...copy }
    player.baseDetailedPositions = { ...copy }
    player.version = 0
    delete player.equippedCardId
    player.history = []
    delete player.detailedPositionsVersion
    delete player.baseDetailedPositionsVersion
    migrateGamePositions(game)
    expect(player.detailedPositions!.DC).toBe(95)
    expect(player.detailedPositions!.DM).toBeGreaterThan(0)
    expect(player.detailedPositions!.DL).toBeGreaterThan(0)
    expect(player.baseDetailedPositions).toEqual(player.detailedPositions)
    expect(migrateGamePositions(game)).toBe(false)
    player.detailedPositions = { ...copy }
    player.baseDetailedPositions = { ...copy }
    player.version = 1
    delete player.detailedPositionsVersion
    delete player.baseDetailedPositionsVersion
    migrateGamePositions(game)
    expect(player.detailedPositions).toEqual(copy)
    expect(player.baseDetailedPositions).toEqual(copy)
    expect(migrateGamePositions(game)).toBe(false)
  })
  it('keeps small-world legacy tables deterministic with correct main positions', () => {
    const game = createInitialGame(29)
    const players = [...game.roster, ...game.aiTeams.flatMap(team => team.players), ...game.freeStars]
    for (const player of players) {
      delete player.detailedPositions
      delete player.detailedPositionsVersion
      delete player.baseDetailedPositions
      delete player.baseDetailedPositionsVersion
    }
    migrateGamePositions(game)
    for (const player of players) {
      const table = player.detailedPositions!
      const main = (['GK', 'CB', 'W', 'CM', 'ST'] as const).reduce((a, b) => player.positions[a] >= player.positions[b] ? a : b)
      const peak = Math.max(...Object.values(table).filter((v): v is number => v !== undefined))
      expect(Math.max(...POSITION_TO_DETAILED[main].map(pos => table[pos]!))).toBe(peak)
      expect(peak).toBeGreaterThan(0)
      expect(new Set(Object.values(table)).size).toBeGreaterThan(1)
      expect(table).toEqual(inferDetailedPositions(player))
    }
    expect(migrateGamePositions(game)).toBe(false)
  })
  it('preserves coarse peaks and differentiates style and foot deterministically', () => {
    const source = { positions: { GK: 0, CB: 40, W: 92.5, CM: 85, ST: 30 }, foot: 'L' as const, style: 'fb_attacking' as const }
    const result = inferDetailedPositions(source)
    expect(result).toEqual(inferDetailedPositions(source))
    expect(result.DL).toBe(92.5)
    expect(result.DR).toBeLessThan(result.DL)
    expect(result.AML).toBeLessThan(result.DL)
    expect(result.MC).toBe(85)
    expect(result.DM).toBeLessThan(result.MC)
  })
  it('restores legacy match position coefficients without inferring from style', () => {
    const player = createInitialGame(51).roster.find(p => !p.positions.GK)!
    player.positions.W = 85
    player.style = 'w_dribbler'
    delete player.detailedPositions
    const matchPlayer = toMatchPlayer(player, 'home', 'w_winger', 'lb', 'W')
    matchPlayer.detailedPosition = 'DL'
    const ratings = new MatchRatings(() => ({ seed: 1, step: 0, clock: 0, score: { home: 0, away: 0 }, teams: [] } as never), () => 90)
    const legacy = ratings.eff(matchPlayer, 'passing')
    matchPlayer.detailedPosition = undefined
    expect(ratings.eff(matchPlayer, 'passing')).toBe(legacy)
    matchPlayer.detailedPosition = 'DL'
    matchPlayer.detailedPositions = { DL: 0 }
    expect(ratings.eff(matchPlayer, 'passing')).toBeLessThan(legacy)
  })
  it('materializes legacy coarse values before coarse position training', () => {
    const player = createInitialGame(52).roster.find(p => !p.positions.GK)!
    delete player.detailedPositions
    delete player.baseDetailedPositions
    const session = createTrainingSession(player, 123)
    delete session.scheduleVersion
    delete session.candidate.detailedPositions
    session.candidate.positions.W = 10
    expect(performTrainingAction(session, { kind: 'position', position: 'W' }, undefined, 0, { silent: true }).ok).toBe(true)
    expect(session.candidate.detailedPositionsVersion).toBe(1)
    expect(session.candidate.detailedPositions!.DL).toBe(session.candidate.positions.W)
    expect(session.candidate.detailedPositions!.DR).toBe(session.candidate.positions.W)
  })
  it('infers a missing base table independently when coarse builds differ', () => {
    const game = createInitialGame(51)
    const p = game.roster.find(p => !p.positions.GK)!
    p.version = 0
    delete p.equippedCardId
    p.history = []
    p.positions = { GK: 0, CB: 90, W: 0, CM: 0, ST: 0 }
    p.basePositions = { GK: 0, CB: 0, W: 0, CM: 0, ST: 90 }
    delete p.detailedPositions
    delete p.baseDetailedPositions
    delete p.detailedPositionsVersion
    delete p.baseDetailedPositionsVersion
    migrateGamePositions(game)
    expect(p.baseDetailedPositions).toEqual(inferDetailedPositions({ positions: p.basePositions, foot: p.foot, style: p.style }))
    expect(p.baseDetailedPositions).not.toEqual(p.detailedPositions)
  })
  it('always reads the coarse GK in inconsistent old snapshots', () => {
    const snapshot = { positions: { GK: 84, CB: 0, W: 0, CM: 0, ST: 0 }, detailedPositions: { GK: 3 } }
    expect(detailedPositionValue(snapshot, 'GK')).toBe(84)
    expect(readDetailedPositions(snapshot).GK).toBe(84)
    snapshot.positions.GK = 0
    snapshot.detailedPositions.GK = 100
    expect(detailedPositionValue(snapshot, 'GK')).toBe(0)
  })
  it('migrates only complete copied groups and preserves independent groups and versioned builds', () => {
    const game = createInitialGame(44)
    const p = game.roster.find(p => !p.positions.GK)!
    p.positions = { GK: 0, CB: 75, W: 90, CM: 80, ST: 50 }
    p.basePositions = { ...p.positions }
    p.foot = 'L'
    p.detailedPositions = Object.fromEntries(Object.entries(POSITION_TO_DETAILED).flatMap(([coarse, group]) => group.map(pos => [pos, p.positions[coarse as keyof typeof p.positions]])))
    p.detailedPositions.DM = 0
    p.baseDetailedPositions = { ...p.detailedPositions }
    delete p.detailedPositionsVersion
    delete p.baseDetailedPositionsVersion
    const before = { ...p.positions }
    expect(migrateGamePositions(game)).toBe(true)
    expect(Math.max(...POSITION_TO_DETAILED.W.map(pos => p.detailedPositions![pos]!))).toBe(90)
    expect(POSITION_TO_DETAILED.W.every(pos => p.detailedPositions![pos] === 90)).toBe(true)
    expect(p.detailedPositions.DM).toBe(0)
    expect(p.detailedPositions.MC).toBe(80)
    expect(p.positions).toEqual(before)
    expect(p.baseDetailedPositions).toEqual(p.detailedPositions)
    const saved = structuredClone(p.detailedPositions)
    expect(migrateGamePositions(game)).toBe(false)
    expect(p.detailedPositions).toEqual(saved)
    p.detailedPositions = Object.fromEntries(POSITION_TO_DETAILED.W.map(pos => [pos, 90]))
    migrateGamePositions(game)
    expect(POSITION_TO_DETAILED.W.every(pos => p.detailedPositions![pos] === 90)).toBe(true)
  })
  it('keeps ambiguous trained uniform groups and equipped card copies intact', () => {
    const game = createInitialGame(45)
    const player = game.roster.find(p => !p.positions.GK)!
    player.positions.W = 90
    player.detailedPositions = Object.fromEntries(POSITION_TO_DETAILED.W.map(pos => [pos, 90]))
    delete player.detailedPositionsVersion
    player.version = 1
    player.equippedCardId = 'legacy'
    const table = { ...player.detailedPositions }
    game.cards = [{ id: 'legacy', playerId: player.id, playerName: player.name, serial: 1, version: 1, routeId: null, createdAt: 0, attrs: player.attrs, positions: { ...player.positions }, personality: player.personality, skills: [], detailedPositions: { ...table } }]
    migrateGamePositions(game)
    expect(player.detailedPositions).toEqual(table)
    expect(game.cards[0].detailedPositions).toEqual(table)
    expect(player.detailedPositionsVersion).toBe(1)
    expect(game.cards[0].detailedPositionsVersion).toBe(1)
    expect(migrateGamePositions(game)).toBe(false)
  })
  it('migrates players, cards and candidates idempotently without touching snapshots or explicit zeros', () => {
    const game = createInitialGame(123)
    const player = game.roster[0]
    delete player.detailedPositions
    delete player.detailedPositionsVersion
    delete player.baseDetailedPositions
    delete player.baseDetailedPositionsVersion
    const candidate = structuredClone(player)
    candidate.detailedPositions = { DL: 0 }
    game.candidates[player.id] = candidate
    game.cards = [{ id: 'x', playerId: player.id, playerName: player.name, serial: 1, version: 1, routeId: null, createdAt: 0, attrs: player.attrs, positions: player.positions, personality: player.personality, skills: [], detailedPositions: { DL: 0 } }]
    const snapshot = { marker: { positions: { W: 99 } } }
    game.activeMatch = snapshot as never
    expect(migrateGamePositions(game)).toBe(true)
    expect(player.detailedPositions).toBeDefined()
    expect(player.baseDetailedPositions).toEqual(player.detailedPositions)
    expect(candidate.detailedPositions).toEqual({ DL: 0 })
    expect(game.cards[0].detailedPositions).toEqual({ DL: 0 })
    expect(detailedPositionValue(candidate, 'DL')).toBe(0)
    expect(game.activeMatch).toEqual(snapshot)
    expect(migrateGamePositions(game)).toBe(false)
    expect(baseBuild(player).detailedPositions).toEqual(player.baseDetailedPositions)
  })
})
