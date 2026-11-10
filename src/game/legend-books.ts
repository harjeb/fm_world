import type { GameState, LegendBook, LegendBookTier, LegendSkillId, SkillTier } from './types.ts'
import { LEGEND_SKILLS, LEGEND_SKILL_DROPS } from './data/legend-skills.ts'
import { LEGEND_TEAMS } from './data/legend-teams.ts'
import { economyOf, MAX_FANS } from './economy.ts'

const TIER_REWARD: Record<string, { fans: number; money: number }> = {
  'S+': { fans: 2000, money: 2_200_000 },
  S: { fans: 1100, money: 1_200_000 },
  A: { fans: 600, money: 600_000 },
  B: { fans: 300, money: 300_000 },
}

export function ensureLegendBooks(game: GameState): boolean {
  let changed = false
  if (!Array.isArray(game.legendBooks)) {
    game.legendBooks = []
    changed = true
  }
  if (!game.legendRepeatFans || typeof game.legendRepeatFans !== 'object' || Array.isArray(game.legendRepeatFans)) {
    game.legendRepeatFans = {}
    changed = true
  }
  const seen = new Set<string>()
  const valid = game.legendBooks.filter((book) => {
    if (!book || !Object.hasOwn(LEGEND_SKILLS, book.id) || (book.tier !== 'gold' && book.tier !== 'rainbow')) return false
    const key = `${book.id}:${book.tier}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (valid.length !== game.legendBooks.length) {
    game.legendBooks = valid
    changed = true
  }
  return changed
}

export function hasLegendBook(game: GameState, id: LegendSkillId, tier?: LegendBookTier): boolean {
  return !!game.legendBooks?.some((book) => book.id === id && (tier === undefined || book.tier === tier))
}

export function addLegendBook(game: GameState, id: LegendSkillId, tier: LegendBookTier): boolean {
  ensureLegendBooks(game)
  if (hasLegendBook(game, id, tier)) return false
  game.legendBooks!.push({ id, tier })
  return true
}

/** 把库存里的书标记成学会的档位（书本身不消耗）。 */
export function learnedSkillTier(book: LegendBook): SkillTier {
  return book.tier
}

export type LegendReward = {
  book?: LegendBook
  duplicateFans?: number
  firstWin?: { fans: number; money: number }
}

/**
 * 传奇挑战赛果奖励：胜=彩书，平=金书；重复彩书转球迷；首胜额外发球迷/资金。
 * `firstWin` 必须在更新 PveLegendRecord.won 之前取。
 */
export function awardLegendReward(game: GameState, legendId: string, result: 'win' | 'draw' | 'loss', firstWin: boolean): LegendReward {
  ensureLegendBooks(game)
  const skillId = LEGEND_SKILL_DROPS[legendId]
  if (!skillId) return {}
  const reward: LegendReward = {}
  if (result === 'win') {
    if (hasLegendBook(game, skillId, 'rainbow')) {
      // 彩书后的球迷补偿每个传奇队只发一次，避免反复刷同一队。
      if (!game.legendRepeatFans?.[legendId]) {
        const economy = economyOf(game)
        const before = economy.fans
        economy.fans = Math.min(MAX_FANS, before + 800)
        reward.duplicateFans = economy.fans - before
        game.legendRepeatFans ??= {}
        game.legendRepeatFans[legendId] = true
      }
    } else if (addLegendBook(game, skillId, 'rainbow')) {
      reward.book = { id: skillId, tier: 'rainbow' }
    }
  } else if (result === 'draw') {
    if (!hasLegendBook(game, skillId, 'rainbow') && !hasLegendBook(game, skillId, 'gold')) {
      if (addLegendBook(game, skillId, 'gold')) reward.book = { id: skillId, tier: 'gold' }
    }
  }
  if (firstWin && result === 'win') {
    const def = LEGEND_TEAMS.find((team) => team.id === legendId)
    const rewardDef = TIER_REWARD[def?.tier ?? 'B'] ?? TIER_REWARD.B
    const economy = economyOf(game)
    const beforeFans = economy.fans
    economy.fans = Math.min(MAX_FANS, beforeFans + rewardDef.fans)
    economy.balance += rewardDef.money
    reward.firstWin = { fans: economy.fans - beforeFans, money: rewardDef.money }
  }
  return reward
}

export function legendBookLabel(book: LegendBook): string {
  return LEGEND_SKILLS[book.id].name
}
