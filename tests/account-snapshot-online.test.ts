import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { createAppServer, type AppServer } from '../server/app.ts'
import { ACCOUNT_DB_FILE, AccountStore } from '../server/account-store.ts'
import { cupTeam, enterCup } from '../src/game/cup-run.ts'
import { ensurePve } from '../src/game/pve.ts'
import { startCupMatch } from '../src/game/actions.ts'
import { withoutDeferredCupPool } from '../src/game/state.ts'
import type { GameState } from '../src/game/types.ts'
import type { CupSeasonState } from '../src/game/cup.ts'

const dirs: string[] = []
const apps = new Set<AppServer>()
const now = () => Date.UTC(2026, 10, 18, 1)
function directory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-shared-parts-'))
  dirs.push(dir)
  return dir
}
async function start(dir: string, compactAccountWrites = true) {
  const app = createAppServer({ dataDir: dir, tickMs: 0, now, compactAccountWrites })
  apps.add(app)
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
  return { app, base: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}` }
}
async function stop(app: AppServer) {
  await app.shutdown()
  apps.delete(app)
}
afterEach(async () => {
  for (const app of apps) await stop(app)
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})
const auth = (token: string, lazy = false) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(lazy ? { 'X-FM-Lazy-Cup': '1' } : {}) })
type State = { game: GameState; revision: number }
async function register(base: string, username: string, lazy = false): Promise<State & { token: string }> {
  const res = await fetch(`${base}/api/register`, { method: 'POST', headers: auth('', lazy), body: JSON.stringify({ username, password: 'local-test-123' }) })
  expect(res.status).toBe(201)
  return res.json()
}
async function getGame(base: string, token: string, lazy = false): Promise<State> {
  const res = await fetch(`${base}/api/game`, { headers: auth(token, lazy) })
  expect(res.status).toBe(200)
  return res.json()
}
const save = (base: string, token: string, state: State) => fetch(`${base}/api/game`, {
  method: 'PUT', headers: auth(token, true), body: JSON.stringify({ game: withoutDeferredCupPool(state.game), baseRevision: state.revision }),
})
function inspect<T>(dir: string, check: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path.join(dir, ACCOUNT_DB_FILE), { readOnly: true })
  try { return check(db) } finally { db.close() }
}

async function initialSse(base: string, token: string): Promise<GameState> {
  const response = await fetch(`${base}/api/events?token=${token}&lazyCup=1`, { signal: AbortSignal.timeout(12_000) })
  expect(response.ok).toBe(true)
  let raw = ''
  const decoder = new TextDecoder()
  const reader = response.body!.getReader()
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) throw new Error('SSE ended before initial state')
      raw += decoder.decode(chunk.value, { stream: true })
      const match = raw.match(/^data: (\{.+\})\n\n/m)
      if (match) return JSON.parse(match[1]).game
    }
  } finally { await reader.cancel() }
}

describe('联机账号快照与对手按需加载', () => {
  it('逐个迁移旧行并复用共有快照；重启及展开回旧格式不改变个人进度', async () => {
    const dir = directory()
    const first = await start(dir, false)
    const a = await register(first.base, 'snapshot_a')
    const b = await register(first.base, 'snapshot_b')
    const oldSize = inspect(dir, db => Number(db.prepare('SELECT sum(length(game_json)) AS n FROM accounts').get()!.n))
    expect(inspect(dir, db => db.prepare('SELECT count(*) AS n FROM account_game_refs').get()!.n)).toBe(0)
    await stop(first.app)

    const migrated = await start(dir)
    const before: State[] = []
    for (const coach of [a, b]) {
      const state = await getGame(migrated.base, coach.token)
      state.game.lineup.tactics.tempo = 'slow'
      expect((await save(migrated.base, coach.token, state)).status).toBe(200)
      before.push(await getGame(migrated.base, coach.token))
    }
    await migrated.app.flush()
    inspect(dir, db => {
      const coreSize = Number(db.prepare('SELECT sum(length(game_json)) AS n FROM accounts').get()!.n)
      expect(coreSize).toBeLessThan(oldSize * 0.25)
      const overlap = Number(db.prepare('SELECT count(*) AS n FROM (SELECT hash FROM account_game_refs GROUP BY hash HAVING count(DISTINCT account_id) > 1)').get()!.n)
      expect(overlap).toBeGreaterThan(5)
    })
    await stop(migrated.app)
    const restored = await start(dir)
    for (const [i, coach] of [a, b].entries()) {
      const { game } = await getGame(restored.base, coach.token)
      expect(game.roster).toEqual(before[i].game.roster)
      expect(game.lineup).toEqual(before[i].game.lineup)
      expect(game.matchHistory).toEqual(before[i].game.matchHistory)
      expect(game.youth).toEqual(before[i].game.youth)
      expect(game.pve).toEqual(before[i].game.pve)
      expect(game.season).toEqual(before[i].game.season)
      expect(game.aiTeams.map(t => t.id)).toEqual(before[i].game.aiTeams.map(t => t.id))
    }
    await stop(restored.app)

    const fullWriter = new AccountStore(dir, 1000, false)
    try {
      for (const account of fullWriter.accounts) fullWriter.save(account)
      fullWriter.flushSync()
    } finally { fullWriter.close() }
    inspect(dir, db => {
      expect(db.prepare('SELECT count(*) AS n FROM account_game_refs').get()!.n).toBe(0)
      expect(db.prepare('SELECT count(*) AS n FROM account_game_parts').get()!.n).toBe(0)
      const row = db.prepare('SELECT game_json FROM accounts WHERE username = ?').get('snapshot_a')!
      const expanded = JSON.parse(row.game_json as string) as GameState
      expect(expanded.pve!.cupSeason).toEqual(before[0].game.pve!.cupSeason)
      expect(expanded.lineup).toEqual(before[0].game.lineup)
    })
  }, 60_000)

  it('登录和 SSE 省略冻结对手；点开后拿回同一组，开赛中刷新仍能续赛', async () => {
    const { app, base } = await start(directory())
    const { token, game, revision } = await register(base, 'snapshot_lazy', true)
    for (const [accepted, encoding] of [['br, gzip', 'br'], ['gzip', 'gzip'], ['br, gzip;q=0', 'br'], ['br;q=0, gzip;q=0', null]] as const) {
      const snapshot = await fetch(`${base}/api/game`, { headers: { ...auth(token, true), 'Accept-Encoding': accepted } })
      expect(snapshot.headers.get('content-encoding')).toBe(encoding)
      expect(snapshot.headers.get('cache-control')).toBe('no-store')
      expect(await snapshot.json()).toMatchObject({ user: { username: 'snapshot_lazy' }, revision, game: { clubName: game.clubName } })
    }
    expect(game.reserveStars).toBeUndefined()
    expect(game.pve!.cupSeasonDeferred).toBe(true)
    expect(game.pve!.cupSeason).toBeUndefined()
    expect(enterCup(game, 'community')).toMatchObject({ ok: false, error: '杯赛对手尚未加载，请重试' })
    let frozen: CupSeasonState
    const path = `/api/pve/cup-season?season=${game.season.index}`
    const fetchFrozen = async () => {
      const res = await fetch(base + path, { headers: auth(token, true) })
      expect(res.status).toBe(200)
      return (await res.json() as { cupSeason: CupSeasonState }).cupSeason
    }
    expect((await fetch(base + path)).status).toBe(401)
    frozen = await fetchFrozen()
    expect(frozen).toEqual((await getGame(base, token)).game.pve!.cupSeason)
    expect((await initialSse(base, token)).pve).toMatchObject({ cupSeasonDeferred: true })
    expect((await fetch(`${base}/api/pve/cup-season?season=${game.season.index + 1}`, { headers: auth(token) })).status).toBe(409)
    game.pve!.cupSeason = frozen
    expect(enterCup(game, 'community').ok).toBe(true)
    const run = game.pve!.cups.community
    const worldId = Object.keys(run.participants).find(id => run.participants[id].kind === 'world')!
    expect(cupTeam(game, run, worldId)).toEqual(frozen.worldTeams[worldId])
    expect((await save(base, token, { game, revision })).status).toBe(200)
    const deferred = await getGame(base, token, true)
    ensurePve(deferred.game)
    expect(deferred.game.pve!.cups.community.status).toBe('active')
    expect(deferred.game.pve!.cupSeason).toBeUndefined()
    deferred.game.pve!.cupSeason = await fetchFrozen()
    expect(startCupMatch(deferred.game, 'community').ok).toBe(true)
    expect((await save(base, token, deferred)).status).toBe(200)
    const active = await getGame(base, token, true)
    expect(active.game.activeMatch?.context.mode).toBe('cup')
    expect(active.game.pve!.cupSeason).toEqual(frozen)
    expect((await getGame(base, token)).game.reserveStars?.length).toBeGreaterThan(0)

    const overview = await (await fetch(`${base}/api/world/teams`, { headers: { ...auth(token), 'X-FM-World-Summary': '1' } })).json()
    expect(overview.divisions.length).toBeGreaterThan(1)
    expect(overview.clubs.every((club: { players: unknown[]; rosterDeferred?: boolean }) => club.rosterDeferred && club.players.length === 0)).toBe(true)
    const detail = await (await fetch(`${base}/api/world/club?id=player`, { headers: auth(token) })).json()
    expect(detail.club.players.map((p: { id: string }) => p.id)).toEqual(game.roster.map(p => p.id))
    expect(detail.club.players[0]).not.toHaveProperty('condition')
    await app.flush()
  }, 60_000)
})
