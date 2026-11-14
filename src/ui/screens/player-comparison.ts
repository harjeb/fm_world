import { ATTR_GROUPS, ATTR_META, POSITION_LABELS } from '../../game/data/attributes.ts'
import { attrRating } from '../../game/scale.ts'
import { GK_ATTRIBUTES, POSITIONS, type AttrKey, type Player, type Position } from '../../game/types.ts'
import { bestMarketValue } from '../../game/market.ts'
import { marketState } from '../../online.ts'
import { countryLabel } from '../components.ts'
import { esc } from '../format.ts'
import { game } from '../state.ts'
import { aggregatePerformance, type PerformanceTotals } from './player-performance.ts'

export type CompareTab = 'overview' | 'attributes' | 'stats' | 'positions'

/** 与球员详情的查找范围一致，优先本队，避免挂牌球员重复。 */
export function comparisonCandidates(): Player[] {
  const players = [...game.roster, ...(game.market?.listings ?? []).map((item) => item.player), ...game.freeStars, ...marketState.pool, ...game.aiTeams.flatMap((team) => team.players)]
  const unique = new Map<string, Player>()
  for (const player of players) if (!unique.has(player.id)) unique.set(player.id, player)
  return [...unique.values()]
}

const tabs: [CompareTab, string][] = [['overview', '总览'], ['attributes', '属性'], ['stats', '数据'], ['positions', '位置']]
const fieldRadar: AttrKey[] = ['shooting', 'dribbling', 'speed', 'acceleration', 'strength', 'tackling', 'passing']
const keeperRadar: AttrKey[] = ['reflexes', 'handling', 'composure', 'passing', 'rushing', 'oneOnOne']
const isKeeper = (p: Player) => p.positions.GK > 0
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

const spots: Record<Position, [number, number]> = { GK: [50, 88], CB: [50, 70], W: [18, 43], CM: [50, 44], ST: [50, 16] }
function pitch(p?: Player): string {
  return `<svg class="pc-pitch" viewBox="0 0 100 110" role="img" aria-label="位置分布"><rect x="2" y="2" width="96" height="106" rx="2"/><path d="M2 55H98 M35 2V16H65V2 M35 108V94H65V108"/><circle cx="50" cy="55" r="12"/>${POSITIONS.map(pos => { const [x, y] = spots[pos]; const value = p?.positions[pos] ?? 0; const tier = value >= 85 ? 5 : value >= 65 ? 4 : value >= 40 ? 3 : value > 0 ? 2 : 1; return `<circle class="pc-spot pc-spot-${tier}" cx="${x}" cy="${y}" r="5"><title>${POSITION_LABELS[pos]}：${p ? esc(number(value)) : '—'}</title></circle>` }).join('')}</svg>`
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
function statTable(p: Player, other?: Player): string {
  const first = recordedStats(p), second = recordedStats(other)
  const rows: [string, string, string][] = [
    ['出场', statValue(first, 'appearances'), statValue(second, 'appearances')],
    ['出场时间（分钟）', statValue(first, 'minutes'), statValue(second, 'minutes')],
    ...([['进球', 'goals'], ['助攻', 'assists'], ['射门', 'shots'], ['传球', 'passes'], ['抢断', 'tackles'], ['拦截', 'interceptions']] as const)
      .map(([label, key]): [string, string, string] => [label, statValue(first, key), statValue(second, key)]),
    ['传球成功率', passRate(first), passRate(second)], ['评分', '—', '—'],
  ]
  return `<p class="pc-muted">仅统计本赛季已保存的战报；未收录的比赛不计入，缺失数据以 — 显示。</p><div class="pc-table-wrap"><table class="pc-table"><thead><tr><th>本赛季数据</th><th>${esc(p.name)}</th><th>${other ? esc(other.name) : '对比球员'}</th></tr></thead><tbody>${rows.map(([label, a, b]) => `<tr><th>${label}</th><td>${a}</td><td>${b}</td></tr>`).join('')}</tbody></table></div>`
}
function attributeTable(p: Player, other?: Player): string {
  const raw = (target: Player | undefined, key: AttrKey) => attr(target, key) === undefined ? '—' : number(target!.attrs[key])
  return `<p class="pc-muted">显示与球员档案一致的属性原始值；主属性和其他属性采用不同量纲。外场球员门将属性不适用。</p>${ATTR_GROUPS.map(group => `<section class="pc-group"><h3>${group.name}</h3><div class="pc-table-wrap"><table class="pc-table"><thead><tr><th>属性</th><th>球员</th><th>对比球员</th></tr></thead><tbody>${group.attrs.map(key => `<tr><th>${esc(ATTR_META[key].label)}</th><td>${raw(p, key)}</td><td>${raw(other, key)}</td></tr>`).join('')}</tbody></table></div></section>`).join('')}`
}
function positionsTable(p: Player, other?: Player): string {
  return `<p class="pc-muted">显示球员的位置熟练度原始值；球场上由灰、红、黄、绿到青色表示熟练度由低到高。</p><div class="pc-position-pair"><div>${pitch(p)}<p>${esc(p.name)} · ${esc(positionName(p))}</p></div><div>${pitch(other)}<p>${other ? `${esc(other.name)} · ${esc(positionName(other))}` : '未选择球员'}</p></div></div><table class="pc-table"><thead><tr><th>位置</th><th>球员</th><th>对比球员</th></tr></thead><tbody>${POSITIONS.map(pos => `<tr><th>${POSITION_LABELS[pos]}</th><td>${number(p.positions[pos])}</td><td>${other ? number(other.positions[pos]) : '—'}</td></tr>`).join('')}</tbody></table>`
}
function overview(p: Player, other?: Player): string {
  return `<div class="pc-overview-cards">${[p, other].map(target => {
    const stats = recordedStats(target)
    return `<article class="pc-summary"><div><h3>赛季统计</h3><p class="pc-muted">仅含已保存战报</p><p>出场 ${statValue(stats, 'appearances')}　进球 ${statValue(stats, 'goals')}　助攻 ${statValue(stats, 'assists')}</p><p>传球成功率 ${passRate(stats)}　评分 —</p></div><div>${pitch(target)}<p>${target ? esc(positionName(target)) : '未选择球员'}</p></div></article>`
  }).join('')}</div><section class="pc-radar-section"><h3>属性对比</h3><div class="pc-radar-layout"><div class="pc-facts"><span>惯用脚</span><b>${esc(({ L: '左脚', R: '右脚', B: '双脚' } as const)[p.foot] ?? '—')}</b><span>身高</span><b>${number(p.height)} 厘米</b></div><div>${radar(p, other)}<div class="pc-legend"><span><i class="pc-dot-first"></i>${esc(p.name)}</span>${other ? `<span><i class="pc-dot-second"></i>${esc(other.name)}</span>` : ''}</div><p class="pc-muted pc-center">比赛评分，雷达上限为 100（超出部分截顶）${other && isKeeper(p) !== isKeeper(other) ? '；门将与外场球员尺度不同，仅供参考' : ''}</p></div><div class="pc-facts pc-facts-right"><span>惯用脚</span><b>${other ? esc(({ L: '左脚', R: '右脚', B: '双脚' } as const)[other.foot] ?? '—') : '—'}</b><span>身高</span><b>${other ? `${number(other.height)} 厘米` : '—'}</b></div></div></section>`
}

export function renderPlayerComparison(player: Player, compare: Player | undefined, candidates: Player[], tab: CompareTab): string {
  const options = [...candidates]
  if (compare && !options.some(candidate => candidate.id === compare.id)) options.push(compare)
  if (!options.some(candidate => candidate.id === player.id)) options.unshift(player)
  const optionsFor = (selected: string | undefined) => options.map(candidate => `<option value="${esc(candidate.id)}"${candidate.id === selected ? ' selected' : ''}>${esc(candidate.name)} · ${esc(positionName(candidate))}</option>`).join('')
  return `<section class="pc-root" aria-label="球员对比"><header class="pc-header"><div><span class="pc-eyebrow">球员中心</span><h1>球员对比</h1></div><div class="pc-selectors"><label class="pc-select">球员<select data-player-compare-base>${optionsFor(player.id)}</select></label><label class="pc-select">对比球员<select data-player-compare-select><option value=""${compare ? '' : ' selected'}>请选择球员</option>${optionsFor(compare?.id)}</select></label></div></header><div class="pc-identities">${identity(player, 'pc-first')}${identity(compare, 'pc-second')}</div><div class="pc-panel"><nav class="pc-tabs" aria-label="对比分类">${tabs.map(([key, label]) => `<button type="button" data-player-compare-tab="${key}" class="${tab === key ? 'pc-active' : ''}" aria-pressed="${tab === key}">${label}</button>`).join('')}</nav>${tab === 'overview' ? overview(player, compare) : tab === 'attributes' ? attributeTable(player, compare) : tab === 'stats' ? statTable(player, compare) : positionsTable(player, compare)}</div></section>`
}
