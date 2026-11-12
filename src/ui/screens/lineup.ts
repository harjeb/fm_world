import type { Lineup, Player, Position, RoleId } from '../../game/types.ts'
import { playerCards } from '../../game/cards.ts'
import { setLineup } from '../../game/actions.ts'
import { FORMATIONS, FORMATION_LIST, type FormationDef, type FormationSlot } from '../../game/data/formations.ts'
import { ROLES, ROLES_BY_POSITION, roleFit } from '../../game/data/roles.ts'
import { PLAYABLE_PROFICIENCY, positionMultiplier } from '../../game/ca.ts'
import { formOf, recentAnalysis, squadForm, type PlayerForm } from '../../game/form.ts'
import { injuryUntil } from '../../game/injury.ts'
import { emptyAutoSubs, validateAutoSubPlan } from '../../game/match/management.ts'
import { LINEUP_LOCK_MS, PLAYER_TEAM_ID, lineupLockState, matchdayCountdown, playerFixture, teamName } from '../../game/season.ts'
import { isOnlineMode } from '../../online.ts'
import {
  BENCH_SIZE,
  MAX_SUBS,
  applyTacticPreset,
  bestRoleForPlayer,
  clearSlotPositions,
  computeLineupFamiliarity,
  deleteTacticPreset,
  findTacticPreset,
  presetNameError,
  renameTacticPreset,
  saveTacticPreset,
  setSlotPosition,
  slotPosition,
  validateLineup,
  type LineupTarget,
} from '../../game/squad.ts'
import {
  INSTRUCTION_GROUPS,
  STYLE_LIST_REV3,
  STYLE_META,
  STYLES_REV3,
  getInstructionField,
  inferStyleForInstructions,
  instructionsFromLegacyTactics,
  type InstructionFieldDef,
  type TacticalInstructionsV2,
} from '../../game/pes/tactics.ts'
import { MATCH_PLANS, MATCH_PLAN_GROUPS, isMatchPlanId, type MatchPlanId } from '../../game/pes/match-plan.ts'
import { worldDivisionLabel } from '../../game/world.ts'
import { RATING_STOPS, boardMarkings, boardSpot, boardSpotFromPercent, caHeat, cardSelect, clampSpot, clubLook, fitHeat, formBars, heatLegend, icon, injuryLabel, inkOn, meter, pageHead, panel, pick, posBadge, primaryPosition, tag } from '../components.ts'
import { esc, lineupStyleLabel, pct, playerCA, positionLabel, shortName } from '../format.ts'
import { morph } from '../morph.ts'
import { renderAutoSubEditor } from '../auto-sub-editor.ts'
import { game, ui } from '../state.ts'
import { chemistryKey } from '../../game/chemistry.ts'
import { selectChemistryLinks } from '../chemistry-links.ts'
import { tipAttrs } from '../tooltip.ts'
import { serverNow } from '../../online.ts'

const BENCH_SLOTS = BENCH_SIZE
const benchSlotId = (index: number) => `bench-${index}`
const benchIndexOf = (slotId: string) => (slotId.startsWith('bench-') ? Number(slotId.slice(6)) : -1)

/** 下拉框和拖放目标共用的“去处”编码。 */
const slotTarget = (slotId: string) => `slot:${slotId}`
const benchTarget = (index: number) => `bench:${index}`

export function parseLineupTarget(value: string): LineupTarget | null {
  if (value === 'reserve') return 'reserve'
  if (value.startsWith('slot:')) return { slotId: value.slice(5) }
  if (value.startsWith('bench:')) return { benchIndex: Number(value.slice(6)) }
  return null
}

/** 选中的位置 → 给这个位置选人时的落点。 */
export function selectedSlotTarget(slotId: string): LineupTarget {
  const index = benchIndexOf(slotId)
  return index >= 0 ? { benchIndex: index } : { slotId }
}

function playerOf(id: string | undefined): Player | undefined {
  return id ? game.roster.find((player) => player.id === id) : undefined
}

function effectiveFit(player: Player, role: RoleId, position: Position): number {
  return roleFit(player.attrs, role, player.positions.GK > 0) * positionMultiplier(player.positions[position])
}

function validSelection(formation: FormationDef): string | null {
  const current = ui.lineupSlot
  if (!current) return null
  const bench = benchIndexOf(current)
  const valid = bench >= 0 ? bench < BENCH_SLOTS : formation.slots.some((slot) => slot.id === current)
  if (!valid) ui.lineupSlot = null
  return valid ? current : null
}

function playerFlags(player: Player): string {
  const flags: string[] = []
  if (injuryUntil(game, player)) flags.push(tag('受伤', 'bad'))
  if (game.suspensions?.[player.id]) flags.push(tag('停赛', 'bad'))
  if (player.unhappy && player.unhappy.until > Date.now()) flags.push(`<span class="tag gold" title="${esc(player.unhappy.reason)}：精力恢复只剩一成">不满</span>`)
  return flags.join('')
}

function statusNote(player: Player): string {
  if (game.suspensions?.[player.id]) return ' · 停赛'
  return injuryUntil(game, player) ? ' · 受伤' : ''
}

/** 球员现在在阵容里的哪个位置。 */
function placeOf(playerId: string, draft: Lineup, formation: FormationDef): string {
  const starter = draft.starters.find((item) => item.playerId === playerId)
  if (starter) return formation.slots.find((slot) => slot.id === starter.slotId)?.label ?? '首发'
  const bench = draft.bench.indexOf(playerId)
  return bench >= 0 ? `替补 ${bench + 1}` : '未入选'
}

/* ---------- 球场 ---------- */

function roleOptions(position: Position, role: RoleId): string {
  return ROLES_BY_POSITION[position].map((item) => `<option value="${item}" ${role === item ? 'selected' : ''} title="${esc(ROLES[item].desc)}">${esc(ROLES[item].label)}</option>`).join('')
}

/** 熟练度：参考图里那种很短的绿条，低于 65 变黄、低于 40 变红。 */
function proficiencyBar(value: number): string {
  const tone = value >= PLAYABLE_PROFICIENCY ? '' : value >= 60 ? ' low' : ' bad'
  return `<span class="prof-bar${tone}" aria-label="熟练度 ${Math.round(value)}"><i style="width:${Math.max(6, Math.min(100, value)).toFixed(0)}%"></i></span>`
}

/**
 * 体能：一个心形，按当前体力从下往上填充（体力越低填充越少），
 * 颜色仍是绿 / 黄 / 红三档。空的部分用暗色轮廓显示。
 */
function fitnessHeart(value: number): string {
  const fill = Math.max(0, Math.min(100, value))
  const tone = fill >= 70 ? 'good' : fill >= 40 ? 'warn' : 'bad'
  return `<span class="fitness ${tone}" style="--fill:${fill.toFixed(0)}%" title="体能 ${Math.round(value)} / 100" aria-label="体能 ${Math.round(value)}"><i class="fitness-base">♥</i><i class="fitness-fill">♥</i></span>`
}

function slotPlayerOptions(slot: FormationSlot, role: RoleId, draft: Lineup, formation: FormationDef, currentId: string | undefined): string {
  const candidates = [...game.roster].sort((a, b) => effectiveFit(b, role, slot.position) - effectiveFit(a, role, slot.position))
  return `<option value="" ${currentId ? '' : 'selected'}>— 未安排 —</option>${candidates.map((player) => {
    const place = player.id === currentId ? '' : placeOf(player.id, draft, formation)
    return `<option value="${esc(player.id)}" ${player.id === currentId ? 'selected' : ''}>${esc(player.name)} · 熟练 ${Math.round(player.positions[slot.position])} · 有效 ${effectiveFit(player, role, slot.position).toFixed(1)}${place ? ` · 现${esc(place)}` : ''}${statusNote(player)}</option>`
  }).join('')}`
}

function slotCard(slot: FormationSlot, draft: Lineup, formation: FormationDef, selectedId: string | null, color: string): string {
  const starter = draft.starters.find((item) => item.slotId === slot.id)
  const player = playerOf(starter?.playerId)
  // 玩家自己摆的位置优先，没摆过就是阵型默认坐标。
  const spot = slotPosition(draft, slot)
  const { left, top } = boardSpot(spot.x, spot.y)
  const custom = !!draft.customPositions?.[slot.id]
  const role = starter?.role ?? slot.defaultRole
  const warn = player && (player.positions[slot.position] < PLAYABLE_PROFICIENCY || injuryUntil(game, player) || game.suspensions?.[player.id])
  const selected = selectedId === slot.id
  const hint = `${slot.label}：拖动圆点把球员摆到任意位置（松手保存）；选中后用方向键微调；点击圆点在右侧球员表里选人`
  return `<div class="slot ${selected ? 'selected' : ''} ${player ? '' : 'vacant'} ${warn ? 'warn' : ''} ${custom ? 'custom-pos' : ''}" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%" data-drop="${slotTarget(slot.id)}" data-key="${slot.id}">
    <div class="slot-dot" role="button" tabindex="0" aria-pressed="${selected}" data-pos-slot="${slot.id}" data-action="lineup-slot" data-slot="${slot.id}" ${player ? `style="background:${esc(color)};color:${inkOn(color)}"` : ''} aria-label="${esc(hint)}" title="${esc(hint)}">${player ? effectiveFit(player, role, slot.position).toFixed(0) : icon('plus', 13)}</div>
    ${player ? pick(esc(ROLES[role]?.label ?? ''), `<select data-lineup-role="${slot.id}" aria-label="${esc(slot.label)}职责">${roleOptions(slot.position, role)}</select>`, 'slot-role') : ''}
    ${pick(esc(player ? shortName(player.name) : slot.label), `<select data-slot-player="${slot.id}" aria-label="${esc(slot.label)}球员">${slotPlayerOptions(slot, role, draft, formation, player?.id)}</select>`, 'slot-player')}
  </div>`
}

function benchPlayerOptions(index: number, draft: Lineup, formation: FormationDef): string {
  const currentId = draft.bench[index]
  const candidates = [...game.roster].sort((a, b) => playerCA(b) - playerCA(a))
  return `<option value="" ${currentId ? '' : 'selected'}>— 未安排 —</option>${candidates.map((player) => {
    const place = player.id === currentId ? '' : placeOf(player.id, draft, formation)
    const own = primaryPosition(player)
    return `<option value="${esc(player.id)}" ${player.id === currentId ? 'selected' : ''}>${esc(player.name)} · ${positionLabel(own)} 熟练 ${Math.round(player.positions[own])} · CA ${playerCA(player).toFixed(0)}${place ? ` · 现${esc(place)}` : ''}${statusNote(player)}</option>`
  }).join('')}`
}

function benchCard(index: number, draft: Lineup, formation: FormationDef, selectedId: string | null, color: string): string {
  const player = playerOf(draft.bench[index])
  const id = benchSlotId(index)
  const selected = selectedId === id
  return `<div class="bench-slot ${selected ? 'selected' : ''} ${player ? '' : 'vacant'}" data-drop="${benchTarget(index)}" data-key="${id}">
    <div class="slot-dot" role="button" tabindex="0" aria-pressed="${selected}" ${player ? `draggable="true" data-drag-player="${esc(player.id)}" style="background:${esc(color)};color:${inkOn(color)}"` : ''} data-action="lineup-slot" data-slot="${id}" title="替补 ${index + 1}">${player ? bestRoleForPlayer(player, primaryPosition(player)).fit.toFixed(0) : icon('plus', 13)}</div>
    ${pick(player ? esc(shortName(player.name)) : '选择球员', `<select data-bench-player="${index}" aria-label="替补 ${index + 1}">${benchPlayerOptions(index, draft, formation)}</select>`, 'slot-player')}
    <small>${player ? `${positionLabel(primaryPosition(player))}${statusNote(player)}` : `替补 ${index + 1}`}</small>
  </div>`
}

/* ---------- 战术栏 ---------- */

function instructionRow(active: TacticalInstructionsV2, field: InstructionFieldDef, disabled: boolean): string {
  const current = getInstructionField(active, field.id)
  return `<div class="tactic-row">
    <span class="tactic-label has-tip" ${tipAttrs(field.label, field.desc)}>${esc(field.label)}</span>
    <div class="seg stretch" role="group" aria-label="${esc(field.label)}">${field.options.map((opt) => `<button class="${current === opt.value ? 'active' : ''}" data-action="lineup-instruction" data-field="${field.id}" data-value="${opt.value}" ${disabled ? 'disabled' : ''}>${esc(opt.label)}</button>`).join('')}</div>
  </div>`
}

function planColumn(draft: Lineup, formation: FormationDef, disabled: boolean): string {
  const active = draft.tacticalInstructions ?? instructionsFromLegacyTactics(draft.tactics)
  return `${INSTRUCTION_GROUPS.map((group) => `<section class="tac-phase"><h3>${esc(group.title)}</h3>${group.fields.map((field) => instructionRow(active, field, disabled)).join('')}</section>`).join('')}
    <section class="tac-phase"><h3>阵型特点</h3><p class="hint flat">${esc(formation.desc)}</p></section>`
}

function tacticalStyleBar(draft: Lineup, disabled: boolean): string {
  const inferred = draft.tacticalInstructions
    ? inferStyleForInstructions(draft.tacticalInstructions, draft.tacticalStyle)
    : null
  const styleId = inferred?.styleId ?? draft.tacticalStyle ?? ''
  const meta = styleId ? STYLE_META[styleId] : null
  const styleName = styleId ? STYLES_REV3[styleId].name : ''
  const statusBadge = inferred
    ? (inferred.adjusted ? '<span class="tag gold">已调整</span>' : '<span class="tag good">预设模板</span>')
    : '<span class="tag">基础五项</span>'
  const resetBtn = inferred?.adjusted
    ? `<button class="btn small ghost" data-action="lineup-style-reset" ${disabled ? 'disabled' : ''}>恢复模板</button>`
    : ''
  const metaHtml = meta
    ? `<div class="tac-style-meta" ${tipAttrs(styleName, `战术定位：${meta.tagline} 优势：${meta.pros} 代价：${meta.cons}`)}>
        <span class="tac-style-tagline">${esc(meta.tagline)}</span>
        <span class="tac-style-tradeoff"><b class="good-text">优</b> ${esc(meta.pros)} · <b class="warn-text">忌</b> ${esc(meta.cons)}</span>
      </div>`
    : `<div class="tac-style-meta"><span class="tac-style-tagline muted">选择一套战术风格即可自动展开十二项球队指令，也可直接在左侧逐项微调。</span></div>`
  return `<div class="tac-style-bar">
    <div class="tac-style-pick">
      <label class="tac-style-label" for="lineup-tactical-style">战术风格</label>
      <select id="lineup-tactical-style" class="compact tac-style-select" data-tactical-style aria-label="战术风格模板" ${disabled ? 'disabled' : ''}>
        ${!styleId ? '<option value="" selected>— 选择风格模板 —</option>' : ''}
        ${STYLE_LIST_REV3.map((item) => `<option value="${item.id}" ${styleId === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}
      </select>
      ${statusBadge}
      ${resetBtn}
    </div>
    ${metaHtml}
  </div>`
}

function matchPlanBar(draft: Lineup, disabled: boolean): string {
  const planId: MatchPlanId = draft.matchPlan && isMatchPlanId(draft.matchPlan) ? draft.matchPlan : 'standard'
  const plan = MATCH_PLANS[planId]
  const categoryTone = plan.category === '进攻'
    ? 'warn'
    : plan.category === '防守'
      ? 'good'
      : plan.category === '局势' || plan.category === '赛程/挑战'
        ? 'gold'
        : ''
  const categoryBadge = `<span class="tag ${categoryTone}">${esc(plan.category)}</span>`
  const condDelta = Math.round((plan.conditionFactor - 1) * 100)
  const staminaBadge = condDelta > 0
    ? `<span class="tag warn">联赛体能 +${condDelta}%</span>`
    : condDelta < 0
      ? `<span class="tag good">联赛省体 ${Math.abs(condDelta)}%</span>`
      : '<span class="tag">体能标准</span>'
  const resetBtn = planId !== 'standard'
    ? `<button class="btn small ghost" data-action="lineup-plan-reset" ${disabled ? 'disabled' : ''}>恢复常规</button>`
    : ''
  const tipBody = `定位：${plan.tagline} 触发机制：${plan.triggerSummary} 赛季影响：${plan.seasonEffect} 挑战影响：${plan.challengeEffect} 优势：${plan.pros} 风险：${plan.cons}`
  return `<div class="tac-style-bar tac-plan-bar">
    <div class="tac-style-pick">
      <label class="tac-style-label" for="lineup-match-plan">下场计划</label>
      <select id="lineup-match-plan" class="compact tac-style-select" data-match-plan aria-label="下场比赛计划" ${disabled ? 'disabled' : ''}>
        ${MATCH_PLAN_GROUPS.map((group) => `<optgroup label="${esc(group.category)}">${group.plans.map((item) => `<option value="${item.id}" ${planId === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</optgroup>`).join('')}
      </select>
      ${categoryBadge}
      ${staminaBadge}
      ${resetBtn}
    </div>
    <div class="tac-style-meta" ${tipAttrs(`比赛计划 · ${plan.name}`, tipBody)}>
      <span class="tac-style-tagline">${esc(plan.tagline)} <span class="muted">（${esc(plan.triggerSummary)}）</span></span>
      <span class="tac-style-tradeoff"><b class="good-text">赛季</b> ${esc(plan.seasonEffect)} · <b class="plan-chal-text">挑战</b> ${esc(plan.challengeEffect)} · <b class="good-text">优</b> ${esc(plan.pros)} · <b class="warn-text">忌</b> ${esc(plan.cons)}</span>
    </div>
  </div>`
}

function tacticsBar(draft: Lineup, formation: FormationDef): string {
  const starters = draft.starters.flatMap((starter) => {
    const player = playerOf(starter.playerId)
    const slot = formation.slots.find((item) => item.id === starter.slotId)
    return player && slot ? [{ player, slot, role: starter.role }] : []
  })
  const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0)
  const familiarity = computeLineupFamiliarity(game.roster, draft, game.economy?.tactics ?? 1) * 100
  return `<header class="tac-bar">
    <div class="seg" role="group" aria-label="阵型">${FORMATION_LIST.map((item) => `<button class="${draft.formationId === item.id ? 'active' : ''}" data-action="lineup-formation" data-formation="${item.id}" title="${esc(item.desc)}">${esc(item.label)}</button>`).join('')}</div>
    <div class="tac-stats">
      <div class="tac-stat" ${tipAttrs('战术执行度', '由首发位置熟练度、战术意识（决断·配合）和俱乐部战术研究室阶段共同决定。数值越高，高位压迫、就地反抢和防线协同的执行越到位。')}><span>战术执行</span>${meter(familiarity)}</div>
      <div class="tac-stat"><span>位置熟练</span>${meter(average(starters.map(({ player, slot }) => player.positions[slot.position])))}</div>
      <div class="tac-stat"><span>首发体能</span>${meter(average(starters.map(({ player }) => player.condition ?? 100)))}</div>
      <div class="tac-stat"><span>平均有效</span>${fitHeat(average(starters.map(({ player, slot, role }) => effectiveFit(player, role, slot.position))))}</div>
      <div class="tac-stat"><span>平均 CA</span>${caHeat(average(starters.map(({ player }) => playerCA(player))))}</div>
    </div>
  </header>`
}

/* ---------- 球场下方：教练检查与近期分析 ---------- */

function coachCheck(draft: Lineup): string {
  const check = validateLineup(game.roster, draft)
  const autoSubs = ui.autoSubsDraft ?? emptyAutoSubs()
  const autoErrors = validateAutoSubPlan(game.roster, draft, autoSubs)
  const injured = game.roster.filter((player) => (draft.starters.some((starter) => starter.playerId === player.id) || draft.bench.includes(player.id)) && injuryUntil(game, player))
  const suspensions = Object.entries(game.suspensions ?? {})
  const planId = draft.matchPlan && isMatchPlanId(draft.matchPlan) ? draft.matchPlan : 'standard'
  const plan = MATCH_PLANS[planId]
  const starterConds = draft.starters.flatMap((s) => {
    const p = playerOf(s.playerId)
    return p ? [p.condition ?? 100] : []
  })
  const avgCond = starterConds.length ? starterConds.reduce((sum, v) => sum + v, 0) / starterConds.length : 100
  const planLine = planId === 'standard'
    ? ''
    : plan.conditionFactor >= 1.12 && avgCond < 78
      ? `<li class="check-line warn">${icon('alert', 14)}<span>下场计划「${esc(plan.name)}」高耗能，当前首发平均体能 ${Math.round(avgCond)}%，联赛出战需提防末段崩盘（挑战赛满体能不受影响）。</span></li>`
      : `<li class="check-line good">${icon('check', 14)}<span>下场计划「${esc(plan.name)}」已部署：将同步作用于赛季联赛与挑战赛。</span></li>`
  const line = (tone: string, iconName: 'alert' | 'check' | 'cross' | 'flag', text: string) => `<li class="check-line ${tone}">${icon(iconName, 14)}<span>${esc(text)}</span></li>`
  return `<ul class="check-list">
    ${check.valid ? line('good', 'check', '阵容合法，可以开始比赛。') : check.errors.map((error) => line('bad', 'alert', error)).join('')}
    ${planLine}
    ${autoErrors.map((error) => line('bad', 'alert', error)).join('')}
    ${check.warnings.map((warning) => line('warn', 'alert', warning)).join('')}
    ${injured.map((player) => line('warn', 'cross', `${player.name}：${injuryLabel(player)}`)).join('')}
    ${suspensions.map(([id, value]) => line('bad', 'flag', `${game.roster.find((player) => player.id === id)?.name ?? id} 停赛 ${value.matches} 场`)).join('')}
  </ul>`
}

function analysisList(items: { label: string; detail: string }[], tone: 'up' | 'down'): string {
  if (items.length === 0) return `<p class="muted small">没有明显${tone === 'up' ? '优势' : '劣势'}。</p>`
  return `<ul class="analysis-list">${items.map((item) => `<li class="${tone}">${icon(tone, 13)}<span>${esc(item.label)}</span><b class="num-text">${esc(item.detail)}</b></li>`).join('')}</ul>`
}

function notesSection(draft: Lineup): string {
  const analysis = recentAnalysis(game)
  return `<div class="tac-notes">
    <section><h3>教练检查</h3>${coachCheck(draft)}</section>
    ${analysis.matches === 0
      ? '<section class="span-2"><h3>近期比赛分析</h3><p class="muted small">踢完第一场联赛后，这里会把最近 5 场和对手的数据放在一起比。</p></section>'
      : `<section><h3>优势 <small>最近 ${analysis.matches} 场 · 我方 : 对手</small></h3>${analysisList(analysis.positives, 'up')}</section>
         <section><h3>劣势 <small>最近 ${analysis.matches} 场 · 我方 : 对手</small></h3>${analysisList(analysis.negatives, 'down')}</section>`}
  </div>`
}

/* ---------- 球员表 ---------- */

type RowInfo = { position: Position; fit: number; proficiency: number }

/** 选中了首发位置时，全表按这个位置算熟练和有效，方便比较候选。 */
function rowInfo(player: Player, draft: Lineup, formation: FormationDef, selected: FormationSlot | null): RowInfo {
  if (selected) {
    const role = draft.starters.find((item) => item.slotId === selected.id)?.role ?? selected.defaultRole
    return { position: selected.position, fit: effectiveFit(player, role, selected.position), proficiency: player.positions[selected.position] }
  }
  const starter = draft.starters.find((item) => item.playerId === player.id)
  const slot = starter && formation.slots.find((item) => item.id === starter.slotId)
  if (starter && slot) return { position: slot.position, fit: effectiveFit(player, starter.role, slot.position), proficiency: player.positions[slot.position] }
  const position = primaryPosition(player)
  return { position, fit: bestRoleForPlayer(player, position).fit, proficiency: player.positions[position] }
}

function moveOptions(player: Player, draft: Lineup, formation: FormationDef): string {
  const here = draft.starters.find((item) => item.playerId === player.id)?.slotId
  const benchAt = draft.bench.indexOf(player.id)
  const slots = formation.slots.map((slot) => {
    const other = playerOf(draft.starters.find((item) => item.slotId === slot.id)?.playerId)
    return `<option value="${slotTarget(slot.id)}" ${here === slot.id ? 'selected' : ''}>${esc(slot.label)} · 熟练 ${Math.round(player.positions[slot.position])}${other && other.id !== player.id ? ` · 换下 ${esc(other.name)}` : ''}</option>`
  }).join('')
  // 替补席和未入选都没有固定位置，按这名球员最擅长的位置给熟练度，选人时好比较。
  const own = primaryPosition(player)
  const ownLine = `${positionLabel(own)} 熟练 ${Math.round(player.positions[own])}`
  const benchCount = Math.min(BENCH_SLOTS, draft.bench.length + (benchAt >= 0 ? 0 : 1))
  const bench = Array.from({ length: benchCount }, (_, index) => {
    const other = playerOf(draft.bench[index])
    return `<option value="${benchTarget(index)}" ${benchAt === index ? 'selected' : ''}>替补 ${index + 1} · ${ownLine}${other && other.id !== player.id ? ` · 换下 ${esc(other.name)}` : ''}</option>`
  }).join('')
  return `<optgroup label="首发">${slots}</optgroup><optgroup label="替补">${bench}</optgroup><option class="reserve-opt" value="reserve" ${!here && benchAt < 0 ? 'selected' : ''}>未入选（移出比赛名单）· ${ownLine}</option>`
}

function cardCell(player: Player): string {
  if (playerCards(game, player.id).length === 0) return `<span class="muted small" title="还没有培养出球员卡，使用原始属性">原始</span>`
  return cardSelect(player)
}

function playerRow(player: Player, draft: Lineup, formation: FormationDef, selected: FormationSlot | null, selectedId: string | null, form: PlayerForm, placement: { slot?: FormationSlot; role?: RoleId; benchIndex?: number }): string {
  const info = rowInfo(player, draft, formation, selected)
  const placeLabel = placement.slot?.label ?? (placement.benchIndex !== undefined ? `替补 ${placement.benchIndex + 1}` : '未入选')
  const isPicked = selectedId !== null && (placement.slot?.id === selectedId || (placement.benchIndex !== undefined && benchSlotId(placement.benchIndex) === selectedId))
  const assignable = selectedId !== null && !isPicked
  const dropTarget = placement.slot ? slotTarget(placement.slot.id) : placement.benchIndex !== undefined ? benchTarget(placement.benchIndex) : 'reserve'
  const positions = (['GK', 'CB', 'W', 'CM', 'ST'] as Position[]).filter((pos) => player.positions[pos] >= PLAYABLE_PROFICIENCY).sort((a, b) => player.positions[b] - player.positions[a])
  const winRate = form.apps > 0 ? pct(form.wins / form.apps) : '—'
  return `<tr class="${isPicked ? 'me' : ''} ${assignable ? 'clickable' : ''}" data-key="${esc(player.id)}" data-drop="${dropTarget}" ${assignable ? `tabindex="0" data-action="lineup-assign" data-player="${esc(player.id)}"` : ''}>
    <td class="t-place ${placement.slot || placement.benchIndex !== undefined ? '' : 'reserve'}">${pick(`${posBadge(placement.slot?.position ?? primaryPosition(player))}<span>${esc(placeLabel)}</span>`, `<select data-move-player="${esc(player.id)}" aria-label="${esc(player.name)}的位置">${moveOptions(player, draft, formation)}</select>`)}</td>
    <td class="name-cell t-name"><span class="grip" draggable="true" data-drag-player="${esc(player.id)}" title="拖到球场或替补席">${icon('grip', 13)}</span><button class="name-btn" data-action="detail" data-player="${esc(player.id)}">${esc(player.name)}</button>${playerFlags(player)}</td>
    <td class="num t-prof" title="${positionLabel(info.position)}熟练度 ${Math.round(info.proficiency)} / 100，属性折损 ${pct(1 - positionMultiplier(info.proficiency))}">${proficiencyBar(info.proficiency)}</td>
    <td class="num t-cond" title="体能 ${Math.round(player.condition ?? 100)} / 100，比赛开始时映射为初始体力">${fitnessHeart(player.condition ?? 100)}</td>
    <td class="num strong">${fitHeat(info.fit)}</td>
    <td class="num">${caHeat(playerCA(player))}</td>
    <td class="t-role">${placement.slot && placement.role ? pick(esc(ROLES[placement.role]?.label ?? ''), `<select data-lineup-role="${placement.slot.id}" aria-label="${esc(placement.slot.label)}职责">${roleOptions(placement.slot.position, placement.role)}</select>`) : '<span class="muted">—</span>'}</td>
    <td class="t-card">${cardCell(player)}</td>
    <td class="t-form">${formBars(form)}</td>
    <td><span class="pos-list">${positions.map((pos) => `<span title="${positionLabel(pos)} 熟练 ${Math.round(player.positions[pos])}">${posBadge(pos)}</span>`).join('')}</span></td>
    <td class="num dim">${form.apps || '—'}</td>
    <td class="num dim">${form.apps ? form.goals : '—'}</td>
    <td class="num dim">${winRate}</td>
  </tr>`
}

function emptyRow(label: string, position: Position | null, slotId: string, drop: string, selectedId: string | null): string {
  return `<tr class="clickable ${selectedId === slotId ? 'me' : ''}" tabindex="0" data-action="lineup-slot" data-slot="${slotId}" data-drop="${drop}" data-key="empty-${slotId}">
    <td class="t-place"><span class="empty-place">${position ? posBadge(position) : ''}<span>${esc(label)}</span></span></td>
    <td colspan="12"><span class="warn-text">未安排</span><span class="muted small"> · 点击后选人，或把球员拖到这里</span></td>
  </tr>`
}

function groupRow(label: string, count: string, drop?: string): string {
  return `<tr class="group-row" ${drop ? `data-drop="${drop}"` : ''} data-key="group-${esc(label)}"><td colspan="13">${esc(label)} <small>${esc(count)}</small></td></tr>`
}

function squadTable(draft: Lineup, formation: FormationDef, selectedId: string | null): string {
  const selectedSlot = selectedId ? formation.slots.find((slot) => slot.id === selectedId) ?? null : null
  const forms = squadForm(game)
  const row = (player: Player, placement: { slot?: FormationSlot; role?: RoleId; benchIndex?: number }) => playerRow(player, draft, formation, selectedSlot, selectedId, formOf(forms, player.id), placement)
  const starters = formation.slots.map((slot) => {
    const starter = draft.starters.find((item) => item.slotId === slot.id)
    const player = playerOf(starter?.playerId)
    return player && starter ? row(player, { slot, role: starter.role }) : emptyRow(slot.label, slot.position, slot.id, slotTarget(slot.id), selectedId)
  }).join('')
  const bench = Array.from({ length: BENCH_SLOTS }, (_, index) => {
    const player = playerOf(draft.bench[index])
    return player ? row(player, { benchIndex: index }) : emptyRow(`替补 ${index + 1}`, null, benchSlotId(index), benchTarget(index), selectedId)
  }).join('')
  const used = new Set([...draft.starters.map((item) => item.playerId), ...draft.bench])
  const scoreOf = (player: Player) => (selectedSlot ? rowInfo(player, draft, formation, selectedSlot).fit : playerCA(player))
  const reserves = game.roster.filter((player) => !used.has(player.id)).sort((a, b) => scoreOf(b) - scoreOf(a)).map((player) => row(player, {})).join('')
  return `<div class="table-scroll"><table class="dt tac-table">
    <thead><tr>
      <th>位置</th><th>球员</th>
      <th class="num t-prof" title="当前位置的熟练度；低于 80 不算可踢，属性会折损">熟练度</th>
      <th class="num t-cond" title="比赛体能属于球员本人，换卡不会恢复">体能</th>
      <th class="num" title="这名球员用这个职责踢这个位置的实际水平（已算位置折损）">有效</th>
      <th class="num">CA</th>
      <th class="t-role">职责</th><th>球员卡</th>
      <th title="最近 5 场联赛的表现分，由进球、拦截、传球等算出，只用于展示">近 5 场</th>
      <th title="熟练度 80 以上的位置；低于 80 不算可踢">可踢位置</th>
      <th class="num" title="本赛季联赛出场">场</th><th class="num" title="本赛季联赛进球">球</th><th class="num" title="本赛季出场时的胜率">胜率</th>
    </tr></thead>
    <tbody>
      ${groupRow('首发', `${draft.starters.length} / ${formation.slots.length}`)}
      ${starters}
      ${groupRow('替补', `${draft.bench.length} / ${BENCH_SLOTS}`)}
      ${bench}
      ${groupRow('未入选', `${game.roster.length - used.size} 人`, 'reserve')}
      ${reserves}
    </tbody>
  </table></div>`
}

function pickingBanner(selectedId: string | null, formation: FormationDef): string {
  if (!selectedId) return ''
  const slot = formation.slots.find((item) => item.id === selectedId)
  const label = slot?.label ?? `替补 ${benchIndexOf(selectedId) + 1}`
  return `<div class="picking">${icon('swap', 14)}<span>正在为 <b>${esc(label)}</b> 选人：点击下面的球员替换${slot ? '；有效和熟练已按这个位置计算' : ''}。</span><button class="btn small ghost" data-action="lineup-slot" data-slot="${esc(selectedId)}">取消</button></div>`
}

/* ---------- 自动换人 ---------- */

function autoSubPanel(draft: Lineup, onlineLock = false): string {
  const autoSubs = ui.autoSubsDraft ?? emptyAutoSubs()
  const formation = FORMATIONS[draft.formationId]
  const starters = draft.starters.flatMap((starter) => {
    const player = playerOf(starter.playerId)
    if (!player) return []
    const slot = formation?.slots.find((item) => item.id === starter.slotId)
    return [{
      slotId: starter.slotId,
      slotLabel: slot?.label ?? positionLabel(slot?.position ?? primaryPosition(player)),
      playerId: player.id,
      name: player.name,
      position: slot?.position ?? primaryPosition(player),
      staminaPct: Math.round(player.condition ?? 100),
    }]
  })
  const bench = draft.bench.flatMap((id) => {
    const player = playerOf(id)
    if (!player) return []
    const pos = primaryPosition(player)
    return [{
      playerId: player.id,
      name: player.name,
      position: pos,
      proficiency: Math.round(player.positions[pos] ?? 0),
      staminaPct: Math.round(player.condition ?? 100),
    }]
  })
  const ruleCount = autoSubs.timed.length + (autoSubs.conditionRules?.length ?? 0)
  return panel('自动换人设置', `
    ${renderAutoSubEditor({ scope: 'lineup', plan: autoSubs, formationId: draft.formationId, starters, bench, disabled: onlineLock })}
    <p class="hint">修改后请点击顶部「保存阵容」生效；比赛进行中也可在「教练调整」里随时修改本场设置。手动与自动共用 ${MAX_SUBS} 次换人名额，按受伤、定时、条件规则、全局体力顺序处理。受伤与体力规则只挑学过该位置且未受伤的替补，体力触发还要求替补体力不低于阈值，避免刚换上又立即被换下。红牌停赛 2 场，累计 3 张黄牌停赛 1 场。伤病跟着球员走，换卡不变；恢复前带伤比赛能力下降 30%，不影响精力和培养。</p>
  `, { aside: `<span class="muted small">${ruleCount ? `已配 ${ruleCount} 条规则` : '支持按位置/体力智能换人'}</span>` })
}

/* ---------- 战术预设 ---------- */

function presetStamp(createdAt: number): string {
  const date = new Date(createdAt)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function presetItem(preset: NonNullable<Lineup['presets']>[number]): string {
  const formation = FORMATIONS[preset.lineup.formationId]
  const customCount = Object.keys(preset.lineup.customPositions ?? {}).length
  const detail = [
    formation?.label ?? preset.lineup.formationId,
    lineupStyleLabel(preset.lineup),
    `${preset.lineup.starters.length} 人首发`,
    `${preset.lineup.bench.length} 人替补`,
    customCount ? `${customCount} 处自定义位置` : '默认位置',
    presetStamp(preset.createdAt),
  ].join(' · ')
  return `<li class="preset-item" data-key="${esc(preset.id)}">
    <div class="preset-info"><b>${esc(preset.name)}</b><small>${esc(detail)}</small></div>
    <div class="preset-actions">
      <button class="btn small primary" data-preset-apply="${esc(preset.id)}">应用</button>
      <button class="btn small ghost" data-preset-rename="${esc(preset.id)}">重命名</button>
      <button class="btn small ghost danger" data-preset-delete="${esc(preset.id)}">删除</button>
    </div>
  </li>`
}

function presetsPanel(draft: Lineup): string {
  const presets = draft.presets ?? []
  return panel('战术预设', `
    <div class="preset-save">
      <input class="compact" data-preset-name placeholder="给这套战术起个名字" aria-label="新战术名称" maxlength="20" value="${esc(presetNameDraft)}" />
      <button class="btn small primary" data-preset-save>${icon('plus', 13)}保存当前配置</button>
    </div>
    <p class="hint flat">保存的是阵型、首发、替补、战术和自定义位置。名称不能为空，同一存档内不能重名。</p>
    ${presets.length === 0
      ? '<p class="muted small">还没有命名战术。</p>'
      : `<ul class="preset-list">${presets.map((preset) => presetItem(preset)).join('')}</ul>`}
    ${positionMessage ? `<p class="hint flat pos-message" role="status">${esc(positionMessage)}</p>` : ''}
  `, { flush: true })
}

/* ---------- 自由摆位 + 预设的交互 ---------- */

/**
 * 交互状态放模块里：ui 的字段不归本任务改，也不需要跨页面共享。
 */
let positionDrag: { slotId: string; pointerId: number; startX: number; startY: number; moved: boolean; left: number; top: number; element: HTMLElement } | null = null
/** 拖完松手会跟着一次 click：吞掉它，免得又触发选人。 */
let dragEndedAt = 0
const CLICK_SUPPRESS_MS = 400
let positionMessage: string | null = null
let presetNameDraft = ''
let messageTimer: number | null = null

/** 只重绘战术页内容区，不惊动 app.ts 的整页 render。 */
function refreshLineup(): void {
  if (ui.screen !== 'lineup') return
  const main = document.querySelector<HTMLElement>('main.content')
  if (main) morph(main, renderLineup())
}

function announceLineup(text: string): void {
  positionMessage = text
  if (messageTimer !== null) window.clearTimeout(messageTimer)
  messageTimer = window.setTimeout(() => {
    messageTimer = null
    positionMessage = null
    refreshLineup()
  }, 12000)
  refreshLineup()
}

/**
 * 把某个首发位置写回存档（通过 setLineup，内部会写存档），并同步到草稿。
 * 只提交这一个位置，不替玩家保存其他还没保存的改动。返回中文错误文案，成功时 null。
 */
function savePosition(slotId: string, spot: { x: number; y: number }): string | null {
  const draft = ui.lineupDraft ?? structuredClone(game.lineup)
  ui.lineupDraft = draft
  const clamped = clampSpot(spot)
  if (!setSlotPosition(draft, slotId, clamped)) return '这个位置不在当前阵型里'
  if (draft.formationId !== game.lineup.formationId) return '阵型还没保存：先保存阵容，位置才会生效'
  const next = structuredClone(game.lineup)
  setSlotPosition(next, slotId, clamped)
  const result = setLineup(game, next, game.autoSubs ?? emptyAutoSubs())
  if (!result.ok) return `位置已摆好，但阵容还不合法，暂时无法保存：${result.errors[0]}`
  return null
}

function clearPreview(element: HTMLElement): void {
  element.style.left = ''
  element.style.top = ''
}

function endPositionDrag(event: PointerEvent, commit: boolean): void {
  const state = positionDrag
  if (!state || event.pointerId !== state.pointerId) return
  positionDrag = null
  document.querySelector('.board')?.classList.remove('pos-dragging')
  if (!state.moved) return
  dragEndedAt = Date.now()
  clearPreview(state.element)
  if (!commit) {
    refreshLineup()
    return
  }
  const error = savePosition(state.slotId, boardSpotFromPercent(state.left, state.top))
  if (error) announceLineup(error)
  else refreshLineup()
}

/** 把当前草稿存成命名预设：先确认阵容合法，再写回存档。 */
function savePresetFromDraft(): void {
  const name = presetNameDraft.trim()
  const draft = ui.lineupDraft ?? structuredClone(game.lineup)
  const nameError = presetNameError(draft, name)
  if (nameError) {
    announceLineup(nameError)
    return
  }
  const applied = setLineup(game, draft, ui.autoSubsDraft ?? emptyAutoSubs())
  if (!applied.ok) {
    announceLineup(`阵容还不合法，先修正再保存：${applied.errors[0]}`)
    return
  }
  ui.lineupDraft = structuredClone(game.lineup)
  ui.autoSubsDraft = structuredClone(game.autoSubs ?? emptyAutoSubs())
  const next = structuredClone(game.lineup)
  const result = saveTacticPreset(next, name)
  if (!result.ok) {
    announceLineup(result.error ?? '保存战术失败')
    return
  }
  const saved = setLineup(game, next, game.autoSubs ?? emptyAutoSubs())
  if (!saved.ok) {
    announceLineup(`保存战术失败：${saved.errors[0]}`)
    return
  }
  presetNameDraft = ''
  // 输入框里的文字是用户敲的，重绘不会覆盖，这里手动清掉。
  const nameInput = document.querySelector<HTMLInputElement>('[data-preset-name]')
  if (nameInput) nameInput.value = ''
  ui.lineupDraft = structuredClone(game.lineup)
  announceLineup(`已保存战术“${result.preset?.name ?? name}”。`)
}

/** 应用预设：整套配置写回 game.lineup 并保存。 */
function applyPresetById(id: string): void {
  const preset = findTacticPreset(game.lineup, id)
  if (!preset) {
    announceLineup('找不到这个战术预设')
    return
  }
  const next = applyTacticPreset(game.lineup, id)
  if (!next) {
    announceLineup('找不到这个战术预设')
    return
  }
  let result = setLineup(game, next, game.autoSubs ?? emptyAutoSubs())
  let clearedSubs = false
  if (!result.ok) {
    // 自动换人规则可能指向不在新阵容里的球员：清空规则再试一次。
    result = setLineup(game, next, emptyAutoSubs())
    clearedSubs = result.ok
  }
  if (!result.ok) {
    announceLineup(`无法应用“${preset.name}”：${result.errors[0]}（可能有球员已经离队）`)
    return
  }
  ui.lineupDraft = structuredClone(game.lineup)
  ui.autoSubsDraft = structuredClone(game.autoSubs ?? emptyAutoSubs())
  ui.lineupSlot = null
  announceLineup(clearedSubs ? `已应用战术“${preset.name}”，原自动换人规则与新阵容冲突，已清空。` : `已应用战术“${preset.name}”。`)
}

function renamePresetById(id: string): void {
  const preset = findTacticPreset(game.lineup, id)
  if (!preset) {
    announceLineup('找不到这个战术预设')
    return
  }
  const name = window.prompt('新的战术名称', preset.name)
  if (name === null) return
  const next = structuredClone(game.lineup)
  const result = renameTacticPreset(next, id, name)
  if (!result.ok) {
    announceLineup(result.error ?? '改名失败')
    return
  }
  const saved = setLineup(game, next, game.autoSubs ?? emptyAutoSubs())
  if (!saved.ok) {
    announceLineup(`改名失败：${saved.errors[0]}`)
    return
  }
  // 草稿里未保存的改动要留着，只同步预设列表。
  if (ui.lineupDraft) ui.lineupDraft.presets = structuredClone(next.presets ?? [])
  announceLineup(`已改名为“${result.preset?.name ?? name}”。`)
}

function deletePresetById(id: string): void {
  const preset = findTacticPreset(game.lineup, id)
  if (!preset) {
    announceLineup('找不到这个战术预设')
    return
  }
  if (!window.confirm(`删除战术“${preset.name}”？`)) return
  const next = structuredClone(game.lineup)
  if (!deleteTacticPreset(next, id)) {
    announceLineup('找不到这个战术预设')
    return
  }
  const saved = setLineup(game, next, game.autoSubs ?? emptyAutoSubs())
  if (!saved.ok) {
    announceLineup(`删除失败：${saved.errors[0]}`)
    return
  }
  if (ui.lineupDraft) ui.lineupDraft.presets = structuredClone(next.presets ?? [])
  announceLineup(`已删除战术“${preset.name}”。`)
}

function resetPositions(): void {
  if (!window.confirm('把所有首发恢复到阵型默认位置？')) return
  const next = structuredClone(game.lineup)
  if (!clearSlotPositions(next)) {
    announceLineup('现在用的就是阵型默认位置。')
    return
  }
  if (ui.lineupDraft) clearSlotPositions(ui.lineupDraft)
  const saved = setLineup(game, next, game.autoSubs ?? emptyAutoSubs())
  if (!saved.ok) {
    announceLineup(`还原失败：${saved.errors[0]}`)
    return
  }
  announceLineup('已恢复阵型默认位置。')
}

/* 拖动圆点自由摆位：鼠标和触摸都用 pointer 事件。 */
document.addEventListener('pointerdown', (event) => {
  if (ui.screen !== 'lineup' || event.button > 0) return
  const dot = (event.target as HTMLElement).closest?.<HTMLElement>('[data-pos-slot]')
  const slotElement = dot?.closest<HTMLElement>('.slot')
  if (!dot?.dataset.posSlot || !slotElement) return
  positionDrag = { slotId: dot.dataset.posSlot, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false, left: 0, top: 0, element: slotElement }
  try {
    dot.setPointerCapture(event.pointerId)
  } catch {
    // 合成事件或老浏览器没有指针捕获：仍然能用 document 上的监听拖动。
  }
})

document.addEventListener('pointermove', (event) => {
  const state = positionDrag
  if (!state || event.pointerId !== state.pointerId) return
  if (!state.moved) {
    if (Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < 5) return
    state.moved = true
    document.querySelector('.board')?.classList.add('pos-dragging')
  }
  const board = document.querySelector<HTMLElement>('.board')
  if (!board) return
  const rect = board.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const clampPercent = (value: number) => Math.min(100, Math.max(0, value))
  state.left = clampPercent(((event.clientX - rect.left) / rect.width) * 100)
  state.top = clampPercent(((event.clientY - rect.top) / rect.height) * 100)
  state.element.style.left = `${state.left.toFixed(1)}%`
  state.element.style.top = `${state.top.toFixed(1)}%`
  event.preventDefault()
})

document.addEventListener('pointerup', (event) => endPositionDrag(event, true))
document.addEventListener('pointercancel', (event) => endPositionDrag(event, false))

// 捕获阶段先吞掉拖拽后那一次 click，让“点击圆点选人”只在真正点击时生效。
document.addEventListener('click', (event) => {
  if (!dragEndedAt) return
  const recent = Date.now() - dragEndedAt <= CLICK_SUPPRESS_MS
  dragEndedAt = 0
  if (!recent) return
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}, true)

document.addEventListener('input', (event) => {
  const target = event.target as HTMLInputElement
  if (target.dataset.presetName !== undefined) presetNameDraft = target.value
})

document.addEventListener('click', (event) => {
  if (ui.screen !== 'lineup') return
  const target = event.target as HTMLElement
  const locked = isOnlineMode() && lineupLockState(game).locked
  if (locked && (target.closest('[data-preset-save]') || target.closest('[data-preset-apply]'))) {
    announceLineup('阵容已锁定：开赛前 30 分钟内不能修改，比赛由服务器自动结算。')
    return
  }
  if (target.closest('[data-preset-save]')) {
    savePresetFromDraft()
    return
  }
  const apply = target.closest<HTMLElement>('[data-preset-apply]')
  if (apply?.dataset.presetApply) {
    applyPresetById(apply.dataset.presetApply)
    return
  }
  const rename = target.closest<HTMLElement>('[data-preset-rename]')
  if (rename?.dataset.presetRename) {
    renamePresetById(rename.dataset.presetRename)
    return
  }
  const remove = target.closest<HTMLElement>('[data-preset-delete]')
  if (remove?.dataset.presetDelete) {
    deletePresetById(remove.dataset.presetDelete)
    return
  }
  if (target.closest('[data-pos-reset]')) resetPositions()
})

/* 键盘可达：圆点获得焦点后用方向键微调位置，Home 恢复该位置默认。 */
document.addEventListener('keydown', (event) => {
  if (ui.screen !== 'lineup') return
  const target = event.target as HTMLElement
  if (target.dataset.presetName !== undefined && event.key === 'Enter') savePresetFromDraft()
  const dot = target.closest?.<HTMLElement>('[data-pos-slot]')
  const slotId = dot?.dataset.posSlot
  const draft = ui.lineupDraft
  if (!dot || !slotId || !draft) return
  const slot = FORMATIONS[draft.formationId]?.slots.find((item) => item.id === slotId)
  if (!slot) return
  const step = event.shiftKey ? 0.01 : 0.04
  const current = slotPosition(draft, slot)
  let next: { x: number; y: number } | null = null
  if (event.key === 'ArrowUp') next = { x: current.x + step, y: current.y }
  else if (event.key === 'ArrowDown') next = { x: current.x - step, y: current.y }
  else if (event.key === 'ArrowLeft') next = { x: current.x, y: current.y - step }
  else if (event.key === 'ArrowRight') next = { x: current.x, y: current.y + step }
  else if (event.key === 'Home') next = { x: slot.x, y: slot.y }
  if (!next) return
  event.preventDefault()
  const clamped = clampSpot(next)
  const error = savePosition(slotId, clamped)
  const spot = boardSpot(clamped.x, clamped.y)
  const slotElement = dot.closest<HTMLElement>('.slot')
  if (slotElement) {
    slotElement.style.left = `${spot.left.toFixed(1)}%`
    slotElement.style.top = `${spot.top.toFixed(1)}%`
  }
  if (error) announceLineup(error)
  else refreshLineup()
})

/* ---------- 页面 ---------- */

function contextLine(): string {
  const rank = game.season.table.findIndex((row) => row.teamId === PLAYER_TEAM_ID) + 1
  const division = game.world ? worldDivisionLabel(game.world, game.season.divisionId ?? game.world.playerDivisionId) : '联赛'
  const fixture = playerFixture(game)
  const next = fixture && !fixture.played
    ? (() => {
      const home = fixture.homeId === PLAYER_TEAM_ID
      return `下一场：${esc(teamName(game, home ? fixture.awayId : fixture.homeId))}（${home ? '主' : '客'}）· 距自动结算 ${esc(matchdayCountdown(game))}`
    })()
    : ''
  return [`${esc(division)}第 ${rank} 名`, next].filter(Boolean).join(' · ')
}

/** 阵容的规范化指纹：键顺序不同但内容相同时也不算“未保存”。 */
function lineupFingerprint(lineup: Lineup): string {
  return JSON.stringify([
    lineup.formationId,
    lineup.starters.map((starter) => [starter.slotId, starter.playerId, starter.role]),
    lineup.bench,
    lineup.tactics,
    lineup.tacticalStyle ?? null,
    lineup.tacticalInstructions ?? null,
    lineup.matchPlan && lineup.matchPlan !== 'standard' ? lineup.matchPlan : null,
    Object.entries(lineup.customPositions ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    (lineup.presets ?? []).map((preset) => [preset.id, preset.name, preset.createdAt, lineupFingerprint({ ...preset.lineup })]),
  ])
}

function customSpotCount(lineup: Lineup): number {
  return Object.keys(lineup.customPositions ?? {}).length
}

function chemistryLines(draft: Lineup, formation: FormationDef): string {
  const players = draft.starters.flatMap(starter => {
    const slot = formation.slots.find(s => s.id === starter.slotId)
    return slot && playerOf(starter.playerId) ? [{ id: starter.playerId, ...slotPosition(draft, slot) }] : []
  })
  const links = selectChemistryLinks(game.chemistry, players, serverNow(), game.season.gameDayMs)
  if (!links.length) return ''
  return `<svg class="chemistry-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="主要队友默契">${links.map(({ a, b, value, minutes }) => {
    const start = boardSpot(a.x, a.y)
    const end = boardSpot(b.x, b.y)
    const points = `x1="${start.left}" y1="${start.top}" x2="${end.left}" y2="${end.top}"`
    const title = `${playerOf(a.id)!.name} ↔ ${playerOf(b.id)!.name}`
    const body = `默契 ${value.toFixed(1)} / 100；共同上场 ${Math.round(minutes)} 分钟。传球配合评分最多 +${(4 * value / 100).toFixed(1)}，长传减半、传中按八成计算。每人仅显示一名主要搭档，其他队友默契仍生效。超过 180 个游戏日未合作会移除。`
    return `<g class="chemistry-link" data-key="${esc(chemistryKey(a.id, b.id))}" data-a="${esc(a.id)}" data-b="${esc(b.id)}" role="img" ${tipAttrs(title, body)}><line class="chemistry-stroke" ${points} opacity="${0.35 + value / 180}" /><line class="chemistry-hit" ${points} /></g>`
  }).join('')}</svg>`
}

export function renderLineup(): string {
  const draft = ui.lineupDraft ?? structuredClone(game.lineup)
  // 自动填充/换阵型会把预设和位置弄丢：从存档里接回来（位置仅限同阵型）。
  if (draft.formationId === game.lineup.formationId && !draft.customPositions && game.lineup.customPositions) {
    draft.customPositions = structuredClone(game.lineup.customPositions)
  }
  if (!draft.presets && game.lineup.presets) draft.presets = structuredClone(game.lineup.presets)
  ui.lineupDraft = draft
  const formation = FORMATIONS[draft.formationId]
  const selectedId = validSelection(formation)
  const look = clubLook(PLAYER_TEAM_ID)
  const dirty = lineupFingerprint(draft) !== lineupFingerprint(game.lineup) || JSON.stringify(ui.autoSubsDraft ?? emptyAutoSubs()) !== JSON.stringify(game.autoSubs ?? emptyAutoSubs())
  const lock = lineupLockState(game)
  const onlineLock = isOnlineMode() && lock.locked
  const lockMinutes = Math.max(0, Math.ceil((lock.lockAt - Date.now()) / 60_000))
  const lockBanner = isOnlineMode()
    ? (onlineLock
      ? `<div class="banner warn">${icon('lock', 16)}<b>本轮阵容已锁定</b><span>开赛前 ${LINEUP_LOCK_MS / 60_000} 分钟起不能修改首发、替补、职责、战术和自动换人；服务器用锁定时的阵容、球员属性与状态快照提前排队计算，开赛时公布结果；之后的培养和装备调整只影响后续比赛。</span></div>`
      : `<div class="banner muted">${icon('clock', 16)}<b>距阵容锁定 ${lockMinutes} 分钟</b><span>开赛前 ${LINEUP_LOCK_MS / 60_000} 分钟会锁定本轮阵容，请提前保存。</span></div>`)
    : ''
  return `
    ${pageHead({
      title: `战术 ${dirty ? '<span class="tag gold head-tag">未保存</span>' : ''}`,
      sub: contextLine(),
      actions: `<select id="lineup-auto-mode" class="auto-mode" aria-label="自动填充方式" ${onlineLock ? 'disabled' : ''}><option value="best" ${ui.lineupAutoMode === 'best' ? 'selected' : ''}>最强阵容（CA·熟练度）</option><option value="half" ${ui.lineupAutoMode === 'half' ? 'selected' : ''}>部分轮换（体能优先）</option><option value="full" ${ui.lineupAutoMode === 'full' ? 'selected' : ''}>全部轮换（体能优先）</option></select><button class="btn" data-action="lineup-auto" ${onlineLock ? 'disabled' : ''}>自动填充</button><button class="btn primary" data-action="lineup-save" ${onlineLock ? 'disabled' : ''}>${icon('check', 14)}保存阵容</button>`,
    })}
    ${lockBanner}
    <div class="tactics">
      <section class="panel">
        ${tacticsBar(draft, formation)}
        ${tacticalStyleBar(draft, onlineLock)}
        ${matchPlanBar(draft, onlineLock)}
        <div class="tac-body">
          <aside class="tac-plan">${planColumn(draft, formation, onlineLock)}</aside>
          <div class="tac-pitch">
            <div class="board">${boardMarkings()}${chemistryLines(draft, formation)}${formation.slots.map((slot) => slotCard(slot, draft, formation, selectedId, look.color)).join('')}</div>
            <p class="hint flat">圆内是有效评分；橙圈表示熟练度低、受伤或停赛。任何人都能踢任何位置，熟练度越低属性折损越多，最多折损 40%。</p>
            <p class="hint flat">虚线表示主要默契搭档，每人最多显示一条；悬停、聚焦或点按连线查看详情。</p>
            <div class="pos-bar">
              <span class="hint flat">拖圆点自由摆位，松手即保存；圆点获得焦点后方向键微调（Shift 更细），Home 回默认。点圆点仍是选人换人，把球员表里的把手拖到位置也能换位。</span>
              ${customSpotCount(draft) ? `<button class="btn small ghost" data-pos-reset>还原默认位置（${customSpotCount(draft)}）</button>` : ''}
            </div>
          </div>
          <aside class="tac-bench">
            <h3>替补 <small>${draft.bench.length} / ${BENCH_SLOTS}</small></h3>
            ${Array.from({ length: BENCH_SLOTS }, (_, index) => benchCard(index, draft, formation, selectedId, look.color)).join('')}
            <p class="hint flat">比赛中最多换 ${MAX_SUBS} 次。</p>
          </aside>
        </div>
        ${notesSection(draft)}
      </section>
      <div class="tac-side">
        ${presetsPanel(draft)}
        ${panel('球员', `${pickingBanner(selectedId, formation)}${squadTable(draft, formation, selectedId)}`, { flush: true, aside: heatLegend('表现分', RATING_STOPS) })}
        ${autoSubPanel(draft, onlineLock)}
      </div>
    </div>
  `
}
