import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  const store = new Map<string, string>()
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) }
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', { localStorage: storage, location: { search: '', hash: '', origin: 'http://localhost' }, addEventListener() {}, matchMedia: () => ({ matches: false }) })
  vi.stubGlobal('document', { documentElement: { dataset: {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('手机端 UI 导航与适配', () => {
  it('底部栏提供“全部”菜单入口，顶部栏标记余额列，且不误触发转会报价红点', async () => {
    const { game, ui } = await import('../src/ui/state.ts')
    const { renderMobileNavSheet, renderSidebar, renderTopbar } = await import('../src/ui/screens/shell.ts')

    game.transferOffers = []
    ui.mobileNavOpen = false
    ui.screen = 'home'

    const sidebar = renderSidebar()
    expect(sidebar).toContain('data-action="mobile-nav-toggle"')
    expect(sidebar).not.toContain('nav-badge alert')
    expect(sidebar).not.toContain('mobile-more-badge is-alert')
    expect(renderMobileNavSheet()).toBe('')

    const topbar = renderTopbar()
    expect(topbar).toContain('top-stat-balance')
  })

  it('打开手机端“全部导航”抽屉后展示俱乐部信息、余额与全部分组页面', async () => {
    const { game, ui } = await import('../src/ui/state.ts')
    const { renderMobileNavSheet } = await import('../src/ui/screens/shell.ts')

    ui.mobileNavOpen = true
    ui.screen = 'transfer'
    const html = renderMobileNavSheet()
    expect(html).toContain('class="mobile-nav-sheet"')
    expect(html).toContain(game.clubName)
    expect(html).toContain('余额')
    expect(html).toContain('data-action="mobile-nav-go" data-screen="world"')
    expect(html).toContain('data-action="mobile-nav-go" data-screen="shop"')
    expect(html).toContain('data-action="mobile-nav-go" data-screen="transfer"')
    expect(html).toContain('mobile-nav-tile active" data-action="mobile-nav-go" data-screen="transfer"')
    // 不产生重复的 [data-nav] 选择器，避免干扰自动化/侧栏导航定位。
    expect(html).not.toContain('data-nav=')
    ui.mobileNavOpen = false
  })

  it('手机端全屏弹窗覆盖规则置于 style.css 末尾，不被后置弹窗 margin-top 覆盖', () => {
    const css = fs.readFileSync(path.resolve('src/style.css'), 'utf8')
    const negoIdx = css.indexOf('.nego-modal { max-width:')
    const autoIdx = css.indexOf('.auto-modal { max-width:')
    const changelogIdx = css.indexOf('.changelog-modal { max-width:')
    const mobileModalOverrideIdx = css.lastIndexOf('.player-analysis-modal {')
    expect(negoIdx).toBeGreaterThan(0)
    expect(autoIdx).toBeGreaterThan(0)
    expect(changelogIdx).toBeGreaterThan(0)
    expect(mobileModalOverrideIdx).toBeGreaterThan(Math.max(negoIdx, autoIdx, changelogIdx))
  })
})
