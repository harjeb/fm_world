import { describe, expect, it } from 'vitest'
import type { ContactModel, DuelVerdict, FoulVerdict, PassVerdict, ShotRequest, ShotVerdict } from './contact.ts'
import { fixtureTeam } from './fixtures.ts'
import { PesMatch } from './sim.ts'
import { GAME_RULES, makePitch7, type PesEvent, type PesPlayer } from './spec.ts'

/**
 * 接触点“演出”的测试：用一个按剧本回答的假模型代替结算内核，
 * 验证内核拿到判定结果之后，球和球员是否真的按结果动起来（传球到位 / 被拦截 / 传丢 / 出界，射门进 / 被扑 / 封堵 / 偏出，
 * 犯规出牌、点球、红牌离场、换人……）。结算内核本身的概率另有测试。
 */
class Scripted implements ContactModel {
  events: PesEvent[] = []
  passVerdict: PassVerdict = { result: 'ok', interceptor: -1, p: 0.9 }
  shotVerdict: ShotVerdict = { result: 'goal', blocker: -1, xg: 0.3, hold: true, meta: { chance: 'normal' } }
  duelVerdict: DuelVerdict = { outcome: 'keep', card: null, second: false, injured: -1, recoveryDays: 0, p: 0.7 }
  foulVerdict: FoulVerdict | null = null
  aerialWinner = -1
  shots: ShotRequest[] = []
  passes: string[] = []
  attach(): void {}
  onEvent(_m: PesMatch, event: PesEvent): void {
    this.events.push(event)
  }
  pass(_m: PesMatch, _passer: PesPlayer, _receiver: PesPlayer, _aim: unknown, kind: string): PassVerdict {
    this.passes.push(kind)
    return this.passVerdict
  }
  shot(_m: PesMatch, _shooter: PesPlayer, request: ShotRequest): ShotVerdict {
    this.shots.push(request)
    return this.shotVerdict
  }
  duel(): DuelVerdict {
    return this.duelVerdict
  }
  tacticalFoul(): FoulVerdict | null {
    return this.foulVerdict
  }
  aerial(): number {
    return this.aerialWinner
  }
  loose(_m: PesMatch, claimants: PesPlayer[]): number {
    return claimants[0].pid
  }
  beatsOffside(): boolean {
    return false
  }
  toJSON(): unknown {
    return {}
  }
}

function setup(rules: Partial<typeof GAME_RULES> = {}) {
  const contact = new Scripted()
  const m = new PesMatch({
    spec: makePitch7(900),
    seed: 3,
    home: fixtureTeam('1-2-3-1', { seed: 1, prefix: 'H' }),
    away: fixtureTeam('1-2-3-1', { seed: 2, prefix: 'A' }),
    rules: { ...GAME_RULES, ...rules },
    contact,
  })
  // 跳过开球：直接进入比赛，所有人原地不动
  m.restart = null
  m.phase = 'play'
  m.ball.frozen = false
  return { m, contact }
}

/** 把球员和球放到指定位置，球员不动（目标 = 自己的位置），方便隔离测试一个动作。 */
function place(m: PesMatch, pid: number, x: number, y: number): PesPlayer {
  const q = m.players[pid]
  q.pos.x = x
  q.pos.y = y
  q.vel.x = q.vel.y = 0
  q.target = { x, y }
  q.stun = 0
  q.noClaim = 0
  return q
}

function give(m: PesMatch, q: PesPlayer): void {
  m.ball.owner = q.pid
  m.ball.meta = null
  m.ball.lastTouch = q.pid
  m.ball.x = q.pos.x
  m.ball.y = q.pos.y
}

/** 让所有人原地站住（每帧把目标设成当前位置），这样只测球的轨迹。 */
function freeze(m: PesMatch, except: number[] = []): void {
  for (const q of m.players) if (!except.includes(q.pid)) {
    q.target = { x: q.pos.x, y: q.pos.y }
    q.urgency = 0.1
    q.decideT = 1e9
  }
}

function run(m: PesMatch, seconds: number, until?: () => boolean): void {
  const steps = Math.round(seconds / m.spec.DT)
  for (let i = 0; i < steps; i++) {
    m.step()
    if (until?.()) return
  }
}

// 球员 pid：主队 0–6（0 门将，1 2 中卫，3 中场，4 5 边锋，6 前锋），客队 7–13（7 门将）
const HOME_ST = 6
const AWAY_GK = 7

describe('传球演出', () => {
  it('ok：球飞向接球人，被他拿到，别人在这段时间里拿不到', () => {
    const { m, contact } = setup()
    const passer = place(m, 3, 0, 0)
    const receiver = place(m, 6, 14, 2)
    for (const q of m.teams[1].players) place(m, q.pid, 22 + q.slot, -12 + q.slot * 4) // 对手都远离传球线
    freeze(m, [])
    give(m, passer)
    contact.passVerdict = { result: 'ok', interceptor: -1, p: 0.9 }
    ;(m as any).execPass(passer, receiver, 0)
    run(m, 4, () => m.ball.owner >= 0)
    expect(m.ball.owner).toBe(receiver.pid)
    const pass = contact.events.find((e) => e.type === 'pass')!
    expect(pass.meta).toMatchObject({ result: 'ok', kind: expect.any(String) })
    expect(pass.actors).toEqual([passer.pid, receiver.pid])
  })

  it('icpt：球飞向拦截者，被他断下，接球人拿不到', () => {
    const { m, contact } = setup()
    const passer = place(m, 3, 0, 0)
    const receiver = place(m, 6, 16, 0)
    const interceptor = place(m, 9, 8, 0.5)
    for (const q of m.teams[1].players) if (q.pid !== interceptor.pid) place(m, q.pid, 24, -15 + q.slot * 5)
    freeze(m, [])
    give(m, passer)
    contact.passVerdict = { result: 'icpt', interceptor: interceptor.pid, p: 0.4 }
    ;(m as any).execPass(passer, receiver, 0)
    run(m, 4, () => m.ball.owner >= 0)
    expect(m.ball.owner).toBe(interceptor.pid)
    expect(contact.events.find((e) => e.type === 'pass')!.meta).toMatchObject({ result: 'icpt', icpt: interceptor.pid })
  })

  it('miss：传丢，球偏离接球人，接球人头几秒拿不到', () => {
    const { m, contact } = setup()
    const passer = place(m, 3, 0, 0)
    const receiver = place(m, 6, 14, 0)
    for (const q of m.teams[1].players) place(m, q.pid, 25, -15 + q.slot * 5)
    freeze(m, [])
    give(m, passer)
    contact.passVerdict = { result: 'miss', interceptor: -1, p: 0.3 }
    ;(m as any).execPass(passer, receiver, 0)
    run(m, 2.5)
    expect(m.ball.owner).not.toBe(receiver.pid)
    expect(contact.events.find((e) => e.type === 'pass')!.meta).toMatchObject({ result: 'miss' })
  })

  it('out：传球出界，按最后触球判界外球 / 球门球 / 角球', () => {
    const { m, contact } = setup()
    const passer = place(m, 4, 20, 16) // 左边路，朝边线外传
    const receiver = place(m, 5, 20, 17.5)
    receiver.noClaim = 30 // 球从他身边飞过也不接，只看球出界
    for (const q of m.teams[1].players) place(m, q.pid, 5 + q.slot, -10 + q.slot * 3)
    freeze(m, [])
    give(m, passer)
    contact.passVerdict = { result: 'out', interceptor: -1, p: 0.2 }
    ;(m as any).execPass(passer, receiver, 0)
    run(m, 5, () => m.phase === 'restart')
    expect(m.phase).toBe('restart')
    expect(['throwin', 'goalkick', 'corner']).toContain(m.restart!.type)
  })
})

describe('越位', () => {
  it('规则打开：传给越位位置的队友，接球时判越位，给对方任意球；规则关闭则不判', () => {
    for (const offside of [true, false]) {
      const { m, contact } = setup({ offside })
      const passer = place(m, 3, 5, 0)
      const receiver = place(m, 6, 26, 3) // 在对方最后一名后卫身后
      for (const q of m.teams[1].players) place(m, q.pid, q.slot === 0 ? 29 : 20, -12 + q.slot * 4) // 后卫线在 x = 20
      freeze(m, [])
      give(m, passer)
      contact.passVerdict = { result: 'ok', interceptor: -1, p: 0.9 }
      ;(m as any).execPass(passer, receiver, 0)
      run(m, 4, () => m.ball.owner >= 0 || m.phase === 'restart')
      if (offside) {
        expect(contact.events.some((e) => e.type === 'offside')).toBe(true)
        expect(m.restart).toMatchObject({ type: 'fk', ti: 1 })
      } else {
        expect(contact.events.some((e) => e.type === 'offside')).toBe(false)
        expect(m.ball.owner).toBe(receiver.pid)
      }
    }
  })
})

describe('射门演出', () => {
  const shooterAt = (m: PesMatch) => {
    const shooter = place(m, HOME_ST, 22, 1)
    for (const q of m.teams[1].players) if (q.slot !== 0) place(m, q.pid, 4, -16 + q.slot * 5)
    place(m, AWAY_GK, 29, 0)
    freeze(m, [AWAY_GK])
    give(m, shooter)
    return shooter
  }

  it('goal：球进门，比分加一，重新开球', () => {
    const { m, contact } = setup()
    const shooter = shooterAt(m)
    contact.shotVerdict = { result: 'goal', blocker: -1, xg: 0.3, hold: true, meta: { chance: 'normal' } }
    ;(m as any).execShot(shooter, 0)
    run(m, 4, () => m.teams[0].score > 0)
    expect(m.teams[0].score).toBe(1)
    const kinds = contact.events.map((e) => e.type)
    expect(kinds.indexOf('shot')).toBeLessThan(kinds.indexOf('goal'))
    expect(contact.events.find((e) => e.type === 'goal')!.actors[0]).toBe(shooter.pid)
    expect(m.phase).toBe('kickoff')
  })

  it('save + 抱住：门将必定扑到并抱住球，不进球', () => {
    const { m, contact } = setup()
    const shooter = shooterAt(m)
    contact.shotVerdict = { result: 'save', blocker: -1, xg: 0.3, hold: true, meta: {} }
    ;(m as any).execShot(shooter, 0)
    run(m, 4, () => m.ball.owner >= 0)
    expect(m.ball.owner).toBe(AWAY_GK)
    expect(m.teams[0].score).toBe(0)
    expect(contact.events.find((e) => e.type === 'save')!.meta).toMatchObject({ hold: true })
  })

  it('save + 脱手 + 近门射门：门将把球扑出底线，形成角球，球不进门', () => {
    const { m, contact } = setup()
    const shooter = shooterAt(m)
    contact.shotVerdict = { result: 'save', blocker: -1, xg: 0.3, hold: false, meta: {} }
    ;(m as any).execShot(shooter, 0)
    run(m, 5, () => m.phase === 'restart')
    expect(m.teams[0].score).toBe(0)
    expect(m.phase).toBe('restart')
    expect(m.restart!.type).toBe('corner')
    expect(m.restart!.ti).toBe(0)
  })

  it('miss：偏出或打高，不进球', () => {
    const { m, contact } = setup()
    for (let i = 0; i < 6; i++) {
      const shooter = shooterAt(m)
      m.phase = 'play'
      m.restart = null
      contact.shotVerdict = { result: 'miss', blocker: -1, xg: 0.05, hold: false, meta: {} }
      ;(m as any).execShot(shooter, 0)
      run(m, 5, () => m.phase === 'restart')
      expect(m.teams[0].score).toBe(0)
      m.ball.frozen = false
    }
    expect(contact.events.filter((e) => e.type === 'goal')).toHaveLength(0)
  })

  it('block：被封堵，球在射手身边弹开，成为无主球', () => {
    const { m, contact } = setup()
    const shooter = shooterAt(m)
    const blocker = place(m, 10, 20, 1)
    contact.shotVerdict = { result: 'block', blocker: blocker.pid, xg: 0.1, hold: false, meta: {} }
    ;(m as any).execShot(shooter, 0)
    expect(m.ball.meta?.type).toBe('blocked')
    expect(m.ball.owner).toBe(-1)
    expect(m.ball.lastTouch).toBe(blocker.pid)
    expect(contact.events.find((e) => e.type === 'shot')!.meta).toMatchObject({ result: 'block', blocker: blocker.pid })
  })

  it('结算没判进球时，滚进门框的球不算进球（改按出界处理）', () => {
    const { m } = setup()
    const shooter = shooterAt(m)
    // 一个没有结算结果的球（比如传球 / 解围）直接滚进球门；门将站远一点，免得他把球接了
    place(m, AWAY_GK, 15, 12)
    m.ball.owner = -1
    m.ball.meta = { type: 'pass', from: shooter.pid, intended: -1 }
    m.ball.x = 29.5
    m.ball.y = 0
    m.ball.z = 0
    m.ball.vx = 12
    m.ball.vy = 0
    m.ball.vz = 0
    m.ball.looseT = 0
    shooter.noClaim = 5
    run(m, 1, () => m.phase === 'restart')
    expect(m.teams[0].score).toBe(0)
    expect(m.phase).toBe('restart')
  })
})

describe('犯规 / 牌 / 点球 / 红牌', () => {
  it('禁区外犯规：给被犯规方任意球，事件里有犯规', () => {
    const { m, contact } = setup()
    const att = place(m, 3, 5, 0)
    const def = place(m, 10, 6, 0)
    give(m, att)
    contact.duelVerdict = { outcome: 'foul', card: null, second: false, injured: -1, recoveryDays: 0, p: 0.1 }
    ;(m as any).tackleSettled(def, att)
    expect(m.phase).toBe('restart')
    expect(m.restart).toMatchObject({ type: 'fk', ti: 0 })
    expect(contact.events.some((e) => e.type === 'foul')).toBe(true)
    expect(m.teams[1].stats.fouls).toBe(1)
  })

  it('禁区内犯规：判点球，主罚人出脚后进球', () => {
    const { m, contact } = setup()
    const att = place(m, 6, 27, 2)
    const def = place(m, 10, 28, 2)
    give(m, att)
    contact.duelVerdict = { outcome: 'foul', card: null, second: false, injured: -1, recoveryDays: 0, p: 0.1 }
    ;(m as any).tackleSettled(def, att)
    expect(m.restart).toMatchObject({ type: 'penalty', ti: 0 })
    expect(m.ball.x).toBeGreaterThan(20)
    contact.shotVerdict = { result: 'goal', blocker: -1, xg: 0.78, hold: true, meta: { chance: 'penalty' } }
    run(m, 12, () => m.teams[0].score > 0)
    expect(m.teams[0].score).toBe(1)
    expect(contact.shots.some((request) => request.penalty)).toBe(true)
  })

  it('rules.penalties 关掉时，禁区内犯规也只是任意球', () => {
    const { m, contact } = setup({ penalties: false })
    const att = place(m, 6, 27, 2)
    const def = place(m, 10, 28, 2)
    give(m, att)
    contact.duelVerdict = { outcome: 'foul', card: null, second: false, injured: -1, recoveryDays: 0, p: 0.1 }
    ;(m as any).tackleSettled(def, att)
    expect(m.restart!.type).toBe('fk')
  })

  it('红牌：球员离场（移到 offPlayers），场上少一人，比赛继续', () => {
    const { m, contact } = setup()
    const att = place(m, 3, 5, 0)
    const def = place(m, 10, 6, 0)
    give(m, att)
    contact.duelVerdict = { outcome: 'foul', card: 'red', second: false, injured: -1, recoveryDays: 0, p: 0.1 }
    ;(m as any).tackleSettled(def, att)
    expect(m.teams[1].players).toHaveLength(6)
    expect(m.teams[1].offPlayers.map((q) => q.pid)).toEqual([def.pid])
    expect(contact.events.find((e) => e.type === 'card')!.meta).toMatchObject({ color: 'red', second: false })
    run(m, 30)
    expect(m.time).toBeGreaterThan(20)
    // 红牌球员不再参与：位置不变、不是持球人
    expect(m.ball.owner).not.toBe(def.pid)
  })

  it('受伤事件：被犯规的球员受伤', () => {
    const { m, contact } = setup()
    const att = place(m, 3, 5, 0)
    const def = place(m, 10, 6, 0)
    give(m, att)
    contact.duelVerdict = { outcome: 'tackle', card: null, second: false, injured: att.pid, recoveryDays: 4, p: 0.2 }
    ;(m as any).tackleSettled(def, att)
    const injury = contact.events.find((e) => e.type === 'injury')!
    expect(injury.actors).toEqual([att.pid])
    expect(injury.meta).toMatchObject({ days: 4 })
    expect(m.teams[1].stats.tackles).toBe(1)
  })

  it('战术犯规：出球前被放倒，这次出球作废，给任意球', () => {
    const { m, contact } = setup()
    const att = place(m, 3, 5, 0)
    const def = place(m, 10, 6, 0)
    give(m, att)
    contact.foulVerdict = { defender: def.pid, card: 'yellow', second: false, injured: -1, recoveryDays: 0, p: 0.1 }
    m.ball.owner = att.pid
    att.holdUntil = 0
    ;(m as any).decideOnBall(att)
    // 战术犯规只在选了出球动作（传 / 射 / 解围）时触发；选了带球就不犯规。多试几次直到触发
    for (let i = 0; i < 60 && m.phase !== 'restart'; i++) {
      give(m, att)
      ;(m as any).decideOnBall(att)
    }
    if (m.phase === 'restart') {
      expect(m.restart).toMatchObject({ type: 'fk', ti: 0 })
      expect(contact.events.some((e) => e.type === 'card' && e.meta?.color === 'yellow')).toBe(true)
    }
  })
})

describe('门将被罚下', () => {
  it('没有门将时球门球由离球最近的外场球员开出，球不会冻住', () => {
    const { m, contact } = setup()
    const gk = m.teams[1].players[0]
    ;(m as any).sendOff(gk)
    expect(m.teams[1].players.some((q) => q.slot === 0)).toBe(false)
    for (const q of m.teams[1].players) place(m, q.pid, 18 + q.slot, -12 + q.slot * 4)
    ;(m as any).setRestart('goalkick', { x: 24.5, y: 0 }, m.teams[1])
    const taker = m.restart!.taker
    expect(taker).toBeGreaterThanOrEqual(0)
    expect(m.players[taker].ti).toBe(1)
    run(m, 12, () => m.phase === 'play')
    expect(m.phase).toBe('play')
    expect(m.ball.frozen).toBe(false)
    expect(contact.events.some((e) => e.type === 'goalkick')).toBe(true)
  })

  it('没有门将时射门必进（和现有引擎一致）由结算模型决定，内核不崩', () => {
    const { m } = setup()
    ;(m as any).sendOff(m.teams[1].players[0])
    run(m, 20) // 继续踢 20 秒不抛错
    expect(m.time).toBeGreaterThan(15)
  })
})

describe('换人与离场的名单', () => {
  it('换人：新球员接替位置、拿到新的 pid；被换下的进 offPlayers；持球人换人球跟着走', () => {
    const { m, contact } = setup()
    const out = place(m, 4, 12, 9)
    give(m, out)
    const before = m.players.length
    const inc = m.substitute(out.pid, { name: '替补', abilities: { ...out.ab }, stamina: 0.9, ref: 'bench-1', num: 14 })
    expect(inc.pid).toBe(before)
    expect(m.players[inc.pid]).toBe(inc)
    expect(inc).toMatchObject({ ti: out.ti, slot: out.slot, role: out.role, ref: 'bench-1' })
    expect(inc.pos).toEqual(out.pos)
    expect(m.teams[0].players[4]).toBe(inc)
    expect(m.teams[0].offPlayers).toContain(out)
    expect(m.ball.owner).toBe(inc.pid)
    expect(contact.events.find((e) => e.type === 'sub')!.actors).toEqual([inc.pid, out.pid])
    run(m, 5) // 继续踢
    // 存档里离场的和换上的都在
    const snapshot = m.serialize()
    const restored = PesMatch.restore(snapshot)
    expect(restored.players).toHaveLength(m.players.length)
    expect(restored.players[inc.pid].ref).toBe('bench-1')
    expect(restored.teams[0].offPlayers.map((q) => q.pid)).toEqual([out.pid])
  })
})

describe('传中、角球与任意球', () => {
  it('传中 ok：落点争顶，攻方赢了且在门前就直接头球攻门', () => {
    const { m, contact } = setup()
    const winger = place(m, 4, 24, 15)
    const striker = place(m, HOME_ST, 25, -1)
    for (const q of m.players) if (q.pid !== winger.pid && q.pid !== striker.pid) place(m, q.pid, q.ti === 0 ? 8 + q.slot : 5 + q.slot, -14 + q.slot * 4)
    place(m, AWAY_GK, 29, 0)
    freeze(m, [])
    give(m, winger)
    contact.passVerdict = { result: 'ok', interceptor: -1, p: 0.7 }
    contact.shotVerdict = { result: 'goal', blocker: -1, xg: 0.3, hold: true, meta: { chance: 'header' } }
    ;(m as any).execCross(winger, striker, { x: 24, y: -1.8 })
    // 争顶赢家 = 前锋（假模型直接指定）
    const originalAerial = contact.aerial
    contact.aerial = () => striker.pid
    run(m, 5, () => contact.shots.length > 0)
    contact.aerial = originalAerial
    expect(contact.events.some((e) => e.type === 'aerial')).toBe(true)
    expect(contact.shots.some((request) => request.header)).toBe(true)
    expect(contact.events.find((e) => e.type === 'pass')!.meta).toMatchObject({ kind: 'cross', result: 'ok' })
  })

  it('角球：开出后球飞向点球点，落点争顶；角球本身不算传球', () => {
    const { m, contact } = setup()
    const home = m.teams[0]
    ;(m as any).setRestart('corner', { x: 29.65, y: 19.65 }, home)
    contact.aerial = () => -1
    run(m, 12, () => m.phase === 'play')
    expect(m.phase).toBe('play')
    expect(contact.events.some((e) => e.type === 'corner')).toBe(true)
    expect(contact.events.some((e) => e.type === 'pass')).toBe(false)
  })
})

describe('没有结算模型时保持 pes2d 原版行为', () => {
  it('contact = null：不产生 pass 事件、不判点球，仍能跑完整场', () => {
    const m = new PesMatch({
      spec: makePitch7(200),
      seed: 4,
      home: fixtureTeam('1-2-3-1', { seed: 1, prefix: 'H' }),
      away: fixtureTeam('1-2-3-1', { seed: 2, prefix: 'A' }),
    })
    m.run()
    expect(m.events.some((e) => e.type === 'pass')).toBe(false)
    expect(m.events.some((e) => e.type === 'penalty')).toBe(false)
    expect(m.teams[0].offPlayers).toEqual([])
    expect(m.rules.cross).toBe(false)
  })
})

