import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { autoTrainingConfig, defaultAutoPriority, autoTrainingRunnable, autoTrainingStep, runAutoTraining, setAutoTrainingConfig, startTraining } from '../src/game/actions.ts'
import { trainingOptions } from '../src/game/training-calendar.ts'
import type { AttrKey } from '../src/game/types.ts'
import { mainAttrsFor } from '../src/game/scale.ts'
import { keyAttrsOf, STYLE_KEY_ATTRS } from '../src/game/data/key-attrs.ts'
import { EVENTS } from '../src/game/data/events.ts'

function setup(seed = 1) {
  const game = createInitialGame(seed)
  const field = game.roster.find((player) => player.positions.GK <= 0)!
  const keeper = game.roster.find((player) => player.positions.GK > 0)!
  return { game, field, keeper }
}

describe('自动培养', () => {
  it('没有进行中的培养时自动开一轮，精力不足给出中文错误', () => {
    const { game, field } = setup(31)
    field.energy = 0
    const fail = autoTrainingStep(game, field.id)
    expect(fail.ok).toBe(false)
    expect(fail.error).toContain('精力不足')
    expect(game.training[field.id]).toBeUndefined()

    field.energy = 100
    const started = autoTrainingStep(game, field.id)
    expect(started.ok).toBe(true)
    expect(started.kind).toBe('start')
    const session = game.training[field.id]
    expect(session).toBeTruthy()
    expect(session.action).toBe(0)
  })

  it('默认配置补齐主属性优先级，且不修改存档里的原设置', () => {
    const { game, keeper } = setup(1)
    const config = autoTrainingConfig(game, keeper.id)
    expect(config.mode).toBe('priority')
    expect(config.enabled).toBe(true)
    for (const key of mainAttrsFor(true)) expect(config.priority).toContain(key)
    expect(game.trainingAuto).toBeUndefined()
  })

  it('自动培养策略和开关按球员各存一份，互不影响；没单独设置过的沿用旧的全局设置', () => {
    const { game, field, keeper } = setup(7)
    expect(autoTrainingConfig(game, field.id).autopilot).toBe(false)
    const first = field.id
    const second = game.roster.find((player) => player.positions.GK <= 0 && player.id !== first)!.id
    setAutoTrainingConfig(game, first, { mode: 'targets', autopilot: true, targets: { passing: 900 } })
    expect(autoTrainingConfig(game, first)).toMatchObject({ mode: 'targets', autopilot: true, targets: { passing: 900 } })
    // 另一名球员不受影响
    expect(autoTrainingConfig(game, second)).toMatchObject({ mode: 'priority', autopilot: false, targets: {} })
    // 门将的优先级补的是门将主属性
    setAutoTrainingConfig(game, keeper.id, { mode: 'priority' })
    expect(autoTrainingConfig(game, keeper.id).priority).toContain('reflexes')
    // 旧的全局设置仍是没单独设置过的球员的默认值，但开关只认球员自己的
    game.trainingAuto = { enabled: true, autopilot: true, mode: 'targets', priority: [...mainAttrsFor(false)], targets: { shooting: 800 } }
    const third = game.roster.find((player) => player.positions.GK <= 0 && player.id !== first && player.id !== second)!.id
    expect(autoTrainingConfig(game, third)).toMatchObject({ mode: 'targets', autopilot: false, targets: { shooting: 800 } })
  })

  it('“自动选择”模式每次都选当天加权总成长最多的项目（球员自己的 2 个主要属性权重 ×3），能跑完整轮（外场与门将）', () => {
    for (const useGk of [false, true]) {
      const { game, field, keeper } = setup(52)
      const player = useGk ? keeper : field
      setAutoTrainingConfig(game, player.id, { mode: 'max' })
      expect(autoTrainingConfig(game, player.id).mode).toBe('max')
      expect(startTraining(game, player.id).ok).toBe(true)
      const session = game.training[player.id]
      session.flags = EVENTS.map((event) => event.id)
      session.lastEventAction = Object.fromEntries(EVENTS.map((event) => [event.id, 1000]))
      session.eventCounts = Object.fromEntries(EVENTS.map((event) => [event.id, 1000]))
      session.action = 2 // 周二上午：有普通课程可选
      const keys: string[] = keyAttrsOf(player)
      const total = (gains: Record<string, number | undefined> | undefined) => Object.entries(gains ?? {}).reduce<number>((sum, [key, value]) => sum + (value ?? 0) * (keys.includes(key) ? 3 : 1), 0)
      const gainsOf = (item: ReturnType<typeof trainingOptions>[number]) => (useGk ? item.goalkeeperGains ?? item.gains : item.gains)
      const best = Math.max(...trainingOptions(session).map((item) => total(gainsOf(item))))
      const candidates = trainingOptions(session).filter((item) => total(gainsOf(item)) === best).map((item) => item.label)
      const step = autoTrainingStep(game, player.id)
      expect(step.ok, step.error).toBe(true)
      expect(candidates).toContain(step.label)
      // 并列时取当天先列出的那一项
      expect(step.label).toBe(candidates[0])
    }
    const { game, field } = setup(53)
    setAutoTrainingConfig(game, field.id, { mode: 'max' })
    const result = runAutoTraining(game, field.id)
    expect(result.ok, result.error).toBe(true)
    expect(result.completed).toBe(true)
  })

  it('自动培养开关每轮结束就自动关掉（默认总是不开），不影响别的球员', () => {
    const { game, field } = setup(54)
    const other = game.roster.find((player) => player.positions.GK <= 0 && player.id !== field.id)!
    setAutoTrainingConfig(game, field.id, { autopilot: true })
    setAutoTrainingConfig(game, other.id, { autopilot: true })
    expect(runAutoTraining(game, field.id).completed).toBe(true)
    expect(autoTrainingConfig(game, field.id).autopilot).toBe(false)
    expect(autoTrainingConfig(game, other.id).autopilot).toBe(true)
  })

  it('每个球员默认有 2 个主要属性（按风格），自动培养默认先练它们，不会把前锋练成传球手', () => {
    const { game } = setup(61)
    // 前锋风格各有不同：射术 + 速度 / 爆发 / 力量
    expect(STYLE_KEY_ATTRS.st_finisher).toEqual(['shooting', 'speed'])
    expect(STYLE_KEY_ATTRS.st_poacher).toEqual(['shooting', 'acceleration'])
    expect(STYLE_KEY_ATTRS.st_target).toEqual(['shooting', 'strength'])
    for (const player of game.roster) {
      const keys = keyAttrsOf(player)
      const mains = mainAttrsFor(player.positions.GK > 0)
      expect(keys[0]).not.toBe(keys[1])
      for (const key of keys) expect(mains, `${player.name}:${player.style}`).toContain(key)
      // 没设置过任何东西时，默认优先级把 2 个主要属性放在最前面，其余主属性接在后面且不缺
      const priority = autoTrainingConfig(game, player.id).priority
      expect(priority.slice(0, 2)).toEqual(keys)
      expect(new Set(priority)).toEqual(new Set(mains))
      expect(defaultAutoPriority(player)).toEqual(priority)
    }
    // 球员自己设置过优先级就按他的；旧的全局设置也仍然生效
    const field = game.roster.find((player) => player.positions.GK <= 0)!
    setAutoTrainingConfig(game, field.id, { priority: ['passing', ...mainAttrsFor(false).filter((key) => key !== 'passing')] })
    expect(autoTrainingConfig(game, field.id).priority[0]).toBe('passing')
  })

  it('默认策略跑一轮：主要属性的成长明显多于其余主属性（外场与自动选择模式都一样）', () => {
    for (const mode of ['priority', 'max'] as const) {
      let keyGain = 0
      let otherGain = 0
      let keyCount = 0
      let otherCount = 0
      for (let seed = 1; seed <= 12; seed++) {
        const { game } = setup(70 + seed)
        const player = game.roster.filter((item) => item.positions.GK <= 0)[seed % 8]
        setAutoTrainingConfig(game, player.id, { mode })
        expect(startTraining(game, player.id, seed).ok).toBe(true)
        const before = { ...game.training[player.id].candidate.attrs }
        expect(runAutoTraining(game, player.id).completed).toBe(true)
        const cand = game.candidates[player.id]
        const keys: string[] = keyAttrsOf(player)
        for (const key of mainAttrsFor(false)) {
          const gain = cand.attrs[key] - before[key]
          if (keys.includes(key)) { keyGain += gain; keyCount++ } else { otherGain += gain; otherCount++ }
        }
      }
      expect(keyGain / keyCount, mode).toBeGreaterThan((otherGain / otherCount) * 1.5)
    }
  })

  it('只有一轮没结束的培养才会被开关继续推进，不会自己开新一轮', () => {
    const { game, field } = setup(8)
    setAutoTrainingConfig(game, field.id, { autopilot: true })
    expect(autoTrainingRunnable(game, field.id)).toBe(false)
    expect(startTraining(game, field.id).ok).toBe(true)
    expect(autoTrainingRunnable(game, field.id)).toBe(true)
    expect(runAutoTraining(game, field.id).completed).toBe(true)
    expect(autoTrainingRunnable(game, field.id)).toBe(false)
  })

  it('能自动跑完一整轮（外场与门将），只选用当天日历提供的项目', () => {
    for (const useGk of [false, true]) {
      const { game, field, keeper } = setup(40)
      const player = useGk ? keeper : field
      game.trainingAuto = { enabled: true, mode: 'priority', priority: [...mainAttrsFor(useGk)], targets: {} }
      const result = runAutoTraining(game, player.id)
      expect(result.ok, result.error).toBe(true)
      expect(result.completed).toBe(true)
      expect(result.steps).toBeLessThanOrEqual(60)
      const session = game.training[player.id]
      expect(session.completed).toBe(true)
      expect(session.action).toBe(30)
      expect(game.candidates[player.id]).toBeTruthy()
      // 每一条行动记录都应该是当日候选项目或固定日项目。
      const actionTitles = session.log.filter((entry) => entry.kind === 'action')
      expect(actionTitles.length).toBe(30)
      expect(actionTitles[0].title.startsWith('交流赛')).toBe(true)
    }
  })

  it('低目标模式先补差距最大的主属性', () => {
    // seed 1 的周一下午同时提供扑救反应和手抛球／开大脚，便于比较差距。
    const { game, keeper } = setup(1)
    expect(startTraining(game, keeper.id, 3).ok).toBe(true)
    const session = game.training[keeper.id]
    session.action = 1
    const ids = trainingOptions(session).map((item) => item.id)
    expect(ids).toContain('gk_saves')
    expect(ids).toContain('gk_distribution')
    const attrs = session.candidate.attrs

    game.trainingAuto = {
      enabled: true,
      mode: 'targets',
      priority: [...mainAttrsFor(true)],
      targets: { passing: attrs.passing + 300, reflexes: attrs.reflexes + 20 },
    }
    expect(autoTrainingStep(game, keeper.id).ok).toBe(true)
    expect((session.log.at(-1)?.gains ?? {}).passing ?? 0).toBeGreaterThan(0)

    const second = setup(1)
    expect(startTraining(second.game, second.keeper.id, 3).ok).toBe(true)
    const other = second.game.training[second.keeper.id]
    other.action = 1
    const otherAttrs = other.candidate.attrs
    second.game.trainingAuto = {
      enabled: true,
      mode: 'targets',
      priority: [...mainAttrsFor(true)],
      targets: { passing: otherAttrs.passing + 20, reflexes: otherAttrs.reflexes + 300 },
    }
    expect(autoTrainingStep(second.game, second.keeper.id).ok).toBe(true)
    expect((other.log.at(-1)?.gains ?? {}).reflexes ?? 0).toBeGreaterThan(0)
  })

  it('属性优先模式按优先级顺序练，练满个人上限就换下一个', () => {
    const { game, keeper } = setup(1)
    expect(startTraining(game, keeper.id, 5).ok).toBe(true)
    const session = game.training[keeper.id]
    session.action = 1
    const ceilings = session.candidate.ceilings
    const attrs = session.candidate.attrs
    // 让传球和反应都有成长空间，再交换优先级。
    attrs.passing = Math.min(attrs.passing, ceilings.passing - 60)
    attrs.reflexes = Math.min(attrs.reflexes, ceilings.reflexes - 60)

    game.trainingAuto = { enabled: true, mode: 'priority', priority: ['passing', 'reflexes', 'handling', 'rushing', 'oneOnOne', 'composure'], targets: {} }
    expect(autoTrainingStep(game, keeper.id).ok).toBe(true)
    expect((session.log.at(-1)?.gains ?? {}).passing ?? 0).toBeGreaterThan(0)

    const second = setup(1)
    expect(startTraining(second.game, second.keeper.id, 5).ok).toBe(true)
    const other = second.game.training[second.keeper.id]
    other.action = 1
    const otherCeilings = other.candidate.ceilings
    other.candidate.attrs.passing = Math.min(other.candidate.attrs.passing, otherCeilings.passing - 60)
    other.candidate.attrs.reflexes = Math.min(other.candidate.attrs.reflexes, otherCeilings.reflexes - 60)
    second.game.trainingAuto = { enabled: true, mode: 'priority', priority: ['reflexes', 'passing', 'handling', 'rushing', 'oneOnOne', 'composure'], targets: {} }
    expect(autoTrainingStep(second.game, second.keeper.id).ok).toBe(true)
    expect((other.log.at(-1)?.gains ?? {}).reflexes ?? 0).toBeGreaterThan(0)
  })

  it('体力不足时先休息', () => {
    const { game, keeper } = setup(1)
    expect(startTraining(game, keeper.id, 6).ok).toBe(true)
    const session = game.training[keeper.id]
    session.action = 1
    session.fatigue = 95
    game.trainingAuto = { enabled: true, mode: 'priority', priority: [...mainAttrsFor(true)], targets: {} }
    const step = autoTrainingStep(game, keeper.id)
    expect(step.ok).toBe(true)
    expect(step.kind).toBe('action')
    expect(step.label).toContain('恢复')
    expect(session.fatigue).toBeLessThan(95)
  })

  it('有事件时自动选对目标属性收益最大的选项，没有收益就选第一个', () => {
    const { game, keeper } = setup(1)
    expect(startTraining(game, keeper.id, 8).ok).toBe(true)
    const session = game.training[keeper.id]
    session.pendingEventId = 'main_intake'
    session.pendingEventAction = session.action
    game.trainingAuto = { enabled: true, mode: 'priority', priority: ['passing', 'reflexes', 'handling', 'rushing', 'oneOnOne', 'composure'], targets: {} }
    const step = autoTrainingStep(game, keeper.id)
    expect(step.ok, step.error).toBe(true)
    expect(step.kind).toBe('event')
    expect(session.pendingEventId).toBeNull()
    expect(session.log.at(-1)?.title).toContain('展示传球与触球')

    // 所有属性都到上限时没有任何收益，退回第一个选项。
    const second = setup(1)
    expect(startTraining(second.game, second.keeper.id, 9).ok).toBe(true)
    const maxed = second.game.training[second.keeper.id]
    for (const key of Object.keys(maxed.candidate.attrs) as AttrKey[]) maxed.candidate.attrs[key] = maxed.candidate.ceilings[key]
    maxed.pendingEventId = 'main_intake'
    maxed.pendingEventAction = maxed.action
    second.game.trainingAuto = { enabled: true, mode: 'priority', priority: [...mainAttrsFor(true)], targets: {} }
    expect(autoTrainingStep(second.game, second.keeper.id).ok).toBe(true)
    expect(maxed.log.at(-1)?.title).toContain('展示传球与触球')
  })

  it('属性都达标时安排休息或导师，不会卡住不推进', () => {
    const { game, keeper } = setup(1)
    expect(startTraining(game, keeper.id, 11).ok).toBe(true)
    const session = game.training[keeper.id]
    for (const key of Object.keys(session.candidate.attrs) as AttrKey[]) session.candidate.attrs[key] = session.candidate.ceilings[key]
    // 体力吃紧时自动选择休息（不会触发事件），每次行动都推进一个时段。
    session.fatigue = 90
    game.trainingAuto = { enabled: true, mode: 'targets', priority: [...mainAttrsFor(true)], targets: {} }
    const before = session.action
    for (let i = 0; i < 5; i++) {
      const step = autoTrainingStep(game, keeper.id)
      expect(step.ok, step.error).toBe(true)
      expect(step.completed).toBe(false)
      expect(['action', 'event']).toContain(step.kind)
    }
    // 每步都在推进：休息/导师算一次行动，夹在中间的事件也只会多走一步。
    expect(session.action).toBeGreaterThanOrEqual(before + 3)
  })
})
