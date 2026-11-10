import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { awardLegendReward, ensureLegendBooks, hasLegendBook } from '../src/game/legend-books.ts'
import { LEGEND_SKILL_DROPS } from '../src/game/data/legend-skills.ts'
import { applyPveResult } from '../src/game/pve.ts'
import type { MatchContext, MatchRecord } from '../src/game/types.ts'

const TEAM = 'milan-1988-89'

describe('传奇挑战技能书奖励', () => {
  it('平局给金书，胜利给彩书，重复胜利转球迷', () => {
    const game = createInitialGame(21)
    const skill = LEGEND_SKILL_DROPS[TEAM]
    expect(awardLegendReward(game, TEAM, 'draw', false).book).toEqual({ id: skill, tier: 'gold' })
    expect(hasLegendBook(game, skill, 'gold')).toBe(true)
    const win = awardLegendReward(game, TEAM, 'win', true)
    expect(win.book).toEqual({ id: skill, tier: 'rainbow' })
    expect(hasLegendBook(game, skill, 'rainbow')).toBe(true)
    const fans = game.economy!.fans
    const duplicate = awardLegendReward(game, TEAM, 'win', false)
    expect(duplicate.book).toBeUndefined()
    expect(duplicate.duplicateFans).toBe(800)
    expect(game.economy!.fans).toBe(fans + 800)
    const duplicateAgain = awardLegendReward(game, TEAM, 'win', false)
    expect(duplicateAgain.duplicateFans).toBeUndefined()
    expect(game.economy!.fans).toBe(fans + 800)
    expect(awardLegendReward(game, TEAM, 'draw', false).book).toBeUndefined()
  })

  it('首胜按档位发球迷和资金，且同一场只发一次', () => {
    const game = createInitialGame(22)
    const beforeFans = game.economy!.fans
    const beforeMoney = game.economy!.balance
    const first = awardLegendReward(game, TEAM, 'win', true)
    expect(first.firstWin).toEqual({ fans: 1100, money: 1_200_000 })
    expect(game.economy!.fans).toBe(beforeFans + 1100)
    expect(game.economy!.balance).toBe(beforeMoney + 1_200_000)
    const again = awardLegendReward(game, TEAM, 'win', false)
    expect(again.firstWin).toBeUndefined()
  })

  it('传奇赛果接入进度：胜利发彩书，平局发金书', () => {
    const game = createInitialGame(24)
    const context = { isLeague: false, mode: 'legend', opponentId: `legend-${TEAM}`, homeAway: 'home', seed: 1 } as MatchContext
    const record = (result: 'win' | 'draw', home: number, away: number): MatchRecord => ({ id: `m-${result}`, result, score: { home, away } } as MatchRecord)
    applyPveResult(game, record('win', 2, 1), context)
    expect(game.pve!.legends[TEAM].won).toBe(1)
    expect(hasLegendBook(game, LEGEND_SKILL_DROPS[TEAM], 'rainbow')).toBe(true)
    const drawGame = createInitialGame(25)
    applyPveResult(drawGame, record('draw', 1, 1), context)
    expect(drawGame.pve!.legends[TEAM].drawn).toBe(1)
    expect(hasLegendBook(drawGame, LEGEND_SKILL_DROPS[TEAM], 'gold')).toBe(true)
  })

  it('清掉重复/非法技能书，保证库存只保留 id+tier 一本', () => {
    const game = createInitialGame(23)
    game.legendBooks = [
      { id: 'lg_marathon', tier: 'gold' },
      { id: 'lg_marathon', tier: 'gold' },
      { id: 'not-a-skill' as never, tier: 'rainbow' },
    ]
    expect(ensureLegendBooks(game)).toBe(true)
    expect(game.legendBooks).toHaveLength(1)
  })
})
