/**
 * FM24 中文解说模板的数据结构（设计见 docs/pes2d-migration-plan.md 第 11 节）。
 * 模板库由 scripts/build-commentary.ts 生成到 templates.generated.ts，这里只放类型和常量。
 */

/** 通道位：1 = 直播（INGAME，现在时），2 = 战报（REPORT，过去时），3 = 两个通道都能用。 */
export type CommentaryChannel = 1 | 2 | 3

/**
 * 句子依赖的、我们的游戏里还没有的功能。置位的句子照样入库，但在对应功能做出来之前不会被选中。
 * 位掩码，0 表示现在就能用。
 */
export const NEEDS = {
  /** VAR / 视频裁判 / 鹰眼 */
  var: 1,
  /** 场边训话、更衣室、中场 / 赛后训话 */
  talk: 2,
  /** 天气与场地状况 */
  weather: 4,
  /** 两回合、客场进球、总比分 */
  twoLeg: 8,
  /** 需要生涯 / 关系数据：首秀、旧主、租借、伤愈复出、里程碑、赛事成就、观战教练 */
  career: 16,
  /** 比赛中止 / 取消 */
  abandon: 32,
  /** 裁判失误与争议判罚、假摔、警告 */
  referee: 64,
  /** 球员偏好动作（PPM），以后可以映射到技能 */
  ppm: 128,
  /** 补时 */
  stoppage: 256,
} as const

export type NeedName = keyof typeof NEEDS

export const NEED_LABELS: Record<NeedName, string> = {
  var: 'VAR / 视频裁判 / 鹰眼',
  talk: '场边训话 / 更衣室 / 赛后训话',
  weather: '天气与场地状况',
  twoLeg: '两回合 / 客场进球 / 总比分',
  career: '生涯与关系数据（首秀 / 旧主 / 租借 / 伤愈复出 / 里程碑 / 赛事成就）',
  abandon: '比赛中止',
  referee: '裁判失误 / 争议判罚 / 假摔 / 警告',
  ppm: '球员偏好动作（PPM）',
  stoppage: '补时',
}

export function needNames(mask: number): NeedName[] {
  return (Object.keys(NEEDS) as NeedName[]).filter((name) => (mask & NEEDS[name]) !== 0)
}

/**
 * 一条模板。字段名故意很短：模板有七千多条，生成文件要尽量小。
 */
export type CommentaryTemplate = {
  /** 稳定 id：FM 的 text_id × 4 + 版本序号（男 / 女版本）。模板库只增不删、id 不变。 */
  id: number
  /** EVENT_KEYS 的下标。没有事件键的句子是空数组。 */
  e: readonly number[]
  /** 通道位 */
  c: CommentaryChannel
  /** NEEDS 位掩码，0 = 现在就能用 */
  n: number
  /** 槽位，逗号分隔，如 'P1,P2,T1'；P = 球员，T = 球队，N = 数字，REF = 裁判，INJ = 伤病，STAD = 球场，COMP = 赛事，STAGE = 阶段，TXT = 文本 */
  s: string
  /** 句子，槽位写作 【球员1】【球队1】【数字1】【球员referee】 等 */
  t: string
  /** 1 = 事件键是从文件里上一个带键的句子继承来的（置信度较低） */
  h?: 1
}
