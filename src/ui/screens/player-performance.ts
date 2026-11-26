import type { GameState, MatchRecord, Player, PlayerMatchStats } from '../../game/types.ts'
import { isOfficialPlayerStatRecord, matchKeeperConceded } from '../../game/player-stats.ts'
import { game } from '../state.ts'
import { esc } from '../format.ts'

export type PerformanceCompetition = 'all' | 'league' | 'cup'
export type PerformancePeriod = 'season' | 'career'

type Metric = 'goals' | 'assists' | 'shots' | 'passes' | 'passesCompleted' | 'tackles' | 'interceptions' | 'distance' | 'touches' | 'yellowCards' | 'redCards'
const metrics: Metric[] = ['goals', 'assists', 'shots', 'passes', 'passesCompleted', 'tackles', 'interceptions', 'distance', 'touches', 'yellowCards', 'redCards']
export type AdvancedMetric = 'shotsOnTarget' | 'xg' | 'chancesCreated' | 'chancesConverted' | 'xa' | 'tackleAttempts' | 'rating' | 'saves' | 'goalsConceded' | 'claims' | 'xgConceded'
const directAdvancedMetrics: Exclude<AdvancedMetric, 'goalsConceded'>[] = ['shotsOnTarget', 'xg', 'chancesCreated', 'chancesConverted', 'xa', 'tackleAttempts', 'rating', 'saves', 'claims', 'xgConceded']
const advancedMetrics: AdvancedMetric[] = [...directAdvancedMetrics, 'goalsConceded']
type RateTotals = { success: number; attempts: number; matches: number }
type DeltaTotals = { value: number; matches: number }
export type PerformanceTotals = {
  appearances: number
  minutes: number
  wins: number
  resultsKnown: number
  cleanSheets: number
  coverage: Record<AdvancedMetric, number>
  metricMinutes: { saves: number; goalsConceded: number }
  tackleRate: RateTotals
  chanceRate: RateTotals
  saveRate: RateTotals
  goalsPrevented: DeltaTotals
} & Record<Metric | AdvancedMetric, number | null>
const competitions: { id: PerformanceCompetition; label: string }[] = [
  { id: 'all', label: '全部正式赛' },
  { id: 'league', label: '联赛' },
  { id: 'cup', label: '赛季杯赛' },
]

function category(record: MatchRecord): PerformanceCompetition {
  return record.isLeague ? 'league' : 'cup'
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
  const totals = {
    appearances: 0,
    minutes: 0,
    wins: 0,
    resultsKnown: 0,
    cleanSheets: 0,
    ...Object.fromEntries(metrics.map(key => [key, 0])),
    ...Object.fromEntries(advancedMetrics.map(key => [key, null])),
    coverage: Object.fromEntries(advancedMetrics.map(key => [key, 0])),
    metricMinutes: { saves: 0, goalsConceded: 0 },
    tackleRate: { success: 0, attempts: 0, matches: 0 },
    chanceRate: { success: 0, attempts: 0, matches: 0 },
    saveRate: { success: 0, attempts: 0, matches: 0 },
    goalsPrevented: { value: 0, matches: 0 },
  } as PerformanceTotals
  const seen = new Set<string>()
  for (const record of [...(state.matchHistory ?? []), ...(state.challengeHistory ?? [])]) {
    if (!isOfficialPlayerStatRecord(record)) continue
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
    for (const key of directAdvancedMetrics) {
      const value = stats[key]
      if (!valid(value) || (key === 'rating' && (value < 1 || value > 10))) continue
      totals[key] = (totals[key] ?? 0) + value
      totals.coverage[key]++
    }
    if (valid(stats.saves)) totals.metricMinutes.saves += stats.minutes
    const { conceded, cleanSheet } = matchKeeperConceded(record, stats)
    if (conceded !== null) {
      totals.goalsConceded = (totals.goalsConceded ?? 0) + conceded
      totals.coverage.goalsConceded++
      totals.metricMinutes.goalsConceded += stats.minutes
      if (cleanSheet) totals.cleanSheets++
    }
    if (valid(stats.saves) && conceded !== null) {
      totals.saveRate.success += stats.saves
      totals.saveRate.attempts += stats.saves + conceded
      totals.saveRate.matches++
    }
    if (valid(stats.xgConceded) && conceded !== null) {
      totals.goalsPrevented.value += stats.xgConceded - conceded
      totals.goalsPrevented.matches++
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
const signedNumber = (value: number | null, digits = 2): string => {
  if (value === null || !Number.isFinite(value)) return '—'
  const rounded = Math.abs(value) < 1e-9 ? 0 : value
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(digits)}`
}
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

function renderKeeperPerformance(player: Player, period: PerformancePeriod, competition: PerformanceCompetition, total: PerformanceTotals): string {
  const rows = competitions.map(({ id, label }) => {
    const t = aggregatePerformance(game, player.id, period, id)
    const clean = t.coverage.goalsConceded > 0 ? number(t.cleanSheets) : '—'
    const cards = t.appearances > 0 ? `${number(t.yellowCards)} / ${number(t.redCards)}` : '—'
    return `<tr data-performance-competition="${esc(id)}" class="${id === competition ? 'is-active' : ''}"><th scope="row"><button type="button" data-performance-competition="${esc(id)}" aria-pressed="${id === competition}"><span class="pp-radio" aria-hidden="true"></span>${esc(label)}</button></th><td>${t.appearances}</td><td>${number(t.saves)}</td><td>${number(t.goalsConceded)}</td><td>${clean}</td><td>${percent(t.saveRate.success, t.saveRate.attempts)}</td><td>${cards}</td><td>${percent(t.passesCompleted, t.passes)}</td></tr>`
  }).join('')
  const cleanCount = total.coverage.goalsConceded > 0 ? number(total.cleanSheets) : '—'
  const cleanNum = total.coverage.goalsConceded > 0 ? total.cleanSheets : null
  const faced = total.saveRate.matches > 0 ? number(total.saveRate.attempts) : '—'
  const prevented = total.goalsPrevented.matches > 0 ? signedNumber(total.goalsPrevented.value, 2) : '—'
  return `<section class="player-performance" aria-label="${esc(player.name)}的比赛表现">
    <header class="pp-header"><div><span class="pp-eyebrow">GOALKEEPER PERFORMANCE</span><h2>${esc(player.name)} · 比赛表现</h2></div><div class="pp-toggle" aria-label="统计时段">${(['season', 'career'] as const).map(p => `<button type="button" data-performance-period="${p}" aria-pressed="${p === period}" class="${p === period ? 'is-active' : ''}">${p === 'season' ? '本赛季' : '生涯'}</button>`).join('')}</div></header>
    <p class="pp-note">仅统计正式赛事（联赛与赛季杯赛）的已保存战报和实际出场，不计入挑战数据；未收录场次不计入，无法计算时显示 —。新增数据仅汇总有记录的场次，括号为已记录 / 出场场次。零封指单场出场不少于 60 分钟且未失球；扑救成功率 = 扑救 ÷ (扑救 + 失球)；阻止失球 = 面对预期失球 − 实际失球（正值代表扑救表现优于预期）；出击摘球指主动出击没收传中或高空球。评分为依据扑救、传球和红黄牌计算的游戏估算。胜场按常规比分计算。</p>
    <div class="pp-table-wrap"><table class="pp-table"><thead><tr><th scope="col">比赛</th><th scope="col">出场</th><th scope="col">扑救</th><th scope="col">失球</th><th scope="col">零封</th><th scope="col">扑救成功率</th><th scope="col">黄 / 红牌</th><th scope="col">传球成功率</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="pp-summary"><h3>门将赛事数据 <span>${esc(competitions.find(c => c.id === competition)?.label ?? '')}</span></h3><div class="pp-summary-grid">${item('出场', number(total.appearances))}${item('胜场 / 已知赛果', `${total.wins} / ${total.resultsKnown}`)}${item('出场时间', `${number(total.minutes)} 分钟`)}${item(`零封${coverage(total.coverage.goalsConceded, total.appearances)}`, cleanCount)}${item('触球', number(total.touches))}</div></div>
    <div class="pp-analytics">
      ${block('门线扑救', 'violet', number(total.saves), '扑救', item(`面对射正${coverage(total.saveRate.matches, total.appearances)}`, faced) + item(`扑救 / 90${coverage(total.coverage.saves, total.appearances)}`, per90(total.saves, total.metricMinutes.saves)) + item(`扑救成功率${coverage(total.saveRate.matches, total.appearances)}`, percent(total.saveRate.success, total.saveRate.attempts)), `扑救成功率${coverage(total.saveRate.matches, total.appearances)}`, total.saveRate.matches > 0 ? total.saveRate.success : null, total.saveRate.attempts)}
      ${block('失球与零封', 'lime', cleanCount, '零封', item(`失球${coverage(total.coverage.goalsConceded, total.appearances)}`, number(total.goalsConceded)) + item(`失球 / 90${coverage(total.coverage.goalsConceded, total.appearances)}`, per90(total.goalsConceded, total.metricMinutes.goalsConceded)) + item(`阻止失球${coverage(total.goalsPrevented.matches, total.appearances)}`, prevented), `零封率${coverage(total.coverage.goalsConceded, total.appearances)}`, cleanNum, total.coverage.goalsConceded)}
      ${block('出球组织', 'cyan', number(total.passesCompleted), '成功传球', item('传球', number(total.passes)) + item('成功传球', number(total.passesCompleted)) + item('成功传球 / 90', per90(total.passesCompleted, total.minutes)), '传球成功率', total.passesCompleted, total.passes)}
      ${block('禁区控制', 'rose', number(total.claims), '出击摘球', item(`出击摘球${coverage(total.coverage.claims, total.appearances)}`, number(total.claims)) + item('拦截', number(total.interceptions)) + item('跑动距离 / 90（米）', per90(total.distance, total.minutes)), '胜率（已知赛果）', total.wins, total.resultsKnown)}
    </div><div class="pp-bottom">${item(`扑救 / 90${coverage(total.coverage.saves, total.appearances)}`, per90(total.saves, total.metricMinutes.saves))}${item(`失球 / 90${coverage(total.coverage.goalsConceded, total.appearances)}`, per90(total.goalsConceded, total.metricMinutes.goalsConceded))}${item(`零封率${coverage(total.coverage.goalsConceded, total.appearances)}`, percent(cleanNum, total.coverage.goalsConceded))}${item('胜率（已知赛果）', percent(total.wins, total.resultsKnown))}${item(`面对预期失球${coverage(total.coverage.xgConceded, total.appearances)}`, number(total.xgConceded, 2))}${item(`平均评分${coverage(total.coverage.rating, total.appearances)}`, number(averageRating(total), 1))}</div>
  </section>`
}

export function renderPlayerPerformance(player: Player, period: PerformancePeriod, competition: PerformanceCompetition): string {
  const activeCompetition: PerformanceCompetition = competitions.some(c => c.id === competition) ? competition : 'all'
  const total = aggregatePerformance(game, player.id, period, activeCompetition)
  if ((player.positions?.GK ?? 0) > 0) return renderKeeperPerformance(player, period, activeCompetition, total)
  const rows = competitions.map(({ id, label }) => {
    const t = aggregatePerformance(game, player.id, period, id)
    return `<tr data-performance-competition="${esc(id)}" class="${id === activeCompetition ? 'is-active' : ''}"><th scope="row"><button type="button" data-performance-competition="${esc(id)}" aria-pressed="${id === activeCompetition}"><span class="pp-radio" aria-hidden="true"></span>${esc(label)}</button></th><td>${t.appearances}</td><td>${number(t.goals)}</td><td>${number(t.assists)}</td><td>${number(t.shots)}</td><td>${number(t.yellowCards)}</td><td>${number(t.redCards)}</td><td>${percent(t.passesCompleted, t.passes)}</td></tr>`
  }).join('')
  return `<section class="player-performance" aria-label="${esc(player.name)}的比赛表现">
    <header class="pp-header"><div><span class="pp-eyebrow">PLAYER PERFORMANCE</span><h2>${esc(player.name)} · 比赛表现</h2></div><div class="pp-toggle" aria-label="统计时段">${(['season', 'career'] as const).map(p => `<button type="button" data-performance-period="${p}" aria-pressed="${p === period}" class="${p === period ? 'is-active' : ''}">${p === 'season' ? '本赛季' : '生涯'}</button>`).join('')}</div></header>
    <p class="pp-note">仅统计正式赛事（联赛与赛季杯赛）的已保存战报和实际出场，不计入挑战数据；未收录场次不计入，无法计算时显示 —。新增数据仅汇总有记录的场次，括号为已记录 / 出场场次。创造机会指直接创造队友射门的传球，预期助攻为这些射门的 xG 之和；抢断尝试含上抢犯规。评分为依据进球、助攻、射正、传球、防守、扑救和红黄牌计算的游戏估算。胜场按常规比分计算。</p>
    <div class="pp-table-wrap"><table class="pp-table"><thead><tr><th scope="col">比赛</th><th scope="col">出场</th><th scope="col">进球</th><th scope="col">助攻</th><th scope="col">射门</th><th scope="col">黄牌</th><th scope="col">红牌</th><th scope="col">传球成功率</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="pp-summary"><h3>赛事数据 <span>${esc(competitions.find(c => c.id === activeCompetition)?.label ?? '')}</span></h3><div class="pp-summary-grid">${item('出场', number(total.appearances))}${item('胜场 / 已知赛果', `${total.wins} / ${total.resultsKnown}`)}${item('出场时间', `${number(total.minutes)} 分钟`)}${item('触球', number(total.touches))}${item('跑动距离 / 90（米）', per90(total.distance, total.minutes))}</div></div>
    <div class="pp-analytics">
      ${block('进攻', 'violet', number(total.goals), '进球', item('射门', number(total.shots)) + item('进球 / 90', per90(total.goals, total.minutes)) + item(`射正${coverage(total.coverage.shotsOnTarget, total.appearances)}`, number(total.shotsOnTarget)), '射门转化率', total.goals, total.shots)}
      ${block('组织', 'lime', number(total.assists), '助攻', item('助攻 / 90', per90(total.assists, total.minutes)) + item(`创造机会${coverage(total.coverage.chancesCreated, total.appearances)}`, number(total.chancesCreated)) + item(`预期助攻${coverage(total.coverage.xa, total.appearances)}`, number(total.xa, 2)), `机会转化率${coverage(total.chanceRate.matches, total.appearances)}`, total.chanceRate.success, total.chanceRate.attempts)}
      ${block('传球', 'cyan', number(total.passesCompleted), '成功传球', item('传球', number(total.passes)) + item('成功传球', number(total.passesCompleted)) + item('成功传球 / 90', per90(total.passesCompleted, total.minutes)), '传球成功率', total.passesCompleted, total.passes)}
      ${block('防守', 'rose', number(total.tackles), '抢断', item('拦截', number(total.interceptions)) + item('抢断 / 90', per90(total.tackles, total.minutes)) + item(`抢断成功率${coverage(total.tackleRate.matches, total.appearances)}`, percent(total.tackleRate.success, total.tackleRate.attempts)), `抢断成功率${coverage(total.tackleRate.matches, total.appearances)}`, total.tackleRate.success, total.tackleRate.attempts)}
    </div><div class="pp-bottom">${item('进球 / 90', per90(total.goals, total.minutes))}${item('射门 / 90', per90(total.shots, total.minutes))}${item('拦截 / 90', per90(total.interceptions, total.minutes))}${item('胜率（已知赛果）', percent(total.wins, total.resultsKnown))}${item(`预期进球${coverage(total.coverage.xg, total.appearances)}`, number(total.xg, 2))}${item(`平均评分${coverage(total.coverage.rating, total.appearances)}`, number(averageRating(total), 1))}</div>
  </section>`
}
