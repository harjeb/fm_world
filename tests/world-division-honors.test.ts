import { describe, expect, it } from 'vitest'
import {
  advanceWorldSeason,
  computeWorldTable,
  createWorldGame,
  divisionHonorFor,
  ensureWorldHistoryDivisions,
} from '../src/game/world.ts'

describe('各联赛历届荣誉分库记录与旧历史回填', () => {
  it('能为旧版无 divisions 的第 1 赛季历史幂等还原各区冠军与升降级', () => {
    const game = createWorldGame(7788, 'north', '测试北队')
    const world = game.world!
    const d1Club = world.clubs.find((c) => c.id === 'd1_01')!
    const northChamp = world.clubs.find((c) => c.tier === 'division2' && c.conference === 'north' && c.id !== 'player')!
    const southChamp = world.clubs.find((c) => c.tier === 'division2' && c.conference === 'south')!
    const north2 = world.clubs.find((c) => c.tier === 'division2' && c.conference === 'north' && c.id !== 'player' && c.id !== northChamp.id)!
    const north3 = world.clubs.find((c) => c.tier === 'division2' && c.conference === 'north' && c.id !== 'player' && c.id !== northChamp.id && c.id !== north2.id)!

    world.lastPromotionPlayoff = {
      seasonIndex: 1,
      teams: [northChamp.id, north2.id, north3.id, southChamp.id],
      matches: [
        { id: 'q1', stage: 'qualifier', homeId: north2.id, awayId: north3.id, score: { home: 1, away: 0 } },
      ],
      promoted: [northChamp.id, southChamp.id, north2.id],
      finished: true,
    }
    world.history = [
      {
        seasonIndex: 1,
        champion: '曼城',
        promotions: ['d1_01', 'd1_02', 'd1_03', northChamp.id, southChamp.id, north2.id],
        relegations: ['ai_18', 'ai_19', 'ai_20', 'd1_18', 'd1_19', 'd1_20'],
        championsTop4: ['ai_02', 'ai_01', 'ai_03', 'ai_04'],
      },
    ]

    const entry = world.history[0]
    expect(divisionHonorFor(world, entry, 'champions')).toEqual({
      championId: 'ai_02',
      champion: '曼城',
      promotions: [],
      relegations: ['ai_18', 'ai_19', 'ai_20'],
    })
    expect(divisionHonorFor(world, entry, 'division1')).toEqual({
      championId: 'd1_01',
      champion: d1Club.name,
      promotions: ['d1_01', 'd1_02', 'd1_03'],
      relegations: ['d1_18', 'd1_19', 'd1_20'],
    })
    const northCanon = northChamp.squadKey ?? northChamp.id
    expect(divisionHonorFor(world, entry, 'd2-north')).toEqual({
      championId: northCanon,
      champion: northChamp.name,
      promotions: [northCanon, north2.id],
      relegations: [],
    })
    expect(divisionHonorFor(world, entry, 'd2-south')).toEqual({
      championId: southChamp.id,
      champion: southChamp.name,
      promotions: [southChamp.id],
      relegations: [],
    })
    // S2 才扩区新增的四区不应错误展示 S1 荣誉
    expect(divisionHonorFor(world, entry, 'd2-zone4')).toBeNull()

    expect(ensureWorldHistoryDivisions(world)).toBe(true)
    expect(entry.divisions?.division1?.champion).toBe(d1Club.name)
    expect(entry.divisions?.['d2-north']?.champion).toBe(northChamp.name)
    expect(ensureWorldHistoryDivisions(world)).toBe(false)
  })

  it('换季结算会为冠军联赛、精英联赛和先锋各赛区分别写入历届冠军与升降级', () => {
    const start = Date.UTC(2026, 10, 9, 2)
    const game = createWorldGame(8899, 'south', '南方星', start)
    const world = game.world!
    const clubNames = new Map(world.clubs.map((c) => [c.id, c.id === 'player' ? game.clubName : c.name]))

    for (const div of world.divisions) {
      const ids = div.clubIds ?? []
      for (const fixture of div.fixtures) {
        fixture.played = true
        const hIdx = ids.indexOf(fixture.homeId)
        const aIdx = ids.indexOf(fixture.awayId)
        fixture.score = hIdx < aIdx ? { home: 2, away: 0 } : { home: 0, away: 2 }
      }
      div.table = computeWorldTable(ids, div.fixtures, clubNames)
      div.finished = true
      div.champion = div.table[0]?.teamId
    }
    game.season = world.divisions.find((d) => d.divisionId === world.playerDivisionId)!
    game.season.finished = true

    const expectedChampions: Record<string, string> = {}
    for (const div of world.divisions) {
      if (div.divisionId) expectedChampions[div.divisionId] = clubNames.get(div.table[0].teamId)!
    }

    expect(advanceWorldSeason(game, start + 10 * 86_400_000).ok).toBe(true)
    expect(world.history).toHaveLength(1)
    const honors = world.history[0].divisions!
    expect(honors.champions.champion).toBe(expectedChampions.champions)
    expect(honors.champions.promotions).toEqual([])
    expect(honors.champions.relegations).toHaveLength(3)

    expect(honors.division1.champion).toBe(expectedChampions.division1)
    expect(honors.division1.promotions).toHaveLength(3)
    expect(honors.division1.relegations).toHaveLength(3)

    expect(honors['d2-north'].champion).toBe(expectedChampions['d2-north'])
    expect(honors['d2-north'].relegations).toEqual([])
    expect(honors['d2-south'].champion).toBe(expectedChampions['d2-south'])
    expect(honors['d2-south'].relegations).toEqual([])
  })
})
