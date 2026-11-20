import type { AITeam, ElevenFormationId } from '../types.ts'
import { LEGEND_TEAMS, type LegendTeamDef } from './legend-teams.ts'
import { buildHistoricTeam } from '../legend.ts'
import { alignHighCaTeam } from '../pve-strength.ts'

export const LEGEND_CUP_ID_PREFIX = 'lcup-'

/**
 * 2022-23 曼城三冠王（欧冠、英超、足总杯）：传奇杯特邀历史强队。
 * 名单严格取自 2022-23 赛季欧冠决赛大名单与三冠王核心阵容。
 */
const MAN_CITY_2022_23: LegendTeamDef = {
  id: 'man-city-2022-23',
  club: '曼城',
  clubEn: 'Manchester City',
  country: '英格兰',
  season: '2022-23',
  coach: '瓜迪奥拉',
  tier: 'S+',
  formationId: '4-1-4-1',
  tactics: { attack: 'balanced', passing: 'short', tempo: 'normal', line: 'high', press: 'high' },
  color: '#6cabdd',
  accent: '#1c2c5b',
  note: '三冠王：欧冠决赛 1-0 国际米兰，英超、足总杯、欧冠全收，哈兰德单季 52 球。',
  players: [
    ['埃德森', 'Ederson Moraes', '巴西', 'GK', 'gk_sweeper', 88, 'L'],
    ['阿克', 'Nathan Aké', '荷兰', 'W', 'fb_attacking', 86, 'L'],
    ['鲁本·迪亚斯', 'Rúben Dias', '葡萄牙', 'CB', 'cb_stopper', 90],
    ['斯通斯', 'John Stones', '英格兰', 'CB', 'cb_ballplaying', 88],
    ['沃克', 'Kyle Walker', '英格兰', 'W', 'fb_attacking', 88],
    ['罗德里', 'Rodri Hernández', '西班牙', 'CM', 'cm_destroyer', 91],
    ['格拉利什', 'Jack Grealish', '英格兰', 'W', 'w_dribbler', 86],
    ['京多安', 'İlkay Gündoğan', '德国', 'CM', 'cm_box2box', 89],
    ['德布劳内', 'Kevin De Bruyne', '比利时', 'CM', 'cm_creator', 92],
    ['贝尔纳多·席尔瓦', 'Bernardo Silva', '葡萄牙', 'W', 'w_playmaker', 89, 'L'],
    ['哈兰德', 'Erling Haaland', '挪威', 'ST', 'st_finisher', 92, 'L'],
    ['奥尔特加', 'Stefan Ortega', '德国', 'GK', 'gk_sweeper', 82],
    ['阿坎吉', 'Manuel Akanji', '瑞士', 'CB', 'cb_cover', 86],
    ['拉波尔特', 'Aymeric Laporte', '西班牙', 'CB', 'cb_ballplaying', 85, 'L'],
    ['福登', 'Phil Foden', '英格兰', 'W', 'w_playmaker', 88, 'L'],
    ['阿尔瓦雷斯', 'Julián Álvarez', '阿根廷', 'ST', 'st_runner', 86],
  ],
}

export type LegendCupClubSpec = {
  /** 赛季杯赛中的稳定参赛 ID（带 lcup- 前缀，与世界俱乐部和普通传奇挑战隔离）。 */
  id: string
  /** 历史球队定义 ID（来自 LEGEND_TEAMS 或传奇杯专属定义）。 */
  defId: string
  /** 传奇杯首发平均 CA 目标。 */
  targetCa: number
}

/**
 * 传奇杯特邀的 12 支真实历史最强俱乐部：
 * 严格要求“一个俱乐部一支”，覆盖欧洲与南美最具统治力的单季巅峰阵容，按首发 CA（1300–1600）从高到低排序供分档抽签。
 */
export const LEGEND_CUP_SPECS: readonly LegendCupClubSpec[] = [
  { id: 'lcup-barcelona-2010-11', defId: 'barcelona-2010-11', targetCa: 1600 },
  { id: 'lcup-real-madrid-2016-17', defId: 'real-madrid-2016-17', targetCa: 1580 },
  { id: 'lcup-milan-1988-89', defId: 'milan-1988-89', targetCa: 1555 },
  { id: 'lcup-bayern-2012-13', defId: 'bayern-2012-13', targetCa: 1530 },
  { id: 'lcup-ajax-1971-72', defId: 'ajax-1971-72', targetCa: 1500 },
  { id: 'lcup-man-city-2022-23', defId: 'man-city-2022-23', targetCa: 1475 },
  { id: 'lcup-man-utd-1998-99', defId: 'man-utd-1998-99', targetCa: 1450 },
  { id: 'lcup-inter-2009-10', defId: 'inter-2009-10', targetCa: 1420 },
  { id: 'lcup-liverpool-1983-84', defId: 'liverpool-1983-84', targetCa: 1390 },
  { id: 'lcup-santos-1962-63', defId: 'santos-1962-63', targetCa: 1360 },
  { id: 'lcup-arsenal-2003-04', defId: 'arsenal-2003-04', targetCa: 1330 },
  { id: 'lcup-juventus-1995-96', defId: 'juventus-1995-96', targetCa: 1300 },
] as const

export const LEGEND_CUP_TEAM_IDS: readonly string[] = LEGEND_CUP_SPECS.map((spec) => spec.id)

const EXTRA_DEFS: Record<string, LegendTeamDef> = {
  [MAN_CITY_2022_23.id]: MAN_CITY_2022_23,
}

function defFor(defId: string): LegendTeamDef {
  const def = EXTRA_DEFS[defId] ?? LEGEND_TEAMS.find((item) => item.id === defId)
  if (!def) throw new Error(`找不到传奇杯历史球队定义：${defId}`)
  return def
}

export type LegendCupClubMeta = {
  id: string
  defId: string
  name: string
  club: string
  clubEn: string
  country: string
  season: string
  coach: string
  color: string
  accent: string
  formationId: ElevenFormationId
  targetCa: number
  note: string
}

export const LEGEND_CUP_META: readonly LegendCupClubMeta[] = LEGEND_CUP_SPECS.map((spec) => {
  const def = defFor(spec.defId)
  return {
    id: spec.id,
    defId: spec.defId,
    name: `${def.club} ${def.season}`,
    club: def.club,
    clubEn: def.clubEn,
    country: def.country ?? '',
    season: def.season,
    coach: def.coach,
    color: def.color,
    accent: def.accent,
    formationId: def.formationId,
    targetCa: spec.targetCa,
    note: def.note,
  }
})

const metaMap = new Map(LEGEND_CUP_META.map((meta) => [meta.id, meta]))
const specMap = new Map(LEGEND_CUP_SPECS.map((spec) => [spec.id, spec]))
const teamCache = new Map<string, AITeam>()

export function isLegendCupTeamId(id: string): boolean {
  return id.startsWith(LEGEND_CUP_ID_PREFIX) && specMap.has(id)
}

export function legendCupMetaById(id: string): LegendCupClubMeta | undefined {
  return metaMap.get(id)
}

/**
 * 构建传奇杯特邀历史强队（首发 CA 精确校准至各队目标）；
 * 球队与球员 ID 均以 `lcup-` 为前缀，与联赛俱乐部及普通传奇挑战隔离。
 */
export function legendCupTeamById(id: string): AITeam | undefined {
  const cached = teamCache.get(id)
  if (cached) return structuredClone(cached)
  const spec = specMap.get(id)
  if (!spec) return undefined
  const def = defFor(spec.defId)
  const built = buildHistoricTeam(def)
  const scaled = alignHighCaTeam(built, spec.targetCa)
  const idMap = new Map<string, string>()
  scaled.id = spec.id
  scaled.style = `传奇杯 · CA ${spec.targetCa}`
  scaled.players = scaled.players.map((player, index) => {
    const nextId = `${spec.id}-${String(index + 1).padStart(2, '0')}`
    idMap.set(player.id, nextId)
    return { ...player, id: nextId }
  })
  scaled.lineup = {
    ...scaled.lineup,
    starters: scaled.lineup.starters.map((starter) => ({
      ...starter,
      playerId: idMap.get(starter.playerId) ?? starter.playerId,
    })),
    bench: scaled.lineup.bench.map((playerId) => idMap.get(playerId) ?? playerId),
  }
  scaled.starPlayerIds = scaled.starPlayerIds.map((playerId) => idMap.get(playerId) ?? playerId)
  teamCache.set(id, scaled)
  return structuredClone(scaled)
}

export function allLegendCupTeams(): AITeam[] {
  return LEGEND_CUP_SPECS.map((spec) => legendCupTeamById(spec.id)!)
}
