import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { applyAgentAction } from '../server/agent.ts'
import { createWorldGame } from '../src/game/world.ts'
import { LINEUP_LOCK_MS, lineupLockState, nextMatchCountdown, playerFixture, settleDuePlayerMatch } from '../src/game/season.ts'
import { kickoffAtForRound, seasonStartForRound } from '../src/game/calendar.ts'
import type { GameState } from '../src/game/types.ts'

const servers: AppServer[] = []
afterEach(() => { while (servers.length) servers.pop()!.close() })

const minute = 60_000

function worldGame(startedAt: number): GameState {
  return createWorldGame(11, undefined, undefined, startedAt)
}

describe('开赛前 30 分钟锁阵容', () => {
  it('本轮已结算时锁的是下一轮：开赛前 30 分钟内锁定，之前和结算后都解锁', () => {
    // 北京时间 12:00：第 2 轮正好在这一刻开球
    const now = Date.UTC(2026, 10, 9, 4)
    const game = worldGame(seasonStartForRound(now, 2))
    playerFixture(game, 1)!.played = true
    expect(lineupLockState(game, now - LINEUP_LOCK_MS - 1000).locked).toBe(false)
    expect(lineupLockState(game, now - 1000).locked).toBe(true)
    // 下一轮已经开踢/结算后解锁
    playerFixture(game, 2)!.played = true
    expect(lineupLockState(game, now).locked).toBe(false)
  })

  it('未开赛的首轮倒计时和锁阵时间始终遵循固定开球点，没有新账号例外', () => {
    const kickoff = Date.UTC(2026, 10, 9, 12)
    const game = worldGame(kickoff)
    game.season.startedAt = kickoff
    expect(nextMatchCountdown(game, kickoff - 45 * minute)).toBe('45 分')
    const before = lineupLockState(game, kickoff - LINEUP_LOCK_MS - 1)
    expect(before).toEqual({ locked: false, lockAt: kickoff - LINEUP_LOCK_MS, kickoffAt: kickoff })
    expect(lineupLockState(game, kickoff - LINEUP_LOCK_MS).locked).toBe(true)
    expect(settleDuePlayerMatch(game, kickoff - 1)).toBeNull()
    expect(playerFixture(game)!.played).toBe(false)
    expect(settleDuePlayerMatch(game, kickoff)).not.toBeNull()
    expect(lineupLockState(game, kickoff).locked).toBe(false)
  })

  it('服务端拒绝锁定期间的阵容修改，解锁后恢复；Agent 也一样', async () => {
    let clock = 1_000_000_000
    const app = createAppServer({
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'fm-lineup-lock-')),
      staticDir: path.resolve('dist'),
      tickMs: 0,
      now: () => clock,
    })
    servers.push(app)
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
    const registered = await (await fetch(`${base}/api/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'lock_probe', password: 'secret123' }),
    })).json() as { token: string }
    const auth = { Authorization: `Bearer ${registered.token}`, 'Content-Type': 'application/json' }
    const worldStart = ((await (await fetch(`${base}/api/health`)).json()) as { worldSeasonStartedAt: number }).worldSeasonStartedAt
    // 每天北京时间 12:00、20:00 各一轮。
    const kickoff = (round: number) => kickoffAtForRound(worldStart, round)

    // 到第 2 轮开球时间：第 1、2 轮自动结算，当前第 2 轮已踢，锁的是第 3 轮。
    clock = kickoff(2) + 1000
    const loaded = await (await fetch(`${base}/api/game`, { headers: auth })).json() as { game: GameState; revision: number }
    expect(loaded.game.season.round).toBe(2)
    expect(playerFixture(loaded.game, 2)!.played).toBe(true)

    // 第 3 轮开赛前 10 分钟：阵容锁定
    clock = kickoff(3) - 10 * minute
    const lockedGame = await (await fetch(`${base}/api/game`, { headers: auth })).json() as { game: GameState; revision: number }
    expect(lineupLockState(lockedGame.game, clock).locked).toBe(true)
    const changed = structuredClone(lockedGame.game)
    changed.lineup.starters[0].playerId = changed.lineup.bench[0]
    const rejected = await fetch(`${base}/api/game`, { method: 'PUT', headers: auth, body: JSON.stringify({ game: changed, baseRevision: lockedGame.revision }) })
    expect(rejected.status).toBe(409)
    expect((await rejected.json() as { error?: string }).error).toContain('锁定')
    // 其它改动照常保存
    const fresh = await (await fetch(`${base}/api/game`, { headers: auth })).json() as { game: GameState; revision: number }
    const sameLineup = structuredClone(fresh.game)
    sameLineup.ui = { screen: 'club' }
    const accepted = await fetch(`${base}/api/game`, { method: 'PUT', headers: auth, body: JSON.stringify({ game: sameLineup, baseRevision: fresh.revision }) })
    const acceptedBody = await accepted.clone().text()
    if (accepted.status !== 200) console.error('accepted', accepted.status, acceptedBody)
    expect(accepted.status).toBe(200)
    // Agent 改阵容同样被拒
    const agent = applyAgentAction(lockedGame.game, { action: 'set_lineup', lineup: changed.lineup }, clock)
    expect(agent.ok).toBe(false)
    expect(agent.error).toContain('锁定')

    // 第 3 轮开球并自动结算后解锁
    clock = kickoff(3) + 1000
    const after = await (await fetch(`${base}/api/game`, { headers: auth })).json() as { game: GameState; revision: number }
    expect(playerFixture(after.game, 3)!.played).toBe(true)
    expect(lineupLockState(after.game, clock).locked).toBe(false)
    const latest = await (await fetch(`${base}/api/game`, { headers: auth })).json() as { game: GameState; revision: number }
    const editable = structuredClone(latest.game)
    editable.lineup.starters[0].playerId = editable.lineup.bench[0]
    const saved = await fetch(`${base}/api/game`, { method: 'PUT', headers: auth, body: JSON.stringify({ game: editable, baseRevision: latest.revision }) })
    expect(saved.status).toBe(200)
  })
})
