import { describe, expect, it } from 'vitest'
import { MatchEngine } from '../src/game/match/engine.ts'
import { MatchRatings } from '../src/game/match/ratings.ts'
import { SettlementKernel } from '../src/game/match/resolution.ts'
import { SHOP_SKILL_IDS } from '../src/game/data/shop-skills.ts'
import { inputFor, makeTeams } from './helpers.ts'
import type { SkillId, SkillTier } from '../src/game/types.ts'

function setup(legacyRules = false) {
  const { roster, lineup } = makeTeams()
  const engine = new MatchEngine({
    seed: 21,
    home: inputFor(roster, lineup, 'home', 'Home'),
    away: inputFor(roster, lineup, 'away', 'Away'),
    knockout: false,
    rulesVersion: legacyRules ? undefined : 2,
  })
  const state = engine.state
  for (const team of state.teams) for (const player of [...team.players, ...team.bench]) {
    player.skills = []
    player.skillTiers = {}
    ;(player as any).traitId = 'test-neutral'
  }
  const marks: string[] = []
  const ratings = new MatchRatings(() => state, () => state.durationSeconds)
  const kernel = new SettlementKernel(ratings, {
    legacyRules,
    markSkill: (_p, id, condition, applied) => { if (condition && applied) marks.push(id) },
  })
  const [home, away] = state.teams
  const field = home.players.filter((p) => p.onPitch && p.position !== 'GK')
  const ownGk = home.players.find((p) => p.onPitch && p.position === 'GK')!
  const opponents = away.players.filter((p) => p.onPitch && p.position !== 'GK')
  const oppGk = away.players.find((p) => p.onPitch && p.position === 'GK')!
  return { state, ratings, kernel, marks, home, away, field, ownGk, opponents, oppGk }
}

function equip(player: { skills: SkillId[]; skillTiers?: Partial<Record<SkillId, SkillTier>> }, id?: SkillId, tier: SkillTier = 'gold') {
  player.skills = id ? [id] : []
  player.skillTiers = id ? { [id]: tier } : {}
}

describe('30 个商店技能在比赛结算内核的实效与档位倍率', () => {
  const verified = new Set<string>()

  it('传球与拦截类商店技能（7 项）全部生效且按金档 ×1.2 放大', () => {
    const { kernel, away, field, ownGk, opponents, oppGk, marks } = setup()
    const [passer, receiver] = field
    const [defender] = opponents
    for (const opp of away.players) if (opp !== defender) opp.onPitch = false
    oppGk.onPitch = false
    defender.x = 5; defender.y = 5

    // 1. sh_buildup: 本方半场短传/长传 a +4 * 1.2 = +4.8
    passer.x = 30; passer.y = 32; receiver.x = 45; receiver.y = 32
    const b1 = kernel.passModel(passer, receiver, 'short', away, passer, receiver, true).a
    equip(passer, 'sh_buildup', 'gold')
    expect(kernel.passModel(passer, receiver, 'short', away, passer, receiver, true).a - b1).toBeCloseTo(4.8)
    equip(passer)
    verified.add('sh_buildup')

    // 2. sh_switch_play: 中路向边路传球 a +4.5 * 1.2 = +5.4
    passer.x = 50; passer.y = 32; receiver.x = 60; receiver.y = 5
    const b2 = kernel.passModel(passer, receiver, 'long', away, passer, receiver, true).a
    equip(passer, 'sh_switch_play', 'gold')
    expect(kernel.passModel(passer, receiver, 'long', away, passer, receiver, true).a - b2).toBeCloseTo(5.4)
    equip(passer)
    verified.add('sh_switch_play')

    // 3. sh_halfspace_pass: 前场短传/直塞 a +4.5 * 1.2 = +5.4
    passer.x = 70; passer.y = 25; receiver.x = 82; receiver.y = 30
    const b3 = kernel.passModel(passer, receiver, 'through', away, passer, receiver, true).a
    equip(passer, 'sh_halfspace_pass', 'gold')
    expect(kernel.passModel(passer, receiver, 'through', away, passer, receiver, true).a - b3).toBeCloseTo(5.4)
    equip(passer)
    verified.add('sh_halfspace_pass')

    // 4. sh_cutback: 前场边路向中路传球 a +5 * 1.2 = +6
    passer.x = 85; passer.y = 8; receiver.x = 86; receiver.y = 32
    const b4 = kernel.passModel(passer, receiver, 'short', away, passer, receiver, true).a
    equip(passer, 'sh_cutback', 'gold')
    expect(kernel.passModel(passer, receiver, 'short', away, passer, receiver, true).a - b4).toBeCloseTo(6)
    equip(passer)
    verified.add('sh_cutback')

    // 5. sh_target_link: 前场接应传球 a +4.5 * 1.2 = +5.4
    passer.x = 55; passer.y = 32; receiver.x = 75; receiver.y = 32
    const b5 = kernel.passModel(passer, receiver, 'short', away, passer, receiver, true).a
    equip(receiver, 'sh_target_link', 'gold')
    expect(kernel.passModel(passer, receiver, 'short', away, passer, receiver, true).a - b5).toBeCloseTo(5.4)
    equip(receiver)
    verified.add('sh_target_link')

    // 6. sh_gk_short_build: 门将短传 a +5 * 1.2 = +6
    ownGk.x = 8; ownGk.y = 32; receiver.x = 22; receiver.y = 32
    const b6 = kernel.passModel(ownGk, receiver, 'short', away, ownGk, receiver, true).a
    equip(ownGk, 'sh_gk_short_build', 'gold')
    expect(kernel.passModel(ownGk, receiver, 'short', away, ownGk, receiver, true).a - b6).toBeCloseTo(6)
    equip(ownGk)
    verified.add('sh_gk_short_build')

    // 7. sh_lane_cut: 拦截长传/直塞 d +5 * 1.2 = +6
    passer.x = 40; passer.y = 32; receiver.x = 70; receiver.y = 32
    defender.x = 55; defender.y = 32
    const b7 = kernel.passModel(passer, receiver, 'through', away, passer, receiver, true).d
    equip(defender, 'sh_lane_cut', 'gold')
    expect(kernel.passModel(passer, receiver, 'through', away, passer, receiver, true).d - b7).toBeCloseTo(6)
    equip(defender)
    verified.add('sh_lane_cut')

    for (const id of ['sh_buildup', 'sh_switch_play', 'sh_halfspace_pass', 'sh_cutback', 'sh_target_link', 'sh_gk_short_build', 'sh_lane_cut']) {
      expect(marks).toContain(id)
    }
  })

  it('盘带、犯规、接球半径、任意球传中与封堵类商店技能（8 项）全部生效', () => {
    const { kernel, home, away, field, opponents, marks } = setup()
    const [carrier] = field
    const [defender] = opponents
    for (const opp of away.players) if (opp !== defender) opp.onPitch = false

    // 8. sh_box_defense: 防守者位于本方禁区附近（away 防守 x=90 → progressOf('away', 90) = 0.1 < 0.25）
    carrier.x = 88; carrier.y = 32; defender.x = 90; defender.y = 32
    const d1 = kernel.dribbleModel(carrier, defender, true).d
    equip(defender, 'sh_box_defense', 'gold')
    expect(kernel.dribbleModel(carrier, defender, true).d - d1).toBeCloseTo(6)
    equip(defender)
    verified.add('sh_box_defense')

    // 9. sh_mid_destroyer: 中路防盘带 d +4 * 1.2 = +4.8
    carrier.x = 50; carrier.y = 32; defender.x = 52; defender.y = 32
    const d2 = kernel.dribbleModel(carrier, defender, true).d
    equip(defender, 'sh_mid_destroyer', 'gold')
    expect(kernel.dribbleModel(carrier, defender, true).d - d2).toBeCloseTo(4.8)
    equip(defender)
    verified.add('sh_mid_destroyer')

    // 10. sh_ball_carrier: 中路盘带 a +4.5 * 1.2 = +5.4
    const a1 = kernel.dribbleModel(carrier, defender, true).a
    equip(carrier, 'sh_ball_carrier', 'gold')
    expect(kernel.dribbleModel(carrier, defender, true).a - a1).toBeCloseTo(5.4)
    equip(carrier)
    verified.add('sh_ball_carrier')

    // 11. sh_cut_inside: 前场边路受压盘带 a +5 * 1.2 = +6
    carrier.x = 75; carrier.y = 8; defender.x = 77; defender.y = 8
    const a2 = kernel.dribbleModel(carrier, defender, true).a
    equip(carrier, 'sh_cut_inside', 'gold')
    expect(kernel.dribbleModel(carrier, defender, true).a - a2).toBeCloseTo(6)
    equip(carrier)
    verified.add('sh_cut_inside')

    // 12. sh_clean_tackle: 犯规占比 -18% * 1.2 = -21.6%
    const fBase = kernel.foulShare(defender, away)
    equip(defender, 'sh_clean_tackle', 'gold')
    const fAfter = kernel.dribbleOdds({ p: 0.5 }, defender, away)
    expect(kernel.foulShare(defender, away)).toBeCloseTo(fBase * (1 - 0.18 * 1.2))
    expect(fAfter.foul).toBeLessThan(0.5 * fBase)
    equip(defender)
    verified.add('sh_clean_tackle')

    // 13. sh_long_block: 封堵禁区外射门 score +6 * 1.2 = +7.2
    defender.x = 85; defender.y = 32
    const bBefore = kernel.findBlockers(away, { x: 76, y: 32 }, { x: 100, y: 32 }, false, true)[0]
    equip(defender, 'sh_long_block', 'gold')
    expect(kernel.findBlockers(away, { x: 76, y: 32 }, { x: 100, y: 32 }, false, true)[0] - bBefore).toBeCloseTo(7.2)
    equip(defender)
    verified.add('sh_long_block')

    // 14. sh_ball_magnet: 接球控制半径 +0.9 * 1.2 = +1.08
    const rBefore = kernel.receptionReach(carrier, 'short')
    equip(carrier, 'sh_ball_magnet', 'gold')
    expect(kernel.receptionReach(carrier, 'short') - rBefore).toBeCloseTo(1.08)
    equip(carrier)
    verified.add('sh_ball_magnet')

    // 15. sh_dead_ball: 任意球传中质量 +0.12 * 1.2 = +0.144，且定位球落点争顶攻方 +8 * 1.2 = +9.6
    const fkBefore = kernel.freeKickDeliveryChance(carrier, { x: 88, y: 32 })
    equip(carrier, 'sh_dead_ball', 'gold')
    expect(kernel.freeKickDeliveryChance(carrier, { x: 88, y: 32 }) - fkBefore).toBeCloseTo(0.144)
    const aerPt = { x: 90, y: 32 }
    home.players[1].x = 90; home.players[1].y = 32
    const aerPlain = kernel.aerialContestants(home, away, aerPt, 'home', () => 0.5, null).find((c) => c.player.id === home.players[1].id)!.weight
    const aerDead = kernel.aerialContestants(home, away, aerPt, 'home', () => 0.5, carrier).find((c) => c.player.id === home.players[1].id)!.weight
    expect(aerDead - aerPlain).toBeCloseTo(8 * 1.2)
    equip(carrier)
    verified.add('sh_dead_ball')

    for (const id of ['sh_box_defense', 'sh_mid_destroyer', 'sh_ball_carrier', 'sh_cut_inside', 'sh_clean_tackle', 'sh_long_block', 'sh_ball_magnet', 'sh_dead_ball']) {
      expect(marks).toContain(id)
    }
  })

  it('射门与门将扑救类商店技能（10 项）全部生效，且点球大战同步生效', () => {
    const { kernel, home, away, field, opponents, oppGk, marks } = setup()
    const [shooter] = field
    for (const opp of opponents) opp.onPitch = false
    oppGk.x = 99; oppGk.y = 32

    // 16. sh_cut_in_shot: 距门 14-24m 且 |y - 32| > 8
    const cutPt = { x: 84, y: 20 }
    const s1 = kernel.shotModel(shooter, home, away, { point: cutPt, header: false, penalty: false, freeKick: false }, true)
    equip(shooter, 'sh_cut_in_shot', 'gold')
    const s1After = kernel.shotModel(shooter, home, away, { point: cutPt, header: false, penalty: false, freeKick: false }, true)
    expect(s1After.onTarget - s1.onTarget).toBeCloseTo(0.035 * 1.2)
    expect(s1After.goalGivenOnTarget - s1.goalGivenOnTarget).toBeCloseTo(0.02 * 1.2 * 0.75) // normal shot scales goalGiven by 0.75 after bonus
    equip(shooter)
    verified.add('sh_cut_in_shot')

    // 17. sh_clinical_1v1: clear_chance / box_open
    const cPt = { x: 90, y: 32 }
    const s2 = kernel.shotModel(shooter, home, away, { point: cPt, header: false, penalty: false, freeKick: false }, true)
    expect(s2.chance.type).toBe('clear_chance')
    equip(shooter, 'sh_clinical_1v1', 'gold')
    const s2After = kernel.shotModel(shooter, home, away, { point: cPt, header: false, penalty: false, freeKick: false }, true)
    expect(s2After.goalGivenOnTarget - s2.goalGivenOnTarget).toBeCloseTo(0.045 * 1.2)
    equip(shooter)
    verified.add('sh_clinical_1v1')

    // 18. sh_power_header: header
    const hPt = { x: 92, y: 32 }
    const s3 = kernel.shotModel(shooter, home, away, { point: hPt, header: true, penalty: false, freeKick: false }, true)
    equip(shooter, 'sh_power_header', 'gold')
    const s3After = kernel.shotModel(shooter, home, away, { point: hPt, header: true, penalty: false, freeKick: false }, true)
    expect(s3After.onTarget - s3.onTarget).toBeCloseTo(0.035 * 1.2)
    expect(s3After.goalGivenOnTarget - s3.goalGivenOnTarget).toBeCloseTo(0.025 * 1.2)
    equip(shooter)
    verified.add('sh_power_header')

    // 19. sh_free_kick: freeKick (+0.11 * 1.2 / +0.07 * 1.2)
    const fkPt = { x: 78, y: 32 }
    const s4 = kernel.shotModel(shooter, home, away, { point: fkPt, header: false, penalty: false, freeKick: true }, true)
    equip(shooter, 'sh_free_kick', 'gold')
    const s4After = kernel.shotModel(shooter, home, away, { point: fkPt, header: false, penalty: false, freeKick: true }, true)
    expect(s4After.onTarget - s4.onTarget).toBeCloseTo(0.11 * 1.2)
    expect(s4After.goalGivenOnTarget - s4.goalGivenOnTarget).toBeCloseTo(0.07 * 1.2)
    equip(shooter)
    verified.add('sh_free_kick')

    // 20. sh_poised_finish: pressure > 0.3
    const pressDef = opponents[0]
    pressDef.onPitch = true
    pressDef.x = 89; pressDef.y = 33
    const s5 = kernel.shotModel(shooter, home, away, { point: { x: 88, y: 32 }, header: false, penalty: false, freeKick: false }, true)
    expect(s5.chance.pressure).toBeGreaterThan(0.3)
    equip(shooter, 'sh_poised_finish', 'gold')
    const s5After = kernel.shotModel(shooter, home, away, { point: { x: 88, y: 32 }, header: false, penalty: false, freeKick: false }, true)
    expect(s5After.onTarget - s5.onTarget).toBeCloseTo(0.035 * 1.2)
    expect(s5After.goalGivenOnTarget).toBeGreaterThan(s5.goalGivenOnTarget)
    equip(shooter)
    pressDef.onPitch = false
    verified.add('sh_poised_finish')

    // 21. sh_tight_angle: angle < 22
    const tightPt = { x: 96, y: 18 }
    const s6 = kernel.shotModel(shooter, home, away, { point: tightPt, header: false, penalty: false, freeKick: false }, true)
    expect(s6.chance.angle).toBeLessThan(22)
    equip(shooter, 'sh_tight_angle', 'gold')
    const s6After = kernel.shotModel(shooter, home, away, { point: tightPt, header: false, penalty: false, freeKick: false }, true)
    expect(s6After.onTarget - s6.onTarget).toBeCloseTo(0.045 * 1.2)
    equip(shooter)
    verified.add('sh_tight_angle')

    // 22. sh_gk_long_save: 门将在位面对禁区外射门 gkScore +6 * 1.2 = +7.2
    const g1 = kernel.shotModel(shooter, home, away, { point: { x: 75, y: 32 }, header: false, penalty: false, freeKick: false }, true).gkScore
    equip(oppGk, 'sh_gk_long_save', 'gold')
    expect(kernel.shotModel(shooter, home, away, { point: { x: 75, y: 32 }, header: false, penalty: false, freeKick: false }, true).gkScore - g1).toBeCloseTo(7.2)
    equip(oppGk)
    verified.add('sh_gk_long_save')

    // 23. sh_gk_penalty: 常规点球 gkScore +7.2 + 点球大战 -0.06
    const g2 = kernel.shotModel(shooter, home, away, { point: { x: 89, y: 32 }, header: false, penalty: true, freeKick: false }, true).gkScore
    const soBefore = kernel.shootoutKickOdds(shooter, oppGk)
    equip(oppGk, 'sh_gk_penalty', 'gold')
    expect(kernel.shotModel(shooter, home, away, { point: { x: 89, y: 32 }, header: false, penalty: true, freeKick: false }, true).gkScore - g2).toBeCloseTo(7.2)
    expect(soBefore - kernel.shootoutKickOdds(shooter, oppGk)).toBeCloseTo(0.06)
    equip(oppGk)
    verified.add('sh_gk_penalty')

    // 24. sh_gk_box_command: 12m 内近射 gkScore +5 * 1.2 = +6
    const g3 = kernel.shotModel(shooter, home, away, { point: { x: 91, y: 32 }, header: false, penalty: false, freeKick: false }, true).gkScore
    equip(oppGk, 'sh_gk_box_command', 'gold')
    expect(kernel.shotModel(shooter, home, away, { point: { x: 91, y: 32 }, header: false, penalty: false, freeKick: false }, true).gkScore - g3).toBeCloseTo(6)
    equip(oppGk)
    verified.add('sh_gk_box_command')

    // 25. sh_gk_aerial_save: 头球攻门 gkScore +6 * 1.2 = +7.2
    const g4 = kernel.shotModel(shooter, home, away, { point: { x: 92, y: 32 }, header: true, penalty: false, freeKick: false }, true).gkScore
    equip(oppGk, 'sh_gk_aerial_save', 'gold')
    expect(kernel.shotModel(shooter, home, away, { point: { x: 92, y: 32 }, header: true, penalty: false, freeKick: false }, true).gkScore - g4).toBeCloseTo(7.2)
    equip(oppGk)
    verified.add('sh_gk_aerial_save')

    for (const id of ['sh_cut_in_shot', 'sh_clinical_1v1', 'sh_power_header', 'sh_free_kick', 'sh_poised_finish', 'sh_tight_angle', 'sh_gk_long_save', 'sh_gk_penalty', 'sh_gk_box_command', 'sh_gk_aerial_save']) {
      expect(marks).toContain(id)
    }
  })

  it('争顶与二点球类商店技能（5 项）全部生效，且 30 项全部覆盖并兼容旧规则', () => {
    const { kernel, home, away, field, opponents, oppGk, marks } = setup()
    const [attacker] = field
    const [defender] = opponents
    const pt = { x: 90, y: 32 }
    attacker.x = 90; attacker.y = 32
    defender.x = 90; defender.y = 32
    oppGk.x = 92; oppGk.y = 32

    // 26. sh_target_header
    const aBefore = kernel.aerialContestants(home, away, pt, 'home', () => 0.5).find((c) => c.player === attacker)!.weight
    equip(attacker, 'sh_target_header', 'gold')
    expect(kernel.aerialContestants(home, away, pt, 'home', () => 0.5).find((c) => c.player === attacker)!.weight - aBefore).toBeCloseTo(7.2)
    equip(attacker)
    verified.add('sh_target_header')

    // 27. sh_clear_header
    const dBefore = kernel.aerialContestants(home, away, pt, 'home', () => 0.5).find((c) => c.player === defender)!.weight
    equip(defender, 'sh_clear_header', 'gold')
    expect(kernel.aerialContestants(home, away, pt, 'home', () => 0.5).find((c) => c.player === defender)!.weight - dBefore).toBeCloseTo(7.2)
    equip(defender)
    verified.add('sh_clear_header')

    // 28. sh_counter_press: 对方半场二点球 +5 * 1.2 = +6
    attacker.x = 65; attacker.y = 32
    const l1 = kernel.looseBallContestants([home], { x: 65, y: 32 }, () => 0.5).find((c) => c.player === attacker)!.weight
    equip(attacker, 'sh_counter_press', 'gold')
    expect(kernel.looseBallContestants([home], { x: 65, y: 32 }, () => 0.5).find((c) => c.player === attacker)!.weight - l1).toBeCloseTo(6)
    equip(attacker)
    verified.add('sh_counter_press')

    // 29. sh_box_poacher: 对方禁区附近二点球 +6 * 1.2 = +7.2
    attacker.x = 88; attacker.y = 32
    const l2 = kernel.looseBallContestants([home], { x: 88, y: 32 }, () => 0.5).find((c) => c.player === attacker)!.weight
    equip(attacker, 'sh_box_poacher', 'gold')
    expect(kernel.looseBallContestants([home], { x: 88, y: 32 }, () => 0.5).find((c) => c.player === attacker)!.weight - l2).toBeCloseTo(7.2)
    equip(attacker)
    verified.add('sh_box_poacher')

    // 30. sh_gk_loose_claim: 门将二点球 +6 * 1.2 = +7.2
    oppGk.x = 95; oppGk.y = 32
    const l3 = kernel.looseBallContestants([away], { x: 95, y: 32 }, () => 0.5).find((c) => c.player === oppGk)!.weight
    equip(oppGk, 'sh_gk_loose_claim', 'gold')
    expect(kernel.looseBallContestants([away], { x: 95, y: 32 }, () => 0.5).find((c) => c.player === oppGk)!.weight - l3).toBeCloseTo(7.2)
    equip(oppGk)
    verified.add('sh_gk_loose_claim')

    for (const id of ['sh_target_header', 'sh_clear_header', 'sh_counter_press', 'sh_box_poacher', 'sh_gk_loose_claim']) {
      expect(marks).toContain(id)
    }

    // 旧规则路径下商店技能不改变数值（保证 pes:equiv 逐位一致）
    const legacy = setup(true)
    const lp = legacy.field[0]
    const lr = legacy.field[1]
    lp.x = 30; lp.y = 32; lr.x = 45; lr.y = 32
    const baseLegacy = legacy.kernel.passModel(lp, lr, 'short', legacy.away, lp, lr, true).a
    equip(lp, 'sh_buildup', 'rainbow')
    expect(legacy.kernel.passModel(lp, lr, 'short', legacy.away, lp, lr, true).a).toBeCloseTo(baseLegacy)
  })

  it('10 个新增场上/纪律辅助技能全部在对应情境生效，且 40 个商店技能全覆盖', () => {
    const { state, ratings, kernel, home, away, field, opponents, oppGk, marks } = setup()
    const [player] = field
    const [awayPlayer] = opponents
    player.stamina = player.maxStamina
    awayPlayer.stamina = awayPlayer.maxStamina
    // MatchPlayerState.attrs 已是 0–100 评分刻度，设为 50 避免触顶 MAX_ATTR_RATING
    for (const p of [player, awayPlayer, oppGk]) {
      p.attrs.composure = 50
      p.attrs.decisions = 50
      p.attrs.defPos = 50
      p.attrs.anticipation = 50
      p.attrs.acceleration = 50
      p.attrs.firstTouch = 50
      p.attrs.teamwork = 50
      p.attrs.vision = 50
      p.attrs.agility = 50
    }
    state.clock = state.durationSeconds * 0.4 // 中段，避免触发 early/late
    state.score = { home: 1, away: 1 }

    // 31. sh_aux_penalty_calm: 点球镇定 +8 * 1.2 = +9.6（常规点球 & 点球大战，主罚手与门将皆生效）
    const compNoPen = ratings.eff(player, 'composure', { penalty: false })
    const compPenBase = ratings.eff(player, 'composure', { penalty: true })
    const penShootoutBase = kernel.shootoutKickOdds(player, oppGk)
    equip(player, 'sh_aux_penalty_calm', 'gold')
    expect(ratings.eff(player, 'composure', { penalty: false })).toBeCloseTo(compNoPen)
    expect(ratings.eff(player, 'composure', { penalty: true }) - compPenBase).toBeCloseTo(9.6)
    expect(kernel.shootoutKickOdds(player, oppGk)).toBeGreaterThan(penShootoutBase)
    const penShotBefore = kernel.shotModel(player, home, away, { point: { x: 89, y: 32 }, header: false, penalty: true, freeKick: false }, true)
    equip(player)
    const penShotPlain = kernel.shotModel(player, home, away, { point: { x: 89, y: 32 }, header: false, penalty: true, freeKick: false }, true)
    expect(penShotBefore.finishScore).toBeGreaterThan(penShotPlain.finishScore)
    // 门将装点球大心脏同样提升扑点镇定
    const gkCompBase = ratings.eff(oppGk, 'composure', { penalty: true })
    equip(oppGk, 'sh_aux_penalty_calm', 'gold')
    expect(ratings.eff(oppGk, 'composure', { penalty: true }) - gkCompBase).toBeCloseTo(9.6)
    equip(oppGk)
    expect(marks).toContain('sh_aux_penalty_calm')
    verified.add('sh_aux_penalty_calm')

    // 32. sh_aux_comeback: 落后时镇定与决断各 +5 * 1.2 = +6
    state.score = { home: 0, away: 1 }
    const cbBase = ratings.eff(player, 'decisions')
    equip(player, 'sh_aux_comeback', 'gold')
    expect(ratings.eff(player, 'decisions') - cbBase).toBeCloseTo(6)
    state.score = { home: 1, away: 1 }
    expect(ratings.eff(player, 'decisions')).toBeCloseTo(cbBase)
    equip(player)
    verified.add('sh_aux_comeback')

    // 33. sh_aux_hold_lead: 领先时防守站位与预判各 +6
    state.score = { home: 2, away: 1 }
    const hlBase = ratings.eff(player, 'defPos')
    equip(player, 'sh_aux_hold_lead', 'gold')
    expect(ratings.eff(player, 'defPos') - hlBase).toBeCloseTo(6)
    state.score = { home: 1, away: 1 }
    equip(player)
    verified.add('sh_aux_hold_lead')

    // 34. sh_aux_late_surge: 75 分钟后镇定与加速各 +6
    state.clock = state.durationSeconds * (80 / 90)
    const lsBase = ratings.eff(player, 'acceleration')
    equip(player, 'sh_aux_late_surge', 'gold')
    expect(ratings.eff(player, 'acceleration') - lsBase).toBeCloseTo(6)
    equip(player)
    verified.add('sh_aux_late_surge')

    // 35. sh_aux_fast_start: 前 15 分钟预判与第一脚触球各 +6 * 1.2 = +7.2
    state.clock = state.durationSeconds * (10 / 90)
    const fsBase = ratings.eff(player, 'firstTouch')
    equip(player, 'sh_aux_fast_start', 'gold')
    expect(ratings.eff(player, 'firstTouch') - fsBase).toBeCloseTo(7.2)
    state.clock = state.durationSeconds * 0.4
    equip(player)
    verified.add('sh_aux_fast_start')

    // 36. sh_aux_super_sub: 替补登场后加速、镇定、预判各 +6
    player.subbedOn = true
    const ssBase = ratings.eff(player, 'anticipation')
    equip(player, 'sh_aux_super_sub', 'gold')
    expect(ratings.eff(player, 'anticipation') - ssBase).toBeCloseTo(6)
    player.subbedOn = false
    equip(player)
    verified.add('sh_aux_super_sub')

    // 37. sh_aux_home_boost: 主场团队合作与视野各 +6
    const hbBase = ratings.eff(player, 'vision')
    equip(player, 'sh_aux_home_boost', 'gold')
    expect(ratings.eff(player, 'vision') - hbBase).toBeCloseTo(6)
    equip(player)
    verified.add('sh_aux_home_boost')

    // 38. sh_aux_away_steel: 客场镇定与第一脚触球各 +6
    const asBase = ratings.eff(awayPlayer, 'composure')
    equip(awayPlayer, 'sh_aux_away_steel', 'gold')
    expect(ratings.eff(awayPlayer, 'composure') - asBase).toBeCloseTo(6)
    equip(awayPlayer)
    verified.add('sh_aux_away_steel')

    // 39. sh_aux_tired_grit: 体力低于 70% 时敏捷与防守站位各 +6
    player.stamina = player.maxStamina * 0.5
    const tgBase = ratings.eff(player, 'agility')
    equip(player, 'sh_aux_tired_grit', 'gold')
    expect(ratings.eff(player, 'agility') - tgBase).toBeCloseTo(6)
    player.stamina = player.maxStamina
    equip(player)
    verified.add('sh_aux_tired_grit')

    // 40. sh_aux_discipline: 吃牌风险 -25% * 1.2 = -30%
    const cardBase = kernel.cardOdds(player)
    equip(player, 'sh_aux_discipline', 'gold')
    const cardAfter = kernel.cardOdds(player)
    expect(cardAfter.yellow).toBeCloseTo(cardBase.yellow * 0.7)
    expect(cardAfter.straightRed).toBeCloseTo(cardBase.straightRed * 0.7)
    expect(marks).toContain('sh_aux_discipline')
    equip(player)
    verified.add('sh_aux_discipline')

    // 全部 40 个新增商店技能无遗漏
    expect(verified.size).toBe(SHOP_SKILL_IDS.length)
  })
})
