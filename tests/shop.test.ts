import { describe, expect, it } from 'vitest'
import {
  SHOP_AUX_CATALOG_IDS,
  SHOP_AUX_NEW_SKILL_IDS,
  SHOP_GK_SKILL_IDS,
  SHOP_OUTFIELD_SKILL_IDS,
  SHOP_SKILL_IDS,
  SHOP_SKILLS,
} from '../src/game/data/shop-skills.ts'
import { LEGEND_SKILL_IDS } from '../src/game/data/legend-skills.ts'
import { PEAK_SKILL_IDS } from '../src/game/data/peak-skills.ts'
import { POSITION_BASIC_SKILLS, SKILLS, canLearnSkill, skillCategory } from '../src/game/data/skills.ts'
import {
  MAX_PEAK_SHOP_POINTS,
  SHOP_AUX_COUNT,
  SHOP_BOOK_PRICE,
  SHOP_GK_COUNT,
  SHOP_OUTFIELD_COUNT,
  awardPeakShopPoints,
  awardSeasonShopPoints,
  buyShopBook,
  ensureShop,
  peakStageShopPoints,
  seasonShopPoints,
  shopCatalog,
  shopPointsOf,
  totalPeakShopPoints,
} from '../src/game/shop.ts'
import { createInitialGame } from '../src/game/state.ts'
import { ensurePve, applyPveResult } from '../src/game/pve.ts'
import { bookLearnChance, bookRequirementText, bookScopeMatches, canChooseTrainingBook, drawTrainingSkills } from '../src/game/legend-learning.ts'
import { createTrainingSession } from '../src/game/training.ts'
import { hasLegendBook } from '../src/game/legend-books.ts'
import { game as uiGame, ui } from '../src/ui/state.ts'
import { renderShop } from '../src/ui/screens/shop.ts'
import { renderChallenge } from '../src/ui/screens/challenge.ts'
import { loadPveContent } from '../src/game/pve-content.ts'
import type { MatchRecord } from '../src/game/types.ts'

describe('技能书商店与点数系统', () => {
  it('40 个新增商店技能（24 外场 + 6 门将 + 10 辅助）独立于传奇/巅峰/基础池，且具备合法门槛与槽位分类', () => {
    expect(SHOP_OUTFIELD_SKILL_IDS).toHaveLength(24)
    expect(SHOP_GK_SKILL_IDS).toHaveLength(6)
    expect(SHOP_AUX_NEW_SKILL_IDS).toHaveLength(10)
    expect(SHOP_AUX_CATALOG_IDS).toHaveLength(12)
    expect(SHOP_SKILL_IDS).toHaveLength(40)
    const legendSet = new Set<string>(LEGEND_SKILL_IDS)
    const peakSet = new Set<string>(PEAK_SKILL_IDS)
    const basicSet = new Set<string>(Object.values(POSITION_BASIC_SKILLS).flat())
    for (const id of SHOP_SKILL_IDS) {
      expect(SKILLS[id]).toBeDefined()
      expect(legendSet.has(id)).toBe(false)
      expect(peakSet.has(id)).toBe(false)
      expect(basicSet.has(id)).toBe(false)
      expect(skillCategory(id)).toBe(SHOP_SKILLS[id].category)
      expect(bookRequirementText({ id, tier: 'gold' })).toMatch(/\d+/)
    }
    // 4 个主技能满槽时，仍可继续学习 2 个辅助技能；辅助满 2 个后再学辅助受限
    const fourMains = SHOP_OUTFIELD_SKILL_IDS.slice(0, 4)
    expect(canLearnSkill(fourMains, SHOP_OUTFIELD_SKILL_IDS[4])).toBe(false)
    expect(canLearnSkill(fourMains, 'sh_aux_penalty_calm')).toBe(true)
    const fullBoth = [...fourMains, 'sh_aux_penalty_calm' as const, 'sh_aux_comeback' as const]
    expect(canLearnSkill(fullBoth, 'sh_aux_discipline')).toBe(false)
  })

  it('每赛季上架 8 外场 + 2 门将 + 2 辅助金书（共 12 本）；周期完整轮换；相邻赛季零重复；同世界共享', () => {
    const seed = 424242
    const seenOutfield = new Set<string>()
    const seenGk = new Set<string>()
    const seenAux = new Set<string>()
    let prevIds = new Set<string>()
    for (let season = 1; season <= 7; season++) {
      const offers = shopCatalog(seed, season)
      expect(offers).toHaveLength(SHOP_OUTFIELD_COUNT + SHOP_GK_COUNT + SHOP_AUX_COUNT)
      expect(offers.every((offer) => offer.tier === 'gold' && offer.price === SHOP_BOOK_PRICE)).toBe(true)
      const outfield = offers.filter((offer) => offer.category === 'main' && offer.scope === 'field')
      const gk = offers.filter((offer) => offer.category === 'main' && offer.scope === 'gk')
      const aux = offers.filter((offer) => offer.category === 'auxiliary')
      expect(outfield).toHaveLength(8)
      expect(gk).toHaveLength(2)
      expect(aux).toHaveLength(2)
      // 同世界同赛季确定性一致（联机全服共享）
      expect(shopCatalog(seed, season)).toEqual(offers)
      // 与上一赛季零重复（含跨周期 S3 -> S4、S6 -> S7）
      for (const offer of offers) expect(prevIds.has(offer.id), `season ${season} repeated ${offer.id}`).toBe(false)
      prevIds = new Set(offers.map((offer) => offer.id))
      if (season <= 3) {
        for (const offer of outfield) seenOutfield.add(offer.id)
        for (const offer of gk) seenGk.add(offer.id)
      }
      if (season <= 6) {
        for (const offer of aux) seenAux.add(offer.id)
      }
    }
    expect(seenOutfield.size).toBe(24)
    expect(seenGk.size).toBe(6)
    expect(seenAux.size).toBe(12)
  })

  it('赛季排名点数严格按联赛级别与排名递增，满足二级上游 4 本、顶级上游全换 10 本的比例', () => {
    for (const tier of ['division2', 'division1', 'champions'] as const) {
      for (let rank = 1; rank < 20; rank++) {
        expect(seasonShopPoints(tier, rank)).toBeGreaterThan(seasonShopPoints(tier, rank + 1))
      }
    }
    for (let rank = 1; rank <= 20; rank++) {
      expect(seasonShopPoints('champions', rank)).toBeGreaterThan(seasonShopPoints('division1', rank))
      expect(seasonShopPoints('division1', rank)).toBeGreaterThan(seasonShopPoints('division2', rank))
    }
    // 二级上游（1–4 名）：400–480 点 ≈ 4 本
    expect(seasonShopPoints('division2', 4)).toBe(4 * SHOP_BOOK_PRICE)
    expect(seasonShopPoints('division2', 1)).toBeGreaterThanOrEqual(4 * SHOP_BOOK_PRICE)
    // 顶级上游（1–4 名）：1000–1200 点 → 全换 10 本
    expect(seasonShopPoints('champions', 4)).toBe(10 * SHOP_BOOK_PRICE)
    expect(seasonShopPoints('champions', 1)).toBeGreaterThanOrEqual(10 * SHOP_BOOK_PRICE)

    // 同一赛季只发一次，跨赛季累计不清零
    const game = createInitialGame(77)
    game.season.tier = 'division2'
    game.season.finished = true
    game.season.playerFinish = 3
    const first = awardSeasonShopPoints(game)
    expect(first).toBe(seasonShopPoints('division2', 3))
    expect(awardSeasonShopPoints(game)).toBe(0)
    expect(shopPointsOf(game)).toBe(first)

    const second = awardSeasonShopPoints(game, { index: 2, tier: 'champions', finished: true, playerFinish: 2 })
    expect(second).toBe(seasonShopPoints('champions', 2))
    expect(shopPointsOf(game)).toBe(first + second)
  })

  it('巅峰之路每关首通给额外点数（×3 档位），旧存档与旧版 ×1 补发档均自动幂等补齐', () => {
    expect(peakStageShopPoints(1)).toBe(15)
    expect(peakStageShopPoints(20)).toBe(15)
    expect(peakStageShopPoints(21)).toBe(24)
    expect(peakStageShopPoints(41)).toBe(36)
    expect(peakStageShopPoints(61)).toBe(48)
    expect(peakStageShopPoints(81)).toBe(60)
    expect(peakStageShopPoints(100)).toBe(60)
    expect(totalPeakShopPoints(100)).toBe(MAX_PEAK_SHOP_POINTS)
    expect(MAX_PEAK_SHOP_POINTS).toBe(3660)

    // 模拟老存档：已通关 35 关，但没有 game.shop
    const legacy = createInitialGame(88)
    delete legacy.shop
    legacy.pve!.peak.cleared = 35
    expect(ensurePve(legacy)).toBe(true)
    const expected35 = totalPeakShopPoints(35)
    expect(expected35).toBe(20 * 15 + 15 * 24)
    expect(shopPointsOf(legacy)).toBe(expected35)
    const backfilled = (legacy as { shop?: { peakClaimedStages: number[]; peakPointsAwarded?: number; lastPeakBackfill?: number } }).shop
    expect(backfilled?.peakClaimedStages).toHaveLength(35)
    expect(backfilled?.peakPointsAwarded).toBe(expected35)
    expect(backfilled?.lastPeakBackfill).toBe(expected35)

    // 模拟已按旧版 ×1 补发过的存档（已领 1..25 共 140 点，花掉 100 剩 40 点）→ 升级后自动补发差额 +280 点
    const v1Save = createInitialGame(89)
    v1Save.pve!.peak.cleared = 25
    v1Save.shop = { points: 40, seasonClaims: {}, peakClaimedStages: Array.from({ length: 25 }, (_, i) => i + 1) }
    expect(ensureShop(v1Save)).toBe(true)
    expect(shopPointsOf(v1Save)).toBe(40 + (totalPeakShopPoints(25) - 140))
    expect(v1Save.shop.peakPointsAwarded).toBe(totalPeakShopPoints(25))
    expect(v1Save.shop.lastPeakBackfill).toBe(280)
    expect(ensureShop(v1Save)).toBe(false)

    // 重复调用幂等，不重复补发
    expect(ensureShop(legacy)).toBe(false)
    expect(shopPointsOf(legacy)).toBe(expected35)

    // 后续打通第 36 关，只加第 36 关的点数
    const dummyRecord = { id: 'peak-36', score: { home: 2, away: 0 }, result: 'win' } as MatchRecord
    applyPveResult(legacy, dummyRecord, { isLeague: false, mode: 'peak', stage: 36, opponentId: 'peak-36', opponentName: 'Peak 36', homeAway: 'home', seed: 1 })
    expect(shopPointsOf(legacy)).toBe(expected35 + peakStageShopPoints(36))
    // 重打第 36 关不再重复加点
    expect(awardPeakShopPoints(legacy, 36)).toBe(0)
    expect(shopPointsOf(legacy)).toBe(expected35 + peakStageShopPoints(36))
  })

  it('商店购买校验、扣点入库及培养系统联动正常', () => {
    const game = createInitialGame(101)
    ensureShop(game)
    const catalog = shopCatalog(game.seed, 1)
    const outfieldOffer = catalog.find((offer) => offer.category === 'main' && offer.scope === 'field')!
    const gkOffer = catalog.find((offer) => offer.category === 'main' && offer.scope === 'gk')!
    const auxOffer = catalog.find((offer) => offer.category === 'auxiliary')!
    const offShelf = SHOP_OUTFIELD_SKILL_IDS.find((id) => !catalog.some((offer) => offer.id === id))!

    // 点数不足失败
    expect(buyShopBook(game, outfieldOffer.id).ok).toBe(false)
    // 未上架失败
    game.shop!.points = 500
    expect(buyShopBook(game, offShelf).ok).toBe(false)

    // 正常购买外场金书与门将金书
    const buy1 = buyShopBook(game, outfieldOffer.id)
    expect(buy1.ok).toBe(true)
    expect(shopPointsOf(game)).toBe(400)
    expect(hasLegendBook(game, outfieldOffer.id, 'gold')).toBe(true)

    // 不可重复购买同金书
    expect(buyShopBook(game, outfieldOffer.id).ok).toBe(false)
    expect(shopPointsOf(game)).toBe(400)

    const buy2 = buyShopBook(game, gkOffer.id)
    expect(buy2.ok).toBe(true)
    expect(shopPointsOf(game)).toBe(300)

    const buy3 = buyShopBook(game, auxOffer.id)
    expect(buy3.ok).toBe(true)
    expect(shopPointsOf(game)).toBe(200)
    expect(hasLegendBook(game, auxOffer.id, 'gold')).toBe(true)

    // 位置校验：外场书仅限外场，门将书仅限门将，辅助书外场与门将均可学
    const fieldPlayer = game.roster.find((p) => p.positions.GK === 0)!
    const gkPlayer = game.roster.find((p) => p.positions.GK > 0)!
    expect(bookScopeMatches(fieldPlayer, { id: outfieldOffer.id })).toBe(true)
    expect(bookScopeMatches(gkPlayer, { id: outfieldOffer.id })).toBe(false)
    expect(bookScopeMatches(gkPlayer, { id: gkOffer.id })).toBe(true)
    expect(bookScopeMatches(fieldPlayer, { id: gkOffer.id })).toBe(false)
    expect(bookScopeMatches(fieldPlayer, { id: auxOffer.id })).toBe(true)
    expect(bookScopeMatches(gkPlayer, { id: auxOffer.id })).toBe(true)
    expect(canChooseTrainingBook(fieldPlayer, { id: outfieldOffer.id, tier: 'gold' }).ok).toBe(true)
    expect(canChooseTrainingBook(gkPlayer, { id: outfieldOffer.id, tier: 'gold' }).ok).toBe(false)
    expect(canChooseTrainingBook(gkPlayer, { id: auxOffer.id, tier: 'gold' }).ok).toBe(true)

    // 学习成功率随属性达标升至 100%
    const req = SHOP_SKILLS[outfieldOffer.id as keyof typeof SHOP_SKILLS].requires[0]
    const strong = { ...fieldPlayer, attrs: { ...fieldPlayer.attrs, [req.attr]: req.gold } }
    expect(bookLearnChance(strong, { id: outfieldOffer.id, tier: 'gold' })).toBe(1)

    // 装备到培养会话可正常参与交流赛技能抽取
    const session = createTrainingSession(fieldPlayer, 999, undefined, 1, [{ id: outfieldOffer.id, tier: 'gold' }])
    const choices = drawTrainingSkills(session)
    expect(choices.length).toBeGreaterThan(0)
  })

  it('商店页面与巅峰之路奖励预览正确渲染商店点数与货架', async () => {
    uiGame.shop = { points: 250, seasonClaims: {}, peakClaimedStages: [1, 2], lastPeakBackfill: 10 }
    const html = renderShop()
    expect(html).toContain('技能书商店')
    expect(html).toContain('外场技能书')
    expect(html).toContain('守门员技能书')
    expect(html).toContain('辅助技能书')
    expect(html).toContain('book-name skill-gold')
    expect(html).not.toContain('金书')
    expect(html).not.toContain('金技能书')
    expect(html).toContain('250')
    expect(html).toContain('兑换（100 点）')
    expect(html).toContain('自动补发 10 商店点数')
    expect(html).toContain('二级联赛')
    expect(html).toContain('冠军联赛')

    await loadPveContent()
    ui.challengeMode = 'peak'
    ui.peakPreviewStage = 1
    const challengeHtml = renderChallenge()
    expect(challengeHtml).toContain('商店点数 +15')
  })
})
