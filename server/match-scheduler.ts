import type { AIClubState, AITeam, Fixture, WorldState } from '../src/game/types.ts'
import { awardAISeasonCup } from '../src/game/season-cup-rewards.ts'
import { seasonCupPlayerStats } from '../src/game/season-cup-stats.ts'
import { computeWorldTable } from '../src/game/world.ts'
import { SEASON_CUP_QUALIFICATION_ROUND, advanceSeasonCup, applySeasonCupPlan, completedWorldRound, planSeasonCups, seasonRoundKickoff, worldRoundsKickedOff, type SeasonCupFixture } from '../src/game/season-cups.ts'
import { recordMatchDiscipline } from '../src/game/discipline.ts'
import { splitSeed } from '../src/game/rng.ts'
import { LINEUP_LOCK_MS } from '../src/game/season.ts'
import { LEAGUE_REALTIME_MS } from '../src/game/match/time.ts'
import { RECENT_MATCHES } from '../src/game/transfer-rules.ts'
import { settleCondition } from '../src/game/condition.ts'
import { aiMatchLineup } from '../src/game/match/setup.ts'
import { chemistrySnapshot, pruneChemistry, recordMatchChemistry } from '../src/game/chemistry.ts'
import { MatchQueue } from './match-queue.ts'
import { emptyMatchBook, matchJobId, seasonCupJobId, type LockedTeam, type MatchBook, type MatchJob, type MatchJobResult } from './match-job.ts'

export type ScheduledWorld = {
  seed: number
  world: WorldState
  teams?: Record<string, AITeam>
  aiClubs?: Record<string, AIClubState>
  matchBook?: MatchBook
}

export class MatchScheduler {
  constructor(
    readonly queue: MatchQueue,
    private readonly shared: ScheduledWorld,
    private readonly teamFor: (id: string) => LockedTeam | null,
    private readonly persist: () => void,
    /** 开发期安全开关：完整接入和迁移验证前不主动改变生产赛程。 */
    private readonly enableSeasonCups = false,
  ) { shared.matchBook ??= emptyMatchBook() }

  /**
   * 这里只入队、同步已公开赛果；无论从 HTTP 还是定时器调用都不执行仿真。
   * 开球后比赛要“直播” 10 分钟（LEAGUE_REALTIME_MS），比分、积分榜、战报都等到这之后才一起公布。
   */
  refresh(now: number): boolean {
    const { world } = this.shared
    let changed = false
    const plan = this.enableSeasonCups ? planSeasonCups(world, this.shared.seed, now) : undefined
    const applicable = !!plan && plan.delayedLeagueRounds.every(round => world.divisions.every(division => division.fixtures.filter(fixture => fixture.round === round).every(fixture => !this.queue.entries.has(matchJobId(world.seasonIndex, division.divisionId!, fixture)))))
    // 当前赛季已过资格轮但剩余日期不足或目标联赛已锁时，不隐藏仍可使用的旧挑战杯。
    if (this.enableSeasonCups && world.seasonCupMode !== 1 && (completedWorldRound(world) < SEASON_CUP_QUALIFICATION_ROUND || applicable)) { world.seasonCupMode = 1; changed = true }
    if (plan && applicable) {
      applySeasonCupPlan(world, plan)
      this.persist()
      changed = true
    }
    const round = Math.min(38, Math.max(1, worldRoundsKickedOff(world, now)))
    for (const division of world.divisions) {
      if (division.round !== round) { division.round = round; changed = true }
    }
    if (changed) this.persist()
    const published = this.publishDue(now)
    const cupsPublished = this.publishCupDue(now)
    this.prepare(now)
    this.prepareCups(now)
    const caughtUp = world.divisions.every(d => d.fixtures.every(f => f.played || seasonRoundKickoff(d, f.round) + LEAGUE_REALTIME_MS > now))
    if (caughtUp && pruneChemistry(this.shared.matchBook!.chemistry, now, world.divisions[0]?.gameDayMs)) { this.persist(); changed = true }
    return changed || published || cupsPublished
  }

  private prepare(now: number): void {
    const { world } = this.shared
    const pending = world.divisions.flatMap((division) => division.fixtures.filter((fixture) => !fixture.played))
    for (const division of world.divisions) for (const fixture of division.fixtures) {
      if (fixture.played) continue
      const kickoffAt = seasonRoundKickoff(division, fixture.round)
      if (now < kickoffAt - LINEUP_LOCK_MS || this.cupPendingBefore(kickoffAt)) continue
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
        // 没有教练的电脑球队（或超过 3 天未上线的 AI 接管球队）：锁定这一刻就按开球时的体能与伤停轮换
        // （体能低于 80 或受伤的先休息、停赛的不排），阵容连同快照一起冻结，战报里记的也是真正上场的名单。
        if (locked.ai || locked.aiTakeover) {
          const injured = new Set(Object.entries(locked.injuries).filter(([, until]) => until > kickoffAt).map(([id]) => id))
          locked.team.lineup = aiMatchLineup(locked.team, new Set(locked.suspended), true, injured)
        }
        locked.chemistry = chemistrySnapshot(this.shared.matchBook!.chemistry, [...locked.team.lineup.starters.map(p => p.playerId), ...locked.team.lineup.bench], kickoffAt, job.gameDayMs)
      }
      this.queue.enqueue(job)
    }
  }

  private publishDue(now: number): boolean {
    const { world } = this.shared
    let published = false
    const rounds = [...new Set(world.divisions.flatMap((division) => division.fixtures.filter((fixture) => !fixture.played && seasonRoundKickoff(division, fixture.round) + LEAGUE_REALTIME_MS <= now).map((fixture) => fixture.round)))].sort((a, b) => a - b)
    for (const round of rounds) {
      if (this.cupPendingBefore(seasonRoundKickoff(world.divisions[0], round))) break
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

  /** 只要更早的杯赛尚未公开，不能按旧体能/伤停锁定或发布后面的正式比赛。 */
  private cupPendingBefore(kickoffAt: number): boolean {
    const cups = this.shared.world.seasonCups?.cups ?? []
    return cups.some(cup => cup.dates.some((date, index) => date < kickoffAt && (!cup.rounds[index] || cup.rounds[index].fixtures.some(fixture => !fixture.played))))
  }

  private prepareCups(now: number): void {
    const world = this.shared.world
    const cups = world.seasonCups?.cups ?? []
    for (const cup of cups) {
      const round = cup.rounds.at(-1)
      if (!round || cup.championId || now < round.kickoffAt - LINEUP_LOCK_MS || this.cupPendingBefore(round.kickoffAt)) continue
      // 跨赛事严格按时间顺序；早于本杯赛的联赛必须先公布。
      if (world.divisions.some(division => division.fixtures.some(fixture => !fixture.played && seasonRoundKickoff(division, fixture.round) < round.kickoffAt))) continue
      for (const fixture of round.fixtures) {
        if (fixture.played) continue
        const id = seasonCupJobId(world.seasonIndex, cup.id, fixture.id)
        if (this.queue.entries.has(id)) continue
        const home = this.teamFor(fixture.homeId), away = this.teamFor(fixture.awayId)
        if (!home || !away) continue
        const discipline = this.shared.matchBook!.cupDiscipline?.[cup.id]
        for (const locked of [home, away]) {
          locked.suspended = Object.entries(discipline?.suspensions ?? {}).filter(([, ban]) => ban.matches > 0 && ban.atRound <= round.round).map(([playerId]) => playerId)
          for (const player of locked.team.players) settleCondition(player, round.kickoffAt, world.divisions[0].gameDayMs, this.shared.matchBook!.conditionAt[player.id])
          if (locked.ai || locked.aiTakeover) {
            const injured = new Set(Object.entries(locked.injuries).filter(([, until]) => until > round.kickoffAt).map(([playerId]) => playerId))
            locked.team.lineup = aiMatchLineup(locked.team, new Set(locked.suspended), true, injured)
          }
          locked.chemistry = chemistrySnapshot(this.shared.matchBook!.chemistry, [...locked.team.lineup.starters.map(player => player.playerId), ...locked.team.lineup.bench], round.kickoffAt, world.divisions[0].gameDayMs)
        }
        const job: MatchJob = {
          id, season: world.seasonIndex, divisionId: `season-cup-${cup.id}`, round: round.round,
          competition: { kind: 'seasonCup', cupId: cup.id, fixtureId: fixture.id },
          kickoffAt: round.kickoffAt, lockedAt: round.kickoffAt - LINEUP_LOCK_MS,
          seed: splitSeed(this.shared.seed, `season-cup-${world.seasonIndex}-${fixture.id}`),
          gameDayMs: world.divisions[0].gameDayMs, home: structuredClone(home), away: structuredClone(away),
        }
        this.queue.enqueue(job)
      }
    }
  }

  private publishCupDue(now: number): boolean {
    const world = this.shared.world
    const cups = world.seasonCups?.cups ?? []
    let published = false
    const dates = [...new Set(cups.flatMap(cup => cup.dates))].filter(date => date + LEAGUE_REALTIME_MS <= now).sort((a, b) => a - b)
    for (const date of dates) {
      if (this.cupPendingBefore(date)) break
      const scheduled = cups.flatMap(cup => {
        const index = cup.dates.indexOf(date)
        if (index < 0) return []
        const round = cup.rounds[index]
        return round ? [{ cup, round }] : []
      })
      if (scheduled.some(({ round }) => round.fixtures.some(fixture => !fixture.played && !this.queue.ready(seasonCupJobId(world.seasonIndex, fixture.cupId, fixture.id))))) break
      const ready: { fixture: SeasonCupFixture; job: MatchJob; result: MatchJobResult; winner: string }[] = []
      for (const { round } of scheduled) for (const fixture of round.fixtures) {
        if (fixture.played) continue
        const { input, result } = this.queue.read(seasonCupJobId(world.seasonIndex, fixture.cupId, fixture.id))
        const score = result.record.score
        const shootout = result.record.shootout
        if (score.home === score.away && (!shootout || shootout.home === shootout.away)) throw new Error(`杯赛 ${fixture.id} 缺少有效点球结果`)
        const homeWins = score.home > score.away || score.home === score.away && shootout!.home > shootout!.away
        ready.push({ fixture, job: input, result, winner: homeWins ? fixture.homeId : fixture.awayId })
      }
      for (const { fixture, job, result, winner } of ready) {
        this.applyEffects(job, result)
        Object.assign(fixture, { played: true, score: { ...result.record.score }, ...(result.record.shootout ? { shootout: { ...result.record.shootout } } : {}), winnerId: winner, matchId: job.id, scorers: result.fixture.scorers ?? [], assisters: result.fixture.assisters ?? [], playerStats: seasonCupPlayerStats(result.record) })
      }
      for (const { cup } of scheduled) {
        advanceSeasonCup(cup, world.seasonIndex, this.shared.seed)
        if (cup.championId) {
          const final = ready.find(item => item.fixture.cupId === cup.id && item.winner === cup.championId)
          const locked = final && (final.job.home.team.id === cup.championId ? final.job.home : final.job.away)
          const ai = locked && !locked.coachId ? this.shared.aiClubs?.[cup.championId] : undefined
          if (ai && final) awardAISeasonCup(ai, cup.id, final.job.id, world.seasonIndex, true)
        }
      }
      if (ready.length) {
        this.persist()
        this.queue.published(ready.map(item => item.job.id))
        published = true
      }
    }
    return published
  }

  private applyEffects(job: MatchJob, result: MatchJobResult): void {
    const book = this.shared.matchBook!
    recordMatchChemistry(book, result.record.playerStats, job.kickoffAt, job.gameDayMs)
    const ids = new Set(Object.keys(result.appearances))
    const discipline = job.competition
      ? ((book.cupDiscipline ??= {})[job.competition.cupId] ??= { suspensions: {}, yellowCounts: {} })
      : book
    for (const id of ids) {
      const ban = discipline.suspensions[id]
      if (ban && ban.atRound <= job.round) {
        if (--ban.matches <= 0) delete discipline.suspensions[id]
        else ban.atRound = job.round + 1
      }
      if (!job.competition) book.appearances[id] = [...(book.appearances[id] ?? []), result.appearances[id]].slice(-RECENT_MATCHES)
    }
    recordMatchDiscipline({ ...discipline, season: { round: job.round } }, { log: result.cards })
    for (const [id, until] of Object.entries(result.injuries)) book.injuries[id] = Math.max(book.injuries[id] ?? 0, until)
    // 只合并比赛产生的变化，绝不拿锁定时的整队/整个账号覆盖期间的训练、转会或经营。
    for (const team of Object.values(this.shared.teams ?? {})) for (const player of team.players) {
      if (!ids.has(player.id)) continue
      // 先把休息恢复结算到开球，再扣这场的消耗（踢满 90 分钟 70 点，见 condition.ts）。
      settleCondition(player, job.kickoffAt, job.gameDayMs, book.conditionAt[player.id])
      player.condition = Math.max(1, Math.min(100, (player.condition ?? 100) - (result.conditionLoss[player.id] ?? 0)))
    }
    for (const id of ids) book.conditionAt[id] = job.kickoffAt
    if (job.competition) {
      for (const locked of [job.home, job.away]) {
        const ai = !locked.coachId ? this.shared.aiClubs?.[locked.team.id] : undefined
        if (ai) awardAISeasonCup(ai, job.competition.cupId, job.id, job.season, false)
      }
    }
  }
}
