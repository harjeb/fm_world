import { describe, expect, it } from 'vitest'
import {
  advanceWorldSeason,
  buildOwnerlessTeams,
  computeWorldTable,
  createOwnerlessWorld,
  createWorldGameFromWorld,
  expandWorldConference,
  hasDualD1,
  ownerlessWorldFromClub,
  promotionSpotCount,
  worldForClub,
} from '../src/game/world.ts'
import {
  advanceSeasonCup,
  planPromotionCup,
  planSeasonCups,
  promotionCupQualifiers,
  seasonCupEntrants,
  syncPromotionPlayoffFromCup,
} from '../src/game/season-cups.ts'
import { postseasonStartAt, seasonEndAt } from '../src/game/calendar.ts'
import type { WorldState } from '../src/game/types.ts'

function finishLeagueSeason(world: WorldState, zonePointsBias?: Record<string, number>): void {
  const names = new Map(world.clubs.map((c) => [c.id, c.name]))
  for (const div of world.divisions) {
    for (const fx of div.fixtures) {
      fx.played = true
      fx.score = { home: 1, away: 0 }
    }
    div.table = computeWorldTable(div.clubIds!, div.fixtures, names)
    if (zonePointsBias && div.divisionId && zonePointsBias[div.divisionId] !== undefined) {
      const bonus = zonePointsBias[div.divisionId]
      div.table.forEach((row, idx) => {
        row.points = bonus + (20 - idx) * 2
        row.gf = 40 + (20 - idx)
        row.ga = 20
      })
    }
    div.finished = true
    div.round = 38
    div.champion = div.table[0]?.teamId ?? null
  }
}

describe('多分区杯赛与双区一级升级体系', () => {
  it('社区杯仅在超过 4 个二级分区后触发方案 C（全二级总积分前 32）；4 区及以内沿用各区前 8', () => {
    const start = Date.UTC(2026, 10, 14, 14)
    const { world } = createOwnerlessWorld(101, start)
    // 扩到 4 个二级区（2 -> 3 -> 4）
    expandWorldConference(world, 101)
    expandWorldConference(world, 101)
    expect(world.divisions.filter((d) => d.tier === 'division2')).toHaveLength(4)

    // 给 d2-north 极高积分、d2-zone4 极低积分，验证 4 区时仍按每区前 8（不会跳过弱区）
    finishLeagueSeason(world, { 'd2-north': 200, 'd2-south': 100, 'd2-zone3': 50, 'd2-zone4': 0 })
    const entrants4 = seasonCupEntrants(world, 38).community
    expect(entrants4).toHaveLength(32)
    const zone4Ids = new Set(world.divisions.find((d) => d.divisionId === 'd2-zone4')!.clubIds!)
    const zone4In4 = entrants4.filter((id) => zone4Ids.has(id))
    expect(zone4In4).toHaveLength(8)

    // 再扩第 5 个二级区（> 4 区）→ 触发方案 C：全二级 100 队按积分统一取前 32
    expandWorldConference(world, 101)
    expect(world.divisions.filter((d) => d.tier === 'division2')).toHaveLength(5)
    finishLeagueSeason(world, { 'd2-north': 400, 'd2-south': 200, 'd2-zone3': 50, 'd2-zone4': 10, 'd2-zone5': 0 })
    const entrants5 = seasonCupEntrants(world, 38).community
    expect(entrants5).toHaveLength(32)
    const northIds = new Set(world.divisions.find((d) => d.divisionId === 'd2-north')!.clubIds!)
    const southIds = new Set(world.divisions.find((d) => d.divisionId === 'd2-south')!.clubIds!)
    // d2-north 全部 20 队 + d2-south 前 12 队 = 32 队，低分区不占保底名额
    expect(entrants5.filter((id) => northIds.has(id))).toHaveLength(20)
    expect(entrants5.filter((id) => southIds.has(id))).toHaveLength(12)
  })

  it.each([4, 5, 6, 8])('%d 个二级分区时升级杯启用 6 席方案：12 强分 A/B/C 3 组 × 4 队 + 3 场跨组附加赛，精准升 6 队', (zoneCount) => {
    const start = Date.UTC(2026, 10, 14, 14)
    const { world } = createOwnerlessWorld(200 + zoneCount, start)
    while (world.divisions.filter((d) => d.tier === 'division2').length < zoneCount) {
      expandWorldConference(world, 200 + zoneCount)
    }
    finishLeagueSeason(world)
    expect(promotionSpotCount(world)).toBe(6)

    const qual = promotionCupQualifiers(world)
    expect(qual.champions.length + qual.qualifierPairs.length).toBe(12)

    const postStart = postseasonStartAt(world.seasonStartedAt)
    const cup = planPromotionCup(world, 999, postStart + 60_000)!
    expect(cup).not.toBeNull()
    expect(cup.dates).toHaveLength(5)
    expect(cup.rounds).toHaveLength(1)
    expect(cup.rounds[0].byes.length + cup.rounds[0].fixtures.length).toBe(12)

    // 依次模拟全部 5 轮
    for (let r = 0; r < 5; r++) {
      const round = cup.rounds[r]
      expect(round).toBeDefined()
      for (const fx of round.fixtures) {
        fx.played = true
        fx.score = { home: 2, away: 1 }
        if (round.stage !== 'group') fx.winnerId = fx.homeId
      }
      advanceSeasonCup(cup, world.seasonIndex, 999)
    }

    expect(cup.groups).toHaveLength(3)
    for (const g of cup.groups!) {
      expect(g.teamIds).toHaveLength(4)
      expect(g.table.every((row) => row.played === 3)).toBe(true)
    }
    const finalRound = cup.rounds[4]
    expect(finalRound.stage).toBe('knockout')
    expect(finalRound.fixtures).toHaveLength(3)
    expect(cup.promotedIds).toHaveLength(6)
    expect(new Set(cup.promotedIds).size).toBe(6)

    world.seasonCups = { version: 1, seasonIndex: world.seasonIndex, drawSeed: 999, qualificationRound: 6, createdAt: postStart, delayedLeagueRounds: [], cups: [cup] }
    expect(syncPromotionPlayoffFromCup(world)).toBe(true)
    expect(world.promotionPlayoff?.finished).toBe(true)
    expect(world.promotionPlayoff?.promoted).toEqual(cup.promotedIds)
  })

  it('4 个二级分区换季自动将一级联赛扩编为南北双区（各 20 队），下季稳态双区升降级 3 上 6 下且联盟杯/星联杯人数正确', () => {
    const start = Date.UTC(2026, 10, 14, 14)
    const { world: initialWorld } = createOwnerlessWorld(303, start)
    expandWorldConference(initialWorld, 303)
    expandWorldConference(initialWorld, 303)
    expect(initialWorld.divisions.filter((d) => d.tier === 'division2')).toHaveLength(4)
    expect(hasDualD1(initialWorld)).toBe(false)
    expect(initialWorld.clubs).toHaveLength(120)

    // 第 1 季完赛并走完 6 席升级杯
    finishLeagueSeason(initialWorld)
    const postStart = postseasonStartAt(initialWorld.seasonStartedAt)
    const promo1 = planPromotionCup(initialWorld, 303, postStart + 60_000)!
    for (let r = 0; r < 5; r++) {
      for (const fx of promo1.rounds[r].fixtures) {
        fx.played = true
        fx.score = { home: 2, away: 1 }
        if (promo1.rounds[r].stage !== 'group') fx.winnerId = fx.homeId
      }
      advanceSeasonCup(promo1, initialWorld.seasonIndex, 303)
    }
    initialWorld.seasonCups = { version: 1, seasonIndex: initialWorld.seasonIndex, drawSeed: 303, qualificationRound: 6, createdAt: postStart, delayedLeagueRounds: [], cups: [promo1] }
    expect(syncPromotionPlayoffFromCup(initialWorld)).toBe(true)
    const promotedS1 = [...promo1.promotedIds!]
    expect(promotedS1).toHaveLength(6)

    // 执行第 1 季 -> 第 2 季换季（单区 D1 -> 南北双区 D1）
    const repId = 'd2n_01'
    const game = createWorldGameFromWorld(initialWorld, repId, 303, start, [], [])
    game.world = worldForClub(initialWorld, repId)
    game.season = game.world.divisions.find((d) => d.clubIds?.includes('player'))!
    game.aiTeams = Object.values(buildOwnerlessTeams(initialWorld, 303)).filter((t) => t.id !== repId)

    const res1 = advanceWorldSeason(game, seasonEndAt(start) + 1000, new Set(), false)
    expect(res1.ok).toBe(true)
    const worldS2 = ownerlessWorldFromClub(game.world!, repId)
    expect(hasDualD1(worldS2)).toBe(true)
    expect(worldS2.clubs).toHaveLength(140)
    expect(new Set(worldS2.clubs.map((c) => c.id)).size).toBe(140)
    const d1DivsS2 = worldS2.divisions.filter((d) => d.tier === 'division1')
    expect(d1DivsS2.map((d) => d.divisionId)).toEqual(['d1-north', 'd1-south'])
    for (const div of worldS2.divisions) expect(div.clubIds).toHaveLength(20)
    // 升级杯晋级的 6 队全部进入一级联赛
    const d1IdsS2 = new Set(worldS2.clubs.filter((c) => c.tier === 'division1').map((c) => c.id))
    for (const id of promotedS1) expect(d1IdsS2.has(id)).toBe(true)

    // 双区一级下的赛季杯赛人数：联盟杯 32 队（南北各前 16），星联杯 32 队（冠联 20 + 一级各前 4 + 二级前 4）
    const s2Entrants = seasonCupEntrants(worldS2, 0)
    expect(s2Entrants.league).toHaveLength(32)
    expect(s2Entrants.cross).toHaveLength(32)
    // 完赛前 6 轮后 planSeasonCups 正常排表
    for (const div of worldS2.divisions) {
      for (const fx of div.fixtures) if (fx.round <= 6) { fx.played = true; fx.score = { home: 1, away: 0 } }
    }
    const s2Cups = planSeasonCups(worldS2, 303, worldS2.seasonStartedAt + 40 * 3600_000)!
    expect(s2Cups.cups.find((c) => c.id === 'league')?.entrants).toHaveLength(32)
    expect(s2Cups.cups.find((c) => c.id === 'cross')?.entrants).toHaveLength(32)

    // 第 2 季稳态双区完赛 -> 换季第 3 季（零和 140 队，3 队升冠联，6 队降二级，6 队升一级）
    finishLeagueSeason(worldS2)
    const champRelegated = worldS2.divisions.find((d) => d.divisionId === 'champions')!.table.slice(-3).map((r) => r.teamId)
    const d1NorthTop1 = worldS2.divisions.find((d) => d.divisionId === 'd1-north')!.table[0].teamId
    const d1SouthTop1 = worldS2.divisions.find((d) => d.divisionId === 'd1-south')!.table[0].teamId
    const d1Relegated = [
      ...worldS2.divisions.find((d) => d.divisionId === 'd1-north')!.table.slice(-3).map((r) => r.teamId),
      ...worldS2.divisions.find((d) => d.divisionId === 'd1-south')!.table.slice(-3).map((r) => r.teamId),
    ]

    const promo2 = planPromotionCup(worldS2, 304, postseasonStartAt(worldS2.seasonStartedAt) + 60_000)!
    for (let r = 0; r < 5; r++) {
      for (const fx of promo2.rounds[r].fixtures) {
        fx.played = true
        fx.score = { home: 2, away: 1 }
        if (promo2.rounds[r].stage !== 'group') fx.winnerId = fx.homeId
      }
      advanceSeasonCup(promo2, worldS2.seasonIndex, 304)
    }
    worldS2.seasonCups = { version: 1, seasonIndex: worldS2.seasonIndex, drawSeed: 304, qualificationRound: 6, createdAt: postseasonStartAt(worldS2.seasonStartedAt), delayedLeagueRounds: [], cups: [promo2] }
    expect(syncPromotionPlayoffFromCup(worldS2)).toBe(true)
    const promotedS2 = [...promo2.promotedIds!]
    expect(promotedS2).toHaveLength(6)

    const game2 = createWorldGameFromWorld(worldS2, repId, 303, worldS2.seasonStartedAt, [], [])
    game2.world = worldForClub(worldS2, repId)
    game2.season = game2.world.divisions.find((d) => d.clubIds?.includes('player'))!
    game2.aiTeams = Object.values(buildOwnerlessTeams(worldS2, 303)).filter((t) => t.id !== repId)

    const res2 = advanceWorldSeason(game2, seasonEndAt(worldS2.seasonStartedAt) + 1000, new Set(), false)
    expect(res2.ok).toBe(true)
    const worldS3 = ownerlessWorldFromClub(game2.world!, repId)
    expect(worldS3.clubs).toHaveLength(140)
    expect(new Set(worldS3.clubs.map((c) => c.id)).size).toBe(140)
    for (const div of worldS3.divisions) expect(div.clubIds).toHaveLength(20)

    const champIdsS3 = new Set(worldS3.clubs.filter((c) => c.tier === 'champions').map((c) => c.id))
    const d1IdsS3 = new Set(worldS3.clubs.filter((c) => c.tier === 'division1').map((c) => c.id))
    const d2IdsS3 = new Set(worldS3.clubs.filter((c) => c.tier === 'division2').map((c) => c.id))
    expect(champIdsS3.has(d1NorthTop1)).toBe(true)
    expect(champIdsS3.has(d1SouthTop1)).toBe(true)
    for (const id of champRelegated) expect(d1IdsS3.has(id)).toBe(true)
    for (const id of d1Relegated) expect(d2IdsS3.has(id)).toBe(true)
    for (const id of promotedS2) expect(d1IdsS3.has(id)).toBe(true)
  })
})
