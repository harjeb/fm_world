import { describe, expect, it } from 'vitest'
import { STAR_TRAITS } from '../src/game/data/star-traits.generated.ts'
import { buyFromClub } from '../src/game/market.ts'
import { upgradeNames } from '../src/game/names.ts'
import { validateLineup } from '../src/game/squad.ts'
import { buildWorldDivisionTeams, createOwnerlessWorld, createWorldGame, createWorldGameFromWorld, previewD2Clubs } from '../src/game/world.ts'
import type { GameState, Player } from '../src/game/types.ts'

/** 同一个人出现在多个地方就列出来。随机球员按名字认，球星按 id 认。 */
function duplicates(groups: [string, Player[]][]): string[] {
  const seen = new Map<string, string>()
  const found: string[] = []
  for (const [where, players] of groups) {
    for (const player of players) {
      for (const key of player.era === 'random' ? [`名:${player.enName}`, `名:${player.name}`] : [`星:${player.id}`]) {
        const before = seen.get(key)
        if (before) found.push(`${key}（${before} / ${where}）`)
        else seen.set(key, where)
      }
    }
  }
  return found
}

function everyone(game: GameState): [string, Player[]][] {
  return [
    ['我的队', game.roster],
    ['自由', game.freeStars],
    ['储备', game.reserveStars ?? []],
    ...game.aiTeams.map((team): [string, Player[]] => [team.name, team.players]),
  ]
}

describe('同一个人只出现一次', () => {
  it('选队界面的 40 支队没有相同的球员，包括招牌球员', () => {
    for (const seed of [1, 2, 3, 2026, 987654]) {
      const clubs = previewD2Clubs(seed)
      expect(duplicates(clubs.map((club) => [club.name, club.roster])), `seed ${seed}`).toEqual([])
      const signatures = clubs.map((club) => club.roster.filter((player) => player.era !== 'random'))
      for (const stars of signatures) expect(stars).toHaveLength(1)
      expect(new Set(signatures.map((stars) => stars[0].id)).size).toBe(40)
      // 招牌球员不当门将。
      for (const stars of signatures) expect(stars[0].positions.GK).toBeLessThan(70)
    }
  })

  it('开局的世界里没有重复的人：我的队、同联赛的球队、自由和储备球星', () => {
    for (const seed of [1, 7, 2026]) {
      for (const pick of [0, 11, 33]) {
        const clubId = previewD2Clubs(seed)[pick].id
        const game = createWorldGame(seed, clubId)
        expect(duplicates(everyone(game)), `seed ${seed}`).toEqual([])
      }
    }
  })

  it('全世界 80 支队的随机球员都不重名', () => {
    const shared = createOwnerlessWorld(5)
    const names = new Map<string, string>()
    let total = 0
    for (const division of shared.world.divisions) {
      const clubId = (division.clubIds ?? []).find((id) => shared.world.clubs.find((club) => club.id === id)?.tier === 'division2')
      if (!clubId) continue
      const game = createWorldGameFromWorld(shared.world, clubId, 5, Date.now(), shared.freeStars, shared.reserveStars)
      for (const team of [...game.aiTeams, { name: game.clubName, players: game.roster }]) {
        for (const player of team.players) {
          if (player.era !== 'random') continue
          total++
          expect(names.get(player.enName), player.enName).toBeUndefined()
          names.set(player.enName, team.name)
        }
      }
    }
    expect(total).toBeGreaterThan(600)
  })

  it('招牌球员调走后，原来的球队名单里不再有他，球星总数不变', () => {
    const game = createWorldGame(9, previewD2Clubs(9)[5].id)
    const signature = game.roster.find((player) => player.era !== 'random')!
    const holders = game.world!.clubs.filter((club) => club.starPlayerIds.includes(signature.id))
    expect(holders.map((club) => club.id)).toEqual(['player'])
    expect(game.world!.clubs.reduce((sum, club) => sum + club.starPlayerIds.length, 0)).toBe(100)
    expect(game.freeStars).toHaveLength(250)
    expect(game.reserveStars).toHaveLength(150)
  })

  it('联机时不同账号的招牌球员不同，名单也不同', () => {
    const shared = createOwnerlessWorld(5)
    const ids = shared.world.clubs.filter((club) => club.tier === 'division2').slice(0, 4).map((club) => club.id)
    const games = ids.map((id) => createWorldGameFromWorld(shared.world, id, 5, Date.now(), shared.freeStars, shared.reserveStars))
    const signatures = games.map((game) => game.roster.find((player) => player.era !== 'random')!.id)
    expect(new Set(signatures).size).toBe(ids.length)
    expect(duplicates(games.map((game, index): [string, Player[]] => [ids[index], game.roster]))).toEqual([])
  })

  it('从 AI 球队买来的球星，世界名单里也清掉了，重建球队时不会再生成一个', () => {
    const game = createWorldGame(9)
    const world = game.world!
    const donor = world.clubs.find((club) => club.tier === 'division1' && club.starPlayerIds.length >= 1)!
    // 让这支队进入玩家能买人的列表。
    const team = { ...game.aiTeams[0], id: donor.id, starPlayerIds: [...donor.starPlayerIds], players: [...game.aiTeams[0].players] }
    const star = game.freeStars[0]
    star.id = donor.starPlayerIds[0]
    team.players[2] = star
    game.aiTeams[0] = team
    game.freeStars = game.freeStars.slice(1)
    game.economy!.balance = 10_000_000
    expect(buyFromClub(game, donor.id, star.id).ok).toBe(true)
    expect(game.roster.some((player) => player.id === star.id)).toBe(true)
    expect(world.clubs.find((club) => club.id === donor.id)!.starPlayerIds).not.toContain(star.id)
  })

  it('旧存档的名单没清掉时，重建球队也不会让玩家已有的球星再出现', () => {
    const game = createWorldGame(9)
    const world = game.world!
    const signature = game.roster.find((player) => player.era !== 'random')!
    // 模拟旧存档：球星在玩家手里，同一联赛的 AI 球队名单里也有他。
    const rival = world.clubs.find((club) => club.id === game.aiTeams[0].id)!
    rival.starPlayerIds = [signature.id]
    const teams = buildWorldDivisionTeams(world, world.playerDivisionId, 123, { roster: game.roster, lineup: game.lineup, reserved: game.freeStars })
    expect(teams.aiTeams.flatMap((team) => team.players).some((player) => player.id === signature.id)).toBe(false)
  })

  it('下赛季重建的球队不会用玩家阵容和自由球员已有的名字', () => {
    const game = createWorldGame(9)
    const world = game.world!
    const released = { ...structuredClone(game.roster.find((player) => player.era === 'random')!), id: 'released-1', enName: 'Test Person', name: '测试球员' }
    const teams = buildWorldDivisionTeams(world, world.playerDivisionId, 456, { roster: game.roster, lineup: game.lineup, reserved: [released] })
    expect(duplicates([['我的队', game.roster], ['自由', [released]], ...teams.aiTeams.map((team): [string, Player[]] => [team.name, team.players])])).toEqual([])
  })

  it('每支队的阵容都合法，同队的姓尽量不重复', () => {
    for (const club of previewD2Clubs(77)) {
      expect(validateLineup(club.roster, club.lineup).valid, club.name).toBe(true)
      const families = club.roster.filter((player) => player.era === 'random').map((player) => player.enName.split(' ').at(-1))
      expect(new Set(families).size, club.name).toBeGreaterThanOrEqual(families.length - 1)
    }
  })
})

describe('旧存档清理', () => {
  function oldSave(): GameState {
    const game = createWorldGame(21)
    delete (game as { namesVersion?: number }).namesVersion
    return game
  }

  it('AI 球队之间撞名的改名字，属性不变', () => {
    const game = oldSave()
    const original = game.aiTeams[0].players.find((player) => player.era === 'random')!
    const twin = game.aiTeams[1].players.find((player) => player.era === 'random')!
    const attrs = structuredClone(twin.attrs)
    twin.name = original.name
    twin.enName = original.enName
    expect(upgradeNames(game)).toBe(true)
    expect(twin.enName).not.toBe(original.enName)
    expect(twin.name).not.toBe(original.name)
    expect(twin.attrs).toEqual(attrs)
    expect(duplicates(everyone(game))).toEqual([])
  })

  it('玩家阵容里的人和 AI 球队撞名时，玩家的人不动', () => {
    const game = oldSave()
    const mine = game.roster.find((player) => player.era === 'random')!
    const rival = game.aiTeams[0].players.find((player) => player.era === 'random')!
    const before = mine.enName
    rival.enName = mine.enName
    rival.name = mine.name
    upgradeNames(game)
    expect(mine.enName).toBe(before)
    expect(rival.enName).not.toBe(before)
  })

  it('AI 球队里和玩家重复的球星换成随机球员，阵容还是合法的', () => {
    const game = oldSave()
    const signature = game.roster.find((player) => player.era !== 'random')!
    const team = game.aiTeams[0]
    const index = team.players.findIndex((player) => primary(player) === primary(signature))
    const slotId = team.players[index].id
    team.players[index] = { ...structuredClone(signature), id: signature.id }
    team.lineup = JSON.parse(JSON.stringify(team.lineup).replaceAll(slotId, signature.id))
    team.starPlayerIds = [signature.id]
    upgradeNames(game)
    expect(team.starPlayerIds).not.toContain(signature.id)
    const replacement = team.players[index]
    expect(replacement.era).toBe('random')
    expect(replacement.name).not.toBe(signature.name)
    expect(replacement.traitId in STAR_TRAITS).toBe(false)
    expect(validateLineup(team.players, team.lineup).valid).toBe(true)
    expect(duplicates(everyone(game))).toEqual([])
  })

  it('自由球员里和玩家重复的球星被移除；世界名单也清掉', () => {
    const game = oldSave()
    const signature = game.roster.find((player) => player.era !== 'random')!
    game.freeStars.push(structuredClone(signature))
    const club = game.world!.clubs.find((item) => item.tier === 'division1')!
    club.starPlayerIds.push(signature.id)
    const size = game.freeStars.length
    upgradeNames(game)
    expect(game.freeStars).toHaveLength(size - 1)
    expect(club.starPlayerIds).not.toContain(signature.id)
    expect(game.roster.some((player) => player.id === signature.id)).toBe(true)
  })

  it('只处理一次；没有重复的存档不受影响', () => {
    const game = oldSave()
    const before = structuredClone(game.roster.map((player) => [player.id, player.name]))
    expect(upgradeNames(game)).toBe(true)
    expect(upgradeNames(game)).toBe(false)
    expect(game.roster.map((player) => [player.id, player.name])).toEqual(before)
  })
})

function primary(player: Player): string {
  return (['GK', 'CB', 'W', 'CM', 'ST'] as const).find((position) => player.positions[position] >= 70) ?? 'CM'
}
