import type { AITeam, MatchRecord } from '../../game/types.ts'
import { caOf } from '../../game/ca.ts'
import { mainAttrsFor } from '../../game/rating.ts'
import { attrLabel } from '../../game/data/attributes.ts'
import { LEGEND_TEAMS } from '../../game/data/legend-teams.ts'
import { legendTeamById } from '../../game/legend.ts'
import { PEAK_STAGE_COUNT, peakStageDef, buildPeakTeam } from '../../game/peak.ts'
import { PEAK_REWARD_STAGE, peakRewardReady } from '../../game/peak-reward.ts'
import { PEAK_DAILY_LIMIT, peakDailyStatus } from '../../game/peak-attempts.ts'
import { LEGEND_DAILY_LIMIT, legendDailyStatus } from '../../game/legend-attempts.ts'
import { peakStageReward } from '../../game/data/peak-rewards.ts'
import { peakStageShopPoints } from '../../game/shop.ts'
import { peakSkillForStage } from '../../game/data/peak-skills.ts'
import { SQUAD_LIMIT } from '../../game/market.ts'
import { legendRecordOf } from '../../game/pve.ts'
import { legendSkillForTeam } from '../../game/data/legend-skills.ts'
import { SKILLS } from '../../game/data/skills.ts'
import { skillEffectText } from '../../game/data/skill-effects.ts'
import { legendBookLabel } from '../../game/legend-books.ts'
import { cupTeam } from '../../game/cup-run.ts'
import { clubRatings, lineupRating } from '../../game/club-rating.ts'
import { pveContentReady } from '../../game/pve-content.ts'
import { assetUrl, bookArt, bookTitle, breakthroughCardArt, caHeat, clubName, icon, ownName, pageHead, panel, recordResult, resultPill, tag, tile } from '../components.ts'
import { tipAttrs } from '../tooltip.ts'
import { aiTeamTacticLabel, countdownText, esc, playerCA } from '../format.ts'
import { divisionRatings } from '../club-view.ts'
import { starRating } from '../stars.ts'
import { game, ui } from '../state.ts'
import { conferenceLabel } from '../../game/data/world-clubs.ts'
import { inPostseason, PLAYER_TEAM_ID } from '../../game/season.ts'
import { isSeasonEventsOpen } from '../../game/events/season-events.ts'
import { isOnlineMode, onlineState, serverNow } from '../../online.ts'
import { DEFAULT_FORMATION, FORMATIONS } from '../../game/data/formations.ts'
import { coreNames, pveRoster, pveTeamButton } from '../pve-details.ts'
import { renderCup } from '../cup-view.ts'

const MODE_LABEL = { friendly: '友谊赛', legend: '传奇挑战', cup: '杯赛挑战', peak: '巅峰之路' }
const MODE_SUB = {
  friendly: '不计联赛积分，平局直接进入点球大战。',
  legend: '50 支历史俱乐部队；胜/平掉技能书，首胜发球迷/资金。每个现实日限挑战 20 次（北京时间 00:00 重置）。',
  cup: '两个 16 队杯和一个 32 队杯。世界球队 + 随机队，小组循环后淘汰赛；决赛单场。',
  peak: '100 关，对手 RANK 3850→14300。前 80 关生成/特别，最后 20 关世界杯国家队，所有玩家对手相同。',
}
const MODE_BANNER = {
  friendly: { path: 'assets/banners/banner-challenge-friendly.webp', position: '84% 56%', accent: '#4fd08a' },
  legend: { path: 'assets/banners/banner-challenge-legend.webp', position: '76% 52%', accent: '#b57bff' },
  cup: { path: 'assets/banners/banner-challenge-cup.webp', position: '82% 38%', accent: '#f2b84b' },
  peak: { path: 'assets/banners/banner-challenge-peak.webp', position: '78% 52%', accent: '#cdf33f' },
} as const

function recordsPanel(records: MatchRecord[], title = '挑战记录'): string {
  return panel(`${title} <small>${records.length}</small>`, records.length ? `<div class="rows">${records.slice(0, 30).map((record) => `<button class="row-btn result-row" data-action="open-review" data-record="${esc(record.id)}">${resultPill(recordResult(record.result))}<span class="result-teams">${ownName(record.homeName, record.homeId === PLAYER_TEAM_ID)} <b>${record.score.home}:${record.score.away}</b> ${ownName(record.awayName, record.awayId === PLAYER_TEAM_ID)}${record.shootout ? ` <small>点球 ${record.shootout.home}:${record.shootout.away}</small>` : ''}</span>${icon('right', 12)}</button>`).join('')}</div>` : '<p class="muted pad">还没有挑战记录。</p>', { flush: true })
}

function renderFriendly(): string {
  const options = game.world ? game.world.divisions.map((division) => ({ id: division.divisionId!, label: division.tier === 'champions' ? '冠军联赛' : division.tier === 'division1' ? (division.conference ? `精英联赛 · ${conferenceLabel(division.conference, 'division1')}` : '精英联赛') : `先锋联赛 · ${conferenceLabel(division.conference)}` })) : [{ id: 'own', label: '本联赛' }]
  const fallback = game.world?.playerDivisionId ?? 'own'
  const active = options.some((entry) => entry.id === ui.challengeDivision) ? ui.challengeDivision! : fallback
  const own = !game.world || active === game.world.playerDivisionId
  const ids = game.world?.divisions.find((division) => division.divisionId === active)?.clubIds ?? []
  const teams = own ? game.aiTeams : ids.filter((id) => id !== 'player').flatMap((id) => {
    const club = game.world!.clubs.find((entry) => entry.id === id)
    return club ? [{
      ...club,
      formationId: club.liveFormationId ?? club.formationId ?? DEFAULT_FORMATION,
      tactics: club.liveTactics ?? club.tactics,
      tacticalStyle: club.liveTacticalStyle,
      players: [],
    }] : []
  })
  const ratings = game.world ? divisionRatings(game.world, teams.map((team) => team.id)) : clubRatings(game)
  return `${inPostseason(game) ? '<div class="banner info">赛后休整期间也可以约战世界球队。</div>' : ''}<div class="toolbar"><span>选择联赛</span><div class="seg">${options.map((entry) => `<button class="${active === entry.id ? 'active' : ''}" data-challenge-div="${entry.id}">${esc(entry.label)}</button>`).join('')}</div>${onlineState.status === 'online' ? '<span class="muted small">联机对手名单由服务器提供。</span>' : ''}</div>
    <div class="grid challenge-grid">${panel(`可挑战球队 <small>${teams.length}</small>`, `<div class="table-scroll"><table class="dt"><thead><tr><th>球队</th><th>阵型</th><th>战术</th><th>实力</th><th class="num" title="首发 CA 之和">RANK</th><th>核心球员</th><th></th></tr></thead><tbody>${teams.map((team) => {
      const best = [...team.players].sort((a, b) => playerCA(b) - playerCA(a))
      const rank = ratings.get(team.id) ?? ('lineup' in team && team.lineup ? lineupRating(team.players, team.lineup) : undefined)
      const formationId = 'lineup' in team && team.lineup ? team.lineup.formationId : team.formationId
      return `<tr><td>${clubName(team.id)}</td><td>${formationId}</td><td>${esc(aiTeamTacticLabel(team))}</td><td>${starRating(team.strength, '球队实力')}</td><td class="num strong">${rank ? Math.round(rank) : '约战后再看'}</td><td>${best.slice(0, 3).map((p) => esc(p.name)).join('、')}</td><td><button class="btn small" data-action="start-world-challenge" data-team="${esc(team.id)}" ${game.activeMatch ? 'disabled' : ''}>约战</button></td></tr>`
    }).join('')}</tbody></table></div>`, { flush: true })}${recordsPanel(game.challengeHistory.filter((record) => !record.mode || record.mode === 'friendly'))}</div>`
}

const BOOK_TIER_ORDER = { rainbow: 0, gold: 1, silver: 2 } as const
const BOOK_TIER_NAME = { rainbow: '彩虹', gold: '金色', silver: '银色' } as const

function legendBooksPanel(): string {
  const books = game.legendBooks ?? []
  if (!books.length) return ''
  const sorted = books.slice().sort((a, b) =>
    BOOK_TIER_ORDER[a.tier] - BOOK_TIER_ORDER[b.tier] || legendBookLabel(a).localeCompare(legendBookLabel(b), 'zh-CN'),
  )
  const counts = { rainbow: 0, gold: 0, silver: 0 }
  for (const book of sorted) counts[book.tier]++
  const summary = (['rainbow', 'gold', 'silver'] as const)
    .filter((tier) => counts[tier] > 0)
    .map((tier) => `<span class="book-tier-chip tier-${tier}">${BOOK_TIER_NAME[tier]} ${counts[tier]}</span>`)
    .join('')
  const items = sorted.map((book) => {
    const label = legendBookLabel(book)
    const def = SKILLS[book.id as keyof typeof SKILLS]
    const effect = def ? skillEffectText(book.id as keyof typeof SKILLS, book.tier) : ''
    const tipBody = [def?.desc, effect, '可在培养页带进书槽'].filter(Boolean).join('\n')
    const tip = tipAttrs(`${label} · ${BOOK_TIER_NAME[book.tier]}技能书`, tipBody)
    return `<div class="book-card tier-${book.tier}" role="listitem" ${tip} data-book-id="${esc(book.id)}" data-book-tier="${book.tier}">
      <div class="book-cover">
        <span class="book-spine" aria-hidden="true"></span>
        <span class="book-emblem" aria-hidden="true">${bookArt(book.tier, 36)}</span>
        <span class="book-cover-title">${bookTitle(label, book.tier)}</span>
        <span class="book-cover-rule" aria-hidden="true"></span>
      </div>
      <span class="book-pages" aria-hidden="true"></span>
      <span class="book-ribbon" aria-hidden="true"></span>
    </div>`
  }).join('')
  return panel(
    `技能书库存 <small>${books.length}</small>`,
    `<p class="hint pad">技能书按稀有度分为银色、金色与彩虹色，悬停或点击书本可查看详细效果；前往培养页选择球员并配置到书槽。</p><div class="book-shelf" role="list" aria-label="技能书库存书架">${items}</div><div class="btn-row pad"><button class="btn small" data-nav="training">去培养配置技能卡 ${icon('right', 12)}</button></div>`,
    { flush: true, aside: summary ? `<span class="book-tier-summary">${summary}</span>` : undefined },
  )
}

function renderLegend(): string {
  const now = isOnlineMode() ? serverNow() : Date.now()
  const quota = legendDailyStatus(game, now)
  const beaten = Object.values(game.pve?.legends ?? {}).filter((row) => row.won > 0).length
  const eras = [...new Set(LEGEND_TEAMS.map((def) => `${Math.floor(Number(def.season.slice(0, 4)) / 10) * 10}`))].sort()
  const countries = [...new Set(LEGEND_TEAMS.map((def) => def.country).filter((country): country is string => !!country))].sort()
  const search = ui.legendSearch.trim().toLocaleLowerCase()
  const teams = LEGEND_TEAMS.filter((def) => (ui.legendTier === 'ALL' || def.tier === ui.legendTier) &&
    (ui.legendCountry === 'ALL' || def.country === ui.legendCountry) &&
    (ui.legendEra === 'ALL' || def.season.startsWith(ui.legendEra.slice(0, 3))) &&
    (!search || [def.club, def.clubEn, def.season, def.coach, ...def.players.flatMap((p) => [p[0], p[1], p[2]])].join(' ').toLocaleLowerCase().includes(search)))
  const startDisabled = !!game.activeMatch || !!ui.completing || quota.remaining <= 0
  return `<div class="kpi-row">${tile('已击败', `${beaten} / ${LEGEND_TEAMS.length}`)}${tile('今日剩余', `${quota.remaining} / ${LEGEND_DAILY_LIMIT}`)}${tile('技能书库存', `${game.legendBooks?.length ?? 0} 本`)}</div>
    <p class="hint pad" data-legend-reset-at="${quota.resetAt}">每个现实日（北京时间 00:00 重置）最多挑战 ${LEGEND_DAILY_LIMIT} 次；开赛即消耗，胜负平及重打均计入。下次重置：<span class="countdown" data-countdown-end="${quota.resetAt}">${esc(countdownText(quota.resetAt - now))}</span>。</p>
    <div class="toolbar"><select id="legend-country" aria-label="俱乐部国家"><option value="ALL">全部国家</option>${countries.map((country) => `<option ${country === ui.legendCountry ? 'selected' : ''} value="${country}">${country}</option>`).join('')}</select><input id="legend-search" type="search" aria-label="搜索传奇队" placeholder="球队、球员、国家或年份" value="${esc(ui.legendSearch)}"><select id="legend-era" aria-label="传奇队年代"><option value="ALL">全部年代</option>${eras.map((era) => `<option value="${era}" ${ui.legendEra === era ? 'selected' : ''}>${era} 年代</option>`).join('')}</select><div class="seg">${(['ALL', 'S+', 'S', 'A', 'B'] as const).map((tier) => `<button data-legend-tier="${tier}" class="${ui.legendTier === tier ? 'active' : ''}">${tier === 'ALL' ? '全部' : tier}</button>`).join('')}</div></div>
    ${panel(`传奇球队 <small>${teams.length}</small>`, teams.length ? `<div class="table-scroll"><table class="dt"><thead><tr><th>球队</th><th>赛季</th><th>教练</th><th class="num" title="首发 CA 之和">RANK</th><th>核心球员</th><th>掉落技能书</th><th>战绩</th><th></th></tr></thead><tbody>${teams.map((def) => {
      const team = legendTeamById(def.id)!, record = legendRecordOf(game, def.id)
      const drop = legendSkillForTeam(def.id)
      const statusClass = record.won > 0 ? 'legend-row-won' : record.drawn > 0 ? 'legend-row-drawn' : ''
      const statusTag = record.won > 0 ? tag('已击败', 'good') : record.drawn > 0 ? tag('已打平', 'gold') : ''
      return `<tr${statusClass ? ` class="${statusClass}"` : ''}><td>${tag(def.tier, def.tier === 'S+' ? 'gold' : '')} ${pveTeamButton(`legend:${def.id}`, def.club)}<details><summary>历史注解</summary>${esc(def.note)}</details></td><td>${def.season}</td><td>${esc(def.coach)}</td><td class="num strong">${Math.round(lineupRating(team.players, team.lineup))}</td><td>${esc(coreNames(team))}</td><td>${drop ? tag(esc(drop.name), 'skill-rainbow') : '—'}</td><td>${statusTag ? `${statusTag} ` : ''}${record.played ? `${record.won}胜 ${record.drawn}平 ${record.lost}负 · ${record.goals}:${record.conceded}` : '尚未挑战'}</td><td><button class="btn small" data-action="start-legend-challenge" data-team="${def.id}" ${startDisabled ? 'disabled' : ''}>${quota.remaining <= 0 ? '次数已用完' : '开战'}</button></td></tr>`
    }).join('')}</tbody></table></div>` : '<p class="muted pad">没有符合条件的球队，请修改筛选。</p>', { flush: true })}
    ${legendBooksPanel()}
    ${recordsPanel(game.challengeHistory.filter((record) => record.mode === 'legend'), '传奇战报')}`
}

function peakRewardPanel(): string {
  const peak = game.pve?.peak
  if (!peak) return ''
  const claimed = peak.reward50
  if (claimed) {
    return panel('第 50 关全明星奖励', `<p class="hint pad">已加入：<b>${esc(claimed.name)}</b> · 当前 CA ${Math.round(claimed.ca)}</p>`, { flush: true })
  }
  if (!peakRewardReady(game)) return ''
  const team = buildPeakTeam(PEAK_REWARD_STAGE)
  const roles = new Map(team.lineup.starters.map((starter) => [starter.playerId, FORMATIONS[team.formationId].slots.find((slot) => slot.id === starter.slotId)?.label ?? '首发']))
  const full = game.roster.length >= SQUAD_LIMIT
  const rows = team.players.map((player) => {
    const ca = caOf(player.attrs, player.positions.GK > 0)
    return `<tr><td>${esc(roles.get(player.id) ?? '替补')}</td><td><b>${esc(player.name)}</b><small class="muted"> ${esc(player.enName)}</small></td><td class="num">${caHeat(ca)}</td><td><button class="btn small" data-action="claim-peak-reward" data-player="${esc(player.id)}" ${game.activeMatch || full ? 'disabled' : ''}>选择加入</button></td></tr>`
  }).join('')
  const warning = full ? `<p class="warn-text pad">阵容已满（${game.roster.length} / ${SQUAD_LIMIT}），请先裁掉一名球员再领取。</p>` : ''
  return panel('第 50 关全明星奖励 · 选择 1 人加入', `<p class="hint pad">击败足球小将全明星后，可从下面 16 人中选 1 人加入；入队保留当前 CA。</p>${warning}<div class="table-scroll"><table class="dt"><thead><tr><th>位置</th><th>球员</th><th class="num">当前 CA</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`, { flush: true })
}

function peakBreakthroughPanel(): string {
  const pve = game.pve?.peak
  const cards = pve?.breakthroughCards ?? 0
  if (cards <= 0) return ''
  const player = game.roster.find((item) => item.id === ui.peakCardPlayerId) ?? game.roster[0]
  if (!player) return ''
  ui.peakCardPlayerId = player.id
  const attrs = mainAttrsFor(player.positions.GK > 0)
  if (!ui.peakCardAttr || !attrs.includes(ui.peakCardAttr)) ui.peakCardAttr = attrs[0]
  return panel(`属性突破卡 <small>${cards}</small>`, `<div class="breakthrough-box">${breakthroughCardArt(76)}<div class="breakthrough-body"><p class="hint">每张卡让一名球员的一项主属性上限 +100；只加上限，不直接加当前属性。</p>
    <div class="form-row"><label for="peak-card-player">球员</label><select id="peak-card-player" data-peak-card-player>${game.roster.map((item) => `<option value="${esc(item.id)}" ${item.id === player.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></div>
    <div class="form-row"><label for="peak-card-attr">属性</label><select id="peak-card-attr" data-peak-card-attr>${attrs.map((key) => `<option value="${key}" ${key === ui.peakCardAttr ? 'selected' : ''}>${esc(attrLabel(key))}</option>`).join('')}</select></div>
    <button class="btn primary" data-action="use-peak-card" ${game.activeMatch ? 'disabled' : ''}>使用 1 张</button></div></div>`, { flush: true })
}

function peakRewardHtml(stage: number): string {
  const parts: string[] = []
  const reward = peakStageReward(stage)
  if (reward) {
    parts.push(esc(reward.kind === 'money' ? `金币 ${reward.amount.toLocaleString()}` : `球迷 +${reward.amount.toLocaleString()}`))
    if (reward.breakthroughCards) parts.push(esc(`属性突破卡 ×${reward.breakthroughCards}`))
  }
  const shopPts = peakStageShopPoints(stage)
  if (shopPts > 0) parts.push(esc(`商店点数 +${shopPts}`))
  if (stage === PEAK_REWARD_STAGE) parts.push('从全明星名单中任选 1 人加入')
  const skill = peakSkillForStage(stage)
  if (skill) parts.push(`技能书 ${bookTitle(skill.name, 'rainbow')}`)
  return parts.join(' · ')
}

function peakRewardsPanel(stage: number, cleared: number): string {
  const stages = Array.from({ length: PEAK_STAGE_COUNT }, (_, index) => index + 1)
  const status = stage === PEAK_REWARD_STAGE && stage <= cleared && !game.pve?.peak.reward50
    ? '已通关，金币已发放；请在下方选择全明星球员。首次奖励不会重复发放。'
    : stage <= cleared ? '已通关，首次奖励不会重复发放' : '首次通关时自动发放（第 50 关球员需手动选择）'
  const choices = stages.map(n => `<button class="row-btn" data-peak-preview="${n}"><b>第 ${n} 关</b><span>${peakRewardHtml(n)}</span><small>${n <= cleared ? '已通关' : '未通关'}</small></button>`).join('')
  return panel(`第 ${stage} 关奖励`, `<div class="pad"><b>${peakRewardHtml(stage)}</b><p class="hint">${esc(status)}</p></div><details class="pad"><summary>查看全部关卡奖励</summary><div class="rows">${choices}</div></details>`, { flush: true })
}

function renderPeak(): string {
  const cleared = game.pve?.peak.cleared ?? 0, done = cleared >= PEAK_STAGE_COUNT
  const current = Math.min(PEAK_STAGE_COUNT, cleared + 1)
  const selected = ui.peakPreviewStage ?? current
  const stage = Math.max(1, Math.min(PEAK_STAGE_COUNT, selected))
  const def = peakStageDef(stage), team = buildPeakTeam(stage)
  const canPlay = stage <= cleared + 1
  const replay = stage <= cleared
  const now = isOnlineMode() ? serverNow() : Date.now()
  const quota = peakDailyStatus(game, now)
  const disabled = !canPlay || !!game.activeMatch || !!ui.completing || quota.remaining <= 0
  const kindLabel = def.kind === 'national' ? '世界杯国家队' : def.kind === 'special' ? '动漫全明星' : '生成队'
  const teamRank = Math.round(lineupRating(team.players, team.lineup))
  return `<div class="kpi-row">${tile('已通关', `${cleared} / ${PEAK_STAGE_COUNT}`)}${tile('当前关', done ? '全部完成' : String(current))}${tile('今日剩余', `${quota.remaining} / ${PEAK_DAILY_LIMIT}`)}${tile('对手 RANK', String(teamRank), '首发 CA 之和')}</div>
    <p class="hint pad" data-peak-reset-at="${quota.resetAt}">每天（北京时间 00:00 重置）最多挑战 ${PEAK_DAILY_LIMIT} 次；开赛即消耗，胜负及重打均计入。下次重置：<span class="countdown" data-countdown-end="${quota.resetAt}">${esc(countdownText(quota.resetAt - now))}</span>。</p>
    ${panel('进度 · 点击任意关卡预览', `<div class="peak-track" aria-label="巅峰之路关卡">${Array.from({ length: 100 }, (_, i) => `<button class="peak-cell ${i < cleared ? 'done' : ''} ${i + 1 === current && !done ? 'current' : ''} ${i >= 80 ? 'national' : ''}" data-peak-preview="${i + 1}" aria-label="第 ${i + 1} 关${i < cleared ? '，已通关' : i + 1 === current ? '，当前关' : '，未解锁'}" aria-pressed="${i + 1 === stage}">${i + 1}</button>`).join('')}</div><p class="hint pad">绿色已通关，高亮为当前关；81–100 关为世界杯国家队。可重打已通关关卡或挑战当前关，其余关卡只能预览。</p>`, { flush: true })}
    ${peakRewardsPanel(stage, cleared)}
    ${peakRewardPanel()}
    ${peakBreakthroughPanel()}
    ${panel(replay ? '已通关对手' : canPlay ? '当前对手' : '关卡预览', `<div class="peak-current"><div class="peak-stage-no">第 ${stage} 关</div><div class="peak-stage-main"><b>${esc(team.name)}</b><span>${kindLabel} · ${team.formationId} · ${esc(aiTeamTacticLabel(team))}</span><span>核心：${esc(coreNames(team))}</span></div><div class="peak-stage-ca"><span>对手 RANK</span><b>${teamRank}</b></div>${pveTeamButton(`peak:${stage}`)}<button class="btn" data-action="start-peak-stage" data-stage="${stage}" ${disabled ? 'disabled' : ''}>${!canPlay ? '仅预览' : quota.remaining <= 0 ? '次数已用完' : replay ? '重打' : '挑战'}</button></div>`, { flush: true })}
    ${recordsPanel(game.challengeHistory.filter((record) => record.mode === 'peak'), '最近闯关')}
    <p class="hint pad">每关对手固定，每次开赛重新模拟；获胜推进当前关，重打不重复发首次通关奖励。调整阵容、战术不会受关卡预览影响。</p>`
}

function selectedRoster(): string {
  if (!ui.pveTeamId) return ''
  const [kind, key, ...rest] = ui.pveTeamId.split(':')
  let team: AITeam | undefined
  if (kind === 'legend') team = legendTeamById(key)
  if (kind === 'peak' && Number(key) >= 1 && Number(key) <= 100) team = buildPeakTeam(Number(key))
  if (kind === 'cup') {
    const run = game.pve?.cups[key]
    if (run) team = cupTeam(game, run, rest.join(':'))
  }
  return `<div class="pve-detail" id="pve-team-detail">${pveTeamButton('', '关闭阵容')}${team ? pveRoster(team) : '<p class="hint">历史仅保留赛果，当前没有这支球队的阵容快照。</p>'}</div>`
}

export function renderChallenge(): string {
  // 只有正式赛季杯赛已经启用时才替换旧入口，避免功能未开放期间隐藏现有杯赛。
  const seasonCupsEnabled = game.world?.seasonCupMode === 1
  const mode = seasonCupsEnabled && ui.challengeMode === 'cup' ? 'friendly' : ui.challengeMode
  const loaded = mode === 'friendly' || (mode === 'cup' ? !game.pve?.cupSeasonDeferred || game.pve.cupSeason?.seasonIndex === game.season.index : pveContentReady())
  const body = !loaded ? '<p class="banner info" role="status">正在加载对手名单，请稍候；加载失败时可重新选择此模式。</p>' : mode === 'friendly' ? renderFriendly() : mode === 'legend' ? renderLegend() : mode === 'cup' ? renderCup() : renderPeak()
  const banner = MODE_BANNER[mode]
  return `${pageHead({
    kicker: '挑战 · 纯 PvE',
    title: MODE_LABEL[mode],
    sub: MODE_SUB[mode],
    banner: assetUrl(banner.path),
    bannerPosition: banner.position,
    accent: banner.accent,
  })}
    ${isSeasonEventsOpen(game) ? '<div class="toolbar"><strong>S3 · 十二码之夜（3D 点球活动）</strong><button class="btn" data-action="penalty-training">进入 3D 点球训练场</button><button class="btn primary" data-nav="events">打开点球活动</button><small>支持无门将空门与本季环境自由练习</small></div>' : ''}
    <div class="seg challenge-mode-tabs" aria-label="挑战模式">${(Object.keys(MODE_LABEL) as (keyof typeof MODE_LABEL)[]).filter(key => !seasonCupsEnabled || key !== 'cup').map((key) => `<button data-challenge-mode="${key}" class="${key === mode ? 'active' : ''}">${MODE_LABEL[key]}</button>`).join('')}</div>
    ${body}${loaded ? selectedRoster() : ''}`
}
