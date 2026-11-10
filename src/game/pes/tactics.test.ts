import { describe, expect, it } from 'vitest'
import { PesGame } from './game.ts'
import { baselineTeams } from './baseline.ts'
import {
  DEFAULT_PARAMS,
  INSTRUCTION_DIFFICULTY,
  NEUTRAL_INSTRUCTIONS,
  STYLE_LIST,
  cloneInstructions,
  execution,
  sameInstructions,
  slipChance,
  triOf,
  validateInstructions,
} from './tactics.ts'

const fixture = () => {
  const { home, away } = baselineTeams(1)
  for (const team of [home, away]) {
    delete team.autoSubs
    delete team.chemistry
    for (const starter of team.starters) starter.player.condition = 100
    for (const player of team.bench) player.condition = 100
  }
  return { home, away }
}

describe('首版九项战术指令', () => {
  it('每个风格模板都通过校验，且「空白」等于中性值', () => {
    for (const style of STYLE_LIST) expect(() => validateInstructions(style.instructions)).not.toThrow()
    expect(sameInstructions(STYLE_LIST.find((s) => s.id === 'blank')!.instructions, NEUTRAL_INSTRUCTIONS)).toBe(true)
  })

  it('拒绝未知字段、未知枚举、null 和缺失分组', () => {
    const broken = cloneInstructions(NEUTRAL_INSTRUCTIONS) as unknown as Record<string, Record<string, unknown>>
    broken.possession.passing = 'long'
    expect(() => validateInstructions(broken)).toThrow(/possession\.passing/)

    const unknown = cloneInstructions(NEUTRAL_INSTRUCTIONS) as unknown as Record<string, Record<string, unknown>>
    unknown.defense.press = 'high'
    expect(() => validateInstructions(unknown)).toThrow(/未知战术指令 defense\.press/)

    const missing = { possession: NEUTRAL_INSTRUCTIONS.possession, transition: NEUTRAL_INSTRUCTIONS.transition }
    expect(() => validateInstructions(missing)).toThrow(/defense/)

    const nulled = cloneInstructions(NEUTRAL_INSTRUCTIONS) as unknown as Record<string, Record<string, unknown>>
    nulled.transition.onLoss = null
    expect(() => validateInstructions(nulled)).toThrow(/transition\.onLoss/)
  })

  it('复制模板不会共享引用：改一份不会影响风格列表', () => {
    const style = STYLE_LIST.find((s) => s.id === 'highPress')!
    const copy = cloneInstructions(style.instructions)
    copy.defense.intensity = 'low'
    expect(style.instructions.defense.intensity).toBe('high')
  })

  it('三档枚举 → −1 / 0 / +1；方向与宽度是不同字段', () => {
    expect([triOf('middle'), triOf('balanced'), triOf('wing')]).toEqual([-1, 0, 1])
    expect([triOf('narrow'), triOf('normal'), triOf('wide')]).toEqual([-1, 0, 1])
    expect([triOf('short'), triOf('mixed'), triOf('direct')]).toEqual([-1, 0, 1])
    expect([triOf('hold'), triOf('balanced'), triOf('counter')]).toEqual([-1, 0, 1])
    expect([triOf('regroup'), triOf('balanced'), triOf('counterpress')]).toEqual([-1, 0, 1])
  })

  it('熟练度越高执行越强、失误越少；难度越高门槛越高', () => {
    expect(execution(0)).toBeCloseTo(DEFAULT_PARAMS.familiarityFloor, 6)
    expect(execution(1)).toBeCloseTo(1, 6)
    expect(execution(0.5)).toBeGreaterThan(execution(0.3))
    expect(slipChance(0, 1)).toBeCloseTo(DEFAULT_PARAMS.familiaritySlip, 6)
    expect(slipChance(1, 1)).toBe(0)
    expect(slipChance(0.5, INSTRUCTION_DIFFICULTY.onLoss)).toBeGreaterThan(slipChance(0.5, INSTRUCTION_DIFFICULTY.passing))
  })
})

describe('新指令接进比赛', () => {
  const play = (seed: number, patch: (team: ReturnType<typeof fixture>['home']) => void) => {
    const base = fixture()
    const home = structuredClone(base.home)
    const away = structuredClone(base.away)
    home.instructions = cloneInstructions(NEUTRAL_INSTRUCTIONS)
    away.instructions = cloneInstructions(NEUTRAL_INSTRUCTIONS)
    patch(home)
    const game = new PesGame({ seed, home, away, durationSeconds: 120, offside: true, noInjuries: true, now: 0, metrics: true })
    game.run()
    return game
  }

  it('同种子同指令逐位可复现，风格 ID 不参与模拟', () => {
    const a = play(7, () => {})
    const b = play(7, () => {})
    expect(a.serialize()).toEqual(b.serialize())
    expect(a.match.metrics!.teams[0].passDistance.length).toBeGreaterThan(0)
  })

  it('指令确实影响行为（短传 → 更短的平均传球），且不改旧 v4 路径', () => {
    const short = play(11, (home) => { home.instructions!.possession.passing = 'short' })
    const direct = play(11, (home) => { home.instructions!.possession.passing = 'direct' })
    const mean = (values: number[]) => values.reduce((x, y) => x + y, 0) / Math.max(1, values.length)
    expect(mean(short.match.metrics!.teams[0].passDistance)).toBeLessThan(mean(direct.match.metrics!.teams[0].passDistance))

    // 没有 instructions 的球队继续走旧五字段：序列化里不出现新字段。
    const base = fixture()
    const old = new PesGame({ seed: 3, home: base.home, away: base.away, durationSeconds: 60, offside: true, noInjuries: true, now: 0 })
    old.run()
    expect(old.match.teams[0].tactics.instructions).toBeUndefined()
    expect(old.match.serialize().teams[0].gainAt).toBeUndefined()
  })

  it('熟练度会削弱指令效果：零熟练度的平均传球距离比满熟练度更接近中性', () => {
    const mean = (values: number[]) => values.reduce((x, y) => x + y, 0) / Math.max(1, values.length)
    const skilled = play(5, (home) => { home.instructions!.possession.passing = 'direct'; home.familiarity = 1 })
    const raw = play(5, (home) => { home.instructions!.possession.passing = 'direct'; home.familiarity = 0 })
    expect(mean(skilled.match.metrics!.teams[0].passDistance)).toBeGreaterThan(mean(raw.match.metrics!.teams[0].passDistance))
  })
})
