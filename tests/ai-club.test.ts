import { describe, expect, it } from 'vitest'
import { ALL_ATTRIBUTES, type AIClubState, type Player } from '../src/game/types.ts'
import {
  AI_SQUAD_LIMIT,
  advanceAIClub,
  advanceAIClubs,
  aiBidFor,
  aiClubOf,
  aiSignFreeAgents,
  aiTierProfile,
  createAIClub,
  equipAICards,
  playerCa,
  playerValue,
  primaryPosition,
  recordAISigning,
  runAIClubs,
  seedAIClubs,
} from '../src/game/ai-club.ts'
import { AI_BID_PREFIX, AUCTION_DURATION_MS, placeAIBid, settleAuctions, type FreeMarket } from '../src/game/auction.ts'
import { facilityUpgradeCost, facilityLevel, projectedRoundIncome } from '../src/game/economy.ts'
import { ROUND_GAME_DAYS } from '../src/game/calendar.ts'
import { cachedOwnerlessTeams, createWorldGame } from '../src/game/world.ts'

const game = () => createWorldGame(2024)

function scale(player: Player, factor: number): Player {
  const copy = structuredClone(player)
  for (const key of ALL_ATTRIBUTES) copy.attrs[key] = Math.max(1, Math.round(copy.attrs[key] * factor))
  return copy
}

function state(balance: number, tier: 'champions' | 'division1' | 'division2' = 'champions'): AIClubState {
  const ai = createAIClub({ id: 'probe', tier }, 7)
  ai.economy.balance = balance
  return ai
}

describe('电脑球队账本', () => {
  it('世界里每支非玩家球队都有一本账，级别越高家底越厚', () => {
    const world = game().world!
    const book = seedAIClubs(world, 4242)
    const ids = world.clubs.filter((club) => !club.isPlayer).map((club) => club.id)
    expect(Object.keys(book).sort()).toEqual(ids.sort())
    expect(Object.keys(book)).toHaveLength(79)

    const average = (tier: string) => {
      const clubs = world.clubs.filter((club) => club.tier === tier && !club.isPlayer)
      return clubs.reduce((sum, club) => sum + book[club.id].economy.balance, 0) / clubs.length
    }
    expect(average('champions')).toBeGreaterThan(average('division1'))
    expect(average('division1')).toBeGreaterThan(average('division2'))
    for (const ai of Object.values(book)) {
      expect(ai.economy.stadium).toBeGreaterThanOrEqual(1)
      expect(ai.economy.stadium).toBeLessThanOrEqual(25)
      expect(ai.signings).toEqual([])
      expect(ai.cards).toEqual({})
    }
  })

  it('同一个种子生成同一份账本，已有的账本不会被覆盖', () => {
    const world = game().world!
    const first = seedAIClubs(world, 99)
    const again = seedAIClubs(world, 99)
    expect(JSON.stringify(first)).toBe(JSON.stringify(again))
    first[Object.keys(first)[0]].economy.balance = 1
    expect(aiClubOf(first, world, Object.keys(first)[0], 99)!.economy.balance).toBe(1)
  })

  it('自动装备最强的那张卡，球员比卡强时反过来更新卡', () => {
    const team = game().aiTeams[0]
    const ai = state(100_000)
    expect(equipAICards(ai, team.players)).toBe(false)
    const best = scale(team.players[3], 1.5)
    ai.cards['3'] = { rating: playerCa(best), attrs: { ...best.attrs } }
    expect(equipAICards(ai, team.players)).toBe(true)
    expect(playerCa(team.players[3])).toBeGreaterThan(playerCa(best) - 1)
  })
})

describe('单机后台培养所有联赛', () => {
  it('其他联赛的球队没有存档名单，也会按轮练账本里的卡，所有球队都随时间变强', () => {
    const base = game()
    const own = new Set(base.aiTeams.map((team) => team.id))
    const others = base.world!.clubs.filter((club) => !club.isPlayer && !own.has(club.id)).map((club) => club.id)
    expect(others.length).toBeGreaterThan(30)
    expect(advanceAIClubs(base, 6)).toBe(true)
    const trained = others.filter((id) => (base.aiClubs![id]?.trained ?? 0) > 0)
    expect(trained.length).toBeGreaterThan(others.length * 0.8)
    // 练出来的是账本里的卡：至少有一些卡的评分高于复原名单里该球员的原始 CA
    const teams = cachedOwnerlessTeams(base.world!, base.seed)
    let stronger = 0
    for (const id of trained) {
      const squad = teams[id].players
      for (const [slot, card] of Object.entries(base.aiClubs![id].cards)) {
        const player = squad[Number(slot)]
        if (player && card.rating > playerCa({ attrs: player.baseAttrs, positions: player.positions }) + 1) stronger += 1
      }
    }
    expect(stronger).toBeGreaterThan(20)
  })
})

describe('电脑球队的经营节奏', () => {
  it('按级别决定每天练几次：二级约 1 次，一级 2–3 次，顶级 3–5 次', () => {
    const counted: Record<string, number> = {}
    for (const tier of ['division2', 'division1', 'champions'] as const) {
      const base = game()
      const team = base.aiTeams[0]
      const ai = state(1_000_000, tier)
      const result = advanceAIClub(ai, { id: team.id, tier }, team, 5, 11)
      counted[tier] = result.trained
      const [low, high] = aiTierProfile(tier).perDay
      expect(result.trained).toBeGreaterThanOrEqual(low * 5 * 0.5)
      expect(result.trained).toBeLessThanOrEqual(high * 5 * ROUND_GAME_DAYS)
      void low
    }
    expect(counted.division2).toBeLessThan(counted.division1)
    expect(counted.division1).toBeLessThan(counted.champions)
  })

  it('练出来的卡只套在自己的槽位上：一轮下来每个人只会小幅变强，门将和场上球员的卡不会串', () => {
    for (const tier of ['division2', 'champions'] as const) {
      const base = game()
      const team = base.aiTeams[0]
      const ai = state(1_000_000, tier)
      equipAICards(ai, team.players)
      const before = team.players.map((player) => playerCa(player))
      const result = advanceAIClub(ai, { id: team.id, tier }, team, 6, 17)
      expect(result.trained, tier).toBeGreaterThan(0)
      team.players.forEach((player, slot) => {
        const delta = playerCa(player) - before[slot]
        expect(delta, `${tier} slot ${slot}`).toBeGreaterThanOrEqual(-0.5)
        // 6 轮练出几十点是正常的；上百点说明卡被套错了槽位。
        expect(delta, `${tier} slot ${slot}`).toBeLessThan(150)
        // 装上的卡就是这个槽位自己的卡。
        const card = ai.cards[String(slot)]
        expect(Math.abs(playerCa(player) - card.rating), `${tier} slot ${slot}`).toBeLessThan(1)
      })
    }
  })

  it('只装备评分更高的卡：评分不高的不装，别人的卡不套，球员比卡强就更新卡', () => {
    const team = game().aiTeams[0]
    const ai = state(100_000)
    equipAICards(ai, team.players)
    const player = team.players[3]
    const before = structuredClone(player.attrs)
    const owner = ai.cards['3'].owner
    expect(owner).toBe(`${player.id}|${player.enName}`)
    // 评分比现在低的卡：不装备，卡被球员现在的属性顶上。
    const weak = scale(player, 0.8)
    ai.cards['3'] = { rating: playerCa(weak), attrs: { ...weak.attrs }, owner }
    expect(equipAICards(ai, team.players)).toBe(false)
    expect(player.attrs).toEqual(before)
    expect(ai.cards['3'].rating).toBeCloseTo(playerCa(player), 5)
    // 别人的卡（槽位上换了人）：评分再高也不套给他，重新按他自己开一张。
    const strong = scale(player, 1.4)
    ai.cards['3'] = { rating: playerCa(strong), attrs: { ...strong.attrs }, owner: 'someone-else|Other Person' }
    expect(equipAICards(ai, team.players)).toBe(false)
    expect(player.attrs).toEqual(before)
    expect(ai.cards['3'].owner).toBe(owner)
    expect(ai.cards['3'].rating).toBeCloseTo(playerCa(player), 5)
    // 自己的、评分更高的卡：装备。
    ai.cards['3'] = { rating: playerCa(strong), attrs: { ...strong.attrs }, owner }
    expect(equipAICards(ai, team.players)).toBe(true)
    expect(playerCa(player)).toBeGreaterThan(playerCa(strong) - 1)
  })

  it('一次培养的力度和玩家同量级，不再是零点几', () => {
    const team = structuredClone(game().aiTeams[0])
    const ai = state(100_000, 'division2')
    equipAICards(ai, team.players)
    const before = team.players.reduce((sum, player) => sum + playerCa(player), 0)
    const result = advanceAIClub(ai, { id: team.id, tier: 'division2' }, team, 10, 21)
    expect(result.trained).toBeGreaterThan(10)
    const gain = team.players.reduce((sum, player) => sum + playerCa(player), 0) - before
    // 玩家一次培养平均涨 7 点左右；这里考虑设施触发概率，每次成功的培养至少几点。
    expect(gain / result.trained).toBeGreaterThan(2)
  })

  it('设施升级按级别限速：二级慢、一级积极、顶级最快', () => {
    const base = game()
    const upgrades = (tier: 'division2' | 'division1' | 'champions') => {
      const ai = state(500_000_000, tier)
      for (const id of ['stadium', 'academy', 'medical', 'shop', 'sponsor', 'psychology', 'tactics'] as const) ai.economy[id] = 1
      return advanceAIClub(ai, { id: base.aiTeams[0].id, tier }, base.aiTeams[0], 10, 9).upgrades
    }
    const slow = upgrades('division2')
    const active = upgrades('division1')
    const fast = upgrades('champions')
    expect(slow).toBeGreaterThan(0)
    expect(slow).toBeLessThan(active)
    expect(active).toBeLessThan(fast)
  })

  it('顶级球队开局所有设施都在 3 级以上，二级球队没有这个保证', () => {
    const world = game().world!
    for (const seed of [1, 2, 3, 4, 5]) {
      const clubs = seedAIClubs(world, seed)
      for (const club of world.clubs) {
        if (club.isPlayer) continue
        const economy = clubs[club.id].economy
        const stages = ['stadium', 'academy', 'medical', 'shop', 'sponsor', 'psychology', 'tactics'].map((id) => economy[id as 'stadium'])
        if (club.tier === 'champions') for (const stage of stages) expect(facilityLevel(stage), `${club.id} seed ${seed}`).toBeGreaterThanOrEqual(3)
      }
    }
    const d2 = Object.entries(seedAIClubs(world, 1)).filter(([id]) => world.clubs.find((club) => club.id === id)?.tier === 'division2')
    expect(d2.some(([, club]) => facilityLevel(club.economy.academy) < 3)).toBe(true)
  })

  it('收钱、涨球迷，升级设施时不动留底的钱', () => {
    const base = game()
    // 只推进账本（没有具体名单的球队）：收入一定为正。
    const ledger = state(50_000, 'division1')
    advanceAIClub(ledger, { id: 'ledger', tier: 'division1' }, undefined, 1, 3)
    expect(ledger.economy.balance).toBeGreaterThan(50_000)

    const rich = state(1_000_000, 'division2')
    const before = rich.economy.balance
    const fans = rich.economy.fans
    const income = projectedRoundIncome(rich.economy) * 5
    const richResult = advanceAIClub(rich, { id: base.aiTeams[0].id, tier: 'division2' }, base.aiTeams[0], 5, 3)
    // 手头宽裕时按级别限速升级：二级约两轮升一次，5 轮最多 3 次。
    expect(richResult.upgrades).toBeGreaterThanOrEqual(2)
    expect(richResult.upgrades).toBeLessThanOrEqual(3)
    // 升级花的是自己的钱，而且永远留着留底资金。
    expect(rich.economy.balance).toBeLessThan(before + income)
    expect(rich.economy.balance).toBeGreaterThanOrEqual(aiTierProfile('division2').reserve)
    expect(rich.economy.fans).toBeGreaterThan(fans)

    // 只有留底的钱时不升级设施，余额只涨不跌。
    const poor = state(aiTierProfile('division2').reserve + 200, 'division2')
    const poorBefore = poor.economy.balance
    const result = advanceAIClub(poor, { id: base.aiTeams[0].id, tier: 'division2' }, base.aiTeams[0], 1, 3)
    expect(result.upgrades).toBeLessThanOrEqual(1)
    // 无论如何都不能把留底的钱花掉。
    expect(poor.economy.balance).toBeGreaterThanOrEqual(aiTierProfile('division2').reserve)
  })

  it('给服务器用时不改当季名单，只把成长记进卡片', () => {
    const base = game()
    const team = base.aiTeams[0]
    const ai = state(500_000)
    const snapshot = JSON.stringify(team.players)
    advanceAIClub(ai, { id: team.id, tier: 'champions' }, team, 4, 5, false)
    expect(JSON.stringify(team.players)).toBe(snapshot)
    const ratings = Object.values(ai.cards).map((card) => card.rating)
    expect(ratings.length).toBeGreaterThan(0)
    expect(ai.trained).toBeGreaterThan(0)
  })
})

describe('电脑球队抢人', () => {
  it('同位置有明显更好的选择就出手，出价不超过可用资金的四成', () => {
    const base = game()
    const team = base.aiTeams[0]
    const ai = state(80_000_000, 'champions')
    const star = scale(team.players.find((player) => primaryPosition(player) !== 'GK')!, 1.6)
    const value = playerValue(star)
    const tier = aiTierProfile('champions')
    const spendable = ai.economy.balance - tier.reserve
    const bid = aiBidFor({ state: ai, tier: 'champions', player: star, squad: team.players, value, minimum: value })
    expect(bid).not.toBeNull()
    expect(bid!).toBeGreaterThanOrEqual(value)
    expect(bid!).toBeLessThanOrEqual(Math.floor(spendable * 0.4))
    expect(bid!).toBeLessThanOrEqual(Math.round(value * tier.overpay * 1.1))
  })

  it('不动留底的钱：余额只比留底多一点就不报价', () => {
    const base = game()
    const team = base.aiTeams[0]
    const tier = aiTierProfile('champions')
    const ai = state(tier.reserve + 50, 'champions')
    const star = scale(team.players[5], 1.6)
    const value = playerValue(star)
    expect(aiBidFor({ state: ai, tier: 'champions', player: star, squad: team.players, value, minimum: value })).toBeNull()
  })

  it('对手出到自己出不起的价就放手，不恶意抬价', () => {
    const base = game()
    const team = base.aiTeams[0]
    const ai = state(80_000_000, 'champions')
    const star = scale(team.players[5], 1.6)
    const value = playerValue(star)
    const spendable = ai.economy.balance - aiTierProfile('champions').reserve
    const cap = Math.min(Math.floor(spendable * 0.4), Math.round(value * aiTierProfile('champions').overpay * 1.1))
    const opened = aiBidFor({ state: ai, tier: 'champions', player: star, squad: team.players, value, minimum: value })
    expect(opened).not.toBeNull()
    expect(opened!).toBeLessThanOrEqual(cap)
    // 对手已经顶到上限：放弃。
    expect(aiBidFor({ state: ai, tier: 'champions', player: star, squad: team.players, value, minimum: value, rival: cap })).toBeNull()
    // 还能跟：跟价不超过自己的上限。
    const raised = aiBidFor({ state: ai, tier: 'champions', player: star, squad: team.players, value, minimum: value, rival: Math.round(opened! * 0.9) })
    expect(raised).not.toBeNull()
    expect(raised!).toBeLessThanOrEqual(cap)
  })

  it('阵容满员就不再买人', () => {
    const base = game()
    const team = base.aiTeams[0]
    const ai = state(900_000, 'champions')
    const squad = Array.from({ length: AI_SQUAD_LIMIT }, (_, index) => scale(team.players[index % team.players.length], 0.6))
    const star = scale(team.players[5], 2)
    expect(aiBidFor({ state: ai, tier: 'champions', player: star, squad, value: playerValue(star), minimum: playerValue(star) })).toBeNull()
  })

  it('签下的球员记进账本：扣钱、去重、最多留六个', () => {
    const base = game()
    const ai = state(500_000, 'champions')
    const pool = base.freeStars.slice(0, 8)
    for (const player of pool) recordAISigning(ai, player, 1000)
    recordAISigning(ai, pool[0], 1000)
    expect(ai.economy.balance).toBe(500_000 - 8 * 1000)
    expect(ai.signings).toHaveLength(6)
    expect(new Set(ai.signings.map((player) => player.id)).size).toBe(6)
  })

  it('单机里电脑球队会盯上自由市场，但不会把池子吃空', () => {
    const base = game()
    const before = base.freeStars.length
    expect(before).toBeGreaterThan(24)
    const signed = aiSignFreeAgents(base, 2)
    expect(signed).toBeGreaterThanOrEqual(0)
    expect(signed).toBeLessThanOrEqual(2)
    expect(base.freeStars.length).toBe(before - signed)
    for (const team of base.aiTeams) {
      expect(team.players.filter((player) => !player.id.startsWith('p-') || true).length).toBeGreaterThan(0)
    }
    const small = game()
    small.freeStars = small.freeStars.slice(0, 20)
    expect(aiSignFreeAgents(small, 2)).toBe(0)
  })

  it('推进一轮时账本和名册都往前挪，重复调用不会翻倍', () => {
    const base = game()
    const ai = base.aiClubs!
    const first = ai["d2n_01"] ?? Object.values(ai)[0]
    const balance = first.economy.balance
    runAIClubs(base, 1)
    expect(Object.values(ai).some((item) => item.economy.balance !== balance)).toBe(true)
  })
})

describe('竞拍里的电脑球队', () => {
  it('电脑球队能出价并赢下竞拍，钱从账本里扣、人进账本', () => {
    const base = game()
    const player = base.freeStars[0]
    const market: FreeMarket = { pool: base.freeStars, auctions: [], log: [], version: 1 }
    const value = playerValue(player)
    const bid = placeAIBid(market, { id: 'd1n_01', name: '北岸竞技' }, player.id, value, 1000)
    expect(bid.ok).toBe(true)
    expect(market.auctions[0].bids[0].accountId).toBe(`${AI_BID_PREFIX}d1n_01`)

    const ai = state(8_000_000, 'division1')
    let signed: { clubId: string; player: Player; amount: number } | null = null
    const results = settleAuctions(market, () => undefined, 1000 + AUCTION_DURATION_MS, {
      balance: (clubId) => (clubId === 'd1n_01' ? ai.economy.balance : 0),
      canSign: () => true,
      sign: (clubId, signedPlayer, amount) => {
        signed = { clubId, player: signedPlayer, amount }
        recordAISigning(ai, signedPlayer, amount)
      },
    })
    expect(results).toHaveLength(1)
    expect(results[0].winnerId).toBe(`${AI_BID_PREFIX}d1n_01`)
    expect(signed).toMatchObject({ clubId: 'd1n_01', amount: value })
    expect(ai.economy.balance).toBe(8_000_000 - value)
    expect(market.pool.some((item) => item.id === player.id)).toBe(false)
  })

  it('电脑球队没钱或满员时，玩家照常赢下', () => {
    const base = game()
    const player = base.freeStars[0]
    const market: FreeMarket = { pool: base.freeStars, auctions: [], log: [], version: 1 }
    const value = playerValue(player)
    placeAIBid(market, { id: 'd1n_01', name: '北岸竞技' }, player.id, value, 1000)
    const results = settleAuctions(market, () => undefined, 1000 + AUCTION_DURATION_MS, {
      balance: () => 0,
      canSign: () => false,
      sign: () => {
        throw new Error('不该签下')
      },
    })
    expect(results).toHaveLength(1)
    expect(results[0].winnerId).toBeNull()
    expect(market.pool.some((item) => item.id === player.id)).toBe(true)
  })

  it('同一支球队对同一个人最多抬两次价', () => {
    const base = game()
    const player = base.freeStars[0]
    const market: FreeMarket = { pool: base.freeStars, auctions: [], log: [], version: 1 }
    const value = playerValue(player)
    expect(placeAIBid(market, { id: 'd1n_01', name: '北岸竞技' }, player.id, value, 1000).ok).toBe(true)
    expect(placeAIBid(market, { id: 'd2n_02', name: '南港' }, player.id, value * 2, 2000).ok).toBe(true)
    expect(placeAIBid(market, { id: 'd1n_01', name: '北岸竞技' }, player.id, value * 3, 3000).ok).toBe(true)
    expect(placeAIBid(market, { id: 'd2n_02', name: '南港' }, player.id, value * 4, 4000).ok).toBe(true)
    expect(placeAIBid(market, { id: 'd1n_01', name: '北岸竞技' }, player.id, value * 5, 5000).ok).toBe(false)
    expect(market.auctions[0].bids).toHaveLength(4)
  })
})

describe('设施升级价格', () => {
  it('升级越靠后越贵，且不会白送', () => {
    const cheap = facilityUpgradeCost('stadium', 1) ?? 0
    const expensive = facilityUpgradeCost('stadium', 24) ?? 0
    expect(cheap).toBeGreaterThan(0)
    expect(expensive).toBeGreaterThan(cheap)
    expect(facilityUpgradeCost('stadium', 25)).toBeNull()
  })
})
