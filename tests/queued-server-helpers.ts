import fs from 'node:fs'
import path from 'node:path'
import type { AppServer } from '../server/app.ts'
import type { MatchJob, MatchJobResult } from '../server/match-job.ts'
import type { MatchTeamStats, WorldState } from '../src/game/types.ts'
import { kickoffAtForRound } from '../src/game/calendar.ts'
import { LEAGUE_REALTIME_MS } from '../src/game/match/time.ts'
import type { JobEntry } from '../server/match-queue.ts'

/** 赛季/账号集成测试使用廉价的确定性执行器；真实引擎和子进程由 shared-kickoff.test 覆盖。 */
export async function fastMatchResult(job: MatchJob): Promise<MatchJobResult> {
  const stats = (): MatchTeamStats => ({ possession: 50, passes: 0, passesCompleted: 0, shots: 0, shotsOnTarget: 0, goals: 0, interceptions: 0, tackles: 0, fouls: 0, corners: 0, xg: 0, distance: 0, yellowCards: 0, redCards: 0 })
  const score = { home: job.seed % 3, away: job.seed % 3 }
  return {
    id: job.id,
    record: { id: job.id, seed: job.seed, createdAt: job.kickoffAt, seasonIndex: job.season, durationSeconds: 900, isLeague: true, round: job.round,
      homeId: job.home.team.id, awayId: job.away.team.id, homeName: job.home.team.name, awayName: job.away.team.name, score, result: 'draw',
      stats: { home: stats(), away: stats() }, playerStats: [], skillStats: [], failureStats: [], keyEvents: [], instructions: [], lineup: job.home.team.lineup, opponentId: job.away.team.id, autoSimulated: true },
    fixture: { score, matchId: job.id, scorers: [], assisters: [], autoSimulated: true },
    injuries: {}, conditionLoss: {}, appearances: Object.fromEntries([...job.home.team.players, ...job.away.team.players].map((player) => [player.id, 0])), cards: [],
  }
}

/** tickMs=0 的测试显式驱动后台任务，不再把一次登录误当作同步模拟整轮/整季。 */
export async function drainServerQueue(app: AppServer, dir: string, now: number): Promise<void> {
  for (let i = 0; i < 4000; i++) {
    await app.runMatchQueue()
    // 测试执行器是立即返回的 Promise，也要像真实子进程一样让 HTTP/keep-alive 事件循环运行。
    await new Promise<void>((resolve) => setImmediate(resolve))
    if (i % 40 !== 39) continue
    const index = path.join(dir, 'match-jobs/index.json')
    const entries = fs.existsSync(index) ? JSON.parse(fs.readFileSync(index, 'utf8')) as JobEntry[] : []
    const { world } = JSON.parse(fs.readFileSync(path.join(dir, 'world.json'), 'utf8')) as { world: WorldState }
    const due = world.divisions.some((division) => division.fixtures.some((fixture) => !fixture.played && kickoffAtForRound(world.seasonStartedAt, fixture.round) + LEAGUE_REALTIME_MS <= now))
    if (!due && !entries.some((entry) => entry.status === 'queued' || entry.status === 'running')) return
  }
  throw new Error('测试后台队列未清空')
}
