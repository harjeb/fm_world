export type ThemeMode = 'dark' | 'light'

export const THEME_STORAGE_KEY = 'fm_world_theme'
const THEME_COLORS: Record<ThemeMode, string> = {
  dark: '#0d1014',
  light: '#f8fafc',
}

let cachedTheme: ThemeMode | null = null

function readSavedTheme(): ThemeMode {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(THEME_STORAGE_KEY) : null
    if (raw === 'light' || raw === 'dark') return raw
  } catch {
    // 隐私模式或无存储环境回退深色主题
  }
  return 'dark'
}

export function currentTheme(): ThemeMode {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement?.dataset?.theme
    if (attr === 'light' || attr === 'dark') {
      cachedTheme = attr
      return attr
    }
  }
  if (cachedTheme) return cachedTheme
  cachedTheme = readSavedTheme()
  return cachedTheme
}

export function isLightTheme(): boolean {
  return currentTheme() === 'light'
}

export function applyTheme(theme: ThemeMode, persist = true): ThemeMode {
  cachedTheme = theme
  if (typeof document !== 'undefined') {
    if (document.documentElement?.dataset) {
      document.documentElement.dataset.theme = theme
    }
    const meta = document.querySelector?.('meta[name="theme-color"]')
    meta?.setAttribute('content', THEME_COLORS[theme])
  }
  if (persist) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // 忽略写入受限异常
    }
  }
  return theme
}

export function initTheme(): ThemeMode {
  return applyTheme(readSavedTheme(), false)
}

export function toggleTheme(): ThemeMode {
  return applyTheme(currentTheme() === 'light' ? 'dark' : 'light', true)
}
