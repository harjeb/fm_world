import type { GameState } from './types.ts'
import { economyOf, MAX_FANS } from './economy.ts'
import { PEAK_MILESTONE_BY_STAGE, PEAK_MILESTONES } from './data/peak-rewards.ts'
import { attrHardLimit, mainAttrsFor } from './rating.ts'

function ensurePeakRewardState(game: GameState): boolean {
  if (!game.pve?.peak) return false
  let changed = false
  if (!Array.isArray(game.pve.peak.claimedMilestones)) {
    game.pve.peak.claimedMilestones = []
    changed = true
  }
  if (!Number.isInteger(game.pve.peak.breakthroughCards) || game.pve.peak.breakthroughCards! < 0) {
    game.pve.peak.breakthroughCards = 0
    changed = true
  }
  return changed
}

function grant(game: GameState, stage: number): boolean {
  const reward = PEAK_MILESTONE_BY_STAGE.get(stage)
  const pve = game.pve?.peak
  if (!reward || !pve || pve.claimedMilestones!.includes(stage)) return false
  const economy = economyOf(game)
  if (reward.kind === 'money') economy.balance += reward.amount
  else economy.fans = Math.min(MAX_FANS, economy.fans + reward.amount)
  if (reward.breakthroughCards) pve.breakthroughCards = (pve.breakthroughCards ?? 0) + reward.breakthroughCards
  pve.claimedMilestones!.push(stage)
  return true
}

/** 首次通关里程碑时发奖；重复通关不重复发。 */
export function awardPeakMilestone(game: GameState, stage: number): boolean {
  ensurePeakRewardState(game)
  return grant(game, stage)
}

/** 旧存档补发：已经超过里程碑但还没有领取记录的，补一次。 */
export function ensurePeakMilestones(game: GameState): boolean {
  const pve = game.pve?.peak
  if (!pve) return false
  let changed = ensurePeakRewardState(game)
  for (const reward of PEAK_MILESTONES) {
    if (pve.cleared >= reward.stage && !pve.claimedMilestones!.includes(reward.stage)) {
      if (grant(game, reward.stage)) changed = true
    }
  }
  return changed
}

export type PeakBreakthroughResult = { ok: true; playerName: string; attr: import('./types.ts').AttrKey; amount: number } | { ok: false; error: string }

/** 使用一张单属性突破卡：只加该主属性上限 +100，不改变当前属性。 */
export function applyPeakBreakthrough(game: GameState, playerId: string, attr: import('./types.ts').AttrKey): PeakBreakthroughResult {
  ensurePeakRewardState(game)
  const peak = game.pve?.peak
  if (!peak || (peak.breakthroughCards ?? 0) <= 0) return { ok: false, error: '没有可用的属性突破卡' }
  const player = game.roster.find((item) => item.id === playerId)
  if (!player) return { ok: false, error: '球员不存在' }
  const gk = player.positions.GK > 0
  if (!mainAttrsFor(gk).includes(attr)) return { ok: false, error: '只能突破该球员的主属性' }
  const hard = attrHardLimit(attr, gk)
  const before = Number.isFinite(player.ceilings[attr]) && player.ceilings[attr] > 0 ? player.ceilings[attr] : hard
  if (before >= hard) return { ok: false, error: '该属性已经达到 2000 硬上限' }
  player.ceilings = { ...player.ceilings, [attr]: Math.min(hard, before + 100) }
  peak.breakthroughCards = (peak.breakthroughCards ?? 1) - 1
  return { ok: true, playerName: player.name, attr, amount: Math.min(100, hard - before) }
}
