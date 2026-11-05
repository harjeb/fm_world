import type { AutoSubPlan, Lineup, MatchMentality, Player, Tactics } from '../types.ts'
import { FORMATIONS } from '../data/formations.ts'
import { MATCH_DISPLAY_SECONDS } from './time.ts'

export const MATCH_TACTICS: Record<MatchMentality, Tactics> = {
  attack: { attack: 'balanced', passing: 'direct', tempo: 'fast', line: 'high', press: 'high' },
  balanced: { attack: 'balanced', passing: 'mixed', tempo: 'normal', line: 'mid', press: 'mid' },
  defend: { attack: 'balanced', passing: 'short', tempo: 'slow', line: 'low', press: 'low' },
}
export const MATCH_MENTALITY_LABELS: Record<MatchMentality, string> = { attack: '全体进攻', balanced: '均衡', defend: '全体防守' }
export function emptyAutoSubs(): AutoSubPlan { return { timed: [], staminaBelow: null, onInjury: false } }

export function autoSubDisplaySeconds(rule: { atMinute?: number; atSeconds?: number }): number {
  if (rule.atMinute !== undefined) return rule.atMinute * 60
  // 旧档的 atSeconds 按旧 10 分钟比赛记录。
  if (rule.atSeconds !== undefined) return rule.atSeconds * (MATCH_DISPLAY_SECONDS / 600)
  return 0
}

export function validateAutoSubPlan(roster: Player[], lineup: Lineup, plan: unknown): string[] {
  const errors: string[] = []
  try {
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return ['换人计划必须是对象']
    const p = plan as Record<string, unknown>
    if (Object.keys(p).some(k => !['timed', 'staminaBelow', 'onInjury'].includes(k))) errors.push('存在未知字段')
    if (typeof p.onInjury !== 'boolean') errors.push('onInjury 必须是布尔值')
    if (p.staminaBelow !== null && (typeof p.staminaBelow !== 'number' || !Number.isFinite(p.staminaBelow) || p.staminaBelow < 1 || p.staminaBelow > 99)) errors.push('体力阈值必须为 null 或 1-99')
    if (!Array.isArray(p.timed)) return [...errors, 'timed 必须是数组']
    if (p.timed.length > 3) errors.push('定时换人最多三条')
    const outs = new Set<string>(), ins = new Set<string>()
    for (const item of p.timed) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) { errors.push('定时规则格式错误'); continue }
      const r = item as Record<string, unknown>
      if (Object.keys(r).some(k => !['atMinute', 'atSeconds', 'outId', 'inId'].includes(k))) errors.push('定时规则存在未知字段')
      const hasMinute = typeof r.atMinute === 'number' && Number.isFinite(r.atMinute) && r.atMinute > 0 && r.atMinute < 90
      const hasSeconds = typeof r.atSeconds === 'number' && Number.isFinite(r.atSeconds) && r.atSeconds > 0 && r.atSeconds < 600
      if (!hasMinute && !hasSeconds) errors.push('换人时间必须在 0 到 90 分钟之间')
      if (typeof r.outId !== 'string' || typeof r.inId !== 'string') { errors.push('球员 ID 格式错误'); continue }
      if (outs.has(r.outId) || ins.has(r.inId)) errors.push('球员不能重复计划换人')
      outs.add(r.outId); ins.add(r.inId)
      const starter = lineup.starters.find(s => s.playerId === r.outId)
      const incoming = roster.find(x => x.id === r.inId)
      const outgoing = roster.find(x => x.id === r.outId)
      const slot = FORMATIONS[lineup.formationId]?.slots.find(s => s.id === starter?.slotId)
      if (!starter || !outgoing || !lineup.bench.includes(r.inId) || !incoming || !slot) errors.push('换下的球员要在首发里，换上的球员要在替补里')
    }
  } catch { errors.push('换人计划或阵容格式错误') }
  return errors
}
