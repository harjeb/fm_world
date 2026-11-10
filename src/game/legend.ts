import type { AITeam, AttrKey, Attributes, Foot, Player, Position, PositionTable, StyleId } from './types.ts'
import { ALL_ATTRIBUTES, GK_ATTRIBUTES, POSITIONS } from './types.ts'
import { caOf } from './ca.ts'
import { attrRating, attrStorage } from './scale.ts'
import { FORMATIONS } from './data/formations.ts'
import { LEGEND_TEAMS, type LegendPlayerTuple, type LegendTeamDef } from './data/legend-teams.ts'
import { bestRoleForPlayer, validateLineup } from './squad.ts'
import { curatedProfileFor } from './data/profiles-curated.ts'
import { fmProfileFor } from './data/fm-profiles.generated.ts'
import { styleSkillFor, styleTraitFor, styleWeightsFor } from './data/players.ts'
import { frozenPveTeam } from './pve-content.ts'
import { startingCa } from './pve-strength.ts'

/**
 * 历史/生成队的编译器：7 项主属性按 avg 展开，隐藏属性参考 FM/手工画像。
 * 仅在离线生成快照或测试时使用；运行时读取已提交的完整属性快照。
 *
 * 冻结快照时再按 tier 校准首发 CA，保证 S+ > S > A > B；
 * `avg` 仍是生成形状的目标，而最终 CA 以快照为准。
 */

/** 冻结传奇队时使用的首发 CA 档位；区间不重叠，确保档位与实战难度一致。 */
export const LEGEND_TIER_CA: Record<LegendTeamDef['tier'], readonly [number, number]> = {
  'S+': [1150, 1180],
  S: [1100, 1149],
  A: [1040, 1099],
  B: [960, 1039],
}

/**
 * 按当前构建强度在档位内排序并均匀分配目标 CA。
 * 最高档上限 1180、最低档下限 960；同档内强队仍然更强。
 */
export function legendTierTargets(): Map<string, number> {
  const targets = new Map<string, number>()
  for (const tier of ['S+', 'S', 'A', 'B'] as const) {
    const defs = LEGEND_TEAMS.filter((def) => def.tier === tier)
    const [min, max] = LEGEND_TIER_CA[tier]
    const ranked = defs
      .map((def) => ({ def, ca: startingCa(buildHistoricTeam(def)) }))
      .sort((a, b) => b.ca - a.ca)
    const step = ranked.length > 1 ? (max - min) / (ranked.length - 1) : 0
    ranked.forEach(({ def }, index) => {
      targets.set(def.id, Math.round(max - step * index))
    })
  }
  return targets
}

function hash(input: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function rngFrom(seed: string): () => number {
  let a = hash(seed)
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SECONDARY: Record<Position, Position[]> = {
  GK: [],
  CB: ['W', 'CM'],
  W: ['CB', 'ST', 'CM'],
  CM: ['W', 'CB', 'ST'],
  ST: ['W', 'CM'],
}

function weightsFor(tuple: LegendPlayerTuple, hidden = false): Record<AttrKey, number> {
  const style = tuple[4] as StyleId
  const isGk = tuple[3] === 'GK'
  const base = styleWeightsFor(style, isGk)
  const fm = hidden ? fmProfileFor(tuple[1]) : undefined
  const curated = curatedProfileFor(tuple[1])
  const legendMain = LEGEND_MAIN_STYLE[style]
  const out = {} as Record<AttrKey, number>
  for (const key of ALL_ATTRIBUTES) {
    const profile = fm?.[key] ?? curated?.[key]
    const fallback = legendMain[key] ?? base[key] ?? 0
    const blended = profile === undefined ? fallback : 0.7 * profile + 0.3 * fallback
    out[key] = Math.max(0, blended)
    if (!isGk && (GK_ATTRIBUTES as readonly string[]).includes(key)) out[key] = 0
  }
  return out
}

const MAIN_FIELD_KEYS: AttrKey[] = ['passing', 'shooting', 'dribbling', 'tackling', 'strength', 'speed', 'acceleration']
const MAIN_GK_KEYS: AttrKey[] = ['reflexes', 'handling', 'rushing', 'oneOnOne', 'passing', 'composure']

/** 传奇队的主属性基准：按打法和位置给出 7 项（门将 6 项）的强弱，避免画像只写少数项时其余项被当成 0.3。 */
const LEGEND_MAIN_STYLE: Record<StyleId, Partial<Record<AttrKey, number>>> = {
  gk_wall: { reflexes: 1, handling: 1, rushing: 0.8, oneOnOne: 0.9, passing: 0.55, composure: 0.85 },
  gk_shotstopper: { reflexes: 1, handling: 0.9, rushing: 0.75, oneOnOne: 0.95, passing: 0.55, composure: 0.8 },
  gk_sweeper: { reflexes: 0.9, handling: 0.8, rushing: 1, oneOnOne: 0.8, passing: 0.9, composure: 0.85 },
  cb_stopper: { passing: 0.6, shooting: 0.25, dribbling: 0.35, tackling: 1, strength: 0.95, speed: 0.65, acceleration: 0.6 },
  cb_cover: { passing: 0.7, shooting: 0.3, dribbling: 0.45, tackling: 0.9, strength: 0.8, speed: 0.85, acceleration: 0.8 },
  cb_ballplaying: { passing: 1, shooting: 0.4, dribbling: 0.6, tackling: 0.85, strength: 0.75, speed: 0.7, acceleration: 0.65 },
  fb_attacking: { passing: 0.75, shooting: 0.5, dribbling: 0.8, tackling: 0.7, strength: 0.55, speed: 1, acceleration: 0.95 },
  fb_playmaker: { passing: 1, shooting: 0.55, dribbling: 0.8, tackling: 0.7, strength: 0.55, speed: 0.85, acceleration: 0.8 },
  w_dribbler: { passing: 0.7, shooting: 0.9, dribbling: 1, tackling: 0.4, strength: 0.5, speed: 0.95, acceleration: 1 },
  w_crosser: { passing: 1, shooting: 0.7, dribbling: 0.75, tackling: 0.5, strength: 0.55, speed: 0.8, acceleration: 0.75 },
  w_finisher: { passing: 0.7, shooting: 1, dribbling: 0.9, tackling: 0.35, strength: 0.6, speed: 0.9, acceleration: 0.95 },
  w_playmaker: { passing: 1, shooting: 0.7, dribbling: 0.9, tackling: 0.5, strength: 0.5, speed: 0.8, acceleration: 0.75 },
  w_engine: { passing: 0.75, shooting: 0.6, dribbling: 0.7, tackling: 0.7, strength: 0.65, speed: 0.9, acceleration: 0.85 },
  cm_playmaker: { passing: 1, shooting: 0.75, dribbling: 0.85, tackling: 0.6, strength: 0.5, speed: 0.65, acceleration: 0.7 },
  cm_creator: { passing: 1, shooting: 0.75, dribbling: 0.9, tackling: 0.5, strength: 0.5, speed: 0.7, acceleration: 0.75 },
  cm_destroyer: { passing: 0.65, shooting: 0.4, dribbling: 0.5, tackling: 1, strength: 0.9, speed: 0.65, acceleration: 0.6 },
  cm_box2box: { passing: 0.8, shooting: 0.7, dribbling: 0.75, tackling: 0.8, strength: 0.75, speed: 0.85, acceleration: 0.8 },
  cm_mezzala: { passing: 0.9, shooting: 0.8, dribbling: 0.9, tackling: 0.55, strength: 0.55, speed: 0.8, acceleration: 0.8 },
  cm_engine: { passing: 0.8, shooting: 0.55, dribbling: 0.7, tackling: 0.85, strength: 0.8, speed: 0.85, acceleration: 0.8 },
  st_finisher: { passing: 0.6, shooting: 1, dribbling: 0.8, tackling: 0.25, strength: 0.7, speed: 0.85, acceleration: 0.9 },
  st_poacher: { passing: 0.55, shooting: 1, dribbling: 0.75, tackling: 0.2, strength: 0.6, speed: 0.9, acceleration: 0.95 },
  st_target: { passing: 0.65, shooting: 0.9, dribbling: 0.6, tackling: 0.35, strength: 1, speed: 0.6, acceleration: 0.55 },
  st_runner: { passing: 0.6, shooting: 0.9, dribbling: 0.75, tackling: 0.25, strength: 0.5, speed: 1, acceleration: 1 },
  st_false9: { passing: 0.9, shooting: 0.9, dribbling: 0.9, tackling: 0.35, strength: 0.5, speed: 0.75, acceleration: 0.8 },
}

function mainKeys(isGk: boolean): AttrKey[] {
  return isGk ? MAIN_GK_KEYS : MAIN_FIELD_KEYS
}

function hiddenKeys(isGk: boolean): AttrKey[] {
  const main = new Set(mainKeys(isGk))
  return ALL_ATTRIBUTES.filter((key) => !main.has(key) && (isGk || !(GK_ATTRIBUTES as readonly string[]).includes(key)))
}

/** 按画像把一组属性展开到指定平均分；强项推到 100，弱项可以落到底。 */
function ratingsFor(
  targetAvg: number,
  weights: Record<AttrKey, number>,
  keys: AttrKey[],
  spread: number,
  minRating: number,
): Partial<Record<AttrKey, number>> {
  const maxWeight = Math.max(0.0001, ...keys.map((key) => weights[key] ?? 0))
  const normalized = {} as Record<AttrKey, number>
  for (const key of keys) normalized[key] = Math.max(0, (weights[key] ?? 0) / maxWeight)
  const meanWeight = keys.reduce((sum, key) => sum + normalized[key], 0) / keys.length
  const build = (base: number): Partial<Record<AttrKey, number>> => {
    const out = {} as Partial<Record<AttrKey, number>>
    for (const key of keys) out[key] = Math.max(minRating, Math.min(100, base + spread * (normalized[key] - meanWeight)))
    return out
  }
  const meanOf = (ratings: Partial<Record<AttrKey, number>>): number =>
    keys.reduce((sum, key) => sum + (ratings[key] ?? 0), 0) / keys.length
  let lo = -40
  let hi = 140
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (meanOf(build(mid)) < targetAvg) lo = mid
    else hi = mid
  }
  const base = (lo + hi) / 2
  const candidates = Array.from({ length: 13 }, (_, step) => build(base - step * 0.1))
  let best = candidates[0]
  let bestDiff = Number.POSITIVE_INFINITY
  for (const ratings of candidates) {
    const diff = Math.abs(meanOf(ratings) - targetAvg)
    if (diff < bestDiff) {
      best = ratings
      bestDiff = diff
    }
  }
  return best
}

/**
 * 7 项主属性（门将 6 项）按目标平均展开，保留强弱形状；
 * 隐藏属性单独用更平的分布生成，不参与“平均属性 80–100”这个目标。
 */
function attributesFor(
  targetAvg: number,
  mainWeights: Record<AttrKey, number>,
  hiddenWeights: Record<AttrKey, number>,
  isGk: boolean,
): Attributes {
  const main = ratingsFor(targetAvg, mainWeights, mainKeys(isGk), 110, 40)
  const hidden = ratingsFor(Math.max(50, targetAvg - 2), hiddenWeights, hiddenKeys(isGk), 35, 40)
  const attrs = {} as Attributes
  for (const key of ALL_ATTRIBUTES) {
    if (!isGk && (GK_ATTRIBUTES as readonly string[]).includes(key)) {
      attrs[key] = 0
      continue
    }
    const rating = main[key] ?? hidden[key] ?? 60
    attrs[key] = Math.round(attrStorage(key, rating, isGk) * 10) / 10
  }
  return attrs
}

function positionsFor(pos: Position, random: () => number): PositionTable {
  const table = {} as PositionTable
  for (const other of POSITIONS) {
    if (pos === 'GK') {
      table[other] = other === 'GK' ? 92 : 0
      continue
    }
    if (other === 'GK') {
      table[other] = 0
      continue
    }
    if (other === pos) table[other] = 90 + Math.round(random() * 7)
    else if (SECONDARY[pos].includes(other)) table[other] = 60 + Math.round(random() * 14)
    else table[other] = 25 + Math.round(random() * 18)
  }
  return table
}

function eraOf(season: string): string {
  const year = Number(season.slice(0, 4))
  if (!Number.isFinite(year) || year < 1900) return 'classic'
  return `${Math.floor(year / 10) * 10}s`
}

function heightFor(pos: Position, random: () => number): number {
  const base = pos === 'GK' ? 188 : pos === 'CB' ? 186 : pos === 'W' ? 177 : pos === 'ST' ? 183 : 180
  return base + Math.round((random() * 2 - 1) * 5)
}

function buildPlayer(def: LegendTeamDef, tuple: LegendPlayerTuple, index: number): Player {
  const [name, enName, country, pos, style, targetAvg, foot] = tuple
  const isGk = pos === 'GK'
  const random = rngFrom(`${def.id}|${enName}|${index}`)
  const attrs = attributesFor(targetAvg, weightsFor(tuple), weightsFor(tuple, true), isGk)
  const positions = positionsFor(pos, random)
  const personality = {
    professionalism: 78 + Math.round(random() * 15),
    ambition: 80 + Math.round(random() * 14),
    adaptability: 74 + Math.round(random() * 18),
  }
  const signatureSkill = styleSkillFor(style)
  const actualCa = Math.round(caOf(attrs, isGk) * 10) / 10
  return {
    id: `legend-${def.id}-${String(index + 1).padStart(2, '0')}`,
    seedId: enName,
    name,
    enName,
    country,
    era: eraOf(def.season),
    number: def.playerInfo?.[enName]?.number ?? index + 1,
    foot: (foot ?? 'R') as Foot,
    height: def.season ? 0 : heightFor(pos, random),
    attrs,
    ceilings: { ...attrs },
    pa: actualCa,
    positions,
    personality,
    traitId: styleTraitFor(style),
    style,
    skills: [signatureSkill],
    skillTiers: { [signatureSkill]: 'rainbow' },
    signatureSkill,
    version: 0,
    condition: 100,
    energy: 100,
    age: def.season ? def.playerInfo?.[enName]?.age ?? undefined : 24 + Math.floor(random() * 6),
    baseAttrs: { ...attrs },
    basePositions: { ...positions },
    basePersonality: { ...personality },
  }
}

export function buildHistoricTeam(def: LegendTeamDef): AITeam {
  const players = def.players.map((tuple, index) => buildPlayer(def, tuple, index))
  if (players.length !== 16) throw new Error(`${def.id}: 需要 16 名球员，实际 ${players.length}`)
  const formation = FORMATIONS[def.formationId]
  const used = new Set<string>()
  const starters: { slotId: string; playerId: string; role: ReturnType<typeof bestRoleForPlayer>['role'] }[] = []
  for (const slot of formation.slots) {
    // 锁定前 11 人为首发，按位置分配；绝不能从替补池偷换首发。
    const pool = players.slice(0, 11).filter((player) => !used.has(player.id))
    const pick = pool.find((player) => player.positions[slot.position] >= 80)
    if (!pick) throw new Error(`${def.id}: 阵型 ${def.formationId} 缺少可用球员`)
    used.add(pick.id)
    starters.push({ slotId: slot.id, playerId: pick.id, role: bestRoleForPlayer(pick, slot.position, slot).role })
  }
  const bench = players.filter((player) => !used.has(player.id)).slice(0, 5).map((player) => player.id)
  const lineup = { formationId: def.formationId, starters, bench, tactics: { ...def.tactics } }
  const check = validateLineup(players, lineup)
  if (!check.valid) throw new Error(`${def.id}: 阵容不合法：${check.errors.join('；')}`)
  const ranked = [...players].sort((a, b) => caOf(b.attrs, b.positions.GK > 0) - caOf(a.attrs, a.positions.GK > 0))
  return {
    id: `legend-${def.id}`,
    name: def.season ? `${def.club} ${def.season}` : def.club,
    short: def.club.slice(0, 2),
    color: def.color,
    accent: def.accent,
    style: def.season ? `传奇 · ${def.tier}` : `生成 · ${def.tier}`,
    formationId: def.formationId,
    tactics: { ...def.tactics },
    strength: 5,
    playerNames: players.map((player) => player.name),
    lineup,
    players,
    starPlayerIds: ranked.slice(0, 3).map((player) => player.id),
    starCount: 3,
  }
}

const cache = new Map<string, AITeam>()

export function legendTeamById(id: string): AITeam | undefined {
  const cached = cache.get(id)
  if (cached) return structuredClone(cached)
  const def = LEGEND_TEAMS.find((team) => team.id === id)
  if (!def) return undefined
  const team = frozenPveTeam('legends', id)
  cache.set(id, team)
  return structuredClone(team)
}

export function allLegendTeams(): AITeam[] {
  return LEGEND_TEAMS.map((def) => legendTeamById(def.id)!)
}

export function legendTeamDefs(): LegendTeamDef[] {
  return LEGEND_TEAMS
}
