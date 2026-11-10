import type { CupRun, GameState } from './types.ts'

/** 换季保留所有参赛记录，包括已夺冠/已淘汰；不重算赛果，不保留巨大的对手快照。 */
export function archivePastCups(game: GameState): boolean {
  if (!game.pve) return false
  let changed = false
  for (const run of Object.values(game.pve.cups)) {
    if (!run || run.seasonIndex >= game.season.index) continue
    if (run.status === 'active') { run.status = 'void'; changed = true }
    const history = (game.pve.cupHistory ??= [])
    if (history.some((old) => old.cupId === run.cupId && old.seasonIndex === run.seasonIndex)) continue
    const summary: CupRun = structuredClone(run)
    for (const participant of Object.values(summary.participants ?? {})) delete participant.snapshot
    history.push(summary)
    changed = true
  }
  return changed
}
