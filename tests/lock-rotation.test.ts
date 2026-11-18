import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildOwnerlessTeams, createOwnerlessWorld } from '../src/game/world.ts'
import { AI_REST_BELOW } from '../src/game/squad.ts'
import { FORMATIONS } from '../src/game/data/formations.ts'
import { DETAILED_POSITIONS, DETAILED_TO_POSITION } from '../src/game/detailed-positions.ts'
import { NEUTRAL_INSTRUCTIONS } from '../src/game/pes/tactics.ts'
import { emptyAutoSubs } from '../src/game/match/management.ts'
import { personKey } from '../src/game/injury.ts'
import { LINEUP_LOCK_MS } from '../src/game/season.ts'
import { MatchQueue } from '../server/match-queue.ts'
import { MatchScheduler } from '../server/match-scheduler.ts'
import { computeMatchJob, emptyMatchBook, matchJobId, seasonCupJobId, type LockedTeam, type MatchJob } from '../server/match-job.ts'

const dirs: string[] = [], queues: MatchQueue[] = []
afterEach(() => {
  while (queues.length) queues.pop()!.close()
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

const kickoffAt = Date.UTC(2026, 10, 9, 10)

/** 在开球前 30 分钟锁定第 1 轮，返回冻结下来的某场比赛快照。 */
function lockFirstFixture(prepare: (home: LockedTeam, away: LockedTeam) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-lock-rotation-')); dirs.push(dir)
  const queue = new MatchQueue(dir, { intervalMs: 0 }); queues.push(queue)
  const { world } = createOwnerlessWorld(17, kickoffAt)
  const teams = buildOwnerlessTeams(world, 17)
  const division = world.divisions[0], fixture = division.fixtures.find((item) => item.round === 1)!
  const locked = new Map<string, LockedTeam>()
  const teamFor = (id: string): LockedTeam | null => {
    if (!teams[id]) return null
    if (!locked.has(id)) locked.set(id, { team: structuredClone(teams[id]), injuries: {}, suspended: [], medical: 1, ai: true })
    return locked.get(id)!
  }
  prepare(teamFor(fixture.homeId)!, teamFor(fixture.awayId)!)
  const scheduler = new MatchScheduler(queue, { seed: 17, world, teams, matchBook: emptyMatchBook() }, teamFor, () => {})
  scheduler.refresh(kickoffAt - LINEUP_LOCK_MS)
  const id = matchJobId(world.seasonIndex, division.divisionId!, fixture)
  const job = JSON.parse(fs.readFileSync(path.join(dir, `${id}.input.json`), 'utf8')) as MatchJob
  return { job, fixture, locked }
}

const startersOf = (team: LockedTeam['team']) => team.lineup.starters.map((starter) => starter.playerId)

function coachedRotation(team: LockedTeam) {
  delete team.ai
  const lineup = team.team.lineup
  const slot = lineup.starters.find(s => FORMATIONS[lineup.formationId].slots.find(x => x.id === s.slotId)!.position !== 'GK')!
  const pos = FORMATIONS[lineup.formationId].slots.find(x => x.id === slot.slotId)!.position
  for (const player of team.team.players) player.condition = 100
  const out = team.team.players.find(p => p.id === slot.playerId)!
  out.condition = 10
  const bench = lineup.bench.map(id => team.team.players.find(p => p.id === id)!)
  for (const player of bench) { player.condition = 10; player.positions = { GK: 0, CB: 0, W: 0, CM: 0, ST: 0 } }
  for (const player of bench.slice(0, 4)) { player.condition = 100; player.positions[pos] = 90 }
  for (const player of bench) player.detailedPositions = Object.fromEntries(DETAILED_POSITIONS.map(d => [d, player.positions[DETAILED_TO_POSITION[d]]]))
  team.autoSubs = { ...emptyAutoSubs(), preMatchStaminaBelow: 60, timed: [
    { atMinute: 10, outId: out.id, inId: bench[3].id },
    { atMinute: 20, outId: lineup.starters.find(s => s !== slot)!.playerId, inId: bench[3].id },
  ] }
  return { out, bench }
}

describe('教练球队的联机赛前轮换', () => {
  it('锁定快照排除按人物键受伤及停赛替补，并过滤规则而不修改原球队', () => {
    let original!: LockedTeam, out = '', incoming = ''
    const { job, fixture, locked } = lockFirstFixture(home => {
      const f = coachedRotation(home)
      out = f.out.id; incoming = f.bench[2].id
      home.injuries[personKey(f.bench[0])] = kickoffAt + 1
      home.suspended = [f.bench[1].id]
      original = structuredClone(home)
    })
    expect(startersOf(job.home.team)).not.toContain(out)
    expect(startersOf(job.home.team)).toContain(incoming)
    expect(job.home.team.lineup.bench).toContain(out)
    expect(job.home.autoSubs!.timed).toEqual([original.autoSubs!.timed[1]])
    expect(locked.get(fixture.homeId)).toEqual(original)
    const state = computeMatchJob(job).initialState!
    const starters = state.teams[0].players.filter(player => player.onPitch).map(player => player.sourceId)
    expect(starters).toContain(incoming)
    expect(starters).not.toContain(out)
  })

  it('有停赛替补但无低体能首发时保留首发并清理本场失效规则', () => {
    let original!: LockedTeam, banned = ''
    const { job } = lockFirstFixture(home => {
      const f = coachedRotation(home)
      f.out.condition = 100
      banned = f.bench[3].id
      home.suspended = [banned]
      original = structuredClone(home)
    })
    expect(startersOf(job.home.team)).toEqual(startersOf(original.team))
    expect(job.home.team.lineup.bench).not.toContain(banned)
    expect(job.home.autoSubs!.timed).toEqual([])
    const state = computeMatchJob(job).initialState!
    expect(state.teams[0].players.filter(player => player.onPitch).map(player => player.sourceId).sort()).toEqual(startersOf(job.home.team).sort())
  })

  it('停赛首发先由健康球员补位，保留其他首发、职责和教练战术', () => {
    let original!: LockedTeam, banned = '', tired = '', injured = ''
    const { job } = lockFirstFixture(home => {
      const f = coachedRotation(home)
      const lineup = home.team.lineup
      const other = lineup.starters.find(starter => starter.playerId !== f.out.id && FORMATIONS[lineup.formationId].slots.find(slot => slot.id === starter.slotId)!.position !== 'GK')!
      banned = other.playerId; tired = f.out.id; injured = f.bench[0].id
      home.suspended = [banned]
      home.injuries[personKey(f.bench[0])] = kickoffAt + 1
      lineup.tacticalStyle = 'control'
      lineup.tacticalInstructions = structuredClone(NEUTRAL_INSTRUCTIONS)
      lineup.tacticalInstructions.possession.tempo = 'fast'
      lineup.matchPlan = 'fastStart'
      lineup.customPositions = { [other.slotId]: { x: 0.35, y: 0.6 } }
      original = structuredClone(home)
    })
    const lineup = job.home.team.lineup, starters = startersOf(job.home.team)
    expect(starters).not.toContain(banned)
    expect(starters).not.toContain(tired)
    expect(starters).not.toContain(injured)
    for (const starter of original.team.lineup.starters.filter(item => item.playerId !== banned && item.playerId !== tired)) {
      expect(lineup.starters.find(item => item.slotId === starter.slotId)).toEqual(starter)
    }
    expect(lineup.starters.map(item => item.role)).toEqual(original.team.lineup.starters.map(item => item.role))
    expect(lineup.tacticalStyle).toBe('control')
    expect(lineup.tacticalInstructions).toEqual(original.team.lineup.tacticalInstructions)
    expect(lineup.matchPlan).toBe('fastStart')
    expect(lineup.customPositions).toEqual(original.team.lineup.customPositions)
    const state = computeMatchJob(job).initialState!
    expect(state.teams[0].players.filter(player => player.onPitch).map(player => player.sourceId).sort()).toEqual(starters.sort())
    expect(state.teams[0].matchPlan).toBe('fastStart')
  })

  it('默认关闭时保留首发、替补和规则', () => {
    let original!: LockedTeam
    const { job } = lockFirstFixture(home => {
      coachedRotation(home)
      delete home.autoSubs!.preMatchStaminaBelow
      original = structuredClone(home)
    })
    expect(job.home.team.lineup).toEqual(original.team.lineup)
    expect(job.home.autoSubs).toEqual(original.autoSubs)
  })

  it('正式杯赛在克隆上结算体能和杯赛伤停，不污染 teamFor 返回值', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-lock-rotation-')); dirs.push(dir)
    const queue = new MatchQueue(dir, { intervalMs: 0 }); queues.push(queue)
    const { world } = createOwnerlessWorld(17, kickoffAt), teams = buildOwnerlessTeams(world, 17)
    for (const division of world.divisions) for (const fixture of division.fixtures) fixture.played = true
    const [homeId, awayId] = world.divisions[0].clubIds!
    const fixture = { id: 'final', cupId: 'community' as const, round: 1, homeId, awayId, kickoffAt, played: false }
    world.seasonCups = { version: 1, seasonIndex: world.seasonIndex, qualificationRound: 1, createdAt: 0, delayedLeagueRounds: [], cups: [{ id: 'community', name: 'Cup', entrants: [homeId, awayId], dates: [kickoffAt], rounds: [{ round: 1, kickoffAt, byes: [], fixtures: [fixture] }] }] }
    const home: LockedTeam = { team: structuredClone(teams[homeId]), injuries: {}, suspended: ['old-league-ban'], medical: 1 }
    const away: LockedTeam = { team: structuredClone(teams[awayId]), injuries: {}, suspended: [], medical: 1, ai: true }
    const f = coachedRotation(home)
    home.injuries[personKey(f.bench[0])] = kickoffAt + 1
    const before = structuredClone(home), awayBefore = structuredClone(away)
    const book = emptyMatchBook()
    book.cupDiscipline = { community: { suspensions: { [f.bench[1].id]: { matches: 1, atRound: 1 } }, yellowCounts: {} } }
    const scheduler = new MatchScheduler(queue, { seed: 17, world, matchBook: book }, id => id === homeId ? home : away, () => {})
    scheduler.refresh(kickoffAt - LINEUP_LOCK_MS - 1)
    const file = path.join(dir, `${seasonCupJobId(world.seasonIndex, 'community', fixture.id)}.input.json`)
    expect(fs.existsSync(file)).toBe(false)
    scheduler.refresh(kickoffAt - LINEUP_LOCK_MS)
    const job = JSON.parse(fs.readFileSync(file, 'utf8')) as MatchJob
    expect(startersOf(job.home.team)).toContain(f.bench[2].id)
    expect(job.home.team.lineup.bench).toContain(f.out.id)
    expect(job.home.suspended).toEqual([f.bench[1].id])
    expect(job.home.autoSubs!.timed).toEqual([before.autoSubs!.timed[1]])
    expect(home).toEqual(before)
    expect(away).toEqual(awayBefore)
    const state = computeMatchJob(job).initialState!
    const starters = state.teams[0].players.filter(player => player.onPitch).map(player => player.sourceId)
    expect(starters).toContain(f.bench[2].id)
    expect(starters).not.toContain(f.out.id)
  })

  it('锁定前不入队；重复刷新和重启保留首次快照', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-lock-rotation-')); dirs.push(dir)
    const queue = new MatchQueue(dir, { intervalMs: 0 }); queues.push(queue)
    const { world } = createOwnerlessWorld(17, kickoffAt), teams = buildOwnerlessTeams(world, 17)
    const fixture = world.divisions[0].fixtures.find(f => f.round === 1)!
    const home: LockedTeam = { team: structuredClone(teams[fixture.homeId]), injuries: {}, suspended: [], medical: 1 }
    coachedRotation(home)
    const teamFor = (id: string): LockedTeam => id === fixture.homeId ? home : { team: structuredClone(teams[id]), injuries: {}, suspended: [], medical: 1, ai: true }
    const scheduler = new MatchScheduler(queue, { seed: 17, world }, teamFor, () => {})
    const id = matchJobId(world.seasonIndex, world.divisions[0].divisionId!, fixture)
    const file = path.join(dir, `${id}.input.json`)
    scheduler.refresh(kickoffAt - LINEUP_LOCK_MS - 1)
    expect(fs.existsSync(file)).toBe(false)
    scheduler.refresh(kickoffAt - LINEUP_LOCK_MS)
    const first = fs.readFileSync(file, 'utf8')
    home.team.lineup.starters.reverse()
    scheduler.refresh(kickoffAt - LINEUP_LOCK_MS + 1)
    queue.close()
    const recovered = new MatchQueue(dir, { intervalMs: 0 }); queues.push(recovered)
    new MatchScheduler(recovered, { seed: 17, world }, teamFor, () => {}).refresh(kickoffAt - LINEUP_LOCK_MS + 2)
    expect(fs.readFileSync(file, 'utf8')).toBe(first)
  })
})

describe('电脑球队在锁定时轮换体力低的球员', () => {
  it('体能低于 80 的首发在锁定快照里就已经换下，替补顶上，阵容合法', () => {
    let tired: string[] = []
    const { job } = lockFirstFixture((home) => {
      tired = startersOf(home.team).slice(0, 4)
      for (const player of home.team.players) if (tired.includes(player.id)) player.condition = AI_REST_BELOW - 30
    })
    const starters = startersOf(job.home.team)
    expect(starters).toHaveLength(11)
    for (const id of tired) expect(starters, id).not.toContain(id)
    // 休息的人坐在替补席或名单外，不会消失；上场的都体能充沛。
    for (const id of starters) expect(job.home.team.players.find((player) => player.id === id)!.condition ?? 100).toBeGreaterThanOrEqual(AI_REST_BELOW)
    expect(new Set(starters).size).toBe(11)
  })

  it('同时有人停赛也照样按体能轮换，不退回只看实力的自动填充', () => {
    let tired = '', banned = ''
    const { job } = lockFirstFixture((home) => {
      // 首发都精神；一名很强但体能低的替补，加上另一名替补停赛：名单人数变了，
      // 旧逻辑会直接重排成“最强阵容”，把这名累的球星推上首发。
      tired = home.team.lineup.bench[1]
      const star = home.team.players.find((player) => player.id === tired)!
      for (const key of Object.keys(star.attrs) as (keyof typeof star.attrs)[]) star.attrs[key] = star.attrs[key] * 2.5
      star.condition = AI_REST_BELOW - 30
      banned = home.team.lineup.bench[0]
      home.suspended = [banned]
    })
    const starters = startersOf(job.home.team)
    expect(starters).not.toContain(tired)
    expect(starters).not.toContain(banned)
    expect(job.home.team.lineup.bench).not.toContain(banned)
  })

  it('体能充沛时阵容原样不动；有教练的球队不替他换人', () => {
    let original: string[] = [], coachedOriginal: string[] = []
    const { job } = lockFirstFixture((home, away) => {
      original = startersOf(home.team)
      coachedOriginal = startersOf(away.team)
      // 对手有教练：就算累了也按教练排的阵容打。
      delete away.ai
      for (const player of away.team.players) player.condition = 20
    })
    expect(startersOf(job.home.team)).toEqual(original)
    expect(startersOf(job.away.team)).toEqual(coachedOriginal)
  })
})
