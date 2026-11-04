import { describe, expect, it } from 'vitest'
import { createPlayerFromSeed, PLAYER_SEEDS } from '../src/game/data/players.ts'
import { createTrainingSession } from '../src/game/training.ts'
import { getSkillTier, inheritanceChances, mentorSkill, validateInheritance } from '../src/game/inheritance.ts'

function setup(seed = 123) {
  const player = createPlayerFromSeed(PLAYER_SEEDS[0])
  const mentor = createPlayerFromSeed(PLAYER_SEEDS[1])
  mentor.skills = ['through_ball']
  const session = createTrainingSession(player, seed)
  delete session.scheduleVersion
  return { session, mentor }
}

describe('skill inheritance', () => {
  it('defaults legacy tiers to silver and previews without mutation', () => {
    const { session, mentor } = setup()
    expect(getSkillTier(mentor, 'through_ball')).toBe('silver')
    const before = structuredClone(session)
    expect(inheritanceChances(session, mentor, 'through_ball').rainbow).toBe(0)
    expect(session).toEqual(before)
  })

  it('is deterministic and leaves action accounting to the caller', () => {
    const { session, mentor } = setup()
    const other = structuredClone(session)
    expect(mentorSkill(session, mentor, 'through_ball')).toEqual(mentorSkill(other, mentor, 'through_ball'))
    expect(session.candidate).toEqual(other.candidate)
    expect(session.action).toBe(0)
  })

  it('rejects self, missing skills, duplicates and full independent slots without mutation', () => {
    const { session, mentor } = setup()
    expect(validateInheritance(session, session.candidate, 'through_ball')).toBeTruthy()
    expect(validateInheritance(session, mentor, 'safe_pass')).toBeTruthy()
    session.candidate.skills = ['through_ball']
    expect(validateInheritance(session, mentor, 'through_ball')).toBeTruthy()
    session.candidate.skills = ['safe_pass', 'one_touch', 'box_hunter', 'long_shot']
    const before = structuredClone(session)
    expect(mentorSkill(session, mentor, 'through_ball').ok).toBe(false)
    expect(session).toEqual(before)
    mentor.skills = ['injury_prevention']
    expect(validateInheritance(session, mentor, 'injury_prevention')).toBeNull()
    session.candidate.skills.push('injury_prevention', 'injury_resilience')
    mentor.skills = ['injury_resilience']
    expect(validateInheritance(session, mentor, 'injury_resilience')).toBeTruthy()
  })

  it('never inherits a tier above the mentor, and rainbow mentors can pass rainbow', () => {
    for (const tier of ['silver', 'gold', 'rainbow'] as const) {
      const received = new Set<string>()
      for (let seed = 0; seed < 500; seed++) {
        const { session, mentor } = setup(seed)
        Object.assign(mentor, { skillTiers: { through_ball: tier } })
        const result = mentorSkill(session, mentor, 'through_ball')
        if (result.ok && result.tier) received.add(result.tier)
      }
      expect(received.has('silver')).toBe(true)
      expect(received.has('gold')).toBe(tier !== 'silver')
      expect(received.has('rainbow')).toBe(tier === 'rainbow')
    }
  })
})
