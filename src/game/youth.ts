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
/** Calibrated over the 1–5 remaining weekly seasons so academy prospects reliably approach potential before graduation. */
export const YOUTH_BASE_GROWTH = 6.0
/** 服务器宕机一次性青训补偿活动标识与数值配置（仅联机账号下一期招募生效一次）。 */
export const YOUTH_DOWNTIME_COMPENSATION_ID = 'downtime-2026-11'
export const YOUTH_DOWNTIME_COMPENSATION = {
  age: 17,
  initialCa: 230,
  ceiling: 268,
  minSpeed: 1.0,
} as const
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
  /** 特殊活动或补偿来源标识（如服务器宕机补偿），用于界面标记，不影响结算权限。 */
  compensationId?: string
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
  /** 已发放的一次性招募补偿活动 ID 账本（幂等防重发）。 */
  compensations?: Record<string, true>
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
  const gk = player.positions.GK > 0
  const actual = caOf(player.attrs, gk)
  const factor = actual > 0 ? Math.sqrt(target / actual) : 0
  let clamped = false
  for (const key of ALL_ATTRIBUTES) {
    const raw = player.attrs[key] * factor
    const limit = attrLimit(key, gk)
    if (raw > limit) clamped = true
  }
  if (!clamped) {
    for (const key of ALL_ATTRIBUTES) player.attrs[key] *= factor
  } else {
    const base = { ...player.attrs }
    const scaled = (k: number): Attributes => Object.fromEntries(
      ALL_ATTRIBUTES.map(key => [key, Math.min(attrLimit(key, gk), base[key] * k)]),
    ) as Attributes
    let lo = factor
    let hi = Math.max(factor * 2, 2)
    while (caOf(scaled(hi), gk) < target && hi < 64) hi *= 2
    for (let step = 0; step < 60; step++) {
      const mid = (lo + hi) / 2
      if (caOf(scaled(mid), gk) <= target) lo = mid
      else hi = mid
    }
    player.attrs = scaled(lo)
  }
  player.baseAttrs = { ...player.attrs }
}
type IntakeStarTarget = 'regular' | 'star40' | 'star45' | 'star50' | 'compensation50'

type AcademyIntakeProfile = {
  guaranteed45: boolean
  first45Chance: number
  second45Chance: number
  star50Chance: number
  youngAgeChance: number
  goldenYoungAgeChance: number
}

/** Private academy-level intake tuning (LV1–LV5). Never exposed as exact numbers in UI. */
const ACADEMY_INTAKE_PROFILES: Record<1 | 2 | 3 | 4 | 5, AcademyIntakeProfile> = {
  1: { guaranteed45: false, first45Chance: 0.25, second45Chance: 0, star50Chance: 0.04, youngAgeChance: 0.40, goldenYoungAgeChance: 0.45 },
  2: { guaranteed45: false, first45Chance: 0.40, second45Chance: 0, star50Chance: 0.06, youngAgeChance: 0.44, goldenYoungAgeChance: 0.50 },
  3: { guaranteed45: true, first45Chance: 1, second45Chance: 0.25, star50Chance: 0.10, youngAgeChance: 0.52, goldenYoungAgeChance: 0.60 },
  4: { guaranteed45: true, first45Chance: 1, second45Chance: 0.55, star50Chance: 0.20, youngAgeChance: 0.62, goldenYoungAgeChance: 0.70 },
  5: { guaranteed45: true, first45Chance: 1, second45Chance: 0.80, star50Chance: 0.35, youngAgeChance: 0.72, goldenYoungAgeChance: 0.82 },
}

function academyLevelForStage(stage: number): 1 | 2 | 3 | 4 | 5 {
  const clamped = clamp(Math.round(Number.isFinite(stage) ? stage : 1), 1, 25)
  return Math.ceil(clamped / 5) as 1 | 2 | 3 | 4 | 5
}

function planIntakeTargets(
  rng: ReturnType<typeof derivedRng>,
  count: number,
  profile: AcademyIntakeProfile,
  preferSlotZero: boolean,
): IntakeStarTarget[] {
  const targets: IntakeStarTarget[] = Array.from({ length: count }, () => 'regular')
  if (count <= 0) return targets
  const spotlights: IntakeStarTarget[] = []
  const r50 = rng.float()
  const r45 = rng.float()
  const r2 = rng.float()
  if (profile.guaranteed45) {
    spotlights.push(r50 < profile.star50Chance ? 'star50' : 'star45')
    if (count >= 2 && r2 < profile.second45Chance) spotlights.push('star45')
  } else if (r50 < profile.star50Chance) {
    spotlights.push('star50')
  } else {
    const cond45 = (profile.first45Chance - profile.star50Chance) / Math.max(1e-9, 1 - profile.star50Chance)
    spotlights.push(r45 < cond45 ? 'star45' : 'star40')
  }
  const slots = Array.from({ length: count }, (_, i) => i)
  // 定向寻找槽（0 号位）享有略高的头号苗子命中率，同时保留其他位置出高星的惊喜感。
  const firstIdx = preferSlotZero && count > 1 && rng.float() < 0.35 ? 0 : rng.int(slots.length)
  const chosenFirst = slots.splice(firstIdx, 1)[0]
  targets[chosenFirst] = spotlights[0]
  for (let i = 1; i < spotlights.length && slots.length > 0; i++) {
    const pick = slots.splice(rng.int(slots.length), 1)[0]
    targets[pick] = spotlights[i]
  }
  return targets
}

function rollYouthAge(rng: ReturnType<typeof derivedRng>, youngChance?: number): number {
  if (youngChance === undefined) return 14 + rng.int(5)
  return rng.float() < youngChance ? 14 + rng.int(2) : 16 + rng.int(3)
}

function generateYouth(
  game: GameState,
  at: number,
  slot: string,
  position: DetailedPosition,
  used: Set<string>,
  target: IntakeStarTarget,
  profile: AcademyIntakeProfile,
): YouthMember {
  const identity = `${game.createdAt}:${game.world?.clubs.find(c => c.id === 'player')?.squadKey ?? game.clubName}`
  const rng = derivedRng(game.seed, 'youth-v1', identity, slot)
  let tier: YouthTier
  let ceiling: number
  let age: number
  let initial: number | undefined
  let speed: number | undefined
  let compensationId: string | undefined
  if (target === 'compensation50') {
    // 服务器宕机一次性补偿：固定 17 岁、4.0★ 即战力起步（CA 230）、5.0★ 潜力上限（CA 268），保证一周内满潜。
    tier = 'genius'
    ceiling = YOUTH_DOWNTIME_COMPENSATION.ceiling
    age = YOUTH_DOWNTIME_COMPENSATION.age
    initial = YOUTH_DOWNTIME_COMPENSATION.initialCa
    speed = YOUTH_DOWNTIME_COMPENSATION.minSpeed + rng.float() * 0.2
    compensationId = YOUTH_DOWNTIME_COMPENSATION_ID
  } else if (target === 'star50') {
    // 5.0★ 黄金苗子：潜力上限集中在 270 左右（266–274），必显 5.0★ 且位于 genius 区间内。
    tier = 'genius'
    ceiling = 266 + rng.float() * 8
    age = rollYouthAge(rng, profile.goldenYoungAgeChance)
  } else if (target === 'star45') {
    // 4.5★ 优秀苗子：238–255，必显 4.5★ 且位于 excellent 区间内。
    tier = 'excellent'
    ceiling = 238 + rng.float() * 17
    age = rollYouthAge(rng, profile.youngAgeChance)
  } else if (target === 'star40') {
    // 4.0★ 保底苗子：210–237.5，必显 4.0★。
    if (rng.float() < 0.5) {
      tier = 'promising'
      ceiling = 210 + rng.float() * 15
    } else {
      tier = 'excellent'
      ceiling = 220 + rng.float() * 17.5
    }
    age = rollYouthAge(rng)
  } else {
    // 其余背景位封顶 4.0★，控制每期 4.5★+ 总人数稳定在 1–2 名、避免膨胀。
    if (rng.float() < 0.35) {
      tier = 'promising'
      ceiling = 190 + rng.float() * 35
    } else {
      tier = 'ordinary'
      ceiling = 190 + rng.float() * 19.5
    }
    age = rollYouthAge(rng)
  }
  const initialCa = initial ?? (age <= 15 ? 75 + rng.float() * 35 : age <= 17 ? 105 + rng.float() * 30 : 125 + rng.float() * 20)
  const player = createRandomPlayer({ seed: rng.int(0x7fffffff), position: DETAILED_TO_POSITION[position], detailedPosition: position, tier: 2, usedNames: used, idPrefix: `academy-${game.seed}-${slot}` })
  scaleYouthAttributes(player, initialCa)
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
  return { balanceVersion: 2, ...(compensationId ? { compensationId } : {}), player, initialCa: youthCA(player), ceiling, tier, speed: speed ?? (0.8 + rng.float() * 0.4), initialAge: age, joinedSeason: game.season.index, enrolledAt: at, endsAt: Math.max(at, currentSeasonEnd) + (18 - age) * YOUTH_WEEK_MS, settledAt: at, calledUp: false, plan, plans: [{ at, plan: { ...plan } }], growth: [] }
}
function generateYouthBatch(
  game: GameState,
  at: number,
  batchKey: string,
  positions: readonly DetailedPosition[],
  academyStage: number,
  preferSlotZero: boolean,
  compensationSlot0 = false,
): YouthMember[] {
  const used = usedNames(game)
  const identity = `${game.createdAt}:${game.world?.clubs.find(c => c.id === 'player')?.squadKey ?? game.clubName}`
  const profile = ACADEMY_INTAKE_PROFILES[academyLevelForStage(academyStage)]
  const planRng = derivedRng(game.seed, 'youth-intake-plan-v2', identity, batchKey)
  const targets = planIntakeTargets(planRng, positions.length, profile, preferSlotZero)
  if (compensationSlot0 && targets.length > 0) targets[0] = 'compensation50'
  return positions.map((pos, i) => generateYouth(game, at, `${batchKey}-${i}`, pos, used, targets[i], profile))
}
function usedNames(game: GameState): Set<string> {
  return new Set([...game.roster, ...(game.youth?.members.map(m => m.player) ?? [])].flatMap(p => [p.name, p.enName]))
}
export function ensureYouth(game: GameState, now = Date.now()): boolean {
  if (game.youth) return false
  const stage = clamp(game.economy?.academy ?? 1, 1, 25)
  game.youth = { version: 1, startedAt: now, members: generateYouthBatch(game, now, 'initial', INITIAL_POSITIONS, stage, false), intake: { period: 0, candidates: [], signed: [] }, recruitPosition: 'MC', facilities: [{ at: now, stage }], matches: [] }
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
      const potentialScale = clamp((member.ceiling - member.initialCa) / 120, 0.95, 1.52)
      const daysRemaining = (member.endsAt - from) / DAY_MS
      const trainingAge = 18 - Math.max(0, Math.ceil(daysRemaining / 7) - 1)
      const ageFactor = trainingAge >= 18 ? 1.45 : trainingAge >= 16 ? 1.18 : 1.0
      const match = youthMatchFactor(youth, player.id, from, to)
      const budget = YOUTH_BASE_GROWTH * potentialScale * member.speed * ageFactor * (1 - 0.35 * progress) * youthDailyRoll(game.seed, player.id, member.growth.length, stage) * match.factor * (to - from) / DAY_MS
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
    const at = youth.startedAt + period * YOUTH_WEEK_MS
    const stageAtIntake = [...youth.facilities].reverse().find(f => f.at <= at)?.stage ?? game.economy?.academy ?? 1
    const positions = Array.from({ length: YOUTH_INTAKE_SIZE }, (_, i) => i === 0 ? youth.recruitPosition : INITIAL_POSITIONS[(period + i) % INITIAL_POSITIONS.length])
    const grantDowntimeComp = Boolean(game.shared && !youth.compensations?.[YOUTH_DOWNTIME_COMPENSATION_ID])
    youth.intake = { period, signed: [], candidates: generateYouthBatch(game, now, `intake-${period}`, positions, stageAtIntake, true, grantDowntimeComp) }
    if (grantDowntimeComp) {
      youth.compensations = { ...youth.compensations, [YOUTH_DOWNTIME_COMPENSATION_ID]: true }
    }
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

/** 联机账号是否尚有待发放的一次性服务器宕机青训补偿（将在下一期招募生效）。 */
export function pendingYouthDowntimeCompensation(game: GameState): boolean {
  return Boolean(game.shared && game.youth && !game.youth.compensations?.[YOUTH_DOWNTIME_COMPENSATION_ID])
}

/** Public view omits facility probability mechanics and hidden daily rolls. */
export function youthView(game: GameState, now = Date.now()) {
  const youth = game.youth
  if (!youth) return null
  const view = (member: YouthMember) => {
    const player = youthPlayer(game, member)
    return { id: player.id, name: player.name, age: player.age, youthOrigin: player.youthOrigin, ...(member.compensationId ? { compensation: true } : {}), abilityStars: youthStars(youthCA(player)), potentialStars: youthStars(Math.max(youthCA(player), member.ceiling)), plan: member.plan, calledUp: member.calledUp, endsAt: member.endsAt, nextGrowthAt: member.settledAt < member.endsAt ? Math.min(member.settledAt + DAY_MS, member.endsAt) : null, completed: now >= member.endsAt, growth: member.growth.slice(-7).map(g => ({ at: g.at, abilityStars: youthStars(g.caAfter), improved: g.caAfter > g.caBefore + 1e-8, minutes: g.minutes, matchFactor: g.matchFactor, plan: g.plan })) }
  }
  return { capacity: YOUTH_CAPACITY, wage: YOUTH_WAGE, pendingCompensation: pendingYouthDowntimeCompensation(game), members: youth.members.map(view), intake: { period: youth.intake.period, remaining: Math.max(0, YOUTH_INTAKE_KEEP - youth.intake.signed.length), nextAt: youthNextIntakeAt(game), candidates: youth.intake.candidates.filter(m => !youth.intake.signed.includes(m.player.id)).map(view) }, recruitPosition: youth.recruitPosition }
}
