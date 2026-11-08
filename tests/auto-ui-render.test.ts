import { beforeEach, describe, expect, it } from 'vitest'

// 渲染函数依赖浏览器环境的全局对象，这里只给它最少的桩。
function stubBrowser(): void {
  const store = new Map<string, string>()
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k), clear: () => store.clear() }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage, location: { search: '', hash: '', origin: 'http://localhost' }, addEventListener() {}, matchMedia: () => ({ matches: false }) } })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { dataset: {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, classList: { add() {} } }) } })
}

describe('自动培养界面', () => {
  beforeEach(stubBrowser)

  it('世界页每个联赛的每支球队都有 RANK（含别的联赛），联赛越高 RANK 越高', async () => {
    const { createWorldGame } = await import('../src/game/world.ts')
    const { game } = await import('../src/ui/state.ts')
    const { divisionRatings } = await import('../src/ui/club-view.ts')
    Object.assign(game, createWorldGame(2024))
    const world = game.world!
    const averages: Record<string, number> = {}
    for (const division of world.divisions) {
      const ids = (division.clubIds ?? []).map((id) => id)
      const ratings = divisionRatings(world, ids)
      for (const id of ids) expect(ratings.get(id), `${division.divisionId}:${id}`).toBeGreaterThan(0)
      averages[division.tier ?? ''] = ids.reduce((sum, id) => sum + (ratings.get(id) ?? 0), 0) / ids.length
    }
    expect(averages.champions).toBeGreaterThan(averages.division1)
    expect(averages.division1).toBeGreaterThan(averages.division2)
  })

  it('积分榜带每支球队的RANK（首发 CA 之和）', async () => {
    const { createInitialGame } = await import('../src/game/state.ts')
    const { game } = await import('../src/ui/state.ts')
    const { leagueTable } = await import('../src/ui/components.ts')
    const { clubRatings } = await import('../src/game/club-rating.ts')
    Object.assign(game, createInitialGame(78))
    const ratings = clubRatings(game)
    expect(ratings.size).toBe(game.aiTeams.length + 1)
    const html = leagueTable(game.season.table, { tier: game.season.tier, fixtures: game.season.fixtures, ratings })
    expect(html).toContain('RANK')
    for (const team of game.aiTeams.slice(0, 3)) expect(html).toContain(String(Math.round(ratings.get(team.id)!)))
    expect(leagueTable(game.season.table, { tier: game.season.tier })).not.toContain('RANK')
  })

  it('开关和自动策略按钮在培养卡片上，底部不再有自动培养面板；策略弹窗按球员显示', async () => {
    const { createInitialGame } = await import('../src/game/state.ts')
    const { game, ui } = await import('../src/ui/state.ts')
    const { startTraining, setAutoTrainingConfig } = await import('../src/game/actions.ts')
    const { renderTraining, renderAutoStrategyOverlay } = await import('../src/ui/screens/training.ts')
    Object.assign(game, createInitialGame(77))
    const first = game.roster.find((p) => p.positions.GK <= 0)!
    const second = game.roster.find((p) => p.positions.GK <= 0 && p.id !== first.id)!
    startTraining(game, first.id)
    ui.screen = 'training'
    ui.trainingPlayerId = first.id

    let html = renderTraining()
    expect(html).toContain('data-action="training-auto-toggle"')
    expect(html).toContain('data-action="auto-strategy-open"')
    expect(html).toContain('aria-checked="false"')
    expect(html).not.toContain('自动进行一步')
    expect(html).not.toContain('自动跑完本轮培养')
    expect(html).not.toContain('属性优先级')
    // 控件和角色/回合数在同一张卡片（train-head）里
    const head = html.slice(html.indexOf('<section class="train-head">'), html.indexOf('</section>'))
    expect(head).toContain('train-auto')
    expect(head).toContain(first.name)

    setAutoTrainingConfig(game, first.id, { autopilot: true })
    html = renderTraining()
    expect(html).toContain('auto-switch on')
    expect(html).toContain('aria-checked="true"')

    // 弹窗：默认关闭，打开后是这名球员自己的策略
    expect(renderAutoStrategyOverlay()).toBe('')
    ui.autoStrategyOpen = true
    const modal = renderAutoStrategyOverlay()
    expect(modal).toContain('属性优先级')
    expect(modal).toContain(first.name)
    expect(modal).toContain('data-action="training-auto-save"')
    expect(modal).toContain('data-mode="max"')
    expect(modal).toContain('data-action="training-auto-reset"')
    // 两个主要属性在列表最前面并带“主要”标记
    expect((modal.match(/>主要</g) ?? []).length).toBe(2)
    setAutoTrainingConfig(game, second.id, { mode: 'targets' })
    expect(renderAutoStrategyOverlay()).toContain('class="active" data-action="training-auto-mode" data-mode="priority"')
    ui.trainingPlayerId = second.id
    expect(renderAutoStrategyOverlay()).toContain('class="active" data-action="training-auto-mode" data-mode="targets"')
    ui.autoStrategyOpen = false
  })
})
