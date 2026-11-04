import type { AITeamDef, ConferenceId, FormationId, Tactics, TierId } from '../types.ts'
import { AI_TEAM_DEFS } from './ai-teams.ts'

export type WorldClubDef = AITeamDef & { tier: TierId; conference?: ConferenceId; starCount: number }

const FORMATIONS: FormationId[] = ['1-2-3-1', '1-3-2-1', '1-2-2-2']
const TACTICS: Tactics[] = [
  { attack: 'balanced', passing: 'mixed', tempo: 'normal', line: 'mid', press: 'mid' },
  { attack: 'wing', passing: 'direct', tempo: 'fast', line: 'high', press: 'high' },
  { attack: 'middle', passing: 'short', tempo: 'slow', line: 'mid', press: 'mid' },
  { attack: 'balanced', passing: 'direct', tempo: 'normal', line: 'low', press: 'mid' },
  { attack: 'middle', passing: 'short', tempo: 'normal', line: 'mid', press: 'low' },
]
const COLORS = ['#34d399', '#ef4444', '#3b82f6', '#eab308', '#8b5cf6', '#f97316', '#06b6d4', '#ec4899', '#84cc16', '#64748b']

const D1_NAMES = ['金桥', '星港', '云岭', '铁塔', '赤岩', '蓝湾', '绿洲', '雷鸣', '雪原', '风城', '海门', '石门', '长河', '远山', '朝阳', '暮云', '金鹰', '银狐', '火鸟', '海燕']
const D2_NORTH = ['北原', '北风', '北辰', '北岭', '冰河', '白桦', '松江', '雪松', '寒城', '极光', '黑石', '铁林', '灰堡', '银峰', '霜岭', '冷湖', '冬青', '云杉', '白夜', '北星']
const D2_SOUTH = ['南岛', '南风', '南海', '红港', '金滩', '椰城', '潮汐', '珊瑚', '蓝礁', '暖阳', '木棉', '青竹', '雨林', '溪谷', '石桥', '花城', '荔湾', '榕树', '海角', '南星']

function def(id: string, name: string, tier: TierId, index: number, conference?: ConferenceId, strength = 3, starCount = 0): WorldClubDef {
  const tactic = TACTICS[index % TACTICS.length]
  const color = COLORS[index % COLORS.length]
  return {
    id, name, short: name.slice(0, 2), tier, conference, starCount,
    color, accent: '#0f172a', style: `${tier === 'champions' ? '顶级' : tier === 'division1' ? '一级' : '二级'}联赛球队。`,
    formationId: FORMATIONS[index % FORMATIONS.length], tactics: { ...tactic }, strength, playerNames: [],
  }
}

export const WORLD_CLUB_DEFS: WorldClubDef[] = [
  ...AI_TEAM_DEFS.map((team, index) => ({
    ...team,
    tier: 'champions' as const,
    starCount: index < 10 ? 4 : 3,
  })),
  ...D1_NAMES.map((name, index) => def(`d1_${String(index + 1).padStart(2, '0')}`, name, 'division1', index + 20, undefined, index < 6 ? 4 : index < 14 ? 3 : 2, index < 10 ? 2 : 1)),
  ...D2_NORTH.map((name, index) => def(`d2n_${String(index + 1).padStart(2, '0')}`, name, 'division2', index + 40, 'north', index < 5 ? 3 : index < 14 ? 2 : 1)),
  ...D2_SOUTH.map((name, index) => def(`d2s_${String(index + 1).padStart(2, '0')}`, name, 'division2', index + 60, 'south', index < 5 ? 3 : index < 14 ? 2 : 1)),
]

export const DIVISION_IDS = ['champions', 'division1', 'd2-north', 'd2-south'] as const
export function divisionIdForTier(tier: TierId, conference?: ConferenceId): string {
  if (tier === 'champions') return 'champions'
  if (tier === 'division1') return 'division1'
  return conference === 'south' ? 'd2-south' : 'd2-north'
}

export function worldClubsIn(tier: TierId, conference?: ConferenceId): WorldClubDef[] {
  return WORLD_CLUB_DEFS.filter((club) => club.tier === tier && (conference === undefined || club.conference === conference))
}
