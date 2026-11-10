import type { LegendTeamDef } from './legend-teams.ts'

/**
 * 巅峰之路的固定特别 Boss。与 81–100 的世界杯国家队一样是静态数据，
 * 不参与生成器抽签；当前 CA 仍由关卡曲线决定（第 50 关 = 780）。
 *
 * 《足球小将》全明星是架空阵容，不对应真实赛季；球员姓名/俱乐部名仅用于原型玩法测试。
 */
export const CAPTAIN_TSUBASA_ALL_STARS: LegendTeamDef = {
  id: 'captain-tsubasa-all-stars',
  club: '足球小将',
  clubEn: 'Captain Tsubasa All-Stars',
  season: '全明星',
  coach: '全明星联队',
  tier: 'S+',
  formationId: '4-3-3',
  tactics: { attack: 'wing', passing: 'short', tempo: 'fast', line: 'high', press: 'high' },
  color: '#1d4ed8',
  accent: '#facc15',
  note: '《足球小将》全明星：大空翼、日向小次郎、若林源三、岬太郎、三杉淳……当前能力压到第 50 关的 780 CA，但每名球员的潜力上限按球星级别保留（1300–1500）。',
  players: [
    ['若林源三', 'Genzo Wakabayashi', '日本', 'GK', 'gk_wall', 90, 'R'],
    ['早田诚', 'Makoto Soda', '日本', 'W', 'fb_attacking', 82, 'L'],
    ['次藤洋', 'Hiroshi Jito', '日本', 'CB', 'cb_stopper', 84, 'R'],
    ['石崎了', 'Ryo Ishizaki', '日本', 'CB', 'cb_stopper', 80, 'R'],
    ['松山光', 'Hikaru Matsuyama', '日本', 'W', 'fb_playmaker', 85, 'R'],
    ['三杉淳', 'Jun Misugi', '日本', 'CM', 'cm_mezzala', 88, 'R'],
    ['大空翼', 'Tsubasa Ozora', '日本', 'CM', 'cm_playmaker', 94, 'R'],
    ['岬太郎', 'Taro Misaki', '日本', 'CM', 'cm_creator', 90, 'R'],
    ['葵新伍', 'Shingo Aoi', '日本', 'W', 'w_dribbler', 85, 'L'],
    ['日向小次郎', 'Kojiro Hyuga', '日本', 'ST', 'st_finisher', 92, 'R'],
    ['新田瞬', 'Shun Nitta', '日本', 'W', 'w_finisher', 84, 'R'],
    ['若岛津健', 'Ken Wakashimazu', '日本', 'GK', 'gk_shotstopper', 86, 'R'],
    ['泽田武', 'Takeshi Sawada', '日本', 'CM', 'cm_engine', 80, 'R'],
    ['井泽守', 'Mamoru Izawa', '日本', 'CM', 'cm_destroyer', 80, 'R'],
    ['来生哲兵', 'Teppei Kisugi', '日本', 'ST', 'st_poacher', 82, 'R'],
    ['泷一', 'Hajime Taki', '日本', 'W', 'w_crosser', 80, 'R'],
  ],
}

/** 关卡号 → 固定特别 Boss。 */
export const PEAK_BOSS_TEAMS: Record<number, LegendTeamDef> = {
  50: CAPTAIN_TSUBASA_ALL_STARS,
}

/** 每名角色的球星潜力上限：按角色区分，不是全员 1500。 */
export const PEAK_BOSS_POTENTIAL: Record<string, number> = {
  'Tsubasa Ozora': 1500,
  'Kojiro Hyuga': 1480,
  'Genzo Wakabayashi': 1470,
  'Taro Misaki': 1450,
  'Jun Misugi': 1440,
  'Shingo Aoi': 1420,
  'Hikaru Matsuyama': 1400,
  'Shun Nitta': 1380,
  'Ken Wakashimazu': 1370,
  'Hiroshi Jito': 1350,
  'Makoto Soda': 1340,
  'Ryo Ishizaki': 1320,
  'Teppei Kisugi': 1320,
  'Takeshi Sawada': 1300,
  'Mamoru Izawa': 1300,
  'Hajime Taki': 1300,
}
