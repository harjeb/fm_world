import { describe, expect, it } from 'vitest'
import { DETAILED_POSITIONS } from '../src/game/detailed-positions.ts'
import { FORMATIONS } from '../src/game/data/formations.ts'
import { detailedPositionForSlot } from '../src/game/detailed-positions.ts'
import { roleFit, rolesForSlot } from '../src/game/data/roles.ts'
import { attrStorage } from '../src/game/scale.ts'
import { FIELD_ATTRIBUTES, GK_ATTRIBUTES, type AttrKey, type DetailedPosition } from '../src/game/types.ts'
import { positionRelativeRating, preferredPositionRatings, type ScoutSubject } from '../src/game/scout-rating.ts'

function player(rating = 60, position: DetailedPosition = 'ST', gk = false): ScoutSubject {
  const attrs = Object.fromEntries([...FIELD_ATTRIBUTES, ...GK_ATTRIBUTES].map(key => [key, attrStorage(key as AttrKey, rating, gk)]))
  return { attrs, positions: { GK: gk ? 100 : 0, CB: 0, W: 0, CM: 0, ST: 0 }, detailedPositions: { [position]: 100 } }
}

describe('position-relative scout ratings', () => {
  it('compares the top three playable teammates, with half-star rounding and caps', () => {
    const subject = player(60)
    const roster = [player(100), player(80), player(60), player(1)]
    const result = positionRelativeRating(subject, 'ST', roster)!
    expect(result.reference).toBeCloseTo(80)
    expect(result.score).toBeCloseTo(60)
    expect(result.stars).toBe(2)
    expect(positionRelativeRating(player(150), 'ST', roster)!.stars).toBe(5)
    expect(positionRelativeRating(player(0), 'ST', roster)!.stars).toBe(0)
    expect(positionRelativeRating(player(60), 'ST', [player(60)])!.stars).toBe(3)
    expect(positionRelativeRating(player(66), 'ST', [player(60)])!.stars).toBe(3.5)
  })

  it('does not invent a baseline, treat unplayable positions as zero stars, or count zero references', () => {
    expect(positionRelativeRating(player(), 'ST', [])).toBeNull()
    expect(positionRelativeRating(player(), 'ST', [player(0)])).toBeNull()
    const unplayable = player(); unplayable.detailedPositions!.ST = 79
    expect(positionRelativeRating(unplayable, 'ST', [player()])).toBeNull()
    expect(positionRelativeRating(player(), 'ST', [unplayable])).toBeNull()
    expect(preferredPositionRatings(unplayable, [player()])).toEqual([])
    unplayable.detailedPositions!.ST = 80
    expect(positionRelativeRating(unplayable, 'ST', [player()])!.score).toBeCloseTo(55.2)
  })

  it('uses eligible formation roles for every detailed position', () => {
    for (const position of DETAILED_POSITIONS) {
      const p = player(60, position, position === 'GK')
      const result = positionRelativeRating(p, position, [p])!
      expect(result, position).not.toBeNull()
      const allowed = Object.values(FORMATIONS).flatMap(f => f.slots).filter(s => detailedPositionForSlot(s) === position).flatMap(rolesForSlot)
      expect(allowed).toContain(result.role)
      expect(result.score).toBeCloseTo(roleFit(p.attrs as Record<string, number>, result.role, position === 'GK'))
    }
    const wing = player(60, 'DL')
    expect(['w_back', 'w_support']).toContain(positionRelativeRating(wing, 'DL', [wing])!.role)
    expect(positionRelativeRating(wing, 'AML', [wing])).toBeNull()
  })

  it('keeps goalkeeper scales and reference populations separate', () => {
    const keeper = player(60, 'GK', true)
    const field = player(60, 'ST')
    field.detailedPositions!.GK = 100
    keeper.detailedPositions!.ST = 100
    expect(positionRelativeRating(keeper, 'GK', [field])).toBeNull()
    expect(positionRelativeRating(field, 'ST', [keeper])).toBeNull()
    expect(positionRelativeRating(keeper, 'ST', [field])).toBeNull()
    expect(positionRelativeRating(field, 'GK', [keeper])).toBeNull()
    expect(positionRelativeRating(keeper, 'GK', [keeper])!.score).toBeCloseTo(60)
  })

  it('uses supplied simulated attributes, including values above 1500, and does not impute missing role inputs', () => {
    const reference = player(100)
    const simulated = player(100)
    simulated.attrs.shooting = 2000
    const result = positionRelativeRating(simulated, 'ST', [reference])!
    expect(result.score).toBeGreaterThan(100)
    expect(result.stars).toBeGreaterThan(3)
    expect(positionRelativeRating({ ...simulated, attrs: {} }, 'ST', [reference])).toBeNull()
    expect(positionRelativeRating(reference, 'ST', [{ ...simulated, attrs: {} }])).toBeNull()
  })

  it('uses exactly the supplied roster for version comparisons and handles legacy coarse positions', () => {
    const old = player(60); const next = player(72)
    expect(positionRelativeRating(old, 'ST', [old])!.stars).toBe(3)
    expect(positionRelativeRating(next, 'ST', [old])!.stars).toBe(4)
    const legacy = { ...old, detailedPositions: undefined, positions: { ...old.positions, ST: 100 } }
    expect(positionRelativeRating(legacy, 'ST', [old])!.stars).toBe(3)
  })

  it('orders playable preferred positions by score rather than relative stars', () => {
    const p = player(60); p.detailedPositions!.MC = 80
    const mc = player(50, 'MC')
    expect(preferredPositionRatings(p, [p, mc]).map(x => x.position)).toEqual(['ST', 'MC'])
  })
})
