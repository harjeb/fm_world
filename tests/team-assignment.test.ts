import { describe, expect, it } from 'vitest'
import { createOwnerlessWorld, expandWorldConference, pickFreeClubForNewAccount, worldSlots } from '../src/game/world.ts'
import type { WorldState } from '../src/game/types.ts'

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

  it('席位统计与分配结果一致', () => {
    const target = world()
    const { owners, picked } = assignTimes(target, 12)
    expect(worldSlots(target, owners, Object.values(owners))).toEqual({ total: 80, taken: picked.length, free: 80 - picked.length })
  })
})
