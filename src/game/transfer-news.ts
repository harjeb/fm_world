import type { GameState, MarketReport, Player } from './types.ts'

export function recordTransfer(game: Pick<GameState, 'transferNews'>, player: Pick<Player, 'id' | 'name' | 'age'>, club: string, amount: number, kind: NonNullable<MarketReport['kind']>, seller?: string, at = Date.now(), value?: number): void {
  const report: MarketReport = { playerId: player.id, playerName: player.name, age: player.age, club, amount, kind, seller, at, value }
  game.transferNews = [report, ...(game.transferNews ?? [])].slice(0, 30)
}
