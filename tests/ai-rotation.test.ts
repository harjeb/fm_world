import { describe, expect, it } from 'vitest'
import { AI_REST_BELOW, aiRotatedLineup, validateLineup } from '../src/game/squad.ts'
import { simulateAIvsAIState, teamInputFromAI } from '../src/game/match/setup.ts'
import { createWorldGame } from '../src/game/world.ts'
import type { AITeam } from '../src/game/types.ts'

function freshTeams(seed: number): AITeam[] {
  const game = createWorldGame(seed)
  for (const team of game.aiTeams) for (const player of team.players) player.condition = 100
  return game.aiTeams
}

const startersOf = (team: AITeam, input = teamInputFromAI(team, undefined, { rotate: true })) => input.starters.map((starter) => starter.player.id)

describe(`电脑球队体能低于 ${AI_REST_BELOW} 就轮换`, () => {
  it('体能都够时阵容不变；有人低于 80 就换上同位置体能够的人，存档里的阵容不动', () => {
    const [team] = freshTeams(7100)
    const stored = structuredClone(team.lineup)
    expect(startersOf(team)).toEqual(team.lineup.starters.map((starter) => starter.playerId))

    const tired = team.players.find((player) => player.id === team.lineup.starters.find((starter) => !starter.slotId.toLowerCase().includes('gk'))!.playerId)!
    tired.condition = AI_REST_BELOW - 1
    const rotated = startersOf(team)
    expect(rotated).not.toContain(tired.id)
    expect(rotated).toHaveLength(11)
    expect(team.lineup).toEqual(stored)
    // 不轮换（有教练的球队）照旧用存的阵容
    expect(startersOf(team, teamInputFromAI(team))).toContain(tired.id)
  })

  it('健康达标阵容能凑齐时不例外启用疲劳门将；全员疲劳时仍可排齐', () => {
    const [team] = freshTeams(7101)
    for (const player of team.players) if (player.positions.GK > 0) player.condition = 20
    const lineup = aiRotatedLineup(team.players, team.lineup.formationId, team.lineup.tactics)
    expect(validateLineup(team.players, lineup).valid).toBe(true)
    const keeper = team.players.find((player) => player.id === lineup.starters.find((starter) => starter.slotId === lineup.starters[0].slotId)!.playerId)!
    expect(keeper.positions.GK).toBe(0)
    expect(lineup.starters.every(s => team.players.find(p => p.id === s.playerId)!.condition! >= AI_REST_BELOW)).toBe(true)

    // 全队都累：还是能排出 11 人
    for (const player of team.players) player.condition = 10
    const exhausted = aiRotatedLineup(team.players, team.lineup.formationId, team.lineup.tactics)
    expect(exhausted.starters).toHaveLength(11)
    expect(validateLineup(team.players, exhausted).valid).toBe(true)
  })

  it('电脑球队之间的联赛默认轮换：累的首发这场不上', () => {
    const [home, away] = freshTeams(7102)
    const tiredIds = home.lineup.starters.slice(1, 5).map((starter) => starter.playerId)
    for (const id of tiredIds) home.players.find((player) => player.id === id)!.condition = 40
    const state = simulateAIvsAIState(home, away, 1)
    const onPitchAtKickoff = state.teams[0].players.map((player) => player.sourceId)
    for (const id of tiredIds) expect(onPitchAtKickoff).not.toContain(id)
  })
})
