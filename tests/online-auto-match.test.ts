import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { createWorldGame } from '../src/game/world.ts'
import { nextMatchCountdown, playerFixture, roundKickoffAt, settleDuePlayerMatch } from '../src/game/season.ts'
import { kickoffAtForRound } from '../src/game/calendar.ts'
import type { GameState } from '../src/game/types.ts'

const servers: AppServer[] = []
afterEach(() => { while (servers.length) servers.pop()!.close() })

describe('联机联赛到点自动结算', () => {
  it('开赛前不结算，到点自动踢并写进战报；重复调用不会多踢一场', () => {
    const game = createWorldGame(11, undefined, undefined, 1_000_000)
    const kickoff = roundKickoffAt(game, game.season.round)
    expect(settleDuePlayerMatch(game, kickoff - 1)).toBeNull()
    expect(playerFixture(game)!.played).toBe(false)
    const record = settleDuePlayerMatch(game, kickoff)
    expect(record).not.toBeNull()
    expect(record!.autoSimulated).toBe(true)
    expect(playerFixture(game)!.played).toBe(true)
    expect(playerFixture(game)!.autoSimulated).toBe(true)
    expect(game.matchHistory[0]).toBe(record)
    expect(settleDuePlayerMatch(game, kickoff + 1000)).toBeNull()
    expect(game.matchHistory).toHaveLength(1)
  })

  it('服务器在登录时自动踢掉到点的比赛，玩家不用手动开始；之后不能再手动开赛', async () => {
    // 北京时间 16:15 注册：错过的 12:00 场由 AI 补算，下一场固定 20:00。
    let clock = Date.UTC(2026, 10, 9, 8, 15)
    const app = createAppServer({
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'fm-auto-match-')),
      staticDir: path.resolve('dist'),
      tickMs: 0,
      now: () => clock,
    })
    servers.push(app)
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
    const registered = await (await fetch(`${base}/api/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'auto_match', password: 'secret123' }),
    })).json() as { token: string; game: GameState; revision: number }
    const auth = { Authorization: `Bearer ${registered.token}`, 'Content-Type': 'application/json' }
    const first = await (await fetch(`${base}/api/game`, { headers: auth })).json() as { game: GameState }
    // 注册时第 1 轮已经开球：错过的时间由 AI 直接决定比分，固定赛程不受影响
    const firstFixture = first.game.season.fixtures.find((fixture) => fixture.isPlayer && fixture.round === first.game.season.round)
    expect(firstFixture?.played).toBe(true)
    expect(firstFixture?.autoSimulated).toBe(true)
    expect(first.game.matchHistory.length).toBeGreaterThanOrEqual(1)
    expect(first.game.activeMatch).toBeUndefined()
    expect(nextMatchCountdown(first.game, clock)).toBe('3 小时 45 分')
    expect(first.game.settings).not.toHaveProperty('autoSettle')
    // 注册 30 分钟后没有额外比赛，也不会改变赛程或比分。
    clock += 30 * 60_000
    const later = await (await fetch(`${base}/api/game`, { headers: auth })).json() as { game: GameState }
    expect(later.game.matchHistory).toEqual(first.game.matchHistory)
    expect(playerFixture(later.game)!.score).toEqual(firstFixture!.score)
    expect(nextMatchCountdown(later.game, clock)).toBe('3 小时 15 分')
    expect(roundKickoffAt(later.game, 2)).toBe(Date.UTC(2026, 10, 9, 12))

    // 下一轮开球时间（当天 20:00）到了：登录时自动结算第 2 轮
    expect(registered.game.world!.seasonStartedAt).toBe(Date.UTC(2026, 10, 9, 4))
    clock = kickoffAtForRound(registered.game.world!.seasonStartedAt, 2)
    const second = await (await fetch(`${base}/api/game`, { headers: auth })).json() as { game: GameState }
    expect(second.game.season.round).toBe(2)
    for (const round of [1, 2]) {
      const fixture = second.game.season.fixtures.find((item) => item.isPlayer && item.round === round)
      expect(fixture?.played, `round ${round}`).toBe(true)
    }
    expect(second.game.matchHistory.length).toBeGreaterThanOrEqual(2)
    expect(second.game.activeMatch).toBeUndefined()
    // 记录不会重复
    const before = second.game.matchHistory.length
    const third = await (await fetch(`${base}/api/game`, { headers: auth })).json() as { game: GameState }
    expect(third.game.matchHistory).toHaveLength(before)

    // 已经自动踢完，手动开赛会被拒绝
    const start = await fetch(`${base}/api/match/action`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'start_league' }) })
    expect(start.status).toBe(400)
  })
})
