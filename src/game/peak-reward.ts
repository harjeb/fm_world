import { caOf } from './ca.ts'
import { buildPeakTeam } from './peak.ts'
import { ensurePve } from './pve.ts'
import { SQUAD_LIMIT, joinRoster } from './market.ts'
import type { GameState, Player } from './types.ts'

/** 第 50 关全明星 Boss 的奖励关。 */
export const PEAK_REWARD_STAGE = 50

export type PeakRewardResult = { ok: true; player: Player } | { ok: false; error: string }

export function peakRewardReady(game: GameState): boolean {
  return (game.pve?.peak.cleared ?? 0) >= PEAK_REWARD_STAGE && !game.pve?.peak.reward50
}

function rewardId(): string {
  const cryptoApi = globalThis.crypto as { randomUUID?: () => string } | undefined
  if (cryptoApi?.randomUUID) return `reward-${cryptoApi.randomUUID()}`
  return `reward-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 第 50 关胜利后从全明星名单选 1 人入队。
 * 入队时保留该角色当前 CA 和逐人 PA 上限；只换一个全局唯一实例 id。
 */
export function claimPeakReward(game: GameState, templateId: string): PeakRewardResult {
  ensurePve(game)
  const peak = game.pve!.peak
  if (peak.cleared < PEAK_REWARD_STAGE) return { ok: false, error: `通关第 ${PEAK_REWARD_STAGE} 关后才能领取` }
  if (peak.reward50) return { ok: false, error: '第 50 关全明星奖励已经领取过了' }
  if (game.roster.length >= SQUAD_LIMIT) return { ok: false, error: `阵容已满（${SQUAD_LIMIT} 人），请先裁掉一名球员` }

  let team
  try {
    team = buildPeakTeam(PEAK_REWARD_STAGE)
  } catch {
    return { ok: false, error: '全明星数据尚未加载，请重新进入巅峰之路' }
  }
  const template = team.players.find((player) => player.id === templateId)
  if (!template) return { ok: false, error: '这名球员不在第 50 关全明星名单里' }
  if (game.roster.some((player) => player.seedId === template.id)) return { ok: false, error: '阵容里已经有这名球员了' }

  const player = structuredClone(template)
  player.id = rewardId()
  player.seedId = template.id
  player.age = 18
  player.height = player.height || 180
  player.condition = 100
  player.energy = 100
  player.history = undefined
  delete player.contract
  delete player.equippedCardId
  delete player.starKey
  joinRoster(game, player)

  peak.reward50 = {
    claimedAt: Date.now(),
    playerId: player.id,
    templateId: template.id,
    name: player.name,
    ca: caOf(player.attrs, player.positions.GK > 0),
    pa: player.pa,
  }
  return { ok: true, player }
}
