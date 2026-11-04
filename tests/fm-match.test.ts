import { describe, expect, it } from 'vitest'
import { parseFmTable } from '../src/game/data/fm-csv.ts'
import { matchFmRows, normalizePlayerName } from '../src/game/data/fm-match.ts'
import { profileFromFm } from '../src/game/data/attr-profile.ts'

/**
 * 针对「游戏数据库直出宽表」的格式测试：
 * 表头是 `技术_传球_passing` 这种中英混排，带 CA/PA 和出生日期，
 * 属性 0 表示未设定，需要丢弃。
 */
const header = [
  '球员ID_uid', '姓名', '名', '姓', '出生日期_推测', '当前能力_CA_原始', '潜力_PA_原始',
  '原始属性_非零数量', '位置_评分至少15',
  '技术_传球_passing', '技术_射门_finishing', '技术_盘带_dribbling', '精神_决断_decisions',
  '身体_速度_pace', '门将_反应_reflexes', '位置熟练度_GK',
].join(',')

const row = (name: string, first: string, last: string, birth: string, ca: string, values: (number | string)[]): string =>
  ['1', name, first, last, birth, ca, '150', '10', 'ST; AMC', ...values].join(',')

describe('数据库直出宽表', () => {
  it('中英混排表头按最后一段英文名映射到本作属性', () => {
    const csv = [header, row('Erling Braut Haaland', 'Erling', 'Haaland', '2000-07-21', '188', [12, 20, 13, 15, 18, 3, 1])].join('\n')
    const { rows, matchedHeaders } = parseFmTable(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].ratings['技术_传球_passing']).toBe(12)
    expect(matchedHeaders).toEqual([
      '技术_传球_passing', '技术_射门_finishing', '技术_盘带_dribbling',
      '精神_决断_decisions', '身体_速度_pace', '门将_反应_reflexes',
    ])
    // 位置熟练度_GK 是 0-20 的熟练度，没有对应维度，必须忽略
    expect(matchedHeaders).not.toContain('位置熟练度_GK')
  })

  it('读出 CA/PA 与出生年份，属性 0 视为未设定丢弃', () => {
    const csv = [header, row('Test Player', 'Test', 'Player', '1995-01-20', '120', [0, 15, 0, 9, 14, 0, 20])].join('\n')
    const { rows } = parseFmTable(csv)
    expect(rows[0]).toMatchObject({ ca: 120, pa: 150, birthYear: 1995 })
    expect(rows[0].ratings).toEqual({ '技术_射门_finishing': 15, '精神_决断_decisions': 9, '身体_速度_pace': 14 })
  })

  it('Passing / Pac 之类的列不会被误当成 PA/CA', () => {
    const csv = 'Name,Position,Pac,Fin,Passing,POT\nA Player,ST,17,20,11,180'
    const { rows } = parseFmTable(csv)
    expect(rows[0].ratings).toEqual({ Pac: 17, Fin: 20, Passing: 11 })
    expect(rows[0].pa).toBeUndefined()
  })

  it('画像由识别出的维度生成', () => {
    const csv = [header, row('Test Player', 'Test', 'Player', '1995-01-20', '120', [10, 20, 12, 8, 18, 1, 1])].join('\n')
    const profile = profileFromFm(parseFmTable(csv).rows[0].ratings)
    expect(profile.shooting!).toBeGreaterThan(profile.passing!)
    expect(profile.speed!).toBeGreaterThan(profile.decisions!)
  })
})

describe('球员名匹配', () => {
  // 带上「位置」列：宽松规则（只给姓、门将）要靠它挡掉同名的外场球员。
  const csv = [
    'Name,Born,CA,Position,Passing',
    'Thiago Emiliano da Silva,1984-09-22,172,DC,14',
    'Thiago Silva de Paiva,1998-05-04,93,MC,9',
    'Neymar da Silva Santos Júnior,1992-02-05,175,AML; ST,17',
    'Roy-Keane Avontuur,2001-03-11,52,MC,6',
    'Cristiano Ronaldo dos Santos Aveiro,1985-02-05,160,ST,15',
    'Rodrygo Silva de Goes,2001-01-09,168,AMR; ST,12',
    'Rodrygo Costa,2003-04-02,41,MC,7',
    'Kasper Peter Schmeichel,1986-11-05,140,GK,7',
    "N'Golo Kanté,1991-03-29,160,DM; MC,16",
    'Cédric Kanté,1979-09-11,125,DC,10',
    'Dani Parejo,1989-04-16,138,MC,16',
    'Simone Pepe,1983-08-30,145,AML; AMR,12',
    'Pau Cendrós López,1989-04-06,97,DC,8',
    'Pau López Sabata,1994-12-13,142,GK,9',
    // 别名表用的两条：绰号（Koke）与「姓不在末尾」（Canales → …Madrazo）
    'Jorge Resurrección Merodio,1992-01-08,157,MC,16',
    'Sergio Canales Madrazo,1991-02-16,155,MC,15',
  ].join('\n')

  it('去重音、去标点，但保留连字符的单词边界', () => {
    expect(normalizePlayerName('Júlio César')).toBe('julio cesar')
    expect(normalizePlayerName("N'Golo Kanté")).toBe('ngolo kante')
    expect(normalizePlayerName('Roy-Keane Avontuur')).toBe('roykeane avontuur')
  })

  it('首尾一致优先：Thiago Silva 命中真实球员而非同名小将', () => {
    const { matched } = matchFmRows([{ name: 'Thiago Silva', era: '2010s' }], parseFmTable(csv).rows)
    expect(matched.get('Thiago Silva')?.name).toBe('Thiago Emiliano da Silva')
  })

  it('Jr / Júnior 归一后可以匹配', () => {
    const { matched } = matchFmRows([{ name: 'Neymar Jr', era: '2010s' }], parseFmTable(csv).rows)
    expect(matched.get('Neymar Jr')?.name).toBe('Neymar da Silva Santos Júnior')
  })

  it('后缀扩展匹配：Cristiano Ronaldo 命中全名', () => {
    const { matched, fallback } = matchFmRows([{ name: 'Cristiano Ronaldo', era: '2010s' }], parseFmTable(csv).rows)
    expect(matched.get('Cristiano Ronaldo')?.name).toBe('Cristiano Ronaldo dos Santos Aveiro')
    expect(fallback).toContain('Cristiano Ronaldo')
  })

  it('单段名只接受顶级联赛候选，且不会误吞同姓的父辈', () => {
    const { matched, missing } = matchFmRows(
      [{ name: 'Rodrygo', era: '2020s' }, { name: 'Peter Schmeichel', era: '1990s' }],
      parseFmTable(csv).rows,
    )
    expect(matched.get('Rodrygo')?.name).toBe('Rodrygo Silva de Goes')
    // 库里只有儿子 Kasper，父亲不应被冒名顶替
    expect(missing).toContain('Peter Schmeichel')
  })

  it('连字符名字不会被拆词误配（Roy Keane ≠ Roy-Keane Avontuur）', () => {
    const { matched } = matchFmRows([{ name: 'Roy Keane', era: '2000s' }], parseFmTable(csv).rows)
    expect(matched.has('Roy Keane')).toBe(false)
  })

  it('缩写名按「首字母 + 姓」匹配：N. Kanté 命中 N\'Golo 而不是 Cédric', () => {
    const { matched } = matchFmRows([{ name: 'N. Kanté', era: '2020s', pos: 'CM' }], parseFmTable(csv).rows)
    expect(matched.get('N. Kanté')?.name).toBe("N'Golo Kanté")
  })

  it('只给姓的种子也能匹配（Parejo → Dani Parejo），位置对不上则放弃', () => {
    const { matched, missing } = matchFmRows(
      [{ name: 'Parejo', era: '2020s', pos: 'CM' }, { name: 'Pepe', era: '2010s', pos: 'CB' }],
      parseFmTable(csv).rows,
    )
    expect(matched.get('Parejo')?.name).toBe('Dani Parejo')
    // Simone Pepe 是边锋，位置对不上 CB，宁可回落也不要串人
    expect(missing).toContain('Pepe')
  })

  it('别名表把绰号接到法定全名（Koke、Canales）', () => {
    const { matched, aliased } = matchFmRows(
      [{ name: 'Koke', era: '2010s', pos: 'CM' }, { name: 'Canales', era: '2010s', pos: 'CM' }],
      parseFmTable(csv).rows,
    )
    expect(matched.get('Koke')?.name).toBe('Jorge Resurrección Merodio')
    expect(matched.get('Canales')?.name).toBe('Sergio Canales Madrazo')
    expect(aliased).toEqual(['Koke', 'Canales'])
  })

  it('门将种子必须位置也对得上（Pau López 不会撞上 Pau Cendrós López）', () => {
    const { matched } = matchFmRows([{ name: 'Pau López', era: '2020s', pos: 'GK' }], parseFmTable(csv).rows)
    expect(matched.get('Pau López')?.name).toBe('Pau López Sabata')
  })
})
