import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { autoAssignLineup } from '../src/game/squad.ts'
import { personKey } from '../src/game/injury.ts'
import { startChallengeAgainstTeam } from '../src/game/season.ts'
import { restoreActiveEngine } from '../src/game/actions.ts'
import type { Player } from '../src/game/types.ts'

describe('挑战赛状态与自动填充', () => {
  it('挑战赛从满体能开始，忽略赛前伤病并标记为不产生伤病', () => {
    const game = createInitialGame(301)
    const player = game.roster.find((item) => item.positions.GK === 0)!
    player.condition = 20
    game.injuries = { [personKey(player)]: Date.now() + 86_400_000 }
    const result = startChallengeAgainstTeam(game, game.aiTeams[0], 7, Date.now(), 'friendly')
    expect(result.ok, result.error).toBe(true)
    const state = restoreActiveEngine(game)!.state
    const matchPlayer = state.teams[0].players.find((item) => item.sourceId === player.id)!
    expect(matchPlayer.stamina).toBeCloseTo(matchPlayer.maxStamina, 5)
    expect(matchPlayer.injured).not.toBe(true)
    expect(state.noInjuries).toBe(true)
  })

  it('自动填充不会把受伤球员放进首发或替补', () => {
    const game = createInitialGame(302)
    const injured = new Set([game.roster[0].id, game.roster[1].id])
    const lineup = autoAssignLineup(game.roster, '4-3-3', undefined, undefined, 'best', {
      condition: () => 100,
      minutes: () => 0,
      injured: (player: Player) => injured.has(player.id),
    })
    const picked = [...lineup.starters.map((starter) => starter.playerId), ...lineup.bench]
    expect(picked.some((id) => injured.has(id))).toBe(false)
  })
})
