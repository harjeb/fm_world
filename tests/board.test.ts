import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { agentView, applyAgentAction } from '../server/agent.ts'
import {
  BOARD_CHOICE_MAX_ROUND,
  BOARD_INITIAL_CONFIDENCE,
  BOARD_TIER_BASE,
  BOARD_WAGE_SLIDER_ROUNDS,
  adjustBoardBudgetSlider,
  boardCommercialWageBonus,
  boardEffectiveWageCap,
  boardSliderBounds,
  buildBoardGoalOptions,
  checkWageCapForSigning,
  chooseBoardAmbition,
  confidenceBudgetMultiplier,
  confidenceWageCapMultiplier,
  ensureBoard,
  evaluateAndRollBoardSeason,
  evaluateClubCupStage,
  isBoardBudgetActive,
  refreshOffseasonBoardPreview,
  syncBoardLockState,
  transferRetentionRate,
  type OldBoardSeasonContext,
} from '../src/game/board.ts'
import { economyOf, facilityUpgradeCost, upgradeFacility } from '../src/game/economy.ts'
import { buyFreeAgent, listPlayer, renewContract, settleMarket } from '../src/game/market.ts'
import { isOnMarketToday } from '../src/game/market-window.ts'
import { minimumBid, placeBid, settleAuctions, type FreeMarket } from '../src/game/auction.ts'
import { respondToOffer, type MarketClub } from '../src/game/transfers.ts'
import { MIN_SQUAD } from '../src/game/squad.ts'
import { advanceWorldSeason, createWorldGame, ensurePromotionPlayoff, simulateOtherDivisions, syncPlayerDivision, wageForPlayer, worldWageBill } from '../src/game/world.ts'
import { createAIClub } from '../src/game/ai-club.ts'
import type { SeasonCups } from '../src/game/season-cups.ts'
import type { GameState, Player, TierId } from '../src/game/types.ts'
import { renderClub } from '../src/ui/screens/club.ts'
import { renderTransfer } from '../src/ui/screens/transfer.ts'
import { setGame, ui } from '../src/ui/state.ts'

function makeSeason2Game(tier: TierId = 'division2', ambition: 'safe' | 'expected' | 'ambitious' = 'expected', seed = 202611): GameState {
  const game = createWorldGame(seed)
  game.season.index = 2
  game.season.tier = tier
  game.season.round = 1
  game.season.finished = false
  if (game.world) game.world.seasonIndex = 2
  const board = ensureBoard(game)
  board.pendingChoice = ambition
  evaluateAndRollBoardSeason(game, {
    seasonIndex: 1,
    tier: 'division2',
    finish: 5,
    totalTeams: 20,
    clubIds: ['player'],
  })
  return game
}

function makeTestCup(cupId: 'community' | 'league' | 'champions', clubId: string, reached: 'none' | 'r16' | 'qf' | 'sf' | 'final' | 'champion'): SeasonCups {
  const fillers = Array.from({ length: 16 }, (_, idx) => `c${idx + 1}`)
  const entrants = reached === 'none' ? fillers : [clubId, ...fillers.slice(0, 15)]
  const rounds = []
  if (reached !== 'none') {
    rounds.push({
      round: 1,
      kickoffAt: 1000,
      byes: [],
      fixtures: Array.from({ length: 8 }, (_, idx) => ({
        id: `r1-${idx}`,
        cupId,
        round: 1,
        homeId: entrants[idx * 2],
        awayId: entrants[idx * 2 + 1],
        kickoffAt: 1000,
        played: true,
        score: { home: 2, away: 0 },
        winnerId: entrants[idx * 2],
      })),
    })
  }
  if (['qf', 'sf', 'final', 'champion'].includes(reached)) {
    rounds.push({
      round: 2,
      kickoffAt: 2000,
      byes: [],
      fixtures: Array.from({ length: 4 }, (_, idx) => ({
        id: `r2-${idx}`,
        cupId,
        round: 2,
        homeId: idx === 0 ? clubId : `q${idx}a`,
        awayId: `q${idx}b`,
        kickoffAt: 2000,
        played: true,
        score: { home: 2, away: 1 },
        winnerId: idx === 0 ? clubId : `q${idx}a`,
      })),
    })
  }
  if (['sf', 'final', 'champion'].includes(reached)) {
    rounds.push({
      round: 3,
      kickoffAt: 3000,
      byes: [],
      fixtures: Array.from({ length: 2 }, (_, idx) => ({
        id: `r3-${idx}`,
        cupId,
        round: 3,
        homeId: idx === 0 ? clubId : `s${idx}a`,
        awayId: `s${idx}b`,
        kickoffAt: 3000,
        played: true,
        score: { home: 1, away: 0 },
        winnerId: idx === 0 ? clubId : `s${idx}a`,
      })),
    })
  }
  if (['final', 'champion'].includes(reached)) {
    rounds.push({
      round: 4,
      kickoffAt: 4000,
      byes: [],
      fixtures: [{
        id: 'r4-0',
        cupId,
        round: 4,
        homeId: clubId,
        awayId: 'final-opp',
        kickoffAt: 4000,
        played: true,
        score: reached === 'champion' ? { home: 2, away: 0 } : { home: 0, away: 2 },
        winnerId: reached === 'champion' ? clubId : 'final-opp',
      }],
    })
  }
  return {
    version: 1,
    seasonIndex: 2,
    qualificationRound: 6,
    createdAt: 500,
    delayedLeagueRounds: [],
    cups: [{
      id: cupId,
      name: cupId,
      entrants,
      dates: [1000, 2000, 3000, 4000],
      rounds,
      championId: reached === 'champion' ? clubId : 'final-opp',
    }],
  }
}

describe('董事会核心公式与目标生成', () => {
  it('三档方案目标单调严格、预算单调递增，且低信任度/未达标评级显著削减预算', () => {
    for (const tier of ['division2', 'division1', 'champions'] as TierId[]) {
      const options = buildBoardGoalOptions(tier, 4, 20, BOARD_INITIAL_CONFIDENCE)
      expect(options.map((opt) => opt.ambition)).toEqual(['safe', 'expected', 'ambitious'])
      const [safe, expected, ambitious] = options
      expect(ambitious.leagueTarget).toBeLessThan(expected.leagueTarget)
      expect(expected.leagueTarget).toBeLessThan(safe.leagueTarget)
      expect(safe.transferGrant).toBeLessThan(expected.transferGrant)
      expect(expected.transferGrant).toBeLessThan(ambitious.transferGrant)
      expect(safe.facilityGrant).toBeLessThan(expected.facilityGrant)
      expect(expected.facilityGrant).toBeLessThan(ambitious.facilityGrant)
      expect(safe.wageCap).toBeLessThan(expected.wageCap)
      expect(expected.wageCap).toBeLessThan(ambitious.wageCap)
    }

    expect(confidenceBudgetMultiplier(60)).toBe(1)
    expect(confidenceBudgetMultiplier(90, 'S')).toBeGreaterThan(1.25)
    expect(confidenceBudgetMultiplier(48, 'C')).toBeLessThan(0.80)
    expect(confidenceBudgetMultiplier(40, 'D')).toBeLessThan(0.65)
    expect(confidenceWageCapMultiplier(40, 'D')).toBeLessThan(0.85)
    expect(transferRetentionRate(35)).toBe(0.50)
    expect(transferRetentionRate(60)).toBe(0.75)
    expect(transferRetentionRate(80)).toBe(0.85)
  })

  it('杯赛战绩阶段解析覆盖未入围到夺冠全部阶段', () => {
    expect(evaluateClubCupStage(makeTestCup('community', 'player', 'none'), ['player'], 'community')).toEqual({ stage: 'none', cupPresent: true })
    expect(evaluateClubCupStage(makeTestCup('community', 'player', 'r16'), ['player'], 'community')).toEqual({ stage: 'r16', cupPresent: true })
    expect(evaluateClubCupStage(makeTestCup('community', 'player', 'qf'), ['player'], 'community')).toEqual({ stage: 'qf', cupPresent: true })
    expect(evaluateClubCupStage(makeTestCup('community', 'player', 'sf'), ['player'], 'community')).toEqual({ stage: 'sf', cupPresent: true })
    expect(evaluateClubCupStage(makeTestCup('community', 'player', 'final'), ['player'], 'community')).toEqual({ stage: 'final', cupPresent: true })
    expect(evaluateClubCupStage(makeTestCup('community', 'player', 'champion'), ['player'], 'community')).toEqual({ stage: 'champion', cupPresent: true })
  })
})

describe('第 1 赛季兼容、休赛期预选与换季激活', () => {
  it('第 1 赛季不限制预算；常规赛结束后生成休赛期预选并在换季时直接注入独立转会/设施预算', () => {
    const game = createWorldGame(202601)
    expect(isBoardBudgetActive(game)).toBe(false)
    // 第 1 赛季大余额可直接升级设施（不触发董事会拦截）
    economyOf(game).balance = 20_000_000
    expect(upgradeFacility(game, 'academy').ok).toBe(true)

    // 模拟常规赛 38 轮全部踢完进入休赛期
    for (const fixture of game.season.fixtures) {
      fixture.played = true
      fixture.score = { home: 1, away: 0 }
    }
    syncPlayerDivision(game)
    simulateOtherDivisions(game, 38)
    ensurePromotionPlayoff(game)
    refreshOffseasonBoardPreview(game)
    expect(game.season.finished).toBe(true)
    expect(game.board?.offseasonPreview?.nextSeasonIndex).toBe(2)
    expect(game.board?.offseasonPreview?.confirmed).toBe(true)

    // 休赛期预选野心档
    const pick = chooseBoardAmbition(game, 'ambitious', { scope: 'offseason' })
    expect(pick.ok).toBe(true)
    expect(game.board?.pendingChoice).toBe('ambitious')

    const balanceBeforeRoll = economyOf(game).balance
    const rolled = advanceWorldSeason(game, Date.now() + 20 * 86_400_000)
    expect(rolled.ok).toBe(true)
    expect(game.season.index).toBe(2)
    expect(isBoardBudgetActive(game)).toBe(true)

    const mandate = game.board!.current!
    expect(mandate.seasonIndex).toBe(2)
    expect(mandate.ambition).toBe('ambitious')
    expect(mandate.transferBudget).toBe(mandate.initialTransferBudget)
    expect(mandate.facilityBudget).toBe(mandate.initialFacilityBudget)
    expect(mandate.initialTransferBudget).toBeGreaterThan(BOARD_TIER_BASE[mandate.tier].transferGrant)
    // 独立转会预算 + 独立设施预算已直接注入俱乐部余额
    expect(economyOf(game).balance).toBe(balanceBeforeRoll + mandate.initialTransferBudget + mandate.initialFacilityBudget)
    expect(game.board?.pendingChoice).toBeUndefined()
    expect(game.board?.offseasonPreview).toBeUndefined()
  })

  it('正在参加实时升级杯且未分胜负时支持分别为一级/二级各预选一套方案，换季按最终真实级别自动生效', () => {
    const game = createWorldGame(202609)
    game.season.finished = true
    game.season.playerFinish = 1
    game.season.tier = 'division2'
    const clubId = 'd2n_05'
    const playerClub = game.world!.clubs.find((c) => c.id === 'player')!
    playerClub.squadKey = clubId
    game.world!.seasonCups = {
      version: 1,
      seasonIndex: 1,
      qualificationRound: 6,
      createdAt: 1000,
      delayedLeagueRounds: [],
      cups: [{
        id: 'promotion',
        name: '升级杯',
        entrants: [clubId, 'c2', 'c3', 'c4', 'c5', 'c6'],
        dates: [1000, 2000, 3000, 4000, 5000],
        rounds: [
          { round: 1, kickoffAt: 1000, byes: [clubId], fixtures: [{ id: 'q1', cupId: 'promotion', round: 1, homeId: 'c2', awayId: 'c3', kickoffAt: 1000, played: true, score: { home: 2, away: 0 }, winnerId: 'c2' }] },
          { round: 2, kickoffAt: 2000, stage: 'group', byes: [], fixtures: [{ id: 'g1', cupId: 'promotion', round: 2, stage: 'group', groupIndex: 0, homeId: clubId, awayId: 'c2', kickoffAt: 2000, played: false }] },
        ],
        groups: [
          { index: 0, name: 'A 组', teamIds: [clubId, 'c2', 'c4'], table: [] },
          { index: 1, name: 'B 组', teamIds: ['c5', 'c6', 'c7'], table: [] },
        ],
        promotedIds: [],
      }],
    }

    // 1. 升级杯小组赛进行中：级别待定，同时展示一级与二级方案且两套均可分别预选
    refreshOffseasonBoardPreview(game, clubId)
    expect(game.board?.offseasonPreview?.confirmed).toBe(false)
    expect(game.board?.offseasonPreview?.promotionOptions?.length).toBe(3)
    expect(game.board?.offseasonPreview?.promotionOptions?.[1].transferGrant).toBe(BOARD_TIER_BASE.division1.transferGrant)

    expect(chooseBoardAmbition(game, 'safe', { scope: 'offseason', tier: 'division1', clubId }).ok).toBe(true)
    expect(chooseBoardAmbition(game, 'ambitious', { scope: 'offseason', tier: 'division2', clubId }).ok).toBe(true)
    expect(game.board?.pendingChoicesByTier).toEqual({ division1: 'safe', division2: 'ambitious' })

    // 禁止选择不存在的冠联情景
    expect(chooseBoardAmbition(game, 'safe', { scope: 'offseason', tier: 'champions', clubId }).ok).toBe(false)

    // 前端 UI 应同时展示两套可交互选档卡片
    setGame(game)
    ui.clubTab = 'board'
    const pendingHtml = renderClub()
    expect(pendingHtml).toContain('支持双情景提前预选')
    expect(pendingHtml).toContain('data-tier="division1"')
    expect(pendingHtml).toContain('data-tier="division2"')

    // 2. 换季若真正升入一级联赛：自动生效 division1 的预选（safe），绝不误用 division2 的 ambitious
    const promotedClone = structuredClone(game)
    promotedClone.season.index = 2
    promotedClone.season.tier = 'division1'
    promotedClone.season.finished = false
    const rolledD1 = evaluateAndRollBoardSeason(promotedClone, {
      seasonIndex: 1, tier: 'division2', finish: 1, totalTeams: 20, clubIds: [clubId, 'player'],
    })
    expect(rolledD1.mandate?.tier).toBe('division1')
    expect(rolledD1.mandate?.ambition).toBe('safe')
    expect(promotedClone.board?.pendingChoicesByTier).toBeUndefined()

    // 3. 换季若最终留在二级联赛：自动生效 division2 的预选（ambitious）
    const stayedClone = structuredClone(game)
    stayedClone.season.index = 2
    stayedClone.season.tier = 'division2'
    stayedClone.season.finished = false
    const rolledD2 = evaluateAndRollBoardSeason(stayedClone, {
      seasonIndex: 1, tier: 'division2', finish: 1, totalTeams: 20, clubIds: [clubId, 'player'],
    })
    expect(rolledD2.mandate?.tier).toBe('division2')
    expect(rolledD2.mandate?.ambition).toBe('ambitious')

    // 4. 小组赛结束本队提前锁定升级（进入 promotedIds）：立刻确认一级并沿用之前为一级预选的 safe
    game.world!.seasonCups.cups[0].promotedIds = [clubId]
    refreshOffseasonBoardPreview(game, clubId)
    expect(game.board?.offseasonPreview?.confirmed).toBe(true)
    expect(game.board?.offseasonPreview?.projectedTier).toBe('division1')
    expect(game.board?.pendingChoice).toBe('safe')

    // 5. 若在资格赛已淘汰（不在 groups 中）：立刻确认留级二级并沿用之前为二级预选的 ambitious
    game.world!.seasonCups.cups[0].promotedIds = []
    game.world!.seasonCups.cups[0].groups![0].teamIds = ['c2', 'c4', 'c8']
    refreshOffseasonBoardPreview(game, clubId)
    expect(game.board?.offseasonPreview?.confirmed).toBe(true)
    expect(game.board?.offseasonPreview?.projectedTier).toBe('division2')
    expect(game.board?.pendingChoice).toBe('ambitious')
  })
})

describe('独立设施预算、转会预算、工资帽与卖人回流', () => {
  it('即使余额 5000 万，设施预算用尽后也无法继续升级（不能单季升满训练设施）', () => {
    const game = makeSeason2Game('division2', 'expected')
    const economy = economyOf(game)
    const mandate = game.board!.current!
    economy.balance = 50_000_000
    const initialBudget = mandate.facilityBudget

    let upgrades = 0
    while (upgrades < 100) {
      const nextCost = facilityUpgradeCost('academy', economy.academy)
      if (nextCost === null) break
      const res = upgradeFacility(game, 'academy')
      if (!res.ok) {
        expect(res.error).toContain('设施预算不足')
        expect(mandate.facilityBudget).toBeLessThan(nextCost)
        break
      }
      upgrades++
    }
    expect(upgrades).toBeGreaterThan(0)
    // 单季 D2 设施预算 30 万绝对升不满 LV2（最多只能升少量阶段）
    expect(economy.academy).toBeLessThan(10)
    expect(mandate.facilityBudget).toBeLessThan(initialBudget)
    expect(economy.balance).toBeGreaterThan(49_500_000)
  })

  it('签人同时校验转会预算与有效工资帽；卖人收入按留存率回流转会预算', () => {
    const game = makeSeason2Game('division2', 'expected')
    const economy = economyOf(game)
    const mandate = game.board!.current!
    economy.balance = 50_000_000
    const candidate = game.freeStars.find((p) => !p.starKey && isOnMarketToday(game, p))
      ?? game.freeStars.find((p) => isOnMarketToday(game, p))
      ?? game.freeStars[0]
    candidate.marketDay = undefined

    // 1. 转会预算不足拦截（哪怕余额 5000 万）
    mandate.transferBudget = 1_000
    const blockedByBudget = buyFreeAgent(game, candidate.id)
    expect(blockedByBudget.ok).toBe(false)
    expect(blockedByBudget.error).toContain('转会预算不足')

    // 2. 工资帽不足拦截
    mandate.transferBudget = 5_000_000
    mandate.wageCap = 1_000
    const blockedByWage = buyFreeAgent(game, candidate.id)
    expect(blockedByWage.ok).toBe(false)
    expect(blockedByWage.error).toContain('工资帽')

    // 3. 青训球员豁免工资帽
    const youthClone: Player = { ...structuredClone(candidate), youthOrigin: { club: 'player', enrolledAt: 1, transferAfter: 100, promotedAt: 2 } }
    expect(checkWageCapForSigning(game, youthClone).ok).toBe(true)

    // 4. 放开工资帽后签约成功，同步扣减余额与转会预算
    mandate.wageCap = 200_000
    const budgetBefore = mandate.transferBudget
    const balBefore = economy.balance
    const bought = buyFreeAgent(game, candidate.id)
    expect(bought.ok).toBe(true)
    const fee = balBefore - economy.balance
    expect(fee).toBeGreaterThan(0)
    expect(mandate.transferBudget).toBe(budgetBefore - fee)

    // 5. 本地挂牌卖出回流 75% 至转会预算
    const seller = game.roster[game.roster.length - 1]
    const listPrice = 20_000
    expect(listPlayer(game, seller.id, listPrice).ok).toBe(true)
    const transferBeforeSale = mandate.transferBudget
    const proceeds = settleMarket(game, 1)
    expect(proceeds).toBe(listPrice)
    expect(mandate.transferBudget).toBe(transferBeforeSale + Math.round(listPrice * mandate.retentionRate))

    // 6. 接受 AI 报价卖出同样按留存率回流转会预算
    const offerTarget = game.roster[game.roster.length - 1]
    const buyerTeam = structuredClone(game.aiTeams[0])
    const buyer: MarketClub = {
      id: buyerTeam.id,
      name: buyerTeam.name,
      tier: 'division2',
      team: buyerTeam,
      state: createAIClub({ id: buyerTeam.id, tier: 'division2' }, 1),
    }
    buyer.state.economy.balance = 5_000_000
    game.transferOffers = [{
      id: 'offer-board-test',
      clubId: buyer.id,
      clubName: buyer.name,
      tier: 'division2',
      playerId: offerTarget.id,
      playerName: offerTarget.name,
      amount: 100_000,
      value: 80_000,
      createdAt: 1000,
      expiresAt: 100_000,
      status: 'pending',
    }]
    const beforeOfferBudget = mandate.transferBudget
    const offerRes = respondToOffer(game, 'offer-board-test', true, 2000, buyer, 2)
    expect(offerRes.ok).toBe(true)
    expect(mandate.transferBudget).toBe(beforeOfferBudget + Math.round(100_000 * mandate.retentionRate))
  })

  it('续约加薪校验工资帽，全服竞拍出价与结算均校验并扣减转会预算与工资帽', () => {
    const game = makeSeason2Game('division2', 'expected')
    const economy = economyOf(game)
    const mandate = game.board!.current!
    economy.balance = 50_000_000

    // 续约加薪超帽被拦
    const target = game.roster[0]
    const currentBill = worldWageBill(game)
    const commercial = boardCommercialWageBonus(economy)
    // 让有效工资帽正好等于当前工资，任何加薪都会超帽
    mandate.wageCap = Math.max(0, currentBill - commercial)
    target.contract = { clubId: 'player', wage: 500, expiresSeason: 2 }
    const blockedRenew = renewContract(game, target.id, 3)
    expect(blockedRenew.ok).toBe(false)
    expect(blockedRenew.error).toContain('工资帽')

    // 联机竞拍校验转会预算与工资帽
    const marketPlayer = structuredClone(game.freeStars[0])
    const market: FreeMarket = { pool: [marketPlayer], auctions: [], log: [], version: 1 }
    const opening = minimumBid(marketPlayer)
    mandate.transferBudget = Math.max(1, opening - 1_000)
    mandate.wageCap = 200_000
    const bidBlockedBudget = placeBid(market, game, 'acc-1', marketPlayer.id, opening, 1000)
    expect(bidBlockedBudget.ok).toBe(false)
    if (!bidBlockedBudget.ok) expect(bidBlockedBudget.error).toContain('转会预算')

    mandate.transferBudget = opening + 5_000_000
    mandate.wageCap = 1_000
    const bidBlockedWage = placeBid(market, game, 'acc-1', marketPlayer.id, opening, 1000)
    expect(bidBlockedWage.ok).toBe(false)
    if (!bidBlockedWage.ok) expect(bidBlockedWage.error).toContain('工资帽')

    mandate.wageCap = 200_000
    const bidOk = placeBid(market, game, 'acc-1', marketPlayer.id, opening, 1000)
    expect(bidOk.ok).toBe(true)
    const beforeSettleTransfer = mandate.transferBudget
    const settled = settleAuctions(market, (id) => (id === 'acc-1' ? game : undefined), 1000 + 7_200_000)
    expect(settled.length).toBe(1)
    expect(settled[0].winnerId).toBe('acc-1')
    expect(mandate.transferBudget).toBe(beforeSettleTransfer - opening)
  })
})

describe('转会预算 ↔ 工资帽 38:1 双向滑块与开季档位切换', () => {
  it('滑块严格按 38:1 双向无损互转，绝不触碰设施预算，并遵守竞拍占用与工资底线', () => {
    const game = makeSeason2Game('division2', 'expected')
    const mandate = game.board!.current!
    const origTransfer = mandate.transferBudget
    const origFacility = mandate.facilityBudget
    const origWageCap = mandate.wageCap
    const origBalance = economyOf(game).balance

    // 把 380,000 转会预算转为 +10,000/轮 工资帽
    const toWage = adjustBoardBudgetSlider(game, -10_000 * BOARD_WAGE_SLIDER_ROUNDS)
    expect(toWage.ok).toBe(true)
    expect(toWage.appliedTransferDelta).toBe(-380_000)
    expect(toWage.appliedWageCapDelta).toBe(10_000)
    expect(mandate.transferBudget).toBe(origTransfer - 380_000)
    expect(mandate.wageCap).toBe(origWageCap + 10_000)
    expect(mandate.facilityBudget).toBe(origFacility)
    expect(economyOf(game).balance).toBe(origBalance)

    // 反向转回同样额度，精确复原（无舍入漏水）
    const back = adjustBoardBudgetSlider(game, 10_000 * BOARD_WAGE_SLIDER_ROUNDS)
    expect(back.ok).toBe(true)
    expect(mandate.transferBudget).toBe(origTransfer)
    expect(mandate.wageCap).toBe(origWageCap)
    expect(mandate.sliderShift).toBe(0)
    expect(mandate.facilityBudget).toBe(origFacility)

    // 领先竞拍占用了大部分转会预算时，禁止把占用部分滑走
    const committed = mandate.transferBudget - 38_000
    const bounds = boardSliderBounds(game, committed)!
    expect(bounds.minTransferDelta).toBe(-38_000)
    const tooMuchToWage = adjustBoardBudgetSlider(game, -76_000, committed)
    expect(tooMuchToWage.ok).toBe(false)
    expect(tooMuchToWage.error).toContain('可用转会预算不足')

    // 禁止把工资帽压低到当前全队工资或初始工资帽 50% 以下
    const overPull = adjustBoardBudgetSlider(game, 50_000 * BOARD_WAGE_SLIDER_ROUNDS)
    expect(overPull.ok).toBe(false)
    expect(overPull.error).toContain('工资帽下限')
  })

  it('开季第 1–3 轮可切换目标档位并精确补退预算差额；已超额花费或第 4 轮后禁止更改', () => {
    const game = makeSeason2Game('division2', 'expected')
    const economy = economyOf(game)
    const mandate = game.board!.current!
    const expectedOpt = mandate.options.find((o) => o.ambition === 'expected')!
    const ambitiousOpt = mandate.options.find((o) => o.ambition === 'ambitious')!
    const balBefore = economy.balance

    // 第 2 轮升级至野心档
    game.season.round = 2
    expect(chooseBoardAmbition(game, 'ambitious', { scope: 'current' }).ok).toBe(true)
    expect(mandate.ambition).toBe('ambitious')
    expect(mandate.transferBudget).toBe(ambitiousOpt.transferGrant)
    expect(mandate.facilityBudget).toBe(ambitiousOpt.facilityGrant)
    expect(economy.balance).toBe(
      balBefore + (ambitiousOpt.transferGrant - expectedOpt.transferGrant) + (ambitiousOpt.facilityGrant - expectedOpt.facilityGrant),
    )

    // 花掉大部分设施预算后，不允许下调至稳妥档
    mandate.facilityBudget = 50_000
    const blockedDown = chooseBoardAmbition(game, 'safe', { scope: 'current' })
    expect(blockedDown.ok).toBe(false)
    expect(blockedDown.error).toContain('设施预算')

    // 推进至第 4 轮后自动锁定
    game.season.round = BOARD_CHOICE_MAX_ROUND + 1
    expect(syncBoardLockState(game)).toBe(true)
    expect(mandate.locked).toBe(true)
    const lockedRes = chooseBoardAmbition(game, 'expected', { scope: 'current' })
    expect(lockedRes.ok).toBe(false)
    expect(lockedRes.error).toContain('已锁定')
  })
})

describe('赛季末考核奖惩与下赛季预算变化', () => {
  it('大超预期获 S 级：涨信任度、发超额奖金、下季预算上调；未达标获 D 级：扣信任度、下季预算大幅削减', () => {
    // 场景 A：大超预期（S 级）
    const winGame = makeSeason2Game('division2', 'expected', 111)
    const winMandate = winGame.board!.current!
    const winOldGrant = winMandate.initialTransferBudget
    const balBeforeWinRoll = economyOf(winGame).balance
    winGame.season.index = 3
    winGame.season.tier = 'division2'
    const oldWinCtx: OldBoardSeasonContext = {
      seasonIndex: 2,
      tier: 'division2',
      finish: 1,
      totalTeams: 20,
      seasonCups: makeTestCup('community', 'player', 'champion'),
      clubIds: ['player'],
    }
    const winRoll = evaluateAndRollBoardSeason(winGame, oldWinCtx)
    expect(winRoll.evaluation?.grade).toBe('S')
    expect(winRoll.evaluation?.bonusPaid).toBe(winMandate.exceedBonus)
    expect(winGame.board!.confidence).toBeGreaterThan(BOARD_INITIAL_CONFIDENCE)
    expect(winRoll.mandate!.initialTransferBudget).toBeGreaterThan(winOldGrant)
    expect(economyOf(winGame).balance).toBe(
      balBeforeWinRoll + winMandate.exceedBonus + winRoll.mandate!.initialTransferBudget + winRoll.mandate!.initialFacilityBudget,
    )

    // 场景 B：严重失职（D 级）
    const failGame = makeSeason2Game('division2', 'ambitious', 222)
    const failMandate = failGame.board!.current!
    failMandate.leagueTarget = 3
    failMandate.cupTarget = 'sf'
    const failOldGrant = BOARD_TIER_BASE.division2.transferGrant
    failGame.season.index = 3
    failGame.season.tier = 'division2'
    const oldFailCtx: OldBoardSeasonContext = {
      seasonIndex: 2,
      tier: 'division2',
      finish: 19,
      totalTeams: 20,
      seasonCups: makeTestCup('community', 'player', 'none'),
      clubIds: ['player'],
    }
    const failRoll = evaluateAndRollBoardSeason(failGame, oldFailCtx)
    expect(failRoll.evaluation?.grade).toBe('D')
    expect(failRoll.evaluation?.bonusPaid).toBe(0)
    expect(failGame.board!.confidence).toBeLessThan(BOARD_INITIAL_CONFIDENCE - 15)
    // 未达标下赛季转会与设施预算明显低于正常基准（削减超 30%）
    expect(failRoll.mandate!.initialTransferBudget).toBeLessThan(failOldGrant * 0.72)
    expect(failRoll.mandate!.initialFacilityBudget).toBeLessThan(BOARD_TIER_BASE.division2.facilityGrant * 0.72)
    expect(failGame.board!.history.length).toBe(1)
  })

  it('降级导致工资帽低于现工资时：不强行解约球员，但阻止签入新援，待卖人或滑块调回后恢复', () => {
    const game = makeSeason2Game('division1', 'expected', 333)
    const rosterCountBefore = game.roster.length
    // 抬高现有工资模拟降级宽限
    for (const p of game.roster) {
      if (p.contract) p.contract.wage = 4_000
    }
    game.season.index = 3
    game.season.tier = 'division2'
    evaluateAndRollBoardSeason(game, {
      seasonIndex: 2,
      tier: 'division1',
      finish: 20,
      totalTeams: 20,
      clubIds: ['player'],
    })
    expect(game.roster.length).toBe(rosterCountBefore)
    const cap = boardEffectiveWageCap(game)!
    expect(worldWageBill(game)).toBeGreaterThan(cap)
    const freePlayer = game.freeStars[0]
    expect(checkWageCapForSigning(game, freePlayer).ok).toBe(false)
    // 阵容人数低于底线时豁免工资帽
    game.roster = game.roster.slice(0, MIN_SQUAD - 1)
    expect(checkWageCapForSigning(game, freePlayer).ok).toBe(true)
  })
})

describe('Agent API 与前端 UI 渲染', () => {
  it('Agent state 暴露完整 board 视图，且支持 board_choose_ambition 与 board_adjust_budget', () => {
    const game = makeSeason2Game('division2', 'expected', 444)
    const view = agentView(game)
    expect(view.board.active).toBe(true)
    expect(view.board.confidence).toBe(BOARD_INITIAL_CONFIDENCE)
    expect(view.board.current?.transferBudget).toBe(game.board!.current!.transferBudget)
    expect(view.board.current?.sliderBounds).toBeTruthy()

    const switched = applyAgentAction(game, { action: 'board_choose_ambition', ambition: 'ambitious', scope: 'current' })
    expect(switched.ok).toBe(true)
    expect(game.board!.current!.ambition).toBe('ambitious')

    const slid = applyAgentAction(game, { action: 'board_adjust_budget', transferDelta: -38_000 })
    expect(slid.ok).toBe(true)
    expect(game.board!.current!.sliderShift).toBe(-38_000)

    const invalid = applyAgentAction(game, { action: 'board_choose_ambition', ambition: 'invalid' })
    expect(invalid.ok).toBe(false)
  })

  it('俱乐部「董事会」页签与转会页预算条正常渲染（含滑块与休赛期预选卡片）', () => {
    const game = makeSeason2Game('division2', 'expected', 555)
    setGame(game)
    ui.clubTab = 'board'
    const clubHtml = renderClub()
    expect(clubHtml).toContain('董事会信任度与政策')
    expect(clubHtml).toContain('board-budget-slider')
    expect(clubHtml).toContain('独立设施预算')
    expect(clubHtml).toContain('历年董事会考核')

    ui.clubTab = 'facilities'
    const facHtml = renderClub()
    expect(facHtml).toContain('本赛季独立设施预算')

    ui.transferTab = 'market'
    const transferHtml = renderTransfer()
    expect(transferHtml).toContain('board-budget-strip')
    expect(transferHtml).toContain('可用转会预算')

    // 休赛期预览视图
    game.season.finished = true
    refreshOffseasonBoardPreview(game)
    ui.clubTab = 'board'
    const offHtml = renderClub()
    expect(offHtml).toContain('休赛期通知')
    expect(offHtml).toContain('稳妥档')
    expect(offHtml).toContain('野心档')
  })
})

const servers: AppServer[] = []
const dirs: string[] = []
afterEach(() => {
  while (servers.length) servers.pop()!.close()
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-board-'))
  dirs.push(dataDir)
  const app = createAppServer({ dataDir, staticDir: path.resolve('dist'), tickMs: 0 })
  servers.push(app)
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
}

describe('联机服务器董事会接口与权威防篡改', () => {
  it('/api/club/upgrade、/api/board/choose、/api/board/slider 与 PUT /api/game 权威保护生效', async () => {
    const base = await startServer()
    const reg = await (await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'boardboss', password: 'secret123' }),
    })).json() as { token: string; game: GameState; revision: number }
    const headers = { Authorization: `Bearer ${reg.token}`, 'Content-Type': 'application/json' }

    // 第 1 赛季 /api/club/upgrade 正常升级设施（普通模式返回完整 game，精简模式 X-FM-Slim: 1 返回轻量 patch）
    const up = await fetch(`${base}/api/club/upgrade`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ facilityId: 'medical' }),
    })
    expect(up.status).toBe(200)
    const upBody = await up.json() as { game: GameState; revision: number }
    expect(upBody.game.economy!.medical).toBe(2)

    const upSlim = await fetch(`${base}/api/club/upgrade`, {
      method: 'POST',
      headers: { ...headers, 'X-FM-Slim': '1' },
      body: JSON.stringify({ facilityId: 'medical' }),
    })
    expect(upSlim.status).toBe(200)
    const upSlimBody = await upSlim.json() as { ok: boolean; revision: number; patch?: { economy?: { medical: number } }; game?: unknown }
    expect(upSlimBody.ok).toBe(true)
    expect(upSlimBody.game).toBeUndefined()
    expect(upSlimBody.patch?.economy?.medical).toBe(3)
    upBody.revision = upSlimBody.revision
    upBody.game.economy!.medical = 3

    // 第 1 赛季常规赛未结束时，/api/board/slider 与 /api/board/choose 应返回 400（而非崩溃）
    const sliderEarly = await fetch(`${base}/api/board/slider`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ transferDelta: -38_000 }),
    })
    expect(sliderEarly.status).toBe(400)

    const chooseEarly = await fetch(`${base}/api/board/choose`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ambition: 'ambitious', scope: 'offseason' }),
    })
    expect(chooseEarly.status).toBe(400)

    // PUT /api/game 篡改 game.board 不会覆盖服务器权威状态
    const tampered = structuredClone(upBody.game)
    tampered.board = {
      version: 1,
      confidence: 100,
      history: [],
    }
    const put = await fetch(`${base}/api/game`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ game: tampered, baseRevision: upBody.revision }),
    })
    expect(put.status).toBe(200)
    const reloaded = await (await fetch(`${base}/api/game`, { headers })).json() as { game: GameState }
    expect(reloaded.game.board?.confidence ?? 60).not.toBe(100)

    // Agent API /api/agent/state 包含 board 视图
    const tok = await (await fetch(`${base}/api/agent/token`, { method: 'POST', headers })).json() as { token: string }
    const agentRes = await fetch(`${base}/api/agent/state`, {
      headers: { Authorization: `Bearer ${tok.token}` },
    })
    expect(agentRes.status).toBe(200)
    const agentBody = await agentRes.json() as { game: { board: { confidence: number; active: boolean } } }
    expect(agentBody.game.board.confidence).toBe(BOARD_INITIAL_CONFIDENCE)
    expect(agentBody.game.board.active).toBe(false)
  })
})
