import type { DetailedPosition, DetailedPositionTable, Player, Position, PositionTable, StyleId } from './types.ts'
import { DETAILED_POSITIONS, DETAILED_TO_POSITION, readDetailedPositions, inferDetailedPositions } from './detailed-positions.ts'
import { derivedRng, hashString } from './rng.ts'
import { NATURAL_STAR_POSITIONS } from './data/natural-star-positions.ts'

export type PositionProfile = { version: 1; primary: DetailedPosition; floors: DetailedPositionTable }
type Identity = Pick<Player, 'seedId' | 'id' | 'enName' | 'era' | 'style' | 'foot' | 'positions'> & Partial<Pick<Player, 'basePositions' | 'baseDetailedPositions' | 'starKey' | 'youthOrigin' | 'positionProfile'>>

/** Same 25 coarse slots/order as the existing identity generator. */
export const NATURAL_SQUAD_TEMPLATE: readonly DetailedPosition[] = [
  'GK', 'GK', 'DC', 'DC', 'DC', 'DC', 'DL', 'DR', 'ML', 'MR', 'DM', 'MC', 'MC', 'AMC', 'ST', 'ST', 'ST', 'ST',
  'GK', 'DC', 'DC', 'AML', 'AMR', 'WBL', 'DM',
]
export function naturalSquadTemplate(seed: number): DetailedPosition[] {
  const table = [...NATURAL_SQUAD_TEMPLATE]
  table[23] = derivedRng(seed, 'squad-wingback-side').chance(0.5) ? 'WBL' : 'WBR'
  return table
}

const ROLE_STYLES: Record<DetailedPosition, readonly StyleId[]> = {
  GK: ['gk_wall', 'gk_shotstopper', 'gk_sweeper'], DC: ['cb_stopper', 'cb_cover', 'cb_ballplaying'],
  DL: ['fb_attacking', 'fb_playmaker'], DR: ['fb_attacking', 'fb_playmaker'],
  WBL: ['fb_attacking', 'fb_playmaker'], WBR: ['fb_attacking', 'fb_playmaker'],
  ML: ['w_crosser', 'w_engine', 'w_playmaker'], MR: ['w_crosser', 'w_engine', 'w_playmaker'],
  AML: ['w_dribbler', 'w_finisher', 'w_playmaker'], AMR: ['w_dribbler', 'w_finisher', 'w_playmaker'],
  DM: ['cm_destroyer', 'cm_playmaker'], MC: ['cm_playmaker', 'cm_box2box', 'cm_engine'],
  AMC: ['cm_creator', 'cm_mezzala', 'cm_playmaker'], ST: ['st_finisher', 'st_poacher', 'st_target', 'st_runner', 'st_false9'],
}
export function naturalStyle(position: DetailedPosition, seed: number): StyleId {
  return derivedRng(seed, 'natural-position-style-v1').pick(ROLE_STYLES[position])
}
export function randomNaturalPosition(coarse: Position, seed: number): DetailedPosition {
  const choices: Record<Position, readonly DetailedPosition[]> = {
    GK: ['GK'], CB: ['DC'], W: ['DL', 'DR', 'WBL', 'WBR', 'ML', 'MR', 'AML', 'AMR'], CM: ['DM', 'MC', 'AMC'], ST: ['ST'],
  }
  return derivedRng(seed, 'natural-position-main-v1').pick(choices[coarse])
}
function coarseOf(player: Identity): Position {
  if ((player.basePositions ?? player.positions).GK > 0) return 'GK'
  if (player.style.startsWith('cb_')) return 'CB'
  if (player.style.startsWith('fb_') || player.style.startsWith('w_')) return 'W'
  if (player.style.startsWith('cm_')) return 'CM'
  if (player.style.startsWith('st_')) return 'ST'
  const positions = player.basePositions ?? player.positions
  return (['CB', 'W', 'CM', 'ST'] as const).reduce((best, pos) => positions[pos] > positions[best] ? pos : best, 'CM' as Position)
}

/** Only historical world/small-league slot ID families; never parse market/academy/refill IDs as slots. */
function originalSlot(player: Identity, coarse: Position): number | undefined {
  const id = player.seedId || player.id
  const match = /^(?:ai_\d+|d1_\d+|d2[nNsS]_?\d+|d2z\d+_\d+|r\d+|player)-(\d+)-[a-z0-9]+$/.exec(id)
  if (!match) return undefined
  const slot = Number(match[1]) - 1
  return slot >= 0 && slot < NATURAL_SQUAD_TEMPLATE.length && DETAILED_TO_POSITION[NATURAL_SQUAD_TEMPLATE[slot]] === coarse ? slot : undefined
}
function legacyMain(player: Identity): DetailedPosition {
  const coarse = coarseOf(player)
  if (coarse === 'GK') return 'GK'
  // Academy origin is fixed at intake; a later training plan must not redefine natural roles.
  if (player.youthOrigin && player.baseDetailedPositions) {
    const natural = DETAILED_POSITIONS.filter(p => p !== 'GK' && DETAILED_TO_POSITION[p] === coarse)
      .sort((a, b) => (player.baseDetailedPositions![b] ?? 0) - (player.baseDetailedPositions![a] ?? 0))[0]
    if (natural) return natural
  }
  const slot = originalSlot(player, coarse)
  if (slot !== undefined) return slot === 23 ? (hashString(player.seedId) % 2 ? 'WBL' : 'WBR') : NATURAL_SQUAD_TEMPLATE[slot]
  if (coarse === 'CB') return 'DC'
  if (coarse === 'ST') return 'ST'
  const left = player.foot === 'L' || (player.foot === 'B' && hashString(player.seedId) % 2 === 0)
  if (coarse === 'CM') return player.style === 'cm_destroyer' ? 'DM' : ['cm_creator', 'cm_mezzala'].includes(player.style) ? 'AMC' : 'MC'
  if (player.style.startsWith('fb_')) return left ? 'DL' : 'DR'
  if (player.style === 'w_engine') return left ? 'WBL' : 'WBR'
  if (player.style === 'w_crosser') return left ? 'ML' : 'MR'
  // Inverted wingers are intentional; their main role is not penalized for preferred foot.
  return left ? 'AMR' : 'AML'
}
function secondaries(primary: DetailedPosition, style: StyleId): DetailedPosition[] {
  const roles: Record<DetailedPosition, DetailedPosition[]> = {
    GK: [], DC: style === 'cb_ballplaying' ? ['DM'] : [],
    DL: ['WBL', 'ML'], DR: ['WBR', 'MR'], WBL: ['DL', 'ML'], WBR: ['DR', 'MR'],
    ML: ['AML', 'WBL'], MR: ['AMR', 'WBR'], AML: ['ML', 'AMC'], AMR: ['MR', 'AMC'],
    DM: ['MC'], MC: style === 'cm_engine' || style === 'cm_box2box' ? ['DM', 'AMC'] : ['AMC', 'DM'],
    AMC: ['MC'], ST: style === 'st_false9' ? ['AMC'] : [],
  }
  return roles[primary]
}
function validProfile(profile: PositionProfile | undefined, isGk: boolean): profile is PositionProfile {
  return !!profile && profile.version === 1 && DETAILED_POSITIONS.includes(profile.primary) && (profile.primary === 'GK') === isGk
    && !!profile.floors && typeof profile.floors === 'object' && !Array.isArray(profile.floors)
    && Object.entries(profile.floors).every(([p, value]) => DETAILED_POSITIONS.includes(p as DetailedPosition) && (p === 'GK') === isGk && Number.isFinite(value) && value! >= 0 && value! <= 100)
}
/** Pure identity-based profile. Context only supplies an explicit role for a newly generated person. */
export function naturalPositionProfile(player: Identity, requested?: DetailedPosition): PositionProfile {
  const gk = coarseOf(player) === 'GK'
  if (requested === undefined && validProfile(player.positionProfile, gk)) return structuredClone(player.positionProfile)
  const curated = player.era !== 'random' && /^p\d+$/.test(player.starKey ?? player.seedId) ? NATURAL_STAR_POSITIONS[player.enName] : undefined
  const primary = requested ?? curated?.[0] ?? legacyMain(player)
  if ((primary === 'GK') !== gk) throw new Error('门将与外场球员的天然位置不能互换')
  const rng = derivedRng(hashString(`${player.seedId}|${player.enName}`), 'natural-proficiency-v1', primary)
  const floors: DetailedPositionTable = { [primary]: primary === 'GK' ? player.positions.GK : 90 + rng.int(10) }
  for (const pos of (requested === undefined && curated ? curated.slice(1) : secondaries(primary, player.style))) {
    if (pos !== primary && (pos === 'GK') === gk) floors[pos] = 80 + rng.int(10)
  }
  return { version: 1, primary, floors }
}

/** Fresh generation only: one clear main role; unrelated coarse group skills aren't copied to all subroles. */
export function initializeNaturalPositions(player: Player, requested?: DetailedPosition): void {
  const profile = naturalPositionProfile(player, requested)
  const inferred = inferDetailedPositions({ positions: player.positions, style: player.style, foot: player.foot })
  const table = Object.fromEntries(DETAILED_POSITIONS.map(pos => [pos, pos === 'GK' ? player.positions.GK : player.positions.GK > 0 ? 0 : Math.min(75, inferred[pos])])) as DetailedPositionTable
  Object.assign(table, profile.floors)
  player.positionProfile = profile
  player.detailedPositions = table
  player.baseDetailedPositions = { ...table }
  player.detailedPositionsVersion = player.baseDetailedPositionsVersion = 1
}

/** Preserve EFFECTIVE values, including missing detailed entries that used to fall back to coarse. */
export function withPositionFloors(positions: PositionTable, table: DetailedPositionTable | undefined, floors: DetailedPositionTable): DetailedPositionTable {
  const effective = readDetailedPositions({ positions, detailedPositions: table })
  const next = { ...table }
  for (const pos of DETAILED_POSITIONS) {
    const floor = floors[pos]
    if (floor !== undefined && effective[pos] < floor) next[pos] = floor
  }
  return next
}
export function backfillNaturalPlayer(player: Player, profile = naturalPositionProfile(player)): boolean {
  const current = withPositionFloors(player.positions, player.detailedPositions, profile.floors)
  const base = withPositionFloors(player.basePositions ?? player.positions, player.baseDetailedPositions, profile.floors)
  const changed = JSON.stringify(player.positionProfile) !== JSON.stringify(profile)
    || JSON.stringify(player.detailedPositions ?? {}) !== JSON.stringify(current)
    || JSON.stringify(player.baseDetailedPositions ?? {}) !== JSON.stringify(base)
  if (changed) {
    player.positionProfile = structuredClone(profile)
    player.detailedPositions = current
    player.baseDetailedPositions = base
  }
  return changed
}

/** Newly added replacements fill real detailed-position holes within the requested coarse family. */
export function neededNaturalPosition(players: Player[], coarse: Position, seed: number): DetailedPosition {
  const choices = DETAILED_POSITIONS.filter(p => DETAILED_TO_POSITION[p] === coarse)
  const counts = new Map(choices.map(pos => [pos, players.filter(p => readDetailedPositions(p)[pos] >= 80).length]))
  const gain = (pos: DetailedPosition) => [pos, ...secondaries(pos, naturalStyle(pos, seed))].filter(p => counts.has(p) && counts.get(p) === 0).length
  return choices.reduce((a, b) => gain(b) > gain(a) || (gain(b) === gain(a) && counts.get(b)! < counts.get(a)!) ? b : a)
}

/** Allocate detailed slots once from immutable initial stars. Legacy worlds MUST NOT use this branch. */
export function allocateNaturalSquad(stars: Player[], seed: number): { positions: DetailedPosition[]; stars: Map<number, Player> } {
  const positions = naturalSquadTemplate(seed)
  const assigned = new Map<number, Player>()
  // Put stars in their real preferred slots first, before reserving neighboring/coarse slots.
  for (const star of stars) {
    const primary = naturalPositionProfile(star).primary
    const slot = positions.findIndex((pos, i) => pos === primary && !assigned.has(i))
    if (slot >= 0) assigned.set(slot, star)
  }
  for (const star of stars) {
    if ([...assigned.values()].some(p => p.id === star.id)) continue
    const primary = naturalPositionProfile(star).primary
    const coarse = DETAILED_TO_POSITION[primary]
    const slots = positions.map((pos, i) => ({ pos, i })).filter(({ pos, i }) => DETAILED_TO_POSITION[pos] === coarse && !assigned.has(i))
    // Prefer a role the star can actually cover; keep the rest of the identity template fixed.
    const slot = slots.find(({ pos }) => (readDetailedPositions(star)[pos] ?? 0) >= 80) ?? slots.at(-1)
    if (slot) assigned.set(slot.i, star)
  }
  // A wingback star can cover the missing fullback; a duplicate winger must not remove the only fullback slot.
  for (const coarse of ['W', 'CM'] as const) {
    const required: DetailedPosition[] = coarse === 'W' ? ['DL', 'DR', 'WBL', 'WBR', 'ML', 'MR', 'AML', 'AMR'] : ['DM', 'MC', 'AMC']
    const open = positions.map((pos, i) => ({ pos, i })).filter(({ pos, i }) => DETAILED_TO_POSITION[pos] === coarse && !assigned.has(i))
    const covered = new Set(required.filter(pos => [...assigned.values()].some(p => readDetailedPositions(p)[pos] >= 80)))
    for (const slot of open) {
      const coverage = (pos: DetailedPosition) => [pos, ...secondaries(pos, naturalStyle(pos, seed))]
      const gain = (pos: DetailedPosition) => coverage(pos).filter(p => required.includes(p) && !covered.has(p)).length
      const choices = [slot.pos, ...required.filter(p => p !== slot.pos)]
      const best = choices.reduce((a, b) => gain(b) > gain(a) ? b : a)
      positions[slot.i] = best
      for (const pos of coverage(best)) covered.add(pos)
    }
  }
  return { positions, stars: assigned }
}
