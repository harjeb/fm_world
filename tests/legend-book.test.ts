import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { createTrainingSession, resolveTrainingEvent } from '../src/game/training.ts'
import { startTraining } from '../src/game/actions.ts'
import { bookEvents, bookLearnChance, canUseBookOnPlayer, grantBookSkill } from '../src/game/legend-learning.ts'
import type { LegendBook } from '../src/game/types.ts'

const drillBook: LegendBook = { id: 'lg_drill_master', tier: 'rainbow' }

function player(seed = 1) {
  const game = createInitialGame(seed)
  return game.roster.find((item) => item.positions.GK === 0)!
}

describe('传奇技能书学习', () => {
  it('keeps low requirements at the floor and increases monotonically', () => {
    const p = player()
    for (const ratio of [0, 1 / 13, 0.3, 0.64, 0.65]) {
      p.attrs.teamwork = 13 * ratio
      expect(bookLearnChance(p, drillBook)).toBe(0.02)
    }
    let previous = 0
    for (let step = 0; step <= 120; step++) {
      p.attrs.teamwork = 13 * step / 100
      const chance = bookLearnChance(p, drillBook)
      expect(chance).toBeGreaterThanOrEqual(previous)
      previous = chance
    }
    expect(previous).toBe(1)
  })

  it('combines a low and a satisfied requirement by geometric mean', () => {
    const p = player()
    p.attrs.passing = 1
    p.attrs.vision = 14
    expect(bookLearnChance(p, { id: 'lg_pass_vision', tier: 'rainbow' })).toBeCloseTo(Math.sqrt(0.02), 8)
  })

  it('学习概率在达标线为 100%，低于 0.65T 为 2% 地板，并支持混合要求', () => {
    const p = player()
    p.attrs.teamwork = 13
    expect(bookLearnChance(p, drillBook)).toBeCloseTo(1, 5)
    p.attrs.teamwork = 9
    expect(bookLearnChance(p, { ...drillBook, tier: 'gold' })).toBeCloseTo(1, 5)
    p.attrs.teamwork = 9 * 0.65
    expect(bookLearnChance(p, { ...drillBook, tier: 'gold' })).toBeCloseTo(0.02, 5)
    p.attrs.teamwork = 9 * 0.9
    expect(bookLearnChance(p, { ...drillBook, tier: 'gold' })).toBeCloseTo(0.51, 1)
  })

  it('兼容旧存档的单书事件保留 12/14/16/18 触发点', () => {
    const p = player(2)
    const books: LegendBook[] = [
      { id: 'lg_drill_master', tier: 'gold' },
      { id: 'lg_vision_master', tier: 'gold' },
      { id: 'lg_marathon', tier: 'gold' },
      { id: 'lg_low_drive', tier: 'gold' },
    ]
    const session = createTrainingSession(p, 12, { stadium: 25, academy: 25, medical: 25, shop: 25, sponsor: 25, psychology: 25, tactics: 25 }, 1, books)
    expect(bookEvents(session).map((event) => event.trigger.latestAction)).toEqual([12, 14, 16, 18])
  })

  it('学会时书不消耗；失败也不扣书；同 id 升档不占新槽', () => {
    const p = player(3)
    p.attrs.teamwork = 13
    p.skills = []
    p.skillTiers = {}
    const session = createTrainingSession(p, 13, { stadium: 25, academy: 25, medical: 25, shop: 25, sponsor: 25, psychology: 25, tactics: 25 }, 1, [drillBook])
    session.action = 11
    const event = bookEvents(session)[0]
    expect(event).toBeTruthy()
    session.pendingEventId = event.id
    const result = resolveTrainingEvent(session, 'learn')
    expect(result.success).toBe(true)
    expect(session.candidate.skills).toContain('lg_drill_master')
    expect(session.candidate.skillTiers?.lg_drill_master).toBe('rainbow')
    expect(session.books).toHaveLength(1)
    expect(grantBookSkill(session, { id: 'lg_drill_master', tier: 'gold' }).ok).toBe(false)
    expect(session.candidate.skills.filter((id) => id === 'lg_drill_master')).toHaveLength(1)
  })

  it('开始培养时可以把库存里的书带进 4 个书槽', () => {
    const game = createInitialGame(6)
    const p = game.roster.find((item) => item.positions.GK === 0)!
    game.legendBooks = [{ id: 'lg_drill_master', tier: 'gold' }]
    const result = startTraining(game, p.id, 99, ['lg_drill_master:gold'])
    expect(result.ok, result.error).toBe(true)
    expect(game.training[p.id].books).toEqual([{ id: 'lg_drill_master', tier: 'gold' }])
  })

  it('技能槽满时不能学，位置不匹配时概率为 0', () => {
    const p = player(4)
    p.skills = ['through_ball', 'safe_pass', 'one_touch', 'box_hunter']
    p.skillTiers = {}
    const check = canUseBookOnPlayer(p, drillBook)
    expect(check.ok).toBe(false)
    const session = createTrainingSession(p, 14, { stadium: 25, academy: 25, medical: 25, shop: 25, sponsor: 25, psychology: 25, tactics: 25 }, 1, [drillBook])
    expect(grantBookSkill(session, drillBook).ok).toBe(false)
    const gk = createInitialGame(5).roster.find((item) => item.positions.GK > 0)!
    expect(bookLearnChance(gk, { id: 'lg_rabona', tier: 'rainbow' })).toBe(0)
  })
})
