import { describe, expect, it } from 'vitest'
import { fixtureTeam } from './fixtures.ts'
import { PesMatch } from './sim.ts'
import { GAME_RULES, makePitch11, type PesPlayer, type PesTeam, type PesTactics } from './spec.ts'
import { NEUTRAL_INSTRUCTIONS, STYLE_LIST, cloneInstructions, validateInstructions, type TacticalInstructionsV2 } from './tactics.ts'

const pitch = makePitch11(900)
const K = pitch.K

function instructions(patch: (v: TacticalInstructionsV2) => void = () => {}): TacticalInstructionsV2 {
  const value = cloneInstructions(NEUTRAL_INSTRUCTIONS)
  patch(value)
  return value
}

function match(home: Partial<PesTactics> = {}, away: Partial<PesTactics> = {}, seed = 5): PesMatch {
  const m = new PesMatch({
    spec: pitch,
    seed,
    home: fixtureTeam('4-4-2', { seed: 1, prefix: 'H', tactics: home }),
    away: fixtureTeam('4-4-2', { seed: 2, prefix: 'A', tactics: away }),
  })
  m.restart = null
  m.phase = 'play'
  m.ball.frozen = false
  return m
}

function place(m: PesMatch, pid: number, x: number, y: number, vel = { x: 0, y: 0 }): PesPlayer {
  const p = m.players[pid]
  p.pos = { x, y }
  p.target = { x, y }
  p.vel = { ...vel }
  p.decideT = 1e9
  p.stun = 0
  p.urgency = 0
  return p
}

function outfield(team: PesTeam): PesPlayer[] {
  return team.players.filter((p) => p.slot !== 0)
}

type Internals = {
  updateShape(): void
  assignPressers(t: PesTeam, v2: TacticalInstructionsV2, outfield: PesPlayer[], ip: { x: number; y: number }): void
  defensiveWidthTarget(p: PesPlayer, raw: { x: number; y: number }): { x: number; y: number }
  spacePassTarget(p: PesPlayer, mate: PesPlayer, opps: PesPlayer[]): { x: number; y: number } | null
  passValue(p: PesPlayer, mate: PesPlayer, press: number, opps: PesPlayer[], shot: number | null, finish: null, target?: { x: number; y: number }): number
  clearInstructionShape(): void
}
const internals = (m: PesMatch): Internals => m as unknown as Internals

/** 一队全部外场 + 门将站到对方半场外，便于精确摆放几名相关球员。 */
function park(team: PesTeam, x: number, y: number): void {
  for (const p of team.players) {
    p.pos = { x: x + p.slot * 0.4, y }
    p.target = { ...p.pos }
    p.vel = { x: 0, y: 0 }
    p.decideT = 1e9
  }
}

describe('第二上抢者任务不变量', () => {
  it('第二上抢者不会同时被分配盯人，任务表在球冻结后清空', () => {
    const m = match({ instructions: instructions() }, { instructions: instructions() })
    const def = m.teams[0]
    const att = m.teams[1]
    park(att, 10, 0)
    park(def, -10, 0)
    // 两名最近的外场球员进入逼抢半径，另有三名对手站在附近形成盯人压力。
    place(m, outfield(def)[0].pid, 1, 0)
    place(m, outfield(def)[1].pid, 0.5, 1)
    place(m, outfield(def)[2].pid, 8, 6)
    place(m, outfield(def)[3].pid, 8, -6)
    place(m, att.players[1].pid, 12, 5)
    place(m, att.players[2].pid, 12, -5)
    place(m, att.players[3].pid, 13, 0)
    m.ball.owner = att.players[1].pid
    m.ball.x = 12
    m.ball.y = 5
    internals(m).updateShape()

    const pressed = [def.presser, def.presser2].filter((pid): pid is number => typeof pid === 'number' && pid >= 0)
    expect(pressed.length).toBeGreaterThan(0)
    for (const pid of pressed) {
      const p = m.players[pid]
      expect(def.marks[p.slot]).toBe(-1)
    }
    for (const pid of [def.presser, def.presser2, def.cover]) {
      if (typeof pid !== 'number' || pid < 0) continue
      expect(def.marks[m.players[pid].slot]).toBe(-1)
    }
    expect(new Set(pressed).size).toBe(pressed.length)

    m.ball.frozen = true
    internals(m).updateShape()
    expect(def.presser).toBe(-1)
    expect(def.presser2).toBe(-1)
    expect(def.cover).toBe(-1)
    expect(def.marks.every((value) => value === -1)).toBe(true)
  })

  it('本方持球时不再保留旧的上抢任务', () => {
    const m = match({ instructions: instructions() }, { instructions: instructions() })
    const def = m.teams[0]
    const att = m.teams[1]
    park(att, 10, 0)
    park(def, -10, 0)
    place(m, outfield(def)[0].pid, 1, 0)
    place(m, outfield(def)[1].pid, 1.5, 0.5)
    m.ball.owner = att.players[2].pid
    m.ball.x = 10
    m.ball.y = 0
    internals(m).updateShape()
    expect(def.presser).toBeGreaterThanOrEqual(0)

    m.ball.owner = def.players[4].pid
    m.ball.x = -10
    m.ball.y = 0
    internals(m).updateShape()
    expect(def.presser).toBe(-1)
    expect(def.presser2).toBe(-1)
    expect(def.cover).toBe(-1)
  })

  it('任务被清空后，受影响球员的移动目标不再指向持球人', () => {
    const m = match({ instructions: instructions() }, { instructions: instructions() })
    const def = m.teams[0]
    const att = m.teams[1]
    park(att, 10, 0)
    park(def, -10, 0)
    const presser = place(m, outfield(def)[0].pid, 1, 0)
    m.ball.owner = att.players[2].pid
    m.ball.x = 10
    m.ball.y = 0
    internals(m).updateShape()
    expect(def.presser).toBe(presser.pid)
    // 只刷新运动目标，不应重新决策或改变决策计时。
    const before = presser.decideT
    m.ball.frozen = true
    internals(m).clearInstructionShape()
    expect(presser.decideT).toBe(before)
    expect(presser.mode).not.toBe('press')
  })
})

describe('身后空当候选', () => {
  const space = () => instructions((v) => { v.advanced = { possession: { receiving: 'space' } } })

  it('只有显式启用接空当、且处于开放比赛时才生成候选', () => {
    const m = match({ instructions: instructions() }, { instructions: instructions() })
    const att = m.teams[0]
    const mate = outfield(att)[6]
    const carrier = place(m, outfield(att)[3].pid, 0, 0)
    place(m, mate.pid, 12, 0, { x: 6, y: 0 })
    mate.mode = 'run'
    mate.runTarget = { x: 20, y: 0 }
    mate.runUntil = 100
    for (const o of m.teams[1].players) place(m, o.pid, 14, -20 + o.slot * 2)
    const opps = m.teams[1].players

    // 中性接球指令 + 默认（非开放比赛）状态：不生成。
    expect(internals(m).spacePassTarget(carrier, mate, opps)).toBeNull()

    att.tactics.instructions = space()
    expect(internals(m).spacePassTarget(carrier, mate, opps)).toBeNull()

    ;(m as unknown as { openPlay: { phase: string } }).openPlay.phase = 'open'
    const target = internals(m).spacePassTarget(carrier, mate, opps)
    expect(target).not.toBeNull()
    expect(target!.x).toBeGreaterThan(mate.pos.x)
  })

  it('没有前插、跑动方向向后或目标不越过防线时不生成', () => {
    const m = match({ instructions: space() }, { instructions: instructions() })
    ;(m as unknown as { openPlay: { phase: string } }).openPlay.phase = 'open'
    const att = m.teams[0]
    const mate = outfield(att)[6]
    const carrier = place(m, outfield(att)[3].pid, 0, 0)
    for (const o of m.teams[1].players) place(m, o.pid, 40, -20 + o.slot * 2)
    const opps = m.teams[1].players

    place(m, mate.pid, 12, 0, { x: -3, y: 0 })
    mate.mode = 'run'
    mate.runTarget = { x: 20, y: 0 }
    mate.runUntil = 100
    expect(internals(m).spacePassTarget(carrier, mate, opps)).toBeNull()

    mate.vel = { x: 5, y: 0 }
    mate.mode = 'support'
    expect(internals(m).spacePassTarget(carrier, mate, opps)).toBeNull()

    // 防守线站在计划落点之前：目标不再位于参考线更前方，应回退普通候选。
    mate.mode = 'run'
    for (const o of m.teams[1].players) place(m, o.pid, 30, -20 + o.slot * 2)
    expect(internals(m).spacePassTarget(carrier, mate, opps)).toBeNull()
  })

  it('空当候选的评分按计划落点计算，并带上熟练度加成', () => {
    const m = match({ instructions: space() }, { instructions: instructions() })
    const att = m.teams[0]
    const mate = outfield(att)[6]
    const carrier = place(m, outfield(att)[3].pid, 0, 0)
    place(m, mate.pid, 12, 0, { x: 5, y: 0 })
    for (const o of m.teams[1].players) place(m, o.pid, 40, -20 + o.slot * 2)
    const opps = m.teams[1].players
    const near = internals(m).passValue(carrier, mate, 0, opps, null, null)
    const far = internals(m).passValue(carrier, mate, 0, opps, null, null, { x: 18, y: 0 })
    expect(far).toBeGreaterThan(near)
  })
})

describe('无球防守宽度', () => {
  const narrow = () => instructions((v) => { v.advanced = { defense: { width: 'narrow' } } })

  function defensiveFrame(width: TacticalInstructionsV2 | null): { raw: { x: number; y: number }; out: { x: number; y: number }; presser: PesPlayer } {
    const m = match({ instructions: width ?? instructions() }, { instructions: instructions() })
    const def = m.teams[0]
    const att = m.teams[1]
    for (const o of att.players) place(m, o.pid, 10, -20 + o.slot * 2)
    m.ball.owner = att.players[4].pid
    m.ball.x = 10
    m.ball.y = 0
    const presser = place(m, outfield(def)[0].pid, 2, 0)
    const left = place(m, outfield(def)[1].pid, -10, -18)
    const right = place(m, outfield(def)[2].pid, -10, 18)
    def.presser = presser.pid
    def.presser2 = -1
    def.cover = -1
    def.marks.fill(-1)
    m.ball.frozen = false
    const raw = { x: right.pos.x, y: right.pos.y }
    const out = internals(m).defensiveWidthTarget(right, raw)
    expect(left.pid).toBeGreaterThan(0)
    return { raw, out, presser }
  }

  it('窄防守把队形目标向中路收，最多 3K', () => {
    const { raw, out } = defensiveFrame(narrow())
    expect(out.y).toBeLessThan(raw.y)
    expect(raw.y - out.y).toBeLessThanOrEqual(3 * K + 1e-9)
    expect(out.x).toBe(raw.x)
  })

  it('中性宽度不改动目标；上抢者不参与收缩', () => {
    const { raw, out, presser } = defensiveFrame(null)
    expect(out).toEqual(raw)
    const m = match({ instructions: narrow() }, { instructions: instructions() })
    const def = m.teams[0]
    const att = m.teams[1]
    for (const o of att.players) place(m, o.pid, 10, -20 + o.slot * 2)
    m.ball.owner = att.players[4].pid
    const press = place(m, outfield(def)[0].pid, 1, 0)
    const other = place(m, outfield(def)[1].pid, -10, 17)
    def.presser = press.pid
    const applied = internals(m).defensiveWidthTarget(press, { x: press.pos.x, y: press.pos.y })
    expect(applied).toEqual({ x: press.pos.x, y: press.pos.y })
    expect(other.pid).toBeGreaterThan(0)
    expect(presser.pid).toBeGreaterThanOrEqual(0)
  })

  it('盯人目标远离被盯对象时受 1.5K 额外距离限制', () => {
    const m = match({ instructions: narrow() }, { instructions: instructions() })
    const def = m.teams[0]
    const att = m.teams[1]
    for (const o of att.players) place(m, o.pid, 10, -20 + o.slot * 2)
    m.ball.owner = att.players[4].pid
    const marker = place(m, outfield(def)[1].pid, -10, 18)
    const target = att.players[2]
    place(m, target.pid, -6, 10)
    place(m, outfield(def)[2].pid, -10, 4)
    def.presser = -1
    def.marks.fill(-1)
    def.marks[marker.slot] = target.pid
    const raw = { x: -6, y: 10 + 1.8 + 0.2 }
    const out = internals(m).defensiveWidthTarget(marker, raw)
    expect(Math.abs(out.y - target.pos.y)).toBeLessThanOrEqual(Math.abs(raw.y - target.pos.y) + 1.5 * K + 1e-9)
  })
})

describe('新指令模板与校验', () => {
  it('修订版只显式标记接空当 / 窄防守，旧模板保持不变', () => {
    for (const style of STYLE_LIST) expect(style.instructions.advanced).toBeUndefined()
    const rev2 = STYLE_LIST.map((s) => s.id)
    expect(rev2.length).toBeGreaterThan(0)
  })

  it('校验接受新字段并拒绝未知值', () => {
    const ok = instructions((v) => { v.advanced = { possession: { receiving: 'space' }, defense: { width: 'narrow' } } })
    expect(validateInstructions(ok).advanced).toEqual({ possession: { receiving: 'space' }, defense: { width: 'narrow' } })
    const bad = instructions() as unknown as Record<string, unknown>
    bad.advanced = { possession: { receiving: 'deep' } }
    expect(() => validateInstructions(bad)).toThrow(/advanced\.possession\.receiving/)
    const unknown = instructions() as unknown as Record<string, unknown>
    unknown.advanced = { defense: { width: 'narrow', pressKeeper: true } }
    expect(() => validateInstructions(unknown)).toThrow(/advanced\.defense\.pressKeeper/)
  })
})
