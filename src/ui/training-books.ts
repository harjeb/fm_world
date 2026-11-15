import type { GameState, Player } from '../game/types.ts'
import { basicSkillsFor } from '../game/data/skills.ts'
import { baseBuild } from '../game/cards.ts'
import { trainingBookLoadout as savedTrainingBookLoadout } from '../game/actions.ts'

/** UI-only filtering: keys encode the skill ID before the tier, even if inventory changed. */
export function filterTrainingBookIds(player: Player, keys: string[]): string[] {
  const basic = new Set<string>(basicSkillsFor({ ...player, ...baseBuild(player) }))
  return keys.filter((key) => !basic.has(key.split(':')[0]))
}

export function trainingBookLoadout(game: GameState, playerId: string): string[] {
  const keys = savedTrainingBookLoadout(game, playerId)
  const player = game.roster.find((item) => item.id === playerId)
  return player ? filterTrainingBookIds(player, keys) : keys
}
