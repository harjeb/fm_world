import { describe, expect, it } from 'vitest'
import { parseDelimited, parseFmTable } from '../src/game/data/fm-csv.ts'
import { ceilingsFromProfile, profileFromFm } from '../src/game/data/attr-profile.ts'
import type { AttrKey } from '../src/game/types.ts'

describe('FM 属性表导入', () => {
  it('识别制表符分隔的 FM 粘贴内容，并跳过重复表头', () => {
    const tsv = [
      'Name\tPosition\tPac\tFin\tPas\tTck\tStr',
      'Erling Haaland\tST (C)\t17\t20\t11\t6\t19',
      'Name\tPosition\tPac\tFin\tPas\tTck\tStr', // FM 复制时表头会重复
      'Kevin De Bruyne\tAM (C)\t12\t15\t20\t9\t13',
    ].join('\n')
    const { rows, matchedHeaders } = parseFmTable(tsv)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ name: 'Erling Haaland', position: 'ST (C)' })
    expect(rows[0].ratings).toEqual({ Pac: 17, Fin: 20, Pas: 11, Tck: 6, Str: 19 })
    expect(matchedHeaders).toContain('Pac')
  })

  it('支持逗号 CSV、BOM 与带引号的姓名', () => {
    const csv = '\uFEFFName,Position,Passing,Finishing,Reflexes\n"Smith, John",GK,9,2,19\n'
    const { rows } = parseFmTable(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Smith, John')
    expect(rows[0].ratings.Reflexes).toBe(19)
  })

  it('丢弃越界数值与统计列，避免把比赛数据当属性', () => {
    const csv = [
      'Name,Position,Passing,Minutes,Transfer Value',
      'A Player,MC,15,2140,45000000',
    ].join('\n')
    const { rows, ignoredHeaders } = parseFmTable(csv)
    expect(rows[0].ratings).toEqual({ Passing: 15 })
    expect(ignoredHeaders).toEqual(['Minutes', 'Transfer Value'])
  })

  it('纯统计表（无属性列）不会产出球员行', () => {
    const csv = 'Name,Position,Minutes,Goals per 90\nA Player,MC,2140,0.4'
    const { rows, matchedHeaders } = parseFmTable(csv)
    expect(matchedHeaders).toHaveLength(0)
    expect(rows).toHaveLength(0)
  })

  it('中文表头同样可以映射', () => {
    const { rows } = parseFmTable('姓名,位置,传球,射门,速度\n张三,前锋,12,18,16')
    expect(rows[0].ratings).toEqual({ 传球: 12, 射门: 18, 速度: 16 })
    expect(profileFromFm(rows[0].ratings).shooting!).toBeGreaterThan(0.9)
  })

  it('同一份数据不会重复计入同维度，取最高分', () => {
    // Passing 20 与 Crossing 5 都映射到 passing
    const profile = profileFromFm({ Passing: 20, Crossing: 5, Dribbling: 10 })
    expect(profile.passing).toBeCloseTo(1, 6)
    expect(profile.dribbling!).toBeLessThan(0.6)
  })

  it('不同画像给出不同的属性上限形状', () => {
    const striker = profileFromFm({ Finishing: 20, Pace: 18, Passing: 8, Tackling: 4 })
    const playmaker = profileFromFm({ Finishing: 8, Pace: 9, Passing: 20, Tackling: 6 })
    const current = Object.fromEntries(
      ['passing', 'shooting', 'dribbling', 'tackling', 'strength', 'speed'].map(key => [key, 600]),
    ) as Record<AttrKey, number>
    const a = ceilingsFromProfile(current as never, striker, { tier: 5, isGk: false })
    const b = ceilingsFromProfile(current as never, playmaker, { tier: 5, isGk: false })
    expect(a.shooting).toBeGreaterThan(b.shooting)
    expect(b.passing).toBeGreaterThan(a.passing)
  })

  it('parseDelimited 自动识别分隔符', () => {
    expect(parseDelimited('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseDelimited('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']])
  })
})
