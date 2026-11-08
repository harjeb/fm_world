import { describe, expect, it } from 'vitest'
import { slotsOf } from './clean.ts'
import { COMMENTARY_TEMPLATES, EVENT_KEYS } from './templates.generated.ts'

/**
 * 生成数据的不变式。数据来自仓库外的 FM24 语料（scripts/build-commentary.ts），这里只检查已提交的生成文件，
 * 所以没有语料的机器上也能跑。重新生成后这些检查必须仍然通过。
 */
describe('解说模板库（生成数据）', () => {
  it('规模没有意外缩水', () => {
    expect(COMMENTARY_TEMPLATES.length).toBeGreaterThanOrEqual(6500)
    expect(EVENT_KEYS.length).toBeGreaterThanOrEqual(1000)
  })

  it('id 唯一、事件键下标有效、通道合法、句子非空', () => {
    const ids = new Set<number>()
    for (const template of COMMENTARY_TEMPLATES) {
      expect(ids.has(template.id), `id ${template.id} 重复`).toBe(false)
      ids.add(template.id)
      expect(template.t.length).toBeGreaterThan(0)
      expect([1, 2, 3]).toContain(template.c)
      for (const index of template.e) expect(EVENT_KEYS[index], `「${template.t}」的事件键下标 ${index} 无效`).toBeDefined()
    }
  })

  it('事件键表有序且不重复，键本身规整', () => {
    expect([...EVENT_KEYS]).toEqual([...new Set(EVENT_KEYS)].sort())
    for (const key of EVENT_KEYS) expect(key).toMatch(/^[A-Z][A-Z0-9_]*$/)
  })

  it('无残留：没有 FM 原始占位符、花括号、undefined、她', () => {
    for (const template of COMMENTARY_TEMPLATES) {
      expect(template.t, template.t).not.toMatch(/\[%|\{|\}|undefined|她/)
    }
  })

  it('槽位字段和句子里的槽位一致，且都认得', () => {
    for (const template of COMMENTARY_TEMPLATES) {
      expect(template.s, template.t).toBe(slotsOf(template.t))
      expect(template.s, template.t).not.toContain('?')
    }
  })

  it('轻改已生效：距离单位是米，十二码是点球点', () => {
    for (const template of COMMENTARY_TEMPLATES) {
      expect(template.t, template.t).not.toMatch(/【数字\d+】码|十二码/)
    }
  })

  it('大部分句子现在就能用，挂起的是少数', () => {
    const usable = COMMENTARY_TEMPLATES.filter((template) => template.n === 0).length
    expect(usable).toBeGreaterThanOrEqual(6000)
    expect(COMMENTARY_TEMPLATES.length - usable).toBeLessThanOrEqual(900)
  })

  it('关键事件在两个通道里都有足够候选（只算现在能用的）', () => {
    const groups: [string, RegExp][] = [
      ['进球', /^(GOAL_|OWN_GOAL|HAT_TRICK|PLAYER_SECOND_GOAL)/],
      ['射门被扑', /^(GOALKEEPER_|GOALIE_|GREAT_SAVE|GOOD_SAVE|SAVED_)/],
      ['点球', /PENALTY/],
      ['角球', /CORNER/],
      ['犯规', /^(FOUL_|HAND_BALL)/],
      ['红黄牌', /(YELLOW|SENT_OFF|RED_CARD)/],
      ['换人', /(SUBSTITUTION|MAKING_CHANGE)/],
      ['半场', /^HALF_TIME/],
      ['终场', /^(FULL_TIME|FINAL_WHISTLE)/],
    ]
    const usable = COMMENTARY_TEMPLATES.filter((template) => template.n === 0)
    for (const [label, pattern] of groups) {
      const matching = usable.filter((template) => template.e.some((index) => pattern.test(EVENT_KEYS[index])))
      expect(matching.filter((template) => (template.c & 1) !== 0).length, `${label}：直播`).toBeGreaterThanOrEqual(5)
      expect(matching.filter((template) => (template.c & 2) !== 0).length, `${label}：战报`).toBeGreaterThanOrEqual(5)
    }
  })
})
