import { describe, expect, it } from 'vitest'
import { FORMATIONS } from '../src/game/data/formations.ts'
import { createInitialGame } from '../src/game/state.ts'
import { autoAssignLineup, validateLineup, type AutoAssignContext, type AutoAssignMode } from '../src/game/squad.ts'
import type { Lineup, Player, Position } from '../src/game/types.ts'

const templates = createInitialGame(12).roster

function squad(mainStrength = 1, backupStrength = 0.5) {
  const formation = FORMATIONS['4-3-3']
  const roster: Player[] = []
  const lineup: Lineup = { formationId: formation.id, tactics: { ...formation.defaultTactics }, starters: [], bench: [] }
  for (const slot of formation.slots) {
    const template = templates.find((player) => (player.positions.GK > 0) === (slot.position === 'GK'))!
    for (const [kind, strength] of [['main', mainStrength], ['backup', backupStrength]] as const) {
      const player = structuredClone(template)
      player.id = player.seedId = `${slot.id}-${kind}`
      player.condition = 100
      for (const key of Object.keys(player.attrs) as (keyof Player['attrs'])[]) player.attrs[key] *= strength
      for (const position of Object.keys(player.positions) as Position[]) player.positions[position] = position === slot.position ? 100 : 0
      roster.push(player)
      if (kind === 'main') lineup.starters.push({ slotId: slot.id, playerId: player.id, role: slot.defaultRole })
    }
  }
  const context: AutoAssignContext = {
    condition: (player) => player.condition ?? 100,
    minutes: (player) => player.id.endsWith('-main') ? 900 : 0,
  }
  const assign = (mode: AutoAssignMode, previous = lineup, overrides: Partial<AutoAssignContext> = {}) =>
    autoAssignLineup(roster, formation.id, lineup.tactics, previous, mode, { ...context, ...overrides })
  return { roster, lineup, assign }
}

const ids = (lineup: Lineup) => lineup.starters.map((starter) => starter.playerId)
const st = (lineup: Lineup) => lineup.starters.find((starter) => starter.slotId === 'st')?.playerId

describe('自动填充轮换：伤病和体能优先', () => {
  it('全部轮换：满体力低 CA 主力优先于体力 30 的高 CA、低出场时间替补', () => {
    const { roster, lineup, assign } = squad(0.5, 1)
    for (const player of roster) if (player.id.endsWith('-backup')) player.condition = 30
    const result = assign('full')
    expect(new Set(ids(result))).toEqual(new Set(ids(lineup)))
    expect(validateLineup(roster, result).valid).toBe(true)
  })

  it('全部轮换：体力相同先看能力，不为均摊出场时间换掉更强的健康主力', () => {
    const { lineup, assign } = squad()
    expect(new Set(ids(assign('full')))).toEqual(new Set(ids(lineup)))
  })

  it('全部轮换：只有体能、CA 和职责适配都相同时，才参考出场分钟', () => {
    const { assign } = squad(1, 1)
    expect(ids(assign('full')).every((id) => id.endsWith('-backup'))).toBe(true)
  })

  it('部分轮换：基于当前阵容，不先把满体力低 CA 首发换成疲劳的高 CA 球员', () => {
    const { roster, lineup, assign } = squad(0.5, 1)
    for (const player of roster) if (player.id.endsWith('-backup')) player.condition = 40
    const saved = structuredClone(lineup)
    expect(ids(assign('half'))).toEqual(ids(lineup))
    expect(lineup).toEqual(saved)
  })

  it('部分轮换：选择体能 100 的替补，而不是 CA 更高但体能只有 80 的替补', () => {
    const { roster, assign } = squad(1, 0.3)
    const main = roster.find((player) => player.id === 'st-main')!
    main.condition = 20
    const stronger = structuredClone(main)
    stronger.id = stronger.seedId = 'stronger-st'
    stronger.condition = 80
    for (const key of Object.keys(stronger.attrs) as (keyof Player['attrs'])[]) stronger.attrs[key] *= 0.9
    roster.push(stronger)
    expect(st(assign('half'))).toBe('st-backup')
  })

  it('部分轮换：最累的几个人没有同位置替补时，继续检查后面的疲劳球员', () => {
    const { roster, assign } = squad()
    for (let i = roster.length - 1; i >= 0; i--) {
      if (roster[i].id.endsWith('-backup') && roster[i].id !== 'st-backup') roster.splice(i, 1)
    }
    for (const player of roster) if (player.id.endsWith('-main')) player.condition = 20
    const result = assign('half')
    expect(st(result)).toBe('st-backup')
    expect(ids(result).filter((id) => id.endsWith('-backup'))).toHaveLength(1)
  })

  it('部分轮换：有充足新鲜替补时最多轮换约一半，未轮换的槽位和职责保留', () => {
    const { roster, lineup, assign } = squad()
    for (const player of roster) if (player.id.endsWith('-main')) player.condition = 20
    lineup.customPositions = { st: { x: 0.8, y: 0.4 } }
    const saved = structuredClone(lineup)
    const result = assign('half')
    const changed = result.starters.filter((starter) => !ids(lineup).includes(starter.playerId))
    expect(changed).toHaveLength(Math.round(lineup.starters.length / 2))
    expect(result.customPositions).toEqual(lineup.customPositions)
    expect(lineup).toEqual(saved)
    expect(validateLineup(roster, result).valid).toBe(true)
  })

  it('部分轮换：必须更换的伤员不占体能轮换名额', () => {
    const { roster, lineup, assign } = squad()
    const injured = new Set(ids(lineup).slice(0, 7))
    for (const player of roster) if (player.id.endsWith('-main')) player.condition = 20
    const result = assign('half', lineup, { injured: (player) => injured.has(player.id) })
    expect(ids(result).every((id) => id.endsWith('-backup'))).toBe(true)
    expect(validateLineup(roster, result).valid).toBe(true)
  })

  it.each(['half', 'full'] as const)('%s：只有一名健康门将时，不为了体能让外场球员去守门', (mode) => {
    const { roster, assign } = squad()
    roster.find((player) => player.id === 'gk-main')!.condition = 20
    const result = assign(mode, undefined, { injured: (player) => player.id === 'gk-backup' })
    expect(result.starters.find((starter) => starter.slotId === 'gk')?.playerId).toBe('gk-main')
  })

  it.each(['best', 'half', 'full'] as const)('%s：伤员、停赛球员不进入首发或替补', (mode) => {
    const { roster, assign } = squad()
    const injured = new Set(['gk-main', 'st-main'])
    const suspended = new Set(['cml-main', 'lb-main'])
    const result = assign(mode, undefined, {
      injured: (player) => injured.has(player.id),
      suspended: (player) => suspended.has(player.id),
    })
    for (const id of [...ids(result), ...result.bench]) {
      expect(injured.has(id)).toBe(false)
      expect(suspended.has(id)).toBe(false)
    }
    expect(validateLineup(roster, result).valid).toBe(true)
  })

  it.each(['half', 'full'] as const)('%s：替补席也优先体力，不让疲劳高 CA 挤掉新鲜替补', (mode) => {
    const { roster, assign } = squad()
    for (const player of roster) if (player.id.endsWith('-backup')) player.condition = 70
    const tired = structuredClone(roster.find((player) => player.id === 'st-main')!)
    tired.id = tired.seedId = 'tired-star'
    tired.condition = 10
    roster.push(tired)
    const result = assign(mode)
    expect(result.bench).not.toContain(tired.id)
    expect(result.bench.every((id) => roster.find((player) => player.id === id)!.condition! >= 70)).toBe(true)
  })

  it('没人健康可用时宁可留空，不静默排入伤员', () => {
    const { assign } = squad()
    for (const mode of ['best', 'half', 'full'] as const) {
      const result = assign(mode, undefined, { injured: () => true })
      expect(result.starters).toHaveLength(0)
      expect(result.bench).toHaveLength(0)
    }
  })
})
