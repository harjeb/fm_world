import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { economyOf } from '../src/game/economy.ts'
import { GAME_DAY_MS } from '../src/game/calendar.ts'
import { skipToMatchday } from '../src/game/season.ts'
import { ALL_ATTRIBUTES, GK_ATTRIBUTES } from '../src/game/types.ts'
import { isMainAttr } from '../src/game/scale.ts'
import { MAX_SCOUT_REPORTS, SCOUT_LEVELS, startScouting, visibleScoutReports } from '../src/game/scouting.ts'

function setup() {
  const game = createInitialGame(123)
  const player = game.aiTeams[0].players.find(p => p.positions.GK === 0)!
  economyOf(game).balance = 100_000
  return { game, player }
}
const target = { source: 'club' as const, clubId: ' opponent ' }

describe('scouting', () => {
  it('charges each tier and bounds all estimates, with exact main attributes', () => {
    for (const config of SCOUT_LEVELS) {
      const { game, player } = setup()
      player.attrs.vision = 0
      player.attrs.decisions = 20
      const result = startScouting(game, player, target, config.level, 100)
      expect(result.ok).toBe(true)
      const report = result.report!
      expect(report.readyAt).toBe(100 + config.days * GAME_DAY_MS)
      expect(game.economy!.balance).toBe(100_000 - config.fee)
      expect(report.clubId).toBe('opponent')
      for (const key of ALL_ATTRIBUTES) {
        if ((GK_ATTRIBUTES as readonly string[]).includes(key)) expect(report.estimatedAttrs[key]).toBe(0)
        else if (isMainAttr(key, false)) expect(report.estimatedAttrs[key]).toBe(player.attrs[key])
        else {
          expect(Number.isInteger(report.estimatedAttrs[key])).toBe(true)
          expect(report.estimatedAttrs[key]).toBeGreaterThanOrEqual(0)
          expect(report.estimatedAttrs[key]).toBeLessThanOrEqual(20)
          expect(Math.abs(report.estimatedAttrs[key] - player.attrs[key])).toBeLessThanOrEqual(config.maxError)
        }
      }
      expect(report.estimatedAttrs).not.toBe(player.attrs)
    }
  })
  it('uses the saved game-day length and advances pending reports when an offline game skips time', () => {
    const { game, player } = setup()
    const now = Date.now()
    game.season.gameDayMs = 60_000
    const report = startScouting(game, player, target, 1, now).report!
    expect(report.readyAt).toBe(now + 4 * game.season.gameDayMs)
    game.season.round = 2
    const oldReady = report.readyAt
    const skipped = skipToMatchday(game, now)
    expect(skipped.ok).toBe(true)
    expect(skipped.gameDays).toBeGreaterThan(0)
    expect(report.readyAt).toBeCloseTo(oldReady - skipped.gameDays * game.season.gameDayMs)
    expect(visibleScoutReports(game, now)[0]).toHaveProperty('estimatedAttrs')
  })
  it('advances market grace periods on fast-forward but leaves expired and completed club reports untouched', () => {
    const { game, player } = setup()
    const now = Date.now()
    game.season.gameDayMs = 60_000
    const base = startScouting(game, player, { source: 'market' }, 1, now).report!
    const within = { ...base, readyAt: now - 1, startedAt: now - 100_000 }
    const boundary = { ...base, readyAt: now - game.season.gameDayMs, startedAt: now - 400_000 }
    const club = { ...within, source: 'club' as const }
    game.scoutReports = [base, within, boundary, club]
    const before = game.scoutReports.map(r => ({ startedAt: r.startedAt, readyAt: r.readyAt }))
    game.season.round = 2
    const skipped = skipToMatchday(game, now)
    expect(skipped.gameDays).toBeGreaterThan(0)
    const delta = skipped.gameDays * game.season.gameDayMs
    for (const i of [0, 1]) {
      expect(game.scoutReports[i].startedAt).toBeCloseTo(before[i].startedAt - delta)
      expect(game.scoutReports[i].readyAt).toBeCloseTo(before[i].readyAt - delta)
    }
    expect(boundary).toMatchObject(before[2])
    expect(club).toMatchObject(before[3])
  })
  it('handles goalkeepers and records an isolated equipped snapshot', () => {
    const { game } = setup()
    const player = game.aiTeams[0].players.find(p => p.positions.GK > 0)!
    const equipped = { ...player, version: 7, attrs: { ...player.attrs }, positions: { ...player.positions } }
    const report = startScouting(game, equipped, target, 2, 100).report!
    expect(report.isGk).toBe(true)
    expect(report.snapshotLabel).toContain('7')
    for (const key of ALL_ATTRIBUTES) {
      if (isMainAttr(key, true)) expect(report.estimatedAttrs[key]).toBe(equipped.attrs[key])
      else expect(Math.abs(report.estimatedAttrs[key] - equipped.attrs[key])).toBeLessThanOrEqual(4)
    }
    equipped.positions.GK = 0
    expect(report.positions.GK).toBeGreaterThan(0)
  })
  it('cannot reroll the same snapshot after completion, but seeds include version and attributes', () => {
    const { game, player } = setup()
    const first = startScouting(game, player, target, 1, 100).report!
    expect(startScouting(game, player, { source: 'club', clubId: 'opponent' }, 5, first.readyAt - 1).ok).toBe(false)
    const second = startScouting(game, player, target, 1, first.readyAt).report!
    expect(second.estimatedAttrs).toEqual(first.estimatedAttrs)
    const changed = { ...player, version: 3, attrs: { ...player.attrs, passing: player.attrs.passing + 1 } }
    const third = startScouting(game, changed, target, 1, second.readyAt).report!
    expect(third.estimatedAttrs).not.toEqual(first.estimatedAttrs)
  })
  it('redacts pending reports and returns detached completed reports', () => {
    const { game, player } = setup()
    const report = startScouting(game, player, target, 1, 100).report!
    const pending = visibleScoutReports(game, report.readyAt - 1)[0]
    for (const key of ['estimatedAttrs', 'positions', 'detailedPositions', 'isGk']) expect(pending).not.toHaveProperty(key)
    expect(report.estimatedAttrs).toBeDefined()
    const done = visibleScoutReports(game, report.readyAt)[0]
    expect(done).toHaveProperty('estimatedAttrs')
    if ('estimatedAttrs' in done) done.estimatedAttrs.passing = -1
    expect(report.estimatedAttrs.passing).not.toBe(-1)
    expect(visibleScoutReports(game, NaN)[0]).not.toHaveProperty('estimatedAttrs')
  })
  it('rejects invalid input and full capacity without mutating the game', () => {
    const { game, player } = setup()
    const checks = [
      () => startScouting(game, player, target, '1', 100),
      () => startScouting(game, player, target, 1, NaN),
      () => startScouting(game, player, target, 1, Number.MAX_SAFE_INTEGER),
      () => startScouting(game, game.roster[0], target, 1, 100),
      () => startScouting(game, player, { source: 'club' }, 1, 100),
      () => startScouting(game, { ...player, attrs: { ...player.attrs, vision: NaN } }, target, 1, 100),
    ]
    for (const check of checks) {
      const before = JSON.stringify(game)
      expect(check().ok).toBe(false)
      expect(JSON.stringify(game)).toBe(before)
    }
    game.economy!.balance = 0
    expect(startScouting(game, player, target, 1, 100).ok).toBe(false)
    expect(game.scoutReports).toBeUndefined()
    game.economy!.balance = 100_000
    game.scoutReports = Array(MAX_SCOUT_REPORTS).fill({})
    expect(startScouting(game, player, target, 1, 100).ok).toBe(false)
    expect(game.economy!.balance).toBe(100_000)
  })
  it('supports missing economy and reports in old saves', () => {
    const { game, player } = setup()
    delete game.economy
    expect(visibleScoutReports(game, 0)).toEqual([])
    expect(startScouting(game, player, target, 1, 0).ok).toBe(true)
    expect(game.scoutReports).toHaveLength(1)
  })
})
