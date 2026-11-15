import { afterEach, expect, it, vi } from 'vitest'
import { createInitialGame, saveGame } from '../src/game/state.ts'
import { economyOf } from '../src/game/economy.ts'
import { startScouting, visibleScoutReports } from '../src/game/scouting.ts'
import type { GameState } from '../src/game/types.ts'

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

it('merges only matching completed reports into the current game, preserving concurrent changes and session isolation', async () => {
  const game = createInitialGame(123); economyOf(game).balance = 100000
  const report = startScouting(game, game.aiTeams[0].players[0], { source: 'club', clubId: 'team' }, 5, 100).report!
  const pending = visibleScoutReports(game, 100)[0] as typeof report
  game.scoutReports = [pending]
  let release!: (response: Response) => void
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/login') return json({ token: 'same-token', user: { id: 'a', username: 'a' }, revision: 1, game })
    if (url === '/api/scouting/reports') return new Promise<Response>(resolve => { release = resolve })
    if (url === '/api/game') return json({ ok: true, revision: 2, updatedAt: 1 })
    return json({})
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  const online = await import('../src/online.ts')
  await online.loginOnline('a', 'password')
  let current: GameState = game
  const first = online.refreshGameOnline(() => current)
  await vi.waitFor(() => expect(release).toBeDefined())
  current = structuredClone(game); current.clubName = 'local update'; current.economy!.balance = 42
  saveGame(current)
  release(json({ reports: [report], serverTime: report.readyAt }))
  expect(await first).toBe(true)
  expect(current.clubName).toBe('local update'); expect(current.economy!.balance).toBe(42)
  expect(current.scoutReports![0].estimatedAttrs).toEqual(report.estimatedAttrs)
  expect(online.onlineState.revision).toBe(1)

  current.scoutReports = [pending]
  const deleted = online.refreshGameOnline(() => current)
  await vi.waitFor(() => expect(fetchMock.mock.calls.filter(c => c[0] === '/api/scouting/reports')).toHaveLength(2))
  current.scoutReports = []
  release(json({ reports: [report], serverTime: report.readyAt }))
  await deleted; expect(current.scoutReports).toEqual([])

  current.scoutReports = [pending]
  const old = online.refreshGameOnline(() => current)
  await vi.waitFor(() => expect(fetchMock.mock.calls.filter(c => c[0] === '/api/scouting/reports')).toHaveLength(3))
  await online.loginOnline('a', 'password')
  const offset = online.marketState.serverOffset
  release(json({ reports: [report], serverTime: report.readyAt }))
  expect(await old).toBe(false); expect(current.scoutReports![0]).not.toHaveProperty('estimatedAttrs')
  expect(online.marketState.serverOffset).toBe(offset)

  const early = online.refreshGameOnline(() => current)
  await vi.waitFor(() => expect(fetchMock.mock.calls.filter(c => c[0] === '/api/scouting/reports')).toHaveLength(4))
  release(json({ reports: [report], serverTime: report.readyAt - 1 }))
  await early; expect(current.scoutReports![0]).not.toHaveProperty('estimatedAttrs')

  const mismatch = online.refreshGameOnline(() => current)
  await vi.waitFor(() => expect(fetchMock.mock.calls.filter(c => c[0] === '/api/scouting/reports')).toHaveLength(5))
  release(json({ reports: [{ ...report, playerId: 'other' }], serverTime: report.readyAt }))
  await mismatch; expect(current.scoutReports![0]).not.toHaveProperty('estimatedAttrs')

  const failed = online.refreshGameOnline(() => current)
  await vi.waitFor(() => expect(fetchMock.mock.calls.filter(c => c[0] === '/api/scouting/reports')).toHaveLength(6))
  release(json({ error: '断线' }, 503))
  await expect(failed).rejects.toThrow('断线')
  expect(current.clubName).toBe('local update'); expect(current.scoutReports![0]).not.toHaveProperty('estimatedAttrs')

  const loggedOut = online.refreshGameOnline(() => current)
  await vi.waitFor(() => expect(fetchMock.mock.calls.filter(c => c[0] === '/api/scouting/reports')).toHaveLength(7))
  await online.logoutOnline()
  const loggedOutOffset = online.marketState.serverOffset
  release(json({ reports: [report], serverTime: report.readyAt }))
  expect(await loggedOut).toBe(false)
  expect(online.marketState.serverOffset).toBe(loggedOutOffset)
  expect(current.scoutReports![0]).not.toHaveProperty('estimatedAttrs')
})
