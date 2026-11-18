import { describe, expect, it } from 'vitest'
import { renderAutoSubEditor, applyAutoSubFieldChange } from '../src/ui/auto-sub-editor.ts'
import { emptyAutoSubs } from '../src/game/match/management.ts'
import { createInitialGame } from '../src/game/state.ts'
import { setLineup } from '../src/game/actions.ts'
import type { AutoSubPlan } from '../src/game/types.ts'

const editor = (plan: AutoSubPlan, scope: 'lineup' | 'match' = 'lineup', disabled = false) =>
  renderAutoSubEditor({ scope, plan, formationId: '4-4-2', starters: [], bench: [], disabled })
const field = (value: string, scope = 'lineup', disabled = false) => ({
  dataset: { asScope: scope, asField: 'preMatchStaminaBelow' }, value, disabled,
} as unknown as HTMLSelectElement)
const select = (html: string) => html.match(/<select id="auto-sub-pre-match-stamina"[\s\S]*?<\/select>/)?.[0] ?? ''

describe('赛前轮换界面', () => {
  it('阵容设置默认选中 65%，独立显示关闭和全部 1–99% 阈值并正确切换', () => {
    const plan = emptyAutoSubs()
    let html = select(editor(plan))
    expect(html).toContain('<option value="65" selected>65%</option>')
    for (let i = 1; i <= 99; i++) expect(html).toContain(`value="${i}"`)
    plan.preMatchStaminaBelow = null
    html = select(editor(plan))
    expect(html).toContain('<option value="" selected>关闭</option>')
    plan.preMatchStaminaBelow = 67
    html = select(editor(plan))
    expect(html).toContain('<option value="67" selected>67%</option>')
    expect(html).not.toContain('<option value="" selected>')
  })

  it('修改阵容草稿，保存后生效，也可以关闭', () => {
    const game = createInitialGame(12)
    const draft = structuredClone(game.autoSubs ?? emptyAutoSubs())
    const getDraft = () => draft
    expect(applyAutoSubFieldChange(field('70'), getDraft)).toBe('lineup')
    expect(draft.preMatchStaminaBelow).toBe(70)
    expect(game.autoSubs?.preMatchStaminaBelow).not.toBe(70)
    expect(setLineup(game, structuredClone(game.lineup), draft).ok).toBe(true)
    expect(game.autoSubs?.preMatchStaminaBelow).toBe(70)
    expect(applyAutoSubFieldChange(field(''), getDraft)).toBe('lineup')
    expect(draft.preMatchStaminaBelow).toBeNull()
    expect(setLineup(game, structuredClone(game.lineup), draft).ok).toBe(true)
    expect(game.autoSubs?.preMatchStaminaBelow).toBeNull()
  })

  it('阵容页呈现说明、顶部保存和草稿未保存状态', async () => {
    const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage, location: { search: '', hash: '', origin: 'http://localhost' }, addEventListener() {}, matchMedia: () => ({ matches: false }) } })
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { dataset: {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} } })
    const { game, ui } = await import('../src/ui/state.ts')
    const { renderLineup } = await import('../src/ui/screens/lineup.ts')
    Object.assign(game, createInitialGame(12))
    ui.lineupDraft = structuredClone(game.lineup)
    ui.autoSubsDraft = structuredClone(game.autoSubs ?? emptyAutoSubs())
    applyAutoSubFieldChange(field('75'), () => ui.autoSubsDraft)
    const html = renderLineup()
    expect(select(html)).toContain('<option value="75" selected>75%</option>')
    for (const text of ['未保存', '保存阵容', '赛前 30 分钟', '预计开球体能', '健康、未停赛、位置熟练且体力达标', '不消耗场内换人次数', '不覆盖保存的阵容', '指定球员', '正式杯赛', '挑战赛满体能']) expect(html).toContain(text)
  })

  it('赛中隐藏并拒绝更改，锁定时禁用并拒绝更改', () => {
    const plan = { ...emptyAutoSubs(), preMatchStaminaBelow: 50 }
    expect(editor(plan, 'match')).not.toContain('preMatchStaminaBelow')
    expect(editor(plan, 'match')).not.toContain('赛前轮换')
    expect(select(editor(plan, 'lineup', true))).toMatch(/<select[^>]*disabled/)
    expect(applyAutoSubFieldChange(field('80', 'match'), () => plan)).toBeNull()
    expect(applyAutoSubFieldChange(field('80', 'lineup', true), () => plan)).toBeNull()
    expect(applyAutoSubFieldChange(field('100'), () => plan)).toBeNull()
    expect(plan.preMatchStaminaBelow).toBe(50)
  })
})
