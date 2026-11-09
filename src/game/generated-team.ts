import type { AITeam, ElevenFormationId, Foot, Position, StyleId, Tactics } from './types.ts'
import { FORMATIONS } from './data/formations.ts'
import { derivedRng } from './rng.ts'
import { pickRandomName } from './data/name-pools.ts'
import type { LegendPlayerTuple, LegendTeamDef } from './data/legend-teams.ts'
import { caOf } from './ca.ts'
import { buildHistoricTeam } from './legend.ts'

/** 生成队的建队参数。id/seed 决定球员；name/颜色/阵型决定外观。 */
export type GeneratedTeamSpec = {
  id: string
  name: string
  short: string
  color: string
  accent: string
  formationId: ElevenFormationId
  tactics: Tactics
  targetCa: number
  seed: number
  season?: string
  note?: string
}

const FORMATION_IDS: ElevenFormationId[] = ['4-4-2', '4-3-3', '4-2-3-1', '3-5-2', '5-3-2', '4-1-4-1', '3-4-3', '4-1-2-1-2']

const POSITION_STYLES: Record<Position, StyleId[]> = {
  GK: ['gk_wall', 'gk_shotstopper', 'gk_sweeper'],
  CB: ['cb_stopper', 'cb_cover', 'cb_ballplaying'],
  W: ['w_dribbler', 'w_crosser', 'w_finisher', 'w_playmaker', 'w_engine', 'fb_attacking', 'fb_playmaker'],
  CM: ['cm_playmaker', 'cm_creator', 'cm_destroyer', 'cm_box2box', 'cm_mezzala', 'cm_engine'],
  ST: ['st_finisher', 'st_poacher', 'st_target', 'st_runner', 'st_false9'],
}

const BENCH_POSITIONS: Position[] = ['GK', 'CB', 'W', 'CM', 'ST']

const NAME_LEFT = [
  '北岸', '南港', '铁砧', '赤焰', '银翼', '黑潮', '白塔', '青锋', '金桥', '灰岩',
  '东岭', '西湾', '风暴', '晨星', '长弓', '远帆', '霜原', '火种', '林海', '沙丘',
]
const NAME_RIGHT = ['联', '竞技', '城', '流浪者', '工人', '青年', '体育', '足球会', '先锋', '之队', '联队', '竞技会', '海港', '矿工', '军团', '雄狮']
const PALETTE: [string, string][] = [
  ['#c8102e', '#ffffff'], ['#00529f', '#ffffff'], ['#1b7f4b', '#ffffff'], ['#f2a900', '#1a1a1a'],
  ['#6a1b9a', '#ffffff'], ['#00838f', '#ffffff'], ['#d84315', '#ffffff'], ['#37474f', '#ffffff'],
  ['#8e1f2f', '#f0bc42'], ['#004170', '#da291c'], ['#fde100', '#000000'], ['#87d8f7', '#ffffff'],
]

function pick<T>(rng: { int(maxExclusive: number): number }, list: readonly T[]): T {
  return list[rng.int(list.length)]
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function makeName(rng: { float(): number; int(maxExclusive: number): number }, used: Set<string>): ReturnType<typeof pickRandomName> {
  for (let attempt = 0; attempt < 300; attempt++) {
    const name = pickRandomName(rng)
    if (used.has(name.name) || used.has(name.enName)) continue
    used.add(name.name)
    used.add(name.enName)
    return name
  }
  return pickRandomName(rng)
}

function makeDef(spec: GeneratedTeamSpec): LegendTeamDef {
  const formation = FORMATIONS[spec.formationId]
  const rng = derivedRng(spec.seed, 'generated-team', spec.id)
  const used = new Set<string>()
  const baseAvg = clamp(Math.round(100 * Math.sqrt(spec.targetCa / 1500)), 40, 100)
  const positions: Position[] = [...formation.slots.map((slot) => slot.position), ...BENCH_POSITIONS]
  const players: LegendPlayerTuple[] = positions.map((pos, index) => {
    const name = makeName(rng, used)
    const style = pick(rng, POSITION_STYLES[pos])
    const starter = index < 11
    const offset = starter ? (index < 3 ? 3 : index < 7 ? 1 : 0) : -3
    const foot: Foot = pos === 'GK' || pos === 'CB' ? (rng.chance(0.2) ? 'L' : 'R') : rng.chance(0.25) ? 'L' : 'R'
    return [
      name.name,
      name.enName,
      name.country,
      pos,
      style,
      clamp(baseAvg + offset, 40, 100),
      foot,
    ]
  })
  const tier = spec.targetCa >= 1200 ? 'S+' : spec.targetCa >= 1050 ? 'S' : spec.targetCa >= 900 ? 'A' : 'B'
  return {
    id: spec.id,
    club: spec.name,
    clubEn: spec.name,
    season: spec.season ?? '',
    coach: '生成教练',
    tier,
    formationId: spec.formationId,
    tactics: { ...spec.tactics },
    color: spec.color,
    accent: spec.accent,
    note: spec.note ?? 'PvE 生成球队',
    targetCa: spec.targetCa,
    players,
  }
}

function shiftAvg(def: LegendTeamDef, delta: number): LegendTeamDef {
  return {
    ...def,
    players: def.players.map((tuple) => [
      tuple[0], tuple[1], tuple[2], tuple[3], tuple[4],
      clamp(Math.round(tuple[5] + delta), 40, 100),
      tuple[6],
    ] as LegendPlayerTuple),
  }
}

function starterCa(def: LegendTeamDef): number {
  const team = buildHistoricTeam(def)
  return team.players.slice(0, 11).reduce((sum, player) => sum + caOf(player.attrs, player.positions.GK > 0), 0) / 11
}

/** 以首发平均 CA 为目标校准整队的 `avg`；返回校准后的定义和实际 CA。 */
export function calibrateGeneratedTeam(def: LegendTeamDef, targetCa: number): { def: LegendTeamDef; actualCa: number } {
  let lo = -25
  let hi = 25
  let best = def
  let bestCa = starterCa(def)
  let bestDiff = Math.abs(bestCa - targetCa)
  for (let i = 0; i < 20; i++) {
    const delta = (lo + hi) / 2
    const candidate = shiftAvg(def, delta)
    const ca = starterCa(candidate)
    const diff = Math.abs(ca - targetCa)
    if (diff < bestDiff) {
      best = candidate
      bestCa = ca
      bestDiff = diff
    }
    if (ca < targetCa) lo = delta
    else hi = delta
  }
  return { def: best, actualCa: bestCa }
}

export function generateTeam(spec: GeneratedTeamSpec): { def: LegendTeamDef; actualCa: number } {
  return calibrateGeneratedTeam(makeDef(spec), spec.targetCa)
}

/** 按种子生成一个球队外观/阵型/战术（球员由 generateTeam 生成）。 */
export function generatedTeamSpec(
  seed: number,
  targetCa: number,
  id: string,
  nameIndex = 0,
  season?: string,
): GeneratedTeamSpec {
  const rng = derivedRng(seed, 'generated-spec', id)
  const left = NAME_LEFT[(nameIndex + rng.int(NAME_LEFT.length)) % NAME_LEFT.length]
  const right = NAME_RIGHT[(nameIndex * 7 + rng.int(NAME_RIGHT.length)) % NAME_RIGHT.length]
  const name = `${left}${right}`
  const [color, accent] = pick(rng, PALETTE)
  const formationId = pick(rng, FORMATION_IDS)
  const tactics: Tactics = {
    attack: pick(rng, ['middle', 'wing', 'balanced'] as const),
    passing: pick(rng, ['short', 'mixed', 'direct'] as const),
    tempo: pick(rng, ['slow', 'normal', 'fast'] as const),
    line: pick(rng, ['low', 'mid', 'high'] as const),
    press: pick(rng, ['low', 'mid', 'high'] as const),
  }
  return {
    id,
    name,
    short: name.slice(0, 2),
    color,
    accent,
    formationId,
    tactics,
    targetCa,
    seed,
    season,
  }
}

export { buildHistoricTeam }
export type { AITeam }
