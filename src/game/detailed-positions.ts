import type { DetailedPosition, DetailedPositionTable, Position, PositionTable } from './types.ts'

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
export type PositionSource = { positions: PositionTable; detailedPositions?: DetailedPositionTable }

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
/** Read explicit values first; legacy saves use the matching coarse value, without inferring a side from foot. */
export function detailedPositionValue(source: PositionSource, position: DetailedPosition): number {
  const value = position === 'GK' ? source.positions.GK : source.detailedPositions?.[position] ?? source.positions[DETAILED_TO_POSITION[position]]
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
}
export function readDetailedPositions(source: PositionSource): Record<DetailedPosition, number> {
  return Object.fromEntries(DETAILED_POSITIONS.map(position => [position, detailedPositionValue(source, position)])) as Record<DetailedPosition, number>
}
