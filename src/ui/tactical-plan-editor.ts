/**
 * FM 式多战术槽（主战术 + 备选战术槽 A/B/C）与自定义条件比赛计划（Match Plans）可视化编辑器。
 * 遵循与 auto-sub-editor.ts 一致的无状态渲染 + 委托事件绑定模式。
 */
import type { Lineup, MatchMentality, Player } from '../game/types.ts'
import { FORMATIONS } from '../game/data/formations.ts'
import { MATCH_PLAN_GROUPS, MATCH_PLANS, isMatchPlanId } from '../game/pes/match-plan.ts'
import {
  BACKUP_TACTIC_TEMPLATES,
  MAX_BACKUP_TACTICS,
  MAX_MATCH_PLAN_RULES,
  RED_CARD_COND_OPTIONS,
  SCORE_COND_OPTIONS,
  SUB_IN_OPTIONS,
  SUB_OUT_OPTIONS,
  backupTacticFromLineup,
  createFMClassicBundle,
  nextBackupTacticId,
  nextMatchPlanRuleId,
  rulesFromBuiltInMatchPlan,
  sanitizeMatchPlanRules,
  type BackupTactic,
  type MatchPlanInstructionPatch,
  type MatchPlanRedCardCond,
  type MatchPlanRule,
  type MatchPlanScoreCond,
  type MatchPlanSubTargetIn,
  type MatchPlanSubTargetOut,
} from '../game/pes/tactical-plan.ts'
import { STYLES_REV3, inferStyleForInstructions } from '../game/pes/tactics.ts'
import { MATCH_MENTALITY_LABELS } from '../game/match/management.ts'
import { esc, positionLabel, shortName } from './format.ts'
import { icon } from './icons.ts'
import { panel, primaryPosition, tag } from './components.ts'
import { tipAttrs } from './tooltip.ts'

const MIN_MINUTE_OPTIONS = [0, 15, 25, 30, 45, 55, 60, 65, 70, 75, 80, 85] as const
const MAX_MINUTE_OPTIONS = [15, 25, 30, 45, 60, 70, 75, 80, 85, 90] as const
const AVG_STAMINA_OPTIONS = [65, 60, 55, 50, 45, 40, 35] as const

const PATCH_FIELDS: readonly {
  key: keyof MatchPlanInstructionPatch
  label: string
  options: readonly { value: string; label: string }[]
}[] = [
  { key: 'line', label: '后防线', options: [{ value: 'low', label: '低位' }, { value: 'mid', label: '中位' }, { value: 'high', label: '高位' }] },
  { key: 'engagement', label: '逼抢线', options: [{ value: 'low', label: '低' }, { value: 'mid', label: '中' }, { value: 'high', label: '高' }] },
  { key: 'intensity', label: '压迫频率', options: [{ value: 'low', label: '低' }, { value: 'mid', label: '中' }, { value: 'high', label: '高' }] },
  { key: 'tempo', label: '比赛节奏', options: [{ value: 'slow', label: '慢' }, { value: 'normal', label: '正常' }, { value: 'fast', label: '快' }] },
  { key: 'passing', label: '传球倾向', options: [{ value: 'short', label: '短传' }, { value: 'mixed', label: '混合' }, { value: 'direct', label: '直接' }] },
  { key: 'focus', label: '进攻方向', options: [{ value: 'middle', label: '中路' }, { value: 'balanced', label: '均衡' }, { value: 'wing', label: '边路' }] },
  { key: 'width', label: '持球宽度', options: [{ value: 'narrow', label: '窄' }, { value: 'normal', label: '正常' }, { value: 'wide', label: '宽' }] },
  { key: 'defWidth', label: '防守宽度', options: [{ value: 'narrow', label: '收缩' }, { value: 'normal', label: '正常' }, { value: 'wide', label: '拉开' }] },
  { key: 'onGain', label: '得球后', options: [{ value: 'hold', label: '保阵型' }, { value: 'balanced', label: '均衡' }, { value: 'counter', label: '快反' }] },
  { key: 'onLoss', label: '丢球后', options: [{ value: 'regroup', label: '回撤' }, { value: 'balanced', label: '均衡' }, { value: 'counterpress', label: '反抢' }] },
  { key: 'receiving', label: '接球偏好', options: [{ value: 'feet', label: '接脚下' }, { value: 'mixed', label: '混合' }, { value: 'space', label: '跑空当' }] },
  { key: 'crossTiming', label: '传中时机', options: [{ value: 'balanced', label: '正常' }, { value: 'early', label: '尽早传中' }] },
]

function mentalityTone(m: MatchMentality): string {
  return m === 'attack' ? 'warn' : m === 'defend' ? 'good' : ''
}

function slotStyleLabel(slot: BackupTactic): string {
  const info = inferStyleForInstructions(slot.tacticalInstructions, slot.tacticalStyle)
  return `${STYLES_REV3[info.styleId].name}${info.adjusted ? '·调' : ''}`
}

function mainStyleLabel(draft: Lineup): string {
  if (!draft.tacticalInstructions) return '基础五项'
  const info = inferStyleForInstructions(draft.tacticalInstructions, draft.tacticalStyle)
  return `${STYLES_REV3[info.styleId].name}${info.adjusted ? '·已调' : ''}`
}

function slotCardHtml(slot: BackupTactic, index: number, disabled: boolean): string {
  const dis = disabled ? 'disabled' : ''
  const letter = ['A', 'B', 'C'][index] ?? String(index + 2)
  const customCount = Object.keys(slot.customPositions ?? {}).length
  return `<div class="fm-slot-card" data-key="${esc(slot.id)}">
    <div class="fm-slot-head">
      <span class="tag gold">备选 ${letter}</span>
      <b class="fm-slot-name" title="${esc(slot.name)}">${esc(slot.name)}</b>
      <span class="tag">${esc(slot.formationId)}</span>
    </div>
    <div class="fm-slot-meta">
      <select class="compact fm-slot-mentality" data-fm-slot-mentality="${esc(slot.id)}" aria-label="${esc(slot.name)}心态" ${dis}>
        <option value="attack" ${slot.mentality === 'attack' ? 'selected' : ''}>全体进攻</option>
        <option value="balanced" ${slot.mentality === 'balanced' ? 'selected' : ''}>均衡</option>
        <option value="defend" ${slot.mentality === 'defend' ? 'selected' : ''}>全体防守</option>
      </select>
      <span class="muted small">${esc(slotStyleLabel(slot))}${customCount ? ` · ${customCount}处摆位` : ''}</span>
    </div>
    <div class="fm-slot-actions">
      <button type="button" class="btn small ghost" data-fm-slot-capture="${esc(slot.id)}" title="用当前战术板的阵型、摆位、职责和十二项指令覆写此备选槽" ${dis}>从战术板覆写</button>
      <button type="button" class="btn small ghost" data-fm-slot-load="${esc(slot.id)}" title="载入到上方战术板可视化调整阵型和站位" ${dis}>载入编辑</button>
      <button type="button" class="btn small ghost" data-fm-slot-rename="${esc(slot.id)}" ${dis}>改名</button>
      <button type="button" class="btn small ghost danger" data-fm-slot-delete="${esc(slot.id)}" ${dis}>删除</button>
    </div>
  </div>`
}

function minuteOptions(choices: readonly number[], current: number): string {
  const list = choices.includes(current) ? [...choices] : [...choices, current].sort((a, b) => a - b)
  return list.map((m) => `<option value="${m}" ${m === current ? 'selected' : ''}>${m}′</option>`).join('')
}

function ruleCardHtml(
  rule: MatchPlanRule,
  index: number,
  total: number,
  draft: Lineup,
  roster: Player[],
  disabled: boolean,
): string {
  const dis = disabled ? 'disabled' : ''
  const backups = draft.backupTactics ?? []
  const minM = rule.condition.minMinute ?? 0
  const maxM = rule.condition.maxMinute ?? 90
  const scoreCond = rule.condition.score ?? 'any'
  const redCond = rule.condition.redCard ?? 'any'
  const stamBelow = rule.condition.avgStaminaBelow ?? 0

  const slotVal = rule.action.tacticSlotId ?? ''
  const mentalityVal = rule.action.mentality ?? ''
  const sub = rule.action.linkedSub
  const patch = rule.action.instructionPatch ?? {}
  const patchCount = Object.values(patch).filter((v) => v !== undefined).length

  const playerOf = (id: string) => roster.find((p) => p.id === id)
  const formation = FORMATIONS[draft.formationId]
  const starterOpts = draft.starters
    .map((s) => {
      const p = playerOf(s.playerId)
      if (!p) return ''
      const fSlot = formation?.slots.find((item) => item.id === s.slotId)
      return `<option value="${esc(p.id)}" ${sub?.outPlayerId === p.id ? 'selected' : ''}>${esc(shortName(p.name))} (${esc(fSlot?.label ?? positionLabel(primaryPosition(p)))})</option>`
    })
    .join('')
  const benchOpts = draft.bench
    .map((id) => {
      const p = playerOf(id)
      if (!p) return ''
      return `<option value="${esc(p.id)}" ${sub?.inPlayerId === p.id ? 'selected' : ''}>${esc(shortName(p.name))} (${esc(positionLabel(primaryPosition(p)))})</option>`
    })
    .join('')

  return `<div class="fm-rule-card ${rule.enabled ? '' : 'is-disabled'}" data-key="${esc(rule.id)}">
    <div class="fm-rule-head">
      <span class="fm-rule-rank">#${index + 1}</span>
      <label class="fm-check" title="启用/暂停此规则">
        <input type="checkbox" data-fm-rule-enabled="${index}" ${rule.enabled ? 'checked' : ''} ${dis} />
      </label>
      <input class="compact fm-rule-name" type="text" maxlength="28" value="${esc(rule.name)}" data-fm-rule-name="${index}" aria-label="规则名称" placeholder="给规则起个名字" ${dis} />
      <label class="fm-check fm-once-check" ${tipAttrs('单场仅触发一次', '勾选后：本规则触发后即锁定为后续基准（不会因条件解除自动切回主战术），且本场不再重复触发；不勾选则在条件不再满足时自动切回主战术或其他命中规则。')}>
        <input type="checkbox" data-fm-rule-once="${index}" ${rule.once ? 'checked' : ''} ${dis} />
        <span>仅一次</span>
      </label>
      <div class="fm-rule-ops">
        <button type="button" class="btn small ghost" data-fm-rule-up="${index}" title="提高优先级" ${disabled || index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="btn small ghost" data-fm-rule-down="${index}" title="降低优先级" ${disabled || index === total - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="btn small ghost danger" data-fm-rule-del="${index}" title="删除规则" ${dis}>×</button>
      </div>
    </div>

    <div class="fm-rule-row">
      <span class="fm-rule-tag cond">如果</span>
      <div class="fm-rule-fields">
        <label class="fm-inline">
          <span>时间</span>
          <select class="compact" data-fm-rule-min="${index}" aria-label="起始分钟" ${dis}>${minuteOptions(MIN_MINUTE_OPTIONS, minM)}</select>
          <span>–</span>
          <select class="compact" data-fm-rule-max="${index}" aria-label="结束分钟" ${dis}>${minuteOptions(MAX_MINUTE_OPTIONS, maxM)}</select>
        </label>
        <select class="compact" data-fm-rule-score="${index}" aria-label="比分条件" ${dis}>
          ${SCORE_COND_OPTIONS.map((o) => `<option value="${o.value}" ${o.value === scoreCond ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>
        <select class="compact" data-fm-rule-red="${index}" aria-label="红牌人数条件" ${dis}>
          ${RED_CARD_COND_OPTIONS.map((o) => `<option value="${o.value}" ${o.value === redCond ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>
        <select class="compact" data-fm-rule-stamina="${index}" aria-label="全队平均体能条件" ${dis}>
          <option value="0" ${stamBelow === 0 ? 'selected' : ''}>不限体能</option>
          ${AVG_STAMINA_OPTIONS.map((v) => `<option value="${v}" ${stamBelow === v ? 'selected' : ''}>平均体能 &lt; ${v}%</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="fm-rule-row">
      <span class="fm-rule-tag act">就执行</span>
      <div class="fm-rule-fields">
        <select class="compact fm-slot-select" data-fm-rule-slot="${index}" aria-label="切换战术槽" ${dis}>
          <option value="" ${slotVal === '' ? 'selected' : ''}>保持当前阵型（仅调指令/心态）</option>
          <option value="base" ${slotVal === 'base' ? 'selected' : ''}>恢复主战术 (${esc(draft.formationId)})</option>
          ${backups.map((b, bIdx) => `<option value="${esc(b.id)}" ${slotVal === b.id ? 'selected' : ''}>变阵 · 备选${['A', 'B', 'C'][bIdx] ?? bIdx + 2} ${esc(b.name)} (${esc(b.formationId)})</option>`).join('')}
        </select>
        <select class="compact" data-fm-rule-mentality="${index}" aria-label="心态调整" ${dis}>
          <option value="" ${mentalityVal === '' ? 'selected' : ''}>心态跟随槽位</option>
          <option value="attack" ${mentalityVal === 'attack' ? 'selected' : ''}>${MATCH_MENTALITY_LABELS.attack}</option>
          <option value="balanced" ${mentalityVal === 'balanced' ? 'selected' : ''}>${MATCH_MENTALITY_LABELS.balanced}</option>
          <option value="defend" ${mentalityVal === 'defend' ? 'selected' : ''}>${MATCH_MENTALITY_LABELS.defend}</option>
        </select>
      </div>
    </div>

    <div class="fm-rule-row">
      <span class="fm-rule-tag sub">联动换人</span>
      <div class="fm-rule-fields">
        <select class="compact" data-fm-rule-sub-out="${index}" aria-label="联动换下目标" ${dis}>
          <option value="" ${!sub ? 'selected' : ''}>不联动换人</option>
          ${SUB_OUT_OPTIONS.map((o) => `<option value="${o.value}" ${sub?.outKind === o.value ? 'selected' : ''}>下 · ${esc(o.label)}</option>`).join('')}
        </select>
        ${sub?.outKind === 'player'
          ? `<select class="compact" data-fm-rule-sub-out-player="${index}" aria-label="指定换下球员" ${dis}><option value="">— 选首发 —</option>${starterOpts}</select>`
          : ''}
        ${sub
          ? `<span class="muted">→</span>
             <select class="compact" data-fm-rule-sub-in="${index}" aria-label="联动换上目标" ${dis}>
               ${SUB_IN_OPTIONS.map((o) => `<option value="${o.value}" ${sub.inKind === o.value ? 'selected' : ''}>上 · ${esc(o.label)}</option>`).join('')}
             </select>
             ${sub.inKind === 'player'
               ? `<select class="compact" data-fm-rule-sub-in-player="${index}" aria-label="指定换上替补" ${dis}><option value="">— 选替补 —</option>${benchOpts}</select>`
               : ''}`
          : ''}
      </div>
    </div>

    <details class="fm-rule-adv" data-key="adv-${esc(rule.id)}">
      <summary>高级指令微调${patchCount ? ` <span class="tag gold">已覆写 ${patchCount} 项</span>` : ' <span class="muted small">（可选：在所选战术槽基础上精细覆写单项指令）</span>'}</summary>
      <div class="fm-patch-grid">
        ${PATCH_FIELDS.map((f) => {
          const cur = (patch[f.key] as string | undefined) ?? ''
          return `<label class="fm-patch-item">
            <span>${esc(f.label)}</span>
            <select class="compact" data-fm-rule-patch="${index}:${f.key}" ${dis}>
              <option value="" ${cur === '' ? 'selected' : ''}>默认</option>
              ${f.options.map((o) => `<option value="${o.value}" ${cur === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
            </select>
          </label>`
        }).join('')}
      </div>
    </details>
  </div>`
}

export function renderFmTacticalPlanPanel(options: {
  draft: Lineup
  roster: Player[]
  disabled: boolean
}): string {
  const { draft, roster, disabled } = options
  const dis = disabled ? 'disabled' : ''
  const backups = draft.backupTactics ?? []
  const rules = draft.matchPlanRules ?? []
  const enabledCount = rules.filter((r) => r.enabled).length
  const presets = draft.presets ?? []

  const aside = enabledCount > 0
    ? `${tag(`自定义生效 · ${enabledCount} 条规则`, 'good')}`
    : `<span class="muted small">当前走上方快捷计划：${esc(MATCH_PLANS[draft.matchPlan && isMatchPlanId(draft.matchPlan) ? draft.matchPlan : 'standard'].name)}</span>`

  const slotGrid = `
    <div class="fm-slots-head">
      <div>
        <h4>FM 战术槽（主战术 + 最多 ${MAX_BACKUP_TACTICS} 套备选变阵）</h4>
        <p class="hint flat">人阵解耦：备选槽保存阵型、自由摆位、职责和十二项指令，即使转会卖人也永不失效；赛中触发规则时由服务器后台与 2D 引擎同步实时变阵重排站位。</p>
      </div>
      <div class="fm-slots-add">
        <button type="button" class="btn small primary" data-fm-slot-add-current ${disabled || backups.length >= MAX_BACKUP_TACTICS ? 'disabled' : ''}>${icon('plus', 13)}存当前战术为备选槽</button>
        <div class="fm-inline-group">
          <select class="compact" data-fm-slot-tpl-select aria-label="快捷备选战术模板" ${disabled || backups.length >= MAX_BACKUP_TACTICS ? 'disabled' : ''}>
            <optgroup label="FM 经典备选模板">
              ${BACKUP_TACTIC_TEMPLATES.map((t) => `<option value="tpl:${t.id}">${esc(t.label)}</option>`).join('')}
            </optgroup>
            ${presets.length
              ? `<optgroup label="从我的预设库导入">${presets.map((p) => `<option value="preset:${esc(p.id)}">预设 · ${esc(p.name)} (${esc(p.lineup.formationId)})</option>`).join('')}</optgroup>`
              : ''}
          </select>
          <button type="button" class="btn small" data-fm-slot-add-tpl ${disabled || backups.length >= MAX_BACKUP_TACTICS ? 'disabled' : ''}>添加</button>
        </div>
      </div>
    </div>
    <div class="fm-slots-grid">
      <div class="fm-slot-card is-main">
        <div class="fm-slot-head">
          <span class="tag good">主战术</span>
          <b class="fm-slot-name">开场首发体系</b>
          <span class="tag">${esc(draft.formationId)}</span>
        </div>
        <div class="fm-slot-meta">
          <span class="tag ${mentalityTone('balanced')}">均衡起步</span>
          <span class="muted small">${esc(mainStyleLabel(draft))}${Object.keys(draft.customPositions ?? {}).length ? ` · ${Object.keys(draft.customPositions ?? {}).length}处摆位` : ''}</span>
        </div>
        <p class="hint flat">当比赛计划规则条件解除时，自动恢复到此主战术（含自定义摆位与职责）。</p>
      </div>
      ${backups.map((slot, idx) => slotCardHtml(slot, idx, disabled)).join('')}
    </div>
  `

  const builtinGroupsHtml = MATCH_PLAN_GROUPS
    .map((group) => {
      const plans = group.plans.filter((p) => p.id !== 'standard')
      if (!plans.length) return ''
      return `<optgroup label="${esc(group.category)}">${plans.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</optgroup>`
    })
    .join('')

  const rulesSection = `
    <div class="fm-rules-head">
      <div>
        <h4>FM 比赛计划规则（Match Plans · 最多 ${MAX_MATCH_PLAN_RULES} 条）</h4>
        <p class="hint flat">按列表从上到下优先匹配。进球、丢球或红牌立即响应，常规时间/体能切换有 3 分钟防抖冷却；变阵联动换人先换人再排新阵，与自动换人共享 5 个名额。修改后请点顶部「保存阵容」。</p>
      </div>
      <div class="fm-rules-toolbar">
        <button type="button" class="btn small primary" data-fm-apply-classic ${dis}>⚡ 一键套用 FM 经典方案</button>
        <div class="fm-inline-group">
          <select class="compact" data-fm-import-builtin-select aria-label="从官方预案展开规则" ${dis}>
            ${builtinGroupsHtml}
          </select>
          <button type="button" class="btn small" data-fm-import-builtin-btn ${dis}>展开为规则</button>
        </div>
        <button type="button" class="btn small" data-fm-rule-add ${disabled || rules.length >= MAX_MATCH_PLAN_RULES ? 'disabled' : ''}>${icon('plus', 13)}新增规则</button>
        ${rules.length ? `<button type="button" class="btn small ghost danger" data-fm-rule-clear ${dis}>清空规则</button>` : ''}
      </div>
    </div>
    ${rules.length === 0
      ? `<div class="fm-rules-empty">
          <p class="muted small">暂未配置自定义比赛计划规则（目前沿用上方「下场计划」下拉框）。点击 <b>「⚡ 一键套用 FM 经典方案」</b> 可立刻生成三战术槽 + 红牌 4-4-1 应对 + 70′领先 5-3-2 换后卫 + 60′落后 3-4-3 换前锋，随后可任意增删微调。</p>
        </div>`
      : `<div class="fm-rules-list">${rules.map((r, i) => ruleCardHtml(r, i, rules.length, draft, roster, disabled)).join('')}</div>`}
  `

  return panel('FM 战术槽 & 条件比赛计划', `<div class="fm-plan-panel">${slotGrid}<hr class="fm-sep" />${rulesSection}</div>`, { aside })
}

/* ---------- 委托事件绑定（只在 lineup 页挂载一次） ---------- */

let bound = false

export function bindFmTacticalPlanHandlers(options: {
  isActiveScreen: () => boolean
  isLocked: () => boolean
  getDraft: () => Lineup
  updateDraft: (mutator: (draft: Lineup) => void) => void
  loadBackupToBoard: (backup: BackupTactic) => void
  announce: (msg: string) => void
}): void {
  if (bound || typeof document === 'undefined') return
  bound = true

  const guardLock = (): boolean => {
    if (!options.isLocked()) return false
    options.announce('阵容已锁定：开赛前 30 分钟内不能修改战术槽与比赛计划。')
    return true
  }

  document.addEventListener('click', (event) => {
    if (!options.isActiveScreen()) return
    const target = event.target as HTMLElement
    const panelEl = target.closest('.fm-plan-panel')
    if (!panelEl) return

    if (target.closest('[data-fm-slot-add-current]')) {
      if (guardLock()) return
      const draft = options.getDraft()
      if ((draft.backupTactics?.length ?? 0) >= MAX_BACKUP_TACTICS) return
      const id = nextBackupTacticId(draft.backupTactics)
      const label = `${draft.formationId} 备选 ${['A', 'B', 'C'][(draft.backupTactics?.length ?? 0)] ?? ''}`.trim()
      options.updateDraft((d) => {
        const list = (d.backupTactics ??= [])
        list.push(backupTacticFromLineup(d, id, label, 'balanced'))
      })
      options.announce(`已将当前战术板存为备选槽「${label}」，记得保存阵容。`)
      return
    }

    if (target.closest('[data-fm-slot-add-tpl]')) {
      if (guardLock()) return
      const select = panelEl.querySelector<HTMLSelectElement>('[data-fm-slot-tpl-select]')
      const val = select?.value ?? ''
      const draft = options.getDraft()
      if ((draft.backupTactics?.length ?? 0) >= MAX_BACKUP_TACTICS) return
      const id = nextBackupTacticId(draft.backupTactics)
      if (val.startsWith('tpl:')) {
        const tplId = val.slice(4)
        const tpl = BACKUP_TACTIC_TEMPLATES.find((t) => t.id === tplId)
        if (!tpl) return
        const created = tpl.build(id)
        options.updateDraft((d) => {
          ;(d.backupTactics ??= []).push(created)
        })
        options.announce(`已添加备选战术槽「${created.name}」。`)
      } else if (val.startsWith('preset:')) {
        const presetId = val.slice(7)
        const preset = (draft.presets ?? []).find((p) => p.id === presetId)
        if (!preset) return
        const created = backupTacticFromLineup(preset.lineup, id, preset.name, 'balanced')
        options.updateDraft((d) => {
          ;(d.backupTactics ??= []).push(created)
        })
        options.announce(`已从预设「${preset.name}」导入为备选战术槽。`)
      }
      return
    }

    const capEl = target.closest<HTMLElement>('[data-fm-slot-capture]')
    if (capEl?.dataset.fmSlotCapture) {
      if (guardLock()) return
      const slotId = capEl.dataset.fmSlotCapture
      let slotName = ''
      options.updateDraft((d) => {
        const idx = (d.backupTactics ?? []).findIndex((b) => b.id === slotId)
        if (idx < 0) return
        const existing = d.backupTactics![idx]
        slotName = existing.name
        d.backupTactics![idx] = backupTacticFromLineup(d, existing.id, existing.name, existing.mentality)
      })
      if (slotName) options.announce(`已用当前战术板覆写备选槽「${slotName}」。`)
      return
    }

    const loadEl = target.closest<HTMLElement>('[data-fm-slot-load]')
    if (loadEl?.dataset.fmSlotLoad) {
      if (guardLock()) return
      const slotId = loadEl.dataset.fmSlotLoad
      const backup = (options.getDraft().backupTactics ?? []).find((b) => b.id === slotId)
      if (backup) options.loadBackupToBoard(backup)
      return
    }

    const renEl = target.closest<HTMLElement>('[data-fm-slot-rename]')
    if (renEl?.dataset.fmSlotRename) {
      if (guardLock()) return
      const slotId = renEl.dataset.fmSlotRename
      const existing = (options.getDraft().backupTactics ?? []).find((b) => b.id === slotId)
      if (!existing) return
      const name = window.prompt('输入新的备选战术名称（最多 24 字）', existing.name)
      if (name === null) return
      const trimmed = name.trim()
      if (!trimmed || [...trimmed].length > 24) {
        options.announce('备选战术名称不能为空且最多 24 字')
        return
      }
      options.updateDraft((d) => {
        const slot = (d.backupTactics ?? []).find((b) => b.id === slotId)
        if (slot) slot.name = trimmed
      })
      return
    }

    const delSlotEl = target.closest<HTMLElement>('[data-fm-slot-delete]')
    if (delSlotEl?.dataset.fmSlotDelete) {
      if (guardLock()) return
      const slotId = delSlotEl.dataset.fmSlotDelete
      options.updateDraft((d) => {
        d.backupTactics = (d.backupTactics ?? []).filter((b) => b.id !== slotId)
        if (!d.backupTactics.length) delete d.backupTactics
        if (d.matchPlanRules?.length) {
          d.matchPlanRules = sanitizeMatchPlanRules(d.matchPlanRules, d.backupTactics)
        }
      })
      return
    }

    if (target.closest('[data-fm-apply-classic]')) {
      if (guardLock()) return
      const draft = options.getDraft()
      const bundle = createFMClassicBundle(draft.formationId)
      options.updateDraft((d) => {
        d.backupTactics = bundle.backupTactics
        d.matchPlanRules = bundle.matchPlanRules
      })
      options.announce('已一键部署 FM 经典三槽与 4 条智能比赛计划规则，点击顶部「保存阵容」生效。')
      return
    }

    if (target.closest('[data-fm-import-builtin-btn]')) {
      if (guardLock()) return
      const select = panelEl.querySelector<HTMLSelectElement>('[data-fm-import-builtin-select]')
      const planId = select?.value
      if (!planId || !isMatchPlanId(planId) || planId === 'standard') return
      const expanded = rulesFromBuiltInMatchPlan(planId)
      options.updateDraft((d) => {
        d.matchPlanRules = expanded
      })
      options.announce(`已将官方预案「${MATCH_PLANS[planId].name}」展开为 ${expanded.length} 条可编辑规则，点击顶部「保存阵容」生效。`)
      return
    }

    if (target.closest('[data-fm-rule-add]')) {
      if (guardLock()) return
      const draft = options.getDraft()
      if ((draft.matchPlanRules?.length ?? 0) >= MAX_MATCH_PLAN_RULES) return
      const id = nextMatchPlanRuleId(draft.matchPlanRules)
      const firstBackup = draft.backupTactics?.[0]
      options.updateDraft((d) => {
        ;(d.matchPlanRules ??= []).push({
          id,
          name: `自定义预案 #${(d.matchPlanRules?.length ?? 0) + 1}`,
          enabled: true,
          condition: { minMinute: 65, maxMinute: 90, score: 'leading', redCard: 'any' },
          action: {
            ...(firstBackup ? { tacticSlotId: firstBackup.id } : {}),
            mentality: firstBackup?.mentality ?? 'defend',
          },
        })
      })
      return
    }

    if (target.closest('[data-fm-rule-clear]')) {
      if (guardLock()) return
      options.updateDraft((d) => {
        delete d.matchPlanRules
      })
      options.announce('已清空自定义比赛计划规则（将恢复使用上方快捷计划）。')
      return
    }

    const upEl = target.closest<HTMLElement>('[data-fm-rule-up]')
    if (upEl?.dataset.fmRuleUp !== undefined) {
      if (guardLock()) return
      const idx = Number(upEl.dataset.fmRuleUp)
      options.updateDraft((d) => {
        const list = d.matchPlanRules
        if (!list || idx <= 0 || idx >= list.length) return
        ;[list[idx - 1], list[idx]] = [list[idx], list[idx - 1]]
      })
      return
    }

    const downEl = target.closest<HTMLElement>('[data-fm-rule-down]')
    if (downEl?.dataset.fmRuleDown !== undefined) {
      if (guardLock()) return
      const idx = Number(downEl.dataset.fmRuleDown)
      options.updateDraft((d) => {
        const list = d.matchPlanRules
        if (!list || idx < 0 || idx >= list.length - 1) return
        ;[list[idx], list[idx + 1]] = [list[idx + 1], list[idx]]
      })
      return
    }

    const delRuleEl = target.closest<HTMLElement>('[data-fm-rule-del]')
    if (delRuleEl?.dataset.fmRuleDel !== undefined) {
      if (guardLock()) return
      const idx = Number(delRuleEl.dataset.fmRuleDel)
      options.updateDraft((d) => {
        if (!d.matchPlanRules) return
        d.matchPlanRules.splice(idx, 1)
        if (!d.matchPlanRules.length) delete d.matchPlanRules
      })
      return
    }
  })

  document.addEventListener('change', (event) => {
    if (!options.isActiveScreen()) return
    const target = event.target as HTMLInputElement | HTMLSelectElement
    if (!target.closest?.('.fm-plan-panel')) return
    if (guardLock()) return

    if (target.dataset.fmSlotMentality) {
      const slotId = target.dataset.fmSlotMentality
      const val = target.value as MatchMentality
      options.updateDraft((d) => {
        const slot = (d.backupTactics ?? []).find((b) => b.id === slotId)
        if (slot && (val === 'attack' || val === 'balanced' || val === 'defend')) slot.mentality = val
      })
      return
    }

    if (target.dataset.fmRuleEnabled !== undefined) {
      const idx = Number(target.dataset.fmRuleEnabled)
      const checked = (target as HTMLInputElement).checked
      options.updateDraft((d) => {
        const rule = d.matchPlanRules?.[idx]
        if (rule) rule.enabled = checked
      })
      return
    }

    if (target.dataset.fmRuleOnce !== undefined) {
      const idx = Number(target.dataset.fmRuleOnce)
      const checked = (target as HTMLInputElement).checked
      options.updateDraft((d) => {
        const rule = d.matchPlanRules?.[idx]
        if (!rule) return
        if (checked) rule.once = true
        else delete rule.once
      })
      return
    }

    if (target.dataset.fmRuleName !== undefined) {
      const idx = Number(target.dataset.fmRuleName)
      const val = target.value.trim() || `自定义预案 #${idx + 1}`
      options.updateDraft((d) => {
        const rule = d.matchPlanRules?.[idx]
        if (rule) rule.name = val
      })
      return
    }

    if (target.dataset.fmRuleMin !== undefined) {
      const idx = Number(target.dataset.fmRuleMin)
      const val = Number(target.value)
      options.updateDraft((d) => {
        const rule = d.matchPlanRules?.[idx]
        if (!rule) return
        rule.condition.minMinute = val
        const curMax = rule.condition.maxMinute ?? 90
        if (curMax <= val) rule.condition.maxMinute = Math.min(90, val + 5)
      })
      return
    }

    if (target.dataset.fmRuleMax !== undefined) {
      const idx = Number(target.dataset.fmRuleMax)
      const val = Number(target.value)
      options.updateDraft((d) => {
        const rule = d.matchPlanRules?.[idx]
        if (!rule) return
        rule.condition.maxMinute = val
        const curMin = rule.condition.minMinute ?? 0
        if (curMin >= val) rule.condition.minMinute = Math.max(0, val - 5)
      })
      return
    }

    if (target.dataset.fmRuleScore !== undefined) {
      const idx = Number(target.dataset.fmRuleScore)
      const val = target.value as MatchPlanScoreCond
      options.updateDraft((d) => {
        const rule = d.matchPlanRules?.[idx]
        if (rule) rule.condition.score = val
      })
      return
    }

    if (target.dataset.fmRuleRed !== undefined) {
      const idx = Number(target.dataset.fmRuleRed)
      const val = target.value as MatchPlanRedCardCond
      options.updateDraft((d) => {
        const rule = d.matchPlanRules?.[idx]
        if (rule) rule.condition.redCard = val
      })
      return
    }

    if (target.dataset.fmRuleStamina !== undefined) {
      const idx = Number(target.dataset.fmRuleStamina)
      const val = Number(target.value)
      options.updateDraft((d) => {
        const rule = d.matchPlanRules?.[idx]
        if (!rule) return
        if (val > 0) rule.condition.avgStaminaBelow = val
        else delete rule.condition.avgStaminaBelow
      })
      return
    }

    if (target.dataset.fmRuleSlot !== undefined) {
      const idx = Number(target.dataset.fmRuleSlot)
      const val = target.value
      options.updateDraft((d) => {
        const rule = d.matchPlanRules?.[idx]
        if (!rule) return
        if (val) rule.action.tacticSlotId = val
        else delete rule.action.tacticSlotId
      })
      return
    }

    if (target.dataset.fmRuleMentality !== undefined) {
      const idx = Number(target.dataset.fmRuleMentality)
      const val = target.value as MatchMentality | ''
      options.updateDraft((d) => {
        const rule = d.matchPlanRules?.[idx]
        if (!rule) return
        if (val) rule.action.mentality = val
        else delete rule.action.mentality
      })
      return
    }

    if (target.dataset.fmRuleSubOut !== undefined) {
      const idx = Number(target.dataset.fmRuleSubOut)
      const val = target.value as MatchPlanSubTargetOut | ''
      options.updateDraft((d) => {
        const rule = d.matchPlanRules?.[idx]
        if (!rule) return
        if (!val) {
          delete rule.action.linkedSub
        } else {
          rule.action.linkedSub = {
            outKind: val,
            inKind: rule.action.linkedSub?.inKind ?? 'best_fit',
            ...(val === 'player' && rule.action.linkedSub?.outPlayerId ? { outPlayerId: rule.action.linkedSub.outPlayerId } : {}),
            ...(rule.action.linkedSub?.inKind === 'player' && rule.action.linkedSub?.inPlayerId ? { inPlayerId: rule.action.linkedSub.inPlayerId } : {}),
          }
        }
      })
      return
    }

    if (target.dataset.fmRuleSubOutPlayer !== undefined) {
      const idx = Number(target.dataset.fmRuleSubOutPlayer)
      const val = target.value
      options.updateDraft((d) => {
        const sub = d.matchPlanRules?.[idx]?.action.linkedSub
        if (!sub) return
        if (val) sub.outPlayerId = val
        else delete sub.outPlayerId
      })
      return
    }

    if (target.dataset.fmRuleSubIn !== undefined) {
      const idx = Number(target.dataset.fmRuleSubIn)
      const val = target.value as MatchPlanSubTargetIn
      options.updateDraft((d) => {
        const sub = d.matchPlanRules?.[idx]?.action.linkedSub
        if (!sub) return
        sub.inKind = val
        if (val !== 'player') delete sub.inPlayerId
      })
      return
    }

    if (target.dataset.fmRuleSubInPlayer !== undefined) {
      const idx = Number(target.dataset.fmRuleSubInPlayer)
      const val = target.value
      options.updateDraft((d) => {
        const sub = d.matchPlanRules?.[idx]?.action.linkedSub
        if (!sub) return
        if (val) sub.inPlayerId = val
        else delete sub.inPlayerId
      })
      return
    }

    if (target.dataset.fmRulePatch) {
      const [idxStr, fieldKey] = target.dataset.fmRulePatch.split(':')
      const idx = Number(idxStr)
      const key = fieldKey as keyof MatchPlanInstructionPatch
      const val = target.value
      options.updateDraft((d) => {
        const rule = d.matchPlanRules?.[idx]
        if (!rule) return
        const patch = (rule.action.instructionPatch ??= {})
        if (val) (patch as Record<string, string>)[key] = val
        else delete (patch as Record<string, string | undefined>)[key]
        if (!Object.keys(patch).length) delete rule.action.instructionPatch
      })
    }
  })
}
