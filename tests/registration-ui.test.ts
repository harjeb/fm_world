import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  const store = new Map<string, string>()
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) }
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', { localStorage: storage, location: { search: '', hash: '', origin: 'http://localhost' }, addEventListener() {}, matchMedia: () => ({ matches: false }) })
  vi.stubGlobal('document', { documentElement: { dataset: {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('注册选队预览', () => {
  it('球员 CA 显示为整数，仍按完整精度排序且不修改服务器给出的原始数值', async () => {
    const positions = { GK: 0, CB: 0, W: 0, CM: 99, ST: 0 }
    const players = [
      { name: '第一位', ca: 201.24, positions },
      { name: '第四位', ca: 198.99, positions },
      { name: '第二位', ca: 200.51, positions },
      { name: '第三位', ca: 199.49, positions },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ clubs: [{ id: 'club', name: '测试队', tier: 'division2', players }] }) }))
    const online = await import('../src/online.ts')
    const { ui } = await import('../src/ui/state.ts')
    const { renderAccountOverlay } = await import('../src/ui/screens/overlays.ts')
    online.publicConfig.registration = 'open'
    online.onlineState.status = 'offline'
    await online.refreshRegistrationClubs()
    ui.accountOpen = true
    ui.authMode = 'register'
    ui.registrationClubId = 'club'

    const html = renderAccountOverlay()
    const shown = [...html.matchAll(/CA (\d+(?:\.\d+)?)/g)].map((match) => match[1])
    expect(shown).toEqual(['201', '201', '199'])
    expect(html).not.toContain('第四位')
    expect(html.indexOf('第一位')).toBeLessThan(html.indexOf('第二位'))
    expect(html.indexOf('第二位')).toBeLessThan(html.indexOf('第三位'))
    expect(online.registrationClubs![0].players.map((player) => player.ca)).toEqual([201.24, 198.99, 200.51, 199.49])
  })

  it('扩展赛区在注册下拉框中显示为 东区、西区 等名称（无数字）', async () => {
    const positions = { GK: 0, CB: 0, W: 0, CM: 99, ST: 0 }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        clubs: [
          { id: 'd2z3_01', name: '罗斯托克', tier: 'division2', conference: 'zone3', rating: 750, players: [{ name: '主力', ca: 80, positions }] },
          { id: 'd2z4_01', name: '温布尔登', tier: 'division2', conference: 'zone4', rating: 740, players: [{ name: '主力', ca: 79, positions }] },
        ],
      }),
    }))
    const online = await import('../src/online.ts')
    const { ui } = await import('../src/ui/state.ts')
    const { renderAccountOverlay } = await import('../src/ui/screens/overlays.ts')
    online.publicConfig.registration = 'invite'
    online.onlineState.status = 'offline'
    await online.refreshRegistrationClubs()
    ui.accountOpen = true
    ui.authMode = 'register'
    ui.registrationClubId = 'd2z3_01'

    const html = renderAccountOverlay()
    expect(html).toContain('罗斯托克 · 东区 · RANK 750')
    expect(html).toContain('温布尔登 · 西区 · RANK 740')
    expect(html).not.toContain('第 3 区')
    // 注册界面醒目提示 3 天 AI 接管与 7 天自动清理释放规则
    expect(html).toContain('banner warn')
    expect(html).toContain('3 天')
    expect(html).toContain('7 天')
    expect(html).toContain('自动清理教练账号并释放球队席位')
  })

  it('双区精英联赛空缺球队在注册下拉框中显示群英/豪强分区名', async () => {
    const positions = { GK: 0, CB: 0, W: 0, CM: 99, ST: 0 }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        clubs: [
          { id: 'd1_01', name: '塞维利亚', tier: 'division1', conference: 'north', rating: 1850, players: [{ name: '主力', ca: 180, positions }] },
          { id: 'd1_02', name: '比利亚雷亚尔', tier: 'division1', conference: 'south', rating: 1820, players: [{ name: '主力', ca: 178, positions }] },
        ],
      }),
    }))
    const online = await import('../src/online.ts')
    const { ui } = await import('../src/ui/state.ts')
    const { renderAccountOverlay } = await import('../src/ui/screens/overlays.ts')
    online.publicConfig.registration = 'open'
    online.onlineState.status = 'offline'
    await online.refreshRegistrationClubs()
    ui.accountOpen = true
    ui.authMode = 'register'
    ui.registrationClubId = 'd1_01'

    const html = renderAccountOverlay()
    expect(html).toContain('塞维利亚 · 精英联赛 · 群英区 · RANK 1850')
    expect(html).toContain('比利亚雷亚尔 · 精英联赛 · 豪强区 · RANK 1820')
  })
})
