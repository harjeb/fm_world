import type { GameState } from './types.ts'
import { economyOf, MAX_FANS } from './economy.ts'
import { PEAK_MILESTONE_BY_STAGE, PEAK_MILESTONES, peakStageReward } from './data/peak-rewards.ts'
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

function applyReward(game: GameState, reward: { kind: 'money' | 'fans'; amount: number; breakthroughCards?: number }): void {
  const economy = economyOf(game)
  if (reward.kind === 'money') economy.balance += reward.amount
  else economy.fans = Math.min(MAX_FANS, economy.fans + reward.amount)
  if (reward.breakthroughCards) game.pve!.peak.breakthroughCards = (game.pve!.peak.breakthroughCards ?? 0) + reward.breakthroughCards
}

function grantStage(game: GameState, stage: number): boolean {
  const reward = peakStageReward(stage)
  const peak = game.pve?.peak
  if (!reward || !peak || peak.claimedStageRewards!.includes(stage)) return false
  // 旧里程碑可能已发过突破卡，即使账本被修复也不能再发。
  applyReward(game, peak.claimedMilestones!.includes(stage) ? { ...reward, breakthroughCards: undefined } : reward)
  peak.claimedStageRewards!.push(stage)
  if (PEAK_MILESTONE_BY_STAGE.has(stage) && !peak.claimedMilestones!.includes(stage)) peak.claimedMilestones!.push(stage)
  return true
}

/** 首次通关各关时发奖；重打不重复发放。 */
export function awardPeakMilestone(game: GameState, stage: number): boolean {
  const peak = game.pve?.peak
  if (!peak) return false
  if (peak.stageRewardVersion !== 2 || !Array.isArray(peak.claimedStageRewards)) ensurePeakMilestones(game)
  return grantStage(game, stage)
}

/**
 * 旧存档迁移：先按旧规则补齐已通关但未领的整十关；整段视为已发，
 * 仅对当前未满十关的已通关部分补发拆分奖励。迁移后只按逐关账本补发。
 */
export function ensurePeakMilestones(game: GameState): boolean {
  const peak = game.pve?.peak
  if (!peak) return false
  let changed = ensurePeakRewardState(game)
  if (peak.stageRewardVersion === 2 && !Array.isArray(peak.claimedStageRewards)) {
    // 新版账本损坏时保守标记已通关，不把已领过的奖励再发一次。
    peak.claimedStageRewards = Array.from({ length: Math.max(0, Math.min(100, peak.cleared)) }, (_, index) => index + 1)
    changed = true
  }
  if (peak.stageRewardVersion !== 2) {
    // 旧版本曾对已过关但漏标记的里程碑补发整笔，先沿用这一规则。
    for (const reward of PEAK_MILESTONES) {
      if (peak.cleared >= reward.stage && !peak.claimedMilestones!.includes(reward.stage)) {
        applyReward(game, reward)
        peak.claimedMilestones!.push(reward.stage)
      }
    }
    const covered = new Set<number>()
    for (const end of peak.claimedMilestones!) if (PEAK_MILESTONE_BY_STAGE.has(end)) {
      for (let stage = end - 9; stage <= end; stage++) covered.add(stage)
    }
    peak.claimedStageRewards = [...covered].sort((a, b) => a - b)
    peak.stageRewardVersion = 2
    changed = true
  }
  for (let stage = 1; stage <= peak.cleared; stage++) if (grantStage(game, stage)) changed = true
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
  const amount = Math.min(100, hard - before)
  player.ceilings = { ...player.ceilings, [attr]: Math.min(hard, before + 100) }
  const session = game.training[playerId]
  if (session && !session.completed) {
    const candidate = session.candidate
    const raw = candidate.ceilings?.[attr]
    const current = Number.isFinite(raw) && raw > 0 ? raw : hard
    candidate.ceilings = { ...candidate.ceilings, [attr]: Math.min(hard, current + amount) }
  }
  peak.breakthroughCards = (peak.breakthroughCards ?? 1) - 1
  return { ok: true, playerName: player.name, attr, amount }
}
