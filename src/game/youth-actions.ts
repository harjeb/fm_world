import type { GameState } from './types.ts'
import { DETAILED_POSITIONS, type DETAILED_POSITION_LABELS } from './detailed-positions.ts'
import { settleYouth, validYouthPlan, youthPlayer, YOUTH_CAPACITY, YOUTH_INTAKE_KEEP, YOUTH_WAGE, YOUTH_WEEK_MS, type YouthPlan } from './youth.ts'
import { SQUAD_LIMIT } from './market.ts'
import { MIN_SQUAD, repairLineup, validateLineup } from './squad.ts'
import { sanitizeAutoSubPlan } from './match/management.ts'
import { lineupLockState } from './season.ts'

export type YouthAction = { action: 'plan' | 'recruit_position' | 'sign' | 'call_up' | 'return' | 'promote' | 'release'; playerId?: string; plan?: YouthPlan; position?: keyof typeof DETAILED_POSITION_LABELS }
export type YouthOutcome = { ok: boolean; error?: string }
const fail = (error: string): YouthOutcome => ({ ok: false, error })

/** Called only on authoritative state online. All changes are synchronous and persisted atomically by the caller. */
export function applyYouthAction(game: GameState, raw: unknown, now = Date.now(), locked = false): YouthOutcome {
  if (!raw || typeof raw !== 'object') return fail('青训操作无效')
  const body = raw as YouthAction
  if (!['plan', 'recruit_position', 'sign', 'call_up', 'return', 'promote', 'release'].includes(body.action)) return fail('不支持的青训操作')
  settleYouth(game, now)
  const youth = game.youth!
  if (body.action === 'recruit_position') {
    if (!body.position || !DETAILED_POSITIONS.includes(body.position)) return fail('目标位置无效')
    youth.recruitPosition = body.position
    return { ok: true }
  }
  if (typeof body.playerId !== 'string' || !body.playerId) return fail('请选择青训球员')
  if (body.action === 'sign') {
    if (youth.intake.signed.includes(body.playerId)) return fail('已经签下这名青年')
    if (youth.intake.signed.length >= YOUTH_INTAKE_KEEP) return fail('本期签约名额已用完')
    if (youth.members.length >= YOUTH_CAPACITY) return fail('青训营已满，请先提拔或解约')
    const candidate = youth.intake.candidates.find(c => c.player.id === body.playerId)
    if (!candidate) return fail('候选人不存在或本期招募已结束')
    const member = structuredClone(candidate)
    member.enrolledAt = member.settledAt = now
    member.plans = [{ at: now, plan: { ...member.plan } }]
    member.player.recoveryAt = now
    member.player.youthOrigin = { club: game.clubName, enrolledAt: now, transferAfter: now + YOUTH_WEEK_MS }
    youth.members.push(member)
    youth.intake.signed.push(body.playerId)
    return { ok: true }
  }
  const member = youth.members.find(m => m.player.id === body.playerId)
  if (!member) return fail('球员不在青训营')
  const player = youthPlayer(game, member)
  if (body.action === 'plan') {
    if (now >= member.endsAt) return fail('已结束青训成长，请考虑正式提拔')
    if (!validYouthPlan(player, body.plan)) return fail('培养方案无效：门将与外场位置不能互转')
    member.plan = { ...body.plan }
    // Only the next unstarted period changes; no retroactive redistribution or reroll.
    const effectiveAt = member.settledAt + (now > member.settledAt ? 24 * 60 * 60_000 : 0)
    member.plans = member.plans.filter(p => p.at < effectiveAt)
    member.plans.push({ at: effectiveAt, plan: { ...body.plan } })
    return { ok: true }
  }
  if (game.activeMatch || locked || lineupLockState(game, now).locked) return fail('比赛进行中或阵容已锁定，暂不能调整青训名单')
  if (body.action === 'call_up' || body.action === 'promote') {
    if (body.action === 'call_up' && member.calledUp) return fail('已临时征召')
    if (!member.calledUp && game.roster.length >= SQUAD_LIMIT) return fail(`一线队已达 ${SQUAD_LIMIT} 人上限`)
    if (!member.calledUp) {
      if (game.roster.some(p => p.id === player.id)) return fail('球员已在一线队，请刷新')
      game.roster.push(player)
      member.calledUp = true
    }
    player.contract = { clubId: 'player', wage: YOUTH_WAGE, expiresSeason: game.season.index + Math.max(3, 20 - (player.age ?? 18)) }
    if (body.action === 'promote') {
      player.youthOrigin!.promotedAt = now
      player.youthOrigin!.transferAfter = Math.max(player.youthOrigin!.transferAfter, now + YOUTH_WEEK_MS)
      youth.members = youth.members.filter(m => m !== member)
    }
    return { ok: true }
  }
  if (member.calledUp) {
    const roster = game.roster.filter(p => p.id !== player.id)
    if (roster.length < MIN_SQUAD) return fail(`一线队至少需要保留 ${MIN_SQUAD} 人`)
    const repaired = repairLineup(roster, game.lineup)
    if (!validateLineup(roster, repaired.lineup).valid) return fail('离队后无法组成合法阵容')
    game.roster = roster
    game.lineup = repaired.lineup
    if (game.autoSubs) game.autoSubs = sanitizeAutoSubPlan(roster, game.lineup, game.autoSubs)
    member.calledUp = false
    member.player = player
    delete player.contract
  } else if (body.action === 'return') return fail('球员目前就在青训营')
  if (body.action === 'release') {
    // No currency/cards/materials/free-market entry and no automatic replacement.
    youth.members = youth.members.filter(m => m !== member)
  }
  return { ok: true }
}
