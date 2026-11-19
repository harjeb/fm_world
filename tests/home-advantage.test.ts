import { describe, expect, it } from 'vitest'
import { createWorldGame } from '../src/game/world.ts'
import { economyOf, homeAtmosphereBonus, MAX_FACILITY_STAGE } from '../src/game/economy.ts'
import { buildMatchEngineForGame } from '../src/game/match/setup.ts'
import { MatchRatings } from '../src/game/match/ratings.ts'
import { MotionRatings } from '../src/game/pes/ability.ts'
import { PesEngine } from '../src/game/pes/engine.ts'
import { computeMatchJob, type MatchJob } from '../server/match-job.ts'
import { inputFor, makeTeams } from './helpers.ts'

describe('2D 引擎主场氛围与球场等级加成', () => {
  it('只对主队生效且随球场阶段递增，客队与无球场数据的旧赛程不受影响', () => {
    const { roster, lineup } = makeTeams(101)
    const cleanHome = inputFor(roster, lineup, 'h', '主队')
    const cleanAway = inputFor(roster, lineup, 'a', '客队')

    const neutral = new PesEngine({ seed: 7, home: cleanHome, away: cleanAway, knockout: false, durationSeconds: 600, offside: true })
    const lv1Home = { ...cleanHome, stadiumStage: 1 }
    const lv5Home = { ...cleanHome, stadiumStage: MAX_FACILITY_STAGE }
    const lv1 = new PesEngine({ seed: 7, home: lv1Home, away: cleanAway, knockout: false, durationSeconds: 600, offside: true })
    const lv5 = new PesEngine({ seed: 7, home: lv5Home, away: cleanAway, knockout: false, durationSeconds: 600, offside: true })

    // 传入客队的 stadiumStage 不会在客队侧生效
    const awayWithStage = { ...cleanAway, stadiumStage: MAX_FACILITY_STAGE }
    const awayCheck = new PesEngine({ seed: 7, home: cleanHome, away: awayWithStage, knockout: false, durationSeconds: 600, offside: true })
    expect(awayCheck.state.teams[0].stadiumStage).toBeUndefined()
    expect(awayCheck.state.teams[1].stadiumStage).toBeUndefined()

    const r0 = new MatchRatings(() => neutral.state, () => neutral.state.durationSeconds)
    const r1 = new MatchRatings(() => lv1.state, () => lv1.state.durationSeconds)
    const r5 = new MatchRatings(() => lv5.state, () => lv5.state.durationSeconds)

    const hp0 = neutral.state.teams[0].players[1]
    const hp1 = lv1.state.teams[0].players[1]
    const hp5 = lv5.state.teams[0].players[1]
    const ap0 = neutral.state.teams[1].players[1]
    const ap5 = lv5.state.teams[1].players[1]

    // 主队属性按 homeAtmosphereBonus 精确抬升（1 阶段 +1.0，25 阶段 +3.0）
    expect(r1.eff(hp1, 'passing') - r0.eff(hp0, 'passing')).toBeCloseTo(homeAtmosphereBonus(1), 5)
    expect(r5.eff(hp5, 'passing') - r0.eff(hp0, 'passing')).toBeCloseTo(homeAtmosphereBonus(MAX_FACILITY_STAGE), 5)
    expect(r5.eff(hp5, 'passing')).toBeGreaterThan(r1.eff(hp1, 'passing'))

    // 客队不受主队球场氛围影响
    expect(r5.eff(ap5, 'passing')).toBeCloseTo(r0.eff(ap0, 'passing'), 5)

    // 2D 运动层（MotionRatings）同样同步体现主场微弱加成
    const m0 = new MotionRatings(() => neutral.state, () => neutral.state.durationSeconds)
    const m5 = new MotionRatings(() => lv5.state, () => lv5.state.durationSeconds)
    expect(m5.abilities(hp5).passing).toBeGreaterThan(m0.abilities(hp0).passing)
    expect(m5.abilities(ap5).passing).toBeCloseTo(m0.abilities(ap0).passing, 6)
  })

  it('联赛与杯赛写入主队球场阶段，中立挑战赛不写入；PES 序列化读档完全一致', () => {
    const game = createWorldGame(55)
    economyOf(game).stadium = 18
    const opp = game.aiTeams[0]
    if (game.aiClubs?.[opp.id]) game.aiClubs[opp.id].economy.stadium = 12

    const homeLeague = buildMatchEngineForGame(game, {
      isLeague: true, round: 1, opponentId: opp.id, opponentName: opp.name, seed: 11, homeAway: 'home', durationSeconds: 600, offside: true,
    }, opp)
    expect(homeLeague.state.teams[0].stadiumStage).toBe(18)
    expect(homeLeague.state.teams[1].stadiumStage).toBeUndefined()

    const awayLeague = buildMatchEngineForGame(game, {
      isLeague: true, round: 2, opponentId: opp.id, opponentName: opp.name, seed: 12, homeAway: 'away', durationSeconds: 600, offside: true,
    }, opp)
    expect(awayLeague.state.teams[0].stadiumStage).toBe(12)
    expect(awayLeague.state.teams[1].stadiumStage).toBeUndefined()

    const challenge = buildMatchEngineForGame(game, {
      isLeague: false, mode: 'friendly', opponentId: opp.id, opponentName: opp.name, seed: 13, homeAway: 'home', durationSeconds: 600, offside: true,
    }, opp)
    expect(challenge.state.teams[0].stadiumStage).toBeUndefined()

    const peak = buildMatchEngineForGame(game, {
      isLeague: false, mode: 'peak', stage: 1, opponentId: opp.id, opponentName: opp.name, seed: 14, homeAway: 'home', durationSeconds: 600, offside: true,
    }, opp)
    expect(peak.state.teams[0].stadiumStage).toBeUndefined()

    // 序列化后通过 PesEngine.restore 重播，比分与最终状态完全一致
    const saved = homeLeague.serialize()
    expect(saved.teams[0].stadiumStage).toBe(18)
    const direct = homeLeague.simulate()
    const replayed = PesEngine.restore(saved).simulate()
    expect(replayed.score).toEqual(direct.score)
    expect(replayed.stats).toEqual(direct.stats)
  })

  it('联机任务队列 computeMatchJob 正确传递主队球场阶段到初始回放状态', () => {
    const game = createWorldGame(77)
    const homeTeam = game.aiTeams[0]
    const awayTeam = game.aiTeams[1]
    const job: MatchJob = {
      id: 'q-home-stage-test',
      season: 1,
      divisionId: 'd2-north',
      round: 1,
      kickoffAt: Date.now(),
      lockedAt: Date.now() - 60_000,
      seed: 9001,
      gameDayMs: 7_200_000,
      home: {
        team: homeTeam,
        injuries: {},
        suspended: [],
        medical: 1,
        tacticsStage: 5,
        stadiumStage: 20,
        coachId: 'coach-home',
      },
      away: {
        team: awayTeam,
        injuries: {},
        suspended: [],
        medical: 1,
        tacticsStage: 5,
        stadiumStage: 25,
        ai: true,
      },
    }
    const result = computeMatchJob(job)
    expect(result.initialState?.teams[0].stadiumStage).toBe(20)
    expect(result.initialState?.teams[1].stadiumStage).toBeUndefined()
  })
})
