import type { Player, Position, SkillId, TrainingLogEntry, TrainingSession } from '../../game/types.ts'
import { eventById, ROUTE_LABELS } from '../../game/data/events.ts'
import { POSITION_LABELS } from '../../game/data/attributes.ts'
import { inheritanceChances, validateInheritance } from '../../game/inheritance.ts'
import { autoTrainingConfig, previewTraining } from '../../game/actions.ts'
import { displayCA, initialDisplayCA, mainAttrsFor } from '../../game/rating.ts'
import { branchProbability, eventChance, eventGrowthScale, planTraining, trainingActionsTotal, TRAINING_ACTION_INFO, TRAINING_ENERGY_COST, weekOfAction, type TrainingRequest } from '../../game/training.ts'
import { trainingDate, trainingOptions, type TrainingActivityId } from '../../game/training-calendar.ts'
import { baseBuild, playerCards } from '../../game/cards.ts'
import { skillEffectText } from '../../game/data/skill-effects.ts'
import { getSkillTier } from '../../game/inheritance.ts'
import { attributeRadar, attrHeat, caHeat, cardName, cardSelect, icon, mainAttrs, meter, pageHead, panel, posBadge, primaryPosition, skillGroups, skillTierLabel, tag, tile, traitLabel } from '../components.ts'
import { attrLabel, attrValue, caDelta, displayEventHint, esc, gainText, pct, playerCA, positionLabel, skillName, trainingLogText } from '../format.ts'
import { game, ui } from '../state.ts'

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

export function eligibleTrainingTeammates(session: TrainingSession): Player[] {
  return game.roster.filter((player) => {
    const other = game.training[player.id]
    return player.id !== session.playerId && !!other && !other.completed && !game.candidates[player.id] && !other.pendingEventId && other.action === session.action && other.scheduleVersion === session.scheduleVersion && (session.scheduleVersion !== 1 || other.scheduleSeed === session.scheduleSeed) && other.action < trainingActionsTotal(other)
  })
}

export function buildTrainingRequest(): TrainingRequest {
  const session = ui.trainingPlayerId ? game.training[ui.trainingPlayerId] : undefined
  const eligible = session ? new Set(eligibleTrainingTeammates(session).map((player) => player.id)) : new Set<string>()
  ui.trainingTeammateIds = ui.trainingTeammateIds.filter((id) => eligible.has(id))
  const teammateIds = ui.trainingTeammateIds
  if (session?.scheduleVersion === 1) {
    const options = trainingOptions(session)
    const activity = options.find((option) => option.id === ui.trainingActivity) ?? options[0]
    if (activity) {
      ui.trainingActivity = activity.id as TrainingActivityId
      return { kind: 'activity', activityId: ui.trainingActivity, ...(activity.group ? { teammateIds } : {}), ...(activity.parameters === 'position' ? { position: ui.trainingPosition } : {}), ...(activity.parameters === 'inherit' ? { mentorId: ui.trainingMentorId, skill: ui.trainingSkill ?? 'injury_prevention' } : {}) }
    }
  }
  if (ui.trainingKind === 'drill') return { kind: 'drill', attr: ui.trainingAttr, teammateIds }
  if (ui.trainingKind === 'combo') return { kind: 'combo', focus: ui.trainingCombo, teammateIds }
  if (ui.trainingKind === 'match') return { kind: 'match', teammateIds }
  if (ui.trainingKind === 'position') return { kind: 'position', position: ui.trainingPosition }
  if (ui.trainingKind === 'rest') return { kind: 'rest' }
  if (ui.trainingKind === 'protection') return { kind: 'protection', focus: ui.trainingProtection }
  if (ui.trainingKind === 'inherit') return { kind: 'inherit', mentorId: ui.trainingMentorId, skill: ui.trainingSkill ?? 'injury_prevention' }
  return { kind: 'mentor' }
}

function playerSelect(): string {
  return `<label class="field-inline training-select"><span>选择球员</span>
    <select id="training-player-select">
      <option value="">— 选择 —</option>
      ${game.roster.map((player) => `<option value="${esc(player.id)}" ${ui.trainingPlayerId === player.id ? 'selected' : ''}>${esc(player.name)} · ${POSITION_LABELS[primaryPosition(player)]} · CA ${playerCA(player).toFixed(1)}</option>`).join('')}
    </select>
  </label>`
}

function sessionStrip(): string {
  const sessions = Object.values(game.training)
  if (sessions.length === 0) return ''
  return `<div class="session-strip">${sessions.map((session) => {
    const player = game.roster.find((item) => item.id === session.playerId)
    if (!player) return ''
    const total = trainingActionsTotal(session)
    return `<button class="session-chip ${ui.trainingPlayerId === player.id ? 'active' : ''} ${session.pendingEventId ? 'attention' : ''}" data-action="open-training" data-player="${esc(player.id)}">
      <b>${esc(player.name)}</b><small>${session.action}/${total}${session.pendingEventId ? ' · 待处理事件' : session.completed ? ' · 已完成 ✓' : ''}</small>
      <span class="progress-mini"><i style="width:${((session.action / total) * 100).toFixed(1)}%"></i></span>
    </button>`
  }).join('')}</div>`
}

function overviewTable(): string {
  const rows = [...game.roster].sort((a, b) => playerCA(b) - playerCA(a)).map((player) => {
    const session = game.training[player.id]
    const candidate = game.candidates[player.id]
    const state = candidate || session?.completed
      ? tag('新卡', 'good')
      : session
        ? tag(session.pendingEventId ? '待处理事件' : `培养中 ${session.action}/${trainingActionsTotal(session)}`, session.pendingEventId ? 'gold' : 'info')
        : '<span class="muted small">空闲</span>'
    const energy = player.energy ?? 100
    return `<tr tabindex="0" class="clickable" data-action="open-training" data-player="${esc(player.id)}" data-key="${esc(player.id)}">
      <td>${posBadge(primaryPosition(player))}</td>
      <td class="name-cell"><span class="name-plain">${esc(player.name)}</span><small>${esc(player.enName)}</small></td>
      <td class="num">${player.age ?? 24}</td>
      <td class="t-card">${playerCards(game, player.id).length ? cardSelect(player) : '<span class="muted small">原始</span>'}</td>
      <td class="num strong">${caHeat(playerCA(player))}</td>
      <td class="num dim">${initialDisplayCA(player).toFixed(0)}</td>
      <td class="meter-cell">${meter(energy, 100, { good: TRAINING_ENERGY_COST + 20, warn: TRAINING_ENERGY_COST })}</td>
      <td>${state}</td>
    </tr>`
  }).join('')
  return panel('全队培养状态', `<div class="table-scroll"><table class="dt"><thead><tr><th>位置</th><th>球员</th><th class="num">龄</th><th>当前卡</th><th class="num">当前 CA</th><th class="num">原始 CA</th><th>精力</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table></div>`, { flush: true, aside: `<span class="muted small">开始一轮消耗 ${TRAINING_ENERGY_COST} 精力，比赛日恢复</span>` })
}

export function renderTraining(): string {
  const selected = ui.trainingPlayerId ? game.roster.find((player) => player.id === ui.trainingPlayerId) : null
  return `
    ${pageHead({
      kicker: '培养',
      title: '培养角色卡',
      sub: '每天上午、下午各练一次，一共 15 天；每周一上午交流赛，周五上午队内比赛、下午休息。每轮结束产出一张球员卡进入库存，原来的卡不会消失。',
      actions: playerSelect(),
    })}
    ${sessionStrip()}
    ${selected ? renderTrainingPlayer(selected) : overviewTable()}
    ${autoTrainingPanel(selected)}
  `
}

/** 自动培养设置面板：模式、属性优先级、最低目标和自动执行按钮。*/
function autoTrainingPanel(player: Player | null | undefined): string {
  // 界面不保存草稿：每次改动都由 app.ts 直接写回 game.trainingAuto 并存档。
  const config = autoTrainingConfig(game, player?.id)
  const mains = mainAttrsFor(player ? player.positions.GK > 0 : false)
  const session = player ? game.training[player.id] : undefined
  const state = !player
    ? '<span class="muted small">先选择球员</span>'
    : session?.completed || game.candidates[player.id]
      ? tag('本轮已完成', 'good')
      : session
        ? tag(`培养中 ${session.action}/${trainingActionsTotal(session)}`, 'info')
        : '<span class="muted small">空闲</span>'
  const priority = config.priority.filter((key) => mains.includes(key))
  const priorityRows = priority.map((key, index) => `<div class="row-line" style="gap:8px">
      <span style="flex:1">${index + 1}. ${attrLabel(key)} <span class="muted small">${Math.round(session?.candidate.attrs[key] ?? player?.attrs[key] ?? 0)}</span></span>
      <button class="btn ghost" data-action="training-auto-priority" data-attr="${key}" data-dir="up" ${index === 0 ? 'disabled' : ''}>↑</button>
      <button class="btn ghost" data-action="training-auto-priority" data-attr="${key}" data-dir="down" ${index === priority.length - 1 ? 'disabled' : ''}>↓</button>
    </div>`).join('')
  const targetRows = mains.map((key) => `<div class="form-row"><label for="training-auto-target-${key}">${attrLabel(key)}</label>
      <input id="training-auto-target-${key}" data-auto-target="${key}" type="number" min="0" max="1500" step="50" value="${config.targets[key] ?? 0}" style="max-width:140px">
    </div>`).join('')
  return panel('自动培养', `
    <div class="btn-row" style="margin-top:0">
      <div class="seg"><button class="${config.mode === 'priority' ? 'active' : ''}" data-action="training-auto-mode" data-mode="priority">属性优先</button><button class="${config.mode === 'targets' ? 'active' : ''}" data-action="training-auto-mode" data-mode="targets">最低目标</button></div>
      ${state}
    </div>
    <p class="hint">属性优先：按下面的顺序练，顶到个人上限就换下一个。最低目标：先把低于目标的主属性补到目标，差距最大的先练；全部达标后休息或安排位置/传承。自动培养只在当天日历提供的项目里选择。${config.enabled ? '' : ' 当前设置为停用，自动按钮仍可手动使用。'}</p>
    <div class="grid two">
      <div>
        <div class="field-title">属性优先级</div>
        <div class="rows">${priorityRows}</div>
      </div>
      <div>
        <div class="field-title">最低目标（0–1500）</div>
        ${targetRows}
        <button class="btn" data-action="training-auto-save">保存目标值</button>
      </div>
    </div>
    <div class="btn-row">
      <button class="btn primary" data-action="training-auto-step" data-player="${player ? esc(player.id) : ''}" ${player ? '' : 'disabled'}>${icon('play', 14)}自动进行一步</button>
      <button class="btn" data-action="training-auto-run" data-player="${player ? esc(player.id) : ''}" ${player ? '' : 'disabled'}>自动跑完本轮培养</button>
    </div>
    <p class="hint">遇到事件会按目标属性收益自动选择选项；精力不足时给出提示，不会自动开始新一轮培养。</p>
  `, { aside: '<span class="muted small">设置保存在存档里</span>' })
}

function attrCompareTable(current: Player, candidate: Player): string {
  const gk = current.positions.GK > 0
  const rows = mainAttrsFor(gk).map((key) => {
    const delta = candidate.attrs[key] - current.attrs[key]
    return `<tr><td class="dim">${attrLabel(key)}</td><td class="num">${attrHeat(current.attrs[key])}</td><td class="num">${attrHeat(candidate.attrs[key])}</td><td class="num ${delta > 0 ? 'up' : delta < 0 ? 'down' : 'dim'}">${delta > 0 ? '+' : ''}${delta.toFixed(1)}</td></tr>`
  }).join('')
  return `<table class="dt"><thead><tr><th>属性</th><th class="num">当前</th><th class="num">新卡</th><th class="num">变化</th></tr></thead><tbody>${rows}</tbody></table>`
}

function renderTrainingStart(player: Player): string {
  const energy = player.energy ?? 100
  const enough = energy >= TRAINING_ENERGY_COST
  const base = { ...baseBuild(player) }
  return `<div class="grid two">
    ${panel(esc(player.name), `
      <div class="tile-grid">
        ${tile('当前 CA', playerCA(player).toFixed(1), `原始 ${initialDisplayCA(player).toFixed(1)}`)}
        ${tile('精力', String(Math.round(energy)), `开始消耗 ${TRAINING_ENERGY_COST}`)}
      </div>
      <p class="hint">每轮都从原始属性开始，结束后产出一张新卡进入库存，和之前的卡互不影响。培养不消耗金币；开始一轮消耗 <b>${TRAINING_ENERGY_COST}</b> 点精力，比赛日推进时恢复。设施提供额外成长（按阶段概率触发，每个等级第 5 阶段必定触发），主属性最高 1500；设施阶段在开始时锁定，升级从下一次培养生效。</p>
      <button class="btn primary" data-action="start-training" data-player="${esc(player.id)}" ${enough ? '' : 'disabled'}>${enough ? `${icon('play', 14)}开始培养` : '精力不足，等待恢复'}</button>
    `, { className: 'training-start', aside: posBadge(primaryPosition(player)) })}
    ${panel('培养起点：原始属性', `<div class="radar-pair">${attributeRadar(base)}<div>${attrList(base)}</div></div>`)}
  </div>`
}

function attrList(player: Pick<Player, 'attrs' | 'positions'>): string {
  return `<table class="dt plain"><tbody>${mainAttrs(player).map((key) => `<tr><td class="dim">${attrLabel(key)}</td><td class="num">${attrHeat(player.attrs[key])}</td></tr>`).join('')}</tbody></table>`
}

function renderTrainingPlayer(player: Player): string {
  const session = game.training[player.id]
  const candidate = game.candidates[player.id]
  if (!session && !candidate) return renderTrainingStart(player)
  const currentSession = session!
  const cand = candidate ?? currentSession.candidate
  const pendingEvent = currentSession.pendingEventId ? eventById(currentSession.pendingEventId) : null
  const showAction = !pendingEvent && !currentSession.completed && !candidate
  return `
    ${trainingHeader(player, currentSession, cand)}
    ${currentSession.scheduleVersion === 1 ? trainingCalendar(currentSession) : ''}
    ${pendingEvent ? eventPanel(currentSession, pendingEvent) : ''}
    ${currentSession.completed || candidate ? candidatePanel(player, cand, currentSession) : ''}
    <div class="train-grid">
      <div class="train-main">
        ${showAction ? (currentSession.scheduleVersion === 1 ? calendarActionPanel(currentSession) : legacyActionPanel(currentSession)) : ''}
        ${panel(`行动日志 <small>${currentSession.log.length}</small>`, logList(currentSession, player), { flush: true })}
      </div>
      <div class="train-side">
        ${panel('当前与培养中', `
          <div class="radar-block">${attributeRadar(cand, player)}
            <div class="legend radar-legend"><span class="legend-item"><i class="swatch radar-swatch-base"></i>当前</span><span class="legend-item"><i class="swatch radar-swatch-top"></i>培养中</span></div>
          </div>
          ${currentSession.completed || candidate ? '' : `${attrCompareTable(player, cand)}<div class="side-skills">${skillGroups(cand)}</div>`}
        `, { aside: `<span class="muted small">CA ${playerCA(player).toFixed(1)} → ${playerCA(cand).toFixed(1)}</span>` })}
        ${currentSession.scheduleVersion === 1 && currentSession.exchangeMatches?.length ? panel('交流赛记录', `<div class="rows">${currentSession.exchangeMatches.map((match) => `<div class="row-line"><span>第 ${match.week} 周 · ${esc(match.opponentName)}</span><b>${match.homeScore}:${match.awayScore}</b><span class="form f-${match.result === 'win' ? 'W' : match.result === 'loss' ? 'L' : 'D'}">${{ win: '胜', draw: '平', loss: '负' }[match.result]}</span></div>`).join('')}</div>`, { flush: true }) : ''}
        ${panel('培养规则', `<p class="hint">设施加成按本轮开始时的阶段快照计算；每个等级的第 5 阶段必定触发，等级内其余阶段概率从该等级下限线性上升；升级从下一次培养生效；已有快照的课程下一行动使用新规则，旧培养若无设施快照则没有建筑加成。每项主属性有各自上限，练到该属性的上限即停。CA 是综合能力参考值（0–1500），不是培养上限；比赛使用各项属性。</p>`)}
      </div>
    </div>
  `
}

function trainingHeader(current: Player, session: TrainingSession, cand: Player): string {
  const fatigue = Math.round(session.fatigue)
  const stamina = 100 - fatigue
  const total = trainingActionsTotal(session)
  const route = session.routeId ? `${ROUTE_LABELS[session.routeId]} · ${session.routePoints}/2` : '未选择路线'
  const eventP = eventChance(session, session.action + 1)
  const when = session.scheduleVersion === 1
    ? (() => { const date = trainingDate(Math.min(total, session.action + 1)); return `第 ${date.week} 周 · ${date.dayLabel} ${date.slot}` })()
    : `第 ${weekOfAction(Math.max(1, session.action))} 周`
  return `<section class="train-head">
    <div class="train-id">
      ${posBadge(primaryPosition(current))}
      <div>
        <h2>${esc(current.name)} <small>${esc(current.enName)}</small></h2>
        <p class="muted small">${when} · 行动 ${session.action}/${total} · ${traitLabel(current.traitId)} · ${esc(route)}</p>
      </div>
    </div>
    <div class="train-stats">
      <div class="stat-box"><span>当前 CA</span><b>${playerCA(current).toFixed(1)}</b></div>
      <div class="stat-box"><span>培养中 CA</span><b>${playerCA(cand).toFixed(1)}</b><small class="${playerCA(cand) >= playerCA(current) ? 'up' : 'down'}">${caDelta(current, cand)}</small></div>
      <div class="stat-box"><span>训练体力</span>${meter(stamina)}</div>
      <div class="stat-box"><span>剩余精力</span>${meter(current.energy ?? 100)}</div>
      <div class="stat-box"><span>下次事件</span><b>${session.action >= total ? '—' : pct(eventP)}</b></div>
    </div>
    <div class="train-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${session.action}"><i style="width:${((session.action / total) * 100).toFixed(1)}%"></i></div>
  </section>`
}

/** 15 天日历：一周 7 列，每天上午/下午两格；已完成格显示实际项目与品质。 */
function trainingCalendar(session: TrainingSession): string {
  const total = trainingActionsTotal(session)
  const actionLog = new Map<number, TrainingLogEntry>()
  const eventActions = new Set<number>()
  for (const entry of session.log) {
    if (entry.kind === 'action') actionLog.set(entry.action, entry)
    if (entry.kind === 'event') eventActions.add(entry.action)
  }
  const weeks = Math.ceil(total / 14)
  const fixedLabel = (day: number, slot: number) => (day === 1 && slot === 0 ? '交流赛' : day === 5 ? (slot === 0 ? '队内比赛' : '休整') : '')
  const cell = (action: number, day: number, slot: number) => {
    if (action > total) return '<div class="cal-slot none"></div>'
    const entry = actionLog.get(action)
    const done = action <= session.action
    const current = !session.completed && action === session.action + 1
    const match = entry ? /^(.+?)（(.+)）$/.exec(entry.title) : null
    const label = entry ? match?.[1] ?? entry.title : fixedLabel(day, slot)
    const quality = match?.[2] ?? ''
    const qualityClass = quality === '完美成功' ? 'q-perfect' : quality === '大成功' ? 'q-great' : quality === '一般' ? 'q-plain' : ''
    return `<div class="cal-slot ${done ? 'done' : ''} ${current ? 'current' : ''} ${qualityClass}" title="${esc(entry ? entry.title : current ? '当前时段' : label)}">
      <span>${esc(label) || (current ? '当前' : '')}</span>${eventActions.has(action) ? '<i class="cal-event" title="触发事件"></i>' : ''}
    </div>`
  }
  const rows: string[] = []
  for (let week = 1; week <= weeks; week++) {
    const start = (week - 1) * 14
    if (start >= total) break
    rows.push(`<div class="cal-week"><span class="cal-week-label">第 ${week} 周</span>${DAY_LABELS.map((_, dayIndex) => {
      const am = start + dayIndex * 2 + 1
      if (am > total) return '<div class="cal-day none"></div>'
      return `<div class="cal-day">${cell(am, dayIndex + 1, 0)}${cell(am + 1, dayIndex + 1, 1)}</div>`
    }).join('')}</div>`)
  }
  return panel('培养日历', `<div class="calendar">
      <div class="cal-week cal-head"><span class="cal-week-label"></span>${DAY_LABELS.map((label) => `<span>${label}</span>`).join('')}</div>
      ${rows.join('')}
    </div>
    <div class="legend cal-legend">
      <span class="legend-item"><i class="swatch cal-swatch-done"></i>已完成</span>
      <span class="legend-item"><i class="swatch cal-swatch-great"></i>大成功</span>
      <span class="legend-item"><i class="swatch cal-swatch-perfect"></i>完美成功</span>
      <span class="legend-item"><i class="swatch cal-swatch-current"></i>当前时段</span>
      <span class="legend-item"><i class="cal-event static"></i>触发事件</span>
    </div>`, { aside: '<span class="muted small">每格上为上午、下为下午</span>' })
}

function logList(session: TrainingSession, player: Player): string {
  const gk = player.positions.GK > 0
  return `<div class="log">${session.log.slice(-24).reverse().map((entry) => `
    <div class="log-row log-${entry.kind}">
      <div class="log-head"><b>${esc(entry.title)}</b><span class="muted small">行动 ${entry.action} · 第 ${entry.week} 周${entry.fatigue ? ` · 训练体力 ${entry.fatigue > 0 ? '-' : '+'}${Math.abs(entry.fatigue)}` : ''}</span></div>
      <p>${esc(trainingLogText(entry, gk))}</p>
      ${entry.gains ? `<div class="gains">${gainText(entry.gains, gk)}</div>` : ''}
    </div>`).join('')}</div>`
}

function previewBox(session: TrainingSession, plan: ReturnType<typeof planTraining>, isGk: boolean): string {
  return `<div class="preview">
    <div class="preview-grid">
      <div class="preview-cell wide"><span>属性成长</span><b class="${gainText(plan.gains, isGk) ? 'up' : ''}">${gainText(plan.gains, isGk) || '—'}</b></div>
      <div class="preview-cell"><span>CA</span><b>${displayCA(plan.caBefore).toFixed(1)} → ${displayCA(plan.caAfter).toFixed(1)}</b></div>
      <div class="preview-cell training-stamina-preview"><span>训练体力</span><b>${100 - session.fatigue} → ${100 - Math.max(0, Math.min(100, session.fatigue + plan.fatigue))}</b></div>
      ${plan.quality ? `<div class="preview-cell training-quality"><span>品质</span><b>${esc(plan.quality.label)} ×${plan.quality.multiplier}</b></div>` : ''}
    </div>
    ${plan.note ? `<p class="hint">${esc(plan.note)}</p>` : ''}
  </div>`
}

function teammatePicker(teammates: Player[]): string {
  return `<div class="training-teammates"><span class="field-title">共同训练队友</span>
    <div class="check-grid">${teammates.map((mate) => `<label class="check-field"><input type="checkbox" data-training-teammate="${esc(mate.id)}" value="${esc(mate.id)}" ${ui.trainingTeammateIds.includes(mate.id) ? 'checked' : ''}><span>${esc(mate.name)} · 体力 ${Math.round(100 - game.training[mate.id].fatigue)}</span></label>`).join('') || '<span class="muted small">暂无可选队友。</span>'}</div>
    <p class="hint">可选择同进度且无待处理事件的培养队友；每名其他队友使正成长主属性额外 +2，隐藏属性按比例缩放，设施加成另计。各自消耗训练体力、独立触发事件。</p>
  </div>`
}

function positionField(session: TrainingSession, isGk: boolean): string {
  return `<div class="form-row"><label for="training-position">位置</label><select id="training-position">${(isGk ? ['GK'] : ['CB', 'W', 'CM', 'ST']).map((pos) => `<option value="${pos}" ${ui.trainingPosition === pos ? 'selected' : ''}>${positionLabel(pos as Position)} · 当前 ${Math.round(session.candidate.positions[pos as Position])}</option>`).join('')}</select></div>`
}

function inheritFields(session: TrainingSession, mentors: Player[], mentor: Player | undefined): string {
  if (!mentor || !ui.trainingSkill) return '<p class="muted">阵容中没有拥有技能的可用导师。</p>'
  const chances = inheritanceChances(session, mentor, ui.trainingSkill)
  const error = validateInheritance(session, mentor, ui.trainingSkill)
  return `<div class="form-row"><label for="training-mentor">导师</label><select id="training-mentor">${mentors.map((item) => `<option value="${esc(item.id)}" ${mentor.id === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></div>
    <div class="form-row"><label for="training-skill">技能</label><select id="training-skill">${mentor.skills.map((skill) => `<option value="${esc(skill)}" ${ui.trainingSkill === skill ? 'selected' : ''}>${esc(skillName(skill))} · ${skillTierLabel(mentor, skill)}</option>`).join('')}</select></div>
    <p class="small dim">${esc(skillEffectText(ui.trainingSkill, getSkillTier(mentor, ui.trainingSkill)))}</p>
    <p class="small">导师技能：${skillTierLabel(mentor, ui.trainingSkill)} · 成功率 ${pct(chances.success)}；成功后：银 ${pct(1 - chances.gold - chances.rainbow)} / 金 ${pct(chances.gold)} / 彩 ${pct(chances.rainbow)}</p>
    <p class="small ${error ? 'warn-text' : 'muted'}">${error ? esc(error) : '符合传承条件'}</p>`
}

function resolveMentor(session: TrainingSession): { mentors: Player[]; mentor: Player | undefined } {
  const mentors = game.roster.filter((player) => player.id !== session.playerId && player.skills.length > 0)
  const mentor = mentors.find((player) => player.id === ui.trainingMentorId) ?? mentors[0]
  ui.trainingMentorId = mentor?.id ?? ''
  if (!mentor?.skills.includes(ui.trainingSkill as SkillId)) ui.trainingSkill = mentor?.skills[0] ?? null
  return { mentors, mentor }
}

function calendarActionPanel(session: TrainingSession): string {
  const options = trainingOptions(session)
  const selected = options.find((item) => item.id === ui.trainingActivity) ?? options[0]
  if (!selected) return panel('本次行动', '<p class="muted">当前没有可用行动。</p>')
  ui.trainingActivity = selected.id as TrainingActivityId
  const isGk = session.candidate.positions.GK > 0
  if (selected.parameters === 'position') {
    if (isGk) ui.trainingPosition = 'GK'
    else if (ui.trainingPosition === 'GK') ui.trainingPosition = 'CM'
  }
  const { mentors, mentor } = resolveMentor(session)
  const request = buildTrainingRequest()
  const preview = previewTraining(game, session.playerId, request)
  const plan = preview.plan
  const date = trainingDate(session.action + 1)
  const lowMood = date.day <= 3 && (session.lowMoodWeeks ?? []).includes(date.week)
  const teammates = eligibleTrainingTeammates(session)
  return panel(`第 ${date.week} 周 · ${date.dayLabel} ${date.slot}`, `<div class="action-layout">
      <div class="activity-list" role="group" aria-label="训练项目">
        ${options.map((item) => `<button class="activity ${item.id === selected.id ? 'active' : ''}" data-training-activity="${esc(item.id)}"><b>${esc(item.label)}</b><small class="${item.stamina.startsWith('+') ? 'up' : 'muted'}">${esc(item.stamina)}</small></button>`).join('')}
      </div>
      <div class="action-detail">
        ${lowMood ? '<p class="warn-text small">低落情绪：本周一至周三成长 -50%。</p>' : ''}
        <p class="action-desc">${esc(selected.desc)}</p>
        ${selected.parameters === 'position' ? positionField(session, isGk) : ''}
        ${selected.parameters === 'inherit' ? inheritFields(session, mentors, mentor) : ''}
        ${selected.group ? teammatePicker(teammates) : ''}
        ${plan ? previewBox(session, plan as ReturnType<typeof planTraining>, isGk) : ''}
        ${preview.error ? `<p class="warn-text training-error small" role="alert">${esc(preview.error)}</p>` : ''}
        <button class="btn primary wide" data-action="training-execute" ${preview.error || !plan ? 'disabled' : ''}>${preview.error || !plan ? '无法执行' : `${icon('play', 14)}执行行动`}</button>
        <p class="hint">属性课程品质：一般 50% ×0.7 / 成功 30% ×1 / 大成功 15% ×1.3 / 完美成功 5% ×1.6；品质在同一行动固定，不因切换项目重抽。</p>
      </div>
    </div>`, { aside: `<span class="muted small">行动 ${session.action + 1}/${trainingActionsTotal(session)}</span>`, className: 'action-panel' })
}

function legacyActionPanel(session: TrainingSession): string {
  const isGk = session.candidate.positions.GK > 0
  if (ui.trainingKind === 'drill' && !mainAttrsFor(isGk).includes(ui.trainingAttr)) ui.trainingAttr = 'passing'
  const { mentors, mentor } = resolveMentor(session)
  if (ui.trainingKind === 'position') {
    if (isGk) ui.trainingPosition = 'GK'
    else if (ui.trainingPosition === 'GK') ui.trainingPosition = 'CM'
  }
  const request = buildTrainingRequest()
  const preview = previewTraining(game, session.playerId, request)
  const plan = preview.plan ?? planTraining(session, request, mentor)
  const error = preview.error
  const teammates = eligibleTrainingTeammates(session)
  const groupAction = ui.trainingKind === 'drill' || ui.trainingKind === 'combo' || ui.trainingKind === 'match'
  const staminaText = (id: string) => (id === 'rest' ? '+30' : id === 'mentor' ? '+5' : `-${id === 'drill' ? 12 : id === 'combo' ? 16 : id === 'match' ? 25 : 8}`)
  return panel('本次行动', `<div class="action-layout">
      <div class="activity-list" role="group" aria-label="训练项目">
        ${TRAINING_ACTION_INFO.map((item) => `<button class="activity ${ui.trainingKind === item.id ? 'active' : ''}" data-training-kind="${item.id}"><b>${item.label}</b><small class="${staminaText(item.id).startsWith('+') ? 'up' : 'muted'}">${staminaText(item.id)}</small></button>`).join('')}
      </div>
      <div class="action-detail">
        <p class="action-desc">${esc(TRAINING_ACTION_INFO.find((item) => item.id === ui.trainingKind)?.desc ?? '')}</p>
        ${ui.trainingKind === 'drill' ? `<div class="attr-picker">${mainAttrsFor(isGk).map((key) => `<button class="attr-chip ${ui.trainingAttr === key ? 'active' : ''}" data-training-attr="${key}"><span>${attrLabel(key)}</span><b>${attrValue(session.candidate, key).toFixed(0)}</b></button>`).join('')}</div>` : ''}
        ${ui.trainingKind === 'combo' ? `<div class="seg"><button class="${ui.trainingCombo === 'attack' ? 'active' : ''}" data-training-combo="attack">进攻配合</button><button class="${ui.trainingCombo === 'defense' ? 'active' : ''}" data-training-combo="defense">防守配合</button></div>` : ''}
        ${ui.trainingKind === 'position' ? positionField(session, isGk) : ''}
        ${ui.trainingKind === 'protection' ? `<div class="form-row"><label for="training-protection">防护方向</label><select id="training-protection"><option value="prevention" ${ui.trainingProtection === 'prevention' ? 'selected' : ''}>伤病预防</option><option value="resilience" ${ui.trainingProtection === 'resilience' ? 'selected' : ''}>伤病韧性</option></select></div>` : ''}
        ${ui.trainingKind === 'inherit' ? inheritFields(session, mentors, mentor) : ''}
        ${groupAction ? teammatePicker(teammates) : ''}
        ${previewBox(session, plan, isGk)}
        ${error ? `<p class="warn-text training-error small" role="alert">${esc(error)}</p>` : ''}
        <button class="btn primary wide" data-action="training-execute" ${error ? 'disabled' : ''}>${error ? '无法执行' : `${icon('play', 14)}执行行动`}</button>
        <p class="hint training-quality-probabilities">培养不消耗金币；开始时扣除 30 精力。专项、配合、队内比赛品质：一般 50% ×0.7 / 成功 30% ×1 / 大成功 15% ×1.3 / 完美成功 5% ×1.6；仅影响基础成长。同一课程行动的品质固定，切换选择不能重抽。</p>
      </div>
    </div>`, { aside: `<span class="muted small">行动 ${session.action + 1}/${trainingActionsTotal(session)}</span>`, className: 'action-panel' })
}

function eventPanel(session: TrainingSession, event: NonNullable<ReturnType<typeof eventById>>): string {
  const isGk = session.candidate.positions.GK > 0
  const lowMood = session.scheduleVersion === 1 && (session.lowMoodWeeks ?? []).includes(trainingDate(session.pendingEventAction ?? session.action).week) && trainingDate(session.pendingEventAction ?? session.action).day <= 3
  return panel(esc(event.title), `
    <p class="event-text">${esc(event.text)}</p>
    <div class="options">
      ${event.options.map((option) => {
        const p = option.branch ? branchProbability(session, option.branch.check, option.branch.p) : undefined
        return `<button class="option" data-action="event-option" data-option="${esc(option.id)}">
          <span class="option-head"><b>${esc(option.label)}</b>${p !== undefined ? `<span class="prob">${esc(option.branch?.chanceText ?? '成功率')} ${pct(p, 0)}</span>` : ''}</span>
          <span class="option-hint">${esc(displayEventHint(option.hint, isGk, eventGrowthScale(session)))}</span>
          ${option.branch ? `<span class="branch-preview"><span class="up">成功：${esc(option.branch.success.text ?? '')}</span><span class="down">失败：${esc(option.branch.failure.text ?? '')}</span></span>` : ''}
        </button>`
      }).join('')}
    </div>
    <p class="hint">选项列出的属性成长为基础值，不含设施加成；${lowMood ? '低落情绪会使属性成长减少 50%；' : ''}接近各自上限时实际成长可能较少。随机结果展示概率并立即保存。</p>
  `, { className: 'event-panel', aside: tag(event.mainline ? '主线' : event.category === 'chain' ? `事件链 ${event.stage}/3` : '训练事件', event.mainline ? 'gold' : '') })
}

function candidatePanel(current: Player, cand: Player, session: TrainingSession): string {
  const card = playerCards(game, current.id).find((item) => item.id === session.cardId)
  return panel(`新球员卡${card ? ` · ${esc(cardName(card))}` : ''}`, `
    <p>本轮培养已结束，新卡已进入库存。现在换上，还是先留在库存？换卡不影响体能和精力。隐藏属性的变化不在表中公开。</p>
    <div class="candidate-layout">
      <div>${attrCompareTable(current, cand)}</div>
      <div class="candidate-side">
        <div class="tile-grid">
          ${tile('CA', `${playerCA(current).toFixed(1)} → ${playerCA(cand).toFixed(1)}`, caDelta(current, cand))}
          ${tile('路线', session.routeId ? esc(ROUTE_LABELS[session.routeId]) : '未选择')}
        </div>
        ${skillGroups(cand)}
      </div>
    </div>
    <div class="btn-row">
      <button class="btn primary" data-action="confirm-candidate" data-player="${esc(current.id)}" ${game.activeMatch ? 'disabled title="比赛进行中不能换卡"' : ''}>${icon('check', 14)}装备新卡</button>
      <button class="btn" data-action="keep-candidate" data-player="${esc(current.id)}">留在库存</button>
      <button class="btn ghost" data-action="discard-candidate" data-player="${esc(current.id)}">丢弃这张卡</button>
    </div>
  `, { className: 'candidate-panel', aside: tag('已入库', 'good') })
}

