/**
 * 我们的阵型 → pes2d 的站位行 [角色, 纵深 nx, 横向 ny, 线位]。计划 6.4 第 4 条。
 *
 * 阵型槽位的 (x, y) 本来就是 0–1 的归一化坐标，和 pes2d 的 (nx, ny) 是同一个意思：
 * x = 距本方球门线的比例（0 = 本方球门线，1 = 对方球门线），y = 横向（0 = 左，1 = 右）。
 */
import { FORMATIONS } from '../data/formations.ts'
import type { FormationId, Position } from '../types.ts'
import type { PesRole } from './spec.ts'

export interface FormationRow {
  slotId: string
  position: Position
  role: PesRole
  nx: number
  ny: number
  /** 线位：0 后卫 ~ 1 前锋 */
  line: number
}

const LINE_BY_POSITION: Record<Position, number> = { GK: 0, CB: 0.1, CM: 0.45, W: 0.8, ST: 0.9 }

function roleOf(position: Position, ny: number): PesRole {
  switch (position) {
    case 'GK': return 'GK'
    case 'CB': return 'CB'
    case 'CM': return 'CM'
    case 'ST': return 'ST'
    case 'W': return ny < 0.5 ? 'LW' : 'RW'
  }
}

/**
 * @param custom 玩家在阵型板上自己摆的位置（`Lineup.customPositions`，key 是槽位 id）；没摆的用阵型默认值。
 *               自定义位置只改站位，不改角色和线位。
 */
export function formationRows(formationId: FormationId, custom?: Record<string, { x: number; y: number }>): FormationRow[] {
  const slots = FORMATIONS[formationId].slots
  const centreBacks = slots.filter((slot) => slot.position === 'CB')
  return slots.map((slot) => {
    const spot = custom?.[slot.id]
    const nx = spot?.x ?? slot.x
    const ny = spot?.y ?? slot.y
    let line = LINE_BY_POSITION[slot.position]
    // 三中卫里居中的那个更靠后（拖后中卫）
    if (slot.position === 'CB' && centreBacks.length === 3 && slot.y === 0.5) line = 0.08
    return { slotId: slot.id, position: slot.position, role: roleOf(slot.position, slot.y), nx, ny, line }
  })
}
