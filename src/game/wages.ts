import { caOf } from './ca.ts'
import type { GameState, Player } from './types.ts'

/**
 * 11 人制每队 25 人（7 人制时 18 人）：单人工资按 18 / 25 缩放，整队工资总额和 7 人制时相当，
 * 经济系统（收入、设施、AI 账本）不用跟着重调。
 */
export const SQUAD_WAGE_SCALE = 18 / 25

/** 单名球员每轮工资封顶（与身价封顶 2000 万对齐，覆盖原始 CA ~300 顶级巨星并杜绝指数爆炸）。 */
export const WAGE_CAP = 25_000

export function wageForPlayer(player: Player): number {
  // 与身价（bestMarketValue）保持同一口径：只按原始属性（baseAttrs）计算，
  // 避免 AI 持续培养或装备高阶球员卡后把 CA 拉到 450–600 触发指数级天价工资。
  const attrs = player.baseAttrs ?? player.attrs
  const positions = player.basePositions ?? player.positions
  const ca = caOf(attrs, positions.GK > 0)
  const raw = 800 * SQUAD_WAGE_SCALE * Math.pow(1.035, ca - 200)
  return Math.min(WAGE_CAP, Math.max(500, Math.round(raw / 50) * 50))
}

/**
 * 存量合同修复：旧版 wageForPlayer 按培养后 attrs 且无封顶计算，导致接管 AI 球队或续约时
 * 将单人每轮工资算到数万～数亿。凡超过「原始属性正常工资 × 1.15」的异常合同统一校正回正常值，
 * 保留正常的签约（1.0×）、续约（1.1×）与青训工资（100）。
 */
export function repairInflatedContractWages(roster: Player[]): boolean {
  let changed = false
  for (const player of roster) {
    if (!player?.contract || player.contract.clubId !== 'player') continue
    const expected = wageForPlayer(player)
    if (player.contract.wage > Math.round(expected * 1.15)) {
      player.contract.wage = expected
      changed = true
    }
  }
  return changed
}

export function worldWageBill(game: Pick<GameState, 'roster'>): number {
  return game.roster.reduce((sum, player) => sum + (player.contract?.wage ?? 0), 0)
}
