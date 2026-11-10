import type { AITeam, MatchRecord } from '../../game/types.ts'
import { caOf } from '../../game/ca.ts'
import { LEGEND_TEAMS } from '../../game/data/legend-teams.ts'
import { legendTeamById } from '../../game/legend.ts'
import { PEAK_STAGE_COUNT, peakStageDef, buildPeakTeam } from '../../game/peak.ts'
import { legendRecordOf } from '../../game/pve.ts'
import { cupTeam } from '../../game/cup-run.ts'
import { startingCa } from '../../game/pve-strength.ts'
import { PVE_CONTENT_VERSION, PVE_CONTENT_HASH, pveContentReady } from '../../game/pve-content.ts'
import { caHeat, clubName, icon, pageHead, panel, recordResult, resultPill, tag, tile } from '../components.ts'
import { esc, playerCA, tacticText } from '../format.ts'
import { game, ui } from '../state.ts'
import { conferenceLabel } from '../../game/data/world-clubs.ts'
import { inPostseason } from '../../game/season.ts'
import { onlineState } from '../../online.ts'
import { DEFAULT_FORMATION } from '../../game/data/formations.ts'
import { renderCup } from '../cup-view.ts'
import { coreNames, pveRoster, pveTeamButton } from '../pve-details.ts'

const MODE_LABEL = { friendly: '友谊赛', legend: '传奇挑战', cup: '杯赛挑战', peak: '巅峰之路' }
const MODE_SUB = {
  friendly: '不计联赛积分，平局直接进入点球大战。挑战比赛不扣体能。',
  legend: '50 支历史俱乐部队；固定阵容与属性，可查看完整首发、替补和 7 项主属性。',
  cup: '两个 16 队杯和一个 32 队杯。世界球队 + 随机队，小组循环后淘汰赛；决赛单场。',
  peak: '100 关，首发平均 CA 350→1300。前 80 关生成，最后 20 关世界杯国家队，所有玩家对手相同。',
}

function recordsPanel(records: MatchRecord[], title = '挑战记录'): string {
  return panel(`${title} <small>${records.length}</small>`, records.length ? `<div class="rows">${records.slice(0, 30).map((record) => `<button class="row-btn result-row" data-action="open-review" data-record="${esc(record.id)}">${resultPill(recordResult(record.result))}<span class="result-teams">${esc(record.homeName)} <b>${record.score.home}:${record.score.away}</b> ${esc(record.awayName)}${record.shootout ? ` <small>点球 ${record.shootout.home}:${record.shootout.away}</small>` : ''}</span>${icon('right', 12)}</button>`).join('')}</div>` : '<p class="muted pad">还没有挑战记录。</p>', { flush: true })
}

function renderFriendly(): string {
  const options = game.world ? game.world.divisions.map((division) => ({ id: division.divisionId!, label: division.tier === 'champions' ? '冠军联赛' : division.tier === 'division1' ? '一级联赛' : `二级联赛 · ${conferenceLabel(division.conference)}` })) : [{ id: 'own', label: '本联赛' }]
  const fallback = game.world?.playerDivisionId ?? 'own'
  const active = options.some((entry) => entry.id === ui.challengeDivision) ? ui.challengeDivision! : fallback
  const own = !game.world || active === game.world.playerDivisionId
  const ids = game.world?.divisions.find((division) => division.divisionId === active)?.clubIds ?? []
  const teams = own ? game.aiTeams : ids.filter((id) => id !== 'player').flatMap((id) => {
    const club = game.world!.clubs.find((entry) => entry.id === id)
    return club ? [{ ...club, formationId: club.formationId ?? DEFAULT_FORMATION, players: [] }] : []
  })
  return `${inPostseason(game) ? '<div class="banner info">赛后休整期间也可以约战世界球队。</div>' : ''}<div class="toolbar"><span>选择联赛</span><div class="seg">${options.map((entry) => `<button class="${active === entry.id ? 'active' : ''}" data-challenge-div="${entry.id}">${esc(entry.label)}</button>`).join('')}</div>${onlineState.status === 'online' ? '<span class="muted small">联机对手名单由服务器提供。</span>' : ''}</div>
    <div class="grid challenge-grid">${panel(`可挑战球队 <small>${teams.length}</small>`, `<div class="table-scroll"><table class="dt"><thead><tr><th>球队</th><th>阵型</th><th>战术</th><th>实力</th><th>平均 CA</th><th>核心球员</th><th></th></tr></thead><tbody>${teams.map((team) => {
      const best = [...team.players].sort((a, b) => playerCA(b) - playerCA(a))
      const average = best.slice(0, 11).reduce((sum, p) => sum + playerCA(p), 0) / Math.min(11, best.length || 1)
      return `<tr><td>${clubName(team.id)}</td><td>${team.formationId}</td><td>${esc(tacticText(team.tactics))}</td><td>${team.strength} / 5</td><td>${best.length ? caHeat(average) : '约战后再看'}</td><td>${best.slice(0, 3).map((p) => esc(p.name)).join('、')}</td><td><button class="btn small" data-action="start-world-challenge" data-team="${esc(team.id)}" ${game.activeMatch ? 'disabled' : ''}>约战</button></td></tr>`
    }).join('')}</tbody></table></div>`, { flush: true })}${recordsPanel(game.challengeHistory.filter((record) => !record.mode || record.mode === 'friendly'))}</div>`
}

function renderLegend(): string {
  const eras = [...new Set(LEGEND_TEAMS.map((def) => `${Math.floor(Number(def.season.slice(0, 4)) / 10) * 10}`))].sort()
  const countries = [...new Set(LEGEND_TEAMS.map((def) => def.country).filter((country): country is string => !!country))].sort()
  const search = ui.legendSearch.trim().toLocaleLowerCase()
  const teams = LEGEND_TEAMS.filter((def) => (ui.legendTier === 'ALL' || def.tier === ui.legendTier) &&
    (ui.legendCountry === 'ALL' || def.country === ui.legendCountry) &&
    (ui.legendEra === 'ALL' || def.season.startsWith(ui.legendEra.slice(0, 3))) &&
    (!search || [def.club, def.clubEn, def.season, def.coach, ...def.players.flatMap((p) => [p[0], p[1], p[2]])].join(' ').toLocaleLowerCase().includes(search)))
  return `<div class="toolbar"><select id="legend-country" aria-label="俱乐部国家"><option value="ALL">全部国家</option>${countries.map((country) => `<option ${country === ui.legendCountry ? 'selected' : ''} value="${country}">${country}</option>`).join('')}</select><input id="legend-search" type="search" aria-label="搜索传奇队" placeholder="球队、球员、国家或年份" value="${esc(ui.legendSearch)}"><select id="legend-era" aria-label="传奇队年代"><option value="ALL">全部年代</option>${eras.map((era) => `<option value="${era}" ${ui.legendEra === era ? 'selected' : ''}>${era} 年代</option>`).join('')}</select><div class="seg">${(['ALL', 'S+', 'S', 'A', 'B'] as const).map((tier) => `<button data-legend-tier="${tier}" class="${ui.legendTier === tier ? 'active' : ''}">${tier === 'ALL' ? '全部' : tier}</button>`).join('')}</div></div>
    ${panel(`传奇球队 <small>${teams.length}</small>`, teams.length ? `<div class="table-scroll"><table class="dt"><thead><tr><th>球队</th><th>赛季</th><th>教练</th><th>首发 CA</th><th>核心球员</th><th>战绩</th><th></th></tr></thead><tbody>${teams.map((def) => {
      const team = legendTeamById(def.id)!, record = legendRecordOf(game, def.id)
      return `<tr><td>${tag(def.tier, def.tier === 'S+' ? 'gold' : '')} ${pveTeamButton(`legend:${def.id}`, def.club)}<details><summary>历史注解</summary>${esc(def.note)}</details></td><td>${def.season}</td><td>${esc(def.coach)}</td><td>${caHeat(startingCa(team))}</td><td>${esc(coreNames(team))}</td><td>${record.played ? `${record.won}胜 ${record.drawn}平 ${record.lost}负 · ${record.goals}:${record.conceded}` : '尚未挑战'}</td><td><button class="btn small" data-action="start-legend-challenge" data-team="${def.id}" ${game.activeMatch ? 'disabled' : ''}>开战</button></td></tr>`
    }).join('')}</tbody></table></div>` : '<p class="muted pad">没有符合条件的球队，请修改筛选。</p>', { flush: true })}
    ${recordsPanel(game.challengeHistory.filter((record) => record.mode === 'legend'), '传奇战报')}`
}

function renderPeak(): string {
  const cleared = game.pve?.peak.cleared ?? 0, done = cleared >= 100
  const current = Math.min(100, cleared + 1)
  const selected = ui.peakPreviewStage ?? current
  const stage = Math.max(1, Math.min(100, selected))
  const def = peakStageDef(stage), team = buildPeakTeam(stage)
  const canPlay = !done && stage === current
  return `<div class="kpi-row">${tile('已通关', `${cleared} / ${PEAK_STAGE_COUNT}`)}${tile('当前关', done ? '全部完成' : String(current))}${tile('浏览关卡', String(stage))}${tile('首发平均 CA', String(Math.round(startingCa(team))))}</div>
    ${panel('进度 · 点击任意关卡预览', `<div class="peak-track" aria-label="巅峰之路关卡">${Array.from({ length: 100 }, (_, i) => `<button class="peak-cell ${i < cleared ? 'done' : ''} ${i + 1 === current && !done ? 'current' : ''} ${i >= 80 ? 'national' : ''}" data-peak-preview="${i + 1}" aria-label="第 ${i + 1} 关${i < cleared ? '，已通关' : i + 1 === current ? '，当前关' : '，未解锁'}" aria-pressed="${i + 1 === stage}">${i + 1}</button>`).join('')}</div><p class="hint pad">绿色已通关，高亮为当前关；81–100 关为世界杯国家队。只能挑战当前关，但可以预览全部关卡。</p>`, { flush: true })}
    ${panel(done ? '100 关全部通关 · 对手预览' : canPlay ? '当前对手' : '关卡预览', `<div class="peak-current"><div class="peak-stage-no">第 ${stage} 关</div><div class="peak-stage-main"><b>${esc(team.name)}</b><span>${def.kind === 'national' ? '世界杯国家队' : '生成队'} · ${team.formationId} · ${esc(tacticText(team.tactics))}</span><span>核心：${esc(coreNames(team))}</span></div><div class="peak-stage-ca"><span>目标 CA ${def.targetCa}</span><b>${startingCa(team).toFixed(0)}</b></div>${pveTeamButton(`peak:${stage}`)}<button class="btn" data-action="start-peak-stage" data-stage="${stage}" ${!canPlay || game.activeMatch ? 'disabled' : ''}>${canPlay ? '挑战' : '仅预览'}</button></div>`, { flush: true })}
    ${recordsPanel(game.challengeHistory.filter((record) => record.mode === 'peak'), '最近闯关')}
    <p class="hint pad">对手固定，胜利推进下一关；失败可重试。调整阵容、战术不会受关卡预览影响。</p>`
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
  const mode = ui.challengeMode
  const loaded = mode === 'friendly' || pveContentReady()
  const body = !loaded ? '<p class="banner info" role="status">正在加载固定球队数据，请稍候…</p>' : mode === 'friendly' ? renderFriendly() : mode === 'legend' ? renderLegend() : mode === 'cup' ? renderCup() : renderPeak()
  return `${pageHead({ kicker: '挑战 · 纯 PvE', title: MODE_LABEL[mode], sub: MODE_SUB[mode] })}
    <div class="seg challenge-mode-tabs" aria-label="挑战模式">${(Object.keys(MODE_LABEL) as (keyof typeof MODE_LABEL)[]).map((key) => `<button data-challenge-mode="${key}" class="${key === mode ? 'active' : ''}">${MODE_LABEL[key]}</button>`).join('')}</div>
    <p class="hint">挑战比赛不扣体能、不发金钱或技能卡；杯赛冠军只记录奖杯荣誉。内容 v${PVE_CONTENT_VERSION} · ${PVE_CONTENT_HASH.slice(0, 8)}</p>${body}${loaded ? selectedRoster() : ''}`
}
