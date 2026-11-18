/**
 * 自由市场的每日补充：每个自然日（北京时间 00:00）开始时，先算当天挂牌的球星 + 被解约 / 合同到期留在市场的球员，
 * 不足 200 人就用当天生成的随机球员补满。随机补充的人带着 marketDay 标记，第二天还没人买就销毁
 * （正在竞拍或球探保护期内的先留着），所以名单不会越滚越大。
 */
import type { GameState, Player, Position } from './types.ts'
import { createRandomPlayer } from './data/random-players.ts'
import { beijingDayIndex } from './calendar.ts'
import { isOnMarketToday } from './market-window.ts'
import { derivedRng, splitSeed } from './rng.ts'
import { scoutKeepsOnMarket } from './scouting.ts'

/** 每天自由市场上至少有多少人。 */
export const FREE_MARKET_TARGET = 200

/** 补充球员的位置配比（和 25 人名单的比例接近）。 */
const FILLER_POSITIONS: Position[] = ['GK', 'CB', 'CB', 'W', 'W', 'W', 'CM', 'CM', 'ST', 'ST', 'CB', 'W', 'CM', 'ST', 'W', 'CM']

type MarketAnchor = Pick<GameState, 'world' | 'createdAt'> & Partial<Pick<GameState, 'season'>>

/** 今天是第几个北京时间自然日。 */
export function marketDayOf(game: MarketAnchor, now: number): number {
  const shift = game.season?.clockShift ?? game.world?.clockShift ?? 0
  return beijingDayIndex(now + shift)
}

export const isDailyFiller = (player: Pick<Player, 'marketDay'>): boolean => player.marketDay !== undefined

/** 只判断池内球员的可用性，不会把已离场的球员放回市场。 */
export function isLocalFreeAgentAvailable(game: GameState, player: Player, now: number): boolean {
  const kept = scoutKeepsOnMarket(game, player.id, now)
  return (player.marketDay === undefined || player.marketDay >= marketDayOf(game, now) || kept) &&
    (kept || isOnMarketToday(game, player, now))
}

/** 被签下的人不再是“当天的补充球员”，不会被销毁。 */
export function keepSignedPlayer(player: Player): void {
  delete player.marketDay
}

/**
 * 刷新今天的自由市场：销毁前几天没人要的补充球员（busy 的先留着），再补到 200 人。
 * 返回新的名单和是否有变化。
 */
export function refreshFreeMarket(input: {
  pool: Player[]
  anchor: MarketAnchor
  now: number
  seed: number
  /** 正在竞拍的人先不销毁。 */
  busy?: (playerId: string) => boolean
}): { pool: Player[]; changed: boolean } {
  const { anchor, now } = input
  const day = marketDayOf(anchor, now)
  let changed = false
  const pool = input.pool.filter((player) => {
    if (player.marketDay === undefined || player.marketDay >= day || input.busy?.(player.id)) return true
    changed = true
    return false
  })
  const visible = pool.filter((player) => input.busy?.(player.id) || isOnMarketToday(anchor, player, now)).length
  const need = FREE_MARKET_TARGET - visible
  if (need <= 0) return { pool, changed }
  const used = new Set(pool.flatMap((player) => [player.name, player.enName]))
  const today = pool.filter((player) => player.marketDay === day).length
  const rng = derivedRng(splitSeed(input.seed, 'free-market-fillers'), day)
  for (let index = today; index < today + need; index++) {
    const roll = rng.float()
    const tier = roll < 0.15 ? 1 : roll < 0.85 ? 2 : 3
    const player = createRandomPlayer({
      seed: splitSeed(input.seed, `free-market-${day}-${index}`),
      position: FILLER_POSITIONS[index % FILLER_POSITIONS.length],
      tier,
      usedNames: used,
      idPrefix: `fa${day}-${index}`,
    })
    player.marketDay = day
    pool.push(player)
  }
  return { pool, changed: true }
}

/** 单机：存档自己的自由市场（联机账号的市场在服务器上，不在这里补）。 */
export function refreshLocalFreeMarket(game: GameState, now: number): boolean {
  if (game.shared || !game.world) return false
  const day = marketDayOf(game, now)
  const busy = (id: string) => scoutKeepsOnMarket(game, id, now)
  if (game.freeMarketDay === day) {
    const pool = game.freeStars.filter(p => p.marketDay === undefined || p.marketDay >= day || busy(p.id))
    if (pool.length === game.freeStars.length) return false
    game.freeStars = pool
    return true
  }
  game.freeMarketDay = day
  const result = refreshFreeMarket({ pool: game.freeStars, anchor: game, now, seed: game.seed, busy })
  if (result.changed) game.freeStars = result.pool
  return true
}
