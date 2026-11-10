import { beforeAll, describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { ensurePve } from '../src/game/pve.ts'
import { buildCupField, cupRandomTeams } from '../src/game/cup.ts'
import { cupTeam, enterCup } from '../src/game/cup-run.ts'
import { loadPveContent } from '../src/game/pve-content.ts'
import { CUP_DEFS } from '../src/game/data/cup-config.ts'
import { CUP_TEAM_POOLS } from '../src/game/data/cup-teams.generated.ts'
import { createWorldGame } from '../src/game/world.ts'
import { startNextSeason } from '../src/game/season.ts'
import { startingCa } from '../src/game/pve-strength.ts'
import { validateLineup } from '../src/game/squad.ts'

beforeAll(loadPveContent)
const persisted = <T>(value: T): T => JSON.parse(JSON.stringify(value))

describe('seasonal cup opponents', () => {
  it('rebuilds every random team each season, deterministically across saves', () => {
    for (const def of CUP_DEFS) {
      const first = cupRandomTeams(def.id, 1)
      const next = cupRandomTeams(def.id, 2)
      expect(cupRandomTeams(def.id, 2)).toEqual(next)
      const oldIds = new Set(first.map(entry => entry.id))
      expect(next.every(entry => !oldIds.has(entry.id))).toBe(true)
      const targets = CUP_TEAM_POOLS[def.randomPool].map(entry => entry.targetCa!)
      for (const entry of next) {
        expect(entry.team.players).toHaveLength(16)
        expect(validateLineup(entry.team.players, entry.team.lineup).valid).toBe(true)
        expect(startingCa(entry.team)).toBeGreaterThanOrEqual(Math.min(...targets) - 1)
        expect(startingCa(entry.team)).toBeLessThanOrEqual(Math.max(...targets) + 1)
      }
      expect(next.map(entry => entry.team.players.map(player => player.name))).not.toEqual(first.map(entry => entry.team.players.map(player => player.name)))
    }
  })

  it('captures all fields when the season starts and holds them through reload and enrollment', () => {
    const game = createInitialGame(909)
    const before = persisted(buildCupField('community', game))
    const selected = before.find(entry => entry.kind === 'world')!
    const source = game.aiTeams.find(team => team.id === selected.id)!
    source.name = 'Changed after opening'
    source.players[0].attrs.passing = 1
    expect(game.pve!.cupSeason?.seasonIndex).toBe(1)
    expect(persisted(buildCupField('community', game))).toEqual(before)
    const restored = JSON.parse(JSON.stringify(game))
    expect(ensurePve(restored)).toBe(false)
    expect(persisted(buildCupField('community', restored))).toEqual(before)
    expect(enterCup(restored, 'community').ok).toBe(true)
    expect(persisted(cupTeam(restored, restored.pve.cups.community, selected.id))).toEqual(selected.team)
    expect(Object.values(restored.pve.cups.community.participants).every(entry => !(entry as { snapshot?: unknown }).snapshot)).toBe(true)
  })

  it('refreshes at rollover using the new world squads and preserves the previous run', () => {
    const game = createInitialGame(910)
    expect(enterCup(game, 'community').ok).toBe(true)
    const old = structuredClone(game.pve!.cups.community)
    const oldRandom = buildCupField('community', game).filter(entry => entry.kind === 'random').map(entry => entry.id)
    for (const team of game.aiTeams) {
      team.name = `New season ${team.id}`
      team.players[0].attrs.passing = 123
    }
    game.season.index = 2
    expect(ensurePve(game)).toBe(true)
    expect(game.pve!.cupSeason?.seasonIndex).toBe(2)
    const next = buildCupField('community', game)
    expect(next.filter(entry => entry.kind === 'world').every(entry => entry.name.startsWith('New season') && entry.team.players[0].attrs.passing === 123)).toBe(true)
    expect(next.filter(entry => entry.kind === 'random').every(entry => !oldRandom.includes(entry.id))).toBe(true)
    const archived = game.pve!.cupHistory!.find(run => run.cupId === 'community')!
    expect(archived.groups).toEqual(old.groups)
    expect(archived.status).toBe('void')
    expect(game.pve!.cups.community.participants).toEqual(old.participants)
    expect(ensurePve(game)).toBe(false)
  })

  it('initializes a world game before visiting the cup page and rolls a legacy league at season start', () => {
    const worldGame = createWorldGame(911)
    expect(worldGame.pve!.cupSeason?.seasonIndex).toBe(worldGame.season.index)
    const game = createInitialGame(912)
    const old = game.pve!.cupSeason
    for (const fixture of game.season.fixtures) {
      fixture.played = true
      fixture.score = { home: 0, away: 0 }
    }
    game.season.finished = true
    game.season.round = 38
    expect(startNextSeason(game).ok).toBe(true)
    expect(game.pve!.cupSeason?.seasonIndex).toBe(2)
    expect(game.pve!.cupSeason).not.toBe(old)
  })

  it('migrates a save once without replacing an ongoing cup or growing historical pools', () => {
    const game = createInitialGame(913)
    expect(enterCup(game, 'community').ok).toBe(true)
    const current = game.pve!.cups.community
    for (const [id, entry] of Object.entries(current.participants)) {
      if (entry.kind !== 'player') entry.snapshot = cupTeam(game, current, id)
    }
    delete current.seasonPool
    const run = structuredClone(game.pve!.cups.community)
    delete game.pve!.cupSeason
    expect(ensurePve(game)).toBe(true)
    expect(game.pve!.cups.community).toEqual(run)
    expect(ensurePve(game)).toBe(false)
    const firstSize = JSON.stringify(game.pve!.cupSeason).length
    for (let index = 2; index <= 5; index++) {
      game.season.index = index
      ensurePve(game)
    }
    expect(JSON.stringify(game.pve!.cupSeason).length).toBeLessThan(firstSize * 1.2)
    expect(game.pve!.cupHistory?.every(entry => Object.values(entry.participants).every(team => !team.snapshot))).toBe(true)
  })

  it('fills missing world places with unique newly generated opponents', () => {
    const game = createInitialGame(914)
    game.aiTeams = []
    delete game.pve!.cupSeason
    expect(ensurePve(game)).toBe(true)
    for (const def of CUP_DEFS) {
      const field = buildCupField(def.id, game)
      expect(field).toHaveLength(def.size)
      expect(new Set(field.map(entry => entry.id)).size).toBe(def.size)
      expect(field.filter(entry => entry.kind === 'random')).toHaveLength(def.size - 1)
    }
  })
})
