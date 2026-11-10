import { describe, expect, it } from 'vitest'
import { LEGEND_TEAMS } from '../src/game/data/legend-teams.ts'
import { LEGEND_SKILLS, LEGEND_SKILL_DROPS, LEGEND_SKILL_IDS } from '../src/game/data/legend-skills.ts'
import { SKILLS } from '../src/game/data/skills.ts'
import { isMainAttr } from '../src/game/rating.ts'
import { attrLimit } from '../src/game/scale.ts'

const FAMILY_COUNT = { growth: 8, iq: 10, move: 14, range: 4, recovery: 6, economy: 8 }

describe('50 个传奇技能与掉落', () => {
  it('50 个 id 全覆盖，家族数量符合文档', () => {
    expect(LEGEND_SKILL_IDS).toHaveLength(50)
    expect(new Set(LEGEND_SKILL_IDS).size).toBe(50)
    const counts = Object.values(LEGEND_SKILLS).reduce((acc, def) => {
      acc[def.family] = (acc[def.family] ?? 0) + 1
      return acc
    }, {} as Record<string, number>)
    expect(counts).toEqual(FAMILY_COUNT)
    for (const id of LEGEND_SKILL_IDS) expect(SKILLS[id]).toBeTruthy()
  })

  it('50 支传奇队每队只挂一本，且不重复', () => {
    expect(Object.keys(LEGEND_SKILL_DROPS)).toHaveLength(50)
    expect(Object.values(LEGEND_SKILL_DROPS)).toHaveLength(50)
    for (const team of LEGEND_TEAMS) expect(LEGEND_SKILL_DROPS[team.id]).toBeTruthy()
    expect(new Set(Object.values(LEGEND_SKILL_DROPS)).size).toBe(50)
  })

  it('每个技能的要求属性、刻度和档位都合法', () => {
    for (const def of Object.values(LEGEND_SKILLS)) {
      expect(def.requires.length, def.id).toBeGreaterThan(0)
      const sides = def.scope === 'gk' ? [true] : def.scope === 'field' ? [false] : [false, true]
      for (const req of def.requires) {
        expect(req.gold, `${def.id} ${req.attr}`).toBeLessThanOrEqual(req.rainbow)
        expect(sides.some((gk) => attrLimit(req.attr, gk) > 0), `${def.id} ${req.attr} 位置刻度`).toBe(true)
        const main = sides.some((gk) => isMainAttr(req.attr, gk))
        if (main) {
          expect(req.gold, `${def.id} ${req.attr}`).toBeGreaterThanOrEqual(600)
          expect(req.rainbow, `${def.id} ${req.attr}`).toBeLessThanOrEqual(1150)
        } else {
          expect(req.gold, `${def.id} ${req.attr}`).toBeGreaterThanOrEqual(8)
          expect(req.rainbow, `${def.id} ${req.attr}`).toBeLessThanOrEqual(15)
        }
      }
    }
  })
})
