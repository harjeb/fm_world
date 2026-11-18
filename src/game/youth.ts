import type { AttrKey, Attributes, DetailedPosition, GameState, MatchRecord, Player, PlayerMatchStats, Position } from './types.ts'
import { ALL_ATTRIBUTES } from './types.ts'
import { caOf } from './ca.ts'
import { attrLimit, attrStorage } from './scale.ts'
import { DAY_MS, seasonEndAt } from './calendar.ts'
import { derivedRng } from './rng.ts'
import { createRandomPlayer } from './data/random-players.ts'
import { DETAILED_POSITIONS, DETAILED_TO_POSITION } from './detailed-positions.ts'
import { settleCondition } from './condition.ts'
import { youthStars } from './youth-rating.ts'

export const YOUTH_CAPACITY = 8
export const YOUTH_INITIAL_SIZE = 6
export const YOUTH_INTAKE_SIZE = 5
export const YOUTH_INTAKE_KEEP = 2
export const YOUTH_WEEK_MS = 7 * DAY_MS
export const YOUTH_WAGE = 100
/** Calibrated over the 1–5 remaining weekly seasons; 1.5 made even developed geniuses unreachable. */
export const YOUTH_BASE_GROWTH = 4.5
export const YOUTH_TIERS = {
  ordinary: { label: '普通苗子', min: 190, max: 210 },
  promising: { label: '有前途', min: 190, max: 225 },
  excellent: { label: '优秀苗子', min: 220, max: 255 },
  genius: { label: '天才苗子', min: 250, max: 280 },
} as const
export type YouthTier = keyof typeof YOUTH_TIERS

export const YOUTH_FOCUSES = {
  balanced: { label: '均衡发展', attrs: [] },
  pace: { label: '速度爆发', attrs: ['speed', 'acceleration'] },
  strength: { label: '身体对抗', attrs: ['strength', 'heading'] },
  endurance: { label: '体能耐力', attrs: ['endurance', 'strength'] },
  dribbling: { label: '盘带突破', attrs: ['dribbling', 'firstTouch', 'agility'] },
  passing: { label: '传球组织', attrs: ['passing', 'vision', 'decisions'] },
  finishing: { label: '射门终结', attrs: ['shooting', 'offBall', 'composure'] },
  defending: { label: '防守拦截', attrs: ['tackling', 'anticipation', 'defPos'] },
  saves: { label: '门线扑救', attrs: ['reflexes', 'oneOnOne'] },
  handling: { label: '高球控制', attrs: ['handling', 'rushing', 'anticipation'] },
  distribution: { label: '门将出球', attrs: ['passing', 'decisions', 'rushing'] },
} satisfies Record<string, { label: string; attrs: AttrKey[] }>
export type YouthFocus = keyof typeof YOUTH_FOCUSES
export type YouthPlan = { position: DetailedPosition; focus: YouthFocus }
export type YouthOrigin = { club: string; enrolledAt: number; transferAfter: number; promotedAt?: number }
export type YouthGrowth = { at: number; caBefore: number; caAfter: number; minutes: number; matchFactor: number; plan: YouthPlan }
export type YouthMember = {
  /** 2: ordinary potential raised to 190–210; legacy cohorts migrate only once. */
  balanceVersion?: 2
  player: Player
  initialCa: number
  ceiling: number
  tier: YouthTier
  speed: number
  initialAge: number
  joinedSeason: number
  enrolledAt: number
  endsAt: number
  settledAt: number
  calledUp: boolean
  plan: YouthPlan
  plans: { at: number; plan: YouthPlan }[]
  growth: YouthGrowth[]
}
export type YouthMatch = { id: string; at: number; playerId: string; minutes: number; bonus: number }
export type YouthState = {
  version: 1
  startedAt: number
  members: YouthMember[]
  intake: { period: number; candidates: YouthMember[]; signed: string[] }
  recruitPosition: DetailedPosition
  facilities: { at: number; stage: number }[]
  matches: YouthMatch[]
}

const POSITION_ATTRS: Record<DetailedPosition, AttrKey[]> = {
  GK: ['reflexes', 'handling', 'oneOnOne', 'defPos'],
  DC: ['tackling', 'heading', 'strength', 'defPos'],
  DL: ['speed', 'endurance', 'tackling', 'passing'], DR: ['speed', 'endurance', 'tackling', 'passing'],
  WBL: ['speed', 'endurance', 'passing', 'dribbling'], WBR: ['speed', 'endurance', 'passing', 'dribbling'],
  DM: ['tackling', 'defPos', 'passing', 'decisions'],
  MC: ['passing', 'vision', 'teamwork', 'endurance'],
  AMC: ['passing', 'dribbling', 'vision', 'offBall'],
  ML: ['passing', 'speed', 'endurance', 'dribbling'], MR: ['passing', 'speed', 'endurance', 'dribbling'],
  AML: ['speed', 'acceleration', 'dribbling', 'passing'], AMR: ['speed', 'acceleration', 'dribbling', 'passing'],
  ST: ['shooting', 'offBall', 'heading', 'composure'],
}
const INITIAL_POSITIONS: DetailedPosition[] = ['GK', 'DC', 'DL', 'MC', 'AMR', 'ST']
const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value))
export const youthCA = (player: Player): number => caOf(player.baseAttrs, player.basePositions.GK > 0)
export const isYouthTrainee = (player: Player): boolean => !!player.youthOrigin && player.youthOrigin.promotedAt === undefined
export const youthTransferBlocked = (player: Player, now = Date.now()): boolean => !!player.youthOrigin && (isYouthTrainee(player) || now < player.youthOrigin.transferAfter)
export function youthPlayer(game: GameState, member: YouthMember): Player {
  return member.calledUp ? game.roster.find(p => p.id === member.player.id) ?? member.player : member.player
}
export function validYouthPlan(player: Player, plan: unknown): plan is YouthPlan {
  if (!plan || typeof plan !== 'object') return false
  const { position, focus } = plan as YouthPlan
  if (!DETAILED_POSITIONS.includes(position) || !Object.hasOwn(YOUTH_FOCUSES, focus)) return false
  const gk = player.basePositions.GK > 0
  return (position === 'GK') === gk && (gk || !['saves', 'handling', 'distribution'].includes(focus))
}

/** CA is quadratic: scale real attributes, not just the number shown in the UI. */
export function scaleYouthAttributes(player: Player, target: number): void {
  const actual = caOf(player.attrs, player.positions.GK > 0)
  const factor = actual > 0 ? Math.sqrt(target / actual) : 0
  for (const key of ALL_ATTRIBUTES) player.attrs[key] *= factor
  player.baseAttrs = { ...player.attrs }
}
function generateYouth(game: GameState, at: number, slot: string, position: DetailedPosition, used: Set<string>): YouthMember {
  const identity = `${game.createdAt}:${game.world?.clubs.find(c => c.id === 'player')?.squadKey ?? game.clubName}`
  const rng = derivedRng(game.seed, 'youth-v1', identity, slot)
  const roll = rng.float()
  const tier: YouthTier = roll < 0.01 ? 'genius' : roll < 0.06 ? 'excellent' : roll < 0.30 ? 'promising' : 'ordinary'
  const range = YOUTH_TIERS[tier]
  const ceiling = range.min + rng.float() * (range.max - range.min)
  const age = 14 + rng.int(5)
  const initial = age <= 15 ? 60 + rng.float() * 40 : age <= 17 ? 80 + rng.float() * 45 : 100 + rng.float() * 45
  const player = createRandomPlayer({ seed: rng.int(0x7fffffff), position: DETAILED_TO_POSITION[position], detailedPosition: position, tier: 2, usedNames: used, idPrefix: `academy-${game.seed}-${slot}` })
  scaleYouthAttributes(player, initial)
  player.age = age
  player.number = 30 + rng.int(60)
  player.pa = Math.max(player.pa, ceiling)
  player.positions[DETAILED_TO_POSITION[position]] = 90
  player.detailedPositions = { ...player.detailedPositions, [position]: Math.max(90, player.detailedPositions?.[position] ?? 0) }
  player.basePositions = { ...player.positions }
  player.baseDetailedPositions = { ...player.detailedPositions }
  player.condition = 100
  player.recoveryAt = at
  player.energyAt = at
  player.youthOrigin = { club: game.clubName, enrolledAt: at, transferAfter: at + YOUTH_WEEK_MS }
  const plan: YouthPlan = { position, focus: 'balanced' }
  const currentSeasonEnd = seasonEndAt(game.season.startedAt, game.season.clockShift ?? 0)
  return { balanceVersion: 2, player, initialCa: youthCA(player), ceiling, tier, speed: 0.8 + rng.float() * 0.4, initialAge: age, joinedSeason: game.season.index, enrolledAt: at, endsAt: Math.max(at, currentSeasonEnd) + (18 - age) * YOUTH_WEEK_MS, settledAt: at, calledUp: false, plan, plans: [{ at, plan: { ...plan } }], growth: [] }
}
function usedNames(game: GameState): Set<string> {
  return new Set([...game.roster, ...(game.youth?.members.map(m => m.player) ?? [])].flatMap(p => [p.name, p.enName]))
}
export function ensureYouth(game: GameState, now = Date.now()): boolean {
  if (game.youth) return false
  const used = usedNames(game)
  game.youth = { version: 1, startedAt: now, members: INITIAL_POSITIONS.map((pos, i) => generateYouth(game, now, `initial-${i}`, pos, used)), intake: { period: 0, candidates: [], signed: [] }, recruitPosition: 'MC', facilities: [{ at: now, stage: game.economy?.academy ?? 1 }], matches: [] }
  // First batch is immediately usable; subsequent recruitment begins one real week later.
  return true
}
export function youthNextIntakeAt(game: GameState): number {
  const youth = game.youth!
  return youth.startedAt + (youth.intake.period + 1) * YOUTH_WEEK_MS
}
export function observeYouthFacility(game: GameState, now: number): boolean {
  const youth = game.youth
  if (!youth) return false
  const stage = clamp(game.economy?.academy ?? 1, 1, 25)
  if (youth.facilities.at(-1)?.stage === stage) return false
  youth.facilities.push({ at: now, stage })
  return true
}

/** Private balance tuning. No probability/upgrade-effect copy is exposed by the UI. */
export function youthDailyRoll(seed: number, id: string, periodAt: number, facilityStage: number): number {
  const rng = derivedRng(seed, 'youth-daily-v1', id, periodAt)
  const progress = (clamp(facilityStage, 1, 25) - 1) / 24
  const breakthrough = 0.03 + progress * 0.04
  const good = 0.17 + progress * 0.11
  const roll = rng.float()
  return roll < breakthrough ? 1.8 + rng.float() * 0.4 : roll < breakthrough + good ? 1.3 + rng.float() * 0.3 : 0.9 + rng.float() * 0.2
}

/** Position-aware event evaluation; minutes scale influence, not per-90 stat inflation. */
export function youthPerformanceBonus(stats: PlayerMatchStats, position: Position): number {
  if (!Number.isFinite(stats.minutes) || stats.minutes <= 0) return 0
  if (stats.rating === undefined || !Number.isFinite(stats.rating)) return 0.2 // legacy: appearance only
  const defensive = position === 'GK' ? Math.min(0.8, (stats.saves ?? 0) * 0.12)
    : position === 'CB' ? Math.min(0.7, stats.tackles * 0.08 + stats.interceptions * 0.08)
    : position === 'CM' ? Math.min(0.5, (stats.chancesCreated ?? 0) * 0.1 + stats.interceptions * 0.04) : 0
  return clamp(0.2 + (stats.rating + defensive - 6.5) * 0.2, -0.1, 0.5)
}
export function recordYouthMatch(game: GameState, record: MatchRecord): boolean {
  const youth = game.youth
  if (!youth || !(record.isLeague || (record.mode === 'cup' && record.cupId?.startsWith('season-')))) return false
  let changed = false
  for (const member of youth.members) {
    if (record.createdAt < member.settledAt || record.createdAt < member.enrolledAt || record.createdAt >= member.endsAt || youth.matches.some(m => m.id === record.id && m.playerId === member.player.id)) continue
    const stats = record.playerStats.find(s => s.sourceId === member.player.id)
    if (!stats || !Number.isFinite(stats.minutes) || stats.minutes <= 0) continue
    const player = youthPlayer(game, member)
    const position = (Object.keys(player.positions) as Position[]).sort((a, b) => player.positions[b] - player.positions[a])[0]
    youth.matches.push({ id: record.id, at: record.createdAt, playerId: player.id, minutes: Math.min(90, stats.minutes), bonus: youthPerformanceBonus(stats, position) })
    changed = true
  }
  return changed
}
export function youthMatchFactor(youth: YouthState, playerId: string, from: number, to: number): { factor: number; minutes: number } {
  const matches = youth.matches.filter(m => m.playerId === playerId && m.at >= from && m.at < to).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
  let minutes = 0, bonus = 0
  for (const match of matches) {
    const counted = Math.min(90 - minutes, match.minutes)
    bonus += match.bonus * counted / 90
    minutes += counted
    if (minutes >= 90) break
  }
  return { factor: 1 + bonus, minutes }
}

/** Spend a CA budget on normalized attributes. Binary search respects both CA and attribute caps. */
export function growYouthAttributes(player: Player, plan: YouthPlan, budget: number, ceiling: number): number {
  const gk = player.basePositions.GK > 0
  const before = youthCA(player)
  const target = Math.min(ceiling, before + Math.max(0, budget))
  if (target <= before) return 0
  const weights: Partial<Record<AttrKey, number>> = {}
  const primary = POSITION_ATTRS[plan.position]
  const focus: readonly AttrKey[] = plan.focus === 'balanced' ? primary : YOUTH_FOCUSES[plan.focus].attrs
  for (const [keys, share] of [[primary, 0.7], [focus, 0.3]] as const) {
    const available = keys.filter(key => player.baseAttrs[key] < attrLimit(key, gk))
    for (const key of available) weights[key] = (weights[key] ?? 0) + share / available.length
  }
  const build = (amount: number): Attributes => Object.fromEntries(ALL_ATTRIBUTES.map(key => [key, Math.min(attrLimit(key, gk), player.baseAttrs[key] + attrStorage(key, amount * (weights[key] ?? 0), gk))])) as Attributes
  let lo = 0, hi = 1000
  for (let step = 0; step < 60; step++) {
    const mid = (lo + hi) / 2
    if (caOf(build(mid), gk) <= target) lo = mid
    else hi = mid
  }
  player.baseAttrs = build(lo)
  player.attrs = { ...player.baseAttrs }
  return Math.max(0, youthCA(player) - before)
}
function pendingOfficialMatch(game: GameState, from: number, to: number): boolean {
  if (game.activeMatch?.context.isLeague && game.activeMatch.startedAt >= from && game.activeMatch.startedAt < to) return true
  if (game.season.fixtures.some(f => f.isPlayer && !f.played && f.kickoffAt !== undefined && f.kickoffAt >= from && f.kickoffAt < to)) return true
  const clubId = game.world?.clubs.find(c => c.id === 'player')?.squadKey ?? 'player'
  return game.world?.seasonCups?.cups.some(c => c.rounds.some(r => r.fixtures.some(f => !f.played && (f.homeId === clubId || f.awayId === clubId || f.homeId === 'player' || f.awayId === 'player') && f.kickoffAt >= from && f.kickoffAt < to))) ?? false
}
export function settleYouth(game: GameState, now = Date.now()): boolean {
  let changed = ensureYouth(game, now)
  const youth = game.youth!
  // Reuse each existing ordinary prospect's percentile; no reroll, no current-attribute boost.
  for (const member of [...youth.members, ...youth.intake.candidates]) {
    if (member.balanceVersion === 2) continue
    if (member.tier === 'ordinary') {
      const percentile = clamp((member.ceiling - 160) / 35, 0, 1)
      member.ceiling = Math.max(member.ceiling, 190 + percentile * 20)
    }
    member.balanceVersion = 2
    changed = true
  }
  // Observe upgrades at their actual effective time, never apply them retroactively.
  if (observeYouthFacility(game, now)) changed = true
  if (game.shared) for (const record of [...game.matchHistory, ...game.challengeHistory]) if (recordYouthMatch(game, record)) changed = true
  for (const member of youth.members) {
    const player = youthPlayer(game, member)
    if (!member.calledUp && settleCondition(player, now)) changed = true
    // Age remains aligned with the club season, including offline catch-up.
    const age = Math.min(19, member.initialAge + Math.max(0, game.season.index - member.joinedSeason))
    if (player.age !== age) { player.age = age; changed = true }
    for (let steps = 0; steps < 40 && member.settledAt < member.endsAt; steps++) {
      const from = member.settledAt
      const to = Math.min(from + DAY_MS, member.endsAt)
      if (to > now || pendingOfficialMatch(game, from, to)) break
      const plan = [...member.plans].reverse().find(p => p.at <= from)?.plan ?? member.plans[0].plan
      const stage = [...youth.facilities].reverse().find(f => f.at <= from)?.stage ?? 1
      const before = youthCA(player)
      const progress = clamp((before - member.initialCa) / Math.max(1, member.ceiling - member.initialCa), 0, 1)
      const daysRemaining = (member.endsAt - from) / DAY_MS
      const trainingAge = 18 - Math.max(0, Math.ceil(daysRemaining / 7) - 1)
      const ageFactor = trainingAge >= 18 ? 0.9 : trainingAge >= 16 ? 1.1 : 1
      const match = youthMatchFactor(youth, player.id, from, to)
      const budget = YOUTH_BASE_GROWTH * member.speed * ageFactor * (1 - 0.6 * progress) * youthDailyRoll(game.seed, player.id, member.growth.length, stage) * match.factor * (to - from) / DAY_MS
      growYouthAttributes(player, plan, budget, member.ceiling)
      const coarse = DETAILED_TO_POSITION[plan.position]
      const proficiency = Math.min(100, (player.baseDetailedPositions?.[plan.position] ?? 0) + 3 * (to - from) / DAY_MS)
      player.baseDetailedPositions = { ...player.baseDetailedPositions, [plan.position]: proficiency }
      player.detailedPositions = { ...player.baseDetailedPositions }
      player.basePositions[coarse] = Math.max(player.basePositions[coarse], proficiency)
      player.positions = { ...player.basePositions }
      member.growth.push({ at: to, caBefore: before, caAfter: youthCA(player), minutes: match.minutes, matchFactor: match.factor, plan: { ...plan } })
      member.settledAt = to
      changed = true
    }
    member.player = player
  }
  const period = Math.max(0, Math.floor((now - youth.startedAt) / YOUTH_WEEK_MS))
  if (period > youth.intake.period) {
    const used = usedNames(game)
    const at = youth.startedAt + period * YOUTH_WEEK_MS
    youth.intake = { period, signed: [], candidates: Array.from({ length: YOUTH_INTAKE_SIZE }, (_, i) => generateYouth(game, now, `intake-${period}-${i}`, i === 0 ? youth.recruitPosition : INITIAL_POSITIONS[(period + i) % INITIAL_POSITIONS.length], used)) }
    // Candidates are generated once per period; appearance time doesn't change their identity or rolls.
    for (const candidate of youth.intake.candidates) {
      candidate.enrolledAt = at
      candidate.player.youthOrigin!.enrolledAt = at
    }
    changed = true
  }
  // Keep only appearances still needed by a pending daily settlement.
  youth.matches = youth.matches.filter(m => youth.members.some(member => member.player.id === m.playerId && m.at >= member.settledAt))
  return changed
}

/** Offline fast-forward moves all academy anchors together without rerolling outcomes. */
export function shiftYouthClock(game: GameState, delta: number): void {
  const youth = game.youth
  if (!youth || !(delta > 0)) return
  youth.startedAt -= delta
  for (const event of youth.facilities) event.at -= delta
  for (const match of youth.matches) match.at -= delta
  for (const member of [...youth.members, ...youth.intake.candidates]) {
    member.enrolledAt -= delta
    member.settledAt -= delta
    member.endsAt -= delta
    for (const plan of member.plans) plan.at -= delta
    for (const growth of member.growth) growth.at -= delta
    if (!member.calledUp && member.player.recoveryAt !== undefined) member.player.recoveryAt -= delta
  }
  const players = new Map([...game.roster, ...youth.members.map(m => m.player), ...youth.intake.candidates.map(m => m.player)].map(p => [p.id, p]))
  for (const player of players.values()) if (player.youthOrigin) {
    player.youthOrigin.enrolledAt -= delta
    player.youthOrigin.transferAfter -= delta
    if (player.youthOrigin.promotedAt !== undefined) player.youthOrigin.promotedAt -= delta
  }
}

/** Public view omits facility probability mechanics and hidden daily rolls. */
export function youthView(game: GameState, now = Date.now()) {
  const youth = game.youth
  if (!youth) return null
  const view = (member: YouthMember) => {
    const player = youthPlayer(game, member)
    return { id: player.id, name: player.name, age: player.age, youthOrigin: player.youthOrigin, abilityStars: youthStars(youthCA(player)), potentialStars: youthStars(Math.max(youthCA(player), member.ceiling)), plan: member.plan, calledUp: member.calledUp, endsAt: member.endsAt, nextGrowthAt: member.settledAt < member.endsAt ? Math.min(member.settledAt + DAY_MS, member.endsAt) : null, completed: now >= member.endsAt, growth: member.growth.slice(-7).map(g => ({ at: g.at, abilityStars: youthStars(g.caAfter), improved: g.caAfter > g.caBefore + 1e-8, minutes: g.minutes, matchFactor: g.matchFactor, plan: g.plan })) }
  }
  return { capacity: YOUTH_CAPACITY, wage: YOUTH_WAGE, members: youth.members.map(view), intake: { period: youth.intake.period, remaining: Math.max(0, YOUTH_INTAKE_KEEP - youth.intake.signed.length), nextAt: youthNextIntakeAt(game), candidates: youth.intake.candidates.filter(m => !youth.intake.signed.includes(m.player.id)).map(view) }, recruitPosition: youth.recruitPosition }
}
