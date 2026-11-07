import { describe, expect, it } from 'vitest'
import { confirmTraining, discardTraining, equipPlayerCard, keepTraining, removePlayerCard, startLeague, startTraining, trainingAction, trainingEventChoice } from '../src/game/actions.ts'
import { cardsOf, ensureCards, equippedCard, playerCards } from '../src/game/cards.ts'
import { eventById } from '../src/game/data/events.ts'
import { FORMATIONS } from '../src/game/data/formations.ts'
import { bestMarketValue, buyFreeAgent, listPlayer, playerMarketValue, settleMarket, suggestedPrice } from '../src/game/market.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { toMatchPlayer } from '../src/game/match/team.ts'
import { validateLineup } from '../src/game/squad.ts'
import { createInitialGame, loadGame, saveGame } from '../src/game/state.ts'
import { economyOf } from '../src/game/economy.ts'
import type { GameState, Player } from '../src/game/types.ts'

/** 把一轮培养跑到结束：只用休息，属性变化靠事件，够区分不同的卡。 */
function finishTraining(game: GameState, playerId: string, seed: number): void {
  const result = startTraining(game, playerId, seed)
  expect(result).toEqual({ ok: true })
  delete game.training[playerId].scheduleVersion
  for (let guard = 0; guard < 200 && !game.training[playerId].completed; guard++) {
    const session = game.training[playerId]
    if (session.pendingEventId) trainingEventChoice(game, playerId, eventById(session.pendingEventId)!.options[0].id)
    else trainingAction(game, playerId, session.action % 3 === 2 ? { kind: 'rest' } : { kind: 'drill', attr: 'passing' })
  }
  expect(game.training[playerId].completed).toBe(true)
}

function fieldPlayer(game: GameState): Player {
  return game.roster.find((player) => player.positions.GK <= 0)!
}

describe('球员卡库存', () => {
  it('培养结束自动入库，换上之前球员属性不变', () => {
    const game = createInitialGame(11)
    const player = fieldPlayer(game)
    const before = structuredClone(player.attrs)
    expect(cardsOf(game)).toHaveLength(0)
    finishTraining(game, player.id, 701)
    const [card] = playerCards(game, player.id)
    expect(card).toBeTruthy()
    expect(card.playerId).toBe(player.id)
    expect(card.version).toBe(1)
    expect(card.attrs.passing).toBeGreaterThan(before.passing)
    expect(player.attrs).toEqual(before)
    expect(player.equippedCardId).toBeUndefined()
    expect(game.training[player.id].cardId).toBe(card.id)
  })

  it('装备后使用卡的属性；体力、精力、伤病不会因为换卡而变化', () => {
    const game = createInitialGame(12)
    const player = fieldPlayer(game)
    finishTraining(game, player.id, 702)
    const [card] = playerCards(game, player.id)
    player.condition = 37
    player.energy = 12
    game.injuries = { [player.seedId]: Date.now() + 1_000_000 }
    const injuryAt = game.injuries[player.seedId]
    expect(equipPlayerCard(game, player.id, card.id)).toEqual({ ok: true })
    expect(player.attrs).toEqual(card.attrs)
    expect(player.positions).toEqual(card.positions)
    expect(player.skills).toEqual(card.skills)
    expect(player.equippedCardId).toBe(card.id)
    expect(player.version).toBe(1)
    expect(player.condition).toBe(37)
    expect(player.energy).toBe(12)
    expect(game.injuries[player.seedId]).toBe(injuryAt)
    expect(equipPlayerCard(game, player.id, null)).toEqual({ ok: true })
    expect(player.attrs).toEqual(player.baseAttrs)
    expect(player.condition).toBe(37)
    expect(player.energy).toBe(12)
    expect(player.equippedCardId).toBeUndefined()
    expect(player.version).toBe(0)
  })

  it('比赛读到的是已装备的卡，开场体力比例只由球员体力决定', () => {
    const game = createInitialGame(13)
    const player = fieldPlayer(game)
    finishTraining(game, player.id, 703)
    const [card] = playerCards(game, player.id)
    player.condition = 50
    const onBase = toMatchPlayer(player, 'home', 'cm_organizer', 'cm', 'CM')
    equipPlayerCard(game, player.id, card.id)
    const onCard = toMatchPlayer(player, 'home', 'cm_organizer', 'cm', 'CM')
    expect(onCard.attrs.passing).toBeGreaterThan(onBase.attrs.passing)
    expect(onBase.stamina / onBase.maxStamina).toBeCloseTo(0.5)
    expect(onCard.stamina / onCard.maxStamina).toBeCloseTo(0.5)
    const input = teamInputFromLineup(game.roster, game.lineup, { id: 'player', name: 'x', color: '#000000', accent: '#ffffff' })
    const inMatch = [...input.starters.map((item) => item.player), ...input.bench].find((item) => item.id === player.id)
    if (inMatch) expect(inMatch.attrs).toEqual(card.attrs)
  })

  it('一名球员可以有多张卡并来回切换，卡本身不会被改写', () => {
    const game = createInitialGame(14)
    const player = fieldPlayer(game)
    finishTraining(game, player.id, 704)
    expect(keepTraining(game, player.id).ok).toBe(true)
    expect(game.training[player.id]).toBeUndefined()
    player.energy = 100
    finishTraining(game, player.id, 705)
    expect(keepTraining(game, player.id).ok).toBe(true)
    const cards = playerCards(game, player.id)
    expect(cards.map((card) => card.serial)).toEqual([1, 2])
    expect(cards[0].id).not.toBe(cards[1].id)
    const snapshot = structuredClone(cards)
    equipPlayerCard(game, player.id, cards[0].id)
    expect(player.attrs).toEqual(snapshot[0].attrs)
    equipPlayerCard(game, player.id, cards[1].id)
    expect(player.attrs).toEqual(snapshot[1].attrs)
    expect(playerCards(game, player.id)).toEqual(snapshot)
  })

  it('每轮都从原始属性开始，和当前装备的卡无关；上一轮的结果不处理也能开始', () => {
    const game = createInitialGame(15)
    const player = fieldPlayer(game)
    const skills = [...player.skills]
    finishTraining(game, player.id, 706)
    const [first] = playerCards(game, player.id)
    player.energy = 100
    // 结果页没处理，直接开始下一轮：新卡留在库存。
    expect(startTraining(game, player.id, 707)).toEqual({ ok: true })
    expect(cardsOf(game)).toHaveLength(1)
    expect(game.training[player.id].candidate.attrs).toEqual(player.baseAttrs)
    delete game.training[player.id]
    // 换上第一张再练：起点还是原始属性，成长不累积。
    equipPlayerCard(game, player.id, first.id)
    player.energy = 100
    expect(startTraining(game, player.id, 708)).toEqual({ ok: true })
    const session = game.training[player.id]
    expect(session.candidate.attrs).toEqual(player.baseAttrs)
    expect(session.candidate.positions).toEqual(player.basePositions)
    expect(session.candidate.skills).toEqual(skills)
    expect(session.candidate.equippedCardId).toBeUndefined()
    expect(player.attrs).toEqual(first.attrs)
    delete game.training[player.id]
    player.energy = 100
    finishTraining(game, player.id, 708)
    const second = playerCards(game, player.id)[1]
    expect(second.version).toBe(1)
    expect(player.attrs).toEqual(first.attrs)
    expect(playerCards(game, player.id)[0]).toEqual(first)
  })

  it('培养中换卡不影响进行中的培养，也不改体力', () => {
    const game = createInitialGame(16)
    const player = fieldPlayer(game)
    finishTraining(game, player.id, 709)
    const [card] = playerCards(game, player.id)
    keepTraining(game, player.id)
    player.energy = 100
    expect(startTraining(game, player.id, 710)).toEqual({ ok: true })
    const candidate = structuredClone(game.training[player.id].candidate.attrs)
    expect(equipPlayerCard(game, player.id, card.id)).toEqual({ ok: true })
    expect(game.training[player.id].candidate.attrs).toEqual(candidate)
  })

  it('confirm 装备新卡，discard 删掉新卡，都会收起结果页', () => {
    const game = createInitialGame(17)
    const player = fieldPlayer(game)
    finishTraining(game, player.id, 711)
    expect(confirmTraining(game, player.id).ok).toBe(true)
    expect(equippedCard(game, player)?.serial).toBe(1)
    expect(game.training[player.id]).toBeUndefined()
    expect(game.candidates[player.id]).toBeUndefined()

    const attrs = structuredClone(player.attrs)
    player.energy = 100
    finishTraining(game, player.id, 712)
    expect(playerCards(game, player.id)).toHaveLength(2)
    expect(discardTraining(game, player.id).ok).toBe(true)
    expect(playerCards(game, player.id)).toHaveLength(1)
    expect(player.attrs).toEqual(attrs)
    expect(game.training[player.id]).toBeUndefined()
    expect(game.candidates[player.id]).toBeUndefined()
  })

  it('只能装备自己的卡，比赛中不能换，正在装备的卡不能删', () => {
    const game = createInitialGame(18)
    const [a, b] = game.roster.filter((player) => player.positions.GK <= 0)
    finishTraining(game, a.id, 713)
    const [card] = playerCards(game, a.id)
    expect(equipPlayerCard(game, b.id, card.id).ok).toBe(false)
    expect(equipPlayerCard(game, a.id, 'card-none').ok).toBe(false)
    expect(equipPlayerCard(game, 'nobody', card.id).ok).toBe(false)
    expect(equipPlayerCard(game, a.id, card.id).ok).toBe(true)
    expect(removePlayerCard(game, card.id).ok).toBe(false)
    expect(playerCards(game, a.id)).toHaveLength(1)
    expect(equipPlayerCard(game, a.id, null).ok).toBe(true)
    expect(startLeague(game).ok).toBe(true)
    expect(equipPlayerCard(game, a.id, card.id).ok).toBe(false)
    expect(a.equippedCardId).toBeUndefined()
    game.activeMatch = undefined
    expect(removePlayerCard(game, card.id).ok).toBe(true)
    expect(playerCards(game, a.id)).toHaveLength(0)
  })

  it('新卡在当前首发位置熟练度为 0 也能换上，阵容仍然合法，靠属性折损体现代价', () => {
    const game = createInitialGame(19)
    const formation = FORMATIONS[game.lineup.formationId]
    const starter = game.lineup.starters.find((item) => formation.slots.find((slot) => slot.id === item.slotId)?.position !== 'GK')!
    const slot = formation.slots.find((item) => item.id === starter.slotId)!
    const player = game.roster.find((item) => item.id === starter.playerId)!
    finishTraining(game, player.id, 714)
    const [card] = playerCards(game, player.id)
    card.positions[slot.position] = 0
    const lineup = structuredClone(game.lineup)
    expect(equipPlayerCard(game, player.id, card.id)).toEqual({ ok: true })
    expect(player.positions[slot.position]).toBe(0)
    expect(game.lineup).toEqual(lineup)
    const check = validateLineup(game.roster, game.lineup)
    expect(check.valid).toBe(true)
    expect(check.warnings.some((text) => text.includes(player.name))).toBe(true)
  })

  it('换回原始属性时恢复原始技能', () => {
    const game = createInitialGame(20)
    const player = fieldPlayer(game)
    const skills = [...player.skills]
    finishTraining(game, player.id, 715)
    const [card] = playerCards(game, player.id)
    card.skills = [...card.skills, 'injury_prevention']
    equipPlayerCard(game, player.id, card.id)
    expect(player.skills).toContain('injury_prevention')
    equipPlayerCard(game, player.id, null)
    expect(player.skills).toEqual(skills)
  })

  it('球员离队时卡留在库存；回队后装备关系还在', () => {
    const game = createInitialGame(21)
    const inLineup = new Set([...game.lineup.starters.map((item) => item.playerId), ...game.lineup.bench])
    const player = game.roster.find((item) => !inLineup.has(item.id))!
    finishTraining(game, player.id, 716)
    const [card] = playerCards(game, player.id)
    confirmTraining(game, player.id)
    expect(listPlayer(game, player.id, suggestedPrice(game, player))).toEqual({ ok: true })
    settleMarket(game, game.season.round)
    expect(game.roster.some((item) => item.id === player.id)).toBe(false)
    expect(playerCards(game, player.id)).toHaveLength(1)
    expect(equipPlayerCard(game, player.id, card.id).ok).toBe(false)
    economyOf(game).balance = 100_000_000
    expect(buyFreeAgent(game, player.id).ok).toBe(true)
    const back = game.roster.find((item) => item.id === player.id)!
    expect(equippedCard(game, back)?.id).toBe(card.id)
    expect(back.attrs).toEqual(card.attrs)
  })

  it('估值按他最好的一张卡算，不看现在装备哪张；买回也用同一个数，来回倒卖不赚钱', () => {
    const game = createInitialGame(24)
    const inLineup = new Set([...game.lineup.starters.map((item) => item.playerId), ...game.lineup.bench])
    const player = game.roster.find((item) => !inLineup.has(item.id))!
    const baseValue = playerMarketValue(player)
    finishTraining(game, player.id, 719)
    keepTraining(game, player.id)
    const [card] = playerCards(game, player.id)
    const best = playerMarketValue(card)
    expect(best).toBeGreaterThan(baseValue)
    // 没装备最好的卡，估值也按它算；身上的属性不变。
    expect(player.equippedCardId).toBeUndefined()
    expect(bestMarketValue(game, player)).toBe(best)
    expect(playerMarketValue(player)).toBe(baseValue)
    expect(suggestedPrice(game, player)).toBe(Math.round(best * 0.9))
    expect(listPlayer(game, player.id, best + 1).ok).toBe(false)
    const balance = economyOf(game).balance
    const price = suggestedPrice(game, player)
    expect(listPlayer(game, player.id, price)).toEqual({ ok: true })
    expect(settleMarket(game, game.season.round)).toBe(price)
    // 离队带走的是当时装备的属性（这里是原始属性），卡留在库存。
    const gone = game.freeStars.find((item) => item.id === player.id)!
    expect(gone.attrs).toEqual(gone.baseAttrs)
    expect(playerCards(game, player.id)).toHaveLength(1)
    // 买回按最好的卡计价：一买一卖净亏一成。先补足余额，避免新身价把账户卡住。
    economyOf(game).balance = best * 2
    expect(buyFreeAgent(game, player.id)).toEqual({ ok: true })
    expect(economyOf(game).balance).toBe(best * 2 - best)
    expect(economyOf(game).balance).toBeLessThan(best * 2)
  })

  it('旧存档：已确认的成品和待确认的候选都进库存，重复处理不会多出来', () => {
    const game = createInitialGame(22)
    const [trained, waiting] = game.roster.filter((player) => player.positions.GK <= 0)
    trained.version = 2
    trained.attrs.passing += 100
    finishTraining(game, waiting.id, 717)
    // 模拟旧存档：没有库存、结果页对应的卡也不存在。
    delete game.cards
    delete game.cardSeq
    delete game.training[waiting.id].cardId
    expect(ensureCards(game)).toBe(true)
    const trainedCard = equippedCard(game, trained)!
    expect(trainedCard.version).toBe(2)
    expect(trainedCard.attrs).toEqual(trained.attrs)
    expect(playerCards(game, waiting.id)).toHaveLength(1)
    expect(game.training[waiting.id].cardId).toBe(playerCards(game, waiting.id)[0].id)
    expect(cardsOf(game)).toHaveLength(2)
    expect(ensureCards(game)).toBe(false)
    expect(cardsOf(game)).toHaveLength(2)
  })

  it('存档读回后库存和装备关系不变', () => {
    const storage = new Map<string, string>()
    const original = globalThis.localStorage
    globalThis.localStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value), removeItem: (key: string) => void storage.delete(key) } as unknown as Storage
    try {
      const game = createInitialGame(23)
      const player = fieldPlayer(game)
      finishTraining(game, player.id, 718)
      confirmTraining(game, player.id)
      saveGame(game)
      const loaded = loadGame()!
      expect(loaded.cards).toEqual(game.cards)
      const again = loaded.roster.find((item) => item.id === player.id)!
      expect(equippedCard(loaded, again)?.attrs).toEqual(again.attrs)
    } finally {
      globalThis.localStorage = original
    }
  })
})
