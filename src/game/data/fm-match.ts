import type { FmRow } from './fm-csv.ts'

/**
 * 把外部球员表匹配到本作的球员种子。
 *
 * 匹配只用名字，与属性无关；规则分两轮：
 *   1. 全名精确匹配（去掉重音、标点、大小写差异，中文名保留）；
 *   2. 姓氏回落——只在该姓氏在本作里唯一、且名字首段一致时启用，
 *      用来兜住「Zinedine Zidane → Zinedine Yazid Zidane」这种全名不一致的情况。
 *
 * 同名多行（官方库 + 复古库各有一份）时保留 CA 较高的那行，即巅峰期数据。
 */

export function normalizePlayerName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // 连字符与撇号直接删掉而不是变空格：'Roy-Keane' 不能被当成 'Roy' + 'Keane'。
    .replace(/[’'`\-]/g, '')
    .replace(/[^A-Za-z0-9\u4e00-\u9fff]+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * 手工别名表：种子里写的是绰号或惯用名，数据库里只有法定全名，
 * 姓也不在末尾（Canales → Sergio Canales Madrazo），任何规则都兜不住。
 *
 * 只收录**已在导出表里核实过**的球员，逐条对应，不做模糊猜测。
 */
const ALIAS_SOURCE: Record<string, string> = {
  Casemiro: 'Carlos Henrique Casimiro',
  Rodri: 'Rodrigo Hernández Cascante',
  Hulk: 'Givanildo Vieira de Sousa',
  Jorginho: 'Jorge Luiz Frello Fillho',
  Vitinha: 'Vítor Machado Ferreira',
  Marquinhos: 'Marcos Aoas Corrêa',
  'Lucas Paquetá': 'Lucas Tolentino Coelho de Lima',
  Miranda: 'João Miranda de Souza Filho',
  Sidnei: 'Sídnei Rechel da Silva Júnior',
  Raphinha: 'Raphael Dias Belloli',
  Grimaldo: 'Alejandro Grimaldo García',
  Azpilicueta: 'César Azpilicueta Tanco',
  'De Marcos': 'Óscar de Marcos Arana',
  Jonny: 'Jonathan Castro Otto',
  'Hwang Hee Chan': 'Hee-Chan Hwang',
  Deulofeu: 'Gerard Deulofeu Lázaro',
  'A. Gignac': 'André-Pierre Gignac',
  'D. Payet': 'Dimitri Payet',
  'M. Thuram': 'Marcus Lilian Thuram-Ulien',
  Coutinho: 'Philippe Coutinho Correia',
  Paulinho: 'José Paulo Bezerra Maciel Júnior',
  Canales: 'Sergio Canales Madrazo',
  Fred: 'Frederico Rodrigues de Paula Santos',
  Fabinho: 'Fábio Henrique Tavares',
  Nani: 'Luís Carlos Almeida da Cunha',
  Gabi: 'Gabriel Fernández Arenas',
  Koke: 'Jorge Resurrección Merodio',
  Juanmi: 'Juan Miguel Jiménez López',
  'V. Grifo': 'Vincenzo Grifo',
  'Gabriel Paulista': 'Gabriel Armando de Abreu',
  'L. Díaz': 'Luis Fernando Díaz Marulanda',
}

/** 归一化后的别名表：种子名 → 外部表里的全名。 */
export const FM_NAME_ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(ALIAS_SOURCE).map(([seed, full]) => [normalizePlayerName(seed), normalizePlayerName(full)]),
)

// FM 与种子里对后缀的写法不统一（Jr / Jr. / Junior），统一归一。
const SUFFIX_ALIASES: Record<string, string> = { jr: 'junior', jnr: 'junior', snr: 'senior' }

const tokens = (normalized: string): string[] =>
  normalized.split(' ').filter(Boolean).map(token => SUFFIX_ALIASES[token] ?? token)

/** CA 高者优先；CA 相同则属性列更多者优先（解析更完整）。 */
function better(a: FmRow, b: FmRow): FmRow {
  const caA = a.ca ?? -1
  const caB = b.ca ?? -1
  if (caA !== caB) return caA > caB ? a : b
  return Object.keys(a.ratings).length >= Object.keys(b.ratings).length ? a : b
}

export type FmTarget = { name: string; era?: string; pos?: string }

export type FmMatch = {
  /** 本作球员名（种子里的 enName）→ 命中的外部记录。 */
  matched: Map<string, FmRow>
  /** 没匹配到的名字，按传入顺序。 */
  missing: string[]
  /** 走姓名放宽规则的命中，便于人工抽查。 */
  fallback: string[]
  /** 走手工别名表（绰号 → 法定全名）的命中。 */
  aliased: string[]
}

/** 把 FM 的位置代码（DC / AMR / DM… ）归到本作的五个位置族。 */
function positionFamilies(raw: string): Set<string> {
  const out = new Set<string>()
  for (const chunk of raw.split(/[;,/]/)) {
    const code = chunk.toUpperCase().replace(/[^A-Z]/g, '')
    if (!code) continue
    if (code === 'GK') out.add('GK')
    else if (/^(WB|D|M|AM)[LR]$/.test(code)) out.add('W')
    else if (/^(SW|DC|DCL|DCR|D|CB)$/.test(code)) out.add('CB')
    else if (/^(DM|MC|AMC|AM|M|CM)$/.test(code)) out.add('CM')
    else if (/^(ST|S|CF|SS)$/.test(code)) out.add('ST')
    else out.add(code)
  }
  return out
}

/**
 * 由年代（'1990s'）反推合理的出生年份区间：巅峰期按 20-34 岁计。
 * 用来在同名候选里筛掉重名的新生代（Peter Schmeichel vs Kasper Peter Schmeichel）。
 */
function birthWindow(era: string | undefined): { from: number; to: number } | undefined {
  const match = era?.match(/(1[89]\d{2}|20\d{2})/)
  if (!match) return undefined
  const start = Number(match[1])
  return { from: start - 34, to: start - 11 }
}

export function matchFmRows(input: (string | FmTarget)[], rows: Iterable<FmRow>): FmMatch {
  const targets: FmTarget[] = input.map(target => (typeof target === 'string' ? { name: target } : target))
  const wanted = new Set<string>()
  // 建桶只需要目标名里出现过的词，外部表 20 万行里的其余人名不占内存。
  const wantedTokens = new Set<string>()
  for (const target of targets) {
    const normalized = normalizePlayerName(target.name)
    wanted.add(normalized)
    // 别名指向的全名也要一起收进索引，否则 exact 里根本没有这类行。
    const alias = FM_NAME_ALIASES[normalized]
    if (alias) wanted.add(alias)
    for (const token of tokens(normalized)) wantedTokens.add(token)
  }

  // 同名可能有多行（官方库 / 复古库 / 重名），先全留下，匹配时按年代过滤再取 CA 最高者。
  const exact = new Map<string, FmRow[]>()
  // 按「姓名列本身」建的索引：别名表要的是这一行，而不是某个缩写别名
  // （Nani 的别名 'Luís Cunha' 会和同名的另一个人撞车）。
  const exactFull = new Map<string, FmRow[]>()
  // 按「主姓名里的每个词」建桶：葡语姓名常把姓写在中段
  // （Cristiano Ronaldo dos Santos Aveiro），只认末段会整批漏掉。
  const byToken = new Map<string, Map<string, FmRow>>()
  for (const row of rows) {
    for (const alias of row.aliases) {
      const normalized = normalizePlayerName(alias)
      if (wanted.has(normalized)) {
        const bucket = exact.get(normalized) ?? []
        const existing = bucket.findIndex(item => item.name === row.name)
        if (existing === -1) bucket.push(row)
        else bucket[existing] = better(bucket[existing], row)
        exact.set(normalized, bucket)
      }
    }
    const primary = normalizePlayerName(row.name)
    if (wanted.has(primary)) {
      const bucket = exactFull.get(primary) ?? []
      const existing = bucket.findIndex(item => item.name === row.name)
      if (existing === -1) bucket.push(row)
      else bucket[existing] = better(bucket[existing], row)
      exactFull.set(primary, bucket)
    }
    for (const token of new Set(tokens(primary))) {
      if (!wantedTokens.has(token)) continue
      const bucket = byToken.get(token) ?? new Map<string, FmRow>()
      const current = bucket.get(primary)
      bucket.set(primary, current ? better(current, row) : row)
      byToken.set(token, bucket)
    }
  }

  const matched = new Map<string, FmRow>()
  const missing: string[] = []
  const fallback: string[] = []
  const aliased: string[] = []
  for (const target of targets) {
    const normalized = normalizePlayerName(target.name)
    const window = birthWindow(target.era)
    const inWindow = (row: FmRow): boolean => !window || row.birthYear === undefined
      || (row.birthYear >= window.from && row.birthYear <= window.to)
    // 位置也要说得通：CB 的种子不该匹配到一个边锋（Pepe → Simone Pepe）。
    // 门将尤其明显——名字撞车时对面基本都是外场球员（Pau López → Pau Cendrós López）。
    const posOk = (row: FmRow): boolean => !target.pos || !row.position
      || positionFamilies(row.position).has(target.pos)
    const mustCheckPos = (needsPos: boolean): boolean => needsPos || target.pos === 'GK'

    // 0 层：手工别名（绰号 → 法定全名），比任何规则都准。
    const aliasKey = FM_NAME_ALIASES[normalized]
    const aliasHits = aliasKey ? exactFull.get(aliasKey) : undefined
    if (aliasHits?.length) {
      const pool = aliasHits.filter(inWindow)
      matched.set(target.name, (pool.length ? pool : aliasHits).reduce(better))
      aliased.push(target.name)
      continue
    }

    const hits = exact.get(normalized)
    if (hits?.length) {
      const pool = hits.filter(inWindow)
      const pick = (pool.length ? pool : hits).reduce(better)
      matched.set(target.name, pick)
      continue
    }

    const parts = tokens(normalized)
    if (parts.length === 0) { missing.push(target.name); continue }
    // 目标名里的每个词都要唯一地出现在候选名里，且候选名更长
    // （Vinícius Júnior → Vinícius José Paixão de Oliveira Júnior）。
    const candidates = new Map<string, FmRow>()
    for (const part of parts) {
      for (const [key, row] of byToken.get(part) ?? []) candidates.set(key, row)
    }
    // 只认「目标名是候选名的有序前缀」：这样 Cristiano Ronaldo 能对上
    // Cristiano Ronaldo dos Santos Aveiro，而 Peter Schmeichel 不会错配到他儿子
    // Kasper Peter Schmeichel。
    const entries = [...candidates.entries()]
    const first = parts[0]
    const last = parts.at(-1) ?? ''
    // 种子里的写法不统一：「N. Kanté」「K. Koulibaly」是缩写名，
    // 「Parejo」「Muniain」直接就是姓，都要单独照顾。
    const initialOnly = parts.length > 1 && /^[a-z]\.?$/.test(first)
    const single = parts.length === 1
    // 第二个字段表示是否要再过一遍位置校验：名字已经写到「首尾都一致」时不必要，
    // 只给最宽松的几条规则用，避免把 Cristiano Ronaldo 这种被 FM 标成 ST 的边锋挡掉。
    const rules: [(rowTokens: string[], row: FmRow) => boolean, boolean][] = [
      // A 首尾一致：Thiago Silva → Thiago Emiliano da Silva（而不是 Thiago Silva de Paiva）
      [rowTokens => parts.length > 1 && !initialOnly && rowTokens.length > parts.length
        && rowTokens[0] === first && rowTokens.at(-1) === last, false],
      // B 有序前缀：Cristiano Ronaldo → Cristiano Ronaldo dos Santos Aveiro
      [rowTokens => parts.length > 1 && !initialOnly && rowTokens.length > parts.length
        && parts.every((part, index) => rowTokens[index] === part), false],
      // C 缩写名：N. Kanté → Ngolo Kanté（首字母一致 + 姓一致）。
      // 位置在这里不校验：FM 常把 CB 标成 DL/WBL（David Alaba），名字够具体就不必较真。
      [(rowTokens, row) => initialOnly && rowTokens.length > 1
        && rowTokens.at(-1) === last && rowTokens[0].startsWith(first[0]) && (row.ca ?? 0) >= 100, false],
      // D 只给姓：Parejo → Dani Parejo。歧义大：只收「名 + 姓」两段、顶级联赛的候选，
      // 否则 Daniel Olmo Carvajal（其实是 Dani Olmo）会被当成 Carvajal。
      [(rowTokens, row) => single && rowTokens.length === 2
        && rowTokens.at(-1) === last && (row.ca ?? 0) >= 130, true],
      // E 巴西式单名：Rodrygo → Rodrygo Silva de Goes
      [(rowTokens, row) => single && rowTokens[0] === last && (row.ca ?? 0) >= 130, true],
    ]
    const hit = rules
      .map(([rule, needsPos]) => entries.filter(([key, row]) =>
        rule(tokens(key), row) && inWindow(row) && (!mustCheckPos(needsPos) || posOk(row))))
      .find(list => list.length > 0)
    if (hit) {
      matched.set(target.name, hit.map(([, row]) => row).reduce(better))
      fallback.push(target.name)
      continue
    }
    missing.push(target.name)
  }
  return { matched, missing, fallback, aliased }
}
