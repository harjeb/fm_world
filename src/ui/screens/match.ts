import type { Player } from '../../game/types.ts'
import { restoreActiveEngine } from '../../game/actions.ts'
import type { GameEngine } from '../../game/pes/engine.ts'
import { MATCH_MENTALITY_LABELS } from '../../game/match/management.ts'
import { displayClock, MATCH_DISPLAY_SECONDS } from '../../game/match/time.ts'
import type { MatchPlayerState, MatchTeamState } from '../../game/match/types.ts'
import { leagueDisplayClock } from '../../game/realtime.ts'
import { PLAYER_TEAM_ID } from '../../game/season.ts'
import { MAX_SUBS } from '../../game/squad.ts'
import { clubLook, compareRow, crest, distinctKit, emptyState, icon, meter, panel, posBadge, primaryPosition } from '../components.ts'
import { clockText, esc, positionLabel, teamTacticSummary } from '../format.ts'
import { game, ui } from '../state.ts'
import { renderCommentary, renderEvent } from './review.ts'
import { isPesEngine, pesViewEngine } from '../pes-pitch.ts'

/** 比赛双方的队服色：自己用俱乐部主色，对手撞色时换备用色。 */
export function matchKits(engine: GameEngine): { home: string; away: string } {
  const side = game.activeMatch?.context.homeAway ?? 'home'
  const [home, away] = engine.state.teams
  const mine = clubLook(PLAYER_TEAM_ID).color
  return side === 'home'
    ? { home: mine, away: distinctKit(away.color, mine) }
    : { home: distinctKit(home.color, mine), away: mine }
}

function onPitch(team: MatchTeamState): MatchPlayerState[] {
  const seen = new Set<string>()
  return [...team.players, ...team.bench].filter((player) => {
    if (!player.onPitch || seen.has(player.id)) return false
    seen.add(player.id)
    return true
  })
}

function staminaOf(player: MatchPlayerState): number {
  return player.maxStamina > 0 ? (player.stamina / player.maxStamina) * 100 : 0
}

function avgStamina(team: MatchTeamState): number {
  const players = onPitch(team)
  if (players.length === 0) return 0
  return Math.round((players.reduce((sum, player) => sum + staminaOf(player), 0) / players.length) * 10) / 10
}

function playerStatusTable(team: MatchTeamState, title: string, color: string): string {
  const rows = onPitch(team).map((player) => {
    const marks = [
      player.stats.goals ? `<span class="mark goal">${player.stats.goals} 球</span>` : '',
      player.sentOff ? '<span class="mark red">红</span>' : player.yellowCards ? '<span class="mark yellow">黄</span>' : '',
      player.injured ? '<span class="mark injured">伤</span>' : '',
    ].join('')
    return `<tr data-key="${esc(player.id)}"><td>${posBadge(player.position)}</td><td class="name-cell"><span class="name-plain">${esc(player.name)}</span>${marks}</td><td class="meter-cell">${meter(staminaOf(player))}</td></tr>`
  }).join('')
  return `<div class="status-team"><div class="status-head"><i class="swatch" style="background:${esc(color)}"></i><b>${esc(title)}</b><span class="muted small">换人 ${team.subsUsed} / ${MAX_SUBS}</span></div><table class="dt plain status-table"><tbody>${rows}</tbody></table></div>`
}

function coachPanel(engine: GameEngine): string {
  const side = game.activeMatch!.context.homeAway
  const team = engine.getTeam(side)
  const players = team.players.filter((player) => player.onPitch)
  const bench = engine.availableBench(side)
  return panel('教练调整', `<div class="coach-grid">
      <div class="coach-block">
        <h3>战术心态</h3>
        <p class="hint">当前：${team.mentality ? MATCH_MENTALITY_LABELS[team.mentality] : '赛前战术'} · ${esc(teamTacticSummary(team))}</p>
        <div class="form-row"><label for="match-mentality">比赛指令</label><select id="match-mentality" data-keep-value><option value="attack" ${team.mentality === 'attack' ? 'selected' : ''}>全体进攻</option><option value="balanced" ${!team.mentality || team.mentality === 'balanced' ? 'selected' : ''}>均衡</option><option value="defend" ${team.mentality === 'defend' ? 'selected' : ''}>全体防守</option></select></div>
        <button class="btn primary small" data-action="match-tactics-apply">应用战术</button>
      </div>
      <div class="coach-block">
        <h3>换人</h3>
        <div class="form-row"><label for="match-out">换下</label><select id="match-out" data-keep-value>${players.map((player) => `<option value="${esc(player.id)}">${esc(player.name)} · ${positionLabel(player.position)} · 体力 ${Math.round(staminaOf(player))}%${player.injured ? ' · 受伤' : ''}</option>`).join('')}</select></div>
        <div class="form-row"><label for="match-in">换上</label><select id="match-in" data-keep-value>${bench.length === 0 ? '<option value="">没有可用替补</option>' : bench.map((player) => { const pos = primaryPosition({ positions: player.positions } as Player); return `<option value="${esc(player.id)}">${esc(player.name)} · ${positionLabel(pos)} 熟练 ${Math.round(player.positions[pos])}${player.injured ? ' · 受伤' : ''}</option>` }).join('')}</select></div>
        <button class="btn primary small" data-action="match-sub" ${bench.length === 0 ? 'disabled' : ''}>确认换人</button>
        <p class="hint">${game.activeMatch?.context.isLeague ? '联赛继续进行，调整立即生效' : `打开面板不消耗暂停；同一次暂停里第一次调整才用掉 1 次（还剩 ${game.activeMatch?.coachPausesLeft ?? 0} 次）`}；被换下球员不能再次上场。</p>
      </div>
    </div>`, { className: 'coach-panel', aside: `<span class="muted small">换人 ${team.subsUsed} / ${MAX_SUBS} 次（含自动）</span>` })
}

export function renderMatch(): string {
  if (!game.activeMatch) return emptyState('没有进行中的比赛。')
  if (!ui.matchEngine) ui.matchEngine = restoreActiveEngine(game)
  // 新引擎的联赛：比分、数据和文字直播读画面引擎，不会比球场上的动作早到
  const engine = ui.matchEngine ? pesViewEngine(ui.matchEngine) : null
  if (!engine) return emptyState('比赛状态读取失败。')
  const state = engine.state
  const home = state.teams[0]
  const away = state.teams[1]
  const homeStats = state.stats.home
  const awayStats = state.stats.away
  const active = game.activeMatch
  const kits = matchKits(engine)
  const matchClock = active.context.isLeague ? leagueDisplayClock(active) : displayClock(state.clock, state.durationSeconds)
  const mine = active.context.homeAway === 'home' ? home : away
  const theirs = active.context.homeAway === 'home' ? away : home
  const mineKit = active.context.homeAway === 'home' ? kits.home : kits.away
  const theirKit = active.context.homeAway === 'home' ? kits.away : kits.home
  const totalPoss = homeStats.possession + awayStats.possession
  const homePoss = totalPoss > 0 ? (homeStats.possession / totalPoss) * 100 : 50
  return `
    <div class="match-shell" style="--home:${esc(kits.home)};--away:${esc(kits.away)}">
      <div class="scoreboard">
        <div class="score-team home">${crest({ name: home.name, color: kits.home }, 42)}<div class="score-team-text"><b>${esc(home.name)}</b><small>${active.context.homeAway === 'home' ? '你' : '对手'}</small></div></div>
        <div class="score-main">
          <b>${state.score.home} : ${state.score.away}</b>
          ${state.shootout ? `<small>点球 ${state.shootout.home} : ${state.shootout.away}</small>` : ''}
          <span class="score-clock">${state.half === 1 ? '上半场' : '下半场'} · <span ${active.context.isLeague ? 'data-league-clock' : isPesEngine(engine) ? 'data-pes-clock' : ''}>${clockText(matchClock)}</span> / ${clockText(MATCH_DISPLAY_SECONDS)}</span>
        </div>
        <div class="score-team away"><div class="score-team-text"><b>${esc(away.name)}</b><small>${active.context.homeAway === 'away' ? '你 · ' : ''}${active.context.isLeague ? `联赛第 ${active.context.round} 轮` : active.context.mode === 'cup' ? '杯赛' : active.context.mode === 'peak' ? `巅峰之路 · 第 ${active.context.stage} 关` : active.context.mode === 'legend' ? '传奇挑战' : '友谊赛'}</small></div>${crest({ name: away.name, color: kits.away }, 42)}</div>
      </div>
      <div class="match-controls">
        <div class="seg" role="group" aria-label="球场视图"><button class="${ui.pitchView === 'match' ? 'active' : ''}" data-pitch-view="match">比赛</button><button class="${ui.pitchView === 'tracking' ? 'active' : ''}" data-pitch-view="tracking">战术轨迹</button></div>
        ${active.preplayed
          ? '<span class="muted small">联赛直播：阵容已在开赛前 30 分钟锁定，按现实时间回放整场（约 10 分钟），不可暂停、加速或跳过；结束后才公布比分和战报。</span>'
          : active.context.isLeague
          ? `<span class="muted small">联赛按现实时间进行，不可暂停、加速或跳过。</span><button class="btn small ${ui.coachPanel ? 'active' : ''}" data-action="match-coach">${icon('coach', 13)}教练调整</button>`
          : `<span class="muted small steps">${state.step} ${isPesEngine(engine) ? '次判定' : '步'} · 种子 ${active.context.seed}</span>
            <button class="btn ${ui.matchPlaying ? '' : 'primary'}" data-action="match-toggle">${ui.matchPlaying ? `${icon('pause', 14)}暂停` : state.finished ? '已结束' : `${icon('play', 14)}开始 / 继续`}</button>
            <div class="seg" role="group" aria-label="比赛速度"><button class="${ui.matchSpeed === 4000 ? 'active' : ''}" data-speed="4000">慢</button><button class="${ui.matchSpeed === 2700 ? 'active' : ''}" data-speed="2700">正常</button><button class="${ui.matchSpeed === 1350 ? 'active' : ''}" data-speed="1350">快</button></div>
            <button class="btn small" data-action="match-skip">${icon('skip', 13)}跳过到终场</button>
            <button class="btn small ${ui.coachPanel ? 'active' : ''}" data-action="match-coach" ${ui.coachPanel || active.coachPausesLeft > 0 ? '' : 'disabled'}>${icon('coach', 13)}${ui.coachPanel ? '收起调整' : `教练暂停（${active.coachPausesLeft}）`}</button>`}
        ${active.context.isLeague ? `<span class="muted small steps">${state.step} ${isPesEngine(engine) ? '次判定' : '步'} · 种子 ${active.context.seed}</span>` : ''}
      </div>
      ${ui.coachPanel ? coachPanel(engine) : ''}
      <div class="match-grid">
        <div class="match-main">
          <div class="pitch-wrap"><canvas id="pitch" width="1200" height="768"></canvas></div>
          <div class="match-sub-grid">
            ${panel('比赛态势', `
              <div class="cmp-head"><span><i class="swatch cmp-swatch-home"></i>${esc(home.name)}</span><span>${esc(away.name)}<i class="swatch cmp-swatch-away"></i></span></div>
              ${compareRow('控球', homePoss, 100 - homePoss, `${homePoss.toFixed(0)}%`, `${(100 - homePoss).toFixed(0)}%`)}
              ${compareRow('射门', homeStats.shots, awayStats.shots)}
              ${compareRow('射正', homeStats.shotsOnTarget, awayStats.shotsOnTarget)}
              ${compareRow('xG', homeStats.xg, awayStats.xg, homeStats.xg.toFixed(2), awayStats.xg.toFixed(2))}
              ${compareRow('传球', homeStats.passesCompleted, awayStats.passesCompleted, `${homeStats.passesCompleted}/${homeStats.passes}`, `${awayStats.passesCompleted}/${awayStats.passes}`)}
              ${compareRow('平均体力', avgStamina(home), avgStamina(away), `${avgStamina(home)}%`, `${avgStamina(away)}%`)}
            `)}
            ${panel('场上球员', `<div class="status-grid">${playerStatusTable(mine, mine.name, mineKit)}${playerStatusTable(theirs, theirs.name, theirKit)}</div>`)}
          </div>
        </div>
        ${panel('文字直播', `<div class="event-log live commentary-log">${state.commentary ? state.commentary.slice().reverse().map((entry) => renderCommentary(entry, state.durationSeconds)).join('') : state.log.slice().reverse().map((entry) => renderEvent(entry, state.durationSeconds)).join('')}</div>`, { flush: true, className: 'live-panel', aside: `<span class="muted small">${state.commentary ? '全部已发生事件' : '旧存档 · 仅日志'}</span>` })}
      </div>
    </div>
  `
}
