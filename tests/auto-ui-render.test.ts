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

  it('自动培养未开启时仅显示单按钮入口，1 级弹窗显示简洁流派预设，2 级弹窗提供属性细调', async () => {
    const { createInitialGame } = await import('../src/game/state.ts')
    const { game, ui } = await import('../src/ui/state.ts')
    const { startTraining, setAutoTrainingConfig, applyAutoTrainingPreset } = await import('../src/game/actions.ts')
    const { renderTraining, renderAutoStrategyOverlay } = await import('../src/ui/screens/training.ts')
    Object.assign(game, createInitialGame(77))
    const first = game.roster.find((p) => p.positions.GK <= 0)!
    const second = game.roster.find((p) => p.positions.GK <= 0 && p.id !== first.id)!

    // 未开始培养时：1 级菜单支持一键「开始并自动培养」
    ui.screen = 'training'
    ui.trainingPlayerId = first.id
    ui.autoStrategyOpen = true
    ui.autoStrategyDetail = false
    const startModal = renderAutoStrategyOverlay()
    expect(startModal).toContain('开始并自动培养')
    expect(startModal).toContain('data-action="training-auto-preset"')
    expect(startModal).toContain('data-action="auto-strategy-detail-open"')
    expect(startModal).not.toContain('data-action="training-auto-priority"')
    ui.autoStrategyOpen = false

    // 进行中培养：未开启自动时卡片上只有简洁的自动培养按钮，开启后出现当前预设切换按钮
    startTraining(game, first.id)
    let html = renderTraining()
    expect(html).toContain('data-action="training-auto-toggle"')
    expect(html).not.toContain('data-action="auto-strategy-open"')
    expect(html).toContain('aria-checked="false"')
    expect(html).not.toContain('属性优先级')
    const head = html.slice(html.indexOf('<section class="train-head">'), html.indexOf('</section>'))
    expect(head).toContain('train-auto')
    expect(head).toContain(first.name)

    applyAutoTrainingPreset(game, first.id, 'finisher')
    setAutoTrainingConfig(game, first.id, { autopilot: true })
    html = renderTraining()
    expect(html).toContain('auto-switch on')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('data-action="auto-strategy-open"')
    expect(html).toContain('锋线终结')

    // 1 级简洁弹窗：默认选中对应预设，不堆砌排序箭头和输入框
    expect(renderAutoStrategyOverlay()).toBe('')
    ui.autoStrategyOpen = true
    ui.autoStrategyDetail = false
    const l1 = renderAutoStrategyOverlay()
    expect(l1).toContain('自动培养 · 快捷方向')
    expect(l1).toContain('招牌特长')
    expect(l1).toContain('锋线终结')
    expect(l1).toContain('细调属性与目标')
    expect(l1).toContain('data-action="training-auto-confirm"')

    // 2 级细调弹窗：按模式展示属性优先级 / 最低目标 / 综合最大说明，且各球员独立保存
    ui.autoStrategyDetail = true
    const l2Priority = renderAutoStrategyOverlay()
    expect(l2Priority).toContain('二级细调')
    expect(l2Priority).toContain('属性优先级')
    expect(l2Priority).toContain('data-action="training-auto-reset"')
    expect((l2Priority.match(/>主要</g) ?? []).length).toBe(2)

    setAutoTrainingConfig(game, second.id, { mode: 'targets', preset: 'custom', targets: { passing: 950 } })
    expect(renderAutoStrategyOverlay()).toContain('class="active" data-action="training-auto-mode" data-mode="priority"')
    ui.trainingPlayerId = second.id
    const l2Targets = renderAutoStrategyOverlay()
    expect(l2Targets).toContain('class="active" data-action="training-auto-mode" data-mode="targets"')
    expect(l2Targets).toContain('data-action="training-auto-save"')
    ui.autoStrategyDetail = false
    expect(renderAutoStrategyOverlay()).toContain('自定义细调方案')

    ui.autoStrategyOpen = false
    ui.autoStrategyDetail = false
  })
})
