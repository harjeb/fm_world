import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { caOf } from '../src/game/ca.ts'
import type { Player } from '../src/game/types.ts'
import { createTrainingSession, planTraining } from '../src/game/training.ts'
import { displayEventHint, trainingLogText } from '../src/ui/format.ts'
import { attrMax, attrRating, displayAttr, displayGain, displayMainAttr, displayHiddenAttr, displayCA, displayPA, initialDisplayCA, scaleAuthoredGains } from '../src/game/rating.ts'

describe('属性显示尺度', () => {
  it('属性和成长显示原始值，比赛评分保持 0–100', () => {
    expect(displayAttr('passing', 1500, false)).toBe(1500)
    expect(displayAttr('firstTouch', 20, false)).toBe(20)
    expect(displayAttr('composure', 20, false)).toBe(20)
    expect(displayAttr('composure', 1500, true)).toBe(1500)
    expect(displayMainAttr(15)).toBe(15)
    expect(displayHiddenAttr(1)).toBe(1)
    expect(displayGain('passing', 15, false)).toBe(15)
    expect(displayGain('firstTouch', 1, false)).toBe(1)
    expect(displayCA(1500)).toBe(1500)
    expect(displayPA(1500)).toBe(1500)
    expect(attrRating('passing', 750, false)).toBe(50)
    expect(attrRating('firstTouch', 10, false)).toBe(50)
    expect(scaleAuthoredGains({ passing: 2, firstTouch: 1 }, false)).toEqual({ passing: 30, firstTouch: 1 })
  })

  it.each([false, true])('原始 CA 使用原始位置，装备卡改变门将熟练度也不影响（门将：%s）', (gk) => {
    const player = createInitialGame(2024).roster.find((item) => (item.basePositions.GK > 0) === gk)!
    const original = caOf(player.baseAttrs, gk)
    player.positions.GK = gk ? 0 : 100
    player.attrs.passing = 1400
    expect(initialDisplayCA(player)).toBe(original)
  })

  it('原始 CA 兼容没有原始属性 / 位置字段的旧球员', () => {
    const player = createInitialGame(2024).roster[0]
    const expected = caOf(player.attrs, player.positions.GK > 0)
    delete (player as Partial<Player>).baseAttrs
    delete (player as Partial<Player>).basePositions
    expect(initialDisplayCA(player)).toBe(expected)
  })

  it('事件提示保留原始值', () => {
    const hint = '传球 +2，第一脚触球 +1，镇定 +1，职业素养 +2'
    expect(displayEventHint(hint, false)).toBe('传球 +30，第一脚触球 +1，镇定 +1，职业素养 +2')
    expect(displayEventHint(hint, true)).toBe('传球 +30，第一脚触球 +1，镇定 +15，职业素养 +2')
  })

  it('旧培养日志按已存的成长值展示，不修改原始记录', () => {
    const system = { action: 0, week: 1, kind: 'system' as const, title: '开始培养', text: '所有属性最高为 100。' }
    const old = { action: 1, week: 1, kind: 'event' as const, title: '训练', text: '部分属性已达 100 上限。（传球 +3，第一脚触球 +5）', gains: { passing: 45, firstTouch: 1 } }
    expect(trainingLogText(system, false)).toBe('主属性最高为 1500。')
    expect(trainingLogText(old, false)).toBe('部分属性已达各自上限。（传球 +45，第一脚触球 +1）')
    expect(old.text).toContain('传球 +3')
    expect(trainingLogText({ ...old, text: '导师完成了训练。' }, false)).toBe('导师完成了训练。')
  })

  it('球员存档属性直接保存为 0-1500 / 0-20', () => {
    const game = createInitialGame(2024)
    for (const player of game.roster) {
      const gk = player.positions.GK > 0
      for (const key of Object.keys(player.attrs) as (keyof typeof player.attrs)[]) {
        expect(player.attrs[key]).toBeGreaterThanOrEqual(0)
        expect(player.attrs[key]).toBeLessThanOrEqual(attrMax(key, gk))
        expect(player.ceilings[key]).toBeLessThanOrEqual(attrMax(key, gk))
      }
      expect(player.pa).toBeLessThanOrEqual(1500)
    }
  })

  it('隐藏属性不能直接专项训练，主属性可以', () => {
    const player = createInitialGame(2024).roster.find((item) => item.positions.GK === 0)!
    const session = createTrainingSession(player, 1)
    delete session.scheduleVersion
    const hidden = planTraining(session, { kind: 'drill', attr: 'firstTouch' })
    expect(hidden.gains).toEqual({})
    expect(hidden.note).toContain('暂不支持专项训练')
    const main = planTraining(session, { kind: 'drill', attr: 'passing' })
    expect(main.gains.passing ?? 0).toBeGreaterThan(0)
  })
})
