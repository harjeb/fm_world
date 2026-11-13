import type { GameState, LeagueBookDrop, Player, PlayerMatchStats, SkillId } from './types.ts'
import { SKILLS } from './data/skills.ts'
import { getSkillTier } from './inheritance.ts'
import { addLegendBook, ensureLegendBooks, hasBookAtOrAbove } from './legend-books.ts'
import { FULL_MATCH_MINUTES } from './condition.ts'
import { derivedRng } from './rng.ts'

/** 踢满 90 分钟的球员掉书概率；按上场分钟线性折算，换人不会增加整场期望。 */
export const LEAGUE_BOOK_DROP_CHANCE = 0.05

export function leagueBookDropChance(minutes: number): number {
  return LEAGUE_BOOK_DROP_CHANCE * Math.max(0, Math.min(1, minutes / FULL_MATCH_MINUTES))
}

export type LeagueBookDropInput = {
  /** 双方锁定名单（含替补）：用来读取技能与档位。 */
  players: readonly Pick<Player, 'id' | 'name' | 'skills' | 'skillTiers'>[]
  stats: readonly PlayerMatchStats[]
  seed: number
  /** 区分账号 / 比赛，保证同一场每个真人球队独立判定且可重放。 */
  label: string
}

function statPlayerId(stat: PlayerMatchStats): string {
  return stat.sourceId ?? stat.playerId.split(':').slice(1).join(':')
}

/**
 * 联赛赛后掉书：场上（上场分钟 > 0）每名球员独立判定，命中后从其尚未收集到（同档或更高档）的技能里随机一项，
 * 按该球员的技能档位入库。不设个数上限；同一场里先掉的书会让后面的同技能同档不再重复。
 */
export function awardLeagueBookDrops(game: GameState, input: LeagueBookDropInput): LeagueBookDrop[] {
  ensureLegendBooks(game)
  const roster = new Map(input.players.map((player) => [player.id, player]))
  const rng = derivedRng(input.seed, 'league-book-drop', input.label)
  const stats = input.stats
    .filter((stat) => stat.minutes > 0)
    .slice()
    .sort((a, b) => a.side.localeCompare(b.side) || statPlayerId(a).localeCompare(statPlayerId(b)))
  const drops: LeagueBookDrop[] = []
  for (const stat of stats) {
    // 每人都消耗一次随机数，结果不受其他人是否有可掉技能影响。
    const roll = rng.float()
    const pickRoll = rng.float()
    if (roll >= leagueBookDropChance(stat.minutes)) continue
    const player = roster.get(statPlayerId(stat))
    if (!player) continue
    const eligible = (player.skills ?? []).filter((id: SkillId) => Object.hasOwn(SKILLS, id) && !hasBookAtOrAbove(game, id, getSkillTier(player, id)))
    if (!eligible.length) continue
    const id = eligible[Math.min(eligible.length - 1, Math.floor(pickRoll * eligible.length))]
    const tier = getSkillTier(player, id)
    if (!addLegendBook(game, id, tier)) continue
    drops.push({ playerId: player.id, playerName: stat.name || player.name, side: stat.side, id, tier, minutes: Math.round(stat.minutes) })
  }
  return drops
}
