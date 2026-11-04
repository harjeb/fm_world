/**
 * 把外部球员属性表转成画像，写入 src/game/data/fm-profiles.generated.ts。
 *
 * 用法：
 *   npm run fm:import -- path/to/squad.tsv
 *   npm run fm:import -- FM24.csv 2013-14.csv        # 多份表合并，同名取 CA 最高者
 *   npm run fm:import -- path/to/squad.tsv --all     # 不做名单匹配，全部写入
 *
 * 支持的输入：
 *   1. FM 里导入 "AUTFabi's FM24 Squad View.fmf" 视图，全选复制 → 存成 .tsv；
 *   2. 直接读游戏数据库导出的宽表（如 FM24_24.3_官方数据库_球员属性_实验性.CSV），
 *      表头形如 `技术_传球_passing`，带 CA/PA；
 *   3. 复古存档导出的同类宽表（如 2013-14_球员属性_实验性.csv）。
 *
 * 默认只保留能匹配到本作球员种子（enName / 中文名）的记录；
 * 匹配不到时给出提示，可用 --all 强制全量写入。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { iterateFmRows, readFmTable } from '../src/game/data/fm-csv.ts'
import { profileFromFm } from '../src/game/data/attr-profile.ts'
import { matchFmRows } from '../src/game/data/fm-match.ts'
import { PLAYER_SEEDS } from '../src/game/data/players.ts'

const target = 'src/game/data/fm-profiles.generated.ts'

type InputFile = { path: string; text: string; table: ReturnType<typeof readFmTable> }

function load(paths: string[]): InputFile[] {
  const files: InputFile[] = []
  for (const path of paths) {
    if (!existsSync(path)) {
      console.error(`找不到文件：${path}`)
      process.exit(1)
    }
    const text = readFileSync(path, 'utf8')
    const table = readFmTable(text)
    if (!table.attrColumns.length) {
      console.error(`没有识别到属性列：${path}`)
      console.error('已读到的表头示例:', table.ignoredHeaders.slice(0, 12).join(', '))
      process.exit(1)
    }
    files.push({ path, text, table })
  }
  return files
}

function* allRows(files: InputFile[]) {
  for (const file of files) yield* iterateFmRows(file.text, file.table)
}

function main(): void {
  const args = process.argv.slice(2)
  const all = args.includes('--all')
  const paths = args.filter(arg => !arg.startsWith('--'))
  if (!paths.length) {
    console.error('用法: npm run fm:import -- <csv/tsv 路径> [更多路径…] [--all]')
    process.exit(1)
  }

  const files = load(paths)
  for (const file of files) {
    console.log(`${file.path}: 表头 ${file.table.headers.length} 列，识别属性 ${file.table.attrColumns.length} 列`)
  }

  const entries = new Map<string, ReturnType<typeof profileFromFm>>()
  let parsed = 0
  let fallbackCount = 0
  let aliasCount = 0
  let missing: string[] = []

  if (all) {
    for (const row of allRows(files)) {
      parsed++
      const profile = profileFromFm(row.ratings)
      if (Object.keys(profile).length) entries.set(row.name, profile)
    }
  } else {
    const seedNames = PLAYER_SEEDS.map(seed => seed.enName)
    const targets = [
      ...PLAYER_SEEDS.map(seed => ({ name: seed.enName, era: seed.era, pos: seed.pos })),
      ...PLAYER_SEEDS.map(seed => ({ name: seed.name, era: seed.era, pos: seed.pos })),
    ]
    const { matched, missing: miss, fallback, aliased } = matchFmRows(targets, allRows(files))
    // 未匹配统计只报英文名，中文名只是额外别名，缺了不算漏。
    const englishKeys = new Set(seedNames)
    missing = miss.filter(name => englishKeys.has(name))
    fallbackCount = fallback.filter(name => englishKeys.has(name)).length
    aliasCount = aliased.filter(name => englishKeys.has(name)).length
    for (const seed of PLAYER_SEEDS) {
      const row = matched.get(seed.enName) ?? matched.get(seed.name)
      if (!row) continue
      parsed++
      const profile = profileFromFm(row.ratings)
      if (Object.keys(profile).length) entries.set(seed.enName, profile)
    }
    if (!entries.size) {
      console.error('没有任何球员匹配上本作名单。')
      console.error('想全量写入（例如自己的球队），请加 --all。')
      console.error('未匹配示例:', missing.slice(0, 10).join(', ') || '（输入表为空？）')
      process.exit(1)
    }
  }

  // 权重保留 3 位小数就够用，能把生成文件（进而打包体积）压掉一半。
  const round = (_key: string, value: unknown): unknown =>
    (typeof value === 'number' ? Math.round(value * 1000) / 1000 : value)
  const body = [...entries]
    .map(([name, profile]) => `  ${JSON.stringify(name)}: ${JSON.stringify(profile, round)},`)
    .join('\n')
  const columns = files.map(file => file.table.attrColumns.length).join(' + ')
  const output = `import type { AttrProfile } from './attr-profile.ts'
import { normalizePlayerName } from './fm-match.ts'

/**
 * 外部导入的球员画像（自动生成，请勿手改）。
 *
 * 来源：${files.map(file => file.path.split(/[\/]/).pop()).join(', ')}
 * 球员数：${entries.size}
 * 识别到的属性列：${columns} 个
 *
 * 用法：npm run fm:import -- <csv 或 tsv 路径>
 */
export type FmProfileMap = Record<string, AttrProfile>

export const FM_PROFILES: FmProfileMap = {
${body}
}

// 名字比对放宽到「去重音 / 去标点 / 忽略大小写」，外部表与种子的写法差异不会漏查。
let index: Map<string, AttrProfile> | undefined

/** 查不到就返回 undefined，由调用方回退到风格画像。 */
export function fmProfileFor(name: string | undefined): AttrProfile | undefined {
  if (!name) return undefined
  if (!index) {
    index = new Map()
    for (const [key, profile] of Object.entries(FM_PROFILES)) {
      index.set(normalizePlayerName(key), profile)
    }
  }
  return FM_PROFILES[name] ?? index.get(normalizePlayerName(name))
}
`

  writeFileSync(target, output, 'utf8')
  console.log(`\n已写入 ${target}`)
  console.log(`球员 ${entries.size} 名${all ? '（全量）' : `（本作种子 ${PLAYER_SEEDS.length} 名）`}`)
  if (!all) {
    const detail = [fallbackCount ? `放宽规则命中 ${fallbackCount} 名` : '', aliasCount ? `别名表命中 ${aliasCount} 名` : '']
      .filter(Boolean).join('，')
    console.log(`未匹配 ${missing.length} 名${detail ? `，${detail}` : ''}`)
    if (missing.length) console.log('未匹配示例:', missing.slice(0, 12).join(', '))
  }
  if (parsed && !entries.size) console.log(`解析到 ${parsed} 行但没有可用属性`)
}

main()
