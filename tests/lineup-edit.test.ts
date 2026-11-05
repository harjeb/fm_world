import { describe, expect, it } from 'vitest'
import type { Lineup, Player, Position } from '../src/game/types.ts'
import { BENCH_SIZE, assignBench, assignStarter, autoFillLineup, clearBench, clearStarter, movePlayer, validateLineup } from '../src/game/squad.ts'
import { createInitialGame } from '../src/game/state.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'

function player(id: string, positions: Partial<Record<Position, number>>): Player {
  return { id, positions: { GK: 0, CB: 0, W: 0, CM: 0, ST: 0, ...positions } } as Player
}

/** 1-2-2-2：门将、两中卫、两中场、两前锋。 */
function setup(): { roster: Player[]; lineup: Lineup } {
  const roster = [
    player('gk', { GK: 90 }),
    player('cb1', { CB: 90 }),
    player('cb2', { CB: 90 }),
    player('cm1', { CM: 90 }),
    player('cm2', { CM: 90 }),
    player('st1', { ST: 90 }),
    player('st2', { ST: 90, CB: 40 }),
    player('sub-cb', { CB: 80 }),
    player('sub-st', { ST: 80 }),
    player('spare', { CB: 70, ST: 70 }),
  ]
  const lineup: Lineup = {
    formationId: '1-2-2-2',
    starters: [
      { slotId: 'gk', playerId: 'gk', role: 'gk_line' },
      { slotId: 'cbl', playerId: 'cb1', role: 'cb_stopper' },
      { slotId: 'cbr', playerId: 'cb2', role: 'cb_cover' },
      { slotId: 'cml', playerId: 'cm1', role: 'cm_organizer' },
      { slotId: 'cmr', playerId: 'cm2', role: 'cm_destroyer' },
      { slotId: 'stl', playerId: 'st1', role: 'st_runner' },
      { slotId: 'str', playerId: 'st2', role: 'st_target' },
    ],
    bench: ['sub-cb', 'sub-st'],
    tactics: { attack: 'balanced', passing: 'mixed', tempo: 'normal', line: 'mid', press: 'mid' },
  }
  return { roster, lineup }
}

const at = (lineup: Lineup, slotId: string) => lineup.starters.find((item) => item.slotId === slotId)?.playerId

describe('assignStarter', () => {
  it('puts a free player in the slot and keeps the role', () => {
    const { roster, lineup } = setup()
    assignStarter(lineup, 'cbl', 'spare')
    expect(at(lineup, 'cbl')).toBe('spare')
    expect(lineup.starters.find((item) => item.slotId === 'cbl')?.role).toBe('cb_stopper')
    expect(lineup.starters).toHaveLength(7)
  })

  it('swaps two starters when both can play each other’s position', () => {
    const { roster, lineup } = setup()
    assignStarter(lineup, 'cbl', 'cb2')
    expect(at(lineup, 'cbl')).toBe('cb2')
    expect(at(lineup, 'cbr')).toBe('cb1')
    expect(lineup.starters).toHaveLength(7)
  })

  it('swaps two starters even when the displaced player has not learned the position', () => {
    const { lineup } = setup()
    // cb1 没学过前锋，也照样换过去，由位置折损体现代价。
    assignStarter(lineup, 'cbl', 'st2')
    expect(at(lineup, 'cbl')).toBe('st2')
    expect(at(lineup, 'str')).toBe('cb1')
    expect(lineup.starters).toHaveLength(7)
  })

  it('swaps with the bench without leaving a hole', () => {
    const { roster, lineup } = setup()
    assignStarter(lineup, 'cbl', 'sub-cb')
    expect(at(lineup, 'cbl')).toBe('sub-cb')
    expect(lineup.bench).toEqual(['cb1', 'sub-st'])
  })

  it('fills an empty slot from the bench and shrinks the bench', () => {
    const { roster, lineup } = setup()
    clearStarter(lineup, 'cbl')
    assignStarter(lineup, 'cbl', 'sub-cb')
    expect(at(lineup, 'cbl')).toBe('sub-cb')
    expect(lineup.starters.find((item) => item.slotId === 'cbl')?.role).toBe('cb_stopper')
    expect(lineup.bench).toEqual(['sub-st'])
  })

  it('does nothing for the current occupant or an unknown slot', () => {
    const { roster, lineup } = setup()
    const before = structuredClone(lineup)
    assignStarter(lineup, 'cbl', 'cb1')
    assignStarter(lineup, 'nope', 'spare')
    expect(lineup).toEqual(before)
  })
})

describe('assignBench', () => {
  it('replaces the occupant of a bench slot', () => {
    const { lineup } = setup()
    assignBench(lineup, 0, 'spare')
    expect(lineup.bench).toEqual(['spare', 'sub-st'])
  })

  it('appends when the slot is past the end, never leaving a hole', () => {
    const { lineup } = setup()
    assignBench(lineup, 2, 'spare')
    expect(lineup.bench).toEqual(['sub-cb', 'sub-st', 'spare'])
  })

  it('swaps two players already on the bench', () => {
    const { lineup } = setup()
    assignBench(lineup, 0, 'sub-st')
    expect(lineup.bench).toEqual(['sub-st', 'sub-cb'])
  })

  it('moves a bench player into an empty slot without duplicating them', () => {
    const { lineup } = setup()
    assignBench(lineup, 2, 'sub-cb')
    expect(lineup.bench).toEqual(['sub-st', 'sub-cb'])
    expect(new Set(lineup.bench).size).toBe(lineup.bench.length)
  })
})

describe('clearing', () => {
  it('removes a starter and a bench player', () => {
    const { lineup } = setup()
    clearStarter(lineup, 'cbl')
    clearBench(lineup, 0)
    expect(at(lineup, 'cbl')).toBeUndefined()
    expect(lineup.bench).toEqual(['sub-st'])
  })
})

describe('movePlayer：把球员移到阵容的任意去处', () => {
  const slotOf = (lineup: Lineup, id: string) => lineup.starters.find((item) => item.playerId === id)?.slotId

  it('未入选的球员上首发，被换下的人回到未入选', () => {
    const { roster, lineup } = setup()
    expect(movePlayer(roster, lineup, 'spare', { slotId: 'cbl' })).toBeNull()
    expect(slotOf(lineup, 'spare')).toBe('cbl')
    expect(slotOf(lineup, 'cb1')).toBeUndefined()
    expect(lineup.bench).not.toContain('cb1')
  })

  it('没学过的位置也能去，和原来的人互换', () => {
    const { roster, lineup } = setup()
    expect(movePlayer(roster, lineup, 'gk', { slotId: 'stl' })).toBeNull()
    expect(slotOf(lineup, 'gk')).toBe('stl')
    expect(slotOf(lineup, 'st1')).toBe('gk')
    expect(lineup.starters).toHaveLength(7)
  })

  it('球员或位置不存在时返回错误，阵容不变', () => {
    const { roster, lineup } = setup()
    const before = structuredClone(lineup)
    expect(movePlayer(roster, lineup, 'nobody', 'reserve')).toBeTruthy()
    expect(movePlayer(roster, lineup, 'spare', { slotId: 'no-such-slot' })).toBeTruthy()
    expect(lineup).toEqual(before)
  })

  it('首发下到替补位：替补位上的人顶上去', () => {
    const { roster, lineup } = setup()
    lineup.bench = ['sub-cb', 'sub-st']
    expect(movePlayer(roster, lineup, 'cb1', { benchIndex: 0 })).toBeNull()
    expect(slotOf(lineup, 'sub-cb')).toBe('cbl')
    expect(lineup.bench).toEqual(['cb1', 'sub-st'])
    expect(lineup.starters).toHaveLength(7)
  })

  it('首发下到替补位：替补位上的人没学过这个位置也顶上去', () => {
    const { roster, lineup } = setup()
    lineup.bench = ['sub-st', 'sub-cb']
    expect(movePlayer(roster, lineup, 'cb1', { benchIndex: 0 })).toBeNull()
    expect(slotOf(lineup, 'sub-st')).toBe('cbl')
    expect(lineup.bench).toEqual(['cb1', 'sub-cb'])
  })

  it('首发下到空替补位，不留空洞也不重复', () => {
    const { roster, lineup } = setup()
    lineup.bench = ['sub-cb']
    expect(movePlayer(roster, lineup, 'st1', { benchIndex: 2 })).toBeNull()
    expect(lineup.bench).toEqual(['sub-cb', 'st1'])
    expect(slotOf(lineup, 'st1')).toBeUndefined()
  })

  it('替补之间互换；未入选的球员进替补', () => {
    const { roster, lineup } = setup()
    lineup.bench = ['sub-cb', 'sub-st']
    expect(movePlayer(roster, lineup, 'sub-st', { benchIndex: 0 })).toBeNull()
    expect(lineup.bench).toEqual(['sub-st', 'sub-cb'])
    expect(movePlayer(roster, lineup, 'spare', { benchIndex: 1 })).toBeNull()
    expect(lineup.bench).toEqual(['sub-st', 'spare'])
  })

  it('移到未入选：首发或替补都能移出', () => {
    const { roster, lineup } = setup()
    lineup.bench = ['sub-cb', 'sub-st']
    expect(movePlayer(roster, lineup, 'sub-cb', 'reserve')).toBeNull()
    expect(lineup.bench).toEqual(['sub-st'])
    expect(movePlayer(roster, lineup, 'st1', 'reserve')).toBeNull()
    expect(slotOf(lineup, 'st1')).toBeUndefined()
  })
})

describe('5 个替补席位', () => {
  it('席位数是 5', () => {
    expect(BENCH_SIZE).toBe(5)
  })

  it('自动填充排满 5 个替补，不重复、不和首发重复，并覆盖门将、中场和边路', () => {
    for (const seed of [91, 92, 93]) {
      const game = createInitialGame(seed)
      const lineup = autoFillLineup(game.roster, game.lineup.formationId, game.lineup.tactics)
      expect(lineup.bench).toHaveLength(5)
      expect(new Set(lineup.bench).size).toBe(5)
      const starters = new Set(lineup.starters.map((item) => item.playerId))
      expect(lineup.bench.some((id) => starters.has(id))).toBe(false)
      const bench = lineup.bench.map((id) => game.roster.find((player) => player.id === id)!)
      expect(bench.some((player) => player.positions.GK > 0)).toBe(true)
      expect(bench.some((player) => player.positions.CM >= 40)).toBe(true)
      expect(bench.some((player) => player.positions.W >= 40)).toBe(true)
      expect(validateLineup(game.roster, lineup).valid).toBe(true)
      expect(validateLineup(game.roster, lineup).warnings.some((text) => text.includes('替补不足'))).toBe(false)
    }
  })

  it('球员不够时能排几个排几个，不会报错', () => {
    const game = createInitialGame(94)
    const roster = game.roster.slice(0, 9)
    const lineup = autoFillLineup(roster, game.lineup.formationId, game.lineup.tactics)
    expect(lineup.starters.length + lineup.bench.length).toBeLessThanOrEqual(9)
    expect(lineup.bench.length).toBeLessThan(5)
  })

  it('校验：5 人合法；6 人报错；少于 5 人（旧存档的 3 人）仍合法，只提示', () => {
    const game = createInitialGame(95)
    const lineup = autoFillLineup(game.roster, game.lineup.formationId, game.lineup.tactics)
    const reserves = game.roster.filter((player) => !lineup.bench.includes(player.id) && !lineup.starters.some((item) => item.playerId === player.id))
    expect(validateLineup(game.roster, lineup).errors).toEqual([])
    const six = { ...lineup, bench: [...lineup.bench, reserves[0].id] }
    expect(validateLineup(game.roster, six).errors).toContain('替补最多 5 人')
    const three = { ...lineup, bench: lineup.bench.slice(0, 3) }
    const check = validateLineup(game.roster, three)
    expect(check.valid).toBe(true)
    expect(check.warnings).toContain('替补不足 5 人，比赛中换人选择会受限')
  })

  it('可以移到第 5 个替补位；超出的位置算最后一席，不会多出第 6 个', () => {
    const { roster, lineup } = setup()
    lineup.bench = ['sub-cb', 'sub-st', 'spare']
    expect(movePlayer(roster, lineup, 'st1', { benchIndex: 3 })).toBeNull()
    expect(lineup.bench).toEqual(['sub-cb', 'sub-st', 'spare', 'st1'])
    expect(movePlayer(roster, lineup, 'st2', { benchIndex: 9 })).toBeNull()
    expect(lineup.bench).toEqual(['sub-cb', 'sub-st', 'spare', 'st1', 'st2'])
    expect(movePlayer(roster, lineup, 'cb1', { benchIndex: 9 })).toBeNull()
    expect(lineup.bench).toEqual(['sub-cb', 'sub-st', 'spare', 'st1', 'cb1'])
    expect(lineup.bench).toHaveLength(5)
  })

  it('比赛能带 5 个替补，第 5 个也能换上；换人仍然最多 3 次', () => {
    const game = createInitialGame(96)
    const lineup = autoFillLineup(game.roster, game.lineup.formationId, game.lineup.tactics)
    const input = teamInputFromLineup(game.roster, lineup, { id: 'p', name: 'P', color: '#fff', accent: '#000' })
    expect(input.bench).toHaveLength(5)
    const engine = new MatchEngine({ seed: 3, home: input, away: input, knockout: false })
    const team = engine.getTeam('home')
    expect(team.bench).toHaveLength(5)
    const swaps = [team.bench[4], team.bench[3], team.bench[2]]
    for (const incoming of swaps) {
      const out = team.players.filter((player) => player.position !== 'GK' && !swaps.some((item) => item.id === player.id))[0]
      expect(engine.substitute(out.id, incoming.id).ok).toBe(true)
    }
    const another = team.players.find((player) => player.position !== 'GK' && !swaps.some((item) => item.id === player.id))!
    expect(engine.substitute(another.id, team.bench.find((player) => !player.cameOff)!.id).ok).toBe(false)
    expect(team.subsUsed).toBe(3)
    expect(engine.simulate().finished).toBe(true)
  })
})
