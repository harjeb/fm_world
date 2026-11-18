import { ALL_ATTRIBUTES, GK_ATTRIBUTES, type GameState } from '../../game/types.ts'
import { MAX_SCOUT_REPORTS, SCOUT_LEVELS, type ScoutSource, type VisibleScoutReport } from '../../game/scouting.ts'
import { preferredPositionRatings, type ScoutSubject } from '../../game/scout-rating.ts'
import { DETAILED_POSITION_LABELS } from '../../game/detailed-positions.ts'
import { ROLES } from '../../game/data/roles.ts'
import { isMainAttr } from '../../game/scale.ts'
import { serverNow } from '../../online.ts'
import { game } from '../state.ts'
import { attrLabel, countdownText, esc } from '../format.ts'
import { starRating } from '../stars.ts'

const sourceName: Record<ScoutSource, string> = { club: '球队', transfer: '转会', market: '自由市场' }

/** 只使用传入的属性，球探报告不能从真实球员补回隐藏值。 */
export function renderRelativePositionRatings(subject: ScoutSubject, roster: GameState['roster']): string {
  const ratings = preferredPositionRatings(subject, roster)
  const stars = ratings.length ? ratings.map((r, i) => `<div>${i === 0 ? '<strong>最佳位置（有本队参照）：</strong>' : ''}${esc(DETAILED_POSITION_LABELS[r.position])} ${esc(r.position)} ${starRating(r.stars, `${DETAILED_POSITION_LABELS[r.position]}位置能力`, true)} <span class="muted small">${esc(ROLES[r.role].label)}</span></div>`).join('') : '—（本队该位置可踢球员不足或数据未知）'
  return `<div class="scout-ratings">相对本队：${stars}</div><p class="hint">以本队同位置最多三名最强可踢球员为参照，3 星为该参照水平；不同位置或本队实力变化时星级会变化。未列出的位置可能因球员熟练度、本队可踢球员不足或属性未知而无法比较（—）。</p>`
}

/** Render only information actually delivered by the server and whose deadline has passed. */
export function renderScoutReport(report: VisibleScoutReport, roster: GameState['roster'], now: number): string {
  const ready = Number.isFinite(now) && report.readyAt <= now && 'estimatedAttrs' in report && !!report.estimatedAttrs
  const heading = `<b>${esc(report.playerName)}</b> · ${sourceName[report.source]}${report.clubId ? ` (${esc(report.clubId)})` : ''} · ${report.level}级 · ${esc(report.snapshotLabel)} · 发起于 ${esc(new Date(report.startedAt).toLocaleString())}`
  const deleteButton = Number.isFinite(now) && report.readyAt <= now ? `<button class="btn small scout-delete" data-action="scout-delete" data-report="${esc(report.id)}">删除报告</button>` : ''
  if (!ready) return `<article class="scout-report">${heading}${deleteButton}<p>考察中 / 等待报告刷新 · <span data-countdown-end="${report.readyAt}">${countdownText(Math.max(0, report.readyAt - now))}</span></p></article>`
  const attrs = report.estimatedAttrs
  const gk = 'isGk' in report && report.isGk === true
  const hidden = ALL_ATTRIBUTES.filter(key => !isMainAttr(key, gk) && (gk || !(GK_ATTRIBUTES as readonly string[]).includes(key)))
  const rating = 'positions' in report && report.positions ? renderRelativePositionRatings({ attrs, positions: report.positions, detailedPositions: 'detailedPositions' in report ? report.detailedPositions : undefined }, roster) : '<p>位置评分：—（数据不足）</p>'
  return `<article class="scout-report">${heading}${deleteButton}<p>报告产生时间 ${esc(new Date(report.readyAt).toLocaleString())} · 估计属性有随机误差（±${SCOUT_LEVELS.find(x => x.level === report.level)?.maxError ?? '—'}）</p>${rating}<div class="scout-attrs">${hidden.map(key => `<span>${esc(attrLabel(key))} <b>${typeof attrs[key] === 'number' && Number.isFinite(attrs[key]) ? attrs[key] : '—'}</b></span>`).join('')}</div></article>`
}

export function renderScoutControls(playerId: string, source: ScoutSource, clubId?: string): string {
  const now = serverNow()
  const reports = (game.scoutReports ?? []).filter(r => r.playerId === playerId && r.source === source && (r.clubId ?? '') === (clubId ?? '')).sort((a, b) => b.startedAt - a.startedAt)
  const pending = reports.some(r => r.readyAt > now)
  return `<section class="scout-section"><h3>球探考察</h3><p class="hint">${source === 'club' ? '考察当前装备版本。' : '考察可购买的原始版本。'}隐藏属性为估计值，误差可能影响星级；考察不保证签约成功。</p><div class="scout-controls"><label>球探等级 <select data-scout-level data-keep-value>${SCOUT_LEVELS.map(x => `<option value="${x.level}">${x.level}级 · ${x.fee.toLocaleString()} · ${x.hours}小时 · ±${x.maxError}</option>`).join('')}</select></label><button class="btn small primary" data-action="scout-start" data-player="${esc(playerId)}" data-source="${source}"${clubId ? ` data-club="${esc(clubId)}"` : ''} ${pending ? 'disabled' : ''}>确认考察</button></div>${reports.map(r => renderScoutReport(r, game.roster, now)).join('')}</section>`
}

export function renderScoutPanel(): string {
  const now = serverNow()
  const reports = [...(game.scoutReports ?? [])].sort((a, b) => b.startedAt - a.startedAt)
  return `<section class="panel scout-panel"><h2>球探报告 <button class="btn small" data-action="scout-refresh">刷新报告</button></h2><p class="hint">报告容量 ${reports.length}/${MAX_SCOUT_REPORTS}（含进行中）；满额后请删除已完成报告再委托。删除不返费，可能结束该报告的市场暂留。</p>${reports.length ? reports.map(r => renderScoutReport(r, game.roster, now)).join('') : '<p class="muted">暂无球探报告。</p>'}</section>`
}
