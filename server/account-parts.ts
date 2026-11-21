import { createHash } from 'node:crypto'
import type { AITeam, Fixture, GameState, MatchRecord, Player, SeasonState } from '../src/game/types.ts'
import type { SeasonCups } from '../src/game/season-cups.ts'
import { slimMatchRecord } from './state-sync.ts'

export type AccountPart = { slot: string; hash: string; json: string }

export type MatchRecordDetail = Pick<
  MatchRecord,
  'commentary' | 'keyEvents' | 'skillStats' | 'failureStats' | 'goalDetails' | 'instructions' | 'lineup' | 'decisionStats'
>

export type MatchDetailWrite = { matchId: string; detailJson: string }
export type SeasonFixturesWrite = { seasonIndex: number; fixturesJson: string }
export type AccountColdExtracts = {
  matchDetails: MatchDetailWrite[]
  seasonFixtures: SeasonFixturesWrite[]
  mutated: boolean
}

/** 不可变冻结部件的序列化缓存：避免每次保存账号都重复 JSON.stringify + SHA-256 相同的共享对象。 */
const frozenPartCache = new WeakMap<object, { hash: string; json: string }>()

export function hasInlineMatchDetail(record: MatchRecord | undefined): boolean {
  if (!record || record.detailDeferred) return false
  return Boolean(
    record.commentary?.length
    || record.keyEvents?.length
    || record.skillStats?.length
    || record.failureStats?.length
    || record.goalDetails?.length
    || record.instructions?.length
    || record.lineup?.starters?.length
    || record.lineup?.bench?.length
    || record.decisionStats,
  )
}

/**
 * 将账号内存里的重历史明细拆离到 SQLite 冷存储格式：
 * - matchHistory / challengeHistory 中的文字解说、关键事件、技能统计等拆成 MatchDetailWrite，内存保留精简摘要（detailDeferred: true）；
 * - seasonHistory 中每季 380 场旧赛程拆成 SeasonFixturesWrite，内存保留积分榜/名次/冠军摘要。
 */
export function extractAccountColdData(game: GameState): AccountColdExtracts {
  const matchDetails: MatchDetailWrite[] = []
  const seasonFixtures: SeasonFixturesWrite[] = []
  let mutated = false

  const extractRecords = (records: MatchRecord[] | undefined) => {
    if (!Array.isArray(records)) return
    for (let i = 0; i < records.length; i++) {
      const record = records[i]
      if (!hasInlineMatchDetail(record)) continue
      const detail: MatchRecordDetail = {
        ...(record.commentary !== undefined ? { commentary: record.commentary } : {}),
        keyEvents: record.keyEvents ?? [],
        skillStats: record.skillStats ?? [],
        failureStats: record.failureStats ?? [],
        goalDetails: record.goalDetails ?? [],
        instructions: record.instructions ?? [],
        lineup: record.lineup,
        ...(record.decisionStats !== undefined ? { decisionStats: record.decisionStats } : {}),
      }
      matchDetails.push({ matchId: record.id, detailJson: JSON.stringify(detail) })
      records[i] = slimMatchRecord(record)
      mutated = true
    }
  }

  extractRecords(game.matchHistory)
  extractRecords(game.challengeHistory)

  if (Array.isArray(game.seasonHistory)) {
    for (let i = 0; i < game.seasonHistory.length; i++) {
      const season = game.seasonHistory[i]
      if (!season || !Array.isArray(season.fixtures) || season.fixtures.length === 0) continue
      seasonFixtures.push({ seasonIndex: season.index, fixturesJson: JSON.stringify(season.fixtures) })
      game.seasonHistory[i] = { ...season, fixtures: [] }
      mutated = true
    }
  }

  return { matchDetails, seasonFixtures, mutated }
}

export function hydrateMatchRecord(summary: MatchRecord, detailJson: string | null | undefined): MatchRecord {
  if (!detailJson) return summary
  try {
    const detail = JSON.parse(detailJson) as MatchRecordDetail
    const full: MatchRecord = { ...summary, ...detail }
    delete full.detailDeferred
    return full
  } catch {
    return summary
  }
}

export function hydrateSeasonHistoryEntry(entry: SeasonState, fixturesJson: string | null | undefined): SeasonState {
  if (!fixturesJson || (Array.isArray(entry.fixtures) && entry.fixtures.length > 0)) return entry
  try {
    return { ...entry, fixtures: JSON.parse(fixturesJson) as Fixture[] }
  } catch {
    return entry
  }
}

/** Exact, immutable snapshots. Never rebuild a saved fixture or opponent from today's live world. */
export function packAccountGame(game: GameState, compact: boolean): { json: string; parts: AccountPart[] } {
  const reference: GameState & { __accountPartsV1?: number } = { ...game }
  delete reference.__accountPartsV1
  if (!compact || !game.shared || !Array.isArray(game.world?.divisions) || !Array.isArray(game.aiTeams)) return { json: JSON.stringify(reference), parts: [] }
  const parts: AccountPart[] = []
  const put = (slot: string, value: unknown) => {
    const cached = value && typeof value === 'object' ? frozenPartCache.get(value) : undefined
    if (cached) {
      parts.push({ slot, hash: cached.hash, json: cached.json })
      return
    }
    const json = JSON.stringify(value)
    const hash = createHash('sha256').update(json).digest('hex')
    if (value && typeof value === 'object' && Object.isFrozen(value)) {
      frozenPartCache.set(value, { hash, json })
    }
    parts.push({ slot, hash, json })
  }
  reference.aiTeams = []
  const worldCopy = { ...game.world, divisions: [] as SeasonState[] }
  if (game.world.seasonCups) {
    put('season-cups', game.world.seasonCups)
    delete worldCopy.seasonCups
  }
  if (game.world.seasonCupHistory?.length) {
    put('season-cup-history', game.world.seasonCupHistory)
    delete worldCopy.seasonCupHistory
  }
  reference.world = worldCopy
  game.aiTeams.forEach((team, index) => put(`team/${index}`, team))
  game.world.divisions.forEach((division, index) => put(`division/${index}`, division))
  if (game.reserveStars) {
    put('reserve', game.reserveStars)
    delete reference.reserveStars
  }
  const cup = game.pve?.cupSeason
  if (cup?.worldTeams) {
    for (const [id, team] of Object.entries(cup.worldTeams)) put(`cup/${id}`, team)
    reference.pve = { ...game.pve!, cupSeason: { ...cup, worldTeams: {} } }
  }
  if (game.aiClubs && Object.keys(game.aiClubs).length) {
    put('ai-clubs', game.aiClubs)
    delete reference.aiClubs
  }
  return { json: JSON.stringify({ ...reference, __accountPartsV1: parts.length }), parts }
}

export type UnpackAccountMeta = {
  /** 旧格式未把 world.seasonCups / seasonCupHistory 拆入 account_game_parts，可顺手迁移去重。 */
  hasUnsplitWorldParts: boolean
}

export function unpackAccountGame(
  json: string,
  parts: Iterable<Pick<AccountPart, 'slot' | 'json'> & { hash?: string }>,
  sharedPartPool?: Map<string, unknown>,
  meta?: UnpackAccountMeta,
): GameState {
  const game = JSON.parse(json) as GameState & { __accountPartsV1?: number }
  const expected = game.__accountPartsV1
  delete game.__accountPartsV1
  const hadInlineWorldCups = Boolean(game.shared && (game.world?.seasonCups || game.world?.seasonCupHistory?.length))
  if (meta) meta.hasUnsplitWorldParts = hadInlineWorldCups

  const loadFrozenShared = <T extends object>(poolKey: string, part: string, hash?: string): T => {
    if (!sharedPartPool) return JSON.parse(part) as T
    const key = hash ? `${poolKey}:${hash}` : undefined
    let value = key ? sharedPartPool.get(key) as T | undefined : undefined
    if (!value) {
      value = Object.freeze(JSON.parse(part) as T)
      if (hash) {
        frozenPartCache.set(value, { hash, json: part })
        if (key) sharedPartPool.set(key, value)
      }
    }
    return value
  }

  let count = 0
  let ownSeasonJson: string | null = null
  for (const { slot, json: part, hash } of parts) {
    count++
    if (slot.startsWith('cup/') && game.pve?.cupSeason) {
      const team = loadFrozenShared<AITeam>('cup', part, hash)
      // Use an own property even if an old stored team id happens to match a prototype property.
      Object.defineProperty(game.pve.cupSeason.worldTeams, slot.slice(4), { value: team, enumerable: true, writable: true, configurable: true })
      continue
    }
    if (slot.startsWith('team/')) {
      game.aiTeams[Number(slot.slice(5))] = loadFrozenShared<AITeam>('team', part, hash)
      continue
    }
    if (slot === 'reserve') {
      game.reserveStars = loadFrozenShared<Player[]>('reserve', part, hash)
      continue
    }
    if (slot === 'season-cups' && game.world) {
      game.world.seasonCups = loadFrozenShared<SeasonCups>('season-cups', part, hash)
      continue
    }
    if (slot === 'season-cup-history' && game.world) {
      game.world.seasonCupHistory = loadFrozenShared<SeasonCups[]>('season-cup-history', part, hash)
      continue
    }
    if (slot.startsWith('division/') && game.world) {
      const idx = Number(slot.slice(9))
      const divKey = hash ? `division:${hash}` : undefined
      const cached = divKey && sharedPartPool ? sharedPartPool.get(divKey) as SeasonState | undefined : undefined
      if (cached) {
        game.world.divisions[idx] = cached
        continue
      }
      const parsed = JSON.parse(part) as SeasonState
      const isPlayerDiv = parsed.clubIds?.includes('player') || parsed.divisionId === game.world.playerDivisionId
      if (!isPlayerDiv) {
        const frozen = Object.freeze(parsed)
        if (hash) {
          frozenPartCache.set(frozen, { hash, json: part })
          if (divKey) sharedPartPool?.set(divKey, frozen)
        }
        game.world.divisions[idx] = frozen
      } else if (
        game.season
        && game.season.divisionId === parsed.divisionId
        && game.season.index === parsed.index
        && game.season.round === parsed.round
        && game.season.finished === parsed.finished
        && game.season.fixtures?.length === parsed.fixtures?.length
        && (ownSeasonJson ??= JSON.stringify(game.season)) === part
      ) {
        // 本赛区与 game.season 完全一致时直接复用引用，内存不存两份本赛区赛程。
        game.world.divisions[idx] = game.season
      } else {
        game.world.divisions[idx] = parsed
      }
      continue
    }
    const value = JSON.parse(part)
    if (slot === 'ai-clubs') game.aiClubs = value as GameState['aiClubs']
    else throw new Error(`未知的账号快照字段：${slot}`)
  }
  if (expected !== count && (expected !== undefined || count !== 0)) throw new Error('账号存档共享快照不完整，请检查 SQLite 备份')
  return game
}
