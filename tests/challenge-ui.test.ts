import { describe, expect, it } from 'vitest'
import { renderChallenge } from '../src/ui/screens/challenge.ts'
import { game, ui } from '../src/ui/state.ts'
import { enterCup } from '../src/game/cup-run.ts'

describe('挑战页面', () => {
  it('四种模式都能渲染', () => {
    for (const mode of ['friendly', 'legend', 'cup', 'peak'] as const) {
      ui.challengeMode = mode
      ui.cupPreviewId = null
      const html = renderChallenge()
      expect(html.length).toBeGreaterThan(100)
      expect(html).toContain('挑战')
    }
  })

  it('报名后的杯赛小组赛可渲染', () => {
    const result = enterCup(game, 'community')
    expect(result.ok, result.error).toBe(true)
    ui.challengeMode = 'cup'
    ui.cupPreviewId = 'community'
    const html = renderChallenge()
    expect(html).toContain('小组赛')
    expect(html).toContain('继续比赛')
    expect(html).toContain('你')
  })

  it('传奇档位筛选和杯赛分组预览可渲染', () => {
    ui.challengeMode = 'legend'
    ui.legendTier = 'S+'
    const legend = renderChallenge()
    expect(legend).toContain('S+')
    expect(legend).toContain('传奇球队')

    ui.challengeMode = 'cup'
    ui.cupPreviewId = 'league'
    const cup = renderChallenge()
    expect(cup).toContain('A 组')
    expect(cup).toContain('随机')
  })
})
