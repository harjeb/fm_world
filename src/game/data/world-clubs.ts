import type { AITeamDef, ConferenceId, FormationId, Tactics, TierId, WorldClub } from '../types.ts'
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
export type ClubIdentity = readonly [name: string, enName: string, color: string]

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
    color, accent: '#0f172a', style: `${tier === 'champions' ? '顶级' : tier === 'division1' ? '精英' : '先锋'}联赛球队。`,
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

/** 初始设定在冠军联赛的 20 支球队 ID（ai_01–ai_20）：即使后续降级到二级也不允许玩家选择或接管。 */
export const INITIAL_CHAMPIONS_CLUB_IDS: ReadonlySet<string> = new Set(
  WORLD_CLUB_DEFS.filter((club) => club.tier === 'champions').map((club) => club.id),
)

/** 判断球队是否被锁定禁止玩家选择（初始冠军联赛球队或显式带 `playerLocked` 标记）。 */
export function isClubPlayerLocked(
  club: Pick<WorldClub, 'id' | 'squadKey' | 'playerLocked'> | string,
): boolean {
  if (typeof club === 'string') return INITIAL_CHAMPIONS_CLUB_IDS.has(club)
  return club.playerLocked === true
    || INITIAL_CHAMPIONS_CLUB_IDS.has(club.id)
    || (!!club.squadKey && INITIAL_CHAMPIONS_CLUB_IDS.has(club.squadKey))
}

/** 二级联赛东区（zone3）：中东欧与日韩低级别/次级老牌球队（≤7 字）。 */
const D2_EAST_CLUBS: readonly ClubIdentity[] = [
  ['罗斯托克', 'Hansa Rostock', '#1a5fb4'],
  ['科特布斯', 'Energie Cottbus', '#d6242f'],
  ['奥厄', 'Erzgebirge Aue', '#6b2fa0'],
  ['亚琛', 'Alemannia Aachen', '#e5a50a'],
  ['曼海姆', 'Waldhof Mannheim', '#1c5fb8'],
  ['杜伊斯堡', 'MSV Duisburg', '#1e62b0'],
  ['埃森红白', 'Rot-Weiss Essen', '#d3212c'],
  ['萨尔布吕肯', '1. FC Saarbrucken', '#1b57a6'],
  ['奥斯纳布吕克', 'VfL Osnabruck', '#7c3aed'],
  ['克拉科夫', 'Wisla Krakow', '#d11f2b'],
  ['格但斯克', 'Lechia Gdansk', '#148a4c'],
  ['布尔诺', 'Zbrojovka Brno', '#d4202c'],
  ['布达佩斯捍卫者', 'Budapest Honved', '#c8102e'],
  ['仙台七夕', 'Vegalta Sendai', '#f2c500'],
  ['千叶市原', 'JEF United Chiba', '#16a34a'],
  ['大宫松鼠', 'Omiya Ardija', '#e8601c'],
  ['松本山雅', 'Matsumoto Yamaga', '#167a3e'],
  ['甲府风林', 'Ventforet Kofu', '#2563eb'],
  ['釜山偶像', 'Busan IPark', '#d41e2b'],
  ['全南天龙', 'Jeonnam Dragons', '#e6b800'],
]

/** 二级联赛西区（zone4）：英伦、法国与北美低级别老牌球队（≤7 字）。 */
const D2_WEST_CLUBS: readonly ClubIdentity[] = [
  ['温布尔登', 'AFC Wimbledon', '#1d56a8'],
  ['诺茨郡', 'Notts County', '#334155'],
  ['布拉德福德城', 'Bradford City', '#8a1c33'],
  ['卡莱尔联', 'Carlisle United', '#1e62b5'],
  ['克鲁', 'Crewe Alexandra', '#d4202c'],
  ['斯温登', 'Swindon Town', '#d6242f'],
  ['维尔港', 'Port Vale', '#e2e8f0'],
  ['沃尔索尔', 'Walsall', '#c81e2b'],
  ['唐卡斯特流浪者', 'Doncaster Rovers', '#d3212c'],
  ['奥尔德姆', 'Oldham Athletic', '#1f5fb8'],
  ['绍森德联', 'Southend United', '#1a4989'],
  ['罗奇代尔', 'Rochdale', '#1c5fb8'],
  ['雷克瑟姆', 'Wrexham', '#d4202c'],
  ['女王公园', "Queen's Park", '#cbd5e1'],
  ['帕尔蒂克', 'Partick Thistle', '#e5a50a'],
  ['因弗内斯', 'Inverness CT', '#1d5fb0'],
  ['索肖', 'FC Sochaux', '#f0c419'],
  ['南锡', 'AS Nancy', '#d6242f'],
  ['底特律城', 'Detroit City FC', '#7a1f33'],
  ['查尔斯顿电池', 'Charleston Battery', '#f5c400'],
]

/** 二级联赛中区（zone5）：意、西、瑞、奥与北欧低级别老牌球队（≤7 字）。 */
const D2_CENTRAL_CLUBS: readonly ClubIdentity[] = [
  ['卡塔尼亚', 'Catania', '#c81e2b'],
  ['佩鲁贾', 'Perugia', '#d3202c'],
  ['维琴察', 'LR Vicenza', '#d4202c'],
  ['斯帕尔', 'SPAL', '#2c82c9'],
  ['佩斯卡拉', 'Pescara', '#3498db'],
  ['阿斯科利', 'Ascoli', '#cbd5e1'],
  ['特尔纳纳', 'Ternana', '#16803c'],
  ['阿韦利诺', 'Avellino', '#148a4c'],
  ['贝内文托', 'Benevento', '#e6a817'],
  ['帕多瓦', 'Padova', '#d0202c'],
  ['皇家穆尔西亚', 'Real Murcia', '#c8102e'],
  ['蓬费拉迪纳', 'Ponferradina', '#1e5fb5'],
  ['萨拉曼卡', 'Salamanca UDS', '#dde3ea'],
  ['努曼西亚', 'Numancia', '#d3202c'],
  ['洛格罗涅斯', 'UD Logrones', '#c81e2b'],
  ['阿劳', 'FC Aarau', '#d0202c'],
  ['瓦杜兹', 'FC Vaduz', '#c8102e'],
  ['维也纳第一', 'First Vienna FC', '#f5c400'],
  ['厄勒布鲁', 'Orebro SK', '#cbd5e1'],
  ['赫尔辛堡', 'Helsingborgs IF', '#d11f2b'],
]

/** 二级联赛大西洋区（zone6）：葡、荷、比与南美老牌低级别球队（≤7 字）。 */
const D2_ATLANTIC_CLUBS: readonly ClubIdentity[] = [
  ['科英布拉大学', 'Academica de Coimbra', '#334155'],
  ['塞图巴尔', 'Vitoria de Setubal', '#15803d'],
  ['贝伦人', 'Os Belenenses', '#1d63c4'],
  ['查韦斯', 'GD Chaves', '#b91c1c'],
  ['马里迪莫', 'CS Maritimo', '#15803d'],
  ['帕索斯费雷拉', 'Pacos de Ferreira', '#eab308'],
  ['罗达克拉德', 'Roda JC', '#f5c400'],
  ['坎布尔', 'SC Cambuur', '#f3c614'],
  ['格拉夫夏普', 'De Graafschap', '#1e62b5'],
  ['埃门', 'FC Emmen', '#d3212c'],
  ['马斯特里赫特', 'MVV Maastricht', '#c81e2b'],
  ['贝弗伦', 'SK Beveren', '#eab308'],
  ['利尔斯', 'Lierse', '#f5c400'],
  ['查卡里塔青年', 'Chacarita Juniors', '#c8102e'],
  ['费罗卡里尔', 'Ferro Carril Oeste', '#16803c'],
  ['圣菲科隆', 'Colon de Santa Fe', '#b91c1c'],
  ['全男孩竞技', 'All Boys', '#e2e8f0'],
  ['累西腓航海', 'Nautico', '#d3202c'],
  ['圣十字', 'Santa Cruz', '#c8102e'],
  ['瓦尔帕莱索', 'Santiago Wanderers', '#15803d'],
]

/** 扩区预备池（24 队，≤7 字）：用于重名替补及更多新增赛区。 */
const D2_RESERVE_CLUBS: readonly ClubIdentity[] = [
  ['切斯特菲尔德', 'Chesterfield', '#1d5fb0'],
  ['约克城', 'York City', '#d3212c'],
  ['斯托克波特', 'Stockport County', '#1e56a0'],
  ['巴尼特', 'Barnet', '#f08c00'],
  ['盖茨黑德', 'Gateshead', '#334155'],
  ['哈利法克斯', 'FC Halifax Town', '#1f63b3'],
  ['梅德斯通联', 'Maidstone United', '#e5a50a'],
  ['切尔滕汉姆', 'Cheltenham Town', '#d4202c'],
  ['吉林汉姆', 'Gillingham', '#1c5fb8'],
  ['科尔切斯特联', 'Colchester United', '#1e62b5'],
  ['弗利特伍德', 'Fleetwood Town', '#d6242f'],
  ['什鲁斯伯里', 'Shrewsbury Town', '#2563eb'],
  ['伯顿阿尔比恩', 'Burton Albion', '#f5c400'],
  ['剑桥联', 'Cambridge United', '#e6a817'],
  ['埃克塞特城', 'Exeter City', '#c81e2b'],
  ['林肯城', 'Lincoln City', '#d3202c'],
  ['维冈竞技', 'Wigan Athletic', '#1d63c4'],
  ['博尔顿流浪者', 'Bolton Wanderers', '#e2e8f0'],
  ['罗瑟汉姆', 'Rotherham United', '#d4202c'],
  ['巴恩斯利', 'Barnsley', '#d11f2b'],
  ['布莱克浦', 'Blackpool', '#f06a00'],
  ['北安普顿', 'Northampton Town', '#7a1f33'],
  ['卢顿', 'Luton Town', '#ea580c'],
  ['考文垂', 'Coventry City', '#38bdf8'],
]

const EXPANDED_POOLS: readonly (readonly ClubIdentity[])[] = [
  D2_EAST_CLUBS,
  D2_WEST_CLUBS,
  D2_CENTRAL_CLUBS,
  D2_ATLANTIC_CLUBS,
  D2_RESERVE_CLUBS,
]

const FALLBACK_CITY_ROOTS = [
  ['切斯特', 'Chester'],
  ['达林顿', 'Darlington'],
  ['赫里福德', 'Hereford'],
  ['托基', 'Torquay'],
  ['约维尔', 'Yeovil'],
  ['绍斯波特', 'Southport'],
  ['巴斯', 'Bath'],
  ['达姆施塔特', 'Darmstadt'],
  ['卡塞尔', 'Kassel'],
  ['卢布尔雅那', 'Ljubljana'],
  ['特尔纳瓦', 'Trnava'],
  ['里耶卡', 'Rijeka'],
  ['波鸿', 'Bochum'],
  ['乌尔姆', 'Ulm'],
  ['阿尔巴塞特', 'Albacete'],
  ['布雷西亚', 'Brescia'],
] as const

const FALLBACK_SUFFIXES = [
  ['联', 'United'],
  ['城', 'City'],
  ['镇', 'Town'],
  ['竞技', 'Athletic'],
  ['郡', 'County'],
] as const

const FALLBACK_COLORS = ['#1d63c4', '#d3212c', '#15803d', '#e5a50a', '#7c3aed', '#0f766e', '#b91c1c', '#334155'] as const

/** 按扩区序号选出尚未被占用的真实低级别球队名（全部 ≤7 字）；超出预设池时生成 ≤7 字纯音译地名。 */
export function pickExpandedZoneClubs(zoneNo: number, usedNames: ReadonlySet<string>, count = 20): ClubIdentity[] {
  const taken = new Set(usedNames)
  const preferredIndex = zoneNo >= 3 && zoneNo - 3 < EXPANDED_POOLS.length ? zoneNo - 3 : -1
  const orderedPools = preferredIndex >= 0
    ? [EXPANDED_POOLS[preferredIndex], ...EXPANDED_POOLS.filter((_, idx) => idx !== preferredIndex)]
    : [...EXPANDED_POOLS]
  const picked: ClubIdentity[] = []
  for (const pool of orderedPools) {
    for (const item of pool) {
      if (picked.length >= count) return picked
      if (taken.has(item[0]) || item[0].length > 7) continue
      taken.add(item[0])
      picked.push(item)
    }
  }
  for (let i = 0; picked.length < count && i < FALLBACK_CITY_ROOTS.length * FALLBACK_SUFFIXES.length; i++) {
    const [city, cityEn] = FALLBACK_CITY_ROOTS[i % FALLBACK_CITY_ROOTS.length]
    const [suffix, suffixEn] = FALLBACK_SUFFIXES[Math.floor(i / FALLBACK_CITY_ROOTS.length) % FALLBACK_SUFFIXES.length]
    const name = `${city}${suffix}`
    if (name.length > 7 || taken.has(name)) continue
    taken.add(name)
    picked.push([name, `${cityEn} ${suffixEn}`, FALLBACK_COLORS[i % FALLBACK_COLORS.length]])
  }
  return picked
}

export const DIVISION_IDS = ['champions', 'division1', 'd2-north', 'd2-south'] as const
export function divisionIdForTier(tier: TierId, conference?: ConferenceId): string {
  if (tier === 'champions') return 'champions'
  if (tier === 'division1') {
    if (conference === 'north') return 'd1-north'
    if (conference === 'south') return 'd1-south'
    return 'division1'
  }
  if (conference === 'south') return 'd2-south'
  if (conference === 'north' || conference === undefined) return 'd2-north'
  return `d2-${conference}`
}

const EXPANDED_CONFERENCE_NAMES = [
  '东区',
  '西区',
  '中区',
  '大西洋区',
  '太平洋区',
  '地中海区',
  '北海区',
  '波罗的海区',
  '加勒比区',
  '安第斯区',
  '莱茵区',
  '多瑙区',
  '阿尔卑斯区',
  '伊比利亚区',
  '爱琴海区',
  '亚得里亚区',
] as const
const FALLBACK_CONF_REGIONS = ['远东', '海湾', '高原', '峡湾', '绿洲', '极地', '群岛', '海峡', '河谷', '海岸', '半岛', '大陆'] as const
const FALLBACK_CONF_DIRS = ['东', '西', '南', '北', '中'] as const

/** 二级联赛赛区的显示名：南北两区之后依次使用东区、西区等地理名，不使用数字编号。 */
export function conferenceLabel(conference?: ConferenceId): string {
  if (conference === 'north') return '北区'
  if (conference === 'south') return '南区'
  if (!conference) return ''
  const zoneNo = Number(conference.replace('zone', ''))
  if (Number.isInteger(zoneNo) && zoneNo >= 3) {
    const idx = zoneNo - 3
    if (idx < EXPANDED_CONFERENCE_NAMES.length) return EXPANDED_CONFERENCE_NAMES[idx]
    const extra = idx - EXPANDED_CONFERENCE_NAMES.length
    const region = FALLBACK_CONF_REGIONS[Math.floor(extra / FALLBACK_CONF_DIRS.length) % FALLBACK_CONF_REGIONS.length]
    const dir = FALLBACK_CONF_DIRS[extra % FALLBACK_CONF_DIRS.length]
    return `${region}${dir}区`
  }
  return '扩展区'
}

/** 从 d1-xxx / d2-xxx 的赛区 ID 反推赛区；单区一级和冠军没有赛区。 */
export function conferenceOfDivision(divisionId: string): ConferenceId | undefined {
  if (divisionId === 'd1-north' || divisionId === 'd2-north') return 'north'
  if (divisionId === 'd1-south' || divisionId === 'd2-south') return 'south'
  if (divisionId.startsWith('d2-')) return divisionId.slice(3) as ConferenceId
  return undefined
}

export function worldClubsIn(tier: TierId, conference?: ConferenceId): WorldClubDef[] {
  return WORLD_CLUB_DEFS.filter((club) => club.tier === tier && (conference === undefined || club.conference === conference))
}
