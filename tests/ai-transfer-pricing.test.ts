import { describe, expect, it } from 'vitest'
import { agentView, playerView } from '../server/agent.ts'
import { createInitialGame } from '../src/game/state.ts'
import { caOf } from '../src/game/ca.ts'
import { mainAttrsFor } from '../src/game/scale.ts'
import { untrainedPlayer } from '../src/game/cards.ts'
import { aiTransferOffers, bestMarketValue, clubSaleTerms, previewClubSigning, signClubPlayer } from '../src/game/market.ts'
import { negotiationDemands } from '../src/game/negotiation.ts'
import { economyOf } from '../src/game/economy.ts'

function equippedSeller() {
  const game = createInitialGame(710)
  game.season.tier = 'division2'
  const { team, player } = game.aiTeams.flatMap(team => team.players.map(player => ({ team, player })))
    .find(({ team, player }) => player.positions.GK === 0 && caOf(player.baseAttrs, false) < 245 && !team.lineup.starters.some(starter => starter.playerId === player.id))!
  player.age = 31
  const base = untrainedPlayer(player)
  for (const key of mainAttrsFor(false)) player.attrs[key] = 1400
  player.equippedCardId = 'ai-equipped-card'
  player.version = 3
  return { game, team, player, base }
}

describe('AI transfer base-player pricing', () => {
  it('uses base value for asking prices, transfer lists, previews and player demands', () => {
    const { game, team, player, base } = equippedSeller()
    expect(caOf(base.attrs, false)).toBeLessThan(245)
    expect(caOf(player.attrs, false)).toBeGreaterThan(300)
    const expected = clubSaleTerms(game, team, base)
    const before = structuredClone(player)
    expect(clubSaleTerms(game, team, player)).toEqual(expected)
    const listed = aiTransferOffers(game).find(entry => entry.player.id === player.id)!
    expect(listed.asking).toBe(expected.asking)
    expect(listed.terms.value).toBe(bestMarketValue(game, player))
    const preview = previewClubSigning(game, team, player, expected.asking!, { goal: 'title', role: 'star' })
    expect(preview.asking).toBe(expected.asking)
    expect(preview.value).toBe(expected.value)
    expect(negotiationDemands(game, player)).toEqual(negotiationDemands(game, base))
    expect(player).toEqual(before)
  })

  it('exposes the original player in Agent transfer listings without changing equipped match attributes', () => {
    const { game, player, base } = equippedSeller()
    const before = structuredClone(player)
    const listed = agentView(game).market.clubOffers.find((entry) => entry.player.id === player.id)!.player
    expect(listed.ca).toBe(caOf(base.attrs, false))
    expect(listed.ca).toBe(listed.initialCA)
    expect(listed.equippedCardId).toBeNull()
    for (const key of mainAttrsFor(false)) expect(listed.attrs[key]).toBe(base.attrs[key])
    expect(listed.skills).toEqual(base.skills)
    expect(playerView(player, game, 0).ca).toBeGreaterThan(listed.ca)
    expect(player).toEqual(before)
  })

  it('charges a successful base-price negotiation and delivers the original player without a card', () => {
    const { game, team, player, base } = equippedSeller()
    const asking = clubSaleTerms(game, team, base).asking!
    const economy = economyOf(game)
    economy.balance = 100_000_000
    let bought = false
    for (let multiplier = 2; multiplier <= 8; multiplier++) {
      const offer = asking * multiplier
      const balance = economy.balance
      const result = signClubPlayer(game, team.id, player.id, offer, { goal: 'title', role: 'star' })
      if (!result.ok) { expect(economy.balance).toBe(balance); continue }
      expect(economy.balance).toBe(balance - offer)
      const signed = game.roster.find(entry => entry.id === player.id)!
      expect(signed.attrs).toEqual(base.attrs)
      expect(signed.equippedCardId).toBeUndefined()
      expect(signed.version).toBe(0)
      bought = true
      break
    }
    expect(bought).toBe(true)
  })
})
