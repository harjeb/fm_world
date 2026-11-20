import type { AIClubState, GameState, LegendBook, TrophyRecord } from './types.ts'
import type { SeasonCupId } from './season-cups.ts'
import { SEASON_CUP_REWARDS } from './data/season-cup-rewards.ts'
import { economyOf } from './economy.ts'
import { applyCupCeilingReward } from './cup-rewards.ts'
import { addLegendBook } from './legend-books.ts'

/** 实际上场比赛的双方各得一次；轮空不发，下一场出赛时照常发。 */
export function seasonCupMatchRewardKey(matchId: string): string { return `match:${matchId}` }
export function seasonCupChampionRewardKey(seasonIndex: number, cupId: SeasonCupId): string { return `champion:${seasonIndex}:${cupId}` }

function credit(balance: number, amount: number): number {
  if (!Number.isSafeInteger(balance) || !Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(balance + amount)) throw new Error('杯赛金币余额超出安全范围')
  return balance + amount
}

/** 由服务器在公开比赛时发放，账本与账号存档一同原子保存。 */
export function awardSeasonCupMatch(game: GameState, cupId: SeasonCupId, matchId: string): number {
  if (!game.pve) return 0
  const claims = game.pve.seasonCupGoldClaims ??= {}
  const key = seasonCupMatchRewardKey(matchId)
  if (Object.hasOwn(claims, key)) return 0
  const amount = SEASON_CUP_REWARDS[cupId].appearance
  const economy = economyOf(game)
  economy.balance = credit(economy.balance, amount)
  claims[key] = amount
  return amount
}

/** 每赛季每项冠军追加奖金；奖杯主属性上限取最高值不叠加；传奇杯首次夺冠改发专属彩书《传奇之星》。 */
export function awardSeasonCupChampion(
  game: GameState,
  cupId: SeasonCupId,
  seasonIndex: number,
  trophy: TrophyRecord,
): { gold: number; ceiling: number; book?: LegendBook } {
  if (!game.pve) return { gold: 0, ceiling: 0 }
  const claims = game.pve.seasonCupGoldClaims ??= {}
  const key = seasonCupChampionRewardKey(seasonIndex, cupId)
  if (Object.hasOwn(claims, key)) return { gold: 0, ceiling: 0 }
  const rewardDef = SEASON_CUP_REWARDS[cupId]
  const gold = rewardDef.champion
  const economy = economyOf(game)
  const balance = credit(economy.balance, gold)
  const ceiling = applyCupCeilingReward(game, cupId)
  let book: LegendBook | undefined
  if (rewardDef.book && addLegendBook(game, rewardDef.book.id, rewardDef.book.tier)) {
    book = { ...rewardDef.book }
    trophy.rewardBook = { ...rewardDef.book }
  }
  economy.balance = balance
  claims[key] = gold
  trophy.goldPrize = gold
  if (ceiling) trophy.ceilingBonus = ceiling
  return { gold, ceiling, ...(book ? { book } : {}) }
}

/** 无主电脑球队同样获得金币和俱乐部上限；账本与共享世界一同原子保存。 */
export function awardAISeasonCup(state: AIClubState, cupId: SeasonCupId, matchId: string, seasonIndex: number, champion: boolean): void {
  const claims = state.seasonCupGoldClaims ??= {}
  const matchKey = seasonCupMatchRewardKey(matchId)
  if (!Object.hasOwn(claims, matchKey)) {
    const amount = SEASON_CUP_REWARDS[cupId].appearance
    state.economy.balance = credit(state.economy.balance, amount)
    claims[matchKey] = amount
  }
  const titleKey = seasonCupChampionRewardKey(seasonIndex, cupId)
  if (champion && !Object.hasOwn(claims, titleKey)) {
    const amount = SEASON_CUP_REWARDS[cupId].champion
    state.economy.balance = credit(state.economy.balance, amount)
    claims[titleKey] = amount
    if (SEASON_CUP_REWARDS[cupId].ceiling > 0) (state.cupCeilingClaims ??= {})[cupId] = true
  }
}
