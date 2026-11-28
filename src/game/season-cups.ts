import type { CupTableRow, GameState, SeasonState, SeasonTableRow, TierId, TrophyRecord, WorldState } from './types.ts'
import { computeWorldTable, promotionSpotCount } from './world.ts'
import { emptyCupRow, sortCupTable, updateCupTable } from './cup-table.ts'
import { derivedRng, splitSeed } from './rng.ts'
import { GAME_DAY_MS, HOUR_MS, ROUND_INTERVAL_MS, kickoffAtForRound, postseasonStartAt, roundsKickedOff, seasonEndAt } from './calendar.ts'
import { LEGEND_CUP_TEAM_IDS, isLegendCupTeamId } from './data/legend-cup-teams.ts'

export type SeasonCupId = 'community' | 'league' | 'champions' | 'cross' | 'legend' | 'promotion'
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
  /** 含小组赛赛制（传奇杯 / 升级杯）的分组与积分榜；纯淘汰赛缺省。 */
  groups?: SeasonCupGroup[]
  /** 升级杯已确定的升级球队（至多 3 支：A/B 组第 1 + 小组第二附加赛胜者）。 */
  promotedIds?: string[]
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
const LEGEND_CUP_END_BUFFER = 4 * HOUR
export const SEASON_CUP_NAMES: Record<SeasonCupId, string> = { community: '社区杯', league: '联盟杯', champions: '冠军杯', cross: '星联杯', legend: '传奇杯', promotion: '升级杯' }
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

/** 该场赛季杯赛是否发放本轮参赛金：升级杯不发参赛金（奖励为升级资格），小组赛不发，两回合淘汰赛仅在首回合发一次，单场淘汰赛照发。 */
export function paysSeasonCupAppearanceGold(fixture: Pick<SeasonCupFixture, 'stage' | 'leg'> & { cupId?: SeasonCupId }): boolean {
  return fixture.cupId !== 'promotion' && fixture.stage !== 'group' && fixture.leg !== 2
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

/** 跨赛区纯按总积分榜排名（方案 C：二级超过 4 个分区时的社区杯资格排名）。 */
function compareCrossZonePoints(a: Standing, b: Standing): number {
  return b.row.points - a.row.points
    || (b.row.gf - b.row.ga) - (a.row.gf - a.row.ga)
    || b.row.gf - a.row.gf
    || a.id.localeCompare(b.id, 'en')
}

export function seasonCupEntrants(world: WorldState, round: number): Record<SeasonCupId, string[]> {
  const rows = standings(world, round)
  const d1Count = world.divisions.filter(d => d.tier === 'division1').length
  const d2Count = world.divisions.filter(d => d.tier === 'division2').length
  const champions = rows.filter(row => row.tier === 'champions').sort(compareStanding)
  // 联盟杯：单区一级全员 20 队；双区一级各区前 16 组成 32 强（固定 5 轮）。
  const league = (d1Count >= 2
    ? rows.filter(row => row.tier === 'division1' && row.rank <= 16)
    : rows.filter(row => row.tier === 'division1')
  ).sort(compareStanding)
  // 社区杯：≤4 个二级赛区各区取前 8；超过 4 个二级赛区（方案 C）全部二级球队一起按总积分排前 32 参赛。
  const community = d2Count > 4
    ? rows.filter(row => row.tier === 'division2').sort(compareCrossZonePoints).slice(0, 32)
    : rows.filter(row => row.tier === 'division2' && row.rank <= 8).sort(compareStanding)
  // 32 队固定席位：顶级全员 20 队 + 一级 8 队（单区前 8 / 双区各前 4）+ 二级前 4。
  const d1Cross = d1Count >= 2
    ? rows.filter(row => row.tier === 'division1' && row.rank <= 4).sort(compareStanding).slice(0, 8)
    : league.filter(row => row.rank <= 8)
  const lower = rows.filter(row => row.tier === 'division2').sort(compareStanding)
  const cross = [...champions, ...d1Cross, ...lower.slice(0, 4)]
  const ids = (list: Standing[]) => list.map(row => row.id)
  const prevTop4 = previousChampionsTop4(world)
  const legend = prevTop4.length === 4 ? [...prevTop4, ...LEGEND_CUP_TEAM_IDS] : []
  return { community: ids(community), league: ids(league), champions: ids(champions), cross: ids(cross), legend, promotion: [] }
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

/** 为升级杯收集赛后 16 小时休整期内的开球时刻；优先固定整点档（10/12/14/16/18 点），若恢复较晚则顺延至剩余窗口内均分。 */
export function collectPromotionCupSlots(world: WorldState, now: number, totalRounds: number): number[] {
  if (totalRounds <= 0) return []
  const postStart = postseasonStartAt(world.seasonStartedAt, world.clockShift)
  const endAt = seasonEndAt(world.seasonStartedAt, world.clockShift)
  const idealOffsetsHours = totalRounds === 5
    ? [4, 6, 8, 10, 12]
    : totalRounds === 3
      ? [4, 8, 12]
      : Array.from({ length: totalRounds }, (_, i) => 4 + (totalRounds === 1 ? 4 : (8 * i) / (totalRounds - 1)))
  const ideal = idealOffsetsHours.map(h => postStart + Math.round(h * HOUR))
  const minLead = 40 * 60_000
  if (now + minLead <= ideal[0] && ideal[ideal.length - 1] <= endAt - HOUR) return ideal
  const grid = 30 * 60_000
  const first = Math.ceil((now + 45 * 60_000) / grid) * grid
  const last = endAt - HOUR
  if (first > last) return []
  if (totalRounds === 1) return [first]
  if (last - first < (totalRounds - 1) * HOUR) return []
  const slots: number[] = []
  for (let i = 0; i < totalRounds; i++) {
    const raw = first + ((last - first) * i) / (totalRounds - 1)
    let snapped = Math.round(raw / grid) * grid
    if (i > 0 && snapped <= slots[i - 1]) snapped = slots[i - 1] + grid
    if (snapped > last) return []
    slots.push(snapped)
  }
  return slots
}

/**
 * 根据二级各赛区最终积分榜提取升级杯参赛队伍：
 * - 3 席模式（≤3 个二级区且一级单区）：每区第 1 轮空，第 2/3 名踢资格赛 → 2 组循环 + 亚军附加赛决出 3 席；
 * - 6 席模式（≥4 个二级区或一级双区）：凑齐精确 12 支小组赛球队 → A/B/C 3 组 × 4 队完整单循环 + 3 场跨组附加赛决出 6 席。
 */
export function promotionCupQualifiers(world: WorldState): {
  champions: string[]
  qualifierPairs: { homeId: string; awayId: string }[]
  entrants: string[]
  spots: number
} {
  const names = new Map(world.clubs.map(club => [club.id, club.name]))
  const d2Zones = world.divisions
    .filter(division => division.tier === 'division2')
    .sort((a, b) => (a.divisionId ?? '').localeCompare(b.divisionId ?? ''))
  const spots = promotionSpotCount(world)
  const champions: string[] = []
  const qualifierPairs: { homeId: string; awayId: string }[] = []
  const entrants: string[] = []
  const tables = d2Zones.map(division => (
    division.clubIds?.length
      ? computeWorldTable(division.clubIds, division.fixtures, names)
      : division.table
  ))

  if (spots === 6 && d2Zones.length >= 4) {
    const compareRow = (a: SeasonTableRow, b: SeasonTableRow) =>
      b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.teamId.localeCompare(b.teamId, 'en')
    const zCount = d2Zones.length
    if (zCount === 4) {
      // 4 区：每区前 2 直通（8 队），第 3/4 名踢资格赛（4 场）→ 12 队进 3 组
      for (const table of tables) {
        if (table[0]) champions.push(table[0].teamId)
        if (table[1]) champions.push(table[1].teamId)
        if (table[2] && table[3]) qualifierPairs.push({ homeId: table[2].teamId, awayId: table[3].teamId })
      }
    } else if (zCount === 5) {
      // 5 区：每区前 2 直通（10 队），5 个第 3 名取成绩最好 4 队踢 2 场资格赛 → 12 队
      const thirds: SeasonTableRow[] = []
      for (const table of tables) {
        if (table[0]) champions.push(table[0].teamId)
        if (table[1]) champions.push(table[1].teamId)
        if (table[2]) thirds.push(table[2])
      }
      thirds.sort(compareRow)
      if (thirds.length >= 4) {
        qualifierPairs.push(
          { homeId: thirds[0].teamId, awayId: thirds[3].teamId },
          { homeId: thirds[1].teamId, awayId: thirds[2].teamId },
        )
      }
    } else if (zCount === 6) {
      // 6 区：每区第 1 直通（6 队），第 2/3 名踢资格赛（6 场）→ 12 队
      for (const table of tables) {
        if (table[0]) champions.push(table[0].teamId)
        if (table[1] && table[2]) qualifierPairs.push({ homeId: table[1].teamId, awayId: table[2].teamId })
      }
    } else if (zCount < 12) {
      // 7–11 区：各区第 1 直通，剩余 (12 - N) 席由各区成绩最好第 2 名踢单场资格赛产生 → 12 队
      const seconds: SeasonTableRow[] = []
      for (const table of tables) {
        if (table[0]) champions.push(table[0].teamId)
        if (table[1]) seconds.push(table[1])
      }
      seconds.sort(compareRow)
      const needPairs = Math.max(0, 12 - champions.length)
      const pool = seconds.slice(0, needPairs * 2)
      for (let i = 0; i < needPairs && i * 2 + 1 < pool.length; i++) {
        qualifierPairs.push({ homeId: pool[i].teamId, awayId: pool[pool.length - 1 - i].teamId })
      }
    } else {
      // 12+ 区：成绩最好的区冠军轮空，其余区冠军踢资格赛凑精确 12 队
      const firsts = tables.map(t => t[0]).filter((row): row is SeasonTableRow => !!row).sort(compareRow)
      const byeCount = Math.max(0, 24 - firsts.length)
      champions.push(...firsts.slice(0, byeCount).map(r => r.teamId))
      const needPairs = 12 - byeCount
      const pool = firsts.slice(byeCount, byeCount + needPairs * 2)
      for (let i = 0; i < needPairs && i * 2 + 1 < pool.length; i++) {
        qualifierPairs.push({ homeId: pool[i].teamId, awayId: pool[pool.length - 1 - i].teamId })
      }
    }
    entrants.push(...champions, ...qualifierPairs.flatMap(p => [p.homeId, p.awayId]))
    return { champions, qualifierPairs, entrants, spots }
  }

  for (const table of tables) {
    const top3 = table.slice(0, 3).map(row => row.teamId)
    if (top3[0]) {
      champions.push(top3[0])
      entrants.push(top3[0])
    }
    if (top3[1] && top3[2]) {
      qualifierPairs.push({ homeId: top3[1], awayId: top3[2] })
      entrants.push(top3[1], top3[2])
    } else if (top3[1]) {
      champions.push(top3[1])
      entrants.push(top3[1])
    }
  }
  return { champions, qualifierPairs, entrants, spots }
}

function buildPromotionGroups(qualified: readonly string[], seed: number): SeasonCupGroup[] {
  const shuffled = shuffleSeasonCupTeams(qualified, seed, 'promotion', 201)
  // 12 队（6 升级名额模式）：严格拆成 A / B / C 三个 4 队小组，3 轮打满完整单循环！
  if (shuffled.length === 12) {
    const names = ['A 组', 'B 组', 'C 组'] as const
    return [0, 1, 2].map((index) => {
      const teamIds = shuffled.slice(index * 4, index * 4 + 4)
      return { index, name: names[index], teamIds, table: teamIds.map(emptyCupRow) }
    })
  }
  const half = Math.ceil(shuffled.length / 2)
  const lists = [shuffled.slice(0, half), shuffled.slice(half)].filter(list => list.length > 0)
  return lists.map((teamIds, index) => ({
    index,
    name: index === 0 ? 'A 组' : 'B 组',
    teamIds,
    table: teamIds.map(emptyCupRow),
  }))
}

/** 升级杯小组赛轮次配对（支持 2 / 3 / 4 / 5+ 队每组，确保每队每轮最多 1 场且 3 队组各 1 主 1 客 1 轮空）。 */
function makePromotionGroupRound(
  cup: Pick<SeasonCup, 'id' | 'dates' | 'groups'>,
  seasonIndex: number,
  roundNum: number,
  groupRoundIndex: number,
): SeasonCupRound {
  const kickoffAt = cup.dates[roundNum - 1]
  const fixtures: SeasonCupFixture[] = []
  const byes: string[] = []
  let seq = 1
  for (const group of cup.groups ?? []) {
    const teams = group.teamIds
    if (teams.length === 2) {
      if (groupRoundIndex === 0) {
        fixtures.push({
          id: `sc-${seasonIndex}-${cup.id}-${roundNum}-${seq++}`,
          cupId: cup.id,
          round: roundNum,
          stage: 'group',
          groupIndex: group.index,
          homeId: teams[0],
          awayId: teams[1],
          kickoffAt,
          played: false,
        })
      }
      continue
    }
    if (teams.length === 3) {
      // 3 队单循环：每队 1 主 1 客 1 轮空
      const triples: readonly [number, number, number][] = [
        [1, 2, 0], // B vs C, A bye
        [2, 0, 1], // C vs A, B bye
        [0, 1, 2], // A vs B, C bye
      ]
      const [h, a, byeIdx] = triples[groupRoundIndex % 3]
      byes.push(teams[byeIdx])
      fixtures.push({
        id: `sc-${seasonIndex}-${cup.id}-${roundNum}-${seq++}`,
        cupId: cup.id,
        round: roundNum,
        stage: 'group',
        groupIndex: group.index,
        homeId: teams[h],
        awayId: teams[a],
        kickoffAt,
        played: false,
      })
      continue
    }
    if (teams.length === 4) {
      const pairings = GROUP_PAIRINGS[groupRoundIndex % GROUP_PAIRINGS.length]
      for (const [homeSlot, awaySlot] of pairings) {
        fixtures.push({
          id: `sc-${seasonIndex}-${cup.id}-${roundNum}-${seq++}`,
          cupId: cup.id,
          round: roundNum,
          stage: 'group',
          groupIndex: group.index,
          homeId: teams[homeSlot],
          awayId: teams[awaySlot],
          kickoffAt,
          played: false,
        })
      }
      continue
    }
    // 5+ 队采用圆桌轮转法前 3 轮（瑞士轮节奏，每队每轮最多 1 场不重复对阵）
    const padded: (string | null)[] = teams.length % 2 === 0 ? [...teams] : [...teams, null]
    const n = padded.length
    const rotated = [padded[0], ...padded.slice(1)]
    for (let step = 0; step < groupRoundIndex; step++) {
      const last = rotated.pop()!
      rotated.splice(1, 0, last)
    }
    for (let i = 0; i < n / 2; i++) {
      const a = rotated[i]
      const b = rotated[n - 1 - i]
      if (!a && b) { byes.push(b); continue }
      if (!b && a) { byes.push(a); continue }
      if (!a || !b) continue
      const swap = (groupRoundIndex + i) % 2 === 1
      fixtures.push({
        id: `sc-${seasonIndex}-${cup.id}-${roundNum}-${seq++}`,
        cupId: cup.id,
        round: roundNum,
        stage: 'group',
        groupIndex: group.index,
        homeId: swap ? b : a,
        awayId: swap ? a : b,
        kickoffAt,
        played: false,
      })
    }
  }
  return { round: roundNum, kickoffAt, stage: 'group', byes, fixtures }
}

/** 常规赛 38 轮全部公布后，在赛后 16 小时休整期内排期正式实时升级杯。 */
export function planPromotionCup(world: WorldState, _seed: number, now: number): SeasonCup | undefined {
  if (!Number.isFinite(now)) return undefined
  if (completedWorldRound(world) < 38) return undefined
  if (world.seasonCups?.seasonIndex === world.seasonIndex && world.seasonCups.cups.some(cup => cup.id === 'promotion')) {
    return undefined
  }
  const { champions, qualifierPairs, entrants, spots } = promotionCupQualifiers(world)
  if (entrants.length < 4) return undefined
  const qualifiedCount = champions.length + qualifierPairs.length
  const groupSize = qualifiedCount === 12 ? 4 : Math.ceil(qualifiedCount / 2)
  const groupRounds = groupSize <= 2 ? 1 : 3
  const hasQualifierRound = qualifierPairs.length > 0
  const totalRounds = (hasQualifierRound ? 1 : 0) + groupRounds + 1
  const dates = collectPromotionCupSlots(world, now, totalRounds)
  if (dates.length < totalRounds) return undefined
  const kickoffAt = dates[0]
  if (!hasQualifierRound) {
    const groups = buildPromotionGroups(champions, _seed)
    const cup: SeasonCup = { id: 'promotion', name: SEASON_CUP_NAMES.promotion, entrants, dates, rounds: [], groups, promotedIds: [] }
    cup.rounds.push(makePromotionGroupRound(cup, world.seasonIndex, 1, 0))
    return cup
  }
  const round1: SeasonCupRound = {
    round: 1,
    kickoffAt,
    stage: 'knockout',
    byes: champions,
    fixtures: qualifierPairs.map((pair, index) => ({
      id: `sc-${world.seasonIndex}-promotion-1-${index + 1}`,
      cupId: 'promotion',
      round: 1,
      stage: 'knockout',
      homeId: pair.homeId,
      awayId: pair.awayId,
      kickoffAt,
      played: false,
    })),
  }
  void spots
  return {
    id: 'promotion',
    name: SEASON_CUP_NAMES.promotion,
    entrants,
    dates,
    rounds: [round1],
    promotedIds: [],
  }
}

/** 把实时升级杯状态同步回 world.promotionPlayoff，供换季升降级与世界页读取。 */
export function syncPromotionPlayoffFromCup(world: WorldState): boolean {
  const cup = world.seasonCups?.seasonIndex === world.seasonIndex
    ? world.seasonCups.cups.find(item => item.id === 'promotion')
    : undefined
  if (!cup) return false
  const matches = cup.rounds.flatMap(round => round.fixtures.map(fixture => ({
    id: fixture.id,
    stage: (round.round === 1 ? 'qualifier' : round.stage === 'group' ? 'group' : 'final') as 'qualifier' | 'group' | 'final',
    homeId: fixture.homeId,
    awayId: fixture.awayId,
    ...(fixture.played && fixture.score ? { score: { ...fixture.score } } : {}),
    ...(fixture.played && fixture.shootout ? { shootout: { ...fixture.shootout } } : {}),
  })))
  const groups = cup.groups?.map(group =>
    cup.rounds
      .filter(round => round.stage === 'group')
      .flatMap(round => round.fixtures)
      .filter(fixture => fixture.groupIndex === group.index)
      .map(fixture => fixture.id),
  )
  const finalRound = cup.groups?.length ? cup.rounds.find(round => round.round > 1 && round.stage === 'knockout') : undefined
  const runnerUps = finalRound?.fixtures.length ? finalRound.fixtures.flatMap(f => [f.homeId, f.awayId]) : undefined
  world.promotionPlayoff = {
    seasonIndex: world.seasonIndex,
    teams: [...cup.entrants],
    matches,
    promoted: [...(cup.promotedIds ?? [])],
    finished: !!cup.championId,
    ...(groups?.length ? { groups } : {}),
    ...(runnerUps?.length ? { runnerUps } : {}),
  }
  return true
}

/** 判断当前赛季是否可以滚入下赛季：常规赛全部完赛，且已到休整结束时刻，或实时升级杯（及本季其余杯赛）已全部完赛公布。 */
export function isSeasonRolloverReady(world: WorldState, now: number): boolean {
  if (!world.divisions.length) return false
  if (world.divisions.some((division) => division.fixtures.some((fixture) => !fixture.played))) return false
  if (now >= seasonEndAt(world.seasonStartedAt, world.clockShift)) return true
  const cups = world.seasonCups?.seasonIndex === world.seasonIndex ? world.seasonCups.cups : null
  if (!cups) return false
  const promotion = cups.find((cup) => cup.id === 'promotion')
  if (!promotion || !promotion.championId) return false
  return cups.every((cup) => !!cup.championId && cup.rounds.every((round) => round.fixtures.every((fixture) => fixture.played)))
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
  const tierCups = cups.cups.filter(cup => cup.id !== 'cross' && cup.id !== 'legend' && cup.id !== 'promotion')
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
    if (cup.id === 'promotion') continue
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
  if (cup.id === 'promotion') {
    if (!cup.groups?.length) {
      if (current.fixtures.some(fixture => !fixture.played || !fixture.winnerId)) return
      const qualified = [...current.byes, ...current.fixtures.map(fixture => fixture.winnerId!)]
      cup.groups = buildPromotionGroups(qualified, seed)
      if (!cup.dates[current.round]) throw new Error('升级杯缺少小组赛时间')
      cup.rounds.push(makePromotionGroupRound(cup, seasonIndex, current.round + 1, 0))
      return
    }
    if (current.stage === 'group') {
      if (current.fixtures.some(fixture => !fixture.played || !fixture.score)) return
      refreshSeasonCupGroups(cup, seed)
      const groupRoundsDone = cup.rounds.filter(round => round.stage === 'group').length
      const totalGroupRounds = Math.max(1, cup.dates.length - 2)
      if (!cup.dates[current.round]) throw new Error('升级杯缺少下一轮时间')
      if (groupRoundsDone < totalGroupRounds) {
        cup.rounds.push(makePromotionGroupRound(cup, seasonIndex, current.round + 1, groupRoundsDone))
        return
      }
      const winners = cup.groups.map(group => group.table[0]?.teamId).filter((id): id is string => !!id)
      const runnerUps = cup.groups.map(group => group.table[1]?.teamId).filter((id): id is string => !!id)
      const thirds = cup.groups.map(group => group.table[2]?.teamId).filter((id): id is string => !!id)
      cup.promotedIds = [...winners]
      if (cup.groups.length === 3 && runnerUps.length === 3 && thirds.length === 3) {
        // 6 席模式：3 个小组第 1 直接升级，A2 vs B3、B2 vs C3、C2 vs A3 三场单败决出最后 3 席
        cup.rounds.push(makeFixedKnockoutRound(cup, seasonIndex, current.round + 1, [
          { homeId: runnerUps[0], awayId: thirds[1] },
          { homeId: runnerUps[1], awayId: thirds[2] },
          { homeId: runnerUps[2], awayId: thirds[0] },
        ]))
      } else if (runnerUps.length >= 2) {
        cup.rounds.push(makeFixedKnockoutRound(cup, seasonIndex, current.round + 1, [{ homeId: runnerUps[0], awayId: runnerUps[1] }]))
      } else {
        const cap = cup.groups.length === 3 ? 6 : 3
        cup.promotedIds = [...new Set([...winners, ...runnerUps])].slice(0, cap)
        cup.championId = cup.promotedIds[0]
      }
      return
    }
    if (current.fixtures.some(fixture => !fixture.played || !fixture.winnerId)) return
    const playoffWinners = current.fixtures.map(fixture => fixture.winnerId!).filter((id): id is string => !!id)
    const basePromoted = cup.promotedIds?.length
      ? cup.promotedIds
      : (cup.groups ?? []).map(group => group.table[0]?.teamId).filter((id): id is string => !!id)
    const cap = (cup.groups?.length ?? 2) === 3 ? 6 : 3
    cup.promotedIds = [...new Set([...basePromoted, ...playoffWinners])].slice(0, cap)
    cup.championId = cup.promotedIds[0]
    return
  }
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

export type ClubCupHonors = {
  /** 传奇杯夺冠赛季号列表（升序，不含非正式联赛的特邀历史模板队）。 */
  legendSeasons: number[]
  /** 星联杯夺冠赛季号列表（升序，包含 S2 及后续赛季记录）。 */
  crossSeasons: number[]
}

const EMPTY_CLUB_CUP_HONORS: ClubCupHonors = Object.freeze({ legendSeasons: [], crossSeasons: [] }) as ClubCupHonors

function resolvedCupChampionId(cup: Pick<SeasonCup, 'championId' | 'rounds'>): string | undefined {
  if (cup.championId) return cup.championId
  const lastRound = cup.rounds.at(-1)
  if (lastRound?.fixtures.length === 1 && lastRound.fixtures[0].played) {
    return lastRound.fixtures[0].winnerId
  }
  return undefined
}

/**
 * 汇总每支正式俱乐部历史上获得的「传奇杯」与「星联杯」夺冠赛季列表：
 * - 传奇杯（legend）仅授予正常联赛俱乐部，严格排除特邀生成的临时传奇队（lcup-*）；
 * - 星联杯（cross）从 world.seasonCupHistory（含 S2）与当前 seasonCups 读取，并对玩家自己的 trophy 记录做兜底补全。
 */
export function clubCupHonorsMap(
  world: Pick<WorldState, 'clubs' | 'seasonCups' | 'seasonCupHistory'> | undefined,
  options: { ownClubId?: string; playerTrophies?: ReadonlyArray<Pick<TrophyRecord, 'cupId' | 'seasonIndex'>> } = {},
): Map<string, ClubCupHonors> {
  const result = new Map<string, { legend: Set<number>; cross: Set<number> }>()
  const leagueClubIds = new Set<string>(['player'])
  const ownIds = new Set<string>(['player'])
  for (const club of world?.clubs ?? []) {
    leagueClubIds.add(club.id)
    if (club.squadKey) leagueClubIds.add(club.squadKey)
    if (club.id === 'player' && club.squadKey) ownIds.add(club.squadKey)
  }
  if (options.ownClubId) ownIds.add(options.ownClubId)

  const recordToKey = (key: string, kind: 'legend' | 'cross', seasonIndex: number) => {
    let entry = result.get(key)
    if (!entry) {
      entry = { legend: new Set<number>(), cross: new Set<number>() }
      result.set(key, entry)
    }
    entry[kind].add(seasonIndex)
  }

  const addHonor = (rawClubId: string, kind: 'legend' | 'cross', seasonIndex: number) => {
    if (!rawClubId || !Number.isInteger(seasonIndex) || seasonIndex <= 0) return
    if (isLegendCupTeamId(rawClubId)) return
    if (kind === 'legend' && !leagueClubIds.has(rawClubId)) return
    if (ownIds.has(rawClubId)) {
      for (const alias of ownIds) recordToKey(alias, kind, seasonIndex)
    } else {
      recordToKey(rawClubId, kind, seasonIndex)
    }
  }

  const cupSeasons: SeasonCups[] = [
    ...(world?.seasonCupHistory ?? []),
    ...(world?.seasonCups ? [world.seasonCups] : []),
  ]
  for (const sc of cupSeasons) {
    if (!sc || !Number.isInteger(sc.seasonIndex)) continue
    for (const cup of sc.cups ?? []) {
      if (cup.id !== 'legend' && cup.id !== 'cross') continue
      const champId = resolvedCupChampionId(cup)
      if (champId) addHonor(champId, cup.id, sc.seasonIndex)
    }
  }

  for (const trophy of options.playerTrophies ?? []) {
    if (trophy.cupId === 'season-legend') addHonor('player', 'legend', trophy.seasonIndex)
    else if (trophy.cupId === 'season-cross') addHonor('player', 'cross', trophy.seasonIndex)
  }

  const finalized = new Map<string, ClubCupHonors>()
  for (const [id, sets] of result) {
    finalized.set(id, {
      legendSeasons: [...sets.legend].sort((a, b) => a - b),
      crossSeasons: [...sets.cross].sort((a, b) => a - b),
    })
  }
  return finalized
}

type HonorsCacheEntry = {
  seasonCups: WorldState['seasonCups']
  seasonCupHistory: WorldState['seasonCupHistory']
  clubsLength: number
  playerSquadKey?: string
  playerTrophies?: TrophyRecord[]
  ownClubId?: string
  map: Map<string, ClubCupHonors>
}

const worldHonorsCache = new WeakMap<WorldState, HonorsCacheEntry>()

export function clubCupHonorsFor(
  game: Pick<GameState, 'world' | 'pve'> | undefined,
  clubId: string,
  ownClubId?: string,
): ClubCupHonors {
  if (!clubId || isLegendCupTeamId(clubId)) return EMPTY_CLUB_CUP_HONORS
  const world = game?.world
  const trophies = game?.pve?.trophies
  if (!world) {
    if (!trophies?.length || clubId !== 'player') return EMPTY_CLUB_CUP_HONORS
    return clubCupHonorsMap(undefined, { ownClubId, playerTrophies: trophies }).get(clubId) ?? EMPTY_CLUB_CUP_HONORS
  }
  const squadKey = world.clubs.find(c => c.id === 'player')?.squadKey
  const cached = worldHonorsCache.get(world)
  if (
    cached &&
    cached.seasonCups === world.seasonCups &&
    cached.seasonCupHistory === world.seasonCupHistory &&
    cached.clubsLength === world.clubs.length &&
    cached.playerSquadKey === squadKey &&
    cached.playerTrophies === trophies &&
    cached.ownClubId === ownClubId
  ) {
    return cached.map.get(clubId) ?? EMPTY_CLUB_CUP_HONORS
  }
  const map = clubCupHonorsMap(world, { ownClubId, playerTrophies: trophies })
  worldHonorsCache.set(world, {
    seasonCups: world.seasonCups,
    seasonCupHistory: world.seasonCupHistory,
    clubsLength: world.clubs.length,
    playerSquadKey: squadKey,
    playerTrophies: trophies,
    ownClubId,
    map,
  })
  return map.get(clubId) ?? EMPTY_CLUB_CUP_HONORS
}

export type SeasonCupChampionEntry = {
  seasonIndex: number
  championId: string
}

/** 查询指定杯赛（不含升级杯）各赛季的历届冠军球队，按赛季倒序排列。 */
export function seasonCupChampions(
  game: Pick<GameState, 'world' | 'pve'> | undefined,
  cupId: SeasonCupId,
  ownId?: string,
): SeasonCupChampionEntry[] {
  if (cupId === 'promotion') return []
  const world = game?.world
  const bySeason = new Map<number, string>()
  const cupSeasons: SeasonCups[] = [
    ...(world?.seasonCupHistory ?? []),
    ...(world?.seasonCups ? [world.seasonCups] : []),
  ]
  for (const sc of cupSeasons) {
    if (!sc || !Number.isInteger(sc.seasonIndex) || sc.seasonIndex <= 0) continue
    const cup = sc.cups?.find((item) => item.id === cupId)
    if (!cup) continue
    const champId = resolvedCupChampionId(cup)
    if (champId) bySeason.set(sc.seasonIndex, champId)
  }

  const playerFallbackId = ownId ?? world?.clubs.find((c) => c.id === 'player')?.squadKey ?? 'player'
  const targetTrophyCupId = `season-${cupId}`
  for (const trophy of game?.pve?.trophies ?? []) {
    if (trophy.cupId !== targetTrophyCupId) continue
    if (!Number.isInteger(trophy.seasonIndex) || trophy.seasonIndex <= 0) continue
    if (!bySeason.has(trophy.seasonIndex)) {
      bySeason.set(trophy.seasonIndex, playerFallbackId)
    }
  }

  return [...bySeason.entries()]
    .map(([seasonIndex, championId]) => ({ seasonIndex, championId }))
    .sort((a, b) => b.seasonIndex - a.seasonIndex)
}
