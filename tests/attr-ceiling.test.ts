import { describe, expect, it } from 'vitest'
import {
  ceilingsFromProfile,
  fmRatingToWeight,
  normalizeCeilings,
  profileFromFm,
  profileFromWeights,
} from '../src/game/data/attr-profile.ts'
import { createPlayerFromSeed, PLAYER_SEEDS } from '../src/game/data/players.ts'
import { attrMax } from '../src/game/scale.ts'
import type { AttrKey, Attributes } from '../src/game/types.ts'

const blank = (value: number): Attributes => {
  const keys = Object.keys(createPlayerFromSeed(PLAYER_SEEDS[0]).attrs) as AttrKey[]
  return Object.fromEntries(keys.map(key => [key, value])) as Attributes
}

describe('属性上限映射', () => {
  it('FM 1-20 分映射为 0-1 权重，且单调递增', () => {
    expect(fmRatingToWeight(1)).toBe(0)
    expect(fmRatingToWeight(20)).toBeCloseTo(1, 6)
    const series = [1, 5, 10, 15, 20].map(fmRatingToWeight)
    for (let i = 1; i < series.length; i++) expect(series[i]).toBeGreaterThan(series[i - 1])
    // 非法值回退默认权重，不产生 NaN
    expect(Number.isFinite(fmRatingToWeight(Number.NaN))).toBe(true)
  })

  it('FM 属性名合并到本作属性，同一属性取较高分', () => {
    const profile = profileFromFm({ Passing: 20, Crossing: 4, Finishing: 18, Reflexes: 3 })
    expect(profile.passing).toBeCloseTo(1, 6) // 20 分胜出，不被 4 分的 Crossing 拉低
    expect(profile.shooting!).toBeGreaterThan(0.8)
  })

  it('画像归一化：最高权重为 1，其余按比例', () => {
    const profile = profileFromWeights({ passing: 0.8, shooting: 0.4, speed: 0 })
    expect(profile.passing).toBeCloseTo(1, 6)
    expect(profile.shooting).toBeCloseTo(0.5, 6)
    expect(profile.speed).toBe(0)
  })

  it('强项上限高于弱项，且每个人上限不同', () => {
    const player = createPlayerFromSeed(PLAYER_SEEDS[0])
    const isGk = player.positions.GK > 0
    const ceilings = ceilingsFromProfile(player.attrs, { passing: 1, shooting: 0.1 }, { tier: 3, isGk })
    expect(ceilings.passing).toBeGreaterThan(ceilings.shooting)
    for (const key of Object.keys(ceilings) as AttrKey[]) {
      expect(Number.isFinite(ceilings[key])).toBe(true)
      expect(ceilings[key]).toBeLessThanOrEqual(attrMax(key, isGk))
      if (!isGk && player.attrs[key] === 0) expect(ceilings[key]).toBe(0)
    }
  })

  it('500 名球员的主属性上限互不相同，且不统一到 1500', () => {
    const main = ['passing', 'shooting', 'dribbling', 'tackling', 'strength', 'speed'] as AttrKey[]
    const values = PLAYER_SEEDS.map(createPlayerFromSeed)
      .filter(player => player.positions.GK === 0)
      .flatMap(player => main.map(key => player.ceilings[key]))
    expect(new Set(values.map(value => Math.round(value))).size).toBeGreaterThan(100)
    expect(values.every(value => value < 1500)).toBe(true)
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(300)
  })

  it('上限修正不会把球员冻在当前属性之下，也不会超过绝对上限', () => {
    const current = blank(300)
    const ceilings = { ...current, passing: 100, shooting: 9999, speed: Number.NaN } as Attributes
    const fixed = normalizeCeilings(current, ceilings, key => attrMax(key, false))
    expect(fixed.passing).toBe(300) // 上限低于当前属性时抬到当前值，避免无法成长/数值倒挂
    expect(fixed.shooting).toBe(1500)
    expect(fixed.speed).toBe(1500) // 非法值回退绝对上限
  })
})
