import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let store: Map<string, string>
let themeMeta: { content: string; setAttribute: (name: string, value: string) => void }
let dataset: Record<string, string>

beforeEach(() => {
  vi.resetModules()
  store = new Map<string, string>()
  dataset = {}
  themeMeta = {
    content: '#0d1014',
    setAttribute(name: string, value: string) {
      if (name === 'content') this.content = value
    },
  }
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  }
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', { localStorage: storage, location: { search: '', hash: '', origin: 'http://localhost' }, addEventListener() {}, matchMedia: () => ({ matches: false }) })
  vi.stubGlobal('document', {
    documentElement: { dataset },
    querySelector: (sel: string) => (sel === 'meta[name="theme-color"]' ? themeMeta : null),
    querySelectorAll: () => [],
    addEventListener() {},
  })
})

afterEach(() => { vi.unstubAllGlobals() })

describe('浅色 / 深色主题切换与持久化', () => {
  it('默认深色，切换浅色后写入 localStorage、更新 data-theme 与 theme-color，刷新后可还原', async () => {
    const theme = await import('../src/ui/theme.ts')
    expect(theme.initTheme()).toBe('dark')
    expect(dataset.theme).toBe('dark')
    expect(themeMeta.content).toBe('#0d1014')

    expect(theme.toggleTheme()).toBe('light')
    expect(theme.isLightTheme()).toBe(true)
    expect(dataset.theme).toBe('light')
    expect(themeMeta.content).toBe('#f8fafc')
    expect(store.get(theme.THEME_STORAGE_KEY)).toBe('light')

    // 模拟刷新重新加载模块
    vi.resetModules()
    dataset.theme = ''
    const reloaded = await import('../src/ui/theme.ts')
    expect(reloaded.initTheme()).toBe('light')
    expect(dataset.theme).toBe('light')
    expect(themeMeta.content).toBe('#f8fafc')
  })

  it('顶栏与手机端全部菜单渲染主题切换按钮，并根据当前主题切换文案', async () => {
    const theme = await import('../src/ui/theme.ts')
    const { ui } = await import('../src/ui/state.ts')
    const { renderMobileNavSheet, renderTopbar } = await import('../src/ui/screens/shell.ts')

    theme.applyTheme('dark')
    ui.mobileNavOpen = true
    expect(renderTopbar()).toContain('data-action="theme-toggle"')
    expect(renderTopbar()).toContain('浅色')
    expect(renderMobileNavSheet()).toContain('data-action="theme-toggle"')

    theme.applyTheme('light')
    expect(renderTopbar()).toContain('深色')
    expect(renderMobileNavSheet()).toContain('深色')
    ui.mobileNavOpen = false
  })
})
