import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { buildKnockoutRound, cupPlayerFixture, enterCup } from '../src/game/cup-run.ts'
import { cupDefById } from '../src/game/data/cup-config.ts'
import { finishMatch, restoreActiveEngine, startCupMatch } from '../src/game/actions.ts'
import type { GameState } from '../src/game/types.ts'
import { economyOf } from '../src/game/economy.ts'

function playNext(game: GameState, cupId: 'community' | 'league' | 'champions'): void {
  const start = startCupMatch(game, cupId)
  expect(start.ok, start.error).toBe(true)
  const engine = restoreActiveEngine(game)!
  engine.simulate()
  const record = finishMatch(game, engine)
  expect(record).toBeTruthy()
  expect(record!.mode).toBe('cup')
}

describe('杯赛跑通', () => {
  it('报名社区杯：4 组，AI 小组赛先结算，玩家有 3 场', () => {
    const game = createInitialGame(5150)
    const result = enterCup(game, 'community')
    expect(result.ok, result.error).toBe(true)
    const run = game.pve!.cups.community
    expect(run.status).toBe('active')
    expect(run.stage).toBe('group')
    expect(run.groups).toHaveLength(4)
    const group = run.groups[run.playerGroupIndex]
    expect(group.teamIds).toContain('player')
    expect(group.fixtures).toHaveLength(6)
    const playerFixtures = group.fixtures.filter((fixture) => fixture.homeId === 'player' || fixture.awayId === 'player')
    expect(playerFixtures).toHaveLength(3)
    expect(playerFixtures.every((fixture) => !fixture.played)).toBe(true)
    expect(group.fixtures.filter((fixture) => fixture.homeId !== 'player' && fixture.awayId !== 'player').every((fixture) => fixture.played)).toBe(true)
    expect(cupPlayerFixture(run)).toBeTruthy()
    expect(enterCup(game, 'community').ok).toBe(false)
  })

  it('踢完小组赛后会出线或淘汰，并写入杯赛战报', () => {
    const game = createInitialGame(5151)
    expect(enterCup(game, 'community').ok).toBe(true)
    for (let index = 0; index < 3; index++) playNext(game, 'community')
    const run = game.pve!.cups.community
    const group = run.groups[run.playerGroupIndex]
    expect(group.fixtures.filter((fixture) => fixture.homeId === 'player' || fixture.awayId === 'player').every((fixture) => fixture.played)).toBe(true)
    expect(['active', 'eliminated']).toContain(run.status)
    if (run.status === 'active') expect(run.qualifiers).toContain('player')
    else expect(run.status).toBe('eliminated')
    expect(game.challengeHistory.filter((record) => record.mode === 'cup')).toHaveLength(3)
  })

  it('杯赛冠军写入奖杯和奖金；淘汰则结束', () => {
    const game = createInitialGame(5153)
    expect(enterCup(game, 'community').ok).toBe(true)
    const before = economyOf(game).balance
    for (let index = 0; index < 10; index++) {
      const run = game.pve!.cups.community
      if (run.status !== 'active' || !cupPlayerFixture(run)) break
      playNext(game, 'community')
    }
    const run = game.pve!.cups.community
    if (run.status === 'champion') {
      expect(game.pve!.trophies.some((trophy) => trophy.cupId === 'community')).toBe(true)
      expect(economyOf(game).balance).toBeGreaterThan(before)
    } else {
      expect(run.status).toBe('eliminated')
      expect(game.pve!.trophies).toHaveLength(0)
    }
  })

  it('冠军杯 32 队：16 强单场，8 强起两回合', () => {
    const game = createInitialGame(5152)
    expect(enterCup(game, 'champions').ok).toBe(true)
    const run = game.pve!.cups.champions
    expect(run.groups).toHaveLength(8)
    const others = Object.keys(run.participants).filter((id) => id !== 'player')

    buildKnockoutRound(game, run, cupDefById('champions'), 'r16', ['player', ...others.slice(0, 15)])
    const r16 = run.knockout?.ties.find((item) => item.legs.some((leg) => leg.homeId === 'player' || leg.awayId === 'player'))
    expect(r16?.legs).toHaveLength(1)

    buildKnockoutRound(game, run, cupDefById('champions'), 'qf', ['player', ...others.slice(0, 7)])
    const qf = run.knockout?.ties.find((item) => item.legs.some((leg) => leg.homeId === 'player' || leg.awayId === 'player'))
    expect(qf?.legs).toHaveLength(2)
    expect(qf?.legs[0].homeId === qf?.legs[1].awayId || qf?.legs[0].awayId === qf?.legs[1].homeId).toBe(true)

    playNext(game, 'champions')
    expect(qf?.legs[0].played).toBe(true)
    expect(qf?.legs[1].played).toBe(false)
    playNext(game, 'champions')
    expect(qf?.legs[1].played).toBe(true)
    expect(qf?.aggregate).toBeTruthy()
  })
})
