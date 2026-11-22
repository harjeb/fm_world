import { describe, expect, it, vi } from 'vitest'
import type { AttrKey } from '../types.ts'
import { baselineTeams } from './baseline.ts'
import { PesGame } from './game.ts'
import { PesMatch } from './sim.ts'
import { GAME_RULES, NATIVE_RULES, type PesMatchSnapshot } from './spec.ts'

describe('simV2 2D 动画与 AI 演进回归', () => {
  it('默认规则开关与旧存档向后兼容：NATIVE_RULES 不开启 simV2，无 simV2 的旧快照恢复后与 v1 逐位一致', () => {
    expect(GAME_RULES.simV2).toBe(true)
    expect(NATIVE_RULES.simV2).toBeFalsy()

    const { home, away } = baselineTeams(1)
    const legacy = new PesGame({
      seed: 701,
      home: structuredClone(home),
      away: structuredClone(away),
      durationSeconds: 180,
      offside: true,
      noInjuries: true,
      rules: { ...GAME_RULES, simV2: false },
    })
    legacy.advance(60)
    const saved = JSON.parse(JSON.stringify(legacy.match.serialize())) as PesMatchSnapshot
    delete saved.rules.simV2 // 模拟升级前的旧比赛快照
    const restored = PesMatch.restore(saved, { contact: legacy.settlement })
    // 旧快照恢复后绝不能偷偷打开 simV2
    expect(restored.rules.simV2).toBeUndefined()

    const straight = new PesGame({
      seed: 701,
      home: structuredClone(home),
      away: structuredClone(away),
      durationSeconds: 180,
      offside: true,
      noInjuries: true,
      rules: { ...GAME_RULES, simV2: false },
    })
    straight.advance(60)
    const straightRestored = PesMatch.restore(JSON.parse(JSON.stringify(straight.match.serialize())), { contact: straight.settlement })
    for (let i = 0; i < 60 * 30; i++) {
      restored.step()
      straightRestored.step()
    }
    const a = restored.serialize()
    const b = straightRestored.serialize()
    delete b.rules.simV2
    expect(a).toEqual(b)
  })

  it('simV2 中途 JSON 存档往返零 undefined，且恢复后续跑与连续运行逐位一致', () => {
    const { home, away } = baselineTeams(1)
    const straight = new PesGame({ seed: 702, home: structuredClone(home), away: structuredClone(away), durationSeconds: 180, offside: true, noInjuries: true })
    straight.advance(75)
    const rawSnap = straight.match.serialize()
    const jsonSnap = JSON.parse(JSON.stringify(rawSnap)) as PesMatchSnapshot
    expect(jsonSnap).toEqual(rawSnap)

    const resumed = PesGame.restore(JSON.parse(JSON.stringify(straight.serialize())))
    straight.run()
    resumed.run()
    expect(resumed.serialize()).toEqual(straight.serialize())
  })

  it('中圈开球与界外球严格按规则一脚出球，不再出现开球/界外球自己带球走', () => {
    const { home, away } = baselineTeams(1)
    const g = new PesGame({ seed: 703, home, away, durationSeconds: 300, offside: true, noInjuries: true })
    const m = g.match
    let kickoffPassed = false
    let kickoffDribbled = false
    let throwInCount = 0
    let throwInDribbled = false

    let pendingType: string | null = null
    let pendingTaker = -1
    let pendingFrames = 0
    let evIdx = 0

    while (!g.finished) {
      const preRestart = m.restart ? { ...m.restart } : null
      const prePhase = m.phase
      g.step()

      if (preRestart && !m.restart && (prePhase === 'restart' || prePhase === 'kickoff')) {
        if (m.ball.owner === preRestart.taker && preRestart.taker >= 0) {
          pendingType = preRestart.type
          pendingTaker = preRestart.taker
          pendingFrames = 0
          if (preRestart.type === 'throwin') throwInCount++
        }
      }
      if (pendingType) {
        if (m.ball.owner === pendingTaker) {
          pendingFrames++
          const taker = m.players[pendingTaker]
          if (taker.mode === 'carry' && pendingFrames > 15) {
            if (pendingType === 'kickoff') kickoffDribbled = true
            if (pendingType === 'throwin') throwInDribbled = true
            pendingType = null
          }
        } else {
          if (pendingType === 'kickoff') kickoffPassed = true
          pendingType = null
        }
      }
      for (; evIdx < m.events.length; evIdx++) {
        // 确认首次开球后在 1 秒内发出传球
        if (m.events[evIdx].type === 'pass' && m.events[evIdx].t < 1.0) kickoffPassed = true
      }
    }
    expect(kickoffPassed).toBe(true)
    expect(kickoffDribbled).toBe(false)
    expect(throwInDribbled).toBe(false)
    expect(throwInCount).toBeGreaterThanOrEqual(0)
  })

  it('门将扑救不再 5 米隔空触发，且单帧侧移上限不超过 1.15m', () => {
    const { home, away } = baselineTeams(1)
    const g = new PesGame({ seed: 704, home, away, offside: true, noInjuries: true })
    const m = g.match
    let evIdx = 0
    let saveCount = 0
    let maxGkTeleportY = 0
    let farSaves = 0

    while (!g.finished) {
      const gk0 = m.teams[0].players[0]
      const gk1 = m.teams[1].players[0]
      const prevGk = [{ ...gk0.pos }, { ...gk1.pos }]
      const prevBall = { x: m.ball.x, y: m.ball.y }
      g.step()
      for (; evIdx < m.events.length; evIdx++) {
        const e = m.events[evIdx]
        if (e.type === 'save' && !e.meta?.claim) {
          saveCount++
          const gk = m.players[e.actors[0]]
          const pre = prevGk[gk.ti]
          const dBallGk = Math.hypot(prevBall.x - pre.x, prevBall.y - pre.y)
          if (dBallGk > 2.6) farSaves++
          const dy = Math.abs(gk.pos.y - pre.y)
          if (dy > maxGkTeleportY) maxGkTeleportY = dy
        }
      }
    }
    expect(saveCount).toBeGreaterThan(2)
    expect(maxGkTeleportY).toBeLessThanOrEqual(1.25)
    // 允许极少数门线安全兜底，隔空扑救占比必须远低于 15%（旧版为 97%）
    expect(farSaves / saveCount).toBeLessThan(0.15)
  })

  it('射门封堵飞向真正封堵的后卫并发生碰撞折射，而非在射手脚边原地乱飞', () => {
    const { home, away } = baselineTeams(1)
    const g = new PesGame({ seed: 705, home, away, offside: true, noInjuries: true })
    const m = g.match
    m.phase = 'play'; m.restart = null; m.setPiece = null
    for (const p of m.players) {
      p.pos = { x: -30, y: 0 }; p.target = { ...p.pos }; p.vel = { x: 0, y: 0 }; p.decideT = 99
    }
    const shooter = m.teams[0].players[9]
    const blocker = m.teams[1].players[2]
    shooter.pos = { x: 25, y: 0 }
    blocker.pos = { x: 30, y: 0.4 }
    Object.assign(m.ball, { frozen: false, owner: shooter.pid, x: 25.5, y: 0, z: 0, vx: 0, vy: 0, vz: 0, meta: null, lastTouch: shooter.pid })
    vi.spyOn(g.settlement, 'shot').mockReturnValue({ result: 'block', blocker: blocker.pid, xg: 0.12, hold: false, meta: {} })
    ;(m as unknown as { execShot(p: typeof shooter, press: number): void }).execShot(shooter, 0.3)

    expect(m.ball.meta?.type).toBe('blocked')
    expect(m.ball.meta?.blocker).toBe(blocker.pid)
    expect(m.ball.meta?.deflected).toBe(false)
    expect(m.ball.vx).toBeGreaterThan(15) // 先朝后卫飞过去
    for (let i = 0; i < 30 && m.ball.meta && !m.ball.meta.deflected; i++) m.step()
    expect(m.ball.meta?.deflected).toBe(true)
    expect(Math.hypot(m.ball.x - blocker.pos.x, m.ball.y - blocker.pos.y)).toBeLessThan(2.0)
  })

  it('单刀速度与爆发力物理：高速度/高爆发前锋稳稳甩开慢中卫完成射门，而慢前锋会被快中卫缩近身位', () => {
    const runBreakaway = (simV2: boolean, stPace: number, stAccel: number, cbPace: number, cbAccel: number, startVel: number) => {
      const { home, away } = baselineTeams(1)
      const g = new PesGame({ seed: 710, home, away, offside: true, noInjuries: true, rules: { ...GAME_RULES, simV2 } })
      const m = g.match
      m.phase = 'play'; m.restart = null; m.setPiece = null
      for (const p of m.players) {
        p.pos = { x: p.ti === 0 ? -35 : -30, y: (p.slot - 5) * 4 }
        p.target = { ...p.pos }; p.vel = { x: 0, y: 0 }; p.stun = 0; p.noClaim = 0; p.tackleCd = 0; p.shotCd = 0; p.holdUntil = 0; p.decideT = 0.05
      }
      const st = m.teams[0].players[9]
      st.ab.pace = stPace; st.ab.accel = stAccel; st.ab.control = 0.78; st.ab.shooting = 0.80
      st.pos = { x: 10, y: 0 }; st.facing = { x: 1, y: 0 }; st.vel = { x: startVel, y: 0 }; st.mode = 'carry'; st.urgency = 0.94
      const cb = m.teams[1].players[2]
      cb.ab.pace = cbPace; cb.ab.accel = cbAccel; cb.ab.tackling = 0.75
      cb.pos = { x: 7.2, y: 0.4 }; cb.facing = { x: 1, y: 0 }; cb.vel = { x: startVel * 0.85, y: 0 }; cb.mode = 'press'; cb.urgency = 0.90
      const gk = m.teams[1].players[0]
      gk.pos = { x: m.spec.HL - 1.5, y: 0 }; gk.target = { ...gk.pos }
      Object.assign(m.ball, { frozen: false, owner: st.pid, x: st.pos.x + 0.5, y: 0, z: 0, vx: startVel, vy: 0, vz: 0, meta: null, lastTouch: st.pid })
      let shot = false
      let tackled = false
      let evIdx = m.events.length
      for (let step = 0; step < 60 * 7 && !shot && !tackled; step++) {
        g.step()
        for (; evIdx < m.events.length; evIdx++) {
          const e = m.events[evIdx]
          if (e.type === 'shot' && e.actors[0] === st.pid) shot = true
          if ((e.type === 'tackle' || e.type === 'foul') && e.actors[1] === st.pid) tackled = true
        }
      }
      return { shot, tackled, endGap: st.pos.x - cb.pos.x }
    }

    // 高速度+高爆发前锋 vs 慢中卫：v2 拉开距离射门
    const fastV2 = runBreakaway(true, 0.88, 0.85, 0.48, 0.50, 6.0)
    expect(fastV2.shot).toBe(true)
    expect(fastV2.tackled).toBe(false)
    expect(fastV2.endGap).toBeGreaterThan(3.0)

    // 原地静止起速、极速相近但高爆发 vs 低爆发：v2 靠爆发力起速甩开
    const burstV2 = runBreakaway(true, 0.72, 0.90, 0.68, 0.40, 0.0)
    expect(burstV2.shot).toBe(true)
    expect(burstV2.tackled).toBe(false)
    expect(burstV2.endGap).toBeGreaterThan(3.0)

    // 慢前锋 vs 快中卫：快中卫确实能缩近身位（不会让慢前锋也无脑甩开）
    const slowV2 = runBreakaway(true, 0.50, 0.50, 0.80, 0.78, 5.0)
    expect(slowV2.endGap).toBeLessThan(2.3)
  })

  it('镇定强化：simV2 下主罚者与门将镇定显著影响常规点球、点球大战与主罚选人，simV2=false 保持旧公式不变', () => {
    const setupKernel = (simV2: boolean) => {
      const { home, away } = baselineTeams(1)
      const g = new PesGame({ seed: 720, home: structuredClone(home), away: structuredClone(away), offside: true, noInjuries: true, rules: { ...GAME_RULES, simV2 } })
      const hTeam = g.state.teams[0]
      const aTeam = g.state.teams[1]
      const taker = hTeam.players.find((p) => p.position !== 'GK')!
      const gk = aTeam.players.find((p) => p.position === 'GK')!
      for (const a of ['shooting', 'composure', 'dribbling', 'strength', 'heading', 'passing', 'firstTouch', 'agility', 'acceleration'] as AttrKey[]) taker.attrs[a] = 55
      for (const a of ['reflexes', 'oneOnOne', 'composure', 'handling', 'defPos', 'rushing', 'passing'] as AttrKey[]) gk.attrs[a] = 55
      taker.skills = []; taker.traitId = 'star_none'; taker.foot = 'R'; taker.stamina = taker.maxStamina; taker.positions[taker.position] = 100; taker.detailedPosition = undefined
      gk.skills = []; gk.traitId = 'star_none'; gk.stamina = gk.maxStamina; gk.positions[gk.position] = 100; gk.detailedPosition = undefined
      taker.x = 89; taker.y = 32; gk.x = 99.5; gk.y = 32
      return { g, k: g.settlement.settlementKernel, hTeam, aTeam, taker, gk }
    }

    const v2 = setupKernel(true)
    const v1 = setupKernel(false)
    const penOpts = { point: { x: 89, y: 32 }, header: false, penalty: true, freeKick: false, foot: 'right' as const }

    // 1) 常规点球：主罚者镇定 25 -> 85 在 simV2 下提升超过 20 个百分点，旧版仅微弱波动
    v2.taker.attrs.composure = 25
    const v2PenLo = v2.k.shotModel(v2.taker, v2.hTeam, v2.aTeam, penOpts)
    v2.taker.attrs.composure = 85
    const v2PenHi = v2.k.shotModel(v2.taker, v2.hTeam, v2.aTeam, penOpts)
    expect(v2PenHi.pGoal - v2PenLo.pGoal).toBeGreaterThan(0.20)
    expect(v2PenHi.onTarget - v2PenLo.onTarget).toBeGreaterThan(0.10)

    v1.taker.attrs.composure = 25
    const v1PenLo = v1.k.shotModel(v1.taker, v1.hTeam, v1.aTeam, penOpts)
    v1.taker.attrs.composure = 85
    const v1PenHi = v1.k.shotModel(v1.taker, v1.hTeam, v1.aTeam, penOpts)
    expect(v1PenHi.pGoal - v1PenLo.pGoal).toBeLessThan(0.08)

    // 2) 门将镇定扑点：simV2 下显著压低罚球命中率，simV2=false 维持 0 影响
    v2.taker.attrs.composure = 55; v1.taker.attrs.composure = 55
    v2.gk.attrs.composure = 25
    const v2GkLo = v2.k.shotModel(v2.taker, v2.hTeam, v2.aTeam, penOpts)
    v2.gk.attrs.composure = 85
    const v2GkHi = v2.k.shotModel(v2.taker, v2.hTeam, v2.aTeam, penOpts)
    expect(v2GkLo.pGoal - v2GkHi.pGoal).toBeGreaterThan(0.07)

    v1.gk.attrs.composure = 25
    const v1GkLo = v1.k.shotModel(v1.taker, v1.hTeam, v1.aTeam, penOpts)
    v1.gk.attrs.composure = 85
    const v1GkHi = v1.k.shotModel(v1.taker, v1.hTeam, v1.aTeam, penOpts)
    expect(v1GkHi.pGoal).toBe(v1GkLo.pGoal)

    // 3) 点球大战：主罚者与门将镇定都在 simV2 下显著拉大差距
    v2.gk.attrs.composure = 55
    v2.taker.attrs.composure = 25
    const v2SoLo = v2.k.shootoutKickOdds(v2.taker, v2.gk)
    v2.taker.attrs.composure = 85
    const v2SoHi = v2.k.shootoutKickOdds(v2.taker, v2.gk)
    expect(v2SoHi - v2SoLo).toBeGreaterThan(0.18)

    v2.taker.attrs.composure = 55
    v2.gk.attrs.composure = 25
    const v2SoGkLo = v2.k.shootoutKickOdds(v2.taker, v2.gk)
    v2.gk.attrs.composure = 85
    const v2SoGkHi = v2.k.shootoutKickOdds(v2.taker, v2.gk)
    expect(v2SoGkLo - v2SoGkHi).toBeGreaterThan(0.06)

    v1.gk.attrs.composure = 25
    const v1SoGkLo = v1.k.shootoutKickOdds(v1.taker, v1.gk)
    v1.gk.attrs.composure = 85
    const v1SoGkHi = v1.k.shootoutKickOdds(v1.taker, v1.gk)
    expect(v1SoGkHi).toBe(v1SoGkLo)

    // 4) 场上点球主罚选人：射术相同时优先选镇定更高的球员
    const m = v2.g.match
    for (const p of m.teams[0].players) {
      if (p.role === 'GK') continue
      p.ab.shooting = 0.70
      p.ab.composure = 0.45
    }
    const calmTaker = m.teams[0].players[8]
    calmTaker.ab.composure = 0.95
    ;(m as unknown as { setRestart(type: string, pos: { x: number; y: number }, team: typeof m.teams[0]): void }).setRestart('penalty', { x: 40, y: 0 }, m.teams[0])
    expect(m.restart?.taker).toBe(calmTaker.pid)

    // 5) 常规点球与直接任意球转化率校准：55v55 点球 ~74%–82%，22 米直接任意球 ~5.5%–8.5%，且远射技能不叠加到直接任意球
    v2.taker.attrs.shooting = 55; v2.taker.attrs.composure = 55; v2.taker.age = 26
    v2.gk.attrs.reflexes = 55; v2.gk.attrs.oneOnOne = 55; v2.gk.attrs.composure = 55; v2.gk.age = 26
    for (const p of v2.aTeam.players) if (p !== v2.gk) { p.x = 5; p.y = 5 }
    const pen55 = v2.k.shotModel(v2.taker, v2.hTeam, v2.aTeam, penOpts)
    expect(pen55.pGoal).toBeGreaterThan(0.73)
    expect(pen55.pGoal).toBeLessThan(0.83)

    const fkOpts = { point: { x: 78, y: 32 }, header: false, penalty: false, freeKick: true, foot: 'right' as const }
    const fkPlain = v2.k.shotModel(v2.taker, v2.hTeam, v2.aTeam, fkOpts)
    expect(fkPlain.pGoal).toBeGreaterThan(0.05)
    expect(fkPlain.pGoal).toBeLessThan(0.085)

    v2.taker.skills = ['long_shot']
    v2.taker.skillTiers = { long_shot: 'gold' }
    expect(v2.k.shotModel(v2.taker, v2.hTeam, v2.aTeam, fkOpts).pGoal).toBeCloseTo(fkPlain.pGoal, 6)

    v2.taker.skills = ['sh_free_kick']
    v2.taker.skillTiers = { sh_free_kick: 'gold' }
    const fkSkill = v2.k.shotModel(v2.taker, v2.hTeam, v2.aTeam, fkOpts)
    expect(fkSkill.pGoal).toBeGreaterThan(fkPlain.pGoal + 0.05)
    expect(fkSkill.pGoal).toBeLessThan(0.17)

    v2.taker.skills = ['lg_knuckleball']
    v2.taker.skillTiers = { lg_knuckleball: 'gold' }
    const fkKnuckle = v2.k.shotModel(v2.taker, v2.hTeam, v2.aTeam, fkOpts)
    expect(fkKnuckle.pGoal).toBeGreaterThan(fkSkill.pGoal)
    expect(fkKnuckle.pGoal).toBeLessThan(0.19)

    // 6) simV2 定位球专家自动优先主罚（直接任意球 / 任意球传中 / 角球），且电梯球拓展超远射程
    const fkSpec = m.teams[0].players[6]
    const deadSpec = m.teams[0].players[5]
    const fkSpecMp = v2.g.settlement.gamePlayer(fkSpec.pid)!
    const deadSpecMp = v2.g.settlement.gamePlayer(deadSpec.pid)!
    for (const q of m.teams[0].players) {
      const mp = v2.g.settlement.gamePlayer(q.pid)
      if (mp) { mp.skills = []; mp.traitId = 'star_none' }
    }
    fkSpecMp.skills = ['lg_knuckleball']
    deadSpecMp.skills = ['sh_dead_ball']
    const setRestart = (m as unknown as { setRestart(type: string, pos: { x: number; y: number }, team: typeof m.teams[0]): void }).setRestart.bind(m)
    // 32 米前场任意球：电梯球专家具备 +6m 超远射程，被选为直接任意球主罚手
    setRestart('fk', { x: m.spec.HL - 32 * (m.spec.L / 100), y: 0 }, m.teams[0])
    expect(m.restart?.taker).toBe(fkSpec.pid)
    // 角球与 40 米远距离定位球传中：定位球弧线专家优先主罚
    setRestart('corner', { x: m.spec.HL - 0.5, y: m.spec.HW - 0.5 }, m.teams[0])
    expect(m.restart?.taker).toBe(deadSpec.pid)
    setRestart('fk', { x: m.spec.HL - 40 * (m.spec.L / 100), y: 12 }, m.teams[0])
    expect(m.restart?.taker).toBe(deadSpec.pid)
  })

  it('力量与盘带强化：对抗护球、高空二点球权重对比、防封堵起脚与带球速度均显著受益', () => {
    const setup = (simV2: boolean) => {
      const { home, away } = baselineTeams(1)
      const g = new PesGame({ seed: 721, home: structuredClone(home), away: structuredClone(away), offside: true, noInjuries: true, rules: { ...GAME_RULES, simV2 } })
      const hTeam = g.state.teams[0]
      const aTeam = g.state.teams[1]
      const att = hTeam.players.find((p) => p.position !== 'GK')!
      const def = aTeam.players.find((p) => p.position === 'CB')!
      for (const p of [att, def]) {
        for (const a of ['shooting', 'composure', 'dribbling', 'strength', 'tackling', 'heading', 'anticipation', 'defPos', 'offBall', 'speed', 'acceleration', 'agility', 'firstTouch'] as AttrKey[]) p.attrs[a] = 55
        p.skills = []; p.traitId = 'star_none'; p.stamina = p.maxStamina; p.positions[p.position] = 100; p.detailedPosition = undefined
      }
      for (const p of aTeam.players) if (p !== def && p.position !== 'GK') { p.x = 30; p.y = 32 }
      att.x = 89; att.y = 32; def.x = 91; def.y = 32.5
      return { g, k: g.settlement.settlementKernel, hTeam, aTeam, att, def }
    }

    const v2 = setup(true)
    const v1 = setup(false)

    // 1) 盘带与力量在 dribbleModel 的收益显著高于旧版
    v2.att.attrs.dribbling = 25
    const v2DribLo = v2.k.dribbleModel(v2.att, v2.def, false).p
    v2.att.attrs.dribbling = 85
    const v2DribHi = v2.k.dribbleModel(v2.att, v2.def, false).p
    v1.att.attrs.dribbling = 25
    const v1DribLo = v1.k.dribbleModel(v1.att, v1.def, false).p
    v1.att.attrs.dribbling = 85
    const v1DribHi = v1.k.dribbleModel(v1.att, v1.def, false).p
    expect(v2DribHi - v2DribLo).toBeGreaterThan(0.25)
    expect(v2DribHi - v2DribLo).toBeGreaterThan((v1DribHi - v1DribLo) + 0.08)

    v2.att.attrs.dribbling = 55; v1.att.attrs.dribbling = 55
    v2.att.attrs.strength = 25
    const v2StrLo = v2.k.dribbleModel(v2.att, v2.def, false).p
    v2.att.attrs.strength = 85
    const v2StrHi = v2.k.dribbleModel(v2.att, v2.def, false).p
    expect(v2StrHi - v2StrLo).toBeGreaterThan(0.11)
    v2.att.attrs.strength = 55

    // 2) 高盘带在受阻射门时降低被封堵率（旧版不变）
    const shotOpts = { point: { x: 89, y: 32 }, header: false, penalty: false, freeKick: false, foot: 'right' as const }
    v2.att.attrs.dribbling = 25
    const v2BlkLo = v2.k.shotModel(v2.att, v2.hTeam, v2.aTeam, shotOpts)
    v2.att.attrs.dribbling = 85
    const v2BlkHi = v2.k.shotModel(v2.att, v2.hTeam, v2.aTeam, shotOpts)
    expect(v2BlkLo.block - v2BlkHi.block).toBeGreaterThan(0.05)
    expect(v2BlkHi.pGoal).toBeGreaterThan(v2BlkLo.pGoal)

    v1.att.attrs.dribbling = 25
    const v1BlkLo = v1.k.shotModel(v1.att, v1.hTeam, v1.aTeam, shotOpts)
    v1.att.attrs.dribbling = 85
    const v1BlkHi = v1.k.shotModel(v1.att, v1.hTeam, v1.aTeam, shotOpts)
    expect(v1BlkHi.block).toBe(v1BlkLo.block)

    // 3) 力量在高空争顶与二点球中的权重对比度高于旧版
    v2.att.attrs.strength = 85; v2.def.attrs.strength = 25
    v1.att.attrs.strength = 85; v1.def.attrs.strength = 25
    const zeroJitter = () => 0.5
    const v2Air = v2.k.aerialContestants({ ...v2.hTeam, players: [v2.att] }, { ...v2.aTeam, players: [v2.def] }, { x: 90, y: 32 }, 'home', zeroJitter)
    const v1Air = v1.k.aerialContestants({ ...v1.hTeam, players: [v1.att] }, { ...v1.aTeam, players: [v1.def] }, { x: 90, y: 32 }, 'home', zeroJitter)
    expect(v2Air[0].weight / v2Air[1].weight).toBeGreaterThan((v1Air[0].weight / v1Air[1].weight) * 1.15)
    const v2Loose = v2.k.looseBallContestants([{ ...v2.hTeam, players: [v2.att] }, { ...v2.aTeam, players: [v2.def] }], { x: 90, y: 32 }, zeroJitter)
    const v1Loose = v1.k.looseBallContestants([{ ...v1.hTeam, players: [v1.att] }, { ...v1.aTeam, players: [v1.def] }], { x: 90, y: 32 }, zeroJitter)
    expect(v2Loose[0].weight / v2Loose[1].weight).toBeGreaterThan((v1Loose[0].weight / v1Loose[1].weight) * 1.15)

    // 4) 物理层护球抗减速 & 盘带速率：同速同爆发下，高力量顶住贴身防守、高盘带带球推进更快
    const runCarry = (dribbling: number, strength: number, hasCloseDef: boolean) => {
      const { home, away } = baselineTeams(1)
      const g = new PesGame({ seed: 722, home: structuredClone(home), away: structuredClone(away), offside: true, noInjuries: true })
      const m = g.match
      m.phase = 'play'; m.restart = null; m.setPiece = null
      for (const p of m.players) {
        p.pos = { x: -40, y: (p.slot - 5) * 4 }; p.target = { ...p.pos }; p.vel = { x: 0, y: 0 }; p.decideT = 99; p.tackleCd = 99
      }
      const att = m.teams[0].players[9]
      att.ab.pace = 0.70; att.ab.accel = 0.70; att.ab.control = 0.70; att.ab.dribbling = dribbling; att.ab.strength = strength
      att.pos = { x: 0, y: 0 }; att.target = { x: 30, y: 0 }; att.facing = { x: 1, y: 0 }; att.vel = { x: 2, y: 0 }; att.mode = 'carry'; att.urgency = 0.80
      if (hasCloseDef) {
        const def = m.teams[1].players[2]
        def.ab.strength = 0.90
        def.pos = { x: 1.0, y: 0.9 }; def.target = { x: 30, y: 0.9 }; def.vel = { x: 2, y: 0 }; def.tackleCd = 99
      }
      Object.assign(m.ball, { frozen: false, owner: att.pid, x: 0.5, y: 0, z: 0, vx: 2, vy: 0, vz: 0, meta: null, lastTouch: att.pid })
      for (let i = 0; i < 90; i++) m.step()
      return att.pos.x
    }

    expect(runCarry(0.95, 0.65, false)).toBeGreaterThan(runCarry(0.25, 0.65, false) + 0.5)
    expect(runCarry(0.65, 0.95, true)).toBeGreaterThan(runCarry(0.65, 0.25, true) + 0.3)
  })

  it('高评分均势对抗零膨胀：95v95 下 simV2 的受压射门、封堵率与受压传球不向进攻方单边虚高', () => {
    const setup95 = (simV2: boolean) => {
      const { home, away } = baselineTeams(1)
      const g = new PesGame({ seed: 725, home: structuredClone(home), away: structuredClone(away), offside: true, noInjuries: true, rules: { ...GAME_RULES, simV2 } })
      const hTeam = g.state.teams[0]
      const aTeam = g.state.teams[1]
      const att = hTeam.players.find((p) => p.position !== 'GK')!
      const mate = hTeam.players.find((p) => p.position !== 'GK' && p !== att)!
      const def = aTeam.players.find((p) => p.position === 'CB')!
      const gk = aTeam.players.find((p) => p.position === 'GK')!
      for (const p of [att, mate, def, gk]) {
        for (const a of ['shooting', 'composure', 'dribbling', 'strength', 'tackling', 'heading', 'anticipation', 'defPos', 'offBall', 'speed', 'acceleration', 'agility', 'firstTouch', 'passing', 'reflexes', 'oneOnOne', 'handling', 'rushing'] as AttrKey[]) {
          p.attrs[a] = 95
        }
        p.skills = []; p.traitId = 'star_none'; p.foot = 'R'; p.age = 28; p.stamina = p.maxStamina; p.positions[p.position] = 100; p.detailedPosition = undefined
      }
      for (const p of aTeam.players) if (p !== def && p !== gk) { p.x = 20; p.y = 32 }
      att.x = 89; att.y = 32
      mate.x = 82; mate.y = 22
      def.x = 91; def.y = 32.4
      gk.x = 99.5; gk.y = 32
      return { k: g.settlement.settlementKernel, hTeam, aTeam, att, mate, def, gk }
    }

    const v2 = setup95(true)
    const v1 = setup95(false)
    const opts = { point: { x: 89, y: 32 }, header: false, penalty: false, freeKick: false, foot: 'right' as const }

    // 95 vs 95 均势受压射门：finishScore、block、onTarget、pGoal 不出现单边虚高
    const s2 = v2.k.shotModel(v2.att, v2.hTeam, v2.aTeam, opts)
    const s1 = v1.k.shotModel(v1.att, v1.hTeam, v1.aTeam, opts)
    expect(s2.finishScore).toBeCloseTo(s1.finishScore, 5)
    expect(s2.block).toBeCloseTo(s1.block, 5)
    expect(s2.onTarget).toBeCloseTo(s1.onTarget, 5)
    expect(s2.pGoal).toBeCloseTo(s1.pGoal, 5)

    // 95 vs 95 均势受压传球：c 与 p 同样保持零膨胀
    const p2 = v2.k.passModel(v2.att, v2.mate, 'short', v2.aTeam, v2.att, v2.mate, false)
    const p1 = v1.k.passModel(v1.att, v1.mate, 'short', v1.aTeam, v1.att, v1.mate, false)
    expect(p2.c).toBeCloseTo(p1.c, 5)
    expect(p2.p).toBeCloseTo(p1.p, 5)

    // 真正存在属性优势（95 vs 55）时，simV2 仍给出更强的盘带/力量/镇定破局收益
    v2.def.attrs.tackling = 55; v2.def.attrs.agility = 55; v2.def.attrs.strength = 55; v2.def.attrs.composure = 55
    v1.def.attrs.tackling = 55; v1.def.attrs.agility = 55; v1.def.attrs.strength = 55; v1.def.attrs.composure = 55
    const s2Adv = v2.k.shotModel(v2.att, v2.hTeam, v2.aTeam, opts)
    const s1Adv = v1.k.shotModel(v1.att, v1.hTeam, v1.aTeam, opts)
    expect(s2Adv.block).toBeLessThan(s1Adv.block - 0.04)
    expect(s2Adv.pGoal).toBeGreaterThan(s1Adv.pGoal + 0.02)
  })
})
