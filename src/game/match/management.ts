import type {
  AutoSubConditionRule,
  AutoSubPlan,
  AutoSubPreferBy,
  AutoSubScoreState,
  Lineup,
  MatchMentality,
  Player,
  Position,
  Tactics,
} from '../types.ts'
import { POSITIONS } from '../types.ts'
import { matchPlayerCa } from '../ai-tactics.ts'
import { FORMATIONS } from '../data/formations.ts'
import type { MatchPlayerState, MatchTeamState } from './types.ts'
import { MATCH_DISPLAY_SECONDS } from './time.ts'
import { MAX_SUBS } from '../squad.ts'

export const MATCH_TACTICS: Record<MatchMentality, Tactics> = {
  attack: { attack: 'balanced', passing: 'direct', tempo: 'fast', line: 'high', press: 'high' },
  balanced: { attack: 'balanced', passing: 'mixed', tempo: 'normal', line: 'mid', press: 'mid' },
  defend: { attack: 'balanced', passing: 'short', tempo: 'slow', line: 'low', press: 'low' },
}
export const MATCH_MENTALITY_LABELS: Record<MatchMentality, string> = { attack: '全体进攻', balanced: '均衡', defend: '全体防守' }

export const AUTO_SUB_SCORE_LABELS: Record<AutoSubScoreState, string> = {
  any: '不限比分',
  leading: '领先时',
  drawing: '平局时',
  trailing: '落后时',
  not_leading: '未领先时',
}

export const AUTO_SUB_PREFER_LABELS: Record<AutoSubPreferBy, string> = {
  proficiency: '位置熟练优先',
  stamina: '充沛体力优先',
  ca: '综合能力优先',
}

const VALID_PLAN_KEYS = new Set([
  'timed',
  'staminaBelow',
  'staminaPositions',
  'staminaMinMinute',
  'preferBy',
  'conditionRules',
  'onInjury',
])
const VALID_SCORE_STATES = new Set<string>(['any', 'leading', 'drawing', 'trailing', 'not_leading'])
const VALID_PREFER_BY = new Set<string>(['proficiency', 'stamina', 'ca'])
const VALID_TARGET_KINDS = new Set<string>(['any', 'position', 'slot', 'player'])
const VALID_POSITIONS = new Set<string>(POSITIONS)

export function emptyAutoSubs(): AutoSubPlan {
  return { timed: [], staminaBelow: null, onInjury: false }
}

export function autoSubDisplaySeconds(rule: { atMinute?: number; atSeconds?: number }): number {
  if (rule.atMinute !== undefined) return rule.atMinute * 60
  // 旧档的 atSeconds 按旧 10 分钟比赛记录。
  if (rule.atSeconds !== undefined) return rule.atSeconds * (MATCH_DISPLAY_SECONDS / 600)
  return 0
}

function validateSharedPlanFields(p: Record<string, unknown>, errors: string[]): void {
  if (Object.keys(p).some((k) => !VALID_PLAN_KEYS.has(k))) errors.push('存在未知字段')
  if (typeof p.onInjury !== 'boolean') errors.push('onInjury 必须是布尔值')
  if (p.staminaBelow !== null && (typeof p.staminaBelow !== 'number' || !Number.isFinite(p.staminaBelow) || p.staminaBelow < 1 || p.staminaBelow > 99)) {
    errors.push('体力阈值必须为 null 或 1-99')
  }
  if (p.staminaPositions !== undefined) {
    if (!Array.isArray(p.staminaPositions)) {
      errors.push('staminaPositions 必须是位置数组')
    } else {
      const seen = new Set<string>()
      for (const pos of p.staminaPositions) {
        if (typeof pos !== 'string' || !VALID_POSITIONS.has(pos)) errors.push(`无效的位置筛选：${String(pos)}`)
        else if (seen.has(pos)) errors.push('位置筛选不能重复')
        else seen.add(pos)
      }
    }
  }
  if (p.staminaMinMinute !== undefined && (typeof p.staminaMinMinute !== 'number' || !Number.isFinite(p.staminaMinMinute) || p.staminaMinMinute < 0 || p.staminaMinMinute >= 90)) {
    errors.push('全局体力换人最早分钟必须在 0 到 90 之间')
  }
  if (p.preferBy !== undefined && (typeof p.preferBy !== 'string' || !VALID_PREFER_BY.has(p.preferBy))) {
    errors.push('替补选择策略无效')
  }
}

export function validateAutoSubPlan(roster: Player[], lineup: Lineup, plan: unknown): string[] {
  const errors: string[] = []
  try {
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return ['换人计划必须是对象']
    const p = plan as Record<string, unknown>
    validateSharedPlanFields(p, errors)
    if (!Array.isArray(p.timed)) return [...errors, 'timed 必须是数组']
    if (p.timed.length > MAX_SUBS) errors.push(`定时换人最多 ${MAX_SUBS} 条`)
    const outs = new Set<string>(), ins = new Set<string>()
    for (const item of p.timed) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) { errors.push('定时规则格式错误'); continue }
      const r = item as Record<string, unknown>
      if (Object.keys(r).some((k) => !['atMinute', 'atSeconds', 'outId', 'inId'].includes(k))) errors.push('定时规则存在未知字段')
      const hasMinute = typeof r.atMinute === 'number' && Number.isFinite(r.atMinute) && r.atMinute > 0 && r.atMinute < 90
      const hasSeconds = typeof r.atSeconds === 'number' && Number.isFinite(r.atSeconds) && r.atSeconds > 0 && r.atSeconds < 600
      if (!hasMinute && !hasSeconds) errors.push('换人时间必须在 0 到 90 分钟之间')
      if (typeof r.outId !== 'string' || typeof r.inId !== 'string') { errors.push('球员 ID 格式错误'); continue }
      if (outs.has(r.outId) || ins.has(r.inId)) errors.push('球员不能重复计划换人')
      outs.add(r.outId); ins.add(r.inId)
      const starter = lineup.starters.find((s) => s.playerId === r.outId)
      const incoming = roster.find((x) => x.id === r.inId)
      const outgoing = roster.find((x) => x.id === r.outId)
      const slot = FORMATIONS[lineup.formationId]?.slots.find((s) => s.id === starter?.slotId)
      if (!starter || !outgoing || !lineup.bench.includes(r.inId) || !incoming || !slot) errors.push('换下的球员要在首发里，换上的球员要在替补里')
    }

    if (p.conditionRules !== undefined) {
      if (!Array.isArray(p.conditionRules)) {
        errors.push('条件换人规则必须是数组')
      } else {
        if (p.conditionRules.length > MAX_SUBS) errors.push(`条件换人最多 ${MAX_SUBS} 条`)
        const slotIds = new Set((FORMATIONS[lineup.formationId]?.slots ?? []).map((s) => s.id))
        for (const item of p.conditionRules) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) { errors.push('条件规则格式错误'); continue }
          const r = item as Record<string, unknown>
          if (Object.keys(r).some((k) => !['targetKind', 'targetValue', 'staminaBelow', 'minMinute', 'scoreState', 'inId'].includes(k))) {
            errors.push('条件规则存在未知字段')
          }
          if (typeof r.targetKind !== 'string' || !VALID_TARGET_KINDS.has(r.targetKind)) {
            errors.push('条件规则目标类型无效')
            continue
          }
          if (r.targetKind === 'position' && (typeof r.targetValue !== 'string' || !VALID_POSITIONS.has(r.targetValue))) {
            errors.push('条件规则需要合法的指定位置')
          }
          if (r.targetKind === 'slot' && (typeof r.targetValue !== 'string' || !slotIds.has(r.targetValue))) {
            errors.push('条件规则的阵型槽位不在当前阵型中')
          }
          if (r.targetKind === 'player' && (typeof r.targetValue !== 'string' || !lineup.starters.some((s) => s.playerId === r.targetValue))) {
            errors.push('条件规则指定的换下球员必须在首发名单中')
          }
          if (typeof r.staminaBelow !== 'number' || !Number.isFinite(r.staminaBelow) || r.staminaBelow < 1 || r.staminaBelow > 99) {
            errors.push('条件规则的体力阈值必须在 1-99 之间')
          }
          if (r.minMinute !== undefined && (typeof r.minMinute !== 'number' || !Number.isFinite(r.minMinute) || r.minMinute < 0 || r.minMinute >= 90)) {
            errors.push('条件规则的最早分钟必须在 0 到 90 之间')
          }
          if (r.scoreState !== undefined && (typeof r.scoreState !== 'string' || !VALID_SCORE_STATES.has(r.scoreState))) {
            errors.push('条件规则的比分状态无效')
          }
          if (r.inId !== undefined && r.inId !== '') {
            if (typeof r.inId !== 'string' || !lineup.bench.includes(r.inId) || !roster.some((x) => x.id === r.inId)) {
              errors.push('条件规则指定的替补球员必须在替补名单中')
            }
          }
        }
      }
    }
  } catch {
    errors.push('换人计划或阵容格式错误')
  }
  return errors
}

/** 比赛进行中校验自动换人计划（基于当前场上球员与可用替补席）。 */
export function validateLiveAutoSubPlan(team: MatchTeamState, plan: unknown): string[] {
  const errors: string[] = []
  try {
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return ['换人计划必须是对象']
    const p = plan as Record<string, unknown>
    validateSharedPlanFields(p, errors)
    if (!Array.isArray(p.timed)) return [...errors, 'timed 必须是数组']
    if (p.timed.length > MAX_SUBS) errors.push(`定时换人最多 ${MAX_SUBS} 条`)
    const onPitchIds = new Set(team.players.filter((x) => x.onPitch).map((x) => x.sourceId))
    const benchIds = new Set(team.bench.filter((x) => !x.cameOff && !x.onPitch).map((x) => x.sourceId))
    const slotIds = new Set((FORMATIONS[team.formationId]?.slots ?? []).map((s) => s.id))
    const outs = new Set<string>(), ins = new Set<string>()
    for (const item of p.timed) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) { errors.push('定时规则格式错误'); continue }
      const r = item as Record<string, unknown>
      if (Object.keys(r).some((k) => !['atMinute', 'atSeconds', 'outId', 'inId'].includes(k))) errors.push('定时规则存在未知字段')
      const hasMinute = typeof r.atMinute === 'number' && Number.isFinite(r.atMinute) && r.atMinute > 0 && r.atMinute < 90
      const hasSeconds = typeof r.atSeconds === 'number' && Number.isFinite(r.atSeconds) && r.atSeconds > 0 && r.atSeconds < 600
      if (!hasMinute && !hasSeconds) errors.push('换人时间必须在 0 到 90 分钟之间')
      if (typeof r.outId !== 'string' || typeof r.inId !== 'string') { errors.push('球员 ID 格式错误'); continue }
      if (outs.has(r.outId) || ins.has(r.inId)) errors.push('球员不能重复计划换人')
      outs.add(r.outId); ins.add(r.inId)
      if (!onPitchIds.has(r.outId) || !benchIds.has(r.inId)) {
        errors.push('换下的球员当前必须在场上，换上的球员必须在可用替补席')
      }
    }
    if (p.conditionRules !== undefined) {
      if (!Array.isArray(p.conditionRules)) {
        errors.push('条件换人规则必须是数组')
      } else {
        if (p.conditionRules.length > MAX_SUBS) errors.push(`条件换人最多 ${MAX_SUBS} 条`)
        for (const item of p.conditionRules) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) { errors.push('条件规则格式错误'); continue }
          const r = item as Record<string, unknown>
          if (Object.keys(r).some((k) => !['targetKind', 'targetValue', 'staminaBelow', 'minMinute', 'scoreState', 'inId'].includes(k))) {
            errors.push('条件规则存在未知字段')
          }
          if (typeof r.targetKind !== 'string' || !VALID_TARGET_KINDS.has(r.targetKind)) {
            errors.push('条件规则目标类型无效')
            continue
          }
          if (r.targetKind === 'position' && (typeof r.targetValue !== 'string' || !VALID_POSITIONS.has(r.targetValue))) {
            errors.push('条件规则需要合法的指定位置')
          }
          if (r.targetKind === 'slot' && (typeof r.targetValue !== 'string' || !slotIds.has(r.targetValue))) {
            errors.push('条件规则的阵型槽位不在当前阵型中')
          }
          if (r.targetKind === 'player' && (typeof r.targetValue !== 'string' || !onPitchIds.has(r.targetValue))) {
            errors.push('条件规则指定的换下球员当前必须在场上')
          }
          if (typeof r.staminaBelow !== 'number' || !Number.isFinite(r.staminaBelow) || r.staminaBelow < 1 || r.staminaBelow > 99) {
            errors.push('条件规则的体力阈值必须在 1-99 之间')
          }
          if (r.minMinute !== undefined && (typeof r.minMinute !== 'number' || !Number.isFinite(r.minMinute) || r.minMinute < 0 || r.minMinute >= 90)) {
            errors.push('条件规则的最早分钟必须在 0 到 90 之间')
          }
          if (r.scoreState !== undefined && (typeof r.scoreState !== 'string' || !VALID_SCORE_STATES.has(r.scoreState))) {
            errors.push('条件规则的比分状态无效')
          }
          if (r.inId !== undefined && r.inId !== '' && (typeof r.inId !== 'string' || !benchIds.has(r.inId))) {
            errors.push('条件规则指定的替补球员必须在可用替补席')
          }
        }
      }
    }
  } catch {
    errors.push('换人计划格式错误')
  }
  return errors
}

function matchesScoreState(scoreState: AutoSubScoreState | undefined, scoreDiff: number): boolean {
  switch (scoreState) {
    case 'leading':
      return scoreDiff > 0
    case 'drawing':
      return scoreDiff === 0
    case 'trailing':
      return scoreDiff < 0
    case 'not_leading':
      return scoreDiff <= 0
    case 'any':
    case undefined:
      return true
  }
}

function matchesConditionTarget(player: MatchPlayerState, rule: AutoSubConditionRule): boolean {
  switch (rule.targetKind) {
    case 'any':
      return true
    case 'position':
      return player.position === rule.targetValue
    case 'slot':
      return player.slotId === rule.targetValue
    case 'player':
      return player.sourceId === rule.targetValue
  }
}

function pickBestBench(
  bench: MatchPlayerState[],
  out: MatchPlayerState,
  minStaminaPct: number | null,
  preferBy: AutoSubPreferBy = 'proficiency',
): MatchPlayerState | undefined {
  const candidates = bench.filter(
    (p) =>
      !p.injured
      && p.positions[out.position] > 0
      && (minStaminaPct === null || (p.stamina / Math.max(1, p.maxStamina)) * 100 >= minStaminaPct),
  )
  candidates.sort((a, b) => {
    if (preferBy === 'stamina') {
      const diff = b.stamina / Math.max(1, b.maxStamina) - a.stamina / Math.max(1, a.maxStamina)
      if (Math.abs(diff) > 1e-6) return diff
    } else if (preferBy === 'ca') {
      const diff = matchPlayerCa(b) - matchPlayerCa(a)
      if (Math.abs(diff) > 1e-6) return diff
    }
    return b.positions[out.position] - a.positions[out.position]
  })
  return candidates[0]
}

/**
 * 统一的场内自动换人执行器（PesGame 与 MatchEngine 共用）：
 * 优先级：1. 受伤换人 → 2. 定时换人 → 3. 条件换人规则（位置/槽位/球员+体力+分钟+比分）→ 4. 全局体力阈值（支持位置筛选与最早分钟）。
 */
export function executeTeamAutoSubs(options: {
  team: MatchTeamState
  clockSeconds: number
  durationSeconds: number
  scoreDiff: number
  availableBench: () => MatchPlayerState[]
  substitute: (outId: string, inId: string, reason: 'injury' | 'timed' | 'stamina') => boolean
}): void {
  const { team, clockSeconds, durationSeconds, scoreDiff, availableBench, substitute } = options
  const plan = team.autoSubs
  if (!plan) return
  const displayMinute = durationSeconds > 0 ? (clockSeconds / durationSeconds) * 90 : 0
  const preferBy = plan.preferBy ?? 'proficiency'

  // 1. 受伤自动换人
  if (plan.onInjury) {
    for (const out of team.players.filter((p) => p.onPitch && p.injured).sort((a, b) => a.stamina / a.maxStamina - b.stamina / b.maxStamina)) {
      if (team.subsUsed >= MAX_SUBS) break
      const incoming = pickBestBench(availableBench(), out, null, preferBy)
      if (incoming) substitute(out.id, incoming.id, 'injury')
    }
  }

  // 2. 定时换人
  plan.timed = plan.timed.filter((rule) => {
    const displayAt = autoSubDisplaySeconds(rule)
    const atLogic = durationSeconds > 0 ? (displayAt / 5400) * durationSeconds : 0
    if (atLogic > clockSeconds) return true
    const out = team.players.find((p) => p.sourceId === rule.outId && p.onPitch)
    const incoming = team.bench.find((p) => p.sourceId === rule.inId && !p.cameOff && !p.onPitch)
    if (!out || !incoming || incoming.injured || team.subsUsed >= MAX_SUBS) return false
    return !substitute(out.id, incoming.id, 'timed')
  })

  // 3. 条件换人规则（按体力 + 指定位置/槽位/球员 + 分钟 + 比分）
  if (plan.conditionRules?.length) {
    for (const rule of plan.conditionRules) {
      if (team.subsUsed >= MAX_SUBS) break
      if ((rule.minMinute ?? 0) > 0 && displayMinute < rule.minMinute!) continue
      if (!matchesScoreState(rule.scoreState, scoreDiff)) continue
      const tiredCandidates = team.players
        .filter((p) => p.onPitch && matchesConditionTarget(p, rule) && (p.stamina / Math.max(1, p.maxStamina)) * 100 < rule.staminaBelow)
        .sort((a, b) => a.stamina / a.maxStamina - b.stamina / b.maxStamina)
      for (const out of tiredCandidates) {
        if (team.subsUsed >= MAX_SUBS) break
        const incoming = rule.inId
          ? availableBench().find(
              (b) => b.sourceId === rule.inId && !b.injured && (b.stamina / Math.max(1, b.maxStamina)) * 100 >= rule.staminaBelow,
            )
          : pickBestBench(availableBench(), out, rule.staminaBelow, preferBy)
        if (incoming) substitute(out.id, incoming.id, 'stamina')
      }
    }
  }

  // 4. 全局体力阈值换人（支持生效位置筛选与最早分钟限制）
  if (plan.staminaBelow !== null && displayMinute >= (plan.staminaMinMinute ?? 0)) {
    const allowedPositions = plan.staminaPositions !== undefined ? new Set(plan.staminaPositions) : null
    for (const out of team.players
      .filter((p) => p.onPitch && (!allowedPositions || allowedPositions.has(p.position)) && (p.stamina / Math.max(1, p.maxStamina)) * 100 < plan.staminaBelow!)
      .sort((a, b) => a.stamina / a.maxStamina - b.stamina / b.maxStamina)) {
      if (team.subsUsed >= MAX_SUBS) break
      const incoming = pickBestBench(availableBench(), out, plan.staminaBelow!, preferBy)
      if (incoming) substitute(out.id, incoming.id, 'stamina')
    }
  }
}
