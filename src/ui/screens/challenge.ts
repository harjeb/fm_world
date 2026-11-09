import type { AITeam, CupRun } from '../../game/types.ts'
import type { WorldClub } from '../../game/types.ts'
import { caOf } from '../../game/ca.ts'
import { LEGEND_TEAMS } from '../../game/data/legend-teams.ts'
import { legendTeamById } from '../../game/legend.ts'
import { PEAK_STAGE_COUNT, peakStageDef } from '../../game/peak.ts'
import { peakStageReward } from '../../game/data/peak-config.ts'
import { CUP_DEFS, type CupId } from '../../game/data/cup-config.ts'
import { buildCupField, buildCupGroups } from '../../game/cup.ts'
import { cupPlayerFixture } from '../../game/cup-run.ts'
import { legendRecordOf } from '../../game/pve.ts'
import { caHeat, clubName, icon, pageHead, panel, recordResult, resultPill, tag } from '../components.ts'
import { esc, playerCA, tacticText } from '../format.ts'
import { game, ui } from '../state.ts'
import { conferenceLabel } from '../../game/data/world-clubs.ts'
import { inPostseason, nextSeasonCountdown } from '../../game/season.ts'
import { onlineState } from '../../online.ts'
import { DEFAULT_FORMATION } from '../../game/data/formations.ts'
import { STARTERS } from '../../game/squad.ts'

const MODE_LABEL = {
  friendly: '友谊赛',
  legend: '传奇挑战',
  cup: '杯赛挑战',
  peak: '巅峰之路',
} as const

const MODE_SUB = {
  friendly: '不计联赛积分，平局直接进入点球大战。比赛固定种子，读档不能刷新射门。',
  legend: '50 支历史强队的固定复刻阵容；按 7 项主属性设计，记录每支球队的战绩。',
  cup: '16/16/32 队，世界球队 + 随机队混合；小组循环后进入淘汰赛。',
  peak: '100 关由弱到难；前 80 关生成，后 20 关世界杯国家队。输了可以重试。',
} as const

const TIER_ORDER: Record<string, number> = { 'S+': 0, S: 1, A: 2, B: 3 }

function strengthStars(value: number): string {
  const level = Math.max(0, Math.min(5, Math.round(value)))
  return `<span class="stars" aria-label="实力 ${level} / 5">${Array.from({ length: 5 }, (_, index) => `<i class="${index < level ? 'on' : ''}"></i>`).join('')}</span>`
}

function teamRow(team: Pick<AITeam, 'id' | 'name' | 'formationId' | 'tactics' | 'strength' | 'style'> & { players?: AITeam['players'] }): string {
  const players = team.players ?? []
  const best = [...players].sort((a, b) => playerCA(b) - playerCA(a))
  const average = best.length ? best.slice(0, STARTERS).reduce((sum, player) => sum + playerCA(player), 0) / Math.min(STARTERS, best.length) : 0
  return `<tr data-key="${esc(team.id)}">
    <td title="${esc(team.style)}">${clubName(team.id)}</td>
    <td class="dim">${esc(team.formationId)}</td>
    <td class="dim">${esc(tacticText(team.tactics))}</td>
    <td>${strengthStars(team.strength)}</td>
    <td class="num strong">${average ? caHeat(average) : '<span class="muted small">约战后再看</span>'}</td>
    <td class="dim names">${best.slice(0, 3).map((player) => esc(player.name)).join('、')}</td>
    <td class="num"><button class="btn small" data-action="start-world-challenge" data-team="${esc(team.id)}" ${game.activeMatch ? 'disabled' : ''}>约战</button></td>
  </tr>`
}

/** 可以约战的联赛：自己的分区 + 世界里的其他联赛（休整期也一样能踢）。 */
function divisionOptions(): { id: string; label: string }[] {
  if (!game.world) return [{ id: 'own', label: '本联赛' }]
  const zones = game.world.divisions.map((division) => ({
    id: division.divisionId ?? '',
    label: `${division.tier === 'champions' ? '冠军联赛' : division.tier === 'division1' ? '一级联赛' : `二级联赛 · ${conferenceLabel(division.conference)}`}`,
  }))
  return zones.filter((zone) => zone.id)
}

/** 当前选中联赛里的球队；本联赛直接用 game.aiTeams，别的分区用世界名单。 */
function divisionTeams(divisionId: string | null): (Pick<AITeam, 'id' | 'name' | 'formationId' | 'tactics' | 'strength' | 'style'> & { players?: AITeam['players'] })[] {
  if (!game.world || !divisionId || divisionId === game.world.playerDivisionId) {
    return game.aiTeams.map((team) => ({ ...team, id: team.id }))
  }
  const division = game.world.divisions.find((item) => item.divisionId === divisionId)
  const ids = division?.clubIds ?? []
  return ids
    .filter((id) => id !== 'player')
    .map((id) => {
      const club = game.world!.clubs.find((item) => item.id === id) as WorldClub | undefined
      return {
        id,
        name: club?.name ?? id,
        formationId: club?.formationId ?? DEFAULT_FORMATION,
        tactics: club?.tactics ?? { attack: 'balanced', passing: 'mixed', tempo: 'normal', line: 'mid', press: 'mid' },
        strength: club?.strength ?? 2,
        style: club?.style ?? 'balanced',
      }
    })
}

function modeTabs(): string {
  return `<div class="seg challenge-mode-tabs" role="group" aria-label="挑战模式">
    ${(Object.keys(MODE_LABEL) as (keyof typeof MODE_LABEL)[]).map((mode) => `<button class="${ui.challengeMode === mode ? 'active' : ''}" data-challenge-mode="${mode}">${MODE_LABEL[mode]}</button>`).join('')}
  </div>`
}

function renderFriendly(): string {
  const options = divisionOptions()
  const fallbackId = game.world?.playerDivisionId ?? options[0]?.id ?? 'own'
  const activeId = ui.challengeDivision && options.some((option) => option.id === ui.challengeDivision) ? ui.challengeDivision : fallbackId
  const teams = divisionTeams(activeId)
  const online = onlineState.status === 'online'
  const records = game.challengeHistory.filter((record) => !record.mode || record.mode === 'friendly')
  return `
    ${inPostseason(game) ? `<div class="banner info">${icon('clock', 18)}<b>赛后休整</b><span>升级杯正在进行；没有比赛任务的球队可以在这里和世界上任意一支球队踢友谊赛。</span></div>` : ''}
    <div class="toolbar">
      <span class="muted">选择联赛</span>
      <div class="seg" role="group" aria-label="联赛分区">
        ${options.map((option) => `<button class="${activeId === option.id ? 'active' : ''}" data-challenge-div="${esc(option.id)}">${esc(option.label)}</button>`).join('')}
      </div>
      ${online ? '<span class="muted small">联机时对手名单由服务器给出，包含其他教练的球队。</span>' : ''}
    </div>
    <div class="grid challenge-grid">
      ${panel(`可挑战球队 <small>${teams.length}</small>`, teams.length === 0
        ? '<p class="muted pad">这个联赛暂时没有可约的球队。</p>'
        : `<div class="table-scroll"><table class="dt"><thead><tr><th>球队</th><th>阵型</th><th>战术</th><th>实力</th><th class="num">平均 CA</th><th>核心球员</th><th></th></tr></thead><tbody>${teams.map((team) => teamRow(team)).join('')}</tbody></table></div>`, { flush: true })}
      ${panel(`挑战记录 <small>${records.length}</small>`, records.length === 0
        ? '<p class="muted pad">还没有挑战记录。</p>'
        : `<div class="rows">${records.map((record) => `<button class="row-btn result-row" data-action="open-review" data-record="${esc(record.id)}">
            ${resultPill(recordResult(record.result))}
            <span class="result-teams">${esc(record.awayName)} <b>${record.score.home}:${record.score.away}</b>${record.shootout ? ` <small class="muted">点球 ${record.shootout.home}:${record.shootout.away}</small>` : ''}</span>
            ${icon('right', 12)}
          </button>`).join('')}</div>`, { flush: true })}
    </div>
  `
}

const legendSummary = new Map<string, { ca: number; core: string }>()

function legendSummaryOf(id: string): { ca: number; core: string } {
  const hit = legendSummary.get(id)
  if (hit) return hit
  const team = legendTeamById(id)
  if (!team) return { ca: 0, core: '—' }
  const ca = team.players.slice(0, 11).reduce((sum, player) => sum + caOf(player.attrs, player.positions.GK > 0), 0) / 11
  const summary = { ca, core: team.players.slice(0, 3).map((player) => player.name).join('、') }
  legendSummary.set(id, summary)
  return summary
}

function renderLegend(): string {
  const tiers: ('ALL' | 'S+' | 'S' | 'A' | 'B')[] = ['ALL', 'S+', 'S', 'A', 'B']
  const teams = [...LEGEND_TEAMS]
    .filter((def) => ui.legendTier === 'ALL' || def.tier === ui.legendTier)
    .sort((a, b) => (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9) || a.club.localeCompare(b.club) || a.season.localeCompare(b.season))
  const rows = teams.map((def) => {
    const summary = legendSummaryOf(def.id)
    const record = legendRecordOf(game, def.id)
    const recordText = record.played ? `${record.won}胜 ${record.drawn}平 ${record.lost}负` : '—'
    return `<tr data-key="${esc(def.id)}">
      <td>${tag(def.tier, def.tier === 'S+' ? 'gold' : 'info')} <b>${esc(def.club)}</b></td>
      <td class="dim">${esc(def.season)}</td>
      <td class="dim">${esc(def.coach)}</td>
      <td class="num strong">${caHeat(summary.ca)}</td>
      <td class="dim names">${esc(summary.core)}</td>
      <td class="num">${recordText}${record.played ? `<small class="muted"> ${record.goals}:${record.conceded}</small>` : ''}</td>
      <td class="num"><button class="btn small" data-action="start-legend-challenge" data-team="${esc(def.id)}" ${game.activeMatch ? 'disabled' : ''}>开战</button></td>
    </tr>`
  }).join('')
  return `
    <div class="toolbar">
      <span class="muted">强度档</span>
      <div class="seg" role="group" aria-label="传奇队强度档">
        ${tiers.map((tier) => `<button class="${ui.legendTier === tier ? 'active' : ''}" data-legend-tier="${tier}">${tier === 'ALL' ? '全部' : tier}</button>`).join('')}
      </div>
      <span class="muted small">属性固定，不复刻成长；战绩只记这一支球队。</span>
    </div>
    <div class="grid challenge-grid">
      ${panel(`传奇球队 <small>${teams.length}</small>`, teams.length === 0
        ? '<p class="muted pad">这个档位没有球队。</p>'
        : `<div class="table-scroll"><table class="dt"><thead><tr><th>球队</th><th>赛季</th><th>教练</th><th class="num">平均 CA</th><th>核心球员</th><th class="num">战绩</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`, { flush: true })}
      ${panel('传奇规则', `<ul class="rule-list">
        <li>${icon('info', 13)}每队 16 人：11 首发 + 5 替补，阵容和属性按历史赛季固定。</li>
        <li>${icon('training', 13)}属性按 7 项主属性的平均目标展开，强项可到 100，弱项保留 45–75。</li>
        <li>${icon('flag', 13)}单场淘汰赛，平局进点球；固定种子，读档不能刷新射门。</li>
        <li>${icon('coin', 13)}没有联赛收入和球迷变化；只记录传奇挑战战绩。</li>
      </ul>`)}
    </div>
  `
}

function renderPeak(): string {
  const cleared = game.pve?.peak.cleared ?? 0
  const stage = Math.min(PEAK_STAGE_COUNT, cleared + 1)
  const done = cleared >= PEAK_STAGE_COUNT
  const def = done ? null : peakStageDef(stage)
  const history = game.pve?.peak.history ?? []
  const nextReward = done ? 0 : peakStageReward(stage)
  const cells = Array.from({ length: PEAK_STAGE_COUNT }, (_, index) => {
    const number = index + 1
    const classes = ['peak-cell']
    if (number <= cleared) classes.push('done')
    if (!done && number === stage) classes.push('current')
    if (number % 10 === 0) classes.push('boss')
    return `<span class="${classes.join(' ')}" title="第 ${number} 关"></span>`
  }).join('')
  const current = done
    ? `<div class="peak-current done">${icon('flag', 20)}<div><b>100 关全部通关</b><span class="muted">你已经走完巅峰之路。</span></div></div>`
    : `<div class="peak-current">
        <div class="peak-stage-no">第 ${stage} 关</div>
        <div class="peak-stage-main">
          <b>${esc(def!.team.season ? `${def!.team.club} ${def!.team.season}` : def!.team.club)}</b>
          <span class="muted">${def!.kind === 'national' ? '世界杯国家队' : '生成队'} · ${esc(def!.team.formationId)} · ${esc(tacticText(def!.team.tactics))}</span>
          <span class="muted small">核心：${def!.team.players.slice(0, 3).map((player) => esc(player[0])).join('、')}</span>
        </div>
        <div class="peak-stage-ca"><span>目标 CA</span><b>${def!.targetCa}</b><small>实际 ${def!.actualCa.toFixed(0)}</small>${nextReward ? `<small>奖励 +${nextReward.toLocaleString()}</small>` : ''}</div>
        <button class="btn" data-action="start-peak-stage" data-stage="${stage}" ${game.activeMatch ? 'disabled' : ''}>挑战</button>
      </div>`
  return `
    <div class="kpi-row">
      ${`<div class="tile"><span class="tile-label">已通关</span><b class="tile-value">${cleared} / ${PEAK_STAGE_COUNT}</b><span class="tile-sub">${done ? '全部完成' : `下一关：第 ${stage} 关`}</span></div>`}
      ${`<div class="tile"><span class="tile-label">当前阶段</span><b class="tile-value">${done ? '已完成' : def!.kind === 'national' ? '世界杯墙' : stage <= 20 ? '起步' : stage <= 60 ? '中段' : stage <= 80 ? '高强度' : '冲刺'}</b><span class="tile-sub">${stage <= 80 ? '生成队' : '固定国家队'}</span></div>`}
      ${`<div class="tile"><span class="tile-label">目标 CA</span><b class="tile-value">${done ? '—' : def!.targetCa}</b><span class="tile-sub">${done ? '' : `实际 ${def!.actualCa.toFixed(0)}`}</span></div>`}
      ${`<div class="tile"><span class="tile-label">本关奖励</span><b class="tile-value">${nextReward ? nextReward.toLocaleString() : '—'}</b><span class="tile-sub">已领至第 ${game.pve?.peak.rewardClaimed ?? 0} 关</span></div>`}
    </div>
    ${panel('进度', `<div class="peak-track">${cells}</div><div class="peak-legend"><span><i class="done"></i>已通关</span><span><i class="current"></i>当前关</span><span><i class="boss"></i>每 10 关</span></div>`, { flush: true })}
    ${panel('当前对手', current, { flush: true })}
    ${panel('最近闯关', history.length === 0
      ? '<p class="muted pad">还没有闯关记录。</p>'
      : `<div class="rows">${history.slice(0, 8).map((entry) => `<div class="row result-row">
          ${entry.won ? tag('胜', 'good') : tag('负', 'bad')}
          <span class="result-teams">第 ${entry.stage} 关${entry.score ? ` <b>${entry.score.home}:${entry.score.away}</b>` : ''}</span>
          <span class="muted small">${new Date(entry.at).toLocaleDateString('zh-CN')}</span>
        </div>`).join('')}</div>`, { flush: true })}
    <p class="hint pad">规则：只能挑战当前关卡；输了可以重试，赢了推进下一关。对手来自全局冻结表，所有玩家相同。</p>
  `
}

function cupStatus(cupId: CupId): string {
  const run = game.pve?.cups?.[cupId]
  if (!run) return '未报名'
  return run.status === 'active' ? '进行中' : run.status === 'eliminated' ? '已淘汰' : run.status === 'champion' ? '已夺冠' : '已作废'
}

const CUP_STAGE_LABEL: Record<CupRun['stage'], string> = {
  group: '小组赛',
  r16: '16 强',
  qf: '1/4 决赛',
  sf: '半决赛',
  final: '决赛',
  done: '结束',
}

function cupTeamName(run: CupRun, id: string): string {
  return run.participants[id]?.name ?? id
}

function sortCupTable(rows: CupRun['groups'][number]['table']): CupRun['groups'][number]['table'] {
  return [...rows].sort((a, b) => b.points - a.points || b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf || a.teamId.localeCompare(b.teamId))
}

function renderCupRun(run: CupRun): string {
  const next = cupPlayerFixture(run)
  const nextLine = next
    ? `<div class="cup-next">${icon('flag', 14)} 下一场：${esc(cupTeamName(run, next.fixture.homeId))} vs ${esc(cupTeamName(run, next.fixture.awayId))}${next.tie ? `（第 ${next.fixture.round} 回合）` : ''}</div>`
    : `<div class="cup-next muted">${run.status === 'active' ? '等待其他比赛结算' : run.status === 'champion' ? '已夺冠' : '已结束'}</div>`
  if (run.stage === 'group' || (run.status === 'eliminated' && !run.knockout)) {
    const group = run.groups[run.playerGroupIndex]
    const table = group ? sortCupTable(group.table) : []
    return `<div class="cup-run">
      <div class="cup-run-head"><b>${CUP_STAGE_LABEL[run.stage]}</b><span class="muted">第 ${run.groupRound} / 3 轮</span></div>
      ${nextLine}
      ${group ? `<div class="table-scroll"><table class="dt"><thead><tr><th>小组</th><th class="num">场</th><th class="num">胜/平/负</th><th class="num">进:失</th><th class="num">积分</th></tr></thead><tbody>
        ${table.map((row) => `<tr class="${row.teamId === 'player' ? 'strong' : ''}"><td>${row.teamId === 'player' ? tag('你', 'good') : ''} ${esc(cupTeamName(run, row.teamId))}</td><td class="num">${row.played}</td><td class="num">${row.won}/${row.drawn}/${row.lost}</td><td class="num">${row.gf}:${row.ga}</td><td class="num strong">${row.points}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
      ${group ? `<div class="cup-fixtures">${group.fixtures.map((fixture) => `<div class="cup-fixture ${fixture.homeId === 'player' || fixture.awayId === 'player' ? 'mine' : ''}">
        <span>${esc(cupTeamName(run, fixture.homeId))}</span>
        <b>${fixture.score ? `${fixture.score.home}:${fixture.score.away}` : 'vs'}</b>
        <span>${esc(cupTeamName(run, fixture.awayId))}</span>
      </div>`).join('')}</div>` : ''}
    </div>`
  }
  const ties = run.knockout?.ties ?? []
  return `<div class="cup-run">
    <div class="cup-run-head"><b>${CUP_STAGE_LABEL[run.stage]}</b><span class="muted">${run.status === 'champion' ? '冠军' : '淘汰赛'}</span></div>
    ${nextLine}
    <div class="cup-ties">${ties.map((tie) => {
      const mine = tie.legs.some((leg) => leg.homeId === 'player' || leg.awayId === 'player')
      return `<div class="cup-tie ${mine ? 'mine' : ''}">
        <div class="cup-tie-name">${tie.legs.map((leg) => `<span>${esc(cupTeamName(run, leg.homeId))} vs ${esc(cupTeamName(run, leg.awayId))} <b>${leg.score ? `${leg.score.home}:${leg.score.away}` : '未赛'}</b></span>`).join('')}</div>
        ${tie.aggregate ? `<small class="muted">总比分 ${tie.aggregate.home}:${tie.aggregate.away}${tie.shootout ? ` · 点球 ${tie.shootout.home}:${tie.shootout.away}` : ''}</small>` : ''}
        ${tie.winnerId ? `<small class="muted">晋级：${esc(cupTeamName(run, tie.winnerId))}</small>` : ''}
      </div>`
    }).join('')}</div>
  </div>`
}

function renderCupPreview(cupId: CupId): string {
  const def = CUP_DEFS.find((item) => item.id === cupId)!
  const field = buildCupField(cupId, game, game.season.index)
  const groups = buildCupGroups(cupId, field, game.season.index)
  return `<div class="cup-groups">
    ${groups.map((group) => `<div class="cup-group">
      <h3>${String.fromCharCode(65 + group.index)} 组</h3>
      <ul>${group.teams.map((team) => `<li>${team.kind === 'random' ? tag('随机', 'info') : team.kind === 'player' ? tag('你', 'good') : tag('世界')} <span>${esc(team.name)}</span></li>`).join('')}</ul>
    </div>`).join('')}
  </div>
  <p class="hint pad">${esc(def.description)} 报名后会在本周内逐场进行；小组前 2 进入淘汰赛。</p>`
}

function renderCup(): string {
  const previewId = ui.cupPreviewId as CupId | null
  return `
    <div class="cup-cards">
      ${CUP_DEFS.map((def) => {
        const run = game.pve?.cups?.[def.id]
        const next = run?.status === 'active' ? cupPlayerFixture(run) : undefined
        const canEnter = !run || run.status === 'void'
        const primary = run?.status === 'active'
          ? `<button class="btn small" data-action="start-cup-match" data-cup="${def.id}" ${!next || game.activeMatch ? 'disabled' : ''}>${next ? '继续比赛' : '等待结算'}</button>`
          : canEnter
            ? `<button class="btn small" data-action="enter-cup" data-cup="${def.id}" ${game.activeMatch ? 'disabled' : ''}>报名</button>`
            : ''
        return `<section class="panel cup-card">
        <header class="panel-head"><h2>${esc(def.name)}</h2><span class="tag ${run?.status === 'active' ? 'info' : run?.status === 'champion' ? 'gold' : ''}">${cupStatus(def.id)}</span></header>
        <div class="panel-body">
          <p class="muted">${esc(def.description)}</p>
          <div class="tag-row">
            ${tag(`${def.size} 队`)}
            ${tag(`${def.groups} 组`)}
            ${tag(`小组前 ${def.qualifiers}`)}
            ${def.twoLeggedFrom ? tag('8强/半决赛两回合', 'gold') : tag('淘汰赛单场')}
            ${tag(`冠军 ${def.reward.toLocaleString()}`, 'gold')}
          </div>
          <div class="cup-actions">
            ${primary}
            <button class="btn small ghost" data-action="cup-preview" data-cup="${def.id}">${previewId === def.id ? '收起' : run ? '查看赛程' : '查看分组'}</button>
          </div>
          ${previewId === def.id ? (run ? renderCupRun(run) : renderCupPreview(def.id)) : ''}
        </div>
      </section>`
      }).join('')}
    </div>
  `
}

export function renderChallenge(): string {
  const mode = ui.challengeMode
  const body = mode === 'friendly' ? renderFriendly() : mode === 'legend' ? renderLegend() : mode === 'cup' ? renderCup() : renderPeak()
  return `
    ${pageHead({
      kicker: '挑战',
      title: MODE_LABEL[mode],
      sub: MODE_SUB[mode],
    })}
    ${modeTabs()}
    ${body}
  `
}
