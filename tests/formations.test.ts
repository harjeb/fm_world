import { describe, expect, it } from 'vitest'
import { FORMATIONS, FORMATION_LIST } from '../src/game/data/formations.ts'
import { ROLES, rolesForSlot } from '../src/game/data/roles.ts'
import { autoFillLineup, MIN_SQUAD, FULL_SQUAD, STARTERS, validateLineup } from '../src/game/squad.ts'
import { formationRows } from '../src/game/pes/formation.ts'
import { PesGame } from '../src/game/pes/game.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { createWorldGame } from '../src/game/world.ts'
import { releasePlayer } from '../src/game/market.ts'

const ELEVEN = ['4-4-2', '4-3-3', '4-2-3-1', '3-5-2', '5-3-2', '4-1-4-1', '3-4-3', '4-1-2-1-2']

describe('11 人制阵型', () => {
  it('可选 8 种阵型；旧的 7 人制阵型不在可选列表里', () => {
    expect(FORMATION_LIST.map((formation) => formation.id)).toEqual(ELEVEN)
    expect(FORMATION_LIST.some((formation) => formation.legacy)).toBe(false)
  })

  it('每个阵型 11 个位置、1 名门将、槽位不重复，默认职责和位置对得上，站位在球场范围内', () => {
    for (const formation of FORMATION_LIST) {
      expect(formation.slots, formation.id).toHaveLength(STARTERS)
      expect(new Set(formation.slots.map((slot) => slot.id)).size, formation.id).toBe(STARTERS)
      expect(formation.slots.filter((slot) => slot.position === 'GK'), formation.id).toHaveLength(1)
      for (const slot of formation.slots) {
        expect(ROLES[slot.defaultRole].position, `${formation.id} ${slot.id}`).toBe(slot.position)
        expect(slot.x).toBeGreaterThanOrEqual(0)
        expect(slot.x).toBeLessThanOrEqual(0.8)
        expect(slot.y).toBeGreaterThanOrEqual(0)
        expect(slot.y).toBeLessThanOrEqual(1)
      }
      // 阵型名就是各条线的人数（不含门将）
      expect(formation.id.split('-').map(Number).reduce((sum, count) => sum + count, 0), formation.id).toBe(10)
    }
  })

  it('自动排阵每个阵型都能排出合法阵容，边后卫只排防守型职责', () => {
    const game = createWorldGame(808)
    for (const formation of FORMATION_LIST) {
      const lineup = autoFillLineup(game.roster, formation.id, formation.defaultTactics)
      expect(validateLineup(game.roster, lineup).valid, formation.id).toBe(true)
      for (const starter of lineup.starters) {
        const slot = FORMATIONS[formation.id].slots.find((item) => item.id === starter.slotId)!
        expect(rolesForSlot(slot), `${formation.id} ${slot.id}`).toContain(starter.role)
      }
    }
  })

  it('比赛引擎按站位深浅给线位：边后卫按后卫跑，前腰比中场靠前', () => {
    for (const formation of FORMATION_LIST) {
      const rows = formationRows(formation.id)
      expect(rows).toHaveLength(STARTERS)
      for (const row of rows) {
        if (row.position === 'W' && row.nx < 0.35) expect(row.line, `${formation.id} ${row.slotId}`).toBeLessThan(0.3)
      }
    }
    const diamond = formationRows('4-1-2-1-2')
    const line = (slotId: string) => diamond.find((row) => row.slotId === slotId)!.line
    expect(line('am')).toBeGreaterThan(line('cml'))
    expect(line('cml')).toBeGreaterThan(line('dm'))
  })

  it('每个阵型都能在两套引擎里完整踢完一场', () => {
    const game = createWorldGame(909)
    for (const [index, formation] of FORMATION_LIST.entries()) {
      const other = FORMATION_LIST[(index + 1) % FORMATION_LIST.length]
      const home = teamInputFromLineup(game.roster, autoFillLineup(game.roster, formation.id, formation.defaultTactics), { id: 'h', name: 'H', color: '#fff', accent: '#000' })
      const away = teamInputFromLineup(game.roster, autoFillLineup(game.roster, other.id, other.defaultTactics), { id: 'a', name: 'A', color: '#000', accent: '#fff' })
      const legacy = new MatchEngine({ seed: index + 1, home, away, knockout: false, recordPlayback: false, rulesVersion: 2 }).simulate()
      expect(legacy.finished, formation.id).toBe(true)
      expect(legacy.teams[0].players).toHaveLength(STARTERS)
      const pes = new PesGame({ seed: index + 1, home: structuredClone(home), away: structuredClone(away), durationSeconds: 240 }).run()
      expect(pes.finished, formation.id).toBe(true)
      expect(pes.teams[0].players.filter((player) => player.onPitch).length + pes.teams[0].players.filter((player) => player.sentOff).length).toBe(STARTERS)
    }
  }, 300_000)
})

describe('阵容人数', () => {
  it('卖人或解约后至少要留一套完整的比赛名单（18 人）', () => {
    expect(MIN_SQUAD).toBe(18)
    expect(MIN_SQUAD).toBe(FULL_SQUAD)
    const game = createWorldGame(1010)
    while (game.roster.length > MIN_SQUAD) {
      const target = game.roster.find((player) => !game.lineup.starters.some((starter) => starter.playerId === player.id)) ?? game.roster.at(-1)!
      expect(releasePlayer(game, target.id).ok).toBe(true)
    }
    expect(game.roster).toHaveLength(MIN_SQUAD)
    expect(releasePlayer(game, game.roster.at(-1)!.id)).toMatchObject({ ok: false, error: '阵容必须保留至少 18 人' })
  })
})
