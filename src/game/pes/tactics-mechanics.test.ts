import { describe, expect, it, vi } from 'vitest'
import { fixtureTeam } from './fixtures.ts'
import { PesMatch } from './sim.ts'
import { GAME_RULES, makePitch11, type PesPlayer, type PesTeam, type PesTactics } from './spec.ts'
import { DEFAULT_PARAMS, NEUTRAL_INSTRUCTIONS, STYLE_LIST, STYLE_LIST_REV2, cloneInstructions, validateInstructions, type TacticalInstructionsV2 } from './tactics.ts'
import { MatchMetrics } from './metrics.ts'
import { baselineTeams } from './baseline.ts'
import { PesGame } from './game.ts'

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
  execPass(p: PesPlayer, mate: PesPlayer, press: number, target?: { x: number; y: number }): void
  crossOption(p: PesPlayer, press: number): { score: number; mate: PesPlayer; spot: { x: number; y: number } } | null
  launchCross(p: PesPlayer, target: { x: number; y: number }, intended: number, result: 'ok' | 'icpt' | 'miss' | 'out', setResult: boolean): void
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
    const m = match({ instructions: instructions((v) => { v.defense.intensity = 'high' }) }, { instructions: instructions() })
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
    expect(pressed.length).toBe(2)
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

describe('战术埋点只读且口径正确', () => {
  it('实际接球、边路与前插漏斗使用各自正确的分子分母', () => {
    const m = match({ instructions: instructions() }, { instructions: instructions() })
    const observer = new MatchMetrics(m)
    const p = outfield(m.teams[0])[0]
    place(m, p.pid, 0, 0)
    observer.receive(m, p)
    place(m, p.pid, 0, 20)
    observer.receive(m, p)
    place(m, p.pid, 25, 20)
    observer.receive(m, p)
    observer.crossDecision(0, false, false)
    observer.crossDecision(0, true, true, -0.1)
    observer.crossCanceled(0, 'foul')
    observer.cross(0, true)
    observer.runner(0, 'activeRun')
    observer.runner(0, 'rollMiss')
    observer.runner(0, 'started')
    expect(observer.teams[0]).toMatchObject({ receptions: 3, wideReceptions: 2, wideFinalThirdReceptions: 1,
      crossDecisions: 2, crossCandidates: 1, crossPreferred: 1, crossMargins: [-0.1], crossCanceledFoul: 1, crosses: 1, crossSettledOk: 1,
      runnerDecisions: 3, runnerBlocked: { activeRun: 1 }, runnerTrials: 2, runnerStarted: 1 })
  })

  it('失败传中即使 cross=false 也不伪记为普通接球，且埋点不改比赛快照', () => {
    const opts = { instructions: instructions() }
    const observed = match(opts, opts)
    const plain = match(opts, opts)
    observed.metrics = new MatchMetrics(observed)
    const p = observed.teams[0].players[1]
    const q = plain.teams[0].players[1]
    internals(observed).launchCross(p, { x: 15, y: 0 }, observed.teams[0].players[2].pid, 'miss', true)
    internals(plain).launchCross(q, { x: 15, y: 0 }, plain.teams[0].players[2].pid, 'miss', true)
    expect(observed.ball.meta?.cross).toBe(false)
    expect(observed.metrics.isCross(observed.ball.meta!)).toBe(true)
    expect(observed.serialize()).toEqual(plain.serialize())
  })

  it('盯人槽存储对手 pid 时，冲突按本方上抢球员的 slot 判断', () => {
    const m = match({ instructions: instructions() }, { instructions: instructions() })
    const team = m.teams[0]
    const presser = outfield(team)[0]
    const observer = new MatchMetrics(m)
    team.presser = presser.pid
    team.presser2 = -1
    team.cover = -1
    team.marks.fill(-1)
    observer.tasks(0, team)
    team.marks[presser.slot] = m.teams[1].players[2].pid
    observer.tasks(0, team)
    expect(observer.teams[0].taskFrames).toBe(2)
    expect(observer.teams[0].taskConflictFrames).toBe(1)
  })

  it('同种子开关埋点不改变物理比赛快照、事件和 RNG', () => {
    const { home, away } = baselineTeams(1)
    home.instructions = cloneInstructions(STYLE_LIST_REV2.find((s) => s.id === 'directCounter')!.instructions)
    away.instructions = cloneInstructions(STYLE_LIST_REV2.find((s) => s.id === 'highPress')!.instructions)
    const opts = { seed: 42, home, away, durationSeconds: 60, offside: true, noInjuries: true, now: 0,
      tacticsParams: { spaceLeadScale: 1.5, defenseCompactness: 0.25, defenseMarkBuffer: 3 } }
    const observed = new PesGame({ ...structuredClone(opts), metrics: true })
    const plain = new PesGame({ ...structuredClone(opts), metrics: false })
    observed.run()
    plain.run()
    expect(observed.match.serialize()).toEqual(plain.match.serialize())
  }, 30_000)

  it('恢复含实验参数的比赛后，球路 / 战术状态与连续运行一致', () => {
    const { home, away } = baselineTeams(1)
    home.instructions = cloneInstructions(STYLE_LIST_REV2.find((s) => s.id === 'directCounter')!.instructions)
    away.instructions = cloneInstructions(STYLE_LIST_REV2.find((s) => s.id === 'catenaccio')!.instructions)
    const game = new PesGame({ seed: 43, home, away, durationSeconds: 60, offside: true, noInjuries: true, now: 0,
      tacticsParams: { spaceLeadScale: 1.5, defenseCompactness: 0.25, defenseMarkBuffer: 3 } })
    game.advance(20)
    const resumed = PesGame.restore(JSON.parse(JSON.stringify(game.serialize())))
    game.run()
    resumed.run()
    expect(resumed.match.serialize()).toEqual(game.match.serialize())
  }, 30_000)
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
    const { spaceLeadScale: _scale, ...historical } = m.tacticsParams
    m.tacticsParams = historical
    expect(internals(m).spacePassTarget(carrier, mate, opps)).toEqual(target)
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

  it('提高已有前插的提前量可产生可达身后目标，但倒跑仍不合格', () => {
    const m = match({ instructions: space() }, { instructions: instructions() })
    ;(m as unknown as { openPlay: { phase: string } }).openPlay.phase = 'open'
    const carrier = place(m, outfield(m.teams[0])[3].pid, 0, 0)
    const mate = place(m, outfield(m.teams[0])[6].pid, 17, 0, { x: 2.5, y: 0 })
    mate.mode = 'run'
    mate.runTarget = { x: 25, y: 0 }
    mate.runUntil = 100
    for (const o of m.teams[1].players) place(m, o.pid, 20, 8 + o.slot * 2)
    place(m, m.teams[1].players[0].pid, 40, -15)
    m.ball.x = 0
    m.tacticsParams = { ...DEFAULT_PARAMS, spaceLeadScale: 1 }
    expect(internals(m).spacePassTarget(carrier, mate, m.teams[1].players)).toBeNull()
    m.tacticsParams = { ...DEFAULT_PARAMS, spaceLeadScale: 1.5 }
    const target = internals(m).spacePassTarget(carrier, mate, m.teams[1].players)
    expect(target?.x).toBeGreaterThan(20.5)
    mate.vel.x = -1
    expect(internals(m).spacePassTarget(carrier, mate, m.teams[1].players)).toBeNull()
  })

  it.each([1, -1] as const)('出脚时传球目标、接触裁决和越位依据分离（方向 %i）', (dir) => {
    const { home, away } = baselineTeams(1)
    home.instructions = space()
    const game = new PesGame({ seed: 12, home, away, durationSeconds: 60, offside: true, noInjuries: true, now: 0 })
    const m = game.match
    m.teams[0].dir = dir
    m.teams[1].dir = dir === 1 ? -1 : 1
    m.phase = 'play'
    m.ball.frozen = false
    const carrier = place(m, outfield(m.teams[0])[3].pid, 0, 0)
    const mate = place(m, outfield(m.teams[0])[6].pid, 18 * dir, 0)
    for (const o of m.teams[1].players) place(m, o.pid, 20 * dir, -20 + o.slot * 2)
    place(m, m.teams[1].players[0].pid, 40 * dir, -15)
    m.ball.owner = carrier.pid
    m.ball.x = 0
    const target = { x: 24 * dir, y: 0 }
    const pass = vi.spyOn(game.settlement, 'pass').mockReturnValue({ result: 'ok', interceptor: -1, p: 0.5 })
    vi.spyOn(game.settlement, 'beatsOffside').mockReturnValue(false)
    internals(m).execPass(carrier, mate, 0, target)
    expect(pass).toHaveBeenCalledOnce()
    expect(pass.mock.calls[0][3]).toEqual(target)
    expect(m.ball.meta).toMatchObject({ offside: false, plannedTarget: target, flightKind: 'space' })

    mate.pos.x = 21 * dir
    m.ball.owner = carrier.pid
    m.ball.x = 0
    internals(m).execPass(carrier, mate, 0, target)
    expect(m.ball.meta?.offside).toBe(true)
    m.rules.offside = false
    m.ball.owner = carrier.pid
    m.ball.x = 0
    internals(m).execPass(carrier, mate, 0, target)
    expect(m.ball.meta?.offside).toBe(false)
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

  it('无球宽度实验参数缺失时回退历史值，保留旧快照语义', () => {
    const m = match({ instructions: narrow() }, { instructions: instructions() })
    const def = m.teams[0]
    const att = m.teams[1]
    for (const o of att.players) place(m, o.pid, 10, -20 + o.slot * 2)
    m.ball.owner = att.players[4].pid
    const player = place(m, outfield(def)[2].pid, -10, 18)
    def.presser = -1
    def.presser2 = -1
    def.cover = -1
    def.marks.fill(-1)
    const raw = { x: player.pos.x, y: player.pos.y }
    m.tacticsParams = { ...DEFAULT_PARAMS, defenseCompactness: 0.15, defenseMarkBuffer: 1.5 }
    const previous = internals(m).defensiveWidthTarget(player, raw)
    const { defenseCompactness: _compactness, defenseMarkBuffer: _buffer, ...historical } = m.tacticsParams
    m.tacticsParams = historical
    expect(internals(m).defensiveWidthTarget(player, raw)).toEqual(previous)
  })

  it('相同位置下熟练度越高，窄防守目标越接近指定宽度', () => {
    const m = match({ instructions: narrow() }, { instructions: instructions() })
    const def = m.teams[0]
    const att = m.teams[1]
    for (const o of att.players) place(m, o.pid, 10, -20 + o.slot * 2)
    m.ball.owner = att.players[4].pid
    m.ball.x = 10
    m.ball.y = 0
    const player = place(m, outfield(def)[2].pid, -10, 18)
    def.presser = -1
    def.presser2 = -1
    def.cover = -1
    def.marks.fill(-1)
    const raw = { x: player.pos.x, y: player.pos.y }
    const targetAt = (fam: number) => {
      for (const p of outfield(def)) p.familiarity = fam
      return internals(m).defensiveWidthTarget(player, raw).y
    }
    expect(targetAt(1)).toBeLessThan(targetAt(0.4))
    expect(targetAt(0.4)).toBeLessThan(targetAt(0))
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
    m.tacticsParams = { ...DEFAULT_PARAMS, defenseMarkBuffer: 1.5 }
    const raw = { x: -6, y: 10 + 1.8 + 0.2 }
    const out = internals(m).defensiveWidthTarget(marker, raw)
    expect(Math.abs(out.y - target.pos.y)).toBeLessThanOrEqual(Math.abs(raw.y - target.pos.y) + 1.5 * K + 1e-9)
  })
})

describe('尽早传中实验', () => {
  it.each([1, -1] as const)('只在开放比赛扩展合法区域，且不改候选成功率（方向 %i）', (dir) => {
    const v = instructions()
    v.advanced = { possession: { crossTiming: 'balanced' } }
    const m = match({ instructions: v }, { instructions: instructions() })
    m.teams[0].dir = dir
    m.teams[1].dir = dir === 1 ? -1 : 1
    const carrier = place(m, outfield(m.teams[0])[0].pid, 22 * dir, 25)
    const mate = place(m, outfield(m.teams[0])[7].pid, 42 * dir, 0)
    for (const o of m.teams[1].players) place(m, o.pid, 0, -30 + o.slot)
    place(m, m.teams[1].players[0].pid, 51 * dir, 0)
    place(m, m.teams[1].players[1].pid, 48 * dir, -10)
    m.ball.owner = carrier.pid
    m.ball.x = carrier.pos.x
    m.ball.y = carrier.pos.y
    ;(m as unknown as { openPlay: { phase: string } }).openPlay.phase = 'open'
    expect(internals(m).crossOption(carrier, 0)).toBeNull()
    v.advanced.possession!.crossTiming = 'early'
    const early = internals(m).crossOption(carrier, 0)
    expect(early?.mate.pid).toBe(mate.pid)
    expect(early?.score).toBeGreaterThan(0)
    ;(m as unknown as { openPlay: { phase: string } }).openPlay.phase = 'unconfirmed'
    expect(internals(m).crossOption(carrier, 0)).toBeNull()
  })

  it('同一物理局面和 RNG 下，指令不直接改变传中结算结果', () => {
    const { home, away } = baselineTeams(1)
    const neutral = cloneInstructions(NEUTRAL_INSTRUCTIONS)
    neutral.advanced = { possession: { crossTiming: 'balanced' } }
    const early = cloneInstructions(neutral)
    early.advanced!.possession!.crossTiming = 'early'
    const make = (config: TacticalInstructionsV2) => {
      const a = structuredClone(home)
      a.instructions = config
      return new PesGame({ seed: 19, home: a, away: structuredClone(away), durationSeconds: 60, offside: true, noInjuries: true, now: 0 })
    }
    const a = make(neutral)
    const b = make(early)
    const verdicts = [a, b].map((g) => {
      const passer = place(g.match, outfield(g.match.teams[0])[0].pid, 30, 25)
      const receiver = place(g.match, outfield(g.match.teams[0])[7].pid, 42, 0)
      return g.settlement.pass(g.match, passer, receiver, { x: 41, y: 0 }, 'cross', false)
    })
    expect(verdicts[0]).toEqual(verdicts[1])
  })

  it('旧距离范围内只加有界倾向，缺少禁区队友时仍回退', () => {
    const v = instructions()
    v.advanced = { possession: { crossTiming: 'balanced' } }
    const m = match({ instructions: v }, { instructions: instructions() })
    const carrier = place(m, outfield(m.teams[0])[0].pid, 30, 25)
    const mate = place(m, outfield(m.teams[0])[7].pid, 42, 0)
    for (const o of m.teams[1].players) place(m, o.pid, 0, -30 + o.slot)
    place(m, m.teams[1].players[0].pid, 51, 0)
    place(m, m.teams[1].players[1].pid, 48, -10)
    m.ball.owner = carrier.pid
    m.ball.x = carrier.pos.x
    m.ball.y = carrier.pos.y
    ;(m as unknown as { openPlay: { phase: string } }).openPlay.phase = 'open'
    const balanced = internals(m).crossOption(carrier, 0)
    v.advanced.possession!.crossTiming = 'early'
    const early = internals(m).crossOption(carrier, 0)
    expect(early!.score - balanced!.score).toBeCloseTo(0.12)
    carrier.familiarity = 0.4
    const unfamiliar = internals(m).crossOption(carrier, 0)
    expect(unfamiliar!.score - balanced!.score).toBeCloseTo(0.12 * 0.61)
    place(m, mate.pid, 0, 0)
    expect(internals(m).crossOption(carrier, 0)).toBeNull()
  })
})

describe('新指令模板与校验', () => {
  it('修订版只显式标记接空当 / 窄防守，旧模板保持不变', () => {
    for (const style of STYLE_LIST) expect(style.instructions.advanced).toBeUndefined()
    expect(STYLE_LIST_REV2.find((s) => s.id === 'directCounter')?.instructions.advanced).toEqual({
      possession: { receiving: 'space' }, defense: { width: 'narrow' },
    })
    expect(STYLE_LIST_REV2.find((s) => s.id === 'catenaccio')?.instructions.advanced?.defense?.width).toBe('narrow')
  })

  it('校验接受新字段并拒绝未知值', () => {
    const ok = instructions((v) => { v.advanced = { possession: { receiving: 'space', crossTiming: 'early' }, defense: { width: 'narrow' } } })
    expect(validateInstructions(ok).advanced).toEqual({ possession: { receiving: 'space', crossTiming: 'early' }, defense: { width: 'narrow' } })
    const bad = instructions() as unknown as Record<string, unknown>
    bad.advanced = { possession: { receiving: 'deep' } }
    expect(() => validateInstructions(bad)).toThrow(/advanced\.possession\.receiving/)
    const unknown = instructions() as unknown as Record<string, unknown>
    unknown.advanced = { defense: { width: 'narrow', pressKeeper: true } }
    expect(() => validateInstructions(unknown)).toThrow(/advanced\.defense\.pressKeeper/)
    const unsupported = instructions() as unknown as Record<string, unknown>
    unsupported.advanced = { possession: { crossTiming: 'late' } }
    expect(() => validateInstructions(unsupported)).toThrow(/advanced\.possession\.crossTiming/)
  })
})
