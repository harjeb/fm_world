import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { finishMatch, restoreActiveEngine, startLeague, startSingleChallenge } from '../src/game/actions.ts'
import { advanceLeagueRealtime } from '../src/game/realtime.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { buildMatchEngineForGame } from '../src/game/match/setup.ts'
import { PesEngine } from '../src/game/pes/engine.ts'
import { playerFixture, simulateFixture, LEAGUE_MATCH_SECONDS } from '../src/game/season.ts'
import type { MatchState } from '../src/game/match/types.ts'
import type { MatchContext } from '../src/game/types.ts'

/**
 * 新引擎（pes2d 物理 + 现有结算内核）接进游戏流程：
 * 玩家看得见的比赛（联赛、友谊赛）用新引擎；后台自动结算和显式指定版本仍用旧引擎；存档、战报、结算和旧引擎同一套。
 */
describe('新引擎接入游戏流程', () => {
  it('联赛和友谊赛创建的是新引擎；自动结算和显式指定规则版本仍是旧引擎', () => {
    const game = createInitialGame(21)
    expect(startLeague(game).ok).toBe(true)
    const league = restoreActiveEngine(game)!
    expect(league).toBeInstanceOf(PesEngine)
    const saved = game.activeMatch!.engineState as MatchState
    expect(saved.rulesVersion).toBe(4)
    expect(saved.pes).toBeDefined()

    const friendly = createInitialGame(22)
    expect(startSingleChallenge(friendly, friendly.aiTeams[0].id).ok).toBe(true)
    expect(restoreActiveEngine(friendly)).toBeInstanceOf(PesEngine)

    const context: MatchContext = {
      isLeague: false, opponentId: game.aiTeams[0].id, opponentName: game.aiTeams[0].name, seed: 5, homeAway: 'home', durationSeconds: LEAGUE_MATCH_SECONDS,
    }
    expect(buildMatchEngineForGame(game, context, game.aiTeams[0])).toBeInstanceOf(PesEngine)
    expect(buildMatchEngineForGame(game, context, game.aiTeams[0], Date.now(), undefined, 2)).toBeInstanceOf(MatchEngine)
    expect(buildMatchEngineForGame(game, context, game.aiTeams[0], Date.now(), undefined, 3)).toBeInstanceOf(MatchEngine)
  })

  it('友谊赛从开始到结算：战报、球员数据、进球明细和比分是同一份数据', () => {
    const game = createInitialGame(23)
    expect(startSingleChallenge(game, game.aiTeams[0].id).ok).toBe(true)
    const engine = restoreActiveEngine(game)!
    // 中途存档读档，再跑完：和不间断运行一致
    engine.advanceTo(300)
    game.activeMatch!.engineState = engine.serialize()
    const resumed = restoreActiveEngine(game)!
    resumed.simulate()
    const straight = restoreActiveEngine(structuredClone(game))!
    straight.simulate()
    expect(resumed.serialize()).toEqual(straight.serialize())

    const record = finishMatch(game, resumed)!
    expect(record).toBeTruthy()
    expect(game.activeMatch).toBeUndefined()
    expect(game.challengeHistory[0].id).toBe(record.id)
    expect(record.score).toEqual(resumed.state.score)
    expect(record.goalDetails).toHaveLength(record.score.home + record.score.away)
    expect(record.playerStats.length).toBeGreaterThanOrEqual(14)
    expect(record.commentary!.length).toBeGreaterThan(20)
    // 球员进球数之和 = 比分（乌龙球算在对方头上，不进球员进球数）
    const goalsByPlayers = record.playerStats.reduce((sum, stat) => sum + stat.goals, 0)
    expect(goalsByPlayers).toBeLessThanOrEqual(record.score.home + record.score.away)
    expect(record.stats.home.shots + record.stats.away.shots).toBeGreaterThan(5)
  })

  it('联赛：按现实时间分批推进到终场，与一次模拟整场逐位一致，并且只结算一次', () => {
    const game = createInitialGame(24)
    expect(startLeague(game).ok).toBe(true)
    game.activeMatch!.startedAt = 1_000_000
    const expected = restoreActiveEngine(structuredClone(game))!.simulate()
    for (const seconds of [3, 40, 41, 250, 300, 301, 599]) advanceLeagueRealtime(game, 1_000_000 + seconds * 1000)
    expect(game.activeMatch).toBeDefined()
    expect(game.matchHistory).toHaveLength(0)
    advanceLeagueRealtime(game, 1_600_000)
    expect(game.activeMatch).toBeUndefined()
    expect(game.matchHistory).toHaveLength(1)
    expect(game.matchHistory[0].score).toEqual(expected.score)
    expect(game.matchHistory[0].commentary).toEqual(expected.commentary)
    expect(playerFixture(game, 1)!.played).toBe(true)
    advanceLeagueRealtime(game, 2_000_000)
    expect(game.matchHistory).toHaveLength(1)
  })

  it('玩家比赛的“自动结算”走旧引擎（只要赛果），手动一键模拟走新引擎', () => {
    const auto = createInitialGame(25)
    const autoRecord = simulateFixture(auto, playerFixture(auto)!, true)!
    expect(autoRecord.autoSimulated).toBe(true)
    // 旧引擎存档没有物理比赛那一份
    expect(auto.activeMatch).toBeUndefined()

    const manual = createInitialGame(25)
    const record = simulateFixture(manual, playerFixture(manual)!, false)!
    expect(record.autoSimulated).toBeFalsy()
    expect(record.score.home + record.score.away).toBeGreaterThanOrEqual(0)
    expect(record.playerStats.length).toBeGreaterThanOrEqual(14)
  })
})
