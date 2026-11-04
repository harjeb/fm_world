import type { FormationId, Lineup, Player, Position, RoleId, Tactics } from './types.ts'
import { FORMATIONS } from './data/formations.ts'
import { ROLES, ROLES_BY_POSITION, roleFit } from './data/roles.ts'
import { positionMultiplier } from './ca.ts'

export type LineupSlotView = {
  slotId: string
  position: Position
  label: string
  player: Player | null
  role: RoleId
  fit: number
  effectiveLoss: number
}

export function playerById(roster: Player[], id: string): Player | undefined {
  return roster.find((player) => player.id === id)
}

export function bestRoleForPlayer(player: Player, position: Position): { role: RoleId; fit: number } {
  const roles = ROLES_BY_POSITION[position]
  let best = roles[0]
  let bestFit = -1
  for (const role of roles) {
    const fit = roleFit(player.attrs, role) * positionMultiplier(player.positions[position])
    if (fit > bestFit) {
      bestFit = fit
      best = role
    }
  }
  return { role: best, fit: bestFit }
}

export function autoFillLineup(
  roster: Player[],
  formationId: FormationId,
  tactics?: Tactics,
): Lineup {
  const formation = FORMATIONS[formationId]
  const used = new Set<string>()
  const starters = [] as Lineup['starters']
  const orderedSlots = [...formation.slots].sort((a, b) => (a.position === 'GK' ? -1 : b.position === 'GK' ? 1 : 0))
  for (const slot of orderedSlots) {
    let bestPlayer: Player | null = null
    let bestRole: RoleId = slot.defaultRole
    let bestScore = -Infinity
    for (const player of roster) {
      if (used.has(player.id)) continue
      const prof = player.positions[slot.position]
      if (prof <= 0) continue
      const multiplier = positionMultiplier(prof)
      for (const role of ROLES_BY_POSITION[slot.position]) {
        const score = roleFit(player.attrs, role) * multiplier
        if (score > bestScore) {
          bestScore = score
          bestPlayer = player
          bestRole = role
        }
      }
    }
    if (bestPlayer) {
      used.add(bestPlayer.id)
      starters.push({ slotId: slot.id, playerId: bestPlayer.id, role: bestRole })
    }
  }
  const bench: string[] = []
  const remaining = roster.filter((player) => !used.has(player.id))
  const gk = remaining.find((player) => player.positions.GK > 0)
  if (gk) bench.push(gk.id)
  const defender = remaining
    .filter((player) => player.id !== gk?.id)
    .sort((a, b) => b.attrs.defPos + b.attrs.tackling - (a.attrs.defPos + a.attrs.tackling))[0]
  if (defender) bench.push(defender.id)
  const attacker = remaining
    .filter((player) => !bench.includes(player.id))
    .sort((a, b) => b.attrs.shooting + b.attrs.offBall - (a.attrs.shooting + a.attrs.offBall))[0]
  if (attacker) bench.push(attacker.id)
  if (bench.length < 3) {
    for (const player of remaining) {
      if (bench.length >= 3) break
      if (!bench.includes(player.id)) bench.push(player.id)
    }
  }
  return {
    formationId,
    starters,
    bench,
    tactics: tactics ?? { ...formation.defaultTactics },
  }
}

export type LineupValidation = {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export function validateLineup(roster: Player[], lineup: Lineup): LineupValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const formation = FORMATIONS[lineup.formationId]
  if (!formation) errors.push('未知阵型')
  if (lineup.starters.length !== 7) errors.push('首发必须是 7 人')
  const slotMap = new Map(formation?.slots.map((slot) => [slot.id, slot]) ?? [])
  const playerIds = new Set<string>()
  let gkCount = 0
  for (const starter of lineup.starters) {
    const slot = slotMap.get(starter.slotId)
    if (!slot) {
      errors.push(`阵型中没有位置 ${starter.slotId}`)
      continue
    }
    const player = playerById(roster, starter.playerId)
    if (!player) {
      errors.push(`${slot.label}：球员不存在`)
      continue
    }
    if (playerIds.has(player.id)) errors.push(`${player.name} 被重复安排`)
    playerIds.add(player.id)
    const role = ROLES[starter.role]
    if (!role || role.position !== slot.position) errors.push(`${player.name} 的职责与 ${slot.label} 不匹配`)
    if (player.positions[slot.position] <= 0) errors.push(`${player.name} 尚未学会 ${slot.position}，不能首发`)
    if (slot.position === 'GK') gkCount++
    if (player.positions[slot.position] > 0 && player.positions[slot.position] < 65) {
      warnings.push(`${player.name} 在 ${slot.label} 的熟练度仅 ${Math.round(player.positions[slot.position])}，属性会明显折损`)
    }
  }
  if (gkCount !== 1) errors.push('阵容必须且只能有 1 名合法门将')
  if (formation) {
    const filled = new Set(lineup.starters.map((s) => s.slotId))
    for (const slot of formation.slots) {
      if (!filled.has(slot.id)) errors.push(`${slot.label} 无人`)
    }
  }
  if (lineup.bench.length > 3) errors.push('替补最多 3 人')
  const benchSet = new Set<string>()
  for (const id of lineup.bench) {
    if (playerIds.has(id)) errors.push('首发与替补不能重复')
    if (benchSet.has(id)) errors.push('替补重复')
    benchSet.add(id)
    if (!playerById(roster, id)) errors.push('替补球员不存在')
  }
  if (lineup.bench.length < 3) warnings.push('替补不足 3 人，比赛中换人选择会受限')
  return { valid: errors.length === 0, errors, warnings }
}

export function lineupSlots(roster: Player[], lineup: Lineup): LineupSlotView[] {
  const formation = FORMATIONS[lineup.formationId]
  return formation.slots.map((slot) => {
    const starter = lineup.starters.find((entry) => entry.slotId === slot.id)
    const player = starter ? playerById(roster, starter.playerId) ?? null : null
    const role = starter?.role ?? slot.defaultRole
    const prof = player ? player.positions[slot.position] : 0
    return {
      slotId: slot.id,
      position: slot.position,
      label: slot.label,
      player,
      role,
      fit: player ? roleFit(player.attrs, role) * positionMultiplier(prof) : 0,
      effectiveLoss: player ? 1 - positionMultiplier(prof) : 0,
    }
  })
}

/** 替换/确认球员后，自动修复不再合法的首发与替补。 */
export function repairLineup(roster: Player[], lineup: Lineup): { lineup: Lineup; changed: boolean } {
  if (validateLineup(roster, lineup).valid) return { lineup, changed: false }
  const fixed = autoFillLineup(roster, lineup.formationId, lineup.tactics)
  return { lineup: fixed, changed: true }
}
