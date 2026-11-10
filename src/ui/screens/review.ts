import type { CommentaryEntry, MatchLogEntry, MatchRecord } from '../../game/types.ts'
import { SKILLS } from '../../game/data/skills.ts'
import { displayClock } from '../../game/match/time.ts'
import { shotPositionText } from '../../game/match/shooting.ts'
import { buildReview } from '../../game/review.ts'
import { PLAYER_TEAM_ID } from '../../game/season.ts'
import { clubLook, clubName, compareRow, crest, distinctKit, emptyState, icon, pageHead, panel, recordResult, resultPill } from '../components.ts'
import { skillEffectText } from '../../game/data/skill-effects.ts'
import { clockText, esc, matchModeLabel, pveModeLabel, skillName } from '../format.ts'
import { tipAttrs } from '../tooltip.ts'
import { game, replay, resetReplay, ui } from '../state.ts'
import { renderReplay2D } from '../replay-2d.ts'

export function eventTypeLabel(type: string): string {
  const labels: Record<string, string> = { goal: '进球', shot: '射门', save: '扑救', block: '封堵', foul: '犯规', pass: '传球', dribble: '盘带', tackle: '抢断', contest: '争夺', setpiece: '定位球', penalty: '点球', kickoff: '开球', half: '半场', full: '终场', sub: '换人', injury: '受伤', tactic: '战术', miss: '偏出', info: '信息' }
  return labels[type] ?? type
}

function failureLabel(reason: string): string {
  return { unrecognized: '视野不足 / 没识别线路', misjudged: '选择错误', position_timing: '跑位与时机', execution: '执行失败' }[reason] ?? reason
}

function ratingText(ratings: Record<string, number>): string {
  const labels: Record<string, string> = { a: 'A', d: 'D', c: 'C', p0: 'p0', deviation: '跑位偏差', block: '封堵', onTarget: '射正', goalGiven: '射正后进球', finish: '终结', gk: '门将' }
  return `评分 ${Object.entries(ratings).map(([key, value]) => `${labels[key] ?? key} ${value.toFixed(2)}`).join(' · ')}`
}

function probabilityText(probs: Record<string, number>): string {
  const labels: Record<string, string> = { success: '成功', intercepted: '拦截', out: '出界', loose: '争夺', block: '封堵', off: '偏出', save: '扑救', goal: '进球', tackle: '夺球', foul: '犯规', miss: '罚失', draw: '平' }
  return Object.entries(probs).map(([key, value]) => `${labels[key] ?? key} ${(value * 100).toFixed(0)}%`).join(' / ')
}

export function renderCommentary(entry: CommentaryEntry, durationSeconds = 600): string {
  const shootout = entry.shootoutScore ? ` · 点球 ${entry.shootoutScore.home}:${entry.shootoutScore.away}` : ''
  return `<div class="event-line ${esc(entry.type)}"><span class="clock">${clockText(displayClock(entry.clock, durationSeconds))}</span><span class="type">${esc(eventTypeLabel(entry.type))}</span><p>${esc(entry.text)} <small>${entry.score.home}:${entry.score.away}${shootout}</small></p></div>`
}

export function renderEvent(entry: MatchLogEntry, durationSeconds = 600): string {
  const chance = entry.shotChance ? ` <small class="tag">${esc(entry.shotChance.label)} · 保底 ${(entry.shotChance.floor * 100).toFixed(0)}%</small>` : ['shot', 'goal', 'save', 'block', 'miss'].includes(entry.type) ? ' <small class="tag">旧版未记录机会类型</small>' : ''
  const probs = entry.probabilities ? ` <small>${probabilityText(entry.probabilities)}</small>` : ''
  const ratings = entry.ratings ? ` <small class="ratings">${ratingText(entry.ratings)}</small>` : ''
  const skill = entry.skill ? ` <small class="tag" ${tipAttrs(skillName(entry.skill.id), `${skillEffectText(entry.skill.id)}（银级数值）`)}>${esc(skillName(entry.skill.id))}${entry.skill.condition ? ' 生效' : ' 未满足'}</small>` : ''
  return `<div class="event-line ${esc(entry.type)}"><span class="clock">${clockText(displayClock(entry.clock, durationSeconds))}</span><span class="type">${esc(eventTypeLabel(entry.type))}</span><p>${esc(entry.text)}${chance}${probs}${ratings}${skill}</p></div>`
}

function recordKits(record: MatchRecord): string {
  const home = clubLook(record.homeId).color
  const protectHome = record.homeId === PLAYER_TEAM_ID
  const away = clubLook(record.awayId).color
  const homeKit = protectHome ? home : distinctKit(home, away)
  const awayKit = protectHome ? distinctKit(away, home) : away
  return `--home:${esc(homeKit)};--away:${esc(awayKit)}`
}

function renderReplay(record: MatchRecord): string {
  const duration = record.durationSeconds ?? 600
  const entries = record.commentary
  const count = entries?.length ?? record.keyEvents.length
  const shown = entries?.slice(0, replay.index)
  const last = shown?.at(-1)
  return panel('文字播放器', `
    <div class="replay-score">
      <span class="replay-team">${crest(clubLook(record.homeId), 30)}<b>${esc(record.homeName)}</b></span>
      <b class="replay-digits">${entries ? (last ? `${last.score.home} : ${last.score.away}` : '0 : 0') : '— : —'}</b>
      <span class="replay-team away"><b>${esc(record.awayName)}</b>${crest(clubLook(record.awayId), 30)}</span>
      ${last?.shootoutScore ? `<small class="replay-shootout">点球 ${last.shootoutScore.home} : ${last.shootoutScore.away}</small>` : ''}
    </div>
    <div class="replay-controls">
      <button class="btn primary" data-action="replay-toggle" ${count === 0 || replay.index >= count ? 'disabled' : ''}>${replay.playing ? `${icon('pause', 14)}暂停` : `${icon('play', 14)}开始 / 继续`}</button>
      <button class="btn" data-action="replay-reset">重新播放</button>
      <button class="btn" data-action="replay-speed">${replay.speed}×</button>
      <span class="muted small">${entries ? '按比赛时钟逐条播放；比分随事件更新。' : '旧记录只有关键事件，历史比分不可用。'}</span>
    </div>
    <div class="event-log commentary-log">${entries ? shown!.slice().reverse().map((entry) => renderCommentary(entry, duration)).join('') : record.keyEvents.slice(0, replay.index).reverse().map((entry) => renderEvent(entry, duration)).join('')}${replay.index === 0 ? '<p class="muted pad">点击开始播放。</p>' : ''}</div>
  `, { className: 'replay-panel', aside: `<span class="muted small">${replay.index} / ${count}</span>` })
}

function renderGoals(record: MatchRecord): string {
  const duration = record.durationSeconds ?? 600
  const body = { left: '左脚', right: '右脚', head: '头球' }
  const technique = { power: '力量', placed: '推射', header: '头球' }
  const situation = { open: '运动战', penalty: '点球', free_kick: '任意球' }
  const target = { top_left: '左上', top_center: '中上', top_right: '右上', bottom_left: '左下', bottom_center: '中下', bottom_right: '右下' }
  const rows = record.goalDetails?.map((goal) => `<tr>
      <td class="num">${clockText(displayClock(goal.clock, duration))}</td>
      <td class="dim">${goal.half === 1 ? '上半场' : '下半场'}</td>
      <td><b>${esc(goal.playerName)}</b></td>
      <td class="dim">${goal.side === 'home' ? '主队' : '客队'}</td>
      <td class="dim">${esc(shotPositionText(goal))} (${goal.origin.x.toFixed(1)}, ${goal.origin.y.toFixed(1)}) · ${goal.distance.toFixed(1)} 米</td>
      <td class="dim">${body[goal.bodyPart]}${goal.technique === 'header' ? '' : ` · ${technique[goal.technique]}`} · ${situation[goal.situation]}${goal.chance ? ` · ${esc(goal.chance)}` : ' · 旧版未记录机会'} · 落点 ${target[goal.target]}</td>
    </tr>`).join('')
  return panel('进球详情', rows
    ? `<div class="table-scroll"><table class="dt"><thead><tr><th class="num">时间</th><th>半场</th><th>球员</th><th>球队</th><th>位置 · 距离</th><th>方式</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<p class="muted pad">暂无记录。</p>', { flush: true, aside: '<span class="muted small">落点为进攻视角</span>' })
}

function renderRecord(record: MatchRecord): string {
  if (replay.id !== record.id) resetReplay(record.id)
  const review = buildReview(record)
  const home = record.stats.home
  const away = record.stats.away
  const playerSide = record.awayId === PLAYER_TEAM_ID ? 'away' : 'home'
  const passRate = (stats: typeof home) => (stats.passes > 0 ? Math.round((stats.passesCompleted / stats.passes) * 100) : 0)
  return `
    ${pageHead({
      kicker: `<button class="link" data-action="back-review">${icon('left', 12)} 返回记录</button><span class="kicker-sep">${record.isLeague ? `联赛第 ${record.round} 轮` : pveModeLabel(record.mode, record.stage)} · 种子 ${record.seed}</span>`,
      title: `${esc(record.homeName)} vs ${esc(record.awayName)}`,
    })}
    ${record.aggregateScore ? `<p class="banner info">两回合总比分：${esc(record.homeName)} ${record.aggregateScore.home}:${record.aggregateScore.away} ${esc(record.awayName)}${record.shootout ? ` · 点球 ${record.shootout.home}:${record.shootout.away}` : ''}（不计客场进球）</p>` : ''}
    ${renderReplay2D(record)}
    ${renderReplay(record)}
    <details class="review-details"><summary>${icon('review', 15)}展开完整赛后复盘（含最终结果）</summary>
      <div class="report" style="${recordKits(record)}">
        <section class="report-score">
          ${clubName(record.homeId, 28)}
          <div class="report-digits"><b>${record.score.home} : ${record.score.away}</b>${record.shootout ? `<small>点球 ${record.shootout.home}:${record.shootout.away}</small>` : ''}<span>${resultPill(recordResult(record.result))} ${record.result === 'win' ? '胜利' : record.result === 'loss' ? '失利' : '平局'}</span></div>
          ${clubName(record.awayId, 28)}
        </section>
        ${renderGoals(record)}
        <div class="grid two">
          ${panel('比赛统计', `
            <div class="cmp-head"><span><i class="swatch cmp-swatch-home"></i>${esc(record.homeName)}</span><span>${esc(record.awayName)}<i class="swatch cmp-swatch-away"></i></span></div>
            ${compareRow('控球率', home.possession, away.possession, `${home.possession}%`, `${away.possession}%`)}
            ${compareRow('射门', home.shots, away.shots)}
            ${compareRow('射正', home.shotsOnTarget, away.shotsOnTarget)}
            ${compareRow('进球', home.goals, away.goals)}
            ${compareRow('xG', home.xg, away.xg, home.xg.toFixed(2), away.xg.toFixed(2))}
            ${compareRow('传球成功率', passRate(home), passRate(away), `${home.passesCompleted}/${home.passes}`, `${away.passesCompleted}/${away.passes}`)}
            ${compareRow('拦截', home.interceptions, away.interceptions)}
            ${compareRow('抢断', home.tackles, away.tackles)}
            ${compareRow('犯规', home.fouls, away.fouls)}
            ${compareRow('黄牌', home.yellowCards ?? 0, away.yellowCards ?? 0)}
            ${compareRow('红牌', home.redCards ?? 0, away.redCards ?? 0)}
          `)}
          ${panel('复盘建议', review.map((item) => `<div class="advice ${item.tone}"><b>${esc(item.title)}</b><p>${esc(item.detail)}</p></div>`).join('') || '<p class="muted">没有特别的建议。</p>')}
        </div>
        <div class="grid two">
          ${panel('关键事件', `<div class="event-log">${record.keyEvents.slice().reverse().map((entry) => renderEvent(entry, record.durationSeconds ?? 600)).join('')}</div>`, { flush: true })}
          ${panel('技能 / 失败原因', `
            ${record.skillStats.filter((skill) => skill.conditions > 0).length === 0 ? '<p class="muted">本场没有技能触发。</p>' : `<table class="dt plain"><tbody>${record.skillStats.filter((skill) => skill.conditions > 0).map((skill) => `<tr><td>${esc(skill.name)} · ${esc(SKILLS[skill.skillId].name)} <small class="muted">${skill.side === playerSide ? '你' : '对手'}</small></td><td class="num">条件 ${skill.conditions} / 生效 ${skill.applied}</td></tr>`).join('')}</tbody></table>`}
            <div class="divider"></div>
            ${record.failureStats.map((item) => `<div class="row-line plain"><span>${esc(failureLabel(item.reason))}</span><b>${item.count}</b></div>${item.examples.slice(0, 2).map((example) => `<p class="hint">· ${esc(example)}</p>`).join('')}`).join('')}
          `)}
        </div>
        ${panel('球员数据', `<div class="table-scroll"><table class="dt"><thead><tr><th>球员</th><th>队</th><th class="num">分钟</th><th class="num">传球</th><th class="num">射门</th><th class="num">进球</th><th class="num">抢断</th><th class="num">拦截</th><th class="num">跑动</th><th class="num">体力</th></tr></thead><tbody>
          ${record.playerStats.slice().sort((a, b) => b.goals - a.goals || b.shots - a.shots).slice(0, 16).map((player) => `<tr class="${player.side === playerSide ? 'me' : ''}"><td>${esc(player.name)}</td><td class="dim">${player.side === playerSide ? '你' : '对手'}</td><td class="num">${player.minutes.toFixed(0)}</td><td class="num">${player.passesCompleted}/${player.passes}</td><td class="num">${player.shots}</td><td class="num ${player.goals ? 'strong' : ''}">${player.goals}</td><td class="num">${player.tackles}</td><td class="num">${player.interceptions}</td><td class="num">${player.distance.toFixed(0)}</td><td class="num">${player.staminaLeft}%</td></tr>`).join('')}
        </tbody></table></div>`, { flush: true })}
      </div>
    </details>
  `
}

export function renderReview(): string {
  const records = [...game.matchHistory, ...game.challengeHistory]
  const record = ui.reviewId ? records.find((item) => item.id === ui.reviewId) : null
  if (record) return renderRecord(record)
  return `
    ${pageHead({
      kicker: '复盘',
      title: '比赛记录',
      sub: '概率、技能条件、失败原因与建议都在这里。表现层不改写比赛结果。',
    })}
    ${records.length === 0 ? emptyState('还没有比赛。先去赛季或挑战打一场。') : panel(`全部比赛 <small>${records.length}</small>`, `<div class="table-scroll"><table class="dt records"><thead><tr><th>赛事</th><th class="num">主队</th><th class="center">比分</th><th>客队</th><th>结果</th><th class="num">射门</th><th class="num">xG</th><th class="num">种子</th><th></th></tr></thead><tbody>
      ${records.map((item) => `<tr tabindex="0" class="clickable" data-action="open-review" data-record="${esc(item.id)}" data-key="${esc(item.id)}">
        <td class="dim">${matchModeLabel(item)}</td>
        <td class="num">${clubName(item.homeId)}</td>
        <td class="center score-cell"><b>${item.score.home} : ${item.score.away}</b>${item.shootout ? `<small>点球 ${item.shootout.home}:${item.shootout.away}</small>` : ''}</td>
        <td>${clubName(item.awayId)}</td>
        <td>${resultPill(recordResult(item.result))}</td>
        <td class="num dim">${item.stats.home.shots}-${item.stats.away.shots}</td>
        <td class="num dim">${item.stats.home.xg.toFixed(1)}-${item.stats.away.xg.toFixed(1)}</td>
        <td class="num dim">${item.seed}</td>
        <td class="num"><span class="link">查看 ${icon('right', 12)}</span></td>
      </tr>`).join('')}
    </tbody></table></div>`, { flush: true })}
  `
}
