import type { AttrKey, Attributes, Fixture, Player, Position, SeasonTableRow, SkillId, TierId, TraitId } from '../game/types.ts'
import { POSITIONS, type PlayerCard } from '../game/types.ts'
import { cardDisplayName, playerCards } from '../game/cards.ts'
import { ATTR_META } from '../game/data/attributes.ts'
import { ROUTE_LABELS } from '../game/data/events.ts'
import { skillEffectText, skillTierNote, traitEffectText } from '../game/data/skill-effects.ts'
import type { PlayerForm } from '../game/form.ts'
import { skillCapacity, skillCategory } from '../game/data/skills.ts'
import { getSkillTier } from '../game/inheritance.ts'
import { injuryUntil } from '../game/injury.ts'
import { attrRating, initialDisplayCA, mainAttrsFor } from '../game/rating.ts'
import { isMainAttr } from '../game/scale.ts'
import { PLAYER_TEAM_ID, teamName } from '../game/season.ts'
import { isOnlineMode, marketState, publicWorld } from '../online.ts'
import { esc, playerCA, positionClass, positionLabel, skillName, traitName } from './format.ts'
import { tipAttrs } from './tooltip.ts'
import { icon } from './icons.ts'
import { game } from './state.ts'

/* ---------- 俱乐部外观 ---------- */

const FALLBACK_COLOR = '#34d399'

export type ClubLook = { id: string; name: string; enName?: string; color: string }

export function clubLook(id: string): ClubLook {
  const onlineClub = id !== PLAYER_TEAM_ID && isOnlineMode() ? publicWorld?.clubs.find((item) => item.id === id) : undefined
  const club = game.world?.clubs.find((item) => item.id === id) ?? game.aiTeams.find((item) => item.id === id)
  return {
    id,
    name: id === PLAYER_TEAM_ID ? game.clubName : onlineClub?.name ?? club?.name ?? teamName(game, id),
    enName: club?.enName,
    color: onlineClub?.color ?? club?.color ?? FALLBACK_COLOR,
  }
}

function parseHex(color: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(color)
  if (!match) return null
  const value = parseInt(match[1], 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((part) => Math.round(part).toString(16).padStart(2, '0')).join('')}`
}

function darken(color: string, amount: number): string {
  const rgb = parseHex(color)
  return rgb ? toHex(rgb.map((part) => part * (1 - amount)) as [number, number, number]) : color
}

function luminance(color: string): number {
  const rgb = parseHex(color)
  if (!rgb) return 0.5
  const [r, g, b] = rgb.map((part) => {
    const c = part / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** 落在这个颜色上的文字用白还是近黑。 */
export function inkOn(color: string): string {
  return luminance(color) > 0.3 ? '#10141a' : '#ffffff'
}

const ALTERNATE_KITS = ['#f4f6f8', '#f2b84b', '#5aa9f0', '#e05d9b']

function kitDistance(a: string, b: string): number {
  const x = parseHex(a)
  const y = parseHex(b)
  if (!x || !y) return 999
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}

/** 两队撞色时给对手换备用队服色，保证场上和统计条分得清。 */
export function distinctKit(color: string, against: string): string {
  if (kitDistance(color, against) >= 110) return color
  return ALTERNATE_KITS.find((alt) => kitDistance(alt, against) >= 110) ?? color
}

const SHIELD = 'M16 1.5 29.5 5v13.2C29.5 26.6 23 31.6 16 34.5 9 31.6 2.5 26.6 2.5 18.2V5Z'
const CREST_PATTERNS = [
  '',
  'M16 1.5 29.5 5v13.2C29.5 26.6 23 31.6 16 34.5Z',
  'M2.5 5 16 1.5 29.5 5v7H2.5Z',
  'M2.5 16.5 29.5 6.5v7.8L2.5 24.3Z',
]

function hashOf(text: string): number {
  let hash = 0
  for (const char of text) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  return hash
}

/** 由俱乐部名和主色生成的原创队徽。 */
export function crest(look: Pick<ClubLook, 'name' | 'color'>, size = 18): string {
  const color = parseHex(look.color) ? look.color : FALLBACK_COLOR
  const pattern = CREST_PATTERNS[hashOf(look.name) % CREST_PATTERNS.length]
  const letter = esc([...look.name][0] ?? '?')
  return `<svg class="crest" width="${Math.round((size * 32) / 36)}" height="${size}" viewBox="0 0 32 36" aria-hidden="true"><path d="${SHIELD}" fill="${color}"/>${pattern ? `<path d="${pattern}" fill="${darken(color, 0.24)}"/>` : ''}<path d="${SHIELD}" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="1.2"/><text x="16" y="23.4" text-anchor="middle" font-size="15" font-weight="700" fill="${inkOn(color)}">${letter}</text></svg>`
}

/** 这支球队由真实玩家执教：自己的球队，或联机时有教练接管的球队。 */
export function isHumanClub(id: string): boolean {
  if (id === PLAYER_TEAM_ID) return true
  return isOnlineMode() && !!publicWorld?.clubs.find((club) => club.id === id)?.managed
}

/** 联机时这支玩家球队是否因超过 3 天未上线正由 AI 临时接管（自己的球队当前在线查看，不显示接管）。 */
export function isAITakeoverClub(id: string): boolean {
  if (id === PLAYER_TEAM_ID) return false
  return isOnlineMode() && !!publicWorld?.clubs.find((club) => club.id === id)?.aiTakeover
}

/** 真实玩家执教的球队名右边的人物图标：正常在线绿色，超过 3 天未上线（AI 接管）黄色；电脑球队返回空。 */
export function humanMark(id: string, managed = false, aiTakeover = false): string {
  if (!managed && !isHumanClub(id)) return ''
  const takeover = id !== PLAYER_TEAM_ID && (aiTakeover || isAITakeoverClub(id))
  const label = takeover ? '超过 3 天未上线 · AI 接管中' : '真实玩家执教'
  return `<span class="human-mark${takeover ? ' ai-takeover' : ''}" title="${label}" aria-label="${label}">${icon('user', 12)}</span>`
}

/** 球队名：任何界面都能点开这支球队的球员名单。 */
export function clubName(id: string, size = 18): string {
  const look = clubLook(id)
  return `<button type="button" class="club club-btn" data-club-open="${esc(id)}" ${look.enName ? `title="${esc(look.enName)}"` : ''}>${crest(look, size)}<span class="club-name">${esc(look.name)}</span>${humanMark(id)}</button>`
}

/* ---------- 数值着色 ---------- */

/** 主属性 0-1500：开局 500-800，培养上限约 950-1480，色阶要能区分开局差异。 */
export const ATTR_STOPS = [525, 650, 800, 1000, 1250]
/** CA 由全部属性平方均值算出：开局 210-300，满培养约 1000。 */
export const CA_STOPS = [225, 260, 320, 450, 650]
const PROFICIENCY_STOPS = [1, 40, 65, 85]
/** 有效评分（0–100 的职责适配 × 位置折损）：开局约 40–55。 */
export const FIT_STOPS = [42, 48, 55, 65, 80]
/** 单场表现分 3–10，无贡献的满场约 6.2。 */
export const RATING_STOPS = [5.8, 6.4, 7, 7.6, 8.4]

function band(value: number, stops: number[]): number {
  let index = 0
  while (index < stops.length && value >= stops[index]) index++
  return index + 1
}

export function attrHeat(value: number): string {
  return `<span class="heat h${band(value, ATTR_STOPS)}">${Math.round(value)}</span>`
}

export function caHeat(value: number, digits = 0): string {
  return `<span class="heat h${band(value, CA_STOPS)}">${value.toFixed(digits)}</span>`
}

export function fitHeat(value: number): string {
  return `<span class="heat h${band(value, FIT_STOPS)}">${value.toFixed(1)}</span>`
}

/** 最近几场表现分的迷你柱，旁边写平均分，颜色不单独传达信息。 */
export function formBars(form: Pick<PlayerForm, 'ratings' | 'average'>): string {
  if (form.ratings.length === 0 || form.average === null) return '<span class="muted small">暂无</span>'
  const bars = form.ratings.map((rating) => `<i class="hb${band(rating, RATING_STOPS)}" style="height:${(((rating - 3) / 7) * 100).toFixed(0)}%"></i>`).join('')
  return `<span class="form-cell" title="最近 ${form.ratings.length} 场表现分（从旧到新）：${form.ratings.map((rating) => rating.toFixed(1)).join(' · ')}"><span class="form-bars">${bars}</span><span class="heat h${band(form.average, RATING_STOPS)}">${form.average.toFixed(2)}</span></span>`
}

export function heatLegend(label: string, stops: number[]): string {
  const cells = [...stops.map((_, index) => index), stops.length].map((index) => {
    const text = index === 0 ? `<${stops[0]}` : `${stops[index - 1]}+`
    return `<span class="legend-item"><i class="swatch hb${index + 1}"></i>${text}</span>`
  })
  return `<div class="legend"><span class="legend-title">${esc(label)}</span>${cells.join('')}</div>`
}

/** 细条 meter：值越低越危险。标签与数值放在旁边，颜色不单独传达信息。 */
export function meter(value: number, max = 100, options: { good?: number; warn?: number; label?: boolean } = {}): string {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  const percent = ratio * 100
  const tone = percent >= (options.good ?? 60) ? 'good' : percent >= (options.warn ?? 35) ? 'warn' : 'bad'
  return `<span class="meter-wrap"><span class="meter ${tone}"><i style="width:${percent.toFixed(1)}%"></i></span>${options.label === false ? '' : `<span class="meter-value">${Math.round(value)}</span>`}</span>`
}

/* ---------- 球员小件 ---------- */

export function primaryPosition(player: Pick<Player, 'positions'>): Position {
  return POSITIONS.filter((pos) => player.positions[pos] > 0).sort((a, b) => player.positions[b] - player.positions[a])[0] ?? 'CM'
}

export function posBadge(pos: Position): string {
  return `<span class="pos ${positionClass(pos)}">${positionLabel(pos)}</span>`
}

export function countryLabel(player: Pick<Player, 'country'>): string {
  return player.country === '随机青训' ? '青训' : player.country
}

/** 随机青训球员没有所属年代。 */
export function eraLabel(era: string): string {
  return era === 'random' ? '—' : era
}

export function injuryLabel(player: Player): string {
  const until = injuryUntil(game, player)
  if (until === null) return ''
  const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60_000))
  return `受伤 · 约 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分后恢复`
}

export function skillTierLabel(player: Pick<Player, 'skillTiers'>, skill: SkillId): string {
  return { silver: '银', gold: '金', rainbow: '彩' }[getSkillTier(player, skill)]
}

export function skillTag(player: Pick<Player, 'skillTiers'>, skill: SkillId): string {
  const tier = getSkillTier(player, skill)
  const tip = tipAttrs(`${skillName(skill)} · ${skillTierLabel(player, skill)}`, `${skillEffectText(skill, tier)}\n${skillTierNote(skill)}`)
  return `<span class="tag skill-${tier}" ${tip}>${esc(skillName(skill))} · ${skillTierLabel(player, skill)}</span>`
}

/** 特性名字带上效果提示；tag 为 true 时显示成标签。 */
export function traitLabel(id: TraitId, asTag = false): string {
  const tip = tipAttrs(`${traitName(id)} · ${id.startsWith('star_') ? '专属特性' : '特性'}`, traitEffectText(id))
  return asTag ? `<span class="tag gold" ${tip}>${esc(traitName(id))}</span>` : `<span class="has-tip" ${tip}>${esc(traitName(id))}</span>`
}

export function skillGroups(player: Pick<Player, 'skills' | 'skillTiers'>): string {
  return (['main', 'auxiliary'] as const).map((category) => {
    const skills = player.skills.filter((skill) => skillCategory(skill) === category)
    return `<div class="skill-group"><span class="skill-title">${category === 'main' ? '主技能' : '辅助技能'} ${skills.length}/${skillCapacity(category)}</span><div class="tag-row">${skills.map((skill) => skillTag(player, skill)).join('') || '<span class="muted small">无</span>'}</div></div>`
  }).join('')
}

/* ---------- 属性配色 ---------- */

/** 7 项外场主属性各一种颜色；隐藏属性、门将专属属性和没有主属性成长的项目一律银色。 */
export const ATTR_COLORS: Partial<Record<AttrKey, string>> = {
  passing: '#4ea1ff',
  shooting: '#ff5d5d',
  dribbling: '#ff9f43',
  tackling: '#b57bff',
  strength: '#f5d04a',
  speed: '#3ddc84',
  acceleration: '#2dd4d4',
}
export const ATTR_SILVER = '#b4bcc8'

/** 单个属性的颜色：7 项外场主属性各有一种，其余（隐藏属性、门将专属属性）是银色。 */
export function attrColor(key: AttrKey): string {
  return ATTR_COLORS[key] ?? ATTR_SILVER
}

/** 训练项目的颜色：取它成长最多的那项主属性（并列取先列出的）对应的颜色，没有就是银色。 */
export function activityColor(gains: Partial<Record<AttrKey, number>> | undefined, gk: boolean): string {
  let best: AttrKey | undefined
  let bestGain = 0
  for (const [key, value] of Object.entries(gains ?? {}) as [AttrKey, number][]) {
    if (!isMainAttr(key, gk) || !(value > bestGain)) continue
    best = key
    bestGain = value
  }
  return (best && ATTR_COLORS[best]) || ATTR_SILVER
}

/* ---------- 球员卡 ---------- */

export function cardName(card: Pick<PlayerCard, 'serial' | 'customName'>): string {
  return cardDisplayName(card)
}

export function cardRoute(card: Pick<PlayerCard, 'routeId'>): string {
  return card.routeId ? ROUTE_LABELS[card.routeId] : '未选路线'
}

/**
 * 紧凑的下拉框：平时只显示简短文字，点开才是完整选项。
 * 真正的 select 透明地盖在文字上，键盘和手机上的原生选择都还能用。
 */
export function pick(text: string, select: string, className = ''): string {
  return `<label class="pick ${className}"><span class="pick-text">${text}</span>${icon('chevron', 11)}${select}</label>`
}

/** 给球员换卡的下拉框：选项是原始属性和他自己的每一张卡。 */
export function cardSelect(player: Player, className = ''): string {
  const cards = playerCards(game, player.id)
  const current = cards.find((card) => card.id === player.equippedCardId)
  const options = [
    `<option value="" ${current ? '' : 'selected'}>原始属性 · CA ${initialDisplayCA(player).toFixed(0)}</option>`,
    ...cards.map((card) => `<option value="${esc(card.id)}" ${card === current ? 'selected' : ''}>${esc(cardName(card))} · ${esc(cardRoute(card))} · CA ${playerCA(card).toFixed(0)}</option>`),
  ].join('')
  return pick(current ? esc(cardName(current)) : '原始', `<select data-card-player="${esc(player.id)}" aria-label="${esc(player.name)}的球员卡" ${game.activeMatch ? 'disabled' : ''}>${options}</select>`, `card-pick ${className}`)
}

/** 全游戏范围查球员：阵容、挂牌、自由球员和其他俱乐部。 */
export function findAnyPlayer(id: string): Player | undefined {
  return game.roster.find((player) => player.id === id)
    ?? game.market?.listings.find((listing) => listing.player.id === id)?.player
    ?? game.freeStars.find((player) => player.id === id)
    ?? marketState.pool.find((player) => player.id === id)
    ?? game.aiTeams.flatMap((team) => team.players).find((player) => player.id === id)
}

/* ---------- 布局件 ---------- */

export function pageHead(options: { kicker?: string; title: string; sub?: string; lead?: string; actions?: string }): string {
  return `<div class="page-head">
    ${options.lead ? `<div class="page-lead">${options.lead}</div>` : ''}
    <div class="page-title">
      ${options.kicker ? `<div class="kicker">${options.kicker}</div>` : ''}
      <h1>${options.title}</h1>
      ${options.sub ? `<p class="page-sub">${options.sub}</p>` : ''}
    </div>
    ${options.actions ? `<div class="page-actions">${options.actions}</div>` : ''}
  </div>`
}

export function panel(title: string, body: string, options: { aside?: string; flush?: boolean; className?: string } = {}): string {
  return `<section class="panel ${options.className ?? ''}"><header class="panel-head"><h2>${title}</h2>${options.aside ? `<div class="panel-aside">${options.aside}</div>` : ''}</header><div class="panel-body${options.flush ? ' flush' : ''}">${body}</div></section>`
}

export function tile(label: string, value: string, sub = ''): string {
  return `<div class="tile"><span class="tile-label">${label}</span><b class="tile-value">${value}</b>${sub ? `<span class="tile-sub">${sub}</span>` : ''}</div>`
}

export function emptyState(text: string): string {
  return `<div class="empty">${text}</div>`
}

export function tag(text: string, tone = ''): string {
  return `<span class="tag ${tone}">${text}</span>`
}

/* ---------- 联赛件 ---------- */

export type FormResult = 'W' | 'D' | 'L'

export function teamForm(teamId: string, fixtures: Fixture[], limit = 5): FormResult[] {
  return fixtures
    .filter((fixture) => fixture.played && fixture.score && (fixture.homeId === teamId || fixture.awayId === teamId))
    .sort((a, b) => a.round - b.round)
    .slice(-limit)
    .map((fixture) => {
      const home = fixture.homeId === teamId
      const mine = home ? fixture.score!.home : fixture.score!.away
      const theirs = home ? fixture.score!.away : fixture.score!.home
      return mine > theirs ? 'W' : mine < theirs ? 'L' : 'D'
    })
}

const RESULT_TEXT: Record<FormResult, string> = { W: '胜', D: '平', L: '负' }

export function resultPill(result: FormResult): string {
  return `<span class="form f-${result}">${RESULT_TEXT[result]}</span>`
}

export function formPills(results: FormResult[]): string {
  return `<span class="form-pills">${results.map(resultPill).join('') || '<span class="muted small">暂无</span>'}</span>`
}

export function recordResult(result: 'win' | 'draw' | 'loss'): FormResult {
  return result === 'win' ? 'W' : result === 'loss' ? 'L' : 'D'
}

type Zone = 'champion' | 'promote' | 'playoff' | 'relegate' | ''

function tableZone(tier: TierId | undefined, index: number, total: number): Zone {
  if (tier === 'champions') return index === 0 ? 'champion' : index >= total - 3 ? 'relegate' : ''
  if (tier === 'division1') return index < 3 ? 'promote' : index >= total - 3 ? 'relegate' : ''
  if (tier === 'division2') return index < 8 ? 'playoff' : ''
  return ''
}

function zoneLegend(tier: TierId | undefined): string {
  const items: [Zone, string][] = tier === 'champions'
    ? [['champion', '冠军'], ['relegate', '降入一级联赛']]
    : tier === 'division1'
      ? [['promote', '升入冠军联赛'], ['relegate', '降入二级联赛']]
      : tier === 'division2'
        ? [['playoff', '升级附加赛']]
        : []
  if (items.length === 0) return ''
  return `<div class="legend table-legend">${items.map(([zone, label]) => `<span class="legend-item"><i class="swatch zone-${zone}"></i>${label}</span>`).join('')}</div>`
}

export function leagueTable(rows: SeasonTableRow[], options: { tier?: TierId; fixtures?: Fixture[]; compact?: boolean; window?: { from: number; to: number }; browseClubs?: boolean; clubLabels?: Record<string, { name: string; color: string }>; ratings?: Map<string, number> } = {}): string {
  const from = options.window?.from ?? 0
  const to = options.window?.to ?? rows.length
  const shown = rows.slice(from, to)
  const head = options.compact
    ? '<th class="num">#</th><th>球队</th><th class="num">场</th><th class="num">净胜</th><th class="num">分</th>'
    : '<th class="num">#</th><th>球队</th><th class="num">场</th><th class="num">胜</th><th class="num">平</th><th class="num">负</th><th class="num">进</th><th class="num">失</th><th class="num">净</th><th class="num">分</th><th>近况</th>'
  const ratingHead = options.ratings ? '<th class="num" title="首发 CA 之和">RANK</th>' : ''
  const body = shown.map((row, offset) => {
    const index = from + offset
    const diff = row.gf - row.ga
    const zone = tableZone(options.tier, index, rows.length)
    const cells = options.compact
      ? `<td class="num">${row.played}</td><td class="num">${diff > 0 ? '+' : ''}${diff}</td>`
      : `<td class="num">${row.played}</td><td class="num">${row.won}</td><td class="num">${row.drawn}</td><td class="num">${row.lost}</td><td class="num">${row.gf}</td><td class="num">${row.ga}</td><td class="num">${diff > 0 ? '+' : ''}${diff}</td>`
    const form = options.compact ? '' : `<td>${options.fixtures ? formPills(teamForm(row.teamId, options.fixtures)) : ''}</td>`
    const look = options.clubLabels?.[row.teamId]
    // 积分榜里的球队名一律可点开名单（赛季页、世界页都一样）。
    const browse = `<button type="button" class="club club-btn" data-club-open="${esc(row.teamId)}" aria-label="查看${esc(look?.name ?? row.teamId)}球员">${crest(look ?? clubLook(row.teamId))}<span class="club-name">${esc(look?.name ?? clubLook(row.teamId).name)}</span>${humanMark(row.teamId)}</button>`
    return `<tr class="${row.teamId === PLAYER_TEAM_ID ? 'me' : ''}"><td class="num rank ${zone ? `zone-${zone}` : ''}">${index + 1}</td><td>${browse}</td>${cells}${options.ratings ? `<td class="num dim">${Math.round(options.ratings.get(row.teamId) ?? 0) || ''}</td>` : ''}<td class="num strong">${row.points}</td>${form}</tr>`
  }).join('')
  return `<div class="table-scroll"><table class="dt league"><thead><tr>${head.replace('<th class="num">分</th>', `${ratingHead}<th class="num">分</th>`)}</tr></thead><tbody>${body}</tbody></table></div>${options.compact ? '' : zoneLegend(options.tier)}`
}

export function fixtureRow(fixture: Fixture, options: { pending?: string; highlightTeamId?: string | null; showRound?: boolean } = {}): string {
  const score = fixture.played && fixture.score
    ? `${fixture.score.home} : ${fixture.score.away}`
    : options.pending ?? 'vs'
  const shootout = fixture.shootout ? `<small>点球 ${fixture.shootout.home}:${fixture.shootout.away}</small>` : ''
  const highlighted = options.highlightTeamId
    ? (fixture.homeId === options.highlightTeamId || fixture.awayId === options.highlightTeamId)
    : fixture.isPlayer
  let scoreTip = ''
  if (fixture.played && (fixture.scorers?.length || fixture.assisters?.length)) {
    const lines: string[] = []
    if (fixture.scorers?.length) {
      lines.push(`进球：${fixture.scorers.map((s) => `${s.name}${s.goals > 1 ? ` ×${s.goals}` : ''}`).join('、')}`)
    }
    if (fixture.assisters?.length) {
      lines.push(`助攻：${fixture.assisters.map((a) => `${a.name}${a.assists > 1 ? ` ×${a.assists}` : ''}`).join('、')}`)
    }
    scoreTip = ` ${tipAttrs(`第 ${fixture.round} 轮 · ${clubLook(fixture.homeId).name} ${score} ${clubLook(fixture.awayId).name}`, lines.join('\n'))}`
  }
  const roundPrefix = options.showRound ? `<span class="fx-round dim">R${fixture.round}</span>` : ''
  return `<div class="fx${options.showRound ? ' with-round' : ''} ${highlighted ? 'me' : ''}">
    ${roundPrefix}
    <span class="fx-team home">${clubName(fixture.homeId)}</span>
    <span class="fx-score ${fixture.played ? 'played' : ''}${scoreTip ? ' has-tip' : ''}"${scoreTip}>${score}${shootout}</span>
    <span class="fx-team away">${clubName(fixture.awayId)}</span>
  </div>`
}

/* ---------- 图形：雷达、位置图、战术板、对比条 ---------- */

const RADAR_FIELD: AttrKey[] = ['shooting', 'dribbling', 'speed', 'acceleration', 'strength', 'tackling', 'passing']
const RADAR_GK: AttrKey[] = ['reflexes', 'handling', 'composure', 'passing', 'rushing', 'oneOnOne']

/** 六项主属性的六边形。第二名球员（候选）叠加成第二个多边形，用图例说明。 */
export function attributeRadar(player: { attrs: Partial<Attributes>; positions: Player['positions'] }, compare?: { attrs: Partial<Attributes>; positions: Player['positions'] }, size = 208, colored = false): string {
  const gk = player.positions.GK > 0
  const keys = gk ? RADAR_GK : RADAR_FIELD
  const center = size / 2
  const radius = size / 2 - 34
  const point = (index: number, scale: number): [number, number] => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / keys.length
    return [center + Math.cos(angle) * radius * scale, center + Math.sin(angle) * radius * scale]
  }
  const path = (scale: (index: number) => number) => keys.map((_, index) => point(index, scale(index)).map((value) => value.toFixed(1)).join(',')).join(' ')
  const ring = [1 / 3, 2 / 3, 1].map((scale) => `<polygon points="${path(() => scale)}" class="radar-grid"/>`).join('')
  const axes = keys.map((_, index) => {
    const [x, y] = point(index, 1)
    return `<line x1="${center}" y1="${center}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="radar-grid"/>`
  }).join('')
  const scaleOf = (target: { attrs: Partial<Attributes> }) => (index: number) => Math.max(0.03, attrRating(keys[index], target.attrs[keys[index]] ?? 0, gk) / 100)
  const labels = keys.map((key, index) => {
    const [x, y] = point(index, 1.2)
    const anchor = Math.abs(x - center) < 4 ? 'middle' : x > center ? 'start' : 'end'
    return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${anchor}" class="radar-label"${colored ? ` style="fill:${attrColor(key)}"` : ''}>${esc(ATTR_META[key].label)}</text>`
  }).join('')
  const dots = (target: { attrs: Partial<Attributes> }, cls: string) => keys.map((key, index) => {
    const [x, y] = point(index, scaleOf(target)(index))
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" class="${cls}"${colored ? ` style="fill:${attrColor(key)}"` : ''}/>`
  }).join('')
  const base = compare ?? player
  const top = compare ? player : null
  return `<svg class="radar" viewBox="0 0 ${size} ${size}" role="img" aria-label="六项主属性雷达图">
    ${ring}${axes}
    <polygon points="${path(scaleOf(base))}" class="${top ? 'radar-base' : 'radar-shape'}"/>
    ${top ? `<polygon points="${path(scaleOf(top))}" class="radar-shape"/>${dots(top, 'radar-dot')}` : dots(base, 'radar-dot')}
    ${labels}
  </svg>`
}

const POSITION_SPOTS: Record<Position, [number, number][]> = {
  ST: [[50, 15]],
  W: [[17, 36], [83, 36]],
  CM: [[50, 50]],
  CB: [[50, 74]],
  GK: [[50, 92]],
}

function proficiencyTier(value: number): number {
  return band(value, PROFICIENCY_STOPS)
}

/** 位置熟练度图：擅长 85+ / 熟练 65+ / 客串 40+ / 生疏 1+ / 未学会 0。 */
export function positionMap(player: Pick<Player, 'positions'>): string {
  const gk = player.positions.GK > 0
  const relevant = POSITIONS.filter((pos) => (gk ? pos === 'GK' : pos !== 'GK'))
  const markers = relevant.flatMap((pos) => POSITION_SPOTS[pos].map(([x, y]) => {
    const value = Math.round(player.positions[pos])
    return `<g transform="translate(${x} ${y * 1.3})"><circle r="9" class="pm-dot pm-${proficiencyTier(player.positions[pos])}"/><text y="3" text-anchor="middle" class="pm-value">${value}</text><text y="16.5" text-anchor="middle" class="pm-label">${positionLabel(pos)}</text></g>`
  })).join('')
  const tiers: [number, string][] = [[5, '擅长'], [4, '熟练'], [3, '客串'], [2, '生疏'], [1, '未学']]
  return `<div class="pos-map">
    <svg viewBox="0 0 100 130" role="img" aria-label="位置熟练度">
      <rect x="1" y="1" width="98" height="128" rx="2" class="pm-pitch"/>
      <line x1="1" y1="65" x2="99" y2="65" class="pm-line"/>
      <circle cx="50" cy="65" r="11" class="pm-line"/>
      <rect x="26" y="1" width="48" height="20" class="pm-line"/>
      <rect x="26" y="109" width="48" height="20" class="pm-line"/>
      ${markers}
    </svg>
    <div class="legend pm-legend">${tiers.map(([tier, label]) => `<span class="legend-item"><i class="swatch pm-${tier}"></i>${label}</span>`).join('')}</div>
  </div>`
}

/** 竖向球场，进攻方向朝上；坐标系与阵型 slot 的 x/y 对应（见 boardSpot）。 */
export function boardMarkings(): string {
  const stripes = Array.from({ length: 10 }, (_, index) => `<rect x="0" y="${index * 10}" width="64" height="10" class="board-stripe ${index % 2 ? 'alt' : ''}"/>`).join('')
  return `<svg class="board-lines" viewBox="-2 -3 68 106" aria-hidden="true" preserveAspectRatio="none">
    ${stripes}
    <rect x="0" y="0" width="64" height="100" class="board-line"/>
    <line x1="0" y1="50" x2="64" y2="50" class="board-line"/>
    <circle cx="32" cy="50" r="8.7" class="board-line"/>
    <circle cx="32" cy="50" r=".5" class="board-spot"/>
    <rect x="13" y="0" width="38" height="15.7" class="board-line"/>
    <rect x="13" y="84.3" width="38" height="15.7" class="board-line"/>
    <rect x="23.4" y="0" width="17.2" height="5.2" class="board-line"/>
    <rect x="23.4" y="94.8" width="17.2" height="5.2" class="board-line"/>
    <circle cx="32" cy="10.5" r=".5" class="board-spot"/>
    <circle cx="32" cy="89.5" r=".5" class="board-spot"/>
    <rect x="28.55" y="-2" width="6.9" height="2" class="board-line"/>
    <rect x="28.55" y="100" width="6.9" height="2" class="board-line"/>
  </svg>`
}

/** 把阵型坐标映射成竖向球场上的百分比。x 最大约 0.73，拉伸以占满半场以上。 */
export function boardSpot(x: number, y: number): { left: number; top: number } {
  const down = 100 - (x / 0.8) * 92
  return { left: ((y * 64 + 2) / 68) * 100, top: ((down + 3) / 106) * 100 }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** 自由摆位的活动范围：留一点边距，别把球员贴到边线上。 */
export const CUSTOM_SPOT_RANGE = { minX: 0.02, maxX: 0.79, minY: 0.02, maxY: 0.98 } as const

/** 把位置夹进合法区间，顺便挡掉 NaN。 */
export function clampSpot(spot: { x: number; y: number }): { x: number; y: number } {
  const x = Number.isFinite(spot.x) ? spot.x : 0.3
  const y = Number.isFinite(spot.y) ? spot.y : 0.5
  return {
    x: Math.round(clamp(x, CUSTOM_SPOT_RANGE.minX, CUSTOM_SPOT_RANGE.maxX) * 1000) / 1000,
    y: Math.round(clamp(y, CUSTOM_SPOT_RANGE.minY, CUSTOM_SPOT_RANGE.maxY) * 1000) / 1000,
  }
}

/** boardSpot 的逆运算：球场上的百分比 → 阵型归一化坐标。拖拽松手时用。 */
export function boardSpotFromPercent(leftPercent: number, topPercent: number): { x: number; y: number } {
  const left = clamp(leftPercent, 0, 100) / 100
  const top = clamp(topPercent, 0, 100) / 100
  const down = top * 106 - 3
  return clampSpot({ x: ((100 - down) / 92) * 0.8, y: (left * 68 - 2) / 64 })
}

/** 两队对比的细分段条，数值写在两端。 */
export function compareRow(label: string, home: number, away: number, homeText: string | number = home, awayText: string | number = away): string {
  const total = home + away
  const homeShare = total > 0 ? (home / total) * 100 : 50
  return `<div class="cmp"><span class="cmp-value">${homeText}</span><div class="cmp-mid"><span class="cmp-label">${label}</span><div class="cmp-bar"><i class="cmp-home" style="width:${homeShare.toFixed(1)}%"></i><i class="cmp-away" style="width:${(100 - homeShare).toFixed(1)}%"></i></div></div><span class="cmp-value">${awayText}</span></div>`
}

export function mainAttrs(player: Pick<Player, 'positions'>): readonly AttrKey[] {
  return mainAttrsFor(player.positions.GK > 0)
}

export function attrHeadCell(key: AttrKey): string {
  return `<abbr title="${esc(ATTR_META[key].label)}：${esc(ATTR_META[key].desc)}">${esc(ATTR_META[key].label.length > 3 ? ATTR_META[key].label.slice(0, 2) : ATTR_META[key].label)}</abbr>`
}

export { icon }
