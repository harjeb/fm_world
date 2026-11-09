import { describe, expect, it } from 'vitest'
import type { Lineup } from '../src/game/types.ts'
import {
  applyTacticPreset,
  autoFillLineup,
  clearSlotPositions,
  deleteTacticPreset,
  findTacticPreset,
  presetNameError,
  renameTacticPreset,
  saveTacticPreset,
  setSlotPosition,
  slotPosition,
  validateLineup,
} from '../src/game/squad.ts'
import { FORMATIONS } from '../src/game/data/formations.ts'
import { buildMatchTeam } from '../src/game/match/team.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { makeTeams } from './helpers.ts'

const identity = { id: 'player', name: '测试队', color: '#34d399', accent: '#052e1b' }

/** 直接建队（不走 setup），验证 buildMatchTeam 会不会用自定义位置。 */
function homeTeam(roster: ReturnType<typeof makeTeams>['roster'], lineup: Lineup) {
  // teamInputFromLineup 会先校验阵容，自定义位置就是在这个过程中被记住的。
  return buildMatchTeam(teamInputFromLineup(roster, lineup, identity), 'home')
}

describe('战术板自由摆位', () => {
  it('自定义位置会写进 customPositions，并按槽位读回来', () => {
    const { lineup } = makeTeams(200, '4-3-3')
    expect(slotPosition(lineup, FORMATIONS[lineup.formationId].slots[0])).toEqual({ x: FORMATIONS[lineup.formationId].slots[0].x, y: FORMATIONS[lineup.formationId].slots[0].y })
    expect(setSlotPosition(lineup, 'st', { x: 0.61, y: 0.12 })).toBe(true)
    expect(lineup.customPositions).toEqual({ st: { x: 0.61, y: 0.12 } })
    const slot = FORMATIONS[lineup.formationId].slots.find((item) => item.id === 'st')!
    expect(slotPosition(lineup, slot)).toEqual({ x: 0.61, y: 0.12 })
    // 没摆过的位置继续用阵型默认坐标。
    const cb = FORMATIONS[lineup.formationId].slots.find((item) => item.id === 'cbl')!
    expect(slotPosition(lineup, cb)).toEqual({ x: cb.x, y: cb.y })
  })

  it('摆回阵型默认坐标时不再算自定义位置', () => {
    const { lineup } = makeTeams(200, '4-3-3')
    const slot = FORMATIONS[lineup.formationId].slots.find((item) => item.id === 'cbr')!
    setSlotPosition(lineup, 'cbr', { x: slot.x, y: slot.y })
    expect(lineup.customPositions).toBeUndefined()
    setSlotPosition(lineup, 'cbr', { x: 0.5, y: 0.5 })
    setSlotPosition(lineup, 'cbr', { x: slot.x, y: slot.y })
    expect(lineup.customPositions).toBeUndefined()
  })

  it('不在当前阵型里的槽位会被忽略', () => {
    const { lineup } = makeTeams(200, '4-3-3')
    expect(setSlotPosition(lineup, 'nope', { x: 0.5, y: 0.5 })).toBe(false)
    expect(lineup.customPositions).toBeUndefined()
  })

  it('还原默认位置会清掉整张表', () => {
    const { lineup } = makeTeams(200, '4-3-3')
    setSlotPosition(lineup, 'st', { x: 0.5, y: 0.5 })
    expect(clearSlotPositions(lineup)).toBe(true)
    expect(lineup.customPositions).toBeUndefined()
    expect(clearSlotPositions(lineup)).toBe(false)
  })

  it('建队时优先用自定义位置，没摆过的位置仍用阵型默认坐标', () => {
    const { roster, lineup } = makeTeams(200, '4-3-3')
    setSlotPosition(lineup, 'st', { x: 0.6, y: 0.1 })
    const slot = FORMATIONS[lineup.formationId].slots.find((item) => item.id === 'st')!
    const cb = FORMATIONS[lineup.formationId].slots.find((item) => item.id === 'cbl')!
    const stId = lineup.starters.find((starter) => starter.slotId === 'st')!.playerId
    const cbId = lineup.starters.find((starter) => starter.slotId === 'cbl')!.playerId
    const team = homeTeam(roster, lineup)
    const st = team.players.find((player) => player.sourceId === stId)!
    const cbPlayer = team.players.find((player) => player.sourceId === cbId)!
    expect(st.x).toBeCloseTo(8 + 0.6 * 42, 5)
    expect(st.y).toBeCloseTo(0.1 * 64, 5)
    expect(cbPlayer.x).toBeCloseTo(8 + cb.x * 42, 5)
    expect(cbPlayer.y).toBeCloseTo(cb.y * 64, 5)
  })

  it('客队会镜像同一套自定义位置', () => {
    const { roster, lineup } = makeTeams(200, '4-3-3')
    setSlotPosition(lineup, 'st', { x: 0.6, y: 0.1 })
    const stId = lineup.starters.find((starter) => starter.slotId === 'st')!.playerId
    const away = buildMatchTeam(teamInputFromLineup(roster, lineup, identity), 'away')
    const st = away.players.find((player) => player.sourceId === stId)!
    expect(st.x).toBeCloseTo(100 - (8 + 0.6 * 42), 5)
    expect(st.y).toBeCloseTo(64 - 0.1 * 64, 5)
  })

  it('没有自定义位置时和阵型默认完全一致（向后兼容）', () => {
    const { roster, lineup } = makeTeams(200, '4-3-3')
    const slot = FORMATIONS[lineup.formationId].slots.find((item) => item.id === 'cm')!
    const id = lineup.starters.find((starter) => starter.slotId === 'cm')!.playerId
    const team = homeTeam(roster, lineup)
    const player = team.players.find((item) => item.sourceId === id)!
    expect(player.x).toBeCloseTo(8 + slot.x * 42, 5)
    expect(player.y).toBeCloseTo(slot.y * 64, 5)
  })
})

describe('战术预设', () => {
  it('保存当前配置：名称去首尾空格，快照含阵型/首发/替补/战术/自定义位置', () => {
    const { lineup } = makeTeams(200, '4-3-3')
    setSlotPosition(lineup, 'st', { x: 0.55, y: 0.4 })
    lineup.tactics = { ...lineup.tactics, press: 'high' }
    const result = saveTacticPreset(lineup, '  高位压迫  ', 1_700_000_000_000)
    expect(result.ok).toBe(true)
    expect(result.preset?.name).toBe('高位压迫')
    expect(result.preset?.lineup.formationId).toBe(lineup.formationId)
    expect(result.preset?.lineup.starters).toEqual(lineup.starters)
    expect(result.preset?.lineup.bench).toEqual(lineup.bench)
    expect(result.preset?.lineup.tactics.press).toBe('high')
    expect(result.preset?.lineup.customPositions).toEqual({ st: { x: 0.55, y: 0.4 } })
    // 预设里不再嵌一层预设。
    expect((result.preset?.lineup as Lineup).presets).toBeUndefined()
    expect(lineup.presets).toHaveLength(1)
  })

  it('名称不能为空，同一存档内不能重名（忽略首尾空格与大小写）', () => {
    const { lineup } = makeTeams(200, '4-3-3')
    expect(saveTacticPreset(lineup, '   ')).toMatchObject({ ok: false })
    expect(saveTacticPreset(lineup, '  ').error).toContain('不能为空')
    expect(saveTacticPreset(lineup, 'Attack').ok).toBe(true)
    expect(saveTacticPreset(lineup, ' attacks ').ok).toBe(true)
    expect(saveTacticPreset(lineup, 'attack').ok).toBe(false)
    expect(saveTacticPreset(lineup, '  ATTACK ').error).toContain('已经有叫“Attack”的战术')
    expect(presetNameError(lineup, '')).toContain('不能为空')
    expect(lineup.presets).toHaveLength(2)
  })

  it('重命名：自己不算重名，但不能撞上别人', () => {
    const { lineup } = makeTeams(200, '4-3-3')
    const a = saveTacticPreset(lineup, 'A', 1).preset!
    const b = saveTacticPreset(lineup, 'B', 2).preset!
    // 改回自己原来的名字不算重名。
    expect(renameTacticPreset(lineup, a.id, ' A ').ok).toBe(true)
    expect(renameTacticPreset(lineup, a.id, 'b').ok).toBe(false)
    expect(renameTacticPreset(lineup, a.id, 'b').error).toContain('已经有叫“B”的战术')
    expect(renameTacticPreset(lineup, a.id, '   ').ok).toBe(false)
    expect(renameTacticPreset(lineup, 'ghost', 'C').ok).toBe(false)
    expect(findTacticPreset(lineup, a.id)?.name).toBe('A')
    expect(findTacticPreset(lineup, b.id)?.name).toBe('B')
  })

  it('应用预设会换掉整套配置，但保留预设列表', () => {
    const { lineup } = makeTeams(200, '4-3-3')
    setSlotPosition(lineup, 'st', { x: 0.5, y: 0.2 })
    lineup.tactics = { ...lineup.tactics, tempo: 'fast' }
    const preset = saveTacticPreset(lineup, '快节奏', 10).preset!
    // 改回默认，再应用预设。
    clearSlotPositions(lineup)
    lineup.tactics = { ...lineup.tactics, tempo: 'slow' }
    const restored = applyTacticPreset(lineup, preset.id)!
    expect(restored.tactics.tempo).toBe('fast')
    expect(restored.customPositions).toEqual({ st: { x: 0.5, y: 0.2 } })
    expect(restored.presets).toEqual(lineup.presets)
    expect(applyTacticPreset(lineup, 'ghost')).toBeNull()
  })

  it('换成另一个阵型的预设也是合法阵容', () => {
    const { roster, lineup } = makeTeams(200, '4-3-3')
    const other = autoFillLineup(roster, '4-4-2', lineup.tactics)
    const preset = saveTacticPreset(other, '双前锋', 20).preset!
    lineup.presets = [preset]
    const restored = applyTacticPreset(lineup, preset.id)!
    expect(restored.formationId).toBe('4-4-2')
    expect(validateLineup(roster, restored).valid).toBe(true)
  })

  it('删除预设', () => {
    const { lineup } = makeTeams(200, '4-3-3')
    const preset = saveTacticPreset(lineup, '要删的', 30).preset!
    expect(deleteTacticPreset(lineup, preset.id)).toBe(true)
    expect(lineup.presets).toEqual([])
    expect(deleteTacticPreset(lineup, preset.id)).toBe(false)
  })

  it('自动填充：同阵型保留自定义位置和预设；换阵型只保留预设', () => {
    const { roster, lineup } = makeTeams(200, '4-3-3')
    setSlotPosition(lineup, 'st', { x: 0.5, y: 0.2 })
    saveTacticPreset(lineup, '保留我', 40)
    const sameFormation = autoFillLineup(roster, lineup.formationId, lineup.tactics, lineup)
    expect(sameFormation.customPositions).toEqual({ st: { x: 0.5, y: 0.2 } })
    expect(sameFormation.presets).toHaveLength(1)
    const changed = autoFillLineup(roster, '3-5-2', lineup.tactics, lineup)
    expect(changed.customPositions).toBeUndefined()
    expect(changed.presets).toHaveLength(1)
    // 不带旧阵容时行为和老代码一致。
    const bare = autoFillLineup(roster, lineup.formationId, lineup.tactics)
    expect(bare.customPositions).toBeUndefined()
    expect(bare.presets).toBeUndefined()
  })

  it('直接调 autoFillLineup（不传旧阵容）时，同一支球队的预设也不会丢', () => {
    const { roster, lineup } = makeTeams(200, '4-3-3')
    saveTacticPreset(lineup, '换赛季也别丢', 50)
    setSlotPosition(lineup, 'st', { x: 0.5, y: 0.2 })
    // 比赛建队、保存阵容都会先校验，校验时会记住这套配置。
    validateLineup(roster, lineup)
    const reset = autoFillLineup(roster, lineup.formationId, lineup.tactics)
    expect(reset.presets?.map((preset) => preset.name)).toEqual(['换赛季也别丢'])
    expect(reset.customPositions).toEqual({ st: { x: 0.5, y: 0.2 } })
    // 别的球队（全新球员对象）不会拿到这份配置。
    const otherSquad = makeTeams(18, '4-3-3')
    const otherReset = autoFillLineup(otherSquad.roster, otherSquad.lineup.formationId)
    expect(otherReset.presets).toBeUndefined()
    expect(otherReset.customPositions).toBeUndefined()
  })

  it('旧存档没有这两个字段也能照常校验和建队', () => {
    const { roster, lineup } = makeTeams(200, '4-3-3')
    const legacy: Lineup = { formationId: lineup.formationId, starters: lineup.starters, bench: lineup.bench, tactics: lineup.tactics }
    expect(validateLineup(roster, legacy).valid).toBe(true)
    expect(buildMatchTeam(teamInputFromLineup(roster, legacy, identity), 'home').players).toHaveLength(11)
  })
})
