import { describe, expect, it } from 'vitest'
import { analyzeAIDepth } from '../src/game/ai-depth.ts'
import { aiBidFor, aiSignFreeAgents, aiTierProfile, releaseDepthSurplus } from '../src/game/ai-club.ts'
import { runAIAuctionMarket } from '../src/game/ai-auction-market.ts'
import { minimumBid, type FreeMarket, leadingBid } from '../src/game/auction.ts'
import { generateAIOffers, localMarketClubs } from '../src/game/transfers.ts'
import { DEFAULT_FORMATION, FORMATIONS } from '../src/game/data/formations.ts'
import { DETAILED_POSITIONS, DETAILED_TO_POSITION, detailedPositionForSlot } from '../src/game/detailed-positions.ts'
import { attrStorage } from '../src/game/scale.ts'
import { refreshAILineup } from '../src/game/squad.ts'
import { refreshFreeMarket } from '../src/game/free-market.ts'
import { createWorldGame } from '../src/game/world.ts'
import type { DetailedPosition, Player } from '../src/game/types.ts'

function setup() {
  const game = createWorldGame(9021), club = localMarketClubs(game)[0]
  const slots = FORMATIONS[DEFAULT_FORMATION].slots.map(detailedPositionForSlot)
  const sample = club.team.players.find(p => !p.starKey && !p.positions.GK)!
  function player(id: string, roles: DetailedPosition[], attr = 35) {
    const p = structuredClone(sample)
    p.id = p.name = id; p.positions = { GK: 0, CB: 0, CM: 0, W: 0, ST: 0 }
    p.detailedPositions = Object.fromEntries(DETAILED_POSITIONS.map(pos => [pos, roles.includes(pos) ? 100 : 0]))
    for (const pos of roles) p.positions[DETAILED_TO_POSITION[pos]] = 100
    for (const key of Object.keys(p.attrs) as (keyof Player['attrs'])[]) p.attrs[key] = attrStorage(key, attr, roles.includes('GK'))
    p.baseAttrs = { ...p.attrs }; p.basePositions = { ...p.positions }; p.baseDetailedPositions = { ...p.detailedPositions }
    return p
  }
  /** 按目标身价（近似）构造一个指定位置的球员，用于验证均摊预算挡位选择。 */
  function playerPriced(id: string, roles: DetailedPosition[], targetPrice: number) {
    let lo = 10, hi = 95, best = player(id, roles, 35)
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2
      const cand = player(id, roles, mid)
      const price = minimumBid(cand)
      if (Math.abs(price - targetPrice) < Math.abs(minimumBid(best) - targetPrice)) best = cand
      if (price < targetPrice) lo = mid
      else hi = mid
    }
    return best
  }
  club.team.lineup.formationId = DEFAULT_FORMATION
  club.team.players = [...slots, ...slots].map((pos, i) => player(String(i), [pos]))
  refreshAILineup(club.team)
  club.state.economy.balance = 200_000_000
  const worldClub = game.world!.clubs.find(c => c.id === club.id)!
  return { game, club, worldClub, slots, player, playerPriced }
}

describe('AI 的两套阵容与市场', () => {
  it('一个多面手只能占一个席位；购买能接替他原位置的人也可以填补缺口', () => {
    const { club, player } = setup()
    expect(analyzeAIDepth(club.team).missing).toBe(0)
    club.team.players = club.team.players.filter(p => !p.detailedPositions?.DL)
    club.team.players.push(player('flex', ['DL', 'DR']))
    const depth = analyzeAIDepth(club.team)
    expect(depth.missing).toBe(1)
    expect(depth.improves(player('left', ['DL']))).toBe(true)
    expect(depth.improves(player('keeper', ['GK']))).toBe(false)
    expect(depth.expendable.has('flex')).toBe(false)
  })

  it('补完一套替补前按剩余缺口均摊预算并买最强：100万差5人买5个20万，500万差5人买5个100万', () => {
    const gaps: DetailedPosition[] = ['GK', 'DL', 'DR', 'ML', 'MR']
    for (const { spendable, expectedTier } of [
      { spendable: 1_000_000, expectedTier: '20万' },
      { spendable: 5_000_000, expectedTier: '100万' },
    ]) {
      const { club, playerPriced } = setup()
      for (const pos of gaps) {
        const idx = club.team.players.findIndex(p => p.detailedPositions?.[pos] === 100)
        expect(idx, `missing slot ${pos}`).toBeGreaterThanOrEqual(0)
        club.team.players.splice(idx, 1)
      }
      expect(analyzeAIDepth(club.team).missing).toBe(5)
      const reserve = aiTierProfile(club.tier).reserve
      club.state.economy.balance = reserve + spendable

      const pool: Player[] = []
      for (const pos of gaps) {
        pool.push(
          playerPriced(`${pos}-8万`, [pos], 80_000),
          playerPriced(`${pos}-20万`, [pos], 195_000),
          playerPriced(`${pos}-100万`, [pos], 980_000),
          playerPriced(`${pos}-300万`, [pos], 3_000_000),
        )
      }
      // 场上不缺的前锋即使更强、且在预算内，也不能在补齐两套前优先买。
      pool.push(playerPriced('不缺的强前锋', ['ST'], 180_000))

      const market: FreeMarket = { pool, version: 1, auctions: [], log: [] }
      expect(runAIAuctionMarket(market, [club], 1, 100, () => true).bids).toBe(5)
      expect(market.auctions).toHaveLength(5)
      const pickedIds = market.auctions.map(a => a.playerId)
      expect(pickedIds.every(id => id.endsWith(`-${expectedTier}`))).toBe(true)
      expect(pickedIds).not.toContain('不缺的强前锋')
    }
  })

  it('单机自由市场同样按剩余缺口均摊预算买最强，补齐一套完整替补后才在后续考虑补强', () => {
    const gaps: DetailedPosition[] = ['GK', 'DL', 'DR', 'ML', 'MR']
    const { game, club, playerPriced } = setup()
    game.aiTeams = [club.team]
    for (const pos of gaps) {
      const idx = club.team.players.findIndex(p => p.detailedPositions?.[pos] === 100)
      expect(idx, `missing slot ${pos}`).toBeGreaterThanOrEqual(0)
      club.team.players.splice(idx, 1)
    }
    const reserve = aiTierProfile(club.tier).reserve
    club.state.economy.balance = reserve + 1_000_000

    const nonGapStar = playerPriced('不缺的超级前锋', ['ST'], 500_000)
    const pool: Player[] = [nonGapStar]
    for (const pos of gaps) {
      pool.push(
        playerPriced(`${pos}-8万`, [pos], 80_000),
        playerPriced(`${pos}-20万`, [pos], 195_000),
        playerPriced(`${pos}-100万`, [pos], 980_000),
      )
    }
    game.freeStars = pool
    const now = Date.now()
    for (const p of game.freeStars) p.releasedToMarket = true

    const signed = aiSignFreeAgents(game, 1, now)
    expect(signed).toBe(5)
    expect(analyzeAIDepth(club.team).missing).toBe(0)
    const added = club.team.players.filter(p => p.id.includes('-'))
    expect(added).toHaveLength(5)
    expect(added.every(p => p.id.endsWith('-20万'))).toBe(true)
    expect(club.team.players.some(p => p.id === nonGapStar.id)).toBe(false)

    // 补齐两套且下赛季有名额、有余钱后，才会考虑买不缺位置的补强球星。
    club.state.economy.balance = reserve + 5_000_000
    game.season.index += 1
    expect(aiSignFreeAgents(game, 2, now)).toBeGreaterThanOrEqual(1)
    expect(club.team.players.some(p => p.id === nonGapStar.id)).toBe(true)
  })

  it('先补缺再挑预算内最强：预算足够买强门将、预算吃紧时低 CA 门将不拦截且会跟价', () => {
    const { club, player } = setup()
    club.team.players.splice(club.team.players.findIndex(p => p.positions.GK > 0), 1)
    const cheap = player('低价替补', ['GK'], 30), strong = player('强门将', ['GK'], 55), other = player('不缺的强前锋', ['ST'], 70)
    expect(minimumBid(cheap)).toBeLessThan(minimumBid(strong))
    const now = 100

    // 资金充足时优先买能补位的强门将，跳过更强但不缺位的前锋。
    const richMarket: FreeMarket = { pool: [strong, other, cheap], version: 1, auctions: [], log: [] }
    expect(runAIAuctionMarket(richMarket, [club], 1, now, () => true).bids).toBe(1)
    expect(richMarket.auctions).toHaveLength(1)
    expect(richMarket.auctions[0].playerId).toBe(strong.id)

    // 资金只够低价门将（含跟价）时，仍会接低 CA 门将且愿意跟价，不会因 CA 低放弃。
    const reserve = aiTierProfile(club.tier).reserve
    const raisePrice = Math.ceil(minimumBid(cheap) * 1.05)
    const tightClub = { ...club, state: { ...club.state, economy: { ...club.state.economy, balance: reserve + raisePrice + 5000 } } }
    const tightMarket: FreeMarket = { pool: [strong, other, cheap], version: 1, auctions: [], log: [] }
    tightMarket.auctions.push({ playerId: cheap.id, playerName: cheap.name, startedAt: now, endsAt: now + 3600000, bids: [{ accountId: 'coach', club: '玩家', at: now, amount: minimumBid(cheap) }] })
    expect(runAIAuctionMarket(tightMarket, [tightClub], 1, now, () => true).bids).toBe(1)
    expect(tightMarket.auctions).toHaveLength(1)
    expect(leadingBid(tightMarket.auctions[0]).accountId).toBe(`ai:${tightClub.id}`)

    const poor = { ...club.state, economy: { ...club.state.economy, balance: 0 } }
    expect(aiBidFor({ state: poor, tier: club.tier, squad: club.team.players, depth: analyzeAIDepth(club.team), player: cheap, value: 1000, minimum: 1000 })).toBeNull()
  })

  it('玩家队里同样按缺位均摊预算并挑最强，四家 AI 可以同时求购同一目标', () => {
    const { club, game, player, playerPriced } = setup()
    club.team.players.splice(club.team.players.findIndex(p => p.positions.GK > 0), 1)
    const cheaper = playerPriced('替补门将', ['GK'], 150_000), higher = playerPriced('明星门将', ['GK'], 800_000)
    game.roster = [...Array.from({ length: 20 }, (_, i) => player('前锋' + i, ['ST'], 60)), higher, cheaper]
    const clubs = Array.from({ length: 4 }, (_, i) => ({ ...club, id: `b${i}` }))
    generateAIOffers({ game, clubs, season: 1, round: 1, seed: 1, now: 100 })
    expect(game.transferOffers).toHaveLength(4)
    expect(game.transferOffers!.every(o => o.playerId === higher.id)).toBe(true)

    // 当买家差 5 个名额且可用资金只有 100 万（单名额预算 20 万）时，转向预算内的替补门将。
    const gaps: DetailedPosition[] = ['DL', 'DR', 'ML', 'MR']
    for (const pos of gaps) {
      const idx = club.team.players.findIndex(p => p.detailedPositions?.[pos] === 100)
      expect(idx, `missing slot ${pos}`).toBeGreaterThanOrEqual(0)
      club.team.players.splice(idx, 1)
    }
    expect(analyzeAIDepth(club.team).missing).toBe(5)
    club.state.economy.balance = aiTierProfile(club.tier).reserve + 1_000_000
    game.transferOffers = []
    generateAIOffers({ game, clubs: [{ ...club, id: 'tight' }], season: 1, round: 2, seed: 1, now: 200 })
    expect(game.transferOffers).toHaveLength(1)
    expect(game.transferOffers![0].playerId).toBe(cheaper.id)
  })

  it('释放冗员不破坏位置覆盖，解约无收入、只入池一次；超过200人不裁市场球员', () => {
    const { club, game, worldClub, player } = setup()
    club.team.players.splice(club.team.players.findIndex(p => p.positions.GK > 0), 1)
    club.team.players.push(...Array.from({ length: 4 }, (_, i) => player('富余前锋' + i, ['ST'], 20)))
    refreshAILineup(club.team)
    const pool = Array.from({ length: 201 }, (_, i) => player('市场' + i, ['ST']))
    const before = club.state.economy.balance, depth = analyzeAIDepth(club.team)
    const p = releaseDepthSurplus(club.team, club.state, worldClub, pool, 1, 1)!
    expect(p.releasedToMarket).toBe(true); expect(p.marketDay).toBeUndefined()
    expect(club.team.players.some(x => x.id === p.id)).toBe(false)
    expect(analyzeAIDepth(club.team).missing).toBe(depth.missing)
    expect(club.state.economy.balance).toBe(before)
    expect(releaseDepthSurplus(club.team, club.state, worldClub, pool, 1, 1)).toBeUndefined()
    const result = refreshFreeMarket({ pool, anchor: game, now: Date.now(), seed: 1 })
    expect(result.changed).toBe(false); expect(result.pool).toHaveLength(202)
    expect(result.pool.filter(x => x.id === p.id)).toHaveLength(1)
  })
})
