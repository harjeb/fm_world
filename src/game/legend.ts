import type { AITeam, AttrKey, Attributes, Foot, Player, Position, PositionTable, StyleId } from './types.ts'
import { ALL_ATTRIBUTES, GK_ATTRIBUTES, POSITIONS } from './types.ts'
import { caOf } from './ca.ts'
import { attrStorage } from './scale.ts'
import { FORMATIONS } from './data/formations.ts'
import { LEGEND_TEAMS, type LegendPlayerTuple, type LegendTeamDef } from './data/legend-teams.ts'
import { bestRoleForPlayer, validateLineup } from './squad.ts'
import { curatedProfileFor } from './data/profiles-curated.ts'
import { styleSkillFor, styleTraitFor, styleWeightsFor } from './data/players.ts'

/**
 * 传奇队构建：把 `legend-teams.ts` 里的 CA 目标展开成具体属性。
 *
 * CA 是 0–1500 制（1500 = 全部属性 100）。属性形状来自球员画像（手工画像 > 风格），
 * 再用一个统一的“地板值”缩放，使最终 `caOf` 对齐目标 CA。
 * 因此 1250–1450 的传奇队属性会集中在 90–100，这是 CA 公式决定的，不是数据错误。
 */

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

function weightsFor(tuple: LegendPlayerTuple): Record<AttrKey, number> {
  const style = tuple[4] as StyleId
  const isGk = tuple[3] === 'GK'
  const curated = curatedProfileFor(tuple[1])
  const base = styleWeightsFor(style, isGk)
  const out = {} as Record<AttrKey, number>
  for (const key of ALL_ATTRIBUTES) {
    out[key] = Math.max(0, (curated?.[key] ?? base[key] ?? 0) as number)
    if (!isGk && (GK_ATTRIBUTES as readonly string[]).includes(key)) out[key] = 0
  }
  return out
}

function attributesFor(targetCa: number, weights: Record<AttrKey, number>, isGk: boolean): Attributes {
  const maxWeight = Math.max(0.0001, ...ALL_ATTRIBUTES.map((key) => weights[key] ?? 0))
  const build = (floor: number): Attributes => {
    const attrs = {} as Attributes
    for (const key of ALL_ATTRIBUTES) {
      if (!isGk && (GK_ATTRIBUTES as readonly string[]).includes(key)) {
        attrs[key] = 0
        continue
      }
      const normalized = (weights[key] ?? 0) / maxWeight
      const rating = Math.max(1, Math.min(100, floor + (100 - floor) * normalized))
      attrs[key] = Math.round(attrStorage(key, rating, isGk) * 10) / 10
    }
    return attrs
  }
  let lo = 0
  let hi = 100
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (caOf(build(mid), isGk) < targetCa) lo = mid
    else hi = mid
  }
  // 隐藏属性按 0.5 评分取整，CA 会跳档：在二分点附近取「落在 1250–1450 且最接近目标」的一档。
  const base = (lo + hi) / 2
  const candidates = Array.from({ length: 13 }, (_, step) => build(Math.max(0, base - step * 0.1)))
  const inRange = candidates.filter((attrs) => {
    const ca = caOf(attrs, isGk)
    return ca >= 1250 && ca <= 1450
  })
  const pool = inRange.length ? inRange : candidates
  let best = pool[0]
  let bestDiff = Number.POSITIVE_INFINITY
  for (const attrs of pool) {
    const diff = Math.abs(caOf(attrs, isGk) - targetCa)
    if (diff < bestDiff) {
      best = attrs
      bestDiff = diff
    }
  }
  return best
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
  const [name, enName, country, pos, style, targetCa, foot] = tuple
  const isGk = pos === 'GK'
  const random = rngFrom(`${def.id}|${enName}|${index}`)
  const attrs = attributesFor(targetCa, weightsFor(tuple), isGk)
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
    number: isGk ? 1 : index + 1,
    foot: (foot ?? 'R') as Foot,
    height: heightFor(pos, random),
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
    age: 24 + Math.floor(random() * 6),
    baseAttrs: { ...attrs },
    basePositions: { ...positions },
    basePersonality: { ...personality },
  }
}

function buildTeam(def: LegendTeamDef): AITeam {
  const players = def.players.map((tuple, index) => buildPlayer(def, tuple, index))
  if (players.length !== 16) throw new Error(`${def.id}: 需要 16 名球员，实际 ${players.length}`)
  const formation = FORMATIONS[def.formationId]
  const used = new Set<string>()
  const starters: { slotId: string; playerId: string; role: ReturnType<typeof bestRoleForPlayer>['role'] }[] = []
  for (const slot of formation.slots) {
    const pool = players.filter((player) => !used.has(player.id))
    const exact = pool.find((player) => player.positions[slot.position] >= 80 && (slot.position === 'GK') === (player.positions.GK > 0))
    const learned = exact ?? pool.find((player) => player.positions[slot.position] >= 80)
    const pick = learned ?? pool[0]
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
    name: `${def.club} ${def.season}`,
    short: def.club.slice(0, 2),
    color: def.color,
    accent: def.accent,
    style: `传奇 · ${def.tier}`,
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
  if (cached) return cached
  const def = LEGEND_TEAMS.find((team) => team.id === id)
  if (!def) return undefined
  const team = buildTeam(def)
  cache.set(id, team)
  return team
}

export function allLegendTeams(): AITeam[] {
  return LEGEND_TEAMS.map((def) => legendTeamById(def.id)!)
}

export function legendTeamDefs(): LegendTeamDef[] {
  return LEGEND_TEAMS
}
