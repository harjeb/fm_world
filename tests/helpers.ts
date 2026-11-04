import type { Lineup, Player } from '../src/game/types.ts'
import type { MatchTeamInput } from '../src/game/match/types.ts'
import { PLAYER_SEEDS, createPlayerFromSeed } from '../src/game/data/players.ts'
import { autoFillLineup } from '../src/game/squad.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'

export function allPlayers(): Player[] {
  return PLAYER_SEEDS.map(createPlayerFromSeed)
}

export function makeTeams(count = 200, formation: Lineup['formationId'] = '1-2-3-1') {
  const roster = allPlayers().slice(0, count)
  const lineup = autoFillLineup(roster, formation)
  return { roster, lineup }
}

export function inputFor(roster: Player[], lineup: Lineup, id: string, name: string): MatchTeamInput {
  return teamInputFromLineup(roster, lineup, { id, name, color: '#34d399', accent: '#052e1b' })
}
