import type { DetailedPosition, DetailedPositionTable, Position, PositionTable, Foot, StyleId, Player, GameState } from './types.ts'

export const DETAILED_POSITIONS: readonly DetailedPosition[] = ['GK', 'DL', 'DC', 'DR', 'WBL', 'WBR', 'DM', 'ML', 'MC', 'MR', 'AML', 'AMC', 'AMR', 'ST']
export const DETAILED_TO_POSITION: Record<DetailedPosition, Position> = {
  GK: 'GK', DL: 'W', DC: 'CB', DR: 'W', WBL: 'W', WBR: 'W', DM: 'CM', ML: 'W', MC: 'CM', MR: 'W', AML: 'W', AMC: 'CM', AMR: 'W', ST: 'ST',
}
export const POSITION_TO_DETAILED: Record<Position, readonly DetailedPosition[]> = {
  GK: ['GK'], CB: ['DC'], W: ['DL', 'DR', 'WBL', 'WBR', 'ML', 'MR', 'AML', 'AMR'], CM: ['DM', 'MC', 'AMC'], ST: ['ST'],
}
export const DETAILED_POSITION_LABELS: Record<DetailedPosition, string> = {
  GK: '门将', DL: '左后卫', DC: '中后卫', DR: '右后卫', WBL: '左翼卫', WBR: '右翼卫', DM: '后腰', ML: '左中场', MC: '中前卫', MR: '右中场', AML: '左边锋', AMC: '前腰', AMR: '右边锋', ST: '前锋',
}
export type PositionSource = { positions: PositionTable; detailedPositions?: DetailedPositionTable; foot?: Foot; style?: StyleId }

/** Deterministic approximation, not a claim about a historical player's actual role. */
export function inferDetailedPositions(source: PositionSource): Record<DetailedPosition, number> {
  const style = source.style ?? ''
  const wing = style.startsWith('fb_') ? 0 : style.startsWith('w_') ? 2 : 1
  const centre = style === 'cm_destroyer' ? 0 : style === 'cm_creator' || style === 'cm_mezzala' ? 2 : 1
  const ranks: Partial<Record<DetailedPosition, number>> = {
    DL: 0, DR: 0, WBL: 0, WBR: 0, ML: 1, MR: 1, AML: 2, AMR: 2,
    DM: 0, MC: 1, AMC: 2,
  }
  // Adjacent roles are only a conservative estimate, not evidence of training.
  // Use original coarse values only, so estimates cannot cascade into other roles.
  const adjacent: Partial<Record<DetailedPosition, Partial<Record<Position, number>>>> = {
    DC: { CM: 0.55, W: wing === 0 ? 0.5 : 0.3 },
    DL: { CB: 0.55, CM: 0.35 }, DR: { CB: 0.55, CM: 0.35 },
    WBL: { CB: 0.45, CM: 0.45 }, WBR: { CB: 0.45, CM: 0.45 },
    ML: { CM: 0.5, ST: 0.35 }, MR: { CM: 0.5, ST: 0.35 },
    AML: { CM: 0.5, ST: 0.6 }, AMR: { CM: 0.5, ST: 0.6 },
    DM: { CB: 0.65, W: wing === 0 ? 0.5 : 0.3 },
    MC: { CB: 0.4, W: 0.45, ST: 0.35 },
    AMC: { W: wing === 2 ? 0.65 : 0.45, ST: 0.6 },
    ST: { W: wing === 2 ? 0.6 : 0.35, CM: centre === 2 ? 0.55 : 0.4 },
  }
  const outfield = source.positions.GK === 0
  return Object.fromEntries(DETAILED_POSITIONS.map(pos => {
    const coarse = source.positions[DETAILED_TO_POSITION[pos]]
    const rank = ranks[pos]
    let penalty = rank === undefined ? 0 : Math.abs(rank - (DETAILED_TO_POSITION[pos] === 'W' ? wing : centre)) * 10
    if (rank !== undefined && DETAILED_TO_POSITION[pos] === 'W') {
      if ((pos.endsWith('L') && source.foot === 'R') || (pos.endsWith('R') && source.foot === 'L')) penalty += 7
    }
    let inferred = Number.isFinite(coarse) ? Math.max(0, Math.min(100, coarse - penalty)) : 0
    if (outfield && pos !== 'GK' && coarse === 0) {
      inferred = Math.min(79, Math.max(0, ...Object.entries(adjacent[pos] ?? {}).map(([key, weight]) => {
        const value = source.positions[key as Position]
        return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) * weight : 0
      })))
    }
    return [pos, source.detailedPositions?.[pos] ?? inferred]
  })) as Record<DetailedPosition, number>
}

/** Partial or independently differing groups are never rewritten. Uniform groups are
 * can also result from training, so only untouched builds are eligible. Missing
 * tables have no explicit values to lose. */
function migrateTable(source: PositionSource, allowUniform: boolean): DetailedPositionTable {
  if (!source.detailedPositions) return inferDetailedPositions(source)
  const result = { ...source.detailedPositions }
  if (allowUniform) {
    const inferred = inferDetailedPositions({ ...source, detailedPositions: undefined })
    // Only a complete, exact copy of the coarse table safely identifies old
    // generated zero groups; partial or independently specified zeros are real.
    const copied = (Object.keys(POSITION_TO_DETAILED) as Position[]).every(coarse =>
      POSITION_TO_DETAILED[coarse].every(pos => result[pos] === source.positions[coarse]))
    if (copied) {
      for (const coarse of ['CB', 'W', 'CM', 'ST'] as const) {
        if (source.positions[coarse] === 0) for (const pos of POSITION_TO_DETAILED[coarse]) result[pos] = inferred[pos]
      }
    }
    if (copied) {
      for (const coarse of ['W', 'CM'] as const) {
        for (const pos of POSITION_TO_DETAILED[coarse]) result[pos] = inferred[pos]
      }
    }
  }
  return result
}

function hasPositionTraining(history: Player['history']): boolean {
  return !!history?.some(entry => /位置训练|位置学习/.test(`${entry.title} ${entry.text}`))
}

export function migratePlayerPositions(player: Player, potentiallyTrained = false): boolean {
  let changed = false
  if (!player.detailedPositionsVersion) {
    player.detailedPositions = migrateTable(player, !potentiallyTrained && player.version === 0 && !player.equippedCardId && !hasPositionTraining(player.history))
    player.detailedPositionsVersion = 1
    changed = true
  }
  if (!player.baseDetailedPositionsVersion && player.basePositions) {
    if (!player.baseDetailedPositions && !potentiallyTrained && !player.equippedCardId && player.version === 0 && !hasPositionTraining(player.history) && player.detailedPositions &&
        (Object.keys(POSITION_TO_DETAILED) as Position[]).every(pos => player.positions[pos] === player.basePositions![pos])) {
      player.baseDetailedPositions = { ...player.detailedPositions }
    } else {
      player.baseDetailedPositions = migrateTable({ positions: player.basePositions, detailedPositions: player.baseDetailedPositions, foot: player.foot, style: player.style }, !potentiallyTrained && !player.equippedCardId && player.version === 0 && !hasPositionTraining(player.history))
    }
    player.baseDetailedPositionsVersion = 1
    changed = true
  }
  return changed
}

/** Migrate durable player builds, never the active match snapshot. */
export function migrateGamePositions(game: GameState, options?: { skipFrozenShared?: boolean }): boolean {
  const skipFrozen = options?.skipFrozenShared === true
  const players = [
    ...game.roster,
    ...game.aiTeams.flatMap(team => (skipFrozen && team && Object.isFrozen(team)) ? [] : (team?.players ?? [])),
    ...game.freeStars,
    ...((skipFrozen && game.reserveStars && Object.isFrozen(game.reserveStars)) ? [] : (game.reserveStars ?? [])),
    ...(game.market?.listings ?? []).map(item => item.player),
    ...Object.values(game.training ?? {}).map(session => session?.candidate), ...Object.values(game.candidates ?? {}),
    ...Object.values(game.aiClubs ?? {}).flatMap(club => club.signings ?? []),
    ...Object.values(game.world?.transferTeams ?? {}).flatMap(team => team?.players ?? []),
  ]
  let changed = false
  // Equipped builds and their cards are two copies of the same data. Prefer the
  // explicit copy if only one survived in an older save.
  for (const player of players) {
    if (!player?.equippedCardId) continue
    const card = game.cards?.find(item => item.id === player.equippedCardId)
    if (!card) continue
    if (!player.detailedPositions && card.detailedPositions) {
      player.detailedPositions = { ...card.detailedPositions }
      player.detailedPositionsVersion = card.detailedPositionsVersion
      changed = true
    } else if (!card.detailedPositions && player.detailedPositions) {
      card.detailedPositions = { ...player.detailedPositions }
      card.detailedPositionsVersion = player.detailedPositionsVersion
      changed = true
    }
    // Migrate matching equipped copies together; never overwrite conflicting data.
    if (DETAILED_POSITIONS.every(pos => player.detailedPositions?.[pos] === card.detailedPositions?.[pos]) &&
        (Object.keys(POSITION_TO_DETAILED) as Position[]).every(pos => player.positions[pos] === card.positions[pos])) {
      if (!player.detailedPositionsVersion && !card.detailedPositionsVersion) {
        const detail = migrateTable(player, false)
        player.detailedPositions = { ...detail }
        card.detailedPositions = { ...detail }
        player.detailedPositionsVersion = card.detailedPositionsVersion = 1
        changed = true
      } else if (!player.detailedPositionsVersion || !card.detailedPositionsVersion) {
        player.detailedPositionsVersion = card.detailedPositionsVersion = 1
        changed = true
      }
    }
  }
  const candidates = new Set([...Object.values(game.training ?? {}).map(session => session?.candidate), ...Object.values(game.candidates ?? {})])
  for (const player of players) if (player?.positions && migratePlayerPositions(player, candidates.has(player))) changed = true
  for (const card of game.cards ?? []) {
    if (card.detailedPositionsVersion || !card.positions) continue
    const owner = players.find(player => player?.id === card.playerId)
    card.detailedPositions = migrateTable({ positions: card.positions, detailedPositions: card.detailedPositions, foot: owner?.foot, style: owner?.style }, false)
    card.detailedPositionsVersion = 1
    changed = true
  }
  return changed
}

/** Formation IDs describe the tactical slot, not the player's preferred foot. */
export function detailedPositionForSlot(slot: { id: string; position: Position; label: string }): DetailedPosition {
  if (slot.position === 'GK' || slot.position === 'ST') return slot.position
  if (slot.position === 'CB') return 'DC'
  if (slot.position === 'CM') return slot.label.includes('后腰') ? 'DM' : slot.label.includes('前腰') ? 'AMC' : 'MC'
  switch (slot.id) {
    case 'lb': return 'DL'
    case 'rb': return 'DR'
    case 'lwb': return 'WBL'
    case 'rwb': return 'WBR'
    case 'lm': return 'ML'
    case 'rm': return 'MR'
    case 'lw': case 'wl': return 'AML'
    case 'rw': case 'wr': return 'AMR'
    default: return slot.id.endsWith('l') ? 'ML' : 'MR'
  }
}
export function slotPositionValue(source: PositionSource, slot: { id: string; position: Position; label: string }): number {
  return detailedPositionValue(source, detailedPositionForSlot(slot))
}
export function isDetailedPosition(value: unknown): value is DetailedPosition {
  return typeof value === 'string' && DETAILED_POSITIONS.includes(value as DetailedPosition)
}
/** Missing values, including legacy snapshots without a table, use coarse values. */
export function detailedPositionValue(source: PositionSource, position: DetailedPosition): number {
  if (position === 'GK') {
    const value = source.positions.GK
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
  }
  const value = source.detailedPositions?.[position] ?? source.positions[DETAILED_TO_POSITION[position]]
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
}
export function readDetailedPositions(source: PositionSource): Record<DetailedPosition, number> {
  return Object.fromEntries(DETAILED_POSITIONS.map(position => [position, detailedPositionValue(source, position)])) as Record<DetailedPosition, number>
}
