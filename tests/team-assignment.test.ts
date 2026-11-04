import { describe, expect, it } from 'vitest'
import { createOwnerlessWorld, pickFreeClubForNewAccount, worldSlots } from '../src/game/world.ts'
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
  it('优先低级别：先填满 40 支二级球队，再往一级联赛放', () => {
    const target = world()
    const { owners, picked } = assignTimes(target, 41)
    expect(picked).toHaveLength(41)
    expect(new Set(picked).size).toBe(41) // 不重复发同一支球队
    const tiers = picked.map((id) => target.clubs.find((club) => club.id === id)!.tier)
    expect(tiers.slice(0, 40).every((tier) => tier === 'division2')).toBe(true)
    expect(tiers[40]).toBe('division1')
    expect(Object.keys(owners)).toHaveLength(41)
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
