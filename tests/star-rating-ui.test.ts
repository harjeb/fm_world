import { describe, expect, it } from 'vitest'
import { starRating, youthStars, youthRatingSummary } from '../src/ui/stars.ts'
import { renderRelativePositionRatings } from '../src/ui/screens/scouting.ts'
import { createInitialGame } from '../src/game/state.ts'

describe('独立星级样式与青训星级', () => {
  it('满星、半星与灰星只用专用类，不能误套全局空面板样式', () => {
    const html = starRating(2.5, '位置能力', true)
    expect(html.match(/class="rating-star /g)).toHaveLength(5)
    expect(html.match(/rating-star--full/g)).toHaveLength(2)
    expect(html.match(/rating-star--half/g)).toHaveLength(1)
    expect(html.match(/rating-star--empty/g)).toHaveLength(2)
    for (const match of html.matchAll(/class="([^"]+)"/g)) expect(match[1].split(/\s+/)).not.toContain('empty')
    expect(html).toContain('位置能力：2.5 星（满分 5 星）')
    expect(html).toContain('rating-number')
  })
  it('不显示数字时只显示星星；正确处理边界和非法值', () => {
    expect(starRating(3)).not.toContain('rating-number')
    expect(starRating(-1).match(/rating-star--empty/g)).toHaveLength(5)
    expect(starRating(8).match(/rating-star--full/g)).toHaveLength(5)
    expect(starRating(NaN).match(/rating-star--empty/g)).toHaveLength(5)
    expect(starRating(2, '<script>')).toContain('&lt;script&gt;')
  })
  it('当前能力与潜力共用固定尺度、半星递增，不泄露精确能力或上限', () => {
    expect(youthStars(280)).toBe(5)
    expect(youthStars(200)).toBe(3.5)
    expect(youthStars(80)).toBe(1.5)
    let previous = 0
    for (let ca = 0; ca <= 300; ca++) {
      const value = youthStars(ca)
      expect(value).toBeGreaterThanOrEqual(previous)
      expect(value).toBeLessThanOrEqual(5)
      expect(Number.isInteger(value * 2)).toBe(true)
      previous = value
    }
    const html = youthRatingSummary(91.7, 203.6)
    expect(html).toContain('当前能力')
    expect(html).toContain('潜力')
    expect(html).not.toMatch(/91\.7|203\.6|上限|CA|rating-number/)
  })
  it('球员详情位置星级使用同一组件，空星不再包含 .empty', () => {
    const game = createInitialGame(765)
    const html = renderRelativePositionRatings(game.roster[0], game.roster)
    expect(html).toContain('rating-star--empty')
    expect(html).not.toContain('scout-star empty')
    expect(html).toContain('rating-number')
  })
})
