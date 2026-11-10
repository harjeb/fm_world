import type {
  AITeam,
  CupFixture,
  CupGroupState,
  CupRun,
  CupTableRow,
  CupTie,
  GameState,
  MatchContext,
  MatchRecord,
} from './types.ts'
import { CUP_SEED, cupDefById, type CupId, type CupRound } from './data/cup-config.ts'
import { CUP_TEAM_POOLS } from './data/cup-teams.generated.ts'
import type { LegendTeamDef } from './data/legend-teams.ts'
import { buildCupField, buildCupGroups, playerTeamForCup, type CupParticipant } from './cup.ts'
import { buildHistoricTeam } from './legend.ts'
import { cachedOwnerlessTeams } from './world.ts'
import { simulateAIvsAI } from './match/setup.ts'
import { derivedRng, splitSeed } from './rng.ts'
import { caOf } from './ca.ts'

const ROUND_ORDER: CupRound[] = ['r16', 'qf', 'sf', 'final']

const randomDefs = new Map<string, LegendTeamDef>()
for (const pool of Object.values(CUP_TEAM_POOLS)) {
  for (const def of pool) randomDefs.set(def.id, def)
}
const randomTeamCache = new Map<string, AITeam>()

function emptyRow(teamId: string): CupTableRow {
  return { teamId, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function teamCa(team: AITeam): number {
  const sorted = [...team.players].sort((a, b) => caOf(b.attrs, b.positions.GK > 0) - caOf(a.attrs, a.positions.GK > 0))
  return sorted.slice(0, 11).reduce((sum, player) => sum + caOf(player.attrs, player.positions.GK > 0), 0) / Math.min(11, sorted.length || 1)
}

/** 从杯赛状态里解析一支球队；随机队来自冻结池，世界队来自当前世界。 */
export function cupTeam(game: GameState, run: CupRun, teamId: string): AITeam | undefined {
  if (teamId === 'player') return playerTeamForCup(game)
  const participant = run.participants[teamId]
  if (!participant) return undefined
  if (participant.kind === 'random') {
    const def = participant.defId ? randomDefs.get(participant.defId) : undefined
    if (!def) return undefined
    const cached = randomTeamCache.get(def.id)
    if (cached) return cached
    const team = buildHistoricTeam(def)
    randomTeamCache.set(def.id, team)
    return team
  }
  const own = game.aiTeams.find((team) => team.id === teamId)
  if (own) return own
  if (game.world) return cachedOwnerlessTeams(game.world, game.seed, game.aiClubs)[teamId]
  return undefined
}

function updateTable(group: CupGroupState, homeId: string, awayId: string, score: { home: number; away: number }): void {
  let home = group.table.find((row) => row.teamId === homeId)
  let away = group.table.find((row) => row.teamId === awayId)
  if (!home) {
    home = emptyRow(homeId)
    group.table.push(home)
  }
  if (!away) {
    away = emptyRow(awayId)
    group.table.push(away)
  }
  home.played += 1
  away.played += 1
  home.gf += score.home
  home.ga += score.away
  away.gf += score.away
  away.ga += score.home
  if (score.home > score.away) {
    home.won += 1
    home.points += 3
    away.lost += 1
  } else if (score.home < score.away) {
    away.won += 1
    away.points += 3
    home.lost += 1
  } else {
    home.drawn += 1
    away.drawn += 1
    home.points += 1
    away.points += 1
  }
}

function sortTable(table: CupTableRow[]): CupTableRow[] {
  return [...table].sort((a, b) => b.points - a.points || b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf || a.teamId.localeCompare(b.teamId))
}

function simulateAIFixture(game: GameState, run: CupRun, fixture: CupFixture): boolean {
  const home = cupTeam(game, run, fixture.homeId)
  const away = cupTeam(game, run, fixture.awayId)
  if (!home || !away) return false
  const score = simulateAIvsAI(home, away, splitSeed(CUP_SEED, `cup-ai-${run.cupId}-${run.seasonIndex}-${fixture.id}`))
  fixture.played = true
  fixture.score = { ...score }
  return true
}

/** 报名：生成混合名单和小组赛，提前结算所有 AI 对 AI 的小组赛。 */
export function enterCup(game: GameState, cupId: CupId): { ok: boolean; error?: string; run?: CupRun } {
  if (game.season.finished) return { ok: false, error: '赛季已结束，下一赛季再报名' }
  if (game.activeMatch) return { ok: false, error: '已有进行中的比赛' }
  const def = cupDefById(cupId)
  const existing = game.pve?.cups?.[cupId]
  if (existing && existing.seasonIndex === game.season.index && existing.status !== 'void') {
    return { ok: false, error: `本季已经参加过${def.name}` }
  }
  const field = buildCupField(cupId, game, game.season.index)
  const groups = buildCupGroups(cupId, field, game.season.index)
  const participants: CupRun['participants'] = {}
  for (const team of field) participants[team.id] = { name: team.name, kind: team.kind, ...(team.defId ? { defId: team.defId } : {}) }
  const groupStates: CupGroupState[] = groups.map((group) => ({
    index: group.index,
    teamIds: group.teams.map((team) => team.id),
    fixtures: group.fixtures.map((fixture) => ({ ...fixture, played: false })),
    table: group.teams.map((team) => emptyRow(team.id)),
  }))
  const playerGroupIndex = groupStates.findIndex((group) => group.teamIds.includes('player'))
  if (playerGroupIndex < 0) return { ok: false, error: '杯赛名单里没有你的球队' }
  const run: CupRun = {
    cupId,
    seasonIndex: game.season.index,
    status: 'active',
    stage: 'group',
    participants,
    groups: groupStates,
    playerGroupIndex,
    groupRound: 1,
  }
  // 小组赛的 AI 对 AI 先结算，玩家只踢自己的 3 场。
  for (const group of run.groups) {
    for (const fixture of group.fixtures) {
      if (fixture.homeId === 'player' || fixture.awayId === 'player') continue
      const ok = simulateAIFixture(game, run, fixture)
      if (!ok) return { ok: false, error: '杯赛球队名单解析失败' }
      if (fixture.score) updateTable(group, fixture.homeId, fixture.awayId, fixture.score)
    }
    group.table = sortTable(group.table)
  }
  if (!game.pve) return { ok: false, error: '存档缺少 PvE 数据' }
  game.pve.cups[cupId] = run
  return { ok: true, run }
}

export function findCupFixture(run: CupRun, fixtureId: string): { fixture: CupFixture; group?: CupGroupState; tie?: CupTie } | undefined {
  for (const group of run.groups) {
    const fixture = group.fixtures.find((item) => item.id === fixtureId)
    if (fixture) return { fixture, group }
  }
  for (const tie of run.knockout?.ties ?? []) {
    const fixture = tie.legs.find((item) => item.id === fixtureId)
    if (fixture) return { fixture, tie }
  }
  return undefined
}

/** 玩家下一场杯赛（小组赛或淘汰赛某一回合）。 */
export function cupPlayerFixture(run: CupRun): { fixture: CupFixture; group?: CupGroupState; tie?: CupTie } | undefined {
  if (run.status !== 'active') return undefined
  if (run.stage === 'group') {
    const group = run.groups[run.playerGroupIndex]
    const fixture = group?.fixtures.find((item) => !item.played && (item.homeId === 'player' || item.awayId === 'player'))
    return fixture ? { fixture, group } : undefined
  }
  if (run.knockout) {
    for (const tie of run.knockout.ties) {
      const fixture = tie.legs.find((leg) => !leg.played && (leg.homeId === 'player' || leg.awayId === 'player'))
      if (fixture) return { fixture, tie }
    }
  }
  return undefined
}

function qualifiersFromGroups(run: CupRun): string[] {
  const out: string[] = []
  for (const group of run.groups) {
    const table = sortTable(group.table)
    out.push(table[0]?.teamId ?? '', table[1]?.teamId ?? '')
  }
  return out.filter(Boolean)
}

function shootout(game: GameState, run: CupRun, homeId: string, awayId: string, seed: number): { home: number; away: number } {
  const home = cupTeam(game, run, homeId)
  const away = cupTeam(game, run, awayId)
  const homeChance = home && away ? clamp(0.75 + (teamCa(home) - teamCa(away)) / 4000, 0.55, 0.9) : 0.75
  const awayChance = home && away ? clamp(0.75 + (teamCa(away) - teamCa(home)) / 4000, 0.55, 0.9) : 0.75
  const rng = derivedRng(seed, 'cup-shootout')
  let h = 0
  let a = 0
  for (let round = 0; round < 5; round++) {
    if (rng.float() < homeChance) h += 1
    if (rng.float() < awayChance) a += 1
  }
  while (h === a) {
    if (rng.float() < homeChance) h += 1
    if (rng.float() < awayChance) a += 1
  }
  return { home: h, away: a }
}

function resolveTie(game: GameState, run: CupRun, tie: CupTie): void {
  if (tie.winnerId) return
  if (tie.legs.some((leg) => !leg.played || !leg.score)) return
  if (tie.legs.length === 1) {
    const leg = tie.legs[0]
    const score = leg.score as { home: number; away: number }
    tie.aggregate = { ...score }
    if (score.home !== score.away) tie.winnerId = score.home > score.away ? leg.homeId : leg.awayId
    else {
      const result = leg.shootout ?? shootout(game, run, leg.homeId, leg.awayId, splitSeed(CUP_SEED, `cup-so-${run.cupId}-${run.seasonIndex}-${tie.id}`))
      leg.shootout = result
      tie.shootout = result
      tie.winnerId = result.home > result.away ? leg.homeId : leg.awayId
    }
    return
  }
  const first = tie.legs[0]
  const second = tie.legs[1]
  const firstScore = first.score as { home: number; away: number }
  const secondScore = second.score as { home: number; away: number }
  const aggregate = { home: firstScore.home + secondScore.away, away: firstScore.away + secondScore.home }
  tie.aggregate = aggregate
  if (aggregate.home !== aggregate.away) tie.winnerId = aggregate.home > aggregate.away ? first.homeId : first.awayId
  else {
    const result = shootout(game, run, first.homeId, first.awayId, splitSeed(CUP_SEED, `cup-so-${run.cupId}-${run.seasonIndex}-${tie.id}`))
    tie.shootout = result
    tie.winnerId = result.home > result.away ? first.homeId : first.awayId
  }
}

function isTwoLegged(def: ReturnType<typeof cupDefById>, round: CupRound): boolean {
  if (round === 'final') return false
  if (!def.twoLeggedFrom) return false
  return ROUND_ORDER.indexOf(round) >= ROUND_ORDER.indexOf(def.twoLeggedFrom)
}

function createTie(run: CupRun, def: ReturnType<typeof cupDefById>, round: CupRound, homeId: string, awayId: string, index: number): CupTie {
  const tieId = `cup-${run.cupId}-${run.seasonIndex}-${round}-${index + 1}`
  if (isTwoLegged(def, round)) {
    return {
      id: tieId,
      round,
      legs: [
        { id: `${tieId}-1`, round: 1, homeId, awayId, played: false },
        { id: `${tieId}-2`, round: 2, homeId: awayId, awayId: homeId, played: false },
      ],
    }
  }
  return { id: tieId, round, legs: [{ id: `${tieId}-1`, round: 1, homeId, awayId, played: false }] }
}

function simulateAITie(game: GameState, run: CupRun, tie: CupTie): void {
  for (const leg of tie.legs) {
    if (leg.played) continue
    const home = cupTeam(game, run, leg.homeId)
    const away = cupTeam(game, run, leg.awayId)
    if (!home || !away) continue
    const score = simulateAIvsAI(home, away, splitSeed(CUP_SEED, `cup-ai-${run.cupId}-${run.seasonIndex}-${leg.id}`))
    leg.played = true
    leg.score = { ...score }
  }
  resolveTie(game, run, tie)
}

export function buildKnockoutRound(game: GameState, run: CupRun, def: ReturnType<typeof cupDefById>, round: CupRound, teamIds: string[]): void {
  const pairs: [string, string][] = []
  const groupCross = round === 'r16' || (round === 'qf' && def.knockout[0] === 'qf')
  if (groupCross) {
    const winners: string[] = []
    const runners: string[] = []
    for (let index = 0; index < teamIds.length; index += 2) {
      winners.push(teamIds[index])
      runners.push(teamIds[index + 1])
    }
    for (let index = 0; index < winners.length; index += 2) {
      const next = index + 1
      if (winners[index] && runners[next]) pairs.push([winners[index], runners[next]])
      if (winners[next] && runners[index]) pairs.push([winners[next], runners[index]])
    }
  } else {
    for (let index = 0; index < teamIds.length; index += 2) {
      if (teamIds[index] && teamIds[index + 1]) pairs.push([teamIds[index], teamIds[index + 1]])
    }
  }
  const ties = pairs.map(([homeId, awayId], index) => createTie(run, def, round, homeId, awayId, index))
  for (const tie of ties) {
    if (tie.legs.some((leg) => leg.homeId === 'player' || leg.awayId === 'player')) continue
    simulateAITie(game, run, tie)
  }
  run.stage = round
  run.knockout = { round, ties }
}

function nextRound(round: CupRound): CupRound | null {
  return round === 'r16' ? 'qf' : round === 'qf' ? 'sf' : round === 'sf' ? 'final' : null
}

function finishCup(game: GameState, run: CupRun, status: 'champion' | 'eliminated'): void {
  run.status = status
  run.stage = 'done'
  if (status !== 'champion') return
  const def = cupDefById(run.cupId as CupId)
  const finalTie = run.knockout?.ties[0]
  const leg = finalTie?.legs[0]
  if (!finalTie || !leg) return
  const opponentId = leg.homeId === 'player' ? leg.awayId : leg.homeId
  const score = leg.score ?? { home: 0, away: 0 }
  run.finalMatchId = leg.matchId
  game.pve?.trophies.push({
    cupId: run.cupId,
    cupName: def.name,
    seasonIndex: run.seasonIndex,
    wonAt: Date.now(),
    finalOpponent: run.participants[opponentId]?.name ?? opponentId,
    finalScore: { ...score },
    ...(leg.shootout ? { finalShootout: { ...leg.shootout } } : {}),
    ...(leg.matchId ? { matchId: leg.matchId } : {}),
  })
}

function advanceAfterTie(game: GameState, run: CupRun, tie: CupTie): void {
  if (!tie.winnerId) return
  if (tie.round === 'final') {
    finishCup(game, run, tie.winnerId === 'player' ? 'champion' : 'eliminated')
    return
  }
  if (tie.winnerId !== 'player') {
    finishCup(game, run, 'eliminated')
    return
  }
  const ties = run.knockout?.ties ?? []
  if (ties.some((item) => !item.winnerId)) return
  const def = cupDefById(run.cupId as CupId)
  const next = nextRound(tie.round)
  if (!next) return
  buildKnockoutRound(game, run, def, next, ties.map((item) => item.winnerId as string))
}

function finishGroupStage(game: GameState, run: CupRun): void {
  run.qualifiers = qualifiersFromGroups(run)
  if (!run.qualifiers.includes('player')) {
    finishCup(game, run, 'eliminated')
    return
  }
  const def = cupDefById(run.cupId as CupId)
  buildKnockoutRound(game, run, def, def.knockout[0], run.qualifiers)
}

/** 玩家杯赛比赛结束后写入比分、积分/总比分，并推进赛程。 */
export function recordCupResult(game: GameState, record: MatchRecord, context: MatchContext): void {
  if (!context.cupId || !context.cupFixtureId) return
  const run = game.pve?.cups?.[context.cupId]
  if (!run || run.status !== 'active') return
  const found = findCupFixture(run, context.cupFixtureId)
  if (!found || found.fixture.played) return
  const { fixture, group, tie } = found
  fixture.played = true
  fixture.score = { ...record.score }
  fixture.matchId = record.id
  if (record.shootout) fixture.shootout = { ...record.shootout }

  if (group) {
    updateTable(group, fixture.homeId, fixture.awayId, record.score)
    group.table = sortTable(group.table)
    const played = group.fixtures.filter((item) => item.played).length
    run.groupRound = Math.min(3, Math.max(1, Math.ceil(played / 2)))
    if (run.groups.every((item) => item.fixtures.every((f) => f.played))) finishGroupStage(game, run)
    return
  }

  if (tie) {
    resolveTie(game, run, tie)
    advanceAfterTie(game, run, tie)
  }
}
