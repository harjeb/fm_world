import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { startTraining } from '../src/game/actions.ts'
import { nextMatchCountdown, playerFixture } from '../src/game/season.ts'
import type { GameState, WorldState } from '../src/game/types.ts'
import type { JobEntry } from '../server/match-queue.ts'
import type { MatchJob, MatchJobResult } from '../server/match-job.ts'
import { PesEngine } from '../src/game/pes/engine.ts'
import { LOGIC_MATCH_SECONDS } from '../src/game/match/time.ts'

const servers: AppServer[] = [], dirs: string[] = []
afterEach(() => {
  while (servers.length) servers.pop()!.close()
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})
const at = (hour: number, minute = 0) => Date.UTC(2026, 10, 9, hour - 8, minute)
const auth = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })
const worldAt = (dir: string) => (JSON.parse(fs.readFileSync(path.join(dir, 'world.json'), 'utf8')) as { world: WorldState }).world
const entries = (dir: string) => fs.existsSync(path.join(dir, 'match-jobs/index.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'match-jobs/index.json'), 'utf8')) as JobEntry[] : []
const jobAt = (dir: string, id: string) => JSON.parse(fs.readFileSync(path.join(dir, 'match-jobs', `${id}.input.json`), 'utf8')) as MatchJob
const resultAt = (dir: string, id: string) => JSON.parse(fs.readFileSync(path.join(dir, 'match-jobs', `${id}.result.json`), 'utf8')) as MatchJobResult

async function start(now: () => number, dir?: string, tickMs = 0) {
  if (!dir) { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-shared-kickoff-')); dirs.push(dir) }
  const app = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), now, tickMs, matchQueue: { intervalMs: 0 } })
  servers.push(app)
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  return { base: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`, dir, app }
}
async function register(base: string, username: string, clubId = 'd2n_05') {
  const response = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'secret123', clubId }) })
  expect(response.status).toBe(201)
  return await response.json() as { token: string; game: GameState; revision: number }
}
async function load(base: string, token: string) {
  return await (await fetch(`${base}/api/game`, { headers: auth(token) })).json() as { game: GameState; revision: number }
}
async function save(base: string, token: string, value: { game: GameState; revision: number }) {
  return fetch(`${base}/api/game`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ game: value.game, baseRevision: value.revision }) })
}
async function drain(app: AppServer, dir: string) {
  for (let i = 0; i < 200 && entries(dir).some((entry) => entry.status === 'queued' || entry.status === 'running'); i++) await app.runMatchQueue()
  expect(entries(dir).every((entry) => entry.status === 'ready' || entry.status === 'published')).toBe(true)
}

// 这里使用真实的低优先级计算子进程，不用 HTTP 请求模拟比赛。
describe('锁定快照、逐场计算、全服到点公布', () => {
  it('全新世界 19:00 启动首场固定 20:00，不为注册者补造 12:00 的比赛', async () => {
    const { base, dir } = await start(() => at(19))
    const registered = await register(base, 'new_world')
    expect(registered.game.season.startedAt).toBe(at(20))
    expect(nextMatchCountdown(registered.game, at(19))).toBe('1 小时 0 分')
    expect(registered.game.matchHistory).toHaveLength(0)
    expect(worldAt(dir).divisions.flatMap((division) => division.fixtures).some((fixture) => fixture.played)).toBe(false)
    expect(entries(dir)).toHaveLength(0)
  })

  it('40 场全部提前算好也不泄露；重启保留快照；12:00 一次公布，保留期间的培养/经营并给双方同一比分', async () => {
    let clock = at(11)
    let { base, dir, app } = await start(() => clock)
    const first = await register(base, 'first_coach')
    const clubId = 'd2n_05'
    const before = worldAt(dir)
    const division = before.divisions.find((item) => item.clubIds?.includes(clubId))!
    const fixture = division.fixtures.find((item) => item.round === 1 && [item.homeId, item.awayId].includes(clubId))!
    const opponent = fixture.homeId === clubId ? fixture.awayId : fixture.homeId
    const second = await register(base, 'second_coach', opponent)
    clock = at(11, 30) - 1
    await app.runMatchQueue()
    expect(entries(dir)).toHaveLength(0)
    clock = at(11, 30)
    await app.runMatchQueue()
    expect(entries(dir)).toHaveLength(40)
    expect(entries(dir).filter((entry) => entry.status === 'ready')).toHaveLength(1)
    const ownJob = entries(dir).map((entry) => jobAt(dir, entry.id)).find((job) => [job.home.team.id, job.away.team.id].includes(clubId))!
    const locked = ownJob.home.team.id === clubId ? ownJob.home : ownJob.away
    const lockedPassing = locked.team.players[0].attrs.passing
    const current = await load(base, first.token)
    const trainingPlayer = current.game.roster.find((player) => player.energy >= 30)!
    expect(startTraining(current.game, trainingPlayer.id, 17).ok).toBe(true)
    current.game.economy!.balance -= 12345
    current.game.economy!.academy++
    current.game.roster[0].attrs.passing += 17
    current.game.ui = { screen: 'training' }
    const training = structuredClone(current.game.training)
    expect((await save(base, first.token, current)).status).toBe(200)
    // 阵容和自动换人仍被服务器锁住。
    const changedLineup = await load(base, first.token)
    changedLineup.game.lineup.tactics.tempo = changedLineup.game.lineup.tactics.tempo === 'fast' ? 'slow' : 'fast'
    expect((await save(base, first.token, changedLineup)).status).toBe(409)
    await drain(app, dir)
    expect(entries(dir).filter((entry) => entry.status === 'ready')).toHaveLength(40)
    const persistedLocked = jobAt(dir, ownJob.id)
    expect((persistedLocked.home.team.id === clubId ? persistedLocked.home : persistedLocked.away).team.players[0].attrs.passing).toBe(lockedPassing)
    // 已算好的比分仍只存在私有任务目录，公开世界和两名教练均看不到。
    expect(worldAt(dir).divisions.flatMap((item) => item.fixtures).some((item) => item.played || item.score)).toBe(false)
    const hidden = await load(base, first.token)
    expect(hidden.game.matchHistory).toHaveLength(0)
    expect(playerFixture(hidden.game)!.score).toBeUndefined()
    expect(hidden.game.training).toEqual(training)
    expect(hidden.game.roster.every((player) => player.condition === 100)).toBe(true)
    expect(Object.keys(hidden.game.injuries ?? {})).toHaveLength(0)
    const publicTeams = await (await fetch(`${base}/api/world/teams`, { headers: auth(second.token) })).json() as { divisions: { fixtures: { score?: unknown; played: boolean }[] }[] }
    expect(publicTeams.divisions.flatMap((item) => item.fixtures).some((item) => item.played || item.score)).toBe(false)
    const expected = resultAt(dir, ownJob.id).record.score
    servers.pop()!.close()
    clock = at(11, 45)
    ;({ base, app } = await start(() => clock, dir))
    await app.runMatchQueue()
    expect(entries(dir).every((entry) => entry.attempts === 1)).toBe(true)
    expect(playerFixture((await load(base, first.token)).game)!.played).toBe(false)
    // 开球：比赛进入 10 分钟直播，比分、积分榜、战报仍然不公开；教练拿到的是开球时的初始引擎状态。
    clock = at(12)
    await app.runMatchQueue()
    expect(worldAt(dir).divisions.flatMap((item) => item.fixtures).some((item) => item.played || item.score)).toBe(false)
    expect(entries(dir).every((entry) => entry.status === 'ready')).toBe(true)
    const watching = await load(base, first.token), watchingOpponent = await load(base, second.token)
    expect(playerFixture(watching.game)!.played).toBe(false)
    expect(watching.game.matchHistory).toHaveLength(0)
    const live = watching.game.activeMatch!
    expect(live).toMatchObject({ preplayed: true, startedAt: at(12), coachPausesLeft: 0, context: { isLeague: true, round: 1, durationSeconds: LOGIC_MATCH_SECONDS } })
    expect(watchingOpponent.game.activeMatch!.context.homeAway).not.toBe(live.context.homeAway)
    // 存档里带着服务器时钟：客户端先对准它再回放，本机时钟不准也不会把回放放到错的时刻。
    expect((await (await fetch(`${base}/api/game`, { headers: auth(first.token) })).json() as { serverTime: number }).serverTime).toBe(clock)
    // 直播回放就是算好的这场：从开球状态一路推进，比分和之后公布的完全一致。
    const replay = PesEngine.restore(live.engineState as never)
    expect(replay.state.score).toEqual({ home: 0, away: 0 })
    replay.advanceTo(LOGIC_MATCH_SECONDS + 30)
    expect(replay.state.finished).toBe(true)
    expect(replay.state.score).toEqual(expected)
    // 直播副本不会存回账号：旧页面把它原样交回来也只是被丢掉。
    expect((await save(base, first.token, watching)).status).toBe(200)
    expect((await load(base, first.token)).game.activeMatch?.preplayed).toBe(true)
    clock = at(12, 10) - 1
    await app.runMatchQueue()
    expect(worldAt(dir).divisions.flatMap((item) => item.fixtures).some((item) => item.played || item.score)).toBe(false)
    expect(entries(dir).every((entry) => entry.status === 'ready')).toBe(true)
    clock = at(12, 10)
    await app.runMatchQueue()
    const published = worldAt(dir)
    expect(published.divisions.every((item) => item.fixtures.filter((item) => item.round === 1).every((item) => item.played))).toBe(true)
    expect(entries(dir).every((entry) => entry.status === 'published' && entry.attempts === 1)).toBe(true)
    const one = await load(base, first.token), two = await load(base, second.token)
    // 比赛公布前的旧页面不能抹掉赛后收入、体能和战报。
    const stale = structuredClone(hidden)
    stale.game.ui = { screen: 'club' }
    const staleSave = await save(base, first.token, stale)
    expect(staleSave.status).toBe(409)
    expect((await load(base, first.token)).game.economy!.balance).toBe(one.game.economy!.balance)
    expect(playerFixture(one.game)!.score).toEqual(expected)
    expect(playerFixture(two.game)!.score).toEqual(expected)
    expect(one.game.matchHistory).toHaveLength(1)
    expect(two.game.matchHistory).toHaveLength(1)
    expect(one.game.matchHistory[0].id).toBe(two.game.matchHistory[0].id)
    expect(one.game.matchHistory[0].createdAt).toBe(at(12))
    // 公布后两位教练都能 2D 重看：服务器留着开球状态，从头回放得到公布的比分；对手视角相反。
    const matchId = one.game.matchHistory[0].id
    expect(one.game.matchHistory[0].hasReplay).toBe(true)
    expect(two.game.matchHistory[0].hasReplay).toBe(true)
    const replayOf = async (token: string, id: string) => fetch(`${base}/api/match/replay?id=${id}`, { headers: auth(token) })
    const mine = await replayOf(first.token, matchId)
    expect(mine.status).toBe(200)
    const replayData = await mine.json() as { engineState: never; homeAway: string; durationSeconds: number }
    expect(replayData.durationSeconds).toBe(LOGIC_MATCH_SECONDS)
    expect((await (await replayOf(second.token, matchId)).json() as { homeAway: string }).homeAway).not.toBe(replayData.homeAway)
    const rewatch = PesEngine.restore(replayData.engineState)
    expect(rewatch.state.score).toEqual({ home: 0, away: 0 })
    rewatch.advanceTo(LOGIC_MATCH_SECONDS + 30)
    expect(rewatch.state.score).toEqual(expected)
    // 没有登录、格式不对、不是自己的比赛，都拿不到。
    expect((await fetch(`${base}/api/match/replay?id=${matchId}`)).status).toBe(401)
    expect((await replayOf(first.token, 'q-nope')).status).toBe(404)
    expect((await replayOf(first.token, `q-${'0'.repeat(64)}`)).status).toBe(404)
    expect(one.game.training).toEqual(training)
    expect(one.game.economy!.academy).toBe(current.game.economy!.academy)
    expect(one.game.economy!.balance).toBeGreaterThan(current.game.economy!.balance)
    expect(one.game.roster[0].attrs.passing).toBe(lockedPassing + 17)
    expect(one.game.roster.some((player) => player.condition < 100)).toBe(true)
    // 客户端不能清空已公布战报，或者伪造下一轮比分。
    one.game.matchHistory = []
    const tired = one.game.roster.find((player) => player.condition < 100)!
    const savedCondition = tired.condition
    tired.condition = 100
    const future = playerFixture(one.game, 2)!
    future.played = true; future.score = { home: 99, away: 98 }
    expect((await save(base, first.token, one)).status).toBe(200)
    const safe = await load(base, first.token)
    expect(safe.game.matchHistory).toHaveLength(1)
    expect(safe.game.roster.find((player) => player.id === tired.id)!.condition).toBe(savedCondition)
    expect(playerFixture(safe.game, 2)!.played).toBe(false)
    const balance = safe.game.economy!.balance
    servers.pop()!.close()
    ;({ base, app } = await start(() => clock, dir))
    await app.runMatchQueue()
    const restored = await load(base, first.token)
    expect(restored.game.economy!.balance).toBe(balance)
    expect(restored.game.matchHistory).toHaveLength(1)
    expect(worldAt(dir).divisions).toEqual(published.divisions)
    // 新注册者只接管已经公布的 AI 战绩，不重算、不改写，也没有伪造的历史战报。
    clock = at(19)
    const old = worldAt(dir)
    const late = await register(base, 'late_coach', 'd2s_05')
    expect(playerFixture(late.game)!.played).toBe(true)
    expect(late.game.season.table.find((row) => row.teamId === 'player')!.played).toBe(1)
    expect(late.game.matchHistory).toHaveLength(0)
    expect((await replayOf(late.token, matchId)).status).toBe(404)
    expect(nextMatchCountdown(late.game, clock)).toBe('1 小时 0 分')
    expect(worldAt(dir).divisions).toEqual(old.divisions)
  }, 120_000)

  it('没有账号和 HTTP 请求也自动排队计算并到点发布', async () => {
    let clock = at(11)
    const { app, dir } = await start(() => clock, undefined, 20)
    clock = at(11, 30)
    const wait = async (predicate: () => boolean) => {
      const end = Date.now() + 60_000
      while (!predicate()) {
        if (Date.now() > end) throw new Error('后台队列未按时推进')
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    await wait(() => entries(dir).length === 40 && entries(dir).every((entry) => entry.status === 'ready'))
    expect(app.accountCount()).toBe(0)
    expect(worldAt(dir).divisions.flatMap((item) => item.fixtures).some((item) => item.played)).toBe(false)
    clock = at(12)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(worldAt(dir).divisions.flatMap((item) => item.fixtures).some((item) => item.played)).toBe(false)
    clock = at(12, 10)
    await wait(() => entries(dir).every((entry) => entry.status === 'published'))
    expect(worldAt(dir).divisions.every((item) => item.table.every((row) => row.played === 1))).toBe(true)
  }, 120_000)
})
