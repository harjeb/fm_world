import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { startTraining, trainingAction } from '../src/game/actions.ts'
import { economyOf } from '../src/game/economy.ts'
import { createTrainingSession, facilityGrowthBonus, performTrainingAction, planTraining, resolveTrainingEvent } from '../src/game/training.ts'
import { EVENTS } from '../src/game/data/events.ts'

describe('facility training growth', () => {
  it('adds exactly one category and stadium, in raw units', () => {
    const player = createInitialGame(4).roster.find(p => !p.positions.GK)!
    const session = createTrainingSession(player, 8, { stadium: 2, academy: 3, medical: 3, shop: 4, sponsor: 5 })
    delete session.scheduleVersion
    expect(facilityGrowthBonus(session, 'speed')).toBeCloseTo(19)
    expect(facilityGrowthBonus(session, 'passing')).toBeCloseTo(19)
    expect(facilityGrowthBonus(session, 'teamwork')).toBeCloseTo(24)
    expect(facilityGrowthBonus(session, 'vision')).toBeCloseTo(29)
    expect(facilityGrowthBonus(session, 'speed') - 4).toBeCloseTo(15)
    session.facilityLevels!.medical = NaN
    expect(facilityGrowthBonus(session, 'speed')).toBeCloseTo(9)
  })

  it('applies the full medical example through 18 actual speed drills with recovery', () => {
    const player = createInitialGame(4).roster.find(p => !p.positions.GK)!
    player.attrs.speed = 0
    player.attrs.acceleration = 0
    player.attrs.endurance = 0
    const enhanced = createTrainingSession(player, 8, { stadium: 1, academy: 1, medical: 3, shop: 1, sponsor: 1 })
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
      expect(planTraining(enhanced, request).gains.speed! - planTraining(old, request).gains.speed!).toBeCloseTo(17)
      expect(performTrainingAction(enhanced, { kind: 'drill', attr: 'speed' }).ok).toBe(true)
      expect(performTrainingAction(old, { kind: 'drill', attr: 'speed' }).ok).toBe(true)
      expect(enhanced.pendingEventId).toBeNull()
      expect(old.pendingEventId).toBeNull()
    }
    const extra = enhanced.candidate.attrs.speed - old.candidate.attrs.speed
    expect(extra).toBeCloseTo(18 * (15 + 2))
    expect(enhanced.action).toBeGreaterThan(18)
    expect(enhanced.action).toBe(old.action)
  })

  it('applies facility bonuses independently to main and hidden combo gains', () => {
    const player = createInitialGame(4).roster.find(p => !p.positions.GK)!
    player.attrs.passing = 0; player.attrs.firstTouch = 0; player.attrs.teamwork = 0
    const session = createTrainingSession(player, 8, { stadium: 1, academy: 3, medical: 1, shop: 1, sponsor: 1 })
    delete session.scheduleVersion
    const old = structuredClone(session)
    delete old.facilityLevels
    const request = { kind: 'combo', focus: 'attack' } as const
    const plan = planTraining(session, request)
    const base = planTraining(old, request)
    expect(plan.gains.passing! - base.gains.passing!).toBeCloseTo(17)
    expect(plan.gains.firstTouch! - base.gains.firstTouch!).toBeCloseTo(17 * 20 / 1500)
    expect(plan.gains.teamwork! - base.gains.teamwork!).toBeCloseTo(7 * 20 / 1500)
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
    const session = createTrainingSession(player, 8, { stadium: 1, academy: 3, medical: 1, shop: 1, sponsor: 1 })
    delete session.scheduleVersion
    const old = structuredClone(session)
    delete old.facilityLevels
    expect(facilityGrowthBonus(old, 'passing')).toBe(0)
    // 把个人上限顶格，单独验证设施加成只生效一次。
    for (const s of [session, old]) { s.pendingEventId = 'main_intake'; s.candidate.pa = 1; s.candidate.ceilings.passing = 1500; s.candidate.ceilings.decisions = 20 }
    const enhanced = resolveTrainingEvent(session, 'passing')
    const legacy = resolveTrainingEvent(old, 'passing')
    expect(enhanced.ok && legacy.ok).toBe(true)
    expect(enhanced.gains!.passing! - legacy.gains!.passing!).toBeCloseTo(17)
    for (const s of [session, old]) {
      s.flags = EVENTS.map(event => event.id)
      s.lastEventAction = Object.fromEntries(EVENTS.map(event => [event.id, s.action]))
      expect(performTrainingAction(s, { kind: 'mentor' }).ok).toBe(true)
    }
    expect(session.log.at(-1)!.gains!.decisions! - old.log.at(-1)!.gains!.decisions!).toBeCloseTo(7 * 20 / 1500)
  })

  it('snapshots all buildings and charges no gold', () => {
    const game = createInitialGame(5)
    const [first, second] = game.roster.filter(p => !p.positions.GK)
    const economy = economyOf(game)
    economy.balance = 0
    expect(startTraining(game, first.id, 11).ok).toBe(true)
    delete game.training[first.id].scheduleVersion
    const session = game.training[first.id]
    expect(session.facilityLevels).toEqual({ stadium: 1, academy: 1, medical: 1, shop: 1, sponsor: 1 })
    economy.stadium = 5; economy.medical = 3
    expect(session.facilityLevels!.stadium).toBe(1)
    expect(startTraining(game, second.id, 12).ok).toBe(true)
    delete game.training[second.id].scheduleVersion
    expect(game.training[second.id].facilityLevels).toMatchObject({ stadium: 5, medical: 3 })
    expect(trainingAction(game, first.id, { kind: 'drill', attr: 'passing' }).ok).toBe(true)
    expect(economy.balance).toBe(0)
  })
})
