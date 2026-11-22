import { beforeAll, describe, expect, it } from 'vitest'
import { createWorldGame } from '../src/game/world.ts'
import type { GameState, MatchRecord, PlayerMatchStats } from '../src/game/types.ts'
import { DAY_MS } from '../src/game/calendar.ts'
import { applyYouthAction } from '../src/game/youth-actions.ts'
import { ensureYouth, growYouthAttributes, recordYouthMatch, settleYouth, shiftYouthClock, validYouthPlan, YOUTH_TIERS, YOUTH_WEEK_MS, youthCA, youthDailyRoll, youthMatchFactor, youthPerformanceBonus, youthPlayer, youthView } from '../src/game/youth.ts'
import { youthStars } from '../src/game/youth-rating.ts'
import { preserveYouthState } from '../src/game/youth-authority.ts'
import { startTraining } from '../src/game/actions.ts'
import { equipCard } from '../src/game/cards.ts'
import { listPlayer, releasePlayer, SQUAD_LIMIT } from '../src/game/market.ts'
import { caOf } from '../src/game/ca.ts'

const NOW = Date.UTC(2026, 10, 18, 1)
let base: GameState
beforeAll(() => { base = createWorldGame(84502, undefined, '青训测试', NOW) })
function fixture(): GameState {
  const game = structuredClone(base)
  game.season.fixtures.forEach(f => { f.played = true })
  game.season.finished = false
  ensureYouth(game, NOW)
  return game
}
function record(game: GameState, at: number, minutes = 90, rating = 7, id = 'youth-match'): MatchRecord {
  return { id, createdAt: at, isLeague: true, playerStats: [{ sourceId: game.youth!.members[0].player.id, minutes, rating, goals: 0, assists: 0, tackles: 0, interceptions: 0, saves: 0 }] } as MatchRecord
}

describe('青训生成与招募', () => {
  it('旧档初始化一次，免费六人、位置覆盖、年龄与真实 CA 范围正确', () => {
    const game = fixture()
    const original = structuredClone(game.youth)
    expect(ensureYouth(game, NOW + DAY_MS)).toBe(false)
    expect(game.youth).toEqual(original)
    expect(game.youth!.members).toHaveLength(6)
    expect(game.youth!.members.map(m => m.plan.position)).toEqual(['GK', 'DC', 'DL', 'MC', 'AMR', 'ST'])
    for (const member of game.youth!.members) {
      const p = member.player
      expect(p.age).toBeGreaterThanOrEqual(14)
      expect(p.age).toBeLessThanOrEqual(18)
      expect(youthCA(p)).toBeGreaterThanOrEqual(60 - 1e-8)
      expect(youthCA(p)).toBeLessThanOrEqual(145 + 1e-8)
      expect(caOf(p.attrs, p.positions.GK > 0)).toBeCloseTo(member.initialCa, 8)
      expect(member.ceiling).toBeGreaterThan(member.initialCa)
      expect(member.ceiling).toBeGreaterThanOrEqual(YOUTH_TIERS[member.tier].min)
      expect(member.ceiling).toBeLessThanOrEqual(YOUTH_TIERS[member.tier].max)
      expect(p.youthOrigin?.club).toBe('青训测试')
      expect(game.roster.some(p => p.id === member.player.id)).toBe(false)
    }
    expect(YOUTH_TIERS.genius).toMatchObject({ min: 250, max: 280 })
  })
  it('普通苗子新上限约200；旧队员与候选人一次性上调，不重抽、不改当前属性', () => {
    const game = fixture()
    const member = game.youth!.members[0]
    member.tier = 'ordinary'
    member.ceiling = 177.5
    delete member.balanceVersion
    const before = structuredClone(member.player)
    const candidate = structuredClone(member)
    candidate.player.id = 'legacy-candidate'
    candidate.ceiling = 195
    game.youth!.intake.candidates.push(candidate)
    settleYouth(game, NOW)
    expect(YOUTH_TIERS.ordinary).toMatchObject({ min: 190, max: 210 })
    expect(member.ceiling).toBe(200)
    expect(candidate.ceiling).toBe(210)
    expect(member.player).toEqual(before)
    expect(member.balanceVersion).toBe(2)
    settleYouth(game, NOW)
    expect(member.ceiling).toBe(200)
    expect(candidate.ceiling).toBe(210)
    const view = youthView(game, NOW)!
    expect(view.members[0]).toHaveProperty('abilityStars')
    expect(view.members[0]).toHaveProperty('potentialStars')
    expect(view.members[0]).not.toHaveProperty('ceiling')
    expect(view.members[0]).not.toHaveProperty('currentCA')
    expect(view.members[0]).not.toHaveProperty('initialCA')
  })

  it('同一种子生成一致；每周固定候选人、免费留两人，解约不补人不返资源', () => {
    const game = fixture(), other = fixture()
    expect(game.youth).toEqual(other.youth)
    const coins = game.economy!.balance
    expect(applyYouthAction(game, { action: 'recruit_position', position: 'DM' }, NOW).ok).toBe(true)
    settleYouth(game, NOW + YOUTH_WEEK_MS)
    const batch = structuredClone(game.youth!.intake.candidates)
    expect(batch).toHaveLength(5)
    expect(batch[0].plan.position).toBe('DM')
    settleYouth(game, NOW + YOUTH_WEEK_MS)
    expect(game.youth!.intake.candidates).toEqual(batch)
    expect(applyYouthAction(game, { action: 'sign', playerId: batch[0].player.id }, NOW + YOUTH_WEEK_MS).ok).toBe(true)
    expect(applyYouthAction(game, { action: 'sign', playerId: batch[0].player.id }, NOW + YOUTH_WEEK_MS).ok).toBe(false)
    expect(applyYouthAction(game, { action: 'sign', playerId: batch[1].player.id }, NOW + YOUTH_WEEK_MS).ok).toBe(true)
    expect(game.youth!.members).toHaveLength(8)
    expect(applyYouthAction(game, { action: 'sign', playerId: batch[2].player.id }, NOW + YOUTH_WEEK_MS).ok).toBe(false)
    expect(applyYouthAction(game, { action: 'release', playerId: batch[0].player.id }, NOW + YOUTH_WEEK_MS).ok).toBe(true)
    expect(applyYouthAction(game, { action: 'sign', playerId: batch[2].player.id }, NOW + YOUTH_WEEK_MS).ok).toBe(false)
    expect(game.economy!.balance).toBe(coins)
    expect(game.freeStars.some(p => p.id === batch[0].player.id)).toBe(false)
    expect(game.youth!.members).toHaveLength(7)
  })

  it('青训设施 LV1–LV5 按阶梯提升每期 4.5★+、第 2 名 4.5★+、5.0★ 与 14–15 岁黄金苗子概率', () => {
    const N = 400
    const stats = (stage: number) => {
      let has40 = 0, has45 = 0, two45 = 0, has50 = 0, max45Count = 0
      let goldenCount = 0, goldenYoung = 0, goldenCeilingSum = 0, goldenMin = Infinity, goldenMax = -Infinity
      const game: GameState = {
        ...base,
        seed: 10000 + stage * 97,
        roster: [],
        freeStars: [],
        reserveStars: [],
        aiTeams: [],
        world: undefined,
        matchHistory: [],
        challengeHistory: [],
        youth: undefined,
        season: { ...base.season, fixtures: [] },
        economy: { ...base.economy!, academy: stage },
      }
      ensureYouth(game, NOW)
      game.youth!.members = []
      for (let p = 1; p <= N; p++) {
        settleYouth(game, NOW + p * YOUTH_WEEK_MS)
        const cands = game.youth!.intake.candidates
        const stars = cands.map(c => youthStars(c.ceiling))
        const count45 = stars.filter(s => s >= 4.5).length
        const count50 = stars.filter(s => s >= 5).length
        if (stars.some(s => s >= 4)) has40++
        if (count45 >= 1) has45++
        if (count45 >= 2) two45++
        if (count50 >= 1) has50++
        if (count45 > max45Count) max45Count = count45
        for (const c of cands) {
          if (youthStars(c.ceiling) >= 5) {
            goldenCount++
            if (c.initialAge <= 15) goldenYoung++
            goldenCeilingSum += c.ceiling
            goldenMin = Math.min(goldenMin, c.ceiling)
            goldenMax = Math.max(goldenMax, c.ceiling)
          }
        }
      }
      return {
        has40: has40 / N, has45: has45 / N, two45: two45 / N, has50: has50 / N, max45Count,
        goldenCount, goldenYoungRate: goldenCount ? goldenYoung / goldenCount : 0,
        goldenAvgCeiling: goldenCount ? goldenCeilingSum / goldenCount : 0,
        goldenMin, goldenMax,
      }
    }

    const lv1 = stats(1)
    const lv2 = stats(10)
    const lv3 = stats(11)
    const lv4 = stats(16)
    const lv5 = stats(25)

    // LV1–LV2：100% 保底 4.0★+，4.5★+ 约 25%–40%，5.0★ 约 4%–6%
    expect(lv1.has40).toBe(1)
    expect(lv2.has40).toBe(1)
    expect(lv1.has45).toBeGreaterThan(0.18)
    expect(lv1.has45).toBeLessThan(0.33)
    expect(lv2.has45).toBeGreaterThan(0.32)
    expect(lv2.has45).toBeLessThan(0.48)
    expect(lv1.has50).toBeGreaterThan(0.01)
    expect(lv1.has50).toBeLessThan(0.09)

    // LV3–LV5：100% 保底 1 名 4.5★+，每期最多 2 名防通胀
    for (const lv of [lv3, lv4, lv5]) {
      expect(lv.has45).toBe(1)
      expect(lv.max45Count).toBe(2)
    }
    // 阶梯严格递增：第 2 名 4.5★+ (~25% → ~55% → ~80%) 与 5.0★ (~10% → ~20% → ~35%)
    expect(lv3.two45).toBeGreaterThan(0.18)
    expect(lv3.two45).toBeLessThan(0.33)
    expect(lv4.two45).toBeGreaterThan(0.46)
    expect(lv4.two45).toBeLessThan(0.64)
    expect(lv5.two45).toBeGreaterThan(0.72)
    expect(lv5.two45).toBeLessThan(0.88)
    expect(lv3.has50).toBeLessThan(lv4.has50)
    expect(lv4.has50).toBeLessThan(lv5.has50)
    expect(lv5.has50).toBeGreaterThan(0.27)
    expect(lv5.has50).toBeLessThan(0.43)

    // LV5 满级黄金苗子：CA 上限集中在 270 左右（266–274）且更易刷出 14–15 岁
    expect(lv5.goldenMin).toBeGreaterThanOrEqual(266)
    expect(lv5.goldenMax).toBeLessThanOrEqual(274)
    expect(lv5.goldenAvgCeiling).toBeGreaterThan(268)
    expect(lv5.goldenAvgCeiling).toBeLessThan(272)
    expect(lv5.goldenYoungRate).toBeGreaterThan(0.70)
  })
})

describe('每日成长、设施、方案与比赛', () => {
  it('离线一次补算与每日结算完全一致，重复结算不成长', () => {
    const offline = fixture(), online = fixture()
    settleYouth(offline, NOW + 4 * DAY_MS)
    for (let d = 1; d <= 4; d++) settleYouth(online, NOW + d * DAY_MS)
    expect(offline.youth!.members).toEqual(online.youth!.members)
    const before = JSON.stringify(offline.youth)
    settleYouth(offline, NOW + 4 * DAY_MS)
    expect(JSON.stringify(offline.youth)).toBe(before)
    expect(offline.youth!.members[0].growth).toHaveLength(4)
  })
  it('永不超过个人上限，真实属性同步变化；毕业后停止增长', () => {
    const game = fixture(), member = game.youth!.members[0]
    member.ceiling = member.initialCa + 0.5
    member.endsAt = NOW + 2 * DAY_MS
    settleYouth(game, NOW + 10 * DAY_MS)
    expect(youthCA(member.player)).toBeCloseTo(member.ceiling, 8)
    expect(youthCA(member.player)).toBeLessThanOrEqual(member.ceiling)
    expect(member.player.attrs).toEqual(member.player.baseAttrs)
    expect(member.growth).toHaveLength(2)
    const after = youthCA(member.player)
    settleYouth(game, NOW + 20 * DAY_MS)
    expect(youthCA(member.player)).toBe(after)
  })
  it('位置＋能力决定属性方向，禁止外场门将互转，不重分配已获得属性', () => {
    const game = fixture(), member = game.youth!.members[5]
    expect(validYouthPlan(member.player, { position: 'GK', focus: 'saves' })).toBe(false)
    expect(validYouthPlan(member.player, { position: 'ST', focus: 'saves' })).toBe(false)
    expect(validYouthPlan(member.player, { position: 'MC', focus: 'passing' })).toBe(true)
    const before = structuredClone(member.player.baseAttrs)
    growYouthAttributes(member.player, { position: 'ST', focus: 'passing' }, 1.5, member.ceiling)
    expect(member.player.baseAttrs.passing).toBeGreaterThan(before.passing)
    expect(member.player.baseAttrs.shooting).toBeGreaterThan(before.shooting)
    expect(member.player.baseAttrs.tackling).toBe(before.tackling)
    expect(youthCA(member.player)).toBeCloseTo(member.initialCa + 1.5, 7)
    const other = fixture()
    expect(applyYouthAction(game, { action: 'plan', playerId: member.player.id, plan: { position: 'MC', focus: 'passing' } }, NOW + DAY_MS / 2).ok).toBe(true)
    settleYouth(game, NOW + DAY_MS)
    expect(member.growth[0].plan).toEqual({ position: 'ST', focus: 'balanced' })
    settleYouth(game, NOW + DAY_MS * 2)
    expect(member.growth[1].plan).toEqual({ position: 'MC', focus: 'passing' })
    expect(other.youth!.members[5].plan.position).toBe('ST')
  })
  it('设施仅影响后续周期，不重算过去；固定随机数下概率提高不会降低成长', () => {
    const game = fixture(), other = fixture()
    game.economy!.academy = 25
    settleYouth(game, NOW + 2 * DAY_MS)
    settleYouth(other, NOW + 2 * DAY_MS)
    expect(game.youth!.members.map(m => m.player.baseAttrs)).toEqual(other.youth!.members.map(m => m.player.baseAttrs))
    let low = 0, high = 0
    for (let i = 0; i < 5000; i++) {
      const a = youthDailyRoll(5, 'same-player', i, 1), b = youthDailyRoll(5, 'same-player', i, 25)
      expect(b).toBeGreaterThanOrEqual(a)
      low += a; high += b
    }
    expect(high).toBeGreaterThan(low * 1.04)
    const view = JSON.stringify(youthView(game, NOW))
    expect(view).not.toMatch(/facilities|probability|breakthrough|speed/)
  })
  it('成长曲线支持高潜力苗子在毕业前兑现潜力（14–15 岁稳定满潜，16–17 岁接近潜力，18 岁有效冲刺）', () => {
    const runBand = (age: number, ceiling: number, stage: number) => {
      let sumProgress = 0
      const count = 12
      for (let i = 0; i < count; i++) {
        const game = fixture()
        game.seed = 9000 + i * 31
        game.economy!.academy = stage
        const member = game.youth!.members[0]
        member.initialAge = age
        member.player.age = age
        member.ceiling = ceiling
        member.tier = ceiling >= 255 ? 'genius' : 'excellent'
        member.endsAt = NOW + (19 - age) * YOUTH_WEEK_MS
        settleYouth(game, NOW + 40 * DAY_MS)
        sumProgress += (youthCA(member.player) - member.initialCa) / (member.ceiling - member.initialCa)
      }
      return sumProgress / count
    }
    expect(runBand(15, 270, 1)).toBeGreaterThan(0.98)
    expect(runBand(16, 250, 1)).toBeGreaterThan(0.92)
    expect(runBand(17, 250, 25)).toBeGreaterThan(0.85)
    expect(runBand(18, 250, 1)).toBeGreaterThan(0.50)
  })
  it('只记录真实正式赛事，每周期前90分钟计入，重复战报不重复奖励', () => {
    const game = fixture(), member = game.youth!.members[0]
    const first = record(game, NOW + 1000, 60, 8)
    expect(recordYouthMatch(game, first)).toBe(true)
    expect(recordYouthMatch(game, first)).toBe(false)
    expect(recordYouthMatch(game, { ...first, id: 'friendly', isLeague: false, mode: 'friendly' } as MatchRecord)).toBe(false)
    expect(recordYouthMatch(game, { ...first, id: 'pve', isLeague: false, mode: 'cup', cupId: 'test-cup' })).toBe(false)
    const second = record(game, NOW + 2000, 90, 4, 'official-cup')
    second.isLeague = false; second.mode = 'cup'; second.cupId = 'season-cross'
    expect(recordYouthMatch(game, second)).toBe(true)
    const match = youthMatchFactor(game.youth!, member.player.id, NOW, NOW + DAY_MS)
    expect(match.minutes).toBe(90)
    expect(match.factor).toBeCloseTo(1 + 0.5 * 60 / 90 - 0.1 * 30 / 90)
    const before = member.initialCa
    settleYouth(game, NOW + DAY_MS)
    expect(member.growth[0].minutes).toBe(90)
    expect(member.growth[0].matchFactor).toBeCloseTo(match.factor)
    expect(youthCA(member.player)).toBeGreaterThan(before)
    expect(recordYouthMatch(game, first)).toBe(false)
  })
  it('短出场不会拿满奖励；差表现不扣属性；后卫门将能从本职表现获益', () => {
    const game = fixture()
    recordYouthMatch(game, record(game, NOW + 1000, 5, 10))
    expect(youthMatchFactor(game.youth!, game.youth!.members[0].player.id, NOW, NOW + DAY_MS).factor).toBeCloseTo(1 + 0.5 * 5 / 90)
    const stats = { minutes: 90, rating: 6.5, tackles: 5, interceptions: 5, saves: 5 } as PlayerMatchStats
    expect(youthPerformanceBonus(stats, 'CB')).toBeGreaterThan(youthPerformanceBonus(stats, 'ST'))
    expect(youthPerformanceBonus(stats, 'GK')).toBeGreaterThan(youthPerformanceBonus(stats, 'ST'))
  })
  it('跨日正式比赛未公布时等待，不抢先结算无比赛加成', () => {
    const game = fixture()
    game.shared = true
    const pending = game.season.fixtures.find(f => f.isPlayer)!
    pending.played = false; pending.kickoffAt = NOW + 1000
    settleYouth(game, NOW + DAY_MS)
    expect(game.youth!.members[0].growth).toHaveLength(0)
    recordYouthMatch(game, record(game, NOW + 1000))
    pending.played = true
    settleYouth(game, NOW + DAY_MS)
    expect(game.youth!.members[0].growth[0].minutes).toBe(90)
  })
  it('离线快进保持随机结果不变，不重新抽取成长档位', () => {
    const shifted = fixture(), normal = fixture()
    shiftYouthClock(shifted, DAY_MS)
    settleYouth(shifted, NOW)
    settleYouth(normal, NOW + DAY_MS)
    expect(shifted.youth!.members.map(m => m.player.attrs)).toEqual(normal.youth!.members.map(m => m.player.attrs))
  })
})

describe('征召、提拔、保护与服务器权威', () => {
  it('征召保留成长，返回不重置体能伤停，提拔定型并开放培养', () => {
    const game = fixture(), member = game.youth!.members[1], id = member.player.id
    const rosterSize = game.roster.length
    expect(applyYouthAction(game, { action: 'call_up', playerId: id }, NOW).ok).toBe(true)
    const player = game.roster.find(p => p.id === id)!
    player.condition = 33
    game.injuries = { [id]: NOW + DAY_MS }
    expect(startTraining(game, id, 123, [], 0, false).ok).toBe(false)
    expect(equipCard(game, id, null).ok).toBe(false)
    expect(listPlayer(game, id, 100).ok).toBe(false)
    expect(releasePlayer(game, id).ok).toBe(false)
    expect(applyYouthAction(game, { action: 'return', playerId: id }, NOW).ok).toBe(true)
    expect(member.player.condition).toBe(33)
    expect(game.injuries[id]).toBe(NOW + DAY_MS)
    expect(game.roster.length).toBe(rosterSize)
    expect(applyYouthAction(game, { action: 'call_up', playerId: id }, NOW).ok).toBe(true)
    settleYouth(game, NOW + DAY_MS)
    expect(youthCA(youthPlayer(game, member))).toBeGreaterThan(member.initialCa)
    expect(applyYouthAction(game, { action: 'promote', playerId: id }, NOW + DAY_MS).ok).toBe(true)
    expect(game.youth!.members.some(m => m.player.id === id)).toBe(false)
    const baseCa = youthCA(player)
    settleYouth(game, NOW + 4 * DAY_MS)
    expect(youthCA(player)).toBe(baseCa)
    expect(player.youthOrigin?.promotedAt).toBe(NOW + DAY_MS)
    expect(player.youthOrigin?.transferAfter).toBe(NOW + DAY_MS + YOUTH_WEEK_MS)
    expect(startTraining(game, id, 123, [], 0, false).ok).toBe(true)
    expect(game.training[id].candidate.baseAttrs).toEqual(player.baseAttrs)
  })
  it('阵容锁定、比赛中和一线队人数上限均不能绕过', () => {
    const game = fixture(), id = game.youth!.members[0].player.id
    expect(applyYouthAction(game, { action: 'call_up', playerId: id }, NOW, true).ok).toBe(false)
    while (game.roster.length < SQUAD_LIMIT) game.roster.push({ ...structuredClone(game.roster[0]), id: `filler-${game.roster.length}` })
    expect(applyYouthAction(game, { action: 'call_up', playerId: id }, NOW).ok).toBe(false)
    expect(applyYouthAction(game, { action: 'promote', playerId: id }, NOW).ok).toBe(false)
  })
  it('普通保存不能改青年上限、基础、出身、征召名单、生成假卡或重领初始苗子', () => {
    const previous = fixture(), id = previous.youth!.members[0].player.id
    expect(applyYouthAction(previous, { action: 'call_up', playerId: id }, NOW).ok).toBe(true)
    const incoming = structuredClone(previous)
    incoming.youth!.members[0].ceiling = 9999
    const changed = incoming.roster.find(p => p.id === id)!
    changed.attrs.passing = 9999
    changed.baseAttrs.passing = 9999
    delete changed.youthOrigin
    expect(preserveYouthState(previous, incoming, NOW)).toBeNull()
    expect(incoming.youth).toEqual(previous.youth)
    expect(incoming.roster.find(p => p.id === id)).toEqual(previous.roster.find(p => p.id === id))
    const dropped = structuredClone(previous)
    dropped.roster = dropped.roster.filter(p => p.id !== id)
    expect(preserveYouthState(previous, dropped, NOW)).not.toBeNull()
    const minted = structuredClone(previous)
    minted.roster.push(structuredClone(previous.youth!.members[1].player))
    expect(preserveYouthState(previous, minted, NOW)).not.toBeNull()
    const cards = structuredClone(previous)
    cards.cards = [{ playerId: id } as any]
    expect(preserveYouthState(previous, cards, NOW)).not.toBeNull()
    const oldClient = structuredClone(previous)
    delete oldClient.youth
    expect(preserveYouthState(previous, oldClient, NOW)).toBeNull()
    expect(oldClient.youth).toEqual(previous.youth)
  })
})
