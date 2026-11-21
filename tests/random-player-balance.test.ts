import { describe, expect, it } from 'vitest'
import { caOf } from '../src/game/ca.ts'
import {
  PLAYER_SEEDS,
  RANDOM_BASE_CA_MAX,
  RANDOM_BASE_CA_MIN,
  createPlayerFromSeed,
  rescaleLegacyRandomPlayer,
} from '../src/game/data/players.ts'
import { createRandomPlayer } from '../src/game/data/random-players.ts'
import { RANDOM_PLAYER_VALUE_SCALE, basePlayerMarketValue, playerMarketValue } from '../src/game/pricing.ts'
import { minimumBid } from '../src/game/auction.ts'
import { POSITIONS, type SeasonTableRow } from '../src/game/types.ts'
import { leagueTable } from '../src/ui/components.ts'
import { renderPlayerComparison } from '../src/ui/screens/player-comparison.ts'
import { createInitialGame } from '../src/game/state.ts'
import { game as originalGame, setGame } from '../src/ui/state.ts'

describe('方案 A：随机球员基础 CA 与转会市场身价分层', () => {
  it('随机球员 1–4 档基础 CA 严格落在 175–230 且档位递增，永不混入 260–270 球星档', () => {
    const medians: number[] = []
    for (const tier of [1, 2, 3, 4]) {
      const cas: number[] = []
      for (const position of POSITIONS) {
        for (let i = 0; i < 40; i++) {
          const p = createRandomPlayer({ seed: 2000 + tier * 500 + i * 13, position, tier })
          const gk = position === 'GK'
          const ca = caOf(p.baseAttrs, gk)
          expect(ca).toBeGreaterThanOrEqual(RANDOM_BASE_CA_MIN - 0.8)
          expect(ca).toBeLessThanOrEqual(RANDOM_BASE_CA_MAX + 0.8)
          expect(ca).toBeLessThan(235)
          expect(p.baseAttrs).toEqual(p.attrs)
          cas.push(ca)
        }
      }
      cas.sort((a, b) => a - b)
      medians.push(cas[Math.floor(cas.length / 2)])
    }
    expect(medians[0]).toBeLessThan(medians[1])
    expect(medians[1]).toBeLessThan(medians[2])
    expect(medians[2]).toBeLessThan(medians[3])
    expect(medians[3]).toBeLessThanOrEqual(230)
  })

  it('随机球员身价按 0.75× 折价显著低于真实球星，真实球星与青训苗子保持全额估值', () => {
    const t4Random = createRandomPlayer({ seed: 9001, position: 'ST', tier: 4 })
    const t4Star = createPlayerFromSeed(PLAYER_SEEDS.find((s) => s.tier === 4 && s.pos === 'ST')!)
    expect(basePlayerMarketValue(t4Random)).toBeLessThanOrEqual(450_000)
    expect(minimumBid(t4Random)).toBe(basePlayerMarketValue(t4Random))
    expect(basePlayerMarketValue(t4Star)).toBeGreaterThan(1_500_000)

    // 同属性下：随机球员估值约等于球星/青训估值的 RANDOM_PLAYER_VALUE_SCALE 倍
    const fullVal = playerMarketValue({ attrs: t4Random.attrs, positions: t4Random.positions })
    const randVal = playerMarketValue(t4Random)
    expect(randVal).toBeCloseTo(Math.round((fullVal * RANDOM_PLAYER_VALUE_SCALE) / 1000) * 1000, -3)

    // 青训球员不吃随机球员折价
    const youth = {
      ...structuredClone(t4Random),
      youthOrigin: { club: '青训营', enrolledAt: 1, transferAfter: 2 },
    }
    expect(basePlayerMarketValue(youth)).toBe(fullVal)
  })

  it('rescaleLegacyRandomPlayer 回调旧版 265 基础 CA 随机人并保留 AI 训练增量，不碰球星与青训', () => {
    const sample = createRandomPlayer({ seed: 4242, position: 'CM', tier: 4 })
    // 人为构造旧版 CA=265 的存量随机球员 + AI 已练出额外属性
    const cur = caOf(sample.baseAttrs, false)
    const inflate = Math.sqrt(265 / cur)
    for (const key of Object.keys(sample.baseAttrs) as (keyof typeof sample.baseAttrs)[]) {
      sample.baseAttrs[key] = Math.round(sample.baseAttrs[key] * inflate * 10) / 10
      sample.attrs[key] = Math.round((sample.baseAttrs[key] + (key === 'passing' ? 120 : 0)) * 10) / 10
    }
    sample.equippedCardId = 'ai-card-1'
    const oldVal = basePlayerMarketValue(sample)
    expect(caOf(sample.baseAttrs, false)).toBeGreaterThan(260)

    expect(rescaleLegacyRandomPlayer(sample)).toBe(true)
    const newBaseCa = caOf(sample.baseAttrs, false)
    expect(newBaseCa).toBeLessThanOrEqual(RANDOM_BASE_CA_MAX + 0.5)
    expect(newBaseCa).toBeGreaterThanOrEqual(215)
    // AI 训练带来的传球增量保留
    expect(sample.attrs.passing - sample.baseAttrs.passing).toBeCloseTo(120, 0)
    // 市场身价大幅下降
    expect(basePlayerMarketValue(sample)).toBeLessThan(oldVal * 0.25)

    // 真实球星与青训不被回调
    const star = createPlayerFromSeed(PLAYER_SEEDS[0])
    expect(rescaleLegacyRandomPlayer(star)).toBe(false)
    const youth = { ...structuredClone(sample), youthOrigin: { club: '测试', enrolledAt: 1, transferAfter: 2 } }
    expect(rescaleLegacyRandomPlayer(youth)).toBe(false)
  })

  it('三级联赛积分榜区间色带准确分层，隐藏属性行带独立样式类', () => {
    const rows: SeasonTableRow[] = Array.from({ length: 20 }, (_, i) => ({
      teamId: `t${i + 1}`,
      name: `球队${i + 1}`,
      played: 38,
      won: 20 - i,
      drawn: 5,
      lost: 13 + i,
      gf: 50 - i,
      ga: 30 + i,
      points: 65 - i * 3,
    }))
    const d2Html = leagueTable(rows, { tier: 'division2' })
    expect(d2Html.match(/class="num rank zone-playoff"/g)).toHaveLength(3)
    expect(d2Html.match(/class="num rank zone-cup"/g)).toHaveLength(5)
    expect(d2Html).toContain('升级杯区（前 3）')
    expect(d2Html).toContain('社区杯区（第 6 轮前 8）')

    const d1Html = leagueTable(rows, { tier: 'division1' })
    expect(d1Html.match(/class="num rank zone-promote"/g)).toHaveLength(3)
    expect(d1Html.match(/class="num rank zone-cup"/g)).toHaveLength(5)
    expect(d1Html.match(/class="num rank zone-relegate"/g)).toHaveLength(3)

    const chHtml = leagueTable(rows, { tier: 'champions' })
    expect(chHtml.match(/class="num rank zone-champion"/g)).toHaveLength(1)
    expect(chHtml.match(/class="num rank zone-legend"/g)).toHaveLength(3)
    expect(chHtml.match(/class="num rank zone-relegate"/g)).toHaveLength(3)

    // 球员对比属性表：隐藏属性行带 pc-attr-hidden，主属性行不带
    const g = createInitialGame(777)
    setGame(g)
    try {
      const outfield = g.roster.filter((p) => p.positions.GK === 0)
      const cmp = renderPlayerComparison(outfield[0], outfield[1], outfield, 'attributes')
      expect(cmp).toContain('<tr class="pc-attr-hidden"><th>视野</th>')
      expect(cmp).toContain('<tr><th>传球</th>')
    } finally {
      setGame(originalGame)
    }
  })
})
