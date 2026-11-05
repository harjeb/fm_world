import { describe, expect, it } from 'vitest'
import { NAME_POOLS, pickRandomName, translateRandomName } from '../src/game/data/name-pools.ts'
import { PLAYER_SEEDS, seedById } from '../src/game/data/players.ts'
import { createRandomPlayer } from '../src/game/data/random-players.ts'
import { LEGACY_CLUB_RENAMES, WORLD_CLUB_DEFS } from '../src/game/data/world-clubs.ts'
import { NAMES_VERSION, upgradeNames, upgradeSharedWorldNames } from '../src/game/names.ts'
import { derivedRng } from '../src/game/rng.ts'
import { createWorldGame, d2ClubChoices } from '../src/game/world.ts'
import { shortName } from '../src/ui/format.ts'
import type { GameState, Player, WorldState } from '../src/game/types.ts'

/** 改版前的英文名池：旧存档里的名字都从这里来。 */
const OLD_FIRST = ['Noah', 'Liam', 'Ethan', 'Luca', 'Milo', 'Leo', 'Owen', 'Finn', 'Ezra', 'Kai', 'Ravi', 'Diego', 'Andre', 'Mateo', 'Ivan', 'Jonas', 'Emil', 'Oscar', 'Hugo', 'Theo', 'Nico', 'Samir', 'Yuki', 'Rafael', 'Dario', 'Bruno', 'Elias', 'Felix', 'Marco', 'Tomas']
const OLD_LAST = ['Hart', 'Vale', 'Mori', 'Silva', 'Costa', 'Reyes', 'Lind', 'Berg', 'Falk', 'Rossi', 'Moreau', 'Keller', 'Navarro', 'Petrov', 'Okafor', 'Haddad', 'Sato', 'Kim', 'Dahl', 'Novak', 'Serra', 'Brandt', 'Ferreira', 'Marchetti', 'Voss', 'Lund', 'Arslan', 'Bianchi', 'Kovac']

function samplePlayers(count: number): Player[] {
  return Array.from({ length: count }, (_, index) => createRandomPlayer({ seed: 1000 + index * 7, position: 'CM', tier: 3 }))
}

/** 把一份存档改回旧格式：中文名和英文名没有关系、虚构队名、没有版本号。 */
function makeLegacy(game: GameState): GameState {
  const legacy = structuredClone(game)
  delete legacy.namesVersion
  const oldNames = [...LEGACY_CLUB_RENAMES]
  const toOld = new Map(oldNames.map(([old, next]) => [next.name, old]))
  legacy.clubName = toOld.get(legacy.clubName) ?? legacy.clubName
  for (const team of legacy.aiTeams) team.name = toOld.get(team.name) ?? team.name
  for (const club of legacy.world?.clubs ?? []) club.name = toOld.get(club.name) ?? club.name
  for (const [index, player] of [...legacy.roster, ...legacy.aiTeams.flatMap((team) => team.players)].entries()) {
    if (player.era !== 'random') continue
    player.name = `旧名${index}`
    player.country = '随机青训'
    player.enName = `${OLD_FIRST[index % OLD_FIRST.length]} ${OLD_LAST[index % OLD_LAST.length]}`
  }
  return legacy
}

describe('随机球员姓名', () => {
  it('中文名就是英文名的译名，西式名字用间隔号', () => {
    expect(translateRandomName('Rafael Serra')).toEqual({ name: '拉斐尔·塞拉', enName: 'Rafael Serra', country: '巴西' })
    expect(translateRandomName('Luca Rossi')?.name).toBe('卢卡·罗西')
    expect(translateRandomName('Kenta Sato')).toEqual({ name: '佐藤健太', enName: 'Kenta Sato', country: '日本' })
    expect(translateRandomName('Kim Minjun')).toEqual({ name: '金敏俊', enName: 'Kim Minjun', country: '韩国' })
    expect(translateRandomName('Tian Qihang')).toEqual({ name: '田启航', enName: 'Tian Qihang', country: '中国' })
  })

  it('生成的每名球员，中文名都能由英文名反查出来', () => {
    for (const player of samplePlayers(400)) {
      const translated = translateRandomName(player.enName)
      expect(translated, player.enName).not.toBeNull()
      expect(player.name, player.enName).toBe(translated!.name)
      expect(player.country, player.enName).toBe(translated!.country)
    }
  })

  it('不全是中国名字，国家分布够杂', () => {
    const players = samplePlayers(1000)
    const chinese = players.filter((player) => player.country === '中国').length
    expect(chinese).toBeGreaterThan(80)
    expect(chinese).toBeLessThan(260)
    expect(new Set(players.map((player) => player.country)).size).toBeGreaterThanOrEqual(12)
  })

  it('姓名池自身没有问题：每项都有中英文，同一池内英文不重复', () => {
    for (const pool of NAME_POOLS) {
      for (const parts of [pool.first, pool.last]) {
        expect(new Set(parts.map((part) => part[0])).size, pool.country).toBe(parts.length)
        for (const [en, zh] of parts) {
          expect(en, pool.country).toMatch(/^[A-Za-z]+$/)
          expect(zh, en).toMatch(/^[一-龥]+$/)
        }
      }
    }
  })

  it('不会撞上 500 名真实球星的名字，同一份名单不重名', () => {
    const stars = new Set(PLAYER_SEEDS.map((seed) => seed.enName))
    const used = new Set<string>()
    const players = Array.from({ length: 300 }, (_, index) => createRandomPlayer({ seed: 5000 + index, position: 'ST', tier: 2, usedNames: used }))
    for (const player of players) expect(stars.has(player.enName)).toBe(false)
    expect(new Set(players.map((player) => player.name)).size).toBe(300)
    expect(new Set(players.map((player) => player.enName)).size).toBe(300)
  })

  it('同一支球队里的姓不重复，球场上只显示姓也分得清', () => {
    for (const seed of [78, 79, 80]) {
      const game = createWorldGame(seed)
      for (const team of [...game.aiTeams, { players: game.roster }]) {
        const random = team.players.filter((player) => player.era === 'random')
        expect(new Set(random.map((player) => shortName(player.name))).size).toBe(random.length)
      }
    }
  })

  it('同一个随机流选出同一个名字', () => {
    const picked = pickRandomName(derivedRng(1, 'x'))
    expect(picked).toEqual(pickRandomName(derivedRng(1, 'x')))
    expect(picked.family).toBeTruthy()
    expect(picked.enName).toContain(picked.family)
  })

  it('改版前的英文名都能翻译（包括混搭的名和姓），国籍跟姓走', () => {
    for (const first of OLD_FIRST) {
      for (const last of OLD_LAST) {
        const translated = translateRandomName(`${first} ${last}`)
        expect(translated, `${first} ${last}`).not.toBeNull()
        expect(translated!.name).toMatch(/^[一-龥·]+$/)
      }
    }
    expect(translateRandomName('Rafael Okafor')).toEqual({ name: '拉斐尔·奥卡福', enName: 'Rafael Okafor', country: '尼日利亚' })
    expect(translateRandomName('Noah Sato')).toEqual({ name: '诺亚·佐藤', enName: 'Noah Sato', country: '日本' })
    expect(translateRandomName('Not A Name')).toBeNull()
    expect(translateRandomName('Nobody Unknown')).toBeNull()
  })

  it('窄位置只显示姓', () => {
    expect(shortName('拉斐尔·塞拉')).toBe('塞拉')
    expect(shortName('何塞·路易斯·莫拉莱斯')).toBe('莫拉莱斯')
    expect(shortName('田启航')).toBe('田启航')
    expect(shortName('佐藤健太')).toBe('佐藤健太')
  })
})

describe('球队名单', () => {
  it('80 支球队名字不重复，低级别球队都是真实队名且有英文名', () => {
    expect(WORLD_CLUB_DEFS).toHaveLength(80)
    expect(new Set(WORLD_CLUB_DEFS.map((club) => club.name)).size).toBe(80)
    const lower = WORLD_CLUB_DEFS.filter((club) => club.tier !== 'champions')
    expect(lower).toHaveLength(60)
    for (const club of lower) {
      expect(club.enName, club.name).toBeTruthy()
      expect(club.color, club.name).toMatch(/^#[0-9a-f]{6}$/)
      expect(LEGACY_CLUB_RENAMES.has(club.name), club.name).toBe(false)
    }
    expect(new Set(lower.map((club) => club.enName)).size).toBe(60)
  })

  it('旧队名一一对应新队名，不会把两支旧队改成同一支', () => {
    expect(LEGACY_CLUB_RENAMES.size).toBe(60)
    expect(new Set([...LEGACY_CLUB_RENAMES.values()].map((club) => club.name)).size).toBe(60)
  })

  it('新游戏的选队列表和新世界都用新队名', () => {
    const choices = d2ClubChoices()
    expect(choices).toHaveLength(40)
    expect(choices.every((club) => !!club.enName)).toBe(true)
    const game = createWorldGame(77, choices[3].id)
    expect(game.clubName).toBe(choices[3].name)
    expect(game.namesVersion).toBe(NAMES_VERSION)
    for (const team of game.aiTeams) expect(LEGACY_CLUB_RENAMES.has(team.name)).toBe(false)
    expect(game.roster.every((player) => player.era !== 'random' || player.country !== '随机青训')).toBe(true)
  })
})

describe('旧存档升级', () => {
  it('球员和球队改名，属性不动，重复执行不再变化', () => {
    const game = makeLegacy(createWorldGame(78))
    const player = game.roster.find((item) => item.era === 'random')!
    const attrs = structuredClone(player.attrs)
    const oldClub = game.clubName
    expect(LEGACY_CLUB_RENAMES.has(oldClub)).toBe(true)
    expect(upgradeNames(game)).toBe(true)
    expect(player.name).toBe(translateRandomName(player.enName)!.name)
    expect(player.country).not.toBe('随机青训')
    expect(player.attrs).toEqual(attrs)
    expect(game.clubName).toBe(LEGACY_CLUB_RENAMES.get(oldClub)!.name)
    expect(game.world!.clubs.find((club) => club.id === 'player')!.name).toBe(game.clubName)
    expect(game.world!.clubs.every((club) => !LEGACY_CLUB_RENAMES.has(club.name))).toBe(true)
    expect(game.aiTeams.every((team) => !LEGACY_CLUB_RENAMES.has(team.name))).toBe(true)
    const snapshot = JSON.stringify(game)
    expect(upgradeNames(game)).toBe(false)
    expect(JSON.stringify(game)).toBe(snapshot)
  })

  it('玩家自定义的队名保留', () => {
    const game = makeLegacy(createWorldGame(79))
    game.clubName = '我的队'
    upgradeNames(game)
    expect(game.clubName).toBe('我的队')
  })

  it('比赛记录、解说和进球信息里的旧名字一起换掉，只换这场出现过的人', () => {
    const game = makeLegacy(createWorldGame(80))
    const player = game.roster.find((item) => item.era === 'random')!
    const oldPlayerName = player.name
    const opponent = game.aiTeams[0]
    const oldOpponent = opponent.name
    const oldClub = game.clubName
    const entry = (text: string) => ({ text }) as never
    game.matchHistory = [{
      id: 'm', seed: 1, createdAt: 1, isLeague: true, round: 1, homeId: 'player', awayId: opponent.id, homeName: oldClub, awayName: oldOpponent,
      score: { home: 1, away: 0 }, result: 'win', stats: {} as never,
      playerStats: [{ playerId: `home:${player.id}`, sourceId: player.id, name: oldPlayerName, side: 'home', minutes: 90, passes: 0, passesCompleted: 0, shots: 1, goals: 1, tackles: 0, interceptions: 0, distance: 0, staminaLeft: 50, touches: 1 }],
      skillStats: [], failureStats: [], instructions: [], lineup: {} as never, opponentId: opponent.id,
      goalDetails: [{ playerId: `home:${player.id}`, playerName: oldPlayerName } as never],
      keyEvents: [entry(`${oldPlayerName} 为 ${oldClub} 破门，${oldOpponent} 落后。`)],
      commentary: [entry(`${oldPlayerName} 拿球。路人甲 跟上。`)],
    }]
    upgradeNames(game)
    const [record] = game.matchHistory
    expect(record.homeName).toBe(game.clubName)
    expect(record.awayName).toBe(LEGACY_CLUB_RENAMES.get(oldOpponent)!.name)
    expect(record.playerStats[0].name).toBe(player.name)
    expect(record.goalDetails![0].playerName).toBe(player.name)
    expect(record.keyEvents[0].text).toBe(`${player.name} 为 ${game.clubName} 破门，${record.awayName} 落后。`)
    expect(record.commentary![0].text).toBe(`${player.name} 拿球。路人甲 跟上。`)
  })

  it('球员卡和培养中的成果也跟着改名', () => {
    const game = makeLegacy(createWorldGame(81))
    const player = game.roster.find((item) => item.era === 'random')!
    game.cards = [{ id: 'card-1', playerId: player.id, playerName: player.name, serial: 1, version: 1, routeId: null, createdAt: 1, attrs: player.attrs, positions: player.positions, personality: player.personality, skills: [] }]
    game.candidates = { [player.id]: structuredClone(player) }
    upgradeNames(game)
    expect(game.cards[0].playerName).toBe(player.name)
    expect(game.candidates[player.id].name).toBe(player.name)
  })

  it('译错的真实球星名字改正，旧存档跟着改', () => {
    const fixes: [string, string][] = [['Nani', '纳尼'], ['David Luiz', '大卫·路易斯'], ['O. Ighalo', '奥迪翁·伊哈洛'], ['Morales', '何塞·路易斯·莫拉莱斯']]
    for (const [en, zh] of fixes) expect(PLAYER_SEEDS.find((seed) => seed.enName === en)?.name).toBe(zh)
    const seed = PLAYER_SEEDS.find((item) => item.enName === 'Nani')!
    expect(seedById(seed.id)?.name).toBe('纳尼')
    const game = createWorldGame(82)
    delete game.namesVersion
    const star = { ...game.freeStars[0], id: seed.id, seedId: seed.id, name: '兰尼', enName: 'Nani' }
    game.freeStars = [star]
    upgradeNames(game)
    expect(star.name).toBe('纳尼')
  })

  it('服务器共享世界：队名和球星译名升级，再跑一次没有变化', () => {
    const seed = PLAYER_SEEDS.find((item) => item.enName === 'Nani')!
    const shared = {
      world: { clubs: [{ id: 'd2n_01', name: [...LEGACY_CLUB_RENAMES.keys()][20], short: 'x', color: '#000000' }] } as unknown as WorldState,
      freeStars: [{ id: seed.id, seedId: seed.id, name: '兰尼', enName: 'Nani', era: seed.era, country: seed.country } as Player],
      reserveStars: [],
    }
    expect(upgradeSharedWorldNames(shared)).toBe(true)
    expect(shared.world.clubs[0].name).toBe('阿克灵顿斯坦利')
    expect(shared.world.clubs[0].enName).toBe('Accrington Stanley')
    expect(shared.freeStars[0].name).toBe('纳尼')
    expect(upgradeSharedWorldNames(shared)).toBe(false)
  })
})
