import type { AttrKey, SkillId } from '../types.ts'
import type { PassType } from './resolution.ts'
import { GOAL_Y, skillTierMultiplier } from './team.ts'
import { clamp, distance, inBox, progressOf, wideZone } from './pitch.ts'
import type { MatchPlayerState, MatchTeamState } from './types.ts'

/**
 * S4+ 赛季商店对策型技能的统一战术判定与结算模块：
 * - 同时兼容现代 TacticalInstructionsV2（team.instructions）与旧五项 Tactics（team.tactics）；
 * - 供 MatchRatings（属性/光环）、MatchResolution（传球/盘带/射门/封堵/争顶/二点/抱球/犯规吃牌）
 *   以及 2D / PES 体能消耗模块共用，不改变无新技能时的任何旧引擎确定性。
 */

export function oppHighLine(opp: MatchTeamState | undefined): boolean {
  if (!opp) return false
  return opp.instructions ? opp.instructions.defense.line === 'high' : opp.tactics.line === 'high'
}

export function oppLowLine(opp: MatchTeamState | undefined): boolean {
  if (!opp) return false
  return opp.instructions ? opp.instructions.defense.line === 'low' : opp.tactics.line === 'low'
}

export function oppHighPress(opp: MatchTeamState | undefined): boolean {
  if (!opp) return false
  if (opp.instructions) {
    return opp.instructions.defense.intensity === 'high'
      || opp.instructions.defense.engagement === 'high'
      || opp.instructions.transition.onLoss === 'counterpress'
  }
  return opp.tactics.press === 'high'
}

export function oppLowPress(opp: MatchTeamState | undefined): boolean {
  if (!opp) return false
  if (opp.instructions) {
    return opp.instructions.defense.intensity === 'low' || opp.instructions.transition.onLoss === 'regroup'
  }
  return opp.tactics.press === 'low'
}

export function oppShortPassing(opp: MatchTeamState | undefined): boolean {
  if (!opp) return false
  return opp.instructions ? opp.instructions.possession.passing === 'short' : opp.tactics.passing === 'short'
}

export function oppDirectPassing(opp: MatchTeamState | undefined): boolean {
  if (!opp) return false
  return opp.instructions ? opp.instructions.possession.passing === 'direct' : opp.tactics.passing === 'direct'
}

export function oppWingPlay(opp: MatchTeamState | undefined): boolean {
  if (!opp) return false
  if (opp.instructions) {
    return opp.instructions.possession.focus === 'wing' || opp.instructions.possession.width === 'wide'
  }
  return opp.tactics.attack === 'wing'
}

export function oppMiddlePlay(opp: MatchTeamState | undefined): boolean {
  if (!opp) return false
  if (opp.instructions) {
    return opp.instructions.possession.focus === 'middle' || opp.instructions.possession.width === 'narrow'
  }
  return opp.tactics.attack === 'middle'
}

export function oppFastCounter(opp: MatchTeamState | undefined): boolean {
  if (!opp) return false
  if (opp.instructions) {
    return opp.instructions.possession.tempo === 'fast' || opp.instructions.transition.onGain === 'counter'
  }
  return opp.tactics.tempo === 'fast'
}

export function oppThreeBack(opp: MatchTeamState | undefined): boolean {
  if (!opp) return false
  let count = 0
  for (const player of opp.players) if (player.onPitch && player.position === 'CB') count++
  return count >= 3
}

export function oppTwoStrikers(opp: MatchTeamState | undefined): boolean {
  if (!opp) return false
  let count = 0
  for (const player of opp.players) if (player.onPitch && player.position === 'ST') count++
  return count >= 2
}

export function oppMidfieldHeavy(opp: MatchTeamState | undefined): boolean {
  if (!opp) return false
  let count = 0
  for (const player of opp.players) if (player.onPitch && player.position === 'CM') count++
  return count >= 3
}

export function oppSweeperKeeper(opp: MatchTeamState | undefined): boolean {
  if (!opp) return false
  const gk = opp.players.find((player) => player.onPitch && player.position === 'GK')
  return !!gk && (gk.role === 'gk_sweeper' || gk.skills.includes('gk_sweeper'))
}

export function oppFatigued(opp: MatchTeamState | undefined): boolean {
  if (!opp) return false
  let sum = 0
  let count = 0
  for (const player of opp.players) {
    if (!player.onPitch || player.position === 'GK') continue
    sum += player.stamina / Math.max(1, player.maxStamina)
    count++
  }
  return count > 0 && sum / count < 0.65
}

type MarkFn = (player: MatchPlayerState, skill: SkillId, matched: boolean, triggered: boolean) => void

/** 辅助对策技能在 MatchRatings.eff 中提供的属性加成（含全队光环 sh_aux_r_anti_press_aura）。 */
export function reserveAuxAttrBonus(
  player: MatchPlayerState,
  key: AttrKey,
  team: MatchTeamState | undefined,
  opp: MatchTeamState | undefined,
): number {
  let bonus = 0
  if ((key === 'composure' || key === 'firstTouch') && team && oppHighPress(opp)) {
    const commander = team.players.find((mate) => mate.onPitch && mate.skills.includes('sh_aux_r_anti_press_aura'))
    if (commander) bonus += 4.5 * skillTierMultiplier(commander, 'sh_aux_r_anti_press_aura')
  }
  if ((key === 'vision' || key === 'decisions' || key === 'offBall') && player.skills.includes('sh_aux_r_anti_bus_vision') && oppLowLine(opp)) {
    bonus += 7.5 * skillTierMultiplier(player, 'sh_aux_r_anti_bus_vision')
  }
  if ((key === 'acceleration' || key === 'offBall') && player.skills.includes('sh_aux_r_anti_highline_pace') && oppHighLine(opp)) {
    bonus += 6.5 * skillTierMultiplier(player, 'sh_aux_r_anti_highline_pace')
  }
  if ((key === 'anticipation' || key === 'defPos') && player.skills.includes('sh_aux_r_anti_fast_read') && oppFastCounter(opp)) {
    bonus += 6.5 * skillTierMultiplier(player, 'sh_aux_r_anti_fast_read')
  }
  if ((key === 'tackling' || key === 'anticipation') && player.skills.includes('sh_aux_r_anti_short_press') && oppShortPassing(opp)) {
    bonus += 6 * skillTierMultiplier(player, 'sh_aux_r_anti_short_press')
  }
  if ((key === 'defPos' || key === 'acceleration') && player.skills.includes('sh_aux_r_anti_wing_shift') && oppWingPlay(opp)) {
    bonus += 6 * skillTierMultiplier(player, 'sh_aux_r_anti_wing_shift')
  }
  if ((key === 'strength' || key === 'heading') && player.skills.includes('sh_aux_r_anti_direct_body') && oppDirectPassing(opp)) {
    bonus += 4.5 * skillTierMultiplier(player, 'sh_aux_r_anti_direct_body')
  }
  if ((key === 'vision' || key === 'composure') && player.skills.includes('sh_aux_r_anti_lowpress_calm') && oppLowPress(opp)) {
    bonus += 4.5 * skillTierMultiplier(player, 'sh_aux_r_anti_lowpress_calm')
  }
  if ((key === 'teamwork' || key === 'agility') && player.skills.includes('sh_aux_r_anti_mid3_grit') && oppMidfieldHeavy(opp)) {
    bonus += 4.5 * skillTierMultiplier(player, 'sh_aux_r_anti_mid3_grit')
  }
  if ((key === 'acceleration' || key === 'offBall') && player.skills.includes('sh_aux_r_anti_tired_surge') && oppFatigued(opp)) {
    bonus += 5 * skillTierMultiplier(player, 'sh_aux_r_anti_tired_surge')
  }
  return bonus
}

/** 辅助对策技能提供的跑动体力消耗倍率（目前 sh_aux_r_anti_press_aura 在对阵高压逼抢时 -12m%）。 */
export function reserveStaminaDrainScale(player: MatchPlayerState, opp: MatchTeamState | undefined): number {
  if (player.skills.includes('sh_aux_r_anti_press_aura') && oppHighPress(opp)) {
    return clamp(1 - 0.12 * skillTierMultiplier(player, 'sh_aux_r_anti_press_aura'), 0.6, 1)
  }
  return 1
}

/** 传球对抗（出球者、接球者、拦截者）的备用池对策加成。 */
export function reservePassAdjustments(
  carrier: MatchPlayerState,
  receiver: MatchPlayerState,
  interceptor: MatchPlayerState | null,
  carrierTeam: MatchTeamState | undefined,
  opp: MatchTeamState,
  type: PassType | undefined,
  from: { x: number; y: number },
  to: { x: number; y: number },
  pressure: number,
  mark?: MarkFn,
): { a: number; d: number } {
  let a = 0
  let d = 0
  const check = (p: MatchPlayerState, id: SkillId, cond: boolean, delta: number, target: 'a' | 'd') => {
    if (!p.skills.includes(id)) return
    if (cond) {
      const add = delta * skillTierMultiplier(p, id)
      if (target === 'a') a += add
      else d += add
      mark?.(p, id, true, true)
    } else {
      mark?.(p, id, false, false)
    }
  }

  // 拦截方（opp 面对 carrierTeam）
  if (interceptor) {
    check(interceptor, 'sh_r_anti_wing_wall', oppWingPlay(carrierTeam) && type === 'cross', 7.5, 'd')
    check(interceptor, 'sh_r_anti_counter_anchor', oppFastCounter(carrierTeam) && progressOf(interceptor.side, interceptor.x) < 0.5 && (type === 'through' || type === 'long'), 8, 'd')
    check(interceptor, 'sh_r_anti_long_radar', oppDirectPassing(carrierTeam) && type === 'long', 7, 'd')
    check(interceptor, 'sh_r_anti_short_trap', oppShortPassing(carrierTeam) && (type === 'short' || type === 'through'), 6.5, 'd')
    check(interceptor, 'sh_r_anti_tiki_hound', oppShortPassing(carrierTeam) && type === 'short' && !wideZone(interceptor), 6, 'd')
  }

  // 出球方（carrier 面对 opp）
  const ownHalf = progressOf(carrier.side, from.x) < 0.5
  const finalThird = progressOf(carrier.side, from.x) > 0.6
  const wingFrom = wideZone(from)
  const wingTo = wideZone(to)
  const pressured = pressure > 2.5
  check(carrier, 'sh_r_anti_press_clearance', oppHighPress(opp) && ownHalf && type === 'long', 4.5, 'a')
  check(carrier, 'sh_r_press_breaker', oppHighPress(opp) && pressured && (type === 'short' || type === 'long'), 8, 'a')
  check(carrier, 'sh_r_bus_key', oppLowLine(opp) && finalThird && (type === 'short' || type === 'through'), 7.5, 'a')
  check(carrier, 'sh_r_highline_launcher', oppHighLine(opp) && (type === 'through' || type === 'long'), 7, 'a')
  check(carrier, 'sh_r_anti_mid3_control', oppMidfieldHeavy(opp) && !wingFrom && type === 'short', 5.5, 'a')
  check(carrier, 'sh_r_anti_lowpress_tempo', oppLowPress(opp) && (type === 'long' || type === 'through'), 6.5, 'a')
  check(carrier, 'sh_r_anti_wing_switch', oppWingPlay(opp) && !wingFrom && wingTo, 4.5, 'a')
  check(carrier, 'sh_r_anti_tired_mid', oppFatigued(opp) && !wingFrom && type === 'short', 4.5, 'a')
  check(carrier, 'sh_r_anti_3back_flank', oppThreeBack(opp) && type === 'cross', 7.5, 'a')
  check(carrier, 'sh_r_anti_lowblock_cross', oppLowLine(opp) && type === 'cross', 7, 'a')
  check(carrier, 'sh_r_anti_press_escape_wing', oppHighPress(opp) && wingFrom && pressured && type === 'short', 5.5, 'a')
  check(carrier, 'sh_r_anti_short_cutback', oppShortPassing(opp) && progressOf(carrier.side, from.x) > 0.72 && wingFrom && !wingTo, 5, 'a')
  check(carrier, 'sh_r_gk_anti_press_kick', carrier.position === 'GK' && oppHighPress(opp) && type === 'long', 7.5, 'a')
  if (carrier.position === 'GK' && carrier.skills.includes('sh_r_gk_anti_press_kick') && oppHighPress(opp) && type === 'short') {
    a += 5.5 * skillTierMultiplier(carrier, 'sh_r_gk_anti_press_kick')
    mark?.(carrier, 'sh_r_gk_anti_press_kick', true, true)
  }
  check(carrier, 'sh_r_gk_anti_highline_launch', carrier.position === 'GK' && oppHighLine(opp) && type === 'long', 5, 'a')

  // 接球方（receiver 面对 opp）
  check(receiver, 'sh_r_anti_highline_sprint', oppHighLine(opp) && (type === 'through' || type === 'long'), 7, 'a')
  check(receiver, 'sh_r_highline_assassin', oppHighLine(opp) && type === 'through', 7, 'a')
  check(receiver, 'sh_r_anti_lowpress_link', oppLowPress(opp) && progressOf(receiver.side, receiver.x) > 0.65, 4.5, 'a')

  return { a, d }
}

/** 盘带对抗（持球人 vs 防守人）的备用池对策加成。 */
export function reserveDribbleAdjustments(
  carrier: MatchPlayerState,
  defender: MatchPlayerState,
  carrierTeam: MatchTeamState | undefined,
  defenderTeam: MatchTeamState | undefined,
  pressure: number,
  mark?: MarkFn,
): { a: number; d: number } {
  let a = 0
  let d = 0
  const check = (p: MatchPlayerState, id: SkillId, cond: boolean, delta: number, target: 'a' | 'd') => {
    if (!p.skills.includes(id)) return
    if (cond) {
      const add = delta * skillTierMultiplier(p, id)
      if (target === 'a') a += add
      else d += add
      mark?.(p, id, true, true)
    } else {
      mark?.(p, id, false, false)
    }
  }

  const carrierWing = wideZone(carrier)
  const defWing = wideZone(defender)
  const defOwnHalf = progressOf(defender.side, defender.x) < 0.5
  const defNearBox = progressOf(defender.side, defender.x) < 0.25

  // 持球人对阵 defenderTeam
  check(carrier, 'sh_r_press_breaker', oppHighPress(defenderTeam) && pressure > 0, 7.5, 'a')
  check(carrier, 'sh_r_anti_tired_mid', oppFatigued(defenderTeam) && !carrierWing, 4.5, 'a')
  check(carrier, 'sh_r_anti_tall_weave', defender.height >= 186, 4.5, 'a')
  check(carrier, 'sh_r_anti_3back_flank', oppThreeBack(defenderTeam) && carrierWing, 8, 'a')
  check(carrier, 'sh_r_anti_highline_sprint', oppHighLine(defenderTeam) && carrierWing, 7.5, 'a')
  check(carrier, 'sh_r_anti_press_escape_wing', oppHighPress(defenderTeam) && carrierWing && pressure > 0, 6.5, 'a')
  check(carrier, 'sh_r_anti_middle_wide', oppMiddlePlay(defenderTeam) && carrierWing, 4.5, 'a')
  check(carrier, 'sh_r_anti_tall_wing', carrierWing && defender.height >= 186, 4.5, 'a')

  // 防守人对阵 carrierTeam
  check(defender, 'sh_r_anti_wing_wall', oppWingPlay(carrierTeam), 7.5, 'd')
  check(defender, 'sh_r_anti_counter_anchor', oppFastCounter(carrierTeam) && defOwnHalf, 7.5, 'd')
  check(defender, 'sh_r_anti_twin_strikers', oppTwoStrikers(carrierTeam) && defNearBox, 6.5, 'd')
  check(defender, 'sh_r_anti_tall_lowblock', carrier.height >= 186, 4.5, 'd')
  check(defender, 'sh_r_anti_tiki_hound', oppShortPassing(carrierTeam) && !defWing, 6.5, 'd')
  check(defender, 'sh_r_anti_counter_foul', oppFastCounter(carrierTeam) && !defWing, 4.5, 'd')
  check(defender, 'sh_r_anti_wing_duel', oppWingPlay(carrierTeam) && defWing, 6.5, 'd')
  check(defender, 'sh_r_anti_counter_track', oppFastCounter(carrierTeam) && defWing, 4, 'd')

  return { a, d }
}

/** 射门与门将扑救的备用池对策加成。 */
export function reserveShotAdjustments(
  shooter: MatchPlayerState,
  gk: MatchPlayerState | null,
  keeperInPosition: boolean,
  shooterTeam: MatchTeamState,
  opp: MatchTeamState,
  opts: { point: { x: number; y: number }; header: boolean; penalty: boolean; freeKick: boolean },
  inBoxShot: boolean,
  dist: number,
  angle: number,
  pressure: number,
  chanceType: string,
  shooterLeading: boolean,
  gkLeading: boolean,
  mark?: MarkFn,
): { onTarget: number; goalGiven: number; gkScore: number } {
  let onTarget = 0
  let goalGiven = 0
  let gkScore = 0

  // 射手方对策（非点球、非直接任意球）
  if (!opts.penalty && !opts.freeKick) {
    let nearestDef: MatchPlayerState | null = null
    let bestD = Infinity
    for (const p of opp.players) {
      if (!p.onPitch || p.position === 'GK') continue
      const d = distance(p, opts.point)
      if (d < bestD) { bestD = d; nearestDef = p }
    }
    const checkShooter = (id: SkillId, cond: boolean, ot: number, gg: number, gkPenalty = 0) => {
      if (!shooter.skills.includes(id)) return
      if (cond) {
        const m = skillTierMultiplier(shooter, id)
        onTarget += ot * m
        goalGiven += gg * m
        if (gkPenalty) gkScore -= gkPenalty * m
        mark?.(shooter, id, true, true)
      } else {
        mark?.(shooter, id, false, false)
      }
    }

    const clearOrOpen = chanceType === 'clear_chance' || chanceType === 'box_open'
    const sideArea = Math.abs(opts.point.y - GOAL_Y) > 8 || angle < 36
    checkShooter('sh_r_bus_key', oppLowLine(opp) && !inBoxShot && !opts.header, 0.05, 0.04)
    checkShooter('sh_r_anti_highline_sprint', oppHighLine(opp) && !opts.header && sideArea, 0, 0.04)
    checkShooter('sh_r_anti_lowpress_cutin', oppLowPress(opp) && !opts.header && dist >= 14 && dist <= 24 && Math.abs(opts.point.y - GOAL_Y) > 8, 0.035, 0)
    checkShooter('sh_r_highline_assassin', oppHighLine(opp) && clearOrOpen, 0.06, 0.055)
    checkShooter('sh_r_bus_breaker_cannon', oppLowLine(opp) && !inBoxShot && !opts.header, 0.06, 0.05, 4.5)
    checkShooter('sh_r_bus_siege_header', oppLowLine(opp) && opts.header, 0.045, 0.035)
    checkShooter('sh_r_anti_sweeper_gk', oppSweeperKeeper(opp), 0, clearOrOpen ? 0.035 : 0, 5.5)
    checkShooter('sh_r_anti_press_poacher', oppHighPress(opp) && inBoxShot, 0, 0.035)
    checkShooter('sh_r_giant_bully', opts.header && !!nearestDef && shooter.height - nearestDef.height >= 8, 0, 0.035)
    checkShooter('sh_r_anti_3back_poacher', oppThreeBack(opp) && !opts.header && angle < 36, 0.04, 0.025)
    checkShooter('sh_r_anti_tired_finisher', oppFatigued(opp) && inBoxShot, 0, 0.035)
    checkShooter('sh_r_small_agile_shot', !opts.header && inBoxShot && pressure > 0.2 && !!nearestDef && nearestDef.height - shooter.height >= 8, 0.035, 0)
  }

  // 门将方对策（需在位且非点球）
  if (gk && !opts.penalty) {
    const checkGk = (id: SkillId, cond: boolean, add: number) => {
      if (!gk.skills.includes(id)) return
      if (keeperInPosition && cond) {
        gkScore += add * skillTierMultiplier(gk, id)
        mark?.(gk, id, true, true)
      } else {
        mark?.(gk, id, false, false)
      }
    }
    const clearOrOpen = chanceType === 'clear_chance' || chanceType === 'box_open'
    checkGk('sh_r_gk_anti_wing_boss', oppWingPlay(shooterTeam) && opts.header, 8)
    checkGk('sh_r_gk_anti_counter_wall', oppFastCounter(shooterTeam) && clearOrOpen, 8.5)
    checkGk('sh_r_gk_anti_lowblock_long', (oppMiddlePlay(shooterTeam) || oppLowPress(shooterTeam)) && !inBoxShot, 7.5)
    checkGk('sh_r_gk_anti_twin_box', oppTwoStrikers(shooterTeam) && inBoxShot && dist <= 12, 7)
    checkGk('sh_r_gk_anti_short_box', oppShortPassing(shooterTeam) && inBoxShot, 4.5)
    checkGk('sh_r_gk_anti_lead_calm', gkLeading, 4)
  }
  void shooterLeading

  return { onTarget, goalGiven, gkScore }
}

/** 封堵射门的备用池对策加成。 */
export function reserveBlockerBonus(
  player: MatchPlayerState,
  shooterTeam: MatchTeamState | undefined,
  longShot: boolean,
  defendingLeadingLate: boolean,
  mark?: MarkFn,
): number {
  let bonus = 0
  const check = (id: SkillId, cond: boolean, add: number) => {
    if (!player.skills.includes(id)) return
    if (cond) {
      bonus += add * skillTierMultiplier(player, id)
      mark?.(player, id, true, true)
    } else {
      mark?.(player, id, false, false)
    }
  }
  check('sh_r_anti_twin_strikers', oppTwoStrikers(shooterTeam), 6.5)
  check('sh_r_anti_middle_block', oppMiddlePlay(shooterTeam) && longShot, 5)
  check('sh_r_anti_late_siege', defendingLeadingLate, 5.5)
  return bonus
}

/** 高空球争顶（进攻方 / 防守方）的备用池对策加成。 */
export function reserveAerialBonus(
  player: MatchPlayerState,
  isAttacking: boolean,
  oppTeam: MatchTeamState,
  point: { x: number; y: number },
  mark?: MarkFn,
): number {
  let bonus = 0
  const isGk = player.position === 'GK'
  const check = (id: SkillId, cond: boolean, add: number) => {
    if (!player.skills.includes(id)) return
    if (cond) {
      bonus += add * skillTierMultiplier(player, id)
      mark?.(player, id, true, true)
    } else {
      mark?.(player, id, false, false)
    }
  }
  if (isAttacking) {
    check('sh_r_bus_siege_header', oppLowLine(oppTeam), 7)
    if (player.skills.includes('sh_r_giant_bully')) {
      let nearestDef: MatchPlayerState | null = null
      let bestD = Infinity
      for (const d of oppTeam.players) {
        if (!d.onPitch || d.position === 'GK') continue
        const dd = distance(d, point)
        if (dd < bestD) { bestD = dd; nearestDef = d }
      }
      check('sh_r_giant_bully', !!nearestDef && player.height - nearestDef.height >= 8, 6.5)
    }
  } else if (isGk) {
    check('sh_r_gk_anti_wing_boss', oppWingPlay(oppTeam), 8)
    check('sh_r_gk_anti_direct_sweep', oppDirectPassing(oppTeam), 5)
  } else {
    check('sh_r_anti_wing_wall', oppWingPlay(oppTeam), 6)
    check('sh_r_anti_long_radar', oppDirectPassing(oppTeam), 6.5)
  }
  return bonus
}

/** 二点球争夺的备用池对策加成。 */
export function reserveLooseBallBonus(
  player: MatchPlayerState,
  oppTeam: MatchTeamState | undefined,
  mark?: MarkFn,
): number {
  let bonus = 0
  const isGk = player.position === 'GK'
  const progress = progressOf(player.side, player.x)
  const check = (id: SkillId, cond: boolean, add: number) => {
    if (!player.skills.includes(id)) return
    if (cond) {
      bonus += add * skillTierMultiplier(player, id)
      mark?.(player, id, true, true)
    } else {
      mark?.(player, id, false, false)
    }
  }
  if (isGk) {
    check('sh_r_gk_anti_counter_wall', oppFastCounter(oppTeam), 6.5)
    check('sh_r_gk_anti_direct_sweep', oppDirectPassing(oppTeam), 5)
  } else {
    check('sh_r_anti_direct_cover', oppDirectPassing(oppTeam) && progress < 0.5, 4.5)
    check('sh_r_anti_mid3_control', oppMidfieldHeavy(oppTeam), 6)
    check('sh_r_anti_wing_duel', oppWingPlay(oppTeam) && wideZone(player), 5)
    check('sh_r_anti_press_poacher', oppHighPress(oppTeam) && progress > 0.6, 6.5)
  }
  return bonus
}

/** 门将抱球概率的备用池对策加成。 */
export function reserveKeeperCatchBonus(
  gk: MatchPlayerState,
  shooter: MatchPlayerState,
  shooterTeam: MatchTeamState | undefined,
  lateMatch: boolean,
  mark?: MarkFn,
): number {
  let bonus = 0
  const longShot = !inBox(shooter.side, shooter)
  const check = (id: SkillId, cond: boolean, add: number) => {
    if (!gk.skills.includes(id)) return
    if (cond) {
      bonus += add * skillTierMultiplier(gk, id)
      mark?.(gk, id, true, true)
    } else {
      mark?.(gk, id, false, false)
    }
  }
  check('sh_r_gk_anti_wing_boss', oppWingPlay(shooterTeam), 0.1)
  check('sh_r_gk_anti_lowblock_long', (oppMiddlePlay(shooterTeam) || oppLowPress(shooterTeam)) && longShot, 0.08)
  check('sh_r_gk_anti_tired_catch', lateMatch, 0.07)
  return bonus
}

/** 犯规占比倍率（sh_r_anti_counter_foul 对阵快节奏/防反时减少犯规）。 */
export function reserveFoulShareScale(
  defender: MatchPlayerState,
  oppTeam: MatchTeamState | undefined,
  mark?: MarkFn,
): number {
  if (defender.skills.includes('sh_r_anti_counter_foul')) {
    if (oppFastCounter(oppTeam) && !wideZone(defender)) {
      mark?.(defender, 'sh_r_anti_counter_foul', true, true)
      return clamp(1 - 0.15 * skillTierMultiplier(defender, 'sh_r_anti_counter_foul'), 0.5, 1)
    }
    mark?.(defender, 'sh_r_anti_counter_foul', false, false)
  }
  return 1
}

/** 吃牌风险倍率（sh_r_anti_counter_anchor 对阵快节奏/防反时 -30m%）。 */
export function reserveCardRiskScale(
  player: MatchPlayerState,
  oppTeam: MatchTeamState | undefined,
  mark?: MarkFn,
): number {
  if (player.skills.includes('sh_r_anti_counter_anchor')) {
    if (oppFastCounter(oppTeam)) {
      mark?.(player, 'sh_r_anti_counter_anchor', true, true)
      return clamp(1 - 0.3 * skillTierMultiplier(player, 'sh_r_anti_counter_anchor'), 0.2, 1)
    }
    mark?.(player, 'sh_r_anti_counter_anchor', false, false)
  }
  return 1
}
