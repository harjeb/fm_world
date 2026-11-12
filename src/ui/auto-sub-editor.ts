import {
  POSITIONS,
  type AutoSubConditionRule,
  type AutoSubPlan,
  type AutoSubPreferBy,
  type AutoSubScoreState,
  type FormationId,
  type Position,
} from '../game/types.ts'
import { FORMATIONS } from '../game/data/formations.ts'
import { AUTO_SUB_PREFER_LABELS, AUTO_SUB_SCORE_LABELS, autoSubDisplaySeconds } from '../game/match/management.ts'
import { MAX_SUBS } from '../game/squad.ts'
import { esc, positionLabel } from './format.ts'
import { icon } from './icons.ts'

export type AutoSubScope = 'lineup' | 'match'

export type AutoSubStarterOption = {
  slotId: string
  slotLabel: string
  playerId: string
  name: string
  position: Position
  staminaPct?: number
  injured?: boolean
}

export type AutoSubBenchOption = {
  playerId: string
  name: string
  position: Position
  proficiency?: number
  staminaPct?: number
  injured?: boolean
}

const MINUTE_PRESETS = [0, 30, 45, 55, 60, 65, 70, 75, 80] as const
const SCORE_STATES: readonly AutoSubScoreState[] = ['any', 'leading', 'drawing', 'trailing', 'not_leading']
const PREFER_MODES: readonly AutoSubPreferBy[] = ['proficiency', 'stamina', 'ca']
const TARGET_POS_ORDER: readonly Position[] = ['ST', 'W', 'CM', 'CB', 'GK']

function minuteSelectOptions(current: number | undefined): string {
  const val = current ?? 0
  const choices = MINUTE_PRESETS.includes(val as (typeof MINUTE_PRESETS)[number])
    ? [...MINUTE_PRESETS]
    : [...MINUTE_PRESETS, val].sort((a, b) => a - b)
  return choices
    .map((m) => `<option value="${m}" ${val === m ? 'selected' : ''}>${m === 0 ? '不限时间' : `${m}′ 后`}</option>`)
    .join('')
}

function encodeConditionTarget(rule: AutoSubConditionRule): string {
  return rule.targetKind === 'any' ? 'any:' : `${rule.targetKind}:${rule.targetValue ?? ''}`
}

function decodeConditionTarget(encoded: string): Pick<AutoSubConditionRule, 'targetKind' | 'targetValue'> {
  const sep = encoded.indexOf(':')
  if (sep < 0) return { targetKind: 'any' }
  const kind = encoded.slice(0, sep)
  const val = encoded.slice(sep + 1)
  if (kind === 'position' && (POSITIONS as readonly string[]).includes(val)) {
    return { targetKind: 'position', targetValue: val }
  }
  if (kind === 'slot' && val) return { targetKind: 'slot', targetValue: val }
  if (kind === 'player' && val) return { targetKind: 'player', targetValue: val }
  return { targetKind: 'any' }
}

export function renderAutoSubEditor(options: {
  scope: AutoSubScope
  plan: AutoSubPlan
  formationId: FormationId
  starters: AutoSubStarterOption[]
  bench: AutoSubBenchOption[]
  disabled?: boolean
}): string {
  const { scope, plan, formationId, starters, bench, disabled = false } = options
  const dis = disabled ? 'disabled' : ''
  const staminaId = scope === 'lineup' ? 'auto-sub-stamina' : 'match-auto-sub-stamina'
  const injuryId = scope === 'lineup' ? 'auto-sub-injury' : 'match-auto-sub-injury'
  const activePositions = new Set<Position>(plan.staminaPositions ?? POSITIONS)
  const slots = FORMATIONS[formationId]?.slots ?? []
  const condRules = plan.conditionRules ?? []

  const posChips = POSITIONS.map((pos) => {
    const active = activePositions.has(pos)
    return `<button type="button" class="pos-chip ${active ? 'active' : ''}" data-action="auto-sub-pos-toggle" data-as-scope="${scope}" data-pos="${pos}" aria-pressed="${active}" ${dis}>${esc(positionLabel(pos))} <small>${pos}</small></button>`
  }).join('')

  const condRows = condRules
    .map((rule, index) => {
      const selectedTarget = encodeConditionTarget(rule)
      const targetOptions = [
        `<option value="any:" ${selectedTarget === 'any:' ? 'selected' : ''}>任意场上球员</option>`,
        `<optgroup label="按指定位置">${TARGET_POS_ORDER.map((pos) => {
          const v = `position:${pos}`
          return `<option value="${v}" ${selectedTarget === v ? 'selected' : ''}>位置 · ${esc(positionLabel(pos))} (${pos})</option>`
        }).join('')}</optgroup>`,
        slots.length
          ? `<optgroup label="按阵型槽位">${slots
              .map((slot) => {
                const v = `slot:${slot.id}`
                return `<option value="${v}" ${selectedTarget === v ? 'selected' : ''}>槽位 · ${esc(slot.label)}</option>`
              })
              .join('')}</optgroup>`
          : '',
        starters.length
          ? `<optgroup label="按指定球员">${starters
              .map((s) => {
                const v = `player:${s.playerId}`
                const extra = s.staminaPct !== undefined ? ` · 体力${s.staminaPct}%` : ''
                return `<option value="${v}" ${selectedTarget === v ? 'selected' : ''}>球员 · ${esc(s.name)} (${esc(positionLabel(s.position))}${extra})</option>`
              })
              .join('')}</optgroup>`
          : '',
      ].join('')

      return `<div class="auto-sub-cond-row" data-key="cond-${index}">
        <select aria-label="条件换人目标" data-as-scope="${scope}" data-as-cond-target="${index}" ${dis}>${targetOptions}</select>
        <label class="cond-inline"><span>体力&lt;</span><select aria-label="条件换人体力阈值" data-as-scope="${scope}" data-as-cond-stamina="${index}" ${dis}>${Array.from({ length: 99 }, (_, i) => i + 1)
          .map((v) => `<option value="${v}" ${rule.staminaBelow === v ? 'selected' : ''}>${v}%</option>`)
          .join('')}</select></label>
        <select aria-label="条件换人最早分钟" data-as-scope="${scope}" data-as-cond-minute="${index}" ${dis}>${minuteSelectOptions(rule.minMinute)}</select>
        <select aria-label="条件换人比分状态" data-as-scope="${scope}" data-as-cond-score="${index}" ${dis}>${SCORE_STATES.map(
          (st) => `<option value="${st}" ${(rule.scoreState ?? 'any') === st ? 'selected' : ''}>${AUTO_SUB_SCORE_LABELS[st]}</option>`,
        ).join('')}</select>
        <span class="auto-sub-arrow">${icon('swap', 13)}</span>
        <select aria-label="条件换上替补" data-as-scope="${scope}" data-as-cond-in="${index}" ${dis}>
          <option value="" ${!rule.inId ? 'selected' : ''}>自动匹配同位置替补</option>
          ${bench
            .map((b) => {
              const info = [positionLabel(b.position), b.staminaPct !== undefined ? `体力${b.staminaPct}%` : ''].filter(Boolean).join(' · ')
              return `<option value="${esc(b.playerId)}" ${rule.inId === b.playerId ? 'selected' : ''}>${esc(b.name)}${info ? ` · ${esc(info)}` : ''}</option>`
            })
            .join('')}
        </select>
        <button type="button" class="btn small ghost" data-action="auto-sub-cond-remove" data-as-scope="${scope}" data-index="${index}" aria-label="删除条件规则" ${dis}>${icon('close', 13)}</button>
      </div>`
    })
    .join('')

  const timedRows = plan.timed
    .map((rule, index) => {
      const legacyTimeAttr = scope === 'lineup' ? `data-auto-sub-time="${index}"` : ''
      const legacyOutAttr = scope === 'lineup' ? `data-auto-sub-out="${index}"` : ''
      const legacyInAttr = scope === 'lineup' ? `data-auto-sub-in="${index}"` : ''
      return `<div class="auto-sub-row" data-key="timed-${index}">
        <label>分钟 <input aria-label="定时换人时间（分钟）" type="number" min="0.1" max="89.9" step="0.1" ${legacyTimeAttr} data-as-scope="${scope}" data-as-timed-time="${index}" value="${Math.round((autoSubDisplaySeconds(rule) / 60) * 10) / 10}" ${dis}></label>
        <select aria-label="定时换下球员" ${legacyOutAttr} data-as-scope="${scope}" data-as-timed-out="${index}" ${dis}>
          <option value="">— ${scope === 'match' ? '换下场上球员' : '换下首发'} —</option>
          ${starters
            .map((s) => {
              const detail = [s.slotLabel || positionLabel(s.position), s.staminaPct !== undefined ? `体力${s.staminaPct}%` : ''].filter(Boolean).join(' · ')
              return `<option value="${esc(s.playerId)}" ${rule.outId === s.playerId ? 'selected' : ''}>${esc(s.name)}${detail ? ` · ${esc(detail)}` : ''}</option>`
            })
            .join('')}
        </select>
        <span class="auto-sub-arrow">${icon('swap', 14)}</span>
        <select aria-label="定时换上球员" ${legacyInAttr} data-as-scope="${scope}" data-as-timed-in="${index}" ${dis}>
          <option value="">— 换上替补 —</option>
          ${bench
            .map((b) => {
              const detail = [positionLabel(b.position), b.staminaPct !== undefined ? `体力${b.staminaPct}%` : ''].filter(Boolean).join(' · ')
              return `<option value="${esc(b.playerId)}" ${rule.inId === b.playerId ? 'selected' : ''}>${esc(b.name)}${detail ? ` · ${esc(detail)}` : ''}</option>`
            })
            .join('')}
        </select>
        <button type="button" class="btn small ghost" data-action="auto-sub-remove" data-as-scope="${scope}" data-index="${index}" aria-label="删除这条规则" ${dis}>${icon('close', 13)}</button>
      </div>`
    })
    .join('')

  return `<div class="auto-sub-editor" data-as-root="${scope}">
    <div class="auto-sub-rules">
      <label class="field-inline" for="${staminaId}"><span>全局体力低于</span><select id="${staminaId}" class="compact" data-as-scope="${scope}" data-as-field="staminaBelow" ${dis}><option value="">关闭</option>${Array.from({ length: 99 }, (_, i) => i + 1)
        .map((value) => `<option value="${value}" ${plan.staminaBelow === value ? 'selected' : ''}>${value}%</option>`)
        .join('')}</select></label>
      <label class="field-inline"><span>最早触发</span><select class="compact" aria-label="全局体力最早触发分钟" data-as-scope="${scope}" data-as-field="staminaMinMinute" ${dis}>${minuteSelectOptions(plan.staminaMinMinute)}</select></label>
      <label class="field-inline"><span>替补挑选</span><select class="compact" aria-label="自动换人替补挑选策略" data-as-scope="${scope}" data-as-field="preferBy" ${dis}>${PREFER_MODES.map(
        (mode) => `<option value="${mode}" ${(plan.preferBy ?? 'proficiency') === mode ? 'selected' : ''}>${AUTO_SUB_PREFER_LABELS[mode]}</option>`,
      ).join('')}</select></label>
      <label class="field-inline check-field" for="${injuryId}"><input type="checkbox" id="${injuryId}" data-as-scope="${scope}" data-as-field="onInjury" ${plan.onInjury ? 'checked' : ''} ${dis}><span>受伤自动换人</span></label>
    </div>
    <div class="auto-sub-pos-bar">
      <span class="pos-bar-label">体力换人位置：</span>
      <div class="pos-chip-group" role="group" aria-label="全局体力换人生效位置">${posChips}</div>
      <div class="pos-quick">
        <button type="button" class="btn small ghost" data-action="auto-sub-pos-preset" data-as-scope="${scope}" data-preset="all" ${dis}>全位置</button>
        <button type="button" class="btn small ghost" data-action="auto-sub-pos-preset" data-as-scope="${scope}" data-preset="front" ${dis}>仅中前场</button>
      </div>
    </div>
    <div class="auto-sub-section-bar">
      <span class="muted small">精细规则：按「受伤 → 定时 → 条件规则 → 全局体力」优先级依次检查（共用 ${MAX_SUBS} 次换人名额）</span>
      <div class="btn-row compact">
        <button type="button" class="btn small" data-action="auto-sub-cond-add" data-as-scope="${scope}" ${disabled || condRules.length >= MAX_SUBS ? 'disabled' : ''}>${icon('plus', 13)}条件换人</button>
        <button type="button" class="btn small" data-action="auto-sub-add" data-as-scope="${scope}" ${disabled || plan.timed.length >= MAX_SUBS ? 'disabled' : ''}>${icon('plus', 13)}定时换人</button>
      </div>
    </div>
    ${condRows ? `<div class="auto-sub-cond-list">${condRows}</div>` : ''}
    ${timedRows ? `<div class="auto-sub-timed-list">${timedRows}</div>` : ''}
  </div>`
}

/** 处理自动换人编辑器的点击动作；若命中返回对应的 scope，否则返回 null。 */
export function applyAutoSubAction(
  action: string,
  actionEl: HTMLElement,
  getDraft: (scope: AutoSubScope) => AutoSubPlan | null,
): AutoSubScope | null {
  const scope = (actionEl.dataset.asScope === 'match' ? 'match' : 'lineup') as AutoSubScope
  switch (action) {
    case 'auto-sub-add': {
      const plan = getDraft(scope)
      if (!plan || plan.timed.length >= MAX_SUBS) return null
      plan.timed.push({ atMinute: 60, outId: '', inId: '' })
      return scope
    }
    case 'auto-sub-remove': {
      const plan = getDraft(scope)
      if (!plan) return null
      plan.timed.splice(Number(actionEl.dataset.index), 1)
      return scope
    }
    case 'auto-sub-cond-add': {
      const plan = getDraft(scope)
      if (!plan) return null
      const list = (plan.conditionRules ??= [])
      if (list.length >= MAX_SUBS) return null
      list.push({ targetKind: 'position', targetValue: 'ST', staminaBelow: 65, minMinute: 60, scoreState: 'any' })
      return scope
    }
    case 'auto-sub-cond-remove': {
      const plan = getDraft(scope)
      if (!plan?.conditionRules) return null
      plan.conditionRules.splice(Number(actionEl.dataset.index), 1)
      if (plan.conditionRules.length === 0) delete plan.conditionRules
      return scope
    }
    case 'auto-sub-pos-toggle': {
      const plan = getDraft(scope)
      const pos = actionEl.dataset.pos as Position | undefined
      if (!plan || !pos || !(POSITIONS as readonly string[]).includes(pos)) return null
      const set = new Set<Position>(plan.staminaPositions ?? POSITIONS)
      if (set.has(pos)) set.delete(pos)
      else set.add(pos)
      if (set.size === POSITIONS.length) delete plan.staminaPositions
      else plan.staminaPositions = POSITIONS.filter((p) => set.has(p))
      return scope
    }
    case 'auto-sub-pos-preset': {
      const plan = getDraft(scope)
      if (!plan) return null
      const preset = actionEl.dataset.preset
      if (preset === 'all') delete plan.staminaPositions
      else if (preset === 'front') plan.staminaPositions = ['W', 'CM', 'ST']
      return scope
    }
    default:
      return null
  }
}

/** 处理自动换人编辑器的表单变更；若命中返回对应的 scope，否则返回 null。 */
export function applyAutoSubFieldChange(
  target: HTMLSelectElement | HTMLInputElement,
  getDraft: (scope: AutoSubScope) => AutoSubPlan | null,
): AutoSubScope | null {
  const rawScope = target.dataset.asScope
  const isLegacyLineup =
    !rawScope
    && (target.id === 'auto-sub-stamina'
      || target.id === 'auto-sub-injury'
      || target.dataset.autoSubTime !== undefined
      || target.dataset.autoSubOut !== undefined
      || target.dataset.autoSubIn !== undefined)
  if (!rawScope && !isLegacyLineup) return null
  const scope: AutoSubScope = rawScope === 'match' ? 'match' : 'lineup'
  const plan = getDraft(scope)
  if (!plan) return null

  const field = target.dataset.asField
  if (field === 'staminaBelow' || target.id === 'auto-sub-stamina') {
    plan.staminaBelow = target.value ? Number(target.value) : null
    return scope
  }
  if (field === 'onInjury' || target.id === 'auto-sub-injury') {
    plan.onInjury = (target as HTMLInputElement).checked
    return scope
  }
  if (field === 'staminaMinMinute') {
    const val = Number(target.value)
    if (!val || val <= 0) delete plan.staminaMinMinute
    else plan.staminaMinMinute = val
    return scope
  }
  if (field === 'preferBy') {
    const val = target.value as AutoSubPreferBy
    if (!val || val === 'proficiency') delete plan.preferBy
    else plan.preferBy = val
    return scope
  }

  const tTime = target.dataset.asTimedTime ?? target.dataset.autoSubTime
  const tOut = target.dataset.asTimedOut ?? target.dataset.autoSubOut
  const tIn = target.dataset.asTimedIn ?? target.dataset.autoSubIn
  if (tTime !== undefined || tOut !== undefined || tIn !== undefined) {
    const index = Number(tTime ?? tOut ?? tIn)
    const rule = plan.timed[index]
    if (rule) {
      if (tTime !== undefined) {
        rule.atMinute = Math.round(Number(target.value) * 10) / 10
        delete rule.atSeconds
      }
      if (tOut !== undefined) rule.outId = target.value
      if (tIn !== undefined) rule.inId = target.value
    }
    return scope
  }

  const cTarget = target.dataset.asCondTarget
  const cStamina = target.dataset.asCondStamina
  const cMin = target.dataset.asCondMinute
  const cScore = target.dataset.asCondScore
  const cIn = target.dataset.asCondIn
  if (cTarget !== undefined || cStamina !== undefined || cMin !== undefined || cScore !== undefined || cIn !== undefined) {
    const index = Number(cTarget ?? cStamina ?? cMin ?? cScore ?? cIn)
    const rule = plan.conditionRules?.[index]
    if (rule) {
      if (cTarget !== undefined) {
        const decoded = decodeConditionTarget(target.value)
        rule.targetKind = decoded.targetKind
        if (decoded.targetValue) rule.targetValue = decoded.targetValue
        else delete rule.targetValue
      }
      if (cStamina !== undefined) {
        rule.staminaBelow = Math.max(1, Math.min(99, Math.round(Number(target.value) || 65)))
      }
      if (cMin !== undefined) {
        const v = Number(target.value)
        if (!v || v <= 0) delete rule.minMinute
        else rule.minMinute = v
      }
      if (cScore !== undefined) {
        const v = target.value as AutoSubScoreState
        if (!v || v === 'any') delete rule.scoreState
        else rule.scoreState = v
      }
      if (cIn !== undefined) {
        if (!target.value) delete rule.inId
        else rule.inId = target.value
      }
    }
    return scope
  }

  return null
}
