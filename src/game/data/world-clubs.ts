import type { AITeamDef, ConferenceId, FormationId, Tactics, TierId } from '../types.ts'
import { AI_TEAM_DEFS } from './ai-teams.ts'

export type WorldClubDef = AITeamDef & { tier: TierId; conference?: ConferenceId; starCount: number }

const FORMATIONS: FormationId[] = ['4-4-2', '4-3-3', '4-2-3-1', '3-5-2', '5-3-2', '4-1-4-1', '3-4-3', '4-1-2-1-2']
const TACTICS: Tactics[] = [
  { attack: 'balanced', passing: 'mixed', tempo: 'normal', line: 'mid', press: 'mid' },
  { attack: 'wing', passing: 'direct', tempo: 'fast', line: 'high', press: 'high' },
  { attack: 'middle', passing: 'short', tempo: 'slow', line: 'mid', press: 'mid' },
  { attack: 'balanced', passing: 'direct', tempo: 'normal', line: 'low', press: 'mid' },
  { attack: 'middle', passing: 'short', tempo: 'normal', line: 'mid', press: 'low' },
]


/** 名字、英文名、主色。都是真实球队，只借用名字和队服颜色，实力与现实无关。 */
type ClubIdentity = readonly [name: string, enName: string, color: string]

/** 一级联赛：各国次级联赛的老牌球队。 */
const D1_CLUBS: ClubIdentity[] = [
  ['拉科鲁尼亚', 'Deportivo La Coruna', '#1d63c4'],
  ['希洪竞技', 'Sporting Gijon', '#d6242f'],
  ['桑坦德竞技', 'Racing Santander', '#1f8a4c'],
  ['桑普多利亚', 'Sampdoria', '#1c5fb8'],
  ['巴勒莫', 'Palermo', '#f08bb4'],
  ['巴里', 'Bari', '#e0262e'],
  ['凯泽斯劳滕', 'Kaiserslautern', '#d4002d'],
  ['纽伦堡', 'Nurnberg', '#a51e36'],
  ['德累斯顿迪纳摩', 'Dynamo Dresden', '#f5c400'],
  ['不伦瑞克', 'Eintracht Braunschweig', '#e8b90f'],
  ['谢菲尔德星期三', 'Sheffield Wednesday', '#1d5fb0'],
  ['布里斯托尔城', 'Bristol City', '#d01f2f'],
  ['诺维奇', 'Norwich City', '#f5d100'],
  ['德比郡', 'Derby County', '#eef1f4'],
  ['圣埃蒂安', 'Saint-Etienne', '#0a8a4a'],
  ['巴斯蒂亚', 'Bastia', '#0c56a6'],
  ['维特斯', 'Vitesse', '#f2c500'],
  ['威廉二世', 'Willem II', '#d71920'],
  ['瓜拉尼', 'Guarani', '#0d7c3f'],
  ['札幌冈萨多', 'Consadole Sapporo', '#c8102e'],
]

/** 二级联赛北区：英伦三岛、德国、荷兰、北欧、日本和美国的低级别球队。 */
const D2_NORTH_CLUBS: ClubIdentity[] = [
  ['阿克灵顿斯坦利', 'Accrington Stanley', '#cf1f2e'],
  ['格里姆斯比', 'Grimsby Town', '#f0f2f4'],
  ['特兰米尔流浪者', 'Tranmere Rovers', '#2b6cb0'],
  ['哈特尔普尔联', 'Hartlepool United', '#1f5fbf'],
  ['莫克姆', 'Morecambe', '#d3212c'],
  ['巴罗', 'Barrow', '#2c6fb7'],
  ['哈罗盖特', 'Harrogate Town', '#f3c614'],
  ['森林绿流浪者', 'Forest Green Rovers', '#78be20'],
  ['阿布罗斯', 'Arbroath', '#7a1f33'],
  ['考登比斯', 'Cowdenbeath', '#1e56a0'],
  ['东法夫', 'East Fife', '#d9a21b'],
  ['斯滕豪斯缪尔', 'Stenhousemuir', '#7d1c2e'],
  ['梅彭', 'SV Meppen', '#1f63b3'],
  ['奥芬巴赫踢球者', 'Kickers Offenbach', '#d11f2b'],
  ['伍珀塔尔', 'Wuppertaler SV', '#c8102e'],
  ['登博斯', 'FC Den Bosch', '#1765b5'],
  ['海尔蒙德', 'Helmond Sport', '#f07d00'],
  ['斯塔贝克', 'Stabaek', '#1f6fc4'],
  ['岩手盛冈', 'Iwate Grulla Morioka', '#9e1b32'],
  ['麦迪逊前进', 'Forward Madison', '#ef5da8'],
]

/** 二级联赛南区：南欧、南美、非洲和大洋洲的低级别球队。 */
const D2_SOUTH_CLUBS: ClubIdentity[] = [
  ['莱昂文化', 'Cultural Leonesa', '#eef1f4'],
  ['费罗尔竞技', 'Racing de Ferrol', '#0e7a3b'],
  ['塔拉戈纳竞技', 'Gimnastic de Tarragona', '#d3202c'],
  ['韦尔瓦竞技', 'Recreativo de Huelva', '#2a6fbb'],
  ['埃尔库莱斯', 'Hercules', '#1e62b0'],
  ['普罗韦尔切利', 'Pro Vercelli', '#e6e9ed'],
  ['普罗帕特里亚', 'Pro Patria', '#1f66b8'],
  ['特里斯蒂纳', 'Triestina', '#c8102e'],
  ['南墨尔本', 'South Melbourne', '#1c4ea0'],
  ['诺瓦拉', 'Novara', '#2f8fdc'],
  ['福贾', 'Foggia', '#c41e2e'],
  ['莱克索斯', 'Leixoes', '#d81e2c'],
  ['佩纳菲尔', 'Penafiel', '#bf1e2e'],
  ['费伦塞', 'Feirense', '#1a5ca8'],
  ['巴黎红星', 'Red Star', '#148a4c'],
  ['敦刻尔克', 'Dunkerque', '#1f68ba'],
  ['开普敦马刺', 'Cape Town Spurs', '#b5121b'],
  ['费罗维亚里亚', 'Ferroviaria', '#7b1e2f'],
  ['基尔梅斯', 'Quilmes', '#dde3ea'],
  ['新芝加哥', 'Nueva Chicago', '#0f7d3e'],
]

/** 旧版虚构队名，只用来升级旧存档。 */
const LEGACY_D1 = ['金桥', '星港', '云岭', '铁塔', '赤岩', '蓝湾', '绿洲', '雷鸣', '雪原', '风城', '海门', '石门', '长河', '远山', '朝阳', '暮云', '金鹰', '银狐', '火鸟', '海燕']
const LEGACY_D2_NORTH = ['北原', '北风', '北辰', '北岭', '冰河', '白桦', '松江', '雪松', '寒城', '极光', '黑石', '铁林', '灰堡', '银峰', '霜岭', '冷湖', '冬青', '云杉', '白夜', '北星']
const LEGACY_D2_SOUTH = ['南岛', '南风', '南海', '红港', '金滩', '椰城', '潮汐', '珊瑚', '蓝礁', '暖阳', '木棉', '青竹', '雨林', '溪谷', '石桥', '花城', '荔湾', '榕树', '海角', '南星']

export const LEGACY_CLUB_RENAMES: ReadonlyMap<string, { name: string; enName: string; color: string }> = new Map(
  ([[LEGACY_D1, D1_CLUBS], [LEGACY_D2_NORTH, D2_NORTH_CLUBS], [LEGACY_D2_SOUTH, D2_SOUTH_CLUBS]] as const).flatMap(([names, clubs]) =>
    names.map((name, index): [string, { name: string; enName: string; color: string }] => [name, { name: clubs[index][0], enName: clubs[index][1], color: clubs[index][2] }])),
)

function def(id: string, [name, enName, color]: ClubIdentity, tier: TierId, index: number, conference?: ConferenceId, strength = 3, starCount = 0): WorldClubDef {
  const tactic = TACTICS[index % TACTICS.length]
  return {
    id, name, enName, short: name.slice(0, 2), tier, conference, starCount,
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
  ...D1_CLUBS.map((club, index) => def(`d1_${String(index + 1).padStart(2, '0')}`, club, 'division1', index + 20, undefined, index < 6 ? 4 : index < 14 ? 3 : 2, index < 10 ? 2 : 1)),
  ...D2_NORTH_CLUBS.map((club, index) => def(`d2n_${String(index + 1).padStart(2, '0')}`, club, 'division2', index + 40, 'north', index < 5 ? 3 : index < 14 ? 2 : 1)),
  ...D2_SOUTH_CLUBS.map((club, index) => def(`d2s_${String(index + 1).padStart(2, '0')}`, club, 'division2', index + 60, 'south', index < 5 ? 3 : index < 14 ? 2 : 1)),
]

export const DIVISION_IDS = ['champions', 'division1', 'd2-north', 'd2-south'] as const
export function divisionIdForTier(tier: TierId, conference?: ConferenceId): string {
  if (tier === 'champions') return 'champions'
  if (tier === 'division1') return 'division1'
  if (conference === 'south') return 'd2-south'
  if (conference === 'north' || conference === undefined) return 'd2-north'
  return `d2-${conference}`
}

/** 二级联赛赛区的显示名。 */
export function conferenceLabel(conference?: ConferenceId): string {
  if (conference === 'north') return '北区'
  if (conference === 'south') return '南区'
  if (!conference) return ''
  return `第 ${conference.replace('zone', '')} 区`
}

/** 从 d2-xxx 的赛区 ID 反推赛区；一级和冠军没有赛区。 */
export function conferenceOfDivision(divisionId: string): ConferenceId | undefined {
  if (divisionId === 'd2-north') return 'north'
  if (divisionId === 'd2-south') return 'south'
  if (divisionId.startsWith('d2-')) return divisionId.slice(3) as ConferenceId
  return undefined
}

export function worldClubsIn(tier: TierId, conference?: ConferenceId): WorldClubDef[] {
  return WORLD_CLUB_DEFS.filter((club) => club.tier === tier && (conference === undefined || club.conference === conference))
}
