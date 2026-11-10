import { beforeAll, describe, expect, it } from 'vitest'
import { loadPveContent } from '../src/game/pve-content.ts'
beforeAll(loadPveContent)
import { caOf } from '../src/game/ca.ts'
import { createInitialGame } from '../src/game/state.ts'
import { buildPeakTeam } from '../src/game/peak.ts'
import { claimPeakReward, peakRewardReady } from '../src/game/peak-reward.ts'
import { SQUAD_LIMIT } from '../src/game/market.ts'

const boss = () => buildPeakTeam(50)
const tsubasa = () => boss().players.find((player) => player.name === '大空翼')!

function readyGame(seed = 12345) {
  const game = createInitialGame(seed)
  game.pve!.peak.cleared = 50
  return game
}

describe('第 50 关全明星奖励', () => {
  it('通关后可选一名球员，按当前 CA 入队，并保留逐人 PA 上限', () => {
    const game = readyGame()
    const template = tsubasa()
    expect(peakRewardReady(game)).toBe(true)
    const result = claimPeakReward(game, template.id)
    expect(result.ok, result.ok ? '' : result.error).toBe(true)
    if (!result.ok) return
    const added = result.player
    expect(added.name).toBe('大空翼')
    expect(added.id).not.toBe(template.id)
    expect(added.id.startsWith('reward-')).toBe(true)
    expect(caOf(added.attrs, added.positions.GK > 0)).toBeCloseTo(caOf(template.attrs, template.positions.GK > 0), 5)
    expect(added.pa).toBeCloseTo(1500, 5)
    expect(added.ceilings).toEqual(template.ceilings)
    expect(game.roster.at(-1)!.id).toBe(added.id)
    expect(game.pve!.peak.reward50?.playerId).toBe(added.id)
    expect(peakRewardReady(game)).toBe(false)
  })

  it('每个账号只能领取一次', () => {
    const game = readyGame(12346)
    expect(claimPeakReward(game, tsubasa().id).ok).toBe(true)
    const again = claimPeakReward(game, tsubasa().id)
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error).toContain('已经领取')
  })

  it('阵容满 30 人时拒绝领取，不悄悄替换球员', () => {
    const game = readyGame(12347)
    const fill = game.roster[0]
    while (game.roster.length < SQUAD_LIMIT) {
      game.roster.push({ ...structuredClone(fill), id: `fill-${game.roster.length}` })
    }
    const result = claimPeakReward(game, tsubasa().id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('阵容已满')
    expect(game.roster).toHaveLength(SQUAD_LIMIT)
  })
})
