import type { Player, Position, SkillId, TrainingLogEntry, TrainingSession } from '../../game/types.ts'
import { eventById, ROUTE_LABELS } from '../../game/data/events.ts'
import { POSITION_LABELS } from '../../game/data/attributes.ts'
import { inheritanceChances, validateInheritance } from '../../game/inheritance.ts'
import { canLearnSkill, skillCategory } from '../../game/data/skills.ts'
import { autoPresetLabel, autoTrainingConfig, autoTrainingPresetsFor, autoTrainingRunnable, previewTraining, resolveAutoPresetId } from '../../game/actions.ts'
import { displayCA, initialDisplayCA, mainAttrsFor } from '../../game/rating.ts'
import { branchProbability, eventChance, eventGrowthScale, failureChance, planTraining, REST_PARTNER_RECOVERY, trainingActionsTotal, TRAINING_ACTION_INFO, TRAINING_ENERGY_COST, weekOfAction, type TrainingRequest } from '../../game/training.ts'
import { partnerAssignment, trainingDate, trainingOptions, type TrainingActivityId } from '../../game/training-calendar.ts'
import { baseBuild, playerCards } from '../../game/cards.ts'
import { skillEffectText } from '../../game/data/skill-effects.ts'
import { getSkillTier } from '../../game/inheritance.ts'
import { bookKey, bookLearnChance, bookName, bookRequirementText, bookTierLabel, canUseBookOnPlayer, eventForSession } from '../../game/legend-learning.ts'
import { keyAttrsOf } from '../../game/data/key-attrs.ts'
import { activityColor, attrColor, attributeRadar, attrHeat, caHeat, cardName, cardSelect, icon, mainAttrs, meter, pageHead, panel, posBadge, primaryPosition, skillGroups, skillTierLabel, tag, tile, traitLabel } from '../components.ts'
import { attrLabel, attrValue, caDelta, displayEventHint, esc, gainText, pct, playerCA, positionLabel, skillName, trainingLogText } from '../format.ts'
import { game, ui } from '../state.ts'

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

export function eligibleTrainingTeammates(session: TrainingSession): Player[] {
  return game.roster.filter((player) => {
    const other = game.training[player.id]
    return player.id !== session.playerId && !!other && !other.completed && !game.candidates[player.id] && !other.pendingEventId && other.action === session.action && other.scheduleVersion === session.scheduleVersion && (session.scheduleVersion !== 1 || other.scheduleSeed === session.scheduleSeed) && other.action < trainingActionsTotal(other)
  })
}

const TIER_ORDER: Record<'silver' | 'gold' | 'rainbow', number> = { silver: 0, gold: 1, rainbow: 2 }

/** 当目标技能类别槽位已满时，解析（并默认按银→金→彩挑选）要顶掉的已有同类别技能。 */
function resolveReplaceSkill(session: TrainingSession | undefined, targetSkill: SkillId | null): SkillId | undefined {
  if (!session || !targetSkill) return undefined
  if (session.candidate.skills.includes(targetSkill)) return undefined
  if (canLearnSkill(session.candidate.skills, targetSkill)) return undefined
  const category = skillCategory(targetSkill)
  const replaceable = session.candidate.skills.filter((s) => skillCategory(s) === category)
  if (replaceable.length === 0) return undefined
  if (ui.trainingReplaceSkill && replaceable.includes(ui.trainingReplaceSkill)) {
    return ui.trainingReplaceSkill
  }
  const bestDefault = [...replaceable].sort(
    (a, b) => TIER_ORDER[getSkillTier(session.candidate, a)] - TIER_ORDER[getSkillTier(session.candidate, b)],
  )[0]
  ui.trainingReplaceSkill = bestDefault
  return bestDefault
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
      const skill = ui.trainingSkill ?? 'injury_prevention'
      const replaceSkill = activity.parameters === 'inherit' ? resolveReplaceSkill(session, skill) : undefined
      return {
        kind: 'activity',
        activityId: ui.trainingActivity,
        ...(activity.group ? { teammateIds } : {}),
        ...(activity.parameters === 'position' ? { position: ui.trainingPosition } : {}),
        ...(activity.parameters === 'inherit' ? { mentorId: ui.trainingMentorId, skill, ...(replaceSkill ? { replaceSkill } : {}) } : {}),
      }
    }
  }
  if (ui.trainingKind === 'drill') return { kind: 'drill', attr: ui.trainingAttr, teammateIds }
  if (ui.trainingKind === 'combo') return { kind: 'combo', focus: ui.trainingCombo, teammateIds }
  if (ui.trainingKind === 'match') return { kind: 'match', teammateIds }
  if (ui.trainingKind === 'position') return { kind: 'position', position: ui.trainingPosition }
  if (ui.trainingKind === 'rest') return { kind: 'rest' }
  if (ui.trainingKind === 'protection') return { kind: 'protection', focus: ui.trainingProtection }
  if (ui.trainingKind === 'inherit') {
    const skill = ui.trainingSkill ?? 'injury_prevention'
    const replaceSkill = resolveReplaceSkill(session, skill)
    return { kind: 'inherit', mentorId: ui.trainingMentorId, skill, ...(replaceSkill ? { replaceSkill } : {}) }
  }
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
      actions: playerSelect(),
    })}
    ${sessionStrip()}
    ${selected ? renderTrainingPlayer(selected) : overviewTable()}
  `
}

/**
 * 自动培养入口：
 * - 未开启时点击「自动培养」直接弹出一级简洁预设菜单（选好预设即可一键开练/启动，无需先点策略再开开关）；
 * - 开启中时点击开关可立即暂停，旁边提供当前预设按钮随时切换或进入二级细调。
 */
function autoControls(player: Player): string {
  const config = autoTrainingConfig(game, player.id)
  const on = config.autopilot === true
  const label = autoPresetLabel(player, config)
  if (!on) {
    return `<div class="train-auto">
      <button class="auto-switch" role="switch" aria-checked="false" data-action="training-auto-toggle" data-player="${esc(player.id)}"><i></i><span>自动培养</span></button>
    </div>`
  }
  return `<div class="train-auto">
    <button class="auto-switch on" role="switch" aria-checked="true" data-action="training-auto-toggle" data-player="${esc(player.id)}" title="点击暂停自动培养"><i></i><span>自动培养中</span></button>
    <button class="btn ghost small" data-action="auto-strategy-open" data-player="${esc(player.id)}" title="切换预设或细调策略">${esc(label)} ▾</button>
  </div>`
}

function autoConfirmButton(player: Player): string {
  const session = game.training[player.id]
  const candidate = game.candidates[player.id]
  const config = autoTrainingConfig(game, player.id)
  if (autoTrainingRunnable(game, player.id)) {
    return `<button class="btn primary" data-action="training-auto-confirm" data-player="${esc(player.id)}">${icon(config.autopilot ? 'check' : 'play', 14)}${config.autopilot ? '应用并继续自动培养' : '开启自动培养'}</button>`
  }
  if (session?.completed || candidate) {
    return `<button class="btn" data-action="auto-strategy-close">保存策略（请先处理新卡）</button>`
  }
  const energy = player.energy ?? 100
  if (energy >= TRAINING_ENERGY_COST) {
    return `<button class="btn primary" data-action="training-auto-confirm" data-player="${esc(player.id)}">${icon('play', 14)}开始并自动培养（-${TRAINING_ENERGY_COST} 精力）</button>`
  }
  return `<button class="btn" data-action="auto-strategy-close">保存策略（精力不足 ${TRAINING_ENERGY_COST}）</button>`
}

/**
 * 自动培养两级弹窗：
 * - 1 级菜单（简洁）：展示直观的流派预设卡片 + 一键启动按钮 + 「细调策略」入口；
 * - 2 级菜单（细调）：支持切换底层模式、调整属性优先级顺序或填写 0–2000 最低目标值。
 */
export function renderAutoStrategyOverlay(): string {
  if (!ui.autoStrategyOpen || !ui.trainingPlayerId) return ''
  const player = game.roster.find((item) => item.id === ui.trainingPlayerId)
  if (!player) return ''
  const config = autoTrainingConfig(game, player.id)
  const mains = mainAttrsFor(player.positions.GK > 0)
  const session = game.training[player.id]
  const keyAttrs = keyAttrsOf(player)

  if (!ui.autoStrategyDetail) {
    const presets = autoTrainingPresetsFor(player)
    const activePreset = resolveAutoPresetId(player, config)
    const customDesc = config.mode === 'targets'
      ? (() => {
          const entries = mains.filter((k) => (config.targets[k] ?? 0) > 0).map((k) => `${attrLabel(k)}≥${config.targets[k]}`)
          return entries.length ? `目标补齐：${entries.slice(0, 3).join('、')}${entries.length > 3 ? '…' : ''}` : '已选择最低目标模式（可在二级菜单设置数值）'
        })()
      : `自定义顺序：${config.priority.filter((k) => mains.includes(k)).slice(0, 3).map(attrLabel).join(' → ')}`
    const cards = presets.map((preset) => `
      <button type="button" class="auto-preset-card ${activePreset === preset.id ? 'active' : ''}" data-action="training-auto-preset" data-preset="${preset.id}" data-player="${esc(player.id)}">
        <span class="auto-preset-head">
          <b>${esc(preset.label)}</b>
          ${preset.tag ? `<span class="tag gold">${esc(preset.tag)}</span>` : ''}
        </span>
        <span class="auto-preset-desc">${esc(preset.summary)}</span>
      </button>`).join('')
    const customCard = activePreset === 'custom'
      ? `<button type="button" class="auto-preset-card active custom" data-action="auto-strategy-detail-open">
          <span class="auto-preset-head">
            <b>自定义细调方案</b>
            <span class="tag info">${config.mode === 'targets' ? '最低目标' : '自定义顺序'}</span>
          </span>
          <span class="auto-preset-desc">${esc(customDesc)} · 点击微调</span>
        </button>`
      : ''
    return `
      <div class="overlay" data-action="auto-strategy-close">
        <div class="modal auto-modal auto-modal-l1" data-stop="true" role="dialog" aria-modal="true" aria-label="自动培养">
          <button class="modal-close" data-action="auto-strategy-close" aria-label="关闭">${icon('close', 16)}</button>
          <div class="kicker">自动培养 · 快捷方向</div>
          <h1>${esc(player.name)} <small class="muted">${POSITION_LABELS[primaryPosition(player)]} · 招牌：${keyAttrs.map(attrLabel).join(' / ')}</small></h1>
          <div class="auto-preset-grid">
            ${cards}
            ${customCard}
          </div>
          <div class="auto-modal-foot">
            <button type="button" class="btn ghost" data-action="auto-strategy-detail-open">细调属性与目标 ▸</button>
            <div class="auto-modal-actions">
              ${autoConfirmButton(player)}
            </div>
          </div>
        </div>
      </div>`
  }

  // 二级菜单：细调属性优先级或最低目标值（每轮从原始属性开始算起点）。
  const priority = config.priority.filter((key) => mains.includes(key))
  const priorityRows = priority.map((key, index) => {
    const start = session?.candidate.attrs[key] ?? player.baseAttrs?.[key] ?? player.attrs[key] ?? 0
    return `<div class="row-line" style="gap:8px">
      <span class="attr-name" style="flex:1;--attr-color:${attrColor(key)}">${index + 1}. ${attrLabel(key)} ${keyAttrs.includes(key) ? '<span class="tag gold">主要</span>' : ''} <span class="muted small">当前 ${Math.round(start)}</span></span>
      <button class="btn ghost" data-action="training-auto-priority" data-attr="${key}" data-dir="up" ${index === 0 ? 'disabled' : ''}>↑</button>
      <button class="btn ghost" data-action="training-auto-priority" data-attr="${key}" data-dir="down" ${index === priority.length - 1 ? 'disabled' : ''}>↓</button>
    </div>`
  }).join('')
  const targetRows = mains.map((key) => {
    const start = session?.candidate.attrs[key] ?? player.baseAttrs?.[key] ?? player.attrs[key] ?? 0
    return `<div class="form-row"><label class="attr-name" style="--attr-color:${attrColor(key)}" for="training-auto-target-${key}">${attrLabel(key)} <small class="muted">(${Math.round(start)})</small></label>
      <input id="training-auto-target-${key}" data-auto-target="${key}" type="number" min="0" max="2000" step="50" value="${config.targets[key] ?? 0}" style="max-width:140px">
    </div>`
  }).join('')
  const detailBody = config.mode === 'targets'
    ? `<div class="auto-detail-pane">
        <div class="field-title">最低目标（0–2000，优先补差距最大的属性）</div>
        <div class="auto-target-grid">${targetRows}</div>
        <div class="btn-row"><button class="btn small" data-action="training-auto-save">保存目标值</button></div>
      </div>`
    : config.mode === 'max'
      ? `<div class="auto-detail-pane">
          <p class="hint">每回合自动挑选总属性成长最高的课程，并将该球员的招牌属性（<b>${keyAttrs.map(attrLabel).join('、')}</b>）按 3 倍权重计分，兼顾上限效率与球员定位。</p>
        </div>`
      : `<div class="auto-detail-pane">
          <div class="field-title">属性优先级（从上到下依次练满）</div>
          <div class="rows">${priorityRows}</div>
          <div class="btn-row"><button class="btn ghost small" data-action="training-auto-reset">恢复默认优先级</button></div>
        </div>`
  return `
    <div class="overlay" data-action="auto-strategy-close">
      <div class="modal auto-modal auto-modal-l2" data-stop="true" role="dialog" aria-modal="true" aria-label="细调自动策略">
        <button class="modal-close" data-action="auto-strategy-close" aria-label="关闭">${icon('close', 16)}</button>
        <div class="auto-l2-nav">
          <button type="button" class="btn ghost small" data-action="auto-strategy-detail-back">← 返回简洁选项</button>
          <span class="kicker">二级细调 · ${esc(player.name)}</span>
        </div>
        <div class="btn-row" style="margin-top:6px">
          <div class="seg">
            <button class="${config.mode === 'priority' ? 'active' : ''}" data-action="training-auto-mode" data-mode="priority">属性优先</button>
            <button class="${config.mode === 'targets' ? 'active' : ''}" data-action="training-auto-mode" data-mode="targets">最低目标</button>
            <button class="${config.mode === 'max' ? 'active' : ''}" data-action="training-auto-mode" data-mode="max">自动选择</button>
          </div>
        </div>
        ${detailBody}
        <div class="auto-modal-foot">
          <button type="button" class="btn ghost" data-action="auto-strategy-detail-back">← 一级预设</button>
          <div class="auto-modal-actions">
            ${autoConfirmButton(player)}
          </div>
        </div>
      </div>
    </div>`
}

function attrCompareTable(current: Player, candidate: Player): string {
  const gk = current.positions.GK > 0
  const rows = mainAttrsFor(gk).map((key) => {
    const delta = candidate.attrs[key] - current.attrs[key]
    return `<tr><td class="attr-name" style="--attr-color:${attrColor(key)}">${attrLabel(key)}</td><td class="num">${attrHeat(current.attrs[key])}</td><td class="num">${attrHeat(candidate.attrs[key])}</td><td class="num ${delta > 0 ? 'up' : delta < 0 ? 'down' : 'dim'}">${delta > 0 ? '+' : ''}${delta.toFixed(1)}</td></tr>`
  }).join('')
  return `<table class="dt"><thead><tr><th>属性</th><th class="num">当前</th><th class="num">新卡</th><th class="num">变化</th></tr></thead><tbody>${rows}</tbody></table>`
}

function bookPicker(player: Player): string {
  const books = game.legendBooks ?? []
  if (!books.length) return ''
  const selected = new Set(ui.trainingBookIds)
  const rows = books.map((book) => {
    const key = bookKey(book)
    const check = canUseBookOnPlayer(player, book)
    const checked = selected.has(key)
    const chance = bookLearnChance(player, book)
    const reason = check.ok ? '' : ` · ${check.reason}`
    return `<label class="check-field ${check.ok ? '' : 'muted'}" title="${esc(reason)}">
      <input type="checkbox" data-training-book="${esc(key)}" ${checked ? 'checked' : ''} ${!check.ok || (!checked && selected.size >= 4) ? 'disabled' : ''}>
      <span><b>${esc(bookTierLabel(book.tier))}·${esc(bookName(book.id))}</b><small class="muted"> 要求 ${esc(bookRequirementText(book))} · 成功率 ${Math.round(chance * 100)}%${esc(reason)}</small></span>
    </label>`
  }).join('')
  return panel(`传奇技能书槽 <small>${selected.size} / 4</small>`, `<p class="hint pad">每轮最多带 4 本；书不会消耗，学习成功与否都留在库存。失败后同一本还能再触发一次。</p><div class="check-grid">${rows}</div>`, { flush: true })
}

function bookLoadout(session: TrainingSession): string {
  if (!session.books?.length) return ''
  const rows = session.books.map((book) => `<div class="row-line"><span>${esc(bookTierLabel(book.tier))} · ${esc(bookRequirementText(book))}</span><b>${Math.round(bookLearnChance(session.candidate, book) * 100)}%</b></div>`).join('')
  return panel(`本轮技能书槽 <small>${session.books.length} / 4</small>`, `<div class="rows">${rows}</div><p class="hint pad">书不消耗；12/14/16/18 次行动前各有一次保底学习事件。</p>`, { flush: true })
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
      <div class="btn-row">
        <button class="btn primary" data-action="start-training" data-player="${esc(player.id)}" ${enough ? '' : 'disabled'}>${enough ? `${icon('play', 14)}开始培养` : '精力不足，等待恢复'}</button>
        ${autoControls(player)}
      </div>
    `, { className: 'training-start', aside: posBadge(primaryPosition(player)) })}
    ${panel('培养起点：原始属性', `<div class="radar-pair">${attributeRadar(base, undefined, 208, true)}<div>${attrList(base)}</div></div>`)}
    ${bookPicker(player)}
  </div>`
}

function attrList(player: Pick<Player, 'attrs' | 'positions'>): string {
  return `<table class="dt plain"><tbody>${mainAttrs(player).map((key) => `<tr><td class="attr-name" style="--attr-color:${attrColor(key)}">${attrLabel(key)}</td><td class="num">${attrHeat(player.attrs[key])}</td></tr>`).join('')}</tbody></table>`
}

function renderTrainingPlayer(player: Player): string {
  const session = game.training[player.id]
  const candidate = game.candidates[player.id]
  if (!session && !candidate) return renderTrainingStart(player)
  const currentSession = session!
  const cand = candidate ?? currentSession.candidate
  const pendingEvent = currentSession.pendingEventId ? eventForSession(currentSession, currentSession.pendingEventId) : null
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
          <div class="radar-block">${attributeRadar(cand, player, 208, true)}
            <div class="legend radar-legend"><span class="legend-item"><i class="swatch radar-swatch-base"></i>当前</span><span class="legend-item"><i class="swatch radar-swatch-top"></i>培养中</span></div>
          </div>
          ${currentSession.completed || candidate ? '' : `${attrCompareTable(player, cand)}<div class="side-skills">${skillGroups(cand)}</div>`}
        `, { aside: `<span class="muted small">CA ${playerCA(player).toFixed(1)} → ${playerCA(cand).toFixed(1)}</span>` })}
        ${bookLoadout(currentSession)}
        ${currentSession.scheduleVersion === 1 && currentSession.exchangeMatches?.length ? panel('交流赛记录', `<div class="rows">${currentSession.exchangeMatches.map((match) => `<div class="row-line"><span>第 ${match.week} 周 · ${esc(match.opponentName)}${match.ownRating !== undefined ? ` <small class="muted">RANK ${match.ownRating} 对 ${match.opponentRating}</small>` : ''}</span><b>${match.homeScore}:${match.awayScore}</b><span class="form f-${match.result === 'win' ? 'W' : match.result === 'loss' ? 'L' : 'D'}">${{ win: '胜', draw: '平', loss: '负' }[match.result]}</span></div>`).join('')}</div>`, { flush: true }) : ''}
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
    <div class="train-lead">
      <div class="train-id">
        ${posBadge(primaryPosition(current))}
        <div>
          <h2>${esc(current.name)} <small>${esc(current.enName)}</small></h2>
          <p class="muted small">${when} · 行动 ${session.action}/${total} · ${traitLabel(current.traitId)} · ${esc(route)}</p>
        </div>
      </div>
      ${autoControls(current)}
    </div>
    <div class="train-stats">
      <div class="stat-box"><span>当前 CA</span><b>${playerCA(current).toFixed(1)}</b></div>
      <div class="stat-box"><span>培养中 CA</span><b>${playerCA(cand).toFixed(1)}</b><small class="${playerCA(cand) >= playerCA(current) ? 'up' : 'down'}">${caDelta(current, cand)}</small></div>
      <div class="stat-box"><span>训练体力</span>${meter(stamina)}</div>
      ${(session.cupCeilingBonus ?? 0) > 0 ? `<div class="stat-box"><span>奖杯上限</span><b>+${session.cupCeilingBonus}</b></div>` : ''}
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
  const stamina = 100 - session.fatigue
  const failP = failureChance(stamina)
  const riskAction = plan.fatigue > 0 || Object.keys(plan.gains).length > 0
  return `<div class="preview">
    <div class="preview-grid">
      <div class="preview-cell wide"><span>属性成长</span><b class="${gainText(plan.gains, isGk) ? 'up' : ''}">${gainText(plan.gains, isGk) || '—'}</b></div>
      <div class="preview-cell"><span>CA</span><b>${displayCA(plan.caBefore).toFixed(1)} → ${displayCA(plan.caAfter).toFixed(1)}</b></div>
      <div class="preview-cell training-stamina-preview"><span>训练体力</span><b>${stamina} → ${100 - Math.max(0, Math.min(100, session.fatigue + plan.fatigue))}</b></div>
    </div>
    ${riskAction && failP > 0 ? `<p class="warn-text small">体力偏低（≤30）：当前失败率 ${pct(failP, 0)}，且无法触发大成功/完美成功，建议先恢复。</p>` : ''}
    ${plan.note ? `<p class="hint">${esc(plan.note)}</p>` : ''}
  </div>`
}

/** 这个选项上有哪些陪练（每个时段 6 人随机分到各个选项）。 */
function optionPartners(session: TrainingSession, optionId: string): Player[] {
  return (partnerAssignment(session)[optionId] ?? [])
    .map((id) => game.roster.find((item) => item.id === id))
    .filter((item): item is Player => !!item)
}

function optionPartnerList(session: TrainingSession, optionId: string): string {
  if (!session.partnerIds?.length) return ''
  const players = optionPartners(session, optionId)
  return `<div class="training-teammates"><span class="field-title">本项陪练 ${players.length}/${session.partnerIds.length}</span>
    <div class="check-grid">${players.map((mate) => `<span class="check-field muted"><span>${posBadge(primaryPosition(mate))} ${esc(mate.name)}</span></span>`).join('') || '<span class="muted small">无</span>'}</div>
  </div>`
}

/** 小队模式：显示固定阵容，不能再临时勾人。 */
function squadRoster(session: TrainingSession): string {
  const ids = session.partnerIds ?? []
  if (!ids.length) return ''
  const players = ids.map((id) => game.roster.find((item) => item.id === id)).filter((item): item is Player => !!item)
  return `<div class="training-teammates"><span class="field-title">陪练队友（整轮固定，只给主角加成长）</span>
    <div class="check-grid">${players.map((mate) => `<span class="check-field muted"><span>${posBadge(primaryPosition(mate))} ${esc(mate.name)}</span></span>`).join('')}</div>
  </div>`
}

function teammatePicker(teammates: Player[]): string {
  return `<div class="training-teammates"><span class="field-title">共同训练队友</span>
    <div class="check-grid">${teammates.map((mate) => `<label class="check-field"><input type="checkbox" data-training-teammate="${esc(mate.id)}" value="${esc(mate.id)}" ${ui.trainingTeammateIds.includes(mate.id) ? 'checked' : ''}><span>${esc(mate.name)} · 体力 ${Math.round(100 - game.training[mate.id].fatigue)}</span></label>`).join('') || '<span class="muted small">暂无可选队友。</span>'}</div>
  </div>`
}

function pickTrainablePosition(session: TrainingSession, isGk: boolean, current: Position): Position {
  if (isGk) return 'GK'
  const choices: Position[] = ['CB', 'W', 'CM', 'ST']
  if (choices.includes(current) && session.candidate.positions[current] < 100) return current
  return choices.find((pos) => session.candidate.positions[pos] < 100) ?? (choices.includes(current) ? current : 'CM')
}

function positionField(session: TrainingSession, isGk: boolean): string {
  const choices = (isGk ? ['GK'] : ['CB', 'W', 'CM', 'ST']) as Position[]
  return `<div class="form-row"><label for="training-position">位置</label><select id="training-position">${choices.map((pos) => {
    const val = Math.round(session.candidate.positions[pos])
    const maxed = val >= 100
    return `<option value="${pos}" ${ui.trainingPosition === pos ? 'selected' : ''} ${maxed ? 'disabled' : ''}>${positionLabel(pos)} · 当前 ${val}${maxed ? '（已满）' : ''}</option>`
  }).join('')}</select></div>`
}

function inheritFields(session: TrainingSession, mentors: Player[], mentor: Player | undefined): string {
  if (!mentor || !ui.trainingSkill) return '<p class="muted">阵容中没有拥有技能的可用导师。</p>'
  const replaceSkill = resolveReplaceSkill(session, ui.trainingSkill)
  const category = skillCategory(ui.trainingSkill)
  const replaceable = replaceSkill ? session.candidate.skills.filter((s) => skillCategory(s) === category) : []
  const chances = inheritanceChances(session, mentor, ui.trainingSkill)
  const error = validateInheritance(session, mentor, ui.trainingSkill, replaceSkill)
  const replaceField = replaceable.length > 0
    ? `<div class="form-row"><label for="training-replace-skill">顶掉技能</label><select id="training-replace-skill">${replaceable.map((skill) => `<option value="${esc(skill)}" ${replaceSkill === skill ? 'selected' : ''}>${esc(skillName(skill))} · ${skillTierLabel(session.candidate, skill)}</option>`).join('')}</select></div>`
    : ''
  const statusMsg = error
    ? esc(error)
    : replaceSkill
      ? `${category === 'main' ? '主技能槽' : '辅助技能槽'}已满：传承成功后将顶掉「${esc(skillName(replaceSkill))}」，未成功则保留原技能`
      : '符合传承条件'
  return `<div class="form-row"><label for="training-mentor">导师</label><select id="training-mentor">${mentors.map((item) => `<option value="${esc(item.id)}" ${mentor.id === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></div>
    <div class="form-row"><label for="training-skill">技能</label><select id="training-skill">${mentor.skills.map((skill) => `<option value="${esc(skill)}" ${ui.trainingSkill === skill ? 'selected' : ''}>${esc(skillName(skill))} · ${skillTierLabel(mentor, skill)}</option>`).join('')}</select></div>
    ${replaceField}
    <p class="small dim">${esc(skillEffectText(ui.trainingSkill, getSkillTier(mentor, ui.trainingSkill)))}</p>
    <p class="small">导师技能：${skillTierLabel(mentor, ui.trainingSkill)} · 成功率 ${pct(chances.success)}；成功后：银 ${pct(1 - chances.gold - chances.rainbow)} / 金 ${pct(chances.gold)} / 彩 ${pct(chances.rainbow)}</p>
    <p class="small ${error ? 'warn-text' : replaceSkill ? 'warn-text' : 'muted'}">${statusMsg}</p>`
}

function resolveMentor(session: TrainingSession): { mentors: Player[]; mentor: Player | undefined } {
  const mentors = game.roster.filter((player) => player.id !== session.playerId && player.skills.length > 0)
  const mentor = mentors.find((player) => player.id === ui.trainingMentorId) ?? mentors[0]
  ui.trainingMentorId = mentor?.id ?? ''
  if (!mentor?.skills.includes(ui.trainingSkill as SkillId)) ui.trainingSkill = mentor?.skills[0] ?? null
  return { mentors, mentor }
}

/** 选项按钮上的陪练人数徽标，悬停看名字。 */
function activityMates(session: TrainingSession, optionId: string): string {
  const players = optionPartners(session, optionId)
  if (!players.length) return ''
  return `<span class="act-mates" title="${esc(`陪练：${players.map((mate) => mate.name).join('、')}`)}">${players.length}</span>`
}

/** 恢复上站着陪练时，显示加成后的恢复量。 */
function activityStamina(session: TrainingSession, item: { id: string; stamina: string; noRecovery?: boolean }): string {
  if (item.id !== 'rest' || item.noRecovery) return item.stamina
  return `+${30 + REST_PARTNER_RECOVERY * optionPartners(session, item.id).length}`
}

function calendarActionPanel(session: TrainingSession): string {
  const options = trainingOptions(session)
  const selected = options.find((item) => item.id === ui.trainingActivity) ?? options[0]
  if (!selected) return panel('本次行动', '<p class="muted">当前没有可用行动。</p>')
  ui.trainingActivity = selected.id as TrainingActivityId
  const isGk = session.candidate.positions.GK > 0
  if (selected.parameters === 'position') {
    ui.trainingPosition = pickTrainablePosition(session, isGk, ui.trainingPosition)
  }
  const { mentors, mentor } = resolveMentor(session)
  const request = buildTrainingRequest()
  const preview = previewTraining(game, session.playerId, request, true)
  const plan = preview.plan
  const date = trainingDate(session.action + 1)
  const lowMood = date.day <= 3 && (session.lowMoodWeeks ?? []).includes(date.week)
  const teammates = eligibleTrainingTeammates(session)
  return panel(`第 ${date.week} 周 · ${date.dayLabel} ${date.slot}`, `<div class="action-layout">
      <div class="activity-list" role="group" aria-label="训练项目">
        ${options.map((item) => `<button class="activity ${item.id === selected.id ? 'active' : ''}" style="--act-color:${activityColor(isGk ? item.goalkeeperGains ?? item.gains : item.gains, isGk)}" data-training-activity="${esc(item.id)}"><b>${esc(item.label)}</b><span class="act-right">${activityMates(session, item.id)}<small class="${item.stamina.startsWith('+') ? 'up' : 'muted'}">${esc(activityStamina(session, item))}</small></span></button>`).join('')}
      </div>
      <div class="action-detail">
        <p class="action-desc small">${esc(selected.desc)}</p>
        ${lowMood ? '<p class="warn-text small">低落情绪：本周一至周三成长 -50%。</p>' : ''}
        ${selected.parameters === 'position' ? positionField(session, isGk) : ''}
        ${selected.parameters === 'inherit' ? inheritFields(session, mentors, mentor) : ''}
        ${session.partnerIds?.length ? optionPartnerList(session, selected.id) : selected.group ? teammatePicker(teammates) : ''}
        ${plan ? previewBox(session, plan as ReturnType<typeof planTraining>, isGk) : ''}
        ${preview.error ? `<p class="warn-text training-error small" role="alert">${esc(preview.error)}</p>` : ''}
        <button class="btn primary wide" data-action="training-execute" ${preview.error || !plan ? 'disabled' : ''}>${preview.error || !plan ? '无法执行' : `${icon('play', 14)}执行行动`}</button>
      </div>
    </div>`, { aside: `<span class="muted small">行动 ${session.action + 1}/${trainingActionsTotal(session)}</span>`, className: 'action-panel' })
}

function legacyActionPanel(session: TrainingSession): string {
  const isGk = session.candidate.positions.GK > 0
  if (ui.trainingKind === 'drill' && !mainAttrsFor(isGk).includes(ui.trainingAttr)) ui.trainingAttr = 'passing'
  const { mentors, mentor } = resolveMentor(session)
  if (ui.trainingKind === 'position') {
    ui.trainingPosition = pickTrainablePosition(session, isGk, ui.trainingPosition)
  }
  const request = buildTrainingRequest()
  const preview = previewTraining(game, session.playerId, request, true)
  const plan = preview.plan ?? planTraining(session, request, mentor, 0, true)
  const error = preview.error
  const teammates = eligibleTrainingTeammates(session)
  const groupAction = ui.trainingKind === 'drill' || ui.trainingKind === 'combo' || ui.trainingKind === 'match'
  const staminaText = (id: string) => (id === 'rest' ? '+30' : id === 'mentor' ? '+5' : `-${id === 'drill' ? 12 : id === 'combo' ? 16 : id === 'match' ? 25 : 8}`)
  return panel('本次行动', `<div class="action-layout">
      <div class="activity-list" role="group" aria-label="训练项目">
        ${TRAINING_ACTION_INFO.map((item) => `<button class="activity ${ui.trainingKind === item.id ? 'active' : ''}" data-training-kind="${item.id}"><b>${item.label}</b><small class="${staminaText(item.id).startsWith('+') ? 'up' : 'muted'}">${staminaText(item.id)}</small></button>`).join('')}
      </div>
      <div class="action-detail">
        ${ui.trainingKind === 'drill' ? `<div class="attr-picker">${mainAttrsFor(isGk).map((key) => `<button class="attr-chip ${ui.trainingAttr === key ? 'active' : ''}" data-training-attr="${key}"><span>${attrLabel(key)}</span><b>${attrValue(session.candidate, key).toFixed(0)}</b></button>`).join('')}</div>` : ''}
        ${ui.trainingKind === 'combo' ? `<div class="seg"><button class="${ui.trainingCombo === 'attack' ? 'active' : ''}" data-training-combo="attack">进攻配合</button><button class="${ui.trainingCombo === 'defense' ? 'active' : ''}" data-training-combo="defense">防守配合</button></div>` : ''}
        ${ui.trainingKind === 'position' ? positionField(session, isGk) : ''}
        ${ui.trainingKind === 'protection' ? `<div class="form-row"><label for="training-protection">防护方向</label><select id="training-protection"><option value="prevention" ${ui.trainingProtection === 'prevention' ? 'selected' : ''}>伤病预防</option><option value="resilience" ${ui.trainingProtection === 'resilience' ? 'selected' : ''}>伤病韧性</option></select></div>` : ''}
        ${ui.trainingKind === 'inherit' ? inheritFields(session, mentors, mentor) : ''}
        ${session.partnerIds?.length ? squadRoster(session) : groupAction ? teammatePicker(teammates) : ''}
        ${previewBox(session, plan, isGk)}
        ${error ? `<p class="warn-text training-error small" role="alert">${esc(error)}</p>` : ''}
        <button class="btn primary wide" data-action="training-execute" ${error ? 'disabled' : ''}>${error ? '无法执行' : `${icon('play', 14)}执行行动`}</button>
      </div>
    </div>`, { aside: `<span class="muted small">行动 ${session.action + 1}/${trainingActionsTotal(session)}</span>`, className: 'action-panel' })
}

function eventPanel(session: TrainingSession, event: NonNullable<ReturnType<typeof eventById>>): string {
  const isGk = session.candidate.positions.GK > 0
  return panel(esc(event.title), `
    <p class="event-text">${esc(event.text)}</p>
    <div class="options">
      ${event.options.map((option) => {
        const p = option.book ? bookLearnChance(session.candidate, option.book) : option.branch ? branchProbability(session, option.branch.check, option.branch.p) : undefined
        return `<button class="option" data-action="event-option" data-option="${esc(option.id)}">
          <span class="option-head"><b>${esc(option.label)}</b>${p !== undefined ? `<span class="prob">${option.book ? '成功率' : esc(option.branch?.chanceText ?? '成功率')} ${pct(p, 0)}</span>` : ''}</span>
          <span class="option-hint">${esc(displayEventHint(option.hint, isGk, eventGrowthScale(session)))}</span>
          ${option.branch ? `<span class="branch-preview"><span class="up">成功：${esc(option.branch.success.text ?? '')}</span><span class="down">失败：${esc(option.branch.failure.text ?? '')}</span></span>` : option.book ? `<span class="branch-preview"><span class="up">成功：学会并保留书</span><span class="down">失败：疲劳 +6，书保留</span></span>` : ''}
        </button>`
      }).join('')}
    </div>
  `, { className: 'event-panel', aside: tag(event.category === 'mainline' ? '主线' : event.category === 'chain' ? `事件链 ${event.stage}/3` : '训练事件', event.category === 'mainline' ? 'gold' : '') })
}

function candidatePanel(current: Player, cand: Player, session: TrainingSession): string {
  const card = playerCards(game, current.id).find((item) => item.id === session.cardId)
  return panel(`新球员卡${card ? ` · ${esc(cardName(card))}` : ''}`, `
    <p>本轮培养已结束，新卡已进入库存。现在换上，还是先留在库存？换卡不影响体能和精力。</p>
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

