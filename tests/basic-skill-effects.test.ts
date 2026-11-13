import { describe, expect, it } from 'vitest'
import { MatchEngine } from '../src/game/match/engine.ts'
import { MatchRatings } from '../src/game/match/ratings.ts'
import { SettlementKernel } from '../src/game/match/resolution.ts'
import { POSITION_BASIC_SKILLS, SKILLS } from '../src/game/data/skills.ts'
import { inputFor, makeTeams } from './helpers.ts'
import type { SkillId } from '../src/game/types.ts'

function setup() {
  const { roster, lineup } = makeTeams()
  const engine = new MatchEngine({ seed: 12, home: inputFor(roster, lineup, 'home', 'Home'), away: inputFor(roster, lineup, 'away', 'Away'), knockout: false, rulesVersion: 2 })
  const state = engine.state
  for (const team of state.teams) for (const player of [...team.players, ...team.bench]) {
    player.skills = []
    player.skillTiers = {}
    ;(player as any).traitId = 'test-neutral'
  }
  const marks: string[] = []
  const ratings = new MatchRatings(() => state, () => state.durationSeconds)
  const kernel = new SettlementKernel(ratings, { legacyRules: false, markSkill: (_p, id, condition, applied) => { if (condition && applied) marks.push(id) } })
  const [home, away] = state.teams
  const field = home.players.filter((p) => p.onPitch && p.position !== 'GK')
  const opponents = away.players.filter((p) => p.onPitch && p.position !== 'GK')
  const gk = away.players.find((p) => p.onPitch && p.position === 'GK')!
  return { kernel, ratings, marks, home, away, field, opponents, gk }
}

function setSkill(player: { skills: SkillId[] }, ...skills: SkillId[]) { player.skills = skills }

describe('位置基础技能', () => {
  it('每个位置恰有六项，全部已注册并可跨位置共享', () => {
    for (const skills of Object.values(POSITION_BASIC_SKILLS)) {
      expect(skills).toHaveLength(6)
      expect(new Set(skills).size).toBe(6)
      for (const id of skills) expect(SKILLS[id]).toBeDefined()
    }
    expect(POSITION_BASIC_SKILLS.CM).toContain('one_touch')
    expect(POSITION_BASIC_SKILLS.W).toContain('one_touch')
  })

  it('长传、传中、队友接应等五项在共享结算内核确实生效', () => {
    const { kernel, home, away, field, gk, marks } = setup()
    const [passer, receiver] = field
    passer.x = 35; passer.y = 20
    receiver.x = 65; receiver.y = 5
    gk.x = 75; gk.y = 32
    for (const opponent of away.players) if (opponent !== gk) opponent.onPitch = false
    const checkPasser = (id: SkillId, type: 'long' | 'cross', subject = passer) => {
      const baseline = kernel.passModel(subject, receiver, type, away, subject, receiver, true).a
      setSkill(subject, id)
      expect(kernel.passModel(subject, receiver, type, away, subject, receiver, true).a - baseline, id).toBeCloseTo(4)
      setSkill(subject)
    }
    const ownGk = home.players.find((p) => p.onPitch && p.position === 'GK')!
    ownGk.x = 20; ownGk.y = 32
    checkPasser('gk_long_kick', 'long', ownGk)
    checkPasser('cm_long_pass', 'long')
    checkPasser('wing_cross', 'cross')
    for (const [id, type] of [['wing_support', 'short'], ['st_breakaway', 'through']] as const) {
      const baseline = kernel.passModel(passer, receiver, type, away, passer, receiver, true).a
      setSkill(receiver, id)
      expect(kernel.passModel(passer, receiver, type, away, passer, receiver, true).a - baseline).toBeCloseTo(4)
      setSkill(receiver)
    }
    for (const id of ['gk_long_kick', 'cm_long_pass', 'wing_cross', 'wing_support', 'st_breakaway']) expect(marks).toContain(id)
  })

  it('逼抢护球、边路回追、线路预判有实际对抗加成', () => {
    const { kernel, away, field, opponents, gk, marks } = setup()
    const [carrier, receiver] = field
    const [defender] = opponents
    carrier.x = 40; carrier.y = 5; receiver.x = 60; receiver.y = 5
    defender.x = 42; defender.y = 5
    const original = kernel.dribbleModel(carrier, defender, true)
    setSkill(carrier, 'cm_shield')
    expect(kernel.dribbleModel(carrier, defender, true).a - original.a).toBeCloseTo(4)
    setSkill(defender, 'wing_track_back')
    expect(kernel.dribbleModel(carrier, defender, true).d - original.d).toBeCloseTo(4)
    setSkill(carrier); setSkill(defender)
    for (const opponent of away.players) if (opponent !== defender) opponent.onPitch = false
    gk.onPitch = false
    defender.x = 50; defender.y = 5
    const before = kernel.passModel(carrier, receiver, 'short', away, carrier, receiver, true)
    setSkill(defender, 'cb_intercept')
    const after = kernel.passModel(carrier, receiver, 'short', away, carrier, receiver, true)
    expect(after.d - before.d).toBeCloseTo(3)
    expect(kernel.findLineInterceptors(away, carrier, receiver)[0].score).toBeGreaterThan(0)
    for (const id of ['cm_shield', 'wing_track_back', 'cb_intercept']) expect(marks).toContain(id)
  })

  it('门将抱球、高球及单刀封角有实际效果', () => {
    const { kernel, home, away, field, opponents, gk, marks } = setup()
    const shooter = field[0]
    shooter.attrs.shooting = gk.attrs.handling
    const catchBefore = kernel.keeperCatchChance(gk, shooter)
    setSkill(gk, 'gk_safe_hands')
    expect(kernel.keeperCatchChance(gk, shooter) - catchBefore).toBeCloseTo(0.08)
    for (const opponent of opponents) opponent.onPitch = false
    gk.x = 99; gk.y = 32
    const point = { x: 99, y: 32 }
    setSkill(gk)
    const weights = () => kernel.aerialContestants(home, away, point, 'home', () => 0.5).find((entry) => entry.player === gk)!.weight
    const highBefore = weights()
    setSkill(gk, 'gk_high_ball')
    expect(weights() - highBefore).toBeCloseTo(5)
    shooter.x = 90; shooter.y = 32
    const shot = () => kernel.shotModel(shooter, home, away, { point: shooter, header: false, penalty: false, freeKick: false }, true)
    setSkill(gk)
    expect(shot().chance.type).toBe('clear_chance')
    const score = shot().gkScore
    setSkill(gk, 'gk_close_down')
    expect(shot().gkScore - score).toBeCloseTo(5)
    for (const id of ['gk_safe_hands', 'gk_high_ball', 'gk_close_down']) expect(marks).toContain(id)
  })

  it('禁区封堵和补位保护在己方半场生效', () => {
    const { kernel, away, opponents, marks } = setup()
    const defender = opponents[0]
    for (const other of away.players) if (other !== defender) other.onPitch = false
    defender.x = 94; defender.y = 32
    const shot = { x: 88, y: 32 }, goal = { x: 100, y: 32 }
    const before = kernel.findBlockers(away, shot, goal, false, true)[0]
    setSkill(defender, 'cb_block')
    expect(kernel.findBlockers(away, shot, goal, false, true)[0] - before).toBeCloseTo(5)
    const contest = () => kernel.looseBallContestants([away], defender, () => 0.5).find((entry) => entry.player === defender)!.weight
    setSkill(defender)
    const initial = contest()
    setSkill(defender, 'cb_cover')
    expect(contest() - initial).toBeCloseTo(5)
    expect(marks).toContain('cb_block')
    expect(marks).toContain('cb_cover')
  })
})
