import { fmAttrKey } from './attr-profile.ts'
import type { AttrKey } from '../types.ts'

/**
 * 解析 FM 球员属性表（TSV / CSV）。
 *
 * 目前支持三种来源：
 *   1. FM 界面里全选复制出来的制表符文本（表头会重复出现，需要跳过）；
 *   2. 「AUTFabi's FM24 Data Spreadsheet」另存的 CSV；
 *   3. 直接从游戏数据库导出的宽表，例如
 *      `FM24_24.3_官方数据库_球员属性_实验性.csv`（90 列，表头形如
 *      `技术_传球_passing`，属性为 1-20，附 CA/PA 与位置熟练度）。
 *
 * 表头识别采用「整串 → 逐段」回退：先按归一化后的整串查别名，
 * 再按 `_` / `/` 切段从右往左查，这样中英混排的表头也能命中英文原名。
 */

export type FmRow = {
  /** 主姓名，原样保留（含空格）。 */
  name: string
  /** 其它可用于匹配的名字：全名、名+姓、姓+名。 */
  aliases: string[]
  /** FM 位置（可多值，如 'DM; MC; AMC'）；缺失时为空串。 */
  position: string
  /** 数据库原始 CA / PA；导出里没有这两列时为 undefined。 */
  ca?: number
  pa?: number
  /** 出生年份，用于同名候选的年代甄别；导出里没有出生日期时为 undefined。 */
  birthYear?: number
  /** 原始 FM 属性名 → 1-20 评分。 */
  ratings: Record<string, number>
}

export type FmParseResult = {
  rows: FmRow[]
  /** 识别到的属性列名。 */
  matchedHeaders: string[]
  /** 未识别的列名（便于排查：选错了视图或导出了统计数据）。 */
  ignoredHeaders: string[]
}

const NAME_HEADERS = ['name', 'player', '姓名', '球员', '球员名']
const FULL_NAME_HEADERS = ['fullname', '全名', '完整姓名']
const FIRST_NAME_HEADERS = ['firstname', 'givenname', '名']
const LAST_NAME_HEADERS = ['lastname', 'surname', '姓']
const POSITION_HEADERS = ['position', 'pos', '位置', '场上位置']
const BIRTH_HEADERS = ['出生日期', '生日', 'born', 'dateofbirth', 'dob']
const CA_HEADERS = ['ca', 'currentability', '当前能力']
const PA_HEADERS = ['pa', 'potentialability', '潜力']

const normalizeHeader = (header: string): string => header.replace(/[\s_\-.]/g, '').toLowerCase()

function detectDelimiter(firstLine: string): string {
  const tabs = (firstLine.match(/\t/g) ?? []).length
  const commas = (firstLine.match(/,/g) ?? []).length
  const semicolons = (firstLine.match(/;/g) ?? []).length
  if (tabs >= commas && tabs >= semicolons && tabs > 0) return '\t'
  return semicolons > commas ? ';' : ','
}

/** 按分隔符切分，支持双引号包裹与转义引号。 */
function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { cell += '"'; i++ }
      else if (char === '"') quoted = false
      else cell += char
      continue
    }
    if (char === '"') { quoted = true; continue }
    if (char === delimiter) { cells.push(cell); cell = ''; continue }
    cell += char
  }
  cells.push(cell)
  return cells.map(value => value.trim())
}

const stripBom = (text: string): string => text.replace(/^\uFEFF/, '')

/** 解析文本为行（已去掉空行）。 */
export function parseDelimited(text: string): string[][] {
  const clean = stripBom(text).replace(/\r\n?/g, '\n')
  const delimiter = detectDelimiter(clean)
  return clean.split('\n').map(line => splitLine(line, delimiter)).filter(cells => cells.some(cell => cell !== ''))
}

export type FmTable = {
  delimiter: string
  /** 表头所在的行号（0 起）。 */
  headerRow: number
  headers: string[]
  nameIndex: number
  fullNameIndex: number
  firstNameIndex: number
  lastNameIndex: number
  positionIndex: number
  birthIndex: number
  caIndex: number
  paIndex: number
  /** 已识别为本作属性的列。 */
  attrColumns: { header: string; index: number; key: AttrKey }[]
  matchedHeaders: string[]
  ignoredHeaders: string[]
}

function findHeaderIndex(lines: string[], delimiter: string): number {
  const limit = Math.min(lines.length, 50)
  for (let i = 0; i < limit; i++) {
    const cells = splitLine(lines[i], delimiter)
    if (cells.some(cell => NAME_HEADERS.includes(normalizeHeader(cell)))) return i
  }
  return 0
}

/** 只读表头，构建列映射；配合 iterateFmRows 可流式处理几十万行的大表。 */
export function readFmTable(text: string): FmTable {
  const clean = stripBom(text).replace(/\r\n?/g, '\n')
  const lines = clean.split('\n')
  const delimiter = detectDelimiter(lines[0] ?? '')
  const headerRow = findHeaderIndex(lines, delimiter)
  const headers = splitLine(lines[headerRow] ?? '', delimiter)

  const findExact = (candidates: string[]): number =>
    headers.findIndex(cell => candidates.includes(normalizeHeader(cell)))

  // 数据库导出里「位置_评分至少15」既不是 position 也不是位置熟练度，单独处理。
  let positionIndex = findExact(POSITION_HEADERS)
  if (positionIndex === -1) {
    // 两份导出的表头不同：FM24 是「位置_评分至少15」，复古库是「熟练位置_评分至少15」。
    positionIndex = headers.findIndex(cell => normalizeHeader(cell).includes('位置'))
  }
  // CA/PA 允许带后缀，如「当前能力_CA_原始」「潜力_PA_原始」。
  // 只认整串或切段后的整段，否则 'Passing' / 'Pac' 会被误当成 PA 列。
  const hasSegment = (header: string, token: string): boolean =>
    header.split(/[_\s\-/.]/).some(segment => segment.trim().toLowerCase() === token)
  const findValue = (candidates: string[], short: string): number =>
    headers.findIndex(cell => candidates.some(name => normalizeHeader(cell) === name) || hasSegment(cell, short))
  const birthIndex = headers.findIndex(cell => BIRTH_HEADERS.some(name => normalizeHeader(cell).startsWith(name)))
  const caIndex = findValue(CA_HEADERS, 'ca')
  const paIndex = findValue(PA_HEADERS, 'pa')

  const nameIndex = findExact(NAME_HEADERS)
  const fullNameIndex = findExact(FULL_NAME_HEADERS)
  const firstNameIndex = findExact(FIRST_NAME_HEADERS)
  const lastNameIndex = findExact(LAST_NAME_HEADERS)
  const excluded = new Set([nameIndex, fullNameIndex, firstNameIndex, lastNameIndex, positionIndex, birthIndex, caIndex, paIndex])

  const attrColumns = headers
    .map((header, index) => ({ header, index, key: excluded.has(index) ? undefined : fmAttrKey(header) }))
    .filter((column): column is { header: string; index: number; key: AttrKey } => column.key !== undefined)

  const matchedHeaders = attrColumns.map(column => column.header)
  const ignoredHeaders = headers.filter((header, index) =>
    header !== '' && !excluded.has(index) && !fmAttrKey(header))

  return {
    delimiter, headerRow, headers,
    nameIndex, fullNameIndex, firstNameIndex, lastNameIndex,
    positionIndex, birthIndex, caIndex, paIndex,
    attrColumns, matchedHeaders, ignoredHeaders,
  }
}

function rowAliases(cells: string[], table: FmTable, name: string): string[] {
  const pick = (index: number): string => (index === -1 ? '' : (cells[index] ?? ''))
  const full = pick(table.fullNameIndex)
  const first = pick(table.firstNameIndex)
  const last = pick(table.lastNameIndex)
  const aliases = new Set<string>([name])
  if (full) aliases.add(full)
  if (first && last) {
    aliases.add(`${first} ${last}`)
    aliases.add(`${last} ${first}`)
  }
  if (first && full) aliases.add(`${first} ${full.trim().split(/\s+/).pop() ?? ''}`)
  return [...aliases].map(value => value.trim()).filter(Boolean)
}

/** 从 '1995-01-20' / '20/01/1995' 里取四位年份。 */
function parseYear(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const match = raw.match(/(1[89]\d{2}|20\d{2})/)
  return match ? Number(match[1]) : undefined
}

function parseNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

/** 逐行产出球员记录，避免几十万行的宽表把内存吃满。 */
export function* iterateFmRows(text: string, table: FmTable): Generator<FmRow> {
  const lines = stripBom(text).replace(/\r\n?/g, '\n').split('\n')
  for (let i = table.headerRow + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const cells = splitLine(line, table.delimiter)
    const name = (table.nameIndex === -1 ? cells[0] : cells[table.nameIndex]) ?? ''
    if (!name || NAME_HEADERS.includes(normalizeHeader(name))) continue // 跳过 FM 复制时重复的表头
    const ratings: Record<string, number> = {}
    for (const column of table.attrColumns) {
      const raw = cells[column.index]
      if (raw === undefined || raw === '' || raw === '-') continue
      const value = Number(raw)
      // FM 属性为 1-20 整数；数据库里的 0 表示「未设定」，同样丢弃。
      if (!Number.isFinite(value) || value < 1 || value > 20) continue
      ratings[column.header] = value
    }
    if (!Object.keys(ratings).length) continue
    yield {
      name,
      aliases: rowAliases(cells, table, name),
      position: table.positionIndex === -1 ? '' : (cells[table.positionIndex] ?? ''),
      ca: parseNumber(cells[table.caIndex]),
      pa: parseNumber(cells[table.paIndex]),
      birthYear: parseYear(cells[table.birthIndex]),
      ratings,
    }
  }
}

/** 一次性解析（小表 / 测试用）。 */
export function parseFmTable(text: string): FmParseResult {
  const table = readFmTable(text)
  const rows = [...iterateFmRows(text, table)]
  return { rows, matchedHeaders: table.matchedHeaders, ignoredHeaders: table.ignoredHeaders }
}
