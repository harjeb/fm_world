import { describe, expect, it } from 'vitest'
import { createOwnerlessWorld, createWorldGame, createWorldGameFromWorld, d2ClubChoices, previewD2Clubs } from '../src/game/world.ts'
import { validateLineup } from '../src/game/squad.ts'
import type { Player } from '../src/game/types.ts'

/** 只比开局就定下来的内容，合同是开局时才写上去的。 */
const shape = (roster: Player[]) => roster.map(({ id, name, enName, age, attrs, positions, traitId, skills, skillTiers, era, seedId }) => ({ id, name, enName, age, attrs, positions, traitId, skills, skillTiers, era, seedId }))

describe('选队预览', () => {
  const seed = 4242
  const clubs = previewD2Clubs(seed)

  it('二级联赛 40 支球队都有名单，和可选的球队一一对应', () => {
    expect(clubs).toHaveLength(40)
    expect(clubs.map((club) => club.id).sort()).toEqual(d2ClubChoices().map((club) => club.id).sort())
    expect(clubs.filter((club) => club.conference === 'north')).toHaveLength(20)
    for (const club of clubs) {
      expect(club.roster.length, club.name).toBeGreaterThanOrEqual(12)
      expect(club.color, club.name).toBeTruthy()
      expect(validateLineup(club.roster, club.lineup).valid, club.name).toBe(true)
    }
  })

  it('看到的名单就是真正开局拿到的名单', () => {
    for (const club of [clubs[0], clubs[7], clubs[23], clubs[39]]) {
      const game = createWorldGame(seed, club.id)
      expect(game.clubName).toBe(club.name)
      expect(shape(game.roster), club.name).toEqual(shape(club.roster))
      expect(game.lineup, club.name).toEqual(club.lineup)
    }
  })

  it('每支队的名单不一样，二级球队开局没有真实球星', () => {
    const firstNames = new Set(clubs.map((club) => club.roster[0].name))
    expect(firstNames.size).toBeGreaterThan(35)
    for (const club of clubs) expect(club.roster.filter((player) => player.era !== 'random'), club.name).toHaveLength(0)
  })

  it('同一个种子预览结果不变；换种子就变', () => {
    expect(shape(previewD2Clubs(seed)[5].roster)).toEqual(shape(clubs[5].roster))
    expect(shape(previewD2Clubs(seed + 1)[5].roster)).not.toEqual(shape(clubs[5].roster))
  })

  it('接管二级队不送球星，世界里的球星总数不变', () => {
    for (const id of [clubs[0].id, clubs[30].id]) {
      const game = createWorldGame(seed, id)
      expect(game.roster.filter((player) => player.era !== 'random')).toHaveLength(0)
      expect(game.world!.clubs.find((club) => club.id === 'player')!.starPlayerIds).toEqual([])
      const clubStars = game.world!.clubs.reduce((sum, club) => sum + club.starPlayerIds.length, 0)
      expect(clubStars).toBe(100)
      expect(game.freeStars).toHaveLength(250)
      expect(game.reserveStars).toHaveLength(150)
    }
  })

  it('联机接管不同的球队，名单也不一样', () => {
    const shared = createOwnerlessWorld(seed)
    const before = structuredClone(shared.world)
    const ids = shared.world.clubs.filter((club) => club.tier === 'division2').slice(0, 2).map((club) => club.id)
    const [first, second] = ids.map((id) => createWorldGameFromWorld(shared.world, id, seed, Date.now(), shared.freeStars, shared.reserveStars))
    expect(first.roster.map((player) => player.name)).not.toEqual(second.roster.map((player) => player.name))
    // 共享世界本身不被改动。
    expect(shared.world).toEqual(before)
  })
})
