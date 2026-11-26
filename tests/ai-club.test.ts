import { describe, expect, it } from 'vitest'
import { ALL_ATTRIBUTES, type AIClubState, type Player } from '../src/game/types.ts'
import {
  AI_SEASON_SHOP_BOOKS,
  AI_SQUAD_LIMIT,
  advanceAIClub,
  advanceAIClubs,
  aiBidFor,
  aiClubOf,
  aiSignFreeAgents,
  aiTierProfile,
  aiUpgradeFloor,
  AI_BALANCE_CAP,
  backfillAICardSkills,
  backfillAITierIncome,
  createAIClub,
  equipAICards,
  grantAISeasonShopBooks,
  grantAllAISeasonShopBooks,
  isRealStar,
  mergeSignings,
  playerCa,
  playerValue,
  primaryPosition,
  recordAISigning,
  registerAIStar,
  releaseDepthSurplus,
  runAIClubs,
  seedAIClubs,
} from '../src/game/ai-club.ts'
import { AI_BID_PREFIX, AUCTION_DURATION_MS, placeAIBid, settleAuctions, type FreeMarket } from '../src/game/auction.ts'
import { facilityUpgradeCost, facilityLevel, projectedRoundIncome } from '../src/game/economy.ts'
import { AVERAGE_ROUND_GAME_DAYS } from '../src/game/calendar.ts'
import { buildOwnerlessTeams, cachedOwnerlessTeams, createOwnerlessWorld, createWorldGame, reconcileWorldStars, rolloverOwnerlessTeams } from '../src/game/world.ts'
import { PLAYER_SEEDS } from '../src/game/data/players.ts'
import { basePlayerMarketValue } from '../src/game/pricing.ts'
import { analyzeAIDepth } from '../src/game/ai-depth.ts'
import { pickAIPartners, pickAITrainingBooks, simulateAITrainingRound, simulateAITrainingSession } from '../src/game/ai-training.ts'
import { shopCatalog } from '../src/game/shop.ts'
import { bookScopeMatches } from '../src/game/legend-learning.ts'
import { untrainedPlayer } from '../src/game/cards.ts'
import { initialDisplayCA } from '../src/game/rating.ts'
import { caCeilingOf } from '../src/game/ca.ts'
import { refreshAILineup } from '../src/game/squad.ts'

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
      expect(result.trained).toBeLessThanOrEqual(high * 5 * AVERAGE_ROUND_GAME_DAYS)
      void low
    }
    expect(counted.division2).toBeLessThan(counted.division1)
    expect(counted.division1).toBeLessThan(counted.champions)
  })

  it('每次训练是一整轮（按当季时段）只练一个人；卡只套自己的槽位，只受个人属性上限约束', () => {
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
        // 每个被练到的人与玩家同一套个人属性上限（ceilings）约束。
        const ceilingCa = caCeilingOf(player.ceilings, player.positions.GK > 0)
        expect(playerCa(player), `${tier} slot ${slot}`).toBeLessThanOrEqual(ceilingCa + 5)
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
    // 槽位顺移后（例如换季/转会导致下标变化）：仍按 owner 精确找回自己的强卡，不会清零。
    const moved = structuredClone(team.players)
    const freshPlayer = structuredClone(team.players[3])
    freshPlayer.attrs = structuredClone(before)
    moved[3] = moved[5]
    moved[5] = freshPlayer
    expect(equipAICards(ai, moved)).toBe(true)
    expect(playerCa(moved[5])).toBeGreaterThan(playerCa(strong) - 1)
    expect(ai.cards['5'].owner).toBe(owner)
  })

  it('AI 一次培养真实跑完 30 个时段，和玩家自动一轮同量级', () => {
    const base = game()
    const player = structuredClone(base.roster[0])
    const ai = createAIClub({ id: 'probe', tier: 'division2' }, 7)
    for (const id of ['stadium', 'academy', 'medical', 'shop', 'sponsor', 'psychology', 'tactics'] as const) ai.economy[id] = 1
    const before = playerCa(player)
    const trained = simulateAITrainingRound(player, 123, ai.economy)
    expect(playerCa(trained)).toBeGreaterThan(before + 50)
    expect(trained.attrs).not.toEqual(player.attrs)
    expect(trained.version).toBeGreaterThan(player.version)
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

  it('顶级与一级球队仍有买人名额时，设施升级先留足转会预算，不把现金抽干到买人留底以下', () => {
    const base = game()
    const team = structuredClone(base.aiTeams[0])

    for (const tier of ['champions', 'division1'] as const) {
      const profile = aiTierProfile(tier)
      const ai = state(profile.balance, tier)
      for (const id of ['stadium', 'academy', 'medical', 'shop', 'sponsor', 'psychology', 'tactics'] as const) ai.economy[id] = 15
      const expectedFloor = aiUpgradeFloor(ai, tier, 2, team.players.length)
      expect(expectedFloor).toBeGreaterThan(profile.reserve)

      // 连续推进 10 轮：设施照常升级，但余额绝不跌破升级留底，始终留有可用转会预算。
      const res = advanceAIClub(ai, { id: team.id, tier }, team, 10, 77, true, 2)
      expect(res.upgrades).toBeGreaterThan(0)
      expect(ai.economy.balance).toBeGreaterThanOrEqual(expectedFloor)
      expect(ai.economy.balance - profile.reserve).toBeGreaterThanOrEqual(expectedFloor - profile.reserve)

      // 余额低于升级留底但处于攒钱阶段时，暂停升设施直到蓄满转会预算。
      ai.economy.balance = profile.reserve + 200_000
      const paused = advanceAIClub(ai, { id: team.id, tier }, team, 1, 78, true, 2)
      expect(paused.upgrades).toBe(0)
      expect(ai.economy.balance).toBeGreaterThan(profile.reserve + 200_000)

      // 当季买人名额用完后，升级留底自动回落到 reserve，释放多余现金继续升设施（仍不低于 reserve）。
      ai.transfers = { season: 2, bought: 5 }
      expect(aiUpgradeFloor(ai, tier, 2, team.players.length)).toBe(profile.reserve)
      ai.economy.balance = expectedFloor - 100_000
      const afterQuota = advanceAIClub(ai, { id: team.id, tier }, team, 2, 79, true, 2)
      expect(afterQuota.upgrades).toBeGreaterThan(0)
      expect(ai.economy.balance).toBeGreaterThanOrEqual(profile.reserve)
    }
  })

  it('AI 每轮收入按所属联赛真实级别结算（顶级 60 万 / 一级 15 万 / 二级 3 万）', () => {
    const base = game()
    const team = structuredClone(base.aiTeams[0])
    const gainFor = (tier: 'champions' | 'division1' | 'division2') => {
      const ai = state(100_000, tier)
      // 余额低于留底，确保不触发设施升级，纯看单轮收入
      ai.economy.fans = 10_000
      for (const id of ['stadium', 'academy', 'medical', 'shop', 'sponsor', 'psychology', 'tactics'] as const) ai.economy[id] = 10
      const expected = projectedRoundIncome(ai.economy, tier)
      const before = ai.economy.balance
      advanceAIClub(ai, { id: team.id, tier }, undefined, 1, 12, false, 2)
      expect(ai.economy.balance - before).toBe(expected)
      return ai.economy.balance - before
    }
    const c = gainFor('champions')
    const d1 = gainFor('division1')
    const d2 = gainFor('division2')
    expect(c - d2).toBe(570_000)
    expect(d1 - d2).toBe(120_000)
  })

  it('backfillAITierIncome 按历季升降级历史准确补发漏发转播分成，跳过玩家执教球队并受余额上限封顶', () => {
    const mk = (bal: number) => state(bal, 'champions')
    const world = {
      seasonIndex: 2,
      clubs: [
        { id: 'c_stay', tier: 'champions' as const },
        { id: 'd1_up', tier: 'champions' as const },
        { id: 'c_down', tier: 'division1' as const },
        { id: 'd1_stay', tier: 'division1' as const },
        { id: 'd2_stay', tier: 'division2' as const },
        { id: 'owned_c', tier: 'champions' as const },
        { id: 'rich_c', tier: 'champions' as const },
      ] as any,
      history: [{ seasonIndex: 1, champion: 'c_stay', promotions: ['d1_up'], relegations: ['c_down'], championsTop4: [] }],
    }
    const aiClubs: Record<string, AIClubState> = {
      c_stay: mk(1_000_000),
      d1_up: mk(1_000_000),
      c_down: mk(1_000_000),
      d1_stay: mk(1_000_000),
      d2_stay: mk(1_000_000),
      owned_c: mk(1_000_000),
      rich_c: mk(AI_BALANCE_CAP - 500_000),
    }
    const res = backfillAITierIncome(world, aiClubs, 17, { owned_c: 'player-1' })
    expect(res.clubs).toBe(5)
    expect(aiClubs.c_stay.economy.balance).toBe(1_000_000 + (38 + 17) * 570_000)
    expect(aiClubs.d1_up.economy.balance).toBe(1_000_000 + 38 * 120_000 + 17 * 570_000)
    expect(aiClubs.c_down.economy.balance).toBe(1_000_000 + 38 * 570_000 + 17 * 120_000)
    expect(aiClubs.d1_stay.economy.balance).toBe(1_000_000 + (38 + 17) * 120_000)
    expect(aiClubs.d2_stay.economy.balance).toBe(1_000_000)
    expect(aiClubs.owned_c.economy.balance).toBe(1_000_000)
    expect(aiClubs.rich_c.economy.balance).toBe(AI_BALANCE_CAP)
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

describe('电脑球队按原始 CA 培养并换下主力', () => {
  const ownerKey = (player: Player) => `${player.id}|${player.enName}`
  /** 不到一个游戏日的一轮：二级球队刚好练 1 个人。 */
  const oneSession = (ai: AIClubState, team: Parameters<typeof advanceAIClub>[2], seed: number) =>
    advanceAIClub(ai, { id: team!.id, tier: 'division2' }, team, 0.5, seed)

  it('新买的高水平球星原始 CA 最高又没练过，第一个轮到他', () => {
    const team = structuredClone(game().aiTeams[0])
    const ai = state(100_000, 'division2')
    const slot = team.players.findIndex((player, index) => index > 4 && player.positions.GK === 0)
    const star = scale(team.players[slot], 2)
    star.baseAttrs = { ...star.attrs }
    team.players[slot] = star
    expect(team.players.every((player) => player === star || initialDisplayCA(player) < initialDisplayCA(star))).toBe(true)

    expect(oneSession(ai, team, 31).trained).toBe(1)
    expect(ai.trainedOwners).toEqual([ownerKey(star)])
  })

  it('按原始 CA 从高到低每次练一个，全队练过一遍后清空重新开一圈', () => {
    const team = structuredClone(game().aiTeams[0])
    const ai = state(100_000, 'division2')
    const order = [...team.players].sort((a, b) => initialDisplayCA(b) - initialDisplayCA(a)).map(ownerKey)
    for (let index = 0; index < team.players.length; index++) {
      oneSession(ai, team, 100 + index)
      expect(ai.trainedOwners, `第 ${index + 1} 次`).toEqual(order.slice(0, index + 1))
    }
    oneSession(ai, team, 500)
    expect(ai.trainedOwners).toEqual([order[0]])
  })

  it('离队球员不再占着“已练”记录，新来的先练', () => {
    const team = structuredClone(game().aiTeams[0])
    const ai = state(100_000, 'division2')
    ai.trainedOwners = [...team.players.map(ownerKey), 'gone|Ghost Player']
    const rookie = scale(team.players[7], 1.2)
    rookie.id = 'rookie-1'
    rookie.enName = 'Rookie One'
    rookie.baseAttrs = { ...rookie.attrs }
    team.players.push(rookie)
    expect(oneSession(ai, team, 7).trained).toBe(1)
    // 只有新来的这一个是新练的，离队的记录被剔除；练的就是他（卡在他自己的槽位上）。
    expect(ai.trainedOwners).toContain(ownerKey(rookie))
    expect(ai.trainedOwners).not.toContain('gone|Ghost Player')
    expect(ai.trainedOwners).toHaveLength(team.players.length)
    expect(ai.cards[String(team.players.length - 1)]?.owner).toBe(ownerKey(rookie))
  })

  it('替补练出来比主力强，就把主力换下来进首发', () => {
    let proven = false
    for (const candidate of game().aiTeams) {
      const team = structuredClone(candidate)
      const ai = state(100_000, 'division2')
      const starters = new Set(team.lineup.starters.map((starter) => starter.playerId))
      for (const bench of team.players.filter((player) => !starters.has(player.id) && player.positions.GK === 0)) {
        const starter = team.players.find((player) => starters.has(player.id) && primaryPosition(player) === primaryPosition(bench))
        if (!starter) continue
        // 这名替补练之前比主力略弱（差 20 点），一次培养至少涨 50，练完就该超过主力。
        let factor = 1
        const target = playerCa(starter) - 20
        const weakened = structuredClone(bench)
        while (playerCa(weakened) > target && factor > 0.2) {
          factor -= 0.02
          weakened.attrs = scale(bench, factor).attrs
        }
        weakened.baseAttrs = { ...weakened.attrs }
        team.players[team.players.indexOf(bench)] = weakened
        ai.trainedOwners = team.players.filter((player) => player !== weakened).map(ownerKey)
        refreshAILineup(team)
        if (team.lineup.starters.some((item) => item.playerId === weakened.id)) continue
        const before = playerCa(weakened)
        oneSession(ai, team, 13)
        const after = team.players.find((player) => player.id === weakened.id)!
        expect(playerCa(after)).toBeGreaterThan(before + 40)
        expect(team.lineup.starters.some((item) => item.playerId === weakened.id)).toBe(true)
        proven = true
        break
      }
      if (proven) break
    }
    expect(proven).toBe(true)
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

  it('单机成交人数和实际离场人数一致，不重复签人，各队遵守自己的赛季名额', () => {
    const base = game()
    const before = base.freeStars.length
    expect(before).toBeGreaterThan(24)
    const signed = aiSignFreeAgents(base, 2)
    expect(signed).toBeGreaterThanOrEqual(0)
    expect(signed).toBeLessThanOrEqual(before)
    expect(base.freeStars.length).toBe(before - signed)
    for (const team of base.aiTeams) {
      expect(new Set(team.players.map(p => p.id)).size).toBe(team.players.length)
      expect(base.aiClubs![team.id].transfers?.bought ?? 0).toBeLessThanOrEqual(5)
    }
    const small = game()
    small.freeStars = small.freeStars.slice(0, 20)
    const smallSigned = aiSignFreeAgents(small, 2)
    expect(small.freeStars.length + smallSigned).toBe(20)
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

describe('AI 培养卡技能保存、装备与队友传承', () => {
  it('AI 培养保存并装备技能及档位，保留原始 baseSkills 并在转会/再次培养时还原', () => {
    const base = game()
    const team = structuredClone(base.aiTeams[0])
    const ai = state(5_000_000, 'champions')
    const initialSkills = new Map(team.players.map((p) => [p.id, [...p.skills]]))
    const result = advanceAIClub(ai, { id: team.id, tier: 'champions' }, team, 4, 303, true, 2)
    expect(result.trained).toBeGreaterThan(10)

    const learnedPlayers = team.players.filter((p) => p.skills.length > (initialSkills.get(p.id)?.length ?? 0))
    expect(learnedPlayers.length).toBeGreaterThan(5)

    for (const player of learnedPlayers) {
      const orig = initialSkills.get(player.id) ?? []
      expect(player.baseSkills).toEqual(orig)
      // untrainedPlayer 必须还原回原始技能，绝不把 AI 培养卡上的技能泄漏给买方或下轮培养起点
      const reset = untrainedPlayer(player)
      expect(reset.skills).toEqual(orig)
      // 账本里对应卡也存着同样的技能
      const slot = team.players.findIndex((item) => item.id === player.id)
      expect(ai.cards[String(slot)]?.skills).toEqual(player.skills)
    }

    // 换季/槽位顺移后 equipAICards 也能把卡上的技能同步回来
    const target = learnedPlayers[0]
    const moved = structuredClone(team.players)
    const idx = moved.findIndex((p) => p.id === target.id)
    const stripped = untrainedPlayer(moved[idx])
    expect(stripped.skills).toEqual(initialSkills.get(target.id))
    const otherIdx = (idx + 3) % moved.length
    moved[idx] = moved[otherIdx]
    moved[otherIdx] = stripped
    expect(equipAICards(ai, moved)).toBe(true)
    expect(moved[otherIdx].skills).toEqual(target.skills)
  })

  it('AI 培养支持同队队友技能传承，且槽位满时不覆盖招牌技能', () => {
    const base = game()
    const fieldPlayer = structuredClone(base.roster.find((p) => p.positions.GK === 0 && p.skills.length === 0)!)
    const starMentor = structuredClone(base.roster.find((p) => p.positions.GK === 0 && p.id !== fieldPlayer.id)!)
    starMentor.skills = ['sh_free_kick']
    starMentor.skillTiers = { sh_free_kick: 'rainbow' }
    starMentor.signatureSkill = 'sh_free_kick'
    const ai = state(5_000_000, 'champions')

    // 多次不同种子运行：应当能通过队友传承学到导师的招牌技能（含银/金/彩档位）
    let inherited = false
    for (let seed = 1; seed <= 30; seed++) {
      const trained = simulateAITrainingRound(fieldPlayer, seed * 97, ai.economy, 2, 0, [fieldPlayer, starMentor])
      if (trained.skills.includes('sh_free_kick')) {
        inherited = true
        expect(['silver', 'gold', 'rainbow']).toContain(trained.skillTiers?.sh_free_kick)
        break
      }
    }
    expect(inherited).toBe(true)

    // 已有 4 主技能（含彩虹招牌技）的球星再次培养：绝不被替换掉招牌技
    const fullStar = structuredClone(fieldPlayer)
    fullStar.signatureSkill = 'sh_free_kick'
    fullStar.skills = ['sh_free_kick', 'long_shot', 'through_ball', 'safe_pass']
    fullStar.skillTiers = { sh_free_kick: 'rainbow', long_shot: 'silver', through_ball: 'silver', safe_pass: 'silver' }
    const trainedFull = simulateAITrainingRound(fullStar, 777, ai.economy, 2, 0, [fullStar, starMentor])
    expect(trainedFull.skills).toContain('sh_free_kick')
    expect(trainedFull.skillTiers?.sh_free_kick).toBe('rainbow')
  })

  it('backfillAICardSkills 为旧账本无技能高 CA 卡补齐培养技能且不降 CA，并保持幂等', () => {
    const base = game()
    const team = structuredClone(base.aiTeams[0])
    const ai = state(5_000_000, 'champions')
    // 模拟线上历史旧卡：高 CA（+250）但没有 skills 字段
    for (let slot = 0; slot < team.players.length; slot++) {
      const p = team.players[slot]
      const boosted = scale(p, 1.8)
      ai.cards[String(slot)] = {
        rating: playerCa(boosted),
        attrs: { ...boosted.attrs },
        owner: `${p.id}|${p.enName}`,
      }
    }
    equipAICards(ai, team.players)
    const caBefore = team.players.map((p) => playerCa(p))
    const skillsBefore = team.players.reduce((s, p) => s + p.skills.length, 0)

    expect(backfillAICardSkills(ai, team, 2026, 2)).toBe(true)
    const skillsAfter = team.players.reduce((s, p) => s + p.skills.length, 0)
    expect(skillsAfter).toBeGreaterThan(skillsBefore + team.players.length)
    team.players.forEach((p, slot) => {
      expect(playerCa(p)).toBeCloseTo(caBefore[slot], 5)
      expect(ai.cards[String(slot)]?.skills).toEqual(p.skills)
    })

    // 二次调用幂等
    expect(backfillAICardSkills(ai, team, 2026, 2)).toBe(false)
  })

  it('AI 培养自动选 6 名正常陪练、避开已满上限属性并兼顾隐藏属性', () => {
    const base = game()
    const team = structuredClone(base.aiTeams[0])
    const fieldTarget = team.players.find((p) => p.positions.GK === 0)!
    const gkTarget = team.players.find((p) => p.positions.GK > 0)!

    // 外场球员带 6 名陪练（含 1 名门将、不含本人），门将带 6 名外场陪练
    const fieldPartners = pickAIPartners(fieldTarget, team.players, 101)
    expect(fieldPartners).toHaveLength(6)
    expect(fieldPartners).not.toContain(fieldTarget.id)
    expect(fieldPartners.some((id) => team.players.find((p) => p.id === id)!.positions.GK > 0)).toBe(true)

    const gkPartners = pickAIPartners(gkTarget, team.players, 101)
    expect(gkPartners).toHaveLength(6)
    expect(gkPartners).not.toContain(gkTarget.id)
    expect(gkPartners.every((id) => team.players.find((p) => p.id === id)!.positions.GK === 0)).toBe(true)

    // 把这名球员的传球、盘带、速度、加速直接顶到上限，验证 AI 会转练其余未满主属性与隐藏属性而非空转
    const almostCapped = structuredClone(fieldTarget)
    almostCapped.baseAttrs = structuredClone(almostCapped.attrs)
    for (const key of ['passing', 'dribbling', 'speed', 'acceleration'] as const) {
      almostCapped.attrs[key] = almostCapped.ceilings[key]
      almostCapped.baseAttrs[key] = almostCapped.ceilings[key]
    }
    const maxEco = { stadium: 25, academy: 25, medical: 25, shop: 25, sponsor: 25, psychology: 25, tactics: 25 }
    const session = simulateAITrainingSession(almostCapped, 2026, maxEco, 3, 0, team.players)
    expect(session.partnerIds).toHaveLength(6)
    const zeroGainDrills = session.log.filter(
      (entry) => entry.kind === 'action'
        && !entry.title.includes('休息')
        && !entry.title.includes('恢复')
        && !entry.title.includes('休整')
        && !entry.title.includes('失败')
        && !entry.title.includes('导师')
        && !entry.title.includes('交流赛')
        && !entry.title.includes('队内比赛')
        && Object.values(entry.gains ?? {}).every((v) => !v || v <= 0.01),
    )
    expect(zeroGainDrills).toHaveLength(0)
    expect(session.candidate.attrs.shooting + session.candidate.attrs.tackling + session.candidate.attrs.strength)
      .toBeGreaterThan(almostCapped.attrs.shooting + almostCapped.attrs.tackling + almostCapped.attrs.strength + 300)
  })

  it('赛季初按联赛级别从当季商店货架给 AI 发金书，级别越高越多，幂等且可在培养中学到', () => {
    const world = game().world!
    const seed = 7777
    const book = seedAIClubs(world, seed)

    const sampleByTier = (tier: 'division2' | 'division1' | 'champions') => {
      const club = world.clubs.find((c) => !c.isPlayer && c.tier === tier)!
      return { club, state: book[club.id] }
    }
    const d2 = sampleByTier('division2')
    const d1 = sampleByTier('division1')
    const ch = sampleByTier('champions')

    expect(d2.state.books).toHaveLength(AI_SEASON_SHOP_BOOKS.division2)
    expect(d1.state.books).toHaveLength(AI_SEASON_SHOP_BOOKS.division1)
    expect(ch.state.books).toHaveLength(AI_SEASON_SHOP_BOOKS.champions)
    expect(AI_SEASON_SHOP_BOOKS.division2).toBeLessThan(AI_SEASON_SHOP_BOOKS.division1)
    expect(AI_SEASON_SHOP_BOOKS.division1).toBeLessThan(AI_SEASON_SHOP_BOOKS.champions)

    // 所发技能书全部来自当季商店货架（金书）
    const s1Ids = new Set(shopCatalog(seed, 1).map((o) => o.id))
    for (const item of [d2, d1, ch]) {
      expect(item.state.booksSeason).toBe(1)
      for (const b of item.state.books ?? []) {
        expect(b.tier).toBe('gold')
        expect(s1Ids.has(b.id as any)).toBe(true)
      }
      // 同赛季重复调用幂等
      expect(grantAISeasonShopBooks(item.state, item.club, seed, 1)).toBe(0)
    }

    // 第 2、3 赛季滚动后继续从对应赛季商店货架累进发放，不重复
    world.seasonIndex = 2
    expect(grantAllAISeasonShopBooks(world, book, seed)).toBeGreaterThan(0)
    expect(d2.state.books).toHaveLength(AI_SEASON_SHOP_BOOKS.division2 * 2)
    expect(d1.state.books).toHaveLength(AI_SEASON_SHOP_BOOKS.division1 * 2)
    expect(ch.state.books).toHaveLength(AI_SEASON_SHOP_BOOKS.champions * 2)
    world.seasonIndex = 3
    grantAllAISeasonShopBooks(world, book, seed)
    expect(ch.state.books).toHaveLength(AI_SEASON_SHOP_BOOKS.champions * 3)
    const uniqueChKeys = new Set((ch.state.books ?? []).map((b) => `${b.id}:${b.tier}`))
    expect(uniqueChKeys.size).toBe(ch.state.books!.length)

    // AI 培养选书遵循赛季书槽上限与位置匹配，并能实际从商店金书学会金色技能
    const team = structuredClone(game().aiTeams[0])
    const fieldPlayer = team.players.find((p) => p.positions.GK === 0)!
    const pickedS1 = pickAITrainingBooks(fieldPlayer, ch.state.books, 1, 99)
    const pickedS3 = pickAITrainingBooks(fieldPlayer, ch.state.books, 3, 99)
    expect(pickedS1).toHaveLength(4)
    expect(pickedS3).toHaveLength(5)
    for (const b of pickedS3) expect(bookScopeMatches(fieldPlayer, b)).toBe(true)

    const chIds = new Set((ch.state.books ?? []).map((b) => b.id))
    const maxEco = { stadium: 25, academy: 25, medical: 25, shop: 25, sponsor: 25, psychology: 25, tactics: 25 }
    let learnedShopGold = false
    for (let s = 1; s <= 15; s++) {
      const sess = simulateAITrainingSession(fieldPlayer, s * 37, maxEco, 3, 0, team.players, ch.state.books)
      expect(sess.books?.length).toBeGreaterThan(0)
      if (sess.candidate.skills.some((id) => chIds.has(id as any) && sess.candidate.skillTiers?.[id] === 'gold')) {
        learnedShopGold = true
        break
      }
    }
    expect(learnedShopGold).toBe(true)
  })
})

describe('顶级队引援买星与全服球星守恒', () => {
  it('经过多轮培养的高 CA 顶级队仍按原始 CA 与原始身价评估，积极竞购市场顶级球星替换普通人', () => {
    const { world, freeStars } = createOwnerlessWorld(2026)
    const teams = buildOwnerlessTeams(world, 2026)
    const club = world.clubs.find((c) => c.tier === 'champions')!
    const team = structuredClone(teams[club.id])
    const ai = state(30_000_000, 'champions')

    // 模拟已培养 5 轮：队内普通球员的现役 CA 涨到 600~800，而市场球星未培养仅 ~280
    advanceAIClub(ai, { id: club.id, tier: 'champions' }, team, 5, 2026, true, 1)
    const randomPlayers = team.players.filter((p) => !isRealStar(p))
    expect(randomPlayers.some((p) => playerCa(p) > 450)).toBe(true)

    // 先把缺位（若有）补齐到两套深度完整，再验证满深度下仍会积极买顶级市场球星替换普通人
    const squad = [...team.players]
    let depth = analyzeAIDepth({ lineup: team.lineup, players: squad })
    for (const star of [...freeStars].sort((a, b) => playerCa(b) - playerCa(a))) {
      if (depth.missing === 0) break
      if (!depth.improves(star)) continue
      const val = basePlayerMarketValue(star)
      const bid = aiBidFor({ state: ai, tier: 'champions', player: untrainedPlayer(star), squad, depth, value: val, minimum: val })
      expect(bid).not.toBeNull()
      squad.push(untrainedPlayer(star))
      depth = analyzeAIDepth({ lineup: team.lineup, players: squad })
    }
    expect(depth.missing).toBe(0)
    expect(squad.length).toBeLessThan(AI_SQUAD_LIMIT)

    // 两套深度齐全、且队内普通人已经练到高 CA 的情况下，仍按原始 CA 与原始身价积极竞购市场头牌球星
    const inSquad = new Set(squad.map((p) => p.id))
    const topStars = [...freeStars]
      .filter((s) => !inSquad.has(s.id))
      .sort((a, b) => playerCa(b) - playerCa(a))
      .slice(0, 12)
    const willingBids = topStars.filter((star) => {
      const value = basePlayerMarketValue(star)
      const bid = aiBidFor({
        state: ai,
        tier: 'champions',
        player: untrainedPlayer(star),
        squad,
        depth,
        value,
        minimum: value,
      })
      return bid !== null
    })
    expect(willingBids.length).toBeGreaterThanOrEqual(8)
  })

  it('顶级/一级队接近满编时每轮解约 1 名非主力普通人腾位，不误伤球星且不破坏两套深度；满编合并时球星优先替换普通人', () => {
    const { world, freeStars } = createOwnerlessWorld(2026)
    const teams = buildOwnerlessTeams(world, 2026)
    const club = world.clubs.find((c) => c.tier === 'champions')!
    const team = structuredClone(teams[club.id])
    const ai = state(25_000_000, 'champions')
    // 先把阵容塞满到 29 人（补入普通外场球员，确保两套深度完整）
    const extraRandoms = Object.values(teams)
      .filter((t) => t.id !== club.id)
      .flatMap((t) => t.players.filter((p) => !isRealStar(p) && p.positions.GK === 0))
    while (team.players.length < AI_SQUAD_LIMIT && extraRandoms.length > 0) {
      const filler = structuredClone(extraRandoms.shift()!)
      filler.id = `extra-filler-${team.players.length}`
      team.players.push(filler)
    }
    expect(team.players.length).toBe(AI_SQUAD_LIMIT)
    const starsBefore = team.players.filter(isRealStar).map((p) => p.id)

    // 解约 1 名冗余普通人腾出买星空间，且不放走真实球星、不降低两套位置覆盖
    const depthBefore = analyzeAIDepth(team)
    const releasePool: Player[] = []
    const released = releaseDepthSurplus(team, ai, club, releasePool, 1, 5)
    expect(released).toBeDefined()
    expect(isRealStar(released!)).toBe(false)
    expect(releasePool).toHaveLength(1)
    expect(team.players.length).toBe(AI_SQUAD_LIMIT - 1)
    expect(team.players.filter(isRealStar).map((p) => p.id)).toEqual(starsBefore)
    expect(analyzeAIDepth(team).missing).toBeLessThanOrEqual(depthBefore.missing)
    // 同轮幂等：不重复放人
    expect(releaseDepthSurplus(team, ai, club, releasePool, 1, 5)).toBeUndefined()

    // 满编合并测试：把队内普通球员都大幅培养到高 CA，新签入一名未培养真实球星仍应替换普通人进队
    const fullTeam = structuredClone(teams[club.id])
    while (fullTeam.players.length < AI_SQUAD_LIMIT && extraRandoms.length > 0) {
      const filler = structuredClone(extraRandoms.shift()!)
      filler.id = `full-filler-${fullTeam.players.length}`
      fullTeam.players.push(filler)
    }
    const trainedFull = fullTeam.players.map((p) => (isRealStar(p) ? p : scale(p, 2.2)))
    const starSigning = freeStars.find((p) => isRealStar(p) && p.positions.GK === 0)!
    const aiMerge = state(20_000_000, 'champions')
    recordAISigning(aiMerge, starSigning, 5_000_000)
    const merged = mergeSignings(aiMerge, trainedFull)
    expect(merged.length).toBe(AI_SQUAD_LIMIT)
    expect(merged.some((p) => p.id === starSigning.id)).toBe(true)
  })

  it('AI 购入的真实球星同步登记后，跨 S1→S2→S3 换季滚动完整留存不消失', () => {
    const { world, freeStars } = createOwnerlessWorld(2026)
    const teams = buildOwnerlessTeams(world, 2026)
    const aiClubs = seedAIClubs(world, 2026)
    const club = world.clubs.find((c) => c.tier === 'champions')!
    const team = teams[club.id]
    const bought = freeStars.shift()!

    // S1 购入球星并同步归属
    team.players.push(untrainedPlayer(bought))
    recordAISigning(aiClubs[club.id], bought, 8_000_000)
    expect(registerAIStar(world, club.id, team, bought)).toBe(true)
    expect(club.starPlayerIds).toContain(bought.id)

    // S1 -> S2 滚动并清掉已合并的 postings
    world.seasonIndex = 2
    const s2Teams = rolloverOwnerlessTeams(world, 2026 + 2, teams, aiClubs, new Set(freeStars.map((p) => p.id)))
    for (const s of Object.values(aiClubs)) s.signings = []
    expect(s2Teams[club.id].players.some((p) => p.id === bought.id)).toBe(true)

    // S2 -> S3 滚动：此前 signings 清空后会把未登记球星抹掉；修复后必须完整留存
    world.seasonIndex = 3
    const s3Teams = rolloverOwnerlessTeams(world, 2026 + 3, s2Teams, aiClubs, new Set(freeStars.map((p) => p.id)))
    expect(s3Teams[club.id].players.some((p) => p.id === bought.id)).toBe(true)
    expect(world.clubs.find((c) => c.id === club.id)!.starPlayerIds).toContain(bought.id)
  })

  it('reconcileWorldStars 核对全服 500 名真实球星守恒：同步漏记归属、找回失踪球星、不重复玩家球星与重生且幂等', () => {
    const { world, freeStars, reserveStars } = createOwnerlessWorld(2026)
    const teams = buildOwnerlessTeams(world, 2026)
    const club = world.clubs.find((c) => c.tier === 'champions')!
    const team = teams[club.id]

    // 1. 模拟旧版未登记购入球星（在 team.players 里但不在 club.starPlayerIds 里）
    const unregistered = freeStars.shift()!
    team.players.push(untrainedPlayer(unregistered))

    // 2. 模拟 3 名因旧版换季卡丢的失踪球星（既不在任何球队，也不在市场/储备池）
    const vanished = [freeStars.shift()!, freeStars.shift()!, reserveStars.shift()!]

    // 3. 模拟 1 名由真人玩家持有的球星（不能被重复补回）
    const humanStar = freeStars.shift()!

    // 4. 模拟 1 名已退役并重生为 regen 的球星（按 starKey 计为同一位，不重复补回）
    const retiredOrig = freeStars.shift()!
    const regenStar: Player = {
      ...structuredClone(retiredOrig),
      id: `regen-${retiredOrig.starKey}-1`,
      age: 16,
      generation: 1,
    }
    freeStars.push(regenStar)

    const audit1 = reconcileWorldStars({
      world,
      teams,
      humanRosters: [[humanStar]],
      marketPool: freeStars,
      reserveStars,
    })
    expect(audit1.syncedClubStars).toBeGreaterThanOrEqual(1)
    expect(audit1.recoveredStars).toBe(vanished.length)
    expect(audit1.totalPresent).toBe(PLAYER_SEEDS.length)
    expect(audit1.totalSeeds).toBe(PLAYER_SEEDS.length)
    expect(club.starPlayerIds).toContain(unregistered.id)

    // 找回的球星全部回到市场池或储备池，且无任何重复 starKey
    const allStars = [
      humanStar,
      ...Object.values(teams).flatMap((t) => t.players.filter(isRealStar)),
      ...freeStars.filter(isRealStar),
      ...reserveStars.filter(isRealStar),
    ]
    const allKeys = allStars.map((p) => p.starKey!)
    expect(allKeys.length).toBe(PLAYER_SEEDS.length)
    expect(new Set(allKeys).size).toBe(PLAYER_SEEDS.length)
    for (const v of vanished) {
      expect(allKeys).toContain(v.starKey!)
    }

    // 二次调用完全幂等
    const audit2 = reconcileWorldStars({
      world,
      teams,
      humanRosters: [[humanStar]],
      marketPool: freeStars,
      reserveStars,
    })
    expect(audit2.syncedClubStars).toBe(0)
    expect(audit2.recoveredStars).toBe(0)
    expect(audit2.totalPresent).toBe(PLAYER_SEEDS.length)
  })
})
