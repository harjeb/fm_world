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

export function facilityBudgetAvailable(game: Pick<GameState, 'board' | 'season'>): number {
  if (!isBoardBudgetActive(game)) return 0
  return Math.max(0, game.board!.current!.facilityBudget)
}

/** 校验升级设施资金是否充足：优先使用独立设施预算，不足或用完时自动使用俱乐部余额补足，两者互不冲突。 */
export function checkFacilityBudget(
  game: Pick<GameState, 'board' | 'season' | 'economy'>,
  cost: number,
): { ok: true; fromBudget: number; fromBalance: number } | { ok: false; error: string } {
  const availBudget = facilityBudgetAvailable(game)
  const balance = Math.max(0, game.economy?.balance ?? 0)
  if (availBudget + balance < cost) {
    return {
      ok: false,
      error: availBudget > 0 ? '设施预算与余额合计不足' : '余额不足',
    }
  }
  const fromBudget = Math.min(availBudget, cost)
  return { ok: true, fromBudget, fromBalance: cost - fromBudget }
}

export function spendFacilityBudget(game: Pick<GameState, 'board' | 'season'>, cost: number): void {
  if (!isBoardBudgetActive(game)) return
  const mandate = game.board!.current!
  mandate.facilityBudget = Math.max(0, mandate.facilityBudget - Math.max(0, Math.round(cost)))
}
