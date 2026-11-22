import { describe, expect, it } from 'vitest'
import { createOwnerlessWorld, expandWorldConference, INITIAL_CHAMPIONS_CLUB_IDS, isClubPlayerLocked, pickFreeClubForNewAccount, worldSlots } from '../src/game/world.ts'
import { conferenceLabel } from '../src/game/data/world-clubs.ts'
import type { ConferenceId, WorldState } from '../src/game/types.ts'

const world = (): WorldState => createOwnerlessWorld(1, Date.now()).world

/** 依次给 n 个账号分球队，模拟注册流程。 */
const assignTimes = (target: WorldState, count: number) => {
  const owners: Record<string, string> = {}
  const picked: string[] = []
  for (let index = 0; index < count; index++) {
    const accountId = `acc${index}`
    const club = pickFreeClubForNewAccount(target, owners, [...Object.values(owners), accountId])
    if (!club) break
    owners[club.id] = accountId
    picked.push(club.id)
  }
  return { owners, picked }
}

describe('新账号球队分配', () => {
  it('只在二级联赛发队：40 支满了就停下来，不往一级/冠军塞人', () => {
    const target = world()
    const { owners, picked } = assignTimes(target, 41)
    expect(picked).toHaveLength(40)
    expect(new Set(picked).size).toBe(40) // 不重复发同一支球队
    const tiers = picked.map((id) => target.clubs.find((club) => club.id === id)!.tier)
    expect(tiers.every((tier) => tier === 'division2')).toBe(true)
    expect(pickFreeClubForNewAccount(target, owners, [...Object.values(owners), 'extra'])).toBeUndefined()
    expect(Object.keys(owners)).toHaveLength(40)
  })

  it('二级满员后开新赛区，新账号仍然从二级开始', () => {
    const target = world()
    const { owners } = assignTimes(target, 40)
    expect(pickFreeClubForNewAccount(target, owners, Object.values(owners))).toBeUndefined()
    const { conference, divisionId } = expandWorldConference(target, 7)
    expect(divisionId).toBe(`d2-${conference}`)
    const extra = pickFreeClubForNewAccount(target, owners, [...Object.values(owners), 'extra'])
    expect(extra?.tier).toBe('division2')
    expect(extra?.conference).toBe(conference)
    expect(target.divisions.some((division) => division.divisionId === divisionId)).toBe(true)
    expect(target.divisions.find((division) => division.divisionId === divisionId)?.clubIds).toHaveLength(20)
  })

  it('已有人带的球队不会再发出去', () => {
    const target = world()
    const first = pickFreeClubForNewAccount(target, {}, ['a'])!
    const owners = { [first.id]: 'a' }
    const second = pickFreeClubForNewAccount(target, owners, ['a', 'b'])!
    expect(second.id).not.toBe(first.id)
  })

  it('80 支球队全被占用时返回 undefined，绝不覆盖已有归属', () => {
    const target = world()
    const owners: Record<string, string> = {}
    for (const club of target.clubs) owners[club.id] = `owner-${club.id}`
    const before = { ...owners }
    expect(pickFreeClubForNewAccount(target, owners, Object.values(owners))).toBeUndefined()
    expect(owners).toEqual(before)
  })

  it('owner 指向已删除账号的球队视为空位，可以重新分配', () => {
    const target = world()
    const first = target.clubs.find((club) => club.tier === 'division2')!
    const owners = { [first.id]: 'ghost' }
    expect(pickFreeClubForNewAccount(target, owners, ['alive'])?.id).toBe(first.id)
    // 账号还在就不再算空位
    expect(pickFreeClubForNewAccount(target, owners, ['ghost'])?.id).not.toBe(first.id)
  })

  it('席位统计与分配结果一致（不含 20 支初始冠军联赛锁定球队）', () => {
    const target = world()
    expect(INITIAL_CHAMPIONS_CLUB_IDS.size).toBe(20)
    const champions = target.clubs.filter((club) => club.tier === 'champions')
    expect(champions).toHaveLength(20)
    expect(champions.every((club) => club.playerLocked === true && isClubPlayerLocked(club))).toBe(true)
    const { owners, picked } = assignTimes(target, 12)
    expect(worldSlots(target, owners, Object.values(owners))).toEqual({ total: 60, taken: picked.length, free: 60 - picked.length })
  })

  it('初始冠军联赛球队即使降级到二级也保持锁定，绝不会被分配给新账号', () => {
    const target = world()
    const { owners } = assignTimes(target, 40)
    expect(pickFreeClubForNewAccount(target, owners, Object.values(owners))).toBeUndefined()
    // 模拟多特蒙德等初始冠军联赛球队降级到二级联赛
    const relegatedChamp = target.clubs.find((club) => club.id === 'ai_13')!
    relegatedChamp.tier = 'division2'
    relegatedChamp.conference = 'north'
    expect(isClubPlayerLocked(relegatedChamp)).toBe(true)
    // 即使它在 division2 且无人执教，也不能分配给新账号（必须返回 undefined 以触发扩区）
    expect(pickFreeClubForNewAccount(target, owners, [...Object.values(owners), 'newcomer'])).toBeUndefined()
  })

  it('连续扩出的赛区依次使用 东区/西区 等无数字命名，球队均带英文原名且中文名 ≤ 7 字无重名', () => {
    const target = world()
    const expandedConferences: ConferenceId[] = []
    for (let step = 0; step < 5; step++) {
      const { conference } = expandWorldConference(target, 100 + step)
      expandedConferences.push(conference)
    }
    expect(expandedConferences).toEqual(['zone3', 'zone4', 'zone5', 'zone6', 'zone7'])
    const labels = expandedConferences.map((conf) => conferenceLabel(conf))
    expect(labels).toEqual(['东区', '西区', '中区', '大西洋区', '太平洋区'])
    expect(labels.every((label) => !/\d/.test(label))).toBe(true)

    const allNames = target.clubs.map((club) => club.name)
    expect(new Set(allNames).size).toBe(target.clubs.length)
    const expandedClubs = target.clubs.filter((club) => club.id.startsWith('d2z'))
    expect(expandedClubs).toHaveLength(100)
    expect(expandedClubs.every((club) => typeof club.enName === 'string' && club.enName.length > 0)).toBe(true)
    expect(expandedClubs.every((club) => club.name.length <= 7 && !/\d/.test(club.name))).toBe(true)
  })
})
