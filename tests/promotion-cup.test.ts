import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  advanceWorldSeason,
  buildOwnerlessTeams,
  computeWorldTable,
  createOwnerlessWorld,
  createWorldGameFromWorld,
  expandWorldConference,
  ownerlessWorldFromClub,
  worldForClub,
} from '../src/game/world.ts'
import { seedAIClubs } from '../src/game/ai-club.ts'
import { kickoffAtForRound, postseasonStartAt, seasonEndAt } from '../src/game/calendar.ts'
import {
  collectPromotionCupSlots,
  isSeasonRolloverReady,
  planPromotionCup,
  syncPromotionPlayoffFromCup,
} from '../src/game/season-cups.ts'
import { createAppServer, type AppServer } from '../server/app.ts'
import { MatchQueue } from '../server/match-queue.ts'
import { MatchScheduler } from '../server/match-scheduler.ts'
import { emptyMatchBook, seasonCupJobId, type MatchJob, type MatchJobResult } from '../server/match-job.ts'
import { cupRoundLabel } from '../src/ui/format.ts'
import { renderSeasonCups } from '../src/ui/season-cup-view.ts'
import type { MatchRecord } from '../src/game/types.ts'

const queues: MatchQueue[] = []
const dirs: string[] = []
const servers: AppServer[] = []

afterEach(() => {
  while (servers.length) servers.pop()!.close()
  while (queues.length) queues.pop()!.close()
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

function mockCupResult(job: MatchJob): MatchJobResult {
  const isGroup = job.competition?.stage === 'group'
  // 确定性比分：淘汰赛有胜负（含点球分支），小组赛按种子出胜/平/负
  const hash = Math.abs(job.seed) % 5
  const score = isGroup
    ? (hash === 0 ? { home: 1, away: 1 } : hash % 2 === 1 ? { home: 2, away: 1 } : { home: 0, away: 2 })
    : (hash === 0 ? { home: 1, away: 1 } : { home: 2, away: 0 })
  const shootout = !isGroup && score.home === score.away ? { home: 5, away: 4 } : undefined
  return {
    id: job.id,
    record: {
      id: job.id,
      score,
      ...(shootout ? { shootout } : {}),
      playerStats: [],
    } as unknown as MatchRecord,
    fixture: { score, ...(shootout ? { shootout } : {}), matchId: job.id },
    injuries: {},
    conditionLoss: {},
    appearances: {},
    cards: [],
  }
}

describe('实时排期升级杯（方案 1）', () => {
  it('3 个二级赛区（9 队）在 16 小时休整期内按 5 轮排期自动走完全程，并正确同步 3 支升级队与小组第 2', async () => {
    const start = Date.UTC(2026, 10, 14, 14) // 北京时间 2026-11-14 22:00
    const created = createOwnerlessWorld(77, start)
    const world = created.world
    // 扩到 3 个二级赛区（与线上第 1 赛季一致）
    expandWorldConference(world, 77)
    const teams = buildOwnerlessTeams(world, 77)
    const aiClubs = seedAIClubs(world, 77)
    const names = new Map(world.clubs.map((c) => [c.id, c.name]))
    for (const div of world.divisions) {
      for (const f of div.fixtures) {
        f.played = true
        f.score = { home: 2, away: 1 }
      }
      div.table = computeWorldTable(div.clubIds!, div.fixtures, names)
      div.finished = true
      div.champion = div.table[0]?.teamId ?? null
    }

    const postStart = postseasonStartAt(world.seasonStartedAt)
    const endAt = seasonEndAt(world.seasonStartedAt)
    // 临近换季不足以走完 5 轮时不强行创建残缺升级杯
    expect(collectPromotionCupSlots(world, endAt - 2.5 * 3600_000, 5)).toEqual([])

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-promo-cup-'))
    dirs.push(dir)
    const queue = new MatchQueue(dir, { intervalMs: 0, compute: async (job) => mockCupResult(job) })
    queues.push(queue)
    const shared = { seed: 77, world, teams, aiClubs, matchBook: emptyMatchBook() }
    const scheduler = new MatchScheduler(
      queue,
      shared,
      (id) => teams[id] ? { team: structuredClone(teams[id]), injuries: {}, suspended: [], medical: 1, ai: true } : null,
      () => {},
      true,
    )

    // 休整期开始后 2.5 小时刷新（类似今日 08:30）→ 自动排入 5 轮（+4h,+6h,+8h,+10h,+12h）
    const now = postStart + 2.5 * 3600_000
    expect(scheduler.refresh(now)).toBe(true)
    const promo = world.seasonCups!.cups.find((c) => c.id === 'promotion')!
    expect(promo).toBeTruthy()
    expect(promo.entrants).toHaveLength(9)
    expect(promo.dates).toHaveLength(5)
    expect(promo.dates).toEqual([4, 6, 8, 10, 12].map((h) => postStart + h * 3600_000))
    expect(promo.rounds).toHaveLength(1)
    expect(promo.rounds[0].byes).toHaveLength(3)
    expect(promo.rounds[0].fixtures).toHaveLength(3)
    expect(world.promotionPlayoff?.finished).toBe(false)
    expect(world.promotionPlayoff?.promoted).toEqual([])

    // 依次走完 5 轮（赛前 30 分钟锁阵 → 计算 → 开球 10 分钟后公布）
    for (let r = 0; r < 5; r++) {
      const date = promo.dates[r]
      scheduler.refresh(date - 30 * 60_000)
      const queued = [...queue.entries.values()].filter((e) => e.status === 'queued').length
      expect(queued).toBeGreaterThan(0)
      for (let i = 0; i < queued; i++) await queue.pump(date - 30 * 60_000)
      expect(scheduler.refresh(date + 600_000)).toBe(true)
      const currentRound = promo.rounds[r]
      expect(currentRound.fixtures.every((f) => f.played)).toBe(true)
      // 升级杯不发放金币奖励
      for (const fx of currentRound.fixtures) {
        const jobId = seasonCupJobId(world.seasonIndex, 'promotion', fx.id)
        expect(aiClubs[fx.homeId].seasonCupGoldClaims?.[`match:${jobId}`]).toBeUndefined()
      }
    }

    // 校验小组赛结构：2 组 × 3 队，每队恰好踢 2 场且每轮仅 1 场
    expect(promo.groups).toHaveLength(2)
    for (const g of promo.groups!) {
      expect(g.teamIds).toHaveLength(3)
      expect(g.table).toHaveLength(3)
      expect(g.table.every((row) => row.played === 2)).toBe(true)
    }

    // 校验小组第二附加赛参赛队严格为 A 组实际第 2 vs B 组实际第 2
    const finalRound = promo.rounds[4]
    expect(finalRound.fixtures).toHaveLength(1)
    expect(finalRound.fixtures[0].homeId).toBe(promo.groups![0].table[1].teamId)
    expect(finalRound.fixtures[0].awayId).toBe(promo.groups![1].table[1].teamId)

    // 校验最终 3 支升级队同步回 world.promotionPlayoff 且无 'player' 泄露
    expect(promo.championId).toBeTruthy()
    expect(promo.promotedIds).toHaveLength(3)
    expect(promo.promotedIds![0]).toBe(promo.groups![0].table[0].teamId)
    expect(promo.promotedIds![1]).toBe(promo.groups![1].table[0].teamId)
    expect(promo.promotedIds![2]).toBe(finalRound.fixtures[0].winnerId)
    expect(world.promotionPlayoff?.finished).toBe(true)
    expect(world.promotionPlayoff?.promoted).toEqual(promo.promotedIds)
    expect(world.promotionPlayoff?.runnerUps).toEqual([finalRound.fixtures[0].homeId, finalRound.fixtures[0].awayId])

    // UI 渲染与轮次标签校验
    expect(cupRoundLabel(1, 5, false, 'knockout', undefined, 'promotion')).toBe('资格赛')
    expect(cupRoundLabel(2, 5, false, 'group', undefined, 'promotion')).toBe('小组赛第 1 轮')
    expect(cupRoundLabel(5, 5, false, 'knockout', undefined, 'promotion')).toBe('小组第二附加赛')
    const sampleClub = promo.entrants[0]
    const game = createWorldGameFromWorld(world, sampleClub, 77, start, [], [])
    game.world!.seasonCupMode = 1
    const html = renderSeasonCups(game, 'promotion')
    expect(html).toContain('第 1 阶段 · 资格赛')
    expect(html).toContain('第 2 阶段 · 小组循环赛')
    expect(html).toContain('第 3 阶段 · 小组第二附加赛')

    // 校验换季时（即便代表队正好是升级队之一）3 支升级队全部正确升入一级联赛，且一级保持 20 队、无 'player' 泄露
    const promotedRep = promo.promotedIds![0]
    const repGame = createWorldGameFromWorld(world, promotedRep, 77, start, [], [])
    repGame.world = worldForClub(world, promotedRep)
    repGame.season = repGame.world.divisions.find((d) => d.clubIds?.includes('player'))!
    expect(repGame.world.promotionPlayoff?.promoted).toContain('player')
    const rolled = advanceWorldSeason(repGame, endAt + 1000, new Set(), false)
    expect(rolled.ok).toBe(true)
    const nextWorld = ownerlessWorldFromClub(repGame.world!, promotedRep)
    expect(nextWorld.clubs.filter((c) => c.tier === 'division1')).toHaveLength(20)
    for (const id of promo.promotedIds!) {
      expect(nextWorld.clubs.find((c) => c.id === id)?.tier).toBe('division1')
    }
    expect(nextWorld.lastPromotionPlayoff?.promoted).toEqual(promo.promotedIds)
    expect(nextWorld.lastPromotionPlayoff?.runnerUps).toEqual([finalRound.fixtures[0].homeId, finalRound.fixtures[0].awayId])
  })

  it('2 个二级赛区（6 队）按 3 轮排期走完；ownerlessWorldFromClub 正确还原 runnerUps 中的 player', () => {
    const start = Date.UTC(2026, 10, 14, 14)
    const world = createOwnerlessWorld(88, start).world
    for (const div of world.divisions) {
      for (const f of div.fixtures) {
        f.played = true
        f.score = { home: 1, away: 0 }
      }
    }
    const postStart = postseasonStartAt(world.seasonStartedAt)
    const cup = planPromotionCup(world, 88, postStart + 60_000)!
    expect(cup.entrants).toHaveLength(6)
    expect(cup.dates).toHaveLength(3)
    expect(cup.dates).toEqual([4, 8, 12].map((h) => postStart + h * 3600_000))

    // 验证 ownerlessWorldFromClub 正确翻译 runnerUps
    const clubId = world.clubs.find((c) => c.tier === 'division2')!.id
    const game = createWorldGameFromWorld(world, clubId, 88, start, [], [])
    game.world!.promotionPlayoff = {
      seasonIndex: 1,
      teams: ['player', 'd2s_01'],
      matches: [],
      promoted: ['player'],
      finished: true,
      runnerUps: ['player', 'd2s_01'],
    }
    const ownerless = ownerlessWorldFromClub(game.world!, clubId)
    expect(ownerless.promotionPlayoff?.runnerUps).toEqual([clubId, 'd2s_01'])
    expect(syncPromotionPlayoffFromCup(world)).toBe(false)
    expect(kickoffAtForRound(start, 38)).toBeLessThan(postStart)
  })

  it('实时升级杯（及本季其余杯赛）全部结束后立即允许换季更新下赛季球队，且新赛季开赛时间仍锚定原定换季时刻', async () => {
    const start = Date.UTC(2026, 10, 14, 14)
    const { world, freeStars, reserveStars } = createOwnerlessWorld(99, start)
    for (const div of world.divisions) {
      for (const f of div.fixtures) {
        f.played = true
        f.score = { home: 1, away: 0 }
      }
      div.finished = true
    }
    const postStart = postseasonStartAt(world.seasonStartedAt)
    const endAt = seasonEndAt(world.seasonStartedAt)

    // 未生成或未完赛时，休整期结束前不允许提前滚入下赛季
    expect(isSeasonRolloverReady(world, postStart + 60_000)).toBe(false)
    expect(isSeasonRolloverReady(world, endAt)).toBe(true)

    const promo = planPromotionCup(world, 99, postStart + 60_000)!
    world.seasonCupMode = 1
    world.seasonCups = {
      version: 1,
      seasonIndex: world.seasonIndex,
      qualificationRound: 6,
      createdAt: postStart,
      delayedLeagueRounds: [],
      cups: [promo],
    }
    expect(isSeasonRolloverReady(world, postStart + 60_000)).toBe(false)

    // 连同服务端：升级杯最后一场公布结束后（仍在 seasonEndAt 之前），autoRollSharedSeason 立即将联赛球队切入第 2 赛季
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-promo-rollover-'))
    dirs.push(dir)
    const finishPromoFixture = (fx: any) => {
      fx.played = true
      fx.score = { home: 2, away: 0 }
      fx.winnerId = fx.homeId
    }
    // 先把升级杯推进到已完赛（championId & promotedIds 已确定）
    promo.rounds[0].fixtures.forEach(finishPromoFixture)
    promo.groups = [
      { index: 0, name: 'A 组', teamIds: promo.entrants.slice(0, 3), table: promo.entrants.slice(0, 3).map((teamId) => ({ teamId, played: 2, won: 1, drawn: 1, lost: 0, gf: 2, ga: 1, points: 4 })) },
      { index: 1, name: 'B 组', teamIds: promo.entrants.slice(3, 6), table: promo.entrants.slice(3, 6).map((teamId) => ({ teamId, played: 2, won: 1, drawn: 1, lost: 0, gf: 2, ga: 1, points: 4 })) },
    ]
    promo.promotedIds = [promo.groups[0].table[0].teamId, promo.groups[1].table[0].teamId, promo.groups[0].table[1].teamId]
    promo.championId = promo.promotedIds[0]
    syncPromotionPlayoffFromCup(world)

    const beforeEndClock = endAt - 3 * 3600_000
    expect(isSeasonRolloverReady(world, beforeEndClock)).toBe(true)

    fs.writeFileSync(path.join(dir, 'world.json'), JSON.stringify({
      seed: 99,
      startedAt: start,
      owners: {},
      world,
      teams: buildOwnerlessTeams(world, 99),
      freeStars,
      reserveStars,
    }))
    const app = createAppServer({ dataDir: dir, tickMs: 0, now: () => beforeEndClock, seasonCups: true })
    servers.push(app)
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(app.server.address() as any).port}`

    // 启动时 autoRollSharedSeason 已经立即将世界推到第 2 赛季
    const rolledWorld = await (await fetch(`${base}/api/world`)).json() as any
    expect(rolledWorld.seasonIndex).toBe(2)
    expect(rolledWorld.startedAt).toBe(endAt)
    for (const id of promo.promotedIds) {
      expect(rolledWorld.clubs.find((c: any) => c.id === id)?.tier).toBe('division1')
    }
  })
})
