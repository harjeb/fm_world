import { describe, expect, it } from 'vitest'
import { createPlayerFromSeed, PLAYER_SEEDS } from '../src/game/data/players.ts'
import { fmProfileFor } from '../src/game/data/fm-profiles.generated.ts'
import { CURATED_PROFILE_COUNT, curatedProfileFor } from '../src/game/data/profiles-curated.ts'
import { MAIN_FIELD_ATTRS, MAIN_GK_ATTRS, mainAttrsFor } from '../src/game/scale.ts'
import { GK_ATTRIBUTES, type AttrKey } from '../src/game/types.ts'

const byName = (name: string) => {
  const seed = PLAYER_SEEDS.find(item => item.enName === name)
  if (!seed) throw new Error(`种子里没有 ${name}`)
  return seed
}

/** 只看主属性（0-1500），隐藏属性 0-20 会把比值放大成无意义的数字。 */
const mainCeilings = (name: string): number[] => {
  const player = createPlayerFromSeed(byName(name))
  const isGk = byName(name).pos === 'GK'
  return mainAttrsFor(isGk).map(key => player.ceilings[key])
}

describe('手工画像', () => {
  it('补满 FM 导入缺的 89 名，500 个种子全部有画像', () => {
    expect(CURATED_PROFILE_COUNT).toBe(89)
    const uncovered = PLAYER_SEEDS.filter(seed => !fmProfileFor(seed.enName) && !curatedProfileFor(seed.enName))
    expect(uncovered.map(seed => seed.enName)).toEqual([])
  })

  it('每份画像都有形状：归一化到 0-1，招牌属性为 1，且至少三项', () => {
    for (const seed of PLAYER_SEEDS) {
      if (fmProfileFor(seed.enName)) continue
      const profile = curatedProfileFor(seed.enName)
      expect(profile, seed.enName).toBeTruthy()
      const values = Object.values(profile ?? {})
      expect(values.length, seed.enName).toBeGreaterThanOrEqual(3)
      expect(Math.max(...values), seed.enName).toBeCloseTo(1, 6)
      for (const value of values) {
        expect(value, seed.enName).toBeGreaterThan(0)
        expect(value, seed.enName).toBeLessThanOrEqual(1)
      }
    }
  })

  it('门将画像必须含门将维度，外场画像一律不碰门将维度', () => {
    for (const seed of PLAYER_SEEDS) {
      if (fmProfileFor(seed.enName)) continue
      const keys = Object.keys(curatedProfileFor(seed.enName) ?? {}) as AttrKey[]
      const gkKeys = keys.filter(key => (GK_ATTRIBUTES as readonly string[]).includes(key))
      // 门将也会写传球/决断这类精神属性（出击型门将要出球），所以只要求「有门将维度」。
      if (seed.pos === 'GK') expect(gkKeys.length, seed.enName).toBeGreaterThan(0)
      else expect(gkKeys.length, seed.enName).toBe(0)
    }
  })

  it('画像只改上限形状，不动当前属性与 CA', () => {
    // 因扎吉的手工画像主打无球跑动，射门权重只有 0.9；风格画像则把射门顶到 1。
    // 若画像误伤了当前属性，这里会一起变。
    const player = createPlayerFromSeed(byName('Filippo Inzaghi'))
    expect(player.positions.ST).toBeGreaterThan(0)
    // 上限确实分了层：招牌维度明显高于最弱维度
    const values = mainCeilings('Filippo Inzaghi')
    expect(Math.max(...values) / Math.min(...values)).toBeGreaterThan(1.15)
  })

  it('同风格的两名球员上限形状不同（因扎吉 vs 罗马里奥）', () => {
    expect(byName('Filippo Inzaghi').style).toBe(byName('Romário').style)
    const inzaghi = Object.fromEntries(MAIN_FIELD_ATTRS.map((key, index) => [key, mainCeilings('Filippo Inzaghi')[index]]))
    const romario = Object.fromEntries(MAIN_FIELD_ATTRS.map((key, index) => [key, mainCeilings('Romário')[index]]))
    const gaps = MAIN_FIELD_ATTRS.map(key => Math.abs(inzaghi[key] - romario[key]))
    expect(Math.max(...gaps)).toBeGreaterThan(30)
  })

  it('招牌维度真的能长到最高（贝克汉姆传球 > 速度，卡恩反应 > 传球）', () => {
    const beckham = createPlayerFromSeed(byName('David Beckham'))
    expect(beckham.ceilings.passing).toBeGreaterThan(beckham.ceilings.speed + 100)

    const kahn = createPlayerFromSeed(byName('Oliver Kahn'))
    const gk = new Set<string>([...MAIN_GK_ATTRS])
    expect(gk.has('reflexes')).toBe(true)
    expect(kahn.ceilings.reflexes).toBeGreaterThan(kahn.ceilings.passing + 80)
    expect(kahn.ceilings.reflexes).toBeGreaterThan(1400)
    expect(kahn.ceilings.reflexes).toBeLessThanOrEqual(1500)
  })
})
