import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { startTraining } from '../src/game/actions.ts'
import { createTrainingSession, eligibleEvents, performTrainingAction, planTraining } from '../src/game/training.ts'
import { EVENTS } from '../src/game/data/events.ts'
import { ALL_ATTRIBUTES, type AttrKey, type Position, type RoleId, type TrainingSession } from '../src/game/types.ts'
import { MAIN_FIELD_ATTRS, MAIN_GK_ATTRS, attrMax } from '../src/game/scale.ts'

function sessionFor(position: Position, role?: RoleId): TrainingSession {
  const game = createInitialGame(211)
  const player = structuredClone(game.roster.find(p => (p.positions.GK > 0) === (position === 'GK'))!)
  player.positions = { GK: 0, CB: 0, W: 0, CM: 0, ST: 0, [position]: 100 }
  for (const key of ALL_ATTRIBUTES) {
    player.attrs[key] = attrMax(key, position === 'GK') / 2
    player.ceilings[key] = attrMax(key, position === 'GK')
  }
  const session = createTrainingSession(player, 211)
  session.matchRole = role
  delete session.facilityLevels
  return session
}

const actions = [0, 8, 14, 22, 28]
function matchPlan(session: TrainingSession, action: number) {
  session.action = action
  return planTraining(session, { kind: 'activity', activityId: action === 8 || action === 22 ? 'match' : 'exchange' }, undefined, 0, true)
}

describe('training reward balance', () => {
  it('provides meaningful event coverage for every field main attribute without one dominating', () => {
    const counts = Object.fromEntries(MAIN_FIELD_ATTRS.map(key => [key, 0])) as Record<typeof MAIN_FIELD_ATTRS[number], number>
    for (const event of EVENTS.filter(e => e.trigger.playerCategory !== 'gk')) for (const option of event.options) {
      for (const key of MAIN_FIELD_ATTRS) {
        if ([option.effect, option.branch?.success, option.branch?.failure].some(effect => (effect?.attrs?.[key] ?? 0) > 0)) counts[key]++
      }
    }
    expect(Math.min(...Object.values(counts))).toBeGreaterThanOrEqual(6)
    expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(Math.min(...Object.values(counts)) * 2)
    expect(counts.dribbling).toBeGreaterThanOrEqual(6)
    expect(counts.passing).toBeLessThanOrEqual(12)
  })

  it('makes new physical events available to field players without leaking into goalkeeper events', () => {
    const field = sessionFor('W')
    const keeper = sessionFor('GK')
    field.action = keeper.action = 4
    const ids = ['train_dribbling', 'train_sprint', 'train_duel']
    expect(eligibleEvents(field).map(e => e.id)).toEqual(expect.arrayContaining(ids))
    for (const id of ids) expect(eligibleEvents(keeper).map(e => e.id)).not.toContain(id)
  })

  it.each(['CB', 'W', 'CM', 'ST', 'GK'] as const)('rotates %s match rewards with a stable two-primary-attribute budget', position => {
    const session = sessionFor(position)
    const main: readonly AttrKey[] = position === 'GK' ? MAIN_GK_ATTRS : MAIN_FIELD_ATTRS
    const seen = new Set<AttrKey>()
    let passing = 0
    for (const action of actions) {
      const plan = matchPlan(session, action)
      const keys = Object.keys(plan.gains).filter(key => main.includes(key as AttrKey)) as AttrKey[]
      expect(keys).toHaveLength(2)
      for (const key of keys) {
        seen.add(key)
        expect(plan.gains[key]).toBeGreaterThanOrEqual(27)
        expect(plan.gains[key]).toBeLessThanOrEqual(33)
      }
      if (keys.includes('passing')) passing++
      expect(plan.gains.teamwork).toBe(1)
      expect(plan.fatigue).toBe(0)
      expect(matchPlan(structuredClone(session), action)).toEqual(plan)
    }
    expect(seen.size).toBeGreaterThanOrEqual(position === 'GK' ? 6 : 4)
    expect(passing).toBeLessThan(5)
    if (position === 'GK') for (const key of seen) expect(MAIN_GK_ATTRS).toContain(key)
  })

  it('uses the saved role for the first focus and falls back to position for older course saves', () => {
    const winger = sessionFor('W', 'w_winger')
    const wingBack = sessionFor('W', 'w_back')
    expect(Object.keys(matchPlan(winger, 0).gains)).toContain('dribbling')
    expect(Object.keys(matchPlan(wingBack, 0).gains)).toContain('tackling')
    expect(Object.keys(matchPlan(sessionFor('CB'), 0).gains)).toEqual(expect.arrayContaining(['tackling', 'strength']))
    const game = createInitialGame(211)
    const starter = game.lineup.starters.find(p => p.role === 'w_back') ?? game.lineup.starters[1]
    expect(startTraining(game, starter.playerId, 211).ok).toBe(true)
    expect(game.training[starter.playerId].matchRole).toBe(starter.role)
  })

  it('applies the previewed rotated rewards once when executing a match course', () => {
    const session = sessionFor('CB', 'cb_stopper')
    session.action = 8
    const request = { kind: 'activity', activityId: 'match' } as const
    const plan = planTraining(session, request)
    const before = { ...session.candidate.attrs }
    expect(performTrainingAction(session, request).ok).toBe(true)
    for (const [key, value] of Object.entries(plan.gains)) expect(session.candidate.attrs[key as AttrKey] - before[key as AttrKey]).toBeCloseTo(value!)
  })
})
