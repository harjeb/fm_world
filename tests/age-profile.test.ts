import { describe, expect, it } from 'vitest'
import {
  ageProfileOf,
  effectivePlayerFamiliarity,
  isHighIntensityTactics,
  lineupAgeAnalysis,
  lowStaminaStabilityDelta,
} from '../src/game/age-profile.ts'
import { computeBaseLineupFamiliarity, computeLineupFamiliarity } from '../src/game/squad.ts'
import { styleByRevision, cloneInstructions, legacyTacticsFromInstructions } from '../src/game/pes/tactics.ts'
import { PesGame } from '../src/game/pes/game.ts'
import { GAME_RULES } from '../src/game/pes/spec.ts'
import { baselineTeams } from '../src/game/pes/baseline.ts'
import { createWorldGame } from '../src/game/world.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { agentView } from '../server/agent.ts'
import type { AttrKey } from '../src/game/types.ts'

describe('年龄战术执行与动作成功率曲线（方案 A）', () => {
  it('曲线平滑过渡：新星偏重活力但战术/关键球青涩，黄金巅峰为零修正基准，老将战术/组织/关键球更稳但对抗与低体力衰减', () => {
    const rookie = ageProfileOf(18, false)
    const prime = ageProfileOf(26, false)
    const veteran = ageProfileOf(34, false)
    const elder = ageProfileOf(36, false)

    expect(rookie.stageId).toBe('rookie')
    expect(rookie.tacticalFamiliarityDelta).toBeLessThan(-0.05)
    expect(rookie.highIntensityFamiliarityDelta).toBeGreaterThan(0.03)
    expect(rookie.dribbleDelta).toBeGreaterThan(0.015)
    expect(rookie.passDelta).toBeLessThan(-0.02)
    expect(rookie.clutchShotDelta).toBeLessThan(-0.03)
    expect(rookie.cardScale).toBeGreaterThan(1.1)

    // 黄金巅峰零膨胀基准
    expect(prime.stageId).toBe('prime')
    expect(prime.tacticalFamiliarityDelta).toBe(0)
    expect(prime.passDelta).toBe(0)
    expect(prime.dribbleDelta).toBe(0)
    expect(prime.tackleDelta).toBe(0)
    expect(prime.shotDelta).toBe(0)
    expect(prime.clutchShotDelta).toBe(0)
    expect(prime.cardScale).toBe(1)
    expect(prime.lowStaminaDelta).toBe(0)

    // 老将经验收益与对抗/高压衰减并存
    expect(veteran.stageId).toBe('veteran')
    expect(veteran.tacticalFamiliarityDelta).toBeGreaterThanOrEqual(0.04)
    expect(veteran.passDelta).toBeGreaterThan(0.02)
    expect(veteran.pressuredPassDelta).toBeGreaterThan(veteran.passDelta)
    expect(veteran.clutchShotDelta).toBeGreaterThan(0.025)
    expect(veteran.dribbleDelta).toBeLessThan(-0.025)
    expect(veteran.tackleDelta).toBeLessThan(-0.015)
    expect(veteran.cardScale).toBeLessThan(0.9)
    expect(veteran.highIntensityFamiliarityDelta).toBeLessThan(-0.05)

    // 高龄进一步分化
    expect(elder.dribbleDelta).toBeLessThan(veteran.dribbleDelta)
    expect(elder.lowStaminaDelta).toBeLessThan(veteran.lowStaminaDelta)

    // 缺失 age 时返回零修正（兼容旧回放）
    const missing = ageProfileOf(undefined, false)
    expect(missing.passDelta).toBe(0)
    expect(missing.dribbleDelta).toBe(0)
    expect(missing.cardScale).toBe(1)
    expect(effectivePlayerFamiliarity(0.72, undefined, false, true)).toBe(0.72)
  })

  it('门将曲线相对外场延后 3 岁，且不受外场高压逼抢惩罚', () => {
    const gk30 = ageProfileOf(30, true)
    const field30 = ageProfileOf(30, false)
    const gk36 = ageProfileOf(36, true)

    expect(gk30.effectiveAge).toBe(27)
    expect(gk30.stageId).toBe('prime')
    expect(field30.stageId).toBe('mature')
    expect(gk36.effectiveAge).toBe(33)
    expect(gk36.stageId).toBe('veteran')
    expect(gk36.highIntensityFamiliarityDelta).toBe(0)
    expect(gk36.clutchShotDelta).toBeGreaterThan(0.02)
  })

  it('低体力稳定性衰减：32+ 外场老将在高强度战术下 55% 体力即开始衰减，常规战术 45% 触发', () => {
    expect(lowStaminaStabilityDelta(34, false, 0.50, false)).toBe(0)
    expect(lowStaminaStabilityDelta(34, false, 0.50, true)).toBeLessThan(0)
    expect(lowStaminaStabilityDelta(34, false, 0.25, true)).toBeLessThan(lowStaminaStabilityDelta(34, false, 0.40, true))
    expect(lowStaminaStabilityDelta(18, false, 0.25, true)).toBeGreaterThan(0)
    expect(lowStaminaStabilityDelta(26, false, 0.25, true)).toBe(0)
  })

  it('战术执行度（computeLineupFamiliarity & PesGame）：稳健阵地偏老将，高压快节奏下老将个体执行度下降且换人动态生效', () => {
    const game = createWorldGame(41)
    const calm = styleByRevision('catenaccio', 3).instructions
    const highPress = styleByRevision('highPress', 3).instructions

    const setAllAge = (age: number) => {
      for (const p of game.roster) p.age = age
    }

    // 稳健非高压战术：老将执行度 > 黄金 > 新星
    game.lineup.tacticalStyle = 'catenaccio'
    game.lineup.tacticalInstructions = cloneInstructions(calm)
    game.lineup.tactics = legacyTacticsFromInstructions(calm)
    expect(isHighIntensityTactics(game.lineup.tactics, game.lineup.tacticalInstructions)).toBe(false)

    setAllAge(18)
    const rookieCalm = computeLineupFamiliarity(game.roster, game.lineup, 10)
    setAllAge(26)
    const primeCalm = computeLineupFamiliarity(game.roster, game.lineup, 10)
    setAllAge(34)
    const veteranCalm = computeLineupFamiliarity(game.roster, game.lineup, 10)
    expect(veteranCalm).toBeGreaterThan(primeCalm)
    expect(primeCalm).toBeGreaterThan(rookieCalm)

    // 高压逼抢战术：老将承受高压惩罚，执行度低于黄金期，并触发教练建议
    game.lineup.tacticalStyle = 'highPress'
    game.lineup.tacticalInstructions = cloneInstructions(highPress)
    game.lineup.tactics = legacyTacticsFromInstructions(highPress)
    expect(isHighIntensityTactics(game.lineup.tactics, game.lineup.tacticalInstructions)).toBe(true)

    setAllAge(26)
    const primePress = computeLineupFamiliarity(game.roster, game.lineup, 10)
    setAllAge(35)
    const elderPress = computeLineupFamiliarity(game.roster, game.lineup, 10)
    expect(elderPress).toBeLessThan(primePress)
    expect(lineupAgeAnalysis(game.roster, game.lineup).tips.length).toBeGreaterThan(0)

    // PesGame 内同一球队不同年龄球员拿到各自独立 familiarity（不重复叠加）
    const starters = game.lineup.starters
    const firstField = game.roster.find((p) => p.id === starters.find((s) => s.slotId !== 'gk')!.playerId)!
    const secondField = game.roster.find((p) => p.id === starters.find((s) => s.slotId !== 'gk' && s.playerId !== firstField.id)!.playerId)!
    setAllAge(26)
    firstField.age = 18
    secondField.age = 35
    const benchTeen = game.roster.find((p) => p.id === game.lineup.bench[0])!
    benchTeen.age = 19

    game.lineup.tacticalStyle = 'catenaccio'
    game.lineup.tacticalInstructions = cloneInstructions(calm)
    game.lineup.tactics = legacyTacticsFromInstructions(calm)

    const baseFam = computeBaseLineupFamiliarity(game.roster, game.lineup, 10)
    const home = teamInputFromLineup(game.roster, game.lineup, { id: 'h', name: '主', color: '#fff', accent: '#000' }, { tacticsStage: 10 })
    const away = teamInputFromLineup(game.roster, game.lineup, { id: 'a', name: '客', color: '#fff', accent: '#000' }, { tacticsStage: 10 })
    const pg = new PesGame({ seed: 91, home, away, durationSeconds: 60, offside: true, noInjuries: true, rules: { ...GAME_RULES, simV2: true } })

    const p18 = pg.match.teams[0].players.find((p) => p.ref === `home:${firstField.id}`)!
    const p35 = pg.match.teams[0].players.find((p) => p.ref === `home:${secondField.id}`)!
    expect(p18.familiarity).toBeCloseTo(effectivePlayerFamiliarity(baseFam, 18, false, false), 3)
    expect(p35.familiarity).toBeCloseTo(effectivePlayerFamiliarity(baseFam, 35, false, false), 3)
    expect(p35.familiarity!).toBeGreaterThan(p18.familiarity!)

    // 换上 19 岁替补后，立即应用替补自身年龄执行度
    expect(pg.substitute(`home:${secondField.id}`, `home:${benchTeen.id}`, 'home').ok).toBe(true)
    const subPhys = pg.match.teams[0].players.find((p) => p.ref === `home:${benchTeen.id}`)!
    expect(subPhys.familiarity).toBeCloseTo(effectivePlayerFamiliarity(baseFam, 19, false, false), 3)
  })

  it('动作成功率结算（simV2）：不改属性，真实影响传球/过人/抢断/射门/点球/吃牌；simV2=false 零影响', () => {
    const buildKernel = (simV2: boolean) => {
      const { home, away } = baselineTeams(1)
      const g = new PesGame({ seed: 801, home: structuredClone(home), away: structuredClone(away), offside: true, noInjuries: true, rules: { ...GAME_RULES, simV2 } })
      const hTeam = g.state.teams[0]
      const aTeam = g.state.teams[1]
      const att = hTeam.players.find((p) => p.position !== 'GK')!
      const mate = hTeam.players.find((p) => p.position !== 'GK' && p !== att)!
      const def = aTeam.players.find((p) => p.position === 'CB')!
      const gk = aTeam.players.find((p) => p.position === 'GK')!
      for (const p of [att, mate, def, gk]) {
        for (const key of ['shooting', 'composure', 'dribbling', 'strength', 'tackling', 'heading', 'anticipation', 'defPos', 'offBall', 'speed', 'acceleration', 'agility', 'firstTouch', 'passing', 'reflexes', 'oneOnOne', 'handling', 'rushing'] as AttrKey[]) {
          p.attrs[key] = 65
        }
        p.skills = []; p.traitId = 'star_none'; p.foot = 'R'; p.stamina = p.maxStamina; p.positions[p.position] = 100; p.detailedPosition = undefined
      }
      for (const p of aTeam.players) if (p !== def && p !== gk) { p.x = 20; p.y = 32 }
      att.x = 88; att.y = 32
      mate.x = 80; mate.y = 22
      def.x = 90; def.y = 32.5
      gk.x = 99.5; gk.y = 32
      return { g, k: g.settlement.settlementKernel, hTeam, aTeam, att, mate, def, gk }
    }

    const v2 = buildKernel(true)
    const v1 = buildKernel(false)

    // 1. 传球受压出球：35 岁老将 > 26 岁巅峰 > 18 岁新星
    v2.def.age = 26; v2.gk.age = 28
    v2.att.age = 18
    const pass18 = v2.k.passModel(v2.att, v2.mate, 'short', v2.aTeam, v2.att, v2.mate, false).p
    v2.att.age = 26
    const pass26 = v2.k.passModel(v2.att, v2.mate, 'short', v2.aTeam, v2.att, v2.mate, false).p
    v2.att.age = 35
    const pass35 = v2.k.passModel(v2.att, v2.mate, 'short', v2.aTeam, v2.att, v2.mate, false).p
    expect(pass35).toBeGreaterThan(pass26 + 0.02)
    expect(pass26).toBeGreaterThan(pass18 + 0.02)

    // 2. 1v1 盘带过人：18 岁新星 > 26 岁巅峰 > 36 岁高龄；且防守者为 36 岁老将时更容易被过
    v2.def.age = 26
    v2.att.age = 18
    const drib18 = v2.k.dribbleModel(v2.att, v2.def, false).p
    v2.att.age = 26
    const drib26 = v2.k.dribbleModel(v2.att, v2.def, false).p
    v2.att.age = 36
    const drib36 = v2.k.dribbleModel(v2.att, v2.def, false).p
    expect(drib18).toBeGreaterThan(drib26 + 0.01)
    expect(drib26).toBeGreaterThan(drib36 + 0.03)

    v2.att.age = 26
    v2.def.age = 36
    const dribVsOldDef = v2.k.dribbleModel(v2.att, v2.def, false).p
    expect(dribVsOldDef).toBeGreaterThan(drib26 + 0.025)

    // 3. 低体力惩罚：36 岁老将在体力 20% 时传球与过人成功率显著低于满体同龄（即使把 attrs 补偿保持一致，lowStaminaDelta 仍生效）
    v2.att.age = 36
    v2.att.stamina = v2.att.maxStamina * 0.2
    const pass36Tired = v2.k.passModel(v2.att, v2.mate, 'short', v2.aTeam, v2.att, v2.mate, false).p
    v2.att.age = 26
    const pass26Tired = v2.k.passModel(v2.att, v2.mate, 'short', v2.aTeam, v2.att, v2.mate, false).p
    // 26 岁满体比 36 岁低体更稳（36 岁传球经验 +3%，但低体 -4.5% 净低）
    expect(pass36Tired).toBeLessThan(pass26Tired)
    v2.att.stamina = v2.att.maxStamina

    // 4. 点球大战：老将主罚 > 新星主罚，老将门将扑点更强
    v2.gk.age = 29
    v2.att.age = 18
    const pen18 = v2.k.shootoutKickOdds(v2.att, v2.gk)
    v2.att.age = 35
    const pen35 = v2.k.shootoutKickOdds(v2.att, v2.gk)
    expect(pen35).toBeGreaterThan(pen18 + 0.05)

    v2.att.age = 26
    v2.gk.age = 19
    const vsYoungGk = v2.k.shootoutKickOdds(v2.att, v2.gk)
    v2.gk.age = 37
    const vsVetGk = v2.k.shootoutKickOdds(v2.att, v2.gk)
    expect(vsYoungGk).toBeGreaterThan(vsVetGk + 0.05)

    // 5. 吃牌控制：18 岁比 35 岁更容易吃牌
    v2.def.age = 18
    const card18 = v2.k.cardOdds(v2.def).yellow
    v2.def.age = 35
    const card35 = v2.k.cardOdds(v2.def).yellow
    expect(card18).toBeGreaterThan(card35 * 1.25)

    // 6. simV2=false 时保持旧逻辑完全不变
    v1.att.age = 18; v1.def.age = 26
    const v1Drib18 = v1.k.dribbleModel(v1.att, v1.def, false).p
    v1.att.age = 36
    const v1Drib36 = v1.k.dribbleModel(v1.att, v1.def, false).p
    expect(v1Drib18).toBeCloseTo(v1Drib36, 9)
  })

  it('Agent API 透出球员 ageProfile 与 lineupAnalysis.ageSummary', () => {
    const game = createWorldGame(41)
    const view = agentView(game, Date.now())
    expect(view.roster[0].ageProfile).toMatchObject({
      stageId: expect.any(String),
      stageLabel: expect.any(String),
      summary: expect.any(String),
    })
    expect(view.lineupAnalysis.ageSummary).toMatchObject({
      averageAge: expect.any(Number),
      youngCount: expect.any(Number),
      primeCount: expect.any(Number),
      veteranCount: expect.any(Number),
      highIntensity: expect.any(Boolean),
      tips: expect.any(Array),
    })
  })
})
