import type { AITeam, Fixture, WorldState } from '../src/game/types.ts'
import { computeWorldTable } from '../src/game/world.ts'
import { kickoffAtForRound, roundsKickedOff } from '../src/game/calendar.ts'
import { recordMatchDiscipline } from '../src/game/discipline.ts'
import { splitSeed } from '../src/game/rng.ts'
import { LINEUP_LOCK_MS } from '../src/game/season.ts'
import { RECENT_MATCHES } from '../src/game/transfer-rules.ts'
import { settleCondition } from '../src/game/condition.ts'
import { MatchQueue } from './match-queue.ts'
import { emptyMatchBook, matchJobId, type LockedTeam, type MatchBook, type MatchJob, type MatchJobResult } from './match-job.ts'

export type ScheduledWorld = {
  seed: number
  world: WorldState
  teams?: Record<string, AITeam>
  matchBook?: MatchBook
}

export class MatchScheduler {
  constructor(
    readonly queue: MatchQueue,
    private readonly shared: ScheduledWorld,
    private readonly teamFor: (id: string) => LockedTeam | null,
    private readonly persist: () => void,
  ) { shared.matchBook ??= emptyMatchBook() }

  /** 这里只入队、同步已公开赛果；无论从 HTTP 还是定时器调用都不执行仿真。 */
  refresh(now: number): boolean {
    const { world } = this.shared
    let changed = false
    const round = Math.min(38, Math.max(1, roundsKickedOff(world.seasonStartedAt, now)))
    for (const division of world.divisions) {
      if (division.round !== round) { division.round = round; changed = true }
    }
    if (changed) this.persist()
    const published = this.publishDue(now)
    this.prepare(now)
    return changed || published
  }

  private prepare(now: number): void {
    const { world } = this.shared
    const pending = world.divisions.flatMap((division) => division.fixtures.filter((fixture) => !fixture.played))
    for (const division of world.divisions) for (const fixture of division.fixtures) {
      if (fixture.played) continue
      const kickoffAt = kickoffAtForRound(world.seasonStartedAt, fixture.round)
      if (now < kickoffAt - LINEUP_LOCK_MS) continue
      const id = matchJobId(world.seasonIndex, division.divisionId!, fixture)
      if (this.queue.entries.has(id)) continue
      // 停服恢复时先完成上一场，再锁下一场，避免同一个球员漏记体能、伤病和停赛。
      if (pending.some((old) => old.round < fixture.round && [old.homeId, old.awayId].some((club) => club === fixture.homeId || club === fixture.awayId))) continue
      const home = this.teamFor(fixture.homeId), away = this.teamFor(fixture.awayId)
      if (!home || !away) continue
      const job: MatchJob = {
        id, season: world.seasonIndex, divisionId: division.divisionId!, round: fixture.round,
        kickoffAt, lockedAt: kickoffAt - LINEUP_LOCK_MS, seed: splitSeed(division.seed, `queued-${fixture.round}-${fixture.homeId}-${fixture.awayId}`),
        gameDayMs: division.gameDayMs, home: structuredClone(home), away: structuredClone(away),
      }
      // 锁定到开球还有一段时间：快照里的体能按每小时的恢复结算到开球那一刻。
      for (const locked of [job.home, job.away]) {
        for (const player of locked.team.players) settleCondition(player, kickoffAt, job.gameDayMs, this.shared.matchBook!.conditionAt[player.id])
      }
      this.queue.enqueue(job)
    }
  }

  private publishDue(now: number): boolean {
    const { world } = this.shared
    let published = false
    const rounds = [...new Set(world.divisions.flatMap((division) => division.fixtures.filter((fixture) => !fixture.played && kickoffAtForRound(world.seasonStartedAt, fixture.round) <= now).map((fixture) => fixture.round)))].sort((a, b) => a - b)
    for (const round of rounds) {
      const pending = world.divisions.flatMap((division) => division.fixtures.filter((fixture) => fixture.round === round && !fixture.played).map((fixture) => ({ division, fixture, id: matchJobId(world.seasonIndex, division.divisionId!, fixture) })))
      // 同轮全部准备好后一次发布，绝不提前泄露某一场结果，也不让后续轮次越过未完成的轮次。
      if (!pending.every((item) => this.queue.ready(item.id))) break
      for (const { fixture, id } of pending) {
        const { input, result } = this.queue.read(id)
        this.applyEffects(input, result)
        Object.assign(fixture, result.fixture, { played: true })
      }
      const names = new Map(world.clubs.map((club) => [club.id, club.name]))
      for (const division of world.divisions) {
        division.table = computeWorldTable(division.clubIds ?? [], division.fixtures, names)
        division.finished = division.fixtures.every((fixture) => fixture.played)
        division.champion = division.finished ? division.table[0]?.teamId ?? null : null
      }
      // 这是发布事务的提交点：比分与球员状态在同一份原子 world.json 中落盘。
      this.persist()
      this.queue.published(pending.map((item) => item.id))
      published = true
    }
    return published
  }

  private applyEffects(job: MatchJob, result: MatchJobResult): void {
    const book = this.shared.matchBook!
    const ids = new Set(Object.keys(result.appearances))
    for (const id of ids) {
      const ban = book.suspensions[id]
      if (ban && ban.atRound <= job.round) {
        if (--ban.matches <= 0) delete book.suspensions[id]
        else ban.atRound = job.round + 1
      }
      book.appearances[id] = [...(book.appearances[id] ?? []), result.appearances[id]].slice(-RECENT_MATCHES)
    }
    recordMatchDiscipline({ ...book, season: { round: job.round } }, { log: result.cards })
    for (const [id, until] of Object.entries(result.injuries)) book.injuries[id] = Math.max(book.injuries[id] ?? 0, until)
    // 只合并比赛产生的变化，绝不拿锁定时的整队/整个账号覆盖期间的训练、转会或经营。
    for (const team of Object.values(this.shared.teams ?? {})) for (const player of team.players) {
      if (!ids.has(player.id)) continue
      // 先把休息恢复结算到开球，再扣这场的消耗（踢满 90 分钟 70 点，见 condition.ts）。
      settleCondition(player, job.kickoffAt, job.gameDayMs, book.conditionAt[player.id])
      player.condition = Math.max(1, Math.min(100, (player.condition ?? 100) - (result.conditionLoss[player.id] ?? 0)))
    }
    for (const id of ids) book.conditionAt[id] = job.kickoffAt
  }
}
