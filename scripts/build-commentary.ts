/**
 * 把 FM24 中文解说语料清洗成模板库（npm run commentary:gen [语料目录]）。
 *
 * 输入（在仓库外，默认 F:/fm_test/fm24_out，也可以用第一个参数或环境变量 FM24_DIR 指定）：
 *   fm24_cn_commentary_humanized.txt   每行一句，占位符是【球员1】写法
 *   fm24_cn_commentary_all.txt         同样的行，占位符是 FM 原始写法 [%male#1]，用来对齐和校验
 *   fm24_cn_commentary.jsonl           每条记录带事件键（events）、通道（INGAME / REPORT）、text_id
 * 输出（提交进仓库）：
 *   src/game/data/commentary/templates.generated.ts
 *   docs/commentary-coverage.md
 *
 * 设计见 docs/pes2d-migration-plan.md 第 11 节：所有 FM 文字都用（原文或轻改），不按“FM 独有”过滤；
 * 依赖我们还没有的功能的句子打 needs 标签、入库但挂起。同一份输入永远生成同样的输出。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  INHERIT_BEFORE_LINE,
  INHERIT_MAX_GAP,
  LIGHT_EDIT_RULES,
  convertRaw,
  needsOf,
  normalizeEventKey,
  parseEventKey,
  slotsOf,
  stripUpper,
} from '../src/game/data/commentary/clean.ts'
import { NEED_LABELS, NEEDS, needNames, type CommentaryChannel, type CommentaryTemplate, type NeedName } from '../src/game/data/commentary/types.ts'

type Rec = { text_id: number; role: string; channel: string[]; events: string[]; cn: string[] }
type Row = {
  line: number
  text: string
  own: Set<string>
  inherited: Set<string>
  channel: number
  id: number
}

const dir = process.argv[2] ?? process.env.FM24_DIR ?? 'F:/fm_test/fm24_out'
const repoRoot = path.resolve(import.meta.dirname, '..')
const outTs = path.join(repoRoot, 'src/game/data/commentary/templates.generated.ts')
const outDoc = path.join(repoRoot, 'docs/commentary-coverage.md')

function readLines(name: string): string[] {
  const file = path.join(dir, name)
  if (!fs.existsSync(file)) throw new Error(`找不到语料文件：${file}（用第一个参数或 FM24_DIR 指定语料目录）`)
  const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

const humanized = readLines('fm24_cn_commentary_humanized.txt')
const rawLines = readLines('fm24_cn_commentary_all.txt')
const records = readLines('fm24_cn_commentary.jsonl').map((line) => JSON.parse(line) as Rec)
if (humanized.length !== rawLines.length) throw new Error(`humanized 与 all 行数不一致：${humanized.length} / ${rawLines.length}`)

const byCn = new Map<string, { rec: Rec; variant: number }[]>()
for (const rec of records) {
  rec.cn.forEach((cn, variant) => {
    const list = byCn.get(cn)
    if (list) list.push({ rec, variant })
    else byCn.set(cn, [{ rec, variant }])
  })
}

/* ------------------------------ 逐行整理 ------------------------------ */

const warnings: string[] = []
let unmatched = 0
let tailStripped = 0
let alignMismatch = 0
const rows: Row[] = []
let lastTaggedLine = -Infinity
let lastTaggedKeys: string[] = []
let ownCount = 0
let inheritedCount = 0
let noKeyCount = 0

rawLines.forEach((raw, line) => {
  const entries = byCn.get(raw)
  if (!entries) {
    unmatched++
    warnings.push(`第 ${line + 1} 行在 jsonl 里找不到：${raw}`)
    return
  }
  // 校验：用原文转换出来的句子应该和 humanized 一致（只允许 humanized 行尾多出隐藏性别占位符）。
  const canonical = convertRaw(raw)
  const human = stripUpper(humanized[line])
  if (human !== canonical) {
    const tail = human.startsWith(canonical) ? human.slice(canonical.length) : null
    if (tail !== null && /^(【[^】]*】)+$/.test(tail)) tailStripped++
    else {
      alignMismatch++
      warnings.push(`第 ${line + 1} 行 humanized 与原文转换结果不一致：${human}  ≠  ${canonical}`)
    }
  }
  const own = new Set<string>()
  let channel = 0
  let id = Infinity
  for (const { rec, variant } of entries) {
    for (const event of rec.events) {
      const key = normalizeEventKey(event)
      if (key) own.add(key)
    }
    for (const name of rec.channel) channel |= name === 'INGAME' ? 1 : name === 'REPORT' ? 2 : 0
    id = Math.min(id, rec.text_id * 4 + Math.min(variant, 3))
  }
  const inherited = new Set<string>()
  if (own.size > 0) {
    lastTaggedLine = line
    lastTaggedKeys = [...own]
    ownCount++
  } else if (line < INHERIT_BEFORE_LINE && line - lastTaggedLine <= INHERIT_MAX_GAP) {
    for (const key of lastTaggedKeys) inherited.add(key)
    inheritedCount++
  } else noKeyCount++
  rows.push({ line, text: canonical, own, inherited, channel, id })
})

/* ------------------------------ 轻改 + 去重 ------------------------------ */

const editCounts = new Map<string, number>()
for (const rule of LIGHT_EDIT_RULES) editCounts.set(rule.id, 0)
for (const row of rows) {
  let text = row.text
  for (const rule of LIGHT_EDIT_RULES) {
    const next = rule.apply(text)
    if (next !== text) editCounts.set(rule.id, (editCounts.get(rule.id) ?? 0) + 1)
    text = next
  }
  row.text = text
}

const merged = new Map<string, Row>()
let duplicateRows = 0
for (const row of rows) {
  const existing = merged.get(row.text)
  if (!existing) {
    merged.set(row.text, row)
    continue
  }
  duplicateRows++
  for (const key of row.own) existing.own.add(key)
  for (const key of row.inherited) existing.inherited.add(key)
  existing.channel |= row.channel
  existing.id = Math.min(existing.id, row.id)
}

const uniqueRows = [...merged.values()]
const idSeen = new Map<number, string>()
for (const row of uniqueRows) {
  const clash = idSeen.get(row.id)
  if (clash !== undefined) throw new Error(`模板 id 冲突 ${row.id}：「${clash}」与「${row.text}」`)
  idSeen.set(row.id, row.text)
}

/* ------------------------------ 组装模板 ------------------------------ */

const effectiveKeys = (row: Row): string[] => [...(row.own.size > 0 ? row.own : row.inherited)].sort()
const keyTable = [...new Set(uniqueRows.flatMap(effectiveKeys))].sort()
const keyIndex = new Map(keyTable.map((key, index) => [key, index]))

const templates: CommentaryTemplate[] = uniqueRows.map((row) => {
  const keys = effectiveKeys(row)
  const template: CommentaryTemplate = {
    id: row.id,
    e: keys.map((key) => keyIndex.get(key) as number),
    c: (row.channel || 3) as CommentaryChannel,
    n: needsOf([...row.own].sort(), row.text),
    s: slotsOf(row.text),
    t: row.text,
  }
  if (row.own.size === 0 && row.inherited.size > 0) template.h = 1
  return template
})

const unknownSlots = templates.filter((template) => template.s.includes('?'))
if (unknownSlots.length > 0) throw new Error(`有认不出的槽位：${unknownSlots.slice(0, 5).map((t) => t.t).join(' | ')}`)
const residue = templates.filter((template) => /\[%|\{|\}|undefined|她/.test(template.t))
if (residue.length > 0) throw new Error(`清洗后仍有残留：${residue.slice(0, 5).map((t) => t.t).join(' | ')}`)

/* ------------------------------ 写模板文件 ------------------------------ */

const quote = (text: string) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const tsLines: string[] = []
tsLines.push(`import type { CommentaryTemplate } from './types.ts'`)
tsLines.push('')
tsLines.push('/**')
tsLines.push(' * FM24 中文解说模板（自用，见 docs/pes2d-migration-plan.md 第 11 节）。由 scripts/build-commentary.ts 生成（npm run commentary:gen）。')
tsLines.push(' * 不要手改；自己补写 / 改写的句子放另一个文件，合并时自定义优先。')
tsLines.push(` * 共 ${templates.length} 句，事件键 ${keyTable.length} 个；n 不为 0 的句子依赖还没有的功能，先挂起（覆盖率见 docs/commentary-coverage.md）。`)
tsLines.push(' */')
tsLines.push('export const EVENT_KEYS: readonly string[] = [')
for (const key of keyTable) tsLines.push(`  ${quote(key)},`)
tsLines.push(']')
tsLines.push('')
tsLines.push('export const COMMENTARY_TEMPLATES: readonly CommentaryTemplate[] = [')
for (const template of templates) {
  const parts = [`id: ${template.id}`, `e: [${template.e.join(', ')}]`, `c: ${template.c}`, `n: ${template.n}`, `s: ${quote(template.s)}`, `t: ${quote(template.t)}`]
  if (template.h) parts.push('h: 1')
  tsLines.push(`  { ${parts.join(', ')} },`)
}
tsLines.push(']')
fs.writeFileSync(outTs, tsLines.join('\n') + '\n')

/* ------------------------------ 覆盖率报告 ------------------------------ */

const usable = templates.filter((template) => template.n === 0)
const parked = templates.filter((template) => template.n !== 0)
const channelCount = (list: CommentaryTemplate[]) => ({
  ingame: list.filter((t) => t.c === 1).length,
  report: list.filter((t) => t.c === 2).length,
  both: list.filter((t) => t.c === 3).length,
})
const keysOf = (template: CommentaryTemplate) => template.e.map((index) => keyTable[index])

const GROUPS: [string, RegExp][] = [
  ['开球', /^START_(MATCH|GAME)/],
  ['进球', /^(GOAL_|SCORED_(?!AGAINST|AFTER|ON_HIS_DEBUT)|OWN_GOAL|GOALIE_OWN_GOAL|HAT_TRICK|PLAYER_SECOND_GOAL)/],
  ['射门出脚', /^SHOT_/],
  ['射门被扑', /^(GOALKEEPER_|GOALIE_|GREAT_SAVE|GOOD_SAVE|SAVED_)/],
  ['射门被封堵', /BLOCK/],
  ['射门偏出 / 打框 / 机会球', /^(SHOT_(JUST|WELL|CLIPS|HITS)|HEADER_(JUST|WELL|CLIPS|HITS)|MISSED_EASY)/],
  ['点球', /PENALTY/],
  ['角球', /CORNER/],
  ['任意球', /FREE_?KICK/],
  ['界外球', /THROW_IN/],
  ['球门球', /GOAL_KICK/],
  ['犯规', /^(FOUL_|HAND_BALL)/],
  ['红黄牌', /(YELLOW|SENT_OFF|RED_CARD)/],
  ['越位', /OFFSIDE/],
  ['伤病', /INJUR/],
  ['换人', /(SUBSTITUTION|MAKING_CHANGE)/],
  ['战术 / 心态切换', /^(GONE_|TEAM_CHANGES_TO|CHANGE_FORMATION)/],
  ['半场', /^HALF_TIME/],
  ['终场', /^(FULL_TIME|FINAL_WHISTLE)/],
  ['传球', /^(PASS_|LONG_BALL|ATTEMPT_PASS)/],
  ['传中', /^CROSS_/],
  ['带球 / 过人', /^(RUN_|TURN_|DRIBBL)/],
  ['抢断 / 拦截', /(TACKLE|INTERCEPT|WINS_BLOCK)/],
  ['头球争顶', /(JUMPFORBALL|HEAD_IT|GOES_TO_HEAD)/],
  ['解围', /^(CLEAR_|CLEARANCE)/],
]

const lines: string[] = []
const total = templates.length
const pct = (n: number, d = total) => `${((n / d) * 100).toFixed(1)}%`
lines.push('# 解说模板覆盖率')
lines.push('')
lines.push('由 `npm run commentary:gen` 生成，不要手改。设计与决定见 `docs/pes2d-migration-plan.md` 第 11 节。')
lines.push('')
lines.push('## 总览')
lines.push('')
lines.push('| 项目 | 数量 |')
lines.push('|---|---|')
lines.push(`| 语料行数（humanized.txt） | ${rawLines.length} |`)
lines.push(`| 轻改后合并重复句，入库模板 | ${total}（合并了 ${duplicateRows} 行重复，主要是男女两个版本轻改后变成同一句） |`)
lines.push(`| 事件键 | ${keyTable.length} 个（已去掉 jsonl 里夹带的注释） |`)
lines.push(`| 现在就能用（needs = 0） | ${usable.length}（${pct(usable.length)}） |`)
lines.push(`| 挂起（依赖还没有的功能） | ${parked.length}（${pct(parked.length)}） |`)
const usableChannels = channelCount(usable)
lines.push(`| 能用的句子按通道 | 只直播 ${usableChannels.ingame} / 只战报 ${usableChannels.report} / 两个通道都用 ${usableChannels.both} |`)
lines.push(`| 事件键来源（按语料行） | 自带 ${ownCount} / 继承 ${inheritedCount}（行距 ≤ ${INHERIT_MAX_GAP} 且在第 ${INHERIT_BEFORE_LINE} 行之前）/ 没有 ${noKeyCount} |`)
lines.push('')
lines.push('校验：')
lines.push('')
lines.push(`- jsonl 里找不到的行：${unmatched}`)
lines.push(`- humanized 与“原文转换结果”一致的行：${rawLines.length - tailStripped - alignMismatch - unmatched}；仅行尾多出隐藏性别占位符（已去掉）：${tailStripped}；不一致：${alignMismatch}`)
lines.push(`- 清洗后仍有 \`[%\`、\`{\`、\`}\`、\`undefined\`、“她”的句子：0（有就会让构建失败）`)
lines.push('')
lines.push('## 轻改')
lines.push('')
lines.push('| 规则 | 改了多少句 |')
lines.push('|---|---|')
for (const rule of LIGHT_EDIT_RULES) lines.push(`| ${rule.label} | ${editCounts.get(rule.id)} |`)
lines.push('')
lines.push('另外：`{upper}` 标记和行尾的隐藏性别占位符在转换时已去掉（见上面的校验）。')
lines.push('')
lines.push('## 关键事件覆盖（只算现在能用的句子，按通道）')
lines.push('')
lines.push('验收标准（计划 11.8）：每种关键事件候选 ≥ 5 句。少于 5 的标了 ⚠。')
lines.push('')
lines.push('| 事件 | 直播可用 | 战报可用 | 备注 |')
lines.push('|---|---|---|---|')
for (const [label, pattern] of GROUPS) {
  const matching = usable.filter((template) => keysOf(template).some((key) => pattern.test(key)))
  const ingame = matching.filter((template) => (template.c & 1) !== 0).length
  const report = matching.filter((template) => (template.c & 2) !== 0).length
  const warn = ingame < 5 || report < 5 ? '⚠ ' : ''
  lines.push(`| ${label} | ${warn}${ingame} | ${warn}${report} | |`)
}
lines.push('')
lines.push('## 事件家族（现在能用的句子最多的前 40 个）')
lines.push('')
lines.push('| 家族 | 句数 | 事件键数 |')
lines.push('|---|---|---|')
const familyLines = new Map<string, Set<number>>()
const familyKeys = new Map<string, Set<string>>()
usable.forEach((template, index) => {
  for (const key of keysOf(template)) {
    const family = parseEventKey(key).family
    if (!familyLines.has(family)) {
      familyLines.set(family, new Set())
      familyKeys.set(family, new Set())
    }
    familyLines.get(family)?.add(index)
    familyKeys.get(family)?.add(key)
  }
})
for (const [family, set] of [...familyLines.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0])).slice(0, 40)) {
  lines.push(`| \`${family}\` | ${set.size} | ${familyKeys.get(family)?.size ?? 0} |`)
}
lines.push('')
lines.push('## 挂起的句子（依赖还没有的功能）')
lines.push('')
lines.push('功能做出来之前不会被选中；做出来后清掉对应的 needs 位就自动启用。一句话可以同时依赖几个功能，下面按位分别统计。')
lines.push('')
lines.push('| 依赖的功能 | 句数 | 样例 |')
lines.push('|---|---|---|')
for (const name of Object.keys(NEEDS) as NeedName[]) {
  const matching = parked.filter((template) => (template.n & NEEDS[name]) !== 0)
  const samples = matching.slice(0, 3).map((template) => template.t.replace(/\|/g, '/')).join(' ／ ')
  lines.push(`| ${NEED_LABELS[name]} | ${matching.length} | ${samples} |`)
}
lines.push('')
const noKey = templates.filter((template) => template.e.length === 0)
lines.push('## 没有事件键、也没能继承的句子')
lines.push('')
lines.push(`${noKey.length} 句（其中现在能用的 ${noKey.filter((template) => template.n === 0).length}）。它们主要是文件尾部杂项区里没打标签的句子，不能靠位置判断归属，留给计划 S4 的人工通读归类。样例（每隔一段取一句）：`)
lines.push('')
for (let index = 0; index < noKey.length; index += Math.max(1, Math.floor(noKey.length / 12))) lines.push(`- ${noKey[index].t}`)
lines.push('')
lines.push('## 继承来的事件键（置信度较低）')
lines.push('')
lines.push(`${templates.filter((template) => template.h).length} 句的事件键是从上一个带键句子继承的（模板上有 \`h: 1\`）。选句时建议先用自带键的句子，不够再补继承的。`)
lines.push('')
fs.writeFileSync(outDoc, lines.join('\n') + '\n')

console.log(`语料 ${rawLines.length} 行 → 模板 ${total} 句（能用 ${usable.length}，挂起 ${parked.length}），事件键 ${keyTable.length} 个`)
console.log(`自带键 ${ownCount} / 继承 ${inheritedCount} / 没有 ${noKeyCount}；合并重复 ${duplicateRows} 行`)
console.log(`校验：jsonl 找不到 ${unmatched}，行尾隐藏占位符 ${tailStripped}，不一致 ${alignMismatch}`)
for (const name of needNames(0xffff)) {
  const count = parked.filter((template) => (template.n & NEEDS[name]) !== 0).length
  if (count > 0) console.log(`  挂起 ${name}: ${count}`)
}
if (warnings.length > 0) {
  console.log(`警告 ${warnings.length} 条：`)
  for (const warning of warnings.slice(0, 10)) console.log('  ' + warning)
}
console.log(`已写入 ${path.relative(repoRoot, outTs)} 和 ${path.relative(repoRoot, outDoc)}`)
