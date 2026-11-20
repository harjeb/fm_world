import type { CupTableRow, SeasonState, SeasonTableRow, TierId, WorldState } from './types.ts'
import { computeWorldTable } from './world.ts'
import { emptyCupRow, sortCupTable, updateCupTable } from './cup-table.ts'
import { derivedRng, splitSeed } from './rng.ts'
import { GAME_DAY_MS, HOUR_MS, ROUND_INTERVAL_MS, kickoffAtForRound, postseasonStartAt, roundsKickedOff, seasonEndAt } from './calendar.ts'
import { LEGEND_CUP_TEAM_IDS, isLegendCupTeamId } from './data/legend-cup-teams.ts'

export type SeasonCupId = 'community' | 'league' | 'champions' | 'cross' | 'legend'
export type SeasonCupStage = 'group' | 'knockout'
export type SeasonCupFixture = {
  id: string
  cupId: SeasonCupId
  round: number
  /** 缺省视为淘汰赛；'group' 为小组赛（允许平局、不发放参赛金币）。 */
  stage?: SeasonCupStage
  /** 小组赛所属组号（0=A组, 1=B组, 2=C组, 3=D组）。 */
  groupIndex?: number
  /** 两回合淘汰赛回合号：1=首回合（允许平局、发本轮参赛金），2=次回合（总比分决胜、总分平点球、不重复发参赛金）。单场缺省。 */
  leg?: 1 | 2
  /** 次回合携带的首回合比分（已对齐本场主客方向：home 为本场主队首回合客场进球，away 为本场客队首回合主场进球）。 */
  aggregateOffset?: { home: number; away: number }
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
export type SeasonCupGroup = {
  index: number
  name: string
  teamIds: string[]
  table: CupTableRow[]
}
export type SeasonCupRound = { round: number; kickoffAt: number; stage?: SeasonCupStage; leg?: 1 | 2; byes: string[]; fixtures: SeasonCupFixture[] }
export type SeasonCup = {
  id: SeasonCupId
  name: string
  entrants: string[]
  dates: number[]
  rounds: SeasonCupRound[]
  /** 含小组赛赛制（传奇杯）的分组与积分榜；纯淘汰赛缺省。 */
  groups?: SeasonCupGroup[]
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
/** 首选黄金档（北京时间 12:00、20:00 → 紧跟 10:00、18:00 联赛之后 2 小时）；不足时启用 16:00 午后档，再不足按需补 08:00 / 00:00 / 04:00。 */
const PRIMARY_LEAGUE_BJT_HOURS = new Set([10, 18])
const FALLBACK_LEAGUE_BJT_HOURS = new Set([10, 14, 18])
const EXTRA_LEAGUE_BJT_HOUR_TIERS = [new Set([6]), new Set([22]), new Set([2])] as const
export const SEASON_CUP_QUALIFICATION_ROUND = 6
/** 传奇杯资格来自上赛季冠联前 4，赛程从第 5 轮之后启动并一直延续至赛季结束前（含赛后休整期）。 */
export const LEGEND_CUP_START_ROUND = 5
const LEGEND_CUP_END_BUFFER = 2 * HOUR
export const SEASON_CUP_NAMES: Record<SeasonCupId, string> = { community: '社区杯', league: '联盟杯', champions: '冠军杯', cross: '星联杯', legend: '传奇杯' }
const CORE_SEASON_CUP_IDS: readonly SeasonCupId[] = ['community', 'league', 'champions', 'cross']
export const LEGEND_GROUP_ROUNDS = 3
/** 传奇杯总轮数：3 轮小组赛 + 1/4 决赛两回合（2）+ 半决赛两回合（2）+ 单场决赛（1）= 8 轮。 */
export const LEGEND_TOTAL_ROUNDS = 8
const LEGEND_GROUP_NAMES = ['A 组', 'B 组', 'C 组', 'D 组'] as const
/** 4 队单循环 3 轮对阵（每队至少 1 主 1 客）。 */
const GROUP_PAIRINGS: readonly (readonly [readonly [number, number], readonly [number, number]])[] = [
  [[0, 1], [2, 3]],
  [[2, 0], [1, 3]],
  [[0, 3], [2, 1]],
]
/** 8 强交叉对阵（同组前二落入不同半区）：首回合小组第 2 先主场，次回合小组第 1 享主场优势。 */
export const LEGEND_QF_SLOTS: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 1, 1], // A1 vs B2
  [2, 0, 3, 1], // C1 vs D2
  [1, 0, 0, 1], // B1 vs A2
  [3, 0, 2, 1], // D1 vs C2
]

/** 该场赛季杯赛是否发放本轮参赛金：小组赛不发，两回合淘汰赛仅在首回合发一次（每轮发一次），单场淘汰赛照发。 */
export function paysSeasonCupAppearanceGold(fixture: Pick<SeasonCupFixture, 'stage' | 'leg'>): boolean {
  return fixture.stage !== 'group' && fixture.leg !== 2
}

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

/** 上赛季冠军联赛最终前四（用于本赛季传奇杯资格）；首赛季或缺少记录时返回空数组。 */
export function previousChampionsTop4(world: WorldState): string[] {
  if (world.seasonIndex <= 1) return []
  const prev = world.history?.find(entry => entry.seasonIndex === world.seasonIndex - 1)
  if (!prev?.championsTop4?.length) return []
  const valid = new Set<string>()
  for (const club of world.clubs) {
    valid.add(club.id)
    if (club.squadKey) valid.add(club.squadKey)
  }
  const seen = new Set<string>()
  const result: string[] = []
  for (const id of prev.championsTop4) {
    if (!valid.has(id) || seen.has(id)) continue
    seen.add(id)
    result.push(id)
    if (result.length >= 4) break
  }
  return result
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
  const prevTop4 = previousChampionsTop4(world)
  const legend = prevTop4.length === 4 ? [...prevTop4, ...LEGEND_CUP_TEAM_IDS] : []
  return { community: ids(community), league: ids(league), champions: ids(champions), cross: ids(cross), legend }
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

/** 传奇杯 4 档分池抽签：4 支冠军联赛前 4 分入 4 个小组，12 支历史豪门按 CA 强弱分 3 档均衡分配，确保每组 1 支联赛队 + 3 支不同档位历史豪门。 */
function buildLegendGroups(entrants: readonly string[], seed: number): SeasonCupGroup[] {
  const worldClubs = entrants.filter(id => !isLegendCupTeamId(id))
  const legendClubs = entrants.filter(id => isLegendCupTeamId(id))
  const pot1 = shuffleSeasonCupTeams(worldClubs, seed, 'legend', 201)
  const pot2 = shuffleSeasonCupTeams(legendClubs.slice(0, 4), seed, 'legend', 202)
  const pot3 = shuffleSeasonCupTeams(legendClubs.slice(4, 8), seed, 'legend', 203)
  const pot4 = shuffleSeasonCupTeams(legendClubs.slice(8, 12), seed, 'legend', 204)
  return LEGEND_GROUP_NAMES.map((name, index) => {
    const raw = [pot1[index], pot2[index], pot3[index], pot4[index]].filter((id): id is string => !!id)
    const teamIds = shuffleSeasonCupTeams(raw, seed, 'legend', 210 + index)
    return { index, name, teamIds, table: teamIds.map(emptyCupRow) }
  })
}

function makeLegendGroupRound(cup: Pick<SeasonCup, 'id' | 'dates' | 'groups'>, seasonIndex: number, roundNum: number): SeasonCupRound {
  const kickoffAt = cup.dates[roundNum - 1]
  const pairings = GROUP_PAIRINGS[roundNum - 1]
  const fixtures: SeasonCupFixture[] = []
  let seq = 1
  for (const group of cup.groups ?? []) {
    for (const [homeSlot, awaySlot] of pairings) {
      fixtures.push({
        id: `sc-${seasonIndex}-${cup.id}-${roundNum}-${seq++}`,
        cupId: cup.id,
        round: roundNum,
        stage: 'group',
        groupIndex: group.index,
        homeId: group.teamIds[homeSlot],
        awayId: group.teamIds[awaySlot],
        kickoffAt,
        played: false,
      })
    }
  }
  return { round: roundNum, kickoffAt, stage: 'group', byes: [], fixtures }
}

/** 按全部已公布小组赛重算并排序每组积分榜（幂等）。 */
export function refreshSeasonCupGroups(cup: SeasonCup, seed: number): void {
  if (!cup.groups?.length) return
  const allGroupFixtures = cup.rounds
    .filter(round => round.stage === 'group')
    .flatMap(round => round.fixtures)
  for (const group of cup.groups) {
    const rows = group.teamIds.map(emptyCupRow)
    const groupFixtures = allGroupFixtures.filter(fixture => fixture.groupIndex === group.index)
    for (const fixture of groupFixtures) {
      if (fixture.played && fixture.score) updateCupTable(rows, fixture.homeId, fixture.awayId, fixture.score)
    }
    group.table = sortCupTable(
      { index: group.index, teamIds: group.teamIds, fixtures: groupFixtures, table: rows },
      splitSeed(seed, `season-cup-${cup.id}-group-${group.index}`),
    )
  }
}

function makeFixedKnockoutRound(
  cup: Pick<SeasonCup, 'id' | 'dates'>,
  seasonIndex: number,
  roundNum: number,
  entries: readonly { homeId: string; awayId: string; aggregateOffset?: { home: number; away: number } }[],
  leg?: 1 | 2,
): SeasonCupRound {
  const kickoffAt = cup.dates[roundNum - 1]
  const fixtures: SeasonCupFixture[] = entries.map((entry, index) => ({
    id: `sc-${seasonIndex}-${cup.id}-${roundNum}-${index + 1}`,
    cupId: cup.id,
    round: roundNum,
    stage: 'knockout',
    ...(leg ? { leg } : {}),
    ...(entry.aggregateOffset ? { aggregateOffset: { ...entry.aggregateOffset } } : {}),
    homeId: entry.homeId,
    awayId: entry.awayId,
    kickoffAt,
    played: false,
  }))
  return { round: roundNum, kickoffAt, stage: 'knockout', ...(leg ? { leg } : {}), byes: [], fixtures }
}

/** 只生成当前轮；未来对阵等待前轮公布后再生成。 */
function makeRound(cup: Pick<SeasonCup, 'id' | 'dates'>, seasonIndex: number, number: number, players: string[], seed: number): SeasonCupRound {
  const power = 2 ** Math.floor(Math.log2(players.length))
  const byeCount = players.length === power ? 0 : 2 * power - players.length
  const byes = players.slice(0, byeCount)
  const kickoffAt = cup.dates[number - 1]
  const playing = shuffleSeasonCupTeams(players.slice(byeCount), seed, cup.id, number)
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

/** 收集未来可用的常规杯赛中点槽位（北京时间 12:00 / 20:00 优先，不够时启用 16:00，再按需补 08:00 等），跳过已被占用的时刻。 */
function collectCupSlots(
  world: WorldState,
  fromRound: number,
  now: number,
  totalNeeded: number,
  excluded: ReadonlySet<number> = new Set(),
): number[] {
  const division = world.divisions[0]
  if (!division || totalNeeded <= 0) return []
  const end = postseasonStartAt(world.seasonStartedAt, world.clockShift)
  const pick = (allowedHours: ReadonlySet<number>): number[] => {
    const slots: number[] = []
    for (let round = fromRound; round <= 38; round++) {
      const leagueAt = seasonRoundKickoff(division, round)
      const localHour = new Date(leagueAt + 8 * HOUR).getUTCHours()
      const cupAt = leagueAt + CUP_OFFSET
      if (!allowedHours.has(localHour) || cupAt < now + MIN_CUP_LEAD || cupAt >= end || excluded.has(cupAt)) continue
      const peers = world.divisions.flatMap(item => item.fixtures.filter(fixture => fixture.round === round))
      if (!peers.length || peers.some(fixture => fixture.kickoffAt !== leagueAt)) continue
      slots.push(cupAt)
    }
    return slots
  }
  const primary = pick(PRIMARY_LEAGUE_BJT_HOURS)
  if (primary.length >= totalNeeded) return primary.slice(0, totalNeeded)
  const fallback = pick(FALLBACK_LEAGUE_BJT_HOURS)
  if (fallback.length >= totalNeeded) return fallback.slice(0, totalNeeded)
  // 优先保留全部 12:00 / 16:00 / 20:00 黄金/午后档，仅按需从 08:00 等扩展档补足缺口。
  const merged = [...fallback]
  const used = new Set(merged)
  for (const tier of EXTRA_LEAGUE_BJT_HOUR_TIERS) {
    if (merged.length >= totalNeeded) break
    for (const slot of pick(tier)) {
      if (used.has(slot)) continue
      used.add(slot)
      merged.push(slot)
      if (merged.length >= totalNeeded) break
    }
  }
  return merged.sort((a, b) => a - b)
}

/**
 * 收集传奇杯槽位：从第 5 轮之后一直延伸到赛季结束前 2 小时（横跨常规赛与赛后休整期，决赛在赛季末压轴举行），
 * 并按时间均匀拉开各轮间隔，优先全部使用北京时间 12:00 / 16:00 / 20:00 黄金档。
 */
function collectLegendCupSlots(
  world: WorldState,
  now: number,
  totalNeeded: number,
  excluded: ReadonlySet<number> = new Set(),
): number[] {
  const division = world.divisions[0]
  if (!division || totalNeeded <= 0) return []
  const round5At = seasonRoundKickoff(division, LEGEND_CUP_START_ROUND)
  const minAt = Math.max(round5At + CUP_OFFSET, now + MIN_CUP_LEAD)
  const maxAt = seasonEndAt(world.seasonStartedAt, world.clockShift) - LEGEND_CUP_END_BUFFER
  if (minAt > maxAt) return []
  // 所有与联赛中点（每 4 小时一档）对齐的候选时刻，顺延覆盖赛后休整期直到赛季结束前 2 小时。
  const allCandidates: number[] = []
  for (let t = round5At + CUP_OFFSET; t <= maxAt; t += ROUND_INTERVAL_MS) {
    if (t >= minAt && !excluded.has(t)) allCandidates.push(t)
  }
  const byCupBjtHours = (hours: ReadonlySet<number>) =>
    allCandidates.filter(t => hours.has(new Date(t + 8 * HOUR).getUTCHours()))
  const golden = byCupBjtHours(new Set([12, 16, 20]))
  let pool = golden
  if (pool.length < totalNeeded) {
    const merged = [...golden]
    const seen = new Set(merged)
    for (const extraHour of [8, 0, 4]) {
      if (merged.length >= totalNeeded) break
      for (const t of byCupBjtHours(new Set([extraHour]))) {
        if (seen.has(t)) continue
        seen.add(t)
        merged.push(t)
      }
    }
    pool = merged.sort((a, b) => a - b)
  }
  if (pool.length < totalNeeded) return []
  if (totalNeeded === 1) return [pool[pool.length - 1]]
  // 从首档（第 5 轮后）到末档（赛季末）按时间等距挑出 totalNeeded 档，最大化每轮恢复间隔。
  const first = pool[0], last = pool[pool.length - 1]
  const picked: number[] = []
  const used = new Set<number>()
  for (let i = 0; i < totalNeeded; i++) {
    const target = first + (i * (last - first)) / (totalNeeded - 1)
    let best = -1, bestDist = Infinity
    for (const slot of pool) {
      if (used.has(slot)) continue
      const dist = Math.abs(slot - target)
      if (dist < bestDist) { bestDist = dist; best = slot }
    }
    if (best < 0) return []
    used.add(best)
    picked.push(best)
  }
  return picked.sort((a, b) => a - b)
}

function splitCupSlots(
  slots: readonly number[],
  tierRounds: number,
  crossRounds: number,
): { tierDays: number[]; crossDays: number[] } {
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

/**
 * 生成完整方案但不修改世界；支持两阶段规划：
 * 1) 第 2 赛季起（存在上赛季冠联前 4）：开季即可提前规划传奇杯，从第 5 轮后开赛并延续至赛季末；
 * 2) 第 6 轮全部公布后：补齐社区杯、联盟杯、冠军杯、星联杯 4 项杯赛，严格避开传奇杯已占档期。
 */
export function planSeasonCups(world: WorldState, seed: number, now: number): SeasonCups | undefined {
  if (!Number.isFinite(now)) return undefined
  const existing = world.seasonCups?.seasonIndex === world.seasonIndex ? world.seasonCups : undefined
  const hasCore = !!existing && CORE_SEASON_CUP_IDS.every(id => existing.cups.some(cup => cup.id === id))
  const existingLegend = existing?.cups.find(cup => cup.id === 'legend')
  if (hasCore) return undefined

  const prevTop4 = previousChampionsTop4(world)
  const canHaveLegend = prevTop4.length === 4
  const readyForCore = completedWorldRound(world) >= SEASON_CUP_QUALIFICATION_ROUND

  // 第 6 轮前：仅当本季具备传奇杯资格且尚未生成传奇杯时，先单独规划传奇杯（第 5 轮起至赛季末）。
  if (!readyForCore) {
    if (!canHaveLegend || existingLegend) return undefined
    const legendEntrants = [...prevTop4, ...LEGEND_CUP_TEAM_IDS]
    if (legendEntrants.length !== 16 || new Set(legendEntrants).size !== 16) return undefined
    const legendDates = collectLegendCupSlots(world, now, LEGEND_TOTAL_ROUNDS)
    if (legendDates.length < LEGEND_TOTAL_ROUNDS) return undefined
    const groups = buildLegendGroups(legendEntrants, seed)
    const legendCup: SeasonCup = { id: 'legend', name: SEASON_CUP_NAMES.legend, entrants: legendEntrants, dates: legendDates, rounds: [], groups }
    legendCup.rounds.push(makeLegendGroupRound(legendCup, world.seasonIndex, 1))
    return { version: 1, seasonIndex: world.seasonIndex, qualificationRound: 0, createdAt: now, drawSeed: seed, delayedLeagueRounds: [], cups: [legendCup] }
  }

  // 第 6 轮后：规划 4 项常规杯赛；若本季应有传奇杯且尚未提前规划，则一并规划（同样延展至赛季末）。
  const qualificationRound = SEASON_CUP_QUALIFICATION_ROUND
  const entrants = seasonCupEntrants(world, qualificationRound)
  if (CORE_SEASON_CUP_IDS.some(id => entrants[id].length < 2 || new Set(entrants[id]).size !== entrants[id].length)) return undefined

  let legendCup = existingLegend ? structuredClone(existingLegend) : undefined
  if (!legendCup && canHaveLegend && entrants.legend.length === 16 && new Set(entrants.legend).size === 16) {
    const legendDates = collectLegendCupSlots(world, now, LEGEND_TOTAL_ROUNDS)
    if (legendDates.length < LEGEND_TOTAL_ROUNDS) return undefined
    const groups = buildLegendGroups(entrants.legend, existing?.drawSeed ?? seed)
    legendCup = { id: 'legend', name: SEASON_CUP_NAMES.legend, entrants: entrants.legend, dates: legendDates, rounds: [], groups }
    legendCup.rounds.push(makeLegendGroupRound(legendCup, world.seasonIndex, 1))
  }

  const tierRounds = Math.max(roundCount(entrants.community.length), roundCount(entrants.league.length), roundCount(entrants.champions.length))
  const crossRounds = roundCount(entrants.cross.length)
  const coreSlots = tierRounds + crossRounds
  const reservedByLegend = new Set(legendCup?.dates ?? [])
  const selected = collectCupSlots(world, qualificationRound + 1, now, coreSlots, reservedByLegend)
  if (selected.length < coreSlots) return undefined
  const { tierDays, crossDays } = splitCupSlots(selected, tierRounds, crossRounds)
  const drawSeed = existing?.drawSeed ?? seed
  const coreCups = CORE_SEASON_CUP_IDS.map(id => {
    const pool = id === 'cross' ? crossDays : tierDays
    const dates = pool.slice(0, roundCount(entrants[id].length))
    const cup: SeasonCup = { id, name: SEASON_CUP_NAMES[id], entrants: entrants[id], dates, rounds: [] }
    cup.rounds.push(makeRound(cup, world.seasonIndex, 1, cup.entrants, drawSeed))
    return cup
  })
  const cups = legendCup ? [...coreCups, legendCup] : coreCups
  return { version: 1, seasonIndex: world.seasonIndex, qualificationRound, createdAt: existing?.createdAt ?? now, drawSeed, ...(existing?.aiRewardVersion ? { aiRewardVersion: existing.aiRewardVersion } : {}), delayedLeagueRounds: [], cups }
}

/** 提交杯赛计划；允许从“仅提前规划传奇杯”安全合并补齐第 6 轮后的 4 项常规杯赛，但绝不覆盖已规划完成的常规杯赛。 */
export function applySeasonCupPlan(world: WorldState, plan: SeasonCups): void {
  if (plan.seasonIndex !== world.seasonIndex) throw new Error('杯赛计划与赛季不一致')
  if (world.seasonCups) {
    const existingHasCore = CORE_SEASON_CUP_IDS.every(id => world.seasonCups!.cups.some(cup => cup.id === id))
    if (existingHasCore) throw new Error('杯赛计划与赛季不一致')
  }
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
  const tierCups = cups.cups.filter(cup => cup.id !== 'cross' && cup.id !== 'legend')
  const crossCup = cups.cups.find(cup => cup.id === 'cross')
  const legendCup = cups.cups.find(cup => cup.id === 'legend')
  const tierNeed = Math.max(0, ...tierCups.map(cup => cup.dates.length - doneOf(cup)))
  const crossNeed = crossCup ? Math.max(0, crossCup.dates.length - doneOf(crossCup)) : 0
  const legendNeed = legendCup ? Math.max(0, legendCup.dates.length - doneOf(legendCup)) : 0
  if (tierNeed + crossNeed + legendNeed <= 0) return false

  let legendDays: number[] = []
  if (legendCup && legendNeed > 0) {
    const legendDoneDates = new Set(legendCup.dates.slice(0, doneOf(legendCup)))
    legendDays = collectLegendCupSlots(world, now, legendNeed, legendDoneDates)
    if (legendDays.length < legendNeed) return false
  }
  const reservedByLegend = new Set([
    ...(legendCup ? legendCup.dates.slice(0, doneOf(legendCup)) : []),
    ...legendDays,
  ])
  const coreNeed = tierNeed + crossNeed
  let tierDays: number[] = []
  let crossDays: number[] = []
  if (coreNeed > 0) {
    const slots = collectCupSlots(world, Math.max(SEASON_CUP_QUALIFICATION_ROUND + 1, completedWorldRound(world) + 1), now, coreNeed, reservedByLegend)
    if (slots.length < coreNeed) return false
    const split = splitCupSlots(slots, tierNeed, crossNeed)
    tierDays = split.tierDays
    crossDays = split.crossDays
  }
  for (const cup of cups.cups) {
    const done = doneOf(cup)
    const pool = cup.id === 'cross' ? crossDays : cup.id === 'legend' ? legendDays : tierDays
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
  if (!current) return
  if (cup.groups?.length) {
    if (current.stage === 'group') {
      if (current.fixtures.some(fixture => !fixture.played || !fixture.score)) return
      refreshSeasonCupGroups(cup, seed)
      if (!cup.dates[current.round]) throw new Error('杯赛缺少下一轮时间')
      if (current.round < LEGEND_GROUP_ROUNDS) {
        cup.rounds.push(makeLegendGroupRound(cup, seasonIndex, current.round + 1))
        return
      }
      // 小组赛全部结束：每组前 2 晋级 8 强两回合淘汰赛；首回合小组第 2 先主场，小组第 1 享次回合主场优势
      const qfLeg1 = LEGEND_QF_SLOTS.map(([g1, r1, g2, r2]) => ({
        homeId: cup.groups![g2].table[r2].teamId,
        awayId: cup.groups![g1].table[r1].teamId,
      }))
      cup.rounds.push(makeFixedKnockoutRound(cup, seasonIndex, current.round + 1, qfLeg1, 1))
      return
    }
    if (current.leg === 1) {
      if (current.fixtures.some(fixture => !fixture.played || !fixture.score)) return
      if (!cup.dates[current.round]) throw new Error('杯赛缺少下一轮时间')
      // 两回合次回合主客对调，并按本场主客方向写入首回合进球偏移（总比分平局次回合点球，不计客场进球加权）
      const leg2 = current.fixtures.map(fixture => ({
        homeId: fixture.awayId,
        awayId: fixture.homeId,
        aggregateOffset: { home: fixture.score!.away, away: fixture.score!.home },
      }))
      cup.rounds.push(makeFixedKnockoutRound(cup, seasonIndex, current.round + 1, leg2, 2))
      return
    }
    if (current.fixtures.some(fixture => !fixture.played || !fixture.winnerId)) return
    const winners = current.fixtures.map(fixture => fixture.winnerId!)
    if (winners.length === 1) { cup.championId = winners[0]; return }
    if (!cup.dates[current.round]) throw new Error('杯赛缺少下一轮时间')
    const pairs: { homeId: string; awayId: string }[] = []
    for (let i = 0; i < winners.length; i += 2) pairs.push({ homeId: winners[i], awayId: winners[i + 1] })
    // 决赛单场决胜（无 leg）；半决赛及以上多场轮次踢主客场两回合（先生成首回合 leg: 1）
    const nextLeg = pairs.length === 1 ? undefined : 1
    cup.rounds.push(makeFixedKnockoutRound(cup, seasonIndex, current.round + 1, pairs, nextLeg))
    return
  }
  if (current.fixtures.some(fixture => !fixture.played || !fixture.winnerId)) return
  const winners = [...current.byes, ...current.fixtures.map(fixture => fixture.winnerId!)]
  if (winners.length === 1) { cup.championId = winners[0]; return }
  if (!cup.dates[current.round]) throw new Error('杯赛缺少下一轮时间')
  cup.rounds.push(makeRound(cup, seasonIndex, current.round + 1, winners, seed))
}
