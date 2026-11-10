import type { AITeam, CupFixture, CupGroupState, CupRun, CupTie, GameState, MatchContext, MatchRecord } from './types.ts'
import { CUP_SEED, cupDefById, type CupId, type CupRound } from './data/cup-config.ts'
import { buildCupField, buildCupGroups } from './cup.ts'
import { MatchEngine } from './match/engine.ts'
import { teamInputFromAI } from './match/setup.ts'
import { splitSeed } from './rng.ts'
import { emptyCupRow, sortCupTable, updateCupTable } from './cup-table.ts'
import { archivePastCups } from './pve-season.ts'
import { LOGIC_MATCH_SECONDS } from './match/time.ts'

const ROUND_ORDER: CupRound[] = ['r16', 'qf', 'sf', 'final']

export function cupTeam(game: GameState, run: CupRun, id: string): AITeam | undefined {
  // 杯赛 AI 一律使用报名时快照，不让后续转会、培养或共享缓存改变对手。
  if (id === 'player') return undefined
  const snapshot = run.participants[id]?.snapshot
  return snapshot ? structuredClone(snapshot) : undefined
}

function roundSeed(run: CupRun): number {
  return splitSeed(CUP_SEED, `${run.cupId}-${run.seasonIndex}`)
}

function playAI(game: GameState, run: CupRun, fixture: CupFixture, knockout = false, offset?: { home: number; away: number }): void {
  const home = cupTeam(game, run, fixture.homeId)
  const away = cupTeam(game, run, fixture.awayId)
  if (!home || !away) throw new Error('杯赛对手快照缺失，请重新报名')
  // 后台无画面批量结算；点球仍使用与玩家相同的结算内核，不用 CA 判胜。
  const engine = new MatchEngine({
    seed: splitSeed(roundSeed(run), fixture.id), home: teamInputFromAI(home), away: teamInputFromAI(away),
    knockout, shootoutOffset: offset, offside: true, rulesVersion: 2, recordPlayback: false, durationSeconds: LOGIC_MATCH_SECONDS,
  })
  const state = engine.simulate()
  fixture.score = { ...state.score }
  if (state.shootout) fixture.shootout = { home: state.shootout.home, away: state.shootout.away }
  fixture.played = true
}

/** 每次只公布同一轮小组赛，不能在报名时泄露未来三轮赛果。 */
function settleGroupRound(game: GameState, run: CupRun, round: number): void {
  for (const group of run.groups) {
    for (const fixture of group.fixtures) {
      if (fixture.round !== round || fixture.played || fixture.homeId === 'player' || fixture.awayId === 'player') continue
      playAI(game, run, fixture)
      updateCupTable(group.table, fixture.homeId, fixture.awayId, fixture.score!)
    }
    group.table = sortCupTable(group, roundSeed(run))
  }
}

export function enterCup(game: GameState, cupId: CupId, worldTeams?: readonly AITeam[]): { ok: boolean; error?: string; run?: CupRun } {
  if (game.season.finished) return { ok: false, error: '赛季已结束，下一赛季再报名' }
  if (game.activeMatch) return { ok: false, error: '已有进行中的比赛' }
  const def = cupDefById(cupId)
  archivePastCups(game)
  const old = game.pve?.cups[cupId]
  if (old?.seasonIndex === game.season.index && old.status !== 'void') return { ok: false, error: `本季已经参加过${def.name}` }
  if (!game.pve) return { ok: false, error: '存档缺少 PvE 数据' }
  const field = buildCupField(cupId, game, game.season.index)
  if (worldTeams) {
    const shared = new Map(worldTeams.map((team) => [team.id, team]))
    for (const entry of field) if (entry.kind === 'world') {
      const snapshot = shared.get(entry.id)
      if (!snapshot) return { ok: false, error: '杯赛世界队快照不完整，请重试' }
      entry.team = structuredClone(snapshot)
      entry.name = snapshot.name
    }
  }
  if (field.length !== def.size || new Set(field.map((team) => team.id)).size !== def.size) return { ok: false, error: '可用参赛球队不足，无法报名' }
  const groups = buildCupGroups(cupId, field, game.season.index)
  const run: CupRun = {
    cupId, seasonIndex: game.season.index, status: 'active', stage: 'group', groupRound: 1, rounds: [],
    participants: Object.fromEntries(field.map((entry) => [entry.id, {
      name: entry.name, kind: entry.kind, ...(entry.defId ? { defId: entry.defId } : {}),
      ...(entry.kind !== 'player' ? { snapshot: structuredClone(entry.team) } : {}),
    }])),
    groups: groups.map((group) => ({ index: group.index, teamIds: group.teams.map((entry) => entry.id), fixtures: group.fixtures, table: group.teams.map((entry) => emptyCupRow(entry.id)) })),
    playerGroupIndex: groups.findIndex((group) => group.teams.some((entry) => entry.id === 'player')),
  }
  if (run.playerGroupIndex < 0) return { ok: false, error: '杯赛名单没有你的球队' }
  game.pve.cups[cupId] = run
  return { ok: true, run }
}

export function findCupFixture(run: CupRun, id: string): { fixture: CupFixture; group?: CupGroupState; tie?: CupTie } | undefined {
  for (const group of run.groups) {
    const fixture = group.fixtures.find((entry) => entry.id === id)
    if (fixture) return { fixture, group }
  }
  for (const tie of run.knockout?.ties ?? []) {
    const fixture = tie.legs.find((entry) => entry.id === id)
    if (fixture) return { fixture, tie }
  }
  return undefined
}

export function cupPlayerFixture(run: CupRun): { fixture: CupFixture; group?: CupGroupState; tie?: CupTie } | undefined {
  if (run.status !== 'active') return undefined
  if (run.stage === 'group') {
    const group = run.groups[run.playerGroupIndex]
    const fixture = group?.fixtures.find((entry) => !entry.played && (entry.homeId === 'player' || entry.awayId === 'player'))
    return fixture ? { fixture, group } : undefined
  }
  for (const tie of run.knockout?.ties ?? []) {
    const fixture = tie.legs.find((leg) => !leg.played && (leg.homeId === 'player' || leg.awayId === 'player'))
    if (fixture) return { fixture, tie }
  }
  return undefined
}

function preserveRound(run: CupRun): void {
  if (!run.knockout) return
  const rounds = (run.rounds ??= [])
  const index = rounds.findIndex((round) => round.round === run.knockout!.round)
  const snapshot = structuredClone(run.knockout)
  if (index < 0) rounds.push(snapshot)
  else rounds[index] = snapshot
}

/** aggregate 和 tie.shootout 均以首回合主队为 home，次回合点球需反转。 */
function resolveTie(tie: CupTie): void {
  if (tie.winnerId || tie.legs.some((leg) => !leg.played || !leg.score)) return
  const first = tie.legs[0]
  const last = tie.legs.at(-1)!
  const twoLegs = tie.legs.length === 2
  tie.aggregate = twoLegs
    ? { home: first.score!.home + last.score!.away, away: first.score!.away + last.score!.home }
    : { ...first.score! }
  if (tie.aggregate.home !== tie.aggregate.away) tie.winnerId = tie.aggregate.home > tie.aggregate.away ? first.homeId : first.awayId
  else if (last.shootout) {
    tie.shootout = twoLegs ? { home: last.shootout.away, away: last.shootout.home } : { ...last.shootout }
    tie.winnerId = tie.shootout.home > tie.shootout.away ? first.homeId : first.awayId
  }
}

function twoLegged(cupId: CupId, round: CupRound): boolean {
  const from = cupDefById(cupId).twoLeggedFrom
  return round !== 'final' && !!from && ROUND_ORDER.indexOf(round) >= ROUND_ORDER.indexOf(from)
}

export function buildKnockoutRound(game: GameState, run: CupRun, def: ReturnType<typeof cupDefById>, round: CupRound, ids: string[]): void {
  preserveRound(run)
  const pairs: [string, string][] = []
  const fromGroups = round === def.knockout[0]
  if (fromGroups) {
    // A1-B2 / C1-D2 / B1-A2 / D1-C2，避免同组在下一轮马上重逢。
    const half: [string, string][][] = [[], []]
    for (let i = 0; i < ids.length; i += 4) {
      half[0].push([ids[i], ids[i + 3]])
      half[1].push([ids[i + 2], ids[i + 1]])
    }
    pairs.push(...half.flat())
  } else for (let i = 0; i < ids.length; i += 2) pairs.push([ids[i], ids[i + 1]])
  const ties = pairs.map(([homeId, awayId], i): CupTie => {
    const id = `cup-${run.cupId}-${run.seasonIndex}-${round}-${i + 1}`
    const legs: CupFixture[] = [{ id: `${id}-1`, round: 1, homeId, awayId, played: false }]
    if (twoLegged(run.cupId as CupId, round)) legs.push({ id: `${id}-2`, round: 2, homeId: awayId, awayId: homeId, played: false })
    return { id, round, legs }
  })
  run.stage = round
  run.knockout = { round, ties }
  for (const tie of ties) {
    if (tie.legs.some((leg) => leg.homeId === 'player' || leg.awayId === 'player')) continue
    for (let i = 0; i < tie.legs.length; i++) {
      const first = tie.legs[0].score
      playAI(game, run, tie.legs[i], tie.legs.length === 1 || i === 1, i === 1 && first ? { home: first.away, away: first.home } : undefined)
    }
    resolveTie(tie)
  }
  preserveRound(run)
}

function finishCup(game: GameState, run: CupRun, champion: boolean): void {
  run.status = champion ? 'champion' : 'eliminated'
  run.stage = 'done'
  preserveRound(run)
  if (!champion) return
  const leg = run.knockout!.ties[0].legs[0]
  run.finalMatchId = leg.matchId
  const opponentId = leg.homeId === 'player' ? leg.awayId : leg.homeId
  if (game.pve!.trophies.some((entry) => entry.cupId === run.cupId && entry.seasonIndex === run.seasonIndex)) return
  const playerHome = leg.homeId === 'player'
  game.pve!.trophies.push({
    cupId: run.cupId, cupName: cupDefById(run.cupId as CupId).name, seasonIndex: run.seasonIndex,
    wonAt: Date.now(), finalOpponent: run.participants[opponentId].name,
    finalScore: playerHome ? { ...leg.score! } : { home: leg.score!.away, away: leg.score!.home },
    ...(leg.shootout ? { finalShootout: playerHome ? { ...leg.shootout } : { home: leg.shootout.away, away: leg.shootout.home } } : {}),
    matchId: leg.matchId,
  })
}

export function recordCupResult(game: GameState, record: MatchRecord, context: MatchContext): void {
  if (!context.cupId || !context.cupFixtureId) return
  const run = game.pve?.cups[context.cupId]
  if (!run || run.status !== 'active' || run.seasonIndex !== game.season.index) return
  const next = cupPlayerFixture(run)
  if (!next || next.fixture.id !== context.cupFixtureId) return
  const { fixture, group, tie } = next
  fixture.played = true
  fixture.score = { ...record.score }
  fixture.matchId = record.id
  if (record.shootout) fixture.shootout = { ...record.shootout }
  if (group) {
    updateCupTable(group.table, fixture.homeId, fixture.awayId, record.score)
    settleGroupRound(game, run, fixture.round)
    const nextFixture = cupPlayerFixture(run)
    run.groupRound = nextFixture?.fixture.round ?? 3
    if (nextFixture) return
    const ids = run.groups.flatMap((entry) => sortCupTable(entry, roundSeed(run)).slice(0, 2).map((row) => row.teamId))
    run.qualifiers = ids
    if (!ids.includes('player')) { finishCup(game, run, false); return }
    const def = cupDefById(run.cupId as CupId)
    buildKnockoutRound(game, run, def, def.knockout[0], ids)
    return
  }
  if (!tie) return
  resolveTie(tie)
  preserveRound(run)
  if (!tie.winnerId) return
  if (tie.winnerId !== 'player' || tie.round === 'final') { finishCup(game, run, tie.winnerId === 'player'); return }
  const def = cupDefById(run.cupId as CupId)
  const nextRound = def.knockout[def.knockout.indexOf(tie.round) + 1]
  const ids = run.knockout!.ties.map((entry) => entry.winnerId!)
  if (ids.every(Boolean)) buildKnockoutRound(game, run, def, nextRound, ids)
}
