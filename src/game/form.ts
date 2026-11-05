import type { GameState, MatchRecord, MatchTeamStats, PlayerMatchStats } from './types.ts'
import { PLAYER_TEAM_ID } from './season.ts'

/**
 * 从比赛记录里算出来的展示数据：球员近况和球队近期分析。
 * 这里的表现分只给玩家看，比赛引擎和培养都不读取。
 */

export const FORM_MATCHES = 5

function playerSide(record: MatchRecord): 'home' | 'away' {
  return record.awayId === PLAYER_TEAM_ID ? 'away' : 'home'
}

function statPlayerId(stat: PlayerMatchStats): string {
  return stat.sourceId ?? stat.playerId.split(':').slice(1).join(':')
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/**
 * 单场表现分（3.0–10.0，满场无贡献约 6.2）。
 * 进球、拦截、抢断、传球加分，传失和红黄牌减分，胜负有小幅修正；门将另算扑救和失球。
 */
export function matchRating(stat: PlayerMatchStats, record: MatchRecord, goalkeeper: boolean): number {
  const side = playerSide(record)
  const opponent = record.stats[side === 'home' ? 'away' : 'home']
  let rating = 6.2
  rating += stat.goals * 1.1
  rating += Math.max(0, stat.shots - stat.goals) * 0.06
  rating += stat.interceptions * 0.12
  rating += stat.tackles * 0.15
  rating += stat.passesCompleted * 0.03
  rating -= Math.max(0, stat.passes - stat.passesCompleted) * 0.05
  rating -= (stat.yellowCards ?? 0) * 0.4
  rating -= (stat.redCards ?? 0) * 1.5
  rating += record.result === 'win' ? 0.3 : record.result === 'loss' ? -0.3 : 0
  if (goalkeeper) {
    rating += Math.max(0, opponent.shotsOnTarget - opponent.goals) * 0.25
    rating -= opponent.goals * 0.35
    if (opponent.goals === 0) rating += 0.5
  }
  return Math.round(clamp(rating, 3, 10) * 10) / 10
}

export type PlayerForm = {
  /** 最近几场的表现分，从旧到新。 */
  ratings: number[]
  average: number | null
  /** 最近几场的出场分钟合计。 */
  recentMinutes: number
  /** 以下是本赛季联赛累计。 */
  apps: number
  goals: number
  wins: number
}

const emptyForm = (): PlayerForm => ({ ratings: [], average: null, recentMinutes: 0, apps: 0, goals: 0, wins: 0 })

/** 全队每名球员的近况。matchHistory 新的在前。 */
export function squadForm(game: GameState, limit = FORM_MATCHES): Map<string, PlayerForm> {
  const forms = new Map<string, PlayerForm>()
  const roster = new Map(game.roster.map((player) => [player.id, player]))
  const records = game.matchHistory.filter((record) => record.isLeague)
  records.forEach((record, index) => {
    const side = playerSide(record)
    const thisSeason = record.createdAt >= game.season.startedAt
    for (const stat of record.playerStats) {
      if (stat.side !== side || stat.minutes <= 0) continue
      const id = statPlayerId(stat)
      const player = roster.get(id)
      if (!player) continue
      const form = forms.get(id) ?? emptyForm()
      if (index < limit) {
        form.ratings.unshift(matchRating(stat, record, player.positions.GK > 0))
        form.recentMinutes += stat.minutes
      }
      if (thisSeason) {
        form.apps += 1
        form.goals += stat.goals
        if (record.result === 'win') form.wins += 1
      }
      forms.set(id, form)
    }
  })
  for (const form of forms.values()) {
    if (form.ratings.length) form.average = Math.round((form.ratings.reduce((sum, value) => sum + value, 0) / form.ratings.length) * 100) / 100
  }
  return forms
}

export function formOf(forms: Map<string, PlayerForm>, playerId: string): PlayerForm {
  return forms.get(playerId) ?? emptyForm()
}

export type AnalysisItem = { label: string; detail: string }
export type RecentAnalysis = { matches: number; positives: AnalysisItem[]; negatives: AnalysisItem[] }

type Totals = Pick<MatchTeamStats, 'possession' | 'passes' | 'passesCompleted' | 'shots' | 'shotsOnTarget' | 'goals' | 'interceptions' | 'tackles' | 'xg' | 'yellowCards' | 'redCards'>

function totals(list: MatchTeamStats[]): Totals {
  const sum = (key: keyof Totals) => list.reduce((total, stats) => total + (stats[key] ?? 0), 0)
  return {
    possession: sum('possession'),
    passes: sum('passes'),
    passesCompleted: sum('passesCompleted'),
    shots: sum('shots'),
    shotsOnTarget: sum('shotsOnTarget'),
    goals: sum('goals'),
    interceptions: sum('interceptions'),
    tackles: sum('tackles'),
    xg: sum('xg'),
    yellowCards: sum('yellowCards'),
    redCards: sum('redCards'),
  }
}

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : 0)

/**
 * 最近几场联赛和对手比，差距够大的项目才列出来。
 * 每一项都写上双方的真实数字，让玩家自己判断。
 */
export function recentAnalysis(game: GameState, limit = FORM_MATCHES): RecentAnalysis {
  const records = game.matchHistory.filter((record) => record.isLeague).slice(0, limit)
  const positives: (AnalysisItem & { weight: number })[] = []
  const negatives: (AnalysisItem & { weight: number })[] = []
  if (records.length === 0) return { matches: 0, positives: [], negatives: [] }
  const n = records.length
  const us = totals(records.map((record) => record.stats[playerSide(record)]))
  const them = totals(records.map((record) => record.stats[playerSide(record) === 'home' ? 'away' : 'home']))
  /** gap 是我方领先多少（负数为落后），超过 threshold 才算数；weight 让差距大的排在前面。 */
  const compare = (label: string, gap: number, threshold: number, detail: string) => {
    if (Math.abs(gap) < threshold) return
    const weight = Math.abs(gap) / threshold
    ;(gap > 0 ? positives : negatives).push({ label, detail, weight })
  }
  const perMatch = (value: number) => (value / n).toFixed(1)
  const percent = (value: number) => `${Math.round(value * 100)}%`

  compare('场均进球', (us.goals - them.goals) / n, 0.3, `${perMatch(us.goals)} : ${perMatch(them.goals)}`)
  compare('场均射门', (us.shots - them.shots) / n, 2, `${perMatch(us.shots)} : ${perMatch(them.shots)}`)
  compare('场均射正', (us.shotsOnTarget - them.shotsOnTarget) / n, 1, `${perMatch(us.shotsOnTarget)} : ${perMatch(them.shotsOnTarget)}`)
  compare('控球率', (us.possession - them.possession) / n, 6, `${Math.round(us.possession / n)}% : ${Math.round(them.possession / n)}%`)
  const ourPassing = ratio(us.passesCompleted, us.passes)
  const theirPassing = ratio(them.passesCompleted, them.passes)
  compare('传球成功率', ourPassing - theirPassing, 0.05, `${percent(ourPassing)} : ${percent(theirPassing)}`)
  compare('预期进球 xG', (us.xg - them.xg) / n, 0.25, `${perMatch(us.xg)} : ${perMatch(them.xg)}`)
  const ourConversion = ratio(us.goals, us.shots)
  const theirConversion = ratio(them.goals, them.shots)
  if (us.shots >= 5 && them.shots >= 5) compare('射门转化率', ourConversion - theirConversion, 0.05, `${percent(ourConversion)} : ${percent(theirConversion)}`)
  compare('拦截 + 抢断', (us.interceptions + us.tackles - them.interceptions - them.tackles) / n, 2, `${perMatch(us.interceptions + us.tackles)} : ${perMatch(them.interceptions + them.tackles)}`)
  compare('把握机会', (us.goals - us.xg) / n, 0.2, `进球 ${us.goals} / xG ${us.xg.toFixed(1)}`)
  compare('防守表现', (them.xg - them.goals) / n, 0.2, `失球 ${them.goals} / 对手 xG ${them.xg.toFixed(1)}`)
  const cards = us.yellowCards + us.redCards * 2
  const opponentCards = them.yellowCards + them.redCards * 2
  compare('纪律', (opponentCards - cards) / n, 0.5, `红黄牌 ${us.yellowCards + us.redCards} : ${them.yellowCards + them.redCards}`)

  const top = (list: (AnalysisItem & { weight: number })[]) => list.sort((a, b) => b.weight - a.weight).slice(0, 5).map(({ label, detail }) => ({ label, detail }))
  return { matches: n, positives: top(positives), negatives: top(negatives) }
}
