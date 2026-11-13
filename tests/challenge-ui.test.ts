import { beforeAll, describe, expect, it } from 'vitest'
import { loadPveContent } from '../src/game/pve-content.ts'
beforeAll(loadPveContent)
import { renderChallenge } from '../src/ui/screens/challenge.ts'
import { game, ui } from '../src/ui/state.ts'
import { enterCup } from '../src/game/cup-run.ts'

describe('挑战页面', () => {
  it('传奇挑战默认筛选 B 档，所有档位都可以直接开战', () => {
    expect(ui.legendTier).toBe('B')
    ui.challengeMode = 'legend'
    ui.legendTier = 'B'
    ui.legendSearch = ''
    ui.legendCountry = 'ALL'
    ui.legendEra = 'ALL'
    const legend = renderChallenge()
    expect(legend).toContain('data-legend-tier="B" class="active"')
    expect(legend).toContain('data-team="aston-villa-1981-82"')
    expect(legend).not.toContain('data-team="juventus-1997-98"')
    // 没有前置解锁：不需要先赢 B，直接切到 S+ 就能开战。
    ui.legendTier = 'S+'
    const sPlus = renderChallenge()
    expect(sPlus).toContain('data-legend-tier="S+" class="active"')
    expect(sPlus).toContain('data-team="barcelona-2010-11"')
    expect(sPlus).not.toContain('data-team="aston-villa-1981-82"')
  })
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

  it('通关第 50 关后显示全明星奖励选择', () => {
    game.pve!.peak.cleared = 50
    delete game.pve!.peak.reward50
    ui.challengeMode = 'peak'
    ui.peakPreviewStage = 50
    const html = renderChallenge()
    expect(html).toContain('第 50 关全明星奖励')
    expect(html).toContain('data-action="claim-peak-reward"')
    expect(html).toContain('当前 CA')
    expect(html).not.toContain('上限 PA')
    expect(html).not.toContain('球星上限')
  })

  it('传奇表显示掉落技能书，已获得书在挑战页可见', () => {
    game.legendBooks = [{ id: 'lg_drill_master', tier: 'rainbow' }]
    ui.challengeMode = 'legend'
    ui.legendTier = 'ALL'
    ui.legendSearch = '阿贾克斯'
    ui.legendCountry = 'ALL'
    ui.legendEra = 'ALL'
    const html = renderChallenge()
    expect(html).toContain('掉落技能书')
    expect(html).toContain('技能书库存')
    expect(html).toContain('skill-rainbow')
    expect(html).toContain('训练狂人')
    expect(html).toContain('彩')
    ui.legendSearch = ''
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
