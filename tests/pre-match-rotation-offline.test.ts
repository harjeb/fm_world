import { describe, expect, it } from 'vitest'
import { restoreActiveEngine } from '../src/game/actions.ts'
import { conditionSettleMs } from '../src/game/condition.ts'
import { FORMATIONS } from '../src/game/data/formations.ts'
import { DETAILED_POSITIONS, DETAILED_TO_POSITION } from '../src/game/detailed-positions.ts'
import { personKey } from '../src/game/injury.ts'
import { emptyAutoSubs } from '../src/game/match/management.ts'
import { createInitialGame } from '../src/game/state.ts'
import { finishActiveMatch, playerFixture, simulateFixture, startChallengeAgainstTeam, startLeagueMatch } from '../src/game/season.ts'

const now = Date.UTC(2026, 10, 9, 12)

function fixture() {
  const game = createInitialGame(142)
  const formation = FORMATIONS[game.lineup.formationId]
  const starter = game.lineup.starters.find((item) => formation.slots.find(slot => slot.id === item.slotId)!.position !== 'GK')!
  const slot = formation.slots.find(item => item.id === starter.slotId)!
  const tired = game.roster.find(item => item.id === starter.playerId)!
  const fresh = game.roster.find(item => item.id === game.lineup.bench[0])!
  for (const player of game.roster) { player.condition = 100; player.recoveryAt = now }
  for (const id of game.lineup.bench) {
    const player = game.roster.find(item => item.id === id)!
    player.positions[slot.position] = 0
    player.detailedPositions = Object.fromEntries(DETAILED_POSITIONS.map(d => [d, player.positions[DETAILED_TO_POSITION[d]]]))
  }
  tired.condition = 30
  fresh.positions = { GK: 0, CB: 0, W: 0, CM: 0, ST: 0, [slot.position]: 100 }
  fresh.detailedPositions = Object.fromEntries(DETAILED_POSITIONS.map(d => [d, fresh.positions[DETAILED_TO_POSITION[d]]]))
  const otherStarter = game.lineup.starters.find(item => item.playerId !== tired.id)!
  const otherBench = game.lineup.bench[1]
  game.autoSubs = { ...emptyAutoSubs(), preMatchStaminaBelow: 70, timed: [
    { atMinute: 60, outId: tired.id, inId: fresh.id },
    { atMinute: 70, outId: otherStarter.playerId, inId: otherBench },
  ] }
  return { game, tired, fresh, starter }
}

describe('离线赛前体能轮换', () => {
  it('开赛使用轮换快照及有效赛中规则，战报记录真实阵容，不覆盖默认配置或消耗换人名额', () => {
    const { game, tired, fresh, starter } = fixture()
    const original = structuredClone(game.lineup)
    const plan = structuredClone(game.autoSubs!)
    expect(startLeagueMatch(game, now).ok).toBe(true)
    expect(game.lineup).toEqual(original)
    expect(game.autoSubs).toEqual(plan)
    expect(game.activeMatch!.lineup.starters.find(item => item.slotId === starter.slotId)!.playerId).toBe(fresh.id)
    expect(game.activeMatch!.lineup.bench).toContain(tired.id)
    const activeLineup = structuredClone(game.activeMatch!.lineup)
    const engine = restoreActiveEngine(game)!
    const team = engine.getTeam(game.activeMatch!.context.homeAway)
    expect(team.players.filter(player => player.onPitch).map(player => player.sourceId)).toContain(fresh.id)
    expect(team.autoSubs!.timed).toEqual([plan.timed[1]])
    expect(team.subsUsed).toBe(0)
    engine.simulate()
    expect(finishActiveMatch(game, engine, now)!.lineup).toEqual(activeLineup)
    expect(game.lineup).toEqual(original)
  })

  it('自动补赛也记录轮换后的首发', () => {
    const { game, tired, fresh, starter } = fixture()
    const original = structuredClone(game.lineup)
    const record = simulateFixture(game, playerFixture(game)!, true, now)!
    expect(record.lineup.starters.find(item => item.slotId === starter.slotId)!.playerId).toBe(fresh.id)
    expect(record.lineup.bench).toContain(tired.id)
    expect(game.lineup).toEqual(original)
  })

  it('旧存档默认关闭，低体能首发仍按原阵容上场', () => {
    const { game, tired, starter } = fixture()
    delete game.autoSubs!.preMatchStaminaBelow
    expect(startLeagueMatch(game, now).ok).toBe(true)
    expect(game.activeMatch!.lineup.starters.find(item => item.slotId === starter.slotId)!.playerId).toBe(tired.id)
  })

  it('先结算体能恢复，再判断阈值', () => {
    const { game, tired, starter } = fixture()
    tired.condition = 69
    tired.recoveryAt = now - conditionSettleMs(game.season.gameDayMs)
    expect(startLeagueMatch(game, now).ok).toBe(true)
    expect(tired.condition).toBeGreaterThanOrEqual(70)
    expect(game.activeMatch!.lineup.starters.find(item => item.slotId === starter.slotId)!.playerId).toBe(tired.id)
  })

  it('不将开球时受伤的替补换上；满体能挑战赛不轮换', () => {
    const { game, tired, fresh, starter } = fixture()
    game.injuries = { [personKey(fresh)]: now + 1 }
    expect(startLeagueMatch(game, now).ok).toBe(true)
    expect(game.activeMatch!.lineup.starters.find(item => item.slotId === starter.slotId)!.playerId).toBe(tired.id)

    const friendly = fixture()
    const opponent = friendly.game.aiTeams[0]
    expect(startChallengeAgainstTeam(friendly.game, opponent, 17, now).ok).toBe(true)
    expect(friendly.game.activeMatch!.lineup).toEqual(friendly.game.lineup)
    const engine = restoreActiveEngine(friendly.game)!
    expect(engine.getTeam('home').players.filter(player => player.onPitch).map(player => player.sourceId)).toContain(friendly.tired.id)
  })
})
