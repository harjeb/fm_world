import { describe, expect, it } from 'vitest'
import { createWorldGame, payWorldWages, d2ClubChoices, createOwnerlessWorld, createWorldGameFromWorld, advanceOwnerlessWorld } from '../src/game/world.ts'
import { ROUND_MS, startLeagueMatch, startNextSeason, updateSeasonTable } from '../src/game/season.ts'
import { buyFreeAgent, releasePlayer, renewContract, transferWindowOpen } from '../src/game/market.ts'
import { recordMatchDiscipline, serveSuspensions } from '../src/game/discipline.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { allPlayers, inputFor, makeTeams } from './helpers.ts'
import type { GameState } from '../src/game/types.ts'

function finishSeason(game: GameState, playerGoals = 5): void {
  for (const fixture of game.season.fixtures) {
    const playerHome = fixture.homeId === 'player'
    if (fixture.isPlayer) fixture.score = playerHome ? { home: playerGoals, away: 0 } : { home: 0, away: playerGoals }
    else fixture.score = { home: 1, away: 1 }
    fixture.played = true
  }
  game.season.round = 38
  updateSeasonTable(game)
}

function next(game: GameState): ReturnType<typeof startNextSeason> {
  return startNextSeason(game, game.season.startedAt + ROUND_MS * 41)
}

describe('三级共享世界', () => {
  it('创建冠军/一级/二级南北区，玩家从二级队开始', () => {
    const game = createWorldGame(1)
    expect(game.world!.clubs).toHaveLength(80)
    expect(game.world!.divisions).toHaveLength(4)
    expect(game.world!.divisions.map((d) => d.clubIds?.length)).toEqual([20, 20, 20, 20])
    expect(game.world!.clubs.filter((club) => club.tier === 'champions')).toHaveLength(20)
    expect(game.world!.clubs.filter((club) => club.tier === 'division1')).toHaveLength(20)
    expect(game.world!.clubs.filter((club) => club.tier === 'division2' && club.conference === 'north')).toHaveLength(20)
    expect(game.world!.clubs.filter((club) => club.tier === 'division2' && club.conference === 'south')).toHaveLength(20)
    expect(game.world!.clubs.find((club) => club.id === 'player')?.tier).toBe('division2')
    expect(game.roster).toHaveLength(18)
    expect(game.freeStars).toHaveLength(250)
    expect(game.reserveStars).toHaveLength(150)
    expect(game.world!.playerDivisionId).toBe('d2-north')
    expect(d2ClubChoices().length).toBe(40)
  })

  it('接管指定二级球队，保留名称和赛区', () => {
    const game = createWorldGame(2, 'd2s_05')
    expect(game.clubName).toBe('金滩')
    expect(game.world!.playerDivisionId).toBe('d2-south')
    expect(game.season.divisionId).toBe('d2-south')
    expect(game.season.table.filter((row) => row.teamId === 'player')).toHaveLength(1)
  })

  it('赛季结束运行二级 8 队升级附加赛并完成升降级', () => {
    const game = createWorldGame(1)
    for (const player of game.roster) for (const key of Object.keys(player.attrs) as (keyof typeof player.attrs)[]) player.attrs[key] = 1500
    finishSeason(game)
    expect(next(game).ok).toBe(true)
    const playoff = game.world!.lastPromotionPlayoff!
    expect(playoff.teams).toHaveLength(8)
    expect(playoff.matches).toHaveLength(8)
    expect(playoff.promoted).toHaveLength(3)
    expect(playoff.matches.filter((match) => match.stage === 'final')).toHaveLength(1)
    expect(game.world!.clubs.filter((club) => club.tier === 'champions')).toHaveLength(20)
    expect(game.world!.clubs.filter((club) => club.tier === 'division1')).toHaveLength(20)
    expect(game.world!.clubs.filter((club) => club.tier === 'division2' && club.conference === 'north')).toHaveLength(20)
    expect(game.world!.clubs.filter((club) => club.tier === 'division2' && club.conference === 'south')).toHaveLength(20)
    expect(game.world!.clubs.find((club) => club.id === 'player')?.tier).toBe('division1')
    expect(game.season.divisionId).toBe('division1')
    expect(game.seasonHistory?.length).toBe(1)
  })

  it('共享世界快照可按当前轮次接管球队，并保留已赛结果', () => {
    const startedAt = Date.now() - 20 * 60 * 60 * 1000
    const ownerless = createOwnerlessWorld(1, startedAt)
    expect(ownerless.world.clubs.some((club) => club.id === 'player')).toBe(false)
    expect(advanceOwnerlessWorld(ownerless.world, Date.now())).toBe(true)
    const game = createWorldGameFromWorld(ownerless.world, 'd2n_05', 1, startedAt, ownerless.freeStars, ownerless.reserveStars)
    expect(game.clubName).toBe('冰河')
    expect(game.season.round).toBe(2)
    expect(game.season.fixtures.filter((fixture) => fixture.played).length).toBeGreaterThan(0)
    expect(game.season.fixtures.filter((fixture) => fixture.isPlayer).every((fixture) => fixture.round !== 1 || fixture.played)).toBe(true)
  })

  it('球员老化、退役，并在自由市场生成同名 16 岁重生', () => {
    const game = createWorldGame(3)
    const star = game.roster.find((player) => player.starKey)!
    const name = star.name
    star.age = 40
    finishSeason(game)
    expect(next(game).ok).toBe(true)
    expect(game.roster.some((player) => player.id === star.id)).toBe(false)
    const regen = game.freeStars.find((player) => player.name === name && player.age === 16)
    expect(regen).toBeDefined()
    expect(regen!.generation).toBe((star.generation ?? 0) + 1)
    expect(regen!.starKey).toBe(star.starKey)
  })

  it('合同、续约、解约、转会窗口与工资', () => {
    const game = createWorldGame(4)
    const player = game.freeStars[0]
    expect(buyFreeAgent(game, player.id).ok).toBe(true)
    expect(player.contract?.clubId).toBe('player')
    const before = player.contract!.expiresSeason
    expect(renewContract(game, player.id, 2).ok).toBe(true)
    expect(player.contract!.expiresSeason).toBe(before + 2)
    expect(releasePlayer(game, player.id).ok).toBe(true)
    expect(game.freeStars).toContain(player)
    game.season.round = 11
    expect(transferWindowOpen(game)).toBe(false)
    expect(buyFreeAgent(game, game.freeStars[1].id).ok).toBe(false)
    game.world!.seasonIndex = 2
    const economy = game.economy!
    const wage = game.roster.reduce((sum, item) => sum + (item.contract?.wage ?? 0), 0)
    economy.balance = 100000
    expect(payWorldWages(game, 1)).toBe(Math.min(100000, wage))
    expect(economy.balance).toBe(100000 - Math.min(100000, wage))
  })

  it('红黄牌产生停赛，停赛球员不能首发；越位开关生效', () => {
    const game = createWorldGame(5)
    const id = game.lineup.starters[0].playerId
    recordMatchDiscipline(game, { log: [{ card: 'red', playerId: `home:${id}` }] })
    expect(game.suspensions![id]).toMatchObject({ matches: 2, atRound: 2 })
    expect(startLeagueMatch(game).ok).toBe(false)
    serveSuspensions(game, 1)
    expect(game.suspensions![id].matches).toBe(2)
    serveSuspensions(game, 2)
    expect(game.suspensions![id].matches).toBe(1)
    serveSuspensions(game, 3)
    expect(game.suspensions![id]).toBeUndefined()

    const { roster, lineup } = makeTeams(30)
    let offside = 0
    let cards = 0
    for (let seed = 0; seed < 20; seed++) {
      const state = new MatchEngine({ seed, home: inputFor(roster, lineup, 'h', 'H'), away: inputFor(roster, lineup, 'a', 'A'), knockout: false, offside: true }).simulate()
      offside += state.log.filter((entry) => entry.offside).length
      cards += state.stats.home.yellowCards + state.stats.away.yellowCards + state.stats.home.redCards + state.stats.away.redCards
    }
    expect(offside).toBeGreaterThan(0)
    expect(cards).toBeGreaterThan(0)
    const off = new MatchEngine({ seed: 9, home: inputFor(roster, lineup, 'h', 'H'), away: inputFor(roster, lineup, 'a', 'A'), knockout: false, offside: false }).simulate()
    expect(off.log.some((entry) => entry.offside)).toBe(false)
  })
})
