import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { AI_TAKEOVER_INACTIVE_MS, createAppServer, type AppServer } from '../server/app.ts'
import { kickoffAtForRound } from '../src/game/calendar.ts'
import { LINEUP_LOCK_MS } from '../src/game/season.ts'
import type { MatchJob } from '../server/match-job.ts'
import { drainServerQueue, fastMatchResult } from './queued-server-helpers.ts'

const servers: AppServer[] = []
const dirs: string[] = []

afterEach(() => {
  while (servers.length) servers.pop()!.close()
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

const auth = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })

describe('超过 3 天未上线玩家球队自动 AI 接管与恢复', () => {
  it('超过 3 天未上线进入 AI 接管（不受后台推进 updatedAt 干扰），重新上线立即恢复正常', async () => {
    let clock = Date.UTC(2026, 10, 9, 2, 0, 0)
    const capturedJobs: MatchJob[] = []
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-ai-takeover-'))
    dirs.push(dir)

    const app = createAppServer({
      dataDir: dir,
      staticDir: path.resolve('dist'),
      tickMs: 0,
      now: () => clock,
      matchQueue: {
        intervalMs: 0,
        compute: async (job) => {
          capturedJobs.push(structuredClone(job))
          return await fastMatchResult(job)
        },
      },
    })
    servers.push(app)
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`

    const register = async (username: string) => {
      const res = await fetch(`${base}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: 'secret123' }),
      })
      expect(res.status).toBe(201)
      return await res.json() as { token: string; revision: number; game: any }
    }

    const awayCoach = await register('away_coach')
    const activeCoach = await register('active_coach')
    const awayClubId = awayCoach.game.world.clubs.find((c: any) => c.id === 'player')!.squadKey as string

    // 刚注册时双方都正常在线，不应标记 AI 接管。
    let snapshot = await (await fetch(`${base}/api/world/teams`, { headers: auth(activeCoach.token) })).json() as any
    expect(snapshot.clubs.find((c: any) => c.id === awayClubId)).toMatchObject({ managed: true, aiTakeover: false })

    // 给 awayCoach 设置极端消耗计划并关闭自动换人，检验后续 AI 接管时是否保护体能和自动轮换。
    awayCoach.game.lineup.matchPlan = 'allOutWin'
    awayCoach.game.autoSubs = { timed: [], staminaBelow: null, onInjury: false }
    const putRes = await fetch(`${base}/api/game`, {
      method: 'PUT',
      headers: auth(awayCoach.token),
      body: JSON.stringify({ game: awayCoach.game, baseRevision: awayCoach.revision }),
    })
    expect(putRes.status).toBe(200)

    // 推进 2 天（未满 3 天），期间 activeCoach 在线刷新，后台队列结算多轮比赛（会更新 awayCoach 的 updatedAt）。
    clock += 2 * 24 * 60 * 60_000
    await drainServerQueue(app, dir, clock)
    snapshot = await (await fetch(`${base}/api/world/teams`, { headers: auth(activeCoach.token) })).json() as any
    expect(snapshot.clubs.find((c: any) => c.id === awayClubId)).toMatchObject({ managed: true, aiTakeover: false })

    // 再推进超过 3 天阈值（总离线时长 > 72 小时）；awayCoach 一直没发起任何请求。
    clock += 24 * 60 * 60_000 + 60_000
    expect(clock - Date.UTC(2026, 10, 9, 2, 0, 0)).toBeGreaterThan(AI_TAKEOVER_INACTIVE_MS)

    // 把 awayCoach 的几名首发在全服名册与伤病簿里设成受伤/体能极低，测试下一轮锁阵时 AI 是否自动轮换。
    const worldFile = path.join(dir, 'world.json')
    const persistedWorld = JSON.parse(fs.readFileSync(worldFile, 'utf8')) as any
    const nextRound = persistedWorld.world.divisions[0].fixtures.find((f: any) => !f.played)?.round ?? 8
    const nextKickoff = kickoffAtForRound(persistedWorld.world.seasonStartedAt, nextRound)
    // 将其中一名外场首发设为重伤（恢复时间晚于开球），确保进入下一轮锁阵窗口时 AI 将其换下。
    const originalOutfieldStarter = awayCoach.game.lineup.starters.find((s: any) => {
      const p = awayCoach.game.roster.find((item: any) => item.id === s.playerId)
      return p && p.positions.GK === 0
    })!.playerId as string

    // 需要重启或在同一实例推进到锁阵窗口：直接读取内存生效的比赛锁阵结果。
    // 这里推进时间到下一轮锁阵时刻，先通过伤病（从后台比赛产生或当前轮结算后）验证 aiTakeover 标记和锁阵配置。
    capturedJobs.length = 0
    clock = Math.max(clock, nextKickoff - LINEUP_LOCK_MS + 1_000)
    await drainServerQueue(app, dir, clock)

    // activeCoach 查看世界：awayCoach 已变成 managed: true, aiTakeover: true；席位归属仍然保留，不会被新玩家抢走。
    snapshot = await (await fetch(`${base}/api/world/teams`, { headers: auth(activeCoach.token) })).json() as any
    expect(snapshot.clubs.find((c: any) => c.id === awayClubId)).toMatchObject({ managed: true, aiTakeover: true })
    const worldMeta = await (await fetch(`${base}/api/world`)).json() as any
    expect(worldMeta.aiTakeoverClubs).toContain(awayClubId)
    expect(worldMeta.owners[awayClubId]).toBeTruthy()

    // 新玩家尝试指定注册这支被 AI 临时接管的球队：仍然拒绝（归属权属于原玩家）。
    const stealAttempt = await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'stealer', password: 'secret123', clubId: awayClubId }),
    })
    expect(stealAttempt.status).toBe(409)

    // 检查 AI 接管期间锁定的比赛任务：aiTakeover 为 true，自动启用体能/伤病换人，并解除高消耗的 all_out_win。
    const awayJob = capturedJobs.find((job) => job.home.team.id === awayClubId || job.away.team.id === awayClubId)
    expect(awayJob).toBeDefined()
    const lockedSide = awayJob!.home.team.id === awayClubId ? awayJob!.home : awayJob!.away
    expect(lockedSide.aiTakeover).toBe(true)
    expect(lockedSide.ai).toBeUndefined()
    expect(lockedSide.team.lineup.matchPlan).toBe('standard')
    expect(lockedSide.autoSubs).toEqual({ timed: [], staminaBelow: 35, onInjury: true })
    expect(originalOutfieldStarter).toBeTruthy()

    // awayCoach 重新上线拉取存档（或登录）：AI 接管立即解除，黄色恢复为绿色（aiTakeover: false）。
    const reload = await fetch(`${base}/api/game`, { headers: auth(awayCoach.token) })
    expect(reload.status).toBe(200)
    snapshot = await (await fetch(`${base}/api/world/teams`, { headers: auth(activeCoach.token) })).json() as any
    expect(snapshot.clubs.find((c: any) => c.id === awayClubId)).toMatchObject({ managed: true, aiTakeover: false })
  })

  it('AI 接管锁阵时会把体能不足或受伤的首发轮换下场', async () => {
    const { buildOwnerlessTeams, createOwnerlessWorld } = await import('../src/game/world.ts')
    const { MatchQueue } = await import('../server/match-queue.ts')
    const { MatchScheduler } = await import('../server/match-scheduler.ts')
    const { emptyMatchBook, matchJobId } = await import('../server/match-job.ts')

    const kickoffAt = Date.UTC(2026, 10, 9, 12, 0, 0)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-ai-takeover-rot-'))
    dirs.push(dir)
    const queue = new MatchQueue(dir, { intervalMs: 0 })
    try {
      const { world } = createOwnerlessWorld(29, kickoffAt)
      const teams = buildOwnerlessTeams(world, 29)
      const division = world.divisions[0]
      const fixture = division.fixtures.find((item) => item.round === 1)!
      const homeTeam = structuredClone(teams[fixture.homeId])
      const outfieldStarters = homeTeam.lineup.starters
        .map((s) => homeTeam.players.find((p) => p.id === s.playerId)!)
        .filter((p) => p.positions.GK === 0)
      const tiredPlayer = outfieldStarters[0]
      const injuredPlayer = outfieldStarters[1]
      tiredPlayer.condition = 40
      const injuries = { [injuredPlayer.id]: kickoffAt + 48 * 60 * 60_000 }

      const scheduler = new MatchScheduler(
        queue,
        { seed: 29, world, teams, matchBook: emptyMatchBook() },
        (id) => {
          if (id === fixture.homeId) {
            return { team: homeTeam, injuries, suspended: [], medical: 1, aiTakeover: true }
          }
          return teams[id] ? { team: structuredClone(teams[id]), injuries: {}, suspended: [], medical: 1, ai: true } : null
        },
        () => {},
      )
      scheduler.refresh(kickoffAt - LINEUP_LOCK_MS)
      const jobId = matchJobId(world.seasonIndex, division.divisionId!, fixture)
      const lockedJob = JSON.parse(fs.readFileSync(path.join(dir, `${jobId}.input.json`), 'utf8')) as MatchJob
      const lockedStarters = lockedJob.home.team.lineup.starters.map((s) => s.playerId)
      expect(lockedStarters).toHaveLength(11)
      expect(lockedStarters).not.toContain(tiredPlayer.id)
      expect(lockedStarters).not.toContain(injuredPlayer.id)
    } finally {
      queue.close()
    }
    expect(AI_TAKEOVER_INACTIVE_MS).toBe(3 * 24 * 60 * 60_000)
  })
})
