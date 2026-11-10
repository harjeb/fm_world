import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildOwnerlessTeams, createOwnerlessWorld } from '../src/game/world.ts'
import { AI_REST_BELOW } from '../src/game/squad.ts'
import { LINEUP_LOCK_MS } from '../src/game/season.ts'
import { MatchQueue } from '../server/match-queue.ts'
import { MatchScheduler } from '../server/match-scheduler.ts'
import { emptyMatchBook, matchJobId, type LockedTeam, type MatchJob } from '../server/match-job.ts'

const dirs: string[] = [], queues: MatchQueue[] = []
afterEach(() => {
  while (queues.length) queues.pop()!.close()
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

const kickoffAt = Date.UTC(2026, 10, 9, 12)

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
  return { job, fixture }
}

const startersOf = (team: LockedTeam['team']) => team.lineup.starters.map((starter) => starter.playerId)

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
