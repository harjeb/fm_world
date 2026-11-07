import { caOf } from './ca.ts'
import type { GameState, Lineup, Player } from './types.ts'

type Build = Pick<Player, 'attrs' | 'positions'>

const caOfBuild = (build: Build): number => caOf(build.attrs, build.positions.GK > 0)

/**
 * 一阵评分：首发每个人最强的那张卡的 CA，加起来。
 * 玩家球员身上装备什么不重要，库存里最好的一张卡才算；电脑球队的球员身上
 * 本来就装着阵容槽位上最强的卡，直接按身上的属性算。
 */
export function lineupRating(players: Player[], lineup: Lineup, cards: GameState['cards'] = []): number {
  const best = new Map<string, number>()
  for (const card of cards ?? []) {
    const ca = caOfBuild(card)
    if (ca > (best.get(card.playerId) ?? 0)) best.set(card.playerId, ca)
  }
  const byId = new Map(players.map((player) => [player.id, player]))
  let total = 0
  for (const starter of lineup.starters) {
    const player = byId.get(starter.playerId)
    if (player) total += Math.max(caOfBuild(player), best.get(player.id) ?? 0)
  }
  return total
}

/** 本联赛每支球队（含玩家，id 为 `player`）的一阵评分。 */
export function clubRatings(game: Pick<GameState, 'roster' | 'lineup' | 'cards' | 'aiTeams'>): Map<string, number> {
  const ratings = new Map<string, number>()
  if (game.roster && game.lineup) ratings.set('player', lineupRating(game.roster, game.lineup, game.cards))
  for (const team of game.aiTeams ?? []) {
    if (team?.players && team.lineup) ratings.set(team.id, lineupRating(team.players, team.lineup))
  }
  return ratings
}

/**
 * 对手在本联赛里按评分的排位：0 是最强的一队，1 是最弱的一队。
 * 评分相同按球队 id 排，保证每次算出来一样。找不到对手或联赛里不足两队时返回 null。
 */
export function opponentRankShare(
  game: Pick<GameState, 'roster' | 'lineup' | 'cards' | 'aiTeams'>,
  opponentId: string,
): number | null {
  const ratings = clubRatings(game)
  if (ratings.size < 2 || !ratings.has(opponentId)) return null
  const ranked = [...ratings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const index = ranked.findIndex(([id]) => id === opponentId)
  return index / (ranked.length - 1)
}
