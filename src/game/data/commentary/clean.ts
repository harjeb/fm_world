/**
 * FM24 解说语料的清洗规则（纯函数，scripts/build-commentary.ts 和测试共用）。
 *
 * 原则：所有 FM 文字都用，原文或轻改；不按“FM 独有”过滤。依赖我们还没有的功能的句子打 needs 标签，
 * 入库但挂起，功能出现时自动启用。
 */
import { NEEDS } from './types.ts'

/* ------------------------------ 占位符 ------------------------------ */

/**
 * FM 原始占位符 → 项目里的【】写法。`-hidden` 是 FM 的隐藏性别占位符（行尾多余的一个），直接丢弃；
 * `-surname / -short / -uppercase / -his / -nth / -text` 只是显示方式，统一成同一个槽位。
 * 认不出的占位符原样保留，由调用方报告。
 */
export function convertRaw(raw: string): string {
  const text = raw.replace(/\[%([a-z_]+)#(\w+?)(?:-([a-z]+))?\]/g, (whole, kind: string, idx: string, suffix?: string) => {
    const hidden = suffix === 'hidden'
    if (kind === 'male' || kind === 'female' || kind === 'person') {
      if (hidden) return ''
      return idx === 'referee' ? '【球员referee】' : `【球员${idx}】`
    }
    if (hidden) return ''
    if (kind === 'team') return `【球队${idx}】`
    if (kind === 'number') return `【数字${idx}】`
    if (kind === 'stadium') return `【球场${idx}】`
    if (kind === 'comp') return `【赛事${idx}】`
    if (kind === 'injury') return `【伤病${idx}】`
    if (kind === 'string') return `【文本${idx}】`
    if (kind === 'stage_name') return `【阶段${idx}】`
    return whole
  })
  return stripUpper(text)
}

/** `{upper}` 是 FM 的“首字母大写”指令，中文用不上。原文里有 3 行少写了左花括号（`upper}`），一并去掉。 */
export function stripUpper(text: string): string {
  return text.replace(/\{?upper\}/g, '')
}

/** 句子里认得的槽位，按 球员 / 裁判 / 球队 / 数字 / 其他 的顺序给出，如 'P1,P2,T1,N1'。 */
export function slotsOf(text: string): string {
  const found = new Set<string>()
  for (const match of text.matchAll(/【([^】]*)】/g)) {
    const body = match[1]
    let m: RegExpMatchArray | null
    if ((m = body.match(/^球员(\d+)$/))) found.add(`P${m[1]}`)
    else if (body === '球员referee') found.add('REF')
    else if ((m = body.match(/^球队(\d+)$/))) found.add(`T${m[1]}`)
    else if ((m = body.match(/^数字(\d+)$/))) found.add(`N${m[1]}`)
    else if (/^伤病\d+$/.test(body)) found.add('INJ')
    else if (/^球场\d+$/.test(body)) found.add('STAD')
    else if (/^赛事\d+$/.test(body)) found.add('COMP')
    else if (/^阶段\d+$/.test(body)) found.add('STAGE')
    else if (/^文本\d+$/.test(body)) found.add('TXT')
    else found.add(`?${body}`)
  }
  const order = (slot: string) => {
    if (/^P\d+$/.test(slot)) return 0
    if (slot === 'REF') return 1
    if (/^T\d+$/.test(slot)) return 2
    if (/^N\d+$/.test(slot)) return 3
    if (slot.startsWith('?')) return 9
    return 4
  }
  return [...found].sort((a, b) => order(a) - order(b) || a.localeCompare(b)).join(',')
}

/* ------------------------------ 轻改 ------------------------------ */

export type LightEditRule = { id: string; label: string; apply: (text: string) => string }

const YARD_TO_METER = 0.9144

/** 轻改规则，按顺序应用；构建脚本会逐条统计各改了多少句。 */
export const LIGHT_EDIT_RULES: readonly LightEditRule[] = [
  // 游戏里没有性别字段，一律按男性处理。
  { id: 'she', label: '她 → 他', apply: (text) => text.replace(/她/g, '他') },
  // 距离单位：模板是“码”，数值由引擎按米给出。
  { id: 'yard-slot', label: '【数字N】码 → 【数字N】米', apply: (text) => text.replace(/(【数字\d+】)码/g, '$1米') },
  { id: 'penalty-spot', label: '十二码 → 点球点', apply: (text) => text.replace(/十二码/g, '点球点') },
  { id: 'yard-number', label: '10码 → 9米（阿拉伯数字按 0.9144 换算）', apply: (text) => text.replace(/(\d+)码/g, (_, n: string) => `${Math.round(Number(n) * YARD_TO_METER)}米`) },
  { id: 'yard-ten', label: '十码 → 九米', apply: (text) => text.replace(/十码/g, '九米') },
  { id: 'yard-five', label: '五码 → 五米', apply: (text) => text.replace(/五码/g, '五米') },
  // FM 中文里 “! !” 是全角感叹号被拆开的产物。
  { id: 'spaced-bang', label: '“! !” → “!!”', apply: (text) => text.replace(/!(?:\s+!)+/g, (run) => '!'.repeat(run.replace(/\s/g, '').length)) },
]

export function lightEdit(text: string): string {
  return LIGHT_EDIT_RULES.reduce((current, rule) => rule.apply(current), text)
}

/* ------------------------------ 事件键 ------------------------------ */

/** jsonl 里个别事件键后面夹带了注释（`TOUCHLINE_INSTRUCTION_PRAISE, refers to …`、`VAR_…. Male 1 is offside`），只取键本身。 */
export function normalizeEventKey(raw: string): string | null {
  const match = raw.trim().match(/^[A-Z][A-Z0-9_]*/)
  if (!match) return null
  return match[0].replace(/_+$/, '')
}

/** 多词限定词要放在前面，按最长匹配。 */
const QUALIFIER_PHRASES = ['FIRST_TIME', 'INTO_PATH', 'NEAR_POST', 'FAR_POST', 'PAST_TENSE', 'LEFT_FOOT', 'RIGHT_FOOT', 'LEFT_WING', 'RIGHT_WING', 'INTO_AREA']
const QUALIFIER_WORDS = new Set(['LEFT', 'RIGHT', 'WING', 'CENTRE', 'CENTER', 'LOW', 'MID', 'HIGH', 'FORWARD', 'BACK', 'SIDEWAYS', 'HOPE'])

/** `PASS_SHORT_LEFT_WING_FIRST_TIME_INTO_PATH` → 家族 `PASS_SHORT`，限定词 `LEFT / WING / FIRST_TIME / INTO_PATH`。 */
export function parseEventKey(key: string): { family: string; tags: string[] } {
  const tokens = key.split('_')
  const family: string[] = []
  const tags: string[] = []
  for (let index = 0; index < tokens.length; ) {
    const phrase = QUALIFIER_PHRASES.find((candidate) => {
      const parts = candidate.split('_')
      return parts.every((part, offset) => tokens[index + offset] === part)
    })
    if (phrase && family.length > 0) {
      tags.push(phrase)
      index += phrase.split('_').length
      continue
    }
    if (QUALIFIER_WORDS.has(tokens[index]) && family.length > 0) {
      tags.push(tokens[index])
      index += 1
      continue
    }
    family.push(tokens[index])
    index += 1
  }
  return { family: family.join('_'), tags }
}

/* ------------------------------ needs ------------------------------ */

type NeedRule = {
  bit: number
  /** 事件键里的线索。注意按词边界匹配：`ICY` 不能匹配 `BICYCLE`，`LEG` 不能匹配 `ILLEGAL`。 */
  key: RegExp
  /**
   * 文字证据。有的话，键匹配之外还要求句子文字也提到了对应内容才算依赖该功能：
   * FM 给同一个普通事件做了天气版、观战教练版、两回合版，很多变体的文字其实是普通描述
   * （“向前传球”“欢迎来到球场，某队首先开球”），不该挂起。没有的话，键匹配就够了
   * （VAR、场边训话、中止、补时、争议判罚的句子本身就是那个功能的一部分）。
   */
  evidence?: RegExp
}

/** `HTT_ / FTT_` 只算“训话本身”（TEAM / INDIVIDUAL），“训话后的情绪下的普通动作”（如 HTT_CONFIDENT_RUN_PAST_OPPONENT）文字是普通描述。 */
const NEED_RULES: readonly NeedRule[] = [
  { bit: NEEDS.var, key: /^(VAR_|HAWKEYE_)/ },
  { bit: NEEDS.talk, key: /^(FTT_(TEAM|INDIVIDUAL)_|HTT_(TEAM|INDIVIDUAL)_|TOUCHLINE_|[A-Z]+_TOUCHLINE_)/ },
  {
    bit: NEEDS.weather,
    key: /(^|_)(WET|SNOW|SNOWING|ICY|MUDDY|WATERLOGGED|RAIN|WINDY)(_|$)/,
    evidence: /湿滑|太滑|滑溜|泥泞|烂泥|泥地|积水|积满水|积雪|雪地|雪中|雪下|雨中|下雨|沾水|沾了水|水花|结冰|冰冻|大风|潮湿|糟糕的场地|场地情况|场地状况|场地条件/,
  },
  {
    bit: NEEDS.twoLeg,
    key: /(^|_)(LEG|AGGREGATE)(_|$)|AWAY_GOALS?(_|$)/,
    evidence: /客场进球|总比分|晋级|淘汰|两回合|首回合|次回合|下一轮/,
  },
  {
    bit: NEEDS.career,
    key: /(^|_)(DEBUT|LOANEE|LANDMARK|TOURNAMENT|COMPETITION|EURO|OBSERVING)(_|$)|PARENT_CLUB|FORMER_CLUB|INJURY_ABSENCE|THROUGH_TO_FINAL|FIRST_CAREER_GOAL/,
    evidence: /首秀|处子|初次|首次|第一次|首个|职业生涯|第【数字\d+】|本赛季|旧主|东家|租借|伤愈|伤停归队|复出|赛事|冠军|本届|观战|看台|老板|球探|自我介绍/,
  },
  { bit: NEEDS.abandon, key: /^MATCH_ABANDONED/ },
  { bit: NEEDS.referee, key: /^(CONTROVERSY_|REFEREE_BOOKS_|TICKING_OFF|PLAYER_DONE_FOR_DIVING)/ },
  { bit: NEEDS.ppm, key: /^PPM_/ },
  { bit: NEEDS.stoppage, key: /^TIME_ADDED/ },
]

/** 句子文字里明确提到的功能。没有事件键的句子只能靠这个判断；有键的句子也适用（文字里写了 VAR 就是依赖 VAR）。 */
const NEED_TEXT_RULES: readonly [number, RegExp][] = [
  [NEEDS.var, /VAR|视频裁判|视频助理|鹰眼/],
  [NEEDS.talk, /训话|战术板|教练席/],
  [NEEDS.weather, /下雨|雨水|大雨|暴雨|下雪|大雪|大风|泥泞|结冰|冰冻|积水/],
  [NEEDS.twoLeg, /客场进球|总比分|两回合|首回合|次回合/],
  [NEEDS.career, /处子|首秀|旧主|前东家|母队|租借|伤愈|职业生涯|本赛季的第/],
  [NEEDS.abandon, /比赛取消|宣布比赛终止|灯突然熄灭/],
  [NEEDS.stoppage, /补时/],
]

/** 一个事件键依赖的功能位（只看键，不看文字）。 */
export function keyNeeds(key: string): number {
  let mask = 0
  for (const rule of NEED_RULES) if (rule.key.test(key)) mask |= rule.bit
  return mask
}

/**
 * 一句话依赖哪些未实现功能。
 * 事件键：只用**自带**的键（继承来的键置信度低，不能拿来挂起）；并且**所有**自带键都是功能专属的才算
 * （只要有一个普通键，这句话就是普通描述，特殊标签只当可选条件）；有文字证据要求的功能，文字也要对得上。
 * 文字：明确提到 VAR、训话、天气……的，不管事件键是什么都算。
 */
export function needsOf(ownKeys: readonly string[], text: string): number {
  let mask = 0
  if (ownKeys.length > 0 && ownKeys.every((key) => keyNeeds(key) !== 0)) {
    for (const key of ownKeys) {
      for (const rule of NEED_RULES) {
        if (!rule.key.test(key)) continue
        if (rule.evidence && !rule.evidence.test(text)) continue
        mask |= rule.bit
      }
    }
  }
  for (const [bit, pattern] of NEED_TEXT_RULES) if (pattern.test(text)) mask |= bit
  return mask
}

/* ------------------------------ 继承 ------------------------------ */

/**
 * 语料按事件分组排列，同组的变体只有第一句带事件键。无键的句子可以继承上一个带键句子的键，
 * 但只在行距很近、且不在文件尾部的杂项区时才可信（抽样核对：行距 ≤ 8 的基本都对，
 * 第 6,000 行之后和行距 > 20 的继承是错的，比如红牌句子被挂到“射中门柱”下面）。
 */
export const INHERIT_MAX_GAP = 8
export const INHERIT_BEFORE_LINE = 6000
