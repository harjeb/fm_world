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

  it('allows replacing an existing skill of the same category when slots are full, preserving old skill on failure', () => {
    // 跨类别替换（用主技能去顶辅助技能）应被拒绝
    const { session: badSession, mentor: badMentor } = setup(1)
    badSession.candidate.skills = ['safe_pass', 'one_touch', 'box_hunter', 'long_shot', 'injury_prevention']
    expect(validateInheritance(badSession, badMentor, 'through_ball', 'injury_prevention')).toBeTruthy()
    expect(validateInheritance(badSession, badMentor, 'through_ball', 'one_touch')).toBeNull()

    let sawSuccess = false
    let sawFailure = false
    for (let seed = 1; seed <= 50 && (!sawSuccess || !sawFailure); seed++) {
      const { session, mentor } = setup(seed)
      mentor.skillTiers = { through_ball: 'gold' }
      session.candidate.skills = ['safe_pass', 'one_touch', 'box_hunter', 'long_shot']
      session.candidate.skillTiers = { safe_pass: 'gold', one_touch: 'silver', box_hunter: 'silver', long_shot: 'silver' }
      const outcome = mentorSkill(session, mentor, 'through_ball', 'one_touch')
      expect(outcome.ok).toBe(true)
      if (!outcome.ok) continue
      if (outcome.success) {
        sawSuccess = true
        expect(outcome.replaced).toBe('one_touch')
        expect(session.candidate.skills).toEqual(['safe_pass', 'through_ball', 'box_hunter', 'long_shot'])
        expect(session.candidate.skillTiers.one_touch).toBeUndefined()
        expect(session.candidate.skillTiers.through_ball).toBe(outcome.tier)
      } else {
        sawFailure = true
        expect(outcome.replaced).toBeUndefined()
        expect(session.candidate.skills).toEqual(['safe_pass', 'one_touch', 'box_hunter', 'long_shot'])
        expect(session.candidate.skillTiers.one_touch).toBe('silver')
      }
    }
    expect(sawSuccess).toBe(true)
    expect(sawFailure).toBe(true)
  })
})
