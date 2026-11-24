// 2D TCG Booster Draft + 8-Team Swiss System Event ("星秀轮抽杯")
// Pure deterministic TypeScript: 1 Player + 7 AI coaches, 12-player packs (pick 1 pass 11),
// 20-player squads per team, matured trained cards (CA 800..1400), seasonal pool themes, and 4-round Swiss standings.

import type {
  AttrKey,
  Attributes,
  DetailedPosition,
  ElevenFormationId,
  FormationId,
  GameState,
  Lineup,
  MatchMentality,
  Player,
  Position,
  SkillId,
  SkillTier,
  Tactics,
} from '../types.ts'
import { ALL_ATTRIBUTES } from '../types.ts'
import { caOf } from '../ca.ts'
import { attrHardLimit, attrStorage, isMainAttr } from '../scale.ts'
import { createRandomPlayer } from '../data/random-players.ts'
import { DETAILED_TO_POSITION } from '../detailed-positions.ts'
import { autoFillLineup, validateLineup } from '../squad.ts'
import { FORMATIONS } from '../data/formations.ts'
import { derivedRng, splitSeed } from '../rng.ts'
import { MatchEngine } from '../match/engine.ts'
import { PesEngine } from '../pes/engine.ts'
import { createMatchRecord, fixtureScorers, teamInputFromLineup } from '../match/setup.ts'
import { LOGIC_MATCH_SECONDS } from '../match/time.ts'

export const DRAFT_POD_SIZE = 8
export const DRAFT_PACK_SIZE = 12
export const DRAFT_PICKS_PER_PACK = 10
export const DRAFT_PACK_ROUNDS = 2
export const DRAFT_SQUAD_TARGET = DRAFT_PICKS_PER_PACK * DRAFT_PACK_ROUNDS // 20 players per team
export const DRAFT_SWISS_ROUNDS = 4

export type DraftPoolThemeId = 'all_star' | 'u20_storm' | 'veteran_masters' | 'specialists'

export interface DraftPoolTheme {
  id: DraftPoolThemeId
  label: string
  badge: string
  summary: string
  ruleNote: string
  ageRange: [number, number]
  acePackOne: boolean
  keepFatigue: boolean
  specialistBoost: number
}

export const DRAFT_POOL_THEMES: Record<DraftPoolThemeId, DraftPoolTheme> = {
  all_star: {
    id: 'all_star',
    label: '全明星王牌池',
    badge: '王牌首抓',
    summary: 'CA 800–1400 全位置成型神卡池，首包必含 1320+ CA 五技能建队基石，每场体能回满纯拼硬实力与针对变阵。',
    ruleNote: '首包保底超巨 · 赛后体能回满',
    ageRange: [22, 29],
    acePackOne: true,
    keepFatigue: false,
    specialistBoost: 1.0,
  },
  u20_storm: {
    id: 'u20_storm',
    label: 'U20 青春风暴池',
    badge: '超新星季',
    summary: '全员 17–20 岁满练妖人（自带年轻过人与高压逼抢冲劲加成，但战术执行偏青涩，抢到带领袖/冷静技能的中轴即占先机）。',
    ruleNote: '全员 17–20 岁 · 快打冲劲加成',
    ageRange: [17, 20],
    acePackOne: false,
    keepFatigue: false,
    specialistBoost: 1.06,
  },
  veteran_masters: {
    id: 'veteran_masters',
    label: '功勋宗师杯',
    badge: '深度轮换季',
    summary: '大量 30–34 岁满战术执行度与关键球加成的老将宗师；瑞士轮各场保留轻度体能消耗，20 人名单轮换厚度成为胜负手！',
    ruleNote: '30–34 岁宗师 · 跨场保留轻度疲劳',
    ageRange: [30, 34],
    acePackOne: true,
    keepFatigue: true,
    specialistBoost: 1.04,
  },
  specialists: {
    id: 'specialists',
    label: '偏科怪才实验室',
    badge: '极致特化季',
    summary: '卡池专项主属性极度拔高（极速飞翼、防空重塔、重炮远射王、门线神扑王），考验玩家拼装极端化学反应。',
    ruleNote: '极致长板特化 · 赛后体能回满',
    ageRange: [21, 31],
    acePackOne: false,
    keepFatigue: false,
    specialistBoost: 1.24,
  },
}

const THEME_ROTATION: readonly DraftPoolThemeId[] = ['all_star', 'u20_storm', 'veteran_masters', 'specialists']

export function draftThemeForSeason(seasonIndex: number): DraftPoolTheme {
  return DRAFT_POOL_THEMES[THEME_ROTATION[Math.max(0, Math.floor(seasonIndex) - 3) % THEME_ROTATION.length]]
}

export interface DraftAIProfile {
  seat: number
  id: string
  name: string
  coachTitle: string
  color: string
  formationId: ElevenFormationId
  tactics: Tactics
  preferredAttrs: readonly AttrKey[]
}

export const DRAFT_AI_COACHES: readonly DraftAIProfile[] = [
  {
    seat: 1,
    id: 'draft-ai-1',
    name: '蔚蓝传控学院',
    coachTitle: '渗透流 · 4-3-3',
    color: '#2a84d2',
    formationId: '4-3-3',
    tactics: { attack: 'middle', passing: 'short', tempo: 'normal', line: 'high', press: 'high' },
    preferredAttrs: ['passing', 'vision', 'firstTouch', 'dribbling'],
  },
  {
    seat: 2,
    id: 'draft-ai-2',
    name: '赤焰重金属',
    coachTitle: '疯跑逼抢 · 4-3-3',
    color: '#d93b48',
    formationId: '4-3-3',
    tactics: { attack: 'wing', passing: 'direct', tempo: 'fast', line: 'high', press: 'high' },
    preferredAttrs: ['speed', 'acceleration', 'endurance', 'offBall'],
  },
  {
    seat: 3,
    id: 'draft-ai-3',
    name: '北境双塔团',
    coachTitle: '高空轰炸 · 4-4-2',
    color: '#3f7d58',
    formationId: '4-4-2',
    tactics: { attack: 'wing', passing: 'direct', tempo: 'normal', line: 'mid', press: 'mid' },
    preferredAttrs: ['strength', 'heading', 'passing', 'shooting'],
  },
  {
    seat: 4,
    id: 'draft-ai-4',
    name: '黑曜石防反队',
    coachTitle: '铁桶反击 · 5-3-2',
    color: '#5b6778',
    formationId: '5-3-2',
    tactics: { attack: 'balanced', passing: 'direct', tempo: 'fast', line: 'low', press: 'low' },
    preferredAttrs: ['tackling', 'defPos', 'speed', 'reflexes'],
  },
  {
    seat: 5,
    id: 'draft-ai-5',
    name: '黄金菱形中轴',
    coachTitle: '中路控制 · 4-2-3-1',
    color: '#c9972b',
    formationId: '4-2-3-1',
    tactics: { attack: 'middle', passing: 'short', tempo: 'normal', line: 'mid', press: 'mid' },
    preferredAttrs: ['passing', 'shooting', 'decisions', 'composure'],
  },
  {
    seat: 6,
    id: 'draft-ai-6',
    name: '疾风两翼走廊',
    coachTitle: '翼卫齐飞 · 3-5-2',
    color: '#884fd1',
    formationId: '3-5-2',
    tactics: { attack: 'wing', passing: 'mixed', tempo: 'fast', line: 'mid', press: 'high' },
    preferredAttrs: ['speed', 'dribbling', 'endurance', 'shooting'],
  },
  {
    seat: 7,
    id: 'draft-ai-7',
    name: '翡翠战术工坊',
    coachTitle: '稳守调度 · 4-1-4-1',
    color: '#1b998b',
    formationId: '4-1-4-1',
    tactics: { attack: 'balanced', passing: 'mixed', tempo: 'normal', line: 'mid', press: 'mid' },
    preferredAttrs: ['tackling', 'anticipation', 'passing', 'teamwork'],
  },
]

// Balanced 12-card pack composition: 2 GK, 3 CB, 2 W, 3 CM, 2 ST => guarantees ample GKs & all lines!
const PACK_DETAILED_SLOTS: readonly DetailedPosition[] = [
  'GK',
  'GK',
  'DC',
  'DC',
  'DR',
  'DL',
  'AMR',
  'AML',
  'DM',
  'MC',
  'AMC',
  'ST',
]

const POSITION_KEY_ATTRS: Record<Position, readonly AttrKey[]> = {
  GK: ['reflexes', 'handling', 'oneOnOne', 'rushing', 'composure', 'defPos'],
  CB: ['tackling', 'strength', 'heading', 'defPos', 'anticipation', 'speed'],
  W: ['speed', 'acceleration', 'dribbling', 'passing', 'endurance', 'agility'],
  CM: ['passing', 'vision', 'decisions', 'dribbling', 'tackling', 'teamwork'],
  ST: ['shooting', 'offBall', 'acceleration', 'composure', 'dribbling', 'heading'],
}

const POSITION_SKILLS: Record<Position, readonly SkillId[]> = {
  GK: ['gk_reflexes', 'gk_safe_hands', 'gk_close_down', 'gk_high_ball', 'gk_sweeper', 'gk_long_kick'],
  CB: ['sweeper', 'aerial', 'cb_intercept', 'cb_block', 'cb_cover', 'iron_lung'],
  W: ['wing_runner', 'wing_cross', 'wing_support', 'wing_track_back', 'one_touch', 'iron_lung'],
  CM: ['through_ball', 'safe_pass', 'one_touch', 'cm_long_pass', 'cm_shield', 'long_shot'],
  ST: ['box_hunter', 'st_breakaway', 'long_shot', 'aerial', 'penalty_specialist', 'weak_foot'],
}

export type DraftRarity = 'silver' | 'gold' | 'rainbow'

export interface DraftSeatTeam {
  seat: number
  id: string
  name: string
  coachTitle: string
  color: string
  isPlayer: boolean
  players: Player[]
  lineup: Lineup
}

export interface DraftSwissFixture {
  id: string
  round: number
  homeId: string
  awayId: string
  played: boolean
  score?: { home: number; away: number }
  matchRecordId?: string
  scorers?: { name: string; goals: number; teamId: string }[]
}

export interface DraftStandingRow {
  teamId: string
  name: string
  isPlayer: boolean
  played: number
  won: number
  drawn: number
  lost: number
  gf: number
  ga: number
  gd: number
  points: number
  buchholz: number
  rank: number
}

export interface DraftCupState {
  version: 1
  seasonIndex: number
  seed: number
  themeId: DraftPoolThemeId
  phase: 'drafting' | 'swiss' | 'finished'
  /** Current pack round: 1 or 2. */
  packRound: number
  /** Current pick within pack: 1..10. */
  pickInPack: number
  /** Active packs currently at each of the 8 seats (seat 0 is always the human player). */
  seatPacks: Player[][]
  /** Pre-seeded Round 2 packs (opened when packRound advances from 1 to 2). */
  round2Packs: Player[][]
  seats: DraftSeatTeam[]
  swissRound: number
  fixtures: DraftSwissFixture[]
  rewardClaimed?: boolean
  bestRank?: number
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Generate a fully trained matured card with exact CA inside [800, 1400] and 4–5 tiered skills. */
export function buildMaturedDraftPlayer(options: {
  seed: number
  detailedPosition: DetailedPosition
  targetCa: number
  theme: DraftPoolTheme
  usedNames: Set<string>
  idPrefix: string
}): Player {
  const { seed, detailedPosition, theme, usedNames, idPrefix } = options
  const rng = derivedRng(seed, 'draft-card-v1')
  const pos = DETAILED_TO_POSITION[detailedPosition]
  const isGk = pos === 'GK'
  const targetCa = clamp(options.targetCa, 800, 1400)
  const player = createRandomPlayer({
    seed: rng.int(0x7fffffff),
    position: pos,
    detailedPosition,
    tier: 4,
    usedNames,
    idPrefix,
  })

  // Shape specialized high-tier attribute profile then binary-search exact targetCa in [800, 1400]
  const focusSet = new Set<AttrKey>(POSITION_KEY_ATTRS[pos])
  const baseRatings: Record<AttrKey, number> = {} as Record<AttrKey, number>
  for (const key of ALL_ATTRIBUTES) {
    if (!isGk && ['reflexes', 'handling', 'rushing', 'oneOnOne'].includes(key)) {
      baseRatings[key] = 0
      continue
    }
    const isFocus = focusSet.has(key)
    const spec = isFocus ? theme.specialistBoost : 2 - theme.specialistBoost * 0.65
    baseRatings[key] = (isFocus ? 78 + rng.float() * 24 : 58 + rng.float() * 22) * spec
  }

  const buildAtScale = (k: number): Attributes => {
    const out = {} as Attributes
    for (const key of ALL_ATTRIBUTES) {
      const limit = attrHardLimit(key, isGk)
      if (limit <= 0) {
        out[key] = 0
        continue
      }
      const raw = attrStorage(key, baseRatings[key] * k, isGk)
      out[key] = isMainAttr(key, isGk) ? Math.min(limit, Math.round(raw)) : Math.min(limit, Math.round(raw * 10) / 10)
    }
    return out
  }

  let lo = 0.45
  let hi = 2.1
  for (let i = 0; i < 42; i++) {
    const mid = (lo + hi) / 2
    if (caOf(buildAtScale(mid), isGk) <= targetCa) lo = mid
    else hi = mid
  }
  player.attrs = buildAtScale(lo)
  player.baseAttrs = { ...player.attrs }
  player.ceilings = Object.fromEntries(
    ALL_ATTRIBUTES.map((key) => [key, Math.max(player.attrs[key], attrHardLimit(key, isGk))]),
  ) as Attributes
  player.pa = 2000
  player.version = targetCa >= 1260 ? 3 : targetCa >= 1060 ? 2 : 1
  player.age = theme.ageRange[0] + rng.int(theme.ageRange[1] - theme.ageRange[0] + 1)
  player.number = pos === 'GK' ? (rng.chance(0.5) ? 1 : 23) : 2 + rng.int(29)
  player.condition = 100

  // Ensure crisp playability across natural & secondary positions
  player.positions[pos] = 100
  if (pos === 'W') {
    player.detailedPositions = {
      ...player.detailedPositions,
      [detailedPosition]: 100,
      DL: Math.max(85, player.detailedPositions?.DL ?? 0),
      DR: Math.max(85, player.detailedPositions?.DR ?? 0),
      AML: Math.max(85, player.detailedPositions?.AML ?? 0),
      AMR: Math.max(85, player.detailedPositions?.AMR ?? 0),
    }
  } else if (pos === 'CM') {
    player.detailedPositions = {
      ...player.detailedPositions,
      [detailedPosition]: 100,
      DM: Math.max(85, player.detailedPositions?.DM ?? 0),
      MC: Math.max(88, player.detailedPositions?.MC ?? 0),
      AMC: Math.max(85, player.detailedPositions?.AMC ?? 0),
    }
  } else {
    player.detailedPositions = { ...player.detailedPositions, [detailedPosition]: 100 }
  }
  player.basePositions = { ...player.positions }
  player.baseDetailedPositions = { ...player.detailedPositions }

  // Assign 4 main skills + 1 auxiliary skill (up to 5 trained skills!) with rarity tiers matching CA
  const pool = [...POSITION_SKILLS[pos]]
  const chosenMain: SkillId[] = []
  const mainCount = targetCa >= 1220 ? 4 : targetCa >= 980 ? 3 : 2
  while (chosenMain.length < mainCount && pool.length > 0) {
    const idx = rng.int(pool.length)
    chosenMain.push(pool.splice(idx, 1)[0])
  }
  const skills: SkillId[] = [...chosenMain]
  if (targetCa >= 1120) skills.push('injury_prevention')
  const tier: SkillTier = targetCa >= 1260 ? 'rainbow' : targetCa >= 1040 ? 'gold' : 'silver'
  const skillTiers: Partial<Record<SkillId, SkillTier>> = {}
  for (const sk of skills) {
    skillTiers[sk] = sk === chosenMain[0] ? tier : tier === 'rainbow' && rng.chance(0.5) ? 'gold' : tier
  }
  player.skills = skills
  player.skillTiers = skillTiers

  return player
}

export function draftCardRarity(ca: number): DraftRarity {
  return ca >= 1260 ? 'rainbow' : ca >= 1040 ? 'gold' : 'silver'
}

function generateBoosterPacks(
  seed: number,
  packRound: number,
  theme: DraftPoolTheme,
  usedNames: Set<string>,
): Player[][] {
  const rng = derivedRng(seed, 'draft-packs-v1', packRound)
  const packs: Player[][] = []
  for (let seat = 0; seat < DRAFT_POD_SIZE; seat++) {
    const slots = [...PACK_DETAILED_SLOTS]
    // Shuffle slot order per pack while keeping balanced position counts
    for (let i = slots.length - 1; i > 0; i--) {
      const j = rng.int(i + 1)
      ;[slots[i], slots[j]] = [slots[j], slots[i]]
    }
    const cards: Player[] = slots.map((detailedPosition, idx) => {
      let targetCa: number
      if (idx === 0 && packRound === 1 && theme.acePackOne) {
        targetCa = 1320 + rng.float() * 78 // Guaranteed 1320..1398 CA Ace cornerstone!
      } else if (idx === 0) {
        targetCa = 1260 + rng.float() * 135 // 1 Rainbow star per pack (1260..1395)
      } else if (idx <= 3) {
        targetCa = 1080 + rng.float() * 175 // 3 Gold cores (1080..1255)
      } else if (idx <= 7) {
        targetCa = 930 + rng.float() * 145 // 4 Solid starters (930..1075)
      } else {
        targetCa = 805 + rng.float() * 125 // 4 Squad depth cards (805..930)
      }
      return buildMaturedDraftPlayer({
        seed: splitSeed(seed, `p${packRound}-s${seat}-c${idx}`),
        detailedPosition,
        targetCa,
        theme,
        usedNames,
        idPrefix: `draft-r${packRound}s${seat}c${idx}`,
      })
    })
    // Sort pack highest CA first so opening a pack immediately showcases the headline stars
    cards.sort((a, b) => caOf(b.attrs, b.positions.GK > 0) - caOf(a.attrs, a.positions.GK > 0))
    packs.push(cards)
  }
  return packs
}

function emptyLineup(formationId: FormationId = '4-3-3'): Lineup {
  return {
    formationId,
    starters: [],
    bench: [],
    tactics: { ...FORMATIONS[formationId].defaultTactics },
  }
}

export function createDraftCupRun(game: GameState): DraftCupState {
  const seasonIndex = game.season.index
  const seed = splitSeed(game.seed, `draft-cup-s${seasonIndex}-${Date.now() & 0xffff}`)
  const theme = draftThemeForSeason(seasonIndex)
  const usedNames = new Set<string>()
  const seatPacks = generateBoosterPacks(seed, 1, theme, usedNames)
  const round2Packs = generateBoosterPacks(seed, 2, theme, usedNames)

  const seats: DraftSeatTeam[] = [
    {
      seat: 0,
      id: 'player',
      name: `${game.clubName}（轮抽队）`,
      coachTitle: '你的轮抽战队',
      color: '#e04848',
      isPlayer: true,
      players: [],
      lineup: emptyLineup('4-3-3'),
    },
    ...DRAFT_AI_COACHES.map((ai) => ({
      seat: ai.seat,
      id: ai.id,
      name: ai.name,
      coachTitle: ai.coachTitle,
      color: ai.color,
      isPlayer: false,
      players: [],
      lineup: {
        formationId: ai.formationId,
        starters: [],
        bench: [],
        tactics: { ...ai.tactics },
      },
    })),
  ]

  return {
    version: 1,
    seasonIndex,
    seed,
    themeId: theme.id,
    phase: 'drafting',
    packRound: 1,
    pickInPack: 1,
    seatPacks,
    round2Packs,
    seats,
    swissRound: 0,
    fixtures: [],
  }
}

const POSITION_QUOTA: Record<Position, number> = {
  GK: 2,
  CB: 4,
  W: 5,
  CM: 5,
  ST: 4,
}

export function squadPositionCounts(players: readonly Player[]): Record<Position, number> {
  const counts: Record<Position, number> = { GK: 0, CB: 0, W: 0, CM: 0, ST: 0 }
  for (const p of players) {
    const primary = (Object.keys(p.positions) as Position[]).sort((a, b) => p.positions[b] - p.positions[a])[0]
    counts[primary]++
  }
  return counts
}

function aiPickCardIndex(seat: DraftSeatTeam, pack: readonly Player[], aiProfile: DraftAIProfile): number {
  const counts = squadPositionCounts(seat.players)
  const picksLeft = DRAFT_SQUAD_TARGET - seat.players.length
  let bestIdx = 0
  let bestScore = -Infinity

  for (let i = 0; i < pack.length; i++) {
    const card = pack[i]
    const isGk = card.positions.GK > 0
    const primary: Position = isGk
      ? 'GK'
      : (['CB', 'W', 'CM', 'ST'] as Position[]).sort((a, b) => card.positions[b] - card.positions[a])[0]
    const ca = caOf(card.attrs, isGk)
    let needBonus = 0
    if (primary === 'GK') {
      if (counts.GK === 0) needBonus = picksLeft <= 5 ? 900 : 210
      else if (counts.GK === 1) needBonus = 45
      else needBonus = -320
    } else {
      const have = counts[primary]
      const target = POSITION_QUOTA[primary]
      if (have < target) needBonus = (target - have) * 48
      else needBonus = -(have - target + 1) * 55
    }
    let styleFit = 0
    for (const key of aiProfile.preferredAttrs) {
      const v = card.attrs[key]
      styleFit += isMainAttr(key, isGk) ? v / 15 : v * 5
    }
    const score = ca + needBonus + styleFit * 0.22
    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  }
  return bestIdx
}

/** Ensure every 20-player drafted squad has at least 1 playable GK and a 100% valid 11-starter lineup. */
function finalizeDraftedSquads(state: DraftCupState): void {
  for (const seat of state.seats) {
    if (!seat.players.some((p) => p.positions.GK >= 80) && seat.players.length > 0) {
      // Emergency safeguard if human intentionally skipped every single GK across 20 picks:
      // convert their 20th pick into an emergency 900 CA goalkeeper so lineup validation never bricks.
      const fallback = buildMaturedDraftPlayer({
        seed: splitSeed(state.seed, `emergency-gk-${seat.id}`),
        detailedPosition: 'GK',
        targetCa: 920,
        theme: DRAFT_POOL_THEMES[state.themeId],
        usedNames: new Set(seat.players.map((p) => p.name)),
        idPrefix: `draft-gk-${seat.seat}`,
      })
      seat.players[seat.players.length - 1] = fallback
    }
    seat.lineup = autoFillLineup(seat.players, seat.lineup.formationId, seat.lineup.tactics)
  }
}

export function computeDraftStandings(state: DraftCupState): DraftStandingRow[] {
  const map = new Map<string, DraftStandingRow>()
  for (const s of state.seats) {
    map.set(s.id, {
      teamId: s.id,
      name: s.name,
      isPlayer: s.isPlayer,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      gf: 0,
      ga: 0,
      gd: 0,
      points: 0,
      buchholz: 0,
      rank: 1,
    })
  }
  const opponents = new Map<string, string[]>()
  for (const f of state.fixtures) {
    if (!f.played || !f.score) continue
    const h = map.get(f.homeId)!
    const a = map.get(f.awayId)!
    h.played++
    a.played++
    h.gf += f.score.home
    h.ga += f.score.away
    a.gf += f.score.away
    a.ga += f.score.home
    if (f.score.home > f.score.away) {
      h.won++
      h.points += 3
      a.lost++
    } else if (f.score.home < f.score.away) {
      a.won++
      a.points += 3
      h.lost++
    } else {
      h.drawn++
      a.drawn++
      h.points += 1
      a.points += 1
    }
    opponents.set(f.homeId, [...(opponents.get(f.homeId) ?? []), f.awayId])
    opponents.set(f.awayId, [...(opponents.get(f.awayId) ?? []), f.homeId])
  }
  for (const row of map.values()) {
    row.gd = row.gf - row.ga
    row.buchholz = (opponents.get(row.teamId) ?? []).reduce((sum, oppId) => sum + (map.get(oppId)?.points ?? 0), 0)
  }
  const rows = [...map.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.buchholz - a.buchholz ||
      b.gd - a.gd ||
      b.gf - a.gf ||
      (a.isPlayer ? -1 : b.isPlayer ? 1 : a.teamId.localeCompare(b.teamId)),
  )
  rows.forEach((r, idx) => {
    r.rank = idx + 1
  })
  return rows
}

/** Pair the next Swiss round by standings without repeat rematches (backtracking exact 8-team matching). */
export function pairNextSwissRound(state: DraftCupState): void {
  const nextRound = state.swissRound + 1
  if (nextRound > DRAFT_SWISS_ROUNDS) {
    state.phase = 'finished'
    return
  }
  const playedPairs = new Set<string>()
  for (const f of state.fixtures) {
    playedPairs.add(`${f.homeId}|${f.awayId}`)
    playedPairs.add(`${f.awayId}|${f.homeId}`)
  }
  const ordered =
    nextRound === 1
      ? state.seats.map((s) => s.id)
      : computeDraftStandings(state).map((r) => r.teamId)

  const pairs: [string, string][] = []
  const used = new Set<string>()
  function backtrack(allowRematch: boolean): boolean {
    if (pairs.length * 2 === ordered.length) return true
    const first = ordered.find((id) => !used.has(id))!
    used.add(first)
    for (const second of ordered) {
      if (used.has(second)) continue
      if (!allowRematch && playedPairs.has(`${first}|${second}`)) continue
      used.add(second)
      pairs.push([first, second])
      if (backtrack(allowRematch)) return true
      pairs.pop()
      used.delete(second)
    }
    used.delete(first)
    return false
  }
  if (!backtrack(false)) backtrack(true)

  state.swissRound = nextRound
  pairs.forEach(([a, b], idx) => {
    // Keep player as home on odd rounds, away or balanced on even rounds, or standardize home when player is `a`
    const homeId = b === 'player' && nextRound % 2 === 1 ? b : a
    const awayId = homeId === a ? b : a
    state.fixtures.push({
      id: `swiss-r${nextRound}-m${idx + 1}`,
      round: nextRound,
      homeId,
      awayId,
      played: false,
    })
  })
}

/** Human picks 1 card from seatPacks[0]; all 7 AIs simultaneously pick 1 from their pack, then packs pass around the pod! */
export function pickDraftCard(
  state: DraftCupState,
  cardId: string,
): { ok: boolean; error?: string } {
  if (state.phase !== 'drafting') return { ok: false, error: '当前不在轮抽阶段' }
  const playerPack = state.seatPacks[0]
  const cardIdx = playerPack.findIndex((p) => p.id === cardId)
  if (cardIdx < 0) return { ok: false, error: '该球员不在当前卡包中' }

  // Guard last pick if player still has 0 goalkeepers and a GK is right here in the pack
  const playerSeat = state.seats[0]
  const totalPickedAfter = playerSeat.players.length + 1
  const hasGk = playerSeat.players.some((p) => p.positions.GK >= 80)
  if (!hasGk && totalPickedAfter === DRAFT_SQUAD_TARGET && playerPack[cardIdx].positions.GK === 0) {
    const gkInPack = playerPack.find((p) => p.positions.GK >= 80)
    if (gkInPack) {
      return { ok: false, error: `阵容至少需要 1 名门将！最后一抓请先选择包内的门将「${gkInPack.name}」` }
    }
  }

  // Seat 0 (player) takes chosen card
  const [picked] = playerPack.splice(cardIdx, 1)
  playerSeat.players.push(picked)

  // Seats 1..7 (7 AI coaches) each pick 1 card from their current pack
  for (let s = 1; s < DRAFT_POD_SIZE; s++) {
    const pack = state.seatPacks[s]
    const aiSeat = state.seats[s]
    const aiProfile = DRAFT_AI_COACHES[s - 1]
    const idx = aiPickCardIndex(aiSeat, pack, aiProfile)
    const [aiCard] = pack.splice(idx, 1)
    aiSeat.players.push(aiCard)
  }

  // Advance pick or pass packs!
  if (state.pickInPack < DRAFT_PICKS_PER_PACK) {
    state.pickInPack++
    // Round 1 passes left (seat i passes remaining 11.. cards to seat (i+1)%8, so seat 0 receives from seat 7);
    // Round 2 passes right (seat i passes to (i+7)%8, so seat 0 receives from seat 1).
    const nextPacks: Player[][] = Array.from({ length: DRAFT_POD_SIZE }, () => [])
    for (let s = 0; s < DRAFT_POD_SIZE; s++) {
      const targetSeat = state.packRound % 2 === 1 ? (s + 1) % DRAFT_POD_SIZE : (s + DRAFT_POD_SIZE - 1) % DRAFT_POD_SIZE
      nextPacks[targetSeat] = state.seatPacks[s]
    }
    state.seatPacks = nextPacks
  } else if (state.packRound < DRAFT_PACK_ROUNDS) {
    // Discard last 2 leftover cards of Pack 1 and crack open Pack 2!
    state.packRound = 2
    state.pickInPack = 1
    state.seatPacks = state.round2Packs
    state.round2Packs = []
  } else {
    // All 8 teams now have 20 matured cards! Auto-fill initial lineups and pair Swiss Round 1!
    state.seatPacks = []
    finalizeDraftedSquads(state)
    state.phase = 'swiss'
    pairNextSwissRound(state)
  }

  return { ok: true }
}

export function updateDraftPlayerLineup(
  state: DraftCupState,
  options: {
    formationId?: ElevenFormationId
    mentality?: MatchMentality
    autoBest?: boolean
    swapPlayerIds?: [string, string]
  },
): { ok: boolean; error?: string } {
  if (state.phase === 'drafting') return { ok: false, error: '请先完成 20 人轮抽' }
  const playerSeat = state.seats[0]
  if (options.formationId && FORMATIONS[options.formationId]) {
    playerSeat.lineup = autoFillLineup(playerSeat.players, options.formationId, playerSeat.lineup.tactics, playerSeat.lineup)
  }
  if (options.mentality) {
    playerSeat.lineup.tactics = {
      ...playerSeat.lineup.tactics,
      attack: options.mentality === 'attack' ? 'wing' : options.mentality === 'defend' ? 'balanced' : 'middle',
      line: options.mentality === 'attack' ? 'high' : options.mentality === 'defend' ? 'low' : 'mid',
      press: options.mentality === 'attack' ? 'high' : options.mentality === 'defend' ? 'low' : 'mid',
    }
  }
  if (options.autoBest) {
    playerSeat.lineup = autoFillLineup(playerSeat.players, playerSeat.lineup.formationId, playerSeat.lineup.tactics)
  }
  if (options.swapPlayerIds) {
    const [aId, bId] = options.swapPlayerIds
    const sA = playerSeat.lineup.starters.find((s) => s.playerId === aId)
    const sB = playerSeat.lineup.starters.find((s) => s.playerId === bId)
    const bIdxA = playerSeat.lineup.bench.indexOf(aId)
    const bIdxB = playerSeat.lineup.bench.indexOf(bId)
    const copy = structuredClone(playerSeat.lineup)
    if (sA && sB) {
      const tmp = sA.playerId
      copy.starters.find((s) => s.slotId === sA.slotId)!.playerId = sB.playerId
      copy.starters.find((s) => s.slotId === sB.slotId)!.playerId = tmp
    } else if (sA && bIdxB >= 0) {
      copy.starters.find((s) => s.slotId === sA.slotId)!.playerId = bId
      copy.bench[bIdxB] = aId
    } else if (sB && bIdxA >= 0) {
      copy.starters.find((s) => s.slotId === sB.slotId)!.playerId = aId
      copy.bench[bIdxA] = bId
    } else if (sA) {
      // Swap starter with reserve player (19th/20th man outside 7-man bench)
      copy.starters.find((s) => s.slotId === sA.slotId)!.playerId = bId
    } else if (sB) {
      copy.starters.find((s) => s.slotId === sB.slotId)!.playerId = aId
    }
    if (validateLineup(playerSeat.players, copy).valid) {
      playerSeat.lineup = copy
    } else {
      return { ok: false, error: '门将与外场球员不能互换门将槽位' }
    }
  }
  return { ok: true }
}

function applyPostMatchCondition(seat: DraftSeatTeam, keepFatigue: boolean): void {
  for (const p of seat.players) {
    if (!keepFatigue) {
      p.condition = 100
    } else {
      const isStarter = seat.lineup.starters.some((s) => s.playerId === p.id)
      p.condition = clamp(Math.round((p.condition ?? 100) + (isStarter ? -14 : 18)), 58, 100)
    }
  }
  if (keepFatigue && !seat.isPlayer) {
    seat.lineup = autoFillLineup(seat.players, seat.lineup.formationId, seat.lineup.tactics)
  }
}

function simulateSingleDraftFixture(
  state: DraftCupState,
  fixture: DraftSwissFixture,
  game: GameState,
): void {
  const homeSeat = state.seats.find((s) => s.id === fixture.homeId)!
  const awaySeat = state.seats.find((s) => s.id === fixture.awayId)!
  const matchSeed = splitSeed(state.seed, `swiss-${fixture.id}`)
  const homeInput = teamInputFromLineup(homeSeat.players, homeSeat.lineup, {
    id: homeSeat.id,
    name: homeSeat.name,
    color: homeSeat.color,
    accent: '#f4f7fb',
  })
  const awayInput = teamInputFromLineup(awaySeat.players, awaySeat.lineup, {
    id: awaySeat.id,
    name: awaySeat.name,
    color: awaySeat.color,
    accent: '#f4f7fb',
  })
  const isPlayerMatch = homeSeat.isPlayer || awaySeat.isPlayer
  const engine = new MatchEngine({
    seed: matchSeed,
    home: homeInput,
    away: awayInput,
    knockout: false,
    durationSeconds: LOGIC_MATCH_SECONDS,
    offside: true,
    recordPlayback: isPlayerMatch,
    rulesVersion: isPlayerMatch ? 3 : 2,
  })
  const serialized = engine.simulate()
  fixture.played = true
  fixture.score = { ...serialized.score }
  const tally = fixtureScorers(serialized)
  fixture.scorers = tally.scorers.slice(0, 4).map((s) => ({ name: s.name, goals: s.goals, teamId: s.teamId }))

  if (isPlayerMatch) {
    const context = {
      isLeague: false,
      mode: 'friendly' as const,
      cupId: 'season-event-draft',
      cupFixtureId: fixture.id,
      round: fixture.round,
      knockout: false,
      allowDraw: true,
      noInjuries: true,
      recordKey: `draft-${state.seasonIndex}-${fixture.id}`,
      opponentId: homeSeat.isPlayer ? awaySeat.id : homeSeat.id,
      opponentName: homeSeat.isPlayer ? awaySeat.name : homeSeat.name,
      seed: matchSeed,
      homeAway: (homeSeat.isPlayer ? 'home' : 'away') as 'home' | 'away',
      durationSeconds: LOGIC_MATCH_SECONDS,
      offside: true,
    }
    const record = createMatchRecord({ season: game.season, lineup: state.seats[0].lineup }, serialized, context)
    game.challengeHistory.unshift(record)
    fixture.matchRecordId = record.id
  }

  const keepFatigue = DRAFT_POOL_THEMES[state.themeId].keepFatigue
  applyPostMatchCondition(homeSeat, keepFatigue)
  applyPostMatchCondition(awaySeat, keepFatigue)
}

/** Instantly simulate the entire current Swiss round (all 4 matches, including 2D replay record for player's match). */
export function simulateCurrentSwissRound(game: GameState, state: DraftCupState): { ok: boolean; error?: string } {
  if (state.phase !== 'swiss') return { ok: false, error: '当前不在瑞士轮比赛阶段' }
  const roundFixtures = state.fixtures.filter((f) => f.round === state.swissRound && !f.played)
  if (!roundFixtures.length) return { ok: false, error: '本轮比赛已全部结束' }
  for (const f of roundFixtures) simulateSingleDraftFixture(state, f, game)
  if (state.swissRound >= DRAFT_SWISS_ROUNDS) {
    state.phase = 'finished'
    const rank = computeDraftStandings(state).find((r) => r.isPlayer)?.rank ?? 8
    state.bestRank = state.bestRank ? Math.min(state.bestRank, rank) : rank
  } else {
    pairNextSwissRound(state)
  }
  return { ok: true }
}

/** Start the player's current Swiss match on the live 2D pitch (with live tactics, subs, and FM27 shouts!). */
export function startLiveSwissMatch(game: GameState, state: DraftCupState, now = Date.now()): { ok: boolean; error?: string } {
  if (game.activeMatch) return { ok: false, error: '已有进行中的比赛，请先完成当前比赛' }
  if (state.phase !== 'swiss') return { ok: false, error: '当前不在瑞士轮比赛阶段' }
  const playerFixture = state.fixtures.find(
    (f) => f.round === state.swissRound && !f.played && (f.homeId === 'player' || f.awayId === 'player'),
  )
  if (!playerFixture) return { ok: false, error: '本轮没有未进行的轮抽比赛' }

  const homeSeat = state.seats.find((s) => s.id === playerFixture.homeId)!
  const awaySeat = state.seats.find((s) => s.id === playerFixture.awayId)!
  const matchSeed = splitSeed(state.seed, `swiss-${playerFixture.id}`)
  const homeInput = teamInputFromLineup(homeSeat.players, homeSeat.lineup, {
    id: homeSeat.id,
    name: homeSeat.name,
    color: homeSeat.color,
    accent: '#f4f7fb',
  })
  const awayInput = teamInputFromLineup(awaySeat.players, awaySeat.lineup, {
    id: awaySeat.id,
    name: awaySeat.name,
    color: awaySeat.color,
    accent: '#f4f7fb',
  })

  const engine = new PesEngine({
    seed: matchSeed,
    home: homeInput,
    away: awayInput,
    knockout: false,
    durationSeconds: LOGIC_MATCH_SECONDS,
    offside: true,
  })

  const playerIsHome = homeSeat.isPlayer
  const oppSeat = playerIsHome ? awaySeat : homeSeat
  game.activeMatch = {
    context: {
      isLeague: false,
      mode: 'friendly',
      cupId: 'season-event-draft',
      cupFixtureId: playerFixture.id,
      round: playerFixture.round,
      knockout: false,
      allowDraw: true,
      noInjuries: true,
      recordKey: `draft-${state.seasonIndex}-${playerFixture.id}`,
      opponentId: oppSeat.id,
      opponentName: oppSeat.name,
      seed: matchSeed,
      homeAway: playerIsHome ? 'home' : 'away',
      durationSeconds: LOGIC_MATCH_SECONDS,
      offside: true,
    },
    engineState: engine.serialize(),
    instructions: [],
    lineup: structuredClone(state.seats[0].lineup),
    startedAt: now,
    coachPausesLeft: 3,
  }
  return { ok: true }
}

/** Settle the Swiss round when a live 2D draft match finishes. */
export function settleCompletedLiveSwissMatch(
  game: GameState,
  state: DraftCupState,
  recordId: string,
  fixtureId: string,
  score: { home: number; away: number },
  scorers: { name: string; goals: number; teamId: string }[],
): void {
  const playerFixture = state.fixtures.find((f) => f.id === fixtureId)
  if (!playerFixture || playerFixture.played) return
  playerFixture.played = true
  playerFixture.score = { ...score }
  playerFixture.matchRecordId = recordId
  playerFixture.scorers = scorers.slice(0, 4)

  const keepFatigue = DRAFT_POOL_THEMES[state.themeId].keepFatigue
  const homeSeat = state.seats.find((s) => s.id === playerFixture.homeId)!
  const awaySeat = state.seats.find((s) => s.id === playerFixture.awayId)!
  applyPostMatchCondition(homeSeat, keepFatigue)
  applyPostMatchCondition(awaySeat, keepFatigue)

  // Settle the remaining 3 AI-vs-AI Swiss matches in the same round
  for (const other of state.fixtures.filter((f) => f.round === state.swissRound && !f.played)) {
    simulateSingleDraftFixture(state, other, game)
  }

  if (state.swissRound >= DRAFT_SWISS_ROUNDS) {
    state.phase = 'finished'
    const rank = computeDraftStandings(state).find((r) => r.isPlayer)?.rank ?? 8
    state.bestRank = state.bestRank ? Math.min(state.bestRank, rank) : rank
  } else {
    pairNextSwissRound(state)
  }
}
