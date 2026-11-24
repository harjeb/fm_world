import { describe, expect, it } from 'vitest'
import { agentView, playerView } from '../server/agent.ts'
import { createInitialGame } from '../src/game/state.ts'
import { caOf } from '../src/game/ca.ts'
import { mainAttrsFor } from '../src/game/scale.ts'
import { untrainedPlayer } from '../src/game/cards.ts'
import { aiTransferOffers, bestMarketValue, clubSaleTerms, previewClubSigning, sellerSquadError, signClubPlayer } from '../src/game/market.ts'
import { DEPTH_SHORTAGE_PREMIUM } from '../src/game/transfer-rules.ts'
import { analyzeAIDepth } from '../src/game/ai-depth.ts'
import { DEFAULT_FORMATION, FORMATIONS } from '../src/game/data/formations.ts'
import { DETAILED_POSITIONS, DETAILED_TO_POSITION, detailedPositionForSlot } from '../src/game/detailed-positions.ts'
import { attrStorage } from '../src/game/scale.ts'
import { refreshAILineup, validateLineup } from '../src/game/squad.ts'
import type { DetailedPosition, Player } from '../src/game/types.ts'
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

  it('allows depth-shortage backups to be negotiated at a high premium while keeping starters and 2-GK floors blocked', () => {
    const game = createInitialGame(711)
    game.season.tier = 'champions'
    const team = game.aiTeams[0]
    const slots = FORMATIONS[DEFAULT_FORMATION].slots.map(detailedPositionForSlot)
    const sample = team.players.find((p) => !p.positions.GK)!
    const makePlayer = (id: string, pos: DetailedPosition, attr: number): Player => {
      const p = structuredClone(sample)
      p.id = p.name = id
      p.age = 27
      p.positions = { GK: 0, CB: 0, CM: 0, W: 0, ST: 0 }
      p.detailedPositions = Object.fromEntries(DETAILED_POSITIONS.map((k) => [k, k === pos ? 100 : 0]))
      p.positions[DETAILED_TO_POSITION[pos]] = 100
      for (const key of Object.keys(p.attrs) as (keyof Player['attrs'])[]) p.attrs[key] = attrStorage(key, attr, pos === 'GK')
      p.baseAttrs = { ...p.attrs }
      p.basePositions = { ...p.positions }
      p.baseDetailedPositions = { ...p.detailedPositions }
      delete p.equippedCardId
      p.version = 0
      return p
    }
    team.lineup.formationId = DEFAULT_FORMATION
    // 刚好两套阵容（22 人，无富余），首发属性高于替补。
    team.players = [
      ...slots.map((pos, i) => makePlayer(`starter-${pos}-${i}`, pos, 55)),
      ...slots.map((pos, i) => makePlayer(`sub-${pos}-${i}`, pos, 35)),
    ]
    refreshAILineup(team)
    const depth = analyzeAIDepth(team)
    expect(depth.missing).toBe(0)
    expect(depth.expendable.size).toBe(0)

    const starterST = team.players.find((p) => p.id.startsWith('starter-ST'))!
    const subST = team.players.find((p) => p.id.startsWith('sub-ST'))!
    const subGK = team.players.find((p) => p.id.startsWith('sub-GK'))!

    // 缺少替代者的主力与仅剩两门将时的替补门将仍是非卖品。
    expect(sellerSquadError(team, starterST, depth)).toContain('非卖品')
    expect(sellerSquadError(team, subGK, depth)).toContain('门将')

    // 缺少替代者的非首发外场替补允许谈判，但俱乐部要价叠加额外高溢价。
    expect(sellerSquadError(team, subST, depth)).toBeNull()
    const baseTerms = clubSaleTerms(game, { lineup: team.lineup }, subST)
    const shortageTerms = clubSaleTerms(game, team, subST, depth)
    expect(shortageTerms.requiredPremium).toBeCloseTo(baseTerms.requiredPremium! + DEPTH_SHORTAGE_PREMIUM, 6)
    expect(shortageTerms.asking!).toBeGreaterThan(baseTerms.asking!)
    expect(shortageTerms.reasons.some((reason) => reason.includes('+80%'))).toBe(true)

    const listed = aiTransferOffers(game).find((entry) => entry.team.id === team.id && entry.player.id === subST.id)!
    expect(listed.blocked).toBeNull()
    expect(listed.asking).toBe(shortageTerms.asking)

    // 给足溢价后能够成交，且卖方仍保有一套合法首发。
    const economy = economyOf(game)
    economy.balance = 500_000_000
    let bought = false
    for (let multiplier = 1; multiplier <= 6; multiplier++) {
      const offer = Math.round(shortageTerms.asking! * (1 + multiplier * 0.25))
      const result = signClubPlayer(game, team.id, subST.id, offer, { goal: 'title', role: 'star' })
      if (!result.ok) continue
      bought = true
      break
    }
    expect(bought).toBe(true)
    expect(game.roster.some((p) => p.id === subST.id)).toBe(true)
    expect(validateLineup(team.players, team.lineup).valid).toBe(true)
  })
})
