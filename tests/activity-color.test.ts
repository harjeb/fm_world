import { describe, expect, it } from 'vitest'
import { ATTR_COLORS, ATTR_SILVER, activityColor } from '../src/ui/components.ts'

describe('训练项目配色', () => {
  it('7 项外场主属性各有一种互不相同的颜色', () => {
    const colors = Object.values(ATTR_COLORS)
    expect(colors).toHaveLength(7)
    expect(new Set(colors).size).toBe(7)
    expect(colors).not.toContain(ATTR_SILVER)
  })

  it('项目取成长最多的主属性的颜色；隐藏属性和没有成长的项目是银色', () => {
    expect(activityColor({ shooting: 1.5, composure: 0.5 }, false)).toBe(ATTR_COLORS.shooting)
    expect(activityColor({ passing: 1, strength: 1, teamwork: 0.5 }, false)).toBe(ATTR_COLORS.passing)
    expect(activityColor({ speed: 0.75, acceleration: 0.75, strength: 0.75 }, false)).toBe(ATTR_COLORS.speed)
    expect(activityColor({ vision: 1, decisions: 1 }, false)).toBe(ATTR_SILVER)
    expect(activityColor({ decisions: 1, teamwork: 1, defPos: 0.5 }, false)).toBe(ATTR_SILVER)
    expect(activityColor(undefined, false)).toBe(ATTR_SILVER)
    // 门将专属主属性没有配色
    expect(activityColor({ reflexes: 1.5, handling: 0.5 }, true)).toBe(ATTR_SILVER)
    expect(activityColor({ passing: 1.5, composure: 0.5, decisions: 0.5 }, true)).toBe(ATTR_COLORS.passing)
  })
})
