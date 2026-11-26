import { caOf } from './ca.ts'
import { achievementCeilingBonus, syncCupCeilingSessions } from './cup-rewards.ts'
import { ACHIEVEMENT_CEILING_BONUSES, achievementCeilingBonusFromClaims, MAX_ACHIEVEMENT_CEILING_BONUS } from './data/achievement-rewards.ts'
import { LEGEND_TEAMS } from './data/legend-teams.ts'
import { economyOf, FACILITIES, facilityLevel, MAX_FANS } from './economy.ts'
import { addLegendBook, ensureLegendBooks } from './legend-books.ts'
import { ensureShop } from './shop.ts'
import type {
  AchievementState,
  FacilityId,
  GameState,
  MatchRecord,
  Player,
  SeasonState,
  SkillId,
  SkillTier,
  TierId,
} from './types.ts'

export { ACHIEVEMENT_CEILING_BONUSES, achievementCeilingBonus, MAX_ACHIEVEMENT_CEILING_BONUS }

export type AchievementCategory =
  | 'welfare'
  | 'pve'
  | 'training'
  | 'club'
  | 'honors'
  | 'match_attack'
  | 'match_craft'
  | 'season_mastery'
  | 'dynasty_extreme'

export const ACHIEVEMENT_CATEGORY_LABELS: Record<AchievementCategory, string> = {
  welfare: '1.0 正式版福利',
  pve: '巅峰与传奇',
  training: '培养与青训',
  club: '经营与设施',
  honors: '联赛与荣誉',
  match_attack: '隐藏挑战 · 单场进攻神迹',
  match_craft: '隐藏挑战 · 赛场奇观与防守',
  season_mastery: '隐藏挑战 · 赛季霸业与连胜',
  dynasty_extreme: '隐藏挑战 · 巅峰极限与底蕴',
}

export const ACHIEVEMENT_CATEGORY_ORDER: readonly AchievementCategory[] = [
  'welfare',
  'pve',
  'training',
  'club',
  'honors',
  'match_attack',
  'match_craft',
  'season_mastery',
  'dynasty_extreme',
]

export const PEAK_WELFARE_ACHIEVEMENT_ID = 'peak_stage_1_welfare'
export const PEAK_WELFARE_MONEY = 1_000_000

export type AchievementReward = {
  money?: number
  shopPoints?: number
  fans?: number
  ceilingBonus?: number
  skillBook?: { id: SkillId; tier: SkillTier }
}

export function hasAchievementReward(reward: AchievementReward): boolean {
  return (reward.money ?? 0) > 0
    || (reward.shopPoints ?? 0) > 0
    || (reward.fans ?? 0) > 0
    || (reward.ceilingBonus ?? 0) > 0
    || !!reward.skillBook
}

export type AchievementContext = {
  game: GameState
  peakCleared: number
  legendWins: number
  legendSPlusWins: number
  trainedCards: number
  maxCa: number
  promotedYouth: number
  maxFacilityLv: number
  maxedFacilities: number
  fans: number
  trophies: number
  rainbowBooks: number
  boardGradeS: number
  season: SeasonAchievementMetrics
  match: MatchAchievementMetrics
}

export type AchievementDef = {
  id: string
  category: AchievementCategory
  title: string
  desc: string
  target: number
  unit: string
  reward: AchievementReward
  /** 隐藏成就：未解锁前对外以「？？？」展示，达成后揭晓。 */
  hidden?: true
  progressOf: (ctx: AchievementContext) => number
}

type SeasonAchievementMetrics = {
  leagueWins: number
  highestTier: number
  leagueTitles: number
  championsTitles: number
  maxSeasonPoints: number
  maxSeasonGoals: number
  maxSeasonPlayerGoals: number
  invincibleSeasons: number
  maxWinStreak: number
  maxUnbeatenStreak: number
  maxCleanSheetStreak: number
}

type MatchAchievementMetrics = {
  maxPlayerGoals: number
  maxTeamGoals: number
  maxWinMargin: number
  maxPlayerAssists: number
  goalAssistDouble: number
  shootoutWins: number
  maxPlayerRatingX10: number
  maxGkSaves: number
  maxCleanGkSaves: number
  maxSubGoals: number
  maxPlayerTackles: number
  maxPlayerInterceptions: number
  maxWinPossession: number
  maxWinShots: number
  maxUnderdogShotDeficitWin: number
  redCardWins: number
  cleanSheetZeroOppShotsOnTargetWins: number
  maxCombinedGoals: number
  maxDistinctScorers: number
  highPassAccuracyWins: number
}

const TIER_LEVEL: Record<TierId, number> = { division2: 1, division1: 2, champions: 3 }
const PLAYER_TEAM_ID = 'player'
const S_PLUS_LEGEND_IDS = new Set(LEGEND_TEAMS.filter((t) => t.tier === 'S+').map((t) => t.id))
const TOTAL_LEGEND_TEAMS = LEGEND_TEAMS.length
const TOTAL_FACILITIES = Object.keys(FACILITIES).length

function allSeasons(game: GameState): SeasonState[] {
  const byIndex = new Map<number, SeasonState>()
  for (const season of game.seasonHistory ?? []) {
    if (season && Number.isInteger(season.index)) byIndex.set(season.index, season)
  }
  if (game.season && Number.isInteger(game.season.index)) {
    byIndex.set(game.season.index, game.season)
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index)
}

function ownClubIds(game: GameState): Set<string> {
  const ids = new Set<string>([PLAYER_TEAM_ID])
  const squadKey = game.world?.clubs.find((club) => club.id === PLAYER_TEAM_ID)?.squadKey
  if (squadKey) ids.add(squadKey)
  return ids
}

function statCanonicalPlayerId(ps: { sourceId?: string; playerId: string; side: 'home' | 'away' }): string {
  if (ps.sourceId) return ps.sourceId
  const prefix = `${ps.side}:`
  return ps.playerId.startsWith(prefix) ? ps.playerId.slice(prefix.length) : ps.playerId
}

/** 统计单赛季内（联赛 + 杯赛合计，不含友谊赛/传奇/巅峰）我方单名球员最高总进球数。 */
function computeMaxSeasonPlayerGoals(game: GameState, ownIds: Set<string>, matches: MatchRecord[]): number {
  const bySeason = new Map<number, Map<string, number>>()
  const addGoal = (seasonIdx: number, playerId: string, goals: number) => {
    const g = Math.max(0, Math.floor(goals))
    if (!playerId || g <= 0) return
    let map = bySeason.get(seasonIdx)
    if (!map) {
      map = new Map<string, number>()
      bySeason.set(seasonIdx, map)
    }
    map.set(playerId, (map.get(playerId) ?? 0) + g)
  }

  const coveredLeagueRounds = new Set<string>()
  const coveredCupMatchIds = new Set<string>()
  const coveredCupFixtureIds = new Set<string>()

  // 1. 优先统计已保存的联赛与杯赛战报（含旧杯赛与正式赛季杯赛）
  for (const rec of matches) {
    const isLeague = rec.isLeague === true
    const isCup = !isLeague && rec.mode === 'cup'
    if (!isLeague && !isCup) continue
    const isHome = ownIds.has(rec.homeId)
    const isAway = !isHome && ownIds.has(rec.awayId)
    if (!isHome && !isAway) continue
    const mySide = isHome ? 'home' : 'away'
    const seasonIdx = Number.isInteger(rec.seasonIndex) ? rec.seasonIndex! : 1
    if (isLeague && Number.isInteger(rec.round)) {
      coveredLeagueRounds.add(`${seasonIdx}:${rec.round}`)
    }
    if (isCup) {
      coveredCupMatchIds.add(rec.id)
      if (rec.cupFixtureId) coveredCupFixtureIds.add(`${seasonIdx}:${rec.cupFixtureId}`)
    }
    for (const ps of rec.playerStats ?? []) {
      if (!ps || ps.side !== mySide) continue
      addGoal(seasonIdx, statCanonicalPlayerId(ps), ps.goals ?? 0)
    }
  }

  // 2. 补充战报已裁减或联机结算的联赛赛程 scorers（不与已统计轮次重复）
  for (const season of allSeasons(game)) {
    const seasonIdx = season.index
    for (const f of season.fixtures ?? []) {
      if (!f.played || !f.scorers?.length) continue
      if (!(f.isPlayer || ownIds.has(f.homeId) || ownIds.has(f.awayId))) continue
      if (coveredLeagueRounds.has(`${seasonIdx}:${f.round}`)) continue
      for (const s of f.scorers) {
        if (s.teamId && !ownIds.has(s.teamId)) continue
        addGoal(seasonIdx, s.playerId, s.goals)
      }
    }
  }

  // 3. 补充正式赛季杯赛历史与当季赛程 scorers（不与已统计杯赛战报重复）
  const cupBySeason = new Map<number, NonNullable<NonNullable<GameState['world']>['seasonCups']>>()
  for (const sc of game.world?.seasonCupHistory ?? []) {
    if (sc && Number.isInteger(sc.seasonIndex)) cupBySeason.set(sc.seasonIndex, sc)
  }
  if (game.world?.seasonCups && Number.isInteger(game.world.seasonCups.seasonIndex)) {
    cupBySeason.set(game.world.seasonCups.seasonIndex, game.world.seasonCups)
  }
  for (const sc of cupBySeason.values()) {
    const seasonIdx = sc.seasonIndex
    for (const cup of sc.cups ?? []) {
      for (const round of cup.rounds ?? []) {
        for (const fix of round.fixtures ?? []) {
          if (!fix.played || !fix.scorers?.length) continue
          if (!ownIds.has(fix.homeId) && !ownIds.has(fix.awayId)) continue
          if ((fix.matchId && coveredCupMatchIds.has(fix.matchId)) || coveredCupFixtureIds.has(`${seasonIdx}:${fix.id}`)) continue
          for (const s of fix.scorers) {
            if (s.teamId && !ownIds.has(s.teamId)) continue
            addGoal(seasonIdx, s.playerId, s.goals)
          }
        }
      }
    }
  }

  let best = 0
  for (const map of bySeason.values()) {
    for (const goals of map.values()) {
      if (goals > best) best = goals
    }
  }
  return best
}

function computeSeasonMetrics(game: GameState, ownIds: Set<string>, matches: MatchRecord[]): SeasonAchievementMetrics {
  let leagueWins = 0
  let highestTier = 1
  let leagueTitles = 0
  let championsTitles = 0
  let maxSeasonPoints = 0
  let maxSeasonGoals = 0
  let invincibleSeasons = 0
  let curWinStreak = 0
  let maxWinStreak = 0
  let curUnbeaten = 0
  let maxUnbeatenStreak = 0
  let curClean = 0
  let maxCleanSheetStreak = 0

  for (const season of allSeasons(game)) {
    const tierLv = season.tier ? (TIER_LEVEL[season.tier] ?? 1) : 1
    if (tierLv > highestTier) highestTier = tierLv
    const row = season.table?.find((entry) => ownIds.has(entry.teamId))
    if (row) {
      if (Number.isFinite(row.won)) leagueWins += Math.max(0, Math.floor(row.won))
      if (Number.isFinite(row.points)) maxSeasonPoints = Math.max(maxSeasonPoints, Math.floor(row.points))
      if (Number.isFinite(row.gf)) maxSeasonGoals = Math.max(maxSeasonGoals, Math.floor(row.gf))
      if (season.finished && row.played >= 38 && row.lost === 0) invincibleSeasons++
    }
    if (season.finished && (season.playerFinish === 1 || (season.champion != null && ownIds.has(season.champion)))) {
      leagueTitles++
      if (season.tier === 'champions') championsTitles++
    }

    const playedPlayerFixtures = (season.fixtures ?? [])
      .filter((f) => f.played && f.score && (f.isPlayer || ownIds.has(f.homeId) || ownIds.has(f.awayId)))
      .sort((a, b) => a.round - b.round)
    for (const f of playedPlayerFixtures) {
      const home = ownIds.has(f.homeId)
      const away = ownIds.has(f.awayId)
      if (!home && !away) continue
      const scored = home ? f.score!.home : f.score!.away
      const conceded = home ? f.score!.away : f.score!.home
      if (scored > conceded) {
        curWinStreak++
        if (curWinStreak > maxWinStreak) maxWinStreak = curWinStreak
      } else {
        curWinStreak = 0
      }
      if (scored >= conceded) {
        curUnbeaten++
        if (curUnbeaten > maxUnbeatenStreak) maxUnbeatenStreak = curUnbeaten
      } else {
        curUnbeaten = 0
      }
      if (conceded === 0) {
        curClean++
        if (curClean > maxCleanSheetStreak) maxCleanSheetStreak = curClean
      } else {
        curClean = 0
      }
    }
  }

  return {
    leagueWins,
    highestTier,
    leagueTitles,
    championsTitles,
    maxSeasonPoints,
    maxSeasonGoals,
    maxSeasonPlayerGoals: computeMaxSeasonPlayerGoals(game, ownIds, matches),
    invincibleSeasons,
    maxWinStreak,
    maxUnbeatenStreak,
    maxCleanSheetStreak,
  }
}

function deduplicatedMatches(game: GameState): MatchRecord[] {
  const seen = new Set<string>()
  const out: MatchRecord[] = []
  for (const list of [game.matchHistory, game.challengeHistory]) {
    if (!Array.isArray(list)) continue
    for (const rec of list) {
      if (!rec || typeof rec.id !== 'string' || seen.has(rec.id)) continue
      seen.add(rec.id)
      out.push(rec)
    }
  }
  return out
}

function computeMatchMetrics(matches: MatchRecord[], ownIds: Set<string>): MatchAchievementMetrics {
  const m: MatchAchievementMetrics = {
    maxPlayerGoals: 0,
    maxTeamGoals: 0,
    maxWinMargin: 0,
    maxPlayerAssists: 0,
    goalAssistDouble: 0,
    shootoutWins: 0,
    maxPlayerRatingX10: 0,
    maxGkSaves: 0,
    maxCleanGkSaves: 0,
    maxSubGoals: 0,
    maxPlayerTackles: 0,
    maxPlayerInterceptions: 0,
    maxWinPossession: 0,
    maxWinShots: 0,
    maxUnderdogShotDeficitWin: 0,
    redCardWins: 0,
    cleanSheetZeroOppShotsOnTargetWins: 0,
    maxCombinedGoals: 0,
    maxDistinctScorers: 0,
    highPassAccuracyWins: 0,
  }

  for (const rec of matches) {
    const isHome = ownIds.has(rec.homeId)
    const isAway = !isHome && ownIds.has(rec.awayId)
    if (!isHome && !isAway) continue
    const mySide = isHome ? 'home' : 'away'
    const oppSide = isHome ? 'away' : 'home'

    const myGoals = Math.max(0, Math.floor(rec.score?.[mySide] ?? 0))
    const oppGoals = Math.max(0, Math.floor(rec.score?.[oppSide] ?? 0))
    const won = rec.result === 'win'

    if (myGoals > m.maxTeamGoals) m.maxTeamGoals = myGoals
    if (myGoals - oppGoals > m.maxWinMargin) m.maxWinMargin = myGoals - oppGoals
    if (myGoals + oppGoals > m.maxCombinedGoals) m.maxCombinedGoals = myGoals + oppGoals

    if (rec.shootout) {
      const myPen = rec.shootout[mySide]
      const oppPen = rec.shootout[oppSide]
      if (Number.isFinite(myPen) && Number.isFinite(oppPen) && myPen > oppPen) {
        m.shootoutWins++
      }
    }

    const myStats = rec.stats?.[mySide]
    const oppStats = rec.stats?.[oppSide]
    if (myStats && oppStats) {
      if (won) {
        const poss = Number.isFinite(myStats.possession) ? Math.floor(myStats.possession) : 0
        if (poss > m.maxWinPossession) m.maxWinPossession = poss
        const shots = Number.isFinite(myStats.shots) ? Math.floor(myStats.shots) : 0
        if (shots > m.maxWinShots) m.maxWinShots = shots
        const oppShots = Number.isFinite(oppStats.shots) ? Math.floor(oppStats.shots) : 0
        if (oppShots - shots > m.maxUnderdogShotDeficitWin) m.maxUnderdogShotDeficitWin = oppShots - shots
        if ((myStats.redCards ?? 0) >= 1) m.redCardWins++
        if (oppGoals === 0 && Number.isFinite(oppStats.shotsOnTarget) && oppStats.shotsOnTarget === 0) {
          m.cleanSheetZeroOppShotsOnTargetWins++
        }
        if (myStats.passes >= 200 && myStats.passesCompleted / myStats.passes >= 0.9) {
          m.highPassAccuracyWins++
        }
      }
    }

    let distinctScorers = 0
    for (const ps of rec.playerStats ?? []) {
      if (!ps || ps.side !== mySide) continue
      const goals = Math.max(0, Math.floor(ps.goals ?? 0))
      const assists = Math.max(0, Math.floor(ps.assists ?? 0))
      const saves = Math.max(0, Math.floor(ps.saves ?? 0))
      const tackles = Math.max(0, Math.floor(ps.tackles ?? 0))
      const interceptions = Math.max(0, Math.floor(ps.interceptions ?? 0))

      if (goals > 0) distinctScorers++
      if (goals > m.maxPlayerGoals) m.maxPlayerGoals = goals
      if (assists > m.maxPlayerAssists) m.maxPlayerAssists = assists
      if (goals >= 2 && assists >= 2) m.goalAssistDouble++
      if (ps.rating !== undefined && Number.isFinite(ps.rating)) {
        const r10 = Math.round(ps.rating * 10)
        if (r10 > m.maxPlayerRatingX10) m.maxPlayerRatingX10 = r10
      }
      if (saves > m.maxGkSaves) m.maxGkSaves = saves
      if (oppGoals === 0 && saves > m.maxCleanGkSaves) m.maxCleanGkSaves = saves
      if (ps.onMinute !== undefined && Number.isFinite(ps.onMinute) && ps.onMinute >= 1 && goals > m.maxSubGoals) {
        m.maxSubGoals = goals
      }
      if (tackles > m.maxPlayerTackles) m.maxPlayerTackles = tackles
      if (interceptions > m.maxPlayerInterceptions) m.maxPlayerInterceptions = interceptions
    }
    if (distinctScorers > m.maxDistinctScorers) m.maxDistinctScorers = distinctScorers
  }

  return m
}

function playerCurrentCa(player: Pick<Player, 'attrs' | 'positions'>): number {
  return caOf(player.attrs, player.positions.GK > 0)
}

export function buildAchievementContext(game: GameState): AchievementContext {
  const ownIds = ownClubIds(game)
  const legends = game.pve?.legends ?? {}
  let legendWins = 0
  let legendSPlusWins = 0
  for (const [id, row] of Object.entries(legends)) {
    if ((row?.won ?? 0) > 0) {
      legendWins++
      if (S_PLUS_LEGEND_IDS.has(id)) legendSPlusWins++
    }
  }

  const storedCards = Array.isArray(game.cards) ? game.cards.length : 0
  const seq = typeof game.cardSeq === 'number' && Number.isFinite(game.cardSeq) ? Math.floor(game.cardSeq) : 0

  let maxCa = 0
  for (const player of game.roster ?? []) {
    const ca = playerCurrentCa(player)
    if (ca > maxCa) maxCa = ca
  }
  for (const card of game.cards ?? []) {
    const ca = playerCurrentCa(card)
    if (ca > maxCa) maxCa = ca
  }

  const rosterYouth = (game.roster ?? []).filter((p) => !!p.youthOrigin).length
  const calledUp = (game.youth?.members ?? []).filter((m) => m.calledUp).length

  let maxFacilityLv = 1
  let maxedFacilities = 0
  if (game.economy) {
    for (const id of Object.keys(FACILITIES) as FacilityId[]) {
      const lv = facilityLevel(game.economy[id] ?? 1)
      if (lv > maxFacilityLv) maxFacilityLv = lv
      if (lv >= 5) maxedFacilities++
    }
  }

  const rainbowBooks = (game.legendBooks ?? []).filter((b) => b.tier === 'rainbow').length
  const boardGradeS = (game.board?.history ?? []).filter((h) => h.grade === 'S').length
    + (game.board?.lastGrade === 'S' && !(game.board?.history ?? []).some((h) => h.grade === 'S') ? 1 : 0)

  const matches = deduplicatedMatches(game)
  return {
    game,
    peakCleared: Math.max(0, Math.floor(game.pve?.peak?.cleared ?? 0)),
    legendWins,
    legendSPlusWins,
    trainedCards: Math.max(storedCards, seq),
    maxCa: Math.floor(maxCa),
    promotedYouth: Math.max(rosterYouth, calledUp),
    maxFacilityLv,
    maxedFacilities,
    fans: Math.max(0, Math.floor(game.economy?.fans ?? 0)),
    trophies: Array.isArray(game.pve?.trophies) ? game.pve!.trophies.length : 0,
    rainbowBooks,
    boardGradeS,
    season: computeSeasonMetrics(game, ownIds, matches),
    match: computeMatchMetrics(matches, ownIds),
  }
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  /* ===================== 常规成就（28 项） ===================== */

  // 1.0 特别福利成就
  {
    id: PEAK_WELFARE_ACHIEVEMENT_ID,
    category: 'welfare',
    title: '巅峰启程 · 1.0 福利',
    desc: '在「巅峰之路」赢得第 1 关胜利（已通关老存档自动补发 100 万金币）',
    target: 1,
    unit: '关',
    reward: { money: PEAK_WELFARE_MONEY },
    progressOf: (ctx) => ctx.peakCleared,
  },

  // 巅峰与传奇
  {
    id: 'peak_clear_5',
    category: 'pve',
    title: '初露锋芒',
    desc: '在「巅峰之路」累计通关第 5 关',
    target: 5,
    unit: '关',
    reward: { shopPoints: 30 },
    progressOf: (ctx) => ctx.peakCleared,
  },
  {
    id: 'peak_clear_10',
    category: 'pve',
    title: '十关破阵',
    desc: '在「巅峰之路」累计通关第 10 关',
    target: 10,
    unit: '关',
    reward: { shopPoints: 50 },
    progressOf: (ctx) => ctx.peakCleared,
  },
  {
    id: 'peak_clear_25',
    category: 'pve',
    title: '巅峰强豪',
    desc: '在「巅峰之路」累计通关第 25 关',
    target: 25,
    unit: '关',
    reward: { shopPoints: 100 },
    progressOf: (ctx) => ctx.peakCleared,
  },
  {
    id: 'peak_clear_50',
    category: 'pve',
    title: '半程封王',
    desc: '在「巅峰之路」累计通关第 50 关',
    target: 50,
    unit: '关',
    reward: { shopPoints: 200 },
    progressOf: (ctx) => ctx.peakCleared,
  },
  {
    id: 'peak_clear_100',
    category: 'pve',
    title: '百关制霸',
    desc: '征服「巅峰之路」全部 100 关',
    target: 100,
    unit: '关',
    reward: { shopPoints: 500 },
    progressOf: (ctx) => ctx.peakCleared,
  },
  {
    id: 'legend_win_1',
    category: 'pve',
    title: '挑战传奇',
    desc: '在「传奇挑战」中击败任意 1 支历史传奇球队',
    target: 1,
    unit: '队',
    reward: { shopPoints: 40 },
    progressOf: (ctx) => ctx.legendWins,
  },
  {
    id: 'legend_win_5',
    category: 'pve',
    title: '传奇克星',
    desc: '在「传奇挑战」中累计击败 5 支不同传奇球队',
    target: 5,
    unit: '队',
    reward: { shopPoints: 100 },
    progressOf: (ctx) => ctx.legendWins,
  },
  {
    id: 'legend_win_15',
    category: 'pve',
    title: '群星俯首',
    desc: '在「传奇挑战」中累计击败 15 支不同传奇球队',
    target: 15,
    unit: '队',
    reward: { shopPoints: 200 },
    progressOf: (ctx) => ctx.legendWins,
  },

  // 培养与青训
  {
    id: 'cards_1',
    category: 'training',
    title: '初试身手',
    desc: '完成 1 次球员培养并产出球员卡',
    target: 1,
    unit: '张',
    reward: { shopPoints: 20 },
    progressOf: (ctx) => ctx.trainedCards,
  },
  {
    id: 'cards_10',
    category: 'training',
    title: '青出于蓝',
    desc: '累计培养产出 10 张球员卡',
    target: 10,
    unit: '张',
    reward: { shopPoints: 50 },
    progressOf: (ctx) => ctx.trainedCards,
  },
  {
    id: 'cards_30',
    category: 'training',
    title: '训练宗师',
    desc: '累计培养产出 30 张球员卡',
    target: 30,
    unit: '张',
    reward: { shopPoints: 100 },
    progressOf: (ctx) => ctx.trainedCards,
  },
  {
    id: 'squad_ca_300',
    category: 'training',
    title: '王牌诞生',
    desc: '拥有任意 1 名当前 CA 达到 300 的球员或球员卡',
    target: 300,
    unit: 'CA',
    reward: { shopPoints: 60 },
    progressOf: (ctx) => ctx.maxCa,
  },
  {
    id: 'squad_ca_450',
    category: 'training',
    title: '巨星降临',
    desc: '拥有任意 1 名当前 CA 达到 450 的球员或球员卡',
    target: 450,
    unit: 'CA',
    reward: { shopPoints: 120 },
    progressOf: (ctx) => ctx.maxCa,
  },
  {
    id: 'youth_promote_1',
    category: 'training',
    title: '自家青训',
    desc: '将 1 名青训营新星征召或提拔进入一线队',
    target: 1,
    unit: '人',
    reward: { shopPoints: 40 },
    progressOf: (ctx) => ctx.promotedYouth,
  },

  // 经营与设施
  {
    id: 'facility_lv2',
    category: 'club',
    title: '初具规模',
    desc: '将任意一座俱乐部设施升级至 2 级',
    target: 2,
    unit: '级',
    reward: { shopPoints: 30 },
    progressOf: (ctx) => ctx.maxFacilityLv,
  },
  {
    id: 'facility_lv3',
    category: 'club',
    title: '现代基地',
    desc: '将任意一座俱乐部设施升级至 3 级',
    target: 3,
    unit: '级',
    reward: { shopPoints: 60 },
    progressOf: (ctx) => ctx.maxFacilityLv,
  },
  {
    id: 'facility_lv5',
    category: 'club',
    title: '世界顶级设施',
    desc: '将任意一座俱乐部设施升级至满级 5 级',
    target: 5,
    unit: '级',
    reward: { shopPoints: 150 },
    progressOf: (ctx) => ctx.maxFacilityLv,
  },
  {
    id: 'fans_10k',
    category: 'club',
    title: '万人拥趸',
    desc: '俱乐部球迷规模达到 10,000 人',
    target: 10_000,
    unit: '人',
    reward: { shopPoints: 50 },
    progressOf: (ctx) => ctx.fans,
  },

  // 联赛与荣誉
  {
    id: 'league_wins_10',
    category: 'honors',
    title: '稳步起航',
    desc: '在联赛中累计取得 10 场胜利',
    target: 10,
    unit: '胜',
    reward: { shopPoints: 30 },
    progressOf: (ctx) => ctx.season.leagueWins,
  },
  {
    id: 'league_wins_30',
    category: 'honors',
    title: '常胜之师',
    desc: '在联赛中累计取得 30 场胜利',
    target: 30,
    unit: '胜',
    reward: { shopPoints: 80 },
    progressOf: (ctx) => ctx.season.leagueWins,
  },
  {
    id: 'tier_division1',
    category: 'honors',
    title: '升入精英',
    desc: '带领俱乐部跻身精英联赛（或更高）',
    target: 2,
    unit: '级联赛',
    reward: { shopPoints: 100 },
    progressOf: (ctx) => ctx.season.highestTier,
  },
  {
    id: 'tier_champions',
    category: 'honors',
    title: '问鼎冠联席位',
    desc: '带领俱乐部踏入冠军联赛舞台',
    target: 3,
    unit: '级联赛',
    reward: { shopPoints: 200 },
    progressOf: (ctx) => ctx.season.highestTier,
  },
  {
    id: 'trophy_1',
    category: 'honors',
    title: '首座奖杯',
    desc: '赢得任意 1 座杯赛冠军奖杯',
    target: 1,
    unit: '座',
    reward: { shopPoints: 80 },
    progressOf: (ctx) => ctx.trophies,
  },
  {
    id: 'feat_league_streak_5',
    category: 'honors',
    title: '五连胜起势',
    desc: '在联赛中豪取 5 连胜（主属性上限与其他上限成就、奖杯独立叠加）',
    target: 5,
    unit: '连胜',
    reward: { ceilingBonus: ACHIEVEMENT_CEILING_BONUSES.feat_league_streak_5 },
    progressOf: (ctx) => ctx.season.maxWinStreak,
  },
  {
    id: 'feat_league_streak_10',
    category: 'honors',
    title: '十连胜狂潮',
    desc: '在联赛中豪取 10 连胜（主属性上限与其他上限成就、奖杯独立叠加）',
    target: 10,
    unit: '连胜',
    reward: { ceilingBonus: ACHIEVEMENT_CEILING_BONUSES.feat_league_streak_10 },
    progressOf: (ctx) => ctx.season.maxWinStreak,
  },
  {
    id: 'feat_season_player_50_goals',
    category: 'honors',
    title: '单季五十球神迹',
    desc: '单赛季（联赛与杯赛合计）我方单名球员打进 50 球及以上（主属性上限与其他上限成就、奖杯独立叠加）',
    target: 50,
    unit: '球',
    reward: { ceilingBonus: ACHIEVEMENT_CEILING_BONUSES.feat_season_player_50_goals },
    progressOf: (ctx) => ctx.season.maxSeasonPlayerGoals,
  },
  {
    id: 'feat_five_goals_player',
    category: 'honors',
    title: '五子登科',
    desc: '单场比赛中我方单名球员打进 5 球及以上（主属性上限与其他上限成就、奖杯独立叠加）',
    target: 5,
    unit: '球',
    reward: { ceilingBonus: ACHIEVEMENT_CEILING_BONUSES.feat_five_goals_player },
    progressOf: (ctx) => ctx.match.maxPlayerGoals,
  },

  /* ===================== 隐藏高难挑战成就（47 项，奖励待后续配置） ===================== */

  // 1. 单场进攻神迹（11 项）
  {
    id: 'feat_hat_trick',
    category: 'match_attack',
    title: '帽子戏法',
    desc: '单场比赛中我方单名球员打进 3 球及以上',
    target: 3,
    unit: '球',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.maxPlayerGoals,
  },
  {
    id: 'feat_poker',
    category: 'match_attack',
    title: '大四喜',
    desc: '单场比赛中我方单名球员打进 4 球及以上',
    target: 4,
    unit: '球',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.maxPlayerGoals,
  },
  {
    id: 'feat_six_goals_player',
    category: 'match_attack',
    title: '独中六元',
    desc: '单场比赛中我方单名球员打进 6 球及以上',
    target: 6,
    unit: '球',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.maxPlayerGoals,
  },
  {
    id: 'feat_team_5_goals',
    category: 'match_attack',
    title: '火力全开',
    desc: '单场比赛全队打进 5 球及以上',
    target: 5,
    unit: '球',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.maxTeamGoals,
  },
  {
    id: 'feat_team_8_goals',
    category: 'match_attack',
    title: '八星报喜',
    desc: '单场比赛全队打进 8 球及以上',
    target: 8,
    unit: '球',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.maxTeamGoals,
  },
  {
    id: 'feat_team_10_goals',
    category: 'match_attack',
    title: '十全十美',
    desc: '单场比赛全队打进 10 球及以上',
    target: 10,
    unit: '球',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.maxTeamGoals,
  },
  {
    id: 'feat_margin_5',
    category: 'match_attack',
    title: '五球大胜',
    desc: '单场比赛净胜对手 5 球及以上',
    target: 5,
    unit: '球',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.maxWinMargin,
  },
  {
    id: 'feat_margin_8',
    category: 'match_attack',
    title: '血洗绿茵',
    desc: '单场比赛净胜对手 8 球及以上',
    target: 8,
    unit: '球',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.maxWinMargin,
  },
  {
    id: 'feat_assist_3',
    category: 'match_attack',
    title: '助攻戴帽',
    desc: '单场比赛中我方单名球员送出 3 次及以上助攻',
    target: 3,
    unit: '助',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.maxPlayerAssists,
  },
  {
    id: 'feat_assist_4',
    category: 'match_attack',
    title: '上帝视角',
    desc: '单场比赛中我方单名球员送出 4 次及以上助攻',
    target: 4,
    unit: '助',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.maxPlayerAssists,
  },
  {
    id: 'feat_goal_assist_double',
    category: 'match_attack',
    title: '全能核心',
    desc: '单场比赛中我方单名球员同时贡献 2 球 + 2 助攻及以上',
    target: 1,
    unit: '次',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.goalAssistDouble,
  },

  // 2. 赛场奇观与防守（18 项）
  {
    id: 'feat_shootout_win',
    category: 'match_craft',
    title: '十二码心脏',
    desc: '在点球大战中击败对手赢得胜利',
    target: 1,
    unit: '次',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.shootoutWins,
  },
  {
    id: 'feat_shootout_win_5',
    category: 'match_craft',
    title: '点球专家',
    desc: '执教生涯累计赢得 5 场点球大战胜利',
    target: 5,
    unit: '次',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.shootoutWins,
  },
  {
    id: 'feat_rating_95',
    category: 'match_craft',
    title: '现象级表演',
    desc: '单场比赛中我方单名球员赛后评分达到 9.5 分及以上',
    target: 95,
    unit: '分×10',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.maxPlayerRatingX10,
  },
  {
    id: 'feat_rating_10',
    category: 'match_craft',
    title: '满分先生',
    desc: '单场比赛中我方单名球员赛后评分拿到 10.0 满分',
    target: 100,
    unit: '分×10',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.maxPlayerRatingX10,
  },
  {
    id: 'feat_gk_saves_8',
    category: 'match_craft',
    title: '一夫当关',
    desc: '单场比赛我方门将完成 8 次及以上扑救',
    target: 8,
    unit: '扑',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.maxGkSaves,
  },
  {
    id: 'feat_gk_saves_12',
    category: 'match_craft',
    title: '叹息之墙',
    desc: '单场比赛我方门将完成 12 次及以上扑救',
    target: 12,
    unit: '扑',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.maxGkSaves,
  },
  {
    id: 'feat_gk_clean_saves_6',
    category: 'match_craft',
    title: '零封门神',
    desc: '单场零封对手且我方门将完成 6 次及以上扑救',
    target: 6,
    unit: '扑',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.maxCleanGkSaves,
  },
  {
    id: 'feat_sub_hero',
    category: 'match_craft',
    title: '超级替补',
    desc: '替补登场的球员在单场比赛中打进 2 球及以上',
    target: 2,
    unit: '球',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.maxSubGoals,
  },
  {
    id: 'feat_tackle_8',
    category: 'match_craft',
    title: '中场绞肉机',
    desc: '单场比赛中我方单名球员完成 8 次及以上抢断',
    target: 8,
    unit: '断',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.maxPlayerTackles,
  },
  {
    id: 'feat_intercept_8',
    category: 'match_craft',
    title: '球路预言家',
    desc: '单场比赛中我方单名球员完成 8 次及以上拦截',
    target: 8,
    unit: '拦',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.maxPlayerInterceptions,
  },
  {
    id: 'feat_possession_70',
    category: 'match_craft',
    title: '宇宙传控',
    desc: '单场获胜且控球率达到 70% 及以上',
    target: 70,
    unit: '%',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.maxWinPossession,
  },
  {
    id: 'feat_shots_25_win',
    category: 'match_craft',
    title: '狂轰滥炸',
    desc: '单场全队完成 25 次及以上射门并赢得比赛',
    target: 25,
    unit: '射',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.maxWinShots,
  },
  {
    id: 'feat_underdog_shot_win',
    category: 'match_craft',
    title: '防反教科书',
    desc: '单场射门数比对手少至少 10 次但依然赢得比赛',
    target: 10,
    unit: '次',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.maxUnderdogShotDeficitWin,
  },
  {
    id: 'feat_red_card_win',
    category: 'match_craft',
    title: '少打一人逆袭',
    desc: '单场比赛我方吃到红牌后仍坚持赢得胜利',
    target: 1,
    unit: '场',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.redCardWins,
  },
  {
    id: 'feat_clean_sheet_zero_shots',
    category: 'match_craft',
    title: '绝对窒息',
    desc: '单场获胜且让对手全场射正次数为 0',
    target: 1,
    unit: '场',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.cleanSheetZeroOppShotsOnTargetWins,
  },
  {
    id: 'feat_goal_fest_draw',
    category: 'match_craft',
    title: '进球大战',
    desc: '单场常规时间双方合计打进 8 球及以上',
    target: 8,
    unit: '球',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.maxCombinedGoals,
  },
  {
    id: 'feat_multi_scorers_5',
    category: 'match_craft',
    title: '全民皆兵',
    desc: '单场比赛中我方有 5 名及以上不同球员破门得分',
    target: 5,
    unit: '人',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.maxDistinctScorers,
  },
  {
    id: 'feat_pass_accuracy_90',
    category: 'match_craft',
    title: '手术刀传导',
    desc: '单场传球不少于 200 次、传球成功率达到 90% 及以上并获胜',
    target: 1,
    unit: '场',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.match.highPassAccuracyWins,
  },

  // 3. 赛季霸业与连胜（10 项）
  {
    id: 'feat_league_streak_15',
    category: 'season_mastery',
    title: '势不可挡',
    desc: '在联赛中豪取 15 连胜',
    target: 15,
    unit: '连胜',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.season.maxWinStreak,
  },
  {
    id: 'feat_league_unbeaten_15',
    category: 'season_mastery',
    title: '十五轮不败',
    desc: '在联赛中连续 15 轮保持不败',
    target: 15,
    unit: '轮',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.season.maxUnbeatenStreak,
  },
  {
    id: 'feat_league_clean_streak_5',
    category: 'season_mastery',
    title: '钢铁防线',
    desc: '在联赛中连续 5 场零封对手',
    target: 5,
    unit: '场',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.season.maxCleanSheetStreak,
  },
  {
    id: 'feat_season_champion',
    category: 'season_mastery',
    title: '联赛桂冠',
    desc: '赢得任意级别联赛的赛季总冠军',
    target: 1,
    unit: '冠',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.season.leagueTitles,
  },
  {
    id: 'feat_champions_title',
    category: 'season_mastery',
    title: '欧陆之巅',
    desc: '夺得最高级别「冠军联赛」赛季总冠军',
    target: 1,
    unit: '冠',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.season.championsTitles,
  },
  {
    id: 'feat_season_90_pts',
    category: 'season_mastery',
    title: '九十分豪门',
    desc: '单赛季联赛积分达到 90 分及以上',
    target: 90,
    unit: '分',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.season.maxSeasonPoints,
  },
  {
    id: 'feat_season_100_pts',
    category: 'season_mastery',
    title: '百分王朝',
    desc: '单赛季联赛积分达到 100 分及以上',
    target: 100,
    unit: '分',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.season.maxSeasonPoints,
  },
  {
    id: 'feat_season_invincible',
    category: 'season_mastery',
    title: '不败金身',
    desc: '单赛季 38 轮完赛保持联赛 0 负的不败神话',
    target: 1,
    unit: '季',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.season.invincibleSeasons,
  },
  {
    id: 'feat_season_100_goals',
    category: 'season_mastery',
    title: '百球进攻',
    desc: '单赛季联赛全队总进球数达到 100 球及以上',
    target: 100,
    unit: '球',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.season.maxSeasonGoals,
  },
  {
    id: 'feat_league_wins_100',
    category: 'season_mastery',
    title: '百胜名帅',
    desc: '执教生涯联赛累计胜场达到 100 场',
    target: 100,
    unit: '胜',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.season.leagueWins,
  },

  // 4. 巅峰极限与底蕴（8 项）
  {
    id: 'feat_legend_splus_win',
    category: 'dynasty_extreme',
    title: '弑神之战',
    desc: '在「传奇挑战」中击败任意 1 支 S+ 档历史传奇豪门',
    target: 1,
    unit: '队',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.legendSPlusWins,
  },
  {
    id: 'feat_legend_all_50',
    category: 'dynasty_extreme',
    title: '历史征服者',
    desc: '在「传奇挑战」中击败全部 50 支历史传奇球队',
    target: TOTAL_LEGEND_TEAMS,
    unit: '队',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.legendWins,
  },
  {
    id: 'feat_peak_80',
    category: 'dynasty_extreme',
    title: '迈向世界杯',
    desc: '在「巅峰之路」闯过第 80 关，正式踏入世界杯国家队终极篇章',
    target: 80,
    unit: '关',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.peakCleared,
  },
  {
    id: 'feat_trophies_5',
    category: 'dynasty_extreme',
    title: '冠军之师',
    desc: '俱乐部荣誉橱窗累计收藏 5 座杯赛冠军奖杯',
    target: 5,
    unit: '座',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.trophies,
  },
  {
    id: 'feat_squad_ca_600',
    category: 'dynasty_extreme',
    title: '超凡入圣',
    desc: '阵中拥有任意 1 名当前 CA 达到 600 的超级巨星或球员卡',
    target: 600,
    unit: 'CA',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.maxCa,
  },
  {
    id: 'feat_all_facilities_max',
    category: 'dynasty_extreme',
    title: '帝国基地',
    desc: '俱乐部全部 7 座设施悉数升至满级 5 级',
    target: TOTAL_FACILITIES,
    unit: '座',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.maxedFacilities,
  },
  {
    id: 'feat_rainbow_books_5',
    category: 'dynasty_extreme',
    title: '彩虹藏书阁',
    desc: '技能书库存累计收集 5 本及以上彩虹技能书',
    target: 5,
    unit: '本',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.rainbowBooks,
  },
  {
    id: 'feat_board_grade_s',
    category: 'dynasty_extreme',
    title: '董事会楷模',
    desc: '在赛季末董事会考核中荣获最高 S 级评价',
    target: 1,
    unit: '次',
    reward: {},
    hidden: true,
    progressOf: (ctx) => ctx.boardGradeS,
  },
]

const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((def) => [def.id, def]))

export const MAX_ACHIEVEMENT_SHOP_POINTS = ACHIEVEMENTS.reduce(
  (sum, def) => sum + (def.reward.shopPoints ?? 0),
  0,
)

export type AchievementItemView = {
  id: string
  category: AchievementCategory
  title: string
  desc: string
  current: number
  target: number
  unit: string
  reward: AchievementReward
  hidden: boolean
  hasReward: boolean
  unlocked: boolean
  claimed: boolean
  claimable: boolean
  backfilled: boolean
  unlockedAt?: number
  claimedAt?: number
}

export type AchievementSummary = {
  total: number
  standardTotal: number
  hiddenTotal: number
  hiddenUnlocked: number
  unlocked: number
  claimed: number
  claimable: number
  pendingMoney: number
  pendingShopPoints: number
  pendingCeilingBonus: number
  earnedShopPoints: number
  maxShopPoints: number
  earnedCeilingBonus: number
  maxCeilingBonus: number
  welfareBackfillMoney: number
  items: AchievementItemView[]
}

export type AchievementClaimResult =
  | {
      ok: true
      claimedIds: string[]
      money: number
      shopPoints: number
      fans: number
      ceilingBonus: number
      totalCeilingBonus: number
      points: number
      balance: number
    }
  | { ok: false; error: string }

/**
 * 扫描当前存档并把已达成但尚未记账的成就永久写入 `achievements.unlocked`。
 * 不写入 `claimed`，确保暂未配置奖励的隐藏成就在未来更新奖励后仍可正常领取。
 */
export function syncUnlockedAchievements(game: GameState, now = Date.now()): boolean {
  if (!game.achievements) return false
  const unlockedMap = (game.achievements.unlocked ??= {})
  const claimedMap = game.achievements.claimed ?? {}
  const ctx = buildAchievementContext(game)
  let changed = false
  for (const def of ACHIEVEMENTS) {
    if (unlockedMap[def.id] !== undefined) continue
    const claim = claimedMap[def.id]
    if (claim) {
      unlockedMap[def.id] = claim.claimedAt
      changed = true
      continue
    }
    if (def.progressOf(ctx) >= def.target) {
      unlockedMap[def.id] = now
      changed = true
    }
  }
  return changed
}

/**
 * 初始化成就账本，并为 1.0 上线前已经打通「巅峰之路第 1 关」的老存档自动补发 100 万金币福利，
 * 同时同步持久化所有已达成的常规与隐藏成就解锁记录。
 * 幂等：重复调用不会重复发放。
 */
export function ensureAchievements(game: GameState, now = Date.now()): { changed: boolean; backfilledMoney: number } {
  let changed = false
  let backfilledMoney = 0
  if (!game.achievements || typeof game.achievements !== 'object' || Array.isArray(game.achievements)) {
    game.achievements = { version: 1, unlocked: {}, claimed: {} }
    changed = true
  }
  const state = game.achievements as AchievementState
  if (state.version !== 1) {
    state.version = 1
    changed = true
  }
  if (!state.claimed || typeof state.claimed !== 'object' || Array.isArray(state.claimed)) {
    state.claimed = {}
    changed = true
  }
  if (!state.unlocked || typeof state.unlocked !== 'object' || Array.isArray(state.unlocked)) {
    state.unlocked = {}
    changed = true
  }
  if (state.welfareBackfillChecked !== true) {
    const cleared = Math.max(0, Math.floor(game.pve?.peak?.cleared ?? 0))
    if (cleared >= 1 && !state.claimed[PEAK_WELFARE_ACHIEVEMENT_ID]) {
      economyOf(game).balance += PEAK_WELFARE_MONEY
      state.claimed[PEAK_WELFARE_ACHIEVEMENT_ID] = { claimedAt: now, backfilled: true }
      state.unlocked[PEAK_WELFARE_ACHIEVEMENT_ID] = now
      state.welfareBackfillMoney = PEAK_WELFARE_MONEY
      backfilledMoney = PEAK_WELFARE_MONEY
    }
    state.welfareBackfillChecked = true
    changed = true
  }
  if (syncUnlockedAchievements(game, now)) changed = true
  return { changed, backfilledMoney }
}

/** 实时评估全部成就进度与领取状态（纯读取，不改动存档）。 */
export function evaluateAchievements(game: GameState): AchievementItemView[] {
  const claimedMap = game.achievements?.claimed ?? {}
  const unlockedMap = game.achievements?.unlocked ?? {}
  const ctx = buildAchievementContext(game)
  return ACHIEVEMENTS.map((def) => {
    const raw = Math.max(0, Math.floor(def.progressOf(ctx)))
    const claim = claimedMap[def.id]
    const claimed = !!claim
    const unlockedAt = unlockedMap[def.id] ?? claim?.claimedAt
    const unlocked = claimed || unlockedAt !== undefined || raw >= def.target
    const rewardExists = hasAchievementReward(def.reward)
    return {
      id: def.id,
      category: def.category,
      title: def.title,
      desc: def.desc,
      current: Math.min(def.target, unlocked ? def.target : raw),
      target: def.target,
      unit: def.unit,
      reward: def.reward,
      hidden: !!def.hidden,
      hasReward: rewardExists,
      unlocked,
      claimed,
      claimable: unlocked && !claimed && rewardExists,
      backfilled: !!claim?.backfilled,
      unlockedAt,
      claimedAt: claim?.claimedAt,
    }
  })
}

export function achievementSummary(game: GameState): AchievementSummary {
  const items = evaluateAchievements(game)
  let standardTotal = 0
  let hiddenTotal = 0
  let hiddenUnlocked = 0
  let unlocked = 0
  let claimed = 0
  let claimable = 0
  let pendingMoney = 0
  let pendingShopPoints = 0
  let pendingCeilingBonus = 0
  let earnedShopPoints = 0
  let earnedCeilingBonus = 0
  for (const item of items) {
    if (item.hidden) {
      hiddenTotal++
      if (item.unlocked) hiddenUnlocked++
    } else {
      standardTotal++
    }
    if (item.unlocked) unlocked++
    if (item.claimed) {
      claimed++
      earnedShopPoints += item.reward.shopPoints ?? 0
      earnedCeilingBonus += item.reward.ceilingBonus ?? 0
    } else if (item.claimable) {
      claimable++
      pendingMoney += item.reward.money ?? 0
      pendingShopPoints += item.reward.shopPoints ?? 0
      pendingCeilingBonus += item.reward.ceilingBonus ?? 0
    }
  }
  return {
    total: items.length,
    standardTotal,
    hiddenTotal,
    hiddenUnlocked,
    unlocked,
    claimed,
    claimable,
    pendingMoney,
    pendingShopPoints,
    pendingCeilingBonus,
    earnedShopPoints,
    maxShopPoints: MAX_ACHIEVEMENT_SHOP_POINTS,
    earnedCeilingBonus,
    maxCeilingBonus: MAX_ACHIEVEMENT_CEILING_BONUS,
    welfareBackfillMoney: game.achievements?.welfareBackfillMoney ?? 0,
    items,
  }
}

/** 对外安全脱敏：未解锁的隐藏成就不暴露标题、条件和目标数值。 */
export function publicAchievementSummary(game: GameState): AchievementSummary {
  const summary = achievementSummary(game)
  return {
    ...summary,
    items: summary.items.map((item) => (
      item.hidden && !item.unlocked
        ? { ...item, title: '？？？', desc: '达成隐藏条件后自动解锁并揭晓', current: 0, target: 0, unit: '' }
        : item
    )),
  }
}

export function claimableAchievementCount(game: GameState): number {
  const claimedMap = game.achievements?.claimed ?? {}
  const unlockedMap = game.achievements?.unlocked ?? {}
  const rewardDefs = ACHIEVEMENTS.filter((def) => hasAchievementReward(def.reward) && !claimedMap[def.id])
  if (rewardDefs.length === 0) return 0
  const ctx = buildAchievementContext(game)
  let count = 0
  for (const def of rewardDefs) {
    if (unlockedMap[def.id] !== undefined || def.progressOf(ctx) >= def.target) count++
  }
  return count
}

function grantAchievement(game: GameState, def: AchievementDef, now: number): { money: number; shopPoints: number; fans: number; ceilingBonus: number } {
  const money = def.reward.money ?? 0
  const shopPoints = def.reward.shopPoints ?? 0
  const fans = def.reward.fans ?? 0
  const ceilingBonus = def.reward.ceilingBonus ?? 0
  if (money > 0) economyOf(game).balance += money
  if (fans > 0) {
    const eco = economyOf(game)
    eco.fans = Math.min(MAX_FANS, eco.fans + fans)
  }
  if (shopPoints > 0) {
    ensureShop(game)
    game.shop!.points += shopPoints
  }
  if (def.reward.skillBook) {
    ensureLegendBooks(game)
    addLegendBook(game, def.reward.skillBook.id, def.reward.skillBook.tier)
  }
  game.achievements!.unlocked = { ...(game.achievements!.unlocked ?? {}), [def.id]: game.achievements!.unlocked?.[def.id] ?? now }
  game.achievements!.claimed[def.id] = { claimedAt: now }
  return { money, shopPoints, fans, ceilingBonus }
}

/** 领取单个已解锁但尚未领取的成就奖励。 */
export function claimAchievement(game: GameState, id: string, now = Date.now()): AchievementClaimResult {
  const def = ACHIEVEMENT_BY_ID.get(id)
  if (!def) return { ok: false, error: '找不到该成就' }
  if (!hasAchievementReward(def.reward)) return { ok: false, error: '该成就奖励待后续更新配置，暂无需领取' }
  ensureAchievements(game, now)
  if (game.achievements!.claimed[id]) return { ok: false, error: '该成就奖励已经领取过了' }
  const isUnlocked = game.achievements!.unlocked?.[id] !== undefined
    || def.progressOf(buildAchievementContext(game)) >= def.target
  if (!isUnlocked) return { ok: false, error: '该成就尚未达成，暂无法领取' }
  const { money, shopPoints, fans, ceilingBonus } = grantAchievement(game, def, now)
  if (ceilingBonus > 0) syncCupCeilingSessions(game)
  return {
    ok: true,
    claimedIds: [id],
    money,
    shopPoints,
    fans,
    ceilingBonus,
    totalCeilingBonus: achievementCeilingBonusFromClaims(game.achievements?.claimed),
    points: game.shop?.points ?? 0,
    balance: economyOf(game).balance,
  }
}

/** 一键领取当前所有已达成且已配置奖励、尚未领取的成就。 */
export function claimAllAchievements(game: GameState, now = Date.now()): AchievementClaimResult {
  ensureAchievements(game, now)
  const ctx = buildAchievementContext(game)
  const claimedIds: string[] = []
  let money = 0
  let shopPoints = 0
  let fans = 0
  let ceilingBonus = 0
  for (const def of ACHIEVEMENTS) {
    if (!hasAchievementReward(def.reward)) continue
    if (game.achievements!.claimed[def.id]) continue
    const isUnlocked = game.achievements!.unlocked?.[def.id] !== undefined || def.progressOf(ctx) >= def.target
    if (!isUnlocked) continue
    const got = grantAchievement(game, def, now)
    claimedIds.push(def.id)
    money += got.money
    shopPoints += got.shopPoints
    fans += got.fans
    ceilingBonus += got.ceilingBonus
  }
  if (claimedIds.length === 0) return { ok: false, error: '目前没有可领取的成就奖励' }
  if (ceilingBonus > 0) syncCupCeilingSessions(game)
  return {
    ok: true,
    claimedIds,
    money,
    shopPoints,
    fans,
    ceilingBonus,
    totalCeilingBonus: achievementCeilingBonusFromClaims(game.achievements?.claimed),
    points: game.shop?.points ?? 0,
    balance: economyOf(game).balance,
  }
}
