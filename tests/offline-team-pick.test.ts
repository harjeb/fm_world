import { describe, expect, it } from 'vitest'

describe('离线模式第一次进来要自己选队', () => {
  it('没有本地存档时系统先自动建一份并标记“还没选过队”；选队弹窗在必选模式下不能取消', async () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k), clear: () => store.clear() }
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage, location: { search: '', hash: '', origin: 'http://localhost' }, addEventListener() {}, matchMedia: () => ({ matches: false }) } })
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { dataset: {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, classList: { add() {} } }) } })

    const { teamPickPending, setTeamPickPending } = await import('../src/game/state.ts')
    // 首次加载 ui/state：没有存档 → 自动建档并标记待选
    expect(teamPickPending()).toBe(false)
    const { ui } = await import('../src/ui/state.ts')
    expect(teamPickPending()).toBe(true)

    const { renderNewGameOverlay } = await import('../src/ui/screens/overlays.ts')
    const { previewD2Clubs } = await import('../src/game/world.ts')
    const clubs = previewD2Clubs(5)
    ui.newGamePreview = { seed: 5, clubs }
    ui.newGameClubId = clubs[0].id
    ui.newGameOpen = true

    // 主动点“新游戏”：可以取消，并提醒会覆盖存档
    ui.newGameRequired = false
    let html = renderNewGameOverlay()
    expect(html).toContain('data-action="newgame-close"')
    expect(html).toContain('覆盖当前存档')

    // 第一次进离线模式：必须选，没有关闭/取消，也没有覆盖存档的警告
    ui.newGameRequired = true
    html = renderNewGameOverlay()
    expect(html).not.toContain('data-action="newgame-close"')
    expect(html).not.toContain('覆盖当前存档')
    expect(html).toContain('data-action="newgame-confirm"')
    expect(html).toContain('并开始')

    setTeamPickPending(false)
    expect(teamPickPending()).toBe(false)
    expect(store.has('fm-seven-a-side-team-pick-pending')).toBe(false)
    ui.newGameOpen = false
    ui.newGameRequired = false
  })
})
