import type { GameState, MatchRecord, Player, PlayerMatchStats } from '../../game/types.ts'
import { game } from '../state.ts'
import { esc } from '../format.ts'

export type PerformanceCompetition = 'all' | 'league' | 'friendly' | 'legend' | 'cup' | 'peak'
export type PerformancePeriod = 'season' | 'career'

type Metric = 'goals' | 'assists' | 'shots' | 'passes' | 'passesCompleted' | 'tackles' | 'interceptions' | 'distance' | 'touches' | 'yellowCards' | 'redCards'
const metrics: Metric[] = ['goals', 'assists', 'shots', 'passes', 'passesCompleted', 'tackles', 'interceptions', 'distance', 'touches', 'yellowCards', 'redCards']
export type AdvancedMetric = 'shotsOnTarget' | 'xg' | 'chancesCreated' | 'chancesConverted' | 'xa' | 'tackleAttempts' | 'rating'
const advancedMetrics: AdvancedMetric[] = ['shotsOnTarget', 'xg', 'chancesCreated', 'chancesConverted', 'xa', 'tackleAttempts', 'rating']
type RateTotals = { success: number; attempts: number; matches: number }
export type PerformanceTotals = { appearances: number; minutes: number; wins: number; resultsKnown: number; coverage: Record<AdvancedMetric, number>; tackleRate: RateTotals; chanceRate: RateTotals } & Record<Metric | AdvancedMetric, number | null>
const competitions: { id: PerformanceCompetition; label: string }[] = [
  { id: 'all', label: '全部比赛' }, { id: 'league', label: '联赛' }, { id: 'friendly', label: '友谊赛' },
  { id: 'legend', label: '传奇挑战' }, { id: 'cup', label: '杯赛' }, { id: 'peak', label: '巅峰之路' },
]

function category(record: MatchRecord): PerformanceCompetition {
  return record.isLeague ? 'league' : record.mode ?? 'friendly'
}
function belongs(stats: PlayerMatchStats, id: string): boolean {
  if (stats.sourceId != null) return stats.sourceId === id
  // Engine IDs may have a side prefix; source IDs themselves can contain colons.
  return stats.playerId === id || stats.playerId.slice(stats.playerId.indexOf(':') + 1) === id
}
function valid(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** Basic totals require complete history. New metrics use only recorded appearances and expose coverage. */
export function aggregatePerformance(state: Pick<GameState, 'matchHistory' | 'challengeHistory' | 'season'>, playerId: string, period: PerformancePeriod, competition: PerformanceCompetition): PerformanceTotals {
  const totals = { appearances: 0, minutes: 0, wins: 0, resultsKnown: 0, ...Object.fromEntries(metrics.map(key => [key, 0])), ...Object.fromEntries(advancedMetrics.map(key => [key, null])), coverage: Object.fromEntries(advancedMetrics.map(key => [key, 0])), tackleRate: { success: 0, attempts: 0, matches: 0 }, chanceRate: { success: 0, attempts: 0, matches: 0 } } as PerformanceTotals
  const seen = new Set<string>()
  for (const record of [...(state.matchHistory ?? []), ...(state.challengeHistory ?? [])]) {
    if (period === 'season' && (record.seasonIndex ?? 1) !== state.season.index) continue
    if (competition !== 'all' && category(record) !== competition) continue
    if (record.id && seen.has(record.id)) continue
    const stats = (record.playerStats ?? []).find(row => belongs(row, playerId) && valid(row.minutes) && row.minutes > 0)
    if (!stats) continue
    if (record.id) seen.add(record.id)
    totals.appearances++
    totals.minutes += stats.minutes
    if ((stats.side === 'home' || stats.side === 'away') && valid(record.score?.home) && valid(record.score?.away)) {
      totals.resultsKnown++
      if (record.score[stats.side] > record.score[stats.side === 'home' ? 'away' : 'home']) totals.wins++
    }
    for (const key of metrics) {
      // 两代引擎从初版起只在领牌时写入字段；缺省表示零，不能误当成旧数据缺失。
      const value = key === 'yellowCards' || key === 'redCards' ? stats[key] ?? 0 : stats[key]
      if (!valid(value)) totals[key] = null
      else if (totals[key] !== null) totals[key] += value
    }
    for (const key of advancedMetrics) {
      const value = stats[key]
      if (!valid(value) || (key === 'rating' && (value < 1 || value > 10))) continue
      totals[key] = (totals[key] ?? 0) + value
      totals.coverage[key]++
    }
    if (valid(stats.tackles) && valid(stats.tackleAttempts) && stats.tackles <= stats.tackleAttempts) {
      totals.tackleRate.success += stats.tackles
      totals.tackleRate.attempts += stats.tackleAttempts
      totals.tackleRate.matches++
    }
    if (valid(stats.chancesCreated) && valid(stats.chancesConverted) && stats.chancesConverted <= stats.chancesCreated) {
      totals.chanceRate.success += stats.chancesConverted
      totals.chanceRate.attempts += stats.chancesCreated
      totals.chanceRate.matches++
    }
  }
  if (!totals.appearances) for (const key of metrics) totals[key] = null
  return totals
}

const number = (value: number | null, digits = 0): string => value === null || !Number.isFinite(value) ? '—' : value.toFixed(digits)
const ratio = (numerator: number | null, denominator: number | null, scale: number, digits: number, suffix = ''): string =>
  numerator === null || denominator === null || denominator <= 0 || numerator < 0 || numerator > denominator && scale === 100 ? '—' : `${number(numerator / denominator * scale, digits)}${suffix}`
const per90 = (value: number | null, minutes: number): string => ratio(value, minutes, 90, 2)
const percent = (value: number | null, total: number | null): string => ratio(value, total, 100, 0, '%')
export const averageRating = (total: PerformanceTotals): number | null => total.rating !== null && total.coverage.rating > 0 ? total.rating / total.coverage.rating : null
const coverage = (matches: number, appearances: number): string => `（${matches}/${appearances} 场）`
const item = (label: string, value: string): string => `<div class="pp-item"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`
const block = (title: string, accent: string, primary: string, label: string, details: string, ringLabel: string, numerator: number | null, denominator: number | null): string => {
  const ratioValue = numerator !== null && denominator !== null && denominator > 0 && numerator >= 0 && numerator <= denominator ? numerator / denominator : null
  const rate = ratioValue === null ? '—' : `${Math.round(ratioValue * 100)}%`
  return `<section class="pp-block pp-${accent}"><h3>${esc(title)}</h3><div class="pp-block-body"><div class="pp-primary"><strong>${esc(primary)}</strong><span>${esc(label)}</span><div class="pp-ring-row"><span class="pp-ring ${ratioValue === null ? 'pp-ring-unknown' : ''}" style="--pp-progress:${Math.round((ratioValue ?? 0) * 100)}%" role="img" aria-label="${esc(ringLabel)} ${esc(rate)}"><b>${esc(rate)}</b></span><span>${esc(ringLabel)}</span></div></div><div class="pp-details">${details}</div></div></section>`
}

export function renderPlayerPerformance(player: Player, period: PerformancePeriod, competition: PerformanceCompetition): string {
  const total = aggregatePerformance(game, player.id, period, competition)
  const rows = competitions.map(({ id, label }) => {
    const t = aggregatePerformance(game, player.id, period, id)
    return `<tr data-performance-competition="${esc(id)}" class="${id === competition ? 'is-active' : ''}"><th scope="row"><button type="button" data-performance-competition="${esc(id)}" aria-pressed="${id === competition}"><span class="pp-radio" aria-hidden="true"></span>${esc(label)}</button></th><td>${t.appearances}</td><td>${number(t.goals)}</td><td>${number(t.assists)}</td><td>${number(t.shots)}</td><td>${number(t.yellowCards)}</td><td>${number(t.redCards)}</td><td>${percent(t.passesCompleted, t.passes)}</td></tr>`
  }).join('')
  return `<section class="player-performance" aria-label="${esc(player.name)}的比赛表现">
    <header class="pp-header"><div><span class="pp-eyebrow">PLAYER PERFORMANCE</span><h2>${esc(player.name)} · 比赛表现</h2></div><div class="pp-toggle" aria-label="统计时段">${(['season', 'career'] as const).map(p => `<button type="button" data-performance-period="${p}" aria-pressed="${p === period}" class="${p === period ? 'is-active' : ''}">${p === 'season' ? '本赛季' : '生涯'}</button>`).join('')}</div></header>
    <p class="pp-note">仅统计已保存战报和实际出场；未收录场次不计入，无法计算时显示 —。新增数据仅汇总有记录的场次，括号为已记录 / 出场场次。创造机会指直接创造队友射门的传球，预期助攻为这些射门的 xG 之和；抢断尝试含上抢犯规。评分为依据进球、助攻、射正、传球、防守、扑救和红黄牌计算的游戏估算。胜场按常规比分计算。</p>
    <div class="pp-table-wrap"><table class="pp-table"><thead><tr><th scope="col">比赛</th><th scope="col">出场</th><th scope="col">进球</th><th scope="col">助攻</th><th scope="col">射门</th><th scope="col">黄牌</th><th scope="col">红牌</th><th scope="col">传球成功率</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="pp-summary"><h3>赛事数据 <span>${esc(competitions.find(c => c.id === competition)?.label ?? '')}</span></h3><div class="pp-summary-grid">${item('出场', number(total.appearances))}${item('胜场 / 已知赛果', `${total.wins} / ${total.resultsKnown}`)}${item('出场时间', `${number(total.minutes)} 分钟`)}${item('触球', number(total.touches))}${item('跑动距离 / 90（米）', per90(total.distance, total.minutes))}</div></div>
    <div class="pp-analytics">
      ${block('进攻', 'violet', number(total.goals), '进球', item('射门', number(total.shots)) + item('进球 / 90', per90(total.goals, total.minutes)) + item(`射正${coverage(total.coverage.shotsOnTarget, total.appearances)}`, number(total.shotsOnTarget)), '射门转化率', total.goals, total.shots)}
      ${block('组织', 'lime', number(total.assists), '助攻', item('助攻 / 90', per90(total.assists, total.minutes)) + item(`创造机会${coverage(total.coverage.chancesCreated, total.appearances)}`, number(total.chancesCreated)) + item(`预期助攻${coverage(total.coverage.xa, total.appearances)}`, number(total.xa, 2)), `机会转化率${coverage(total.chanceRate.matches, total.appearances)}`, total.chanceRate.success, total.chanceRate.attempts)}
      ${block('传球', 'cyan', number(total.passesCompleted), '成功传球', item('传球', number(total.passes)) + item('成功传球', number(total.passesCompleted)) + item('成功传球 / 90', per90(total.passesCompleted, total.minutes)), '传球成功率', total.passesCompleted, total.passes)}
      ${block('防守', 'rose', number(total.tackles), '抢断', item('拦截', number(total.interceptions)) + item('抢断 / 90', per90(total.tackles, total.minutes)) + item(`抢断成功率${coverage(total.tackleRate.matches, total.appearances)}`, percent(total.tackleRate.success, total.tackleRate.attempts)), `抢断成功率${coverage(total.tackleRate.matches, total.appearances)}`, total.tackleRate.success, total.tackleRate.attempts)}
    </div><div class="pp-bottom">${item('进球 / 90', per90(total.goals, total.minutes))}${item('射门 / 90', per90(total.shots, total.minutes))}${item('拦截 / 90', per90(total.interceptions, total.minutes))}${item('胜率（已知赛果）', percent(total.wins, total.resultsKnown))}${item(`预期进球${coverage(total.coverage.xg, total.appearances)}`, number(total.xg, 2))}${item(`平均评分${coverage(total.coverage.rating, total.appearances)}`, number(averageRating(total), 1))}</div>
  </section>`
}
