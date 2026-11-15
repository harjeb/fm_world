import { PLAYABLE_PROFICIENCY } from './ca.ts'
import { FORMATIONS } from './data/formations.ts'
import { slotPositionValue } from './detailed-positions.ts'
import type { AutoSubPlan, Lineup, Player } from './types.ts'

/** 为停赛首发补人时保留其他首发、职责与整套战术；此改动只用于本场快照。 */
export function repairSuspendedLineup(
  roster: Player[], lineup: Lineup, suspended: ReadonlySet<string>, unavailable: ReadonlySet<string>,
): Lineup {
  const result = structuredClone(lineup)
  result.bench = result.bench.filter((id) => !suspended.has(id))
  const occupied = new Set(result.starters.filter((starter) => !suspended.has(starter.playerId)).map((starter) => starter.playerId))
  const slots = FORMATIONS[result.formationId]?.slots ?? []
  for (const starter of result.starters) {
    if (!suspended.has(starter.playerId)) continue
    const slot = slots.find((item) => item.id === starter.slotId)
    if (!slot) continue
    const bench = new Set(result.bench)
    const candidates = roster.filter((player) => !suspended.has(player.id) && !occupied.has(player.id))
      .sort((a, b) => {
        const typeFit = (player: Player) => slot.position === 'GK' ? player.positions.GK > 0 : player.positions.GK <= 0
        return Number(!unavailable.has(b.id)) - Number(!unavailable.has(a.id))
          || Number(typeFit(b)) - Number(typeFit(a))
          || Number(slotPositionValue(b, slot) >= PLAYABLE_PROFICIENCY) - Number(slotPositionValue(a, slot) >= PLAYABLE_PROFICIENCY)
          || Number(bench.has(b.id)) - Number(bench.has(a.id))
          || slotPositionValue(b, slot) - slotPositionValue(a, slot)
          || (b.condition ?? 100) - (a.condition ?? 100)
      })
    const replacement = candidates[0]
    if (!replacement) continue
    starter.playerId = replacement.id
    occupied.add(replacement.id)
    result.bench = result.bench.filter((id) => id !== replacement.id)
  }
  return result
}

/** Rotate only from the original bench; unavailable contains injured and suspended IDs. */
export function rotatePreMatch(
  roster: Player[], lineup: Lineup, plan: AutoSubPlan | undefined, unavailable: ReadonlySet<string> = new Set(),
): { lineup: Lineup; autoSubs: AutoSubPlan | undefined; changes: { outId: string; inId: string; slotId: string }[] } {
  const result = structuredClone(lineup)
  const autoSubs = plan === undefined ? undefined : structuredClone(plan)
  const changes: { outId: string; inId: string; slotId: string }[] = []
  const threshold = plan?.preMatchStaminaBelow
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 1 || threshold > 99) {
    return { lineup: result, autoSubs, changes }
  }

  const players = new Map(roster.map((player) => [player.id, player]))
  const slots = FORMATIONS[lineup.formationId]?.slots ?? []
  const candidates = lineup.starters.map((starter, index) => ({ starter, index, player: players.get(starter.playerId) }))
    .filter((entry) => entry.player && entry.player.condition < threshold)
    .sort((a, b) => a.player!.condition - b.player!.condition || a.index - b.index)
  const used = new Set<string>()
  for (const { starter, index, player } of candidates) {
    const slot = slots.find((s) => s.id === starter.slotId)
    if (!slot || !player) continue
    const options = lineup.bench.map((id, benchIndex) => ({ player: players.get(id), benchIndex }))
      .filter((entry) => {
        const p = entry.player
        return p && !used.has(p.id) && !unavailable.has(p.id)
          && p.condition >= threshold && p.condition > player.condition
          && slotPositionValue(p, slot) >= PLAYABLE_PROFICIENCY
          && (slot.position === 'GK' ? p.positions.GK > 0 : p.positions.GK <= 0)
      })
      .sort((a, b) => slotPositionValue(b.player!, slot) - slotPositionValue(a.player!, slot)
        || b.player!.condition - a.player!.condition || a.benchIndex - b.benchIndex)
    const selected = options[0]
    if (!selected?.player) continue
    used.add(selected.player.id)
    result.starters[index].playerId = selected.player.id
    result.bench[selected.benchIndex] = starter.playerId
    changes.push({ outId: starter.playerId, inId: selected.player.id, slotId: starter.slotId })
  }

  // 锁定前可能还剔除了停赛球员；即使没有体能轮换，也不能保留本场已失效的规则。
  if (autoSubs) {
    const starters = new Set(result.starters.map((starter) => starter.playerId))
    const bench = new Set(result.bench)
    autoSubs.timed = autoSubs.timed.filter((rule) => starters.has(rule.outId) && bench.has(rule.inId))
    if (autoSubs.conditionRules) {
      autoSubs.conditionRules = autoSubs.conditionRules.filter((rule) =>
        (rule.targetKind !== 'player' || (rule.targetValue !== undefined && starters.has(rule.targetValue)))
        && (!rule.inId || bench.has(rule.inId)))
    }
  }
  return { lineup: result, autoSubs, changes }
}
