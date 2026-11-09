import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import {
  AI_SEASON_BUY_LIMIT,
  HIGH_OFFER_RATIO,
  UNHAPPY_ENERGY_RATE,
  aiBuysLeft,
  assessRelease,
  minutesShareOf,
  noteAIBuy,
  releaseChance,
} from '../src/game/transfer-rules.ts'
import { aiPoachRound, expireOffers, generateAIOffers, localMarketClubs, respondToOffer, type MarketClub } from '../src/game/transfers.ts'
import { aiBidFor, aiSignFreeAgents, playerValue } from '../src/game/ai-club.ts'
import { previewClubSigning, signClubPlayer } from '../src/game/market.ts'
import { settleEnergy } from '../src/game/energy.ts'
import { startTraining } from '../src/game/actions.ts'
import { catchUpSeason } from '../src/game/season.ts'
import { GAME_DAY_MS, ROUND_MS } from '../src/game/calendar.ts'
import { economyOf } from '../src/game/economy.ts'
import { playerMarketValue } from '../src/game/pricing.ts'
import { createWorldGame } from '../src/game/world.ts'
import type { GameState, Lineup, Player } from '../src/game/types.ts'

const lineupWith = (starters: string[], bench: string[] = []): Pick<Lineup, 'starters' | 'bench'> => ({
  starters: starters.map((playerId, index) => ({ slotId: `s${index}`, playerId, role: 'cm_organizer' })),
  bench,
})

describe('俱乐部放人规则', () => {
  const value = 1_000_000
  it('年轻主力是非卖品；29 岁以上的主力至少多给 30%，当打之年的主力至少多给 50%', () => {
    const young = assessRelease({ player: { id: 'a', age: 22 }, lineup: lineupWith(['a']), value })
    expect(young.status).toBe('key')
    expect(young.requiredPremium).toBeNull()
    expect(young.asking).toBeNull()
    expect(releaseChance(young, value * 3)).toBe(0)
    const veteran = assessRelease({ player: { id: 'a', age: 31 }, lineup: lineupWith(['a']), value })
    expect(veteran.requiredPremium).toBe(0.3)
    expect(veteran.asking).toBe(1_300_000)
    const prime = assessRelease({ player: { id: 'a', age: 27 }, lineup: lineupWith(['a']), value })
    expect(prime.requiredPremium).toBe(0.5)
  })

  it('年轻主力最近很少上场时可以谈；冷板凳多给 5% 就能谈；轮换按出场时间要价', () => {
    const benchedYoung = assessRelease({ player: { id: 'a', age: 21 }, lineup: lineupWith(['a']), minutes: Array(20).fill(20), value })
    expect(benchedYoung.status).not.toBe('key')
    expect(benchedYoung.requiredPremium).not.toBeNull()
    const fringe = assessRelease({ player: { id: 'b', age: 26 }, lineup: lineupWith(['x']), minutes: Array(20).fill(0), value })
    expect(fringe.status).toBe('fringe')
    expect(fringe.requiredPremium).toBe(0.05)
    expect(releaseChance(fringe, 1_050_000)).toBeGreaterThanOrEqual(0.8)
    const rotation = assessRelease({ player: { id: 'c', age: 26 }, lineup: lineupWith(['x'], ['c']), minutes: Array(20).fill(45), value })
    expect(rotation.status).toBe('rotation')
    expect(rotation.requiredPremium).toBeCloseTo(0.1 + 0.3 * 0.5, 5)
    const youngRotation = assessRelease({ player: { id: 'c', age: 20 }, lineup: lineupWith(['x'], ['c']), minutes: Array(20).fill(45), value })
    expect(youngRotation.requiredPremium).toBeCloseTo(0.1 + 0.3 * 0.5 + 0.1, 5)
  })

  it('低于要价一律不谈；达到要价后溢价越多越容易成交', () => {
    const veteran = assessRelease({ player: { id: 'a', age: 33 }, lineup: lineupWith(['a']), value })
    expect(releaseChance(veteran, 1_299_000)).toBe(0)
    const atAsking = releaseChance(veteran, 1_300_000)
    const more = releaseChance(veteran, 1_500_000)
    expect(atAsking).toBeGreaterThan(0)
    expect(more).toBeGreaterThan(atAsking)
  })

  it('出场时间：5 场以上记录按记录算（不足 20 场用阵容估算补齐），否则按阵容角色估算', () => {
    expect(minutesShareOf(undefined, lineupWith(['a']), 'a').share).toBeGreaterThan(0.85)
    expect(minutesShareOf([90, 90], lineupWith([], []), 'a').share).toBe(0)
    expect(minutesShareOf(Array(20).fill(45), lineupWith([]), 'a').share).toBeCloseTo(0.5, 5)
    expect(minutesShareOf(Array(10).fill(90), lineupWith([]), 'a').share).toBeCloseTo(0.5, 5)
  })
})

/** 找一名肯定能买到、而且买得起的冷板凳球员：俱乐部和球员两关的概率都封顶。 */
function easyTarget(game: GameState, budget = Infinity): { teamId: string; player: Player; offer: number } {
  const candidates = game.aiTeams
    .flatMap((team) => team.players.map((player) => ({ team, player, offer: Math.ceil(playerMarketValue(player) * 1.6 / 1000) * 1000 })))
    .filter((item) => item.offer <= budget)
    .sort((a, b) => a.offer - b.offer)
  for (const { team, player, offer } of candidates) {
    const preview = previewClubSigning(game, team, player, offer, { goal: 'title', role: 'star' })
    if (preview.club.status === 'fringe' && preview.club.chance >= 0.97 && preview.player.chance >= 0.98) return { teamId: team.id, player, offer }
  }
  throw new Error('没有找到合适的球员')
}

describe('玩家向 AI 球队买人', () => {
  it('非卖品和低于要价的报价直接拒绝；成交后人离开对方、钱进对方账本、不占对方买人名额', () => {
    const game = createWorldGame(2101)
    const team = game.aiTeams[0]
    const youngStarter = team.players.find((player) => (player.age ?? 24) <= 24 && team.lineup.starters.some((starter) => starter.playerId === player.id))
    if (youngStarter) expect(signClubPlayer(game, team.id, youngStarter.id, 99_000_000, { goal: 'title', role: 'star' })).toMatchObject({ ok: false, error: expect.stringContaining('非卖品') })
    economyOf(game).balance = 100_000_000
    const { teamId, player, offer } = easyTarget(game)
    expect(signClubPlayer(game, teamId, player.id, Math.floor(playerMarketValue(player) * 0.9), { goal: 'title', role: 'star' })).toMatchObject({ ok: false, error: expect.stringContaining('要价') })
    const seller = game.aiClubs![teamId]
    const sellerBefore = seller.economy.balance
    const result = signClubPlayer(game, teamId, player.id, offer, { goal: 'title', role: 'star' })
    expect(result.ok, result.error).toBe(true)
    expect(game.roster.some((item) => item.id === player.id)).toBe(true)
    expect(game.aiTeams.find((item) => item.id === teamId)!.players.some((item) => item.id === player.id)).toBe(false)
    expect(seller.economy.balance).toBe(sellerBefore + offer)
    expect(aiBuysLeft(seller, game.season.index)).toBe(AI_SEASON_BUY_LIMIT)
  })

  it('对方阵容只剩一套比赛名单（18 人）时不再放人', () => {
    const game = createWorldGame(2102)
    economyOf(game).balance = 100_000_000
    const { teamId, player, offer } = easyTarget(game)
    const team = game.aiTeams.find((item) => item.id === teamId)!
    team.players = [player, ...team.players.filter((item) => item.id !== player.id)].slice(0, 18)
    expect(signClubPlayer(game, teamId, player.id, offer, { goal: 'title', role: 'star' })).toMatchObject({ ok: false, error: expect.stringContaining('不再放人') })
  })
})

describe('AI 每赛季最多买 5 人', () => {
  it('名额用完后不再出价，也不再签自由球员', () => {
    const game = createWorldGame(2201)
    const club = localMarketClubs(game)[0]
    for (let index = 0; index < AI_SEASON_BUY_LIMIT; index++) noteAIBuy(club.state, game.season.index)
    expect(aiBuysLeft(club.state, game.season.index)).toBe(0)
    // 换赛季名额自动重置
    expect(aiBuysLeft(club.state, game.season.index + 1)).toBe(AI_SEASON_BUY_LIMIT)
    const player = game.freeStars[0]
    club.state.economy.balance = 100_000_000
    expect(aiBidFor({ state: club.state, tier: club.tier, player, squad: [], value: playerValue(player), minimum: playerValue(player), buysLeft: 0 })).toBeNull()
    for (const state of Object.values(game.aiClubs!)) for (let index = 0; index < AI_SEASON_BUY_LIMIT; index++) noteAIBuy(state, game.season.index)
    const before = game.freeStars.length
    for (let round = 1; round <= 10; round++) aiSignFreeAgents(game, round)
    expect(game.freeStars.length).toBe(before)
  })
})

/** 让一家 AI 缺前锋、钱很多：它就会去别的 AI 球队挖前锋。 */
function hungryClubs(seed: number): { game: GameState; clubs: MarketClub[]; buyer: MarketClub } {
  const game = createWorldGame(seed)
  const clubs = localMarketClubs(game)
  const buyer = clubs[0]
  buyer.team.players = buyer.team.players.filter((player) => !(player.positions.ST >= 70))
  buyer.state.economy.balance = 200_000_000
  return { game, clubs, buyer }
}

describe('AI 之间挖人', () => {
  it('按需向其他 AI 球队报价，卖方按放人规则放人；买方占名额、付钱，卖方收钱', () => {
    const { game, clubs, buyer } = hungryClubs(2301)
    const balances = new Map(clubs.map((club) => [club.id, club.state.economy.balance]))
    const all: ReturnType<typeof aiPoachRound> = []
    for (let round = 1; round <= 60 && !all.some((move) => move.buyerId === buyer.id); round++) {
      all.push(...aiPoachRound({ clubs, season: game.season.index, round, seed: game.seed, appearances: game.appearances, maxMoves: 3 }))
    }
    const move = all.find((item) => item.buyerId === buyer.id)
    expect(move).toBeDefined()
    expect(buyer.team.players.some((player) => player.id === move!.playerId)).toBe(true)
    const seller = clubs.find((club) => club.id === move!.sellerId)!
    expect(seller.team.players.some((player) => player.id === move!.playerId)).toBe(false)
    // 账本对得上：每家 = 原来的钱 + 卖人收入 − 买人支出
    for (const club of clubs) {
      const received = all.filter((item) => item.sellerId === club.id).reduce((sum, item) => sum + item.amount, 0)
      const paid = all.filter((item) => item.buyerId === club.id).reduce((sum, item) => sum + item.amount, 0)
      expect(club.state.economy.balance, club.name).toBe(balances.get(club.id)! + received - paid)
    }
    expect(aiBuysLeft(buyer.state, game.season.index)).toBeLessThan(AI_SEASON_BUY_LIMIT)
  })

  it('不论挖多少轮，每家 AI 一个赛季最多买进 5 人', () => {
    const { game, clubs } = hungryClubs(2302)
    for (const club of clubs) club.state.economy.balance = 500_000_000
    for (let round = 1; round <= 200; round++) aiPoachRound({ clubs, season: game.season.index, round, seed: game.seed, maxMoves: 5 })
    for (const club of clubs) expect(aiBuysLeft(club.state, game.season.index)).toBeGreaterThanOrEqual(0)
    for (const club of clubs) expect(club.state.transfers?.bought ?? 0).toBeLessThanOrEqual(AI_SEASON_BUY_LIMIT)
  })
})

/** 一直推轮次直到 AI 给玩家报价（只在转会窗口里）。 */
function firstOffer(game: GameState, clubs: MarketClub[], now: number) {
  economyOf(game)
  for (const club of clubs) club.state.economy.balance = 300_000_000
  for (let round = 1; round <= 200; round++) {
    const offer = generateAIOffers({ game, clubs, season: game.season.index, round, now, seed: game.seed })
    if (offer) return offer
  }
  throw new Error('没有收到报价')
}

describe('AI 给玩家报价', () => {
  it('接受：球员去对方，钱到账，对方占一个买人名额；同一名球员的其他报价撤回', () => {
    const game = createWorldGame(2401)
    const clubs = localMarketClubs(game)
    const now = Date.now()
    const offer = firstOffer(game, clubs, now)
    expect(offer.expiresAt - offer.createdAt).toBe(4 * GAME_DAY_MS)
    const buyer = clubs.find((club) => club.id === offer.clubId)!
    const balance = economyOf(game).balance
    const result = respondToOffer(game, offer.id, true, now + 1000, buyer, game.season.index)
    expect(result.ok, result.error).toBe(true)
    expect(game.roster.some((player) => player.id === offer.playerId)).toBe(false)
    expect(buyer.team.players.some((player) => player.id === offer.playerId)).toBe(true)
    expect(economyOf(game).balance).toBe(balance + offer.amount)
    expect(aiBuysLeft(buyer.state, game.season.index)).toBe(AI_SEASON_BUY_LIMIT - 1)
    expect(respondToOffer(game, offer.id, true, now + 2000, buyer, game.season.index).ok).toBe(false)
  })

  it('拒绝高价报价：球员不满 8 个游戏日，精力恢复只剩一成；拒绝普通报价没有影响', () => {
    const game = createWorldGame(2402)
    const clubs = localMarketClubs(game)
    const now = Date.now()
    const offer = firstOffer(game, clubs, now)
    offer.amount = Math.ceil(offer.value * HIGH_OFFER_RATIO)
    const player = game.roster.find((item) => item.id === offer.playerId)!
    const result = respondToOffer(game, offer.id, false, now, clubs.find((club) => club.id === offer.clubId), game.season.index)
    expect(result).toMatchObject({ ok: true, unhappy: true })
    expect(player.unhappy?.until).toBe(now + 8 * GAME_DAY_MS)
    player.energy = 0
    player.energyAt = now
    settleEnergy(player, now + GAME_DAY_MS)
    expect(player.energy).toBeCloseTo(50 * UNHAPPY_ENERGY_RATE, 5)
    // 不满结束后恢复正常速度
    settleEnergy(player, now + 9 * GAME_DAY_MS)
    expect(player.unhappy).toBeUndefined()
    expect(player.energy).toBeGreaterThan(30)

    const calm = firstOffer(game, clubs, now)
    calm.amount = Math.floor(calm.value * 1.1)
    const other = game.roster.find((item) => item.id === calm.playerId)!
    delete other.unhappy
    expect(respondToOffer(game, calm.id, false, now, undefined, game.season.index)).toMatchObject({ ok: true, unhappy: false })
    expect(other.unhappy).toBeUndefined()
  })

  it('4 个游戏日内不回复算拒绝（高价同样会不满）；转会窗口关闭时对方撤回', () => {
    const game = createWorldGame(2403)
    const clubs = localMarketClubs(game)
    const now = Date.now()
    const offer = firstOffer(game, clubs, now)
    offer.amount = Math.ceil(offer.value * 1.5)
    expireOffers(game, offer.expiresAt - 1)
    expect(offer.status).toBe('pending')
    expireOffers(game, offer.expiresAt)
    expect(offer.status).toBe('expired')
    expect(game.roster.find((item) => item.id === offer.playerId)!.unhappy).toBeDefined()

    const next = firstOffer(game, clubs, now)
    game.season.round = 15
    expireOffers(game, now)
    expect(next.status).toBe('withdrawn')
  })
})

describe('训练精力', () => {
  it('每个游戏日恢复 50 点、按时间连续恢复；第一次结算只记时间', () => {
    const game = createWorldGame(2501)
    const player = game.roster[0]
    const now = Date.now()
    player.energy = 0
    delete player.energyAt
    settleEnergy(player, now)
    expect(player.energy).toBe(0)
    settleEnergy(player, now + GAME_DAY_MS / 2)
    expect(player.energy).toBeCloseTo(25, 5)
    settleEnergy(player, now + 3 * GAME_DAY_MS)
    expect(player.energy).toBe(100)
  })

  it('精力不足时不能开培养，等到够 30 点就可以', () => {
    const game = createWorldGame(2502)
    const player = game.roster[0]
    player.energy = 0
    player.energyAt = Date.now()
    expect(startTraining(game, player.id).ok).toBe(false)
    player.energyAt = Date.now() - 0.7 * GAME_DAY_MS
    expect(startTraining(game, player.id).ok).toBe(true)
  })
})

describe('出场记录', () => {
  it('联赛踢完后两队整个名单都记一笔出场分钟，最多留 20 场', () => {
    const game = createWorldGame(2601)
    game.season.startedAt -= 24 * ROUND_MS
    if (game.world) game.world.seasonStartedAt = game.season.startedAt
    catchUpSeason(game)
    const book = game.appearances ?? {}
    expect(Object.keys(book).length).toBeGreaterThan(game.roster.length)
    for (const minutes of Object.values(book)) expect(minutes.length).toBeLessThanOrEqual(20)
    expect(game.roster.every((player) => (book[player.id]?.length ?? 0) >= 20)).toBe(true)
  }, 300_000)
})

const servers: AppServer[] = []
afterEach(() => { while (servers.length) servers.pop()!.close() })

describe('联机：向 AI 球队买人走服务器', () => {
  it('转会接口成交后共享名册同步；普通保存不能直接把 AI 球员加进阵容', async () => {
    const app = createAppServer({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'fm-transfer-')), staticDir: path.resolve('dist'), tickMs: 0 })
    servers.push(app)
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
    const registered = await (await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'buyer', password: 'secret123' }) })).json() as { token: string; game: GameState; revision: number }
    const headers = { Authorization: `Bearer ${registered.token}`, 'Content-Type': 'application/json' }

    // 普通保存偷偷把 AI 球员塞进阵容：拒绝
    const current = await (await fetch(`${base}/api/game`, { headers })).json() as { game: GameState; revision: number }
    const sneak = structuredClone(current.game)
    sneak.roster.push(structuredClone(sneak.aiTeams[0].players.at(-1)!))
    const sneaked = await fetch(`${base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game: sneak, baseRevision: current.revision }) })
    expect(sneaked.status).toBe(400)

    const balance = economyOf(current.game).balance
    const { teamId, player, offer } = easyTarget(current.game, balance)
    const bought = await fetch(`${base}/api/transfer/ai-buy`, { method: 'POST', headers, body: JSON.stringify({ teamId, playerId: player.id, offer, goal: 'title', role: 'star' }) })
    const body = await bought.json() as { ok: boolean; error?: string; game: GameState }
    expect(bought.status, body.error).toBe(200)
    expect(body.game.roster.some((item) => item.id === player.id)).toBe(true)
    expect(economyOf(body.game).balance).toBe(balance - offer)
    const world = await (await fetch(`${base}/api/world/teams`, { headers })).json() as { clubs: { id: string; players: { id: string }[] }[] }
    expect(world.clubs.find((club) => club.id === teamId)!.players.some((item) => item.id === player.id)).toBe(false)
  })
})
