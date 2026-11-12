import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { runAutoTraining, setAutoTrainingConfig, startTraining, startTrainingWithSupport, trainingAction } from '../src/game/actions.ts'
import { economyOf } from '../src/game/economy.ts'
import { createTrainingSession, eligibleEvents, facilityGrowthBonus, performTrainingAction, planTraining, resolveTrainingEvent, trainingActionsForSeason, trainingDaysForSeason } from '../src/game/training.ts'
import { EVENTS } from '../src/game/data/events.ts'
import { PLAYER_SEEDS, createPlayerFromSeed } from '../src/game/data/players.ts'
import { caCeilingOf, caOf } from '../src/game/ca.ts'

describe('facility training growth', () => {
  it('adds exactly one category and stadium, in raw units', () => {
    const player = createInitialGame(4).roster.find(p => !p.positions.GK)!
    const session = createTrainingSession(player, 8, { stadium: 10, academy: 15, medical: 15, shop: 20, sponsor: 25, psychology: 20, tactics: 25 })
    delete session.scheduleVersion
    // 每级第 5 阶段是 100% 触发：球场 +4/级（2级=+8），分项 +10/级（3级=+30，4级=+40，5级=+50）。
    expect(facilityGrowthBonus(session, 'speed')).toBeCloseTo(38)
    expect(facilityGrowthBonus(session, 'passing')).toBeCloseTo(38)
    expect(facilityGrowthBonus(session, 'teamwork')).toBeCloseTo(48)
    expect(facilityGrowthBonus(session, 'vision')).toBeCloseTo(58)
    expect(facilityGrowthBonus(session, 'speed') - 8).toBeCloseTo(30)
    // 前四个阶段按概率触发；roll 落在概率外就不给加成。
    session.facilityLevels!.medical = 1
    expect(facilityGrowthBonus(session, 'speed', { stadium: 0, category: 0 })).toBeCloseTo(18)
    // 球场是第 10 阶段（第 2 级第 5 阶段，必触发），医疗第 1 阶段不触发时只剩球场加成。
    expect(facilityGrowthBonus(session, 'speed', { stadium: 0.99, category: 0.99 })).toBe(8)
    session.facilityLevels!.medical = NaN
    expect(facilityGrowthBonus(session, 'speed', { stadium: 0, category: 0 })).toBeCloseTo(18)
  })

  it('applies the full medical example through 18 actual speed drills with recovery', () => {
    const player = createInitialGame(4).roster.find(p => !p.positions.GK)!
    player.attrs.speed = 0
    player.attrs.acceleration = 0
    player.attrs.endurance = 0
    const enhanced = createTrainingSession(player, 8, { stadium: 5, academy: 5, medical: 15, shop: 5, sponsor: 5, psychology: 5, tactics: 5 })
    delete enhanced.scheduleVersion
    const old = structuredClone(enhanced)
    delete old.facilityLevels
    for (const session of [enhanced, old]) {
      session.flags = EVENTS.map(event => event.id)
      session.lastEventAction = Object.fromEntries(EVENTS.map(event => [event.id, 100]))
    }
    for (let i = 0; i < 18; i++) {
      if (enhanced.fatigue + 12 > 100) {
        for (const session of [enhanced, old]) expect(performTrainingAction(session, { kind: 'rest' }).ok).toBe(true)
      }
      const request = { kind: 'drill', attr: 'speed' } as const
      expect(planTraining(enhanced, request).gains.speed! - planTraining(old, request).gains.speed!).toBeCloseTo(34)
      expect(performTrainingAction(enhanced, { kind: 'drill', attr: 'speed' }).ok).toBe(true)
      expect(performTrainingAction(old, { kind: 'drill', attr: 'speed' }).ok).toBe(true)
      expect(enhanced.pendingEventId).toBeNull()
      expect(old.pendingEventId).toBeNull()
    }
    const extra = enhanced.candidate.attrs.speed - old.candidate.attrs.speed
    expect(extra).toBeCloseTo(18 * (30 + 4))
    expect(enhanced.action).toBeGreaterThan(18)
    expect(enhanced.action).toBe(old.action)
  })

  it('applies facility bonuses independently to main and hidden combo gains', () => {
    const player = createInitialGame(4).roster.find(p => !p.positions.GK)!
    player.attrs.passing = 0; player.attrs.firstTouch = 0; player.attrs.teamwork = 0
    const session = createTrainingSession(player, 8, { stadium: 5, academy: 15, medical: 5, shop: 5, sponsor: 5, psychology: 5, tactics: 5 })
    delete session.scheduleVersion
    const old = structuredClone(session)
    delete old.facilityLevels
    const request = { kind: 'combo', focus: 'attack' } as const
    const plan = planTraining(session, request)
    const base = planTraining(old, request)
    expect(plan.gains.passing! - base.gains.passing!).toBeCloseTo(34)
    expect(plan.gains.firstTouch! - base.gains.firstTouch!).toBeCloseTo(34 * 20 / 1500)
    expect(plan.gains.teamwork! - base.gains.teamwork!).toBeCloseTo(14 * 20 / 1500)
    expect(performTrainingAction(session, request).ok).toBe(true)
    expect(session.candidate.attrs.passing).toBeCloseTo(plan.gains.passing!)
    expect(session.candidate.attrs.firstTouch).toBeCloseTo(plan.gains.firstTouch!)
    expect(session.candidate.attrs.teamwork).toBeCloseTo(plan.gains.teamwork!)
  })

  it('按个人属性上限截断，PA 不参与；预览与实际执行一致', () => {
    const player = createInitialGame(4).roster.find(p => !p.positions.GK)!
    const session = createTrainingSession(player, 8)
    delete session.scheduleVersion
    session.candidate.pa = 1
    session.candidate.attrs.passing = 1499
    session.candidate.ceilings.passing = 1500
    const request = { kind: 'drill', attr: 'passing' } as const
    const preview = planTraining(session, request)
    expect(preview.note).toContain('上限')
    expect(preview.gains.passing).toBeCloseTo(1)
    expect(performTrainingAction(session, request).ok).toBe(true)
    expect(session.candidate.attrs.passing).toBe(1500)
  })

  it('applies event and mentor bonuses once and leaves old sessions bonus-free', () => {
    const player = createInitialGame(4).roster.find(p => !p.positions.GK)!
    const session = createTrainingSession(player, 8, { stadium: 5, academy: 15, medical: 5, shop: 5, sponsor: 5, psychology: 5, tactics: 5 })
    delete session.scheduleVersion
    const old = structuredClone(session)
    delete old.facilityLevels
    expect(facilityGrowthBonus(old, 'passing')).toBe(0)
    // 把个人上限顶格，单独验证设施加成只生效一次。
    for (const s of [session, old]) { s.pendingEventId = 'main_intake'; s.candidate.pa = 1; s.candidate.ceilings.passing = 1500; s.candidate.ceilings.decisions = 20 }
    const enhanced = resolveTrainingEvent(session, 'passing')
    const legacy = resolveTrainingEvent(old, 'passing')
    expect(enhanced.ok && legacy.ok).toBe(true)
    expect(enhanced.gains!.passing! - legacy.gains!.passing!).toBeCloseTo(34)
    for (const s of [session, old]) {
      s.flags = EVENTS.map(event => event.id)
      s.lastEventAction = Object.fromEntries(EVENTS.map(event => [event.id, s.action]))
      expect(performTrainingAction(s, { kind: 'mentor' }).ok).toBe(true)
    }
    expect(session.log.at(-1)!.gains!.decisions! - old.log.at(-1)!.gains!.decisions!).toBeCloseTo(14 * 20 / 1500)
  })

  it('snapshots all buildings and charges no gold', () => {
    const game = createInitialGame(5)
    const [first, second] = game.roster.filter(p => !p.positions.GK)
    const economy = economyOf(game)
    economy.balance = 0
    expect(startTraining(game, first.id, 11).ok).toBe(true)
    delete game.training[first.id].scheduleVersion
    const session = game.training[first.id]
    expect(session.facilityLevels).toEqual({ stadium: 1, academy: 1, medical: 1, shop: 1, sponsor: 1, psychology: 1, tactics: 1 })
    economy.stadium = 25; economy.medical = 15
    expect(session.facilityLevels!.stadium).toBe(1)
    expect(startTraining(game, second.id, 12).ok).toBe(true)
    delete game.training[second.id].scheduleVersion
    expect(game.training[second.id].facilityLevels).toMatchObject({ stadium: 25, medical: 15 })
    expect(trainingAction(game, first.id, { kind: 'drill', attr: 'passing' }).ok).toBe(true)
    expect(economy.balance).toBe(0)
  })

  it('scales training days by season (15d -> 20d -> 22d) and reaches 80%~90% CA ceiling in season 3 with maxed facilities', () => {
    expect(trainingDaysForSeason(1)).toBe(15)
    expect(trainingDaysForSeason(2)).toBe(20)
    expect(trainingDaysForSeason(3)).toBe(22)
    expect(trainingDaysForSeason(5)).toBe(22)
    expect(trainingActionsForSeason(1)).toBe(30)
    expect(trainingActionsForSeason(2)).toBe(40)
    expect(trainingActionsForSeason(3)).toBe(44)

    const game = createInitialGame(91)
    const [p1, p2, p3] = game.roster.filter(p => !p.positions.GK)
    game.season.index = 1
    if (game.world) game.world.seasonIndex = 1
    expect(startTraining(game, p1.id, 101).ok).toBe(true)
    expect(game.training[p1.id].actionsTotal).toBe(30)

    game.season.index = 2
    if (game.world) game.world.seasonIndex = 2
    expect(startTraining(game, p2.id, 102).ok).toBe(true)
    expect(game.training[p2.id].actionsTotal).toBe(40)
    expect(eligibleEvents(game.training[p2.id], 30).some(e => e.id === 'main_graduation')).toBe(false)
    expect(eligibleEvents(game.training[p2.id], 40).some(e => e.id === 'main_graduation')).toBe(true)

    game.season.index = 3
    if (game.world) game.world.seasonIndex = 3
    expect(startTraining(game, p3.id, 103).ok).toBe(true)
    expect(game.training[p3.id].actionsTotal).toBe(44)
    expect(eligibleEvents(game.training[p3.id], 40).some(e => e.id === 'main_graduation')).toBe(false)
    expect(eligibleEvents(game.training[p3.id], 44).some(e => e.id === 'main_graduation')).toBe(true)

    // 第 3 赛季满级建筑 + 6 陪练培养 5 星球星：稳定达到个人 CA 上限的 80%~90%
    const s3 = createInitialGame(203)
    s3.season.index = 3
    if (s3.world) s3.world.seasonIndex = 3
    const economy = economyOf(s3)
    for (const id of ['stadium', 'academy', 'medical', 'shop', 'sponsor', 'psychology', 'tactics'] as const) economy[id] = 25
    const starSeeds = PLAYER_SEEDS.filter(s => s.tier === 5 && s.pos !== 'GK').slice(0, 6)
    const ratios: number[] = []
    for (const [idx, seed] of starSeeds.entries()) {
      const star = createPlayerFromSeed(seed)
      star.id = `star-test-${idx}`
      star.energy = 100
      s3.roster.push(star)
      setAutoTrainingConfig(s3, star.id, { mode: 'max' })
      expect(startTrainingWithSupport(s3, star.id, 500 + idx).ok).toBe(true)
      const run = runAutoTraining(s3, star.id)
      expect(run.ok && run.completed).toBe(true)
      expect(s3.training[star.id].action).toBe(44)
      const trainedCa = caOf(s3.training[star.id].candidate.attrs, false)
      const ceilingCa = caCeilingOf(star.ceilings, false)
      ratios.push(trainedCa / ceilingCa)
    }
    const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length
    expect(avgRatio).toBeGreaterThanOrEqual(0.8)
    expect(avgRatio).toBeLessThanOrEqual(0.92)
  })
})
