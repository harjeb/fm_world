import type { GameState } from './types.ts'

/**
 * 当前存档是否处于董事会预算/工资帽管控下：
 * 仅当存在与当前赛季编号匹配的 `board.current`（第 2 赛季起自动建立）时返回 true。
 * 第 1 赛季及不含 board 状态的旧测试用例不受限制。
 */
export function isBoardBudgetActive(game: Pick<GameState, 'board' | 'season'>): boolean {
  const current = game.board?.current
  return !!current && current.seasonIndex === (game.season?.index ?? 1)
}

export function checkFacilityBudget(game: Pick<GameState, 'board' | 'season'>, cost: number): { ok: true } | { ok: false; error: string } {
  if (!isBoardBudgetActive(game)) return { ok: true }
  const mandate = game.board!.current!
  if (mandate.facilityBudget < cost) {
    return {
      ok: false,
      error: `本赛季设施预算不足：需要 ${cost.toLocaleString()}，剩余设施预算 ${mandate.facilityBudget.toLocaleString()}（设施预算独立发放，不可通过转会预算滑块补充）`,
    }
  }
  return { ok: true }
}

export function spendFacilityBudget(game: Pick<GameState, 'board' | 'season'>, cost: number): void {
  if (!isBoardBudgetActive(game)) return
  const mandate = game.board!.current!
  mandate.facilityBudget = Math.max(0, mandate.facilityBudget - Math.max(0, Math.round(cost)))
}
