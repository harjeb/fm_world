import { describe, expect, it } from 'vitest'
import { ELEVEN_SQUAD_SIZE } from '../src/game/eleven.ts'
import { createWorldGame, payWorldWages, d2ClubChoices, createOwnerlessWorld, createWorldGameFromWorld, advanceOwnerlessWorld, buildOwnerlessTeams, rolloverOwnerlessTeams, worldTransferTeams } from '../src/game/world.ts'
import { seedAIClubs, equipAICards, playerCa } from '../src/game/ai-club.ts'
import { createSeason, startLeagueMatch, startNextSeason, updateSeasonTable } from '../src/game/season.ts'
import { seasonEndAt, seasonStartForRound } from '../src/game/calendar.ts'
import { aiTransferOffers, buyFreeAgent, joinRoster, releasePlayer, renewContract, sellerSquadError, signWorldClubPlayer, transferWindowOpen, playerMarketValue } from '../src/game/market.ts'
import { negotiationDemands } from '../src/game/negotiation.ts'
import { isOnMarketToday } from '../src/game/market-window.ts'
import { economyOf } from '../src/game/economy.ts'
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
  return startNextSeason(game, seasonEndAt(game.season.startedAt, game.season.clockShift))
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
    expect(game.roster).toHaveLength(ELEVEN_SQUAD_SIZE)
    expect(game.freeStars).toHaveLength(250)
    expect(game.reserveStars).toHaveLength(150)
    expect(game.world!.playerDivisionId).toBe('d2-north')
    expect(d2ClubChoices().length).toBe(40)
  })

  it('接管指定二级球队，保留名称和赛区', () => {
    const game = createWorldGame(2, 'd2s_05')
    expect(game.clubName).toBe('埃尔库莱斯')
    expect(game.world!.playerDivisionId).toBe('d2-south')
    expect(game.season.divisionId).toBe('d2-south')
    expect(game.season.table.filter((row) => row.teamId === 'player')).toHaveLength(1)
  })

  it('赛季结束运行新的升级杯（各区前 3、轮空、小组循环）并完成升降级', () => {
    const game = createWorldGame(1)
    for (const player of game.roster) for (const key of Object.keys(player.attrs) as (keyof typeof player.attrs)[]) player.attrs[key] = 1500
    finishSeason(game)
    expect(next(game).ok).toBe(true)
    expect(game.pve!.cupSeason?.seasonIndex).toBe(2)
    const playoff = game.world!.lastPromotionPlayoff!
    // 两个赛区各出 3 队：每区 2 场加赛，两个小组各 1 场，再加 1 场第二名决战。
    expect(playoff.teams).toHaveLength(6)
    expect(playoff.matches.filter((match) => match.stage === 'qualifier')).toHaveLength(2)
    expect(playoff.matches.filter((match) => match.stage === 'group')).toHaveLength(3)
    expect(playoff.promoted).toHaveLength(3)
    expect(playoff.groups).toHaveLength(2)
    expect(game.world!.clubs.filter((club) => club.tier === 'champions')).toHaveLength(20)
    expect(game.world!.clubs.filter((club) => club.tier === 'division1')).toHaveLength(20)
    expect(game.world!.clubs.filter((club) => club.tier === 'division2' && club.conference === 'north')).toHaveLength(20)
    expect(game.world!.clubs.filter((club) => club.tier === 'division2' && club.conference === 'south')).toHaveLength(20)
    expect(game.world!.clubs.find((club) => club.id === 'player')?.tier).toBe('division1')
    expect(game.season.divisionId).toBe('division1')
    expect(game.seasonHistory?.length).toBe(1)
  })

  it('跨区签人后换季重建卖方，球员不会在别队复活', () => {
    const game = createWorldGame(20241107)
    economyOf(game).balance = 1_000_000_000
    const local = new Set(game.aiTeams.map(team => team.id))
    const offer = aiTransferOffers({ ...game, aiTeams: worldTransferTeams(game) }).find(item => {
      const demands = negotiationDemands(game, item.player)
      return !local.has(item.team.id) && item.asking && !sellerSquadError(item.team, item.player) && (item.player.age ?? 24) < 34 && !demands.minTier && !demands.wantsClubId
    })!
    expect(offer).toBeDefined()
    expect(signWorldClubPlayer(game, offer.team.id, offer.player.id, 100_000_000, { goal: 'title', role: 'star' }).ok).toBe(true)
    expect(game.world!.transferTeams?.[offer.team.id]).toBeDefined()
    finishSeason(game)
    expect(next(game).ok).toBe(true)
    expect(game.world!.transferTeams).toBeUndefined()
    expect(game.roster.some(player => player.id === offer.player.id)).toBe(true)
    expect(worldTransferTeams(game).some(team => team.players.some(player => player.id === offer.player.id))).toBe(false)
  })

  it('共享世界快照可按当前轮次接管球队，并保留已赛结果', () => {
    const startedAt = seasonStartForRound(Date.now(), 2) // 第 2 轮刚开球
    const ownerless = createOwnerlessWorld(1, startedAt)
    expect(ownerless.world.clubs.some((club) => club.id === 'player')).toBe(false)
    expect(advanceOwnerlessWorld(ownerless.world, Date.now())).toBe(true)
    const game = createWorldGameFromWorld(ownerless.world, 'd2n_05', 1, startedAt, ownerless.freeStars, ownerless.reserveStars)
    expect(game.clubName).toBe('莫克姆')
    expect(game.season.round).toBe(2)
    expect(game.season.fixtures.filter((fixture) => fixture.played).length).toBeGreaterThan(0)
    expect(game.season.fixtures.filter((fixture) => fixture.isPlayer).every((fixture) => fixture.round !== 1 || fixture.played)).toBe(true)
  })

  it('二级席位满员后仍可接管一级或冠军联赛的空位', () => {
    const setup = createOwnerlessWorld(7)
    for (const tier of ['division1', 'champions'] as const) {
      const club = setup.world.clubs.find((item) => item.tier === tier)!
      const game = createWorldGameFromWorld(setup.world, club.id, 7, setup.world.seasonStartedAt, setup.freeStars, setup.reserveStars)
      expect(game.world?.clubs.find((item) => item.id === 'player')?.tier).toBe(tier)
      expect(game.season.divisionId).toBe(tier)
      expect(game.aiTeams).toHaveLength(19)
    }
  })

  it('球员老化、退役，并在自由市场生成同名 16 岁重生', () => {
    const game = createWorldGame(3)
    // 二级开局没有球星：玩家签下一名，再看他老化退役。
    const star = game.freeStars.find((player) => player.starKey && player.positions.GK < 70)!
    game.freeStars = game.freeStars.filter((player) => player.id !== star.id)
    joinRoster(game, star)
    const name = star.name
    star.age = 40
    star.detailedPositions = { DL: 17, DR: 89 }
    star.baseDetailedPositions = { DL: 91, DR: 22 }
    finishSeason(game)
    expect(next(game).ok).toBe(true)
    expect(game.roster.some((player) => player.id === star.id)).toBe(false)
    const regen = game.freeStars.find((player) => player.name === name && player.age === 16)
    expect(regen).toBeDefined()
    expect(regen!.generation).toBe((star.generation ?? 0) + 1)
    expect(regen!.starKey).toBe(star.starKey)
    expect(regen!.baseDetailedPositions).toEqual(regen!.detailedPositions)
  })

  it('合同、续约、解约、转会窗口与工资', () => {
    const game = createWorldGame(4)
    const balance = economyOf(game).balance
    const player = [...game.freeStars]
      .filter((item) => isOnMarketToday(game, item) && playerMarketValue(item) <= balance)
      .sort((a, b) => playerMarketValue(a) - playerMarketValue(b))[0]
    expect(buyFreeAgent(game, player.id).ok).toBe(true)
    expect(player.contract?.clubId).toBe('player')
    const before = player.contract!.expiresSeason
    expect(renewContract(game, player.id, 2).ok).toBe(true)
    expect(player.contract!.expiresSeason).toBe(before + 2)
    expect(releasePlayer(game, player.id).ok).toBe(true)
    expect(game.freeStars).toContain(player)
    game.season.round = 11
    expect(transferWindowOpen(game)).toBe(true)
    expect(transferWindowOpen({ ...game, season: { ...game.season, round: 35 } })).toBe(true)
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

  it('联赛赛程对全部 20 支球队主客场交替编排，不存在 3 连主/3 连客或背靠背连遇同一对手', () => {
    const assertBalanced = (ids: string[], fixtures: GameState['season']['fixtures']) => {
      expect(fixtures).toHaveLength(ids.length * (ids.length - 1))
      for (let i = 1; i < fixtures.length; i++) {
        expect(fixtures[i].round).toBeGreaterThanOrEqual(fixtures[i - 1].round)
      }
      const directed = new Set(fixtures.map((f) => `${f.homeId}|${f.awayId}`))
      expect(directed.size).toBe(ids.length * (ids.length - 1))
      for (const id of ids) {
        const list = fixtures.filter((f) => f.homeId === id || f.awayId === id).sort((a, b) => a.round - b.round)
        expect(list).toHaveLength((ids.length - 1) * 2)
        const homeCount = list.filter((f) => f.homeId === id).length
        expect(homeCount).toBe(ids.length - 1)
        let curH = 0
        let curA = 0
        let prevOpp = ''
        for (const f of list) {
          const isHome = f.homeId === id
          const opp = isHome ? f.awayId : f.homeId
          expect(opp).not.toBe(prevOpp)
          prevOpp = opp
          if (isHome) { curH++; curA = 0 } else { curA++; curH = 0 }
          expect(curH).toBeLessThanOrEqual(2)
          expect(curA).toBeLessThanOrEqual(2)
        }
      }
    }

    const game = createWorldGame(42)
    for (const division of game.world!.divisions) {
      assertBalanced(division.clubIds!, division.fixtures)
    }
    const single = createSeason(42, game.aiTeams, game.clubName)
    assertBalanced(['player', ...game.aiTeams.map((t) => t.id)], single.fixtures)
  })

  it('换季时保留合法的玩家自定义首发、战术风格/比赛计划/预设，以及 AI 原班主力与培养卡', () => {
    const game = createWorldGame(77)
    // 让所有球员年轻且合同未到期，保证换季后原首发全部仍在队。
    for (const player of game.roster) {
      player.age = 22
      player.contract = { clubId: 'player', wage: player.contract?.wage ?? 1000, expiresSeason: 5 }
    }
    // 人为把一名替补前锋/外场换上首发，模拟玩家自定义的首发与战术预设。
    const benchOutfield = game.lineup.bench.find((id) => {
      const p = game.roster.find((item) => item.id === id)
      return p && p.positions.GK <= 0
    })!
    const swapSlot = game.lineup.starters.findIndex((s) => s.slotId !== 'gk')
    const oldStarterId = game.lineup.starters[swapSlot].playerId
    game.lineup.starters[swapSlot] = { ...game.lineup.starters[swapSlot], playerId: benchOutfield }
    game.lineup.bench = game.lineup.bench.map((id) => id === benchOutfield ? oldStarterId : id)
    game.lineup.tacticalStyle = 'control'
    game.lineup.matchPlan = 'protectLead'
    game.lineup.presets = [{ id: 'p1', name: '稳守反击', createdAt: 1, lineup: { formationId: game.lineup.formationId, starters: structuredClone(game.lineup.starters), bench: [...game.lineup.bench], tactics: { ...game.lineup.tactics } } }]
    const savedLineup = structuredClone(game.lineup)

    finishSeason(game)
    const rolled = startNextSeason(game, seasonEndAt(game.world!.seasonStartedAt) + 1)
    expect(rolled.ok).toBe(true)
    expect(game.lineup.starters).toEqual(savedLineup.starters)
    expect(game.lineup.bench).toEqual(savedLineup.bench)
    expect(game.lineup.tacticalStyle).toBe('control')
    expect(game.lineup.matchPlan).toBe('protectLead')
    expect(game.lineup.presets).toEqual(savedLineup.presets)

    // 验证 rolloverOwnerlessTeams 保留 AI 原班主力（含随机球员与球星）及其培养卡，不重置回初始 CA。
    const ownerless = createOwnerlessWorld(88)
    const aiClubs = seedAIClubs(ownerless.world, 88)
    const s1Teams = buildOwnerlessTeams(ownerless.world, 88, aiClubs)
    const targetClub = ownerless.world.clubs.find((c) => c.tier === 'champions')!
    const s1Team = s1Teams[targetClub.id]
    const randomIdx = s1Team.players.findIndex((p) => p.era === 'random')
    const starIdx = s1Team.players.findIndex((p) => p.starKey)
    expect(randomIdx).toBeGreaterThanOrEqual(0)
    expect(starIdx).toBeGreaterThanOrEqual(0)
    for (const idx of [randomIdx, starIdx]) {
      const p = s1Team.players[idx]
      for (const key of Object.keys(p.attrs) as (keyof typeof p.attrs)[]) p.attrs[key] = Math.min(99, p.attrs[key] + 25)
    }
    equipAICards(aiClubs[targetClub.id], s1Team.players)
    const randomId = s1Team.players[randomIdx].id
    const randomCaBefore = playerCa(s1Team.players[randomIdx])
    const starId = s1Team.players[starIdx].id
    const starCaBefore = playerCa(s1Team.players[starIdx])

    const nextWorld = structuredClone(ownerless.world)
    nextWorld.seasonIndex = 2
    const s2Teams = rolloverOwnerlessTeams(nextWorld, 99999, s1Teams, aiClubs)
    const s2Team = s2Teams[targetClub.id]
    const keptRandom = s2Team.players.find((p) => p.id === randomId)
    const keptStar = s2Team.players.find((p) => p.id === starId)
    expect(keptRandom).toBeDefined()
    expect(keptStar).toBeDefined()
    expect(playerCa(keptRandom!)).toBeGreaterThanOrEqual(randomCaBefore - 1)
    expect(playerCa(keptStar!)).toBeGreaterThanOrEqual(starCaBefore - 1)
  })
})
