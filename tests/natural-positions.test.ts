import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { createRandomPlayer, randomSquadPositionTemplate } from '../src/game/data/random-players.ts'
import { createPlayerFromSeed, PLAYER_SEEDS } from '../src/game/data/players.ts'
import { DETAILED_POSITIONS, DETAILED_TO_POSITION, detailedPositionForSlot, readDetailedPositions } from '../src/game/detailed-positions.ts'
import { allocateNaturalSquad, backfillNaturalPlayer, initializeNaturalPositions, naturalPositionProfile, naturalSquadTemplate } from '../src/game/natural-positions.ts'
import { buildOwnerlessTeams, cachedOwnerlessTeams, createOwnerlessWorld, createWorldGame } from '../src/game/world.ts'
import { FORMATION_LIST } from '../src/game/data/formations.ts'
import type { DetailedPosition, Player, Position } from '../src/game/types.ts'

function fingerprint(player: Player) {
  const { detailedPositions, baseDetailedPositions, detailedPositionsVersion, baseDetailedPositionsVersion, positionProfile, ...rest } = player
  return rest
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

function canCover(players: Player[], slots: DetailedPosition[]): boolean {
  const assigned = new Map<number, number>()
  const match = (slot: number, visited: Set<number>): boolean => {
    for (let p = 0; p < players.length; p++) {
      if (visited.has(p) || readDetailedPositions(players[p])[slots[slot]] < 80) continue
      visited.add(p)
      if (!assigned.has(p) || match(assigned.get(p)!, visited)) { assigned.set(p, slot); return true }
    }
    return false
  }
  return slots.every((_, slot) => match(slot, new Set()))
}

describe('天然位置生成与覆盖', () => {
  it('旧生成路径的身份/属性/CA/风格随机流完全不变', () => {
    const random = (['GK', 'CB', 'W', 'CM', 'ST'] as Position[]).flatMap(position => Array.from({ length: 20 }, (_, seed) => fingerprint(createRandomPlayer({ seed: seed + 723, position, tier: 2, idPrefix: `d2n01-${seed + 1}`, modernPositions: false }))))
    expect(hash(random)).toBe('9dc5bc33547102d55218c88cdd606726eee6864d0a7e9abba21149ada4e9afbb')
    expect(hash(PLAYER_SEEDS.map(s => fingerprint(createPlayerFromSeed(s))))).toBe('0e293a83a86b4a501cf9d896e0bdfa59b520a156b4d981b6fdd1e793a97e19dc')
  })
  it('所有具体位置都能作为90–99天然主位置，副位置80–89，非相关位置不冒充主位置', () => {
    for (const position of DETAILED_POSITIONS) for (let seed = 1; seed <= 12; seed++) {
      const options = { seed, position: DETAILED_TO_POSITION[position], detailedPosition: position, tier: 2 }
      const player = createRandomPlayer(options)
      expect(player).toEqual(createRandomPlayer(options))
      expect(player.positionProfile?.primary).toBe(position)
      const values = readDetailedPositions(player)
      expect(values[position]).toBeGreaterThanOrEqual(90)
      expect(values[position]).toBeLessThanOrEqual(99)
      for (const pos of DETAILED_POSITIONS.filter(p => p !== position)) {
        if (player.positionProfile!.floors[pos] !== undefined) {
          expect(values[pos]).toBeGreaterThanOrEqual(80)
          expect(values[pos]).toBeLessThanOrEqual(89)
        } else expect(values[pos]).toBeLessThanOrEqual(75)
      }
      if (['DL', 'DR', 'WBL', 'WBR'].includes(position)) expect(player.style).toMatch(/^fb_/)
      if (position !== 'GK') expect(values.GK).toBe(0)
    }
  })
  it('天然位置不因惯用脚扣分；已有其他熟练度只增不减', () => {
    const player = createRandomPlayer({ seed: 55, position: 'W', detailedPosition: 'AML', tier: 3 })
    player.foot = 'R'
    initializeNaturalPositions(player, 'AML')
    expect(player.detailedPositions!.AML).toBeGreaterThanOrEqual(90)
    const old = structuredClone(player)
    delete old.positionProfile
    old.detailedPositions = { AML: 99, DR: 98, WBL: 97 }
    old.baseDetailedPositions = { ...old.detailedPositions }
    backfillNaturalPlayer(old)
    expect(old.detailedPositions.AML).toBe(99)
    expect(old.detailedPositions.DR).toBe(98)
    expect(old.detailedPositions.WBL).toBe(97)
  })
  it('25人位置模板保留原粗位置顺序，每种阵型能用不同的适配球员排满', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const template = naturalSquadTemplate(seed)
      expect(template.map(p => DETAILED_TO_POSITION[p])).toEqual(randomSquadPositionTemplate())
      const players = template.map((pos, i) => createRandomPlayer({ seed: seed * 100 + i, position: DETAILED_TO_POSITION[pos], detailedPosition: pos, tier: 2 }))
      for (const pos of DETAILED_POSITIONS) expect(players.some(p => readDetailedPositions(p)[pos] >= 80), pos).toBe(true)
      for (const formation of FORMATION_LIST) expect(canCover(players, formation.slots.map(detailedPositionForSlot)), formation.id).toBe(true)
    }
  })
  it('球星按实际位置优先入槽；补人不能全是边锋', () => {
    const names = ['Lionel Messi', 'Arjen Robben', 'David Beckham', 'Paolo Maldini', 'Andrea Pirlo']
    const stars = names.map(enName => createPlayerFromSeed(PLAYER_SEEDS.find(s => s.enName === enName)!))
    const allocation = allocateNaturalSquad(stars, 53)
    expect(allocation.stars.size).toBe(stars.length)
    const players = allocation.positions.map((pos, slot) => allocation.stars.get(slot) ?? createRandomPlayer({ seed: 55 + slot, position: DETAILED_TO_POSITION[pos], detailedPosition: pos, tier: 2 }))
    for (const pos of DETAILED_POSITIONS) expect(players.some(p => readDetailedPositions(p)[pos] >= 80), pos).toBe(true)
    for (const formation of FORMATION_LIST) expect(canCover(players, formation.slots.map(detailedPositionForSlot)), formation.id).toBe(true)
    const beckham = stars.find(p => p.enName === 'David Beckham')!
    expect(beckham.positionProfile?.primary).toBe('MR')
    expect(beckham.baseDetailedPositions!.MR).toBeGreaterThanOrEqual(90)
    const robben = stars.find(p => p.enName === 'Arjen Robben')!
    expect(robben.positionProfile?.primary).toBe('AMR')
    expect(robben.foot).toBe('L')
  })
  it('旧槽位按seedId稳定识别，不把自由球员/青训/补位ID误当槽位', () => {
    const options = { seed: 42, position: 'W' as const, tier: 2, modernPositions: false }
    const player = createRandomPlayer({ ...options, idPrefix: 'd2n_01-7' })
    expect(player.positionProfile?.primary).toBe('DL')
    const other = structuredClone(player)
    delete other.positionProfile
    other.id = 'transferred-deduped-id'
    expect(naturalPositionProfile(other)).toEqual(player.positionProfile)
    const market = createRandomPlayer({ ...options, idPrefix: 'fa25-7' })
    expect(market.positionProfile?.primary).not.toBe('DL')
  })
  it('同种子的旧世界和新世界缓存隔离；现代世界各队和阵型位置覆盖正常', () => {
    const modern = createOwnerlessWorld(8391, Date.UTC(2026, 10, 18, 2)).world
    const legacy = structuredClone(modern)
    delete legacy.positionGenerationVersion
    const oldTeams = cachedOwnerlessTeams(legacy, 8391)
    const newTeams = cachedOwnerlessTeams(modern, 8391)
    expect(oldTeams).not.toBe(newTeams)
    expect(cachedOwnerlessTeams(legacy, 8391)).toBe(oldTeams)
    const fresh = buildOwnerlessTeams(modern, 8391)
    for (const [id, team] of Object.entries(newTeams)) {
      expect(team.players).toEqual(fresh[id].players)
      for (const pos of DETAILED_POSITIONS) expect(team.players.some(p => readDetailedPositions(p)[pos] >= 80), `${id}:${pos}`).toBe(true)
      expect(team.players).toHaveLength(25)
    }
    const game = createWorldGame(8392)
    expect(game.world?.positionGenerationVersion).toBe(1)
  })
})
