import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { destroyPlayerCards, ensureCards, equipCard, untrainedPlayer } from '../src/game/cards.ts'
import { confirmTraining, startTraining } from '../src/game/actions.ts'
import { createTrainingSession, eligibleEvents, performTrainingAction, resolveTrainingEvent } from '../src/game/training.ts'
import { eventById, ROUTE_EFFECT_DESC, ROUTE_LABELS, ROUTE_SKILL } from '../src/game/data/events.ts'
import { MatchRatings, routeAttrDelta } from '../src/game/match/ratings.ts'
import { toMatchPlayer } from '../src/game/match/team.ts'
import { MotionRatings } from '../src/game/pes/ability.ts'
import type { PlayerCard, RouteId } from '../src/game/types.ts'
import type { RatingsState } from '../src/game/match/ratings.ts'

function makeRatingsState(): RatingsState {
  const tactics = createInitialGame(1).lineup.tactics
  return {
    seed: 42,
    step: 10,
    clock: 1200,
    score: { home: 0, away: 0 },
    teams: [
      { side: 'home', id: 'h', name: 'Home', color: '#112233', accent: '#ffffff', formationId: '4-3-3', tactics: { ...tactics }, players: [], bench: [], subsUsed: 0 },
      { side: 'away', id: 'a', name: 'Away', color: '#445566', accent: '#ffffff', formationId: '4-3-3', tactics: { ...tactics }, players: [], bench: [], subsUsed: 0 },
    ],
  }
}

describe('角色卡球风烙印（routeId）打通 2D 引擎与新位置路线链', () => {
  it('全部 12 条路线均具备完整名称、对应银技与球风效果说明', () => {
    const allRoutes: RouteId[] = [
      'safe_organization', 'through_passing',
      'hold_shape', 'press_hunt',
      'calm_finish', 'long_range',
      'wing_overdrive', 'pinpoint_cross',
      'target_pivot', 'power_shield',
      'shot_stopper', 'sweeper_keeper',
    ]
    for (const r of allRoutes) {
      expect(ROUTE_LABELS[r]).toBeTruthy()
      expect(ROUTE_SKILL[r]).toBeTruthy()
      expect(ROUTE_EFFECT_DESC[r]).toBeTruthy()
    }
  })

  it('换卡、卸卡、卖人与旧存档 ensureCards 回填正确同步 player.routeId', () => {
    const game = createInitialGame(2026)
    const winger = game.roster.find((p) => p.positions.GK === 0 && p.positions.W >= 60) ?? game.roster.find((p) => p.positions.GK === 0)!

    const cardA: PlayerCard = {
      id: 'card-wing-a',
      playerId: winger.id,
      playerName: winger.name,
      serial: 1,
      version: 1,
      routeId: 'wing_overdrive',
      createdAt: 1,
      attrs: { ...winger.attrs },
      positions: { ...winger.positions },
      personality: { ...winger.personality },
      skills: [...winger.skills],
    }
    const cardB: PlayerCard = {
      ...cardA,
      id: 'card-wing-b',
      serial: 2,
      routeId: 'pinpoint_cross',
    }
    game.cards = [cardA, cardB]

    expect(winger.routeId).toBeUndefined()
    expect(equipCard(game, winger.id, cardA.id)).toEqual({ ok: true })
    expect(winger.routeId).toBe('wing_overdrive')

    // 切换到另一张同球员卡，球风烙印随之切换且不占技能槽
    const skillCountBefore = winger.skills.length
    expect(equipCard(game, winger.id, cardB.id)).toEqual({ ok: true })
    expect(winger.routeId).toBe('pinpoint_cross')
    expect(winger.skills).toHaveLength(skillCountBefore)

    // 模拟旧存档：已装备卡片有 routeId，但 player.routeId 缺失
    delete winger.routeId
    expect(ensureCards(game)).toBe(true)
    expect(winger.routeId).toBe('pinpoint_cross')
    expect(ensureCards(game)).toBe(false)

    // 换回原始属性或生成未培养模板时清除球风烙印
    expect(untrainedPlayer(winger).routeId).toBeUndefined()
    expect(equipCard(game, winger.id, null)).toEqual({ ok: true })
    expect(winger.routeId).toBeUndefined()

    // 装备后再销毁球员全部卡片，人也回到无烙印原始状态
    expect(equipCard(game, winger.id, cardA.id)).toEqual({ ok: true })
    expect(winger.routeId).toBe('wing_overdrive')
    destroyPlayerCards(game, winger)
    expect(winger.routeId).toBeUndefined()
  })

  it('toMatchPlayer、MatchRatings.eff 与 2D MotionRatings.abilities 按球风路线施加专精加成与取舍', () => {
    const game = createInitialGame(2027)
    const field = structuredClone(game.roster.find((p) => p.positions.GK === 0)!)
    const keeper = structuredClone(game.roster.find((p) => p.positions.GK > 0)!)
    // 消除基础/球星特性干扰，纯粹检验球风烙印差值
    field.traitId = 'engine'
    field.skills = []
    keeper.traitId = 'engine'
    keeper.skills = []

    const state = makeRatingsState()
    const ratings = new MatchRatings(() => state, () => 5400)
    const motion = new MotionRatings(() => state, () => 5400)

    const baseMp = toMatchPlayer(field, 'home', 'w_winger', 'LW', 'W')
    baseMp.x = 74
    baseMp.y = 6 // 边路走廊 + 前场三区
    expect(baseMp.routeId).toBeUndefined()
    expect(routeAttrDelta(baseMp, 'dribbling', { wide: true })).toBe(0)

    // 1. 边路爆破 vs 精准传中：同属性球员在 2D 连续物理层与结算层呈现截然不同倾向
    field.routeId = 'wing_overdrive'
    const overdriveMp = toMatchPlayer(field, 'home', 'w_winger', 'LW', 'W')
    overdriveMp.x = 74
    overdriveMp.y = 6

    field.routeId = 'pinpoint_cross'
    const crossMp = toMatchPlayer(field, 'home', 'w_winger', 'LW', 'W')
    crossMp.x = 74
    crossMp.y = 6

    expect(ratings.eff(overdriveMp, 'dribbling', { wide: true })).toBeCloseTo(ratings.eff(baseMp, 'dribbling', { wide: true }) + 4, 5)
    expect(ratings.eff(overdriveMp, 'defPos', {})).toBeCloseTo(ratings.eff(baseMp, 'defPos', {}) - 1.5, 5)
    expect(ratings.eff(crossMp, 'passing', { crossing: true, wide: true })).toBeCloseTo(ratings.eff(baseMp, 'passing', { crossing: true, wide: true }) + 4, 5)
    expect(ratings.eff(crossMp, 'shooting', { inBox: true })).toBeCloseTo(ratings.eff(baseMp, 'shooting', { inBox: true }) - 1.5, 5)

    const baseAb = motion.abilities(baseMp)
    const overdriveAb = motion.abilities(overdriveMp)
    const crossAb = motion.abilities(crossMp)
    expect(overdriveAb.dribbling!).toBeGreaterThan(baseAb.dribbling!)
    expect(overdriveAb.accel).toBeGreaterThan(baseAb.accel)
    expect(crossAb.passing).toBeGreaterThan(baseAb.passing)

    // 2. 高空支点 vs 背身支点
    field.routeId = 'target_pivot'
    const targetMp = toMatchPlayer(field, 'home', 'st_target', 'ST', 'ST')
    targetMp.x = 82
    targetMp.y = 32
    expect(ratings.eff(targetMp, 'heading', { aerial: true, inBox: true })).toBeCloseTo(ratings.eff({ ...targetMp, routeId: undefined }, 'heading', { aerial: true, inBox: true }) + 4.5, 5)
    expect(ratings.eff(targetMp, 'agility', {})).toBeCloseTo(ratings.eff({ ...targetMp, routeId: undefined }, 'agility', {}) - 1.5, 5)
    expect(motion.abilities(targetMp).air!).toBeGreaterThan(motion.abilities({ ...targetMp, routeId: undefined }).air!)

    field.routeId = 'power_shield'
    const shieldMp = toMatchPlayer(field, 'home', 'st_target', 'ST', 'ST')
    shieldMp.x = 75
    shieldMp.y = 32
    expect(ratings.eff(shieldMp, 'firstTouch', { pressured: true })).toBeCloseTo(ratings.eff({ ...shieldMp, routeId: undefined }, 'firstTouch', { pressured: true }) + 3, 5)
    expect(ratings.eff(shieldMp, 'speed', {})).toBeCloseTo(ratings.eff({ ...shieldMp, routeId: undefined }, 'speed', {}) - 1.5, 5)

    // 3. 门线铁闸 vs 清道门神（且门将烙印对外场位置不生效）
    const baseGk = toMatchPlayer(keeper, 'home', 'gk_line', 'GK', 'GK')
    keeper.routeId = 'shot_stopper'
    const stopperGk = toMatchPlayer(keeper, 'home', 'gk_line', 'GK', 'GK')
    keeper.routeId = 'sweeper_keeper'
    const sweeperGk = toMatchPlayer(keeper, 'home', 'gk_sweeper', 'GK', 'GK')

    expect(ratings.eff(stopperGk, 'reflexes', {})).toBeCloseTo(ratings.eff(baseGk, 'reflexes', {}) + 4, 5)
    expect(ratings.eff(stopperGk, 'rushing', {})).toBeCloseTo(ratings.eff(baseGk, 'rushing', {}) - 2, 5)
    expect(ratings.eff(sweeperGk, 'rushing', {})).toBeCloseTo(ratings.eff(baseGk, 'rushing', {}) + 4.5, 5)
    expect(ratings.eff(sweeperGk, 'oneOnOne', { oneOnOne: true })).toBeCloseTo(ratings.eff(baseGk, 'oneOnOne', { oneOnOne: true }) + 3, 5)
    expect(ratings.eff(sweeperGk, 'handling', {})).toBeCloseTo(ratings.eff(baseGk, 'handling', {}) - 1.5, 5)
  })

  it('边路、支点与门将三条新剧情链可完整走通并习得路线银技，且门将/外场事件严格隔离', () => {
    const game = createInitialGame(2028)
    const field = structuredClone(game.roster.find((p) => p.positions.GK === 0)!)
    const gk = structuredClone(game.roster.find((p) => p.positions.GK > 0)!)
    field.skills = []
    gk.skills = []

    const runLegacyDrillChain = (
      player: typeof field,
      drillAttr: 'dribbling' | 'strength' | 'reflexes',
      stage1OptionId: string,
    ) => {
      const session = createTrainingSession(player, 9001)
      delete session.scheduleVersion
      for (let step = 0; step < 80 && !session.completed; step++) {
        if (session.pendingEventId) {
          const ev = eventById(session.pendingEventId)!
          if (ev.stage === 1) resolveTrainingEvent(session, stage1OptionId)
          else if (ev.stage === 3) resolveTrainingEvent(session, 'learn')
          else resolveTrainingEvent(session, ev.options[0].id)
          continue
        }
        if (session.fatigue + 12 > 100) performTrainingAction(session, { kind: 'rest' })
        else performTrainingAction(session, { kind: 'drill', attr: drillAttr })
      }
      return session
    }

    // 边路走廊链：边路爆破 / 精准传中
    const wingA = runLegacyDrillChain(field, 'dribbling', 'overdrive')
    expect(wingA.completed).toBe(true)
    expect(wingA.routeId).toBe('wing_overdrive')
    expect(wingA.candidate.routeId).toBe('wing_overdrive')
    expect(wingA.candidate.skills).toContain('wing_runner')

    const wingB = runLegacyDrillChain(field, 'dribbling', 'cross')
    expect(wingB.routeId).toBe('pinpoint_cross')
    expect(wingB.candidate.skills).toContain('wing_cross')

    // 锋线支点链：高空支点 / 背身支点
    const pivotA = runLegacyDrillChain(field, 'strength', 'target')
    expect(pivotA.routeId).toBe('target_pivot')
    expect(pivotA.candidate.skills).toContain('aerial')

    const pivotB = runLegacyDrillChain(field, 'strength', 'shield')
    expect(pivotB.routeId).toBe('power_shield')
    expect(pivotB.candidate.skills).toContain('cm_shield')

    // 门将信条链：门线铁闸 / 清道门神
    const gkA = runLegacyDrillChain(gk, 'reflexes', 'stopper')
    expect(gkA.routeId).toBe('shot_stopper')
    expect(gkA.candidate.routeId).toBe('shot_stopper')
    expect(gkA.candidate.skills).toContain('gk_reflexes')

    const gkB = runLegacyDrillChain(gk, 'reflexes', 'sweeper')
    expect(gkB.routeId).toBe('sweeper_keeper')
    expect(gkB.candidate.skills).toContain('gk_sweeper')

    // 门将与外场事件池严格隔离：门将练传球不会误入外场直塞链，外场不会出现门将链
    const gkProbe = createTrainingSession(gk, 555)
    delete gkProbe.scheduleVersion
    for (let i = 0; i < 4; i++) performTrainingAction(gkProbe, { kind: 'drill', attr: 'passing' })
    const gkEligibleIds = eligibleEvents(gkProbe, 5).map((e) => e.id)
    expect(gkEligibleIds).not.toContain('chain_pass_1')
    expect(gkEligibleIds).not.toContain('chain_wing_1')

    const fieldProbe = createTrainingSession(field, 555)
    delete fieldProbe.scheduleVersion
    fieldProbe.trained.reflexes = 2
    const fieldEligibleIds = eligibleEvents(fieldProbe, 5).map((e) => e.id)
    expect(fieldEligibleIds).not.toContain('chain_gk_1')

    // 完整培养后 confirmTraining 装备新卡，球员即刻激活路线烙印
    expect(startTraining(game, gk.id, 3333).ok).toBe(true)
    const live = game.training[gk.id]
    delete live.scheduleVersion
    for (let guard = 0; guard < 100 && !live.completed; guard++) {
      if (live.pendingEventId) {
        const ev = eventById(live.pendingEventId)!
        resolveTrainingEvent(live, ev.stage === 1 ? 'sweeper' : ev.options[0].id)
      } else {
        performTrainingAction(live, live.fatigue + 12 > 100 ? { kind: 'rest' } : { kind: 'drill', attr: 'reflexes' })
      }
    }
    game.candidates[gk.id] = structuredClone(live.candidate)
    expect(confirmTraining(game, gk.id).ok).toBe(true)
    const updatedGk = game.roster.find((p) => p.id === gk.id)!
    expect(updatedGk.routeId).toBe('sweeper_keeper')
  })
})
