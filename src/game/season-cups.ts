import type { SeasonState, SeasonTableRow, TierId, WorldState } from './types.ts'
import { computeWorldTable } from './world.ts'
import { derivedRng } from './rng.ts'
import { GAME_DAY_MS, HOUR_MS, kickoffAtForRound, postseasonStartAt, roundsKickedOff } from './calendar.ts'

export type SeasonCupId = 'community' | 'league' | 'champions' | 'cross'
export type SeasonCupFixture = {
  id: string
  cupId: SeasonCupId
  round: number
  homeId: string
  awayId: string
  kickoffAt: number
  played: boolean
  score?: { home: number; away: number }
  shootout?: { home: number; away: number }
  winnerId?: string
  matchId?: string
  /** 只记录已公布赛事的数据；点球大战不计。 */
  scorers?: import('./types.ts').Fixture['scorers']
  assisters?: import('./types.ts').Fixture['assisters']
  playerStats?: SeasonCupPlayerStat[]
}
export type SeasonCupPlayerStat = {
  playerId: string
  teamId: string
  name: string
  minutes: number
  shots?: number
  tackles?: number
  saves?: number
}
export type SeasonCupRound = { round: number; kickoffAt: number; byes: string[]; fixtures: SeasonCupFixture[] }
export type SeasonCup = {
  id: SeasonCupId
  name: string
  entrants: string[]
  dates: number[]
  rounds: SeasonCupRound[]
  championId?: string
}
export type SeasonCups = {
  version: 1
  seasonIndex: number
  qualificationRound: number
  createdAt: number
  /** 公开的抽签种子，只确定签表来源，不包含比赛结果。 */
  drawSeed?: number
  /** 已检查并补齐旧版公布比赛的 AI 参赛/冠军奖励。 */
  aiRewardVersion?: 1
  /** 兼容旧版顺延轮次字段；一天 6 轮固定赛程下恒为空数组。 */
  delayedLeagueRounds: number[]
  cups: SeasonCup[]
}

type Standing = { id: string; tier: TierId; rank: number; row: SeasonTableRow; divisionId: string }
const HOUR = HOUR_MS
const CUP_OFFSET = 2 * HOUR
const MIN_CUP_LEAD = 2 * HOUR
/** 首选黄金档（北京时间 12:00、20:00 → 紧跟 10:00、18:00 联赛之后 2 小时）；不足时启用 16:00 午后档（紧跟 14:00 联赛）。 */
const PRIMARY_LEAGUE_BJT_HOURS = new Set([10, 18])
const FALLBACK_LEAGUE_BJT_HOURS = new Set([10, 14, 18])
export const SEASON_CUP_QUALIFICATION_ROUND = 6
export const SEASON_CUP_NAMES: Record<SeasonCupId, string> = { community: '社区杯', league: '联盟杯', champions: '冠军杯', cross: '星联杯' }

/** 按已公布的完整轮次重新计算，不能用某个分区尚未公布的临时榜。 */
export function completedWorldRound(world: WorldState): number {
  if (!world.divisions.length) return 0
  let complete = 0
  for (let round = 1; round <= 38; round++) {
    if (!world.divisions.every(division => {
      const fixtures = division.fixtures.filter(fixture => fixture.round === round)
      return fixtures.length > 0 && fixtures.every(fixture => fixture.played && !!fixture.score)
    })) break
    complete = round
  }
  return complete
}

function standings(world: WorldState, round: number): Standing[] {
  const names = new Map(world.clubs.map(club => [club.id, club.name]))
  return world.divisions.flatMap(division => {
    const tier = division.tier
    if (!tier || !division.divisionId || !division.clubIds) return []
    const rows = computeWorldTable(division.clubIds, division.fixtures.filter(fixture => fixture.round <= round), names)
    return rows.map((row, index) => ({ id: row.teamId, tier, rank: index + 1, row, divisionId: division.divisionId! }))
  })
}

/** 各区同名次按场均成绩排序，最后用稳定 ID 消除服务端/客户端差异。 */
function compareStanding(a: Standing, b: Standing): number {
  const tierRank: Record<TierId, number> = { champions: 0, division1: 1, division2: 2 }
  const value = (row: SeasonTableRow, read: (r: SeasonTableRow) => number) => read(row) / Math.max(1, row.played)
  return tierRank[a.tier] - tierRank[b.tier] || a.rank - b.rank
    || value(b.row, r => r.points) - value(a.row, r => r.points)
    || value(b.row, r => r.gf - r.ga) - value(a.row, r => r.gf - r.ga)
    || value(b.row, r => r.gf) - value(a.row, r => r.gf)
    || a.id.localeCompare(b.id, 'en')
}

export function seasonCupEntrants(world: WorldState, round: number): Record<SeasonCupId, string[]> {
  const rows = standings(world, round)
  const champions = rows.filter(row => row.tier === 'champions').sort(compareStanding)
  const league = rows.filter(row => row.tier === 'division1').sort(compareStanding)
  const community = rows.filter(row => row.tier === 'division2' && row.rank <= 8).sort(compareStanding)
  // 32 队固定席位：顶级全员、一级前 8，再按各赛区名次逐层分配至多 4 席。
  const lower = rows.filter(row => row.tier === 'division2').sort(compareStanding)
  const cross = [...champions, ...league.filter(row => row.rank <= 8), ...lower.slice(0, 4)]
  const ids = (list: Standing[]) => list.map(row => row.id)
  return { community: ids(community), league: ids(league), champions: ids(champions), cross: ids(cross) }
}

const roundCount = (teams: number): number => teams >= 2 ? Math.ceil(Math.log2(teams)) : 0
export function shuffleSeasonCupTeams<T>(input: readonly T[], seed: number, cupId: SeasonCupId, round: number): T[] {
  const result = [...input]
  const rng = derivedRng(seed, `season-cup-${cupId}-${round}`)
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/** 只生成当前轮；未来对阵等待前轮公布后再生成。 */
function makeRound(cup: Pick<SeasonCup, 'id' | 'dates'>, seasonIndex: number, number: number, players: string[], seed: number): SeasonCupRound {
  const power = 2 ** Math.floor(Math.log2(players.length))
  const byeCount = players.length === power ? 0 : 2 * power - players.length
  const byes = players.slice(0, byeCount)
  const playing = shuffleSeasonCupTeams(players.slice(byeCount), seed, cup.id, number)
  const kickoffAt = cup.dates[number - 1]
  const fixtures: SeasonCupFixture[] = []
  for (let i = 0; i < playing.length; i += 2) {
    fixtures.push({ id: `sc-${seasonIndex}-${cup.id}-${number}-${i / 2 + 1}`, cupId: cup.id, round: number, homeId: playing[i], awayId: playing[i + 1], kickoffAt, played: false })
  }
  return { round: number, kickoffAt, byes, fixtures }
}

/** 已经排定的联赛时间优先，旧存档无字段才回退原始日历。 */
export function seasonRoundKickoff(season: SeasonState, round: number): number {
  const fixture = season.fixtures.find(item => item.round === round && Number.isFinite(item.kickoffAt))
  return fixture?.kickoffAt ?? kickoffAtForRound(season.startedAt, round, season.clockShift)
}

/** 按持久化的有效开球时间计算轮次；旧赛季仍走原有日历。 */
export function worldRoundsKickedOff(world: WorldState, now: number): number {
  if (!world.seasonCups || world.seasonCups.seasonIndex !== world.seasonIndex) return roundsKickedOff(world.seasonStartedAt, now, world.clockShift)
  const season = world.divisions[0]
  if (!season) return 0
  let count = 0
  for (let round = 1; round <= 38; round++) {
    if (seasonRoundKickoff(season, round) > now) break
    count = round
  }
  return count
}

/** 收集未来可用的杯赛中点槽位（北京时间 12:00 / 20:00 优先，不够时加入 16:00）。 */
function collectCupSlots(world: WorldState, fromRound: number, now: number, totalNeeded: number): number[] {
  const division = world.divisions[0]
  if (!division || totalNeeded <= 0) return []
  const end = postseasonStartAt(world.seasonStartedAt, world.clockShift)
  const pick = (allowedHours: ReadonlySet<number>): number[] => {
    const slots: number[] = []
    for (let round = fromRound; round <= 38; round++) {
      const leagueAt = seasonRoundKickoff(division, round)
      const localHour = new Date(leagueAt + 8 * HOUR).getUTCHours()
      const cupAt = leagueAt + CUP_OFFSET
      if (!allowedHours.has(localHour) || cupAt < now + MIN_CUP_LEAD || cupAt >= end) continue
      const peers = world.divisions.flatMap(item => item.fixtures.filter(fixture => fixture.round === round))
      if (!peers.length || peers.some(fixture => fixture.kickoffAt !== leagueAt)) continue
      slots.push(cupAt)
    }
    return slots
  }
  const primary = pick(PRIMARY_LEAGUE_BJT_HOURS)
  return primary.length >= totalNeeded ? primary.slice(0, totalNeeded) : pick(FALLBACK_LEAGUE_BJT_HOURS).slice(0, totalNeeded)
}

function splitTierAndCrossSlots(slots: readonly number[], tierRounds: number, crossRounds: number): { tierDays: number[]; crossDays: number[] } {
  const tierDays: number[] = []
  const crossDays: number[] = []
  for (const slot of slots) {
    const tierLeft = tierRounds - tierDays.length
    const crossLeft = crossRounds - crossDays.length
    if (tierLeft > 0 && tierLeft >= crossLeft) tierDays.push(slot)
    else if (crossLeft > 0) crossDays.push(slot)
    else if (tierLeft > 0) tierDays.push(slot)
  }
  return { tierDays, crossDays }
}

/** 生成完整方案但不修改世界；联赛固定每天 6 轮不顺延，杯赛插入 12:00 / 20:00 黄金档。 */
export function planSeasonCups(world: WorldState, seed: number, now: number): SeasonCups | undefined {
  if (world.seasonCups || !Number.isFinite(now)) return undefined
  if (completedWorldRound(world) < SEASON_CUP_QUALIFICATION_ROUND) return undefined
  const qualificationRound = SEASON_CUP_QUALIFICATION_ROUND
  const entrants = seasonCupEntrants(world, qualificationRound)
  if ((Object.keys(SEASON_CUP_NAMES) as SeasonCupId[]).some(id => entrants[id].length < 2 || new Set(entrants[id]).size !== entrants[id].length)) return undefined
  const tierRounds = Math.max(roundCount(entrants.community.length), roundCount(entrants.league.length), roundCount(entrants.champions.length))
  const crossRounds = roundCount(entrants.cross.length)
  const totalSlots = tierRounds + crossRounds
  const selected = collectCupSlots(world, qualificationRound + 1, now, totalSlots)
  if (selected.length < totalSlots) return undefined
  const { tierDays, crossDays } = splitTierAndCrossSlots(selected, tierRounds, crossRounds)
  const cups = (Object.keys(SEASON_CUP_NAMES) as SeasonCupId[]).map(id => {
    const dates = (id === 'cross' ? crossDays : tierDays).slice(0, roundCount(entrants[id].length))
    const cup: SeasonCup = { id, name: SEASON_CUP_NAMES[id], entrants: entrants[id], dates, rounds: [] }
    cup.rounds.push(makeRound(cup, world.seasonIndex, 1, cup.entrants, seed))
    return cup
  })
  return { version: 1, seasonIndex: world.seasonIndex, qualificationRound, createdAt: now, drawSeed: seed, delayedLeagueRounds: [], cups }
}

/** 提交杯赛计划；一天 6 轮固定赛程下 delayedLeagueRounds 为空，不改动联赛时间。 */
export function applySeasonCupPlan(world: WorldState, plan: SeasonCups): void {
  if (world.seasonCups || plan.seasonIndex !== world.seasonIndex) throw new Error('杯赛计划与赛季不一致')
  const rounds = new Set(plan.delayedLeagueRounds)
  for (const division of world.divisions) for (const fixture of division.fixtures) {
    if (rounds.has(fixture.round) && (fixture.played || !Number.isFinite(fixture.kickoffAt))) throw new Error('不能修改已赛或缺少开球时间的联赛')
  }
  for (const division of world.divisions) for (const fixture of division.fixtures) if (rounds.has(fixture.round)) {
    fixture.kickoffAt! += CUP_OFFSET
    fixture.gameDay = Math.max(0, Math.floor((fixture.kickoffAt! - division.startedAt) / GAME_DAY_MS))
  }
  world.seasonCups = structuredClone(plan)
}

/** 赛程迁移时重排进行中赛季杯赛的未赛轮次，保留已完赛轮次与对阵结果。 */
export function rescheduleActiveSeasonCups(world: WorldState, now: number): boolean {
  const cups = world.seasonCups
  if (!cups || cups.seasonIndex !== world.seasonIndex) return false
  cups.delayedLeagueRounds = []
  const doneOf = (cup: SeasonCup): number => {
    let done = 0
    for (const round of cup.rounds) {
      if (round.fixtures.length > 0 && round.fixtures.some(f => !f.played)) break
      done++
    }
    return done
  }
  const tierCups = cups.cups.filter(cup => cup.id !== 'cross')
  const crossCup = cups.cups.find(cup => cup.id === 'cross')
  const tierNeed = Math.max(0, ...tierCups.map(cup => cup.dates.length - doneOf(cup)))
  const crossNeed = crossCup ? Math.max(0, crossCup.dates.length - doneOf(crossCup)) : 0
  const totalNeed = tierNeed + crossNeed
  if (totalNeed <= 0) return false
  const slots = collectCupSlots(world, Math.max(SEASON_CUP_QUALIFICATION_ROUND + 1, completedWorldRound(world) + 1), now, totalNeed)
  if (slots.length < totalNeed) return false
  const { tierDays, crossDays } = splitTierAndCrossSlots(slots, tierNeed, crossNeed)
  for (const cup of cups.cups) {
    const done = doneOf(cup)
    const pool = cup.id === 'cross' ? crossDays : tierDays
    for (let index = done; index < cup.dates.length; index++) {
      const nextDate = pool[index - done]
      if (!Number.isFinite(nextDate)) continue
      cup.dates[index] = nextDate
      const round = cup.rounds[index]
      if (round && round.fixtures.every(fixture => !fixture.played)) {
        round.kickoffAt = nextDate
        for (const fixture of round.fixtures) fixture.kickoffAt = nextDate
      }
    }
  }
  return true
}

/** 本轮全部公开后产生下一轮；仅赛事发布者可调用。 */
export function advanceSeasonCup(cup: SeasonCup, seasonIndex: number, seed: number): void {
  if (cup.championId) return
  const current = cup.rounds.at(-1)
  if (!current || current.fixtures.some(fixture => !fixture.played || !fixture.winnerId)) return
  const winners = [...current.byes, ...current.fixtures.map(fixture => fixture.winnerId!)]
  if (winners.length === 1) { cup.championId = winners[0]; return }
  if (!cup.dates[current.round]) throw new Error('杯赛缺少下一轮时间')
  cup.rounds.push(makeRound(cup, seasonIndex, current.round + 1, winners, seed))
}
