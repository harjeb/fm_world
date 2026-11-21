/**
 * FM 式多战术槽（Backup Tactics）与自定义条件比赛计划（Match Plan Rules）核心引擎模块。
 *
 * 设计目标：
 * 1. 服务器后台预模拟（server/match-job.ts）、单机/挑战赛（PesGame）与 2D 直播回放共用完全相同的纯逻辑；
 * 2. 支持最多 3 套备选战术槽（主战术 + 备选 A/B/C，人阵解耦：卖人不会导致战术槽作废）；
 * 3. 支持最多 8 条按优先级排序的「如果…就…」规则：
 *    - 触发条件：时间窗、比分局势（自动兼容两回合总比分）、红牌人数差、场上平均体能；
 *    - 执行动作：切至指定备选槽/恢复主战术（真·赛中即时变阵 + 匈牙利算法最优排位 + 少打一人智能 4-4-1/5-3-1 适配）、
 *      切换心态/战术风格/高级十二项指令微调、以及单次变阵联动换人（共享 5 次换人名额，先换人再变阵）；
 *    - 执行控制：持续生效自动回切 vs 单场仅一次锁定、3 分钟常规冷却（进球/红牌立即无视冷却响应）；
 * 4. 联赛赛后体能倍率按各阶段实际踢的时长加权结算，防止短暂冲刺扣全场体能或全场高压白嫖。
 */
import type {
  DetailedPosition,
  ElevenFormationId,
  FormationId,
  Lineup,
  MatchMentality,
  Position,
  RoleId,
  Tactics,
} from '../types.ts'
import type { MatchPlayerState, MatchTeamState } from '../match/types.ts'
import { FORMATIONS, type FormationSlot } from '../data/formations.ts'
import { ROLES, rolesForSlot } from '../data/roles.ts'
import { PLAYABLE_PROFICIENCY, positionMultiplier } from '../ca.ts'
import { detailedPositionForSlot, slotPositionValue } from '../detailed-positions.ts'
import { formationRows, type FormationRow } from './formation.ts'
import type { PesRole } from './spec.ts'
import {
  NEUTRAL_INSTRUCTIONS,
  STYLES_REV3,
  applyMentalityOverlay,
  cloneInstructions,
  inferStyleForInstructions,
  instructionsFromLegacyTactics,
  isStyleId,
  legacyTacticsFromInstructions,
  normalizeInstructions,
  sameInstructions,
  tryValidateInstructions,
  type StyleId,
  type TacticalInstructionsV2,
} from './tactics.ts'
import { isMatchPlanId, matchPlanConditionFactor, type MatchPlanId } from './match-plan.ts'

export const MAX_BACKUP_TACTICS = 3
export const MAX_MATCH_PLAN_RULES = 8
export const RULE_COOLDOWN_MINUTES = 3
export const BACKUP_TACTIC_NAME_LIMIT = 24
export const RULE_NAME_LIMIT = 28

export type BackupTacticId = string

export type BackupTactic = {
  id: BackupTacticId
  name: string
  formationId: ElevenFormationId
  mentality: MatchMentality
  tacticalStyle?: StyleId
  tacticalInstructions: TacticalInstructionsV2
  /** 可选：各槽位指定职责；省略时按球员最优适配/阵型默认职责 */
  slotRoles?: Record<string, RoleId>
  /** 可选：自由摆位坐标（0–1 归一化），与 Lineup.customPositions 同结构 */
  customPositions?: Record<string, { x: number; y: number }>
  /** 可选：软偏好（slotId -> playerId）；该球员在场上时优先安排到此位，不在场上时自动最优补位，永不报错 */
  preferredPlayers?: Record<string, string>
}

export type MatchPlanScoreCond =
  | 'any'
  | 'leading'
  | 'leading1'
  | 'leading2'
  | 'drawing'
  | 'trailing'
  | 'trailing1'
  | 'trailing2'
  | 'not_leading'
  | 'not_trailing'

export type MatchPlanRedCardCond = 'any' | 'own_down' | 'opp_down' | 'even'

export type MatchPlanCondition = {
  /** 最早生效分钟 0–89（缺省 0） */
  minMinute?: number
  /** 最晚生效分钟 1–90（缺省 90） */
  maxMinute?: number
  /** 比分/两回合总比分条件（缺省 'any'） */
  score?: MatchPlanScoreCond
  /** 红牌人数对比条件（缺省 'any'） */
  redCard?: MatchPlanRedCardCond
  /** 我方场上平均体能低于该百分比（1–99，可选） */
  avgStaminaBelow?: number
}

export type MatchPlanSubTargetOut =
  | 'lowest_stamina'
  | 'position_ST'
  | 'position_W'
  | 'position_CM'
  | 'position_CB'
  | 'player'

export type MatchPlanSubTargetIn =
  | 'best_defender'
  | 'best_midfielder'
  | 'best_attacker'
  | 'best_fit'
  | 'player'

export type MatchPlanLinkedSub = {
  outKind: MatchPlanSubTargetOut
  outPlayerId?: string
  inKind: MatchPlanSubTargetIn
  inPlayerId?: string
}

export type MatchPlanInstructionPatch = {
  focus?: TacticalInstructionsV2['possession']['focus']
  passing?: TacticalInstructionsV2['possession']['passing']
  tempo?: TacticalInstructionsV2['possession']['tempo']
  width?: TacticalInstructionsV2['possession']['width']
  receiving?: 'feet' | 'mixed' | 'space'
  crossTiming?: 'balanced' | 'early'
  onGain?: TacticalInstructionsV2['transition']['onGain']
  onLoss?: TacticalInstructionsV2['transition']['onLoss']
  line?: TacticalInstructionsV2['defense']['line']
  engagement?: TacticalInstructionsV2['defense']['engagement']
  intensity?: TacticalInstructionsV2['defense']['intensity']
  defWidth?: 'narrow' | 'normal' | 'wide'
}

export type MatchPlanAction = {
  /** 切到指定备选战术槽（'base' = 恢复主战术，缺省 = 保持当前阵型仅调整心态/指令） */
  tacticSlotId?: BackupTacticId | 'base'
  /** 可选心态覆盖；切槽位且省略时使用槽位自带心态 */
  mentality?: MatchMentality
  /** 可选风格模板覆盖（不变阵，直接切换十二项指令） */
  tacticalStyle?: StyleId
  /** 可选高级单项指令微调（叠加在槽位/风格/主战术指令之上） */
  instructionPatch?: MatchPlanInstructionPatch
  /** 可选：该规则首次触发时顺带执行一次战术联动换人（共享 5 次换人名额） */
  linkedSub?: MatchPlanLinkedSub
}

export type MatchPlanRule = {
  id: string
  name: string
  enabled: boolean
  /** true = 单场仅触发一次并锁定为新基准（除非被更高优先级规则覆盖） */
  once?: boolean
  condition: MatchPlanCondition
  action: MatchPlanAction
}

/** 存入 MatchTeamState 的纯数据运行时状态（完全可序列化，保证读档/直播/回放逐位一致）。 */
export type MatchPlanRuleRuntimeState = {
  /** 当前生效规则 ID；null 表示主战术基线 */
  activeRuleId: string | null
  /** 上次切换时的比赛分钟数（用于 3 分钟防抖冷却） */
  lastSwitchMinute: number
  /** 上次评估时的有效净胜球（用于检测进球/丢球瞬间突破冷却） */
  lastScoreDiff: number
  /** 上次评估时的人数差 ownOnPitch - oppOnPitch（用于检测红牌瞬间突破冷却） */
  lastRedDiff: number
  /** 已触发过的一次性规则 ID 列表 */
  firedOnceRuleIds: string[]
  /** 已执行过联动换人的规则 ID 列表（每条规则整场最多联动换人 1 次） */
  linkedSubRuleIds: string[]
  /** 锁定中的一次性规则 ID（条件解除时回退到此规则而非主战术） */
  latchedRuleId?: string | null
}

/* ---------- 文案与枚举常量 ---------- */

export const SCORE_COND_OPTIONS: readonly { value: MatchPlanScoreCond; label: string }[] = [
  { value: 'any', label: '不限比分' },
  { value: 'leading', label: '领先（任意）' },
  { value: 'leading1', label: '领先 1 球' },
  { value: 'leading2', label: '领先 ≥2 球' },
  { value: 'drawing', label: '平局' },
  { value: 'trailing', label: '落后（任意）' },
  { value: 'trailing1', label: '落后 1 球' },
  { value: 'trailing2', label: '落后 ≥2 球' },
  { value: 'not_leading', label: '未领先（平/落后）' },
  { value: 'not_trailing', label: '未落后（平/领先）' },
]

export const RED_CARD_COND_OPTIONS: readonly { value: MatchPlanRedCardCond; label: string }[] = [
  { value: 'any', label: '不限人数' },
  { value: 'own_down', label: '我方少打一人（吃红牌）' },
  { value: 'opp_down', label: '对方少打一人（多打一人）' },
  { value: 'even', label: '双方人数相等' },
]

export const SUB_OUT_OPTIONS: readonly { value: MatchPlanSubTargetOut; label: string }[] = [
  { value: 'lowest_stamina', label: '体力最低的外场球员' },
  { value: 'position_ST', label: '体力最低的前锋 (ST)' },
  { value: 'position_W', label: '体力最低的边路 (W)' },
  { value: 'position_CM', label: '体力最低的中场 (CM)' },
  { value: 'position_CB', label: '体力最低的中卫 (CB)' },
  { value: 'player', label: '指定首发球员' },
]

export const SUB_IN_OPTIONS: readonly { value: MatchPlanSubTargetIn; label: string }[] = [
  { value: 'best_defender', label: '替补最佳后卫（防线加固）' },
  { value: 'best_midfielder', label: '替补最佳中场（控制拦截）' },
  { value: 'best_attacker', label: '替补最佳进攻手（加强火力）' },
  { value: 'best_fit', label: '按新阵型最契合替补' },
  { value: 'player', label: '指定替补球员' },
]

const VALID_SCORE_CONDS = new Set<string>(SCORE_COND_OPTIONS.map((o) => o.value))
const VALID_RED_CONDS = new Set<string>(RED_CARD_COND_OPTIONS.map((o) => o.value))
const VALID_SUB_OUT = new Set<string>(SUB_OUT_OPTIONS.map((o) => o.value))
const VALID_SUB_IN = new Set<string>(SUB_IN_OPTIONS.map((o) => o.value))
const VALID_MENTALITIES = new Set<string>(['attack', 'balanced', 'defend'])

const ACTIVE_ELEVEN_FORMATIONS = new Set<string>(
  Object.values(FORMATIONS)
    .filter((f) => !f.legacy)
    .map((f) => f.id),
)

export function isActiveElevenFormation(value: unknown): value is ElevenFormationId {
  return typeof value === 'string' && ACTIVE_ELEVEN_FORMATIONS.has(value)
}

/* ---------- 快捷备选战术模板 ---------- */

export type BackupTacticTemplateId = 'bus_532' | 'siege_343' | 'counter_442' | 'control_4141' | 'redcard_442'

export type BackupTacticTemplate = {
  id: BackupTacticTemplateId
  label: string
  desc: string
  build: (slotId: string) => BackupTactic
}

export const BACKUP_TACTIC_TEMPLATES: readonly BackupTacticTemplate[] = [
  {
    id: 'bus_532',
    label: '5-3-2 领先铁桶',
    desc: '三中卫+双翼卫收缩低位摆大巴，慢节奏护球锁死胜局。',
    build: (slotId) => ({
      id: slotId,
      name: '5-3-2 领先铁桶',
      formationId: '5-3-2',
      mentality: 'defend',
      tacticalStyle: 'parkBus',
      tacticalInstructions: cloneInstructions(STYLES_REV3.parkBus.instructions),
    }),
  },
  {
    id: 'siege_343',
    label: '3-4-3 落后搏命',
    desc: '三前锋+双翼卫全线压上高位围抢，直塞加尽早传中狂攻。',
    build: (slotId) => ({
      id: slotId,
      name: '3-4-3 落后搏命',
      formationId: '3-4-3',
      mentality: 'attack',
      tacticalStyle: 'highPress',
      tacticalInstructions: applyInstructionPatch(STYLES_REV3.highPress.instructions, {
        width: 'wide',
        passing: 'direct',
        receiving: 'space',
        crossTiming: 'early',
      }),
    }),
  },
  {
    id: 'counter_442',
    label: '4-4-2 稳守防反',
    desc: '两条紧凑防线收缩中路，断球瞬间直塞找双前锋打身后；红牌时自动变成 4-4-1。',
    build: (slotId) => ({
      id: slotId,
      name: '4-4-2 稳守防反',
      formationId: '4-4-2',
      mentality: 'defend',
      tacticalStyle: 'directCounter',
      tacticalInstructions: cloneInstructions(STYLES_REV3.directCounter.instructions),
    }),
  },
  {
    id: 'control_4141',
    label: '4-1-4-1 控场稳局',
    desc: '单后腰+四中场控球消磨对手体能，兼顾防守覆盖与中场人数优势。',
    build: (slotId) => ({
      id: slotId,
      name: '4-1-4-1 控场稳局',
      formationId: '4-1-4-1',
      mentality: 'balanced',
      tacticalStyle: 'control',
      tacticalInstructions: cloneInstructions(STYLES_REV3.control.instructions),
    }),
  },
  {
    id: 'redcard_442',
    label: '4-4-2 红牌收缩（10人变 4-4-1）',
    desc: '少打一人时自动撤下一名前锋居中成 4-4-1 紧凑阵型，低位回收防反保平/保胜。',
    build: (slotId) => ({
      id: slotId,
      name: '红牌 4-4-1 收缩',
      formationId: '4-4-2',
      mentality: 'defend',
      tacticalStyle: 'catenaccio',
      tacticalInstructions: cloneInstructions(STYLES_REV3.catenaccio.instructions),
    }),
  },
]

/* ---------- 指令补丁与强度计算 ---------- */

export function applyInstructionPatch(
  base: TacticalInstructionsV2,
  patch?: MatchPlanInstructionPatch | null,
): TacticalInstructionsV2 {
  const next = cloneInstructions(base)
  if (!patch) return normalizeInstructions(next)
  if (patch.focus) next.possession.focus = patch.focus
  if (patch.passing) next.possession.passing = patch.passing
  if (patch.tempo) next.possession.tempo = patch.tempo
  if (patch.width) next.possession.width = patch.width
  if (patch.onGain) next.transition.onGain = patch.onGain
  if (patch.onLoss) next.transition.onLoss = patch.onLoss
  if (patch.line) next.defense.line = patch.line
  if (patch.engagement) next.defense.engagement = patch.engagement
  if (patch.intensity) next.defense.intensity = patch.intensity
  if (patch.receiving || patch.crossTiming || patch.defWidth) {
    next.advanced = {
      ...next.advanced,
      ...(patch.receiving || patch.crossTiming
        ? {
            possession: {
              ...next.advanced?.possession,
              ...(patch.receiving ? { receiving: patch.receiving } : {}),
              ...(patch.crossTiming ? { crossTiming: patch.crossTiming } : {}),
            },
          }
        : {}),
      ...(patch.defWidth
        ? {
            defense: {
              ...next.advanced?.defense,
              width: patch.defWidth,
            },
          }
        : {}),
    }
  }
  return normalizeInstructions(next)
}

/** 由当前心态与十二项指令推导合理的压迫侵略度与跑动体能消耗倍率（与内置 14 计划同量纲）。 */
export function derivePlanIntensity(
  mentality: MatchMentality,
  instructions: TacticalInstructionsV2,
): { aggression: number; staminaMul: number } {
  let agg = 0.5
  let mul = 1.0
  if (mentality === 'attack') {
    agg += 0.14
    mul += 0.06
  } else if (mentality === 'defend') {
    agg -= 0.12
    mul -= 0.05
  }
  if (instructions.possession.tempo === 'fast') {
    agg += 0.05
    mul += 0.05
  } else if (instructions.possession.tempo === 'slow') {
    agg -= 0.04
    mul -= 0.04
  }
  if (instructions.defense.intensity === 'high') {
    agg += 0.08
    mul += 0.05
  } else if (instructions.defense.intensity === 'low') {
    agg -= 0.07
    mul -= 0.04
  }
  if (instructions.transition.onLoss === 'counterpress') {
    agg += 0.06
    mul += 0.04
  } else if (instructions.transition.onLoss === 'regroup') {
    agg -= 0.04
    mul -= 0.03
  }
  if (instructions.defense.line === 'high') {
    agg += 0.03
    mul += 0.02
  } else if (instructions.defense.line === 'low') {
    agg -= 0.03
    mul -= 0.02
  }
  return {
    aggression: Math.round(Math.min(0.86, Math.max(0.24, agg)) * 100) / 100,
    staminaMul: Math.round(Math.min(1.18, Math.max(0.84, mul)) * 100) / 100,
  }
}

/** 获取球队赛后实际体能消耗倍率：启用自定义规则时按各阶段实际踢的时长加权，否则走内置计划表。 */
export function effectiveMatchConditionFactor(
  team?: Pick<MatchTeamState, 'matchPlan' | 'planConditionFactor'>,
): number {
  if (typeof team?.planConditionFactor === 'number' && Number.isFinite(team.planConditionFactor)) {
    return Math.min(1.18, Math.max(0.84, team.planConditionFactor))
  }
  return matchPlanConditionFactor(team?.matchPlan)
}

/* ---------- 校验与清理 ---------- */

function validateInstructionPatch(patch: unknown, prefix: string, errors: string[]): void {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    errors.push(`${prefix}指令微调必须是对象`)
    return
  }
  const p = patch as Record<string, unknown>
  const allowed = new Set(['focus', 'passing', 'tempo', 'width', 'receiving', 'crossTiming', 'onGain', 'onLoss', 'line', 'engagement', 'intensity', 'defWidth'])
  for (const key of Object.keys(p)) {
    if (!allowed.has(key)) errors.push(`${prefix}指令微调存在未知字段：${key}`)
  }
  if (p.focus !== undefined && !['middle', 'balanced', 'wing'].includes(String(p.focus))) errors.push(`${prefix}进攻方向无效`)
  if (p.passing !== undefined && !['short', 'mixed', 'direct'].includes(String(p.passing))) errors.push(`${prefix}传球倾向无效`)
  if (p.tempo !== undefined && !['slow', 'normal', 'fast'].includes(String(p.tempo))) errors.push(`${prefix}节奏无效`)
  if (p.width !== undefined && !['narrow', 'normal', 'wide'].includes(String(p.width))) errors.push(`${prefix}持球宽度无效`)
  if (p.receiving !== undefined && !['feet', 'mixed', 'space'].includes(String(p.receiving))) errors.push(`${prefix}接球偏好无效`)
  if (p.crossTiming !== undefined && !['balanced', 'early'].includes(String(p.crossTiming))) errors.push(`${prefix}传中时机无效`)
  if (p.onGain !== undefined && !['hold', 'balanced', 'counter'].includes(String(p.onGain))) errors.push(`${prefix}得球转换无效`)
  if (p.onLoss !== undefined && !['regroup', 'balanced', 'counterpress'].includes(String(p.onLoss))) errors.push(`${prefix}丢球转换无效`)
  if (p.line !== undefined && !['low', 'mid', 'high'].includes(String(p.line))) errors.push(`${prefix}防线高度无效`)
  if (p.engagement !== undefined && !['low', 'mid', 'high'].includes(String(p.engagement))) errors.push(`${prefix}逼抢线无效`)
  if (p.intensity !== undefined && !['low', 'mid', 'high'].includes(String(p.intensity))) errors.push(`${prefix}压迫频率无效`)
  if (p.defWidth !== undefined && !['narrow', 'normal', 'wide'].includes(String(p.defWidth))) errors.push(`${prefix}防守宽度无效`)
}

export function validateBackupTactics(raw: unknown): string[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return ['备选战术槽必须是数组']
  const errors: string[] = []
  if (raw.length > MAX_BACKUP_TACTICS) errors.push(`备选战术槽最多 ${MAX_BACKUP_TACTICS} 套`)
  const ids = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i]
    const label = `备选战术槽 #${i + 1}`
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`${label}格式错误`)
      continue
    }
    const slot = item as Record<string, unknown>
    if (typeof slot.id !== 'string' || !slot.id.trim() || slot.id === 'base') {
      errors.push(`${label}缺少合法 ID`)
    } else if (ids.has(slot.id)) {
      errors.push(`${label}ID 重复：${slot.id}`)
    } else {
      ids.add(slot.id)
    }
    if (typeof slot.name !== 'string' || !slot.name.trim() || [...slot.name.trim()].length > BACKUP_TACTIC_NAME_LIMIT) {
      errors.push(`${label}名称不能为空且最多 ${BACKUP_TACTIC_NAME_LIMIT} 字`)
    }
    if (!isActiveElevenFormation(slot.formationId)) {
      errors.push(`${label}阵型无效：${String(slot.formationId)}`)
      continue
    }
    const formation = FORMATIONS[slot.formationId]
    const slotMap = new Map(formation.slots.map((s) => [s.id, s]))
    if (!VALID_MENTALITIES.has(String(slot.mentality))) {
      errors.push(`${label}心态无效`)
    }
    if (slot.tacticalStyle !== undefined && !isStyleId(slot.tacticalStyle)) {
      errors.push(`${label}战术风格无效`)
    }
    const instCheck = tryValidateInstructions(slot.tacticalInstructions)
    if (!instCheck.ok) {
      errors.push(`${label}战术指令无效：${instCheck.error}`)
    }
    if (slot.slotRoles !== undefined) {
      if (!slot.slotRoles || typeof slot.slotRoles !== 'object' || Array.isArray(slot.slotRoles)) {
        errors.push(`${label}槽位职责映射格式错误`)
      } else {
        for (const [slotId, roleId] of Object.entries(slot.slotRoles as Record<string, unknown>)) {
          const fSlot = slotMap.get(slotId)
          if (!fSlot) {
            errors.push(`${label}包含不在阵型中的槽位职责：${slotId}`)
            continue
          }
          const role = ROLES[roleId as RoleId]
          if (!role || role.position !== fSlot.position) {
            errors.push(`${label}槽位 ${fSlot.label} 职责不匹配`)
          }
        }
      }
    }
    if (slot.customPositions !== undefined) {
      if (!slot.customPositions || typeof slot.customPositions !== 'object' || Array.isArray(slot.customPositions)) {
        errors.push(`${label}自定义摆位格式错误`)
      } else {
        for (const [slotId, spot] of Object.entries(slot.customPositions as Record<string, unknown>)) {
          if (!slotMap.has(slotId)) {
            errors.push(`${label}包含不在阵型中的自定义摆位：${slotId}`)
            continue
          }
          const s = spot as Record<string, unknown> | null
          if (!s || typeof s.x !== 'number' || typeof s.y !== 'number' || !Number.isFinite(s.x) || !Number.isFinite(s.y) || s.x < 0 || s.x > 1 || s.y < 0 || s.y > 1) {
            errors.push(`${label}槽位 ${slotId} 坐标无效`)
          }
        }
      }
    }
    if (slot.preferredPlayers !== undefined) {
      if (!slot.preferredPlayers || typeof slot.preferredPlayers !== 'object' || Array.isArray(slot.preferredPlayers)) {
        errors.push(`${label}偏好球员映射格式错误`)
      } else {
        for (const [slotId, pid] of Object.entries(slot.preferredPlayers as Record<string, unknown>)) {
          if (!slotMap.has(slotId) || typeof pid !== 'string') {
            errors.push(`${label}偏好球员槽位 ${slotId} 格式无效`)
          }
        }
      }
    }
  }
  return errors
}

export function validateMatchPlanRules(raw: unknown, backupTactics?: readonly BackupTactic[]): string[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return ['自定义比赛计划规则必须是数组']
  const errors: string[] = []
  if (raw.length > MAX_MATCH_PLAN_RULES) errors.push(`比赛计划规则最多 ${MAX_MATCH_PLAN_RULES} 条`)
  const validSlotIds = new Set<string>(['base', ...(backupTactics ?? []).map((b) => b.id)])
  const ids = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i]
    const label = `比赛计划规则 #${i + 1}：`
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`${label}格式错误`)
      continue
    }
    const r = item as Record<string, unknown>
    if (typeof r.id !== 'string' || !r.id.trim()) errors.push(`${label}缺少 ID`)
    else if (ids.has(r.id)) errors.push(`${label}ID 重复`)
    else ids.add(r.id)
    if (typeof r.name !== 'string' || !r.name.trim() || [...r.name.trim()].length > RULE_NAME_LIMIT) {
      errors.push(`${label}名称不能为空且最多 ${RULE_NAME_LIMIT} 字`)
    }
    if (typeof r.enabled !== 'boolean') errors.push(`${label}enabled 必须是布尔值`)
    if (r.once !== undefined && typeof r.once !== 'boolean') errors.push(`${label}once 必须是布尔值`)

    if (!r.condition || typeof r.condition !== 'object' || Array.isArray(r.condition)) {
      errors.push(`${label}缺少触发条件`)
    } else {
      const c = r.condition as Record<string, unknown>
      const minM = c.minMinute === undefined ? 0 : c.minMinute
      const maxM = c.maxMinute === undefined ? 90 : c.maxMinute
      if (typeof minM !== 'number' || !Number.isFinite(minM) || minM < 0 || minM >= 90) {
        errors.push(`${label}起始分钟须在 0–89 之间`)
      }
      if (typeof maxM !== 'number' || !Number.isFinite(maxM) || maxM <= 0 || maxM > 90) {
        errors.push(`${label}结束分钟须在 1–90 之间`)
      }
      if (typeof minM === 'number' && typeof maxM === 'number' && minM >= maxM) {
        errors.push(`${label}起始分钟必须小于结束分钟`)
      }
      if (c.score !== undefined && !VALID_SCORE_CONDS.has(String(c.score))) {
        errors.push(`${label}比分条件无效`)
      }
      if (c.redCard !== undefined && !VALID_RED_CONDS.has(String(c.redCard))) {
        errors.push(`${label}红牌人数条件无效`)
      }
      if (c.avgStaminaBelow !== undefined && (typeof c.avgStaminaBelow !== 'number' || !Number.isFinite(c.avgStaminaBelow) || c.avgStaminaBelow < 1 || c.avgStaminaBelow > 99)) {
        errors.push(`${label}平均体能阈值须在 1–99 之间`)
      }
    }

    if (!r.action || typeof r.action !== 'object' || Array.isArray(r.action)) {
      errors.push(`${label}缺少执行动作`)
    } else {
      const a = r.action as Record<string, unknown>
      if (a.tacticSlotId !== undefined && a.tacticSlotId !== '' && !validSlotIds.has(String(a.tacticSlotId))) {
        errors.push(`${label}引用的备选战术槽不存在：${String(a.tacticSlotId)}`)
      }
      if (a.mentality !== undefined && !VALID_MENTALITIES.has(String(a.mentality))) {
        errors.push(`${label}心态设置无效`)
      }
      if (a.tacticalStyle !== undefined && !isStyleId(a.tacticalStyle)) {
        errors.push(`${label}战术风格无效`)
      }
      if (a.instructionPatch !== undefined) {
        validateInstructionPatch(a.instructionPatch, label, errors)
      }
      if (a.linkedSub !== undefined) {
        if (!a.linkedSub || typeof a.linkedSub !== 'object' || Array.isArray(a.linkedSub)) {
          errors.push(`${label}联动换人格式错误`)
        } else {
          const sub = a.linkedSub as Record<string, unknown>
          if (!VALID_SUB_OUT.has(String(sub.outKind))) errors.push(`${label}换下目标类型无效`)
          if (!VALID_SUB_IN.has(String(sub.inKind))) errors.push(`${label}换上目标类型无效`)
          if (sub.outPlayerId !== undefined && typeof sub.outPlayerId !== 'string') errors.push(`${label}换下球员 ID 无效`)
          if (sub.inPlayerId !== undefined && typeof sub.inPlayerId !== 'string') errors.push(`${label}换上球员 ID 无效`)
        }
      }
    }
  }
  return errors
}

/** 删除备选槽后自动清理失效的槽位引用。 */
export function sanitizeMatchPlanRules(
  rules: MatchPlanRule[] | undefined,
  backupTactics: readonly BackupTactic[] | undefined,
): MatchPlanRule[] | undefined {
  if (!rules?.length) return rules
  const valid = new Set<string>(['base', ...(backupTactics ?? []).map((b) => b.id)])
  return rules.map((rule) => {
    const next = structuredClone(rule)
    if (next.action.tacticSlotId && !valid.has(next.action.tacticSlotId)) {
      delete next.action.tacticSlotId
    }
    return next
  })
}

/* ---------- 构造工具：从当前战术板快照 / 从内置 14 套计划导入 / FM 经典三槽 ---------- */

export function backupTacticFromLineup(
  lineup: Pick<Lineup, 'formationId' | 'starters' | 'tactics' | 'tacticalStyle' | 'tacticalInstructions' | 'customPositions'>,
  id: string,
  name: string,
  mentality: MatchMentality = 'balanced',
): BackupTactic {
  const formationId: ElevenFormationId = isActiveElevenFormation(lineup.formationId) ? lineup.formationId : '4-4-2'
  const slotIds = new Set(FORMATIONS[formationId].slots.map((s) => s.id))
  const instructions = lineup.tacticalInstructions
    ? cloneInstructions(lineup.tacticalInstructions)
    : instructionsFromLegacyTactics(lineup.tactics)
  const slotRoles: Record<string, RoleId> = {}
  const preferredPlayers: Record<string, string> = {}
  for (const starter of lineup.starters) {
    if (!slotIds.has(starter.slotId)) continue
    const fSlot = FORMATIONS[formationId].slots.find((s) => s.id === starter.slotId)
    if (fSlot && ROLES[starter.role]?.position === fSlot.position) {
      slotRoles[starter.slotId] = starter.role
    }
    if (starter.playerId) preferredPlayers[starter.slotId] = starter.playerId
  }
  let customPositions: Record<string, { x: number; y: number }> | undefined
  if (lineup.customPositions) {
    const kept = Object.entries(lineup.customPositions).filter(([slotId]) => slotIds.has(slotId))
    if (kept.length) customPositions = Object.fromEntries(kept.map(([k, v]) => [k, { x: v.x, y: v.y }]))
  }
  const style = lineup.tacticalStyle && isStyleId(lineup.tacticalStyle)
    ? lineup.tacticalStyle
    : inferStyleForInstructions(instructions).styleId
  return {
    id,
    name: name.trim() || `${formationId} 备选`,
    formationId,
    mentality,
    tacticalStyle: style,
    tacticalInstructions: normalizeInstructions(instructions),
    ...(Object.keys(slotRoles).length ? { slotRoles } : {}),
    ...(customPositions ? { customPositions } : {}),
    ...(Object.keys(preferredPlayers).length ? { preferredPlayers } : {}),
  }
}

export function nextBackupTacticId(existing: readonly BackupTactic[] | undefined): string {
  const used = new Set((existing ?? []).map((b) => b.id))
  for (let i = 2; i <= 10; i++) {
    const id = `slot-${i}`
    if (!used.has(id)) return id
  }
  return `slot-${Date.now().toString(36)}`
}

export function nextMatchPlanRuleId(existing: readonly MatchPlanRule[] | undefined): string {
  const used = new Set((existing ?? []).map((r) => r.id))
  for (let i = 1; i <= 30; i++) {
    const id = `rule-${i}`
    if (!used.has(id)) return id
  }
  return `rule-${Date.now().toString(36)}`
}

/** 一键创建 FM 经典「三战术槽 + 智能比赛计划」套件。 */
export function createFMClassicBundle(currentFormationId: FormationId): {
  backupTactics: BackupTactic[]
  matchPlanRules: MatchPlanRule[]
} {
  const defendSlot = BACKUP_TACTIC_TEMPLATES.find((t) => t.id === 'bus_532')!.build('slot-2')
  const attackSlot = BACKUP_TACTIC_TEMPLATES.find((t) => t.id === 'siege_343')!.build('slot-3')
  const redSlot = BACKUP_TACTIC_TEMPLATES.find((t) => t.id === 'redcard_442')!.build('slot-4')
  const backupTactics = [defendSlot, attackSlot, redSlot]
  const matchPlanRules: MatchPlanRule[] = [
    {
      id: 'rule-1',
      name: '红牌少打一人：立刻收缩 4-4-1',
      enabled: true,
      condition: { minMinute: 0, maxMinute: 90, redCard: 'own_down' },
      action: { tacticSlotId: redSlot.id, mentality: 'defend' },
    },
    {
      id: 'rule-2',
      name: '70′ 后领先：切 5-3-2 铁桶 + 换上后卫',
      enabled: true,
      condition: { minMinute: 70, maxMinute: 90, score: 'leading', redCard: 'any' },
      action: {
        tacticSlotId: defendSlot.id,
        mentality: 'defend',
        linkedSub: { outKind: 'position_ST', inKind: 'best_defender' },
      },
    },
    {
      id: 'rule-3',
      name: '60′ 后落后：切 3-4-3 全线搏命 + 换上攻击手',
      enabled: true,
      condition: { minMinute: 60, maxMinute: 90, score: 'trailing', redCard: 'any' },
      action: {
        tacticSlotId: attackSlot.id,
        mentality: 'attack',
        linkedSub: { outKind: currentFormationId === '5-3-2' || currentFormationId === '3-5-2' ? 'position_CB' : 'lowest_stamina', inKind: 'best_attacker' },
      },
    },
    {
      id: 'rule-4',
      name: '对方吃红牌：多打一人提速压制',
      enabled: true,
      condition: { minMinute: 0, maxMinute: 90, redCard: 'opp_down', score: 'not_leading' },
      action: {
        mentality: 'attack',
        instructionPatch: { tempo: 'fast', line: 'high', engagement: 'high', onLoss: 'counterpress' },
      },
    },
  ]
  return { backupTactics, matchPlanRules }
}

/** 把现有的 14 套官方比赛计划一键展开成可自由编辑的 FM 规则列表。 */
export function rulesFromBuiltInMatchPlan(planId: MatchPlanId): MatchPlanRule[] {
  if (!isMatchPlanId(planId) || planId === 'standard') return []
  const rule = (
    idx: number,
    name: string,
    condition: MatchPlanCondition,
    action: MatchPlanAction,
  ): MatchPlanRule => ({ id: `rule-${idx}`, name, enabled: true, condition, action })

  switch (planId) {
    case 'allOutWin':
      return [
        rule(1, '75′ 领先≥2球：高位控胜', { minMinute: 75, maxMinute: 90, score: 'leading2' }, {
          mentality: 'balanced',
          instructionPatch: { tempo: 'normal', onGain: 'balanced', onLoss: 'counterpress', line: 'mid', engagement: 'high', intensity: 'mid' },
        }),
        rule(2, '60′ 仍未领先：全线总攻', { minMinute: 60, maxMinute: 90, score: 'not_leading' }, {
          mentality: 'attack',
          instructionPatch: { passing: 'direct', tempo: 'fast', width: 'wide', receiving: 'space', crossTiming: 'early', onGain: 'counter', onLoss: 'counterpress', line: 'high', engagement: 'high', intensity: 'high' },
        }),
        rule(3, '开场积极抢攻', { minMinute: 0, maxMinute: 90, score: 'any' }, {
          mentality: 'attack',
          instructionPatch: { tempo: 'fast', receiving: 'space', onGain: 'counter', onLoss: 'counterpress', line: 'high', engagement: 'high', intensity: 'high' },
        }),
      ]
    case 'parkTheBus':
      return [
        rule(1, '全场铁桶大巴', { minMinute: 0, maxMinute: 90, score: 'any' }, {
          mentality: 'defend',
          tacticalStyle: 'parkBus',
          instructionPatch: { passing: 'short', tempo: 'slow', width: 'narrow', onGain: 'hold', onLoss: 'regroup', line: 'low', engagement: 'low', intensity: 'low', defWidth: 'narrow' },
        }),
      ]
    case 'fastStart':
      return [
        rule(1, '前25分钟开局抢攻', { minMinute: 0, maxMinute: 25, score: 'any' }, {
          mentality: 'attack',
          instructionPatch: { tempo: 'fast', receiving: 'space', onGain: 'counter', onLoss: 'counterpress', line: 'high', engagement: 'high', intensity: 'high' },
        }),
        rule(2, '25′后已领先：收网稳局', { minMinute: 25, maxMinute: 90, score: 'leading' }, {
          mentality: 'defend',
          instructionPatch: { tempo: 'slow', onGain: 'hold', onLoss: 'regroup', line: 'mid', engagement: 'mid', intensity: 'mid' },
        }),
      ]
    case 'protectLead':
      return [
        rule(1, '70′后领先：终场铁桶锁门', { minMinute: 70, maxMinute: 90, score: 'leading' }, {
          mentality: 'defend',
          instructionPatch: { passing: 'short', tempo: 'slow', width: 'narrow', receiving: 'feet', onGain: 'hold', onLoss: 'regroup', line: 'low', engagement: 'low', intensity: 'low', defWidth: 'narrow' },
        }),
        rule(2, '领先阶段：稳健控局', { minMinute: 0, maxMinute: 70, score: 'leading' }, {
          mentality: 'defend',
          instructionPatch: { tempo: 'slow', receiving: 'feet', onGain: 'hold', onLoss: 'regroup', line: 'mid', engagement: 'mid', intensity: 'mid' },
        }),
      ]
    case 'lateSiege':
      return [
        rule(1, '60′后落后：末段围攻', { minMinute: 60, maxMinute: 90, score: 'trailing' }, {
          mentality: 'attack',
          instructionPatch: { passing: 'direct', tempo: 'fast', width: 'wide', receiving: 'space', crossTiming: 'early', onGain: 'counter', onLoss: 'counterpress', line: 'high', engagement: 'high', intensity: 'high' },
        }),
        rule(2, '75′后平局：末段围攻抢绝杀', { minMinute: 75, maxMinute: 90, score: 'drawing' }, {
          mentality: 'attack',
          instructionPatch: { passing: 'direct', tempo: 'fast', width: 'wide', receiving: 'space', crossTiming: 'early', onGain: 'counter', onLoss: 'counterpress', line: 'high', engagement: 'high', intensity: 'high' },
        }),
        rule(3, '前60分钟未落后：稳守蓄力', { minMinute: 0, maxMinute: 60, score: 'not_trailing' }, {
          mentality: 'balanced',
          instructionPatch: { tempo: 'slow', onGain: 'balanced', onLoss: 'regroup', line: 'mid', intensity: 'low' },
        }),
      ]
    case 'counterTrap':
      return [
        rule(1, '75′后仍落后：前压反扑', { minMinute: 75, maxMinute: 90, score: 'trailing' }, {
          mentality: 'attack',
          instructionPatch: { passing: 'direct', tempo: 'fast', receiving: 'space', onGain: 'counter', onLoss: 'counterpress', line: 'high', engagement: 'high', intensity: 'high' },
        }),
        rule(2, '常态低位伏击反击', { minMinute: 0, maxMinute: 90, score: 'any' }, {
          mentality: 'defend',
          tacticalStyle: 'directCounter',
          instructionPatch: { passing: 'direct', tempo: 'fast', receiving: 'space', onGain: 'counter', onLoss: 'regroup', line: 'low', engagement: 'low', intensity: 'mid', defWidth: 'narrow' },
        }),
      ]
    case 'highPressBlitz':
      return [
        rule(1, '75′领先≥2球：高位转稳', { minMinute: 75, maxMinute: 90, score: 'leading2' }, {
          mentality: 'balanced',
          instructionPatch: { tempo: 'normal', onGain: 'balanced', onLoss: 'balanced', line: 'mid', engagement: 'high', intensity: 'mid' },
        }),
        rule(2, '全场高压绞杀', { minMinute: 0, maxMinute: 90, score: 'any' }, {
          mentality: 'attack',
          tacticalStyle: 'highPress',
          instructionPatch: { tempo: 'fast', onGain: 'counter', onLoss: 'counterpress', line: 'high', engagement: 'high', intensity: 'high' },
        }),
      ]
    case 'wingBombard':
      return [
        rule(1, '60′后未领先：两翼高空强袭', { minMinute: 60, maxMinute: 90, score: 'not_leading' }, {
          mentality: 'attack',
          instructionPatch: { focus: 'wing', passing: 'direct', tempo: 'fast', width: 'wide', receiving: 'space', crossTiming: 'early', onGain: 'counter', onLoss: 'counterpress', line: 'high', engagement: 'high', intensity: 'high' },
        }),
        rule(2, '常态两翼齐飞传中', { minMinute: 0, maxMinute: 90, score: 'any' }, {
          mentality: 'balanced',
          instructionPatch: { focus: 'wing', width: 'wide', crossTiming: 'early', onGain: 'counter' },
        }),
      ]
    case 'controlTempo':
      return [
        rule(1, '落后时提速渗透', { minMinute: 0, maxMinute: 90, score: 'trailing' }, {
          mentality: 'attack',
          instructionPatch: { passing: 'short', tempo: 'normal', receiving: 'space', onGain: 'balanced', onLoss: 'counterpress', line: 'high', engagement: 'high', intensity: 'high' },
        }),
        rule(2, '未落后时催眠控球', { minMinute: 0, maxMinute: 90, score: 'not_trailing' }, {
          mentality: 'balanced',
          instructionPatch: { passing: 'short', tempo: 'slow', receiving: 'feet', onGain: 'hold', onLoss: 'balanced', line: 'mid', engagement: 'mid', intensity: 'low' },
        }),
      ]
    case 'conserveStamina':
      return [
        rule(1, '75′落后1球：末段抢分', { minMinute: 75, maxMinute: 90, score: 'trailing1' }, {
          mentality: 'balanced',
          instructionPatch: { tempo: 'normal', onGain: 'counter', onLoss: 'balanced', line: 'mid', engagement: 'mid', intensity: 'mid' },
        }),
        rule(2, '常态低耗巡航省体', { minMinute: 0, maxMinute: 90, score: 'any' }, {
          mentality: 'defend',
          instructionPatch: { passing: 'short', tempo: 'slow', receiving: 'feet', onGain: 'hold', onLoss: 'regroup', line: 'low', engagement: 'low', intensity: 'low' },
        }),
      ]
    case 'underdogGrind':
      return [
        rule(1, '落后≥2球：被迫反扑', { minMinute: 0, maxMinute: 90, score: 'trailing2' }, {
          mentality: 'attack',
          instructionPatch: { passing: 'direct', tempo: 'fast', receiving: 'space', onGain: 'counter', onLoss: 'counterpress', line: 'mid', engagement: 'high', intensity: 'high' },
        }),
        rule(2, '70′未领先：奇袭亮剑', { minMinute: 70, maxMinute: 90, score: 'not_leading' }, {
          mentality: 'attack',
          instructionPatch: { passing: 'direct', tempo: 'fast', receiving: 'space', crossTiming: 'early', onGain: 'counter', onLoss: 'balanced', line: 'mid', engagement: 'mid', intensity: 'high' },
        }),
        rule(3, '常态铁桶蓄力', { minMinute: 0, maxMinute: 90, score: 'any' }, {
          mentality: 'defend',
          instructionPatch: { passing: 'mixed', tempo: 'slow', width: 'narrow', onGain: 'hold', onLoss: 'regroup', line: 'low', engagement: 'low', intensity: 'low', defWidth: 'narrow' },
        }),
      ]
    case 'twoGoalCushion':
      return [
        rule(1, '领先≥2球：两球锁胜', { minMinute: 0, maxMinute: 90, score: 'leading2' }, {
          mentality: 'defend',
          instructionPatch: { passing: 'short', tempo: 'slow', receiving: 'feet', onGain: 'hold', onLoss: 'regroup', line: 'mid', engagement: 'low', intensity: 'low' },
        }),
        rule(2, '未达两球优势：扩大战果', { minMinute: 0, maxMinute: 90, score: 'any' }, {
          mentality: 'attack',
          instructionPatch: { tempo: 'fast', receiving: 'space', onGain: 'counter', onLoss: 'counterpress', line: 'high', engagement: 'high', intensity: 'high' },
        }),
      ]
    case 'cupHoldout':
      return [
        rule(1, '总比分领先：死守晋级', { minMinute: 0, maxMinute: 90, score: 'leading' }, {
          mentality: 'defend',
          instructionPatch: { passing: 'short', tempo: 'slow', width: 'narrow', onGain: 'hold', onLoss: 'regroup', line: 'low', engagement: 'low', intensity: 'low', defWidth: 'narrow' },
        }),
        rule(2, '65′总比分平：力保点球', { minMinute: 65, maxMinute: 90, score: 'drawing' }, {
          mentality: 'defend',
          instructionPatch: { passing: 'short', tempo: 'slow', width: 'narrow', receiving: 'feet', onGain: 'hold', onLoss: 'regroup', line: 'low', engagement: 'low', intensity: 'low', defWidth: 'narrow' },
        }),
        rule(3, '70′总比分落后：全线搏命', { minMinute: 70, maxMinute: 90, score: 'trailing' }, {
          mentality: 'attack',
          instructionPatch: { passing: 'direct', tempo: 'fast', width: 'wide', receiving: 'space', crossTiming: 'early', onGain: 'counter', onLoss: 'counterpress', line: 'high', engagement: 'high', intensity: 'high' },
        }),
        rule(4, '总比分落后：破釜沉舟', { minMinute: 0, maxMinute: 70, score: 'trailing' }, {
          mentality: 'attack',
          instructionPatch: { tempo: 'fast', receiving: 'space', onGain: 'counter', onLoss: 'counterpress', line: 'high', engagement: 'high', intensity: 'high' },
        }),
      ]
  }
}

/* ---------- 条件评估（确定性纯函数） ---------- */

export interface CustomPlanEvalContext {
  minute: number
  scoreDiff: number
  effectiveDiff: number
  ownOnPitch: number
  oppOnPitch: number
  avgStaminaPct: number
  isKickoff: boolean
}

function matchesScoreCond(cond: MatchPlanScoreCond | undefined, diff: number): boolean {
  switch (cond) {
    case 'leading': return diff > 0
    case 'leading1': return diff === 1
    case 'leading2': return diff >= 2
    case 'drawing': return diff === 0
    case 'trailing': return diff < 0
    case 'trailing1': return diff === -1
    case 'trailing2': return diff <= -2
    case 'not_leading': return diff <= 0
    case 'not_trailing': return diff >= 0
    case 'any':
    case undefined:
      return true
  }
}

function matchesRedCardCond(cond: MatchPlanRedCardCond | undefined, ownOnPitch: number, oppOnPitch: number): boolean {
  switch (cond) {
    case 'own_down': return ownOnPitch < oppOnPitch
    case 'opp_down': return ownOnPitch > oppOnPitch
    case 'even': return ownOnPitch === oppOnPitch
    case 'any':
    case undefined:
      return true
  }
}

export function ruleMatchesContext(rule: MatchPlanRule, ctx: CustomPlanEvalContext): boolean {
  if (!rule.enabled) return false
  const minM = rule.condition.minMinute ?? 0
  const maxM = rule.condition.maxMinute ?? 90
  if (ctx.minute < minM) return false
  if (maxM < 90 ? ctx.minute >= maxM : ctx.minute > 90.5) return false
  if (!matchesScoreCond(rule.condition.score, ctx.effectiveDiff)) return false
  if (!matchesRedCardCond(rule.condition.redCard, ctx.ownOnPitch, ctx.oppOnPitch)) return false
  if (rule.condition.avgStaminaBelow !== undefined && ctx.avgStaminaPct >= rule.condition.avgStaminaBelow) {
    return false
  }
  return true
}

export interface CustomPlanEvalResult {
  changed: boolean
  /** 命中的规则；null 表示恢复主战术基线 */
  rule: MatchPlanRule | null
  /** 仅用于判断是否真有变动的目标键（'base' 或 rule.id） */
  targetKey: string
  nextState: MatchPlanRuleRuntimeState
}

/**
 * 评估自定义比赛计划规则（按列表优先级从上到下）。
 * - 进球/丢球/红牌变化视为紧急事件，立即无视 3 分钟防抖冷却响应；
 * - 常规时间/体能边界切换遵守 3 分钟冷却（首次从基线切出不受冷却限制，确保 60'/70' 准点触发）。
 */
export function evaluateCustomMatchPlanRules(
  rules: readonly MatchPlanRule[],
  ctx: CustomPlanEvalContext,
  prev?: MatchPlanRuleRuntimeState,
): CustomPlanEvalResult {
  const redDiff = ctx.ownOnPitch - ctx.oppOnPitch
  const state: MatchPlanRuleRuntimeState = prev
    ? {
        activeRuleId: prev.activeRuleId,
        lastSwitchMinute: prev.lastSwitchMinute,
        lastScoreDiff: prev.lastScoreDiff,
        lastRedDiff: prev.lastRedDiff,
        firedOnceRuleIds: [...prev.firedOnceRuleIds],
        linkedSubRuleIds: [...prev.linkedSubRuleIds],
        latchedRuleId: prev.latchedRuleId ?? null,
      }
    : {
        activeRuleId: null,
        lastSwitchMinute: -99,
        lastScoreDiff: ctx.effectiveDiff,
        lastRedDiff: redDiff,
        firedOnceRuleIds: [],
        linkedSubRuleIds: [],
        latchedRuleId: null,
      }

  const urgent = ctx.isKickoff || ctx.effectiveDiff !== state.lastScoreDiff || redDiff !== state.lastRedDiff
  state.lastScoreDiff = ctx.effectiveDiff
  state.lastRedDiff = redDiff

  // 按列表顺序找第一条命中的可用规则；已经触发过的 once 规则不再重复新触发，但如果是当前锁定基准可保底生效。
  let matched: MatchPlanRule | null = null
  for (const rule of rules) {
    if (!rule.enabled) continue
    if (rule.once && state.firedOnceRuleIds.includes(rule.id)) continue
    if (ruleMatchesContext(rule, ctx)) {
      matched = rule
      break
    }
  }

  // 若无新规则命中且存在 once 锁定规则，继续维持锁定规则而不回退到主战术
  const latched = !matched && state.latchedRuleId
    ? rules.find((r) => r.id === state.latchedRuleId && r.enabled) ?? null
    : null
  const desired = matched ?? latched
  const desiredId = desired?.id ?? null

  if (desiredId === state.activeRuleId) {
    return { changed: false, rule: desired, targetKey: desiredId ?? 'base', nextState: state }
  }

  // 防抖冷却：紧急变化（开球/进球/丢球/红牌）或距上次切换 >= 3 分钟才允许切换
  if (!urgent && ctx.minute - state.lastSwitchMinute < RULE_COOLDOWN_MINUTES) {
    const activeRule = state.activeRuleId ? rules.find((r) => r.id === state.activeRuleId) ?? null : null
    return { changed: false, rule: activeRule, targetKey: state.activeRuleId ?? 'base', nextState: state }
  }

  state.activeRuleId = desiredId
  state.lastSwitchMinute = ctx.minute
  if (matched?.once) {
    if (!state.firedOnceRuleIds.includes(matched.id)) state.firedOnceRuleIds.push(matched.id)
    state.latchedRuleId = matched.id
  }

  return {
    changed: true,
    rule: desired,
    targetKey: desiredId ?? 'base',
    nextState: state,
  }
}

/* ---------- 赛中动态变阵：最优排位算法（匈牙利最大权二分匹配 + 少打一人智能适配） ---------- */

/** MatchPlayerState.attrs 已经是 0–100 尺度，不能再次调 attrRating。 */
function matchPlayerRoleFit(player: MatchPlayerState, roleId: RoleId): number {
  const role = ROLES[roleId]
  let sum = 0
  let total = 0
  for (const [key, weight] of Object.entries(role.weights) as [keyof MatchPlayerState['attrs'], number][]) {
    sum += (player.attrs[key] ?? 50) * weight
    total += weight
  }
  return total > 0 ? sum / total : 50
}

function matchPlayerOutfieldScore(player: MatchPlayerState): number {
  const a = player.attrs
  return (a.passing + a.dribbling + a.shooting + a.tackling + a.defPos + a.speed + a.vision + a.decisions) / 8
}

/**
 * 匈牙利算法（Kuhn-Munkres）求解 n×n 最大权二分匹配（n <= 10，耗时 < 0.01ms，完全确定性）。
 * 返回 assignment[row] = col。
 */
function maxWeightMatching(weights: number[][]): number[] {
  const n = weights.length
  if (n === 0) return []
  const m = weights[0].length
  const size = Math.max(n, m)
  // 转为最小化代价矩阵：cost = maxW - w
  let maxW = -Infinity
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (weights[i][j] > maxW) maxW = weights[i][j]
    }
  }
  if (!Number.isFinite(maxW)) maxW = 0

  const cost: number[][] = Array.from({ length: size + 1 }, () => Array(size + 1).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      cost[i + 1][j + 1] = maxW - weights[i][j]
    }
  }

  const u = new Array<number>(size + 1).fill(0)
  const v = new Array<number>(size + 1).fill(0)
  const p = new Array<number>(size + 1).fill(0)
  const way = new Array<number>(size + 1).fill(0)

  for (let i = 1; i <= size; i++) {
    p[0] = i
    let j0 = 0
    const minv = new Array<number>(size + 1).fill(Infinity)
    const used = new Array<boolean>(size + 1).fill(false)
    do {
      used[j0] = true
      const i0 = p[j0]
      let delta = Infinity
      let j1 = 0
      for (let j = 1; j <= size; j++) {
        if (used[j]) continue
        const cur = cost[i0][j] - u[i0] - v[j]
        if (cur < minv[j]) {
          minv[j] = cur
          way[j] = j0
        }
        if (minv[j] < delta) {
          delta = minv[j]
          j1 = j
        }
      }
      for (let j = 0; j <= size; j++) {
        if (used[j]) {
          u[p[j]] += delta
          v[j] -= delta
        } else {
          minv[j] -= delta
        }
      }
      j0 = j1
    } while (p[j0] !== 0)
    do {
      const j1 = way[j0]
      p[j0] = p[j1]
      j0 = j1
    } while (j0 !== 0)
  }

  const result = new Array<number>(n).fill(-1)
  for (let j = 1; j <= size; j++) {
    if (p[j] >= 1 && p[j] <= n && j <= m) {
      result[p[j] - 1] = j - 1
    }
  }
  return result
}

/** 少打一人时裁剪多余进攻槽位（先撤前锋，再撤前腰/边锋，保住后卫线与中场骨架），若剩单前锋则自动居中（如 4-4-2 → 4-4-1）。 */
function adaptOutfieldSlotsForCount(
  slots: { slot: FormationSlot; row: FormationRow }[],
  count: number,
): { slot: FormationSlot; row: FormationRow }[] {
  if (count >= slots.length) return slots.map((item) => ({ slot: item.slot, row: { ...item.row } }))
  // 按“丢弃优先级”排序：最靠前的进攻位最先撤下，后卫线最后撤
  const dropRank = (s: { slot: FormationSlot; row: FormationRow }): number => {
    const pos = s.slot.position
    const x = s.row.nx
    if (pos === 'ST') return 100 + x * 10
    if (pos === 'W' && x >= 0.52) return 80 + x * 10
    if (pos === 'CM' && x >= 0.5) return 70 + x * 10
    if (pos === 'CM') return 50 + x * 10
    if (pos === 'W' && x >= 0.35) return 45 + x * 10
    if (pos === 'W') return 30 + x * 10
    return 10 + x * 10 // CB 最后撤
  }
  const ranked = [...slots].sort((a, b) => dropRank(b) - dropRank(a) || b.row.ny - a.row.ny)
  const droppedIds = new Set(ranked.slice(0, Math.max(0, slots.length - count)).map((item) => item.slot.id))
  const kept = slots
    .filter((item) => !droppedIds.has(item.slot.id))
    .map((item) => ({ slot: item.slot, row: { ...item.row } }))

  // 若剩余恰好 1 名 ST 且原本是双前锋偏左/偏右站位，拉回中路居中成标准 4-4-1 / 5-3-1
  const remainingSt = kept.filter((item) => item.slot.position === 'ST')
  if (remainingSt.length === 1 && Math.abs(remainingSt[0].row.ny - 0.5) > 0.04 && Math.abs(remainingSt[0].row.ny - 0.5) < 0.22) {
    remainingSt[0].row.ny = 0.5
  }
  return kept
}

export type PlayerFormationAssignment = {
  playerId: string
  sourceId: string
  slotId: string
  position: Position
  detailedPosition: DetailedPosition
  role: RoleId
  pesRole: PesRole
  nx: number
  ny: number
  line: number
}

/**
 * 为场上现有球员计算切换到目标阵型时的最优站位与职责方案。
 * - 门将固定守门；
 * - 软偏好 preferredPlayers 命中的场上球员优先归位；
 * - 其余外场球员通过匈牙利算法求全局最大适配分匹配；
 * - 少打一人时智能裁掉最靠前冗余槽位并居中单锋。
 */
export function computeFormationReassignment(
  onPitchPlayers: readonly MatchPlayerState[],
  targetFormationId: FormationId,
  customPositions?: Record<string, { x: number; y: number }>,
  slotRoles?: Record<string, RoleId>,
  preferredPlayers?: Record<string, string>,
): { assignments: PlayerFormationAssignment[]; shapeLabel: string } {
  const formation = FORMATIONS[targetFormationId]
  const rows = formationRows(targetFormationId, customPositions)
  const paired = formation.slots.map((slot, idx) => ({ slot, row: rows[idx] }))
  const gkEntry = paired.find((item) => item.slot.position === 'GK')!
  const allOutfieldEntries = paired.filter((item) => item.slot.position !== 'GK')

  const assignments: PlayerFormationAssignment[] = []
  const gkPlayer = onPitchPlayers.find((p) => p.position === 'GK' || p.slotId === 'gk')
  const outfieldPlayers = onPitchPlayers.filter((p) => p !== gkPlayer)

  const pickRoleFor = (player: MatchPlayerState, slot: FormationSlot): RoleId => {
    const requested = slotRoles?.[slot.id]
    if (requested && ROLES[requested]?.position === slot.position) return requested
    let best = slot.defaultRole
    let bestScore = -Infinity
    for (const role of rolesForSlot(slot)) {
      const s = matchPlayerRoleFit(player, role)
      if (s > bestScore) {
        bestScore = s
        best = role
      }
    }
    return best
  }

  if (gkPlayer && gkEntry) {
    const role = pickRoleFor(gkPlayer, gkEntry.slot)
    assignments.push({
      playerId: gkPlayer.id,
      sourceId: gkPlayer.sourceId,
      slotId: gkEntry.slot.id,
      position: gkEntry.slot.position,
      detailedPosition: detailedPositionForSlot(gkEntry.slot),
      role,
      pesRole: gkEntry.row.role,
      nx: gkEntry.row.nx,
      ny: gkEntry.row.ny,
      line: gkEntry.row.line,
    })
  }

  const activeSlots = adaptOutfieldSlotsForCount(allOutfieldEntries, outfieldPlayers.length)
  const remainingPlayers = [...outfieldPlayers]
  const remainingSlots = [...activeSlots]

  // 第一阶段：尊重主帅在备选战术槽里显式指定的偏好球员（仍在场上则直接归位）
  if (preferredPlayers) {
    for (let sIdx = remainingSlots.length - 1; sIdx >= 0; sIdx--) {
      const entry = remainingSlots[sIdx]
      const wantedSourceId = preferredPlayers[entry.slot.id]
      if (!wantedSourceId) continue
      const pIdx = remainingPlayers.findIndex((p) => p.sourceId === wantedSourceId)
      if (pIdx < 0) continue
      const player = remainingPlayers.splice(pIdx, 1)[0]
      remainingSlots.splice(sIdx, 1)
      const role = pickRoleFor(player, entry.slot)
      assignments.push({
        playerId: player.id,
        sourceId: player.sourceId,
        slotId: entry.slot.id,
        position: entry.slot.position,
        detailedPosition: detailedPositionForSlot(entry.slot),
        role,
        pesRole: entry.row.role,
        nx: entry.row.nx,
        ny: entry.row.ny,
        line: entry.row.line,
      })
    }
  }

  // 第二阶段：其余外场球员 × 其余槽位，用匈牙利算法求全局最大适配总分
  if (remainingPlayers.length > 0 && remainingSlots.length > 0) {
    const weights: number[][] = remainingPlayers.map((player) =>
      remainingSlots.map(({ slot }) => {
        const role = pickRoleFor(player, slot)
        const prof = slotPositionValue(player, slot)
        const fit = matchPlayerRoleFit(player, role) * positionMultiplier(prof)
        const playablePenalty = prof < PLAYABLE_PROFICIENCY ? -15 : 0
        const continuityBonus = player.slotId === slot.id ? 0.6 : player.position === slot.position ? 0.25 : 0
        return fit + playablePenalty + continuityBonus
      }),
    )
    const matchedCols = maxWeightMatching(weights)
    for (let i = 0; i < remainingPlayers.length; i++) {
      const col = matchedCols[i]
      if (col < 0 || col >= remainingSlots.length) continue
      const player = remainingPlayers[i]
      const entry = remainingSlots[col]
      const role = pickRoleFor(player, entry.slot)
      assignments.push({
        playerId: player.id,
        sourceId: player.sourceId,
        slotId: entry.slot.id,
        position: entry.slot.position,
        detailedPosition: detailedPositionForSlot(entry.slot),
        role,
        pesRole: entry.row.role,
        nx: entry.row.nx,
        ny: entry.row.ny,
        line: entry.row.line,
      })
    }
  }

  // 生成易读阵型名（满员直接返回 5-3-2，少打一人如 4-4-2 撤掉 1 个前锋则显示 4-4-1）
  const shapeLabel = outfieldPlayers.length >= 10
    ? formation.label
    : formatReducedShapeLabel(activeSlots, formation.label)

  return { assignments, shapeLabel }
}

function formatReducedShapeLabel(
  slots: { slot: FormationSlot; row: FormationRow }[],
  fallback: string,
): string {
  if (slots.length === 0) return fallback
  let def = 0
  let mid = 0
  let fwd = 0
  for (const { slot, row } of slots) {
    if (slot.position === 'CB' || (slot.position === 'W' && row.nx < 0.35)) def++
    else if (slot.position === 'ST' || (slot.position === 'W' && row.nx >= 0.6)) fwd++
    else mid++
  }
  if (def + mid + fwd === slots.length && def > 0) {
    return `${def}-${mid}-${fwd}`
  }
  return `${fallback}(${slots.length + 1}人)`
}

/* ---------- 赛中变阵后实时重算基础战术执行熟练度 ---------- */

export function computeLiveBaseFamiliarity(
  onPitchPlayers: readonly MatchPlayerState[],
  formationId: FormationId,
  instructions: TacticalInstructionsV2 | undefined,
  tacticsStage = 1,
): number {
  if (!instructions || sameInstructions(instructions, NEUTRAL_INSTRUCTIONS)) return 1
  const formation = FORMATIONS[formationId]
  if (!formation || onPitchPlayers.length === 0) return 0.75
  const slotMap = new Map(formation.slots.map((s) => [s.id, s]))
  let profSum = 0
  let iqSum = 0
  for (const player of onPitchPlayers) {
    const slot = slotMap.get(player.slotId)
    const prof = slot ? slotPositionValue(player, slot) : player.positions[player.position]
    profSum += Math.min(1, Math.max(0, prof / 100))
    const dec = player.attrs.decisions ?? 50
    const tw = player.attrs.teamwork ?? 50
    iqSum += Math.min(1, Math.max(0, (dec + tw) / 200))
  }
  const count = onPitchPlayers.length
  const profScore = profSum / count
  const iqScore = iqSum / count
  const clampedStage = Number.isFinite(tacticsStage) ? Math.min(25, Math.max(1, tacticsStage)) : 1
  const facilityScore = (clampedStage - 1) / 24
  const raw = 0.44 + 0.34 * profScore + 0.12 * iqScore + 0.12 * facilityScore
  return Math.round(Math.min(1, Math.max(0.5, raw)) * 1000) / 1000
}

/* ---------- 变阵联动换人选人逻辑 ---------- */

function defenderAffinity(player: MatchPlayerState): number {
  const dp = player.detailedPositions
  return Math.max(
    player.positions.CB,
    dp?.DC ?? 0,
    dp?.DL ?? 0,
    dp?.DR ?? 0,
    dp?.WBL ?? 0,
    dp?.WBR ?? 0,
  )
}

function attackerAffinity(player: MatchPlayerState): number {
  const dp = player.detailedPositions
  return Math.max(
    player.positions.ST,
    dp?.ST ?? 0,
    dp?.AML ?? 0,
    dp?.AMR ?? 0,
    dp?.AMC ?? 0,
    player.positions.W * 0.85,
  )
}

function midfielderAffinity(player: MatchPlayerState): number {
  const dp = player.detailedPositions
  return Math.max(
    player.positions.CM,
    dp?.MC ?? 0,
    dp?.DM ?? 0,
    dp?.AMC ?? 0,
    dp?.ML ?? 0,
    dp?.MR ?? 0,
  )
}

/**
 * 为规则的 `linkedSub` 选出一对 `(outPlayer, inPlayer)`。
 * 绝不会误换门将（除非显式指定门将 ID），且只从健康、未上场过的替补中挑选。
 */
export function pickLinkedSubPair(
  team: MatchTeamState,
  linkedSub: MatchPlanLinkedSub,
  targetFormationId?: FormationId,
): { out: MatchPlayerState; incoming: MatchPlayerState } | null {
  const onPitchOutfield = team.players.filter((p) => p.onPitch && !p.sentOff && p.position !== 'GK' && p.slotId !== 'gk')
  const availableBench = team.bench.filter((p) => !p.cameOff && !p.onPitch && !p.injured)
  const outfieldBench = availableBench.filter((p) => p.positions.GK <= 0)
  if (!onPitchOutfield.length || !availableBench.length) return null

  const staminaRatio = (p: MatchPlayerState) => p.stamina / Math.max(1, p.maxStamina)

  let out: MatchPlayerState | undefined
  switch (linkedSub.outKind) {
    case 'player':
      out = linkedSub.outPlayerId
        ? team.players.find((p) => p.onPitch && !p.sentOff && p.sourceId === linkedSub.outPlayerId)
        : undefined
      break
    case 'position_ST':
      out = [...onPitchOutfield.filter((p) => p.position === 'ST')].sort((a, b) => staminaRatio(a) - staminaRatio(b))[0]
      break
    case 'position_W':
      out = [...onPitchOutfield.filter((p) => p.position === 'W')].sort((a, b) => staminaRatio(a) - staminaRatio(b))[0]
      break
    case 'position_CM':
      out = [...onPitchOutfield.filter((p) => p.position === 'CM')].sort((a, b) => staminaRatio(a) - staminaRatio(b))[0]
      break
    case 'position_CB':
      out = [...onPitchOutfield.filter((p) => p.position === 'CB')].sort((a, b) => staminaRatio(a) - staminaRatio(b))[0]
      break
    case 'lowest_stamina':
    default:
      out = [...onPitchOutfield].sort((a, b) => staminaRatio(a) - staminaRatio(b))[0]
      break
  }
  if (!out) return null

  let incoming: MatchPlayerState | undefined
  if (linkedSub.inKind === 'player') {
    incoming = linkedSub.inPlayerId
      ? availableBench.find((p) => p.sourceId === linkedSub.inPlayerId)
      : undefined
  } else {
    const pool = out.position === 'GK' ? availableBench.filter((p) => p.positions.GK > 0) : outfieldBench
    if (!pool.length) return null
    const scoreOf = (p: MatchPlayerState): number => {
      const ca = matchPlayerOutfieldScore(p)
      const stam = staminaRatio(p) * 10
      switch (linkedSub.inKind) {
        case 'best_defender':
          return defenderAffinity(p) * 1.6 + ca * 0.45 + stam
        case 'best_midfielder':
          return midfielderAffinity(p) * 1.6 + ca * 0.45 + stam
        case 'best_attacker':
          return attackerAffinity(p) * 1.6 + ca * 0.45 + stam
        case 'best_fit':
        default: {
          if (targetFormationId && FORMATIONS[targetFormationId]) {
            const slots = FORMATIONS[targetFormationId].slots.filter((s) => s.position !== 'GK')
            const bestSlotProf = Math.max(...slots.map((s) => slotPositionValue(p, s)))
            return bestSlotProf * 1.3 + ca * 0.5 + stam
          }
          return (p.positions[out!.position] ?? 0) * 1.5 + ca * 0.5 + stam
        }
      }
    }
    incoming = [...pool].sort((a, b) => scoreOf(b) - scoreOf(a))[0]
  }

  if (!incoming) return null
  return { out, incoming }
}

/* ---------- 规则动作合成（合并主/备选槽 + 心态 + 风格 + 指令补丁） ---------- */

export interface ResolvedPlanAction {
  /** 是否要求切换阵型/站位结构（null = 保持当前阵型，仅改指令和心态） */
  targetFormation: {
    formationId: FormationId
    customPositions?: Record<string, { x: number; y: number }>
    slotRoles?: Record<string, RoleId>
    preferredPlayers?: Record<string, string>
    slotName: string
  } | null
  mentality: MatchMentality
  instructions: TacticalInstructionsV2
  tactics: Tactics
  aggression: number
  staminaMul: number
}

export function resolveCustomRuleAction(
  team: MatchTeamState,
  rule: MatchPlanRule | null,
): ResolvedPlanAction {
  const baseFormationId = team.baseFormationId ?? team.formationId
  const baseInstructions = team.baseInstructions ?? instructionsFromLegacyTactics(team.baseTactics ?? team.tactics)
  const baseMentality: MatchMentality = team.baseMentality ?? 'balanced'

  // 恢复主战术基线
  if (!rule) {
    const instructions = cloneInstructions(baseInstructions)
    const tactics = team.baseTactics ? { ...team.baseTactics } : legacyTacticsFromInstructions(instructions)
    const { aggression, staminaMul } = derivePlanIntensity(baseMentality, instructions)
    return {
      targetFormation: {
        formationId: baseFormationId,
        customPositions: team.baseCustomPositions,
        slotRoles: team.baseSlotRoles,
        preferredPlayers: team.basePreferredPlayers,
        slotName: '主战术',
      },
      mentality: baseMentality,
      instructions,
      tactics,
      aggression,
      staminaMul,
    }
  }

  const action = rule.action
  let targetFormation: ResolvedPlanAction['targetFormation'] = null
  let instructions = cloneInstructions(baseInstructions)
  let mentality: MatchMentality = baseMentality

  if (action.tacticSlotId === 'base') {
    targetFormation = {
      formationId: baseFormationId,
      customPositions: team.baseCustomPositions,
      slotRoles: team.baseSlotRoles,
      preferredPlayers: team.basePreferredPlayers,
      slotName: '主战术',
    }
  } else if (action.tacticSlotId) {
    const backup = (team.backupTactics ?? []).find((b) => b.id === action.tacticSlotId)
    if (backup) {
      targetFormation = {
        formationId: backup.formationId,
        customPositions: backup.customPositions,
        slotRoles: backup.slotRoles,
        preferredPlayers: backup.preferredPlayers,
        slotName: backup.name,
      }
      instructions = cloneInstructions(backup.tacticalInstructions)
      mentality = backup.mentality
    }
  }

  if (action.tacticalStyle && isStyleId(action.tacticalStyle)) {
    instructions = cloneInstructions(STYLES_REV3[action.tacticalStyle].instructions)
  }

  if (action.mentality) {
    mentality = action.mentality
  }

  if (action.instructionPatch) {
    instructions = applyInstructionPatch(instructions, action.instructionPatch)
  }

  // 若未显式使用备选槽且未提供精细补丁，但指定了攻/守心态，则叠加标准心态指令层
  const hasExplicitInst = !!action.tacticSlotId && action.tacticSlotId !== 'base'
    || !!action.tacticalStyle
    || !!action.instructionPatch
  if (!hasExplicitInst && mentality !== 'balanced') {
    instructions = applyMentalityOverlay(instructions, mentality)
  }

  const tactics = legacyTacticsFromInstructions(instructions)
  const { aggression, staminaMul } = derivePlanIntensity(mentality, instructions)

  return {
    targetFormation,
    mentality,
    instructions,
    tactics,
    aggression,
    staminaMul,
  }
}
