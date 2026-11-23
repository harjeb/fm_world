import { AI_SQUAD_LIMIT, aiBidFor, strongestFirst } from './ai-club.ts'
import { analyzeAIDepth } from './ai-depth.ts'
import { AI_MAX_BIDS, auctionRaiseFee, leadingBid, minimumBid, placeAIBid, type FreeMarket } from './auction.ts'
import { caOf } from './ca.ts'
import { untrainedPlayer } from './cards.ts'
import { aiBuysLeft } from './transfer-rules.ts'
import type { MarketClub } from './transfers.ts'
import type { Player } from './types.ts'

/** 每次市场决策所有球队都有一轮选择。开拍与跟价同榜比价，无全服同时竞拍数限制。 */
export function runAIAuctionMarket(market: FreeMarket, clubs: MarketClub[], season: number, now: number, available: (p: Player) => boolean): { bids: number; fees: number } {
  let bids = 0, fees = 0
  const auctions = new Map(market.auctions.map(a => [a.playerId, a]))
  const targets = market.pool.filter(p => auctions.has(p.id) || available(p)).map(p => {
    const player = untrainedPlayer(p)
    return { player, value: minimumBid(p), ca: caOf(player.attrs, player.positions.GK > 0) }
  })
  const byId = new Map(targets.map(t => [t.player.id, t.player]))
  for (const club of clubs) {
    const id = `ai:${club.id}`
    for (;;) {
      const leads = market.auctions.filter(a => leadingBid(a).accountId === id)
      const held = club.pendingSignings ?? []
      const buysLeft = aiBuysLeft(club.state, season, leads.length + held.length)
      if (!buysLeft || club.team.players.length + leads.length + held.length >= AI_SQUAD_LIMIT) break
      const committed = leads.reduce((sum, a) => sum + leadingBid(a).amount, club.committed ?? 0)
      // 在途领先的新援先算作占位，否则一家球队会同时抢五个替补门将。
      const squad = [...club.team.players, ...held, ...leads.flatMap(a => byId.get(a.playerId) ?? [])]
      const depth = analyzeAIDepth({ lineup: club.team.lineup, players: squad })
      // 补位的报价还未结算时，不提前按已齐两套去追补强。
      if (!depth.missing && (leads.length || held.length)) break
      const ranked = targets.flatMap(t => {
        const a = auctions.get(t.player.id)
        if (!t.value || (depth.missing && !depth.improves(t.player)) || (a && (a.endsAt <= now || leadingBid(a).accountId === id || a.bids.filter(b => b.accountId === id).length >= AI_MAX_BIDS))) return []
        const price = a ? minimumBid(t.player, a) : t.value
        return [{ ...t, price, auction: a }]
      }).sort(strongestFirst)
      let placed = false
      for (const { player, price, value, auction } of ranked) {
        const fee = auction ? auctionRaiseFee(price) : 0
        const plan = aiBidFor({ state: club.state, tier: club.tier, squad, depth, player, value, minimum: price, rival: auction ? leadingBid(auction).amount : null, committed: committed + fee, buysLeft })
        if (plan === null) continue
        const bid = placeAIBid(market, club, player.id, price, now)
        if (!bid.ok) continue
        auctions.set(player.id, bid.auction)
        fees += bid.fee; club.state.economy.balance -= bid.fee
        placed = true; bids++
        break
      }
      if (!placed) break
    }
  }
  return { bids, fees }
}
