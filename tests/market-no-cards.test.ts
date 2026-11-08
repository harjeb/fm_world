import { beforeEach, describe, expect, it } from 'vitest'
import { createWorldGame } from '../src/game/world.ts'
import { buyFromClub, clubAsking, bestMarketValue } from '../src/game/market.ts'
import { economyOf } from '../src/game/economy.ts'
import { ALL_ATTRIBUTES } from '../src/game/types.ts'

function stubLocalStorage(): void {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k), clear: () => store.clear() },
  })
}

describe('买入的球员不带卡', () => {
  beforeEach(stubLocalStorage)

  it('从 AI 球队买人：以原始属性入队，AI 给他装的卡不跟着走；价格也只看原始属性', () => {
    const game = createWorldGame(2024)
    const team = game.aiTeams.find((item) => item.players.length > 16)!
    const target = team.players.find((player) => !player.starKey)!
    // 模拟 AI 把他练强并装上了卡
    for (const key of ALL_ATTRIBUTES) target.attrs[key] = Math.min(1500, Math.round(target.attrs[key] * 1.3))
    target.equippedCardId = 'ai-card'
    target.version = 3
    const base = structuredClone(target.baseAttrs)
    const price = clubAsking(game, target)
    expect(price).toBe(Math.round(bestMarketValue(game, target) * 1.5))
    economyOf(game).balance = price * 2
    game.season.round = 1
    expect(buyFromClub(game, team.id, target.id)).toEqual({ ok: true })
    const bought = game.roster.find((player) => player.id === target.id)!
    expect(bought.attrs).toEqual(base)
    expect(bought.equippedCardId).toBeUndefined()
    expect(bought.version).toBe(0)
    expect((game.cards ?? []).filter((card) => card.playerId === target.id)).toHaveLength(0)
  })
})
