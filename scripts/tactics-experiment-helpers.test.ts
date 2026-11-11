import { describe, expect, it } from 'vitest'
import { baselineTeams } from '../src/game/pes/baseline.ts'
import { defaultOutputPath, keyOf, makeExactMirror } from './tactics-experiment-helpers.ts'

describe('战术实验夹具与索引', () => {
  it('严格镜像复制阵型、完整球员、槽位和替补，但保留球队身份且不共享引用', () => {
    const { home, away } = baselineTeams(1)
    const awayId = away.id
    // 因旧基线会对客队属性四舍五入，不能把同一 ID 当作逐项相同。
    expect(away.starters.map((s) => s.player.attrs)).not.toEqual(home.starters.map((s) => s.player.attrs))
    makeExactMirror(home, away)
    expect(away.id).toBe(awayId)
    expect(away.formationId).toBe(home.formationId)
    expect(away.tactics).toEqual(home.tactics)
    expect(away.starters).toEqual(home.starters)
    expect(away.bench).toEqual(home.bench)
    away.starters[0].player.attrs.passing += 1
    expect(away.starters[0].player.attrs.passing).not.toBe(home.starters[0].player.attrs.passing)
  })

  it('中性对照缺省值与显式值共用同一键，对手和主客不同则分开', () => {
    const base = { scenario: 'mirror' as const, aConfig: 'control', famA: 1, seed: 3, aHome: true }
    expect(keyOf(base)).toBe('mirror|control|1|blank|1|3|true')
    expect(keyOf(base)).toBe(keyOf({ ...base, bConfig: 'blank', famB: 1 }))
    expect(keyOf(base)).not.toBe(keyOf({ ...base, bConfig: 'highPress' }))
    expect(keyOf(base)).not.toBe(keyOf({ ...base, famB: 0.7 }))
    expect(keyOf(base)).not.toBe(keyOf({ ...base, aHome: false }))
  })

  it('基线、统一属性及严格镜像不会写入同一个默认结果文件', () => {
    const name = 'tactics-experiment-matrix'
    expect(defaultOutputPath(name, 0, false)).toBe('docs/tactics-experiment-matrix.json')
    expect(defaultOutputPath(name, 67, false)).toBe('docs/tactics-experiment-matrix-squad67.json')
    expect(defaultOutputPath(name, 67, true)).toBe('docs/tactics-experiment-matrix-squad67-mirror.json')
    expect(defaultOutputPath(name, 0, true)).toBe('docs/tactics-experiment-matrix-mirror.json')
  })
})
