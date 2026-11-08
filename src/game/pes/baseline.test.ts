import { describe, expect, it } from 'vitest'
import baseline from './baseline.json'
import { BASELINE_FACTORS, BASELINE_MATCHES, BASELINE_RULES, GOLDEN_MATCHES, baselineTeams, simulateOne, type BatchResult } from './baseline.ts'

const batches = baseline.batches as unknown as BatchResult[]
const find = (rules: number, factor: number) => {
  const batch = batches.find((item) => item.rules === rules && item.awayFactor === factor)
  if (!batch) throw new Error(`基线里没有 v${rules} 客队×${factor}`)
  return batch
}

describe('现有引擎基线（已提交的 baseline.json）', () => {
  it('v3 和 v2 各 3 档实力差，每档不少于 200 场', () => {
    expect(batches).toHaveLength(BASELINE_RULES.length * BASELINE_FACTORS.length)
    for (const rules of BASELINE_RULES) {
      for (const factor of BASELINE_FACTORS) {
        const batch = find(rules, factor)
        expect(batch.n).toBeGreaterThanOrEqual(BASELINE_MATCHES)
        const r = batch.results
        expect(r.homeWins + r.draws + r.awayWins).toBe(batch.n)
        expect(batch.golden).toHaveLength(GOLDEN_MATCHES)
      }
    }
  })

  it('数值在合理范围内（防止拿一份坏数据当基线）', () => {
    for (const batch of batches) {
      const r = batch.results
      expect(r.goals[2], `v${batch.rules} 每场进球`).toBeGreaterThan(1)
      expect(r.goals[2]).toBeLessThan(6)
      expect(r.shots[2]).toBeGreaterThan(10)
      expect(r.shots[2]).toBeLessThan(40)
      expect(r.passAccuracyPct[0]).toBeGreaterThan(40)
      expect(r.passAccuracyPct[0]).toBeLessThan(90)
      expect(r.scoreless).toBeLessThan(batch.n * 0.3)
    }
  })

  it('客队越弱，主队越容易赢', () => {
    for (const rules of BASELINE_RULES) {
      const win = (factor: number) => find(rules, factor).results.homeWins / find(rules, factor).n
      expect(win(0.93)).toBeGreaterThan(win(1))
      expect(win(0.87)).toBeGreaterThan(win(0.93) - 0.03)
      expect(win(0.87)).toBeGreaterThan(win(1) + 0.1)
    }
  })
})

describe('现有引擎的确定性', () => {
  it('同种子跑两次，比分、统计、日志逐位一致', () => {
    const { home, away } = baselineTeams(1)
    for (const rules of BASELINE_RULES) {
      const first = simulateOne(rules, 7000, structuredClone(home), structuredClone(away))
      const second = simulateOne(rules, 7000, structuredClone(home), structuredClone(away))
      expect(second).toEqual(first)
    }
  })
})

/**
 * 金标准回归：重新模拟基线里记录的比赛，比分、统计、日志哈希必须与记录一致。
 * 这是阶段 1（结算内核抽取）的安全网——重构不允许改变旧引擎的任何输出。
 * 默认跳过：改世界生成、球员数据或有意调整引擎平衡都会让它失败，不该挡住日常开发。
 * 开启：PES_GOLDEN=1 npx vitest run src/game/pes（PowerShell：$env:PES_GOLDEN=1; npx vitest run src/game/pes）。
 * 有意改了引擎后用 npm run pes:baseline 重新生成基线。
 */
describe.skipIf(!process.env.PES_GOLDEN)('金标准回归（PES_GOLDEN=1）', () => {
  for (const rules of BASELINE_RULES) {
    it(`v${rules} 镜像对阵的 ${GOLDEN_MATCHES} 场与基线逐位一致`, () => {
      const { home, away } = baselineTeams(1)
      for (const golden of find(rules, 1).golden) {
        const now = simulateOne(rules, golden.seed, structuredClone(home), structuredClone(away))
        expect(now, `v${rules} 种子 ${golden.seed}`).toEqual(golden)
      }
    }, 60_000)
  }
})
