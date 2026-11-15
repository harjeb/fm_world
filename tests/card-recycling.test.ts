import { describe, expect, it } from 'vitest'
import { startTraining, startTrainingWithSupport, discardTraining } from '../src/game/actions.ts'
import { cardRecyclePoints, deleteCard, ensureCards, equipCard, recyclePlayerCards, setCardRecycleLock } from '../src/game/cards.ts'
import { caOf } from '../src/game/ca.ts'
import { createInitialGame } from '../src/game/state.ts'
import { createTrainingSession, expectedQualityMultiplier, trainingQuality, trainingQualityChances } from '../src/game/training.ts'
import { ALL_ATTRIBUTES, type GameState, type PlayerCard } from '../src/game/types.ts'

function card(game: GameState, id: string): PlayerCard {
  const p = game.roster[0]
  return { id, playerId: 'departed', playerName: p.name, serial: 1, version: 1, routeId: null, createdAt: 0, attrs: { ...p.attrs }, positions: { ...p.positions }, personality: { ...p.personality }, skills: [...p.skills] }
}

function atCa(c: PlayerCard, target: number) {
  let lo = 0, hi = 10000
  for (let i = 0; i < 70; i++) {
    const mid = (lo + hi) / 2
    for (const key of ALL_ATTRIBUTES) c.attrs[key] = mid
    if (caOf(c.attrs, c.positions.GK > 0) < target) lo = mid
    else hi = mid
  }
  for (const key of ALL_ATTRIBUTES) c.attrs[key] = (lo + hi) / 2
}

describe('shared card recycling', () => {
  it('rounds CA before applying 100-point boundaries, including goalkeeper and ownerless cards', () => {
    const game = createInitialGame(11)
    const a = card(game, 'a'), b = card(game, 'b'), c = card(game, 'c')
    a.positions.GK = 0; b.positions.GK = 1; c.positions.GK = 0
    atCa(a, 199.49); atCa(b, 199.51); atCa(c, 0)
    game.cards = [a, b, c]
    expect(recyclePlayerCards(game, ['a', 'b', 'c'])).toEqual({ ok: true, points: 4, count: 3 })
    expect(game.trainingPoints).toBe(4)
    expect(game.cards).toEqual([])
  })

  it('is atomic for duplicate, missing, equipped, locked, pending, malformed and overflow cases', () => {
    const game = createInitialGame(12)
    const a = card(game, 'a'), b = card(game, 'b')
    game.cards = [a, b]
    const check = (ids: string[]) => { const before = structuredClone(game); expect(recyclePlayerCards(game, ids).ok).toBe(false); expect(game).toEqual(before) }
    check([]); check(['a', 'a']); check(['a', 'missing'])
    game.roster[1].equippedCardId = 'b'; check(['a', 'b']); delete game.roster[1].equippedCardId
    b.recycleLocked = true; check(['a', 'b']); b.recycleLocked = false
    const s = createTrainingSession(game.roster[0], 1); s.cardId = 'b'; game.training.other = s
    check(['a', 'b']); delete game.training.other
    b.attrs.passing = NaN; check(['a', 'b']); b.attrs.passing = 1
    game.trainingPoints = Number.MAX_SAFE_INTEGER; check(['a'])
    game.trainingPoints = -1; check(['a'])
  })

  it('migrates a pre-card save and recycles its unequipped legacy result without bonus fields', () => {
    const game = createInitialGame(14)
    const player = game.roster.find((item) => item.positions.GK === 0)!
    player.version = 2
    player.attrs.passing += 100
    delete game.cards
    delete game.cardSeq
    delete game.trainingPoints
    expect(ensureCards(game)).toBe(true)
    const card = game.cards!.find((item) => item.playerId === player.id)!
    expect(card.recycleLocked).toBeUndefined()
    const value = cardRecyclePoints(card)!
    expect(recyclePlayerCards(game, [card.id]).ok).toBe(false)
    expect(equipCard(game, player.id, null).ok).toBe(true)
    expect(recyclePlayerCards(game, [card.id])).toMatchObject({ ok: true, points: value })
    expect(game.trainingPoints).toBe(value)
  })

  it('locks and unlocks even equipped cards without deleting them', () => {
    const game = createInitialGame(13); const a = card(game, 'a'); game.cards = [a]
    game.roster[0].equippedCardId = 'a'
    expect(setCardRecycleLock(game, 'a', true)).toEqual({ ok: true })
    expect(a.recycleLocked).toBe(true)
    delete game.roster[0].equippedCardId
    expect(deleteCard(game, 'a')).toEqual({ ok: false, error: '这张卡已锁定，请先解锁' })
    expect(setCardRecycleLock(game, 'a', false)).toEqual({ ok: true })
    expect(a.recycleLocked).toBe(false)
    expect(setCardRecycleLock(game, 'missing', true).ok).toBe(false)
  })
})

describe('training quality points', () => {
  it('debits only successful starts and cancellation forfeits points', () => {
    const game = createInitialGame(21); const p = game.roster[0]; game.trainingPoints = 30
    const before = structuredClone(game)
    expect(startTraining(game, p.id, 123, [], 15).ok).toBe(false); expect(game).toEqual(before)
    expect(startTraining(game, p.id, 123, ['missing'], 10).ok).toBe(false); expect(game).toEqual(before)
    p.energy = 0; delete p.energyAt
    const tired = structuredClone(game)
    expect(startTraining(game, p.id, 123, [], 10).ok).toBe(false); expect(game).toEqual(tired)
    p.energy = 100
    expect(startTraining(game, p.id, 123, [], 20).ok).toBe(true)
    expect(game.trainingPoints).toBe(10); expect(game.training[p.id].qualityBonusPoints).toBe(20)
    expect(startTraining(game, p.id, 123, [], 10).ok).toBe(false); expect(game.trainingPoints).toBe(10)
    // The result-page discard cannot cancel a still-running session; losing the
    // session for any other reason still cannot refund its already spent points.
    discardTraining(game, p.id); expect(game.trainingPoints).toBe(10)
    delete game.training[p.id]
    expect(game.trainingPoints).toBe(10)
    expect(startTraining(game, p.id, 123, [], 20).ok).toBe(false)
  })

  it('shares points from one player’s cards with another player', () => {
    const game = createInitialGame(24)
    const owner = game.roster[0], trainee = game.roster[1]
    const a = card(game, 'shared-a'), b = card(game, 'shared-b')
    a.playerId = owner.id; b.playerId = owner.id
    atCa(a, 500); atCa(b, 500)
    game.cards = [a, b]
    expect(recyclePlayerCards(game, ['shared-a', 'shared-b'])).toMatchObject({ ok: true, points: 10 })
    expect(startTrainingWithSupport(game, trainee.id, 42, [], 10).ok).toBe(true)
    expect(game.trainingPoints).toBe(0)
    expect(game.training[trainee.id].qualityBonusPoints).toBe(10)
  })

  it('supports partner starts and defaults legacy saves to zero', () => {
    const game = createInitialGame(22); const p = game.roster[0]
    expect(startTrainingWithSupport(game, p.id, 42, [], 10).ok).toBe(false)
    expect(game.trainingPoints).toBeUndefined()
    game.trainingPoints = 10
    expect(startTrainingWithSupport(game, p.id, 42, [], 10).ok).toBe(true)
    expect(game.trainingPoints).toBe(0); expect(game.training[p.id].qualityBonusPoints).toBe(10)
  })

  it('uses the advertised distribution in real rolls without downgrading a higher tier', () => {
    const game = createInitialGame(25)
    const session = createTrainingSession(game.roster[0], 1)
    session.candidate.skills = []; session.candidate.skillTiers = {}
    const tiers = [0, 10, 20, 30] as const
    const counts = tiers.map(() => ({ great: 0, perfect: 0 }))
    const rank: Record<string, number> = { 失败: 0, 一般: 1, 成功: 2, 大成功: 3, 完美成功: 4 }
    for (let seed = 0; seed < 4096; seed++) {
      session.seed = seed
      let previous = 0
      tiers.forEach((points, i) => {
        session.qualityBonusPoints = points
        const quality = trainingQuality(session)
        expect(rank[quality.label]).toBeGreaterThanOrEqual(previous)
        previous = rank[quality.label]
        if (quality.label === '大成功') counts[i].great++
        if (quality.label === '完美成功') counts[i].perfect++
      })
    }
    for (const [i, great, perfect] of [[0, .1, .02], [1, .15, .03], [2, .2, .04], [3, .3, .06]] as const) {
      expect(Math.abs(counts[i].great / 4096 - great)).toBeLessThan(0.025)
      expect(Math.abs(counts[i].perfect / 4096 - perfect)).toBeLessThan(0.015)
    }
  })

  it('uses all tiers, stacks fast learner, keeps low stamina rules, and preserves deterministic rolls', () => {
    const game = createInitialGame(23); const session = createTrainingSession(game.roster[0], 999)
    session.candidate.skills = []; session.candidate.skillTiers = {}
    const old = trainingQualityChances(session)
    for (const [points, great, perfect] of [[0, .1, .02], [10, .15, .03], [20, .2, .04], [30, .3, .06]] as const) {
      session.qualityBonusPoints = points
      const chance = trainingQualityChances(session)
      expect(chance.great).toBeCloseTo(great); expect(chance.perfect).toBeCloseTo(perfect)
      expect(Object.values(chance).reduce((a, b) => a + b, 0)).toBeCloseTo(1)
      expect(expectedQualityMultiplier(session)).toBeCloseTo(chance.plain * .7 + chance.success + chance.great * 1.3 + chance.perfect * 1.6)
      expect(trainingQuality(session)).toEqual(trainingQuality(structuredClone(session)))
    }
    delete session.qualityBonusPoints; expect(trainingQualityChances(session)).toEqual(old)
    session.qualityBonusPoints = 30; session.candidate.skills = ['lg_fast_learner']; session.candidate.skillTiers = { lg_fast_learner: 'gold' }
    expect(trainingQualityChances(session).great).toBeCloseTo(.35)
    expect(trainingQualityChances(session).perfect).toBeCloseTo(.11)
    const low = trainingQualityChances(session, 30)
    expect(low.great).toBe(0); expect(low.perfect).toBe(0); expect(low.failure).toBeCloseTo(.05)
    expect(low.plain).toBeCloseTo(.2); expect(Object.values(low).reduce((a, b) => a + b, 0)).toBeCloseTo(1)
  })
})
