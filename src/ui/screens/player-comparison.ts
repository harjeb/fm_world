import { ATTR_GROUPS, ATTR_META, POSITION_LABELS } from '../../game/data/attributes.ts'
import { attrRating, isMainAttr } from '../../game/scale.ts'
import { DETAILED_POSITIONS, DETAILED_POSITION_LABELS, detailedPositionValue } from '../../game/detailed-positions.ts'
import type { DetailedPosition } from '../../game/types.ts'
import { GK_ATTRIBUTES, POSITIONS, type AttrKey, type Player, type Position } from '../../game/types.ts'
import { bestMarketValue } from '../../game/market.ts'
import { countryLabel } from '../components.ts'
import { esc } from '../format.ts'
import { game } from '../state.ts'
import { aggregatePerformance, averageRating, type AdvancedMetric, type PerformanceTotals } from './player-performance.ts'

export type CompareTab = 'overview' | 'attributes' | 'stats' | 'positions'

/** 对比只使用本队阵容及其当前球员数据。 */
export function comparisonCandidates(): Player[] {
  return [...new Map(game.roster.map(player => [player.id, player])).values()]
}

const tabs: [CompareTab, string][] = [['overview', '总览'], ['attributes', '属性'], ['stats', '数据'], ['positions', '位置']]
const fieldRadar: AttrKey[] = ['shooting', 'dribbling', 'speed', 'acceleration', 'strength', 'tackling', 'passing']
const keeperRadar: AttrKey[] = ['reflexes', 'handling', 'composure', 'passing', 'rushing', 'oneOnOne']
const isKeeper = (p: Player) => (p.positions?.GK ?? 0) > 0
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value * 10) / 10) : '—'
const mainPosition = (p: Player): Position | undefined => [...POSITIONS].sort((a, b) => (p.positions[b] ?? 0) - (p.positions[a] ?? 0)).find(pos => p.positions[pos] > 0)
const positionName = (p: Player) => { const pos = mainPosition(p); return pos ? POSITION_LABELS[pos] : '位置未知' }
const attr = (p: Player | undefined, key: AttrKey) => {
  if (!p || (!isKeeper(p) && (GK_ATTRIBUTES as readonly string[]).includes(key)) || !Number.isFinite(p.attrs[key])) return undefined
  return attrRating(key, p.attrs[key], isKeeper(p))
}

function identity(p: Player | undefined, side: string): string {
  if (!p) return `<article class="pc-identity pc-empty"><span>对比球员</span><strong>请选择球员</strong></article>`
  const contract = p.contract ? `工资 / 轮 ${number(p.contract.wage)} · 合同至第 ${number(p.contract.expiresSeason)} 赛季` : '合同信息不可用'
  const value = bestMarketValue(game, p)
  return `<article class="pc-identity"><div class="pc-avatar ${side}" aria-hidden="true">${esc(positionName(p).slice(0, 1))}</div><div><span class="pc-eyebrow">${side === 'pc-first' ? '球员' : '对比球员'}</span><h2>${esc(p.name)}</h2><p>${esc(positionName(p))} · ${esc(countryLabel(p))} · ${p.age == null ? '年龄未知' : `${esc(number(p.age))}岁`}</p><small>估值 ${value ? value.toLocaleString() : '—'} · ${esc(contract)}</small></div></article>`
}

const spots: Record<DetailedPosition, [number, number]> = { GK: [50, 96], DL: [18, 78], DC: [50, 78], DR: [82, 78], WBL: [18, 66], WBR: [82, 66], DM: [50, 66], ML: [18, 53], MC: [50, 53], MR: [82, 53], AML: [18, 37], AMC: [50, 37], AMR: [82, 37], ST: [50, 20] }
function pitch(p?: Player): string {
  return `<svg class="pc-pitch" viewBox="0 0 100 110" role="img" aria-label="位置分布"><rect x="2" y="2" width="96" height="106" rx="2"/><path d="M2 55H98 M35 2V16H65V2 M35 108V94H65V108"/><circle cx="50" cy="55" r="12"/>${DETAILED_POSITIONS.map(pos => { const [x, y] = spots[pos]; const value = p ? detailedPositionValue(p, pos) : 0; const tier = value >= 85 ? 5 : value >= 65 ? 4 : value >= 40 ? 3 : value > 0 ? 2 : 1; return `<g><title>${DETAILED_POSITION_LABELS[pos]}：${p ? esc(number(value)) : '—'}</title><circle class="pc-spot pc-spot-${tier}" cx="${x}" cy="${y}" r="5"/><text class="pc-spot-value" x="${x}" y="${y + 1.3}" text-anchor="middle">${p ? esc(number(value)) : '—'}</text></g>` }).join('')}</svg>`
}

function radar(p: Player, other?: Player): string {
  // Mixed pairs use common outfield axes; each player's own scale is retained.
  const keys = isKeeper(p) && (!other || isKeeper(other)) ? keeperRadar : fieldRadar
  const point = (i: number, scale: number) => { const a = -Math.PI / 2 + i * Math.PI * 2 / keys.length; return [150 + Math.cos(a) * 94 * scale, 150 + Math.sin(a) * 94 * scale] }
  const points = (scale: (i: number) => number) => keys.map((_, i) => point(i, scale(i)).map(v => v.toFixed(1)).join(',')).join(' ')
  const shape = (target: Player, cls: string) => keys.every(key => attr(target, key) !== undefined) ? `<polygon class="${cls}" points="${points(i => Math.max(0, Math.min(1, attr(target, keys[i])! / 100)))}"/>` : ''
  return `<svg class="pc-radar" viewBox="0 0 300 300" role="img" aria-label="属性对比雷达图">${[.25, .5, .75, 1].map(n => `<polygon class="pc-radar-grid" points="${points(() => n)}"/>`).join('')}${keys.map((key, i) => { const [x, y] = point(i, 1); const [lx, ly] = point(i, 1.32); return `<line class="pc-radar-grid" x1="150" y1="150" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/><text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${esc(ATTR_META[key].label)}</text>` }).join('')}${shape(p, 'pc-shape-first')}${other ? shape(other, 'pc-shape-second') : ''}</svg>`
}

function recordedStats(p?: Player): PerformanceTotals | undefined {
  return p ? aggregatePerformance(game, p.id, 'season', 'all') : undefined
}
function statValue(t: PerformanceTotals | undefined, key: keyof PerformanceTotals): string {
  return t?.appearances ? number(t[key]) : '—'
}
function passRate(t?: PerformanceTotals): string {
  return t?.appearances && t.passes !== null && t.passesCompleted !== null && t.passes > 0 && t.passesCompleted <= t.passes
    ? `${Math.round(t.passesCompleted / t.passes * 100)}%` : '—'
}
function advancedValue(t: PerformanceTotals | undefined, key: AdvancedMetric, digits = 0): string {
  if (!t || !t.coverage[key]) return '—'
  const value = key === 'rating' ? averageRating(t) : t[key]
  return value === null ? '—' : `${value.toFixed(digits)}（${t.coverage[key]}/${t.appearances} 场）`
}
function tackleRate(t?: PerformanceTotals): string {
  const rate = t?.tackleRate
  return rate && rate.attempts > 0 ? `${Math.round(rate.success / rate.attempts * 100)}%（${rate.matches}/${t!.appearances} 场）` : '—'
}
function saveRate(t?: PerformanceTotals, withCoverage = true): string {
  const rate = t?.saveRate
  if (!rate || rate.attempts <= 0) return '—'
  const pct = `${Math.round(rate.success / rate.attempts * 100)}%`
  return withCoverage ? `${pct}（${rate.matches}/${t!.appearances} 场）` : pct
}
function cleanSheets(t?: PerformanceTotals): string {
  return t && t.coverage.goalsConceded > 0 ? `${t.cleanSheets}（${t.coverage.goalsConceded}/${t.appearances} 场）` : '—'
}
function cleanSheetRate(t?: PerformanceTotals): string {
  return t && t.coverage.goalsConceded > 0 ? `${Math.round(t.cleanSheets / t.coverage.goalsConceded * 100)}%（${t.coverage.goalsConceded}/${t.appearances} 场）` : '—'
}
function keeperPer90(t: PerformanceTotals | undefined, key: 'saves' | 'goalsConceded'): string {
  if (!t || !t.coverage[key] || t.metricMinutes[key] <= 0 || t[key] === null) return '—'
  return `${((t[key]! / t.metricMinutes[key]) * 90).toFixed(2)}（${t.coverage[key]}/${t.appearances} 场）`
}
function goalsPrevented(t?: PerformanceTotals): string {
  if (!t || !t.goalsPrevented.matches) return '—'
  const val = Math.abs(t.goalsPrevented.value) < 1e-9 ? 0 : t.goalsPrevented.value
  return `${val > 0 ? '+' : ''}${val.toFixed(2)}（${t.goalsPrevented.matches}/${t.appearances} 场）`
}
function statTable(p: Player, other?: Player): string {
  const first = recordedStats(p), second = recordedStats(other)
  const bothKeepers = isKeeper(p) && (!other || isKeeper(other))
  const mixed = !!other && isKeeper(p) !== isKeeper(other)
  const gkCell = (target: Player | undefined, stats: PerformanceTotals | undefined, fn: (t: PerformanceTotals) => string): string =>
    target && isKeeper(target) && stats ? fn(stats) : '—'
  const rows: [string, string, string][] = bothKeepers
    ? [
        ['出场', statValue(first, 'appearances'), statValue(second, 'appearances')],
        ['出场时间（分钟）', statValue(first, 'minutes'), statValue(second, 'minutes')],
        ['扑救', advancedValue(first, 'saves', 0), advancedValue(second, 'saves', 0)],
        ['失球', advancedValue(first, 'goalsConceded', 0), advancedValue(second, 'goalsConceded', 0)],
        ['零封', cleanSheets(first), cleanSheets(second)],
        ['扑救成功率', saveRate(first), saveRate(second)],
        ['零封率', cleanSheetRate(first), cleanSheetRate(second)],
        ['扑救 / 90', keeperPer90(first, 'saves'), keeperPer90(second, 'saves')],
        ['失球 / 90', keeperPer90(first, 'goalsConceded'), keeperPer90(second, 'goalsConceded')],
        ['面对预期失球', advancedValue(first, 'xgConceded', 2), advancedValue(second, 'xgConceded', 2)],
        ['阻止失球', goalsPrevented(first), goalsPrevented(second)],
        ['出击摘球', advancedValue(first, 'claims', 0), advancedValue(second, 'claims', 0)],
        ['传球', statValue(first, 'passes'), statValue(second, 'passes')],
        ['传球成功率', passRate(first), passRate(second)],
        ['拦截', statValue(first, 'interceptions'), statValue(second, 'interceptions')],
        ['评分', advancedValue(first, 'rating', 1), advancedValue(second, 'rating', 1)],
      ]
    : [
        ['出场', statValue(first, 'appearances'), statValue(second, 'appearances')],
        ['出场时间（分钟）', statValue(first, 'minutes'), statValue(second, 'minutes')],
        ...([['进球', 'goals'], ['助攻', 'assists'], ['射门', 'shots'], ['传球', 'passes'], ['抢断', 'tackles'], ['拦截', 'interceptions']] as const)
          .map(([label, key]): [string, string, string] => [label, statValue(first, key), statValue(second, key)]),
        ...([['射正', 'shotsOnTarget', 0], ['创造机会', 'chancesCreated', 0], ['预期进球', 'xg', 2], ['预期助攻', 'xa', 2], ['评分', 'rating', 1]] as const)
          .map(([label, key, digits]): [string, string, string] => [label, advancedValue(first, key, digits), advancedValue(second, key, digits)]),
        ['传球成功率', passRate(first), passRate(second)],
        ['抢断成功率', tackleRate(first), tackleRate(second)],
        ...(mixed
          ? [
              ['扑救', gkCell(p, first, t => advancedValue(t, 'saves', 0)), gkCell(other, second, t => advancedValue(t, 'saves', 0))] as [string, string, string],
              ['失球', gkCell(p, first, t => advancedValue(t, 'goalsConceded', 0)), gkCell(other, second, t => advancedValue(t, 'goalsConceded', 0))] as [string, string, string],
              ['零封', gkCell(p, first, cleanSheets), gkCell(other, second, cleanSheets)] as [string, string, string],
              ['扑救成功率', gkCell(p, first, t => saveRate(t)), gkCell(other, second, t => saveRate(t))] as [string, string, string],
              ['出击摘球', gkCell(p, first, t => advancedValue(t, 'claims', 0)), gkCell(other, second, t => advancedValue(t, 'claims', 0))] as [string, string, string],
            ]
          : []),
      ]
  return `<p class="pc-muted">仅统计本赛季正式赛事（联赛与赛季杯赛）的已保存战报，不计入挑战数据；新增数据只汇总有记录的场次，括号为已记录 / 出场场次；缺失数据以 — 显示。评分为游戏事件估算。</p><div class="pc-table-wrap"><table class="pc-table"><thead><tr><th>本赛季数据</th><th>${esc(p.name)}</th><th>${other ? esc(other.name) : '对比球员'}</th></tr></thead><tbody>${rows.map(([label, a, b]) => `<tr><th>${label}</th><td>${a}</td><td>${b}</td></tr>`).join('')}</tbody></table></div>`
}
function diffArrow(dir: 'up' | 'down', title: string): string {
  const path = dir === 'up' ? 'M1.8 6.6 5 3.4 8.2 6.6' : 'M1.8 3.4 5 6.6 8.2 3.4'
  const label = dir === 'up' ? '高于对比球员' : '低于对比球员'
  return `<span class="pc-diff pc-diff-${dir}" title="${esc(title)}" aria-label="${label}"><svg viewBox="0 0 10 10" width="11" height="11" aria-hidden="true"><path d="${path}"/></svg></span>`
}

function attributeTable(p: Player, other?: Player): string {
  const raw = (target: Player | undefined, key: AttrKey) => attr(target, key) === undefined ? '—' : number(target!.attrs[key])
  const isHiddenRow = (key: AttrKey) => !isMainAttr(key, isKeeper(p)) && (!other || !isMainAttr(key, isKeeper(other)))
  const eqSpacer = '<span class="pc-diff pc-diff-eq" aria-hidden="true"></span>'
  const attrCells = (key: AttrKey): string => {
    const aText = raw(p, key)
    const bText = raw(other, key)
    const aRating = attr(p, key)
    const bRating = attr(other, key)
    if (!other || aRating === undefined || bRating === undefined) {
      return `<td class="pc-attr-num pc-col-a"><span class="pc-attr-val"><span class="pc-num">${aText}</span>${eqSpacer}</span></td><td class="pc-attr-num pc-col-b"><span class="pc-attr-val"><span class="pc-num">${bText}</span>${eqSpacer}</span></td>`
    }
    const sameScale = isMainAttr(key, isKeeper(p)) === isMainAttr(key, isKeeper(other))
    const round1 = (v: number) => Math.round(v * 10) / 10
    const aCmp = round1(sameScale ? p.attrs[key] : aRating)
    const bCmp = round1(sameScale ? other.attrs[key] : bRating)
    const delta = round1(aCmp - bCmp)
    if (delta === 0) {
      return `<td class="pc-attr-num pc-col-a"><span class="pc-attr-val"><span class="pc-num">${aText}</span>${eqSpacer}</span></td><td class="pc-attr-num pc-col-b"><span class="pc-attr-val"><span class="pc-num">${bText}</span>${eqSpacer}</span></td>`
    }
    const absDelta = Math.abs(delta)
    const aTip = sameScale
      ? `${delta > 0 ? '高于' : '低于'}对比球员 ${delta > 0 ? '+' : '-'}${absDelta}`
      : `按百分评分${delta > 0 ? '高于' : '低于'}对比球员（${aCmp} vs ${bCmp}）`
    const bTip = sameScale
      ? `${delta < 0 ? '高于' : '低于'}主球员 ${delta < 0 ? '+' : '-'}${absDelta}`
      : `按百分评分${delta < 0 ? '高于' : '低于'}主球员（${bCmp} vs ${aCmp}）`
    const aArrow = diffArrow(delta > 0 ? 'up' : 'down', aTip)
    const bArrow = diffArrow(delta < 0 ? 'up' : 'down', bTip)
    return `<td class="pc-attr-num pc-col-a"><span class="pc-attr-val"><span class="pc-num">${aText}</span>${aArrow}</span></td><td class="pc-attr-num pc-col-b"><span class="pc-attr-val"><span class="pc-num">${bText}</span>${bArrow}</span></td>`
  }

  const maxRows = Math.max(...ATTR_GROUPS.map(group => group.attrs.length))
  const groupHeads = ATTR_GROUPS.map((group, idx) => `<th colspan="3" class="pc-group-head${idx > 0 ? ' pc-group-sep' : ''}">${esc(group.name)}</th>`).join('')
  const colHeads = ATTR_GROUPS.map((_, idx) => `<th class="pc-attr-col-label${idx > 0 ? ' pc-group-sep' : ''}">属性</th><th class="pc-attr-col-num pc-col-a" title="${esc(p.name)}">球员</th><th class="pc-attr-col-num pc-col-b" title="${other ? esc(other.name) : '对比球员'}">对比</th>`).join('')
  const bodyRows = Array.from({ length: maxRows }, (_, rowIndex) => {
    const cells = ATTR_GROUPS.map((group, gIdx) => {
      const sep = gIdx > 0 ? ' pc-group-sep' : ''
      const key = group.attrs[rowIndex]
      if (!key) return `<td colspan="3" class="pc-attr-empty${sep}"></td>`
      const hidden = isHiddenRow(key) ? ' pc-attr-hidden' : ''
      return `<th scope="row" class="pc-attr-name${sep}${hidden}" title="${esc(ATTR_META[key].desc)}">${esc(ATTR_META[key].label)}</th>${attrCells(key)}`
    }).join('')
    return `<tr>${cells}</tr>`
  }).join('')

  const legend = `<div class="pc-attr-bar"><p class="pc-muted">主属性（0–1500）与<span class="pc-hidden-note">淡紫色隐藏属性（0–20）</span>同表分列对比；绿上/红下箭头代表高低差异，外场球员门将属性不适用。</p><div class="pc-legend pc-attr-legend"><span><i class="pc-dot-first"></i>球员：${esc(p.name)}</span>${other ? `<span><i class="pc-dot-second"></i>对比：${esc(other.name)}</span>` : ''}</div></div>`
  return `${legend}<div class="pc-table-wrap"><table class="pc-table pc-attr-table"><thead><tr class="pc-attr-groups">${groupHeads}</tr><tr class="pc-attr-cols">${colHeads}</tr></thead><tbody>${bodyRows}</tbody></table></div>`
}
function positionsTable(p: Player, other?: Player): string {
  return `<p class="pc-muted">显示球员的位置熟练度原始值；球场上由灰、红、黄、绿到青色表示熟练度由低到高。</p><div class="pc-position-pair"><div>${pitch(p)}<p>${esc(p.name)} · ${esc(positionName(p))}</p></div><div>${pitch(other)}<p>${other ? `${esc(other.name)} · ${esc(positionName(other))}` : '未选择球员'}</p></div></div><table class="pc-table"><thead><tr><th>位置</th><th>球员</th><th>对比球员</th></tr></thead><tbody>${DETAILED_POSITIONS.map(pos => `<tr><th>${DETAILED_POSITION_LABELS[pos]}</th><td>${number(detailedPositionValue(p, pos))}</td><td>${other ? number(detailedPositionValue(other, pos)) : '—'}</td></tr>`).join('')}</tbody></table>`
}
function overview(p: Player, other?: Player): string {
  return `<div class="pc-overview-cards">${[p, other].map(target => {
    const stats = recordedStats(target)
    const gk = !!target && isKeeper(target)
    const summaryLines = gk
      ? `<p>出场 ${statValue(stats, 'appearances')}　扑救 ${stats && stats.coverage.saves > 0 ? number(stats.saves) : '—'}　失球 ${stats && stats.coverage.goalsConceded > 0 ? number(stats.goalsConceded) : '—'}　零封 ${stats && stats.coverage.goalsConceded > 0 ? number(stats.cleanSheets) : '—'}</p><p>扑救成功率 ${saveRate(stats, false)}　传球成功率 ${passRate(stats)}　评分 ${advancedValue(stats, 'rating', 1)}</p>`
      : `<p>出场 ${statValue(stats, 'appearances')}　进球 ${statValue(stats, 'goals')}　助攻 ${statValue(stats, 'assists')}</p><p>传球成功率 ${passRate(stats)}　评分 ${advancedValue(stats, 'rating', 1)}</p>`
    return `<article class="pc-summary"><div><h3>赛季统计</h3><p class="pc-muted">仅含已保存战报</p>${summaryLines}</div><div>${pitch(target)}<p>${target ? esc(positionName(target)) : '未选择球员'}</p></div></article>`
  }).join('')}</div><section class="pc-radar-section"><h3>属性对比</h3><div class="pc-radar-layout"><div class="pc-facts"><span>惯用脚</span><b>${esc(({ L: '左脚', R: '右脚', B: '双脚' } as const)[p.foot] ?? '—')}</b><span>身高</span><b>${number(p.height)} 厘米</b></div><div>${radar(p, other)}<div class="pc-legend"><span><i class="pc-dot-first"></i>${esc(p.name)}</span>${other ? `<span><i class="pc-dot-second"></i>${esc(other.name)}</span>` : ''}</div><p class="pc-muted pc-center">比赛评分，雷达上限为 100（超出部分截顶）${other && isKeeper(p) !== isKeeper(other) ? '；门将与外场球员尺度不同，仅供参考' : ''}</p></div><div class="pc-facts pc-facts-right"><span>惯用脚</span><b>${other ? esc(({ L: '左脚', R: '右脚', B: '双脚' } as const)[other.foot] ?? '—') : '—'}</b><span>身高</span><b>${other ? `${number(other.height)} 厘米` : '—'}</b></div></div></section>`
}

export function renderPlayerComparison(player: Player, compare: Player | undefined, candidates: Player[], tab: CompareTab): string {
  // 参数和 UI 状态均不可信；以阵容中的对象为准，避免同 ID 的外部数据混入。
  const options = comparisonCandidates()
  const ownPlayer = options.find(candidate => candidate.id === player.id)
  if (!ownPlayer) return ''
  player = ownPlayer
  compare = options.find(candidate => candidate.id === compare?.id)
  void candidates
  const optionsFor = (selected: string | undefined) => options.map(candidate => `<option value="${esc(candidate.id)}"${candidate.id === selected ? ' selected' : ''}>${esc(candidate.name)} · ${esc(positionName(candidate))}</option>`).join('')
  return `<section class="pc-root" aria-label="球员对比"><header class="pc-header"><div><span class="pc-eyebrow">球员中心</span><h1>球员对比</h1></div><div class="pc-selectors"><label class="pc-select">球员<select data-player-compare-base>${optionsFor(player.id)}</select></label><label class="pc-select">对比球员<select data-player-compare-select><option value=""${compare ? '' : ' selected'}>请选择球员</option>${optionsFor(compare?.id)}</select></label></div></header><div class="pc-identities">${identity(player, 'pc-first')}${identity(compare, 'pc-second')}</div><div class="pc-panel"><nav class="pc-tabs" aria-label="对比分类">${tabs.map(([key, label]) => `<button type="button" data-player-compare-tab="${key}" class="${tab === key ? 'pc-active' : ''}" aria-pressed="${tab === key}">${label}</button>`).join('')}</nav>${tab === 'overview' ? overview(player, compare) : tab === 'attributes' ? attributeTable(player, compare) : tab === 'stats' ? statTable(player, compare) : positionsTable(player, compare)}</div></section>`
}
