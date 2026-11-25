import { beforeAll, describe, expect, it } from 'vitest'
import { loadPveContent } from '../src/game/pve-content.ts'
beforeAll(loadPveContent)
import { renderChallenge } from '../src/ui/screens/challenge.ts'
import { game, ui } from '../src/ui/state.ts'
import { peakDailyStatus } from '../src/game/peak-attempts.ts'
import { LEGEND_DAILY_LIMIT, legendDailyStatus } from '../src/game/legend-attempts.ts'

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
  it('杯赛未启用时保留旧挑战入口，启用后移到赛季页', () => {
    for (const mode of ['friendly', 'legend', 'cup', 'peak'] as const) {
      ui.challengeMode = mode
      ui.cupPreviewId = null
      const html = renderChallenge()
      expect(html.length).toBeGreaterThan(100)
      expect(html).toContain('挑战')
      expect(html).toContain('data-challenge-mode="cup"')
    }
  })

  it('巅峰展示关卡奖励与每日次数，重打不能重复领奖', () => {
    const peak = structuredClone(game.pve!.peak)
    const previousActive = game.activeMatch
    try {
      game.activeMatch = undefined
      game.pve!.peak.cleared = 30
      game.pve!.peak.dailyAttempts = { day: peakDailyStatus(game).day, count: 10 }
      ui.challengeMode = 'peak'
      ui.peakPreviewStage = 30
      const html = renderChallenge()
      expect(html).toContain('今日剩余')
      expect(html).toContain('0 / 10')
      expect(html).toContain('北京时间 00:00 重置')
      expect(html).toContain('次数已用完')
      expect(html).toContain('金币 50,000')
      expect(html).toContain('属性突破卡 ×1')
      expect(html).toContain('首次奖励不会重复发放')
      expect(html).toContain('从全明星名单中任选 1 人加入')
      expect(html).toContain('技能书 <b class="book-name skill-rainbow">射手直觉</b>')
      expect(html).not.toContain('彩色技能书')
      expect(html).toContain('第 85 关')
      ui.peakPreviewStage = 1
      expect(renderChallenge()).toContain('金币 30,000')
      ui.peakPreviewStage = 32
      expect(renderChallenge()).toContain('仅预览')
    } finally {
      game.pve!.peak = peak
      game.activeMatch = previousActive
      ui.peakPreviewStage = null
    }
  })

  it('正式赛季杯赛启用后，旧杯赛挑战入口隐藏', () => {
    const world = game.world
    try {
      game.world!.seasonCupMode = 1
      ui.challengeMode = 'friendly'
      const html = renderChallenge()
      expect(html).not.toContain('data-challenge-mode="cup"')
      expect(html).toContain('data-challenge-mode="peak"')
    } finally {
      if (world) delete world.seasonCupMode
    }
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
    expect(html).toContain('<td><span class="tag skill-rainbow"><span class="skill-label">训练狂人</span></span></td>')
    expect(html).toContain('技能书库存')
    expect(html).toContain('<b class="book-name skill-rainbow">训练狂人</b>')
    expect(html).not.toContain('skill-label">彩<')
    ui.legendSearch = ''
  })

  it('传奇档位筛选与现实日 20 次配额可渲染，次数用完时禁用开战按钮', () => {
    const prevAttempts = game.pve!.legendDailyAttempts
    const previousActive = game.activeMatch
    try {
      game.activeMatch = undefined
      game.pve!.legendDailyAttempts = { day: legendDailyStatus(game).day, count: LEGEND_DAILY_LIMIT }
      ui.challengeMode = 'legend'
      ui.legendTier = 'S+'
      const legend = renderChallenge()
      expect(legend).toContain('S+')
      expect(legend).toContain('传奇球队')
      expect(legend).toContain('今日剩余')
      expect(legend).toContain(`0 / ${LEGEND_DAILY_LIMIT}`)
      expect(legend).toContain('北京时间 00:00 重置')
      expect(legend).toContain('次数已用完')
    } finally {
      game.pve!.legendDailyAttempts = prevAttempts
      game.activeMatch = previousActive
    }
  })
})
