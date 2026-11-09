/** 杯赛配置：赛制、世界队/随机队数量、奖励。生成脚本和运行时共用。 */
export type CupId = 'community' | 'league' | 'champions'
export type CupPoolId = 'casual' | 'league' | 'champions'
export type CupRound = 'r16' | 'qf' | 'sf' | 'final'

export type CupDef = {
  id: CupId
  name: string
  /** 参赛队总数。 */
  size: number
  /** 小组数；每组 4 队。 */
  groups: number
  /** 每组出线队数。 */
  qualifiers: number
  /** 淘汰赛轮次，按先后顺序。 */
  knockout: CupRound[]
  /** 从这一轮开始主客场两回合；不填表示全部单场。决赛永远单场。 */
  twoLeggedFrom?: CupRound
  worldCount: number
  randomCount: number
  randomPool: CupPoolId
  description: string
}

/** 全局种子：所有玩家的随机队池与抽签都从这里派生，不能用存档种子。 */
export const CUP_SEED = 0x0c0ffee
export const CUP_VERSION = 1

export const CUP_DEFS: CupDef[] = [
  {
    id: 'community',
    name: '社区杯',
    size: 16,
    groups: 4,
    qualifiers: 2,
    knockout: ['qf', 'sf', 'final'],
    worldCount: 11,
    randomCount: 4,
    randomPool: 'casual',
    description: '4 组 × 4 队，小组前 2 进 8 强；淘汰赛单场。12 支世界队（含你，11 支 AI）+ 4 支随机队。',
  },
  {
    id: 'league',
    name: '联盟杯',
    size: 16,
    groups: 4,
    qualifiers: 2,
    knockout: ['qf', 'sf', 'final'],
    worldCount: 7,
    randomCount: 8,
    randomPool: 'league',
    description: '4 组 × 4 队，小组前 2 进 8 强；淘汰赛单场。7 支世界队 + 你 + 8 支随机队。',
  },
  {
    id: 'champions',
    name: '冠军杯',
    size: 32,
    groups: 8,
    qualifiers: 2,
    knockout: ['r16', 'qf', 'sf', 'final'],
    twoLeggedFrom: 'qf',
    worldCount: 11,
    randomCount: 20,
    randomPool: 'champions',
    description: '8 组 × 4 队，小组前 2 进 16 强；16 强单场，8 强/半决赛两回合，决赛单场。11 支世界队 + 你 + 20 支随机队。',
  },
]

export function cupDefById(id: CupId): CupDef {
  const def = CUP_DEFS.find((item) => item.id === id)
  if (!def) throw new Error(`未知杯赛：${id}`)
  return def
}
