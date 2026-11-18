import type { GameState, Player } from './types.ts'
import { isYouthTrainee, youthTransferBlocked } from './youth.ts'

/** Ordinary browser saves cannot mint, promote, retrain or rewrite an academy player. */
export function preserveYouthState(previous: GameState, incoming: GameState, now: number): string | null {
  const originals = new Map<string, Player>([
    ...previous.freeStars, ...(previous.reserveStars ?? []), ...previous.aiTeams.flatMap(t => t.players),
    ...(previous.market?.listings.map(l => l.player) ?? []),
    ...(previous.youth?.members.map(m => m.player) ?? []),
    ...(previous.youth?.intake.candidates.map(m => m.player) ?? []), ...previous.roster,
  ].map(p => [p.id, p]))
  const rosterIds = new Set(previous.roster.map(p => p.id))
  const campIds = new Set(previous.youth?.members.map(m => m.player.id) ?? [])
  for (const player of previous.roster) {
    if (youthTransferBlocked(player, now) && !incoming.roster.some(p => p.id === player.id)) return '青训球员的征召、提拔及离队请使用青训页面'
  }
  const destinations = [incoming.roster, incoming.freeStars, incoming.reserveStars ?? [], ...(incoming.market?.listings.map(l => [l.player]) ?? [])]
  for (const players of destinations) for (let i = 0; i < players.length; i++) {
    const player = players[i]
    const original = originals.get(player.id)
    if (!original && (player.youthOrigin || player.id.startsWith('academy-'))) return '不能通过普通存档创建青训球员'
    if (original && isYouthTrainee(original) && (!rosterIds.has(player.id) || players !== incoming.roster)) return '在营青年只能通过青训页面征召或提拔'
    if (!original?.youthOrigin) { delete player.youthOrigin; continue }
    player.youthOrigin = structuredClone(original.youthOrigin)
    if (original.positionProfile) player.positionProfile = structuredClone(original.positionProfile)
    player.baseAttrs = { ...original.baseAttrs }
    player.basePositions = { ...original.basePositions }
    player.baseDetailedPositions = { ...original.baseDetailedPositions }
    player.basePersonality = { ...original.basePersonality }
    if (!player.equippedCardId && player.version === 0) {
      player.attrs = { ...original.baseAttrs }
      player.positions = { ...original.basePositions }
      player.detailedPositions = { ...original.baseDetailedPositions }
    }
    if (isYouthTrainee(original)) {
      if (incoming.training[player.id] || incoming.candidates[player.id] || incoming.cards?.some(c => c.playerId === player.id)) return '青训球员正式提拔后才能培养球员卡'
      players[i] = structuredClone(original)
    }
  }
  for (const id of campIds) {
    if (incoming.training[id] || incoming.candidates[id] || incoming.cards?.some(c => c.playerId === id)) return '在营青年不能制作球员卡'
  }
  incoming.youth = structuredClone(previous.youth)
  return null
}
